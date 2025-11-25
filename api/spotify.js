import { redis } from "../lib/redis";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const { code, user } = req.query;

  if (code) {
    return handleCallback(req, res, code);
  }

  if (user) {
    return handleNowPlaying(req, res, user);
  }

  res.status(400).json({ error: "Faltando parâmetro 'code' ou 'user'." });
}

// ======================================================
// 1. HANDLE CALLBACK DO SPOTIFY (TROCA CODE POR TOKEN)
// ======================================================

async function handleCallback(req, res, code) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  try {
    // 1) Trocar CODE por tokens
    const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri
      })
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error("Erro ao pegar token:", tokenData);
      return res.status(500).json({ error: tokenData });
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const expiresAt = Date.now() + tokenData.expires_in * 1000;

    // 2) Buscar dados do usuário (para obter o ID/username)
    const meRes = await fetch("https://api.spotify.com/v1/me", {
      headers: {
        "Authorization": `Bearer ${accessToken}`
      }
    });

    const me = await meRes.json();

    if (!meRes.ok) {
      console.error("Erro ao buscar /me:", me);
      return res.status(500).json({ error: "Erro ao buscar perfil" });
    }

    const spotifyUserId = me.id; // ← AGORA ISSO É NOSSA KEY!

    // 3) Salvar no Redis
    await redis.set(`spotify:${spotifyUserId}`, {
      accessToken,
      refreshToken,
      expiresAt
    });

    // 4) Responder com instrução
    res.status(200).send(`
      <html>
        <body style="font-family: sans-serif; padding: 20px;">
          <p>Seu usuário Spotify foi conectado com sucesso!</p>

          <p>Use este username no seu widget:</p>

          <h1 style="background:#efebff; padding:10px; border-radius:8px; display:inline-block;">
            ${spotifyUserId}
          </h1>

          <p style="margin-top:20px;">
            Agora use esta URL no StreamElements/widget:
          </p>

          <code style="font-size:16px; background:#eee; padding:6px; display:block; margin-top:6px;">
            ${process.env.NEXT_PUBLIC_BASE_URL}/api/spotify?user=${spotifyUserId}
          </code>

          <p style="margin-top:20px;">Você já pode fechar esta página.</p>
        </body>
      </html>
    `);

  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao trocar código por token.");
  }
}

// ======================================================
// 2. REFRESH TOKEN
// ======================================================

async function refreshAccessToken(spotifyUserId, record) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const refreshResponse = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: record.refreshToken
    })
  });

  const refreshData = await refreshResponse.json();

  if (!refreshResponse.ok) {
    console.error("Erro ao renovar token:", refreshData);
    throw new Error("Erro ao renovar token");
  }

  const newAccessToken = refreshData.access_token;
  const newRefreshToken = refreshData.refresh_token || record.refreshToken;
  const newExpiresAt = Date.now() + refreshData.expires_in * 1000;

  const newRecord = {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    expiresAt: newExpiresAt
  };

  await redis.set(`spotify:${spotifyUserId}`, newRecord);

  return newRecord;
}

// ======================================================
// 3. HANDLE NOW PLAYING
// ======================================================

async function handleNowPlaying(req, res, spotifyUserId) {
  let record = await redis.get(`spotify:${spotifyUserId}`);

  if (!record) {
    return res.status(404).json({ error: "Usuário não conectado." });
  }

  try {
    // token expirado?
    if (Date.now() >= record.expiresAt) {
      record = await refreshAccessToken(spotifyUserId, record);
    }

    let nowPlayingRes = await fetchNowPlaying(record.accessToken);

    // 401 → access token expirou e precisa atualizar
    if (nowPlayingRes.status === 401) {
      record = await refreshAccessToken(spotifyUserId, record);
      nowPlayingRes = await fetchNowPlaying(record.accessToken);
    }

    if (nowPlayingRes.status === 204 || nowPlayingRes.status === 202) {
      return res.status(200).json({ playing: false, track: null });
    }

    const nowPlayingData = await nowPlayingRes.json();

    if (!nowPlayingRes.ok) {
      console.error("Erro ao buscar música:", nowPlayingData);
      return res.status(500).json({ error: "Erro ao buscar música atual" });
    }

    const track = nowPlayingData.item;

    if (!track) {
      return res.status(200).json({ playing: false, track: null });
    }

    res.status(200).json({
      playing: nowPlayingData.is_playing,
      progressMs: nowPlayingData.progress_ms,
      durationMs: track.duration_ms,
      track: {
        title: track.name,
        artists: track.artists.map(a => a.name),
        album: track.album.name,
        albumImage: track.album.images?.[0]?.url || null
      }
    });

  } catch (err) {
    console.error("Erro geral:", err);
    res.status(500).json({ error: "Erro interno ao buscar música atual" });
  }
}

function fetchNowPlaying(accessToken) {
  return fetch("https://api.spotify.com/v1/me/player/currently-playing", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}
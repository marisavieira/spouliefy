// Store em memória (apenas para testes)
const store = globalThis.spotifyStore || (globalThis.spotifyStore = new Map());

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

  const { code, widgetKey } = req.query;

  if (code) {
    return handleCallback(req, res, code);
  }

  if (widgetKey) {
    return handleNowPlaying(req, res, widgetKey);
  }

  res.status(400).json({ error: "Faltando parâmetro 'code' ou 'widgetKey'." });
}

async function handleCallback(req, res, code) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  try {
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

    // Gera um widgetKey simples
    const widgetKey = Math.random().toString(36).substring(2, 10);

    // Salva os tokens em memória
    const expiresAt = Date.now() + tokenData.expires_in * 1000;
    store.set(widgetKey, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt
    });

    console.log("Salvei tokens para widgetKey:", widgetKey);

    res.status(200).send(`
      <html>
        <body style="font-family: sans-serif; padding: 20px;">
          <h2>🎉 Conexão realizada com sucesso!</h2>
          <p>Copie seu código abaixo e cole no widget do StreamElements (ou teste direto na URL):</p>

          <h1 style="background:#efebff; padding:10px; border-radius:8px; display:inline-block;">
            ${widgetKey}
          </h1>

          <p style="margin-top:20px; max-width:500px;">
            Para testar, abra:<br>
            <code>https://spouliefy.vercel.app/api/spotify?widgetKey=${widgetKey}</code>
          </p>

          <p style="margin-top:20px;">Você já pode fechar esta página.</p>
        </body>
      </html>
    `);

  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao trocar código por token.");
  }
}

async function handleNowPlaying(req, res, widgetKey) {
  const record = store.get(widgetKey);

  if (!record) {
    return res.status(404).json({ error: "widgetKey não encontrado ou expirado" });
  }

  let { accessToken, refreshToken, expiresAt } = record;

  // Se o token expirou, tenta renovar
  if (Date.now() >= expiresAt && refreshToken) {
    try {
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
          refresh_token: refreshToken
        })
      });

      const refreshData = await refreshResponse.json();

      if (!refreshResponse.ok) {
        console.error("Erro ao renovar token:", refreshData);
        return res.status(500).json({ error: "Erro ao renovar token" });
      }

      accessToken = refreshData.access_token;
      expiresAt = Date.now() + refreshData.expires_in * 1000;

      store.set(widgetKey, {
        accessToken,
        refreshToken,
        expiresAt
      });
    } catch (err) {
      console.error("Erro no refresh:", err);
      return res.status(500).json({ error: "Erro interno ao renovar token" });
    }
  }

  // Buscar música atual
  try {
    const nowPlayingRes = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (nowPlayingRes.status === 204 || nowPlayingRes.status === 202) {
      return res.status(200).json({ playing: false, track: null });
    }

    const nowPlayingData = await nowPlayingRes.json();

    if (!nowPlayingRes.ok) {
      console.error("Erro ao buscar música:", nowPlayingData);
      return res.status(500).json({ error: "Erro ao buscar música atual" });
    }

    const item = nowPlayingData.item;

    if (!item) {
      return res.status(200).json({ playing: false, track: null });
    }

    const progressMs = nowPlayingData.progress_ms ?? 0;
    const durationMs = item.duration_ms ?? 0;

    const payload = {
      playing: nowPlayingData.is_playing,
      progressMs,
      durationMs,
      track: {
        title: item.name,
        artists: item.artists.map(a => a.name),
        album: item.album.name,
        albumImage: item.album.images?.[0]?.url || null
      }
    };

    res.status(200).json(payload);
  } catch (err) {
    console.error("Erro geral:", err);
    res.status(500).json({ error: "Erro interno ao buscar música atual" });
  }
}
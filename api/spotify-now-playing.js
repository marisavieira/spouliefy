// Usa a mesma store em memória inicializada em codespotify.js
const store = globalThis.spotifyStore || (globalThis.spotifyStore = new Map());

export default async function handler(req, res) {
  const widgetKey = req.query.widgetKey;

  if (!widgetKey) {
    res.status(400).json({ error: "widgetKey é obrigatório" });
    return;
  }

  const record = store.get(widgetKey);

  if (!record) {
    res.status(404).json({ error: "widgetKey não encontrado ou expirado" });
    return;
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
        refreshToken: refreshToken, // geralmente o refresh_token não muda
        expiresAt
      });
    } catch (err) {
      console.error("Erro no refresh:", err);
      return res.status(500).json({ error: "Erro interno ao renovar token" });
    }
  }

  // Agora chama o "currently playing"
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

    const responsePayload = {
      playing: nowPlayingData.is_playing,
      track: {
        title: item.name,
        artists: item.artists.map(a => a.name),
        album: item.album.name,
        albumImage: item.album.images?.[0]?.url || null
      }
    };

    res.status(200).json(responsePayload);

  } catch (err) {
    console.error("Erro geral:", err);
    res.status(500).json({ error: "Erro interno ao buscar música atual" });
  }
}
// api/spotify.js
import {
  getSession,
  updateAccessToken,
  saveTrackCache,
  getTrackCache
} from "./spotifyStore.js";

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

async function refreshAccessToken(widgetKey) {
  const session = await getSession(widgetKey);
  if (!session || !session.refreshToken) {
    throw new Error("Sessão ou refresh token não encontrado para essa widgetKey");
  }

  const basicAuth = Buffer
    .from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`)
    .toString("base64");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${basicAuth}`
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: session.refreshToken
    })
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("Erro ao dar refresh no token do Spotify:", data);
    throw new Error("Falha ao atualizar token do Spotify");
  }

  await updateAccessToken(widgetKey, {
    accessToken: data.access_token,
    expiresIn: data.expires_in || 3600
  });

  return data.access_token;
}

async function getValidAccessToken(widgetKey) {
  const session = await getSession(widgetKey);
  if (!session) {
    throw new Error("Sessão não encontrada para essa widgetKey");
  }

  const now = Date.now();

  if (session.accessToken && session.expiresAt && now < session.expiresAt) {
    return session.accessToken;
  }

  return await refreshAccessToken(widgetKey);
}

async function fetchCurrentTrackFromSpotify(accessToken) {
  const res = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (res.status === 204) {
    return {
      isPlaying: false,
      progressMs: 0,
      durationMs: 0,
      track: null
    };
  }

  const data = await res.json();

  if (!res.ok) {
    console.error("Erro ao buscar música atual:", data);
    throw new Error("Não foi possível obter a música atual");
  }

  return {
    isPlaying: data.is_playing,
    progressMs: data.progress_ms,
    durationMs: data.item?.duration_ms,
    track: {
      name: data.item?.name,
      artists: data.item?.artists?.map((a) => a.name).join(", "),
      album: data.item?.album?.name,
      image: data.item?.album?.images?.[0]?.url
    }
  };
}

export default async function handler(req, res) {
  const { widgetKey } = req.query;

  if (!widgetKey) {
    return res.status(400).json({ error: "widgetKey é obrigatório" });
  }

  try {
    // 1) tenta usar cache
    const CACHE_WINDOW_MS = 4000; // 4s
    const cached = await getTrackCache(widgetKey);

    if (cached && cached.trackData && cached.fetchedAt) {
      const now = Date.now();
      if (now - cached.fetchedAt < CACHE_WINDOW_MS) {
        return res.status(200).json(cached.trackData);
      }
    }

    // 2) garante access_token válido (com refresh automático)
    const accessToken = await getValidAccessToken(widgetKey);

    // 3) chama Spotify
    const trackData = await fetchCurrentTrackFromSpotify(accessToken);

    // 4) atualiza cache
    await saveTrackCache(widgetKey, trackData);

    // 5) responde pro widget
    return res.status(200).json(trackData);
  } catch (err) {
    console.error("Erro em /api/spotify:", err);
    return res.status(500).json({ error: "Erro ao obter música atual" });
  }
}
// api/spotify.js
import {
  getSession,
  updateAccessToken,
  saveTrackCache,
  getTrackCache
} from "./spotify-store.js";

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

async function refreshAccessToken(userId) {
  const session = await getSession(userId);
  if (!session || !session.refreshToken) {
    throw new Error("Sessão ou refresh token não encontrado para esse usuário");
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

  await updateAccessToken(userId, {
    accessToken: data.access_token,
    expiresIn: data.expires_in || 3600
  });

  return data.access_token;
}

async function getValidAccessToken(userId) {
  const session = await getSession(userId);
  if (!session) {
    throw new Error("Sessão não encontrada para esse usuário");
  }

  const now = Date.now();

  if (session.accessToken && session.expiresAt && now < session.expiresAt) {
    return session.accessToken;
  }

  return await refreshAccessToken(userId);
}

async function fetchCurrentTrackFromSpotify(accessToken) {
  const res = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (res.status === 204) {
    return {
      playing: false,
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
    playing: data.is_playing,
    progressMs: data.progress_ms,
    durationMs: data.item?.duration_ms || 0,
    track: {
      title: data.item?.name || "",
      artists: data.item?.artists?.map(a => a.name) || [],
      albumImage: data.item?.album?.images?.[0]?.url || null
    }
  };
}

export default async function handler(req, res) {
  const { user } = req.query;

  if (!user) {
    return res.status(400).json({ error: "MISSING_USER" });
  }

  try {
    // 1) checa sessão
    const session = await getSession(user);
    if (!session) {
      return res.status(404).json({ error: "NOT_CONNECTED" });
    }

    // 2) tenta usar cache
    const CACHE_WINDOW_MS = 4000;
    const cached = await getTrackCache(user);

    if (cached && cached.trackData && cached.fetchedAt) {
      const now = Date.now();
      if (now - cached.fetchedAt < CACHE_WINDOW_MS) {
        return res.status(200).json(cached.trackData);
      }
    }

    // 3) garante access_token válido
    const accessToken = await getValidAccessToken(user);

    // 4) pega track atual
    const trackData = await fetchCurrentTrackFromSpotify(accessToken);

    // 5) salva cache
    await saveTrackCache(user, trackData);

    return res.status(200).json(trackData);
  } catch (err) {
    console.error("Erro em /api/spotify:", err);
    return res.status(500).json({ error: "INTERNAL_ERROR" });
  }
}
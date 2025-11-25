// api/spotifyStore.js
import { redis } from "../lib/redis.js";

const SESSION_PREFIX = "spotify-session:";
const TRACK_PREFIX = "spotify-track:";

function sessionKey(widgetKey) {
  return SESSION_PREFIX + widgetKey;
}

function trackKey(widgetKey) {
  return TRACK_PREFIX + widgetKey;
}

export async function saveSession(widgetKey, { accessToken, refreshToken, expiresIn }) {
  const now = Date.now();
  const expiresAt = now + (expiresIn - 60) * 1000; // margem de 60s

  const data = {
    accessToken,
    refreshToken,
    expiresAt
  };

  await redis.set(sessionKey(widgetKey), JSON.stringify(data));
}

export async function getSession(widgetKey) {
  const raw = await redis.get(sessionKey(widgetKey));
  if (!raw) return null;

  // Upstash pode devolver string ou objeto — garantimos string -> JSON
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error("Erro ao parsear sessão do Redis:", e);
      return null;
    }
  }

  // Se já veio como objeto
  return raw;
}

export async function updateAccessToken(widgetKey, { accessToken, expiresIn }) {
  const session = await getSession(widgetKey);
  if (!session) return;

  const now = Date.now();
  session.accessToken = accessToken;
  session.expiresAt = now + (expiresIn - 60) * 1000;

  await redis.set(sessionKey(widgetKey), JSON.stringify(session));
}

export async function saveTrackCache(widgetKey, trackData) {
  const now = Date.now();
  const cached = {
    trackData,
    fetchedAt: now
  };
  await redis.set(trackKey(widgetKey), JSON.stringify(cached));
}

export async function getTrackCache(widgetKey) {
  const raw = await redis.get(trackKey(widgetKey));
  if (!raw) return null;

  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error("Erro ao parsear cache de track:", e);
      return null;
    }
  }

  return raw;
}
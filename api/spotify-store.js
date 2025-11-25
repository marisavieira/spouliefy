// api/spotify-store.js
import { redis } from "../lib/redis.js";

const SESSION_PREFIX = "spotify-session:";
const TRACK_PREFIX = "spotify-track:";

function sessionKey(userId) {
  return SESSION_PREFIX + userId;
}

function trackKey(userId) {
  return TRACK_PREFIX + userId;
}

export async function saveSession(userId, { accessToken, refreshToken, expiresIn }) {
  const now = Date.now();
  const expiresAt = now + (expiresIn - 60) * 1000; // margem de 60s

  const data = {
    accessToken,
    refreshToken,
    expiresAt
  };

  await redis.set(sessionKey(userId), JSON.stringify(data));
}

export async function getSession(userId) {
  const raw = await redis.get(sessionKey(userId));
  if (!raw) return null;

  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error("Erro ao parsear sessão do Redis:", e);
      return null;
    }
  }

  return raw;
}

export async function updateAccessToken(userId, { accessToken, expiresIn }) {
  const session = await getSession(userId);
  if (!session) return;

  const now = Date.now();
  session.accessToken = accessToken;
  session.expiresAt = now + (expiresIn - 60) * 1000;

  await redis.set(sessionKey(userId), JSON.stringify(session));
}

export async function saveTrackCache(userId, trackData) {
  const now = Date.now();
  const cached = {
    trackData,
    fetchedAt: now
  };
  await redis.set(trackKey(userId), JSON.stringify(cached));
}

export async function getTrackCache(userId) {
  const raw = await redis.get(trackKey(userId));
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
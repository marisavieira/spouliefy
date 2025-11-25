// api/spotify-login.js
import {
  saveSession
} from "./spotify-store.js";

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI;

// Handler estilo Vercel / Next API
export default async function handler(req, res) {
  const { code, error, state } = req.query;

  if (error) {
    console.error("Erro retornado pelo Spotify:", error);
    return res.status(400).send("Erro na autenticação com Spotify");
  }

  if (!code) {
    return res.status(400).send("Código de autorização não fornecido");
  }

  // usamos state pra saber qual widgetKey está conectando
  const widgetKey = state;
  if (!widgetKey) {
    return res.status(400).send("Widget key (state) não informado");
  }

  try {
    const basicAuth = Buffer
      .from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`)
      .toString("base64");

    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${basicAuth}`
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI
      })
    });

    const data = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error("Erro na troca de código por tokens:", data);
      return res.status(500).send("Erro ao obter tokens do Spotify");
    }

    const accessToken = data.access_token;
    const refreshToken = data.refresh_token;
    const expiresIn = data.expires_in || 3600;

    // 🔑 Salva tudo no Redis usando a widgetKey
    await saveSession(widgetKey, {
      accessToken,
      refreshToken,
      expiresIn
    });

    // Aqui você pode redirecionar pra alguma página bonitinha
    return res.status(200).send("Spotify conectado com sucesso! Você já pode usar seu widget.");
  } catch (err) {
    console.error("Erro no callback do Spotify:", err);
    return res.status(500).send("Erro interno ao conectar com Spotify");
  }
}
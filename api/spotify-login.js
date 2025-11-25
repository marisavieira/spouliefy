// api/spotify-login.js
import { saveSession } from "./spotify-store.js";

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI;

export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    console.error("Erro retornado pelo Spotify:", error);
    return res.status(400).send("Erro na autenticação com Spotify");
  }

  if (!code) {
    return res.status(400).send("Código de autorização não fornecido");
  }

  try {
    // 1) Trocar code por tokens
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

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error("Erro na troca de código por tokens:", tokenData);
      return res.status(500).send("Erro ao obter tokens do Spotify");
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const expiresIn = tokenData.expires_in || 3600;

    // 2) Pegar perfil do usuário (/me)
    const meRes = await fetch("https://api.spotify.com/v1/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const meData = await meRes.json();

    if (!meRes.ok) {
      console.error("Erro ao obter perfil do usuário:", meData);
      return res.status(500).send("Erro ao obter dados do Spotify");
    }

    const spotifyUserId = meData.id; // esse é o "username" que você vai mostrar
    const displayName = meData.display_name || spotifyUserId;

    // 3) Salvar sessão no Redis usando spotifyUserId
    await saveSession(spotifyUserId, {
      accessToken,
      refreshToken,
      expiresIn
    });

    // 4) Mostrar uma pagina simples com o username pro usuário
    const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Spotify conectado • Pouliefy</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: radial-gradient(circle at top, #bfadff, #363a6a 60%);
      color: #fff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: rgba(0, 0, 0, 0.35);
      border-radius: 24px;
      padding: 24px 28px;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 18px 40px rgba(0,0,0,0.45);
    }
    code {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 999px;
      background: rgba(0,0,0,0.4);
      font-size: 14px;
    }
    button {
      margin-top: 16px;
      padding: 8px 14px;
      border-radius: 999px;
      border: none;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      background: #bfadff;
      color: #1c1638;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Spotify conectado! 🎧</h1>
    <p>Conta conectada: <strong>${displayName}</strong></p>
    <p>Seu <strong>Spotify username</strong> para usar no widget é:</p>
    <p><code>${spotifyUserId}</code></p>
    <p>Cole esse valor no campo <strong>"Spotify Username"</strong> do widget no StreamElements.</p>
  </div>
</body>
</html>
    `.trim();

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (err) {
    console.error("Erro no callback do Spotify:", err);
    return res.status(500).send("Erro interno ao conectar com Spotify");
  }
}
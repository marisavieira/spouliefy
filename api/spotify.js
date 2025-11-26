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

  const { code, user, logout } = req.query;

  // callback do Spotify (depois do login)
  if (code) {
    return handleCallback(req, res, code);
  }

  // logout / desconectar
  if (logout && user) {
    return handleLogout(req, res, user);
  }

  // endpoint que o widget consome (now playing)
  if (user) {
    return handleNowPlaying(req, res, user);
  }

  res
    .status(400)
    .json({ error: "Faltando parâmetro 'code' ou 'user'." });
}

// ======================================================
// 1. HANDLE CALLBACK DO SPOTIFY (TROCA CODE POR TOKEN)
//    + TELA PÓS LOGIN
// ======================================================

async function handleCallback(req, res, code) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  const credentials = Buffer.from(
    `${clientId}:${clientSecret}`
  ).toString("base64");

  try {
    // 1) Trocar CODE por tokens
    const tokenResponse = await fetch(
      "https://accounts.spotify.com/api/token",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      }
    );

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
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const me = await meRes.json();

    if (!meRes.ok) {
      console.error("Erro ao buscar /me:", me);
      return res.status(500).json({ error: "Erro ao buscar perfil" });
    }

    const spotifyUserId = me.id; // username/ID que vamos usar como key

    // 3) Salvar no Redis
    await redis.set(`spotify:${spotifyUserId}`, {
      accessToken,
      refreshToken,
      expiresAt,
    });

    // 4) Responder com a TELA BONITA 💜
    res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Spotify Widget • Connected</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" integrity="sha512-..." crossorigin="anonymous" referrerpolicy="no-referrer" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      --bg: #ced1e8;
      --text-main: #141414;
      --text-sub: #49474C;
      --pill-bg: rgba(37, 34, 34, 0.79);
      --pill-text: #F2F2F2;
      --pill-radius: 100px;
      --input-bg: #F2F2F2;
      --input-border: #939196;
      --input-radius: 10px;
      --font: "Poppins", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
        sans-serif;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      min-height: 100vh;
      background: var(--bg);
      font-family: var(--font);
      color: var(--text-main);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px 24px;
    }

    .page {
      width: 100%;
      max-width: 1440px;
      min-height: 600px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .card {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 32px;
    }

    .left {
      flex-shrink: 0;
    }

    .left img {
      width: 230px;
      height: 406px;
      max-width: 40vw;
      object-fit: contain;
      display: block;
    }

    .right {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: flex-start;
      gap: 16px;
    }

    .title-block {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: flex-start;
    }

    .title-block h1 {
      font-size: 32px;
      font-weight: bold;
      text-transform: uppercase;
    }

    .username-box {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      width: 100%;
    }

    .field-label {
      font-size: 14px;
      color: var(--text-sub);
    }

    .input-wrapper {
      display: flex;
      width: 400px;
      max-width: 100%;
      height: 40px;
      align-items: center;
      border-radius: var(--input-radius);
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      padding-left: 16px;
      padding-right: 6px;
      gap: 8px;
    }

    .input-wrapper input {
      flex: 1;
      height: 100%;
      border: none;
      outline: none;
      background: transparent;
      font-size: 14px;
      color: var(--text-main);
    }

    .input-wrapper input::selection {
      background: rgba(177, 169, 255, 0.4);
    }

    .copy-btn {
      display: flex;
      align-items: center;
      border: none;
      background: transparent;
      cursor: pointer;
      width: 30px;
      height: 30px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.12s ease, transform 0.12s ease;
    }

    .copy-btn:hover {
      background: rgba(0, 0, 0, 0.06);
      transform: translateY(-1px);
    }

    .copy-btn:active {
      transform: translateY(0);
    }

    .copy-icon {
      position: relative;
      width: 24.22px;
      height: 24.22px;
    }

    .copy-icon::before,
    .copy-icon::after {
      content: "";
      position: absolute;
      border-radius: 3px;
      border: 1.6px solid #444;
    }

    .copy-icon::before {
      width: 10px;
      height: 10px;
      left: 2px;
      top: 4px;
      background: transparent;
    }

    .copy-icon::after {
      width: 10px;
      height: 10px;
      left: 4px;
      top: 2px;
      background: #fdfdfd;
    }

    .primary-btn {
      display: flex;
      width: 400px;
      max-width: 100%;
      height: 40px;
      justify-content: center;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
      border-radius: var(--pill-radius);
      background: var(--pill-bg);
      color: var(--pill-text);
      font-size: 14px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border: none;
      cursor: pointer;
      box-shadow: 0 14px 26px rgba(0, 0, 0, 0.25);
      transition: opacity 0.12s ease, transform 0.12s ease,
        box-shadow 0.12s ease;
    }

    .primary-btn:hover {
      opacity: 0.96;
      transform: translateY(-1px);
      box-shadow: 0 18px 32px rgba(0, 0, 0, 0.3);
    }

    .primary-btn:active {
      opacity: 0.9;
      transform: translateY(0);
      box-shadow: 0 8px 18px rgba(0, 0, 0, 0.25);
    }

    .helper-text {
      font-size: 12px;
      color: var(--text-sub);
    }

    .toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(37, 34, 34, 0.9);
      color: #f7f7f7;
      padding: 8px 14px;
      border-radius: 999px;
      font-size: 12px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.18s ease;
    }

    .toast--visible {
      opacity: 1;
    }

    @media (max-width: 840px) {
      .card {
        flex-direction: column;
      }

      .right {
        align-items: center;
        text-align: center;
      }

      .title-block {
        align-items: center;
      }

      .username-box {
        align-items: stretch;
        width: 100%;
      }

      .helper-text {
        text-align: center;
      }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="card">
      <div class="left" aria-hidden="true">
        <!-- TROCAR PELA SUA IMAGEM -->
        <img src="../image/poulieshop_site.png" alt="">
      </div>

      <div class="right">
        <div class="title-block">
          <h1>Spotify Music Widget</h1>
        </div>

        <div class="username-box">
          <label class="field-label" for="spotify-username">Spotify username</label>
          <div class="input-wrapper">
            <input
              id="spotify-username"
              type="text"
              readonly
              value="${spotifyUserId}"
            />
            <button id="copy-btn" class="copy-btn" type="button" aria-label="Copy username">
              <span class="copy-icon" aria-hidden="true"></span>
            </button>
          </div>
        </div>

        <button id="disconnect-btn" class="primary-btn" type="button">
          <i class="fa-brands fa-spotify" style="font-size:24px; color:#1ED760;"></i>
          <span>Disconnect from Spotify</span>
        </button>

      </div>
    </section>

    <div id="toast" class="toast" role="status" aria-live="polite">
      Username copied!
    </div>
  </main>

  <script>
    (function () {
      var input = document.getElementById("spotify-username");
      var copyBtn = document.getElementById("copy-btn");
      var toast = document.getElementById("toast");
      var disconnectBtn = document.getElementById("disconnect-btn");

      function showToast(message) {
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add("toast--visible");
        setTimeout(function () {
          toast.classList.remove("toast--visible");
        }, 1800);
      }

      copyBtn.addEventListener("click", function () {
        if (!input) return;
        var value = input.value || "";
        if (!navigator.clipboard) {
          input.select();
          document.execCommand("copy");
          showToast("Username copied!");
          return;
        }
        navigator.clipboard
          .writeText(value)
          .then(function () {
            showToast("Username copied!");
          })
          .catch(function () {
            showToast("Could not copy :(");
          });
      });

      // Deslogar: chama /api/spotify?logout=1&user=<username> e depois fecha a aba
      disconnectBtn.addEventListener("click", function () {
        var username = (input && input.value) || "";
        if (!username) {
          window.location.href = "/";
          return;
        }

        fetch("/api/spotify?logout=1&user=" + encodeURIComponent(username))
          .then(function (res) {
            if (!res.ok) throw new Error("Erro ao desconectar");
            return res.json();
          })
          .then(function (data) {
            showToast("Disconnected from Spotify");

            setTimeout(function () {
              // volta para index
              window.location.href = data.redirect || "/";
            }, 700);
          })
          .catch(function () {
            showToast("Could not disconnect :(");
          });
      });
    })();
  </script>
</body>
</html>`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao trocar código por token.");
  }
}

// ======================================================
// 2. LOGOUT / DESCONECTAR
// ======================================================

async function handleLogout(req, res, spotifyUserId) {
  try {
    await redis.del(`spotify:${spotifyUserId}`);
    return res.status(200).json({ ok: true, redirect: "/" });
  } catch (err) {
    console.error("Erro ao deslogar usuário:", err);
    return res.status(500).json({ error: "Erro ao desconectar do Spotify." });
  }
}
// ======================================================
// 3. REFRESH TOKEN
// ======================================================

async function refreshAccessToken(spotifyUserId, record) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  const credentials = Buffer.from(
    `${clientId}:${clientSecret}`
  ).toString("base64");

  const refreshResponse = await fetch(
    "https://accounts.spotify.com/api/token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: record.refreshToken,
      }),
    }
  );

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
    expiresAt: newExpiresAt,
  };

  await redis.set(`spotify:${spotifyUserId}`, newRecord);

  return newRecord;
}

// ======================================================
// 4. HANDLE NOW PLAYING
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
      return res
        .status(500)
        .json({ error: "Erro ao buscar música atual" });
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
        artists: track.artists.map((a) => a.name),
        album: track.album.name,
        albumImage: track.album.images?.[0]?.url || null,
      },
    });
  } catch (err) {
    console.error("Erro geral:", err);
    res
      .status(500)
      .json({ error: "Erro interno ao buscar música atual" });
  }
}

function fetchNowPlaying(accessToken) {
  return fetch("https://api.spotify.com/v1/me/player/currently-playing", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
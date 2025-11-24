export default async function handler(req, res) {
  const code = req.query.code;

  if (!code) {
    res.status(400).send("Código não encontrado na URL.");
    return;
  }

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
      return res.status(500).json({ error: tokenData });
    }

    // GERA UM WIDGET KEY (simples por enquanto)
    const widgetKey = Math.random().toString(36).substring(2, 10);

    // TODO: salvar refresh_token + access_token + widgetKey no seu banco (faremos depois)

    res.status(200).send(`
      <html>
        <body style="font-family: sans-serif; padding: 20px;">
          <h2>🎉 Conexão realizada com sucesso!</h2>
          <p>Copie seu código abaixo e cole no widget do StreamElements:</p>

          <h1 style="background:#efebff; padding:10px; border-radius:8px; display:inline-block;">
            ${widgetKey}
          </h1>

          <p style="margin-top:20px;">Você já pode fechar esta página.</p>
        </body>
      </html>
    `);

  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao trocar código por token.");
  }
}
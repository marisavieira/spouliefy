export default function handler(req, res) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  const scope = [
    "user-read-currently-playing",
    "user-read-playback-state"
  ].join(" ");

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope
  });

  const authUrl = `https://accounts.spotify.com/authorize?${params.toString()}`;

  // Redireciona o usuário para o login do Spotify
  res.writeHead(302, { Location: authUrl });
  res.end();
}
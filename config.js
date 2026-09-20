// ==============================================
// НАЛАШТУВАННЯ. Заповни це перед запуском.
// ==============================================
const CONFIG = {
  // Встав сюди Client ID зі свого застосунку на developer.spotify.com/dashboard
  SPOTIFY_CLIENT_ID: "ВСТАВ_СВІЙ_CLIENT_ID_СЮДИ",

  // Має ЗБІГАТИСЯ 1-в-1 з "Redirect URI", який ти впишеш у налаштуваннях
  // застосунку на Spotify Dashboard. Поки тестуєш локально, залиши як є —
  // код підставить поточну адресу сторінки автоматично.
  REDIRECT_URI: window.location.origin + window.location.pathname,

  // Права доступу, які просимо у користувача
  SCOPES: [
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state"
  ].join(" ")
};

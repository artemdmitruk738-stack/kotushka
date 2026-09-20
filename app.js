// =====================================================================
// КОТУШКА — логіка застосунку
// Написано простими функціями (без класів/ООП), щоб було зрозуміло
// людині, яка знає основи С++, але ще не дійшла до ООП.
// Файл розбитий на розділи — читай зверху вниз.
// =====================================================================


// ---------------------------------------------------------------------
// РОЗДІЛ 1. Допоміжні функції для Spotify PKCE-авторизації
// (PKCE — це спосіб безпечно залогінитись у Spotify без бекенд-сервера
// і без секретного ключа, який довелось би десь ховати)
// ---------------------------------------------------------------------

function generateRandomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const randomValues = crypto.getRandomValues(new Uint8Array(length));
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return crypto.subtle.digest("SHA-256", data);
}

function base64UrlEncode(arrayBuffer) {
  let str = "";
  const bytes = new Uint8Array(arrayBuffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}


// ---------------------------------------------------------------------
// РОЗДІЛ 2. Керування станом авторизації (токени зберігаємо в localStorage,
// щоб вони пережили перезапуск застосунку)
// ---------------------------------------------------------------------

function saveTokens(accessToken, refreshToken, expiresInSeconds) {
  const expiresAt = Date.now() + expiresInSeconds * 1000;
  localStorage.setItem("sp_access_token", accessToken);
  if (refreshToken) localStorage.setItem("sp_refresh_token", refreshToken);
  localStorage.setItem("sp_expires_at", String(expiresAt));
}

function getAccessToken() {
  return localStorage.getItem("sp_access_token");
}

function isLoggedIn() {
  return !!getAccessToken();
}

function logout() {
  localStorage.removeItem("sp_access_token");
  localStorage.removeItem("sp_refresh_token");
  localStorage.removeItem("sp_expires_at");
  location.reload();
}

async function startSpotifyLogin() {
  const verifier = generateRandomString(64);
  localStorage.setItem("sp_verifier", verifier);

  const challengeBuffer = await sha256(verifier);
  const challenge = base64UrlEncode(challengeBuffer);

  const params = new URLSearchParams({
    client_id: CONFIG.SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: CONFIG.REDIRECT_URI,
    scope: CONFIG.SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge
  });

  window.location.href = "https://accounts.spotify.com/authorize?" + params.toString();
}

// Якщо ми щойно повернулись від Spotify з кодом у посиланні — обмінюємо
// його на реальний токен доступу.
async function handleSpotifyRedirect() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if (!code) return false;

  const verifier = localStorage.getItem("sp_verifier");

  const body = new URLSearchParams({
    client_id: CONFIG.SPOTIFY_CLIENT_ID,
    grant_type: "authorization_code",
    code: code,
    redirect_uri: CONFIG.REDIRECT_URI,
    code_verifier: verifier
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body
  });

  if (!response.ok) {
    console.error("Не вдалося обміняти код на токен", await response.text());
    return false;
  }

  const data = await response.json();
  saveTokens(data.access_token, data.refresh_token, data.expires_in);

  // Прибираємо ?code=... з адресного рядка, щоб не заплутатись при перезавантаженні
  url.searchParams.delete("code");
  window.history.replaceState({}, "", url.pathname);
  return true;
}

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem("sp_refresh_token");
  if (!refreshToken) return false;

  const body = new URLSearchParams({
    client_id: CONFIG.SPOTIFY_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body
  });

  if (!response.ok) return false;
  const data = await response.json();
  saveTokens(data.access_token, data.refresh_token || refreshToken, data.expires_in);
  return true;
}

// Обгортка над fetch, яка сама підставляє токен і сама оновлює його,
// якщо він протух.
async function spotifyApiFetch(path, options) {
  options = options || {};
  options.headers = options.headers || {};
  options.headers["Authorization"] = "Bearer " + getAccessToken();

  let response = await fetch("https://api.spotify.com/v1" + path, options);

  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      options.headers["Authorization"] = "Bearer " + getAccessToken();
      response = await fetch("https://api.spotify.com/v1" + path, options);
    }
  }
  return response;
}


// ---------------------------------------------------------------------
// РОЗДІЛ 3. Відкриття треку Spotify у самому Spotify
// (Без Premium ми не можемо грати трек усередині нашого застосунку —
// Spotify Web Playback SDK це технічно забороняє. Натомість відкриваємо
// трек напряму в застосунку/на сайті Spotify, де він грає безкоштовно,
// з рекламою — так само, як завжди.)
// ---------------------------------------------------------------------

function openSpotifyTrack(spotifyUrl) {
  if (!spotifyUrl) return;
  window.open(spotifyUrl, "_blank");
}


// ---------------------------------------------------------------------
// РОЗДІЛ 4. Пошук у Spotify
// ---------------------------------------------------------------------

async function searchSpotify(query) {
  const listEl = document.getElementById("search-results");
  const emptyEl = document.getElementById("search-empty");
  if (!query) {
    listEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    return;
  }

  // З лютого 2026 Spotify обмежив limit пошуку максимум до 10 за раз
  const response = await spotifyApiFetch(`/search?type=track&limit=10&q=${encodeURIComponent(query)}`);
  if (!response.ok) return;
  const data = await response.json();

  listEl.innerHTML = "";
  const tracks = data.tracks ? data.tracks.items : [];
  emptyEl.classList.toggle("hidden", tracks.length > 0);

  tracks.forEach((track) => {
    const artist = track.artists.map((a) => a.name).join(", ");
    const artwork = track.album.images[0] ? track.album.images[0].url : "";
    listEl.appendChild(buildTrackRow({
      title: track.name,
      artist: artist,
      artwork: track.album.images[2] ? track.album.images[2].url : artwork,
      source: "spotify",
      external: true,
      onPlay: () => openSpotifyTrack(track.external_urls.spotify),
      onAdd: () => addToLibrary({
        source: "spotify",
        id: track.id,
        title: track.name,
        artist: artist,
        artwork: artwork,
        url: track.external_urls.spotify
      })
    }));
  });
}


// ---------------------------------------------------------------------
// РОЗДІЛ 5. SoundCloud — додавання треку за посиланням через oEmbed
// (oEmbed — публічний, не потребує API-ключа)
// ---------------------------------------------------------------------

async function fetchSoundCloudOEmbed(trackUrl) {
  const endpoint = "https://soundcloud.com/oembed?format=json&url=" + encodeURIComponent(trackUrl);
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error("Не вдалося розпізнати посилання SoundCloud");
  return response.json();
}

async function addSoundCloudByUrl(trackUrl) {
  const data = await fetchSoundCloudOEmbed(trackUrl);
  // data.html містить готовий <iframe> для програвача SoundCloud
  addToLibrary({
    source: "soundcloud",
    id: trackUrl,
    title: data.title || "Без назви",
    artist: data.author_name || "SoundCloud",
    artwork: data.thumbnail_url || "",
    embedHtml: data.html,
    url: trackUrl
  });
}

let scWidget = null; // об'єкт керування поточним віджетом SoundCloud

function playSoundCloudTrack(item) {
  const holder = document.getElementById("soundcloud-widget-holder");
  holder.innerHTML = item.embedHtml;
  const iframe = holder.querySelector("iframe");

  scWidget = SC.Widget(iframe);
  scWidget.bind(SC.Widget.Events.READY, () => {
    scWidget.play();
  });
  scWidget.bind(SC.Widget.Events.PLAY, () => {
    isPlaying = true;
    updateTransportUI();
  });
  scWidget.bind(SC.Widget.Events.PAUSE, () => {
    isPlaying = false;
    updateTransportUI();
  });
  scWidget.bind(SC.Widget.Events.PLAY_PROGRESS, (progress) => {
    updateTapeCounter(progress.currentPosition, currentTrackDurationMs);
  });
  scWidget.bind(SC.Widget.Events.FINISH, () => {
    isPlaying = false;
    updateTransportUI();
  });

  scWidget.getDuration((ms) => { currentTrackDurationMs = ms; });

  setNowPlaying({
    source: "soundcloud",
    id: item.id,
    title: item.title,
    artist: item.artist,
    artwork: item.artwork,
    durationMs: 0
  });
}


// ---------------------------------------------------------------------
// РОЗДІЛ 6. Бібліотека користувача ("Моя котушка") — зберігається в
// localStorage, тож лишається після закриття застосунку.
// ---------------------------------------------------------------------

function loadLibrary() {
  const raw = localStorage.getItem("kotushka_library");
  return raw ? JSON.parse(raw) : [];
}

function saveLibrary(items) {
  localStorage.setItem("kotushka_library", JSON.stringify(items));
}

function addToLibrary(item) {
  const items = loadLibrary();
  const alreadyThere = items.some((existing) => existing.id === item.id);
  if (!alreadyThere) {
    items.push(item);
    saveLibrary(items);
  }
  renderLibrary();
}

function removeFromLibrary(id) {
  const items = loadLibrary().filter((item) => item.id !== id);
  saveLibrary(items);
  renderLibrary();
}

function renderLibrary() {
  const listEl = document.getElementById("library-list");
  const emptyEl = document.getElementById("library-empty");
  const items = loadLibrary();

  listEl.innerHTML = "";
  emptyEl.classList.toggle("hidden", items.length > 0);

  items.forEach((item) => {
    listEl.appendChild(buildTrackRow({
      title: item.title,
      artist: item.artist,
      artwork: item.artwork,
      source: item.source,
      external: item.source === "spotify",
      onPlay: () => {
        if (item.source === "spotify") {
          openSpotifyTrack(item.url);
        } else {
          playSoundCloudTrack(item);
        }
      },
      onRemove: () => removeFromLibrary(item.id)
    }));
  });
}


// ---------------------------------------------------------------------
// РОЗДІЛ 7. Побудова рядка треку (спільна і для пошуку, і для бібліотеки)
// ---------------------------------------------------------------------

function buildTrackRow({ title, artist, artwork, source, external, onPlay, onAdd, onRemove }) {
  const li = document.createElement("li");
  li.className = "track-row";

  const img = document.createElement("img");
  img.src = artwork || "";
  img.alt = "";
  li.appendChild(img);

  const info = document.createElement("div");
  info.className = "track-row-info";
  info.innerHTML = `
    <div class="track-row-title"></div>
    <div class="track-row-artist"></div>
  `;
  info.querySelector(".track-row-title").textContent = title;
  info.querySelector(".track-row-artist").textContent = artist;
  li.appendChild(info);

  // Підказка: "▶" — грає прямо тут, "↗" — відкриється в іншому застосунку
  const actionHint = document.createElement("span");
  actionHint.className = "row-action-hint";
  actionHint.textContent = external ? "↗" : "▶";
  li.appendChild(actionHint);

  const dot = document.createElement("span");
  dot.className = "source-dot " + source;
  li.appendChild(dot);

  li.addEventListener("click", (e) => {
    if (e.target.dataset.action === "remove") return;
    onPlay();
  });

  if (onAdd) {
    const addBtn = document.createElement("button");
    addBtn.textContent = "+";
    addBtn.className = "icon-btn";
    addBtn.style.fontSize = "20px";
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onAdd();
      addBtn.textContent = "✓";
    });
    li.appendChild(addBtn);
  }

  if (onRemove) {
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "×";
    removeBtn.dataset.action = "remove";
    removeBtn.className = "icon-btn";
    removeBtn.style.fontSize = "20px";
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onRemove();
    });
    li.appendChild(removeBtn);
  }

  return li;
}


// ---------------------------------------------------------------------
// РОЗДІЛ 8. Стан "зараз грає" + оновлення інтерфейсу (міні-плеєр і
// повноекранний плеєр)
// ---------------------------------------------------------------------

let currentTrack = { source: null, id: null, title: "—", artist: "—", artwork: "" };
let currentTrackDurationMs = 0;
let isPlaying = false;

function setNowPlaying(track) {
  currentTrack = track;
  currentTrackDurationMs = track.durationMs || 0;
  isPlaying = true;

  document.getElementById("mini-player").classList.remove("hidden");
  document.getElementById("mini-art").src = track.artwork || "";
  document.getElementById("mini-title").textContent = track.title;
  document.getElementById("mini-artist").textContent = track.artist;
  document.getElementById("mini-source").className = "source-dot " + track.source;

  document.getElementById("player-art").src = track.artwork || "";
  document.getElementById("player-title").textContent = track.title;
  document.getElementById("player-artist").textContent = track.artist;
  const sourceTag = document.getElementById("player-source");
  sourceTag.textContent = track.source === "spotify" ? "Spotify" : "SoundCloud";
  sourceTag.className = "source-tag " + track.source;

  updateTransportUI();
  buildTapeCounter();
}

function updateTransportUI() {
  document.getElementById("btn-playpause").textContent = isPlaying ? "⏸" : "▶";
}

function togglePlayPause() {
  // Тепер усередині застосунку реально грає тільки SoundCloud —
  // Spotify-треки відкриваються в самому Spotify.
  if (currentTrack.source === "soundcloud" && scWidget) {
    isPlaying ? scWidget.pause() : scWidget.play();
  }
}

const TAPE_TICK_COUNT = 40;

function buildTapeCounter() {
  const el = document.getElementById("tape-counter");
  el.innerHTML = "";
  for (let i = 0; i < TAPE_TICK_COUNT; i++) {
    const tick = document.createElement("div");
    tick.className = "tick";
    el.appendChild(tick);
  }
}

function updateTapeCounter(positionMs, durationMs) {
  if (!durationMs) return;
  const ratio = Math.min(positionMs / durationMs, 1);
  const filledCount = Math.round(ratio * TAPE_TICK_COUNT);
  const ticks = document.querySelectorAll("#tape-counter .tick");
  ticks.forEach((tick, i) => tick.classList.toggle("filled", i < filledCount));
  document.getElementById("time-current").textContent = formatTime(positionMs);
  document.getElementById("time-total").textContent = formatTime(durationMs);
}

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes + ":" + String(seconds).padStart(2, "0");
}


// ---------------------------------------------------------------------
// РОЗДІЛ 9. Перемикання вкладок і повноекранного плеєра
// ---------------------------------------------------------------------

function showTab(name) {
  document.getElementById("tab-search").classList.toggle("hidden", name !== "search");
  document.getElementById("tab-library").classList.toggle("hidden", name !== "library");
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });
}

function openFullPlayer() {
  document.getElementById("screen-player").classList.remove("hidden");
}
function closeFullPlayer() {
  document.getElementById("screen-player").classList.add("hidden");
}


// ---------------------------------------------------------------------
// РОЗДІЛ 10. Запуск застосунку
// ---------------------------------------------------------------------

async function init() {
  const cameFromSpotifyRedirect = await handleSpotifyRedirect();

  if (isLoggedIn()) {
    document.getElementById("screen-login").classList.add("hidden");
    document.getElementById("screen-app").classList.remove("hidden");
    renderLibrary();
  }

  document.getElementById("btn-login-spotify").addEventListener("click", startSpotifyLogin);
  document.getElementById("btn-logout").addEventListener("click", logout);

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });

  document.getElementById("search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    searchSpotify(document.getElementById("search-input").value.trim());
  });

  document.getElementById("soundcloud-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("soundcloud-input");
    const url = input.value.trim();
    if (!url) return;
    try {
      await addSoundCloudByUrl(url);
      input.value = "";
    } catch (err) {
      alert("Не вдалося додати цей трек. Перевір посилання.");
    }
  });

  document.getElementById("mini-player").addEventListener("click", openFullPlayer);
  document.getElementById("btn-collapse-player").addEventListener("click", closeFullPlayer);
  document.getElementById("btn-playpause").addEventListener("click", togglePlayPause);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

init();

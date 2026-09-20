// Мінімальний service worker: кешує "оболонку" застосунку,
// щоб іконка на телефоні відкривала застосунок навіть при слабкому інтернеті.
// Сама музика (Spotify/SoundCloud) все одно вимагає активного зʼєднання.

const CACHE_NAME = "kotushka-shell-v1";
const SHELL_FILES = [
  "./index.html",
  "./style.css",
  "./app.js",
  "./config.js",
  "./manifest.json",
  "./icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Кешуємо тільки власні файли застосунку — Spotify/SoundCloud запити
  // не чіпаємо, вони мають ходити в мережу напряму.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
});

// Service worker: menyimpan "cangkang" aplikasi (HTML/CSS/JS) agar terbuka cepat & bisa
// di-install. Request ke API/audio (domain lain) tidak disentuh — selalu langsung ke jaringan.
const VERSION = 'pm-v3';
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/player.js',
  'js/store.js',
  'js/sources/audius.js',
  'js/sources/local.js',
  'js/sources/ytmusic.js',
  'icons/icon.svg',
  'manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network-first untuk file aplikasi: selalu dapat versi terbaru saat online,
// dan tetap bisa dibuka dari cache saat offline.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // API & audio dari server pribadi tidak boleh di-cache (audio memakai Range request).
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('index.html'))),
  );
});

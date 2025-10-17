/* Resibo App v3.1.4 - Service Worker */
const CACHE_VERSION = 'resibo-cache-v3.1.4';
const CORE = [
  './',
  './index.html',
  './style.css?v=3.1.4',
  './app.js?v=3.1.4',
  './manifest.json?v=3.1.4',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './libs/jszip.min.js',
  './libs/FileSaver.min.js',
  './libs/pdf.min.js',
  './libs/tesseract.min.js'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(CORE)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        if (req.destination === 'document') {
          const cachedIndex = await cache.match('./index.html');
          if (cachedIndex) return cachedIndex;
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
  }
});

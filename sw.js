/* Resibo App SW — v3.6.1 (Canvas build) */
const CACHE_VERSION = 'resibo-v3.6.1';
const CORE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './libs/jszip.min.js',
  './libs/FileSaver.min.js',
  './libs/pdf.min.js',
  './libs/pdf.worker.min.js',
  './libs/tesseract.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_VERSION).then(c => c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  e.respondWith(
    caches.match(request).then(res => res || fetch(request).then(r => {
      const copy = r.clone();
      caches.open(CACHE_VERSION).then(c => c.put(request, copy)).catch(()=>{});
      return r;
    }).catch(()=>caches.match('./')))
  );
});

// Resibo App SW v3.1.6
const CACHE_VERSION = 'resibo-cache-v3.1.6';
const CORE = [
  './',
  './index.html?v=3.1.6',
  './style.css?v=3.1.6',
  './app.js?v=3.1.6',
  './manifest.json?v=3.1.6',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './libs/jszip.min.js',
  './libs/FileSaver.min.js',
  './libs/pdf.min.js',
  './libs/pdf.worker.min.js',
  './libs/tesseract.min.js',
  './libs/opencv.js'
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE_VERSION).then(c=>c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', e=>{
  e.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE_VERSION).map(k=>caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);
  if (url.origin === location.origin) {
    e.respondWith(caches.match(e.request).then(r=> r || fetch(e.request)));
  } else {
    // network-first for externals
    e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
  }
});

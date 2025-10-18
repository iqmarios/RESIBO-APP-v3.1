const CACHE_VERSION = 'resibo-3.6.1';
const CORE = [
  '/', 'index.html?v=3.6.1', 'style.css?v=3.6.1', 'app.js?v=3.6.1a',
  'libs/jszip.min.js', 'libs/FileSaver.min.js',
  'libs/pdf.min.js', 'libs/pdf.worker.min.js',
  'libs/tesseract.min.js', 'libs/opencv.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'manifest.json?v=3.6.1'
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE_VERSION).then(c=>c.addAll(CORE)));
  self.skipWaiting();
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_VERSION).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e=>{
  const {request} = e;
  if (request.method !== 'GET') return;
  e.respondWith(
    caches.match(request).then(hit=> hit ||
      fetch(request).then(res=>{
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(c=>c.put(request, copy)).catch(()=>{});
        return res;
      }).catch(()=>hit)
    )
  );
});
self.addEventListener('message', (e)=>{
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

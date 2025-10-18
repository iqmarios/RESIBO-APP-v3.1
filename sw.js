/* Resibo Service Worker — v3.6.1 */
const CACHE_VERSION = 'resibo-cache-v3.6.1';
const CORE = [
  '/', '/index.html?v=3.6.1', '/style.css?v=3.6.1', '/app.js?v=3.6.1',
  '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png',
  '/libs/jszip.min.js','/libs/FileSaver.min.js','/libs/pdf.min.js','/libs/pdf.worker.min.js','/libs/tesseract.min.js','/libs/opencv.js'
];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE_VERSION).then(c=>c.addAll(CORE)))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE_VERSION).map(k=>caches.delete(k))))).then(()=>self.clients.claim())});
function isCSV(u){return u.includes('output=csv')||u.endsWith('.csv')||u.includes('/pub')&&u.includes('single=true')}
async function cacheFirst(req){const c=await caches.open(CACHE_VERSION);const m=await c.match(req);if(m)return m;try{const r=await fetch(req);if(req.method==='GET'&&r&&r.status===200)c.put(req,r.clone());return r}catch{return new Response('Offline',{status:503})}}
async function networkFirst(req){const c=await caches.open(CACHE_VERSION);try{const r=await fetch(req,{cache:'no-store'});if(req.method==='GET'&&r&&r.status===200)c.put(req,r.clone());return r}catch{const m=await c.match(req);return m||new Response('Offline',{status:503})}}
self.addEventListener('fetch',(e)=>{const u=new URL(e.request.url);if(e.request.method!=='GET')return;
  const isCore = CORE.some(p=>u.pathname===p || (p.startsWith('/') && (u.pathname+u.search)===p));
  if(isCore) return e.respondWith(cacheFirst(e.request));
  if(isCSV(u.href)) return e.respondWith(networkFirst(e.request));
  if(/\.(png|jpg|jpeg|webp|gif|bmp|svg|pdf)$/i.test(u.pathname)) return e.respondWith(cacheFirst(e.request));
  if(u.origin===self.location.origin && /\.(js|css)$/.test(u.pathname)) return e.respondWith(cacheFirst(e.request));
  if(e.request.mode==='navigate'){return e.respondWith((async()=>{const c=await caches.open(CACHE_VERSION);const m=await c.match('/index.html?v=3.6.1');try{const r=await fetch(e.request);return r.ok?r:(m||r)}catch{return m||new Response('<h1>Offline</h1>',{headers:{'Content-Type':'text/html'}})} })())}
  return e.respondWith(cacheFirst(e.request));
});
self.addEventListener('message',e=>{if(e.data&&e.data.type==='SKIP_WAITING')self.skipWaiting()});

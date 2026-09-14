const CACHE_NAME='swifttill-v44-offline-auth-operational-safety';
const CORE=['/','/index.html','/assets/css/styles.css?v=44','/assets/js/app.js?v=44','/manifest.webmanifest?v=44','/assets/img/icon-192.png?v=44','/assets/img/icon-512.png?v=44','/favicon.ico?v=44'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(req).then(res=>{ const copy=res.clone(); caches.open(CACHE_NAME).then(c=>c.put(req,copy)).catch(()=>{}); return res; }).catch(()=>caches.match(req).then(cached=>cached||caches.match('/index.html'))));
});

// sw.js — simple runtime caching
const CACHE = 'smoking-pwa-v1';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(APP_SHELL)));
});

self.addEventListener('activate', e=>{
  e.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);
  // CSVはできるだけ新鮮に（Network-first）
  if(url.pathname.endsWith('stores.csv') || url.pathname.endsWith('data/stores.csv') || url.pathname.endsWith('docs/stores.csv')){
    e.respondWith((async()=>{
      try{
        const net = await fetch(e.request);
        const cache = await caches.open(CACHE);
        cache.put(e.request, net.clone());
        return net;
      }catch(_){
        const cache = await caches.open(CACHE);
        const res = await cache.match(e.request);
        return res || new Response('name,category,smoking,address,mapUrl\n', {headers:{'Content-Type':'text/csv'}});
      }
    })());
    return;
  }

  // それ以外はCache-first
  e.respondWith((async()=>{
    const cache = await caches.open(CACHE);
    const hit = await cache.match(e.request);
    if(hit) return hit;
    try{
      const net = await fetch(e.request);
      if(e.request.method==='GET' && net.ok){
        cache.put(e.request, net.clone());
      }
      return net;
    }catch(_){
      // 簡易フォールバック：トップ返す
      return cache.match('./index.html');
    }
  })());
});

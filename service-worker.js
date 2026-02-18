// Simple service worker (cache-first)
const CACHE_NAME = 'erp-lite-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './firebase.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event)=>{
  event.waitUntil((async ()=>{
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event)=>{
  event.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k===CACHE_NAME)?null:caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (event)=>{
  const req = event.request;
  event.respondWith((async ()=>{
    const cached = await caches.match(req);
    if(cached) return cached;
    try{
      const fresh = await fetch(req);
      return fresh;
    }catch(e){
      return caches.match('./index.html');
    }
  })());
});

/* Service worker för Jugz.
   Höj VERSION när skalet ändras – gammal cache städas bort vid activate. */
const VERSION='v1';
const SHELL='jugz-shell-'+VERSION;
const RUNTIME='jugz-runtime-'+VERSION;

/* Relativa URL:er löses mot sw.js placering, så detta fungerar även
   under en underkatalog (t.ex. GitHub Pages /Jugz/). */
const SHELL_FILES=[
  './',
  './index.html',
  './levels.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

const FONT_HOSTS=['fonts.googleapis.com','fonts.gstatic.com'];

self.addEventListener('install',e=>{
  /* Ingen skipWaiting: en ny version tar över först när alla flikar stängts,
     så inget skal byts ut mitt i ett pågående parti. */
  e.waitUntil(caches.open(SHELL).then(c=>c.addAll(SHELL_FILES)));
});

self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    const keep=new Set([SHELL,RUNTIME]);
    for(const k of await caches.keys())if(!keep.has(k))await caches.delete(k);
    await self.clients.claim();
  })());
});

async function cacheFirst(req,cacheName){
  const cache=await caches.open(cacheName);
  const hit=await cache.match(req,{ignoreSearch:false});
  if(hit)return hit;
  const res=await fetch(req);
  if(res&&(res.ok||res.type==='opaque'))cache.put(req,res.clone());
  return res;
}

async function staleWhileRevalidate(req){
  const cache=await caches.open(RUNTIME);
  const hit=await cache.match(req);
  const net=fetch(req).then(res=>{
    if(res&&(res.ok||res.type==='opaque'))cache.put(req,res.clone());
    return res;
  }).catch(()=>null);
  return hit||net.then(r=>r||Response.error());
}

self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);

  /* Navigeringar serveras från skalet så att spelet startar offline. */
  if(req.mode==='navigate'){
    e.respondWith((async()=>{
      const cache=await caches.open(SHELL);
      return (await cache.match('./index.html'))||fetch(req);
    })());
    return;
  }

  if(FONT_HOSTS.includes(url.hostname)){
    e.respondWith(staleWhileRevalidate(req));
    return;
  }

  if(url.origin===self.location.origin){
    e.respondWith(cacheFirst(req,SHELL).catch(()=>caches.match(req)));
  }
});

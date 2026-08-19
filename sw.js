/* Service worker for Jugz.

   Update model: the navigation races a short clock, the rest of the shell is
   served from cache immediately and refetched in the background. A new
   release therefore reaches the user without anyone having to remember
   anything - VERSION below remains as an emergency brake for throwing away
   the whole cache, not as the update mechanism. */
const VERSION='v3';
const SHELL='jugz-shell-'+VERSION;
const RUNTIME='jugz-runtime-'+VERSION;

/* Relative URLs resolve against the location of sw.js, so this works under
   a subdirectory too (e.g. GitHub Pages /Jugz/). */
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
  e.waitUntil(caches.open(SHELL).then(c=>c.addAll(SHELL_FILES)));
});

self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    const keep=new Set([SHELL,RUNTIME]);
    for(const k of await caches.keys())if(!keep.has(k))await caches.delete(k);
    await self.clients.claim();
  })());
});

/* The page asks for the takeover once the user has clicked "Reload". */
self.addEventListener('message',e=>{
  if(e.data&&e.data.type==='SKIP_WAITING')self.skipWaiting();
});

/* cache:'no-cache' bypasses the browser HTTP cache (Pages sets max-age=600)
   so revalidation always asks the server. Unchanged files answer 304. */
function revalidate(cache,key,url){
  return fetch(url,{cache:'no-cache'}).then(res=>{
    if(res&&res.ok)cache.put(key,res.clone());
    return res;
  }).catch(()=>null);
}

/* Navigations: a race between the network and NAV_TIMEOUT.
   If the network wins, the visitor gets the new build right away instead of
   on the next load. If the clock wins, the shell is served from cache just
   as before, so a broken or slow network is never worse than cache plus the
   clock. Plain network-first would be wrong here: fetch can hang for a long
   time before giving up, and the game would stall despite everything being
   cached. */
const NAV_TIMEOUT=2000;

async function navigation(e){
  const cache=await caches.open(SHELL);
  const hit=await cache.match('./index.html');
  const net=revalidate(cache,'./index.html','./index.html');
  if(!hit)return (await net)||Response.error();
  /* Known to be offline: do not wait out the clock on a request that will
     fail anyway. Without this, every offline launch cost the full
     NAV_TIMEOUT - measured at a good 2 s against a dead server. */
  if(self.navigator.onLine===false){e.waitUntil(net);return hit;}
  const first=await Promise.race([net,new Promise(r=>setTimeout(()=>r(null),NAV_TIMEOUT))]);
  if(first&&first.ok)return first;
  e.waitUntil(net);   /* let the fetch finish and update the cache */
  return hit;
}

async function shellFirst(e,key,url){
  const cache=await caches.open(SHELL);
  const hit=await cache.match(key);
  const net=revalidate(cache,key,url);
  if(hit){e.waitUntil(net);return hit;}          /* cached now, fresh next time */
  return (await net)||Response.error();
}

/* The fonts are fetched once and never revalidated. The css2 response names
   content-versioned woff2 URLs, and that pair keeps working indefinitely.
   An earlier version background-fetched them on every launch despite a
   comment claiming the opposite - 562 B and two requests per load for
   nothing. */
async function fontCache(req){
  const cache=await caches.open(RUNTIME);
  const hit=await cache.match(req);
  if(hit)return hit;
  const res=await fetch(req).catch(()=>null);
  if(res&&(res.ok||res.type==='opaque'))cache.put(req,res.clone());
  return res||Response.error();
}

self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);

  /* Navigations are served from the shell so the game starts offline. */
  if(req.mode==='navigate'){
    e.respondWith(navigation(e));
    return;
  }
  if(FONT_HOSTS.includes(url.hostname)){
    e.respondWith(fontCache(req));
    return;
  }
  if(url.origin===self.location.origin){
    e.respondWith(shellFirst(e,req,req.url));
  }
});

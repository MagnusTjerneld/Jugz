/* Service worker för Jugz.

   Uppdateringsmodell: allt i skalet serveras cachat direkt och hämtas om i
   bakgrunden (stale-while-revalidate). En ny release når därför användaren
   utan att någon behöver komma ihåg något – VERSION nedan finns kvar som
   nödbroms för att slänga hela cachen, inte som uppdateringsmekanism. */
const VERSION='v3';
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
  e.waitUntil(caches.open(SHELL).then(c=>c.addAll(SHELL_FILES)));
});

self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    const keep=new Set([SHELL,RUNTIME]);
    for(const k of await caches.keys())if(!keep.has(k))await caches.delete(k);
    await self.clients.claim();
  })());
});

/* Sidan begär övertagandet när användaren klickat "Ladda om". */
self.addEventListener('message',e=>{
  if(e.data&&e.data.type==='SKIP_WAITING')self.skipWaiting();
});

/* cache:'no-cache' kringgår webbläsarens HTTP-cache (Pages sätter max-age=600)
   så revalideringen alltid frågar servern. Oförändrade filer svarar 304. */
function revalidate(cache,key,url){
  return fetch(url,{cache:'no-cache'}).then(res=>{
    if(res&&res.ok)cache.put(key,res.clone());
    return res;
  }).catch(()=>null);
}

async function shellFirst(e,key,url){
  const cache=await caches.open(SHELL);
  const hit=await cache.match(key);
  const net=revalidate(cache,key,url);
  if(hit){e.waitUntil(net);return hit;}          /* cachat nu, färskt nästa gång */
  return (await net)||Response.error();
}

/* Typsnitten ligger på oföränderliga, versionerade URL:er – ingen revalidering. */
async function fontCache(e,req){
  const cache=await caches.open(RUNTIME);
  const hit=await cache.match(req);
  const net=fetch(req).then(res=>{
    if(res&&(res.ok||res.type==='opaque'))cache.put(req,res.clone());
    return res;
  }).catch(()=>null);
  if(hit){e.waitUntil(net);return hit;}
  return (await net)||Response.error();
}

self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);

  /* Navigeringar serveras från skalet så att spelet startar offline. */
  if(req.mode==='navigate'){
    e.respondWith(shellFirst(e,'./index.html','./index.html'));
    return;
  }
  if(FONT_HOSTS.includes(url.hostname)){
    e.respondWith(fontCache(e,req));
    return;
  }
  if(url.origin===self.location.origin){
    e.respondWith(shellFirst(e,req,req.url));
  }
});

/* Service worker för Jugz.

   Uppdateringsmodell: navigeringen kapplöper mot en kort klocka, resten av
   skalet serveras cachat direkt och hämtas om i bakgrunden. En ny release
   når därför användaren utan att någon behöver komma ihåg något – VERSION
   nedan finns kvar som nödbroms för att slänga hela cachen, inte som
   uppdateringsmekanism. */
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

/* Navigeringar: kapplöpning mellan nätverket och NAV_TIMEOUT.
   Vinner nätverket får besökaren nya bygget direkt i stället för vid nästa
   laddning. Vinner klockan serveras skalet ur cachen precis som förut, så
   ett trasigt eller långsamt nät aldrig blir värre än cachat plus klockan.
   Ren network-first vore fel här: fetch kan hänga länge innan den ger upp,
   och då stod spelet still trots att allt låg cachat. */
const NAV_TIMEOUT=2000;

async function navigation(e){
  const cache=await caches.open(SHELL);
  const hit=await cache.match('./index.html');
  const net=revalidate(cache,'./index.html','./index.html');
  if(!hit)return (await net)||Response.error();
  /* Känt offline: vänta inte ut klockan på ett anrop som ändå misslyckas.
     Utan detta kostade varje offline-start hela NAV_TIMEOUT – mätt till
     drygt 2 s mot en död server. */
  if(self.navigator.onLine===false){e.waitUntil(net);return hit;}
  const first=await Promise.race([net,new Promise(r=>setTimeout(()=>r(null),NAV_TIMEOUT))]);
  if(first&&first.ok)return first;
  e.waitUntil(net);   /* låt hämtningen gå klart och uppdatera cachen */
  return hit;
}

async function shellFirst(e,key,url){
  const cache=await caches.open(SHELL);
  const hit=await cache.match(key);
  const net=revalidate(cache,key,url);
  if(hit){e.waitUntil(net);return hit;}          /* cachat nu, färskt nästa gång */
  return (await net)||Response.error();
}

/* Typsnitten hämtas en gång och revalideras aldrig. css2-svaret pekar ut
   versionerade woff2-URL:er, och det paret fungerar ihop hur länge som helst.
   Tidigare bakgrundshämtades de vid varje start trots kommentaren om
   motsatsen – 562 B och två anrop per laddning till ingen nytta. */
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

  /* Navigeringar serveras från skalet så att spelet startar offline. */
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

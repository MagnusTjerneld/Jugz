/* Smoke test against the published site. Run: node smoke.js [base-url]
   First waits for the deploy to catch up, then checks that the right files
   are served and that the development files are not. Exits 1 on failure. */
const fs=require('fs'),path=require('path');

const BASE=(process.argv[2]||'https://magnustjerneld.github.io/Jugz').replace(/\/$/,'');
const ATTEMPTS=Number(process.env.SMOKE_RETRIES||12);
const DELAY=Number(process.env.SMOKE_DELAY_MS||15000);

let fails=0,checks=0;
const ok=n=>{checks++;console.log('  ok    '+n)};
const bad=(n,d)=>{checks++;fails++;console.log('  FAIL  '+n+(d?'\n         '+d:''))};
const assert=(c,n,d)=>c?ok(n):bad(n,d);
const norm=s=>s.replace(/\r\n/g,'\n');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function get(route){
  const url=BASE+route;
  try{
    const r=await fetch(url,{redirect:'follow'});
    return {status:r.status,type:r.headers.get('content-type')||'',
            text:r.status===200?await r.text():'',url};
  }catch(e){return {status:0,type:'',text:'',url,error:e.message}}
}

/* The deploy is done when the site's files are identical to those in this
   commit. Jekyll copies files without front matter unchanged, so the bytes
   should match.

   Every published text file is compared, not just index.html: a release
   touching only sw.js would otherwise report green against an old deploy. */
const DEPLOYED=['/index.html','/sw.js','/manifest.webmanifest','/levels.js'];

async function waitForDeploy(){
  for(let i=1;i<=ATTEMPTS;i++){
    const mismatched=[];
    for(const route of DEPLOYED){
      const local=norm(fs.readFileSync(path.join(__dirname,route.slice(1)),'utf8'));
      const r=await get(route);
      if(r.status!==200)mismatched.push(route+' (status '+r.status+')');
      else if(norm(r.text)!==local)mismatched.push(route+' (content differs)');
    }
    if(!mismatched.length){
      console.log('The deploy matches this commit (attempt '+i+')');
      return true;
    }
    console.log('Waiting for the deploy ('+i+'/'+ATTEMPTS+'): '+mismatched.join(', '));
    if(i<ATTEMPTS)await sleep(DELAY);
  }
  return false;
}

(async()=>{
  console.log('Smoke test against '+BASE+'\n');
  if(!await waitForDeploy()){
    console.log('\nThe deploy never caught up. Either Pages has not built yet,\n'+
                'or something other than this commit is being published.');
    process.exit(1);
  }

  console.log('\nThe game');
  {
    const r=await get('/');
    assert(r.status===200,'/ answers 200','status '+r.status);
    assert(/text\/html/.test(r.type),'/ is served as HTML','content-type: '+r.type);
    assert(r.text.includes('>Pours<'),'the "Pours" label is present',
      'the site is running an older version');
    assert(r.text.includes('serviceWorker'),'the service worker is registered');
  }

  console.log('\nPWA');
  for(const [route,pattern] of [
    ['/sw.js',/NAV_TIMEOUT/],
    ['/manifest.webmanifest',/"icons"/],
  ]){
    const r=await get(route);
    assert(r.status===200,route+' answers 200','status '+r.status);
    assert(pattern.test(r.text),route+' has the expected content');
  }
  {
    const r=await get('/manifest.webmanifest');
    try{
      const mf=JSON.parse(r.text);
      assert(mf.icons.length>=3,'the manifest lists the icons');
      assert(mf.start_url==='./','the manifest start_url is relative');
    }catch(e){bad('the manifest is valid JSON',e.message)}
  }

  console.log('\nImages');
  for(const route of ['/og-image.png','/icons/icon-192.png','/icons/icon-512.png',
                      '/icons/icon-maskable-512.png','/icons/apple-touch-icon.png',
                      '/icons/favicon-32.png']){
    const r=await get(route);
    assert(r.status===200&&/image\/png/.test(r.type),route+' is served as PNG',
      'status '+r.status+', type '+r.type);
  }

  console.log('\nDevelopment files should not be published');
  for(const route of ['/CLAUDE.md','/generate-levels.js','/generate-icons.js',
                      '/check.js','/smoke.js','/_config.yml']){
    const r=await get(route);
    assert(r.status===404,route+' is not published','got status '+r.status);
  }

  console.log('\n'+checks+' checks, '+fails+' failures');
  process.exit(fails?1:0);
})();

/* Rökttest mot den publicerade sajten. Kör: node smoke.js [bas-url]
   Väntar först in att deployen hunnit ikapp, kontrollerar sedan att rätt
   filer serveras och att utvecklingsfilerna inte gör det. Kod 1 vid fel. */
const fs=require('fs'),path=require('path');

const BAS=(process.argv[2]||'https://magnustjerneld.github.io/Jugz').replace(/\/$/,'');
const FÖRSÖK=Number(process.env.SMOKE_RETRIES||12);
const PAUS=Number(process.env.SMOKE_DELAY_MS||15000);

let fails=0,checks=0;
const ok=n=>{checks++;console.log('  ok   '+n)};
const bad=(n,d)=>{checks++;fails++;console.log('  FEL  '+n+(d?'\n         '+d:''))};
const assert=(c,n,d)=>c?ok(n):bad(n,d);
const norm=s=>s.replace(/\r\n/g,'\n');
const sov=ms=>new Promise(r=>setTimeout(r,ms));

async function hämta(sökväg){
  const url=BAS+sökväg;
  try{
    const r=await fetch(url,{redirect:'follow'});
    return {status:r.status,typ:r.headers.get('content-type')||'',
            text:r.status===200?await r.text():'',url};
  }catch(e){return {status:0,typ:'',text:'',url,fel:e.message}}
}

/* Deployen är klar när sajtens filer är identiska med dem i denna commit.
   Jekyll kopierar filer utan front matter oförändrade, så bytena ska matcha.

   Alla publicerade textfiler jämförs, inte bara index.html: en release som
   bara rör sw.js hade annars gett grönt mot en gammal deploy. */
const DEPLOYADE=['/index.html','/sw.js','/manifest.webmanifest','/levels.js'];

async function väntaPåDeploy(){
  for(let i=1;i<=FÖRSÖK;i++){
    const avvikande=[];
    for(const sökväg of DEPLOYADE){
      const lokal=norm(fs.readFileSync(path.join(__dirname,sökväg.slice(1)),'utf8'));
      const r=await hämta(sökväg);
      if(r.status!==200)avvikande.push(sökväg+' (status '+r.status+')');
      else if(norm(r.text)!==lokal)avvikande.push(sökväg+' (innehållet skiljer sig)');
    }
    if(!avvikande.length){
      console.log('Deployen matchar denna commit (försök '+i+')');
      return true;
    }
    console.log('Väntar på deploy ('+i+'/'+FÖRSÖK+'): '+avvikande.join(', '));
    if(i<FÖRSÖK)await sov(PAUS);
  }
  return false;
}

(async()=>{
  console.log('Rökttest mot '+BAS+'\n');
  if(!await väntaPåDeploy()){
    console.log('\nDeployen kom aldrig ikapp. Antingen har Pages inte byggt än,\n'+
                'eller så publiceras något annat än denna commit.');
    process.exit(1);
  }

  console.log('\nSpelet');
  {
    const r=await hämta('/');
    assert(r.status===200,'/ svarar 200','status '+r.status);
    assert(/text\/html/.test(r.typ),'/ serveras som HTML','content-type: '+r.typ);
    assert(r.text.includes('Hällningar'),'rubriken "Hällningar" finns',
      'sajten kör en äldre version');
    assert(r.text.includes('serviceWorker'),'servicearbetaren registreras');
  }

  console.log('\nPWA');
  for(const [sökväg,mönster] of [
    ['/sw.js',/NAV_TIMEOUT/],
    ['/manifest.webmanifest',/"icons"/],
  ]){
    const r=await hämta(sökväg);
    assert(r.status===200,sökväg+' svarar 200','status '+r.status);
    assert(mönster.test(r.text),sökväg+' har förväntat innehåll');
  }
  {
    const r=await hämta('/manifest.webmanifest');
    try{
      const mf=JSON.parse(r.text);
      assert(mf.icons.length>=3,'manifestet listar ikonerna');
      assert(mf.start_url==='./','manifestets start_url är relativ');
    }catch(e){bad('manifestet är giltig JSON',e.message)}
  }

  console.log('\nBilder');
  for(const sökväg of ['/og-image.png','/icons/icon-192.png','/icons/icon-512.png',
                       '/icons/icon-maskable-512.png','/icons/apple-touch-icon.png',
                       '/icons/favicon-32.png']){
    const r=await hämta(sökväg);
    assert(r.status===200&&/image\/png/.test(r.typ),sökväg+' serveras som PNG',
      'status '+r.status+', typ '+r.typ);
  }

  console.log('\nUtvecklingsfiler ska inte publiceras');
  for(const sökväg of ['/CLAUDE.md','/generate-levels.js','/generate-icons.js',
                       '/check.js','/smoke.js','/_config.yml']){
    const r=await hämta(sökväg);
    assert(r.status===404,sökväg+' är inte publicerad','fick status '+r.status);
  }

  console.log('\n'+checks+' kontroller, '+fails+' fel');
  process.exit(fails?1:0);
})();

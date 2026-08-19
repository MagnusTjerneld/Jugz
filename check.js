/* Beroendefria kontroller för Jugz. Kör: node check.js
   Fångar det som går att avgöra utan webbläsare. Avslutar med kod 1 vid fel. */
const fs=require('fs'),path=require('path'),vm=require('vm'),os=require('os');
const {execFileSync}=require('child_process');

const ROOT=__dirname;
let fails=0,checks=0;
const ok=name=>{checks++;console.log('  ok   '+name)};
const bad=(name,detalj)=>{checks++;fails++;console.log('  FEL  '+name+(detalj?'\n         '+detalj:''))};
const assert=(cond,name,detalj)=>cond?ok(name):bad(name,detalj);
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const group=t=>console.log('\n'+t);

/* ---------- Syntax ---------- */
group('Syntax');
for(const f of fs.readdirSync(ROOT).filter(f=>f.endsWith('.js'))){
  try{new vm.Script(read(f),{filename:f});ok(f)}
  catch(e){bad(f,e.message)}
}
/* Inbäddad JS i index.html – ett syntaxfel där gör sidan helt död. */
{
  const html=read('index.html');
  const blocks=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  assert(blocks.length>0,'index.html innehåller inbäddad JS');
  blocks.forEach((m,i)=>{
    try{new vm.Script(m[1],{filename:'index.html#script'+i});ok('index.html inbäddad JS #'+i)}
    catch(e){bad('index.html inbäddad JS #'+i,e.message)}
  });
}

/* ---------- Generatorerna är deterministiska ----------
   Körs i en temporär katalog: generatorerna läser inga filer, bara skriver.
   Skiljer sig utfallet från det incheckade har någon handredigerat. */
group('Generatorer (kör om och jämför byte för byte)');
{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'jugz-check-'));
  try{
    for(const gen of ['generate-levels.js','generate-icons.js'])
      execFileSync(process.execPath,[path.join(ROOT,gen)],{cwd:tmp,stdio:'pipe'});
    const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>
      e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
    for(const producerad of walk(tmp)){
      const namn=path.relative(tmp,producerad).replace(/\\/g,'/');
      const incheckad=path.join(ROOT,namn);
      if(!fs.existsSync(incheckad)){bad(namn+' saknas i repot','generatorn producerar den');continue}
      /* Textfiler jämförs med normaliserade radslut: git kan checka ut CRLF
         på Windows medan generatorn alltid skriver LF. Binärer jämförs exakt. */
      const a=fs.readFileSync(producerad),b=fs.readFileSync(incheckad);
      const text=/\.(js|json|webmanifest|html|yml|md)$/.test(namn);
      const radslut=/\r\n/g;
      const lika=text
        ? a.toString('utf8').replace(radslut,'\n')===b.toString('utf8').replace(radslut,'\n')
        : a.equals(b);
      assert(lika,namn+' matchar generatorn',
        'incheckad fil skiljer sig – kör om generatorn och checka in resultatet');
    }
  }catch(e){bad('generatorerna kunde köras',e.message)}
  finally{fs.rmSync(tmp,{recursive:true,force:true})}
}

/* ---------- Nivåerna ----------
   Oberoende bredden-först-sökning: nås målet på exakt opt drag? */
group('Nivåer');
{
  const LEVELS=vm.runInNewContext(read('levels.js')+';LEVELS');
  const minMoves=(caps,goal)=>{
    const start=[caps[0],0,0];
    if(start.includes(goal))return 0;
    const seen=new Set([start.join(',')]);
    let frontier=[start],d=0;
    while(frontier.length){
      d++;
      const next=[];
      for(const s of frontier)for(let i=0;i<3;i++){
        if(!s[i])continue;
        for(let j=0;j<3;j++){
          if(i===j)continue;
          const amt=Math.min(s[i],caps[j]-s[j]);
          if(amt<=0)continue;
          const n=s.slice();n[i]-=amt;n[j]+=amt;
          const k=n.join(',');
          if(seen.has(k))continue;
          seen.add(k);
          if(n.includes(goal))return d;
          next.push(n);
        }
      }
      frontier=next;
    }
    return null;
  };
  assert(LEVELS.length===150,'150 nivåer','hittade '+LEVELS.length);
  const trasiga=[];
  LEVELS.forEach((L,i)=>{
    const m=minMoves(L.caps,L.goal);
    if(m!==L.opt)trasiga.push('nivå '+(i+1)+': caps '+L.caps.join('/')+' mål '+L.goal+
      ' säger opt '+L.opt+' men lösaren fick '+m);
  });
  assert(trasiga.length===0,'alla nivåer lösbara på exakt opt',trasiga.slice(0,5).join('\n         '));
  const sedda=new Set(),dubblerade=[];
  for(const L of LEVELS){
    const k=L.caps.join('-')+':'+L.goal;
    if(sedda.has(k))dubblerade.push(k);
    sedda.add(k);
  }
  assert(dubblerade.length===0,'inga dubblerade pussel',dubblerade.join(', '));
}

/* ---------- Skalet ---------- */
group('Servicearbetarens skal');
{
  const sw=read('sw.js');
  const block=sw.match(/const SHELL_FILES=\[([\s\S]*?)\];/);
  if(!block)bad('SHELL_FILES kunde läsas ur sw.js');
  else{
    const filer=[...block[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
    assert(filer.length>0,'SHELL_FILES är ifylld');
    for(const f of filer){
      if(f==='./')continue;                      /* katalogen, inte en fil */
      assert(fs.existsSync(path.join(ROOT,f)),'SHELL_FILES: '+f+' finns',
        'precachas en fil som saknas kastar addAll och installationen misslyckas');
    }
  }
}

/* ---------- Referenser i index.html ---------- */
group('Referenser');
{
  const html=read('index.html');
  const refs=[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m=>m[1])
    .filter(u=>!/^(https?:|data:|#)/.test(u));
  assert(refs.length>0,'hittade lokala referenser');
  for(const r of new Set(refs))
    assert(fs.existsSync(path.join(ROOT,r)),'index.html refererar '+r);
}

/* ---------- Länkförhandsvisning ---------- */
group('Open Graph');
{
  const html=read('index.html');
  const tag=n=>{
    const m=html.match(new RegExp('<meta (?:property|name)="'+n+'" content="([^"]*)"'));
    return m&&m[1];
  };
  for(const n of ['og:title','og:description','og:url','og:image','twitter:card'])
    assert(!!tag(n),'taggen '+n+' finns');
  for(const n of ['og:url','og:image','twitter:image']){
    const v=tag(n)||'';
    assert(v.startsWith('https://'),n+' är absolut https',
      'relativa URL:er ger ingen förhandsvisningsbild i Teams/Slack – värdet var "'+v+'"');
  }
  const lokal=(tag('og:image')||'').split('/').pop();
  assert(!!lokal&&fs.existsSync(path.join(ROOT,lokal)),
    'og:image pekar på en fil som finns: '+lokal);
}

/* ---------- Bilder ----------
   Bredd och höjd ligger i PNG:ens IHDR, byte 16–24. */
function pngSize(p){
  const b=fs.readFileSync(p);
  if(b.length<24||b.toString('ascii',12,16)!=='IHDR')return null;
  return {w:b.readUInt32BE(16),h:b.readUInt32BE(20)};
}
group('Bilder och manifest');
{
  const og=pngSize(path.join(ROOT,'og-image.png'));
  assert(og&&og.w===1200&&og.h===630,'og-image.png är 1200x630',
    og?('är '+og.w+'x'+og.h):'kunde inte läsas som PNG');

  const mf=JSON.parse(read('manifest.webmanifest'));
  for(const icon of mf.icons){
    const f=icon.src.replace(/^\.\//,'');
    const p=path.join(ROOT,f);
    if(!fs.existsSync(p)){bad('manifest-ikon '+f+' finns');continue}
    const s=pngSize(p),[w,h]=icon.sizes.split('x').map(Number);
    assert(s&&s.w===w&&s.h===h,'manifest-ikon '+f+' är '+icon.sizes,
      s?('filen är '+s.w+'x'+s.h):'kunde inte läsas som PNG');
  }
  assert(mf.icons.some(i=>i.purpose==='maskable'),'manifestet har en maskable-ikon');
  for(const nyckel of ['name','short_name','start_url','scope','display'])
    assert(!!mf[nyckel],'manifestet har '+nyckel);
  assert(mf.start_url.startsWith('./')&&mf.scope.startsWith('./'),
    'manifestets start_url och scope är relativa',
    'sajten ligger under /Jugz/ – absoluta sökvägar bryter i produktion');
}

/* ---------- Pages-uteslutning ---------- */
group('Pages');
{
  const cfg=read('_config.yml');
  for(const f of ['CLAUDE.md','generate-levels.js','generate-icons.js','check.js','smoke.js'])
    assert(cfg.includes(f),'_config.yml utesluter '+f,
      'utvecklingsfiler ska inte publiceras på sajten');
}

console.log('\n'+checks+' kontroller, '+fails+' fel');
process.exit(fails?1:0);

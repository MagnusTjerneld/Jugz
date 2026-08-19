/* Dependency-free checks for Jugz. Run: node check.js
   Catches whatever can be decided without a browser. Exits 1 on failure. */
const fs=require('fs'),path=require('path'),vm=require('vm'),os=require('os');
const {execFileSync}=require('child_process');

const ROOT=__dirname;
let fails=0,checks=0;
const ok=name=>{checks++;console.log('  ok    '+name)};
const bad=(name,detail)=>{checks++;fails++;console.log('  FAIL  '+name+(detail?'\n         '+detail:''))};
const assert=(cond,name,detail)=>cond?ok(name):bad(name,detail);
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const group=t=>console.log('\n'+t);

/* ---------- Syntax ---------- */
group('Syntax');
for(const f of fs.readdirSync(ROOT).filter(f=>f.endsWith('.js'))){
  try{new vm.Script(read(f),{filename:f});ok(f)}
  catch(e){bad(f,e.message)}
}
/* Inline JS in index.html - a syntax error there kills the page outright. */
{
  const html=read('index.html');
  const blocks=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  assert(blocks.length>0,'index.html contains inline JS');
  blocks.forEach((m,i)=>{
    try{new vm.Script(m[1],{filename:'index.html#script'+i});ok('index.html inline JS #'+i)}
    catch(e){bad('index.html inline JS #'+i,e.message)}
  });
}

/* ---------- The generators are deterministic ----------
   Run in a temp directory: the generators read no files, they only write.
   If the output differs from what is committed, someone hand-edited it. */
group('Generators (re-run and compare byte for byte)');
{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'jugz-check-'));
  try{
    for(const gen of ['generate-levels.js','generate-icons.js'])
      execFileSync(process.execPath,[path.join(ROOT,gen)],{cwd:tmp,stdio:'pipe'});
    const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>
      e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
    for(const produced of walk(tmp)){
      const name=path.relative(tmp,produced).replace(/\\/g,'/');
      const committed=path.join(ROOT,name);
      if(!fs.existsSync(committed)){bad(name+' is missing from the repo','the generator produces it');continue}
      /* Text files are compared with normalised line endings: git may check
         out CRLF on Windows while the generator always writes LF. Binaries
         are compared exactly. */
      const a=fs.readFileSync(produced),b=fs.readFileSync(committed);
      const text=/\.(js|json|webmanifest|html|yml|md)$/.test(name);
      const eol=/\r\n/g;
      const same=text
        ? a.toString('utf8').replace(eol,'\n')===b.toString('utf8').replace(eol,'\n')
        : a.equals(b);
      assert(same,name+' matches the generator',
        'the committed file differs - re-run the generator and commit the result');
    }
  }catch(e){bad('the generators could run',e.message)}
  finally{fs.rmSync(tmp,{recursive:true,force:true})}
}

/* ---------- The levels ----------
   Independent breadth-first search: is the goal reached in exactly opt moves? */
group('Levels');
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
  assert(LEVELS.length===150,'150 levels','found '+LEVELS.length);
  const broken=[];
  LEVELS.forEach((L,i)=>{
    const m=minMoves(L.caps,L.goal);
    if(m!==L.opt)broken.push('level '+(i+1)+': caps '+L.caps.join('/')+' goal '+L.goal+
      ' claims opt '+L.opt+' but the solver got '+m);
  });
  assert(broken.length===0,'every level solvable in exactly opt',broken.slice(0,5).join('\n         '));
  const seen=new Set(),duplicates=[];
  for(const L of LEVELS){
    const k=L.caps.join('-')+':'+L.goal;
    if(seen.has(k))duplicates.push(k);
    seen.add(k);
  }
  assert(duplicates.length===0,'no duplicated puzzles',duplicates.join(', '));
}

/* ---------- The shell ---------- */
group('Service worker shell');
{
  const sw=read('sw.js');
  const block=sw.match(/const SHELL_FILES=\[([\s\S]*?)\];/);
  if(!block)bad('SHELL_FILES could be read out of sw.js');
  else{
    const files=[...block[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
    assert(files.length>0,'SHELL_FILES is populated');
    for(const f of files){
      if(f==='./')continue;                      /* the directory, not a file */
      assert(fs.existsSync(path.join(ROOT,f)),'SHELL_FILES: '+f+' exists',
        'precaching a missing file makes addAll throw and the install fail');
    }
  }
}

/* ---------- References in index.html ---------- */
group('References');
{
  const html=read('index.html');
  const refs=[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m=>m[1])
    .filter(u=>!/^(https?:|data:|#)/.test(u));
  assert(refs.length>0,'found local references');
  for(const r of new Set(refs))
    assert(fs.existsSync(path.join(ROOT,r)),'index.html references '+r);
}

/* ---------- Link previews ---------- */
group('Open Graph');
{
  const html=read('index.html');
  const tag=n=>{
    const m=html.match(new RegExp('<meta (?:property|name)="'+n+'" content="([^"]*)"'));
    return m&&m[1];
  };
  for(const n of ['og:title','og:description','og:url','og:image','twitter:card'])
    assert(!!tag(n),'the tag '+n+' exists');
  for(const n of ['og:url','og:image','twitter:image']){
    const v=tag(n)||'';
    assert(v.startsWith('https://'),n+' is absolute https',
      'relative URLs yield no preview image in Teams/Slack - the value was "'+v+'"');
  }
  const local=(tag('og:image')||'').split('/').pop();
  assert(!!local&&fs.existsSync(path.join(ROOT,local)),
    'og:image points at a file that exists: '+local);
}

/* ---------- Images ----------
   Width and height live in the PNG IHDR, bytes 16-24. */
function pngSize(p){
  const b=fs.readFileSync(p);
  if(b.length<24||b.toString('ascii',12,16)!=='IHDR')return null;
  return {w:b.readUInt32BE(16),h:b.readUInt32BE(20)};
}
group('Images and manifest');
{
  const og=pngSize(path.join(ROOT,'og-image.png'));
  assert(og&&og.w===1200&&og.h===630,'og-image.png is 1200x630',
    og?('it is '+og.w+'x'+og.h):'could not be read as a PNG');

  const mf=JSON.parse(read('manifest.webmanifest'));
  for(const icon of mf.icons){
    const f=icon.src.replace(/^\.\//,'');
    const p=path.join(ROOT,f);
    if(!fs.existsSync(p)){bad('manifest icon '+f+' exists');continue}
    const s=pngSize(p),[w,h]=icon.sizes.split('x').map(Number);
    assert(s&&s.w===w&&s.h===h,'manifest icon '+f+' is '+icon.sizes,
      s?('the file is '+s.w+'x'+s.h):'could not be read as a PNG');
  }
  assert(mf.icons.some(i=>i.purpose==='maskable'),'the manifest has a maskable icon');
  for(const key of ['name','short_name','start_url','scope','display'])
    assert(!!mf[key],'the manifest has '+key);
  assert(mf.start_url.startsWith('./')&&mf.scope.startsWith('./'),
    'the manifest start_url and scope are relative',
    'the site lives under /Jugz/ - absolute paths break in production');
}

/* ---------- Pages exclusion ---------- */
group('Pages');
{
  const cfg=read('_config.yml');
  for(const f of ['CLAUDE.md','generate-levels.js','generate-icons.js','check.js','smoke.js'])
    assert(cfg.includes(f),'_config.yml excludes '+f,
      'development files should not be published to the site');
}

console.log('\n'+checks+' checks, '+fails+' failures');
process.exit(fails?1:0);

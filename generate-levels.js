/* Nivågenerator för Kannpussel. Kör: node generate-levels.js
   Skriver levels.js med 150 statiska nivåer enligt svårighetskurva. */
const fs=require('fs');

function key(s){return s.join(',')}
function pours(caps,s){
  const out=[];
  for(let i=0;i<s.length;i++){
    if(s[i]===0)continue;
    for(let j=0;j<s.length;j++){
      if(i===j)continue;
      const amt=Math.min(s[i],caps[j]-s[j]);
      if(amt<=0)continue;
      const n=s.slice();n[i]-=amt;n[j]+=amt;
      out.push({from:i,to:j,state:n});
    }
  }
  return out;
}
function bfs(caps,start){
  const dist=new Map();dist.set(key(start),0);
  let q=[start];
  while(q.length){
    const nq=[];
    for(const s of q){
      const d=dist.get(key(s));
      for(const p of pours(caps,s)){
        const k=key(p.state);
        if(!dist.has(k)){dist.set(k,d+1);nq.push(p.state);}
      }
    }
    q=nq;
  }
  return dist;
}
function solve(caps,state,goal){
  if(state.includes(goal))return [];
  const dist=new Map();dist.set(key(state),0);
  const via=new Map();
  let q=[state];
  while(q.length){
    const nq=[];
    for(const s of q){
      for(const p of pours(caps,s)){
        const k=key(p.state);
        if(dist.has(k))continue;
        dist.set(k,dist.get(key(s))+1);
        via.set(k,{move:{from:p.from,to:p.to},pk:key(s)});
        if(p.state.includes(goal)){
          const path=[];let cur=k;
          while(via.has(cur)){const v=via.get(cur);path.unshift(v.move);cur=v.pk;}
          return path;
        }
        nq.push(p.state);
      }
    }
    q=nq;
  }
  return null;
}

/* Alla kandidater: kapaciteter a>b>c, start = största full, mål = mängd i valfri kanna */
function candidates(){
  const out=[];
  for(let a=5;a<=19;a++)for(let b=2;b<a;b++)for(let c=1;c<b;c++){
    const caps=[a,b,c];
    const dist=bfs(caps,[a,0,0]);
    const minFor=new Map();
    for(const [k,d] of dist){
      for(const v of k.split(',').map(Number)){
        if(v>0&&v<a&&(!minFor.has(v)||d<minFor.get(v)))minFor.set(v,d);
      }
    }
    for(const [g,m] of minFor)if(m>=2)out.push({caps,goal:g,opt:m});
  }
  return out;
}

/* Seedad PRNG så att banken är reproducerbar */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const SEED=20260819;
const rng=mulberry32(SEED);
function shuffle(arr){for(let i=arr.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]]}return arr}

const cands=candidates();
const byOpt=new Map();
for(const c of cands){if(!byOpt.has(c.opt))byOpt.set(c.opt,[]);byOpt.get(c.opt).push(c);}
for(const arr of byOpt.values())shuffle(arr);
console.log('Kandidater per opt:',[...byOpt.entries()].sort((a,b)=>a[0]-b[0]).map(([m,a])=>m+':'+a.length).join(' '));

/* Kurva: 15 block om 10 nivåer. Stigande baslinje, med andningshål (-) och spikar (+) i varje block. */
const base=   [2,3,4,4,5,6,6,7,8,8,9,10,11,12,12];
const offsets=[0,0,1,-1,1,0,2,-2,1,3]; /* position 8 = andningshål sent, position 10 = blockets "boss" */
const targets=[];
for(let c=0;c<base.length;c++)for(const o of offsets)targets.push(Math.max(2,Math.min(14,base[c]+o)));

const usedPuzzle=new Set();
const levels=[];
for(const t of targets){
  let picked=null;
  outer:
  for(const dt of [0,1,-1,2,-2,3,-3]){
    const m=t+dt;if(m<2)continue;
    const pool=byOpt.get(m)||[];
    for(const c of pool){
      const pk=c.caps.join('-')+':'+c.goal;
      if(usedPuzzle.has(pk))continue;
      if(levels.slice(-4).some(l=>l.caps.join('-')===c.caps.join('-')))continue;
      picked=c;usedPuzzle.add(pk);break outer;
    }
  }
  if(!picked){console.error('Slut på kandidater för opt '+t);process.exit(1);}
  levels.push(picked);
}

/* Verifiera varje nivå med oberoende lösare */
let bad=0;
for(const l of levels){
  const p=solve(l.caps,[l.caps[0],0,0],l.goal);
  if(!p||p.length!==l.opt){bad++;console.error('FEL:',JSON.stringify(l));}
}
if(bad){console.error(bad+' trasiga nivåer');process.exit(1);}

const body='/* Autogenererad av generate-levels.js (seed '+SEED+'). Redigera inte för hand. */\n'
  +'const LEVELS='+JSON.stringify(levels)+';\n';
fs.writeFileSync('levels.js',body);
console.log('Skrev levels.js med '+levels.length+' verifierade nivåer');
console.log('Kurva (opt per nivå):');
for(let c=0;c<15;c++)console.log('  Nivå '+String(c*10+1).padStart(3)+'-'+String(c*10+10).padStart(3)+':',levels.slice(c*10,c*10+10).map(l=>String(l.opt).padStart(2)).join(' '));

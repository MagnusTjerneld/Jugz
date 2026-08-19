/* Icon generator for Jugz. Run: node generate-icons.js
   Writes icons/*.png. Dependency-free: a hand-rolled PNG encoder over the
   built-in zlib. */
const fs=require('fs'),zlib=require('zlib'),path=require('path');

/* ---------- PNG encoder ---------- */
const CRCT=(()=>{const t=new Int32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c}return t})();
function crc32(buf){let c=~0;for(let i=0;i<buf.length;i++)c=CRCT[(c^buf[i])&0xFF]^(c>>>8);return ~c>>>0}
function chunk(type,data){
  const len=Buffer.alloc(4);len.writeUInt32BE(data.length,0);
  const td=Buffer.concat([Buffer.from(type,'ascii'),data]);
  const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(td),0);
  return Buffer.concat([len,td,crc]);
}
function encodePNG(w,h,rgba){
  const raw=Buffer.alloc(h*(w*4+1));
  for(let y=0;y<h;y++){
    raw[y*(w*4+1)]=0;                                   /* filter type 0 = None */
    rgba.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4);
  }
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);
  ihdr[8]=8;ihdr[9]=6;ihdr[10]=0;ihdr[11]=0;ihdr[12]=0; /* 8 bits, RGBA */
  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),
    chunk('IHDR',ihdr),
    chunk('IDAT',zlib.deflateSync(raw,{level:9})),
    chunk('IEND',Buffer.alloc(0)),
  ]);
}

/* ---------- Palette (mirrors :root in index.html) ---------- */
const NIGHT=[0x17,0x13,0x31],INDIGO=[0x24,0x1E,0x44],HORIZON=[0x4A,0x3A,0x78];
const WATER_HI=[0x6F,0xE7,0xD4],WATER_LO=[0x2F,0xB7,0xA6],FOAM=[0xD8,0xFF,0xF6];
const mix=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
function ramp(stops,t){
  t=Math.max(0,Math.min(1,t));
  for(let i=1;i<stops.length;i++){
    if(t<=stops[i][0]){
      const [p0,c0]=stops[i-1],[p1,c1]=stops[i];
      return mix(c0,c1,(t-p0)/(p1-p0||1));
    }
  }
  return stops[stops.length-1][1];
}

/* ---------- The droplet shape: circle + tangent triangle up to the tip ---------- */
function droplet(cx,cy,r,d){
  /* d = distance from the centre of the circle up to the tip */
  const L=Math.sqrt(d*d-r*r);
  const tx=r*L/d, ty=r*r/d;
  return {
    cx,cy,r,
    apex:[cx,cy-d],
    t1:[cx-tx,cy-ty],
    t2:[cx+tx,cy-ty],
  };
}
function sign(ax,ay,bx,by,px,py){return (px-bx)*(ay-by)-(ax-bx)*(py-by)}
function inside(D,x,y){
  const dx=x-D.cx,dy=y-D.cy;
  if(dx*dx+dy*dy<=D.r*D.r)return true;
  const [ax,ay]=D.apex,[b1,b2]=[D.t1,D.t2];
  const s1=sign(ax,ay,b1[0],b1[1],x,y);
  const s2=sign(b1[0],b1[1],b2[0],b2[1],x,y);
  const s3=sign(b2[0],b2[1],ax,ay,x,y);
  const neg=(s1<0)||(s2<0)||(s3<0), pos=(s1>0)||(s2>0)||(s3>0);
  return !(neg&&pos);
}

/* ---------- Rendering ---------- */
const SS=4;               /* supersampling per axis */
const D_OVER_R=0.52/0.24; /* tip height over radius, sets the droplet's proportions */

/* drops: [{cx,baseline,r}] in pixels; the droplet rests with its bottom edge
   on the baseline. bg: the gradient's centre and radii as fractions of
   width/height. */
function render(w,h,drops,bg){
  const W=w*SS,H=h*SS;
  const acc=new Float64Array(w*h*3);
  const Ds=drops.map(d=>{
    const r=d.r*SS;
    return droplet(d.cx*SS,d.baseline*SS-r,r,r*D_OVER_R);
  });
  const bgCx=W*bg.cx,bgCy=H*bg.cy,bgRx=W*bg.rx,bgRy=H*bg.ry;
  const bgStops=[[0,HORIZON],[0.45,INDIGO],[1,NIGHT]];
  const dropStops=[[0,FOAM],[1,WATER_LO]];

  for(let y=0;y<H;y++){
    for(let x=0;x<W;x++){
      const px=x+0.5,py=y+0.5;
      let c=ramp(bgStops,Math.hypot((px-bgCx)/bgRx,(py-bgCy)/bgRy));
      for(const D of Ds){
        if(!inside(D,px,py))continue;
        const top=D.apex[1],bot=D.cy+D.r;
        const dt=((py-top)/(bot-top))*0.72+((px-(D.cx-D.r))/(2*D.r))*0.28;
        c=ramp(dropStops,dt);
        const hx=D.cx-D.r*0.34,hy=D.cy-D.r*0.30;
        const g=Math.hypot((px-hx)/(D.r*0.30),(py-hy)/(D.r*0.40));
        if(g<1)c=mix(c,[255,255,255],(1-g)*(1-g)*0.55);
        break;
      }
      const o=((y/SS|0)*w+(x/SS|0))*3;
      acc[o]+=c[0];acc[o+1]+=c[1];acc[o+2]+=c[2];
    }
  }
  const n=SS*SS,out=Buffer.alloc(w*h*4);
  for(let i=0,j=0;i<w*h;i++,j+=4){
    out[j]=Math.round(acc[i*3]/n);
    out[j+1]=Math.round(acc[i*3+1]/n);
    out[j+2]=Math.round(acc[i*3+2]/n);
    out[j+3]=255;
  }
  return encodePNG(w,h,out);
}

/* Square icon: one centred droplet. Normalised radius .24, bottom edge .86;
   dropScale scales around the centre of the image. */
function icon(size,dropScale){
  const s=dropScale, r=size*0.24*s, baseline=size*(0.5+0.12*s)+r;
  return render(size,size,[{cx:size*0.5,baseline,r}],{cx:0.5,cy:-0.10,rx:1.30,ry:0.90});
}

/* Wide sharing image: three droplets in decreasing size, like the shelf of
   jugs in the game. */
function banner(w,h){
  const R=h*0.19, scales=[0.68,1.0,0.46], gap=w*0.045;
  const rs=scales.map(s=>R*s);
  const total=rs.reduce((t,r)=>t+2*r,0)+gap*(rs.length-1);
  let x=(w-total)/2;
  const drops=rs.map(r=>{const c={cx:x+r,baseline:h*0.80,r};x+=2*r+gap;return c});
  return render(w,h,drops,{cx:0.5,cy:-0.12,rx:0.72,ry:1.15});
}

/* dropScale: smaller for maskable so the droplet survives a circular mask */
const ICONS=[
  ['icons/icon-192.png',192,1.00],
  ['icons/icon-512.png',512,1.00],
  ['icons/icon-maskable-512.png',512,0.72],
  ['icons/apple-touch-icon.png',180,1.00],
  ['icons/favicon-32.png',32,1.10],
];
fs.mkdirSync('icons',{recursive:true});
for(const [file,size,scale] of ICONS){
  fs.writeFileSync(file,icon(size,scale));
  console.log('Wrote '+file+' ('+size+'x'+size+', droplet scale '+scale+')');
}
/* Open Graph / Twitter: 1200x630 is the standard link-preview format. */
fs.writeFileSync('og-image.png',banner(1200,630));
console.log('Wrote og-image.png (1200x630)');

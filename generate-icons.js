/* Ikongenerator för Jugz. Kör: node generate-icons.js
   Skriver icons/*.png. Beroendefri: egen PNG-kodare ovanpå inbyggda zlib. */
const fs=require('fs'),zlib=require('zlib'),path=require('path');

/* ---------- PNG-kodare ---------- */
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
    raw[y*(w*4+1)]=0;                                   /* filtertyp 0 = None */
    rgba.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4);
  }
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);
  ihdr[8]=8;ihdr[9]=6;ihdr[10]=0;ihdr[11]=0;ihdr[12]=0; /* 8 bitar, RGBA */
  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),
    chunk('IHDR',ihdr),
    chunk('IDAT',zlib.deflateSync(raw,{level:9})),
    chunk('IEND',Buffer.alloc(0)),
  ]);
}

/* ---------- Palett (speglar :root i index.html) ---------- */
const NATT=[0x17,0x13,0x31],INDIGO=[0x24,0x1E,0x44],HORISONT=[0x4A,0x3A,0x78];
const VATTEN_HI=[0x6F,0xE7,0xD4],VATTEN_LO=[0x2F,0xB7,0xA6],SKUM=[0xD8,0xFF,0xF6];
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

/* ---------- Droppformen: cirkel + tangenttriangel upp till spetsen ---------- */
function droplet(cx,cy,r,d){
  /* d = avstånd från cirkelns centrum upp till spetsen */
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
const SS=4; /* supersampling per axel */
function render(size,dropScale){
  const N=size*SS;
  const acc=new Float64Array(size*size*3);
  /* Normerat: radie .24, cirkelcentrum .62, spets .10 -> droppen ryms med marginal.
     dropScale skalar kring bildens mitt. */
  const s=dropScale;
  const D=droplet(N*0.5, N*(0.5+0.12*s), N*0.24*s, N*0.52*s);
  const bgCx=N*0.5,bgCy=-N*0.10,bgRx=N*1.30,bgRy=N*0.90;
  const bgStops=[[0,HORISONT],[0.45,INDIGO],[1,NATT]];
  const dropStops=[[0,SKUM],[1,VATTEN_LO]];
  const hlCx=D.cx-D.r*0.34,hlCy=D.cy-D.r*0.30,hlRx=D.r*0.30,hlRy=D.r*0.40;

  for(let y=0;y<N;y++){
    for(let x=0;x<N;x++){
      const px=x+0.5,py=y+0.5;
      const bt=Math.hypot((px-bgCx)/bgRx,(py-bgCy)/bgRy);
      let c=ramp(bgStops,bt);
      if(inside(D,px,py)){
        const top=D.apex[1],bot=D.cy+D.r;
        const dt=((py-top)/(bot-top))*0.72+((px-(D.cx-D.r))/(2*D.r))*0.28;
        c=ramp(dropStops,dt);
        const h=Math.hypot((px-hlCx)/hlRx,(py-hlCy)/hlRy);
        if(h<1)c=mix(c,[255,255,255],(1-h)*(1-h)*0.55);
      }
      const o=((y/SS|0)*size+(x/SS|0))*3;
      acc[o]+=c[0];acc[o+1]+=c[1];acc[o+2]+=c[2];
    }
  }
  const n=SS*SS,out=Buffer.alloc(size*size*4);
  for(let i=0,j=0;i<size*size;i++,j+=4){
    out[j]=Math.round(acc[i*3]/n);
    out[j+1]=Math.round(acc[i*3+1]/n);
    out[j+2]=Math.round(acc[i*3+2]/n);
    out[j+3]=255;
  }
  return encodePNG(size,size,out);
}

/* dropScale: mindre för maskable så droppen överlever en cirkulär mask */
const JOBS=[
  ['icons/icon-192.png',192,1.00],
  ['icons/icon-512.png',512,1.00],
  ['icons/icon-maskable-512.png',512,0.72],
  ['icons/apple-touch-icon.png',180,1.00],
  ['icons/favicon-32.png',32,1.10],
];
fs.mkdirSync('icons',{recursive:true});
for(const [file,size,scale] of JOBS){
  fs.writeFileSync(file,render(size,scale));
  console.log('Skrev '+file+' ('+size+'x'+size+', droppskala '+scale+')');
}

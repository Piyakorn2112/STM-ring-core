import { readFileSync, writeFileSync } from "node:fs";
const ts=(await import("typescript")).default;
const trf=(p,d)=>writeFileSync(d,ts.transpileModule(readFileSync(p,"utf8"),{compilerOptions:{module:"ESNext",target:"ES2020"}}).outputText);
trf("app/components/stmRingCore.ts","/tmp/core.mjs");
let cc=readFileSync("app/components/ringCodeCore.ts","utf8").replace('./stmRingCore','/tmp/core.mjs');
writeFileSync("/tmp/cc.ts",cc); trf("/tmp/cc.ts","/tmp/cc.mjs");
const core=await import("/tmp/core.mjs"); const RC=await import("/tmp/cc.mjs");

const N=40000; // bigger scan
function usableWith(kinds){return kinds.filter(x=>x==="data").length;}
function layout(pts, margin, nslots){
  const per=pts.px.length/nslots; const kind=new Array(nslots).fill("data");
  kind[0]="fiducial"; kind[1]="quiet"; kind[nslots-1]="quiet";
  for(const idx of RC.findSelfCrossings(pts)){const slot=Math.floor(idx/per)%nslots;
    for(let m=-margin;m<=margin;m++){const s=(slot+m+nslots)%nslots; if(kind[s]==="data") kind[s]="keepout";}}
  return usableWith(kind);
}
const cross=[]; const u={};
for(const [margin,nslots] of [[0,32],[1,32],[0,40],[0,48]]) u[`m${margin}_n${nslots}`]=[];
for(let k=0;k<N;k++){
  const hover=core.makeHover(`scan2:${k}`);
  const pts=core.centreLine(core.SETTLE_POSE.t,core.SETTLE_POSE.twistT,core.SETTLE_POSE.morph,hover,960);
  cross.push(RC.findSelfCrossings(pts).length/2); // crossings (each = 2 indices)
  for(const key of Object.keys(u)){const [,m,,n]=key.match(/m(\d+)_n(\d+)/); u[key].push(layout(pts,+key.split('_')[0].slice(1),+key.split('_')[1].slice(1)));}
}
cross.sort((a,b)=>a-b);
console.log("self-crossing count: median",cross[N/2|0],"p25",cross[N*.25|0],"min",cross[0],"max",cross[N-1]);
const hit=(arr,t)=>((arr.filter(x=>x>=t).length/N)*100);
for(const key of Object.keys(u)){const a=u[key].slice().sort((x,y)=>x-y);
  console.log(`\n${key}: usable median ${a[N/2|0]}, p90 ${a[N*.9|0]}, max ${a[N-1]}`);
  for(const t of [12,14,16,18]) {const h=hit(u[key],t); console.log(`   >=${t}: ${h.toFixed(1)}% (~${(100/Math.max(.01,h)).toFixed(0)} tries)`);}
}

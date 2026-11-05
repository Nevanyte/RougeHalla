/** P-MAP-1 M1 oracle: imports the real legacy implementations; never duplicates algorithms.
 * Run on pinned Linux x64 Node 22.23.4: node --import tsx tools/map-fixtures/foundations.ts [--check]
 * --check refuses any byte difference; generating never touches the legacy map pins.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SIMPLE, ringOffsets, nb4Offsets, walkDistances, walkField16, descentPath, segmentBlocked } from '../../packages/shared/src/gridTopology.ts';
import { enforceConnectivity, RING_OFF, NB4 } from '../../packages/shared/src/gridOps.ts';
import { fixedLayout } from '../../packages/shared/src/coliseum.ts';
import { detSin, detCos, TWO_PI } from '../../packages/shared/src/detMath.ts';
import { wrapAngle } from '../../packages/shared/src/interactions.ts';
import { mulberry32 } from '../../packages/shared/src/rng.ts';

const bits = (x: number): string => {
  const b = new ArrayBuffer(8), v = new DataView(b); v.setFloat64(0, x, false);
  return v.getBigUint64(0, false).toString(16).padStart(16, '0');
};
const rng = mulberry32(0x521a7);
const int = (n: number): number => Math.floor(rng() * n);
const grids: unknown[] = [];
function grid(name: string, w: number, h: number, tiles: Uint8Array, seeds: number[], values?: number[], scope?: Uint8Array): void {
  const field = walkField16(tiles,w,h,seeds,values,scope);
  const froms = [-1, ...Array.from({length:w*h},(_,i)=>i), w*h];
  const segments: unknown[] = [];
  // Every ordered in-grid pair, both masks; outside, axial, vertex, reversed and same-tile are included.
  for (let a=-1;a<w*h+1;a++) for (let b=-1;b<w*h+1;b++) {
    const [ax,ay] = a === -1 ? [-1,0] : a===w*h ? [w,h-1] : [a%w,Math.floor(a/w)];
    const [bx,by] = b === -1 ? [-1,0] : b===w*h ? [w,h-1] : [b%w,Math.floor(b/w)];
    for (const mask of [1,255]) segments.push([ax,ay,bx,by,mask,segmentBlocked(tiles,w,h,ax,ay,bx,by,mask)]);
  }
  grids.push({name,w,h,tiles:Array.from(tiles),seeds,values:values??null,scope:scope?Array.from(scope):null,
    distances:Array.from({length:w*h},(_,from)=>Array.from(walkDistances(tiles,w,h,from))),
    field:Array.from(field),paths:froms.map(from=>({from,path:descentPath(field,tiles,w,h,from)})),segments});
}
// All 256 neighbourhoods exercise blocked starts, corner legality, disconnected patches and descent ties.
const rdx=[0,1,1,1,0,-1,-1,-1], rdy=[-1,-1,0,1,1,1,0,-1];
for(let m=0;m<256;m++) {
  const t=new Uint8Array(9).fill(1);t[4]=0;
  for(let q=0;q<8;q++) if((m>>q)&1) t[(1+rdy[q])*3+1+rdx[q]]=0;
  grid(`ring-${m}`,3,3,t,[4]);
}
for(let k=0;k<32;k++) {
  const w=1+int(8),h=1+int(8),n=w*h;
  const t=Uint8Array.from({length:n},()=>int(5)===0?2:int(4)===0?1:0);
  const seeds=[int(n),int(n),-1,n,int(n)];
  const values=[25,0,9,5,0];
  const scope=Uint8Array.from({length:n},()=>int(4)===0?0:int(5)===0?2:1);
  grid(`random-${k}`,w,h,t,seeds,k%3===0?undefined:values,k%2===0?scope:undefined);
}
grid('empty-seeds',4,4,new Uint8Array(16),[]);
grid('equal-and-dominated-seeds',9,7,new Uint8Array(63),[62,0,0,31],[40,7,7,80]);
grid('negative-seed-values',3,3,new Uint8Array(9),[0,8],[-3,5]);
for (const value of [-2147483648,-2147483647,2147483646,2147483647]) {
  grid(`i32-seed-${value}`,1,1,new Uint8Array([0]),[0],[value]);
}
const layout=fixedLayout();
// All typed arrays become ordinary arrays, preserving every tile and array order.
const plain=(x:unknown):unknown => ArrayBuffer.isView(x)?Array.from(x as unknown as ArrayLike<number>):
  Array.isArray(x)?x.map(plain):x!==null&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;
const connectivity=[];
for(let k=0;k<4;k++) {
  const t=new Uint8Array(160*160).fill(1);
  for(let y=1;y<159;y++) for(let x=1;x<159;x++) if(x!==80&&((x+y)%13!==0||k===1)) t[y*160+x]=(x*y)%29===0?2:0;
  const seed={x:k===2?80:20,y:20};
  const before=Array.from(t),log=[123456];enforceConnectivity(t,seed,log);
  connectivity.push({seed,before,after:Array.from(t),log});
}
const angles=[0,-0,Number.MIN_VALUE,-Number.MIN_VALUE,Math.PI,-Math.PI,TWO_PI,-TWO_PI,Math.PI/2,-Math.PI/2,1e6,-1e6];
for(let k=-512;k<=512;k++) angles.push(k/31);
for(let k=-8;k<=8;k++) for(const eps of [-1e-14,0,1e-14]) angles.push(k*Math.PI/2+eps);
const rounds=[-0,-0.5,-0.5000000000000001,-0.49999999999999994,0.49999999999999994,0.5,0.5000000000000001,4503599627370497,-4503599627370497];
for(let k=-64;k<=64;k++) rounds.push(k/4);
const result={format:'rh-map-foundations/1',oracle:{node:process.version,platform:process.platform,arch:process.arch},simple:Array.from(SIMPLE),
  offsets:{ring:ringOffsets(160),nb4:nb4Offsets(160),fixedRing:RING_OFF,fixedNb4:NB4},
  trig:angles.map(x=>({x:bits(x),sin:bits(detSin(x)),cos:bits(detCos(x)),wrap:bits(wrapAngle(x))})),
  rounds:rounds.map(x=>({x:bits(x),rounded:bits(Math.round(x))})),grids,layout:plain(layout),connectivity};
const path=fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/foundations.json',import.meta.url));
const output=JSON.stringify(result)+'\n';
if(process.argv.includes('--check')) {
  if(readFileSync(path,'utf8')!==output) throw new Error('map foundation capture differs');
  console.log('map foundation capture matches');
} else {writeFileSync(path,output);console.log(`captured ${grids.length} topology grids, ${angles.length} trig samples and fixed layout`);}

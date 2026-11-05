/** M2a oracle: REAL exported partitionZones and helpers; no copied zone algorithm.
 * Linux x64 Node 22.23.4, node --import tsx tools/map-fixtures/zones-partition.ts [--check].
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {partitionZones,chamfer,chamferLabels,ringContact,sliverCounts,pseudoAngle,MAPGEN_FAILS} from '../../packages/shared/src/zones.ts';
import {fixedLayout} from '../../packages/shared/src/coliseum.ts';
import {REGION_FACTIONS} from '../../packages/shared/src/map.ts';
import {mulberry32,shuffle} from '../../packages/shared/src/rng.ts';
const bits=(x:number):string=>{const b=new ArrayBuffer(8),v=new DataView(b);v.setFloat64(0,x,false);return v.getBigUint64(0,false).toString(16).padStart(16,'0');};
function capture(seed:number,attempt:number,prefix=true) {
  // This is precisely the public generator's stage-1 prefix; all draws and the
  // actual shuffle implementation are recorded before calling actual stage 2.
  const initial=attempt===0?seed:seed+attempt*0x9e3779b1;
  const words:number[]=[];const source=mulberry32(initial);
  const rng=()=>{const x=source();words.push(x*4294967296);return x;};
  const pillar=prefix?Math.floor(rng()*fixedLayout().pillars.length):null;
  const order=prefix?shuffle(rng,[...REGION_FACTIONS]):null;
  const prefixWords=words.splice(0);
  const before={...MAPGEN_FAILS};
  const part=partitionZones(rng);
  const failures=Object.fromEntries(Object.keys(MAPGEN_FAILS).sort().map(k=>[k,MAPGEN_FAILS[k]-(before[k]??0)]).filter(([,v])=>v!==0));
  const continuation=Array.from({length:8},()=>source()*4294967296);
  const dt=new Int32Array(160*160);
  const slivers=part?Array.from(sliverCounts(part.zone,dt)):null;
  return {seed,attempt,initialU32:initial>>>0,prefix,pillar,order,prefixWords,draws:words.length,words,continuation,
    failures,zone:part?Array.from(part.zone):null,cost:part?Array.from(part.cost):null,
    contact:part?Array.from(ringContact(part.zone)):null,slivers,labelDistance:part?Array.from(dt):null};
}
const scan=[];const cases:ReturnType<typeof capture>[]=[];const selected=new Set<string>();
const keep=(c:ReturnType<typeof capture>)=>{const key=`${c.seed}/${c.attempt}/${c.prefix}`;if(!selected.has(key)){cases.push(c);selected.add(key);}};
let firstSuccess=false,firstRetry=false,firstFailure=false;
// At least 0..255, bounded at 1024, stopping once all three observed classes exist.
for(let seed=0;seed<1024;seed++) {
  if(seed>=256&&firstSuccess&&firstRetry&&firstFailure) break;
  const c=capture(seed,0);
  scan.push({seed,success:c.zone!==null,draws:c.draws,failures:c.failures});
  if([0,1,2,199].includes(seed)) keep(c);
  if(c.zone!==null&&!firstSuccess) {firstSuccess=true;keep(c);}
  if(c.zone!==null&&c.draws>236&&!firstRetry) {firstRetry=true;keep(c);}
  if(c.zone===null&&!firstFailure) {firstFailure=true;keep(c);}
}
for(const [seed,attempt,prefix] of [[12,0,false],[-1,0,true],[4294967297,0,true],[1,4294967296,true]] as const) keep(capture(seed,attempt,prefix));
const metrics=[];
const mrng=mulberry32(0xc031);
for(const kind of ['zero','one','striped','random']) {
  const mask=Uint8Array.from({length:25600},(_,i)=>kind==='zero'?0:kind==='one'?1:kind==='striped'?Math.floor(i/160)%3:Math.floor(mrng()*4));
  const binary=new Int32Array(25600),labels=new Int32Array(25600);
  chamfer(mask,binary);chamferLabels(mask,labels);
  metrics.push({kind,mask:Array.from(mask),binary:Array.from(binary),labels:Array.from(labels)});
}
const angles=[];
for(const dx of [-1000000,-2,-1,-0.5,-0,0,0.5,1,2,1000000]) for(const dy of [-2,-1,-0.5,-0,0,0.5,1,2]) angles.push({dx:bits(dx),dy:bits(dy),result:bits(pseudoAngle(dx,dy))});
// Separately labelled direct-function unit input: it is not a claimed failing map seed.
let failureDraws=0;const failureBefore={...MAPGEN_FAILS};
const failedPart=partitionZones(()=>{failureDraws++;return 0;});
const failureReasons=Object.fromEntries(Object.keys(MAPGEN_FAILS).sort().map(k=>[k,MAPGEN_FAILS[k]-(failureBefore[k]??0)]).filter(([,v])=>v!==0));
const terminalFailure={kind:'injected-constant-zero',value:0,draws:failureDraws,success:failedPart!==null,failures:failureReasons};
const result={format:'rh-zone-partition/1',node:process.version,platform:process.platform,arch:process.arch,scan,cases,metrics,angles,terminalFailure};
const output=JSON.stringify(result)+'\n';
const path=fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/zones-partition.json',import.meta.url));
if(process.argv.includes('--check')) {if(readFileSync(path,'utf8')!==output) throw new Error('zone partition capture differs');}
else writeFileSync(path,output);
console.log(`zone partitions ${process.argv.includes('--check')?'match':'captured'}: scan=${scan.length}, success=${scan.filter(s=>s.success).length}, retry=${scan.filter(s=>s.success&&s.draws>236).length}, failure=${scan.filter(s=>!s.success).length}, fullCases=${cases.length}`);

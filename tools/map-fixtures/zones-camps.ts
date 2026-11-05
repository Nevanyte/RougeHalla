/** Actual pre-styler stage 2: real pillar draw, shuffle, partitionZones, then placeCamps on one stream.
 * Pinned Linux x64 Node22.23.4. node --import tsx tools/map-fixtures/zones-camps.ts [--check]
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {partitionZones,placeCamps,territoryReach2,MAPGEN_FAILS} from '../../packages/shared/src/zones.ts';
import {fixedLayout} from '../../packages/shared/src/coliseum.ts';
import {REGION_FACTIONS} from '../../packages/shared/src/map.ts';
import {mulberry32,shuffle} from '../../packages/shared/src/rng.ts';
function capture(seed:number,attempt=0) {
 const initial=attempt===0?seed:seed+attempt*0x9e3779b1;
 const source=mulberry32(initial);const words:number[]=[];
 const rng=()=>{const v=source();words.push(v*4294967296);return v;};
 const pillar=Math.floor(rng()*fixedLayout().pillars.length);const order=shuffle(rng,[...REGION_FACTIONS]);
 const prefixWords=words.splice(0);const part=partitionZones(rng);const partitionWords=words.splice(0);
 const before={...MAPGEN_FAILS};const layout=part?placeCamps(rng,part):null;
 const failures=Object.fromEntries(Object.keys(MAPGEN_FAILS).sort().map(k=>[k,MAPGEN_FAILS[k]-(before[k]??0)]).filter(([,v])=>v!==0));
 const continuation=Array.from({length:8},()=>source()*4294967296);
 const tiles=Uint8Array.from({length:25600},(_,i)=>i%13===0?1:i%17===0?2:0);
 return {seed,attempt,initialU32:initial>>>0,pillar,order,prefixWords,partitionWords,words,draws:words.length,continuation,failures,
   zone:part?Array.from(part.zone):null,cost:part?Array.from(part.cost):null,
   camps:layout?layout.camps:null,territoryGrid:layout?Array.from(layout.territoryGrid):null,
   reachAll:layout?Array.from(territoryReach2(layout.camps,layout.territoryGrid,null)):null,
   reachWalkable:layout?Array.from(territoryReach2(layout.camps,layout.territoryGrid,tiles)):null,
   reachEmptyMask:layout?Array.from(territoryReach2(layout.camps,layout.territoryGrid,new Uint8Array(0))):null,
   reachEmptyTerritory:layout?Array.from(territoryReach2(layout.camps,new Uint8Array(0),null)):null};
}
const scan=[];const cases:ReturnType<typeof capture>[]=[];const selected=new Set<string>();
const keep=(c:ReturnType<typeof capture>)=>{const key=`${c.seed}/${c.attempt}`;if(!selected.has(key)){selected.add(key);cases.push(c);}};
let success=false,retry=false,failure=false,failureExamples=0;
// At least 32, at most128 actual streams. Do not manufacture a failed-seed claim if none occurs.
for(let seed=0;seed<128;seed++) {
 if(seed>=32&&success&&retry&&failure)break;
 const c=capture(seed);const ok=c.camps!==null;
 scan.push({seed,success:ok,partitionDraws:c.partitionWords.length,draws:c.draws,failures:c.failures});
 if([0,1,2,12].includes(seed))keep(c);
 if(ok&&!success){success=true;keep(c);}
 if(ok&&Object.keys(c.failures).length&&!retry){retry=true;keep(c);}
 if(!ok&&!failure){failure=true;keep(c);}
 if(!ok&&failureExamples<3){failureExamples++;keep(c);}
}
for(const [seed,attempt] of [[-1,0],[4294967297,0],[1,4294967296]]) keep(capture(seed,attempt));
const result={format:'rh-zone-camps/1',node:process.version,platform:process.platform,arch:process.arch,scan,cases};
const output=JSON.stringify(result)+'\n';const path=fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/zones-camps.json',import.meta.url));
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==output)throw new Error('camp capture differs');}else writeFileSync(path,output);
console.log(`camps ${process.argv.includes('--check')?'match':'captured'} scan=${scan.length} success=${scan.filter(s=>s.success).length} retry=${scan.filter(s=>s.success&&Object.keys(s.failures).length).length} failure=${scan.filter(s=>!s.success).length} fullCases=${cases.length}`);

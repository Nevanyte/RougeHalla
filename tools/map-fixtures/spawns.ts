/** Actual post-landmark pool inputs and final-map gate measurements. Linux x64 Node22.23.4.
 * node --import tsx tools/map-fixtures/spawns.ts [--check]
 * Isolated actual-source copy; observations must preserve complete unmodified final output/hash.
 */
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import * as reference from '../../packages/shared/src/mapgen.ts';
import {mulberry32} from '../../packages/shared/src/rng.ts';
const sourcePath=fileURLToPath(new URL('../../packages/shared/src/mapgen.ts',import.meta.url));const source=readFileSync(sourcePath,'utf8');let transformed=source;
function once(old:string,next:string){if(transformed.split(old).length!==2)throw new Error(`source tap changed: ${old}`);transformed=transformed.replace(old,next);}
once('mulberry32, randInt as rngInt, shuffle','mulberry32 as __actualMulberry32, randInt as rngInt, shuffle');
once('    const lprot = landmarkProtect(camps);','    const lprot = landmarkProtect(camps);\n    (globalThis as any).__rhSpawnObserver?.({type:"landmarkProtect",protect:lprot});');
once('  const picked = pickSpawnPool(rng, tiles, zone, open3, landmarkNear1, camps, centreWalk);','  (globalThis as any).__rhSpawnObserver?.({type:"poolStart",tiles,zone,open3,landmarkNear1,landmarkBox,camps,centreWalk,buildings,featureOwner,features});\n  const picked = pickSpawnPool(rng, tiles, zone, open3, landmarkNear1, camps, centreWalk);\n  (globalThis as any).__rhSpawnObserver?.({type:"poolEnd",picked});');
once('  for (const t of pool) { markRect(poolHalo, cell(t), 1); markRect(pool5, cell(t), 2); }','  for (const t of pool) { markRect(poolHalo, cell(t), 1); markRect(pool5, cell(t), 2); }\n  (globalThis as any).__rhSpawnObserver?.({type:"poolMasks",poolHalo,pool5});');
once('  const protect = styleProtect(camps, landmarkNear1, featureOwner, poolHalo);','  const protect = styleProtect(camps, landmarkNear1, featureOwner, poolHalo);\n  (globalThis as any).__rhSpawnObserver?.({type:"styleProtect",protect});');
once('  const gate = spawnGate(tiles, pool, terrain, zone);','  (globalThis as any).__rhSpawnObserver?.({type:"gateStart",tiles,pool,terrain,zone,poolHalo,pool5});\n  const gate = spawnGate(tiles, pool, terrain, zone);\n  (globalThis as any).__rhSpawnObserver?.({type:"gateEnd",gate,pool,poolHalo,pool5});');
once('    hazards.push(hz);','    hazards.push(hz);\n    (globalThis as any).__rhSpawnObserver?.({type:"path",tile:t,path,walk:walks[walks.length-1],hazards:hz});');
once('  const keep = gateSpawnWalks(pool, walks, hazards, (t) => zone[t]);','  const keep = gateSpawnWalks(pool, walks, hazards, (t) => zone[t]);\n  (globalThis as any).__rhSpawnObserver?.({type:"decision",keep,walks,hazards});');
transformed=transformed.replace(/(from\s+["'])(\.[^"']+)(["'])/g,(_,a,p,b)=>{const absolute=resolve(dirname(sourcePath),p)+'.ts';readFileSync(absolute);return a+pathToFileURL(absolute).href+b;});
transformed+='\nconst mulberry32=(initial:number):Rng=>{const actual=__actualMulberry32(initial);(globalThis as any).__rhSpawnObserver?.({type:"stream",initial});return()=>{const value=actual();(globalThis as any).__rhSpawnObserver?.({type:"draw",word:value*4294967296});return value;};};\nexport {markRect as __markRect,walkSegment as __walkSegment,pickSpawnPool as __pickSpawnPool};\n';
const plain=(x:unknown):any=>ArrayBuffer.isView(x)?Array.from(x as unknown as ArrayLike<number>):Array.isArray(x)?x.map(plain):x!==null&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;
const bits=(n:number):string=>{const a=new ArrayBuffer(8),v=new DataView(a);v.setFloat64(0,n,false);return v.getBigUint64(0,false).toString(16).padStart(16,'0');};
const equal=(a:unknown,b:unknown)=>JSON.stringify(plain(a))===JSON.stringify(plain(b));
const temporary=mkdtempSync(join(tmpdir(),'rh-spawns-observer-'));
try {
 const path=join(temporary,'observed.mts');writeFileSync(path,transformed);const observed=await import(pathToFileURL(path).href);
 const host=globalThis as typeof globalThis & {__rhSpawnObserver?:(event:any)=>void};
 function capture(seed:number,styled:boolean) {
  const words:number[]=[];let initial:number|undefined;let skippedWords=0,endWords=0;let landmarkProtect:any=null,poolInput:any=null,pool:any=null,poolMasks:any=null,styleProtect:any=null,gateInput:any=null,decision:any=null;const paths:any[]=[];let masksSurvived=0;
  const options=styled?{decor:false}:{decor:false,styleZones:null};const baseline=reference.tryAttempt(seed,0,options);
  host.__rhSpawnObserver=(e:any)=>{
   if(e.type==='stream')initial=e.initial;else if(e.type==='draw')words.push(e.word);
   else if(e.type==='landmarkProtect')landmarkProtect=plain(e.protect);
   else if(e.type==='poolStart'){skippedWords=words.length;poolInput=plain(e);delete poolInput.type;}
   else if(e.type==='poolEnd'){endWords=words.length;pool=plain(e.picked);}
   else if(e.type==='poolMasks')poolMasks={halo:plain(e.poolHalo),pool5:plain(e.pool5)};
   else if(e.type==='styleProtect')styleProtect=plain(e.protect);
   else if(e.type==='gateStart'){
    if(!equal(poolMasks,{halo:e.poolHalo,pool5:e.pool5}))throw new Error('original protection changed before gate');masksSurvived++;
    gateInput={tiles:plain(e.tiles),pool:plain(e.pool),terrain:plain(e.terrain),zone:plain(e.zone)};
   }else if(e.type==='path')paths.push({tile:e.tile,path:plain(e.path),walkBits:bits(e.walk),hazards:e.hazards});
   else if(e.type==='decision')decision={keep:plain(e.keep),walkBits:e.walks.map(bits),hazards:plain(e.hazards)};
   else if(e.type==='gateEnd'){
    if(!equal(poolMasks,{halo:e.poolHalo,pool5:e.pool5})||!equal(pool,e.pool))throw new Error('gate mutated original pool/protection');masksSurvived++;
   }
  };
  let final;try{final=observed.tryAttempt(seed,0,options);}finally{delete host.__rhSpawnObserver;}
  if(!equal(baseline,final)||(baseline?reference.mapHash(baseline):null)!==(final?observed.mapHash(final):null))throw new Error('spawn observer changed complete output/hash');
  if(initial===undefined||poolInput===null)throw new Error('selected seed did not reach real landmark/pool stage');
  const replay=mulberry32(initial);for(let i=0;i<endWords;i++){if(replay()*4294967296!==words[i])throw new Error('RNG replay mismatch');}
  return {seed,styled,initialU32:initial>>>0,skippedWords,words:words.slice(skippedWords,endWords),continuation:Array.from({length:8},()=>replay()*4294967296),landmarkProtect,poolInput,pool,poolMasks,styleProtect,gateInput,paths,decision,originalMasksSurvived:masksSurvived,finalVerified:true,finalHash:final?observed.mapHash(final):null};
 }
 const cases=[];const scan=[];let selectedDrop=false;
 for(const styled of [false,true]) {
  for(let seed=0;seed<16;seed++) {
   const c=capture(seed,styled);const dropped=c.decision?.keep?c.pool.length-c.decision.keep.length:null;
   scan.push({seed,styled,selected:c.pool?.length??0,kept:c.decision?.keep?.length??null,dropped});
   if((!styled&&[0,1,2].includes(seed))||(styled&&[0,1].includes(seed))||(!selectedDrop&&dropped!==null&&dropped>0)){cases.push(c);if(dropped!==null&&dropped>0)selectedDrop=true;}
  }
 }
 if(!selectedDrop)throw new Error('bounded real scan has no gate drop case; extend capture deliberately');
 // Controlled direct-helper exclusions over an actual captured layer, never claimed as map seeds.
 const poolUnits=[];const base=cases[0];
 for(const allowed of [0,12,25]) {
  const exclusion=new Uint8Array(25600).fill(1);for(const tile of base.pool.slice(0,allowed))exclusion[tile]=0;
  const source=mulberry32(base.initialU32);for(let i=0;i<base.skippedWords;i++)source();const unitWords:number[]=[];
  const pool=observed.__pickSpawnPool(()=>{const v=source();unitWords.push(v*4294967296);return v;},Uint8Array.from(base.poolInput.tiles),Uint8Array.from(base.poolInput.zone),Uint8Array.from(base.poolInput.open3),exclusion,base.poolInput.camps,Int32Array.from(base.poolInput.centreWalk));
  poolUnits.push({name:`${allowed}-original-candidates`,baseCase:0,landmarkNear1:Array.from(exclusion),words:unitWords,continuation:Array.from({length:8},()=>source()*4294967296),pool});
 }
 // Standalone helper boundary inputs are actual function calls, not invented map seeds.
 const gateCases=[];
 function gateCase(name:string,pool:number[],walks:number[],hazards:number[],zones:number[]) {gateCases.push({name,pool,walkBits:walks.map(bits),hazards,zones,keep:reference.gateSpawnWalks(pool,walks,hazards,t=>zones[pool.indexOf(t)])});}
 const p=Array.from({length:26},(_,i)=>i*7+1),z=p.map((_,i)=>i%5+1),w=p.map(()=>100),hz=p.map(()=>0);
 gateCase('empty',[],[],[],[]);gateCase('too-few',p.slice(0,23),w.slice(0,23),hz.slice(0,23),z.slice(0,23));
 gateCase('exact-minimum',p.slice(0,24),w.slice(0,24),hz.slice(0,24),z.slice(0,24));
 gateCase('insufficient-zones',p,w,hz,p.map(()=>1));
 gateCase('hazard-threshold',p,w,hz.map((_,i)=>i===0?8:i===1?9:0),z);
 gateCase('hazard-too-many',p,w,hz.map((_,i)=>i<3?9:0),z);
 gateCase('highest-index-long-tie',p,w.map((_,i)=>i>=24?200:100),hz,z);
 gateCase('highest-index-short-tie',p,w.map((_,i)=>i<2?1:100),hz,z);
 gateCase('equal-removal-ratio-longest-wins',p,w.map((_,i)=>i===0?50:i===25?200:100),hz,z);
 gateCase('ratio-at-boundary',p,w.map((_,i)=>i===25?120:100),hz,z);
 gateCase('ratio-one-ulp-over',p,w.map((_,i)=>i===25?120.00000000000001:100),hz,z);
 gateCase('zero-walks',p,w.map(()=>0),hz,z);
 gateCase('ratio-fails-at-minimum',p.slice(0,24),w.slice(0,24).map((_,i)=>i===23?1000:100),hz.slice(0,24),z.slice(0,24));
 const rects=[];for(const [r,margin] of [[{x:-2,y:-1,w:4,h:3},1],[{x:159,y:159,w:1,h:1},2],[{x:4,y:4,w:0,h:0},1],[{x:10,y:10,w:3,h:3},-1]] as const){const grid=new Uint8Array(25600);observed.__markRect(grid,r,margin);rects.push({rect:r,margin,grid:Array.from(grid)});}
 const segments=[];for(const [ax,ay,bx,by] of [[0,0,0,0],[0,0,3,3],[3,3,0,0],[1,1,1,5],[1,1,5,1],[-1,0,2,1],[0,0,5,2]])for(const stopAfter of [0,1,3]){const visited:number[][]=[];const stopped=observed.__walkSegment(ax,ay,bx,by,(x:number,y:number)=>{visited.push([x,y]);return stopAfter>0&&visited.length>=stopAfter;});segments.push({ax,ay,bx,by,stopAfter,visited,stopped});}
 const result={format:'rh-spawns/1',node:process.version,platform:process.platform,arch:process.arch,actualSourceSha256:createHash('sha256').update(source).digest('hex'),observationOnlyFinalEqualityVerified:true,scan,cases,poolUnits,gateCases,rects,segments};
 const fixture=fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/spawns.json',import.meta.url));const output=JSON.stringify(result)+'\n';
 if(process.argv.includes('--check')){if(readFileSync(fixture,'utf8')!==output)throw new Error('spawn capture differs');}else writeFileSync(fixture,output);
 console.log(`spawns ${process.argv.includes('--check')?'match':'captured'}: ${scan.length} real plain/styled runs, ${cases.length} full cases, actual gate drops verified`);
}finally{rmSync(temporary,{recursive:true,force:true});}

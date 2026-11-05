/** Actual stage-eight/eleven observations, with unchanged full-output/hash controls.
 * Canonical capture: Linux x64 Node22.23.4. No finalized-map reconstruction.
 */
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import * as reference from '../../packages/shared/src/mapgen.ts';
import {mulberry32} from '../../packages/shared/src/rng.ts';
import {TERRAINS} from '../../packages/shared/src/terrain.ts';
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw Error('requires Linux x64 Node22.23.4');
const sourcePath=fileURLToPath(new URL('../../packages/shared/src/mapgen.ts',import.meta.url));
const source=readFileSync(sourcePath,'utf8');let transformed=source;
function once(a:string,b:string){if(transformed.split(a).length!==2)throw Error(`nonunique tap: ${a}`);transformed=transformed.replace(a,b);}
const tap=(event:string)=>`(globalThis as any).__rhSpots?.(${event});`;
const plain=(v:any):any=>ArrayBuffer.isView(v)?Array.from(v as any):Array.isArray(v)?v.map(plain):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])):v;
// The source bodies are exposed unchanged through argument wrappers for explicitly labelled synthetic inputs.
const campStart=source.indexOf('  for (const c of camps) {\n    const around: number[] = [];');
const campEnd=source.indexOf('\n  // --- Weapon crates:',campStart);
const crateStart=source.indexOf('  const doorNear = new Uint8Array(N);',campEnd);
const crateEnd=source.indexOf('\n  const allCrates = cratesByZone.flat();',crateStart);
if(campStart<0||campEnd<0||crateStart<0||crateEnd<0)throw Error('source operation boundaries changed');
let directCamp=source.slice(campStart,campEnd),directCrates=source.slice(crateStart,crateEnd);
once('mulberry32, randInt as rngInt, shuffle','mulberry32 as __actualMulberry32, randInt as rngInt, shuffle');
once('  for (const c of camps) {\n    const around: number[] = [];',`  ${tap('{type:"campStart",camps}')}\n  for (const c of camps) {\n    const around: number[] = [];`);
once('    c.spots = spots;',`    c.spots = spots;\n    ${tap('{type:"camp",around,want,spots}')}`);
once('  const doorNear = new Uint8Array(N);',`  ${tap('{type:"crateStart",tiles,terrain,zone,ring,pool,camps,features,featureOwner,styled:!!hook}')}\n  const doorNear = new Uint8Array(N);`);
once('  const cratesByZone: number[][] = [];',`  ${tap('{type:"crateMasks",doorNear,nooksByZone,initialNo:crateNo}')}\n  const cratesByZone: number[][] = [];`);
once('    shuffle(rng, cands);',`    shuffle(rng, cands);\n    ${tap('{type:"crateZone",z,nooks,cands,want}')}`);
once('      shuffle(rng, open);',`      shuffle(rng, open);\n      ${tap('{type:"crateOpen",z,open}')}`);
once('    if (chosen.length < CRATES_MIN) return failed("A:crates");',`    ${tap('{type:"crateChosen",z,chosen,refused:chosen.length<CRATES_MIN}')}\n    if (chosen.length < CRATES_MIN) return failed("A:crates");`);
once('  const allCrates = cratesByZone.flat();',`  ${tap('{type:"crateEnd",crateNo}')}\n  const allCrates = cratesByZone.flat();`);
once('  const noLoot = new Uint8Array(N);',`  ${tap('{type:"groundStart",tiles,terrain,landmarkBox,fp,clearing,allCrates,pool}')}\n  const noLoot = new Uint8Array(N);`);
once('  const groundSpots = pickGroundSpots(rng, tiles, noLoot, pool.map(tp)).map(toWorld);',`  ${tap('{type:"noLoot",noLoot}')}\n  const groundSpots = pickGroundSpots(rng, tiles, noLoot, pool.map(tp)).map(toWorld);`);
once('  return chosen;\n}',`  ${tap('{type:"groundEnd",nearSpawn,cands,nooks,want,chosen}')}\n  return chosen;\n}`);
// Reuse the very same observed source bodies for direct synthetic calls.
directCamp=transformed.slice(transformed.indexOf('  for (const c of camps) {\n    const around: number[] = [];'),transformed.indexOf('\n  // --- Weapon crates:',transformed.indexOf('  for (const c of camps) {\n    const around: number[] = [];')));
directCrates=transformed.slice(transformed.indexOf('  const doorNear = new Uint8Array(N);'),transformed.indexOf('\n  const allCrates = cratesByZone.flat();'));
transformed=transformed.replace(/(from\s+["'])(\.[^"']+)(["'])/g,(_,a,p,b)=>{const target=resolve(dirname(sourcePath),p)+'.ts';readFileSync(target);return a+pathToFileURL(target).href+b;});
transformed+=`\nconst mulberry32=(initial:number):Rng=>{const actual=__actualMulberry32(initial);${tap('{type:"stream",initial}')}return()=>{const v=actual();${tap('{type:"draw",word:v*4294967296}')}return v;};};\nexport {pickGroundSpots as __ground};\nexport function __camps(rng:any,camps:any){${directCamp}\nreturn camps;}\nexport function __crates(rng:any,tiles:any,terrain:any,zone:any,ring:any,pool:any,camps:any,features:any,featureOwner:any,hook:any){${directCrates}\nreturn cratesByZone;}\n`;
const temporary=mkdtempSync(join(tmpdir(),'rh-spots-'));
const host=globalThis as typeof globalThis & {__rhSpots?:(event:any)=>void};
try {
 const path=join(temporary,'observed.mts');writeFileSync(path,transformed);const observed=await import(pathToFileURL(path).href);
 function capture(seed:number,attempt:number,styled:boolean,decor=false) {
  const options=styled?{decor}:{decor,styleZones:null};const baseline=reference.tryAttempt(seed,attempt,options);
  const words:number[]=[];let initial:number|undefined;let camp:any=null,crates:any=null,ground:any=null;
  host.__rhSpots=(e:any)=>{
   if(e.type==='stream')initial=e.initial;
   else if(e.type==='draw')words.push(e.word);
   else if(e.type==='campStart')camp={start:words.length,input:plain(e.camps),traces:[]};
   else if(e.type==='camp'){camp.traces.push(plain({...e,type:undefined}));camp.end=words.length;}
   else if(e.type==='crateStart')crates={start:words.length,input:plain({...e,type:undefined}),zones:[]};
   else if(e.type==='crateMasks')Object.assign(crates,plain({...e,type:undefined}));
   else if(e.type==='crateZone')crates.zones.push(plain({nooks:e.nooks,cands:e.cands,open:null,want:e.want}));
   else if(e.type==='crateOpen')crates.zones.at(-1).open=plain(e.open);
   else if(e.type==='crateChosen'){crates.zones.at(-1).chosen=plain(e.chosen);crates.refusal=e.refused?'Crates':null;crates.end=words.length;}
   else if(e.type==='crateEnd')crates.crateNo=plain(e.crateNo);
   else if(e.type==='groundStart')ground={start:words.length,input:plain({...e,type:undefined})};
   else if(e.type==='noLoot')ground.noLoot=plain(e.noLoot);
   else if(e.type==='groundEnd'){Object.assign(ground,plain({...e,type:undefined}));ground.end=words.length;ground.refusal=e.chosen.length<30?'Ground':null;}
  };
  let final;try{final=observed.tryAttempt(seed,attempt,options);}finally{delete host.__rhSpots;}
  if(!isDeepStrictEqual(plain(baseline),plain(final))||(baseline?reference.mapHash(baseline):null)!==(final?observed.mapHash(final):null))throw Error('observer changed complete output/hash');
  if(initial===undefined||!camp||!crates||!ground||crates.zones.length!==5||camp.traces.length!==50||!final)throw Error(`inventory/nonnull drift ${seed}:${attempt}:${styled}`);
  for(const op of [camp,crates,ground]) {
   const replay=mulberry32(initial);for(let i=0;i<op.start;i++)if(replay()*4294967296!==words[i])throw Error('prefix mismatch');
   op.prefix=words.slice(0,op.start);op.words=words.slice(op.start,op.end);op.initialState=((initial>>>0)+Math.imul(op.start,0x6d2b79f5))>>>0;
   for(const w of op.words)if(replay()*4294967296!==w)throw Error('draw mismatch');
   op.endState=((initial>>>0)+Math.imul(op.end,0x6d2b79f5))>>>0;op.continuation=Array.from({length:8},()=>replay()*4294967296);delete op.start;delete op.end;
  }
  return {seed,attempt,styled,decor,initialU32:initial>>>0,camp,crates,ground,finalVerified:true,finalHash:reference.mapHash(final)};
 }
 const cases=[];
 for(const [seed,attempt,styled,decor] of [[1,0,false,false],[-1,0,false,false],[4294967297,4294967296,false,false],[17,0,false,false],[17,1,false,false],[1,0,true,false],[1,0,true,true]] as const)cases.push(capture(seed,attempt,styled,decor));
 if(!isDeepStrictEqual({...cases[5],decor:false},{...cases[6],decor:false}))throw Error('decor shifted gameplay observations');
 const units:any[]=[];
 function directGround(label:string,tiles:Uint8Array,skip:Uint8Array,spawns:any[],seed:number) {
  const rng=mulberry32(seed),words:number[]=[];let trace:any;
  host.__rhSpots=e=>{if(e.type==='groundEnd')trace=plain({...e,type:undefined});};
  let result;try{result=observed.__ground(()=>{let v=rng();words.push(v*4294967296);return v;},tiles,skip,spawns);}finally{delete host.__rhSpots;}
  if(!trace)throw Error('missing direct ground trace');units.push({kind:'ground',label,seed,tiles:plain(tiles),skip:plain(skip),spawns,trace,result:plain(result),words,continuation:Array.from({length:8},()=>rng()*4294967296)});
 }
 directGround('explicit-empty-refusal',new Uint8Array(25600).fill(3),new Uint8Array(25600),[],7);
 const scarce=new Uint8Array(25600).fill(3);for(let y=10;y<17;y++)for(let x=10;x<24;x++)scarce[y*160+x]=0;
 directGround('explicit-scarce-open-nooks-spacing-fallback',scarce,new Uint8Array(25600),[{x:10,y:10}],19);
 directGround('explicit-exact-90-open-threshold',(()=>{const t=new Uint8Array(25600).fill(3);for(let y=10;y<21;y++)for(let x=10;x<22;x++)t[y*160+x]=0;return t;})(),new Uint8Array(25600),[],21);
 for(const [label,tiles,zone] of [
  ['explicit-empty-crate-refusal',new Uint8Array(25600).fill(3),new Uint8Array(25600).fill(1)],
  ['explicit-open3-crate-fallback-cross-zone',new Uint8Array(25600),Uint8Array.from({length:25600},(_,i)=>Math.min(5,Math.floor(i%160/32)+1))],
 ] as const){const seed=31,rng=mulberry32(seed),words:number[]=[];const ring=new Uint8Array(25600),terrain=new Uint8Array(25600),owner=new Uint8Array(25600);const traces:any[]=[];host.__rhSpots=e=>traces.push(plain(e));const result=observed.__crates(()=>{let v=rng();words.push(v*4294967296);return v;},tiles,terrain,zone,ring,[],[],[],owner,null);delete host.__rhSpots;units.push({traces,kind:'crates',label,seed,tiles:plain(tiles),zone:plain(zone),result:plain(result),words,continuation:Array.from({length:8},()=>rng()*4294967296)});}
 for(const elite of [false,true]) {
  const seed=elite?43:1,rng=mulberry32(seed),words:number[]=[],traces:any[]=[];
  const input=[{zone:1,site:80*160+80,elite,spots:[]}];host.__rhSpots=e=>traces.push(plain(e));
  const result=observed.__camps(()=>{const v=rng();words.push(v*4294967296);return v;},structuredClone(input));delete host.__rhSpots;
  units.push({kind:'camps',label:elite?'explicit-elite-equal-distance-index-ties':'explicit-normal-internal-order-fallback',seed,input,result,traces,words,continuation:Array.from({length:8},()=>rng()*4294967296)});
 }
 const doc={format:'rh-map-spots/1',runtime:{node:process.version,platform:process.platform,arch:process.arch},sourceSha256:createHash('sha256').update(source).digest('hex'),terrainOn:Object.fromEntries(Object.entries(TERRAINS).map(([k,v])=>[k,v.tile])),inventory:{cases:7,camps:350,crateZones:35,ground:7,units:7},cases,units};
 const bytes=JSON.stringify(doc)+'\n';const target=process.env.RH_SPOTS_OUT??fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/map-spots.json',import.meta.url));
 if(process.argv.includes('--check')){if(readFileSync(target,'utf8')!==bytes)throw Error('spot fixture byte mismatch');}else writeFileSync(target,bytes);
 console.log(JSON.stringify({cases:cases.length,units:units.length,bytes:bytes.length}));
}finally{delete host.__rhSpots;rmSync(temporary,{recursive:true,force:true});}

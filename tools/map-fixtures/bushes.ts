/** Actual stage-11b snapshots. Linux x64 Node22.23.4; no legacy source/package writes.
 * node --import tsx tools/map-fixtures/bushes.ts [--check]
 */
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import * as reference from '../../packages/shared/src/mapgen.ts';
import {mulberry32} from '../../packages/shared/src/rng.ts';
const base=fileURLToPath(new URL('../../packages/shared/src/',import.meta.url));
const mapSource=readFileSync(join(base,'mapgen.ts'),'utf8'),bushSource=readFileSync(join(base,'bushes.ts'),'utf8');
const plain=(x:unknown):any=>ArrayBuffer.isView(x)?Array.from(x as unknown as ArrayLike<number>):Array.isArray(x)?x.map(plain):x!==null&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;
const equal=(a:unknown,b:unknown)=>JSON.stringify(plain(a))===JSON.stringify(plain(b));
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const absolute=(s:string)=>s.replace(/(from\s+["'])(\.[^"']+)(["'])/g,(_,a,p,b)=>{const path=resolve(base,p)+'.ts';readFileSync(path);return a+pathToFileURL(path).href+b;});
function replaceOnce(s:string,a:string,b:string){if(s.split(a).length!==2)throw new Error(`source tap changed: ${a}`);return s.replace(a,b);}
const temporary=mkdtempSync(join(tmpdir(),'rh-bushes-observer-'));
try {
 let bs=replaceOnce(bushSource,'const rng = mulberry32(hashSeed(inp.seed, inp.attempt, c.zone - 1, BUSH_STREAM + ci * 8));',`const __seed = hashSeed(inp.seed, inp.attempt, c.zone - 1, BUSH_STREAM + ci * 8);
    const __rng = mulberry32(__seed);
    (globalThis as any).__rhBushObserver?.({type:"stream",ci,zone:c.zone,seed:__seed});
    const rng=()=>{const value=__rng();(globalThis as any).__rhBushObserver?.({type:"bushDraw",ci,word:value*4294967296});return value;};`);
 const bp=join(temporary,'bushes.mts');writeFileSync(bp,absolute(bs));
 let ms=replaceOnce(mapSource,'import { placeEliteBushes } from "./bushes";',`import {placeEliteBushes as __actualBushes} from ${JSON.stringify(pathToFileURL(bp).href)};`);
 ms=replaceOnce(ms,'mulberry32, randInt as rngInt, shuffle','mulberry32 as __actualMulberry32, randInt as rngInt, shuffle');
 ms=absolute(ms)+`\nconst mulberry32=(seed:number):Rng=>{const rng=__actualMulberry32(seed);return()=>{const value=rng();(globalThis as any).__rhBushObserver?.({type:"mainDraw",word:value*4294967296});return value;};};
const placeEliteBushes=(input:any)=>{(globalThis as any).__rhBushObserver?.({type:"before",input});const placed=__actualBushes(input);(globalThis as any).__rhBushObserver?.({type:"after",input,placed});return placed;};\n`;
 const mp=join(temporary,'mapgen.mts');writeFileSync(mp,ms);
 const observed=await import(pathToFileURL(mp).href),direct=await import(pathToFileURL(bp).href);
 const host=globalThis as typeof globalThis & {__rhBushObserver?:(e:any)=>void};
 function run(invoke:()=>unknown) {
  let before:any=null,after:any=null,placed:number|undefined,mainBefore=0,mainAfter=0;const mainWords:number[]=[],streams:any[]=[];
  host.__rhBushObserver=(e:any)=>{
   if(e.type==='mainDraw')mainWords.push(e.word);
   else if(e.type==='before'){before=plain(e.input);mainBefore=mainWords.length;}
   else if(e.type==='after'){after=plain(e.input);placed=e.placed;mainAfter=mainWords.length;}
   else if(e.type==='stream')streams.push({ci:e.ci,zone:e.zone,seed:e.seed,words:[]});
   else if(e.type==='bushDraw'){const s=streams.find(s=>s.ci===e.ci);if(!s)throw new Error('draw without stream');s.words.push(e.word);}
  };
  let final;try{final=invoke();}finally{delete host.__rhBushObserver;}
  for(const s of streams){const rng=mulberry32(s.seed);for(const word of s.words)if(rng()*4294967296!==word)throw new Error('bush transcript mismatch');s.continuation=Array.from({length:8},()=>rng()*4294967296);}
  if(before){
   if(mainBefore!==mainAfter)throw new Error('bush stage consumed attempt RNG');
   const immutable=(x:any)=>Object.fromEntries(Object.entries(x).filter(([k])=>!['features','featureOwner'].includes(k)));
   if(!equal(immutable(before),immutable(after)))throw new Error('bush stage changed input layers');
   if(!before.camps.every((c:any,ci:number)=>c.zone>=1&&c.zone<=before.order.length&&before.zone[c.site]===c.zone&&before.territoryGrid[c.site]===ci+1))throw new Error('pre-records CampSite zone/territory mapping changed');
  }
  return {before,after,placed,streams,mainBefore,mainAfter,mainWords,final};
 }
 const cases=[];
 for(const [seed,attempt,styled] of [[0,0,false],[1,0,false],[0,0,true],[1,0,true],[-1,0,false],[4294967297,4294967296,false]] as const){
  const options=styled?{decor:false}:{decor:false,styleZones:null};const baseline=reference.tryAttempt(seed,attempt,options);
  const c=run(()=>observed.tryAttempt(seed,attempt,options));
  if(!equal(baseline,c.final)||(baseline?reference.mapHash(baseline):null)!==(c.final?observed.mapHash(c.final):null))throw new Error('observed final map/hash differs');
  if(!c.before||c.before.features.length===0||!c.before.camps.some((c:any)=>c.elite))throw new Error('case lacks actual landmark/elite inputs');
  cases.push({seed,attempt,styled,input:c.before,features:c.after.features,featureOwner:c.after.featureOwner,placed:c.placed,streams:c.streams,mainBefore:c.mainBefore,mainAfter:c.mainAfter,mainWords:c.mainWords,finalVerified:true,finalHash:c.final?observed.mapHash(c.final):null});
 }
 function unit(name:string,input:any){host.__rhBushObserver=undefined;const before=plain(input);const streams:any[]=[];host.__rhBushObserver=(e:any)=>{if(e.type==='stream')streams.push({ci:e.ci,zone:e.zone,seed:e.seed,words:[]});else if(e.type==='bushDraw')streams.find(s=>s.ci===e.ci).words.push(e.word);};let placed;try{placed=direct.placeEliteBushes(input);}finally{delete host.__rhBushObserver;}for(const s of streams){const rng=mulberry32(s.seed);for(const word of s.words)if(rng()*4294967296!==word)throw new Error('unit transcript');s.continuation=Array.from({length:8},()=>rng()*4294967296);}return{name,input:before,features:plain(input.features),featureOwner:plain(input.featureOwner),placed,streams};}
 const units=[];
 function grid(w:number,h:number,site:number){const n=w*h;return{w,h,seed:17,attempt:0,tiles:new Uint8Array(n),terrain:new Uint8Array(n),zone:new Uint8Array(n).fill(1),territoryGrid:new Uint8Array(n).fill(1),protect:new Uint8Array(n),pool5:new Uint8Array(n),camps:[{site,zone:1,elite:true,spots:[]}],order:['fire'],features:[],featureOwner:new Uint16Array(n),terrainNone:0};}
 // Direct helper boundary inputs, explicitly not claimed as generated map seeds.
 units.push(unit('clipped-corner-without-avoid',grid(15,15,0)));
 const empty=grid(15,15,7*15+7);empty.protect.fill(1);units.push(unit('all-protected-no-draw',empty));
 const isolated=grid(15,15,7*15+7);isolated.protect.fill(1);isolated.protect[7*15+11]=0;units.push(unit('undersized-patch-no-feature',isolated));
 const exclusions=grid(21,21,10*21+10);exclusions.terrain.fill(1);for(let y=1;y<20;y++)for(let x=1;x<20;x++)if(x%2===0)exclusions.terrain[y*21+x]=0;
 (exclusions as any).avoid=new Uint8Array(441);for(let t=0;t<441;t++){if(t%7===0)(exclusions as any).avoid[t]=1;if(t%11===0)exclusions.pool5[t]=1;}units.push(unit('thin-floor-with-avoid-and-pool',exclusions));
 const result={format:'rh-bushes/1',node:process.version,platform:process.platform,arch:process.arch,mapSourceSha256:sha(mapSource),bushSourceSha256:sha(bushSource),observationOnlyFinalEqualityVerified:true,campZoneConvention:'one-based internal zone; territoryGrid=internal camp index+1 at camp centre; hash zone=camp.zone-1',cases,units};
 const fixture=fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/bushes.json',import.meta.url)),output=JSON.stringify(result)+'\n';
 if(process.argv.includes('--check')){if(readFileSync(fixture,'utf8')!==output)throw new Error('bush capture differs');}else writeFileSync(fixture,output);
 console.log(`bushes ${process.argv.includes('--check')?'match':'captured'}: ${cases.length} actual stage-11b maps, ${units.length} direct boundaries`);
}finally{rmSync(temporary,{recursive:true,force:true});}

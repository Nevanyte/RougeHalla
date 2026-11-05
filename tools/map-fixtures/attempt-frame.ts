/** Real mapgen stage-3 observations, not a reconstructed prefix pipeline.
 * Linux x64 Node22.23.4: node --import tsx tools/map-fixtures/attempt-frame.ts [--check]
 * No packages or pins are written. Temporary source copy changes import URLs/binding
 * alias only, appends export-only exposure, and inserts read-only observation taps.
 * Its complete final map/null and mapHash must match an unmodified real invocation.
 */
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import * as reference from '../../packages/shared/src/mapgen.ts';
import {mulberry32} from '../../packages/shared/src/rng.ts';
const sourcePath=fileURLToPath(new URL('../../packages/shared/src/mapgen.ts',import.meta.url));
const original=readFileSync(sourcePath,'utf8');
let transformed=original;
function once(old:string,next:string):void {
 if(transformed.split(old).length!==2)throw new Error(`actual source capture anchor changed: ${old}`);
 transformed=transformed.replace(old,next);
}
once('mulberry32, randInt as rngInt, shuffle','mulberry32 as __actualMulberry32, randInt as rngInt, shuffle');
once('    part = partitionZones(rng);','    part = partitionZones(rng);\n    (globalThis as any).__rhAttemptObserver?.({type:"partition",round:tryNo+1,partition:part});');
once('    layout = placeCamps(rng, part);','    layout = placeCamps(rng, part);\n    (globalThis as any).__rhAttemptObserver?.({type:"camps",round:tryNo+1,layout});');
once('  const styleCamps: StyleCamp[] = camps.map((c, i) => ({ site: c.site, r: CAMP_R, territory: i + 1, elite: c.elite }));',
 '  const styleCamps: StyleCamp[] = camps.map((c, i) => ({ site: c.site, r: CAMP_R, territory: i + 1, elite: c.elite }));\n  (globalThis as any).__rhAttemptObserver?.({type:"frame",frame:{seed,attempt,pillarVariant:F.pillars.indexOf(pillar),order,partition:part,layout,tiles,clearing,styleCamps}});');
transformed=transformed.replace(/(from\s+["'])(\.[^"']+)(["'])/g,(_,before,specifier,after)=>{
 const absolute=resolve(dirname(sourcePath),specifier)+'.ts';readFileSync(absolute);return before+pathToFileURL(absolute).href+after;
});
transformed+='\n// Observational binding wrapper: actual RNG implementation and every consumer statement remain intact.\n'+
 'const mulberry32 = (initial:number):Rng => { const actual=__actualMulberry32(initial); (globalThis as any).__rhAttemptObserver?.({type:"stream",initial}); return () => { const value=actual(); (globalThis as any).__rhAttemptObserver?.({type:"draw",word:value*4294967296}); return value; }; };\n'+
 'export {buildMap as __observedBuildMap,LAYOUT_TRIES as __layoutTries};\n';
const plain=(x:unknown):any=>ArrayBuffer.isView(x)?Array.from(x as unknown as ArrayLike<number>):Array.isArray(x)?x.map(plain):x!==null&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;
const bits=(n:number):string=>{const buffer=new ArrayBuffer(8),v=new DataView(buffer);v.setFloat64(0,n,false);return v.getBigUint64(0,false).toString(16).padStart(16,'0');};
const temporary=mkdtempSync(join(tmpdir(),'rh-attempt-observer-'));
try {
 const copyPath=join(temporary,'mapgen-observed.mts');writeFileSync(copyPath,transformed);
 const observed=await import(pathToFileURL(copyPath).href);
 const host=globalThis as typeof globalThis & {__rhAttemptObserver?: (event:any)=>void};
 function capture(seed:number,attempt:number,styled=false) {
  const words:number[]=[];const events:any[]=[];let initial:number|undefined;let frame:any=null;let prefixLength:number|undefined;
  const options=styled?{decor:false}:{styleZones:null,decor:false};
  const unmodified=reference.tryAttempt(seed,attempt,options);
  host.__rhAttemptObserver=(event:any)=>{
   if(event.type==='stream'){if(initial!==undefined)throw new Error('unexpected second main stream');initial=event.initial;}
   else if(event.type==='draw')words.push(event.word);
   else if(event.type==='frame'){
    // Copy now: stage 8 fills spots and records renumbers territories later.
    frame=plain(event.frame);prefixLength=words.length;
    frame.layoutRounds=events.filter(e=>e.stage==='camps').length;
   }else events.push({stage:event.type,round:event.round,draws:words.length,partition:plain(event.partition??null),layout:plain(event.layout??null)});
  };
  let tapped;
  try {tapped=observed.tryAttempt(seed,attempt,options);}finally {delete host.__rhAttemptObserver;}
  if(JSON.stringify(plain(tapped))!==JSON.stringify(plain(unmodified)))throw new Error(`observer changed final output ${seed}/${attempt}/${styled}`);
  const finalHash=tapped?observed.mapHash(tapped):null;
  if(finalHash!==(unmodified?reference.mapHash(unmodified):null))throw new Error('observer changed final mapHash');
  if(initial===undefined)throw new Error('main RNG was not observed');
  const prefixWords=words.slice(0,prefixLength??words.length);
  const replay=mulberry32(initial);
  for(const expected of prefixWords){if(replay()*4294967296!==expected)throw new Error('actual RNG replay disagrees with observed prefix');}
  const continuation=Array.from({length:8},()=>replay()*4294967296);
  return {seed,attempt,styled,initialBits:bits(initial),initialU32:initial>>>0,words:prefixWords,continuation,events,frame,finalVerified:true,finalHash};
 }
 const cases=[];
 for(const [seed,attempt] of [[0,0],[1,0],[1,1],[2,0],[17,0],[34,0],[49,0],[-1,0],[4294967297,0],[1,4294967296],[-9007199254740991,0],[9007199254740991,9007199254740991],[-9007199254740991,9007199254740991]])cases.push(capture(seed,attempt));
 cases.push(capture(1,0,true));
 const coercions=[0,-0,NaN,Infinity,-Infinity,0.5,-0.5,1.75,-1.75,4294967295,4294967296,4294967297,-4294967297,4294967296.5,-4294967296.5,9007199254740991,-9007199254740991].map(n=>({bits:bits(n),word:n>>>0}));
 const result={format:'rh-attempt-frame/1',node:process.version,platform:process.platform,arch:process.arch,
   actualSourceSha256:createHash('sha256').update(original).digest('hex'),observationOnlyFinalEqualityVerified:true,prefixRules:{layoutTries:observed.__layoutTries},cases,coercions};
 const path=fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/attempt-frame.json',import.meta.url));const output=JSON.stringify(result)+'\n';
 if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==output)throw new Error('attempt-frame capture differs');}else writeFileSync(path,output);
 console.log(`attempt frames ${process.argv.includes('--check')?'match':'captured'}: ${cases.length} complete-prefix cases, ${cases.filter(c=>c.events.some(e=>e.stage==='camps'&&e.layout===null)).length} with actual camp failure/redraw; final equality verified`);
} finally {rmSync(temporary,{recursive:true,force:true});}

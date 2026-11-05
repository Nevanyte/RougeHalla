/** Whole-wall stage-4 runtime oracle. Actual isolated source, observational taps, full output/hash equality.
 * Linux x64 Node22.23.4: node --import tsx tools/map-fixtures/landmark-runtime.ts [--check]
 */
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import * as reference from '../../packages/shared/src/mapgen.ts';
import {ZoneRuntime,makeScratch,zoneInfoOf,landmarkCtx} from '../../packages/shared/src/zoneStyle/context.ts';
import {chamfer} from '../../packages/shared/src/zoneStyle/kit.ts';
const base=fileURLToPath(new URL('../../packages/shared/src/',import.meta.url));
const names=['mapgen.ts','styler.ts','zoneStyle/hook.ts','zoneStyle/styleZones.ts','zoneStyle/context.ts'];
const sources=Object.fromEntries(names.map(n=>[n,readFileSync(join(base,n),'utf8')]));
const plain=(x:unknown):any=>ArrayBuffer.isView(x)?Array.from(x as unknown as ArrayLike<number>):Array.isArray(x)?x.map(plain):x!==null&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;
const equal=(a:unknown,b:unknown)=>JSON.stringify(plain(a))===JSON.stringify(plain(b));
function once(s:string,a:string,b:string){if(s.split(a).length!==2)throw new Error(`source tap changed: ${a}`);return s.replace(a,b);}
function rle(a:ArrayLike<number>){const result:number[][]=[];for(let i=0;i<a.length;i++){const last=result[result.length-1];if(last&&last[0]===a[i])last[1]++;else result.push([a[i],1]);}return result;}
const counters=(rt:any)=>({walls:rt.walls,lows:rt.lows,refused:rt.refused,joinUsed:rt.joinUsed,joinLeft:rt.joinLeft,featuresAdded:rt.featuresAdded});
function snapshot(rt:any){
 if(rt.init.terrain.some((v:number)=>v!==0)||rt.init.tiles.some((v:number)=>v!==0&&v!==1)||rt.init.scratch.depth.some((v:number)=>v!==0))throw new Error('outside whole-wall stage4 closure');
 return {tiles:rle(rt.init.tiles),terrain:rle(rt.init.terrain),featureOwner:rle(rt.init.featureOwner),features:plain(rt.init.features),wrote:rle(rt.init.wrote),reserved:rle(rt.reserved),mark:rle(rt.init.scratch.mark),qa:rle(rt.init.scratch.qa),qb:rle(rt.init.scratch.qb),epoch:rt.init.scratch.epoch,counters:counters(rt),open:rle(Array.from({length:rt.n},(_,i)=>Number(rt.open(i))))};
}
function spec(s:any){if(s.kind!=='landmark'||s.mode!=='whole'||s.groups!==undefined||s.blocks.some((b:any)=>b[1]!=='wall'))throw new Error('unexpected non-whole-wall feature');return{variant:s.variant??'',jobs:s.jobs,anchor:s.anchor,params:s.params??null,blocks:s.blocks.map((b:any)=>b[0]),floor:s.floor??null};}
const temporary=mkdtempSync(join(tmpdir(),'rh-landmark-runtime-'));
try {
 const paths=Object.fromEntries(names.map((n,i)=>[resolve(base,n),join(temporary,`observed${i}.mts`)]));
 for(const name of names){let s=sources[name];
  if(name==='zoneStyle/context.ts'){
   s=once(s,'    this.NB4 = [-init.w, 1, init.w, -1];','    this.NB4 = [-init.w, 1, init.w, -1];\n    (globalThis as any).__rhLandmarkObserver?.({type:"zone",rt:this});');
   s=once(s,'  placeFeature(spec: FeatureSpec): PlacedFeature | null {',`  placeFeature(spec: FeatureSpec): PlacedFeature | null {
    (globalThis as any).__rhLandmarkObserver?.({type:"placeBefore",rt:this,spec});
    const result=this.__actualPlaceFeature(spec);
    (globalThis as any).__rhLandmarkObserver?.({type:"placeAfter",rt:this,spec,result});
    return result;
  }
  __actualPlaceFeature(spec: FeatureSpec): PlacedFeature | null {`);
   for(const sig of ['canBlock(i: number, kind: BlockKind): boolean {','block(i: number, kind: BlockKind): boolean {','release(i: number): boolean {','fenceDetourOk(i: number): boolean {'])s=once(s,sig,sig+'\n    (globalThis as any).__rhLandmarkObserver?.({type:"stateful",method:'+JSON.stringify(sig.split('(')[0])+',rt:this});');
   s=once(s,'reserve: (i) => { if (i >= 0 && i < rt.n) rt.reserved[i] = 1; },','reserve: (i) => { if (i >= 0 && i < rt.n) rt.reserved[i] = 1; (globalThis as any).__rhLandmarkObserver?.({type:"reserve",rt,i}); },');
  }
  if(name==='zoneStyle/styleZones.ts'){const pos=s.indexOf('export function styleLandmarks(');if(pos<0)throw new Error('styleLandmarks absent');s=s.slice(0,pos)+once(s.slice(pos),'  const { w, h } = st;','  (globalThis as any).__rhLandmarkObserver?.({type:"stage",input:st});\n  const { w, h } = st;');}
  s=s.replace(/(from\s+["'])(\.[^"']+)(["'])/g,(_,a,p,b)=>{const original=resolve(dirname(join(base,name)),p)+'.ts';readFileSync(original);return a+pathToFileURL(paths[original]??original).href+b;});
  writeFileSync(paths[resolve(base,name)],s);
 }
 const observed=await import(pathToFileURL(paths[resolve(base,'mapgen.ts')]).href);
 const host=globalThis as typeof globalThis & {__rhLandmarkObserver?:(e:any)=>void};
 const cases:any[]=[];let firstZoneInit:any=null;const firstTwoSpecs:any[]=[];
 for(const [seed,attempt] of [[1,0],[-1,0],[4294967297,4294967296]]){
  const options={decor:false,styleZones:null};const baseline=reference.tryAttempt(seed,attempt,options);let input:any=null,active=false,pending:any=null;const commands:any[]=[];
  host.__rhLandmarkObserver=(e:any)=>{
   if(e.type==='stage')input=plain(e.input);
   else if(e.type==='zone'){
    if(!input||active)throw new Error('zone ordering');const rt=e.rt;
    if(!equal(rt.init.hard,input.protect)||!equal(rt.init.hard,rt.init.noBlock)||rt.init.spawns.length!==0||rt.init.centreWalk!==null)throw new Error('unexpected stage4 context');
    commands.push({type:'zone',index:rt.init.info.index,info:plain(rt.init.info),mask:rle(rt.init.mask),edgeDist:rle(rt.init.edgeDist),camps:plain(rt.init.camps.filter((c:any)=>rt.init.mask[c.y*rt.w+c.x]===1)),snapshot:snapshot(rt)});
   }else if(e.type==='stateful'){if(!active)throw new Error(`unexpected speculative stateful ${e.method}`);}
   else if(e.type==='placeBefore'){
    if(active)throw new Error('nested feature');active=true;pending=spec(e.spec);
    if(seed===1&&e.rt.init.info.faction==='holy'&&firstTwoSpecs.length<2){firstZoneInit??=structuredClone(e.rt.init);firstTwoSpecs.push(structuredClone(e.spec));}
   }else if(e.type==='placeAfter'){if(!active)throw new Error('missing feature begin');active=false;commands.push({type:'place',spec:pending,result:plain(e.result),snapshot:snapshot(e.rt)});}
   else if(e.type==='reserve'){if(active)throw new Error('reserve inside transaction');commands.push({type:'reserve',tile:e.i,snapshot:snapshot(e.rt)});}
  };
  let final;try{final=observed.tryAttempt(seed,attempt,options);}finally{delete host.__rhLandmarkObserver;}
  if(active||!input||!equal(final,baseline)||(final?observed.mapHash(final):null)!==(baseline?reference.mapHash(baseline):null))throw new Error('observations changed complete final output/hash');
  cases.push({name:`actual-${seed}-${attempt}`,input,definition:{joinChecks:128,footprintPercent:4,rimTiles:3},commands,finalVerified:true,finalHash:final?observed.mapHash(final):null});
 }
 // Direct runtime helpers: actual source over explicit inputs/definitions, not fabricated map seeds.
 function helper(name:string,init:any,actions:any[],definition={joinChecks:128,footprintPercent:4,rimTiles:3}){
  init=structuredClone(init);init.caps={joinChecks:definition.joinChecks,footprintPct:definition.footprintPercent,rimTiles:definition.rimTiles,fenceDetour:10};
  const rt:any=new ZoneRuntime(init);const commands:any[]=[];
  for(const a of actions){let result:any=null;if(a.type==='place'){const writer=landmarkCtx(rt);const view={...writer,hard:new Uint8Array(rt.n).fill(1),open:()=>false};result=a.planningOverride?view.placeFeature(a.spec):rt.placeFeature(a.spec);}else if(a.type==='probe')result=rt.canBlock(a.tile,'wall');else rt.reserved[a.tile]=1;commands.push({...a,spec:a.spec?spec(a.spec):undefined,result:plain(result),snapshot:snapshot(rt)});}
  return{name,w:init.w,h:init.h,tiles:rle(initInputTiles(init)),zone:Array.from(init.mask),territory:init.territory?Array.from(init.territory):null,hard:Array.from(init.hard),faction:init.info.faction,index:init.info.index,definition,info:plain(init.info),commands};
 }
 // helper captures initial tiles before mutation, rather than reconstructing from expected outputs.
 function initInputTiles(init:any){return init.__initialTiles;}
 const reduced=structuredClone(firstZoneInit);reduced.__initialTiles=reduced.tiles.slice();
 const units=[helper('actual-seed1-holy-two-requests-budget2',reduced,firstTwoSpecs.map(spec=>({type:'place',spec})),{joinChecks:2,footprintPercent:4,rimTiles:3}),helper('same-real-second-request-without-failed-first',reduced,[{type:'place',spec:firstTwoSpecs[1]}],{joinChecks:2,footprintPercent:4,rimTiles:3})];
 function grid(w:number,h:number){const n=w*h,tiles=new Uint8Array(n),mask=new Uint8Array(n).fill(1),edgeDist=chamfer(mask,w,h);return{w,h,seed:0,attempt:0,info:zoneInfoOf(1,'fire',mask,tiles,edgeDist,w,h),mask,hard:new Uint8Array(n),noBlock:new Uint8Array(n),noProp:new Uint8Array(n),tiles,terrain:new Uint8Array(n),props:[],edgeDist,territory:new Uint8Array(n).fill(1),camps:[],caps:{},scratch:makeScratch(n),wrote:new Uint8Array(n),propKinds:[],features:[],featureOwner:new Uint16Array(n),spawns:[],centreWalk:null,__initialTiles:tiles.slice()};}
 const whole=(blocks:number[],floor:number[]|undefined=undefined)=>({kind:'landmark',variant:'direct-runtime-helper',jobs:['landmark'],anchor:[0,0],blocks:blocks.map(t=>[t,'wall']),floor,mode:'whole'});
 const dup=grid(13,13);units.push(helper('duplicate-write-whole-rollback-and-floor-dedup',dup,[{type:'place',spec:whole([6*13+6,6*13+6])},{type:'place',spec:whole([],[-1,6*13+6,6*13+6,9999])},{type:'place',spec:whole([],[])}],{joinChecks:128,footprintPercent:100,rimTiles:0}));
 const seam=grid(13,13);for(let y=0;y<13;y++)for(let x=7;x<13;x++)seam.mask[y*13+x]=0;seam.edgeDist=chamfer(seam.mask,13,13);seam.info=zoneInfoOf(1,'fire',seam.mask,seam.tiles,seam.edgeDist,13,13);units.push(helper('floor-seam-refusal-and-reservation',seam,[{type:'place',spec:whole([6*13+6])},{type:'reserve',tile:5*13+4},{type:'place',spec:whole([5*13+4])}],{joinChecks:128,footprintPercent:100,rimTiles:0}));
 const cut=grid(13,13);cut.tiles.fill(1);for(let x=2;x<=10;x++)cut.tiles[6*13+x]=0;cut.__initialTiles=cut.tiles.slice();cut.info=zoneInfoOf(1,'fire',cut.mask,cut.tiles,cut.edgeDist,13,13);units.push(helper('actual-zone-and-territory-cut-probes',cut,[{type:'probe',tile:6*13+6},{type:'place',spec:whole([6*13+6])}],{joinChecks:2,footprintPercent:100,rimTiles:0}));
 const territory=grid(13,13);territory.territory.fill(2);for(let x=2;x<=10;x++)territory.territory[6*13+x]=1;units.push(helper('territory-cut-with-globally-open-floor',territory,[{type:'probe',tile:6*13+6},{type:'place',spec:whole([6*13+6])}],{joinChecks:2,footprintPercent:100,rimTiles:0}));
 const overlay=grid(13,13);units.push(helper('planning-hard-open-overlay-keeps-original-transaction-mask',overlay,[{type:'place',spec:whole([6*13+6]),planningOverride:true}],{joinChecks:128,footprintPercent:100,rimTiles:0}));
 units.push(helper('zero-footprint-refuses-before-joins',grid(13,13),[{type:'place',spec:whole([6*13+6])}],{joinChecks:128,footprintPercent:0,rimTiles:0}));
 units.push(helper('rim-three-refuses-distance-two-and-accepts-exact-three',grid(13,13),[{type:'place',spec:whole([1*13+1])},{type:'place',spec:whole([2*13+2])}],{joinChecks:128,footprintPercent:100,rimTiles:3}));
 const sourceSha256=Object.fromEntries(names.map(n=>[n,createHash('sha256').update(sources[n]).digest('hex')]));
 const result={format:'rh-landmark-runtime/1',node:process.version,platform:process.platform,arch:process.arch,sourceSha256,observationOnlyFinalEqualityVerified:true,noSpeculativeStatefulCalls:true,cases,units};
 const fixture=fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/landmark-runtime.json',import.meta.url)),output=JSON.stringify(result)+'\n';
 if(process.argv.includes('--check')){if(readFileSync(fixture,'utf8')!==output)throw new Error('landmark runtime capture differs');}else writeFileSync(fixture,output);
 console.log(`landmark runtime ${process.argv.includes('--check')?'match':'captured'}: ${cases.length} real full command streams, ${units.length} direct boundaries`);
}finally{rmSync(temporary,{recursive:true,force:true});}

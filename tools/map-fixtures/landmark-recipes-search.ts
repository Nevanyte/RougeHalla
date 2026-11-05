/** Observational exact-search oracle. No score recipe is copied or evaluated twice. */
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {hashSeed,mulberry32} from '../../packages/shared/src/rng.ts';
import * as legacy from '../../packages/shared/src/mapgen.ts';
import {FORGE} from '../../packages/shared/src/zoneStyle/scorch.ts';
import {WATCHTOWER} from '../../packages/shared/src/zoneStyle/rime.ts';
import {GUARD_HOUSE} from '../../packages/shared/src/zoneStyle/gallows.ts';
import {SHRINE} from '../../packages/shared/src/zoneStyle/sanctum.ts';
import {BURROW} from '../../packages/shared/src/zoneStyle/warren.ts';
import {chamfer} from '../../packages/shared/src/zoneStyle/kit.ts';
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw Error('capture requires Linux x64 Node 22.23.4');

const plain=(v:any):any=>ArrayBuffer.isView(v)?Array.from(v):Array.isArray(v)?v.map(plain):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])):v;
const rle=(a:ArrayLike<number>)=>{const out:number[][]=[];for(let i=0;i<a.length;i++){const last=out[out.length-1];if(last&&last[0]===a[i])last[1]++;else out.push([a[i],1]);}return out;};
const bits=(v:number)=>{const b=Buffer.alloc(8);b.writeDoubleBE(v);return b.toString('hex');};
function once(s:string,n:string,r:string){if(s.split(n).length!==2)throw Error(`tap no longer unique: ${n}`);return s.replace(n,r);}
const temporary=mkdtempSync(join(tmpdir(),'rh-landmark-search-'));
const base=fileURLToPath(new URL('../../packages/shared/src/',import.meta.url));
const names=['mapgen.ts','styler.ts','zoneStyle/hook.ts','zoneStyle/styleZones.ts','zoneStyle/context.ts','zoneStyle/landmarks.ts','zoneStyle/scorch.ts','zoneStyle/warren.ts','zoneStyle/rime.ts','zoneStyle/sanctum.ts','zoneStyle/gallows.ts','zoneStyle/kit.ts','zoneStyle/features.ts','zoneStyle/scale.ts','rng.ts','coliseum.ts','gridTopology.ts','map.ts','zoneStyle/types.ts'];
const paths=new Map(names.map(n=>[resolve(base,n),join(temporary,n.replace(/\.ts$/,'.mts'))]));
const hashes:Record<string,string>={};
for(const name of names){let s=readFileSync(join(base,name),'utf8');hashes[name]=createHash('sha256').update(s).digest('hex');
 if(name==='mapgen.ts'){
 s=once(s,'mulberry32, randInt as rngInt, shuffle','mulberry32 as __actualMulberry32, randInt as rngInt, shuffle');
 s=once(s,'    landmarkHook({ w: W, h: H, seed, attempt, tiles, zone, zoneFaction: order, protect: lprot, territoryGrid, camps: styleCamps, features, featureOwner });','    (globalThis as any).__rhRecipeMain?.({type:"before"});\n    landmarkHook({ w: W, h: H, seed, attempt, tiles, zone, zoneFaction: order, protect: lprot, territoryGrid, camps: styleCamps, features, featureOwner });\n    (globalThis as any).__rhRecipeMain?.({type:"after",output:{tiles,featureOwner,features}});(globalThis as any).__rhSearchObserver?.({type:"stageEnd"});');
 s+='\nconst mulberry32=(initial:number):Rng=>{const actual=__actualMulberry32(initial);(globalThis as any).__rhRecipeMain?.({type:"stream",initial});return()=>{const v=actual();(globalThis as any).__rhRecipeMain?.({type:"draw",word:v*4294967296});return v;};};\n';
 }
 if(name==='zoneStyle/context.ts')s=once(s,'    reserve: (i) => { if (i >= 0 && i < rt.n) rt.reserved[i] = 1; },','    reserve: (i) => { if (i >= 0 && i < rt.n) rt.reserved[i] = 1; (globalThis as any).__rhSearchObserver?.({type:"reservation",tile:i,rt}); },');
 if(name==='zoneStyle/context.ts'){
  s=once(s,'    this.NB4 = [-init.w, 1, init.w, -1];','    this.NB4 = [-init.w, 1, init.w, -1];\n    (globalThis as any).__rhSearchObserver?.({type:"zoneStart",rt:this});');
  s=once(s,'export function landmarkCtx(rt: ZoneRuntime): LandmarkCtx {\n  return writerOf(rt, 3);\n}',`export function landmarkCtx(rt: ZoneRuntime): LandmarkCtx {const c=writerOf(rt,3);(globalThis as any).__rhSearchContexts?.set(c.placeFeature,rt);const r=c.rng;let draws=0;c.rng=()=>{draws++;return r();};(rt as any).__stream={c,draws:()=>draws};return c;}`);
  s=once(s,'  placeFeature(spec: FeatureSpec): PlacedFeature | null {',`  placeFeature(spec: FeatureSpec): PlacedFeature | null {
    (globalThis as any).__rhSearchObserver?.({type:"transactionStart",rt:this,spec});
    const result=this.__actualPlaceFeature(spec);
    (globalThis as any).__rhSearchObserver?.({type:"transactionEnd",rt:this,result});return result;
  }
  __actualPlaceFeature(spec: FeatureSpec): PlacedFeature | null {`);
  for(const sig of ['canBlock(i: number, kind: BlockKind): boolean {','block(i: number, kind: BlockKind): boolean {','release(i: number): boolean {','fenceDetourOk(i: number): boolean {'])s=once(s,sig,sig+'\n (globalThis as any).__rhSearchObserver?.({type:"stateful"});');
 }
 if(name==='zoneStyle/styleZones.ts'){
  const p=s.indexOf('export function styleLandmarks(');if(p<0)throw Error('landmark stage missing');
  s=s.slice(0,p)+once(s.slice(p),'  const { w, h } = st;','  (globalThis as any).__rhSearchObserver?.({type:"stageInput",input:{w:st.w,h:st.h,tiles:st.tiles,zone:st.zone,protect:st.protect,territoryGrid:st.territoryGrid,featureOwner:st.featureOwner,camps:st.camps}});\n  const { w, h } = st;');
 }
 if(name==='zoneStyle/styleZones.ts')s=once(s,'    styler.landmark(landmarkCtx(rt));','    styler.landmark(landmarkCtx(rt));\n    (globalThis as any).__rhSearchObserver?.({type:"zoneEnd",rt});');
 if(name==='zoneStyle/scorch.ts'){
  s=once(s,'      const ext = excluded(margin);','      const ext = excluded(margin); (globalThis as any).__rhSearchObserver?.({type:"margin",c,k,margin,ext,wallOk});');
  s=once(s,'    centres.push({ x: box.x + box.w / 2, y: box.y + box.h / 2 });','    centres.push({ x: box.x + box.w / 2, y: box.y + box.h / 2 }); (globalThis as any).__rhSearchObserver?.({type:"centres",c,centres,wallOk});');
 }
 if(name==='zoneStyle/landmarks.ts'){
  s=once(s,'export function stampFits(','function __actualStampFits(');
  s+=`\nexport function stampFits(c:LandmarkCtx,s:Stamp):boolean{const result=__actualStampFits(c,s);__obs({type:"fits",c,stamp:s,result});return result;}\n`;

  s=once(s,'export function placeLandmark(','function __actualPlaceLandmark(');
  s=once(s,'export function makeLandmarkSearch(c: LandmarkCtx): LandmarkSearch {','export function makeLandmarkSearch(c: LandmarkCtx): LandmarkSearch {\n __obs({type:"makeSearch",c});');
  s=once(s,'reset: () => { st.tab = null; }','reset: () => { __obs({type:"reset",c,st}); st.tab = null; }');
  s=once(s,'  const sr = opts?.search;','  const sr = opts?.search;\n __obs({type:"opts",c,foreign:sr!==undefined&&sr.context!==c,other:sr?.context});');
  s=once(s,'  const orient = orientationsOf(t);\n  const { w, h } = c;','  __obs({type:"searchStart",c,t,tries,st,hasBound:bound!==undefined});\n  const orient = orientationsOf(t);\n  const { w, h } = c;');
  s=once(s,'        if (c.open(i)) okWall[y * bw + x] = 1;','        const __v=c.open(i); __obs({type:"open",c,i,result:__v}); if (__v) okWall[y * bw + x] = 1;');
  s=once(s,'  if (tab !== null && (tab.features !== features.length || tab.sum !== boxSum(c))) tab = null;','  let __decision=tab===null?"build":"reuse";\n  if (tab !== null && (tab.features !== features.length || tab.sum !== boxSum(c))) {tab=null;__decision="rebuild";}');
  s=once(s,'  const { bw, bh, satWall, satFloor } = tab;','  __obs({type:__decision,c,tab});\n  const { bw, bh, satWall, satFloor } = tab;');
  s=once(s,'  // 2. the best `tries` of them by score','  __obs({type:"candidates",c,values:Array.from({length:n},(_,k)=>[candOrigin[k],candO[k]])});\n  // 2. the best `tries` of them by score');
  s=once(s,'        candOrigin[n] = y0 * w + x0; candO[n] = o; n++;','        candOrigin[n] = y0 * w + x0; candO[n] = o; __obs({type:"candidateAppend",c,origin:candOrigin[n],o:candO[n]}); n++;');
  s=once(s,'      const b = bound(box, o & 3, o >= 4);','      const b = bound(box, o & 3, o >= 4); __obs({type:"bound",c,box,rot:o&3,mirror:o>=4,value:b});');
  s=once(s,'    let sc = score(scratch, o & 3, o >= 4);','    let sc = score(scratch, o & 3, o >= 4); __obs({type:"score",c,stamp:scratch,rot:o&3,mirror:o>=4,value:sc});');
  s=once(s,'  // 3. place the best that the guard accepts','  __obs({type:"shortlist",c,values:Array.from({length:m},(_,k)=>[topOrigin[k],topO[k]])});\n  // 3. place the best that the guard accepts');
  s=once(s,'    const placed = placeLandmark(c, t, s, o & 3, o >= 4);','    const placed = placeLandmark(c, t, s, o & 3, o >= 4); __obs({type:"attempt",c,origin,o,result:placed});');
  s=once(s,'        tab.sum = boxSum(c);','        tab.sum = boxSum(c); __obs({type:"patch",c,tab});');
  s=once(s,'      return placed;\n    }\n  }\n  return null;','      __obs({type:"searchEnd",c,result:placed}); return placed;\n    }\n  }\n  __obs({type:"searchEnd",c,result:null}); return null;');
  s+=`\nfunction __obs(e:any){(globalThis as any).__rhSearchObserver?.(e);}
export function placeLandmark(c:LandmarkCtx,t:LandmarkTemplate,s:Stamp,rot:number,mirror:boolean):PlacedFeature|null{const result=__actualPlaceLandmark(c,t,s,rot,mirror);__obs({type:"place",c,t,stamp:s,rot,mirror,result});return result;}
export { buildTables as __buildTables, boxSum as __boxSum };
`;
 }
 s=s.replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g,(_m,a,p,b)=>{const original=resolve(dirname(join(base,name)),p.replace(/\.(?:ts|js|mts)$/,'')+'.ts');readFileSync(original);return a+pathToFileURL(paths.get(original)??original).href+b;});
 const out=paths.get(resolve(base,name))!;mkdirSync(dirname(out),{recursive:true});writeFileSync(out,s);
}
const observed:any=await import(pathToFileURL(paths.get(resolve(base,'mapgen.ts'))!).href);
const helpers:any=await import(pathToFileURL(paths.get(resolve(base,'zoneStyle/landmarks.ts'))!).href);
const context:any=await import(pathToFileURL(paths.get(resolve(base,'zoneStyle/context.ts'))!).href);
const host=globalThis as any;
function snapshot(rt:any){const s=rt.init;return {tiles:rle(s.tiles),terrain:rle(s.terrain),featureOwner:rle(s.featureOwner),features:plain(s.features),wrote:rle(s.wrote),reserved:rle(rt.reserved),mark:rle(s.scratch.mark),qa:rle(s.scratch.qa),qb:rle(s.scratch.qb),epoch:s.scratch.epoch,counters:{walls:rt.walls,lows:rt.lows,refused:rt.refused,joinUsed:rt.joinUsed,joinLeft:rt.joinLeft,featuresAdded:rt.featuresAdded}};}
function recorder(){const events:any[]=[],states:any[]=[],stateIds=new Map<string,number>();let active:any=null,inTransaction=false,appended:number[][]=[];const identities=new WeakMap<object,number>();let next=1;
 const id=(o:any)=>o===null||o===undefined?null:identities.get(o)??(identities.set(o,next),next++);
 const intern=(s:any)=>{const key=JSON.stringify(s);let i=stateIds.get(key);if(i===undefined){i=states.length;states.push(s);stateIds.set(key,i);}return i;};
 // Every callback still compares the complete current runtime. Native byte comparisons avoid
 // re-encoding unchanged grid arrays thousands of times; copies are observer-owned snapshots.
 const previous=new WeakMap<object,{signature:string,arrays:Buffer[],stateId:number}>();
 const state=(c:any)=>{const rt=host.__rhSearchContexts?.get(c.placeFeature);if(!rt)return null;const s=rt.init;
  const arrays=[s.tiles,s.terrain,s.featureOwner,s.wrote,rt.reserved,s.scratch.mark,s.scratch.qa,s.scratch.qb].map(a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength));
  const signature=JSON.stringify([s.scratch.epoch,rt.walls,rt.lows,rt.refused,rt.joinUsed,rt.joinLeft,rt.featuresAdded,s.features]);
  const p=previous.get(rt);if(p&&p.signature===signature&&arrays.every((a,i)=>Buffer.compare(a,p.arrays[i])===0))return p.stateId;
  const stateId=intern(snapshot(rt));previous.set(rt,{signature,arrays:arrays.map(a=>Buffer.from(a)),stateId});return stateId;
 };
 let stageEnded=false;
 const observer=(e:any)=>{
  if(stageEnded)return;if(e.type==='stageEnd'){stageEnded=true;return;}
  if(e.type==='transactionStart'){if(inTransaction)throw Error('nested transaction');inTransaction=true;const out={type:e.type,spec:plain(e.spec),stateId:intern(snapshot(e.rt))};if(active)active.trace.push(out);else events.push(out);return;}
  if(e.type==='transactionEnd'){if(!inTransaction)throw Error('transaction end without start');inTransaction=false;const out={type:e.type,result:plain(e.result),stateId:intern(snapshot(e.rt))};if(active)active.trace.push(out);else events.push(out);return;}
  if(e.type==='stateful'){if(!inTransaction)throw Error('speculative stateful runtime call');return;}
  if(e.type==='stageInput'){events.push(plain(e));return;}
  if(e.type==='zoneEnd'){const rt=e.rt;const st=rt.__stream;const seed=hashSeed(rt.init.seed,rt.init.attempt,rt.init.info.index,3);const rng=mulberry32(seed);const expected=[rng(),rng(),rng()].map(bits);if(st.draws()!==0)throw Error('landmark RNG drew words');const continuation=[st.c.rng(),st.c.rng(),st.c.rng()].map(bits);if(JSON.stringify(expected)!==JSON.stringify(continuation))throw Error('stream changed');events.push({type:e.type,index:rt.init.info.index,stateId:intern(snapshot(rt)),stream:{seed,noiseSeed:hashSeed(rt.init.seed,rt.init.attempt,rt.init.info.index,103),draws:0,continuation}});return;}
  if(e.type==='margin'||e.type==='centres'){events.push({type:e.type,k:e.k,margin:e.margin,ext:e.ext?rle(e.ext):undefined,wallOk:rle(e.wallOk),centres:e.centres?plain(e.centres):undefined});return;}
  if(e.type==='zoneStart'){const rt=e.rt;events.push({type:e.type,index:rt.init.info.index,info:plain(rt.init.info),infoBits:{centroid:[bits(rt.init.info.centroid.x),bits(rt.init.info.centroid.y)],axis:[bits(rt.init.info.axis.x),bits(rt.init.info.axis.y)]},mask:rle(rt.init.mask),edgeDist:rle(rt.init.edgeDist),stateId:intern(snapshot(rt))});return;}
  if(e.type==='searchStart'){if(active)throw Error('nested search');appended=[];active={type:'search',contextId:id(e.c),sessionId:id(e.st),template:plain(e.t),tries:e.tries,hasBound:e.hasBound,hard:rle(e.c.hard),stateId:state(e.c),trace:[]};events.push(active);return;}
  if(e.type==='candidateAppend'){if(!active)throw Error('candidate outside search');appended.push([e.origin,e.o]);return;}
  if(e.type==='candidates'&&JSON.stringify(appended)!==JSON.stringify(e.values))throw Error('candidate append transcript differs from source arrays');
  if(e.type==='searchEnd'){active.result=plain(e.result);active.finalStateId=state(e.c);active=null;return;}
  if(e.type==='fits'){events.push({type:e.type,stamp:plain(e.stamp),hard:rle(e.c.hard),result:e.result,stateId:state(e.c)});return;}
  if(e.type==='reservation'){const out={type:e.type,tile:e.tile,stateId:intern(snapshot(e.rt))};if(active)active.trace.push(out);else events.push(out);return;}
  if(e.type==='place'){if(!active)events.push({type:'place',template:e.t.key,stamp:plain(e.stamp),rot:e.rot,mirror:e.mirror,result:plain(e.result),stateId:state(e.c)});return;}
  if(e.type==='makeSearch'||e.type==='opts'||e.type==='reset'){events.push({type:e.type,contextId:id(e.c),sessionId:id(e.st),foreign:e.foreign,otherId:id(e.other)});return;}
  const out:any={type:e.type};
  if(e.type==='open'){out.i=e.i;out.result=e.result;}
  if(['build','reuse','rebuild','patch'].includes(e.type))out.tables=plain(e.tab);
  if(e.type==='candidates'||e.type==='shortlist')out.values=plain(e.values);
  if(e.type==='attempt')Object.assign(out,{origin:e.origin,o:e.o,result:plain(e.result),stateId:state(e.c)});
  if(e.type==='bound'||e.type==='score')Object.assign(out,{[e.type==='bound'?'box':'stamp']:plain(e.box??e.stamp),rot:e.rot,mirror:e.mirror,bits:bits(e.value),stateId:state(e.c)});
  if(!active)throw Error('search event outside call: '+e.type);active.trace.push(out);
 };
 return {events,states,observer};
}
const cases:any[]=[];
if(process.env.RH_SEARCH_SCAN){for(let seed=Number(process.env.RH_SEARCH_SCAN_START??2);seed<=Number(process.env.RH_SEARCH_SCAN_END??513);seed++){const hits:string[]=[];host.__rhSearchObserver=(e:any)=>{if(e.type==='searchStart')hits.push(e.t.key);};const output=observed.tryAttempt(seed,0,{decor:false,styleZones:null});delete host.__rhSearchObserver;const baseline=legacy.tryAttempt(seed,0,{decor:false,styleZones:null});if(JSON.stringify(plain(output))!==JSON.stringify(plain(baseline)))throw Error('scan output mismatch');console.log(JSON.stringify({scanSeed:seed,hits}));if(hits.includes('watchtower'))break;}rmSync(temporary,{recursive:true,force:true});process.exit(0);}
const inputs=process.env.RH_SEARCH_SEEDS?JSON.parse(process.env.RH_SEARCH_SEEDS):[[1,0],[-1,0],[4294967297,4294967296],[176,0],[54,0],[17,1],[1,0,true]];
for(const [seed,attempt,styledObserverControl=false] of inputs){
 const main:any={initial:null,words:[],before:null,after:null};host.__rhRecipeMain=(e:any)=>{if(e.type==='stream'){if(main.before===null){main.initial=e.initial;main.words=[];}}else if(e.type==='draw'){if(main.after===null)main.words.push(e.word);}else{const state=((main.initial>>>0)+Math.imul(main.words.length,0x6d2b79f5))>>>0;const rng=mulberry32(state);main[e.type]={draws:main.words.length,state,continuation:[rng(),rng(),rng()].map(bits),output:e.output?plain(e.output):undefined};}};
 const options=styledObserverControl?{decor:false}:{decor:false,styleZones:null};const baseline=legacy.tryAttempt(seed,attempt,options);const r=recorder();host.__rhSearchContexts=new WeakMap();host.__rhSearchObserver=r.observer;
 let output:any;try{output=observed.tryAttempt(seed,attempt,options);}finally{delete host.__rhSearchContexts;delete host.__rhSearchObserver;delete host.__rhRecipeMain;}
 if(JSON.stringify(plain(output))!==JSON.stringify(plain(baseline))||(output?observed.mapHash(output):null)!==(baseline?legacy.mapHash(baseline):null))throw Error(`complete output/hash changed ${seed}:${attempt}`);
 if(JSON.stringify(main.before)!==JSON.stringify({...main.after,output:undefined}))throw Error('main RNG shifted');
 cases.push({main,styledObserverControl,options,name:`actual-${seed}-${attempt}${styledObserverControl?"-styled":""}`,seed,attempt,finalVerified:true,finalHash:output?observed.mapHash(output):null,events:r.events,states:r.states});
}

// Direct calls use the actual exported styler callbacks, on explicitly synthetic runtime inputs.
const units:any[]=[];
const actualScorch:any=await import(pathToFileURL(paths.get(resolve(base,'zoneStyle/scorch.ts'))!).href);
const actualGallows:any=await import(pathToFileURL(paths.get(resolve(base,'zoneStyle/gallows.ts'))!).href);
for(const [name,faction,footprintPct] of [['synthetic-gallows-first-refusal-second-still-runs','sentenced',0],['synthetic-scorch-no-camps','fire',100]] as const){
 const w=60,h=60,n=w*h,mask=new Uint8Array(n),tiles=new Uint8Array(n);for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)mask[y*w+x]=1;
 const edgeDist=chamfer(mask,w,h),hard=new Uint8Array(n);
 const init={w,h,seed:1,attempt:0,info:context.zoneInfoOf(1,faction,mask,tiles,edgeDist,w,h),mask,hard,noBlock:hard,noProp:hard,tiles,terrain:new Uint8Array(n),props:[],edgeDist,territory:null,camps:[],caps:{joinChecks:128,footprintPct,rimTiles:0,fenceDetour:10},scratch:context.makeScratch(n),wrote:new Uint8Array(n),propKinds:[],features:[],featureOwner:new Uint16Array(n),spawns:[],centreWalk:null};
 const r=recorder();host.__rhSearchContexts=new WeakMap();host.__rhSearchObserver=r.observer;
 try{const rt=new context.ZoneRuntime(init),c=context.landmarkCtx(rt);if(faction==='sentenced')actualGallows.gallows.landmark(c);else actualScorch.scorch.landmark(c);r.observer({type:'zoneEnd',rt});}finally{delete host.__rhSearchContexts;delete host.__rhSearchObserver;}
 units.push({name,kind:'synthetic-actual-callback',input:{w,h,seed:1,attempt:0,zone:Array.from(mask),tiles:new Array(n).fill(0),protect:Array.from(hard),definition:{joinChecks:128,footprintPercent:footprintPct,rimTiles:0}},events:r.events,states:r.states});
}
if(Object.keys(hashes).length!==names.length||!cases.length||cases.some(c=>!c.events.some((e:any)=>e.type==='zoneEnd')))throw Error('empty inventory');
const result={format:'rh-landmark-recipes-search/1',node:process.version,platform:process.platform,arch:process.arch,sourceSha256:hashes,actualSourceTaps:true,finalOutputEqualityRequired:true,noSpeculativeStatefulCalls:true,templates:[FORGE,WATCHTOWER,GUARD_HOUSE,SHRINE,BURROW],cases,units};
const path=process.env.RH_FIXTURE_OUT??fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/landmark-recipes-search.json',import.meta.url));
const out=JSON.stringify(result)+'\n';if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==out)throw Error('landmark recipe capture differs');}else writeFileSync(path,out);
console.log(JSON.stringify({cases:cases.map(c=>({name:c.name,hash:c.finalHash,searches:c.events.filter((e:any)=>e.type==='search').map((e:any)=>({template:e.template.key,tries:e.tries,result:e.result}))}))}));
rmSync(temporary,{recursive:true,force:true});

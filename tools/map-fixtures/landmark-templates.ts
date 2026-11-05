/** Actual-caller and direct-helper landmark template/stamp oracle. Linux x64 Node 22.23.4. */
import {readFileSync,writeFileSync,mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {FORGE} from '../../packages/shared/src/zoneStyle/scorch.ts';
import {WATCHTOWER} from '../../packages/shared/src/zoneStyle/rime.ts';
import {SHRINE} from '../../packages/shared/src/zoneStyle/sanctum.ts';
import {BURROW} from '../../packages/shared/src/zoneStyle/warren.ts';
import {GUARD_HOUSE} from '../../packages/shared/src/zoneStyle/gallows.ts';
import {stampTemplate,stampFits,placeLandmark,templateProblems} from '../../packages/shared/src/zoneStyle/landmarks.ts';
import {TILE_FLOOR} from '../../packages/shared/src/map.ts';
import * as legacy from '../../packages/shared/src/mapgen.ts';
const templates=[FORGE,BURROW,WATCHTOWER,SHRINE,GUARD_HOUSE];
const plain=(v:any):any=>ArrayBuffer.isView(v)?Array.from(v):Array.isArray(v)?v.map(plain):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])):v;
const equal=(a:any,b:any)=>JSON.stringify(plain(a))===JSON.stringify(plain(b));
const sha=(p:string)=>createHash('sha256').update(readFileSync(new URL(p,import.meta.url))).digest('hex');
const sourcePath=fileURLToPath(new URL('../../packages/shared/src/zoneStyle/landmarks.ts',import.meta.url));
const temporary=mkdtempSync(join(tmpdir(),'rh-landmark-templates-'));
const observedPath=join(temporary,'landmarks.mts');
let observedSource=readFileSync(sourcePath,'utf8').replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g,(_m,a,p,b)=>a+pathToFileURL(resolve(dirname(sourcePath),p+'.ts')).href+b);
observedSource+='\nexport { orientationsOf as __orientationsOf };\n';
writeFileSync(observedPath,observedSource);
const observed:any=await import(pathToFileURL(observedPath).href);
function once(source:string,needle:string,replacement:string){if(source.split(needle).length!==2)throw new Error(`source tap changed: ${needle}`);return source.replace(needle,replacement);}
function rle(a:ArrayLike<number>){const out:number[][]=[];for(let i=0;i<a.length;i++){const last=out[out.length-1];if(last&&last[0]===a[i])last[1]++;else out.push([a[i],1]);}return out;}
async function captureActualCallbacks(temp:string){
 const base=fileURLToPath(new URL('../../packages/shared/src/',import.meta.url));
 const names=['mapgen.ts','styler.ts','zoneStyle/hook.ts','zoneStyle/styleZones.ts','zoneStyle/context.ts','zoneStyle/landmarks.ts','zoneStyle/scorch.ts','zoneStyle/warren.ts','zoneStyle/rime.ts','zoneStyle/sanctum.ts','zoneStyle/gallows.ts'];
 const originals=Object.fromEntries(names.map(n=>[n,readFileSync(join(base,n),'utf8')]));
 const originalPaths=new Map(names.map(n=>[resolve(base,n),join(temp,n.replace(/\.ts$/,'.mts'))]));
 const sourceHashes=Object.fromEntries(names.map(n=>[n,createHash('sha256').update(originals[n]).digest('hex')]));
 for(const name of names){let src=originals[name];
  if(name==='zoneStyle/landmarks.ts'){
   src=once(src,'export function stampTemplate(','function __rhActualStampTemplate(');
   src=once(src,'export function stampFits(','function __rhActualStampFits(');
   src=once(src,'export function placeLandmark(','function __rhActualPlaceLandmark(');
   src+=`\nconst __rhObs=(event:any)=>{(globalThis as any).__rhLandmarkObserver?.(event);};
const __rhPlain=(v:any):any=>ArrayBuffer.isView(v)?Array.from(v):Array.isArray(v)?v.map(__rhPlain):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,__rhPlain(x)])):v;
const __rhRle=(a:ArrayLike<number>)=>{const out:number[][]=[];for(let i=0;i<a.length;i++){const last=out[out.length-1];if(last&&last[0]===a[i])last[1]++;else out.push([a[i],1]);}return out;};
const __rhRuntime=(c:any)=>{const m=(globalThis as any).__rhLandmarkContexts;return m?.get(c)??m?.get(c.placeFeature);};
const __rhState=(c:any)=>{const rt=__rhRuntime(c);if(!rt)return null;const s=rt.init;return{tiles:__rhRle(s.tiles),terrain:__rhRle(s.terrain),featureOwner:__rhRle(s.featureOwner),features:__rhPlain(s.features),wrote:__rhRle(s.wrote),reserved:__rhRle(rt.reserved),mark:__rhRle(s.scratch.mark),qa:__rhRle(s.scratch.qa),qb:__rhRle(s.scratch.qb),epoch:s.scratch.epoch,counters:{walls:rt.walls,lows:rt.lows,refused:rt.refused,joinUsed:rt.joinUsed,joinLeft:rt.joinLeft,featuresAdded:rt.featuresAdded}};};
const __rhView=(c:any)=>{const n=c.w*c.h;return{w:c.w,h:c.h,mask:__rhRle(c.mask),tiles:__rhRle(c.tiles),hard:__rhRle(c.hard),owned:__rhRle(Array.from({length:n},(_,i)=>Number(c.isOwned(i)))),open:__rhRle(Array.from({length:n},(_,i)=>Number(c.open(i)))),zone:__rhPlain(c.zone),features:__rhPlain(c.zoneFeatures())};};
export function stampTemplate(t:LandmarkTemplate,x0:number,y0:number,rot:0|1|2|3,mirror:boolean,w:number,h:number):Stamp|null{const s=__rhActualStampTemplate(t,x0,y0,rot,mirror,w,h);__rhObs({type:'stamp',template:t.key,x0,y0,rot,mirror,w,h,stamp:__rhPlain(s)});return s;}
export function stampFits(c:LandmarkCtx,s:Stamp):boolean{const view=__rhView(c);const result=__rhActualStampFits(c,s);__rhObs({type:'fits',stamp:__rhPlain(s),view,result,state:__rhState(c)});return result;}
export function placeLandmark(c:LandmarkCtx,t:LandmarkTemplate,s:Stamp,rot:number,mirror:boolean):PlacedFeature|null{const result=__rhActualPlaceLandmark(c,t,s,rot,mirror);__rhObs({type:'placeLandmark',template:t.key,rot,mirror,stamp:__rhPlain(s),result:__rhPlain(result),state:__rhState(c)});return result;}
`;
  }
  if(name==='zoneStyle/context.ts'){
   src=once(src,'    this.NB4 = [-init.w, 1, init.w, -1];','    this.NB4 = [-init.w, 1, init.w, -1];\n    (globalThis as any).__rhLandmarkObserver?.({type:"zoneStart",rt:this});');
   src=once(src,'export function landmarkCtx(rt: ZoneRuntime): LandmarkCtx {\n  return writerOf(rt, 3);\n}',`export function landmarkCtx(rt: ZoneRuntime): LandmarkCtx {\n  const ctx=writerOf(rt,3);\n  (globalThis as any).__rhLandmarkContexts?.set(ctx,rt);\n  (globalThis as any).__rhLandmarkContexts?.set(ctx.placeFeature,rt);\n  return ctx;\n}`);
   src=once(src,'    reserve: (i) => { if (i >= 0 && i < rt.n) rt.reserved[i] = 1; },','    reserve: (i) => { if (i >= 0 && i < rt.n) rt.reserved[i] = 1; (globalThis as any).__rhLandmarkObserver?.({type:"reserve",tile:i,ctx:undefined,state:{reserved:Array.from(rt.reserved)}}); },');
   src=once(src,'    placeFeature: (spec) => rt.placeFeature(spec),','    placeFeature: (spec) => { (globalThis as any).__rhLandmarkObserver?.({type:"placeBefore",spec,rt}); const result=rt.placeFeature(spec); (globalThis as any).__rhLandmarkObserver?.({type:"placeAfter",spec,result,rt}); return result; },');
  }
  if(name==='zoneStyle/styleZones.ts'){const pos=src.indexOf('export function styleLandmarks(');if(pos<0)throw new Error('styleLandmarks absent');src=src.slice(0,pos)+once(src.slice(pos),'  const { w, h } = st;','  (globalThis as any).__rhLandmarkObserver?.({type:"stage",input:{w:st.w,h:st.h,tiles:Array.from(st.tiles),zone:Array.from(st.zone),protect:Array.from(st.protect),territoryGrid:Array.from(st.territoryGrid),featureOwner:Array.from(st.featureOwner),camps:st.camps,zoneFaction:st.zoneFaction}});\n  const { w, h } = st;');}
  src=src.replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g,(_m,a,p,b)=>{const stem=p.replace(/\.(?:ts|js|mts)$/,'');const original=resolve(dirname(join(base,name)),`${stem}.ts`);const target=originalPaths.get(original)??original;readFileSync(original);return a+pathToFileURL(target).href+b;});
  const output=originalPaths.get(resolve(base,name))!;mkdirSync(dirname(output),{recursive:true});writeFileSync(output,src);
 }
 const observedMap:any=await import(pathToFileURL(originalPaths.get(resolve(base,'mapgen.ts'))!).href);
 const host=globalThis as typeof globalThis & {__rhLandmarkObserver?:(e:any)=>void;__rhLandmarkContexts?:WeakMap<object,any>};
 const cases:any[]=[];
 for(const [seed,attempt] of [[1,0],[-1,0],[4294967297,4294967296]]){
  const options={decor:false,styleZones:null};const baseline=legacy.tryAttempt(seed,attempt,options);const events:any[]=[],views:any[]=[],states:any[]=[];const viewIds=new Map<string,number>(),stateIds=new Map<string,number>();
  const intern=(value:any,table:any[],ids:Map<string,number>)=>{const key=JSON.stringify(value);let id=ids.get(key);if(id===undefined){id=table.length;ids.set(key,id);table.push(value);}return id;};
  host.__rhLandmarkContexts=new WeakMap();
  host.__rhLandmarkObserver=(event:any)=>{
   if(event.type==='stage'){events.push({type:'stageInput',input:event.input});return;}
   if(event.type==='zoneStart'){const rt=event.rt;const state=__snapshotRuntime(rt),stateId=intern(state,states,stateIds);events.push({type:'zoneStart',index:rt.init.info.index,info:__plain(rt.init.info),mask:rle(rt.init.mask),edgeDist:rle(rt.init.edgeDist),camps:__plain(rt.init.camps.filter((c:any)=>rt.init.mask[c.y*rt.w+c.x]===1)),stateId});return;}
   if(event.type==='placeBefore'){events.push({type:'featureBefore',spec:__plain(event.spec)});return;}
   if(event.type==='placeAfter'){events.push({type:'featureAfter',spec:__plain(event.spec),result:__plain(event.result)});return;}
   if(event.type==='reserve'){events.push({type:'reserve',tile:event.tile});return;}
   if(event.type==='fits'){const view=__plain(event.view),viewId=intern(view,views,viewIds);events.push({type:'fits',stamp:__plain(event.stamp),result:event.result,viewId});return;}
   if(event.type==='placeLandmark'){const state=__plain(event.state),stateId=intern(state,states,stateIds);events.push({type:'placeLandmark',template:event.template,rot:event.rot,mirror:event.mirror,stamp:__plain(event.stamp),result:__plain(event.result),stateId});return;}
   if(event.type==='stamp')events.push(__plain(event));
  };
  let output:any;try{output=observedMap.tryAttempt(seed,attempt,options);}finally{delete host.__rhLandmarkObserver;delete host.__rhLandmarkContexts;}
  if(!equal(output,baseline)||(output?observedMap.mapHash(output):null)!==(baseline?legacy.mapHash(baseline):null))throw new Error(`actual callback observation changed complete output/hash for ${seed}:${attempt}`);
  if(!events.some(e=>e.type==='stageInput'))throw new Error('actual callback stage input was not tapped');
  cases.push({name:`actual-${seed}-${attempt}`,finalVerified:true,finalHash:output?observedMap.mapHash(output):null,events,views,states});
 }
 const seen=new Set(cases.flatMap(c=>c.events.filter((e:any)=>e.type==='placeLandmark').map((e:any)=>e.template)));
 if(!['forge','burrow','watchtower','shrine','guardHouse'].every(k=>seen.has(k)))throw new Error(`actual attempts did not invoke all five faction templates: ${[...seen].join(',')}`);
 return{sourceHashes,cases};
}
function __plain(v:any):any{return ArrayBuffer.isView(v)?Array.from(v):Array.isArray(v)?v.map(__plain):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,__plain(x)])):v;}
function __snapshotRuntime(rt:any){const s=rt.init;return{tiles:rle(s.tiles),terrain:rle(s.terrain),featureOwner:rle(s.featureOwner),features:__plain(s.features),wrote:rle(s.wrote),reserved:rle(rt.reserved),mark:rle(s.scratch.mark),qa:rle(s.scratch.qa),qb:rle(s.scratch.qb),epoch:s.scratch.epoch,counters:{walls:rt.walls,lows:rt.lows,refused:rt.refused,joinUsed:rt.joinUsed,joinLeft:rt.joinLeft,featuresAdded:rt.featuresAdded}};}
function mock(w:number,h:number,accept=true){const n=w*h;const tiles=new Uint8Array(n).fill(TILE_FLOOR),mask=new Uint8Array(n).fill(1),hard=new Uint8Array(n),owned=new Uint8Array(n),reserved=new Uint8Array(n),reserveEvents:number[]=[];const features:any[]=[],writes:any[]=[];return {w,h,tiles,mask,hard,zone:{bbox:{x:0,y:0,w,h}},open:()=>true,isOwned:(i:number)=>!!owned[i],zoneFeatures:()=>features,placeFeature:(s:any)=>{if(!accept)return null;writes.push(plain(s));const f={id:writes.length-1};features.push({kind:'landmark',bbox:{x:s.anchor[0],y:s.anchor[1],w:s.blocks.length,h:1}});return f;},reserve:(i:number)=>{reserveEvents.push(i);reserved[i]=1;},state:{reserved,reserveEvents,writes,features,owned}};}
function allOrientations(t:any){const out=[];for(let o=0;o<8;o++){const rot=o&3,mirror=o>=4;out.push({rot,mirror,stamp:plain(stampTemplate(t,2,3,rot as 0|1|2|3,mirror,40,40))});}return out;}
const templatesOut=templates.map(t=>({template:plain(t),problems:templateProblems(t)}));
const stamps=templates.map(t=>({key:t.key,orientations:allOrientations(t),changedWidth:{first:plain(stampTemplate(t,2,3,0,false,40,40)),second:plain(stampTemplate(t,2,3,0,false,41,40))},outOfBounds:stampTemplate(t,39,39,1,false,40,40)}));
const sparse:any={key:'direct-sparse-bounds',jobs:['landmark'],rows:['#_d','._c']};
const sparseCases=[{name:'sparse-admission-checks-only-non-underscore-cells',stamp:plain(stampTemplate(sparse,2,2,0,false,8,8))},{name:'sparse-stamp-rejects-non-underscore-outside-grid',stamp:stampTemplate(sparse,6,6,0,false,8,8)}];
const int16OffsetTemplate:any={key:'direct-int16-offset-wrap',jobs:['landmark'],rows:[`${'_'.repeat(32768)}#`]};
const int16OffsetCases=[
 {name:'legacy-int32-offset-overflow-yields-invalid-runtime-index',x0:0,y0:32768,rot:1,mirror:false,w:65537,h:1,stamp:plain(stampTemplate(int16OffsetTemplate,0,32768,1,false,65537,1))},
 {name:'int16-coordinate-wrap-with-valid-final-index',x0:0,y0:32768,rot:1,mirror:false,w:1,h:32769,stamp:plain(stampTemplate(int16OffsetTemplate,0,32768,1,false,1,32769))},
];
const invalidRuntimeGrids=[
 {name:'zero-width-grid',w:0,h:8,sourceStamp:plain(stampTemplate(sparse,0,0,0,false,0,8))},
 {name:'area-exceeds-i32-runtime-index-space',w:46341,h:46341,sourceStamp:plain(stampTemplate(sparse,0,0,0,false,46341,46341))},
];
const sorted=mock(16,16);const doorTemplate={...sparse,rows:['d#d','c.c']};const st=stampTemplate(doorTemplate,3,3,0,true,16,16)!;const fits=stampFits(sorted,st);const placed=placeLandmark(sorted,{...doorTemplate,key:'direct-door-order'},st,0,true);
const refusal=mock(16,16,false);refusal.open=()=>false;const refused=stampFits(refusal,st);const refusedPlace=placeLandmark(refusal,{...sparse,key:'direct-refusal'},st,0,false);
const gapBoundary=mock(16,16);gapBoundary.state.features.push({kind:'landmark',bbox:{x:9,y:3,w:1,h:2}});const gapBoundaryFit=stampFits(gapBoundary,st);
const gapNear=mock(16,16);gapNear.state.features.push({kind:'landmark',bbox:{x:8,y:3,w:1,h:2}});const gapNearFit=stampFits(gapNear,st);
const diag=(t:any)=>{try{return{problems:templateProblems(t)}}catch(e){return{thrown:e instanceof Error?e.message:String(e)}}};
const requirements=templates.map(t=>({key:t.key,orientations:plain(observed.__orientationsOf(t).map((o:any)=>({bw:o.bw,bh:o.bh,count:o.count,full:o.full,dx:o.dx,dy:o.dy,code:o.code,rects:o.rects})))}));
const actualCapture=await captureActualCallbacks(temporary);const actualCallerCases=actualCapture.cases;
const result={format:'rh-landmark-templates/1',node:process.version,platform:process.platform,arch:process.arch,sourceSha256:{landmarks:sha('../../packages/shared/src/zoneStyle/landmarks.ts'),scorch:sha('../../packages/shared/src/zoneStyle/scorch.ts'),warren:sha('../../packages/shared/src/zoneStyle/warren.ts'),rime:sha('../../packages/shared/src/zoneStyle/rime.ts'),sanctum:sha('../../packages/shared/src/zoneStyle/sanctum.ts'),gallows:sha('../../packages/shared/src/zoneStyle/gallows.ts')},actualTemplates:templatesOut,orientationAndWidthCases:stamps,sparseCases,int16OffsetCases,invalidRuntimeGrids,requirements,parserDiagnostics:{invalidCell:diag({key:'bad-cell',jobs:['landmark'],rows:['#?'] } as any),raggedRows:diag({key:'ragged',jobs:['landmark'],rows:['##','#'] } as any)},fits:{name:'direct-fit-and-refusal-helper',fits,refused,gapBoundary:{fits:gapBoundaryFit,feature:gapBoundary.state.features[0]},gapNear:{fits:gapNearFit,feature:gapNear.state.features[0]},fitView:{tiles:Array.from(sorted.tiles),mask:Array.from(sorted.mask),hard:Array.from(sorted.hard),owned:Array.from(sorted.state.owned),features:sorted.state.features,zone:sorted.zone},refusalView:{tiles:Array.from(refusal.tiles),mask:Array.from(refusal.mask),hard:Array.from(refusal.hard),owned:Array.from(refusal.state.owned),features:refusal.state.features,zone:refusal.zone}},placement:{name:'direct-placement-door-sorting-and-reservation-order',stampDoors:st.doors,placed:plain(placed),writes:sorted.state.writes,reserveEvents:sorted.state.reserveEvents,reserved:Array.from(sorted.state.reserved),refusedPlace:plain(refusedPlace),refusedWrites:refusal.state.writes,reserveEventsAfterRefusal:refusal.state.reserveEvents,reservedAfterRefusal:Array.from(refusal.state.reserved)},actualCallerSource:{sourceSha256:actualCapture.sourceHashes,actualSourceTaps:true,finalOutputEqualityRequired:true,cases:actualCallerCases}};
const out=JSON.stringify(result)+'\n',path=process.env.RH_FIXTURE_OUT??fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/landmark-templates.json',import.meta.url));if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==out)throw new Error('landmark template capture differs');}else writeFileSync(path,out);rmSync(temporary,{recursive:true,force:true});console.log(`landmark templates ${process.argv.includes('--check')?'match':'captured'}: five actual faction callback streams, exact stamp/fit taps, direct helper boundaries`);

/** Actual Sentenced stage-six callback capture. Instrumentation observes source caller inputs and
 * complete states; original final-map/null and mapHash equality is mandatory. No source rules edited. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,readdirSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw Error('requires Linux x64 Node22.23.4');
const base=fileURLToPath(new URL('../../packages/shared/src/',import.meta.url));
const plain=(v:any):any=>v===undefined?null:ArrayBuffer.isView(v)?Array.from(v as any):Array.isArray(v)?v.map(plain):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])):v;
const eq=(a:any,b:any)=>isDeepStrictEqual(plain(a),plain(b));
function once(s:string,a:string,b:string){if(s.split(a).length!==2)throw Error(`nonunique observation site: ${a}`);return s.replace(a,b);}
function rle(a:ArrayLike<number>){const out:number[][]=[];for(let i=0;i<a.length;i++){const p=out[out.length-1];if(p&&p[0]===a[i])p[1]++;else out.push([a[i],1]);}return out;}
const hashes:Record<string,string>={};
function hashSources(path:string){for(const e of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){const p=join(path,e.name);if(e.isDirectory())hashSources(p);else if(e.isFile()&&e.name.endsWith('.ts'))hashes[relative(base,p).replaceAll('\\','/')]=createHash('sha256').update(readFileSync(p)).digest('hex');}} hashSources(base);
function counters(rt:any){return{walls:rt.walls,lows:rt.lows,refused:rt.refused,joinUsed:rt.joinUsed,joinLeft:rt.joinLeft,surfaced:rt.surfaced,propsAdded:rt.propsAdded,featuresAdded:rt.featuresAdded};}
function state(rt:any){const i=rt.init;return {w:i.w,h:i.h,tiles:rle(i.tiles),terrain:rle(i.terrain),featureOwner:rle(i.featureOwner),wrote:rle(i.wrote),reserved:rle(rt.reserved),scratch:{mark:rle(i.scratch.mark),qa:rle(i.scratch.qa),qb:rle(i.scratch.qb),depth:rle(i.scratch.depth),epoch:i.scratch.epoch},counters:counters(rt),features:plain(i.features),props:plain(i.props)};}
function initOf(rt:any){const i=rt.init;return{w:i.w,h:i.h,seed:i.seed,attempt:i.attempt,info:plain(i.info),mask:rle(i.mask),hard:rle(i.hard),noBlock:rle(i.noBlock),noProp:rle(i.noProp),edgeDist:rle(i.edgeDist),territory:i.territory?rle(i.territory):null,camps:plain(i.camps),spawns:plain(i.spawns),centreWalk:i.centreWalk?rle(i.centreWalk):null,caps:plain(i.caps)};}
const names=['mapgen.ts','styler.ts','zoneStyle/hook.ts','zoneStyle/styleZones.ts','zoneStyle/context.ts'];
const temp=mkdtempSync(join(tmpdir(),'rh-style-gallows-'));const host=globalThis as any;
const prepared=new Map<string,string>();
function prepare(path:string):string{path=resolve(path);if(prepared.has(path))return prepared.get(path)!;const out=join(temp,'reference',relative(base,path).replace(/\.ts$/,'.mts'));prepared.set(path,out);let source=readFileSync(path,'utf8');source=source.replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g,(_m,a,p,b)=>a+pathToFileURL(prepare(resolve(dirname(path),p.replace(/\.(?:ts|js|mts)$/,'')+'.ts'))).href+b);mkdirSync(dirname(out),{recursive:true});writeFileSync(out,source);return out;}
const reference=await import(pathToFileURL(prepare(join(base,'mapgen.ts'))).href);
const {PROP_KINDS}=await import(pathToFileURL(prepare(join(base,'propKinds.ts'))).href);
const {TERRAINS}=await import(pathToFileURL(prepare(join(base,'terrain.ts'))).href);
const {TILE}=await import(pathToFileURL(prepare(join(base,'constants.ts'))).href);
const {hashSeed,mulberry32}=await import(pathToFileURL(prepare(join(base,'rng.ts'))).href);
const {chamfer,floorComponents}=await import(pathToFileURL(prepare(join(base,'zoneStyle/kit.ts'))).href);
const {walkField16}=await import(pathToFileURL(prepare(join(base,'gridTopology.ts'))).href);
const {gallows,GUARD_HOUSE,makeGallows,gallowsGateOpen,gallowsRowPhase,gallowsMaxGateDistance}=await import(pathToFileURL(prepare(join(base,'zoneStyle/gallows.ts'))).href);
const context=await import(pathToFileURL(prepare(join(base,'zoneStyle/context.ts'))).href);
const {makeRouteGuard}=await import(pathToFileURL(prepare(join(base,'zoneStyle/features.ts'))).href);
const {stampTemplate,placeLandmark}=await import(pathToFileURL(prepare(join(base,'zoneStyle/landmarks.ts'))).href);
let active:any=null;let rows:any[]=[];
const tap={
 zone(rt:any){if(rt.init.info.faction!=='sentenced')return; if(active)throw Error('nested');active={init:initOf(rt),initial:state(rt),phases:[],streams:[]};},
 phase(rt:any,phase:string,plan:any){if(rt.init.info.faction!=='sentenced')return;active.phases.push({phase,plan:plain(plan),state:state(rt)});},
 wrap(c:any,rt:any,stream:number){if(rt.init.info.faction!=='sentenced')return c;let draws=0;const actual=c.rng;const seed=hashSeed(c.seed,c.attempt,c.zone.index,stream);active.streams.push({stream,seed,noiseSeed:hashSeed(c.seed,c.attempt,c.zone.index,stream+100),finish(){const r=mulberry32(seed);for(let k=0;k<draws;k++)r();return{stream,seed,noiseSeed:hashSeed(c.seed,c.attempt,c.zone.index,stream+100),draws,next:[r(),r(),r(),r()]};}});return {...c,rng(){draws++;return actual();}};},
 done(rt:any,plan:any){if(rt.init.info.faction!=='sentenced')return;active.plan=plain(plan);active.final=state(rt);active.streams=active.streams.map((s:any)=>s.finish());rows.push(active);active=null;}
};
try{
 const paths=Object.fromEntries(names.map((n,i)=>[resolve(base,n),join(temp,`observed${i}.mts`)]));
 for(const name of names){let s=readFileSync(join(base,name),'utf8');
  if(name==='zoneStyle/context.ts'){
   for(const name of ['shapeCtx','surfaceCtx','propCtx'])s=once(s,`export function ${name}(`,`function __${name}(`);
   s+=`\nexport function shapeCtx(rt:ZoneRuntime):ShapeCtx {const c=__shapeCtx(rt);return (globalThis as any).__rhGallows?.wrap(c,rt,0)??c;}
export function surfaceCtx(rt:ZoneRuntime):SurfaceCtx {const c=__surfaceCtx(rt);return (globalThis as any).__rhGallows?.wrap(c,rt,2)??c;}
export function propCtx(rt:ZoneRuntime):PropCtx {const c=__propCtx(rt);return (globalThis as any).__rhGallows?.wrap(c,rt,1)??c;}\n`;
  }
  if(name==='zoneStyle/styleZones.ts'){
   const end=s.indexOf('export function styleLandmarks(');let style=s.slice(0,end),tail=s.slice(end);
   style=once(style,'    const before = components < 0 ? floorComponents(st.tiles, w, h).sizes.length : components;','    (globalThis as any).__rhGallows?.zone(rt);\n    const before = components < 0 ? floorComponents(st.tiles, w, h).sizes.length : components;');
   style=once(style,'    styler.surface?.(surfaceCtx(rt), plan);','    (globalThis as any).__rhGallows?.phase(rt,"shape",plan);\n    styler.surface?.(surfaceCtx(rt), plan);\n    (globalThis as any).__rhGallows?.phase(rt,"surface",plan);');
   style=once(style,'    results.push({\n      index: z, faction, blocked:','    (globalThis as any).__rhGallows?.done(rt,plan);\n    results.push({\n      index: z, faction, blocked:');s=style+tail;
  }
  s=s.replace(/(from\s+["'])(\.[^"']+)(["'])/g,(_,a,p,b)=>{const target=resolve(dirname(join(base,name)),p)+'.ts';readFileSync(target);return a+pathToFileURL(paths[target]??prepare(target)).href+b;});writeFileSync(paths[resolve(base,name)],s);
 }
 const observed=await import(pathToFileURL(paths[resolve(base,'mapgen.ts')]).href);
 const cases:any[]=[];
 for(const [seed,attempt,decor] of [[1,0,true],[-1,0,false],[17,1,true],[4294967297,4294967296,false],[2,0,true],[29,2,true]] as const){rows=[];delete host.__rhGallows;const original=reference.tryAttempt(seed,attempt,{decor});host.__rhGallows=tap;const final=observed.tryAttempt(seed,attempt,{decor});if(active||rows.length!==1||!eq(final,original)||(final?observed.mapHash(final):null)!==(original?reference.mapHash(original):null))throw Error(`full map equality ${seed}/${attempt}`);cases.push({name:`actual-${seed}-${attempt}-${decor}`,seed,attempt,decor,completeFinalOutputEquality:true,finalHash:final?observed.mapHash(final):null,...rows[0]});}
 delete host.__rhGallows;
 function grid(w=61,h=61){const n=w*h,mask=new Uint8Array(n),tiles=new Uint8Array(n);for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++)mask[y*w+x]=1;const edgeDist=chamfer(mask,w,h);return{w,h,seed:11,attempt:3,info:context.zoneInfoOf(1,'sentenced',mask,tiles,edgeDist,w,h),mask,hard:new Uint8Array(n),noBlock:new Uint8Array(n),noProp:new Uint8Array(n),tiles,terrain:new Uint8Array(n),props:[],edgeDist,territory:new Uint8Array(n).fill(1),camps:[] as any[],caps:{joinChecks:512,footprintPct:100,rimTiles:0,fenceDetour:10},scratch:context.makeScratch(n),wrote:new Uint8Array(n),propKinds:PROP_KINDS,features:[],featureOwner:new Uint16Array(n),spawns:[],centreWalk:null as any,routeGuard:makeRouteGuard};}
 const units:any[]=[];

 function unit(name:string,i:any,dials:any={},propCalls=1){i.info=context.zoneInfoOf(1,'sentenced',i.mask,i.tiles,i.edgeDist,i.w,i.h);const rt=new context.ZoneRuntime(i);rows=[];tap.zone(rt);const styler=makeGallows(dials);const c=tap.wrap(context.shapeCtx(rt),rt,0);const plan=styler.shape!(c);tap.phase(rt,'shape',plan);if(styler.surface)throw Error('Gallows source unexpectedly added surface');tap.phase(rt,'surface',plan);const pc=tap.wrap(context.propCtx(rt),rt,1);for(let k=0;k<propCalls;k++)styler.props!(pc,plan);tap.done(rt,plan);units.push({name,dials,propCalls,...rows[0]});}
 unit('open-default-rows-square',grid());
 unit('empty-short-box',grid(9,9));
 unit('vertical-axis',(()=>{const i=grid(49,61);for(let y=0;y<25;y++)for(let x=0;x<i.w;x++)i.mask[y*i.w+x]=0;i.edgeDist=chamfer(i.mask,i.w,i.h);return i;})());
 unit('no-square',grid(),{squares:0});
 unit('period-ten-auto-phases',grid(),{period:10});
 unit('odd-period-auto-phases',grid(),{period:11});
 unit('negative-explicit-phases',grid(),{phases:[-5,13,25]});
 unit('fixed-gap-zero-penalty-row-tie',grid(),{gapMin:7,gapMax:7,gapTarget:7,gapPenalty:0});
 unit('tight-spacing-wiggled-rows',grid(),{gapMin:4,gapMax:6,gapTarget:5});
 unit('overlapping-tight-rows-partial-guards',(()=>{const i=grid();i.caps.footprintPct=5;return i;})(),{gapMin:2,gapMax:3,gapTarget:2});
 unit('all-gate-open-no-fence',grid(),{width:12});
 unit('zigzag-blocked-detours',(()=>{const i=grid();for(let y=9;y<i.h-9;y++)for(let x=8;x<i.w-8;x++)if((x%13===0&&y%11<7)||(y%17===0&&x%13<5))i.tiles[y*i.w+x]=1;return i;})());
 unit('partial-guard-budget-piece-trimming',(()=>{const i=grid();i.caps.footprintPct=1.1;i.caps.joinChecks=3;return i;})());
 unit('dense-row-wall-hard-partial-guard-relaxation',(()=>{const i=grid(49,49);const r=mulberry32(12*1009);for(let y=3;y<i.h-3;y++)for(let x=3;x<i.w-3;x++){const j=y*i.w+x,u=r();if(u<0.015)i.tiles[j]=1;else if(u<0.03)i.hard[j]=1;}i.caps.footprintPct=15;return i;})(),{gapMin:1,gapMax:1,gapTarget:1,period:9,width:3,squares:0,route:'none'});
 unit('zero-footprint-no-square-or-rows',(()=>{const i=grid();i.caps.footprintPct=0;return i;})());
 const routeGrid=()=>{const i=grid();i.centreWalk=walkField16(i.tiles,i.w,i.h,[0]);i.spawns=[45*i.w+45,50*i.w+25,30*i.w+50];return i;};
 unit('route-open-corridor',routeGrid(),{route:'open'});
 unit('route-repair-real-walks',routeGrid(),{route:'repair'});
 unit('route-none-ablation',routeGrid(),{route:'none'});
 unit('route-short-row-retention',(()=>{const i=grid(21,41);i.centreWalk=walkField16(i.tiles,i.w,i.h,[0]);i.spawns=[30*i.w+10,35*i.w+15];return i;})(),{period:9,width:3,squares:0});
 unit('route-protected-short-row-keep-feature',(()=>{const i=grid(21,41);i.centreWalk=walkField16(i.tiles,i.w,i.h,[0]);i.spawns=[22*i.w+10];i.hard[i.spawns[0]]=1;return i;})(),{period:9,width:3,squares:0});
 unit('prop-protection',(()=>{const i=grid();i.noProp.fill(1);return i;})());
 unit('prop-cap-repeated-callback',grid(),{},8);
 unit('actual-guard-house-props',(()=>{const i=grid();const rt=new context.ZoneRuntime(i),c=context.landmarkCtx(rt);const s=stampTemplate(GUARD_HOUSE,25,28,1,true,i.w,i.h);if(!s||!placeLandmark(c,GUARD_HOUSE,s,1,true))throw Error('direct actual guardHouse stamp');i.wrote.fill(0);return i;})());
 const gateCases=[];for(const period of [1,2,10,12,64])for(const width of new Set([0,Math.min(3,period),period]))for(const phase of [-13,2,8,25])for(const at of [-2147483648,-13,-1,0,1,2,8,11,12,13,2147483647])gateCases.push({period,width,phase,s:at,result:gallowsGateOpen(at,phase,period,width)});
 const phaseCases=[];for(const phases of [[2,8],[-5,13,25],[2]])for(const index of [-2147483648,-3,-1,0,1,2,3,2147483647])phaseCases.push({phases,index,result:gallowsRowPhase(index,phases)});
 const distanceCases=[];for(const period of [1,2,10,12,64])for(const width of new Set([0,1,period]))distanceCases.push({period,width,result:gallowsMaxGateDistance(period,width)});
 for(const [key,records]of Object.entries({cases,units,gateCases,phaseCases,distanceCases})){const keys=records.map((r:any)=>JSON.stringify(key==='cases'||key==='units'?r.name:key==='gateCases'?[r.s,r.phase,r.period,r.width]:key==='phaseCases'?[r.index,r.phases]:[r.period,r.width]));if(new Set(keys).size!==keys.length)throw Error('duplicate '+key);}
 const result={format:'rh-style-gallows/1',node:process.version,platform:process.platform,arch:process.arch,sourceSha256:hashes,omittedTelemetry:['StyleResult.ms'],gateCases,phaseCases,distanceCases,metadata:{tile:TILE,terrain:plain(TERRAINS.map(({key,tile,home})=>({key,tile,home}))),props:plain(PROP_KINDS)},cases,units};
 const text=JSON.stringify(result)+'\n',output=process.env.RH_STYLE_GALLOWS_OUTPUT??fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/style-gallows.json',import.meta.url));if(process.argv.includes('--check')){if(readFileSync(output,'utf8')!==text)throw Error('capture differs');}else writeFileSync(output,text);
 console.log(JSON.stringify({checked:process.argv.includes('--check'),cases:cases.length,units:units.length,bytes:Buffer.byteLength(text),plans:[...cases,...units].map(c=>({name:c.name,axis:c.plan.axis,rows:c.plan.rows.length,planned:c.plan.planned,relaxed:c.plan.relaxed,repaired:c.plan.repaired,checks:c.plan.checks,props:c.final.props.length}))}));
}finally{delete host.__rhGallows;rmSync(temp,{recursive:true,force:true});}

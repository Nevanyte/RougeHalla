/** Actual Plague stage-six callback capture. Instrumentation observes source caller inputs and
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
const temp=mkdtempSync(join(tmpdir(),'rh-style-warren-'));const host=globalThis as any;
const prepared=new Map<string,string>();
function prepare(path:string):string{path=resolve(path);if(prepared.has(path))return prepared.get(path)!;const out=join(temp,'reference',relative(base,path).replace(/\.ts$/,'.mts'));prepared.set(path,out);let source=readFileSync(path,'utf8');source=source.replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g,(_m,a,p,b)=>a+pathToFileURL(prepare(resolve(dirname(path),p.replace(/\.(?:ts|js|mts)$/,'')+'.ts'))).href+b);mkdirSync(dirname(out),{recursive:true});writeFileSync(out,source);return out;}
const reference=await import(pathToFileURL(prepare(join(base,'mapgen.ts'))).href);
const {PROP_KINDS}=await import(pathToFileURL(prepare(join(base,'propKinds.ts'))).href);
const {TERRAINS}=await import(pathToFileURL(prepare(join(base,'terrain.ts'))).href);
const {TILE}=await import(pathToFileURL(prepare(join(base,'constants.ts'))).href);
const {hashSeed,mulberry32}=await import(pathToFileURL(prepare(join(base,'rng.ts'))).href);
const {chamfer,floorComponents}=await import(pathToFileURL(prepare(join(base,'zoneStyle/kit.ts'))).href);
const {walkField16}=await import(pathToFileURL(prepare(join(base,'gridTopology.ts'))).href);
const {warren,BURROW}=await import(pathToFileURL(prepare(join(base,'zoneStyle/warren.ts'))).href);
const context=await import(pathToFileURL(prepare(join(base,'zoneStyle/context.ts'))).href);
const {makeRouteGuard}=await import(pathToFileURL(prepare(join(base,'zoneStyle/features.ts'))).href);
const {stampTemplate,placeLandmark}=await import(pathToFileURL(prepare(join(base,'zoneStyle/landmarks.ts'))).href);
let active:any=null;let rows:any[]=[];
const tap={
 zone(rt:any){if(rt.init.info.faction!=='plague')return; if(active)throw Error('nested');active={init:initOf(rt),initial:state(rt),phases:[],streams:[]};},
 phase(rt:any,phase:string,plan:any){if(rt.init.info.faction!=='plague')return;active.phases.push({phase,plan:plain(plan),state:state(rt)});},
 wrap(c:any,rt:any,stream:number){if(rt.init.info.faction!=='plague')return c;let draws=0;const actual=c.rng;const seed=hashSeed(c.seed,c.attempt,c.zone.index,stream);active.streams.push({stream,seed,noiseSeed:hashSeed(c.seed,c.attempt,c.zone.index,stream+100),finish(){const r=mulberry32(seed);for(let k=0;k<draws;k++)r();return{stream,seed,noiseSeed:hashSeed(c.seed,c.attempt,c.zone.index,stream+100),draws,next:[r(),r(),r(),r()]};}});return {...c,rng(){draws++;return actual();}};},
 done(rt:any,plan:any){if(rt.init.info.faction!=='plague')return;active.plan=plain(plan);active.final=state(rt);active.streams=active.streams.map((s:any)=>s.finish());rows.push(active);active=null;}
};
try{
 const paths=Object.fromEntries(names.map((n,i)=>[resolve(base,n),join(temp,`observed${i}.mts`)]));
 for(const name of names){let s=readFileSync(join(base,name),'utf8');
  if(name==='zoneStyle/context.ts'){
   for(const name of ['shapeCtx','surfaceCtx','propCtx'])s=once(s,`export function ${name}(`,`function __${name}(`);
   s+=`\nexport function shapeCtx(rt:ZoneRuntime):ShapeCtx {const c=__shapeCtx(rt);return (globalThis as any).__rhWarren?.wrap(c,rt,0)??c;}
export function surfaceCtx(rt:ZoneRuntime):SurfaceCtx {const c=__surfaceCtx(rt);return (globalThis as any).__rhWarren?.wrap(c,rt,2)??c;}
export function propCtx(rt:ZoneRuntime):PropCtx {const c=__propCtx(rt);return (globalThis as any).__rhWarren?.wrap(c,rt,1)??c;}\n`;
  }
  if(name==='zoneStyle/styleZones.ts'){
   const end=s.indexOf('export function styleLandmarks(');let style=s.slice(0,end),tail=s.slice(end);
   style=once(style,'    const before = components < 0 ? floorComponents(st.tiles, w, h).sizes.length : components;','    (globalThis as any).__rhWarren?.zone(rt);\n    const before = components < 0 ? floorComponents(st.tiles, w, h).sizes.length : components;');
   style=once(style,'    styler.surface?.(surfaceCtx(rt), plan);','    (globalThis as any).__rhWarren?.phase(rt,"shape",plan);\n    styler.surface?.(surfaceCtx(rt), plan);\n    (globalThis as any).__rhWarren?.phase(rt,"surface",plan);');
   style=once(style,'    results.push({\n      index: z, faction, blocked:','    (globalThis as any).__rhWarren?.done(rt,plan);\n    results.push({\n      index: z, faction, blocked:');s=style+tail;
  }
  s=s.replace(/(from\s+["'])(\.[^"']+)(["'])/g,(_,a,p,b)=>{const target=resolve(dirname(join(base,name)),p)+'.ts';readFileSync(target);return a+pathToFileURL(paths[target]??prepare(target)).href+b;});writeFileSync(paths[resolve(base,name)],s);
 }
 const observed=await import(pathToFileURL(paths[resolve(base,'mapgen.ts')]).href);
 const cases:any[]=[];
 for(const [seed,attempt,decor] of [[1,0,true],[-1,0,false],[17,1,true],[4294967297,4294967296,false],[2,0,true],[29,2,true]] as const){rows=[];delete host.__rhWarren;const original=reference.tryAttempt(seed,attempt,{decor});host.__rhWarren=tap;const final=observed.tryAttempt(seed,attempt,{decor});if(active||rows.length!==1||!eq(final,original)||(final?observed.mapHash(final):null)!==(original?reference.mapHash(original):null))throw Error(`full map equality ${seed}/${attempt}`);cases.push({name:`actual-${seed}-${attempt}-${decor}`,seed,attempt,decor,completeFinalOutputEquality:true,finalHash:final?observed.mapHash(final):null,...rows[0]});}
 delete host.__rhWarren;
 function grid(w=81,h=81){const n=w*h,mask=new Uint8Array(n),tiles=new Uint8Array(n);for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++)mask[y*w+x]=1;const edgeDist=chamfer(mask,w,h);return{w,h,seed:11,attempt:3,info:context.zoneInfoOf(1,'plague',mask,tiles,edgeDist,w,h),mask,hard:new Uint8Array(n),noBlock:new Uint8Array(n),noProp:new Uint8Array(n),tiles,terrain:new Uint8Array(n),props:[],edgeDist,territory:new Uint8Array(n).fill(1),camps:[] as any[],caps:{joinChecks:512,footprintPct:100,rimTiles:0,fenceDetour:10},scratch:context.makeScratch(n),wrote:new Uint8Array(n),propKinds:PROP_KINDS,features:[],featureOwner:new Uint16Array(n),spawns:[],centreWalk:null as any,routeGuard:makeRouteGuard};}
 const units:any[]=[];
 function unit(name:string,i:any,propCalls=1){i.info=context.zoneInfoOf(1,'plague',i.mask,i.tiles,i.edgeDist,i.w,i.h);const rt=new context.ZoneRuntime(i);rows=[];tap.zone(rt);const c=tap.wrap(context.shapeCtx(rt),rt,0);const plan=warren.shape!(c);tap.phase(rt,'shape',plan);warren.surface!(tap.wrap(context.surfaceCtx(rt),rt,2),plan);tap.phase(rt,'surface',plan);const pc=tap.wrap(context.propCtx(rt),rt,1);for(let k=0;k<propCalls;k++)warren.props!(pc,plan);tap.done(rt,plan);units.push({name,propCalls,...rows[0]});}

 function campGrid(w=81,h=81){const i=grid(w,h);for(const [x,y]of [[10,10],[40,10],[70,10],[10,40],[40,40],[70,40],[10,70],[40,70],[70,70]]){if(x>=w-3||y>=h-3)continue;i.camps.push({x,y,r:3,territory:1,index:i.camps.length,elite:i.camps.length%3===0} as never);}return i;}
 unit('open-nine-camp-roads',campGrid());
 unit('empty-no-camps',grid(9,9));
 unit('road-shorter-than-minimum',(()=>{const i=grid(31,31);i.camps=[{x:10,y:10,r:3,territory:1,index:0,elite:false},{x:24,y:10,r:3,territory:1,index:1,elite:false}] as never;return i;})());
 unit('road-exact-minimum-endpoint-padding',(()=>{const i=grid(41,41);i.camps=[{x:10,y:20,r:3,territory:1,index:0,elite:false},{x:25,y:20,r:3,territory:1,index:1,elite:false}] as never;return i;})());
 unit('partial-barrow-footprint-cap',(()=>{const i=campGrid();i.caps.footprintPct=1.2;return i;})());
 unit('barrows-refused-zero-footprint',(()=>{const i=campGrid();i.caps.footprintPct=0;return i;})());
 unit('protected-centres-and-crescent',(()=>{const i=campGrid();for(let y=24;y<=56;y++)for(let x=24;x<=56;x++){if(x%3===0)i.hard[y*i.w+x]=1;else if(x%3===1)i.noBlock[y*i.w+x]=1;}return i;})());
 unit('prop-protection',(()=>{const i=campGrid();i.noProp.fill(1);return i;})());
 unit('route-core-fringe-cap-and-prune',(()=>{const i=campGrid();i.centreWalk=walkField16(i.tiles,i.w,i.h,[0]);i.spawns=[65*i.w+65,60*i.w+32,28*i.w+62,52*i.w+19];return i;})());
 unit('route-short-walks-to-unowned-floor',(()=>{const i=campGrid();const target=40*i.w+40;i.mask[target]=0;i.edgeDist=chamfer(i.mask,i.w,i.h);i.centreWalk=walkField16(i.tiles,i.w,i.h,[target]);i.spawns=[30*i.w+30,30*i.w+50,50*i.w+30,50*i.w+50];return i;})());
 unit('route-pruning-short-real-walk',(()=>{const i=campGrid();i.centreWalk=walkField16(i.tiles,i.w,i.h,[0]);i.spawns=[31*i.w+32];return i;})());
 unit('route-pruning-short-real-walk-obstacles',(()=>{const i=campGrid();for(let y=20;y<=50;y++)for(let x=20;x<=50;x++)if((x===32||x===48)&&y!==35)i.tiles[y*i.w+x]=1;i.centreWalk=walkField16(i.tiles,i.w,i.h,[0]);i.spawns=[17*i.w+15,37*i.w+37,47*i.w+10];return i;})());
 unit('prop-cap-repeated-callback',campGrid(),8);
 unit('burrow-road-exclusion-and-rubble',(()=>{const i=campGrid();const rt=new context.ZoneRuntime(i),c=context.landmarkCtx(rt);const s=stampTemplate(BURROW,22,6,0,false,i.w,i.h);if(!s||!placeLandmark(c,BURROW,s,0,false))throw Error('direct actual burrow stamp');i.wrote.fill(0);return i;})());
 const result={format:'rh-style-warren/1',node:process.version,platform:process.platform,arch:process.arch,sourceSha256:hashes,omittedTelemetry:['StyleResult.ms'],metadata:{tile:TILE,terrain:plain(TERRAINS.map(({key,tile,home})=>({key,tile,home}))),props:plain(PROP_KINDS)},cases,units};
 const text=JSON.stringify(result)+'\n',output=process.env.RH_STYLE_WARREN_OUTPUT??fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/style-warren.json',import.meta.url));if(process.argv.includes('--check')){if(readFileSync(output,'utf8')!==text)throw Error('capture differs');}else writeFileSync(output,text);
 console.log(JSON.stringify({checked:process.argv.includes('--check'),cases:cases.length,units:units.length,bytes:Buffer.byteLength(text),plans:[...cases,...units].map(c=>({name:c.name,barrows:c.plan.barrows.length,tunnels:c.plan.tunnels.length,bog:c.plan.bog.length,roads:c.plan.roads,props:c.final.props.length}))}));
}finally{delete host.__rhWarren;rmSync(temp,{recursive:true,force:true});}

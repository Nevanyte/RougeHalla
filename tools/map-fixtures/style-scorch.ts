/** Actual Fire stage-six callback capture. Instrumentation observes source caller inputs and
 * complete states; original final-map/null and mapHash equality is mandatory. No source rules edited. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import * as reference from '../../packages/shared/src/mapgen.ts';
import {PROP_KINDS} from '../../packages/shared/src/propKinds.ts';
import {TERRAINS} from '../../packages/shared/src/terrain.ts';
import {TILE} from '../../packages/shared/src/constants.ts';
import {hashSeed,mulberry32} from '../../packages/shared/src/rng.ts';
import {chamfer,floorComponents} from '../../packages/shared/src/zoneStyle/kit.ts';
import {walkField16} from '../../packages/shared/src/gridTopology.ts';
import {scorch,FORGE} from '../../packages/shared/src/zoneStyle/scorch.ts';
import * as context from '../../packages/shared/src/zoneStyle/context.ts';
import {makeRouteGuard} from '../../packages/shared/src/zoneStyle/features.ts';
import {stampTemplate,placeLandmark} from '../../packages/shared/src/zoneStyle/landmarks.ts';
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
const temp=mkdtempSync(join(tmpdir(),'rh-style-scorch-'));const host=globalThis as any;
let active:any=null;let rows:any[]=[];
const tap={
 zone(rt:any){if(rt.init.info.faction!=='fire')return; if(active)throw Error('nested');active={init:initOf(rt),initial:state(rt),phases:[],streams:[]};},
 phase(rt:any,phase:string,plan:any){if(rt.init.info.faction!=='fire')return;active.phases.push({phase,plan:plain(plan),state:state(rt)});},
 wrap(c:any,rt:any,stream:number){if(rt.init.info.faction!=='fire')return c;let draws:number[]=[];const actual=c.rng;const seed=hashSeed(c.seed,c.attempt,c.zone.index,stream);active.streams.push({stream,seed,noiseSeed:hashSeed(c.seed,c.attempt,c.zone.index,stream+100),finish(){const r=mulberry32(seed);for(const value of draws)if(r()!==value)throw Error("stream value mismatch");return{stream,seed,noiseSeed:hashSeed(c.seed,c.attempt,c.zone.index,stream+100),draws:draws.length,values:draws,next:[r(),r(),r(),r()]};}});return {...c,rng(){const value=actual();draws.push(value);return value;}};},
 done(rt:any,plan:any){if(rt.init.info.faction!=='fire')return;active.plan=plain(plan);active.final=state(rt);active.streams=active.streams.map((s:any)=>s.finish());rows.push(active);active=null;}
};
try{
 const paths=Object.fromEntries(names.map((n,i)=>[resolve(base,n),join(temp,`observed${i}.mts`)]));
 for(const name of names){let s=readFileSync(join(base,name),'utf8');
  if(name==='zoneStyle/context.ts'){
   for(const name of ['shapeCtx','surfaceCtx','propCtx'])s=once(s,`export function ${name}(`,`function __${name}(`);
   s+=`\nexport function shapeCtx(rt:ZoneRuntime):ShapeCtx {const c=__shapeCtx(rt);return (globalThis as any).__rhScorch?.wrap(c,rt,0)??c;}
export function surfaceCtx(rt:ZoneRuntime):SurfaceCtx {const c=__surfaceCtx(rt);return (globalThis as any).__rhScorch?.wrap(c,rt,2)??c;}
export function propCtx(rt:ZoneRuntime):PropCtx {const c=__propCtx(rt);return (globalThis as any).__rhScorch?.wrap(c,rt,1)??c;}\n`;
  }
  if(name==='zoneStyle/styleZones.ts'){
   const end=s.indexOf('export function styleLandmarks(');let style=s.slice(0,end),tail=s.slice(end);
   style=once(style,'    const before = components < 0 ? floorComponents(st.tiles, w, h).sizes.length : components;','    (globalThis as any).__rhScorch?.zone(rt);\n    const before = components < 0 ? floorComponents(st.tiles, w, h).sizes.length : components;');
   style=once(style,'    styler.surface?.(surfaceCtx(rt), plan);','    (globalThis as any).__rhScorch?.phase(rt,"shape",plan);\n    styler.surface?.(surfaceCtx(rt), plan);\n    (globalThis as any).__rhScorch?.phase(rt,"surface",plan);');
   style=once(style,'    results.push({\n      index: z, faction, blocked:','    (globalThis as any).__rhScorch?.done(rt,plan);\n    results.push({\n      index: z, faction, blocked:');s=style+tail;
  }
  s=s.replace(/(from\s+["'])(\.[^"']+)(["'])/g,(_,a,p,b)=>{const target=resolve(dirname(join(base,name)),p)+'.ts';readFileSync(target);return a+pathToFileURL(paths[target]??target).href+b;});writeFileSync(paths[resolve(base,name)],s);
 }
 const observed=await import(pathToFileURL(paths[resolve(base,'mapgen.ts')]).href);
 const cases:any[]=[];
 for(const [seed,attempt,decor] of [[1,0,true],[-1,0,false],[17,1,true],[4294967297,4294967296,false],[2,0,true],[29,2,true]] as const){rows=[];delete host.__rhScorch;const original=reference.tryAttempt(seed,attempt,{decor});host.__rhScorch=tap;const final=observed.tryAttempt(seed,attempt,{decor});if(active||rows.length!==1||!eq(final,original)||(final?observed.mapHash(final):null)!==(original?reference.mapHash(original):null))throw Error(`full map equality ${seed}/${attempt}`);cases.push({name:`actual-${seed}-${attempt}-${decor}`,seed,attempt,decor,completeFinalOutputEquality:true,finalHash:final?observed.mapHash(final):null,...rows[0]});}
 delete host.__rhScorch;
 function grid(w=81,h=71,camps=true){const n=w*h,mask=new Uint8Array(n),tiles=new Uint8Array(n);for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++)mask[y*w+x]=1;const edgeDist=chamfer(mask,w,h);const cc=camps?[[Math.floor(w*.25),Math.floor(h*.25)],[Math.floor(w*.75),Math.floor(h*.25)],[Math.floor(w*.25),Math.floor(h*.75)],[Math.floor(w*.75),Math.floor(h*.75)],[Math.floor(w*.5),Math.floor(h*.5)]]:[];return{w,h,seed:11,attempt:3,info:context.zoneInfoOf(1,'fire',mask,tiles,edgeDist,w,h),mask,hard:new Uint8Array(n),noBlock:new Uint8Array(n),noProp:new Uint8Array(n),tiles,terrain:new Uint8Array(n),props:[],edgeDist,territory:new Uint8Array(n).fill(1),camps:cc.map(([x,y],index)=>({x,y,r:3,territory:1,elite:index===4,index})),caps:{joinChecks:512,footprintPct:100,rimTiles:0,fenceDetour:10},scratch:context.makeScratch(n),wrote:new Uint8Array(n),propKinds:PROP_KINDS,features:[],featureOwner:new Uint16Array(n),spawns:[],centreWalk:null as any,routeGuard:makeRouteGuard};}
 const units:any[]=[];
 function unit(name:string,i:any,propCalls=1){i.edgeDist=chamfer(i.mask,i.w,i.h);i.info=context.zoneInfoOf(1,'fire',i.mask,i.tiles,i.edgeDist,i.w,i.h);const rt=new context.ZoneRuntime(i);rows=[];tap.zone(rt);const c=tap.wrap(context.shapeCtx(rt),rt,0);const plan=scorch.shape!(c);tap.phase(rt,'shape',plan);scorch.surface!(tap.wrap(context.surfaceCtx(rt),rt,2),plan);tap.phase(rt,'surface',plan);const pc=tap.wrap(context.propCtx(rt),rt,1);for(let k=0;k<propCalls;k++)scorch.props!(pc,plan);tap.done(rt,plan);units.push({name,propCalls,...rows[0]});}
 unit('open-craters-and-river',grid());
 unit('small-empty-no-draw',grid(9,9,false));
 unit('no-depth-band-one-draw',(()=>{const i=grid(101,71,false);i.mask.fill(0);for(let y=8;y<i.h-8;y++)for(const x0 of [3,i.w-8])for(let x=x0;x<x0+5;x++)i.mask[y*i.w+x]=1;return i;})());
 unit('river-without-camps',grid(61,73,false));
 unit('isolated-elite-crater',(()=>{const i=grid(53,61,false);i.camps=[{x:26,y:30,r:3,territory:1,elite:true,index:0}];return i;})());
 unit('frontier-crescents',(()=>{const i=grid();i.camps[0].x=5;i.camps[2].x=5;i.camps[1].x=i.w-6;return i;})());
 unit('partial-footprint-guards',(()=>{const i=grid();i.caps.footprintPct=4;return i;})());
 unit('all-placement-refused',(()=>{const i=grid();i.caps.footprintPct=0;return i;})());
 unit('routes-cross-craters-and-river',(()=>{const i=grid();i.centreWalk=walkField16(i.tiles,i.w,i.h,[0]);i.spawns=[(i.h-8)*i.w+i.w-8,(i.h-10)*i.w+30,30*i.w+i.w-8];return i;})());
 unit('extra-stretch-breach',(()=>{const i=grid(81,61,false);i.seed=14;i.attempt=0;i.camps=[[36,26],[41,23],[18,26],[52,5],[71,49]].map(([x,y],index)=>({x,y,r:3,territory:1,elite:index===4,index}));i.spawns=[678,463,1798,4247];i.centreWalk=walkField16(i.tiles,i.w,i.h,[30*i.w+40]);return i;})());
 unit('ford-merge-boundary',(()=>{const i=grid(41,71,false);i.seed=51;i.attempt=0;i.camps=[[9,9],[17,10],[13,21],[19,24],[33,63]].map(([x,y],index)=>({x,y,r:3,territory:1,elite:index===4,index}));i.spawns=[2638,435,704,1384];i.centreWalk=walkField16(i.tiles,i.w,i.h,[35*i.w+20]);return i;})());
 unit('protected-river-window',(()=>{const i=grid();for(let y=8;y<i.h-8;y++)for(let x=25;x<30;x++)i.hard[y*i.w+x]=1;for(let x=2;x<i.w-2;x++)i.noBlock[45*i.w+x]=1;return i;})());
 unit('prop-protection',(()=>{const i=grid();i.noProp.fill(1);return i;})());
 unit('prop-cap-repeated-callback',grid(),8);
 unit('forge-restamp-and-door-clearance',(()=>{const i=grid();const rt=new context.ZoneRuntime(i),c=context.landmarkCtx(rt);const s=stampTemplate(FORGE,35,10,1,true,i.w,i.h);if(!s||!placeLandmark(c,FORGE,s,1,true))throw Error('direct real forge stamp');i.wrote.fill(0);return i;})());
 const result={format:'rh-style-scorch/1',node:process.version,platform:process.platform,arch:process.arch,sourceSha256:hashes,omittedTelemetry:['StyleResult.ms'],metadata:{tile:TILE,terrain:plain(TERRAINS.map(({key,tile,home})=>({key,tile,home}))),props:plain(PROP_KINDS)},cases,units};
 const text=JSON.stringify(result)+'\n',output=process.env.RH_STYLE_SCORCH_OUTPUT??fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/style-scorch.json',import.meta.url));if(process.argv.includes('--check')){if(readFileSync(output,'utf8')!==text)throw Error('capture differs');}else writeFileSync(output,text);
 console.log(JSON.stringify({checked:process.argv.includes('--check'),cases:cases.length,units:units.length,bytes:Buffer.byteLength(text),plans:[...cases,...units].map(c=>({name:c.name,craters:c.plan.craters.length,river:c.plan.riverPath.length,lava:c.plan.lava.length,fords:c.plan.fords.length,noEmber:c.plan.noEmber.length,draws:c.streams[0].draws,props:c.final.props.length}))}));
}finally{delete host.__rhScorch;rmSync(temp,{recursive:true,force:true});}

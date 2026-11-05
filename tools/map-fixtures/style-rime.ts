/** Actual Frost stage-six callback capture. Instrumentation observes source caller inputs and
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
import {fixedLayout} from '../../packages/shared/src/coliseum.ts';
import {TILE} from '../../packages/shared/src/constants.ts';
import {hashSeed,mulberry32} from '../../packages/shared/src/rng.ts';
import {chamfer,floorComponents} from '../../packages/shared/src/zoneStyle/kit.ts';
import {walkField16} from '../../packages/shared/src/gridTopology.ts';
import {rime,WATCHTOWER,facetShelfCells} from '../../packages/shared/src/zoneStyle/rime.ts';
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
const temp=mkdtempSync(join(tmpdir(),'rh-style-rime-'));const host=globalThis as any;
let active:any=null;let rows:any[]=[];
const tap={
 zone(rt:any){if(rt.init.info.faction!=='frost')return; if(active)throw Error('nested');active={init:initOf(rt),initial:state(rt),phases:[],streams:[]};},
 phase(rt:any,phase:string,plan:any){if(rt.init.info.faction!=='frost')return;active.phases.push({phase,plan:plain(plan),state:state(rt)});},
 wrap(c:any,rt:any,stream:number){if(rt.init.info.faction!=='frost')return c;let draws=0;const actual=c.rng;const seed=hashSeed(c.seed,c.attempt,c.zone.index,stream);active.streams.push({stream,seed,noiseSeed:hashSeed(c.seed,c.attempt,c.zone.index,stream+100),finish(){const r=mulberry32(seed);for(let k=0;k<draws;k++)r();return{stream,seed,noiseSeed:hashSeed(c.seed,c.attempt,c.zone.index,stream+100),draws,next:[r(),r(),r(),r()]};}});return {...c,rng(){draws++;return actual();}};},
 done(rt:any,plan:any){if(rt.init.info.faction!=='frost')return;active.plan=plain(plan);active.final=state(rt);active.streams=active.streams.map((s:any)=>s.finish());rows.push(active);active=null;}
};
try{
 const paths=Object.fromEntries(names.map((n,i)=>[resolve(base,n),join(temp,`observed${i}.mts`)]));
 for(const name of names){let s=readFileSync(join(base,name),'utf8');
  if(name==='zoneStyle/context.ts'){
   for(const name of ['shapeCtx','surfaceCtx','propCtx'])s=once(s,`export function ${name}(`,`function __${name}(`);
   s+=`\nexport function shapeCtx(rt:ZoneRuntime):ShapeCtx {const c=__shapeCtx(rt);return (globalThis as any).__rhRime?.wrap(c,rt,0)??c;}
export function surfaceCtx(rt:ZoneRuntime):SurfaceCtx {const c=__surfaceCtx(rt);return (globalThis as any).__rhRime?.wrap(c,rt,2)??c;}
export function propCtx(rt:ZoneRuntime):PropCtx {const c=__propCtx(rt);return (globalThis as any).__rhRime?.wrap(c,rt,1)??c;}\n`;
  }
  if(name==='zoneStyle/styleZones.ts'){
   const end=s.indexOf('export function styleLandmarks(');let style=s.slice(0,end),tail=s.slice(end);
   style=once(style,'    const before = components < 0 ? floorComponents(st.tiles, w, h).sizes.length : components;','    (globalThis as any).__rhRime?.zone(rt);\n    const before = components < 0 ? floorComponents(st.tiles, w, h).sizes.length : components;');
   style=once(style,'    styler.surface?.(surfaceCtx(rt), plan);','    (globalThis as any).__rhRime?.phase(rt,"shape",plan);\n    styler.surface?.(surfaceCtx(rt), plan);\n    (globalThis as any).__rhRime?.phase(rt,"surface",plan);');
   style=once(style,'    results.push({\n      index: z, faction, blocked:','    (globalThis as any).__rhRime?.done(rt,plan);\n    results.push({\n      index: z, faction, blocked:');s=style+tail;
  }
  s=s.replace(/(from\s+["'])(\.[^"']+)(["'])/g,(_,a,p,b)=>{const target=resolve(dirname(join(base,name)),p)+'.ts';readFileSync(target);return a+pathToFileURL(paths[target]??target).href+b;});writeFileSync(paths[resolve(base,name)],s);
 }
 const observed=await import(pathToFileURL(paths[resolve(base,'mapgen.ts')]).href);
 const cases:any[]=[];
 for(const [seed,attempt,decor] of [[1,0,true],[-1,0,false],[17,1,true],[4294967297,4294967296,false],[2,0,true],[29,2,true]] as const){rows=[];delete host.__rhRime;const original=reference.tryAttempt(seed,attempt,{decor});host.__rhRime=tap;const final=observed.tryAttempt(seed,attempt,{decor});if(active||rows.length!==1||!eq(final,original)||(final?observed.mapHash(final):null)!==(original?reference.mapHash(original):null))throw Error(`full map equality ${seed}/${attempt}`);cases.push({name:`actual-${seed}-${attempt}-${decor}`,seed,attempt,decor,completeFinalOutputEquality:true,finalHash:final?observed.mapHash(final):null,...rows[0]});}
 delete host.__rhRime;
 function grid(w=61,h=61){const n=w*h,mask=new Uint8Array(n),tiles=new Uint8Array(n);for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++)mask[y*w+x]=1;const edgeDist=chamfer(mask,w,h);return{w,h,seed:11,attempt:3,info:context.zoneInfoOf(1,'frost',mask,tiles,edgeDist,w,h),mask,hard:new Uint8Array(n),noBlock:new Uint8Array(n),noProp:new Uint8Array(n),tiles,terrain:new Uint8Array(n),props:[],edgeDist,territory:new Uint8Array(n).fill(1),camps:[],caps:{joinChecks:512,footprintPct:100,rimTiles:0,fenceDetour:10},scratch:context.makeScratch(n),wrote:new Uint8Array(n),propKinds:PROP_KINDS,features:[],featureOwner:new Uint16Array(n),spawns:[],centreWalk:null as any,routeGuard:makeRouteGuard};}
 const units:any[]=[];
 function unit(name:string,i:any,propCalls=1,ringBoundary=false){i.info=context.zoneInfoOf(1,'frost',i.mask,i.tiles,i.edgeDist,i.w,i.h);const rt=new context.ZoneRuntime(i);rows=[];tap.zone(rt);const c=tap.wrap(context.shapeCtx(rt),rt,0);let plan=rime.shape!(c);tap.phase(rt,'shape',plan);let surfaceInputPlan=null;if(ringBoundary){const next=plain(plan),dist=fixedLayout().distFp;const cells=[4,5,6,255].map(d=>{const k=Array.from(dist).findIndex((v,k)=>v===d&&i.mask[k]===1&&i.tiles[k]===0);if(k<0)throw Error('ring boundary missing');return k;}).sort((a,b)=>a-b);if(!next.lakes.length)throw Error('boundary requires source lake');next.lakes[0].tiles=cells;next.lakes[0].ice=0;surfaceInputPlan=plain(next);plan=next;}rime.surface!(tap.wrap(context.surfaceCtx(rt),rt,2),plan);tap.phase(rt,'surface',plan);const pc=tap.wrap(context.propCtx(rt),rt,1);for(let k=0;k<propCalls;k++)rime.props!(pc,plan);tap.done(rt,plan);units.push({name,propCalls,surfaceInputPlan,...rows[0]});}
 unit('open-two-lakes',grid());
 unit('empty-small-zone',grid(9,9));
 unit('single-small-lake',grid(31,31));
 unit('wide-two-lakes',grid(81,61));
 unit('vertical-two-basins',grid(35,91));
 unit('protected-clearance-and-ice',(()=>{const i=grid();for(let y=8;y<i.h-8;y++)for(let x=8;x<i.w-8;x++){if(x%13===0)i.hard[y*i.w+x]=1;else if(x%11===0)i.terrain[y*i.w+x]=7;}return i;})());
 unit('shelves-refused-footprint',(()=>{const i=grid();i.caps.footprintPct=0;return i;})());
 unit('shelves-guard-budget-zero',(()=>{const i=grid();i.caps.joinChecks=0;return i;})());
 unit('all-props-excluded',(()=>{const i=grid();i.noProp.fill(1);return i;})());
 unit('props-cap-repeated',grid(),8);
 unit('source-stamped-watchtower',(()=>{const i=grid();const rt=new context.ZoneRuntime(i),c=context.landmarkCtx(rt);const st=stampTemplate(WATCHTOWER,8,8,0,false,i.w,i.h);if(!st||!placeLandmark(c,WATCHTOWER,st,0,false))throw Error('real tower stamp');i.wrote.fill(0);return i;})());
 unit('fixed-grid-ring-clearance',(()=>{const i=grid(160,160);i.centreWalk=walkField16(i.tiles,i.w,i.h,[80*160+80]);i.spawns=[80*160+10,80*160+150,10*160+80,150*160+80];return i;})());
 unit('route-corridor-clearance',(()=>{const i=grid();i.centreWalk=walkField16(i.tiles,i.w,i.h,[0]);i.spawns=[45*i.w+45,42*i.w+30,30*i.w+45];return i;})());
 unit('surface-ring-distance-boundaries',grid(160,160),1,true);
 const facets=[];for(const seed of [0,1,2147483648,4294967295])for(const radius of [1.6,1.9,2.2,2.6,3.2]){const source=mulberry32(seed);let draws=0;const cells=facetShelfCells(()=>{draws++;return source();},radius);facets.push({seed,radius,cells,draws,next:[source(),source(),source(),source()]});}
 const result={format:'rh-style-rime/1',node:process.version,platform:process.platform,arch:process.arch,sourceSha256:hashes,omittedTelemetry:['StyleResult.ms'],metadata:{tile:TILE,terrain:plain(TERRAINS.map(({key,tile,home})=>({key,tile,home}))),props:plain(PROP_KINDS)},cases,units,facets};
 const text=JSON.stringify(result)+'\n',output=process.env.RH_STYLE_RIME_OUTPUT??fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/style-rime.json',import.meta.url));if(process.argv.includes('--check')){if(readFileSync(output,'utf8')!==text)throw Error('capture differs');}else writeFileSync(output,text);
 console.log(JSON.stringify({checked:process.argv.includes('--check'),cases:cases.length,units:units.length,bytes:Buffer.byteLength(text),plans:[...cases,...units].map(c=>({name:c.name,lakes:c.plan.lakes.map((l:any)=>({grown:l.grown,ice:l.ice})),shelves:c.plan.shelves.length,causeway:c.plan.causeway.length,routed:c.plan.routed,props:c.final.props.length}))}));
}finally{delete host.__rhRime;rmSync(temp,{recursive:true,force:true});}

/** Actual stage-six runtime/route oracle. Source copies only observational taps; complete final
 * map/null AND source hash equality are required. Linux x64 Node22.23.4, --check is byte exact.
 * Only StyleResult.ms is omitted: elapsed wall-clock telemetry never feeds map/state/plan.
 */
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
import {chamfer,floorComponents,repairConnectivity} from '../../packages/shared/src/zoneStyle/kit.ts';
import {walkField16} from '../../packages/shared/src/gridTopology.ts';

if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw Error('requires Linux x64 Node22.23.4');
const base=fileURLToPath(new URL('../../packages/shared/src/',import.meta.url));
const names=['mapgen.ts','styler.ts','zoneStyle/hook.ts','zoneStyle/styleZones.ts','zoneStyle/context.ts','zoneStyle/features.ts'];
const source=Object.fromEntries(names.map(n=>[n,readFileSync(join(base,n),'utf8')]));
const plain=(v:any):any=>v===undefined?null:ArrayBuffer.isView(v)?Array.from(v as any):Array.isArray(v)?v.map(plain):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])):v;
const eq=(a:any,b:any)=>isDeepStrictEqual(plain(a),plain(b));
function once(s:string,a:string,b:string){if(s.split(a).length!==2)throw Error(`nonunique observation site: ${a}`);return s.replace(a,b);}
function rle(a:ArrayLike<number>){const out:number[][]=[];for(let i=0;i<a.length;i++){const p=out[out.length-1];if(p&&p[0]===a[i])p[1]++;else out.push([a[i],1]);}return out;}
const hashes:Record<string,string>={};
function hashSources(path:string){for(const e of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){const p=join(path,e.name);if(e.isDirectory())hashSources(p);else if(e.isFile()&&e.name.endsWith('.ts'))hashes[relative(base,p).replaceAll('\\','/')]=createHash('sha256').update(readFileSync(p)).digest('hex');}}
hashSources(base);
function counters(rt:any){return{walls:rt.walls,lows:rt.lows,refused:rt.refused,joinUsed:rt.joinUsed,joinLeft:rt.joinLeft,surfaced:rt.surfaced,propsAdded:rt.propsAdded,featuresAdded:rt.featuresAdded};}
function state(rt:any){const i=rt.init;return {tiles:plain(i.tiles),terrain:plain(i.terrain),featureOwner:plain(i.featureOwner),wrote:plain(i.wrote),reserved:plain(rt.reserved),mark:plain(i.scratch.mark),qa:plain(i.scratch.qa),qb:plain(i.scratch.qb),depth:plain(i.scratch.depth),epoch:i.scratch.epoch,counters:counters(rt),features:plain(i.features),props:plain(i.props)};}
const arrays=['tiles','terrain','featureOwner','wrote','reserved','mark','qa','qb','depth'];
function full(s:any){return Object.fromEntries(Object.entries(s).map(([k,v])=>[k,arrays.includes(k)?rle(v as any):v]));}
function patch(a:any,b:any){const out:any={};for(const k of arrays){const rows:any[]=[];for(let i=0;i<b[k].length;){if(a[k][i]===b[k][i]){i++;continue;}const start=i,values=[];while(i<b[k].length&&a[k][i]!==b[k][i])values.push(b[k][i++]);rows.push([start,rle(values)]);}if(rows.length)out[k]=rows;}for(const k of ['epoch','counters','features','props'])if(!eq(a[k],b[k]))out[k]=b[k];return out;}
function initOf(rt:any){const i=rt.init;return{w:i.w,h:i.h,seed:i.seed,attempt:i.attempt,info:plain(i.info),mask:rle(i.mask),hard:rle(i.hard),noBlock:rle(i.noBlock),noProp:rle(i.noProp),edgeDist:rle(i.edgeDist),territory:i.territory?rle(i.territory):null,camps:plain(i.camps),spawns:plain(i.spawns),centreWalk:i.centreWalk?rle(i.centreWalk):null,caps:plain(i.caps)};}
function spec(s:any){const allowed=['kind','variant','jobs','anchor','params','blocks','groups','floor','mode','minPiece','minSharePermille','minGroups'];for(const k of Object.keys(s))if(!allowed.includes(k))throw Error(`unknown spec field ${k}`);return Object.fromEntries(allowed.map(k=>[k,plain(s[k])]));}
const temp=mkdtempSync(join(tmpdir(),'rh-style-runtime-'));
const host=globalThis as any;
try{
 const paths=Object.fromEntries(names.map((n,i)=>[resolve(base,n),join(temp,`observed${i}.mts`)]));
 for(const name of names){let s=source[name];
  if(name==='zoneStyle/context.ts'){
   for(const name of ['shapeCtx','surfaceCtx','propCtx'])s=once(s,`export function ${name}(`,`function __${name}(`);
   s+=`\nexport function shapeCtx(rt:ZoneRuntime):ShapeCtx {const c=__shapeCtx(rt);return (globalThis as any).__rhStyle?.wrap(c,rt,0)??c;}
export function surfaceCtx(rt:ZoneRuntime):SurfaceCtx {const c=__surfaceCtx(rt);return (globalThis as any).__rhStyle?.wrap(c,rt,2)??c;}
export function propCtx(rt:ZoneRuntime):PropCtx {const c=__propCtx(rt);return (globalThis as any).__rhStyle?.wrap(c,rt,1)??c;}\n`;
  }
  if(name==='zoneStyle/styleZones.ts'){
   const end=s.indexOf('export function styleLandmarks(');if(end<0)throw Error('stage boundary');
   let style=s.slice(0,end),tail=s.slice(end);
   style=once(style,'  const { w, h } = st;','  (globalThis as any).__rhStyle?.stage(st,opts);\n  const { w, h } = st;');
   style=once(style,'    const before = components < 0 ? floorComponents(st.tiles, w, h).sizes.length : components;','    (globalThis as any).__rhStyle?.zone(rt);\n    const before = components < 0 ? floorComponents(st.tiles, w, h).sizes.length : components;');
   style=once(style,'    styler.surface?.(surfaceCtx(rt), plan);','    (globalThis as any).__rhStyle?.finishShape(rt,before,components,repaired);\n    styler.surface?.(surfaceCtx(rt), plan);');
   style=once(style,'    results.push({\n      index: z, faction, blocked:', '    (globalThis as any).__rhStyle?.finishZone(rt,plan);\n    results.push({\n      index: z, faction, blocked:');
   style=once(style,'  return results;','  (globalThis as any).__rhStyle?.results(results);\n  return results;');
   s=style+tail;
  }
  if(name==='zoneStyle/features.ts'){
   s=once(s,'  let worstK = -1;','  let worstK = -1;'); // unique anchor even if source changes
   s=once(s,'  return {\n    members,','  const observedGuard = {\n    members,');
   const ending='    },\n  };\n}';const pos=s.lastIndexOf(ending);if(pos<0)throw Error('route return');
   s=s.slice(0,pos)+s.slice(pos).replace(ending,`    },\n  };\n  (globalThis as any).__rhStyle?.guard(observedGuard,()=>({members,base,corridor,perMember,seedTiles,seedValues,worstK,probe}),c);\n  return observedGuard;\n}`);
  }
  s=s.replace(/(from\s+["'])(\.[^"']+)(["'])/g,(_,a,p,b)=>{const target=resolve(dirname(join(base,name)),p)+'.ts';readFileSync(target);return a+pathToFileURL(paths[target]??target).href+b;});
  writeFileSync(paths[resolve(base,name)],s);
 }
 const observed=await import(pathToFileURL(paths[resolve(base,'mapgen.ts')]).href);
 const context=await import(pathToFileURL(paths[resolve(base,'zoneStyle/context.ts')]).href);
 const features=await import(pathToFileURL(paths[resolve(base,'zoneStyle/features.ts')]).href);
 const cases:any[]=[],units:any[]=[];
 let active:any=null,last:any=null,currentRt:any=null,guardState:(()=>any)|null=null;
 function save(op:string,args:any[],result:any,mutates=false){if(!active)throw Error('operation outside zone');const e:any={op,args:plain(args),result:plain(result)};if(mutates){const next=state(currentRt);e.patch=patch(last,next);last=next;}active.events.push(e);}
 function zone(rt:any){if(active)throw Error('zone not ended');currentRt=rt;guardState=null;last=state(rt);active={init:initOf(rt),initial:full(last),events:[]};}
 function wrap(c:any,rt:any,stream:number){if(rt!==currentRt)throw Error('foreign runtime');const allowed=['w','h','seed','attempt','zone','mask','hard','noBlock','tiles','terrain','edgeDist','territory','camps','rng','noise','at','spawns','centreWalk','zoneFeatures','isOwned',...(stream===0?['caps','canBlock','block','release','fenceDetourOk','reserve','isReserved','open','placeFeature','routeGuard']:stream===2?['canSurface','surface']:['prop'])];if(!eq(Object.keys(c).sort(),allowed.sort()))throw Error('context field inventory changed');
  save('context',[stream],{camps:c.camps,spawns:c.spawns});
  const out={...c};for(const k of ['at','isOwned','open','isReserved','canBlock','block','release','fenceDetourOk','reserve','placeFeature','canSurface','surface','prop']){if(typeof c[k]!=='function')continue;out[k]=(...args:any[])=>{const result=c[k](...args);save(k,k==='placeFeature'?[spec(args[0])]:args,result,['canBlock','block','release','fenceDetourOk','placeFeature'].includes(k));return result;};}
  out.rng=()=>{const r=c.rng();save('rng',[stream],r);return r;};
  out.noise=Object.fromEntries(['hash','value','fbm'].map(k=>[k,(...a:any[])=>{const r=c.noise[k](...a);save('noise',[stream,k,...a],r);return r;}]));
  out.zoneFeatures=()=>{const list=c.zoneFeatures();save('zoneFeatures',[],list);return list.map((f:any)=>new Proxy(f,{get(target,key){if(key!=='p')return target[key];return new Proxy(target.p,{set(p,key,value){const id=rt.init.features.indexOf(f),index=Number(key);if(!Number.isInteger(index)||index<0||index>=p.length)throw Error('unexpected feature write');p[index]=value;save('featureParam',[id,index,value],null,true);return true;}});}}));};
  if(c.routeGuard)out.routeGuard=()=>{const g=c.routeGuard();save('routeGuard',[],guardState?fullGuard(guardState()):null);return g;};return out;
 }
 function fullGuard(g:any){return{members:plain(g.members),base:plain(g.base),corridor:rle(g.corridor),perMember:plain(g.perMember),seedTiles:plain(g.seedTiles),seedValues:plain(g.seedValues),worstK:g.worstK,probe:g.probe?rle(g.probe):null};}
 function guard(g:any,get:()=>any,c:any){if(!active)return;guardState=get;for(const k of ['corridorOf','worstStretch','worstMember','touches']){const actual=g[k].bind(g);g[k]=(...a:any[])=>{const r=actual(...a);save(k,a,r);if(k==='worstStretch')save('guardState',[],fullGuard(get()));return r;};}}
 function finishShape(rt:any,before:number,components:number,repaired:number){const next=state(rt);active.events.push({op:'finishShape',args:[before],result:[components,repaired],patch:patch(last,next)});last=next;}
 function finishZone(rt:any,plan:any){const next=state(rt);active.events.push({op:'finishZone',args:[],result:null,patch:patch(last,next)});active.final=full(next);active.report=null;active.guard=guardState?fullGuard(guardState()):null;
active.streams=active.events.filter((e:any)=>e.op==='context').map((e:any)=>{const stream=e.args[0],seed=hashSeed(rt.init.seed,rt.init.attempt,rt.init.info.index,stream),r=mulberry32(seed),draws=active.events.filter((e:any)=>e.op==='rng'&&e.args[0]===stream);for(const d of draws)if(r()!==d.result)throw Error('stream replay');return{stream,seed,noiseSeed:hashSeed(rt.init.seed,rt.init.attempt,rt.init.info.index,stream+100),draws:draws.length,next:[r(),r(),r(),r()]};});const done=active;active=null;return done;}
 let zones:any[]=[];
 function results(rows:any[]){if(rows.length!==zones.length)throw Error('result inventory');const keys=['index','faction','blocked','walls','low','kept','refused','joinChecks','surfaced','props','repaired','features','ms','plan'];for(let k=0;k<rows.length;k++){if(!eq(Object.keys(rows[k]).sort(),keys.slice().sort()))throw Error('unknown result field');const {ms,...report}=rows[k];if(typeof ms!=='number')throw Error('clock telemetry');zones[k].report=plain(report);}}

 host.__rhStyle={wrap,guard,zone,results,stage(st:any,opts:any){if(active)throw Error('active before stage');},finishShape,finishZone(rt:any,plan:any){zones.push(finishZone(rt,plan));}};
 // First small real case is the default public hook, with all five real callbacks and decor enabled.
 const inventory:[[number,number,boolean],...Array<[number,number,boolean]>]=[[1,0,true],[-1,0,false],[17,1,true],[4294967297,4294967296,false]];
 for(const [seed,attempt,decor] of inventory){zones=[];delete host.__rhStyle;const original=reference.tryAttempt(seed,attempt,{decor});host.__rhStyle={wrap,guard,zone,results,stage(){},finishShape,finishZone(rt:any,plan:any){zones.push(finishZone(rt,plan));}};const final=observed.tryAttempt(seed,attempt,{decor});if(active||zones.length!==5||!eq(final,original)||(final?observed.mapHash(final):null)!==(original?reference.mapHash(original):null))throw Error(`full map/hash equality or zone inventory ${seed}/${attempt}`);cases.push({seed,attempt,decor,completeFinalOutputEquality:true,finalHash:final?observed.mapHash(final):null,zones});}
 // Labelled direct source boundaries; never represented as generated seeds.
 function grid(w=17,h=17){const n=w*h,mask=new Uint8Array(n).fill(1),tiles=new Uint8Array(n),edgeDist=chamfer(mask,w,h);return{w,h,seed:0,attempt:0,info:context.zoneInfoOf(1,'fire',mask,tiles,edgeDist,w,h),mask,hard:new Uint8Array(n),noBlock:new Uint8Array(n),noProp:new Uint8Array(n),tiles,terrain:new Uint8Array(n),props:[],edgeDist,territory:new Uint8Array(n).fill(1),camps:[],caps:{joinChecks:512,footprintPct:100,rimTiles:0,fenceDetour:10},scratch:context.makeScratch(n),wrote:new Uint8Array(n),propKinds:PROP_KINDS,features:[],featureOwner:new Uint16Array(n),spawns:[],centreWalk:null,routeGuard:features.makeRouteGuard};}
 const feature=(blocks:any[],mode='whole',more:any={})=>({kind:'crater',jobs:['pen'],anchor:[8,8],blocks,mode,...more});
 function unit(name:string,i:any,run:(c:any,s:any,p:any,rt:any)=>void){i.info=context.zoneInfoOf(i.info.index,i.info.faction,i.mask,i.tiles,i.edgeDist,i.w,i.h);const rt=new context.ZoneRuntime(i);zone(rt);const c=context.shapeCtx(rt),s=context.surfaceCtx(rt),p=context.propCtx(rt);run(c,s,p,rt);units.push({name,...finishZone(rt,null)});}
 const mid=8*17+8;
 unit('whole-rollback-budget-territory',(()=>{const i=grid();i.territory.fill(2);for(let x=2;x<15;x++)i.territory[8*17+x]=1;i.caps.joinChecks=2;return i;})(),c=>{c.canBlock(mid,'wall');c.placeFeature(feature([[mid-17,'lava'],[mid,'wall']]));c.canBlock(mid,'wall');});
 unit('groups-first-appearance-and-minimum',grid(),c=>{c.placeFeature(feature([[mid,'wall'],[mid+1,'wall'],[mid+17,'fence'],[mid+17,'wall'],[-1,'wall'],[mid+34,'wall']],'groups',{groups:[9,9,-3,-3,5,5],minGroups:2,floor:[mid-1,mid-1,-1]}));});
 unit('trim-duplicate-low-wall-giveback',grid(),c=>{c.placeFeature(feature([[mid,'lava'],[mid,'wall'],[mid+1,'wall'],[mid+2,'wall']],'trim',{minPiece:6,minSharePermille:0}));c.placeFeature(feature([[mid,'lava'],[mid,'wall']],'trim',{minPiece:2,minSharePermille:500,floor:[mid-1]}));});
 unit('trim-duplicate-piece-removed-while-feature-commits',grid(),c=>{c.placeFeature(feature([[mid,'lava'],[mid,'wall'],...Array.from({length:6},(_,k)=>[4*17+3+k,'wall'])],'trim'));});
 unit('low-promotion-bypass-and-release',(()=>{const i=grid();i.tiles[mid]=2;i.terrain[mid]=1;i.noBlock[mid]=1;i.caps.rimTiles=99;return i;})(),c=>{c.reserve(mid);c.block(mid,'wall');c.block(mid+1,'crevasse');c.release(mid+1);c.release(mid);});
 unit('written-low-promotion-refund-release',grid(),c=>{c.block(mid,'lava');c.block(mid,'wall');c.release(mid);c.block(mid+17,'crevasse');c.release(mid+17);c.release(mid+17);});
 unit('surface-ice-ember-landmark-and-margins',(()=>{const i=grid();i.noBlock[mid]=1;i.noBlock[mid+1]=2;i.features.push({kind:'landmark',variant:'probe',zone:'fire',jobs:['landmark'],ax:8,ay:8,p:[],bbox:{x:8,y:8,w:1,h:1},tiles:1});i.featureOwner[mid+2]=1;return i;})(),(c,s)=>{s.surface(mid,'bog');s.surface(mid,'light');s.surface(mid+1,'bog');s.surface(mid+2,'ember');s.surface(mid+2,'light');c.block(mid+3,'lava');s.surface(mid+4,'ember');s.surface(mid+4+17,'ice');s.surface(mid-34,'ice');c.block(mid-35,'wall');s.canSurface(0,'ice');});
 unit('prop-home-class-protection-and-cap',(()=>{const i=grid(5,5);i.caps.rimTiles=0;i.noProp[12]=1;return i;})(),(c,s,p)=>{p.prop(0,2,2,7);p.prop(4,1,1,2);p.prop(8,1,1,2);p.prop(0,1,1,0);p.prop(0,1,1,1);p.prop(0,1,1,2);p.prop(-1,1,1,0);});
 unit('thin-low-and-fence-detour',(()=>{const i=grid();i.tiles.fill(1);for(let y=5;y<=11;y++)for(let x=3;x<=13;x++)i.tiles[y*17+x]=0;i.tiles[mid-1]=2;i.terrain[mid-1]=2;return i;})(),c=>{for(const i of [-1,17*17,-2147483648,2147483647])c.fenceDetourOk(i);for(let x=3;x<=13;x++)c.block(7*17+x,'fence');c.fenceDetourOk(mid);c.placeFeature(feature([[mid,'wall'],[mid+17,'lava']],'whole'));});
 unit('route-baseline-extra-wall-cutoff-and-null',(()=>{const i=grid();i.mask.fill(0);for(let y=2;y<15;y++)for(let x=2;x<15;x++)i.mask[y*17+x]=1;i.edgeDist=chamfer(i.mask,17,17);i.centreWalk=walkField16(i.tiles,17,17,[0]);i.spawns=[mid,mid+1,-1,9999];return i;})(),(c,s)=>{const g=c.routeGuard();g.corridorOf(0);g.corridorOf(-1);g.touches([mid,-1]);g.worstStretch();g.worstMember();s.surface(mid,'bog');g.worstStretch(Array.from({length:17},(_,x)=>7*17+x));g.worstMember();g.worstStretch([mid]);});
 unit('route-finite-ratio-above-i32',(()=>{const i=grid();i.mask.fill(0);i.mask[mid]=1;i.edgeDist=chamfer(i.mask,17,17);i.centreWalk=new Int32Array(17*17).fill(100000000);i.centreWalk[mid]=1;i.spawns=[mid];return i;})(),c=>{const g=c.routeGuard();g.worstStretch();g.worstMember();});
 unit('trim-share-exact-six-of-ten',grid(),c=>{c.placeFeature(feature([...Array.from({length:6},(_,k)=>[8*17+5+k,'wall']),[-1,'wall'],[-2,'wall'],[-3,'wall'],[-4,'wall']],'trim'));});
 unit('low-support-stranding',(()=>{const i=grid();i.tiles.fill(1);i.tiles[mid]=0;i.tiles[mid-1]=2;i.terrain[mid-1]=2;return i;})(),c=>{c.canBlock(mid,'wall');c.block(mid,'lava');});
 unit('floor-only-whole-and-empty-groups',(()=>{const i=grid();i.hard[mid]=1;return i;})(),c=>{c.placeFeature(feature([],'whole',{floor:[mid,mid,mid+1,-1]}));c.placeFeature(feature([],'groups',{floor:[mid+2]}));c.placeFeature(feature([],'trim',{floor:[]}));});
 const repairCases:any[]=[];for(const name of ['two-pieces-owned-bridge','three-pieces-stale-labels','unowned-barrier']){const w=9,h=5,n=w*h,t=new Uint8Array(n).fill(1),terrain=new Uint8Array(n).fill(3),wrote=new Uint8Array(n);for(let x=1;x<8;x++){t[2*w+x]=x===3||x===5?1:0;if(x===3||x===5)wrote[2*w+x]=name==='unowned-barrier'?0:1;}if(name==='two-pieces-owned-bridge')t[2*w+5]=0;const before={tiles:rle(t),terrain:rle(terrain),wrote:rle(wrote)};const comp=floorComponents(t,w,h);const repaired=repairConnectivity(t,terrain,wrote,w,h);repairCases.push({name,w,h,before,components:{comp:rle(comp.comp),sizes:comp.sizes},repaired,after:{tiles:rle(t),terrain:rle(terrain),wrote:rle(wrote)}});}
 delete host.__rhStyle;
 const operations=['at','block','canBlock','canSurface','context','corridorOf','featureParam','fenceDetourOk','finishShape','finishZone','guardState','isOwned','isReserved','noise','open','placeFeature','prop','release','reserve','rng','routeGuard','surface','touches','worstMember','worstStretch','zoneFeatures'];
 const eventCounts=Object.fromEntries(operations.map(op=>[op,0]));
 for(const z of [...cases.flatMap(c=>c.zones),...units])z.events=z.events.map((e:any)=>{const id=operations.indexOf(e.op);if(id<0)throw Error(`unknown operation ${e.op}`);eventCounts[e.op]++;return e.patch===undefined?[id,e.args,e.result]:[id,e.args,e.result,e.patch];});
 const result={operations,eventCounts,format:'rh-style-runtime/1',node:process.version,platform:process.platform,arch:process.arch,sourceSha256:hashes,omittedTelemetry:['StyleResult.ms'],metadata:{tile:TILE,terrain:plain(TERRAINS.map(({key,tile,home})=>({key,tile,home}))),props:plain(PROP_KINDS)},cases,units,repairCases};
 const text=JSON.stringify(result)+'\n',output=process.env.RH_STYLE_RUNTIME_OUTPUT??fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/style-runtime.json',import.meta.url));
 if(process.argv.includes('--check')){if(readFileSync(output,'utf8')!==text)throw Error('style runtime capture differs');}else writeFileSync(output,text);
 console.log(JSON.stringify({checked:process.argv.includes('--check'),cases:cases.length,zones:cases.reduce((n,c)=>n+c.zones.length,0),units:units.length,events:[...cases.flatMap(c=>c.zones),...units].reduce((n,c)=>n+c.events.length,0),bytes:Buffer.byteLength(text)}));
}finally{delete host.__rhStyle;rmSync(temp,{recursive:true,force:true});}

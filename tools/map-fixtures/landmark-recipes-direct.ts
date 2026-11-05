/** Actual helper probes plus observational stream-only contexts. No recipe formulas or selection. */
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import * as legacy from '../../packages/shared/src/mapgen.ts';
import * as kit from '../../packages/shared/src/zoneStyle/kit.ts';
import * as features from '../../packages/shared/src/zoneStyle/features.ts';
import * as scale from '../../packages/shared/src/zoneStyle/scale.ts';
import {hashSeed,mulberry32} from '../../packages/shared/src/rng.ts';
import {fixedLayout,RING_ROAD} from '../../packages/shared/src/coliseum.ts';
import {TILE_FLOOR,TILE_WALL} from '../../packages/shared/src/map.ts';
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw Error('requires Linux x64 Node22.23.4');
const rle=(a:ArrayLike<number>)=>{const o:number[][]=[];for(let i=0;i<a.length;i++){const z=o[o.length-1];if(z&&z[0]===a[i])z[1]++;else o.push([a[i],1]);}return o;};
const bits=(x:number)=>{const b=Buffer.alloc(8);b.writeDoubleBE(x);return b.toString('hex');};
const plain=(v:any):any=>ArrayBuffer.isView(v)?Array.from(v):Array.isArray(v)?v.map(plain):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])):v;
const names=['mapgen.ts','styler.ts','zoneStyle/hook.ts','zoneStyle/styleZones.ts','zoneStyle/context.ts','zoneStyle/landmarks.ts','zoneStyle/scorch.ts','zoneStyle/gallows.ts','zoneStyle/rime.ts','zoneStyle/sanctum.ts','zoneStyle/warren.ts','zoneStyle/kit.ts','zoneStyle/features.ts','zoneStyle/scale.ts','rng.ts','coliseum.ts','gridTopology.ts','map.ts','zoneStyle/types.ts'];
const base=fileURLToPath(new URL('../../packages/shared/src/',import.meta.url));
const temporary=mkdtempSync(join(tmpdir(),'rh-recipes-direct-'));
const paths=new Map(names.map(n=>[resolve(base,n),join(temporary,n.replace(/\.ts$/,'.mts'))]));
const sources:Record<string,string>={};
function once(s:string,n:string,r:string){if(s.split(n).length!==2)throw Error(`nonunique tap ${n}`);return s.replace(n,r);}
// Hash the complete transitive relative-import inventory, including modules not requiring taps.
function hashDependency(path:string){const name=path.slice(base.length);if(sources[name])return;const source=readFileSync(path,'utf8');sources[name]=createHash('sha256').update(source).digest('hex');for(const match of source.matchAll(/(?:from\s+|import\s*)["'](\.{1,2}\/[^"']+)["']/g)){const target=resolve(dirname(path),match[1].replace(/\.(?:ts|js|mts)$/,'')+'.ts');hashDependency(target);}}
hashDependency(resolve(base,'mapgen.ts'));
function tap(s:string,needle:string,event:string){return once(s,needle,needle+`\n (globalThis as any).__rhDirect?.(${event});`);}
for(const n of names){let s=readFileSync(join(base,n),'utf8');sources[n]=createHash('sha256').update(s).digest('hex');
 if(n==='mapgen.ts'){
  s=once(s,'mulberry32, randInt as rngInt, shuffle','mulberry32 as __actualMulberry32, randInt as rngInt, shuffle');
  s+=`\nconst mulberry32=(initial:number):Rng=>{const actual=__actualMulberry32(initial);(globalThis as any).__rhMain?.({type:'initial',initial});return()=>{const v=actual();(globalThis as any).__rhMain?.({type:'draw',word:v*4294967296});return v;};};\n`;
 }
 if(n==='zoneStyle/styleZones.ts'){
  const pos=s.indexOf('export function styleLandmarks(');if(pos<0)throw Error('stage missing');
  s=s.slice(0,pos)+once(s.slice(pos),'  const { w, h } = st;',`  (globalThis as any).__rhDirect?.({type:'stageInput',st});\n  const { w, h } = st;`);
  s=once(s,'    styler.landmark(landmarkCtx(rt));',`    (globalThis as any).__rhDirect?.({type:'zoneStart',rt});\n    styler.landmark(landmarkCtx(rt));\n    (globalThis as any).__rhDirect?.({type:'zoneEnd',rt});`);
  s=once(s,'  return out;\n}\n\n/**\n * Drops',`  (globalThis as any).__rhDirect?.({type:'stageEnd',st});\n  return out;\n}\n\n/**\n * Drops`);
 }
 if(n==='zoneStyle/context.ts'){
  s=once(s,'  return writerOf(rt, 3);',`  const c=writerOf(rt,3); const rng=c.rng;let draws=0;c.rng=()=>{draws++;return rng();};(globalThis as any).__rhDirect?.({type:'context',rt,c,draws:()=>draws});return c;`);
  s=once(s,'    placeFeature: (spec) => rt.placeFeature(spec),',`    placeFeature:(spec)=>{(globalThis as any).__rhDirect?.({type:'transactionBefore',rt,spec});const result=rt.placeFeature(spec);(globalThis as any).__rhDirect?.({type:'transactionAfter',rt,spec,result});return result;},`);
  s=once(s,'    reserve: (i) => { if (i >= 0 && i < rt.n) rt.reserved[i] = 1; },',`    reserve:(i)=>{if(i>=0&&i<rt.n)rt.reserved[i]=1;(globalThis as any).__rhDirect?.({type:'reserve',rt,i});},`);
 }
 if(n==='zoneStyle/landmarks.ts'){
  for(const name of ['stampTemplate','stampFits','placeLandmark'])s=once(s,`export function ${name}(`,`function __actual${name}(`);
  s+=`\nexport function stampTemplate(t:LandmarkTemplate,x0:number,y0:number,rot:0|1|2|3,mirror:boolean,w:number,h:number):Stamp|null{const result=__actualstampTemplate(t,x0,y0,rot,mirror,w,h);(globalThis as any).__rhDirect?.({type:'stamp',template:t.key,x0,y0,rot,mirror,result});return result;}
export function stampFits(c:LandmarkCtx,s:Stamp):boolean{const result=__actualstampFits(c,s);(globalThis as any).__rhDirect?.({type:'fit',stamp:s,result});return result;}
export function placeLandmark(c:LandmarkCtx,t:LandmarkTemplate,s:Stamp,rot:number,mirror:boolean):PlacedFeature|null{const result=__actualplaceLandmark(c,t,s,rot,mirror);(globalThis as any).__rhDirect?.({type:'place',template:t.key,stamp:s,rot,mirror,result});return result;}\n`;
  s=tap(s,'  const sr = opts?.search;',`{type:'searchOptions',c,shared:sr!==undefined}`);
  s=tap(s,'  const orient = orientationsOf(t);\n  const { w, h } = c;',`{type:'searchStart',template:t.key,tries,hasBound:bound!==undefined}`);
  s=once(s,'        if (c.open(i)) okWall[y * bw + x] = 1;',`        const value=c.open(i);(globalThis as any).__rhDirect?.({type:'searchOpen',i,value});if(value)okWall[y*bw+x]=1;`);
  s=tap(s,'    let sc = score(scratch, o & 3, o >= 4);',`{type:'searchScore',stamp:scratch,o,value:sc}`);
  s=once(s,'      return placed;\n    }\n  }\n  return null;',`      (globalThis as any).__rhDirect?.({type:'searchEnd'});return placed;\n    }\n  }\n  (globalThis as any).__rhDirect?.({type:'searchEnd'});return null;`);
  s=once(s,'  if (tab !== null && (tab.features !== features.length || tab.sum !== boxSum(c))) tab = null;',`  let __decision=tab===null?'build':'reuse';if(tab!==null&&(tab.features!==features.length||tab.sum!==boxSum(c))){tab=null;__decision='build';}`);
  s=tap(s,'  const { bw, bh, satWall, satFloor } = tab;',`{type:'searchTables',decision:__decision,tab}`);
  s=tap(s,'  // 2. the best `tries` of them by score (ties: the lower origin, then the lower orientation)',`{type:'searchCandidates',values:Array.from({length:n},(_,k)=>[candOrigin[k],candO[k]])}`);
  s=tap(s,'    const placed = placeLandmark(c, t, s, o & 3, o >= 4);',`{type:'searchAttempt',origin,o,result:placed}`);
  s=tap(s,'        tab.sum = boxSum(c);',`{type:'searchPatch',tab}`);
  s=tap(s,'  // 3. place the best that the guard accepts',`{type:'searchShortlist',values:Array.from({length:m},(_,k)=>[topOrigin[k],topO[k]])}`);
 }
 if(n==='zoneStyle/rime.ts'){
  s+='\nexport { landmark as __directLandmark, placeTower as __directTower, secondSeed as __directSecondSeed };\n';
  s=tap(s,'  const allow = allowField(c, clr);\n  const first = argmaxIn(clr, allow);',`{type:'rimeFields',clr,allow,first}`);
  s=tap(s,'  const cx = w >> 1, cy = h >> 1;',`{type:'rimeSeeds',seeds}`);
  s=tap(s,'    const tx = len > 0 ? sx + Math.round((vx / len) * dist) : sx, ty = len > 0 ? sy + Math.round((vy / len) * dist) : sy;',`{type:'rimeTarget',s,sx,sy,vx,vy,len,dist,tx,ty}`);
  s=tap(s,'  const order = Float64Array.from(keys).sort();',`{type:'rimeKeys',tx,ty,vertical,wx0,wy0,ww,wh,sat,keys,order}`);
  s=once(s,'    if (++tried >= 6) return;',`    if (++tried >= 6) {(globalThis as any).__rhDirect?.({type:'rimeSixFailures',tried});return;}`);
  s=once(s,'  bestLandmark(c, WATCHTOWER, (st: Stamp, rot: number) => {',`  (globalThis as any).__rhDirect?.({type:'rimeFallback',tried});\n  bestLandmark(c, WATCHTOWER, (st: Stamp, rot: number) => {`);
 }
 if(n==='zoneStyle/sanctum.ts'){
  s+='\nexport { hallLandmarks as __directLandmark };\n';
  s=tap(s,'      if (k >= HALL_MIN_PIERS && (best.k === 0 || score > best.score)) best = { x, y, k, score, win, bad };',`{type:'sanctumCandidate',x,y,k,score}`);
  s=tap(s,'  const ax = est.x, ay = est.y; // the pole when no hall fits',`{type:'sanctumScan',axis,r,est,piers:hallLayout(r).piers}`);
  s=tap(s,'    const slots = n === 0 ? slotOrder(axis === 0 ? 0 : 4, true) : slotOrder((first + 8) & 15, false);',`{type:'sanctumSlots',n,first,slots}`);
  s=tap(s,'      const spot = shrineSpot(ax, ay, k, r + SHRINE_GAP + extra);',`{type:'sanctumSpot',n,k,extra,spot}`);
 }
 if(n==='zoneStyle/warren.ts'){
  s+='\nexport { landmark as __directLandmark };\n';
  s=once(s,'  const nodes = zoneNodes(c);\n  if (nodes.length < 2) return;',`  const nodes=zoneNodes(c);(globalThis as any).__rhDirect?.({type:'warrenNodes',nodes});\n  if(nodes.length<2)return;`);
  s=once(s,'function roads(nodes: readonly Node[], min2: number): Road[] {','function __actualRoads(nodes: readonly Node[], min2: number): Road[] {');
  s+=`\nfunction roads(nodes:readonly Node[],min2:number):Road[]{const result=__actualRoads(nodes,min2);(globalThis as any).__rhDirect?.({type:'warrenRoads',nodes,roads:result});return result;}\n`;
  s=once(s,'  const mirror = noiseQ(c, a.x, a.y, 1, 401) < 512;',`  const __mirrorNoise=noiseQ(c,a.x,a.y,1,401);const mirror=__mirrorNoise<512;(globalThis as any).__rhDirect?.({type:'warrenMirror',road,rot,mirror,noiseValue:__mirrorNoise});`);
  s=tap(s,'      const cy = Math.round(a.y + (dy * tp) / 1000 + (dx * off) / len);\n      // the mirror image has the same walls and floor, only its crate nooks swap: one stamp per centre is enough',`{type:'warrenCentre',tp,off,cx,cy}`);
 }
 s=s.replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g,(_m,a,p,b)=>{const original=resolve(dirname(join(base,n)),p.replace(/\.(?:ts|js|mts)$/,'')+'.ts');readFileSync(original);return a+pathToFileURL(paths.get(original)??original).href+b;});
 const out=paths.get(resolve(base,n))!;mkdirSync(dirname(out),{recursive:true});writeFileSync(out,s);
}
const snapshot=(rt:any)=>{const s=rt.init;return {tiles:rle(s.tiles),terrain:rle(s.terrain),featureOwner:rle(s.featureOwner),features:plain(s.features),wrote:rle(s.wrote),reserved:rle(rt.reserved),mark:rle(s.scratch.mark),qa:rle(s.scratch.qa),qb:rle(s.scratch.qb),epoch:s.scratch.epoch,counters:{walls:rt.walls,lows:rt.lows,refused:rt.refused,joinUsed:rt.joinUsed,joinLeft:rt.joinLeft,featuresAdded:rt.featuresAdded}};};
try{
 const observed:any=await import(pathToFileURL(paths.get(resolve(base,'mapgen.ts'))!).href);const host=globalThis as any;const cases:any[]=[];
 for(const [seed,attempt,styled] of [[1,0,false],[-1,0,false],[4294967297,4294967296,false],[176,0,false],[54,0,false],[17,0,false],[17,1,false],[1,0,true]] as const){
  const options=styled?{decor:false}:{decor:false,styleZones:null};const baseline=legacy.tryAttempt(seed,attempt,options);let stage:any=null;let active:any=null;let context:any=null;let initial=0;const words:number[]=[];const zones:any[]=[];const states:any[]=[];const stateIds=new Map<string,number>();let beforeDraws=0;
  const intern=(s:any)=>{const text=JSON.stringify(s);let id=stateIds.get(text);if(id===undefined){id=states.length;states.push(s);stateIds.set(text,id);}return id;};
  let previous:any=null;
  const state=()=>{const rt=active.rt,s=rt.init;const arrays=[s.tiles,s.terrain,s.featureOwner,s.wrote,rt.reserved,s.scratch.mark,s.scratch.qa,s.scratch.qb].map((a:any)=>Buffer.from(a.buffer,a.byteOffset,a.byteLength));const signature=JSON.stringify([s.scratch.epoch,rt.walls,rt.lows,rt.refused,rt.joinUsed,rt.joinLeft,rt.featuresAdded,s.features]);if(previous?.rt===rt&&previous.signature===signature&&arrays.every((a:any,i:number)=>a.equals(previous.arrays[i])))return previous.id;const id=intern(snapshot(rt));previous={rt,signature,arrays:arrays.map((a:any)=>Buffer.from(a)),id};return id;};
  host.__rhMain=(e:any)=>{if(e.type==='initial')initial=e.initial;else words.push(e.word);};
  host.__rhDirect=(e:any)=>{
   if(e.type==='stageInput'){beforeDraws=words.length;stage=plain(e.st);return;}
   if(e.type==='stageEnd'){if(words.length!==beforeDraws)throw Error('stage consumed main RNG');return;}
   if(e.type==='zoneStart'){const rt=e.rt;active={index:rt.init.info.index,faction:rt.init.info.faction,info:plain(rt.init.info),infoBits:[rt.init.info.centroid.x,rt.init.info.centroid.y,rt.init.info.axis.x,rt.init.info.axis.y].map(bits),mask:rle(rt.init.mask),edgeDist:rle(rt.init.edgeDist),hard:rle(rt.init.hard),territory:rle(rt.init.territory),camps:plain(rt.init.camps),events:[],rt};active.before=state();zones.push(active);return;}
   if(e.type==='context'){context=e;return;}
   if(e.type==='zoneEnd'){
    if(!active)throw Error('zone end without start');active.after=state();const index=active.index;const streamSeed=hashSeed(seed,attempt,index,3);const noiseSeed=hashSeed(seed,attempt,index,103);const rng=mulberry32(streamSeed);const expected=[rng(),rng(),rng()].map(bits);const draws=context.draws();if(draws!==0)throw Error('zone consumed context RNG');const continuation=[context.c.rng(),context.c.rng(),context.c.rng()].map(bits);if(!isDeepStrictEqual(expected,continuation))throw Error('context continuation differs');active.stream={streamSeed,noiseSeed,initialState:streamSeed,finalState:streamSeed,draws,continuation};delete active.rt;active=null;context=null;return;
   }
   if(!active)return; // Later visual styling has its own contexts and is outside stage four.
   const {rt,c,...data}=e;const event:any=plain(data);event.state=state();
   if(e.type==='searchScore')event.valueBits=bits(e.value);if(e.type==='sanctumCandidate')event.scoreBits=bits(e.score);
   if(e.type==='searchStart')active.search=true;event.inSearch=!!active.search;
   if(e.type==='rimeTarget')event.numericBits=Object.fromEntries(['len','dist'].map(k=>[k,bits(e[k])]));
   if(e.type==='warrenRoads')event.lengthBits=e.roads.map((r:any)=>bits(r.len));
   active.events.push(event);if(e.type==='searchEnd')active.search=false;
  };
  let output:any;try{output=observed.tryAttempt(seed,attempt,options);}finally{delete host.__rhMain;delete host.__rhDirect;}
  if(!isDeepStrictEqual(plain(output),plain(baseline)))throw Error(`complete final output changed ${seed}/${attempt}`);const finalHash=output?observed.mapHash(output):null;if(finalHash!==(baseline?legacy.mapHash(baseline):null))throw Error('actual mapHash changed');
  if(!stage||zones.length!==5||!states.length)throw Error('missing actual stage capture');
  const rng=mulberry32(initial);for(const word of words.slice(0,beforeDraws)){if(rng()*4294967296!==word)throw Error('main prefix differs');}const continuation=[rng(),rng(),rng()].map(bits);
  cases.push({seed,attempt,styledObserverControl:styled,options,completeFinalOutputEquality:true,finalHash,stage,zones,states,main:{initial,initialBits:bits(initial),initialState:initial>>>0,stateBefore:((initial>>>0)+Math.imul(beforeDraws,0x6d2b79f5))>>>0,stateAfter:((initial>>>0)+Math.imul(beforeDraws,0x6d2b79f5))>>>0,draws:beforeDraws,words:words.slice(0,beforeDraws),continuation}});
 }
 const contextModule:any=await import(pathToFileURL(paths.get(resolve(base,'zoneStyle/context.ts'))!).href);
 const directModules:any={};for(const name of ['rime','sanctum','warren'])directModules[name]=await import(pathToFileURL(paths.get(resolve(base,`zoneStyle/${name}.ts`))!).href);
 const synthetic:any[]=[];
 for(const config of [
  {name:'direct-rime-six-local-refusals-no-fallback',faction:'frost',module:'rime',w:64,h:64,cap:0,reserved:[1885],tower:[32,32,true]},
  {name:'direct-rime-genuine-empty-key-exhaustion',faction:'frost',module:'rime',w:21,h:17,cap:100,hard:true,tower:[1,1,false]},
  {name:'direct-rime-clipped-shifted-field',faction:'frost',module:'rime',w:23,h:17,cap:100,camps:[[5,5],[15,9]]},
  {name:'direct-sanctum-first-failure-bearing-seven',faction:'holy',module:'sanctum',w:64,h:64,cap:0},
  {name:'direct-sanctum-radius-minimum-pole-fallback',faction:'holy',module:'sanctum',w:21,h:17,cap:100},
  {name:'direct-warren-equal-roads-first-success',faction:'plague',module:'warren',w:64,h:64,cap:100,camps:[[12,12],[48,12],[12,48],[48,48]]},
  {name:'direct-warren-road-length-equality',faction:'plague',module:'warren',w:64,h:64,cap:100,camps:[[20,20],[38,20]]},
  {name:'direct-warren-no-nodes',faction:'plague',module:'warren',w:21,h:17,cap:100},
 ] as any[]){
  const {w,h}=config,n=w*h;const mask=new Uint8Array(n),tiles=new Uint8Array(n).fill(TILE_WALL),hard=new Uint8Array(n);
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){mask[y*w+x]=1;tiles[y*w+x]=TILE_FLOOR;if(config.hard)hard[y*w+x]=1;}
  const camps=(config.camps??[]).map(([x,y]:number[],index:number)=>({x,y,r:3.2,territory:index+1,elite:false,index}));const edgeDist=kit.chamfer(mask,w,h);
  const init={w,h,seed:1,attempt:0,info:contextModule.zoneInfoOf(1,config.faction,mask,tiles,edgeDist,w,h),mask,hard,noBlock:hard.slice(),noProp:hard,tiles,terrain:new Uint8Array(n),props:[],edgeDist,territory:null,camps,caps:{joinChecks:128,footprintPct:config.cap,rimTiles:0,fenceDetour:10},scratch:contextModule.makeScratch(n),wrote:new Uint8Array(n),propKinds:[],features:[],featureOwner:new Uint16Array(n),spawns:[],centreWalk:null};
  const input=plain({w,h,tiles,mask,hard,camps,info:init.info,caps:init.caps,tower:config.tower??null,reserved:config.reserved??[]});const rt=new contextModule.ZoneRuntime(init);for(const i of config.reserved??[])rt.reserved[i]=1;const states:any[]=[];const ids=new Map<string,number>();const state=()=>{const s=snapshot(rt),key=JSON.stringify(s);let id=ids.get(key);if(id===undefined){id=states.length;states.push(s);ids.set(key,id);}return id;};const before=state();const events:any[]=[];let inSearch=false;
  host.__rhDirect=(e:any)=>{if(e.type==='context')return;if(e.type==='searchStart')inSearch=true;const {rt,c,...data}=e;const event:any=plain(data);event.state=state();event.inSearch=inSearch;if(e.type==='searchScore')event.valueBits=bits(e.value);if(e.type==='sanctumCandidate')event.scoreBits=bits(e.score);if(e.type==='rimeTarget')event.numericBits=Object.fromEntries(['len','dist'].map(k=>[k,bits(e[k])]));if(e.type==='warrenRoads')event.lengthBits=e.roads.map((r:any)=>bits(r.len));events.push(event);if(e.type==='searchEnd')inSearch=false;};
  try{const c=contextModule.landmarkCtx(rt);if(config.tower)directModules[config.module].__directTower(c,...config.tower);else directModules[config.module].__directLandmark(c);}finally{delete host.__rhDirect;}
  synthetic.push({name:config.name,provenance:'direct synthetic actual-source helper call, not an actual map seed',module:config.module,input,before,after:state(),events,states});
 }
 if(!synthetic[0].events.some((e:any)=>e.type==='fit'&&!e.result))throw Error('local rejected fit boundary missing');
 if(!synthetic[0].events.some((e:any)=>e.type==='rimeSixFailures')||synthetic[0].events.some((e:any)=>e.type==='rimeFallback'))throw Error('six failure boundary missing');
 if(!synthetic[1].events.some((e:any)=>e.type==='rimeFallback'))throw Error('genuine key exhaustion missing');
 const failedFirst=synthetic[3].events.find((e:any)=>e.type==='sanctumSlots'&&e.n===1);if(failedFirst?.first!==-1||failedFirst.slots[0][0]!==7)throw Error('failed-first direction7 missing');
 const probeW=42,probeH=21,probeFirst=43,probeClr=new Int32Array(probeW*probeH),probeAllow=new Uint8Array(probeW*probeH);for(const [x,y,value] of [[18,1,100],[19,1,9],[1,19,9],[20,1,8]]){const i=y*probeW+x;probeClr[i]=value;probeAllow[i]=1;}
 const helperProbes=[{name:'direct-second-seed-equality-earliest-and-clearance',provenance:'actual exported private helper via temporary export-only exposure; synthetic inputs',w:probeW,h:probeH,first:probeFirst,clr:Array.from(probeClr),allow:Array.from(probeAllow),result:directModules.rime.__directSecondSeed({w:probeW,h:probeH,zone:{bbox:{x:0,y:0,w:probeW,h:probeH}}},probeClr,probeAllow,probeFirst)}];
 const result={format:'rh-landmark-recipes-direct/1',node:process.version,platform:process.platform,arch:process.arch,sources,scope:'Actual stage-four recipes; final output/hash equality proves observer noninterference only. No finished Rust pins.',cases,synthetic,helperProbes};
 const out=JSON.stringify(result)+'\n';const path=process.env.RH_DIRECT_OUTPUT??fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/landmark-recipes-direct.json',import.meta.url));if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==out)throw Error('direct capture differs');}else writeFileSync(path,out);console.log(JSON.stringify({cases:cases.length,states:cases.map(c=>c.states.length),output:path}));
}finally{rmSync(temporary,{recursive:true,force:true});}

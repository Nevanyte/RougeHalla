/** Genuine pre-stage snapshots from the actual generator. Taps do not reconstruct state from final maps. */
import {readFileSync,writeFileSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import * as actual from '../../packages/shared/src/mapgen.ts';
import {mulberry32} from '../../packages/shared/src/rng.ts';
import {NB4} from '../../packages/shared/src/gridOps.ts';
import {fixedLayout} from '../../packages/shared/src/coliseum.ts';
import {repairTerritories} from '../../packages/shared/src/zones.ts';
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw Error('canonical Linux x64 Node22.23.4 required');
const base=fileURLToPath(new URL('../../packages/shared/src/',import.meta.url));
const source=readFileSync(join(base,'mapgen.ts'),'utf8');
const plain=(v:any):any=>ArrayBuffer.isView(v)?Array.from(v as any):Array.isArray(v)?v.map(plain):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])):v;
function once(s:string,a:string,b:string){if(s.split(a).length!==2)throw Error(`nonunique tap ${a}`);return s.replace(a,b);}
const layers=['tiles','terrain','zone','territoryGrid','regionGrid','featureOwner','protect','landmarkBox','beforeNets'];
function cloneContinuation(draws:number){const r=mulberry32(1);for(let n=0;n<draws;n++)r();return Array.from({length:4},()=>r());}
function pack(v:any){const p=plain(v);for(const k of layers)if(p[k]){const out:number[][]=[];for(const v of p[k]){const last=out[out.length-1];if(last&&last[0]===v)last[1]++;else out.push([v,1]);}p[k]={rle:out};}return p;}
const sources:Record<string,string>={};function hashSources(dir:string){for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){const p=join(dir,e.name);if(e.isDirectory())hashSources(p);else if(e.isFile()&&e.name.endsWith('.ts'))sources[relative(base,p)]=createHash('sha256').update(readFileSync(p)).digest('hex');}}hashSources(base);
const temp=mkdtempSync(join(tmpdir(),'rh-repair-'));const host=globalThis as any;
try {
 const state='{tiles,terrain,zone,territoryGrid,regionGrid: typeof regionGrid === "undefined" ? [] : regionGrid,featureOwner,features}';
 // Separate entry tap avoids accessing regionGrid in its temporal dead zone.
 const entry='{tiles,terrain,zone,territoryGrid,featureOwner,features}';
 const inputs='{styled:hook!==null,order,camps,clearing,pool,protect,landmarkBox,buildings}';
 // The private source copy only adds observational operation taps to the actual repair function.
 let zonesSource=readFileSync(join(base,'zones.ts'),'utf8');
 const zstart=zonesSource.indexOf('export function repairTerritories(');if(zstart<0)throw Error('missing repair source');
 let repairSource=zonesSource.slice(zstart);
 const ztap=(phase:string,round='round',target='0',cells='queue.slice(0,tail)')=>`(globalThis as any).__rhTerrRepair?.({phase:'${phase}',round:${round},target:${target},rezoned,cells:${cells},tiles,zone,territoryGrid});`;
 const wall='          floorTotal -= tail;\n          moved = true;';
 repairSource=once(repairSource,wall,wall+'\n          '+ztap('wall-far','round','bestT'));
 const strayWall='        floorTotal -= tail;\n        moved = true;';
 repairSource=once(repairSource,strayWall,strayWall+'\n        '+ztap('wall-stray'));
 repairSource=once(repairSource,'          rezoned += tail;','          rezoned += tail;\n          '+ztap('rezone','round','bestT'));
 repairSource=once(repairSource,'      if (bestT === 0) { stray++; continue; }',"      if (bestT === 0) { stray++; "+ztap('stray')+' continue; }');
 repairSource=once(repairSource,'      for (let k = 0; k < tail; k++) territoryGrid[queue[k]] = bestT;','      for (let k = 0; k < tail; k++) territoryGrid[queue[k]] = bestT;\n      '+ztap('assign','round','bestT'));
 repairSource=once(repairSource,'      for (let k = 0; k < tail; k++) zone[queue[k]] = nz;\n      changed = true;','      for (let k = 0; k < tail; k++) zone[queue[k]] = nz;\n      '+ztap('zone-transfer','round','nz')+'\n      changed = true;');
 repairSource=once(repairSource,'    balance(F.paintedMask, F.painted, zone, ZONES, quota, keep);','    balance(F.paintedMask, F.painted, zone, ZONES, quota, keep);\n    '+ztap('zone-balance','round','0','[]'));
 repairSource=once(repairSource,'    if (left === 0) break;',"    "+ztap('wall-sweep','sweep','left','[]')+'\n    if (left === 0) break;');
 zonesSource=zonesSource.slice(0,zstart)+repairSource;
 const absolutize=(text:string)=>text.replace(/(from\s+["'])(\.[^"']+)(["'])/g,(_,a,p,b)=>a+pathToFileURL(resolve(base,p)+'.ts').href+b);
 const zonesPath=join(temp,'zones.mts');writeFileSync(zonesPath,absolutize(zonesSource));
 const observedZones=await import(pathToFileURL(zonesPath).href);const observedFails=observedZones.MAPGEN_FAILS;
 let tapped=once(source,'  const rng = mulberry32(attempt === 0 ? seed : seed + attempt * 0x9e3779b1);','  let __draws=0; const __rng=mulberry32(attempt === 0 ? seed : seed + attempt * 0x9e3779b1); const rng=()=>{__draws++;return __rng();};');
 tapped=once(tapped,'  const beforeNets = tiles.slice();',`  (globalThis as any).__rhRepair?.('nets-entry',${entry},${inputs},__draws);\n  const beforeNets = tiles.slice();`);
 tapped=once(tapped,'  lap("nets");',`  (globalThis as any).__rhRepair?.('nets-exit',${state},{beforeNets},__draws);\n  lap("nets");`);
 tapped=once(tapped,'  const keepOpen = new Uint8Array(N);',`  (globalThis as any).__rhRepair?.('post-entry',${state},{...${inputs},beforeNets,cratesByZone,allCrates},__draws);\n  const keepOpen = new Uint8Array(N);`);
 tapped=once(tapped,'  lap("post");',`  (globalThis as any).__rhRepair?.('post-exit',${state},{reach2,rezoned},__draws);\n  lap("post");`);
 // Read-only phase taps preserve the exact operation and refusal order.
 for(const [needle,name] of [
 ['  clearBuried();\n  for (const t of clearing)','nets-connectivity'],
 ['  if (rezoned === null) return null;','territories-return'],
 ['  if (rezoned > 0 && zoneBefore !== null) {','terrain-rezone-entry'],
 ['  // The walls the nets added','infill-entry'],
 ['  const floorOf = new Int32Array','infill-exit'],
 ['  const reach2 = territoryReach2(camps, territoryGrid, tiles);','reach-entry'],
 ] as const){tapped=once(tapped,needle,`  (globalThis as any).__rhRepair?.('${name}',${name==='nets-connectivity'?entry:state},{},__draws);\n${needle}`);}
 tapped=once(tapped,'  if (rezoned > 0) { note("rezoned"); note("rezonedTiles", rezoned); }','  if (rezoned > 0) { note("rezoned"); note("rezonedTiles", rezoned); (globalThis as any).__rhTerrRepair?.({phase:"note-rezone",round:0,target:0,rezoned,cells:[],tiles,zone,territoryGrid}); }');
 tapped=once(tapped,'      note("infillTiles", list.length);','      note("infillTiles", list.length);\n      (globalThis as any).__rhTerrRepair?.({phase:"note-infill",round:0,target:z,rezoned,cells:list,tiles,zone,territoryGrid});');
 const start=tapped.indexOf('  // --- 7.'),end=tapped.indexOf('  // --- 10.');
 let section=tapped.slice(start,end);section=section.replace(/return failed\("(A:[^"]+)"\)/g,(_,reason)=>`return ((globalThis as any).__rhRepair?.('refused:${reason}',${reason==='A:campCut'?entry:state},{},__draws),failed("${reason}"))`);
 section=section.replace('if (rezoned === null) return null;',`if (rezoned === null) return ((globalThis as any).__rhRepair?.('refused:repair',${state},{},__draws),null);`);
 tapped=tapped.slice(0,start)+section+tapped.slice(end);
 tapped=tapped.replace(/(from\s+["'])(\.[^"']+)(["'])/g,(_,a,p,b)=>a+(p==='./zones'?pathToFileURL(zonesPath).href:pathToFileURL(resolve(base,p)+'.ts').href)+b);
 const path=join(temp,'mapgen.mts');writeFileSync(path,tapped);const observed=await import(pathToFileURL(path).href);
 const inventory:Array<[number,number,boolean,boolean]>=[[0,0,false,false],[1,0,false,false],[17,0,false,false],[17,1,false,false],[176,0,false,false],[1,0,true,false],[1,0,true,true],[-1,0,false,false],[4294967297,4294967296,false,false]];
 for(let seed=0;seed<32;seed++)if(seed!==1)inventory.push([seed,0,true,false]);
 const cases:any[]=[];
 for(const [seed,attempt,styled,decor] of inventory){const events:any[]=[];host.__rhTerrRepair=(x:any)=>events.push({phase:'territory-operation',operation:pack(x)});let phaseDraws:number|null=null;
  host.__rhRepair=(phase:string,state:any,extra:any,draws:number)=>{if(phase==='nets-entry'||phase==='post-entry')phaseDraws=draws;else if(phaseDraws!==draws)throw Error('repair consumed main RNG');const r=mulberry32(attempt===0?seed:seed+attempt*0x9e3779b1);for(let n=0;n<draws;n++)r();events.push({phase,state:pack(state),extra:pack(extra),draws,continuation:Array.from({length:4},()=>r())});};
  const options=styled?{decor}:{decor,styleZones:null};const reference=actual.tryAttempt(seed,attempt,options);const failureBefore={...observedFails};const final=observed.tryAttempt(seed,attempt,options);delete host.__rhRepair;
  if(!isDeepStrictEqual(plain(reference),plain(final))||(reference?actual.mapHash(reference):null)!==(final?observed.mapHash(final):null))throw Error('tap changed complete final output/hash');
  cases.push({seed,attempt,styled,decor,failures:Object.fromEntries(Object.entries(observedFails).filter(([k,v])=>v!==(failureBefore[k]??0)).map(([k,v])=>[k,v-(failureBefore[k]??0)])),completeFinalOutputEquality:true,finalHash:final?observed.mapHash(final):null,finalIsNull:final===null,events});
 }
 const synthetic:any[]=[];
 // Explicit mutations of genuine pre-post source state; these are not failed seeds.
 for(const mode of ['infill','floorShare','moving-camp-radius','territory-tie','stray-refusal','protected-cross-zone','rezone-low','rezone-floor','plain-rezone-terrain','rezone-crate','rezone-landmark','rezone-pool'] as const){
  const events:any[]=[];host.__rhTerrRepair=(x:any)=>events.push({phase:'territory-operation',operation:pack(x)});let applied=false;let changedTile:number|null=null;let searchTrials=0;let failuresBefore:Record<string,number>={};
  host.__rhRepair=(phase:string,state:any,extra:any,draws:number)=>{
   if(phase==='post-entry'){
    if(applied)throw Error('duplicate synthetic entry');applied=true;
    const {tiles,terrain,zone,territoryGrid,featureOwner}=state;const {camps,protect,landmarkBox}=extra;
    const forbidden=(t:number)=>protect[t]||landmarkBox[t]||featureOwner[t]||camps.some((c:any)=>Math.max(Math.abs(c.site%160-t%160),Math.abs(Math.floor(c.site/160)-Math.floor(t/160)))<3);
    if(mode==='moving-camp-radius'){
     let found=false;
     for(let ci=0;ci<camps.length&&!found;ci++){
      const floor:number[]=[];for(let t=322;t<25278;t++)if(territoryGrid[t]===ci+1&&tiles[t]===0)floor.push(t);
      for(const t of floor){if(floor.some(u=>{const dx=t%160-u%160,dy=Math.floor(t/160)-Math.floor(u/160);return dx*dx+dy*dy>900;})){camps[ci].site=t;changedTile=t;found=true;break;}}
     }
     if(!found)throw Error('missing within-territory moving camp radius');
    }else if(mode==='territory-tie'){
     let found=false;
     for(let t=322;t<25278;t++){
      if(!zone[t]||tiles[t]!==0||forbidden(t))continue;
      const touch=new Map<number,number>();for(const j of [t-160,t+1,t+160,t-1])if(tiles[j]===0&&zone[j]===zone[t])touch.set(territoryGrid[j],(touch.get(territoryGrid[j])??0)+1);
      const counts=[...touch].filter(([u])=>u>0);if(counts.length!==2||counts[0][1]!==counts[1][1])continue;
      if(counts.some(([u])=>{const dx=camps[u-1].site%160-t%160,dy=Math.floor(camps[u-1].site/160)-Math.floor(t/160);return dx*dx+dy*dy>900;}))continue;
      const third=camps.findIndex((c:any,k:number)=>c.zone===zone[t]&&!touch.has(k+1));if(third<0)continue;
      territoryGrid[t]=third+1;changedTile=t;found=true;break;
     }
     if(!found)throw Error('missing genuine territory tie');
    }else if(mode==='infill'||mode==='floorShare'){
     for(const z of mode==='infill'?[1,2]:[1]){let count=0;for(let t=322;t<25278;t++)if(zone[t]===z&&tiles[t]===0&&!forbidden(t)){tiles[t]=1;changedTile=t;if(++count>=(mode==='infill'?2:1200))break;}}
    }else {
     let chosen=-1;
     for(let t=322;t<25278;t++){
      if(!zone[t]||tiles[t]!==0||forbidden(t))continue;
      const nb=[t-160,t+1,t+160,t-1];
      if(!nb.some(j=>zone[j]&&zone[j]!==zone[t]&&tiles[j]===0))continue;
      if(nb.some(j=>zone[j]===zone[t]&&forbidden(j)))continue;
      searchTrials++;if(mode==='stray-refusal'){chosen=t;break;}
      const ts=tiles.slice(),zs=zone.slice(),tg=territoryGrid.slice(),keep=new Uint8Array(25600);
      for(let j=0;j<25600;j++)if(protect[j]||landmarkBox[j])keep[j]=1;for(const j of extra.cratesByZone.flat())keep[j]=1;keep[t]=1;
      for(const j of nb)if(zs[j]===zs[t])ts[j]=1;
      const result=repairTerritories(ts,zs,camps,tg,keep);
      if(result===null||result===0)continue;
      chosen=t;break;
     }
     if(chosen<0)throw Error(`no source-derived boundary for ${mode}`);changedTile=chosen;
     const t=chosen;for(const j of [t-160,t+1,t+160,t-1])if(zone[j]===zone[t])tiles[j]=1;
     protect[t]=1;
     if(mode==='rezone-low')terrain[t]=1;
     if(mode==='rezone-floor'||mode==='plain-rezone-terrain')terrain[t]=4;
     if(mode==='rezone-crate'){extra.cratesByZone[zone[t]-1].push(t);extra.allCrates.splice(0,extra.allCrates.length,...extra.cratesByZone.flat());}
     if(mode==='rezone-landmark')extra.buildings.push({x:t%160,y:Math.floor(t/160),w:1,h:1});
     if(mode==='rezone-pool'){extra.pool.splice(0,extra.pool.length,t);}
    }
    failuresBefore={...observedFails};
   }
   if(phase==='post-entry'||phase==='post-exit'||phase.startsWith('refused:')||['territories-return','terrain-rezone-entry','infill-entry','infill-exit','reach-entry'].includes(phase))events.push({phase,state:pack(state),extra:pack(extra),draws,continuation:cloneContinuation(draws)});
  };
  const final=observed.tryAttempt(1,0,(mode==='rezone-low'||mode==='rezone-floor')?{decor:false}:{decor:false,styleZones:null});delete host.__rhRepair;
  if(!applied||events[0]?.phase!=='post-entry')throw Error(`synthetic did not reach genuine entry ${mode}`);
  synthetic.push({name:mode,provenance:'labelled synthetic mutation of actual source pre-post state; not a failed generator seed',changedTile,searchTrials,failures:Object.fromEntries(Object.entries(observedFails).filter(([k,v])=>v!==(failuresBefore[k]??0)).map(([k,v])=>[k,v-(failuresBefore[k]??0)])),events,finalIsNull:final===null,finalHash:final?observed.mapHash(final):null});
 }
 for(const mode of ['nets-campCut','nets-poolCut','nets-buried','nets-restore'] as const){
  const events:any[]=[];let applied=false;const failuresBefore={...observedFails};
  host.__rhTerrRepair=(x:any)=>events.push({phase:'territory-operation',operation:pack(x)});
  host.__rhRepair=(phase:string,state:any,extra:any,draws:number)=>{
   if(phase==='nets-entry'){
    applied=true;
    if(mode==='nets-campCut')state.tiles.fill(1);
    if(mode==='nets-poolCut')state.tiles[extra.pool[0]]=1;
    if(mode==='nets-buried'){const walls:number[]=[];for(let t=322;t<25278&&walls.length<2;t++)if(state.tiles[t]===1)walls.push(t);if(walls.length!==2)throw Error('missing buried walls');state.terrain[walls[0]]=4;state.terrain[walls[1]]=1;}
    if(mode==='nets-restore'){const F=fixedLayout();for(const t of F.laneOut)state.tiles[t.y*160+t.x]=1;for(let t=0;t<25600;t++)if(F.laneIn[t])state.tiles[t]=1;for(const t of extra.clearing)state.tiles[t]=1;}
   }
   events.push({phase,state:pack(state),extra:pack(extra),draws,continuation:cloneContinuation(draws)});
  };
  const final=observed.tryAttempt(1,0,{decor:false});delete host.__rhRepair;
  if(!applied)throw Error('missing source nets entry');
  synthetic.push({name:mode,provenance:'labelled synthetic mutation of actual pre-nets state; not a failed generator seed',failures:Object.fromEntries(Object.entries(observedFails).filter(([k,v])=>v!==(failuresBefore[k]??0)).map(([k,v])=>[k,v-(failuresBefore[k]??0)])),events,finalIsNull:final===null,finalHash:final?observed.mapHash(final):null});
 }
 for(const mode of ['wall-stray','wall-far','fits-preference','keep-landmark','keep-crate','zone-transfer-balance'] as const){
  const events:any[]=[];let applied=false,searchTrials=0;let failuresBefore:Record<string,number>={};
  host.__rhTerrRepair=(x:any)=>events.push({phase:'territory-operation',operation:pack(x)});
  host.__rhRepair=(phase:string,state:any,extra:any,draws:number)=>{
   if(phase==='post-entry'){
    applied=true;
    const {tiles,terrain,zone,territoryGrid,featureOwner}=state;const {camps,protect,landmarkBox}=extra;
    const adjacent=(t:number)=>NB4.map(off=>t+off);
    const forbidden=(t:number)=>protect[t]||landmarkBox[t]||featureOwner[t]||camps.some((c:any)=>Math.max(Math.abs(c.site%160-t%160),Math.abs(Math.floor(c.site/160)-Math.floor(t/160)))<3);
    const plan=()=>({tiles:tiles.slice(),zone:zone.slice(),territory:territoryGrid.slice(),camps:structuredClone(camps),protect:protect.slice()});
    const probe=(p:any)=>{
     searchTrials++;const keep=p.protect.slice();for(let j=0;j<25600;j++)if(landmarkBox[j])keep[j]=1;for(const j of extra.cratesByZone.flat())keep[j]=1;
     const prior=host.__rhTerrRepair,ops:any[]=[];host.__rhTerrRepair=(x:any)=>ops.push(plain(x));let result:number|null;
     try{result=observedZones.repairTerritories(p.tiles.slice(),p.zone.slice(),p.camps,p.territory.slice(),keep);}finally{host.__rhTerrRepair=prior;}
     return {result,ops};
    };
    let chosen:any=null;
    for(let t=322;t<25278&&!chosen;t++){
     if(!zone[t]||tiles[t]!==0||forbidden(t))continue;
     const nb=adjacent(t);
     if(mode==='fits-preference'){
      const touched=new Map<number,number>();for(const j of nb)if(tiles[j]===0&&zone[j]===zone[t]&&territoryGrid[j])touched.set(territoryGrid[j],(touched.get(territoryGrid[j])??0)+1);
      if(touched.size!==2)continue;const candidates=[...touched].sort((a,b)=>b[1]-a[1]||a[0]-b[0]);const farTarget=candidates[0][0],fitTarget=candidates[1][0];
      const fitSite=camps[fitTarget-1].site,fx=fitSite%160-t%160,fy=Math.floor(fitSite/160)-Math.floor(t/160);if(fx*fx+fy*fy>900)continue;
      const third=camps.findIndex((c:any,k:number)=>c.zone===zone[t]&&!touched.has(k+1));if(third<0)continue;
      let far=-1;for(let u=322;u<25278;u++)if(tiles[u]===0&&territoryGrid[u]===farTarget){const dx=u%160-t%160,dy=Math.floor(u/160)-Math.floor(t/160);if(dx*dx+dy*dy>900){far=u;break;}}
      if(far<0)continue;const p=plan();p.camps[farTarget-1].site=far;p.territory[t]=third+1;
      if(probe(p).ops.some(o=>o.phase==='assign'&&o.target===fitTarget&&o.cells.length===1&&o.cells[0]===t))chosen=p;
     }else if(mode==='wall-far'){
      for(const j of nb){const target=territoryGrid[j];if(tiles[j]!==0||zone[j]!==zone[t]||!target)continue;
       const third=camps.findIndex((c:any,k:number)=>c.zone===zone[t]&&k+1!==target);if(third<0)continue;
       let far=-1;for(let u=322;u<25278;u++)if(tiles[u]===0&&territoryGrid[u]===target){const dx=u%160-t%160,dy=Math.floor(u/160)-Math.floor(t/160);if(dx*dx+dy*dy>900){far=u;break;}}
       if(far<0||nb.some(u=>zone[u]===zone[t]&&territoryGrid[u]!==target&&forbidden(u)))continue;
       const p=plan();p.camps[target-1].site=far;p.territory[t]=third+1;for(const u of nb)if(zone[u]===zone[t]&&territoryGrid[u]!==target)p.tiles[u]=1;
       if(probe(p).ops.some(o=>o.phase==='wall-far')){chosen=p;break;}
      }
     }else {
      if(!nb.some(j=>zone[j]&&zone[j]!==zone[t]&&tiles[j]===0)||nb.some(j=>zone[j]===zone[t]&&forbidden(j)))continue;
      const p=plan();for(const j of nb)if(zone[j]===zone[t])p.tiles[j]=1;
      if(mode==='zone-transfer-balance'){
       p.protect[t]=1;
       // An isolated painted wall label exercises the zone-piece pass. Boundary wall labels
       // then create an actual quota imbalance on movable cells, using actual adjacency.
       const island=tiles.findIndex((v:number,u:number)=>u>322&&u<25278&&v===0&&zone[u]&&u!==t&&!forbidden(u)&&adjacent(u).every(j=>zone[j]===zone[u])&&Math.abs(u%160-t%160)+Math.abs(Math.floor(u/160)-Math.floor(t/160))>8);
       if(island<0)continue;p.tiles[island]=1;p.zone[island]=zone[island]%5+1;
       let from=0,to=0,changed=0;
       for(let u=322;u<25278&&changed<16;u++){
        if(u===t||u===island||p.tiles[u]!==0||!zone[u]||forbidden(u))continue;
        const other=adjacent(u).find(j=>zone[j]&&zone[j]!==zone[u]);if(other===undefined)continue;
        if(!from){from=zone[u];to=zone[other];}if(zone[u]!==from||!adjacent(u).some(j=>zone[j]===to))continue;
        p.tiles[u]=1;p.zone[u]=to;changed++;
       }
       if(changed<8)continue;
      }
      const trial=probe(p);
      if(mode!=='zone-transfer-balance'){if(trial.ops.some(o=>o.phase==='wall-stray')){chosen=p;chosen.piece=t;}}
      else if(trial.result!==null&&trial.ops.some(o=>o.phase==='zone-transfer')){
       let previous=p.zone;
       for(const op of trial.ops){if(op.phase==='zone-balance'&&op.zone.some((v:number,j:number)=>v!==previous[j])){chosen=p;break;}previous=op.zone;}
      }
     }
    }
    if(!chosen)throw Error(`no actual source operation case ${mode}`);
    tiles.set(chosen.tiles);zone.set(chosen.zone);territoryGrid.set(chosen.territory);protect.set(chosen.protect);for(let k=0;k<camps.length;k++)camps[k].site=chosen.camps[k].site;
    if(mode==='keep-landmark')landmarkBox[chosen.piece]=1;
    if(mode==='keep-crate'){extra.cratesByZone[zone[chosen.piece]-1].push(chosen.piece);extra.allCrates.splice(0,extra.allCrates.length,...extra.cratesByZone.flat());}
    failuresBefore={...observedFails};
   }
   if(phase==='post-entry'||phase==='post-exit'||phase.startsWith('refused:')||['territories-return','terrain-rezone-entry','infill-entry','infill-exit','reach-entry'].includes(phase))events.push({phase,state:pack(state),extra:pack(extra),draws,continuation:cloneContinuation(draws)});
  };
  const final=observed.tryAttempt(1,0,{decor:false,styleZones:null});delete host.__rhRepair;if(!applied)throw Error('missing genuine source post stage');
  synthetic.push({name:mode,provenance:'labelled synthetic mutation of actual pre-post state, selected by actual tapped repair operation; not a failed generator seed',searchTrials,failures:Object.fromEntries(Object.entries(observedFails).filter(([k,v])=>v!==(failuresBefore[k]??0)).map(([k,v])=>[k,v-(failuresBefore[k]??0)])),events,finalIsNull:final===null,finalHash:final?observed.mapHash(final):null});
 }
 const result={format:'rh-map-repair/1',node:process.version,platform:process.platform,arch:process.arch,sources,nullSearch:{firstSeed:0,endSeedExclusive:32,mode:'styled',nullFound:cases.some(c=>c.finalIsNull)},cases,synthetic};const text=JSON.stringify(result)+'\n';
 const output=process.env.RH_REPAIR_OUTPUT??fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/map-repair.json',import.meta.url));
 if(process.argv.includes('--check')){if(readFileSync(output,'utf8')!==text)throw Error('capture differs');}else writeFileSync(output,text);
 console.log(JSON.stringify({cases:cases.length,events:cases.reduce((n,c)=>n+c.events.length,0),nullCases:cases.filter(c=>c.finalIsNull).length,bytes:Buffer.byteLength(text)}));
} finally {delete host.__rhTerrRepair;delete host.__rhRepair;rmSync(temp,{recursive:true,force:true});}

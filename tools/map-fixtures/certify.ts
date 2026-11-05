/** Actual source oracle for independent hard-map certification. No reconstructed maps are represented as generator output. */
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {certifiedMap} from '../../packages/shared/src/mapgen.ts';
import {certifyMap,FEATURE_CHECKS,FENCE_CHECKS,type CertifyOptions} from '../../packages/shared/test/mapCertify.ts';
import type {GameMap} from '../../packages/shared/src/map.ts';
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw new Error('canonical Linux x64 Node 22.23.4 required');
const root=fileURLToPath(new URL('../../',import.meta.url));
const plain=(x:any):any=>ArrayBuffer.isView(x)?Array.from(x as unknown as ArrayLike<number>):Array.isArray(x)?x.map(plain):x!==null&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;
const revive=(x:any):GameMap=>({...x,tiles:Uint8Array.from(x.tiles),terrain:Uint8Array.from(x.terrain),regionGrid:Uint8Array.from(x.regionGrid),territoryGrid:Uint8Array.from(x.territoryGrid),featureGrid:Uint8Array.from(x.featureGrid)});
const BYTE_LAYERS=['tiles','terrain','regionGrid','territoryGrid','featureGrid'] as const;
function packMap(map:any){const out={...map};for(const key of BYTE_LAYERS){const values=map[key];if(!Array.isArray(values)||values.length!==25600||values.some((v:number)=>!Number.isInteger(v)||v<0||v>255))throw new Error(`invalid byte grid ${key}`);const rle:number[][]=[];for(const v of values){const last=rle.at(-1);if(last&&last[0]===v)last[1]++;else rle.push([v,1]);}out[key]={rle};}return out;}
const cases:any[]=[];
function add(name:string,origin:string,m:GameMap,options:CertifyOptions){const before=JSON.stringify(plain(m));const result=certifyMap(m,{...options,measures:false});if(JSON.stringify(plain(m))!==before)throw new Error(`input mutation: ${name}`);cases.push({name,origin,map:plain(m),options,failures:result.failures,strictZones:result.stats.strictZones});}
const count=Number(process.env.CERTIFY_COUNT??200);if(!Number.isInteger(count)||count<1||count>200)throw new Error('bounded count required');
for(let seed=0;seed<count;seed++){const m=certifiedMap(seed,{decor:false});if(!m)throw new Error(`missing real source map ${seed}`);add(`generated-${seed}-strict`,'actual-certifiedMap',m,{zone:true,strict:true});if(cases.at(-1).failures.length)throw new Error(`real source failures ${seed}: ${cases.at(-1).failures}`);if(seed%25===0)console.log(`actual source strict ${seed}`);}

const template=cases[0].map;
const clone=()=>revive(structuredClone(template));
function mutation(name:string,change:(m:GameMap)=>void,expect:string,options:CertifyOptions={zone:true,strict:true}){const m=clone();change(m);add(name,'controlled-mutation-of-actual-certifiedMap-0',m,options);if(!cases.at(-1).failures.some((s:string)=>s.startsWith(expect)))throw new Error(`ineffective control ${name} expected ${expect}: ${cases.at(-1).failures}`);cases.at(-1).expect=expect;}
const F=FEATURE_CHECKS;
const tile=(p:{x:number,y:number})=>Math.floor(p.y/32)*160+Math.floor(p.x/32);
const pos=(i:number)=>({x:(i%160)*32+16,y:Math.floor(i/160)*32+16});
const feature=(m:GameMap,kind:string)=>{const i=m.features.findIndex(f=>f.kind===kind);if(i<0)throw new Error(`missing real ${kind}`);return i;};
const owned=(m:GameMap,k:number)=>Array.from(m.featureGrid.keys()).filter(i=>m.featureGrid[i]===k+1);
mutation('fault-grid',m=>{m.tiles[0]=0;},'grid: 160');
mutation('fault-open-connectivity',m=>{m.tiles[161]=0;for(const i of [1,160,162,321])m.tiles[i]=1;},'connectivity: all walkable');
mutation('fault-closed-connectivity',m=>{m.coliseum.gates[0].tiles[0]={...m.coliseum.gates[0].tiles[1]};},'connectivity: gates closed');
mutation('fault-gates',m=>{m.coliseum.gates[0].x+=1;},'gates: four');
mutation('fault-arena-links',m=>{for(let i=0;i<m.tiles.length;i++){if(m.regionGrid[i]===6&&m.tiles[i]===1&&[i-1,i+1,i-160,i+160].some(j=>m.regionGrid[j]!==6&&m.tiles[j]===0)){m.tiles[i]=0;break;}}},'gates: the only links');
mutation('fault-gate-lanes',m=>{const p=m.coliseum.gates[0].tiles[0];m.tiles[(p.y-1)*160+p.x]=1;},'gates: a clear floor');
mutation('fault-coliseum-footprint',m=>{m.coliseum.rect.x++;},'coliseum: centred');
mutation('fault-coliseum-interior',m=>{m.coliseum.innerSpawns=[];},'coliseum: centre tile');
mutation('fault-zone-connectivity',m=>{m.regionGrid[161]=m.regionGrid[161]===1?2:1;},'zones: five');
mutation('fault-zone-area',m=>{for(let i=0,n=0;i<m.regionGrid.length&&n<10;i++)if(m.regionGrid[i]===1){m.regionGrid[i]=2;n++;}},'zones: painted areas');
mutation('fault-zone-floor-share',m=>{for(let i=0;i<m.tiles.length;i++)if(m.regionGrid[i]===1)m.tiles[i]=1;},'zones: walkable floor share');
mutation('fault-ring-contact',m=>{for(let i=0;i<m.regionGrid.length;i++)if(m.regionGrid[i]===1&&Array.from({length:49},(_,k)=>i+(Math.floor(k/7)-3)*160+k%7-3).some(j=>m.regionGrid[j]===6))m.regionGrid[i]=2;},'zones: ring-road contact');
mutation('fault-zone-slivers',m=>{for(let y=10;y<150;y+=2)for(let x=10;x<150;x+=2)if(m.regionGrid[y*160+x]===1)m.regionGrid[y*160+x]=2;},'zones: sliver tiles');
mutation('fault-ring-floor',m=>{for(let i=0;i<m.tiles.length;i++)if(m.regionGrid[i]!==6&&m.regionGrid[i]!==0&&Array.from({length:49},(_,k)=>i+(Math.floor(k/7)-3)*160+k%7-3).some(j=>m.regionGrid[j]===6))m.tiles[i]=1;},"zones: the ring road's floor");
mutation('fault-camp-count',m=>{m.camps[0].eliteSpot=0;m.camps[1].eliteSpot=0;m.camps[2].eliteSpot=0;},'camps: 10 per zone');
mutation('fault-camp-order',m=>{m.camps[0].id='changed';},'camps: ids');
mutation('fault-camp-spacing',m=>{m.camps[1].x=m.camps[0].x;m.camps[1].y=m.camps[0].y;},'camps: centres at least');
mutation('fault-territory-partition',m=>{m.territoryGrid[tile(m.camps[0])]=0;},'territories: partition');
mutation('fault-camp-centre',m=>{m.camps[0].x+=0.25;},'camps: fire-1 on a tile');
mutation('fault-camp-halo',m=>{m.tiles[tile(m.camps[0])]=1;},'camps: fire-1 clearing grown');
mutation('fault-camp-spots',m=>{m.camps[0].spots[1]={...m.camps[0].spots[0]};},'camps: fire-1 3-5');
mutation('fault-camp-elite-spot',m=>{m.camps[0].eliteSpot=1;},'camps: fire-1 eliteSpot');
mutation('fault-territory-connectivity',m=>{const c=m.camps[0];for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++)if(Math.abs(dx)===3||Math.abs(dy)===3)m.tiles[tile(c)+dy*160+dx]=1;},'territories: fire-1 walkable floor');
mutation('fault-camp-area-radius',m=>{m.camps[0].area++;m.camps[1].radius++;},'camps: fire-1 area and radius');
mutation('fault-territory-radius',m=>{m.territoryGrid[m.tiles.findIndex((t,i)=>t===0&&Math.hypot((i%160)-Math.floor(m.camps[0].x/32),Math.floor(i/160)-Math.floor(m.camps[0].y/32))>40)]=1;},'territories: fire-1 reaches');
mutation('fault-elite-selection',m=>{for(const c of m.camps)if(c.zone==='fire')c.eliteSpot=-1;m.camps[0].eliteSpot=0;m.camps[1].eliteSpot=0;},'camps: fire elite camps');
mutation('fault-spawn-count',m=>{m.spawnPool=m.spawnPool.slice(0,23);},'spawns: pool');
mutation('fault-spawn-placement',m=>{m.spawnPool[0].x+=0.5;},'spawns: tile centres');
mutation('fault-spawn-spacing',m=>{m.spawnPool[1]={...m.spawnPool[0]};},'spawns: 5+ tiles apart');
mutation('fault-spawn-camp',m=>{m.spawnPool[0]={...pos(tile(m.camps[0])),zone:m.camps[0].zone};},'spawns: 5+ tiles from');
mutation('fault-spawn-sight',m=>{m.spawnPool[1]={...m.spawnPool[0]};},'spawns: members under');
mutation('fault-spawn-ratio',m=>{m.spawnPool[0]={...m.coliseum.centre,zone:'fire'};},'spawns: every member walks');
mutation('fault-spawn-hazards',m=>{for(let i=0;i<m.tiles.length;i++)if(m.tiles[i]===0)m.terrain[i]=4;},'spawns: at most 8');
mutation('fault-region-order',m=>{m.regions.reverse();},'regions: five');
mutation('fault-views',m=>{m.regions[0].area++;},'views: mobCamps');
mutation('fault-feature-grid',m=>{m.featureGrid[0]=255;},F.grid);
mutation('fault-feature-table',m=>{m.features[0].variant='unknown';},F.table);
mutation('fault-feature-tiles',m=>{m.features[0].tiles++;m.features[1].tiles++;},F.tiles);
mutation('fault-feature-zone',m=>{m.features[0].zone='holy';},F.zone);
mutation('fault-feature-order',m=>{[m.features[0],m.features[m.features.length-1]]=[m.features.at(-1)!,m.features[0]];},F.order);
mutation('fault-feature-landmark',m=>{const f=m.features[feature(m,'landmark')];f.p=f.p.slice(0,2);},F.landmark);
mutation('fault-feature-buildings',m=>{m.buildings.pop();},F.buildings);
mutation('fault-feature-unowned',m=>{const i=m.tiles.findIndex((t,i)=>t===1&&m.regionGrid[i]===1);m.featureGrid[i]=0;},F.unowned);
mutation('fault-feature-hazards',m=>{const i=m.terrain.findIndex((t,i)=>t>=4&&m.tiles[i]===0);m.featureGrid[i]=0;},F.hazards);
mutation('fault-feature-kind-tiles',m=>{const k=feature(m,'mere');const i=owned(m,k)[0];m.tiles[i]=1;},F.kindTiles);
mutation('fault-feature-size',m=>{const k=feature(m,'gallows');const cells=owned(m,k).filter(i=>m.tiles[i]!==0);for(const i of cells.slice(5))m.tiles[i]=0;},F.size);
mutation('fault-feature-overlap',m=>{const k=feature(m,'crater');const i=tile(m.camps[0]);m.featureGrid[i]=k+1;m.tiles[i]=1;},F.overlap);
mutation('fault-feature-jobs',m=>{m.features[feature(m,'crater')].jobs=['rest'];},F.jobs);
mutation('fault-feature-whole',m=>{const k=feature(m,'gallows');m.tiles[owned(m,k).find(i=>m.tiles[i]===1)!]=0;},F.whole);
mutation('fault-feature-params',m=>{m.features[feature(m,'barrow')].p=[0,2,0,1];},F.params);
mutation('fault-pieces',m=>{const c=m.camps[0];m.tiles[tile(c)]=1;},F.pieces);
mutation('fault-fence-run',m=>{const c=m.camps.find(c=>c.zone==='sentenced')!;const t=tile(c);for(let dx=-7;dx<=7;dx++){m.tiles[t+dx]=2;m.terrain[t+dx]=2;m.regionGrid[t+dx]=2;}},FENCE_CHECKS.run);
mutation('fault-fence-detour',m=>{const c=m.camps.find(c=>c.zone==='sentenced')!;const t=tile(c);for(let dx=-7;dx<=7;dx++){m.tiles[t+dx]=2;m.terrain[t+dx]=2;m.regionGrid[t+dx]=2;}},FENCE_CHECKS.detour);
mutation('fault-crates',m=>{m.regions[0].chestSpots.pop();m.regions[0].chestSpots.pop();m.regions[0].chestSpots.pop();},'crates: 4-6');
mutation('fault-ground',m=>{m.groundSpots[1]={...m.groundSpots[0]};},'ground: 30-45');
mutation('fault-building-margin',m=>{m.buildings[0]={x:0,y:0,w:2,h:2};},'landmarks: each box');
mutation('fault-terrain-validator',m=>{m.terrain[0]=4;},'terrain: validateTerrain');
mutation('fault-unstyled-terrain',()=>{},'terrain: an unstyled',{zone:false,styled:false,strict:false});
mutation('fault-terrain-protected',m=>{m.terrain[tile(m.spawnPool[0])]=4;},'terrain: no kind');
mutation('fault-ice-neighbours',m=>{const t=tile(m.camps[0]);m.terrain[t]=6;m.tiles[t+1]=1;},'terrain: every ICE');
mutation('fault-reachability',m=>{m.groundSpots[0]=pos(m.tiles.findIndex((t,i)=>t===1&&m.regionGrid[i]===1&&i%160>2&&i%160<157&&Math.floor(i/160)>2&&Math.floor(i/160)<157));},'reachability: every');
mutation('fault-zone-terrain-home',m=>{m.terrain[tile(m.camps[0])]=7;},'styler=zone: every terrain');
mutation('fault-zone-floor-connectivity',m=>{for(let i=0;i<m.tiles.length;i++)if(m.regionGrid[i]===1)m.tiles[i]=1;},"styler=zone: every zone's walkable");
// Explicit mode controls use the same genuine source map; every option is observable.
for(const [name,options] of [['auto-zone',{zone:true}],['strict-off',{zone:true,strict:false}],['per-fire',{zone:true,strict:['fire']}],['per-sentenced',{zone:true,strict:['sentenced']}],['per-plague',{zone:true,strict:['plague']}],['per-frost',{zone:true,strict:['frost']}],['per-holy',{zone:true,strict:['holy']}]] as const)add(`mode-${name}`,'actual-certifiedMap-0-option-control',clone(),options as CertifyOptions);

mutation('terrain-T2-tile-code',m=>{m.tiles[tile(m.camps[0])]=4;},'terrain: validateTerrain');
mutation('terrain-T3-class',m=>{const i=m.tiles.findIndex((t,i)=>t===1&&m.regionGrid[i]===1);m.terrain[i]=4;},'terrain: validateTerrain');
mutation('terrain-T5-snap',m=>{const t=tile(m.camps[0]);for(let dy=-5;dy<=5;dy++)for(let dx=-5;dx<=5;dx++){m.tiles[t+dy*160+dx]=2;m.terrain[t+dy*160+dx]=1;}},'terrain: validateTerrain');
mutation('terrain-T6-home',m=>{m.terrain[tile(m.camps[0])]=7;},'terrain: validateTerrain');
mutation('terrain-T9-unknown-prop',m=>{m.props=[{kind:65535,...pos(tile(m.camps[0])),v:0}];},'terrain: validateTerrain');
mutation('terrain-T9-prop-class',m=>{m.props=[{kind:1,...pos(tile(m.camps[0])),v:0}];},'terrain: validateTerrain');
mutation('terrain-T9-prop-bounds',m=>{m.props=[{kind:0,x:-1,y:16,v:0}];},'terrain: validateTerrain');
mutation('terrain-T10-unstyled-low',m=>{const i=m.tiles.findIndex((t,i)=>t===2&&m.terrain[i]!==0);m.terrain[i]=0;},'terrain: validateTerrain');
for(const kind of ['landmark','crater','lavaRiver','fenceRow','gallows','barrow','mere','headland','spire','causeway','hall','infill','bush']){
 mutation(`params-${kind}`,m=>{const k=m.features.findIndex(f=>f.kind===kind);const f=m.features[k>=0?k:feature(m,'gallows')];f.kind=kind as any;f.p=[2147483647];},F.params);
}
mutation('feature-jobs-duplicate',m=>{m.features[0].jobs=['landmark','landmark'];},F.table);
mutation('feature-table-anchor',m=>{m.features[0].ax=-1;},F.table);
mutation('feature-table-empty-box',m=>{m.features[0].bbox.w=0;},F.table);
mutation('feature-tiles-outside-box',m=>{m.features[0].bbox.w=1;},F.tiles);
mutation('feature-landmark-wrong-design',m=>{m.features[feature(m,'landmark')].variant='shrine';},F.landmark);
mutation('feature-landmark-door-solid',m=>{const f=m.features[feature(m,'landmark')];m.tiles[f.p[2]]=1;},F.landmark);
mutation('feature-landmark-interior',m=>{const f=m.features[feature(m,'landmark')];for(let y=f.bbox.y+1;y<f.bbox.y+f.bbox.h-1;y++)for(let x=f.bbox.x+1;x<f.bbox.x+f.bbox.w-1;x++)m.tiles[y*160+x]=1;},F.landmark);
mutation('camp-multiple-distinct-areas',m=>{m.camps[0].area+=2;m.camps[1].area+=7;m.camps[2].radius+=3;},'camps: fire-1 area and radius');
mutation('camp-duplicate-ids-different-errors',m=>{m.camps[1].id=m.camps[0].id;m.camps[1].area+=3;},'camps: ids');
function modeFault(name:string,options:CertifyOptions,selected:boolean){const m=clone();const i=m.tiles.findIndex((t,i)=>t===1&&m.regionGrid[i]===1);m.featureGrid[i]=0;add(name,'controlled-fire-ownership-fault-mode-comparison',m,options);if(cases.at(-1).failures.some((s:string)=>s.startsWith(F.unowned))!==selected)throw new Error(`mode fault ${name}`);}
modeFault('mode-fault-fire-selected',{zone:true,strict:['fire']},true);
modeFault('mode-fault-fire-unselected',{zone:true,strict:['holy']},false);
modeFault('mode-fault-none',{zone:true,strict:false},false);
modeFault('mode-fault-auto-zone',{zone:true},true);
modeFault('mode-fault-auto-nonzone',{styled:true},false);
modeFault('mode-fault-true-nonzone',{styled:true,strict:true},true);
add('mode-duplicate-reordered-zones','actual-certifiedMap-0-option-control',clone(),{zone:true,strict:['holy','fire','holy']});

const CONTROL_CASES = ["fault-grid", "fault-open-connectivity", "fault-closed-connectivity", "fault-gates", "fault-arena-links", "fault-gate-lanes", "fault-coliseum-footprint", "fault-coliseum-interior", "fault-zone-connectivity", "fault-zone-area", "fault-zone-floor-share", "fault-ring-contact", "fault-zone-slivers", "fault-ring-floor", "fault-camp-count", "fault-camp-order", "fault-camp-spacing", "fault-territory-partition", "fault-camp-centre", "fault-camp-halo", "fault-camp-spots", "fault-camp-elite-spot", "fault-territory-connectivity", "fault-camp-area-radius", "fault-territory-radius", "fault-elite-selection", "fault-spawn-count", "fault-spawn-placement", "fault-spawn-spacing", "fault-spawn-camp", "fault-spawn-sight", "fault-spawn-ratio", "fault-spawn-hazards", "fault-region-order", "fault-views", "fault-feature-grid", "fault-feature-table", "fault-feature-tiles", "fault-feature-zone", "fault-feature-order", "fault-feature-landmark", "fault-feature-buildings", "fault-feature-unowned", "fault-feature-hazards", "fault-feature-kind-tiles", "fault-feature-size", "fault-feature-overlap", "fault-feature-jobs", "fault-feature-whole", "fault-feature-params", "fault-pieces", "fault-fence-run", "fault-fence-detour", "fault-crates", "fault-ground", "fault-building-margin", "fault-terrain-validator", "fault-unstyled-terrain", "fault-terrain-protected", "fault-ice-neighbours", "fault-reachability", "fault-zone-terrain-home", "fault-zone-floor-connectivity", "mode-auto-zone", "mode-strict-off", "mode-per-fire", "mode-per-sentenced", "mode-per-plague", "mode-per-frost", "mode-per-holy", "terrain-T2-tile-code", "terrain-T3-class", "terrain-T5-snap", "terrain-T6-home", "terrain-T9-unknown-prop", "terrain-T9-prop-class", "terrain-T9-prop-bounds", "terrain-T10-unstyled-low", "params-landmark", "params-crater", "params-lavaRiver", "params-fenceRow", "params-gallows", "params-barrow", "params-mere", "params-headland", "params-spire", "params-causeway", "params-hall", "params-infill", "params-bush", "feature-jobs-duplicate", "feature-table-anchor", "feature-table-empty-box", "feature-tiles-outside-box", "feature-landmark-wrong-design", "feature-landmark-door-solid", "feature-landmark-interior", "camp-multiple-distinct-areas", "camp-duplicate-ids-different-errors", "mode-fault-fire-selected", "mode-fault-fire-unselected", "mode-fault-none", "mode-fault-auto-zone", "mode-fault-auto-nonzone", "mode-fault-true-nonzone", "mode-duplicate-reordered-zones"] as const;
const HARD_RULES = ["grid", "grid-layers", "open-connectivity", "closed-connectivity", "gates", "arena-links", "gate-lanes", "coliseum-footprint", "coliseum-interior", "zone-connectivity", "zone-area", "zone-floor-share", "ring-contact", "zone-slivers", "ring-floor", "camp-count", "camp-order", "camp-spacing", "territory-partition", "camp-centre", "camp-halo", "camp-spots", "camp-elite-spot", "territory-connectivity", "camp-area-radius", "territory-radius", "elite-selection", "spawn-count", "spawn-placement", "spawn-spacing", "spawn-camp-spacing", "spawn-sight", "spawn-walk-ratio", "spawn-walk-hazards", "region-order", "views", "crates", "ground", "building-margin", "terrain-validator", "unstyled-terrain", "terrain-protected", "ice-neighbours", "reachability", "zone-terrain-home", "zone-floor-connectivity", "feature-grid", "feature-table", "feature-tiles", "feature-zone", "feature-order", "feature-landmark", "feature-buildings", "feature-unowned", "feature-hazards", "feature-kind-tiles", "feature-size", "feature-overlap", "feature-jobs", "feature-whole", "feature-params", "pieces", "fence-detour", "fence-run"] as const;
const requiredInventory=[...Array.from({length:count},(_,seed)=>`generated-${seed}-strict`),...CONTROL_CASES];
if(JSON.stringify(cases.map(c=>c.name))!==JSON.stringify(requiredInventory))throw new Error("exact case inventory mismatch");
const sources=new Map<string,string>();function visit(path:string){path=resolve(path);if(sources.has(path))return;const source=readFileSync(path,'utf8');sources.set(path,source);for(const m of source.matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)["']/g)){const next=resolve(dirname(path),m[1]);visit(next.endsWith('.ts')?next:next+'.ts');}}
visit(resolve(root,'packages/shared/src/mapgen.ts'));visit(resolve(root,'packages/shared/test/mapCertify.ts'));
const provenance=[...sources].map(([p,s])=>({path:relative(root,p),sha256:createHash('sha256').update(s).digest('hex')})).sort((a,b)=>a.path.localeCompare(b.path));
const result={hardRules:HARD_RULES,sourceSeedCount:count,oracleSha256:createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),format:'rh-map-certify/1',node:process.version,platform:process.platform,arch:process.arch,inputUnchanged:true,provenance,inventory:cases.map(c=>c.name),cases:cases.map(c=>({...c,map:packMap(c.map)}))};
const output=JSON.stringify(result)+'\n';const path=process.env.CERTIFY_OUTPUT??resolve(root,'crates/rh-sim/src/mapgen/fixtures/map-certify.json');
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==output)throw new Error('certifier fixture differs');}else writeFileSync(path,output);
console.log(`certifier ${process.argv.includes('--check')?'matches':'captured'} ${cases.length} actual cases`);

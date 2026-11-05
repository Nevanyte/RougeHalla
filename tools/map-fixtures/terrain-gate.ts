/** Pure actual validateTerrain oracle. Synthetic failure mutations are labelled, never claimed as generator seeds. */
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {validateTerrain, type ValidateTerrainOptions} from '../../packages/shared/src/terrain.ts';
import {PROP_KINDS} from '../../packages/shared/src/propKinds.ts';
import {certifiedMap} from '../../packages/shared/src/mapgen.ts';
import type {GameMap} from '../../packages/shared/src/map.ts';
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw new Error('canonical Linux x64 Node22.23.4 required');
const root=fileURLToPath(new URL('../../',import.meta.url));
const plain=(x:any):any=>ArrayBuffer.isView(x)?Array.from(x as unknown as ArrayLike<number>):Array.isArray(x)?x.map(plain):x!==null&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;
const revive=(x:any):GameMap=>({...x,tiles:Uint8Array.from(x.tiles),terrain:Uint8Array.from(x.terrain),regionGrid:Uint8Array.from(x.regionGrid),territoryGrid:Uint8Array.from(x.territoryGrid),featureGrid:Uint8Array.from(x.featureGrid)});
const cases:any[]=[];
function add(name:string,origin:string,map:GameMap,options:ValidateTerrainOptions={}){const before=JSON.stringify(plain(map));const problems=validateTerrain(map,options);if(JSON.stringify(plain(map))!==before)throw new Error('pure validator mutated input');cases.push({name,origin,map:plain(map),options,problems});}
for(const seed of [0,1])for(const mode of ['plain','styled','decor']){const options=mode==='plain'?{decor:false,styleZones:null}:{decor:mode==='decor'};const m=certifiedMap(seed,options);if(!m)throw new Error('missing real map');add(`generated-${seed}-${mode}`,'actual-certifiedMap',m,{styled:mode!=='plain'});if(validateTerrain(m,{styled:mode!=='plain'}).length)throw new Error('source generated map refused');}
for(const seed of [1,2]){const m=JSON.parse(readFileSync(resolve(root,`crates/rh-sim/src/mapdata/fixtures/seed${seed}.map.json`),'utf8'));add(`exported-${seed}`,'existing-rh-map/2-export',revive(m.map),{styled:true});}
const template=plain(cases[0].map);
function base(regions=true):GameMap {const w=21,h=21,n=w*h;const tiles=new Uint8Array(n);for(let x=0;x<w;x++)tiles[x]=tiles[(h-1)*w+x]=1;for(let y=0;y<h;y++)tiles[y*w]=tiles[y*w+w-1]=1;
 // One open floor component, two after the one door closes.
 for(let y=1;y<h-1;y++)tiles[y*w+10]=1;tiles[10*w+10]=0;
 return {...template,w,h,tiles,terrain:new Uint8Array(n),regionGrid:new Uint8Array(n).fill(1),territoryGrid:new Uint8Array(n),featureGrid:new Uint8Array(n),props:[],spawns:[],spawnPool:[],crateSpots:[],groundSpots:[],camps:[],buildings:[],features:[],regions:regions?[{id:'fire',pole:{x:80,y:80},area:n,spawns:[],chestSpots:[],mobCamps:[]}]:[],coliseum:{rect:{x:0,y:0,w:0,h:0},centre:{x:336,y:336},gates:[{side:'n',x:336,y:336,tiles:[{x:10,y:10}]}],innerSpawns:[]}} as GameMap;}
const pos=(x:number,y:number)=>({x:x*32+16,y:y*32+16});const ix=(x:number,y:number)=>y*21+x;
function probe(name:string,mutate:(m:GameMap)=>void,options:ValidateTerrainOptions={},regions=true){const m=base(regions);mutate(m);add(name,'independent-hand-built-invalid-mutation',m,options);}
add('hand-built-accepted','independent-hand-built',base());add('no-regions-accepted','independent-hand-built',base(false),{styled:true});
probe('lengths-short-circuit',m=>{m.tiles=m.tiles.slice(1);m.terrain=m.terrain.slice(2);m.regionGrid=m.regionGrid.slice(3);m.props=[{kind:65535,x:-10,y:0,v:0}];});
probe('codes-kinds-classes-count-order',m=>{m.tiles[ix(2,2)]=3;m.tiles[ix(3,2)]=255;m.terrain[ix(4,2)]=8;m.terrain[ix(5,2)]=255;m.tiles[ix(6,2)]=2;m.terrain[ix(6,2)]=4;m.terrain[ix(7,2)]=1;});
probe('border-top-bottom-order',m=>{m.tiles[20*21]=0;m.tiles[1]=0;});
probe('border-left-right-order',m=>{m.tiles[2*21]=0;m.tiles[21+20]=0;});
probe('far-low',m=>{m.tiles.fill(1);m.tiles[ix(1,1)]=0;m.tiles[ix(6,1)]=2;m.tiles[ix(1,6)]=2;});
probe('snap-radius-inclusive',m=>{m.tiles.fill(1);m.tiles[ix(1,1)]=0;m.tiles[ix(5,1)]=2;});
probe('ice-diagonal-orthogonal-edge-count',m=>{m.terrain[ix(3,3)]=6;m.tiles[ix(4,4)]=1;m.terrain[ix(6,6)]=6;m.tiles[ix(7,6)]=2;m.terrain[0]=6;},{},false);
probe('ice-self-only-class',m=>{m.terrain[ix(4,4)]=6;m.tiles[ix(4,4)]=1;},{},false);
probe('ice-clear-neighbors',m=>{m.terrain[ix(4,4)]=6;},{},false);
probe('region-and-home-order',m=>{m.tiles[ix(2,2)]=2;m.regionGrid[ix(2,2)]=0;m.terrain[ix(3,2)]=1;m.regionGrid[ix(3,2)]=6;m.terrain[ix(4,2)]=7;m.regionGrid[ix(4,2)]=4;m.terrain[ix(5,2)]=5;m.regionGrid[ix(5,2)]=255;});
probe('open-components',m=>{m.tiles[ix(10,10)]=1;});
probe('closed-components-zero-gates',m=>{m.coliseum.gates=[];});
probe('closed-out-of-bounds-gates',m=>{m.coliseum.gates[0].tiles.push({x:-1,y:0},{x:21,y:21});});
probe('gate-first',m=>{m.terrain[ix(10,10)]=4;});
probe('coliseum-low',m=>{m.regionGrid[ix(4,4)]=6;m.tiles[ix(4,4)]=2;});
probe('spawn-pool-region-duplicate-categories',m=>{const p=pos(4,4);m.spawns=[p];m.spawnPool=[{...p,zone:'fire'}];m.regions[0].spawns=[p];m.coliseum.innerSpawns=[p];m.terrain[ix(4,4)]=4;});
probe('spawn-pool-only',m=>{m.spawnPool=[{...pos(4,4),zone:'fire'}];m.tiles[ix(3,3)]=1;});
probe('region-spawn-only',m=>{m.regions[0].spawns=[pos(4,4)];m.tiles[ix(5,5)]=2;});
probe('inner-spawn-only',m=>{m.coliseum.innerSpawns=[pos(4,4)];m.tiles[ix(3,3)]=1;});
probe('spawn-hazard-5x5',m=>{m.spawns=[pos(4,4)];m.terrain[ix(2,2)]=4;});
probe('spawn-low-kind-hazard-allowed',m=>{m.spawns=[pos(4,4)];m.tiles[ix(2,2)]=2;m.terrain[ix(2,2)]=1;});
probe('chest-crate-ground-hazards',m=>{m.crateSpots=[pos(4,4)];m.regions[0].chestSpots=[pos(6,6)];m.groundSpots=[pos(4,4)];m.terrain[ix(3,3)]=4;m.terrain[ix(6,6)]=4;});
probe('chest-out-of-bounds',m=>{m.crateSpots=[pos(-1,4)];});
function camp(x:number,y:number,r:number){return {id:'probe',zone:'fire',...pos(x,y),r,spots:[],eliteSpot:-1,chest:pos(15,15),area:1,radius:1};}
probe('camp-clearing-and-margin',m=>{m.camps=[camp(4,4,32)];m.terrain[ix(4,4)]=4;m.terrain[ix(3,3)]=4;});
probe('mob-camp-clearing',m=>{m.regions[0].mobCamps=[{id:'mob',region:'fire',...pos(4,4),r:32,spots:[],elite:false,weapon:'sword'}];m.tiles[ix(4,4)]=1;});
probe('camp-fractional-boundary',m=>{m.camps=[camp(4,4,45.254833995939045)];m.terrain[ix(3,3)]=4;});
probe('camp-chest-only',m=>{m.camps=[camp(4,4,0)];m.terrain[ix(15,15)]=4;});
probe('prop-out-of-bounds-before-kind',m=>{m.props=[{kind:65535,x:-0.5,y:0,v:0}];});
probe('prop-unknown-kind',m=>{m.props=[{kind:65535,...pos(4,4),v:0}];});
probe('prop-standing-class-first',m=>{m.props=[{kind:1,...pos(4,4),v:0},{kind:65535,...pos(5,5),v:0}];});
probe('prop-custom-table',m=>{m.props=[{kind:0,...pos(4,4),v:0}];},{propKinds:[{key:'custom-wall',on:1,home:null}]});
probe('prop-empty-table',m=>{m.props=[{kind:0,...pos(4,4),v:0}];},{propKinds:[]});
probe('styled-last',m=>{m.tiles[ix(4,4)]=2;m.tiles[ix(5,5)]=2;m.props=[{kind:65535,...pos(4,4),v:0}];},{styled:true});
probe('region-early-return-skips-props-styled',m=>{m.tiles[ix(4,4)]=2;m.props=[{kind:65535,...pos(4,4),v:0}];},{styled:true},false);
for(let k=0;k<8;k++)for(const tile of [0,1,2,255])for(const region of [0,1,2,3,4,5,6,255])probe(`matrix-kind-${k}-tile-${tile}-region-${region}`,m=>{m.tiles[ix(4,4)]=tile;m.terrain[ix(4,4)]=k;m.regionGrid[ix(4,4)]=region;});
for(let k=0;k<PROP_KINDS.length;k++)for(const tile of [0,1,2])probe(`matrix-prop-${k}-tile-${tile}`,m=>{m.tiles[ix(4,4)]=tile;m.props=[{kind:k,...pos(4,4),v:0}];});
probe('camp-fractional-one-ulp-below',m=>{m.camps=[camp(4,4,45.25483399593904)];m.terrain[ix(3,3)]=4;});
const sources=new Map<string,string>();function visit(path:string){path=resolve(path);if(sources.has(path))return;const source=readFileSync(path,'utf8');sources.set(path,source);for(const m of source.matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)["']/g)){const next=resolve(dirname(path),m[1]);visit(next.endsWith('.ts')?next:next+'.ts');}}
visit(resolve(root,'packages/shared/src/terrain.ts'));visit(resolve(root,'packages/shared/src/mapgen.ts'));
const provenance=[...sources].map(([p,s])=>({path:relative(root,p),sha256:createHash('sha256').update(s).digest('hex')})).sort((a,b)=>a.path.localeCompare(b.path));
const rules=[...new Set(cases.flatMap(c=>c.problems.map((p:string)=>p.split(' ')[0])))].sort((a,b)=>Number(a.slice(1))-Number(b.slice(1)));
if(rules.join(',')!=='T1,T2,T3,T4,T5,T6,T7,T8,T9,T10,T11'||cases.length!==403)throw new Error(`incomplete inventory: ${cases.length} ${rules}`);
const bits=(n:number):string=>{const a=new ArrayBuffer(8),v=new DataView(a);v.setFloat64(0,n,false);return v.getBigUint64(0,false).toString(16).padStart(16,'0');};
const numericProbes=[];
for(const [x,y] of [[1e21,0],[-1e-7,0],[-0.000001,0],[-0, -1],[Number.MAX_VALUE,0],[Number.MIN_VALUE,-1],[-1.2345678901234567e22,0],[Number.POSITIVE_INFINITY,0],[Number.NaN,0]]){const m=base();m.props=[{kind:65535,x,y,v:0}];const before=bits(m.props[0].x)+bits(m.props[0].y);const problems=validateTerrain(m);if(bits(m.props[0].x)+bits(m.props[0].y)!==before)throw new Error('numeric input mutated');numericProbes.push({xBits:bits(x),yBits:bits(y),problems});}
const result={numericProbes,format:'rh-terrain-gate/1',node:process.version,platform:process.platform,arch:process.arch,inputUnchanged:true,provenance,inventory:cases.map(c=>c.name),rules,cases};
const output=JSON.stringify(result)+'\n';const path=process.env.TERRAIN_GATE_OUTPUT??resolve(root,'crates/rh-sim/src/mapgen/fixtures/terrain-gate.json');
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==output)throw new Error('terrain gate fixture differs');}else writeFileSync(path,output);
console.log(`terrain gate ${process.argv.includes('--check')?'matches':'captured'}: ${cases.length} cases, ${provenance.length} source files, ${rules.length} rules`);

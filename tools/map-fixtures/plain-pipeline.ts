/** Complete unmodified plain generator oracle and observational main-stream phase traces. */
import {readFileSync,writeFileSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import * as actual from '../../packages/shared/src/mapgen.ts';
import {mulberry32} from '../../packages/shared/src/rng.ts';
import {PINNED_PLAIN,PIN_STYLER_VERSIONS} from '../../packages/shared/test/mapPins.ts';
import {MAPGEN_FAILS} from '../../packages/shared/src/zones.ts';
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw Error('canonical Linux x64 Node22.23.4 required');
const base=fileURLToPath(new URL('../../packages/shared/src/',import.meta.url));
const source=readFileSync(join(base,'mapgen.ts'),'utf8');
const plain=(v:any):any=>ArrayBuffer.isView(v)?Array.from(v as any):Array.isArray(v)?v.map(plain):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])):v;
function once(s:string,a:string,b:string){if(s.split(a).length!==2)throw Error(`nonunique tap ${a}`);return s.replace(a,b);}
function pack(map:any){const p=plain(map);if(!p)return null;for(const k of ['tiles','terrain','regionGrid','territoryGrid','featureGrid']){const r:number[][]=[];for(const v of p[k]){const last=r[r.length-1];if(last&&last[0]===v)last[1]++;else r.push([v,1]);}p[k]={rle:r};}return p;}
const sources:Record<string,string>={};function hashSources(dir:string){for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){const p=join(dir,e.name);if(e.isDirectory())hashSources(p);else if(e.isFile()&&e.name.endsWith('.ts'))sources[relative(base,p)]=createHash('sha256').update(readFileSync(p)).digest('hex');}}hashSources(base);
const pinFile=fileURLToPath(new URL('../../packages/shared/test/mapPins.ts',import.meta.url));
const pins:any[]=[];
if(PINNED_PLAIN.length!==200||Object.values(PIN_STYLER_VERSIONS).some(v=>v!==400))throw Error('unexpected original pin inventory');
for(let seed=0;seed<200;seed++){
 const map=actual.certifiedMap(seed,{styleZones:null,decor:false});if(!map)throw Error(`source plain certified null ${seed}`);
 const pin=`${seed}:${map.attempt}:${actual.mapHash(map)}`;if(pin!==PINNED_PLAIN[seed])throw Error(`source original plain pin drift ${pin}`);
 pins.push({seed,pin,map:pack(map)});
}
const temp=mkdtempSync(join(tmpdir(),'rh-plain-pipeline-')),host=globalThis as any;
try {
 let tapped=once(source,'  const rng = mulberry32(attempt === 0 ? seed : seed + attempt * 0x9e3779b1);','  let __draws=0; const __rng=mulberry32(attempt === 0 ? seed : seed + attempt * 0x9e3779b1); const rng=()=>{__draws++;return __rng();};');
 const tap=(phase:string,pool='pool')=>`(globalThis as any).__rhPlain?.('${phase}',__draws,${pool});`;
 tapped=once(tapped,'  const features: FeatureDraft[] = [];',`  ${tap('Prefix','[]')}\n  const features: FeatureDraft[] = [];`);
 for(const [lap,phase] of [['landmarks','Landmarks'],['spawns','Spawns'],['nets','Nets'],['crates','Crates'],['post','Post'],['terrain','Terrain'],['bushes','Bushes'],['gates','Gates']] as const){const needle=`  lap("${lap}");`;tapped=once(tapped,needle,`  ${tap(phase,phase==='Landmarks'?'[]':'pool')}\n${needle}`);}
 tapped=once(tapped,'  const bushAvoid = new Uint8Array(N);',`  ${tap('Ground')}\n  const bushAvoid = new Uint8Array(N);`);
 tapped=once(tapped,'  if (features.length > FEATURES_MAX)',`  ${tap('SpawnGate','gate.pool')}\n  if (features.length > FEATURES_MAX)`);
 tapped=once(tapped,'  primeSpawnWalks(map, gate.walks);',`  primeSpawnWalks(map, gate.walks);\n  ${tap('Records','gate.pool')}`);
 // The final phase observes the kept pool, whereas earlier phases keep the original masks/pool.
 tapped=tapped.replace(tap('Gates'),tap('Gates','gate.pool'));
 tapped=tapped.replace(/(from\s+["'])(\.[^"']+)(["'])/g,(_,a,p,b)=>a+pathToFileURL(resolve(base,p)+'.ts').href+b);
 const path=join(temp,'mapgen.mts');writeFileSync(path,tapped);const observed=await import(pathToFileURL(path).href);
 const inventory:Array<[number,number,boolean,boolean,boolean]>=[[0,0,false,true,true],[1,0,false,true,true],[17,1,false,true,true],[-1,0,false,true,true],[4294967297,4294967296,false,true,true],[9007199254740991,9007199254740991,false,true,true],[1,0,true,true,true],[1,0,false,false,true],[1,0,false,true,false],[2459,0,false,true,true],[2459,1,false,true,true]];
 const cases:any[]=[];
 for(const [seed,attempt,decor,shapeGates,bushes] of inventory){const trace:any[]=[];host.__rhPlain=(phase:string,draws:number,pool:number[])=>{const r=mulberry32(attempt===0?seed:seed+attempt*0x9e3779b1);for(let n=0;n<draws;n++)r();trace.push({phase,continuation:Array.from({length:4},()=>Math.floor(r()*4294967296)),pool:pool.slice()});};
 const options={styleZones:null,decor,shapeGates,bushes};const before={...MAPGEN_FAILS};const reference=actual.tryAttempt(seed,attempt,options);const afterReference={...MAPGEN_FAILS};const map=observed.tryAttempt(seed,attempt,options);delete host.__rhPlain;
 if(!isDeepStrictEqual(plain(reference),plain(map))||(reference?actual.mapHash(reference):null)!==(map?observed.mapHash(map):null))throw Error('observational copy changed complete map/null/hash');
 const failures=Object.fromEntries(Object.entries(afterReference).filter(([k,v])=>v!==(before[k]??0)).map(([k,v])=>[k,v-(before[k]??0)]));
 cases.push({seed,attempt,options:{decor,shapeGates,bushes},completeFinalOutputEquality:true,hash:map?observed.mapHash(map):null,map:pack(map),trace,failures});
 }
 const wrappers=[];for(const seed of [1,2459]){const options={styleZones:null,decor:false};const certified=actual.certifiedMap(seed,options),generated=actual.generateMap(seed,undefined,options);if(!certified||!isDeepStrictEqual(plain(certified),plain(generated)))throw Error('source wrappers differ');wrappers.push({seed,map:pack(certified),hash:actual.mapHash(certified)});}
 const result={format:'rh-map-plain-pipeline/1',node:process.version,platform:process.platform,arch:process.arch,sources,pinsFileSha256:createHash('sha256').update(readFileSync(pinFile)).digest('hex'),pinStylerVersions:PIN_STYLER_VERSIONS,pins,cases,wrappers};const text=JSON.stringify(result)+'\n';
 const output=process.env.RH_PLAIN_OUTPUT??fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/map-plain-pipeline.json',import.meta.url));
 if(process.argv.includes('--check')){if(readFileSync(output,'utf8')!==text)throw Error('capture differs');}else writeFileSync(output,text);
 console.log(JSON.stringify({pins:pins.length,cases:cases.length,nullCases:cases.filter(c=>!c.map).length,bytes:Buffer.byteLength(text)}));
}finally{delete host.__rhPlain;rmSync(temp,{recursive:true,force:true});}

/** Actual records entry/return oracle; genuine post-spawn-gate arrays, no final-map reconstruction. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,relative,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import * as actual from '../../packages/shared/src/mapgen.ts';
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw Error('requires Linux x64 Node22.23.4');
const base=fileURLToPath(new URL('../../packages/shared/src/',import.meta.url));
const source=readFileSync(join(base,'mapgen.ts'),'utf8');
function once(s:string,a:string,b:string){if(s.split(a).length!==2)throw Error(`nonunique tap: ${a}`);return s.replace(a,b);}
const plain=(v:any):any=>ArrayBuffer.isView(v)?Array.from(v as any):Array.isArray(v)?v.map(plain):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])):v;
function rle(a:number[]){const out:number[][]=[];for(const v of a){const p=out[out.length-1];if(p&&p[0]===v)p[1]++;else out.push([v,1]);}return out;}
const layers=['tiles','terrain','regionGrid','territoryGrid','zone','landmarkBox','featureOwner','featureGrid'];
function pack(v:any){const p=plain(v);for(const k of layers)if(p[k])p[k]={rle:rle(p[k])};return p;}
const sources:Record<string,string>={};
function hashSources(dir:string){for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){const p=join(dir,e.name);if(e.isDirectory())hashSources(p);else if(e.isFile()&&e.name.endsWith('.ts'))sources[relative(base,p)]=createHash('sha256').update(readFileSync(p)).digest('hex');}}hashSources(base);
const temp=mkdtempSync(join(tmpdir(),'rh-records-'));
const host=globalThis as any;
try{
 let tapped=once(source,'function records(','export function records(');
 tapped=once(tapped,'  const F = fixedLayout();\n  const zoneOf =','  (globalThis as any).__rhRecords?.({seed,attempt,tiles,terrain,props,regionGrid,zone,territoryGrid,order,camps,reach2,pool,cratesByZone,landmarkBox,buildings,groundSpots,drafts,featureOwner});\n  const F = fixedLayout();\n  const zoneOf =');
 tapped=once(tapped,'  primeSpawnWalks(map, gate.walks);','  (globalThis as any).__rhRecordsOutput?.(map);\n  primeSpawnWalks(map, gate.walks);');
 tapped=tapped.replace(/(from\s+["'])(\.[^"']+)(["'])/g,(_,a,p,b)=>{const target=resolve(base,p)+'.ts';readFileSync(target);return a+pathToFileURL(target).href+b;});
 const path=join(temp,'mapgen.mts');writeFileSync(path,tapped);const observed=await import(pathToFileURL(path).href);
 const inventory:Array<[number,number,boolean,boolean]>=[[1,0,false,false],[-1,0,false,false],[4294967297,4294967296,false,false],[17,0,false,false],[17,1,false,false],[176,0,false,false],[1,0,true,false],[1,0,false,true],[1,0,true,true]];
 const cases:any[]=[];let first:any=null;
 for(const [seed,attempt,styled,decor] of inventory){const options=styled?{decor}:{decor,styleZones:null};let input:any=null,output:any=null;
 host.__rhRecords=(x:any)=>{if(input)throw Error('duplicate entry');input=plain(x);if(!first)first=plain(x);};host.__rhRecordsOutput=(x:any)=>{if(output)throw Error('duplicate output');output=plain(x);};
 const reference=actual.tryAttempt(seed,attempt,options),final=observed.tryAttempt(seed,attempt,options);delete host.__rhRecords;delete host.__rhRecordsOutput;
 const a=reference?actual.mapHash(reference):null,b=final?observed.mapHash(final):null;if(!isDeepStrictEqual(plain(reference),plain(final))||a!==b)throw Error('observer changed complete map/hash');
 if((input===null)!==(output===null))throw Error('unpaired tap');cases.push({seed,attempt,styled,decor,completeFinalOutputEquality:true,finalHash:b,input:input?pack(input):null,output:output?pack(output):null});
 }
 if(!first)throw Error('no actual records calls');
 const kinds=['landmark','crater','lavaRiver','fenceRow','gallows','barrow','mere','headland','spire','causeway','hall','infill','bush'];
 const synthetic:any[]=[];
 for(const name of ['empty-owner','sparse-owner']){
 const x=structuredClone(first);x.drafts=kinds.flatMap((kind,k)=>[0,1].map(v=>({kind,variant:`boundary-${v}`,zone:['holy','fire','frost','sentenced','plague'][k%5],jobs:v?['rest','cover']:[],ax:k+3,ay:k+4,p:kind==='mere'?[123,-99]:[v?x.camps.length-1:0,-1,x.camps.length],bbox:{x:0,y:0,w:159,h:159},tiles:99999})));
 // Additional invalid p0 references remain unchanged; p1 is never a camp reference.
 for(const p of [[],[-1,0],[x.camps.length,0]])for(const kind of ['crater','bush','mere'])x.drafts.push({kind,variant:'payload',zone:'fire',jobs:[],ax:0,ay:0,p,bbox:{x:0,y:0,w:99,h:99},tiles:99});
 x.featureOwner.fill(0);if(name==='sparse-owner'){for(let k=0;k<x.drafts.length;k++){x.featureOwner[k*161+3]=k+1;x.featureOwner[k*161+4]=k+1;x.terrain[k*161+3]=6;x.terrain[k*161+4]=0;}}
 const territoryBefore=x.territoryGrid.slice();const input=pack(x);
 const out=observed.records(x.seed,x.attempt,Uint8Array.from(x.tiles),Uint8Array.from(x.terrain),x.props,Uint8Array.from(x.regionGrid),Uint8Array.from(x.zone),Uint8Array.from(territoryBefore),x.order,x.camps,Int32Array.from(x.reach2),x.pool,x.cratesByZone,Uint8Array.from(x.landmarkBox),x.buildings,x.groundSpots,x.drafts,Uint16Array.from(x.featureOwner));
 synthetic.push({name,provenance:'synthetic boundary input derived from genuine pre-records source arrays; actual source records output',input,output:pack(out)});
 }
 const result={format:'rh-map-records/1',node:process.version,platform:process.platform,arch:process.arch,sources,cases,synthetic};const text=JSON.stringify(result)+'\n';
 const output=process.env.RH_RECORDS_OUTPUT??fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/map-records.json',import.meta.url));if(process.argv.includes('--check')){if(readFileSync(output,'utf8')!==text)throw Error('capture differs');}else writeFileSync(output,text);console.log(JSON.stringify({cases:cases.length,reached:cases.filter(c=>c.input).length,synthetic:synthetic.length,bytes:Buffer.byteLength(text)}));
}finally{delete host.__rhRecords;delete host.__rhRecordsOutput;rmSync(temp,{recursive:true,force:true});}

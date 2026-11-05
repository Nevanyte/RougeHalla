/** Actual generator stage-four admission/box oracle. Only observational taps; no recipe substitution.
 * Linux x64 Node22.23.4: node --import tsx tools/map-fixtures/landmark-stage.ts [--check]
 */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import * as actual from '../../packages/shared/src/mapgen.ts';

if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw Error('requires Linux x64 Node22.23.4');
const base=fileURLToPath(new URL('../../packages/shared/src/',import.meta.url));
const source=readFileSync(join(base,'mapgen.ts'),'utf8');
function once(s:string,a:string,b:string){if(s.split(a).length!==2)throw Error(`nonunique observation site: ${a}`);return s.replace(a,b);}
const plain=(v:any):any=>ArrayBuffer.isView(v)?Array.from(v as any):Array.isArray(v)?v.map(plain):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])):v;
function rle(a:ArrayLike<number>){const out:number[][]=[];for(let i=0;i<a.length;i++){const p=out[out.length-1];if(p&&p[0]===a[i])p[1]++;else out.push([a[i],1]);}return out;}
const hashes:Record<string,string>={};
function hashSources(path:string){for(const e of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){const p=join(path,e.name);if(e.isDirectory())hashSources(p);else if(e.isFile()&&e.name.endsWith('.ts'))hashes[relative(base,p).replaceAll('\\','/')]=createHash('sha256').update(readFileSync(p)).digest('hex');}}
hashSources(base);
const temp=mkdtempSync(join(tmpdir(),'rh-landmark-stage-'));
const host=globalThis as typeof globalThis & {__rhLandmarkStage?:(e:any)=>void};
try{
 let observed=once(source,'    const before = tiles.slice();','    const before = tiles.slice();\n    (globalThis as any).__rhLandmarkStage?.({type:"before",tiles,zone,order,protect:lprot});');
 observed=once(observed,'  lap("landmarks");','  (globalThis as any).__rhLandmarkStage?.({type:"admitted",tiles,features,featureOwner,buildings,landmarkBox,landmarkNear1});\n  lap("landmarks");');
 observed=observed.replace(/(from\s+["'])(\.[^"']+)(["'])/g,(_,a,p,b)=>{const target=resolve(base,p)+'.ts';readFileSync(target);return a+pathToFileURL(target).href+b;});
 const path=join(temp,'mapgen.mts');writeFileSync(path,observed);
 const tapped=await import(pathToFileURL(path).href);
 const inventory:[[number,number,boolean],...Array<[number,number,boolean]>]=[[1,0,false],[-1,0,false],[4294967297,4294967296,false],[176,0,false],[54,0,false],[17,0,false],[17,1,false],[1,0,true]];
 const cases:any[]=[];
 for(const [seed,attempt,styledObserverControl] of inventory){
  const options=styledObserverControl?{decor:false}:{decor:false,styleZones:null};
  const reference=actual.tryAttempt(seed,attempt,options);
  let before:any=null,admitted:any=null;
  host.__rhLandmarkStage=(e:any)=>{
   if(e.type==='before'){if(before!==null)throw Error('duplicate stage entry');before={tiles:rle(e.tiles),zone:rle(e.zone),order:plain(e.order),protect:rle(e.protect)};}
   else if(e.type==='admitted'){if(admitted!==null)throw Error('duplicate admission');admitted={tiles:rle(e.tiles),features:plain(e.features),featureOwner:rle(e.featureOwner),buildings:plain(e.buildings),landmarkBox:rle(e.landmarkBox),landmarkNear1:rle(e.landmarkNear1)};}
   else throw Error('unknown stage event');
  };
  let final;
  try{final=tapped.tryAttempt(seed,attempt,options);}finally{delete host.__rhLandmarkStage;}
  if(!before||!admitted)throw Error(`missing actual admitted stage ${seed}/${attempt}`);
  const referenceHash=reference?actual.mapHash(reference):null,finalHash=final?tapped.mapHash(final):null;
  if(!isDeepStrictEqual(plain(reference),plain(final))||referenceHash!==finalHash)throw Error(`observer changed full output ${seed}/${attempt}`);
  cases.push({seed,attempt,styledObserverControl,options,completeFinalOutputEquality:true,finalHash,before,admitted});
 }
 const result={format:'rh-landmark-stage/1',node:process.version,platform:process.platform,arch:process.arch,sourceSha256:hashes,scope:'Actual stage-four admission and masks; full output equality proves observational noninterference, not finished Rust pins.',cases};
 const text=JSON.stringify(result)+'\n';
 const destination=process.env.RH_LANDMARK_STAGE_OUTPUT??fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/landmark-stage.json',import.meta.url));
 if(process.argv.includes('--check')){if(readFileSync(destination,'utf8')!==text)throw Error('landmark stage fixture differs');}
 else writeFileSync(destination,text);
 console.log(JSON.stringify({checked:process.argv.includes('--check'),cases:cases.length,sources:Object.keys(hashes).length,bytes:Buffer.byteLength(text)}));
}finally{delete host.__rhLandmarkStage;rmSync(temp,{recursive:true,force:true});}

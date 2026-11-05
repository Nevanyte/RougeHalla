/** Actual legacy mapHash oracle. No copied hash or Number formatting algorithm. */
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import * as original from '../../packages/shared/src/mapgen.ts';
import {TILE} from '../../packages/shared/src/constants.ts';
import {TERRITORY_RADIUS_MAX} from '../../packages/shared/src/zones.ts';
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw Error('requires Linux x64 Node22.23.4');
const base=fileURLToPath(new URL('../../packages/shared/src/',import.meta.url));
const path=join(base,'mapgen.ts');const source=readFileSync(path,'utf8');
const sources:Record<string,string>={};
function inventory(p:string){const name=p.slice(base.length);if(sources[name])return;const s=readFileSync(p,'utf8');sources[name]=createHash('sha256').update(s).digest('hex');for(const m of s.matchAll(/(?:from\s+|import\s*)["'](\.{1,2}\/[^"']+)["']/g))inventory(resolve(dirname(p),m[1].replace(/\.(?:ts|js|mts)$/,'')+'.ts'));}
inventory(path);
function once(s:string,n:string,r:string){if(s.split(n).length!==2)throw Error('nonunique source tap '+n);return s.replace(n,r);}
let tapped=once(source,'  num(map.seed); num(map.attempt); num(map.w); num(map.h);','  __hashHelpers = { byte, bytes, str, num, value: () => h };\n  num(map.seed); num(map.attempt); num(map.w); num(map.h);');
tapped=once(tapped,'const str = (s: string): void => { for','const str = (s: string): void => { __stringObserver?.(s); for');
tapped+='\nexport let __hashHelpers:any; export let __stringObserver:((s:string)=>void)|undefined; export function __observeString(observer:((s:string)=>void)|undefined):void { __stringObserver=observer; }\n';
tapped=tapped.replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g,(_m,a,p,b)=>a+pathToFileURL(resolve(base,p.replace(/\.(?:ts|js|mts)$/,'')+'.ts')).href+b);
const dir=mkdtempSync(join(tmpdir(),'rh-map-hash-'));const target=join(dir,'mapgen.mts');writeFileSync(target,tapped);
const plain=(v:any):any=>ArrayBuffer.isView(v)?Array.from(v as any):Array.isArray(v)?v.map(plain):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])):v;
const bits=(v:number)=>{const b=Buffer.alloc(8);b.writeDoubleBE(v);return b.toString('hex');};
const value=(b:bigint)=>{const buf=Buffer.alloc(8);buf.writeBigUInt64BE(BigInt.asUintN(64,b));return buf.readDoubleBE();};
const clone=(m:any)=>structuredClone(m);
try {
 const observed:any=await import(pathToFileURL(target).href);const cases:any[]=[];
 for(const [seed,attempt,plainStyle,decor] of [[1,0,false,false],[1,0,false,true],[1,0,true,false],[1,0,true,true],[-1,0,false,false],[4294967297,4294967296,true,false],[17,1,false,false],[9007199254740991,1,true,false]] as const){
  const options=plainStyle?{styleZones:null,decor}:{decor};const baseline=original.tryAttempt(seed,attempt,options);const map=observed.tryAttempt(seed,attempt,options);
  if(!isDeepStrictEqual(map,baseline))throw Error('tapped generator changed complete map/null');
  if(map===null)throw Error(`selected map null ${seed}/${attempt}`);
  const before=clone(map);const hash=observed.mapHash(map);if(hash!==original.mapHash(baseline)||!isDeepStrictEqual(map,before))throw Error('hash/input noninterference');
  cases.push({seed,attempt,plainStyle,decor,options,fullMapEquality:true,inputUnchanged:true,hash,map:plain(map)});
 }
 const baseline=cases[0].map;const baseHash=original.mapHash(baseline);
 function probe(){observed.__observeString(undefined);if(observed.mapHash(baseline)!==baseHash)throw Error('probe initial differs');return observed.__hashHelpers;}
 const corpus=new Map<string,string>();const add=(v:number,label:string)=>{const b=bits(v);if(!corpus.has(b))corpus.set(b,label);};
 for(const v of [0,-0,NaN,Infinity,-Infinity,Number.MIN_VALUE,-Number.MIN_VALUE,Number.MAX_VALUE,-Number.MAX_VALUE,Number.EPSILON,0.1,0.3,1/3,1e-7,1e-6,1e-5,1e20,1e21,1e22,1000000000000000128,9007199254740991,9007199254740992,-9007199254740991])add(v,'named-boundary');
 for(let exp=-1074;exp<=1023;exp++){const v=2**exp;const b=BigInt('0x'+bits(v));for(const d of [-1n,0n,1n])for(const sign of [0n,1n<<63n])if(b+d>=0n)add(value((b+d)^sign),'binary-power-neighbor');}
 for(let exp=-323;exp<=308;exp++){const v=10**exp;const b=BigInt('0x'+bits(v));for(const d of [-1n,0n,1n])for(const sign of [0n,1n<<63n])if(b+d>=0n)add(value((b+d)^sign),'decimal-power-neighbor');}
 for(let reach2=0;reach2<=TERRITORY_RADIUS_MAX*TERRITORY_RADIUS_MAX;reach2++)add(Math.sqrt(reach2)*TILE,'camp-radius');
 for(let i=-1024;i<=1024;i++){add(9007199254740991+i,'safe-integer-neighbor');add(-9007199254740991-i,'safe-integer-neighbor');add(1+i/1024,'binary-fraction');}
 let state=0x243f6a8885a308d3n;for(let i=0;i<100000;i++){state^=state<<13n;state=BigInt.asUintN(64,state);state^=state>>7n;state^=state<<17n;state=BigInt.asUintN(64,state);add(value(state),'xorshift64');}
 const numbers:any[]=[];let text='';let helper=probe();observed.__observeString((s:string)=>{text=s;});
 for(const [b,group] of corpus){helper.num(value(BigInt('0x'+b)));numbers.push({bits:b,group,text,hash:helper.value()>>>0});}
 observed.__observeString(undefined);
 const strings:any[]=[];helper=probe();
 const unitsList=[[],[0],[0x1f],[0x41],[0xff],[0x100],[0x1234],[0xffff],[0xd800],[0xdc00],[0xd800,0xdc00],[0xdbff,0xdfff],[0x61,0xd800,0x62],[0xd83d,0xde80],[0x65,0x301],[0xe9],[0x4f60,0x597d],[0x41,0,0x42],[0x1f,0x1f]];
 for(let i=0;i<256;i++)unitsList.push([i,256+i,0xd800+i,0xdc00+i]);
 for(const units of unitsList){helper.str(String.fromCharCode(...units));strings.push({units,hash:helper.value()>>>0,scalarString:!units.some((u,i)=>u>=0xd800&&u<=0xdfff&&(u<=0xdbff?!(units[i+1]>=0xdc00&&units[i+1]<=0xdfff):!(units[i-1]>=0xd800&&units[i-1]<=0xdbff))) });}
 const bytes:any[]=[];helper=probe();for(let i=0;i<2048;i++){const b=i%256;helper.byte(b);bytes.push([b,helper.value()>>>0]);}
 const mutations:any[]=[];
 const resolvePath=(obj:any,path:(string|number)[])=>path.slice(0,-1).reduce((v,k)=>v[k],obj);
 function mutate(path:(string|number)[],op:string,replacement?:any,omitted=false){const map=clone(baseline);const parent=resolvePath(map,path),key=path.at(-1)!;const beforeValue=clone(parent[key]);if(op==='set')parent[key]=replacement;else if(op==='reverse')parent[key].reverse();else if(op==='dropLast')parent[key].pop();else throw Error('unknown mutation');if(isDeepStrictEqual(parent[key],beforeValue))return;const before=clone(map);const hash=original.mapHash(map);if(!isDeepStrictEqual(map,before))throw Error('mutation changed hash input');if((hash===baseHash)!==omitted)throw Error('mutation sensitivity '+path.join('.'));mutations.push({path,op,replacement:op==='set'?replacement:null,omitted,hash});}
 for(const key of ['seed','attempt','w','h'])mutate([key],'set',baseline[key]+1);
 for(const key of ['tiles','terrain','regionGrid','territoryGrid','featureGrid']){for(const i of [0,Math.floor(baseline[key].length/2),baseline[key].length-1])mutate([key,i],'set',(baseline[key][i]+1)&255);mutate([key],'reverse');}
 const scalars=(prefix:(string|number)[],keys:string[])=>{for(const key of keys){const obj=prefix.reduce((v,k)=>v[k],baseline);const old=obj[key];mutate([...prefix,key],'set',typeof old==='number'?old+1:old==='fire'?'holy':old==='holy'?'frost':'fire');}};
 const point=(prefix:(string|number)[])=>scalars(prefix,['x','y']);
 const points=(prefix:(string|number)[])=>{point([...prefix,0]);mutate(prefix,'reverse');mutate(prefix,'dropLast');};
 scalars(['camps',0],['id','zone','x','y','r','eliteSpot','area','radius']);point(['camps',0,'chest']);points(['camps',0,'spots']);
 scalars(['spawnPool',0],['x','y','zone']);scalars(['regions',0],['id','area']);point(['regions',0,'pole']);points(['regions',0,'spawns']);points(['regions',0,'chestSpots']);
 scalars(['buildings',0],['x','y','w','h']);
 scalars(['features',0],['variant','zone','ax','ay','tiles']);
 // Valid enum replacement; variant strings themselves remain unbounded by the hash function.
 mutate(['features',0,'kind'],'set',baseline.features[0].kind==='bush'?'crater':'bush');
 scalars(['features',0,'bbox'],['x','y','w','h']);
 mutate(['features',0,'jobs',0],'set','rest');mutate(['features',0,'jobs'],'reverse');mutate(['features',0,'jobs'],'dropLast');
 if(!baseline.features[0].p.length)throw Error('need feature payload');mutate(['features',0,'p',0],'set',baseline.features[0].p[0]+1);mutate(['features',0,'p'],'reverse');mutate(['features',0,'p'],'dropLast');
 for(const key of ['camps','spawnPool','regions','buildings','features']){mutate([key],'reverse');mutate([key],'dropLast');}
 for(const key of ['spawns','crateSpots','groundSpots'])points([key]);
 for(const key of ['props','coliseum'])mutate([key],'set',key==='props'?[{kind:1,x:16.5,y:16.5,v:0}]:{...baseline.coliseum,centre:{x:1,y:2}},true);
 mutate(['regions',0,'mobCamps'],'set',[],true);
 for(const id of ['camp-🚀','camp-e\u0301','camp-é','camp-你好','camp-\u0000\u001f'])mutate(['camps',0,'id'],'set',id);
 for(const variant of ['🚀','é','e\u0301','\u0000\u001f'])mutate(['features',0,'variant'],'set',variant);
 const radii=[];for(let reach2=0;reach2<=TERRITORY_RADIUS_MAX*TERRITORY_RADIUS_MAX;reach2++)radii.push({reach2,bits:bits(Math.sqrt(reach2)*TILE)});
 const numericMaps:any[]=[];const mapNumbers=new Set(radii.map(r=>r.bits));let ordinal=0;for(const [b,group] of corpus){const v=value(BigInt('0x'+b));if(Number.isFinite(v)&&v>=0&&(group==='named-boundary'||ordinal%2048===0))mapNumbers.add(b);ordinal++;}
 for(const b of mapNumbers){const map=clone(baseline);map.camps[0].radius=value(BigInt('0x'+b));const before=clone(map);const hash=original.mapHash(map);if(!isDeepStrictEqual(map,before))throw Error('numeric map input changed');numericMaps.push({bits:b,hash});}
 const output={format:'rh-map-hash/1',node:process.version,platform:process.platform,arch:process.arch,sources,cases,probeInitialHash:parseInt(baseHash,16),numbers,strings,bytes,mutations,radii,numericMaps,audit:{randomWords:100000,randomInitial:'243f6a8885a308d3',radiusMax:TERRITORY_RADIUS_MAX,tile:TILE,scope:'Hash parity on imported maps only; no Rust generator or map-pin claim. Helper closures exposed observationally, invoked only after mapHash returns. Nonfinite numbers/lone surrogates are helper-only source domains.'}};
 const out=JSON.stringify(output)+'\n';const destination=process.env.RH_MAP_HASH_OUTPUT??fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/map-hash.json',import.meta.url));if(process.argv.includes('--check')){if(readFileSync(destination,'utf8')!==out)throw Error('capture differs');}else writeFileSync(destination,out);console.log(JSON.stringify({cases:cases.length,numbers:numbers.length,strings:strings.length,bytes:bytes.length,mutations:mutations.length,numericMaps:numericMaps.length,sources:Object.keys(sources).length,destination}));
}finally{rmSync(dir,{recursive:true,force:true});}

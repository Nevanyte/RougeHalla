/** Actual unchanged exported helper capture; inserted entry observations never replace behavior. */
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw Error('requires Linux x64 Node22.23.4');
const base=fileURLToPath(new URL('../../packages/shared/src/',import.meta.url));
const temporary=mkdtempSync(join(tmpdir(),'rh-style-features-'));
const sources:Record<string,string>={};const paths=new Map<string,string>();
function prepare(path:string):string{path=resolve(path);if(paths.has(path))return paths.get(path)!;const relative=path.slice(base.length);const out=join(temporary,relative.replace(/\.ts$/,'.mts'));paths.set(path,out);let source=readFileSync(path,'utf8');sources[relative]=createHash('sha256').update(source).digest('hex');
 source=source.replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g,(_m,a,p,b)=>a+pathToFileURL(prepare(resolve(dirname(path),p.replace(/\.(?:ts|js|mts)$/,'')+'.ts'))).href+b);
 if(relative==='zoneStyle/features.ts'){
 for(const [name,args]of Object.entries({dirIndex16:'dx,dy',segDist2:'px,py,ax,ay,bx,by',discOffsets:'r4',inBeam:'dx,dy,ux,uy,half4',pseudoAngle:'dx,dy',primMST:'nodes,root',rngEdges:'nodes',addShortcuts:'nodes,edges,max,minRatio,maxLen',cyclomatic:'nodeCount,edges',chamferFrom:'sources,w,h',majoritySmooth:'set,allow,w,h,passes,threshold',componentsOf:'set,w,h,eight',pruneSmall:'set,w,h,min,eight',floodAbove:'value,tau,seed,allow,w,h',tauForArea:'value,seed,allow,w,h,target',viterbiRows:'value,lo,gapMin,gapMax,gapTarget,gapPenalty'})){
 const re=new RegExp('(export function '+name+'\\([^\\n]+\\{)');let hits=0;source=source.replace(re,m=>{hits++;return m+`\n(globalThis as any).__rhFeatureEntry?.('${name}',[${args}]);`;});if(hits!==1)throw Error('entry inventory '+name);}
 }
 mkdirSync(dirname(out),{recursive:true});writeFileSync(out,source);return out;
}
const plain=(v:any):any=>ArrayBuffer.isView(v)?Array.from(v):Array.isArray(v)?v.map(plain):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])):v;
try{
const features:any=await import(pathToFileURL(prepare(join(base,'zoneStyle/features.ts'))).href);
const kit:any=await import(pathToFileURL(prepare(join(base,'zoneStyle/kit.ts'))).href);
const mapgen:any=await import(pathToFileURL(prepare(join(base,'mapgen.ts'))).href);
// Strict complete exported-function inventory of the bounded pre-route source section.
const source=readFileSync(join(base,'zoneStyle/features.ts'),'utf8').split('// ------------------------------------------------------------------------------------------------ 3.9')[0];
const inventory=Array.from(source.matchAll(/export function (\w+)\(/g),m=>m[1]);
const reused=['dirSep16','isqrt','dist2','campNodes','gabrielEdges','argmaxIn','pseudoAngle'];
const owned=['dirIndex16','segDist2','discOffsets','inBeam','noiseQ','fbmQ','primMST','rngEdges','addShortcuts','cyclomatic','chamferFrom','majoritySmooth','componentsOf','pruneSmall','floodAbove','tauForArea','noisyPath','viterbiRows','viterbiPath'];
if(new Set(inventory).size!==inventory.length||!isDeepStrictEqual([...inventory].sort(),[...reused,...owned].sort()))throw Error('export inventory changed');
const typed=(name:string,a:any[]):any[]=>a.map((v,i)=>{
 if(['chamferFrom'].includes(name)&&i===0)return Int32Array.from(v);
 if(['majoritySmooth','componentsOf','pruneSmall'].includes(name)&&i===0)return Uint8Array.from(v);
 if(name==='majoritySmooth'&&i===1)return Uint8Array.from(v);
 if(['floodAbove','tauForArea','viterbiRows'].includes(name)&&i===0)return Int32Array.from(v);
 if((name==='floodAbove'&&i===3)||(name==='tauForArea'&&i===2))return Uint8Array.from(v);
 return v;
});
const cases:any[]=[];const caseKeys=new Set<string>();let repeatedObservedInputs=0;
const bits=(v:number)=>{const b=Buffer.alloc(8);b.writeDoubleBE(v);return b.toString('hex')};
function probe(name:string,args:any[],kind='labelled-boundary'){const input=plain(args);const key=JSON.stringify([name,kind,input]);if(caseKeys.has(key)){if(kind!=='observed-real-caller')throw Error('duplicate boundary input '+key);repeatedObservedInputs++;return;}caseKeys.add(key);const prepared=typed(name,args);const output=features[name](...prepared);const mutation=name==='pruneSmall'?plain(prepared[0]):name==='addShortcuts'?plain(prepared[1]):null;cases.push({name,kind,input,output:plain(output),outputBits:typeof output==='number'?bits(output):null,mutation});}
for(const v of [[0,0],[1,0],[-1,0],[0,-1],[392,946],[946,392],[-392,-946],[17.5,-9.25]])probe('dirIndex16',v);
for(const v of [[1,1,0,0,2,0],[3,4,0,0,0,0],[-1,2,0,0,3,4],[8,-2,0,0,3,4],[1.5,7.25,-3,2,9,11]])probe('segDist2',v);
for(const r of [-1,0,1,3,4,5,8,11,16])probe('discOffsets',[r]);
for(const v of [[0,0,1,0,4],[1,1,1,0,4],[1,1,1,0,3],[-1,0,1,0,4],[2,0,0,0,4],[3,-2,946,-392,8]])probe('inBeam',v);
for(const v of [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]])probe('pseudoAngle',v);
const nodes=(points:number[][])=>points.map(([x,y],camp)=>({x,y,kind:'camp',camp,elite:false}));
for(const points of [[],[[0,0]],[[0,0],[2,0],[2,2],[0,2]],[[0,0],[0,0],[2,0]],[[0,0],[2,0],[1,1],[7,3]]]){const ns=nodes(points);for(const root of [-1,0,2,99])probe('primMST',[ns,root]);probe('rngEdges',[ns]);const es=features.primMST(ns,0);probe('addShortcuts',[ns,es.map((e:any)=>[...e]),3,1.25,9]);probe('addShortcuts',[ns,[],2,2,9]);probe('cyclomatic',[ns.length,es]);}
const boundNodes=nodes([[0,0],[3,0],[6,0]]);for(const maxLen of [3,2.9999999999999996])probe('addShortcuts',[boundNodes,[],1,1,maxLen]);const squareNodes=nodes([[0,0],[2,0],[2,2],[0,2]]);for(const ratio of [3,3.0000000000000004])probe('addShortcuts',[squareNodes,features.primMST(squareNodes,0),1,ratio,2]);
for(const edges of [[],[[0,1],[1,2],[0,2]],[[0,1],[0,1]],[[0,0]]])probe('cyclomatic',[4,edges]);
for(const [w,h]of [[1,1],[5,4],[2,7]]){const n=w*h;for(const s of [[],[0],[-1,n,Math.floor(n/2)],[0,n-1]])probe('chamferFrom',[s,w,h]);const set=Array.from({length:n},(_,i)=>i%3===0?2:i%2),allow=Array.from({length:n},(_,i)=>i%7===0?0:1);for(const p of [0,1,2])for(const t of [0,5,9])probe('majoritySmooth',[set,allow,w,h,p,t]);for(const eight of [false,true]){probe('componentsOf',[set,w,h,eight]);probe('pruneSmall',[set,w,h,3,eight]);}const values=Array.from({length:n},(_,i)=>(i*7)%11-5);for(const seed of new Set([-1,0,Math.floor(n/2),n])){probe('floodAbove',[values,0,seed,allow,w,h]);for(const target of [0,1,4,n+1])probe('tauForArea',[values,seed,allow,w,h,target]);}}
for(const v of [[],[-1,-1],[0,0],[3,3,3,3],[5,-8,5,5,0,5]])for(const g of [[1,3,2,1],[0,2,1,0],[2,1,1,3]])probe('viterbiRows',[v,-3,...g]);
const observations:any[]=[];let observedNames=new Set<string>();(globalThis as any).__rhFeatureEntry=(name:string,args:any[])=>{if(observedNames.has(name))return;observedNames.add(name);observations.push({name,args:plain(args)});};
const entry=(globalThis as any).__rhFeatureEntry;const realCases=[];for(const [seed,attempt]of [[1,0],[17,1],[54,0]]){delete(globalThis as any).__rhFeatureEntry;const baseline=mapgen.tryAttempt(seed,attempt,{decor:false});observedNames=new Set();(globalThis as any).__rhFeatureEntry=entry;const result=mapgen.tryAttempt(seed,attempt,{decor:false});if(!isDeepStrictEqual(plain(result),plain(baseline)))throw Error('complete final output changed');const hash=result?mapgen.mapHash(result):null;if(hash!==(baseline?mapgen.mapHash(baseline):null))throw Error('final hash changed');realCases.push({seed,attempt,completeFinalOutputEquality:true,hash});}
delete(globalThis as any).__rhFeatureEntry;
for(const o of observations)probe(o.name,o.args,'observed-real-caller');
const noises=[];for(const stream of [0,4294967295,2147483648])for(const args of [[-3.25,7.5,7,4,99],[0,0,1,1,0],[2.5,-1.25,3,0,-1],[3,5,0.5,8,4294967297]]){const [x,y,cell,octaves,salt]=args,c={noise:kit.makeNoise(stream)};noises.push({stream,args,q:features.noiseQ(c,x,y,cell,salt),fbm:features.fbmQ(c,x,y,cell,octaves,salt)});}
const paths=[];for(let k=0;k<14;k++){const w=9,h=7,n=w*h,mask=Uint8Array.from({length:n},(_,i)=>i%11===0?0:1),hard=new Uint8Array(n),tiles=new Uint8Array(n);hard[31]=1;for(let i=0;i<n;i++)tiles[i]=i%w===4&&(k===12||i!==31)?1:0;const costs=Int32Array.from({length:n},(_,i)=>(i*7+k)%23);const c={w,h,mask,hard,tiles,noise:kit.makeNoise(k)};const calls:number[]=[];const a=k===0?0:10,b=k===0?0:52;const output=features.noisyPath(c,a,b,17,(i:number)=>{calls.push(i);return costs[i]});if(!isDeepStrictEqual(output,features.noisyPath(c,a,b,17,costs)))throw Error('cost modes diverged');paths.push({w,h,mask:plain(mask),hard:plain(hard),tiles:plain(tiles),stream:k,costs:plain(costs),a,b,salt:17,output,plainOutput:features.noisyPath(c,a,b,17),calls});}
const viterbi=[];for(const n of [0,1,7])for(const half of [0,1,3,127])for(const jog of [0,4]){const width=2*half+1,cost=Array.from({length:n*width},(_,i)=>(i*7)%13-5),calls:number[][]=[];const output=features.viterbiPath(n,half,(s:number,dt:number)=>{calls.push([s,dt]);return cost[s*width+dt+half]},jog);viterbi.push({n,half,jog,cost,output:plain(output),calls});}
for(const cost of [[0,10,0,0,0,0],[0,10,0,10,0,10]]){const n=2,half=1,jog=0,calls:number[][]=[];const output=features.viterbiPath(n,half,(s:number,dt:number)=>{calls.push([s,dt]);return cost[s*3+dt+1]},jog);viterbi.push({n,half,jog,cost,output:plain(output),calls});}
const unique=cases;
const scalar=(re:RegExp)=>{const matches=Array.from(source.matchAll(new RegExp(re.source,'g')));if(matches.length!==1)throw Error('numeric source probe '+re);return Number(matches[0][1]);};
const policies={chamferFar:features.CHAMFER_FAR,chamferOrthogonal:scalar(/if \(x > 0 && d\[i - 1\] \+ (\d+) < v\)/),chamferDiagonal:scalar(/if \(x > 0 && d\[i - w - 1\] \+ (\d+) < v\)/),majorityThreshold:scalar(/passes: number, threshold = (\d+)/),pathFar:1<<scalar(/const dist = new Int32Array\(n\).fill\(1 << (\d+)\)/),hardRadius:scalar(/for \(let dy = -(\d+); dy <= 3; dy\+\+\)/),noiseCell:scalar(/noise.value\(nx, ny, (\d+), salt\)/),noiseScale:scalar(/noise.value\(nx, ny, 7, salt\) \* (\d+)/),pathOrthogonal:scalar(/\? 14 : (\d+)\)/),pathDiagonal:scalar(/\? (\d+) : 10\)/),hardPenalty:scalar(/hardNear\[j\] \? (\d+) : 0/)};
const result={schema:1,node:process.version,platform:process.platform,arch:process.arch,scope:'Actual exported pre-route helpers; full arrays and mutation results. Boundary cases plus first observed call per helper per real attempt. No generator/pin claim.',sources:Object.fromEntries(Object.entries(sources).sort()),inventory,reused,owned,definitions:policies,dir8:kit.DIR8,cases:unique,repeatedObservedInputs,noises,paths,viterbi,realCases};
if(new Set(unique.map(c=>JSON.stringify([c.name,c.kind,c.input]))).size!==unique.length)throw Error('duplicate capture');for(const name of owned){if(![...unique.map(c=>c.name),'noiseQ','fbmQ','noisyPath','viterbiPath'].includes(name))throw Error('uncaptured '+name)}
const output=JSON.stringify(result)+'\n',path=process.env.RH_STYLE_FEATURES_OUTPUT??fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/style-features.json',import.meta.url));if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==output)throw Error('capture differs')}else writeFileSync(path,output);console.log(JSON.stringify({cases:unique.length,observed:unique.filter(c=>c.kind==='observed-real-caller').length,paths:paths.length,out:path}));
}finally{rmSync(temporary,{recursive:true,force:true});}

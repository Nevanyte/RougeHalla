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
const bits=(x:number)=>{const b=Buffer.alloc(8);b.writeDoubleBE(x);return b.toString('hex');};
const plain=(v:any):any=>ArrayBuffer.isView(v)?Array.from(v):Array.isArray(v)?v.map(plain):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])):v;
const names=['mapgen.ts','styler.ts','zoneStyle/hook.ts','zoneStyle/styleZones.ts','zoneStyle/context.ts','zoneStyle/landmarks.ts','zoneStyle/scorch.ts','zoneStyle/gallows.ts','zoneStyle/rime.ts','zoneStyle/sanctum.ts','zoneStyle/warren.ts','zoneStyle/kit.ts','zoneStyle/features.ts','zoneStyle/scale.ts','rng.ts','coliseum.ts','gridTopology.ts','map.ts','zoneStyle/types.ts'];
const base=fileURLToPath(new URL('../../packages/shared/src/',import.meta.url));
const temporary=mkdtempSync(join(tmpdir(),'rh-support-'));
const paths=new Map(names.map(n=>[resolve(base,n),join(temporary,n.replace(/\.ts$/,'.mts'))]));
const sources:Record<string,string>={};
function once(s:string,n:string,r:string){if(s.split(n).length!==2)throw Error(`nonunique tap ${n}`);return s.replace(n,r);}
for(const n of names){let s=readFileSync(join(base,n),'utf8');sources[n]=createHash('sha256').update(s).digest('hex');
 if(n==='zoneStyle/context.ts')s=once(s,'  return writerOf(rt, 3);',`  const c=writerOf(rt,3); const r=c.rng; let draws=0; c.rng=()=>{draws++;return r();};
  (globalThis as any).__rhSupportStream?.({c,seed:rt.init.seed,attempt:rt.init.attempt,index:rt.init.info.index,faction:rt.init.info.faction,draws:()=>draws});return c;`);
 if(n==='zoneStyle/styleZones.ts')s=once(s,'    styler.landmark(landmarkCtx(rt));','    styler.landmark(landmarkCtx(rt));\n    (globalThis as any).__rhSupportEnd?.();');
 s=s.replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g,(_m,a,p,b)=>{const original=resolve(dirname(join(base,n)),p.replace(/\.(?:ts|js|mts)$/,'')+'.ts');readFileSync(original);return a+pathToFileURL(paths.get(original)??original).href+b;});
 const out=paths.get(resolve(base,n))!;mkdirSync(dirname(out),{recursive:true});writeFileSync(out,s);
}
try {
const observed:any=await import(pathToFileURL(paths.get(resolve(base,'mapgen.ts'))!).href);
const contexts:any[]=[];const realCases:any[]=[];let active:any;
const host=globalThis as any;
host.__rhSupportStream=(e:any)=>{active=e;};
host.__rhSupportEnd=()=>{const e=active;if(!e)throw Error('missing context');const landmarkSeed=hashSeed(e.seed,e.attempt,e.index,3),noiseSeed=hashSeed(e.seed,e.attempt,e.index,103);const rng=mulberry32(landmarkSeed);const expected=[rng(),rng(),rng()].map(bits);const draws=e.draws();if(draws!==0)throw Error('actual landmark drew RNG');const continuation=[e.c.rng(),e.c.rng(),e.c.rng()].map(bits);if(!isDeepStrictEqual(continuation,expected))throw Error('context stream shifted');contexts.push({seed:e.seed,attempt:e.attempt,index:e.index,faction:e.faction,landmarkSeed,noiseSeed,draws,continuation,noiseBits:bits(e.c.noise.value(-3.25,7.5,7,99))});active=null;};
for(const [seed,attempt,styled] of [[1,0,false],[-1,0,false],[4294967297,4294967296,false],[176,0,false],[54,0,false],[17,1,false],[1,0,true]] as const){
 const options=styled?{decor:false}:{decor:false,styleZones:null}; const baseline=legacy.tryAttempt(seed,attempt,options);const start=contexts.length;const output=observed.tryAttempt(seed,attempt,options);
 if(!isDeepStrictEqual(plain(output),plain(baseline)))throw Error('complete final output differs');const hash=output?observed.mapHash(output):null;if(hash!==(baseline?legacy.mapHash(baseline):null))throw Error('final mapHash differs');
 realCases.push({seed,attempt,styledObserverControl:styled,options,completeFinalOutputEquality:true,finalHash:hash,contextRange:[start,contexts.length]});
}
delete host.__rhSupportStream;delete host.__rhSupportEnd;
const hashes=[[-1.5,-3.75,-4294967297],[4294967297,-4294967298,9007199254740991],[0,0,0],[2147483648,4294967295,-0.5],[1e30,-1e30,3.75]].map(args=>({args,bits:bits(kit.hash2(...args as [number,number,number]))}));
const noises=[[-3.25,7.5,7,99,4294967295],[0,0,1,401,0],[4294967297.5,-3.75,7,-4294967297,2147483648],[2.25,5.5,1,0.75,5]].map(args=>{const [x,y,cell,salt,stream]=args;const c={noise:kit.makeNoise(stream)};return {args,valueBits:bits(c.noise.value(x,y,cell,salt)),vnoiseBits:bits(kit.vnoise(x,y,cell,salt)),q:features.noiseQ(c,x,y,cell,salt)};});
const rounds=[-1.5,-0.5,-0.3,-0,0,0.49999999999999994,0.5,1.5,4503599627370497].map(x=>({inputBits:bits(x),resultBits:bits(Math.round(x))}));
const fields=[{field:[-9,-2,-2,9],mask:[1,1,1,0],from:-3,to:99},{field:[1,2],mask:[0,0],from:0,to:2},{field:[1,2],mask:[1,1],from:2,to:1},{field:[],mask:[],from:0,to:0}].map(c=>({...c,result:features.argmaxIn(Int32Array.from(c.field),Uint8Array.from(c.mask),c.from,c.to)}));
const graphInputs=[[],[[0,0],[2,0],[1,1]],[[0,0],[2,0],[1,0]],[[0,0],[0,0],[2,0]],[[0,0],[2,0],[2,2],[0,2]]];
const graphs=graphInputs.map(points=>{const nodes=points.map(([x,y],camp)=>({x,y,kind:'camp' as const,camp,elite:false}));return {nodes,edges:features.gabrielEdges(nodes)};});
const fl=fixedLayout();const candidates=Array.from(fl.distFp).flatMap((d,i)=>d>RING_ROAD+1&&d<=RING_ROAD+4?[i]:[]);const first=candidates[0],second=candidates[1];
const campCases:any[]=[];
for(const name of ['door-tie','current-collision-changed','all-door-floor-removed','non-generator-grid','empty-mask'] ){
 const w=name==='non-generator-grid'?4:160,h=w,n=w*h;const mask=new Uint8Array(n),tiles=new Uint8Array(n).fill(TILE_WALL);
 const ids=w===160?[first,second]:[5,6];if(name!=='empty-mask')for(const i of ids){mask[i]=1;tiles[i]=TILE_FLOOR;}
 if(name==='current-collision-changed')tiles[first]=TILE_WALL;if(name==='all-door-floor-removed')for(const i of ids)tiles[i]=TILE_WALL;
 const camps=[{x:ids[1]%w,y:Math.floor(ids[1]/w),index:9,elite:true},{x:-1,y:0,index:3,elite:false},{x:ids[0]%w,y:Math.floor(ids[0]/w),index:2,elite:false}];
 const centroid={x:((ids[0]%w)+(ids[1]%w))/2+0.5,y:(Math.floor(ids[0]/w)+Math.floor(ids[1]/w))/2+0.5};const zone={bbox:{x:0,y:0,w,h},centroid};const c={w,h,mask,tiles,camps,zone};
 campCases.push({name,w,h,maskIndices:Array.from(mask).flatMap((v,i)=>v?[i]:[]),floorIndices:Array.from(tiles).flatMap((v,i)=>v===TILE_FLOOR?[i]:[]),camps,zone,distFp:w===160?ids.map(i=>[i,fl.distFp[i]]):null,result:features.campNodes(c)});
}
// Direct exported distance calls and a labelled inline common count expression; neither replays a recipe.
const countExpression='Math.min(LANDMARKS_PER_ZONE, Math.round(areaScale(c.zone.painted)))';
if(!readFileSync(join(base,'zoneStyle/gallows.ts'),'utf8').includes('const want = '+countExpression+';'))throw Error('source count expression changed');
const scalarBoundaries={
 distances:{provenance:{kind:'actual-exported-helper',source:'zoneStyle/features.ts',export:'dist2'},cases:[[-12.25,3.5,5.75,-8],[0,0,3,4],[17.5,-3.25,-11.75,4.5]].map(args=>({args,bits:bits(features.dist2(...args as [number,number,number,number]))}))},
 landmarkLimits:{provenance:{kind:'inline-source-count-expression-probe',source:'zoneStyle/gallows.ts',expression:countExpression,scope:'Common count upper-limit expression only; no callback or recipe replay'},cases:[0,854,855,856,2564,2565,2566,4275].map(painted=>({painted,bits:bits(Math.min(scale.LANDMARKS_PER_ZONE,Math.round(scale.areaScale(painted))))}))}
};
const result={schema:1,scalarBoundaries,node:process.version,platform:process.platform,arch:process.arch,sources,scope:'Actual source direct helper probes and stream-only observations; no recipe replay, stage4 parity or finished pins.',definitions:{refZoneTiles:scale.REF_ZONE_TILES,landmarksPerZone:scale.LANDMARKS_PER_ZONE,landmarkStream:3,noiseStreamOffset:100,doorMinOffset:1,doorMaxOffset:4},hashes,noises,rounds,fields,graphs,campCases,dir16:features.DIR16,directionSeparations:[[-1,16],[0,8],[15,0],[3,15]].map(([a,b])=>({a,b,result:features.dirSep16(a,b)})),squareRoots:[-1,0,1,2,8,9,10,9007199254740991].map(n=>({n,result:features.isqrt(n)})),scales:[0,1,855,1710,2600,4936].map(painted=>({painted,areaBits:bits(scale.areaScale(painted)),lenBits:bits(scale.lenScale(painted))})),realCases,contexts};
const output=JSON.stringify(result)+'\n';const path=process.env.RH_SUPPORT_OUTPUT??fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/landmark-support.json',import.meta.url));if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==output)throw Error('capture differs');}else writeFileSync(path,output);console.log(JSON.stringify({realCases:realCases.length,contexts:contexts.length,allZeroDraws:contexts.every(c=>c.draws===0),out:path}));
} finally {rmSync(temporary,{recursive:true,force:true});}

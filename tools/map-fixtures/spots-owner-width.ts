/** Source-backed Uint16 ownership boundary controls; synthetic crate-leaf inputs, not finished maps. */
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {mulberry32} from '../../packages/shared/src/rng.ts';
import {TILE_FLOOR,TILE_WALL} from '../../packages/shared/src/map.ts';
import type {FeatureDraft} from '../../packages/shared/src/zoneStyle/types.ts';
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw Error('requires Linux x64 Node22.23.4');
const sourcePath=fileURLToPath(new URL('../../packages/shared/src/mapgen.ts',import.meta.url));
const source=readFileSync(sourcePath,'utf8'),start=source.indexOf('  const doorNear = new Uint8Array(N);'),end=source.indexOf('\n  const allCrates = cratesByZone.flat();',start);
if(start<0||end<0||source.indexOf('  const doorNear = new Uint8Array(N);',start+1)>=0)throw Error('crate boundaries changed');
const body=source.slice(start,end);
function replace(s:string,a:string,b:string){if(s.split(a).length!==2)throw Error(`nonunique ${a}`);return s.replace(a,b);}
const tap=(s:string)=>`(globalThis as any).__ownerWidth(${s});`;
let watched=replace(body,'  const cratesByZone: number[][] = [];',`  ${tap('{kind:"masks",doorNear,nooksByZone,initialNo:crateNo.slice()}')}\n  const cratesByZone: number[][] = [];`);
watched=replace(watched,'    shuffle(rng, cands);',`    shuffle(rng, cands);\n    ${tap('{kind:"zone",nooks,cands,want}')} `);
watched=replace(watched,'      shuffle(rng, open);',`      shuffle(rng, open);\n      ${tap('{kind:"open",open}')} `);
watched=replace(watched,'    if (chosen.length < CRATES_MIN) return failed("A:crates");',`    ${tap('{kind:"chosen",chosen,refused:chosen.length<CRATES_MIN}')}\n    if (chosen.length < CRATES_MIN) return failed("A:crates");`);
watched+=`\n${tap('{kind:"end",crateNo}')}`;
const args='rng:any,tiles:any,terrain:any,zone:any,ring:any,pool:any,camps:any,features:any,featureOwner:any,hook:any';
let module=source+`\nexport function __reference(${args}){${body}\nreturn cratesByZone;}\nexport function __observed(${args}){${watched}\nreturn cratesByZone;}\n`;
module=module.replace(/(from\s+["'])(\.[^"']+)(["'])/g,(_,a,p,b)=>a+pathToFileURL(resolve(dirname(sourcePath),p)+'.ts').href+b);
const temp=mkdtempSync(join(tmpdir(),'rh-owner-width-'));const plain=(v:any)=>JSON.parse(JSON.stringify(v,(_,x)=>ArrayBuffer.isView(x)?Array.from(x as any):x));
const mask=(a:number[])=>({length:a.length,ones:a.flatMap((v,i)=>{if(v!==0&&v!==1)throw Error('nonbinary mask');return v?[i]:[];})});
const padding:FeatureDraft={kind:'infill',variant:'',zone:'fire',jobs:['seal'],ax:0,ay:0,p:[],bbox:{x:0,y:0,w:0,h:0},tiles:0};
try{
 const path=join(temp,'source.mts');writeFileSync(path,module);const actual=await import(pathToFileURL(path).href);const cases=[];
 for(const ownerId of [255,256,257,65535])for(const control of ['same-owner','foreign-wall','foreign-floor']){
  const floorZones:number[][]=[];for(let z=1;z<=5;z++)for(let k=0;k<8;k++)floorZones.push([30*160+8+28*(z-1)+3*k,z]);
  const first=floorZones[0][0],foreign=ownerId===255?254:((ownerId&255)||1);const ownership:number[][]=[];
  for(let k=0;k<4;k++){const t=floorZones[k][0];ownership.push([t,ownerId],[t-1,ownerId],[t-160,ownerId]);}
  if(control==='foreign-wall')ownership.find(v=>v[0]===first-160)![1]=foreign;
  if(control==='foreign-floor')ownership.find(v=>v[0]===first)![1]=foreign;
  const landmark:FeatureDraft={kind:'landmark',variant:'owner-width-control',zone:'fire',jobs:['cover'],ax:8,ay:30,p:[0,0,floorZones[4][0]],bbox:{x:8,y:30,w:22,h:1},tiles:12};
  const input={ownerId,control,foreignOwner:foreign,floorZones,ownership,pool:[floorZones[7][0]],camps:[{zone:1,site:floorZones[6][0],elite:false,spots:[floorZones[5][0]]}],landmark,seed:73,styled:false};
  const tiles=new Uint8Array(25600).fill(TILE_WALL),zone=new Uint8Array(25600),owners=new Uint16Array(25600),terrain=new Uint8Array(25600),ring=new Uint8Array(25600);
  for(const [t,z]of floorZones){tiles[t]=TILE_FLOOR;zone[t]=z;}for(const [t,id]of ownership)owners[t]=id;
  const features:FeatureDraft[]=Array.from({length:ownerId},()=>structuredClone(padding));features[ownerId-1]=landmark;
  const output:any={zones:[],refusal:null};(globalThis as any).__ownerWidth=(raw:any)=>{const e=plain(raw);if(e.kind==='masks')Object.assign(output,{doorNear:mask(e.doorNear),nooksByZone:e.nooksByZone,initialNo:mask(e.initialNo)});else if(e.kind==='zone')output.zones.push({nooks:e.nooks,cands:e.cands,want:e.want,open:null,chosen:[]});else if(e.kind==='open')output.zones.at(-1).open=e.open;else if(e.kind==='chosen'){output.zones.at(-1).chosen=e.chosen;output.refusal=e.refused?'Crates':null;}else if(e.kind==='end')output.crateNo=mask(e.crateNo);else throw Error('unknown event');};
  function run(fn:any){const r=mulberry32(input.seed),words:number[]=[];const result=fn(()=>{const v=r();words.push(v*4294967296);return v;},tiles,terrain,zone,ring,input.pool,input.camps,features,owners,null);return {result,words,continuation:Array.from({length:8},()=>r()*4294967296)};}
  const baseline=run(actual.__reference),observed=run(actual.__observed);if(!isDeepStrictEqual(baseline,observed))throw Error('observation changed result/draws');
  if(!baseline.result||output.zones.length!==5||output.refusal!==null)throw Error('must finish all zones');
  const expected=floorZones.slice(control==='same-owner'?0:1,4).map(v=>v[0]);if(!isDeepStrictEqual(output.nooksByZone[1],expected))throw Error('ownership control ineffective');
  cases.push({input,output,words:baseline.words,continuation:baseline.continuation,result:baseline.result,completeOutputAndRngEquality:true});
 }
 const sources=Object.fromEntries(['mapgen.ts','rng.ts','map.ts','constants.ts','zoneStyle/types.ts'].map(p=>[p,createHash('sha256').update(readFileSync(resolve(dirname(sourcePath),p))).digest('hex')]));
 const result={format:'rh-map-spots-owner-width/1',runtime:{node:process.version,platform:process.platform,arch:process.arch},sources,sourceBlockSha256:createHash('sha256').update(body).digest('hex'),paddingFeature:padding,inventory:{cases:12,ids:[255,256,257,65535],controls:['same-owner','foreign-wall','foreign-floor'],zones:60},cases};
 const bytes=JSON.stringify(result)+'\n',output=process.env.RH_OWNER_WIDTH_OUT??fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/map-spots-owner-width.json',import.meta.url));
 if(process.argv.includes('--check')){if(readFileSync(output,'utf8')!==bytes)throw Error('capture bytes differ');}else writeFileSync(output,bytes);
 console.log(JSON.stringify({cases:cases.length,zones:60,bytes:Buffer.byteLength(bytes),sourceBlockSha256:result.sourceBlockSha256}));
}finally{delete(globalThis as any).__ownerWidth;rmSync(temp,{recursive:true,force:true});}

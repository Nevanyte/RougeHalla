/** Actual stage-ten/loot snapshots and private source ICE/shape helpers; no copied oracle algorithms. */
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import * as actual from '../../packages/shared/src/mapgen.ts';
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64') throw Error('requires Linux x64 Node22.23.4');
const base=fileURLToPath(new URL('../../packages/shared/src/',import.meta.url));
const source=readFileSync(join(base,'mapgen.ts'),'utf8');
function once(s:string,a:string,b:string){if(s.split(a).length!==2)throw Error(`nonunique tap: ${a}`);return s.replace(a,b);}
const plain=(v:any):any=>ArrayBuffer.isView(v)?Array.from(v as any):Array.isArray(v)?v.map(plain):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])):v;
function rle(a:number[]){const out:number[][]=[];for(const v of a){const p=out[out.length-1];if(p&&p[0]===v)p[1]++;else out.push([v,1]);}return {rle:out};}
function pack(v:any){const p=plain(v);for(const k of ['tiles','terrain','zone','featureGrid','bushAvoid'])if(p[k])p[k]=rle(p[k]);return p;}
const sources:Record<string,string>={};
function hashSources(dir:string){for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){const p=join(dir,e.name);if(e.isDirectory())hashSources(p);else if(e.isFile()&&e.name.endsWith('.ts'))sources[relative(base,p)]=createHash('sha256').update(readFileSync(p)).digest('hex');}}
hashSources(base);
const temp=mkdtempSync(join(tmpdir(),'rh-map-tail-'));
const host=globalThis as any;
try {
  let tapped=once(source,'function clearIceBesideSolid(','export function clearIceBesideSolid(');
  tapped=once(tapped,'function shapeGateFailure(','export function shapeGateFailure(');
  const buriedAnchor='  };\n\n  // --- 7. Safety nets';
  tapped=once(tapped,buriedAnchor,'  };\n  (globalThis as any).__rhTailBuried?.(clearBuried,tiles,terrain,hook!==null);\n\n  // --- 7. Safety nets');
  const terrainAnchor="  // --- 10. The stylers' layer";
  tapped=once(tapped,terrainAnchor,"  (globalThis as any).__rhTail?.({phase:'terrainBefore',styled:hook!==null,tiles,terrain,props});\n"+terrainAnchor);
  tapped=once(tapped,'  lap("terrain");',"  (globalThis as any).__rhTail?.({phase:'terrainAfter',tiles,terrain,props});\n  lap(\"terrain\");");
  tapped=once(tapped,'  if (props.length > 0) {',"  (globalThis as any).__rhTail?.({phase:'lootBefore',tiles,terrain,props,pool,allCrates,groundSpots});\n  if (props.length > 0) {");
  tapped=once(tapped,'  const bushAvoid = new Uint8Array(N);',"  (globalThis as any).__rhTail?.({phase:'lootAfter',props});\n  const bushAvoid = new Uint8Array(N);");
  tapped=once(tapped,'  if (bushes) placeEliteBushes({',"  (globalThis as any).__rhTail?.({phase:'bushAvoid',bushAvoid,zone});\n  if (bushes) placeEliteBushes({");
  tapped=tapped.replace(/(from\s+["'])(\.[^"']+)(["'])/g,(_,a,p,b)=>{const target=resolve(base,p)+'.ts';readFileSync(target);return a+pathToFileURL(target).href+b;});
  const path=join(temp,'mapgen.mts');writeFileSync(path,tapped);
  const observed=await import(pathToFileURL(path).href);
  const inventory:Array<[number,number,boolean,boolean,boolean]>=[[1,0,false,false,false],[-1,0,false,false,false],[4294967297,4294967296,false,false,false],[17,0,false,false,false],[17,1,false,false,false],[176,0,false,false,false],[1,0,true,false,false],[1,0,false,true,false],[1,0,true,true,false],[1,0,true,true,true]];
  const cases:any[]=[];
  const buried:any[]=[];
  for(const [seed,attempt,styled,decor,syntheticProps] of inventory){
    const phases:any[]=[];
    let bound:any=null;
    host.__rhTailBuried=(clear:()=>void,tiles:Uint8Array,terrain:Uint8Array,hasHook:boolean)=>{if(bound)throw Error('duplicate buried helper');bound={clear,tiles,terrain,hasHook};};
    host.__rhTail=(v:any)=>phases.push(plain(v));
    let opts:any=styled?{decor}:{decor,styleZones:null};
    if(syntheticProps)opts={decor,styleZones:(state:any)=>{
      actual.ZONE_STYLE_HOOK(state);
      for(const code of [0,1,2]){
        const i=state.tiles.findIndex((v:number)=>v===code);if(i<0)throw Error('missing source tile class');
        for(let kind=0;kind<34;kind++)state.props.push({kind,x:(i%160)*32+16,y:Math.floor(i/160)*32+16,v:kind});
      }
      for(const [x,y] of [[-1,100],[5120,100],[100,-1],[100,5120],[1e21,0],[-1e-7,0]])state.props.push({kind:0,x,y,v:0});
      state.props.push({kind:65535,x:1600,y:1600,v:0});
      for(const at of state.spawns)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)state.props.push({kind:0,x:((at%160)+dx)*32+16,y:(Math.floor(at/160)+dy)*32+16,v:0});
    }};
    const reference=actual.tryAttempt(seed,attempt,opts),final=observed.tryAttempt(seed,attempt,opts);
    delete host.__rhTail;
    delete host.__rhTailBuried;
    if(!isDeepStrictEqual(plain(reference),plain(final))||!reference||!final||actual.mapHash(reference)!==observed.mapHash(final))throw Error('observer changed final map/hash or required map absent');
    if(phases.map(v=>v.phase).join(',')!=='terrainBefore,terrainAfter,lootBefore,lootAfter,bushAvoid')throw Error('wrong phase inventory');
    const zone=phases[4].zone;
    cases.push({seed,attempt,styled,decor,syntheticProps,completeFinalOutputEquality:true,finalHash:actual.mapHash(reference),phases:phases.map(pack),shapeInput:pack({tiles:final.tiles,featureGrid:final.featureGrid,zone}),shape:observed.shapeGateFailure(final,Uint8Array.from(zone))});
    // Expose the original closed helper without calling it during generation. Only after complete output/hash equality
    // has been checked, invoke it on labelled source-owned arrays with explicit synthetic byte/class inputs.
    if(cases.length===1||cases.length===7){
      if(!bound||bound.hasHook!==styled)throw Error('missing source buried helper');
      for(let kind=0;kind<8;kind++)for(const code of [0,1,2]){
        bound.tiles.fill(0);bound.terrain.fill(0);const at=160*50+50;bound.tiles[at]=code;bound.terrain[at]=kind;
        const tilesBefore=bound.tiles.slice(),before=bound.terrain.slice();bound.clear();
        if(!isDeepStrictEqual(bound.tiles,tilesBefore))throw Error('buried helper mutated collision');
        buried.push({styled,kind,code,tiles:rle(plain(bound.tiles)),before:rle(plain(before)),after:rle(plain(bound.terrain))});
      }
    }
  }
  const ice:any[]=[];
  // A full byte-class/neighbor matrix, labelled synthetic and evaluated by the actual helper.
  for(const position of [0,159,160*159,25599,160*50+50])for(const code of [0,1,2])for(let neighbor=0;neighbor<8;neighbor++){
    const tiles=new Uint8Array(25600),terrain=new Uint8Array(25600);
    const dx=[0,1,1,1,0,-1,-1,-1],dy=[-1,-1,0,1,1,1,0,-1];
    terrain[position]=6;
    const x=position%160,y=Math.floor(position/160),nx=x+dx[neighbor],ny=y+dy[neighbor];
    if(nx>=0&&ny>=0&&nx<160&&ny<160)tiles[ny*160+nx]=code;
    const before=terrain.slice(),tilesBefore=tiles.slice();
    const cleared=observed.clearIceBesideSolid(tiles,terrain);
    if(!isDeepStrictEqual(tiles,tilesBefore))throw Error('ICE helper mutated collision');
    ice.push({position,code,neighbor,tiles:rle(plain(tiles)),before:rle(plain(before)),after:rle(plain(terrain)),cleared});
  }
  const shape:any[]=[];
  function shapeProbe(name:string,edit:(t:Uint8Array,z:Uint8Array,f:Uint8Array)=>void){
    const tiles=new Uint8Array(25600),zone=new Uint8Array(25600),featureGrid=new Uint8Array(25600);
    edit(tiles,zone,featureGrid);const before=plain({tiles,zone,featureGrid});
    const reason=observed.shapeGateFailure({tiles,featureGrid},zone);
    if(!isDeepStrictEqual(before,plain({tiles,zone,featureGrid})))throw Error('shape helper mutated input');
    shape.push({name,input:pack(before),reason});
  }
  shapeProbe('empty',()=>{});
  shapeProbe('unowned-low',(t,z)=>{t[161]=2;z[161]=1;});
  shapeProbe('unowned-before-earlier-small-piece',(t,z,f)=>{t[161]=1;z[161]=1;f[161]=1;t[20000]=2;z[20000]=2;});
  shapeProbe('owned-low-not-wall',(t,z,f)=>{t[161]=2;z[161]=1;f[161]=1;});
  for(const size of [1,5,6,7])shapeProbe(`diagonal-${size}`,(t,z,f)=>{for(let i=0;i<size;i++){const p=(i+3)*160+i+3;t[p]=1;z[p]=1;f[p]=1;}});
  shapeProbe('different-zones-do-not-join',(t,z,f)=>{for(let i=0;i<6;i++){const p=5000+i;t[p]=1;z[p]=i<3?1:2;f[p]=1;}});
  shapeProbe('zero-zone-ignored',(t)=>{t[0]=1;t[159]=2;});
  shapeProbe('two-pieces-later-small',(t,z,f)=>{for(let i=0;i<6;i++){t[5000+i]=1;z[5000+i]=1;f[5000+i]=1;}t[24000]=1;z[24000]=1;f[24000]=1;});
  shapeProbe('border-does-not-wrap',(t,z,f)=>{for(const p of [159,160,319,320,479,480]){t[p]=1;z[p]=1;f[p]=1;}});
  const result={format:'rh-map-tail/1',node:process.version,platform:process.platform,arch:process.arch,sources,cases,buried,ice,shape};
  const text=JSON.stringify(result)+'\n';const output=process.env.RH_TAIL_OUTPUT??fileURLToPath(new URL('../../crates/rh-sim/src/mapgen/fixtures/map-tail.json',import.meta.url));
  if(process.argv.includes('--check')){if(readFileSync(output,'utf8')!==text)throw Error('tail capture differs');}else writeFileSync(output,text);
  console.log(JSON.stringify({cases:cases.length,buried:buried.length,ice:ice.length,shape:shape.length,bytes:Buffer.byteLength(text)}));
} finally {delete host.__rhTail;delete host.__rhTailBuried;rmSync(temp,{recursive:true,force:true});}

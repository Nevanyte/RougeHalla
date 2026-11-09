// Real source Reflexes/Memory/Path over declared component inputs, never World outcomes.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {features} from '../bot-fight-fixtures/cases.mts';
import {maps,cases,percept} from './cases.mts';
const ROOT=process.env.RH_BOT_REFLEX_SOURCE_ROOT??'/repo';
const [mode,path]=process.argv.slice(2);
assert(process.argv.length===4&&['--write','--check'].includes(mode)&&path);
assert.equal(process.version,'v22.23.4');assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
Math.random=()=>{throw Error('undeclared randomness');};
const load=(p:string)=>import(pathToFileURL(ROOT+'/'+p).href);
const S=await load('packages/shared/src/index.ts');
const {createReflexes}=await load('packages/server/src/bots/brain/tactics/kite.ts');
const {createMemory}=await load('packages/server/src/bots/brain/memory.ts');
const {createPathBudget,createPathService}=await load('packages/server/src/bots/brain/services.ts');
const {TIERS}=await load('packages/server/src/bots/brain/types.ts');
const sha=(b:any)=>createHash('sha256').update(b).digest('hex');
const file=(p:string)=>readFileSync(ROOT+'/'+p);
const brain=file('packages/server/src/bots/brain/brain.ts').toString();
function extract(source:string,signature:string){const at=source.indexOf(signature);assert(at>=0);let depth=0;for(let i=source.indexOf('{',at);i<source.length;i++){if(source[i]==='{')depth++;else if(source[i]==='}'&&!--depth)return source.slice(at,i+1);}throw Error('unbalanced function');}
const deriveText=extract(brain,'function derive(seed: number, tag: number): number {');
const derive=new Function(deriveText.replace(/: number/g,'')+';return derive;')();
const wiring=brain.split('\n').filter((line:string)=>line.includes('mulberry32(derive(cfg.seed,')).map((s:string)=>s.trim());
const tagOf=(prefix:string)=>{const line=wiring.find((s:string)=>s.startsWith(prefix));assert(line);const m=line.match(/derive\(cfg.seed, (\d+)\)/);assert(m);return Number(m[1]);};
const tags={decide:tagOf('decide:'),motor:tagOf('motor:'),lapse:tagOf('lapse:')};
function plain(v:any):any{if(v===null||typeof v==='string'||typeof v==='boolean')return v;if(typeof v==='number'){assert(Number.isFinite(v));return v;}if(Array.isArray(v))return v.map(plain);assert(v&&typeof v==='object'&&!(v instanceof Map)&&!(v instanceof Set));return Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined).map(([k,x])=>[k,plain(x)]));}
function stream(seed:number,tag:number){const derived=derive(seed,tag),actual=S.mulberry32(derived),draws:number[]=[];return {rng:()=>{const x=actual();draws.push(x);return x;},draws,view(){const probe=S.mulberry32(derived);for(const v of draws)assert.equal(probe(),v);return {seed:derived,count:draws.length,draws:[...draws],nextFromIndependentReplay:probe()};}};}
const mapDefs=maps();
const captured=cases().map(c=>{
 const def=mapDefs[c.map],map=S.mapFromTiles(def.w,def.h,Uint8Array.from(def.tiles),1);
 const streams={decide:stream(c.seed,tags.decide),motor:stream(c.seed,tags.motor),lapse:stream(c.seed,tags.lapse)};
 const rng=Object.fromEntries(Object.entries(streams).map(([k,s])=>[k,s.rng]));
 const budget=createPathBudget(3),real=createPathService(map,budget),calls:any[]=[];
 const paths=new Proxy(real,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;return(...args:any[])=>{const result=Reflect.apply(value,target,args);if(key!=='setFrame')calls.push({method:key,args:plain(args),result:plain(result)});return result;};}});
 const mem=createMemory({tier:TIERS[c.tier],map,selfId:'p0',features}),reflex=createReflexes();
 let last=-Infinity,firstPositiveDodge:any=null;
 const rows=c.steps.map((row:any)=>{
  const dependency:any={};
  let now=row.time;
  if(typeof now==='object'){dependency.time={source:'actual prior Reflexes.holdUntil getter',getter:reflex.holdUntil,offset:now.offset};now=reflex.holdUntil+now.offset;}
  assert(now>last,'chronological method contexts');last=now;
  let recipe=structuredClone(row.recipe);
  if(recipe.publicLeadBoundary){
   assert(firstPositiveDodge,'real earlier dodge required');
   // Input selection from an actual public result, not private course extraction or an installed expected result.
   const delay=firstPositiveDodge.holdUntil-firstPositiveDodge.now-200+55+recipe.publicLeadBoundary.epsilon;
   dependency.lead={source:'first actual positive dodge public holdUntil, minus its now and source hold-tail 200, plus source apply-lag 55',...firstPositiveDodge,epsilon:recipe.publicLeadBoundary.epsilon,selectedDelay:delay};
   recipe.projectiles=recipe.projectiles.map((p:any)=>({...p,x:600-delay}));
  }
  const p=percept(now,recipe);
  assert(S.circleClear(map,p.self,S.PLAYER_RADIUS),'declared owner body fits actual map');
  for(const f of [...p.fighters,...p.mobs]){assert(S.circleClear(map,f,S.PLAYER_RADIUS),'declared visible body fits actual map');assert.equal(f.los,S.hasLineOfSight(map,p.self,f));}
  budget.startTick();real.setFrame(p.now,p.hud.gatesLocked);mem.observe(p);
  const before=calls.length,counts=Object.fromEntries(Object.entries(streams).map(([k,s])=>[k,s.draws.length]));
  // These are exactly the fields used by Reflexes. No callback or result is stubbed.
  const ctx={p,mem:mem.view,rng,cfg:{tier:TIERS[c.tier]},svc:{paths}};
  const result=row.recipe.observeOnly?undefined:reflex.check(ctx);
  if(result?.kind==='dodge'&&!firstPositiveDodge)firstPositiveDodge={now,holdUntil:result.holdUntil};
  return {input:{timeRecipe:plain(row.time),recipe:plain(recipe),dependency,percept:plain(p)},
   called:!row.recipe.observeOnly,...(row.recipe.observeOnly?{}:{result:plain(result)}),
   memory:{stimuli:plain(mem.view.stimuli),fighterFeints:[...mem.view.fighters].map(([id,f]:any)=>({id,feints:f.feints}))},
   state:{holdUntil:reflex.holdUntil,dodges:reflex.dodges,jukes:reflex.jukes},paths:calls.slice(before),
   drawDelta:Object.fromEntries(Object.entries(streams).map(([k,s])=>[k,s.draws.length-(counts[k] as number)])),
   rngAfter:Object.fromEntries(Object.entries(streams).map(([k,s])=>[k,s.view()]))};
 });
 return {name:c.name,recipe:plain({...c,steps:undefined}),rows};
});
const walk=(dir:string):string[]=>readdirSync(ROOT+'/'+dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+'/'+e.name):[dir+'/'+e.name]);
const inventory=(paths:string[])=>Object.fromEntries(paths.sort().map(p=>[p,sha(file(p))]));
const sourceSha256=inventory([...walk('packages/shared/src'),...walk('packages/server/src/bots')].filter(p=>p.endsWith('.ts')));
const configSha256=inventory(['package.json','package-lock.json','tsconfig.base.json','packages/shared/package.json','packages/server/package.json','packages/client/package.json','packages/shared/tsconfig.json','packages/server/tsconfig.json']);
const toolSha256=inventory([...walk('tools/bot-reflex-fixtures'),'tools/bot-fight-fixtures/cases.mts'].filter(p=>/\.(mts|mjs|sh|json|md)$/.test(p)));
const result={format:'rh-bot-reflex-source/1',profile:{base:'a0c4818ce9df8ad0f4124db31e65ba1244bddc3b',node:process.version,platform:process.platform,arch:process.arch,
 image:'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',
 boundary:'Declared chronological visible method contexts; actual Reflexes/Memory/PathService and actual RNG. No earned World dodge/launch, FrameRing, delivery continuity, complete brain or native/live claim.',
 adaptiveRecipes:'Times and lead-threshold inputs may depend on prior actual public holdUntil/result getters, recorded in each dependency. No component state is overwritten.',
 rng:'Actual source derive tags0/1/2 and mulberry32, forwarding unchanged. Next values from fresh independent replay; no extra actual draw. No Tactics/Knowledge draw in this direct component.',
 deriveSourceSha256:sha(deriveText),wiring,tags,sourceSha256,configSha256,toolSha256},maps:mapDefs,cases:captured};
const {verify}=await import('./verify.mjs');verify(result);
const bytes=JSON.stringify(result,null,1)+'\n';
if(mode==='--write')writeFileSync(path,bytes);else assert.equal(readFileSync(path,'utf8'),bytes,'byte-exact actual source witness');
console.log(JSON.stringify({mode,cases:captured.length,frames:captured.reduce((n,c)=>n+c.rows.length,0),bytes:Buffer.byteLength(bytes),sha256:sha(bytes)}));

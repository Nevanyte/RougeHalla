import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {maps,cases} from './cases.mts';
import {features} from '../bot-fight-fixtures/cases.mts';
const ROOT=process.env.RH_BOT_SD_SOURCE_ROOT??'/repo';
const [mode,path]=process.argv.slice(2);assert(process.argv.length===4&&['--write','--check'].includes(mode)&&path);
assert.equal(process.version,'v22.23.4');assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
Math.random=()=>{throw Error('undeclared randomness');};
const load=(p:string)=>import(pathToFileURL(ROOT+'/'+p).href);
const S=await load('packages/shared/src/index.ts');
const {createTactics}=await load('packages/server/src/bots/brain/tactics.ts');
const {createMemory}=await load('packages/server/src/bots/brain/memory.ts');
const {createKnowledge}=await load('packages/server/src/bots/brain/knowledge.ts');
const {createReflexes}=await load('packages/server/src/bots/brain/tactics/kite.ts');
const {createPathBudget,createPathService}=await load('packages/server/src/bots/brain/services.ts');
const {TIERS,PERSONAS}=await load('packages/server/src/bots/brain/types.ts');
const sha=(b:any)=>createHash('sha256').update(b).digest('hex');
const file=(p:string)=>readFileSync(ROOT+'/'+p);
const brain=file('packages/server/src/bots/brain/brain.ts').toString();
function extract(source:string,signature:string){const at=source.indexOf(signature);assert(at>=0);let depth=0;for(let i=source.indexOf('{',at);i<source.length;i++){if(source[i]==='{')depth++;else if(source[i]==='}'&&!--depth)return source.slice(at,i+1);}throw Error('unbalanced actual source function');}
const deriveText=extract(brain,'function derive(seed: number, tag: number): number {');
const derive=new Function(deriveText.replace(/: number/g,'')+';return derive;')();
const wiring=brain.split('\n').filter((s:string)=>s.includes('mulberry32(derive(cfg.seed,')).map((s:string)=>s.trim());
const tag=(prefix:string)=>{const line=wiring.find((s:string)=>s.startsWith(prefix));assert(line);const m=line.match(/derive\(cfg.seed, (\d+)\)/);assert(m);return Number(m[1]);};
const tags={decide:tag('decide:'),motor:tag('motor:'),lapse:tag('lapse:'),knowledge:tag('const knowledgeRng:')};
function plain(v:any):any {if(v===null||typeof v==='boolean'||typeof v==='string')return v;if(typeof v==='number'){assert(Number.isFinite(v));return v;}if(Array.isArray(v))return v.map(plain);assert(v&&typeof v==='object'&&!(v instanceof Map)&&!(v instanceof Set));return Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined).map(([k,x])=>[k,plain(x)]));}
function stream(seed:number,t:number){const initial=derive(seed,t),actual=S.mulberry32(initial),draws:number[]=[];return {rng:()=>{const v=actual();draws.push(v);return v;},draws,view:()=>{const replay=S.mulberry32(initial);for(const d of draws)assert.equal(replay(),d);return {seed:initial,count:draws.length,draws:[...draws],nextFromIndependentReplay:replay()};}};}
const mapDefs=maps();
const results=cases().map(c=>{
 const def=mapDefs[c.map],map=S.mapFromTiles(def.w,def.h,Uint8Array.from(def.tiles),1);
 const streams=Object.fromEntries(Object.entries(tags).map(([k,t])=>[k,stream(c.seed,t)]));
 const rng={decide:streams.decide.rng,motor:streams.motor.rng,lapse:streams.lapse.rng};
 const budget=createPathBudget(3),real=createPathService(map,budget),calls:any[]=[];
 const paths=new Proxy(real,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;return(...args:any[])=>{const value=Reflect.apply(Reflect.get(target,key),target,args);if(key!=='setFrame')calls.push({method:key,args:args.map((p:any)=>({x:p.x,y:p.y})),result:key==='collisionMap'?{declaredMap:c.map}:plain(value)});return value;};}});
 const mem=createMemory({tier:TIERS[c.tier],map,selfId:'p0',features});const know=createKnowledge(TIERS[c.tier],streams.knowledge.rng);
 const tactics=createTactics(),reflex=createReflexes(),reflexRng=stream(c.seed,tags.decide),rows:any[]=[];let last=-Infinity;
 for(const input of c.rows){const p=input.percept;assert(p.now>last);last=p.now;
  assert(S.circleClear(map,p.self,S.PLAYER_RADIUS));for(const f of p.fighters){assert(S.circleClear(map,f,S.PLAYER_RADIUS));assert.equal(f.los,S.hasLineOfSight(map,p.self,f));assert.equal(f.dist,Math.hypot(f.x-p.self.x,f.y-p.self.y));}
  budget.startTick();real.setFrame(p.now,p.hud.gatesLocked);const observed=mem.observe(p);
  const ctx={p,mem:mem.view,rng,cfg:{tier:TIERS[c.tier],persona:PERSONAS[c.persona],seed:c.seed,map,features},know,engaged:p.self.attackTarget!==null,svc:{paths,log(){}}};
  const noReflex=reflex.check({...ctx,rng:{decide:reflexRng.rng,motor:()=>{throw Error('reflex motor');},lapse:()=>{throw Error('reflex lapse');}}});
  assert.equal(noReflex,null);assert.equal(reflex.holdUntil,0);assert.equal(reflexRng.draws.length,0);
  const start=calls.length,before=Object.fromEntries(Object.entries(streams).map(([k,s])=>[k,s.draws.length]));
  const result=tactics.act(ctx,input.goal);
  rows.push({input:plain(input),normalReflex:{result:plain(noReflex),holdUntil:reflex.holdUntil,draws:reflexRng.draws.length},result:plain(result),stats:plain(tactics.stats()),
   sourceMemory:{stillSince:mem.view.self.stillSince,stimuli:plain(observed)},paths:calls.slice(start),pathStats:plain(real.stats),budgetLeft:budget.left,
   rngAfter:Object.fromEntries(Object.entries(streams).map(([k,s])=>[k,s.view()])),drawDelta:Object.fromEntries(Object.entries(streams).map(([k,s])=>[k,s.draws.length-(before[k] as number)]))});
 }
 return {name:c.name,recipe:plain({...c,rows:undefined}),rows};
});
const walk=(dir:string):string[]=>readdirSync(ROOT+'/'+dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+'/'+e.name):[dir+'/'+e.name]);
const inventory=(paths:string[])=>Object.fromEntries(paths.sort().map(p=>[p,sha(file(p))]));
const result={format:'rh-bot-sd-source/1',profile:{base:'0489fa9f2e2168857588d0e3bd9548fbcdfe5f52',node:process.version,platform:process.platform,arch:process.arch,
 image:'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',
 boundary:'Declared chronological public method contexts; real Tactics/Fight/Retreat/Memory/Path/Knowledge/Reflex methods. Not World-earned outcomes, full brain, live/public compatibility or physics reachability proof.',
 deriveSourceSha256:sha(deriveText),wiring,tags,sourceSha256:inventory([...walk('packages/shared/src'),...walk('packages/server/src/bots')].filter(p=>p.endsWith('.ts'))),
 configSha256:inventory(['package.json','package-lock.json','tsconfig.base.json','packages/shared/package.json','packages/server/package.json','packages/client/package.json','packages/shared/tsconfig.json','packages/server/tsconfig.json']),
 toolSha256:inventory([...walk('tools/bot-sd-fixtures').filter(p=>/\.(mts|mjs|sh|md)$/.test(p)),'tools/bot-fight-fixtures/cases.mts'])},maps:mapDefs,cases:results};
const {verify}=await import('./verify.mjs');verify(result);
const bytes=JSON.stringify(result,null,1)+'\n';if(mode==='--write')writeFileSync(path,bytes);else assert.equal(readFileSync(path,'utf8'),bytes,'exact SD source witness');
console.log(JSON.stringify({mode,sequences:results.length,frames:results.reduce((n,c)=>n+c.rows.length,0),bytes:Buffer.byteLength(bytes),sha256:sha(bytes)}));

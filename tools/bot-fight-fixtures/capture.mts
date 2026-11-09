// Actual source methods over declared public component views. No World, native expected state or private tactic writes.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {features,frame,fighter,maps,fightCases,orbCases} from './cases.mts';
const ROOT=process.env.RH_BOT_FIGHT_SOURCE_ROOT??'/repo';
const [mode,path]=process.argv.slice(2);
assert(process.argv.length===4&&['--write','--check'].includes(mode)&&path);
assert.equal(process.version,'v22.23.4');assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
Math.random=()=>{throw Error('undeclared randomness');};
const load=(p:string)=>import(pathToFileURL(ROOT+'/'+p).href);
const S=await load('packages/shared/src/index.ts');
const {createTactics}=await load('packages/server/src/bots/brain/tactics.ts');
const {createFight}=await load('packages/server/src/bots/brain/tactics/fight.ts');
const {createOrbWalk,createReflexes,createRetreat,ownTimings}=await load('packages/server/src/bots/brain/tactics/kite.ts');
const {createMemory}=await load('packages/server/src/bots/brain/memory.ts');
const {createKnowledge}=await load('packages/server/src/bots/brain/knowledge.ts');
const {createPathBudget,createPathService}=await load('packages/server/src/bots/brain/services.ts');
const {TIERS,PERSONAS}=await load('packages/server/src/bots/brain/types.ts');
const sha=(b:any)=>createHash('sha256').update(b).digest('hex');
const file=(p:string)=>readFileSync(ROOT+'/'+p);
const brain=file('packages/server/src/bots/brain/brain.ts').toString();
function extract(source:string,signature:string) {
 const at=source.indexOf(signature);assert(at>=0);let depth=0;
 for(let i=source.indexOf('{',at);i<source.length;i++){if(source[i]==='{')depth++;else if(source[i]==='}'&&!--depth)return source.slice(at,i+1);}
 throw Error('unbalanced actual source function');
}
const deriveText=extract(brain,'function derive(seed: number, tag: number): number {');
const derive=new Function(deriveText.replace(/: number/g,'')+';return derive;')();
const wiring=brain.split('\n').filter((line:string)=>line.includes('mulberry32(derive(cfg.seed,')).map((s:string)=>s.trim());
const tagOf=(prefix:string)=>{const line=wiring.find((s:string)=>s.startsWith(prefix));assert(line,'actual stream wiring');const match=line.match(/derive\(cfg.seed, (\d+)\)/);assert(match);return Number(match[1]);};
const tags={decide:tagOf('decide:'),motor:tagOf('motor:'),lapse:tagOf('lapse:'),knowledge:tagOf('const knowledgeRng:')};
function plain(v:any):any {
 if(v===null||typeof v==='string'||typeof v==='boolean')return v;
 if(typeof v==='number'){assert(Number.isFinite(v),'nonfinite result');return v;}
 if(Array.isArray(v))return v.map(plain);
 assert(v&&typeof v==='object'&&!(v instanceof Map)&&!(v instanceof Set),'unsupported result');
 return Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined).map(([k,x])=>[k,plain(x)]));
}
function stream(seed:number,tag:number) {
 const derived=derive(seed,tag),actual=S.mulberry32(derived),draws:number[]=[];
 return {rng:()=>{const v=actual();draws.push(v);return v;},draws,
  view:()=>{const probe=S.mulberry32(derived);for(let i=0;i<draws.length;i++)assert.equal(probe(),draws[i]);return {seed:derived,count:draws.length,draws:[...draws],nextFromIndependentReplay:probe()};}};
}
const mapDefs=maps();
function context(c:any) {
 const def=mapDefs[c.map],map=S.mapFromTiles(def.w,def.h,Uint8Array.from(def.tiles),1);
 const streams={decide:stream(c.seed,tags.decide),motor:stream(c.seed,tags.motor),lapse:stream(c.seed,tags.lapse),knowledge:stream(c.seed,tags.knowledge)};
 const rng={decide:streams.decide.rng,motor:streams.motor.rng,lapse:streams.lapse.rng};
 const budget=createPathBudget(3),real=createPathService(map,budget),calls:any[]=[];
 const paths=new Proxy(real,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;
  return (...args:any[])=>{const result=Reflect.apply(value,target,args);if(key!=='setFrame')calls.push({method:key,args:plain(args),result:key==='collisionMap'?{declaredMap:c.map}:plain(result)});return result;};}});
 const mem=createMemory({tier:TIERS[c.tier],map,selfId:'p0',features});
 const know=createKnowledge(TIERS[c.tier],streams.knowledge.rng);
 // Independent real reflex instance verifies there is no opportunity. Its zero draws are NOT part of the actual stream.
 const noReflex=createReflexes(),reflexStream=stream(c.seed,tags.decide);
 return {streams,calls,real,budget,paths,mem,know,rng,map,
  row(p:any){budget.startTick();real.setFrame(p.now,p.hud.gatesLocked);mem.observe(p);
   const ctx={p,mem:mem.view,rng,cfg:{tier:TIERS[c.tier],persona:PERSONAS[c.persona],seed:c.seed,map,features},know,engaged:p.self.attackTarget!==null,svc:{paths,log(){}}};
   const reflex=noReflex.check({...ctx,rng:{decide:reflexStream.rng,motor:()=>{throw Error('reflex motor draw');},lapse:()=>{throw Error('reflex lapse draw');}}});
   assert.equal(reflex,null,'declared normal context actually triggered a reflex');assert.equal(noReflex.holdUntil,0);assert.equal(reflexStream.draws.length,0);
   return {...ctx,sourceNormalReflex:{result:plain(reflex),holdUntil:noReflex.holdUntil,decideDraws:reflexStream.draws.length}};},rngView(){return Object.fromEntries(Object.entries(streams).map(([k,s])=>[k,s.view()]));}};
}
function execute(c:any) {
 const env=context(c),tactics=createTactics(),results:any[]=[];
 let last=-Infinity;
 for(const row of c.rows){const p=row.percept;assert(p.now>last,'chronological frames');last=p.now;const ctx=env.row(p),before=env.calls.length;
  const begin=Object.fromEntries(Object.entries(env.streams).map(([k,s])=>[k,s.draws.length]));
  const result=tactics.act(ctx,row.goal);
  results.push({input:plain(row),normalReflex:ctx.sourceNormalReflex,result:plain(result),stats:plain(tactics.stats()),paths:env.calls.slice(before),pathStats:plain(env.real.stats),budgetLeft:env.budget.left,
   rngAfter:env.rngView(),drawDelta:Object.fromEntries(Object.entries(env.streams).map(([k,s])=>[k,s.draws.length-(begin[k] as number)]))});
  assert.equal(tactics.stats().dodges,0);assert.equal(tactics.stats().jukes,0);
 }
 return {name:c.name,recipe:plain({...c,rows:undefined}),rows:results};
}
const cases=fightCases(ownTimings).map(execute);
const orbs=orbCases(ownTimings).map(c=>{
 const env=context(c),orb=createOrbWalk(),rows:any[]=[];orb.reset(c.reset);let last=-Infinity;
 for(const row of c.rows){assert(row.percept.now>last,'chronological orb probe');last=row.percept.now;const ctx=env.row(row.percept);
  const start=env.streams.decide.draws.length,result=orb.step(ctx,row.foe,row.weapon,row.locked);
  rows.push({input:plain(row),normalReflex:ctx.sourceNormalReflex,result:plain(result),cycles:orb.cycles,rngAfter:env.rngView(),decideDrawDelta:env.streams.decide.draws.length-start});}
 return {name:c.name,recipe:plain({...c,rows:undefined}),rows};
});
const timingRows:any[]=[];
for(const faction of S.FACTION_IDS)for(const weapon of [...S.WEAPON_IDS,S.FISTS])for(const [asMult,windupMult] of [[.5,1],[1,.5],[2,1.5]]){
 const self=frame(0,{self:{faction,asMult,windupMult}}).self;timingRows.push({input:{faction,weapon,asMult,windupMult},result:plain(ownTimings(self,weapon))});}
const unavailableTiming=[...S.WEAPON_IDS,S.FISTS].map((weapon:string)=>({weapon,result:ownTimings(frame(0,{self:{faction:null}}).self,weapon)}));
// Invalid caller shape is an actual source error probe, not an available-empty inventory or a native refusal proof.
const invalidEnv=context({map:'open',seed:7,tier:'normal',persona:'cautious'}),invalid=frame(100,{fighters:[fighter()]});
delete (invalid.self as any).weapons;let missingInventory:any;
try{createTactics().act(invalidEnv.row(invalid),{kind:'fight',target:'p1'});throw Error('missing inventory unexpectedly accepted');}
catch(error){assert(error instanceof TypeError);missingInventory={role:'invalid method caller, not a supported Percept or World outcome',error:{name:error.name,message:error.message}};}
// Direct exported createFight consumer has real Orb/Reflex/Retreat dependencies, not stubbed method results.
const directEnv=context({map:'open',seed:7,tier:'normal',persona:'cautious'}),direct=createFight({orb:createOrbWalk(),reflexes:createReflexes(),retreat:createRetreat()});
const directInput=frame(100,{self:{weapons:['wand',null],attackTarget:'p1'},fighters:[fighter()]});
const directFight={input:plain(directInput),ref:{id:'p1',kind:'fight'},knowsSuddenDeath:false,result:plain(direct.act(directEnv.row(directInput),{id:'p1',kind:'fight'},false)),rngAfter:directEnv.rngView()};
const walk=(dir:string):string[]=>readdirSync(ROOT+'/'+dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+'/'+e.name):[dir+'/'+e.name]);
const inventory=(paths:string[])=>Object.fromEntries(paths.sort().map(p=>[p,sha(file(p))]));
const sourceSha256=inventory([...walk('packages/shared/src'),...walk('packages/server/src/bots')].filter(p=>p.endsWith('.ts')));
const configSha256=inventory(['package.json','package-lock.json','tsconfig.base.json','packages/shared/package.json','packages/server/package.json','packages/client/package.json','packages/shared/tsconfig.json','packages/server/tsconfig.json']);
const toolSha256=inventory(walk('tools/bot-fight-fixtures').filter(p=>/\.(mts|mjs|sh|json|md)$/.test(p)));
const result={format:'rh-bot-fight-source/1',profile:{base:'e2baadae03dd25cf74979bdfeb3bf35fd696393d',node:process.version,platform:process.platform,arch:process.arch,
 image:'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',
 boundary:'Declared chronological public method contexts, actual Tactics/Fight/Orb/Timings/Memory/Knowledge/PathService. NOT earned World outcomes, full brain, reflex or native/live activation.',
 rng:'Actual source mulberry32(derive(seed,tag0/1/2)); actual Knowledge tag3. Forwarded draws unchanged; next values use fresh independent source replay, never extra actual draws.',
 deriveSourceSha256:sha(deriveText),wiring,tags,sourceSha256,configSha256,toolSha256},maps:mapDefs,timings:timingRows,unavailableTiming,missingInventory,directFight,cases,orbs};
const {verify}=await import('./verify.mjs');verify(result);
const bytes=JSON.stringify(result,null,1)+'\n';
if(mode==='--write')writeFileSync(path,bytes);else assert.equal(readFileSync(path,'utf8'),bytes,'byte-exact source witness');
console.log(JSON.stringify({mode,cases:cases.length,frames:cases.reduce((n,c)=>n+c.rows.length,0),orbs:orbs.length,orbFrames:orbs.reduce((n,c)=>n+c.rows.length,0),timings:timingRows.length,bytes:Buffer.byteLength(bytes),sha256:sha(bytes)}));

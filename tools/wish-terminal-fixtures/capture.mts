/** P-WISH-TERMINAL-PRODUCERS canonical actual-source witness.
 *
 * Runs the unchanged legacy TS through tools/ability-fixtures/engine.mts with real enqueueClientMessage calls and
 * ordinary 50 ms steps. Declared setup: room map/positions/factions, zero opening lock, and the action list. Actual:
 * every emitted event, castAccepted/castEnded argument, stock clock and pending cast. No production source is changed;
 * no expected event/status is installed. The projection keeps the full bounded relevant timeline plus producer hooks.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync, writeFileSync} from 'node:fs';
const engine:any = await import('/repo/tools/ability-fixtures/engine.mts');
assert.equal(process.version,'v22.23.4');assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
const sha=(v:any)=>createHash('sha256').update(v).digest('hex');
const IMAGE='node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292';
const P=(faction:string,x=300,y=320,extra:any={})=>({faction,at:{x,y},...extra});
const C=(actor:string,x:number,y:number,id?:string)=>({actor,type:'cast',payload:{slot:'wish',point:{x,y},...(id?{id}:{})}});
const step=(...inputs:any[])=>({kind:'step',inputs});
const steps=(n:number)=>Array.from({length:n},()=>step());
const cases:any[]=[
 {name:'fizzle-freeze-target-removed',players:[P('frost',300,320),P('holy',450,320),P('holy',1000,500)],actions:[step(C('p0',450,320,'p1')),{kind:'remove',actor:'p1'},...steps(7)]},
 {name:'fizzle-trial-target-removed',players:[P('sentenced',300,320),P('holy',450,320),P('holy',1000,500)],actions:[step(C('p0',450,320,'p1')),{kind:'remove',actor:'p1'},...steps(9)]},
 {name:'interrupted-freeze-by-freeze',players:[P('frost',300,320),P('frost',450,320),P('holy',1000,500)],actions:[step(C('p0',450,320,'p1')),step(C('p1',300,320,'p0')),...steps(9)]},
 {name:'interrupted-swarm-by-freeze',players:[P('frost',300,320),P('plague',450,320),P('holy',1000,500)],actions:[step(C('p0',450,320,'p1')),step(C('p1',450,320)),...steps(9)]},
 {name:'interrupted-trial-by-freeze',players:[P('frost',300,320),P('sentenced',450,320),P('holy',1000,500)],actions:[step(C('p0',450,320,'p1')),step(C('p1',300,320,'p0')),...steps(9)]},
];
const castEvents=(raw:any[],time:number)=>raw.filter((e:any)=>e.type==='fx'&&['cast','castLand','castEnd','status'].includes(e.fx.kind)).map((e:any)=>{const f=e.fx;if(f.kind==='status')return{kind:'status',time,id:f.id,status:f.status,ms:f.ms,by:f.by};return{kind:f.kind,time,by:f.by,ability:f.ability,...(f.kind==='castEnd'?{reason:f.reason}:{target:f.target,x:f.x,y:f.y}),...(f.kind==='cast'?{ms:f.ms}:{})};});
const castHooks=(hooks:any[])=>hooks.filter((h:any)=>h.kind==='arguments'&&(h.hook==='castAccepted'||h.hook==='castEnded')).map((h:any)=>({hook:h.hook,time:h.time,actor:h.actor,ability:h.ability,reason:h.reason?.$undefined?null:h.reason,wishReadyAt:h.wishReadyAt,wishFullAt:h.wishFullAt??null,cast:h.cast?{ability:h.cast.ability,startedAt:h.cast.startedAt,landsAt:h.cast.landsAt,target:h.cast.target??null}:null}));
const declaredActions=(actions:any[])=>actions.map((a:any)=>a.kind==='step'?{kind:'step',inputs:a.inputs.map((i:any)=>({actor:i.actor,type:i.type,payload:{slot:'wish',point:{x:i.payload.point.x,y:i.payload.point.y},id:i.payload.id??null}}))}:{kind:a.kind,actor:a.actor});
const projectFrame=(frame:any)=>({
 action:frame.action,time:frame.time,tick:frame.tick,
 events:castEvents(frame.events??[],frame.time),
 hooks:castHooks(frame.hookTrace??[]),
 players:frame.public.players.map(({id,state}:any)=>{const priv=frame.private.players.find((p:any)=>p.id===id);return{id,wishReadyAt:state.wishReadyAt,wishFullAt:state.extra?.wishFullAt??null,status:state.status,cast:priv?.cast?{ability:priv.cast.ability,startedAt:priv.cast.startedAt,landsAt:priv.cast.landsAt,target:priv.cast.target??null}:null};}),
});
const runs=cases.map((c:any)=>{const run=engine.run({map:'room',profile:'core',mainSeed:12,rewardSalt:[1,2,3,4],...c});return{name:c.name,initial:{time:run.initial.time,tick:run.initial.tick},players:c.players,actions:declaredActions(c.actions),timeline:run.timeline.map(projectFrame),ordinarySteps:run.ordinarySteps};});
const walk=(dir:string):string[]=>readdirSync(dir,{recursive:true} as any).filter((p:any)=>typeof p==='string'&&(p.endsWith('.ts')||p.endsWith('.mts'))).map((p:any)=>dir+'/'+p).sort();
const sourceFiles=[...walk('packages/shared/src'),...walk('packages/server/src/sim'),'package.json','package-lock.json','tsconfig.base.json'].sort();
const sourceInventory=sourceFiles.map((path)=>({path,sha256:sha(readFileSync(path))}));
const harnessFiles=[...walk('tools/wish-terminal-fixtures'),'tools/ability-fixtures/engine.mts','tools/ability-fixtures/seed1-input.json','tools/ability-fixtures/born-input.json'].sort();
const harnessInventory=harnessFiles.map((path)=>({path,sha256:sha(readFileSync(path))}));
const corpus={
 format:'rh-wish-terminal/1',
 profile:{
  runtime:'Node.js22.23.4 linuxamd64',image:IMAGE,node:process.version,platform:process.platform,arch:process.arch,
  fixedStepMs:50,packageLockSha256:sha(readFileSync('package-lock.json')),
  sourceSha256:sha(JSON.stringify(sourceInventory)),sourceInventory,
  harnessSha256:sha(JSON.stringify(harnessInventory)),harnessInventory,
  config:{profile:'core',map:'room',width:40,height:24,mainSeed:12,rewardSalt:[1,2,3,4],wishLockSeconds:0},
  roles:{declared:'room map/positions/factions/loadout/action list and zero opening lock',actual:'unchanged source enqueueClientMessage/ordinary 50 ms step outputs, events, cast hooks, stock clocks',private:'source hooks are server-only producer evidence; the public event/stock projection is the bounded oracle'},
 },
 cases:runs,
};
const bytes=JSON.stringify(corpus)+'\n';
if(process.env.MODE==='--check'){assert.equal(readFileSync('/out/source.json','utf8'),bytes,'canonical source recapture bytes');console.log(JSON.stringify({cases:corpus.cases.length,sha256:sha(bytes),bytes:Buffer.byteLength(bytes)}));}
else{writeFileSync('/out/source.json',bytes);console.log(JSON.stringify({cases:corpus.cases.length,sha256:sha(bytes),bytes:Buffer.byteLength(bytes)}));}

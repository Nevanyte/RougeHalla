import assert from 'node:assert/strict';
import {encode,memorySnapshot} from './codec.mts';
import {shared,types,memory,knowledge,services,tactics,fight,kite,world} from './runtime.mts';
import {MAPS,features} from './builders.mts';
export function runCase(spec:any):any {
 let callbacks:any[]=[],env:any={},p:any=null;
 const record=(name:string,args:any[],fn:()=>any)=>{const e:any={sequence:callbacks.length,kind:'callback',name,args:structuredClone(args)};callbacks.push(e);const v=fn();e.result=structuredClone(v);return v;};
 const c=spec.config??{},map=MAPS[c.map??'open']; assert(map);
 const tier={...types.TIERS[c.tier??'hard'],...c.tierOverrides,orbwalk:{...types.TIERS[c.tier??'hard'].orbwalk,...c.tierOverrides?.orbwalk}};
 tier.step={...types.TIERS[c.tier??'hard'].step,...c.tierOverrides?.step};tier.reaction={...types.TIERS[c.tier??'hard'].reaction,...c.tierOverrides?.reaction};
 const persona={...types.PERSONAS[c.persona??'cautious'],...c.personaOverrides};
 const counts:any={},rng:any={};
 for(const[i,name]of ['decide','motor','lapse','knowledge'].entries()){const r=shared.mulberry32((c.seed??1)+i);counts[name]=0;rng[name]=()=>{const index=counts[name]++,value=r();callbacks.push({sequence:callbacks.length,kind:'rng',stream:name,index,value});return value;};}
 const budget=services.createPathBudget(c.pathBudget??20),realPaths=services.createPathService(map,budget);
 const svc:any={paths:{},log:(s:string)=>record('services.log',[s],()=>undefined)};
 // Deterministic argument-sensitive denial geometry permits null/empty failures without answer tapes.
 const blocked=(a:any,b:any)=>{const d=env.path??c.path;if(!d)return false;const len=Math.hypot(b.x-a.x,b.y-a.y);return d.kind==='radius-denial'&&len>d.radius||d.kind==='half-plane'&&b.x>=d.x;};
 for(const name of ['walk','path','los','clear','collisionMap'])svc.paths[name]=(...args:any[])=>record('paths.'+name,args,()=>{
  if(name!=='collisionMap'&&blocked(args[0],args[1]))return name==='los'||name==='clear'?false:env.emptyPath&&name==='path'?[]:null;
  return realPaths[name](...args);
 });
 const sourceKnow=knowledge.createKnowledge(tier,rng.knowledge),know:any={};
 for(const name of ['factionEdge','weaponEdge','mobShare','odds'])know[name]=(...args:any[])=>record('knowledge.'+name,args,()=>sourceKnow[name](...args));
 const cfg={id:'me',name:'Declared source bot',tier,persona,seed:c.seed??1,map,features:features(),services:svc,modules:[],learned:{enabled:false,bias:()=>0}};
 const mem=memory.createMemory({tier,map,selfId:'me',features:cfg.features});
 const memView=new Proxy(mem.view,{get(t,k,r){if(k==='whereabouts')return(id:string,now:number)=>record('memory.whereabouts',[id,now],()=>t.whereabouts(id,now));return Reflect.get(t,k,r);}});
 const orb=kite.createOrbWalk(),reflex=kite.createReflexes(),retreat=kite.createRetreat();
 let object:any=spec.suite==='orb'?orb:spec.suite==='retreat'?retreat:spec.suite==='reflex'?reflex:spec.suite==='fight'?fight.createFight({orb,reflexes:reflex,retreat}):spec.suite==='world'?world.createWorldTactics():tactics.createTactics();
 const stats=()=>spec.suite==='tactics'?{stats:object.stats(),getStats:object.getStats()}:spec.suite==='orb'?{cycles:orb.cycles}:spec.suite==='reflex'?{holdUntil:reflex.holdUntil,dodges:reflex.dodges,jukes:reflex.jukes}:spec.suite==='fight'?{mobTargets:object.mobTargets,cycles:orb.cycles,holdUntil:reflex.holdUntil,dodges:reflex.dodges,jukes:reflex.jukes}:{};
 const initial={memory:memorySnapshot(mem),stats:encode(stats())},setupTranscript=encode(callbacks),rows:any[]=[];
 for(const op of spec.operations){callbacks=[];env=op.env??{};const declaration=encode(op);let result:any,thrown:any;
  try {
  if(op.method==='observe'){p=op.input;budget.startTick();record('paths.setFrame',[p.now,p.hud.gatesLocked],()=>realPaths.setFrame(p.now,p.hud.gatesLocked));result=mem.observe(p);}
  else if(op.method==='noteSent')result=mem.noteSent(op.input);
  else if(op.method==='recordChoice')result=mem.recordChoice(op.input);
  else {assert(p,'observe must precede context method');const ctx={cfg,p,mem:memView,know,svc,rng,engaged:op.engaged??false};
   if(op.method==='act')result=object.act(ctx,op.goal,...(spec.suite==='fight'?[op.knowsSuddenDeath??false]:[]));
   else if(op.method==='step')result=orb.step(ctx,op.foe,op.weapon,op.locked);
   else if(op.method==='reset')result=spec.suite==='orb'?orb.reset(op.readyAt):retreat.reset();
   else if(op.method==='point')result=retreat.point(ctx,op.threats);
   else if(op.method==='check')result=reflex.check(ctx);
   else if(op.method==='leave')result=object.leave();
   else if(op.method==='pickHoldSpot')result=world.pickHoldSpot(ctx,op.centre,op.radius);
   else if(op.method==='inReach')result=fight.inReach(ctx,op.foe,op.weapon);
   else throw Error('unsupported operation '+op.method);
  }
  } catch(error:any) { if(!(op.env?.emptyPath&&spec.id==='loot-path-empty'))throw error; thrown={name:error.name,message:error.message}; }
  assert.deepEqual(encode(op),declaration,'source input immutable');
  rows.push({method:op.method,declaration,result:encode(result),memory:memorySnapshot(mem),stats:encode(stats()),callbacks:encode(callbacks),drawCounts:{...counts},pathStats:encode(realPaths.stats),...(thrown?{thrown}: {})});
 }
 return{id:spec.id,suite:spec.suite,covers:spec.covers,config:encode({tier:c.tier??'hard',persona:c.persona??'cautious',seed:c.seed??1,id:'me',name:'Declared source bot',features:cfg.features,pathBudget:c.pathBudget??20,modules:[],learned:{enabled:false,biasDescriptor:'zero'},...c,tierValues:tier,personaValues:persona,map:c.map??'open',seeds:{decide:c.seed??1,motor:(c.seed??1)+1,lapse:(c.seed??1)+2,knowledge:(c.seed??1)+3}}),initial,setupTranscript,operations:rows};
}

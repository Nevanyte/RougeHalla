import assert from'node:assert/strict';
import{shared,types,memory,knowledge,services,hunt,modules,registry,hazards,resetRegistry}from'./runtime.mts';
import{MAPS,features}from'./builders.mts';import{encode,memorySnapshot}from'./codec.mts';
export function runCase(spec:any){resetRegistry();let callbacks:any[]=[],env:any={};
 const rec=(cfg:string,name:string,args:any[],fn:()=>any)=>{const e:any={sequence:callbacks.length,kind:'callback',cfg,name,args:structuredClone(args)};callbacks.push(e);const value=fn();e.result=structuredClone(value);return value;};
 const bundles:any={};for(const[key,c]of Object.entries<any>(spec.contexts??{a:{}})){
  const map=MAPS[c.map??'open'];assert(map);const tier={...types.TIERS[c.tier??'hard'],...c.tierOverrides},persona={...types.PERSONAS[c.persona??'cautious'],...c.personaOverrides};
  for(const f of ['step','reaction','orbwalk','route','attention'])tier[f]={...types.TIERS[c.tier??'hard'][f],...c.tierOverrides?.[f]};
  const counts:any={},rng:any={};for(const[i,lane]of['decide','motor','lapse','knowledge'].entries()){const r=shared.mulberry32((c.seed??1)+i);counts[lane]=0;rng[lane]=()=>{const index=counts[lane]++,value=r();callbacks.push({sequence:callbacks.length,kind:'rng',cfg:key,stream:lane,index,value});return value;};}
  const budget=services.createPathBudget(c.pathBudget??20),paths=services.createPathService(map,budget);const svc:any={paths:{},log:(s:string)=>rec(key,'services.log',[s],()=>undefined)};
  const denied=(a:any,b:any)=>{const p=env.path??c.path;return p&&(p.kind==='radius-denial'&&Math.hypot(b.x-a.x,b.y-a.y)>p.radius||p.kind==='half-plane'&&b.x>=p.x);};
  for(const name of ['walk','path','los','clear','collisionMap'])svc.paths[name]=(...args:any[])=>rec(key,'paths.'+name,args,()=>{if(name!=='collisionMap'&&denied(args[0],args[1]))return name==='los'||name==='clear'?false:null;return paths[name](...args);});
  const sourceKnow=knowledge.createKnowledge(tier,rng.knowledge),know:any={};for(const name of ['factionEdge','weaponEdge','mobShare','odds'])know[name]=(...args:any[])=>rec(key,'knowledge.'+name,args,()=>sourceKnow[name](...args));
  const cfg={id:c.id??'me',name:'Declared source modules',seed:c.seed??1,tier,persona,map,features:features(c.features),services:svc,modules:Object.values(modules),learned:{enabled:c.learned?.enabled??false,bias:(k:string)=>rec(key,'learned.bias',[k],()=>{const row=(env.learned??c.learned?.entries??[]).find(([id]:any)=>id===k);return row?row[1]:0;})}};
  const mem=memory.createMemory({tier,map,selfId:cfg.id,features:cfg.features});const view=new Proxy(mem.view,{get(t,k,r){if(k==='whereabouts')return(id:string,now:number)=>rec(key,'memory.whereabouts',[id,now],()=>t.whereabouts(id,now));return Reflect.get(t,k,r);}});
  bundles[key]={cfg,mem,view,rng,know,svc,budget,paths,counts,p:null,resolved:{...c,id:cfg.id,name:cfg.name,modules:Object.values<any>(modules).map(m=>m.id),learned:{kind:'argument-sensitive-lookup',enabled:cfg.learned.enabled,entries:c.learned?.entries??[]},services:{kind:'real-path-service',pathDescriptor:c.path??null,log:'record',initialFrame:{now:0,gatesLocked:false},budgetLifecycle:'startTick on observe',frameLifecycle:'setFrame(p.now,p.hud.gatesLocked) on observe'},seed:cfg.seed,tier:c.tier??'hard',persona:c.persona??'cautious',map:c.map??'open',features:cfg.features,pathBudget:c.pathBudget??20,tierValues:tier,personaValues:persona,seeds:{decide:c.seed??1,motor:(c.seed??1)+1,lapse:(c.seed??1)+2,knowledge:(c.seed??1)+3}}};
 }
 const hunter=new hunt.ChestHunter({...hunt.CHEST_HUNT,...spec.hunterConfig},(s:string)=>rec('$hunter','hunter.log',[s],()=>undefined));
 const custom:any={};let policyValue:any=null;
 const state=()=>Object.fromEntries(Object.entries<any>(bundles).map(([k,b])=>[k,{memory:memorySnapshot(b.mem),drawCounts:{...b.counts},pathStats:encode(b.paths.stats)}]));
 const initial={contexts:state(),hunter:encode(hunter),target:hunter.target,stats:encode(hunter.stats)},setupTranscript=encode(callbacks),rows:any[]=[];
 for(const op of spec.operations){callbacks=[];env=op.env??{};const before=encode(op),b=bundles[op.cfg??'a'];let result:any,identity:any,resolvedInput:any;
  if(op.method==='observe'){assert(b);b.p=op.input;b.budget.startTick();rec(op.cfg??'a','paths.setFrame',[b.p.now,b.p.hud.gatesLocked],()=>b.paths.setFrame(b.p.now,b.p.hud.gatesLocked));result=b.mem.observe(b.p);}
  else if(op.method==='noteSent')result=b.mem.noteSent(op.input);
  else if(op.method==='recordChoice')result=b.mem.recordChoice(op.input);
  else if(op.method==='hook'){const m=modules[op.module];assert(m);assert(typeof m[op.name]==='function','actual hook exists');const ctx={cfg:b.cfg,p:b.p,mem:b.view,know:b.know,svc:b.svc,rng:{decide:b.rng.decide,motor:b.rng.motor,lapse:b.rng.lapse},engaged:op.engaged??false};assert(b.p||op.name==='enabled','real observe before context hook');
   if(op.name==='enabled')result=m.enabled(op.features??b.cfg.features);
   else if(op.name==='adjust'){result=m.adjust(ctx,op.goal,op.intents);identity={returnedInputList:result===op.intents};}
   else result=m[op.name](ctx,...(op.name==='intents'||op.name==='act'?[op.goal]:[]));
  }else if(op.method==='helper'){
   const a=op.args;if(op.name==='costsSomething'){const def=shared.cardDef(a.id);assert(def);resolvedInput=encode(def);result=hunt.costsSomething(def);}
   else if(op.name==='activeWeapon')result=hunt.activeWeapon(a.self);
   else if(op.name==='cardScore'||op.name==='optionScore')result=hunt[op.name](a.id,a.self);
   else if(op.name==='chooseOption')result=hunt.chooseOption(a.options,a.takenBy,a.self);
   else if(op.name==='burns'||op.name==='bad')result=hazards[op.name](MAPS[a.map],a.faction,a.at.x,a.at.y);
   else throw Error('unknown helper '+op.name);
  }else if(op.method==='hunter.decide'){
   const inp=op.input,d=inp.walk,s=inp.sight;const expanded={...inp,walk:(to:any)=>rec(op.cfg??'a','hunter.walk',[to],()=>{const distance=Math.hypot(to.x-inp.self.x,to.y-inp.self.y);if(d.kind==='radius-denial'&&distance>d.radius)return null;if(d.kind==='direct')return distance*d.factor;return b.svc.paths.walk(inp.self,to)?.dist??null;}),sight:(to:any)=>rec(op.cfg??'a','hunter.sight',[to],()=>shared.hasLineOfSight(MAPS[b.resolved.map],inp.self,to)&&(s.kind!=='radius-denial'||Math.hypot(to.x-inp.self.x,to.y-inp.self.y)<=s.radius))};
   result=hunter.decide(expanded);
  }else if(op.method==='hunter.markDone')result=hunter.markDone(op.id);
  else if(op.method==='hunter.tried')result=hunter.tried(op.id);
  else if(op.method==='hunter.inspect')result={target:hunter.target,stats:structuredClone(hunter.stats)};
  else if(op.method==='registry.reset')result=registry.resetModules();
  else if(op.method==='registry.defaults'){for(const m of Object.values(modules))registry.registerModule(m);result=undefined;}
  else if(op.method==='registry.register'){const m=op.builtin?modules[op.builtin]:{id:op.id,enabled:(f:any)=>rec('$registry','custom.enabled',[op.token,f],()=>op.feature==='always'||f[op.feature]===true)};if(op.token)custom[op.token]=m;result=registry.registerModule(m);}
  else if(op.method==='registry.enabled'){const list=registry.enabledModules(op.features);result=list.map((m:any)=>({id:m.id,hooks:Object.keys(m).filter(k=>typeof m[k]==='function'),builtin:Object.entries(modules).find(([_,v])=>v===m)?.[0],token:Object.keys(custom).find(k=>custom[k]===m)}));}
  else if(op.method==='registry.policySet'){policyValue=()=>{throw Error('opaque registered policy must not replace real Wish policy');};result=registry.registerCastPolicy(policyValue);}
  else if(op.method==='registry.policyGet'){const p=registry.getCastPolicy();result={present:p!==null,sameRegistered:p===policyValue};}
  else throw Error('unknown operation '+op.method);
  assert.deepEqual(encode(op),before,'source does not mutate declared input');rows.push({method:op.method,declaration:before,...(resolvedInput?{resolvedInput}:{}),result:encode(result),...(identity?{identity}:{}),contexts:state(),hunter:{own:encode(hunter),target:hunter.target,stats:encode(hunter.stats)},callbacks:encode(callbacks)});
 }
 resetRegistry();return{id:spec.id,suite:spec.suite,covers:spec.covers,configs:encode(Object.fromEntries(Object.entries<any>(bundles).map(([k,b])=>[k,b.resolved]))),hunterConfig:encode({...hunt.CHEST_HUNT,...spec.hunterConfig}),initial,setupTranscript,operations:rows};
}

import assert from 'node:assert/strict';
import {shared,types,brain,hand,knowledge,services,registry,modules,resetRegistry,derive,wiring,deriveSource} from './runtime.mts';
import {MAPS,features,percept,self,fighter} from './builders.mts';
import {encode,memorySnapshot} from './codec.mts';
import {decode} from './verify.mjs';

export function resolveTier(c:any) {
  const base = types.TIERS[c.tier ?? 'hard'];
  return Object.fromEntries(Object.entries(base).map(([k,v]) => [k, typeof v === 'object' ? {...v,...c.tierOverrides?.[k]} : c.tierOverrides?.[k] ?? v]));
}
export function runCase(spec:any, instrument=true) {
  const saved = Object.values<any>(modules).flatMap(m=>Object.keys(m).filter(k=>typeof m[k]==='function').map(k=>[m,k,Object.getOwnPropertyDescriptor(m,k)] as const));
  try { return executeCase(spec,instrument); } finally {
    for (const [m,k,d] of saved) { Object.defineProperty(m,k,d!); assert.deepEqual(Object.getOwnPropertyDescriptor(m,k),d,'restore exact singleton descriptor/function'); }
  }
}
function executeCase(spec:any,instrument:boolean) {
  resetRegistry();
  let trace:any[] = [], active='setup', env:any={}, live:any={};
  const cfgs:any={}, instances:any={}, budgets:any={}, pathHandles:any={}, objects:any={}, observerStates=new WeakMap();
  const objectIds = new WeakMap(); let nextObject=0;
  const identity=(v:any) => { if (!objectIds.has(v)) objectIds.set(v,++nextObject);return objectIds.get(v); };
  const emit=(e:any)=>{e.sequence=trace.length;trace.push(e);};
  const call=(name:string,args:any[],fn:()=>any,extra:any={})=>{
    const row:any={kind:'callback',actor:active,name,args:encode(args),...extra}; emit(row);
    try {const result=fn();row.result=encode(result);return result;}
    catch(e:any) {row.error={name:e.name,message:e.message};throw e;}
  };
  function observe(ctx:any) {
    let state=observerStates.get(ctx.rng);
    if (!state) {
      state={brain:active,counts:{decide:0,motor:0,lapse:0},mem:ctx.mem,cfg:ctx.cfg,know:ctx.know};
      observerStates.set(ctx.rng,state); live[active]=state;
      for (const lane of instrument?['decide','motor','lapse']:[]) {
        const r=ctx.rng[lane];ctx.rng[lane]=()=>{const value=r();emit({kind:'rng',actor:state.brain,stream:lane,index:state.counts[lane]++,value});return value;};
      }
      for (const name of instrument?['factionEdge','weaponEdge','mobShare','odds']:[]) {
        const fn=ctx.know[name];ctx.know[name]=(...args:any[])=>call('knowledge.'+name,args,()=>fn(...args));
      }
    }
    emit({kind:'observe',actor:active,cfgIdentity:identity(ctx.cfg),originalCfg:ctx.cfg===cfgs[instances[active].cfg],rngIdentity:identity(ctx.rng),moduleIdentities:ctx.cfg.modules.map(identity),engaged:ctx.engaged,memory:memorySnapshot({view:ctx.mem})});
  }
  // Approved Root observational recipe: keep actual singleton objects and exact descriptors, restore in finally.
  if(instrument)for(const [handle,m]of Object.entries<any>(modules))for(const hook of Object.keys(m).filter(k=>typeof m[k]==='function')) {
    const original=m[hook],descriptor=Object.getOwnPropertyDescriptor(m,hook)!;
    Object.defineProperty(m,hook,{...descriptor,value:function(this:any,...args:any[]){
      const ctx=hook==='enabled'?null:args[0];
      const row:any={kind:'builtin',actor:active,handle,hook,args:encode(hook==='enabled'?args:args.slice(1)),...(ctx?{context:{cfgIdentity:identity(ctx.cfg),originalCfg:ctx.cfg===cfgs[instances[active]?.cfg],percept:encode(ctx.p),memory:memorySnapshot({view:ctx.mem}),engaged:ctx.engaged,rngIdentity:identity(ctx.rng),knowledgeIdentity:identity(ctx.know)}}:{})};emit(row);
      try {const result=Reflect.apply(original,this,args);row.result=encode(result);if(hook==='adjust')row.returnedInput=result===args[2];return result;}
      catch(e:any){row.error={name:e.name,message:e.message};throw e;}
    }});
  }
  objects.observer={id:'$observer',enabled:()=>true,observe};
  const counters:any={};
  for (const [handle,desc] of Object.entries<any>(spec.modules??{})) {
    const m:any={id:desc.id}; objects[handle]=m;
    for(const hook of desc.hooks) m[hook]=(...args:any[])=>{
      const ctx=hook==='enabled'?null:args[0], key=active+'|'+handle+'|'+hook;
      const index=counters[key]??0;counters[key]=index+1;
      const row:any={kind:'module',actor:active,handle,id:desc.id,hook,index,args:encode(hook==='enabled'?args:args.slice(1)),...(ctx?{now:ctx.p.now,engaged:ctx.engaged,cfgIdentity:identity(ctx.cfg)}:{})};emit(row);
      if((desc.throws??[]).some((t:any)=>t.hook===hook&&t.index===index)) {row.error='declared '+handle+' '+hook+' '+index;throw Error(row.error);}
      const rule=env.modules?.[handle]??desc;
      let result:any;
      if(hook==='enabled')result=desc.enabled!==false;
      if(hook==='observe')result=undefined;
      if(hook==='goals')result=rule.goals??[];
      if(hook==='intents')result=(rule.intents??[]).map((i:any)=>({...i,...(i.timing?.kind==='current'?{timing:{kind:'timed',due:ctx.p.now}}:{})}));
      if(hook==='adjust') {
        const input=args[2];row.listIdentity=identity(input);
        if(rule.adjust?.kind==='append-if-why')result=input.some((i:any)=>i.why===rule.adjust.why)?[...input,...rule.adjust.intents]:input;
        else if(rule.adjust?.kind==='append') result=[...input,...rule.adjust.intents];
        else result=input;
        row.returnedInput=result===input;row.resultIdentity=identity(result);
      }
      if(hook==='act') result=rule.output??{intents:[],status:{state:'running',why:'declared extension running'},attacking:false};
      row.result=encode(result);return result;
    };
  }
  const setup:any[]=[];
  function create(cfgHandle:string,handle:string) {
    active=handle;
    let cfg=cfgs[cfgHandle];
    if(!cfg) {
      const c=spec.configs[cfgHandle], map=MAPS[c.map??'open'];assert(map);
      const budgetHandle=c.budget??cfgHandle;
      if(!budgets[budgetHandle]) {budgets[budgetHandle]=services.createPathBudget(c.pathBudget??8);emit({kind:'caller',name:'createPathBudget',handle:budgetHandle,perTick:c.pathBudget??8});}
      const paths=services.createPathService(map,budgets[budgetHandle]);
      const serviceHandle=c.service??cfgHandle;
      pathHandles[serviceHandle]={paths,budget:budgetHandle};emit({kind:'caller',name:'createPathService',handle:serviceHandle,budget:budgetHandle,map:c.map??'open'});
      const wrapped:any={};
      for(const name of ['setFrame','walk','path','los','clear','collisionMap']) wrapped[name]=(...args:any[])=>call('paths.'+name,args,()=>{
        if(name==='setFrame')emit({kind:'retainedMemoryBeforeFrame',actor:active,lastHitAt:encode(live[active]?.mem.self.lastHitAt)});
        if(c.path?.kind==='tactics-empty-route-test' && ['walk','path','los','clear'].includes(name) && Math.hypot(args[1].x-args[0].x,args[1].y-args[0].y)>c.path.radius) return name==='los'||name==='clear'?false:name==='path'?[]:null;
        return paths[name](...args);
      },{service:serviceHandle});
      // Caller constructs real path services BEFORE enabledModules and createBrain.
      const f=features(c.features);let list:any[];
      if(c.modules==='registry') { list=[objects.observer,...registry.enabledModules(f)];emit({kind:'caller',name:'enabledModules',features:encode(f),handles:list.map(m=>m===objects.observer?'observer':Object.keys(modules).find(k=>modules[k]===m))}); }
      else list=(c.modules??['observer',...Object.keys(modules)]).map((h:string)=>objects[h]??modules[h]);
      assert(list.every(Boolean));
      const tier=resolveTier(c),persona={...types.PERSONAS[c.persona??'cautious'],...c.personaOverrides};
      cfg={id:c.id??'me',name:c.name??'Source Brain',seed:c.seed??7,tier,persona,map,features:f,modules:list,services:{paths:wrapped,log:(s:string)=>call('services.log',[s],()=>undefined)},learned:{enabled:c.learned?.enabled??false,bias:(key:string)=>call('learned.bias',[key],()=>{const row=(c.learned?.entries??[]).find(([k]:any)=>k===key);return row?row[1]:0;})}};
      cfgs[cfgHandle]=cfg;
      setup.push({handle:cfgHandle,originalCfgIdentity:identity(cfg),moduleObjectIdentities:list.map(identity),declaration:encode(c),resolved:encode({id:cfg.id,name:cfg.name,seed:cfg.seed,tier:cfg.tier,persona:cfg.persona,features:f,map:c.map??'open',budget:budgetHandle,service:serviceHandle,moduleHandles:list.map((m:any)=>m===objects.observer?'observer':Object.keys(modules).find(h=>modules[h]===m)??Object.keys(objects).find(h=>objects[h]===m)),learned:{kind:'argument-sensitive-immutable-table',enabled:cfg.learned.enabled,entries:c.learned?.entries??[]},derivedSeeds:Object.fromEntries([0,1,2,3].map((t)=>[t,derive(cfg.seed,t)]))})});
    }
    emit({kind:'caller',name:'createBrain',cfg:cfgHandle,handle});
    instances[handle]={cfg:cfgHandle,brain:brain.createBrain(cfg)};
  }
  for(const [handle,cfg]of Object.entries<string>(spec.brains??{a:'a'}))create(cfg,handle);
  const initialTrace=trace;const rows:any[]=[];const summaries:any={};
  const snapshot=()=>Object.fromEntries(Object.entries<any>(instances).map(([h,b])=>[h,{goal:encode(b.brain.goal),stats:encode(b.brain.stats),memory:live[h]?memorySnapshot({view:live[h].mem}):null,counts:live[h]?{...live[h].counts}:null}]));
  for(const op of spec.operations) {
    trace=[];active=op.brain??'a';env=op.env??{};const b=instances[active];let result:any,error:any;
    const input=encode(op);
    try {
      if(op.method==='frame')result=call('budget.startTick',[op.budget??'a'],()=>budgets[op.budget??'a'].startTick());
      else if(op.method==='tick')result=b.brain.tick(op.input);
      else if(op.method==='stats')result=b.brain.stats;
      else if(op.method==='goal')result=b.brain.goal;
      else if(op.method==='end') {result=b.brain.end(op.input);summaries[op.save??'last']=result;}
      else if(op.method==='savedSummary')result=summaries[op.key];
      else if(op.method==='recreate') {delete live[active];create(op.cfg,active);result=undefined;}
      else throw Error('unknown operation '+op.method);
    } catch(e:any) {if(spec.id!=='core-empty-route-test')throw e;error={name:e.name,message:e.message};}
    assert.deepEqual(encode(op),input,'declared input immutable');
    rows.push({method:op.method,declaration:input,result:encode(result),...(error?{error}:{}),brains:snapshot(),services:Object.fromEntries(Object.entries<any>(pathHandles).map(([h,s])=>[h,{stats:encode(s.paths.stats),budget:s.budget,left:budgets[s.budget].left}])),trace});
  }
  return {id:spec.id,family:spec.family,covers:spec.covers,modules:encode(spec.modules??{}),configs:setup,initialTrace,operations:rows};
}

export function knowledgeDependency(specs:any[],results:any[]) {
  return specs.flatMap((spec:any)=>Object.entries<any>(spec.configs).map(([cfgHandle,c])=>{
    const tier=resolveTier(c),seed=c.seed??7,derived=derive(seed,3),r=shared.mulberry32(derived),draws:number[]=[];
    const k=knowledge.createKnowledge(tier,()=>{const x=r();draws.push(x);return x;});assert.equal(draws.length,70);
    const queries:any[]=[];
    for(const a of shared.FACTION_IDS)for(const b of shared.FACTION_IDS)for(const elite of [false,true])queries.push({name:'mobShare',args:[a,b,elite],result:k.mobShare(a,b,elite)});
    for(const a of shared.FACTION_IDS)for(const b of shared.FACTION_IDS)queries.push({name:'factionEdge',args:[a,b],result:k.factionEdge(a,b)});
    for(const a of shared.WEAPON_IDS)for(const b of shared.WEAPON_IDS)queries.push({name:'weaponEdge',args:[a,b],result:k.weaponEdge(a,b)});
    for(const hp of [0,52,80,100]) {const args=[self({hp}),fighter('probe',600,{hpFrac:.4,tint:.3})];queries.push({name:'odds',args,result:k.odds(...args)});}
    const actualCalls:any[]=[];
    const result=results.find(r=>r.id===spec.id);
    const handles=Object.fromEntries(result.initialTrace.filter((t:any)=>t.name==='createBrain').map((t:any)=>[t.handle,t.cfg]));
    for(const [operation,o]of result.operations.entries())for(const t of o.trace)if(t.kind==='callback'&&t.name.startsWith('knowledge.')&&handles[t.actor]===cfgHandle) {
      const name=t.name.slice('knowledge.'.length),args=decode(t.args),value=k[name](...args);
      assert.deepEqual(encode(value),t.result,'Brain Knowledge equals actual tag3 dependency');
      actualCalls.push({operation,sequence:t.sequence,name,args,result:value});
    }
    return encode({case:spec.id,cfg:cfgHandle,seed,derived,tier,draws,queries,actualCalls,wiring,deriveSource,observability:'Separate actual-source constructor dependency; not observed inside createBrain. Public odds internals are closed.'});
  }));
}

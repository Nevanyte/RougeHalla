import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {decode,parseRaw,percept} from './value-reader.mjs';
export {decode,parseRaw};
const req=(o,ks)=>{assert(o&&typeof o==='object'&&!Array.isArray(o));for(const k of ks)assert(Object.hasOwn(o,k),'missing '+k);};
const closed=(o,ks)=>{req(o,ks);assert.deepEqual(Object.keys(o).sort(),ks.slice().sort(),'closed fields');};
const finite=(v)=>{if(typeof v==='number')assert(Number.isFinite(v));else if(v&&typeof v==='object')for(const x of Object.values(v))finite(x);};
const num=v=>assert(typeof v==='number'&&Number.isFinite(v));
const str=v=>assert(typeof v==='string');
const bool=v=>assert(typeof v==='boolean');
const vec=v=>{req(v,['x','y']);num(v.x);num(v.y);};
const one=(v,vs)=>assert(vs.includes(v),'unknown value '+v);
const tierNested={reaction:['mu','sigma','tau','floor','cap'],step:['mu','sigma','tau','floor','cap'],daze:['mu','sigma','tau','floor','cap'],thinkMs:['mean','jitter'],strategyMs:['mean','jitter'],moveScatter:['base','perUnit'],targetScatter:['sigma','lagS','slipP','slipMult'],hesitation:['p','minMs','maxMs'],orbwalk:['p','stepU','angleJitter'],route:['horizon','walkPaths','reach'],attention:['central','peripheryMult','engagedMult','reconsiderMs'],appraisal:['bias','lead','busy','hue','noise'],caution:['mobShare','eliteShare','startHp']};
const tierScalars=['refractoryMs','apm','burst','minGapMs','minimapSigma','edgeClickP','timingSigmaMs','softmaxT','lapseP','dodgeP','jukeP','knowledge','mobShareNoise','memorySpanMs','feintRead','wary'];
const personaScalars=['pve','pvp','loot','bounty','thirdParty','engageEdge','bountyCaution','fleeHp','reengageHp','kite','chaseGiveUpMs','mobKillGoal','playerThreat','eliteAppetite','coliseum','risk'];
function tierValues(t,partial=false){req(t,[]);const keys=['id',...tierScalars,...Object.keys(tierNested)];if(!partial)closed(t,keys);for(const [k,v]of Object.entries(t)){one(k,keys);if(k==='id')one(v,['easy','normal','hard']);else if(tierNested[k]){req(v,[]);if(!partial)closed(v,tierNested[k]);for(const [n,x]of Object.entries(v)){one(n,tierNested[k]);if(k==='route'&&n==='walkPaths')bool(x);else num(x);}}else num(v);}}
function personaValues(p,partial=false){req(p,[]);const keys=['id',...personaScalars];if(!partial)closed(p,keys);for(const [k,v]of Object.entries(p)){one(k,keys);if(k==='id')one(v,['farmer','hunter','opportunist','cautious']);else num(v);}}
function extras(p){
 percept(p);
 for(const k of ['lobbyEndsAt','raidStartedAt','patienceEndsAt','suddenDeathAt','startedWith','alive','playerCount','minPlayers'])num(p.hud[k]);str(p.hud.phase);str(p.hud.winner);bool(p.hud.training);bool(p.minimap.gatesLocked);
 if(p.self.build!==undefined){assert(p.self.build===null||typeof p.self.build==='object');if(p.self.build)Object.values(p.self.build).forEach(num);}
 for(const w of [p.extras.wish,...Object.values(p.extras.skills??{})].filter(v=>v!=null)){
  req(w,['ability','def','rank','readyAt','casting']);str(w.ability);num(w.rank);num(w.readyAt);bool(w.casting);
  // Full opaque ability definition is explicitly retained, not reduced/rebuilt by reader.
  assert(w.def===null||typeof w.def==='object');if(w.def){req(w.def,['id','name','ranks','ai','blockedBy']);assert(Array.isArray(w.def.ranks)&&Array.isArray(w.def.ai)&&Array.isArray(w.def.blockedBy));}
 }
 if(p.extras.chests){assert(Array.isArray(p.extras.chests));for(const c of p.extras.chests){req(c,['id','x','y','expiresAt','options','takenBy','picked']);str(c.id);vec(c);num(c.expiresAt);bool(c.picked);assert(c.options===null||Array.isArray(c.options));c.options?.forEach(str);assert(Array.isArray(c.takenBy));c.takenBy.forEach(str);}}
 if(p.extras.camps){assert(Array.isArray(p.extras.camps));for(const c of p.extras.camps){req(c,['index','id','type','reward','alive','state']);for(const k of ['index','alive','state'])num(c[k]);for(const k of ['id','type','reward'])str(c[k]);}}
 if(p.extras.effects)Object.values(p.extras.effects).forEach(num);
 if(p.extras.fields){assert(Array.isArray(p.extras.fields));for(const f of p.extras.fields){req(f,['id','kind','ability','x','y','x2','y2','r','owner','endsAt']);vec(f);for(const k of ['x2','y2','r','endsAt'])num(f[k]);for(const k of ['id','kind','ability'])str(f[k]);assert(f.owner===null||typeof f.owner==='string');}}
}
function goal(g){req(g,['kind']);one(g.kind,['idle','farm','hunt','fight','loot','flee','roam','hold','module']);const fields={idle:[],farm:['mob','camp'],hunt:['target'],fight:['target'],loot:['container'],flee:['from','until'],roam:['to','why'],hold:['at','why'],module:['module','data']}[g.kind];closed(g,['kind',...fields]);if(['fight','hunt'].includes(g.kind))str(g.target);if(g.kind==='module'){str(g.module);assert(g.data&&typeof g.data==='object');}if(g.kind==='hold'){vec(g.at);one(g.why,['wait','ambush','coliseum']);}if(g.kind==='roam'){vec(g.to);str(g.why);}if(g.kind==='farm'){str(g.mob);assert(g.camp===null||typeof g.camp==='string');}if(g.kind==='loot')str(g.container);if(g.kind==='flee'){assert(Array.isArray(g.from));g.from.forEach(vec);num(g.until);}}
function intent(i){req(i,['kind','priority','timing','why']);one(i.kind,['lock','move','stop','swap','pickup','cast','plan','choose']);num(i.priority);str(i.why);req(i.timing,['kind']);one(i.timing.kind,['step','timed','react','current']);if(i.timing.kind==='timed')num(i.timing.due);if(i.timing.kind==='react'){req(i.timing.stimulus,['kind','at','subject','central']);num(i.timing.stimulus.at);bool(i.timing.stimulus.central);}if(i.kind==='move')vec(i.to);if(i.kind==='lock'){str(i.target);vec(i.at);}if(i.kind==='swap')one(i.slot,[0,1]);if(i.kind==='pickup')str(i.container);if(i.kind==='cast'){vec(i);one(i.slot,['wish','q','e']);}if(['choose','plan'].includes(i.kind))assert(i.msg&&typeof i.msg==='object');}
function moduleRule(m,full=false){assert(m&&typeof m==='object');for(const k of Object.keys(m))one(k,full?['id','enabled','hooks','goals','intents','adjust','throws','output']:['goals','intents','adjust','output']);if(full){req(m,['id','enabled','hooks']);str(m.id);bool(m.enabled);assert(Array.isArray(m.hooks));m.hooks.forEach(h=>one(h,['enabled','observe','goals','intents','adjust','act']));}if(m.goals){assert(Array.isArray(m.goals));for(const d of m.goals){req(d,['goal','utility','why']);goal(d.goal);num(d.utility);str(d.why);if(d.choice!==undefined)str(d.choice);}}if(m.intents){assert(Array.isArray(m.intents));m.intents.forEach(intent);}if(m.output){req(m.output,['intents','status','attacking']);m.output.intents.forEach(intent);req(m.output.status,['state','why']);one(m.output.status.state,['running','done','blocked','failed']);str(m.output.status.why);bool(m.output.attacking);}if(m.adjust){req(m.adjust,['kind','intents']);one(m.adjust.kind,['append','append-if-why']);m.adjust.intents.forEach(intent);if(m.adjust.kind==='append-if-why')str(m.adjust.why);}for(const t of m.throws??[]){req(t,['hook','index']);one(t.hook,m.hooks);assert(Number.isInteger(t.index)&&t.index>=0);}}
export function validateSpec(spec){
 closed(spec,['id','family','covers','configs','modules','operations',...(spec.brains?['brains']:[])]);str(spec.id);str(spec.family);assert(Array.isArray(spec.covers));spec.covers.forEach(str);
 for(const m of Object.values(spec.modules))moduleRule(m,true);
 const configs=new Set(Object.keys(spec.configs)),brains=new Set(Object.keys(spec.brains??{a:'a'}));
 for(const c of Object.values(spec.configs)){for(const k of Object.keys(c))one(k,['id','name','seed','tier','persona','map','features','modules','service','budget','pathBudget','tierOverrides','personaOverrides','learned','path']);if(c.tierOverrides)tierValues(c.tierOverrides,true);if(c.personaOverrides)personaValues(c.personaOverrides,true);if(c.modules!=='registry'){assert(c.modules===undefined||Array.isArray(c.modules));for(const h of c.modules??[])one(h,['observer','wishes','planning','chests','hazards',...Object.keys(spec.modules)]);}if(c.features){const f=c.features;for(const [k,v]of Object.entries(f)){one(k,['messageTypes','wishes','statusEffects','fields','planning','chests','skills','relics','camps','hazards']);if(k!=='messageTypes')bool(v);}if(f.messageTypes){assert(Array.isArray(f.messageTypes));f.messageTypes.forEach(s=>one(s,['move','stop','target','attack','release','swap','pickup','cast','plan','choose','useConsumable']));}}if(c.id!==undefined)str(c.id);if(c.name!==undefined)str(c.name);if(c.seed!==undefined)num(c.seed);if(c.learned){closed(c.learned,['enabled','entries']);bool(c.learned.enabled);assert(Array.isArray(c.learned.entries));}if(c.tier)one(c.tier,['easy','normal','hard']);if(c.persona)one(c.persona,['farmer','hunter','opportunist','cautious']);if(c.map)one(c.map,['open','wall','detour','ember','bog','ice','light','generated7']);if(c.pathBudget!==undefined)num(c.pathBudget);if(c.path){closed(c.path,['kind','radius']);assert.equal(c.path.kind,'tactics-empty-route-test');assert.equal(c.path.radius,0);}finite(c.tierOverrides);finite(c.personaOverrides);for(const e of c.learned?.entries??[]){assert(e.length===2);str(e[0]);assert(typeof e[1]==='number');}}
 for(const cfg of Object.values(spec.brains??{a:'a'}))assert(configs.has(cfg));
 const clocks=new Map();
 for(const op of spec.operations){req(op,['method']);one(op.method,['frame','tick','stats','goal','end','savedSummary','recreate']);if(op.method==='frame'){closed(op,['method','budget']);str(op.budget);assert(Object.entries(spec.configs).some(([h,c])=>(c.budget??h)===op.budget));continue;}const h=op.brain??'a';assert(brains.has(h));const fields={tick:['brain','input','env'],stats:[],goal:[],end:['input'],savedSummary:['key'],recreate:['cfg','brain']}[op.method];closed(op,['method',...fields,...['brain','save'].filter(k=>!fields.includes(k)&&Object.hasOwn(op,k))]);if(op.method==='tick'){closed(op,['method','brain','input','env']);extras(op.input);assert(op.input.now>=(clocks.get(h)??-Infinity));clocks.set(h,op.input.now);closed(op.env,Object.hasOwn(op.env,'modules')?['modules']:[]);for(const [key,m]of Object.entries(op.env.modules??{})){assert(Object.hasOwn(spec.modules,key));moduleRule(m);}finite(op.env);}
 if(op.method==='recreate'){req(op,['cfg']);assert(configs.has(op.cfg));}if(op.method==='end'){assert(op.input===null||typeof op.input==='object');if(op.input){req(op.input,['outcome','place','players']);one(op.input.outcome,['won','draw','died','mia']);num(op.input.place);num(op.input.players);}}}
 return spec;
}
export function checkedDispatch(spec,run){validateSpec(spec);return run(spec);}
export function validate(body){
 closed(body,['format','methodValue','profile','maps','knowledgeDependencies','handSupplement','cases']);assert.equal(body.format,'rh-bot-private-brain-source/1');assert.equal(body.methodValue,'rh-method-value/1');
 const maps=new Set();for(const m of body.maps){req(m,['id','mapHashU32','value']);assert(!maps.has(m.id));maps.add(m.id);num(m.mapHashU32);const v=decode(m.value);req(v,['seed','w','h','tiles','terrain','regionGrid','territoryGrid','featureGrid','coliseum','spawnPool','camps','regions']);for(const k of ['tiles','terrain','regionGrid','territoryGrid','featureGrid'])assert(v[k] instanceof Uint8Array&&v[k].length===v.w*v.h);}
 for(const d of body.knowledgeDependencies){const v=decode(d);assert.equal(v.draws.length,70);v.draws.forEach(num);req(v.tier,['id','knowledge','mobShareNoise']);assert(v.queries.length>100);}
 for(const h of body.handSupplement){decode(h.features);decode(h.tier);for(const o of h.operations){extras(decode(o.percept));extras(decode(o.releasePercept));decode(o.intents).forEach(intent);for(const k of ['result','submitTrace','releaseTrace','stats','misses','memory'])decode(o[k],true);}}
 const ids=new Set();for(const c of body.cases){req(c,['id','family','covers','modules','configs','initialTrace','operations']);assert(!ids.has(c.id));ids.add(c.id);const configs={};for(const cfg of c.configs){assert(!Object.hasOwn(configs,cfg.handle));configs[cfg.handle]=decode(cfg.declaration);const r=decode(cfg.resolved);req(r,['id','name','seed','tier','persona','features','map','budget','service','moduleHandles','learned','derivedSeeds']);assert(maps.has(r.map));tierValues(r.tier);personaValues(r.persona);req(r.tier,['id','knowledge','mobShareNoise','softmaxT','lapseP','memorySpanMs','feintRead','timingSigmaMs','refractoryMs','apm','burst','minGapMs']);finite(r.tier);}
 const ops=c.operations.map(o=>{const d=decode(o.declaration);assert.equal(o.method,d.method);decode(o.result,true);for(const b of Object.values(o.brains)){decode(b.goal,true);decode(b.stats,true);if(b.memory)decode(b.memory,true);}for(const [i,t]of o.trace.entries()){assert.equal(t.sequence,i);one(t.kind,['callback','caller','module','builtin','observe','rng','retainedMemoryBeforeFrame']);if(['callback','builtin','module'].includes(t.kind))assert(Object.hasOwn(t,'result')||Object.hasOwn(t,'error'),'callback result/error present');if(t.args)decode(t.args,true);if(t.result)decode(t.result,true);if(t.memory)decode(t.memory,true);if(t.context){req(t.context,['cfgIdentity','originalCfg','percept','memory','engaged','rngIdentity','knowledgeIdentity']);extras(decode(t.context.percept));const v=decode(t.context.memory,true);req(v,['fighters','mobs','camps','containers','self','stimuli','bounties','choices']);bool(t.context.engaged);bool(t.context.originalCfg);}if(t.kind==='rng'){num(t.value);assert(t.value>=0&&t.value<1);one(t.stream,['decide','motor','lapse']);}}return d;});
 const brains={};for(const t of c.initialTrace)if(t.kind==='caller'&&t.name==='createBrain')brains[t.handle]=t.cfg;
 validateSpec({id:c.id,family:c.family,covers:c.covers,configs,modules:decode(c.modules),operations:ops,brains});}
 return body;
}
export function readerControls(body,specs){
 const receipts=[];const reject=(id,fn)=>{assert.throws(fn,id);receipts.push({id,result:'REJECT'});};
 for(const [i,v]of [{$:'future'},{$:'undefined',x:1},{$:'map',entries:[['x',1],['x',2]]},{$:'object',entries:[['x',1],['x',2]]},{$:'number',value:'Infinity'},{$:'u8',values:[256]},{$:'callable'},{$:'instance',name:'x',entries:[]}].entries())reject('codec-'+i,()=>decode(v));
 reject('raw-duplicate',()=>parseRaw('{"a":1,"\\u0061":2}'));
 for(const [id,edit]of [
 ['missing-self-ready',s=>delete s.operations.find(o=>o.method==='tick').input.self.readyAt],
 ['invalid-status',s=>s.operations.find(o=>o.method==='tick').input.self.status='future'],
 ['nonfinite-now',s=>s.operations.find(o=>o.method==='tick').input.now=Infinity],
 ['nonfinite-viewT',s=>s.operations.find(o=>o.method==='tick').input.viewT=NaN],
 ['missing-hud',s=>delete s.operations.find(o=>o.method==='tick').input.hud.gatesLocked],
 ['unknown-brain',s=>s.operations.find(o=>o.method==='tick').brain='absent'],
 ['unknown-module-object',s=>s.configs.a.modules=['absent']],
 ['unknown-budget',s=>s.operations.find(o=>o.method==='frame').budget='absent'],
 ['backward-clock',s=>s.operations.filter(o=>o.method==='tick')[1].input.now=0],
 ['unknown-map',s=>s.configs.a.map='absent'],
 ['undefined-delay-overlay',s=>s.configs.a.tierOverrides={reaction:{mu:undefined}}],
 ['unknown-runtime-answer-env',s=>s.operations.find(o=>o.method==='tick').env.rngAnswers=[.5]],
 ['unknown-operation-field',s=>s.operations.find(o=>o.method==='tick').installedMemory={}],
 ['wrong-feature-type',s=>s.configs.a.features={wishes:'false'}],
 ]){const s=structuredClone(specs[0]);edit(s);let advanced=0;reject(id,()=>checkedDispatch(s,()=>advanced++));assert.equal(advanced,0);receipts.at(-1).nonadvance=true;}
 const editBody=(id,edit)=>{const b=structuredClone(body);edit(b);reject(id,()=>validate(b));};
 editBody('unknown-format',b=>b.format='future');editBody('duplicate-case',b=>b.cases.push(b.cases[0]));editBody('map-layer-length',b=>b.maps[0].value.entries.find(([k])=>k==='terrain')[1].values.pop());
 const c=structuredClone(specs.find(s=>s.id==='core-chest'));delete c.operations.find(o=>o.method==='tick').input.extras.chests[0].takenBy;let advanced=0;reject('missing-chest-takenBy',()=>checkedDispatch(c,()=>advanced++));assert.equal(advanced,0);
 const field=(v,k)=>v.entries.find(([x])=>x===k);
 editBody('missing-tier-knowledge',b=>{const t=field(b.cases[0].configs[0].resolved,'tier')[1];t.entries=t.entries.filter(([k])=>k!=='knowledge');});
 editBody('missing-tier-reaction-mu',b=>{const t=field(field(b.cases[0].configs[0].resolved,'tier')[1],'reaction')[1];t.entries=t.entries.filter(([k])=>k!=='mu');});
 editBody('missing-callback-result',b=>{const t=b.cases[0].operations.find(o=>o.trace.some(t=>t.kind==='callback')).trace.find(t=>t.kind==='callback');delete t.result;});
 for(const value of [undefined,null,-0,Infinity,-Infinity,NaN,Number.MIN_VALUE,Number.MAX_VALUE,.1]){const encode=v=>v===undefined?{$:'undefined'}:typeof v==='number'&&(!Number.isFinite(v)||Object.is(v,-0))?{$:'number',value:Number.isNaN(v)?'NaN':Object.is(v,-0)?'-0':v>0?'+Infinity':'-Infinity'}:v;assert(Object.is(decode(JSON.parse(JSON.stringify(encode(value)))),value));}
 return receipts;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const b=parseRaw(readFileSync(process.argv[2]));validate(b);console.log(JSON.stringify({cases:b.cases.length,operations:b.cases.reduce((n,c)=>n+c.operations.length,0)}));}

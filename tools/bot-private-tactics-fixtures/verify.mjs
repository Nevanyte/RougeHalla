// Strict tagged-value reader plus finite corpus/envelope/consumed-field checks. Not a public intake validator.
// All records are converted before any caller receives a case; this module never mutates a source/native instance.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export function decode(v, diagnostic = false) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') { assert(Number.isFinite(v) && !Object.is(v, -0)); return v; }
  assert(v && typeof v === 'object' && !Array.isArray(v), 'a tagged MethodValue object');
  const closed = (fields) => assert.deepEqual(Object.keys(v).sort(), fields.sort(), 'closed tag fields');
  if (v.$ === 'undefined') { closed(['$']); return undefined; }
  if (v.$ === 'number') { closed(['$', 'value']); assert(['NaN', '+Infinity', '-Infinity', '-0'].includes(v.value)); return {NaN: NaN, '+Infinity': Infinity, '-Infinity': -Infinity, '-0': -0}[v.value]; }
  if (v.$ === 'callable') { assert(diagnostic); closed(['$']); return Symbol.for('source-callable'); }
  if (v.$ === 'hole') { assert(diagnostic); closed(['$']); return Symbol.for('source-hole'); }
  if (v.$ === 'array' || v.$ === 'set' || v.$ === 'u8') {
    closed(['$', 'values']); assert(Array.isArray(v.values)); const values = v.values.map((x) => decode(x, diagnostic));
    if (v.$ === 'set') { const s = new Set(values); assert.equal(s.size, values.length, 'duplicate Set member'); return s; }
    if (v.$ === 'u8') { assert(values.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)); return Uint8Array.from(values); }
    return values;
  }
  if (v.$ === 'map') {
    closed(['$', 'entries']); assert(Array.isArray(v.entries)); const m = new Map();
    for (const pair of v.entries) { assert(Array.isArray(pair) && pair.length === 2); const k = decode(pair[0], diagnostic);
      assert(k === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof k), 'primitive fixture Map key');
      assert(!m.has(k), 'duplicate Map key'); m.set(k, decode(pair[1], diagnostic)); }
    return m;
  }
  if (v.$ === 'object' || v.$ === 'instance') {
    assert(v.$ === 'object' || diagnostic, 'instances are output diagnostics only');
    closed(v.$ === 'object' ? ['$', 'entries'] : ['$', 'name', 'entries']);
    if (v.$ === 'instance') assert(typeof v.name === 'string' && v.name.length > 0);
    assert(Array.isArray(v.entries)); const object = Object.create(null);
    for (const pair of v.entries) { assert(Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string');
      assert(!Object.hasOwn(object, pair[0]), 'duplicate object key'); object[pair[0]] = decode(pair[1], diagnostic); }
    return object;
  }
  assert.fail('unsupported MethodValue tag');
}
const finite=(v)=>{if(typeof v==='number')assert(Number.isFinite(v),'nonfinite declared input');else if(v&&typeof v==='object')for(const x of Object.values(v))finite(x);};
const req=(o,keys)=>{assert(o&&typeof o==='object'&&!Array.isArray(o));for(const k of keys)assert(Object.hasOwn(o,k),'missing consumed fact '+k);};
const closed=(o,keys)=>{req(o,keys);assert.deepEqual(Object.keys(o).sort(),[...keys].sort(),'closed fields');};
const one=(v,vs,label)=>assert(vs.includes(v),'unsupported '+label+': '+v);
const str=v=>assert(typeof v==='string');
const bool=v=>assert(typeof v==='boolean');
const num=v=>assert(typeof v==='number'&&Number.isFinite(v));
const vec=v=>{req(v,['x','y']);num(v.x);num(v.y);};
const factions=[null,'fire','sentenced','plague','frost','holy'];
const weapons=[null,'sword','axe','shield','bow','wand','fists'];
const statuses=['alive','dead','mia'];
const goals=['idle','farm','hunt','fight','loot','flee','roam','hold','module'];
const methods=['observe','act','noteSent','recordChoice','step','reset','point','check','leave','pickHoldSpot','inReach'];
function goal(g,suite){one(g.kind,suite==='fight'?['farm','hunt','fight']:goals,'goal');
 const fields=suite==='fight'?['id','kind']:{idle:['kind'],farm:['kind','mob','camp'],hunt:['kind','target'],fight:['kind','target'],loot:['kind','container'],flee:['kind','from','until'],roam:['kind','to','why'],hold:['kind','at','why'],module:['kind','module','data']}[g.kind];closed(g,fields);
 if(suite==='fight'){str(g.id);return;}
 if(g.kind==='farm'){str(g.mob);assert(g.camp===null||typeof g.camp==='string');}if(['fight','hunt'].includes(g.kind))str(g.target);
 if(g.kind==='loot')str(g.container);if(g.kind==='flee'){assert(Array.isArray(g.from));g.from.forEach(vec);num(g.until);}if(g.kind==='hold'){vec(g.at);one(g.why,['coliseum','ambush','wait'],'hold reason');}if(g.kind==='roam'){vec(g.to);one(g.why,['explore','camp','lastSeen','coliseum','centre'],'roam reason');}if(g.kind==='module'){str(g.module);assert(g.data&&typeof g.data==='object');}}
function percept(p){closed(p,['now','viewT','self','hud','fighters','mobs','containers','projectiles','minimap','events','extras','features']);finite(p);num(p.now);num(p.viewT);
 req(p.self,['id','name','x','y','facing','status','hp','maxHp','barrier','faction','weapons','slot','attackTarget','drawStartedAt','readyAt','immuneUntil','sig','brand','power','asMult','speedMult','kills','mobKills','gv','bounty','moveSeq']);
 vec(p.self);str(p.self.id);str(p.self.name);if(p.self.windupMult!==undefined)num(p.self.windupMult);one(p.self.status,statuses,'status');one(p.self.faction,factions,'faction');assert(Array.isArray(p.self.weapons)&&p.self.weapons.length===2);p.self.weapons.forEach(w=>one(w,weapons,'weapon'));one(p.self.slot,[0,1],'slot');assert(p.self.attackTarget===null||typeof p.self.attackTarget==='string');
 for(const k of ['facing','hp','maxHp','barrier','drawStartedAt','readyAt','immuneUntil','sig','brand','power','asMult','speedMult','kills','mobKills','gv','bounty','moveSeq'])num(p.self[k]);
 req(p.hud,['phase','training','lobbyEndsAt','raidStartedAt','patienceEndsAt','suddenDeathAt','inColiseum','gatesLocked','startedWith','alive','playerCount','minPlayers','winner']);bool(p.hud.gatesLocked);bool(p.hud.inColiseum);
 for(const[k,rows]of [['fighter',p.fighters],['mob',p.mobs]]){assert(Array.isArray(rows));for(const f of rows){req(f,['id','name','x','y','facing','status','hpFrac','faction','inHand','drawStartedAt','sig','brand','vx','vy','dist','los','central',...(k==='fighter'?['bot','barrierFrac','bounty','immune','targetable','tint']:['kind','type'])]);vec(f);one(f.status,statuses,'status');one(f.faction,factions,'faction');one(f.inHand,weapons,'weapon');if(k==='mob')one(f.kind,['mob','elite','dummy','npc'],'mob kind');else bool(f.targetable);bool(f.los);bool(f.central);str(f.id);str(f.name);if(k==='fighter'){bool(f.bot);bool(f.immune);for(const x of ['barrierFrac','bounty','tint'])num(f[x]);}for(const x of ['facing','hpFrac','drawStartedAt','vx','vy','dist','sig','brand'])num(f[x]);}}
 assert(Array.isArray(p.containers));for(const c of p.containers){req(c,['id','kind','x','y','closed','weapon','interactable','dist','label']);str(c.id);vec(c);bool(c.closed);bool(c.interactable);if(c.weapon!==undefined)one(c.weapon,weapons,'weapon');num(c.dist);str(c.label);str(c.kind);}
 assert(Array.isArray(p.projectiles));for(const pr of p.projectiles){req(pr,['id','kind','x','y','vx','vy','x0','y0','t0','range','from']);vec(pr);str(pr.id);one(pr.kind,['ball','arrow'],'projectile kind');for(const k of ['vx','vy','x0','y0','t0','range'])num(pr[k]);}
 req(p.minimap,['t','mobs','gatesLocked']);num(p.minimap.t);assert(Array.isArray(p.minimap.mobs));for(const d of p.minimap.mobs){req(d,['id','x','y','faction','elite']);vec(d);str(d.id);one(d.faction,factions,'dot faction');bool(d.elite);}
 assert(Array.isArray(p.events));for(const e of p.events){req(e,['kind','t','at']);one(e.kind,['windup','swing','hit','block','stagger','cancel','projEnd','death','heal','teleport','bounty','victory','toast','result','private','ext'],'event');num(e.t);if(e.at!==null)vec(e.at);if(e.kind==='toast')str(e.text);if(e.kind==='windup'){req(e,['by','weapon','a','ms']);str(e.by);one(e.weapon,weapons,'weapon');num(e.a);num(e.ms);}if(['cancel','stagger'].includes(e.kind))str(e.id);
 const fields={windup:['by','weapon','a','ms'],swing:['by','weapon','a'],hit:['id','by','amount','weapon','sig'],block:['id','by','weapon'],stagger:['id'],cancel:['id'],projEnd:['id','proj','reason'],death:['id','name','by','mob'],heal:['id','amount'],teleport:[],bounty:['id','name','bounty'],victory:['id','name','draw'],toast:['text'],result:['result'],private:['type','msg'],ext:['fx','data']}[e.kind];req(e,fields);
 for(const k of ['id','by'])if(Object.hasOwn(e,k))assert(e[k]===null||typeof e[k]==='string');for(const k of ['amount','bounty','a','ms'])if(Object.hasOwn(e,k))num(e[k]);if(e.kind==='death')bool(e.mob);if(e.kind==='hit')one(e.weapon,weapons,'weapon');if(e.kind==='ext'){str(e.fx);assert(e.data&&typeof e.data==='object');}if(e.kind==='private'){str(e.type);assert(e.msg&&typeof e.msg==='object');}
 }
 req(p.features,['messageTypes','wishes','statusEffects','fields','planning','chests','skills','relics','camps','hazards']);assert(Array.isArray(p.features.messageTypes));for(const k of ['wishes','statusEffects','fields','planning','chests','skills','relics','camps','hazards'])bool(p.features[k]);p.features.messageTypes.forEach(k=>one(k,['move','stop','target','attack','release','swap','pickup','cast','plan','choose','useConsumable'],'feature message'));}
export function validate(body){closed(body,['format','methodValue','profile','maps','cases']);assert.equal(body.format,'rh-bot-private-tactics-source/1');assert.equal(body.methodValue,'rh-method-value/1');assert(Array.isArray(body.maps));for(const m of body.maps){closed(m,['id','mapHashU32','value']);decode(m.value);}
 assert(Array.isArray(body.cases));const ids=new Set();return body.cases.map(c=>{closed(c,['id','suite','covers','config','initial','setupTranscript','operations']);str(c.id);assert(!ids.has(c.id));ids.add(c.id);one(c.suite,['tactics','fight','world','orb','reflex','retreat'],'suite');const cfg=decode(c.config);finite(cfg);req(cfg,['tier','persona','seed','id','name','features','pathBudget','modules','learned','tierValues','personaValues','seeds']);str(cfg.id);str(cfg.name);num(cfg.seed);num(cfg.pathBudget);
 const tv=cfg.tierValues;req(tv,['knowledge','dodgeP','jukeP','feintRead','step','reaction','orbwalk','memorySpanMs','mobShareNoise','attention']);for(const k of ['knowledge','dodgeP','jukeP','feintRead','memorySpanMs','mobShareNoise'])num(tv[k]);
 for(const k of ['step','reaction']){req(tv[k],['mu','sigma','tau','floor','cap']);for(const x of ['mu','sigma','tau','floor','cap'])num(tv[k][x]);}req(tv.orbwalk,['p','stepU','angleJitter']);for(const k of ['p','stepU','angleJitter'])num(tv.orbwalk[k]);req(tv.attention,['central']);num(tv.attention.central);req(cfg.personaValues,['kite','coliseum']);num(cfg.personaValues.kite);num(cfg.personaValues.coliseum);
 one(cfg.map,body.maps.map(m=>m.id),'map');if(cfg.tier!==undefined)one(cfg.tier,['easy','normal','hard'],'tier');if(cfg.persona!==undefined)one(cfg.persona,['farmer','hunter','opportunist','cautious'],'persona');decode(c.initial.memory,true);decode(c.initial.stats,true);decode(c.setupTranscript,true);
 const ops=c.operations.map(o=>{closed(o,['method','declaration','result','memory','stats','callbacks','drawCounts','pathStats',...(o.thrown?['thrown']:[])]);one(o.method,methods,'method');const d=decode(o.declaration);finite(d);assert.equal(d.method,o.method);
 const fields={observe:['input'],act:['goal'],noteSent:['input'],recordChoice:['input'],step:['foe','weapon','locked'],reset:c.suite==='orb'?['readyAt']:[],point:['threats'],check:[],leave:[],pickHoldSpot:['centre','radius'],inReach:['foe','weapon']}[d.method];
 closed(d,['method',...fields,...['env','engaged','knowsSuddenDeath'].filter(k=>Object.hasOwn(d,k))]);
 if(d.engaged!==undefined)bool(d.engaged);if(d.knowsSuddenDeath!==undefined)bool(d.knowsSuddenDeath);
 if(d.method==='recordChoice')str(d.input);if(d.method==='pickHoldSpot'){vec(d.centre);num(d.radius);}if(d.method==='inReach'){vec(d.foe);bool(d.foe.los);one(d.weapon,weapons,'weapon');}
 const path=d.env?.path??cfg.path;if(path){one(path.kind,['radius-denial','half-plane'],'path descriptor');if(path.kind==='radius-denial'){closed(path,['kind','radius']);num(path.radius);}else{closed(path,['kind','x']);num(path.x);}}
 
 if(d.method==='observe')percept(d.input);if(d.method==='act')goal(d.goal,c.suite);
 if(d.method==='point'){assert(Array.isArray(d.threats));d.threats.forEach(vec);}if(d.method==='step'){req(d,['foe','weapon','locked']);vec(d.foe);str(d.foe.id);one(d.weapon,weapons,'weapon');bool(d.locked);}if(d.method==='reset'&&c.suite==='orb')num(d.readyAt);
 if(d.method==='noteSent'){req(d.input,['at','cmd','intent','priority','stimulus']);num(d.input.at);req(d.input.cmd,['type','msg']);one(d.input.cmd.type,['move','stop','target','attack','release','swap','pickup','cast','plan','choose','useConsumable'],'command');}
 const r=decode(o.result,true);if(d.method==='act'&&!o.thrown){req(r,['intents','status','attacking']);one(r.status.state,['running','done','failed','blocked'],'goal status');str(r.status.why);bool(r.attacking);assert(Array.isArray(r.intents));for(const i of r.intents)one(i.kind,['lock','move','stop','swap','pickup','cast','plan','choose'],'intent');}
 decode(o.memory,true);decode(o.stats,true);decode(o.pathStats,true);const callbacks=decode(o.callbacks,true);assert(Array.isArray(callbacks));callbacks.forEach((a,i)=>{assert.equal(a.sequence,i);one(a.kind,['callback','rng'],'callback kind');if(a.kind==='rng'){one(a.stream,['decide','motor','lapse','knowledge'],'stream');num(a.value);assert(a.value>=0&&a.value<1);}});return{declaration:d,result:r};});return{id:c.id,suite:c.suite,config:cfg,operations:ops};});}
export function readerControls(body){let count=0;const reject=f=>{assert.throws(f);count++;};for(const v of [{$:'future'},{$:'undefined',x:1},{$:'map',entries:[['a',1],['a',2]]},{$:'number',value:'Infinity'},{$:'object',entries:[['a',1],['a',2]]},{$:'u8',values:[256]},{$:'instance',name:'x',entries:[]}])reject(()=>decode(v));
 reject(()=>decode({$:'map',entries:[[0,1],[{$:'number',value:'-0'},2]]}));
 reject(()=>validate({...body,format:'future'}));reject(()=>validate({...body,extra:1}));const c=body.cases[0],op=c.operations.find(o=>o.method==='observe');
 const bad=d=>{const clone=structuredClone(body);const target=clone.cases[0].operations.find(o=>o.method==='observe');target.declaration=d;reject(()=>validate(clone));};
 const mutate=(fn)=>{const v=structuredClone(op.declaration);fn(v);bad(v);};
 const field=(v,k)=>v.entries.find(([x])=>x===k);
 mutate(v=>field(field(v,'input')[1],'now')[1]={$:'number',value:'+Infinity'});
 mutate(v=>field(field(v,'input')[1],'self')[1].entries=field(field(v,'input')[1],'self')[1].entries.filter(([k])=>k!=='readyAt'));
 mutate(v=>field(field(field(v,'input')[1],'self')[1],'status')[1]='future');
 mutate(v=>field(field(field(v,'input')[1],'self')[1],'x')[1]={$:'number',value:'NaN'});
 mutate(v=>field(field(v,'input')[1],'viewT')[1]={$:'number',value:'-Infinity'});
 const cfgBad=structuredClone(body);field(field(cfgBad.cases[0].config,'tierValues')[1],'orbwalk')[1].entries=field(field(cfgBad.cases[0].config,'tierValues')[1],'orbwalk')[1].entries.filter(([k])=>k!=='p');reject(()=>validate(cfgBad));
 reject(()=>validate({...body,cases:[c,c]}));assert(Object.is(decode({$:'number',value:'-0'}),-0));assert.equal(decode({$:'undefined'}),undefined);return count;}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){const p=process.argv[2]??'parity/policy/bot-private-tactics/source.json',b=readFileSync(p),body=JSON.parse(b),c=validate(body);console.log(JSON.stringify({cases:c.length,operations:c.reduce((n,x)=>n+x.operations.length,0),readerControls:readerControls(body),bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')}));}

/** Actual source status/field/displacement helpers in a genuine installed world. No ported oracle. */
import assert from 'node:assert/strict';
import {mapFromTiles,mulberry32,STATUS_KINDS,STATUS_RULES,TILE_FLOOR,TILE_WALL,TICK_MS,SIG_CHILLED,EFFECT_CASTING,HIDDEN_REVEAL_MS,ABILITIES,rankOf,DOT_FX_MS} from '@raid/shared';
import {createGameWorld} from '../../packages/server/src/sim/gameplay';
import {addPlayer,removePlayer,step} from '../../packages/server/src/sim/step';
import {combatant,isQuestGiver,standing} from '../../packages/server/src/sim/combatant';
import {addMob} from '../../packages/server/src/sim/mobs';
import {chainHook,rewardStream,payLater} from '../../packages/server/src/sim/world';
import * as status from '../../packages/server/src/sim/status';
import * as fields from '../../packages/server/src/sim/fields';
import * as abilities from '../../packages/server/src/sim/abilities';
import {displace} from '../../packages/server/src/sim/displace';
import {recordHit,deferHit,applyLedger} from '../../packages/server/src/sim/ledger';
import {setExtraRows,statSumsOf,modsOf,modRowsOf} from '../../packages/server/src/sim/mods';
import {heal} from '../../packages/server/src/sim/factions';
import {createIntake} from './intake';
export const RULE_NAMES=[...STATUS_KINDS];
type Op={kind:string;[key:string]:any};
export type Case={name:string;classification:'trusted-helper'|'ordinary-input';boundary:string;setup?:any;operations:Op[]};
const source=(id='bob',name='BOB',ownerId?:string)=>({id,name,...(ownerId===undefined?{}:{ownerId})});
const apply=(kind:string,extra:any={}):Op=>({kind:'apply',id:'alice',apply:{kind,source:source(),ms:1000,...extra}});
const read=(id='alice',at?:number):Op=>({kind:'read',id,...(at===undefined?{}:{at})});
const cases:Case[]=[];
const add=(name:string,operations:Op[],boundary:string,setup?:any,classification:Case['classification']='trusted-helper')=>cases.push({name,classification,boundary,...(setup?{setup}:{}),operations});
for(const kind of STATUS_KINDS)add('kind-'+kind,[read(),apply(kind,{ms:0}),apply(kind,{ms:STATUS_RULES[kind].maxMs+1,value:.4}),read(),{kind:'clock',at:1001},apply(kind,{ms:STATUS_RULES[kind].maxMs+1,value:.2,source:source('bob','LIVE-REFRESH')}),read(),{kind:'clock',at:1001+STATUS_RULES[kind].maxMs},read(),{kind:'find',id:'alice',statusKind:kind},apply(kind,{value:0,source:source('bob','STALE-FRESH')}),read(),{kind:'remove',id:'alice',selector:{kind:'all'}},read()],'actual rule, zero duration, max/live refresh duration, equality expiry, stale find/reuse and stable removal');
add('neutral-absent-returns',[{kind:'find',id:'alice',statusKind:'stun'},{kind:'remove',id:'alice',selector:{kind:'all'}},{kind:'cleanse',id:'alice',classes:['hard']},read()],'undefined find, empty removal/cleanse and absent table remain distinct');
add('key-cross-tag-ability',[apply('dot',{tag:'blaze',data:{fieldId:'old-field',shares:{phys:.2,magic:.3,true:.5}}}),apply('dot',{ability:'blaze',tag:'ignored',source:source('bob','REFRESH'),data:{healShare:0}}),read(),{kind:'clock',at:2000},apply('dot',{ability:'blaze',source:source('bob','FRESH','historical-owner'),data:{floorHp:0}}),read()],'Object.assign retains absent fields on live and stale refresh; matched original tag metadata remains');
add('key-cross-ability-tag',[apply('dot',{ability:'blaze',tag:'first'}),apply('dot',{tag:'blaze',source:source('bob','ignored')}),apply('dot',{ability:'blaze',tag:'second'}),read()],'ability over tag and cross-representation effective string equality');
add('key-empty-absent-and-sources',[apply('slowMove',{value:.1}),apply('slowMove',{tag:'',value:.2}),apply('slowMove',{source:source('retired/player','OLD'),tag:'',value:.3}),apply('slowMove',{ability:'blaze',tag:'',value:.4}),read()],'absent/empty key identity and historical source distinction');
add('additive-refresh-partial',[apply('slowAttack',{value:.05,add:{per:.2,cap:.45},data:{fieldId:'f0',revealUntil:9000}}),apply('slowAttack',{value:99,add:{per:.2,cap:.45},data:{moveMult:0}}),apply('slowAttack',{add:{per:.2,cap:.45},quiet:true}),read(),{kind:'remove',id:'alice',selector:{kind:'status',statusKind:'slowAttack'}},read()],'additive cap, retained partial payload and immediate slowAttack mirror removal');
add('quiet-refresh-hooks',[apply('root',{quiet:true}),apply('root',{quiet:true,value:0}),read()],'quiet suppresses only fresh FX; installed hooks still run with effects already refreshed');
add('zero-and-negative-readers',[...['slowMove','haste','antiHeal','zoned'].flatMap(kind=>[apply(kind,{value:-.25,source:source('negative-'+kind),data:{moveMult:.8,dealtMult:.9,takenFromSourceMult:.7}}),apply(kind,{value:0,source:source('zero-'+kind)}),read()])],'synthetic finite source-admitted numeric boundary; no lower clamp and active zero presence');
add('sum-max-product-caps',[...['slowMove','slowAttack','antiHeal','haste','zoned'].flatMap(kind=>[apply(kind,{source:source('first'),value:.4}),apply(kind,{source:source('second'),value:.4}),read()])],'ordered multi-source sums/max/product and source caps');
add('cleanse-classes',[...STATUS_KINDS.map(kind=>apply(kind)),{kind:'cleanse',id:'alice',classes:['never']},read(),{kind:'cleanse',id:'alice',classes:['soft']},read(),{kind:'cleanse',id:'alice',classes:['hard','never']},read(),{kind:'remove',id:'alice',selector:{kind:'all'}},read()],'never is never cleansed; stable insertion order across all fourteen kinds');
add('reveal-half-open-next-tick',[apply('hidden',{ms:5000}),{kind:'reveal',id:'alice',until:1400},read('alice',1049),read('alice',1050),{kind:'clock',at:1050},read(),{kind:'reveal',id:'alice',until:1600},{kind:'clock',at:1599},read(),{kind:'clock',at:1600},read(),{kind:'reveal',id:'alice',until:2000},read('alice',1649),read('alice',1650)],'half-open reveal window starts next tick; open extension preserves start; expired window restarts');
add('immunity-clock-retained',[apply('invulnerable',{ms:2000}),{kind:'remove',id:'alice',selector:{kind:'all'}},read()],'remove does not lower shared immuneUntil');
add('refused-zero-duration',[apply('stun',{ms:0}),apply('stun',{ms:-1}),read()],'nonpositive duration refusal');
add('refused-dead-player',[apply('stun'),read()],'not-standing recipient refusal',{actorOverrides:{alice:{status:'dead',hp:0}}});
add('refused-down-player',[apply('stun'),read()],'down flag independently refuses a nominally alive player',{runtimeOverrides:{alice:{down:{outcome:'died'}}}});
add('mob-and-quest-roles',[...STATUS_KINDS.map(kind=>({...apply(kind),id:'mob-role'})),...STATUS_KINDS.map(kind=>({...apply(kind),id:'quest-role'})),read('mob-role'),read('quest-role')],'actual source mob/quest-giver helper roles; no native mob gameplay claim',{roles:true});
add('frozen-fifo-and-late-selector',[apply('root',{tag:'before'}),{kind:'collect',value:true},{kind:'remove',id:'alice',selector:{kind:'status',statusKind:'root'}},apply('root',{tag:'later'}),{kind:'cleanse',id:'alice',classes:['hard']},read(),{kind:'drain'},read()],'trusted collection boundary: returns null/empty immediately; queued selectors run FIFO at execution');
add('frozen-dead-recipient',[{kind:'collect',value:true},apply('stun'),{kind:'remove',id:'alice',selector:{kind:'all'}},{kind:'displace',id:'alice',to:{x:400,y:200}},{kind:'actorPatch',id:'alice',patch:{status:'dead',hp:0}},{kind:'drain'},read()],'eligibility rechecked for queued apply; queued removal/displacement still execute');
add('frozen-nested-pay-later',[{kind:'collect',value:true},{kind:'queueNested',id:'alice'},{kind:'drain'},read()],'nested payout executes immediately after collection ends');
add('ordinary-axe-owner-departure',[{kind:'input',id:'alice',type:'attack',message:{a:0}},...Array.from({length:24},()=>({kind:'step',ms:TICK_MS})),{kind:'input',id:'alice',type:'release',message:{a:0}},{kind:'removePlayer',id:'alice'},read('bob'),{kind:'step',ms:TICK_MS},read('bob')],'ordinary intake axe producer followed by genuine owner removal; no add-status cheat',{actorOverrides:{alice:{weapon0:'axe'},bob:{x:238}}},'ordinary-input');
const castFact={ability:'freeze',rank:1,slot:'wish',startedAt:1000,landsAt:1100,target:'bob',point:{x:260,y:320},landing:null,prevReadyAt:0,lagMs:0};
for(const kind of ['stun','silence','root'])add('cast-fact-'+kind,[read(),apply(kind),read()],'trusted complete ability-cast fact only; source predicate/cancellation, no cast validation/producer claim',{runtimeOverrides:{alice:{cast:castFact}}});
add('cast-fact-zero-telegraph',[read()],'trusted complete zero-telegraph cast fact does not root/cast-bit',{runtimeOverrides:{alice:{cast:{...castFact,landsAt:1000}}}});
add('stun-cancels-source-bow-draw',[{kind:'input',id:'alice',type:'attack',message:{a:0}},{kind:'step',ms:TICK_MS},read(),apply('stun'),read()],'actual Bow input creates Draw; trusted status application invokes installed cancellation hook',{actorOverrides:{alice:{weapon0:'bow'}}});
add('hidden-source-attack-reveal',[apply('hidden',{ms:4000}),{kind:'input',id:'alice',type:'attack',message:{a:0}},{kind:'step',ms:TICK_MS},read(),{kind:'step',ms:TICK_MS},read()],'trusted hidden producer plus actual Bow attackStarted/updateAbilities reveal caller',{actorOverrides:{alice:{weapon0:'bow'}}});
add('fractional-duration-and-reveal',[apply('hidden',{ms:500.25}),{kind:'reveal',id:'alice',until:1400.75},read('alice',1049.999999),read('alice',1050),read('alice',1400.749999),read('alice',1400.75),{kind:'clock',at:1500.25},read(),apply('hidden',{ms:.5}),read('alice',1500.749999),read('alice',1500.75)],'synthetic source-admitted fractional Number duration/reveal/query boundaries; ordinary Sim ticks remain50ms');
add('frost-signal-remains-distinct',[read(),apply('slowMove',{value:0}),read(),{kind:'remove',id:'alice',selector:{kind:'all'}},read()],'trusted existing SIG_CHILLED read is independent of generic slowMove presence/value; no Frost producer claim',{actorOverrides:{alice:{sig:SIG_CHILLED}}});
add('explicit-undefined-payload-retention',[apply('hidden',{data:{fieldId:'old-field',moveMult:.8,revealUntil:1400,shares:{phys:0,magic:0,true:1}}}),apply('hidden',{source:source('bob','LIVE'),data:{fieldId:undefined,moveMult:0,revealUntil:undefined,shares:undefined}}),read(),apply('hidden',{data:{healShare:0}}),read(),{kind:'clock',at:2000},apply('hidden',{source:source('bob','FRESH'),data:{floorHp:0}}),read()],'synthetic valid optional-payload boundary: explicit undefined clears; omission retains undefined own properties; stale freshness deletes reveal fields only');
const EXCLUDED=new Set(['random','rewardRandom','questRandom','newItemUid','actions','hooks','afterWeapons','beforeDamage','systems','moveModifiers','modSources','profile']);
function plain(value:any):any{
 if(value===undefined)return {$undefined:true};
 if(typeof value==='number'&&!Number.isFinite(value))return {$number:String(value)};
 if(typeof value==='function')return {$function:value.name||'anonymous'};
 if(value===null||typeof value!=='object')return value;
 if(value instanceof Map||value instanceof Set)return Array.from(value instanceof Map?value.entries():value.values(),plain);
 if(ArrayBuffer.isView(value))return Array.from(value as any);
 if(Array.isArray(value))return value.map(plain);
 if(typeof value.toJSON==='function')return plain(value.toJSON());
 return Object.fromEntries(Object.keys(value).sort().map(k=>[k,plain(value[k])]));
}
function rig(c:Case,observed:boolean){
 const trusted=structuredClone(c.setup??{});
 const w=40,h=20,tiles=new Uint8Array(w*h).fill(TILE_FLOOR);for(let x=0;x<w;x++){tiles[x]=TILE_WALL;tiles[(h-1)*w+x]=TILE_WALL;}for(let y=0;y<h;y++){tiles[y*w]=TILE_WALL;tiles[y*w+w-1]=TILE_WALL;}
 if(trusted.splitMap)for(let y=0;y<h;y++)tiles[y*w+20]=TILE_WALL;
 const map={...mapFromTiles(w,h,tiles,11),spawns:Array.from({length:8},(_,i)=>({x:(i+3)*32+16,y:112}))};
 const factories={random:()=>mulberry32(12),rewardRandom:()=>rewardStream([1,2,3,4]),questRandom:()=>rewardStream([5,6,7,8])};
 const draws:any={random:0,rewardRandom:0,questRandom:0};const initial=factories.random();let uid=0;
 const world=createGameWorld({seed:11,map,newItemUid:()=>String(++uid),config:{minPlayers:3,lobbySeconds:15,fillSeconds:0,patienceSeconds:3600,patienceMinSeconds:3600,suddenDeathSeconds:3600,pvpRules:trusted.pvpRules??false},random:()=>{draws.random++;return initial();},rewardSalt:[1,2,3,4],questSalt:[5,6,7,8]},{signatures:trusted.signatures??false,walkHints:false});
 for(const key of ['rewardRandom','questRandom'] as const){const actual=world[key];world[key]=()=>{draws[key]++;return actual();};}
 for(const id of ['alice','bob','carol'])addPlayer(world,id,id.toUpperCase(),{faction:'fire'});
 step(world,TICK_MS);assert.equal(world.state.phase,'active');world.state.serverTime=1000;world.state.tick=20;
 for(const [i,id]of ['alice','bob','carol'].entries()){const s=world.state.players.get(id)!;s.x=200+i*60;s.y=320;s.immuneUntil=0;s.weapon0='';const rt=world.players.get(id)!;rt.path=[];rt.history=[{t:1000,x:s.x,y:s.y}];}
 const aliases:Record<string,string>={};if(trusted.roles){for(const kind of ['mob','quest'] as const)aliases[kind+'-role']=addMob(world,{kind,name:kind,at:{x:700,y:320},hp:100,faction:'fire'});}
 const get=(id:string)=>{const actual=aliases[id]??id;const value=combatant(world,actual);assert(value,'actor '+id);return value;};
 for(const[id,patch]of Object.entries(trusted.actorOverrides??{})){const f=get(id);Object.assign(f.s,patch);if('x'in(patch as any)||'y'in(patch as any))f.rt.history=[{t:1000,x:f.s.x,y:f.s.y}];}
 for(const[id,patch]of Object.entries(trusted.runtimeOverrides??{})){Object.assign(get(id).rt,patch);if('cast'in(patch as any))status.refreshEffects(world,get(id));}
 if(trusted.markSuppressed)world.combat.marks={suppressed:new Map(trusted.markSuppressed),denies:new Map(),taxed:new Map()};
 world.events=[];const hooks:any[]=[];
 if(observed)for(const name of ['statusApplied','fighterOut','attackStarted','castEnded','healed','teleported','runEnded','hurt','hitLanded','arenaHurt']as const)chainHook(world,name,((...args:any[])=>{hooks.push({name,args:args.slice(1).map(a=>a&&typeof a==='object'&&'s'in a&&'rt'in a?{kind:a.kind,id:a.id,state:plain(a.s),statuses:plain(a.rt.statuses)}:plain(a))});})as any);
 const random=()=>Object.fromEntries(Object.entries(factories).map(([name,factory])=>{const clone=factory();for(let i=0;i<draws[name];i++)clone();return[name,{draws:draws[name],next:Array.from({length:4},clone)}];}));
 const callbackOperations:any[]=[];const fieldAliases:Record<string,string>={};
 const runtime=()=>({clock:{tick:world.state.tick,serverTime:world.state.serverTime,phase:world.state.phase},entityCounter:world.idCounter,marks:plain(world.combat.marks),fighters:[...world.players.keys(),...world.mobs.keys()].map(id=>{const c=combatant(world,id)!;const s:any=c.s,rt:any=c.rt;return{id,role:isQuestGiver(c)?'questGiver':c.kind,standing:standing(c),name:s.name,hp:s.hp,maxHp:s.maxHp,barrier:s.barrier??0,immuneUntil:s.immuneUntil??0,effects:s.effects,sig:s.sig,mirrors:plain(modsOf(s)),statuses:plain(rt.statuses),weapon:{readyAt:s.readyAt,state:plain(rt.weapon)},cast:plain(rt.cast),body:{x:s.x,y:s.y,facing:s.facing,displaceSeq:s.displaceSeq,path:plain(rt.path),history:plain(rt.history),slip:plain(rt.slip)},cards:rt.cards===undefined?{$undefined:true}:{critAccDot:rt.cards.critAccDot,dotRollTick:rt.cards.dotRollTick,dotCrit:rt.cards.dotCrit}};}),abilities:world.abilities===null?null:{fields:plain([...world.abilities.fields]),mirrors:plain([...world.state.fields]),dot:plain([...world.abilities.dot]),dotSince:world.abilities.dotSince,teleportedAt:plain(world.abilities.teleportedAt)},events:plain(world.events),ledger:plain(world.combat.ledger),landed:plain(world.combat.landed),deferred:plain(world.combat.deferred),collecting:world.combat.collecting,payouts:plain(world.combat.payouts),callbackOperations:plain(callbackOperations),random:random()});
 const snapshot=()=>({runtime:runtime(),clock:{tick:world.state.tick,serverTime:world.state.serverTime,phase:world.state.phase},modifiers:['alice','bob','carol'].filter(id=>world.players.has(id)).map(id=>{const f=get(id);return{id,rows:plain(modRowsOf(f.s as any)),sums:plain(statSumsOf(f.s)),mirrors:plain(modsOf(f.s))};}),callbackOperations:plain(callbackOperations),fieldAliases:plain(fieldAliases),world:plain(Object.fromEntries(Object.entries(world).filter(([k])=>!EXCLUDED.has(k)))),itemUid:uid,aliases:plain(aliases),random:random()});
 const reads=(id:string,at?:number)=>{const f=get(id);return{statuses:status.statusesOf(f),values:STATUS_KINDS.map(kind=>({kind,value:status.statusValue(world,f,kind)})),stunned:status.isStunned(world,f),rooted:status.isRooted(world,f),silenced:status.isSilenced(world,f),slowed:status.isSlowed(world,f),hidden:status.isHidden(world,f),untargetable:status.isUntargetable(world,f),untargetableId:status.isUntargetableId(world,f.id),untargetableAt:status.isUntargetableAt(f,at??world.state.serverTime),casting:status.isCasting(f),cannotMove:status.cannotMove(world,f),actionBlocked:status.actionBlocked(world,f),castBlocked:status.castBlocked(world,f,['stun','silence','root']),effects:status.effectsOf(world,f),healFactor:status.healFactor(world,f),attackSlowFactor:status.attackSlowFactor(world,f),moveMultiplier:status.statusMoveMultiplier(world,f),dealtFactor:status.dealtFactor(world,f.id),damageFactor:status.damageFactor(world,'bob',f.id)};};
 const intake=createIntake(false);
 const execute=(inputOp:Op):any=>{const op=structuredClone(inputOp);switch(op.kind){case'apply':{const{quiet,...a}=op.apply;if(op.linkField)a.data={...a.data,fieldId:fieldAliases[op.linkField]};return status.addStatus(world,get(op.id),a,{quiet});}case'remove':return status.removeStatuses(world,get(op.id),st=>op.selector.kind==='all'||op.selector.kind==='status'&&st.kind===op.selector.statusKind||op.selector.kind==='source'&&st.source.id===op.selector.sourceId);case'cleanse':return status.cleanse(world,get(op.id),op.classes);case'clock':world.state.serverTime=op.at;return;case'read':return reads(op.id,op.at);case'find':return status.findStatus(get(op.id),op.statusKind,op.sourceId);case'reveal':return status.reveal(world,get(op.id),op.until);case'collect':world.combat.collecting=op.value;return;case'drain':{world.combat.collecting=false;const pending=world.combat.payouts;world.combat.payouts=[];for(const payout of pending)payout();return;}case'actorPatch':Object.assign(get(op.id).s,op.patch);return;case'displace':return displace(world,get(op.id),op.to);case'queueNested':return payLater(world,()=>{status.addStatus(world,get(op.id),{kind:'root',source:source(),ms:1000,tag:'outer'});payLater(world,()=>status.addStatus(world,get(op.id),{kind:'silence',source:source(),ms:1000,tag:'nested'}));});case'input':return intake(op.id,get(op.id).rt.inputs,op.type,op.message,world.state.serverTime,false);
case'step':return step(world,op.ms);
case'removePlayer':return removePlayer(world,op.id);
case'runtimePatch':{const {weapon,...rest}=op.patch;Object.assign(get(op.id).rt,rest);if(weapon)Object.assign(get(op.id).rt.weapon,weapon);return;}
case'extraRows':return setExtraRows(world,get(op.id),op.rows);
case'heal':return heal(world,get(op.id),op.amount,op.options);
case'ledgerHit':return recordHit(world,op.hit);
case'deferHit':return deferHit(world,op.hit);
case'applyLedger':return applyLedger(world);
case'clearLedger':world.combat.ledger=[];world.combat.landed=[];return;
case'fieldAdd':{const f=fields.addField(world,op.field);if(op.alias)fieldAliases[op.alias]=f.id;return f;}
case'fieldRemove':return fields.removeField(world,fieldAliases[op.alias]??op.id);
case'fieldsRead':return [...fields.fieldsOf(world)];
case'fieldRemoveWhere':{const visited:any[]=[];const removed=fields.removeFieldsWhere(world,f=>{visited.push({id:f.id,size:fields.fieldsOf(world).size});return(op.selector.kind==='all'||f.owner.id===op.selector.ownerId)&&(op.selector.size===undefined||fields.fieldsOf(world).size===op.selector.size);});return{visited,removed};}
case'onTrail':return fields.onTrail(fields.fieldsOf(world).get(fieldAliases[op.alias])!,op.point);
case'updateAbilities':return abilities.updateAbilities(world);
case'statusDamage':return abilities.statusDamage(world,op.dtMs);
case'abilityDotFx':return abilities.abilityDotFx(world);
case'clearFighter':return abilities.clearFighter(world,op.id,op.cause);
case'clearAll':return abilities.clearAll(world,op.cause);
case'runEnded':return world.hooks.runEnded?.(world);
case'teleported':return world.hooks.teleported?.(world);
case'floorHp':return status.floorHp(world,op.id,op.before,op.total);
case'onHook':return chainHook(world,op.hook,((_w:any,c:any)=>{if(c.id!==op.victim)return;for(const nested of op.operations){const returned=execute(nested);callbackOperations.push({hook:op.hook,victim:c.id,operation:plain(nested),returned:plain(returned),collecting:world.combat.collecting,statuses:plain(status.statusesOf(get(nested.id??op.victim)))});}})as any);
default:throw Error('unknown operation '+op.kind);}};
 const setupInput={seed:11,randomSeed:12,rewardSalt:[1,2,3,4],questSalt:[5,6,7,8],newItemUid:'incrementing-decimal-from-zero',config:plain(world.config),modules:{assembler:'createGameWorld',signatures:trusted.signatures??false,walkHints:false},mapRows:Array.from({length:h},(_,y)=>Array.from({length:w},(_,x)=>tiles[y*w+x]===TILE_WALL?'#':'.').join('')),players:['alice','bob','carol'].map((id,i)=>({id,name:id.toUpperCase(),faction:'fire',patch:{x:200+i*60,y:320,immuneUntil:0,weapon0:''},runtime:{path:[],history:[{t:1000,x:200+i*60,y:320}]}})),clock:{serverTime:1000,tick:20},trusted:trusted};
 return{world,get,snapshot,execute,hooks,random,setupInput,verifyRandom(){const expected=random();for(const key of ['random','rewardRandom','questRandom']as const){const actual=Array.from({length:4},world[key]);assert.deepEqual(actual,expected[key].next,'actual unchanged RNG continuation '+key);}}};
}
export function captureStatusProbes(selected:Case[]=cases){
 const names=selected.map(c=>c.name);assert.equal(new Set(names).size,names.length);assert.equal(STATUS_KINDS.length,14);
 const trail=rankOf(ABILITIES.blaze,1).effects.find(e=>e.do==='trail')!;const zone=rankOf(ABILITIES.trial,1).effects.find(e=>e.do==='zone')!;
 return{shared:{tickMs:TICK_MS,effectCasting:EFFECT_CASTING,hiddenRevealMs:HIDDEN_REVEAL_MS,dotFxMs:DOT_FX_MS,fieldFallback:{blaze:{dps:(trail as any).dps,dotMs:(trail as any).dotMs},trial:{exitStunMs:(zone as any).exitStunMs}}},rules:STATUS_KINDS.map(kind=>({kind,...STATUS_RULES[kind]})),cases:selected.map(c=>{const baseline=rig(c,false),observed=rig(c,true);const setup=observed.snapshot();const steps:any[]=[];const baselineReturns:any[]=[];for(const operation of c.operations){baselineReturns.push(plain(baseline.execute(operation)));const before=observed.snapshot();const hookStart=observed.hooks.length;const returned=plain(observed.execute(operation));steps.push({operation:plain(operation),before,returned,after:observed.snapshot(),hooks:observed.hooks.slice(hookStart)});}assert.deepEqual(steps.map(s=>s.returned),baselineReturns,'observer returns '+c.name);assert.deepEqual(observed.snapshot(),baseline.snapshot(),'observer full state '+c.name);baseline.verifyRandom();observed.verifyRandom();return{...c,operations:c.operations.map(plain),setup:{input:observed.setupInput,initial:setup},steps,observerFullStateEquality:true,observerReturnEquality:true,sourceRandomContinuationEquality:true};})};
}

// Source-only actual Training World. No Mark/HP/path/action/clock/tax/mirror outcome setters.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const ROOT=process.env.RH_MARK_TAX_ROOT??'/repo';
const [mode,file]=process.argv.slice(2);assert(process.argv.length===4&&['--write','--check'].includes(mode)&&file);
assert.equal(process.version,'v22.23.4');assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
Math.random=()=>{throw Error('undeclared randomness');};
const load=(p:string)=>import(pathToFileURL(ROOT+'/'+p).href);
const S=await load('packages/shared/src/index.ts');
const {generateMap}=await load('packages/shared/src/mapgen.ts');
const {loadConfig}=await load('packages/server/src/config.ts');
const {createGameWorld}=await load('packages/server/src/sim/gameplay.ts');
const {addPlayer,startRaid,step}=await load('packages/server/src/sim/step.ts');
const {installTraining}=await load('packages/server/src/sim/training.ts');
const {enqueueClientMessage}=await load('packages/server/src/sim/inputs.ts');
const {combatant,activeWeapon,timingsOf}=await load('packages/server/src/sim/combatant.ts');
const {cardAsMultOf}=await load('packages/server/src/sim/mods.ts');
const {markTierOn}=await load('packages/server/src/sim/factions.ts');
const sha=(v:any)=>createHash('sha256').update(v).digest('hex');
const plain=(v:any)=>JSON.parse(JSON.stringify(v));
const baseMap=generateMap(1,0,{decor:false});
const simKeys=['minPlayers','lobbySeconds','fillSeconds','patienceSeconds','patienceMinSeconds','suddenDeathSeconds','wishLockSeconds','dummies','mobs','quests','planSeconds','regen','coliseumSchedule','firstPatienceSeconds','training'];
function run(name:string, high:boolean, phases:boolean){
 const main=S.mulberry32(12),draws:number[]=[];let uid=0;
 const map=structuredClone(baseMap),config={...loadConfig({}),training:true,dummies:true,planSeconds:0};
 const w=createGameWorld({map,config,random:()=>{const v=main();draws.push(v);return v;},rewardSalt:[1,2,3,4],questSalt:[5,6,7,8],newItemUid:()=>`U${++uid}`});
 installTraining(w);addPlayer(w,'p0','tax-subject',{faction:'holy'});startRaid(w);
 const source=w.modSources.find((f:any)=>f.name==='markTaxSource');assert(source,'actual registered tax source');
 const index=w.systems.findIndex((f:any)=>f.name==='updateMods');assert(index>=0,'actual mods system');
 const systemNames=w.systems.map((f:any)=>f.name);
 let phaseRows:any[]=[];
 function snap(){
  const p=w.state.players.get('p0'),c=combatant(w,'p0'),selected=w.combat.marks?.taxed.get('p0')??null;
  const mod=source(w,c); // Pure actual registered function; not a copied tax formula or private export.
  const player=plain(p.toJSON()),uncapped=cardAsMultOf(p),timings=timingsOf(p,activeWeapon(p));
  const sources=[...w.state.mobs].filter(([,m]:any)=>m.type==='bailiff').map(([id,m]:any)=>{
   const f=w.factions?.fighters.get(id),rt=w.mobs.get(id);
   return {id,public:plain(m.toJSON()),brain:{mode:rt.brain?.mode??null,target:rt.brain?.target??null},
    mark:f?{target:f.target,group:f.markGroup,originalSize:f.markGroupSize,hits:f.markHits,progress:f.markProgress,swaps:f.markSwaps,tier:f.tier}:null,
    tierOnSubject:markTierOn(w,id,'p0'),distanceToSubject:Math.hypot(p.x-m.x,p.y-m.y)};
  });
  return {tick:w.state.tick,time:w.state.serverTime,phase:w.state.phase,player,sources,taxedOwner:selected,
   actualModSource:mod===null?null:plain(mod),uncappedOwnRowAS:uncapped,
   rawSheetRate:S.FACTIONS[p.faction].rate*uncapped,
   // Derived labels, not an assertion that a quantized mirror is exactly the unrounded tax cap.
   sheetRateTimesDecodedMirror:S.FACTIONS[p.faction].rate*S.decodeMult(p.asMult),
   actualCurrentWeaponTimings:plain(timings),mainDrawCount:draws.length};
 }
 if(phases){
  const wrap=(list:any[],at:number,label:string)=>{assert(at>=0,label);const actual=list[at];list[at]=(...args:any[])=>{phaseRows.push({phase:'before-'+label,value:snap()});actual(...args);phaseRows.push({phase:'after-'+label,value:snap()});};};
  wrap(w.afterWeapons,w.afterWeapons.findIndex((f:any)=>f.name==='afterWeapons'),'factions-after-weapons');
  wrap(w.beforeDamage,w.beforeDamage.findIndex((f:any)=>f.name==='signatureDamage'),'signature-damage');
  wrap(w.systems,w.systems.findIndex((f:any)=>f.name==='afterDamage'),'factions-after-damage');
  wrap(w.systems,index,'mods');
 }
 const frames:any[]=[{action:{kind:'startRaid-as-RaidRoom'},events:plain(w.events.splice(0)),value:snap(),phases:[]}];
 const inputs:any[]=[];
 const tick=(action:any={kind:'ordinary-step'})=>{phaseRows=[];const events=step(w,50);frames.push({action,events:plain(events),value:snap(),phases:phaseRows});};
 const enqueue=(type:string,payload:any)=>{
  assert(enqueueClientMessage(w.players.get('p0').inputs,type,payload,{training:true}),'accepted actual '+type);
  inputs.push({beforeTick:w.state.tick,type,payload:plain(payload)});tick({kind:'accepted-input',type,payload:plain(payload)});
 };
 enqueue('train',{cmd:'stat',id:'plagueRat',count:1});
 enqueue('train',{cmd:'camp',id:'bailiff'});
 const born=[...w.state.mobs.values()].filter((m:any)=>m.type==='bailiff');assert.equal(born.length,3);
 const first=born[0];enqueue('move',{x:first.x,y:first.y+32,seq:1});
 for(let n=0;n<100;n++){const p=w.state.players.get('p0');if(Math.hypot(p.x-first.x,p.y-first.y)<=40)break;tick();}
 const me=w.state.players.get('p0');assert(Math.hypot(me.x-first.x,me.y-first.y)<=40,'ordinary path reaches camp');
 const a=Math.atan2(first.y-me.y,first.x-me.x);
 enqueue('attack',{a});enqueue('release',{a});
 enqueue('train',{cmd:'stat',id:'plagueRat',count:high?20000:1});
 while(w.state.serverTime<3000)tick();
 // The supported count1 input removes the high farm amount while an actual Mark remains. Count0 is refused by source parser.
 enqueue('train',{cmd:'stat',id:'plagueRat',count:1});
 const replay=S.mulberry32(12);for(const value of draws)assert.equal(replay(),value);
 return {name,input:{factory:'actual RaidRoom buildWorld training configuration + addPlayer/startRaid lifecycle, no Room/network instance',map:{seed:1,attempt:0,decor:false},config:Object.fromEntries(simKeys.map(k=>[k,config[k]]).filter(([,v])=>v!==undefined)),
  modules:'createGameWorld default all modules (including actual walkHints); installTraining',players:[{id:'p0',faction:'holy',bot:false}],seeds:{main:12,rewardSalt:[1,2,3,4],questSalt:[5,6,7,8]},
  highCount:high?20000:1,systemNames,modsIndex:index,setup:'deterministic map/streams/item UID factory; no equipment/cards/outcomes installed',inputs},frames,
  rng:{mainDraws:draws,mainNextFromIndependentReplay:replay()}};
}
const high=run('ordinary-holy-high-farm-selected-tax-and-count-reduction',true,true);
const low=run('ordinary-holy-low-farm-neutral-tax-control',false,true);
const bare=run('ordinary-holy-high-farm-no-phase-probes',true,false);
const semantic=(c:any)=>({frames:c.frames.map((r:any)=>({action:r.action,events:r.events,value:r.value})),rng:c.rng});
assert.deepEqual(semantic(high),semantic(bare),'phase read instrumentation must not change source state/events/RNG');
const walk=(dir:string):string[]=>readdirSync(ROOT+'/'+dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+'/'+e.name):[dir+'/'+e.name]);
const inventory=(paths:string[])=>Object.fromEntries(paths.sort().map(p=>[p,sha(readFileSync(ROOT+'/'+p))]));
const result={format:'rh-mark-tax-uncapped-source/1',provenance:{base:'a0c4818ce9df8ad0f4124db31e65ba1244bddc3b',node:process.version,platform:process.platform,arch:process.arch,
 image:'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',
 boundary:'Actual one-human Training World producer, not a running authenticated Colyseus Room, native parity, public transport admission or full tax-domain proof. Read-only wrappers call original factions afterWeapons/signatureDamage/afterDamage and updateMods exactly once in their original positions.',
 sourceSha256:inventory([...walk('packages/shared/src'),...walk('packages/server/src/sim'),'packages/server/src/config.ts','packages/server/src/rooms/RaidRoom.ts'].filter(p=>p.endsWith('.ts'))),
 configSha256:inventory(['package.json','package-lock.json','tsconfig.base.json','packages/shared/package.json','packages/server/package.json','packages/client/package.json','packages/shared/tsconfig.json','packages/server/tsconfig.json']),
 toolSha256:inventory(walk('tools/mark-tax-uncapped-fixtures').filter(p=>/\.(mts|mjs|sh|md)$/.test(p)))},map:{seed:baseMap.seed,w:baseMap.w,h:baseMap.h,tilesSha256:sha(baseMap.tiles),terrainSha256:sha(baseMap.terrain)},
 constants:{markNearRange:S.MARK_NEAR_RANGE,taxThreshold:S.MARK_TAX_THRESHOLD,sigTaxed:S.SIG_TAXED},noninterference:{phaseEnabledVersusDisabledStateEventsRng:true,disabledFrames:bare.frames.length},cases:[high,low]};
const {verify}=await import('./verify.mjs');verify(result);
const bytes=JSON.stringify(result,null,1)+'\n';if(mode==='--write')writeFileSync(file,bytes);else assert.equal(readFileSync(file,'utf8'),bytes,'exact immutable source capture');
console.log(JSON.stringify({mode,cases:result.cases.length,frames:result.cases.reduce((n,c)=>n+c.frames.length,0),bytes:Buffer.byteLength(bytes),sha256:sha(bytes)}));

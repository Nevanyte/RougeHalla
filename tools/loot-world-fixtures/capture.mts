/** Actual source loot-world runtime witness: spawns, pickup/swap/drop, body drops, born gating and Committed's second-slot lock. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as S from '@raid/shared';
import {createWorld,rewardStream} from '../../packages/server/src/sim/world.ts';
import {addPlayer,step,removePlayer} from '../../packages/server/src/sim/step.ts';
import {enqueueClientMessage} from '../../packages/server/src/sim/inputs.ts';
import {combatant} from '../../packages/server/src/sim/combatant.ts';
import {addContainer,holdBirth,crateHoldsStatChest} from '../../packages/server/src/sim/loot.ts';
import {grantCard} from '../../packages/server/src/sim/chests.ts';
assert.equal(process.version,'v22.23.4');
assert.equal(process.platform,'linux');
assert.equal(process.arch,'x64');
assert(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--check'));
Math.random=()=>{throw Error('undeclared random draw')};
const sha=(x:any)=>createHash('sha256').update(x).digest('hex');
const root='/repo';
const mapRaw=readFileSync(root+'/parity/initial-loot/input-map.json');
const declaredMap=JSON.parse(mapRaw.toString());
// Declared map input extension: ground spots added to the existing complete map (floor tiles only; no map regeneration).
const groundSpots=[{x:144,y:112},{x:112,y:144},{x:144,y:144},{x:304,y:304},{x:336,y:304},{x:368,y:304},{x:400,y:304},{x:432,y:304},{x:464,y:304},{x:304,y:336},{x:336,y:336},{x:368,y:336}];
const modules=['loot','weapons','targeting','projectiles','mobs','buffs','feed','camps','chests','mobLife','mobAI','abilities','vision','cardHooks','mods'];
const installers:any[]=await Promise.all(modules.map(async n=>{const m:any=await import('../../packages/server/src/sim/'+n+'.ts');return m.install;}));
const players=[{id:'p0',faction:'fire'},{id:'p1',faction:'sentenced'},{id:'p2',faction:'holy'}];
const configuration:any={seed:1,randomSeed:12,rewardSalt:[1,2,3,4],questSalt:[5,6,7,8],groundSpots,modules,
 config:{minPlayers:2,lobbySeconds:15,fillSeconds:0,patienceSeconds:3600,patienceMinSeconds:3600,suddenDeathSeconds:3600,hazards:false,mobs:false,quests:false,training:false,dummies:false,planSeconds:0},players};
const playerAt=(tx:number,ty:number)=>({x:tx*32+16,y:ty*32+16});
const pos={ground0:playerAt(3,4),ground1:playerAt(10,9),ground2:playerAt(11,10),bodyP0:playerAt(13,9),bodyP1:playerAt(14,9),holdP0:playerAt(10,10)};
const plain=(v:any):any=>v===undefined?{$undefined:true}:typeof v==='number'&&!Number.isFinite(v)?{$number:String(v)}:v===null||typeof v!=='object'?v:v instanceof Map?[...v].map(([k,x])=>[plain(k),plain(x)]):Array.isArray(v)?v.map(plain):ArrayBuffer.isView(v)?Array.from(v as any):v.toJSON?plain(v.toJSON()):Object.fromEntries(Object.keys(v).sort().map(k=>[k,plain(v[k])]));
function make(){const draws={random:0,rewardRandom:0,questRandom:0};const main=S.mulberry32(configuration.randomSeed);const st={uid:0};
 const map=structuredClone(declaredMap);map.groundSpots=groundSpots.map(p=>({...p}));
 for(const k of ['tiles','terrain','regionGrid','territoryGrid','featureGrid'])map[k]=Uint8Array.from(map[k]);
 const w=createWorld({seed:configuration.seed,map,config:configuration.config,random:()=>{draws.random++;return main();},rewardSalt:configuration.rewardSalt,questSalt:configuration.questSalt,newItemUid:()=>'U'+(++st.uid)});
 const reward=w.rewardRandom,quest=w.questRandom;
 w.rewardRandom=()=>{draws.rewardRandom++;return reward();};
 w.questRandom=()=>{draws.questRandom++;return quest();};
 for(const install of installers)install(w);
 return{w,draws,st};
}
function streamState(draws:any){const r=S.mulberry32(configuration.randomSeed);for(let i=0;i<draws.random;i++)r();const rw=rewardStream(configuration.rewardSalt);for(let i=0;i<draws.rewardRandom;i++)rw();const q=rewardStream(configuration.questSalt);for(let i=0;i<draws.questRandom;i++)q();
 return{random:[r(),r(),r(),r()],rewardRandom:[rw(),rw(),rw(),rw()],questRandom:[q(),q(),q(),q()]};}
function frame(w:any,st:any,draws:any,events:any[],label:string){return plain({label,tick:w.state.tick,time:w.state.serverTime,serial:w.idCounter,uid:st.uid,
 players:[...w.state.players].map(([id,p]:any)=>({id,x:p.x,y:p.y,hp:p.hp,maxHp:p.maxHp,potionSmall:p.potionSmall,potionLarge:p.potionLarge,weapon0:p.weapon0,weapon1:p.weapon1,slot:p.slot,readyAt:p.readyAt,status:p.status})),
 containers:[...w.state.containers].map(([id,b]:any)=>({id,kind:b.kind,x:b.x,y:b.y,opened:b.opened,items:b.items.map((it:any)=>({uid:it.uid,def:it.def})),statOffer:crateHoldsStatChest(w,id)})),
 notices:events.filter((e:any)=>e.type==='toast').map((e:any)=>({to:e.to,text:e.text})),
 rng:streamState(draws)});}
function act(w:any,a:any):any[]{const events:any[]=[];
 if(a.kind==='step'){for(const c of a.commands??[])assert.equal(enqueueClientMessage(w.players.get(c.actor).inputs,c.type,c.payload??{}),true);events.push(...step(w,50));return events;}
 if(a.kind==='kick'){removePlayer(w,a.actor);events.push(...w.events.splice(0));return events;}
 if(a.kind==='setupPlayer'){const p=w.state.players.get(a.actor),rt=w.players.get(a.actor);assert(p&&rt,'setup actor');
  if(a.at){p.x=a.at.x;p.y=a.at.y;rt.history=[{t:w.state.serverTime,x:p.x,y:p.y}];rt.path=[];}
  if(a.hp!==undefined)p.hp=a.hp;
  if(a.weapon0!==undefined)p.weapon0=a.weapon0;
  if(a.weapon1!==undefined)p.weapon1=a.weapon1;
  if(a.slot!==undefined)p.slot=a.slot;
  if(a.potionSmall!==undefined)p.potionSmall=a.potionSmall;
  return events;}
 if(a.kind==='grant'){assert.equal(grantCard(w,combatant(w,a.actor),a.card),1,'actual Committed grant');return events;}
 if(a.kind==='addContainer'){const was=w.stepping;if(a.stepping)w.stepping=true;const box=addContainer(w,a.kindOf,a.at,'Chest',a.items.map((def:string)=>({uid:w.newItemUid(),def})));if(a.hold)holdBirth(w,box.id);w.stepping=was;return events;}
 throw Error('unknown action '+a.kind);}
const cases:any[]=[];
function add(name:string,setup:any[],actions:any[]){cases.push({name,setup,actions});}
const setupPlayer=(actor:string,at:any,extra:any={})=>({kind:'setupPlayer',actor,at,hp:extra.hp,weapon0:extra.weapon0,weapon1:extra.weapon1,slot:extra.slot,potionSmall:extra.potionSmall});
const cmd=(actor:string,type:string,payload:any={})=>({actor,type,payload});
const pickup=(containerId:string)=>cmd('p0','pickup',{containerId});
const swap=(slot:any)=>cmd('p0','swap',slot===undefined?{}:{slot});
// 1. A real ground-spot weapon (actual loot-table roll at spawnLoot) goes into an empty hand and the prop vanishes.
add('ground-spawn-free-hand',[setupPlayer('p0',pos.ground0)],[{kind:'step',commands:[pickup('c2')]}]);
// 2. The second slot fills without a cooldown; a third weapon replaces the hand and drops what it held; a blind same-tick guess is refused.
add('second-slot-then-replace-with-born-drop',[setupPlayer('p0',pos.ground1,{weapon0:'bow'})],[
 {kind:'step',commands:[pickup('c3')]},
 {kind:'setupPlayer',actor:'p0',at:pos.ground2},
 {kind:'step',commands:[pickup('c4'),pickup('c5')]},
 {kind:'step',commands:[pickup('c5')]},
]);
// 3. Committed's lockSecondSlot: an empty second slot is not filled; the hand is replaced/dropped and the locked swap is refused.
add('committed-lock-second-slot',[setupPlayer('p0',pos.ground0,{weapon0:'bow'}),{kind:'grant',actor:'p0',card:'committed'}],[
 {kind:'step',commands:[pickup('c2')]},
 {kind:'step',commands:[swap(1)]},
]);
// 4. A real between-tick departure drops the carried weapons and small potions into a body; it waits one tick, then is lootable and stays.
add('body-drop-and-pickup',[setupPlayer('p0',pos.bodyP0),setupPlayer('p1',pos.bodyP1,{weapon0:'sword',weapon1:'axe',potionSmall:2})],[
 {kind:'kick',actor:'p1'},
 {kind:'step',commands:[pickup('c5')]},
 {kind:'step',commands:[pickup('c5')]},
 {kind:'step',commands:[pickup('c5')]},
]);
// 5. holdBirth: a chest born inside a tick and held is first pickable two ticks on; a between-tick ground container waits one.
add('hold-birth-chest-and-between-tick-ground',[setupPlayer('p0',pos.holdP0),
 {kind:'addContainer',kindOf:'chest',at:pos.holdP0,items:['axe'],stepping:true,hold:true},
 {kind:'addContainer',kindOf:'ground',at:pos.holdP0,items:['wand'],stepping:false}],[
 {kind:'step',commands:[pickup('c5'),pickup('c6')]},
 {kind:'step',commands:[pickup('c5'),pickup('c6')]},
]);
// 6. An ordinary non-locked swap still flips the hand and pays the shared cooldown.
add('swap-basic',[setupPlayer('p0',pos.ground0,{weapon0:'sword',weapon1:'axe'})],[{kind:'step',commands:[swap(undefined)]}]);
const rows:any[]=[];
for(const c of cases){const{w,draws,st}=make();
 for(const p of players)addPlayer(w,p.id,p.id,{faction:p.faction,bot:false});
 const frames:any[]=[];const push=(label:string,events:any[])=>frames.push(frame(w,st,draws,events,label));
 push('lobby',[]);
 push('birth',step(w,50));
 c.setup.forEach((a:any,i:number)=>push('setup-'+i,act(w,a)));
 c.actions.forEach((a:any,i:number)=>push('action-'+i,act(w,a)));
 rows.push({name:c.name,input:{setup:c.setup,actions:c.actions},frames});}
const byName=(n:string)=>rows.find((r:any)=>r.name===n)!;
const at=(r:any,label:string)=>r.frames.find((f:any)=>f.label===label);
const p0=(f:any)=>f.players.find((p:any)=>p.id==='p0');
// Structural assertions on the actual source behaviour this corpus witnesses.
for(const r of rows){const born=at(r,'birth');assert.equal(born.tick,1);
 assert.deepEqual(born.containers.map((c:any)=>[c.id,c.kind,c.items[0]?.def]),[['c1','chest','potionSmall'],['c2','ground','sword'],['c3','ground','axe'],['c4','ground','sword']],'actual spawnLoot order and loot-table rolls');}
const free=byName('ground-spawn-free-hand');
assert.deepEqual([p0(at(free,'action-0')).weapon0,p0(at(free,'action-0')).weapon1],['sword','']);
assert(!at(free,'action-0').containers.some((c:any)=>c.id==='c2'),'taken ground weapon vanishes');
const replace=byName('second-slot-then-replace-with-born-drop');
assert.deepEqual([p0(at(replace,'action-0')).weapon0,p0(at(replace,'action-0')).weapon1],['bow','axe'],'second slot filled, hand kept');
assert.equal(p0(at(replace,'action-0')).readyAt,p0(at(replace,'setup-0')).readyAt,'a free-slot pickup pays no cooldown');
assert.deepEqual([p0(at(replace,'action-2')).weapon0,p0(at(replace,'action-2')).weapon1],['sword','axe'],'hand replaced, second kept');
assert(at(replace,'action-2').containers.some((c:any)=>c.id==='c5'&&c.kind==='ground'),'the held weapon dropped where the player stands');
assert(at(replace,'action-2').notices.some((n:any)=>n.text==='Nothing there'),'the same-tick blind guess on the new drop is refused');
assert.deepEqual([p0(at(replace,'action-3')).weapon0,p0(at(replace,'action-3')).weapon1],['bow','axe'],'next tick the drop is takeable and replaces the hand');
const lock=byName('committed-lock-second-slot');
assert.deepEqual([p0(at(lock,'action-0')).weapon0,p0(at(lock,'action-0')).weapon1],['sword',''],'Committed never fills the second slot');
assert(at(lock,'action-0').containers.some((c:any)=>c.id==='c5'&&c.kind==='ground'&&c.items[0].def==='bow'),'the hand weapon dropped');
assert.equal(p0(at(lock,'action-1')).slot,0,'swap to the locked slot is refused');
assert.equal(p0(at(lock,'action-1')).readyAt,p0(at(lock,'action-0')).readyAt,'a refused swap pays no cooldown');
const body=byName('body-drop-and-pickup');
assert.deepEqual(at(body,'action-0').containers.filter((c:any)=>c.kind==='body').map((c:any)=>c.items.map((i:any)=>i.def)),[['sword','axe','potionSmall','potionSmall']]);
assert(at(body,'action-1').notices.some((n:any)=>n.text==='Nothing there'),'a body from a between-tick departure waits one tick');
assert.deepEqual([p0(at(body,'action-2')).weapon0,p0(at(body,'action-2')).weapon1],['sword','']);
assert.deepEqual(at(body,'action-2').containers.find((c:any)=>c.id==='c5').items.map((i:any)=>i.def),['axe','potionSmall','potionSmall']);
assert.deepEqual([p0(at(body,'action-3')).weapon0,p0(at(body,'action-3')).weapon1],['sword','axe']);
assert.deepEqual(at(body,'action-3').containers.find((c:any)=>c.id==='c5').items.map((i:any)=>i.def),['potionSmall','potionSmall'],'a body stays as an empty prop once looted');
const hold=byName('hold-birth-chest-and-between-tick-ground');
assert(at(hold,'action-0').notices.length===2&&at(hold,'action-0').notices.every((n:any)=>n.text==='Nothing there'),'held chest and between-tick ground both wait');
assert.equal(at(hold,'action-1').containers.find((c:any)=>c.id==='c5').opened,true,'the held chest opens two ticks on');
assert.deepEqual([p0(at(hold,'action-1')).weapon0,p0(at(hold,'action-1')).weapon1],['axe','wand']);
assert(!at(hold,'action-1').containers.some((c:any)=>c.id==='c6'),'taken ground weapon vanishes');
const swapCase=byName('swap-basic');
assert.equal(p0(at(swapCase,'action-0')).slot,1);
assert.equal(p0(at(swapCase,'action-0')).readyAt,100+250);
const files=['package.json','package-lock.json','tsconfig.base.json',...['packages/shared/src','packages/server/src/sim'].flatMap(dir=>readdirSync(root+'/'+dir,{recursive:true}).filter((p:any)=>p.endsWith('.ts')).map(p=>dir+'/'+p)),'tools/loot-world-fixtures/capture.mts'];
const sourceSha256=Object.fromEntries(files.sort().map(p=>[p,sha(readFileSync(root+'/'+p))]));
const result={format:'rh-loot-world-source/1',provenance:{revision:'039ceb4790611c3e564d1537a1ba47c194a5934d',node:process.version,platform:process.platform,arch:process.arch,nodeSha256:sha(readFileSync(process.execPath)),image:'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',tsx:JSON.parse(readFileSync(root+'/node_modules/tsx/package.json','utf8')).version,sourceSha256,inputMapSha256:sha(mapRaw)},
 configuration,roles:{input:'Declared trusted setup plus ordered actual source calls: constructor map/config, existing-player placements/weapons/potions, two declared container creations, the actual Committed grant, genuine enqueueClientMessage pickup/swap and ordinary 50ms steps; expected poststate never constructs native input state.',expected:'Actual legacy source output only; never computed from Rust.',private:'Run counters, item uids, container birth scheduling and the private RNG streams are server-private parity evidence, not a client projection.'},cases:rows};
const text=JSON.stringify(result)+'\n',path=process.env.RH_LOOT_WORLD_OUTPUT??'/out/source.json';
if(process.argv[2]==='--check')assert.equal(readFileSync(path,'utf8'),text,'canonical actual-source recapture differs');else writeFileSync(path,text);
console.log(JSON.stringify({cases:rows.length,frames:rows.reduce((n:number,c:any)=>n+c.frames.length,0),bytes:Buffer.byteLength(text),sha256:sha(text),check:process.argv[2]==='--check'}));

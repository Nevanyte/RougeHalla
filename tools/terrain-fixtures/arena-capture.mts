/** Actual source arena-lock/teleport continuation witness for the terrain kernel. Trusted setup is declared. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as S from '@raid/shared';
import {createWorld} from '../../packages/server/src/sim/world.ts';
import {addPlayer,step,removePlayer} from '../../packages/server/src/sim/step.ts';
assert.equal(process.version,'v22.23.4');assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
assert(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--check'));
Math.random=()=>{throw Error('undeclared random draw')};
const sha=(x:any)=>createHash('sha256').update(x).digest('hex');
const frozenSource='e6f870eca04de9ae537f2e367f32b357dada7c6d56b6d3d3712bc095486f1030';
const frozenBorn='0526ef2e2c45aab025c9a45a1a82b3a75e82b4c7bf72b310554ce749e2094a0a';
assert.equal(sha(readFileSync('parity/terrain/source.json')),frozenSource,'frozen v1 must remain unchanged');
assert.equal(sha(readFileSync('parity/terrain/born-source.json')),frozenBorn,'frozen born extension must remain unchanged');
const mapInput=readFileSync('tools/terrain-fixtures/born-map-input.json');
const constructorInputMap=JSON.parse(mapInput.toString());
const plain=(v:any):any=>typeof v==='number'&&!Number.isFinite(v)?String(v):v instanceof Map?[...v].map(([k,x])=>[k,plain(x)]):v instanceof Set?[...v].map(plain):v?.toJSON?plain(v.toJSON()):ArrayBuffer.isView(v)?Array.from(v as any):Array.isArray(v)?v.map(plain):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k,x])=>k!=='inputs'&&typeof x!=='function').map(([k,x])=>[k,plain(x)])):v;
const copy=(v:any)=>structuredClone(v);
const tc=(n:number)=>n*S.TILE+S.TILE/2;
// Declared trusted setup: three surface overrides on the complete input map (the map stays a real generated map).
const overlay=[{tx:7,ty:7,kind:S.TERRAIN_EMBER},{tx:5,ty:7,kind:S.TERRAIN_LIGHT},{tx:7,ty:5,kind:S.TERRAIN_ICE}];
const config={minPlayers:3,lobbySeconds:30,fillSeconds:0,planSeconds:0,patienceSeconds:3600,patienceMinSeconds:3600,suddenDeathSeconds:60,hazards:true,mobs:false,quests:false,training:false,dummies:false,coliseumSchedule:{firstSeconds:0.2,secondSeconds:2.0,repeatSeconds:2.0,minGapSeconds:0}};
const installers=['weapons','targeting','projectiles','terrainEffects','abilities','vision'];
const modules=await Promise.all(installers.map(n=>import('../../packages/server/src/sim/'+n+'.ts')));
function mapFor(){const map=copy(constructorInputMap);
 for(const e of overlay){assert.equal(map.tiles[e.ty*map.w+e.tx],S.TILE_FLOOR,'declared overlay tile must be floor');assert.equal(map.terrain[e.ty*map.w+e.tx],S.TERRAIN_NONE,'declared overlay must not replace existing terrain');map.terrain[e.ty*map.w+e.tx]=e.kind;}
 for(const key of ['tiles','terrain','regionGrid','territoryGrid','featureGrid'])map[key]=Uint8Array.from(map[key]);return map;}
const mainSeed=12,players=[{faction:'holy',profile:'p0'},{faction:'fire',profile:'p1'},{faction:'plague',profile:'p2'}];
let w:any,uid=0;const draws:any[]=[],rng=S.mulberry32(mainSeed);
const record=(value:number)=>{draws.push({stream:'main',value,tick:w?.state.tick??0,time:w?.state.serverTime??0,phase:w?.state.phase??'constructor'});return value};
w=createWorld({map:mapFor(),config,random:()=>record(rng()),rewardSalt:[1,2,3,4],questSalt:[5,6,7,8],newItemUid:()=>'U'+(++uid)});
for(const n of installers)modules[installers.indexOf(n)].install(w);
function slipOf(s:any){if(!s)return null;const v:any={vx:s.vx,vy:s.vy,ax:s.ax,ay:s.ay,replanAt:s.replanAt};for(const k of ['stuckX','stuckY','stuckN','stuckBest','stuckAt','gripUntil'])if(s[k]!==undefined)v[k]=s[k];return v;}
function privateRow(id:string){const rt=w.players.get(id);return rt?plain({path:rt.path,history:rt.history,slip:slipOf(rt.slip),slipPathIdentity:rt.slip?.path===rt.path,down:rt.down??null,resolved:rt.resolved??false}):null;}
function playerRows(){return [...w.state.players].map(([id,p]:any)=>plain({id,state:{x:p.x,y:p.y,facing:p.facing,hp:p.hp,maxHp:p.maxHp,barrier:p.barrier,status:p.status,faction:p.faction,immuneUntil:p.immuneUntil,kills:p.kills,bounty:p.bounty},private:privateRow(id)}));}
function frame(label:string,action:any,events:any[]){const s=w.state;
 return plain({label,action,public:{phase:s.phase,tick:s.tick,serverTime:s.serverTime,raidStartedAt:s.raidStartedAt,patienceEndsAt:s.patienceEndsAt,inColiseum:s.inColiseum,gatesLocked:s.gatesLocked,suddenDeathAt:s.suddenDeathAt,startedWith:s.startedWith,players:playerRows()},private:{terrain:w.terrain,stats:w.hazards.stats,ledger:w.combat.ledger,landed:w.combat.landed},events});}
function setupPlayer(a:any){const p=w.state.players.get(a.actor),rt=w.players.get(a.actor);assert(p&&rt,'setupPlayer actor exists');
 Object.assign(p,{x:a.at.x,y:a.at.y,facing:0});rt.history=[{t:w.state.serverTime,x:p.x,y:p.y}];
 if(a.hp!==undefined)p.hp=a.hp;
 rt.slip=a.slide?S.newSlip(p.x,p.y,a.slide.vx,a.slide.vy):null;}
function setupTerrain(a:any){for(const[id,at]of a.combatAt??[])w.terrain.combatAt.set(id,at);for(const[id,sum]of a.lightAcc??[])w.terrain.lightAcc.set(id,sum);if(a.lightSince!==undefined)w.terrain.lightSince=a.lightSince;}
function act(a:any):any[]{if(a.kind==='step')return step(w,50);
 if(a.kind==='setupPlayer')setupPlayer(a);
 else if(a.kind==='setupTerrain')setupTerrain(a);
 else if(a.kind==='remove'){removePlayer(w,a.actor);return w.events.splice(0);}
 else throw Error('unknown action '+a.kind);
 return w.events.splice(0);}
const spot=(tx:number,ty:number)=>({x:tc(tx),y:tc(ty)});
const ember=spot(7,7),light=spot(5,7),ice=spot(7,5);
const actions:any[]=[
 {kind:'setupPlayer',actor:'p0',at:ember,hp:90},
 {kind:'setupPlayer',actor:'p1',at:light,hp:50},
 {kind:'setupPlayer',actor:'p2',at:ice,hp:100,slide:{vx:20,vy:0}},
 {kind:'setupTerrain',lightAcc:[['p1',0.25]],lightSince:50,combatAt:[['p2',50]]},
 {kind:'step'},{kind:'step'},{kind:'step'},{kind:'step'},
 {kind:'setupPlayer',actor:'p0',at:ember},
 {kind:'step'},{kind:'step'},
 {kind:'remove',actor:'p2'},
 {kind:'step'},{kind:'step'},{kind:'step'},
 ...Array.from({length:30},()=>({kind:'step'})),
];
const UNLOCK=12,TELEPORT=7,LAST=UNLOCK+3+30-1;
const constructed=frame('constructed',null,[]);
for(const p of players)addPlayer(w,p.profile,p.profile,{faction:p.faction as any,bot:false});
const joined=frame('joined',null,[]);
const birthEvents=step(w,50);assert.equal(w.state.phase,'active');
const born=frame('born',null,birthEvents);
const frames:any[]=[];
for(let i=0;i<actions.length;i++)frames.push(frame('action-'+i,i,act(actions[i])));
const at=(i:number)=>frames[i],pick=(f:any,id:string)=>f.public.players.find((p:any)=>p.id===id);
// Frames align one-to-one with the declared actions: index 7 is the scheduled teleport tick (tick 5), index 11 the remove.
const teleported=at(7),preTeleport=at(6),lockedA=at(9),lockedB=at(10),removed=at(11),unlock=at(12),resumedA=at(13),resumedB=at(14);
assert.equal(born.public.phase,'active');
assert.equal(born.public.patienceEndsAt,250,'first scheduled slot is on the run clock');
assert(teleported.events.some((e:any)=>e.type==='fx'&&e.fx.kind==='teleport'),'actual source settle producer teleported');
assert(teleported.public.tick===5&&teleported.public.gatesLocked&&teleported.public.inColiseum);
assert.notEqual(pick(preTeleport,'p2').private.slip,null,'declared slide is live before the teleport');
assert(teleported.public.players.every((p:any)=>p.private.slip===null),'teleport cleared every player slide');
assert.deepEqual(teleported.private.terrain.combatAt,[['p2',50]],'teleport preserves the terrain combat clock');
assert.equal(teleported.private.terrain.lightAcc.length,1,'teleport preserves the light accumulation');
assert(teleported.private.stats.seconds.ember>0&&teleported.private.stats.seconds.light>0,'pre-teleport hazards acted');
const emberSeconds=teleported.private.stats.seconds.ember,hpAtLock=pick(teleported,'p0').state.hp;
assert.equal(lockedA.public.gatesLocked,true);assert.equal(lockedB.public.gatesLocked,true);
assert.equal(lockedA.private.stats.seconds.ember,emberSeconds,'locked gates suppress the ember pass');
assert.equal(lockedB.private.stats.seconds.ember,emberSeconds,'locked gates suppress the ember pass');
assert.equal(pick(lockedA,'p0').state.hp,hpAtLock);assert.equal(pick(lockedB,'p0').state.hp,hpAtLock);
assert(!removed.public.players.some((p:any)=>p.id==='p2'),'the real between-tick departure removed the player');
assert(removed.events.some((e:any)=>e.type==='resolved'&&e.result?.outcome==='mia'),'the departure resolved MIA');
assert.equal(unlock.public.gatesLocked,false,'the real death reopened the gates');
assert.equal(unlock.public.suddenDeathAt,0);
assert.equal(unlock.private.stats.seconds.ember,emberSeconds,'the unlock tick still starts locked');
// The teleport grants 1500ms of source immunity: the burn pass runs and counts hazard seconds, but the ledger takes no hp.
const immuneEnd=frames.slice(UNLOCK+1).findIndex((f:any)=>pick(f,'p0').state.hp<pick(unlock,'p0').state.hp);
const immuneFrames=frames.slice(UNLOCK+1,UNLOCK+1+immuneEnd);
assert(immuneFrames.length>0&&immuneFrames.every((f:any)=>f.public.gatesLocked===false&&pick(f,'p0').state.hp===pick(unlock,'p0').state.hp),'teleport immunity absorbs the burn without hiding the pass');
assert(immuneFrames.at(-1).private.stats.seconds.ember>unlock.private.stats.seconds.ember,'the burn pass ran while immunity absorbed its damage');
const firstDamage=UNLOCK+1+immuneEnd;
assert.equal(firstDamage,35-8+UNLOCK,'damage resumes on the first tick at/after the 1500ms immunity boundary');
assert(frames[firstDamage].private.stats.seconds.ember>frames[firstDamage-1].private.stats.seconds.ember,'burn resumed after the unlock');
assert(pick(frames[firstDamage],'p0').state.hp<pick(frames[firstDamage-1],'p0').state.hp,'ember damage resumed on the standing player');
assert(pick(frames[LAST],'p0').state.hp<pick(frames[firstDamage],'p0').state.hp,'ordinary ember damage continues');
assert(frames[LAST].public.gatesLocked===false&&frames[LAST].public.phase==='active','no later scheduled slot fires in this window');
const out={format:'rh-terrain-arena-source/1',frozenSource:{sha256:frozenSource},frozenBorn:{sha256:frozenBorn},
 provenance:{revision:'93ad67e406824c6afacda7518d592da8ef735677',node:process.version,platform:process.platform,arch:process.arch,image:'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',tsx:JSON.parse(readFileSync('node_modules/tsx/package.json','utf8')).version,typescript:JSON.parse(readFileSync('node_modules/typescript/package.json','utf8')).version,target:'ES2022',execution:'tsx actual unchanged source'},
 roles:{input:'Declared trusted setup plus ordered actual source calls: constructor map/overlay/config/players, three declared existing-player placements and two terrain clocks. Expected poststate never constructs native input state.',expected:'Actual legacy source output only; never computed from Rust.',private:'Terrain runtime/stats, slides, paths, histories and lifecycle clocks are server-private parity evidence, never a client projection.',boundary:'Actual constructor plus weapons/targeting/projectiles/terrain/abilities/vision installers; no loot, camps, mobs or faction signatures. The scheduled teleport is the real settle producer; the between-tick removal is the real player departure; the post-lock reposition is explicitly declared trusted setup so locked burn suppression is observable.'},
 profile:{name:'actual-source-arena-lock-terrain-continuation-v1',installers,config,mainSeed,rewardSalt:[1,2,3,4],questSalt:[5,6,7,8],overlay},
 constructorInputMap,input:{players,actions},constructed,joined,born,frames,randomTape:copy(draws),uidCounter:uid,orderSalt:w.orderSalt};
const text=JSON.stringify(out)+'\n',path=process.env.RH_TERRAIN_ARENA_OUTPUT??'parity/terrain/arena-source.json';
if(process.argv[2]==='--check')assert.equal(readFileSync(path,'utf8'),text,'canonical actual-source recapture differs');else writeFileSync(path,text);
console.log(JSON.stringify({frames:out.frames.length,bytes:Buffer.byteLength(text),sha256:sha(text),check:process.argv[2]==='--check',teleportTick:teleported.public.tick,lockedSeconds:lockedA.private.stats.seconds.ember,resumed:resumedB.private.stats.seconds.ember,emberHp:pick(resumedB,'p0').state.hp}));

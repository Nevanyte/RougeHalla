/** Actual source-born NPC witness: normal constructor/raid births precede declared existing-actor probes. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as S from '@raid/shared';
import {createWorld} from '../../packages/server/src/sim/world.ts';
import {addPlayer,step} from '../../packages/server/src/sim/step.ts';
import {markTickStart} from '../../packages/server/src/sim/arena.ts';
import {allCombatants,combatant} from '../../packages/server/src/sim/combatant.ts';
import {applyLedger} from '../../packages/server/src/sim/ledger.ts';
import {enqueueClientMessage} from '../../packages/server/src/sim/inputs.ts';
import {walkFighter,recordHistory} from '../../packages/server/src/sim/movement.ts';
import * as Terrain from '../../packages/server/src/sim/terrainEffects.ts';
assert.equal(process.version,'v22.23.4');assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
assert(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--check'));
Math.random=()=>{throw Error('undeclared random draw')};
const sha=(x:any)=>createHash('sha256').update(x).digest('hex');
const originalPath='parity/terrain/source.json',originalSha='e6f870eca04de9ae537f2e367f32b357dada7c6d56b6d3d3712bc095486f1030';
assert.equal(sha(readFileSync(originalPath)),originalSha,'frozen v1 must remain unchanged');
const baseInput=readFileSync('tools/terrain-fixtures/born-map-input.json');
const constructorInputMap=JSON.parse(baseInput.toString());
const plain=(v:any):any=>typeof v==='number'&&!Number.isFinite(v)?String(v):v instanceof Map?[...v].map(([k,x])=>[k,plain(x)]):v instanceof Set?[...v].map(plain):v?.toJSON?plain(v.toJSON()):ArrayBuffer.isView(v)?Array.from(v as any):Array.isArray(v)?v.map(plain):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k,x])=>k!=='inputs'&&typeof x!=='function').map(([k,x])=>[k,plain(x)])):v;
const copy=(v:any)=>structuredClone(v);
const installers=['loot','weapons','targeting','projectiles','mobs','buffs','feed','camps','chests','mobLife','mobAI','terrainEffects','abilities','vision','cardHooks','mods'];
const modules=await Promise.all(installers.map(n=>import('../../packages/server/src/sim/'+n+'.ts')));
const config={minPlayers:2,lobbySeconds:30,fillSeconds:0,patienceSeconds:3600,patienceMinSeconds:3600,suddenDeathSeconds:3600,mobs:true,quests:false,training:false,dummies:false,planSeconds:0};
const spot={x:240,y:240},end={x:272,y:240};
function mapFor(c:any){const map=copy(constructorInputMap);
 if(c.zone!=='fire'){
  const other=map.regions.findIndex((r:any)=>r.id===c.zone),fire=map.regions[0],target=map.regions[other];[fire.id,target.id]=[target.id,fire.id];
  for(const camp of fire.mobCamps){camp.id=c.zone+'-1';camp.region=c.zone;camp.weapon=({holy:'wand',plague:'bow',frost:'shield',sentenced:'sword'} as any)[c.zone];}
  for(const p of map.spawnPool)p.zone=p.zone==='fire'?c.zone:p.zone===c.zone?'fire':p.zone;
  map.camps[0].zone=c.zone;map.camps[0].id=c.zone+'-1';map.regionGrid=map.regionGrid.map((v:number)=>v===1?other+1:v===other+1?1:v);
  [map.regions[0],map.regions[other]]=[map.regions[other],map.regions[0]];map.spawns=map.regions.flatMap((r:any)=>r.spawns);
 }
 for(const e of c.overlay) {assert.equal(map.tiles[e.ty*map.w+e.tx],S.TILE_FLOOR);map.terrain[e.ty*map.w+e.tx]=e.kind;}
 for(const key of ['tiles','terrain','regionGrid','territoryGrid','featureGrid'])map[key]=Uint8Array.from(map[key]);return map;
}
function snapshot(w:any,label:string,events:any[]=[]){return plain({label,time:w.state.serverTime,tick:w.state.tick,phase:w.state.phase,counter:w.idCounter,camps:w.state.camps,containers:w.state.containers,fighters:allCombatants(w).map(c=>({id:c.id,kind:c.kind,state:plain(c.s),private:{path:c.rt.path,history:c.rt.history,slip:c.rt.slip??null,slipPathIdentity:c.rt.slip?.path===c.rt.path,statuses:c.rt.statuses??[],weapon:c.rt.weapon,...(c.kind==='player'?{gv:c.rt.gv,mobKills:c.rt.mobKills,lastHit:c.rt.lastHit,killedBy:c.rt.killedBy,down:c.rt.down,resolved:c.rt.resolved}:{brain:c.rt.brain,lastHitAt:c.rt.lastHitAt})}})),terrain:w.terrain,stats:w.hazards.stats,ledger:w.combat.ledger,landed:w.combat.landed,events});}
function construct(c:any){const draws:{stream:string,value:number}[]=[],main=S.mulberry32(12);let uid=0;
 const map=mapFor(c);const w=createWorld({seed:1,map,config:{...config,hazards:c.hazards},random:()=>{const value=main();draws.push({stream:'main',value});return value},rewardSalt:[1,2,3,4],questSalt:[5,6,7,8],newItemUid:()=>`U${++uid}`});
 const reward=w.rewardRandom,quest=w.questRandom;w.rewardRandom=()=>{const value=reward();draws.push({stream:'reward',value});return value};w.questRandom=()=>{const value=quest();draws.push({stream:'quest',value});return value};
 let terrainSystem:any;for(let i=0;i<modules.length;i++){modules[i].install(w);if(installers[i]==='terrainEffects')terrainSystem=w.systems.at(-1);}
 const constructed={...snapshot(w,'constructed'),orderSalt:w.orderSalt,hashSalt:plain(w.hashSalt),uidCounter:uid,randomDraws:copy(draws)};
 c.players.forEach((p:any,i:number)=>addPlayer(w,'p'+i,'name'+i,{faction:p.faction}));const birthEvents=step(w,50);assert.equal(w.state.phase,'active');assert.equal(w.state.mobs.size,3,'source raid hook births actual complete camp roster');
 const born={...snapshot(w,'born-before-any-placement',birthEvents),uidCounter:uid,randomDraws:copy(draws)};
 for(let i=0;i<c.players.length;i++){const p=w.state.players.get('p'+i)!,rt=w.players.get('p'+i)!,s=c.players[i];Object.assign(p,{x:s.x,y:s.y,facing:0,weapon0:s.weapon,weapon1:''});if(s.hp!==undefined)p.hp=s.hp;rt.history=[{t:w.state.serverTime,x:p.x,y:p.y}];}
 const arenaHurt:any[]=[];const priorArenaHurt=w.hooks.arenaHurt;w.hooks.arenaHurt=(world,victim,by,hp)=>{priorArenaHurt?.(world,victim,by,hp);arenaHurt.push(plain({victim,by,hp}));};
 const ids=[...w.mobs.keys()];return{w,constructed,born,draws,ids,terrainSystem,arenaHurt,get uid(){return uid}};
}
// Extract the actual terrain-only callbacks through its exported installer, without changing source-born world assembly.
const hookWorld=createWorld({map:S.mapFromTiles(4,4,new Uint8Array(16).fill(S.TILE_FLOOR),0),config,random:S.mulberry32(99),rewardSalt:[1,2,3,4],questSalt:[5,6,7,8],newItemUid:()=> 'hook-only'});Terrain.install(hookWorld);
const terrainHooks={teleported:hookWorld.hooks.teleported,raidStarted:hookWorld.hooks.raidStarted};
function setupBorn(r:any,a:any){const c=combatant(r.w,r.ids[a.index??0])!;assert.equal(c.kind,'mob');
 if(a.at){Object.assign(c.s,a.at);c.rt.history=[{t:r.w.state.serverTime,x:c.s.x,y:c.s.y}];c.rt.slip=null;}
 if(a.hp!==undefined)c.s.hp=a.hp;
 if(a.path)c.rt.path=copy(a.path);
 if(a.history)c.rt.history=copy(a.history);
 if(a.mode)c.rt.brain.mode=a.mode;
}
function act(r:any,a:any){const w=r.w;if(a.kind==='setupBorn'){setupBorn(r,a);return [];}
 if(a.kind==='step'){for(const input of a.inputs??[])assert.equal(enqueueClientMessage(w.players.get(input.actor).inputs,input.type,input.payload??{}),true);return step(w,50);}
 w.events=[];
 if(a.kind==='burn'){markTickStart(w);w.combat.ledger=[];w.combat.landed=[];for(const hook of w.beforeDamage)hook(w,a.dtMs??50);applyLedger(w);}
 else if(a.kind==='light'){w.combat.landed=[];r.terrainSystem(w,a.dtMs??50);}
 else if(a.kind==='walk'){const c=combatant(w,r.ids[a.index??0])!;walkFighter(w,c,(a.dtMs??50)/1000,false,a.speedMult??1);if(a.recordHistory)recordHistory(c.rt,c.s,w.state.serverTime);}
 else if(a.kind==='bog'){const c=combatant(w,r.ids[a.index??0])!;w.events.push({probe:{bog:Terrain.applyBog(w,c,a.dtMs??50),traction:Terrain.slipAccelOf(w,c),surface:Terrain.surfaceOf(w,c)}});}
 else if(a.kind==='terrainHook'){for(const rt of [...w.players.values(),...w.mobs.values()])rt.slip=S.newSlip(10,20,30,40);w.terrain.lightAcc.set('p0',2);w.terrain.combatAt.set('p0',123);terrainHooks[a.hook as 'teleported'|'raidStarted']!(w);}
 else if(a.kind==='teleported')w.hooks.teleported?.(w);
 else throw Error('unknown source action '+a.kind);
 return w.events.splice(0);
}
const player=(faction='holy',at={x:624,y:624},weapon='')=>({faction,...at,weapon});
const cases:any[]=[];
function add(name:string,zone:string,kind:number,hazards:any,actions:any[],players=[player(),player('fire',{x:624,y:112})]){cases.push({name,zone,hazards,overlay:[{tx:7,ty:7,kind}],players,actions});}
for(const zone of ['holy','fire','plague','frost','sentenced'])for(const hazards of [true,'all'])add(`born-${zone}-ember-${hazards}`,zone,4,hazards,[{kind:'setupBorn',at:spot},{kind:'burn',dtMs:50},{kind:'burn',dtMs:12.5},{kind:'step'}]);
add('born-plague-ember-real-attack-credit','plague',4,true,[{kind:'setupBorn',at:spot},{kind:'step',inputs:[{actor:'p0',type:'attack',payload:{a:0}}]},{kind:'setupBorn',hp:0.01},{kind:'burn',dtMs:50},{kind:'step'}],[player('holy',{x:208,y:240},'sword'),player('fire',{x:624,y:112})]);
for(const hazards of [true,'all'])add(`born-frost-ice-home-${hazards}`,'frost',6,hazards,[{kind:'setupBorn',at:spot,path:[end],history:[{t:0,x:231.5,y:240},{t:50,x:240,y:240}]},{kind:'walk',dtMs:50},{kind:'walk',dtMs:50},{kind:'walk',dtMs:50},{kind:'walk',dtMs:50},{kind:'step'}]);
add('born-holy-ice-return-crossing','holy',6,true,[{kind:'setupBorn',at:spot,path:[end],history:[{t:0,x:231.5,y:240},{t:50,x:240,y:240}]},{kind:'walk',dtMs:50},{kind:'walk',dtMs:50},{kind:'walk',dtMs:50},{kind:'walk',dtMs:50},{kind:'setupBorn',at:spot,mode:'return',path:[{x:144,y:112}]},{kind:'walk',dtMs:50},{kind:'step'},{kind:'step'},{kind:'step'},{kind:'teleported'}]);
for(const hazards of [true,'all'])add(`born-plague-bog-home-${hazards}`,'plague',5,hazards,[{kind:'setupBorn',at:spot},{kind:'bog',dtMs:50}]);
for(const hazards of [true,'all'])add(`born-holy-light-player-only-${hazards}`,'holy',7,hazards,[{kind:'setupBorn',at:spot,hp:100},{kind:'light',dtMs:50},{kind:'light',dtMs:1000}],[{...player('holy',spot),hp:100},player('fire',{x:624,y:112})]);
for(const hook of ['teleported','raidStarted'])add(`born-terrain-reset-${hook}`,'holy',6,true,[{kind:'setupBorn',at:spot,path:[end]},{kind:'walk',dtMs:50},{kind:'terrainHook',hook}]);
add('born-holy-return-ember-exclusion','holy',4,'all',[{kind:'setupBorn',at:spot,hp:100,mode:'return'},{kind:'burn',dtMs:50},{kind:'step'},{kind:'step'}]);
const outputs=cases.map(input=>{const r=construct(input);const initial=snapshot(r.w,'placed-players');const identity=()=>plain([...r.w.state.mobs].map(([id,m]:any)=>({id,type:m.type,faction:m.faction,maxHp:m.maxHp,camp:m.camp,home:r.w.mobs.get(id).brain.home,homeFacing:r.w.mobs.get(id).brain.homeFacing})));const bornIdentity=identity();const frames=[];for(let i=0;i<input.actions.length;i++){const events=act(r,input.actions[i]);assert.deepEqual(identity(),bornIdentity,'existing actor setup may never forge birth identity');frames.push({...snapshot(r.w,'action-'+i,events),randomDraws:copy(r.draws),uidCounter:r.uid,arenaHurt:r.arenaHurt.splice(0)});}return{input,constructed:r.constructed,born:r.born,initial,frames};});
const credited=outputs.find(c=>c.input.name==='born-plague-ember-real-attack-credit')!;assert(credited.frames[1].landed.some((h:any)=>h.by==='p0'),'credit must have actual enqueued-attack contact');assert.equal(credited.frames.at(-1)!.fighters[0].private.mobKills,1,'actual terrain finishing credit');
for(const c of outputs.filter(c=>c.input.name.startsWith('born-holy-light-player-only'))){const final=c.frames.at(-1)!;assert(final.fighters[0].state.hp>100,'light player must really heal');assert.equal(final.fighters[2].state.hp,100,'isolated installed light pass never heals a born NPC');}
const files=['package.json','package-lock.json','tsconfig.base.json',...['packages/shared/src','packages/server/src/sim'].flatMap(dir=>readdirSync(dir,{recursive:true}).filter((p:any)=>p.endsWith('.ts')).map(p=>dir+'/'+p)),'tools/terrain-fixtures/born-capture.mts','tools/terrain-fixtures/born-map-input.json'];
const result={format:'rh-terrain-born-source/1',frozenV1Sha256:originalSha,provenance:{revision:'a54c431828da2c41bc62a95fe5747a13044fd930',node:process.version,platform:process.platform,arch:process.arch,image:'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',tsx:JSON.parse(readFileSync('node_modules/tsx/package.json','utf8')).version,sourceSha256:Object.fromEntries(files.sort().map(p=>[p,sha(readFileSync(p))]))},profile:{name:'actual-source-born-basic-pve-terrain-v1',installers,factionMode:'Off',config,mainSeed:12,rewardSalt:[1,2,3,4],questSalt:[5,6,7,8],boundary:'Actual constructor and complete ordinary roster births; all declared setup modifies existing actors only. Never modifies NPC ID, type, faction, maxHp, camp, birth order, home, homeFacing, threat, RNG or provenance. All player actions pass actual enqueueClientMessage before step. Direct source passes and terrain-only hook extraction are explicitly named. Every returned event queue is drained once and never reinserted.'},constructorInputMap,cases:outputs};
const text=JSON.stringify(result)+'\n',path=process.env.RH_TERRAIN_BORN_OUTPUT??'parity/terrain/born-source.json';if(process.argv[2]==='--check')assert.equal(readFileSync(path,'utf8'),text);else writeFileSync(path,text);console.log(JSON.stringify({cases:outputs.length,frames:outputs.reduce((n,c)=>n+c.frames.length,0),bytes:Buffer.byteLength(text),sha256:sha(text),check:process.argv[2]==='--check'}));

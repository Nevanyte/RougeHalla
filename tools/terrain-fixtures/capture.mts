/** Actual legacy-source witness. Trusted setup is declared; expected values never come from Rust. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as S from '@raid/shared';
import {createWorld} from '../../packages/server/src/sim/world.ts';
import {createGameWorld} from '../../packages/server/src/sim/gameplay.ts';
import {addPlayer,startRaid,step} from '../../packages/server/src/sim/step.ts';
import {combatant,allCombatants} from '../../packages/server/src/sim/combatant.ts';
import * as T from '../../packages/server/src/sim/terrainEffects.ts';
import {install as factions,signatureState} from '../../packages/server/src/sim/factions.ts';
import {install as weapons} from '../../packages/server/src/sim/weapons.ts';
import {install as mobs,addMob} from '../../packages/server/src/sim/mobs.ts';
import {install as mobLife,placeMob} from '../../packages/server/src/sim/mobLife.ts';
import {applyLedger,recordHit} from '../../packages/server/src/sim/ledger.ts';
import {tickVelocity,walkFighter} from '../../packages/server/src/sim/movement.ts';
import {setExtraRows} from '../../packages/server/src/sim/mods.ts';
import {enqueueClientMessage} from '../../packages/server/src/sim/inputs.ts';
assert.equal(process.version,'v22.23.4');assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
Math.random=()=>{throw Error('undeclared randomness')};
const sha=(x:any)=>createHash('sha256').update(x).digest('hex');
const plain=(v:any):any=>typeof v==='number'&&!Number.isFinite(v)?String(v):v instanceof Map?[...v].map(([k,x])=>[k,plain(x)]):v instanceof Set?[...v].map(plain):v?.toJSON?plain(v.toJSON()):ArrayBuffer.isView(v)?Array.from(v as any):Array.isArray(v)?v.map(plain):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>k!=='inputs').map(([k,x])=>[k,plain(x)])):v;
const copy=(v:any)=>structuredClone(v);
const tc=(n:number)=>n*S.TILE+S.TILE/2;
const pt=(x:number,y:number)=>({x:tc(x),y:tc(y)});
const mapInput=(kind=0,layout='room')=>({w:48,h:30,seed:0,kind,layout});
function makeMap(d:any){const{w,h,kind,layout}=d;const tiles=new Uint8Array(w*h).fill(layout==='junction'?S.TILE_WALL:S.TILE_FLOOR),terrain=new Uint8Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(x===0||y===0||x===w-1||y===h-1){tiles[i]=S.TILE_WALL;continue;}
 if(layout==='junction'){if(y===5||x===10&&y>=5&&y<=12)tiles[i]=S.TILE_FLOOR;}
 if(layout==='wall'&&x===30&&y>=3)tiles[i]=S.TILE_WALL;
 if(tiles[i]===S.TILE_FLOOR)terrain[i]=layout==='stripe'?(x<12?S.TERRAIN_ICE:x<20?S.TERRAIN_BOG:x<28?S.TERRAIN_EMBER:S.TERRAIN_LIGHT):kind;}
 const map=S.mapFromTiles(w,h,tiles,d.seed,terrain);map.spawns=Array.from({length:8},(_,i)=>pt(2+i,2));return map;}
const config={minPlayers:3,lobbySeconds:15,fillSeconds:0,patienceSeconds:1e6,patienceMinSeconds:1e6,suddenDeathSeconds:1e6,pvpRules:false};
function rig(input:any){const tape:number[]=[],rng=S.mulberry32(3);const random=()=>{const x=rng();tape.push(x);return x};const map=makeMap(input.map);let uid=0;
 const opts={map,config:{...config,...input.config,hazards:input.hazards??true},random,rewardSalt:[1,2,3,4],questSalt:[5,6,7,8],newItemUid:()=>String(++uid)};
 const w=input.production?createGameWorld(opts,{signatures:input.signatures??false,walkHints:false}):createWorld(opts);
 if(!input.production){if(input.signatures)factions(w);weapons(w);mobs(w);mobLife(w);T.install(w);}
 const constructor={state:plain(w.state),idCounter:w.idCounter,orderSalt:w.orderSalt,hashSalt:plain(w.hashSalt),tape:copy(tape)};
 const players=input.players??['frost','fire','holy'].map((faction,i)=>({faction,at:pt(4+i*12,8)}));
 players.forEach((p:any,i:number)=>addPlayer(w,'p'+i,'player'+i,{faction:p.faction}));startRaid(w);w.events=[];
 players.forEach((p:any,i:number)=>{const c=combatant(w,'p'+i)!;Object.assign(c.s,{...p.at,immuneUntil:0,...p.state});c.rt.history=[{t:w.state.serverTime,x:c.s.x,y:c.s.y}];if(p.path)c.rt.path=copy(p.path);if(p.history)c.rt.history=copy(p.history);if(p.statuses)c.rt.statuses=copy(p.statuses);if(p.rows)setExtraRows(w,c,p.rows);});
 for(const m of input.mobs??[]){const id=m.kind==='dummy'?addMob(w,{kind:'dummy',name:'Dummy',at:m.at,hp:m.hp??100}):placeMob(w,{region:m.faction,elite:m.elite??false,at:m.at});const c=combatant(w,id)!;if(m.state)Object.assign(c.s,m.state);if(m.mode)c.rt.brain!.mode=m.mode;}
 if(input.setup?.now!==undefined)w.state.serverTime=input.setup.now;
 if(input.setup?.gatesLocked)w.state.gatesLocked=true;
 if(input.setup?.recentRival)w.players.get('p0')!.lastHit={by:'p1',at:w.state.serverTime-input.setup.recentRival.age};
 if(input.signatures)for(const hook of w.afterWeapons)hook(w,0);
 return{w,tape,constructor};}
function frame(w:any,label:string,events:any=w.events){return plain({label,time:w.state.serverTime,tick:w.state.tick,phase:w.state.phase,gatesLocked:w.state.gatesLocked,fighters:allCombatants(w).map(c=>({id:c.id,kind:c.kind,state:{x:c.s.x,y:c.s.y,facing:c.s.facing,hp:c.s.hp,maxHp:c.s.maxHp,barrier:(c.s as any).barrier,status:c.s.status,faction:c.s.faction,immuneUntil:(c.s as any).immuneUntil,kills:(c.s as any).kills,bounty:(c.s as any).bounty},private:{path:c.rt.path,history:c.rt.history,slip:c.rt.slip??null,slipPathIdentity:c.rt.slip?.path===c.rt.path,statuses:c.rt.statuses??[],...('gv'in c.rt?{gv:c.rt.gv,lastHit:c.rt.lastHit,killedBy:c.rt.killedBy,down:c.rt.down,resolved:c.rt.resolved}:{}),...(w.factions?{faction:signatureState(w,c.id)}:{})}})),terrain:w.terrain,stats:w.hazards.stats,ledger:w.combat.ledger,landed:w.combat.landed,events});}
function action(w:any,a:any){if(a.now!==undefined)w.state.serverTime=a.now;
 if(a.setPlayer)Object.assign(w.state.players.get(a.setPlayer.id),a.setPlayer.state);
 if(a.terrainClock)for(const[id,at]of a.terrainClock)w.terrain.combatAt.set(id,at);
 if(a.factionClock)for(const[id,at]of a.factionClock)(signatureState(w,id) as any).combatAt=at;
 if(a.lightAcc)for(const[id,sum]of a.lightAcc)w.terrain.lightAcc.set(id,sum);
 if(a.lightSince!==undefined)w.terrain.lightSince=a.lightSince;
 if(a.kind==='teleported'||a.kind==='raidStarted'){for(const rt of [...w.players.values(),...w.mobs.values()])rt.slip=S.newSlip(10,20,30,40);w.terrain.lightAcc.set('p0',2);w.terrain.combatAt.set('p0',123);w.hooks[a.kind]?.(w);return;}
 if(a.kind==='step'){for(const cmd of a.inputs??[])assert.equal(enqueueClientMessage(w.players.get(cmd.id).inputs,cmd.type,cmd.payload??{}),true);const ev=step(w,a.dtMs??50);w.events=ev;return;}
 w.combat.ledger=[];w.combat.landed=[];w.events=[];
 for(const h of a.hits??[])recordHit(w,{victim:h.victim??'p0',by:{id:h.by??'p1',name:h.by??'player1'},packet:{raw:h.raw,phys:0,magic:0,true:1},weapon:'sword',stagger:false});
 if(a.kind==='burn'){for(const hook of w.beforeDamage)hook(w,a.dtMs??50);applyLedger(w);}
 if(a.kind==='light'){w.combat.landed=copy(a.landed??[]);for(const hook of w.systems)hook(w,a.dtMs??50);}
 if(a.kind==='bog'){const c=combatant(w,a.id??'p0')!;const base=a.base??1;const modifiers=w.moveModifiers.map((m:any)=>m(w,c,a.dtMs??50));w.events.push({probe:{base,modifiers}});if(a.base!==undefined)w.moveModifiers.push(()=>a.base);}
 if(a.kind==='walk')walkFighter(w,combatant(w,a.id??'p0')!,(a.dtMs??50)/1000,a.keepFacing??false,a.speedMult??1);
}
const runtimeInputs:any[]=[];const add=(name:string,input:any)=>runtimeInputs.push({name,...input});
for(const hazards of [false,true,'all'])for(const kind of [4,5,6,7])add(`mode-${hazards}-kind-${kind}`,{map:mapInput(kind),hazards,players:['fire','plague','frost','holy','sentenced'].map((faction,i)=>({faction,at:pt(4+i*8,8),state:{hp:50,maxHp:100},path:[pt(5+i*8,8)]})),actions:[{kind:'burn',dtMs:12.5},{kind:'bog',dtMs:12.5},{kind:'walk',dtMs:12.5},{kind:'light',dtMs:12.5}]});
for(const state of [{barrier:0.2},{immuneUntil:10001},{hp:0.025},{hp:1}])add(`ember-pool-${Object.keys(state)[0]}-${Object.values(state)[0]}`,{map:mapInput(4),setup:{now:10000},players:[{faction:'holy',at:pt(4,8),state:{hp:100,maxHp:100,...state}},{faction:'fire',at:pt(30,8)}],actions:[{kind:'burn',dtMs:125.5}]});
add('ember-death-floor',{map:mapInput(4),setup:{now:10000},players:[{faction:'holy',at:pt(4,8),state:{hp:1,maxHp:100},statuses:[{kind:'deathFloor',source:{id:'p0',name:'p0'},startedAt:9000,until:11000,value:0,floorHp:0.5,taken:0}]},{faction:'fire',at:pt(30,8)}],actions:[{kind:'burn',dtMs:1000}]});
for(const age of [4999.999999,5000,5000.000001])add(`ember-recent-credit-${age}`,{map:mapInput(4),setup:{now:20000,recentRival:{age}},players:[{faction:'holy',at:pt(4,8),state:{hp:0.01,maxHp:100}},{faction:'fire',at:pt(30,8)}],actions:[{kind:'burn',dtMs:50}]});
add('ember-mixed-pass',{map:mapInput(4),players:[{faction:'holy',at:pt(4,8),state:{hp:0.05,maxHp:100}},{faction:'fire',at:pt(30,8)}],actions:[{kind:'burn',dtMs:50,hits:[{raw:0.3}]}]});
for(const gatesLocked of [false,true])add(`ember-mob-filters-locked-${gatesLocked}`,{map:mapInput(4),setup:{gatesLocked},mobs:[...['fire','plague','frost','holy','sentenced'].map((faction,i)=>({faction,at:pt(5+i*7,15)})),{faction:'frost',at:pt(7,22),mode:'return'},{kind:'dummy',at:pt(10,22)}],actions:[{kind:'burn',dtMs:50}]});
for(const resist of [-0.1,0,0.4,1,1.1])for(const base of [1,0.1,0])add(`bog-resist-${resist}-base-${base}`,{map:mapInput(5),players:[{faction:'fire',at:pt(4,8),path:[pt(20,8)],rows:[{k:'stat',stat:'slowResist',v:resist}]}],actions:[{kind:'bog',dtMs:12.5,base},{kind:'step',dtMs:12.5}]});
for(const signatures of [false,true])for(const clock of ['terrain','faction','both'])for(const age of [2999.999999,3000,3000.000001]){if(!signatures&&clock!=='terrain')continue;add(`light-lock-${signatures}-${clock}-${age}`,{map:mapInput(7),signatures,setup:{now:10000},players:[{faction:'fire',at:pt(4,8),state:{hp:50,maxHp:100}}],actions:[{kind:'light',dtMs:12.5,...(clock!=='faction'?{terrainClock:[['p0',10000-age]]}:{}),...(clock!=='terrain'?{factionClock:[['p0',10000-age]]}:{})}]});}
for(const sum of [0.499999999,0.5,0.500000001])for(const age of [999.999999,1000])add(`light-fx-${sum}-${age}`,{map:mapInput(7),setup:{now:10000},players:[{faction:'fire',at:pt(4,8),state:{hp:100,maxHp:100}}],actions:[{kind:'light',dtMs:0,lightSince:10000-age,lightAcc:[['p0',sum]]}]});
add('light-dead-report',{map:mapInput(7),setup:{now:10000},players:[{faction:'fire',at:pt(4,8),state:{status:'dead'}}],actions:[{kind:'light',dtMs:0,lightSince:9000,lightAcc:[['p0',2]]}]});
add('light-players-only-landed-stamps',{map:mapInput(7),setup:{now:10000},players:[{faction:'fire',at:pt(4,8),state:{hp:50,maxHp:100}},{faction:'holy',at:pt(30,8),state:{hp:50,maxHp:100}}],mobs:[{faction:'holy',at:pt(10,15),state:{hp:10}},{kind:'dummy',at:pt(20,15),state:{hp:10}}],actions:[{kind:'light',dtMs:50,landed:[{victim:'p0',by:'p1',amount:1}]},{kind:'light',now:13000,dtMs:50}]});
for(const kind of ['teleported','raidStarted'])add(`reset-${kind}`,{map:mapInput(6),mobs:[{faction:'frost',at:pt(10,15)}],actions:[{kind}]});
add('walk-history-carry-and-regrip',{map:mapInput(6,'stripe'),players:[{faction:'fire',at:{x:tc(11)-2,y:tc(8)},history:[{t:-50,x:tc(11)-10.5,y:tc(8)},{t:0,x:tc(11)-2,y:tc(8)}],path:[pt(22,8)]}],actions:Array.from({length:10},(_,i)=>({kind:'walk',now:(i+1)*50,dtMs:50}))});
for(const kind of [4,5,7])add(`ordinary-world-${kind}`,{production:true,map:mapInput(kind),players:['frost','fire','holy'].map((faction,i)=>({faction,at:pt(4+i*12,8),state:{hp:50,maxHp:100}})),actions:Array.from({length:24},(_,i)=>({kind:'step',dtMs:50,inputs:i===0?[{id:'p0',type:'move',payload:pt(8,8)}]:[]}))});
add('light-overheal-and-heal-mods',{map:mapInput(7),setup:{now:10000},players:[{faction:'holy',at:pt(4,8),state:{hp:99.9,maxHp:100},rows:[{k:'stat',stat:'healTaken',v:0.25}]},{faction:'fire',at:pt(30,8),state:{hp:50,maxHp:100},rows:[{k:'stat',stat:'healTaken',v:-1}]}],actions:[{kind:'light',dtMs:1000},{kind:'light',now:11000,dtMs:1000}]});
add('ember-ordinary-recent-credit',{production:true,map:mapInput(4),setup:{recentRival:{age:4950}},players:[{faction:'holy',at:pt(4,8),state:{hp:0.01,maxHp:100}},{faction:'fire',at:pt(30,8)}],actions:[{kind:'step',dtMs:50}]});
const runtimeCases=runtimeInputs.map(input=>{const{w,tape,constructor}=rig(input);const frames=[frame(w,'setup')];for(let i=0;i<input.actions.length;i++){action(w,input.actions[i]);frames.push(frame(w,'action-'+i));}return{name:input.name,input,constructor,frames,random:{algorithm:'actual shared mulberry32(3); complete draws in consumption order',draws:tape}}});
const surfaceCases:any[]=[];for(let kind=0;kind<8;kind++)for(const faction of ['','fire','plague','frost','holy','sentenced'])surfaceCases.push({name:`kind-${kind}-${faction||'neutral'}`,input:{kind,faction},expected:S.surfaceEffect(kind,faction)});
for(const x of [-1e-9,0,31.999999999,32,32.000000001,48*32-1e-9,48*32]){const map=makeMap(mapInput(6));surfaceCases.push({name:`point-${x}`,input:{map:mapInput(6),x,y:tc(8),faction:'fire'},expected:{terrain:S.terrainAt(map,x,tc(8)),effect:S.surfaceAt(map,x,tc(8),'fire'),hazards:S.hazardsOf(map)}});}
const walkInputs:any[]=[];
function walkCase(name:string,o:any){walkInputs.push({name,map:mapInput(6),body:{x:100,y:600},velocity:{x:0,y:0},path:[{x:1000,y:600}],radius:S.PLAYER_RADIUS,...o});}
walkCase('accelerate-eight',{actions:Array.from({length:8},(_,i)=>({dtMs:50,now:(i+1)*50,cap:170}))});
walkCase('stop-eight',{velocity:{x:170,y:0},path:[],actions:Array.from({length:9},(_,i)=>({dtMs:50,now:(i+1)*50,cap:170}))});
walkCase('turn-root-replace',{velocity:{x:170,y:0},actions:[{dtMs:12.5,now:12.5,cap:170,pathReplacement:[{x:100,y:1000}]},{dtMs:37.5,now:50,cap:0},{dtMs:50,now:100,cap:170},{dtMs:75.25,now:175.25,cap:340,pathReplacement:[{x:500,y:900}]}]});
walkCase('arrive-short',{velocity:{x:170,y:0},path:[{x:110,y:600}],actions:Array.from({length:50},(_,i)=>({dtMs:50,now:(i+1)*50,cap:170}))});
walkCase('surface-crossing-substeps',{body:{x:12*32-2,y:tc(8)},velocity:{x:170,y:0},map:mapInput(6,'stripe'),actions:[{dtMs:225.5,now:225.5,cap:170},{dtMs:50,now:275.5,cap:170}]});
walkCase('collision-replan',{map:mapInput(6,'wall'),body:{x:30*32-S.PLAYER_RADIUS-1,y:20*32},velocity:{x:170,y:0},path:[{x:40*32,y:20*32}],actions:[{dtMs:50,now:5000,cap:170},{dtMs:50,now:5100,cap:170},{dtMs:50,now:5250,cap:170}]});
walkCase('junction-grip-continuation',{map:{...mapInput(6,'junction'),w:24,h:16},body:pt(3,5),goal:pt(10,12),plan:true,actions:Array.from({length:150},(_,i)=>({dtMs:50,now:(i+1)*50,cap:170}))});
walkCase('clock-back-clamps-grip',{slip:{gripUntil:1e9},actions:[{dtMs:50,now:2000,cap:170},{dtMs:50,now:3000,cap:170}]});
for(const now of [4999.999999,5000,5000.000001])walkCase(`replan-boundary-${now}`,{map:mapInput(6,'wall'),body:{x:30*32-S.PLAYER_RADIUS-1,y:20*32},velocity:{x:170,y:0},path:[{x:40*32,y:20*32}],slip:{replanAt:5000},actions:[{dtMs:50,now,cap:170}]});
const walkCases=walkInputs.map(input=>{const map=makeMap(input.map),p=copy(input.body);let path=input.plan?S.findPath(map,p,input.goal,input.radius):copy(input.path);const s={...S.newSlip(p.x,p.y,input.velocity.x,input.velocity.y),...input.slip};const snap=(label:string,result:any=null)=>plain({label,body:p,slip:{...s,path:s.path===path?'current':s.path===null?null:'other'},path,result});const frames=[snap('setup')];for(let i=0;i<input.actions.length;i++){const a=input.actions[i];if(a.pathReplacement)path=copy(a.pathReplacement);const result=S.slipWalk(map,p,s,path,a.dtMs,a.cap,(x,y)=>S.surfaceAt(map,x,y,'fire').accel,a.now,input.radius);frames.push(snap('action-'+i,result));}return{name:input.name,input,frames};});
const regripCases:any[]=[];for(const path of [[],[{x:600,y:600}],[{x:1280,y:600}],[{x:960,y:100}],[{x:1280,y:600},{x:1400,y:100}]]){const map=makeMap(mapInput(0,'wall')),p={x:900,y:600},actual=copy(path);const result=S.regrip(map,p,actual);regripCases.push({input:{map:mapInput(0,'wall'),body:p,path},expected:{path:result,sameArray:actual===result}});}
const mathCases:any[]=[];for(const ms of [0,-1,1e-9,399.999999999,400,400.000000001,1000])mathCases.push({function:'slipAccel',input:{ms},expected:S.slipAccel(ms)});for(const speedMult of [0,0.35,0.7,1,1.1])for(const resist of [-0.1,0,0.4,1,1.1])mathCases.push({function:'resistSlow',input:{speedMult,resist},expected:S.resistSlow(speedMult,resist)});
const velocityCases=[[],[{t:0,x:1,y:2}],[{t:0,x:1,y:2},{t:50,x:9.5,y:2}],[{t:1,x:1,y:2},{t:1,x:9,y:3}],[{t:1,x:1,y:2},{t:0,x:9,y:3}],[{t:0,x:1,y:2},{t:12.5,x:3.125,y:1}]].map(history=>({input:{history},expected:tickVelocity(history)}));
const sweepCases:any[]=[];const sm=makeMap(mapInput(0,'wall'));for(const axis of ['x','y'])for(const delta of [-2000,-32,-1e-9,0,1e-9,32,2000])for(const gap of [0,11.999999999,12,12.000000001]){const p={x:29*32,y:3*32-gap};sweepCases.push({input:{map:mapInput(0,'wall'),axis,...p,delta,radius:12},expected:axis==='x'?S.sweepX(sm,p.x,p.y,delta,12):S.sweepY(sm,p.x,p.y,delta,12)});}
function sourceFiles(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?sourceFiles(dir+'/'+e.name):e.name.endsWith('.ts')?[dir+'/'+e.name]:[])}
const files=[...sourceFiles('packages/shared/src'),...sourceFiles('packages/server/src/sim'),'package-lock.json','tsconfig.base.json','tools/terrain-fixtures/capture.mts'];const sourceSha256=Object.fromEntries(files.sort().map(p=>[p,sha(readFileSync(p))]));
const output={format:'rh-terrain-source/1',provenance:{revision:'d00e5e52f0b981c7c8afb6c721ddcaae7d29864b',node:process.version,platform:process.platform,arch:process.arch,image:'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',compiler:{tsx:JSON.parse(readFileSync('node_modules/tsx/package.json','utf8')).version,typescript:JSON.parse(readFileSync('node_modules/typescript/package.json','utf8')).version,target:'ES2022',mode:'tsx source execution'},sourceSha256},roles:{input:'Declared trusted setup plus ordered actual source calls; ordinary-world cases call actual complete production assembler and step. Signature setups initialize their private source runtime with installed afterWeapons(0); bog base is an explicitly installed trusted movement modifier and floor is witnessed through actual step displacement.',expected:'Actual legacy source output only; never computed from Rust.',private:'constructor, RNG draws, runtime paths/history/slip/ledger/clocks/credit/stats are server-private parity evidence, not client data.',nonfinite:'Non-finite numbers encoded as exact strings.',rng:'All runs use deterministic explicit mulberry32(3) tape; draws recorded in exact order; reward=[1,2,3,4],quest=[5,6,7,8]; no entropy sources.',prerequisiteGaps:['Full Frost/Sentenced regional NPC cases captured even where native constructor admission is not yet implemented.','Locked arena gate behavior captured even where native arena/gate runtime is not admitted.']},surfaceCases,runtimeCases,walkCases,velocityCases,sweepCases,regripCases,mathCases};
const text=JSON.stringify(output)+'\n';const out=process.env.RH_TERRAIN_OUTPUT??'parity/terrain/source.json';if(process.argv.includes('--check'))assert.equal(readFileSync(out,'utf8'),text,'canonical actual-source recapture differs');else writeFileSync(out,text);console.log(JSON.stringify({runtimeCases:runtimeCases.length,runtimeFrames:runtimeCases.reduce((a,c)=>a+c.frames.length,0),walkCases:walkCases.length,walkFrames:walkCases.reduce((a,c)=>a+c.frames.length,0),surfaceCases:surfaceCases.length,velocityCases:velocityCases.length,sweepCases:sweepCases.length,bytes:Buffer.byteLength(text),sha256:sha(text),check:process.argv.includes('--check')}));

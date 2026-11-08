// Canonical actual-source P-OVERKILL-PRODUCER-SOURCE capture: ordinary queued attacks/barriers/hook rows in the pinned
// linux/amd64 Node 22.23.4 container. Declared setup only; no expected barrier/damage/death/hook payload/RNG is installed.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {mulberry32} from '/repo/packages/shared/src/index.ts';
import {generateMap} from '/repo/packages/shared/src/mapgen.ts';
import {TERRAIN_EMBER} from '/repo/packages/shared/src/terrain.ts';
import {TILE} from '/repo/packages/shared/src/constants.ts';
import {createGameWorld} from '/repo/packages/server/src/sim/gameplay.ts';
import {addPlayer, step} from '/repo/packages/server/src/sim/step.ts';
import {enqueueClientMessage} from '/repo/packages/server/src/sim/inputs.ts';
import {grantCard} from '/repo/packages/server/src/sim/chests.ts';
import {combatant} from '/repo/packages/server/src/sim/combatant.ts';
import {heal} from '/repo/packages/server/src/sim/factions.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string');
const [, outDir] = args;
assert.equal(process.version, 'v22.23.4'); assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
const TICK_MS = 50; const SEED = 1; const ATTEMPT = 0; const RANDOM_SEED = 12; const REWARD_SALT = [1,2,3,4];
const PLAYERS = [{faction:'holy',name:'a0'},{faction:'holy',name:'a1'},{faction:'fire',name:'victim'},{faction:'plague',name:'seat3'}];
const CONFIG = {minPlayers:4,lobbySeconds:30,fillSeconds:0,patienceSeconds:3600,patienceMinSeconds:3600,
  suddenDeathSeconds:3600,mobs:false,signatures:true,quests:false,training:false,dummies:false,planSeconds:0,pvpRules:false};
const r6=(v:any):any=>typeof v==='number'&&Number.isFinite(v)?Math.round(v*1e6)/1e6:v;
const ang=(fx:number,fy:number,tx:number,ty:number)=>Math.atan2(ty-fy,tx-fx);

function open(mapSeed=1):any{
  const map:any=generateMap(mapSeed,ATTEMPT,{decor:false}); let uid=0;
  const w:any=createGameWorld({seed:mapSeed,map,config:CONFIG,random:mulberry32(RANDOM_SEED),rewardSalt:REWARD_SALT,newItemUid:()=> 'U'+ ++uid},{signatures:true,walkHints:false});
  for(let i=0;i<PLAYERS.length;i++) addPlayer(w,'p'+i,PLAYERS[i].name,{faction:PLAYERS[i].faction as any});
  step(w,TICK_MS); assert.equal(w.state.phase,'active'); return w;
}
function runner(name:string,mapSeed=1){
  const w=open(mapSeed); const actions:any[]=[]; const frames:any[]=[]; let seq=0; const hookSeq:any[]=[];
  const hookTap:any={hitLanded:[],overkilled:[],hurt:[],fighterOut:[]};
  for(const k of ['hitLanded','overkilled','hurt','fighterOut']){const prev=(w.hooks as any)[k]; (w.hooks as any)[k]=(...a:any[])=>{
    const row:any={hook:k,tick:w.state.tick,time:w.state.serverTime};
    if(k==='hitLanded'){const e=a[1];row.entry={victim:e.victim,by:e.by.id,raw:r6(e.packet?.raw??0),weapon:e.weapon??null,arena:!!e.arena,scale:e.scale??1,ability:e.ability??null,sig:e.sig??null};row.amount=r6(a[2]);}
    else if(k==='overkilled'){const victim=a[1],hits=a[2];row.victim=victim.id;row.overkill=r6(a[3]);row.total=r6(a[4]);row.hits=hits.map((h:any)=>({by:h.entry.by.id,victim:h.entry.victim,amount:r6(h.amount),raw:r6(h.raw),weapon:h.entry.weapon??null,arena:!!h.entry.arena,sig:h.entry.sig??null}));}
    else {row.actor=a[1]?.id??a[1]??null;row.args=a.slice(2).map((x:any)=>typeof x==='number'?r6(x):(x?.id??null));}
    hookTap[k].push(row); hookSeq.push(row); return prev?.(...a);
  }; }
  w.beforeDamage.push((ww:any)=>{ for(const e of ww.combat.ledger??[]) hookTap.hitLanded.push({hook:'ledger',tick:ww.state.tick,time:ww.state.serverTime,entry:{victim:e.victim,by:e.by.id,raw:r6(e.packet?.raw??0),weapon:e.weapon??null,arena:!!e.arena,scale:e.scale??1,ability:e.ability??null,sig:e.sig??null},amount:null}); });
  const push=(kind:string,extra:any)=>actions.push({tick:w.state.tick,seq:seq++,kind,...extra});
  const place=(a:string,x:number,y:number)=>{const s=w.state.players.get(a)!;s.x=x;s.y=y;s.facing=0;w.players.get(a)!.history=[{t:w.state.serverTime,x,y}];push('place',{actor:Number(a.slice(1)),x,y});};
  const setHp=(a:string,hp:number,maxHp?:number)=>{const s=w.state.players.get(a)!;s.hp=hp;if(maxHp!==undefined)s.maxHp=maxHp;push('setHp',{actor:Number(a.slice(1)),hp,maxHp:maxHp??null});};
  const setWeapon=(a:string,weapon:string)=>{const s=w.state.players.get(a)!;s.weapon0=weapon;s.weapon1='';s.slot=0;push('weapon',{actor:Number(a.slice(1)),weapon});};
  const grant=(a:string,card:string)=>{assert.ok(grantCard(w,combatant(w,a) as any,card));push('grantCard',{actor:Number(a.slice(1)),card});};
  const healOn=(a:string,amount:number)=>{const gained=heal(w,combatant(w,a) as any,amount,{ignoreLockout:true});push('heal',{actor:Number(a.slice(1)),amount,gained:r6(gained)});return gained;};
  const attack=(a:string,target:string)=>{const s=w.state.players.get(a)!;const t=w.state.players.get(target)!;assert.equal(enqueueClientMessage(w.players.get(a)!.inputs,'attack',{a:ang(s.x,s.y,t.x,t.y)}),true);push('input',{actor:Number(a.slice(1)),type:'attack',payload:{target}});};
  const player=(a:string)=>{const s=w.state.players.get(a);if(!s)return null;return {id:Number(a.slice(1)),faction:s.faction,x:r6(s.x),y:r6(s.y),hp:r6(s.hp),maxHp:r6(s.maxHp),barrier:r6(s.barrier),status:s.status,weapon0:s.weapon0,immuneUntil:r6(s.immuneUntil??0)};};
  const snap=(label:string)=>{frames.push({label,actionCount:actions.length,tick:w.state.tick,time:r6(w.state.serverTime),phase:w.state.phase,idCounter:w.idCounter,world:{players:PLAYERS.map((_,i)=>player('p'+i)),mobs:[...w.state.mobs].map(([id,m]:any)=>({id,kind:m.kind,faction:m.faction,x:r6(m.x),y:r6(m.y),hp:r6(m.hp),maxHp:r6(m.maxHp),barrier:r6(m.barrier??0),status:m.status}))},hooks:{...hookTap,hitLanded:hookTap.hitLanded.splice(0),overkilled:hookTap.overkilled.splice(0),hurt:hookTap.hurt.splice(0),hookOrder:hookSeq.splice(0)}});};
  const runSteps=(n:number)=>{for(let i=0;i<n;i++)step(w,TICK_MS);};
  const initial=PLAYERS.map((_,i)=>{const s=w.state.players.get('p'+i)!;return {x:r6(s.x),y:r6(s.y),faction:s.faction};});
  const output=(script:any)=>({input:{name,map:{seed:mapSeed,attempt:ATTEMPT,decor:false},config:CONFIG,players:PLAYERS,initial,seeds:{random:RANDOM_SEED,rewardSalt:REWARD_SALT},diagnostics:[{name:'read-only hitLanded/overkilled/hurt hook taps plus beforeDamage ledger tap',writesWorld:false}]},script,actions,frames});
  snap('start'); return {w,place,setHp,setWeapon,grant,healOn,attack,snap,runSteps,output,frames,actions,push};
}
const cases:any[]=[];

// 1. Ordinary lethal positive excess with no barrier; a surviving control also runs after the kill.
{const r=runner('lethal-no-barrier');r.setHp('p2',1,300);r.setWeapon('p0','sword');r.place('p0',370,320);r.place('p2',400,320);r.snap('setup');r.attack('p0','p2');r.snap('attack');r.runSteps(80);r.snap('after');cases.push(r.output({victim:'p2',attacker:'p0'}));}

// 2. Genuinely earned Second Skin barrier absorbs a low-damage attack: no HP damage, no Overkilled.
{const r=runner('barrier-absorbs-no-hp-damage');r.grant('p2','leech1');r.grant('p2','secondSkin');r.healOn('p2',1000);r.setHp('p2',1,300);r.setWeapon('p0','wand');r.place('p0',500,320);r.place('p2',400,320);r.snap('barrier-up');r.attack('p0','p2');r.snap('attack');r.runSteps(20);r.snap('after');cases.push(r.output({victim:'p2',attacker:'p0',earnedBarrier:'grant leech1 + secondSkin, then real heal() 1000'}));}

// 3. Genuine earned barrier plus lethal HP damage: absorbed/applied separate, residual excess captured.
{const r=runner('barrier-lethal');r.grant('p2','leech1');r.grant('p2','secondSkin');r.healOn('p2',100);r.setHp('p2',1,300);r.setWeapon('p0','sword');r.place('p0',370,320);r.place('p2',400,320);r.snap('barrier-up');r.attack('p0','p2');r.snap('attack');r.runSteps(80);r.snap('after');cases.push(r.output({victim:'p2',attacker:'p0',earnedBarrier:'grant leech1 + secondSkin, then real heal() 100'}));}

// 4. Multiple real contributions in one pass: two ordinary attackers, exact entry/hit order and rows.
{const r=runner('multi-contribution');r.setHp('p2',1,300);r.setWeapon('p0','sword');r.setWeapon('p1','sword');r.place('p0',370,320);r.place('p1',400,290);r.place('p2',400,320);r.snap('setup');r.attack('p0','p2');r.attack('p1','p2');r.snap('attack');r.runSteps(80);r.snap('after');cases.push(r.output({victim:'p2',attackers:['p0','p1']}));}

// 5. Arena/terrain contribution alongside an ordinary attack, when the generated map has an Embers tile.
{let r=null;let tile=null;for(const seed of [1,2,3,4,5,6,7,8]){const c=runner('arena-contribution',seed);let found=null;for(let ty=1;ty<c.w.map.h-1&&!found;ty++)for(let tx=1;tx<c.w.map.w-1&&!found;tx++)if(c.w.map.terrain[ty*c.w.map.w+tx]===TERRAIN_EMBER)found={tx,ty};if(found){r=c;tile=found;break;}}if(r&&tile){const x=(tile.tx+0.5)*TILE,y=(tile.ty+0.5)*TILE;r.setHp('p1',1,300);r.setWeapon('p0','sword');r.place('p1',x,y);r.place('p0',x-30,y);r.snap('setup');r.attack('p0','p1');r.snap('attack');r.runSteps(80);r.snap('after');cases.push(r.output({victim:'p1',attacker:'p0',arenaTile:tile,mapSeed:r.w.map.seed}));}else{console.error('NO_EMBER_TILE');}}

const sourceFiles=['packages/shared/src','packages/server/src/sim'].flatMap((dir:string)=>readdirSync('/repo/'+dir,{recursive:true}).filter((p:string)=>p.endsWith('.ts')).map((p:string)=>dir+'/'+p));
const fileSha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const body={format:'rh-overkill-producer-source/1',provenance:{image:'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',platform:'linux/amd64',node:process.version,config:CONFIG,players:PLAYERS,seeds:{random:RANDOM_SEED,rewardSalt:REWARD_SALT},tools:{captureMts:fileSha('/repo/tools/overkill-producer-fixtures/capture.mts'),captureSh:fileSha('/repo/tools/overkill-producer-fixtures/capture.sh'),runMutantsSh:fileSha('/repo/tools/overkill-producer-fixtures/run-mutants.sh'),packageLock:fileSha('/repo/package-lock.json')},sourceSha256:Object.fromEntries(sourceFiles.map((p:string)=>[p,fileSha('/repo/'+p)]))},cases};
const text=JSON.stringify(body,null,1)+'\n';const sha=createHash('sha256').update(text).digest('hex');
if(args[0]==='--write'){mkdirSync(outDir,{recursive:true});writeFileSync(join(outDir,'source.json'),text);console.log(JSON.stringify({written:outDir,bytes:Buffer.byteLength(text),sha256:sha,cases:cases.length}));}
else{assert.equal(text,readFileSync(join(outDir,'source.json'),'utf8'),'capture --check requires identical bytes');console.log(JSON.stringify({checked:outDir,bytes:Buffer.byteLength(text),sha256:sha,cases:cases.length}));}

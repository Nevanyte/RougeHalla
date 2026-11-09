// Additive supplemental actual-source P-SENTENCED-NPC-GROUP capture: sibling death/shrink, focus handoff/Return/leash and Trial.
// Pinned linux/amd64 Node 22.23.4; declared map/player setup; a labelled read-only ledger tap records actual signature
// pulses. No Mark target/group/size/hits/progress/tier/pool/denial/ledger outcome is installed.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {mulberry32} from '/repo/packages/shared/src/index.ts';
import {generateMap} from '/repo/packages/shared/src/mapgen.ts';
import {createGameWorld} from '/repo/packages/server/src/sim/gameplay.ts';
import {addPlayer, step} from '/repo/packages/server/src/sim/step.ts';
import {enqueueClientMessage} from '/repo/packages/server/src/sim/inputs.ts';
import {grantCard} from '/repo/packages/server/src/sim/chests.ts';
import {combatant, standingCombatants} from '/repo/packages/server/src/sim/combatant.ts';
import {signatureState} from '/repo/packages/server/src/sim/factions.ts';
import {installTraining} from '/repo/packages/server/src/sim/training.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string');
const [, outDir] = args;
assert.equal(process.version, 'v22.23.4'); assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
const TICK_MS = 50; const RANDOM_SEED = 12; const REWARD_SALT = [1,2,3,4];
const PLAYERS = [{faction:'sentenced', name:'p0'}, {faction:'holy', name:'p1'}, {faction:'sentenced', name:'p2'}];
const CONFIG = {minPlayers:2, lobbySeconds:30, fillSeconds:0, patienceSeconds:3600, patienceMinSeconds:3600,
  suddenDeathSeconds:3600, mobs:true, signatures:true, quests:false, training:false, dummies:false, planSeconds:0, pvpRules:false, wishLockSeconds:0};
const r6 = (v: any): any => typeof v === 'number' && Number.isFinite(v) ? Math.round(v*1e6)/1e6 : null;
const ang = (fx: number, fy: number, tx: number, ty: number): number => Math.atan2(ty-fy, tx-fx);

function open(training = false): any {
  const map: any = generateMap(1, 0, {decor:false}); let uid = 0;
  const config = training ? {...CONFIG, training:true, dummies:true, minPlayers:2, lobbySeconds:0} : CONFIG;
  const w: any = createGameWorld({seed:1, map, config, random:mulberry32(RANDOM_SEED), rewardSalt:REWARD_SALT,
    newItemUid:()=> 'U'+ ++uid}, {signatures:true, walkHints:false});
  if (training) installTraining(w);
  for (let i=0;i<PLAYERS.length;i++) addPlayer(w,'p'+i,PLAYERS[i].name,{faction:PLAYERS[i].faction as any});
  step(w,TICK_MS);
  assert.equal(w.state.phase,'active');
  return w;
}

function runner(name: string, opts: {training?: boolean} = {}) {
  const w = open(opts.training === true); const actions: any[] = []; const frames: any[] = []; let seq = 0;
  const pendingEvents: any[] = []; const ledgerTap: any[] = []; const watched = new Set<string>();
  const watch = (ids: string[]) => { for (const id of ids) watched.add(id); };
  w.beforeDamage.push((ww: any) => { for (const e of ww.combat.ledger ?? []) if (e.sig === 'mark' || e.arena) ledgerTap.push({
    victim:e.victim, by: typeof e.by === 'string' ? e.by : e.by?.id ?? null, sig:e.sig ?? null, raw:r6(e.packet?.raw ?? 0),
    weapon:e.weapon ?? null, arena:!!e.arena, group: e.markGroup ?? null, scale:e.scale ?? 1}); });
  const push=(kind:string,extra:any)=>{actions.push({tick:w.state.tick,seq:seq++,kind,...extra});};
  const place=(actor:string,x:number,y:number)=>{const s=w.state.players.get(actor)!;s.x=x;s.y=y;s.facing=0;w.players.get(actor)!.history=[{t:w.state.serverTime,x,y}];push('place',{actor:Number(actor.slice(1)),x,y});};
  const setHp=(actor:string,hp:number)=>{const s=w.state.players.get(actor)!;s.hp=hp;s.maxHp=hp;push('hp',{actor:Number(actor.slice(1)),hp});};
  const setWeapon=(actor:string,wep:string)=>{const s=w.state.players.get(actor)!;s.weapon0=wep;s.slot=0;push('weapon',{actor:Number(actor.slice(1)),weapon:wep});};
  const enqueue=(actor:string,type:string,payload:any)=>{assert.equal(enqueueClientMessage(w.players.get(actor)!.inputs,type,payload),true,'source accepted '+type);push('input',{actor:Number(actor.slice(1)),type,payload});};
  const grant=(actor:string,card:string)=>{assert.ok(grantCard(w,combatant(w,actor) as any,card));push('grantCard',{actor:Number(actor.slice(1)),card});};
  const fighter=(id:string)=>{const f=signatureState(w,id); if(!f)return null; return {id,target:f.target,group:f.markGroup,groupSize:f.markGroupSize,tier:f.tier,hits:f.markHits,progress:r6(f.markProgress),swaps:f.markSwaps,chill:r6(f.chill),denied:f.markDenied,ampUntil:r6(f.ampUntil)};};
  const mob=(id:string)=>{const m=w.state.mobs.get(id); if(!m)return null; const rt=w.mobs.get(id); return {id,kind:m.kind,faction:m.faction,camp:m.camp,x:r6(m.x),y:r6(m.y),hp:r6(m.hp),maxHp:r6(m.maxHp),status:m.status,weapon0:m.weapon0,type:m.type,brain:rt?.brain?{mode:rt.brain.mode,region:rt.brain.region??null,elite:!!rt.brain.elite}:null,statuses:(rt?.statuses??[]).map((st:any)=>st.kind)};};
  const player=(id:string)=>{const s=w.state.players.get(id); if(!s)return null; return {id,faction:s.faction,x:r6(s.x),y:r6(s.y),hp:r6(s.hp),maxHp:r6(s.maxHp),status:s.status,weapon0:s.weapon0,statuses:(w.players.get(id)!.statuses??[]).map((st:any)=>st.kind)};};
  const repeatAttack=(actor:string,target:string,ticks:number,every=10)=>{ for(let i=0;i<ticks;i++){ if(i%every===0){ const t=w.state.mobs.get(target)??w.state.players.get(target); if(!t) break; const s=w.state.players.get(actor)!; enqueue(actor,'attack',{a:ang(s.x,s.y,t.x,t.y)}); } runSteps(1); } };
  const snap=(label:string)=>{
    const players=PLAYERS.map((_,i)=>player('p'+i));
    const tracked=[...w.state.mobs].filter(([,m]:any)=>m.kind==='mob'||m.kind==='elite').map(([id]:any)=>id);
    frames.push({label,actionCount:actions.length,tick:w.state.tick,time:r6(w.state.serverTime),idCounter:w.idCounter,
      players, mobs:[...watched].map(mob), fighters:[...players.map((p:any)=>p.id), ...watched].map(fighter),
      pulses:ledgerTap.splice(0), events:pendingEvents.splice(0),
      camps:[...w.map.camps].map((c:any,i:number)=>({i:i+1,x:r6(c.x),y:r6(c.y),zone:c.zone,radius:r6(c.radius)}))});
  };
  const runSteps=(n:number)=>{for(let i=0;i<n;i++){const ev=step(w,TICK_MS); if(Array.isArray(ev)) pendingEvents.push(...ev);}};
  snap('start');
  const initial=PLAYERS.map((_,i)=>{const s=w.state.players.get('p'+i)!;return {x:r6(s.x),y:r6(s.y),faction:s.faction};});
  const output=(script:any)=>({input:{name,map:{seed:1,attempt:0,decor:false},config:{...CONFIG,training:opts.training===true,dummies:opts.training===true,lobbySeconds:opts.training?0:30},modules:{signatures:true,walkHints:false},players:PLAYERS,initial,seeds:{random:RANDOM_SEED,rewardSalt:REWARD_SALT},diagnostics:[{name:'read-only mark/arena ledger tap at beforeDamage',writesWorld:false}]},script,actions,frames});
  return {w,place,setHp,setWeapon,enqueue,grant,mob,player,fighter,snap,runSteps,output,frames,actions,push,watch,repeatAttack};
}

function camps(w:any): any[] {
  const groups=new Map<string,any[]>();
  for(const [id,m] of w.state.mobs){ if((m.kind!=='mob'&&m.kind!=='elite')||m.camp<=0)continue; const k=String(m.camp); if(!groups.has(k))groups.set(k,[]); groups.get(k)!.push({id,state:m}); }
  return [...groups].map(([camp,members])=>({camp:Number(camp),members,zone:members[0].state.faction,alive:members.filter((x:any)=>x.state.status==='alive')}));
}
function pickCamp(w:any, min=3, faction?:string){ const cs=camps(w).filter(c=>c.alive.length>=min && (!faction||c.zone===faction)); return cs[0]??null; }
const cases:any[]=[];
function strike(r:any, actor:string, target:string, ticks:number, every=6) {
  for (let i=0;i<ticks;i++) { if (i%every===0) { const t=r.w.state.mobs.get(target); if(!t) break; const s=r.w.state.players.get(actor)!; r.enqueue(actor,'attack',{a:ang(s.x,s.y,t.x,t.y)}); } r.runSteps(1); }
}
function holyMember(w:any, role:string):any {
  const cs=camps(w).filter((c:any)=>c.zone==='holy'&&c.alive.length>=2);
  for (const c of cs) for (const m of c.alive) { const wep=m.state.weapon0; const melee=['sword','axe','fists','shield'].includes(wep); const ranged=['bow','wand'].includes(wep); if((role==='melee'&&melee)||(role==='ranged'&&ranged)) return {camp:c,m}; }
  return null;
}

// Seam A component cases: a real Holy (non-Sentenced) camp NPC as the Mark target/component; the Sentenced player owns the Mark.
// The NPC's own fighter record is captured to show that the non-Sentenced NPC owns no Mark (source Mark ownership is Sentenced-only).
for (const role of ['melee','ranged']) {
  const r=runner('holy-npc-'+role+'-component'); const chosen=holyMember(r.w,role); assert.ok(chosen,'a real Holy '+role+' camp NPC (non-Sentenced human faction)');
  const npc=chosen.m; r.watch([npc.id, ...chosen.camp.alive.map((m:any)=>m.id)]);
  r.setHp('p0',5000); r.setWeapon('p0',role==='melee'?'sword':'bow');
  r.place('p0', npc.state.x+80, npc.state.y); r.snap('placed');
  strike(r,'p0',npc.id,120,6); r.snap('after');
  const owner=r.frames[r.frames.length-1].fighters.find((f:any)=>f&&f.id==='p0');
  const target=r.frames[r.frames.length-1].fighters.find((f:any)=>f&&f.id===npc.id);
  cases.push(r.output({camp:chosen.camp.camp,npc:npc.id,npcWeapon:npc.state.weapon0,npcFaction:npc.state.faction,role,playerMarkOwner:owner??null,npcMarkOwner:target??null}));
}

const sourceFiles=['packages/shared/src','packages/server/src/sim'].flatMap((dir:string)=>readdirSync('/repo/'+dir,{recursive:true}).filter((p:string)=>p.endsWith('.ts')).map((p:string)=>dir+'/'+p));
const fileSha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const body={format:'rh-sentenced-npc-group-holy-components/1',provenance:{image:'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',platform:'linux/amd64',node:process.version,profile:'real-createGameWorld/mobs/signatures',players:PLAYERS,config:CONFIG,seeds:{random:RANDOM_SEED,rewardSalt:REWARD_SALT},tools:{captureMts:fileSha('/repo/tools/sentenced-npc-group-fixtures/capture-holy.mts'),captureSh:fileSha('/repo/tools/sentenced-npc-group-fixtures/capture-holy.sh'),runMutantsSh:fileSha('/repo/tools/sentenced-npc-group-fixtures/run-holy-mutants.sh'),packageLock:fileSha('/repo/package-lock.json')},sourceSha256:Object.fromEntries(sourceFiles.map((p:string)=>[p,fileSha('/repo/'+p)])),existingCorporaReference:{runtimeMatrix:'parity/sentenced/runtime-matrix.json (existing trusted installed-factions filter/denial probes; not used as ordinary gameplay)',denialMatrix:'parity/sentenced/denial-matrix.json'}},cases};
const text=JSON.stringify(body,null,1)+'\n'; const sha=createHash('sha256').update(text).digest('hex');
if(args[0]==='--write'){mkdirSync(outDir,{recursive:true});writeFileSync(join(outDir,'source-holy-components.json'),text);console.log(JSON.stringify({written:outDir,bytes:Buffer.byteLength(text),sha256:sha,cases:cases.length}));}
else{assert.equal(text,readFileSync(join(outDir,'source-holy-components.json'),'utf8'),'capture --check requires identical bytes');console.log(JSON.stringify({checked:outDir,bytes:Buffer.byteLength(text),sha256:sha,cases:cases.length}));}

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
function strike(r:any, actor:string, target:string, ticks:number, every=8) {
  for (let i=0;i<ticks;i++) { if (i%every===0) { const t=r.w.state.mobs.get(target); if(!t) break; const s=r.w.state.players.get(actor)!; r.enqueue(actor,'attack',{a:ang(s.x,s.y,t.x,t.y)}); } r.runSteps(1); }
}

// (a/b) A second ordinary human attacker kills a real sibling after the Mark captured its original camp size; then focus
// handoff and a real leash/Return window are observed. All kills are real weapon attacks; nothing is installed.
{ const r=runner('sibling-death-shrink-handoff'); const c=pickCamp(r.w,4); assert.ok(c,'a real camp with at least four live members');
  r.watch(c.alive.map((m:any)=>m.id)); r.setHp('p0',50000); r.setHp('p1',50000); r.setHp('p2',50000); r.setWeapon('p0','bow'); r.setWeapon('p2','bow');
  const first=c.alive[0], second=c.alive[1];
  r.place('p0', first.state.x+80, first.state.y); r.place('p2', second.state.x+80, second.state.y); r.snap('placed');
  strike(r,'p0',first.id,12,6); r.snap('mark-original-size');
  const original=r.frames[r.frames.length-1].fighters.find((f:any)=>f&&f.id==='p0'); assert.ok(original && original.groupSize>=4, 'Mark captured the original camp size');
  let dead=false; let killerTarget=second.id;
  for (let i=0;i<1200;i++) {
    if (i%5===0) { const live=[...r.w.state.mobs].filter(([id,m]:any)=>c.alive.some((x:any)=>x.id===id)&&m.status==='alive');
      const p0Target=live.find(([id]:any)=>id!==killerTarget); if(p0Target) strike(r,'p0',p0Target[0],1,1);
      if(r.w.state.mobs.get(killerTarget)?.status==='alive') strike(r,'p2',killerTarget,1,1); else { const other=live[0]; if(other) killerTarget=other[0]; } }
    r.runSteps(1);
    const gone=!r.w.state.mobs.has(second.id)||r.w.state.mobs.get(second.id)?.status!=='alive';
    if(gone && !dead){ dead=true; r.snap('sibling-dead'); }
    if(i%100===0) r.snap('fight-'+i);
    if(dead) break;
  }
  assert.ok(dead,'a real ordinary-attack sibling death was reached'); r.snap('after-death');
  const live=[...r.w.state.mobs].filter(([,m]:any)=>m.kind!=='dummy'&&m.status==='alive');
  const survivor=c.alive.find((m:any)=>r.w.state.mobs.get(m.id)?.status==='alive');
  if(survivor){ r.enqueue('p0','target',{id:survivor.id}); strike(r,'p0',survivor.id,80,8); r.snap('after-handoff'); }
  // Real leash: move the Mark owner far away; the camp AI/brain and the Mark focus are observed, not installed.
  const mover = (r.w.state.players.get('p0')?.status === 'alive') ? 'p0' : 'p2';
  r.enqueue(mover,'move',{x: first.state.x+700, y: first.state.y}); r.runSteps(160); r.snap('leash-return-window');
  cases.push(r.output({camp:c.camp,first:first.id,second:second.id,originalSize:original.groupSize,dead,}));
}

// (c) Real Trial Wish on an UNFOCUSED live camp member while p0's Mark is focused on another member.
{ const r=runner('trial-unfocused-member'); const c=pickCamp(r.w,3); assert.ok(c,'a real camp with at least three live members'); r.watch(c.alive.map((m:any)=>m.id));
  r.setHp('p0',50000); r.setHp('p1',50000); r.setHp('p2',50000); r.setWeapon('p0','bow'); const first=c.alive[0]; const unfocused=c.alive[1];
  r.place('p0', first.state.x+25, first.state.y); r.place('p2', unfocused.state.x+25, unfocused.state.y);
  strike(r,'p0',first.id,16,6); r.snap('focused-mark');
  r.enqueue('p2','cast',{slot:'wish', x:unfocused.state.x, y:unfocused.state.y, id:unfocused.id}); r.runSteps(1); r.snap('trial-cast'); r.runSteps(120); r.snap('trial-after');
  cases.push(r.output({camp:c.camp,focused:first.id,unfocused:unfocused.id,trialCaster:2}));
}

const sourceFiles=['packages/shared/src','packages/server/src/sim'].flatMap((dir:string)=>readdirSync('/repo/'+dir,{recursive:true}).filter((p:string)=>p.endsWith('.ts')).map((p:string)=>dir+'/'+p));
const fileSha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const body={format:'rh-sentenced-npc-group-supplement/1',provenance:{image:'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',platform:'linux/amd64',node:process.version,profile:'real-createGameWorld/mobs/signatures',players:PLAYERS,config:CONFIG,seeds:{random:RANDOM_SEED,rewardSalt:REWARD_SALT},tools:{captureMts:fileSha('/repo/tools/sentenced-npc-group-fixtures/capture-supplement.mts'),captureSh:fileSha('/repo/tools/sentenced-npc-group-fixtures/capture-supplement.sh'),runMutantsSh:fileSha('/repo/tools/sentenced-npc-group-fixtures/run-supplement-mutants.sh'),packageLock:fileSha('/repo/package-lock.json')},sourceSha256:Object.fromEntries(sourceFiles.map((p:string)=>[p,fileSha('/repo/'+p)])),existingCorporaReference:{runtimeMatrix:'parity/sentenced/runtime-matrix.json (existing trusted installed-factions filter/denial probes; not used as ordinary gameplay)',denialMatrix:'parity/sentenced/denial-matrix.json'}},cases};
const text=JSON.stringify(body,null,1)+'\n'; const sha=createHash('sha256').update(text).digest('hex');
if(args[0]==='--write'){mkdirSync(outDir,{recursive:true});writeFileSync(join(outDir,'source-supplement.json'),text);console.log(JSON.stringify({written:outDir,bytes:Buffer.byteLength(text),sha256:sha,cases:cases.length}));}
else{assert.equal(text,readFileSync(join(outDir,'source-supplement.json'),'utf8'),'capture --check requires identical bytes');console.log(JSON.stringify({checked:outDir,bytes:Buffer.byteLength(text),sha256:sha,cases:cases.length}));}

if(process.version!=="v22.23.4" || process.platform!=="linux" || process.arch!=="x64") throw new Error("oracle requires Linux x64 Node22.23.4");
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {mapFromTiles,TILE_FLOOR,TICK_MS,isInVision} from '../../packages/shared/src/index.ts';
import {createScenarioWorld} from '../../parity/legacy-capture/world.ts';
import {HOLY_MODULES} from '../../parity/legacy-capture/scenarios/holy.ts';
import {addPlayer,step} from '../../packages/server/src/sim/step.ts';
import {getVisionMemory} from '../../packages/server/src/sim/vision.ts';
import {enqueueClientMessage} from '../../packages/server/src/sim/inputs.ts';
function run(n:number){
 const map=mapFromTiles(118,52,new Uint8Array(118*52).fill(TILE_FLOOR),11);map.spawns=Array.from({length:8},()=>({x:320,y:320}));
 const w=createScenarioWorld({name:'fire-hidden-instant',randomSeed:12,modules:HOLY_MODULES,players:Array(8).fill({})} as any,map);
 for(let i=0;i<8;i++)addPlayer(w,'p'+i,'p'+i,{faction:i>=2&&i<2+n?'fire':'holy'});
 step(w,TICK_MS);const memory=getVisionMemory(w,'p0')!;const initial=memory.expiresAt.slice(),last=Reflect.get(memory,'lastUpdate');assert.equal(getVisionMemory(w,'p0'),memory);assert.deepEqual(memory.expiresAt,initial);assert.equal(Reflect.get(memory,'lastUpdate'),last);
 for(let i=0;i<8;i++){let p=w.state.players.get('p'+i)!;p.x=i===0?1040:i===1?2000:3000;p.y=768;w.players.get('p'+i)!.history=[{t:w.state.serverTime,x:p.x,y:p.y}];}
 const victim=w.state.players.get('p1')!;victim.barrier=10000;
 const send=(id:string,type:string,msg:unknown)=>enqueueClientMessage(w.players.get(id)!.inputs,type,msg);
 const rows:any[]=[];
 for(let tick=2;tick<=17;tick++){
  for(let i=2;i<2+n;i++){
   const p=w.state.players.get('p'+i)!;
   if(tick===i){p.x=2070;p.y=768;w.players.get('p'+i)!.history=[{t:w.state.serverTime,x:p.x,y:p.y}];send('p'+i,'attack',{a:Math.PI});}
   if(tick===i+1){send('p'+i,'release',{a:Math.PI});p.x=3000;p.y=768;w.players.get('p'+i)!.history=[{t:w.state.serverTime,x:p.x,y:p.y}];}
  }
  if(tick===6){send('p0','move',{x:1125,y:768});for(let i=2;i<2+n;i++){const p=w.state.players.get('p'+i)!;p.x=2070;p.y=738+(i-2)*20;p.weapon0=n===3?'bow':'';w.players.get('p'+i)!.history=[{t:w.state.serverTime,x:p.x,y:p.y}];}victim.barrier=0;}
  if(tick===13)send('p1','attack',{a:Math.PI});if(tick===14)send('p1','release',{a:Math.PI});
  const events=step(w,TICK_MS),viewer=w.state.players.get('p0')!;
  const deadlines=memory.expiresAt.slice(),updated=Reflect.get(memory,'lastUpdate');const sees=(p:any)=>memory.canSee(p,w.state.serverTime)||isInVision(map,viewer,p);
  const visible=[...w.state.players.entries()].filter(([id,p])=>id==='p0'||sees(p));
  assert.deepEqual(memory.expiresAt,deadlines);assert.equal(Reflect.get(memory,'lastUpdate'),updated);
  rows.push({tick,visible:visible.map(([id,p])=>({id,x:p.x,y:p.y,facing:p.facing,hp:p.hp,maxHp:p.maxHp,status:p.status,faction:p.faction,weapon0:p.weapon0,weapon1:p.weapon1,slot:p.slot,sig:p.sig,bounty:p.bounty,barrier:p.barrier,readyAt:p.readyAt,drawStartedAt:p.drawStartedAt,attackTarget:p.attackTarget})),backlash:events.flatMap(e=>e.type==='fx'&&e.fx.kind==='hit'&&e.fx.sig==='backlash'?[e.fx]:[]),events,targets:[...w.factions!.fighters].map(([id,f])=>({id,target:f.target,engaged:f.engaged})),attacks:w.factions!.attacks,landed:w.combat.landed});
 }
 return rows;
}
const a=run(3),b=run(4);
assert.deepEqual(a.map(r=>r.visible),b.map(r=>r.visible));
for(const rows of [a,b])for(const r of rows){assert.deepEqual(r.visible.map((p:any)=>p.id),r.tick>=13?['p0','p1']:['p0']);}
const ordinary=(rows:any[])=>rows.filter(r=>r.tick>=13).map(r=>({tick:r.tick,events:r.events.filter((e:any)=>!(e.type==='fx'&&e.fx.kind==='hit'&&e.fx.sig==='backlash'))}));
assert.deepEqual(ordinary(a),ordinary(b));
const ax=a.find(r=>r.tick===13)!,bx=b.find(r=>r.tick===13)!;
assert.equal(ax.backlash.length,3);assert.equal(bx.backlash.length,4);
assert(ax.backlash.every((e:any)=>e.id==='p1'&&e.amount===37.30242460082791&&e.weapon==='bow'));
assert(bx.backlash.every((e:any)=>e.id==='p1'&&e.amount===27.976818450620932&&e.weapon==='fists'));
assert.equal(ax.backlash.reduce((s:number,e:any)=>s+e.amount,0),111.90727380248373);
assert.equal(bx.backlash.reduce((s:number,e:any)=>s+e.amount,0),111.90727380248373);
assert.deepEqual(ax.attacks,[{by:'p1',weapon:'fists'}]);assert.deepEqual(bx.attacks,ax.attacks);
assert.equal(ax.landed.filter((h:any)=>!h.sig).length,0);assert.equal(bx.landed.filter((h:any)=>!h.sig).length,0);
const output={setup:{modules:HOLY_MODULES,fireCounts:[3,4],weaponsAfterContact:['bow','fists'],bootstrapBarrier:10000,contactTicks:'one real fists attack by pi at tick i, release and move away next tick, for i=2..n+1',hiddenSetup:'all players start remote at 320,320; viewer1040,768 victim2000,768 and others3000,768 after raid start; only current contact source moved to2070,768',barrierClearedTick:6,sourceWeaponsSetTick:6,viewerMoveTick:6,attackTick:13,sourcePositions:'at tick6 each Fire pi moves to x2070,y738+20*(i-2) with matching history',trustedSetup:'positions, inventory, and common barrier only; no HP edits, runtime target edits, fabricated ledger hits, or overridden source functions',publicHistory:'all actual visible actor fields sampled, including unrounded HP; identical visible ordinary events from first victim visibility at tick13; original legacy wire itself is not an anonymity boundary',victimPosition:[2000,768],viewerMove:[1040,1125,768]},a,b};writeFileSync(process.argv[2]??'/tmp/fire-anonymity-review.json',JSON.stringify(output,null,2)+'\n');console.log('captured actual Fire count-anonymity pair');

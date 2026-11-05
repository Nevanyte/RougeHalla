/** Actual installed source reproduction; reads retained vision without updating it. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { mapFromTiles,TILE_FLOOR,TICK_MS,isInVision } from '@raid/shared';
import { createScenarioWorld } from '../../parity/legacy-capture/world';
import { HOLY_MODULES } from '../../parity/legacy-capture/scenarios/holy';
import { addPlayer,step } from '../../packages/server/src/sim/step';
import { getVisionMemory } from '../../packages/server/src/sim/vision';
import { enqueueClientMessage } from '../../packages/server/src/sim/inputs';
const map=mapFromTiles(118,52,new Uint8Array(118*52).fill(TILE_FLOOR),11);
map.spawns=[{x:320,y:320},{x:320,y:320},{x:320,y:320}];
function run(attack:number,hp:number){
 const sc:any={name:'hidden-history',randomSeed:12,modules:HOLY_MODULES,players:[{},{},{}]};
 const w=createScenarioWorld(sc,map);
 for(const [id,faction]of [['p0','holy'],['p1','holy'],['p2','plague']] as const)addPlayer(w,id,id,{faction});
 step(w,TICK_MS);const bootstrap=[...w.state.players.entries()].map(([id,p])=>({id,x:p.x,y:p.y}));const memory=getVisionMemory(w,'p0')!;const initialDeadlines=memory.expiresAt.slice(),initialUpdate=Reflect.get(memory,'lastUpdate');if(getVisionMemory(w,'p0')!==memory||Reflect.get(memory,'lastUpdate')!==initialUpdate||initialDeadlines.some((x,i)=>x!==memory.expiresAt[i]))throw Error('raid-start getter was not a no-op');
 for(const [id,x]of [['p0',1040],['p1',2000],['p2',2056]] as const){const p=w.state.players.get(id)!;p.x=x;p.y=768;w.players.get(id)!.history=[{t:w.state.serverTime,x,y:768}];}w.state.players.get('p1')!.hp=hp;
 const rows:any[]=[];for(let tick=2;tick<=11;tick++){
  const send=(id:string,type:string,msg:unknown)=>enqueueClientMessage(w.players.get(id)!.inputs,type,msg);
  if(tick===2)send('p0','move',{x:1125,y:768});
  if(tick===attack)send('p2','attack',{a:Math.PI});if(tick===attack+1)send('p2','release',{a:Math.PI});
  const events=step(w,TICK_MS);const viewer=w.state.players.get('p0')!;const victim=w.state.players.get('p1')!;const source=w.state.players.get('p2')!;
  const deadlines=memory.expiresAt.slice(),last=Reflect.get(memory,'lastUpdate');
  const sees=(p:any)=>memory.canSee(p,w.state.serverTime)||isInVision(map,viewer,p);
  const visible=sees(victim),sourceVisible=sees(source);
  if(last!==Reflect.get(memory,'lastUpdate')||deadlines.some((x,i)=>x!==memory.expiresAt[i]))throw Error('probe refreshed vision');
  rows.push({tick,x:viewer.x,visible,sourceVisible,hp:victim.hp,sig:victim.sig,landed:w.combat.landed.filter(h=>h.sig),chunks:events.flatMap(e=>e.type==='fx'&&e.fx.kind==='hit'&&e.fx.sig?[e.fx]:[])});
 }return {bootstrap,rows};
}
const a=run(3,1004.048988764045),b=run(6,1000);
assert.deepEqual(a.bootstrap,b.bootstrap);
for(const r of a.rows){assert.equal(r.visible,r.tick>=9);assert.equal(r.sourceVisible,false);}
for(const r of b.rows){assert.equal(r.visible,r.tick>=9);assert.equal(r.sourceVisible,false);}
assert.deepEqual(a.rows.filter(r=>r.visible).map(({tick,hp,sig})=>({tick,hp,sig})),b.rows.filter(r=>r.visible).map(({tick,hp,sig})=>({tick,hp,sig})));
assert.equal(a.rows.at(-1).chunks[0].amount,12.146966292134834);assert.equal(b.rows.at(-1).chunks[0].amount,8.097977528089888);
const eligible=(rows:any[])=>rows.filter(r=>r.visible).flatMap(r=>r.landed).reduce((sum,h)=>sum+h.amount,0);
assert.equal(eligible(a.rows),4.048988764044944);assert.equal(eligible(b.rows),4.048988764044944);
const result={format:'rh-plague-hidden-history/1',setup:{map:{w:118,h:52,kind:'all-floor',seed:11},randomSeed:12,modules:HOLY_MODULES,moveTick:2,move:{x:1125,y:768},attack:[3,6],initialVictimHp:[1004.048988764045,1000],players:[{id:'p0',faction:'holy',x:1040,y:768},{id:'p1',faction:'holy',x:2000,y:768},{id:'p2',faction:'plague',x:2056,y:768}],weapons:'fists',release:'following tick with a=PI',eligible:4.048988764044944},a,b};
console.log(JSON.stringify(result,null,2));if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');

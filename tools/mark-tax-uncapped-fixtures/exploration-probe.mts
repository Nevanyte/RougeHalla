import assert from 'node:assert/strict';
import {generateMap} from '/repo/packages/shared/src/mapgen.ts';
import {mulberry32,FACTIONS} from '/repo/packages/shared/src/index.ts';
import {loadConfig} from '/repo/packages/server/src/config.ts';
import {createGameWorld} from '/repo/packages/server/src/sim/gameplay.ts';
import {addPlayer,startRaid,step} from '/repo/packages/server/src/sim/step.ts';
import {installTraining} from '/repo/packages/server/src/sim/training.ts';
import {enqueueClientMessage} from '/repo/packages/server/src/sim/inputs.ts';
import {combatant} from '/repo/packages/server/src/sim/combatant.ts';
import {cardAsMultOf} from '/repo/packages/server/src/sim/mods.ts';
const map=generateMap(1,0,{decor:false});
let uid=0;const config={...loadConfig({}),training:true,dummies:true,planSeconds:0};
const w=createGameWorld({map,config,random:mulberry32(12),rewardSalt:[1,2,3,4],questSalt:[5,6,7,8],newItemUid:()=>`U${++uid}`});
installTraining(w);addPlayer(w,'p0','plague observer',{faction:'holy'});startRaid(w);
function train(payload){assert(enqueueClientMessage(w.players.get('p0').inputs,'train',payload,{training:true}));step(w,50);}
train({cmd:'stat',id:'plagueRat',count:1});train({cmd:'camp',id:'bailiff'});
const first=[...w.state.mobs.values()].find(m=>m.type==='bailiff');assert(first);assert(enqueueClientMessage(w.players.get('p0').inputs,'move',{x:first.x,y:first.y+32,seq:1}));
console.log('born',JSON.stringify([...w.state.mobs].map(([id,m])=>({id,type:m.type,camp:m.camp,x:m.x,y:m.y}))),JSON.stringify({x:w.state.players.get('p0').x,y:w.state.players.get('p0').y}));
for(let i=0;i<100;i++){const p=w.state.players.get('p0');if(Math.hypot(p.x-first.x,p.y-first.y)<=40)break;step(w,50);}
let p=w.state.players.get('p0');console.log('approached',JSON.stringify({x:p.x,y:p.y,d:Math.hypot(p.x-first.x,p.y-first.y)}));
let a=Math.atan2(first.y-p.y,first.x-p.x);assert(enqueueClientMessage(w.players.get('p0').inputs,'attack',{a}));step(w,50);console.log('attack-proof',JSON.stringify({events:w.events,me:w.state.players.get('p0').toJSON(),weapon:w.players.get('p0').weapon,landed:w.combat.landed}));assert(enqueueClientMessage(w.players.get('p0').inputs,'release',{a}));step(w,50);train({cmd:'stat',id:'plagueRat',count:20000});
for(let i=0;i<400;i++){
 step(w,50);
 const p=w.state.players.get('p0');const c=combatant(w,'p0');const src=w.modSources.find(f=>f.name==='markTaxSource');
 if(i%20===0||p.markTax>0)console.log('frame',JSON.stringify({tick:w.state.tick,now:w.state.serverTime,hp:p.hp,as:p.asMult,raw:FACTIONS[p.faction].rate*cardAsMultOf(p),selected:w.combat.marks?.taxed.get('p0')??null,mod:src(w,c),tax:p.markTax,tier:p.markTier,candidates:[...w.factions.fighters].filter(([id,f])=>f.markHits>0).map(([id,f])=>({id,target:f.target,hits:f.markHits,tier:f.tier,x:w.state.mobs.get(id)?.x,y:w.state.mobs.get(id)?.y}))}));
 if(p.markTax>0){console.log('REACHED');break;}
}

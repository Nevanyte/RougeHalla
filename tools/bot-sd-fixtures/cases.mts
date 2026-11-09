// Complete declared public method views. Health/arena clocks below are inputs, not earned World outcomes.
import {frame,fighter,maps as normalMaps} from '../bot-fight-fixtures/cases.mts';
export const maps=()=>{const m=normalMaps();return {open:m.open,corner:m.corner};};
const fight={kind:'fight',target:'p1'};
const row=(now:number,hp:number,sd:number,extra:any={})=>{
 const own=extra.own??{x:400,y:360},foe=extra.foe??{x:440,y:360};
 const p=frame(now,{self:{...own,hp,maxHp:1000},hud:{suddenDeathAt:sd},fighters:extra.visible===false?[]:[fighter({...foe,hpFrac:.5,dist:Math.hypot(own.x-foe.x,own.y-foe.y),vx:extra.vx??0,vy:0})]});
 return {percept:p,goal:extra.goal??fight};
};
const sequence=(name:string,rows:any[],extra:any={})=>({name,map:'open',seed:0,tier:'normal',persona:'cautious',rows,...extra});
export function cases(){return [
 sequence('known-clock-disabled-future-exact-start-and-exit',[row(100,900,0),row(150,900,200),row(200,900,200),row(250,900,0),row(300,900,200)]),
 sequence('actual-unknown-knowledge-draw-keeps-normal-fight',[row(100,900,100),row(150,900,100)],{seed:7}),
 sequence('f32-health-sides-and-retained-two-percent-band',[row(100,519.9999389648438,100),row(150,520,100),row(200,500,100),row(250,480.0000305175781,100),row(300,480,100),row(350,500,100),row(400,530,100)]),
 sequence('exact-340-quiet-held-inside-and-world-leave',[
  row(100,900,100,{foe:{x:740,y:360}}),row(150,900,100,{foe:{x:740,y:360}}),
  row(200,900,100,{foe:{x:739,y:360},vx:-20}),row(250,900,100,{foe:{x:740,y:360},vx:20}),
  row(300,900,100,{foe:{x:740,y:360}}),row(350,900,100,{foe:{x:740,y:360},goal:{kind:'idle'}}),row(400,900,100,{foe:{x:740,y:360}})]),
 sequence('retreat-cache-reuse-exact48-threat-change-and1200',[
  row(100,900,100,{own:{x:600,y:360},foe:{x:640,y:360}}),row(200,900,100,{own:{x:620,y:360},foe:{x:660,y:360},vx:200}),
  row(1200,900,100,{own:{x:424,y:360},foe:{x:464,y:360},vx:-196}),row(2000,900,100,{own:{x:424,y:360},foe:{x:300,y:360},vx:-205}),
  row(3199,900,100,{own:{x:434,y:360},foe:{x:310,y:360},vx:10/1.199}),row(3200,900,100,{own:{x:434,y:360},foe:{x:310,y:360}})]),
 sequence('cornered-sd-falls-through-to-real-normal-fight',[
  row(100,900,100,{own:{x:400,y:400},foe:{x:432,y:400}}),row(150,900,100,{own:{x:400,y:400},foe:{x:432,y:400}})],{map:'corner'}),
 sequence('seen-remembered-reentry-and-actual-memory-expiry',[
  row(100,900,100),row(150,900,100,{visible:false}),row(200,900,100),row(35200,900,100,{visible:false}),row(35201,900,100,{visible:false})]),
 sequence('sd-touches-progress-watch-and-exit-keeps-strict10s',[
  ...[100,500,3500,6500,9500,12500].map(t=>row(t,900,500,{foe:{x:700,y:360}})),
  ...[13000,15500,18500,21500,22500,22501].map(t=>row(t,400,500,{foe:{x:700,y:360}}))]),
];}

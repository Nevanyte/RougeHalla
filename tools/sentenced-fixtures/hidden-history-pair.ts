/** Genuine projectile producers: one hidden owner with two old/new hits versus two hidden owners with one each.
 * Initial map/positions/HP/inventory are trusted setup; every attack, release, aim, move and swap uses normal intake.
 */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {mapFromTiles,TILE_FLOOR,TICK_MS} from '../../packages/shared/src/index';
import {createScenarioWorld} from '../../parity/legacy-capture/world';
import {HOLY_MODULES} from '../../parity/legacy-capture/scenarios/holy';
import {addPlayer,step} from '../../packages/server/src/sim/step';
import {canPlayerSeeActor} from '../../packages/server/src/sim/vision';
import {signatureState} from '../../packages/server/src/sim/factions';
import {createIntake} from '../../parity/legacy-capture/intake';
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw Error('requires Linux x64 Node22.23.4');
function run(split:boolean,reverse:boolean,distance:number,dy:number){
 const map=mapFromTiles(118,52,new Uint8Array(118*52).fill(TILE_FLOOR),11);map.spawns=Array.from({length:8},()=>({x:320,y:320}));
 const ids=['viewer','victim',...(reverse?['hidden-bow','hidden-wand']:['hidden-wand','hidden-bow'])];
 const w=createScenarioWorld({name:'sentenced-hidden-history',randomSeed:12,modules:HOLY_MODULES,players:ids.map(id=>({id}))} as any,map);
 for(const id of ids){const p=addPlayer(w,id,id,{faction:id.startsWith('hidden-')?'sentenced':'holy'});if(id==='hidden-wand'){p.weapon0='wand';p.weapon1='bow';}if(id==='hidden-bow')p.weapon0='bow';}
 step(w,TICK_MS);
 for(const id of ids){const p=w.state.players.get(id)!;p.x=id==='viewer'?1125:id==='victim'?2000:id==='hidden-wand'?2000+distance:split?2000+distance-70:3000;p.y=id==='hidden-bow'&&split?768+dy:768;p.hp=10000;w.players.get(id)!.history=[{t:w.state.serverTime,x:p.x,y:p.y}];}
 const intake=createIntake(false),inputs:any[]=[],rows:any[]=[];const send=(tick:number,id:string,type:string,msg:any)=>{const accepted=intake(id,w.players.get(id)!.inputs,type,msg,w.state.serverTime,w.config.training);inputs.push({tick,id,type,msg,accepted});assert(accepted);};
 for(let tick=2;tick<=42;tick++){
  if(tick===3)send(tick,'hidden-wand','attack',{a:Math.PI});
  if(tick===11){if(split)send(tick,'hidden-wand','release',{a:Math.PI});else {send(tick,'hidden-wand','move',{x:2000+distance-70,y:768+dy});send(tick,'hidden-wand','swap',{});send(tick,'hidden-wand','aim',{a:Math.atan2(-dy,-distance+70)});}}
  if(split&&tick===21)send(tick,'hidden-bow','attack',{a:Math.atan2(-dy,-distance+70)});
  if(tick===28)send(tick,split?'hidden-bow':'hidden-wand','release',{a:Math.atan2(-dy,-distance+70)});
  const events=step(w,TICK_MS),visible=[...w.state.players.entries()].filter(([id,p])=>id==='viewer'||canPlayerSeeActor(w,'viewer',id,p));
  assert.deepEqual(visible.map(([id])=>id),['viewer','victim']);
  const instant=events.flatMap(e=>e.type==='fx'&&e.fx.kind==='hit'&&e.fx.sig==='mark'?[e.fx]:[]);
  const publicEvents=events.flatMap(e=>{if(e.type!=='fx')return [];const f:any=e.fx;if(f.kind==='hit'&&!f.sig&&f.id==='victim')return [{...f,by:null}];return [];});
  const sum=instant.reduce((n,f:any)=>n+f.amount,0);
  rows.push({tick,visible:visible.map(([id,p])=>({id,x:p.x,y:p.y,facing:p.facing,hp:p.hp,maxHp:p.maxHp,status:p.status,faction:p.faction,sig:p.sig,bounty:p.bounty,weapon0:p.weapon0,weapon1:p.weapon1,slot:p.slot,readyAt:p.readyAt,drawStartedAt:p.drawStartedAt,attackTarget:p.attackTarget,markTier:p.markTier,brand:p.brand,markTax:p.markTax,markBy:null})),publicEvents,instant,expectedAnonymous:sum>0?[{victim:'victim',by:null,sig:'mark',weapon:null,amount:sum}]:[],private:['hidden-wand','hidden-bow'].map(id=>{const f=signatureState(w,id);return {id,target:f?.target??null,tier:f?.tier??0,hits:f?.markHits??0,progress:f?.markProgress??0};})});
 }
 return {inputs,rows};
}
let found:any;
for(let distance=470;distance<=520&&!found;distance+=5)for(let dy=20;dy<=50&&!found;dy+=5){
 const a=run(false,false,distance,dy),b=run(true,false,distance,dy),c=run(true,true,distance,dy);
 try{assert(a.rows.some(r=>r.instant.length===2));assert.deepEqual(a.rows.map(r=>r.visible),b.rows.map(r=>r.visible));assert.deepEqual(a.rows.map(r=>r.visible),c.rows.map(r=>r.visible));assert.deepEqual(a.rows.map(r=>r.publicEvents),b.rows.map(r=>r.publicEvents));assert.deepEqual(a.rows.map(r=>r.publicEvents),c.rows.map(r=>r.publicEvents));assert.deepEqual(a.rows.map(r=>r.expectedAnonymous),b.rows.map(r=>r.expectedAnonymous));assert.deepEqual(a.rows.map(r=>r.expectedAnonymous),c.rows.map(r=>r.expectedAnonymous));found={distance,dy,a,b,c};}catch{}
}
assert(found,'no identical-visible-history producer pair found');
const hit=found.a.rows.find((r:any)=>r.instant.length===2);assert.equal(new Set(hit.instant.map((r:any)=>r.by)).size,1);assert.equal(new Set(found.b.rows.find((r:any)=>r.tick===hit.tick).instant.map((r:any)=>r.by)).size,2);
const output={format:'rh-sentenced-source-hidden-history/1',runtime:{version:process.version,platform:process.platform,arch:process.arch},provenance:{modules:HOLY_MODULES,trustedSetup:'initial open map, bootstrap320,320, HP10000, inventory and positions only; no target/tier/progress/clock/ledger/projectile/FX injection',ordinaryInputs:'normal attack/release, accepted move/swap/aim; one old wand ball and one new bow arrow land together',contract:'all visible actor fields including unrounded HP/tier/brand and redacted ordinary hit histories are exactly equal; anonymous Mark output is identical with source count1vs2 and reversed owner insertion',limits:'normal powerzero players only; exact-sum helpers still cover adversarial binary64 multisets'},...found};
writeFileSync(process.argv[2]??'/tmp/sentenced-hidden-history.json',JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({distance:found.distance,dy:found.dy,tick:hit.tick,one:hit.instant,two:found.b.rows.find((r:any)=>r.tick===hit.tick).instant,reversed:found.c.rows.find((r:any)=>r.tick===hit.tick).instant,runtime:output.runtime}));

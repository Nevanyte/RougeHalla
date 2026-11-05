/** Actual source producer evidence. Trusted placement/HP/bootstrap only; attacks use ordinary intake.
 * No target/tier/ledger/FX injection. Arbitrary hidden IDs deliberately exercise source lexical identity.
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
function run(hidden:string,mode:'tie'|'visible-stronger'|'hidden-stronger'='tie'){
 const map=mapFromTiles(118,52,new Uint8Array(118*52).fill(TILE_FLOOR),11);map.spawns=Array.from({length:8},()=>({x:320,y:320}));
 const ids=['viewer','victim','owner-visible',hidden];
 const w=createScenarioWorld({name:'sentenced-hidden-tie',randomSeed:12,modules:HOLY_MODULES,players:ids.map(id=>({id}))} as any,map);
 for(const id of ids)addPlayer(w,id,id,{faction:id==='owner-visible'||id===hidden?'sentenced':'holy'});
 step(w,TICK_MS);
 for(const id of ids){const p=w.state.players.get(id)!;p.x=id==='viewer'?1125:id==='victim'?2000:id==='owner-visible'?1930:2070;p.y=768;p.hp=10000;w.players.get(id)!.history=[{t:w.state.serverTime,x:p.x,y:p.y}];}
 const intake=createIntake(false),inputs:any[]=[],rows:any[]=[];
 const send=(tick:number,id:string,type:string,msg:any)=>{const accepted=intake(id,w.players.get(id)!.inputs,type,msg,w.state.serverTime,w.config.training);inputs.push({tick,id,type,msg,accepted});assert(accepted);};
 for(let tick=2;tick<=65;tick++){
  for(const id of ['owner-visible',hidden]){const strong=mode==='tie'||(mode==='visible-stronger'?id==='owner-visible':id===hidden);if(tick===(strong?3:45))send(tick,id,'attack',{a:id===hidden?Math.PI:0});if(tick===(strong?32:46))send(tick,id,'release',{a:id===hidden?Math.PI:0});}
  const events=step(w,TICK_MS),visible=[...w.state.players.entries()].filter(([id,p])=>id==='viewer'||canPlayerSeeActor(w,'viewer',id,p));
  assert.deepEqual(visible.map(([id])=>id),['viewer','victim','owner-visible']);
  const victim=w.state.players.get('victim')!,tier=victim.markTier;
  const eligible=visible.filter(([id,p])=>p.status==='alive'&&signatureState(w,id)?.target==='victim'&&signatureState(w,id)?.tier===tier&&tier>0).map(([id])=>id).sort();
  const instant=events.flatMap(e=>e.type==='fx'&&e.fx.kind==='hit'&&e.fx.sig==='mark'?[e.fx]:[]);
  const publicEvents=events.flatMap(e=>{if(e.type!=='fx')return [];const f:any=e.fx;if(f.sig==='mark')return [];if(f.kind==='hit'&&visible.some(([id])=>id===f.id))return [{...f,by:visible.some(([id])=>id===f.by)?f.by:null}];if(f.kind==='swing'&&visible.some(([id])=>id===f.by))return [f];return [];});
  rows.push({tick,visible:visible.map(([id,p])=>({id,x:p.x,y:p.y,facing:p.facing,hp:p.hp,maxHp:p.maxHp,status:p.status,faction:p.faction,weapon0:p.weapon0,weapon1:p.weapon1,slot:p.slot,sig:p.sig,bounty:p.bounty,readyAt:p.readyAt,drawStartedAt:p.drawStartedAt,attackTarget:p.attackTarget,markTier:p.markTier,brand:p.brand,markTax:p.markTax,markBy:id==='victim'?(eligible[0]??null):null})),publicEvents,legacyMarker:victim.markBy,instant,expectedAnonymous:instant.filter((f:any)=>!visible.some(([id])=>id===f.by)).map((f:any)=>({victim:f.id,sig:f.sig,amount:f.amount,by:null,weapon:null})),private:[...w.factions!.fighters].map(([id,f])=>({id,target:f.target,tier:f.tier,hits:f.markHits,progress:f.markProgress}))});
 }
 return {inputs,rows};
}
const a=run('a-hidden'),b=run('z-hidden');
assert.deepEqual(a.rows.map(r=>r.visible),b.rows.map(r=>r.visible));
assert.deepEqual(a.rows.map(r=>r.publicEvents),b.rows.map(r=>r.publicEvents));
assert.deepEqual(a.rows.map(r=>r.expectedAnonymous),b.rows.map(r=>r.expectedAnonymous));
const tie=a.rows.find(r=>r.legacyMarker==='a-hidden')!;assert(tie);
assert.equal(b.rows.find(r=>r.tick===tie.tick)!.legacyMarker,'owner-visible');
assert.equal(tie.visible.find((p:any)=>p.id==='victim')!.markBy,'owner-visible');
const visible=run('a-hidden','visible-stronger'),hidden=run('a-hidden','hidden-stronger');
assert(visible.rows.some(r=>r.private.find((p:any)=>p.id==='owner-visible')!.tier>r.private.find((p:any)=>p.id==='a-hidden')!.tier&&r.visible.find((p:any)=>p.id==='victim')!.markBy==='owner-visible'));
assert(hidden.rows.some(r=>r.private.find((p:any)=>p.id==='a-hidden')!.tier>r.private.find((p:any)=>p.id==='owner-visible')!.tier&&r.visible.find((p:any)=>p.id==='victim')!.markBy===null));
const output={format:'rh-sentenced-source-public-pairs/1',runtime:{version:process.version,platform:process.platform,arch:process.arch},provenance:{modules:HOLY_MODULES,trustedSetup:'open map, bootstrap spawn320,320, initial positions and HP10000; no private signature state, target, ledger, FX or clock injection',ordinaryIntake:'createIntake(false), attack/release only',sourceComparator:'lexical arbitrary string IDs, varied only for hidden actor',contract:'tier/brand are strongest incoming surviving Mark; eligible existing visible owners are selected before stable runtime numeric ordering; one eligible owner in these source pairs',limits:'This pair proves hidden tied identity cannot suppress the visible owner. It does not prove anonymity for changed hidden source count or different hidden hit history. Separate exact-sum and fixed-marker Rust regressions remain required.'},a,b,visibleStronger:visible,hiddenStronger:hidden};
writeFileSync(process.argv[2]??'/tmp/sentenced-public-pairs.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({pairTicks:a.rows.length,tieTick:tie.tick,legacyWinners:[tie.legacyMarker,b.rows.find(r=>r.tick===tie.tick)!.legacyMarker],publicWinner:tie.visible.find((p:any)=>p.id==='victim')!.markBy,controls:[visible.rows.length,hidden.rows.length],runtime:output.runtime}));

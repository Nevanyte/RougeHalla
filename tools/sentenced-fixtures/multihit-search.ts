/** Read-only search for a genuine normal-input old-ball/new-arrow same-tick landing. */
import {mapFromTiles,TILE_FLOOR,TICK_MS} from '../../packages/shared/src/index';
import {createScenarioWorld} from '../../parity/legacy-capture/world';
import {HOLY_MODULES} from '../../parity/legacy-capture/scenarios/holy';
import {addPlayer,step} from '../../packages/server/src/sim/step';
import {createIntake} from '../../parity/legacy-capture/intake';
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw Error('requires Linux x64 Node22.23.4');
const map=mapFromTiles(56,32,new Uint8Array(56*32).fill(TILE_FLOOR),11);
for(let distance=250;distance<=520;distance+=5)for(let swap=5;swap<=45;swap++){
 const w=createScenarioWorld({name:'search',randomSeed:12,modules:HOLY_MODULES,players:[{},{},{}]} as any,map);
 for(let i=0;i<3;i++){const p=addPlayer(w,`p${i}`,`p${i}`,{faction:i===0?'sentenced':'holy'});if(!i){p.weapon0='wand';p.weapon1='bow';}}
 step(w,TICK_MS);for(let i=0;i<3;i++){const p=w.state.players.get(`p${i}`)!;p.x=i===0?400:i===1?400+distance:1400;p.y=i===2?800:320;p.hp=10000;w.players.get(`p${i}`)!.history=[{t:w.state.serverTime,x:p.x,y:p.y}];}
 let count=0,rows:any[]=[];w.beforeDamage.push(world=>{rows=world.combat.ledger.filter(e=>e.sig==='mark');count=rows.length;});const intake=createIntake(false);
 for(let tick=2;tick<=70;tick++){if(tick===3)intake('p0',w.players.get('p0')!.inputs,'attack',{a:0},w.state.serverTime,false);if(tick===11)intake('p0',w.players.get('p0')!.inputs,'move',{x:470,y:320},w.state.serverTime,false);if(tick===swap)intake('p0',w.players.get('p0')!.inputs,'swap',{},w.state.serverTime,false);const events=step(w,TICK_MS);if(count>1){console.log(JSON.stringify({distance,swap,tick,count,weapons:rows.map(e=>e.weapon)}));process.exit(0);}}
}
throw Error('no ordinary multi-hit found');

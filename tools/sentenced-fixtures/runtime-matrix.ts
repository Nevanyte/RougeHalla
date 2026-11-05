/** Trusted setup probes through actual installed faction beforeDamage; separate from gameplay intake. */
import {writeFileSync} from 'node:fs';
import {mapFromTiles,TILE_FLOOR,TICK_MS} from '@raid/shared';
import {createScenarioWorld} from '../../parity/legacy-capture/world';
import {HOLY_MODULES} from '../../parity/legacy-capture/scenarios/holy';
import {addPlayer,step} from '../../packages/server/src/sim/step';
import {recordHit} from '../../packages/server/src/sim/ledger';
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw Error('requires Linux x64 Node22.23.4');
const cases:any[]=[];
for(const weapon of ['fists','sword','axe','shield','bow','wand']) for(const hits of [1,3,6,9,12]) cases.push({name:`${weapon||'fists'}-${hits}`,weapon,hits});
for(const distance of [299.999999,300,300.000001,640,640.000001])cases.push({name:`distance-${distance}`,hits:3,weapon:'wand',distance});
for(const stacks of [1,5])cases.push({name:`stacks-${stacks}`,weapon:'axe',hits:3,stacks});
for(const hits of [1,2,3,6])cases.push({name:`chill-${hits}`,weapon:'bow',hits,chill:1-.32});
for(const flag of ['passive','derived','sig','noWeapon','zeroScale','immune'])cases.push({name:`filter-${flag}`,weapon:'bow',hits:3,flag});
for(const swaps of [0,1,2,3,9])cases.push({name:`swaps-${swaps}`,weapon:'sword',hits:1,priorHits:1,priorProgress:1,priorTier:1,swaps});
for(const age of [1499.999999,1500,1500.000001])cases.push({name:`far-age-${age}`,weapon:'bow',hits:1,distance:641,farAge:age});
cases.push({name:'stagger-not-paused',weapon:'wand',hits:3,pause:11000});
function run(c:any){
 const w=createScenarioWorld({name:'sentenced-runtime',randomSeed:12,modules:HOLY_MODULES,config:{pvpRules:false},players:[{},{},{}]} as any,mapFromTiles(48,28,new Uint8Array(48*28).fill(TILE_FLOOR),11));
 for(let i=0;i<3;i++)addPlayer(w,`p${i}`,`p${i}`,{faction:i===0?'sentenced':'holy'});
 step(w,TICK_MS);step(w,TICK_MS);w.state.serverTime=10000;w.state.tick=200;
 for(let i=0;i<3;i++){const p=w.state.players.get(`p${i}`)!;p.x=400+(i===1?c.distance??60:i*60);p.y=320;p.immuneUntil=0;}
 const owner=w.state.players.get('p0')!,target=w.state.players.get('p1')!,f=w.factions!.fighters.get('p0')!;
 owner.sentence=c.stacks??0;f.target='p1';f.contactAt=10000;f.reachAt=10000;f.markGroup=c.priorTier?'fighter:p1':null;f.markGroupSize=1;f.tier=c.priorTier??0;f.markHits=c.priorHits??0;f.markProgress=c.priorProgress??0;f.markSwaps=c.swaps??0;f.chill=c.chill??1;f.dotPausedUntil=c.pause??0;
 if(c.farAge!==undefined)f.farSince=10000-c.farAge;if(c.flag==='immune')target.immuneUntil=11000;
 w.combat.ledger=[];w.combat.landed=[];w.events=[];
 for(let i=0;i<c.hits;i++)recordHit(w,{victim:'p1',by:{id:'p0',name:'p0'},packet:{raw:1,phys:1,magic:0,true:0},weapon:c.flag==='noWeapon'?null:c.weapon,stagger:false,scale:c.flag==='zeroScale'?0:1,...(c.flag==='passive'?{passive:true}:{}),...(c.flag==='derived'?{derived:true}:{}),...(c.flag==='sig'?{sig:'burn'}:{})} as any);
 for(const hook of w.beforeDamage)hook(w,TICK_MS);
 return {setup:c,result:{target:f.target,tier:f.tier,hits:f.markHits,progress:f.markProgress,swaps:f.markSwaps,denied:f.markDenied,farSince:Number.isFinite(f.farSince)?f.farSince:null,ampUntil:Number.isFinite(f.ampUntil)?f.ampUntil:0,sentence:owner.sentence},pulses:w.combat.ledger.filter(e=>e.sig==='mark').map(e=>({raw:e.packet.raw,weapon:e.weapon,phys:e.packet.phys,magic:e.packet.magic,true_:e.packet.true,scale:e.scale??1})),events:w.events.filter(e=>e.type==='toast').map(e=>({to:e.to,text:e.text}))};
}
const output={format:'rh-sentenced-runtime-matrix/1',provenance:{node:process.version,platform:process.platform,arch:process.arch,kind:'trusted private setup and actual installed beforeDamage; not ordinary gameplay intake',modules:HOLY_MODULES,exports:['packages/server/src/sim/factions.ts::installFactions','packages/server/src/sim/ledger.ts::recordHit'],sourceFiles:['packages/server/src/sim/factions.ts','packages/shared/src/mark.ts','packages/shared/src/factions.ts','packages/shared/src/signatureShares.ts']},cases:cases.map(run)};
writeFileSync(process.argv[2]??'parity/sentenced/runtime-matrix.json',JSON.stringify(output,null,2)+'\n');console.log(`captured ${cases.length} Sentenced installed runtime probes`);

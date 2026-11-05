/** Trusted setup probes of actual installed source afterDamage/movement, NOT ordinary gameplay intake. */
import {writeFileSync} from 'node:fs';
import {mapFromTiles,TILE_FLOOR,TICK_MS} from '@raid/shared';
import {createScenarioWorld} from '../../parity/legacy-capture/world';
import {HOLY_MODULES} from '../../parity/legacy-capture/scenarios/holy';
import {addPlayer,removePlayer,step} from '../../packages/server/src/sim/step';
import {signatureState} from '../../packages/server/src/sim/factions';
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw Error('requires Linux x64 Node22.23.4');
const cases=[
 {name:'inclusive-radius',distance:100}, {name:'outside-radius',distance:100.000001},
 {name:'forward-edge',edges:[[0,1]]},{name:'reverse-edge',edges:[[1,0]]},
 {name:'multi-min-dedup',edges:[[0,1],[1,0],[2,1]]},
 {name:'hold-boundary',exposure:1000},{name:'thaw-quantization',exposure:1015},
 {name:'thaw-mid',exposure:2500},{name:'thaw-end',exposure:4000},
 {name:'brief-gap',distance:101,exposure:2000,lastAgo:50},
 {name:'gap-expiry',distance:101,exposure:4500,lastAgo:4000},
 {name:'switch-retains-episode',edges:[[2,1]],exposure:2500,lastAgo:50},
 {name:'return-reset-exact',exposure:6000,lastAgo:4000},
 {name:'ranged-expired',edges:[],rangedLeft:0},{name:'ranged-just-active',edges:[],rangedLeft:.000001},
 {name:'near-ranged-min',rangedLeft:500},{name:'thawed-ranged-min',exposure:3000,rangedLeft:500},
 {name:'draw-short-clock',readyLeft:16.5,bufferLeft:30,drawLeft:17.125},
 {name:'draw-full-clock',readyLeft:100,bufferLeft:100,drawLeft:100},
 {name:'departed-live-recheck',depart:0},
 {name:'dead-live-recheck',dead:0},
];
function run(c:any){const w=createScenarioWorld({name:'frost-probe',randomSeed:12,modules:HOLY_MODULES,players:[{},{},{},{}]} as any,mapFromTiles(48,28,new Uint8Array(48*28).fill(TILE_FLOOR),11));for(let i=0;i<4;i++)addPlayer(w,`p${i}`,`p${i}`,{faction:i===0||i===2?'frost':'holy'});step(w,TICK_MS);step(w,TICK_MS);w.state.serverTime=10000;w.state.tick=200;for(let i=0;i<4;i++){const p=w.state.players.get(`p${i}`)!;p.x=i===1?400+(c.distance??75):400;p.y=320;}for(const [a,b]of c.edges??[[0,1]]){const f=w.factions!.fighters.get(`p${a}`)!;f.target=`p${b}`;f.engaged=true;f.inReach=true;f.contactAt=10000;f.reachAt=10000;}
 const f=w.factions!.fighters.get('p1')!;f.chill=1-.32;f.chillers=['p0'];f.frostMoveMult=.7;if(c.exposure!==undefined){f.chillExposureStartedAt=10000-c.exposure;f.chillLastNearAt=10000-(c.lastAgo??0);}if(c.rangedLeft!==undefined)f.rangedChillUntil=10000+c.rangedLeft;
 const p=w.state.players.get('p1')!,rt=w.players.get('p1')!.weapon;p.readyAt=10000+(c.readyLeft??100);rt.bufferedUntil=10000+(c.bufferLeft??100);
 if(c.drawLeft!==undefined){rt.action={kind:'draw',weapon:'bow',startedAt:9000,landsAt:10000+c.drawLeft,a:0,packet:{raw:1,phys:1,magic:0,true:0}};p.drawStartedAt=9000;}
 const beforeMove=w.moveModifiers[0]!(w,{kind:'player',id:'p1',s:p,rt:w.players.get('p1')!} as any,TICK_MS);
 if(c.depart!==undefined)removePlayer(w,`p${c.depart}`);if(c.dead!==undefined)w.state.players.get(`p${c.dead}`)!.status='dead';
 const liveMove=w.moveModifiers[0]!(w,{kind:'player',id:'p1',s:p,rt:w.players.get('p1')!} as any,TICK_MS);
 const after=w.systems.find(fn=>fn.name==='afterDamage');if(!after)throw Error('missing source faction afterDamage');after(w,TICK_MS);
 const a=rt.action;return {setup:c,beforeMove,liveMove,result:{chill:f.chill,chillers:f.chillers,exposureStartedAt:Number.isFinite(f.chillExposureStartedAt)?f.chillExposureStartedAt:null,lastNearAt:Number.isFinite(f.chillLastNearAt)?f.chillLastNearAt:null,rangedUntil:Number.isFinite(f.rangedChillUntil)?f.rangedChillUntil:null,move:f.frostMoveMult,readyAt:p.readyAt,bufferedUntil:rt.bufferedUntil,drawStartedAt:p.drawStartedAt,action:a?{kind:a.kind,startedAt:a.startedAt,landsAt:a.landsAt}:null,bits:p.sig}};}
writeFileSync(process.argv[2]??'parity/frost/runtime-matrix.json',JSON.stringify({format:'rh-frost-runtime-matrix/1',modules:HOLY_MODULES,kind:'trusted private setup; actual installed afterDamage and movement modifier; not gameplay intake',cases:cases.map(run)},null,2)+'\n');console.log(`captured ${cases.length} actual installed runtime cases`);

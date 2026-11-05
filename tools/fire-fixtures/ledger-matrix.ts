if(process.version!=="v22.23.4" || process.platform!=="linux" || process.arch!=="x64") throw new Error("oracle requires Linux x64 Node22.23.4");
/** Calls the installed source ledger and faction afterDamage, without replacing their arithmetic. */
import {writeFileSync} from 'node:fs';
import {mapFromTiles,TILE_FLOOR,TICK_MS} from '@raid/shared';
import {createScenarioWorld,MODULES} from '../../parity/legacy-capture/world';
import {HOLY_MODULES} from '../../parity/legacy-capture/scenarios/holy';
import {addPlayer,removePlayer,step} from '../../packages/server/src/sim/step';
import {applyLedger,recordHit} from '../../packages/server/src/sim/ledger';
import {chainHook} from '../../packages/server/src/sim/world';
const dot=(by='p0',raw=1000,execute=false,scale=1)=>({by,raw,execute,scale,sig:'burn',weapon:'axe',victim:'p2'});
const hit=(by='p0',raw=1000)=>({...dot(by,raw),sig:'backlash',weapon:'sword'});
const cases=[
 {name:'same-source-disease-execute',entries:[dot(),{...dot('p0',4000,true),sig:'disease'}]},
 {name:'mixed-hit-dot',entries:[dot(),hit(),{...dot('p0',4000,true),sig:'disease'}]},
 {name:'two-sources',entries:[dot(),dot('p1'),{...dot('p0',4000,true),sig:'disease'}]},
 {name:'reverse-private-order',entries:[dot('p1'),{...dot('p0',4000,true),sig:'disease'},dot()]},
 {name:'partial-barrier',barrier:5,entries:[dot(),{...dot('p0',4000,true),sig:'disease'}]},
 {name:'full-barrier',barrier:500,entries:[dot(),{...dot('p0',4000,true),sig:'disease'}]},
 {name:'immunity',immune:1000,entries:[dot(),hit()]},
 {name:'overkill',hp:1,entries:[dot(),dot('p1')]},
 {name:'departed-source',depart:'p0',entries:[dot(),{...dot('p0',4000,true),sig:'disease'}]},
 {name:'disabled-pvp',pvp:false,entries:[dot('p0',20),{...dot('p0',15,true),sig:'disease'}]},
 {name:'zero-and-scaled',entries:[dot('p0',1000,false,0),dot('p0',30,false,0.2),dot('p0',0,true)]},
 {name:'distinct-victims',entries:[dot(),{...dot(),victim:'p3'},{...dot('p0',4000,true),sig:'disease'}]},
];
function run(c:any){const map=mapFromTiles(118,52,new Uint8Array(118*52).fill(TILE_FLOOR),11);const w=createScenarioWorld({name:'matrix',randomSeed:12,modules:HOLY_MODULES.slice(0,HOLY_MODULES.indexOf('factions')),players:[{},{},{},{}],config:{pvpRules:c.pvp??true}} as any,map);const afterIndex=w.systems.length;for(const name of HOLY_MODULES.slice(HOLY_MODULES.indexOf('factions')))MODULES[name as keyof typeof MODULES](w);for(let i=0;i<4;i++)addPlayer(w,`p${i}`,`p${i}`,{faction:i<2?'fire':'holy'});step(w,TICK_MS);for(let i=0;i<4;i++){const p=w.state.players.get(`p${i}`)!;p.x=400+i*300;p.y=320;}const victim=w.state.players.get('p2')!;victim.hp=c.hp??1000;victim.barrier=c.barrier??0;victim.immuneUntil=c.immune??0;if(c.depart)removePlayer(w,c.depart);w.state.serverTime=100;w.state.tick=2;w.combat.landed=[];w.combat.ledger=[];
 const hooks:any[]=[];chainHook(w,'hitLanded',(_w,e,amount)=>hooks.push({victim:e.victim,by:e.by.id,amount,sig:e.sig??null}));
 for(const e of c.entries)recordHit(w,{victim:e.victim,by:{id:e.by,name:e.by},packet:{raw:e.raw,phys:e.sig==='backlash'?1:0,magic:e.sig==='backlash'?0:1,true:0},weapon:e.weapon,stagger:false,scale:e.scale,...(e.sig?{sig:e.sig}:{}),...(e.execute?{execute:true}:{})} as any);
 applyLedger(w);const after=w.systems[afterIndex]!;if(after.name!=='afterDamage')throw Error('installed faction pass moved');after(w,TICK_MS);
 return {setup:c,hooks,landed:w.combat.landed.map(h=>({victim:h.victim,by:h.by,amount:h.amount,weapon:h.weapon,sig:h.sig??null})),players:[...w.state.players.entries()].map(([id,p])=>({id,hp:p.hp,barrier:p.barrier,status:p.status})),buckets:[...w.factions!.dot.values()]};}
const result={format:'rh-fire-ledger-matrix/1',modules:HOLY_MODULES,cases:cases.map(run)};writeFileSync(process.argv[2]??'parity/fire/ledger-matrix.json',JSON.stringify(result,null,2)+'\n');console.log(`captured ${cases.length} actual ledger cases`);

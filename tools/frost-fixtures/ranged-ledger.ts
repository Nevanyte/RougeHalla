/** Direct trusted ledger setups through actual recordHit/applyLedger/faction afterDamage. */
import {writeFileSync} from 'node:fs';
import {mapFromTiles,TILE_FLOOR,TICK_MS} from '@raid/shared';
import {createScenarioWorld} from '../../parity/legacy-capture/world';
import {HOLY_MODULES} from '../../parity/legacy-capture/scenarios/holy';
import {addPlayer,removePlayer,step} from '../../packages/server/src/sim/step';
import {applyLedger,recordHit} from '../../packages/server/src/sim/ledger';
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw Error('requires Linux x64 Node22.23.4');
const cases=[{name:'bow',weapon:'bow'},{name:'wand',weapon:'wand'},{name:'refresh',weapon:'bow',until:1000},{name:'expired-refresh',weapon:'bow',until:75},{name:'full-barrier',weapon:'bow',barrier:500},{name:'partial-barrier',weapon:'bow',barrier:1},{name:'immunity',weapon:'bow',immune:1000},{name:'lethal-victim',weapon:'bow',hp:1},{name:'dead-shooter-same-pass',weapon:'bow',shooterHp:1,killShooter:true},{name:'dead-victim-same-pass',weapon:'bow',hp:1,killVictim:true},{name:'departed-shooter',weapon:'bow',depart:0},{name:'departed-victim',weapon:'bow',depart:2},{name:'melee-not-ranged',weapon:'sword'},{name:'signature-not-weapon',weapon:'bow',sig:'burn'},{name:'zero-damage',weapon:'wand',raw:0}];
function run(c:any){const w=createScenarioWorld({name:'frost-ledger',randomSeed:12,modules:HOLY_MODULES,players:[{},{},{},{}]} as any,mapFromTiles(48,28,new Uint8Array(48*28).fill(TILE_FLOOR),11));for(let i=0;i<4;i++)addPlayer(w,`p${i}`,`p${i}`,{faction:i===0?'frost':'holy'});step(w,TICK_MS);step(w,TICK_MS);w.state.serverTime=100;w.state.tick=2;for(let i=0;i<4;i++){const p=w.state.players.get(`p${i}`)!;p.x=400+i*200;p.y=320;}
 const victim=w.state.players.get('p2')!;victim.hp=c.hp??1000;victim.barrier=c.barrier??0;victim.immuneUntil=c.immune??0;w.state.players.get('p0')!.hp=c.shooterHp??1000;
 if(c.until!==undefined)w.factions!.fighters.get('p2')!.rangedChillUntil=c.until;
 if(c.depart!==undefined)removePlayer(w,`p${c.depart}`);w.combat.ledger=[];w.combat.landed=[];
 function hit(victim:string,by:string,weapon:string,raw:number,sig?:string){recordHit(w,{victim,by:{id:by,name:by},packet:{raw,phys:1,magic:0,true:0},weapon,stagger:false,scale:1,...(sig?{sig}:{})} as any);}
 hit('p2','p0',c.weapon,c.raw??1000,c.sig);if(c.killShooter)hit('p0','p3','sword',1000);if(c.killVictim)hit('p2','p3','sword',1000);
 applyLedger(w);const after=w.systems.find(fn=>fn.name==='afterDamage');if(!after)throw Error('missing actual afterDamage');after(w,TICK_MS);
 return {setup:c,landed:w.combat.landed.map(h=>({victim:h.victim,by:h.by,amount:h.amount,sig:h.sig??null,weapon:h.weapon})),until:Number.isFinite(w.factions!.fighters.get('p2')?.rangedChillUntil)?w.factions!.fighters.get('p2')!.rangedChillUntil:null};}
writeFileSync(process.argv[2]??'parity/frost/ranged-ledger.json',JSON.stringify({format:'rh-frost-ranged-ledger/1',modules:HOLY_MODULES,kind:'trusted direct ledger setup; actual recordHit/applyLedger/installed afterDamage; not gameplay intake',cases:cases.map(run)},null,2)+'\n');console.log(`captured ${cases.length} actual ranged ledger cases`);

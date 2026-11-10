/** Capture only outputs from the unchanged TypeScript World/CardRuntime producer. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import * as S from '@raid/shared';
import {addPlayer,step as worldStep} from '../../packages/server/src/sim/step.ts';
import {createWorld} from '../../packages/server/src/sim/world.ts';
import {enqueueClientMessage} from '../../packages/server/src/sim/inputs.ts';
import {combatant} from '../../packages/server/src/sim/combatant.ts';
import {grantCard} from '../../packages/server/src/sim/chests.ts';
import {startRaid} from '../../packages/server/src/sim/step.ts';
import {cases} from './cases.mts';

assert.equal(process.version,'v22.23.4');
assert.equal(process.platform,'linux');
assert.equal(process.arch,'x64');
assert(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--check'));
Math.random=()=>{throw Error('undeclared randomness')};

const profiles:any={
  core:['loot','weapons','targeting','projectiles','mobs','buffs','feed','camps','chests','killAugments','mobLife','mobAI','terrainEffects','regen','abilities','quests','vision','campHeal','consumables','traders','cardHooks','mods'],
  full:['loot','weapons','targeting','projectiles','factions','mobs','buffs','feed','camps','chests','killAugments','mobLife','mobAI','terrainEffects','regen','abilities','quests','vision','campHeal','consumables','traders','cardHooks','plagueCorpses','fireRoam','bruiserPassives','sentencedHunt','mods','plagueZombies'],
};
const installers:any={};
for(const name of new Set(Object.values(profiles).flat() as string[]))
  installers[name]=(await import(`../../packages/server/src/sim/${name}.ts`)).install;
const hash=(bytes:any)=>createHash('sha256').update(bytes).digest('hex');
const plain=(v:any):any=>v===undefined?{$undefined:true}:typeof v==='number'&&!Number.isFinite(v)?{$float:String(v)}:v instanceof Map?[...v].map(([k,x])=>[k,plain(x)]):v instanceof Set?[...v].map(plain):ArrayBuffer.isView(v)?Array.from(v as any):Array.isArray(v)?v.map(plain):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([,x])=>typeof x!=='function').map(([k,x])=>[k,plain(x)])):v;
const absent=(v:any)=>v===undefined||v?.$undefined===true;
const copy=(v:any)=>structuredClone(v);
const sourceBytes=(p:string)=>hash(readFileSync(p));
function mapFor(){
  const w=40,h=24,tiles=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(x===0||y===0||x===w-1||y===h-1)tiles[y*w+x]=S.TILE_WALL;
  return S.mapFromTiles(w,h,tiles,0);
}
function build(input:any){
  let uid=0;const random=S.mulberry32(input.mainSeed??12);
  const w:any=createWorld({map:mapFor(),config:{minPlayers:input.players.length,lobbySeconds:30,fillSeconds:0,planSeconds:0,patienceSeconds:3600,patienceMinSeconds:3600,suddenDeathSeconds:60,hazards:false,wishLockSeconds:0,...input.config},random,rewardSalt:[1,2,3,4],questSalt:[5,6,7,8],newItemUid:()=>`U${++uid}`});
  for(const name of profiles[input.profile??'core'])installers[name](w);
  input.players.forEach((p:any,i:number)=>addPlayer(w,'p'+i,'bleed-'+i,{faction:p.faction}));
  const rows:any[]=[];
  const capture=(label:string,events:any[]=[],landedSnapshot:any[]=[],pass:any={})=>rows.push({
    label,tick:w.state.tick,time:w.state.serverTime,preDispatchPhase:pass.preDispatchPhase??null,
    arenaVoidedBefore:pass.arenaVoidedBefore??null,activePassEligible:pass.activePassEligible??false,
    phase:w.state.phase,inColiseum:w.state.inColiseum,
    players:[...w.state.players].map(([id,p]:any)=>({id,x:p.x,y:p.y,hp:p.hp,status:p.status})),
    landedSnapshot:plain(landedSnapshot),processedLanded:plain(pass.activePassEligible?landedSnapshot:[]),events:plain(events),
  });
  const tick=(label:string,inputs:any[]=[] )=>{
    for(const i of inputs){const actor=i.actor,payload=copy(i.payload);const accepted=enqueueClientMessage(w.players.get(actor).inputs,i.type,payload,{training:false});assert(accepted,`${label}: accepted ${i.type} from ${actor}`);}
    const preDispatchPhase=w.state.phase,arenaVoidedBefore=w.arena.voided===true;
    const activePassEligible=preDispatchPhase==='active'&&!arenaVoidedBefore;
    const events=worldStep(w,50),landedSnapshot=[...w.combat.landed];
    capture(label,events,landedSnapshot,{preDispatchPhase,arenaVoidedBefore,activePassEligible});
    return{events,landedSnapshot,activePassEligible};
  };
  // Normal lobby/start transition is an ordinary source step; cards and positions are declared bootstrap setup.
  tick('lobby-to-raid');assert.equal(w.state.phase,'active');
  for(let i=0;i<input.players.length;i++){
    const p=input.players[i],id='p'+i,c=combatant(w,id)!;
    Object.assign(c.s,p.at);c.rt.history=[{t:w.state.serverTime,x:p.at.x,y:p.at.y}];
    if(p.weapon!==undefined)c.s.weapon0=p.weapon;
    for(const card of p.cards??[])assert(grantCard(w,c as any,card),`declared valid card ${card}`);
    if(p.hp!==undefined)c.s.hp=p.hp;
  }
  capture('declared-setup');
  for(let ai=0;ai<input.actions.length;ai++){
    const a=input.actions[ai];
    if(a.kind==='step')tick(`action-${ai}`,a.inputs);
    else if(a.kind==='span')for(let n=0;n<a.count;n++)tick(`action-${ai}-step-${n+1}`);
    else if(a.kind==='setup'){
      const c=combatant(w,a.actor)!;if(a.hp!==undefined)c.s.hp=a.hp;
      if(a.at){Object.assign(c.s,a.at);c.rt.history=[{t:w.state.serverTime,x:c.s.x,y:c.s.y}];}
      capture(`action-${ai}-declared-setup`);
    }else if(a.kind==='startRaid'){
      startRaid(w,new Map([...w.state.players.keys()].map((id:string,i:number)=>[id,input.players[i].at])));
      capture(`action-${ai}-source-startRaid`);
    }else throw Error(`unknown closed action ${a.kind}`);
  }
  const cardContributions=rows.flatMap(r=>r.processedLanded.filter((h:any)=>h.dot===true&&absent(h.ability)&&absent(h.sig)).map((h:any)=>({tick:r.tick,time:r.time,victim:h.victim,by:h.by,amount:h.amount,weapon:h.weapon,passive:h.passive})));
  const cardFx=rows.flatMap(r=>r.events.filter((e:any)=>e.type==='fx'&&e.fx.kind==='hit'&&e.fx.weapon===null&&absent(e.fx.sig)&&absent(e.fx.ability)).map((e:any)=>({tick:r.tick,time:r.time,fx:e.fx})));
  return{name:input.name,input,trace:rows,cardContributions,cardFx,final:{tick:w.state.tick,time:w.state.serverTime,phase:w.state.phase,winner:w.state.winner},ordinarySteps:rows.filter(r=>/^action-\d+(?:-step-\d+)?$/.test(r.label)).length+1};
}

function filesBelow(root:string):string[]{return readdirSync(root,{withFileTypes:true}).flatMap(entry=>{const path=`${root}/${entry.name}`;return entry.isDirectory()?filesBelow(path):/\.(ts|mts|mjs|json|sh)$/.test(path)?[path]:[];}).sort();}
const sourceFiles=[...filesBelow('packages/shared/src'),...filesBelow('packages/server/src/sim'),'packages/server/src/rooms/FxChannel.ts','package.json','package-lock.json','tsconfig.base.json','packages/server/package.json','packages/shared/package.json'].sort();
const harnessFiles=filesBelow('tools/card-bleed-fixtures');
const provenance={baseRevision:'4151b3af',runtime:'Node.js22.23.4 Linuxamd64',image:'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',fixedStepMs:50,sourceInputs:sourceFiles.map(path=>({path,sha256:sourceBytes(path)})),harnessInputs:harnessFiles.map(path=>({path,sha256:sourceBytes(path)})),oracle:'all expected rows/events below are emitted by unchanged source; no expected report state is supplied and flushBleeds is never called'};
const captured:any[]=[];let activeInput:any=null;
function persistFailure(error:any){
  if(process.argv[2]==='--check')return;
  const outputPath=process.env.RH_CARD_BLEED_OUTPUT??'parity/card-bleed-feedback/source.json';
  const diagnostic={format:'rh-card-bleed-unadmitted-diagnostic/2',status:'UNADMITTED',failure:{name:error?.name??'Error',message:String(error?.message??error),stack:String(error?.stack??'')},failingCase:activeInput?.name??null,failingInput:activeInput,provenance,capturedCases:captured};
  writeFileSync(join(dirname(outputPath),'UNADMITTED.json'),JSON.stringify(diagnostic)+'\n');
}
try {
for(const input of cases){activeInput=input;captured.push(build(input));}
const named=(name:string)=>captured.find(c=>c.name===name)!;
const pairs=named('ordered-pairs-and-repeat-pair');
activeInput=pairs.input;
assert(pairs.cardContributions.length>0,'ordered-pairs case reached actual card DoT');
assert(new Set(pairs.cardContributions.map(h=>JSON.stringify([h.victim,h.by]))).size>=2,'ordered-pairs case reached multiple actual pairs');
assert(new Set(pairs.cardContributions.map(h=>JSON.stringify([h.victim,h.by]))).size<pairs.cardContributions.length,'ordered-pairs case repeats a pair contribution');
const periodic=named('first-use-clock-periodic-and-empty-interval');
activeInput=periodic.input;
assert(periodic.cardContributions.length>0,'periodic case reached actual card DoT');
assert(periodic.cardFx.length>0,'periodic case emitted source card feedback');
assert.equal(periodic.cardFx[0].time-periodic.cardContributions[0].time,500,'first-use report clock flushes at the source 500 ms boundary');
assert(periodic.final.time-periodic.cardContributions.at(-1).time>=500,'periodic case crosses an empty post-expiry interval');
assert(periodic.cardFx.every(h=>h.time<=periodic.cardContributions.at(-1).time+500),'empty periodic intervals emit no card feedback');
const ended=named('run-ended-before-periodic-window');
activeInput=ended.input;
assert.equal(ended.final.phase,'ended','run-ended case ended through ordinary settle');
assert(ended.cardContributions.length>0&&ended.cardFx.length>0,'run-ended case has a real contribution and flush');
assert(ended.cardFx.at(-1).time-ended.cardContributions[0].time<500,'run-ended feedback precedes the periodic boundary');
const endingPass=ended.trace.find(r=>r.label==='action-3-step-1')!;
const alreadyEnded=ended.trace.find(r=>r.label==='action-3-step-2')!;
assert.equal(endingPass.preDispatchPhase,'active','the natural ending step began in active phase');
assert.equal(endingPass.arenaVoidedBefore,false,'the natural ending step was not voided');
assert.equal(endingPass.activePassEligible,true,'the natural ending step ran the actual active producer pass');
assert.equal(endingPass.phase,'ended','the active producer pass itself ended the run');
assert.equal(alreadyEnded.preDispatchPhase,'ended','the following step began after run end');
assert.equal(alreadyEnded.activePassEligible,false,'already-ended step did not run the active producer pass');
assert(alreadyEnded.landedSnapshot.length>0,'already-ended raw landed scratch remains visible as source diagnostics');
assert.equal(alreadyEnded.processedLanded.length,0,'retained ended-step scratch is not a fresh processed contribution');
assert.equal(ended.cardContributions.length,5,'only the five actual active-pass bleed hits are fresh contributions');
const teleported=named('teleport-retains-partial-report');
activeInput=teleported.input;
const teleportRow=teleported.trace.find(r=>r.inColiseum===true);
assert(teleportRow,'teleport case reached the ordinary coliseum transition');
assert(teleported.cardContributions.some(h=>h.time<teleportRow.time),'teleport case accumulated a pre-teleport card contribution');
assert(teleported.cardFx.some(h=>h.time>teleportRow.time),'teleport case emitted the retained report after teleport');
const reset=named('raid-start-clears-partial-report');
activeInput=reset.input;
const resetRow=reset.trace.find(r=>r.label.endsWith('source-startRaid'))!;
assert(reset.cardContributions.some(h=>h.time<resetRow.time),'raid reset began with an actual partial report');
assert(reset.cardContributions.every(h=>h.time<=resetRow.time),'raid reset trace has no post-reset bleed contributions');
assert(reset.final.time-resetRow.time>=500,'raid reset case crosses the old report window after reset');
assert(reset.cardFx.every(h=>h.time>resetRow.time),'raid reset did not emit a pre-reset report');
const noncard=named('card-dot-excludes-fire-burn-and-backlash');
activeInput=noncard.input;
assert(noncard.cardContributions.length>0,'mixed-dot case reached card DoT');
const noncardSignatures=noncard.trace.flatMap(r=>r.processedLanded.filter((h:any)=>h.sig==='burn'||h.sig==='backlash'));
assert(noncardSignatures.some((h:any)=>h.sig==='burn'),'mixed-dot case reached actual Fire burn signature damage');
assert(noncardSignatures.some((h:any)=>h.sig==='backlash'),'mixed-dot case reached actual Fire backlash signature damage');
const control=named('no-card-dot-control');
activeInput=control.input;
assert.equal(control.cardContributions.length,0,'no-card control has no card-owned landed DoT');
assert.equal(control.cardFx.length,0,'no-card control has no card-only feedback');
const output={format:'rh-card-bleed-source/2',provenance,cases:captured};
const bytes=JSON.stringify(output)+'\n',path=process.env.RH_CARD_BLEED_OUTPUT??'parity/card-bleed-feedback/source.json';
if(process.argv[2]==='--check')assert.equal(readFileSync(path,'utf8'),bytes,'one canonical unchanged-source recapture');
else writeFileSync(path,bytes);
console.log(JSON.stringify({cases:output.cases.length,ordinarySteps:output.cases.reduce((n,c)=>n+c.ordinarySteps,0),bytes:Buffer.byteLength(bytes),sha256:hash(bytes)}));
}catch(error){persistFailure(error);throw error;}

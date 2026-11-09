// Actual World histories and extracted source human producers; no native outcome is an input.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Encoder,Decoder} from '@colyseus/schema';
import {RaidState} from '../../packages/shared/src/schema.ts';
import {FxChannel} from '../../packages/server/src/rooms/FxChannel.ts';
import {canPlayerSee} from '../../packages/server/src/sim/vision.ts';
import {captureWorldHistory} from './world.mts';
import {createHumanWitness} from './human.mts';
import {createBotWitness} from './bot.mts';

const [mode,out]=process.argv.slice(2);
assert(process.argv.length===4&&['--write','--check'].includes(mode)&&out);
assert.equal(process.version,'v22.23.4');assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
Math.random=()=>{throw Error('undeclared Math.random');};
const sha=(x:any)=>createHash('sha256').update(x).digest('hex');
function plain(x:any):any{
 if(x===undefined)return {$undefined:true};
 if(x===null||typeof x==='string'||typeof x==='boolean')return x;
 if(typeof x==='number')return Number.isFinite(x)&&!Object.is(x,-0)?x:{$number:Object.is(x,-0)?'-0':String(x)};
 if(Array.isArray(x))return x.map(plain);
 if(x instanceof Map)return {$map:[...x].map(([k,v])=>[plain(k),plain(v)])};
 if(x instanceof Set)return {$set:[...x].map(plain)};
 if(ArrayBuffer.isView(x))return Array.from(x as any);
 assert(typeof x==='object','unsupported source result '+typeof x);
 return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)]));
}
const channel=new FxChannel();
let encoder:any=null,human:any=null,bot:any=null,viewer:string|null=null;
const timeline:any[]=[];
const world=await captureWorldHistory(async({world,events,label,viewerId,targetId}:any)=>{
 // Actual Room/headless order: batch, append roster, encoded publication, then mark roster delivered.
 const fxBatch=channel.batch(events.filter((e:any)=>e.type==='fx').map((e:any)=>e.fx),world.state.serverTime,world.projectiles);
 channel.extendRoster(world.state);
 if(!encoder)encoder=new Encoder(world.state);
 const offset={offset:0};encoder.encodeAll(offset);
 const bytes=encoder.sharedBuffer.slice(0,offset.offset);
 const decoded=new RaidState();new Decoder(decoded).decode(bytes);
 channel.rosterSent();
 if(viewerId!==null&&!human){viewer=viewerId;human=createHumanWitness(world.map,viewerId);bot=createBotWitness(world.map,viewerId);}
 if(viewerId!==null)assert.equal(viewerId,viewer,'observer never changes across the history');
 const owner=viewerId?decoded.players.get(viewerId):null;
 const sourceTarget=targetId?world.state.mobs.get(targetId):null;
 timeline.push(plain({
  time:decoded.serverTime,label,viewerId,targetId,
  schema:{bytes:bytes.byteLength,sha256:sha(bytes),decodedNoSyncTickDefault:decoded.tick,kind:'actual full Schema snapshot; tick is noSync and retains the decoded default; not a socket/delta proof'},
  publication:{fxBatch,roster:[...decoded.roster]},
  sourceDiagnostic:{tick:world.state.tick,phase:decoded.phase,owner:owner?{id:viewerId,x:owner.x,y:owner.y,hp:owner.hp,status:owner.status,faction:owner.faction,weapon0:owner.weapon0,weapon1:owner.weapon1}:null,
   target:sourceTarget?{id:targetId,x:sourceTarget.x,y:sourceTarget.y,hp:sourceTarget.hp,status:sourceTarget.status}:null,
   targetInWorld:!!sourceTarget,canSeeTarget:sourceTarget&&viewerId?canPlayerSee(world,viewerId,sourceTarget):null,
   mobs:[...decoded.mobs].map(([id,m]:any)=>({id,kind:m.kind,type:m.type,status:m.status,x:m.x,y:m.y,hp:m.hp,maxHp:m.maxHp,camp:m.camp})),
   rawDecodedMobRows:[...decoded.mobs].map(([id,m]:any)=>({id,state:m.toJSON()})),
   camps:[...decoded.camps].map((c:any)=>({alive:c.alive,state:c.state,clearedAt:c.clearedAt,respawnAt:c.respawnAt,wardOwner:c.wardOwner,wardExpiresAt:c.wardExpiresAt}))},
  human:human?human.push(decoded):null,
  bot:bot?bot.push(decoded,events,world,fxBatch):null,
 }));
});
assert(timeline.length>0&&human&&bot,'real World must produce an active observer history');
assert.equal(timeline.length,(world as any).sourceStepCount,'every real source step reaches the publication/consumer pipeline');
const lifecycle=(world as any).actualLifecycle;
const targetId=lifecycle.targetId;
const targetRows=timeline.filter(t=>t.targetId===targetId);
assert(targetRows.length>0&&targetRows.every(t=>t.sourceDiagnostic.target?.status==='alive'),'same actual target stays alive throughout this living-return witness');
const hasHumanContact=(t:any)=>t.human?.inlineMinimapProducer.rows.some((m:any)=>m.id===targetId);
const hasHumanAdmission=(t:any)=>t.human?.extractedMobAdmissionPrefix.admittedRows.some((m:any)=>m.id===targetId);
const hasBotMob=(t:any)=>t.bot?.percept?.mobs.some((m:any)=>m.id===targetId);
const before=targetRows.filter(t=>t.time<=(world as any).lifecycleGaps.outboundStartedAt&&hasHumanContact(t)&&hasHumanAdmission(t)&&hasBotMob(t));
const hidden=targetRows.filter(t=>t.sourceDiagnostic.canSeeTarget===false&&!hasHumanContact(t)&&!hasHumanAdmission(t)&&!t.bot?.frame.minimap.mobs.some((m:any)=>m.id===targetId));
const returned=targetRows.filter(t=>t.time>(world as any).lifecycleGaps.returnQueuedAt&&hasHumanContact(t)&&hasHumanAdmission(t)&&hasBotMob(t));
assert(before.length>0,'actual human callback and composed bot actor both admit the living target before sight loss');
assert(hidden.length>0,'actual World/human/bot minimap all reach true living sight loss');
assert(returned.length>0,'actual human callback and composed bot actor both re-admit the same living target');
const lifeBelief=(t:any)=>t.bot?.memory.mobs.find((m:any)=>m.id===targetId)??null;
const derivedCoverage={classification:'derived only from captured source returns; never an input to World or consumers',targetId,
 priorOnScreen:{sourceTick:before.at(-1).sourceDiagnostic.tick,time:before.at(-1).time,memory:lifeBelief(before.at(-1))},
 livingHidden:{sourceTick:hidden.at(-1).sourceDiagnostic.tick,time:hidden.at(-1).time,memory:lifeBelief(hidden.at(-1))},
 sameLivingOnScreenAgain:{sourceTick:returned.at(-1).sourceDiagnostic.tick,time:returned.at(-1).time,memory:lifeBelief(returned.at(-1)),hunt:returned.at(-1).bot.hunt},
 observedMemoryCallsLivingReturnDead:lifeBelief(returned.at(-1))?.alive===false,
 counterexampleBoundary:'If the flag is true, it is a producer-consistent counterexample to treating minimap omission as authoritative death. It is not a source-bug or intended-behavior classification, hidden-death/replacement equivalence, or private-ID publication approval.'};
const walk=(p:string):string[]=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(p+'/'+e.name):[p+'/'+e.name]);
const pins=(paths:string[])=>Object.fromEntries([...new Set(paths)].sort().map(p=>[p,sha(readFileSync(p))]));
const sources=[...walk('packages/shared/src'),...walk('packages/client/src'),...walk('packages/server/src/sim'),...walk('packages/server/src/bots')].filter(p=>p.endsWith('.ts'));
sources.push('packages/server/src/rooms/FxChannel.ts');
const result=plain({format:'rh-npc-continuity-source/1',profile:{baseRevision:'197926e27747545934fb801e3df61ae7070905a2',node:process.version,platform:process.platform,arch:process.arch,
 image:'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',
 sourceInventory:'Explicit source superset, not every pinned file executed.',sourceSha256:pins(sources),
 configSha256:pins(['package.json','package-lock.json','tsconfig.base.json','packages/shared/package.json','packages/server/package.json','packages/client/package.json','packages/shared/tsconfig.json','packages/server/tsconfig.json','packages/client/tsconfig.json']),
 contractInputs:pins(['docs/REQUIREMENTS.md','docs/CONTRACTS.md']),toolSha256:pins(walk('tools/npc-continuity-fixtures').filter(p=>/\.(mts|mjs|sh|md|json)$/.test(p)))},
 boundaries:{source:'Actual queued-input World histories; all diagnostic private fields stay separate from actual human/bot method inputs.',human:'Exact source callback extraction is labelled separately from unrun full Phaser scene/Minimap/rendering. No display proof.',policy:'Consumer method outputs are not submitted actions or full-Brain outcomes.',privacy:'No automatic ID-only equivalence, hidden lifetime knowledge, intended-death rule, native/public-fact/P15 design or universal cap is admitted.'},
 world,humanProvenance:human.provenance,botProvenance:bot.provenance,derivedCoverage,timeline});
const bytes=JSON.stringify(result,null,1)+'\n';
if(mode==='--write')writeFileSync(out,bytes);else assert.equal(readFileSync(out,'utf8'),bytes,'byte-exact new actual NPC continuity witness');
console.log(JSON.stringify({mode,format:result.format,bytes:Buffer.byteLength(bytes),sha256:sha(bytes),steps:timeline.length,sourcePins:Object.keys(result.profile.sourceSha256).length,toolPins:Object.keys(result.profile.toolSha256).length}));

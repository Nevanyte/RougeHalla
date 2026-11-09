// Narrow actual caller extension; the old earned source history stays immutable.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {INTERP_DELAY_MS} from '@raid/shared';
import {BOT_FRAME_EVERY_TICKS} from '../../packages/server/src/bots/BotManager.ts';
import {BOT_FILL_DEFAULTS} from '../../packages/server/src/bots/brain/types.ts';
import {captureSourceHistory} from './source-history.mts';
import {runRunnerProfile} from './runner.mts';

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
 assert(typeof x==='object','unsupported actual result '+typeof x);
 return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)]));
}
const actual=await captureSourceHistory();
const snapshots=actual.snapshots as any[];
assert.equal(snapshots.length,773);
const viewerId=snapshots[0].observerId,targetId=snapshots[0].targetId;
assert(typeof viewerId==='string'&&typeof targetId==='string');
assert(snapshots.every(s=>s.observerId===viewerId&&s.targetId===targetId),'the earned observer and target never change');
assert(snapshots.every(s=>s.fxBatch===null),'this exact earned history has no FX batches; no missing buffered cues are inferred');
const profiles=[{id:'network-every-patch',every:1,phase:0,selfDelayMs:0,worldDelayMs:INTERP_DELAY_MS},
 ...Array.from({length:BOT_FRAME_EVERY_TICKS},(_,phase)=>({id:`manager-default-phase-${phase}`,every:BOT_FRAME_EVERY_TICKS,phase,selfDelayMs:BOT_FILL_DEFAULTS.latencyMs,worldDelayMs:INTERP_DELAY_MS+BOT_FILL_DEFAULTS.latencyMs}))];
const runs:any[]=[];
for(const profile of profiles){
 const args={map:actual.map,viewerId,targetId,snapshots,profile};
 const off=await runRunnerProfile({...args,observeMemory:false});
 const on=await runRunnerProfile({...args,observeMemory:true});
 const offTrace=JSON.stringify(plain(off.publicTrace)),onTrace=JSON.stringify(plain(on.publicTrace));
 assert.equal(onTrace,offTrace,'Memory inspection must not change any recorded public runner/Brain input or output: '+profile.id);
 assert.equal(off.privateMemoryRows.length,0,'observer OFF never reads private Memory');
 const changed=on.rows.filter((r:any)=>r.fullPrefilterInputSha256!==r.fullPostfilterInputSha256);
 runs.push({profile,observerNoninterference:{passed:true,offPublicTraceSha256:sha(offTrace),onPublicTraceSha256:sha(onTrace),publicTraceBytes:Buffer.byteLength(onTrace),comparison:'every recorded public Frame/pre-post Percept/original tick return/adapter attempt/runner result/log/goal/stat; no field normalization or identity renaming',offSummary:off.summary,offInspectionTrace:off.inspectionTrace,offInspectionLifetime:off.inspectionLifetime,offProvenance:off.provenance},
  filterChanges:{callsWithDifferentFullPercept:changed.length,firstExamples:changed.slice(0,4)},actual:on});
}
const walk=(p:string):string[]=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(p+'/'+e.name):[p+'/'+e.name]);
const pins=(paths:string[])=>Object.fromEntries([...new Set(paths)].sort().map(p=>[p,sha(readFileSync(p))]));
const sources=[...walk('packages/shared/src'),...walk('packages/client/src'),...walk('packages/server/src/sim'),...walk('packages/server/src/bots')].filter(p=>p.endsWith('.ts'));
sources.push('packages/server/src/rooms/FxChannel.ts');
const result=plain({format:'rh-npc-runner-callsite/1',profile:{baseRevision:'76ea6b995d3f2d7f844c1ff65f9a0750094a68c7',node:process.version,platform:process.platform,arch:process.arch,
 image:'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',sourceInventory:'Explicit superset, not every pinned source file executed.',sourceSha256:pins(sources),
 configSha256:pins(['package.json','package-lock.json','tsconfig.base.json','packages/shared/package.json','packages/server/package.json','packages/client/package.json','packages/shared/tsconfig.json','packages/server/tsconfig.json','packages/client/tsconfig.json']),
 supportSha256:pins([...walk('tools/npc-continuity-fixtures'),'tools/card-runtime-fixtures/private-inspection.mts','parity/policy/npc-continuity/source.json']),
 contractInputs:pins(['docs/REQUIREMENTS.md','docs/CONTRACTS.md']),toolSha256:pins(walk('tools/npc-runner-callsite-fixtures').filter(p=>/\.(mts|mjs|sh|md|json)$/.test(p)))},
 boundaries:{purpose:'actual vision:true public runner and actual source Brain on the same earned immutable full Schema history; private Memory reads are audit data only',openLoop:'actual commands recorded/refused and never applied to World; no closed-loop policy/humanizer acceptance/survival/game outcome claim',drivers:'network and default four-phase manager source-schedule models, not socket or actual BotManager lifecycle/startup-contention execution',clock:'fixed source timestamps/declared zero-jitter replay, not physical performance or wall-clock network timing',privacy:'no hidden pair, intended-rule/sourcebug decision, public lifetime/ID contract, native/P15/ABI/budget/tag/main admission'},
 sourceHistory:{provenance:actual.provenance,mapSummary:{seed:actual.map.seed,w:actual.map.w,h:actual.map.h,tilesSha256:sha(actual.map.tiles),spawns:actual.map.spawns,camps:actual.map.camps},snapshots:snapshots.map(s=>({sourceTick:s.sourceTick,serverTime:s.sourceTime,bytes:s.bytes.byteLength,sha256:sha(s.bytes),fxBatch:s.fxBatch})),priorMethodReference:(actual.reference as any).derivedCoverage},runs});
const bytes=JSON.stringify(result,null,1)+'\n';
if(mode==='--write')writeFileSync(out,bytes);else assert.equal(readFileSync(out,'utf8'),bytes,'byte-exact new actual runner callsite witness');
console.log(JSON.stringify({mode,format:result.format,bytes:Buffer.byteLength(bytes),sha256:sha(bytes),snapshots:snapshots.length,profiles:runs.length,observerControls:runs.filter(r=>r.observerNoninterference.passed).length,sourcePins:Object.keys(result.profile.sourceSha256).length,toolPins:Object.keys(result.profile.toolSha256).length}));

// Additive actual legacy publication/perception evidence. No native code or expected gameplay result is an input.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const ROOT=resolve(process.env.RH_BOT_PUBLIC_SOURCE_ROOT??process.cwd());
const [mode,output]=process.argv.slice(2);
assert(process.argv.length===4&&['--write','--check'].includes(mode)&&output);
assert.equal(process.version,'v22.23.4');assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
Math.random=()=>{throw Error('undeclared Math.random');};
const sha=(value:any)=>createHash('sha256').update(value).digest('hex');
function plain(value:any):any{
 if(value===undefined)return {$undefined:true};
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number')return Number.isFinite(value)&&!Object.is(value,-0)?value:{$number:Object.is(value,-0)?'-0':String(value)};
 if(Array.isArray(value))return value.map(plain);
 if(value instanceof Map)return {$map:[...value].map(([k,v])=>[plain(k),plain(v)])};
 if(value instanceof Set)return {$set:[...value].map(plain)};
 assert(typeof value==='object','unsupported result type: '+typeof value);
 return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,plain(v)]));
}
const load=(p:string)=>import(pathToFileURL(ROOT+'/'+p).href);
const {captureNpcWitness}=await load('tools/bot-public-facts-fixtures/npc.mts');
const {captureFlightWitness}=await load('tools/bot-public-facts-fixtures/flight.mts');
const npcRaw=plain(await captureNpcWitness());
const flightRaw=plain(await captureFlightWitness());
const {provenance:npcProvenance,...npc}=npcRaw;
const {provenance:flightProvenance,...flight}=flightRaw;
const walk=(dir:string):string[]=>readdirSync(ROOT+'/'+dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+'/'+e.name):[dir+'/'+e.name]);
const inventory=(paths:string[])=>Object.fromEntries([...new Set(paths)].sort().map(p=>[p,sha(readFileSync(ROOT+'/'+p))]));
const sourcePaths=[...walk('packages/shared/src'),...walk('packages/server/src/bots'),...walk('packages/server/src/sim'),...walk('packages/client/src')].filter(p=>p.endsWith('.ts'));
sourcePaths.push('packages/server/src/rooms/FxChannel.ts');
const sourceLiteral=(path:string,name:string)=>{const source=readFileSync(ROOT+'/'+path,'utf8');const re=new RegExp('const '+name+'\\s*=\\s*([0-9_]+)\\s*;');const m=source.match(re);assert(m,'actual source numeric literal '+path+':'+name);return {path,name,value:Number(m[1].replaceAll('_','')),classification:name==='MAX_DOTS'?'human display-dot cap, not a producer population bound':'consumer retention policy, not a producer population bound'};};
const S=await load('packages/shared/src/index.ts');
const bounds={
 retention:[sourceLiteral('packages/server/src/bots/brain/frames.ts','MAX_FRAMES'),sourceLiteral('packages/server/src/bots/brain/frames.ts','MAX_QUEUED'),sourceLiteral('packages/server/src/bots/brain/frames.ts','DONE_MAX'),sourceLiteral('packages/server/src/bots/brain/tactics/kite.ts','REMEMBER'),sourceLiteral('packages/client/src/ui/minimap.ts','MAX_DOTS')],
 catalogFlights:['bow','wand'].map(weapon=>{const shape=S.WEAPONS[weapon].shape;assert.equal(shape.kind,'projectile');return {weapon,speed:shape.speed,range:shape.range,derivedBaseFlightMs:1000*shape.range/shape.speed,assumption:'catalog rangeMult=1; no collision/guidance/reflection duration proof or total population claim'};}),
 boundStatus:'No universal actor/projectile/cue/room-lifetime cap proved. Conditional estimate requires attackers, emission multiplicity and interval minima, range modifiers, lifespan and reflection proofs. Source insertion and mode/lifetime analysis are recorded separately; 4096 is not admitted as a protocol cap.'
};
const result={format:'rh-bot-public-facts-source/1',profile:{
 baseRevision:'a3d4b3ce575442c9a06916888035ca849a6cd05a',node:process.version,platform:process.platform,arch:process.arch,
 image:'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',
 moduleProvenance:{npc:npcProvenance??null,flight:flightProvenance??null},
 sourceInventory:'Explicit superset: shared/client TS, server sim/bots TS, actual FxChannel. Includes non-executed source anchors; not a claim every pinned file ran.',
 sourceSha256:inventory(sourcePaths),
 configSha256:inventory(['package.json','package-lock.json','tsconfig.base.json','packages/shared/package.json','packages/server/package.json','packages/client/package.json','packages/shared/tsconfig.json','packages/server/tsconfig.json']),
 toolSha256:inventory(walk('tools/bot-public-facts-fixtures').filter(p=>/\.(mts|mjs|sh|json|md)$/.test(p))),
 contractInputs:inventory(['docs/REQUIREMENTS.md','docs/CONTRACTS.md']),
 role:'Source evidence only. Each case names actual producers vs declared schema/public method inputs. Raw schema/publication diagnostics are not permission to give hidden fields to policies. No native parity/full bot/P15 wire/World population admission.'
},bounds,npc,flight};
const {verify}=await load('tools/bot-public-facts-fixtures/verify.mjs');
verify(result);
const bytes=JSON.stringify(result,null,1)+'\n';
if(mode==='--write')writeFileSync(output,bytes);else assert.equal(readFileSync(output,'utf8'),bytes,'byte-exact new public-facts source witness');
console.log(JSON.stringify({mode,format:result.format,bytes:Buffer.byteLength(bytes),sha256:sha(bytes),sourcePins:Object.keys(result.profile.sourceSha256).length,toolPins:Object.keys(result.profile.toolSha256).length}));

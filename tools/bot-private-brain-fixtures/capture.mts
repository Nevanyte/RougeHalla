import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync,statSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Session} from 'node:inspector/promises';
import {ROOT,mapWire,deriveSource,wiring} from './runtime.mts';
import {MAPS} from './builders.mts';
import {encode} from './codec.mts';
import {cases} from './cases.mts';
import {runCase,knowledgeDependency} from './runner.mts';
import {handSupplement} from './hand.mts';
import {checkedDispatch,validate,readerControls} from './verify.mjs';
import {reachedChecks} from './checks.mts';
const [mode,out]=process.argv.slice(2);assert(['--write','--check'].includes(mode));assert(out);
assert.equal(process.version,'v22.23.4');assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
const hash=(v:any)=>createHash('sha256').update(v).digest('hex');
const pin=(p:string)=>({bytes:statSync(p).size,sha256:hash(readFileSync(p))});
const allSpecs=cases(),specs=allSpecs.filter(c=>!process.env.RH_BOT_BRAIN_CASES||process.env.RH_BOT_BRAIN_CASES.split(',').includes(c.id));
const inspector=new Session();inspector.connect();const imports=new Set<string>();
inspector.on('Debugger.scriptParsed',(m:any)=>{const p=m.params.url.replace(/^file:\/\//,'');if(p.startsWith(ROOT+'/packages/')&&p.endsWith('.ts'))imports.add(p.slice(ROOT.length+1));});
await inspector.post('Profiler.enable');await inspector.post('Debugger.enable');await inspector.post('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
const results:any[]=[],coverage:any[]=[],transformed:any={},instrumentationChecks:any[]=[];
function effects(c:any){return c.operations.map((o:any)=>({method:o.method,result:o.result,error:o.error,brains:Object.fromEntries(Object.entries<any>(o.brains).map(([h,b])=>[h,{goal:b.goal,stats:b.stats,memory:b.memory}])),services:o.services,logs:o.trace.filter((t:any)=>t.name==='services.log').map((t:any)=>({args:t.args,result:t.result}))}));}
for(const spec of specs){
 const r=checkedDispatch(spec,runCase);assert.deepEqual(checkedDispatch(spec,runCase),r,spec.id+': exact recreate');
 if(!process.env.RH_BOT_BRAIN_MUTANT){assert.deepEqual(effects(runCase(spec,false)),effects(r),spec.id+': observational wrappers preserve all source effects');instrumentationChecks.push({case:spec.id,result:'IDENTICAL',effectsSha256:hash(JSON.stringify(effects(r)))});}
 results.push(r);
 const taken=await inspector.post('Profiler.takePreciseCoverage');const scripts:any[]=[];
 for(const s of taken.result){if(!s.url.includes('/bots/'))continue;const path=s.url.replace(/^file:\/\//,'').replace(ROOT+'/','');
  if(!transformed[path]){const fetched=await inspector.post('Debugger.getScriptSource',{scriptId:s.scriptId});transformed[path]={sha256:hash(fetched.scriptSource),text:fetched.scriptSource};}
  scripts.push({path,functions:s.functions.map((f:any)=>({name:f.functionName,isBlockCoverage:f.isBlockCoverage,ranges:f.ranges}))});
 }coverage.push({id:spec.id,scripts:scripts.sort((a,b)=>a.path.localeCompare(b.path))});
}
const supplement=handSupplement();assert.deepEqual(handSupplement(),supplement);
await inspector.post('Profiler.stopPreciseCoverage');inspector.disconnect();
function walk(base:string,rel:string,accept:(p:string)=>boolean):string[]{return readdirSync(join(base,rel),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>e.isDirectory()?walk(base,join(rel,e.name),accept):accept(join(rel,e.name))?[join(rel,e.name)]:[]);}
const toolsDir=dirname(fileURLToPath(import.meta.url));
const sourceInventory=Object.fromEntries([...walk(ROOT,'packages/shared/src',p=>p.endsWith('.ts')),...walk(ROOT,'packages/server/src/bots',p=>p.endsWith('.ts'))].map(p=>[p,pin(join(ROOT,p))]));
const protectedRoots=['tools/bot-private-strategy-fixtures','tools/bot-private-tactics-fixtures','tools/bot-private-modules-fixtures','tools/bot-module-goal-key-fixtures','tools/knowledge-repair-fixtures','tools/bot-brain-prefix-fixtures','parity/policy/bot-private-strategy','parity/policy/bot-private-tactics','parity/policy/bot-private-modules','parity/policy/bot-module-goal-key','parity/policy/bot-brain-prefix'];
const oldFiles=[...new Set([...protectedRoots.flatMap(rel=>walk(ROOT,rel,()=>true)),...walk(ROOT,'parity/policy',p=>!p.startsWith('parity/policy/bot-private-brain/'))])].sort();
const profile={sourceBase:'74e91370b6456f037d1780acf9337b7eab03c6bc',boundary:'Actual unchanged createBrain/Memory/Strategy/Tactics/Humanizer/Knowledge/built-ins/RoomPathService. Declared private Percepts, not earned/public observations. Caller extensions separately labelled.',image:'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',node:process.version,platform:process.platform,arch:process.arch,runtimeVersions:process.versions,numberEncoding:'Raw binary64 via roundtrip JSON numbers; MethodValue tags preserve -0, Undefined, Null, nonfinite and ordered object/Map/Set values. No rounding.',diagnosticOperations:'After each declared operation, call actual Brain.goal/stats getters and immediately snapshot retained live Memory and real path stats. These diagnostic getters do not advance source state.',
 observer:'Neutral first FeatureModule wraps exposed RNG functions/Knowledge methods without extra draws. Per-Brain rng identity; approved observational wrappers on actual built-in singleton methods forward exact this/arguments/return identity; descriptors restored in finally. Instrumented-vs-uninstrumented complete histories checked. No installed Memory or private getter. Real live Memory retained for path-before-observe. Original built-in singleton objects and registry order preserved.',
 knowledge:'All70 constructor draws in separately labelled actual-source dependency; actual derive extracted read-only using knowledge-repair recipe. Runtime public odds nested helpers remain closed.',deriveSource,wiring,
 codecProvenance:{path:'tools/bot-private-modules-fixtures/codec.mts',...pin(join(ROOT,'tools/bot-private-modules-fixtures/codec.mts'))},
 readerProvenance:{path:'tools/bot-private-modules-fixtures/verify.mjs',...pin(join(ROOT,'tools/bot-private-modules-fixtures/verify.mjs')),adaptation:'parseRaw/decode/percept prefix copied; lobby allowed; new Brain reader validates all declarations before dispatch'},
 actualRuntimeImports:Object.fromEntries([...imports].sort().map(p=>[p,pin(join(ROOT,p))])),sourceInventory,sourceInventorySha256:hash(JSON.stringify(sourceInventory)),
 configFiles:Object.fromEntries(['package-lock.json','package.json','tsconfig.base.json',...['server','shared','client'].flatMap(p=>['packages/'+p+'/package.json','packages/'+p+'/tsconfig.json'])].map(p=>[p,pin(join(ROOT,p))])),
 protectedFiles:Object.fromEntries(oldFiles.map(p=>{try{return[p,pin(join(ROOT,p))];}catch{return[p,{absent:true}];}})),
 dependencyVersions:Object.fromEntries(['tsx','typescript','esbuild'].map(p=>[p,JSON.parse(readFileSync(join(ROOT,'node_modules',p,'package.json'),'utf8')).version])),
 toolFiles:Object.fromEntries(walk(toolsDir,'',p=>!p.endsWith('.log')).map(p=>['tools/bot-private-brain-fixtures/'+p,pin(join(toolsDir,p))]))};
const body={format:'rh-bot-private-brain-source/1',methodValue:'rh-method-value/1',profile,maps:Object.entries(MAPS).map(([id,map]:any)=>({id,mapHashU32:mapWire.mapHashU32(map),value:encode(map)})),knowledgeDependencies:knowledgeDependency(specs,results),handSupplement:supplement,cases:results};
validate(body);
const negatives=process.env.RH_BOT_BRAIN_MUTANT?[]:readerControls(body,allSpecs);
const reached=process.env.RH_BOT_BRAIN_MUTANT?{}:reachedChecks(results,supplement);
const ledger={format:'rh-bot-private-brain-coverage/1',interpretation:'V8 block counts: two instrumented exact recreations plus one uninstrumented effects replay per normal case; declared labels are not coverage. Reached semantic assertions and explicit limits bind claims.',readerControls:negatives,reached,instrumentationChecks,transformedSources:transformed,cases:coverage};
for(const[name,value]of [['source.json',body],['coverage.json',ledger]]as const){const bytes=JSON.stringify(value)+'\n',p=join(out,name);if(mode==='--write')writeFileSync(p,bytes);else assert.equal(hash(readFileSync(p)),hash(bytes),name+': exact bytes');console.log(JSON.stringify({mode,file:name,bytes:Buffer.byteLength(bytes),sha256:hash(bytes),cases:results.length,operations:results.reduce((n,c)=>n+c.operations.length,0)}));}

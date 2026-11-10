import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync,statSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Session} from 'node:inspector/promises';
import {ROOT,mapWire} from './runtime.mts';
import {MAPS} from './builders.mts';
import {encode} from './codec.mts';
import {cases} from './cases.mts';
import {reachedChecks} from './checks.mts';
import {runCase} from './runner.mts';
import {decode,validate,readerControls} from './verify.mjs';
const[mode,out]=process.argv.slice(2);assert(['--write','--check'].includes(mode));assert(out);
assert.equal(process.version,'v22.23.4');assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
const hash=(v:any)=>createHash('sha256').update(v).digest('hex'),pin=(p:string)=>({bytes:statSync(p).size,sha256:hash(readFileSync(p))});
const specs=cases().filter(c=>!process.env.RH_BOT_TACTICS_CASES||process.env.RH_BOT_TACTICS_CASES.split(',').includes(c.id));
const inspector=new Session();inspector.connect();const imports=new Set<string>();
inspector.on('Debugger.scriptParsed',(m:any)=>{const p=m.params.url.replace(/^file:\/\//,'');if(p.startsWith(ROOT+'/packages/')&&p.endsWith('.ts'))imports.add(p.slice(ROOT.length+1));});
await inspector.post('Profiler.enable');await inspector.post('Debugger.enable');await inspector.post('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
const results:any[]=[],coverage:any[]=[],transformed:any={};
for(const spec of specs){const r=runCase(spec);assert.deepEqual(runCase(spec),r,spec.id+': recreate exact transcript');results.push(r);const taken=await inspector.post('Profiler.takePreciseCoverage');const scripts:any[]=[];
 for(const s of taken.result){if(!s.url.endsWith('/tactics.ts')&&!s.url.includes('/tactics/'))continue;const path=s.url.replace(/^file:\/\//,'').replace(ROOT+'/','');
  if(!transformed[path]){const fetched=await inspector.post('Debugger.getScriptSource',{scriptId:s.scriptId});transformed[path]={sha256:hash(fetched.scriptSource),text:fetched.scriptSource};}
  scripts.push({path,functions:s.functions.map((f:any)=>({name:f.functionName,isBlockCoverage:f.isBlockCoverage,ranges:f.ranges}))});
 }coverage.push({id:spec.id,suite:spec.suite,declaredIntent:spec.covers,scripts:scripts.sort((a,b)=>a.path.localeCompare(b.path))});}
await inspector.post('Profiler.stopPreciseCoverage');inspector.disconnect();
function walk(base:string,rel:string,accept:(p:string)=>boolean):string[]{return readdirSync(join(base,rel),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>e.isDirectory()?walk(base,join(rel,e.name),accept):accept(join(rel,e.name))?[join(rel,e.name)]:[]);}
const toolsDir=dirname(fileURLToPath(import.meta.url));
const sourceInventory=Object.fromEntries([...walk(ROOT,'packages/shared/src',p=>p.endsWith('.ts')),...walk(ROOT,'packages/server/src/bots',p=>p.endsWith('.ts'))].map(p=>[p,pin(join(ROOT,p))]));
const profile={sourceBase:'10519519bd4d9a5b55b1bf3042500d20c7ff4ea0',boundary:'Declared chronological private createTactics/Memory and exported dependency method inputs. Real default dependencies. Not World/earned/public intake/Brain/live policy.',image:'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',node:process.version,platform:process.platform,arch:process.arch,
 random:'Independent mulberry32 seed+0 decide,+1 motor,+2 lapse,+3 Knowledge. No createBrain derivation claim; no scripted draws.',path:'Real createPathService on explicit declared maps, actual budget.startTick/setFrame. Optional argument-sensitive radius-denial/half-plane descriptor; every full argument/result recorded. Not result tape.',
 actualRuntimeImports:Object.fromEntries([...imports].sort().map(p=>[p,pin(join(ROOT,p))])),sourceInventory,sourceInventorySha256:hash(JSON.stringify(sourceInventory)),
 configFiles:Object.fromEntries(['package-lock.json','package.json','tsconfig.base.json',...['server','shared','client'].flatMap(p=>['packages/'+p+'/package.json','packages/'+p+'/tsconfig.json'])].map(p=>[p,pin(join(ROOT,p))])),
 compatibilityCorpora:Object.fromEntries(['parity/policy/bot-fight/source.json','parity/policy/bot-sd/source.json','parity/policy/bot-reflex/source.json','parity/policy/bot-core.json'].map(p=>[p,pin(join(ROOT,p))])),
 dependencyVersions:Object.fromEntries(['tsx','typescript','esbuild'].map(p=>[p,JSON.parse(readFileSync(join(ROOT,'node_modules',p,'package.json'),'utf8')).version])),
 toolFiles:Object.fromEntries(walk(toolsDir,'',p=>!p.endsWith('.log')).map(p=>['tools/bot-private-tactics-fixtures/'+p,pin(join(toolsDir,p))]))};
const body={format:'rh-bot-private-tactics-source/1',methodValue:'rh-method-value/1',profile,maps:Object.entries(MAPS).map(([id,map]:any)=>({id,mapHashU32:mapWire.mapHashU32(map),value:encode(map)})),cases:results};
validate(body);const negatives=readerControls(body);
const goals=new Set<string>(),statuses=new Set<string>();for(const c of results)for(const o of c.operations)if(o.method==='act'){goals.add(decode(o.declaration).goal.kind);if(!o.thrown)statuses.add(decode(o.result,true).status.state);}
if(!process.env.RH_BOT_TACTICS_MUTANT){assert.equal(goals.size,9);assert.equal(statuses.size,4);}
const reached=process.env.RH_BOT_TACTICS_MUTANT?[]:reachedChecks(results);
const ledger={reachedAssertions:reached,format:'rh-bot-private-tactics-coverage/1',interpretation:'V8 block counts on unchanged tsx source, two recreations per case. Declared intent is not proof; reached semantic assertions and explicit gaps in evidence/ledger bind closure claims.',goals:[...goals].sort(),statuses:[...statuses].sort(),readerControls:negatives,transformedSources:transformed,cases:coverage};
for(const[name,value]of [['source.json',body],['coverage.json',ledger]]as const){const bytes=JSON.stringify(value)+'\n',p=join(out,name);if(mode==='--write')writeFileSync(p,bytes);else assert.equal(hash(readFileSync(p)),hash(bytes),name+': exact bytes');console.log(JSON.stringify({mode,file:name,bytes:Buffer.byteLength(bytes),sha256:hash(bytes),cases:results.length,operations:results.reduce((n,c)=>n+c.operations.length,0)}));}

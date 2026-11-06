/** Focused actual-source companion; expected values come exclusively from the frozen executor. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
assert.equal(process.version,'v22.23.4');assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
assert(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--check'));
Math.random=()=>{throw Error('undeclared randomness')};
const sha=(v:any)=>createHash('sha256').update(v).digest('hex');
const frozen=JSON.parse(readFileSync('tools/ability-refund-fixtures/frozen-inputs.json','utf8'));
const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(dir+'/'+d.name):[dir+'/'+d.name]).sort();
const inventory=(paths:string[])=>paths.map(path=>({path,sha256:sha(readFileSync(path))}));
for(const f of [frozen.corpus,...frozen.source,...frozen.harness])assert.equal(sha(readFileSync(f.path)),f.sha256,f.path+' immutable input');
const sourcePaths=[...walk('packages/shared/src'),...walk('packages/server/src/sim'),'packages/server/src/bots/brain/perception.ts','packages/server/src/rooms/FxChannel.ts','package.json','package-lock.json','tsconfig.base.json'].filter(p=>/\.(ts|json)$/.test(p)).sort();
assert.deepEqual(sourcePaths,frozen.source.map((f:any)=>f.path),'complete original source inventory');
assert.deepEqual(walk('tools/ability-fixtures'),frozen.harness.map((f:any)=>f.path),'complete original harness inventory');
const {run,plain,profiles}=await import('../ability-fixtures/engine.mts');
const {cases}=await import('./cases.mts');const {verify}=await import('./assertions.mts');
const trace=cases.map(input=>{process.stderr.write('source '+input.name+'\n');return run(input);});verify(trace);
const provenance={runtime:'Node.js22.23.4 linuxamd64',image:'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',compiler:{tsx:JSON.parse(readFileSync('node_modules/tsx/package.json','utf8')).version,esbuild:JSON.parse(readFileSync('node_modules/esbuild/package.json','utf8')).version,packageLockSha256:sha(readFileSync('package-lock.json'))},fixedStepMs:50,unchangedAbilityCorpus:frozen.corpus,sourceInventory:frozen.source,frozenHarnessInventory:frozen.harness,companionHarnessInventory:inventory(walk('tools/ability-refund-fixtures'))};
const output=plain({format:'rh-ability-refund-source/1',provenance,roles:{input:'declared existing ordinary player placement bootstrap plus real queued client Cast and actual ordinary timer teleports and an administrative removal; no clock jump or cast injection',expected:'unchanged TypeScript source executor ordinary50ms steps, full state, complete nonempty event and ordinary hook tapes and RNG tape',private:'server-only oracle producer/rollback/stock/arena facts; no observation or native admission claim'},profiles:{core:profiles.core},cases:trace});
const bytes=JSON.stringify(output)+'\n',path=process.env.RH_ABILITY_REFUND_OUTPUT??'parity/ability-refund/source.json';
const inventoryBytes=JSON.stringify({format:'rh-ability-refund-input-sha256/1',...provenance},null,2)+'\n',inventoryPath=join(dirname(path),'INPUT_SHA256.json');
if(process.argv[2]==='--check'){assert.equal(readFileSync(path,'utf8'),bytes,'canonical source recapture bytes');assert.equal(readFileSync(inventoryPath,'utf8'),inventoryBytes,'canonical input SHA inventory');}
else{writeFileSync(path,bytes);writeFileSync(inventoryPath,inventoryBytes);}
process.stdout.write(JSON.stringify({cases:trace.length,ordinarySteps:trace.reduce((n,c)=>n+c.ordinarySteps,0),sha256:sha(bytes),bytes:Buffer.byteLength(bytes)})+'\n');

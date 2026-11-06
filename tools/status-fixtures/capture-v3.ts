/** Source-only v3 addendum; original package bodies are never changed. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {mobStatReward,MOB_STAT_COUNT_MAX} from '@raid/shared';
import {captureStatusProbes} from './probe-v3';
import {v3Cases,v3Names} from './cases-v3';
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw Error('requires canonical Linux amd64 Node22.23.4');
let check=false,outputArg:string|undefined;const seen=new Set<string>();for(const arg of process.argv.slice(2)){const key=arg==='--check'?'check':arg.startsWith('--output=')?'output':null;if(key===null||seen.has(key)||key==='output'&&arg.length===9)throw Error('invalid v3 capture arguments: '+arg);seen.add(key);if(key==='check')check=true;else outputArg=arg.slice(9);}
assert.deepEqual(v3Cases.map(c=>c.name),v3Names);assert.equal(new Set(v3Names).size,4);
// The two new privileged setup operations are closed and checked before creating any World.
for(const c of v3Cases)for(const op of c.operations){
 if(op.kind==='mapReplace'){assert.deepEqual(Object.keys(op).sort(),['kind','rows']);assert.equal(op.rows.length,20);for(const row of op.rows){assert.equal(typeof row,'string');assert.equal(row.length,40);assert.match(row,/^[.#~]+$/);}}
 if(op.kind==='farmSetup'){assert.deepEqual(Object.keys(op).sort(),['counts','id','kind']);assert.equal(typeof op.id,'string');const keys=new Set<string>();assert(op.counts.length>0);for(const pair of op.counts){assert.equal(pair.length,2);assert.equal(pair[0],'rotMonk');assert(!keys.has(pair[0]));keys.add(pair[0]);assert(Number.isSafeInteger(pair[1])&&pair[1]>=0&&pair[1]<=MOB_STAT_COUNT_MAX);}}
}
const root=fileURLToPath(new URL('../../',import.meta.url));const names=[...JSON.parse(readFileSync(new URL('./source-inventory.json',import.meta.url),'utf8')),'parity/legacy-capture/status-probes.ts','parity/legacy-capture/canon.ts','parity/legacy-capture/intake.ts','tools/status-fixtures/capture.ts','tools/status-fixtures/runtime-cases.ts','tools/status-fixtures/source-inventory.json','tools/status-fixtures/case-inventory.json','package.json','package-lock.json','tsconfig.base.json','packages/shared/package.json','packages/server/package.json','tools/status-fixtures/probe-v3.ts','tools/status-fixtures/cases-v3.ts','tools/status-fixtures/capture-v3.ts'];
const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');const sourceSha256=Object.fromEntries(names.map(p=>[p,hash(join(root,p))]));const reward=mobStatReward('rotMonk');assert(reward&&reward.effect.k==='stat'&&reward.effect.stat==='lifesteal');
const policies={farmLifesteal:{mobType:reward.id,effect:reward.effect,countMax:MOB_STAT_COUNT_MAX}};
const result={format:'rh-status-probes/1',slice:'review-boundaries/3',provenance:{base:'d1027eac93be54ec9e37435ab71c2e97a3aafdc9',node:process.version,nodeSha256:hash(process.execPath),platform:process.platform,arch:process.arch,scope:'Exactly four trusted source witnesses: current queued displacement state and nonneutral actual healing/farm fold; no new producer claims',sourceSha256},policies,...captureStatusProbes(v3Cases)};
assert.deepEqual(Object.fromEntries(names.map(p=>[p,hash(join(root,p))])),sourceSha256,'source bytes unchanged');const text=JSON.stringify(result)+'\n';const output=outputArg?resolve(outputArg):fileURLToPath(new URL('../../parity/status/boundaries-v3.json',import.meta.url));if(check)assert.equal(readFileSync(output,'utf8'),text,'nonwriting v3 bytecheck');else writeFileSync(output,text);console.log(JSON.stringify({checked:check,cases:result.cases.length,bytes:Buffer.byteLength(text)}));

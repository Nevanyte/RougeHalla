/** Canonical source capture: run in pinned Linux Node22.23.4, no source modifications. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,join,relative} from 'node:path';
import {runtimeCases} from './runtime-cases';
import {captureStatusProbes} from '../../parity/legacy-capture/status-probes';
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw Error('canonical capture requires Linux amd64 Node22.23.4');
let check=false,runtime=false,outputArg:string|undefined;const seen=new Set<string>();
for(const arg of process.argv.slice(2)){
 const key=arg==='--check'?'check':arg==='--slice=runtime'?'slice':arg.startsWith('--output=')?'output':null;
 if(key===null||seen.has(key)||key==='output'&&arg.length===9)throw Error('invalid capture arguments: '+arg);
 seen.add(key);if(key==='check')check=true;else if(key==='slice')runtime=true;else outputArg=arg.slice(9);
}
const root=fileURLToPath(new URL('../../',import.meta.url));
const caseInventory=JSON.parse(readFileSync(new URL('./case-inventory.json',import.meta.url),'utf8'));
const sourceNames=JSON.parse(readFileSync(new URL('./source-inventory.json',import.meta.url),'utf8'));
const actual:string[]=[];function walk(dir:string){for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())walk(p);else if(e.name.endsWith('.ts'))actual.push(relative(root,p));}}
walk(join(root,'packages/shared/src'));walk(join(root,'packages/server/src'));
assert.deepEqual(actual.sort(),sourceNames);
const names=[...sourceNames,'parity/legacy-capture/status-probes.ts','parity/legacy-capture/canon.ts','parity/legacy-capture/intake.ts','tools/status-fixtures/capture.ts','tools/status-fixtures/runtime-cases.ts','tools/status-fixtures/source-inventory.json','tools/status-fixtures/case-inventory.json','package.json','package-lock.json','tsconfig.base.json','packages/shared/package.json','packages/server/package.json'];
const sourceSha256=Object.fromEntries(names.map((p:string)=>[p,createHash('sha256').update(readFileSync(join(root,p))).digest('hex')]));
const payload=captureStatusProbes(runtime?runtimeCases:undefined);
const slice=runtime?'fields-ledger-lifecycle/1':'rules-helpers/1';assert.deepEqual(payload.cases.map(c=>c.name),caseInventory[slice],'fixed nonempty ordered case inventory');
const result={format:'rh-status-probes/1',slice,provenance:{base:'d1027eac93be54ec9e37435ab71c2e97a3aafdc9',node:process.version,nodeSha256:createHash('sha256').update(readFileSync(process.execPath)).digest('hex'),platform:process.platform,arch:process.arch,scope:'Actual unchanged source helpers in genuine createGameWorld; labelled trusted setup, not ability/card/mob producer gameplay',sourceSha256},...payload};
const text=JSON.stringify(result)+'\n';const output=outputArg?resolve(outputArg):fileURLToPath(new URL(runtime?'../../parity/status/runtime.json':'../../parity/status/helpers.json',import.meta.url));
if(check)assert.equal(readFileSync(output,'utf8'),text,'nonwriting canonical bytecheck');else writeFileSync(output,text);
console.log(JSON.stringify({checked:check,rules:result.rules.length,cases:result.cases.length,bytes:Buffer.byteLength(text)}));

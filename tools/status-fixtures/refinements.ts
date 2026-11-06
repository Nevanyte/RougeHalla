/** Revision2: two concrete independent-review boundaries, using the unchanged revision1 recorder/source. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {captureStatusProbes} from '../../parity/legacy-capture/status-probes';
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw Error('requires canonical Linux amd64 Node22.23.4');
let check=false,outputArg:string|undefined;const seen=new Set<string>();for(const arg of process.argv.slice(2)){const key=arg==='--check'?'check':arg.startsWith('--output=')?'output':null;if(key===null||seen.has(key)||key==='output'&&arg.length===9)throw Error('invalid refinement arguments: '+arg);seen.add(key);if(key==='check')check=true;else outputArg=arg.slice(9);}
const root=fileURLToPath(new URL('../../',import.meta.url));
const names=[...JSON.parse(readFileSync(new URL('./source-inventory.json',import.meta.url),'utf8')),'parity/legacy-capture/status-probes.ts','parity/legacy-capture/canon.ts','parity/legacy-capture/intake.ts','tools/status-fixtures/capture.ts','tools/status-fixtures/runtime-cases.ts','tools/status-fixtures/source-inventory.json','tools/status-fixtures/case-inventory.json','package.json','package-lock.json','tsconfig.base.json','packages/shared/package.json','packages/server/package.json','tools/status-fixtures/refinements.ts'];
const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');const sourceSha256=Object.fromEntries(names.map(p=>[p,hash(join(root,p))]));
const apply=(kind:string,extra:any={})=>({kind:'apply',id:'alice',apply:{kind,source:{id:'bob',name:'BOB'},ms:1000,...extra}});
const cases:any[]=[
{name:'review-cross-mirror-shred-slowattack',classification:'trusted-helper',boundary:'Quiet generic shred leaves armor mirror stale; actual installed slowAttack hook recomputes complete source mods; simultaneous expiry refolds both. No card producer claim.',operations:[apply('shred',{value:3,tag:'axe',quiet:true}),apply('slowAttack',{value:.2}),{kind:'clock',at:2000},{kind:'updateAbilities'},{kind:'read',id:'alice'}]},
{name:'review-queued-displace-after-real-departure',classification:'trusted-helper',boundary:'Trusted collection/lock setup; genuine removePlayer between queue and drain. Source retained Combatant still resets other players lock bookkeeping; no natural hook reachability claim.',operations:[{kind:'runtimePatch',id:'bob',patch:{weapon:{lock:'alice',lockSeen:true,lockLosLostAt:500,lockPlanAt:500,lockGoal:{x:200,y:320}}}},{kind:'collect',value:true},{kind:'displace',id:'alice',to:{x:400,y:200}},{kind:'removePlayer',id:'alice'},{kind:'drain'}]},
];
assert.deepEqual(cases.map(c=>c.name),['review-cross-mirror-shred-slowattack','review-queued-displace-after-real-departure']);
const result={format:'rh-status-probes/1',slice:'review-refinements/2',provenance:{base:'d1027eac93be54ec9e37435ab71c2e97a3aafdc9',node:process.version,nodeSha256:hash(process.execPath),platform:process.platform,arch:process.arch,scope:'Two trusted actual-source review boundaries; revision1 source/recorder unchanged',sourceSha256},...captureStatusProbes(cases)};
assert.deepEqual(Object.fromEntries(names.map(p=>[p,hash(join(root,p))])),sourceSha256,'source bytes unchanged');
const output=outputArg?resolve(outputArg):fileURLToPath(new URL('../../parity/status/refinements-v2.json',import.meta.url));const text=JSON.stringify(result)+'\n';if(check)assert.equal(readFileSync(output,'utf8'),text,'nonwriting refinement bytecheck');else writeFileSync(output,text);console.log(JSON.stringify({checked:check,cases:cases.length,bytes:Buffer.byteLength(text)}));

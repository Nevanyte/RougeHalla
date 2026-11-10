import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {decode} from '/repo/tools/bot-private-strategy-fixtures/verify.mjs';
const mode=process.argv[2];assert(['--write','--check'].includes(mode));
const read=p=>readFileSync(p,'utf8'),hash=b=>createHash('sha256').update(b).digest('hex');
const canonicalBytes=read('/out/source.json'),canonical=JSON.parse(canonicalBytes);
const relative='packages/server/src/bots/brain/strategy.ts',original=read('/repo/'+relative),needle='JSON.stringify(g.data)';
assert.equal(original.split(needle).length,2,'one real module goal-key serialization site');
const decisions=c=>c.operations.filter(o=>o.method==='decide');
const own=o=>decode(o.own,true);
const moduleCount=c=>decode(decisions(c)[0].state,true).candidates.filter(d=>d.goal.kind==='module').length;
const defs=[
 {id:'preserve-negative-zero-miskey',case:'negative-zero-positive-zero-collision',
  replacement:'JSON.stringify(g.data, (_key, value) => Object.is(value, -0) ? "__negative_zero__" : value).replace(\'"__negative_zero__"\', "-0")',
  select:moduleCount},
 {id:'nonfinite-string-miskey',case:'nonfinite-null-collision-and-current-reuse',
  replacement:'JSON.stringify(g.data, (_key, value) => typeof value === "number" && !Number.isFinite(value) ? String(value) : value)',select:moduleCount},
 {id:'non-ecmascript-exponent-format',case:'ecmascript-exponent-boundaries',
  replacement:'JSON.stringify(g.data).replace("0.000001", "1e-6").replace("100000000000000000000", "1e20").replace("e+21", "e21")',
  select:c=>decisions(c).slice(1,5).map(o=>own(o).currentKey)},
 {id:'undefined-object-value-becomes-null',case:'undefined-object-array-distinction',
  replacement:'JSON.stringify(g.data, (_key, value) => value === undefined ? null : value)',select:moduleCount},
];
const temp=mkdtempSync('/tmp/rh-module-key-controls-'),receipts=[];
try {
 const copy=join(temp,'source');
 cpSync('/repo',copy,{recursive:true,filter:p=>!p.split('/').some(x=>['node_modules','.git','target','client-unity','docs','crates','protocol','parity','dist','build'].includes(x))});
 symlinkSync('/repo/node_modules',join(copy,'node_modules'),'dir');
 const run=(id,selected,mutant)=>{
  const destination=join(temp,id+'.json');
  const child=spawnSync(process.execPath,['--import','tsx','/capture/capture.mts','--write',destination],
   {cwd:copy,env:{...process.env,RH_BOT_STRATEGY_SOURCE_ROOT:copy,RH_MODULE_KEY_MUTANT:mutant?'1':'0',...(selected?{RH_MODULE_KEY_CASES:selected}:{})},encoding:'utf8',maxBuffer:4*1024*1024});
  assert.equal(child.status,0,id+': capture failure is not a semantic KILL\n'+child.stdout+child.stderr);
  return JSON.parse(read(destination));
 };
 for(const d of defs){
  const changed=original.replace(needle,d.replacement);writeFileSync(join(copy,relative),changed);
  const mutated=run(d.id,d.case,true).cases[0],base=canonical.cases.find(c=>c.id===d.case);
  const expected=d.select(base),observed=d.select(mutated);assert.notDeepEqual(observed,expected,d.id+': intended selector must differ');
  const result={id:d.id,result:'KILL',case:d.case,source:expected,mutant:observed,sourceSha256:hash(original),mutantSha256:hash(changed)};
  receipts.push(result);console.log(JSON.stringify(result));
  writeFileSync(join(copy,relative),original);
 }
 writeFileSync(join(copy,relative),original+'\n// module goal-key provenance-only control\n');
 const comment=run('comment-only',null,false);assert.deepEqual(comment.cases,canonical.cases);receipts.push({id:'comment-only',result:'NONKILL',cases:4});
 writeFileSync(join(copy,relative),original);
 const restored=run('restored',null,false);assert.deepEqual(restored.cases,canonical.cases);assert.deepEqual(restored.assertions,canonical.assertions);
 assert.equal(read('/repo/'+relative),original);assert.equal(read('/out/source.json'),canonicalBytes);
 const result={format:'rh-bot-module-goal-key-controls/1',source:{bytes:Buffer.byteLength(canonicalBytes),sha256:hash(canonicalBytes)},
  controls:receipts,restored:'ALL_FOUR_CASES_IDENTICAL',primary17:'UNCHANGED_BEFORE_AND_AFTER_EVERY_CAPTURE',canonicalPayload:'UNCHANGED',
  safety:'source patches only in unique disposable container directory; canonical /repo read-only; no primary helper or payload mutation'};
 const bytes=JSON.stringify(result,null,1)+'\n';if(mode==='--write')writeFileSync('/out/controls.json',bytes);else assert.equal(read('/out/controls.json'),bytes);
 console.log(JSON.stringify({semanticControls:4,comment:'NONKILL',restored:'PASS',primary17:'UNCHANGED',bytes:Buffer.byteLength(bytes),sha256:hash(bytes)}));
}finally{rmSync(temp,{recursive:true,force:true});}

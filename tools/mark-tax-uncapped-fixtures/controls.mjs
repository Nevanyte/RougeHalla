import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync,mkdirSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const repo='/repo',work='/work',out='/out';
const path='packages/server/src/sim/factions.ts';
const original=readFileSync(`${repo}/${path}`,'utf8');
const sha=b=>createHash('sha256').update(b).digest('hex');
const expected=JSON.parse(readFileSync(`${repo}/parity/mark-tax-uncapped/source.json`,'utf8'));
const semantic=x=>{const {provenance,...rest}=x;return JSON.stringify(rest);};
const mutations=[
 ['tax-source-disabled','return factor < 1 ? { asMult: factor } : null;','return null;'],
 ['raw-farm-excluded','const r = spec.rate * cardAsMultOf(c.s);','const r = spec.rate;'],
 ['cap99-ignored','const taxed = taxedRate(r, m.params.tax_keep!, m.params.tax_cap!);','const taxed = r;'],
 ['tier2-refused','if (f.tier >= 2 && markNear(world, c, member)) {','if (f.tier >= 3 && markNear(world, c, member)) {'],
 ['tie-owner-reversed','(f.tier === taxTier.get(member.id) && c.id < best)','(f.tier === taxTier.get(member.id) && c.id > best)'],
 ['public-tax-omitted','const tax = taxer !== undefined ? Math.round(taxCut(world, c, taxer) * 100) : 0;','const tax = 0;'],
 ['provenance-nonkill','/** world.modSources entry: the mark\'s tax, an attack-speed factor like any slow (the mirrors fold and cap it). */','/** Provenance-only comment. world.modSources entry: unchanged tax. */']
];
function capture(name){
 const file=`/tmp/${name}.json`;
 const process=spawnSync('node',['--import','tsx',`${repo}/tools/mark-tax-uncapped-fixtures/capture.mts`,'--write',file],{cwd:repo,env:{...globalThis.process.env,RH_MARK_TAX_ROOT:work},encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024});
 const log=(process.stdout??'')+(process.stderr??'');writeFileSync(`${out}/${name}.log`,log);
 let value=null;if(process.status===0){assert(existsSync(file));value=JSON.parse(readFileSync(file,'utf8'));}
 return {exit:process.status,signal:process.signal,logSha256:sha(log),semanticEqual:value!==null&&semantic(value)===semantic(expected),
  provenanceEqual:value!==null&&JSON.stringify(value.provenance)===JSON.stringify(expected.provenance),valueSha256:value===null?null:sha(readFileSync(file)),semanticAssertion:log.includes('AssertionError')&&log.includes('verify.mjs:')};
}
const results=[];
try {
 copyFileSync(`${repo}/${path}`,`${work}/${path}`);
 const pristine=capture('pristine');assert.equal(pristine.exit,0);assert(pristine.semanticEqual&&pristine.provenanceEqual);
 for(const [name,before,after] of mutations){
  assert.equal(original.split(before).length-1,1,name+' unique actual source site');
  const candidate=original.replace(before,after);writeFileSync(`${work}/${path}`,candidate);
  const result=capture(name);
  if(name==='provenance-nonkill'){assert.equal(result.exit,0);assert(result.semanticEqual&&!result.provenanceEqual);}
  else {assert.equal(result.exit,1);assert(result.semanticAssertion,'actual verifier assertion, not compiler/tool failure');assert(!result.semanticEqual);}
  results.push({name,file:path,before,after,beforeFileSha256:sha(original),afterFileSha256:sha(candidate),...result});
  console.log(JSON.stringify({name,exit:result.exit,semanticEqual:result.semanticEqual,semanticAssertion:result.semanticAssertion}));
  copyFileSync(`${repo}/${path}`,`${work}/${path}`);
 }
 const restored=capture('restored');assert.equal(restored.exit,0);assert(restored.semanticEqual&&restored.provenanceEqual);
 writeFileSync(`${out}/controls.json`,JSON.stringify({format:'rh-mark-tax-uncapped-controls/1',fixtureSha256:sha(readFileSync(`${repo}/parity/mark-tax-uncapped/source.json`)),pristine,results,restored,
  boundary:'One memory checkout with original actual factions.ts restored before each fresh Node process. Semantic failures must be actual verifier assertions; no compiler failures counted. Shared source is unmodified.'},null,1)+'\n');
 console.log(JSON.stringify({semanticKills:6,provenanceNonkills:1,pristine:true,restored:true}));
} finally {copyFileSync(`${repo}/${path}`,`${work}/${path}`);assert.equal(readFileSync(`${work}/${path}`,'utf8'),original);}

// Semantic source controls run only in a disposable copy; /repo and canonical /out/source.json are never patched.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const mode=process.argv[2];assert(mode==='--write'||mode==='--check');
assert.equal(process.version,'v22.23.4');assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=p=>readFileSync(p,'utf8');
const sourceBytes=read('/out/source.json');
const canonical=JSON.parse(sourceBytes);
const relative='packages/server/src/sim/cardHooks.ts';
const original=read('/repo/'+relative);
const groupingNeedle='const key = `${h.victim}|${h.by}`;';
const cadenceNeedle='if (report && now - report.since >= DOT_FX_MS) flushBleeds(world);';
const endNeedle='chainHook(world, "runEnded", flushBleeds);';
for(const [needle,label] of [[groupingNeedle,'pair grouping'],[cadenceNeedle,'500 ms cadence'],[endNeedle,'run-ended flush']])
  assert.equal(original.split(needle).length,2,`exactly one ${label} source site`);

const scratch=mkdtempSync('/tmp/rh-card-bleed-controls-');
const copy=join(scratch,'source');
const receipt=[];
const run=(label)=>{
  const destDir=join(scratch,'outputs',label);mkdirSync(destDir,{recursive:true});
  const output=join(destDir,'source.json');
  const child=spawnSync(process.execPath,['--import','tsx',join(copy,'tools/card-bleed-fixtures/capture.mts')],{
    cwd:copy,env:{...process.env,RH_CARD_BLEED_OUTPUT:output},encoding:'utf8',maxBuffer:24*1024*1024,
  });
  if(child.status===0)return{status:0,stdout:child.stdout,stderr:child.stderr,output:JSON.parse(read(output)),outputPath:output};
  const diagnostic=JSON.parse(read(join(destDir,'UNADMITTED.json')));
  return{status:child.status,stdout:child.stdout,stderr:child.stderr,diagnostic,outputPath:join(destDir,'UNADMITTED.json')};
};
const replace=(needle,replacement)=>{const changed=original.replace(needle,replacement);assert.notEqual(changed,original);return changed;};
const caseBy=(corpus,name)=>(corpus.cases??corpus.capturedCases).find(c=>c.name===name);
try {
  cpSync('/repo',copy,{recursive:true,filter:p=>!p.split('/').some(x=>['node_modules','.git','target','client-unity','docs','crates','protocol','parity','dist','build'].includes(x))});
  symlinkSync('/repo/node_modules',join(copy,'node_modules'),'dir');
  const sourcePath=join(copy,relative);
  assert.equal(read(sourcePath),original,'disposable base copy initially matches sealed source');

  const grouped=replace(groupingNeedle,'const key = `${h.victim}|${h.by}|${world.state.tick}|${world.combat.landed.indexOf(h)}`;');
  writeFileSync(sourcePath,grouped);
  const groupedRun=run('one-row-per-contribution');
  assert.equal(groupedRun.status,0,'grouping mutant must execute all source cases; runtime failure is not KILL\n'+groupedRun.stdout+groupedRun.stderr);
  const expectedPairs=caseBy(canonical,'ordered-pairs-and-repeat-pair').cardFx;
  const observedPairs=caseBy(groupedRun.output,'ordered-pairs-and-repeat-pair').cardFx;
  assert.notDeepEqual(observedPairs,expectedPairs,'one-row-per-contribution changes the genuine grouped feedback');
  assert(observedPairs.length>expectedPairs.length,'grouping mutant emits multiple rows where source grouped by pair');
  receipt.push({name:'one-row-per-contribution',result:'KILL',file:relative,sourceSha256:hash(original),mutantSha256:hash(grouped),
    case:'ordered-pairs-and-repeat-pair',sourceFx:expectedPairs.length,mutantFx:observedPairs.length,
    firstSource:expectedPairs.slice(0,2),firstMutant:observedPairs.slice(0,4)});

  const strict=replace(cadenceNeedle,'if (report && now - report.since > DOT_FX_MS) flushBleeds(world);');
  writeFileSync(sourcePath,strict);
  const strictRun=run('strictly-greater-than-500');
  assert.notEqual(strictRun.status,0,'strict-threshold mutant must fail the source boundary guard');
  assert.match(strictRun.diagnostic.failure.message,/first-use report clock flushes at the source 500 ms boundary/);
  assert.equal(strictRun.diagnostic.failingCase,'first-use-clock-periodic-and-empty-interval');
  const strictCase=caseBy(strictRun.diagnostic,'first-use-clock-periodic-and-empty-interval');
  assert.equal(strictCase.cardFx[0].time-strictCase.cardContributions[0].time,550,'mutant misses 500 ms and flushes on next fixed step');
  receipt.push({name:'strictly-greater-than-500',result:'KILL',file:relative,sourceSha256:hash(original),mutantSha256:hash(strict),
    case:strictRun.diagnostic.failingCase,sourceBoundaryMs:500,mutantBoundaryMs:strictCase.cardFx[0].time-strictCase.cardContributions[0].time,
    guard:strictRun.diagnostic.failure.message});

  const noEnd=replace(endNeedle,'// run-ended card feedback flush intentionally removed by semantic control');
  writeFileSync(sourcePath,noEnd);
  const noEndRun=run('skip-run-ended-flush');
  assert.notEqual(noEndRun.status,0,'missing run-ended flush must fail the source lifecycle guard');
  assert.match(noEndRun.diagnostic.failure.message,/run-ended case has a real contribution and flush/);
  assert.equal(noEndRun.diagnostic.failingCase,'run-ended-before-periodic-window');
  const ended=caseBy(noEndRun.diagnostic,'run-ended-before-periodic-window');
  assert.equal(ended.final.phase,'ended');assert(ended.cardContributions.length>0);assert.equal(ended.cardFx.length,0);
  receipt.push({name:'skip-run-ended-flush',result:'KILL',file:relative,sourceSha256:hash(original),mutantSha256:hash(noEnd),
    case:noEndRun.diagnostic.failingCase,phase:ended.final.phase,contributions:ended.cardContributions.length,feedback:ended.cardFx.length,
    guard:noEndRun.diagnostic.failure.message});

  const comment=original+'\n// card-bleed source provenance-only control\n';
  writeFileSync(sourcePath,comment);
  const commentRun=run('comment-only');
  assert.equal(commentRun.status,0,'comment control compiles and executes all cases\n'+commentRun.stdout+commentRun.stderr);
  assert.deepEqual(commentRun.output.cases,canonical.cases,'comment-only preserves every source case transcript');
  assert.notDeepEqual(commentRun.output.provenance.sourceInputs,canonical.provenance.sourceInputs,'comment changes source provenance');
  receipt.push({name:'comment-only',result:'NONKILL',file:relative,sourceSha256:hash(original),mutantSha256:hash(comment),cases:canonical.cases.length,transcriptsEqual:true});

  writeFileSync(sourcePath,original);
  assert.equal(read(sourcePath),original,'restore exact source file');
  const restored=run('restored');
  assert.equal(restored.status,0,'restored source recapture succeeds\n'+restored.stdout+restored.stderr);
  assert.deepEqual(restored.output,canonical,'restored source reproduces exact candidate corpus');
  const originalCheck=spawnSync(process.execPath,['--import','tsx','/repo/tools/card-bleed-fixtures/capture.mts','--check'],{
    cwd:'/repo',env:{...process.env,RH_CARD_BLEED_OUTPUT:'/out/source.json'},encoding:'utf8',maxBuffer:24*1024*1024,
  });
  assert.equal(originalCheck.status,0,'immutable original-source read-only recapture\n'+originalCheck.stdout+originalCheck.stderr);
  assert.equal(read('/repo/'+relative),original,'canonical source remains byte-identical');
  assert.equal(read('/out/source.json'),sourceBytes,'canonical output remains byte-identical');
  const result={format:'rh-card-bleed-source-controls/1',source:{bytes:Buffer.byteLength(sourceBytes),sha256:hash(sourceBytes)},
    controls:receipt,restored:'FULL_CORPUS_IDENTICAL',immutableOriginal:'PASS',
    safety:'mutants and outputs exist only in one unique disposable container copy; /repo and canonical source.json read-only'};
  const bytes=JSON.stringify(result,null,1)+'\n';
  if(mode==='--write')writeFileSync('/out/controls.json',bytes);else assert.equal(read('/out/controls.json'),bytes,'control receipt exact bytes');
  console.log(bytes.trim());
}finally{rmSync(scratch,{recursive:true,force:true});}

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {validate} from './verify.mjs';
const [mode,out='/out']=process.argv.slice(2);assert(['--write','--check'].includes(mode));
const read=p=>readFileSync(p,'utf8'),hash=v=>createHash('sha256').update(v).digest('hex');
const bytes=read(join(out,'source.json')),canonical=JSON.parse(bytes),file='packages/server/src/bots/brain/brain.ts',human='packages/server/src/bots/brain/humanizer.ts';
const pathLine='(cfg.services.paths as { setFrame?: (t: ServerMs, gatesLocked: boolean) => void }).setFrame?.(now, p.hud.gatesLocked);';
const defs=[
 {id:'path-after-observe',case:'path-clock-trade-boundary',edits:[[pathLine,'// path moved'],['const observed = memory.observe(p);','const observed = memory.observe(p);\n      '+pathLine]]},
 {id:'miss-prepend',case:'caller-wand-miss-alive-dead',edits:[['[...observed, ...missed.map((m): Stimulus => ({ kind: "clickMissed", at: now, subject: m.target, central: true }))]','[...missed.map((m): Stimulus => ({ kind: "clickMissed", at: now, subject: m.target, central: true })), ...observed]']]},
 {id:'dead-miss-retained',case:'caller-wand-miss-alive-dead',edits:[['alive && missed.length > 0','missed.length > 0']]},
 {id:'trade-exclusive-boundary',case:'path-clock-trade-boundary',edits:[['p.now - t <= ENGAGE_TRADE_SECONDS * 1000','p.now - t < ENGAGE_TRADE_SECONDS * 1000']]},
 {id:'strategy-cadence-draw-first',case:'core-farm-route',edits:[['const decision = strategy.decide(ctx, goal, status);','const cadence = draw(tier.strategyMs);\n        const decision = strategy.decide(ctx, goal, status);'],['nextStrategyAt = now + draw(tier.strategyMs);','nextStrategyAt = now + cadence;']]},
 {id:'first-act-suppressed',case:'caller-idle-first-act',edits:[['if (changed || toast || stimuli.length > 0 || now >= nextThinkAt) {','if (!first && (changed || toast || stimuli.length > 0 || now >= nextThinkAt)) {']]},
 {id:'redundant-first-flag-only',case:'caller-idle-first-act',expect:'SURVIVED',edits:[['changed = adopt(decision, now) || first;','changed = adopt(decision, now);']]},
 {id:'adopt-unchanged-count-log',case:'caller-module-keys',edits:[['if (!changed) return false;','// deliberately count/log unchanged keys']]},
 {id:'module-bypass-removed',case:'caller-module-keys',edits:[['if (g.kind === "module") {','if (false && g.kind === "module") {']]},
 {id:'rejected-extra-claims',case:'caller-merge-adjust',edits:[['      claimed.add(ch);\n    }\n  }\n  return out;','      claimed.add(ch);\n    }\n    claimed.add(ch);\n  }\n  return out;']]},
 {id:'same-tick-fault-blanket',case:'guard-observe',edits:[['    try {\n      return fn();','    if (faulted.has(m.id)) return fallback;\n    try {\n      return fn();']]},
 {id:'feature-after-draw',file:human,case:'caller-idle-first-act',select:'hand',edits:[['    if (cfg.features && !cfg.features.messageTypes.includes(COMMAND_TYPE[intent.kind])) return;','    // feature gate moved after delay draws'],['    let due = amends ? prev.due : newDecisionDue(intent, key, prev, ctx);','    let due = amends ? prev.due : newDecisionDue(intent, key, prev, ctx);\n    if (cfg.features && !cfg.features.messageTypes.includes(COMMAND_TYPE[intent.kind])) return;']]},
 {id:'nonactive-release-skipped',case:'caller-nonactive-release',edits:[['        return flush(humanizer.release(ctx));','        return [];']]},
 {id:'sequence256-wrap',case:'caller-sequence255',edits:[['orderSeq = (orderSeq % 255) + 1;','orderSeq = (orderSeq % 256) + 1;',2]]},
 {id:'noteSent-before-stamp',case:'caller-sequence255',edits:[['memory.noteSent(sent);','memory.noteSent(tc);']]},
 {id:'tactics-vs-hunt-targets',case:'caller-module-keys',edits:[['mobTargets: hunt.targets,','mobTargets: t.mobTargets,']]},
 {id:'grab-inclusive-boundary',case:'core-loot-grab-window',edits:[['p.now - lootAt <= BRAIN_RULES.grabWindowMs','p.now - lootAt < BRAIN_RULES.grabWindowMs']]},
 {id:'stall-grace-boundary',case:'caller-stall-grab-end',edits:[['stillGraceMs: 600,','stillGraceMs: 601,']]},
 {id:'movement-equality',case:'caller-stall-grab-end',edits:[['>= BRAIN_RULES.stillEps','> BRAIN_RULES.stillEps']]},
 {id:'end-clears-choices',case:'caller-module-keys',edits:[['end(result: RunResult | null): RunSummary {','end(result: RunResult | null): RunSummary {\n      (base.choices as string[]).length = 0;']]},
 {id:'end-stale-choice-alias',case:'caller-stall-grab-end',edits:[['choices: [...base.choices],','choices: base.choices,']]},
];
function firstDiff(a,b,path='$') {if(Object.is(a,b))return null;if(typeof a!==typeof b||a===null||b===null||typeof a!=='object')return{path,expected:a,actual:b};const ka=Object.keys(a),kb=Object.keys(b);if(JSON.stringify(ka)!==JSON.stringify(kb))return{path:path+'.keys',expected:ka,actual:kb};for(const k of ka){const d=firstDiff(a[k],b[k],path+'.'+k);if(d)return d;}return null;}
const temp=mkdtempSync('/tmp/rh-brain-controls-'),receipts=[];
try {
 const copy=join(temp,'source');mkdirSync(copy);cpSync('/repo/packages',join(copy,'packages'),{recursive:true,filter:p=>!p.split('/').some(x=>['node_modules','dist'].includes(x))});
 for(const f of ['package.json','package-lock.json','tsconfig.base.json'])cpSync('/repo/'+f,join(copy,f));
 symlinkSync('/repo/node_modules',join(copy,'node_modules'),'dir');symlinkSync('/repo/parity',join(copy,'parity'),'dir');symlinkSync('/repo/tools',join(copy,'tools'),'dir');
 const originals=new Map([file,human].map(p=>[p,read('/repo/'+p)]));
 const run=(id,ids)=>{const dest=join(temp,id);mkdirSync(dest);const child=spawnSync(process.execPath,['--import','tsx','/capture/capture.mts','--write',dest],{cwd:copy,env:{...process.env,RH_BOT_BRAIN_SOURCE_ROOT:copy,RH_BOT_BRAIN_MUTANT:'1',RH_BOT_BRAIN_CASES:ids.join(',')},encoding:'utf8',maxBuffer:4*1024*1024});console.log(JSON.stringify({raw:{id,status:child.status,stdout:child.stdout,stderr:child.stderr}}));assert.equal(child.status,0,id+': compile/reader failure is not semantic KILL');return JSON.parse(read(join(dest,'source.json')));};
 for(const d of defs){const path=d.file??file,original=originals.get(path);let changed=original;
  for(const [needle,replacement,n=1]of d.edits){assert.equal(changed.split(needle).length,n+1,d.id+': exact needle count');changed=changed.split(needle).join(replacement);}
  writeFileSync(join(copy,path),changed);
  const got=run(d.id,[d.case]),expected=d.select==='hand'?canonical.handSupplement:canonical.cases.find(c=>c.id===d.case),actual=d.select==='hand'?got.handSupplement:got.cases[0];
  const diff=firstDiff(expected,actual),result=diff?'KILL':'SURVIVED';
  receipts.push({id:d.id,result,expectedResult:d.expect??'KILL',case:d.case,file:path,edits:d.edits,sourceSha256:hash(original),mutantSha256:hash(changed),semanticExpectedSha256:hash(JSON.stringify(expected)),semanticActualSha256:hash(JSON.stringify(actual)),firstDifference:diff});
  console.log(JSON.stringify(receipts.at(-1)));writeFileSync(join(copy,path),original);
 }
 const ids=canonical.cases.map(c=>c.id),original=originals.get(file);
 writeFileSync(join(copy,file),original+'\n// provenance-only full Brain control\n');const comment=run('comment-only',ids);assert.deepEqual(comment.cases,canonical.cases);assert.deepEqual(comment.handSupplement,canonical.handSupplement);receipts.push({id:'comment-only',result:'NONKILL',cases:ids.length});
 writeFileSync(join(copy,file),original);const restored=run('restored',ids);assert.deepEqual(restored.cases,canonical.cases);assert.deepEqual(restored.handSupplement,canonical.handSupplement);
 const field=(v,k)=>v.entries.find(([name])=>name===k);
 for(const [id,caseId,edit]of [
  ['expected-command-sequence','caller-sequence255',c=>{const t=c.operations.find(o=>o.method==='tick'&&o.result.values?.length).result.values[0];field(field(field(t,'cmd')[1],'msg')[1],'seq')[1]=99;}],
  ['expected-runtime-draw','core-farm-route',c=>{c.operations.find(o=>o.trace.some(t=>t.kind==='rng')).trace.find(t=>t.kind==='rng').value=.123456789;}],
  ['expected-builtin-result','core-chest',c=>{const t=c.operations.flatMap(o=>o.trace).find(t=>t.kind==='builtin'&&t.hook==='act');field(field(t.result,'status')[1],'why')[1]='changed expected status';}],
 ]) {
  const changed=structuredClone(canonical),c=changed.cases.find(c=>c.id===caseId);edit(c);validate(changed);
  const actual=restored.cases.find(c=>c.id===caseId),diff=firstDiff(c,actual);assert(diff,id+': actual fresh source kills supported changed expected trace');
  receipts.push({id,result:'KILL',expectedResult:'KILL',case:caseId,kind:'EXPECTED_TRACE_ONLY',firstDifference:diff,actualSha256:hash(JSON.stringify(actual)),changedExpectedSha256:hash(JSON.stringify(c))});
 }
 for(const [p,b]of originals)assert.equal(read('/repo/'+p),b);assert.equal(read(join(out,'source.json')),bytes);
 const body={format:'rh-bot-private-brain-controls/1',source:{bytes:Buffer.byteLength(bytes),sha256:hash(bytes)},controls:receipts,restoredCases:'BYTE_IDENTICAL',immutableSource:'UNCHANGED'};
 const value=JSON.stringify(body,null,1)+'\n';if(mode==='--write')writeFileSync(join(out,'controls.json'),value);else assert.equal(read(join(out,'controls.json')),value);
 const unexpected=receipts.filter(x=>x.result!==(x.expectedResult??'NONKILL'));console.log(JSON.stringify({semanticSourceControls:defs.length,expectedTraceControls:3,killed:receipts.filter(x=>x.result==='KILL').length,survived:receipts.filter(x=>x.result==='SURVIVED').map(x=>x.id),unexpected:unexpected.map(x=>x.id),commentOnly:'NONKILL',restored:'PASS'}));if(unexpected.length)process.exitCode=1;
} finally {rmSync(temp,{recursive:true,force:true});}

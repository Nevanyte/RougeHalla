import assert from 'node:assert/strict';
import {cpSync,mkdirSync,readdirSync,readFileSync,symlinkSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const repo='/repo',work='/work',out='/out';
const sha=value=>createHash('sha256').update(value).digest('hex');
const semantic=value=>{const copy=structuredClone(value);delete copy.profile;return JSON.stringify(copy);};
mkdirSync(work,{recursive:true});
mkdirSync(work+'/tools',{recursive:true});
mkdirSync(work+'/docs',{recursive:true});
for(const path of ['packages','tools/bot-public-facts-fixtures','docs/REQUIREMENTS.md','docs/CONTRACTS.md','package.json','package-lock.json','tsconfig.base.json']) {
 cpSync(repo+'/'+path,work+'/'+path,{recursive:true});
}
// Keep installed third-party packages shared, but point workspace aliases at the isolated copies so
// each source mutation actually reaches the modules imported by the capture.
mkdirSync(work+'/node_modules/@raid',{recursive:true});
for(const entry of readdirSync(repo+'/node_modules')) {
 if(entry==='@raid') {
  for(const workspace of ['shared','server','client']) {
   if(readdirSync(repo+'/packages').includes(workspace)) symlinkSync(work+'/packages/'+workspace,work+'/node_modules/@raid/'+workspace,'dir');
  }
 } else {
  symlinkSync(repo+'/node_modules/'+entry,work+'/node_modules/'+entry,'dir');
 }
}

const fixture=JSON.parse(readFileSync(repo+'/parity/policy/bot-public-facts/source.json','utf8'));
assert.equal(fixture.format,'rh-bot-public-facts-source/1');
assert(fixture.profile&&fixture.npc&&fixture.flight,'expected complete public-facts source witness');
const fixtureSemantic=semantic(fixture);

function run(name) {
 const output='/tmp/'+name+'.json';
 const result=spawnSync(process.execPath,['--import','tsx',work+'/tools/bot-public-facts-fixtures/capture.mts','--write',output],{
  cwd:work,env:{...process.env,RH_BOT_PUBLIC_SOURCE_ROOT:work},encoding:'utf8',maxBuffer:8*1024*1024,
 });
 const stdout=result.stdout??'',stderr=result.stderr??'';
 const log=`exit=${result.status} signal=${result.signal??'null'}\n--- stdout ---\n${stdout}--- stderr ---\n${stderr}`;
 writeFileSync(out+'/'+name+'.log',log);
 let observed=null;
 if(result.status===0) observed=JSON.parse(readFileSync(output,'utf8'));
 return {exit:result.status,signal:result.signal??null,stdoutSha256:sha(stdout),stderrSha256:sha(stderr),logSha256:sha(log),
  semanticEqual:observed!==null&&semantic(observed)===fixtureSemantic,
  semanticSha256:observed===null?null:sha(semantic(observed)),
  profileEqual:observed!==null&&JSON.stringify(observed.profile)===JSON.stringify(fixture.profile),
  assertionFailure:result.status===1&&/AssertionError/.test(stderr)&&/(capture\.mts|npc\.mts|flight\.mts|verify\.mjs)/.test(stderr),
  toolFailure:result.status!==0&&!(/AssertionError/.test(stderr)&&/(capture\.mts|npc\.mts|flight\.mts|verify\.mjs)/.test(stderr)),
 };
}

const pristine=run('pristine');
assert.equal(pristine.exit,0,'pristine capture must complete');
assert(pristine.semanticEqual&&pristine.profileEqual,'pristine capture must match fixture and provenance');

const cases=[
 {name:'human-visibility-gate',file:'packages/client/src/render/visibility.ts',before:'return local || (((effects | 0) & EFFECT_HIDDEN) === 0 && canSee(at));',after:'return local || (((effects | 0) & EFFECT_HIDDEN) === 0);'},
 {name:'projectile-public-velocity',file:'packages/shared/src/fxCodec.ts',before:'enc(p.vx, FLIGHT)',after:'enc(p.vx * 0.5, FLIGHT)'},
];
const results=[];
for(const control of cases) {
 const path=work+'/'+control.file,original=readFileSync(path,'utf8');
 assert.equal(original.split(control.before).length-1,1,control.name+' source edit must be unique');
 const mutated=original.replace(control.before,control.after);
 writeFileSync(path,mutated);
 try {
  const observed=run(control.name);
  assert.equal(observed.toolFailure,false,control.name+' must not fail from compilation/import/tooling');
  const killed=(observed.exit===0&&!observed.semanticEqual)||observed.assertionFailure;
  assert(killed,control.name+' must change semantic output or reach a witness assertion');
  results.push({...control,beforeFileSha256:sha(original),afterFileSha256:sha(mutated),
   expected:'semantic kill: changed source witness or reached source-witness assertion',observed});
 } finally {
  writeFileSync(path,original);
 }
}

const comment={name:'provenance-comment-nonkill',file:'packages/client/src/render/visibility.ts',
 before:'return local || (((effects | 0) & EFFECT_HIDDEN) === 0 && canSee(at));',
 after:'return local || (((effects | 0) & EFFECT_HIDDEN) === 0 && canSee(at)); // provenance-only control'};
{
 const path=work+'/'+comment.file,original=readFileSync(path,'utf8');
 assert.equal(original.split(comment.before).length-1,1,'comment control source anchor must be unique');
 const mutated=original.replace(comment.before,comment.after);writeFileSync(path,mutated);
 try {
  const observed=run(comment.name);
  assert.equal(observed.exit,0,'comment nonkill must compile and capture successfully');
  assert(observed.semanticEqual,'comment nonkill must preserve all inputs and source outputs');
  assert.equal(observed.profileEqual,false,'comment nonkill must change pinned provenance');
  results.push({...comment,beforeFileSha256:sha(original),afterFileSha256:sha(mutated),
   expected:'semantic nonkill with provenance change',observed});
 } finally {
  writeFileSync(path,original);
 }
}

const restored=run('restored');
assert.equal(restored.exit,0,'restored source capture must complete');
assert(restored.semanticEqual&&restored.profileEqual,'restored source must match fixture and provenance');
const controlReport={format:'rh-bot-public-facts-controls/1',fixtureSha256:sha(readFileSync(repo+'/parity/policy/bot-public-facts/source.json')),
 expectedSemanticSha256:sha(fixtureSemantic),pristine,results,restored,
 boundary:'Actual source imports run in an isolated tmpfs copy with pinned Node and installed workspace dependencies. The only semantic normalization removes top-level profile/provenance; every declared input and source output remains compared. A semantic kill is accepted only when a successful capture differs semantically or the actual witness reaches an AssertionError; compile, import and other tool failures are rejected.'};
writeFileSync(out+'/controls.json',JSON.stringify(controlReport,null,1)+'\n');
console.log(JSON.stringify({semanticKills:cases.length,provenanceNonkills:1,pristine:true,restored:true}));

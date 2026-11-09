import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,cpSync,symlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const out='/out',work='/work';
const sha=x=>createHash('sha256').update(x).digest('hex');
const semantic=x=>{const c=structuredClone(x);delete c.profile;return JSON.stringify(c);};
mkdirSync(work,{recursive:true});
for(const p of ['packages','tools/bot-fight-fixtures','package.json','package-lock.json','tsconfig.base.json'])cpSync('/repo/'+p,work+'/'+p,{recursive:true});
symlinkSync('/repo/node_modules',work+'/node_modules');
const expected=JSON.parse(readFileSync('/repo/parity/policy/bot-fight/source.json'));
const expectedSemantic=semantic(expected);
function run(name) {
 const path='/tmp/'+name+'.json';
 const r=spawnSync(process.execPath,['--import','tsx',work+'/tools/bot-fight-fixtures/capture.mts','--write',path],{
  cwd:work,env:{...process.env,RH_BOT_FIGHT_SOURCE_ROOT:work},encoding:'utf8',maxBuffer:2**20});
 const log=`exit=${r.status} signal=${r.signal}\n${r.stdout}${r.stderr}`;
 writeFileSync(out+'/'+name+'.log',log);
 let observed=null;
 if(r.status===0)observed=JSON.parse(readFileSync(path));
 else assert(r.status===1&&r.stderr.includes('AssertionError'),'control must reach actual source/semantic assertions, not fail compilation or tooling');
 return {exit:r.status,signal:r.signal,logSha256:sha(log),semanticEqual:observed!==null&&semantic(observed)===expectedSemantic,
  semanticSha256:observed===null?null:sha(semantic(observed)),profileEqual:observed!==null&&JSON.stringify(observed.profile)===JSON.stringify(expected.profile)};
}
const cases=[
 {name:'decide-stream-tag',file:'brain.ts',before:'decide: mulberry32(derive(cfg.seed, 0)),',after:'decide: mulberry32(derive(cfg.seed, 1)),'},
 {name:'knowledge-once',file:'tactics.ts',before:'knowsSuddenDeath ??= ctx.rng.decide() < ctx.cfg.tier.knowledge;',after:'knowsSuddenDeath ??= false;'},
 {name:'wand-lock',file:'tactics/fight.ts',before:'if (locked && weapon === "wand") return finish',after:'if (false && locked && weapon === "wand") return finish'},
 {name:'replan',file:'tactics/fight.ts',before:'const REPLAN_MS = 400;',after:'const REPLAN_MS = 4000;'},
 {name:'progress',file:'tactics/fight.ts',before:'const NO_PROGRESS_MS = 10_000;',after:'const NO_PROGRESS_MS = 20_000;'},
 {name:'move-resend',file:'tactics/fight.ts',before:'const STILL_RESEND_MS = 700;',after:'const STILL_RESEND_MS = 1000;'},
 {name:'launch',file:'tactics/kite.ts',before:'if (now < launchAt || (weapon === "bow" && self.drawStartedAt > 0)) return null;',after:'if (weapon === "bow" && self.drawStartedAt > 0) return null;'},
 {name:'bow-draw',file:'tactics/kite.ts',before:'if (now < launchAt || (weapon === "bow" && self.drawStartedAt > 0)) return null;',after:'if (now < launchAt) return null;'},
 {name:'relock-lead',file:'tactics/kite.ts',before:'const RELOCK_LEAD_MS = 100;',after:'const RELOCK_LEAD_MS = 0;'},
 {name:'engagement-gap',file:'tactics/fight.ts',before:'const ENGAGEMENT_GAP_MS = 4000;',after:'const ENGAGEMENT_GAP_MS = 8000;'},
 {name:'orb-chance',file:'tactics/fight.ts',before:'kite: rng.decide() < cfg.tier.orbwalk.p * cfg.persona.kite',after:'kite: rng.decide() < 0'},
];
const pristine=run('pristine');assert(pristine.semanticEqual&&pristine.profileEqual);
const results=[];
for(const c of [...cases,{name:'provenance-nonkill',file:'tactics/fight.ts',before:'const LOCK_MARGIN = 40;',after:'const LOCK_MARGIN = 40; // provenance-only control'}]) {
 const p=work+'/packages/server/src/bots/brain/'+c.file,original=readFileSync(p,'utf8');
 assert.equal(original.split(c.before).length-1,1,'unique compiled source edit');
 const mutated=original.replace(c.before,c.after);writeFileSync(p,mutated);
 try {const observed=run(c.name),nonkill=c.name==='provenance-nonkill';
  assert.equal(observed.semanticEqual,nonkill,c.name+' semantic sensitivity');
  if(nonkill)assert.equal(observed.profileEqual,false,'nonkill changes real source provenance');
  results.push({...c,beforeFileSha256:sha(original),afterFileSha256:sha(mutated),expected:nonkill?'semantic nonkill, provenance changes':'semantic kill',observed});
  console.log(JSON.stringify({control:c.name,exit:observed.exit,semanticEqual:observed.semanticEqual,profileEqual:observed.profileEqual}));
 }finally{writeFileSync(p,original);}
}
const restored=run('restored');assert(restored.semanticEqual&&restored.profileEqual);
const result={format:'rh-bot-fight-controls/1',fixtureSha256:sha(readFileSync('/repo/parity/policy/bot-fight/source.json')),
 expectedSemanticSha256:sha(expectedSemantic),pristine,results,restored,
 boundary:'Actual TS imports are compiled by tsx after one unique source edit in tmpfs. No fixture mutation. Semantic comparison excludes only profile/provenance; declared inputs, outputs, streams, timing and path records remain included.'};
writeFileSync(out+'/controls.json',JSON.stringify(result,null,1)+'\n');
console.log(JSON.stringify({semanticKills:cases.length,provenanceNonkills:1,pristine:true,restored:true}));

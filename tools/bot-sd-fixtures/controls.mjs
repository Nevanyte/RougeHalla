import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,cpSync,symlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const out='/out',work='/work';
const sha=x=>createHash('sha256').update(x).digest('hex');
const semantic=x=>{const c=structuredClone(x);delete c.profile;return JSON.stringify(c);};
mkdirSync(work,{recursive:true});
for(const p of ['packages','tools/bot-sd-fixtures','tools/bot-fight-fixtures','package.json','package-lock.json','tsconfig.base.json'])cpSync('/repo/'+p,work+'/'+p,{recursive:true});
symlinkSync('/repo/node_modules',work+'/node_modules');
const expected=JSON.parse(readFileSync('/repo/parity/policy/bot-sd/source.json'));
const expectedSemantic=semantic(expected);
function run(name) {
 const path='/tmp/'+name+'.json';
 const r=spawnSync(process.execPath,['--import','tsx',work+'/tools/bot-sd-fixtures/capture.mts','--write',path],{
  cwd:work,env:{...process.env,RH_BOT_SD_SOURCE_ROOT:work},encoding:'utf8',maxBuffer:2**20});
 const log=`exit=${r.status} signal=${r.signal}\n${r.stdout}${r.stderr}`;
 writeFileSync(out+'/'+name+'.log',log);
 let observed=null;
 if(r.status===0)observed=JSON.parse(readFileSync(path));
 else assert(r.status===1&&r.stderr.includes('AssertionError'),'control must reach actual source/semantic assertions, not fail compilation or tooling');
 return {exit:r.status,signal:r.signal,logSha256:sha(log),semanticEqual:observed!==null&&semantic(observed)===expectedSemantic,
  semanticSha256:observed===null?null:sha(semantic(observed)),profileEqual:observed!==null&&JSON.stringify(observed.profile)===JSON.stringify(expected.profile)};
}
const cases=[
 {name:'knowledge-gate',file:'tactics/fight.ts',before:'const sdOn = knowsSd &&',after:'const sdOn ='},
 {name:'start-clock',file:'tactics/fight.ts',before:'now >= p.hud.suddenDeathAt',after:'now > p.hud.suddenDeathAt'},
 {name:'hp-band',file:'tactics/fight.ts',before:'const SD_BAND = 0.02;',after:'const SD_BAND = 0.03;'},
 {name:'hysteresis',file:'tactics/fight.ts',before:'sdHold ? lead > -SD_BAND : lead > SD_BAND',after:'lead > SD_BAND'},
 {name:'distance340',file:'tactics/fight.ts',before:'if (foe.dist < SD_KEEP)',after:'if (foe.dist <= SD_KEEP)'},
 {name:'held-order',file:'tactics/fight.ts',before:'if (held) return finish(null, running("sudden death: keeping distance"), false);',after:'if (false && held) return finish(null, running("sudden death: keeping distance"), false);'},
 {name:'cache1200',file:'tactics/kite.ts',before:'now - at < RETREAT_KEEP_MS',after:'now - at <= RETREAT_KEEP_MS'},
 {name:'arrived48',file:'tactics/kite.ts',before:'dist(self, dest) > RETREAT_ARRIVED',after:'dist(self, dest) >= RETREAT_ARRIVED'},
 {name:'threat-distance',file:'tactics/kite.ts',before:'if (nearDest >= nearMe) return dest;',after:'return dest;'},
 {name:'progress-touch',file:'tactics/fight.ts',before:'if (sdHold) {\n      touch();',after:'if (sdHold) {'},
 {name:'seen-gate',file:'tactics/fight.ts',before:'&& !foe.mob && foe.seen;',after:'&& !foe.mob;'},
 {name:'leave-held',file:'tactics/fight.ts',before:'leave() { lastMove = null; held = false; plan = null; }',after:'leave() { lastMove = null; plan = null; }'},
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
const result={format:'rh-bot-sd-controls/1',fixtureSha256:sha(readFileSync('/repo/parity/policy/bot-sd/source.json')),
 expectedSemanticSha256:sha(expectedSemantic),pristine,results,restored,
 boundary:'Actual TS imports are compiled by tsx after one unique source edit in tmpfs. No fixture mutation. Semantic comparison excludes only profile/provenance; declared inputs, outputs, streams, timing and path records remain included.'};
writeFileSync(out+'/controls.json',JSON.stringify(result,null,1)+'\n');
console.log(JSON.stringify({semanticKills:cases.length,provenanceNonkills:1,pristine:true,restored:true}));

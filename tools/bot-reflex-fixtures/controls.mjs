import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,cpSync,symlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const out='/out',work='/work',sha=x=>createHash('sha256').update(x).digest('hex');
const semantic=x=>{const c=structuredClone(x);delete c.profile;return JSON.stringify(c);};
mkdirSync(work,{recursive:true});
for(const p of ['packages','tools/bot-reflex-fixtures','tools/bot-fight-fixtures','package.json','package-lock.json','tsconfig.base.json'])cpSync('/repo/'+p,work+'/'+p,{recursive:true});
symlinkSync('/repo/node_modules',work+'/node_modules');
const expected=JSON.parse(readFileSync('/repo/parity/policy/bot-reflex/source.json')),expectedSemantic=semantic(expected);
function run(name){
 const path='/tmp/'+name+'.json';
 const r=spawnSync(process.execPath,['--import','tsx',work+'/tools/bot-reflex-fixtures/capture.mts','--write',path],{cwd:work,env:{...process.env,RH_BOT_REFLEX_SOURCE_ROOT:work},encoding:'utf8',maxBuffer:2**20});
 const log=`exit=${r.status} signal=${r.signal}\n${r.stdout}${r.stderr}`;writeFileSync(out+'/'+name+'.log',log);
 let observed=null;
 if(r.status===0)observed=JSON.parse(readFileSync(path));
 else assert(r.status===1&&r.stderr.includes('AssertionError'),'must execute real source/semantic assertions; compilation/tool failure is not a kill');
 return {exit:r.status,signal:r.signal,logSha256:sha(log),semanticEqual:observed!==null&&semantic(observed)===expectedSemantic,semanticSha256:observed===null?null:sha(semantic(observed)),profileEqual:observed!==null&&JSON.stringify(observed.profile)===JSON.stringify(expected.profile)};
}
const edits=[
 ['dodge-before-hold','const found = dodge(ctx) ?? (ctx.p.now < r.holdUntil ? null : juke(ctx));','const found = ctx.p.now < r.holdUntil ? null : (dodge(ctx) ?? juke(ctx));'],
 ['hold-strict-boundary','ctx.p.now < r.holdUntil ? null : juke(ctx)','ctx.p.now <= r.holdUntil ? null : juke(ctx)'],
 ['shared-remember-47','const REMEMBER = 48;','const REMEMBER = 47;'],
 ['shared-remember-49','const REMEMBER = 48;','const REMEMBER = 49;'],
 ['incoming-versus-step','exGaussianMean(stim ? tier.reaction : tier.step)','exGaussianMean(tier.step)'],
 ['lead-strict-boundary','if (c.ttiMs < lead + APPLY_LAG_MS + walkMs)','if (c.ttiMs <= lead + APPLY_LAG_MS + walkMs)'],
 ['negative-lag-clamp','const lagMs = Math.max(0, p.now - p.viewT);','const lagMs = p.now - p.viewT;'],
 ['speed-floor','Math.max(0.3, p.self.speedMult)','Math.max(0.1, p.self.speedMult)'],
 ['negative-decision-retention','decided.set(key, yes);','if (yes) decided.set(key, yes);'],
 ['side-fallback','for (const s of [side, -side])','for (const s of [side])'],
 ['juke-1500-window','due - p.now > JUKE_WINDOW_MS','due - p.now >= JUKE_WINDOW_MS'],
 ['juke-release-boundary','due <= p.now','due < p.now'],
 ['feint-read','known.feints > 0','known.feints < 0'],
 ['shot-player-mob-order','[...p.fighters, ...p.mobs]','[...p.mobs, ...p.fighters]'],
 ['wand-cue-retains-sword','if (who) out.push','if (who && who.inHand === "wand") out.push'],
 ['shot-dead-exclusion','f.status !== "alive" || f.inHand','f.inHand'],
 ['aim-range-boundary','if (d > JUKE_RANGE)','if (d >= JUKE_RANGE)'],
 ['aim-right-angle','diff < Math.PI / 2 && d * Math.sin(diff)','diff <= Math.PI / 2 && d * Math.sin(diff)'],
 ['aim-lateral-boundary','d * Math.sin(diff) <= JUKE_LATERAL','d * Math.sin(diff) < JUKE_LATERAL'],
 ['aim-under-one','return d < 1 || (diff','return (diff'],
];
const file=work+'/packages/server/src/bots/brain/tactics/kite.ts',original=readFileSync(file,'utf8');
const pristine=run('pristine');assert(pristine.semanticEqual&&pristine.profileEqual);
const results=[];
for(const [name,before,after] of [...edits,['provenance-nonkill','const REMEMBER = 48;','const REMEMBER = 48; // unchanged behavior']]){
 assert.equal(original.split(before).length-1,1,'unique compiled source edit: '+name);
 const mutated=original.replace(before,after);writeFileSync(file,mutated);
 try{const observed=run(name),nonkill=name==='provenance-nonkill';assert.equal(observed.semanticEqual,nonkill,name+' semantic sensitivity');if(nonkill)assert.equal(observed.profileEqual,false);
  results.push({name,before,after,beforeFileSha256:sha(original),afterFileSha256:sha(mutated),expected:nonkill?'semantic nonkill, provenance changes':'semantic kill',observed});console.log(JSON.stringify({name,...observed}));
 }finally{writeFileSync(file,original);}
}
const restored=run('restored');assert(restored.semanticEqual&&restored.profileEqual);
writeFileSync(out+'/controls.json',JSON.stringify({format:'rh-bot-reflex-controls/1',fixtureSha256:sha(readFileSync('/repo/parity/policy/bot-reflex/source.json')),expectedSemanticSha256:sha(expectedSemantic),pristine,results,restored,boundary:'One compiled actual-source edit at a time in tmpfs; semantic projection excludes only profile. Compiler/tool failures cannot count as kills. No fixture/source checkout writes.'},null,1)+'\n');
console.log(JSON.stringify({semanticKills:edits.length,provenanceNonkills:1,pristine:true,restored:true}));

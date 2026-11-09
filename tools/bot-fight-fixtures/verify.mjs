import assert from 'node:assert/strict';
export function verify(c) {
 assert.equal(c.format,'rh-bot-fight-source/1');
 assert.equal(c.cases.length,15);assert.equal(c.orbs.length,6);assert.equal(c.timings.length,90);
 for(const group of [...c.cases,...c.orbs]) {
  let last=-Infinity;
  for(const r of group.rows) {
   assert(r.input.percept.now>last);last=r.input.percept.now;
   assert.deepEqual(r.normalReflex,{result:null,holdUntil:0,decideDraws:0});
   for(const s of Object.values(r.rngAfter)){assert.equal(s.count,s.draws.length);assert(Number.isFinite(s.nextFromIndependentReplay));}
   for(const name of ['motor','lapse'])assert.equal(r.rngAfter[name].count,0);
   assert.equal(r.rngAfter.knowledge.count,70);
  }
 }
 assert(c.unavailableTiming.every(x=>x.result===null));
 assert.equal(c.missingInventory.error.name,'TypeError');
 const rows=n=>c.cases.find(x=>x.name===n).rows;
 const intents=r=>r.result.intents.map(x=>x.kind);
 assert.deepEqual(intents(rows('arm-other-slot')[0]),['swap']);
 assert.equal(rows('both-slots-empty-is-source-fists')[0].result.attacking,true);
 assert.deepEqual(rows('no-faction-is-not-empty-kit')[0].result,{intents:[],status:{state:'failed',why:'no faction yet'},attacking:false});
 for(const r of rows('wand-locked-no-reclick'))assert.deepEqual(intents(r),[]);
 for(const r of rows('bow-and-melee-aimed-intents'))assert.equal(r.result.intents[0].why,'click an aimed attack');
 const progress=rows('approach-resend-and-progress-timeout');
 assert.deepEqual(intents(progress[0]),['move']);assert.deepEqual(intents(progress[1]),[]);assert.deepEqual(intents(progress[2]),['move']);
 assert.equal(progress.at(-2).result.status.state,'running');
 assert.deepEqual(progress.at(-1).result.status,{state:'failed',why:'no progress in 10 s'});
 assert.deepEqual(rows('path-replan-gap-and-waypoint').map(r=>r.paths.filter(p=>p.method==='path').length),[1,0,1]);
 assert.equal(rows('no-path-third-plan-fails').at(-1).result.status.why,'no path to the target');
 assert.deepEqual(rows('melee-reach-is-not-sight').map(intents),[['move'],['lock']]);
 assert.deepEqual(rows('swap-cooldown-and-draw-guard').map(r=>intents(r).includes('swap')),[false,true,false,true]);
 assert.deepEqual(rows('wand-windup-swap-guard').map(r=>intents(r).includes('swap')),[false,true]);
 assert.equal(rows('target-down-and-unknown').at(-1).result.status.state,'done');
 assert.equal(rows('unknown-target-is-source-done')[0].result.status.state,'done');
 assert.deepEqual(rows('world-to-fight-one-time-knowledge').map(r=>r.drawDelta.decide),[1,1,0]);
 const fightOrb=rows('fight-orb-engagement-chance-jitter-and-gap');
 assert.deepEqual(fightOrb.map(r=>r.drawDelta.decide),[2,0,0,1,0,0,1]);
 assert.equal(fightOrb[3].result.intents[0].kind,'move');assert.equal(fightOrb[3].stats.kiteCycles,1);
 assert.equal(fightOrb[4].result.intents[0].timing.kind,'timed');
 const orb=n=>c.orbs.find(x=>x.name===n).rows;
 const launch=orb('launch-draw-away-wait-relock');
 assert.deepEqual(launch.map(r=>typeof r.result==='object'?r.result?.kind??null:r.result),[null,null,null,'move','wait','lock','lock',null]);
 assert.equal(launch[5].result.timing.due,launch[5].input.percept.self.readyAt-100);
 assert.equal(launch[6].result.timing.due,launch[6].input.percept.now);
 assert.deepEqual(orb('small-ready-jump-is-not-shot').map(r=>r.decideDrawDelta),[0,0,1]);
 assert.equal(orb('no-cooldown-left')[0].result,null);
 assert.deepEqual(orb('lost-move-900-boundary').map(r=>typeof r.result==='object'?r.result?.kind??null:r.result),['move','wait',null]);
 assert.deepEqual(orb('away-abandoned-3000-boundary').map(r=>typeof r.result==='object'?r.result?.kind??null:r.result),['move','lock','lock',null]);
 assert.equal(orb('cornered-no-away-point')[0].result,null);assert.equal(orb('cornered-no-away-point')[0].decideDrawDelta,1);
}

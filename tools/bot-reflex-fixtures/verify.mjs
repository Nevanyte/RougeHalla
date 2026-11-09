import assert from 'node:assert/strict';
export function verify(x){
 assert.equal(x.format,'rh-bot-reflex-source/1');
 assert.equal(new Set(x.cases.map(c=>c.name)).size,x.cases.length);
 for(const c of x.cases)for(const r of c.rows){
  assert.equal(r.drawDelta.motor,0);assert.equal(r.drawDelta.lapse,0);
  assert(r.paths.every(p=>p.method==='clear'));
  if(r.result)assert.equal(r.result.intent.priority,0);
 }
 const rows=name=>{const c=x.cases.find(c=>c.name===name);assert(c,'required declared case '+name);return c.rows;};
 const first=name=>rows(name)[0];
 const kind=(name,want)=>assert.equal(first(name).result?.kind??null,want,name);
 for(const name of ['ball-positive-and-decision-duplicate','positive-arrow-dodge','negative-lag-clamps-to-zero','speed-at-floor'])kind(name,'dodge');
 for(const name of ['player-bow-positive','wand-cue-positive-while-current-hand-is-sword','known-null-faction-bow-source-fallback','mob-bow-positive','window-1500-exact','due-one-ms-future-accepted','aim-range300-exact','aim-lateral60-exact-3-4-5','aim-lateral-below60','aim-under1-bypasses-facing'])kind(name,'juke');
 for(const name of ['new-incoming-uses-reaction-lead-and-is-too-late','lag-reduces-effective-course-time','negative-lag-clamp-at-lead-boundary','easy-tier-has-no-juke-draw','window-1501-is-refused','due-equals-now-refused','aim-range-over300','aim-right-angle-near-excluded','aim-lateral60-nominal-binary64-outside','aim-lateral-over60']){kind(name,null);assert.equal(first(name).drawDelta.decide,0,name);}
 for(const name of ['positive-offset-first-side-blocked','negative-offset-first-side-blocked','juke-first-side-blocked-uses-opposite'])assert.deepEqual(first(name).paths.map(p=>p.result),[false,true]);
 for(const name of ['both-dodge-sides-blocked-remembers-yes','juke-both-sides-blocked-remembers-yes']){
  const [a,b]=rows(name);assert.equal(a.result,null);assert.deepEqual(a.paths.map(p=>p.result),[false,false]);assert(a.drawDelta.decide>0);assert.equal(b.drawDelta.decide,0);assert.equal(b.result,null);
 }
 for(const name of ['ball-false-dice-is-remembered','juke-false-dice-remembers-shot'])assert.deepEqual(rows(name).map(r=>r.drawDelta.decide),[1,0]);
 const step=rows('real-observe-only-produces-step-not-new-incoming');assert.equal(step[0].called,false);assert(!('result'in step[0]));assert.equal(step[1].result?.intent?.timing?.kind,'step');
 assert.equal(first('ball-positive-and-decision-duplicate').result?.intent?.timing?.kind,'react');
 assert.equal(first('speed-below-floor').state.holdUntil,first('speed-at-floor').state.holdUntil);
 const lead=rows('public-hold-derived-lead-below-exact-above');assert.deepEqual(lead.map(r=>r.drawDelta.decide),[1,0,1,1]);assert(lead.slice(1).every(r=>r.input.dependency.lead));
 const hold=rows('dodge-precedes-hold-and-juke-exact-public-hold-boundary');assert.equal(hold[2].result?.kind,'dodge');assert(hold[2].input.percept.now<hold[1].state.holdUntil);assert.equal(hold[3].result,null);assert.equal(hold[3].drawDelta.decide,0);assert.equal(hold[4].input.percept.now,hold[3].state.holdUntil);assert.equal(hold[4].result?.kind,'juke');
 assert.deepEqual(rows('single48-order-includes-negative-projectile-and-shot-decisions').map(r=>r.drawDelta.decide),[0,0,0,1]);
 const reentry=rows('projectile-reentry-new-memory-stimulus-retains-reflex-decision');assert(reentry[2].memory.stimuli.some(s=>s.kind==='incoming'&&s.subject==='ball-a'));assert.equal(reentry[2].drawDelta.decide,0);
 const read=first('real-feint-memory-seed-0'),miss=first('real-feint-memory-seed-1');assert.equal(read.memory.fighterFeints[0].feints,1);assert.equal(read.drawDelta.decide,1);assert.equal(read.result,null);assert.equal(miss.memory.fighterFeints[0].feints,1);assert.equal(miss.drawDelta.decide,3);assert.equal(miss.result?.kind,'juke');
}

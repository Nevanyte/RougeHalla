import assert from 'node:assert/strict';
export function verify(c){
 assert.equal(c.format,'rh-bot-sd-source/1');assert.equal(c.cases.length,8);
 for(const seq of c.cases){let last=-Infinity;for(const row of seq.rows){assert(row.input.percept.now>last);last=row.input.percept.now;assert.deepEqual(row.normalReflex,{result:null,holdUntil:0,draws:0});for(const s of Object.values(row.rngAfter))assert.equal(s.count,s.draws.length);assert.equal(row.rngAfter.motor.count,0);assert.equal(row.rngAfter.lapse.count,0);assert.equal(row.rngAfter.knowledge.count,70);}}
 const r=n=>c.cases.find(x=>x.name===n).rows;
 const kinds=rows=>rows.map(r=>r.result.intents.map(i=>i.kind));
 const sd='sudden death: keeping distance';
 assert.deepEqual(r('known-clock-disabled-future-exact-start-and-exit').map(r=>r.result.status.why),['attacking','attacking',sd,'attacking',sd]);
 assert.deepEqual(kinds(r('actual-unknown-knowledge-draw-keeps-normal-fight')),[['lock'],['lock']]);
 assert.deepEqual(r('f32-health-sides-and-retained-two-percent-band').map(r=>r.result.status.why),['attacking',sd,sd,sd,'attacking','attacking',sd]);
 assert.deepEqual(kinds(r('exact-340-quiet-held-inside-and-world-leave')),[['stop'],[],['move'],['stop'],[],['stop'],['stop']]);
 const cache=r('retreat-cache-reuse-exact48-threat-change-and1200');
 assert.deepEqual(cache.map(r=>r.result.intents[0].to.x),[376,376,200,648,648,658]);
 assert.deepEqual(cache.map(r=>r.paths.filter(p=>p.method==='clear').length),[32,0,32,32,0,32]);
 assert.deepEqual(kinds(r('cornered-sd-falls-through-to-real-normal-fight')),[['lock'],['lock']]);
 const lost=r('seen-remembered-reentry-and-actual-memory-expiry');
 assert.deepEqual(lost.map(r=>r.result.status.why),[sd,'approaching',sd,'approaching','lost track of the target']);
 const progress=r('sd-touches-progress-watch-and-exit-keeps-strict10s');
 assert(progress.slice(0,-1).every(r=>r.result.status.state==='running'));
 assert.deepEqual(progress.at(-1).result.status,{state:'failed',why:'no progress in 10 s'});
 assert(c.cases.every(c=>c.rows[0].drawDelta.decide===2));
 assert.equal(c.cases.reduce((n,c)=>n+c.rows.length,0),46);
}

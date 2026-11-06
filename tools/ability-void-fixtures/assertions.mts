import assert from 'node:assert/strict';
export function verify(cases:any[]) {
 assert.equal(cases.length,2);
 for(const c of cases) {
  const [queue,pending,abandoned,span]=c.timeline;
  const rt=(f:any,id='p0')=>f.private.players.find((p:any)=>p.id===id);
  const state=(f:any,id='p0')=>f.public.players.find((p:any)=>p.id===id)?.state;
  assert.equal(c.initial.label,'declared-player-bootstrap');
  assert.equal(rt(c.initial).cast,null);
  assert.equal(queue.inputs.length,1);assert.equal(queue.inputs[0].accepted,true);
  assert.equal(queue.time,c.initial.time);assert.equal(rt(queue).inputs.actions.length,1);
  assert.equal(rt(queue).cast,null);assert.equal(rt(queue).inputs.actions[0].kind,'cast');
  assert.equal(rt(pending).inputs.actions.length,0);
  const cast=rt(pending).cast;
  assert(cast);assert.equal(cast.ability,'freeze');assert.equal(cast.target,'p1');
  assert.equal(cast.slot,'wish');assert.equal(cast.rank,1);assert.equal(cast.landing,null);
  assert.equal(cast.startedAt,pending.time);assert(cast.landsAt>pending.time);
  assert.equal(cast.prevReadyAt,state(c.initial).wishReadyAt);
  assert.deepEqual(cast.prevFullAt,state(c.initial).extra.wishFullAt);
  assert(state(pending).wishReadyAt>cast.startedAt);
  assert(state(pending).extra.wishFullAt>cast.startedAt);
  assert.equal(pending.private.arena.voided,false);
  assert.equal(abandoned.time,pending.time);assert.equal(abandoned.private.arena.voided,true);
  assert.equal(span.executed,10);assert.equal(span.frames.length,10);
  assert.equal(c.ordinarySteps,12); // birth + intake + ten voided steps
  const gone=c.input.actions[2].actor;
  for(const [i,f] of [abandoned,...span.frames,c.final].entries()) {
   assert.equal(f.phase,'active');assert.equal(f.private.arena.voided,true);
   assert(rt(f));assert(state(f));assert.equal(rt(f,gone),undefined);assert.equal(state(f,gone),undefined);
   assert.equal(!!rt(f,'p1'),gone==='p2');assert.equal(!!state(f,'p1'),gone==='p2');
   assert.deepEqual(rt(f).cast,cast,'frozen producer detail including rollback tuple');
   assert.equal(state(f).wishReadyAt,state(pending).wishReadyAt);
   assert.deepEqual(state(f).extra.wishFullAt,state(pending).extra.wishFullAt);
   assert.deepEqual(f.rng,pending.rng,'voided steps draw no RNG');
   if(i>=1&&i<=10){assert.equal(f.time,pending.time+i*50);assert.equal(f.tick,pending.tick+i);}
  }
  assert.equal(c.final.time,pending.time+500);assert(c.final.time>cast.landsAt);
  const events=c.completeNonemptyEventTape.flatMap((t:any)=>t.events);
  assert(events.some((e:any)=>e.type==='fx'&&e.fx.kind==='cast'));
  assert(!events.some((e:any)=>e.type==='fx'&&['castLand','castEnd'].includes(e.fx.kind)));
  assert(!c.completeOrdinaryHookTape.some((t:any)=>t.time>pending.time));
 }
}

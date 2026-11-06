import assert from 'node:assert/strict';
export function verify(cases:any[]){assert.equal(cases.length,1);const c=cases[0];const first=c.timeline[0],refund=c.timeline[1],last=c.final;
 assert.equal(first.private.players[0].cast.startedAt,100);assert.equal(first.private.players[0].cast.landsAt,350);
 assert.equal(refund.private.abilities.teleportedAt,150);assert.equal(refund.private.players[0].cast,null);assert.equal(refund.public.players[0].state.wishReadyAt,50);assert.equal(refund.public.players[0].state.extra.wishFullAt,50);
 assert(last.private.abilities.teleportedAt>350);assert.equal(last.private.players[0].cards.wishCast.at,100);assert.equal(last.private.players[0].cast,null);assert.equal(last.public.players[0].state.wishReadyAt,50);assert.equal(last.public.players[0].state.extra.wishFullAt,50);assert.equal(last.phase,'active');assert.equal(last.public.players.length,2);
 const hooks=c.completeOrdinaryHookTape.flatMap((t:any)=>t.hooks).filter((h:any)=>h.hook==='teleported'&&h.installer==='abilities');assert.equal(hooks.length,2);
 assert.equal(c.ordinarySteps,13);assert.equal(last.time,650);
}

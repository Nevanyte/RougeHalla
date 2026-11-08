import assert from 'node:assert/strict';
export function verify(cases:any[]){assert.equal(cases.length,1);const c=cases[0];
 const frames=c.timeline.flatMap((t:any)=>t.frames??[t]);const reset=c.completeOrdinaryHookTape.flatMap((t:any)=>t.hooks).find((h:any)=>h.hook==='teleported'&&h.installer==='factions');assert(reset);
 const target=(f:any)=>f.public.players.find((p:any)=>p.id==='p1')?.state;
 const shred=(f:any)=>f.private.players.find((p:any)=>p.id==='p1')?.statuses?.some((s:any)=>s.kind==='shred');
 assert(frames.some((f:any)=>f.time<reset.time&&shred(f)&&target(f).armorBonus<0),'actual axe produces Shred and a nonidentity armor cache before teleport');
 const after=c.timeline[1].frames.at(-1);assert.equal(after.time,reset.time);assert(!shred(after));assert(target(after).armorBonus<0,'quiet teleport status removal retains the source armor cache');
 const continued=c.timeline[8].frames.at(-1);assert(shred(continued));assert(target(continued).armorBonus<0);assert(target(continued).hp<target(c.timeline[7]).hp);
 assert.equal(c.timeline[2].healGained,0);assert(c.timeline[4].healGained>0);assert.equal(c.final.phase,'ended');
 for(const f of frames)for(const p of f.public.players)assert.deepEqual(p.state.build,{});
}

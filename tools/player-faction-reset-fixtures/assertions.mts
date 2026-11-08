import assert from 'node:assert/strict';
const absent=(x:any)=>x===undefined||x?.$undefined===true;
export function verify(cases:any[]){assert.equal(cases.length,5);for(const c of cases){
 const hooks=c.completeOrdinaryHookTape.flatMap((t:any)=>t.hooks);const resets=hooks.filter((h:any)=>h.hook==='teleported'&&h.installer==='factions');assert.equal(resets.length,1,c.name);
 const reset=resets[0].resetTransition,before=new Map(reset.before.factions.fighters),after=new Map(reset.after.factions.fighters);const a:any=before.get('p0'),b:any=after.get('p0');
 assert.equal(a.target,'p1',c.name+' actual pre-reset engagement');assert.equal(typeof a.combatAt,'number');assert.equal(b.combatAt,a.combatAt);assert.equal(b.target,null);assert.equal(b.chill,1);assert.equal(b.tier,0);assert.equal(b.dotPausedUntil,0);assert.equal(b.seenAction,null);assert.equal(reset.after.factions.dot.length,0);assert.equal(reset.after.factions.dotSince,resets[0].time);assert(absent(reset.after.marks));
 for(const p of reset.after.players){assert.equal(p.markTier,0);assert.equal(p.markBy,'');assert.equal(p.markTax,0);assert.equal(p.brand,0);assert.equal(p.frostMoveMult,1000);assert.equal(p.asMult,1000);assert(absent(p.hots));assert(absent(p.fired));}
 const probes=c.timeline.filter((t:any)=>'healGained'in t);assert.equal(probes.length,2);assert.equal(probes[0].healGained,0,c.name+' retained heal lockout');assert(probes[1].healGained>0,c.name+' later ordinary heal');
 if(c.input.players[0].faction==='sentenced'){assert(a.tier>0);const p=reset.before.players.find((p:any)=>p.id==='p0');assert(p.sentence>0);assert.equal(reset.after.players.find((p:any)=>p.id==='p0').sentence,p.sentence);}
 if(c.input.players[0].faction==='frost')assert((before.get('p1')as any).chill<1);
 if(['fire','plague'].includes(c.input.players[0].faction))assert(reset.before.factions.dot.length>0,c.name+' nonempty old dot window');
 const continued=c.timeline[8].frames.at(-1), fresh:any=new Map(continued.private.factions.fighters).get('p0');
 assert(continued.time>resets[0].time);assert.equal(fresh.target,'p1');assert.equal(fresh.engaged,true);assert(fresh.combatAt>resets[0].time);assert(fresh.apHits.length>0);assert(fresh.apHits.every((t:number)=>t>resets[0].time));
 const target=(f:any)=>f.public.players.find((p:any)=>p.id==='p1').state;
 assert(target(continued).hp<target(c.timeline[7]).hp,c.name+' actual continuing damage');
 if(c.input.players[0].faction==='holy')assert(continued.public.players.find((p:any)=>p.id==='p0').state.hp>c.timeline[7].public.players.find((p:any)=>p.id==='p0').state.hp,c.name+' continuing Holy sustain');
 if(c.input.players[0].faction==='sentenced')assert(fresh.tier>0,c.name+' freshly earned Mark');
 if(c.input.players[0].faction==='frost')assert((new Map(continued.private.factions.fighters).get('p1')as any).chill<1,c.name+' freshly produced chill');
 if(['fire','plague'].includes(c.input.players[0].faction))assert(continued.private.factions.dot.length>0,c.name+' freshly produced dot window');
 const ended=hooks.find((h:any)=>h.hook==='runEnded'&&h.installer==='factions').resetTransition;
 assert.deepEqual(ended.after.factions.fighters,ended.before.factions.fighters,c.name+' run end preserves private signature state');
 if(['fire','plague'].includes(c.input.players[0].faction))assert(ended.before.factions.dot.length>0,c.name+' run end flushes actual accumulated damage');
 assert.equal(c.final.phase,'ended');assert.equal(c.final.private.factions.dot.length,0);assert(hooks.some((h:any)=>h.hook==='runEnded'&&h.installer==='factions'));
}}

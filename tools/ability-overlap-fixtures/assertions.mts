import assert from 'node:assert/strict';
export function verify(cases:any[]){assert.equal(cases.length,2);for(const c of cases){
 const frames=c.timeline.flatMap((f:any)=>f.frames??[f]);const f=frames.find((f:any)=>f.time===2650);assert(f,c.name+' reaches ordinary2650');
 const id=c.input.profile==='roster'?'mob2':'p1';const kind=id==='p1'?'players':'mobs';const p=f.private[kind].find((p:any)=>p.id===id);const st=p.statuses.find((st:any)=>st.kind==='dot'&&st.ability==='blaze');
 assert(st,JSON.stringify({name:c.name,mobs:f.private.mobs.map((m:any)=>({id:m.id,statuses:m.statuses})),mobPositions:f.public.mobs.map((m:any)=>({id:m.id,x:m.state.x,y:m.state.y}))}));
 assert.equal(st.startedAt,100);assert.equal(st.until,4650);assert(st.until-st.startedAt>4500);assert(f.public[kind].find((p:any)=>p.id===id).state.hp>0);
 const lands=c.completeNonemptyEventTape.flatMap((f:any)=>f.events).filter((e:any)=>e.fx?.kind==='castLand');assert.equal(lands.length,2);assert.deepEqual(lands.map((e:any)=>e.fx.ability),['blaze','blaze']);
 assert.equal(c.ordinarySteps,53);assert.equal(c.final.time,2650);
}}

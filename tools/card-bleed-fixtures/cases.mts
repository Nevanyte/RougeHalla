/** Declarative producer scenarios. HP/card/position declarations are setup; all damage uses enqueued inputs. */
const P=(faction:string,x:number,y:number,cards:string[]=[],weapon='sword')=>({faction,at:{x,y},cards,weapon});
const I=(actor:string,type:string,payload:any={})=>({actor,type,payload});
const attack=(actor:string,angle=0)=>I(actor,'attack',{a:angle});
const release=(actor:string,angle=0)=>I(actor,'release',{a:angle});
const step=(...inputs:any[])=>({kind:'step',inputs});
const span=(count:number)=>({kind:'span',count});
const setup=(actor:string,extra:any)=>({kind:'setup',actor,...extra});
const endRaid=()=>({kind:'startRaid'});

const cases:any[]=[];
function add(name:string,players:any[],actions:any[],extra:any={}) {
  cases.push({name,players,actions,...extra});
}

// Distinct actors create real Hemorrhage statuses. Equal-pair refreshes should retain the first pair slot.
add('ordered-pairs-and-repeat-pair',[
  P('holy',300,320,['hemorrhage']), P('fire',300,350,['hemorrhage']),
  P('fire',335,320), P('holy',335,350),
], [
  step(attack('p0'),attack('p1')), span(45),
  step(release('p0'),release('p1')), span(12),
], {config:{pvpRules:true}});

// One real bleed report starts after the weapon-created status first ticks. Captures all fixed 50 ms boundaries,
// including 500 ms and later empty intervals after the first periodic clear.
add('first-use-clock-periodic-and-empty-interval',[
  P('holy',300,320,['hemorrhage']), P('fire',335,320),
], [step(attack('p0')), step(release('p0')), span(85)], {config:{pvpRules:true}});

// A natural last-player-standing end: after a real bleed contribution exists, setup lowers the victim to the next
// bleed's measured source damage; an ordinary step kills them and settle calls the registered runEnded hook.
add('run-ended-before-periodic-window',[
  P('holy',300,320,['hemorrhage']), P('fire',335,320),
], [step(attack('p0')), span(4), setup('p1',{hp:0.01}), span(2)], {config:{pvpRules:true}});

// Patience expiry triggers the real ordinary settle/teleport path. The report is not a teleport-owned queue.
add('teleport-retains-partial-report',[
  P('holy',300,320,['hemorrhage']), P('fire',335,320),
], [step(attack('p0')), span(35), step(release('p0')), span(30)],
  {config:{pvpRules:true,firstPatienceSeconds:0.3,patienceSeconds:0.3,patienceMinSeconds:0.3}});

// The real startRaid producer reruns the raidStarted hook after a partial report exists. Subsequent ordinary 50 ms
// steps show whether pre-reset contributions are discarded rather than emitted at the old interval boundary.
add('raid-start-clears-partial-report',[
  P('holy',300,320,['hemorrhage']), P('fire',335,320),
], [step(attack('p0')), span(4), endRaid(), span(14)], {config:{pvpRules:true}});

// Fire signature damage and card bleed coexist in the actual full producer profile. The raw card case consists only
// of source hit FX with neither signature nor ability metadata; other source DoT feedback stays distinguishable.
add('card-dot-excludes-signature-and-ability-dot',[
  P('holy',300,320,['hemorrhage']), P('fire',335,320),
  P('fire',300,400), P('holy',335,400),
], [step(attack('p0'),attack('p2')), span(55), step(release('p0'),release('p2')), span(15)],
  {profile:'full',config:{pvpRules:true}});

// A no-card control reaches the same ordinary world/step path but has no card-owned DoT producer.
add('no-card-dot-control',[
  P('holy',300,320), P('fire',335,320),
], [step(attack('p0')), span(70), step(release('p0'))], {config:{pvpRules:true}});

export {cases};

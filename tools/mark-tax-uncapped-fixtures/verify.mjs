import assert from 'node:assert/strict';
export function verify(f){
 assert.equal(f.format,'rh-mark-tax-uncapped-source/1');assert.equal(f.cases.length,2);
 const [high,low]=f.cases;assert.equal(high.input.highCount,20000);assert.equal(low.input.highCount,1);
 for(const c of f.cases){
  assert.equal(c.input.players.length,1);assert.equal(c.input.players[0].faction,'holy');
  assert.equal(c.frames.at(-1).value.time,3050);
  assert(c.frames.some(r=>r.value.sources.length===3));
  assert(c.frames.some(r=>r.value.sources.some(s=>s.brain.mode==='fight'&&s.mark?.hits>0)));
  const hits=c.frames.flatMap(r=>r.events).filter(e=>e.type==='fx'&&e.fx.kind==='hit');
  assert(hits.some(e=>e.fx.by==='p0'),'actual ordinary player wake damage');
  assert(hits.some(e=>e.fx.id==='p0'),'actual NPC damage to subject');
  assert(!c.frames.flatMap(r=>r.events).some(e=>e.type==='fx'&&e.fx.kind==='death'),'no installed/dead-source shortcut');
 }
 const live=high.frames.filter(r=>r.value.player.markTax>0);assert(live.length>0,'genuine selected nonneutral source tax');
 const first=live[0].value;assert.equal(first.tick,48);assert.equal(first.time,2400);
 assert.equal(first.rawSheetRate,190.95);assert.equal(first.player.asMult,104211);assert.equal(first.player.markTax,48);
 assert.equal(first.actualModSource.asMult,0.5184603299293009);
 assert(first.player.sig&f.constants.sigTaxed,'actual source SIG_TAXED');
 for(const r of live){
  const s=r.value;assert(s.rawSheetRate>99);assert(s.actualModSource.asMult>0&&s.actualModSource.asMult<1);
  const candidates=s.sources.filter(v=>v.tierOnSubject>=2&&v.distanceToSubject<=f.constants.markNearRange&&v.public.status==='alive');
  assert(candidates.length>=1);const max=Math.max(...candidates.map(v=>v.tierOnSubject));
  const selected=candidates.filter(v=>v.tierOnSubject===max).map(v=>v.id).sort()[0];
  assert.equal(s.taxedOwner,selected,'actual eligible max-tier lexical owner');
  assert(s.sources.every(v=>v.mark?.group==='fighter:p0'&&v.mark?.originalSize===1),'NPC mark owns actual human singleton');
 }
 assert(live.some(r=>r.value.sources.filter(v=>v.tierOnSubject===2&&v.distanceToSubject<=f.constants.markNearRange).length===3),'actual equal-tier multiowner tie');
 assert(high.frames.some(r=>r.phases.some(p=>p.phase==='before-mods'&&p.value.actualModSource?.asMult<1)));
 const last=high.frames.at(-1).value;assert.equal(last.player.mobStats.plagueRat,1);assert.equal(last.player.asMult,1010);assert.equal(last.player.markTax,0);assert(last.player.markTier>=2);assert.equal(last.actualModSource,null);
 assert(low.frames.some(r=>r.value.taxedOwner!==null&&r.value.player.markTier>=2),'neutral control still has genuine source Mark');
 assert(low.frames.every(r=>r.value.player.markTax===0&&r.value.actualModSource===null),'ordinary low-rate tax neutral');
 assert.equal(f.noninterference.phaseEnabledVersusDisabledStateEventsRng,true);
}

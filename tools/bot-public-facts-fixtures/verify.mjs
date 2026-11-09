import assert from 'node:assert/strict';
// Coverage assertions on actual source returns. They never install a returned value into the source.
export function verify(o) {
 assert.equal(o.format,'rh-bot-public-facts-source/1');
 assert(o.profile?.sourceSha256 && o.profile?.toolSha256);
 const n=o.npc,f=o.flight;
 assert.equal(n.format,'rh-bot-public-facts-npc/1');
 assert(n.sameEntity.ticks.length>=4,'source off-camera/minimap continuity case');
 assert.equal(n.wallLos.canSee,false,'actual opaque wall must deny the line');
 assert.equal(n.wallLos.shouldRenderActorGate,false,'actual human visibility gate must deny the occluded NPC');
 for(const side of ['a','b']){
  assert.equal(n.occludedIdRename[side].humanShouldRenderActorGate,false);
  assert.deepEqual(n.occludedIdRename[side].perceivedActorIds,[]);
  assert.deepEqual(n.occludedIdRename[side].minimapIds,[]);
 }
 const a=n.alphaRename.a.projection,b=n.alphaRename.b.projection;
 assert(a&&b&&a.id!==b.id,'visible source identity is actually renamed');
 const attrs=x=>{const y={...x};delete y.id;return y;};assert.deepEqual(attrs(a),attrs(b));
 const fog=n.wallFogHistory.sameIdentity.ticks;
 assert(fog.length>=5);
 assert(fog[0].frame.actorIds.includes('npc-fog-A'));
 assert.deepEqual(fog[1].frame.actorIds,[]);
 assert(fog[1].publication.actorMapKeys.includes('npc-fog-A'),'raw schema is diagnostic and broader than the view');
 assert(fog[1].humanWorldVisibility.every(row=>row.shouldRenderActorGate===false));
 assert(fog.some(t=>t.frame.minimapDots.length===0),'source minimap refresh actually loses a dot');
 const last=fog.at(-1);assert(last.frame.actorIds.includes('npc-fog-A'));
 assert.equal(last.memory.find(m=>m.id==='npc-fog-A').alive,false,'retain the declared-method diagnostic; not a legitimate-scene or intended-behavior invariant');
 const replacement=n.wallFogHistory.hiddenReplacement.ticks;
 assert(replacement.some(t=>t.frame.actorIds.includes('npc-fog-B')));
 const ends=replacement.at(-1).memory;
 assert.equal(ends.find(m=>m.id==='npc-fog-A').alive,false);
 assert.equal(ends.find(m=>m.id==='npc-fog-B').alive,true);
 const ties=n.equalCueOrder.runs;assert.equal(ties.length,2);
 assert.equal(ties[0].target,ties[0].idOrder[0]);assert.equal(ties[1].target,ties[1].idOrder[0]);assert.notEqual(ties[0].target,ties[1].target);
 assert(n.wallFogHistory.sceneAdmission.includes('Unsupported'));
 assert(n.wallFogHistory.consistentAlphaRename.sourceIdentityRelationMatchesAfterCanonicalRename);
 assert.equal(f.schema,'bot-public-facts-flight/1');
 assert.equal(f.firstSourceFlight?.kind,'ball');assert.equal(f.bowSourceFlight?.kind,'arrow');
 assert(f.sourceSteps.length>0&&f.inputs.length>0,'actual source step/intake evidence');
 assert(f.firstSeenIncoming.some(row=>row.flight.t0<row.viewT),'first source incoming really is midflight');
 assert(f.reflexDecisions.some(row=>row.reflex?.kind==='dodge'),'real source Reflex returns a dodge intent');
 assert(f.bowPublicDrawObserved && f.bowDrawObservations.some(row=>row.drawStartedAt>0),'source public Bow draw actually observed');
 const retained=f.retainedBallAfterSwap??f.retainedWandAfterSwap;
 assert(retained?.flight && retained.shooterHand==='bow','actual ball survives its caster hand swap; this is not a windup claim');
 const disclosure=f.joinDisclosureProbe;assert(disclosure && disclosure.liveWorldEffectsAfter===0);
 assert(disclosure.visibleCurrentState.shooterDrawn && !disclosure.hiddenDeclaredProjection.shooterDrawn);
 assert.equal(disclosure.hiddenDeclaredProjection.attributedFrom,null);
 const normalizeAttribution=p=>{const q={...p};delete q.from;return q;};
 assert.deepEqual(normalizeAttribution(disclosure.visibleCurrentState.launch),normalizeAttribution(disclosure.hiddenDeclaredProjection.launch));
 const swaps=f.preReleaseSwapCueWitness;
 assert(swaps.attackTime<swaps.swapTime && swaps.sourceHandAfterSwap==='bow');
 assert(swaps.delayedChecks.some(row=>row.currentRemoteHand==='bow'&&row.deliveredWindup?.weapon==='wand'));
 assert(f.ownerSelfImmunityClock.length>0,'actual observed owner-clock values, not an invented unavailable default');
 assert(f.rebaseProbe.actualFirstVisibleTravelled>0);
 assert(f.rebaseProbe.scope.includes('does not claim'),'single candidate sample must not claim whole-history equivalence');
}

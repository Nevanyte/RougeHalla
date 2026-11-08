'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CASES, evaluateWishProof, attachWishSummary } = require('./wish-proof-contract.cjs');

function validCase(spec) {
  const deliveredTarget = spec.target === 'unit' ? 2 : null;
  const kind = 'castLanded';
  return {
    faction: spec.faction, ability: spec.ability, name: spec.name, status: 'pass', players: { driver: 1 }, training: false,
    browserKey: { code: 'KeyR', at: 100, isTrusted: true },
    cursorGesture: { at: 99, isTrusted: true, x: 512, y: 420, expectedX: 512, expectedY: 420 },
    deliveredTarget,
    inputSample: { at: 102, frame: 8, player: 1, seq: 9, x: 200, y: 144 },
    castSent: { at: 103, frame: 8, slot: 0, seq: 9, inputFrameSeq: 20, x: 200, y: 144, actorRef: deliveredTarget, sameUnityFrame: true },
    confirmedFx: { kind, ability: spec.ability, caster: 1, eventTime: 250, receivedAt: 110, fxIndex: 0, presentationKind: 'presentWishLanded' },
    confirmedFxEvents: [{ kind, ability: spec.ability, caster: 1, tick: 5, eventTime: 250, receivedAt: 110, fxIndex: 0, frameIndex: 1, occurrence: 0 }],
    wishPresented: { kind: 'presentWishLanded', ability: spec.ability, sourceTime: 250, at: 111, frame: 9, player: 1 },
    wishPresentationEvents: [{ kind: 'presentWishLanded', ability: spec.ability, sourceTime: 250, at: 111, frame: 9, player: 1, occurrence: 0 }],
    inputAcks: [{ at: 112, tick: 1, ack: 20 }],
    ownerBaseline: { ability: spec.ability, readyAt: 40, charges: 2, cast: null },
    ownerUpdate: { ability: spec.ability, receivedAt: 112,
      before: { ability: spec.ability, charges: 2 }, after: { ability: spec.ability, charges: 1 } },
    traceGate: { warmupRecording: false, driverPageStartedAt: 10, observerPageStartedAt: 10, ownerReadyObservedAt: 96,
      ownerReadyServerMs: 50, driverRecordingAt: 97, observerRecordingAt: 97, errorsRetained: true, wireRetained: true },
    screenshot: `wish-evidence/${spec.name.toLowerCase()}.png`,
    traceOverflow: false, traceErrors: [], pageErrors: [],
  };
}

function completeReport() {
  return { expectedCases: 5, cases: CASES.map(validCase), errors: [], pageErrors: [], prerequisites: [] };
}

test('synthetic contract fixture passes only with all five proof stages', () => {
  const report = completeReport();
  assert.equal(evaluateWishProof(report).status, 'PASS');
  attachWishSummary(report);
  assert.deepEqual(report.summary.abilities.map(x => x.ability), [3, 2, 1, 0, 4]);
  assert.ok(report.summary.abilities.every(x => x.sampleToSendMs === 1));
});

test('missing cases and missing trace stages stay incomplete', () => {
  const report = completeReport();
  report.cases.pop();
  report.cases[0].wishPresented = null;
  report.cases[0].traceGate = null;
  const verdict = evaluateWishProof(report);
  assert.equal(verdict.status, 'INCOMPLETE');
  assert.ok(verdict.incomplete.includes('blaze_unity_presentation_missing'));
  assert.ok(verdict.incomplete.includes('blaze_trace_gate_missing'));
  assert.ok(verdict.incomplete.includes('case_coverage_4_of_5'));
});

test('page or decoder errors fail even when a later art hook is missing', () => {
  const report = completeReport();
  report.cases[0].status = 'incomplete';
  report.cases[0].incompleteReason = 'presentation hook absent';
  report.cases[0].wishPresented = null;
  report.cases[0].pageErrors = ['Unity exception'];
  report.cases[0].traceErrors = ['receive decode failed'];
  const verdict = evaluateWishProof(report);
  assert.equal(verdict.status, 'FAIL');
  assert.ok(verdict.failures.includes('blaze_page_error'));
  assert.ok(verdict.failures.includes('blaze_trace_decode_error'));
  assert.ok(verdict.incomplete.includes('blaze_presentation hook absent'));
});

test('sample sequence and Unity frame must match the actual Cast send', () => {
  const report = completeReport();
  report.cases[0].castSent.seq = 10;
  report.cases[1].castSent.frame = 9;
  const verdict = evaluateWishProof(report);
  assert.equal(verdict.status, 'FAIL');
  assert.ok(verdict.failures.includes('blaze_sample_send_mismatch'));
  assert.ok(verdict.failures.includes('trial_sample_send_mismatch'));
});

test('unit cast target must be the currently delivered actor', () => {
  const report = completeReport();
  report.cases.find(x => x.faction === 1).castSent.actorRef = 88;
  assert.ok(evaluateWishProof(report).failures.includes('trial_cast_target_not_currently_delivered_actor'));
});

test('presentation must preserve the exact confirmed producer timestamp', () => {
  const report = completeReport();
  report.cases.find(x => x.faction === 3).wishPresented.sourceTime += 50;
  assert.ok(evaluateWishProof(report).failures.includes('freeze_presentation_source_event_mismatch'));
});

test('same-ability same-tick FX and presentation occurrences remain separately ordered', () => {
  const report = completeReport();
  const item = report.cases[0];
  item.confirmedFxEvents = [
    { kind: 'castStarted', ability: item.ability, caster: 1, tick: 4, eventTime: 230, receivedAt: 109, fxIndex: 0, frameIndex: 0, occurrence: 0 },
    { kind: 'castLanded', ability: item.ability, caster: 1, tick: 5, eventTime: 250, receivedAt: 110, fxIndex: 0, frameIndex: 1, occurrence: 1 },
    { kind: 'castLanded', ability: item.ability, caster: 1, tick: 5, eventTime: 250, receivedAt: 110, fxIndex: 1, frameIndex: 1, occurrence: 2 },
    { kind: 'castEnded', ability: item.ability, caster: 1, tick: 6, eventTime: 260, receivedAt: 112, fxIndex: 0, frameIndex: 2, occurrence: 3 },
  ];
  item.wishPresentationEvents = [
    { kind: 'presentWishStarted', ability: item.ability, sourceTime: 230, at: 109.5, frame: 8, player: 1, occurrence: 0 },
    { kind: 'presentWishLanded', ability: item.ability, sourceTime: 250, at: 111, frame: 9, player: 1, occurrence: 1 },
    { kind: 'presentWishLanded', ability: item.ability, sourceTime: 250, at: 111.5, frame: 9, player: 1, occurrence: 2 },
    { kind: 'presentWishEnded', ability: item.ability, sourceTime: 260, at: 112.5, frame: 10, player: 1, occurrence: 3 },
  ];
  assert.equal(evaluateWishProof(report).status, 'PASS');
  assert.deepEqual(item.confirmedFxEvents.map(x => x.kind), ['castStarted', 'castLanded', 'castLanded', 'castEnded']);
  assert.deepEqual(item.wishPresentationEvents.map(x => x.kind), ['presentWishStarted', 'presentWishLanded', 'presentWishLanded', 'presentWishEnded']);
});

test('Started-only does not satisfy completed ability landing', () => {
  const report = completeReport();
  const item = report.cases[0];
  item.confirmedFx.kind = 'castStarted';
  item.confirmedFx.presentationKind = 'presentWishStarted';
  item.wishPresented.kind = 'presentWishStarted';
  item.wishPresentationEvents[0].kind = 'presentWishStarted';
  assert.ok(evaluateWishProof(report).failures.includes('blaze_confirmed_fx_not_landed'));
});

test('Ended-only fizzle does not satisfy completed ability landing', () => {
  const report = completeReport();
  const item = report.cases[1];
  item.confirmedFx.kind = 'castEnded';
  item.confirmedFx.presentationKind = 'presentWishEnded';
  item.confirmedFxEvents[0].kind = 'castEnded';
  item.wishPresented.kind = 'presentWishEnded';
  item.wishPresentationEvents[0].kind = 'presentWishEnded';
  assert.ok(evaluateWishProof(report).failures.includes('trial_confirmed_fx_not_landed'));
});

test('wrong caster or anonymous FX cannot prove the driver landing', () => {
  for (const caster of [2, null]) {
    const report = completeReport();
    const item = report.cases[2];
    item.confirmedFx.caster = caster;
    item.confirmedFxEvents[0].caster = caster;
    item.wishPresented.player = caster || 0;
    item.wishPresentationEvents[0].player = caster || 0;
    assert.ok(evaluateWishProof(report).failures.includes('swarm_confirmed_fx_not_own_caster'));
    assert.ok(evaluateWishProof(report).failures.includes('swarm_presentation_not_own_landing'));
  }
});

test('same source time with a non-landed presentation kind cannot satisfy landed cue', () => {
  const report = completeReport();
  const item = report.cases[4];
  item.wishPresented.kind = 'presentWishStarted';
  item.wishPresentationEvents[0].kind = 'presentWishStarted';
  assert.ok(evaluateWishProof(report).failures.includes('laststand_presentation_not_own_landing'));
});

test('an owner record must show the authoritative charge spend', () => {
  const report = completeReport();
  report.cases.find(x => x.faction === 4).ownerUpdate.after.charges = 2;
  assert.ok(evaluateWishProof(report).failures.includes('laststand_owner_did_not_publish_spend'));
});

test('untrusted pointer, overflow, page errors, and prerequisites cannot pass', () => {
  const report = completeReport();
  report.cases[0].cursorGesture.isTrusted = false;
  report.cases[1].traceOverflow = true;
  report.cases[2].pageErrors = ['WebGL exception'];
  report.prerequisites = ['unity_web_url_unavailable'];
  const verdict = evaluateWishProof(report);
  assert.equal(verdict.status, 'FAIL');
  assert.ok(verdict.failures.includes('blaze_invalid_browser_pointer_event'));
  assert.ok(verdict.failures.includes('trial_trace_overflow'));
  assert.ok(verdict.failures.includes('swarm_page_error'));
  assert.ok(verdict.incomplete.includes('prerequisite_unity_web_url_unavailable'));
});

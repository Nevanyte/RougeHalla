'use strict';

const CASES = Object.freeze([
  Object.freeze({ faction: 0, ability: 3, name: 'Blaze', target: 'point' }),
  Object.freeze({ faction: 1, ability: 2, name: 'Trial', target: 'unit' }),
  Object.freeze({ faction: 2, ability: 1, name: 'Swarm', target: 'point' }),
  Object.freeze({ faction: 3, ability: 0, name: 'Freeze', target: 'unit' }),
  Object.freeze({ faction: 4, ability: 4, name: 'LastStand', target: 'point' }),
]);

const finite = Number.isFinite;

function evaluateWishProof(report) {
  const failures = [];
  const incomplete = [];
  const cases = Array.isArray(report?.cases) ? report.cases : [];
  const expected = CASES.length;
  const byFaction = new Map();

  for (const item of cases) {
    if (item && Number.isInteger(item.faction)) byFaction.set(item.faction, item);
  }
  for (const spec of CASES) {
    const item = byFaction.get(spec.faction);
    if (!item) {
      incomplete.push(`faction_${spec.faction}_${spec.name}_missing`);
      continue;
    }
    const prefix = `${spec.name.toLowerCase()}`;
    const required = [
      ['browserKey', 'browser_key'], ['cursorGesture', 'cursor_gesture'], ['inputSample', 'unity_sample'], ['castSent', 'cast_send'],
      ['confirmedFx', 'confirmed_fx'], ['wishPresented', 'unity_presentation'], ['ownerBaseline', 'owner_baseline'], ['ownerUpdate', 'owner_update'],
      ['confirmedFxEvents', 'confirmed_fx_occurrences'], ['wishPresentationEvents', 'unity_presentation_occurrences'],
      ['traceGate', 'trace_gate'], ['screenshot', 'visual_artifact'],
    ];
    for (const [field, stage] of required) {
      if (!item[field]) incomplete.push(`${prefix}_${stage}_missing`);
    }
    if (item.status === 'incomplete') incomplete.push(`${prefix}_${item.incompleteReason || 'incomplete'}`);
    else if (item.status === 'fail') failures.push(`${prefix}_${item.failureReason || 'case_failed'}`);
    else if (item.status !== 'pass') incomplete.push(`${prefix}_case_status_missing`);

    const key = item.browserKey;
    const cursor = item.cursorGesture;
    const sample = item.inputSample;
    const sent = item.castSent;
    const fx = item.confirmedFx;
    const shown = item.wishPresented;
    const owner = item.ownerUpdate;
    if (item.ownerBaseline && (item.ownerBaseline.ability !== spec.ability || !finite(item.ownerBaseline.readyAt) ||
        !Number.isInteger(item.ownerBaseline.charges) || item.ownerBaseline.charges < 1 || item.ownerBaseline.cast))
      failures.push(`${prefix}_invalid_ready_owner_baseline`);
    const gate = item.traceGate;
    if (gate && (gate.warmupRecording !== false || !finite(gate.driverPageStartedAt) || !finite(gate.observerPageStartedAt) ||
        !finite(gate.ownerReadyObservedAt) || !finite(gate.ownerReadyServerMs) ||
        !finite(gate.driverRecordingAt) || !finite(gate.observerRecordingAt) ||
        gate.errorsRetained !== true || gate.wireRetained !== true ||
        gate.ownerReadyServerMs < item.ownerBaseline?.readyAt ||
        gate.driverPageStartedAt > gate.ownerReadyObservedAt || gate.observerPageStartedAt > gate.observerRecordingAt ||
        gate.ownerReadyObservedAt > gate.driverRecordingAt))
      failures.push(`${prefix}_invalid_trace_gate`);
    if (key && (key.code !== 'KeyR' || !finite(key.at) || key.isTrusted !== true)) failures.push(`${prefix}_invalid_browser_r_event`);
    if (cursor && (!finite(cursor.at) || cursor.isTrusted !== true || !finite(cursor.x) || !finite(cursor.y) ||
        !finite(cursor.expectedX) || !finite(cursor.expectedY)))
      failures.push(`${prefix}_invalid_browser_pointer_event`);
    if (cursor && (Math.abs(cursor.x - cursor.expectedX) > 1.5 || Math.abs(cursor.y - cursor.expectedY) > 1.5))
      failures.push(`${prefix}_pointer_did_not_reach_selected_cursor`);
    if (cursor && key && finite(cursor.at) && finite(key.at) && key.at < cursor.at)
      failures.push(`${prefix}_r_precedes_cursor_gesture`);
    if (gate && cursor && finite(gate.driverRecordingAt) && finite(cursor.at) && gate.driverRecordingAt > cursor.at)
      failures.push(`${prefix}_trace_enabled_after_trial_input`);
    if (item.training !== false) failures.push(`${prefix}_training_mode_not_false`);
    if (sample) {
      if (!finite(sample.at) || !Number.isInteger(sample.frame) || sample.frame < 1 ||
          !Number.isInteger(sample.player) || sample.player < 1 ||
          !Number.isInteger(sample.seq) || sample.seq < 1 || sample.seq > 255 ||
          !finite(sample.x) || !finite(sample.y)) failures.push(`${prefix}_invalid_unity_sample`);
      if (key && finite(key.at) && finite(sample.at) && sample.at < key.at) failures.push(`${prefix}_sample_precedes_browser_key`);
      if (cursor && finite(cursor.at) && finite(sample.at) && sample.at < cursor.at) failures.push(`${prefix}_sample_precedes_cursor_gesture`);
      if (item.players?.driver != null && sample.player !== item.players.driver) failures.push(`${prefix}_sample_driver_mismatch`);
    }
    if (sent) {
      if (!finite(sent.at) || !Number.isInteger(sent.frame) || sent.frame < 1 || sent.slot !== 0 ||
          !Number.isInteger(sent.seq) || sent.seq < 1 || sent.seq > 255 ||
          !finite(sent.x) || !finite(sent.y) || !Number.isInteger(sent.inputFrameSeq) || sent.inputFrameSeq < 0 || sent.inputFrameSeq > 0xffffffff)
        failures.push(`${prefix}_invalid_cast_send`);
      if (!Array.isArray(item.inputAcks) || item.inputAcks.length === 0 ||
          item.inputAcks.some(ack => !Number.isInteger(ack.ack) || ack.ack < 0 || !finite(ack.at)))
        failures.push(`${prefix}_input_frame_ack_evidence_missing_or_invalid`);
      if (sample && (sent.seq !== sample.seq || sent.frame !== sample.frame)) failures.push(`${prefix}_sample_send_mismatch`);
      if (sent.sameUnityFrame !== true) failures.push(`${prefix}_send_not_same_unity_frame`);
      if (sample && finite(sent.x) && finite(sent.y) && (Math.abs(sent.x - sample.x) > .002 || Math.abs(sent.y - sample.y) > .002))
        failures.push(`${prefix}_sample_send_point_mismatch`);
      if (sample && finite(sent.at) && finite(sample.at) && sent.at < sample.at) failures.push(`${prefix}_send_precedes_sample`);
      if (spec.target === 'unit') {
        if (!Number.isInteger(item.deliveredTarget) || item.deliveredTarget < 1 || sent.actorRef !== item.deliveredTarget)
          failures.push(`${prefix}_cast_target_not_currently_delivered_actor`);
      } else if (sent.actorRef !== null) failures.push(`${prefix}_point_cast_unexpected_actor_target`);
    }
    if (fx) {
      if (!['castStarted', 'castLanded', 'castEnded'].includes(fx.kind) || fx.ability !== spec.ability ||
          !finite(fx.eventTime) || fx.eventTime < 0 || !finite(fx.receivedAt))
        failures.push(`${prefix}_invalid_or_wrong_confirmed_fx`);
      if (fx.kind !== 'castLanded') failures.push(`${prefix}_confirmed_fx_not_landed`);
      if (!Number.isInteger(item.players?.driver) || fx.caster !== item.players.driver)
        failures.push(`${prefix}_confirmed_fx_not_own_caster`);
      if (fx.presentationKind !== 'presentWishLanded') failures.push(`${prefix}_confirmed_fx_landing_kind_mismatch`);
      if (sent && finite(fx.receivedAt) && finite(sent.at) && fx.receivedAt <= sent.at)
        failures.push(`${prefix}_confirmed_fx_precedes_cast_send`);
      const occurrences = item.confirmedFxEvents;
      if (!Array.isArray(occurrences) || occurrences.length === 0 ||
          occurrences.some((event, index) => !event || event.occurrence !== index || !Number.isInteger(event.tick) || event.tick < 0 ||
            !finite(event.eventTime) || !finite(event.receivedAt) || !Number.isInteger(event.fxIndex) || !Number.isInteger(event.frameIndex)) ||
          occurrences.some((event, index) => index > 0 && (event.frameIndex < occurrences[index - 1].frameIndex ||
            event.receivedAt < occurrences[index - 1].receivedAt ||
            (event.frameIndex === occurrences[index - 1].frameIndex && event.fxIndex < occurrences[index - 1].fxIndex))) ||
          !occurrences.some(event => event.kind === fx.kind && event.ability === fx.ability &&
            event.caster === item.players?.driver && event.eventTime === fx.eventTime && event.receivedAt === fx.receivedAt && event.fxIndex === fx.fxIndex))
        failures.push(`${prefix}_confirmed_fx_occurrences_not_preserved`);
    }
    if (shown) {
      if (!['presentWishStarted', 'presentWishLanded', 'presentWishEnded'].includes(shown.kind))
        failures.push(`${prefix}_invalid_presentation_kind`);
      if (shown.ability !== spec.ability || !finite(shown.sourceTime) || shown.sourceTime < 0 || !finite(shown.at))
        failures.push(`${prefix}_invalid_or_wrong_presentation_event`);
      if (shown.kind !== 'presentWishLanded' || shown.player !== item.players?.driver)
        failures.push(`${prefix}_presentation_not_own_landing`);
      if (fx && (shown.kind !== fx.presentationKind || shown.sourceTime !== fx.eventTime))
        failures.push(`${prefix}_presentation_source_event_mismatch`);
      if (fx && finite(shown.at) && finite(fx.receivedAt) && shown.at <= fx.receivedAt)
        failures.push(`${prefix}_presentation_precedes_fx_receive`);
      const occurrences = item.wishPresentationEvents;
      if (!Array.isArray(occurrences) || occurrences.length === 0 ||
          occurrences.some((event, index) => !event || event.occurrence !== index || !finite(event.sourceTime) || !finite(event.at) ||
            (index > 0 && event.at < occurrences[index - 1].at)) ||
          !occurrences.some(event => event.kind === shown.kind && event.ability === shown.ability &&
            event.sourceTime === shown.sourceTime && event.at === shown.at))
        failures.push(`${prefix}_presentation_occurrences_not_preserved`);
    }
    if (owner) {
      if (owner.ability !== spec.ability || !finite(owner.receivedAt) || !owner.before || !owner.after ||
          owner.before.ability !== spec.ability || owner.after.ability !== spec.ability ||
          !Number.isInteger(owner.before.charges) || !Number.isInteger(owner.after.charges) ||
          owner.after.charges >= owner.before.charges)
        failures.push(`${prefix}_owner_did_not_publish_spend`);
      if (sent && finite(owner.receivedAt) && owner.receivedAt < sent.at)
        failures.push(`${prefix}_owner_update_precedes_cast_send`);
    }
    if (item.traceOverflow) failures.push(`${prefix}_trace_overflow`);
    if (item.traceErrors?.length) failures.push(`${prefix}_trace_decode_error`);
    if (item.pageErrors?.length) failures.push(`${prefix}_page_error`);
  }

  if (byFaction.size !== cases.length) failures.push('duplicate_or_invalid_faction_cases');
  if (report?.errors?.length) failures.push('run_errors');
  if (report?.pageErrors?.length) failures.push('page_errors');
  if (report?.prerequisites?.length) incomplete.push(...report.prerequisites.map(x => `prerequisite_${x}`));
  if (report?.expectedCases !== expected) incomplete.push('expected_case_count');
  if (report?.cases?.length !== expected) incomplete.push(`case_coverage_${report?.cases?.length || 0}_of_${expected}`);

  const status = failures.length ? 'FAIL' : incomplete.length ? 'INCOMPLETE' : 'PASS';
  return { status, exitCode: status === 'PASS' ? 0 : status === 'FAIL' ? 1 : 2, failures, incomplete, complete: status === 'PASS' };
}

function attachWishSummary(report) {
  const verdict = evaluateWishProof(report);
  report.summary = { status: verdict.status, verdict, cases: (report.cases || []).length,
    abilities: CASES.map(({ faction, ability, name }) => ({ faction, ability, name,
      inputToSampleMs: deltaFor(report, faction, 'browserKey', 'inputSample'),
      sampleToSendMs: deltaFor(report, faction, 'inputSample', 'castSent'),
      sendToConfirmedFxMs: deltaFor(report, faction, 'castSent', 'confirmedFx'),
      confirmedFxToPresentationMs: deltaFor(report, faction, 'confirmedFx', 'wishPresented'),
    })) };
  return report;
}

function deltaFor(report, faction, before, after) {
  const item = (report.cases || []).find(candidate => candidate.faction === faction);
  const a = item?.[before]?.at ?? item?.[before]?.receivedAt;
  const b = item?.[after]?.at ?? item?.[after]?.receivedAt;
  return finite(a) && finite(b) ? b - a : null;
}

module.exports = { CASES, evaluateWishProof, attachWishSummary };

'use strict';

function quantiles(values) {
  if (!values.length) return { count: 0, p50Ms: null, p95Ms: null, maxMs: null };
  const sorted = [...values].sort((a, b) => a - b);
  const at = p => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  return { count: sorted.length, p50Ms: at(.50), p95Ms: at(.95), maxMs: sorted.at(-1) };
}

function evaluate(report) {
  const failures = [];
  const incomplete = [];
  const trials = report.trials || [];
  for (const [index, trial] of trials.entries()) {
    for (const key of ['keyboardEvent', 'inputSample', 'moveSent', 'selfEcho', 'selfPresented', 'opponentBaseline', 'opponentPresented']) {
      if (!trial[key]) incomplete.push(`trial_${index + 1}_${key}`);
    }
    if (trial.inputSample && trial.moveSent && trial.inputSample.seq !== trial.moveSent.seq)
      failures.push(`trial_${index + 1}_sample_send_seq_mismatch`);
    if (report.players && trial.inputSample && trial.inputSample.player !== report.players.driver)
      failures.push(`trial_${index + 1}_sample_driver_mismatch`);
    if (trial.moveSent && trial.selfEcho && trial.moveSent.seq !== trial.selfEcho.seq)
      failures.push(`trial_${index + 1}_send_echo_seq_mismatch`);
    if (trial.selfEcho && trial.selfPresented && trial.selfEcho.seq !== trial.selfPresented.seq)
      failures.push(`trial_${index + 1}_echo_present_seq_mismatch`);
    if (trial.moveSent && trial.inputSample && trial.moveSent.frame !== trial.inputSample.frame)
      failures.push(`trial_${index + 1}_sample_send_frame_mismatch`);
    if (trial.moveSent && trial.moveSent.sameUnityFrame !== true) failures.push(`trial_${index + 1}_send_not_same_unity_frame`);
    if (trial.opponentBaseline && trial.opponentPresented && trial.opponentBaseline.actor !== trial.opponentPresented.actor)
      failures.push(`trial_${index + 1}_opponent_actor_mismatch`);
    if (trial.opponentBaseline && (!(trial.opponentBaseline.stableMs >= 350) ||
        trial.opponentBaseline.at > trial.inputSample?.at)) failures.push(`trial_${index + 1}_unsettled_opponent_baseline`);
    if (trial.opponentPresented && trial.moveSent && trial.opponentPresented.at < trial.moveSent.at)
      failures.push(`trial_${index + 1}_opponent_moved_before_input`);
    if (trial.inputSample && (!Number.isInteger(trial.inputSample.seq) || trial.inputSample.seq < 1 || trial.inputSample.seq > 255))
      failures.push(`trial_${index + 1}_invalid_sample_seq`);
    if (trial.moveSent && (!Number.isInteger(trial.moveSent.frame) || trial.moveSent.frame < 1))
      failures.push(`trial_${index + 1}_invalid_send_frame`);
    if (trial.moveSent && (!Number.isInteger(trial.moveSent.seq) || trial.moveSent.seq < 1 || trial.moveSent.seq > 255))
      failures.push(`trial_${index + 1}_invalid_send_seq`);
    if (trial.selfEcho && (!Number.isInteger(trial.selfEcho.seq) || trial.selfEcho.seq < 1 || trial.selfEcho.seq > 255))
      failures.push(`trial_${index + 1}_invalid_echo_seq`);
    for (const key of ['keyboardToSendMs', 'sampleToSendMs', 'sendToEchoMs', 'echoToPresentMs', 'sampleToPresentMs', 'sampleToOpponentMs']) {
      if (!Number.isFinite(trial[key])) incomplete.push(`trial_${index + 1}_${key}`);
      else if (trial[key] < 0) failures.push(`trial_${index + 1}_negative_${key}`);
    }
    if (trial.traceOverflow || trial.observerOverflow) failures.push(`trial_${index + 1}_trace_overflow`);
    if (trial.traceErrors?.length) failures.push(`trial_${index + 1}_trace_error`);
  }
  if (report.errors?.length || report.pageErrors?.length) failures.push('runtime_or_page_errors');
  const expected = report.expectedTrials;
  if (!Number.isInteger(expected) || expected < 1) incomplete.push('expected_trial_count');
  if (trials.length !== expected) incomplete.push(`trial_coverage_${trials.length}_of_${expected}`);
  if (report.proxyRun?.config?.stallEvery > 0) {
    const stalls = (report.proxyRun.connections || []).reduce((n, connection) => n +
      Object.values(connection.directions || {}).reduce((m, direction) => m + (direction.orderedStalls || 0), 0), 0);
    if (!stalls) incomplete.push('requested_ordered_stall_not_exercised');
  }
  const complete = expected > 0 && trials.length === expected && incomplete.length === 0;
  const status = failures.length ? 'FAIL' : complete ? 'PASS' : 'INCOMPLETE';
  const exitCode = status === 'PASS' ? 0 : status === 'FAIL' ? 1 : 2;
  return { status, exitCode, failures, incomplete, complete };
}

function attachSummary(report) {
  const verdict = evaluate(report);
  report.summary = {
    status: verdict.status,
    verdict,
    latency: {
      sampleToSend: quantiles((report.trials || []).map(t => t.sampleToSendMs).filter(Number.isFinite)),
      sendToSelfEcho: quantiles((report.trials || []).map(t => t.sendToEchoMs).filter(Number.isFinite)),
      selfEchoToPresentation: quantiles((report.trials || []).map(t => t.echoToPresentMs).filter(Number.isFinite)),
      inputToSelfPresentation: quantiles((report.trials || []).map(t => t.sampleToPresentMs).filter(Number.isFinite)),
      inputToOpponentPresentation: quantiles((report.trials || []).map(t => t.sampleToOpponentMs).filter(Number.isFinite)),
    }
  };
  return report;
}

module.exports = { quantiles, evaluate, attachSummary };

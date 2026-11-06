// The first-playable release proof must exercise every outcome, even when ordinary RNG gives no opportunity.
// Missing coverage is INCOMPLETE; an observed failure or runtime/decoder error is FAIL.
const REQUIRED_CHECKS = Object.freeze({
  menuNoSocketBeforeJoin: Object.freeze(['pass']),
  menuJoin: Object.freeze(['pass']),
  mapAndCollections: Object.freeze(['pass']),
  focusedPickupInput: Object.freeze(['pass']),
  pickupOutcome: Object.freeze(['pass', 'changed']),
  rewardChoice: Object.freeze(['pass']),
  potionInputAndNotice: Object.freeze(['pass']),
  hudBlocksWorldClick: Object.freeze(['pass']),
  worldAttackClick: Object.freeze(['pass']),
  swapInput: Object.freeze(['pass']),
  movement: Object.freeze(['pass']),
  reconnect: Object.freeze(['pass']),
  results: Object.freeze(['pass']),
  leaveAndRejoin: Object.freeze(['pass']),
  visibleMobs: Object.freeze(['pass']),
});

function evaluateProof(report) {
  const checks = report?.checks || {};
  const requiredChecks = Object.keys(REQUIRED_CHECKS);
  const failedChecks = Object.keys(checks).filter(name => checks[name]?.status === 'fail');
  const incompleteChecks = requiredChecks.filter(name =>
    checks[name]?.status !== 'fail' && !REQUIRED_CHECKS[name].includes(checks[name]?.status));
  const failureChannels = ['failures', 'pageErrors', 'observerErrors'].filter(name =>
    Array.isArray(report?.[name]) ? report[name].length > 0 : Boolean(report?.[name]));
  if (report?.failure) failureChannels.push('failure');
  const status = failedChecks.length || failureChannels.length ? 'FAIL'
    : incompleteChecks.length ? 'INCOMPLETE' : 'PASS';
  return {
    status,
    ok: status === 'PASS',
    exitCode: status === 'PASS' ? 0 : status === 'FAIL' ? 1 : 2,
    requiredChecks,
    failedChecks,
    incompleteChecks,
    failureChannels,
  };
}

module.exports = { REQUIRED_CHECKS, evaluateProof };

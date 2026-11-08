const { evaluateProof } = require('./proof-contract.cjs');
const SHOWCASE_CHECKS = Object.freeze(['settingsQualityClickable', 'settingsReducedMotionClickable', 'settingsMusicMuteClickable', 'separatePreviewScreenshot']);
function evaluateShowcaseProof(report) {
  const base = evaluateProof(report), checks = report?.checks || {};
  const failedChecks = [...new Set([...base.failedChecks, ...SHOWCASE_CHECKS.filter(name => checks[name]?.status === 'fail')])];
  const incompleteChecks = [...new Set([...base.incompleteChecks, ...SHOWCASE_CHECKS.filter(name => !['pass','fail'].includes(checks[name]?.status))])];
  const status = failedChecks.length || base.failureChannels.length ? 'FAIL' : incompleteChecks.length ? 'INCOMPLETE' : 'PASS';
  return { ...base, status, ok: status === 'PASS', exitCode: status === 'PASS' ? 0 : status === 'FAIL' ? 1 : 2,
    requiredChecks: [...base.requiredChecks, ...SHOWCASE_CHECKS], failedChecks, incompleteChecks };
}
module.exports = { SHOWCASE_CHECKS, evaluateShowcaseProof };

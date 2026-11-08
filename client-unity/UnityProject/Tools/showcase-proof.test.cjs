const assert = require('node:assert/strict');
const { test } = require('node:test');
const { REQUIRED_CHECKS } = require('./proof-contract.cjs');
const { SHOWCASE_CHECKS, evaluateShowcaseProof } = require('./showcase-contract.cjs');
const complete = () => ({ checks: Object.fromEntries([...Object.keys(REQUIRED_CHECKS), ...SHOWCASE_CHECKS].map(name => [name, {status: name === 'pickupOutcome' ? 'changed' : 'pass'}])) });
test('only all demonstrated gameplay and showcase outcomes produce PASS', () => {
  const verdict = evaluateShowcaseProof(complete());
  assert.equal(verdict.status,'PASS'); assert.equal(verdict.exitCode,0); assert.equal(verdict.requiredChecks.length,19);
});
test('every absent required outcome keeps the result INCOMPLETE', () => {
  for (const name of [...Object.keys(REQUIRED_CHECKS),...SHOWCASE_CHECKS]) {
    const report=complete(); delete report.checks[name]; const verdict=evaluateShowcaseProof(report);
    assert.equal(verdict.status,'INCOMPLETE',name); assert.equal(verdict.exitCode,2); assert.ok(verdict.incompleteChecks.includes(name));
  }
});
test('refused, unexercised and unknown showcase evidence cannot pass', () => {
  for(const status of ['server-refused','unexercised','passish',undefined]) {
    const report=complete(); report.checks.settingsQualityClickable.status=status;
    assert.equal(evaluateShowcaseProof(report).status,'INCOMPLETE');
  }
});
test('an observed showcase failure wins over missing coverage', () => {
  const report=complete(); delete report.checks.results; report.checks.settingsReducedMotionClickable.status='fail';
  const verdict=evaluateShowcaseProof(report); assert.equal(verdict.status,'FAIL'); assert.equal(verdict.exitCode,1);
});
test('decoder and browser errors refuse an otherwise complete report', () => {
  for(const channel of ['pageErrors','observerErrors','failures']) {
    const report=complete(); report[channel]=['observed error']; assert.equal(evaluateShowcaseProof(report).status,'FAIL');
  }
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { REQUIRED_CHECKS, evaluateProof } = require('./proof-contract.cjs');

const root = path.resolve(__dirname, '../../..');
const fixture = JSON.parse(fs.readFileSync(path.join(root,
  'docs/evidence/first-playable-calgary/browser-proof.json'), 'utf8'));
const copy = () => structuredClone(fixture);

test('the actual complete Calgary proof passes without changing its evidence', () => {
  const before = JSON.stringify(fixture);
  const verdict = evaluateProof(fixture);
  assert.equal(verdict.status, 'PASS');
  assert.equal(verdict.ok, true);
  assert.equal(verdict.exitCode, 0);
  assert.equal(verdict.requiredChecks.length, 15);
  assert.deepEqual(verdict.incompleteChecks, []);
  assert.equal(JSON.stringify(fixture), before);
});

test('the earlier compact local proof remains complete', () => {
  const local = JSON.parse(fs.readFileSync(path.join(root,
    'docs/evidence/first-playable-unity/browser-proof.json'), 'utf8'));
  assert.equal(evaluateProof(local).status, 'PASS');
});

for (const name of Object.keys(REQUIRED_CHECKS)) {
  test(`missing ${name} is incomplete despite the old saved ok=true flag`, () => {
    const report = copy();
    delete report.checks[name];
    assert.equal(report.ok, true);
    const verdict = evaluateProof(report);
    assert.equal(verdict.status, 'INCOMPLETE');
    assert.equal(verdict.ok, false);
    assert.equal(verdict.exitCode, 2);
    assert.deepEqual(verdict.incompleteChecks, [name]);
  });
  test(`unexercised ${name} is incomplete`, () => {
    const report = copy(); report.checks[name].status = 'unexercised';
    const verdict = evaluateProof(report);
    assert.equal(verdict.status, 'INCOMPLETE');
    assert.equal(verdict.exitCode, 2);
    assert.deepEqual(verdict.incompleteChecks, [name]);
  });
  test(`failed ${name} is a failure`, () => {
    const report = copy(); report.checks[name].status = 'fail';
    const verdict = evaluateProof(report);
    assert.equal(verdict.status, 'FAIL');
    assert.equal(verdict.exitCode, 1);
    assert.deepEqual(verdict.failedChecks, [name]);
  });
}

for (const channel of ['failures', 'pageErrors', 'observerErrors']) {
  test(`${channel} makes the proof fail even when all checks passed`, () => {
    const report = copy(); report[channel] = ['observed error'];
    const verdict = evaluateProof(report);
    assert.equal(verdict.status, 'FAIL');
    assert.equal(verdict.exitCode, 1);
    assert.deepEqual(verdict.failureChannels, [channel]);
  });
}

test('an observed failure takes precedence over missing coverage', () => {
  const report = copy(); delete report.checks.results; report.pageErrors = ['runtime error'];
  const verdict = evaluateProof(report);
  assert.equal(verdict.status, 'FAIL');
  assert.deepEqual(verdict.incompleteChecks, ['results']);
});

test('a server-refused pickup does not prove successful acquisition', () => {
  const report = copy(); report.checks.pickupOutcome.status = 'server-refused';
  assert.equal(evaluateProof(report).status, 'INCOMPLETE');
});

test('an explicit pickup pass is accepted as well as the captured changed outcome', () => {
  const report = copy(); report.checks.pickupOutcome.status = 'pass';
  assert.equal(evaluateProof(report).status, 'PASS');
});

test('unknown or malformed required status cannot silently pass', () => {
  const report = copy(); report.checks.results = { status: 'assumed' };
  assert.equal(evaluateProof(report).status, 'INCOMPLETE');
  report.checks.results = 'pass';
  assert.equal(evaluateProof(report).status, 'INCOMPLETE');
});

test('an additional observed failed check is not ignored', () => {
  const report = copy(); report.checks.extraDiagnostic = { status: 'fail' };
  assert.equal(evaluateProof(report).status, 'FAIL');
});

test('an unrequired diagnostic does not substitute for or block the required outcomes', () => {
  const report = copy(); report.checks.extraDiagnostic = { status: 'unexercised' };
  assert.equal(evaluateProof(report).status, 'PASS');
  delete report.checks.results;
  assert.equal(evaluateProof(report).status, 'INCOMPLETE');
});

test('an exceptional collector failure is a failure', () => {
  const report = copy(); report.failure = 'collector exception';
  assert.equal(evaluateProof(report).status, 'FAIL');
});

test('an empty report is incomplete', () => {
  const verdict = evaluateProof({});
  assert.equal(verdict.status, 'INCOMPLETE');
  assert.equal(verdict.incompleteChecks.length, 15);
});

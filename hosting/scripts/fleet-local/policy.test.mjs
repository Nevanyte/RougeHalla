// node --test hosting/scripts/fleet-local/policy.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, DEFAULTS } from './policy.mjs';

const cfg = { ...DEFAULTS, maxGroups: 4, warmMin: 1, warmMax: 2, idleScaleInMs: 1000 };
const g = (id, state, idleForMs = 0, metrics) => ({ id, state, idleForMs, metrics });

test('an empty fleet launches the warm group', () => {
  const d = decide({ groups: [], starting: 0, queued: 0 }, cfg);
  assert.equal(d.scaleOut, 1);
});
test('queued sessions launch exactly what is missing', () => {
  const d = decide({ groups: [g('a', 'idle')], starting: 0, queued: 3 }, cfg);
  assert.equal(d.scaleOut, 2, '3 queued need 3 idle groups, one exists');
});
test('the maximum is a hard cap, whatever the demand', () => {
  const d = decide({ groups: [g('a', 'active'), g('b', 'active'), g('c', 'active')], starting: 0, queued: 10 }, cfg);
  assert.equal(d.scaleOut, 1, 'max 4 groups: 3 active + 1');
  const full = decide({ groups: [1, 2, 3, 4].map((i) => g('x' + i, 'active')), starting: 0, queued: 5 }, cfg);
  assert.equal(full.scaleOut, 0);
});
test('scale-in only ever names idle groups, beyond the warm floor, after the idle time', () => {
  const state = {
    groups: [g('act', 'active'), g('i1', 'idle', 5000), g('i2', 'idle', 4000), g('i3', 'idle', 10)],
    starting: 0,
    queued: 0,
  };
  const d = decide(state, { ...cfg, warmMin: 1, warmMax: 1, targetAvailablePct: 10 });
  assert.deepEqual([...d.scaleIn].sort(), ['i1', 'i2']);
  assert.ok(!d.scaleIn.includes('act'), 'an active group is never selected');
  assert.ok(!d.scaleIn.includes('i3'), 'a freshly idle group is not released yet');
});
test('the warm floor is kept', () => {
  const d = decide({ groups: [g('i1', 'idle', 99999)], starting: 0, queued: 0 }, cfg);
  assert.deepEqual(d.scaleIn, []);
});
test('scale to zero when the floor is zero', () => {
  const d = decide({ groups: [g('i1', 'idle', 99999)], starting: 0, queued: 0 }, { ...cfg, warmMin: 0, minGroups: 0 });
  assert.deepEqual(d.scaleIn, ['i1']);
});
test('target tracking buffer grows with active groups but is bounded by warmMax', () => {
  const act = [1, 2, 3].map((i) => g('a' + i, 'active'));
  const d = decide({ groups: act, starting: 0, queued: 0 }, { ...cfg, maxGroups: 50, targetAvailablePct: 50, warmMax: 2 });
  assert.equal(d.scaleOut, 2, 'wants ceil(3*0.5/0.5)=3 idle but warmMax bounds it to 2');
});
test('a guardrail breach vetoes scale-in, adds warm capacity and avoids the group', () => {
  const state = {
    groups: [g('slow', 'active', 0, { latenessP99Us: 90000 }), g('i1', 'idle', 99999), g('i2', 'idle', 99999)],
    starting: 0,
    queued: 0,
  };
  const d = decide(state, { ...cfg, warmMin: 0, warmMax: 0 });
  assert.deepEqual(d.scaleIn, [], 'no scale-in while a guardrail is breached');
  assert.deepEqual(d.avoid, ['slow']);
  assert.ok(d.reasons[0].includes('lateness'));
  assert.equal(d.idleWanted, 1, 'one extra warm group');
});
test('dropped steps and a slow join also breach', () => {
  const a = decide({ groups: [g('x', 'idle', 9e9, { droppedStepsDelta: 3 })], starting: 0, queued: 0 }, cfg);
  assert.ok(a.veto);
  const b = decide({ groups: [], starting: 0, queued: 0, joinP95Ms: 9000 }, cfg);
  assert.ok(b.veto && b.scaleOut === 2, 'warm 1 + 1 extra for the slow join');
});

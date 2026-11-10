// Assertions about reached source behavior. Expected method outputs are always produced by source, never supplied here.
import assert from 'node:assert/strict';
import {decode} from './verify.mjs';
export function reachedChecks(cases: any[]): any[] {
  const checked: any[] = [];
  const c = (id: string) => {const row = cases.find((c) => c.id === id); assert(row, id); return row;};
  const ops = (id: string, method = 'decide') => c(id).operations.filter((op: any) => op.method === method);
  const value = (op: any, key: string) => decode(op[key], true);
  const check = (name: string, fn: () => void) => { fn(); checked.push({name, result: 'PASS'}); };
  check('module dedup equal loses and higher replacement retains slot', () => {
    const rows = ops('strategy-dedup-equal-and-higher-retains-slot');
    const a = value(rows[0], 'state').candidates.filter((d: any) => d.goal.kind === 'module');
    const b = value(rows[1], 'state').candidates.filter((d: any) => d.goal.kind === 'module');
    assert.equal(a[0].why, 'first'); assert.equal(b[0].why, 'higher'); assert.equal(b[0].goal.data.n, 1);
    assert.equal(b[1].goal.data.n, 2);
  });
  check('hysteresis below margin keeps and exact margin replaces; kept choice omitted', () => {
    const rows = ops('strategy-modules-dedup-tie-hysteresis-status');
    assert.equal(value(rows[1], 'result').goal.data.n, 1); assert.equal(value(rows[2], 'result').goal.data.n, 2);
    assert(!Object.hasOwn(value(rows[1], 'result'), 'choice')); assert.equal(rows[1].identity.returnedCurrentGoal, true);
  });
  check('fight tunnel before expiry suppresses pick draws; expiry and hurt break it', () => {
    const rows = ops('strategy-tunnel-fight-flee-and-not-alive');
    assert.equal(value(rows[0], 'result').goal.kind, 'fight'); assert.equal(value(rows[1], 'result').goal.kind, 'fight');
    assert.equal(value(rows[1], 'callbacks').filter((e: any) => e.kind === 'rng').length, 0);
    assert(value(rows[2], 'callbacks').some((e: any) => e.kind === 'rng' && e.stream === 'lapse'));
    assert(value(rows[3], 'state').candidates.some((d: any) => d.goal.kind === 'flee'));
    assert.notEqual(value(rows[3], 'result').goal.kind, 'fight');
    for (const op of rows.slice(4, 6)) { assert.equal(value(op, 'result').goal.kind, 'idle'); assert.equal(value(op, 'callbacks').length, 0);
      assert.deepEqual(value(op, 'state').chase, value(rows[3], 'state').chase); }
  });
  check('pursuit40 does not reset; strict timeout sets avoidance; real hit and close release', () => {
    const rows = ops('strategy-pursuit-progress-timeout-hit-release');
    assert.equal(value(rows[1], 'state').chase.since, value(rows[0], 'state').chase.since);
    assert.equal(value(rows[2], 'state').avoidId, null); assert.equal(value(rows[3], 'state').avoidId, '追跡😀');
    assert.equal(value(rows[4], 'state').avoidId, null); assert.equal(value(rows[8], 'state').avoidId, null);
    assert(value(rows[10], 'state').chase.since > value(rows[9], 'state').chase.since);
  });
  check('Flee done renews; cornered and failed ban; healthy wary evades', () => {
    const rows = ops('strategy-flee-renew-cornered-ban-evade');
    assert.equal(value(rows[0], 'result').goal.kind, 'flee'); assert.equal(value(rows[1], 'result').goal.kind, 'flee');
    assert.notEqual(value(rows[2], 'result').goal.kind, 'flee'); assert.notEqual(value(rows[4], 'result').goal.kind, 'flee');
    assert.equal(value(rows[5], 'result').utility, .9); assert.equal(value(rows[6], 'result').utility, .9);
  });
  check('real farm has opener, recorded choice removes it; nonfarm actually releases engaged hunter', () => {
    const rows = ops('strategy-learned-opener-choice-and-hunt-release');
    assert.equal(value(rows[0], 'result').goal.kind, 'farm'); assert.equal(value(rows[0], 'huntTarget'), 'meal');
    assert.equal(value(rows[0], 'result').choice, 'opener|fire|sentenced'); assert(!Object.hasOwn(value(rows[1], 'result'), 'choice'));
    assert.equal(value(rows[2], 'result').goal.kind, 'module'); assert.equal(value(rows[2], 'huntTarget'), null);
    assert.equal(value(rows[2], 'own').adapter.hunter.playerLock, true, 'release ran real synthetic-near-player hunter decision');
  });
  check('adapter uses seeded home; all tiers use the real hunter and release', () => {
    for (const tier of ['easy', 'normal', 'hard']) {
      const caseRow = c('adapter-walks-and-source-home-' + tier); const rows = ops(caseRow.id, 'adapterDecide');
      assert.equal(value(rows[0], 'result').kind, 'mob');
      const rec = value(rows[0], 'own').hunter.tracker.rec.get('m');
      assert(rec.home.x < rec.mob.x); assert.equal(value(rows[2], 'result').kind, 'mob');
      const release = caseRow.operations.find((o: any) => o.method === 'release'); assert.equal(value(release, 'own').hunter.playerLock, true);
    }
  });
  check('adapter catchup cap changes actual stall time and reaches a drop', () => {
    const short = ops('adapter-catchup-240', 'adapterDecide'), long = ops('adapter-catchup-5000', 'adapterDecide');
    assert.equal(value(short[1], 'stats').drops, 0); assert.equal(value(long[1], 'stats').drops, 1);
    assert.equal(value(long[1], 'target'), null); assert(value(long[1], 'stats').focusMs >= 3000);
  });
  check('route actual remote contest replans and exact expiry releases', () => {
    const row = c('route-contest-remote-loss-and-expiry'), updates = ops(row.id, 'routeUpdate');
    assert.equal(value(updates[0], 'result').camp, 0); assert.equal(value(updates[1], 'result').camp, 1);
    const queries = ops(row.id, 'isContested'); assert.equal(value(queries[0], 'result'), true); assert.equal(value(queries[1], 'result'), false);
  });
  check('route second zone contest avoids zone until expiry and exact camp tie favors lower index', () => {
    const row = c('route-zone-hit-memory-and-avoid');
    const planIndices = (op: any) => value(op, 'own').route.map((s: any) => s.camp);
    assert.deepEqual(planIndices(row.operations[1]), [2]); assert.deepEqual(planIndices(row.operations[2]), [2]);
    assert.equal(planIndices(row.operations[3])[0], 0);
    for (const reverse of [false, true]) assert.equal(planIndices(c('route-exact-tie-' + reverse).operations[0])[0], 0);
  });
  check('route player exactly320 contests the planned camp', () => {
    const rows = ops('route-contest-player320-boundary', 'routeUpdate');
    assert.equal(value(rows[1], 'own').stats.contests, 1); assert.equal(value(rows[1], 'result').camp, 1);
  });
  check('real reciprocal exchange yields third-party cue, exact age6000 removes it, and death removes renewed cue', () => {
    const rows = ops('strategy-appraisal-third-party-aged-memory');
    const cues = (op: any) => value(op, 'state').candidates.some((d: any) => d.why.includes('third party'));
    assert.equal(value(rows[0], 'memory').fighters.get('rival').engagedWith, 'third');
    assert(cues(rows[0])); assert(!cues(rows[3])); assert(cues(rows[4])); assert(!cues(rows[5]));
  });
  check('constant-seq walked8 fails at400; walked8.001 reflects and does not fail', () => {
    const observations = ops('memory-orders-reflection-arrival-and-failure', 'observe');
    const byTime = (at: number) => observations.find((op: any) => value(op, 'input').now === at);
    assert(value(byTime(301000), 'result').some((s: any) => s.kind === 'orderFailed'));
    assert(!value(byTime(301450), 'result').some((s: any) => s.kind === 'orderFailed'));
  });
  check('active intentional Stop drop emits no loss; later unintentional drop emits lockLost', () => {
    const rows = ops('memory-active-lock-purpose-drop-and-contrast', 'observe');
    assert(!value(rows[1], 'result').some((s: any) => s.kind === 'lockLost' || s.kind === 'targetDown'));
    assert(value(rows[3], 'result').some((s: any) => s.kind === 'lockLost'));
  });
  check('last standing avoided target remains huntable; exact avoidance expiry clears retained id', () => {
    const rows = ops('strategy-avoid-last-standing-and-exact-expiry');
    assert.equal(value(rows[1], 'state').avoidId, '追跡😀');
    assert.equal(value(rows[2], 'result').goal.target, '追跡😀'); assert.equal(value(rows[2], 'state').avoidId, '追跡😀');
    assert.equal(value(rows[3], 'state').avoidId, null);
  });
  check('enabled module consumes current now and HP rather than a constant answer', () => {
    const rows = ops('strategy-module-consumes-current-context');
    assert(!value(rows[0], 'state').candidates.some((d: any) => d.goal.kind === 'module'));
    assert(!value(rows[1], 'state').candidates.some((d: any) => d.goal.kind === 'module'));
    assert.equal(value(rows[2], 'result').goal.data.n, 'conditional');
    const call = value(rows[2], 'callbacks').find((c: any) => c.name === 'module.declared.goals');
    assert.equal(call.args[0].now, 300002); assert.equal(call.args[0].self.hp, 79);
  });
  return checked;
}

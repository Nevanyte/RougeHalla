/** Pack Leader source-first seal: bounded actual-source capture; no expected state is an input. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');
Math.random = () => { throw Error('undeclared randomness'); };
const E = await import('../card-runtime-fixtures/engine.mts');
await E.prepareInspection();
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const I = (actor: string, type: string, payload: any) => ({ actor, type, payload });
const A = (id = 'p0', a = 0) => I(id, 'attack', { a });
const R = (id = 'p0', a = 0) => I(id, 'release', { a });
const T = (...inputs: any[]) => ({ kind: 'step', inputs });
const N = (count: number, snapshots: number[] = []) => ({ kind: 'span', count, snapshots });
const P = (faction: string, x: number, y: number, extra: any = {}) => ({ faction, at: { x, y }, ...extra });
const give = (id: string, n: number) => Array(n).fill(id);
const bulk = (base: string, n: number) => give(base + '3', n);

// Declared initial card setup (constructor's real cards option), NOT an earned reward Choose:
// Pack Leader is legitimately owned; the bulk cards bound the one genuine camp fight.
const players = [
  P('fire', 200, 240, {
    weapon: 'wand',
    cards: ['packLeader', 'bigGameHunter', 'thickSkull', 'secondWind', 'siphon',
      ...bulk('ap', 16), ...bulk('vitality', 8), ...bulk('armor', 10), ...bulk('mr', 10)],
  }),
  P('holy', 272, 80, { cards: [...bulk('vitality', 30), ...bulk('armor', 30), ...bulk('mr', 30)] }),
  P('frost', 624, 112, {}),
];
const input = {
  name: 'pack-leader-genuine-one-clear',
  map: 'born', zone: 'holy', profile: 'full',
  config: { mobs: true, pvpRules: true },
  mainSeed: 12, rewardSalt: [1, 2, 3, 4],
  players,
  actions: [
    T(I('p0', 'target', { id: '@m0' })),
    N(300, [1, 2, 10, 50, 100, 150, 200, 250, 300]),
    T(I('p0', 'target', { id: 'p1' })),
    N(80, [1, 2, 5, 10, 20, 40, 80]),
    T(R()),
  ],
};
// Genuine-slice shape guards before the run: only ordinary step/span inputs, never a place/reward/status helper.
assert.equal(input.actions.every((a: any) => a.kind === 'step' || a.kind === 'span'), true, 'only ordinary step/span actions');
assert.equal(input.actions.some((a: any) => (a.inputs ?? []).some((i: any) => i.type !== 'target' && i.type !== 'release')), false, 'only ordinary target/release inputs');
assert.equal(players[0].cards.includes('packLeader'), true, 'declared initial Pack Leader ownership');

const control = process.env.RH_PACK_LEADER_CONTROL === '1';
const run = E.run(input);
const r: any = run;
const birth = r.birth, initial = r.initial, fin = r.final;
const hooks: any[] = [];
for (const h of r.completeOrdinaryHookTape) for (const k of h.hooks) if (k.kind === 'arguments') hooks.push({ tick: h.tick, time: h.time, ...k });
const campMobs = birth.public.mobs.map((m: any) => m.id);
const initialP0 = initial.private.players.find((p: any) => p.id === 'p0');
if (!control) assert.equal(initialP0.campsCleared ?? 0, 0, 'no camp cleared before the genuine clear');
assert.equal(birth.private.camps.length, 1, 'one source camp');
assert.deepEqual([birth.private.camps[0].state, birth.private.camps[0].alive], [0, 3], 'camp starts idle with three members');
const clears = hooks.filter((k: any) => k.hook === 'campCleared');
assert.equal(clears.length, 1, 'exactly one genuine campCleared hook');
const clearTick = clears[0].tick, clearTime = clears[0].time;
const hit = (k: any) => ({ tick: k.tick, time: k.time, by: k.args?.[0]?.by?.id, victim: k.args?.[0]?.victim, amount: k.args?.[1], raw: k.args?.[0]?.packet?.raw, weapon: k.args?.[0]?.weapon });
const hits = hooks.filter((k: any) => k.hook === 'hitLanded').map(hit);
const campHits = hits.filter((h: any) => h.by === 'p0' && campMobs.includes(h.victim) && h.tick <= clearTick && h.amount > 0);
assert.equal(new Set(campHits.map((h: any) => h.victim)).size, campMobs.length, 'p0 genuinely contributed to every camp member before the clear');
const deaths = hooks.filter((k: any) => k.hook === 'fighterOut' && campMobs.includes(k.args?.[0]));
assert.equal(deaths.length, campMobs.length, 'every camp member really died');
assert.equal(deaths.every((k: any) => k.tick <= clearTick), true, 'camp deaths precede the clear payment');
const finalCamp = fin.private.camps[0];
assert.deepEqual([finalCamp.state, finalCamp.alive, finalCamp.wardOwner], [2, 0, 'p0'], 'real cleared camp credited to p0');
if (!control) assert.equal(fin.private.players.find((p: any) => p.id === 'p0').campsCleared, 1, 'real count transition 0 -> 1');
const later = hits.find((h: any) => h.tick > clearTick && h.by === 'p0' && h.victim === 'p1' && h.amount > 0 && h.raw > 0);
assert.ok(later, 'a real post-clear nonneutral p0 -> p1 hit exists');
const finalP1 = fin.public.players.find((p: any) => p.id === 'p1');
assert.equal(finalP1.state.status, 'alive', 'later damage witness alive after the hit');
if (!control) assert.equal(finalCamp.clearedAt, clearTime, 'source camp clearedAt equals the hook time');

// Lexical source cache reads after ordinary execution: resolve the interned mods cache WeakMap entries.
const records: Record<string, any> = E.privateOracleRecords;
function resolve(ref: any) { return ref && typeof ref === 'object' && '$oracle' in ref ? records[ref.$oracle] : undefined; }
function sourceState(snap: any) {
  const o = snap?.private?.privateOracle;
  const mods = resolve(o?.mods);
  const actor = mods?.actors?.find((a: any) => a.id === 'p0');
  const cache = resolve(actor?.cache);
  return {
    label: snap?.label, tick: snap?.tick, time: snap?.time,
    campsCleared: snap?.private?.players?.find((p: any) => p.id === 'p0')?.campsCleared ?? null,
    cachedBuildCamps: cache?.build?.camps ?? null,
    cachedBuildCards: cache?.build?.cards ?? null,
    campState: snap?.private?.camps?.[0] ? { state: snap.private.camps[0].state, alive: snap.private.camps[0].alive, clearedAt: snap.private.camps[0].clearedAt } : null,
  };
}
const sourceStates: any[] = [];
for (const snap of [initial, ...r.timeline.flatMap((a: any) => a.frames ?? []), fin]) {
  const s = sourceState(snap);
  if (s.cachedBuildCamps !== null || s.campsCleared === 1) sourceStates.push(s);
}
if (!control) assert.ok(sourceStates.some((s: any) => s.cachedBuildCamps === 0 && !(s.campsCleared > 0)), 'source cache read 0 during the clear pass');
if (!control) assert.ok(sourceStates.some((s: any) => s.cachedBuildCamps === 1 && s.campsCleared === 1), 'source cache read 1 after the refresh');

const out = {
  format: 'rh-pack-leader-source/1',
  case: 'pack-leader-genuine-one-clear',
  acquisition: 'declared-initial-constructor-cards (packLeader legitimately owned; not an earned Choose)',
  base: process.env.RH_PACK_LEADER_BASE ?? null,
  tool: {
    capture: sha(readFileSync(new URL(import.meta.url))),
    engine: sha(readFileSync(new URL('../card-runtime-fixtures/engine.mts', import.meta.url))),
  },
  source: Object.fromEntries(['packages/shared/src/cards.ts', 'packages/server/src/sim/mods.ts', 'packages/server/src/sim/campHeal.ts', 'packages/server/src/sim/camps.ts', 'packages/server/src/sim/ledger.ts', 'packages/server/src/sim/step.ts', 'packages/server/src/sim/targeting.ts', 'packages/server/src/sim/weapons.ts'].map((p) => [p, sha(readFileSync(p))])),
  witness: { clearTick, clearTime, laterHit: later, campMobs, campHook: clears[0], sourceStates },
  input,
  result: run,
};
mkdirSync('/out', { recursive: true });
writeFileSync(process.env.RH_PACK_LEADER_OUTPUT ?? '/out/source.json', JSON.stringify(out) + '\n');
console.log('pack-leader capture wrote ' + (process.env.RH_PACK_LEADER_OUTPUT ?? '/out/source.json'));

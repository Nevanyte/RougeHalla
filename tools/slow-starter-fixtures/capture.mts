/** Bounded actual-source observations. No installed hit, clock, phase, death or NPC identity. */
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import * as Engine from '../card-runtime-fixtures/engine.mts';

const sourceBytes = readFileSync('parity/card-runtime/source.json');
assert.equal(Engine.sha(sourceBytes), 'f67417ff219039296852886e61aa9661ac535d2f5ce0126fa3f76f6a3a740337');
const sealed = JSON.parse(sourceBytes.toString());
for (const group of ['sourceInputs', 'harnessInputs']) {
  for (const row of sealed.provenance[group]) assert.equal(Engine.sha(readFileSync(row.path)), row.sha256, row.path);
}
const original = sealed.cases[30].input;
const attack = (actor = 'p0', a = 0) => ({actor, type: 'attack', payload: {a}});
const step = (...inputs: any[]) => ({kind: 'step', inputs});
const span = (count: number) => ({kind: 'span', count});
const train = (cmd: string, extra = {}) => ({actor: 'p0', type: 'train', payload: {cmd, ...extra}});
const prefix = original.actions.slice(0, 3);
const cases: any[] = [56, 57, 58].map((n) => ({
  ...structuredClone(original), name: `ordinary-restart-gap-${(n + 3) * 50}`,
  actions: [...structuredClone(prefix), span(n), step(attack()), span(2)], captureEveryTick: true,
}));
cases.push({
  ...structuredClone(original), name: 'mutual-player-landed-duplicate-touches', captureEveryTick: true,
  players: [original.players[0], {...original.players[1], weapon: 'sword', cards: ['slowStarter', ...original.players[1].cards]}, original.players[2]],
  actions: [step(attack(), attack('p1', Math.PI)), span(2)],
});
cases.push({
  name: 'solo-training-npc-helper-grant-real-clear-reacquire', map: 'room', profile: 'training',
  mainSeed: 12, rewardSalt: [1, 2, 3, 4], captureEveryTick: true,
  room: {spawns: [{x: 400, y: 400}]}, config: {training: true, dummies: true, pvpRules: false},
  // Declared player placement beside the real born plain dummy at (400,304). No NPC placement or identity changes.
  players: [{faction: 'holy', at: {x: 368, y: 304}, weapon: 'sword'}],
  // Slow Starter is NOT in the source interactive-card set. These grant actions are declared helpers,
  // not ordinary acquisition. Train Card0 is deliberately an actual no-op negative control.
  actions: [step(attack()), {kind: 'grant', actor: 'p0', cards: ['slowStarter']}, span(75),
    step(train('card', {id: 'slowStarter', count: 0})), span(12), step(train('clear')),
    span(12), {kind: 'grant', actor: 'p0', cards: ['slowStarter']}, span(75)],
});
cases.push({
  ...structuredClone(original), name: 'ordinary-lethal-watched-player-victim', captureEveryTick: true,
  players: [original.players[0], {...original.players[1], cards: ['slowStarter']}, original.players[2]],
  actions: [step(attack()), span(380), step({actor: 'p0', type: 'release', payload: {a: 0}})],
});
cases.push({
  ...structuredClone(original), name: 'ordinary-patience-teleport-keeps-clock', captureEveryTick: true,
  config: {pvpRules: false, patienceSeconds: 5, patienceMinSeconds: 5},
  actions: [step(attack()), span(103)],
});

function frames(c: any) {
  return [c.birth, c.initial, ...c.timeline.flatMap((a: any) => a.frames ?? [a]), c.final];
}
function visibleExecution(c: any) {
  return {frames: frames(c).map((f: any) => ({time: f.time, tick: f.tick, phase: f.phase,
    public: f.public, landed: f.private.landed, rng: f.rng, events: f.events})),
    events: c.completeNonemptyEventTape, randomTape: c.randomTape, steps: c.ordinarySteps};
}
function resolve(v: any): any {
  if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && v.$oracle)
    return resolve(Engine.privateOracleRecords[v.$oracle]);
  if (Array.isArray(v)) return v.map(resolve);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x)]));
  return v;
}
function observed(c: any) {
  return {name: c.name, input: c.input, ordinarySteps: c.ordinarySteps,
    frames: frames(c).map((f: any) => {
      const m = resolve(f.private.privateOracle.mods);
      return {label: f.label, time: f.time, tick: f.tick, phase: f.phase, rng: f.rng,
        inColiseum: f.public.inColiseum, landed: f.private.landed,
        players: f.public.players.map(({id, state}: any) => ({id, hp: state.hp, maxHp: state.maxHp,
          status: state.status, x: state.x, y: state.y, build: state.build})),
        mobs: f.public.mobs.map(({id, state}: any) => ({id, kind: state.kind, type: state.type,
          hp: state.hp, maxHp: state.maxHp, status: state.status, x: state.x, y: state.y})),
        fightWatch: m.fightWatch, fightClocks: m.fightClocks,
        cache: m.actors.filter((a: any) => a.id.startsWith('p')).map((a: any) => ({id: a.id,
          rows: a.cache?.build?.rows, usesFight: a.cache?.build?.usesFight,
          holds: a.cache?.build?.holds, damageSum: a.cache?.build?.sums.damage})), events: f.events};
    }), randomTape: c.randomTape, completeNonemptyEventTape: c.completeNonemptyEventTape,
    ordinaryHookOrder: c.completeOrdinaryHookTape.map((x: any) => ({tick: x.tick, time: x.time,
      hooks: x.hooks.map(({privateOracle, ...hook}: any) => hook)}))};
}

// Import with RH_CARD_NO_INSPECTOR=1. Run pristine first; inspector disconnects before the observed runs.
assert.equal(process.env.RH_CARD_NO_INSPECTOR, '1');
const controls = cases.map((c) => visibleExecution(Engine.run(c)));
await Engine.prepareInspection();
Engine.enableOracle();
const captured = cases.map((c, i) => {
  const result = Engine.run(c);
  assert.deepEqual(visibleExecution(result), controls[i], `read-only inspection noninterference: ${c.name}`);
  return observed(result);
});
for (const c of captured) assert.deepEqual(observed(Engine.run(c.input)), c, `deterministic repeat: ${c.name}`);

const output = {format: 'rh-slow-starter-source-assessment/1',
  scope: 'Seven actual-source witnesses, three executions each: pristine, read-only inspection, inspected repeat. No native parity/identity admission.',
  sourceCorpusSha256: Engine.sha(sourceBytes), sourceInputs: sealed.provenance.sourceInputs,
  harnessInputs: sealed.provenance.harnessInputs,
  captureInputs: ['tools/slow-starter-fixtures/capture.mts', 'tools/slow-starter-fixtures/capture.sh'].map((path) => ({path, sha256: Engine.sha(readFileSync(path))})),
  runtime: {node: process.version, platform: process.platform, arch: process.arch, fixedStepMs: 50},
  controls: {inspectionNoninterference: 7, deterministicRepeats: 7}, cases: captured};
const path = process.env.RH_SLOW_STARTER_OUTPUT;
assert(path);
writeFileSync(path, JSON.stringify(output, null, 2) + '\n', {flag: 'wx', mode: 0o600});
console.log(JSON.stringify({status: 'CAPTURED', cases: captured.length,
  ordinaryStepsPerObservedRun: captured.map((c) => ({name: c.name, steps: c.ordinarySteps})),
  inspectionNoninterference: 7, deterministicRepeats: 7, outputSha256: Engine.sha(readFileSync(path))}));

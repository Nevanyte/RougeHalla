/** Four ordinary source steps: retain actual enqueue acceptance separately from the compact clock trace. */
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import * as Engine from '../card-runtime-fixtures/engine.mts';

assert.equal(process.env.RH_CARD_NO_INSPECTOR, '1');
const corpus = JSON.parse(readFileSync('parity/card-runtime/source.json', 'utf8'));
for (const row of [...corpus.provenance.sourceInputs, ...corpus.provenance.harnessInputs])
  assert.equal(Engine.sha(readFileSync(row.path)), row.sha256, row.path);
const input = {name: 'actual-slow-starter-training-door', map: 'room', profile: 'training',
  config: {training: true, dummies: false}, players: [{faction: 'holy'}], actions: [
    {kind: 'step', inputs: [{actor: 'p0', type: 'train', payload: {cmd: 'card', id: 'slowStarter', count: 1}}]},
    {kind: 'grant', actor: 'p0', cards: ['slowStarter']},
    {kind: 'step', inputs: [{actor: 'p0', type: 'train', payload: {cmd: 'card', id: 'slowStarter', count: 0}}]},
    {kind: 'step', inputs: [{actor: 'p0', type: 'train', payload: {cmd: 'clear'}}]},
  ]};
const c = Engine.run(input);
const build = (f: any) => f.public.players[0].state.build;
assert.deepEqual(build(c.timeline[0]), {});
assert.equal(build(c.timeline[1]).slowStarter, 1);
assert.equal(build(c.timeline[2]).slowStarter, 1);
assert.deepEqual(build(c.timeline[3]), {});
for (const i of [0, 2, 3]) assert.equal(c.timeline[i].inputs[0].accepted, true);
const result = {format: 'rh-slow-starter-source-door/1', runtime: process.version,
  scope: 'Actual enqueue acceptance and handler/build observations; helper grant explicitly declared; no inspector.',
  input, steps: c.ordinarySteps, randomTape: c.randomTape,
  frames: c.timeline.map((f: any) => ({time: f.time, tick: f.tick, label: f.label, inputs: f.inputs,
    build: build(f), grantResults: f.results, events: f.events, rng: f.rng})),
  probeSha256: Engine.sha(readFileSync('tools/slow-starter-fixtures/door-probe.mts'))};
assert(process.env.RH_SLOW_STARTER_DOOR_OUTPUT);
writeFileSync(process.env.RH_SLOW_STARTER_DOOR_OUTPUT, JSON.stringify(result, null, 2) + '\n', {flag: 'wx', mode: 0o600});
console.log('PASS actual TrainCard1/0 enqueue accepted; both no-op; actual TrainingClear removed declared helper grant; four ordinary steps');

// Canonical actual-source fair-view foundation witness (P-BOTS-1 remainder), pinned linux/amd64 Node 22.23.4.
// Drives the exported source helpers of brain/perception.ts (detectFeatures, inView, fieldInView, plainCopy) over declared
// probes, windows and message data, and records the source answers. Nothing is read back into the source.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {detectFeatures, fieldInView, inView, plainCopy} from '/repo/packages/server/src/bots/brain/perception.ts';
import {CLIENT_MESSAGE_TYPES} from '/repo/packages/shared/src/messages.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string');
const [, outPath] = args;
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');

const r6 = (v) => Math.round(v * 1e6) / 1e6;

/** Builds the runtime probe a source detectFeatures call inspects from a declared record. */
function probeOf(spec) {
  const state = {};
  for (const key of Object.keys(spec.state ?? {})) state[key] = spec.state[key];
  if (spec.state && spec.state.players) state.players = new Map(Object.entries(spec.state.players));
  const probe = {state};
  if (spec.player !== undefined) probe.player = spec.player;
  if (spec.mapTerrain !== undefined) probe.map = {terrain: Uint8Array.from(spec.mapTerrain)};
  else if (spec.mapHazards !== undefined) probe.map = {hazards: spec.mapHazards ? {} : null};
  if (spec.messageTypes !== undefined) probe.messageTypes = spec.messageTypes;
  return probe;
}

const layer = (n, fill) => {
  let v = fill;
  const out = [];
  for (let i = 0; i < n; i++) out.push(v);
  return out;
};
const deep = (depth, leaf) => {
  let v = leaf;
  for (let i = 0; i < depth; i++) v = {level: i, inner: v};
  return v;
};

const FEATURE_SPECS = [
  {name: 'bare', state: {}, player: {}, messageTypes: []},
  {name: 'full', state: {fields: [], camps: []}, player: {wishReadyAt: 0, effects: 0, build: {}}, mapTerrain: [0, 4, 0]},
  {name: 'cast-only', state: {}, player: {}, messageTypes: ['cast']},
  {name: 'wish-field', state: {}, player: {wishReadyAt: 0}, messageTypes: ['cast']},
  {name: 'effects-field', state: {}, player: {effects: 0}, messageTypes: []},
  {name: 'build-field', state: {}, player: {build: {}}, messageTypes: []},
  {name: 'q-e-fields', state: {}, player: {qReadyAt: 0, eReadyAt: 0}, messageTypes: ['cast']},
  {name: 'fields', state: {fields: {}}, player: {}, messageTypes: []},
  {name: 'camps', state: {camps: []}, player: {}, messageTypes: []},
  {name: 'plan', state: {}, player: {}, messageTypes: ['plan']},
  {name: 'choose', state: {}, player: {}, messageTypes: ['choose']},
  {name: 'default-types', state: {}, player: {}},
  {name: 'first-player', state: {players: {a: {wishReadyAt: 0, effects: 1}}}, messageTypes: ['cast']},
  {name: 'hazard-terrain-none', state: {}, player: {}, mapTerrain: [0, 1, 2, 3]},
  {name: 'hazard-terrain-ember', state: {}, player: {}, mapTerrain: [0, 4]},
  {name: 'hazard-terrain-light', state: {}, player: {}, mapTerrain: [7]},
  {name: 'hazard-terrain-high', state: {}, player: {}, mapTerrain: [8]},
  {name: 'hazard-layer-on', state: {}, player: {}, mapHazards: true},
  {name: 'hazard-layer-off', state: {}, player: {}, mapHazards: false},
];
const features = FEATURE_SPECS.map((spec) => ({
  name: spec.name,
  spec,
  result: (() => {
    const f = detectFeatures(probeOf(spec));
    return {...f, messageTypes: [...f.messageTypes]};
  })(),
}));

const HALF_W = 800;
const HALF_H = 625;
const IN_VIEW_POINTS = [
  [0, 0], [400, 320], [-500, 100], [HALF_W, HALF_H], [HALF_W + 1, 0], [0, HALF_H + 1],
  [-HALF_W, -HALF_H], [-HALF_W - 1, -HALF_H - 1], [HALF_W - 0.5, HALF_H - 0.5],
];
const windows = [];
for (const [cx, cy] of [[0, 0], [400, 320], [-500, 100]]) {
  for (const [x, y] of IN_VIEW_POINTS) {
    for (const pad of [0, 10, -5]) {
      windows.push({cx, cy, x, y, pad, result: inView(cx, cy, x, y, pad)});
    }
  }
}

const FIELD_SPECS = [
  {kind: 'circle', x: 0, y: 0, x2: 0, y2: 0, r: 0},
  {kind: 'circle', x: 900, y: 0, x2: 0, y2: 0, r: 0},
  {kind: 'circle', x: 400, y: 320, x2: 0, y2: 0, r: 50},
  {kind: 'trail', x: -1000, y: 0, x2: 1000, y2: 0, r: 10},
  {kind: 'trail', x: 1000, y: 0, x2: -1000, y2: 0, r: 10},
  {kind: 'trail', x: 0, y: 900, x2: 0, y2: 700, r: 0},
  {kind: 'trail', x: 0, y: -700, x2: 0, y2: -900, r: 5},
];
const fields = [];
for (const f of FIELD_SPECS) {
  for (const [cx, cy] of [[0, 0], [400, 320], [-900, 0]]) {
    for (const pad of [0, 25, -10]) {
      fields.push({field: f, cx, cy, pad, result: fieldInView(cx, cy, f, pad)});
    }
  }
}

const PLAIN_VALUES = [
  null, true, false, 0, -1.5, 'text',
  {a: 1, b: [1, null, 'x'], c: {d: {e: 1}}},
  [[[1]]],
  deep(6, 1),
  deep(8, 1),
  deep(9, 1),
  {nested: deep(9, 'leaf'), keep: 2},
  {arr: [deep(9, 1), 3]},
];
const plain = PLAIN_VALUES.map((v) => ({input: v, result: plainCopy(v) === undefined ? null : plainCopy(v)}));

const SOURCE = [
  'packages/server/src/bots/brain/perception.ts',
  'packages/server/src/bots/brain/types.ts',
  'packages/shared/src/messages.ts',
  'packages/shared/src/terrain.ts',
  'packages/shared/src/constants.ts',
  'packages/shared/src/abilities.ts',
];
const sha = (p) => createHash('sha256').update(readFileSync('/repo/' + p)).digest('hex');
const corpus = {
  format: 'rh-bot-perception-source/1',
  profile: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    botView: {halfW: HALF_W, halfH: HALF_H},
    clientMessageTypes: [...CLIENT_MESSAGE_TYPES],
    sourceFiles: Object.fromEntries(SOURCE.map((p) => [p, sha(p)])),
    tool: sha('tools/perception-fixtures/capture.mts'),
  },
  features,
  windows,
  fields,
  plain,
};
corpus.profile.captureSha256 = createHash('sha256').update(JSON.stringify(corpus)).digest('hex');
const out = JSON.stringify(corpus) + String.fromCharCode(10);
if (args[0] === '--write') {
  writeFileSync(outPath, out);
  console.log('captured ' + features.length + ' feature probes, ' + windows.length + ' windows, ' + fields.length + ' fields, ' + plain.length + ' copies');
} else {
  assert.equal(readFileSync(outPath, 'utf8'), out, 'the checked-in perception corpus differs from the source capture');
  console.log('perception corpus matches: ' + outPath);
}

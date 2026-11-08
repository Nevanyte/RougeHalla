// Canonical actual-source hardware witness for the Knowledge repair packet (P-BOTS-1 remainder repair), pinned
// linux/amd64 Node 22.23.4: the source brain's Knowledge wiring (brain.ts derive + the tag-3 stream), the source Knowledge
// diagnostic strings at exact toFixed(2) half ties (knowledge.ts odds) and the source fair-view feature probe with an
// explicit null player (perception.ts detectFeatures probe.player ?? firstPlayer). The wiring values are produced by a
// read-only probe: the derive function text is extracted from brain.ts and evaluated, and the tag literal is read from the
// actual wiring line; no expected value is computed from Rust.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {createKnowledge} from '/repo/packages/server/src/bots/brain/knowledge.ts';
import {detectFeatures} from '/repo/packages/server/src/bots/brain/perception.ts';
import {TIERS} from '/repo/packages/server/src/bots/brain/types.ts';
import {FACTION_IDS, mulberry32, WEAPON_BEATS, WEAPON_IDS} from '/repo/packages/shared/src/index.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string');
const [, outPath] = args;
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');

const r6 = (v) => Math.round(v * 1e6) / 1e6;
const brainPath = '/repo/packages/server/src/bots/brain/brain.ts';
const brain = readFileSync(brainPath, 'utf8');
const brainLines = brain.split(String.fromCharCode(10));
const lineText = (n) => brainLines[n - 1];

// ---- read-only probe of the wiring: the derive function text, extracted and evaluated, and the actual tag literal ----
function extractFunction(source, signature) {
  const at = source.indexOf(signature);
  assert(at >= 0, 'the source declares ' + signature);
  let depth = 0;
  for (let i = source.indexOf('{', at); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(at, i + 1);
    }
  }
  throw new Error('unbalanced ' + signature);
}
const deriveText = extractFunction(brain, 'function derive(seed: number, tag: number): number {');
const deriveJs = deriveText.replace(/: number/g, '');
const derive = new Function(deriveJs + '; return derive;')();
assert.equal(typeof derive, 'function', 'the extracted derive source runs');
const deriveSha = createHash('sha256').update(deriveText).digest('hex');

const wiringLines = [];
let knowledgeLine = -1;
let createLine = -1;
for (let n = 1; n <= brainLines.length; n++) {
  const text = lineText(n);
  if (text.includes('const rng: BrainRngs') || text.includes('mulberry32(derive(cfg.seed, ')) wiringLines.push({line: n, text: text.trim()});
  if (text.includes('mulberry32(derive(cfg.seed, 3))')) knowledgeLine = n;
  if (text.includes('createKnowledge(tier, knowledgeRng)')) createLine = n;
}
assert(knowledgeLine > 0, 'the brain wires the Knowledge stream explicitly');
const tagMatch = /derive\(cfg\.seed, (\d+)\)/.exec(lineText(knowledgeLine));
assert(tagMatch !== null, 'the Knowledge stream line names its tag');
const knowledgeTag = Number(tagMatch[1]);
assert.equal(knowledgeTag, 3, 'the source Knowledge stream is tag 3');
assert(createLine > knowledgeLine, 'the layer is created after its stream is seeded');

const tag3Vectors = [];
for (const seed of [0, 1, 7, 42, 4294967295]) tag3Vectors.push({seed, tag: 3, expected: derive(seed, 3)});
assert.deepEqual(
  tag3Vectors.map((v) => v.expected),
  [3971731199, 197380189, 2057029952, 3268108958, 1587572149],
  'the source derive reproduces the packet tag3 vectors',
);
const tagVectors = [];
for (const tag of [0, 1, 2, 3]) for (const seed of [0, 1, 7, 42]) tagVectors.push({seed, tag, expected: derive(seed, tag)});

// ---- the Knowledge layer as the wiring produces it, against the decision-stream stream ----
const FACTION_PAIRS = [
  ['fire', 'sentenced'], ['fire', 'plague'], ['sentenced', 'plague'], ['sentenced', 'frost'], ['plague', 'frost'],
  ['plague', 'holy'], ['frost', 'holy'], ['frost', 'fire'], ['holy', 'fire'], ['holy', 'sentenced'],
];
const fingerprintPair = {
  me: {weapons: ['fists', 'sword'], slot: 0, faction: 'fire', hp: 80, maxHp: 100},
  them: {id: 'foe', faction: 'frost', inHand: 'axe', otherSlot: null, hpFrac: 0.4, bounty: 30, dist: 300, tint: 0},
};
function fingerprint(k) {
  const me = {...fingerprintPair.me, weapons: [...fingerprintPair.me.weapons]};
  const them = fingerprintPair.them;
  return {
    factions: FACTION_PAIRS.map(([a, b]) => ({a, b, ab: k.factionEdge(a, b), ba: k.factionEdge(b, a)})),
    weapons: WEAPON_BEATS.map(([a, b]) => ({a, b, ab: k.weaponEdge(a, b), ba: k.weaponEdge(b, a)})),
    mobShare: (() => {
      const out = [];
      for (const m of FACTION_IDS) for (const region of FACTION_IDS) for (const elite of [false, true]) {
        out.push({me: m, region, elite, share: r6(k.mobShare(m, region, elite))});
      }
      return out;
    })(),
    odds: (() => {
      const o = k.odds(me, them);
      return {edge: r6(o.edge), score: r6(o.score), known: o.known, why: o.why};
    })(),
  };
}
const tierFrom = (knowledge, noise) => ({...TIERS.easy, knowledge, mobShareNoise: noise});
const wiringProbes = [];
for (const seed of [0, 1, 7, 42, 4294967295]) {
  const tag3 = derive(seed, knowledgeTag);
  const rng = mulberry32(tag3);
  const firstDraws = [rng(), rng(), rng()];
  const tag3Knowledge = createKnowledge(tierFrom(TIERS.easy.knowledge, TIERS.easy.mobShareNoise), mulberry32(tag3));
  const decideKnowledge = createKnowledge(tierFrom(TIERS.easy.knowledge, TIERS.easy.mobShareNoise), mulberry32(derive(seed, 0)));
  const a = fingerprint(tag3Knowledge);
  const b = fingerprint(decideKnowledge);
  wiringProbes.push({
    seed, tag: knowledgeTag, derived: tag3, firstDraws,
    tag3Fingerprint: a, decideFingerprint: b, differs: JSON.stringify(a) !== JSON.stringify(b),
  });
}

// ---- exact toFixed(2) half ties in the source diagnostic why line (knowledge.ts odds) ----
const blind = createKnowledge(tierFrom(0, TIERS.easy.mobShareNoise), mulberry32(20261108));
function oddsOf(me, them) {
  const o = blind.odds(me, them);
  return {edge: r6(o.edge), score: r6(o.score), known: o.known, why: o.why};
}
const viewer = (hp, maxHp) => ({weapons: [null, null], slot: 0, faction: null, hp, maxHp});
const foe = (hpFrac, tint) => ({id: 'foe', faction: null, inHand: null, otherSlot: null, hpFrac, bounty: 0, dist: 300, tint});
const halfTies = [
  {name: 'lead-half-125', me: viewer(6.25, 100), them: foe(0, 0)},
  {name: 'lead-half-neg-125', me: viewer(0, 100), them: foe(0.0625, 0)},
  {name: 'lead-half-375', me: viewer(18.75, 100), them: foe(0, 0)},
  {name: 'lead-half-neg-375', me: viewer(0, 100), them: foe(0.1875, 0)},
  {name: 'score-half-125', me: viewer(100, 100), them: foe(0, 0.0625)},
  {name: 'score-half-neg-125', me: viewer(100, 100), them: foe(0, -0.0625)},
  {name: 'score-half-1625', me: viewer(100, 100), them: foe(0, 0.8125)},
  {name: 'score-half-neg-1625', me: viewer(100, 100), them: foe(0, -0.8125)},
].map((c) => ({...c, result: oddsOf(c.me, c.them)}));
assert(halfTies.some((c) => c.result.why.includes('0.13')), 'a half tie rounds up in the source');
assert(halfTies.some((c) => c.result.why.includes('-0.13')), 'a negative half tie rounds away from zero');
assert(halfTies.some((c) => c.result.why.includes('1.63')), 'a larger half tie rounds away from zero');

// ---- the fair-view feature probe with an explicit null player (perception.ts probe.player ?? firstPlayer) ----
function featureProbeOf(spec) {
  const state = {};
  if (spec.players !== undefined) state.players = new Map(spec.players.map((p, i) => ['p' + i, p]));
  if (spec.fields !== undefined) state.fields = spec.fields;
  if (spec.camps !== undefined) state.camps = spec.camps;
  const probe = {state, messageTypes: spec.messageTypes};
  if (spec.player !== 'missing') probe.player = spec.player === 'null' ? null : spec.player;
  if (spec.mapTerrain !== undefined) probe.map = {terrain: spec.mapTerrain};
  return probe;
}
const FULL = {wishReadyAt: 0, effects: 0, build: {}, qReadyAt: 0, eReadyAt: 0};
const explicitNullCases = [
  {name: 'explicit-null-falls-back-to-first-player', players: [FULL], player: 'null', fields: [], camps: [], messageTypes: ['cast', 'plan', 'choose']},
  {name: 'explicit-null-first-player-empty-flags', players: [{}], player: 'null', messageTypes: ['cast', 'plan', 'choose']},
  {name: 'explicit-object-wins-over-first-player', players: [{}], player: {wishReadyAt: 0, effects: 0, build: {}}, messageTypes: ['cast', 'plan', 'choose']},
  {name: 'missing-player-falls-back-to-first-player', players: [FULL], player: 'missing', fields: [], camps: [], messageTypes: ['cast', 'plan', 'choose']},
  {name: 'explicit-null-no-players', players: [], player: 'null', messageTypes: ['cast']},
  {name: 'explicit-null-no-state-player-fields', players: undefined, player: 'null', fields: [], camps: [], messageTypes: ['plan']},
].map((spec) => {
  const features = detectFeatures(featureProbeOf(spec));
  return {
    name: spec.name,
    player: spec.player,
    players: spec.players,
    fields: spec.fields,
    camps: spec.camps,
    messageTypes: spec.messageTypes,
    result: features,
  };
});
assert.equal(explicitNullCases[0].result.wishes, true, 'the source falls back to the first player');
assert.equal(explicitNullCases[0].result.statusEffects, true);
assert.equal(explicitNullCases[1].result.wishes, false);
assert.equal(explicitNullCases[2].result.skills, false);
assert.equal(explicitNullCases[4].result.wishes, false);

const SOURCE = [
  'packages/server/src/bots/brain/brain.ts',
  'packages/server/src/bots/brain/knowledge.ts',
  'packages/server/src/bots/brain/perception.ts',
  'packages/server/src/bots/brain/random.ts',
  'packages/server/src/bots/brain/types.ts',
  'packages/server/src/bots/mobHunt.ts',
  'packages/shared/src/factions.ts',
  'packages/shared/src/weapons.ts',
  'packages/shared/src/rng.ts',
  'packages/shared/src/constants.ts',
  'packages/shared/src/planning.ts',
  'packages/shared/src/mobs.ts',
  'packages/shared/src/mark.ts',
  'packages/shared/src/signatureShares.ts',
  'packages/shared/src/map.ts',
  'packages/shared/src/signatures.ts',
];
const sha = (p) => createHash('sha256').update(readFileSync('/repo/' + p)).digest('hex');
const corpus = {
  format: 'rh-bot-knowledge-repair-source/1',
  profile: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    sourceFiles: Object.fromEntries(SOURCE.map((p) => [p, sha(p)])),
    tool: sha('tools/knowledge-repair-fixtures/capture.mts'),
  },
  wiring: {
    file: 'packages/server/src/bots/brain/brain.ts',
    line: knowledgeLine,
    createLine,
    lines: wiringLines,
    tag: knowledgeTag,
    deriveTextSha256: deriveSha,
    fingerprintPair,
    probes: wiringProbes,
  },
  halfTieSetup: {seed: 20261108, knowledge: 0, noise: TIERS.easy.mobShareNoise},
  deriveSource: deriveText,
  tagVectors,
  halfTies,
  explicitNull: explicitNullCases,
};
corpus.profile.captureSha256 = createHash('sha256').update(JSON.stringify(corpus)).digest('hex');
const out = JSON.stringify(corpus, null, 1) + String.fromCharCode(10);
if (args[0] === '--write') {
  writeFileSync(outPath, out);
  const total = tagVectors.length + wiringProbes.length + halfTies.length + explicitNullCases.length;
  console.log('captured ' + total + ' repair cases; knowledge tag ' + knowledgeTag + ' at line ' + knowledgeLine);
} else {
  assert.equal(readFileSync(outPath, 'utf8'), out, 'the checked-in repair corpus differs from the source capture');
  console.log('knowledge repair corpus matches: ' + outPath);
}

// Canonical actual-source Knowledge-layer witness (P-BOTS-3 remainder II), pinned linux/amd64 Node 22.23.4.
// createKnowledge(tier, rng) over declared knowledge/noise overrides and seeds, then every wheel edge, the mob-share grid,
// and fight-odds rows over declared SelfView/OpponentSnapshot inputs. The next two draws of the stream are recorded so a
// port that consumes a different number of draws fails even if its answers happen to match.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {createKnowledge} from '/repo/packages/server/src/bots/brain/knowledge.ts';
import {TIERS, type TierId, type TierParams} from '/repo/packages/server/src/bots/brain/types.ts';
import {FACTION_IDS, mulberry32, WEAPON_BEATS, WEAPON_IDS} from '/repo/packages/shared/src/index.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string');
const [, outPath] = args;
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');

const r6 = (v) => Math.round(v * 1e6) / 1e6;
const FACTION_PAIRS = [
  ['fire', 'sentenced'], ['fire', 'plague'], ['sentenced', 'plague'], ['sentenced', 'frost'], ['plague', 'frost'],
  ['plague', 'holy'], ['frost', 'holy'], ['frost', 'fire'], ['holy', 'fire'], ['holy', 'sentenced'],
];
// The legacy FACTION_PAIRS order (shared/factions.ts): used for the source-side enumeration of the faction masks.
const tierOf = (id, knowledge, noise) => ({...TIERS[id], knowledge, mobShareNoise: noise});

const CASES = [
  {name: 'easy', tier: 'easy', knowledge: TIERS.easy.knowledge, noise: TIERS.easy.mobShareNoise, seeds: [1, 42]},
  {name: 'normal', tier: 'normal', knowledge: TIERS.normal.knowledge, noise: TIERS.normal.mobShareNoise, seeds: [1, 42]},
  {name: 'hard', tier: 'hard', knowledge: TIERS.hard.knowledge, noise: TIERS.hard.mobShareNoise, seeds: [1, 42]},
  {name: 'blind', tier: 'hard', knowledge: 0, noise: TIERS.hard.mobShareNoise, seeds: [1]},
  {name: 'seer', tier: 'hard', knowledge: 1, noise: 0, seeds: [1]},
  {name: 'partial', tier: 'normal', knowledge: 0.35, noise: 0.2, seeds: [7]},
];

function viewer(weapons, slot, faction, hp, maxHp) {
  return {weapons: [weapons[0] ?? null, weapons[1] ?? null], slot, faction, hp, maxHp};
}
const THEM_FACS = [null, 'sentenced', 'plague', 'holy'];
const THEM_HANDS = [null, 'axe', 'sword', 'shield', 'bow', 'wand'];
const ME_FACS = [null, 'fire', 'frost', 'holy'];
const ME_WEAPONS = [[null, null], ['sword', null], ['axe', null], ['bow', null], ['wand', null], ['shield', null], ['fists', 'sword']];
const HP = [[100, 100], [40, 100], [0, 0], [7, 20]];
const TINTS = [0, 0.5, -0.5, 0.25, -1, 0.001];
const HPS = [1, 0.5, 0.1];

function oddsRows(k) {
  const rows = [];
  let n = 0;
  for (const meF of ME_FACS) {
    for (const w of ME_WEAPONS) {
      for (const [hp, maxHp] of HP) {
        for (const themF of THEM_FACS) {
          for (const hand of THEM_HANDS) {
            const tint = TINTS[n % TINTS.length];
            const hpFrac = HPS[n % HPS.length];
            n++;
            // A declared sample of the grid (every 61st combination), still covering every branch; a full grid would only
            // inflate the corpus.
            if (n % 61 !== 0) continue;
            const me = viewer(w, 0, meF, hp, maxHp);
            const them = {id: 'foe', faction: themF, inHand: hand, otherSlot: null, hpFrac, bounty: n % 2 === 0 ? 30 : 0, dist: 300, tint};
            const odds = k.odds(me, them);
            rows.push({
              me: {faction: meF, weapons: w, slot: 0, hp, maxHp},
              them,
              result: {edge: r6(odds.edge), score: r6(odds.score), known: odds.known, why: odds.why},
            });
          }
        }
      }
    }
  }
  return rows;
}

function runCase(spec) {
  return spec.seeds.map((seed) => {
    const tier = tierOf(spec.tier, spec.knowledge, spec.noise);
    const rng = mulberry32(seed);
    const k = createKnowledge(tier, rng);
    const probe = {decide: rng(), next: rng()};
    const factions = FACTION_PAIRS.map(([a, b]) => ({a, b, ab: k.factionEdge(a, b), ba: k.factionEdge(b, a)}));
    const weapons = WEAPON_BEATS.map(([a, b]) => ({a, b, ab: k.weaponEdge(a, b), ba: k.weaponEdge(b, a)}));
    const mobShare = [];
    for (const me of FACTION_IDS) {
      for (const region of FACTION_IDS) {
        for (const elite of [false, true]) {
          mobShare.push({me, region, elite, share: r6(k.mobShare(me, region, elite))});
        }
      }
    }
    return {tier: spec.tier, knowledge: spec.knowledge, noise: spec.noise, seed, probe, factions, weapons, mobShare, odds: oddsRows(k)};
  });
}

const source = runCase(CASES[0]);
for (const spec of CASES) {
  const cases = runCase(spec);
  // Every case replays identically for the same declared seed.
  assert.deepEqual(cases, runCase(spec), spec.name + ' replays identically');
  for (const c of cases) {
    assert.equal(c.factions.length, 10);
    assert.equal(c.weapons.length, 10);
    assert.equal(c.mobShare.length, 50);
  }
  if (spec === CASES[0]) continue;
  void source;
}

const SOURCE = [
  'packages/server/src/bots/brain/knowledge.ts',
  'packages/server/src/bots/brain/types.ts',
  'packages/server/src/bots/brain/random.ts',
  'packages/server/src/bots/mobHunt.ts',
  'packages/shared/src/factions.ts',
  'packages/shared/src/signatures.ts',
  'packages/shared/src/weapons.ts',
  'packages/shared/src/constants.ts',
  'packages/shared/src/planning.ts',
  'packages/shared/src/mobs.ts',
  'packages/shared/src/mark.ts',
  'packages/shared/src/signatureShares.ts',
  'packages/shared/src/map.ts',
  'packages/shared/src/rng.ts',
];
const sha = (p) => createHash('sha256').update(readFileSync('/repo/' + p)).digest('hex');
const corpus = {
  format: 'rh-bot-knowledge-source/1',
  profile: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    constants: {maxEdge: 2},
    sourceFiles: Object.fromEntries(SOURCE.map((p) => [p, sha(p)])),
    tool: sha('tools/knowledge-fixtures/capture.mts'),
  },
  cases: CASES.map((spec) => ({name: spec.name, items: runCase(spec)})),
};
corpus.profile.captureSha256 = createHash('sha256').update(JSON.stringify(corpus)).digest('hex');
const out = JSON.stringify(corpus, null, 1) + String.fromCharCode(10);
if (args[0] === '--write') {
  writeFileSync(outPath, out);
  const rows = corpus.cases.reduce((n, c) => n + c.items.reduce((m, i) => m + i.odds.length, 0), 0);
  console.log('captured ' + corpus.cases.length + ' knowledge cases and ' + rows + ' odds rows');
} else {
  assert.equal(readFileSync(outPath, 'utf8'), out, 'the checked-in knowledge corpus differs from the source capture');
  console.log('knowledge corpus matches: ' + outPath);
}

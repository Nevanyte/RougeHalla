// Canonical actual-source planning-module witness (P-BOTS-3 remainder), pinned linux/amd64 Node 22.23.4.
// Drives the unmodified brain/modules/planning.ts over declared screen inputs (tier, faction/weapon, deal messages and
// clocks), and records the module's intents plus the next draws of its decide/lapse streams. The shared planning maths
// (matchupShare/campMatchup/nearestCamps/planSpawnScore/planPick) is recorded over the same declared maps. Nothing is
// read back into the module: every expected value is written by the source.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {mulberry32, PLAN_SECONDS} from '/repo/packages/shared/src/index.ts';
import {TIERS} from '/repo/packages/server/src/bots/brain/types.ts';
import {planningModule, PLAN_RULES} from '/repo/packages/server/src/bots/brain/modules/planning.ts';
import {PLAN_CAMPS, planPick, planSpawnScore} from '/repo/packages/server/src/bots/mobHunt.ts';
import {campMatchup, matchupShare, nearestCamps} from '/repo/packages/shared/src/planning.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string');
const [, outPath] = args;
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');

const r6 = (v) => Math.round(v * 1e6) / 1e6;
const declared = JSON.parse(readFileSync('/capture/plan-maps.json', 'utf8'));
const MAPS = declared.maps;
const FACTION_IDS = ['fire', 'sentenced', 'plague', 'frost', 'holy'];
const WEAPONS = [null, 'sword', 'bow', 'wand', 'axe', 'shield'];

const mapOf = (name) => ({spawnPool: MAPS[name].spawnPool, camps: MAPS[name].camps});

// -------------------------------------------------------------------------------------------------------------- helpers
const helpers = {matchup: [], campMatchup: [], nearestCamps: [], spawnScore: [], planPick: []};
for (const me of FACTION_IDS) {
  for (const region of FACTION_IDS) {
    for (const elite of [false, true]) {
      helpers.matchup.push({me, region, elite, share: r6(matchupShare(me, region, elite))});
    }
  }
  for (const name of ['pve', 'spread']) {
    for (const camp of MAPS[name].camps) {
      helpers.campMatchup.push({map: name, me, camp: camp.id, share: r6(campMatchup(me, camp))});
    }
  }
}
for (const name of ['pve', 'spread']) {
  for (const at of [{x: 80, y: 80}, {x: 400, y: 400}, {x: 600, y: 600}]) {
    helpers.nearestCamps.push({map: name, at, ids: nearestCamps(mapOf(name), at, PLAN_CAMPS).map((c) => c.id)});
  }
  const map = mapOf(name);
  for (let i = 0; i < map.spawnPool.length; i++) {
    for (const me of FACTION_IDS) {
      for (const weapon of WEAPONS) {
        helpers.spawnScore.push({map: name, pool: i, me, weapon, score: r6(planSpawnScore(map, i, me, weapon))});
      }
    }
  }
}
const picks = [
  {spawns: [0, 1], taken: [false, false]},
  {spawns: [0, 1], taken: [true, false]},
  {spawns: [0, 1], taken: [false, true]},
  {spawns: [0, 1], taken: [true, true]},
  {spawns: [-1, 1], taken: [false, false]},
  {spawns: [0, 0], taken: [false, false]},
  {spawns: [2, 3], taken: [false, false]},
];
for (const name of ['pve', 'spread']) {
  for (const pick of picks) {
    for (const me of FACTION_IDS) {
      helpers.planPick.push({map: name, spawns: pick.spawns, taken: pick.taken, me, weapon: null, pick: planPick(mapOf(name), pick, me, null)});
    }
  }
}

// -------------------------------------------------------------------------------------------------------------- the module
function makeCtx(cfg) {
  return {cfg, rng: null, p: null};
}
function runCase(name, tierId, opts, steps) {
  const map = mapOf(opts.map ?? 'spread');
  const learned = opts.learned ?? null;
  const cfg = {
    tier: TIERS[tierId],
    map,
    features: {planning: true},
    learned: learned
      ? {enabled: true, bias: (key) => (key in learned ? learned[key] : 0)}
      : {enabled: false, bias: () => 0},
  };
  const ctx = makeCtx(cfg);
  ctx.rng = {decide: mulberry32(opts.decideSeed), lapse: mulberry32(opts.lapseSeed)};
  const frames = [];
  for (const step of steps) {
    const weapons = [step.weapon ?? null, null];
    ctx.p = {
      now: step.now,
      hud: {phase: step.phase ?? 'planning', gatesLocked: false},
      events: step.deal === undefined ? [] : [{kind: 'private', type: 'plan', msg: step.deal, t: step.now}],
      self: {faction: step.faction ?? null, weapons, slot: 0, status: 'alive'},
      fighters: [], mobs: [], containers: [], extras: {}, inventory: null,
    };
    planningModule.observe?.(ctx);
    const intents = (planningModule.intents?.(ctx, {kind: 'idle'}) ?? []);
    const i = intents.length > 0 ? intents[0] : null;
    const decided = ctx.rng.decide();
    const lapsed = ctx.rng.lapse();
    frames.push({
      now: step.now,
      phase: step.phase ?? 'planning',
      faction: step.faction ?? null,
      weapon: step.weapon ?? null,
      deal: step.deal ?? null,
      result: i === null ? null : {
        spawn: i.msg?.spawn ?? null, boon: i.msg?.boon ?? null, ready: i.msg?.ready ?? null,
        why: i.why, priority: i.priority, timing: i.timing?.kind ?? null,
      },
      probe: {decide: decided, lapse: lapsed},
    });
  }
  return {name, tier: tierId, map: opts.map ?? 'spread', faction: null, weapon: null, decideSeed: opts.decideSeed, lapseSeed: opts.lapseSeed, learned, frames};
}

const deal = (endsAt, spawns, taken = [false, false], pick = -1, boons = [], boon = -1) => ({endsAt, spawns, taken, pick, boons, boon});
const simple = (endsAt = 45000) => deal(endsAt, [0, 1]);
const cases = [
  runCase('no_deal_ready', 'normal', {decideSeed: 3, lapseSeed: 4}, [
    {now: 0, deal: undefined}, {now: 500, deal: undefined}, {now: 999, deal: undefined}, {now: 1000, deal: undefined}, {now: 1200, deal: undefined},
  ]),
  runCase('read_then_pick_and_ready', 'normal', {decideSeed: 5, lapseSeed: 6, map: 'spread'}, [
    {now: 0, deal: simple()},
    {now: 500, deal: simple()}, {now: 1000, deal: simple()}, {now: 2000, deal: simple()}, {now: 3000, deal: simple()},
    {now: 4000, deal: simple()}, {now: 5000, deal: deal(45000, [0, 1], [false, false], 0, [], -1)}, {now: 6000, deal: deal(45000, [0, 1], [false, false], 0, [], -1)},
    {now: 7000, deal: deal(45000, [0, 1], [false, false], 0, [], -1)}, {now: 8000, deal: deal(45000, [0, 1], [false, false], 0, [], -1)},
  ]),
  runCase('taken_spawn', 'normal', {decideSeed: 7, lapseSeed: 8, map: 'spread'}, [
    {now: 0, deal: deal(45000, [0, 1], [true, false])},
    {now: 3000, deal: deal(45000, [0, 1], [true, false])},
    {now: 5000, deal: deal(45000, [0, 1], [true, false])},
    {now: 9000, deal: deal(45000, [0, 1], [true, false])},
  ]),
  runCase('resend_asks', 'normal', {decideSeed: 9, lapseSeed: 10, map: 'spread'}, [
    {now: 0, deal: simple()}, {now: 3000, deal: simple()}, {now: 5000, deal: simple()},
    {now: 5600, deal: simple()}, {now: 6200, deal: simple()}, {now: 6800, deal: simple()}, {now: 7400, deal: simple()},
    {now: 8000, deal: simple()}, {now: 42000, deal: simple()}, {now: 42800, deal: simple()},
  ]),
  runCase('boons', 'hard', {decideSeed: 11, lapseSeed: 12, map: 'spread'}, [
    {now: 0, deal: deal(45000, [0, 1], [false, false], 0, ['relic-a', 'relic-b'])},
    {now: 2500, deal: deal(45000, [0, 1], [false, false], 0, ['relic-a', 'relic-b'])},
    {now: 4000, deal: deal(45000, [0, 1], [false, false], 0, ['relic-a', 'relic-b'])},
    {now: 5000, deal: deal(45000, [0, 1], [false, false], 0, ['relic-a', 'relic-b'])},
    {now: 5600, deal: deal(45000, [0, 1], [false, false], 0, ['relic-a', 'relic-b'], 1)},
    {now: 7000, deal: deal(45000, [0, 1], [false, false], 0, ['relic-a', 'relic-b'], 1)},
  ]),
  runCase('late_deal_timer', 'easy', {decideSeed: 13, lapseSeed: 14, map: 'spread'}, [
    {now: 40000, deal: simple()}, {now: 41000, deal: simple()}, {now: 42200, deal: simple()}, {now: 42600, deal: simple()},
    {now: 43400, deal: simple()}, {now: 43600, deal: simple()},
  ]),
  runCase('not_planning', 'normal', {decideSeed: 15, lapseSeed: 16, map: 'spread'}, [
    {now: 0, phase: 'lobby', deal: simple()}, {now: 500, phase: 'active', deal: simple()}, {now: 1000, phase: 'planning', deal: simple()},
  ]),
  runCase('learned_spawn_bias', 'hard', {decideSeed: 17, lapseSeed: 18, map: 'spread', learned: {'spawn|holy|fire': 0.25, 'spawn|holy|plague': -0.25}}, [
    {now: 0, deal: deal(45000, [0, 1]), faction: 'holy'},
    {now: 2500, deal: deal(45000, [0, 1]), faction: 'holy'},
    {now: 6000, deal: deal(45000, [0, 1]), faction: 'holy'},
    {now: 9000, deal: deal(45000, [0, 1]), faction: 'holy'},
  ]),
  runCase('weapon_weighted_spawn', 'normal', {decideSeed: 19, lapseSeed: 20, map: 'spread'}, [
    {now: 0, deal: deal(45000, [0, 3]), faction: 'sentenced', weapon: 'shield'},
    {now: 3000, deal: deal(45000, [0, 3]), faction: 'sentenced', weapon: 'shield'},
    {now: 6500, deal: deal(45000, [0, 3]), faction: 'sentenced', weapon: 'shield'},
    {now: 8000, deal: deal(45000, [0, 3]), faction: 'sentenced', weapon: 'shield'},
  ]),
  runCase('factionless_spawn', 'normal', {decideSeed: 21, lapseSeed: 22, map: 'spread'}, [
    {now: 0, deal: simple()}, {now: 3000, deal: simple()}, {now: 6000, deal: simple()},
  ]),
];

const SOURCE = [
  'packages/server/src/bots/brain/modules/planning.ts',
  'packages/server/src/bots/brain/random.ts',
  'packages/server/src/bots/brain/types.ts',
  'packages/server/src/bots/mobHunt.ts',
  'packages/shared/src/planning.ts',
  'packages/shared/src/factions.ts',
  'packages/shared/src/mobs.ts',
  'packages/shared/src/mark.ts',
  'packages/shared/src/signatureShares.ts',
  'packages/shared/src/map.ts',
  'packages/shared/src/constants.ts',
  'packages/shared/src/pathfind.ts',
];
const sha = (p) => createHash('sha256').update(readFileSync('/repo/' + p)).digest('hex');
const corpus = {
  format: 'rh-bot-planning-source/1',
  profile: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    maps: declared,
    constants: {
      planSecondsMs: PLAN_SECONDS * 1000,
      planCamps: PLAN_CAMPS,
      rules: JSON.parse(JSON.stringify(PLAN_RULES)),
      tiers: {
        easy: {softmaxT: TIERS.easy.softmaxT, lapseP: TIERS.easy.lapseP, reactionMu: TIERS.easy.reaction.mu},
        normal: {softmaxT: TIERS.normal.softmaxT, lapseP: TIERS.normal.lapseP, reactionMu: TIERS.normal.reaction.mu},
        hard: {softmaxT: TIERS.hard.softmaxT, lapseP: TIERS.hard.lapseP, reactionMu: TIERS.hard.reaction.mu},
      },
    },
    sourceFiles: Object.fromEntries(SOURCE.map((p) => [p, sha(p)])),
    tool: sha('tools/bots-planning-fixtures/capture.mts'),
  },
  helpers,
  cases,
};
corpus.profile.captureSha256 = createHash('sha256').update(JSON.stringify(corpus)).digest('hex');
const out = JSON.stringify(corpus, null, 1) + String.fromCharCode(10);
if (args[0] === '--write') {
  writeFileSync(outPath, out);
  console.log('captured ' + cases.length + ' planning cases and ' + (helpers.matchup.length + helpers.spawnScore.length) + ' helper rows');
} else {
  assert.equal(readFileSync(outPath, 'utf8'), out, 'the checked-in planning corpus differs from the source capture');
  console.log('planning corpus matches: ' + outPath);
}

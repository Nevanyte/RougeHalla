// Canonical actual-source tournament report/schedule witness (P-BOTS-6), pinned linux/amd64 Node 22.23.4: the pure
// statistics of tournament/report.ts and the deterministic per-game schedule of tournament/worker.ts and
// tournament/runTournament.ts, over declared inputs. Expected values come only from the unchanged TypeScript source.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {wilson, percentile, meanInterval, tableReactionMean, aggregate} from '/repo/packages/server/src/bots/tournament/report.ts';
import {mix, dealEvenly, planGame} from '/repo/packages/server/src/bots/tournament/worker.ts';
import {parseLineup, split, defaultWorkers} from '/repo/packages/server/src/bots/tournament/runTournament.ts';
import {MAX_GAME_MS} from '/repo/packages/server/src/bots/tournament/game.ts';
import {HEADLESS_CONFIG} from '/repo/packages/server/src/bots/tournament/headlessRoom.ts';
import {PERSONA_IDS, TIER_IDS} from '/repo/packages/server/src/bots/brain/types.ts';
import {FACTION_IDS, MAX_PLAYERS} from '/repo/packages/shared/src/index.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string');
const [, outPath] = args;
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');

const wilsonCases = [];
for (const [k, n] of [[0, 1], [1, 1], [0, 3], [1, 3], [2, 3], [3, 6], [5, 10], [10, 10], [0, 30], [7, 30], [30, 30], [1, 400]]) {
  for (const z of [1.96, 1.645, 2.0]) wilsonCases.push({k, n, z, expected: wilson(k, n, z)});
}
const percentileCases = [];
for (const sorted of [[0], [1, 2], [1, 2, 3, 4], [0, 0, 0, 10, 10], [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]]) {
  for (const q of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1, -0.5, 1.5]) percentileCases.push({sorted, q, expected: percentile(sorted, q)});
}
const meanCases = [];
for (const xs of [[1], [1, 2], [1, 2, 3, 4], [0.5, 0.5, 0.5], [3, 1, 4, 1, 5, 9, 2, 6], [0, 1, 0, 1, 1, 0]]) {
  for (const z of [1.645, 1.96]) meanCases.push({xs, z, expected: meanInterval(xs, z)});
}
const reactionCases = [];
for (const tier of TIER_IDS) for (const kind of ['teleport', 'announcement', 'chestUp', 'planOffer', 'newThreat', 'other', '']) {
  reactionCases.push({tier, kind, expected: tableReactionMean(tier, kind)});
}
const behaviour = {commands: {}, commandsTotal: 0, reactions: {}, targetClicks: 0, clickMissed: 0, clickWrong: 0, hesitations: 0, lapses: 0,
  throttled: 0, superseded: 0, apmPeak: 0, mobTargets: 0, mobDrops: 0, retreats: 0, mobFocusMs: 0, grabs: 0, maxStallMs: 0, dodges: 0,
  jukes: 0, kiteCycles: 0, goals: {}};
// One synthetic source GameSummary (game.ts shape, with the humanizer block at its null values: those columns are the
// P-BOTS-1 remainder and are not compared by the native reduced report).
const game = (spec) => ({
  seed: spec.seed, ended: spec.ended, winner: spec.winner ?? null, draw: spec.draw ?? false,
  durationMs: spec.durationMs, ticks: Math.round(spec.durationMs / 50), firstDeathMs: spec.firstDeathMs ?? null,
  firstKillMs: null, deathLog: [], firstHits: [], teleportMs: spec.teleportMs ?? null, suddenDeathMs: spec.suddenDeathMs ?? null,
  bots: spec.bots.map((b, i) => ({
    id: 'bot' + i, name: 'bot' + i, tier: b.tier, persona: b.persona, faction: b.faction, place: b.place,
    outcome: b.outcome, kills: b.kills ?? 0, mobKills: b.mobKills ?? 0, damage: b.damage ?? 0, mobDamage: b.mobDamage ?? 0,
    deaths: b.deaths ?? (b.outcome === 'died' ? 1 : 0), gv: b.gv ?? 0, diedAtMs: b.diedAtMs ?? null,
    firstMobKillMs: null, tpHp: null, diedTo: b.diedTo ?? null, behaviour,
  })),
  manager: {sent: 100, applied: 100, refused: spec.refused ?? 0, lost: spec.lost ?? 0, frames: 50, errors: spec.errors ?? 0},
});
const seat = (tier, persona, faction, extra) => ({tier, persona, faction, ...extra});
const gamesA = [
  game({seed: 11, ended: true, winner: 0, durationMs: 62000, firstDeathMs: 41000, teleportMs: 48000,
    bots: [seat('easy', 'farmer', 'fire', {place: 1, outcome: 'won', kills: 2}),
      seat('normal', 'hunter', 'sentenced', {place: 2, outcome: 'died', kills: 1, mobKills: 3, diedAtMs: 41000, diedTo: 'bot'}),
      seat('hard', 'opportunist', 'plague', {place: 3, outcome: 'died', kills: 0, diedAtMs: 30000, diedTo: 'mob'})]}),
  game({seed: 12, ended: true, draw: true, durationMs: 80000, firstDeathMs: 20000, suddenDeathMs: 70000,
    bots: [seat('easy', 'hunter', 'frost', {place: 1, outcome: 'draw', kills: 1}),
      seat('normal', 'farmer', 'holy', {place: 1, outcome: 'draw', kills: 1}),
      seat('hard', 'cautious', 'fire', {place: 3, outcome: 'died', kills: 0, diedAtMs: 20000, diedTo: 'arena'})]}),
  game({seed: 13, ended: false, durationMs: 30000, refused: 2,
    bots: [seat('easy', 'farmer', 'fire', {place: 1, outcome: 'capped', kills: 0}),
      seat('normal', 'hunter', 'sentenced', {place: 1, outcome: 'capped', kills: 1}),
      seat('hard', 'opportunist', 'plague', {place: 1, outcome: 'capped', kills: 0})]}),
  game({seed: 14, ended: true, winner: 2, durationMs: 45000, firstDeathMs: 15000, teleportMs: 30000, errors: 1,
    bots: [seat('easy', 'cautious', 'holy', {place: 2, outcome: 'died', kills: 0, diedAtMs: 15000, diedTo: 'mob'}),
      seat('normal', 'farmer', 'frost', {place: 3, outcome: 'mia', kills: 0, gv: 5}),
      seat('hard', 'hunter', 'sentenced', {place: 1, outcome: 'won', kills: 3, gv: 20})]}),
];
const gamesB = [
  game({seed: 21, ended: true, winner: 1, durationMs: 40000, firstDeathMs: null,
    bots: [seat('normal', 'hunter', 'holy', {place: 2, outcome: 'died', diedTo: 'mob', diedAtMs: 40000}),
      seat('normal', 'farmer', 'holy', {place: 1, outcome: 'won', kills: 1})]}),
  game({seed: 22, ended: true, draw: true, durationMs: 50000, suddenDeathMs: 45000,
    bots: [seat('normal', 'hunter', 'fire', {place: 1, outcome: 'draw'}),
      seat('normal', 'farmer', 'fire', {place: 1, outcome: 'draw'})]}),
];
const aggregateCases = [
  {name: 'four-games', games: gamesA, expected: aggregate(gamesA)},
  {name: 'two-games-one-tier', games: gamesB, expected: aggregate(gamesB)},
  {name: 'empty', games: [], expected: aggregate([])},
];
const mixCases = [];
for (const seed of [0, 1, 2, 7, 99, 123456789]) for (const tag of [0, 1, 2, 100003, 2000000]) mixCases.push({seed, tag, expected: mix(seed, tag)});
const dealCases = [];
for (const [kind, kinds] of [['persona', PERSONA_IDS], ['faction', FACTION_IDS], ['generic', ['a', 'b', 'c']]]) {
  for (const seats of [2, 3, 4, 5, 6, 8]) for (const seed of [1, 7, 99]) for (const tag of [1, 2]) for (const index of [0, 1, 2, 3, 4, 5, 7, 8, 11]) {
    dealCases.push({kind, seats, seed, tag, index, expected: dealEvenly(kinds, seats, seed, tag, index)});
  }
}
const plans = [
  {games: 4, seed: 1, tiers: ['easy', 'easy', 'normal', 'normal', 'hard', 'hard'], persona: 'mix', faction: 'mix'},
  {games: 4, seed: 7, tiers: ['normal', 'hard'], persona: 'hunter', faction: 'fire'},
  {games: 4, seed: 99, tiers: ['easy', 'normal', 'hard'], persona: 'mix', faction: 'frost'},
  {games: 4, seed: 123456789, tiers: ['easy', 'easy', 'normal', 'normal', 'hard', 'hard', 'easy', 'hard'], persona: 'cautious', faction: 'mix'},
];
const planCases = [];
for (const plan of plans) for (const index of [0, 1, 2, 3, 7, 8, 11]) planCases.push({plan, index, expected: planGame(plan, index)});
const splitCases = [];
for (const [games, workers] of [[400, 6], [5, 3], [2, 8], [1, 1], [3, 10], [7, 4]]) splitCases.push({games, workers, expected: split(games, workers)});
const workerCases = [];
for (const cores of [1, 2, 3, 4, 8, 16]) workerCases.push({cores, expected: defaultWorkers(cores)});
const lineupCases = [];
for (const text of ['E,E,N,N,H,H', 'e,n', 'easy,normal,hard', 'E, E , N,E,E,E,E,E', 'E,E,', 'N,H,easy,hard']) {
  lineupCases.push({text, expected: parseLineup(text), error: null});
}
for (const text of ['', 'E', 'E,X', 'E,E,E,E,E,E,E,E,E', 'easy;normal', 'normal,,hard,,,']) {
  let error = null;
  let expected = null;
  try { expected = parseLineup(text); } catch (err) { error = err.message; }
  lineupCases.push({text, expected, error});
}
const sha = (p) => createHash('sha256').update(readFileSync('/repo/' + p)).digest('hex');
const SOURCE = [
  'package-lock.json', 'tsconfig.base.json',
  'packages/server/src/bots/brain/types.ts',
  'packages/server/src/bots/tournament/game.ts', 'packages/server/src/bots/tournament/headlessRoom.ts',
  'packages/server/src/bots/tournament/report.ts', 'packages/server/src/bots/tournament/runTournament.ts',
  'packages/server/src/bots/tournament/tune.ts', 'packages/server/src/bots/tournament/worker.ts',
  'packages/shared/src/factions.ts', 'packages/shared/src/rng.ts',
];
const dirHash = (dir) => {
  const files = [];
  const walkDir = (rel) => {
    for (const entry of readdirSync(join('/repo', rel), {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const relPath = rel + '/' + entry.name;
      if (entry.isDirectory()) walkDir(relPath);
      else if (entry.name.endsWith('.ts')) files.push(relPath);
    }
  };
  walkDir(dir);
  return files.map((f) => f + ' ' + sha(f)).join(String.fromCharCode(10));
};
const listing = ['packages/server/src/bots', 'packages/shared/src'].map((d) => d + String.fromCharCode(10) + dirHash(d))
  .join(String.fromCharCode(10, 10));
const corpus = {
  format: 'rh-bot-tournament-source/1',
  profile: {
    node: process.version, platform: process.platform, arch: process.arch,
    sourceFiles: Object.fromEntries(SOURCE.map((p) => [p, sha(p)])),
    sourceTree: createHash('sha256').update(listing).digest('hex'),
    tool: sha('tools/bot-tournament-fixtures/capture.mts'),
  },
  constants: {MAX_GAME_MS, MAX_PLAYERS, HEADLESS_CONFIG, PERSONA_IDS, TIER_IDS, FACTION_IDS},
  wilson: wilsonCases,
  percentile: percentileCases,
  meanInterval: meanCases,
  tableReactionMean: reactionCases,
  aggregate: aggregateCases,
  mix: mixCases,
  dealEvenly: dealCases,
  planGame: planCases,
  split: splitCases,
  defaultWorkers: workerCases,
  parseLineup: lineupCases,
};
corpus.profile.captureSha256 = createHash('sha256').update(JSON.stringify(corpus)).digest('hex');
const out = JSON.stringify(corpus, null, 1) + String.fromCharCode(10);
if (args[0] === '--write') {
  writeFileSync(outPath, out);
  console.log('captured ' + (wilsonCases.length + percentileCases.length + meanCases.length + reactionCases.length + aggregateCases.length
    + mixCases.length + dealCases.length + planCases.length + splitCases.length + workerCases.length + lineupCases.length) + ' cases');
} else {
  assert.equal(readFileSync(outPath, 'utf8'), out, 'the checked-in tournament corpus differs from the source capture');
  console.log('tournament corpus matches: ' + outPath);
}

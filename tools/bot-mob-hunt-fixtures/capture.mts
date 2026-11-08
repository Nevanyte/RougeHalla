// Canonical actual-source bot mob-hunt/build-route pure witness (P-BOTS-4), pinned linux/amd64 Node 22.23.4.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {PLAYER_RADIUS, TILE} from '/repo/packages/shared/src/constants.ts';
import {mapFromTiles} from '/repo/packages/shared/src/map.ts';
import {segmentClear} from '/repo/packages/shared/src/geometry.ts';
import {weaponEdge} from '/repo/packages/shared/src/weapons.ts';
import {MOB_TYPES} from '/repo/packages/shared/src/mobs.ts';
import {
  MOB_HUNT, mobWeapon, useless, bestEdge, bestSlotVsMob, retreatPoint,
} from '/repo/packages/server/src/bots/mobHunt.ts';
import {huntConfigFor, wantsMobs, NO_MOB_IN_REACH} from '/repo/packages/server/src/bots/brain/huntAdapter.ts';
import * as buildRoute from '/repo/packages/server/src/bots/brain/buildRoute.ts';
import {TIERS, PERSONAS} from '/repo/packages/server/src/bots/brain/types.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string');
const [, outPath] = args;
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const WEAPONS = ['sword', 'bow', 'wand', 'shield', 'axe', 'fists'];
const FACTIONS = ['fire', 'sentenced', 'plague', 'frost', 'holy'];
const P = (x, y) => ({x, y});
const point = (p) => (p === null ? null : {x: r6(p.x), y: r6(p.y)});

// The declared retreat map: a border, one vertical and one horizontal internal wall, and an enclosed one-tile cell.
const w = 16;
const h = 12;
const tiles = new Uint8Array(w * h);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) tiles[y * w + x] = x === 0 || y === 0 || x === w - 1 || y === h - 1 ? 1 : 0;
}
for (let y = 2; y <= 9; y++) tiles[y * w + 8] = 1;
for (let x = 1; x <= 7; x++) tiles[6 * w + x] = 1;
for (const [x, y] of [[1, 2], [3, 2], [2, 1], [2, 3]]) tiles[y * w + x] = 1;
const map = mapFromTiles(w, h, tiles, 0);
const walkable = (a, b) => segmentClear(map, a, b, PLAYER_RADIUS);
const retreatPoints = [];
const retreat = (name, self, threats) =>
  retreatPoints.push({name, self, threats, expected: point(retreatPoint(self, threats, walkable))});
retreat('open-no-threats', P(176, 112), []);
retreat('open-one-threat', P(176, 112), [P(300, 112)]);
retreat('open-three-threats', P(176, 112), [P(150, 100), P(240, 150), P(200, 60)]);
retreat('corner', P(48, 48), [P(200, 200)]);
retreat('beside-internal-wall', P(224, 336), [P(100, 336)]);
retreat('right-region', P(400, 112), [P(300, 160), P(360, 220)]);
retreat('long-step-blocked-short-used', P(240, 256), [P(300, 256)]);
retreat('enclosed-cell-null', P(80, 80), [P(300, 300)]);
retreat('inside-wall-null', P(272, 208), [P(100, 100)]);

const weaponEdgeCases = [];
for (const a of WEAPONS) for (const b of WEAPONS) weaponEdgeCases.push({a, b, expected: weaponEdge(a, b)});

const uselessCases = [];
for (const mine of WEAPONS) for (const theirs of WEAPONS) uselessCases.push({mine, theirs, expected: useless(mine, theirs)});

const weaponSets = [
  [null, null], ['sword', null], ['bow', null], ['shield', null], ['axe', 'wand'], ['sword', 'shield'],
  ['bow', 'wand'], ['shield', 'wand'], ['wand', 'axe'], ['axe', 'shield'], ['bow', 'bow'], ['fists', null],
  ['axe', 'axe'],
];
const bestEdgeCases = [];
for (const weapons of weaponSets) for (const theirs of WEAPONS) bestEdgeCases.push({weapons, theirs, expected: bestEdge(weapons, theirs)});

const slotSets = [[null, null], ['sword', 'axe'], ['sword', 'shield'], [null, 'wand'], ['bow', 'shield'], ['axe', null], ['fists', null], ['shield', 'bow']];
const bestSlotCases = [];
for (const slots of slotSets) for (const current of [0, 1]) for (const theirs of [null, ...WEAPONS]) {
  bestSlotCases.push({slots, current, theirs, expected: bestSlotVsMob(slots, current, theirs)});
}

const mobWeaponCases = [];
for (const weapon0 of [...WEAPONS, '', 'bogus']) for (const faction of [...FACTIONS, '', 'coliseum', 'bogus']) {
  mobWeaponCases.push({weapon0, faction, expected: mobWeapon({weapon0, faction})});
}

const huntConfigs = [];
for (const tier of Object.values(TIERS)) for (const persona of Object.values(PERSONAS)) {
  huntConfigs.push({tier: tier.id, persona: persona.id, config: huntConfigFor({tier, persona})});
}

const decisions = [
  {kind: 'player', why: NO_MOB_IN_REACH},
  {kind: 'player', why: 'a player is close'},
  {kind: 'player', why: 'coliseum'},
  {kind: 'player', why: 'mob time budget spent'},
  {kind: 'mob', id: 'm1', why: 'fire mob with axe'},
  {kind: 'retreat', from: [P(10, 20), P(30, 40)], why: 'low hp'},
];
const decisionCases = decisions.map((decision) => ({decision, expected: wantsMobs(decision)}));

const buildGoals = FACTIONS.map((faction) =>
  buildRoute.BUILD_GOALS[faction].map((g) => ({id: g.id, name: g.name, weights: {...g.weights}})));

const buildConstants = {
  STAT_FLOOR: buildRoute.STAT_FLOOR,
  ROUTE_STEPS: buildRoute.ROUTE_STEPS,
  MAX_WAIT_MS: buildRoute.MAX_WAIT_MS,
  CLEAR_MS_PER_MOB: buildRoute.CLEAR_MS_PER_MOB,
  CLEAR_MS_ELITE: buildRoute.CLEAR_MS_ELITE,
  ELITE_VALUE: buildRoute.ELITE_VALUE,
  ELITE_AFTER_MS: buildRoute.ELITE_AFTER_MS,
  ELITE_MIN_KILLS: buildRoute.ELITE_MIN_KILLS,
  ELITE_EARLY_POWER: buildRoute.ELITE_EARLY_POWER,
  CONTEST_MS: buildRoute.CONTEST_MS,
  ZONE_CONTESTS: buildRoute.ZONE_CONTESTS,
  ZONE_MEMORY_MS: buildRoute.ZONE_MEMORY_MS,
  ZONE_AVOID_MS: buildRoute.ZONE_AVOID_MS,
  CONTEST_PLAYER_RANGE: buildRoute.CONTEST_PLAYER_RANGE,
  OWN_FIGHT_SLACK: buildRoute.OWN_FIGHT_SLACK,
  WALK_FACTOR: buildRoute.WALK_FACTOR,
  REPLAN_MS: buildRoute.REPLAN_MS,
};

const builds = [];
for (const faction of FACTIONS) for (const draw of [0, 0.2]) builds.push({faction, draw, build: buildRoute.buildOf(faction, draw)});
const buildOfCases = [];
for (const faction of FACTIONS) for (const draw of [0, 0.499999999999, 0.5, 0.999999999]) {
  buildOfCases.push({faction, draw, expected: buildRoute.buildOf(faction, draw).id});
}
const TYPES = [...MOB_TYPES.map((t) => t.id), '', 'bogus'];
const typeWeightCases = [];
for (const {faction, draw, build} of builds) for (const type of TYPES) {
  typeWeightCases.push({faction, draw, type, expected: buildRoute.typeWeight(build, type || undefined)});
}

const readyForElitesCases = [];
for (const runMs of [0, 359999.999, 360000, 360000.001, 720000]) {
  for (const mobKills of [0, 11, 12, 13]) {
    for (const power of [0, 5.999999, 6, 6.1]) {
      readyForElitesCases.push({runMs, mobKills, power, expected: buildRoute.readyForElites({runMs, mobKills, power})});
    }
  }
}

const camps = [
  {index: 0, id: 'fire-1', zone: 'fire', x: 120, y: 120, r: 96, elite: false, spots: 3, type: 'emberImp', alive: 3, state: 0, respawnAt: 0},
  {index: 1, id: 'fire-1', zone: 'fire', x: 120, y: 120, r: 96, elite: false, spots: 3, type: 'cinderHound', alive: 1, state: 1, respawnAt: 0},
  {index: 2, id: 'plague-1', zone: 'plague', x: 400, y: 200, r: 96, elite: false, spots: 4, type: 'plagueRat', alive: 0, state: 2, respawnAt: 30000},
  {index: 3, id: 'holy-1', zone: 'holy', x: 700, y: 300, r: 96, elite: false, spots: 2, type: 'bailiff', alive: 2, state: 1, respawnAt: 0},
  {index: 4, id: 'frost-1', zone: 'frost', x: 200, y: 600, r: 96, elite: false, spots: 3, type: '', alive: 2, state: 1, respawnAt: 0},
  {index: 5, id: 'frost-2', zone: 'frost', x: 220, y: 620, r: 96, elite: true, spots: 1, type: 'glacialWarden', alive: 1, state: 1, respawnAt: 0},
  {index: 6, id: 'sentenced-1', zone: 'sentenced', x: 600, y: 500, r: 96, elite: true, spots: 1, type: 'executioner', alive: 0, state: 2, respawnAt: 10000},
  {index: 7, id: 'sentenced-2', zone: 'sentenced', x: 620, y: 520, r: 96, elite: true, spots: 1, type: '', alive: 0, state: 0, respawnAt: 0},
  {index: 8, id: 'holy-2', zone: 'holy', x: 720, y: 320, r: 96, elite: true, spots: 1, type: 'archon', alive: 1, state: 1, respawnAt: 0},
  {index: 9, id: 'fire-2', zone: 'fire', x: 140, y: 140, r: 96, elite: false, spots: 3, type: 'flameCaller', alive: 3, state: 1, respawnAt: 0},
];
// campValue is a method of the source BuildRoute; the instance is stateless for this call (the planner itself is the
// documented P-BOTS-4 remainder), so constructing it for the pure answer is the actual source call.
const campValue = (build, camp, elites) => new buildRoute.BuildRoute(build).campValue(camp, elites);
const campValueCases = [];
for (const {faction, draw, build} of builds) for (const camp of camps) for (const elites of [false, true]) {
  campValueCases.push({faction, draw, camp, elites, expected: campValue(build, camp, elites)});
}

const sha = (p) => createHash('sha256').update(readFileSync('/repo/' + p)).digest('hex');
const SOURCE = [
  'package-lock.json', 'tsconfig.base.json',
  'packages/server/src/bots/brain/buildRoute.ts', 'packages/server/src/bots/brain/huntAdapter.ts',
  'packages/server/src/bots/brain/types.ts', 'packages/server/src/bots/mobHunt.ts',
  'packages/shared/src/constants.ts', 'packages/shared/src/factions.ts', 'packages/shared/src/geometry.ts',
  'packages/shared/src/map.ts', 'packages/shared/src/mobStats.ts', 'packages/shared/src/mobs.ts',
  'packages/shared/src/weapons.ts',
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
const listing = ['packages/shared/src', 'packages/server/src/bots'].map((d) => d + String.fromCharCode(10) + dirHash(d))
  .join(String.fromCharCode(10, 10));
const corpus = {
  format: 'rh-bot-mob-hunt-source/1',
  profile: {
    node: process.version, platform: process.platform, arch: process.arch,
    constants: {TILE, PLAYER_RADIUS},
    map: {w: map.w, h: map.h, seed: 0, tiles: Array.from(map.tiles)},
    sourceFiles: Object.fromEntries(SOURCE.map((p) => [p, sha(p)])),
    sourceTree: createHash('sha256').update(listing).digest('hex'),
    tool: sha('tools/bot-mob-hunt-fixtures/capture.mts'),
  },
  mobHunt: {...MOB_HUNT},
  huntConfigs,
  weaponEdge: weaponEdgeCases,
  useless: uselessCases,
  bestEdge: bestEdgeCases,
  bestSlotVsMob: bestSlotCases,
  mobWeapon: mobWeaponCases,
  retreatPoints,
  decisions: decisionCases,
  buildGoals,
  buildConstants,
  buildOf: buildOfCases,
  typeWeight: typeWeightCases,
  readyForElites: readyForElitesCases,
  campValue: campValueCases,
};
corpus.profile.captureSha256 = createHash('sha256').update(JSON.stringify(corpus)).digest('hex');
const out = JSON.stringify(corpus, null, 1) + String.fromCharCode(10);
if (args[0] === '--write') {
  writeFileSync(outPath, out);
  console.log('captured ' + (huntConfigs.length + weaponEdgeCases.length + uselessCases.length + bestEdgeCases.length
    + bestSlotCases.length + mobWeaponCases.length + retreatPoints.length + decisionCases.length + buildOfCases.length
    + typeWeightCases.length + readyForElitesCases.length + campValueCases.length) + ' cases');
} else {
  assert.equal(readFileSync(outPath, 'utf8'), out, 'the checked-in mob-hunt corpus differs from the source capture');
  console.log('mob-hunt corpus matches: ' + outPath);
}

// Canonical actual-source fill-policy witness (P-BOTS-7), pinned linux/amd64 Node 22.23.4: the real BotManager's lobby
// behaviour (arrival schedule, squeeze, human joins, lobby closing top-up, yield seat, tier/persona/faction/name draws)
// over a real headless world, plus the exported constants, callsigns and the softmax draw. Expected values come only
// from the unchanged TypeScript source; inputs are declared seeds, timings and rosters.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {FACTION_IDS, MAX_PLAYERS, mulberry32, TICK_MS} from '/repo/packages/shared/src/index.ts';
import {BotManager} from '/repo/packages/server/src/bots/BotManager.ts';
import {CALLSIGN_POOL, botId, pickCallsign} from '/repo/packages/server/src/bots/callsigns.ts';
import {softmaxIndex} from '/repo/packages/server/src/bots/brain/random.ts';
import {
  BOT_FILL_DEFAULTS, BOT_PATH_BUDGET_PER_TICK, BOT_ID_PREFIX, LEARN,
} from '/repo/packages/server/src/bots/brain/types.ts';
import {createGameWorld} from '/repo/packages/server/src/sim/gameplay.ts';
import {addPlayer, step} from '/repo/packages/server/src/sim/step.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string');
const [, outPath] = args;
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');

const renderSpec = (s) => ({id: s.id, name: s.name, tier: s.tier, persona: s.persona, faction: s.faction, seed: s.seed >>> 0});
const render = (specs) => specs.map(renderSpec);

// Instrument the real manager's fill stream and the roster it saw at each draw: the trace makes the parity failure (if
// any) attributable to a draw or to the roster, and it is captured as data, not asserted from Rust.
const drawTrace = new Map();
const originalAddBot = BotManager.prototype.addBot;
BotManager.prototype.addBot = function patchedAddBot(over) {
  const draws = [];
  const previous = this.fillRng;
  this.fillRng = () => {
    const value = previous();
    draws.push(value);
    return value;
  };
  const preFactions = [...this.world.state.players.values()].map((p) => p.faction ?? null);
  try {
    const spec = originalAddBot.call(this, over);
    if (spec) drawTrace.set(spec.id, {draws, preFactions});
    return spec;
  } finally {
    this.fillRng = previous;
  }
};

function makeWorld(worldSeed, lobbySeconds, fillSeconds) {
  return createGameWorld({
    seed: worldSeed,
    config: {
      minPlayers: 2, lobbySeconds, fillSeconds, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 600,
    },
    random: mulberry32(worldSeed + 1),
  });
}

function runScenario(scenario) {
  const world = makeWorld(scenario.worldSeed, scenario.lobbySeconds, scenario.fillSeconds);
  let humanN = 0;
  const addHuman = (name) => {
    humanN += 1;
    addPlayer(world, 'h' + humanN, name);
  };
  for (const name of scenario.initialHumans) addHuman(name);
  // A player with no faction is given the source default (defaultFaction(joinIndex)); the fill counts what the state shows.
  const initialPlayers = [...world.state.players.values()].map((p) => ({name: p.name, faction: p.faction}));
  const cfg = {...BOT_FILL_DEFAULTS, fillTo: scenario.fillTo, arrivalSeconds: scenario.arrivalSeconds};
  const manager = new BotManager(world, cfg, {
    store: null, isNameTaken: () => false, seed: scenario.managerSeed, frameEveryTicks: 1,
  });
  const ticks = [];
  const arrivals = [];
  const ops = [];
  let prev = new Set(world.state.players.keys());
  let closedAt = null;
  for (let t = 0; t < scenario.limit; t++) {
    const phaseBefore = world.state.phase;
    ticks.push({now: world.state.serverTime, ends: world.state.lobbyEndsAt, humans: [...world.players.values()].filter((rt) => !rt.bot).length});
    for (const op of scenario.ops) {
      if (op.tick !== t) continue;
      if (op.op === 'human') {
        addHuman(op.name);
        const faction = world.state.players.get('h' + humanN).faction;
        ops.push({tick: t, op: 'human', name: op.name, faction});
      } else if (op.op === 'yield') {
        ops.push({tick: t, op: 'yield', result: manager.yieldSeat()});
      }
    }
    if (world.state.phase === 'lobby') manager.lobbyTick();
    step(world, TICK_MS);
    const added = [];
    for (const [id, p] of world.state.players) {
      if (!prev.has(id) && p.bot) {
        const spec = manager.specOf(id);
        assert(spec !== undefined, 'a new lobby player is a fill bot');
        added.push(spec.id + ' ' + spec.name + ' ' + spec.tier + ' ' + spec.persona + ' ' + spec.faction + ' ' + (spec.seed >>> 0));
      }
    }
    if (added.length > 0) {
      const trace = [...drawTrace.entries()]
        .filter(([id]) => added.some((line) => line.startsWith(id + ' ')))
        .map(([id, value]) => ({id, draws: value.draws, preFactions: value.preFactions}));
      arrivals.push({tick: t, specs: added, trace});
    }
    prev = new Set(world.state.players.keys());
    if (world.state.phase !== 'lobby' && phaseBefore === 'lobby') {
      closedAt = t;
      break;
    }
  }
  return {
    name: scenario.name,
    worldSeed: scenario.worldSeed,
    managerSeed: scenario.managerSeed,
    lobbySeconds: scenario.lobbySeconds,
    fillSeconds: scenario.fillSeconds,
    fillTo: scenario.fillTo,
    arrivalSeconds: scenario.arrivalSeconds,
    initialHumans: scenario.initialHumans,
    initialPlayers,
    ops: scenario.ops,
    ticks,
    arrivals,
    opsOut: ops,
    final: {
      closedAt,
      phase: world.state.phase,
      specs: render(manager.specs()),
      stats: {arrived: manager.stats.arrived, yielded: manager.stats.yielded},
    },
  };
}

const scenarios = [
  runScenario({name: 'arrival-schedule', worldSeed: 1234, managerSeed: 7, lobbySeconds: 30, fillSeconds: 5, fillTo: 4, arrivalSeconds: 12, initialHumans: ['human1'], ops: [], limit: 900}),
  runScenario({name: 'human-joins-squeeze', worldSeed: 99, managerSeed: 11, lobbySeconds: 30, fillSeconds: 0, fillTo: 6, arrivalSeconds: 20, initialHumans: ['human1'], ops: [{tick: 120, op: 'human', name: 'human2'}, {tick: 140, op: 'human', name: 'human3'}], limit: 900}),
  runScenario({name: 'yield-seat', worldSeed: 7, managerSeed: 3, lobbySeconds: 30, fillSeconds: 5, fillTo: 3, arrivalSeconds: 12, initialHumans: ['human1'], ops: [{tick: 500, op: 'yield'}, {tick: 501, op: 'yield'}], limit: 900}),
  runScenario({name: 'yield-order', worldSeed: 21, managerSeed: 17, lobbySeconds: 30, fillSeconds: 5, fillTo: 5, arrivalSeconds: 40, initialHumans: ['human1'], ops: [{tick: 560, op: 'yield'}, {tick: 561, op: 'yield'}], limit: 900}),
  runScenario({name: 'lobby-closing-top-up', worldSeed: 5, managerSeed: 5, lobbySeconds: 2, fillSeconds: 0, fillTo: 5, arrivalSeconds: 12, initialHumans: ['human1'], ops: [], limit: 200}),
  runScenario({name: 'countdown-squeeze', worldSeed: 77, managerSeed: 13, lobbySeconds: 30, fillSeconds: 5, fillTo: 6, arrivalSeconds: 40, initialHumans: ['human1'], ops: [{tick: 100, op: 'human', name: 'human2'}], limit: 900}),
  runScenario({name: 'no-humans-no-bots', worldSeed: 3, managerSeed: 9, lobbySeconds: 30, fillSeconds: 5, fillTo: 5, arrivalSeconds: 12, initialHumans: [], ops: [], limit: 120}),
];

const callsignCases = [];
const takenCases = [[], ['Wren', 'Kestrel_7', 'mossy'], ['wren', 'kestrel_7', 'MOSSY'], CALLSIGN_POOL.slice(0, 60), CALLSIGN_POOL, [...CALLSIGN_POOL, ...CALLSIGN_POOL.flatMap((n) => [n + '00', n + '01', n + '02'])] ];
for (const seed of [0, 1, 7, 99, 123456789]) {
  for (const [ti, taken] of takenCases.entries()) {
    const rng = mulberry32(seed >>> 0);
    callsignCases.push({seed, takenIndex: ti, expected: pickCallsign(rng, (name) => taken.includes(name) || taken.includes(name.toLowerCase()))});
  }
}
const allTaken = callsignCases.length;
const softmaxCases = [];
for (const [utilities, temperature] of [
  [[0, 0, 0, 0, 0], 0.3], [[0.1, 0, -0.05, 0.2, 0], 0.3], [[0.25, 0, 0.25, 0, 0.25], 0.3],
  [[1, 2, 3, 4, 5], 0.3], [[5, 4, 3, 2, 1], 0.3], [[0.2, 0.2, 0.2, 0.2, 0.2], 0.3], [[0, 1, 2], 0],
]) {
  for (const seed of [0, 4, 55, 777, 9001]) {
    softmaxCases.push({utilities, temperature, seed, expected: softmaxIndex(mulberry32(seed), utilities, temperature)});
  }
}
const sha = (p) => createHash('sha256').update(readFileSync('/repo/' + p)).digest('hex');
const SOURCE = [
  'packages/server/src/bots/BotManager.ts',
  'packages/server/src/bots/callsigns.ts',
  'packages/server/src/bots/brain/random.ts',
  'packages/server/src/bots/brain/types.ts',
  'packages/server/src/sim/gameplay.ts',
  'packages/server/src/sim/step.ts',
  'packages/server/src/sim/world.ts',
  'packages/shared/src/factions.ts',
  'packages/shared/src/rng.ts',
  'packages/shared/src/index.ts',
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
const listing = ['packages/server/src/bots', 'packages/server/src/sim', 'packages/shared/src']
  .map((d) => d + String.fromCharCode(10) + dirHash(d)).join(String.fromCharCode(10, 10));
const corpus = {
  format: 'rh-bot-fill-source/1',
  profile: {
    node: process.version, platform: process.platform, arch: process.arch,
    sourceFiles: Object.fromEntries(SOURCE.map((p) => [p, sha(p)])),
    sourceTree: createHash('sha256').update(listing).digest('hex'),
    tool: sha('tools/bot-fill-fixtures/capture.mts'),
  },
  constants: {
    BOT_FILL_DEFAULTS, BOT_ID_PREFIX, BOT_PATH_BUDGET_PER_TICK, LEARN_EXPLORE: LEARN.explore,
    CALLSIGN_POOL, FACTION_IDS, MAX_PLAYERS, TICK_MS,
  },
  callsigns: callsignCases,
  botIds: [0, 1, 2, 7, 42].map((n) => ({n, expected: botId(n)})),
  softmax: softmaxCases,
  scenarios,
};
corpus.profile.captureSha256 = createHash('sha256').update(JSON.stringify(corpus)).digest('hex');
const out = JSON.stringify(corpus, null, 1) + String.fromCharCode(10);
if (args[0] === '--write') {
  writeFileSync(outPath, out);
  console.log('captured ' + (scenarios.length + callsignCases.length + softmaxCases.length + 5) + ' cases, allTaken ' + allTaken);
} else {
  assert.equal(readFileSync(outPath, 'utf8'), out, 'the checked-in fill corpus differs from the source capture');
  console.log('fill corpus matches: ' + outPath);
}

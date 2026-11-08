// Canonical actual-source witness (P-BOTS-7 residual): the real BotManager.addBot override seam, pinned linux/amd64
// Node 22.23.4. The source addBot fixes what BotSeatOverrides names (tier, persona, faction, callsign) while still making
// every draw, so fixing one thing never reshuffles the rest. Scenarios drive the unchanged manager through a real
// headless world: explicit seats (addbot ops) mixed with the arrival schedule, the yield/seat sequence, the full-lobby
// null return, and a name that is profile-taken; a draw-control pair proves the all-draws-are-still-made invariant.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {FACTION_IDS, MAX_PLAYERS, mulberry32, TICK_MS} from '/repo/packages/shared/src/index.ts';
import {BotManager} from '/repo/packages/server/src/bots/BotManager.ts';
import {BOT_FILL_DEFAULTS, PERSONA_IDS, TIER_IDS} from '/repo/packages/server/src/bots/brain/types.ts';
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
  const initialPlayers = [...world.state.players.values()].map((p) => ({name: p.name, faction: p.faction}));
  const cfg = {...BOT_FILL_DEFAULTS, fillTo: scenario.fillTo, arrivalSeconds: scenario.arrivalSeconds};
  const takenNames = scenario.takenNames ?? [];
  const manager = new BotManager(world, cfg, {
    store: null,
    isNameTaken: (name) => takenNames.some((taken) => taken.toLowerCase() === name.toLowerCase()),
    seed: scenario.managerSeed,
    frameEveryTicks: 1,
  });
  const ticks = [];
  const arrivals = [];
  const opsOut = [];
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
        opsOut.push({tick: t, op: 'human', name: op.name, faction});
      } else if (op.op === 'yield') {
        opsOut.push({tick: t, op: 'yield', result: manager.yieldSeat()});
      } else if (op.op === 'addbot') {
        const spec = manager.addBot(op.over);
        opsOut.push({tick: t, op: 'addbot', over: op.over, result: spec === null ? null : renderSpec(spec)});
      } else {
        throw new Error('unknown op ' + op.op);
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
    takenNames,
    initialPlayers,
    ops: scenario.ops,
    ticks,
    arrivals,
    opsOut,
    final: {
      closedAt,
      phase: world.state.phase,
      specs: render(manager.specs()),
      stats: {arrived: manager.stats.arrived, yielded: manager.stats.yielded},
    },
  };
}

const scenarios = [
  // Six explicit seats: one field fixed per bot, then all four at once, then none (pure draws). The manager's roster is
  // empty (no humans, fillTo 0, so the arrival schedule stays out of it) and the lobby countdown stays clear of closure.
  runScenario({name: 'addbot-overrides', worldSeed: 1234, managerSeed: 7, lobbySeconds: 30, fillSeconds: 30, fillTo: 0, arrivalSeconds: 12, initialHumans: [], takenNames: [], ops: [
    {tick: 0, op: 'addbot', over: {tier: 'hard'}},
    {tick: 1, op: 'addbot', over: {persona: 'hunter'}},
    {tick: 2, op: 'addbot', over: {faction: 'frost'}},
    {tick: 3, op: 'addbot', over: {name: 'Chosen'}},
    {tick: 4, op: 'addbot', over: {tier: 'easy', persona: 'cautious', faction: 'holy', name: 'Full_Fix'}},
    {tick: 5, op: 'addbot', over: {}},
  ], limit: 7}),
  // The draw-control pair: identical seeds and roster as addbot-overrides, but every seat takes the empty override. Every
  // draw is made in both runs, so each bot's id, seed and NOT-overridden fields must be identical between the two.
  runScenario({name: 'addbot-draw-control', worldSeed: 1234, managerSeed: 7, lobbySeconds: 30, fillSeconds: 30, fillTo: 0, arrivalSeconds: 12, initialHumans: [], takenNames: [], ops: [
    {tick: 0, op: 'addbot', over: {}},
    {tick: 1, op: 'addbot', over: {}},
    {tick: 2, op: 'addbot', over: {}},
    {tick: 3, op: 'addbot', over: {}},
    {tick: 4, op: 'addbot', over: {}},
    {tick: 5, op: 'addbot', over: {}},
  ], limit: 7}),
  // The arrival schedule and the explicit seam share one id/fill stream: the explicit seats come first, the schedule only
  // draws the seats still missing (need = target - players), and a yield+explicit seat near the end keeps ids never reused.
  runScenario({name: 'addbot-arrivals', worldSeed: 555, managerSeed: 21, lobbySeconds: 30, fillSeconds: 5, fillTo: 5, arrivalSeconds: 40, initialHumans: ['human1'], takenNames: [], ops: [
    {tick: 0, op: 'addbot', over: {tier: 'hard', name: 'Fixed'}},
    {tick: 1, op: 'addbot', over: {faction: 'plague'}},
    {tick: 550, op: 'yield'},
    {tick: 551, op: 'addbot', over: {persona: 'farmer'}},
  ], limit: 900}),
  // A full lobby: the human plus seven explicit seats fill MAX_PLAYERS; the next addBot returns null before any draw or
  // id increment, then a yield and one more addBot take the next id (never reused).
  runScenario({name: 'addbot-full-null', worldSeed: 9, managerSeed: 31, lobbySeconds: 30, fillSeconds: 30, fillTo: 0, arrivalSeconds: 12, initialHumans: ['human1'], takenNames: [], ops: [
    {tick: 0, op: 'addbot', over: {}},
    {tick: 0, op: 'addbot', over: {}},
    {tick: 0, op: 'addbot', over: {}},
    {tick: 0, op: 'addbot', over: {}},
    {tick: 0, op: 'addbot', over: {}},
    {tick: 0, op: 'addbot', over: {}},
    {tick: 0, op: 'addbot', over: {}},
    {tick: 0, op: 'addbot', over: {}},
    {tick: 0, op: 'yield'},
    {tick: 0, op: 'addbot', over: {}},
  ], limit: 3}),
  // The override callsign is used literally even when a profile owns it; the following pure draws avoid it (the manager's
  // pickName checks the room and the profile seam), so the seam fixes a name without poisoning later draws.
  runScenario({name: 'addbot-name-taken', worldSeed: 77, managerSeed: 13, lobbySeconds: 30, fillSeconds: 30, fillTo: 0, arrivalSeconds: 12, initialHumans: ['human1'], takenNames: ['Wren', 'Kestrel_7'], ops: [
    {tick: 0, op: 'addbot', over: {name: 'Wren'}},
    {tick: 1, op: 'addbot', over: {}},
    {tick: 2, op: 'addbot', over: {}},
  ], limit: 5}),
];

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
  format: 'rh-bot-addbot-source/1',
  profile: {
    node: process.version, platform: process.platform, arch: process.arch,
    sourceFiles: Object.fromEntries(SOURCE.map((p) => [p, sha(p)])),
    sourceTree: createHash('sha256').update(listing).digest('hex'),
    tool: sha('tools/bot-addbot-fixtures/capture.mts'),
  },
  constants: {
    BOT_FILL_DEFAULTS, FACTION_IDS, MAX_PLAYERS, PERSONA_IDS, TIER_IDS, TICK_MS,
  },
  scenarios,
};
corpus.profile.captureSha256 = createHash('sha256').update(JSON.stringify(corpus)).digest('hex');
const out = JSON.stringify(corpus, null, 1) + String.fromCharCode(10);
if (args[0] === '--write') {
  writeFileSync(outPath, out);
  console.log('captured ' + scenarios.length + ' addBot scenarios');
} else {
  const existing = readFileSync(outPath, 'utf8');
  assert.equal(createHash('sha256').update(existing).digest('hex'), createHash('sha256').update(out).digest('hex'), 'the checked-in corpus is byte-identical');
  console.log('checked ' + scenarios.length + ' addBot scenarios');
}

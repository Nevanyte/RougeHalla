// Canonical actual-source Frost slow-resistance witnesses (P-FROST-RESISTANCE-1): the unmodified legacy sim
// (packages/server/src/sim/updateChill) driven through the EXISTING producers only. Cards arrive through the real
// grantCard producer (chests.ts, real stat folding); movement/engagement/attack are real enqueued client messages
// validated and submitted by the ordinary 50 ms step; trusted initial placement/seed/config are explicitly labelled.
// No expected chill/cooldown/movement value is injected into the world. Output is additive: parity/frost-resistance/.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {
  mapFromTiles, mulberry32, TICK_MS, TILE_FLOOR, TILE_WALL,
  type FactionId, type GameMap,
} from '/repo/packages/shared/src/index.ts';
import {createWorld} from '/repo/packages/server/src/sim/world.ts';
import {addPlayer, removePlayer, step} from '/repo/packages/server/src/sim/step.ts';
import {enqueueClientMessage} from '/repo/packages/server/src/sim/inputs.ts';
import {grantCard} from '/repo/packages/server/src/sim/chests.ts';
import {signatureState} from '/repo/packages/server/src/sim/factions.ts';
import {slowResistOf} from '/repo/packages/server/src/sim/mods.ts';
import {combatant} from '/repo/packages/server/src/sim/combatant.ts';
import {install as installLoot} from '/repo/packages/server/src/sim/loot.ts';
import {install as installWeapons} from '/repo/packages/server/src/sim/weapons.ts';
import {install as installTargeting} from '/repo/packages/server/src/sim/targeting.ts';
import {install as installProjectiles} from '/repo/packages/server/src/sim/projectiles.ts';
import {install as installFactions} from '/repo/packages/server/src/sim/factions.ts';
import {install as installMobs} from '/repo/packages/server/src/sim/mobs.ts';
import {install as installBuffs} from '/repo/packages/server/src/sim/buffs.ts';
import {install as installFeed} from '/repo/packages/server/src/sim/feed.ts';
import {install as installCamps} from '/repo/packages/server/src/sim/camps.ts';
import {install as installChests} from '/repo/packages/server/src/sim/chests.ts';
import {install as installKillAugments} from '/repo/packages/server/src/sim/killAugments.ts';
import {install as installMobLife} from '/repo/packages/server/src/sim/mobLife.ts';
import {install as installMobAI} from '/repo/packages/server/src/sim/mobAI.ts';
import {install as installTerrain} from '/repo/packages/server/src/sim/terrainEffects.ts';
import {install as installRegen} from '/repo/packages/server/src/sim/regen.ts';
import {install as installAbilities} from '/repo/packages/server/src/sim/abilities.ts';
import {install as installQuests} from '/repo/packages/server/src/sim/quests.ts';
import {install as installVision} from '/repo/packages/server/src/sim/vision.ts';
import {install as installCampHeal} from '/repo/packages/server/src/sim/campHeal.ts';
import {install as installTraders} from '/repo/packages/server/src/sim/traders.ts';
import {install as installCardHooks} from '/repo/packages/server/src/sim/cardHooks.ts';
import {install as installMods} from '/repo/packages/server/src/sim/mods.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check'));
const outPath = args[1]!;
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');

const IMAGE = 'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292';
const W = 60;
const H = 40;
const SEED = 12;
const ROWS: string[] = Array.from({length: H}, (_, y) => {
  if (y === 0 || y === H - 1) return '#'.repeat(W);
  return '#' + '.'.repeat(W - 2) + '#';
});
const MODULES: Array<(w: any) => void> = [
  installLoot, installWeapons, installTargeting, installProjectiles, installFactions, installMobs, installBuffs,
  installFeed, installCamps, installChests, installKillAugments, installMobLife, installMobAI, installTerrain,
  installRegen, installAbilities, installQuests, installVision, installCampHeal, installTraders, installCardHooks,
  installMods,
];
const SOURCE_FILES = [
  'packages/shared/src/index.ts', 'packages/shared/src/signatures.ts', 'packages/shared/src/constants.ts',
  'packages/shared/src/mods.ts', 'packages/server/src/sim/world.ts', 'packages/server/src/sim/gameplay.ts',
  'packages/server/src/sim/factions.ts', 'packages/server/src/sim/mods.ts', 'packages/server/src/sim/chests.ts',
  'packages/server/src/sim/step.ts', 'packages/server/src/sim/inputs.ts', 'packages/server/src/sim/status.ts',
  'packages/server/src/sim/weapons.ts', 'packages/server/src/sim/targeting.ts', 'packages/server/src/sim/projectiles.ts',
  'packages/server/src/sim/buffs.ts', 'packages/server/src/sim/feed.ts', 'packages/server/src/sim/camps.ts',
  'packages/server/src/sim/killAugments.ts', 'packages/server/src/sim/mobLife.ts', 'packages/server/src/sim/mobAI.ts',
  'packages/server/src/sim/terrainEffects.ts', 'packages/server/src/sim/regen.ts', 'packages/server/src/sim/abilities.ts',
  'packages/server/src/sim/quests.ts', 'packages/server/src/sim/vision.ts', 'packages/server/src/sim/campHeal.ts',
  'packages/server/src/sim/traders.ts', 'packages/server/src/sim/cardHooks.ts', 'packages/server/src/sim/loot.ts',
];
const sha = (path: string) => createHash('sha256').update(readFileSync('/repo/' + path)).digest('hex');

interface PlayerSpec { id: string; faction: FactionId; at: {x: number, y: number}; weapon0?: string; cards?: string[]; hp?: number }
interface CaseSpec {
  name: string;
  description: string;
  players: PlayerSpec[];
  maxTicks: number;
  /** Inputs by the tick they must be enqueued before (tick = state.tick + 1), like real client messages. */
  inputs?: Array<{tick: number, player: string, type: string, msg: any}>;
  /** Real grantCard producer calls made between steps (trusted setup actions, explicitly labelled). */
  grants?: Array<{tick: number, player: string, card: string}>;
  /** Real player removals between steps. */
  removes?: Array<{tick: number, player: string}>;
  /** Ticks whose frost diagnostics become the named witnesses. */
  witnessTicks: number[];
}

function makeMap(): GameMap {
  const tiles = new Uint8Array(W * H).fill(TILE_FLOOR);
  for (let i = 0; i < ROWS.length; i++) for (let x = 0; x < W; x++) if (ROWS[i]![x] === '#') tiles[i * W + x] = TILE_WALL;
  const map = mapFromTiles(W, H, tiles, SEED);
  map.spawns = [{x: 400, y: 320}, {x: 475, y: 320}, {x: 900, y: 320}, {x: 1300, y: 600}];
  return map;
}

function buildWorld(c: CaseSpec): any {
  const world = createWorld({
    newItemUid: () => '0',
    seed: makeMap().seed,
    map: makeMap(),
    config: {
      minPlayers: c.players.length, lobbySeconds: 15, fillSeconds: 0,
      patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600,
    },
    random: mulberry32(SEED),
    rewardSalt: [1, 2, 3, 4],
    questSalt: [5, 6, 7, 8],
  } as any);
  for (const install of MODULES) install(world);
  for (const p of c.players) addPlayer(world, p.id, p.id.toUpperCase(), {faction: p.faction});
  for (const p of c.players) {
    const s = world.state.players.get(p.id)!;
    s.weapon0 = p.weapon0 ?? '';
    s.weapon1 = '';
    for (const card of p.cards ?? []) {
      void s;
      assert.notEqual(grantCard(world, combatant(world, p.id) as any, card), null, 'real grantCard ' + card);
    }
  }
  return world;
}

function frostRow(world: any, id: string): any {
  const rt = world.players.get(id);
  const s = world.state.players.get(id);
  if (!rt || !s) return {id, removed: true};
  const f = signatureState(world, id);
  const w = rt.weapon;
  return {
    id,
    chill: f?.chill ?? 1,
    chillers: (f?.chillers ?? []).slice(),
    exposureStartedAt: Number.isFinite(f?.chillExposureStartedAt) ? f!.chillExposureStartedAt : null,
    lastNearAt: Number.isFinite(f?.chillLastNearAt) ? f!.chillLastNearAt : null,
    rangedUntil: Number.isFinite(f?.rangedChillUntil) ? f!.rangedChillUntil : null,
    move: f?.frostMoveMult ?? 1,
    slowResist: slowResistOf(s),
    readyAt: s.readyAt,
    bufferedUntil: w.bufferedUntil,
    drawStartedAt: s.drawStartedAt,
    action: w.action ? {kind: w.action.kind, startedAt: w.action.startedAt, landsAt: w.action.landsAt} : null,
  };
}

function run(c: CaseSpec): any {
  const world = buildWorld(c);
  const first = step(world, TICK_MS);
  void first;
  assert.ok(world.state.phase === 'active', c.name + ': the declared lobby starts the run');
  for (const p of c.players) {
    const s = world.state.players.get(p.id)!;
    s.x = p.at.x;
    s.y = p.at.y;
    s.facing = 0;
    if (p.hp !== undefined) s.hp = p.hp;
    if (p.weapon0 !== undefined) s.weapon0 = p.weapon0;
    world.players.get(p.id)!.history = [{t: world.state.serverTime, x: p.at.x, y: p.at.y}];
  }
  const sent: any[] = [];
  const ticks: any[] = [];
  const startTick = world.state.tick;
  for (let i = 0; i < c.maxTicks; i++) {
    const tick = world.state.tick + 1;
    for (const input of c.inputs ?? []) {
      if (input.tick !== tick) continue;
      const rt = world.players.get(input.player)!;
      const payload = JSON.parse(JSON.stringify(input.msg ?? {}));
      const accepted = enqueueClientMessage(rt.inputs, input.type, payload, {training: false});
      sent.push({tick, player: input.player, type: input.type, msg: input.msg ?? {}, accepted});
    }
    const events = step(world, TICK_MS);
    const resolved = events.filter((e: any) => e.type === 'resolved').map((e: any) => ({id: e.id, outcome: e.result.outcome, place: e.result.place}));
    ticks.push({
      tick: world.state.tick,
      time: world.state.serverTime,
      phase: world.state.phase,
      frost: c.players.map((p) => frostRow(world, p.id)),
      ...(resolved.length ? {resolved} : {}),
    });
    for (const g of c.grants ?? []) {
      if (g.tick !== tick) continue;
      const result = grantCard(world, combatant(world, g.player) as any, g.card);
      assert.notEqual(result, null, g.player + ' real mid-run grantCard ' + g.card);
    }
    for (const rm of c.removes ?? []) if (rm.tick === tick) removePlayer(world, rm.player);
    if (world.state.phase !== 'active') break;
  }
  const witnesses = c.witnessTicks.map((t) => {
    const row = ticks.find((r) => r.tick === t);
    assert.ok(row, c.name + ': witness tick ' + t + ' was recorded');
    return {tick: t, frost: row.frost};
  });
  return {
    name: c.name,
    description: c.description,
    setup: {
      map: {width: W, height: H, rows: ROWS, seed: SEED},
      config: {minPlayers: c.players.length, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600},
      players: c.players,
      trustedSetup: 'declared positions/seed/config and real grantCard cards; no expected frost output is injected',
    },
    startTick,
    inputs: sent,
    grants: c.grants ?? [],
    removes: c.removes ?? [],
    ticks,
    witnesses,
  };
}

const CASES: CaseSpec[] = [
  {
    name: 'attack-baseline',
    description: 'Actual Frost/Holy engagement trade, no card: the Frost structural chill reaches the Holy victim unresisted.',
    players: [{id: 'p0', faction: 'frost' as FactionId, at: {x: 400, y: 320}, weapon0: 'sword'}, {id: 'p1', faction: 'holy' as FactionId, at: {x: 475, y: 320}, weapon0: 'sword'}],
    maxTicks: 12,
    inputs: [{tick: 3, player: 'p0', type: 'attack', msg: {a: 0}}, {tick: 3, player: 'p1', type: 'attack', msg: {a: Math.PI}}],
    witnessTicks: [4, 5, 6],
  },
  {
    name: 'attack-iron-will-victim',
    description: 'Same engagement with Iron Will granted to the victim through the real grantCard producer (folded slowResist 0.4).',
    players: [{id: 'p0', faction: 'frost' as FactionId, at: {x: 400, y: 320}, weapon0: 'sword'}, {id: 'p1', faction: 'holy' as FactionId, at: {x: 475, y: 320}, weapon0: 'sword', cards: ['ironWill']}],
    maxTicks: 12,
    inputs: [{tick: 3, player: 'p0', type: 'attack', msg: {a: 0}}, {tick: 3, player: 'p1', type: 'attack', msg: {a: Math.PI}}],
    witnessTicks: [4, 5, 6],
  },
  {
    name: 'attack-iron-will-source',
    description: 'Iron Will on the Frost source (not the victim): the outgoing chill stays the unresisted structural value.',
    players: [{id: 'p0', faction: 'frost' as FactionId, at: {x: 400, y: 320}, weapon0: 'sword', cards: ['ironWill']}, {id: 'p1', faction: 'holy' as FactionId, at: {x: 475, y: 320}, weapon0: 'sword'}],
    maxTicks: 12,
    inputs: [{tick: 3, player: 'p0', type: 'attack', msg: {a: 0}}, {tick: 3, player: 'p1', type: 'attack', msg: {a: Math.PI}}],
    witnessTicks: [4, 5, 6],
  },
  {
    name: 'near-iron-will',
    description: 'Engaged near (within CHILL_MOVE_RADIUS) Frost/Holy trade with Iron Will on the victim: the near movement result is resisted before quantization.',
    players: [{id: 'p0', faction: 'frost' as FactionId, at: {x: 400, y: 320}, weapon0: 'sword'}, {id: 'p1', faction: 'holy' as FactionId, at: {x: 475, y: 320}, weapon0: 'sword', cards: ['ironWill']}],
    maxTicks: 30,
    inputs: [{tick: 3, player: 'p0', type: 'attack', msg: {a: 0}}, {tick: 3, player: 'p1', type: 'attack', msg: {a: Math.PI}}],
    witnessTicks: [4, 5, 6, 20],
  },
  {
    name: 'ranged-baseline',
    description: 'Actual bow hit from outside the near radius: the ranged-only movement result, no card.',
    players: [{id: 'p0', faction: 'frost' as FactionId, at: {x: 400, y: 320}, weapon0: 'bow'}, {id: 'p1', faction: 'holy' as FactionId, at: {x: 650, y: 320}, weapon0: 'sword', cards: []}],
    maxTicks: 40,
    inputs: [{tick: 3, player: 'p0', type: 'target', msg: {id: 'p1'}}, {tick: 4, player: 'p0', type: 'attack', msg: {a: 0}}, {tick: 20, player: 'p0', type: 'release', msg: {a: 0}}],
    witnessTicks: [10, 12, 30],
  },
  {
    name: 'ranged-iron-will',
    description: 'Same ranged hit with Iron Will on the victim: the ranged movement result is resisted before quantization.',
    players: [{id: 'p0', faction: 'frost' as FactionId, at: {x: 400, y: 320}, weapon0: 'bow'}, {id: 'p1', faction: 'holy' as FactionId, at: {x: 650, y: 320}, weapon0: 'sword', cards: ['ironWill']}],
    maxTicks: 40,
    inputs: [{tick: 3, player: 'p0', type: 'target', msg: {id: 'p1'}}, {tick: 4, player: 'p0', type: 'attack', msg: {a: 0}}, {tick: 20, player: 'p0', type: 'release', msg: {a: 0}}],
    witnessTicks: [10, 12, 30],
  },
  {
    name: 'near-thaw-reset-iron-will',
    description: 'Near episode through hold/thaw then a real source removal while a bystander keeps the run going: episode reset and departed-source handling with Iron Will on the victim.',
    players: [{id: 'p0', faction: 'frost' as FactionId, at: {x: 400, y: 320}, weapon0: 'sword', hp: 5000}, {id: 'p1', faction: 'holy' as FactionId, at: {x: 475, y: 320}, weapon0: 'sword', cards: ['ironWill'], hp: 5000}, {id: 'p2', faction: 'holy' as FactionId, at: {x: 1300, y: 600}, weapon0: 'sword', hp: 5000}],
    maxTicks: 200,
    inputs: [{tick: 3, player: 'p0', type: 'attack', msg: {a: 0}}, {tick: 3, player: 'p1', type: 'attack', msg: {a: Math.PI}}],
    removes: [{tick: 110, player: 'p0'}],
    witnessTicks: [20, 30, 60, 100, 112, 130, 160, 196],
  },
  {
    name: 'clocks-buffered-melee-iron-will',
    description: 'Buffered melee cooldown on the chilled Iron Will victim through two real attack inputs; resisted chill stretches readyAt/bufferedUntil.',
    players: [{id: 'p0', faction: 'frost' as FactionId, at: {x: 400, y: 320}, weapon0: 'sword', hp: 5000}, {id: 'p1', faction: 'holy' as FactionId, at: {x: 475, y: 320}, weapon0: 'sword', cards: ['ironWill'], hp: 5000}],
    maxTicks: 80,
    inputs: [{tick: 3, player: 'p0', type: 'attack', msg: {a: 0}}, {tick: 3, player: 'p1', type: 'attack', msg: {a: Math.PI}}, {tick: 10, player: 'p1', type: 'attack', msg: {a: Math.PI}}, {tick: 30, player: 'p1', type: 'attack', msg: {a: Math.PI}}],
    witnessTicks: [5, 11, 12, 31, 40],
  },
  {
    name: 'clocks-bow-draw-iron-will',
    description: 'Bow draw on the chilled Iron Will victim: the draw clocks are stretched by the resisted chill through real attack/release inputs.',
    players: [{id: 'p0', faction: 'frost' as FactionId, at: {x: 400, y: 320}, weapon0: 'sword', hp: 5000}, {id: 'p1', faction: 'holy' as FactionId, at: {x: 650, y: 320}, weapon0: 'bow', cards: ['ironWill'], hp: 5000}],
    maxTicks: 90,
    inputs: [{tick: 3, player: 'p1', type: 'attack', msg: {a: Math.PI}}, {tick: 40, player: 'p1', type: 'release', msg: {a: Math.PI}}, {tick: 60, player: 'p1', type: 'attack', msg: {a: Math.PI}}],
    witnessTicks: [5, 20, 40, 60, 80],
  },
  {
    name: 'resistance-change-mid-run',
    description: 'Iron Will granted through the real grantCard producer mid-run: the cached chill moves from the unresisted value to the resisted one on subsequent ticks.',
    players: [{id: 'p0', faction: 'frost' as FactionId, at: {x: 400, y: 320}, weapon0: 'sword'}, {id: 'p1', faction: 'holy' as FactionId, at: {x: 475, y: 320}, weapon0: 'sword'}],
    maxTicks: 40,
    inputs: [{tick: 3, player: 'p0', type: 'attack', msg: {a: 0}}, {tick: 3, player: 'p1', type: 'attack', msg: {a: Math.PI}}],
    grants: [{tick: 12, player: 'p1', card: 'ironWill'}],
    witnessTicks: [6, 12, 13, 15],
  },
];

// Baseline counterparts keep the same producers/inputs without the card so Rust can compare witness pairs
// through the actual resistSlow relation instead of hard-coding the expected numbers.
for (const name of ['near-thaw-reset-iron-will', 'clocks-buffered-melee-iron-will', 'clocks-bow-draw-iron-will']) {
  const base = CASES.find((c) => c.name === name)!;
  CASES.push({
    ...base,
    name: name.replace('-iron-will', '-baseline'),
    description: 'Baseline counterpart of ' + name + ': same declared producers and inputs, no Iron Will.',
    players: base.players.map((p) => ({...p, cards: []})),
  });
}
const corpus = {
  format: 'rh-frost-resistance-source/1',
  provenance: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    image: IMAGE,
    kind: 'actual unmodified legacy sim through real grantCard and real client-message producers',
    fixedStepMs: TICK_MS,
    sourceFiles: Object.fromEntries(SOURCE_FILES.map((p) => [p, sha(p)])),
    packageLock: sha('package-lock.json'),
    tool: sha('tools/frost-resistance-fixtures/capture.mts'),
    config: {map: {width: W, height: H, rows: ROWS, seed: SEED}, modules: 'legacy HOLY_MODULES order without consumables', randomSeed: SEED, salts: {reward: [1, 2, 3, 4], quest: [5, 6, 7, 8]}},
  },
  roles: {
    producer: 'real grantCard folding, real enqueued attack/release/target inputs validated and submitted by ordinary step, real removePlayer',
    trustedSetup: 'declared starting positions, seed/config and starting cards; no expected frost output is injected',
    witnesses: 'the named ticks record actual source frost state; conditions (chill/move/clock values) are evidence, not inputs',
  },
  cases: CASES.map(run),
};
const text = JSON.stringify(corpus, null, 1) + String.fromCharCode(10);
// Deterministic replay: every case must produce exactly the same bytes when run again.
for (const c of CASES) assert.equal(JSON.stringify(run(c)), JSON.stringify(corpus.cases.find((x: any) => x.name === c.name)), c.name + ': source replay differs');
if (args[0] === '--write') {
  writeFileSync(outPath, text);
  const summary = corpus.cases.map((c: any) => c.name + ':' + c.ticks.length);
  console.log('captured ' + corpus.cases.length + ' Frost-resistance source cases (' + summary.join(', ') + ')');
} else {
  assert.equal(readFileSync(outPath, 'utf8'), text, 'the checked-in Frost-resistance source corpus differs from the source capture');
  console.log('frost-resistance source corpus matches: ' + outPath);
}
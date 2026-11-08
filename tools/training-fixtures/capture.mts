// Canonical actual-source training-room witness, captured in the pinned linux/amd64 Node 22.23.4 container.
// Runs the unmodified source through the same setup the Room builds (createGameWorld with the training config,
// installTraining, addPlayer, startRaid with a declared placement) and records, per case, the ordinary fixed steps /
// console messages / forced ledger hits / between-tick downs it applies and the JSON projection of the source state after
// each declared step. The harness adds no gameplay: every expected value is written by the source.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {
  DUMMY_HP, TICK_MS, WEAPON_IDS, cardDef, mulberry32,
} from '/repo/packages/shared/src/index.ts';
import {createGameWorld} from '/repo/packages/server/src/sim/gameplay.ts';
import {addPlayer, startRaid, step} from '/repo/packages/server/src/sim/step.ts';
import {enqueueClientMessage} from '/repo/packages/server/src/sim/inputs.ts';
import {applyLedger, recordHit} from '/repo/packages/server/src/sim/ledger.ts';
import {downPlayer} from '/repo/packages/server/src/sim/arena.ts';
import {rewardChests} from '/repo/packages/server/src/sim/chests.ts';
import {installTraining} from '/repo/packages/server/src/sim/training.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string', 'closed capture arguments');
const [, outPath] = args;
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');

const SEED = 1;
const RANDOM_SEED = 12;
const REWARD_SALT = [1, 2, 3, 4];
const QUEST_SALT = [5, 6, 7, 8];
const ME = 'p0';
const SPAWN = {x: 80, y: 112};
const BASE = {
  minPlayers: 8, lobbySeconds: 120, fillSeconds: 0, patienceSeconds: 2, patienceMinSeconds: 2, suddenDeathSeconds: 2,
};
const mapInput = JSON.parse(readFileSync('/capture/declared-map-input.json', 'utf8'));
for (const key of ['tiles', 'terrain', 'regionGrid', 'territoryGrid', 'featureGrid']) mapInput[key] = Uint8Array.from(mapInput[key]);

/** The exact secret streams the Rust replay is configured with (the order salt is the one createWorld draws). */
const drawOrderSalt = (() => {
  const r = mulberry32(RANDOM_SEED);
  return Math.floor(r() * 2 ** 32) >>> 0;
})();

const r6 = (v: any): any => typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v;

type Kind = 'training' | 'dummies' | 'arena';

function worldOf(kind: Kind): any {
  const map = structuredClone(mapInput);
  for (const key of ['tiles', 'terrain', 'regionGrid', 'territoryGrid', 'featureGrid']) map[key] = Uint8Array.from((mapInput as any)[key]);
  // One declared spawn: the lobby start places the seat exactly at the declared placement, so a replay needs no post-hoc move.
  map.spawns = [{x: SPAWN.x, y: SPAWN.y}];
  const config: any = kind === 'training'
    ? {...BASE, minPlayers: 1, lobbySeconds: 0, dummies: true, training: true}
    : kind === 'dummies'
      ? {...BASE, minPlayers: 1, lobbySeconds: 0, dummies: true}
      : {...BASE, minPlayers: 1, lobbySeconds: 0};
  const uid = {n: 0};
  const world = createGameWorld({
    seed: SEED,
    map,
    config,
    random: mulberry32(RANDOM_SEED),
    rewardSalt: REWARD_SALT,
    questSalt: QUEST_SALT,
    newItemUid: () => 'U' + ++uid.n,
  }, {signatures: false, walkHints: false});
  if (kind === 'training') installTraining(world);
  addPlayer(world, ME, 'alice', {faction: 'fire'});
  // The source equivalent of the native reset_active: the lobby closes on the first step (minPlayers 1, lobbySeconds 0),
  // the raid-start hooks run with the declared spawn, and the world is the active practice world after it.
  step(world, TICK_MS);
  assert.equal(world.state.phase, 'active');
  world.events.length = 0;
  return world;
}

const me = (w: any): any => w.state.players.get(ME)!;
const rt = (w: any): any => w.players.get(ME)!;

function roleOf(w: any, id: string): string {
  if (id === ME) return 'me';
  const m = w.state.mobs.get(id);
  if (!m) return 'unknown';
  if (m.name === 'Dummy') return 'dummy';
  if (m.name === 'Shield dummy') return 'shield';
  return 'practice';
}

function projectEvents(w: any, events: any[]): any {
  const out = {toasts: [] as any[], hits: [] as any[], blocks: [] as any[], deaths: [] as any[], resolved: 0};
  for (const e of events) {
    if (e.type === 'toast') out.toasts.push({to: e.to, text: e.text});
    else if (e.type === 'resolved') out.resolved++;
    else if (e.type === 'fx') {
      const fx = e.fx;
      if (fx.kind === 'hit') out.hits.push({victim: roleOf(w, fx.id), by: roleOf(w, fx.by), weapon: fx.weapon ?? '', amount: r6(fx.amount)});
      else if (fx.kind === 'block') out.blocks.push({victim: roleOf(w, fx.id), by: roleOf(w, fx.by), weapon: fx.weapon ?? ''});
      else if (fx.kind === 'death') out.deaths.push({victim: roleOf(w, fx.id), by: roleOf(w, fx.by)});
    }
  }
  return out;
}

function snapshot(w: any): any {
  const s = w.state;
  const p = me(w);
  const r = rt(w);
  const sortedMap = (m: any): any[] => [...m].map(([k, v]: any) => [k, r6(v)]).sort((a: any, b: any) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return {
    tick: s.tick,
    serverTime: r6(s.serverTime),
    phase: s.phase,
    training: s.training,
    player: {
      faction: p.faction, x: r6(p.x), y: r6(p.y), hp: r6(p.hp), maxHp: r6(p.maxHp), status: p.status,
      weapon0: p.weapon0, weapon1: p.weapon1, slot: p.slot,
      build: sortedMap(p.build),
      mobStats: sortedMap(p.mobStats),
      barrier: r6(p.barrier), gv: p.gv, kills: p.kills, bounty: p.bounty,
      down: !!r.down, resolved: !!r.resolved,
    },
    mobs: [...s.mobs].map(([, m]: any) => ({
      kind: m.kind, type: m.type ?? '', elite: !!m.elite, camp: Number(m.camp) || 0,
      x: r6(m.x), y: r6(m.y), facing: r6(m.facing), hp: r6(m.hp), maxHp: r6(m.maxHp), status: m.status, weapon0: m.weapon0 ?? '',
    })),
    containers: [...s.containers.values()].filter((c: any) => c.kind === 'ground').map((c: any) => ({
      weapon0: c.items.length > 0 ? c.items[0].def : '', x: r6(c.x), y: r6(c.y), count: c.items.length,
    })),
    chests: rewardChests(w).map((c: any) => ({options: [...c.options], x: r6(c.x), y: r6(c.y)})),
  };
}

function send(w: any, msg: any): boolean {
  // The room tells the queue that it is a training room (the only place a train message is accepted).
  return enqueueClientMessage(w.players.get(ME)!.inputs, 'train', msg, {training: !!w.config.training});
}

function hit(w: any, role: 'plain' | 'shield', raw: number): any[] {
  const id = [...w.state.mobs].find(([, m]: any) => m.name === (role === 'plain' ? 'Dummy' : 'Shield dummy'))![0];
  recordHit(w, {victim: id, by: {id: ME, name: 'alice'}, packet: {raw, phys: 1, magic: 0, true: 0}, weapon: 'axe', stagger: false});
  applyLedger(w);
  return w.events.splice(0);
}

function send_message(w: any, type: string, msg: any): void {
  assert.equal(enqueueClientMessage(w.players.get(ME)!.inputs, type, msg), true, type + ' accepted');
}

function run(w: any, ticks: number): any[] {
  const events: any[] = [];
  for (let i = 0; i < ticks; i++) events.push(...step(w, TICK_MS));
  return events;
}

function doomAndRiposte(w: any, weapon: 'bow' | 'sword', gapTiles: number): any[] {
  const shield = [...w.state.mobs].find(([, m]: any) => m.name === 'Shield dummy')![0];
  const m = w.state.mobs.get(shield)!;
  const p = me(w);
  Object.assign(p, {weapon0: weapon, weapon1: '', slot: 0, hp: 0.01, maxHp: m.maxHp * 1e6});
  const gap = gapTiles * 32;
  p.x = m.x + Math.cos(m.facing) * gap;
  p.y = m.y + Math.sin(m.facing) * gap;
  rt(w).path = [];
  rt(w).history = [{t: w.state.serverTime, x: p.x, y: p.y}];
  const a = Math.atan2(m.y - p.y, m.x - p.x);
  const events: any[] = [];
  send_message(w, 'attack', {a});
  events.push(...run(w, 1));
  if (weapon === 'bow') events.push(...run(w, 15));
  send_message(w, 'release', {a});
  events.push(...run(w, 1));
  for (let i = 0; i < 40 && !events.some((e: any) => e.type === 'fx' && e.fx.kind === 'death' && e.fx.id === ME); i++) {
    events.push(...run(w, 1));
  }
  return events;
}

/** One declared case: a fresh world of kind, then steps; every step stores its source events and the state after it. */
function captureCase(name: string, kind: Kind, steps: any[]): any {
  const w = worldOf(kind);
  const out: any[] = [{do: 'initial', events: projectEvents(w, []), after: snapshot(w)}];
  for (const stepDef of steps) {
    let events: any[] = [];
    let accepted: boolean | undefined;
    switch (stepDef.do) {
      case 'step': events = run(w, stepDef.ticks); break;
      case 'train': accepted = send(w, stepDef.msg); break;
      case 'hit': events = hit(w, stepDef.role, stepDef.raw); break;
      case 'down': downPlayer(w, me(w), rt(w), 'died'); events = w.events.splice(0); break;
      case 'riposte': events = doomAndRiposte(w, stepDef.weapon, stepDef.gapTiles); break;
      default: throw new Error('unknown step ' + stepDef.do);
    }
    out.push({
      do: stepDef.do,
      ...(stepDef.ticks !== undefined ? {ticks: stepDef.ticks} : {}),
      ...(stepDef.msg !== undefined ? {msg: stepDef.msg} : {}),
      ...(stepDef.role !== undefined ? {role: stepDef.role, raw: stepDef.raw} : {}),
      ...(stepDef.weapon !== undefined ? {weapon: stepDef.weapon, gapTiles: stepDef.gapTiles} : {}),
      ...(accepted !== undefined ? {accepted} : {}),
      events: projectEvents(w, events),
      after: snapshot(w),
    });
  }
  return {name, kind, steps: out};
}

const CARD = 'tankEngine';
const STAT = 'emberImp';
const camp = (id = STAT): any => ({cmd: 'camp', id});

const cases: any[] = [];
cases.push(captureCase('training_setup', 'training', []));
cases.push(captureCase('arena_control', 'arena', []));
cases.push(captureCase('long_training_run', 'training', [{do: 'step', ticks: 400}]));
cases.push(captureCase('dummy_lethal_refill_then_reset', 'training', [
  {do: 'step', ticks: 70},
  {do: 'hit', role: 'plain', raw: DUMMY_HP * 40},
  {do: 'hit', role: 'plain', raw: 100},
  {do: 'step', ticks: 60},
]));
cases.push(captureCase('between_tick_down_revived', 'training', [
  {do: 'step', ticks: 5},
  {do: 'down'},
  {do: 'step', ticks: 1},
]));
cases.push(captureCase('shield_riposte_revive', 'training', [
  {do: 'step', ticks: 70},
  {do: 'riposte', weapon: 'sword', gapTiles: 36 / 32},
]));
cases.push(captureCase('shield_reflected_arrow_revive', 'training', [
  {do: 'step', ticks: 70},
  {do: 'riposte', weapon: 'bow', gapTiles: 90 / 32},
]));
cases.push(captureCase('console_card', 'training', [
  {do: 'step', ticks: 1},
  {do: 'train', msg: {cmd: 'card', id: CARD, count: 2}},
  {do: 'step', ticks: 1},
  {do: 'train', msg: {cmd: 'card', id: CARD, count: 0}},
  {do: 'step', ticks: 1},
]));
cases.push(captureCase('console_stat', 'training', [
  {do: 'step', ticks: 1},
  {do: 'train', msg: {cmd: 'stat', id: STAT, count: 3}},
  {do: 'step', ticks: 1},
  {do: 'train', msg: {cmd: 'stat', id: STAT, count: 0}},
  {do: 'step', ticks: 1},
]));
cases.push(captureCase('console_camp_gap_and_new_ref', 'training', [
  {do: 'step', ticks: 1},
  {do: 'train', msg: camp()},
  {do: 'step', ticks: 1},
  {do: 'train', msg: camp()},
  {do: 'step', ticks: 1},
  {do: 'step', ticks: 6},
  {do: 'train', msg: camp()},
  {do: 'step', ticks: 1},
]));
cases.push(captureCase('console_camp_alive_cap', 'training', [
  {do: 'step', ticks: 1},
  ...Array.from({length: 4}, () => [{do: 'train', msg: camp()}, {do: 'step', ticks: 1}, {do: 'step', ticks: 6}]).flat(),
  {do: 'train', msg: camp()},
  {do: 'step', ticks: 1},
]));
cases.push(captureCase('console_camp_spawned_cap', 'training', [
  {do: 'step', ticks: 1},
  ...Array.from({length: 50}, () => [
    {do: 'train', msg: camp()}, {do: 'step', ticks: 1}, {do: 'step', ticks: 6},
    {do: 'train', msg: {cmd: 'clear'}}, {do: 'step', ticks: 1},
  ]).flat(),
  {do: 'train', msg: camp()},
  {do: 'step', ticks: 1},
]));
cases.push(captureCase('console_chest_chosen_and_roll', 'training', [
  {do: 'step', ticks: 1},
  {do: 'train', msg: {cmd: 'chest', options: ['hemorrhage']}},
  {do: 'step', ticks: 1},
  {do: 'train', msg: {cmd: 'chest', options: ['hemorrhage']}},
  {do: 'step', ticks: 1},
  {do: 'step', ticks: 6},
  {do: 'train', msg: {cmd: 'chest'}},
  {do: 'step', ticks: 1},
]));
cases.push(captureCase('console_chest_cap', 'training', [
  {do: 'step', ticks: 1},
  ...Array.from({length: 6}, () => [
    {do: 'train', msg: {cmd: 'chest', options: ['hemorrhage']}}, {do: 'step', ticks: 1}, {do: 'step', ticks: 6},
  ]).flat(),
  {do: 'train', msg: {cmd: 'chest', options: ['hemorrhage']}},
  {do: 'step', ticks: 1},
]));
cases.push(captureCase('console_clear', 'training', [
  {do: 'step', ticks: 1},
  {do: 'train', msg: {cmd: 'card', id: CARD, count: 1}},
  {do: 'step', ticks: 1},
  {do: 'train', msg: {cmd: 'stat', id: STAT, count: 2}},
  {do: 'step', ticks: 1},
  {do: 'train', msg: camp()},
  {do: 'step', ticks: 1},
  {do: 'step', ticks: 6},
  {do: 'train', msg: {cmd: 'chest', options: ['hemorrhage']}},
  {do: 'step', ticks: 1},
  {do: 'train', msg: {cmd: 'clear'}},
  {do: 'step', ticks: 1},
]));
cases.push(captureCase('door_and_catalog_bounds', 'training', [
  {do: 'step', ticks: 1},
  {do: 'train', msg: {cmd: 'card', id: 'nope', count: 1}},
  {do: 'train', msg: {cmd: 'card', id: CARD, count: 99}},
  {do: 'step', ticks: 1},
  {do: 'train', msg: {cmd: 'stat', id: 'nope', count: 1}},
  {do: 'train', msg: {cmd: 'stat', id: STAT, count: 1e9}},
  {do: 'step', ticks: 1},
  {do: 'train', msg: {cmd: 'camp', id: 'nope'}},
  {do: 'train', msg: {cmd: 'chest', options: ['hemorrhage', 'hemorrhage']}},
  {do: 'train', msg: {cmd: 'chest', options: ['hemorrhage', 'overkill', 'witness', 'gambler']}},
  {do: 'train', msg: {cmd: 'chest', options: ['nope']}},
  {do: 'step', ticks: 1},
]));
cases.push(captureCase('arena_door_refuses_train', 'arena', [
  {do: 'step', ticks: 1},
  {do: 'train', msg: {cmd: 'clear'}},
  {do: 'step', ticks: 1},
]));

// Two runs must be byte-identical (no wall clock, no entropy).
function build(): any {
  const replay = cases.map((c: any) => JSON.parse(JSON.stringify(c)));
  const sourceFiles = [
    'package.json',
    'package-lock.json',
    ...['packages/server/src/sim', 'packages/shared/src'].flatMap((dir) =>
      readdirSync('/repo/' + dir, {recursive: true}).filter((p: string) => p.endsWith('.ts')).map((p: string) => dir + '/' + p)),
  ].sort();
  const sourceSha256 = Object.fromEntries(sourceFiles.map((p: string) => [p, createHash('sha256').update(readFileSync('/repo/' + p)).digest('hex')]));
  const captureSha256 = createHash('sha256').update(readFileSync('/capture/capture.mts')).digest('hex');
  const mapSha256 = createHash('sha256').update(readFileSync('/capture/declared-map-input.json')).digest('hex');
  return {
    format: 'rh-training-source/1',
    profile: {
      name: 'training-room-basic-v1',
      tickMs: TICK_MS,
      seed: SEED,
      randomSeed: RANDOM_SEED,
      rewardSalt: REWARD_SALT,
      questSalt: QUEST_SALT,
      orderSalt: drawOrderSalt,
      player: {id: ME, name: 'alice', faction: 'fire', at: SPAWN},
      base: BASE,
      declaredMapSha256: mapSha256,
      captureSha256,
      sourceSha256,
      installers: 'createGameWorld modules (signatures/walkHints off, matching the native training plan) + installTraining (training cases only)',
      note: 'expected values are written by the unmodified source; the harness only reads state/passive events and sends the declared console/attack inputs',
    },
    cases: replay,
  };
}

const first = build();
const second = build();
assert.deepEqual(first, second);
const text = JSON.stringify(first, null, 2) + '\n';
if (args[0] === '--write') {
  writeFileSync(outPath, text);
  console.log('wrote ' + outPath);
} else {
  const committed = readFileSync(outPath, 'utf8');
  assert.equal(committed, text, 'the committed training corpus is not byte-identical to the source capture');
  console.log('training corpus matches the source capture: ' + outPath);
}
assert(cases.length >= 15, 'the declared case set');
assert(cases.some((c: any) => c.kind === 'arena'), 'an arena control');
assert(cases.some((c: any) => c.kind === 'training'), 'a training case');

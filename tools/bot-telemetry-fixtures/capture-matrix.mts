// Canonical actual-source telemetry VARIANT witness: ADDITIONAL REAL docs/TELEMETRY.md RunRecord (v1) lines from the
// unmodified legacy recorder in the pinned linux/amd64 Node 22.23.4 container, covering the optional/absent variant gaps the
// SCOPED_PLAN documented. The base record lives untouched in run-record.json (captured by capture.mts); this tool writes
// run-record-matrix.json additively. Same technique: declared hand-built arena, declared sim config/seed, declared actions,
// a declared deterministic clock (epoch = a constant + the sim's own server time, so epoch-derived AFK fields are
// deterministic), and the real file sink; only the random runId is normalized. Records that cannot be produced from the
// unmodified recorder without a real producer arena are documented in the corpus blockers instead of approximated.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {
  mapFromTiles, mulberry32, SUDDEN_DEATH_KILLER, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, validateRunRecord,
  type FactionId, type GameMap,
} from '/repo/packages/shared/src/index.ts';
import {createGameWorld} from '/repo/packages/server/src/sim/gameplay.ts';
import {addPlayer, removePlayer, step} from '/repo/packages/server/src/sim/step.ts';
import {recordHit} from '/repo/packages/server/src/sim/ledger.ts';
import {dropStatChest} from '/repo/packages/server/src/sim/chests.ts';
import {TelemetryRuntime} from '/repo/packages/server/src/telemetry/runtime.ts';
import {createSyncFileSink, serializeRecord} from '/repo/packages/server/src/telemetry/sink.ts';

const args = process.argv.slice(2);
assert(args.length === 3 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string' && typeof args[2] === 'string');
const [, baseOut, matrixOut] = args;
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');

const NORMALIZED_RUN_ID = '00000000-0000-4000-8000-000000000000';
const DECLARED_EPOCH = 1_700_000_000_000;
const HIT_WEAPON = 'sword';

const W = 60;
const H = 40;
function openMap(): GameMap {
  const tiles = new Uint8Array(W * H).fill(TILE_FLOOR);
  for (let x = 0; x < W; x++) { tiles[x] = TILE_WALL; tiles[(H - 1) * W + x] = TILE_WALL; }
  for (let y = 0; y < H; y++) { tiles[y * W] = TILE_WALL; tiles[y * W + W - 1] = TILE_WALL; }
  return {...mapFromTiles(W, H, tiles), spawns: Array.from({length: 8}, (_, i) => ({x: (6 + i * 6) * TILE + 16, y: 20 * TILE + 16}))};
}

const BASE_CONFIG = {
  minPlayers: 2, lobbySeconds: 15, fillSeconds: 0,
  patienceSeconds: 10_000, patienceMinSeconds: 10_000, suddenDeathSeconds: 10_000,
  pvpRules: false,
};

interface PlayerSpec { id: string; profile: string; faction: FactionId; bot?: boolean }
interface Variant {
  name: string;
  world: any;
  runtime: any;
  run: any;
  hits: any[];
  scenario: string[];
  tick: () => any[];
  setHp: (ids: string[], hp: number) => void;
  finish: (end?: "void" | "abandoned") => Promise<{record: any, line: string}>;
}

function variant(name: string, opts: {players: PlayerSpec[], config?: any, seed?: number, botTag?: any, build?: any}): Variant {
  const dir = '/tmp/rh-telemetry-matrix/' + name;
  rmSync(dir, {recursive: true, force: true});
  mkdirSync(dir, {recursive: true});
  const config = {...BASE_CONFIG, ...(opts.config ?? {})};
  const world = createGameWorld({map: openMap(), config, random: mulberry32(opts.seed ?? 11)}, {signatures: false});
  const runtime = new TelemetryRuntime({
    sink: createSyncFileSink({dir}),
    source: 'test',
    build: opts.build ?? {server: 'capture-build', commit: 'declared-commit'},
    salt: null,
    positions: true,
    botsFillTo: 0,
    // Declared deterministic clock: the sim's own server time rides on a constant epoch. The epoch fields are therefore
    // deterministic (not normalized), and the AFK computation sees a wall clock that advances with the run.
    now: () => DECLARED_EPOCH + Math.round(world.state.serverTime),
  });
  const run = runtime.attach(world, opts.botTag);
  for (const p of opts.players) addPlayer(world, p.id, p.profile, {faction: p.faction, bot: p.bot === true});
  const hits: any[] = [];
  world.beforeDamage.push((w: any) => {
    for (const h of hits.splice(0)) {
      recordHit(w, {
        victim: h.victim,
        by: {id: h.by, name: h.by},
        packet: {raw: h.amount, phys: 0, magic: 0, true: 1},
        weapon: h.weapon === undefined ? HIT_WEAPON : h.weapon,
        stagger: false,
        scale: 1,
        ...(h.arena === true ? {arena: true} : {}),
      } as any);
    }
  });
  const tick = (): any[] => {
    const events = step(world, TICK_MS);
    run.onEvents(events);
    return events;
  };
  const setHp = (ids: string[], hp: number): void => {
    for (const id of ids) {
      const p = world.state.players.get(id);
      if (p) { p.hp = hp; p.maxHp = hp; }
    }
  };
  const finish = async (end?: "void" | "abandoned") => {
    const record = run.finalize(end);
    assert(record !== null, name + ': the runtime builds a record');
    await runtime.close(2000);
    const files = readdirSync(dir).filter((f) => f.endsWith('.ndjson'));
    assert.equal(files.length, 1, name + ': one record line');
    const raw = readFileSync(join(dir, files[0]!), 'utf8').trimEnd();
    assert.equal(raw.split('\n').length, 1, name + ': one NDJSON line');
    assert.equal(raw, serializeRecord(record), name + ': the sink serialization is the record');
    const parsed = JSON.parse(raw);
    parsed.runId = NORMALIZED_RUN_ID;
    const problem = validateRunRecord(parsed);
    assert.equal(problem, null, name + ': the source validator accepts the record: ' + problem);
    return {record: parsed, line: JSON.stringify(parsed)};
  };
  return {name, world, runtime, run, hits, scenario: [], tick, setHp, finish};
}

/** Tick until the raid is active (planning/lobby handled); asserts it got there. */
function activate(v: Variant): void {
  for (let i = 0; i < 200; i++) {
    v.tick();
    if (v.world.state.phase === 'active') return;
  }
  throw new Error(v.name + ': the run did not start');
}

const records: Array<{name: string, scenario: string[], record: any, line: string}> = [];

// ------------------------------------------------------------------------------------------------ bot/client/net variants
{
  const v = variant('bot-client-net', {
    players: [
      {id: 'p0', profile: 'player0', faction: 'fire'},
      {id: 'p1', profile: 'player1', faction: 'frost'},
      {id: 'b0', profile: 'bot0', faction: 'holy', bot: true},
    ],
    botTag: (id: string) => (id === 'b0' ? {tier: 'easy', persona: 'farmer'} : undefined),
    build: {server: 'capture-build', commit: null},
  });
  activate(v);
  v.setHp(['p0', 'p1', 'b0'], 500);
  v.run.notePerf('p0', {
    v: 1, fpsP50: 61, frameMsP95: 16.4, frameMsP99: 33.3, longFrames: 2, rttP50: 25, rttP95: 40,
    rttSamples: 120, interpDelayMs: 33, hiddenSec: 0, dpr: 2, canvasW: 1600, canvasH: 900, ua: 'chrome',
  });
  v.run.noteDrop('p0');
  v.run.noteReconnect('p0');
  v.hits.push({victim: 'p1', by: 'p0', amount: 500});
  v.tick();
  v.hits.push({victim: 'b0', by: 'p0', amount: 500});
  v.tick();
  const cap = await v.finish();
  records.push({
    name: v.name,
    scenario: [
      'three players: two humans and one bot (botTag tier easy / persona farmer, build.commit null)',
      'one client perf sample, one drop and one reconnect on p0',
      'p0 kills p1, then the bot; the run ends',
    ],
    record: cap.record,
    line: cap.line,
  });
}

// ------------------------------------------------------------------------------------------ death kind variants (terrain, sudden)
{
  const v = variant('death-terrain-sudden', {players: [
    {id: 'p0', profile: 'player0', faction: 'fire'},
    {id: 'p1', profile: 'player1', faction: 'frost'},
    {id: 'p2', profile: 'player2', faction: 'holy'},
  ]});
  activate(v);
  v.setHp(['p0', 'p1', 'p2'], 500);
  v.hits.push({victim: 'p1', by: 'terrain:ember', amount: 500, arena: true});
  v.tick();
  v.hits.push({victim: 'p2', by: SUDDEN_DEATH_KILLER, amount: 500, arena: true});
  v.tick();
  const cap = await v.finish();
  records.push({
    name: v.name,
    scenario: [
      'three humans; p1 dies to arena terrain damage, then p2 to sudden-death damage; p0 is last standing',
      'covers DeathCause terrain and suddenDeath kinds plus firstBlood',
    ],
    record: cap.record,
    line: cap.line,
  });
}

// --------------------------------------------------------------------------------------------------- quit death / MIA mid-run
{
  const v = variant('death-quit', {players: [
    {id: 'p0', profile: 'player0', faction: 'fire'},
    {id: 'p1', profile: 'player1', faction: 'frost'},
  ]});
  activate(v);
  v.setHp(['p0', 'p1'], 500);
  v.tick();
  removePlayer(v.world, 'p1');
  v.tick();
  const cap = await v.finish();
  records.push({
    name: v.name,
    scenario: [
      'two humans; p1 leaves mid-run (removePlayer -> mia), the recorder classifies the death kind quit and the run ends',
      'covers DeathCause quit, quit true and PlayerOutcome mia',
    ],
    record: cap.record,
    line: cap.line,
  });
}

// ----------------------------------------------------------------------------------------------------- draw (both go down)
{
  const v = variant('draw-both-down', {players: [
    {id: 'p0', profile: 'player0', faction: 'fire'},
    {id: 'p1', profile: 'player1', faction: 'frost'},
  ]});
  activate(v);
  v.setHp(['p0', 'p1'], 500);
  v.hits.push({victim: 'p0', by: 'terrain:ember', amount: 500, arena: true});
  v.hits.push({victim: 'p1', by: 'terrain:ember', amount: 500, arena: true});
  v.tick();
  const cap = await v.finish();
  records.push({
    name: v.name,
    scenario: ['two humans die in the same tick to arena damage: the run ends in a draw'],
    record: cap.record,
    line: cap.line,
  });
}

// -------------------------------------------------------------------------------------------- void/abandoned and null nullables
{
  const v = variant('void-null-nullables', {players: [
    {id: 'p0', profile: 'player0', faction: 'fire'},
    {id: 'p1', profile: 'player1', faction: 'frost'},
  ]});
  activate(v);
  v.setHp(['p0', 'p1'], 500);
  v.hits.push({victim: 'p1', by: 'p0', amount: 30});
  v.tick();
  v.tick();
  const cap = await v.finish('void');
  records.push({
    name: v.name,
    scenario: [
      'two humans, one contact opens a duel, the room voids the run before anyone dies',
      'covers end void, PlayerOutcome alive, null firstBlood/death/pids, and a duel closed by runEnd with comeback null',
    ],
    record: cap.record,
    line: cap.line,
  });
}
{
  const v = variant('abandoned-end', {players: [
    {id: 'p0', profile: 'player0', faction: 'fire'},
    {id: 'p1', profile: 'player1', faction: 'frost'},
  ]});
  activate(v);
  v.setHp(['p0', 'p1'], 500);
  v.tick();
  const cap = await v.finish('abandoned');
  records.push({
    name: v.name,
    scenario: ['two humans, the room disposes of the run mid-run: end abandoned with both players still alive'],
    record: cap.record,
    line: cap.line,
  });
}

// ----------------------------------------------------------- long run: snapshots, 1 Hz tiles, AFK, truncated.samples
{
  const v = variant('long-run-snapshots-tiles-afk', {
    players: [
      {id: 'p0', profile: 'player0', faction: 'fire'},
      {id: 'p1', profile: 'player1', faction: 'frost'},
    ],
    config: {patienceSeconds: 1_000_000, patienceMinSeconds: 1_000_000, suddenDeathSeconds: 1_000_000},
  });
  activate(v);
  v.setHp(['p0', 'p1'], 1_000_000_000);
  // 1805 simulated seconds: 1800 kept samples plus 5 dropped (truncated.samples), all four minute snapshots, dense tiles
  // and an AFK flag for both input-less humans.
  const ticks = 1805 * 20;
  for (let i = 0; i < ticks; i++) v.tick();
  v.hits.push({victim: 'p1', by: 'p0', amount: 1_000_000_000_000});
  v.tick();
  const cap = await v.finish();
  records.push({
    name: v.name,
    scenario: [
      'two humans stand for 1805 simulated seconds, then p0 kills p1',
      'covers power snapshots at minutes 1/3/5/10, non-empty tiles, afk/afkMs true, truncated.samples and a long duration',
    ],
    record: cap.record,
    line: cap.line,
  });
}

// ---------------------------------------------------------------------------------------------- truncated.offers (cap 256)
{
  const v = variant('offers-truncated', {players: [
    {id: 'p0', profile: 'player0', faction: 'fire'},
    {id: 'p1', profile: 'player1', faction: 'frost'},
  ]});
  activate(v);
  v.setHp(['p0', 'p1'], 500);
  const p0 = v.world.state.players.get('p0')!;
  for (let i = 0; i < 260; i++) {
    dropStatChest(v.world, {x: p0.x + 20, y: p0.y});
    v.tick();
  }
  v.hits.push({victim: 'p1', by: 'p0', amount: 500});
  v.tick();
  const cap = await v.finish();
  records.push({
    name: v.name,
    scenario: [
      'two humans, 260 stat-chest offers in one run (the recorder keeps 256)',
      'covers truncated.offers and a full offers array',
    ],
    record: cap.record,
    line: cap.line,
  });
}

// ----------------------------------------------------------------------------------------------- truncated.duels (cap 256)
{
  const v = variant('duels-truncated', {players: [
    {id: 'p0', profile: 'player0', faction: 'fire'},
    {id: 'p1', profile: 'player1', faction: 'frost'},
  ]});
  activate(v);
  v.setHp(['p0', 'p1'], 1_000_000_000);
  // 258 contact segments separated by the 8 s duel gap: the recorder keeps 256 and counts the drops.
  const gapTicks = 162;
  for (let i = 0; i < 258; i++) {
    v.hits.push({victim: 'p1', by: 'p0', amount: 1});
    v.tick();
    for (let t = 0; t < gapTicks; t++) v.tick();
  }
  v.hits.push({victim: 'p1', by: 'p0', amount: 1_000_000_000_000});
  v.tick();
  const cap = await v.finish();
  records.push({
    name: v.name,
    scenario: [
      'two humans, 258 disengage duel segments (the recorder keeps 256)',
      'covers truncated.duels and a full duels array',
    ],
    record: cap.record,
    line: cap.line,
  });
}

// ------------------------------------------------------------------------------------------------------- planning MIA
{
  const v = variant('planning-mia', {
    players: [
      {id: 'p0', profile: 'player0', faction: 'fire'},
      {id: 'p1', profile: 'player1', faction: 'frost'},
      {id: 'p2', profile: 'player2', faction: 'holy'},
    ],
    config: {planSeconds: 0.5},
  });
  v.tick(); // the lobby closes into planning
  assert.equal(v.world.state.phase, 'planning', 'the declared planSeconds starts planning');
  removePlayer(v.world, 'p2'); // a planning leave: the recorder counts planningMia
  v.tick();
  activate(v);
  v.setHp(['p0', 'p1'], 500);
  v.hits.push({victim: 'p1', by: 'p0', amount: 500});
  v.tick();
  const cap = await v.finish();
  records.push({
    name: v.name,
    scenario: [
      'three humans enter planning (planSeconds 0.5); p2 leaves during planning',
      'covers planningMia and a two-player run after the planning departure',
    ],
    record: cap.record,
    line: cap.line,
  });
}

// -------------------------------------------------------------------------------------------- win bonus withheld: opponents
{
  const v = variant('win-bonus-opponents', {players: [
    {id: 'p0', profile: 'player0', faction: 'fire'},
    {id: 'p1', profile: 'player1', faction: 'frost'},
    {id: 'p2', profile: 'player2', faction: 'holy'},
  ]});
  activate(v);
  v.setHp(['p0', 'p1', 'p2'], 500);
  v.hits.push({victim: 'p2', by: 'p1', amount: 500});
  v.tick();
  v.hits.push({victim: 'p1', by: 'terrain:ember', amount: 500, arena: true});
  v.tick();
  const cap = await v.finish();
  records.push({
    name: v.name,
    scenario: [
      'three human starters; p0 wins without damaging anyone (p1 killed p2, then terrain killed p1)',
      'covers winBonusWithheld true with winBonusWhy opponents (the base record covers starters)',
    ],
    record: cap.record,
    line: cap.line,
  });
}

// ----------------------------------------------------------------- (validate the matrix invariants before writing it)
assert(records.length >= 10, 'the matrix covers the declared variants');
const byName = new Map(records.map((r) => [r.name, r.record]));
assert.equal(byName.get('long-run-snapshots-tiles-afk').players[0].snapshots.length, 4, 'four power snapshots');
assert(byName.get('long-run-snapshots-tiles-afk').players[0].tiles.length > 1000, 'dense tiles');
assert(byName.get('long-run-snapshots-tiles-afk').truncated.samples, 'samples dropped');
assert(byName.get('long-run-snapshots-tiles-afk').players[0].afk, 'afk flagged');
assert(byName.get('offers-truncated').truncated.offers > 0, 'offers dropped');
assert(byName.get('duels-truncated').truncated.duels > 0, 'duels dropped');
assert(byName.get('planning-mia').planningMia === 1, 'planning mia counted');
assert.equal(byName.get('death-terrain-sudden').players[1].death.kind, 'terrain');
assert.equal(byName.get('death-terrain-sudden').players[2].death.kind, 'suddenDeath');
assert.equal(byName.get('death-quit').players[1].death.kind, 'quit');
assert.equal(byName.get('void-null-nullables').firstBlood, null);
assert.equal(byName.get('void-null-nullables').players[0].death, null);
assert.equal(byName.get('void-null-nullables').duels[0].comeback, null);
assert.equal(byName.get('bot-client-net').players[2].tier, 'easy');
assert.equal(byName.get('bot-client-net').build.commit, null);
assert.equal(byName.get('bot-client-net').players[0].client.ua, 'chrome');
assert.equal(byName.get('bot-client-net').players[0].net.drops, 1);
assert.equal(byName.get('win-bonus-opponents').players[0].winBonusWhy, 'opponents');
assert.equal(byName.get('draw-both-down').end, 'draw');
assert.equal(byName.get('abandoned-end').end, 'abandoned');

const SOURCE = [
  'docs/TELEMETRY.md',
  'packages/shared/src/telemetry.ts',
  'packages/shared/src/index.ts',
  'packages/server/src/sim/telemetry.ts',
  'packages/server/src/telemetry/runtime.ts',
  'packages/server/src/telemetry/sink.ts',
  'packages/server/src/telemetry/identity.ts',
  'packages/server/src/telemetry/config.ts',
  'packages/server/src/sim/gameplay.ts',
  'packages/server/src/sim/step.ts',
  'packages/server/src/sim/ledger.ts',
  'packages/server/src/sim/chests.ts',
];
const sha = (p: string) => createHash('sha256').update(readFileSync('/repo/' + p)).digest('hex');
const corpus = {
  format: 'rh-bot-telemetry-matrix/1',
  profile: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    schemaVersion: 1,
    sourceFiles: Object.fromEntries(SOURCE.map((p) => [p, sha(p)])),
    tool: sha('tools/bot-telemetry-fixtures/capture-matrix.mts'),
    clock: 'runtime.now() = 1700000000000 + round(world.state.serverTime): declared and deterministic; epoch fields are not normalized',
    normalizedFields: {runId: NORMALIZED_RUN_ID},
  },
  records: records.map((r) => ({name: r.name, scenario: r.scenario, recordLine: r.line, record: r.record})),
  // Variants that cannot be produced from the unmodified recorder without a producer arena this bounded harness does not
  // have. They are documented here rather than approximated.
  blockers: [
    {
      variant: 'mob and zombie death causes',
      reason: 'the recorder classifies them from live regional-mob and Plague-zombie roster sources; this harness drives the hand-built no-mob rig world (same reason the existing base record has no mob section).',
    },
    {
      variant: 'non-empty camps and truncated.camps',
      reason: 'camp clears need a generated camp arena with spawn rosters and credited mob kills (a real camp fight); the declared hand-built arena has no camps or mobs. Follow-up A owns the producer arena.',
    },
    {
      variant: 'truncated.tiles (oversize drop)',
      reason: 'requires a serialized record over TELEMETRY_RECORD_MAX_BYTES (512 KiB) so the sink retries without tiles; the captured variants are far below that (the 1800-sample tiles are ~6 KiB), and reaching it honestly would need a deliberately huge camp/offer/duel run outside this bounded packet.',
    },
  ],
};
corpus.profile.captureSha256 = createHash('sha256').update(JSON.stringify(corpus)).digest('hex');
const matrixText = JSON.stringify(corpus, null, 1) + String.fromCharCode(10);

if (args[0] === '--write') {
  writeFileSync(matrixOut, matrixText);
  // The base corpus is not produced here: assert the committed base record file is untouched, then leave it as it is.
  const base = readFileSync(baseOut, 'utf8');
  assert(base.includes('rh-bot-telemetry-source/1'), 'the base corpus is the committed one');
  console.log('captured ' + records.length + ' variant RunRecords: ' + records.map((r) => r.name + ' ' + Buffer.byteLength(r.line) + 'B').join(', '));
} else {
  assert.equal(readFileSync(baseOut, 'utf8').length > 0, true, 'the base corpus exists');
  assert.equal(readFileSync(matrixOut, 'utf8'), matrixText, 'the checked-in telemetry matrix corpus differs from the source capture');
  console.log('telemetry matrix corpus matches: ' + matrixOut + ' (' + records.length + ' records)');
}

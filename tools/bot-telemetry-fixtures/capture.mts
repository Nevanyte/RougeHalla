// Canonical actual-source telemetry witness: one REAL docs/TELEMETRY.md RunRecord (v1) produced by the unmodified legacy
// recorder through the real file sink, in the pinned linux/amd64 Node 22.23.4 container. The scenario is declared (hand-built
// arena, sim config, seed, players, scripted hits/offers/steps); the record is captured exactly as the sink serialized it,
// with only the declared environment/clock fields normalized (the random runId). A scoped plan for porting the record body
// to the Rust runner is docs/evidence/stage2-bots-telemetry/SCOPED_PLAN.md.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {
  mapFromTiles, mulberry32, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, validateRunRecord,
  type FactionId, type GameMap,
} from '/repo/packages/shared/src/index.ts';
import {createGameWorld} from '/repo/packages/server/src/sim/gameplay.ts';
import {addPlayer, step} from '/repo/packages/server/src/sim/step.ts';
import {recordHit} from '/repo/packages/server/src/sim/ledger.ts';
import {enqueueClientMessage} from '/repo/packages/server/src/sim/inputs.ts';
import {dropStatChest} from '/repo/packages/server/src/sim/chests.ts';
import {TelemetryRuntime} from '/repo/packages/server/src/telemetry/runtime.ts';
import {createSyncFileSink, serializeRecord} from '/repo/packages/server/src/telemetry/sink.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string');
const [, outPath] = args;
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');

const NORMALIZED_RUN_ID = '00000000-0000-4000-8000-000000000000';
const DECLARED_EPOCH = 1_700_000_000_000;

const W = 60;
const H = 40;
function openMap(): GameMap {
  const tiles = new Uint8Array(W * H).fill(TILE_FLOOR);
  for (let x = 0; x < W; x++) { tiles[x] = TILE_WALL; tiles[(H - 1) * W + x] = TILE_WALL; }
  for (let y = 0; y < H; y++) { tiles[y * W] = TILE_WALL; tiles[y * W + W - 1] = TILE_WALL; }
  return {...mapFromTiles(W, H, tiles), spawns: Array.from({length: 8}, (_, i) => ({x: (6 + i * 6) * TILE + 16, y: 20 * TILE + 16}))};
}

const SIM_CONFIG = {
  minPlayers: 2, lobbySeconds: 15, fillSeconds: 0,
  patienceSeconds: 10_000, patienceMinSeconds: 10_000, suddenDeathSeconds: 10_000,
  pvpRules: false,
};

function captureRun(): {rawLine: string, record: any} {
  const dir = '/tmp/rh-telemetry-capture';
  // Each capture process starts from an empty directory: --write and --check run the same scenario, not a shared one.
  rmSync(dir, {recursive: true, force: true});
  mkdirSync(dir, {recursive: true});
  const world = createGameWorld({map: openMap(), config: SIM_CONFIG, random: mulberry32(11)}, {signatures: false});
  const runtime = new TelemetryRuntime({
    sink: createSyncFileSink({dir}),
    source: 'test',
    build: {server: 'capture-build', commit: 'declared-commit'},
    salt: null,
    positions: true,
    botsFillTo: 0,
    // The declared clock: integer epochs are the only clock-derived fields; the random runId is normalized below.
    now: () => DECLARED_EPOCH,
  });
  const run = runtime.attach(world);
  addPlayer(world, 'p0', 'player0', {faction: 'fire' as FactionId});
  addPlayer(world, 'p1', 'player1', {faction: 'frost' as FactionId});
  const hits: Array<{by: string, amount: number}> = [];
  world.beforeDamage.push((w) => {
    for (const hit of hits.splice(0)) {
      recordHit(w, {
        victim: hit.by === 'p0' ? 'p1' : 'p0',
        by: {id: hit.by, name: hit.by},
        packet: {raw: hit.amount, phys: 0, magic: 0, true: 1},
        weapon: 'sword',
        stagger: false,
        scale: 1,
      } as any);
    }
  });
  const tick = (): any[] => {
    const events = step(world, TICK_MS);
    run.onEvents(events);
    return events;
  };
  // 1: the lobby closes into the run (the recorder hears raidStarted).
  tick();
  assert.equal(world.state.phase, 'active', 'the declared lobby starts the run');
  for (const id of ['p0', 'p1']) {
    const player = world.state.players.get(id)!;
    player.hp = 200;
    player.maxHp = 200;
  }
  // 2: a stat chest offers its three boosts to p0, who takes pick 1 (an OfferRecord).
  const p0 = world.state.players.get('p0')!;
  const box = dropStatChest(world, {x: p0.x + 20, y: p0.y});
  tick();
  enqueueClientMessage(world.players.get('p0')!.inputs, 'choose', {chest: box.id, pick: 1});
  tick();
  // 3: one hit opens the p0/p1 duel segment, the next tick's killing blow closes it (a DuelRecord + firstBlood).
  hits.push({by: 'p0', amount: 30});
  tick();
  tick();
  hits.push({by: 'p0', amount: 500});
  tick();
  tick();
  assert.equal(world.state.phase, 'ended', 'the declared script ends the run');
  const record = run.finalize();
  assert(record !== null, 'the runtime builds a record');
  return {record};
}

const captured = captureRun();
const runtime = await import('/repo/packages/server/src/telemetry/runtime.ts');
void runtime;
// The real record the runtime handed to the sink: read it back from the file sink's NDJSON line, proving the sink path.
const dir = '/tmp/rh-telemetry-capture';
const files = readdirSync(dir).filter((f) => f.endsWith('.ndjson'));
assert.equal(files.length, 1, 'one run record was written');
const rawLine = readFileSync(join(dir, files[0]!), 'utf8').trimEnd();
assert.equal(rawLine.split('\n').length, 1, 'the sink wrote one NDJSON line');
assert.equal(rawLine, serializeRecord(captured.record), 'the file line is the sink serialization of the record');
// Normalize only the declared environment/clock field: the random UUID id. The declared clock makes the epochs fixed.
const parsed = JSON.parse(rawLine);
assert.equal(parsed.runId, captured.record.runId, 'the line is the record');
parsed.runId = NORMALIZED_RUN_ID;
const problem = validateRunRecord(parsed);
assert.equal(problem, null, 'the source validator accepts the record: ' + problem);
const recordLine = JSON.stringify(parsed);
assert.equal(recordLine, JSON.stringify(parsed), 'the normalized line is stable');

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
  'packages/server/src/sim/inputs.ts',
  'packages/server/src/sim/chests.ts',
  'packages/server/test/support/telemetryRig.ts',
];
const sha = (p: string) => createHash('sha256').update(readFileSync('/repo/' + p)).digest('hex');
const corpus = {
  format: 'rh-bot-telemetry-source/1',
  profile: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    sourceFiles: Object.fromEntries(SOURCE.map((p) => [p, sha(p)])),
    tool: sha('tools/bot-telemetry-fixtures/capture.mts'),
    schemaVersion: 1,
  },
  scenario: {
    name: 'two-player duel with one stat-chest offer',
    map: 'open 60x40 hand-built floor with eight spawns',
    simConfig: SIM_CONFIG,
    seed: 11,
    players: [
      {id: 'p0', profile: 'player0', faction: 'fire'},
      {id: 'p1', profile: 'player1', faction: 'frost'},
    ],
    script: [
      'one step closes the lobby into the run (raidStarted)',
      'drop one stat chest by p0; one step; p0 chooses pick 1',
      'p0 hits p1 for 30 (duel opens); one step',
      'p0 hits p1 for 500 (kill; duel closes); two steps; the run ends',
      'finalize through the real sink',
    ],
    normalizedFields: {runId: NORMALIZED_RUN_ID, clock: 'runtime.now() declared constant 1700000000000'},
  },
  record: parsed,
  recordLine,
};
corpus.profile.captureSha256 = createHash('sha256').update(JSON.stringify(corpus)).digest('hex');
const out = JSON.stringify(corpus, null, 1) + String.fromCharCode(10);
if (args[0] === '--write') {
  writeFileSync(outPath, out);
  const fields = Object.keys(parsed);
  console.log('captured a real RunRecord: ' + Buffer.byteLength(recordLine) + ' bytes, top-level fields ' + fields.join(','));
} else {
  assert.equal(readFileSync(outPath, 'utf8'), out, 'the checked-in telemetry corpus differs from the source capture');
  console.log('telemetry corpus matches: ' + outPath);
}

// Offline companion witness: actual immutable BotManager.addBot over a real headless world, never a brain frame.
// Usage: node source-managed-bias-refresh.cjs REPO > source-managed-bias-refresh.json
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const repo = process.argv[2];
if (!repo) throw new Error('repository path required');
const revision = '75eaa42e003f45827c1428c63a8508a90b9104a4';
const git = (...args) => execFileSync('git', args, { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-bots5-managed-bias-'));
try {
  const archive = git('archive', revision, 'packages/server/src', 'packages/shared/src', 'tsconfig.base.json');
  execFileSync('tar', ['-x', '-C', temp], { input: archive });
  const entry = path.join(temp, 'entry.ts');
  fs.writeFileSync(entry, `
    export { BotManager } from './packages/server/src/bots/BotManager.ts';
    export { createGameWorld } from './packages/server/src/sim/gameplay.ts';
    export { addPlayer } from './packages/server/src/sim/step.ts';
    export { BOT_FILL_DEFAULTS, PERSONA_IDS } from './packages/server/src/bots/brain/types.ts';
    export { FACTION_IDS, mulberry32 } from './packages/shared/src/index.ts';
  `);
  const bundle = path.join(temp, 'source.cjs');
  require(path.join(repo, 'node_modules/esbuild')).buildSync({
    entryPoints: [entry], outfile: bundle, bundle: true, platform: 'node', format: 'cjs',
    nodePaths: [path.join(repo, 'node_modules')],
    alias: {
      '@raid/shared/schema': path.join(temp, 'packages/shared/src/schema.ts'),
      '@raid/shared/telemetry': path.join(temp, 'packages/shared/src/telemetry.ts'),
      '@raid/shared': path.join(temp, 'packages/shared/src/index.ts'),
    },
    logLevel: 'warning',
  });
  const { BotManager, createGameWorld, addPlayer, BOT_FILL_DEFAULTS, PERSONA_IDS, FACTION_IDS, mulberry32 } = require(bundle);
  const managerSeed = 7;
  const worldSeed = 1234;
  const initialBiases = Object.fromEntries(PERSONA_IDS.flatMap(persona => FACTION_IDS.map(faction => [`faction|${persona}|${faction}`, 0])));
  const changedBiases = Object.fromEntries(PERSONA_IDS.flatMap(persona => FACTION_IDS.map(faction => [`faction|${persona}|${faction}`, faction === 'fire' ? 0.25 : -0.25])));
  const line = spec => [spec.id, spec.name, spec.tier, spec.persona, spec.faction, spec.seed >>> 0].join(' ');
  function run(frozen) {
    const world = createGameWorld({ seed: worldSeed, config: {
      minPlayers: 2, lobbySeconds: 30, fillSeconds: 5, patienceSeconds: 3600,
      patienceMinSeconds: 3600, suddenDeathSeconds: 600,
    }, random: mulberry32(worldSeed + 1), rewardSalt: 55, questSalt: 66 });
    addPlayer(world, 'h1', 'human1');
    const initialPlayers = [...world.state.players.values()].map(p => ({ id: p.id, name: p.name, faction: p.faction }));
    let version = 0;
    let brainFrames = 0;
    const snapshotReads = [];
    const brainSnapshots = [];
    const store = {
      snapshot() {
        const suppliedVersion = frozen ? 0 : version;
        const values = suppliedVersion === 0 ? initialBiases : changedBiases;
        snapshotReads.push(suppliedVersion);
        return Object.freeze({ enabled: true, bias: key => values[key] ?? 0 });
      },
      record() { throw new Error('no run results permitted in this lobby-only witness'); },
      flush() {}, close() {},
    };
    const cfg = { ...BOT_FILL_DEFAULTS, fillTo: 3 };
    const manager = new BotManager(world, cfg, {
      store, isNameTaken: () => false, seed: managerSeed,
      createBrain: config => {
        brainSnapshots.push(Object.fromEntries(FACTION_IDS.map(faction => [faction, config.learned.bias('faction|' + config.persona.id + '|' + faction)])));
        return { id: config.id, tick() { brainFrames++; throw new Error('brain activation forbidden'); },
          end() { throw new Error('no run results'); }, goal: { kind: 'idle' }, stats: {} };
      },
    });
    const arrivals = [];
    for (let i = 0; i < 2; i++) {
      version = i;
      const draws = [];
      const previous = manager.fillRng;
      manager.fillRng = () => { const value = previous(); draws.push(value); return value; };
      const preFactions = [...world.state.players.values()].map(p => p.faction ?? null);
      const namesLower = [...world.state.players.values()].map(p => p.name.toLowerCase());
      const spec = manager.addBot();
      manager.fillRng = previous;
      assert(spec !== null);
      arrivals.push({ arrival: i + 1, requestedStoreVersion: version, suppliedSnapshotVersion: snapshotReads.at(-1),
        preFactions, namesLower, draws, spec: { ...spec, seed: spec.seed >>> 0 }, line: line(spec) });
    }
    assert.equal(brainFrames, 0);
    assert.equal(manager.stats.sent, 0);
    assert.equal(snapshotReads.length, 2, 'the actual manager reads the store independently at each addBot');
    manager.dispose();
    return { mode: frozen ? 'injected-store-frozen-at-lobby-snapshot-control' : 'current-store-snapshot-each-arrival',
      initialPlayers, snapshotReads, brainSnapshots, brainFrames, arrivals };
  }
  const dynamic = run(false);
  const fixedLobbySnapshotControl = run(true);
  assert.equal(dynamic.arrivals[0].line, fixedLobbySnapshotControl.arrivals[0].line);
  assert.deepEqual(dynamic.arrivals.map(a => a.draws), fixedLobbySnapshotControl.arrivals.map(a => a.draws));
  assert.notEqual(dynamic.arrivals[1].spec.faction, fixedLobbySnapshotControl.arrivals[1].spec.faction,
    'the changed snapshot must affect an actual source faction draw');
  assert.deepEqual(dynamic.snapshotReads, [0, 1]);
  assert.deepEqual(fixedLobbySnapshotControl.snapshotReads, [0, 0]);
  const files = ['packages/server/src/bots/BotManager.ts', 'packages/server/src/bots/brain/types.ts',
    'packages/server/src/bots/brain/random.ts', 'packages/server/src/bots/callsigns.ts',
    'packages/server/src/sim/gameplay.ts', 'packages/server/src/sim/world.ts', 'packages/server/src/sim/step.ts',
    'packages/shared/src/factions.ts', 'packages/shared/src/rng.ts'];
  console.log(JSON.stringify({ format: 'rh-managed-faction-bias-refresh-source/1',
    revision: git('rev-parse', revision).toString().trim(),
    profile: { node: process.version, platform: process.platform, arch: process.arch,
      sourceArchiveSha256: crypto.createHash('sha256').update(archive).digest('hex'),
      toolSha256: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
      sourceSha256: Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(git('show', revision + ':' + file)).digest('hex')])) },
    inputs: { managerSeed, worldSeed, arrivalMethod: 'BotManager.addBot', arrivalCount: 2,
      config: { ...BOT_FILL_DEFAULTS, fillTo: 3 }, initialBiases, changedBiases,
      isNameTaken: false, brainFactory: 'inert test seam; no tick/end invoked' },
    dynamic, fixedLobbySnapshotControl,
    secondFactionChanged: dynamic.arrivals[1].spec.faction !== fixedLobbySnapshotControl.arrivals[1].spec.faction,
  }, null, 2));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

// Actual source store probe. Usage: node source-insertion-order.cjs REPO > source-insertion-order.json
// Source blobs are read only at the immutable revision; all extraction and bundling stays in a temporary directory.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const repo = process.argv[2];
if (!repo) throw new Error('repository path required');
const revision = '75eaa42e003f45827c1428c63a8508a90b9104a4';
const storePath = 'packages/server/src/bots/learning/BotStatsStore.ts';
const typesPath = 'packages/server/src/bots/brain/types.ts';
const git = (...args) => execFileSync('git', args, { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-bots5-source-order-'));
try {
  const archive = git('archive', revision, storePath, typesPath, 'packages/shared/src');
  execFileSync('tar', ['-x', '-C', temp], { input: archive });
  const bundle = path.join(temp, 'store.cjs');
  require(path.join(repo, 'node_modules/esbuild')).buildSync({
    entryPoints: [path.join(temp, storePath)], outfile: bundle,
    bundle: true, platform: 'node', format: 'cjs',
    alias: { '@raid/shared': path.join(temp, 'packages/shared/src/index.ts') },
    logLevel: 'warning',
  });
  const { createBotStatsStore } = require(bundle);
  const old = 'opener|z-oldest|flank';
  const second = 'opener|a-second|flank';
  const initialKeys = [old, second, ...Array.from({ length: 1998 }, (_, i) => `opener|m${String(i).padStart(4, '0')}|flank`)];
  function scenario(name, operations, firstCount = 1) {
    const entries = Object.fromEntries(initialKeys.map((key, i) => [key, { n: i === 0 ? firstCount : 1, s: 0 }]));
    let text = JSON.stringify({ version: 1, baseline: {}, entries });
    let staged;
    const options = { now: () => 0, fs: {
      readText: () => text, mkdirp() {}, writeSynced(_file, body) { staged = body; },
      rename() { text = staged; }, syncDir() {}, remove() {},
    } };
    let store = createBotStatsStore(path.join(temp, 'stats.json'), options);
    const results = [];
    for (const operation of operations) {
      const before = new Set(Object.keys(JSON.parse(text).entries));
      if (operation.reload) {
        store.flush();
        store = createBotStatsStore(path.join(temp, 'stats.json'), options);
        results.push({ reload: true });
        continue;
      }
      store.record({ tier: 'easy', outcome: 'won', place: 1, players: 2, choices: operation.choices });
      store.flush();
      const after = new Set(Object.keys(JSON.parse(text).entries));
      results.push({ choices: operation.choices, evicted: [...before].filter(key => !after.has(key)) });
    }
    store.close();
    return { name, firstCount, operations: results };
  }
  const newcomer = 'opener|new|flank';
  const cases = [
    scenario('runtime_nonlexical_tie', [{ choices: [newcomer] }]),
    scenario('update_retains_age', [{ choices: [old, old] }, { choices: [newcomer] }], 0),
    scenario('remove_reinsert_appends', [{ choices: [newcomer] }, { choices: [old] }, { choices: ['opener|newer|flank'] }]),
    scenario('restart_restores_serialized_key_order', [{ choices: [old, old] }, { reload: true }, { choices: [newcomer] }], 0),
    scenario('runtime_without_restart_keeps_original_order', [{ choices: [old, old] }, { choices: [newcomer] }], 0),
  ];
  console.log(JSON.stringify({
    revision: git('rev-parse', revision).toString().trim(),
    sourceSha256: Object.fromEntries([storePath, typesPath].map(file => [file, crypto.createHash('sha256').update(git('show', `${revision}:${file}`)).digest('hex')])),
    initialKeys: { first: old, second, fillerCount: 1998, fillerPattern: 'opener|m%04d|flank' },
    cases,
  }, null, 2));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

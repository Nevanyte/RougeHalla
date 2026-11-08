// Canonical actual-source P-BOTS-7 runtime witness, pinned linux/amd64 Node 22.23.4:
//  * the real BotManager delay line (per-command arrival = max(previous, at + latency + jitter), jitter from the
//    manager's own seeded stream, the 256-command queue cap), captured by calling the unchanged manager's delivery
//    entry point (a harness-only access; the source file is untouched);
//  * the server bots config surface: loadConfig(env).bots for declared BOTS_* environments, plus parseMix's edge rules;
//  * the source manager's isNameTaken use is a read-only profile lookup (native seam; behavior pinned natively).
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {mulberry32} from '/repo/packages/shared/src/index.ts';
import {BotManager} from '/repo/packages/server/src/bots/BotManager.ts';
import {BOT_FILL_DEFAULTS, PERSONA_IDS, TIER_IDS} from '/repo/packages/server/src/bots/brain/types.ts';
import {loadConfig, parseMix} from '/repo/packages/server/src/config.ts';
import {createGameWorld} from '/repo/packages/server/src/sim/gameplay.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string');
const [, outPath] = args;
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');

function world(): any {
  return createGameWorld({
    seed: 7,
    config: {minPlayers: 2, lobbySeconds: 30, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 600},
    random: mulberry32(8),
  });
}

const DELAY_CASES = [
  {name: 'declared-latency-and-jitter', seed: 7, latencyMs: 30, jitterMs: 8, ats: [0, 50, 100, 150, 350, 900] as number[]},
  {name: 'zero-delay', seed: 7, latencyMs: 0, jitterMs: 0, ats: [0, 50, 100] as number[]},
  {name: 'jitter-only-and-backwards-arrival', seed: 0xdeadbeef, latencyMs: 0, jitterMs: 40, ats: [0, 10, 20, 250, 260, 400] as number[]},
  {name: 'long-latency', seed: 12345, latencyMs: 120, jitterMs: 40, ats: [0, 50, 100, 150] as number[]},
];

function runDelay(c: any): any {
  const w = world();
  const cfg = {...BOT_FILL_DEFAULTS, fillTo: 0, latencyMs: c.latencyMs, jitterMs: c.jitterMs};
  const manager: any = new BotManager(w, cfg, {store: null, isNameTaken: () => false, seed: c.seed});
  const line: any = {queue: [], lastArrival: Number.NEGATIVE_INFINITY};
  const arrivals: any[] = [];
  for (let i = 0; i < c.ats.length; i++) {
    const ok = manager.deliver(line, {type: 'stop', msg: {seq: i}}, c.ats[i]);
    assert.equal(ok, true);
    arrivals.push({at: c.ats[i], arrival: line.queue[line.queue.length - 1].arrival});
  }
  // The queue cap: the 257th command is refused (and the 256th accepted).
  const cap: any = {queue: [], lastArrival: Number.NEGATIVE_INFINITY};
  let accepted = 0;
  let refused = 0;
  for (let i = 0; i < 260; i++) {
    if (manager.deliver(cap, {type: 'stop', msg: {seq: i}}, 1000)) accepted++;
    else refused++;
  }
  return {name: c.name, seed: c.seed, latencyMs: c.latencyMs, jitterMs: c.jitterMs, ats: c.ats, arrivals, cap: {accepted, refused}};
}

const MIX_CASES = [
  {name: 'defaults', ids: [...TIER_IDS], fallback: {...BOT_FILL_DEFAULTS.tierMix}, raw: undefined as any},
  {name: 'weights', ids: [...TIER_IDS], fallback: {...BOT_FILL_DEFAULTS.tierMix}, raw: 'easy:3, hard:1'},
  {name: 'missing-ids-count-zero', ids: [...TIER_IDS], fallback: {...BOT_FILL_DEFAULTS.tierMix}, raw: 'easy:2'},
  {name: 'all-zero-falls-back', ids: [...TIER_IDS], fallback: {...BOT_FILL_DEFAULTS.tierMix}, raw: 'easy:0, normal:0, hard:0'},
  {name: 'unknown-and-extra-parts-ignored', ids: [...TIER_IDS], fallback: {...BOT_FILL_DEFAULTS.tierMix}, raw: 'bogus:3, easy:x:y, hard:-2, normal:4'},
  {name: 'empty-weight-means-one', ids: [...TIER_IDS], fallback: {...BOT_FILL_DEFAULTS.tierMix}, raw: 'easy:, normal:, hard:'},
  {name: 'negative-clamped', ids: [...TIER_IDS], fallback: {...BOT_FILL_DEFAULTS.tierMix}, raw: 'easy:-3, normal:2'},
  {name: 'nan-falls-back', ids: [...TIER_IDS], fallback: {...BOT_FILL_DEFAULTS.tierMix}, raw: 'easy:not-a-number'},
];

const CONFIG_CASES = [
  {name: 'defaults', env: {}},
  {name: 'fill-to', env: {BOTS_FILL_TO: '6'}},
  {name: 'fill-to-rounds-and-clamps', env: {BOTS_FILL_TO: '99.6'}},
  {name: 'fill-to-negative-falls-back', env: {BOTS_FILL_TO: '-4'}},
  {name: 'fill-to-nan-falls-back', env: {BOTS_FILL_TO: 'lots'}},
  {name: 'arrival', env: {BOTS_ARRIVAL_SECONDS: '3.5'}},
  {name: 'arrival-negative-falls-back', env: {BOTS_ARRIVAL_SECONDS: '-1'}},
  {name: 'latency-and-jitter', env: {BOTS_LATENCY_MS: '120', BOTS_JITTER_MS: '0'}},
  {name: 'latency-negative-falls-back', env: {BOTS_LATENCY_MS: '-5', BOTS_JITTER_MS: '-5'}},
  {name: 'mixes', env: {BOTS_TIER_MIX: 'easy:2,normal:1', BOTS_PERSONA_MIX: 'farmer:1,hunter:1,opportunist:1,cautious:1'}},
  {name: 'seed', env: {BOTS_SEED: '4294967297'}},
  {name: 'seed-nan-falls-back', env: {BOTS_SEED: 'abc'}},
  // P-BOTS-7b repair: additive actual-source cases for the Number-and-clamp/fallback pipeline (the declared parser classes
  // in the repair packet). Existing cases above are untouched so the checked-in corpus grows additively.
  {name: 'fill-to-whitespace-is-number', env: {BOTS_FILL_TO: ' '}},
  {name: 'fill-to-tab-and-space', env: {BOTS_FILL_TO: '\t 6 \n'}},
  {name: 'fill-to-empty-falls-back', env: {BOTS_FILL_TO: ''}},
  {name: 'fill-to-exact-half-rounds-up', env: {BOTS_FILL_TO: '2.5'}},
  {name: 'fill-to-near-half-double', env: {BOTS_FILL_TO: '0.49999999999999994'}},
  {name: 'fill-to-hex', env: {BOTS_FILL_TO: '0x6'}},
  {name: 'fill-to-uppercase-hex', env: {BOTS_FILL_TO: '0X7'}},
  {name: 'fill-to-binary', env: {BOTS_FILL_TO: '0b101'}},
  {name: 'fill-to-octal', env: {BOTS_FILL_TO: '0o7'}},
  {name: 'fill-to-signed-radix-is-nan', env: {BOTS_FILL_TO: '+0x10'}},
  {name: 'fill-to-negative-radix-is-nan', env: {BOTS_FILL_TO: '-0x10'}},
  {name: 'fill-to-empty-radix-is-nan', env: {BOTS_FILL_TO: '0x'}},
  {name: 'fill-to-bad-radix-digit', env: {BOTS_FILL_TO: '0x1g'}},
  {name: 'fill-to-scientific', env: {BOTS_FILL_TO: '2e0'}},
  {name: 'fill-to-uppercase-scientific', env: {BOTS_FILL_TO: '3E0'}},
  {name: 'fill-to-invalid-tail', env: {BOTS_FILL_TO: '12abc'}},
  {name: 'fill-to-rust-inf-spelling-is-nan', env: {BOTS_FILL_TO: 'inf'}},
  {name: 'fill-to-lowercase-infinity-is-nan', env: {BOTS_FILL_TO: 'infinity'}},
  {name: 'fill-to-positive-infinity-falls-back', env: {BOTS_FILL_TO: 'Infinity'}},
  {name: 'fill-to-negative-infinity-falls-back', env: {BOTS_FILL_TO: '-Infinity'}},
  {name: 'fill-to-nan-spells-fall-back', env: {BOTS_FILL_TO: 'NaN'}},
  {name: 'fill-to-plus-decimal', env: {BOTS_FILL_TO: '+7'}},
  {name: 'fill-to-leading-zeros', env: {BOTS_FILL_TO: '007'}},
  {name: 'fill-to-fraction-only', env: {BOTS_FILL_TO: '.9'}},
  {name: 'fill-to-trailing-dot', env: {BOTS_FILL_TO: '5.'}},
  {name: 'arrival-empty-falls-back', env: {BOTS_ARRIVAL_SECONDS: ''}},
  {name: 'arrival-whitespace-is-zero', env: {BOTS_ARRIVAL_SECONDS: ' '}},
  {name: 'arrival-scientific', env: {BOTS_ARRIVAL_SECONDS: '1e3'}},
  {name: 'arrival-hex', env: {BOTS_ARRIVAL_SECONDS: '0x10'}},
  {name: 'arrival-binary', env: {BOTS_ARRIVAL_SECONDS: '0b11'}},
  {name: 'arrival-octal', env: {BOTS_ARRIVAL_SECONDS: '0o20'}},
  {name: 'arrival-signed-radix-is-nan', env: {BOTS_ARRIVAL_SECONDS: '-0o20'}},
  {name: 'arrival-infinity-falls-back', env: {BOTS_ARRIVAL_SECONDS: 'Infinity'}},
  {name: 'latency-scientific', env: {BOTS_LATENCY_MS: '1.2e2', BOTS_JITTER_MS: '0x8'}},
  {name: 'latency-whitespace-falls-to-zero', env: {BOTS_LATENCY_MS: ' '}},
  {name: 'jitter-lowercase-infinity-is-nan', env: {BOTS_JITTER_MS: 'infinity'}},
  {name: 'seed-decimal', env: {BOTS_SEED: '7.9'}},
  {name: 'seed-negative-wraps', env: {BOTS_SEED: '-1'}},
  {name: 'seed-negative-fraction-wraps', env: {BOTS_SEED: '-1.5'}},
  {name: 'seed-hex', env: {BOTS_SEED: '0x10'}},
  {name: 'seed-binary', env: {BOTS_SEED: '0b11'}},
  {name: 'seed-octal', env: {BOTS_SEED: '0o17'}},
  {name: 'seed-scientific', env: {BOTS_SEED: '1e3'}},
  {name: 'seed-signed-radix-is-null', env: {BOTS_SEED: '+0x10'}},
  {name: 'seed-whitespace-is-null', env: {BOTS_SEED: ' '}},
  {name: 'seed-empty-is-null', env: {BOTS_SEED: ''}},
  {name: 'seed-trimmed-decimal', env: {BOTS_SEED: ' +12 '}},
  {name: 'seed-nan-variants-are-null', env: {BOTS_SEED: 'NaN'}},
  {name: 'seed-lowercase-infinity-is-null', env: {BOTS_SEED: 'infinity'}},
  {name: 'seed-rust-inf-spelling-is-null', env: {BOTS_SEED: 'inf'}},
  {name: 'seed-modulo', env: {BOTS_SEED: '4294967296'}},
  {name: 'seed-negative-modulo', env: {BOTS_SEED: '-4294967297'}},
  {name: 'stats-file-unset-is-default', env: {}},
  {name: 'stats-file-empty-is-default', env: {BOT_STATS_FILE: ''}},
  {name: 'stats-file-whitespace-is-default', env: {BOT_STATS_FILE: '   '}},
  {name: 'stats-file-tab-around-off', env: {BOT_STATS_FILE: '\toff\t'}},
  {name: 'stats-file-off-lower', env: {BOT_STATS_FILE: 'off'}},
  {name: 'stats-file-off-upper', env: {BOT_STATS_FILE: 'OFF'}},
  {name: 'stats-file-off-spaced', env: {BOT_STATS_FILE: ' off '}},
  {name: 'stats-file-path', env: {BOT_STATS_FILE: '/var/raid/bots.json'}},
  {name: 'stats-file-relative-path', env: {BOT_STATS_FILE: 'data/offline.json'}},
  {name: 'stats-file-offx-is-a-path', env: {BOT_STATS_FILE: 'OFFX'}},
  {name: 'mix-hex-weights', env: {BOTS_TIER_MIX: 'easy:0x10,normal:2'}},
  {name: 'mix-scientific-and-signed', env: {BOTS_TIER_MIX: 'easy: 1e2 , normal:+4'}},
  {name: 'mix-infinity-ignored', env: {BOTS_TIER_MIX: 'easy:Infinity,normal:1'}},
  {name: 'mix-lowercase-infinity-ignored', env: {BOTS_TIER_MIX: 'easy:infinity,normal:2'}},
  {name: 'mix-signed-radix-ignored', env: {BOTS_TIER_MIX: 'easy:-0x10,normal:2'}},
  {name: 'mix-binary-weight', env: {BOTS_PERSONA_MIX: 'farmer:0b10,hunter:1'}},
  {name: 'mix-whitespace-weight-is-one', env: {BOTS_TIER_MIX: 'easy:   ,normal:1'}},
  {name: 'mix-underscore-invalid', env: {BOTS_TIER_MIX: 'easy:1_0,normal:2'}},
];

/// Raw ECMAScript Number() cases, captured from the same engine the source config uses: the decimal/scientific,
/// whitespace/empty, radix, signed-radix, Infinity/NaN and invalid-text classes the repair packet names.
const NUMBER_CASES = [
  '', ' ', '\t\n', '12', '+12', '-12', '12.5', '.5', '5.', '007', '1e3', '1E+3', '1e-3', '1e', '.', '+',
  '0x10', '0X1f', '0b101', '0B11', '0o17', '0O10', '+0x10', '-0x10', '0x', '0xg', '0x1p3',
  '12abc', 'abc', 'NaN', 'nan', 'Infinity', '+Infinity', '-Infinity', 'infinity', 'inf',
  '1_000', ' 0x10 ', '\u00a0 5 \u00a0', '- 5', '+ 5', '0x1fffffffffffff', '0xffffffffffffffff',
  '0x100000000000000000000000000000000',
];

function runConfig(c: any): any {
  const env: any = {NODE_ENV: 'development', ...c.env};
  const cfg = loadConfig(env);
  const statsFile = cfg.bots.statsFile;
  return {
    name: c.name,
    env: c.env,
    bots: {
      fillTo: cfg.bots.fillTo,
      arrivalSeconds: cfg.bots.arrivalSeconds,
      tierMix: cfg.bots.tierMix,
      personaMix: cfg.bots.personaMix,
      latencyMs: cfg.bots.latencyMs,
      jitterMs: cfg.bots.jitterMs,
      seed: cfg.bots.seed,
      statsFile: statsFile === null ? null : statsFile === '' ? '' : 'file',
    },
  };
}

function runNumber(text: string): any {
  const n = Number(text);
  if (Number.isNaN(n)) return {text, kind: 'nan'};
  if (n === Infinity) return {text, kind: '+inf'};
  if (n === -Infinity) return {text, kind: '-inf'};
  return {text, kind: 'number', value: n, negativeZero: Object.is(n, -0)};
}

const delay = DELAY_CASES.map(runDelay);
const mixes = MIX_CASES.map((c) => ({
  name: c.name,
  raw: c.raw ?? null,
  ids: c.ids,
  expected: parseMix(c.raw, c.ids, c.fallback),
}));
const config = CONFIG_CASES.map(runConfig);
const numbers = NUMBER_CASES.map(runNumber);

const sourceFiles = ['packages/shared/src', 'packages/server/src'].flatMap((dir) =>
  readdirSync('/repo/' + dir, {recursive: true}).filter((p: string) => p.endsWith('.ts')).map((p: string) => dir + '/' + p),
);
const sourceSha256 = Object.fromEntries(sourceFiles.map((p: string) => [p, createHash('sha256').update(readFileSync('/repo/' + p)).digest('hex')]));
const body = {
  format: 'rh-bot-runtime-source/1',
  provenance: {
    image: 'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',
    platform: 'linux/amd64',
    node: process.version,
    sourceSha256,
  },
  delay,
  mixes,
  config,
  numbers,
};
const text = JSON.stringify(body, null, 1) + '\n';
const sha = createHash('sha256').update(text).digest('hex');
if (args[0] === '--write') {
  writeFileSync(outPath, text);
  console.log(JSON.stringify({written: outPath, bytes: text.length, sha256: sha, delay: delay.length, mixes: mixes.length, config: config.length, numbers: numbers.length}));
} else {
  const existing = readFileSync(outPath, 'utf8');
  assert.equal(createHash('sha256').update(existing).digest('hex'), sha, 'the checked-in corpus is byte-identical');
  console.log(JSON.stringify({checked: outPath, bytes: existing.length, sha256: sha}));
}

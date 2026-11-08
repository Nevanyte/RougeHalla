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

const delay = DELAY_CASES.map(runDelay);
const mixes = MIX_CASES.map((c) => ({
  name: c.name,
  raw: c.raw ?? null,
  ids: c.ids,
  expected: parseMix(c.raw, c.ids, c.fallback),
}));
const config = CONFIG_CASES.map(runConfig);

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
};
const text = JSON.stringify(body, null, 1) + '\n';
const sha = createHash('sha256').update(text).digest('hex');
if (args[0] === '--write') {
  writeFileSync(outPath, text);
  console.log(JSON.stringify({written: outPath, bytes: text.length, sha256: sha, delay: delay.length, mixes: mixes.length, config: config.length}));
} else {
  const existing = readFileSync(outPath, 'utf8');
  assert.equal(createHash('sha256').update(existing).digest('hex'), sha, 'the checked-in corpus is byte-identical');
  console.log(JSON.stringify({checked: outPath, bytes: existing.length, sha256: sha}));
}

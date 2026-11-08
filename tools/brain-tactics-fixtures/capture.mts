// Canonical actual-source brain path-service and away-point witness (P-BOTS-3), pinned linux/amd64 Node 22.23.4.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {TILE} from '/repo/packages/shared/src/index.ts';
import {mapFromTiles} from '/repo/packages/shared/src/map.ts';
import {createPathBudget, createPathService} from '/repo/packages/server/src/bots/brain/services.ts';
import {awayPoint} from '/repo/packages/server/src/bots/brain/tactics/kite.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string');
const [, outPath] = args;
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const mapInput = JSON.parse(readFileSync('/capture/declared-map-input.json', 'utf8'));
const map = mapFromTiles(mapInput.w, mapInput.h, Uint8Array.from(mapInput.tiles), mapInput.seed ?? 0);
const BUDGET = 3;
const budget = createPathBudget(BUDGET);
const svc = createPathService(map, budget);
const script = [];
const push = (op, data, result) => script.push({op, ...data, result, stats: {...svc.stats}, left: budget.left});
const frame = (now, gated) => { budget.startTick(); svc.setFrame(now, gated); script.push({op: 'frame', now, gated, stats: {...svc.stats}, left: budget.left}); };
const pt = (x, y) => ({x, y});
const P = [pt(80, 80), pt(80, 400), pt(400, 400), pt(720, 720), pt(400, 80), pt(720, 80)];
const walk = (from, to) => { const r = svc.walk(from, to); push('walk', {from, to}, r === null ? null : {dist: r6(r.dist), exact: r.exact}); };
const path = (from, to) => { const r = svc.path(from, to); push('path', {from, to}, r === null ? null : r.map((p) => ({x: r6(p.x), y: r6(p.y)}))); };
const los = (a, b) => push('los', {a, b}, svc.los(a, b));
const clear = (a, b) => push('clear', {a, b}, svc.clear(a, b));

frame(0, false);
walk(P[0], P[3]);
walk(P[0], P[3]); // cache hit
path(P[0], P[3]);
los(P[0], P[3]);
clear(P[0], P[3]);
walk(P[1], P[5]);
walk(P[2], pt(400, 500)); // budget spent -> fallback
path(P[2], pt(400, 500)); // fallback -> null
frame(50, false);
walk(P[0], P[3]); // cache hit still
walk(P[2], pt(400, 500)); // fresh search
frame(1500, false);
walk(P[0], P[3]); // stale-cache search window
frame(2500, false);
walk(P[0], P[3]);
frame(9500, false);
walk(P[0], P[3]); // stale expired -> new search
walk(pt(88, 80), pt(720, 728)); // key rounding shares a stale trip
frame(40000, true);
walk(P[0], P[3]); // prune swept; gated key differs
walk(P[0], P[3]);
frame(40100, false);
walk(P[0], P[3]);
// Unreachable / invalid inputs.
walk(pt(16, 16), pt(80, 400)); // start in a wall snaps or answers no path
walk(pt(NaN, 0), P[1]);
path(pt(80, 80), pt(16, 16));
const PTS = [pt(80, 400), pt(85, 400), pt(400, 400), pt(600, 400), pt(500, 500), pt(16, 16), pt(400, 80)];
for (const self of PTS) {
  for (const threat of [pt(400, 400), pt(80, 400), pt(700, 700)]) {
    for (const jitter of [0, 0.4]) {
      const at = awayPoint(svc, self, threat, 300, jitter);
      script.push({op: 'away', self, threat, stepU: 300, jitter, result: at === null ? null : {x: r6(at.x), y: r6(at.y)}});
    }
  }
}
const SOURCE = [
  'packages/server/src/bots/brain/services.ts', 'packages/server/src/bots/brain/tactics/kite.ts',
  'packages/server/src/bots/brain/types.ts', 'packages/server/src/bots/mobHunt.ts',
  'packages/shared/src/pathfind.ts', 'packages/shared/src/geometry.ts', 'packages/shared/src/map.ts',
];
const sha = (p) => createHash('sha256').update(readFileSync('/repo/' + p)).digest('hex');
const dirs = ['packages/shared/src', 'packages/server/src/sim', 'packages/server/src/bots'];
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
const listing = dirs.map((d) => d + String.fromCharCode(10) + dirHash(d)).join(String.fromCharCode(10, 10));
const corpus = {
  format: 'rh-bot-paths-source/1',
  profile: {
    node: process.version, platform: process.platform, arch: process.arch,
    map: {w: map.w, h: map.h, seed: mapInput.seed ?? 0, tiles: Array.from(map.tiles)},
    budgetPerTick: BUDGET,
    sourceFiles: Object.fromEntries(SOURCE.map((p) => [p, sha(p)])),
    sourceTree: createHash('sha256').update(listing).digest('hex'),
    tool: sha('tools/brain-tactics-fixtures/capture.mts'),
  },
  script,
};
corpus.profile.captureSha256 = createHash('sha256').update(JSON.stringify(corpus)).digest('hex');
const out = JSON.stringify(corpus, null, 1) + String.fromCharCode(10);
if (args[0] === '--write') { writeFileSync(outPath, out); console.log('captured ' + script.length + ' script steps'); }
else { assert.equal(readFileSync(outPath, 'utf8'), out, 'the checked-in tactics corpus differs from the source capture'); console.log('tactics corpus matches: ' + outPath); }

'use strict';
// P-UNITY-LOOK-TOOLS-1 oracle: look-compare.py on small generated images, and look-capture.sh's argument handling (no Unity needed).
// Contract: docs/backlog/packets/P-UNITY-LOOK-TOOLS-1.md, Established facts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const COMPARE = path.join(__dirname, 'look-compare.py');
const CAPTURE = path.join(__dirname, 'look-capture.sh');

// ---- a minimal PNG writer (8-bit RGB, filter 0) ----
const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, px) {   // px(x, y) -> [r, g, b]
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = px(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = p[0]; raw[o + 1] = p[1]; raw[o + 2] = p[2]; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function pngSize(file) { const b = fs.readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'look-compare-'));
const base = (x, y) => [(x * 4) & 255, (y * 4) & 255, 90];
const write = (name, w, h, px) => { const f = path.join(dir, name); fs.writeFileSync(f, png(w, h, px)); return f; };
const run = (cmd, args, opts) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const compare = (...args) => run('python3', [COMPARE, ...args]);
function fields(line) { const o = {}; for (const kv of line.trim().split(/\s+/)) { const i = kv.indexOf('='); assert.ok(i > 0, 'key=value expected, got: ' + kv); o[kv.slice(0, i)] = kv.slice(i + 1); } return o; }

const A = write('a.png', 64, 48, base);

test('identical images: zero differing pixels, one key=value line, exit 0', () => {
  const B = write('a-copy.png', 64, 48, base);
  const r = compare(A, B);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim().split('\n').length, 1, 'one line');
  const f = fields(r.stdout);
  assert.equal(f.diff_px, '0'); assert.equal(f.total_px, String(64 * 48)); assert.equal(f.max, '0'); assert.equal(Number(f.mean), 0);
  assert.equal(f.size, '64x48'); assert.equal(f.bbox, 'none');
});

test('one pixel off by one step in one channel: 1 pixel, max 1, mean 1/(3*pixels), bbox is that pixel', () => {
  const B = write('one.png', 64, 48, (x, y) => (x === 5 && y === 7 ? [base(x, y)[0] + 1, base(x, y)[1], base(x, y)[2]] : base(x, y)));
  const r = compare(A, B);
  assert.equal(r.status, 0, r.stderr);
  const f = fields(r.stdout);
  assert.equal(f.diff_px, '1'); assert.equal(f.max, '1');
  assert.ok(Math.abs(Number(f.mean) - 1 / (3 * 64 * 48)) < 1e-6, 'mean ' + f.mean);
  assert.equal(f.bbox, '5,7,5,7', 'x0,y0,x1,y1 inclusive');
});

test('a 10 x 10 block changed by 40 in every channel: 100 pixels, max 40, its bounding box', () => {
  const B = write('block.png', 64, 48, (x, y) => (x >= 20 && x < 30 && y >= 30 && y < 40 ? base(x, y).map((v) => v + 40) : base(x, y)));
  const r = compare(A, B);
  assert.equal(r.status, 0, r.stderr);
  const f = fields(r.stdout);
  assert.equal(f.diff_px, '100'); assert.equal(f.max, '40');
  assert.ok(Math.abs(Number(f.mean) - (100 * 40) / (64 * 48)) < 1e-3, 'mean ' + f.mean);
  assert.equal(f.bbox, '20,30,29,39');
});

test('--crop writes the changed region of the second image beside it, exactly the bounding box', () => {
  const B = write('crop-after.png', 64, 48, (x, y) => (x >= 20 && x < 30 && y >= 30 && y < 40 ? [255, 255, 255] : base(x, y)));
  const r = compare(A, B, '--crop');
  assert.equal(r.status, 0, r.stderr);
  const crop = path.join(dir, 'crop-after-diff-crop.png');
  assert.ok(fs.existsSync(crop), 'expected ' + crop);
  assert.deepEqual(pngSize(crop), [10, 10]);
  assert.equal(fields(r.stdout).crop, crop, 'the line names the written file');
});

test('--noise adds the figures of two renders of one tree with a noise_ prefix; alone it prints only those', () => {
  const N1 = write('n1.png', 64, 48, base), N2 = write('n2.png', 64, 48, (x, y) => (x === 0 && y === 0 ? [1, 0, 90] : base(x, y)));
  const B = write('b.png', 64, 48, (x, y) => (x < 8 ? [0, 0, 0] : base(x, y)));
  const both = fields(compare(A, B, '--noise', N1, N2).stdout);
  assert.ok(Number(both.diff_px) > 0); assert.equal(both.noise_diff_px, '1'); assert.equal(both.noise_max, '1'); assert.ok('noise_mean' in both);
  const only = compare('--noise', N1, N2);
  assert.equal(only.status, 0, only.stderr);
  const f = fields(only.stdout);
  assert.equal(f.noise_diff_px, '1'); assert.ok(!('diff_px' in f), 'no before/after figures without the two images');
});

test('different sizes are refused: exit 2, nothing on stdout, a message naming both sizes', () => {
  const B = write('small.png', 32, 48, base);
  const r = compare(A, B);
  assert.equal(r.status, 2);
  assert.equal(r.stdout.trim(), '');
  assert.match(r.stderr, /^look-compare: .*size/i);
  assert.match(r.stderr, /64x48/); assert.match(r.stderr, /32x48/);
});

test('a missing file is refused with a message naming it', () => {
  const r = compare(A, path.join(dir, 'nope.png'));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /look-compare: .*nope\.png/);
});

// ---- look-capture.sh: everything that does not start Unity ----
const PINNED = [];
for (const z of ['fire', 'plague', 'sentenced', 'holy', 'frost']) PINNED.push(z + '-scene', z + '-scene-dressed');
for (const k of ['cave', 'volcano', 'church', 'bog', 'hall']) {
  PINNED.push(k + '-wide', k + '-close');
  if (['cave', 'church', 'hall'].includes(k)) PINNED.push(k + '-inside');
  if (k === 'bog') PINNED.push(k + '-under');
  PINNED.push(k + '-rot-wide');
}
PINNED.push('volcano-edge-wide', 'volcano-edge-close', 'volcano-edge-rot-wide');

test('look-capture.sh --list prints exactly the pinned scene names, one per line, in order, exit 0', () => {
  const r = run('bash', [CAPTURE, '--list']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split('\n'), PINNED);
  assert.equal(PINNED.length, 32);
});

test('look-capture.sh refuses an unknown scene (exit 2, names it) before looking for an editor', () => {
  const r = run('bash', [CAPTURE, 'cave-wide', 'no-such-scene', '--out', dir], { env: { ...process.env, RH_UNITY_EDITOR: '/nonexistent/Unity' } });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /look-capture: unknown scene.*no-such-scene/);
});

test('look-capture.sh with no scene, or no --out, is a usage error (exit 2) that mentions --list', () => {
  const none = run('bash', [CAPTURE, '--out', dir]);
  assert.equal(none.status, 2); assert.match(none.stderr, /look-capture: .*--list/);
  const noOut = run('bash', [CAPTURE, 'cave-wide']);
  assert.equal(noOut.status, 2); assert.match(noOut.stderr, /look-capture: .*--out/);
});

test('look-capture.sh with a valid request and no editor installed exits 3 "unavailable", writes nothing', () => {
  const out = path.join(dir, 'never');
  const r = run('bash', [CAPTURE, 'cave-wide', '--out', out], { env: { ...process.env, RH_UNITY_EDITOR: '/nonexistent/Unity' } });
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /^look-capture: unavailable: /);
  assert.ok(!fs.existsSync(out), 'no output directory made when unavailable');
});

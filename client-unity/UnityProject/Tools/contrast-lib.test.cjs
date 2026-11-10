'use strict';
// node --test client-unity/UnityProject/Tools/contrast-lib.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./contrast-lib.cjs');

const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} expected ${b}, got ${a}`);

// ---- WCAG ----------------------------------------------------------------------------------------------------------------------

test('relative luminance follows WCAG 2.x (linearise, then 0.2126 / 0.7152 / 0.0722)', () => {
  near(L.relativeLuminance(255, 255, 255), 1, 1e-6);
  near(L.relativeLuminance(0, 0, 0), 0, 1e-9);
  near(L.relativeLuminance(255, 0, 0), 0.2126, 1e-6);
  near(L.relativeLuminance(0, 255, 0), 0.7152, 1e-6);
  near(L.relativeLuminance(0, 0, 255), 0.0722, 1e-6);
  // sRGB 128 is 0.21586 linear light (not 0.5).
  near(L.linearise(128), 0.2158605, 1e-6);
  // the linear segment below 0.04045
  near(L.linearise(10), (10 / 255) / 12.92, 1e-9);
});

test('contrast ratio is (Lhi + 0.05) / (Llo + 0.05) and order independent', () => {
  near(L.contrastRatio(1, 0), 21, 1e-9);
  near(L.contrastRatio(0, 1), 21, 1e-9);
  near(L.contrastRatio(0.5, 0.1), 0.55 / 0.15, 1e-9);
  near(L.contrastRatio(0.3, 0.3), 1, 1e-12);
});

test('encodeSrgb inverts linearise', () => {
  for (const code of [0, 1, 7, 50, 128, 200, 255]) assert.equal(L.encodeSrgb(L.linearise(code)), code);
});

test('percentile interpolates linearly and median handles even counts', () => {
  assert.equal(L.median([1, 3, 2]), 2);
  assert.equal(L.median([1, 2, 3, 4]), 2.5);
  near(L.percentile([0, 10, 20, 30, 40], 0.1), 4, 1e-12);   // index 0.4
  near(L.percentile([5], 0.1), 5, 1e-12);
  assert.ok(Number.isNaN(L.percentile([], 0.5)));
  near(L.percentile([3, 1, 2], 0), 1, 1e-12); near(L.percentile([3, 1, 2], 1), 3, 1e-12);
});

// ---- PNG and masks ---------------------------------------------------------------------------------------------------------------

test('PNG encode/decode round trip', () => {
  const w = 7, h = 5, px = new Uint8Array(w * h * 4);
  for (let i = 0; i < px.length; i++) px[i] = (i * 37 + 11) & 255;
  const out = L.decodePng(L.encodePng(w, h, px));
  assert.equal(out.width, w); assert.equal(out.height, h);
  assert.deepEqual(Array.from(out.data), Array.from(px));
});

test('mask pixels classify by channel threshold', () => {
  assert.equal(L.classifyMaskPixel(255, 0, 0), L.CLASS.SIL);
  assert.equal(L.classifyMaskPixel(0, 255, 0), L.CLASS.HP);
  assert.equal(L.classifyMaskPixel(0, 0, 255), L.CLASS.FOOT);
  assert.equal(L.classifyMaskPixel(255, 255, 0), L.CLASS.INSIGNIA);
  assert.equal(L.classifyMaskPixel(255, 0, 255), L.CLASS.OTHER);
  assert.equal(L.classifyMaskPixel(0, 255, 255), L.CLASS.RIM);
  assert.equal(L.classifyMaskPixel(0, 0, 0), L.CLASS.NONE);
  assert.equal(L.classifyMaskPixel(60, 60, 60), L.CLASS.NONE);
  assert.equal(L.classifyMaskPixel(255, 255, 255), L.CLASS.NONE);
});

// ---- morphology ----------------------------------------------------------------------------------------------------------------------

test('distance transform is Euclidean', () => {
  const w = 21, h = 21, f = new Uint8Array(w * h); f[10 * w + 10] = 1;
  const d = L.distanceTo(f, w, h);
  near(d[10 * w + 10], 0, 1e-6); near(d[10 * w + 13], 3, 1e-5); near(d[13 * w + 14], 5, 1e-5); near(d[0], Math.hypot(10, 10), 1e-4);
});

test('distance transform with no feature is huge, not NaN', () => {
  const d = L.distanceTo(new Uint8Array(16), 4, 4);
  assert.ok(d.every(v => v > 1e6 && Number.isFinite(v)));
});

test('dilate by 3 of one pixel is the 29-pixel discrete disc; erode undoes it', () => {
  const w = 21, h = 21, f = new Uint8Array(w * h); f[10 * w + 10] = 1;
  const big = L.dilate(f, w, h, 3);
  assert.equal(big.reduce((a, b) => a + b, 0), 29);
  const back = L.erode(big, w, h, 3);
  assert.equal(back.reduce((a, b) => a + b, 0), 1); assert.equal(back[10 * w + 10], 1);
});

// ---- synthetic images with known answers ---------------------------------------------------------------------------------------------

/** Build a frame: ground luminance g, a disc of luminance d, optional extras. Returns the inputs analyzeCell wants. */
function discFrame({ width = 200, height = 200, cx = 100, cy = 100, r = 30, ground = 0.1, disc = 0.5, discFn = null, extra = null } = {}) {
  const lum = new Float32Array(width * height).fill(ground), mask = new Uint8Array(width * height).fill(L.CLASS.NONE);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
    if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) { lum[y * width + x] = discFn ? discFn(x, y) : disc; mask[y * width + x] = L.CLASS.SIL; }
  if (extra) extra(lum, mask, width, height);
  return { width, height, lumNormal: lum, lumGround: new Float32Array(width * height).fill(ground), mask, rect: { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r } };
}

test('a 0.5 disc on 0.1 ground reports the analytic ratio (0.55 / 0.15) in every sector', () => {
  const res = L.analyzeCell(discFrame());
  assert.ok(res.valid, res.reason);
  const expected = 0.55 / 0.15;
  near(res.edge.p10, expected, 1e-4, 'p10'); near(res.edge.min, expected, 1e-4, 'min'); near(res.edge.median, expected, 1e-4, 'median');
  assert.equal(res.edge.sectors, 16);
  near(res.body.ratio, expected, 1e-4, 'body');
  near(res.edge.ground.p10, expected, 1e-4, 'ground');
});

test('a dark disc on lighter ground uses the same symmetric ratio', () => {
  const res = L.analyzeCell(discFrame({ ground: 0.5, disc: 0.1 }));
  near(res.edge.min, 0.55 / 0.15, 1e-4); near(res.body.ratio, 0.55 / 0.15, 1e-4);
});

test('equal luminance gives ratio 1', () => {
  const res = L.analyzeCell(discFrame({ ground: 0.3, disc: 0.3 }));
  near(res.edge.min, 1, 1e-9); near(res.body.ratio, 1, 1e-9);
});

test('contour is the outer 2 px and interior is the rest: dark outline + bright body', () => {
  // Body 0.8, with a 2 px outline at 0.02 on 0.2 ground. Contour = the outline, body = the interior.
  const r = 30, cx = 100, cy = 100;
  const res = L.analyzeCell(discFrame({ r, ground: 0.2, discFn: (x, y) => ((Math.hypot(x - cx, y - cy)) > r - 1.5 ? 0.02 : 0.8) }));
  assert.ok(res.valid, res.reason);
  near(res.edge.min, 0.25 / 0.07, 0.02, 'edge is the outline against the ground');
  near(res.body.ratio, 0.85 / 0.25, 0.02, 'body is the interior against the ground');
});

test('per-sector statistics: half dark outline, half bright rim -> min and p10 are the dark half, median is between', () => {
  // Left half of the contour is dark (0.01), right half is light (0.9); ground 0.1. Dark half: 0.15/0.06 = 2.5, light half: 0.95/0.15 = 6.333.
  const r = 30, cx = 100, cy = 100;
  const res = L.analyzeCell(discFrame({ r, ground: 0.1, discFn: (x, y) => (Math.hypot(x - cx, y - cy) > r - 2.5 ? (x < cx ? 0.01 : 0.9) : 0.5) }));
  assert.ok(res.valid, res.reason);
  near(res.edge.min, 0.15 / 0.06, 0.05, 'min'); near(res.edge.p10, 0.15 / 0.06, 0.05, 'p10');
  assert.ok(res.edge.median > 2.6 && res.edge.median < 6.3, `median ${res.edge.median}`);
  const dark = res.edge.ratios.filter(v => v < 3).length, light = res.edge.ratios.filter(v => v > 6).length;
  assert.ok(dark >= 7 && light >= 7, `dark ${dark} light ${light}`);
});

test('a neighbour actor inside the ring neither counts as ground nor as this silhouette', () => {
  // A second (SIL) disc next to the first, very bright: it must not change the first one's numbers.
  const base = L.analyzeCell(discFrame());
  const withNeighbour = L.analyzeCell(discFrame({
    extra: (lum, mask, w) => { for (let y = 80; y < 120; y++) for (let x = 148; x < 178; x++) { lum[y * w + x] = 1; mask[y * w + x] = L.CLASS.SIL; } }
  }));
  near(withNeighbour.edge.median, base.edge.median, 1e-4); near(withNeighbour.edge.min, base.edge.min, 1e-4);
});

test('ring is 3..12 px out: ground at 2 px or beyond 12 px does not count', () => {
  // Ground differs in a thin band (1..2 px out: excluded), the ring band (3..12 out) is 0.1, and the far field is 0.9: only the ring counts.
  const r = 30, cx = 100, cy = 100;
  const res = L.analyzeCell(discFrame({ r, ground: 0.1, extra: (lum, mask, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy) - r;
      if (d > 0 && d < 2.5) lum[y * w + x] = 0.7; else if (d > 12.5) lum[y * w + x] = 0.9;
    }
  } }));
  near(res.edge.min, 0.55 / 0.15, 1e-4);
});

test('a light rim at ground luminance hides the edge; the core alone shows the dark outline', () => {
  // Dark core (0.01) inside a 4 px rim whose luminance equals the ground (0.5): the silhouette as drawn ends in the rim, so EDGE is ~1; the core edge is (0.55)/(0.06).
  const r = 30, cx = 100, cy = 100;
  const frame = discFrame({ r, ground: 0.5, disc: 0.01, extra: (lum, mask, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const d = Math.hypot(x - cx, y - cy); if (d > r && d <= r + 4) { lum[y * w + x] = 0.5; mask[y * w + x] = L.CLASS.RIM; } }
  } });
  frame.rect = { x: cx - r - 4, y: cy - r - 4, w: 2 * (r + 4), h: 2 * (r + 4) };
  const res = L.analyzeCell(frame);
  assert.ok(res.valid, res.reason);
  near(res.edge.p10, 1, 1e-3, 'edge with rim'); near(res.edge.core.p10, 0.55 / 0.06, 0.02, 'core edge'); near(res.body.ratio, 0.55 / 0.06, 0.02, 'body is the core interior');
  assert.ok(res.edge.rimShare > 0.1 && res.edge.rimShare < 0.3, `rimShare ${res.edge.rimShare}`);
});

test('markers: a dark bar on 0.1 ground reports (0.1 + 0.05) / (bar + 0.05); an absent marker is null', () => {
  const frame = discFrame({ extra: (lum, mask, w) => {
    for (let y = 45; y < 55; y++) for (let x = 80; x < 120; x++) { lum[y * w + x] = 0.02; mask[y * w + x] = L.CLASS.HP; }
  } });
  frame.rect = { x: 70, y: 40, w: 60, h: 90 };    // the cell rectangle covers every drawn part, markers included
  const res = L.analyzeCell(frame);
  assert.ok(res.valid, res.reason);
  near(res.markers.hp.ratio, 0.15 / 0.07, 1e-3);
  assert.equal(res.markers.foot, null); assert.equal(res.markers.insignia, null);
});

test('an unmeasurable cell is reported invalid, never silently passed', () => {
  const frame = discFrame({ r: 3 });
  const res = L.analyzeCell(frame);
  assert.equal(res.valid, false); assert.match(res.reason, /silhouette mask/);
});

// ---- frame consistency ---------------------------------------------------------------------------------------------------------------

test('frame consistency: matching frames are consistent, a stale ground frame is caught', () => {
  const f = discFrame();
  const same = L.frameConsistency(f.lumNormal, f.lumGround, f.mask, f.width, f.height);
  assert.ok(same.far < 1e-6, `far ${same.far}`);
  assert.ok(same.inside > 1, `inside ${same.inside}`);                 // (0.5 - 0.1) / (0.1 + 0.05) = 2.67 where the actor is
  const stale = L.frameConsistency(f.lumNormal.map(v => v * 0.5), f.lumGround, f.mask, f.width, f.height);
  assert.ok(stale.far > 0.2, `far ${stale.far}`);
  const flat = L.frameConsistency(f.lumGround, f.lumGround, f.mask, f.width, f.height);   // actors missing from the normal frame
  assert.ok(flat.inside < 1e-6);
});

// ---- arguments -------------------------------------------------------------------------------------------------------------------------

test('parseArgs defaults match the gate definition', () => {
  const o = L.parseArgs([]);
  assert.equal(o.edge, 3.0); assert.equal(o.marker, 4.5);
  assert.deepEqual(o.sizes, [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }]);
  assert.deepEqual(o.quality, ['high', 'ultra']); assert.deepEqual(o.zones, L.ZONES);
  assert.equal(o.url, 'http://127.0.0.1:8187/');
});

test('parseArgs reads every option', () => {
  const o = L.parseArgs(['--url', 'http://127.0.0.1:9/', '--out', 'x', '--zones', 'Fire,holy', '--sizes', '1280x720', '--quality', 'ultra', '--edge', '2.5', '--marker', '4', '--query', 'facings=4', '--frames', '2', '--max-pages', '3']);
  assert.equal(o.url, 'http://127.0.0.1:9/'); assert.equal(o.out, 'x'); assert.deepEqual(o.zones, ['fire', 'holy']);
  assert.deepEqual(o.sizes, [{ width: 1280, height: 720 }]); assert.deepEqual(o.quality, ['ultra']);
  assert.equal(o.edge, 2.5); assert.equal(o.marker, 4); assert.equal(o.query, '&facings=4'); assert.equal(o.frames, 2); assert.equal(o.maxPages, 3);
  assert.equal(L.parseArgs(['--query', '&a=1']).query, '&a=1');
});

test('parseArgs rejects bad input', () => {
  assert.throws(() => L.parseArgs(['--zones', 'mars']), /unknown zone/);
  assert.throws(() => L.parseArgs(['--sizes', '1920']), /bad size/);
  assert.throws(() => L.parseArgs(['--quality', 'extreme']), /unknown quality/);
  assert.throws(() => L.parseArgs(['--edge', 'x']), /positive/);
  assert.throws(() => L.parseArgs(['--bogus']), /unknown option/);
  assert.throws(() => L.parseArgs(['--url']), /needs a value/);
});

test('cellKind separates plain ground, props, edges and seams', () => {
  assert.equal(L.cellKind(''), 'ground'); assert.equal(L.cellKind(null), 'ground'); assert.equal(L.cellKind('fire.rocks'), 'props');
  assert.equal(L.cellKind('edge:Basalt|Lava'), 'edge'); assert.equal(L.cellKind('seam:fire|sentenced'), 'seam');
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./perf-run.cjs');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('percentile is nearest-rank and ignores non-finite values', () => {
  const v = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(P.percentile(v, .5), 50);
  assert.equal(P.percentile(v, .95), 95);
  assert.equal(P.percentile(v, .99), 99);
  assert.equal(P.percentile(v, 1), 100);
  assert.equal(P.percentile(v, 0), 1);
  assert.equal(P.percentile([5, NaN, Infinity, 3], .5), 3);
  assert.equal(P.percentile([], .5), null);
  assert.equal(P.percentile([7], .99), 7);
  assert.equal(P.percentile([3, 1, 2], .5), 2, 'order independent');
});

test('worst 1% mean averages the slowest 1% and at least one frame', () => {
  const v = Array(98).fill(6.9).concat([20, 40]);
  near(P.worstOnePercentMean(v), 40); // ceil(100*.01) = 1 frame
  const w = Array(198).fill(6.9).concat([20, 40]);
  near(P.worstOnePercentMean(w), 30);                 // 2 frames
  near(P.worstOnePercentMean([5]), 5);
  assert.equal(P.worstOnePercentMean([]), null);
});

test('frameStats reports percentiles, fps and dropped frames against the refresh', () => {
  const v = Array(990).fill(1000 / 144).concat(Array(10).fill(25));
  const s = P.frameStats(v, 144);
  assert.equal(s.count, 1000);
  near(s.p50Ms, 1000 / 144);
  near(s.p95Ms, 1000 / 144);
  near(s.p99Ms, 1000 / 144);
  near(s.worst1PctMeanMs, 25);
  near(s.worst1PctFps, 40);
  assert.equal(s.droppedFrames, 10);
  near(s.droppedPct, 1);
  near(s.droppedLimitMs, 1.5 * 1000 / 144);
  assert.equal(P.frameStats([], 144).count, 0);
  assert.equal(P.frameStats([10, 10]).droppedFrames, undefined, 'no refresh, no dropped-frame claim');
});

test('evaluate: the owner criteria are p95 <= 6.94 ms and worst 1% >= 120 fps', () => {
  assert.equal(P.TARGET.p95Ms, 6.94);
  assert.equal(P.TARGET.worst1PctMs, 8.33);
  const good = { count: 100, p95Ms: 6.94, worst1PctMeanMs: 8.33, worst1PctFps: 120.05 };
  assert.equal(P.evaluate(good, { displayVerified: true }).verdict, 'PASS');
  assert.equal(P.evaluate({ ...good, p95Ms: 6.95 }, { displayVerified: true }).verdict, 'FAIL');
  assert.equal(P.evaluate({ ...good, worst1PctMeanMs: 8.34 }, { displayVerified: true }).verdict, 'FAIL');
  assert.equal(P.evaluate({ count: 0 }, { displayVerified: true }).verdict, 'FAIL');
});

test('evaluate never claims the target on an unverified display or with vsync off', () => {
  const good = { count: 100, p95Ms: 5, worst1PctMeanMs: 6 };
  const a = P.evaluate(good, { displayVerified: false });
  assert.match(a.verdict, /^PROVISIONAL/); assert.equal(a.claimable, false); assert.equal(a.meetsNumbers, true);
  const b = P.evaluate(good, { displayVerified: true, vsyncOff: true });
  assert.match(b.verdict, /^PROVISIONAL/);
  assert.match(P.evaluate({ ...good, p95Ms: 12 }, { displayVerified: false }).verdict, /miss/);
});

test('parseDisplays and displayMatchesTarget read system_profiler output', () => {
  const text = [
    'Graphics/Displays:', '', '    Apple M5 Pro:', '', '      Displays:', '        LG UltraGear:',
    '          Resolution: 2560 x 1440 (QHD/WQHD - Wide Quad High Definition)',
    '          UI Looks like: 2560 x 1440 @ 144.00Hz', '          Main Display: Yes',
    '        Other Display:', '          Resolution: 1920 x 1080', '          UI Looks like: 1920 x 1080 @ 60.00Hz', ''].join('\n');
  const d = P.parseDisplays(text);
  assert.equal(d.length, 2);
  assert.deepEqual([d[0].width, d[0].height, d[0].refreshHz, d[0].main], [2560, 1440, 144, true]);
  assert.equal(P.displayMatchesTarget(d[0]), true);
  assert.equal(P.displayMatchesTarget(d[1]), false);
  assert.equal(P.displayMatchesTarget({ width: 2560, height: 1440, refreshHz: 60 }), false);
  assert.equal(P.displayMatchesTarget({ width: 2560, height: 1440, refreshHz: 143.9 }), true);
  assert.equal(P.displayMatchesTarget(null), false);
});

test('parseArgs: defaults, aliases, inline values and errors', () => {
  const d = P.parseArgs([]);
  assert.equal(d.quality, 'ultra'); assert.equal(d.seconds, 60); assert.equal(d.region, 'frost'); assert.equal(d.attribution, false);
  const o = P.parseArgs(['--quality', 'HIGH', '--faction', '2', '--seconds=30', '--url', 'http://localhost:9/', '--server', 'ws://h:1/ws',
    '--out', 'x', '--attribution', '--attrib-seconds', '10', '--flags', '?fx.bloom=0', '--uncapped', '--no-fullscreen']);
  assert.equal(o.quality, 'high'); assert.equal(o.region, 'plague'); assert.equal(o.seconds, 30); assert.equal(o.url, 'http://localhost:9/');
  assert.equal(o.attribution, true); assert.equal(o.attribSeconds, 10); assert.equal(o.flags, 'fx.bloom=0'); assert.equal(o.uncapped, true);
  assert.equal(o.fullscreen, false);
  assert.equal(P.parseArgs(['--region', 'Holy']).region, 'holy');
  assert.throws(() => P.parseArgs(['--quality', 'extreme']), /quality/);
  assert.throws(() => P.parseArgs(['--region', 'moon']), /region/);
  assert.throws(() => P.parseArgs(['--seconds', '0']), /seconds/);
  assert.throws(() => P.parseArgs(['--seconds']), /needs a value/);
  assert.throws(() => P.parseArgs(['--bogus']), /unknown argument/);
  assert.throws(() => P.parseArgs(['--server', 'http://x']), /ws/);
  assert.throws(() => P.parseArgs(['--url', 'nope']), /absolute/);
});

test('buildPageUrl carries the diagnostic join, perf flag, quality and extra effect flags', () => {
  const o = P.parseArgs(['--quality', 'ultra', '--region', 'frost']);
  const u = new URL(P.buildPageUrl(o, 'fx.bloom=0&fx.lights=2'));
  assert.equal(u.searchParams.get('diagnostic'), '1'); assert.equal(u.searchParams.get('token'), 't1');
  assert.equal(u.searchParams.get('profile'), 'perf1'); assert.equal(u.searchParams.get('faction'), '3');
  assert.equal(u.searchParams.get('perf'), '1'); assert.equal(u.searchParams.get('quality'), 'ultra');
  assert.equal(u.searchParams.get('fx.bloom'), '0'); assert.equal(u.searchParams.get('fx.lights'), '2');
  assert.equal(u.searchParams.get('server'), 'ws://127.0.0.1:7807/ws');
});

test('timeline is deterministic, balanced and always attacking and moving', () => {
  const a = P.buildTimeline(60), b = P.buildTimeline(60);
  assert.deepEqual(a, b);
  for (const k of ['w', 'a', 's', 'd']) {
    assert.equal(a.filter(e => e.kind === 'down' && e.key === k).length, a.filter(e => e.kind === 'up' && e.key === k).length, `key ${k} released`);
  }
  assert.equal(a.filter(e => e.kind === 'mdown').length, a.filter(e => e.kind === 'mup').length);
  assert.ok(a.filter(e => e.kind === 'mdown').length >= 15);
  assert.ok(a.every(e => e.t >= 0 && e.t <= 60));
  assert.ok(a.every((e, i) => i === 0 || a[i - 1].t <= e.t), 'sorted by time');
  assert.ok(a.filter(e => e.kind === 'move').every(e => e.fx > 0 && e.fx < 1 && e.fy > 0 && e.fy < 1));
  for (let t = 0; t < 60; t += 2) assert.ok(a.some(e => e.kind === 'down' && e.t <= t + 2 && e.t >= t), `movement starts every leg (${t})`);
});

test('toCsv writes index, timestamp and delta', () => {
  const csv = P.toCsv([100, 106.94, 113.88]).trim().split('\n');
  assert.equal(csv[0], 'frame,timestamp_ms,delta_ms');
  assert.equal(csv[1], '0,100.000,');
  assert.equal(csv[2], '1,106.940,6.940');
  assert.equal(csv.length, 4);
});

test('attributionTable ranks effects by the mean frame time they cost', () => {
  const base = { meanMs: 5, p50Ms: 5, p95Ms: 6 };
  const rows = P.attributionTable(base, [
    { name: 'a', flag: 'x=0', stats: { meanMs: 4.9, p50Ms: 4.9, p95Ms: 5.9, count: 10 } },
    { name: 'b', flag: 'y=0', stats: { meanMs: 3.5, p50Ms: 3.5, p95Ms: 4, count: 10 } },
    { name: 'c', flag: 'z=0', stats: { meanMs: 5.1, p50Ms: 5.1, p95Ms: 6, count: 10 } }]);
  assert.deepEqual(rows.map(r => r.effect), ['b', 'a', 'c']);
  near(rows[0].meanMsSaved, 1.5); near(rows[0].p95MsSaved, 2); assert.ok(rows[2].meanMsSaved < 0);
  assert.ok(P.ATTRIBUTION_TOGGLES.every(t => /^fx\.[a-z]+=/.test(t.flag)));
});

test('planning anchors land inside the planning rail', () => {
  const spawn = P.planningPoint(.5, .855), ready = P.planningPoint(.5, .085);
  assert.ok(spawn.fx > .75 && spawn.fx < .95);
  assert.ok(spawn.fy < ready.fy, 'Spawn is above Ready on screen');
  assert.ok(ready.fy > 0.4 && ready.fy < 0.8);
});

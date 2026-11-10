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
  assert.match(u.searchParams.get('profile'), /^perf1/); assert.equal(u.searchParams.get('faction'), '3');
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

test('an attribution round puts a baseline before every effect and ends on a baseline; groups are small', () => {
  const toggles = [{ name: 'a', flag: 'fx.a=0' }, { name: 'b', flag: 'fx.b=0' }];
  const plan = P.attributionRound(toggles);
  assert.deepEqual(plan.map(p => p.effect), [null, 'a', null, 'b', null]);
  for (let i = 0; i < plan.length; i++) if (plan[i].effect) assert.equal(plan[i - 1].effect, null);
  assert.deepEqual(P.chunk([1, 2, 3, 4, 5, 6, 7], 3), [[1, 2, 3], [4, 5, 6], [7]]);
  assert.ok(P.ATTRIBUTION_TOGGLES.every(t => /^fx\.[a-z]+=/.test(t.flag)));
});

test('attributionFromWindows pairs each effect with its adjacent baseline and reports the noise floor', () => {
  const w = (round, effect, mean, p95) => ({ round, effect, flag: effect ? effect + '=0' : '', stats: { meanMs: mean, p50Ms: mean, p95Ms: p95, count: 100 } });
  const windows = [];
  for (let r = 0; r < 3; r++) {
    windows.push(w(r, null, 5.0 + r * 0.05, 6), w(r, 'big', 3.5 + r * 0.05, 4), w(r, null, 5.0, 6), w(r, 'tiny', 4.97, 6), w(r, null, 5.02, 6), w(r, 'neg', 5.1, 6.1));
  }
  const { rows, noiseMs } = P.attributionFromWindows(windows);
  assert.deepEqual(rows.map(r => r.effect), ['big', 'tiny', 'neg']);
  near(rows[0].meanMsSaved, 1.5, 1e-9); near(rows[0].p95MsSaved, 2); assert.equal(rows[0].rounds, 3); assert.equal(rows[0].clearOfNoise, true);
  assert.equal(rows[1].clearOfNoise, false, 'a 0.03 ms difference is inside the noise');
  assert.ok(rows[2].meanMsSaved < 0);
  assert.ok(noiseMs > 0 && noiseMs < 0.1);
});

test('planning anchors land inside the planning rail', () => {
  const spawn = P.planningPoint(.5, .855), ready = P.planningPoint(.5, .085);
  assert.ok(spawn.fx > .75 && spawn.fx < .95);
  assert.ok(spawn.fy < ready.fy, 'Spawn is above Ready on screen');
  assert.ok(ready.fy > 0.4 && ready.fy < 0.8);
});

test('smoothDeltas averages sliding windows and keeps real drops visible', () => {
  assert.deepEqual(P.smoothDeltas([1, 3, 5, 7], 2), [2, 4, 6]);
  assert.deepEqual(P.smoothDeltas([1, 2], 3), []);
  const jittery = Array.from({ length: 400 }, (_, i) => 6.944 + (i % 2 ? 1.2 : -1.2));
  const s = P.frameStats(jittery, 144);
  assert.ok(s.p95Ms > 6.94, 'literal p95 fails on pure jitter');
  assert.ok(s.smooth.p95Ms < 6.95, 'the smoothed series cancels it');
  const withDrop = jittery.slice(); withDrop[200] = 13.9;
  assert.ok(P.frameStats(withDrop, 144).smooth.maxMs > 7.5);
});

test('pacing read-out is informational and never rescues a literal FAIL', () => {
  const jittery = Array.from({ length: 1000 }, (_, i) => 6.9444 + (i % 2 ? 1.2 : -1.2));
  const stats = P.frameStats(jittery, 144);
  const v = P.evaluate(stats, { displayVerified: true });
  assert.equal(v.verdict, 'FAIL');
  assert.equal(v.pacing.clean, true);
  const dropped = P.frameStats(jittery.map((x, i) => (i % 100 === 0 ? 14 : x)), 144);
  assert.equal(P.evaluate(dropped, { displayVerified: true }).pacing.clean, false);
});

test('each run gets its own callsign unless one is given', () => {
  const o = P.parseArgs([]);
  const a = P.profileFor(o); o._profile = null; const b = P.profileFor(o);
  assert.match(a, /^perf1/); assert.notEqual(a, b); assert.ok(a.length <= 16);
  assert.equal(P.profileFor(P.parseArgs(['--profile', 'mine'])), 'mine');
});

test('validateRun rejects runs that never reached a populated match', () => {
  const good = { planning: { inMatchSeen: true }, netStates: [{ text: '[net] InMatch' }], wire: { framesReceived: 500 }, errors: [] };
  assert.equal(P.validateRun(good, { actors: { max: 12 } }).valid, true);
  const rejected = { ...good, planning: { inMatchSeen: false }, netStates: [{ text: '[net] Rejected ProfileInUse: callsign already in a match' }], wire: { framesReceived: 1 } };
  const v = P.validateRun(rejected, { actors: { max: 0 } });
  assert.equal(v.valid, false); assert.ok(v.problems.length >= 3);
  assert.equal(P.validateRun({ ...good, errors: ['boom'] }, { actors: { max: 3 } }).valid, true, 'console errors are reported, not fatal');
});

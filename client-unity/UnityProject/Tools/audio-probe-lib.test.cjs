'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./audio-probe-lib.cjs');

const sine = (f, sr, n, a = 1) => Array.from({ length: n }, (_, i) => a * Math.sin(2 * Math.PI * f * i / sr));

test('rms and peak of a sine', () => {
  const s = sine(440, 48000, 48000, 0.5);
  assert.ok(Math.abs(L.rms(s) - 0.5 / Math.SQRT2) < 1e-3);
  assert.ok(Math.abs(L.peak(s) - 0.5) < 1e-3);
  assert.equal(L.rms([]), 0);
});

test('dB conversions', () => {
  assert.ok(Math.abs(L.toDb(1)) < 1e-9);
  assert.ok(Math.abs(L.toDb(0.5) + 6.0206) < 1e-3);
  assert.equal(L.toDb(0), L.FLOOR_DB);
  assert.ok(Math.abs(L.fromDb(-20) - 0.1) < 1e-9);
});

test('detectPeaks finds separated maxima and merges close ones', () => {
  const t = [], v = []; for (let i = 0; i < 100; i++) { t.push(i * 50); v.push(0.01); }
  v[10] = 0.5; v[11] = 0.4; v[30] = 0.6; v[31] = 0.2; v[60] = 0.3;
  const p = L.detectPeaks(t, v, 0.1, 200);
  assert.deepEqual(p.map(x => x.i), [10, 30, 60]);
  const q = L.detectPeaks(t, v, 0.1, 5000);
  assert.deepEqual(q.map(x => x.i), [30]);
});

test('pairEvents matches each cue to the next peak and reports misses and extras', () => {
  const r = L.pairEvents([1000, 2000, 3000], [1080, 2100, 5000], 250);
  assert.equal(r.matched.length, 2);
  assert.deepEqual(r.missed, [3000]);
  assert.deepEqual(r.extra, [5000]);
  assert.equal(r.medianLagMs, 100);
  const dup = L.pairEvents([1000, 1010], [1050], 250);   // one peak cannot serve two cues
  assert.equal(dup.matched.length, 1);
});

test('medianInterval', () => { assert.equal(L.medianInterval([0, 300, 600, 920]), 300); assert.equal(L.medianInterval([5]), null); });

test('FFT puts a sine at the right bin and centroid orders low below high', () => {
  const sr = 48000, n = 2048;
  const lo = L.powerSpectrum(sine(1000, sr, n)), hi = L.powerSpectrum(sine(6000, sr, n));
  const c1 = L.centroidOfPower(lo, sr), c2 = L.centroidOfPower(hi, sr);
  assert.ok(Math.abs(c1 - 1000) < 100, 'centroid ' + c1);
  assert.ok(Math.abs(c2 - 6000) < 150, 'centroid ' + c2);
  assert.ok(c2 > c1 * 4);
  const db = Array.from(hi, p => 10 * Math.log10(p + 1e-12));
  assert.ok(Math.abs(L.centroidOfDb(db, sr) - 6000) < 150);
});

test('correlation', () => {
  assert.ok(L.correlation([1, 2, 3, 4], [2, 4, 6, 8]) > 0.999);
  assert.ok(L.correlation([1, 2, 3, 4], [4, 3, 2, 1]) < -0.999);
  assert.equal(L.correlation([1, 1, 1], [1, 2, 3]), 0);
});

test('crossfadeCheck: equal-power fade has no dip, a linear fade dips about 3 dB, a gap is flagged', () => {
  const times = [], eq = [], lin = [], gap = [];
  for (let t = 0; t <= 8000; t += 50) {
    times.push(t);
    const x = Math.min(1, Math.max(0, (t - 3000) / 2000));   // fade runs 3000..5000
    const a = Math.cos(x * Math.PI / 2), b = Math.sin(x * Math.PI / 2);
    eq.push(L.toDb(Math.sqrt(a * a + b * b) * 0.1));          // uncorrelated sources add in power: constant
    lin.push(L.toDb(Math.sqrt((1 - x) * (1 - x) + x * x) * 0.1));
    gap.push(t > 3800 && t < 4600 ? -90 : L.toDb(0.1));
  }
  const e = L.crossfadeCheck(times, eq, 3000, 5000), l = L.crossfadeCheck(times, lin, 3000, 5000), g = L.crossfadeCheck(times, gap, 3000, 5000);
  assert.ok(e.dipDb < 0.1 && e.bumpDb < 0.1, JSON.stringify(e));
  assert.ok(l.dipDb > 2.5 && l.dipDb < 3.5, JSON.stringify(l));
  assert.ok(g.silentMs >= 700 && g.dipDb > 40);
});

test('maxStepDb and seamClick', () => {
  assert.equal(L.maxStepDb([0, 1, 2, 3], [-20, -20, -10, -10], 0, 3), 10);
  const smooth = sine(100, 8000, 800), clicked = smooth.slice(); for (let i = 400; i < 800; i++) clicked[i] += 0.8;
  assert.ok(L.seamClick(clicked, 400, 50).ratio > 8);
  assert.ok(L.seamClick(smooth, 400, 50).ratio < 3);
});

test('gainToReach', () => { assert.equal(L.gainToReach(-20, -17), 3); });

test('suggestLoop trims a quiet fade-in and fade-out but leaves a clean file alone', () => {
  const hop = 0.05, lv = [];
  for (let i = 0; i < 1200; i++) lv.push(-20 + (i % 7 === 0 ? -2 : 0));            // 60 s of steady music
  const clean = L.suggestLoop(lv, hop);
  assert.equal(clean.startSec, 0); assert.ok(Math.abs(clean.endSec - 60) < 0.01);
  const faded = lv.slice(); for (let i = 0; i < 30; i++) faded[i] = -50; for (let i = 0; i < 20; i++) faded[1199 - i] = -45;   // 1.5 s silence at the start, 1 s fade at the end
  const f = L.suggestLoop(faded, hop);
  assert.ok(f.startSec >= 1.5 && f.startSec < 1.7, JSON.stringify(f)); assert.ok(f.endSec <= 59.05 && f.endSec > 58.9, JSON.stringify(f));
  const dip = lv.slice(); for (let i = 10; i < 20; i++) dip[i] = -52;                // a 0.5 s hole right after the start
  assert.ok(L.suggestLoop(dip, hop).startSec >= 1.0);
});

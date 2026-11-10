'use strict';
// Pure maths for audio-probe.cjs (no browser, no I/O): levels, peak detection, event correlation, spectra, crossfade and loop checks.
// Unit tests: audio-probe-lib.test.cjs (node --test).

const FLOOR_DB = -120;

/** Root mean square of a numeric array (0 for empty). */
function rms(a) { if (!a || !a.length) return 0; let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / a.length); }
/** Largest absolute value. */
function peak(a) { let m = 0; if (!a) return 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; } return m; }
/** Linear amplitude to dBFS, clamped at FLOOR_DB. */
function toDb(x) { return x > 1e-6 ? Math.max(FLOOR_DB, 20 * Math.log10(x)) : FLOOR_DB; }
function fromDb(d) { return Math.pow(10, d / 20); }
function mean(a) { return a.length ? a.reduce((p, c) => p + c, 0) / a.length : 0; }
function median(a) { return percentile(a, 0.5); }
function percentile(a, p) { if (!a.length) return 0; const s = Array.from(a).sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))]; }

/** Combines per-window mean-square values (equal-length windows) into one RMS. */
function rmsOfWindows(windows) { return Math.sqrt(mean(windows.map(w => w * w))); }

/**
 * Local maxima of `values` (parallel `times` in ms) that rise above `threshold` and are at least `minGapMs` apart. When two candidates
 * are closer than the gap the larger one wins. Returns [{t, v, i}].
 */
function detectPeaks(times, values, threshold, minGapMs) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v < threshold) continue;
    if (i > 0 && values[i - 1] > v) continue;
    if (i + 1 < values.length && values[i + 1] >= v && values[i + 1] > v) continue;
    const c = { t: times[i], v, i };
    const last = out[out.length - 1];
    if (last && c.t - last.t < minGapMs) { if (c.v > last.v) out[out.length - 1] = c; } else out.push(c);
  }
  return out;
}

/**
 * Pairs each event time with the nearest detected peak that follows it within [0, maxLagMs] (peaks may be used once).
 * Returns { matched: [{event, peak, lagMs}], missed: [event], extra: [peak] , medianLagMs }.
 */
function pairEvents(eventTimes, peakTimes, maxLagMs, minLagMs = -20) {
  const used = new Set(), matched = [], missed = [];
  for (const e of eventTimes) {
    let best = -1, bestLag = Infinity;
    for (let j = 0; j < peakTimes.length; j++) {
      if (used.has(j)) continue;
      const lag = peakTimes[j] - e;
      if (lag >= minLagMs && lag <= maxLagMs && lag < bestLag) { best = j; bestLag = lag; }
    }
    if (best >= 0) { used.add(best); matched.push({ event: e, peak: peakTimes[best], lagMs: bestLag }); } else missed.push(e);
  }
  const extra = peakTimes.filter((_, j) => !used.has(j));
  return { matched, missed, extra, medianLagMs: matched.length ? median(matched.map(m => m.lagMs)) : null };
}

/** Median spacing between consecutive times (ms), or null. */
function medianInterval(times) { const d = []; for (let i = 1; i < times.length; i++) d.push(times[i] - times[i - 1]); return d.length ? median(d) : null; }

/** Spectral centroid in Hz of a magnitude-squared (power) spectrum with bins 0..n-1 spanning 0..sampleRate/2. */
function centroidOfPower(power, sampleRate) {
  let num = 0, den = 0; const n = power.length;
  for (let k = 1; k < n; k++) { const f = k * (sampleRate / 2) / n; num += f * power[k]; den += power[k]; }
  return den > 0 ? num / den : 0;
}
/** Same for an analyser-style dB spectrum (getFloatFrequencyData). */
function centroidOfDb(db, sampleRate) { return centroidOfPower(Array.from(db, d => Math.pow(10, d / 10)), sampleRate); }

/** In-place radix-2 FFT magnitude-squared of a real signal (length must be a power of two); returns power for bins 0..n/2-1. */
function powerSpectrum(signal) {
  const n = signal.length; const re = Float64Array.from(signal), im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  const p = new Float64Array(n / 2); for (let k = 0; k < n / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k]; return p;
}

/** Pearson correlation of two equal-length series (0 when degenerate). */
function correlation(a, b) {
  const n = Math.min(a.length, b.length); if (n < 2) return 0;
  const ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n)); let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}

/**
 * Crossfade check on an output level series (dB, parallel `times` ms) over [t0, t1]: the worst dip below and bump above the level
 * before the fade (median of the 1.5 s before t0) and after it (median of the 1.5 s after t1).
 * Returns { before, after, minDb, maxDb, dipDb, bumpDb, silentMs } where dip/bump are relative to the louder/quieter of before/after.
 */
function crossfadeCheck(times, levelsDb, t0, t1, silenceDb = -60) {
  const pick = (a, b) => levelsDb.filter((_, i) => times[i] >= a && times[i] <= b);
  const before = median(pick(t0 - 1500, t0)), after = median(pick(t1, t1 + 1500));
  const inside = pick(t0, t1);
  const minDb = inside.length ? Math.min(...inside) : null, maxDb = inside.length ? Math.max(...inside) : null;
  const lo = Math.min(before, after), hi = Math.max(before, after);
  let silentMs = 0; for (let i = 1; i < times.length; i++) if (times[i] >= t0 && times[i] <= t1 && levelsDb[i] < silenceDb) silentMs += times[i] - times[i - 1];
  return { before, after, minDb, maxDb, dipDb: minDb === null ? null : lo - minDb, bumpDb: maxDb === null ? null : maxDb - hi, silentMs };
}

/** Largest step between consecutive windows of a series (dB) inside [t0,t1]; used for loop seams. */
function maxStepDb(times, levelsDb, t0, t1) {
  let m = 0; for (let i = 1; i < levelsDb.length; i++) if (times[i] >= t0 && times[i] <= t1) m = Math.max(m, Math.abs(levelsDb[i] - levelsDb[i - 1])); return m;
}

/** Peak sample-to-sample discontinuity of a waveform around an index (a click at a loop seam): max |x[i]-x[i-1]| within +-radius vs the median step. */
function seamClick(samples, index, radius) {
  const steps = []; for (let i = Math.max(1, index - radius); i < Math.min(samples.length, index + radius); i++) steps.push(Math.abs(samples[i] - samples[i - 1]));
  const med = median(steps) || 1e-9; const mx = steps.length ? Math.max(...steps) : 0; return { maxStep: mx, medianStep: med, ratio: mx / med };
}

/** Gain staging helper: the dB change that brings `levelDb` to `targetDb`. */
function gainToReach(levelDb, targetDb) { return targetDb - levelDb; }

module.exports = { FLOOR_DB, rms, peak, toDb, fromDb, mean, median, percentile, rmsOfWindows, detectPeaks, pairEvents, medianInterval,
  centroidOfPower, centroidOfDb, powerSpectrum, correlation, crossfadeCheck, maxStepDb, seamClick, gainToReach };

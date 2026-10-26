import { describe, expect, it } from "vitest";
import {
  INTERP_DELAY_MS, MAX_INTERP_DELAY_MS, MIN_INTERP_DELAY_MS, mulberry32, PATCH_MS, RENDER_CLOCK_DEFAULTS, RenderClock,
  type RenderClockOptions,
} from "../src/index";

interface Arrival { t: number; at: number }

/**
 * Patches every 50 ms of server time arriving after `base` + an exponential extra of mean `jitter`, in order (a later patch never
 * arrives before an earlier one: TCP). `stall(i)` adds an extra wait to patch i (a lost segment), `skip(i)` leaves a patch out (a
 * server step that ran two ticks and sent one patch).
 */
function stream(n: number, rng: () => number, opts: { base?: number; jitter?: number; stall?: (i: number) => number; skip?: (i: number) => boolean; epoch?: number } = {}): Arrival[] {
  const out: Arrival[] = [];
  let last = -Infinity;
  for (let i = 0; i < n; i++) {
    if (opts.skip?.(i)) continue;
    const t = (opts.epoch ?? 1000) + i * PATCH_MS;
    let at = 1000 + i * PATCH_MS + (opts.base ?? 20) + (opts.jitter ? -opts.jitter * Math.log(1 - rng()) : 0) + (opts.stall?.(i) ?? 0);
    if (at < last) at = last;
    last = at;
    out.push({ t, at });
  }
  return out;
}

interface Run {
  delays: number[];
  /** What the clock asked for each frame. */
  asked: number[];
  /** Per frame: render time minus the newest patch's server time seen so far (> 0: past the data). */
  over: number[];
  speeds: number[];
  backwards: number;
}

function run(rc: RenderClock, arrivals: Arrival[], fps = 144, from = 0, sampleAt: number[] = [], samples: Record<number, number> = {}): Run {
  const frame = 1000 / fps;
  const r: Run = { delays: [], asked: [], over: [], speeds: [], backwards: 0 };
  let i = 0;
  let newest = -Infinity;
  let prev = NaN;
  const end = arrivals[arrivals.length - 1]!.at;
  for (let now = arrivals[0]!.at; now <= end; now += frame) {
    while (i < arrivals.length && arrivals[i]!.at <= now) { rc.onPatch(arrivals[i]!.t, arrivals[i]!.at); newest = Math.max(newest, arrivals[i]!.t); i++; }
    const t = rc.renderTime(now);
    for (const s of sampleAt) if (now >= s && samples[s] === undefined) samples[s] = rc.delayMs;
    if (now >= from) {
      if (Number.isFinite(prev)) {
        if (t < prev) r.backwards++;
        r.speeds.push((t - prev) / frame);
      }
      r.delays.push(rc.delayMs);
      r.asked.push(rc.targetMs);
      r.over.push(t - newest);
    }
    prev = t;
  }
  return r;
}

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const pct = (v: number[], q: number) => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(q * v.length))]!;
const D = RENDER_CLOCK_DEFAULTS;

describe("RenderClock", () => {
  it("starts at the initial delay and anchors render time to the first patch", () => {
    const rc = new RenderClock();
    expect(rc.delayMs).toBe(INTERP_DELAY_MS);
    rc.onPatch(5000, 100);
    expect(rc.renderTime(100)).toBe(5000 - INTERP_DELAY_MS);
    expect(rc.clock.synced).toBe(true);
    expect(rc.delayMs).toBeCloseTo(INTERP_DELAY_MS, 6);
  });

  it("settles at the minimum on a steady stream, and never draws past the data", () => {
    const rc = new RenderClock();
    const r = run(rc, stream(1000, mulberry32(1), { base: 20 }), 144, 15_000);
    expect(mean(r.delays)).toBeGreaterThanOrEqual(MIN_INTERP_DELAY_MS - 0.5);
    expect(mean(r.delays)).toBeLessThan(MIN_INTERP_DELAY_MS + 3);
    expect(Math.max(...r.over)).toBeLessThanOrEqual(0);
    expect(r.backwards).toBe(0);
  });

  it("does not care where the server clock sits against the local one", () => {
    const a = run(new RenderClock(), stream(600, mulberry32(7), { jitter: 8, epoch: 1000 }), 144, 12_000);
    const b = run(new RenderClock(), stream(600, mulberry32(7), { jitter: 8, epoch: 987_654_321 }), 144, 12_000);
    expect(mean(b.delays)).toBeCloseTo(mean(a.delays), 6);
  });

  it("grows with the jitter, and holds a stream that is late by tens of ms at times without starving it much", () => {
    const rng = mulberry32(2);
    const calm = run(new RenderClock(), stream(1500, rng, { jitter: 1 }), 144, 15_000);
    const rough = run(new RenderClock(), stream(1500, rng, { jitter: 15 }), 144, 15_000);
    expect(mean(rough.delays)).toBeGreaterThan(mean(calm.delays) + 20);
    const starved = rough.over.filter((o) => o > 0).length / rough.over.length;
    expect(starved).toBeLessThan(0.03);
    expect(pct(rough.over, 0.99)).toBeLessThan(20);
  });

  it("render time never runs backwards and its speed stays within the bounds, whatever the jitter and stalls", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const rng = mulberry32(seed);
      const rc = new RenderClock();
      const arrivals = stream(2000, rng, {
        jitter: 12, stall: (i) => (i % 97 === 50 ? 250 : i % 41 === 7 ? 60 : 0), skip: (i) => i % 53 === 20,
      });
      const r = run(rc, arrivals, seed % 2 ? 144 : 60, 8000);
      expect(r.backwards, `seed ${seed}`).toBe(0);
      // Render time is slewed as a whole: every change of the server clock's estimate and of the delay goes through the same limits.
      expect(Math.min(...r.speeds), `seed ${seed}`).toBeGreaterThanOrEqual(1 - D.growRate - 1e-9);
      expect(Math.max(...r.speeds), `seed ${seed}`).toBeLessThanOrEqual(1 + D.shrinkFastRate + 1e-9);
      // What is asked for is bounded; the delay drawn follows it, a few ms off while the median it is measured from moves.
      expect(Math.max(...r.asked), `seed ${seed}`).toBeLessThanOrEqual(MAX_INTERP_DELAY_MS + 1e-6);
      expect(Math.min(...r.asked.slice(2000)), `seed ${seed}`).toBeGreaterThanOrEqual(MIN_INTERP_DELAY_MS - 1e-6);
      expect(Math.max(...r.delays), `seed ${seed}`).toBeLessThanOrEqual(MAX_INTERP_DELAY_MS + 15);
    }
  });

  it("a late patch moves the server clock by one slew step at most (the delay is what takes it), and render time not at all backwards", () => {
    const rc = new RenderClock();
    const a = stream(200, mulberry32(3), { base: 20 });
    for (const p of a) rc.onPatch(p.t, p.at);
    const last = a[a.length - 1]!;
    rc.renderTime(last.at);
    const before = rc.clock.now(20_000);
    const rBefore = rc.renderTime(last.at + 1);
    rc.onPatch(last.t + 50, last.at + 50 + 150); // 150 ms late
    const rAfter = rc.renderTime(last.at + 2);
    expect(Math.abs(rc.clock.now(20_000) - before)).toBeLessThanOrEqual(2 + 1e-9);
    expect(rAfter).toBeGreaterThanOrEqual(rBefore);
  });

  it("rises within a second of the network getting worse and falls slowly afterwards", () => {
    const rc = new RenderClock();
    const rng = mulberry32(9);
    // 20 s of a clean stream, 10 s of heavy jitter, then clean again.
    const arrivals: Arrival[] = [];
    let last = 0;
    for (let i = 0; i < 1200; i++) {
      const t = 1000 + i * PATCH_MS;
      const heavy = i >= 400 && i < 600;
      let at = t + 20 + (heavy ? -40 * Math.log(1 - rng()) : 0);
      if (at < last) at = last;
      last = at;
      arrivals.push({ t, at });
    }
    const at: Record<number, number> = {};
    const t0 = arrivals[0]!.at;
    const marks = [19_000, 21_500, 33_000, 45_000, 55_000].map((m) => t0 + m);
    const r = run(rc, arrivals, 144, 0, marks, at);
    const d = (m: number) => at[t0 + m]!;
    expect(d(19_000)).toBeLessThan(MIN_INTERP_DELAY_MS + 3);
    expect(d(21_500)).toBeGreaterThan(d(19_000) + 20);
    // The jitter ended at about 31 s: the window still holds it at 33 s, and by 45 s the delay is back, never faster than the limit.
    expect(d(33_000)).toBeGreaterThan(MIN_INTERP_DELAY_MS + 20);
    expect(d(45_000)).toBeLessThan(MIN_INTERP_DELAY_MS + 4);
    expect(d(55_000)).toBeLessThan(MIN_INTERP_DELAY_MS + 4);
    expect(r.backwards).toBe(0);
    expect(Math.max(...r.speeds)).toBeLessThanOrEqual(1 + D.shrinkFastRate + 1e-9);
  });

  it("converges from a bad start without a long stretch of too much delay", () => {
    const rc = new RenderClock();
    // The first patch arrives 160 ms after the rest of the stream's pattern would put it (a join burst), then it is steady.
    const a = stream(600, mulberry32(11), { base: 20, stall: (i) => (i === 0 ? 160 : 0) });
    const marks: Record<number, number> = {};
    const t0 = a[0]!.at;
    run(rc, a, 144, 0, [t0 + 4000, t0 + 9000], marks);
    expect(marks[t0 + 9000]!).toBeLessThan(MIN_INTERP_DELAY_MS + 8);
  });

  it("re-anchors instead of slewing when the clock jumps (a tab that slept)", () => {
    const rc = new RenderClock();
    const a = stream(300, mulberry32(5), { base: 20 });
    for (const p of a) { rc.onPatch(p.t, p.at); rc.renderTime(p.at); }
    const last = a[a.length - 1]!;
    // Five seconds pass with no frame and no patch; the stream then carries on.
    const resume = last.at + 5000;
    rc.onPatch(last.t + 5050, resume);
    const t = rc.renderTime(resume + 1);
    expect(t).toBeGreaterThan(last.t + 4000);
    expect(Math.abs(rc.delayMs - rc.targetMs)).toBeLessThan(120);
  });

  it("patches missing from the stream (a server step that ran two ticks and sent one) ask for more delay", () => {
    const base = run(new RenderClock(), stream(1500, mulberry32(4), { base: 20 }), 144, 12_000);
    const doubled = run(new RenderClock(), stream(1500, mulberry32(4), { base: 20, skip: (i) => i % 25 === 12 }), 144, 12_000);
    // One patch in 25 missing (the previous patch's time is then 100 ms back): inside the 2% the percentile looks past or not, the
    // delay is higher than on a clean stream, and what is left uncovered is short.
    expect(mean(doubled.delays)).toBeGreaterThan(mean(base.delays) + 15);
    expect(pct(doubled.over, 0.99)).toBeLessThanOrEqual(0);
  });

  it("is bounded by the options it is given", () => {
    const o: Partial<RenderClockOptions> = { minMs: 90, maxMs: 110 };
    const quiet = run(new RenderClock(o), stream(800, mulberry32(6), { base: 20 }), 144, 12_000);
    const loud = run(new RenderClock(o), stream(800, mulberry32(6), { jitter: 40 }), 144, 12_000);
    expect(Math.min(...quiet.asked)).toBeGreaterThanOrEqual(90 - 1e-6);
    expect(Math.max(...loud.asked)).toBeLessThanOrEqual(110 + 1e-6);
    expect(mean(quiet.delays)).toBeGreaterThan(88);
    expect(mean(loud.delays)).toBeLessThan(125);
  });

  it("the constants hold together", () => {
    expect(INTERP_DELAY_MS).toBe(100);
    expect(MIN_INTERP_DELAY_MS).toBeLessThan(INTERP_DELAY_MS);
    expect(MAX_INTERP_DELAY_MS).toBeGreaterThan(INTERP_DELAY_MS);
    expect(MIN_INTERP_DELAY_MS).toBeGreaterThan(PATCH_MS);
  });
});

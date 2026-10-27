import { describe, expect, it } from "vitest";
import {
  INTERP_DELAY_MS, MAX_INTERP_DELAY_MS, MIN_INTERP_DELAY_MS, mulberry32, PATCH_MS, RENDER_CLOCK_DEFAULTS, RenderClock, ServerClock,
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

// --- stalls, hitches, and the clock jumping --------------------------------------------------------------------------------
//
// Render time must never run backwards, whatever the link or the server does: a stall of the client's connection (a burst of
// patches at its end), a hitch of the server that drops sim time (RaidRoom.tick runs at most MAX_CATCHUP_STEPS = 3 steps per tick
// and drops the rest, so server time then trails the local clock for good), a tab that draws nothing for seconds, a reconnect.

const MAX_CATCHUP_STEPS = 3;

/** 20 Hz patches with a flat latency; the patches from index `stallAt` on, as many as `ms` covers, are held back and arrive together. */
function clientStall(n: number, stallAt: number, ms: number, latency = 30): Arrival[] {
  const k = Math.round(ms / PATCH_MS);
  const out: Arrival[] = [];
  for (let i = 0; i < n; i++) {
    const t = 1000 + i * PATCH_MS;
    const held = i >= stallAt && i < stallAt + k;
    out.push({ t, at: (held ? 1000 + (stallAt + k) * PATCH_MS : t) + latency });
  }
  return out;
}

/**
 * The server's event loop stops for `ms` of wall time after patch `hitchAt - 1`; its next tick runs MAX_CATCHUP_STEPS steps, sends
 * one patch and drops the rest of what it owes, so from then on server time trails wall time by `ms - 150` more.
 */
function serverHitch(n: number, hitchAt: number, ms: number, latency = 30): Arrival[] {
  const out: Arrival[] = [];
  let wall = 1000;
  let t = 1000;
  for (let i = 0; i < n; i++) {
    if (i === hitchAt) {
      wall += ms - PATCH_MS;
      t += (MAX_CATCHUP_STEPS - 1) * PATCH_MS;
    }
    out.push({ t, at: wall + latency });
    wall += PATCH_MS;
    t += PATCH_MS;
  }
  return out;
}

interface Frame { now: number; t: number; newest: number; delay: number }

/** Drives the clock like the scene: patches in, one `renderTime` per frame; frames inside a `blackout` (hidden tab) are not drawn. */
function drive(rc: RenderClock, arrivals: Arrival[], opts: { fps?: number; blackouts?: Array<[number, number]> } = {}): Frame[] {
  const frame = 1000 / (opts.fps ?? 144);
  const frames: Frame[] = [];
  let i = 0;
  let newest = -Infinity;
  const end = arrivals[arrivals.length - 1]!.at;
  for (let now = arrivals[0]!.at; now <= end; now += frame) {
    while (i < arrivals.length && arrivals[i]!.at <= now) { rc.onPatch(arrivals[i]!.t, arrivals[i]!.at); newest = Math.max(newest, arrivals[i]!.t); i++; }
    if (opts.blackouts?.some(([a, b]) => now >= a && now < b)) continue;
    frames.push({ now, t: rc.renderTime(now), newest, delay: rc.delayMs });
  }
  return frames;
}

interface Verdict {
  /** Frames where render time went down, and the worst of them (ms). */
  backwards: number;
  worstBack: number;
  /** Render speed per frame against the local clock, over frames drawn back to back (a gap in the frames is not a speed). */
  minSpeed: number;
  maxSpeed: number;
  /** After `from`: ms of drawing past the newest patch (the picture holds and hops), and ms until the delay is last outside its bounds. */
  pastNewest: number;
  recoverMs: number;
  /** The most render time trailed the newest patch after `from` (ms). */
  maxBehind: number;
  /** ms after `from` that it trailed the newest patch by more than the delay's cap (it is far behind the data: the picture is stale). */
  farBehind: number;
}

function judge(frames: Frame[], from: number, frameMs = 1000 / 144): Verdict {
  const v: Verdict = { backwards: 0, worstBack: 0, minSpeed: Infinity, maxSpeed: -Infinity, pastNewest: 0, recoverMs: 0, maxBehind: 0, farBehind: 0 };
  for (let k = 1; k < frames.length; k++) {
    const f = frames[k]!;
    const p = frames[k - 1]!;
    if (f.t < p.t) { v.backwards++; v.worstBack = Math.max(v.worstBack, p.t - f.t); }
    const dt = f.now - p.now;
    if (dt < frameMs * 1.5) {
      const sp = (f.t - p.t) / dt;
      v.minSpeed = Math.min(v.minSpeed, sp);
      v.maxSpeed = Math.max(v.maxSpeed, sp);
    }
    if (f.now < from) continue;
    if (f.t > f.newest) v.pastNewest += dt;
    v.maxBehind = Math.max(v.maxBehind, f.newest - f.t);
    if (f.newest - f.t > MAX_INTERP_DELAY_MS + 15) v.farBehind += dt;
    if (f.delay < MIN_INTERP_DELAY_MS - 2 || f.delay > MAX_INTERP_DELAY_MS + 15) v.recoverMs = f.now - from;
  }
  return v;
}

describe("RenderClock through stalls, hitches and gaps in the frames", () => {
  const fresh = () => new RenderClock();

  it("never runs backwards on a steady stream or a jittery one", () => {
    expect(judge(drive(fresh(), stream(800, mulberry32(1), { base: 20 })), 0).backwards).toBe(0);
    for (const seed of [1, 2, 3]) {
      const fps = seed === 2 ? 60 : 144;
      const v = judge(drive(fresh(), stream(1200, mulberry32(seed), { jitter: 15, stall: (i) => (i % 80 === 40 ? 200 : 0) }), { fps }), 0, 1000 / fps);
      expect(v.backwards, `seed ${seed}`).toBe(0);
      expect(v.minSpeed, `seed ${seed}`).toBeGreaterThanOrEqual(1 - D.growRate - 1e-9);
    }
  });

  it("a client stall of any length followed by its burst moves neither the delay nor render time off its path", () => {
    for (const ms of [500, 1000, 2000, 2500, 3000, 5000]) {
      const arrivals = clientStall(900, 400, ms);
      const burstAt = arrivals[400 + Math.round(ms / PATCH_MS)]!.at;
      const frames = drive(fresh(), arrivals);
      const before = frames.filter((f) => f.now < arrivals[400]!.at).pop()!;
      const v = judge(frames, burstAt);
      expect(v.backwards, `${ms} ms`).toBe(0);
      // Frames kept coming during the stall, so render time ran on at full speed and the burst finds it where it was headed.
      expect(v.minSpeed, `${ms} ms`).toBeGreaterThanOrEqual(1 - D.growRate - 1e-9);
      expect(v.maxSpeed, `${ms} ms`).toBeLessThanOrEqual(1 + D.shrinkFastRate + 1e-9);
      expect(v.pastNewest, `${ms} ms`).toBeLessThan(60);
      expect(v.recoverMs, `${ms} ms`).toBeLessThan(1000);
      // A stall of a second or more is not the network's jitter: it must not raise or lower the delay for the seconds after.
      if (ms >= 1000) {
        const after = frames.filter((f) => f.now > burstAt + 3000)[0]!;
        expect(Math.abs(after.delay - before.delay), `${ms} ms`).toBeLessThan(8);
        expect(v.maxBehind, `${ms} ms`).toBeLessThanOrEqual(before.delay + 15);
      }
    }
  });

  it("a server hitch that drops sim time: render time stands still instead of jumping back, and the delay is back inside a second or two", () => {
    for (const dropped of [150, 300, 600, 1200]) {
      const ms = dropped + MAX_CATCHUP_STEPS * PATCH_MS;
      const arrivals = serverHitch(900, 400, ms);
      const hitchAt = arrivals[400]!.at;
      const v = judge(drive(fresh(), arrivals), hitchAt);
      expect(v.backwards, `dropped ${dropped}`).toBe(0);
      expect(v.minSpeed, `dropped ${dropped}`).toBeGreaterThanOrEqual(-1e-9);
      // Render time is ahead of the new data by the dropped time minus its delay; it can't go back, so it waits that long (and the
      // few patches it takes to be sure it was a step), drawing the newest patch as it comes, and is smooth again. A hitch of a
      // second or more is a stall first: the new median is only taken from the fifth patch after it.
      const slack = ms >= D.stallMs ? 300 : 120;
      expect(v.pastNewest, `dropped ${dropped}`).toBeLessThan(dropped + slack);
      expect(v.recoverMs, `dropped ${dropped}`).toBeLessThan(dropped + slack + 50);
      expect(v.maxBehind, `dropped ${dropped}`).toBeLessThanOrEqual(MAX_INTERP_DELAY_MS + 15);
    }
  });

  it("a hitch that drops less than the step size is left to the window, as before", () => {
    const arrivals = serverHitch(900, 400, 60 + MAX_CATCHUP_STEPS * PATCH_MS);
    const v = judge(drive(fresh(), arrivals), arrivals[400]!.at);
    expect(v.backwards).toBe(0);
    expect(v.minSpeed).toBeGreaterThanOrEqual(1 - D.growRate - 1e-9);
  });

  it("a tab that draws nothing for seconds while the patches keep coming: render time only moves forward and the delay stays", () => {
    for (const hiddenMs of [1000, 3000, 8000]) {
      const arrivals = stream(1200, mulberry32(3), { base: 20, jitter: 3 });
      const from = arrivals[0]!.at + 20_000;
      const frames = drive(fresh(), arrivals, { blackouts: [[from, from + hiddenMs]] });
      const before = frames.filter((f) => f.now < from).pop()!;
      const v = judge(frames, from + hiddenMs);
      expect(v.backwards, `${hiddenMs} ms`).toBe(0);
      expect(v.pastNewest, `${hiddenMs} ms`).toBeLessThan(40);
      expect(Math.abs(frames.find((f) => f.now > from + hiddenMs + 500)!.delay - before.delay), `${hiddenMs} ms`).toBeLessThan(8);
    }
  });

  it("a tab frozen with its connection (no frames, no patches), then one patch and the stream again", () => {
    for (const ms of [2000, 6000, 20_000]) {
      const arrivals = clientStall(1400, 500, ms);
      const from = arrivals[500]!.at;
      const frames = drive(fresh(), arrivals, { blackouts: [[from, from + ms]] });
      const v = judge(frames, from + ms);
      expect(v.backwards, `${ms} ms`).toBe(0);
      expect(v.recoverMs, `${ms} ms`).toBeLessThan(1000);
      expect(v.pastNewest, `${ms} ms`).toBeLessThan(60);
    }
  });

  it("a reconnect: seconds of nothing, one full-state patch, then the stream", () => {
    for (const gap of [1500, 4000]) {
      const arrivals: Arrival[] = [];
      for (let i = 0; i < 1000; i++) {
        const t = 1000 + i * PATCH_MS;
        if (i >= 400 && i < 400 + gap / PATCH_MS - 1) continue; // nothing arrives
        arrivals.push({ t, at: t + 25 });
      }
      const resume = arrivals.find((a) => a.t > 1000 + 400 * PATCH_MS)!.at;
      const v = judge(drive(fresh(), arrivals), resume);
      expect(v.backwards, `${gap} ms`).toBe(0);
      expect(v.recoverMs, `${gap} ms`).toBeLessThan(1000);
      expect(v.pastNewest, `${gap} ms`).toBeLessThan(60);
    }
  });

  it("catch-up bursts (a late tick followed at once by the next) never move it backwards either", () => {
    const arrivals = stream(1500, mulberry32(8), { base: 20, jitter: 6, stall: (i) => (i % 31 === 5 ? 120 : i % 53 === 9 ? 220 : 0), skip: (i) => i % 37 === 11 });
    const v = judge(drive(fresh(), arrivals), 0);
    expect(v.backwards).toBe(0);
    expect(v.minSpeed).toBeGreaterThanOrEqual(1 - D.growRate - 1e-9);
    expect(v.maxSpeed).toBeLessThanOrEqual(1 + D.shrinkFastRate + 1e-9);
  });

  it("a stall's burst under the stall limit is not mistaken for a step", () => {
    // A 400 ms hole delivers 8 patches at once; the newest of them is as fresh as ever.
    const arrivals = clientStall(900, 400, 400);
    const v = judge(drive(fresh(), arrivals), arrivals[408]!.at);
    expect(v.minSpeed).toBeGreaterThanOrEqual(1 - D.growRate - 1e-9);
    expect(v.backwards).toBe(0);
  });

  it("a link whose latency jumps up for good is followed within a few patches by waiting, not crawling for seconds", () => {
    const arrivals: Arrival[] = [];
    for (let i = 0; i < 900; i++) {
      const t = 1000 + i * PATCH_MS;
      arrivals.push({ t, at: t + 25 + (i >= 400 ? 200 : 0) });
    }
    const v = judge(drive(fresh(), arrivals), arrivals[400]!.at);
    expect(v.backwards).toBe(0);
    expect(v.minSpeed).toBeGreaterThanOrEqual(-1e-9);
    expect(v.recoverMs).toBeLessThan(700);
  });

  it("a server clock that steps FORWARD against the local one is followed at once (the one direction render time may jump)", () => {
    const arrivals: Arrival[] = [];
    for (let i = 0; i < 700; i++) arrivals.push({ t: 1000 + i * PATCH_MS + (i >= 400 ? 600 : 0), at: 1000 + i * PATCH_MS + 25 });
    const v = judge(drive(fresh(), arrivals), arrivals[400]!.at);
    expect(v.backwards).toBe(0);
    expect(v.recoverMs).toBeLessThan(700);
    // Three patches (about 100 ms) go by before it is sure; then it is at the new data.
    expect(v.farBehind).toBeLessThan(250);
  });

  it("a random life of stalls, hitches and latency changes, back to back or not: monotone, and settled within the bounds afterwards", () => {
    for (let seed = 1; seed <= 24; seed++) {
      const rng = mulberry32(seed * 7919);
      const arrivals: Arrival[] = [];
      let wall = 1000, t = 1000, latency = 30, holdUntil = 0, last = 0;
      let quietFrom = 0;
      const n = 2400;
      for (let i = 0; i < n; i++) {
        if (i > 100 && i < n - 600 && rng() < 0.006) {
          const kind = Math.floor(rng() * 3);
          if (kind === 0) { // the link stalls: what was sent meanwhile arrives together
            holdUntil = wall + 300 + rng() * 3700;
            quietFrom = Math.max(quietFrom, holdUntil + latency);
          } else if (kind === 1) { // the server stops, runs MAX_CATCHUP_STEPS steps in its next tick and drops the rest
            const stop = 300 + rng() * 1700;
            wall += stop - PATCH_MS;
            t += (MAX_CATCHUP_STEPS - 1) * PATCH_MS;
            quietFrom = Math.max(quietFrom, wall + latency + stop);
          } else { // the latency changes for good
            const to = Math.min(250, Math.max(15, latency + (rng() - 0.5) * 360));
            latency = to;
            quietFrom = Math.max(quietFrom, wall + latency + 400);
          }
        }
        const at = Math.max(wall + latency - 4 * Math.log(1 - rng()), holdUntil + latency, last);
        last = at;
        arrivals.push({ t, at });
        wall += PATCH_MS;
        t += PATCH_MS;
      }
      const frames = drive(fresh(), arrivals, { fps: seed % 3 === 0 ? 60 : 144 });
      const v = judge(frames, 0, seed % 3 === 0 ? 1000 / 60 : 1000 / 144);
      expect(v.backwards, `seed ${seed}`).toBe(0);
      expect(v.minSpeed, `seed ${seed}`).toBeGreaterThanOrEqual(-1e-9);
      const settled = judge(frames.filter((f) => f.now > quietFrom + 5000), 0);
      expect(settled.recoverMs, `seed ${seed}`).toBe(0);
    }
  }, 30_000);

  it("ServerClock.resync takes a sample as the offset at once", () => {
    const c = new ServerClock(2, 250, Infinity);
    c.observe(5000, 100);
    c.observe(5050, 150);
    expect(c.offsetMs).toBe(4900);
    c.resync(5500, 400);
    expect(c.offsetMs).toBe(5100);
  });
});

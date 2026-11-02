// The room's step clock (rooms/tickPacer.ts), headless: the grid, the catch-up and its re-anchor, the timer delay, the per-room
// phase and the /readyz counters. A model of Node's timers then runs ten minutes of wakes through the pacer and through the old
// driver (setInterval re-armed from its fire time, Date.now deltas into an accumulator), and the patch streams both make go
// through the client's own RenderClock: what a player sees of the difference.
import { describe, expect, it } from "vitest";
import { MIN_INTERP_DELAY_MS, mulberry32, RenderClock, TICK_MS } from "@raid/shared";
import { EARLY_TOLERANCE_MS, MAX_CATCHUP_STEPS, phaseOf, TickPacer, TickStats } from "../src/rooms/tickPacer";

describe("TickPacer", () => {
  it("owes a step from 1 ms before its slot, counts it once, and repays what a late wake owes", () => {
    const p = new TickPacer(1000);
    expect(p.take(1048.9)).toBe(0);
    expect(p.lastLateMs).toBeCloseTo(-1.1, 9);
    expect(p.take(1050 - EARLY_TOLERANCE_MS + 0.1)).toBe(1);
    expect(p.lastLateMs).toBeCloseTo(-0.9, 9);
    expect(p.take(1049.5)).toBe(0); // committed: the same slot is not owed twice
    expect(p.take(1150)).toBe(2); // 1100 and 1150
    expect(p.lastLateMs).toBe(50);
    expect(p.take(1300.5)).toBe(MAX_CATCHUP_STEPS); // 1200, 1250 and 1300: the most a wake runs, still no re-anchor
    expect(p.reanchored).toBe(false);
    expect(p.delayMs(1300.5)).toBe(50);
  });

  it("drops a backlog longer than the catch-up and puts the next slot a whole step after the wake", () => {
    const p = new TickPacer(0);
    expect(p.take(50)).toBe(1);
    expect(p.take(420.3)).toBe(MAX_CATCHUP_STEPS); // owed 100..400: seven
    expect(p.reanchored).toBe(true);
    expect(p.lastLateMs).toBeCloseTo(320.3, 9);
    expect(p.delayMs(420.3)).toBe(50);
    expect(p.take(470.3 - 1.2)).toBe(0);
    expect(p.reanchored).toBe(false);
    expect(p.take(470.3 - 0.5)).toBe(1);
    expect(p.take(520.3)).toBe(1);
  });

  it("asks the timer for whole ms, at least 1, rounded up so an early Node timer still lands within the tolerance", () => {
    const p = new TickPacer(1000.3);
    expect(p.delayMs(1000)).toBe(51); // the slot is at 1050.3
    expect(p.delayMs(1049.9)).toBe(1);
    expect(p.delayMs(1050.3)).toBe(1); // due now
    expect(p.delayMs(1090)).toBe(1); // overdue
    for (const now of [1000, 1012.25, 1033.999, 1050.29]) {
      const d = p.delayMs(now);
      expect(Number.isInteger(d)).toBe(true);
      // Node may fire up to 1 ms before now + d (its start is truncated): that is still not before slot - 1.
      expect(now + d - 1).toBeGreaterThanOrEqual(1050.3 - EARLY_TOLERANCE_MS);
    }
  });

  it("gives every room a phase in [0, TICK_MS), stable for its id and different between ids", () => {
    const ids = ["a1b2c3d4e", "ZyX_9-8w7", "roomOne00", "roomOne01", "q", ""];
    const phases = ids.map((id) => phaseOf(id));
    for (const ph of phases) {
      expect(ph).toBeGreaterThanOrEqual(0);
      expect(ph).toBeLessThan(TICK_MS);
    }
    expect(ids.map((id) => phaseOf(id))).toEqual(phases);
    expect(new Set(phases).size).toBe(ids.length);
  });
});

describe("TickStats", () => {
  it("counts wakes by steps and the stepping wakes by lateness, with percentiles at the bucket bounds", () => {
    const s = new TickStats();
    expect(s.snapshot()).toEqual({ wakes: 0, zeroStepPct: 0, doubleStepPct: 0, catchupReanchors: 0, lateMsP50: null, lateMsP95: null });
    for (let i = 0; i < 90; i++) s.note(1, 0.4, false); // (0, 1]
    for (let i = 0; i < 6; i++) s.note(1, -0.3, false); // <= 0
    s.note(0, -1.5, false); // early, stepped nothing: not in the lateness buckets
    s.note(2, 3, false); // (2, 4]
    s.note(3, 12, false); // (8, 16]
    s.note(3, 400, true); // the overflow
    expect(s.wakes).toBe(100);
    expect(s.steps).toEqual([1, 96, 1, 2]);
    expect(s.late.reduce((a, b) => a + b, 0)).toBe(99);
    expect(s.late).toEqual([6, 90, 0, 1, 0, 1, 0, 1]);
    expect(s.snapshot()).toEqual({ wakes: 100, zeroStepPct: 1, doubleStepPct: 3, catchupReanchors: 1, lateMsP50: 1, lateMsP95: 1 });
    expect(s.latePercentile(0.98)).toBe(16);
    expect(s.latePercentile(1)).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------- a model of Node's timers

/**
 * Node starts a timer from its millisecond-truncated loop clock and fires it once that clock has advanced by the delay, so it can
 * fire up to 1 ms before `armedAt + delay`; the process then wakes a little later still. Date.now is truncated the same way.
 */
const CLOCK_OFFSET = 0.37;
const truncated = (t: number) => Math.floor(t + CLOCK_OFFSET) - CLOCK_OFFSET;

interface Run { wakes: Array<{ at: number; steps: number; nextSlot?: number }>; patches: number[][]; dropped: number; end: number }

function wakeLatency(rnd: () => number): number {
  // One wake in twenty comes the moment Node allows; the rest 0.3-2.3 ms after (about what core's setInterval drifts by).
  return rnd() < 0.05 ? 0 : 0.3 + 2 * rnd();
}

/** One room on the pacer: `hiccups` are steps that take that long (a GC, a first-join map). Patches are [arrival, server time]. */
function runPacer(seconds: number, seed: number, hiccups: Array<{ at: number; work: number }> = []): Run {
  const rnd = mulberry32(seed);
  const hs = [...hiccups];
  const p = new TickPacer(10.4);
  const run: Run = { wakes: [], patches: [], dropped: 0, end: seconds * 1000 };
  let serverTime = 0;
  let fire = truncated(10.4) + p.delayMs(10.4) + wakeLatency(rnd);
  while (fire < run.end) {
    const n = p.take(fire);
    if (p.reanchored) run.dropped += Math.floor((fire + EARLY_TOLERANCE_MS - 10.4) / TICK_MS) * TICK_MS - serverTime - n * TICK_MS;
    let t = fire;
    for (let i = 0; i < n; i++) {
      t += hs.length > 0 && t >= hs[0]!.at ? hs.shift()!.work : 1.5 + rnd();
      serverTime += TICK_MS;
    }
    if (n > 0) run.patches.push([t, serverTime]);
    const d = p.delayMs(t);
    run.wakes.push({ at: fire, steps: n, nextSlot: t + d });
    fire = truncated(t) + d + wakeLatency(rnd);
  }
  return run;
}

/** The old driver: core's setInterval(TICK_MS), re-armed from its (truncated) fire time, Date.now deltas into an integer accumulator. */
function runLegacy(seconds: number, seed: number): Run {
  const rnd = mulberry32(seed);
  const run: Run = { wakes: [], patches: [], dropped: 0, end: seconds * 1000 };
  let serverTime = 0;
  let acc = 0;
  let lastDate = Math.floor(10.4 + CLOCK_OFFSET);
  let fire = truncated(10.4) + TICK_MS + wakeLatency(rnd);
  while (fire < run.end) {
    const date = Math.floor(fire + CLOCK_OFFSET);
    acc += date - lastDate;
    lastDate = date;
    let n = 0;
    let t = fire;
    while (acc >= TICK_MS && n < MAX_CATCHUP_STEPS) {
      t += 1.5 + rnd();
      serverTime += TICK_MS;
      acc -= TICK_MS;
      n++;
    }
    if (acc >= TICK_MS) acc = 0;
    run.wakes.push({ at: fire, steps: n });
    if (n > 0) run.patches.push([t, serverTime]);
    fire = Math.max(truncated(fire) + TICK_MS, truncated(t)) + wakeLatency(rnd);
  }
  return run;
}

/** The delay the client's RenderClock draws at, averaged over 144 Hz frames once it has settled. */
function settledDelay(patches: number[][], fromMs: number): number {
  const rc = new RenderClock();
  let i = 0;
  let sum = 0;
  let frames = 0;
  const last = patches[patches.length - 1]![0]!;
  for (let f = patches[0]![0]!; f < last; f += 1000 / 144) {
    while (i < patches.length && patches[i]![0]! <= f) { rc.onPatch(patches[i]![1]!, patches[i]![0]!); i++; }
    rc.renderTime(f);
    if (f >= fromMs) { sum += rc.delayMs; frames++; }
  }
  return sum / frames;
}

const share = (run: Run, pred: (steps: number) => boolean) => run.wakes.filter((w) => pred(w.steps)).length / run.wakes.length;

describe("ten minutes of wakes", () => {
  const hiccupAt = [200_000, 400_000];
  const pacer = runPacer(600, 11, [{ at: hiccupAt[0]!, work: 120 }, { at: hiccupAt[1]!, work: 420 }]);
  const legacy = runLegacy(600, 11);
  const nearHiccup = (at: number) => hiccupAt.some((h) => at >= h && at < h + 600);

  it("steps once a wake on the pacer, with no two-step wake outside the hiccups", () => {
    expect(share(pacer, (n) => n === 1)).toBeGreaterThanOrEqual(0.99);
    const calm = pacer.wakes.filter((w) => !nearHiccup(w.at));
    expect(calm.filter((w) => w.steps >= 2).length / calm.length).toBeLessThan(0.005);
    expect(calm.filter((w) => w.steps === 0).length / calm.length).toBeLessThan(0.005);
  });

  it("keeps virtual time on the wall grid: within a step everywhere, the re-anchor's drop aside", () => {
    let steps = 0;
    for (const w of pacer.wakes) {
      steps += w.steps;
      const behind = w.at - 10.4 - pacer.dropped * (w.at >= hiccupAt[1]! ? 1 : 0) - steps * TICK_MS;
      if (nearHiccup(w.at)) continue;
      expect(Math.abs(behind), `at ${w.at.toFixed(1)}`).toBeLessThan(TICK_MS);
      // No backlog after a wake: the timer is set for the next slot (the wake may have come 1 ms early, the delay is rounded up).
      expect(w.nextSlot! - w.at).toBeLessThanOrEqual(TICK_MS + 2);
    }
    expect(pacer.dropped).toBeGreaterThan(0); // the 420 ms step did drop sim time
    expect(pacer.dropped % TICK_MS).toBe(0);
  });

  it("the old driver makes two-step wakes the pacer does not", () => {
    expect(share(legacy, (n) => n >= 2)).toBeGreaterThanOrEqual(0.01);
  });

  it("lets the client's RenderClock settle at its floor, where the old driver's sawtooth holds it 8+ ms above", () => {
    const calmPacer = runPacer(120, 5);
    const calmLegacy = runLegacy(120, 5);
    const paced = settledDelay(calmPacer.patches, 20_000);
    const old = settledDelay(calmLegacy.patches, 20_000);
    expect(paced).toBeLessThanOrEqual(MIN_INTERP_DELAY_MS + 2);
    expect(old).toBeGreaterThanOrEqual(MIN_INTERP_DELAY_MS + 8);
  });
});

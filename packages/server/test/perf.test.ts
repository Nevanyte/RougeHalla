// The Phase 11 tick budget (docs/GAME_DESIGN.md 17): with 8 players and the map's mobs (40 camps, about 170 on a zone-shapes map) a
// step() averages under 5 ms and its 99th percentile stays under 15 ms. The scenarios are bench/stepBench.ts: eight
// players at eight camps, and the pathfinder's worst case (every camp woken every second, players re-locking every
// TARGET_REPATH_MS). The machine may be busy (other tests run in parallel, and on a shared one the process is preempted in
// the middle of a step), so the best of five attempts counts (one attempt is a second of play) and each is judged by the
// smaller of its wall-clock and its CPU time (gateMs): a real regression raises both, in every attempt.
// The third case is R4a's gate: every buff at 4 stacks on all 8 players (the fold in sim/mods.ts and updateMods run for
// every fighter).
//
// With fill bots (docs/BOTS.md 9.2) the gates read the whole Room tick of a human-less 8-bot lineup (beforeStep + step +
// afterPatch) and, apart, the bots' share of it (beforeStep + afterPatch). Timing noise only ever adds, so each metric is the
// minimum over the attempts, the clock is the thread's CPU time (a busy machine preempting the test adds nothing to it), and the
// first 200 active ticks (JIT warm-up, the bots' first path searches) are left out of every number: they are reported by
// `stepBench.ts --bots 8` (a cold process spikes to 25-40 ms there), not gated.
import { describe, expect, it } from "vitest";
import {
  AVG_BUDGET_MS, BOTS_SHARE_AVG_BUDGET_MS, BOTS_SHARE_P99_BUDGET_MS, gateMs, P99_BUDGET_MS, runStepBench,
  type BenchOptions, type BenchResult,
} from "../bench/stepBench";

function bestOfFive(opts: BenchOptions): BenchResult {
  let best: BenchResult | null = null;
  for (let i = 0; i < 5; i++) {
    const r = runStepBench({ ticks: 600, ...opts });
    const g = gateMs(r);
    if (!best || g.avg + g.p99 < gateMs(best).avg + gateMs(best).p99) best = r;
    if (g.avg < AVG_BUDGET_MS && g.p99 < P99_BUDGET_MS) return r;
  }
  return best!;
}

describe("tick budget", () => {
  it("8 players and the map's ~170 mobs: step() averages under 5 ms with a p99 under 15 ms", () => {
    const r = bestOfFive({});
    // A mob that dies is replaced the next tick, and its corpse leaves the state 1.5 s after it fell: the count dips by a few.
    expect(r.mobs).toBeGreaterThanOrEqual(150);
    expect(r.avgFighting).toBeGreaterThan(8);
    expect(gateMs(r).avg).toBeLessThan(AVG_BUDGET_MS);
    expect(gateMs(r).p99).toBeLessThan(P99_BUDGET_MS);
  }, 120_000);

  it("the pathfinder's worst case (most of the ~170 mobs awake and repathing, 8 players re-locking every 250 ms): the same budget", () => {
    const r = bestOfFive({ stress: true });
    expect(r.mobs).toBeGreaterThanOrEqual(150);
    // Loaded: most mobs are chasing or walking home at any moment (measured about 150 awake, 85 fighting of 172 on seed 1; about 70 and 50 of 80 on the R2 maps).
    expect(r.avgAwake).toBeGreaterThan(80);
    expect(gateMs(r).avg).toBeLessThan(AVG_BUDGET_MS);
    expect(gateMs(r).p99).toBeLessThan(P99_BUDGET_MS);
  }, 120_000);

  it("the same with every buff at 4 stacks on all 8 players (R4a's gate)", () => {
    const r = bestOfFive({ buffs: true });
    expect(r.mobs).toBeGreaterThanOrEqual(150);
    expect(gateMs(r).avg).toBeLessThan(AVG_BUDGET_MS);
    expect(gateMs(r).p99).toBeLessThan(P99_BUDGET_MS);
  }, 120_000);
});

interface Gated {
  wholeAvg: number;
  wholeP99: number;
  shareAvg: number;
  shareP99: number;
}

const passes = (g: Gated): boolean =>
  g.wholeAvg < AVG_BUDGET_MS && g.wholeP99 < P99_BUDGET_MS && g.shareAvg < BOTS_SHARE_AVG_BUDGET_MS && g.shareP99 < BOTS_SHARE_P99_BUDGET_MS;

/** Up to `attempts` runs of the same (deterministic) scenario; each metric is its minimum over them, and a pass ends the loop. */
function minOverAttempts(opts: BenchOptions, attempts = 4): { best: Gated; last: BenchResult; attempts: number } {
  let best: Gated | null = null;
  let last: BenchResult | null = null;
  let n = 0;
  while (n < attempts) {
    const r = runStepBench(opts);
    n++;
    last = r;
    const b = r.bots!;
    best = best
      ? {
        wholeAvg: Math.min(best.wholeAvg, b.whole.avgMs), wholeP99: Math.min(best.wholeP99, b.whole.p99Ms),
        shareAvg: Math.min(best.shareAvg, b.share.avgMs), shareP99: Math.min(best.shareP99, b.share.p99Ms),
      }
      : { wholeAvg: b.whole.avgMs, wholeP99: b.whole.p99Ms, shareAvg: b.share.avgMs, shareP99: b.share.p99Ms };
    if (passes(best)) break;
  }
  return { best: best!, last: last!, attempts: n };
}

describe("tick budget with in-process bots (docs/BOTS.md 9.2)", () => {
  const BOTS = 8;
  const TICKS = 1000;
  // The drawn mix; the costliest tier alone; and the endgame, where all eight see each other in the sealed coliseum (about twice
  // the cost of the field: every bot perceives every other, and nothing else is in view to skip). The map's own mobs (about 170).
  const scenarios: Array<{ name: string; opts: BenchOptions }> = [
    { name: "8 bots (tiers drawn), the map's mobs", opts: { seed: 1 } },
    { name: "8 hard bots, the map's mobs", opts: { seed: 3, botTier: "hard" } },
    { name: "8 bots in the locked coliseum, the map's mobs at rest", opts: { seed: 3, coliseum: true } },
  ];

  it.each(scenarios)("$name: whole tick avg < 5 ms, p99 < 15 ms; the bots' share avg < 1.5 ms, p99 < 6 ms", ({ opts }) => {
    const { best, last } = minOverAttempts({ ...opts, bots: BOTS, ticks: TICKS, clock: "cpu" });
    const b = last.bots!;
    // The gates would also pass for a run in which nothing happens, so the scenario is checked to be a loaded one.
    expect(b.bots).toBe(BOTS);
    expect(b.aliveBots).toBe(BOTS);
    expect(last.mobs).toBeGreaterThanOrEqual(150);
    expect(b.manager.errors).toBe(0);
    expect(b.manager.refused).toBe(0);
    expect(b.manager.sent).toBeGreaterThan(40);
    // One frame per bot per tick once the raid is on (the first ticks wait for the frame ring to fill).
    expect(b.manager.frames).toBeGreaterThan(BOTS * (b.warmupTicks + TICKS) * 0.95);
    expect(b.share.avgMs).toBeGreaterThan(0.02);
    expect(b.gatesLocked).toBe(opts.coliseum === true);
    // The whole tick contains the bots' share.
    expect(best.wholeAvg).toBeGreaterThan(best.shareAvg);

    expect(best.wholeAvg).toBeLessThan(AVG_BUDGET_MS);
    expect(best.wholeP99).toBeLessThan(P99_BUDGET_MS);
    expect(best.shareAvg).toBeLessThan(BOTS_SHARE_AVG_BUDGET_MS);
    expect(best.shareP99).toBeLessThan(BOTS_SHARE_P99_BUDGET_MS);
  }, 120_000);
});

// The Phase 11 tick budget (docs/GAME_DESIGN.md 17): with 8 players and 60 mobs a step() averages under 5 ms and its
// 99th percentile stays under 15 ms. The scenario is bench/stepBench.ts. The machine may be busy (other tests run in
// parallel, and a load average of 12-20 has made a wall-clock p99 fail while the sim was fine), so the gate reads
// `gateMs`: per step the smaller of the wall time and the process's CPU time, which a preempted step does not accrue. The best
// of three attempts still counts. The second case is R4a's gate: every buff at 4 stacks on all 8 players (the fold in
// sim/mods.ts and updateMods run for every fighter). Both use the same measure.
//
// With fill bots (docs/BOTS.md 9.2) the gates read the whole Room tick of a human-less 8-bot lineup (beforeStep + step +
// afterPatch) and, apart, the bots' share of it (beforeStep + afterPatch). Timing noise only ever adds, so each metric is the
// minimum over the attempts, the clock is the thread's CPU time (a busy machine preempting the test adds nothing to it), and the
// first 200 active ticks (JIT warm-up, the bots' first path searches) are left out of every number: they are reported by
// `stepBench.ts --bots 8` (a cold process spikes to 25-40 ms there), not gated.
import { describe, expect, it } from "vitest";
import {
  AVG_BUDGET_MS, BOTS_SHARE_AVG_BUDGET_MS, BOTS_SHARE_P99_BUDGET_MS, P99_BUDGET_MS, runStepBench,
  type BenchOptions, type BenchResult,
} from "../bench/stepBench";

const within = (r: BenchResult): boolean => r.gateMs.avgMs < AVG_BUDGET_MS && r.gateMs.p99Ms < P99_BUDGET_MS;

function bestOfThree(opts: { buffs?: boolean } = {}): BenchResult {
  let best: BenchResult | null = null;
  for (let i = 0; i < 3; i++) {
    const r = runStepBench({ ticks: 600, ...opts });
    if (!best || r.gateMs.avgMs + r.gateMs.p99Ms < best.gateMs.avgMs + best.gateMs.p99Ms) best = r;
    if (within(r)) return r;
  }
  return best!;
}

/** What the run measured, for a failure message and the log (wall, cpu and the gated number). */
function report(r: BenchResult): string {
  const f = (n: number): string => n.toFixed(3);
  return `wall avg ${f(r.avgMs)} p99 ${f(r.p99Ms)}; cpu ${r.cpuMs ? `avg ${f(r.cpuMs.avgMs)} p99 ${f(r.cpuMs.p99Ms)}` : "n/a"}; gate avg ${f(r.gateMs.avgMs)} p99 ${f(r.gateMs.p99Ms)} (ms per step)`;
}

describe("tick budget", () => {
  it("8 players and 60 mobs: step() averages under 5 ms with a p99 under 15 ms", () => {
    const r = bestOfThree();
    console.log(`tick budget, 60 mobs: ${report(r)}`);
    // A mob that dies is replaced the next tick, and its corpse leaves the state 1.5 s after it fell: the count dips by a few.
    expect(r.mobs).toBeGreaterThanOrEqual(55);
    expect(r.gateMs.avgMs, report(r)).toBeLessThan(AVG_BUDGET_MS);
    expect(r.gateMs.p99Ms, report(r)).toBeLessThan(P99_BUDGET_MS);
  }, 120_000);

  it("the same with every buff at 4 stacks on all 8 players (R4a's gate)", () => {
    const r = bestOfThree({ buffs: true });
    console.log(`tick budget, every buff at 4 stacks: ${report(r)}`);
    expect(r.mobs).toBeGreaterThanOrEqual(55);
    expect(r.gateMs.avgMs, report(r)).toBeLessThan(AVG_BUDGET_MS);
    expect(r.gateMs.p99Ms, report(r)).toBeLessThan(P99_BUDGET_MS);
  }, 120_000);

  it("the gate never reads more than the wall time, and a step's CPU time is a real clock", () => {
    const r = runStepBench({ ticks: 150, warmup: 30 });
    expect(r.gateMs.avgMs).toBeLessThanOrEqual(r.avgMs + 1e-9);
    expect(r.gateMs.p99Ms).toBeLessThanOrEqual(r.p99Ms + 1e-9);
    if (r.cpuMs) {
      expect(r.cpuMs.avgMs).toBeGreaterThan(0);
      // Preemption cannot make CPU time exceed wall time by much (GC threads add a little).
      expect(r.cpuMs.avgMs).toBeLessThan(r.avgMs * 3 + 1);
    }
  }, 60_000);
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
  // The drawn mix on a mob-heavy seed; the costliest tier alone; and the endgame, where all eight see each other in the sealed
  // coliseum (about twice the cost of the field: every bot perceives every other, and nothing else is in view to skip).
  const scenarios: Array<{ name: string; opts: BenchOptions }> = [
    { name: "8 bots (tiers drawn), 60 mobs", opts: { seed: 1 } },
    { name: "8 hard bots, 60 mobs", opts: { seed: 3, botTier: "hard" } },
    { name: "8 bots in the locked coliseum, 60 mobs at rest", opts: { seed: 3, coliseum: true } },
  ];

  it.each(scenarios)("$name: whole tick avg < 5 ms, p99 < 15 ms; the bots' share avg < 1.5 ms, p99 < 6 ms", ({ opts }) => {
    const { best, last } = minOverAttempts({ ...opts, bots: BOTS, ticks: TICKS, clock: "cpu" });
    const b = last.bots!;
    // The gates would also pass for a run in which nothing happens, so the scenario is checked to be a loaded one.
    expect(b.bots).toBe(BOTS);
    expect(b.aliveBots).toBe(BOTS);
    expect(last.mobs).toBeGreaterThanOrEqual(55);
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

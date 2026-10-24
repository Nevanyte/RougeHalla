// The Phase 11 tick budget (docs/GAME_DESIGN.md 17): with 8 players and 60 mobs a step() averages under 5 ms and its
// 99th percentile stays under 15 ms. The scenario is bench/stepBench.ts. The machine may be busy (other tests run in
// parallel), so the best of three attempts counts: a real regression fails all of them.
import { describe, expect, it } from "vitest";
import { runStepBench, type BenchResult } from "../bench/stepBench";

const AVG_BUDGET_MS = 5;
const P99_BUDGET_MS = 15;

function bestOfThree(): BenchResult {
  let best: BenchResult | null = null;
  for (let i = 0; i < 3; i++) {
    const r = runStepBench({ ticks: 600 });
    if (!best || r.avgMs + r.p99Ms < best.avgMs + best.p99Ms) best = r;
    if (r.avgMs < AVG_BUDGET_MS && r.p99Ms < P99_BUDGET_MS) return r;
  }
  return best!;
}

describe("tick budget", () => {
  it("8 players and 60 mobs: step() averages under 5 ms with a p99 under 15 ms", () => {
    const r = bestOfThree();
    expect(r.mobs).toBeGreaterThanOrEqual(60);
    expect(r.avgMs).toBeLessThan(AVG_BUDGET_MS);
    expect(r.p99Ms).toBeLessThan(P99_BUDGET_MS);
  }, 120_000);
});

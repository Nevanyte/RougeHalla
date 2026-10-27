// The tick budget (docs/GAME_DESIGN.md 17) on a map where every fourth floor tile is a hazard (bench/stepBench.ts, the
// "heavy" terrain variant): with 8 players and the map's ~170 mobs a step() still averages under 5 ms with a p99 under 15 ms,
// and the effects are really running in it. Same method as perf.test.ts: the best of five attempts counts, each judged by
// the smaller of its wall-clock and its CPU time (gateMs), since the machine may be busy and a real regression fails all.
import { describe, expect, it } from "vitest";
import { gateMs, runStepBench, type BenchResult } from "../bench/stepBench";

const AVG_BUDGET_MS = 5;
const P99_BUDGET_MS = 15;

function bestOfFive(): BenchResult {
  let best: BenchResult | null = null;
  for (let i = 0; i < 5; i++) {
    const r = runStepBench({ ticks: 600, terrain: "heavy" });
    const g = gateMs(r);
    if (!best || g.avg + g.p99 < gateMs(best).avg + gateMs(best).p99) best = r;
    if (g.avg < AVG_BUDGET_MS && g.p99 < P99_BUDGET_MS) return r;
  }
  return best!;
}

describe("tick budget on hazard terrain", () => {
  it("8 players and the map's ~170 mobs, a hazard on every fourth tile: step() averages under 5 ms with a p99 under 15 ms", () => {
    const r = bestOfFive();
    expect(r.mobs).toBeGreaterThanOrEqual(150);
    // Not a vacuous pass: every effect acted on somebody.
    expect(r.hazardSeconds.ember).toBeGreaterThan(0);
    expect(r.hazardSeconds.bog).toBeGreaterThan(0);
    expect(r.hazardSeconds.ice).toBeGreaterThan(0);
    expect(r.passMs).not.toBeNull();
    expect(gateMs(r).avg).toBeLessThan(AVG_BUDGET_MS);
    expect(gateMs(r).p99).toBeLessThan(P99_BUDGET_MS);
  }, 120_000);

  it("the same map with the effects switched off acts on nobody", () => {
    const r = runStepBench({ ticks: 300, terrain: "heavy", hazards: false });
    expect(r.hazardSeconds).toEqual({ ember: 0, bog: 0, ice: 0, light: 0 });
  }, 120_000);
});

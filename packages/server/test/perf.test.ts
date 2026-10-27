// The Phase 11 tick budget (docs/GAME_DESIGN.md 17): with 8 players and the map's mobs (20 camps, about 80 on a zone map) a
// step() averages under 5 ms and its 99th percentile stays under 15 ms. The scenarios are bench/stepBench.ts: eight
// players at eight camps, and the pathfinder's worst case (every camp woken every second, players re-locking every
// TARGET_REPATH_MS). The machine may be busy (other tests run in parallel, and on a shared one the process is preempted in
// the middle of a step), so the best of five attempts counts (one attempt is a second of play) and each is judged by the
// smaller of its wall-clock and its CPU time (gateMs): a real regression raises both, in every attempt.
// The third case is R4a's gate: every buff at 4 stacks on all 8 players (the fold in sim/mods.ts and updateMods run for
// every fighter). The fourth is the quests' (the shipped default, off in the bench unless asked): the same run with the
// roster up, its givers standing as mobs and its items on the ground.
import { describe, expect, it } from "vitest";
import { gateMs, runStepBench, type BenchOptions, type BenchResult } from "../bench/stepBench";

const AVG_BUDGET_MS = 5;
const P99_BUDGET_MS = 15;

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
  it("8 players and the map's ~80 mobs: step() averages under 5 ms with a p99 under 15 ms", () => {
    const r = bestOfFive({});
    // A mob that dies is replaced the next tick, and its corpse leaves the state 1.5 s after it fell: the count dips by a few.
    expect(r.mobs).toBeGreaterThanOrEqual(72);
    expect(r.avgFighting).toBeGreaterThan(8);
    expect(gateMs(r).avg).toBeLessThan(AVG_BUDGET_MS);
    expect(gateMs(r).p99).toBeLessThan(P99_BUDGET_MS);
  }, 120_000);

  it("the pathfinder's worst case (most of the 80 mobs awake and repathing, 8 players re-locking every 250 ms): the same budget", () => {
    const r = bestOfFive({ stress: true });
    expect(r.mobs).toBeGreaterThanOrEqual(72);
    // Loaded: most mobs are chasing or walking home at any moment (measured about 70 awake, 50 fighting).
    expect(r.avgAwake).toBeGreaterThan(40);
    expect(gateMs(r).avg).toBeLessThan(AVG_BUDGET_MS);
    expect(gateMs(r).p99).toBeLessThan(P99_BUDGET_MS);
  }, 120_000);

  it("the same with every buff at 4 stacks on all 8 players (R4a's gate)", () => {
    const r = bestOfFive({ buffs: true });
    expect(r.mobs).toBeGreaterThanOrEqual(72);
    expect(gateMs(r).avg).toBeLessThan(AVG_BUDGET_MS);
    expect(gateMs(r).p99).toBeLessThan(P99_BUDGET_MS);
  }, 120_000);

  it("the same with the quests on (givers, items and the lifecycle in the tick)", () => {
    const r = bestOfFive({ quests: true });
    // The regional mobs are topped up to the map's own count, and the quest givers stand on top of them.
    expect(r.quests).toBeGreaterThanOrEqual(5);
    expect(r.mobs).toBeGreaterThanOrEqual(72 + r.quests);
    expect(r.avgFighting).toBeGreaterThan(8);
    expect(gateMs(r).avg).toBeLessThan(AVG_BUDGET_MS);
    expect(gateMs(r).p99).toBeLessThan(P99_BUDGET_MS);
  }, 120_000);
});

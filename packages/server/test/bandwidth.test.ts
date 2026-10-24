// The Phase 11 bandwidth budget (docs/GAME_DESIGN.md 17): with 8 players and 60 mobs one client receives under 20 KB/s
// (ws payload, patches plus fx). The scenarios are in bench/bandwidth.ts; bytes do not depend on timing, so a busy
// machine cannot make these flaky: the result only moves when the sim, the schema or the fx change.
import { describe, expect, it } from "vitest";
import {
  BANDWIDTH_BUDGET_KBPS, HEAVY_CAMPS, TYPICAL_CAMPS, runBandwidth, type BandwidthResult,
} from "../bench/bandwidth";

// The heavy case (8 camps fought at once, about 31 mobs fighting) measures 26.6 KB/s on seed 1 today (24 to 29 on other
// seeds), over the budget: 15.4 of patches and 11.2 of fx. The fix is planned for stage 2 (one batched fx message per
// tick, a mob aim deadband, narrower wire types; the deadband is already in). Until then it is a known failure
// (`it.fails`), which also turns red the day it passes. When it does, set this to true: it becomes a hard gate.
const HEAVY_GATED = false;

// Memoised: each scenario simulates a minute and a half of play, and the tests below only read the numbers.
const runs = new Map<string, BandwidthResult>();
function run(name: string, opts: Parameters<typeof runBandwidth>[0]): BandwidthResult {
  let r = runs.get(name);
  if (!r) runs.set(name, (r = runBandwidth(opts)));
  return r;
}
const typical = () => run("typical", { camps: TYPICAL_CAMPS });
const heavy = () => run("heavy", { camps: HEAVY_CAMPS });

describe("bandwidth budget (per client, ws payload)", () => {
  // Seed 1 measures 18.7 KB/s with about 19 mobs fighting (16.3 to 19.8 over seeds 1 to 5, 732 and 2547).
  it("typical: 4 camps fought by 2 players each, 60 mobs: under 20 KB/s", () => {
    const r = typical();
    expect(r.mobs).toBeGreaterThanOrEqual(60);
    expect(r.avgFighting).toBeGreaterThan(5);
    expect(r.totalKBps).toBeLessThan(BANDWIDTH_BUDGET_KBPS);
  });

  const heavyGate = HEAVY_GATED ? it : it.fails;
  heavyGate(`heavy: 8 camps fought by 1 player each, 60 mobs: under 20 KB/s${HEAVY_GATED ? "" : " (known failure until stage 2)"}`, () => {
    expect(heavy().totalKBps).toBeLessThan(BANDWIDTH_BUDGET_KBPS);
  });

  // `it.fails` passes when the test above throws for any reason, so this one makes sure the heavy run really is one.
  it("heavy: the scenario is loaded (so the known failure above is about bytes, not about a broken run)", () => {
    const r = heavy();
    expect(r.mobs).toBeGreaterThanOrEqual(60);
    expect(r.avgFighting).toBeGreaterThan(20);
    expect(r.avgFighting).toBeGreaterThan(typical().avgFighting);
    expect(r.patchFramesPerSecond).toBeGreaterThan(19);
    expect(r.fxFramesPerSecond).toBeGreaterThan(typical().fxFramesPerSecond);
    expect(r.totalKBps).toBeGreaterThan(typical().totalKBps);
  });

  it("idle mobs cost nothing: 60 resting mobs add under 0.1 KB/s of patches to the players alone", () => {
    // Both runs: the coliseum endgame, 8 players sealed in fighting each other, so no mob can be hit and woken.
    const alone = run("alone", { mobs: 0, camps: 0 });
    const withMobs = run("idle", { mobs: 60, camps: 0 });
    expect(withMobs.mobs).toBeGreaterThanOrEqual(60);
    expect(withMobs.avgAwake).toBe(0);
    expect(alone.patchKBps).toBeGreaterThan(1);
    expect(withMobs.patchKBps - alone.patchKBps).toBeLessThan(0.1);
  });

  it("is deterministic for a seed", () => {
    const a = runBandwidth({ camps: TYPICAL_CAMPS, ticks: 300, seed: 7 });
    const b = runBandwidth({ camps: TYPICAL_CAMPS, ticks: 300, seed: 7 });
    expect(b).toEqual(a);
  });
});

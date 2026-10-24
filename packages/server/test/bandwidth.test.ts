// The Phase 11 bandwidth budget (docs/GAME_DESIGN.md 17): with 8 players and 60 mobs one client receives under 20 KB/s
// (ws payload, patches plus fx). The scenarios are in bench/bandwidth.ts; bytes do not depend on timing, so a busy
// machine cannot make these flaky: the result only moves when the sim, the schema or the fx change.
import { describe, expect, it } from "vitest";
import {
  BANDWIDTH_BUDGET_KBPS, HEAVY_CAMPS, TYPICAL_CAMPS, runBandwidth, type BandwidthResult,
} from "../bench/bandwidth";

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
  // Seed 1 measures 10.4 KB/s with about 17 mobs fighting (9.8 to 12.2 over seeds 1 to 5, 732 and 2547).
  it("typical: 4 camps fought by 2 players each, 60 mobs: under 20 KB/s", () => {
    const r = typical();
    expect(r.mobs).toBeGreaterThanOrEqual(60);
    expect(r.avgFighting).toBeGreaterThan(5);
    expect(r.totalKBps).toBeLessThan(BANDWIDTH_BUDGET_KBPS);
  });

  // Seed 1 measures 15.8 KB/s with about 28 mobs fighting (15.8 to 18.3 over the same seeds, up to 34 fighting).
  it("heavy: 8 camps fought by 1 player each, 60 mobs: under 20 KB/s", () => {
    expect(heavy().totalKBps).toBeLessThan(BANDWIDTH_BUDGET_KBPS);
  });

  // The gate above would also pass for a run in which nothing happens, so this one makes sure the heavy run is loaded.
  it("heavy: the scenario is loaded (so the gate above is about bytes, not about a broken run)", () => {
    const r = heavy();
    expect(r.mobs).toBeGreaterThanOrEqual(60);
    expect(r.avgFighting).toBeGreaterThan(20);
    expect(r.avgFighting).toBeGreaterThan(typical().avgFighting);
    expect(r.patchFramesPerSecond).toBeGreaterThan(19);
    expect(r.fxFramesPerSecond).toBeGreaterThan(typical().fxFramesPerSecond);
    // fx are batched: one message per step with any fx, never one per event (that is 100+ frames a second here).
    expect(r.fxFramesPerSecond).toBeLessThanOrEqual(20.5);
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

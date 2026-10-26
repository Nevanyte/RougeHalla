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
  // Seed 1 measures 10.0 KB/s with about 17 mobs fighting (9.1 to 10.5 over seeds 1 to 5, 732 and 2547).
  it("typical: 4 camps fought by 2 players each, 60 mobs: under 20 KB/s", () => {
    const r = typical();
    expect(r.mobs).toBeGreaterThanOrEqual(58); // topped up to 60 every tick; the last tick's kills are replaced in the next
    expect(r.avgFighting).toBeGreaterThan(5);
    expect(r.totalKBps).toBeLessThan(BANDWIDTH_BUDGET_KBPS);
  });

  // Seed 1 measures 15.1 KB/s with about 34 mobs fighting (14.1 to 16.3 over the seven seeds, up to 37 fighting).
  it("heavy: 8 camps fought by 1 player each, 60 mobs: under 20 KB/s", () => {
    expect(heavy().totalKBps).toBeLessThan(BANDWIDTH_BUDGET_KBPS);
  });

  // The seeds that went over before the projectiles left the patches and fighters were named by roster index (the sim moves
  // the numbers by a KB/s or so either way, so one seed is not a fair gate). Every run simulates a minute of play.
  it.each([5, 732, 2547])("heavy, seed %i: under 20 KB/s as well", (seed) => {
    const r = run(`heavy${seed}`, { camps: HEAVY_CAMPS, seed });
    expect(r.avgFighting).toBeGreaterThan(20);
    expect(r.totalKBps).toBeLessThan(BANDWIDTH_BUDGET_KBPS);
  });

  // The gate above would also pass for a run in which nothing happens, so this one makes sure the heavy run is loaded.
  it("heavy: the scenario is loaded (so the gate above is about bytes, not about a broken run)", () => {
    const r = heavy();
    expect(r.mobs).toBeGreaterThanOrEqual(58); // topped up to 60 every tick; the last tick's kills are replaced in the next
    expect(r.avgFighting).toBeGreaterThan(20);
    expect(r.avgFighting).toBeGreaterThan(typical().avgFighting);
    expect(r.patchFramesPerSecond).toBeGreaterThan(19);
    expect(r.fxFramesPerSecond).toBeGreaterThan(typical().fxFramesPerSecond);
    // fx are batched: one message per step with any fx, never one per event (that is 100+ frames a second here).
    expect(r.fxFramesPerSecond).toBeLessThanOrEqual(20.5);
    // arrows and balls travel in those batches: the patches carry none (60 a second here, 50-odd bytes each as a map entry).
    expect(r.fxByKind.launch!.frames / r.seconds).toBeGreaterThan(20);
    expect(r.fxByKind.launch!.bytes / r.fxByKind.launch!.frames).toBeLessThan(25);
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

  // Roguelike R5: seed 1 measures 7.16 KB/s against 6.87 for the same run without them (5 chests up, each picked and skipped).
  it("5 camp chests up the whole time, on the typical load: under 20 KB/s, under 1 KB/s more than without them", () => {
    const r = run("chests", { camps: TYPICAL_CAMPS, chests: 5 });
    expect(r.totalKBps).toBeLessThan(BANDWIDTH_BUDGET_KBPS);
    expect(r.totalKBps - typical().totalKBps).toBeLessThan(1);
    expect(r.fxByKind.chestTaken!.frames).toBeGreaterThan(10);
  });

  it("is deterministic for a seed", () => {
    const a = runBandwidth({ camps: TYPICAL_CAMPS, ticks: 300, seed: 7 });
    const b = runBandwidth({ camps: TYPICAL_CAMPS, ticks: 300, seed: 7 });
    expect(b).toEqual(a);
  });
});

// The Phase 11 bandwidth budget (docs/GAME_DESIGN.md 17): with 8 players and 60 mobs one client receives under 20 KB/s
// (ws payload, patches plus fx). The scenarios are in bench/bandwidth.ts; bytes do not depend on timing, so a busy
// machine cannot make these flaky: the result only moves when the sim, the schema or the fx change.
import { describe, expect, it } from "vitest";
import {
  BANDWIDTH_BUDGET_KBPS, BOTS_SCENARIO_BOTS, BOTS_SCENARIO_CAMPS, HEAVY_CAMPS, TYPICAL_CAMPS, runBandwidth, type BandwidthResult,
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
const botsOpts = { bots: BOTS_SCENARIO_BOTS, camps: BOTS_SCENARIO_CAMPS };

describe("bandwidth budget (per client, ws payload)", () => {
  // Seed 1 measures 6.9 KB/s with about 18 mobs fighting (6.9 to 8.2 over seeds 1 to 5, 732 and 2547; 13 to 19 fighting).
  it("typical: 4 camps fought by 2 players each, 60 mobs: under 20 KB/s", () => {
    const r = typical();
    expect(r.mobs).toBeGreaterThanOrEqual(58); // topped up to 60 every tick; the last tick's kills are replaced in the next
    expect(r.avgFighting).toBeGreaterThan(5);
    expect(r.totalKBps).toBeLessThan(BANDWIDTH_BUDGET_KBPS);
  });

  // Seed 1 measures 10.2 KB/s with about 32 mobs fighting (10.2 to 11.9 over the seven seeds, 30 to 37 fighting).
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

  // 7 fill bots (BotManager, in a headless room: the Room's tick order) and one driven client at a camp (docs/BOTS.md 9.2).
  // Seed 1 measures about 3 KB/s with 2 to 3 mobs fighting (2.7 to 4.9 over seeds 1 to 5, 732 and 2547, up to 10 fighting). It sits
  // below the typical load because the bots send inputs only, never `aim`, so far fewer patches carry a `facing`, and they fight
  // each other and the mobs a camp at a time instead of waking every mob of a camp every 3 s.
  it("bots: 7 fill bots and a client at one camp, 60 mobs: under 20 KB/s", () => {
    const r = run("bots", botsOpts);
    expect(r.totalKBps).toBeLessThan(BANDWIDTH_BUDGET_KBPS);
  });

  it.each([732])("bots, seed %i: under 20 KB/s as well", (seed) => {
    const r = run(`bots${seed}`, { ...botsOpts, seed });
    expect(r.avgFighting).toBeGreaterThan(0.5);
    expect(r.totalKBps).toBeLessThan(BANDWIDTH_BUDGET_KBPS);
  });

  // The gate above would also pass if the bots stood still, so this one makes sure they played.
  it("bots: the scenario is loaded (so the gate above is about bytes, not about idle bots)", () => {
    const r = run("bots", botsOpts);
    expect(r.bots!.count).toBe(BOTS_SCENARIO_BOTS);
    expect(r.bots!.aliveAtEnd).toBe(BOTS_SCENARIO_BOTS);
    expect(r.bots!.manager.errors).toBe(0);
    expect(r.bots!.manager.refused).toBe(0);
    // One frame per bot per patch from the raid's start (the first few wait for the frame ring to fill), and they acted.
    expect(r.bots!.manager.frames).toBeGreaterThan(BOTS_SCENARIO_BOTS * (200 + 1200) * 0.95);
    expect(r.bots!.manager.sent).toBeGreaterThan(50);
    expect(r.mobs).toBeGreaterThanOrEqual(58);
    expect(r.avgFighting).toBeGreaterThan(0.5);
    expect(r.patchFramesPerSecond).toBeGreaterThan(19);
    expect(r.fxFramesPerSecond).toBeLessThanOrEqual(20.5);
    expect(r.totalKBps).toBeGreaterThan(1);
  });

  it("is deterministic for a seed", () => {
    const a = runBandwidth({ camps: TYPICAL_CAMPS, ticks: 300, seed: 7 });
    const b = runBandwidth({ camps: TYPICAL_CAMPS, ticks: 300, seed: 7 });
    expect(b).toEqual(a);
  });

  it("is deterministic with bots too (the manager and the headless room replay exactly)", () => {
    const a = runBandwidth({ ...botsOpts, ticks: 300, seed: 7 });
    const b = runBandwidth({ ...botsOpts, ticks: 300, seed: 7 });
    expect(b).toEqual(a);
  });
});

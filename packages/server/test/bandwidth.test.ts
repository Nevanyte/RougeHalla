// The Phase 11 bandwidth budget (docs/GAME_DESIGN.md 17): with 8 players and the map's mobs (20 camps, about 80 mobs on a
// zone map) one client receives under 20 KB/s (ws payload, patches plus fx). The scenarios are in bench/bandwidth.ts and
// are placed from `map.camps`; bytes do not depend on timing, so a busy machine cannot make these flaky: the result only
// moves when the sim, the schema, the fx or the map change.
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
  // Seed 1 measures 6.2 KB/s with about 9 mobs fighting (6.1 to 7.1 over seeds 1 to 5, 732 and 2547; the R2 + R5 tree:
  // camp-wide aggro and MOB_K 0.22).
  it("typical: 4 camps fought by 2 players each, the map's ~80 mobs: under 20 KB/s", () => {
    const r = typical();
    expect(r.mobs).toBeGreaterThanOrEqual(72); // the map's own camps, topped up to that every tick; the last tick's kills are replaced in the next
    expect(r.avgFighting).toBeGreaterThan(5);
    expect(r.totalKBps).toBeLessThan(BANDWIDTH_BUDGET_KBPS);
  });

  // Seed 1 measures 9.4 KB/s with about 21 mobs fighting (8.9 to 10.6 over the seven seeds, 19.6 to 25.1 fighting): eight
  // whole camps of 3 to 5 woken every half second, the most 8 players can pull. (Before R5's MOB_K 0.22 halved a mob's hp,
  // 9.1 to 10.8 with 22 to 28 fighting; on the old 64 x 64 wedge maps, with 60 mobs at 4.6 a camp, 14.1 to 16.3 with up to 37.)
  it("heavy: 8 camps fought by 1 player each, the map's ~80 mobs: under 20 KB/s", () => {
    expect(heavy().totalKBps).toBeLessThan(BANDWIDTH_BUDGET_KBPS);
  });

  // The seeds that went over before the projectiles left the patches and fighters were named by roster index (the sim moves
  // the numbers by a KB/s or so either way, so one seed is not a fair gate). Every run simulates a minute of play.
  it.each([5, 732, 2547])("heavy, seed %i: under 20 KB/s as well", (seed) => {
    const r = run(`heavy${seed}`, { camps: HEAVY_CAMPS, seed });
    // Loaded: 19.6 fighting at seed 5, the fewest (mobs at MOB_K 0.22 die twice as fast, so fewer stand at once).
    expect(r.avgFighting).toBeGreaterThan(18);
    expect(r.totalKBps).toBeLessThan(BANDWIDTH_BUDGET_KBPS);
  });

  // The gate above would also pass for a run in which nothing happens, so this one makes sure the heavy run is loaded.
  it("heavy: the scenario is loaded (so the gate above is about bytes, not about a broken run)", () => {
    const r = heavy();
    expect(r.mobs).toBeGreaterThanOrEqual(72); // the map's own, topped up to that every tick; the last tick's kills are replaced in the next
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

  it("idle mobs cost nothing: the map's ~80 resting mobs add under 0.1 KB/s of patches to the players alone", () => {
    // Both runs: the coliseum endgame, 8 players sealed in fighting each other, so no mob can be hit and woken.
    const alone = run("alone", { mobs: 0, camps: 0 });
    const withMobs = run("idle", { camps: 0 });
    expect(withMobs.mobs).toBeGreaterThanOrEqual(72);
    expect(withMobs.avgAwake).toBe(0);
    expect(alone.patchKBps).toBeGreaterThan(1);
    expect(withMobs.patchKBps - alone.patchKBps).toBeLessThan(0.1);
  });

  // Roguelike R5: seed 1 measures 6.15 KB/s against 6.21 for the same run without them (5 chests up, each picked and skipped;
  // the chests move the fights, so it can come out lower: 6.0 to 7.0 over the seven seeds).
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

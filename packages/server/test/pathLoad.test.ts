// What the pathfinder costs on a 96 x 96 zone map when it is asked for the most the rules allow (roguelike R2): 80 mobs
// woken onto the nearest player every second (each leg of a chase or a walk home is a search, at most one per
// MOB_REPATH_MS per mob) and 8 players changing their target lock every TARGET_REPATH_MS (a search per accepted order, at
// most one per TARGET_REPATH_MS per player, and the chase's re-plan on the same clock). Every search is counted through a
// wrapped findPath (the sim plans paths only through it, as targetingThrottle.test.ts relies on), and timed.
import { describe, expect, it, vi } from "vitest";
import { MOB_REPATH_MS, TARGET_REPATH_MS, TICK_MS } from "@raid/shared";
import { runStepBench } from "../bench/stepBench";

const searches = vi.hoisted(() => ({ n: 0, ms: 0, worstMs: 0 }));
vi.mock("@raid/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@raid/shared")>();
  return {
    ...mod,
    findPath: (...args: Parameters<typeof mod.findPath>) => {
      const t0 = performance.now();
      const out = mod.findPath(...args);
      const ms = performance.now() - t0;
      searches.n++;
      searches.ms += ms;
      if (ms > searches.worstMs) searches.worstMs = ms;
      return out;
    },
  };
});

const PLAYERS = 8;

describe("path searches under the worst fight the rules allow", () => {
  it("stay inside the per-mob and per-player throttles, and are cheap", () => {
    const warmup = 100;
    const ticks = 600;
    // The warm-up is part of the count (the bench cannot reset it): run it first, then the measured run on top.
    searches.n = 0;
    searches.ms = 0;
    searches.worstMs = 0;
    const r = runStepBench({ stress: true, warmup, ticks });
    const seconds = ((warmup + ticks) * TICK_MS) / 1000;
    const perSecond = searches.n / seconds;
    if (process.env.PATHLOAD_REPORT) {
      process.stderr.write(
        `stress: ${r.mobs} mobs, ${r.avgAwake.toFixed(1)} awake, ${r.avgFighting.toFixed(1)} fighting, ${r.avgLocked.toFixed(1)} of ${PLAYERS} players locked; ${searches.n} searches in ${seconds.toFixed(0)} s = ${perSecond.toFixed(1)}/s, ` +
        `${(searches.ms / searches.n).toFixed(3)} ms each (worst ${searches.worstMs.toFixed(2)} ms), ${(searches.ms / (warmup + ticks)).toFixed(3)} ms of a step on average; ` +
        `step avg ${r.avgMs.toFixed(3)} ms, p99 ${r.p99Ms.toFixed(3)} ms\n`,
      );
    }
    // The ceiling the rules give: a mob sends at most one move per MOB_REPATH_MS (the first of a leg goes at once, so allow
    // one more per mob per second for the wakes), a player at most one lock search per TARGET_REPATH_MS and one chase
    // re-plan per TARGET_REPATH_MS, and an arrival from the map's own steering costs nothing here.
    const mobs = r.mobs;
    const ceiling = mobs * (1000 / MOB_REPATH_MS + 1) + PLAYERS * (2 * 1000) / TARGET_REPATH_MS;
    expect(perSecond).toBeLessThanOrEqual(ceiling);
    // And the load is real: a good part of the ceiling is used, so the throttles are what is being measured.
    expect(r.avgAwake).toBeGreaterThan(40);
    expect(r.avgLocked).toBeGreaterThan(3);
    expect(perSecond).toBeGreaterThan(PLAYERS * (1000 / TARGET_REPATH_MS) * 0.5);
    // A search is cheap on this map: about 0.03 ms on average (the worst one measured 1.5 ms). The bound is for a machine
    // that is busy with other work; a single search's wall time is not asserted, since one preempted call can take 50 ms.
    expect(searches.ms / searches.n).toBeLessThan(1);
  }, 120_000);
});

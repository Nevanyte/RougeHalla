// The draw-ahead's scorer and rig (bench/drawAheadScore.ts), which netProbe and netTraceEval run: on a scripted remote walker the
// off arm draws exactly the server's positions, the on arm is 50 ms younger and within a hair of them, and a blink's frames are left
// out as cut frames rather than counted as error.
import { describe, expect, it } from "vitest";
import { encodeWalkDir, mapFromTiles, PATCH_MS, TILE_FLOOR, TILE_WALL, type TimedFx } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { EntityInterpolator } from "../../client/src/net/interpolation";
import { RemoteDraw } from "../../client/src/net/remoteDraw";
import { DrawAheadRig, DrawAheadScorer, verdict } from "../bench/drawAheadScore";

function map() {
  const w = 120;
  const h = 120;
  const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
  for (let i = 0; i < w; i++) { tiles[i] = TILE_WALL; tiles[(h - 1) * w + i] = TILE_WALL; tiles[i * w] = TILE_WALL; tiles[i * w + w - 1] = TILE_WALL; }
  return mapFromTiles(w, h, tiles);
}

/** A remote player walking +x at 170 u/s with the walk hint 3, a blink of 120 u at `blinkAt` (a displaceSeq change). */
function state(k: number, blinkAt: number): RaidState {
  const t = 1000 + k * PATCH_MS;
  const blinked = k >= blinkAt;
  const x = 600 + 8.5 * k + (blinked ? 120 : 0);
  const p = { x, y: 1800, status: "alive", effects: 0, displaceSeq: blinked ? 1 : 0, attackTarget: "", extra: { walkDir: encodeWalkDir(0), walkTicks: 3 } };
  const me = { x: 600, y: 1600, status: "alive", effects: 0, displaceSeq: 0, attackTarget: "", extra: { walkDir: 0, walkTicks: 0 } };
  return { serverTime: t, gatesLocked: false, players: new Map([["r", p], ["me", me]]), mobs: new Map() } as unknown as RaidState;
}

describe("drawAheadScore", () => {
  it("scores a straight walker: the off arm exact, the on arm 50 ms younger and within a hair, a blink's frames left out", () => {
    const m = map();
    const off = new EntityInterpolator();
    const on = new EntityInterpolator({ drawAhead: true });
    const onDraw = new RemoteDraw(on);
    onDraw.setEnabled(true);
    const scorer = new DrawAheadScorer(["off", "on"], 1000 / 144);
    const rig = new DrawAheadRig([
      { name: "off", interp: off, draw: new RemoteDraw(off), owned: true },
      { name: "on", interp: on, draw: onDraw, owned: true },
    ], scorer, "me");
    const blinkAt = 120;
    let k = 0;
    for (let now = 515; now < 515 + 200 * PATCH_MS; now += 1000 / 144) {
      while (500 + k * PATCH_MS + 15 <= now) {
        if (k === 60) rig.onFx({ kind: "hit", id: "r", by: "me", amount: 1, weapon: "sword", t: 1000 + k * PATCH_MS } as TimedFx);
        rig.onPatch(state(k, blinkAt), 500 + k * PATCH_MS + 15);
        k++;
      }
      rig.frame(now, 1000 / 144, now >= 3000, m, 30, () => undefined);
    }
    rig.endSession();
    const a = scorer.report("on");
    const b = scorer.report("off");
    expect(b.players.frames).toBeGreaterThan(1000);
    expect(b.players.errU.max).toBeLessThan(1e-6);
    // Within a hair but after the blink, where the landing is held until the next sample shows the walk again (one tick at most).
    expect(a.players.errU.p95).toBeLessThan(0.1);
    expect(a.players.errU.max).toBeLessThanOrEqual(8.5 + 1e-6);
    expect(a.players.extrapolatedPct).toBeGreaterThan(30);
    expect(b.players.ageMs.mean - a.players.ageMs.mean).toBeGreaterThan(49.5);
    expect(a.players.cutFrames).toBeGreaterThan(0);
    expect(b.players.cutFrames).toBeGreaterThan(0);
    expect(a.players.errCombatU.n).toBeGreaterThan(0);
    expect(a.remote.cutsCrossed).toBe(1);
    expect(a.remote.resetsUnderSnap).toBe(0);
    const v = verdict(a, b, "test");
    expect(v.pass).toBe(true);
    expect(v.lines.filter((l) => /G[234] PASS/.test(l))).toHaveLength(3);
  });
});

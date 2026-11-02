import { describe, expect, it } from "vitest";
import { PLAYER_SPEED, TICK_MS, type Vec2 } from "@raid/shared";
import { advanceAlongPath, velocityOf } from "../src/sim/movement";
import {
  constantVelocity, evaluate, hold, holdLastSteer, nextMove, pathFollow, walkMs, type PredictContext,
} from "../src/sim/predictBaselines";
import type { TraceOrder, TraceRow } from "../src/sim/trace";

const HORIZONS = [50, 100, 150, 200, 250, 300];
const STEP = (PLAYER_SPEED * TICK_MS) / 1000;

function row(over: Partial<TraceRow>): TraceRow {
  return {
    run: "synthetic", tick: 0, serverTime: 0, id: "p", faction: "fire", weapon: "sword", bot: false, x: 0, y: 0, facing: 0, vx: 0, vy: 0,
    pathEnd: null, pathLen: 0, path: [], walkedThisTick: false, slip: false, action: null, rooted: false, rootFrom: null, rootUntil: null,
    lock: null, hp: 1, lastHitAt: null, enemy: null, effects: 0, speedMult: 1, walkMult: 1, displaceSeq: 0, orders: [],
    ...over,
  };
}

/**
 * A walker driven by the sim's own walking (advanceAlongPath at PLAYER_SPEED) along `waypoints`, recorded the way the trace
 * records it: velocity over the last 100 ms of history, the path in hand, the order on the tick it was given.
 */
function walk(waypoints: Vec2[], ticks: number, order: TraceOrder | null = null): TraceRow[] {
  const p = { x: 0, y: 0, facing: 0 };
  const rt = { path: waypoints.map((q) => ({ ...q })), history: [{ t: 0, x: 0, y: 0 }] };
  const rows: TraceRow[] = [];
  for (let k = 1; k <= ticks; k++) {
    const t = k * TICK_MS;
    advanceAlongPath(p, rt, TICK_MS / 1000);
    rt.history.push({ t, x: p.x, y: p.y });
    const v = velocityOf(rt, p, t);
    const end = rt.path[rt.path.length - 1];
    rows.push(row({
      tick: k, serverTime: t, x: p.x, y: p.y, vx: v.x, vy: v.y, path: rt.path.map((q) => ({ ...q })), pathEnd: end ? { ...end } : null,
      orders: k === 1 && order ? [order] : [],
    }));
  }
  return rows;
}

const at = (report: ReturnType<typeof evaluate>, h: number) => report.horizons.find((x) => x.horizonMs === h)!;

describe("movement prediction baselines", () => {
  it("a constant-velocity walker: constantVelocity is exact, hold misses by speed x horizon", () => {
    const rows = walk([{ x: 5000, y: 0 }], 60);
    const report = evaluate(rows, { horizons: HORIZONS });
    for (const h of HORIZONS) {
      const r = at(report, h);
      // The first two ticks have less than 100 ms of history, and the last ones have no truth h later.
      expect(r.samples).toBeGreaterThan(40);
      expect(r.errors.constantVelocity!.all.mean).toBeLessThan(0.5);
      expect(r.errors.pathFollow!.all.p95).toBeLessThan(1e-6);
      expect(r.errors.hold!.all.mean).toBeCloseTo((PLAYER_SPEED * h) / 1000, 6);
      expect(r.errors.hold!.all.p95).toBeCloseTo((PLAYER_SPEED * h) / 1000, 6);
      expect(r.heading.turned).toBe(0);
      expect(r.heading.moving).toBe(r.samples);
    }
    expect(report).toMatchObject({ rows: 60, runs: 1, players: 1 });
  });

  it("a 90 degree turn inside the horizon costs constantVelocity, and counts as a turn", () => {
    const straight = evaluate(walk([{ x: 5000, y: 0 }], 60), { horizons: [300] }).horizons[0]!;
    const turning = evaluate(walk([{ x: 30 * STEP, y: 0 }, { x: 30 * STEP, y: 5000 }], 60), { horizons: [300] }).horizons[0]!;
    expect(turning.heading.turned).toBeGreaterThan(0);
    expect(turning.errors.constantVelocity!.all.p95).toBeGreaterThan(straight.errors.constantVelocity!.all.p95 + 20);
    expect(turning.errors.constantVelocity!.all.mean).toBeGreaterThan(straight.errors.constantVelocity!.all.mean + 2);
    expect(turning.errors.pathFollow!.all.p95).toBeLessThan(1e-6);
  });

  it("pathFollow walks a two-leg path exactly, corner and stop included", () => {
    const rows = walk([{ x: 100, y: 0 }, { x: 100, y: 100 }], 50, { k: "move", x: 100, y: 100 });
    const report = evaluate(rows, { horizons: HORIZONS });
    for (const h of HORIZONS) {
      const r = at(report, h);
      expect(r.errors.pathFollow!.all.p95).toBeLessThan(1e-6);
      expect(r.errors.pathFollow!.all.mean).toBeLessThan(1e-6);
      expect(r.errors.constantVelocity!.all.p95).toBeGreaterThan(1);
    }
    // The walk ends at tick 24 (200 u at 8.5 u a tick): a still player is still at every horizon after.
    expect(at(report, 300).heading.stopped).toBeGreaterThan(0);
    // The order points at the end of the path: walking straight at it cuts the corner.
    expect(at(report, 300).errors.holdLastSteer!.all.mean).toBeGreaterThan(0.5);
    expect(at(report, 300).errors.holdLastSteer!.all.mean).toBeLessThan(at(report, 300).errors.hold!.all.mean);
  });

  it("walks only the steps a known root leaves free, tick by tick", () => {
    // A swing landing 100 ms from now holds only the next tick's step: the tick it lands in walks (weapons run before movement).
    const swing = row({ serverTime: 1000, rooted: true, rootFrom: 1000, rootUntil: 1100 });
    expect(walkMs(swing, 300)).toBe(250);
    // A ranged release: free for one tick, held for the pause, free again once it leaves.
    const ranged = row({ serverTime: 1000, rootFrom: 1100, rootUntil: 1200 });
    expect(walkMs(ranged, 300)).toBe(200);
    expect(walkMs(ranged, 50)).toBe(50);
    expect(walkMs(row({ serverTime: 1000 }), 250)).toBe(250);
    const ctx: PredictContext = { row: row({ ...swing, path: [{ x: 1000, y: 0 }] }), past: [], lastMove: { x: 1000, y: 0 } };
    expect(pathFollow(ctx, 300).x).toBeCloseTo(PLAYER_SPEED * 0.25, 9);
    expect(holdLastSteer(ctx, 300).x).toBeCloseTo(PLAYER_SPEED * 0.25, 9);
    expect(hold(ctx, 300)).toEqual({ x: 0, y: 0 });
    expect(constantVelocity({ ...ctx, row: row({ vx: 10, vy: -20 }) }, 100)).toEqual({ x: 1, y: -2 });
  });

  it("keeps the last walk order until a stop or a lock that took", () => {
    const moved = nextMove(null, row({ orders: [{ k: "move", x: 5, y: 6 }] }));
    expect(moved).toEqual({ x: 5, y: 6 });
    expect(nextMove(moved, row({ orders: [{ k: "aim", a: 1 }] }))).toEqual(moved);
    // A refused lock (any weapon but the wand) leaves the walk; one that took replaces it.
    expect(nextMove(moved, row({ orders: [{ k: "target", id: "m1" }], lock: null }))).toEqual(moved);
    expect(nextMove(moved, row({ orders: [{ k: "target", id: "m1" }], lock: "m1" }))).toBeNull();
    expect(nextMove(moved, row({ orders: [{ k: "stop" }] }))).toBeNull();
    expect(nextMove(null, row({ orders: [{ k: "stop" }, { k: "attackMove", x: 1, y: 2 }] }))).toEqual({ x: 1, y: 2 });
    // Orders that do not walk leave it alone, whatever their kind.
    expect(nextMove(moved, row({ orders: [{ k: "consumeCorpse" }, { k: "huntTarget" }, { k: "swap" }] }))).toEqual(moved);
  });

  it("scores nothing across a forced move or past the end of a life", () => {
    const rows = walk([{ x: 5000, y: 0 }], 30);
    for (const r of rows.slice(15)) { r.x += 300; r.displaceSeq = 1; }
    const r = evaluate(rows, { horizons: [100] }).horizons[0]!;
    // Rows 14 and 15 (1-based tick) see the blink within 100 ms; the last two have no truth.
    expect(r.dropped).toEqual({ ended: 2, displaced: 2 });
    expect(r.samples).toBe(26);
    expect(r.errors.pathFollow!.all.p95).toBeLessThan(1e-6);
  });

  it("counts an empty hand (fists) as unarmed, not melee", () => {
    const rows = walk([{ x: 5000, y: 0 }], 20).map((r, i) => ({ ...r, weapon: i % 2 === 0 ? "fists" as const : "sword" as const }));
    const e = evaluate(rows, { horizons: [50] }).horizons[0]!.errors.hold!;
    expect(e.unarmed.n).toBeGreaterThan(0);
    expect(e.melee.n).toBeGreaterThan(0);
    expect(e.unarmed.n + e.melee.n).toBe(e.all.n);
    expect(e.ranged.n).toBe(0);
  });

  it("splits by weapon and combat", () => {
    const rows = walk([{ x: 5000, y: 0 }], 20).map((r, i) => ({
      ...r, weapon: i % 2 === 0 ? "bow" as const : "axe" as const, lock: i < 10 ? "p2" : null,
    }));
    const r = evaluate(rows, { horizons: [50] }).horizons[0]!;
    const e = r.errors.hold!;
    expect(e.ranged.n + e.melee.n).toBe(e.all.n);
    expect(e.unarmed.n).toBe(0);
    expect(e.combat.n).toBe(10);
    expect(e.calm.n).toBe(e.all.n - 10);
  });
});

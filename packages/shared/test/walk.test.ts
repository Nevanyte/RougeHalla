import { afterEach, describe, expect, it, vi } from "vitest";
import { PLAYER_RADIUS, PLAYER_SPEED, TICK_MS, TILE } from "../src/constants";
import { circleClear } from "../src/geometry";
import { mapFromTiles, TILE_FLOOR, TILE_LOW, TILE_WALL, withGates } from "../src/map";
import type { GameMap } from "../src/map";
import type { Vec2 } from "../src/messages";
import { findPath } from "../src/pathfind";
import { mulberry32 } from "../src/rng";
import { slipAccel } from "../src/terrain";
import {
  newSlip, regrip, SLIP_GRIP_MS, SLIP_REACH, SLIP_REPLAN_MS, SLIP_STUCK_REPLANS, SLIP_STUCK_WINDOW_MS, slipStep, slipWalk, sweepX,
  sweepY, type SlipState,
} from "../src/walk";

const W = 80;
const H = 40;
const ACCEL = slipAccel(400);
const DT = 0.05;
const R = PLAYER_RADIUS;

/** A wall-bordered floor of w x h tiles; `edit` may turn more tiles into walls or fences. */
function arena(w = W, h = H, edit?: (tiles: Uint8Array, w: number) => void): GameMap {
  const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
  for (let x = 0; x < w; x++) { tiles[x] = TILE_WALL; tiles[(h - 1) * w + x] = TILE_WALL; }
  for (let y = 0; y < h; y++) { tiles[y * w] = TILE_WALL; tiles[y * w + w - 1] = TILE_WALL; }
  edit?.(tiles, w);
  return mapFromTiles(w, h, tiles);
}

const dist = (a: Vec2, b: Vec2): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

afterEach(() => { vi.restoreAllMocks(); });

describe("the slide's numbers", () => {
  it("accel is PLAYER_SPEED over slipMs", () => {
    expect(ACCEL).toBe((PLAYER_SPEED * 1000) / 400);
    expect(ACCEL).toBe(425);
    expect(slipAccel(0)).toBe(0);
  });

  it("reaches full speed after exactly 8 steps, over 34.0 u", () => {
    const map = arena();
    const p = { x: 100, y: 600 };
    const s = newSlip(p.x, p.y, 0, 0);
    const path = [{ x: 2400, y: 600 }];
    for (let i = 1; i <= 8; i++) {
      slipStep(map, p, s, path, DT, PLAYER_SPEED, ACCEL, R);
      expect(s.vx).toBeCloseTo(21.25 * i, 12);
    }
    expect(s.vx).toBe(PLAYER_SPEED);
    expect(p.x - 100).toBeCloseTo(34, 9);
    expect(p.y).toBe(600);
  });

  it("a stop order at full speed slides 34.0 u in 8 steps and ends at v exactly 0", () => {
    const map = arena();
    const p = { x: 100, y: 600 };
    const s = newSlip(p.x, p.y, PLAYER_SPEED, 0);
    const path: Vec2[] = [];
    for (let i = 0; i < 7; i++) {
      slipStep(map, p, s, path, DT, PLAYER_SPEED, ACCEL, R);
      expect(s.vx).toBeGreaterThan(0);
    }
    slipStep(map, p, s, path, DT, PLAYER_SPEED, ACCEL, R);
    expect(s.vx).toBe(0);
    expect(s.vy).toBe(0);
    expect(p.x - 100).toBeCloseTo(34, 9);
    // At rest with no path it stays put.
    const x = p.x;
    slipStep(map, p, s, path, DT, PLAYER_SPEED, ACCEL, R);
    expect(p.x).toBe(x);
  });

  it("a click 300 u ahead of a fighter at full speed is reached exactly, never overshot", () => {
    const map = arena();
    const p = { x: 100, y: 600 };
    const s = newSlip(p.x, p.y, PLAYER_SPEED, 0);
    const path = [{ x: 400, y: 600 }];
    let maxX = p.x;
    for (let i = 0; i < 100 && path.length > 0; i++) {
      slipStep(map, p, s, path, DT, PLAYER_SPEED, ACCEL, R);
      maxX = Math.max(maxX, p.x);
    }
    expect(path).toHaveLength(0);
    expect(Math.abs(p.x - 400)).toBeLessThan(1e-9);
    expect(maxX).toBeLessThan(400 + 1e-9);
    expect(s.vx).toBe(0);
  });

  it("a click short of the stopping distance is still reached exactly (the walk brakes harder than it could coast)", () => {
    const map = arena();
    const p = { x: 100, y: 600 };
    const s = newSlip(p.x, p.y, PLAYER_SPEED, 0);
    const path = [{ x: 110, y: 600 }]; // 10 u ahead, 34 u needed to stop
    let maxX = p.x;
    for (let i = 0; i < 100 && path.length > 0; i++) {
      slipStep(map, p, s, path, DT, PLAYER_SPEED, ACCEL, R);
      maxX = Math.max(maxX, p.x);
    }
    expect(path).toHaveLength(0);
    expect(Math.abs(p.x - 110)).toBeLessThan(1e-9);
    expect(s.vx).toBe(0);
  });

  it("a reversal slides 34 u past before turning back", () => {
    const map = arena();
    const p = { x: 1000, y: 600 };
    const s = newSlip(p.x, p.y, PLAYER_SPEED, 0);
    const path = [{ x: 200, y: 600 }];
    let far = 0;
    for (let i = 0; i < 80 && s.vx > -PLAYER_SPEED + 1e-6; i++) {
      slipStep(map, p, s, path, DT, PLAYER_SPEED, ACCEL, R);
      far = Math.max(far, p.x - 1000);
    }
    expect(far).toBeCloseTo(34, 6);
  });

  it("a root plants the slide: cap 0 zeroes the velocity and moves nothing", () => {
    const map = arena();
    const p = { x: 100, y: 600 };
    const s = newSlip(p.x, p.y, PLAYER_SPEED, 40);
    const path = [{ x: 900, y: 600 }];
    const r = slipStep(map, p, s, path, DT, 0, ACCEL, R);
    expect([s.vx, s.vy]).toEqual([0, 0]);
    expect([p.x, p.y]).toEqual([100, 600]);
    expect(r).toEqual({ hit: false, reached: 0, moved: 0 });
    expect(path).toHaveLength(1);
    // The walk in hand resumes from rest.
    slipStep(map, p, s, path, DT, PLAYER_SPEED, ACCEL, R);
    expect(s.vx).toBeCloseTo(21.25, 12);
  });

  it("a NaN cap plants the fighter like a root: no NaN ever reaches the position", () => {
    const map = arena();
    for (const cap of [NaN, -1, 0]) {
      const p = { x: 100, y: 600 };
      const s = newSlip(p.x, p.y, PLAYER_SPEED, 40);
      const path = [{ x: 900, y: 600 }];
      const r = slipStep(map, p, s, path, DT, cap, ACCEL, R);
      expect([p.x, p.y, s.vx, s.vy], `cap ${cap}`).toEqual([100, 600, 0, 0]);
      expect(r).toEqual({ hit: false, reached: 0, moved: 0 });
      expect(path).toHaveLength(1);
    }
    // And through the walk, with the grip on too.
    const p = { x: 100, y: 600 };
    const s = newSlip(p.x, p.y, PLAYER_SPEED, 0);
    s.gripUntil = 1e9;
    const path = [{ x: 900, y: 600 }];
    slipWalk(map, p, s, path, 100, NaN, () => ACCEL, 0, R);
    expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(s.vx) && Number.isFinite(s.vy)).toBe(true);
    expect([p.x, p.y, s.vx, s.vy]).toEqual([100, 600, 0, 0]);
  });

  it("scales the top speed by cap (a chill or a buff changes the cap, not the traction)", () => {
    const map = arena();
    const p = { x: 100, y: 600 };
    const s = newSlip(p.x, p.y, 0, 0);
    const path = [{ x: 2400, y: 600 }];
    for (let i = 0; i < 40; i++) slipStep(map, p, s, path, DT, PLAYER_SPEED * 0.7, ACCEL, R);
    expect(s.vx).toBeCloseTo(PLAYER_SPEED * 0.7, 9);
  });
});

describe("waypoints", () => {
  it("a 90 degree corner: the gate consumes the waypoint, the path shortens, and the fighter never orbits", () => {
    const map = arena();
    const p = { x: 500, y: 1000 };
    const s = newSlip(p.x, p.y, PLAYER_SPEED, 0);
    const path = [{ x: 600, y: 1000 }, { x: 600, y: 200 }];
    const goal = path[1]!;
    let consumedAt = -1;
    let crossedAt = -1;
    let maxX = 0;
    let prev = Infinity;
    for (let i = 0; i < 200 && path.length > 0; i++) {
      slipStep(map, p, s, path, DT, PLAYER_SPEED, ACCEL, R);
      maxX = Math.max(maxX, p.x);
      if (crossedAt < 0 && p.x >= 600) crossedAt = i;
      if (consumedAt < 0 && path.length === 1) { consumedAt = i; prev = dist(p, goal); continue; }
      if (consumedAt >= 0 && path.length > 0) {
        // From the step after the waypoint went, the distance to the goal never grows.
        const d = dist(p, goal);
        expect(d, `step ${i}`).toBeLessThanOrEqual(prev + 1e-9);
        prev = d;
      }
    }
    expect(consumedAt).toBeGreaterThanOrEqual(0);
    expect(consumedAt).toBeLessThan(20);
    // The gate fires on the first step that starts past the line through the waypoint.
    expect(consumedAt).toBe(crossedAt + 1);
    expect(path).toHaveLength(0);
    // It swung wide on the outside of the corner (about 1.5 tiles at this traction), and arrived exactly.
    expect(maxX - 600).toBeGreaterThan(20);
    expect(maxX - 600).toBeLessThan(60);
    expect(dist(p, goal)).toBeLessThan(1e-9);
  });

  it("the gate takes a corner the fighter crosses far from the waypoint, which the reach alone would not", () => {
    const map = arena();
    // 20 u short of the waypoint at full speed, heading across the leg: the body swings out and crosses the gate line (x = 600)
    // far above the waypoint, where the reach rule (4 u) says nothing.
    const run = (reachOnly: boolean): { consumedAt: number; dist: number; fromX: number; arrivedAt: number } => {
      const p = { x: 580, y: 1000 };
      const s = newSlip(p.x, p.y, 0, -PLAYER_SPEED);
      const path = [{ x: 600, y: 1000 }, { x: 600, y: 200 }];
      let consumedAt = -1, dist0 = 0, fromX = 0, arrivedAt = -1;
      for (let i = 0; i < 300 && path.length > 0; i++) {
        if (reachOnly && path.length > 1) {
          // The gate never fires: the anchor sits on the fighter's side of the waypoint, so the gate line is behind the fighter.
          const w = path[0]!;
          const d = dist(p, w);
          s.path = path;
          if (d > 0) { s.ax = w.x + ((p.x - w.x) / d) * 100; s.ay = w.y + ((p.y - w.y) / d) * 100; }
        }
        const before = { x: p.x, y: p.y };
        const w0 = path[0]!;
        const len = path.length;
        slipStep(map, p, s, path, DT, PLAYER_SPEED, ACCEL, R);
        if (consumedAt < 0 && path.length < len) { consumedAt = i; dist0 = dist(before, w0); fromX = before.x; }
        if (path.length === 0) arrivedAt = i;
      }
      return { consumedAt, dist: dist0, fromX, arrivedAt };
    };
    const gate = run(false);
    expect(gate.consumedAt).toBeGreaterThanOrEqual(0);
    expect(gate.fromX).toBeGreaterThanOrEqual(600); // past the line through the waypoint across the incoming leg...
    expect(gate.dist).toBeGreaterThan(5 * SLIP_REACH); // ...and far from the waypoint itself
    expect(gate.arrivedAt).toBeGreaterThan(gate.consumedAt);
    const reach = run(true);
    expect(reach.dist).toBeLessThanOrEqual(SLIP_REACH + 1e-9);
    expect(reach.consumedAt).toBeGreaterThan(gate.consumedAt + 10);
    expect(reach.arrivedAt).toBeGreaterThan(gate.arrivedAt);
  });

  it("a waypoint within SLIP_REACH is passed whatever the gate says", () => {
    const map = arena();
    const p = { x: 100, y: 600 };
    const s = newSlip(p.x, p.y, 0, 0);
    // The waypoint is behind the fighter's heading but 3 u away: the reach rule takes it.
    const path = [{ x: 100 + SLIP_REACH - 1, y: 600 }, { x: 900, y: 600 }];
    const r = slipStep(map, p, s, path, DT, PLAYER_SPEED, ACCEL, R);
    expect(r.reached).toBe(1);
    expect(path).toHaveLength(1);
  });

  it("a new path array re-anchors the gate at the fighter, not at the old path's anchor", () => {
    const map = arena();
    const p = { x: 500, y: 600 };
    const s = newSlip(100, 600, 0, 0);
    s.path = [{ x: 1, y: 1 }];
    const path = [{ x: 300, y: 600 }, { x: 900, y: 600 }];
    slipStep(map, p, s, path, DT, PLAYER_SPEED, ACCEL, R);
    expect(s.path).toBe(path);
    expect(s.ax).toBe(500);
    // Anchored at (100, 600), the waypoint at 300 would count as passed; anchored at the fighter it is behind it.
    expect(path).toHaveLength(2);
  });
});

describe("determinism and step size", () => {
  function trajectory(substeps: number, seed: number): Vec2[] {
    const map = arena(60, 30);
    const rnd = mulberry32(seed);
    const p = { x: 10 * TILE + 16, y: 10 * TILE + 16 };
    let path: Vec2[] = [];
    const s = newSlip(p.x, p.y, 0, 0);
    const out: Vec2[] = [];
    let next = 0;
    for (let t = 0; t < 60000; t += 50) {
      if (t >= next) {
        if (rnd() < 0.15) path = [];
        else path = findPath(map, p, { x: (2 + rnd() * 56) * TILE, y: (2 + rnd() * 26) * TILE }, R);
        next += 200 + Math.floor(rnd() * 15) * 50;
      }
      for (let i = 0; i < substeps; i++) slipStep(map, p, s, path, DT / substeps, PLAYER_SPEED, ACCEL, R);
      out.push({ x: p.x, y: p.y });
    }
    return out;
  }

  it("the same 60 s script stepped at 1 and at 3 substeps per 50 ms stays within 2 u", () => {
    for (const seed of [1, 2, 3]) {
      const a = trajectory(1, seed);
      const b = trajectory(3, seed);
      let worst = 0;
      for (let i = 0; i < a.length; i++) worst = Math.max(worst, dist(a[i]!, b[i]!));
      expect(worst, `seed ${seed}`).toBeLessThan(2);
    }
  });

  it("two runs give Object.is-equal x and y on every tick", () => {
    const a = trajectory(1, 7);
    const b = trajectory(1, 7);
    expect(a).toHaveLength(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(Object.is(a[i]!.x, b[i]!.x)).toBe(true);
      expect(Object.is(a[i]!.y, b[i]!.y)).toBe(true);
    }
  });

  it("uses no transcendental Math function: + - * / and sqrt only", () => {
    const spies = (["hypot", "sin", "cos", "tan", "atan", "atan2", "exp", "log", "pow", "cbrt", "sinh", "cosh", "tanh"] as const).map((k) => vi.spyOn(Math, k));
    const map = arena();
    const p = { x: 100, y: 600 };
    const s = newSlip(p.x, p.y, 0, 0);
    const path = [{ x: 600, y: 700 }, { x: 900, y: 300 }];
    for (let i = 0; i < 100; i++) slipStep(map, p, s, path, DT, PLAYER_SPEED, ACCEL, R);
    slipWalk(map, p, s, [{ x: 100, y: 100 }], 120, PLAYER_SPEED, () => ACCEL, 0, R);
    sweepX(map, 100, 100, 50, R);
    sweepY(map, 100, 100, -50, R);
    for (const sp of spies) expect(sp).not.toHaveBeenCalled();
  });
});

describe("collision: exact swept faces and corners", () => {
  it("a one-tile corridor at 2x speed, steered into its walls for 2000 steps, never overlaps and stays in its row", () => {
    const rows = 20;
    const map = arena(W, H, (tiles, w) => {
      tiles.fill(TILE_WALL);
      for (let x = 1; x < w - 1; x++) tiles[rows * w + x] = TILE_FLOOR;
    });
    const p = { x: 2 * TILE + 16, y: rows * TILE + 16 };
    const s = newSlip(p.x, p.y, 0, 0);
    let bad = 0;
    for (let i = 0; i < 2000; i++) {
      const path = [{ x: p.x + (i % 2 ? 300 : -100), y: p.y + ((i % 3) - 1) * 400 }];
      slipStep(map, p, s, path, DT, PLAYER_SPEED * 2, ACCEL, R);
      if (!circleClear(map, p, R - 1e-6)) bad++;
      if (Math.floor(p.y / TILE) !== rows) bad++;
    }
    expect(bad).toBe(0);
  });

  it("a 1 s step at 340 u/s into a one-tile wall stops at face - r exactly, with vx === 0", () => {
    const map = arena(W, H, (tiles, w) => { for (let y = 0; y < H; y++) tiles[y * w + 30] = TILE_WALL; });
    const p = { x: 20 * TILE, y: 10 * TILE + 16 };
    const s = newSlip(p.x, p.y, 340, 0);
    const r = slipStep(map, p, s, [{ x: 40 * TILE, y: 10 * TILE + 16 }], 1, 340, ACCEL, R);
    expect(p.x).toBe(30 * TILE - R);
    expect(s.vx).toBe(0);
    expect(r.hit).toBe(true);
  });

  it("corner contact equals face - sqrt(r^2 - gap^2)", () => {
    // One solid tile at (10, 5): x in [320, 352), y in [160, 192). A disc passing 5 u above its top edge touches the corner.
    const map = arena(W, H, (tiles, w) => { tiles[5 * w + 10] = TILE_WALL; });
    const gap = 5;
    const x = sweepX(map, 100, 160 - gap, 500, R);
    expect(x).toBeCloseTo(10 * TILE - Math.sqrt(R * R - gap * gap), 12);
    // From the other side, and on y.
    expect(sweepX(map, 600, 160 - gap, -500, R)).toBeCloseTo(11 * TILE + Math.sqrt(R * R - gap * gap), 12);
    expect(sweepY(map, 10 * TILE - gap, 100, 500, R)).toBeCloseTo(5 * TILE - Math.sqrt(R * R - gap * gap), 12);
    expect(sweepY(map, 10 * TILE - gap, 400, -500, R)).toBeCloseTo(6 * TILE + Math.sqrt(R * R - gap * gap), 12);
    // A gap of r or more does not touch it.
    expect(sweepX(map, 100, 160 - R, 500, R)).toBe(600);
    // A free sweep returns the full move.
    expect(sweepX(map, 100, 600, 50, R)).toBe(150);
    expect(sweepY(map, 100, 600, 0, R)).toBe(600);
  });

  it("no tunnelling at any step length: a 1 s sweep through a field of one-tile walls stops at the first", () => {
    const map = arena(W, H, (tiles, w) => { for (const x of [15, 25, 35]) tiles[10 * w + x] = TILE_WALL; });
    const x = sweepX(map, 4 * TILE + 16, 10 * TILE + 16, 5000, R);
    expect(x).toBe(15 * TILE - R);
  });

  it("out of bounds is solid", () => {
    const map = arena();
    expect(sweepX(map, 2 * TILE, 600, -5000, R)).toBe(1 * TILE + R);
    expect(sweepY(map, 600, 2 * TILE, -5000, R)).toBe(1 * TILE + R);
  });

  it("a LOW fence tile blocks the slide like a wall", () => {
    const map = arena(W, H, (tiles, w) => { for (let y = 1; y < H - 1; y++) tiles[y * w + 30] = TILE_LOW; });
    const p = { x: 20 * TILE, y: 10 * TILE + 16 };
    const s = newSlip(p.x, p.y, 340, 0);
    slipStep(map, p, s, [{ x: 40 * TILE, y: 10 * TILE + 16 }], 1, 340, ACCEL, R);
    expect(p.x).toBe(30 * TILE - R);
    expect(circleClear(map, p, R - 1e-6)).toBe(true);
  });

  it("slides along a wall: the blocked axis loses its velocity, the other keeps going", () => {
    const map = arena();
    const p = { x: 10 * TILE, y: 1 * TILE + R + 1 };
    const s = newSlip(p.x, p.y, 100, -100);
    slipStep(map, p, s, [{ x: 70 * TILE, y: 0 }], DT, PLAYER_SPEED, ACCEL, R);
    expect(p.y).toBe(1 * TILE + R); // stopped at the border wall's face
    expect(s.vy).toBe(0);
    expect(s.vx).toBeGreaterThan(0);
    expect(p.x).toBeGreaterThan(10 * TILE);
  });

  it("a slide toward a locked gate stops at its face; the open map lets it through", () => {
    const open = arena();
    const gate = { side: "w" as const, tiles: Array.from({ length: H - 2 }, (_, i) => ({ x: 40, y: 1 + i })), x: 40 * TILE + 16, y: 20 * TILE };
    const map: GameMap = { ...open, coliseum: { ...open.coliseum, gates: [gate] } };
    const locked = withGates(map);
    const run = (m: GameMap): number => {
      const p = { x: 30 * TILE, y: 10 * TILE + 16 };
      const s = newSlip(p.x, p.y, 0, 0);
      const path = [{ x: 60 * TILE, y: 10 * TILE + 16 }];
      for (let i = 0; i < 200; i++) slipStep(m, p, s, path, DT, PLAYER_SPEED, ACCEL, R);
      return p.x;
    };
    expect(run(locked)).toBe(40 * TILE - R);
    expect(run(map)).toBeGreaterThan(41 * TILE);
  });
});

describe("slipWalk", () => {
  it("sub-steps by at most one tick: 100 ms is two 50 ms steps", () => {
    const map = arena();
    const a = { x: 100, y: 600 };
    const b = { x: 100, y: 600 };
    const sa: SlipState = newSlip(a.x, a.y, 0, 0);
    const sb: SlipState = newSlip(b.x, b.y, 0, 0);
    const pa = [{ x: 2000, y: 700 }];
    const pb = [{ x: 2000, y: 700 }];
    const r = slipWalk(map, a, sa, pa, 100, PLAYER_SPEED, () => ACCEL, 0, R);
    slipStep(map, b, sb, pb, 0.05, PLAYER_SPEED, ACCEL, R);
    slipStep(map, b, sb, pb, 0.05, PLAYER_SPEED, ACCEL, R);
    expect(Object.is(a.x, b.x)).toBe(true);
    expect(Object.is(a.y, b.y)).toBe(true);
    expect(r.moved).toBeCloseTo(dist({ x: 100, y: 600 }, a), 9);
  });

  it("asks for traction under the centre and stops once the centre leaves slippery ground", () => {
    const map = arena();
    const p = { x: 100, y: 600 };
    const s = newSlip(p.x, p.y, PLAYER_SPEED, 0);
    const path = [{ x: 2000, y: 600 }];
    const seen: number[] = [];
    // Ice for x < 110 only.
    const slipAt = (x: number): number => { seen.push(x); return x < 110 ? ACCEL : 0; };
    slipWalk(map, p, s, path, 500, PLAYER_SPEED, slipAt, 0, R);
    // 8.5 u per substep at 170 u/s: it leaves the ice after two substeps, and no more are taken.
    expect(seen.length).toBeLessThanOrEqual(4);
    expect(p.x).toBeGreaterThanOrEqual(110);
    expect(p.x).toBeLessThan(140);
  });

  it("does nothing off ice or for a zero dt", () => {
    const map = arena();
    const p = { x: 100, y: 600 };
    const s = newSlip(p.x, p.y, 0, 0);
    const path = [{ x: 500, y: 600 }];
    expect(slipWalk(map, p, s, path, 50, PLAYER_SPEED, () => 0, 0, R)).toEqual({ hit: false, reached: 0, moved: 0 });
    expect(slipWalk(map, p, s, path, 0, PLAYER_SPEED, () => ACCEL, 0, R)).toEqual({ hit: false, reached: 0, moved: 0 });
    expect(p).toEqual({ x: 100, y: 600 });
  });

  it("a slide stuck on a wall plans again to the last waypoint, at most once per SLIP_REPLAN_MS", () => {
    // A wall across the way with one gap far above: the straight leg is blocked.
    const map = arena(W, H, (tiles, w) => { for (let y = 3; y < H - 1; y++) tiles[y * w + 30] = TILE_WALL; });
    const p = { x: 28 * TILE, y: 20 * TILE };
    const s = newSlip(p.x, p.y, PLAYER_SPEED, 0);
    const goal = { x: 40 * TILE, y: 20 * TILE };
    const path = [goal];
    let now = 1000;
    let replanned = -1;
    for (let i = 0; i < 40 && replanned < 0; i++) {
      slipWalk(map, p, s, path, TICK_MS, PLAYER_SPEED, () => ACCEL, now, R);
      if (s.replanAt > 0) replanned = i;
      now += TICK_MS;
    }
    expect(replanned).toBeGreaterThanOrEqual(0);
    expect(s.replanAt).toBeLessThanOrEqual(now + SLIP_REPLAN_MS);
    // The new route leads round the wall: more than one waypoint, ending at the goal.
    expect(path.length).toBeGreaterThan(1);
    expect(path[path.length - 1]).toEqual(goal);
    expect(s.path).toBe(path); // identity kept, so the slide is not re-anchored from scratch
    const at = s.replanAt;
    // Pushed into the wall again right away: the throttle holds.
    s.vx = PLAYER_SPEED;
    p.x = 30 * TILE - R;
    path.splice(0, path.length, { x: 40 * TILE, y: p.y });
    slipWalk(map, p, s, path, TICK_MS, PLAYER_SPEED, () => ACCEL, now, R);
    expect(s.replanAt).toBe(at);
    expect(path).toHaveLength(1);
  });
});

describe("the livelock breaker", () => {
  const TS = TILE;
  const tc = (t: number): number => t * TS + TS / 2;

  /** A one-tile corridor on row 5 with a one-tile corridor down column 10: the review's T-junction, all of it ice. */
  function tJunction(): GameMap {
    const w = 24, h = 16;
    const tiles = new Uint8Array(w * h).fill(TILE_WALL);
    for (let x = 1; x < w - 1; x++) tiles[5 * w + x] = TILE_FLOOR;
    for (let y = 5; y < 13; y++) tiles[y * w + 10] = TILE_FLOOR;
    return mapFromTiles(w, h, tiles);
  }

  it("a T-junction of one-tile corridors, all ice: the fighter arrives within 8 s and never touches a wall", () => {
    const map = tJunction();
    const p = { x: tc(3), y: tc(5) };
    const goal = { x: tc(10), y: tc(12) };
    const path = findPath(map, p, goal, R);
    expect(path).toEqual([{ x: tc(10), y: tc(5) }, goal]);
    const s = newSlip(p.x, p.y, 0, 0);
    let now = 0;
    let replans = 0;
    let replanAt = s.replanAt;
    let gripAt = -1;
    let arrivedAt = -1;
    for (let tick = 0; tick < 400 && arrivedAt < 0; tick++) {
      now += TICK_MS;
      slipWalk(map, p, s, path, TICK_MS, PLAYER_SPEED, () => ACCEL, now, R);
      if (s.replanAt !== replanAt) { replans++; replanAt = s.replanAt; }
      if (gripAt < 0 && s.gripUntil !== undefined) gripAt = tick;
      expect(circleClear(map, p, R - 1e-6), `tick ${tick} at ${p.x}, ${p.y}`).toBe(true);
      if (path.length === 0) arrivedAt = tick;
    }
    expect(arrivedAt, "arrived").toBeGreaterThanOrEqual(0);
    expect(arrivedAt * TICK_MS).toBeLessThan(8000);
    expect(dist(p, goal)).toBeLessThan(1e-9);
    // The breaker is what did it: exactly the third stuck re-plan started the grip.
    expect(gripAt).toBeGreaterThanOrEqual(0);
    expect(replans).toBe(SLIP_STUCK_REPLANS);
    expect(s.gripUntil).toBeLessThanOrEqual(now + SLIP_GRIP_MS);
  });

  it("random one-tile corridor mazes, ice everywhere: every walk from rest arrives", () => {
    let trials = 0;
    for (let m = 0; m < 6; m++) {
      const rnd = mulberry32(900 + m);
      const w = 30 + Math.floor(rnd() * 30), h = 20 + Math.floor(rnd() * 15);
      const tiles = new Uint8Array(w * h).fill(TILE_WALL);
      for (let y = 2; y < h - 2; y += 3) for (let x = 1; x < w - 1; x++) tiles[y * w + x] = TILE_FLOOR;
      for (let x = 2; x < w - 2; x += 5) for (let y = 2; y < h - 2; y++) tiles[y * w + x] = TILE_FLOOR;
      const map = mapFromTiles(w, h, tiles);
      const floor = (): Vec2 => {
        for (;;) {
          const q = { x: (1 + rnd() * (w - 2)) * TILE, y: (1 + rnd() * (h - 2)) * TILE };
          if (circleClear(map, q, R)) return q;
        }
      };
      for (let k = 0; k < 4; k++) {
        const p = floor();
        const path = findPath(map, p, floor(), R);
        if (path.length === 0) continue;
        trials++;
        const s = newSlip(p.x, p.y, 0, 0);
        let now = 0;
        for (let tick = 0; tick < 20 * 90 && path.length > 0; tick++) {
          now += TICK_MS;
          slipWalk(map, p, s, path, TICK_MS, PLAYER_SPEED, () => ACCEL, now, R);
        }
        expect(path.length, `maze ${m} trial ${k}`).toBe(0);
      }
    }
    expect(trials).toBeGreaterThan(15);
  });

  describe("counting stuck re-plans", () => {
    /** A body at a wall face, moving into it, its walk blocked: one slipWalk call makes the stuck re-plan. */
    function stuckAt(now: number, pre: Partial<SlipState>): { s: SlipState; path: Vec2[]; goal: Vec2; d: number } {
      const map = arena(W, H, (tiles, w) => { for (let y = 3; y < H - 1; y++) tiles[y * w + 30] = TILE_WALL; });
      const p = { x: 30 * TILE - R - 1, y: 20 * TILE };
      const s: SlipState = { ...newSlip(p.x, p.y, PLAYER_SPEED, 0), ...pre };
      const goal = { x: 40 * TILE, y: 20 * TILE };
      const path = [goal];
      slipWalk(map, p, s, path, TICK_MS, PLAYER_SPEED, () => ACCEL, now, R);
      expect(s.replanAt, "the re-plan fired").toBe(now + SLIP_REPLAN_MS);
      return { s, path, goal, d: dist({ x: 30 * TILE - R, y: 20 * TILE }, goal) };
    }
    const NOW = 5000;

    it("the first re-plan only starts the count", () => {
      const { s, goal } = stuckAt(NOW, {});
      expect([s.stuckX, s.stuckY, s.stuckN, s.stuckAt]).toEqual([goal.x, goal.y, 1, NOW]);
      expect(s.stuckBest).toBeGreaterThan(0);
      expect(s.gripUntil).toBeUndefined();
    });

    it("the third in a row, within the window and with no progress, grips for SLIP_GRIP_MS and starts the count over", () => {
      const goal = { x: 40 * TILE, y: 20 * TILE };
      const two = stuckAt(NOW, { stuckX: goal.x, stuckY: goal.y, stuckN: SLIP_STUCK_REPLANS - 1, stuckBest: 330, stuckAt: NOW - 900 });
      expect(two.s.gripUntil).toBe(NOW + SLIP_GRIP_MS);
      expect(two.s.stuckN).toBe(0);
      const one = stuckAt(NOW, { stuckX: goal.x, stuckY: goal.y, stuckN: SLIP_STUCK_REPLANS - 2, stuckBest: 330, stuckAt: NOW - 900 });
      expect(one.s.gripUntil).toBeUndefined();
      expect(one.s.stuckN).toBe(SLIP_STUCK_REPLANS - 1);
    });

    it("progress toward the goal, a long pause, or another goal starts the count over", () => {
      const goal = { x: 40 * TILE, y: 20 * TILE };
      const base = { stuckX: goal.x, stuckY: goal.y, stuckN: SLIP_STUCK_REPLANS - 1, stuckBest: 330, stuckAt: NOW - 900 };
      // The body is a tile or more closer than the best so far: that is progress.
      const progress = stuckAt(NOW, { ...base, stuckBest: 330 + TILE + 10 });
      expect([progress.s.gripUntil, progress.s.stuckN]).toEqual([undefined, 1]);
      expect(progress.s.stuckBest).toBeCloseTo(progress.d, 6);
      // Within a tile of the best is not.
      const near = stuckAt(NOW, { ...base, stuckBest: progress.d + TILE - 1 });
      expect(near.s.gripUntil).toBe(NOW + SLIP_GRIP_MS);
      const late = stuckAt(NOW, { ...base, stuckAt: NOW - SLIP_STUCK_WINDOW_MS - 1 });
      expect([late.s.gripUntil, late.s.stuckN]).toEqual([undefined, 1]);
      const onTime = stuckAt(NOW, { ...base, stuckAt: NOW - SLIP_STUCK_WINDOW_MS });
      expect(onTime.s.gripUntil).toBe(NOW + SLIP_GRIP_MS);
      const other = stuckAt(NOW, { ...base, stuckX: goal.x + 1 });
      expect([other.s.gripUntil, other.s.stuckN, other.s.stuckX]).toEqual([undefined, 1, goal.x]);
    });

    it("the SLIP_REPLAN_MS throttle still bounds the count: one re-plan per interval", () => {
      const map = arena(W, H, (tiles, w) => { for (let y = 3; y < H - 1; y++) tiles[y * w + 30] = TILE_WALL; });
      const p = { x: 30 * TILE - R - 1, y: 20 * TILE };
      const s = newSlip(p.x, p.y, PLAYER_SPEED, 0);
      const path = [{ x: 40 * TILE, y: 20 * TILE }];
      for (let i = 0; i < 4; i++) {
        s.vx = PLAYER_SPEED;
        p.x = 30 * TILE - R - 1;
        path.splice(0, path.length, { x: 40 * TILE, y: 20 * TILE });
        slipWalk(map, p, s, path, TICK_MS, PLAYER_SPEED, () => ACCEL, 1000 + i * 50, R);
      }
      expect(s.stuckN).toBe(1); // four hits inside one 250 ms interval: one re-plan
    });
  });

  describe("the grip", () => {
    it("walks the path exactly at cap, keeps the walk's velocity, and takes the waypoints it passes", () => {
      const map = arena();
      const p = { x: 100, y: 600 };
      const s = newSlip(p.x, p.y, 0, 0);
      s.gripUntil = 10_000;
      const path = [{ x: 200, y: 600 }, { x: 200, y: 900 }];
      const step = PLAYER_SPEED * DT;
      for (let i = 1; i <= 4; i++) {
        const r = slipWalk(map, p, s, path, TICK_MS, PLAYER_SPEED, () => ACCEL, 1000, R);
        expect(p.x).toBeCloseTo(100 + i * step, 9); // no acceleration ramp
        expect(r.moved).toBeCloseTo(step, 9);
        expect(s.vx).toBeCloseTo(PLAYER_SPEED, 9);
      }
      // A tick that passes the corner turns it exactly, at the same speed.
      let reached = 0;
      for (let i = 0; i < 10; i++) reached += slipWalk(map, p, s, path, TICK_MS, PLAYER_SPEED, () => ACCEL, 1000, R).reached;
      expect(reached).toBe(1);
      expect(p.x).toBe(200);
      expect(p.y).toBeGreaterThan(600);
      expect(s.vy).toBeCloseTo(PLAYER_SPEED, 9);
      expect(path).toHaveLength(1);
      // It reaches the end of the path exactly, with no braking distance, and stops.
      for (let i = 0; i < 40; i++) slipWalk(map, p, s, path, TICK_MS, PLAYER_SPEED, () => ACCEL, 1000, R);
      expect(path).toHaveLength(0);
      expect([p.x, p.y]).toEqual([200, 900]);
      expect([s.vx, s.vy]).toEqual([0, 0]);
    });

    it("honours the cap, plants on a root, and is off the moment the centre leaves slippery ground", () => {
      const map = arena();
      const p = { x: 100, y: 600 };
      const s = newSlip(p.x, p.y, 0, 0);
      s.gripUntil = 10_000;
      const path = [{ x: 900, y: 600 }];
      slipWalk(map, p, s, path, TICK_MS, PLAYER_SPEED * 0.5, () => ACCEL, 0, R);
      expect(p.x).toBeCloseTo(100 + PLAYER_SPEED * 0.5 * DT, 9);
      const x = p.x;
      slipWalk(map, p, s, path, TICK_MS, 0, () => ACCEL, 0, R);
      expect([p.x, s.vx]).toEqual([x, 0]);
      slipWalk(map, p, s, path, TICK_MS, PLAYER_SPEED, () => 0, 0, R);
      expect(p.x).toBe(x);
    });

    it("a path it was not anchored on is checked like regrip checks it: a blocked first leg is planned again", () => {
      const map = arena(W, H, (tiles, w) => { for (let y = 3; y < H - 1; y++) tiles[y * w + 30] = TILE_WALL; });
      const p = { x: 28 * TILE, y: 20 * TILE };
      const s = newSlip(p.x, p.y, 0, 0);
      s.gripUntil = 10_000;
      const goal = { x: 40 * TILE, y: 20 * TILE };
      const path = [goal]; // straight through the wall
      slipWalk(map, p, s, path, TICK_MS, PLAYER_SPEED, () => ACCEL, 0, R);
      expect(path.length).toBeGreaterThan(1);
      expect(path[path.length - 1]).toEqual(goal);
      for (let i = 0; i < 400 && path.length > 0; i++) {
        slipWalk(map, p, s, path, TICK_MS, PLAYER_SPEED, () => ACCEL, 0, R);
        expect(circleClear(map, p, R - 1e-6), `tick ${i}`).toBe(true);
      }
      expect(path).toHaveLength(0);
    });

    it("ends at gripUntil: the slide takes over from the walk's velocity, with no speed pop", () => {
      const map = arena();
      const p = { x: 100, y: 600 };
      const s = newSlip(p.x, p.y, 0, 0);
      s.gripUntil = 400;
      const path = [{ x: 2400, y: 600 }];
      let now = 0;
      const xs: number[] = [p.x];
      for (let i = 0; i < 12; i++) {
        now += TICK_MS;
        slipWalk(map, p, s, path, TICK_MS, PLAYER_SPEED, () => ACCEL, now, R);
        xs.push(p.x);
      }
      const steps = xs.slice(1).map((x, i) => x - xs[i]!);
      // Ticks 1..7 (now 50..350) are gripped and exact; the slide takes over at now = 400 from the walk's vx = PLAYER_SPEED. A slide
      // that started from rest would cover 4.25 u in its first tick.
      for (let i = 0; i < 12; i++) expect(steps[i], `tick ${i + 1}`).toBeCloseTo(PLAYER_SPEED * DT, 9);
      expect(s.vx).toBeCloseTo(PLAYER_SPEED, 9);
    });

    it("a clock that ran back never holds the grip longer than SLIP_GRIP_MS", () => {
      const map = arena();
      const p = { x: 100, y: 600 };
      const s = newSlip(p.x, p.y, 0, 0);
      s.gripUntil = 1e9;
      slipWalk(map, p, s, [{ x: 900, y: 600 }], TICK_MS, PLAYER_SPEED, () => ACCEL, 2000, R);
      expect(s.gripUntil).toBe(2000 + SLIP_GRIP_MS);
    });
  });

  it("a slide that never gets stuck never grows the breaker's fields: the state is what it always was", () => {
    const map = arena(60, 30);
    const rnd = mulberry32(5);
    const p = { x: 10 * TILE + 16, y: 10 * TILE + 16 };
    const s = newSlip(p.x, p.y, 0, 0);
    let path: Vec2[] = [];
    let now = 0;
    for (let t = 0; t < 60000; t += 50) {
      if (t % 250 === 0) path = findPath(map, p, { x: (2 + rnd() * 56) * TILE, y: (2 + rnd() * 26) * TILE }, R);
      now += 50;
      slipWalk(map, p, s, path, 50, PLAYER_SPEED, () => ACCEL, now, R);
    }
    expect(Object.keys(s).sort()).toEqual(["ax", "ay", "path", "replanAt", "vx", "vy"]);
  });
});

describe("regrip", () => {
  it("keeps a walk whose next leg is clear from here", () => {
    const map = arena();
    const path = [{ x: 500, y: 600 }, { x: 900, y: 600 }];
    expect(regrip(map, { x: 400, y: 640 }, path)).toBe(path);
  });

  it("plans again to the last waypoint when the next leg is blocked", () => {
    const map = arena(W, H, (tiles, w) => { for (let y = 3; y < H - 1; y++) tiles[y * w + 30] = TILE_WALL; });
    const path = [{ x: 31 * TILE + 16, y: 20 * TILE }, { x: 40 * TILE, y: 20 * TILE }];
    const from = { x: 28 * TILE, y: 20 * TILE };
    const out = regrip(map, from, path);
    expect(out).not.toBe(path);
    expect(out.length).toBeGreaterThan(0);
    expect(out[out.length - 1]).toEqual({ x: 40 * TILE, y: 20 * TILE });
    for (let i = 0; i < out.length; i++) {
      const a = i === 0 ? from : out[i - 1]!;
      expect(circleClear(map, out[i]!, R)).toBe(true);
      expect(dist(a, out[i]!)).toBeGreaterThan(0);
    }
  });

  it("an empty path stays empty; an unreachable goal gives an empty path", () => {
    const map = arena(W, H, (tiles, w) => { for (let y = 1; y < H - 1; y++) tiles[y * w + 30] = TILE_WALL; });
    expect(regrip(map, { x: 100, y: 100 }, [])).toEqual([]);
    expect(regrip(map, { x: 28 * TILE, y: 20 * TILE }, [{ x: 40 * TILE, y: 20 * TILE }])).toEqual([]);
  });
});

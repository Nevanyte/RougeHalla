// services.ts (docs/BOTS.md 1, change 6): the budgeted, cached PathService every bot of a room shares.
import { describe, expect, it } from "vitest";
import { findPath, mapFromTiles, TILE, TILE_FLOOR, TILE_WALL, tileToWorldCenter, type GameMap, type Vec2 } from "@raid/shared";
import { pathLength } from "../../src/bots/mobHunt";
import {
  createPathBudget, createPathService, PATH_CACHE_MS, PATH_STALE_MS, STRAIGHT_FACTOR,
} from "../../src/bots/brain/services";
import { BOT_PATH_BUDGET_PER_TICK } from "../../src/bots/brain/types";
import { floorPoint, testMap } from "./fixtures";

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Two real floor points of the test map that are far apart and reachable (so the path is a real search). */
function trip(): { from: Vec2; to: Vec2 } {
  const map = testMap();
  const from = floorPoint(0);
  let best: Vec2 = floorPoint(1);
  for (let i = 1; i < map.spawns.length; i++) {
    const q = floorPoint(i);
    if (findPath(map, from, q).length > 0 && dist(from, q) > dist(from, best)) best = q;
  }
  return { from, to: best };
}

/** A 12 x 5 room cut in two by a wall at x = 6, with a one-tile gate at (6, 2). */
function gateRoom(): { map: GameMap; left: Vec2; right: Vec2 } {
  const w = 12;
  const h = 5;
  const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
  for (let x = 0; x < w; x++) { tiles[x] = TILE_WALL; tiles[(h - 1) * w + x] = TILE_WALL; }
  for (let y = 0; y < h; y++) { tiles[y * w] = TILE_WALL; tiles[y * w + w - 1] = TILE_WALL; tiles[y * w + 6] = TILE_WALL; }
  tiles[2 * w + 6] = TILE_FLOOR;
  const map = mapFromTiles(w, h, tiles);
  map.coliseum.gates.push({ side: "n", tiles: [{ x: 6, y: 2 }], x: tileToWorldCenter(6), y: tileToWorldCenter(2) });
  return { map, left: { x: tileToWorldCenter(2), y: tileToWorldCenter(2) }, right: { x: tileToWorldCenter(9), y: tileToWorldCenter(2) } };
}

describe("createPathBudget", () => {
  it("allows its allowance each tick and refills on startTick", () => {
    const b = createPathBudget(3);
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false]);
    expect(b.left).toBe(0);
    b.startTick();
    expect(b.left).toBe(3);
    expect(b.take()).toBe(true);
  });

  it("defaults to the room-wide allowance", () => {
    const b = createPathBudget();
    expect(b.left).toBe(BOT_PATH_BUDGET_PER_TICK);
  });
});

describe("walk and path", () => {
  it("answers with the real path length and the shared findPath's waypoints", () => {
    const { from, to } = trip();
    const svc = createPathService(testMap(), createPathBudget());
    const real = findPath(testMap(), from, to);
    expect(svc.walk(from, to)).toEqual({ dist: pathLength(from, real), exact: true });
    expect(svc.path(from, to)).toEqual(real);
  });

  it("answers null for a trip with no path, and for a non-finite point, without spending budget on the latter", () => {
    const { map, left, right } = gateRoom();
    const budget = createPathBudget(5);
    const svc = createPathService(map, budget);
    svc.setFrame(0, true);
    expect(svc.walk(left, right)).toBeNull();
    expect(svc.path(left, right)).toBeNull();
    const spent = budget.left;
    expect(svc.walk({ x: Number.NaN, y: 0 }, right)).toBeNull();
    expect(svc.path(left, { x: 0, y: Number.POSITIVE_INFINITY })).toBeNull();
    expect(budget.left).toBe(spent);
  });

  it("caches a trip for a second: a repeat costs nothing, one second on it searches again", () => {
    const { from, to } = trip();
    const budget = createPathBudget(10);
    const svc = createPathService(testMap(), budget);
    svc.setFrame(1000, false);
    svc.walk(from, to);
    expect(budget.left).toBe(9);
    svc.setFrame(1000 + PATH_CACHE_MS - 1, false);
    svc.walk(from, to);
    svc.path(from, to);
    expect(budget.left).toBe(9);
    expect(svc.stats.hits).toBe(2);
    svc.setFrame(1000 + PATH_CACHE_MS, false);
    svc.walk(from, to);
    expect(budget.left).toBe(8);
    expect(svc.stats.searches).toBe(2);
  });

  it("shares a cache entry between points that round to the same 8 u cell", () => {
    const { from, to } = trip();
    const budget = createPathBudget(10);
    const svc = createPathService(testMap(), budget);
    svc.walk(from, to);
    svc.walk({ x: from.x + 2, y: from.y - 2 }, { x: to.x - 1, y: to.y + 2 });
    expect(budget.left).toBe(9);
    svc.walk({ x: from.x + 40, y: from.y }, to);
    expect(budget.left).toBe(8);
  });
});

describe("over budget", () => {
  it("guesses the straight line x 1.3 with exact false, and walks exactly again next tick", () => {
    const { from, to } = trip();
    const budget = createPathBudget(1);
    const svc = createPathService(testMap(), budget);
    const other = { x: to.x + 64, y: to.y };
    expect(svc.walk(from, to)?.exact).toBe(true);
    const guess = svc.walk(from, other);
    expect(guess).toEqual({ dist: dist(from, other) * STRAIGHT_FACTOR, exact: false });
    expect(svc.stats.fallbacks).toBe(1);
    budget.startTick();
    expect(svc.walk(from, other)?.exact).toBe(true);
  });

  it("answers path() with null, so callers fall back to the straight line", () => {
    const { from, to } = trip();
    const budget = createPathBudget(0);
    const svc = createPathService(testMap(), budget);
    expect(svc.path(from, to)).toBeNull();
    budget.startTick();
    expect(budget.take()).toBe(false);
  });

  it("reuses a worked-out trip that is stale but recent, in place of a guess; an old one is a guess again", () => {
    const { from, to } = trip();
    const budget = createPathBudget(1);
    const svc = createPathService(testMap(), budget);
    svc.setFrame(0, false);
    const exact = svc.walk(from, to);
    svc.setFrame(PATH_CACHE_MS * 3, false);
    expect(svc.walk(from, to)).toEqual(exact);
    expect(svc.path(from, to)).not.toBeNull();
    svc.setFrame(PATH_STALE_MS + 1, false);
    expect(svc.walk(from, to)?.exact).toBe(false);
  });

  it("drops trips nobody asked about for a long time", () => {
    const { from, to } = trip();
    const budget = createPathBudget(10);
    const svc = createPathService(testMap(), budget);
    svc.setFrame(0, false);
    svc.walk(from, to);
    svc.setFrame(60_000, false);
    svc.walk(from, to);
    expect(budget.left).toBe(8);
  });
});

describe("gates", () => {
  it("plans, sees and clears through the open gate, and not through it once the HUD says it is locked", () => {
    const { map, left, right } = gateRoom();
    const svc = createPathService(map, createPathBudget(20));
    svc.setFrame(0, false);
    expect(svc.collisionMap()).toBe(map);
    expect(svc.walk(left, right)?.exact).toBe(true);
    expect(svc.los(left, right)).toBe(true);
    expect(svc.clear(left, right)).toBe(true);

    svc.setFrame(10, true);
    const locked = svc.collisionMap();
    expect(locked).not.toBe(map);
    expect(svc.collisionMap()).toBe(locked);
    expect(locked.tiles[2 * map.w + 6]).toBe(TILE_WALL);
    expect(svc.walk(left, right)).toBeNull();
    expect(svc.path(left, right)).toBeNull();
    expect(svc.los(left, right)).toBe(false);
    expect(svc.clear(left, right)).toBe(false);

    svc.setFrame(20, false);
    expect(svc.collisionMap()).toBe(map);
    expect(svc.los(left, right)).toBe(true);
  });

  it("does not answer a locked-gate query from a cached open-gate answer", () => {
    const { map, left, right } = gateRoom();
    const svc = createPathService(map, createPathBudget(20));
    svc.setFrame(0, false);
    expect(svc.walk(left, right)).not.toBeNull();
    svc.setFrame(1, true);
    expect(svc.walk(left, right)).toBeNull();
  });

  it("clear() keeps the player's radius off the walls where the line of sight does not", () => {
    const w = 12;
    const h = 5;
    const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
    for (let x = 0; x < w; x++) { tiles[x] = TILE_WALL; tiles[(h - 1) * w + x] = TILE_WALL; }
    for (let y = 0; y < h; y++) { tiles[y * w] = TILE_WALL; tiles[y * w + w - 1] = TILE_WALL; }
    const svc = createPathService(mapFromTiles(w, h, tiles), createPathBudget());
    const skim = (y: number): [Vec2, Vec2] => [{ x: 3 * TILE, y }, { x: 9 * TILE, y }];
    // 4 u under the top wall: the ray is free, a disc of PLAYER_RADIUS is not; mid-room both are.
    expect(svc.los(...skim(TILE + 4))).toBe(true);
    expect(svc.clear(...skim(TILE + 4))).toBe(false);
    expect(svc.clear(...skim(2 * TILE + 16))).toBe(true);
  });
});

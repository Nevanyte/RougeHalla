import { describe, expect, it, vi } from "vitest";
import { PLAYER_RADIUS, TILE } from "../src/constants";
import { distPointToSegment, segmentClear } from "../src/geometry";
import { TILE_FLOOR, TILE_WALL, tileToWorldCenter } from "../src/map";
import type { GameMap } from "../src/map";
import { generateMap } from "../src/mapgen";
import { findPath } from "../src/pathfind";
import { mulberry32 } from "../src/rng";
import type { Vec2 } from "../src/messages";

function asciiMap(rows: string[]): GameMap {
  const h = rows.length;
  const w = rows[0].length;
  const tiles = new Uint8Array(w * h);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) tiles[y * w + x] = row[x] === "#" ? TILE_WALL : TILE_FLOOR;
  });
  return { seed: 0, w, h, tiles, buildings: [], spawns: [], extracts: [], crateSpots: [], groundSpots: [] };
}

const c = (tx: number, ty: number): Vec2 => ({ x: tileToWorldCenter(tx), y: tileToWorldCenter(ty) });
const pathLength = (from: Vec2, path: Vec2[]) => {
  let len = 0, prev = from;
  for (const p of path) { len += Math.hypot(p.x - prev.x, p.y - prev.y); prev = p; }
  return len;
};
/** Every hop (including from -> first waypoint) must be a clear swept segment. */
function expectClearHops(map: GameMap, from: Vec2, path: Vec2[], radius = PLAYER_RADIUS) {
  let prev = from;
  for (const p of path) {
    expect(segmentClear(map, prev, p, radius), `hop ${prev.x},${prev.y} -> ${p.x},${p.y}`).toBe(true);
    prev = p;
  }
}

describe("findPath basics", () => {
  const open = asciiMap([
    "############",
    "#..........#",
    "#..........#",
    "#..........#",
    "#..........#",
    "#..........#",
    "############",
  ]);

  it("returns just the target when the straight swept segment is clear", () => {
    const to = { x: 300, y: 150 };
    expect(findPath(open, { x: 50, y: 50 }, to)).toEqual([to]);
  });

  it("returns just the target when start and goal share a tile", () => {
    const to = { x: 100, y: 100 };
    expect(findPath(open, { x: 70, y: 70 }, to)).toEqual([to]);
  });

  it("returns the exact target, not the tile centre", () => {
    const map = asciiMap(["#######", "#.....#", "#.###.#", "#.#...#", "#.#####", "#######"]);
    const to = { x: 5 * TILE + 7, y: 3 * TILE + 21 };
    const path = findPath(map, c(1, 1), to);
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1]).toEqual(to);
  });

  it("routes around a wall and keeps every hop clear", () => {
    const map = asciiMap([
      "############",
      "#..........#",
      "#.########.#",
      "#.#......#.#",
      "#.#......#.#",
      "#..........#",
      "############",
    ]);
    const from = c(1, 3), to = c(10, 3);
    const path = findPath(map, from, to);
    expect(path.length).toBeGreaterThan(1);
    expect(path[path.length - 1]).toEqual(to);
    expectClearHops(map, from, path);
    // Optimal grid route goes via the top or bottom row: bounded above by ~18 tiles, below by the detour.
    expect(pathLength(from, path)).toBeLessThan(20 * TILE);
    expect(pathLength(from, path)).toBeGreaterThan(9 * TILE);
  });

  it("string-pulls: an open diagonal is one hop, a single pillar costs at most a couple", () => {
    const big = asciiMap(Array.from({ length: 22 }, (_, y) => (y === 0 || y === 21 ? "#".repeat(22) : "#" + ".".repeat(20) + "#")));
    expect(findPath(big, c(1, 1), c(20, 20))).toEqual([c(20, 20)]);

    const pillar = asciiMap(Array.from({ length: 22 }, (_, y) => {
      if (y === 0 || y === 21) return "#".repeat(22);
      if (y >= 9 && y <= 12) return "#" + ".".repeat(8) + "####" + ".".repeat(8) + "#";
      return "#" + ".".repeat(20) + "#";
    }));
    const path = findPath(pillar, c(1, 1), c(20, 20));
    expect(path.length).toBeLessThanOrEqual(3);
    expectClearHops(pillar, c(1, 1), path);
  });

  it("works with a 1-tile-wide corridor at the default radius", () => {
    const map = asciiMap([
      "#########",
      "#.......#",
      "#.#####.#",
      "#.#...#.#",
      "#.#.#.#.#",
      "#...#...#",
      "#########",
    ]);
    const from = c(1, 5), to = c(3, 3);
    const path = findPath(map, from, to);
    expect(path.length).toBeGreaterThan(0);
    expectClearHops(map, from, path);
    expect(path[path.length - 1]).toEqual(to);
  });

  it("is deterministic and leaves no state behind between queries", () => {
    const map = generateMap(8);
    const a = findPath(map, map.spawns[0], map.extracts[0]);
    findPath(map, map.spawns[3], map.crateSpots[5]);
    findPath(open, { x: 50, y: 50 }, { x: 300, y: 150 });
    const b = findPath(map, map.spawns[0], map.extracts[0]);
    expect(b).toEqual(a);
  });

  it("does not mutate its inputs and never calls Math.random", () => {
    const map = generateMap(2);
    const from = { ...map.spawns[1] }, to = { ...map.extracts[1] };
    const snapshot = JSON.stringify([from, to, Array.from(map.tiles)]);
    const spy = vi.spyOn(Math, "random");
    try {
      findPath(map, from, to);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(JSON.stringify([from, to, Array.from(map.tiles)])).toBe(snapshot);
  });
});

describe("findPath targets in walls / unreachable", () => {
  const map = asciiMap([
    "##############",
    "#............#",
    "#............#",
    "#....######..#",
    "#....######..#",
    "#....######..#",
    "#....######..#",
    "#....######..#",
    "#....######..#",
    "#....######..#",
    "#............#",
    "##############",
  ]);

  it("snaps a wall target to the nearest floor tile centre", () => {
    // Tile (6,3) is wall; nearest floor is (6,2) directly above.
    const to = { x: 6 * TILE + 16, y: 3 * TILE + 6 };
    const path = findPath(map, c(1, 1), to);
    expect(path[path.length - 1]).toEqual(c(6, 2));
    expectClearHops(map, c(1, 1), path);
  });

  it("returns [] when no floor lies within four tiles of a wall target", () => {
    // Far outside the map, and deep inside a thick wall mass.
    expect(findPath(map, c(1, 1), { x: -500, y: -500 })).toEqual([]);
    const thick = asciiMap(["###########", "#.........#", "#.........#", "#.........#", "###########", "###########", "###########", "###########", "###########", "###########", "###########"]);
    expect(findPath(thick, c(1, 1), c(5, 9))).toEqual([]);
  });

  it("snaps within four steps but not five", () => {
    const m = asciiMap([
      "#####",
      "#.###",
      "#####",
      "#####",
      "#####",
      "#####",
      "#####",
    ]);
    // Target 4 BFS steps from (1,1): tile (1,5) -> ok; tile (1,6) is 5 steps -> no snap.
    expect(findPath(m, c(1, 1), c(1, 5))[0]).toEqual(c(1, 1));
    expect(findPath(m, c(1, 1), c(1, 6))).toEqual([]);
  });

  it("returns [] for a floor target sealed off from the start", () => {
    const sealed = asciiMap([
      "#########",
      "#..#....#",
      "#..#....#",
      "#..#....#",
      "#########",
    ]);
    expect(findPath(sealed, c(1, 1), c(5, 2))).toEqual([]);
  });

  it("snaps a start that is inside a wall onto floor and walks out", () => {
    const from = { x: 6 * TILE + 16, y: 3 * TILE + 16 }; // inside the slab, top row
    const to = c(1, 9);
    const path = findPath(map, from, to);
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1]).toEqual(to);
    // First waypoint is the snapped start tile's centre.
    expect(path[0]).toEqual(c(6, 2));
  });

  it("refuses non-finite coordinates", () => {
    expect(findPath(map, { x: NaN, y: 40 }, c(1, 1))).toEqual([]);
    expect(findPath(map, c(1, 1), { x: 40, y: Infinity })).toEqual([]);
  });
});

describe("findPath never cuts corners", () => {
  it("treats a diagonal pinch between two wall corners as impassable (A* alone, radius 0)", () => {
    const pinch = asciiMap([
      "#######",
      "#..####",
      "#..####",
      "###..##",
      "###..##",
      "#######",
    ]);
    // (2,2) and (3,3) touch only at a vertex, with (3,2) and (2,3) both wall.
    expect(findPath(pinch, c(1, 1), c(4, 4), 0)).toEqual([]);
    expect(findPath(pinch, c(1, 1), c(4, 4))).toEqual([]);
    expect(findPath(pinch, c(4, 4), c(1, 1), 0)).toEqual([]);
  });

  it("refuses a diagonal step when only one orthogonal neighbour is wall", () => {
    const l = asciiMap([
      "####",
      "#.##",
      "#..#",
      "####",
    ]);
    // (1,1)->(2,2) would clip the corner of wall (2,1); the legal route is via (1,2).
    expect(findPath(l, c(1, 1), c(2, 2), 0)).toEqual([c(1, 2), c(2, 2)]);
    const mirror = asciiMap([
      "####",
      "#..#",
      "#.##",
      "####",
    ]);
    expect(findPath(mirror, c(1, 1), c(2, 1), 0)).toEqual([c(2, 1)]);
    expect(findPath(mirror, c(2, 1), c(1, 2), 0)).toEqual([c(1, 1), c(1, 2)]);
  });

  it("detours around a pinch when an open route exists, with all hops clear", () => {
    const map = asciiMap([
      "#########",
      "#.......#",
      "#.......#",
      "#...#...#",
      "#..#....#",
      "#.......#",
      "#########",
    ]);
    // (3,4) and (4,3) are walls whose corners meet at (128,128): (3,3)->(4,4) is a pinch.
    const from = c(3, 3), to = c(4, 4);
    const path = findPath(map, from, to);
    expect(path.length).toBeGreaterThan(1);
    expectClearHops(map, from, path);
    let prev = from;
    for (const p of path) {
      expect(distPointToSegment(4 * TILE, 4 * TILE, prev.x, prev.y, p.x, p.y)).toBeGreaterThanOrEqual(PLAYER_RADIUS);
      prev = p;
    }
  });
});

describe("findPath on generated maps", () => {
  it("connects every spawn to every extract and crate spot with clear hops (12 seeds)", () => {
    for (let s = 0; s < 12; s++) {
      const map = generateMap(s * 7 + 1);
      const targets = [...map.extracts.map((e) => ({ x: e.x, y: e.y })), ...map.crateSpots];
      for (const from of map.spawns) {
        for (const to of targets) {
          const path = findPath(map, from, to);
          expect(path.length, `seed ${map.seed}`).toBeGreaterThan(0);
          expect(path[path.length - 1]).toEqual(to);
          expectClearHops(map, from, path);
        }
      }
    }
  });

  it("connects arbitrary valid off-centre positions, ending exactly on the target", () => {
    const map = generateMap(3);
    const rng = mulberry32(42);
    const valid = (p: Vec2) => segmentClear(map, p, p, PLAYER_RADIUS);
    const rand = (): Vec2 => {
      for (;;) {
        const p = { x: TILE + rng() * (map.w - 2) * TILE, y: TILE + rng() * (map.h - 2) * TILE };
        if (valid(p)) return p;
      }
    };
    for (let i = 0; i < 250; i++) {
      const from = rand(), to = rand();
      const path = findPath(map, from, to);
      expect(path.length).toBeGreaterThan(0);
      expect(path[path.length - 1]).toEqual(to);
      expectClearHops(map, from, path);
    }
  });

  it("paths are not much longer than the best 8-way grid route (sanity on A* optimality)", () => {
    const map = generateMap(5);
    const rng = mulberry32(6);
    for (let i = 0; i < 60; i++) {
      const from = map.spawns[Math.floor(rng() * map.spawns.length)];
      const to = map.crateSpots[Math.floor(rng() * map.crateSpots.length)];
      const best = gridDijkstra(map, from, to);
      const path = findPath(map, from, to);
      const len = pathLength(from, path);
      expect(len).toBeLessThanOrEqual(best + 1e-6); // string pulling can only shorten a tile route
      expect(len).toBeGreaterThanOrEqual(Math.hypot(to.x - from.x, to.y - from.y) - 1e-6);
    }
  });
});

describe("performance", () => {
  it("answers typical 64x64 queries in under 2 ms on average", () => {
    const maps = [1, 2, 3, 4, 5].map((s) => generateMap(s));
    const queries: { map: GameMap; from: Vec2; to: Vec2 }[] = [];
    for (let i = 0; i < 50; i++) {
      const map = maps[i % maps.length];
      queries.push({ map, from: map.spawns[i % 12], to: map.crateSpots[(i * 7) % map.crateSpots.length] });
    }
    for (const q of queries) findPath(q.map, q.from, q.to); // warm up
    const t0 = performance.now();
    for (const q of queries) findPath(q.map, q.from, q.to);
    const avg = (performance.now() - t0) / queries.length;
    expect(avg).toBeLessThan(2);
  });

  it("stays fast for worst-case corner-to-corner queries", () => {
    const map = generateMap(9);
    const a = map.spawns[0];
    let worst = 0;
    for (const to of map.spawns) {
      const t0 = performance.now();
      findPath(map, a, to);
      worst = Math.max(worst, performance.now() - t0);
    }
    expect(worst).toBeLessThan(10);
  });
});

/** Reference: cheapest 8-way no-corner-cut route between the tiles of two points, via label-correcting search. */
function gridDijkstra(map: GameMap, from: Vec2, to: Vec2): number {
  const fx = Math.floor(from.x / TILE), fy = Math.floor(from.y / TILE);
  const tx = Math.floor(to.x / TILE), ty = Math.floor(to.y / TILE);
  const dist = new Float64Array(map.w * map.h).fill(Infinity);
  dist[fy * map.w + fx] = 0;
  const queue = [fy * map.w + fx];
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head];
    const x = u % map.w, y = (u - x) / map.w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (map.tiles[ny * map.w + nx] !== TILE_FLOOR) continue;
        if (dx && dy && (map.tiles[y * map.w + nx] !== TILE_FLOOR || map.tiles[ny * map.w + x] !== TILE_FLOOR)) continue;
        const v = ny * map.w + nx;
        const nd = dist[u] + (dx && dy ? Math.SQRT2 : 1);
        if (nd < dist[v] - 1e-12) { dist[v] = nd; queue.push(v); }
      }
    }
  }
  // Add the off-centre start/end offsets back in so the bound holds for arbitrary points.
  return dist[ty * map.w + tx] * TILE +
    Math.hypot(from.x - tileToWorldCenter(fx), from.y - tileToWorldCenter(fy)) +
    Math.hypot(to.x - tileToWorldCenter(tx), to.y - tileToWorldCenter(ty));
}

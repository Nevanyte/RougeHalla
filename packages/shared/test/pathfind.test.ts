import { describe, expect, it, vi } from "vitest";
import { PLAYER_RADIUS, PLAYER_SPEED, TICK_RATE, TILE } from "../src/constants";
import { circleClear, distPointToSegment, hasLineOfSight, raycast, segmentClear } from "../src/geometry";
import { MASK_MOVE, TILE_FLOOR, TILE_LOW, TILE_WALL, mapFromTiles, moveComponents, tileToWorldCenter, withGates, worldToTile } from "../src/map";
import type { GameMap } from "../src/map";
import { generateMap } from "../src/mapgen";
import { PULL_WINDOW, SNAP_RADIUS, findPath, pathLength as walkLength } from "../src/pathfind";
import { mulberry32 } from "../src/rng";
import type { Vec2 } from "../src/messages";
import { findPathReference } from "./findPathReference";

/** "#" wall, "~" LOW, anything else floor. */
function asciiMap(rows: string[]): GameMap {
  const h = rows.length;
  const w = rows[0].length;
  const tiles = new Uint8Array(w * h);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) tiles[y * w + x] = row[x] === "#" ? TILE_WALL : row[x] === "~" ? TILE_LOW : TILE_FLOOR;
  });
  return mapFromTiles(w, h, tiles);
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
    // Tile (5,3) has walls to its right and below: this point keeps the player disc just clear of both.
    const to = { x: 5 * TILE + 7, y: 3 * TILE + 14 };
    expect(circleClear(map, to, PLAYER_RADIUS)).toBe(true);
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
    const a = findPath(map, map.spawns[0], map.camps[0].chest);
    findPath(map, map.spawns[3], map.crateSpots[5]);
    findPath(open, { x: 50, y: 50 }, { x: 300, y: 150 });
    const b = findPath(map, map.spawns[0], map.camps[0].chest);
    expect(b).toEqual(a);
  });

  it("does not mutate its inputs and never calls Math.random", () => {
    const map = generateMap(2);
    const from = { ...map.spawns[1] }, to = { ...map.camps[1].chest };
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
  it("connects spawns to every camp chest and crate spot with clear hops (8 seeds, 4 spawns each)", () => {
    for (let s = 0; s < 8; s++) {
      const map = generateMap(s * 7 + 1);
      const targets = [...map.camps.map((c) => ({ x: c.chest.x, y: c.chest.y })), ...map.crateSpots];
      for (const from of map.spawns.slice(0, 4)) {
        for (const to of targets) {
          const path = findPath(map, from, to);
          expect(path.length, `seed ${map.seed}`).toBeGreaterThan(0);
          expect(path[path.length - 1]).toEqual(to);
          expectClearHops(map, from, path);
        }
      }
    }
  }, 120_000);

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

/** Ticks a walker along `path` the way the sim does (PLAYER_SPEED / TICK_RATE per tick, spilling into the next waypoint). */
function walk(map: GameMap, start: Vec2, path: Vec2[], radius = PLAYER_RADIUS): { end: Vec2; bad: Vec2 | null } {
  const step = PLAYER_SPEED / TICK_RATE;
  const wps = path.map((w) => ({ ...w }));
  let x = start.x, y = start.y;
  while (wps.length > 0) {
    let budget = step;
    while (budget > 0 && wps.length > 0) {
      const dx = wps[0].x - x, dy = wps[0].y - y;
      const d = Math.hypot(dx, dy);
      if (d <= budget) { x = wps[0].x; y = wps[0].y; budget -= d; wps.shift(); }
      else { x += (dx / d) * budget; y += (dy / d) * budget; budget = 0; }
    }
    if (!circleClear(map, { x, y }, radius)) return { end: { x, y }, bad: { x, y } };
  }
  return { end: { x, y }, bad: null };
}

describe("findPath final position", () => {
  const R = PLAYER_RADIUS;
  const last = (path: Vec2[]) => path[path.length - 1];
  const open = asciiMap([
    "#########",
    "#.......#",
    "#.......#",
    "#.......#",
    "#.......#",
    "#########",
  ]);

  it("leaves a target that already fits exactly where it is, tangent included", () => {
    const tangent = { x: TILE + R, y: 2 * TILE + 16 }; // disc touches the left wall face
    expect(circleClear(open, tangent, R)).toBe(true);
    expect(findPath(open, c(4, 3), tangent)).toEqual([tangent]);
    const inside = { x: 150, y: 90 };
    expect(findPath(open, c(4, 3), inside)).toEqual([inside]);
  });

  it("pulls a target hugging a wall face back by exactly the clearance, one axis at a time", () => {
    const from = c(4, 3);
    expect(last(findPath(open, from, { x: TILE + 1, y: 2 * TILE + 5 }))).toEqual({ x: TILE + R, y: 2 * TILE + 5 }); // left
    expect(last(findPath(open, from, { x: 8 * TILE - 0.5, y: 2 * TILE + 5 }))).toEqual({ x: 8 * TILE - R, y: 2 * TILE + 5 }); // right
    expect(last(findPath(open, from, { x: 3 * TILE + 9, y: TILE + 0.25 }))).toEqual({ x: 3 * TILE + 9, y: TILE + R }); // top
    expect(last(findPath(open, from, { x: 3 * TILE + 9, y: 5 * TILE - 0.25 }))).toEqual({ x: 3 * TILE + 9, y: 5 * TILE - R }); // bottom
  });

  it("clamps both axes in a corner and keeps the point inside its tile", () => {
    const from = c(4, 3);
    expect(last(findPath(open, from, { x: TILE + 0.5, y: TILE + 0.5 }))).toEqual({ x: TILE + R, y: TILE + R });
    expect(last(findPath(open, from, { x: 8 * TILE - 0.5, y: 5 * TILE - 0.5 }))).toEqual({ x: 8 * TILE - R, y: 5 * TILE - R });
  });

  it("squeezes a wall-to-wall target into the band of a one-tile corridor", () => {
    const corridor = asciiMap(["###", "#.#", "#.#", "#.#", "###"]);
    expect(last(findPath(corridor, c(1, 1), { x: TILE + 1, y: 4 * TILE - 2 }))).toEqual({ x: TILE + R, y: 4 * TILE - R });
    const right = last(findPath(corridor, c(1, 1), { x: 2 * TILE - 1, y: 2 * TILE + 8 }));
    expect(right).toEqual({ x: 2 * TILE - R, y: 2 * TILE + 8 });
    expect(circleClear(corridor, right, R)).toBe(true);
  });

  it("falls back to the tile centre when only a diagonal corner is in the way", () => {
    const pillar = asciiMap([
      "#######",
      "#.....#",
      "#.....#",
      "#..#..#",
      "#.....#",
      "#.....#",
      "#######",
    ]);
    // Tile (2,2) touches the pillar (3,3) only at its bottom-right vertex (96, 96).
    expect(last(findPath(pillar, c(5, 5), { x: 3 * TILE - 1, y: 3 * TILE - 1 }))).toEqual(c(2, 2));
    expect(last(findPath(pillar, c(5, 5), { x: 3 * TILE - 8, y: 3 * TILE - 8 }))).toEqual(c(2, 2)); // 11.3 from the vertex
    const fits = { x: 3 * TILE - 9, y: 3 * TILE - 9 }; // 12.7 from the vertex
    expect(last(findPath(pillar, c(5, 5), fits))).toEqual(fits);
  });

  it("always ends on a spot the disc fits, for any radius up to half a tile", () => {
    const pillar = asciiMap(["#####", "#...#", "#.#.#", "#...#", "#####"]);
    for (const radius of [0, 4, 12, TILE / 2]) {
      for (const [tx, ty] of [[1, 1], [3, 1], [1, 3], [3, 3], [2, 1], [1, 2]]) {
        for (const f of [0, 0.25, 1]) {
          const to = { x: (tx + f) * TILE - (f === 1 ? 0.01 : 0), y: (ty + f) * TILE - (f === 1 ? 0.01 : 0) };
          const end = last(findPath(pillar, c(3, 3), to, radius));
          expect(circleClear(pillar, end, radius), `radius ${radius} to ${to.x},${to.y}`).toBe(true);
          expect(worldToTile(end.x)).toBe(worldToTile(to.x));
          expect(worldToTile(end.y)).toBe(worldToTile(to.y));
        }
      }
    }
  });

  it("clamps the same-tile shortcut too", () => {
    const from = { x: TILE + 20, y: 2 * TILE + 16 };
    const to = { x: TILE + 2, y: 2 * TILE + 16 }; // same tile, hugging the left wall
    expect(findPath(open, from, to)).toEqual([{ x: TILE + R, y: 2 * TILE + 16 }]);
  });

  it("does not take the same-tile shortcut through a disc-sized bite taken out of the tile by a diagonal wall", () => {
    const pillar = asciiMap([
      "#######",
      "#.....#",
      "#.....#",
      "#..#..#",
      "#.....#",
      "#.....#",
      "#######",
    ]);
    // Both points are clear and in tile (2,2), either side of the pillar's vertex at (96, 96), but the
    // straight line between them passes 8.5 from that vertex.
    const from = { x: 84, y: 95.9 }, to = { x: 95.9, y: 84 };
    expect(circleClear(pillar, from, R)).toBe(true);
    expect(circleClear(pillar, to, R)).toBe(true);
    expect(segmentClear(pillar, from, to, R)).toBe(false);
    const path = findPath(pillar, from, to);
    expect(path).toEqual([c(2, 2), to]);
    expectClearHops(pillar, from, path);
  });

  it("emits no consecutive duplicate waypoints", () => {
    const map = generateMap(4);
    const rng = mulberry32(5);
    for (let i = 0; i < 300; i++) {
      const from = map.spawns[i % map.spawns.length];
      const tile = map.crateSpots[Math.floor(rng() * map.crateSpots.length)];
      const to = { x: tile.x + (rng() - 0.5) * TILE, y: tile.y + (rng() - 0.5) * TILE };
      let prev: Vec2 = from;
      for (const wp of findPath(map, from, to)) {
        expect(wp.x !== prev.x || wp.y !== prev.y, `${i}: repeated waypoint ${wp.x},${wp.y}`).toBe(true);
        prev = wp;
      }
    }
  });

  describe("fuzz: the walker is never inside a wall, on arrival or at any tick", () => {
    // Offsets inside a tile that straddle every boundary that matters for r = 12: the wall face, the
    // clamp line (12 / 20), the tile edges, and the middle.
    const OFFSETS = [0, 0.001, 1, 6, 11.999, 12, 12.001, 16, 19.999, 20, 20.001, 26, 31, 31.999];

    it.each([1, 2, 3, 7, 11, 42])("seed %i: chained clicks hugging faces and corners, plus anywhere at all", (seed) => {
      const map = generateMap(seed);
      const rng = mulberry32(seed * 1000 + 17);
      const nearWall: Array<[number, number]> = [];
      for (let ty = 1; ty < map.h - 1; ty++) {
        for (let tx = 1; tx < map.w - 1; tx++) {
          if (map.tiles[ty * map.w + tx] !== TILE_FLOOR) continue;
          let walls = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) walls += map.tiles[(ty + dy) * map.w + tx + dx] !== TILE_FLOOR ? 1 : 0;
          if (walls > 0) nearWall.push([tx, ty]);
        }
      }
      expect(nearWall.length).toBeGreaterThan(50);

      let pos: Vec2 = { ...map.spawns[0] };
      let walked = 0, hugged = 0;
      for (let n = 0; n < 400; n++) {
        let click: Vec2;
        if (n % 4 === 3) {
          click = { x: rng() * map.w * TILE, y: rng() * map.h * TILE };
        } else {
          const [tx, ty] = nearWall[Math.floor(rng() * nearWall.length)];
          click = {
            x: tx * TILE + OFFSETS[Math.floor(rng() * OFFSETS.length)],
            y: ty * TILE + OFFSETS[Math.floor(rng() * OFFSETS.length)],
          };
        }
        const path = findPath(map, pos, click);
        if (path.length === 0) continue; // sealed-off pocket or deep inside rock
        expectClearHops(map, pos, path);
        const { end, bad } = walk(map, pos, path);
        expect(bad, `seed ${seed} click ${n} (${click.x},${click.y}) from ${pos.x},${pos.y}: tick position inside a wall`).toBeNull();
        expect(end).toEqual(last(path));
        expect(circleClear(map, end, R), `seed ${seed} click ${n}: arrival`).toBe(true);
        if (!isWallTileAt(map, click)) {
          // Same tile as clicked, and exactly the click whenever it was a legal standing spot.
          expect(worldToTile(end.x)).toBe(worldToTile(click.x));
          expect(worldToTile(end.y)).toBe(worldToTile(click.y));
          if (circleClear(map, click, R)) expect(end).toEqual(click); else hugged++;
        }
        pos = end;
        walked++;
      }
      expect(walked).toBeGreaterThan(200);
      expect(hugged).toBeGreaterThan(20); // the fuzz really does exercise the clamp
    });
  });
});

/** Mean ms per call over `reps` calls, the best of `rounds` rounds (a scheduler pause costs one round, not all), after a warm-up call. */
function msPerCall(fn: () => unknown, reps: number, rounds = 3): number {
  fn();
  let best = Infinity;
  for (let r = 0; r < rounds; r++) {
    const t0 = performance.now();
    for (let i = 0; i < reps; i++) fn();
    best = Math.min(best, (performance.now() - t0) / reps);
  }
  return best;
}

const isWallTileAt = (map: GameMap, p: Vec2) => map.tiles[worldToTile(p.y) * map.w + worldToTile(p.x)] !== TILE_FLOOR;

/** CPU time of this test file's main thread in ms: vitest runs each file in its own process, so other files' load does not count. */
const cpuMs = (): number => {
  // The main thread's CPU time where Node has it (23.9+): V8's helper threads and other test files do not count.
  const u = typeof process.threadCpuUsage === "function" ? process.threadCpuUsage() : process.cpuUsage();
  return (u.user + u.system) / 1000;
};

describe("performance", () => {
  it("answers typical generated-map queries in under 2 ms on average", () => {
    const maps = [1, 2, 3, 4, 5].map((s) => generateMap(s));
    const queries: { map: GameMap; from: Vec2; to: Vec2 }[] = [];
    for (let i = 0; i < 50; i++) {
      const map = maps[i % maps.length];
      queries.push({ map, from: map.spawns[i % 12], to: map.crateSpots[(i * 7) % map.crateSpots.length] });
    }
    for (const q of queries) findPath(q.map, q.from, q.to); // warm up
    const t0 = cpuMs();
    for (const q of queries) findPath(q.map, q.from, q.to);
    const avg = (cpuMs() - t0) / queries.length;
    expect(avg).toBeLessThan(2);
  });

  it("stays fast for worst-case corner-to-corner queries", () => {
    const map = generateMap(9);
    const a = map.spawns[0];
    for (const to of map.spawns) findPath(map, a, to); // warm up (the scratch is sized per map)
    let worst = 0;
    for (const to of map.spawns) {
      const t0 = cpuMs();
      findPath(map, a, to);
      worst = Math.max(worst, cpuMs() - t0);
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

// ---------------------------------------------------------------------------------------------------------------------
// LOW tiles stop bodies: a path never crosses them, hops are judged under MASK_MOVE, and a goal on the far side of a
// closed LOW line is unreachable.

/** Random square map with a wall border and independent WALL / LOW tiles. */
function randomLowMap(rng: () => number, size: number, pWall: number, pLow: number): GameMap {
  const tiles = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      const r = rng();
      tiles[y * size + x] = edge || r < pWall ? TILE_WALL : r < pWall + pLow ? TILE_LOW : TILE_FLOOR;
    }
  }
  return mapFromTiles(size, size, tiles);
}

/** A wall-ringed 24x12 room cut by a one-tile vertical LOW fence at x=12, open only at rows 9 and 10. */
function fencedRoom(): GameMap {
  const w = 24, h = 12;
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      tiles[y * w + x] = edge ? TILE_WALL : x === 12 && y < h - 3 ? TILE_LOW : TILE_FLOOR;
    }
  }
  return mapFromTiles(w, h, tiles);
}

/** Samples every hop at 1 u: the disc must be clear under MASK_MOVE and the centre must stand on floor. Returns the first bad point. */
function firstBadPoint(map: GameMap, from: Vec2, path: Vec2[], radius = PLAYER_RADIUS): Vec2 | null {
  let prev = from;
  for (const wp of path) {
    const len = Math.hypot(wp.x - prev.x, wp.y - prev.y);
    for (let s = 0; s <= len; s += 1) {
      const p = { x: prev.x + ((wp.x - prev.x) * s) / (len || 1), y: prev.y + ((wp.y - prev.y) * s) / (len || 1) };
      if (!circleClear(map, p, radius, MASK_MOVE)) return p;
      if (map.tiles[worldToTile(p.y) * map.w + worldToTile(p.x)] !== TILE_FLOOR) return p;
    }
    prev = wp;
  }
  return null;
}

describe("findPath and a LOW fence", () => {
  const fence = fencedRoom();
  const from = c(8, 4);
  const to = c(16, 4);

  it("goes through the gap and never takes the straight hop across the fence", () => {
    // The old geometry saw LOW as open floor and answered [to]: the server would have walked it across.
    expect(segmentClear(fence, from, to, PLAYER_RADIUS)).toBe(false);
    expect(hasLineOfSight(fence, from, to)).toBe(true); // a fence is see-through
    const path = findPath(fence, from, to);
    expect(path.length).toBeGreaterThan(1);
    expect(path).not.toEqual([to]);
    expect(path[path.length - 1]).toEqual(to);
    expectClearHops(fence, from, path);
    expect(firstBadPoint(fence, from, path)).toBeNull();
    // Wherever the walk is inside the fence's column it is in the gap rows.
    let prev = from;
    let crossedAt: number | null = null;
    for (const wp of path) {
      const len = Math.hypot(wp.x - prev.x, wp.y - prev.y);
      for (let s = 0; s <= len; s += 1) {
        const x = prev.x + ((wp.x - prev.x) * s) / (len || 1);
        const y = prev.y + ((wp.y - prev.y) * s) / (len || 1);
        if (x >= 12 * TILE && x < 13 * TILE) { crossedAt = y; expect(y).toBeGreaterThanOrEqual(9 * TILE); }
      }
      prev = wp;
    }
    expect(crossedAt).not.toBeNull();
    expect(pathLength(from, path)).toBeGreaterThan(Math.hypot(to.x - from.x, to.y - from.y) + 100);
  });

  it("walks back the same way, and its hops are blocked under the move mask but not by a sight cast", () => {
    const back = findPath(fence, to, from);
    expect(back.length).toBeGreaterThan(1);
    expect(back[back.length - 1]).toEqual(from);
    expectClearHops(fence, to, back);
    expect(raycast(fence, from.x, from.y, to.x, to.y, MASK_MOVE).hit).toBe(true);
    expect(raycast(fence, from.x, from.y, to.x, to.y).hit).toBe(false);
  });

  it("returns [] when the fence has no gap (the goal is on the other side of a closed line)", () => {
    const sealed = fencedRoom();
    for (let y = 1; y < sealed.h - 1; y++) sealed.tiles[y * sealed.w + 12] = TILE_LOW;
    expect(findPath(sealed, from, to)).toEqual([]);
    expect(findPath(sealed, to, from)).toEqual([]);
    expect(findPath(sealed, from, c(10, 9)).length).toBeGreaterThan(0); // its own side is still reachable
  });

  it("a click on the fence walks to a bank, the nearer one", () => {
    const west = findPath(fence, from, { x: 12 * TILE + 8, y: 4 * TILE + 16 });
    expect(west[west.length - 1]).toEqual(c(11, 4));
    const east = findPath(fence, c(16, 4), { x: 12 * TILE + 24, y: 4 * TILE + 16 });
    expect(east[east.length - 1]).toEqual(c(13, 4));
  });
});

describe("findPath target clamping and snapping against LOW", () => {
  const R = PLAYER_RADIUS;
  const last = (path: Vec2[]) => path[path.length - 1];
  // A floor room ringed by LOW (itself inside the wall border): floor x 2..7, y 2..4.
  const pond = asciiMap([
    "##########",
    "#~~~~~~~~#",
    "#~......~#",
    "#~......~#",
    "#~......~#",
    "#~~~~~~~~#",
    "##########",
  ]);

  it("pulls a target hugging a LOW face back by exactly the clearance, one axis at a time", () => {
    const from = c(4, 3);
    expect(last(findPath(pond, from, { x: 2 * TILE + 1, y: 3 * TILE + 5 }))).toEqual({ x: 2 * TILE + R, y: 3 * TILE + 5 });
    expect(last(findPath(pond, from, { x: 8 * TILE - 0.5, y: 3 * TILE + 5 }))).toEqual({ x: 8 * TILE - R, y: 3 * TILE + 5 });
    expect(last(findPath(pond, from, { x: 4 * TILE + 9, y: 2 * TILE + 0.25 }))).toEqual({ x: 4 * TILE + 9, y: 2 * TILE + R });
    expect(last(findPath(pond, from, { x: 4 * TILE + 9, y: 5 * TILE - 0.25 }))).toEqual({ x: 4 * TILE + 9, y: 5 * TILE - R });
  });

  it("clamps both axes in a LOW corner", () => {
    const from = c(4, 3);
    expect(last(findPath(pond, from, { x: 2 * TILE + 0.5, y: 2 * TILE + 0.5 }))).toEqual({ x: 2 * TILE + R, y: 2 * TILE + R });
    expect(last(findPath(pond, from, { x: 8 * TILE - 0.5, y: 5 * TILE - 0.5 }))).toEqual({ x: 8 * TILE - R, y: 5 * TILE - R });
  });

  it("leaves a target that fits tangent to a LOW face exactly where it is", () => {
    const tangent = { x: 2 * TILE + R, y: 3 * TILE + 16 };
    expect(circleClear(pond, tangent, R)).toBe(true);
    expect(findPath(pond, c(4, 3), tangent)).toEqual([tangent]);
  });

  // A LOW band nine tiles wide (x 3..11) between two banks that it separates completely.
  const band = asciiMap([
    "################",
    "#..~~~~~~~~~...#",
    "#..~~~~~~~~~...#",
    "#..~~~~~~~~~...#",
    "################",
  ]);

  it("snaps a goal on LOW to the nearest floor tile centre, within four rings", () => {
    // Tile (3,2) is one step from the west bank (2,2); (6,2) is four.
    expect(last(findPath(band, c(1, 1), { x: 3 * TILE + 16, y: 2 * TILE + 16 }))).toEqual(c(2, 2));
    const four = findPath(band, c(1, 1), c(6, 2));
    expect(last(four)).toEqual(c(2, 2));
    expectClearHops(band, c(1, 1), four);
  });

  it("returns [] for a goal five or more rings deep in LOW, matching the wall rule", () => {
    expect(SNAP_RADIUS).toBe(4);
    // (7,2) is five steps from both banks. (8,2) is four from the east bank, which the start cannot reach.
    expect(findPath(band, c(1, 1), c(7, 2))).toEqual([]);
    expect(findPath(band, c(1, 1), c(8, 2))).toEqual([]);
    expect(findPath(band, c(13, 1), c(8, 2))[0]).toBeDefined();
  });

  it("a start inside LOW snaps onto the bank and walks out", () => {
    const path = findPath(band, { x: 3 * TILE + 16, y: 2 * TILE + 16 }, c(1, 3));
    expect(path.length).toBeGreaterThan(0);
    expect(path[0]).toEqual(c(2, 2));
    expect(last(path)).toEqual(c(1, 3));
  });
});

describe("findPath unreachable goals", () => {
  it("equal to the answer without the component reject on random LOW maps, and never crossing LOW (sampled at 1 u)", () => {
    const rng = mulberry32(2024);
    let reachable = 0, unreachable = 0, snapped = 0, hugged = 0;
    for (let k = 0; k < 40; k++) {
      const map = randomLowMap(rng, 24, 0.1, 0.22);
      const comp = moveComponents(map);
      const floor: number[] = [];
      for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === TILE_FLOOR) floor.push(i);
      if (floor.length < 20) continue;
      const startTile = floor[Math.floor(rng() * floor.length)];
      let pos: Vec2 = c(startTile % map.w, Math.floor(startTile / map.w));
      for (let q = 0; q < 30; q++) {
        const click = { x: 8 + rng() * (map.w * TILE - 16), y: 8 + rng() * (map.h * TILE - 16) };
        const path = findPath(map, pos, click);
        expect(path, `map ${k} query ${q}`).toEqual(findPathReference(map, pos, click));
        const s = worldToTile(pos.y) * map.w + worldToTile(pos.x);
        const g = worldToTile(click.y) * map.w + worldToTile(click.x);
        if (map.tiles[g] === TILE_FLOOR) {
          // Floor to floor: a path exists exactly when the tiles share a component, and exactly when grid search finds one.
          expect(path.length > 0, `map ${k} query ${q}: components ${comp[s]} / ${comp[g]}`).toBe(comp[s] === comp[g]);
          expect(path.length > 0).toBe(Number.isFinite(gridDijkstra(map, pos, click)));
          if (path.length > 0) { reachable++; if (!circleClear(map, click, PLAYER_RADIUS)) hugged++; } else unreachable++;
        } else if (path.length > 0) snapped++;
        if (path.length === 0) continue;
        expectClearHops(map, pos, path);
        expect(firstBadPoint(map, pos, path), `map ${k} query ${q}: walker off floor`).toBeNull();
        pos = path[path.length - 1];
      }
    }
    expect(reachable).toBeGreaterThan(300);
    expect(unreachable).toBeGreaterThan(100);
    expect(snapped).toBeGreaterThan(100);
    expect(hugged).toBeGreaterThan(10);
  });

  it("answers a goal behind a sealed river at once, with the same [] as a full search", () => {
    const W = 96;
    const tiles = new Uint8Array(W * W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) tiles[y * W + x] = x === 0 || y === 0 || x === W - 1 || y === W - 1 ? TILE_WALL : TILE_FLOOR;
    for (let y = 1; y < W - 1; y++) { tiles[y * W + 46] = TILE_LOW; tiles[y * W + 47] = TILE_LOW; }
    const map = mapFromTiles(W, W, tiles);
    const from = { x: 80, y: 1500 };
    const to = { x: 2900, y: 1500 };
    expect(findPath(map, from, to)).toEqual([]);
    expect(findPathReference(map, from, to)).toEqual([]);
    // Timed against the full search on the same query, so the gate is how much the reject saves and machine load cancels out.
    const ours = msPerCall(() => findPath(map, from, to), 200);
    const full = msPerCall(() => findPathReference(map, from, to), 10);
    expect(full / ours, `reject ${ours} ms, full search ${full} ms`).toBeGreaterThanOrEqual(3);
    expect(ours).toBeLessThan(0.5); // a ceiling only for a runaway (about 10x what it costs on a quiet machine)
  });

  it("is also [] across closed coliseum gates, and open when the gates are", () => {
    const map = generateMap(2);
    const centre = map.coliseum.centre;
    expect(findPath(map, map.spawns[0], centre).length).toBeGreaterThan(0);
    expect(findPath(withGates(map), map.spawns[0], centre)).toEqual([]);
  });
});

describe("PULL_WINDOW", () => {
  it("is 96 (zone-shapes contract 7.1, measured on the open 136x136 maps)", () => {
    expect(PULL_WINDOW).toBe(96);
  });

  it("lengthens at most 0.5% of paths on generated maps by more than 1% (against the same search without the window and the reject)", () => {
    const rng = mulberry32(8);
    let compared = 0, nonEmpty = 0, longest = 0, longer = 0, same = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const open = generateMap(seed);
      for (const map of seed % 2 === 0 ? [open, withGates(open)] : [open]) {
        for (let i = 0; i < 40; i++) {
          const a = { x: 40 + rng() * (map.w * TILE - 80), y: 40 + rng() * (map.h * TILE - 80) };
          const b = { x: 40 + rng() * (map.w * TILE - 80), y: 40 + rng() * (map.h * TILE - 80) };
          const path = findPath(map, a, b), ref = findPathReference(map, a, b);
          expect(path.length === 0, `seed ${seed} query ${i}: reachability`).toBe(ref.length === 0);
          compared++;
          if (path.length > 0) nonEmpty++;
          if (JSON.stringify(path) === JSON.stringify(ref)) same++;
          if (pathLength(a, path) > 1.01 * pathLength(a, ref)) longer++;
          longest = Math.max(longest, path.length);
        }
      }
    }
    expect(compared).toBeGreaterThan(900);
    expect(nonEmpty).toBeGreaterThan(500);
    expect(longest).toBeGreaterThan(3);
    expect(longer, `${longer} of ${compared} paths over 1% longer`).toBeLessThanOrEqual(Math.floor(0.005 * compared));
    expect(same, "nearly every path is the unwindowed one").toBeGreaterThan(0.95 * compared);
  });

  it("keeps findPath on a 96x96 serpentine of LOW rivers well under the same search without the window", () => {
    const W = 96;
    const tiles = new Uint8Array(W * W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) tiles[y * W + x] = x === 0 || y === 0 || x === W - 1 || y === W - 1 ? TILE_WALL : TILE_FLOOR;
    // Vertical two-tile rivers every 8 columns with a gap alternately at the bottom and the top: one long snake.
    for (let k = 0, x = 6; x < W - 4; x += 8, k++) {
      for (let y = 1; y < W - 1; y++) {
        const gap = k % 2 === 0 ? y >= W - 5 : y <= 4;
        if (!gap) { tiles[y * W + x] = TILE_LOW; tiles[y * W + x + 1] = TILE_LOW; }
      }
    }
    const rng = mulberry32(5);
    for (let i = 0; i < 300; i++) {
      const x = 1 + Math.floor(rng() * (W - 2));
      const y = 5 + Math.floor(rng() * (W - 10));
      if (tiles[y * W + x] === TILE_FLOOR) tiles[y * W + x] = TILE_WALL;
    }
    const map = mapFromTiles(W, W, tiles);
    const queries: [Vec2, Vec2][] = [];
    for (let i = 0; i < 40; i++) queries.push([{ x: (2 + rng() * 3) * TILE, y: (10 + rng() * 76) * TILE }, { x: (90 + rng() * 4) * TILE, y: (10 + rng() * 76) * TILE }]);
    for (const [a, b] of queries) findPath(map, a, b); // warm up
    let worst = 0, longest = 0;
    for (const [a, b] of queries) {
      // Best of three, so a scheduler pause while other test files run does not decide the ceiling.
      let best = Infinity;
      let path: Vec2[] = [];
      for (let rep = 0; rep < 3; rep++) {
        const t0 = performance.now();
        path = findPath(map, a, b);
        best = Math.min(best, performance.now() - t0);
      }
      worst = Math.max(worst, best);
      longest = Math.max(longest, path.length);
      expect(path.length).toBeGreaterThan(0);
    }
    expect(longest).toBeGreaterThan(5); // the snake really forces detours
    // The gate is the saving over the reference on the same queries (load cancels out); the absolute ceiling is only for a runaway
    // (about 10x the worst query on a quiet machine).
    const ours = msPerCall(() => { for (const [a, b] of queries) findPath(map, a, b); }, 1);
    const full = msPerCall(() => { for (const [a, b] of queries) findPathReference(map, a, b); }, 1);
    expect(full / ours, `window ${ours} ms, without ${full} ms for ${queries.length} queries`).toBeGreaterThanOrEqual(2); // 4x on a quiet machine, 2x is the load-proof floor for "the window still pays"
    expect(worst).toBeLessThan(30);
  });
});

describe("pathLength (the generator's spawn gate and the planning walks use it)", () => {
  it("sums the segment lengths from `from` through the waypoints, with Math.sqrt: 0 for no waypoints, 3-4-5 triangles exact", () => {
    expect(walkLength({ x: 5, y: 5 }, [])).toBe(0);
    expect(walkLength({ x: 0, y: 0 }, [{ x: 3, y: 4 }])).toBe(5);
    expect(walkLength({ x: 0, y: 0 }, [{ x: 3, y: 4 }, { x: 3, y: 4 }, { x: 6, y: 8 }])).toBe(10);
    const path = findPath(generateMap(1), { x: tileToWorldCenter(10), y: tileToWorldCenter(10) }, { x: tileToWorldCenter(60), y: tileToWorldCenter(40) });
    expect(walkLength({ x: tileToWorldCenter(10), y: tileToWorldCenter(10) }, path)).toBeCloseTo(pathLength({ x: tileToWorldCenter(10), y: tileToWorldCenter(10) }, path), 6);
  });

  it("never calls Math.hypot (nor another engine-approximated function) in findPath, raycast, segmentClear or distPointToSegment on a generated map", () => {
    const m = generateMap(4);
    const spies = (["hypot", "pow", "exp", "log", "sin", "cos", "atan2"] as const).map((n) => vi.spyOn(Math, n));
    try {
      for (const p of m.spawnPool.slice(0, 6)) {
        findPath(m, p, m.coliseum.centre);
        raycast(m, p.x, p.y, m.coliseum.centre.x, m.coliseum.centre.y);
        segmentClear(m, p, m.coliseum.centre, PLAYER_RADIUS);
        distPointToSegment(p.x, p.y, 0, 0, m.coliseum.centre.x, m.coliseum.centre.y);
      }
      expect(spies.map((sp) => sp.mock.calls.length)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    } finally {
      for (const sp of spies) sp.mockRestore();
    }
  });
});

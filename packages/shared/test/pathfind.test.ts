import { describe, expect, it, vi } from "vitest";
import { PLAYER_RADIUS, PLAYER_SPEED, TICK_RATE, TILE } from "../src/constants";
import { circleClear, distPointToSegment, segmentClear } from "../src/geometry";
import { TILE_FLOOR, TILE_WALL, mapFromTiles, tileToWorldCenter, worldToTile } from "../src/map";
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
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) walls += map.tiles[(ty + dy) * map.w + tx + dx];
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

const isWallTileAt = (map: GameMap, p: Vec2) => map.tiles[worldToTile(p.y) * map.w + worldToTile(p.x)] !== TILE_FLOOR;

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

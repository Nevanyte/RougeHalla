import { describe, expect, it } from "vitest";
import { TILE } from "../src/constants";
import { circleClear, distPointToSegment, hasLineOfSight, raycast, segmentClear } from "../src/geometry";
import { MASK_MELEE, MASK_MOVE, MASK_SIGHT, TILE_FLOOR, TILE_LOW, TILE_WALL, mapFromTiles, withGates } from "../src/map";
import type { GameMap } from "../src/map";
import { generateMap } from "../src/mapgen";
import { findPath } from "../src/pathfind";
import { mulberry32 } from "../src/rng";

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

// A two-tile pillar at tile x=5, y=3..4  ->  world x in [160, 192), y in [96, 160).
const room = asciiMap([
  "##########",
  "#........#",
  "#........#",
  "#....#...#",
  "#....#...#",
  "#........#",
  "##########",
]);

describe("distPointToSegment", () => {
  it("measures perpendicular distance inside the segment", () => {
    expect(distPointToSegment(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
  });

  it("clamps to the nearest endpoint outside the segment", () => {
    expect(distPointToSegment(-3, 4, 0, 0, 10, 0)).toBeCloseTo(5);
    expect(distPointToSegment(13, -4, 0, 0, 10, 0)).toBeCloseTo(5);
  });

  it("handles degenerate segments and points on the segment", () => {
    expect(distPointToSegment(3, 4, 0, 0, 0, 0)).toBeCloseTo(5);
    expect(distPointToSegment(5, 5, 0, 0, 10, 10)).toBeCloseTo(0);
  });

  it("is symmetric in the segment direction", () => {
    expect(distPointToSegment(2, 7, 1, 1, 9, 4)).toBeCloseTo(distPointToSegment(2, 7, 9, 4, 1, 1));
  });
});

describe("raycast", () => {
  it("misses in open space and reports the end point and length", () => {
    const r = raycast(room, 48, 48, 240, 48);
    expect(r).toEqual({ hit: false, x: 240, y: 48, dist: 192 });
  });

  it("hits the pillar from the left at its west face", () => {
    const r = raycast(room, 48, 112, 280, 112);
    expect(r.hit).toBe(true);
    expect(r.x).toBe(160);
    expect(r.y).toBeCloseTo(112);
    expect(r.dist).toBeCloseTo(112);
  });

  it("hits the pillar from the right at its east face", () => {
    const r = raycast(room, 280, 112, 48, 112);
    expect(r.hit).toBe(true);
    expect(r.x).toBe(192);
    expect(r.dist).toBeCloseTo(88);
  });

  it("hits from above and below", () => {
    const down = raycast(room, 176, 48, 176, 200);
    expect(down.hit).toBe(true);
    expect(down.y).toBe(96);
    expect(down.x).toBeCloseTo(176);
    expect(down.dist).toBeCloseTo(48);

    const up = raycast(room, 176, 180, 176, 20);
    expect(up.hit).toBe(true);
    expect(up.y).toBe(160);
    expect(up.dist).toBeCloseTo(20);
  });

  it("hits on a diagonal ray at the tile boundary it crosses", () => {
    const r = raycast(room, 100, 40, 240, 180);
    expect(r.hit).toBe(true);
    expect(r.x).toBe(160);
    expect(r.y).toBeCloseTo(100);
    expect(r.dist).toBeCloseTo(Math.SQRT2 * 60);
  });

  it("misses when the segment stops short of the wall", () => {
    const r = raycast(room, 48, 112, 150, 112);
    expect(r).toEqual({ hit: false, x: 150, y: 112, dist: 102 });
  });

  it("hits at the wall face when the segment ends inside the wall", () => {
    const r = raycast(room, 48, 112, 170, 112);
    expect(r.hit).toBe(true);
    expect(r.x).toBe(160);
  });

  it("hits at distance 0 when starting inside a wall", () => {
    expect(raycast(room, 170, 120, 250, 120)).toEqual({ hit: true, x: 170, y: 120, dist: 0 });
    expect(raycast(room, 5, 5, 100, 100)).toEqual({ hit: true, x: 5, y: 5, dist: 0 });
  });

  it("handles zero-length segments", () => {
    expect(raycast(room, 48, 48, 48, 48)).toEqual({ hit: false, x: 48, y: 48, dist: 0 });
    expect(raycast(room, 170, 120, 170, 120).hit).toBe(true);
  });

  it("stops at the border when leaving the map", () => {
    const r = raycast(room, 48, 48, 48, -100);
    expect(r.hit).toBe(true);
    expect(r.y).toBe(TILE);
    expect(r.dist).toBeCloseTo(16);
  });

  it("treats rays that graze a wall vertex as hits, symmetrically", () => {
    // Passes exactly through the north-west corner (160, 96) of the pillar.
    const fwd = raycast(room, 144, 112, 176, 80);
    const back = raycast(room, 176, 80, 144, 112);
    expect(fwd.hit).toBe(true);
    expect(back.hit).toBe(true);
    expect(fwd.x).toBe(160);
    expect(fwd.y).toBeCloseTo(96);
  });

  it("does not hang or crash on non-finite input", () => {
    expect(raycast(room, NaN, 0, 10, 10).hit).toBe(true);
    expect(raycast(room, 48, 48, Infinity, 48).hit).toBe(true);
  });

  it("agrees with dense point sampling on a generated map", () => {
    const map = generateMap(5);
    const rng = mulberry32(1);
    const span = map.w * TILE;
    let mismatches = 0;
    for (let i = 0; i < 400; i++) {
      const x0 = 40 + rng() * (span - 80);
      const y0 = 40 + rng() * (span - 80);
      const x1 = Math.min(span - 40, Math.max(40, x0 + (rng() - 0.5) * 500));
      const y1 = Math.min(span - 40, Math.max(40, y0 + (rng() - 0.5) * 500));
      const r = raycast(map, x0, y0, x1, y1);
      // Reference: march in 0.25 world-unit steps and find the first wall sample.
      const len = Math.hypot(x1 - x0, y1 - y0);
      const wallAt = (s: number): boolean => {
        const t = len === 0 ? 0 : s / len;
        const tx = Math.floor((x0 + (x1 - x0) * t) / TILE);
        const ty = Math.floor((y0 + (y1 - y0) * t) / TILE);
        return (map.tiles[ty * map.w + tx] & MASK_SIGHT) !== 0;
      };
      let first = -1;
      for (let s = 0; s <= len; s += 0.25) if (wallAt(s)) { first = s; break; }
      // A ray that only clips a wall corner spends less than a sample step inside the wall, which the coarse march steps
      // over (the exact walk is right). Look again around the reported hit, a thousand times finer.
      if (first < 0 && r.hit) {
        for (let s = Math.max(0, r.dist - 0.5); s <= Math.min(len, r.dist + 0.5); s += 0.001) if (wallAt(s)) { first = s; break; }
      }
      if (r.hit !== (first >= 0)) mismatches++;
      else if (r.hit && Math.abs(r.dist - first) > 0.5) mismatches++;
      // Symmetry of hit/miss.
      expect(raycast(map, x1, y1, x0, y0).hit).toBe(r.hit);
    }
    expect(mismatches).toBe(0);
  });
});

describe("hasLineOfSight", () => {
  it("is true across open floor and false through the pillar", () => {
    expect(hasLineOfSight(room, { x: 48, y: 48 }, { x: 280, y: 48 })).toBe(true);
    expect(hasLineOfSight(room, { x: 48, y: 112 }, { x: 280, y: 112 })).toBe(false);
  });

  it("is blocked when either end is inside a wall", () => {
    expect(hasLineOfSight(room, { x: 170, y: 120 }, { x: 48, y: 48 })).toBe(false);
  });
});

describe("circleClear", () => {
  const r = 12;

  it("is true on open floor and false when the disc overlaps a wall face by any amount", () => {
    expect(circleClear(room, { x: 80, y: 80 }, r)).toBe(true);
    // Left border wall's face is x = 32; pillar west face is x = 160, top face y = 96.
    expect(circleClear(room, { x: 32 + r, y: 80 }, r)).toBe(true); // tangent
    expect(circleClear(room, { x: 32 + r - 0.001, y: 80 }, r)).toBe(false);
    expect(circleClear(room, { x: 160 - r, y: 128 }, r)).toBe(true);
    expect(circleClear(room, { x: 160 - r + 0.001, y: 128 }, r)).toBe(false);
    expect(circleClear(room, { x: 176, y: 96 - r }, r)).toBe(true);
    expect(circleClear(room, { x: 176, y: 96 - r + 0.001, }, r)).toBe(false);
  });

  it("measures to the corner, not the bounding box, when a disc sits diagonally off a wall vertex", () => {
    // Pillar vertex (160, 96): 12 away along the diagonal is (160 - 12 / sqrt 2, 96 - 12 / sqrt 2).
    const k = r / Math.SQRT2;
    expect(circleClear(room, { x: 160 - k - 0.01, y: 96 - k - 0.01 }, r)).toBe(true);
    expect(circleClear(room, { x: 160 - k + 0.01, y: 96 - k + 0.01 }, r)).toBe(false);
    // A box test would call this blocked (both axes are within 12 of the pillar) but the vertex is 12.7 away.
    expect(circleClear(room, { x: 160 - 9, y: 96 - 9 }, r)).toBe(true);
    expect(circleClear(room, { x: 160 - 8, y: 96 - 8 }, r)).toBe(false);
  });

  it("treats everything outside the map as wall", () => {
    const tiny = asciiMap(["...", "...", "..."]);
    expect(circleClear(tiny, { x: 48, y: 48 }, r)).toBe(true);
    expect(circleClear(tiny, { x: r, y: 48 }, r)).toBe(true);
    expect(circleClear(tiny, { x: r - 0.5, y: 48 }, r)).toBe(false);
    expect(circleClear(tiny, { x: 3 * TILE - r + 0.5, y: 48 }, r)).toBe(false);
    expect(circleClear(tiny, { x: 48, y: -50 }, 4)).toBe(false);
  });

  it("looks more than one tile out for a disc wider than a tile", () => {
    const hall = asciiMap(["#######", "#.....#", "#.....#", "#.....#", "#.....#", "#.....#", "#######"]);
    const centre = { x: 3.5 * TILE, y: 3.5 * TILE };
    expect(circleClear(hall, centre, 2.5 * TILE)).toBe(true);
    expect(circleClear(hall, centre, 2.5 * TILE + 0.5)).toBe(false);
  });

  it("is a point-on-floor test for a zero radius, and never clear for non-finite input", () => {
    expect(circleClear(room, { x: 48, y: 48 }, 0)).toBe(true);
    expect(circleClear(room, { x: 170, y: 120 }, 0)).toBe(false);
    expect(circleClear(room, { x: 20, y: 48 }, 0)).toBe(false);
    expect(circleClear(room, { x: NaN, y: 48 }, r)).toBe(false);
    expect(circleClear(room, { x: 48, y: Infinity }, r)).toBe(false);
    expect(circleClear(room, { x: 48, y: 48 }, NaN)).toBe(false);
  });

  it("agrees with an exact distance-to-wall-rectangles reference on generated maps", () => {
    const rng = mulberry32(21);
    const radii = [4, 12, 16, 20, 40, 70];
    let checked = 0, clear = 0;
    for (const seed of [3, 8]) {
      const map = generateMap(seed);
      for (let i = 0; i < 2500; i++) {
        const radius = radii[i % radii.length];
        const p = { x: rng() * map.w * TILE, y: rng() * map.h * TILE };
        const d = minWallDistance(map, p, p, radius + 1);
        if (Math.abs(d - radius) < 1e-6) continue;
        const ok = circleClear(map, p, radius);
        expect(ok, `seed ${seed} r=${radius} p=${p.x},${p.y} d=${d}`).toBe(d > radius);
        checked++;
        if (ok) clear++;
      }
    }
    expect(checked).toBeGreaterThan(4500);
    expect(clear).toBeGreaterThan(500);
    expect(checked - clear).toBeGreaterThan(500);
  });

  it("is what segmentClear uses for a zero-length segment", () => {
    const rng = mulberry32(5);
    const map = generateMap(11);
    for (let i = 0; i < 500; i++) {
      const p = { x: rng() * map.w * TILE, y: rng() * map.h * TILE };
      expect(segmentClear(map, p, p, r)).toBe(circleClear(map, p, r));
    }
  });
});

describe("segmentClear", () => {
  const r = 12;

  it("passes a pillar with enough margin and blocks it when too close", () => {
    // Pillar top face is y = 96.
    expect(segmentClear(room, { x: 48, y: 80 }, { x: 240, y: 80 }, r)).toBe(true);
    expect(segmentClear(room, { x: 48, y: 83 }, { x: 240, y: 83 }, r)).toBe(true);
    expect(segmentClear(room, { x: 48, y: 85 }, { x: 240, y: 85 }, r)).toBe(false);
    expect(segmentClear(room, { x: 48, y: 90 }, { x: 240, y: 90 }, r)).toBe(false);
    expect(segmentClear(room, { x: 48, y: 112 }, { x: 240, y: 112 }, r)).toBe(false);
  });

  it("depends on the radius", () => {
    const a = { x: 48, y: 83 };
    const b = { x: 240, y: 83 };
    expect(segmentClear(room, a, b, 12)).toBe(true);
    expect(segmentClear(room, a, b, 14)).toBe(false);
    expect(segmentClear(room, a, b, 0)).toBe(true);
  });

  it("checks the endpoint discs, including against a wall corner", () => {
    expect(segmentClear(room, { x: 48, y: 112 }, { x: 145, y: 112 }, r)).toBe(true);
    expect(segmentClear(room, { x: 48, y: 112 }, { x: 150, y: 112 }, r)).toBe(false);
    // Corner of the pillar is (160, 96): distance from (150, 90) is ~11.7, from (149, 89) ~13.
    expect(segmentClear(room, { x: 100, y: 60 }, { x: 149, y: 89 }, r)).toBe(true);
    expect(segmentClear(room, { x: 100, y: 60 }, { x: 150, y: 90 }, r)).toBe(false);
  });

  it("rejects segments that start or end inside walls", () => {
    expect(segmentClear(room, { x: 170, y: 120 }, { x: 250, y: 120 }, r)).toBe(false);
    expect(segmentClear(room, { x: 48, y: 48 }, { x: 170, y: 120 }, r)).toBe(false);
  });

  it("handles zero-length segments", () => {
    expect(segmentClear(room, { x: 48, y: 48 }, { x: 48, y: 48 }, r)).toBe(true);
    expect(segmentClear(room, { x: 20, y: 48 }, { x: 20, y: 48 }, r)).toBe(false);
  });

  it("squeezes through a corridor exactly as wide as the disc allows", () => {
    const corridor = asciiMap(["#####", "#...#", "#####"]);
    // One tile (32) wide: a 12-radius disc on the centre line has 4 units to spare each side.
    expect(segmentClear(corridor, { x: 48, y: 48 }, { x: 112, y: 48 }, 12)).toBe(true);
    expect(segmentClear(corridor, { x: 48, y: 54 }, { x: 112, y: 54 }, 12)).toBe(false);
    expect(segmentClear(corridor, { x: 48, y: 48 }, { x: 112, y: 48 }, 17)).toBe(false);
  });

  it("is symmetric in its endpoints", () => {
    const map = generateMap(11);
    const rng = mulberry32(4);
    for (let i = 0; i < 300; i++) {
      const a = { x: 40 + rng() * 1900, y: 40 + rng() * 1900 };
      const b = { x: a.x + (rng() - 0.5) * 300, y: a.y + (rng() - 0.5) * 300 };
      expect(segmentClear(map, a, b, 12)).toBe(segmentClear(map, b, a, 12));
    }
  });

  it("matches an exact capsule-vs-wall-rectangle test on generated maps", () => {
    const map = generateMap(3);
    const rng = mulberry32(9);
    const radii = [4, 12, 16, 20, 40];
    let checked = 0;
    for (let i = 0; i < 2500; i++) {
      const radius = radii[i % radii.length];
      const a = { x: 40 + rng() * 1940, y: 40 + rng() * 1940 };
      const b = {
        x: Math.min(2000, Math.max(40, a.x + (rng() - 0.5) * 260)),
        y: Math.min(2000, Math.max(40, a.y + (rng() - 0.5) * 260)),
      };
      const d = minWallDistance(map, a, b, radius);
      if (Math.abs(d - radius) < 1e-6) continue; // tangent: either answer is defensible
      expect(segmentClear(map, a, b, radius), `r=${radius} a=${a.x},${a.y} b=${b.x},${b.y} d=${d}`).toBe(d > radius);
      checked++;
    }
    expect(checked).toBeGreaterThan(2000);
  });
});

/** Smallest distance from segment ab to any tile `mask` blocks (as a closed rectangle; outside the map blocks). */
function minWallDistance(
  map: GameMap, a: { x: number; y: number }, b: { x: number; y: number }, reach: number, mask: number = MASK_MOVE,
): number {
  const x0 = Math.floor((Math.min(a.x, b.x) - reach - 1) / TILE);
  const x1 = Math.floor((Math.max(a.x, b.x) + reach + 1) / TILE);
  const y0 = Math.floor((Math.min(a.y, b.y) - reach - 1) / TILE);
  const y1 = Math.floor((Math.max(a.y, b.y) + reach + 1) / TILE);
  let best = Infinity;
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tx >= 0 && ty >= 0 && tx < map.w && ty < map.h && (map.tiles[ty * map.w + tx] & mask) === 0) continue;
      best = Math.min(best, segmentRectDistance(a, b, tx * TILE, ty * TILE, (tx + 1) * TILE, (ty + 1) * TILE));
    }
  }
  return best;
}

function segmentRectDistance(
  a: { x: number; y: number }, b: { x: number; y: number },
  rx0: number, ry0: number, rx1: number, ry1: number,
): number {
  // Liang-Barsky: does the segment touch the rectangle at all?
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - rx0], [dx, rx1 - a.x], [-dy, a.y - ry0], [dy, ry1 - a.y]] as const) {
    if (p === 0) {
      if (q < 0) { t0 = 2; break; }
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
  }
  if (t0 <= t1) return 0;
  const pointRect = (p: { x: number; y: number }) =>
    Math.hypot(Math.max(rx0 - p.x, 0, p.x - rx1), Math.max(ry0 - p.y, 0, p.y - ry1));
  return Math.min(
    pointRect(a), pointRect(b),
    distPointToSegment(rx0, ry0, a.x, a.y, b.x, b.y), distPointToSegment(rx1, ry0, a.x, a.y, b.x, b.y),
    distPointToSegment(rx0, ry1, a.x, a.y, b.x, b.y), distPointToSegment(rx1, ry1, a.x, a.y, b.x, b.y),
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// LOW tiles: they stop bodies (MASK_MOVE) and not eyes (MASK_SIGHT, the default of raycast and hasLineOfSight).

// The room's two-tile pillar, but LOW: tile x=5, y=3..4  ->  world x in [160, 192), y in [96, 160).
const lake = asciiMap([
  "##########",
  "#........#",
  "#........#",
  "#....~...#",
  "#....~...#",
  "#........#",
  "##########",
]);

describe("raycast and LOW tiles", () => {
  it("passes a LOW pillar by sight and hits it by movement at the face, with the exact entry point", () => {
    const sight = raycast(lake, 48, 112, 280, 112);
    expect(sight).toEqual({ hit: false, x: 280, y: 112, dist: 232 });
    expect(raycast(lake, 48, 112, 280, 112, MASK_SIGHT)).toEqual(sight);
    for (const mask of [MASK_MOVE, MASK_MELEE]) {
      const r = raycast(lake, 48, 112, 280, 112, mask);
      expect(r.hit).toBe(true);
      expect(r.x).toBe(160);
      expect(r.y).toBeCloseTo(112);
      expect(r.dist).toBeCloseTo(112);
    }
    const back = raycast(lake, 280, 112, 48, 112, MASK_MOVE);
    expect(back.hit).toBe(true);
    expect(back.x).toBe(192);
    expect(back.dist).toBeCloseTo(88);
    const down = raycast(lake, 176, 48, 176, 200, MASK_MOVE);
    expect(down.hit).toBe(true);
    expect(down.y).toBe(96);
    expect(raycast(lake, 176, 48, 176, 180).hit).toBe(false);
  });

  it("starting inside LOW: sight is not blocked, movement is, at distance 0", () => {
    expect(raycast(lake, 170, 120, 250, 120)).toEqual({ hit: false, x: 250, y: 120, dist: 80 });
    expect(raycast(lake, 170, 120, 250, 120, MASK_MOVE)).toEqual({ hit: true, x: 170, y: 120, dist: 0 });
    expect(raycast(lake, 170, 120, 170, 120, MASK_MOVE).hit).toBe(true);
    expect(raycast(lake, 170, 120, 170, 120).hit).toBe(false);
  });

  it("an exact vertex graze of a LOW corner hits by movement both ways and misses by sight", () => {
    // Through the north-west corner (160, 96), as the wall test above does.
    for (const [a, b] of [[[144, 112], [176, 80]], [[176, 80], [144, 112]]] as const) {
      const move = raycast(lake, a[0], a[1], b[0], b[1], MASK_MOVE);
      expect(move.hit).toBe(true);
      expect(move.x).toBe(160);
      expect(move.y).toBeCloseTo(96);
      expect(raycast(lake, a[0], a[1], b[0], b[1]).hit).toBe(false);
    }
  });

  describe("a diagonal pinch (two blocked tiles touching at a vertex, the ray through it)", () => {
    // Vertex (128, 96) joins tiles (3,2) NW, (4,2) NE, (3,3) SW, (4,3) SE; the ray runs NW centre to SE centre.
    const pinch = (ne: string, sw: string): GameMap => {
      const rows = ["#######", "#.....#", "#.....#", "#.....#", "#.....#", "#######"].map((r) => r.split(""));
      rows[2][4] = ne;
      rows[3][3] = sw;
      return asciiMap(rows.map((r) => r.join("")));
    };
    const ends = [[112, 80], [144, 112]] as const;
    const cast = (m: GameMap, mask?: number) => {
      const fwd = raycast(m, ends[0][0], ends[0][1], ends[1][0], ends[1][1], mask);
      const rev = raycast(m, ends[1][0], ends[1][1], ends[0][0], ends[0][1], mask);
      expect(rev.hit).toBe(fwd.hit); // symmetric
      return fwd.hit;
    };

    it("LOW + WALL blocks under both masks", () => {
      const m = pinch("~", "#");
      expect(cast(m)).toBe(true);
      expect(cast(m, MASK_MOVE)).toBe(true);
    });

    it("LOW + LOW is a sight miss and a movement hit", () => {
      const m = pinch("~", "~");
      expect(cast(m)).toBe(false);
      expect(cast(m, MASK_MOVE)).toBe(true);
    });

    it("LOW + floor is a sight miss and a movement hit (the pathfinder refuses that diagonal as well)", () => {
      const m = pinch("~", ".");
      expect(cast(m)).toBe(false);
      expect(cast(m, MASK_MOVE)).toBe(true);
      // The path from the NW centre to the SE centre must not be the diagonal hop: A* cannot cut that corner.
      const path = findPath(m, { x: 112, y: 80 }, { x: 144, y: 112 });
      expect(path.length).toBeGreaterThan(1);
    });

    it("walls only: unchanged", () => {
      const m = pinch("#", ".");
      expect(cast(m)).toBe(true);
      expect(cast(m, MASK_MOVE)).toBe(true);
    });
  });

  it("an edge-collinear ray keeps the half-open rule: it belongs to the tile on its positive side, in both directions", () => {
    // x = 160 is the west face of the LOW column (tile x=5) and the east face of tile x=4: the ray is in column 5.
    const along = raycast(lake, 160, 48, 160, 180, MASK_MOVE);
    expect(along.hit).toBe(true);
    expect(along.y).toBe(96);
    expect(raycast(lake, 160, 180, 160, 48, MASK_MOVE).hit).toBe(true);
    // x = 192 is the east face of column 5: it runs in column 6, which is floor.
    expect(raycast(lake, 192, 48, 192, 180, MASK_MOVE).hit).toBe(false);
    expect(raycast(lake, 192, 180, 192, 48, MASK_MOVE).hit).toBe(false);
    expect(raycast(lake, 160, 48, 160, 180).hit).toBe(false); // sight: LOW is not there
  });

  it("hasLineOfSight takes a mask and defaults to sight", () => {
    const a = { x: 48, y: 112 };
    const b = { x: 280, y: 112 };
    expect(hasLineOfSight(lake, a, b)).toBe(true);
    expect(hasLineOfSight(lake, a, b, MASK_SIGHT)).toBe(true);
    expect(hasLineOfSight(lake, a, b, MASK_MOVE)).toBe(false);
    expect(hasLineOfSight(lake, a, b, MASK_MELEE)).toBe(false);
    expect(hasLineOfSight(room, a, b, MASK_MELEE)).toBe(false); // a wall stops every mask
  });

  it("out of bounds blocks every mask", () => {
    for (const mask of [MASK_SIGHT, MASK_MOVE, MASK_MELEE]) {
      expect(raycast(lake, 48, 48, 48, -100, mask).hit).toBe(true);
      expect(raycast(lake, -5, 48, 100, 48, mask)).toEqual({ hit: true, x: -5, y: 48, dist: 0 });
    }
  });
});

/** Random 20x20 map with a wall border and independent WALL / LOW tiles. */
function randomLowMap(rng: () => number, size = 20, pWall = 0.12, pLow = 0.18): GameMap {
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

/** The tiles `mask` blocks, as [tx, ty] pairs. */
function blockedTiles(map: GameMap, mask: number): number[] {
  const out: number[] = [];
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) if ((map.tiles[ty * map.w + tx] & mask) !== 0) out.push(tx, ty);
  return out;
}

/**
 * Exact reference: the smallest parameter t in [0, 1] at which the segment touches a CLOSED blocked square (Liang-Barsky
 * against every blocked tile), Infinity when it touches none. A start inside a tile gives 0.
 */
function exactEntry(blocked: number[], x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let best = Infinity;
  for (let k = 0; k < blocked.length; k += 2) {
    const rx = blocked[k] * TILE;
    const ry = blocked[k + 1] * TILE;
    let t0 = 0;
    let t1 = 1;
    const clip = (p: number, q: number): boolean => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    if (clip(-dx, x0 - rx) && clip(dx, rx + TILE - x0) && clip(-dy, y0 - ry) && clip(dy, ry + TILE - y0) && t0 <= t1) best = Math.min(best, t0);
  }
  return best;
}

describe("raycast masks against an exact closed-square reference", () => {
  it("agrees on 150 random LOW maps: general-position and exact-vertex rays, both masks, symmetric, sight-hit implies move-hit", () => {
    const rng = mulberry32(99);
    const span = 20 * TILE;
    const bad: string[] = [];
    let rays = 0, moveHits = 0, sightHits = 0, lowOnly = 0;
    for (let k = 0; k < 150; k++) {
      const m = randomLowMap(rng);
      const blocked: Record<number, number[]> = { [MASK_SIGHT]: blockedTiles(m, MASK_SIGHT), [MASK_MOVE]: blockedTiles(m, MASK_MOVE) };
      const check = (x0: number, y0: number, x1: number, y1: number, tag: string): void => {
        const len = Math.hypot(x1 - x0, y1 - y0);
        const hit: Record<number, boolean> = {};
        for (const mask of [MASK_SIGHT, MASK_MOVE]) {
          const r = raycast(m, x0, y0, x1, y1, mask);
          const t = exactEntry(blocked[mask], x0, y0, x1, y1);
          rays++;
          hit[mask] = r.hit;
          if (r.hit !== t <= 1 || (r.hit && Math.abs(r.dist - t * len) > 1e-6)) {
            if (bad.length < 5) bad.push(`${tag} map ${k} mask ${mask}: (${x0},${y0})->(${x1},${y1}) dda ${JSON.stringify(r)} exact t ${t} dist ${t * len}`);
          }
          if (raycast(m, x1, y1, x0, y0, mask).hit !== r.hit && bad.length < 5) bad.push(`${tag} map ${k} mask ${mask}: asymmetric`);
        }
        if (hit[MASK_SIGHT] && !hit[MASK_MOVE] && bad.length < 5) bad.push(`${tag} map ${k}: sight blocked but movement clear`);
        if (hit[MASK_MOVE]) moveHits++;
        if (hit[MASK_SIGHT]) sightHits++;
        if (hit[MASK_MOVE] && !hit[MASK_SIGHT]) lowOnly++;
      };
      for (let i = 0; i < 200; i++) {
        const x0 = 33 + rng() * (span - 66), y0 = 33 + rng() * (span - 66);
        const x1 = 33 + rng() * (span - 66), y1 = 33 + rng() * (span - 66);
        check(x0, y0, x1, y1, "random");
      }
      // Rays that pass exactly through a tile vertex: diagonal, from 16, 48 or 80 u before it to the same after it.
      for (let i = 0; i < 100; i++) {
        const vx = (3 + Math.floor(rng() * 15)) * TILE, vy = (3 + Math.floor(rng() * 15)) * TILE;
        const d = 16 + Math.floor(rng() * 3) * TILE;
        const sx = rng() < 0.5 ? -1 : 1, sy = rng() < 0.5 ? -1 : 1;
        check(vx - sx * d, vy - sy * d, vx + sx * d, vy + sy * d, "vertex");
      }
    }
    expect(bad).toEqual([]);
    expect(rays).toBe(150 * 300 * 2);
    // The sample really exercises the new case: plenty of rays only LOW stops, and sight is blocked by walls alone.
    expect(lowOnly).toBeGreaterThan(5000);
    expect(sightHits).toBeGreaterThan(5000);
    expect(moveHits).toBeGreaterThan(sightHits);
  });
});

describe("circleClear and segmentClear on LOW maps", () => {
  it("a disc overlapping a LOW tile by any amount is not clear, a tangent one is, and MASK_SIGHT ignores LOW", () => {
    const r = 12;
    // The LOW pillar's west face is x = 160, its top face y = 96.
    expect(circleClear(lake, { x: 160 - r, y: 128 }, r)).toBe(true); // tangent
    expect(circleClear(lake, { x: 160 - r + 0.001, y: 128 }, r)).toBe(false);
    expect(circleClear(lake, { x: 176, y: 96 - r + 0.001 }, r)).toBe(false);
    expect(circleClear(lake, { x: 176, y: 128 }, r)).toBe(false); // centre inside
    expect(circleClear(lake, { x: 176, y: 128 }, 0)).toBe(false); // a point on LOW is not on floor
    expect(circleClear(lake, { x: 176, y: 128 }, r, MASK_SIGHT)).toBe(true);
    expect(circleClear(lake, { x: 176, y: 128 }, r, MASK_MOVE)).toBe(false);
    expect(circleClear(lake, { x: 176, y: 128 }, 0, MASK_SIGHT)).toBe(true);
    // Walls still stop every mask.
    expect(circleClear(lake, { x: 32 + r - 0.001, y: 80 }, r, MASK_SIGHT)).toBe(false);
  });

  it("circleClear matches an exact distance reference on random LOW maps, under the default, move and sight masks", () => {
    const rng = mulberry32(31);
    const radii = [4, 12, 16, 20, 40, 70];
    const bad: string[] = [];
    let checked = 0, clearByMove = 0, clearBySightOnly = 0;
    for (let k = 0; k < 60; k++) {
      const m = randomLowMap(rng);
      for (let i = 0; i < 80; i++) {
        const radius = radii[i % radii.length];
        const p = { x: rng() * 20 * TILE, y: rng() * 20 * TILE };
        for (const mask of [undefined, MASK_MOVE, MASK_SIGHT]) {
          const d = minWallDistance(m, p, p, radius + 1, mask ?? MASK_MOVE);
          if (Math.abs(d - radius) < 1e-6) continue;
          const ok = circleClear(m, p, radius, mask);
          checked++;
          if (ok !== d > radius && bad.length < 5) bad.push(`map ${k} mask ${mask} r=${radius} p=${p.x},${p.y} d=${d}`);
          if (mask === MASK_MOVE && ok) clearByMove++;
          if (mask === MASK_SIGHT && ok && !circleClear(m, p, radius)) clearBySightOnly++;
        }
      }
    }
    expect(bad).toEqual([]);
    expect(checked).toBeGreaterThan(10000);
    expect(clearByMove).toBeGreaterThan(300);
    expect(clearBySightOnly).toBeGreaterThan(300); // discs that only LOW blocks
  });

  it("segmentClear matches an exact capsule reference on random LOW maps, with the end discs and every ray on the same mask", () => {
    const rng = mulberry32(17);
    const radii = [4, 12, 16, 20, 40];
    const bad: string[] = [];
    let checked = 0, movedOnly = 0;
    for (let k = 0; k < 60; k++) {
      const m = randomLowMap(rng);
      for (let i = 0; i < 100; i++) {
        const radius = radii[i % radii.length];
        const a = { x: 40 + rng() * 560, y: 40 + rng() * 560 };
        const b = {
          x: Math.min(600, Math.max(40, a.x + (rng() - 0.5) * 260)),
          y: Math.min(600, Math.max(40, a.y + (rng() - 0.5) * 260)),
        };
        for (const mask of [undefined, MASK_MOVE, MASK_SIGHT]) {
          const d = minWallDistance(m, a, b, radius, mask ?? MASK_MOVE);
          if (Math.abs(d - radius) < 1e-6) continue;
          const ok = segmentClear(m, a, b, radius, mask);
          checked++;
          if (ok !== d > radius && bad.length < 5) bad.push(`map ${k} mask ${mask} r=${radius} a=${a.x},${a.y} b=${b.x},${b.y} d=${d}`);
          if (mask === MASK_SIGHT && ok && !segmentClear(m, a, b, radius)) movedOnly++;
        }
      }
    }
    expect(bad).toEqual([]);
    expect(checked).toBeGreaterThan(14000);
    expect(movedOnly).toBeGreaterThan(300);
  });

  it("a hop across a one-tile LOW strip is blocked for a body and open for a shot", () => {
    const fence = asciiMap(["#########", "#...~...#", "#...~...#", "#...~...#", "#########"]);
    const a = { x: 3 * TILE + 16, y: 2 * TILE + 16 };
    const b = { x: 5 * TILE + 16, y: 2 * TILE + 16 };
    expect(segmentClear(fence, a, b, 12)).toBe(false);
    expect(segmentClear(fence, a, b, 0)).toBe(false);
    expect(segmentClear(fence, a, b, 12, MASK_SIGHT)).toBe(true);
    expect(hasLineOfSight(fence, a, b)).toBe(true);
  });
});

// The wedge generator's maps have no LOW tiles, and gates open and locked are both walls only: every query must give
// exactly the numbers it gave before TILE_LOW and the masks existed. The hashes (FNV-1a over the 8 bytes of every result)
// were recorded from the unmodified code; they pin raycast, circleClear, segmentClear and findPath on seeds 1..5.
describe("identity golden on wall-only maps", () => {
  const f64 = new Float64Array(1);
  const bytes = new Uint8Array(f64.buffer);
  const mix = (h: number, v: number): number => {
    f64[0] = v;
    for (let i = 0; i < 8; i++) h = Math.imul(h ^ bytes[i], 16777619) >>> 0;
    return h;
  };

  function identityHashes(): { raycast: number; circle: number; segment: number; path: number } {
    let hr = 2166136261, hc = 2166136261, hs = 2166136261, hp = 2166136261;
    for (let seed = 1; seed <= 5; seed++) {
      const open = generateMap(seed);
      const maps = [open, withGates(open)];
      for (let m = 0; m < 2; m++) {
        const map = maps[m];
        const rng = mulberry32(seed * 7 + m);
        const span = map.w * TILE;
        for (let i = 0; i < 500; i++) {
          const x0 = rng() * span;
          const y0 = rng() * span;
          // One in five rays ends on a grid line, so vertex and edge cases are in the mix.
          const x1 = rng() < 0.2 ? Math.round(x0 / TILE) * TILE + TILE * Math.round((rng() - 0.5) * 10) : x0 + (rng() - 0.5) * 600;
          const y1 = rng() < 0.2 ? Math.round(y0 / TILE) * TILE + TILE * Math.round((rng() - 0.5) * 10) : y0 + (rng() - 0.5) * 600;
          const r = raycast(map, x0, y0, x1, y1);
          hr = mix(mix(mix(mix(hr, r.hit ? 1 : 0), r.x), r.y), r.dist);
          const radius = rng() < 0.5 ? 12 : rng() * 40;
          hc = mix(hc, circleClear(map, { x: x0, y: y0 }, radius) ? 1 : 0);
          const sr = rng() < 0.5 ? 12 : rng() * 30;
          hs = mix(hs, segmentClear(map, { x: x0, y: y0 }, { x: x1, y: y1 }, sr) ? 1 : 0);
          if (i % 10 === 0) {
            const path = findPath(map, { x: x0, y: y0 }, { x: x1, y: y1 });
            hp = mix(hp, path.length);
            for (const p of path) hp = mix(mix(hp, p.x), p.y);
          }
        }
      }
    }
    return { raycast: hr, circle: hc, segment: hs, path: hp };
  }

  it("gives the same 5000 raycasts, 5000 disc tests, 5000 swept tests and 500 paths as the code before LOW", () => {
    expect(identityHashes()).toEqual({ raycast: 1538573849, circle: 2048595749, segment: 1492299864, path: 3815677668 });
  });
});

import { describe, expect, it } from "vitest";
import { TILE } from "../src/constants";
import { distPointToSegment, hasLineOfSight, raycast, segmentClear } from "../src/geometry";
import { TILE_FLOOR, TILE_WALL } from "../src/map";
import type { GameMap } from "../src/map";
import { generateMap } from "../src/mapgen";
import { mulberry32 } from "../src/rng";

function asciiMap(rows: string[]): GameMap {
  const h = rows.length;
  const w = rows[0].length;
  const tiles = new Uint8Array(w * h);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) tiles[y * w + x] = row[x] === "#" ? TILE_WALL : TILE_FLOOR;
  });
  return { seed: 0, w, h, tiles, buildings: [], spawns: [], extracts: [], crateSpots: [], groundSpots: [] };
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
      let first = -1;
      for (let s = 0; s <= len; s += 0.25) {
        const t = len === 0 ? 0 : s / len;
        const tx = Math.floor((x0 + (x1 - x0) * t) / TILE);
        const ty = Math.floor((y0 + (y1 - y0) * t) / TILE);
        if (map.tiles[ty * map.w + tx] === TILE_WALL) { first = s; break; }
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

/** Smallest distance from segment ab to any wall tile (as a closed rectangle). */
function minWallDistance(map: GameMap, a: { x: number; y: number }, b: { x: number; y: number }, reach: number): number {
  const x0 = Math.floor((Math.min(a.x, b.x) - reach - 1) / TILE);
  const x1 = Math.floor((Math.max(a.x, b.x) + reach + 1) / TILE);
  const y0 = Math.floor((Math.min(a.y, b.y) - reach - 1) / TILE);
  const y1 = Math.floor((Math.max(a.y, b.y) + reach + 1) / TILE);
  let best = Infinity;
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tx >= 0 && ty >= 0 && tx < map.w && ty < map.h && map.tiles[ty * map.w + tx] !== TILE_WALL) continue;
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

// The zone borders' maths (render/zoneEdges.ts) and the camera box (render/mapCull.ts): pure, so they run on hand-built maps.
import { describe, expect, it } from "vitest";
import { REGION_FACTIONS, TILE_WALL, generateMap, isWallTile, mapFromTiles, type GameMap } from "@raid/shared";
import { cameraBox, boxesOverlap, CULL_PAD } from "../src/render/mapCull";
import { ZONE_DASH, dashSpans, zoneEdgeStrips, type EdgeStrip } from "../src/render/zoneEdges";

/** A map of all floor whose region codes come from `code(x, y)`, with the wall tiles `walls` ("x,y"). */
function mapOf(w: number, h: number, code: (x: number, y: number) => number, walls: readonly string[] = []): GameMap {
  const tiles = new Uint8Array(w * h);
  for (const key of walls) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    tiles[y * w + x] = TILE_WALL;
  }
  const map = mapFromTiles(w, h, tiles);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) map.regionGrid[y * w + x] = code(x, y);
  return map;
}

const strip = (axis: EdgeStrip["axis"], line: number, from: number, to: number, side: EdgeStrip["side"], code: number): EdgeStrip =>
  ({ axis, line, from, to, side, code });

/** The slow definition: every (tile edge, side) whose tile is see-through and whose neighbour across the edge is another zone. */
function bruteForce(map: GameMap): number {
  const zone = (c: number): boolean => c >= 1 && c <= REGION_FACTIONS.length;
  const at = (x: number, y: number): number => map.regionGrid[y * map.w + x]!;
  let n = 0;
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
        if (at(x, y) !== at(nx, ny) && zone(at(x, y)) && zone(at(nx, ny)) && !isWallTile(map, x, y)) n++;
      }
    }
  }
  return n;
}

const tilesOf = (strips: readonly EdgeStrip[]): number => strips.reduce((n, s) => n + (s.to - s.from), 0);

describe("zoneEdgeStrips", () => {
  it("gives each side of a straight border its own strip, in its own zone's code", () => {
    const map = mapOf(8, 6, (x) => (x < 4 ? 1 : 2));
    expect(zoneEdgeStrips(map)).toEqual([strip("v", 4, 0, 6, -1, 1), strip("v", 4, 0, 6, 1, 2)]);
  });

  it("runs a horizontal border the same way", () => {
    const map = mapOf(5, 8, (_x, y) => (y < 3 ? 3 : 4));
    expect(zoneEdgeStrips(map)).toEqual([strip("h", 3, 0, 5, -1, 3), strip("h", 3, 0, 5, 1, 4)]);
  });

  it("breaks a strip where its own tile is a wall, and leaves the other side whole (the wall stands over it)", () => {
    const map = mapOf(8, 6, (x) => (x < 4 ? 1 : 2), ["3,2"]);
    expect(zoneEdgeStrips(map)).toEqual([
      strip("v", 4, 0, 2, -1, 1), strip("v", 4, 3, 6, -1, 1), strip("v", 4, 0, 6, 1, 2),
    ]);
  });

  it("makes no strip against the border ring (code 0) or the coliseum (code 6)", () => {
    const ring = mapOf(8, 6, (x) => (x < 4 ? 1 : 0));
    const coliseum = mapOf(8, 6, (x) => (x < 4 ? 1 : 6));
    expect(zoneEdgeStrips(ring)).toEqual([]);
    expect(zoneEdgeStrips(coliseum)).toEqual([]);
  });

  it("follows a stepped border and merges what is collinear", () => {
    // Zone 1 above a border that steps down one tile at x = 3: a horizontal run, a vertical riser, another horizontal run.
    const map = mapOf(6, 5, (x, y) => (y < (x < 3 ? 2 : 3) ? 1 : 2));
    const strips = zoneEdgeStrips(map);
    expect(strips).toContainEqual(strip("h", 2, 0, 3, -1, 1));
    expect(strips).toContainEqual(strip("h", 2, 0, 3, 1, 2));
    expect(strips).toContainEqual(strip("h", 3, 3, 6, -1, 1));
    expect(strips).toContainEqual(strip("h", 3, 3, 6, 1, 2));
    expect(strips).toContainEqual(strip("v", 3, 2, 3, -1, 2));
    expect(strips).toContainEqual(strip("v", 3, 2, 3, 1, 1));
    expect(strips).toHaveLength(6);
  });

  it("covers exactly the tile edges the rule names, on a hand-built map and on a generated one", () => {
    const hand = mapOf(30, 20, (x, y) => 1 + ((Math.floor(x / 5) + Math.floor(y / 4) * 2) % 5), ["7,3", "8,3", "12,9", "13,10"]);
    expect(tilesOf(zoneEdgeStrips(hand))).toBe(bruteForce(hand));
    const gen = generateMap(7);
    const strips = zoneEdgeStrips(gen);
    expect(tilesOf(strips)).toBe(bruteForce(gen));
    expect(strips.length).toBeGreaterThan(20);
    // Every strip is a maximal run: no other strip of the same line, side and zone starts where it ends.
    const starts = new Set(strips.map((s) => `${s.axis}${s.line}/${s.side}/${s.code}@${s.from}`));
    for (const s of strips) {
      expect(s.to).toBeGreaterThan(s.from);
      expect(s.code).toBeGreaterThanOrEqual(1);
      expect(s.code).toBeLessThanOrEqual(REGION_FACTIONS.length);
      expect(starts.has(`${s.axis}${s.line}/${s.side}/${s.code}@${s.to}`)).toBe(false);
    }
  });

  it("is the same list for the same map", () => {
    const map = mapOf(12, 9, (x, y) => 1 + ((x + 2 * y) % 5 === 0 ? 1 : 0));
    expect(zoneEdgeStrips(map)).toEqual(zoneEdgeStrips(map));
  });
});

describe("dashSpans", () => {
  it("lays marks and gaps from the line's origin, clipped to the range", () => {
    expect(dashSpans(0, 30, [10, 5])).toEqual([[0, 10], [15, 25]]);
    expect(dashSpans(7, 31, [10, 5])).toEqual([[7, 10], [15, 25], [30, 31]]);
    expect(dashSpans(11, 14, [10, 5])).toEqual([]);
  });

  it("keeps one rhythm across strips: two pieces of a line cover what one piece would", () => {
    const whole = dashSpans(3, 90, [12, 3, 2, 3]);
    const a = dashSpans(3, 41, [12, 3, 2, 3]);
    const b = dashSpans(41, 90, [12, 3, 2, 3]);
    const join = (spans: Array<[number, number]>): number => spans.reduce((n, [from, to]) => n + (to - from), 0);
    expect(join(a) + join(b)).toBeCloseTo(join(whole), 9);
  });

  it("paints a solid line when there is no gap, and nothing for an empty range", () => {
    expect(dashSpans(0, 8, [8, 0])).toEqual([[0, 8]]);
    expect(dashSpans(5, 5, [4, 4])).toEqual([]);
    expect(dashSpans(5, 2, [4, 4])).toEqual([]);
    expect(dashSpans(0, 8, [])).toEqual([]);
  });
});

describe("ZONE_DASH", () => {
  it("gives every zone its own rhythm (a border is never told apart by hue alone), mark first", () => {
    expect(Object.keys(ZONE_DASH).sort()).toEqual([...REGION_FACTIONS].sort());
    expect(new Set(REGION_FACTIONS.map((z) => ZONE_DASH[z].join(","))).size).toBe(REGION_FACTIONS.length);
    for (const z of REGION_FACTIONS) {
      expect(ZONE_DASH[z].length % 2).toBe(0);
      expect(ZONE_DASH[z].every((v) => v > 0)).toBe(true);
    }
  });
});

describe("the camera box", () => {
  it("is the screen's share of the world at the zoom, about the camera's centre, grown by the padding", () => {
    // 800 x 600 canvas at zoom 0.5: 1600 x 1200 world pixels; scroll 100, 50 puts the top-left at 100 + (800 - 1600) / 2 = -300.
    const box = cameraBox(100, 50, 800, 600, 0.5, 0)!;
    expect(box).toEqual({ x: -300, y: 50 + (600 - 1200) / 2, w: 1600, h: 1200 });
    const padded = cameraBox(100, 50, 800, 600, 0.5)!;
    expect(padded.x).toBe(box.x - CULL_PAD);
    expect(padded.w).toBe(box.w + 2 * CULL_PAD);
  });

  it("is null while the camera has no usable size, so the caller shows everything", () => {
    expect(cameraBox(0, 0, 0, 0, 1)).toBeNull();
    expect(cameraBox(NaN, 0, 800, 600, 1)).toBeNull();
    expect(cameraBox(0, 0, 800, 600, 0)).toBeNull();
    expect(cameraBox(undefined as unknown as number, 0, 800, 600, 1)).toBeNull();
  });

  it("overlaps only where the boxes share area", () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(boxesOverlap(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(boxesOverlap(a, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
    expect(boxesOverlap(a, { x: -20, y: 2, w: 5, h: 5 })).toBe(false);
  });
});

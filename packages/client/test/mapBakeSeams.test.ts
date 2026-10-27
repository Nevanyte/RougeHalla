// render/mapBake.ts: wall rows that stack meet without a seam. A wall two or more tiles tall is one Image per tile row, and the rows
// used to show a darker line at every boundary (up to 38 levels of 255) that crawled with the camera. These tests look at pixels: a
// tiny software renderer (test/bakePixels.ts) paints the baked items with Canvas 2D's anti-aliasing and draws them as a GPU does
// (bilinear sampling, multisampling, or neither), against the unbaked rectangles of the real MapView. The browser check of the same
// is in the fix's report; this is what runs on every `npm test`.
import { describe, expect, it } from "vitest";
import { Y_SCALE, isWallTile, type GameMap } from "@raid/shared";
import {
  RectIndex, RUN_GAP, alignUnits, bakeItems, bakeMapView, clusterUnits, replayCluster, splitUnits, wallScaleFor, type Item, type Neighbours, type Source,
} from "../src/render/mapBake";
import {
  TILE, compare, composeTexels, faceBottom, faceTop, findStackedWalls, mapOf, placeItems, recordMap, rectsOf, unbakedColour, worstDifference, worstHole, type Placed,
  type View,
} from "./bakePixels";
import { fakeCanvas, fakeScene } from "./fakes";

const FILL_STYLE = (color: number, alpha = 1) => [7, color, alpha];
const FILL_RECT = (x: number, y: number, w: number, h: number) => [3, x, y, w, h];
const TOP = 0x8a9099;
const FRONT = 0x555b63;
const FLOOR = 0x2a3038;
const none: Neighbours = { below: () => [], above: () => [] };

/** What the bake did before the seam fix: the runs of each row cut on whole world pixels, the commands as MapView drew them. */
function unalignedItems(sources: readonly Source[]): Item[] {
  return sources.flatMap((src) => clusterUnits(splitUnits(src.cmds)!, RUN_GAP).map((c) => ({ region: c.region, cmds: replayCluster(c.units), depth: src.depth })));
}

describe("RectIndex", () => {
  const rect = (x: number, y: number, w: number, h: number) => [...FILL_STYLE(TOP), ...FILL_RECT(x, y, w, h)];

  it("names the parts of a width under which a rectangle of another drawing starts at a y, merged and in order", () => {
    const tops = new RectIndex("top");
    tops.add(1, rect(0, 100, 96, 26));
    tops.add(2, rect(64, 100.004, 96, 26)); // within a hundredth of a pixel
    tops.add(3, rect(500, 100, 32, 26));
    tops.add(4, rect(0, 101, 32, 26)); // another y
    expect(tops.at(0, 100, 0, 200)).toEqual([[0, 160], [500, 532]].slice(0, 1));
    expect(tops.at(0, 100, 0, 600)).toEqual([[0, 160], [500, 532]]);
    expect(tops.at(0, 100, 80, 120)).toEqual([[80, 120]]);
    expect(tops.at(0, 100, 200, 300)).toEqual([]);
    expect(tops.at(0, 102, 0, 200)).toEqual([]);
  });

  it("never answers with the drawing that asks: a row's own front face starts where its top face ends", () => {
    const tops = new RectIndex("top");
    tops.add(1, [...FILL_STYLE(FRONT), ...FILL_RECT(0, 11.6, 32, 14), ...FILL_STYLE(TOP), ...FILL_RECT(0, -14, 32, 25.6)]);
    expect(tops.at(1, 11.6, 0, 32)).toEqual([]);
    expect(tops.at(2, 11.6, 0, 32)).toEqual([[0, 32]]);
  });

  it("can index the bottom edges instead (what a drawing ends against)", () => {
    const ends = new RectIndex("bottom");
    ends.add(-1, rect(0, 74.4, 32, 25.6));
    expect(ends.at(5, 100, 0, 64)).toEqual([[0, 32]]);
    expect(ends.at(5, 74.4, 0, 64)).toEqual([]);
  });

  it("stops at a command it does not know", () => {
    const tops = new RectIndex("top");
    tops.add(1, [99, ...FILL_RECT(0, 0, 1, 1)]);
    expect(tops.at(0, 0, -5, 5)).toEqual([]);
  });
});

describe("alignUnits", () => {
  const units = (cmds: number[]) => splitUnits(cmds)!;

  it("moves every edge of a rectangle to the nearest multiple of 1/scale, at most half a texel", () => {
    const [u] = alignUnits(units([...FILL_STYLE(TOP), ...FILL_RECT(32, 24.6, 64, 25.6)]), 2, none);
    // 24.6 -> 24.5 (49.2 texels -> 49), 24.6 + 25.6 = 50.2 -> 50 (100.4 -> 100).
    expect(u!.cmds).toEqual([3, 32, 24.5, 64, 25.5]);
    expect(u!.box).toEqual({ x0: 32, y0: 24.5, x1: 96, y1: 50 });
    const [v] = alignUnits(units([...FILL_STYLE(TOP), ...FILL_RECT(0, 11.6, 32, 14)]), 1.5, none);
    expect(v!.cmds.slice(1).map((n) => n * 1.5).every((n) => Math.abs(n - Math.round(n)) < 1e-9)).toBe(true);
  });

  it("rounds a half texel the same way for the two edges that share it", () => {
    // 25.25 * 2 = 50.5 and 24.75 * 2 = 49.5 are half texels: the bottom of one rectangle and the top of the next must land on one line.
    const [a, b] = alignUnits(units([...FILL_STYLE(TOP), ...FILL_RECT(0, 0, 32, 25.25), ...FILL_RECT(0, 25.25 - 1e-12, 32, 10)]), 2, none);
    expect(a!.cmds[2]! + a!.cmds[4]!).toBe(b!.cmds[2]!);
  });

  it("adds a one texel strip under a rectangle, at the snapped bottom and over the parts a row starts under", () => {
    const [u] = alignUnits(units([...FILL_STYLE(TOP), ...FILL_RECT(0, 0, 96, 24.6)]), 2, {
      below: (y, x0, x1) => (Math.abs(y - 24.6) < 1e-9 && x0 === 0 && x1 === 96 ? [[32, 64]] : []), above: () => [],
    });
    expect(u!.cmds).toEqual([3, 0, 0, 96, 24.5, 3, 32, 24.5, 32, 0.5]);
    expect(u!.box).toEqual({ x0: 0, y0: 0, x1: 96, y1: 25 });
  });

  it("adds a one texel strip over a rectangle where something that is not baked ends against its top, if the edge was rounded away from it", () => {
    const against = (y: number) => alignUnits(units([...FILL_STYLE(TOP), ...FILL_RECT(0, y, 64, 25.6)]), 2, { below: () => [], above: (at) => (at === y ? [[0, 64]] : []) })[0]!;
    // 24.8 rounds down to 25 (a gap of 0.2 above it): the strip covers the texel before.
    expect(against(24.8).cmds).toEqual([3, 0, 25, 64, 25.5, 3, 0, 24.5, 64, 0.5]);
    expect(against(24.8).box.y0).toBe(24.5);
    // 24.6 rounds up to 24.5: it already reaches past what it meets.
    expect(against(24.6).cmds).toEqual([3, 0, 24.5, 64, 25.5]);
  });

  it("leaves a path, and anything that is not a lone rectangle, as it was", () => {
    const path = units([6, 4, 0xffffff, 1, 1, 5, 0.3, 0.3, 4, 10.7, 0.3, 9]);
    expect(alignUnits(path, 2, { below: () => [[0, 99]], above: () => [[0, 99]] })).toEqual(path);
  });
});

/** The wall one tile wide in `map` with `minRows` rows or more, its top faces of one tint, where the cluster has a front face beside it. */
function wallOf(map: GameMap, minRows: number): { tx: number; r0: number; r1: number } {
  const w = findStackedWalls(map, minRows).find((q) => {
    const codes = new Set<number>();
    for (let ty = q.r0; ty <= q.r1; ty++) codes.add(map.regionGrid[ty * map.w + q.tx]!);
    return codes.size === 1;
  });
  if (!w) throw new Error("no stacked wall of one tint");
  return w;
}

describe("wall runs of a real map", () => {
  const map = mapOf(7);
  const { walls, gates } = recordMap(map);
  const gateTiles = map.coliseum.gates.flatMap((g) => g.tiles);
  const isGate = (tx: number, ty: number): boolean => gateTiles.some((t) => t.x === tx && t.y === ty);
  const onGrid = (v: number, scale: number): boolean => Math.abs(v * scale - Math.round(v * scale)) < 1e-6;

  it.each([1, 1.5, 2, 2.5, 3])("has every rectangle edge and every run's box on the texel grid at %s texels per pixel", (scale) => {
    const { walls: items } = bakeItems(walls, scale, gates);
    expect(items.length).toBeGreaterThan(100);
    for (const it of items) {
      expect([it.region.x0, it.region.y0, it.region.x1, it.region.y1].every((v) => onGrid(v, scale))).toBe(true);
      for (const r of rectsOf(it.cmds)) {
        expect([r.x0, r.y0, r.x1, r.y1].every((v) => onGrid(v, scale))).toBe(true);
      }
    }
  });

  it.each([1.5, 2])("moves no edge by more than half a texel at %s texels per pixel", (scale) => {
    for (const src of walls) {
      const before = rectsOf(src.cmds);
      const after = alignUnits(splitUnits(src.cmds)!, scale, none).flatMap((u) => rectsOf(u.cmds));
      expect(after).toHaveLength(before.length);
      before.forEach((b, i) => {
        const a = after[i]!;
        for (const k of ["x0", "y0", "x1", "y1"] as const) expect(Math.abs(a[k] - b[k])).toBeLessThanOrEqual(0.5 / scale + 1e-9);
      });
    }
  });

  /** The tiles (by row) that the one texel strips of the items cover: [tile column, row] as "tx,ty" keys. */
  function strips(scale: number, withGates: boolean): { down: Set<string>; up: Set<string> } {
    const down = new Set<string>();
    const up = new Set<string>();
    const tex = 1 / scale;
    for (const it of bakeItems(walls, scale, withGates ? gates : []).walls) {
      for (const r of rectsOf(it.cmds)) {
        if (Math.abs(r.y1 - r.y0 - tex) > 1e-9) continue;
        for (let ty = 0; ty < map.h; ty++) {
          // A strip below a top face starts at that face's snapped bottom; one above starts a texel before its snapped top.
          const isDown = Math.abs(r.y0 - faceBottom(ty)) <= 0.5 * tex + 1e-9;
          const isUp = Math.abs(r.y1 - faceTop(ty)) <= 0.5 * tex + 1e-9;
          if (!isDown && !isUp) continue;
          for (let tx = Math.round(r.x0 / TILE); tx < Math.round(r.x1 / TILE); tx++) (isDown ? down : up).add(`${tx},${ty}`);
        }
      }
    }
    return { down, up };
  }

  it.each([1.5, 2])("extends a top face a texel into the row below exactly where that tile is a wall too, at %s texels per pixel", (scale) => {
    const expected = new Set<string>();
    for (let ty = 0; ty + 1 < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) if (isWallTile(map, tx, ty) && isWallTile(map, tx, ty + 1)) expected.add(`${tx},${ty}`);
    }
    expect(expected.size).toBeGreaterThan(300);
    const { down } = strips(scale, true);
    expect([...down].sort()).toEqual([...expected].sort());
    // So never over a front face: a tile with a wall tile under it has none, and the tiles with none under them are not in the set.
    for (const key of down) {
      const [tx, ty] = key.split(",").map(Number) as [number, number];
      expect(isWallTile(map, tx, ty + 1)).toBe(true);
    }
  });

  it.each([1.5, 2])("extends the top face under a closed gate a texel up where its edge was rounded away from the gate, at %s texels per pixel", (scale) => {
    const expected = new Set<string>();
    for (let ty = 1; ty < map.h; ty++) {
      const rounded = Math.round(faceTop(ty) * scale) / scale;
      for (let tx = 0; tx < map.w; tx++) if (isWallTile(map, tx, ty) && isGate(tx, ty - 1) && rounded > faceTop(ty) + 1e-9) expected.add(`${tx},${ty}`);
    }
    expect(expected.size).toBeGreaterThan(0);
    // An up strip ends at the top of the wall row it extends, which is filed under that row.
    expect([...strips(scale, true).up].sort()).toEqual([...expected].sort());
    // Without the gates' rows nothing is above.
    expect(strips(scale, false).up.size).toBe(0);
  });

  it("cuts a wall run too wide for a texture on texel lines, so no cut leaves a half covered texel", () => {
    const wide: Source = { depth: 32, floor: false, cmds: [...FILL_STYLE(TOP), ...FILL_RECT(0, 0, 5000, 25.6)] };
    for (const scale of [1.5, 2, 2.5]) {
      const { walls: chunks } = bakeItems([wide], scale);
      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((c, i) => {
        if (i > 0) expect(c.region.x0).toBeCloseTo(chunks[i - 1]!.region.x1, 9);
        if (i < chunks.length - 1) expect((c.region.x1 - c.region.x0) * scale).toBeCloseTo(4094, 6);
      });
    }
    // 4094 texels is what the page holds with its gutter: the frame of a chunk is that many, not one more for rounding.
    const { scene, pages } = fakeScene({ sys: { game: { renderer: {} } } });
    bakeMapView(scene, { objects: [{ type: "Graphics", visible: true, depth: 32, commandBuffer: [...wide.cmds], destroy: () => {} }] } as never, 1.5, "map", {
      makeCanvas: (w, h) => fakeCanvas(w, h) as never, now: () => 0,
    });
    expect([...pages.get("bk:map:0:w0")!.frames.values()].map((f) => f.w)).toEqual([4094, Math.round((5000 - 4094 / 1.5) * 1.5)]);
  });
});

// ----------------------------------------------------------------------------------------------------------------------- pixels

const LEVELS = 1 / 255;

describe("a stacked wall, baked and unbaked, pixel by pixel", () => {
  const map = mapOf(7);
  const { walls, gates } = recordMap(map);
  const wall = wallOf(map, 5);
  const OFFSETS = [0, 0.13, 0.29, 0.5, 0.71, 0.9];

  /** The window over the middle of the wall's tile column, from just under the first top face to just above the last one's bottom. */
  function windowOver(zoom: number, offset: number, msaa: boolean): View {
    const x0 = wall.tx * TILE + 8;
    const y0 = faceTop(wall.r0) + 6;
    const y1 = faceBottom(wall.r1) - 6;
    return { zoom, camX: x0 + offset / zoom, camY: y0 + offset / zoom, px: 0, py: 0, w: Math.ceil(16 * zoom), h: Math.ceil((y1 - y0) * zoom), msaa, floor: FLOOR };
  }

  const CONFIGS: [number, boolean][] = [[1.37, true], [2, false], [1.37, false], [2, true]];

  it.each(CONFIGS)("shows no line at the row boundaries at zoom %s (multisampling %s) at any camera phase", (zoom, msaa) => {
    const scale = wallScaleFor(zoom);
    const placed = placeItems(bakeItems(walls, scale, gates).walls, scale);
    for (const offset of OFFSETS) {
      const view = windowOver(zoom, offset, msaa);
      const r = compare(placed, walls, view);
      // Not a pixel darker, and none of the floor through: every pixel of the wall is what the unbaked wall is.
      expect(worstDifference(r.baked, r.reference, view).max).toBeLessThan(1);
      expect(worstHole(r, view).max).toBeLessThan(LEVELS / 100);
    }
  });

  it.each(CONFIGS)("did show a line before: the unaligned bake is far off at zoom %s (multisampling %s)", (zoom, msaa) => {
    const scale = wallScaleFor(zoom);
    const placed = placeItems(unalignedItems(walls), scale);
    let worst = 0;
    for (const offset of OFFSETS) {
      const view = windowOver(zoom, offset, msaa);
      const r = compare(placed, walls, view);
      worst = Math.max(worst, worstDifference(r.baked, r.reference, view).max);
    }
    expect(worst).toBeGreaterThan(15);
  });

  it("holds at the corner of a closed gate and the wall under it (the unbaked gate row against a baked row)", () => {
    // Gate tiles with a wall tile straight under the last of them.
    const spots = gateTiles(map).filter((t) => !isGateAt(map, t.x, t.y + 1) && isWallTile(map, t.x, t.y + 1));
    expect(spots.length).toBeGreaterThan(0);
    for (const [zoom, msaa] of [[1.37, true], [2, false]] as [number, boolean][]) {
      const scale = wallScaleFor(zoom);
      const aligned = placeItems(bakeItems(walls, scale, gates).walls, scale);
      const before = placeItems(unalignedItems(walls), scale);
      for (const spot of spots) {
        let worstAfter = 0;
        let worstBefore = 0;
        for (const offset of OFFSETS) {
          const edge = faceBottom(spot.y);
          const view: View = { zoom, camX: spot.x * TILE + 8 + offset / zoom, camY: edge - 6 + offset / zoom, px: 0, py: 0, w: Math.ceil(16 * zoom), h: Math.ceil(12 * zoom), msaa, floor: FLOOR };
          const near = (_i: number, j: number): boolean => Math.abs(view.camY + (j + 0.5) / zoom - edge) * zoom <= 2;
          worstAfter = Math.max(worstAfter, worstHole(compare(aligned, [...walls, ...gates], view, gates), view, near).max);
          worstBefore = Math.max(worstBefore, worstHole(compare(before, [...walls, ...gates], view, gates), view, near).max);
        }
        expect(worstAfter).toBeLessThan(LEVELS / 100);
        expect(worstBefore).toBeGreaterThan(0.1);
      }
    }
  });
});

const gateTiles = (map: GameMap): { x: number; y: number }[] => map.coliseum.gates.flatMap((g) => g.tiles);
const isGateAt = (map: GameMap, x: number, y: number): boolean => gateTiles(map).some((t) => t.x === x && t.y === y);

describe("every boundary of a stacked wall, texel by texel", () => {
  const map = mapOf(7);
  const { walls, gates } = recordMap(map);

  it.each([1.5, 2])("is fully opaque and the colour of the unbaked wall, and both rows are opaque there, at %s texels per pixel", (scale) => {
    const items = bakeItems(walls, scale, gates).walls;
    const painted = new Map<Item, Placed>();
    const paint = (it: Item): Placed => painted.get(it) ?? painted.set(it, placeItems([it], scale)[0]!).get(it)!;
    // Every 7th tile with a wall under it, over the whole map: boundaries between rows of any tint, any cluster.
    let checked = 0;
    let n = 0;
    for (let ty = 0; ty + 1 < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        if (!isWallTile(map, tx, ty) || !isWallTile(map, tx, ty + 1) || n++ % 7 !== 0) continue;
        const x0 = tx * TILE;
        const edge = Math.round(faceBottom(ty) * scale) / scale; // the boundary, on the grid
        // The items over the tile and the boundary (two when a cut of a wide row runs through the tile).
        const near = items.filter((it) => it.region.x0 < x0 + TILE && it.region.x1 > x0 && it.region.y0 <= edge + 1 && it.region.y1 >= edge - 1);
        const placed = near.map(paint);
        const w = TILE * scale;
        const texels = composeTexels(placed, x0, edge - 1 / scale, w, 2, scale);
        for (let j = 0; j < 2; j++) {
          for (let i = 0; i < w; i++) {
            const k = (j * w + i) * 4;
            expect(texels[k + 3]).toBeCloseTo(1, 9);
            const colour = unbakedColour(walls, x0 + (i + 0.5) / scale, edge + (j - 0.5) / scale, FLOOR);
            expect([texels[k]! * 255, texels[k + 1]! * 255, texels[k + 2]! * 255].map(Math.round)).toEqual([(colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff]);
          }
        }
        // Each row's own texels are opaque across the boundary too (the upper one into the strip, the lower one from its first texel):
        // so neither the bilinear filter nor a multisampled quad edge can show anything but wall.
        const upper = near.filter((it) => it.region.y1 > edge + 0.5 / scale && it.region.y0 < edge - 1);
        const lower = near.filter((it) => Math.abs(it.region.y0 - edge) < 1e-9 || (it.region.y0 < edge && it.region.y0 > edge - 1.5 / scale));
        for (let i = 0; i < w; i++) {
          const x = x0 + (i + 0.5) / scale;
          for (const rows of [upper, lower]) {
            const opaque = rows.some((it) => {
              if (x < it.region.x0 || x >= it.region.x1) return false;
              const t = paint(it).texels;
              const j = Math.round((edge - t.y0) * scale); // the texel row that starts at the boundary
              return Math.abs(t.data[(j * t.w + Math.round((x - 0.5 / scale - t.x0) * scale)) * 4 + 3]! - 1) < 1e-9;
            });
            expect(opaque).toBe(true);
          }
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(40);
  });
});

describe("a top face whose cluster has a front face beside it", () => {
  // Row 0: a wall tile with a wall under it (tile 0) and one with none (tile 1, a front face), so the run's frame reaches below the
  // first tile's top face: its lower edge is interior to the frame, where the filter ramps the alpha to zero. Row 1 is under tile 0.
  const sources: Source[] = [
    { depth: 32, floor: false, cmds: [...FILL_STYLE(FRONT), ...FILL_RECT(32, faceBottom(0), 32, 14), ...FILL_STYLE(TOP), ...FILL_RECT(0, faceTop(0), 64, TILE * Y_SCALE)] },
    { depth: 64, floor: false, cmds: [...FILL_STYLE(FRONT), ...FILL_RECT(0, faceBottom(1), 32, 14), ...FILL_STYLE(TOP), ...FILL_RECT(0, faceTop(1), 32, TILE * Y_SCALE)] },
  ];

  const worst = (items: Item[], scale: number, zoom: number, msaa: boolean): number => {
    const placed = placeItems(items, scale);
    let worstHoleSeen = 0;
    for (const offset of [0, 0.13, 0.29, 0.5, 0.71, 0.9]) {
      const view: View = { zoom, camX: 8 + offset / zoom, camY: faceBottom(0) - 6 + offset / zoom, px: 0, py: 0, w: Math.ceil(16 * zoom), h: Math.ceil(12 * zoom), msaa, floor: FLOOR };
      worstHoleSeen = Math.max(worstHoleSeen, worstHole(compare(placed, sources, view), view).max);
    }
    return worstHoleSeen;
  };

  it.each([[1.37, true], [2, false], [1.37, false], [2, true]] as [number, boolean][])("needs the strip, and has no seam with it, at zoom %s (multisampling %s)", (zoom, msaa) => {
    const scale = wallScaleFor(zoom);
    const full = bakeItems(sources, scale).walls;
    // Snapped to the texel grid but not extended: the interior edge still ramps.
    const snapped = sources.flatMap((src) => clusterUnits(alignUnits(splitUnits(src.cmds)!, scale, none), RUN_GAP, scale).map((c) => ({ region: c.region, cmds: replayCluster(c.units), depth: src.depth })));
    expect(worst(full, scale, zoom, msaa)).toBeLessThan(LEVELS / 100);
    expect(worst(snapped, scale, zoom, msaa)).toBeGreaterThan(0.05);
    expect(worst(unalignedItems(sources), scale, zoom, msaa)).toBeGreaterThan(0.05);
  });
});

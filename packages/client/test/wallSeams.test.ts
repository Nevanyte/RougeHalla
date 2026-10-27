// The baked walls have no seam at a tile row boundary (render/zoneArt/bake.ts, "seams"). A wall several rows tall is one strip per row,
// and each tile's top face used to be a rectangle at a fractional y (TILE_H is 25.6), so the two strips anti-aliased the boundary
// texel separately and left a line of floor through it, 9-25 levels darker than the wall top, baked into the texture. These tests look
// at pixels: test/wallRaster.ts paints the strips bake.ts paints (the real paintStrip, on a pen that keeps the shapes) into texels
// the two ways a texture can be filled (Canvas-style coverage, and a GPU's aliased fill) and lays the Images over each other as a
// GPU does at a fractional camera zoom (bilinear, with and without multisampling). A control paints the same walls the way the bake
// did before the fix, to show the check can see the seam.
import { describe, expect, it } from "vitest";
import { REGION_FACTIONS, REGION_IDS, TILE, TILE_FLOOR, TILE_WALL, mapFromTiles, type GameMap } from "@raid/shared";
import { SnapPen, makeContext, paintStrip, planStrips, wallInfoAt, type BakeContext } from "../src/render/zoneArt/bake";
import { MapView } from "../src/render/MapView";
import { ZONE_PALETTE } from "../src/render/zoneArt/palette";
import { TILE_H, TILE_W, drawWallTile, hashTile, type Pen, type TileSpot } from "../src/render/zoneArt/zoneStyle";
import { fakeObject, fakeScene, type FakeObject } from "./fakes";
import { RecordPen } from "./recordPen";
import { ShapePen, overFloor, paintFrame, renderPremult, worstHole, type Layer, type LooseRect, type PaintMode, type Shape, type View } from "./wallRaster";

type Zone = (typeof REGION_FACTIONS)[number];
type Rect = readonly [x: number, y: number, w: number, h: number];

/** A w x h floor with `walls` of one zone; `gates` are floor tiles that the map names as the coliseum's gate. */
function wallMap(zone: Zone, walls: readonly Rect[], gates: ReadonlyArray<{ x: number; y: number }> = [], w = 24, h = 20): GameMap {
  const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
  for (const [x0, y0, rw, rh] of walls) for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) tiles[y * w + x] = TILE_WALL;
  for (const t of gates) tiles[t.y * w + t.x] = TILE_FLOOR;
  const map = mapFromTiles(w, h, tiles, 3);
  map.regionGrid.fill(REGION_IDS.indexOf(zone));
  if (gates.length > 0) map.coliseum.gates = [{ side: "w", tiles: gates.map((t) => ({ ...t })), x: 0, y: 0 }];
  return map;
}

/** The baked Images of every strip of a map, painted the way a texture is filled in `mode`. */
function bakedLayers(map: GameMap, mode: PaintMode, paint: (pen: ShapePen, ctx: BakeContext, s: ReturnType<typeof planStrips>["strips"][number]) => void = paintStrip): Layer[] {
  const ctx = makeContext(map);
  return planStrips(map).strips.map((s) => {
    const pen = new ShapePen();
    paint(pen, ctx, s);
    return { depth: s.depth, frame: { x: s.x, y: s.y, w: s.w, h: s.h, data: paintFrame(pen.shapes, s.px, s.py, s.w, s.h, mode) } };
  });
}

/** What paintStrip did for a wall tile before the fix: the art as the zone style draws it, at the fractional y. */
function paintUnsnapped(pen: Pen, ctx: BakeContext, s: ReturnType<typeof planStrips>["strips"][number]): void {
  const spot: TileSpot = { x: 0, y: s.py + s.oy, tx: 0, ty: s.ty, hash: 0, open: 0 };
  for (let tx = s.tx0; tx <= s.tx1; tx++) {
    const i = s.ty * ctx.map.w + tx;
    if (ctx.map.tiles[i] !== TILE_WALL) continue;
    const info = wallInfoAt(ctx, tx, s.ty);
    spot.x = s.px + (tx - s.tx0) * TILE_W;
    spot.tx = tx;
    spot.hash = hashTile(tx, s.ty, ctx.map.seed);
    spot.open = info.open;
    drawWallTile(pen, ctx.zones[i] ?? "sentenced", spot, info);
  }
}

/** The window of the world [x0, x1) x [y0, y1) on a screen at `zoom`, the camera `phase` screen pixels off the pixel grid. */
function windowOver(x0: number, y0: number, x1: number, y1: number, zoom: number, phase: number, msaa: boolean): View {
  return { zoom, camX: x0 + phase / zoom, camY: y0 + phase / zoom, w: Math.floor((x1 - x0) * zoom) - 2, h: Math.floor((y1 - y0) * zoom) - 2, msaa };
}

const PHASES = [0, 0.13, 0.29, 0.5, 0.71, 0.9];
const CONFIGS: ReadonlyArray<readonly [zoom: number, msaa: boolean]> = [[1.37, true], [1.37, false], [2, true], [2, false]];
const MODES: readonly PaintMode[] = ["area", "centre"];
const HOLE = 1 / 255 / 4;

const channels = (c: number): number[] => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];

/** A stack of wall tiles whose top faces meet inside it: 1 x 4 is a run of single stones (a segment), 3 x 3 a mass. */
const STACKS: Record<string, Rect> = { "1 x 4": [4, 3, 1, 4], "3 x 3": [9, 3, 3, 3] };

/** The world rectangle inside a stack's top faces, clear of the rim at its top, its rounded corners and its bottom edge. */
function stackWindow(map: GameMap, [tx, ty, w, h]: Rect): { x0: number; y0: number; x1: number; y1: number; lift: number } {
  const lift = wallInfoAt(makeContext(map), tx, ty).lift;
  return { x0: tx * TILE + 8, x1: (tx + w) * TILE - 8, y0: ty * TILE_H - lift + 3, y1: (ty + h) * TILE_H - lift - 3, lift };
}

describe.each(REGION_FACTIONS)("a stacked %s wall, pixel by pixel", (zone) => {
  const top = ZONE_PALETTE[zone].wallTop;
  // Frost's top face has a dark facet across it (a diagonal, on purpose): there the check is that nothing shows through.
  const flat = zone !== "frost";

  it.each(Object.entries(STACKS))("is the wall top all the way down a %s stack, with no floor through a row boundary, at any camera phase", (_name, stack) => {
    const map = wallMap(zone, [stack]);
    const win = stackWindow(map, stack);
    for (const mode of MODES) {
      const layers = bakedLayers(map, mode);
      for (const [zoom, msaa] of CONFIGS) {
        for (const phase of PHASES) {
          const view = windowOver(win.x0, win.y0, win.x1, win.y1, zoom, phase, msaa);
          const picture = renderPremult(layers, view);
          const why = `${mode} fill, zoom ${zoom}, multisampling ${msaa}, phase ${phase}`;
          expect(worstHole(picture), why).toBeLessThan(HOLE);
          if (!flat) continue;
          const rgb = overFloor(picture, 0x101418);
          let worst = 0;
          for (let k = 0; k < rgb.length; k += 3) for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(rgb[k + c]! - channels(top)[c]!));
          expect(worst, why).toBeLessThan(1.5);
        }
      }
    }
  });

  it("showed a line at the boundary before the fix: the unsnapped drawing leaves floor through it (the control)", () => {
    const map = wallMap(zone, [STACKS["3 x 3"]!]);
    const win = stackWindow(map, STACKS["3 x 3"]!);
    for (const mode of MODES) {
      const layers = bakedLayers(map, mode, paintUnsnapped);
      let worst = 0;
      for (const [zoom, msaa] of CONFIGS) {
        for (const phase of PHASES) worst = Math.max(worst, worstHole(renderPremult(layers, windowOver(win.x0, win.y0, win.x1, win.y1, zoom, phase, msaa))));
      }
      expect(worst, `${mode} fill`).toBeGreaterThan(0.1);
    }
  });
});

describe("the edges of a stack, as the bake paints them", () => {
  /** The shapes of every strip of a map in world coordinates, by tile row. */
  function shapesByRow(map: GameMap): Map<number, Shape[]> {
    const ctx = makeContext(map);
    const out = new Map<number, Shape[]>();
    for (const s of planStrips(map).strips) {
      const pen = new ShapePen();
      paintStrip(pen, ctx, s);
      const world = pen.shapes.map((sh): Shape => ({ ...sh, poly: sh.poly.map(([x, y]) => [x - s.px + s.x, y - s.py + s.y] as const) }));
      out.set(s.ty, [...(out.get(s.ty) ?? []), ...world]);
    }
    return out;
  }
  const box = (sh: Shape): [number, number, number, number] => {
    const xs = sh.poly.map((p) => p[0]), ys = sh.poly.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };

  it.each(REGION_FACTIONS.map((z) => [z] as const))("puts every edge of a %s stack's tiles on a texel line", (zone) => {
    const map = wallMap(zone, Object.values(STACKS));
    const rows = shapesByRow(map);
    for (const [tx, ty, w, h] of Object.values(STACKS)) {
      for (let r = ty; r < ty + h; r++) {
        for (const sh of rows.get(r)!) {
          const [x0, y0, x1, y1] = box(sh);
          if (x1 <= tx * TILE || x0 >= (tx + w) * TILE) continue;
          for (const v of [y0, y1]) expect(Math.abs(v - Math.round(v)), `row ${r}: ${JSON.stringify(sh.poly)}`).toBeLessThan(1e-9);
        }
      }
    }
  });

  it.each(REGION_FACTIONS.map((z) => [z] as const))("meets each top face at the next one's line and reaches one texel into a wall row, never a front face, in %s", (zone) => {
    const map = wallMap(zone, Object.values(STACKS));
    const ctx = makeContext(map);
    const rows = shapesByRow(map);
    const wallTop = ZONE_PALETTE[zone].wallTop;
    for (const [tx, ty, w, h] of Object.values(STACKS)) {
      for (let c = tx; c < tx + w; c++) {
        // The tile's top face: the tall rectangle of the top colour; its extension: the one texel high one.
        const inTile = (r: number): Shape[] => rows.get(r)!.filter((sh) => box(sh)[0] >= c * TILE - 1e-9 && box(sh)[2] <= (c + 1) * TILE + 1e-9);
        const faceOf = (r: number): [number, number, number, number] | undefined =>
          inTile(r).map(box).filter(([x0, y0, x1, y1]) => x1 - x0 === TILE && y1 - y0 >= 24)[0];
        const strips = (r: number): Array<[number, number, number, number]> =>
          inTile(r).filter((sh) => sh.color === wallTop && sh.alpha === 1).map(box).filter(([x0, y0, x1, y1]) => x1 - x0 === TILE && y1 - y0 === 1);
        const lift = wallInfoAt(ctx, c, ty).lift;
        for (let r = ty; r < ty + h; r++) {
          const face = faceOf(r);
          expect(face, `tile ${c},${r} has a top face`).toBeDefined();
          expect(face![1]).toBe(Math.round(r * TILE_H - lift));
          expect(face![3]).toBe(Math.round((r + 1) * TILE_H - lift));
          if (r + 1 < ty + h) {
            // A wall row under it: it starts on the line this one ends at, and this one reaches a texel into it.
            expect(faceOf(r + 1)![1]).toBe(face![3]);
            expect(strips(r), `tile ${c},${r}`).toEqual([[c * TILE, face![3], (c + 1) * TILE, face![3] + 1]]);
          } else {
            // The last row has the front face under it: nothing of the top colour is there.
            expect(strips(r), `tile ${c},${r}`).toEqual([]);
            expect(wallInfoAt(ctx, c, r).front).toBe(true);
          }
        }
      }
    }
  });
});

describe("SnapPen", () => {
  const rounded = (draw: (g: SnapPen) => void): RecordPen => {
    const rec = new RecordPen();
    draw(new SnapPen(rec));
    return rec;
  };

  it("rounds the EDGES of a rectangle, not its size, so a bottom and the next top that are one line stay one line", () => {
    const rec = rounded((g) => g.fillRect(32, 11.6, 32, 25.6).fillRect(32, 11.6 + 25.6, 32, 25.6));
    expect(rec.of("fillRect")).toEqual([[32, 12, 32, 25], [32, 37, 32, 26]]);
    expect(rounded((g) => g.fillRoundedRect(0, 11.6, 32, 25.6, 6)).of("fillRect")).toEqual([[0, 12, 32, 25]]);
  });

  it("rounds the corners of a triangle and of a filled path, and leaves a stroked path as it was", () => {
    const tri = rounded((g) => g.fillTriangle(0, 11.6, 32, 37.2, 0, 37.2));
    expect(tri.of("fillTriangle")).toEqual([[0, 12, 32, 37, 0, 37]]);
    const filled = rounded((g) => g.beginPath().moveTo(1, 11.6).lineTo(31, 11.6).lineTo(32, 12.6).closePath().fillPath());
    expect(filled.of("moveTo")).toEqual([[1, 12]]);
    expect(filled.of("lineTo")).toEqual([[31, 12], [32, 13]]);
    expect(filled.count("closePath")).toBe(1);
    expect(filled.ops.map((o) => o.name)).toEqual(["beginPath", "moveTo", "lineTo", "lineTo", "closePath", "fillPath"]);
    const stroked = rounded((g) => g.beginPath().moveTo(1, 11.6).lineTo(31, 12.4).strokePath());
    expect(stroked.of("moveTo")).toEqual([[1, 11.6]]);
    expect(stroked.of("lineTo")).toEqual([[31, 12.4]]);
  });

  it("keeps a one pixel rim half a texel inside the row its face's top edge rounds to, and passes every other line as it was", () => {
    const rim = rounded((g) => g.lineStyle(1, 0xffffff, 0.5).lineBetween(2, 11.6 + 0.5, 30, 11.6 + 0.5));
    expect(rim.of("lineBetween")).toEqual([[2, 12.5, 30, 12.5]]);
    const crack = rounded((g) => g.lineStyle(1.2, 0xffffff, 0.5).lineBetween(2, 11.6, 30, 11.6).lineStyle(1, 0xffffff).lineBetween(2, 3.2, 9, 8.8));
    expect(crack.of("lineBetween")).toEqual([[2, 11.6, 30, 11.6], [2, 3.2, 9, 8.8]]);
  });

  it("passes the style, circles, ellipses and rectangle outlines on", () => {
    const rec = rounded((g) => g.fillStyle(0xabcdef, 0.4).fillCircle(5.5, 6.5, 3).fillEllipse(1.5, 2.5, 4, 5).strokeRect(0.5, 0.5, 3, 3));
    expect(rec.ops.map((o) => [o.name, ...o.args])).toEqual([
      ["fillStyle", 0xabcdef, 0.4], ["fillCircle", 5.5, 6.5, 3], ["fillEllipse", 1.5, 2.5, 4, 5], ["strokeRect", 0.5, 0.5, 3, 3],
    ]);
  });
});

describe("what does not stack is drawn as before", () => {
  it("paints a lone rock exactly as the zone style draws it", () => {
    const map = wallMap("fire", [[5, 5, 1, 1]]);
    const ctx = makeContext(map);
    const strip = planStrips(map).strips.find((s) => s.ty === 5)!;
    const actual = new RecordPen();
    paintStrip(actual, ctx, strip);
    const expected = new RecordPen();
    paintUnsnapped(expected, ctx, strip);
    expect(wallInfoAt(ctx, 5, 5).style).toBe("rock");
    expect(actual.signature()).toBe(expected.signature());
  });
});

// ------------------------------------------------------------------------------------------------------------------ the gate

/** The closed gates' rows MapView draws for a map (it draws them hidden until the coliseum locks), as exact rectangles. */
function gateRows(map: GameMap): Layer[] {
  const f = fakeScene();
  const events = fakeObject("events");
  new MapView({ ...(f.scene as object), events } as never, map);
  const rows: Layer[] = [];
  for (const g of f.ofKind("graphics") as FakeObject[]) {
    if (g.state.visible !== false || (g.state.depth as number) < 0) continue;
    let colour = 0;
    const rects: LooseRect[] = [];
    for (const [name, a] of g.calls) {
      if (name === "fillStyle") colour = a[0] as number;
      else if (name === "fillRect") {
        const [x, y, w, h] = a as number[];
        rects.push({ x0: x!, y0: y!, x1: x! + w!, y1: y! + h!, color: colour, alpha: 1 });
      }
    }
    rows.push({ depth: g.state.depth as number, rects });
  }
  return rows;
}

describe("a closed gate against the walls above and below it", () => {
  // A wall two tiles wide with a gate in it (the gate tiles are floor in the map; MapView draws them as a wall row at the exact y
  // when the coliseum locks). Over gate rows 3 to 12 the line the wall above ends at and the one the wall below starts at fall on
  // every fraction of a texel the rows have, so the rounding goes up and down at both. The camera is at zoom 1 on the pixel grid, so
  // the texture filter does nothing and what is left to see is the rounding: a texel row covered by neither the wall nor the gate,
  // or the front face of the wall above showing between its top face and the gate's. (At a fractional zoom the filter ramps the edge
  // of every strip against whatever lies beside it, a gate or the floor alike; that is not what rounding does.)
  const wall: Rect = [8, 1, 2, 17];
  const lum = (c: number): number => channels(c).reduce((a, b) => a + b, 0);
  const ROWS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const ON_GRID: ReadonlyArray<readonly [zoom: number, msaa: boolean]> = [[1, true], [1, false]];

  /** The pictures of the lines at the top and the bottom of gate row g with the wall baked as `paint` says, as holes and darkest sums. */
  function seen(g: number, paint: Parameters<typeof bakedLayers>[2], mode: PaintMode, msaa: boolean): Array<{ line: number; hole: number; darkest: number }> {
    const map = wallMap("sentenced", [wall], [{ x: 8, y: g }, { x: 9, y: g }]);
    const layers = [...bakedLayers(map, mode, paint), ...gateRows(map)];
    const lift = wallInfoAt(makeContext(map), 8, g - 1).lift;
    return [g * TILE_H - lift, (g + 1) * TILE_H - lift].map((line) => {
      const picture = renderPremult(layers, windowOver(8 * TILE + 8, line - 3, 10 * TILE - 8, line + 3, 1, 0, msaa));
      const rgb = overFloor(picture, 0x000000);
      let darkest = Infinity;
      for (let k = 0; k < rgb.length; k += 3) darkest = Math.min(darkest, rgb[k]! + rgb[k + 1]! + rgb[k + 2]!);
      return { line, hole: worstHole(picture), darkest };
    });
  }

  /** The bake with its rounding alone: every edge snapped, none of the strips that cover what rounding opens. */
  const roundingOnly: Parameters<typeof bakedLayers>[2] = (pen, ctx, s) => {
    const spot: TileSpot = { x: 0, y: s.py + s.oy, tx: 0, ty: s.ty, hash: 0, open: 0 };
    const snapped = new SnapPen(pen);
    for (let tx = s.tx0; tx <= s.tx1; tx++) {
      const info = wallInfoAt(ctx, tx, s.ty);
      spot.x = s.px + (tx - s.tx0) * TILE_W;
      spot.tx = tx;
      spot.open = info.open;
      drawWallTile(snapped, "sentenced", spot, info);
    }
  };

  const gateTop = (g: number): number => {
    const rows = gateRows(wallMap("sentenced", [wall], [{ x: 8, y: g }, { x: 9, y: g }]));
    return rows[0]!.rects![rows[0]!.rects!.length - 1]!.color;
  };

  it.each(ROWS)("leaves neither floor nor a dark line between gate row %i and the wall above or below", (g) => {
    expect(gateRows(wallMap("sentenced", [wall], [{ x: 8, y: g }, { x: 9, y: g }]))).toHaveLength(1);
    const dimmest = Math.min(lum(gateTop(g)), lum(ZONE_PALETTE.sentenced.wallTop));
    for (const mode of MODES) {
      for (const [, msaa] of ON_GRID) {
        for (const { line, hole, darkest } of seen(g, paintStrip, mode, msaa)) {
          const why = `row ${g}, line ${line.toFixed(1)}, ${mode} fill, multisampling ${msaa}`;
          expect(hole, why).toBeLessThan(HOLE);
          expect(darkest, why).toBeGreaterThan(dimmest - 3);
        }
      }
    }
  });

  it("needs its strips: with the rounding alone, a gap or a dark line shows on some of those rows, at both kinds of rounding", () => {
    const flaws = ROWS.flatMap((g) => seen(g, roundingOnly, "area", true).map((r) => ({ g, ...r, dark: r.darkest < Math.min(lum(gateTop(g)), lum(ZONE_PALETTE.sentenced.wallTop)) - 3 })));
    // The wall above ends at the gate's top line (rounded down: the front face shows) and the wall below starts at the gate's bottom
    // line (rounded up: floor shows).
    expect(flaws.some((r) => r.dark)).toBe(true);
    expect(flaws.some((r) => r.hole > 0.1)).toBe(true);
  });

  it("showed floor and a dark line before the fix too, on the rows where nothing rounds away", () => {
    const worst = ROWS.map((g) => {
      const map = wallMap("sentenced", [wall], [{ x: 8, y: g }, { x: 9, y: g }]);
      const layers = [...bakedLayers(map, "area", paintUnsnapped), ...gateRows(map)];
      const lift = wallInfoAt(makeContext(map), 8, g - 1).lift;
      return Math.max(...[g * TILE_H - lift, (g + 1) * TILE_H - lift].map((line) => worstHole(renderPremult(layers, windowOver(8 * TILE + 8, line - 3, 10 * TILE - 8, line + 3, 1, 0, true)))));
    });
    expect(Math.max(...worst)).toBeGreaterThan(0.1);
  });
});

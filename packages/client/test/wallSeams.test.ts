// The baked walls have no seam at a tile row boundary, at a chunk join or under a mass that stands over a lower wall (render/zoneArt/
// bake.ts, "seams"). A wall several rows tall is one strip per row, and each tile's top face used to be a rectangle at a fractional y
// (TILE_H is 25.6), so the two strips anti-aliased the boundary texel separately and left a line of floor through it, 9-25 levels
// darker than the wall top, baked into the texture. A wall wider than a chunk is one strip per chunk column, and the two Images
// abutted at an integer x, where the texels at their edges blend with the empty page padding: up to half the floor showed through
// at tile columns 15|16, 31|32 and so on. And a frost mass directly north of a shard left the 4 px between its top face and the
// shard's showing the floor. These tests look at pixels: test/wallRaster.ts paints the strips bake.ts paints (the real paintStrip, on
// a pen that keeps the shapes) into texels the two ways a texture can be filled (Canvas-style coverage, and a GPU's aliased fill) and
// lays the Images over each other as a GPU does at a fractional camera zoom (bilinear, with and without multisampling). Controls
// paint the same walls the way the bake did before each fix, to show the check can see the seam.
import { describe, expect, it } from "vitest";
import { REGION_FACTIONS, REGION_IDS, TERRAIN_FENCE, TERRAIN_LAVA, TILE, TILE_FLOOR, TILE_LOW, TILE_WALL, mapFromTiles, type FeatureKind, type GameMap } from "@raid/shared";
import { CHUNK_TILES, ClipPen, SnapPen, makeContext, paintStrip, planStrips, wallInfoAt, wallJoinsEast, type BakeContext } from "../src/render/zoneArt/bake";
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
          if (sh.line) continue; // a rim or a drip is a detail: only a horizontal one-pixel rim is moved, to the middle of a texel row
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

// ------------------------------------------------------------------------------------------------------------------ chunk joins

type StripOf = ReturnType<typeof planStrips>["strips"][number];

/** The texels of a strip's frame, painted the way a texture is filled in `mode`. */
function frameOf(map: GameMap, s: StripOf, mode: PaintMode, ctx: BakeContext = makeContext(map)): Float64Array {
  const pen = new ShapePen();
  paintStrip(pen, ctx, s);
  return paintFrame(pen.shapes, s.px, s.py, s.w, s.h, mode);
}

/** A texel of a frame: its premultiplied RGBA. */
const texel = (frame: Float64Array, w: number, col: number, row: number): number[] => [0, 1, 2, 3].map((c) => frame[(row * w + col) * 4 + c]!);

/** `map` with the tiles of `rect` put in `zone`. */
function inZone(map: GameMap, [x0, y0, rw, rh]: Rect, zone: Zone): GameMap {
  for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) map.regionGrid[y * map.w + x] = REGION_IDS.indexOf(zone);
  return map;
}

/** The zoom and multisampling of a camera: the default zoom is 1, and the owner's window sits at 0.89 to 2. */
const JOIN_CONFIGS: ReadonlyArray<readonly [zoom: number, msaa: boolean]> = [[0.89, true], [0.89, false], ...CONFIGS];

/** Walls over the chunk edges at tile columns 16 and 32: a 3 x 3 block (a mass) and a run of 4 stones (a segment) across each. */
const JOINS: ReadonlyArray<{ name: string; rect: Rect; edge: number }> = [
  { name: "a 3 x 3 block over the 15|16 edge", rect: [14, 3, 3, 3], edge: 16 },
  { name: "a 3 x 3 block over the 31|32 edge", rect: [30, 3, 3, 3], edge: 32 },
  { name: "a run of 4 stones over the 15|16 edge", rect: [14, 10, 4, 1], edge: 16 },
  { name: "a run of 4 stones over the 31|32 edge", rect: [30, 10, 4, 1], edge: 32 },
];

/** The world rectangle around the join of a wall over a chunk edge, inside its top faces or inside its last front face. */
function joinWindow(map: GameMap, [, ty, , h]: Rect, edge: number, part: "top" | "front"): { x0: number; y0: number; x1: number; y1: number } {
  const lift = wallInfoAt(makeContext(map), edge - 1, ty).lift;
  const frontTop = (ty + h) * TILE_H - lift;
  const x0 = edge * TILE - 20, x1 = edge * TILE + 20;
  return part === "top" ? { x0, x1, y0: ty * TILE_H - lift + 3, y1: frontTop - 3 } : { x0, x1, y0: frontTop + 2, y1: (ty + h) * TILE_H - 2 };
}

describe.each(REGION_FACTIONS)("a %s wall across a chunk edge, pixel by pixel", (zone) => {
  const map = wallMap(zone, JOINS.map((j) => j.rect), [], 48, 16);
  const top = ZONE_PALETTE[zone].wallTop;
  // Frost's top face has a dark facet across it (a diagonal, on purpose): there the check is that nothing shows through.
  const flat = zone !== "frost";
  const cases = JOINS.flatMap((j) => (["top", "front"] as const).map((part) => [`${j.name}: its ${part} face`, j, part] as const));

  it("plans a strip that reaches one texel past the edge for each row of each join, two texels wider, and no other", () => {
    const { strips } = planStrips(map);
    const east = strips.filter((s) => s.east);
    // 3 rows of the block and 1 of the run, at both edges.
    expect(east.map((s) => [s.ty, s.tx1]).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!)).toEqual([[3, 15], [3, 31], [4, 15], [4, 31], [5, 15], [5, 31], [10, 15], [10, 31]]);
    for (const s of strips) expect(s.w, `row ${s.ty}, tiles ${s.tx0}-${s.tx1}`).toBe((s.tx1 - s.tx0 + 1) * TILE + (s.east ? 2 : 0));
  });

  it.each(cases)("is opaque, and the wall's own colour, at the join: %s", (_name, j, part) => {
    const win = joinWindow(map, j.rect, j.edge, part);
    for (const mode of MODES) {
      const layers = bakedLayers(map, mode);
      for (const [zoom, msaa] of JOIN_CONFIGS) {
        for (const phase of PHASES) {
          const picture = renderPremult(layers, windowOver(win.x0, win.y0, win.x1, win.y1, zoom, phase, msaa));
          const why = `${mode} fill, zoom ${zoom}, multisampling ${msaa}, phase ${phase}`;
          expect(worstHole(picture), why).toBeLessThan(HOLE);
          if (part !== "top" || !flat) continue;
          const rgb = overFloor(picture, 0x101418);
          let worst = 0;
          for (let k = 0; k < rgb.length; k += 3) for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(rgb[k + c]! - channels(top)[c]!));
          expect(worst, why).toBeLessThan(1.5);
        }
      }
    }
  });

  it("showed floor at the join before the fix: without the copy of the next column the filter leaves up to half of it (the control)", () => {
    const j = JOINS[0]!;
    const win = joinWindow(map, j.rect, j.edge, "top");
    for (const mode of MODES) {
      const layers = bakedLayers(map, mode, (pen, ctx, s) => paintStrip(pen, ctx, { ...s, east: false }));
      let worst = 0;
      for (const [zoom, msaa] of JOIN_CONFIGS) {
        for (const phase of PHASES) worst = Math.max(worst, worstHole(renderPremult(layers, windowOver(win.x0, win.y0, win.x1, win.y1, zoom, phase, msaa))));
      }
      expect(worst, `${mode} fill`).toBeGreaterThan(0.2);
    }
  });

  it("holds, in the texel past a strip's last tile, the next strip's first column texel for texel (its facet, rim and front face too), and nothing after", () => {
    const ctx = makeContext(map);
    const { strips } = planStrips(map);
    expect(strips.filter((t) => t.east)).toHaveLength(8);
    for (const mode of MODES) {
      for (const s of strips.filter((t) => t.east)) {
        const next = strips.find((t) => t.ty === s.ty && t.tx0 === s.tx1 + 1)!;
        expect(next, `row ${s.ty}`).toBeDefined();
        const a = frameOf(map, s, mode, ctx);
        const b = frameOf(map, next, mode, ctx);
        expect(next.h).toBe(s.h);
        const col = (s.tx1 - s.tx0 + 1) * TILE;
        // Frost's facet crosses the column on a slant, which the copy paints as coverage and a strip's own drawing as its fill rule
        // does: a texel or two differ by the contrast of the facet. Everything else is equal.
        const apart: number[] = [];
        for (let row = 0; row < s.h; row++) {
          const copy = texel(a, s.w, col, row), real = texel(b, next.w, 0, row);
          const gap = Math.max(...copy.map((v, c) => Math.abs(v - real[c]!)));
          if (gap > 1e-3) { apart.push(row); expect(gap, `${mode}, row ${s.ty}, texel row ${row}`).toBeLessThan(0.2); }
          expect(texel(a, s.w, col + 1, row)[3], `${mode}, row ${s.ty}, texel row ${row}: the second extra texel stays empty`).toBe(0);
        }
        expect(apart.length, `${mode}, row ${s.ty}: texel rows ${apart}`).toBeLessThanOrEqual(zone === "frost" ? 2 : 0);
      }
    }
  });
});

describe("a frost mass against a shard across a chunk edge", () => {
  // A 2 x 2 mass (columns 14 and 15) with a run of three single stones (columns 16 to 18) starting at its north-east corner: the
  // mass lifts 14 and the shard 10, so the two top faces are 4 px apart and overlap in the rows between.
  const map = wallMap("frost", [[14, 3, 2, 2], [16, 3, 3, 1]], [], 48, 16);

  it("is a mass beside a segment of another lift, which the copy covers too", () => {
    const ctx = makeContext(map);
    expect([wallInfoAt(ctx, 15, 3).style, wallInfoAt(ctx, 15, 3).lift]).toEqual(["mass", 14]);
    expect([wallInfoAt(ctx, 16, 3).style, wallInfoAt(ctx, 16, 3).lift]).toEqual(["segment", 10]);
    expect(planStrips(map).strips.find((s) => s.ty === 3 && s.tx1 === 15)!.east).toBe(true);
  });

  it("is opaque where the two top faces overlap, at any camera phase", () => {
    const x0 = 16 * TILE - 20, x1 = 16 * TILE + 20, y0 = 3 * TILE_H - 10 + 3, y1 = 4 * TILE_H - 14 - 3;
    for (const mode of MODES) {
      const layers = bakedLayers(map, mode);
      for (const [zoom, msaa] of JOIN_CONFIGS) {
        for (const phase of PHASES) expect(worstHole(renderPremult(layers, windowOver(x0, y0, x1, y1, zoom, phase, msaa))), `${mode}, zoom ${zoom}, ${msaa}, ${phase}`).toBeLessThan(HOLE);
      }
    }
  });
});

describe("a chunk edge that needs no copy", () => {
  /** A 48 x 16 map with `rects` of one zone and `tweak` applied to it. */
  const edgeMap = (rects: readonly Rect[], tweak: (m: GameMap) => void = () => undefined): GameMap => {
    const map = wallMap("fire", rects, [], 48, 16);
    tweak(map);
    return map;
  };
  const set = (m: GameMap, [x0, y0, rw, rh]: Rect, tile: number, kind = 0): void => {
    for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) { m.tiles[y * m.w + x] = tile; m.terrain[y * m.w + x] = kind; }
  };

  const CASES: ReadonlyArray<readonly [name: string, build: () => GameMap, joins: boolean]> = [
    ["a wall on the west side only", () => edgeMap([[15, 3, 1, 3]]), false],
    ["a wall on the east side only", () => edgeMap([[16, 3, 1, 3]]), false],
    ["a mass against a pillar (a wall in lava)", () => edgeMap([[14, 3, 2, 3], [16, 3, 1, 3]], (m) => set(m, [16, 3, 1, 3], TILE_WALL, TERRAIN_LAVA)), false],
    ["a pillar against a mass", () => edgeMap([[15, 3, 1, 3], [16, 3, 2, 3]], (m) => set(m, [15, 3, 1, 3], TILE_WALL, TERRAIN_LAVA)), false],
    ["a mass against a fence", () => edgeMap([[14, 3, 2, 3]], (m) => set(m, [16, 3, 1, 3], TILE_LOW, TERRAIN_FENCE)), false],
    ["a mass that stops a tile short of the edge", () => edgeMap([[13, 3, 2, 3], [16, 3, 2, 3]]), false],
    ["a mass at the end of the map", () => edgeMap([[46, 3, 2, 3]]), false],
    ["a mass against a mass", () => edgeMap([[14, 3, 4, 3]]), true],
  ];

  it.each(CASES)("%s", (_name, build, joins) => {
    const map = build();
    const ctx = makeContext(map);
    const { strips } = planStrips(map);
    expect(strips.some((s) => s.east)).toBe(joins);
    for (const row of [3, 4, 5]) expect(wallJoinsEast(map, ctx, 15, row) || wallJoinsEast(map, ctx, 47, row)).toBe(joins);
    for (const s of strips.filter((t) => !t.east)) {
      expect(s.w, `row ${s.ty}`).toBe((s.tx1 - s.tx0 + 1) * TILE);
      // Nothing is painted past the tiles of a strip that has no copy: no stray texel.
      const pen = new ShapePen();
      paintStrip(pen, ctx, s);
      for (const sh of pen.shapes) for (const [x] of sh.poly) expect(x, `row ${s.ty}, tiles ${s.tx0}-${s.tx1}`).toBeLessThanOrEqual(s.px + s.w + 1e-9);
    }
  });

  it("joins a mass and a segment of any lift, a segment and a segment, and nothing else", () => {
    const map = wallMap("frost", [[14, 3, 2, 2], [16, 3, 3, 1], [14, 10, 4, 1]], [], 48, 16);
    const ctx = makeContext(map);
    expect(wallJoinsEast(map, ctx, 15, 3)).toBe(true); // mass | segment
    expect(wallJoinsEast(map, ctx, 15, 10)).toBe(true); // segment | segment
    expect(wallJoinsEast(map, ctx, 15, 4)).toBe(false); // mass | floor
    expect(wallJoinsEast(map, ctx, 14, 3)).toBe(true); // inside a chunk it is the same predicate (the plan only asks at chunk edges)
    expect(wallJoinsEast(map, ctx, 47, 3)).toBe(false); // the map's end
    expect(wallJoinsEast(map, ctx, -1, 3)).toBe(false);
    expect(wallJoinsEast(map, ctx, 15, 99)).toBe(false);
  });
});

describe("ClipPen", () => {
  const clipped = (bounds: readonly [number, number, number, number], draw: (g: Pen) => void): RecordPen => {
    const rec = new RecordPen();
    draw(new ClipPen(rec, ...bounds));
    return rec;
  };
  const ops = (rec: RecordPen): unknown[][] => rec.ops.map((o) => [o.name, ...o.args]);

  it("cuts rectangles to its bounds (a rounded one is a plain rectangle) and drops the ones outside", () => {
    const rec = clipped([10, 0, 11, 100], (g) => g.fillRect(0, 5, 32, 7).fillRoundedRect(8, 1, 6, 2, 3).fillRect(11, 0, 4, 4).fillRect(0, 0, 10, 10));
    expect(rec.of("fillRect")).toEqual([[10, 5, 1, 7], [10, 1, 1, 2]]);
    expect(clipped([-Infinity, 4, Infinity, 9], (g) => g.fillRect(2, 0, 5, 20)).of("fillRect")).toEqual([[2, 4, 5, 5]]);
  });

  it("paints a triangle cut to a column one texel wide as a rectangle a row high where the triangle slants, its alpha the part of the texel it covers", () => {
    // The right triangle (0,0) (32,0) (0,32) cut to the column 3 <= x <= 4: a trapezoid of width 1, 29 tall at x = 3 and 28 at x = 4.
    const rec = clipped([3, -Infinity, 4, Infinity], (g) => g.fillStyle(0xabcdef, 0.8).fillTriangle(0, 0, 32, 0, 0, 32));
    const rects = rec.of("fillRect");
    expect(rects).toHaveLength(29);
    rects.forEach((r, row) => expect(r).toEqual([3, row, 1, 1]));
    // 28 whole texels and half of the one under them: the area of the cut, 28.5, at the fill's alpha of 0.8.
    expect(ops(rec).filter((o) => o[0] === "fillStyle")).toEqual([["fillStyle", 0xabcdef, 0.8], ["fillStyle", 0xabcdef, 0.4], ["fillStyle", 0xabcdef, 0.8]]);
    expect(rec.count("fillPath")).toBe(0);
  });

  it("paints a path cut to a rectangle as a rectangle, a wide polygon as a path, and nothing where the bounds miss it", () => {
    const square = clipped([0, 0, 8, 8], (g) => g.beginPath().moveTo(-4, -4).lineTo(12, -4).lineTo(12, 12).lineTo(-4, 12).closePath().fillPath());
    expect(square.of("fillRect")).toEqual([[0, 0, 8, 8]]);
    expect(square.count("fillPath")).toBe(0);
    // A chamfered rectangle (0,0) (20,0) (24,4) (24,20) (0,20) cut at x = 22: the corner is still cut, so a path remains.
    const wide = clipped([0, 0, 22, 100], (g) => g.beginPath().moveTo(0, 0).lineTo(20, 0).lineTo(24, 4).lineTo(24, 20).lineTo(0, 20).closePath().fillPath());
    expect(wide.count("fillPath")).toBe(1);
    expect(wide.paths[0]).toEqual([[0, 0], [20, 0], [22, 2], [22, 20], [0, 20]]);
    const away = clipped([100, 0, 101, 5], (g) => g.fillTriangle(0, 0, 32, 0, 0, 32).beginPath().moveTo(0, 0).lineTo(9, 0).lineTo(9, 9).fillPath());
    expect(ops(away)).toEqual([]);
    // A polygon the bounds only touch has no area.
    expect(ops(clipped([0, 10, 10, 20], (g) => g.fillTriangle(0, 0, 10, 0, 0, 10)))).toEqual([]);
  });

  it("paints a horizontal or vertical line as the rectangle of its stroke, cut to the bounds, in the stroke's colour, and restores the fill", () => {
    const rec = clipped([4, 10, 8, 20], (g) => g.lineStyle(1, 0xffffff, 0.5)
      .lineBetween(0, 10.5, 32, 10.5).lineBetween(0, 9.5, 32, 9.5).lineBetween(6.5, 0, 6.5, 40).lineBetween(2.5, 0, 2.5, 40));
    expect(ops(rec)).toEqual([
      ["lineStyle", 1, 0xffffff, 0.5],
      ["fillStyle", 0xffffff, 0.5], ["fillRect", 4, 10, 4, 1], ["fillStyle", 0, 1],
      ["fillStyle", 0xffffff, 0.5], ["fillRect", 6, 10, 1, 10], ["fillStyle", 0, 1],
    ]);
  });

  it("drops strokes, circles, ellipses and slanted lines, and passes the fill style on", () => {
    const rec = clipped([-Infinity, -Infinity, Infinity, Infinity], (g) => g.fillStyle(0x123456, 0.4).strokeRect(0, 0, 4, 4).fillCircle(2, 2, 3).strokeCircle(2, 2, 3)
      .fillEllipse(2, 2, 3, 4).strokeEllipse(2, 2, 3, 4).lineBetween(0, 0, 5, 5).beginPath().moveTo(0, 0).lineTo(5, 5).strokePath());
    expect(ops(rec)).toEqual([["fillStyle", 0x123456, 0.4]]);
  });
});

// ------------------------------------------------------------------------------------------------------------------ the step

describe.each(REGION_FACTIONS)("a %s mass directly north of a frost shard", (zone) => {
  // A 3 x 2 block (columns 4 to 6, rows 3 and 4) over a pier one stone wide (column 5, rows 5 to 8): the pier is a run of single
  // stones, a shard in frost (lift 10) under a mass of lift 14, so the mass's top face ends 4 px above the shard's starts.
  const BLOCK: Rect = [4, 3, 3, 2];
  const PIER: Rect = [5, 5, 1, 4];
  const make = (): GameMap => inZone(wallMap(zone, [BLOCK, PIER]), PIER, "frost");
  const map = make();
  const ctx = makeContext(map);
  // The control: the same block with floor under it, so its south face is a front face drawn in full.
  const control = wallMap(zone, [BLOCK]);

  it("has no front face of its own and a shard under it", () => {
    expect(wallInfoAt(ctx, 5, 4)).toMatchObject({ style: "mass", lift: 14, front: false });
    expect(wallInfoAt(ctx, 5, 5)).toMatchObject({ style: "segment", lift: 10 });
    expect(wallInfoAt(makeContext(control), 5, 4)).toMatchObject({ style: "mass", lift: 14, front: true });
  });

  it("shows no floor through the 4 px between its top face and the shard's, at any camera phase", () => {
    const x0 = 5 * TILE + 8, x1 = 6 * TILE - 8, y0 = 5 * TILE_H - 14 - 3, y1 = 5 * TILE_H - 10 + 3;
    for (const mode of MODES) {
      const layers = bakedLayers(map, mode);
      for (const [zoom, msaa] of JOIN_CONFIGS) {
        for (const phase of PHASES) expect(worstHole(renderPremult(layers, windowOver(x0, y0, x1, y1, zoom, phase, msaa))), `${mode}, zoom ${zoom}, ${msaa}, ${phase}`).toBeLessThan(HOLE);
      }
    }
  });

  it("is the mass's own front face there: the first rows of the front a floor south of it would show, texel for texel, and no more", () => {
    const row = (m: GameMap): StripOf => planStrips(m).strips.find((s) => s.ty === 4)!;
    const a = row(map), c = row(control);
    expect([a.w, a.h, a.oy]).toEqual([c.w, c.h, c.oy]);
    // The front face starts at the line the top face ends at, and the step runs to the line the shard starts at, plus a texel.
    const first = Math.round(a.oy + TILE_H - 14);
    expect(Math.round(a.oy + TILE_H - 10) - first).toBe(4);
    for (const mode of MODES) {
      const fa = frameOf(map, a, mode, ctx);
      const fc = frameOf(control, c, mode);
      for (let r = first - 1; r < first + 5; r++) {
        for (let col = 0; col < a.w; col++) expect(texel(fa, a.w, col, r), `${mode}: texel ${col}, ${r}`).toEqual(texel(fc, c.w, col, r));
      }
      for (let col = 1 * TILE; col < 2 * TILE; col++) {
        expect(texel(fa, a.w, col, first + 5)[3], `${mode}: texel ${col} under the step`).toBe(0);
        expect(texel(fc, c.w, col, first + 5)[3], `${mode}: the control's front face goes on`).toBeGreaterThan(0);
      }
    }
  });
});

describe("what a step must not touch", () => {
  const BLOCK: Rect = [4, 3, 3, 2];
  const PIER: Rect = [5, 5, 1, 4];
  const stripRow = (m: GameMap, ty: number): StripOf => planStrips(m).strips.find((s) => s.ty === ty)!;
  /** Texel rows `from`..`to` of the tile column of tile 5 in strip row `ty`: whether any texel in them has paint. */
  const painted = (m: GameMap, ty: number, from: number, to: number, mode: PaintMode = "area"): boolean => {
    const s = stripRow(m, ty);
    const f = frameOf(m, s, mode);
    for (let r = from; r <= to; r++) for (let col = (5 - s.tx0) * TILE; col < (6 - s.tx0) * TILE; col++) if (texel(f, s.w, col, r)[3]! > 0) return true;
    return false;
  };
  const first = (m: GameMap): number => Math.round(stripRow(m, 4).oy + TILE_H - 14);

  it("gives a wall of the same lift only the one texel of top colour it had: a frost mass over a fire run", () => {
    const map = inZone(wallMap("frost", [BLOCK, PIER]), PIER, "fire");
    const ctx = makeContext(map);
    expect([wallInfoAt(ctx, 5, 4).lift, wallInfoAt(ctx, 5, 5).lift]).toEqual([14, 14]);
    const s = stripRow(map, 4);
    const f = frameOf(map, s, "area", ctx);
    const r = first(map);
    expect(painted(map, 4, r - 1, r - 1)).toBe(true);
    // The one texel under the top face, in the top colour of the mass's own zone.
    expect(texel(f, s.w, 1.5 * TILE, r)).toEqual([...channels(ZONE_PALETTE.frost.wallTop).map((v) => v / 255), 1]);
    expect(painted(map, 4, r + 1, s.h - 1)).toBe(false);
  });

  it("gives a wall over a pillar nothing: no step, no texel", () => {
    const map = wallMap("fire", [BLOCK, PIER]);
    for (let y = 5; y < 9; y++) map.terrain[y * map.w + 5] = TERRAIN_LAVA;
    expect(wallInfoAt(makeContext(map), 5, 5).style).toBe("pillar");
    expect(painted(map, 4, first(map), stripRow(map, 4).h - 1)).toBe(false);
  });

  it("leaves a wall over a fence as it was: a front face, drawn in full", () => {
    const withFence = wallMap("frost", [BLOCK]);
    withFence.tiles[5 * withFence.w + 5] = TILE_LOW;
    withFence.terrain[5 * withFence.w + 5] = TERRAIN_FENCE;
    const plain = wallMap("frost", [BLOCK]);
    expect(wallInfoAt(makeContext(withFence), 5, 4).front).toBe(true);
    const a = stripRow(withFence, 4), b = stripRow(plain, 4);
    expect(frameOf(withFence, a, "area")).toEqual(frameOf(plain, b, "area"));
  });

  it("leaves a shard over a taller wall as it was: the taller one's top face covers its last 4 px, with no gap", () => {
    // A run of three stones (column 5, rows 3 to 5, lift 10) ending on a 3 x 2 block (rows 6 and 7, lift 14).
    const map = wallMap("frost", [[5, 3, 1, 3], [4, 6, 3, 2]]);
    const ctx = makeContext(map);
    expect([wallInfoAt(ctx, 5, 5).lift, wallInfoAt(ctx, 5, 6).lift]).toEqual([10, 14]);
    const s = stripRow(map, 5);
    const end = Math.round(s.oy + TILE_H - 10);
    expect(painted(map, 5, end, s.h - 1)).toBe(false);
    for (const mode of MODES) {
      const layers = bakedLayers(map, mode);
      const x0 = 5 * TILE + 8, x1 = 6 * TILE - 8, y0 = 6 * TILE_H - 14 - 3, y1 = 6 * TILE_H - 10 + 3;
      for (const [zoom, msaa] of JOIN_CONFIGS) {
        for (const phase of PHASES) expect(worstHole(renderPremult(layers, windowOver(x0, y0, x1, y1, zoom, phase, msaa))), `${mode}, zoom ${zoom}, ${msaa}, ${phase}`).toBeLessThan(HOLE);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The zone shapes' wall looks (render/zoneArt/featureArt.ts, featureStyle.ts) draw on the same footprint and faces as the zone's own
// wall, so the seam work above must hold for them too: no floor through a row boundary, whatever mark a look adds. A crater's rim is
// the one look that changes an edge (its lift is jittered: one tile in eight 5 px lower, two in eight 3 px lower), so it is held to
// the same standard where its rows differ: a lower tile under a higher one shows the higher one's south face, never the floor.

/** [look, zone, feature kind, landmark variant]: one case per wall look the art has. */
const LOOK_CASES: ReadonlyArray<readonly [string, Zone, FeatureKind, string]> = [
  ["rim", "fire", "crater", ""], ["mound", "plague", "barrow", ""], ["pier", "holy", "hall", ""], ["shard", "frost", "headland", ""],
  ["gallows", "sentenced", "gallows", ""], ["forge", "fire", "landmark", "forge"], ["guardHouse", "sentenced", "landmark", "guardHouse"],
  ["burrow", "plague", "landmark", "burrow"], ["watchtower", "frost", "landmark", "watchtower"], ["shrine", "holy", "landmark", "shrine"],
];

/** `wallMap` with its walls owned by one feature of `kind` (the crater's p is [camp, radius4, breaches]). */
function featureWallMap(zone: Zone, kind: FeatureKind, variant: string, walls: readonly Rect[], seed = 3): GameMap {
  const map = wallMap(zone, walls);
  (map as { seed: number }).seed = seed;
  map.features = [{ kind, variant, zone, jobs: [], ax: 10, ay: 5, p: kind === "crater" ? [0, 24, 0] : kind === "barrow" ? [16, 0, 0, 1] : [], bbox: { x: 0, y: 0, w: map.w, h: map.h }, tiles: 0 }];
  for (const [x0, y0, rw, rh] of walls) for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) map.featureGrid[y * map.w + x] = 1;
  return map;
}

describe.each(LOOK_CASES.filter(([name]) => name !== "rim"))("a stacked %s wall (a feature look), pixel by pixel", (name, zone, kind, variant) => {
  it.each(Object.entries(STACKS))("leaves no floor through a row boundary in a %s stack, at any camera phase", (_n, stack) => {
    const map = featureWallMap(zone, kind, variant, [stack]);
    expect(wallInfoAt(makeContext(map), stack[0], stack[1]).look, name).toBe(name);
    const win = stackWindow(map, stack);
    for (const mode of MODES) {
      const layers = bakedLayers(map, mode);
      for (const [zoom, msaa] of CONFIGS) {
        for (const phase of PHASES) {
          const picture = renderPremult(layers, windowOver(win.x0, win.y0, win.x1, win.y1, zoom, phase, msaa));
          expect(worstHole(picture), `${mode} fill, zoom ${zoom}, multisampling ${msaa}, phase ${phase}`).toBeLessThan(HOLE);
        }
      }
    }
  });

  it("puts every edge of a stack's tiles on a texel line, like the zone's own wall", () => {
    const map = featureWallMap(zone, kind, variant, [STACKS["3 x 3"]!]);
    const ctx = makeContext(map);
    const [tx, ty, w, h] = STACKS["3 x 3"]!;
    for (const s of planStrips(map).strips) {
      if (s.ty < ty || s.ty >= ty + h) continue;
      const pen = new ShapePen();
      paintStrip(pen, ctx, s);
      for (const sh of pen.shapes) {
        if (sh.line) continue;
        const ys = sh.poly.map((p) => p[1]);
        const xs = sh.poly.map((p) => p[0]);
        if (Math.max(...xs) - s.px + s.x <= tx * TILE || Math.min(...xs) - s.px + s.x >= (tx + w) * TILE) continue;
        for (const v of [Math.min(...ys), Math.max(...ys)]) expect(Math.abs(v - Math.round(v)), `${name} row ${s.ty}`).toBeLessThan(1e-9);
      }
    }
  });
});

describe("a crater rim's broken crown, pixel by pixel", () => {
  /** The first seed (from 1) at which the lifts of the tiles of `rects` are all one wall high: the jitter leaves them level. */
  function levelSeed(rects: readonly Rect[]): number {
    for (let seed = 1; seed < 5000; seed++) {
      const ctx = makeContext(featureWallMap("fire", "crater", "", rects, seed));
      const all = rects.every(([tx, ty, w, h]) => {
        for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) if (wallInfoAt(ctx, x, y).lift !== 14) return false;
        return true;
      });
      if (all) return seed;
    }
    throw new Error("no seed keeps the stack level");
  }

  it("leaves no floor through a row boundary of a 3 x 3 rim whose tiles stand level", () => {
    const stack = STACKS["3 x 3"]!;
    const map = featureWallMap("fire", "crater", "", [stack], levelSeed([stack]));
    expect(wallInfoAt(makeContext(map), stack[0], stack[1]).look).toBe("rim");
    const win = stackWindow(map, stack);
    for (const mode of MODES) {
      const layers = bakedLayers(map, mode);
      for (const [zoom, msaa] of CONFIGS) {
        for (const phase of PHASES) expect(worstHole(renderPremult(layers, windowOver(win.x0, win.y0, win.x1, win.y1, zoom, phase, msaa))), `${mode}, zoom ${zoom}, ${msaa}, ${phase}`).toBeLessThan(HOLE);
      }
    }
  });

  it("shows the higher tile's south face, never the floor, where a lower rim stone stands under a higher one (a column of four, many jitters)", () => {
    const column: Rect = [9, 3, 1, 4];
    let steps = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const map = featureWallMap("fire", "crater", "", [column], seed);
      const ctx = makeContext(map);
      const lifts = [3, 4, 5, 6].map((y) => wallInfoAt(ctx, 9, y).lift);
      for (let k = 0; k < 3; k++) if (lifts[k + 1]! < lifts[k]!) steps++;
      // Over the column's whole height, from the first top face to the last one's foot: every pixel of the window is wall.
      const x0 = 9 * TILE + 8, x1 = 10 * TILE - 8, y0 = 3 * TILE_H - lifts[0]! + 3, y1 = 7 * TILE_H - lifts[3]! - 3;
      const layers = bakedLayers(map, "area");
      for (const [zoom, msaa] of [[1.37, true], [2, false]] as const) {
        for (const phase of [0, 0.29, 0.71]) expect(worstHole(renderPremult(layers, windowOver(x0, y0, x1, y1, zoom, phase, msaa))), `seed ${seed} lifts ${lifts}, zoom ${zoom}, ${phase}`).toBeLessThan(HOLE);
      }
    }
    // The premise: some of the jitters put a lower stone under a higher one.
    expect(steps).toBeGreaterThan(5);
  });
});

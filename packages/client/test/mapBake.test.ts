// render/mapBake.ts: the map's Graphics become baked textures, from outside MapView. The scene is fake (test/fakes.ts).
import { describe, expect, it, vi } from "vitest";
import {
  MAX_WALL_SCALE, REBAKE_DEBOUNCE_MS, RebakeGate, RUN_GAP, bakeMapView, clusterUnits, commandBounds, packShelves, replayCluster, splitUnits, wallScaleAt, wallScaleFor,
} from "../src/render/mapBake";
import { setBakeScale } from "../src/render/bake";
import { argsOf, fakeCanvas, fakeScene, type FakeCanvas } from "./fakes";

// Phaser's Graphics command ids: ARC 0, BEGIN_PATH 1, CLOSE_PATH 2, FILL_RECT 3, LINE_TO 4, MOVE_TO 5, LINE_STYLE 6, FILL_STYLE 7,
// FILL_PATH 8, STROKE_PATH 9, TRANSLATE 16.
const FILL_STYLE = (color: number, alpha = 1) => [7, color, alpha];
const LINE_STYLE = (width: number, color = 0xffffff, alpha = 1) => [6, width, color, alpha];
const FILL_RECT = (x: number, y: number, w: number, h: number) => [3, x, y, w, h];
const BEGIN_PATH = [1];
const MOVE_TO = (x: number, y: number) => [5, x, y];
const LINE_TO = (x: number, y: number) => [4, x, y];
const FILL_PATH = [8];
const STROKE_PATH = [9];

describe("commandBounds", () => {
  it("boxes the rectangles of a buffer", () => {
    expect(commandBounds([...FILL_STYLE(0xff0000), ...FILL_RECT(10, 20, 100, 30), ...FILL_RECT(-5, 50, 10, 10)])).toEqual({ x0: -5, y0: 20, x1: 110, y1: 60 });
  });

  it("pads a stroked line by half its width", () => {
    // lineStyle(4, ...), moveTo(0, 0), lineTo(10, 0): the line's width reaches 2 (+1 of slack) beyond its ends.
    expect(commandBounds([6, 4, 0xffffff, 1, 1, 5, 0, 0, 4, 10, 0, 9])).toEqual({ x0: -3, y0: -3, x1: 13, y1: 3 });
  });

  it("covers an arc by its radius and a triangle by its corners", () => {
    expect(commandBounds([0, 50, 50, 10, 0, 6.28, 0, 0])).toEqual({ x0: 38, y0: 38, x1: 62, y1: 62 });
    expect(commandBounds([10, 0, 0, 20, 0, 10, 15])).toEqual({ x0: -2, y0: -2, x1: 22, y1: 17 });
  });

  it("gives up on what it cannot place: a transform, an unknown command, nothing drawn", () => {
    expect(commandBounds([16, 5, 5, ...FILL_RECT(0, 0, 1, 1)])).toBeNull();
    expect(commandBounds([99])).toBeNull();
    expect(commandBounds([])).toBeNull();
    expect(commandBounds(FILL_STYLE(0))).toBeNull();
  });
});

describe("splitUnits", () => {
  it("makes a unit of each rectangle, with the styles in force when it was drawn", () => {
    const units = splitUnits([...FILL_STYLE(1), ...FILL_RECT(0, 0, 10, 10), ...FILL_RECT(20, 0, 10, 10), ...FILL_STYLE(2), ...FILL_RECT(40, 0, 10, 10)])!;
    expect(units.map((u) => u.fill)).toEqual([[7, 1, 1], [7, 1, 1], [7, 2, 1]]);
    expect(units.map((u) => u.box)).toEqual([{ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 20, y0: 0, x1: 30, y1: 10 }, { x0: 40, y0: 0, x1: 50, y1: 10 }]);
    expect(units.map((u) => u.cmds)).toEqual([FILL_RECT(0, 0, 10, 10), FILL_RECT(20, 0, 10, 10), FILL_RECT(40, 0, 10, 10)]);
    expect(units.every((u) => u.line === null)).toBe(true);
  });

  it("takes a path from BEGIN_PATH to its stroke as one unit, padded by the line width in force", () => {
    const units = splitUnits([...LINE_STYLE(4), ...BEGIN_PATH, ...MOVE_TO(0, 0), ...LINE_TO(10, 0), ...STROKE_PATH, ...FILL_RECT(50, 0, 5, 5)])!;
    expect(units).toHaveLength(2);
    expect(units[0]!.cmds).toEqual([...BEGIN_PATH, ...MOVE_TO(0, 0), ...LINE_TO(10, 0), ...STROKE_PATH]);
    expect(units[0]!.box).toEqual({ x0: -3, y0: -3, x1: 13, y1: 3 });
    expect(units[0]!.line).toEqual([6, 4, 0xffffff, 1]);
  });

  it("keeps a fill and a stroke that follow each other on one path together", () => {
    const units = splitUnits([...BEGIN_PATH, 0, 5, 5, 3, 0, 6.28, 0, 0, ...FILL_PATH, ...STROKE_PATH, ...FILL_RECT(100, 0, 5, 5)])!;
    expect(units).toHaveLength(2);
    expect(units[0]!.cmds).toEqual([...BEGIN_PATH, 0, 5, 5, 3, 0, 6.28, 0, 0, ...FILL_PATH, ...STROKE_PATH]);
  });

  it("gives up on a buffer that is not made of whole units", () => {
    expect(splitUnits([...LINE_TO(1, 1)])).toBeNull(); // geometry with no path
    expect(splitUnits([...FILL_PATH])).toBeNull();
    expect(splitUnits([...BEGIN_PATH, ...MOVE_TO(0, 0), ...LINE_TO(5, 5)])).toBeNull(); // never drawn
    expect(splitUnits([...BEGIN_PATH, ...FILL_PATH])).toBeNull(); // no geometry
    expect(splitUnits([...BEGIN_PATH, ...MOVE_TO(0, 0), ...FILL_STYLE(1), ...FILL_PATH])).toBeNull(); // a style inside the path
    expect(splitUnits([...BEGIN_PATH, ...MOVE_TO(0, 0), ...LINE_TO(5, 5), ...FILL_PATH, ...LINE_STYLE(2), ...STROKE_PATH])).toBeNull(); // a stroke after a style change
    expect(splitUnits([16, 1, 1, ...FILL_RECT(0, 0, 1, 1)])).toBeNull(); // a transform
  });

  it("has no units for a buffer that draws nothing", () => {
    expect(splitUnits(FILL_STYLE(1))).toEqual([]);
    expect(splitUnits([])).toEqual([]);
  });
});

describe("clusterUnits", () => {
  const units = splitUnits([
    ...FILL_STYLE(1), ...FILL_RECT(0, 10, 32, 20), // 0..32
    ...FILL_RECT(40, 5, 32, 20), // 40..72: 8 from the first
    ...FILL_STYLE(2), ...FILL_RECT(200, 10, 32, 20), // 200..232
  ])!;

  it("joins units that start within the gap of the group so far and splits at an empty stretch", () => {
    const clusters = clusterUnits(units, 16);
    expect(clusters.map((c) => c.region)).toEqual([{ x0: 0, y0: 5, x1: 72, y1: 30 }, { x0: 200, y0: 10, x1: 232, y1: 30 }]);
    expect(clusters.map((c) => c.units.length)).toEqual([2, 1]);
    expect(clusterUnits(units, 7).map((c) => c.units.length)).toEqual([1, 1, 1]);
    expect(clusterUnits(units, 200)).toHaveLength(1);
  });

  it("does not care about the order the units came in, and keeps their drawing order inside a cluster", () => {
    const shuffled = [units[2]!, units[1]!, units[0]!];
    const clusters = clusterUnits(shuffled, 16);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.units).toEqual([units[1]!, units[0]!]);
  });

  it("merges a touching unit at gap 0 and drops an empty box", () => {
    const touching = splitUnits([...FILL_RECT(0, 0, 10, 10), ...FILL_RECT(10, 0, 10, 10), ...FILL_RECT(30, 0, 10, 10)])!;
    expect(clusterUnits(touching, 0).map((c) => c.region)).toEqual([{ x0: 0, y0: 0, x1: 20, y1: 10 }, { x0: 30, y0: 0, x1: 40, y1: 10 }]);
    expect(clusterUnits([{ box: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }, cmds: [], fill: null, line: null }], 0)).toEqual([]);
  });
});

describe("replayCluster", () => {
  it("sets a style again only where it changes, and leaves out the styles of the units it does not hold", () => {
    const all = splitUnits([
      ...FILL_STYLE(1), ...FILL_RECT(0, 0, 10, 10),
      ...FILL_STYLE(2), ...FILL_RECT(50, 0, 10, 10),
      ...FILL_STYLE(1), ...FILL_RECT(100, 0, 10, 10),
      ...LINE_STYLE(2), ...BEGIN_PATH, ...MOVE_TO(150, 0), ...LINE_TO(160, 0), ...STROKE_PATH,
    ])!;
    expect(replayCluster([all[0]!, all[2]!])).toEqual([...FILL_STYLE(1), ...FILL_RECT(0, 0, 10, 10), ...FILL_RECT(100, 0, 10, 10)]);
    expect(replayCluster([all[1]!])).toEqual([...FILL_STYLE(2), ...FILL_RECT(50, 0, 10, 10)]);
    expect(replayCluster([all[2]!, all[3]!])).toEqual([
      ...FILL_STYLE(1), ...FILL_RECT(100, 0, 10, 10), ...LINE_STYLE(2), ...BEGIN_PATH, ...MOVE_TO(150, 0), ...LINE_TO(160, 0), ...STROKE_PATH,
    ]);
  });
});

describe("packShelves", () => {
  it("fills a shelf left to right with each cell's padding around it, then opens the next under it", () => {
    const { pages, placed } = packShelves(Array.from({ length: 7 }, () => ({ w: 10, h: 5 })), 40, 1);
    // A cell is 12 x 7 with its padding: three to a 40-wide shelf.
    expect(placed.map((p) => [p.page, p.x, p.y])).toEqual([
      [0, 1, 1], [0, 13, 1], [0, 25, 1],
      [0, 1, 8], [0, 13, 8], [0, 25, 8],
      [0, 1, 15],
    ]);
    expect(pages).toEqual([{ w: 36, h: 21 }]);
  });

  it("starts a new page when the next shelf would pass the limit, and puts the tallest cells first", () => {
    const { pages, placed } = packShelves([{ w: 10, h: 5 }, { w: 10, h: 12 }, { w: 10, h: 5 }], 20, 0);
    // The tall one (index 1) opens the first shelf; two 5-high cells would need a second shelf (12 + 5 <= 20) and the third a page.
    expect(placed[1]).toEqual({ page: 0, x: 0, y: 0 });
    expect(placed[0]).toEqual({ page: 0, x: 10, y: 0 });
    expect(placed[2]).toEqual({ page: 0, x: 0, y: 12 });
    expect(pages).toEqual([{ w: 20, h: 17 }]);
    const more = packShelves([{ w: 20, h: 12 }, { w: 20, h: 12 }], 20, 0);
    expect(more.placed.map((p) => p.page)).toEqual([0, 1]);
    expect(more.pages).toEqual([{ w: 20, h: 12 }, { w: 20, h: 12 }]);
  });

  it("makes no page for nothing and refuses a cell that cannot fit one", () => {
    expect(packShelves([], 4096, 1)).toEqual({ pages: [], placed: [] });
    expect(() => packShelves([{ w: 4095, h: 10 }], 4096, 1)).toThrow();
  });

  it("is only as big as what it holds (a page of one cell is that cell)", () => {
    expect(packShelves([{ w: 2052, h: 1642 }], 4096, 0).pages).toEqual([{ w: 2052, h: 1642 }]);
  });
});

describe("the baked density and when to bake again", () => {
  it("takes one texel per screen pixel, in half steps from 1 to 2", () => {
    expect([0.5, 1, 1.01, 1.37, 1.5, 1.51, 1.6, 2, 3].map(wallScaleFor)).toEqual([1, 1, 1.5, 1.5, 1.5, 2, 2, 2, 2]);
  });

  it("goes on to the page's density where the screen zooms past 2, no further than the camera needs", () => {
    expect([1.6, 2, 2.01, 2.4, 2.5, 2.6, 4].map((z) => wallScaleAt(z, 3))).toEqual([2, 2, 2.5, 2.5, 2.5, 3, 3]);
    expect([2.4, 2.6].map((z) => wallScaleAt(z, 2.5))).toEqual([2.5, 2.5]);
    // The page's density can be 3 (fighters, rings) but the walls stop at MAX_WALL_SCALE: they are the memory.
    setBakeScale(3);
    try { expect([2.4, 2.7, 3].map((z) => wallScaleFor(z))).toEqual([2.5, 2.5, 2.5]); } finally { setBakeScale(null); }
    expect(MAX_WALL_SCALE).toBe(2.5);
  });

  it("bakes again only for a zoom that asks for a denser bake and has held for the debounce time", () => {
    const gate = new RebakeGate(wallScaleFor(1.37)); // baked at 1.5
    expect(gate.check(1.37, 0)).toBe(false);
    expect(gate.check(1.5, 100)).toBe(false); // still 1.5
    expect(gate.check(1.6, 1000)).toBe(false); // asks for 2, but only just now
    expect(gate.check(1.6, 1000 + REBAKE_DEBOUNCE_MS - 1)).toBe(false);
    expect(gate.check(1.6, 1000 + REBAKE_DEBOUNCE_MS)).toBe(true);
    // Still asking until a bake is made.
    expect(gate.check(1.6, 2000)).toBe(true);
    gate.rebaked(2);
    expect(gate.check(1.6, 2100)).toBe(false);
    expect(gate.check(2, 5000)).toBe(false);
  });

  it("starts the wait again every time the zoom changes (a window being dragged)", () => {
    const gate = new RebakeGate(1);
    expect(gate.check(1.2, 0)).toBe(false);
    expect(gate.check(1.3, 200)).toBe(false);
    expect(gate.check(1.4, 400)).toBe(false);
    expect(gate.check(1.4, 600)).toBe(false);
    expect(gate.check(1.4, 400 + REBAKE_DEBOUNCE_MS)).toBe(true);
  });

  it("never bakes again for a zoom that falls or holds", () => {
    const gate = new RebakeGate(2);
    for (const z of [2, 1.9, 1.2, 1, 0.5, 3]) {
      expect(gate.check(z, 0)).toBe(false);
      expect(gate.check(z, 10_000)).toBe(false);
    }
  });
});

interface FakeGraphics {
  type: string;
  commandBuffer: number[];
  visible: boolean;
  depth: number;
  destroy: ReturnType<typeof vi.fn>;
}
const graphics = (depth: number, commandBuffer: number[], visible = true): FakeGraphics => ({ type: "Graphics", commandBuffer, visible, depth, destroy: vi.fn() });

describe("bakeMapView", () => {
  const floor = graphics(-1e6, [...FILL_STYLE(0x2a3038), ...FILL_RECT(0, 0, 2048, 1638)]);
  const wall = graphics(96, [...FILL_STYLE(0x555b63), ...FILL_RECT(32, 70, 64, 14), ...FILL_STYLE(0x8a9099), ...FILL_RECT(32, 56, 64, 26)]);
  const closedGate = graphics(300, [...FILL_STYLE(0xb85c4a), ...FILL_RECT(0, 0, 32, 26)], false);
  const openMark = graphics(-5e5, [...FILL_STYLE(0xb85c4a, 0.18), ...FILL_RECT(0, 0, 32, 26)]);
  const odd = graphics(128, [16, 1, 1, ...FILL_RECT(0, 0, 1, 1)]);
  const mapView = (objects: unknown[]) => ({ objects }) as never;
  const fresh = (o: FakeGraphics): FakeGraphics => ({ ...o, commandBuffer: [...o.commandBuffer], destroy: vi.fn() });
  /** A scene whose canvases are kept, with a renderer that has (or has not) a GL context. */
  function setup(gl = false) {
    const canvases: FakeCanvas[] = [];
    const renderer = { gl: gl ? {} : undefined, on: vi.fn(), off: vi.fn() };
    const fake = fakeScene({ sys: { game: { renderer } } });
    const makeCanvas = (w: number, h: number) => { const c = fakeCanvas(w, h); canvases.push(c); return c as never; };
    let clock = 0;
    const options = { makeCanvas, now: () => (clock += 5) };
    return { ...fake, canvases, renderer, options };
  }

  it("bakes the floor and the wall rows, and leaves the gates, the open-gate mark and anything it cannot read alone", () => {
    const { scene, pages, options } = setup();
    const objs = [floor, wall, closedGate, openMark, odd].map(fresh);
    bakeMapView(scene, mapView(objs), 2, "map", options);
    expect(objs.map((o) => o.destroy.mock.calls.length)).toEqual([1, 1, 0, 0, 0]);
    expect([...pages.keys()]).toEqual(["bk:map:0:f0", "bk:map:0:w0"]);
  });

  it("puts the floor on a page of its own at one texel per pixel and the walls on another at the camera's density, up to 2", () => {
    const { scene, pages, options } = setup();
    bakeMapView(scene, mapView([floor, wall].map(fresh)), 1.37, "map", options);
    // The floor box is 2048 x 1638 world pixels; the wall row is 64 x 28 (plain rectangles), in texels at 1.5, with a texel of gutter each side.
    expect(pages.get("bk:map:0:f0")!.canvas).toMatchObject({ width: 2048, height: 1638 });
    expect(pages.get("bk:map:0:w0")!.canvas).toMatchObject({ width: 96 + 2, height: 42 + 2 });
    expect(pages.get("bk:map:0:w0")!.frames.get("r0")).toEqual({ x: 1, y: 1, w: 96, h: 42 });
    const two = setup();
    bakeMapView(two.scene, mapView([fresh(wall)]), 3, "map", two.options);
    expect(two.pages.get("bk:map:0:w0")!.frames.get("r0")).toEqual({ x: 1, y: 1, w: 128, h: 56 });
  });

  it("shows each baked drawing as an Image where it was, at its depth, one world pixel per 1/scale texels", () => {
    const { scene, ofKind, options } = setup();
    bakeMapView(scene, mapView([fresh(wall)]), 2, "map", options);
    const img = ofKind("image")[0]!;
    expect(img.args).toEqual([32, 56, "bk:map:0:w0", "r0"]);
    expect(argsOf(img, "setOrigin")[0]).toEqual([0, 0]);
    expect(img.state.scale).toBe(1 / 2);
    expect(img.state.depth).toBe(96);
  });

  it("bakes a wall row as its runs: units a gap apart are two Images at the row's depth on one page, a nearby one joins its neighbour", () => {
    const { scene, pages, ofKind, paints, canvases, options } = setup();
    const row = graphics(160, [
      ...FILL_STYLE(0x555b63), ...FILL_RECT(0, 0, 64, 26),
      ...FILL_RECT(64 + RUN_GAP, 0, 64, 26), // within the gap of the first
      ...FILL_STYLE(0x8a9099), ...FILL_RECT(1000, 0, 64, 26), // far away
    ]);
    bakeMapView(scene, mapView([row]), 2, "map", options);
    const images = ofKind("image");
    expect(images.map((i) => i.args)).toEqual([[0, 0, "bk:map:0:w0", "r0"], [1000, 0, "bk:map:0:w0", "r1"]]);
    expect(images.map((i) => i.state.depth)).toEqual([160, 160]);
    const page = pages.get("bk:map:0:w0")!;
    // Two cells of 52 texels high, side by side with a texel of room around each: the near pair is 2 * (64 + RUN_GAP) wide at 2 texels per pixel.
    expect([...page.frames.values()]).toEqual([{ x: 1, y: 1, w: (128 + RUN_GAP) * 2, h: 52 }, { x: (128 + RUN_GAP) * 2 + 3, y: 1, w: 128, h: 52 }]);
    expect(canvases).toHaveLength(2); // the page and the scratch canvas each drawing is painted on
    // The first run's commands: its style once, both rectangles. The second: the style it was drawn with.
    expect(paints.map((p) => p.commands)).toEqual([
      [...FILL_STYLE(0x555b63), ...FILL_RECT(0, 0, 64, 26), ...FILL_RECT(64 + RUN_GAP, 0, 64, 26)],
      [...FILL_STYLE(0x8a9099), ...FILL_RECT(1000, 0, 64, 26)],
    ]);
    // Painted at the density, moved so the run's top left lands a texel in (the gutter's room) on a canvas of the run's size plus it.
    expect(paints.map((p) => argsOf(p, "scaleCanvas"))).toEqual([[[2, 2]], [[2, 2]]]);
    expect(paints.map((p) => argsOf(p, "translateCanvas"))).toEqual([[[1 / 2 - 0, 1 / 2 - 0]], [[1 / 2 - 1000, 1 / 2 - 0]]]);
    expect(paints.map((p) => p.size)).toEqual([[(128 + RUN_GAP) * 2 + 2, 54], [130, 54]]);
  });

  it("makes each wall run's gutter on a small canvas of its own and blits it onto the page, the floor without a gutter", () => {
    const { scene, canvases, paints, pages, options } = setup();
    bakeMapView(scene, mapView([fresh(floor), fresh(wall)]), 2, "map", options);
    // Created: the floor's page and scratch canvas, then the wall page and its scratch canvas.
    const [floorPage, floorScratch, wallPage, wallScratch] = canvases as [FakeCanvas, FakeCanvas, FakeCanvas, FakeCanvas];
    expect([...pages.values()].map((p) => p.canvas)).toEqual([floorPage, wallPage]);
    expect(paints.map((p) => [p.canvas, p.size])).toEqual([[floorScratch, [2048, 1638]], [wallScratch, [130, 58]]]);
    expect(floorScratch.ctxCalls).toEqual([]);
    expect(floorPage.ctxCalls).toEqual([["drawImage", [floorScratch, 0, 0, 2048, 1638, 0, 0, 2048, 1638]]]);
    // The wall run is 128 x 56 texels, a texel of gutter around it: left column to the left, right to the right, then the rows.
    expect(wallScratch.ctxCalls.map(([n, a]) => [n, ...(a as number[]).slice(1)])).toEqual([
      ["drawImage", 1, 1, 1, 56, 0, 1, 1, 56],
      ["drawImage", 128, 1, 1, 56, 129, 1, 1, 56],
      ["drawImage", 0, 1, 130, 1, 0, 0, 130, 1],
      ["drawImage", 0, 56, 130, 1, 0, 57, 130, 1],
    ]);
    expect(wallPage.ctxCalls).toEqual([["drawImage", [wallScratch, 0, 0, 130, 58, 0, 0, 130, 58]]]);
    // The scratch canvases do not stay big.
    expect([floorScratch, wallScratch].map((c) => [c.width, c.height])).toEqual([[1, 1], [1, 1]]);
  });

  it("cuts a drawing wider than a texture can be into chunks side by side", () => {
    const { scene, pages, ofKind, options } = setup();
    const wide = graphics(-1e6, [...FILL_STYLE(0), ...FILL_RECT(0, 0, 5000, 100)]);
    bakeMapView(scene, mapView([wide]), 1, "map", options);
    expect(ofKind("image").map((i) => i.args.slice(0, 2))).toEqual([[0, 0], [4096, 0]]);
    expect([...pages.get("bk:map:0:f0")!.frames.values()].map((f) => f.w)).toEqual([4096, 904]);
    // A wall run at 2 texels per pixel is cut so that it and its gutters fit 4096 texels: 2047 world pixels.
    const walls = setup();
    bakeMapView(walls.scene, mapView([graphics(32, [...FILL_STYLE(0), ...FILL_RECT(0, 0, 2048, 26)])]), 2, "map", walls.options);
    expect(walls.ofKind("image").map((i) => i.args.slice(0, 2))).toEqual([[0, 0], [2047, 0]]);
  });

  it("bakes a row it cannot split whole, as one drawing", () => {
    const { scene, ofKind, paints, options } = setup();
    // A LINE_TO with no path before it: not whole units, so no runs; the box is still known.
    const row = graphics(64, [...FILL_STYLE(1), ...FILL_RECT(0, 0, 32, 26), ...FILL_RECT(500, 0, 32, 26), 5, 0, 0, 4, 10, 10]);
    bakeMapView(scene, mapView([row]), 1, "map", options);
    expect(ofKind("image")).toHaveLength(1);
    expect(paints).toHaveLength(1);
    expect(paints[0]!.commands).toEqual(row.commandBuffer);
  });

  it("frees its images and textures when the map is dropped, once", () => {
    const { scene, pages, ofKind, options } = setup();
    const handle = bakeMapView(scene, mapView([fresh(floor), fresh(wall)]), 2, "map", options);
    expect(pages.size).toBe(2);
    handle.destroy();
    expect(pages.size).toBe(0);
    expect(ofKind("image").every((i) => argsOf(i, "destroy").length === 1)).toBe(true);
    handle.destroy();
    expect(ofKind("image").every((i) => argsOf(i, "destroy").length === 1)).toBe(true);
  });

  it("reports what it made", () => {
    const { scene, options } = setup();
    const handle = bakeMapView(scene, mapView([fresh(floor), fresh(wall)]), 2, "map", options);
    expect(handle.stats).toEqual({ scale: 2, pages: 2, images: 2, texels: 2048 * 1638 + 130 * 58, ms: 5, rebakes: 0 });
  });

  describe("on a WebGL renderer", () => {
    it("shrinks each page's canvas once the texture is uploaded, and not on another renderer", () => {
      const gl = setup(true);
      bakeMapView(gl.scene, mapView([fresh(floor), fresh(wall)]), 2, "map", gl.options);
      expect(gl.canvases.map((c) => [c.width, c.height])).toEqual([[1, 1], [1, 1], [1, 1], [1, 1]]);
      const canvas = setup(false);
      bakeMapView(canvas.scene, mapView([fresh(floor), fresh(wall)]), 2, "map", canvas.options);
      expect([...canvas.pages.values()].map((p) => [p.canvas.width, p.canvas.height])).toEqual([[2048, 1638], [130, 58]]);
      expect(canvas.renderer.on).not.toHaveBeenCalled();
    });

    it("bakes again from the commands it kept when the context comes back, and stops listening when dropped", () => {
      const { scene, pages, ofKind, renderer, options, canvases } = setup(true);
      const handle = bakeMapView(scene, mapView([fresh(floor), fresh(wall)]), 2, "map", options);
      expect(renderer.on).toHaveBeenCalledTimes(1);
      const [event, restore] = renderer.on.mock.calls[0] as [string, () => void];
      expect(event).toBe("restorewebgl");
      restore();
      expect([...pages.keys()]).toEqual(["bk:map:1:f0", "bk:map:1:w0"]);
      expect(canvases).toHaveLength(8);
      expect(ofKind("image").filter((i) => argsOf(i, "destroy").length === 0)).toHaveLength(2);
      expect(handle.stats.rebakes).toBe(1);
      handle.destroy();
      expect(renderer.off).toHaveBeenCalledWith("restorewebgl", restore);
      restore(); // a late event does nothing
      expect(pages.size).toBe(0);
    });
  });

  describe("update", () => {
    it("bakes the walls again once the zoom has risen past the baked density and held, and the floor with them", () => {
      const { scene, pages, ofKind, options } = setup();
      const handle = bakeMapView(scene, mapView([fresh(floor), fresh(wall)]), 1.37, "map", options);
      expect(handle.update(1.37, 0)).toBe(false);
      expect(handle.update(1.7, 1000)).toBe(false);
      expect(handle.update(1.7, 1000 + REBAKE_DEBOUNCE_MS)).toBe(true);
      expect(handle.update(1.7, 5000)).toBe(false);
      expect([...pages.keys()]).toEqual(["bk:map:1:f0", "bk:map:1:w0"]);
      expect(pages.get("bk:map:1:w0")!.frames.get("r0")).toEqual({ x: 1, y: 1, w: 128, h: 56 });
      // The old Images are gone, the new ones sit where they did at a new density.
      const live = ofKind("image").filter((i) => argsOf(i, "destroy").length === 0);
      expect(live.map((i) => [i.args, i.state.scale])).toEqual([[[0, 0, "bk:map:1:f0", "r0"], 1], [[32, 56, "bk:map:1:w0", "r0"], 1 / 2]]);
      expect(handle.stats).toMatchObject({ scale: 2, rebakes: 1 });
      // At 2 there is nothing denser to ask for.
      expect(handle.update(2.2, 6000)).toBe(false);
      expect(handle.update(2.2, 9000)).toBe(false);
    });

    it("keeps its bake when the zoom falls", () => {
      const { scene, pages, options } = setup();
      const handle = bakeMapView(scene, mapView([fresh(wall)]), 2, "map", options);
      expect(handle.update(1, 0)).toBe(false);
      expect(handle.update(1, 10_000)).toBe(false);
      expect([...pages.keys()]).toEqual(["bk:map:0:w0"]);
    });

    it("does nothing after it was dropped", () => {
      const { scene, pages, options } = setup();
      const handle = bakeMapView(scene, mapView([fresh(wall)]), 1, "map", options);
      handle.destroy();
      expect(handle.update(2, 0)).toBe(false);
      expect(handle.update(2, 10_000)).toBe(false);
      expect(pages.size).toBe(0);
    });
  });
});

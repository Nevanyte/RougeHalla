// render/mapBake.ts: the map's Graphics become baked textures, from outside MapView. The scene is fake (test/fakes.ts).
import { describe, expect, it, vi } from "vitest";
import { bakeMapView, commandBounds } from "../src/render/mapBake";
import { argsOf, fakeScene } from "./fakes";

// Phaser's Graphics command ids: FILL_RECT 3, LINE_TO 4, MOVE_TO 5, LINE_STYLE 6, FILL_STYLE 7, ARC 0, TRANSLATE 16, BEGIN_PATH 1, STROKE_PATH 9.
const FILL_STYLE = (color: number, alpha = 1) => [7, color, alpha];
const FILL_RECT = (x: number, y: number, w: number, h: number) => [3, x, y, w, h];

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

  it("bakes the floor and the wall rows, and leaves the gates, the open-gate mark and anything it cannot read alone", () => {
    const { scene, baked } = fakeScene();
    const objs = [floor, wall, closedGate, openMark, odd].map((o) => ({ ...o, destroy: vi.fn() }));
    bakeMapView(scene, mapView(objs), 2);
    expect(objs.map((o) => o.destroy.mock.calls.length)).toEqual([1, 1, 0, 0, 0]);
    expect(baked.size).toBe(2);
  });

  it("takes the floor at one texel per pixel and the walls at the camera's density, up to 2", () => {
    const { scene, baked } = fakeScene();
    const w = { ...wall, destroy: vi.fn() };
    const f = { ...floor, destroy: vi.fn() };
    bakeMapView(scene, mapView([f, w]), 1.37);
    // The floor box is 2048 x 1638 world pixels; the wall row is 64 x 28 (+ nothing: plain rectangles).
    const sizes = [...baked.values()].map((b) => b.size);
    expect(sizes).toContainEqual([2048, 1638]);
    expect(sizes).toContainEqual([96, 42]);
    bakeMapView(scene, mapView([{ ...w, destroy: vi.fn() }]), 3);
    expect([...baked.values()].map((b) => b.size)).toContainEqual([128, 56]);
  });

  it("shows each baked drawing as an Image where it was, at its depth, one world pixel per 1/scale texels", () => {
    const { scene, ofKind } = fakeScene();
    bakeMapView(scene, mapView([{ ...wall, destroy: vi.fn() }]), 2);
    const img = ofKind("image")[0]!;
    expect(img.args.slice(0, 2)).toEqual([32, 56]);
    expect(argsOf(img, "setOrigin")[0]).toEqual([0, 0]);
    expect(img.state.scale).toBe(1 / 2);
    expect(img.state.depth).toBe(96);
  });

  it("cuts a drawing wider than a texture can be into chunks side by side", () => {
    const { scene, baked, ofKind } = fakeScene();
    const wide = graphics(-1e6, [...FILL_STYLE(0), ...FILL_RECT(0, 0, 5000, 100)]);
    bakeMapView(scene, mapView([wide]), 1);
    expect(baked.size).toBe(2);
    const xs = ofKind("image").map((i) => i.args[0]);
    expect(xs).toEqual([0, 4096]);
    expect([...baked.values()].map((b) => b.size[0])).toEqual([4096, 904]);
  });

  it("frees its images and textures when the map is dropped", () => {
    const { scene, baked, ofKind } = fakeScene();
    const handle = bakeMapView(scene, mapView([{ ...wall, destroy: vi.fn() }]), 2);
    expect(baked.size).toBe(1);
    handle.destroy();
    expect(baked.size).toBe(0);
    expect(argsOf(ofKind("image")[0]!, "destroy")).toHaveLength(1);
  });
});

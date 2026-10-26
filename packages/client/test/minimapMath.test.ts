// The minimap's pure maths: pointer -> world and back (at any element size and place), the camera's view rectangle on the map,
// and the sizing rules. No DOM.
import { describe, expect, it } from "vitest";
import { WORLD_H, WORLD_W, Y_SCALE } from "@raid/shared";
import {
  MINIMAP_MAX, MINIMAP_MIN, mapSpan, minimapBacking, minimapSize, minimapToWorld, viewRectOnMinimap, worldToMinimap,
  type ClientRect,
} from "../src/ui/minimapMath";

const SPAN = Math.max(WORLD_W, WORLD_H);
const rect = (left: number, top: number, size: number): ClientRect => ({ left, top, width: size, height: size });

describe("minimapToWorld", () => {
  it("maps the corners and the centre of the rect onto the map's square", () => {
    const r = rect(100, 50, 200);
    expect(minimapToWorld(100, 50, r)).toEqual({ x: 0, y: 0 });
    expect(minimapToWorld(200, 150, r)).toEqual({ x: SPAN / 2, y: SPAN / 2 });
    expect(minimapToWorld(300, 250, r)).toEqual({ x: Math.min(SPAN, WORLD_W), y: Math.min(SPAN, WORLD_H) });
  });

  it("clamps a pointer outside the element (a captured drag) into the world", () => {
    const r = rect(100, 50, 200);
    expect(minimapToWorld(-500, -500, r)).toEqual({ x: 0, y: 0 });
    expect(minimapToWorld(9000, 9000, r)).toEqual({ x: WORLD_W, y: WORLD_H });
    expect(minimapToWorld(9000, 150, r)).toEqual({ x: WORLD_W, y: SPAN / 2 });
  });

  it("reads the pointer as a fraction of the rect, so a resize or a move of the element changes nothing", () => {
    // The overlay is CSS-scaled: the same minimap is 180 screen px wide at one window size and 270 at another.
    const small = rect(1000, 600, 180);
    const big = rect(1500, 120, 270);
    for (const [fx, fy] of [[0.1, 0.9], [0.5, 0.5], [0.77, 0.33]] as const) {
      const a = minimapToWorld(small.left + fx * small.width, small.top + fy * small.height, small);
      const b = minimapToWorld(big.left + fx * big.width, big.top + fy * big.height, big);
      expect(b.x).toBeCloseTo(a.x, 6);
      expect(b.y).toBeCloseTo(a.y, 6);
      expect(a.x).toBeCloseTo(fx * SPAN, 6);
    }
  });

  it("uses the longer world side for both axes and clamps the shorter one to its extent", () => {
    // A 400 x 200 world is drawn into a 400-unit square whose lower half is empty.
    const r = rect(0, 0, 100);
    expect(mapSpan(400, 200)).toBe(400);
    expect(minimapToWorld(50, 25, r, 400, 200)).toEqual({ x: 200, y: 100 });
    expect(minimapToWorld(50, 90, r, 400, 200)).toEqual({ x: 200, y: 200 });
  });

  it("answers the origin for a rect with no size yet", () => {
    expect(minimapToWorld(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe("worldToMinimap", () => {
  it("is the inverse of minimapToWorld", () => {
    for (const r of [rect(0, 0, 150), rect(1666.5, 612.25, 240), rect(40, 900, 373)]) {
      for (const [x, y] of [[0, 0], [123.4, 1999], [WORLD_W, WORLD_H], [WORLD_W / 2, WORLD_H / 3]] as const) {
        const p = worldToMinimap(x, y, r);
        const back = minimapToWorld(p.x, p.y, r);
        expect(back.x).toBeCloseTo(x, 6);
        expect(back.y).toBeCloseTo(y, 6);
      }
    }
  });

  it("places a world point inside the rect", () => {
    const r = rect(1000, 600, 200);
    expect(worldToMinimap(0, 0, r)).toEqual({ x: 1000, y: 600 });
    expect(worldToMinimap(SPAN, SPAN, r)).toEqual({ x: 1200, y: 800 });
    expect(worldToMinimap(SPAN / 2, SPAN / 4, r)).toEqual({ x: 1100, y: 650 });
  });
});

describe("viewRectOnMinimap", () => {
  const visW = 1440;
  const visH = 900;

  it("centres the camera's view on the camera's ground position", () => {
    // The camera sits at the middle of the map: projected y is ground y times Y_SCALE.
    const r = viewRectOnMinimap({ x: WORLD_W / 2, y: (WORLD_H / 2) * Y_SCALE }, visW, visH);
    expect(r.x + r.w / 2).toBeCloseTo(WORLD_W / 2 / SPAN, 9);
    expect(r.y + r.h / 2).toBeCloseTo(WORLD_H / 2 / SPAN, 9);
  });

  it("is as wide as the visible width and taller than the screen's proportions by 1 / Y_SCALE", () => {
    const r = viewRectOnMinimap({ x: 700, y: 600 }, visW, visH);
    expect(r.w).toBeCloseTo(visW / SPAN, 9);
    expect(r.h).toBeCloseTo(visH / Y_SCALE / SPAN, 9);
  });

  it("follows the camera: a peek elsewhere moves the rectangle by the same ground distance", () => {
    const a = viewRectOnMinimap({ x: 500, y: 400 }, visW, visH);
    const b = viewRectOnMinimap({ x: 1300, y: 400 + 160 * Y_SCALE }, visW, visH);
    expect(b.x - a.x).toBeCloseTo(800 / SPAN, 9);
    expect(b.y - a.y).toBeCloseTo(160 / SPAN, 9);
    expect(b.w).toBeCloseTo(a.w, 9);
  });

  it("is not clamped: near the map's edge it hangs off the map", () => {
    const r = viewRectOnMinimap({ x: 0, y: 0 }, visW, visH);
    expect(r.x).toBeCloseTo(-visW / 2 / SPAN, 9);
    expect(r.y).toBeLessThan(0);
  });

  it("is a fraction of the minimap, so any element size scales it the same way", () => {
    const r = viewRectOnMinimap({ x: 900, y: 700 }, visW, visH);
    for (const size of [150, 240, 561]) {
      expect(r.w * size).toBeCloseTo((visW / SPAN) * size, 6);
    }
  });
});

describe("minimapSize", () => {
  it("is about a quarter of the overlay's height, 150 to 240", () => {
    expect(minimapSize(1280, 800)).toBe(208);
    expect(minimapSize(1280, 400)).toBe(MINIMAP_MIN);
    expect(minimapSize(3000, 2000)).toBe(MINIMAP_MAX);
  });

  it("shrinks on a narrow overlay rather than run into the centred weapon bar", () => {
    expect(minimapSize(600, 1000)).toBe(171);
    const size = minimapSize(500, 1000);
    expect(size).toBeLessThan(MINIMAP_MIN);
    // Its left edge stays right of the bar's right edge (half of the 214 px bar, from the centre).
    expect(500 - 12 - size).toBeGreaterThanOrEqual(500 / 2 + 107);
    expect(minimapSize(300, 1000)).toBe(110);
  });
});

describe("minimapBacking", () => {
  it("is the element's device-pixel size: overlay size times the overlay's scale times dpr", () => {
    expect(minimapBacking(200, 1, 1)).toBe(200);
    expect(minimapBacking(200, 1.5, 2)).toBe(600);
    expect(minimapBacking(208, 1.35, 2)).toBe(562);
  });

  it("stays within sane bounds", () => {
    expect(minimapBacking(240, 1.5, 2)).toBe(720);
    expect(minimapBacking(240, 10, 10)).toBe(1024);
    expect(minimapBacking(1, 0.1, 1)).toBe(32);
  });
});

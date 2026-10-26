import { describe, expect, it } from "vitest";
import {
  MAX_ASPECT, MAX_DPR, MAX_PIXELS, MAX_TEXT_RESOLUTION, MIN_ASPECT, REF_VIEW_H, UI_SCALE_MAX, UI_SCALE_MIN,
  computeLayout, layoutsEqual, screenToWorld, scrollForTopLeft, stageFor, textResolution, topLeftForScroll,
  type ViewInput,
} from "../src/view/viewport";

const layout = (cssW: number, cssH: number, dpr = 1, hiDpi = true) => computeLayout({ cssW, cssH, dpr, hiDpi });

describe("stage", () => {
  it("is the whole window up to 21:9", () => {
    for (const [w, h] of [[1920, 1080], [1440, 900], [1366, 768], [2520, 1080], [1000, 1000], [600, 900]] as const) {
      const l = layout(w, h);
      expect(l.stage).toEqual({ x: 0, y: 0, w, h });
      expect(l.clamped).toBe(false);
    }
  });

  it("clamps a wider window to 21:9, centred, full height", () => {
    const l = layout(3440, 1440);
    expect(l.clamped).toBe(true);
    expect(l.stage.h).toBe(1440);
    expect(l.stage.w).toBe(Math.floor(1440 * MAX_ASPECT));
    expect(l.stage.x).toBe(Math.floor((3440 - l.stage.w) / 2));
    // equal bars either side (to within the pixel lost to rounding)
    expect(Math.abs(l.stage.x - (3440 - l.stage.x - l.stage.w))).toBeLessThanOrEqual(1);
  });

  it("clamps 32:9 to the same stage shape as 21:9, with the same world height", () => {
    const wide = layout(5120, 1440);
    expect(wide.clamped).toBe(true);
    expect(wide.stage.w).toBe(3360);
    expect(wide.stage.x).toBe(880);
    expect(wide.worldH).toBeCloseTo(layout(3360, 1440).worldH, 9);
    expect(wide.worldW).toBeCloseTo(layout(3360, 1440).worldW, 9);
  });

  it("floors and never goes below one pixel", () => {
    expect(stageFor(1280.9, 720.9)).toMatchObject({ w: 1280, h: 720 });
    expect(stageFor(0, 0)).toMatchObject({ w: 1, h: 1, clamped: false });
    expect(layout(NaN, Infinity)).toMatchObject({ cssW: 1, cssH: 1 });
  });
});

describe("world size", () => {
  it("shows the same world height at every aspect from 4:3 up, and more width the wider the window", () => {
    let previousWidth = 0;
    for (const aspect of [MIN_ASPECT, 1.5, 16 / 10, 16 / 9, 2, MAX_ASPECT, 3, 32 / 9]) {
      const l = layout(Math.round(900 * aspect), 900);
      expect(l.worldH).toBeCloseTo(REF_VIEW_H, 6);
      expect(l.worldW).toBeGreaterThanOrEqual(previousWidth - 1e-6);
      previousWidth = l.worldW;
    }
  });

  it("is the same at every window height (zoom follows the height)", () => {
    for (const h of [480, 600, 768, 900, 1080, 1440, 2160]) {
      const w = Math.round(h * 16 / 9);
      const l = layout(w, h);
      expect(l.worldH).toBeCloseTo(REF_VIEW_H, 6);
      expect(l.worldW).toBeCloseTo(w * REF_VIEW_H / h, 6);
    }
  });

  it("keeps MIN_ASPECT worth of width in a narrower window, and shows more height instead", () => {
    const square = layout(900, 900);
    expect(square.worldW).toBeCloseTo(REF_VIEW_H * MIN_ASPECT, 6);
    expect(square.worldH).toBeCloseTo(REF_VIEW_H * MIN_ASPECT, 6);
    const tall = layout(600, 1000);
    expect(tall.worldW).toBeCloseTo(REF_VIEW_H * MIN_ASPECT, 6);
    expect(tall.worldH).toBeGreaterThan(REF_VIEW_H);
  });

  it("is a 4:3 window's exact fit", () => {
    const l = layout(800, 600);
    expect(l.worldW).toBeCloseTo(1200, 6);
    expect(l.worldH).toBeCloseTo(900, 6);
    expect(l.zoom).toBeCloseTo(2 / 3, 9);
  });

  it("does not stretch: world pixels are square on the canvas", () => {
    for (const [w, h, dpr] of [[1920, 1080, 1], [1440, 900, 2], [900, 900, 1], [3440, 1440, 1], [1366, 768, 1.25]] as const) {
      const l = layout(w, h, dpr);
      expect(l.deviceW / l.worldW).toBeCloseTo(l.zoom, 2);
      expect(l.deviceH / l.worldH).toBeCloseTo(l.zoom, 2);
    }
  });
});

describe("device pixels", () => {
  it("renders at the device ratio, capped at MAX_DPR", () => {
    const l = layout(1440, 900, 2);
    expect(l.dpr).toBe(2);
    expect(l.deviceW).toBe(2880);
    expect(l.deviceH).toBe(1800);
    expect(l.zoom).toBeCloseTo(2, 9);
    expect(layout(1440, 900, 3).dpr).toBe(MAX_DPR);
    expect(layout(1440, 900, 3).deviceW).toBe(1440 * MAX_DPR);
  });

  it("keeps the backing store within MAX_PIXELS, dropping the ratio on a big window", () => {
    const big = layout(3440, 1440, 2);
    expect(big.dpr).toBeGreaterThan(1);
    expect(big.dpr).toBeLessThan(MAX_DPR);
    expect(big.deviceW * big.deviceH).toBeLessThanOrEqual(MAX_PIXELS * 1.001);
    expect(layout(5120, 2880, 2).dpr).toBe(1);
    const laptop = layout(1440, 900, 2);
    expect(laptop.dpr).toBe(2);
  });

  it("is 1 canvas pixel per CSS pixel with hiDpi off", () => {
    const l = layout(1440, 900, 2, false);
    expect(l.dpr).toBe(1);
    expect(l.deviceW).toBe(1440);
    expect(l.zoom).toBeCloseTo(1, 9);
  });

  it("falls back to 1 for a garbage ratio", () => {
    for (const bad of [0, -2, NaN, Infinity, -Infinity]) expect(layout(1000, 700, bad).dpr).toBe(1);
    expect(layout(1000, 700, 0.5).dpr).toBe(1);
  });

  it("rounds fractional ratios to whole backing pixels", () => {
    const l = layout(1001, 601, 1.5);
    expect(l.deviceW).toBe(Math.round(1001 * 1.5));
    expect(l.deviceH).toBe(Math.round(601 * 1.5));
  });

  it("sizes the backing store from the stage, not the window", () => {
    const l = layout(3440, 1440, 1);
    expect(l.stage.w).toBeLessThan(3440);
    expect(l.deviceW).toBe(l.stage.w);
    expect(l.deviceH).toBe(1440);
    const hi = layout(2000, 1000, 2);
    expect(hi.deviceW).toBe(hi.stage.w * 2);
    expect(hi.deviceH).toBe(2000);
  });
});

describe("overlay scale", () => {
  it("clamps to its range and lays the overlay out at stage size / scale", () => {
    const small = layout(400, 300);
    expect(small.uiScale).toBe(UI_SCALE_MIN);
    expect(small.uiW).toBeCloseTo(400 / UI_SCALE_MIN, 9);
    const huge = layout(5000, 2500);
    expect(huge.uiScale).toBe(UI_SCALE_MAX);
    expect(huge.uiH).toBeCloseTo(huge.stage.h / UI_SCALE_MAX, 9);
  });

  it("is 1 at the design size and follows the tighter axis between", () => {
    expect(layout(1280, 800).uiScale).toBe(1);
    expect(layout(1920, 800).uiScale).toBe(1);
    expect(layout(1024, 1024).uiScale).toBeCloseTo(0.8, 9);
    expect(layout(1600, 1000).uiScale).toBeCloseTo(1.25, 9);
  });

  it("scales the overlay by the stage, so bars do not enlarge it", () => {
    const l = layout(5120, 1440);
    expect(l.uiW * l.uiScale).toBeCloseTo(l.stage.w, 9);
    expect(l.uiH * l.uiScale).toBeCloseTo(l.stage.h, 9);
  });
});

describe("a resize is the same function with new inputs", () => {
  const input: ViewInput = { cssW: 1440, cssH: 900, dpr: 2, hiDpi: true };

  it("recomputes everything from the new window", () => {
    const before = computeLayout(input);
    const after = computeLayout({ ...input, cssW: 1920, cssH: 1080 });
    expect(after.deviceW).toBe(3840);
    expect(after.zoom).not.toBe(before.zoom);
    expect(after.worldH).toBeCloseTo(before.worldH, 6);
    expect(layoutsEqual(before, after)).toBe(false);
  });

  it("is deterministic: the same inputs are an equal layout", () => {
    expect(layoutsEqual(computeLayout(input), computeLayout({ ...input }))).toBe(true);
  });

  it("notices a moved stage, a changed ratio and a changed overlay scale, one at a time", () => {
    const base = computeLayout({ cssW: 3440, cssH: 1440, dpr: 1, hiDpi: true });
    expect(layoutsEqual(base, computeLayout({ cssW: 3442, cssH: 1440, dpr: 1, hiDpi: true }))).toBe(false);
    expect(layoutsEqual(base, computeLayout({ cssW: 3440, cssH: 1440, dpr: 2, hiDpi: true }))).toBe(false);
    expect(layoutsEqual(base, computeLayout({ cssW: 3440, cssH: 1441, dpr: 1, hiDpi: true }))).toBe(false);
  });

  it("treats hiDpi as no change on a 1x screen and as a change on a 2x one", () => {
    const one = (hiDpi: boolean) => computeLayout({ cssW: 1280, cssH: 720, dpr: 1, hiDpi });
    const two = (hiDpi: boolean) => computeLayout({ cssW: 1280, cssH: 720, dpr: 2, hiDpi });
    expect(layoutsEqual(one(true), one(false))).toBe(true);
    expect(layoutsEqual(two(true), two(false))).toBe(false);
  });
});

describe("text resolution", () => {
  it("is the zoom rounded up, from 1 to MAX_TEXT_RESOLUTION", () => {
    expect(textResolution(0.5)).toBe(1);
    expect(textResolution(1)).toBe(1);
    expect(textResolution(1.0000000002)).toBe(1);
    expect(textResolution(1.2)).toBe(2);
    expect(textResolution(2)).toBe(2);
    expect(textResolution(2.4)).toBe(3);
    expect(textResolution(9)).toBe(MAX_TEXT_RESOLUTION);
    expect(textResolution(NaN)).toBe(1);
  });
});

describe("camera maths", () => {
  /** Phaser's camera: screen = origin + zoom * (world - scroll - origin), origin the middle (Camera.preRender, getWorldPoint inverts it). */
  function phaserWorldPoint(px: number, py: number, scrollX: number, scrollY: number, camW: number, camH: number, zoom: number) {
    const ox = camW * 0.5;
    const oy = camH * 0.5;
    return { x: (px - ox) / zoom + ox + scrollX, y: (py - oy) / zoom + oy + scrollY };
  }

  const cams: Array<[number, number, number]> = [[1440, 900, 1], [2880, 1800, 2], [1920, 1080, 1.2], [800, 600, 2 / 3], [6720, 2880, 2]];

  it("screenToWorld matches Phaser's getWorldPoint at any zoom", () => {
    for (const [w, h, zoom] of cams) {
      for (const [px, py, sx, sy] of [[0, 0, 0, 0], [w / 2, h / 2, 100, -50], [w, h, -300, 200], [123.5, 77.25, 40.5, 90]]) {
        const ours = screenToWorld(px!, py!, sx!, sy!, w, h, zoom);
        const theirs = phaserWorldPoint(px!, py!, sx!, sy!, w, h, zoom);
        expect(ours.x).toBeCloseTo(theirs.x, 9);
        expect(ours.y).toBeCloseTo(theirs.y, 9);
      }
    }
  });

  it("is the plain scroll plus the pixel at zoom 1", () => {
    expect(screenToWorld(10, 20, 100, 200, 1440, 900, 1)).toEqual({ x: 110, y: 220 });
  });

  it("scrollForTopLeft and topLeftForScroll are inverses", () => {
    for (const [w, h, zoom] of cams) {
      const s = scrollForTopLeft(250, -80, w, h, zoom);
      const tl = topLeftForScroll(s.x, s.y, w, h, zoom);
      expect(tl.x).toBeCloseTo(250, 9);
      expect(tl.y).toBeCloseTo(-80, 9);
    }
  });

  it("puts the wanted world point at the screen's top-left corner", () => {
    for (const [w, h, zoom] of cams) {
      const s = scrollForTopLeft(-120, 35, w, h, zoom);
      const corner = screenToWorld(0, 0, s.x, s.y, w, h, zoom);
      expect(corner.x).toBeCloseTo(-120, 9);
      expect(corner.y).toBeCloseTo(35, 9);
      // and the far corner is one visible world size away
      const far = screenToWorld(w, h, s.x, s.y, w, h, zoom);
      expect(far.x).toBeCloseTo(-120 + w / zoom, 9);
      expect(far.y).toBeCloseTo(35 + h / zoom, 9);
    }
  });

  it("centerOn's scroll (centre minus half the canvas) puts that point under the middle at any zoom", () => {
    for (const [w, h, zoom] of cams) {
      const mid = screenToWorld(w / 2, h / 2, 500 - w / 2, 300 - h / 2, w, h, zoom);
      expect(mid.x).toBeCloseTo(500, 9);
      expect(mid.y).toBeCloseTo(300, 9);
    }
  });
});

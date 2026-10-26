// The juice switches (render/juice.ts): the on/off and intensity rule, the reduced-motion query and the easing helpers.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JUICE_ENABLED, JUICE_INTENSITY, clamp01, decay, easeInOutSine, easeOutCubic, juiceScale, juiceScaleFor, lerp, prefersReducedMotion,
  resetReducedMotionCache,
} from "../src/render/juice";

afterEach(() => {
  vi.unstubAllGlobals();
  resetReducedMotionCache();
});

describe("juiceScaleFor", () => {
  it("is 0 for everything while juice is off, or at no intensity", () => {
    for (const kind of ["motion", "flash"] as const) {
      expect(juiceScaleFor(kind, false, 1, false)).toBe(0);
      expect(juiceScaleFor(kind, true, 0, false)).toBe(0);
      expect(juiceScaleFor(kind, true, -1, false)).toBe(0);
      expect(juiceScaleFor(kind, true, Number.NaN, false)).toBe(0);
    }
  });

  it("scales both kinds by the intensity", () => {
    expect(juiceScaleFor("motion", true, 1, false)).toBe(1);
    expect(juiceScaleFor("motion", true, 0.5, false)).toBe(0.5);
    expect(juiceScaleFor("flash", true, 0.5, false)).toBe(0.5);
  });

  it("holds the intensity to 2", () => {
    expect(juiceScaleFor("motion", true, 9, false)).toBe(2);
  });

  it("takes reduced motion away from motion effects only: flashes stay", () => {
    expect(juiceScaleFor("motion", true, 1, true)).toBe(0);
    expect(juiceScaleFor("flash", true, 1, true)).toBe(1);
    expect(juiceScaleFor("flash", true, 0.5, true)).toBe(0.5);
  });
});

describe("juice defaults", () => {
  it("ships on at full intensity", () => {
    expect(JUICE_ENABLED).toBe(true);
    expect(JUICE_INTENSITY).toBe(1);
  });
});

describe("juiceScale and the reduced-motion query", () => {
  it("shows everything where there is no matchMedia (node, a test)", () => {
    expect(prefersReducedMotion()).toBe(false);
    expect(juiceScale("motion")).toBe(JUICE_INTENSITY);
    expect(juiceScale("flash")).toBe(JUICE_INTENSITY);
  });

  it("asks the right question and takes the motion effects away when it is yes", () => {
    const query = { matches: true };
    const matchMedia = vi.fn(() => query);
    vi.stubGlobal("matchMedia", matchMedia);
    expect(juiceScale("motion")).toBe(0);
    expect(juiceScale("flash")).toBe(JUICE_INTENSITY);
    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
  });

  it("keeps the query list and follows it live (a change in the settings needs no reload)", () => {
    const query = { matches: false };
    const matchMedia = vi.fn(() => query);
    vi.stubGlobal("matchMedia", matchMedia);
    expect(juiceScale("motion")).toBe(JUICE_INTENSITY);
    query.matches = true;
    expect(juiceScale("motion")).toBe(0);
    query.matches = false;
    expect(juiceScale("motion")).toBe(JUICE_INTENSITY);
    expect(matchMedia).toHaveBeenCalledTimes(1);
  });

  it("does not fall over when matchMedia throws or is not a function", () => {
    vi.stubGlobal("matchMedia", () => { throw new Error("no"); });
    expect(prefersReducedMotion()).toBe(false);
    resetReducedMotionCache();
    vi.stubGlobal("matchMedia", 5);
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("easing", () => {
  it("clamps to 0..1", () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(9)).toBe(1);
  });

  it("lerps", () => {
    expect(lerp(2, 6, 0)).toBe(2);
    expect(lerp(2, 6, 0.25)).toBe(3);
    expect(lerp(2, 6, 1)).toBe(6);
  });

  it("eases out and in-out from 0 to 1 and holds outside", () => {
    for (const f of [easeOutCubic, easeInOutSine]) {
      expect(f(0)).toBeCloseTo(0, 12);
      expect(f(1)).toBeCloseTo(1, 12);
      expect(f(-1)).toBeCloseTo(0, 12);
      expect(f(2)).toBeCloseTo(1, 12);
    }
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(easeInOutSine(0.5)).toBeCloseTo(0.5, 12);
    expect(easeInOutSine(0.25)).toBeLessThan(0.25);
  });

  it("decays by the time constant", () => {
    expect(decay(0, 100)).toBe(1);
    expect(decay(100, 100)).toBeCloseTo(Math.exp(-1), 12);
    expect(decay(-5, 100)).toBe(1);
  });
});

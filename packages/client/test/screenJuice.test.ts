// ScreenJuice keeps the interpolated world clock continuous and limits local combat juice to camera shake.
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetReducedMotionCache } from "../src/render/juice";
import {
  HURT_MIN_SHARE, HURT_SHAKE_MAX, HURT_SHAKE_MIN, HURT_SHAKE_MS, LANDED_SHAKE, LANDED_SHAKE_MS, ScreenJuice,
} from "../src/render/screenJuice";

afterEach(() => {
  vi.unstubAllGlobals();
  resetReducedMotionCache();
});

function setup(zoom?: number) {
  const shakes: Array<[number, number, boolean | undefined]> = [];
  const juice = new ScreenJuice({ shake: (d, i, f) => { shakes.push([d, i, f]); }, ...(zoom === undefined ? {} : { zoom }) });
  return { juice, shakes };
}

describe("ScreenJuice", () => {
  it("passes every incoming render time through unchanged, including after rapid local hits", () => {
    const { juice } = setup();
    expect(juice.worldTime(1000, 0)).toBe(1000);
    juice.landed(0);
    expect(juice.worldTime(1016, 16)).toBe(1016);
    juice.hurt(100, 1000);
    expect(juice.worldTime(1032, 32)).toBe(1032);
    juice.landed(40);
    expect(juice.worldTime(1048, 48)).toBe(1048);
    expect(juice.worldTime(1100, 100)).toBe(1100);
  });

  it("nudges the camera a little on a landed hit, without restarting a shake already running", () => {
    const { juice, shakes } = setup();
    juice.worldTime(1000, 0);
    juice.landed(0);
    expect(shakes).toEqual([[LANDED_SHAKE_MS, LANDED_SHAKE, false]]);
    expect(LANDED_SHAKE).toBeLessThan(0.003);
  });

  it("keeps the shake the same share of the screen at any camera zoom (Phaser applies the zoom to the offset twice)", () => {
    const one = setup(1);
    const two = setup(2);
    one.juice.worldTime(1000, 0);
    two.juice.worldTime(1000, 0);
    one.juice.landed(0);
    two.juice.landed(0);
    expect(two.shakes[0]![1]).toBeCloseTo(one.shakes[0]![1] / 4, 12);
    const hurt = setup(3);
    hurt.juice.hurt(900, 1000);
    expect(hurt.shakes[0]![1]).toBeCloseTo(HURT_SHAKE_MAX / 9, 12);
  });

  it("shakes harder for a bigger blow, within bounds, and not at all for a graze", () => {
    const { juice, shakes } = setup();
    juice.hurt(10, 1000);
    expect(shakes).toEqual([]);
    juice.hurt(1000 * HURT_MIN_SHARE, 1000);
    juice.hurt(150, 1000);
    juice.hurt(900, 1000);
    expect(shakes.map(([d]) => d)).toEqual([HURT_SHAKE_MS, HURT_SHAKE_MS, HURT_SHAKE_MS]);
    const [small, mid, big] = shakes.map(([, i]) => i);
    expect(small!).toBeGreaterThanOrEqual(HURT_SHAKE_MIN);
    expect(mid!).toBeGreaterThan(small!);
    expect(big!).toBeCloseTo(HURT_SHAKE_MAX, 12);
    expect(HURT_SHAKE_MAX).toBeLessThan(0.006);
  });

  it("ignores damage against no max hp", () => {
    const { juice, shakes } = setup();
    juice.hurt(500, 0);
    juice.hurt(Number.NaN, 1000);
    expect(shakes).toEqual([]);
  });

  it("does not shake under reduced motion and never changes render time", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { juice, shakes } = setup();
    juice.worldTime(1000, 0);
    juice.landed(0);
    juice.hurt(900, 1000);
    expect(shakes).toEqual([]);
    expect(juice.worldTime(1016, 16)).toBe(1016);
  });

  it("keeps its render time stateless across reset", () => {
    const { juice } = setup();
    juice.worldTime(1000, 0);
    juice.landed(0);
    juice.reset();
    expect(juice.worldTime(1016, 16)).toBe(1016);
  });
});

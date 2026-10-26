// The hit-stop and the camera shake (render/screenJuice.ts): when the world's draw time holds, how it catches up, and that
// the shake is small, scaled with the damage and gone under reduced motion.
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetReducedMotionCache } from "../src/render/juice";
import {
  HIT_STOP_CATCHUP, HIT_STOP_GAP_MS, HIT_STOP_MAX_MS, HIT_STOP_MS, HURT_MIN_SHARE, HURT_SHAKE_MAX, HURT_SHAKE_MIN, HURT_SHAKE_MS,
  HitStop, LANDED_SHAKE, LANDED_SHAKE_MS, ScreenJuice,
} from "../src/render/screenJuice";

afterEach(() => {
  vi.unstubAllGlobals();
  resetReducedMotionCache();
});

/** Frames of 16 ms of both clocks: render time starts at `t0` and real time at `n0`; returns what `apply` gave each frame. */
function frames(h: HitStop, count: number, t0: number, n0: number, dt = 16): number[] {
  const out: number[] = [];
  for (let i = 1; i <= count; i++) out.push(h.apply(t0 + i * dt, n0 + i * dt));
  return out;
}

describe("HitStop", () => {
  it("passes render time straight through while nothing holds it", () => {
    const h = new HitStop();
    expect(h.apply(1000, 0)).toBe(1000);
    expect(frames(h, 5, 1000, 0)).toEqual([1016, 1032, 1048, 1064, 1080]);
    expect(h.lagging).toBe(false);
  });

  it("refuses to hold before it has seen a frame", () => {
    const h = new HitStop();
    expect(h.trigger(0)).toBe(false);
  });

  it("holds the drawn time still for the hold, then catches up at twice the pace and is level again", () => {
    const h = new HitStop();
    h.apply(1000, 0);
    expect(h.trigger(0, HIT_STOP_MS)).toBe(true);
    const out = frames(h, 12, 1000, 0);
    // 50 ms of real time: frames at 16, 32, 48 stand still at 1000...
    expect(out.slice(0, 3)).toEqual([1000, 1000, 1000]);
    // ...then it runs ahead of render time's own pace until it meets it.
    expect(out[3]!).toBeGreaterThan(1000);
    for (let i = 1; i < out.length; i++) expect(out[i]!).toBeGreaterThanOrEqual(out[i - 1]!);
    const lag = out.map((d, i) => 1000 + (i + 1) * 16 - d);
    expect(Math.max(...lag)).toBeLessThanOrEqual(HIT_STOP_MS + 16);
    expect(out[out.length - 1]).toBe(1000 + 12 * 16);
    expect(h.lagging).toBe(false);
  });

  it("closes the gap at the catch-up rate", () => {
    const h = new HitStop();
    h.apply(0, 0);
    h.trigger(0, 50);
    // Held through t = 48 (3 frames of the 50 ms), then every frame gains (CATCHUP - 1) x 16 ms on render time.
    frames(h, 3, 0, 0);
    expect(h.lagging).toBe(true);
    const d = h.apply(64, 64);
    expect(64 - d).toBeCloseTo(48 - 16 * (HIT_STOP_CATCHUP - 1), 9);
  });

  it("keeps a gap between holds", () => {
    const h = new HitStop();
    h.apply(0, 0);
    expect(h.trigger(0, 50)).toBe(true);
    frames(h, 20, 0, 0); // level again by 320 ms
    expect(h.trigger(100, 50)).toBe(false); // inside the first hold's gap
    expect(h.trigger(50 + HIT_STOP_GAP_MS - 1, 50)).toBe(false);
    expect(h.trigger(50 + HIT_STOP_GAP_MS, 50)).toBe(true);
  });

  it("never holds longer than the cap, however long it is asked to", () => {
    const h = new HitStop();
    h.apply(0, 0);
    expect(h.trigger(0, 5000)).toBe(true);
    const out = frames(h, 20, 0, 0);
    const held = out.filter((d) => d === 0).length;
    expect(held * 16).toBeLessThanOrEqual(HIT_STOP_MAX_MS);
    expect(held).toBeGreaterThanOrEqual(Math.floor(HIT_STOP_MAX_MS / 16) - 1);
  });

  it("a jump in render time (a clock resync) drops the hold instead of dragging the world along", () => {
    const h = new HitStop();
    h.apply(1000, 0);
    h.trigger(0, 50);
    h.apply(1016, 16);
    expect(h.apply(9000, 32)).toBe(9000);
    expect(h.lagging).toBe(false);
    h.reset();
    expect(h.apply(500, 40)).toBe(500); // backwards
  });

  it("does not hold for a zero-length hold", () => {
    const h = new HitStop();
    h.apply(0, 0);
    expect(h.trigger(0, 0)).toBe(false);
  });
});

function setup(zoom?: number) {
  const shakes: Array<[number, number, boolean | undefined]> = [];
  const juice = new ScreenJuice({ shake: (d, i, f) => { shakes.push([d, i, f]); }, ...(zoom === undefined ? {} : { zoom }) });
  return { juice, shakes };
}

describe("ScreenJuice", () => {
  it("draws the world at render time, then holds it after a landed hit", () => {
    const { juice } = setup();
    expect(juice.worldTime(1000, 0)).toBe(1000);
    juice.landed(0);
    expect(juice.worldTime(1016, 16)).toBe(1000);
    expect(juice.worldTime(1032, 32)).toBe(1000);
    expect(juice.worldTime(1100, 100)).toBeGreaterThan(1000);
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

  it("does neither the hold nor the shake under reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { juice, shakes } = setup();
    juice.worldTime(1000, 0);
    juice.landed(0);
    juice.hurt(900, 1000);
    expect(shakes).toEqual([]);
    expect(juice.worldTime(1016, 16)).toBe(1016);
  });

  it("forgets a hold on reset", () => {
    const { juice } = setup();
    juice.worldTime(1000, 0);
    juice.landed(0);
    juice.reset();
    expect(juice.worldTime(1016, 16)).toBe(1016);
  });
});

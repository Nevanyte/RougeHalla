import { describe, expect, it } from "vitest";
import { brandLook, life, pulse } from "../src/render/signatureLook";

describe("brandLook", () => {
  it("is null for an unmarked fighter", () => {
    expect(brandLook(0)).toBeNull();
    expect(brandLook(-5)).toBeNull();
    expect(brandLook(Number.NaN)).toBeNull();
  });

  it("grows in size and opacity with the brand, and is complete only at 100", () => {
    let prev = brandLook(5)!;
    expect(prev.full).toBe(false);
    for (let b = 10; b <= 100; b += 5) {
      const cur = brandLook(b)!;
      expect(cur.rx).toBeGreaterThan(prev.rx);
      expect(cur.alpha).toBeGreaterThan(prev.alpha);
      expect(cur.strokes).toBeGreaterThanOrEqual(prev.strokes);
      expect(cur.full).toBe(b === 100);
      prev = cur;
    }
    expect(prev.alpha).toBeLessThanOrEqual(1);
  });

  it("lights one pentagram stroke per fifth of the brand", () => {
    const strokes = (b: number) => brandLook(b)!.strokes;
    expect([5, 20].map(strokes)).toEqual([1, 1]);
    expect([25, 40].map(strokes)).toEqual([2, 2]);
    expect([45, 60].map(strokes)).toEqual([3, 3]);
    expect([65, 80].map(strokes)).toEqual([4, 4]);
    expect([85, 100].map(strokes)).toEqual([5, 5]);
  });

  it("clamps beyond 100", () => {
    expect(brandLook(250)).toEqual(brandLook(100));
  });
});

describe("pulse and life", () => {
  it("pulse stays within its bounds and repeats every period", () => {
    for (let t = 0; t < 2000; t += 37) {
      const v = pulse(t, 2.5, 0.2, 0.9);
      expect(v).toBeGreaterThanOrEqual(0.2 - 1e-9);
      expect(v).toBeLessThanOrEqual(0.9 + 1e-9);
      expect(pulse(t + 400, 2.5, 0.2, 0.9)).toBeCloseTo(v, 6);
    }
  });

  it("life is a 0..1 sawtooth, with particles spread evenly", () => {
    for (let t = 0; t < 5000; t += 113) {
      for (let i = 0; i < 6; i++) {
        const p = life(t, 800, i, 6);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThan(1);
      }
    }
    expect(life(0, 800, 0, 4)).toBe(0);
    expect(life(0, 800, 1, 4)).toBeCloseTo(0.25, 9);
    expect(life(200, 800, 3, 4)).toBeCloseTo(0, 9);
  });
});

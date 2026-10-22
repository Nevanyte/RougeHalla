import { describe, expect, it } from "vitest";
import * as shared from "../src/index";
import { mulberry32, pick, randInt, randRange, shuffle } from "../src/rng";

// The canonical mulberry32 from the original gist, kept here as an independent reference.
function reference(seed: number): () => number {
  let a = seed;
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("mulberry32", () => {
  it("matches the reference implementation", () => {
    for (const seed of [0, 1, 42, 1234, 0x7fffffff, 0xdeadbeef]) {
      const a = mulberry32(seed);
      const b = reference(seed | 0);
      for (let i = 0; i < 1000; i++) expect(a()).toBe(b());
    }
  });

  it("returns floats in [0, 1)", () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 10000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is deterministic per seed and independent between instances", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const c = mulberry32(8);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    const seqC = Array.from({ length: 20 }, () => c());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
  });

  it("has a sane mean and spread", () => {
    const rng = mulberry32(2024);
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) sum += rng();
    expect(sum / n).toBeGreaterThan(0.48);
    expect(sum / n).toBeLessThan(0.52);
  });

  it("coerces negative and fractional seeds without throwing or producing NaN", () => {
    for (const seed of [-1, -123456, 1.5, NaN]) {
      const v = mulberry32(seed)();
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("randInt / randRange", () => {
  it("randInt covers [min, maxExclusive) and never leaves it", () => {
    const rng = mulberry32(5);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = randInt(rng, 3, 8);
      expect(Number.isInteger(v)).toBe(true);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
  });

  it("randInt with a one-wide range returns min and handles negatives", () => {
    const rng = mulberry32(5);
    expect(randInt(rng, 4, 5)).toBe(4);
    for (let i = 0; i < 200; i++) {
      const v = randInt(rng, -3, 2);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThan(2);
    }
  });

  it("randRange stays in [min, max)", () => {
    const rng = mulberry32(6);
    for (let i = 0; i < 2000; i++) {
      const v = randRange(rng, -2.5, 7.25);
      expect(v).toBeGreaterThanOrEqual(-2.5);
      expect(v).toBeLessThan(7.25);
    }
  });
});

describe("pick", () => {
  it("returns members, eventually all of them, deterministically", () => {
    const arr = ["a", "b", "c", "d"] as const;
    const rng = mulberry32(11);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(pick(rng, arr));
    expect([...seen].sort()).toEqual(["a", "b", "c", "d"]);
    expect(pick(mulberry32(3), arr)).toBe(pick(mulberry32(3), arr));
  });

  it("throws on an empty array", () => {
    expect(() => pick(mulberry32(1), [])).toThrow(RangeError);
  });
});

describe("shuffle", () => {
  it("shuffles in place, returns the same array, and keeps every element", () => {
    const arr = Array.from({ length: 30 }, (_, i) => i);
    const out = shuffle(mulberry32(21), arr);
    expect(out).toBe(arr);
    expect([...arr].sort((x, y) => x - y)).toEqual(Array.from({ length: 30 }, (_, i) => i));
    expect(arr).not.toEqual(Array.from({ length: 30 }, (_, i) => i));
  });

  it("is deterministic per seed and differs across seeds", () => {
    const base = Array.from({ length: 20 }, (_, i) => i);
    expect(shuffle(mulberry32(1), base.slice())).toEqual(shuffle(mulberry32(1), base.slice()));
    expect(shuffle(mulberry32(1), base.slice())).not.toEqual(shuffle(mulberry32(2), base.slice()));
  });

  it("handles empty and single-element arrays", () => {
    expect(shuffle(mulberry32(1), [])).toEqual([]);
    expect(shuffle(mulberry32(1), [9])).toEqual([9]);
  });

  it("is roughly uniform over permutations of three elements", () => {
    const rng = mulberry32(77);
    const counts = new Map<string, number>();
    const trials = 6000;
    for (let i = 0; i < trials; i++) {
      const key = shuffle(rng, [0, 1, 2]).join("");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    for (const c of counts.values()) {
      expect(c).toBeGreaterThan(trials / 6 * 0.8);
      expect(c).toBeLessThan(trials / 6 * 1.2);
    }
  });
});

describe("package index", () => {
  it("re-exports the new modules", () => {
    for (const name of [
      "mulberry32", "randInt", "randRange", "pick", "shuffle",
      "generateMap", "raycast", "hasLineOfSight", "segmentClear", "distPointToSegment", "findPath",
    ] as const) {
      expect(typeof shared[name]).toBe("function");
    }
  });
});

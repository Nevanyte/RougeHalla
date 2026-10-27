// Seeded RNG for shared code. Client and server both derive the world from a seed, so nothing here
// may touch Math.random or the clock.

export type Rng = () => number;

/** mulberry32: 32-bit state, returns floats in [0, 1). The seed is coerced with `>>> 0`. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One uint32 for an independent stream of a generator: `mulberry32(hashSeed(seed, attempt, zoneIndex, stream))`. Integer
 * mixing only (Math.imul, xor, shifts), so no engine can disagree on it, and each input reaches every output bit. Inputs
 * are coerced like `>>> 0` does for mulberry32 (seed 2^32 + 5 equals seed 5).
 */
export function hashSeed(seed: number, attempt: number, zoneIndex: number, stream: number): number {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) ^ Math.imul(attempt | 0, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) ^ Math.imul(zoneIndex | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) ^ Math.imul(stream | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Integer in [min, maxExclusive). */
export function randInt(rng: Rng, min: number, maxExclusive: number): number {
  return min + Math.floor(rng() * (maxExclusive - min));
}

/** Float in [min, max). */
export function randRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  if (arr.length === 0) throw new RangeError("pick: empty array");
  return arr[randInt(rng, 0, arr.length)];
}

/** Fisher-Yates, in place; returns the same array. */
export function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

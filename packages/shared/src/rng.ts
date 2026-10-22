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

// Distributions over a seeded Rng (shared mulberry32). Shared by the humanizer (delays, scatter) and the strategy (softmax).
// Nothing here reads a clock or Math.random: a brain replays exactly from its seed.
import type { Rng } from "@raid/shared";
import type { ExGaussian } from "./types";

export function uniform(rng: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

/** Box-Muller: one normal draw (two uniforms, the second half is discarded so the stream advances the same every call). */
export function gaussian(rng: Rng, mu = 0, sigma = 1): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return mu + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Exponential with the given mean. */
export function exponential(rng: Rng, mean: number): number {
  return -mean * Math.log(Math.max(1 - rng(), 1e-12));
}

/**
 * An ex-Gaussian delay in ms (a human reaction time: a Gaussian "motor" part plus an exponential tail of slow answers).
 * Below `floor` it is drawn again (a human cannot answer faster), above `cap` it is clamped. Bounded loop, so the stream
 * advances a bounded number of draws.
 */
export function exGaussian(rng: Rng, d: ExGaussian): number {
  for (let i = 0; i < 8; i++) {
    const v = gaussian(rng, d.mu, d.sigma) + exponential(rng, d.tau);
    if (v >= d.floor) return Math.min(v, d.cap);
  }
  return d.floor;
}

/** The mean of an ex-Gaussian before floor and cap (mu + tau): what the tier tables quote. */
export function exGaussianMean(d: ExGaussian): number {
  return d.mu + d.tau;
}

/** Softmax pick at temperature T over utilities (about 0..1): the index chosen. T <= 0 is argmax. Empty input returns -1. */
export function softmaxIndex(rng: Rng, utilities: readonly number[], temperature: number): number {
  const n = utilities.length;
  if (n === 0) return -1;
  let best = 0;
  for (let i = 1; i < n; i++) if (utilities[i]! > utilities[best]!) best = i;
  if (temperature <= 0 || n === 1) return best;
  const top = utilities[best]!;
  const weights = utilities.map((u) => Math.exp((u - top) / temperature));
  let sum = 0;
  for (const w of weights) sum += w;
  let r = rng() * sum;
  for (let i = 0; i < n; i++) {
    r -= weights[i]!;
    if (r <= 0) return i;
  }
  return best;
}

/**
 * The strategy's and tactics' option choice: softmax at `temperature`, but with probability `lapseP` take one of the top three
 * options uniformly instead (a slip of attention). `lapse` is the separate stream for that draw. Returns the index and whether
 * it was a lapse.
 */
export function pickOption(
  rng: Rng, lapse: Rng, utilities: readonly number[], temperature: number, lapseP: number,
): { index: number; lapsed: boolean } {
  const n = utilities.length;
  if (n === 0) return { index: -1, lapsed: false };
  if (n > 1 && lapse() < lapseP) {
    const order = utilities.map((u, i) => [u, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 3);
    const choice = order[Math.min(order.length - 1, Math.floor(lapse() * order.length))]!;
    return { index: choice[1], lapsed: true };
  }
  return { index: softmaxIndex(rng, utilities, temperature), lapsed: false };
}

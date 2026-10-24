// The numbers behind the signature visuals (SignatureArt draws them): pure and free of Phaser so they can be tested.
import { PLAYER_RADIUS } from "@raid/shared";

/** How far a Sentenced brand has grown, as the sigil's size, opacity and how many of the star's five strokes are lit. */
export interface BrandLook {
  /** 0..1 (brand / 100). */
  k: number;
  /** Horizontal radius of the ground ring in pixels (the ring is squashed by Y_SCALE like everything on the ground). */
  rx: number;
  /** Opacity of the sigil's lines. */
  alpha: number;
  /** Pentagram strokes drawn, 1..5: one per fifth of the brand, so growth reads even from far away. */
  strokes: number;
  /** The brand is complete: the sigil pulses and a ring radiates from it. */
  full: boolean;
}

/** Ring radius at the smallest brand step and the extra it grows by at 100. */
const BRAND_R_MIN = PLAYER_RADIUS + 6;
const BRAND_R_GROW = 16;

/** The brand look for a synced `brand` (0..100); null when the fighter is not marked. */
export function brandLook(brand: number): BrandLook | null {
  if (!(brand > 0)) return null;
  const k = Math.min(1, brand / 100);
  return {
    k,
    rx: BRAND_R_MIN + BRAND_R_GROW * k,
    alpha: 0.3 + 0.65 * k,
    strokes: Math.max(1, Math.min(5, Math.ceil(k * 5 - 1e-9))),
    full: k >= 1,
  };
}

/** A sine pulse between `lo` and `hi` at `hz`; `phase` shifts it (in cycles). */
export function pulse(nowMs: number, hz: number, lo = 0, hi = 1, phase = 0): number {
  return lo + (hi - lo) * (0.5 + 0.5 * Math.sin(2 * Math.PI * (hz * nowMs / 1000 + phase)));
}

/** Where a drifting particle is in its 0..1 life at `nowMs`; each particle `i` of `n` starts at an even offset. */
export function life(nowMs: number, periodMs: number, i: number, n: number): number {
  const v = nowMs / periodMs + i / n;
  return v - Math.floor(v);
}

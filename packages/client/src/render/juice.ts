// "Juice": cheap game-feel filler (anticipation, lunges, squash and stretch, dust, impact dots, a hit-stop and a tiny camera
// shake). Presentation only: nothing here is read by the sim or sent to the server. Two switches live here, and every juice
// number is multiplied by `juiceScale(kind)`:
//   "motion": things that move the picture (offsets, squash, shake, hit-stop, dust drift). Off under the OS's
//             prefers-reduced-motion setting.
//   "flash":  things that only change colour or brightness. They stay under reduced motion.
// Set JUICE_ENABLED to false to turn all of it off, or lower JUICE_INTENSITY to taste (1 = as designed).

import { getSettings } from "../settings";

export const JUICE_ENABLED = true;
export const JUICE_INTENSITY = 1;

export type JuiceKind = "motion" | "flash";

/** Intensity is held in this range: 0 is off and more than 2 would turn the subtle into the silly. */
const MAX_INTENSITY = 2;

/** The pure rule behind juiceScale, with its three inputs spelled out. */
export function juiceScaleFor(kind: JuiceKind, enabled: boolean, intensity: number, reducedMotion: boolean): number {
  if (!enabled || !(intensity > 0)) return 0;
  if (kind === "motion" && reducedMotion) return 0;
  return Math.min(MAX_INTENSITY, intensity);
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
type MediaQuery = { readonly matches: boolean };
let reducedQuery: MediaQuery | null = null;

/**
 * True while the OS asks for reduced motion. The media query list is kept (its `matches` is live in a browser, so a change
 * in the settings applies without a reload); an environment without matchMedia (node, a test) never asks for it.
 */
export function prefersReducedMotion(): boolean {
  if (reducedQuery === null) {
    const mm = (globalThis as { matchMedia?: (query: string) => MediaQuery }).matchMedia;
    if (typeof mm !== "function") return false;
    try {
      reducedQuery = mm.call(globalThis, REDUCED_MOTION_QUERY);
    } catch {
      return false;
    }
  }
  return reducedQuery?.matches === true;
}

/** Forgets the media query list, for tests that stub matchMedia. */
export function resetReducedMotionCache(): void {
  reducedQuery = null;
}

/**
 * How much of an effect of this kind to show: 0 = none, 1 = as designed. The player's settings (settings.ts) scale the
 * intensity and can force reduced motion on top of the OS's own.
 */
export function juiceScale(kind: JuiceKind): number {
  const s = getSettings();
  return juiceScaleFor(kind, JUICE_ENABLED, JUICE_INTENSITY * s.juice, kind === "motion" && (s.reducedMotion || prefersReducedMotion()));
}

// ------------------------------------------------------------------------------------------------------------ easing

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function easeOutCubic(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

export function easeInOutSine(t: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));
}

/** The share of a gap left after `dtMs` of an exponential approach with time constant `tauMs`. */
export function decay(dtMs: number, tauMs: number): number {
  return Math.exp(-Math.max(0, dtMs) / tauMs);
}

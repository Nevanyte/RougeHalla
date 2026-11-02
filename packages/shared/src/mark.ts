// The mark's pure maths (docs/SENTENCED_REDESIGN.md): the tier a count of hits (or swaps) gives, the attack-speed tax, a hit's weight and
// the pulse's share of the target's max hp. The server's sim/factions.ts and the reference duel (factions.ts, mirroring testing/engine.py)
// both read these; nothing here touches state. A leaf: it may import constants, the weapon table and types.
import { MARK_TAX_THRESHOLD, MARK_TIER_HITS, MARK_TOP_TIER } from "./constants";
import type { FactionSpec } from "./factions";
import { attackInterval, WEAPONS, type WeaponId } from "./weapons";

// The Sentenced rework (testing/TUNING_BALANCE.md section 13): the mark is a plain share of the target's max hp per landed hit.
// Its two builds read two plain scalings: attack speed (more hits, more pulses: the attack-speed max-hp punisher) and every
// bonus offensive and defensive stat point alike (the stat bully). The old bends (attack speed to the 0.1 power, card and farm
// attack speed at 10%, AP counted six times) are gone; the names stay so the code paths and the wire stay as they were.
/** Attack speed's exponent in a hit's mark weight: 1, so a hit's pulse is the same at any attack speed and mark dps grows with it. */
export const MARK_AS_EXPONENT = 1;
/** Mark growth per decoded bonus point of AD, AP, armor and magic resistance: 100 bonus points of any mix make the pulse x1.2. */
export const MARK_BONUS_STAT_PER_POINT = 0.002;
/** AP's weight in that sum: one, like every other stat. */
export const MARK_BONUS_AP_WEIGHT = 1;
/** The share of positive card and farm attack-speed bonuses a Sentenced gets: all of it, like every faction. */
export const MARK_FARM_AS_EFFICIENCY = 1;

/**
 * The tier of a mark that has landed `hits` hits (`progress`, in hits, already counting Gathering Storm's credit) on its target:
 * 0 before the first, then one tier more per MARK_TIER_HITS, never above MARK_TOP_TIER. `swapSteps` is what the target's weapon swaps
 * (and Swift Judgment's every second hit) have promoted: either path alone reaches a tier, so the answer is the higher of the two.
 */
export function markTierOf(progress: number, swapSteps = 0, tierHits = MARK_TIER_HITS): number {
  if (!(progress > 0) && !(swapSteps > 0)) return 0;
  const byHits = Math.floor(Math.max(0, progress) / tierHits + 1e-9);
  return Math.min(MARK_TOP_TIER, 1 + Math.max(byHits, Math.floor(swapSteps)));
}

/**
 * The attack rate (attacks a second) a fighter keeps under the tax: a rate at or under MARK_TAX_THRESHOLD is untouched, the excess
 * above it is cut to `keep` of itself, and the result is never above `cap`.
 */
export function taxedRate(rate: number, keep: number, cap: number): number {
  return rate <= MARK_TAX_THRESHOLD ? rate : Math.min(cap, MARK_TAX_THRESHOLD + (rate - MARK_TAX_THRESHOLD) * keep);
}

/**
 * A landed hit's weight for the mark. `asExponent=1` preserves the legacy per-hit value. Sentenced uses MARK_AS_EXPONENT so mark DPS scales
 * sublinearly with attack speed while its actual interval and ordinary auto attacks continue to use full `asMult`.
 */
export function markWeight(f: Pick<FactionSpec, "rate">, w: WeaponId, asMult = 1, asExponent = 1): number {
  const safeAs = Number.isFinite(asMult) && asMult > 0 ? asMult : 1;
  const safeExponent = Number.isFinite(asExponent) ? Math.max(0, asExponent) : 1;
  return f.rate * WEAPONS[w].dpsMult * safeAs ** safeExponent * attackInterval(f, w, safeAs);
}

/**
 * The pulse's share of the target's max hp for a hit of weight 1: faction mark share and kill-stacks, times the optional Heavier
 * Sentence scale and an additive uncapped bonus-stat multiplier.
 */
export interface MarkBonusStats {
  ad?: number;
  ap?: number;
  armor?: number;
  magicResist?: number;
}

/** Uncapped reward for bonus bruiser stats. Baseline callers retain the exact old pulse. */
export function markPct(f: Pick<FactionSpec, "params">, stacks: number, scale = 1, bonus: MarkBonusStats = {}): number {
  const p = f.params;
  const earned = [bonus.ad, bonus.ap === undefined ? 0 : MARK_BONUS_AP_WEIGHT * bonus.ap, bonus.armor, bonus.magicResist]
    .reduce<number>((sum, value) => sum + (Number.isFinite(value) ? Math.max(0, value!) : 0), 0);
  const farmScale = 1 + MARK_BONUS_STAT_PER_POINT * earned;
  return ((p.mark_pct ?? 0) + (p.mark_kill ?? 0) * Math.max(0, stacks)) * scale * farmScale;
}

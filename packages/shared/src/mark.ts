// The mark's pure maths (docs/SENTENCED_REDESIGN.md): the tier a count of hits (or swaps) gives, the attack-speed tax, a hit's weight and
// the pulse's share of the target's max hp. The server's sim/factions.ts and the reference duel (factions.ts, mirroring testing/engine.py)
// both read these; nothing here touches state. A leaf: it may import constants, the weapon table and types.
import { MARK_TAX_THRESHOLD, MARK_TIER_HITS, MARK_TOP_TIER } from "./constants";
import type { FactionSpec } from "./factions";
import { attackInterval, WEAPONS, type WeaponId } from "./weapons";

/** Farm-only balance: mark rate gets diminishing attack-speed scaling; ordinary auto attacks keep their full AS. */
export const MARK_AS_EXPONENT = 0.1;
/** Percent mark growth per decoded bonus point across AD, AP, armor and magic resistance. */
export const MARK_BONUS_STAT_PER_POINT = 0.0005;
/** Ability power receives six weight in the mark's bonus sum so AP rewards remain useful without weapon AP scaling. */
export const MARK_BONUS_AP_WEIGHT = 6;
/** Sentenced keeps base cadence but receives only this share of positive card and farm attack-speed bonuses. */
export const MARK_FARM_AS_EFFICIENCY = 0.1;

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

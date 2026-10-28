// The mark's pure maths (docs/SENTENCED_REDESIGN.md): the tier a count of hits (or swaps) gives, the attack-speed tax, a hit's weight and
// the pulse's share of the target's max hp. The server's sim/factions.ts and the reference duel (factions.ts, mirroring testing/engine.py)
// both read these; nothing here touches state. A leaf: it may import constants, the weapon table and types.
import { MARK_TAX_THRESHOLD, MARK_TIER_HITS, MARK_TOP_TIER } from "./constants";
import type { FactionSpec } from "./factions";
import { attackInterval, WEAPONS, type WeaponId } from "./weapons";

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
 * A landed hit's weight for the mark: its share of the faction's base hit, `rate x dpsMult x asMult x interval`. Unfloored that is
 * `dpsMult / (1 + boost)`, so a pulse follows the weapon's own `dpsMult` and the weapon loop is not disturbed; attack speed past the
 * interval's floor makes bigger hits and so bigger pulses, exactly as `damagePerHit` does.
 */
export function markWeight(f: Pick<FactionSpec, "rate">, w: WeaponId, asMult = 1): number {
  return f.rate * WEAPONS[w].dpsMult * asMult * attackInterval(f, w, asMult);
}

/**
 * The pulse's share of the target's max hp for a hit of weight 1: the faction's `mark_pct` and a `mark_kill` for each kill-stack, times
 * `scale` (Heavier Sentence: 1 + HEAVIER_SENTENCE_PER_BONUS x the bonus max hp share; 1 without it).
 */
export function markPct(f: Pick<FactionSpec, "params">, stacks: number, scale = 1): number {
  const p = f.params;
  return ((p.mark_pct ?? 0) + (p.mark_kill ?? 0) * Math.max(0, stacks)) * scale;
}

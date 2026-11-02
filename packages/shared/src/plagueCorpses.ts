/** Plague's corpse harvest. These values are shared by the sim and combat readouts. */
export const PLAGUE_CORPSE_LIFETIME_MS = 90_000;
export const PLAGUE_CORPSE_AUTO_RANGE = 24;
/** Compatibility name for older input callers; both paths require the same body overlap. */
export const PLAGUE_CORPSE_INTERACT_RANGE = PLAGUE_CORPSE_AUTO_RANGE;
export const PLAGUE_CORPSE_HP_SHARE = 0.03;
export const PLAGUE_CORPSE_HEAL_SHARE = 0.03;
/**
 * The zombie scales off its owner's max hp, and mostly off its BONUS max hp (max hp above the faction's base: cards, mob stats,
 * bodies), so building health is how a Plague builds its zombie: health = HP_SHARE of max hp + HP_PER_BONUS per bonus point, a
 * hit = HIT_SHARE of max hp + HIT_PER_BONUS of the bonus (+ the small AD rider), both times the body growth.
 */
export const PLAGUE_ZOMBIE_HP_SHARE = 0.04;
export const PLAGUE_ZOMBIE_HP_PER_BONUS = 0.4;
export const PLAGUE_ZOMBIE_HIT_SHARE = 0.003;
export const PLAGUE_ZOMBIE_HIT_PER_BONUS = 0.025;
/** Passive regen of the zombie's max HP per second; it slows to the combat factor while it was hit within the quiet window. */
export const PLAGUE_ZOMBIE_REGEN_SHARE_PER_SECOND = 0.015;
export const PLAGUE_ZOMBIE_REGEN_COMBAT_FACTOR = 0.25;
export const PLAGUE_ZOMBIE_REGEN_QUIET_MS = 4000;
export const PLAGUE_ZOMBIE_REGEN_STEP_MS = 500;
export const PLAGUE_ZOMBIE_GROWTH_PER_BODY = 0.10;
export const PLAGUE_ZOMBIE_INTERVAL_MS = 1000;
export const PLAGUE_ZOMBIE_WINDUP_MS = 200;
export const PLAGUE_ZOMBIE_ASSIST_MS = 5000;
export const PLAGUE_ZOMBIE_ASSIST_RANGE = 640;

/**
 * The zombie scales off its owner's max hp (both its health and its hit) and, a little, the owner's bonus Offense (AD): each hit
 * adds this share of it. Small on purpose: an AD bow Plague with a zombie must not run away with it. No SO and no defenses:
 * SO and damage over time are the wand and bow disease builds' (owner ruling, the zombie rework).
 */
export const PLAGUE_ZOMBIE_AD_SHARE = 0.15;
/** The most a zombie hit can reach with the AD rider: the pre-rework 3% of the owner's max hp (playtest rule: the zombie hits for less). */
export const PLAGUE_ZOMBIE_HIT_CAP_SHARE = 0.03;

/** What the owner's build adds to its zombie: its faction's base max hp (the rest of max hp is bonus) and its bonus Offense. */
export interface PlagueZombieBonus { baseHp?: number; ad?: number }

/** One companion grows from the owner's max health (mostly its bonus), a little of its bonus Offense, and all corpses harvested this run. */
export function plagueZombieStats(ownerMaxHp: number, corpseStacks: number, bonus: PlagueZombieBonus = {}): { maxHp: number; damage: number } {
  const growth = 1 + Math.max(0, Math.floor(corpseStacks) - 1) * PLAGUE_ZOMBIE_GROWTH_PER_BODY;
  const hp = Math.max(0, ownerMaxHp);
  const ad = Number.isFinite(bonus.ad) ? Math.max(0, bonus.ad!) : 0;
  const extra = Number.isFinite(bonus.baseHp) ? Math.max(0, hp - bonus.baseHp!) : 0;
  return {
    maxHp: (hp * PLAGUE_ZOMBIE_HP_SHARE + extra * PLAGUE_ZOMBIE_HP_PER_BONUS) * growth,
    damage: Math.min((hp * PLAGUE_ZOMBIE_HIT_SHARE + extra * PLAGUE_ZOMBIE_HIT_PER_BONUS) * growth + PLAGUE_ZOMBIE_AD_SHARE * ad,
      hp * PLAGUE_ZOMBIE_HIT_CAP_SHARE * growth),
  };
}

/** Plague's corpse harvest. These values are shared by the sim and combat readouts. */
export const PLAGUE_CORPSE_LIFETIME_MS = 90_000;
export const PLAGUE_CORPSE_AUTO_RANGE = 24;
/** Compatibility name for older input callers; both paths require the same body overlap. */
export const PLAGUE_CORPSE_INTERACT_RANGE = PLAGUE_CORPSE_AUTO_RANGE;
export const PLAGUE_CORPSE_HP_SHARE = 0.03;
export const PLAGUE_CORPSE_HEAL_SHARE = 0.03;
export const PLAGUE_ZOMBIE_HP_SHARE = 0.55;
export const PLAGUE_ZOMBIE_HIT_SHARE = 0.02;
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
 * Plague's second build, the zombie tank (the faction rework): the companion's max hp grows by this share per point of the
 * owner's bonus Defense + SD (100 bonus defense: x1.2), and each of its hits adds this share of the owner's SO (AP), so a
 * tanky wand Plague's zombie is a real second body.
 */
export const PLAGUE_ZOMBIE_HP_PER_DEFENSE = 0.002;
export const PLAGUE_ZOMBIE_AP_SHARE = 0.25;
/** The most a zombie hit can reach with the SO rider: the pre-rework 3% of the owner's max hp (playtest rule: the zombie hits for less). */
export const PLAGUE_ZOMBIE_HIT_CAP_SHARE = 0.03;

/** What the owner's build adds to its zombie (both 0 for a plain owner). */
export interface PlagueZombieBonus { bonusDefense?: number; ap?: number }

/** One companion grows from the owner's current max health, its defenses and SO, and all corpses harvested this run. */
export function plagueZombieStats(ownerMaxHp: number, corpseStacks: number, bonus: PlagueZombieBonus = {}): { maxHp: number; damage: number } {
  const growth = 1 + Math.max(0, Math.floor(corpseStacks) - 1) * PLAGUE_ZOMBIE_GROWTH_PER_BODY;
  const hp = Math.max(0, ownerMaxHp);
  const def = Number.isFinite(bonus.bonusDefense) ? Math.max(0, bonus.bonusDefense!) : 0;
  const ap = Number.isFinite(bonus.ap) ? Math.max(0, bonus.ap!) : 0;
  return {
    maxHp: hp * PLAGUE_ZOMBIE_HP_SHARE * growth * (1 + PLAGUE_ZOMBIE_HP_PER_DEFENSE * def),
    damage: Math.min(hp * PLAGUE_ZOMBIE_HIT_SHARE * growth + PLAGUE_ZOMBIE_AP_SHARE * ap, hp * PLAGUE_ZOMBIE_HIT_CAP_SHARE * growth),
  };
}

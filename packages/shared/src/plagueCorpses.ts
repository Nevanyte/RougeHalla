/** Plague's corpse harvest. These values are shared by the sim and combat readouts. */
export const PLAGUE_CORPSE_LIFETIME_MS = 90_000;
export const PLAGUE_CORPSE_AUTO_RANGE = 24;
/** Compatibility name for older input callers; both paths require the same body overlap. */
export const PLAGUE_CORPSE_INTERACT_RANGE = PLAGUE_CORPSE_AUTO_RANGE;
export const PLAGUE_CORPSE_HP_SHARE = 0.03;
export const PLAGUE_CORPSE_HEAL_SHARE = 0.03;
export const PLAGUE_ZOMBIE_HP_SHARE = 0.35;
export const PLAGUE_ZOMBIE_HIT_SHARE = 0.03;
export const PLAGUE_ZOMBIE_GROWTH_PER_BODY = 0.10;
export const PLAGUE_ZOMBIE_INTERVAL_MS = 1000;
export const PLAGUE_ZOMBIE_WINDUP_MS = 200;
export const PLAGUE_ZOMBIE_ASSIST_MS = 5000;
export const PLAGUE_ZOMBIE_ASSIST_RANGE = 640;

/** One companion grows from the owner's current max health and all corpses harvested this run. */
export function plagueZombieStats(ownerMaxHp: number, corpseStacks: number): { maxHp: number; damage: number } {
  const growth = 1 + Math.max(0, Math.floor(corpseStacks) - 1) * PLAGUE_ZOMBIE_GROWTH_PER_BODY;
  const hp = Math.max(0, ownerMaxHp);
  return { maxHp: hp * PLAGUE_ZOMBIE_HP_SHARE * growth, damage: hp * PLAGUE_ZOMBIE_HIT_SHARE * growth };
}

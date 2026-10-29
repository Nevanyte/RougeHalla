/** Fire's out-of-combat roaming ramp and charged auto values. */
export const FIRE_ROAM_RAMP_MS = 20_000;
export const FIRE_ROAM_MAX_SPEED_MULT = 1.5;
export const FIRE_ROAM_CHARGE_MAX = 1000;
export const FIRE_ROAM_BURST_BASE = 50;
export const FIRE_ROAM_BURST_AP_SHARE = 0.4;

/** Normalized movement speed multiplier for a charge value in 0..1000. */
export function fireRoamSpeedMult(charge: number): number {
  const fraction = Math.max(0, Math.min(1, charge / FIRE_ROAM_CHARGE_MAX));
  return 1 + (FIRE_ROAM_MAX_SPEED_MULT - 1) * fraction;
}

/** Charge in 0..1000 after this much time out of combat. */
export function fireRoamCharge(elapsedMs: number): number {
  return Math.max(0, Math.min(FIRE_ROAM_CHARGE_MAX, Math.floor((elapsedMs / FIRE_ROAM_RAMP_MS) * FIRE_ROAM_CHARGE_MAX)));
}

export function fireRoamBurstDamage(abilityPower: number): number {
  return FIRE_ROAM_BURST_BASE + FIRE_ROAM_BURST_AP_SHARE * Math.max(0, abilityPower);
}

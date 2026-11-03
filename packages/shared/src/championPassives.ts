import {
  FROST_CHILL_BONUS_CAP, FROST_CHILL_PER_ATTACK_SPEED, FROST_CHILL_PER_SD, HOLY_CAMP_LIFESTEAL_PER_CLEAR, HOLY_LEECH_ROW_MULT,
} from "./constants";

/** Holy's Demon Blood bonus from eligible camp clears, before the normal lifesteal multipliers. */
export function holyCampLifestealOf(campClears: number): number {
  if (!Number.isFinite(campClears)) return 0;
  const count = Math.max(0, Math.floor(campClears));
  return count * HOLY_CAMP_LIFESTEAL_PER_CLEAR;
}

/** Holy's lifesteal rows (Leech cards and the like) count HOLY_LEECH_ROW_MULT times; LS_CAP still caps them in lifestealTotal. */
export function holyLeechRowsOf(rows: number): number {
  return Number.isFinite(rows) && rows > 0 ? rows * HOLY_LEECH_ROW_MULT : 0;
}

/**
 * How much deeper a Frost's attack chill cuts for its build: FROST_CHILL_PER_SD per bonus Soul Defense point plus
 * FROST_CHILL_PER_ATTACK_SPEED per unit of bonus attack speed (asMult - 1), at most FROST_CHILL_BONUS_CAP. 0 for a plain Frost.
 */
export function frostChillBonusOf(bonusSd: number, bonusAttackSpeed: number): number {
  const sd = Number.isFinite(bonusSd) ? Math.max(0, bonusSd) : 0;
  const as = Number.isFinite(bonusAttackSpeed) ? Math.max(0, bonusAttackSpeed) : 0;
  return Math.min(FROST_CHILL_BONUS_CAP, FROST_CHILL_PER_SD * sd + FROST_CHILL_PER_ATTACK_SPEED * as);
}


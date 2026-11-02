import { HOLY_AP_LIFESTEAL_CAP, HOLY_CAMP_LIFESTEAL_PER_CLEAR, HOLY_LIFESTEAL_PER_AP } from "./constants";

/** Holy's lifesteal from SO (AP), added to its own share (HOLY_LIFESTEAL_PER_AP, capped). */
export function holyApLifestealOf(ap: number): number {
  return Number.isFinite(ap) && ap > 0 ? Math.min(HOLY_AP_LIFESTEAL_CAP, ap * HOLY_LIFESTEAL_PER_AP) : 0;
}

/** Holy's Demon Blood bonus from eligible camp clears, before the normal lifesteal multipliers. */
export function holyCampLifestealOf(campClears: number): number {
  if (!Number.isFinite(campClears)) return 0;
  const count = Math.max(0, Math.floor(campClears));
  return count * HOLY_CAMP_LIFESTEAL_PER_CLEAR;
}

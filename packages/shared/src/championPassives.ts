import { HOLY_CAMP_LIFESTEAL_PER_CLEAR } from "./constants";

/** Holy's Demon Blood bonus from eligible camp clears, before the normal lifesteal multipliers. */
export function holyCampLifestealOf(campClears: number): number {
  if (!Number.isFinite(campClears)) return 0;
  const count = Math.max(0, Math.floor(campClears));
  return count * HOLY_CAMP_LIFESTEAL_PER_CLEAR;
}

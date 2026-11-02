import { POTION_HEAL_MS, POTION_LARGE_SHARE, POTION_MAX_CONCURRENT, POTION_SMALL_SHARE } from "./constants";

export const CONSUMABLE_IDS = ["potionLarge", "potionSmall"] as const;
export type ConsumableId = (typeof CONSUMABLE_IDS)[number];
export const CONSUMABLES = {
  potionLarge: { name: "Camp potion", text: `Heal ${POTION_LARGE_SHARE * 100}% HP over ${POTION_HEAL_MS / 1000}s`, color: 0xf45b78 },
  potionSmall: { name: "Small potion", text: `Heal ${POTION_SMALL_SHARE * 100}% HP over ${POTION_HEAL_MS / 1000}s`, color: 0xffa5b5 },
} as const;
export function isConsumableId(value: unknown): value is ConsumableId {
  return typeof value === "string" && (CONSUMABLE_IDS as readonly string[]).includes(value);
}

export const WIND_EMBLEM_DEF = "windEmblem";

/**
 * The toasts the server sends a player whose potion (`useConsumable`) it refused (sim/consumables.ts): one list, so the client's
 * own check before sending says the same words, and can tell a refusal of its press from any other toast.
 */
export const POTION_REFUSAL = {
  blocked: "Can't use an item now",
  busy: `Already drinking ${POTION_MAX_CONCURRENT} potions`,
  full: "Already at full health",
  empty: "No potion stored",
} as const;
export const POTION_REFUSALS: readonly string[] = Object.values(POTION_REFUSAL);

/** What the potion rule reads: stunned or casting, the potions already healing, hp, and the stock. */
export interface PotionCheck { actionBlocked: boolean; healing: number; hp: number; maxHp: number; large: number; small: number }

/** The refusal a potion gets now (one of POTION_REFUSALS), or null when it is drunk: the server's checks, in its order. */
export function potionRefusal(i: PotionCheck): string | null {
  if (i.actionBlocked) return POTION_REFUSAL.blocked;
  if (i.healing >= POTION_MAX_CONCURRENT) return POTION_REFUSAL.busy;
  if (i.hp >= i.maxHp) return POTION_REFUSAL.full;
  if (i.large <= 0 && i.small <= 0) return POTION_REFUSAL.empty;
  return null;
}

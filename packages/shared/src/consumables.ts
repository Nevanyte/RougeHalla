import { POTION_HEAL_MS, POTION_LARGE_SHARE, POTION_SMALL_SHARE } from "./constants";

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

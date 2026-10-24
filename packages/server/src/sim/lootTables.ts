// Weighted weapon rolls. Pure: the only entropy is the `random` passed in (server-side, never the public seed).
import type { WeaponId } from "@raid/shared";

export type Random = () => number;

export interface LootEntry { id: WeaponId; weight: number }

/** What a chest holds: one weapon, every type equally likely. (Region mobs carry their region's type in Phase 11.) */
export const CHEST_TABLE: readonly LootEntry[] = [
  { id: "sword", weight: 1 },
  { id: "bow", weight: 1 },
  { id: "wand", weight: 1 },
  { id: "shield", weight: 1 },
  { id: "axe", weight: 1 },
];

/** Share of mapgen's ground spots that get a loose weapon; the rest stay empty. */
export const GROUND_WEAPON_CHANCE = 0.35;

/** Proportional pick; always consumes exactly one `random()` call. */
function pickWeighted<T extends { weight: number }>(random: Random, entries: readonly T[]): T {
  let total = 0;
  for (const e of entries) total += e.weight;
  let r = random() * total;
  for (const e of entries) {
    r -= e.weight;
    if (r < 0) return e;
  }
  // Only reachable through float rounding at the very top of the range.
  return entries[entries.length - 1]!;
}

/** The weapon in one chest. */
export function rollChestWeapon(random: Random): WeaponId {
  return pickWeighted(random, CHEST_TABLE).id;
}

/** A loose weapon for one ground spot, or null for none. Always consumes exactly two `random()` calls. */
export function rollGroundWeapon(random: Random): WeaponId | null {
  const there = random() < GROUND_WEAPON_CHANCE;
  const w = pickWeighted(random, CHEST_TABLE).id;
  return there ? w : null;
}

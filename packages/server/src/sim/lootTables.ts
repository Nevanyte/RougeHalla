// Weighted loot rolls. Pure: the only entropy is the `random` passed in (server-side, never the public seed).

export type Random = () => number;

export interface LootEntry { id: string; weight: number }

/** Weights are relative; ids must exist in the item catalog (checked by the loot tests). */
export const LOOT_TABLE: readonly LootEntry[] = [
  { id: "watch", weight: 20 },
  { id: "gold", weight: 8 },
  { id: "gpu", weight: 3 },
  { id: "bandage", weight: 18 },
  { id: "medkit", weight: 7 },
  { id: "knife", weight: 8 },
  { id: "pistol", weight: 8 },
  { id: "rifle", weight: 3 },
  { id: "vest", weight: 7 },
  { id: "plate", weight: 3 },
];

/** Loose items on the floor are the early-game trickle: the best gear only comes from crates. */
export const GROUND_EXCLUDED: ReadonlySet<string> = new Set(["rifle", "plate", "gpu"]);
export const GROUND_TABLE: readonly LootEntry[] = LOOT_TABLE.filter((e) => !GROUND_EXCLUDED.has(e.id));

/** How many items a crate holds. */
export const CRATE_SIZES: ReadonlyArray<{ count: number; weight: number }> = [
  { count: 1, weight: 50 },
  { count: 2, weight: 35 },
  { count: 3, weight: 15 },
];

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

/** One item id from the full table. */
export function rollItem(random: Random): string {
  return pickWeighted(random, LOOT_TABLE).id;
}

/** 1–3 item ids (weights 50/35/15); duplicates are allowed. */
export function rollCrate(random: Random): string[] {
  const { count } = pickWeighted(random, CRATE_SIZES);
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(rollItem(random));
  return out;
}

/** One item id for a loose floor spawn (never rifle, plate or gpu). */
export function rollGroundItem(random: Random): string {
  return pickWeighted(random, GROUND_TABLE).id;
}

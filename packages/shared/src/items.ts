export type ItemKind = "weapon" | "armor" | "healing" | "valuable";

interface BaseDef { id: string; name: string; kind: ItemKind; value: number; color: number }
export interface WeaponDef extends BaseDef { kind: "weapon"; damage: number; range: number; cooldownMs: number; melee: boolean }
export interface ArmorDef extends BaseDef { kind: "armor"; /** Fraction of damage absorbed, 0..1. */ reduction: number }
export interface HealingDef extends BaseDef { kind: "healing"; heal: number }
export interface ValuableDef extends BaseDef { kind: "valuable" }
export type ItemDef = WeaponDef | ArmorDef | HealingDef | ValuableDef;

/** Used when no weapon is carried. Not an item: can't be looted or lost. */
export const FISTS: WeaponDef = {
  id: "fists", name: "Fists", kind: "weapon", value: 0, color: 0xd8c3a5,
  damage: 8, range: 36, cooldownMs: 500, melee: true,
};

export const ITEMS: Readonly<Record<string, ItemDef>> = {
  knife:    { id: "knife",    name: "Knife",    kind: "weapon",   value: 30,  color: 0xb0b8c0, damage: 22, range: 40,  cooldownMs: 450, melee: true },
  pistol:   { id: "pistol",   name: "Pistol",   kind: "weapon",   value: 80,  color: 0x6a7a8a, damage: 16, range: 260, cooldownMs: 450, melee: false },
  rifle:    { id: "rifle",    name: "Rifle",    kind: "weapon",   value: 220, color: 0x3d5a40, damage: 28, range: 400, cooldownMs: 700, melee: false },
  vest:     { id: "vest",     name: "Vest",     kind: "armor",    value: 60,  color: 0x5b6e4a, reduction: 0.25 },
  plate:    { id: "plate",    name: "Plate",    kind: "armor",    value: 160, color: 0x2f3b4c, reduction: 0.45 },
  bandage:  { id: "bandage",  name: "Bandage",  kind: "healing",  value: 15,  color: 0xeeeeee, heal: 25 },
  medkit:   { id: "medkit",   name: "Medkit",   kind: "healing",  value: 60,  color: 0xd94a4a, heal: 60 },
  watch:    { id: "watch",    name: "Watch",    kind: "valuable", value: 50,  color: 0xd9b84a },
  gold:     { id: "gold",     name: "Gold Bar", kind: "valuable", value: 200, color: 0xf2c94c },
  gpu:      { id: "gpu",      name: "GPU",      kind: "valuable", value: 400, color: 0x4ad9c9 },
};

export function itemDef(id: string): ItemDef | undefined {
  return ITEMS[id];
}

/** Highest-damage weapon among the carried defs, or FISTS. */
export function bestWeapon(defIds: Iterable<string>): WeaponDef {
  let best = FISTS;
  for (const id of defIds) {
    const d = ITEMS[id];
    if (d?.kind === "weapon" && d.damage > best.damage) best = d;
  }
  return best;
}

/** Highest-reduction armor among the carried defs, or null. */
export function bestArmor(defIds: Iterable<string>): ArmorDef | null {
  let best: ArmorDef | null = null;
  for (const id of defIds) {
    const d = ITEMS[id];
    if (d?.kind === "armor" && (!best || d.reduction > best.reduction)) best = d;
  }
  return best;
}

/** What a newly claimed profile finds in its stash. */
export const STARTER_KIT: readonly string[] = ["knife", "bandage", "watch"];

// Cosmetics catalog (coloured shapes only) and the "look" word that carries a player's equipped set to everyone in a run.
// Pure data and helpers shared by the server (shop, equip, join) and the client (hub panels, rendering).
//
// Nothing here changes combat. Ids are stable forever: profiles store them. Wire codes are stable too (never reuse one).

/** Golden variants exist for every faction and every weapon. They follow the ids in factions.ts and the weapon spec. */
export const GOLD_FACTIONS = ["fire", "sentenced", "plague", "frost", "holy"] as const;
export const GOLD_WEAPONS = ["sword", "axe", "bow", "wand", "shield"] as const;
export const GOLD_TARGETS = [...GOLD_FACTIONS, ...GOLD_WEAPONS] as const;
export type GoldFaction = (typeof GOLD_FACTIONS)[number];
export type GoldWeapon = (typeof GOLD_WEAPONS)[number];
export type GoldTarget = (typeof GOLD_TARGETS)[number];
export type GoldSlot = `gold-${GoldTarget}`;

/** One item per slot can be equipped. Each golden variant has a slot of its own, so any number of them can be on at once. */
export type CosmeticSlot = "skin" | "outline" | "trail" | "title" | GoldSlot;

export const GOLD_SLOTS: readonly GoldSlot[] = GOLD_TARGETS.map((t): GoldSlot => `gold-${t}`);
export const COSMETIC_SLOTS: readonly CosmeticSlot[] = ["skin", "outline", "trail", "title", ...GOLD_SLOTS];

export function isCosmeticSlot(v: unknown): v is CosmeticSlot {
  return typeof v === "string" && (COSMETIC_SLOTS as readonly string[]).includes(v);
}

interface CosmeticBase {
  /** Stable key stored in profiles. */
  id: string;
  name: string;
  /** Stable wire code within the slot, from 1 (0 means "nothing equipped"). Must fit the slot's LOOK_FIELDS bits. */
  code: number;
  /** GV price. Absent: not sold, only earned (see `reward` in achievements.ts). */
  price?: number;
}
export interface SkinCosmetic extends CosmeticBase { slot: "skin"; color: number }
export interface OutlineCosmetic extends CosmeticBase { slot: "outline"; color: number; width: number }
export type TrailStyle = "dots" | "streak" | "sparks";
export interface TrailCosmetic extends CosmeticBase { slot: "trail"; color: number; style: TrailStyle }
export interface TitleCosmetic extends CosmeticBase { slot: "title"; text: string; color: number }
/** The golden look of one faction or one weapon. It shows only while the player is using that faction or weapon. */
export interface GoldCosmetic extends CosmeticBase { slot: GoldSlot; target: GoldTarget }
export type Cosmetic = SkinCosmetic | OutlineCosmetic | TrailCosmetic | TitleCosmetic | GoldCosmetic;

/** The one gold every golden variant is drawn with. */
export const GOLD_COLOR = 0xffd54f;
export const GOLD_EDGE = 0xff8f00;

const skin = (code: number, key: string, name: string, color: number, price?: number): SkinCosmetic =>
  ({ id: `skin-${key}`, slot: "skin", name, code, color, ...(price === undefined ? {} : { price }) });
const outline = (code: number, key: string, name: string, color: number, width: number, price?: number): OutlineCosmetic =>
  ({ id: `outline-${key}`, slot: "outline", name, code, color, width, ...(price === undefined ? {} : { price }) });
const trail = (code: number, key: string, name: string, color: number, style: TrailStyle, price?: number): TrailCosmetic =>
  ({ id: `trail-${key}`, slot: "trail", name, code, color, style, ...(price === undefined ? {} : { price }) });
const title = (code: number, key: string, text: string, color: number, price?: number): TitleCosmetic =>
  ({ id: `title-${key}`, slot: "title", name: text, code, text, color, ...(price === undefined ? {} : { price }) });
const gilded = (code: number, target: GoldTarget, name: string, price: number): GoldCosmetic =>
  ({ id: `gilded-${target}`, slot: `gold-${target}`, name, code, target, price });

/** GV prices: a win pays 50 and a kill 10, so a common colour is a few runs of play. */
export const COSMETICS: readonly Cosmetic[] = [
  // Body colours.
  skin(1, "crimson", "Crimson", 0xe53935, 40),
  skin(2, "amber", "Amber", 0xffb300, 40),
  skin(3, "lime", "Lime", 0x7cb342, 40),
  skin(4, "teal", "Teal", 0x00acc1, 40),
  skin(5, "azure", "Azure", 0x1e88e5, 60),
  skin(6, "violet", "Violet", 0x8e24aa, 60),
  skin(7, "magenta", "Magenta", 0xd81b60, 60),
  skin(8, "slate", "Slate", 0x607d8b, 60),
  skin(9, "bone", "Bone", 0xeceff1, 100),
  skin(10, "obsidian", "Obsidian", 0x263238, 100),
  skin(11, "coral", "Coral", 0xff8a65, 100),
  skin(12, "laurel", "Laurel", 0xc0ca33),
  skin(13, "ghost", "Ghost", 0xcfd8dc),

  // Outlines around the body disc.
  outline(1, "white", "White edge", 0xffffff, 3, 50),
  outline(2, "black", "Black edge", 0x000000, 4, 50),
  outline(3, "neon", "Neon edge", 0x76ff03, 3, 80),
  outline(4, "red", "Red edge", 0xff1744, 3, 80),
  outline(5, "cyan", "Cyan edge", 0x18ffff, 3, 80),
  outline(6, "magenta", "Magenta edge", 0xf50057, 3, 80),
  outline(7, "bounty", "Bounty edge", 0xff6f00, 5),

  // Trails: what a moving player leaves behind.
  trail(1, "ember", "Ember", 0xff7043, "dots", 100),
  trail(2, "mist", "Mist", 0xeceff1, "streak", 120),
  trail(3, "sparks", "Sparks", 0xffee58, "sparks", 150),
  trail(4, "toxic", "Toxic", 0x9ccc65, "dots", 120),
  trail(5, "frost", "Frostbite", 0x80deea, "streak", 150),
  trail(6, "void", "Void", 0xab47bc, "sparks", 180),
  trail(7, "comet", "Comet", 0xffffff, "streak"),

  // Titles shown under a player's feet. Some are sold, the rest are earned.
  title(1, "rookie", "Rookie", 0xb0bec5, 30),
  title(2, "wanderer", "Wanderer", 0x90caf9, 60),
  title(3, "gladiator", "Gladiator", 0xffcc80, 150),
  title(4, "unbroken", "Unbroken", 0xa5d6a7, 200),
  title(10, "bloodied", "Bloodied", 0xef9a9a),
  title(11, "slayer", "Slayer", 0xef5350),
  title(12, "reaper", "Reaper", 0xb71c1c),
  title(13, "bounty-hunter", "Bounty Hunter", 0xffb74d),
  title(14, "victor", "Victor", 0xfff176),
  title(15, "champion", "Champion", 0xffd54f),
  title(16, "warlord", "Warlord", 0xff8f00),
  title(17, "rampage", "Rampage", 0xff7043),
  title(18, "veteran", "Veteran", 0xb0bec5),
  title(19, "glorious", "Glorious", 0xffe082),
  title(20, "cycle-breaker", "Cycle Breaker", 0xce93d8),
  title(21, "pyre-lord", "Pyre Lord", 0xff7043),
  title(22, "the-judge", "The Judge", 0x9575cd),
  title(23, "rat-king", "Rat King", 0x9ccc65),
  title(24, "ice-wall", "Ice Wall", 0x4fc3f7),
  title(25, "demon-blood", "Demon Blood", 0xfff176),

  // Golden variants. They are sold dear and also awarded by achievements.
  gilded(1, "fire", "Gilded Fire", 400),
  gilded(2, "sentenced", "Gilded Sentenced", 400),
  gilded(3, "plague", "Gilded Plague", 400),
  gilded(4, "frost", "Gilded Frost", 400),
  gilded(5, "holy", "Gilded Demon Blood", 400),
  gilded(6, "sword", "Golden Sword", 300),
  gilded(7, "axe", "Golden Axe", 300),
  gilded(8, "bow", "Golden Bow", 300),
  gilded(9, "wand", "Golden Wand", 300),
  gilded(10, "shield", "Golden Shield", 300),
];

const BY_ID: ReadonlyMap<string, Cosmetic> = new Map(COSMETICS.map((c) => [c.id, c]));
const BY_SLOT_CODE: ReadonlyMap<string, Cosmetic> = new Map(COSMETICS.map((c) => [`${c.slot}:${c.code}`, c]));

/** A Map lookup, so any value is safe to pass (including "__proto__"). */
export function cosmeticById(id: unknown): Cosmetic | undefined {
  return typeof id === "string" ? BY_ID.get(id) : undefined;
}

export function cosmeticsInSlot(slot: CosmeticSlot): Cosmetic[] {
  return COSMETICS.filter((c) => c.slot === slot);
}

/** True for something the shop sells: a positive whole-GV price. */
export function isForSale(c: Cosmetic): boolean {
  return typeof c.price === "number" && Number.isSafeInteger(c.price) && c.price > 0;
}

// ---------------------------------------------------------------- the look word
// One uint32 per player, synced once when they join (it never changes during a run): the stable wire code of the skin,
// outline, trail and title, and a bit per golden variant. 31 bits are used.

const SKIN_BITS = 6;
const OUTLINE_BITS = 4;
const TRAIL_BITS = 4;
const TITLE_BITS = 7;

/** Where each field sits in the word, and how many bits it has. Codes must stay below 2^bits. */
export const LOOK_FIELDS = {
  skin: { shift: 0, bits: SKIN_BITS },
  outline: { shift: SKIN_BITS, bits: OUTLINE_BITS },
  trail: { shift: SKIN_BITS + OUTLINE_BITS, bits: TRAIL_BITS },
  title: { shift: SKIN_BITS + OUTLINE_BITS + TRAIL_BITS, bits: TITLE_BITS },
  gold: { shift: SKIN_BITS + OUTLINE_BITS + TRAIL_BITS + TITLE_BITS, bits: GOLD_TARGETS.length },
} as const;

export const LOOK_NONE = 0;

const fieldMask = (bits: number): number => (1 << bits) - 1;

/** What a look word means: the equipped cosmetics that are drawn on a player. */
export interface Look {
  skin?: SkinCosmetic;
  outline?: OutlineCosmetic;
  trail?: TrailCosmetic;
  title?: TitleCosmetic;
  gold: GoldCosmetic[];
}

/**
 * The look word of an equipped set. An entry counts only if the id is in the catalog, belongs to that slot and is owned,
 * so stale or hand-edited profile data can't put anything on a player that they don't have.
 */
export function packLook(equipped: Readonly<Record<string, string>>, owned: readonly string[]): number {
  let word = 0;
  for (const slot of COSMETIC_SLOTS) {
    if (!Object.hasOwn(equipped, slot)) continue;
    const c = cosmeticById(equipped[slot]);
    if (!c || c.slot !== slot || !owned.includes(c.id)) continue;
    if (c.slot.startsWith("gold-")) {
      word |= 1 << (LOOK_FIELDS.gold.shift + GOLD_TARGETS.indexOf((c as GoldCosmetic).target));
    } else {
      const field = LOOK_FIELDS[c.slot as "skin" | "outline" | "trail" | "title"];
      word |= (c.code & fieldMask(field.bits)) << field.shift;
    }
  }
  return word >>> 0;
}

/** Total: any number decodes. Codes and bits that match nothing in the catalog are ignored. */
export function unpackLook(word: number): Look {
  const w = Number.isFinite(word) ? word >>> 0 : 0;
  const read = (slot: "skin" | "outline" | "trail" | "title"): Cosmetic | undefined => {
    const field = LOOK_FIELDS[slot];
    const code = (w >>> field.shift) & fieldMask(field.bits);
    return code === 0 ? undefined : BY_SLOT_CODE.get(`${slot}:${code}`);
  };
  const look: Look = { gold: [] };
  const s = read("skin");
  if (s?.slot === "skin") look.skin = s;
  const o = read("outline");
  if (o?.slot === "outline") look.outline = o;
  const tr = read("trail");
  if (tr?.slot === "trail") look.trail = tr;
  const ti = read("title");
  if (ti?.slot === "title") look.title = ti;
  GOLD_TARGETS.forEach((target, i) => {
    if ((w >>> (LOOK_FIELDS.gold.shift + i)) & 1) {
      const g = BY_SLOT_CODE.get(`gold-${target}:${i + 1}`);
      if (g?.slot.startsWith("gold-")) look.gold.push(g as GoldCosmetic);
    }
  });
  return look;
}

/**
 * Which golden variants are drawn: the one for the faction being played and the one for the weapon in hand. Unknown
 * (undefined) never matches, so nothing glitters before the sim reports a faction or weapon.
 */
export function activeGold(
  look: Look, using: { faction?: string; weapon?: string },
): { faction?: GoldCosmetic; weapon?: GoldCosmetic } {
  const out: { faction?: GoldCosmetic; weapon?: GoldCosmetic } = {};
  for (const g of look.gold) {
    const isFaction = (GOLD_FACTIONS as readonly string[]).includes(g.target);
    if (isFaction && using.faction !== undefined && g.target === using.faction) out.faction = g;
    else if (!isFaction && using.weapon !== undefined && g.target === using.weapon) out.weapon = g;
  }
  return out;
}

/** "#rrggbb" for DOM styles. */
export function cssColor(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;
}

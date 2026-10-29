// The glossary behind the cards' tags (BALANCE_CONTRACT 4.5): the tooltip chips, the help overlay's Mechanics page and the card panel
// all word a tag the same way, from here. Pure data. The card texts themselves never name a faction, weapon, mob or Wish; this file
// is where the damage types and the signature and weapon tags are explained, so a player can learn what a chip means.
import { AXE_SHRED_ARMOR, AXE_SHRED_CAP, AXE_SHRED_MS, WAND_SPLASH_RADIUS, WAND_SPLASH_SHARE } from "./constants";
import type { FactionId } from "./factions";
import type { MechanicTag } from "./cards";
import type { SignatureKind } from "./signatures";
import { WEAPONS, type WeaponId } from "./weapons";

export interface GlossaryEntry {
  /** The term as the chip and the page show it. */
  term: string;
  /** The definition, one or two sentences. */
  text: string;
}

/** One entry per tag, in the order the Mechanics page lists them. */
export const TAG_GLOSSARY: Readonly<Record<MechanicTag, GlossaryEntry>> = {
  physical: {
    term: "Physical",
    text: "Physical damage is cut by Defense. Defense cuts it by 1 / (1 + Defense / 100).",
  },
  magic: {
    term: "Magic",
    text: "Magic damage is cut by Soul Defense, by 1 / (1 + Soul Defense / 100).",
  },
  true: {
    term: "True",
    text: "True damage is cut by nothing.",
  },
  dot: {
    term: "Damage over time",
    text: "Damage applied over time (burn, disease, bleeds). Each source has its own scaling; SO does not automatically increase every damage-over-time effect.",
  },
  onHit: {
    term: "On-hit",
    text: "An effect a weapon hit applies when it lands. It is as strong for a small hit as for a big one: more, smaller hits apply it more often.",
  },
  returned: {
    term: "Returned",
    text: "Damage dealt back to whoever hit you.",
  },
  slow: {
    term: "Slow",
    text: "Anything that cuts move or attack speed.",
  },
  heal: {
    term: "Heal",
    text: "Any healing. Most heals wait 3 s out of combat; lifesteal and camp heals do not.",
  },
  block: {
    term: "Block",
    text: "A shield stopping part of a hit that arrives in front of it (the rest still lands, and a blocked hit never staggers).",
  },
  ramping: {
    term: "Ramping",
    text: "Grows the longer the fight lasts, or the more you land.",
  },
  execute: {
    term: "Execute",
    text: "Grows as the target's health falls.",
  },
  crit: {
    term: "Critical strike",
    text: "A hit for 1.5x damage.",
  },
  area: {
    term: "Area",
    text: "Hits more than one enemy.",
  },
  wish: {
    term: "Wish",
    text: "Your faction's once-a-run ability (key D).",
  },
};

/** The two stats cards add, which each weapon uses differently (its tooltip says how). */
export const STAT_GLOSSARY: Readonly<Record<"ad" | "ap", GlossaryEntry>> = {
  ad: {
    term: "Offense",
    text: "Offense: adds physical damage to weapon hits that list Offense scaling. It does not set the base attack's damage type or automatically increase champion abilities. Some normal mob kills and quest rewards raise it.",
  },
  ap: {
    term: "SO",
    text: "Soul Offence: adds magic damage where SO scaling is listed, including wand, shield and fists hits, burn and disease. It does not automatically scale Wishes, slows or true-damage marks. Some normal mob kills and quest rewards raise it.",
  },
};

/** The glossary as an ordered list (the Mechanics page): the stats, then the tags. */
export const GLOSSARY: readonly GlossaryEntry[] = [
  STAT_GLOSSARY.ad, STAT_GLOSSARY.ap, ...Object.values(TAG_GLOSSARY),
];

/** The glossary entry of a tag. */
export function tagEntry(tag: MechanicTag): GlossaryEntry {
  return TAG_GLOSSARY[tag];
}

/** A tag as its chip label ("Damage over time"). */
export function tagLabel(tag: MechanicTag): string {
  return TAG_GLOSSARY[tag].term;
}

// ------------------------------------------------------------------------------------------------ signature and weapon tags

/** A faction's signature and what it is, in the glossary's words (D6: burn is magic over time, backlash physical returned...). */
export interface SignatureTagRow {
  faction: FactionId;
  /** The signature's name as the faction card words it. */
  signature: string;
  /** The wire kind of its damage, or null for a signature that is not damage (the chill, the lifesteal). */
  kind: SignatureKind | null;
  tags: readonly MechanicTag[];
}

export const SIGNATURE_TAGS: readonly SignatureTagRow[] = [
  { faction: "fire", signature: "Burn", kind: "burn", tags: ["magic", "dot"] },
  { faction: "fire", signature: "Backlash", kind: "backlash", tags: ["physical", "returned"] },
  { faction: "sentenced", signature: "Mark", kind: "mark", tags: ["true", "ramping"] },
  { faction: "plague", signature: "Disease and execute", kind: "disease", tags: ["magic", "dot", "execute"] },
  { faction: "frost", signature: "Chill", kind: null, tags: ["slow"] },
  { faction: "holy", signature: "Lifesteal", kind: null, tags: ["heal"] },
];

export interface WeaponTagRow {
  weapon: WeaponId;
  tags: readonly MechanicTag[];
  /** What else the weapon does that a tag cannot say (stagger, root, riposte). */
  note: string;
}

export const WEAPON_TAGS: readonly WeaponTagRow[] = [
  { weapon: "sword", tags: ["physical", "onHit"], note: `Unblocked hits stagger windups and casts; bow draws resist stagger. Its on-hit effects land ${WEAPONS.sword.onHitPower}x as hard. The champion sets the base attack's damage type; Offense adds physical damage.` },
  {
    weapon: "axe", tags: ["physical", "onHit"],
    note: `Move freely after the swing lands. Each hit shreds ${AXE_SHRED_ARMOR} Defense for ${AXE_SHRED_MS / 1000} s, up to ${AXE_SHRED_CAP}. Offense and bonus HP add physical damage; base damage type comes from the champion.`,
  },
  { weapon: "bow", tags: ["physical"], note: "Unit-targeted arrows follow their target; directional shots fly straight. Player draw time shortens with attack speed; move freely after launch. Offense adds physical damage; base damage type comes from the champion." },
  {
    weapon: "wand", tags: ["magic", "area"],
    note: `Balls delete arrows and splash ${Math.round(WAND_SPLASH_SHARE * 100)}% damage onto other enemies within ${WAND_SPLASH_RADIUS} u. SO adds magic damage and Offense adds a smaller physical part; base damage type comes from the champion. Player windup shortens with attack speed.`,
  },
  { weapon: "shield", tags: ["block", "returned"], note: "Bashes, blocks in front, ripostes and reflects arrows." },
  { weapon: "fists", tags: ["onHit"], note: `The fastest hands; an empty weapon slot fights with them. Their on-hit effects land ${WEAPONS.fists.onHitPower}x as hard.` },
];

/** The mechanics page's lines about damage types, in one place for the help overlay. */
export const DAMAGE_TYPE_LINE = "Physical damage is cut by Defense, magic by Soul Defense, true by nothing. Each is cut by 1 / (1 + stat / 100).";

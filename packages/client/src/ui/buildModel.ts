// The build strip's numbers and words, pure so they are tested without a DOM (ui/buildHud.ts draws them; BALANCE_CONTRACT 3.3, 3.4, 9):
// what the cards and the weapon in hand add up to: AD, AP, armor, magic resist, attack speed, move speed, lifesteal, card power P and
// the PvP factor it earns. The stat mirrors are read through their decoders (shared/mods.ts decodeMirrors), never from the cards; the
// two numbers the server does not sync (lifesteal, power) are folded from the synced build with the same shared helpers the sim uses.
// Also the weapon bar's tooltip text: a weapon's scaling and what it does beyond a tag.
import {
  AP_DOT_RATIO, BASE_TITLES, CARD_TIERS, FACTIONS, LIFESTEAL_MAX, LS_CAP, STAT_GLOSSARY, WEAPONS, WEAPON_TAGS, WIRE_IDENTITY_MIRRORS, baseCardId,
  cardPower, cardRows, countIn, decodeMirrors, isFactionId, ownedCards, pvpFactor, tagLabel, tierRoman,
  type BaseStatId, type CardCounts, type StatMirrors, type WeaponId, type WireMirrors,
} from "@raid/shared";

/** The strip's cells, left to right and top to bottom. */
export type BuildStatId = "ad" | "ap" | "armor" | "mr" | "as" | "move" | "leech" | "power" | "pvp";
export const BUILD_STAT_IDS: readonly BuildStatId[] = ["ad", "ap", "armor", "mr", "as", "move", "leech", "power", "pvp"];

export interface BuildStat {
  id: BuildStatId;
  /** The cell's label: "AD", "Armor", "PvP". */
  label: string;
  /** The number or short phrase: "+24", "215", "x1.39". */
  value: string;
  /** The tooltip: what it is and where this player's number comes from, one line per sentence. */
  tip: string;
  /** Nothing adds to it (a stat at its base, power 0): drawn dim, still shown, so a new player sees what cards can move. */
  dim: boolean;
}

/** What the strip reads about the local player. */
export interface BuildInput {
  faction: string;
  /** PlayerState.build (card id -> count). */
  build: CardCounts | null | undefined;
  /** The decoded mirrors; `wire` is the synced PlayerState (or anything shaped like it) when a caller holds that instead. */
  mirrors?: StatMirrors;
  wire?: WireMirrors;
  /** The weapon in hand ("fists" for an empty hand). */
  weapon: WeaponId;
  /** hp over max hp: Bloodthirst doubles lifesteal below half. Unknown: counted as full. */
  hpFrac?: number;
}

/** A number with at most one decimal and no trailing zero: 24 "24", 12.5 "12.5". */
export function num(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** "+18%" / "-30%" / "0%" from a multiplier (1.18 -> "+18%"). */
export function percentOver(mult: number): string {
  const p = Math.round((mult - 1) * 100);
  return p > 0 ? `+${p}%` : `${p}%`;
}

/** "x1.39": the factor with two decimals (ASCII x, as the contract writes it). */
export function factorText(f: number): string {
  return `x${f.toFixed(2)}`;
}

/** How much a defence stat cuts the damage it defends against, as a percent ("33%"): 1 - 1 / (1 + stat / 100). */
export function cutPercent(stat: number): number {
  return Math.round((1 - 1 / (1 + Math.max(0, stat) / 100)) * 100);
}

/** What the strip's lifesteal cell says: the card rows' lifesteal (held to LS_CAP, doubled by Bloodthirst below half hp). */
export function cardLifesteal(build: CardCounts | null | undefined, faction: string, hpFrac = 1): { share: number; doubled: boolean; hasDoubler: boolean } {
  let rows = 0;
  for (const { def, count } of ownedCards(build)) {
    for (const e of cardRows(def.id, faction)) if (e.k === "stat" && e.stat === "lifesteal") rows += e.v * count;
  }
  const hasDoubler = countIn(build, "bloodthirst") > 0;
  const doubled = hasDoubler && hpFrac < 0.5;
  const capped = rows > 0 ? Math.min(LS_CAP, rows) : 0;
  return { share: Math.min(LIFESTEAL_MAX, capped * (doubled ? 2 : 1)), doubled, hasDoubler };
}

/** The scaling of the weapon in hand per point, in words, for the AD and AP tooltips ("Your Wand turns each point into 1.2 damage a second"). */
function perPoint(weapon: WeaponId, key: "ad" | "ap"): number {
  return WEAPONS[weapon].scaling[key] ?? 0;
}

/**
 * The nine cells of the build strip for a player. Pure. `P` is the sum of the tiers of the cards held; the PvP factor is the
 * multiplier on every hit that lands on another player (rules.ts pvpFactor).
 */
export function buildStats(input: BuildInput): BuildStat[] {
  const m = input.mirrors ?? decodeMirrors(input.wire ?? WIRE_IDENTITY_MIRRORS);
  const spec = isFactionId(input.faction) ? FACTIONS[input.faction] : null;
  const weapon = input.weapon;
  const w = WEAPONS[weapon];
  const power = cardPower(input.build);
  const factor = pvpFactor(power);
  const ls = cardLifesteal(input.build, input.faction, input.hpFrac ?? 1);

  const adPer = perPoint(weapon, "ad");
  const apPer = perPoint(weapon, "ap");
  const ad = `${STAT_GLOSSARY.ad.text} +${num(m.adBonus)} from your cards. `
    + (adPer > 0 ? `Your ${w.name} turns each point into ${num(adPer)} damage a second.` : `Your ${w.name} gets nothing from it.`);
  const ap = `${STAT_GLOSSARY.ap.text} +${num(m.apBonus)} from your cards. `
    + (apPer > 0 ? `Your ${w.name} turns each point into ${num(apPer)} damage a second, and each running damage over time gains ${num(AP_DOT_RATIO)} a second per point.` : `Your ${w.name} gets nothing from it directly, but each running damage over time gains ${num(AP_DOT_RATIO)} a second per point.`);

  const armorBase = spec?.armor ?? 0;
  const mrBase = spec?.shield ?? 0;
  const armor = armorBase + m.armorBonus;
  const mr = mrBase + m.shieldBonus;

  const stats: BuildStat[] = [
    { id: "ad", label: "AD", value: `+${num(m.adBonus)}`, tip: ad, dim: m.adBonus === 0 },
    { id: "ap", label: "AP", value: `+${num(m.apBonus)}`, tip: ap, dim: m.apBonus === 0 },
    {
      id: "armor", label: "Armor", value: num(armor), dim: m.armorBonus === 0,
      tip: `Physical damage you take is cut by ${cutPercent(armor)}%. ${num(armorBase)} from your base and ${num(m.armorBonus)} from your cards.`,
    },
    {
      id: "mr", label: "MR", value: num(mr), dim: m.shieldBonus === 0,
      tip: `Magic damage you take is cut by ${cutPercent(mr)}%. ${num(mrBase)} from your base and ${num(m.shieldBonus)} from your cards. True damage ignores both.`,
    },
    {
      id: "as", label: "Atk speed", value: percentOver(m.asMult), dim: m.asMult === 1,
      tip: `How fast you attack, against your weapon's base pace. Cards, slows and some augments move it (bonuses stop at +50%).`,
    },
    {
      id: "move", label: "Move", value: percentOver(m.speedMult), dim: m.speedMult === 1,
      tip: "How fast you walk, against the base pace. Card bonuses stop at +30%, and some are off while you shoot.",
    },
    {
      id: "leech", label: "Leech", value: `${Math.round(ls.share * 100)}%`, dim: ls.share === 0,
      tip: `The share of the damage you deal that you heal, from your cards. Your faction's own lifesteal, if it has one, comes on top (the total stops at ${Math.round(LIFESTEAL_MAX * 100)}%).`
        + (ls.hasDoubler ? ` Doubled while you are below half health${ls.doubled ? " (now)" : ""}.` : ""),
    },
    {
      id: "power", label: "Power", value: String(power), dim: power === 0,
      tip: "Card power P: the sum of the tiers of your cards, once per copy. It is the only thing that raises your damage to players.",
    },
    {
      id: "pvp", label: "PvP", value: factorText(factor), dim: power === 0,
      tip: "Your damage to players. Each card you take adds its tier to your power.",
    },
  ];
  return stats;
}

/** One cell as a line of text ("AD +24"), for tests and the aria label. */
export function statLine(s: BuildStat): string {
  return `${s.label} ${s.value}`;
}

// -------------------------------------------------------------------------------------------------------- weapon scaling

const SCALING_LABEL: Readonly<Record<string, string>> = { ad: "AD", ap: "AP", hp: "bonus HP", def: "bonus armor/MR" };

/** A scaling number: one decimal, two when the second matters (0.02). */
function scale(v: number): string {
  return Math.abs(v * 10 - Math.round(v * 10)) < 1e-9 ? v.toFixed(1) : v.toFixed(2);
}

/**
 * What a weapon's hits scale with, biggest term first ("AD 1.0", "AP 1.2 + AD 0.3", "AD 1.2 + bonus HP 0.02"): the points of raw damage
 * per second at base attack speed that each point of the stat adds.
 */
export function weaponScalingText(weapon: WeaponId): string {
  const sc = WEAPONS[weapon].scaling as Readonly<Record<string, number | undefined>>;
  const order = ["ad", "ap", "hp", "def"];
  const terms = order.filter((k) => (sc[k] ?? 0) > 0).sort((a, b) => sc[b]! - sc[a]! || order.indexOf(a) - order.indexOf(b));
  return terms.length === 0 ? "No scaling" : terms.map((k) => `${SCALING_LABEL[k]} ${scale(sc[k]!)}`).join(" + ");
}

/** What a weapon does beyond its numbers, from the glossary's weapon table ("Physical, On-hit. Staggers its target."). */
export function weaponSpecialText(weapon: WeaponId): string {
  const row = WEAPON_TAGS.find((r) => r.weapon === weapon);
  if (!row) return "";
  const tags = row.tags.map(tagLabel).join(", ");
  return row.note === "" ? tags : `${tags}. ${row.note}`;
}

/** The weapon slot's tooltip: its name, its scaling, its tags and what it does. */
export function weaponTipText(weapon: WeaponId): string {
  const w = WEAPONS[weapon];
  const lines = [w.name, `Scales with ${weaponScalingText(weapon)}`];
  const special = weaponSpecialText(weapon);
  if (special !== "") lines.push(special);
  return lines.join("\n");
}

// ------------------------------------------------------------------------------------------------------------- base summaries

/** The wording of a base stat's total ("+45 attack damage", "+25% attack speed"). */
export function baseTotalText(base: BaseStatId, total: number): string {
  const pct = `${Math.round(total * 100)}%`;
  switch (base) {
    case "ad": return `+${num(total)} attack damage`;
    case "ap": return `+${num(total)} ability power`;
    case "armor": return `+${num(total)} armor`;
    case "mr": return `+${num(total)} magic resist`;
    case "haste": return `+${pct} attack speed`;
    case "vitality": return `+${pct} max health`;
    case "leech": return `+${pct} lifesteal`;
    case "fleet": return `+${pct} move speed`;
  }
}

/**
 * What all the cards of one base add up to, for the tooltip of any of them: "All your Attack Damage cards: +45 attack damage (I, II x2)".
 * "" when the player holds one card of the base (its own text already says it) or none.
 */
export function baseSummary(build: CardCounts | null | undefined, base: BaseStatId): string {
  let total = 0;
  let cards = 0;
  const parts: string[] = [];
  for (const tier of CARD_TIERS) {
    const id = baseCardId(base, tier);
    const n = countIn(build, id);
    if (n === 0) continue;
    const row = cardRows(id)[0];
    const v = row && (row.k === "flat" || row.k === "stat" || row.k === "while") ? row.v : 0;
    total += v * n;
    cards += n;
    parts.push(`${tierRoman(tier)}${n > 1 ? ` x${n}` : ""}`);
  }
  if (cards < 2) return "";
  return `All your ${BASE_TITLES[base]} cards: ${baseTotalText(base, total)} (${parts.join(", ")})`;
}

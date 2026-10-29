import { cardPower, cardRows, ownedCards, type CardCounts } from "./cards";
import { mobStatRows, type MobStatCounts } from "./mobStats";
import { FACTIONS, damageShares, isFactionId, pacedFaction, type DamageShares } from "./factions";
import { decodeMirrors, type WireMirrors } from "./mods";
import { pvpFactor } from "./rules";
import { holyCampLifestealOf } from "./championPassives";
import { attackInterval, damagePerHit, isWeaponId, scalingDamage, type WeaponId } from "./weapons";

export type InvestedStatKey = "ad" | "ap" | "damage" | "health" | "attackSpeed" | "armor" | "mr" | "speed" | "leech";
export interface InvestedStat {
  key: InvestedStatKey;
  label: string;
  short: string;
  /** Investment measured in roughly one base-card tier of this stat. */
  score: number;
}
export interface CombatReadability {
  /** Current PvP factor divided by the fresh fighter's factor; card power is the game's authoritative growth measure. */
  powerRatio: number;
  /** Normalized PvP-factor growth from 0 (fresh) to 1 (the factor's asymptote). */
  power: number;
  /** Legacy top-two summary retained for existing consumers. New UI should use investedStats. */
  topStats: InvestedStat[];
  /** Every positive build investment, in descending score order. */
  investedStats: InvestedStat[];
}

export type ReadableFighter = WireMirrors & {
  faction: string;
  weapon0: string;
  weapon1: string;
  slot: number;
  hp: number;
  maxHp: number;
  build?: CardCounts | null;
  mobStats?: MobStatCounts;
  campClears?: number;
};

const STAT_META: Record<InvestedStatKey, Pick<InvestedStat, "label" | "short">> = {
  ad: { label: "Offense", short: "Offense" },
  ap: { label: "Soul Offence", short: "SO" },
  damage: { label: "Damage", short: "DMG" },
  health: { label: "Health", short: "HP" },
  attackSpeed: { label: "Attack Speed", short: "AS" },
  armor: { label: "Defense", short: "DEF" },
  mr: { label: "Soul Defense", short: "SD" },
  speed: { label: "Move Speed", short: "SPD" },
  leech: { label: "Leech", short: "LEECH" },
};

/** Effective card-based attack type mix for the held weapon, matching the server's packetFor scaling and shares. */
export function combatDamageShares(p: ReadableFighter): DamageShares {
  const id = p.slot === 1 ? p.weapon1 : p.weapon0;
  return weaponDamageShares(p, id);
}

/** Effective damage packet mix for one exact weapon with the fighter's current public scaling mirrors. */
export function weaponDamageShares(p: ReadableFighter, weaponId: string): DamageShares {
  if (!isFactionId(p.faction)) return { phys: 1, magic: 0, true: 0 };
  // Player packets use the arena-paced faction: DUEL_PACE scales its hit, but leaves weapon stat-scaling additions alone.
  // Using the design-sheet hit here would therefore overstate the share contributed by Offense/SO/HP/defense.
  const faction = pacedFaction(FACTIONS[p.faction]);
  const wire = decodeMirrors(p);
  const weapon: WeaponId = isWeaponId(weaponId) ? weaponId : "fists";
  const base = damagePerHit(faction, weapon, wire.asMult);
  const extra = scalingDamage(weapon, {
    ad: wire.adBonus,
    ap: wire.apBonus,
    bonusMaxHp: Number.isFinite(p.maxHp) ? Math.max(0, p.maxHp - FACTIONS[p.faction].hp) : 0,
    bonusDefense: Math.max(0, wire.armorBonus) + wire.shieldBonus,
  }, wire.asMult, attackInterval(faction, weapon, wire.asMult));
  const baseMix = damageShares(faction);
  if (extra.phys === 0 && extra.magic === 0) return baseMix;
  const total = base + extra.phys + extra.magic;
  if (!(total > 0)) return baseMix;
  return {
    phys: (base * baseMix.phys + extra.phys) / total,
    magic: (base * baseMix.magic + extra.magic) / total,
    true: (base * baseMix.true) / total,
  };
}

/** A short, card-based build summary; no current HP, bounty, matchup, or hidden-state data affects the strength glow. */
export function combatReadability(p: ReadableFighter): CombatReadability {
  const powerPoints = cardPower(p.build);
  const baseline = pvpFactor(0);
  const factor = pvpFactor(powerPoints);
  const ceiling = pvpFactor(Number.POSITIVE_INFINITY);
  const powerRatio = factor / baseline;
  const power = ceiling > baseline ? Math.max(0, Math.min(1, (factor - baseline) / (ceiling - baseline))) : 0;
  const m = decodeMirrors(p);
  const baseHp = isFactionId(p.faction) ? FACTIONS[p.faction].hp : Math.max(0, p.maxHp);
  const bonusLeech = cardLeech(p.build, p.faction, p.mobStats, p.campClears);
  let genericDamage = mobStatRows(p.mobStats).reduce((sum, e) => e.k === "stat" && e.stat === "damage" ? sum + e.v : sum, 0);
  for (const { def, count } of ownedCards(p.build)) {
    for (const e of cardRows(def.id, p.faction)) if (e.k === "stat" && e.stat === "damage" && !e.requires && !e.needs) genericDamage += e.v * count;
  }
  const scores: Record<InvestedStatKey, number> = {
    ad: m.adBonus / 12,
    ap: m.apBonus / 12,
    damage: genericDamage / 0.01,
    health: baseHp > 0 ? Math.max(0, p.maxHp / baseHp - 1) / 0.09 : 0,
    attackSpeed: Math.max(0, m.asMult - 1) / 0.09,
    armor: Math.max(0, m.armorBonus) / 15,
    mr: Math.max(0, m.shieldBonus) / 15,
    speed: Math.max(0, m.speedMult - 1) / 0.06,
    leech: bonusLeech / 0.05,
  };
  const investedStats = (Object.entries(scores) as Array<[InvestedStatKey, number]>)
    .filter(([, score]) => score > 0.01)
    .map(([key, score]) => ({ key, ...STAT_META[key], score }))
    .sort((a, b) => b.score - a.score);
  return { powerRatio, power, topStats: investedStats.slice(0, 2), investedStats };
}

function cardLeech(build: CardCounts | null | undefined, faction: string, mobStats?: MobStatCounts, campClears = 0): number {
  let rows = 0;
  for (const { def, count } of ownedCards(build)) {
    for (const e of cardRows(def.id, faction)) {
      if (e.k === "stat" && e.stat === "lifesteal") rows += e.v * count;
    }
  }
  let farm = faction === "holy" ? holyCampLifestealOf(campClears) : 0;
  for (const e of mobStatRows(mobStats)) if (e.k === "stat" && e.stat === "lifesteal") farm += e.v;
  return Math.max(0, Math.min(0.25, rows)) + Math.max(0, farm);
}

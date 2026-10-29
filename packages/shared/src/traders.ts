import { WEAPONS, WEAPON_IDS, isWeaponId, type WeaponId } from "./weapons";
import type { Effect, StatKey } from "./effects";

export const TRADER_RANGE = 112;
export const TRADER_SPEED = 42;
export const TRADER_STOP_MS = 8_000;
export type TraderKind = "barter" | "stats";
export interface TraderLike { id: string; kind: string; name: string; x: number; y: number }
export interface StatTrade { cost: StatKey; costValue: number; gain: StatKey; gainValue: number; label: string }
export const TRADE_STATS = ["maxHp", "ad", "ap", "attackSpeed", "moveSpeed", "armor", "shield"] as const;
export type TradeStat = typeof TRADE_STATS[number];
export const TRADE_STAT_NAMES: Record<TradeStat, string> = {
  maxHp: "max HP", ad: "Offense", ap: "Soul Offence", attackSpeed: "attack speed", moveSpeed: "movement speed",
  armor: "Defense", shield: "Soul Defense",
};

export function parseStatTrade(raw: string): StatTrade | null {
  try {
    const v = JSON.parse(raw) as StatTrade;
    return TRADE_STATS.includes(v.cost as TradeStat) && TRADE_STATS.includes(v.gain as TradeStat)
      && v.cost !== v.gain && Number.isFinite(v.costValue) && v.costValue > 0
      && Number.isFinite(v.gainValue) && v.gainValue > 0 && typeof v.label === "string" ? v : null;
  } catch { return null; }
}

export function tradeEffects(stats: { forEach(cb: (value: number, key: string) => void): void } | undefined): Effect[] {
  const rows: Effect[] = [];
  stats?.forEach((v, key) => {
    if (!Number.isFinite(v) || !TRADE_STATS.includes(key as TradeStat)) return;
    if (key === "armor" || key === "shield" || key === "ad" || key === "ap") rows.push({ k: "flat", stat: key, v });
    else rows.push({ k: "stat", stat: key as Exclude<TradeStat, "armor" | "shield" | "ad" | "ap">, v });
  });
  return rows;
}

/** The villager's inventory is a stable counter-cycle, so moving away cannot reroll an offer. */
export function barterWeapons(held: string): readonly WeaponId[] {
  const i = isWeaponId(held) ? WEAPON_IDS.indexOf(held) : -1;
  return [WEAPON_IDS[(i + 1) % WEAPON_IDS.length]!, WEAPON_IDS[(i + 2) % WEAPON_IDS.length]!];
}

export function barterLabels(held: string): readonly string[] {
  const [a, b] = barterWeapons(held);
  const name = isWeaponId(held) ? WEAPONS[held].name : "held weapon";
  return [`Give ${name} → ${WEAPONS[a!].name}`, `Give ${name} → small healing potion`, `Give a small healing potion → ${WEAPONS[b!].name}`];
}

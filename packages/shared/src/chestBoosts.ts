// Stat chests: a few world crates offer 1 of 3 multiplicative stat boosts, "Soul Offence x1.2".
// Power ladder: one normal mob kill stack (mobStats.ts: +1 Offense/SO, +1.25 Defense, +1.5 SD, +1%, +0.25% leech) < one boost pick < one tier-I base card
// (cards.ts BASE_NUMBERS: 12 AD, 15 armor, 9% haste) < an augment (a rule, and it raises card power P, the PvP factor).
// A boost multiplies max(the stat's bonus today, a floor): the floor keeps a pick worth something on an empty sheet (a x1.2 of 0 is
// 0), the bonus makes it grow with the build. It is NOT in `build`, so it adds no card power and no PvP factor. Pure.
import { CHEST_BOOST_DECAY, CHEST_BOOST_MAX_PICKS, CHEST_BOOST_STEP } from "./constants";
import type { Rng } from "./rng";

export const CHEST_BOOST_PREFIX = "boost:";

export const CHEST_BOOST_STATS = ["ad", "ap", "armor", "shield", "maxHp", "attackSpeed", "moveSpeed", "lifesteal"] as const;
export type ChestBoostStat = (typeof CHEST_BOOST_STATS)[number];

export interface ChestBoostDef {
  title: string;
  /** The amount the multiplier is taken of when the stat's bonus is smaller (points, or a fraction). */
  floor: number;
  /** The most one pick can add (same unit): under a tier-I base card, so a boost never outgrows the card or an augment late in a run. */
  ceiling: number;
  text: string;
}

export const CHEST_BOOST_DEFS: Readonly<Record<ChestBoostStat, ChestBoostDef>> = {
  ad: { title: "Offense", floor: 25, ceiling: 9, text: "Offense x1.2 (at least +5, at most +9)" },
  ap: { title: "Soul Offence", floor: 25, ceiling: 9, text: "Soul Offence x1.2 (at least +5, at most +9)" },
  armor: { title: "Defense", floor: 40, ceiling: 11, text: "Defense bonus x1.2 (at least +8, at most +11)" },
  shield: { title: "Soul Defense", floor: 40, ceiling: 11, text: "Soul Defense bonus x1.2 (at least +8, at most +11)" },
  maxHp: { title: "Max HP", floor: 0.15, ceiling: 0.065, text: "Bonus max HP x1.2 (at least +3%, at most +6.5%)" },
  attackSpeed: { title: "Attack Speed", floor: 0.15, ceiling: 0.065, text: "Bonus attack speed x1.2 (at least +3%, at most +6.5%)" },
  moveSpeed: { title: "Move Speed", floor: 0.06, ceiling: 0.04, text: "Bonus move speed x1.2 (at least +1.2%, at most +4%)" },
  lifesteal: { title: "Leech", floor: 0.05, ceiling: 0.035, text: "Bonus leech x1.2 (at least +1%, at most +3.5%)" },
};

export const chestBoostId = (stat: ChestBoostStat): string => `${CHEST_BOOST_PREFIX}${stat}`;

export function chestBoostStat(id: string): ChestBoostStat | null {
  if (!id.startsWith(CHEST_BOOST_PREFIX)) return null;
  const s = id.slice(CHEST_BOOST_PREFIX.length);
  return (CHEST_BOOST_STATS as readonly string[]).includes(s) ? (s as ChestBoostStat) : null;
}

export const isChestBoostId = (id: string): boolean => chestBoostStat(id) !== null;

/** The fraction a stat gains from `picks` boosts: +20%, +36%, +48.8%, then nothing more. */
export function chestBoostBonus(picks: number): number {
  const n = countedPicks(picks);
  let total = 0;
  let step = CHEST_BOOST_STEP;
  for (let i = 0; i < n; i++) { total += step; step *= CHEST_BOOST_DECAY; }
  return total;
}

/** The picks that count: whole, at most CHEST_BOOST_MAX_PICKS. */
const countedPicks = (picks: number): number => Math.min(CHEST_BOOST_MAX_PICKS, Math.max(0, Math.floor(Number.isFinite(picks) ? picks : 0)));

/**
 * What `picks` boosts add to a stat whose bonus is `current` (same unit, read AFTER that stat's caps): the multiplied part, taken of
 * at least the floor, and never more than the def's ceiling per pick.
 */
export function chestBoostGain(stat: ChestBoostStat, picks: number, current: number): number {
  const def = CHEST_BOOST_DEFS[stat];
  return Math.min(chestBoostBonus(picks) * Math.max(current, def.floor), def.ceiling * countedPicks(picks));
}

export type ChestBoostCounts = { forEach(cb: (value: number, key: string) => void): void } | null | undefined;

/** Picks per stat from a PlayerState.chestBoosts map. */
export function chestBoostPicks(counts: ChestBoostCounts): Partial<Record<ChestBoostStat, number>> {
  const out: Partial<Record<ChestBoostStat, number>> = {};
  counts?.forEach((v, k) => { if (k in CHEST_BOOST_DEFS && v > 0) out[k as ChestBoostStat] = v; });
  return out;
}

/** Three distinct stats from the private reward stream: one draw per slot. */
export function rollBoostOptions(rng: Rng, count = 3): string[] {
  const pool = [...CHEST_BOOST_STATS];
  const out: string[] = [];
  while (out.length < count && pool.length > 0) {
    const i = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
    out.push(chestBoostId(pool.splice(i, 1)[0]!));
  }
  return out;
}

import type { Effect } from "./effects";
import type { FactionId } from "./factions";
import { MOB_TYPES, type MobTypeId } from "./mobs";

/** Legacy benchmark scale. This is not an acquisition or reward cap. */
export const MOB_STAT_CAP = 10;

/** Counts use JS numbers on the wire; safe integers preserve exact per-kill progression. */
export const MOB_STAT_COUNT_MAX = Number.MAX_SAFE_INTEGER;

/** Non-negative whole reward count, rejecting values that cannot be represented exactly. */
export function normalizeMobStatCount(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  const count = Math.floor(value);
  return Number.isSafeInteger(count) ? count : 0;
}

type StatEffect = Extract<Effect, { k: "stat" }>;
type FlatEffect = Extract<Effect, { k: "flat" }>;
type RewardEffect = StatEffect | FlatEffect;

/** A plain record or MapSchema-like map of per-type kill stacks. */
export type MobStatCounts =
  | Readonly<Record<string, number>>
  | { get(key: string): number | undefined }
  | null
  | undefined;

interface RewardDef {
  effect: RewardEffect;
  suffix: string;
}

/** Exactly one fixed reward row for each of the twenty normal types; elites have no stat reward. */
const REWARDS: Partial<Record<MobTypeId, RewardDef>> = {
  emberImp: { effect: { k: "stat", stat: "damage", v: 0.01 }, suffix: "damage" },
  cinderHound: { effect: { k: "stat", stat: "moveSpeed", v: 0.005 }, suffix: "move speed" },
  magmaBrute: { effect: { k: "stat", stat: "maxHp", v: 0.01 }, suffix: "max health" },
  bailiff: { effect: { k: "flat", stat: "armor", v: 1 }, suffix: "Defense" },
  chainWarden: { effect: { k: "flat", stat: "shield", v: 1 }, suffix: "Soul Defense" },
  inquisitor: { effect: { k: "stat", stat: "damage", v: 0.01 }, suffix: "damage" },
  plagueRat: { effect: { k: "stat", stat: "attackSpeed", v: 0.01 }, suffix: "attack speed" },
  bloatfly: { effect: { k: "stat", stat: "moveSpeed", v: 0.005 }, suffix: "move speed" },
  rotMonk: { effect: { k: "stat", stat: "lifesteal", v: 0.0025 }, suffix: "lifesteal" },
  frostWisp: { effect: { k: "flat", stat: "shield", v: 1 }, suffix: "Soul Defense" },
  iceGolem: { effect: { k: "stat", stat: "maxHp", v: 0.01 }, suffix: "max health" },
  rimeStalker: { effect: { k: "flat", stat: "armor", v: 1 }, suffix: "Defense" },
  acolyte: { effect: { k: "stat", stat: "lifesteal", v: 0.0025 }, suffix: "lifesteal" },
  seraphShard: { effect: { k: "flat", stat: "shield", v: 1 }, suffix: "Soul Defense" },
  penitent: { effect: { k: "stat", stat: "maxHp", v: 0.01 }, suffix: "max health" },
  flameCaller: { effect: { k: "flat", stat: "ap", v: 1 }, suffix: "Soul Offence" },
  pardoner: { effect: { k: "flat", stat: "ad", v: 1 }, suffix: "Offense" },
  miasmaWitch: { effect: { k: "flat", stat: "ap", v: 1 }, suffix: "Soul Offence" },
  frostbowSentry: { effect: { k: "stat", stat: "attackSpeed", v: 0.01 }, suffix: "attack speed" },
  zealot: { effect: { k: "flat", stat: "armor", v: 1 }, suffix: "Defense" },
};

export interface MobStatReward {
  id: MobTypeId;
  name: string;
  zone: FactionId;
  effect: RewardEffect;
  text: string;
}

/** Rewards are catalog ordered to match the shared mob type roster. */
export const MOB_STAT_REWARDS: readonly MobStatReward[] = MOB_TYPES.flatMap((mob) => {
  const def = REWARDS[mob.id];
  if (!def || mob.elite) return [];
  const { effect } = def;
  const amount = effect.k === "stat"
    ? `${(effect.v * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`
    : `${effect.v}`;
  return [{ id: mob.id, name: mob.name, zone: mob.zone, effect, text: `+${amount} ${def.suffix} per kill` }];
});

const rewardsById = new Map(MOB_STAT_REWARDS.map((reward) => [reward.id, reward]));

/** The stat reward for a normal mob type; undefined for elites and unknown types. */
export function mobStatReward(id: string): MobStatReward | undefined {
  return rewardsById.get(id as MobTypeId);
}

/** Read a type's non-negative safe-integer count. Invalid wire values are ignored. */
export function mobStatCount(stacks: MobStatCounts, id: string): number {
  const hasGet = stacks && typeof (stacks as { get?: unknown }).get === "function";
  const count = hasGet
    ? (stacks as { get(key: string): number | undefined }).get(id)
    : (stacks as Readonly<Record<string, number>> | undefined)?.[id];
  return typeof count === "number" ? normalizeMobStatCount(count) : 0;
}

/** Sum each normal type's per-kill row times its normalized count, folding identical stat keys. */
export function mobStatRows(stacks: MobStatCounts): RewardEffect[] {
  const sums = new Map<string, RewardEffect>();
  for (const reward of MOB_STAT_REWARDS) {
    const count = mobStatCount(stacks, reward.id);
    if (!count) continue;
    const key = `${reward.effect.k}:${reward.effect.stat}`;
    const existing = sums.get(key);
    if (existing) existing.v += reward.effect.v * count;
    else sums.set(key, { ...reward.effect, v: reward.effect.v * count } as RewardEffect);
  }
  return [...sums.values()];
}

/** The cumulative bonus for one mob type and stack count, in player-facing stat units. */
export function mobStatText(id: string, count = 1): string {
  const reward = mobStatReward(id);
  if (!reward) return "";
  const stacks = normalizeMobStatCount(count);
  const effect = reward.effect;
  const amount = effect.k === "stat"
    ? `${(effect.v * stacks * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`
    : `${effect.v * stacks}`;
  const suffix = reward.text.replace(/^\+[^ ]+ /, "").replace(/ per kill$/, "");
  return `+${amount} ${suffix}`;
}

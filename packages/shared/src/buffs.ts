// Buff stacks, combos and the mob reward curve (GAME_DESIGN 12). Pure: the sim, the HUD and the tests all read these.
//
// A stat's bonus follows an S-curve in its stacks, so early stacks feel small, the 3rd to 5th is the spike and then it
// plateaus: bonus = Bmax x (sigmoid((stacks - s0) / w) - sigmoid(-s0 / w)), which is 0 at 0 stacks and tops out at
// Bmax x (1 - sigmoid(-s0 / w)), about 95% of Bmax (+66.7% hp, +47.6% attack speed, +28.6% move speed). Stacks are real
// numbers: a mob's drop is scaled by the reward curve, and a bounty moves half of a victim's stacks (fractions and all).
import {
  BOUNTY_STACK_SHARE, BUFF_BMAX_ATTACK_SPEED, BUFF_BMAX_HP, BUFF_BMAX_MOVE_SPEED, BUFF_S0, BUFF_W, CATCHUP_GAP, CATCHUP_MULT,
  COMBO_TIER1_STACKS, COMBO_TIER2_STACKS, MOB_PRIMARY_BUFF_SHARE, REWARD_FLOOR, REWARD_MID, REWARD_WIDTH,
} from "./constants";
import type { FactionId } from "./factions";

export type BuffStat = "hp" | "attackSpeed" | "moveSpeed";
export const BUFF_STATS: readonly BuffStat[] = ["hp", "attackSpeed", "moveSpeed"];
export type Stacks = Record<BuffStat, number>;

export function zeroStacks(): Stacks {
  return { hp: 0, attackSpeed: 0, moveSpeed: 0 };
}

const BMAX: Readonly<Record<BuffStat, number>> = {
  hp: BUFF_BMAX_HP, attackSpeed: BUFF_BMAX_ATTACK_SPEED, moveSpeed: BUFF_BMAX_MOVE_SPEED,
};

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** The bonus (0.32 = +32%) `stacks` of `stat` give. 0 for no stacks, approaching the stat's Bmax as they pile up. */
export function buffBonus(stat: BuffStat, stacks: number): number {
  if (!(stacks > 0)) return 0;
  return BMAX[stat] * (sigmoid((stacks - BUFF_S0) / BUFF_W) - sigmoid(-BUFF_S0 / BUFF_W));
}

/** Multiplier on max hp, attack speed or move speed: 1 + the bonus. */
export function buffMultiplier(stat: BuffStat, stacks: number): number {
  return 1 + buffBonus(stat, stacks);
}

/** Float slack so 3 stacks gained as 1.5 + 1.5 (or three exact drops) count as 3. */
const STACK_EPS = 1e-6;

/** 0 below COMBO_TIER1_STACKS, 1 from there, 2 from COMBO_TIER2_STACKS. */
export type ComboTier = 0 | 1 | 2;

export function comboTier(stacks: number): ComboTier {
  if (stacks >= COMBO_TIER2_STACKS - STACK_EPS) return 2;
  if (stacks >= COMBO_TIER1_STACKS - STACK_EPS) return 1;
  return 0;
}

/** Progress toward the next combo tier, for the HUD: the stacks held, the tier reached, and the stacks the next needs (null at the top). */
export function comboProgress(stacks: number): { stacks: number; tier: ComboTier; next: number | null } {
  const tier = comboTier(stacks);
  return { stacks, tier, next: tier === 0 ? COMBO_TIER1_STACKS : tier === 1 ? COMBO_TIER2_STACKS : null };
}

/** A burst of speed on a kill: move speed x `mult` for `ms`. */
export interface Burst { mult: number; ms: number }

/** What a kill sets off (any kill: a player or a mob). */
export interface KillEffects {
  bursts: Burst[];
  /** An absorb shield of `share` x the killer's max hp, for `ms`. Null for none. */
  shield: { share: number; ms: number } | null;
  /** The shared attack cooldown ends at once. */
  resetCooldown: boolean;
}

export type ComboId = "dash" | "cascade" | "shield" | "bulwark" | "bloodrush" | "frenzy";

export interface ComboSpec {
  id: ComboId;
  stat: BuffStat;
  tier: 1 | 2;
  name: string;
  text: string;
  /** The whole set at this tier: a tier-2 combo replaces its stat's tier-1 combo, so it lists that effect again. */
  onKill: KillEffects;
}

const DASH: Burst = { mult: 2.5, ms: 400 };

// The 3-stack combos follow the design sheet (a dash on kill from attack speed, a shield on kill from hp). The 5-stack
// bonuses and the move-speed pair are the Phase 11 guesses the owner has to confirm.
export const COMBOS: readonly ComboSpec[] = [
  {
    id: "dash", stat: "attackSpeed", tier: 1, name: "Dash on kill", text: "A kill launches you forward: 2.5x speed for 0.4 s",
    onKill: { bursts: [DASH], shield: null, resetCooldown: false },
  },
  {
    id: "cascade", stat: "attackSpeed", tier: 2, name: "Cascade", text: "A kill also resets your attack cooldown",
    onKill: { bursts: [DASH], shield: null, resetCooldown: true },
  },
  {
    id: "shield", stat: "hp", tier: 1, name: "Shield on kill", text: "A kill wraps you in a shield worth 15% of max hp for 5 s",
    onKill: { bursts: [], shield: { share: 0.15, ms: 5000 }, resetCooldown: false },
  },
  {
    id: "bulwark", stat: "hp", tier: 2, name: "Bulwark", text: "The kill shield doubles: 30% of max hp for 8 s",
    onKill: { bursts: [], shield: { share: 0.3, ms: 8000 }, resetCooldown: false },
  },
  {
    id: "bloodrush", stat: "moveSpeed", tier: 1, name: "Bloodrush", text: "A kill gives 1.5x speed for 3 s",
    onKill: { bursts: [{ mult: 1.5, ms: 3000 }], shield: null, resetCooldown: false },
  },
  {
    id: "frenzy", stat: "moveSpeed", tier: 2, name: "Frenzy run", text: "The rush grows: 1.8x speed for 5 s",
    onKill: { bursts: [{ mult: 1.8, ms: 5000 }], shield: null, resetCooldown: false },
  },
];

/** The combo `stacks` of `stat` have reached: the highest tier, or null below the first threshold. */
export function comboFor(stat: BuffStat, stacks: number): ComboSpec | null {
  const tier = comboTier(stacks);
  if (tier === 0) return null;
  return COMBOS.find((c) => c.stat === stat && c.tier === tier) ?? null;
}

/** Every combo a set of stacks has unlocked: at most one per stat. */
export function activeCombos(stacks: Stacks): ComboSpec[] {
  const out: ComboSpec[] = [];
  for (const stat of BUFF_STATS) {
    const c = comboFor(stat, stacks[stat]);
    if (c) out.push(c);
  }
  return out;
}

/** What one kill sets off with these stacks: every active combo's effects together (the strongest shield wins). */
export function killEffects(stacks: Stacks): KillEffects {
  const out: KillEffects = { bursts: [], shield: null, resetCooldown: false };
  for (const c of activeCombos(stacks)) {
    // Copies: the catalog's objects are shared, and a caller must not be able to edit a combo through its result.
    for (const b of c.onKill.bursts) out.bursts.push({ ...b });
    if (c.onKill.shield && (!out.shield || c.onKill.shield.share > out.shield.share)) out.shield = { ...c.onKill.shield };
    if (c.onKill.resetCooldown) out.resetCooldown = true;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------- feed
// The feed score itself (feedScore) and the bounty (bountyFor) are in rules.ts.

/** The mob reward curve: near 1 while hungry, falling sharply around a feed of REWARD_MID, never below REWARD_FLOOR. */
export function rewardCurve(feed: number): number {
  return REWARD_FLOOR + (1 - REWARD_FLOOR) * (1 - sigmoid((feed - REWARD_MID) / REWARD_WIDTH));
}

/** Median of the values (the mean of the two middle ones for an even count); 0 for none. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** CATCHUP_MULT for a feed more than CATCHUP_GAP below the lobby median, else 1. */
export function catchUpMultiplier(feed: number, medianFeed: number): number {
  return feed < medianFeed - CATCHUP_GAP ? CATCHUP_MULT : 1;
}

/** What a mob's GV and buff stacks are multiplied by for a player with this feed in a lobby with this median feed. */
export function mobRewardMultiplier(feed: number, medianFeed: number): number {
  return rewardCurve(feed) * catchUpMultiplier(feed, medianFeed);
}

/** The stacks a bounty kill moves to the killer from a victim holding `stacks` of one stat. */
export function bountyStacks(stacks: number): number {
  return stacks * BOUNTY_STACK_SHARE;
}

// ------------------------------------------------------------------------------------------------- mob drops

/** The buff stat each region's mobs mostly drop, so the map doubles as a shopping list for a combo. */
export const REGION_BUFF: Readonly<Record<FactionId, BuffStat>> = {
  fire: "attackSpeed",
  sentenced: "moveSpeed",
  plague: "hp",
  frost: "hp",
  holy: "attackSpeed",
};

/** The stat of one mob drop: the region's own with MOB_PRIMARY_BUFF_SHARE, else one of the other two (equally likely). One `random()` call. */
export function rollBuffStat(region: FactionId, random: () => number): BuffStat {
  const primary = REGION_BUFF[region];
  const r = random();
  if (r < MOB_PRIMARY_BUFF_SHARE) return primary;
  const others = BUFF_STATS.filter((s) => s !== primary);
  const k = (r - MOB_PRIMARY_BUFF_SHARE) / (1 - MOB_PRIMARY_BUFF_SHARE);
  return others[Math.min(others.length - 1, Math.floor(k * others.length))]!;
}

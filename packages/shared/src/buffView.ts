// What the HUD and the toasts say about buffs, the kill barrier and the feed (GAME_DESIGN 12, 15). Pure, so the numbers and
// the wording are tested without a DOM; the client only lays the strings out. The maths itself is buffs.ts and rules.ts.
import {
  BUFF_STATS, buffBonus, catchUpMultiplier, comboFor, comboProgress, COMBOS, comboTier, median, mobRewardMultiplier,
  type BuffStat, type ComboSpec, type ComboTier, type Stacks,
} from "./buffs";
import { COMBO_TIER1_STACKS, COMBO_TIER2_STACKS, FEED_MOB_KILL_WEIGHT } from "./constants";
import { feedScore } from "./rules";

export const BUFF_LABELS: Readonly<Record<BuffStat, string>> = {
  hp: "Max HP",
  attackSpeed: "Attack speed",
  moveSpeed: "Move speed",
};

/**
 * Stacks as the player reads them: one decimal, to the nearest tenth (so a drop of 1.1 on top of nothing reads 1.1, the
 * same as the toast), except that a number short of a combo threshold never rounds up onto it: 2.97 reads 2.9, so a
 * "3.0" always means the first combo is unlocked.
 */
export function formatStacks(stacks: number): string {
  if (!(stacks > 0)) return "0.0";
  let tenths = Math.round(stacks * 10);
  // comboTier carries the float32 slack: 2.9999995 has unlocked the combo and reads 3.0.
  const tier = comboTier(stacks);
  if (tier < 1 && tenths >= COMBO_TIER1_STACKS * 10) tenths = COMBO_TIER1_STACKS * 10 - 1;
  else if (tier < 2 && tenths >= COMBO_TIER2_STACKS * 10) tenths = COMBO_TIER2_STACKS * 10 - 1;
  return (tenths / 10).toFixed(1);
}

/** Stacks just gained, for a toast: one decimal, rounded to nearest. */
export function formatGain(stacks: number): string {
  return (Math.round(stacks * 10) / 10).toFixed(1);
}

/** A bonus (0.23) as "+23%". */
export function formatBonus(bonus: number): string {
  return `+${Math.round((bonus > 0 ? bonus : 0) * 100)}%`;
}

/** A multiplier as "x0.85". */
export function formatMult(mult: number): string {
  return `x${mult.toFixed(2)}`;
}

/** One HUD row: a stat, the stacks held, what they give and how far the next combo is. */
export interface BuffRow {
  stat: BuffStat;
  label: string;
  stacks: number;
  /** One decimal (formatStacks). */
  stacksText: string;
  bonus: number;
  /** "+23%" */
  bonusText: string;
  tier: ComboTier;
  /** Stacks the next combo tier needs; null at the top. */
  next: number | null;
  /** 0..1, stacks / next (1 at the top). */
  progress: number;
  /** The combo reached (the highest tier), or null below the first threshold. */
  combo: ComboSpec | null;
}

export function buffRow(stat: BuffStat, stacks: number): BuffRow {
  const held = stacks > 0 ? stacks : 0;
  const { tier, next } = comboProgress(held);
  const bonus = buffBonus(stat, held);
  return {
    stat,
    label: BUFF_LABELS[stat],
    stacks: held,
    stacksText: formatStacks(held),
    bonus,
    bonusText: formatBonus(bonus),
    tier,
    next,
    progress: next === null ? 1 : Math.min(1, held / next),
    combo: comboFor(stat, held),
  };
}

/** The three rows, in BUFF_STATS order (Max HP, Attack speed, Move speed). */
export function buffRows(stacks: Stacks): BuffRow[] {
  return BUFF_STATS.map((stat) => buffRow(stat, stacks[stat]));
}

/** The stacks of a synced player (PlayerState's three float fields). */
export function stacksOfPlayer(p: { stacksHp: number; stacksAs: number; stacksMs: number }): Stacks {
  return { hp: p.stacksHp, attackSpeed: p.stacksAs, moveSpeed: p.stacksMs };
}

/** True once any stat has a stack: the HUD hides the buff rows until then. */
export function hasAnyStacks(stacks: Stacks): boolean {
  return BUFF_STATS.some((s) => stacks[s] > 0);
}

/** The combo with this id from the catalog, or undefined (an id from newer server content). */
export function comboById(id: string): ComboSpec | undefined {
  return COMBOS.find((c) => c.id === id);
}

/** "+1.1 Attack speed (3.2)": the toast for a drop of `gained` stacks that brought the stat to `total`. */
export function buffToast(stat: string, gained: number, total: number): string {
  const label = (BUFF_LABELS as Readonly<Record<string, string>>)[stat] ?? stat;
  return `+${formatGain(gained)} ${label} (${formatStacks(total)})`;
}

/** "Combo unlocked: Dash on kill" */
export function comboToast(combo: ComboSpec): string {
  return `Combo unlocked: ${combo.name}`;
}

// ------------------------------------------------------------------------------------------------------------ feed

/** What the feed line says: the feed score and what a mob pays this player now. */
export interface FeedView {
  feed: number;
  /** Kills + mobs / 4, trimmed: "2.5", "3", "2.25". */
  feedText: string;
  /** The multiplier on a mob's GV and buff stacks (reward curve, times the catch-up bonus when it applies). */
  reward: number;
  catchUp: boolean;
  /** "Feed 2.5 (kills + mobs/4) · mobs pay x0.85" */
  line: string;
}

export function feedView(playerKills: number, mobKills: number, medianFeed: number): FeedView {
  const feed = feedScore(playerKills, mobKills);
  const reward = mobRewardMultiplier(feed, medianFeed);
  const catchUp = catchUpMultiplier(feed, medianFeed) > 1;
  const feedText = String(Number(feed.toFixed(2)));
  const per = Number((1 / FEED_MOB_KILL_WEIGHT).toFixed(2));
  const line = `Feed ${feedText} (kills + mobs/${per}) · mobs pay ${formatMult(reward)}${catchUp ? " (catch-up)" : ""}`;
  return { feed, feedText, reward, catchUp, line };
}

/** Median feed of the players still alive: the lobby median the catch-up bonus is measured against (the server's rule, from public state). */
export function lobbyMedianFeed(players: Iterable<{ status: string; kills: number; mobKills: number }>): number {
  const feeds: number[] = [];
  for (const p of players) if (p.status === "alive") feeds.push(feedScore(p.kills, p.mobKills));
  return median(feeds);
}

// ------------------------------------------------------------------------------------------------- kill barrier

/** The biggest kill shield a combo gives, as a share of max hp (Bulwark, 30%): a full ring on the body. */
export const MAX_BARRIER_SHARE = Math.max(0, ...COMBOS.map((c) => c.onKill.shield?.share ?? 0));

/** 0..1: how full a kill barrier of `barrier` hp is against the most any combo gives at this max hp. */
export function barrierStrength(barrier: number, maxHp: number): number {
  if (!(barrier > 0) || !(maxHp > 0) || !(MAX_BARRIER_SHARE > 0)) return 0;
  return Math.min(1, barrier / (maxHp * MAX_BARRIER_SHARE));
}

/**
 * The hp bar's two segments as shares of the bar: hp, then the barrier after it. The bar spans max hp; if hp plus the
 * barrier is more than that, both shrink so the pair still fits.
 */
export function hpBarFractions(hp: number, maxHp: number, barrier: number): { hp: number; barrier: number } {
  const h = hp > 0 ? hp : 0;
  const b = barrier > 0 ? barrier : 0;
  const total = Math.max(maxHp > 0 ? maxHp : 0, h + b);
  if (!(total > 0)) return { hp: 0, barrier: 0 };
  return { hp: h / total, barrier: b / total };
}

/** The HUD's hp readout: "HP 400/500", and "HP 400/500 +75 shield" while a kill barrier holds. */
export function hpText(hp: number, maxHp: number, barrier: number): string {
  const base = `HP ${Math.ceil(hp)}/${Math.round(maxHp)}`;
  return barrier > 0 && Math.ceil(barrier) > 0 ? `${base} +${Math.ceil(barrier)} shield` : base;
}

// What the HUD and the toasts say about buffs, the barrier and the feed (GAME_DESIGN 12, 15). Pure, so the numbers and the
// wording are tested without a DOM; the client only lays the strings out. The maths itself is buffs.ts and rules.ts.
import {
  BUFFS, buffDef, buffScale, buffText, catchUpMultiplier, median, mobRewardMultiplier, stacksIn, type BuffDef, type BuffId,
  type BuffStacks, type BuffTag,
} from "./buffs";
import { FEED_MOB_KILL_WEIGHT } from "./constants";
import type { FactionId } from "./factions";
import { mobBuffStacks } from "./mobs";
import { feedScore } from "./rules";

/** Stacks as the player reads them: one decimal, to the nearest tenth (a grant of 1.1 on top of nothing reads 1.1, as the toast does). */
export function formatStacks(stacks: number): string {
  if (!(stacks > 0)) return "0.0";
  return (Math.round(stacks * 10) / 10).toFixed(1);
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

/** One entry of the build strip: a buff held, what its stacks give now, and what the next kill of its type adds. */
export interface BuffView {
  id: BuffId;
  name: string;
  /** The zone whose mobs give it (its colour). */
  zone: FactionId;
  elite: boolean;
  stacks: number;
  /** One decimal (formatStacks). */
  stacksText: string;
  /** buffScale(stacks): its quoted numbers times this. */
  scale: number;
  /** The line at these stacks: "+5.4% damage". */
  text: string;
  /** The quoted line (at 3 stacks). */
  quoted: string;
  /** False while a row needs the status runtime (shown, not applied until R4b). */
  active: boolean;
  /** Stacks one more kill of this type adds at the reward multiplier given (an elite type's own grant for an elite). */
  nextGain: number;
  /** The line once that kill is in. */
  nextText: string;
  worksWith: readonly BuffTag[];
  counters: readonly BuffTag[];
}

function viewOf(def: BuffDef, stacks: number, reward: number): BuffView {
  const held = stacks > 0 ? stacks : 0;
  const gain = mobBuffStacks(def.elite) * (reward > 0 ? reward : 0);
  return {
    id: def.id, name: def.name, zone: def.zone, elite: def.elite,
    stacks: held, stacksText: formatStacks(held), scale: buffScale(held),
    text: buffText(def.id, held), quoted: def.text, active: def.needs === undefined,
    nextGain: gain, nextText: buffText(def.id, held + gain),
    worksWith: def.worksWith, counters: def.counters,
  };
}

/** The view of one buff at `stacks` (null for an id not in the catalog). `reward`: what a mob pays the player now (feedView). */
export function buffView(id: string, stacks: number, reward = 1): BuffView | null {
  const def = buffDef(id);
  return def ? viewOf(def, stacks, reward) : null;
}

/** Every buff held (stacks above 0), in catalog order (zone order, normals then the elite). */
export function buffViews(stacks: BuffStacks, reward = 1): BuffView[] {
  const out: BuffView[] = [];
  for (const def of BUFFS) {
    const n = stacksIn(stacks, def.id);
    if (n > 0) out.push(viewOf(def, n, reward));
  }
  return out;
}

/** True once any buff has a stack: the HUD hides the build strip until then. */
export function hasAnyBuffs(stacks: BuffStacks): boolean {
  return BUFFS.some((def) => stacksIn(stacks, def.id) > 0);
}

/** "Ember Imp +1.1 (3.2): +5.4% damage": the toast for `gained` stacks of `id` that brought it to `total`. */
export function buffToast(id: string, gained: number, total: number): string {
  const def = buffDef(id);
  const name = def?.name ?? id;
  const line = def ? `: ${buffText(id, total)}` : "";
  return `${name} +${formatGain(gained)} (${formatStacks(total)})${line}`;
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

// ------------------------------------------------------------------------------------------------------ barrier

/**
 * A barrier of this share of max hp draws as a full ring on the body. The kill combos that gave one are gone; R6's
 * skills bring barriers back, and this is the scale they draw against (the old Bulwark's 30%).
 */
export const BARRIER_FULL_SHARE = 0.3;

/** 0..1: how full a barrier of `barrier` hp is against BARRIER_FULL_SHARE of max hp. */
export function barrierStrength(barrier: number, maxHp: number): number {
  if (!(barrier > 0) || !(maxHp > 0)) return 0;
  return Math.min(1, barrier / (maxHp * BARRIER_FULL_SHARE));
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

/** The HUD's hp readout: "HP 400/500", and "HP 400/500 +75 barrier" while a barrier holds. */
export function hpText(hp: number, maxHp: number, barrier: number): string {
  const base = `HP ${Math.ceil(hp)}/${Math.round(maxHp)}`;
  return barrier > 0 && Math.ceil(barrier) > 0 ? `${base} +${Math.ceil(barrier)} barrier` : base;
}

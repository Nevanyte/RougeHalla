// The chest panel's rules, pure so they are tested without a DOM (ui/chestPanel.ts draws them): which reward chest the panel
// shows, what each card is and whether it can be picked, when everything greys out, and what the status line says. Nothing
// here is ever sent: the server decides every pick; this only avoids offering one it would refuse.
import {
  CHEST_GREY_MS, CHEST_PANEL_SLACK, CHEST_RANGE, FACTIONS, chestOptionView, hasLineOfSight, isEliteCamp, rankIn, skillDef, skillText,
  type BuildRanks, type CampDef, type ChestOptionView, type GameMap, type Vec2,
} from "@raid/shared";

/** The panel's keys, as KeyboardEvent.code. Number-row and numpad digits do the same. */
export const CHEST_FOCUS_KEY = "KeyC";

/** A reward container as the panel reads it: the synced ContainerState (arrays are schema arrays), or a test's plain object. */
export interface RewardSource {
  kind: string;
  x: number;
  y: number;
  camp: number;
  expiresAt: number;
  options: ArrayLike<string>;
  takenBy: ArrayLike<string>;
  pickers: ArrayLike<string>;
}

/** A live reward chest, copied out of the state (plain arrays, safe to hold for a frame). */
export interface Reward {
  id: string;
  x: number;
  y: number;
  /** The camp's index in map.camps + 1 (0 = none), as the server wrote it. */
  camp: number;
  expiresAt: number;
  options: string[];
  takenBy: string[];
  pickers: string[];
}

/** The chest as a `Reward`, or null when the container is not a reward chest. */
export function readReward(c: RewardSource, id: string): Reward | null {
  if (c.kind !== "reward") return null;
  const options = Array.from(c.options);
  const takenBy = Array.from(c.takenBy);
  // `takenBy` is parallel to `options`; a short one (a patch half applied) reads as free.
  while (takenBy.length < options.length) takenBy.push("");
  return { id, x: c.x, y: c.y, camp: c.camp, expiresAt: c.expiresAt, options, takenBy, pickers: Array.from(c.pickers) };
}

// --------------------------------------------------------------------------------------------------------------- time

/**
 * The server's own time now. The client's estimate of it (the clock the HUD counts down against) is built from patch
 * arrivals, so it runs one way trip behind the server: a pick sent now lands a full round trip after that estimate.
 */
export function trueServerNow(estimated: number, rttMs: number): number {
  return estimated + Math.max(0, rttMs) / 2;
}

/**
 * When every option greys out, in server time: a pick sent at this moment arrives RTT/2 later, so a chest about to vanish is
 * not offered (ROGUELIKE_PLAN R5: `expiresAt - (RTT/2 + 50 ms)`).
 */
export function greyAtMs(expiresAt: number, rttMs: number): number {
  return expiresAt - (Math.max(0, rttMs) / 2 + CHEST_GREY_MS);
}

/** True from `greyAtMs` on, with `trueNow` the server's time now (trueServerNow). */
export function isGreyed(expiresAt: number, trueNow: number, rttMs: number): boolean {
  return trueNow >= greyAtMs(expiresAt, rttMs);
}

/** "0:12": whole seconds left (a part of a second counts as one), never below 0:00. */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil((Number.isFinite(ms) ? ms : 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The share of the chest's lifetime left, 0..1 (the timer ring and the panel's bar). */
export function timeShare(expiresAt: number, trueNow: number, totalMs: number): number {
  if (!(totalMs > 0)) return 0;
  return Math.max(0, Math.min(1, (expiresAt - trueNow) / totalMs));
}

// -------------------------------------------------------------------------------------------------------------- range

/** The most a player may be from a chest for the panel to open: the server's range less a margin for the position it has. */
export const PANEL_RANGE = CHEST_RANGE - CHEST_PANEL_SLACK;

/** Within the panel's range of the chest, from the LATEST SERVER position (never the predicted one). */
export function inPanelRange(from: Vec2, chest: Vec2): boolean {
  return Math.hypot(from.x - chest.x, from.y - chest.y) <= PANEL_RANGE;
}

/** Whether `id` has made their pick here (an option or a skip). */
export function hasPicked(reward: Pick<Reward, "pickers">, id: string): boolean {
  return reward.pickers.includes(id);
}

/** The option index `id` took, or -1 (no pick, or a skip). */
export function takenIndex(reward: Pick<Reward, "takenBy">, id: string): number {
  return reward.takenBy.indexOf(id);
}

export interface PanelTarget {
  reward: Reward;
  /** The local player has already picked or skipped here. */
  picked: boolean;
}

/**
 * The chest the panel shows: a live one (the server's time has not reached `expiresAt`) within PANEL_RANGE of `from`, with a
 * clear line to it when `map` is given (the server refuses a pick through a wall). A chest the player has not picked at comes
 * first, then the nearest; null when none qualifies.
 */
export function pickReward(
  rewards: readonly Reward[], from: Vec2, myId: string, trueNow: number, map?: GameMap | null,
): PanelTarget | null {
  let best: PanelTarget | null = null;
  let bestSq = Infinity;
  for (const reward of rewards) {
    if (reward.expiresAt <= trueNow || !inPanelRange(from, reward)) continue;
    if (map && !hasLineOfSight(map, from, reward)) continue;
    const picked = hasPicked(reward, myId);
    const sq = (reward.x - from.x) ** 2 + (reward.y - from.y) ** 2;
    if (best === null || (best.picked && !picked) || (picked === best.picked && sq < bestSq)) {
      best = { reward, picked };
      bestSq = sq;
    }
  }
  return best;
}

// ------------------------------------------------------------------------------------------------------------- options

export type OptionState =
  /** Nobody has taken it and this player can: pickable (unless the chest is greyed or already picked here). */
  | { kind: "free" }
  /** This player took it. */
  | { kind: "mine" }
  /** Another player took it (`by` is their id). */
  | { kind: "taken"; by: string }
  /** This player holds it at its top rank. */
  | { kind: "maxed" }
  /** An id this build does not know (newer server content): shown, never offered. */
  | { kind: "unknown" };

export interface OptionCard {
  index: number;
  id: string;
  /** Null for an unknown id. */
  view: ChestOptionView | null;
  state: OptionState;
  /** A click or a key may send this pick. */
  pickable: boolean;
}

export interface CardContext {
  myId: string;
  build: BuildRanks | null | undefined;
  faction: string | undefined;
  /** Nothing is offered: every option is greyed (about to vanish) or this player already picked. */
  closed: boolean;
}

/** The cards of a chest for this player, in the server's option order. */
export function optionCards(reward: Reward, ctx: CardContext): OptionCard[] {
  return reward.options.map((id, index) => {
    const by = reward.takenBy[index] ?? "";
    let view = chestOptionView(id, ctx.build, ctx.faction);
    if (view !== null && by === ctx.myId) {
      // Their own pick shows the rank they hold now, not the next one the build would offer.
      const held = Math.max(1, rankIn(ctx.build, id));
      view = { ...view, rank: held, text: skillText(id, held, ctx.faction), maxed: held >= 2 };
    }
    const state: OptionState = view === null ? { kind: "unknown" }
      : by === ctx.myId ? { kind: "mine" }
      : by !== "" ? { kind: "taken", by }
      : view.maxed ? { kind: "maxed" }
      : { kind: "free" };
    return { index, id, view, state, pickable: state.kind === "free" && !ctx.closed };
  });
}

/** "Rank 2" badge text for a card, or "" for a first rank. Only a skill the player already holds shows it. */
export function rankBadge(view: ChestOptionView | null): string {
  return view !== null && view.rank >= 2 ? "Rank 2" : "";
}

/** The card's pool as words: "Fire", "Neutral". A zone is its faction's display name. */
export function poolName(pool: string, factionName: (zone: string) => string): string {
  return pool === "neutral" ? "Neutral" : factionName(pool);
}

/** The state line of a card ("" for a free one). */
export function stateText(state: OptionState, nameOf: (id: string) => string | undefined): string {
  switch (state.kind) {
    case "free": return "";
    case "mine": return "You took this";
    case "taken": return `Taken by ${nameOf(state.by) ?? "another player"}`;
    case "maxed": return "Maxed: you have it at rank 2";
    case "unknown": return "Not in this version of the game";
  }
}

// --------------------------------------------------------------------------------------------------------------- status

export interface StatusInput {
  /** This player's result in the state: an option name (rank after the pick), "skip", or null (no pick yet). */
  picked: { skill: string; rank: number } | "skip" | null;
  /** A pick is on its way to the server. */
  pending: boolean;
  /** The server said no (its toast), or the pick was never confirmed. */
  refused: string | null;
  greyed: boolean;
  /** Some card can be picked. */
  anyPickable: boolean;
}

/** The first line a player reads: the result of their pick, why a pick was refused, or what to do. */
export function statusText(s: StatusInput): string {
  if (s.picked === "skip") return "You skipped this chest.";
  if (s.picked) {
    const name = skillDef(s.picked.skill)?.name ?? s.picked.skill;
    return `You took ${name}${s.picked.rank >= 2 ? " (rank 2)" : ""}.`;
  }
  if (s.pending) return "Sending your pick...";
  if (s.refused) return `${s.refused}${/[.!?]$/.test(s.refused) ? "" : "."}`;
  if (s.greyed) return "This chest is about to vanish.";
  if (!s.anyPickable) return "Nothing left to take. You can still skip.";
  return "One pick per chest, first come first served. A skip counts as your pick.";
}

/** The skill a player took at a chest: its id and the rank they hold now, or null for a skip or no pick. */
export function myPick(reward: Reward, myId: string, build: BuildRanks | null | undefined): { skill: string; rank: number } | null {
  const i = takenIndex(reward, myId);
  const id = i >= 0 ? reward.options[i] : undefined;
  return id === undefined ? null : { skill: id, rank: rankIn(build, id) };
}

// ---------------------------------------------------------------------------------------------------------------- feed lines

/** "Fire camp" / "Fire elite camp" for a camp's clear line ("... cleared"); undefined for a camp the map does not have. */
export function campLabel(camp: Pick<CampDef, "zone" | "eliteSpot"> | undefined): string | undefined {
  return camp ? `${FACTIONS[camp.zone].displayName} ${isEliteCamp(camp) ? "elite " : ""}camp` : undefined;
}

/**
 * The local player's own pick as a line: "You took Whetstone" (with "(rank 2)" once they hold it at the top), "You skipped the
 * chest" for a skip (`option` -1), and undefined for a pick of a skill this build does not know.
 */
export function pickLine(option: number, skill: string | undefined, rankHeld: number): string | undefined {
  if (option < 0) return "You skipped the chest";
  const def = skill === undefined ? undefined : skillDef(skill);
  return def ? `You took ${def.name}${rankHeld >= 2 ? " (rank 2)" : ""}` : undefined;
}

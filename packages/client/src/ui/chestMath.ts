// The chest panel's rules, pure so they are tested without a DOM (ui/chestPanel.ts draws them): which reward chest the panel
// shows, what each card is and whether it can be picked, when everything greys out, and what the status line says. Nothing
// here is ever sent: the server decides every pick; this only avoids offering one it would refuse.
import {
  CHEST_GREY_MS, CHEST_PANEL_HYSTERESIS, CHEST_PANEL_SLACK, CHEST_RANGE, FACTIONS, TICK_MS, cardDef, cardOptionView, cardTitle, countIn,
  hasLineOfSight, isEliteCamp, tierRoman,
  type CampDef, type CardCounts, type CardKind, type CardOptionView, type GameMap, type Vec2,
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

/** The round trip assumed when a scene has not measured one (or hands over something that is not a number), in ms. */
export const DEFAULT_RTT_MS = 100;

/**
 * The round trip the chest's clock and its grey-out use, from whatever a scene estimates: never negative, and the default when it
 * is not a number. The panel and the chest's ring (the scene's own clock) both read it, so they cannot disagree.
 */
export function usableRtt(ms: number): number {
  return Number.isFinite(ms) ? Math.max(0, ms) : DEFAULT_RTT_MS;
}

/**
 * A round trip from the prediction's order delay (`predict.motion.delay`). The delay is measured as the server's tick stamp less
 * one tick less the send time, so it runs between 0 and a tick short of the real round trip: a pick sent in the last instant
 * would be offered and then refused. One tick is added, which keeps the margin on the safe side.
 */
export function rttFromOrderDelay(delayMs: number): number {
  return usableRtt(delayMs + TICK_MS);
}

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

/** An open panel closes only beyond this (PANEL_RANGE plus the hysteresis), so a player weaving on the edge does not flicker it. */
export const PANEL_CLOSE_RANGE = PANEL_RANGE + CHEST_PANEL_HYSTERESIS;

/**
 * Within the panel's range of the chest, from the LATEST SERVER position (never the predicted one). `open`: the panel is already
 * showing this chest, which stays in range out to PANEL_CLOSE_RANGE.
 */
export function inPanelRange(from: Vec2, chest: Vec2, open = false): boolean {
  return Math.hypot(from.x - chest.x, from.y - chest.y) <= (open ? PANEL_CLOSE_RANGE : PANEL_RANGE);
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
 * first, then the nearest; null when none qualifies. `openId` is the chest the panel shows now (if any): it keeps its place out
 * to PANEL_CLOSE_RANGE instead of PANEL_RANGE (the hysteresis), and nothing else changes.
 */
export function pickReward(
  rewards: readonly Reward[], from: Vec2, myId: string, trueNow: number, map?: GameMap | null, openId?: string | null,
): PanelTarget | null {
  let best: PanelTarget | null = null;
  let bestSq = Infinity;
  for (const reward of rewards) {
    if (reward.expiresAt <= trueNow || !inPanelRange(from, reward, reward.id === openId)) continue;
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
  /** This player cannot take it: it needs a card they lack ("Needs Leech") or is a one-per-player card they hold ("Already yours"). */
  | { kind: "blocked"; text: string }
  /** An id this build does not know (newer server content): shown, never offered. */
  | { kind: "unknown" };

export interface OptionCard {
  index: number;
  id: string;
  /** Null for an unknown id. */
  view: CardOptionView | null;
  state: OptionState;
  /** A click or a key may send this pick. */
  pickable: boolean;
}

export interface CardContext {
  myId: string;
  build: CardCounts | null | undefined;
  /** Nothing is offered: every option is greyed (about to vanish) or this player already picked. */
  closed: boolean;
}

/** The cards of a chest for this player, in the server's option order. */
export function optionCards(reward: Reward, ctx: CardContext): OptionCard[] {
  return reward.options.map((id, index) => {
    const by = reward.takenBy[index] ?? "";
    const view = cardOptionView(id, ctx.build);
    const state: OptionState = view === null ? { kind: "unknown" }
      : by === ctx.myId ? { kind: "mine" }
      : by !== "" ? { kind: "taken", by }
      : view.blocked !== null ? { kind: "blocked", text: view.blocked.text }
      : { kind: "free" };
    return { index, id, view, state, pickable: state.kind === "free" && !ctx.closed };
  });
}

/** The tier badge of a card: "I", "II" or "III"; "" for an unknown card. */
export function tierBadge(view: CardOptionView | null): string {
  return view === null ? "" : tierRoman(view.tier);
}

const KIND_LABEL: Readonly<Record<CardKind, string>> = { base: "Base", conditional: "Conditional", augment: "Augment" };

/** "Base", "Conditional", "Augment". */
export function cardKindLabel(kind: CardKind): string {
  return KIND_LABEL[kind];
}

/** The line under a card's name: its kind and why it is on the panel for this picker ("Base · Deepens your Attack Damage", "Augment"). */
export function kindLine(view: CardOptionView | null): string {
  if (view === null) return "";
  return view.why.text === "" ? cardKindLabel(view.kind) : `${cardKindLabel(view.kind)} · ${view.why.text}`;
}

/** The state line of a card ("" for a free one). */
export function stateText(state: OptionState, nameOf: (id: string) => string | undefined): string {
  switch (state.kind) {
    case "free": return "";
    case "mine": return "You took this";
    case "taken": return `Taken by ${nameOf(state.by) ?? "another player"}`;
    case "blocked": return state.text;
    case "unknown": return "Not in this version of the game";
  }
}

// --------------------------------------------------------------------------------------------------------------- status

export interface StatusInput {
  /** This player's result in the state: the card taken (and how many of it they hold now), "skip", or null (no pick yet). */
  picked: { card: string; count: number } | "skip" | null;
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
    return `${tookText(s.picked.card, s.picked.count)}.`;
  }
  if (s.pending) return "Sending your pick...";
  if (s.refused) return `${s.refused}${/[.!?]$/.test(s.refused) ? "" : "."}`;
  if (s.greyed) return "This chest is about to vanish.";
  if (!s.anyPickable) return "Nothing left to take. You can still skip.";
  return "One pick per chest, first come first served. A skip counts as your pick.";
}

/** The card a player took at a chest: its id and how many of it they hold now, or null for a skip or no pick. */
export function myPick(reward: Reward, myId: string, build: CardCounts | null | undefined): { card: string; count: number } | null {
  const i = takenIndex(reward, myId);
  const id = i >= 0 ? reward.options[i] : undefined;
  return id === undefined ? null : { card: id, count: countIn(build, id) };
}

// ---------------------------------------------------------------------------------------------------------------- feed lines

/**
 * What the scene remembers of each reward chest's options for a few seconds after it has left the state. The `chestTaken` fx is
 * played in render time, 100 ms behind the state, so a pick in a chest's last instants arrives when the chest container is
 * already gone, and its line ("You took Haste II") would have nothing to name the card from.
 */
export class ChestMemory {
  /** How long a chest is remembered after it was last seen (ms): the fx delay plus plenty. */
  static readonly KEEP_MS = 5000;
  private readonly seen = new Map<string, { options: string[]; at: number }>();

  /** The chest is in the state now. */
  note(id: string, options: ArrayLike<string>, now: number): void {
    const known = this.seen.get(id);
    if (known && known.options.length === options.length) { known.at = now; return; }
    this.seen.set(id, { options: Array.from(options), at: now });
  }

  /** Forgets chests not seen for KEEP_MS. */
  forget(now: number): void {
    for (const [id, e] of this.seen) if (now - e.at > ChestMemory.KEEP_MS) this.seen.delete(id);
  }

  /** The card id at option `index` of a chest seen earlier, or undefined. */
  option(id: string, index: number): string | undefined {
    return this.seen.get(id)?.options[index];
  }

  get size(): number {
    return this.seen.size;
  }
}

/** "Fire camp" / "Fire elite camp" for a camp's clear line ("... cleared"); undefined for a camp the map does not have. */
export function campLabel(camp: Pick<CampDef, "zone" | "eliteSpot"> | undefined): string | undefined {
  return camp ? `${FACTIONS[camp.zone].displayName} ${isEliteCamp(camp) ? "elite " : ""}camp` : undefined;
}

/** "You took Haste II", with " (x2)" once a base card is held more than once. */
function tookText(card: string, held: number): string {
  return `You took ${cardTitle(card) || card}${held > 1 ? ` (x${held})` : ""}`;
}

/**
 * The local player's own pick as a line: "You took Haste II" (with " (x2)" once they hold a base card more than once), "You skipped
 * the chest" for a skip (`option` -1), and undefined for a pick of a card this build does not know.
 */
export function pickLine(option: number, card: string | undefined, held: number): string | undefined {
  if (option < 0) return "You skipped the chest";
  return card !== undefined && cardDef(card) !== undefined ? tookText(card, held) : undefined;
}

/**
 * The line for the local player's own `chestTaken` fx. `live` is the chest's options in the state now (undefined once the chest
 * has left it: a pick in its last instants is played after the chest is gone), `memory` what was seen of it, `countOf` how many
 * of a card the player holds now.
 */
export function chestPickLine(
  chest: string, option: number, live: ArrayLike<string> | undefined, memory: ChestMemory, countOf: (card: string) => number,
): string | undefined {
  if (option < 0) return pickLine(option, undefined, 0);
  const id = live ? Array.from(live)[option] : memory.option(chest, option);
  return pickLine(option, id, id ? countOf(id) : 0);
}

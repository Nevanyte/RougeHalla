// A camp's shared chest (BALANCE_CONTRACT 4.8): what it offers and what a skip gives. Pure: the sim rolls the options with
// `world.rewardRandom` (never `world.random`, never the public seed: D16) and puts them in the synced reward container (D17); the
// client reads the same helpers to word the cards.
//
// The roll: three distinct cards (CHEST_OPTIONS), in this order, one `rng()` per decision:
//   1. a BASE card: its tier (the camp's odds, CHEST_TIER_ODDS), then which of that tier's eight;
//   2. a CONDITIONAL (probability CHEST_CONDITIONAL_CHANCE, a coin first), picked from the live conditionals whose base at least one
//      ELIGIBLE picker owns and that not every eligible picker already holds; when the coin says no, or none qualifies, a second BASE
//      card of a different stat (tier, then which);
//   3. an AUGMENT: its tier, then which of that tier's live augments that not every eligible picker holds (none left in the tier: the
//      nearest tier that has one, lower first; no augment at all: a third base card).
// "Eligible pickers" are the players who may take from this chest: those who damaged the camp and stand near it at the clear
// (sim/campHeal.ts). With none, no conditional is offered. A chest always has at least one unconditional card (1 is a base card).
// Tier odds: a normal camp's base card 70/25/5 and its augment 50/45/5; an elite camp's both 10/60/30. A conditional is tier 2.
// The SHARED chest is rolled once for everyone; each picker's own build decides what a pick refuses (needs a base; already yours).
import { CHEST_CONDITIONAL_CHANCE, CHEST_TIER_ODDS, GV_SKIP, SKIP_HEAL_SHARE } from "./constants";
import {
  BASE_STAT_IDS, BASE_TITLES, CARD_TIERS, baseCardId, cardBlock, cardDef, cardLive, cardsOfKind, countIn, ownsBase, whyOffered,
  type BaseStatId, type CardCounts, type CardDef, type CardId, type CardKind, type CardTier, type MechanicTag, type WhyOffered,
} from "./cards";
import type { Rng } from "./rng";

export interface ChestRollOptions {
  /** An elite camp's chest (tier odds 10/60/30); default a normal camp's. */
  elite?: boolean;
  /** The builds of the eligible pickers (conditional and augment offers read them). Omit or empty: no conditional, every augment. */
  pickers?: readonly CardCounts[];
  /** Only live cards (LIVE_CARD_READY). Default true; false is for catalog tests. */
  readyOnly?: boolean;
}

type Odds = readonly [number, number, number];

function tierFor(rng: Rng, odds: Odds): CardTier {
  const r = rng() * (odds[0] + odds[1] + odds[2]);
  return r < odds[0] ? 1 : r < odds[0] + odds[1] ? 2 : 3;
}

function pickIn<T>(rng: Rng, pool: readonly T[]): T {
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]!;
}

/** The tiers to look in for a pool, nearest `tier` first (lower first on a tie). */
function tierOrder(tier: CardTier): CardTier[] {
  return [...CARD_TIERS].sort((a, b) => Math.abs(a - tier) - Math.abs(b - tier) || a - b);
}

const heldByAll = (pickers: readonly CardCounts[], id: string): boolean => pickers.length > 0 && pickers.every((b) => countIn(b, id) > 0);

/** A base card of `tier` whose stat is not in `except`. */
function baseCard(rng: Rng, tier: CardTier, except: readonly BaseStatId[]): CardId {
  const pool = BASE_STAT_IDS.filter((b) => !except.includes(b));
  return baseCardId(pickIn(rng, pool), tier);
}

/** The conditionals a chest may offer these pickers: live, a picker owns the base, and not every picker holds it. Catalog order. */
export function conditionalPool(pickers: readonly CardCounts[], readyOnly = true): CardDef[] {
  return cardsOfKind("conditional", { liveOnly: readyOnly }).filter(
    (c) => pickers.some((b) => ownsBase(b, c.requires!)) && !heldByAll(pickers, c.id),
  );
}

/** The augments of `tier` a chest may offer these pickers: live and not held by every picker. Catalog order. */
export function augmentPool(tier: CardTier, pickers: readonly CardCounts[], readyOnly = true): CardDef[] {
  return cardsOfKind("augment", { liveOnly: readyOnly }).filter((c) => c.tier === tier && !heldByAll(pickers, c.id));
}

/** A chest's options (card ids, no duplicates): a base card, a conditional or a second base card, an augment. */
export function rollChestOptions(rng: Rng, opts: ChestRollOptions = {}): CardId[] {
  const odds = opts.elite ? CHEST_TIER_ODDS.elite : CHEST_TIER_ODDS.normal;
  const pickers = opts.pickers ?? [];
  const readyOnly = opts.readyOnly !== false;
  const out: CardId[] = [];
  const used: BaseStatId[] = [];
  const takeBase = (): void => {
    const id = baseCard(rng, tierFor(rng, odds.base), used);
    used.push(cardDef(id)!.base!);
    out.push(id);
  };
  takeBase();
  const pool = conditionalPool(pickers, readyOnly);
  if (rng() < CHEST_CONDITIONAL_CHANCE && pool.length > 0) out.push(pickIn(rng, pool).id);
  else takeBase();
  const want = tierFor(rng, odds.augment);
  let pick: CardDef | null = null;
  for (const t of tierOrder(want)) {
    const augments = augmentPool(t, pickers, readyOnly);
    if (augments.length > 0) { pick = pickIn(rng, augments); break; }
  }
  if (pick) out.push(pick.id);
  else takeBase();
  return out;
}

/**
 * The toasts the server sends a player whose `choose` was refused (sim/chests.ts handleChoose): one list, so the client can
 * tell a refusal of its pick from any other toast (a GV line, a kill) without guessing at wording. A conditional's "Needs <Base>"
 * carries the base's title, so it is recognised by its prefix (isChestRefusal).
 */
export const CHEST_REFUSAL = {
  busy: "Can't do that now",
  gone: "Chest gone",
  far: "Too far away",
  blocked: "Can't reach that",
  picked: "You already picked",
  taken: "Already taken",
  owned: "Already yours",
} as const;
export const CHEST_REFUSALS: readonly string[] = Object.values(CHEST_REFUSAL);
export const CHEST_REFUSAL_NEEDS_PREFIX = "Needs ";

/** "Needs Leech": the refusal of a conditional card by a picker who has no card of its base. */
export function needsRefusal(base: BaseStatId): string {
  return `${CHEST_REFUSAL_NEEDS_PREFIX}${BASE_TITLES[base]}`;
}

/** This toast text is the server refusing a chest pick. */
export function isChestRefusal(text: string): boolean {
  return CHEST_REFUSALS.includes(text) || (text.startsWith(CHEST_REFUSAL_NEEDS_PREFIX) && BASE_STAT_IDS.some((b) => text === needsRefusal(b)));
}

/** What a skip gives (D12): heal SKIP_HEAL_SHARE of max hp when the heal lockout allows it, else GV_SKIP GV (under GV_MOB_CAP). */
export const SKIP_REWARD: Readonly<{ healShare: number; gv: number }> = { healShare: SKIP_HEAL_SHARE, gv: GV_SKIP };

/** The skip card's line. */
export function skipText(): string {
  return `Skip: heal ${Math.round(SKIP_HEAL_SHARE * 100)}% of max HP if out of combat, else +${GV_SKIP} GV`;
}

/** One option as the chest panel shows it to a picker. */
export interface CardOptionView {
  id: CardId;
  title: string;
  tier: CardTier;
  kind: CardKind;
  text: string;
  tags: readonly MechanicTag[];
  /** A base card: the stat it deepens. */
  base?: BaseStatId;
  /** A conditional: the base it needs. */
  requires?: BaseStatId;
  /** The picker's own reason this card is on the panel ("Deepens your Attack Damage", "You have Leech", "New"). */
  why: WhyOffered;
  /** Why this picker could not take it (the server refuses with the same words), or null when they can. */
  blocked: { reason: "needs" | "owned"; text: string } | null;
  /** How many of this card the picker holds now. */
  held: number;
}

/** A synced option id seen by a picker with this build; null for an id the catalog does not know. */
export function cardOptionView(id: string, build: CardCounts | null | undefined): CardOptionView | null {
  const def = cardDef(id);
  if (!def) return null;
  const view: CardOptionView = {
    id: def.id, title: def.title, tier: def.tier, kind: def.kind, text: def.text, tags: def.tags,
    why: whyOffered(id, build)!, blocked: cardBlock(id, build), held: countIn(build, id),
  };
  if (def.base) view.base = def.base;
  if (def.requires) view.requires = def.requires;
  return view;
}

/** Is `id` a card chests can roll right now (live)? */
export function cardOfferable(id: string): boolean {
  return cardLive(id);
}

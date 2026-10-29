// A camp's shared chest: three distinct, eligible interactive augments when available. Normal mob kills grant their own fixed,
// capped stat progression (mobStats.ts). Pure: the sim rolls options with `world.rewardRandom` and puts them in synced state; the
// client reads the same helpers to word the cards. Tier odds remain normal 50/45/5 and elite 10/60/30.
import { CHEST_TIER_ODDS, GV_SKIP, SKIP_HEAL_SHARE } from "./constants";
import {
  BASE_STAT_IDS, BASE_TITLES, CARD_TIERS, cardBlock, cardDef, cardLive, cardsOfKind, countIn, ownsBase, whyOffered, isInteractiveAugment,
  type BaseStatId, type CardCounts, type CardDef, type CardId, type CardKind, type CardTier, type MechanicTag, type WhyOffered,
} from "./cards";
import type { Rng } from "./rng";
import type { FactionId } from "./factions";

export interface ChestRollOptions {
  /** An elite camp's chest (tier odds 10/60/30); default a normal camp's. */
  elite?: boolean;
  /** Eligible pickers' builds; options already held by every picker are excluded. */
  pickers?: readonly CardCounts[];
  /** Optional regional theme; neutral augments remain eligible as fallback. */
  zone?: FactionId;
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

/** The conditionals a chest may offer these pickers: live, a picker owns the base, and not every picker holds it. Catalog order. */
export function conditionalPool(pickers: readonly CardCounts[], readyOnly = true): CardDef[] {
  return cardsOfKind("conditional", { liveOnly: readyOnly }).filter(
    (c) => pickers.some((b) => ownsBase(b, c.requires!)) && !heldByAll(pickers, c.id),
  );
}

/** Interactive augments eligible for a chest, excluding cards already held by every picker. */
export function rewardAugmentPool(pickers: readonly CardCounts[], readyOnly = true): CardDef[] {
  return cardsOfKind("augment", { liveOnly: readyOnly }).filter((c) => isInteractiveAugment(c) && !heldByAll(pickers, c.id));
}

/** First-slot themes use general mechanics available to every faction. Mark-exclusive Sentenced cards stay out of the shared pool. */
export const ZONE_AUGMENT_THEMES: Readonly<Record<FactionId, readonly CardId[]>> = {
  fire: ["slowBurn", "hemorrhage", "overkill"],
  sentenced: ["plantYourFeet", "wishfulThinking", "overkill"],
  plague: ["hemorrhage", "siphon", "thirdTimesTheCharm"],
  frost: ["pocketSand", "bestOffense", "tankEngine"],
  holy: ["secondWind", "siphon", "eyeForAnEye", "spikedShell"],
};

/** Tier-weighted choice from a candidate pool, falling back to nearest available tier. */
function pickTiered(rng: Rng, pool: readonly CardDef[], odds: Odds): CardDef | undefined {
  if (pool.length === 0) return undefined;
  const want = tierFor(rng, odds);
  for (const tier of tierOrder(want)) {
    const matching = pool.filter((c) => c.tier === tier);
    if (matching.length) return pickIn(rng, matching);
  }
  return undefined;
}

/** Interactive augment offers (up to three), tier-weighted, distinct, with one optional zone-themed first slot. */
export function rollChestOptions(rng: Rng, opts: ChestRollOptions = {}): CardId[] {
  const odds = opts.elite ? CHEST_TIER_ODDS.elite.augment : CHEST_TIER_ODDS.normal.augment;
  const pickers = opts.pickers ?? [];
  const pool = rewardAugmentPool(pickers, opts.readyOnly !== false);
  const out: CardId[] = [];
  const themeIds = opts.zone ? ZONE_AUGMENT_THEMES[opts.zone] : [];
  const theme = themeIds.map((id) => cardDef(id)).filter((c): c is CardDef => !!c && pool.some((eligible) => eligible.id === c.id));
  const first = theme.length ? pickTiered(rng, theme, odds) : pickTiered(rng, pool, odds);
  if (first) out.push(first.id);
  while (out.length < 3 && pool.length > 0) {
    const available = pool.filter((c) => !out.includes(c.id));
    const pick = pickTiered(rng, available, odds);
    if (!pick) break;
    out.push(pick.id);
  }
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

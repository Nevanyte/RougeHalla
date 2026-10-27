// A camp's shared chest (roguelike R5, ROGUELIKE_PLAN 3.3): what it offers and what a skip gives. Pure: the sim rolls the
// options with `world.rewardRandom` (never `world.random`, never the public seed: D16) and puts them in the synced reward
// container (D17); the client reads the same helpers to word the cards.
//
// The option rule (CHEST_RULE):
//   "interim" (R5, until R6's actives): CHEST_OPTIONS options = at most ONE live passive of the camp's zone, then live
//             neutral passives, no duplicates. A zone with no live passive (Fire and Frost until R4b) gives neutrals only.
//   "d6"      (R6, ROGUELIKE_PLAN D6): 2 from the zone's pool + 1 neutral; a pool that runs short is filled from the other.
// Options never include a skill the build already holds at its top rank (a maxed skill can't be picked); one held at
// rank 1 is offered and gives rank 2. The SHARED chest is rolled with no build (each picker's own ranks decide what a pick
// gives, and the server refuses a maxed one), so `build` is for personal rolls (R7) and the tests.
// Draws: one rng() per option taken (a partial Fisher-Yates over each pool), zone options first, then the neutrals; the
// options keep that order (the zone's card is the first one).
import { CHEST_OPTIONS, GV_SKIP, SKIP_HEAL_SHARE } from "./constants";
import type { FactionId } from "./factions";
import type { Rng } from "./rng";
import { nextRank, skillDef, skillsOf, skillText, type BuildRanks, type SkillId, type SkillPool } from "./skills";

export type ChestRule = "interim" | "d6";
/** The rule chests roll with now. R6 switches it to "d6". */
export const CHEST_RULE: ChestRule = "interim";

export interface ChestRollOptions {
  /** The camp's zone: its pool is the zone half of the roll. */
  zone: FactionId;
  /** Ranks already held: maxed skills are never offered. Omit for the shared chest. */
  build?: BuildRanks | null;
  /** Only live skills (LIVE_SKILL_READY). Default true; false is for catalog tests. */
  readyOnly?: boolean;
  /** Default CHEST_RULE. */
  rule?: ChestRule;
  /** Default CHEST_OPTIONS. */
  count?: number;
}

/** The ids a pool can offer under these options (catalog order). */
export function chestPool(pool: SkillPool, opts: Pick<ChestRollOptions, "build" | "readyOnly"> = {}): SkillId[] {
  return skillsOf(pool, { liveOnly: opts.readyOnly !== false })
    .filter((s) => nextRank(opts.build, s.id) !== null)
    .map((s) => s.id);
}

/** Takes up to `n` ids from `pool` without repeats (a partial Fisher-Yates on a copy: one rng() per id taken). */
function draw(rng: Rng, pool: readonly SkillId[], n: number): SkillId[] {
  const a = pool.slice();
  const k = Math.min(n, a.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (a.length - i));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a.slice(0, k);
}

/** A chest's options (skill ids, no duplicates), zone options first. Fewer than `count` only when the pools run dry. */
export function rollChestOptions(rng: Rng, opts: ChestRollOptions): SkillId[] {
  const count = opts.count ?? CHEST_OPTIONS;
  const zonePool = chestPool(opts.zone, opts);
  const neutralPool = chestPool("neutral", opts);
  if ((opts.rule ?? CHEST_RULE) === "interim") {
    const zone = draw(rng, zonePool, Math.min(1, count));
    return [...zone, ...draw(rng, neutralPool, count - zone.length)];
  }
  const zone = draw(rng, zonePool, Math.min(2, count));
  const neutral = draw(rng, neutralPool, count - zone.length);
  if (zone.length + neutral.length >= count) return [...zone, ...neutral];
  // A pool ran short: fill from what is left of the zone's.
  const rest = zonePool.filter((id) => !zone.includes(id));
  return [...zone, ...neutral, ...draw(rng, rest, count - zone.length - neutral.length)];
}

/**
 * The toasts the server sends a player whose `choose` was refused (sim/chests.ts handleChoose): one list, so the client can
 * tell a refusal of its pick from any other toast (a GV line, a kill) without guessing at wording.
 */
export const CHEST_REFUSAL = {
  busy: "Can't do that now",
  gone: "Chest gone",
  far: "Too far away",
  blocked: "Can't reach that",
  picked: "You already picked",
  taken: "Already taken",
  maxed: "Already at rank 2",
} as const;
export const CHEST_REFUSALS: readonly string[] = Object.values(CHEST_REFUSAL);

/** This toast text is the server refusing a chest pick. */
export function isChestRefusal(text: string): boolean {
  return CHEST_REFUSALS.includes(text);
}

/** What a skip gives (D12): heal SKIP_HEAL_SHARE of max hp when the heal lockout allows it, else GV_SKIP GV (under GV_MOB_CAP). */
export const SKIP_REWARD: Readonly<{ healShare: number; gv: number }> = { healShare: SKIP_HEAL_SHARE, gv: GV_SKIP };

/** The skip card's line. */
export function skipText(): string {
  return `Skip: heal ${Math.round(SKIP_HEAL_SHARE * 100)}% of max HP if out of combat, else +${GV_SKIP} GV`;
}

/** One option as the chest panel shows it to a picker. */
export interface ChestOptionView {
  id: SkillId;
  name: string;
  /** The rank picking it gives this picker (2 when they own it at rank 1); the top rank when `maxed`. */
  rank: number;
  /** That rank in one line, for the picker's faction. */
  text: string;
  /** The picker already holds it at the top rank: they cannot pick it. */
  maxed: boolean;
  pool: SkillPool;
}

/** A synced option id seen by a picker with this build and faction; null for an id the catalog does not know. */
export function chestOptionView(id: string, build: BuildRanks | null | undefined, faction?: string): ChestOptionView | null {
  const def = skillDef(id);
  if (!def) return null;
  const next = nextRank(build, id);
  const r = next ?? 2;
  return { id: def.id, name: def.name, rank: r, text: skillText(id, r, faction), maxed: next === null, pool: def.pool };
}

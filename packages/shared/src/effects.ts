// Effects (ROGUELIKE_PLAN 3.5): buffs, passives, relics, curses and boons are all lists of `Effect` rows, so new content
// is data unless it needs a new kind. The union is closed: code that reads it switches on `k` exhaustively (visitEffect,
// assertNever), so adding a kind fails to compile everywhere it must be handled.
//
// How rows act (the runtime is server/src/sim/mods.ts for the stat rows; the rest arrive with later phases):
//   stat, flat  fold into the fighter's stats (foldStatRows in mods.ts): additive within a key, multiplicative across keys.
//   while       folds like a stat row, but only while its condition holds (re-evaluated once per tick).
//   vs, scale   act per hit, at damage time, from the tick-start snapshot (never the live state mid-ledger).
//   onHit       applies a status when a hit lands (the ledger's hitLanded hook, R4b; statuses are Wishes' runtime).
//   trigger     runs a TriggerAction when its event happens (hp threshold, a kill, a hit taken).
// Every row may carry `requires`: it is active only while the fighter owns every one of those ids (a synergy).
// Numbers: `v` on a stat row is a fraction (0.1 = +10%, -0.08 = -8%); on a flat row and on a `while` row whose stat is
// armor or shield it is points of that stat. Durations end in `ms`.

import type { CleanseClass, StatusKind } from "./status";

/** Stats a `stat` row moves by a fraction (+10% = 0.1). */
export type EffectStat =
  | "maxHp" | "attackSpeed" | "moveSpeed" | "damage" | "windup" | "lifesteal" | "markRate"
  | "healTaken" | "damageTaken" | "cooldown";
export const EFFECT_STATS: readonly EffectStat[] = [
  "maxHp", "attackSpeed", "moveSpeed", "damage", "windup", "lifesteal", "markRate", "healTaken", "damageTaken", "cooldown",
];

/** Stats a `flat` row adds points to (on the faction's own armor and shield; GAME_DESIGN's "shield" is magic resistance). */
export type FlatStat = "armor" | "shield";
export const FLAT_STATS: readonly FlatStat[] = ["armor", "shield"];

/** Any stat an effect can name (a `while` row may name either kind). */
export type StatKey = EffectStat | FlatStat;

/** Conditions on the target of a hit that a `vs` row tests (`arg` is the threshold where one is needed). */
export type VsTest = "hpAbove" | "hpBelow" | "slowed" | "rooted" | "streak" | "thirdParty" | "higherFeed";

/** What a `scale` row grows with: +`per` of its bonus for every `step` of the source (stepped, so it rarely patches). */
export type ScaleSource = "ownMissingHp";

/** Conditions a `while` row holds under (`arg` is the threshold, `ms` how long it lasts after the event where one applies). */
export type WhileCond = "chasingLock" | "hpBelow" | "afterCast";

/** Events a `trigger` row fires on (`arg` is the hp threshold for hpBelow). */
export type TriggerOn = "hpBelow" | "kill" | "hitTaken";

/** The statuses an `onHit` row may apply. */
export type OnHitStatus = Extract<StatusKind, "slowMove" | "slowAttack" | "antiHeal" | "dot">;

/**
 * PLACEHOLDER for what a `trigger` row does: it becomes Wishes' `AbilityEffect` (shared/src/abilities.ts, their D28: one
 * implementation of heal, status and cleanse) once that file exists here, so this uses their `do:` verbs and the swap is
 * a rename. heal, barrier and cooldown are R6 appends on their side. Shares are of the fighter's max hp; `to: "target"`
 * is whoever set the trigger off (a hitTaken's attacker).
 */
export type TriggerAction =
  | { do: "status"; to: "self" | "target"; status: StatusKind; ms: number; value?: number }
  | { do: "cleanse"; to: "self" | "target"; classes: readonly CleanseClass[] }
  | { do: "heal"; share: number; ignoreLockout?: boolean }
  | { do: "barrier"; share: number; ms: number }
  | { do: "cooldown"; ms: number };

/** Fields every row may carry. */
interface EffectCommon {
  /** Synergy: the row is active only while the fighter owns every one of these ids (buffs, passives, relics...). */
  requires?: readonly string[];
}

export type Effect =
  | (EffectCommon & { k: "stat"; stat: EffectStat; v: number })
  | (EffectCommon & { k: "flat"; stat: FlatStat; v: number })
  | (EffectCommon & { k: "vs"; test: VsTest; arg: number; v: number })
  | (EffectCommon & { k: "scale"; src: ScaleSource; per: number; step: number })
  | (EffectCommon & { k: "while"; cond: WhileCond; arg: number; stat: StatKey; v: number; ms?: number })
  | (EffectCommon & { k: "onHit"; status: OnHitStatus; per: number; cap: number; ms: number })
  | (EffectCommon & { k: "trigger"; on: TriggerOn; arg: number; once?: boolean; do: TriggerAction });

export type EffectKind = Effect["k"];
/** The row of one kind, e.g. EffectOf<"stat">. */
export type EffectOf<K extends EffectKind> = Extract<Effect, { k: K }>;
/** A buff's, passive's, relic's, curse's or boon's rows. */
export type EffectList = readonly Effect[];

/** Every kind once. Its type fails to compile if a kind is added to Effect and not here. */
export const EFFECT_KINDS = ["stat", "flat", "vs", "scale", "while", "onHit", "trigger"] as const satisfies readonly EffectKind[];
type MissingKind = Exclude<EffectKind, (typeof EFFECT_KINDS)[number]>;
/** Compile-time proof that EFFECT_KINDS lists every kind (an error here names the missing one). */
export const EFFECT_KINDS_COMPLETE: [MissingKind] extends [never] ? true : MissingKind = true;

/** The default branch of an exhaustive switch: compiles only when every case has been handled. */
export function assertNever(x: never, what = "value"): never {
  throw new Error(`unhandled ${what}: ${JSON.stringify(x)}`);
}

/** One handler per kind; the compiler insists on all of them. */
export type EffectVisitor<R> = { [K in EffectKind]: (e: EffectOf<K>) => R };

/** Exhaustive dispatch on a row's kind. */
export function visitEffect<R>(e: Effect, v: EffectVisitor<R>): R {
  switch (e.k) {
    case "stat": return v.stat(e);
    case "flat": return v.flat(e);
    case "vs": return v.vs(e);
    case "scale": return v.scale(e);
    case "while": return v.while(e);
    case "onHit": return v.onHit(e);
    case "trigger": return v.trigger(e);
    default: return assertNever(e, "effect kind");
  }
}

/** Is the row active for a fighter that owns exactly the ids `owns` accepts (its `requires`, if any, all owned)? */
export function requirementsMet(e: Effect, owns?: (id: string) => boolean): boolean {
  const req = e.requires;
  if (req === undefined || req.length === 0) return true;
  if (!owns) return false;
  for (const id of req) if (!owns(id)) return false;
  return true;
}

export function isFlatStat(stat: StatKey): stat is FlatStat {
  return stat === "armor" || stat === "shield";
}

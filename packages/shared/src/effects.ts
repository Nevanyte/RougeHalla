// Effects (ROGUELIKE_PLAN 3.5): cards (cards.ts), relics, curses and boons are all lists of `Effect` rows, so new content
// is data unless it needs a new kind. The union is closed: code that reads it switches on `k` exhaustively (visitEffect,
// assertNever), so adding a kind fails to compile everywhere it must be handled.
//
// How rows act (the runtime is server/src/sim/mods.ts for the stat rows; the rest arrive with later phases):
//   stat, flat  fold into the fighter's stats (foldStatRows in mods.ts): additive within a key, multiplicative across keys.
//   while       folds like a stat row, but only while its condition holds (re-evaluated once per tick).
//   vs, scale   act per hit, at damage time, from the state as the ledger pass began (never the live state mid-ledger).
//               Both are damage rows: a `vs` row whose test holds and a `scale` row's stepped bonus add to the `damage`
//               key's sum, like a `stat` damage row (server/src/sim/mods.ts outgoingMult).
//   onHit       applies a status when a hit lands (the ledger's hitLanded hook, R4b; statuses are Wishes' runtime).
//   trigger     runs a TriggerAction when its event happens (hp threshold, a kill, a hit taken).
//   convert     (balance pass, BALANCE_CONTRACT 4.6) turns a stat the fighter has into another: one pass AFTER the plain fold,
//               from the sums as they stood before it (a conversion never feeds another), max hp already synced.
//   mult        a multiplier that is not a sum: rows of one key multiply (attack speed after its cap, the hit, a damage-over-time
//               or returned-damage tick, AP, a Wish's cooldown, a Race to 0's ceiling).
//   flag        a yes/no rule (the second weapon slot is locked; a fighter's hits never critically strike) and, since the balance
//               pass's phase B, the rules that need machinery rather than a number: sim/cardHooks.ts, sim/onHit.ts and the weapon,
//               melee and ledger code read them (`dotCrit`, `gambler`, `thirdCharm`, `eyeForAnEye`, `twiceUnarmed`, `blockHits`,
//               `plantFeet`, `festering`).
// Every row may carry `requires`: it is active only while the fighter owns every one of those ids (a synergy).
// Numbers: `v` on a stat row is a fraction (0.1 = +10%, -0.08 = -8%); on a flat row and on a `while` row whose stat is
// armor or shield it is points of that stat. Durations end in `ms`.

import type { AbilityEffect } from "./abilities";
import type { StatusKind } from "./status";

/**
 * Stats a `stat` row moves by a fraction (+10% = 0.1). `executeBand` (roguelike R5, Pestilence) raises the hp share below
 * which Plague's execute runs, from 0.5 by `v` (0.1: it starts at 60%); it does nothing for any other faction. `healBarrier`
 * (Second Skin) is the share of the healing a fighter receives that is also granted as a barrier (held to BARRIER_MAX_SHARE of max hp).
 */
export type EffectStat =
  | "maxHp" | "attackSpeed" | "moveSpeed" | "damage" | "windup" | "lifesteal" | "markRate"
  | "healTaken" | "damageTaken" | "cooldown" | "executeBand"
  | "slowResist" | "lifestealMult" | "lifestealDot" | "critChance" | "healBarrier";
export const EFFECT_STATS: readonly EffectStat[] = [
  "maxHp", "attackSpeed", "moveSpeed", "damage", "windup", "lifesteal", "markRate", "healTaken", "damageTaken", "cooldown",
  "executeBand", "slowResist", "lifestealMult", "lifestealDot", "critChance", "healBarrier",
];
/**
 * The stats whose rows MULTIPLY instead of adding: a row of `v` contributes a factor of 1 + v (Bloodthirst's `lifestealMult` +1
 * is x2), and the identity of the key is 1, not 0 (shared/mods.ts zeroSums, addToSums).
 */
export const PRODUCT_STATS: readonly EffectStat[] = ["lifestealMult"];
export function isProductStat(stat: StatKey): boolean {
  return (PRODUCT_STATS as readonly string[]).includes(stat);
}

/**
 * Stats a `flat` row adds points to: the faction's own armor and shield (GAME_DESIGN's "shield" is magic resistance), and the
 * attack damage and ability power (`ad`, `ap`) that a weapon hit and a damage-over-time effect scale with (BALANCE_CONTRACT 3.3).
 */
export type FlatStat = "armor" | "shield" | "ad" | "ap";
export const FLAT_STATS: readonly FlatStat[] = ["armor", "shield", "ad", "ap"];

/** Any stat an effect can name (a `while` row may name either kind). */
export type StatKey = EffectStat | FlatStat;

/**
 * Conditions on the target of a hit that a `vs` row tests (`arg` is the threshold where one is needed). `playerAbove` holds for a
 * PLAYER above `arg` of its max hp (Big Game Hunter: a mob at full hp is not "big game"); `hpAbove` holds for anyone.
 */
export type VsTest =
  | "hpAbove" | "hpBelow" | "slowed" | "rooted" | "streak" | "thirdParty" | "higherFeed"
  | "elite" | "higherPower" | "playerAbove";

/**
 * What a `scale` row grows with: +`per` of its bonus for every `step` of the source (stepped, so it rarely patches), up to
 * the row's `cap` where it has one. `campsCleared` counts the camps this fighter helped clear this run (Pack Leader); `streak`
 * counts the hits it has landed in a row on the target of this hit, before this one (Tunnel Vision).
 */
export type ScaleSource = "ownMissingHp" | "campsCleared" | "streak";

/**
 * Conditions a `while` row holds under (`arg` is the threshold, `ms` how long it lasts after the event where one applies).
 * `notShooting` (Swift Boots, owner ruling "No boost while shooting") holds EXCEPT from the moment a bow or wand attack starts
 * until `ms` after it lands: the one condition that is off for a window, not on. `unarmed` holds while the hand is empty (fists);
 * `fightTime` holds once the fighter has been in the same fight for `arg` seconds or more (a fight ends FIGHT_GAP_SECONDS after
 * its last landed or taken hit).
 */
export type WhileCond = "chasingLock" | "hpBelow" | "afterCast" | "notShooting" | "unarmed" | "fightTime";

/**
 * Events a `trigger` row fires on. `arg` is the hp threshold for hpBelow, and for hitTaken the share of max hp one hit must take
 * off (0: any hit); `hit` is a weapon hit the fighter lands, `block` a block it makes (its shield stopped part of a hit),
 * `kill` a killing blow it lands.
 */
export type TriggerOn = "hpBelow" | "kill" | "hitTaken" | "hit" | "block";

/**
 * The statuses an `onHit` row may apply (sim/onHit.ts). For a slow or an anti-heal `per` is the strength each hit adds, up to `cap`;
 * for `dot` (a bleed) `per` is the share of the hit's physical damage dealt over `ms` (each hit its own bleed; `cap` is unused).
 * Every hit's `per` is multiplied by the weapon's on-hit power and the number of times its on-hit effects apply.
 */
export type OnHitStatus = Extract<StatusKind, "slowMove" | "slowAttack" | "antiHeal" | "dot">;

/**
 * What a `trigger` row does. Its `status` and `cleanse` verbs ARE Wishes' `AbilityEffect` members (abilities.ts, D28: one
 * shape and one implementation for a cast and a trigger). `heal`, `barrier` and `cooldown` stay trigger-only until R6
 * appends them to `AbilityEffect`; then this becomes `AbilityEffect` itself. Shares are of the fighter's max hp;
 * `to: "target"` is whoever set the trigger off (a hitTaken's attacker).
 */
export type TriggerAction =
  | Extract<AbilityEffect, { do: "status" | "cleanse" }>
  /** `ms` (roguelike R5, Second Wind): paid in round(ms / HEAL_OVER_TIME_STEP_MS) equal steps, the first at once, so it spans one step less than `ms` (rules.ts healOverTimeSpanMs). */
  | { do: "heal"; share: number; ignoreLockout?: boolean; ms?: number }
  | { do: "barrier"; share: number; ms: number }
  /** `hit`: its Wish's cooldown is `ms` shorter (Wishful Thinking), within WISHFUL_BUDGET_MS a WISHFUL_WINDOW_MS and never under WISHFUL_FLOOR_SHARE of itself. */
  | { do: "cooldown"; ms: number }
  /** `hitTaken`: attack speed and move speed x(1 + as) and x(1 + move) for `ms`, through the stat mirrors (Adrenaline). */
  | { do: "boost"; as: number; move: number; ms: number }
  /** `hitTaken`: a `share` of the damage the hit dealt goes back to the attacker as physical damage (Spiked Shell); `melee`: only a melee hit does. */
  | { do: "return"; share: number; melee?: true }
  /** `block`: 1 max health per 1 / `per` damage the block prevented, up to `cap` in all (Tank Engine). */
  | { do: "fortify"; per: number; cap: number }
  /** `kill`: the damage beyond the kill splashes onto the nearest enemy within `radius` (Overkill). */
  | { do: "splash"; radius: number };

/** What a `convert` row reads. `bonusAttackSpeed` and `bonusMoveSpeed` are fractions (0.1 = +10%), `ad` points, `maxHp` the max hp itself. */
export type ConvertFrom = "ad" | "maxHp" | "bonusAttackSpeed" | "bonusMoveSpeed";
export const CONVERT_FROMS: readonly ConvertFrom[] = ["ad", "maxHp", "bonusAttackSpeed", "bonusMoveSpeed"];
/** What a `convert` row feeds: any stat but max hp (which is synced from the plain fold first, so nothing converts into it). */
export type ConvertTo = Exclude<StatKey, "maxHp">;

/**
 * The multipliers a `mult` row names (the row's `v` IS the multiplier; rows of one key multiply):
 *   asPost        attack speed, AFTER the cap on the rows (Here Comes the Boom 0.5, Machine Gun 2); the product is held to AS_POST_MIN..AS_POST_MAX
 *   hit           a weapon hit's damage, AD and AP alike (Boom 2.5, Machine Gun 0.4)
 *   dot           every damage-over-time tick the fighter deals (Boom 1.25, Slow Burn 0.7)
 *   returned      every point of damage the fighter returns to an attacker (Fire's backlash; Boom 1.25)
 *   ap            ability power (Arcane Overload 1.5), after the conversions
 *   wishCooldown  the cooldown of the fighter's Wish (Arcane Overload 2); never below WISH_COOLDOWN_MULT_MIN
 *   hpRace        A Race to 0's ceiling: damage dealt and taken x 1 / hp fraction, at most this (HP_RACE_CAP)
 *   linger        how long a damage-over-time signature keeps burning after a fight breaks off (Slow Burn 2)
 */
export type MultKey = "asPost" | "hit" | "dot" | "returned" | "ap" | "wishCooldown" | "hpRace" | "linger";
export const MULT_KEYS: readonly MultKey[] = ["asPost", "hit", "dot", "returned", "ap", "wishCooldown", "hpRace", "linger"];

/**
 * The yes/no rules a `flag` row sets.
 *   lockSecondSlot, noCrit   the second weapon slot is locked (Committed); the fighter's hits never critically strike (Thick Skull)
 *   dotCrit        its damage over time can critically strike (Cruel Wounds; the chance is the fighter's `critChance`)
 *   gambler        each of its hits rolls double or half damage (Gambler)
 *   thirdCharm     every 3rd hit in a row on one target applies its on-hit effects once more (Third Time's the Charm)
 *   eyeForAnEye    the damage it returns to attackers applies its on-hit effects (Eye for an Eye)
 *   twiceUnarmed   its on-hit effects apply twice while its hand is empty (Fists of Fury)
 *   blockHits      its blocks count as hits (Best Offense)
 *   plantFeet      after standing still PLANT_FEET_MS its next attack has more range and damage (Plant Your Feet)
 *   festering      its magic damage over time keeps ticking after it ends (Festering Arcana)
 */
export type EffectFlag =
  | "lockSecondSlot" | "noCrit" | "dotCrit" | "gambler" | "thirdCharm" | "eyeForAnEye" | "twiceUnarmed" | "blockHits" | "plantFeet" | "festering";
export const EFFECT_FLAGS: readonly EffectFlag[] = [
  "lockSecondSlot", "noCrit", "dotCrit", "gambler", "thirdCharm", "eyeForAnEye", "twiceUnarmed", "blockHits", "plantFeet", "festering",
];

/** Fields every row may carry. */
interface EffectCommon {
  /** Synergy: the row is active only while the fighter owns every one of these ids (cards, relics...). */
  requires?: readonly string[];
  /**
   * "status": the row needs the status runtime (Wishes' sim/status.ts; roguelike R4b wires it). Until then it is catalog
   * data only: shown in the HUD and tooltips, never applied (sim/mods.ts skips it).
   */
  needs?: "status";
}

export type Effect =
  | (EffectCommon & { k: "stat"; stat: EffectStat; v: number })
  | (EffectCommon & { k: "flat"; stat: FlatStat; v: number })
  | (EffectCommon & { k: "vs"; test: VsTest; arg: number; v: number })
  /** `cap`: the most the row ever adds in all (Pack Leader's +24%); absent = unbounded. */
  | (EffectCommon & { k: "scale"; src: ScaleSource; per: number; step: number; cap?: number })
  | (EffectCommon & { k: "while"; cond: WhileCond; arg: number; stat: StatKey; v: number; ms?: number })
  | (EffectCommon & { k: "onHit"; status: OnHitStatus; per: number; cap: number; ms: number })
  /**
   * Adds `per` x (what `from` reads) to `to`, once, after the plain fold (Juggernaut: 0.25 armor per AD). `cap` is the most the
   * row itself adds. Units: `per` is `to`'s unit per unit of `from`'s (ad, hp: points; the bonuses: fractions, so +1 AP per 1% of
   * bonus attack speed is per 100). The conversions' AD and AP together are held to CONVERT_AD_AP_CAP each.
   */
  | (EffectCommon & { k: "convert"; from: ConvertFrom; to: ConvertTo; per: number; cap?: number })
  | (EffectCommon & { k: "mult"; key: MultKey; v: number })
  | (EffectCommon & { k: "flag"; flag: EffectFlag })
  /**
   * `once`: fires at most once per run. `rearm: "teleport"` (roguelike R5, Second Wind rank 2): a `once` row that may fire
   * again after each coliseum teleport (once before the first teleport, once after each).
   */
  | (EffectCommon & { k: "trigger"; on: TriggerOn; arg: number; once?: boolean; rearm?: "teleport"; do: TriggerAction });

export type EffectKind = Effect["k"];
/** The row of one kind, e.g. EffectOf<"stat">. */
export type EffectOf<K extends EffectKind> = Extract<Effect, { k: K }>;
/** A card's, relic's, curse's or boon's rows. */
export type EffectList = readonly Effect[];

/** Every kind once. Its type fails to compile if a kind is added to Effect and not here. */
export const EFFECT_KINDS = [
  "stat", "flat", "vs", "scale", "while", "onHit", "trigger", "convert", "mult", "flag",
] as const satisfies readonly EffectKind[];
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
    case "convert": return v.convert(e);
    case "mult": return v.mult(e);
    case "flag": return v.flag(e);
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
  return stat === "armor" || stat === "shield" || stat === "ad" || stat === "ap";
}

/**
 * A row's numbers times `k`: a stat, flat, vs or while row's `v`; a scale or onHit row's `per` (an onHit `cap` never moves); a
 * conversion's rate and its own cap; a multiplier's distance from 1; a trigger's amount. A flag is a rule, not a number.
 */
export function scaleEffect(e: Effect, k: number): Effect {
  return visitEffect<Effect>(e, {
    stat: (r) => ({ ...r, v: r.v * k }),
    flat: (r) => ({ ...r, v: r.v * k }),
    vs: (r) => ({ ...r, v: r.v * k }),
    while: (r) => ({ ...r, v: r.v * k }),
    scale: (r) => (r.cap === undefined ? { ...r, per: r.per * k } : { ...r, per: r.per * k, cap: r.cap * k }),
    onHit: (r) => ({ ...r, per: r.per * k }),
    convert: (r) => (r.cap === undefined ? { ...r, per: r.per * k } : { ...r, per: r.per * k, cap: r.cap * k }),
    mult: (r) => ({ ...r, v: 1 + (r.v - 1) * k }),
    flag: (r) => r,
    trigger: (r) => {
      const a = r.do;
      switch (a.do) {
        case "heal": return { ...r, do: { ...a, share: a.share * k } };
        case "barrier": return { ...r, do: { ...a, share: a.share * k } };
        case "status": return a.value === undefined ? r : { ...r, do: { ...a, value: a.value * k } };
        case "return": return { ...r, do: { ...a, share: a.share * k } };
        case "boost": return { ...r, do: { ...a, as: a.as * k, move: a.move * k } };
        case "cleanse":
        case "cooldown":
        case "fortify":
        case "splash":
          return r;
      }
    },
  });
}

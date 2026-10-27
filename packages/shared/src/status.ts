// Timed statuses on players and mobs: the kinds, their wire codes, and the one table that holds every cap and stacking rule
// (STATUS_RULES). The runtime that applies them is server/src/sim/status.ts; this file is data and bits, so the client can
// read `PlayerState.effects` and draw or predict from it.

/** Wire order (the `status` fx code): append only. */
export type StatusKind =
  | "stun" | "root" | "silence" | "slowMove" | "slowAttack" | "antiHeal" | "dot"
  | "invulnerable" | "untargetable" | "hidden" | "zoned" | "deathFloor" | "haste";

export const STATUS_KINDS: readonly StatusKind[] = [
  "stun", "root", "silence", "slowMove", "slowAttack", "antiHeal", "dot",
  "invulnerable", "untargetable", "hidden", "zoned", "deathFloor", "haste",
];

/** What cleanse() removes: "soft" (slows, anti-heal, dots), "hard" (crowd control too), never "never" (D21). */
export type CleanseClass = "soft" | "hard" | "never";

/** How several instances of one kind combine into one value: any is on/off, sum and max respect `cap`, product multiplies. */
export type StatusCombine = "any" | "sum" | "max" | "product";

export interface StatusRule {
  /** Cap on an instance's remaining time when applied or extended (ms). */
  maxMs: number;
  combine: StatusCombine;
  /** Cap on the combined value (sum, max); undefined = none. */
  cap?: number;
  cleanse: CleanseClass;
  /** EFFECT_* bit while active (0: none, e.g. invulnerable is PlayerState.immuneUntil). */
  bit: number;
  /** Refused on a mob (no runtime or field for it there). */
  playersOnly?: true;
}

/** `PlayerState.effects` / `MobState.effects` bits (uint16). 8192, 16384 and 32768 are spare (R6: barrier, ccImmune). */
export const EFFECT_STUNNED = 1;
export const EFFECT_ROOTED = 2;
export const EFFECT_SILENCED = 4;
export const EFFECT_SLOWED = 8;
export const EFFECT_ATTACK_SLOWED = 16;
export const EFFECT_ANTI_HEAL = 32;
export const EFFECT_DOT = 64;
export const EFFECT_UNTARGETABLE = 128;
export const EFFECT_HIDDEN = 256;
export const EFFECT_ZONED = 512;
export const EFFECT_LAST_STAND = 1024;
export const EFFECT_HASTE = 2048;
export const EFFECT_CASTING = 4096;

/**
 * Best guesses for the caps and `maxMs` values: the R8 report retunes them (contract R5). `slowMove`'s 0.6 cap is a cap on the
 * status alone: the product of ALL of a fighter's move modifiers (this slow, chill, buffs, bog) is floored at MOVE_MULT_FLOOR
 * (0.35, terrain.ts) in the sim's walk (step.ts) and the client's prediction, so a capped slow (x0.4) with Frost's chill (x0.7)
 * walks at 0.35, not 0.28. A stun, root or cast (0) stays 0.
 */
export const STATUS_RULES: Readonly<Record<StatusKind, StatusRule>> = {
  stun:         { maxMs: 3000,  combine: "any",     cleanse: "hard",  bit: EFFECT_STUNNED },
  root:         { maxMs: 3000,  combine: "any",     cleanse: "hard",  bit: EFFECT_ROOTED },
  silence:      { maxMs: 3000,  combine: "any",     cleanse: "hard",  bit: EFFECT_SILENCED },
  slowMove:     { maxMs: 5000,  combine: "sum", cap: 0.6, cleanse: "soft", bit: EFFECT_SLOWED },
  slowAttack:   { maxMs: 5000,  combine: "sum", cap: 0.5, cleanse: "soft", bit: EFFECT_ATTACK_SLOWED },
  antiHeal:     { maxMs: 6000,  combine: "sum", cap: 0.6, cleanse: "soft", bit: EFFECT_ANTI_HEAL },
  dot:          { maxMs: 10000, combine: "sum",     cleanse: "soft",  bit: EFFECT_DOT },
  invulnerable: { maxMs: 3000,  combine: "any",     cleanse: "never", bit: 0, playersOnly: true },
  untargetable: { maxMs: 10000, combine: "any",     cleanse: "never", bit: EFFECT_UNTARGETABLE },
  hidden:       { maxMs: 10000, combine: "any",     cleanse: "never", bit: EFFECT_HIDDEN, playersOnly: true },
  zoned:        { maxMs: 6000,  combine: "product", cleanse: "never", bit: EFFECT_ZONED },
  deathFloor:   { maxMs: 6000,  combine: "any",     cleanse: "never", bit: EFFECT_LAST_STAND, playersOnly: true },
  haste:        { maxMs: 8000,  combine: "max", cap: 0.5, cleanse: "never", bit: EFFECT_HASTE },
};

/** A hidden fighter's own attack or cast reveals it from its start until it lands plus this (ms). */
export const HIDDEN_REVEAL_MS = 500;

export function isStatusKind(v: unknown): v is StatusKind {
  return typeof v === "string" && (STATUS_KINDS as readonly string[]).includes(v);
}

// Stat mirrors (ROGUELIKE_PLAN 3.8): the stats a fighter's effects fold into that a client needs to see, synced on
// PlayerState as `asMult`, `windupMult`, `speedMult`, `armorBonus` and `shieldBonus`. The server's sim (sim/mods.ts)
// folds them, writes them in their wire form and then reads them back through the decoders here, never the unencoded
// double, so the local prediction and the fighter art decode exactly the value the server simulated with.
//
// Wire forms:
//   multipliers (asMult, windupMult, speedMult): float64, the double itself. Lossless on purpose: until R4a removes the
//     buff stacks, the sim's attack and move multipliers must stay exactly buffMultiplier(stacks) (the server suite
//     compares them with toBe), and a float64 field carries that double bit for bit. A field patches only when its value
//     changes (the schema setter skips an equal value), and a stack grant changes it anyway. To quantize later (0.001
//     steps, the plan's figure, for continuous effects), change encodeMult/decodeMult and the field type together:
//     callers that go through the decoders need nothing else.
//   flat bonuses (armorBonus, shieldBonus): int16 in tenths of a point (FLAT_WIRE_PER_POINT), -3276.8..3276.7.
// Defaults are the identity (1, 1, 1, 0, 0), so a fighter nothing ever buffs patches none of them.
import { requirementsMet, type Effect, type EffectOf, type StatKey } from "./effects";

/** The mirrors as the sim uses them (decoded). */
export interface StatMirrors {
  /** Attack speed: divides the attack interval (attackInterval's `asMult`). */
  asMult: number;
  /** Windup length multiplier (no source before R4a; nothing reads it yet). */
  windupMult: number;
  /** Walking speed multiplier, before the kill bursts and the chill (the other world.moveModifiers). */
  speedMult: number;
  /** Points added to the faction's armor (no source before R4a; nothing reads it yet). */
  armorBonus: number;
  /** Points added to the faction's shield, the magic resistance (no source before R4a; nothing reads it yet). */
  shieldBonus: number;
}

export type MirrorField = keyof StatMirrors;
export const MIRROR_FIELDS: readonly MirrorField[] = ["asMult", "windupMult", "speedMult", "armorBonus", "shieldBonus"];
export const IDENTITY_MIRRORS: Readonly<StatMirrors> = { asMult: 1, windupMult: 1, speedMult: 1, armorBonus: 0, shieldBonus: 0 };

/** A multiplier never goes below or above these, whatever its rows add up to (a -100% windup would be no windup at all). */
export const MOD_MULT_MIN = 0.05;
export const MOD_MULT_MAX = 20;
/** Wire units per point of a flat bonus: the wire carries tenths. */
export const FLAT_WIRE_PER_POINT = 10;
const INT16_MIN = -32768;
const INT16_MAX = 32767;

/** The wire value of a multiplier (what the sim stores on the state). Non-finite becomes 1; the range is clamped. */
export function encodeMult(x: number): number {
  if (!Number.isFinite(x)) return 1;
  return x < MOD_MULT_MIN ? MOD_MULT_MIN : x > MOD_MULT_MAX ? MOD_MULT_MAX : x;
}

/** The multiplier a wire value stands for. */
export function decodeMult(wire: number): number {
  // A server without the mirror field (an older build) leaves it undefined on the client: read that as no modifier.
  return Number.isFinite(wire) ? wire : 1;
}

/** The wire value of a flat bonus: whole tenths of a point, rounded half up, clamped to int16. Non-finite becomes 0. */
export function encodeFlat(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const n = Math.floor(x * FLAT_WIRE_PER_POINT + 0.5);
  return n < INT16_MIN ? INT16_MIN : n > INT16_MAX ? INT16_MAX : n;
}

/** The flat bonus a wire value stands for (a division, so 3 decodes to exactly 0.3, the double nearest it). */
export function decodeFlat(wire: number): number {
  return wire / FLAT_WIRE_PER_POINT;
}

/** The synced mirror fields of a player (wire form): a PlayerState or anything shaped like one. */
export type WireMirrors = Readonly<StatMirrors>;

/** Every mirror of a player, decoded: what the server simulated with. The client reads the mirrors through this. */
export function decodeMirrors(p: WireMirrors): StatMirrors {
  return {
    asMult: decodeMult(p.asMult),
    windupMult: decodeMult(p.windupMult),
    speedMult: decodeMult(p.speedMult),
    armorBonus: decodeFlat(p.armorBonus),
    shieldBonus: decodeFlat(p.shieldBonus),
  };
}

/** Each stat key's rows summed: a fraction for an EffectStat (0.1 = +10%), points for a FlatStat. */
export type StatSums = Record<StatKey, number>;

export function zeroSums(): StatSums {
  return {
    maxHp: 0, attackSpeed: 0, moveSpeed: 0, damage: 0, windup: 0, lifesteal: 0, markRate: 0, healTaken: 0, damageTaken: 0,
    cooldown: 0, armor: 0, shield: 0,
  };
}

export interface FoldContext {
  /** Ids the fighter owns, for rows with `requires` (none owned when omitted, so such rows are off). */
  owns?: (id: string) => boolean;
  /** Whether a `while` row's condition holds now (none does when omitted). */
  holds?: (e: EffectOf<"while">) => boolean;
}

/**
 * Folds the rows that act on stats into one sum per key: `stat` and `flat` rows, and `while` rows whose condition holds.
 * Within a key the rows add (two +10% attack speed rows are +20%, not +21%); a multiplier key is then used as 1 + its sum,
 * and keys multiply each other where the sim combines them (attack speed and damage in a hit, speedMult and a burst and the
 * chill in a walk), so one key's bonus is never added to another's. Flat keys add points. `vs`, `scale`, `onHit` and
 * `trigger` rows act per hit or on an event, not on the stat sheet, and are skipped. Rows whose `requires` are not all
 * owned are skipped.
 */
export function foldStatRows(effects: readonly Effect[], ctx: FoldContext = {}): StatSums {
  const sums = zeroSums();
  for (const e of effects) {
    if (e.k !== "stat" && e.k !== "flat" && e.k !== "while") continue;
    if (!requirementsMet(e, ctx.owns)) continue;
    if (e.k === "while" && !(ctx.holds?.(e) ?? false)) continue;
    sums[e.stat] += e.v;
  }
  return sums;
}

/** The mirrors a fold's sums give, unencoded: 1 + the sum for a multiplier, the sum for a flat bonus. */
export function mirrorsFromSums(s: StatSums): StatMirrors {
  return {
    asMult: 1 + s.attackSpeed,
    windupMult: 1 + s.windup,
    speedMult: 1 + s.moveSpeed,
    armorBonus: s.armor,
    shieldBonus: s.shield,
  };
}

/** The wire form of every mirror, ready to store on the state. */
export function encodeMirrors(m: StatMirrors): StatMirrors {
  return {
    asMult: encodeMult(m.asMult),
    windupMult: encodeMult(m.windupMult),
    speedMult: encodeMult(m.speedMult),
    armorBonus: encodeFlat(m.armorBonus),
    shieldBonus: encodeFlat(m.shieldBonus),
  };
}

// The ability framework and the Wish catalog. An ability is a definition (`AbilityDef`) with per-rank numbers; the server's
// cast pipeline (sim/abilities.ts) reads it, the client draws and predicts from it. ONE id space covers Wishes and the Q/E
// skills a later phase adds. A Wish is the faction's once-a-run ability (key D); its numbers are free to change, the
// framework's names, signatures and wire layouts are the stable API (append only).
import { TARGET_SNAP_RADIUS, TRAINING_WISH_COOLDOWN_SECONDS, WISH_COOLDOWN_SECONDS } from "./constants";
import { isFactionId, type FactionId } from "./factions";
import type { CleanseClass, StatusKind } from "./status";

/** ONE id space for Wishes and Q/E skills. Wire order (fx, FieldState.ability): append only. */
export type AbilityId = "freeze" | "swarm" | "trial" | "blaze" | "lastStand";
export const ABILITY_IDS: readonly AbilityId[] = ["freeze", "swarm", "trial", "blaze", "lastStand"];

export type AbilityKind = "wish" | "skill";
export type AbilitySlot = "wish" | "q" | "e";
export const ABILITY_SLOTS: readonly AbilitySlot[] = ["wish", "q", "e"];

/** What a bot or a mob's AI uses an ability for: policies pick and aim a cast by intent, never by id. */
export type AiIntent = "escape" | "engage" | "peel" | "control" | "sustain" | "burst" | "zone" | "buff";

/** What interrupts a pending cast (a def lists its own; Wishes only `stun` and `silence`). */
export type CastCancel = "stun" | "silence" | "root" | "stagger" | "displace";

export type TargetRule =
  | { kind: "self" }
  /** The cursor's direction; the shape says how far. */
  | { kind: "dir" }
  /** The cursor point, along the ray, clamped to `range` (and at least `minRange`). */
  | { kind: "point"; range: number; minRange: number }
  | { kind: "unit"; range: number; los: boolean; snapRadius: number; who: "enemy" };

export type AbilityShape =
  | { kind: "none" } | { kind: "circle"; radius: number }
  | { kind: "line"; length: number; width: number } | { kind: "cone"; radius: number; halfAngle: number };

/**
 * What a cast does, as `do:` verbs. Closed, with an exhaustive switch in sim/abilities.ts: a later phase appends `damage`,
 * `heal`, `barrier`, `displace`, `projectile`, `area` and `cooldown`. It is not the roguelike's `Effect` (`k:` passive modifiers).
 */
export type AbilityEffect =
  | { do: "status"; to: "self" | "target"; status: StatusKind; ms: number; value?: number }
  | { do: "cleanse"; to: "self" | "target"; classes: readonly CleanseClass[] }
  /** Self: the hp floor holds for `ms`; `healBack` of the hp loss it held up is paid back at the end. */
  | { do: "deathFloor"; ms: number; floorHp: number; healBack: number }
  /** Target: an area around the target; it deals `dealtMult` and takes `takenFromCasterMult` from the caster; leaving it stuns. */
  | { do: "zone"; ms: number; radius: number; dealtMult: number; takenFromCasterMult: number; exitStunMs: number }
  /** Self: an area that follows the caster. */
  | { do: "cloud"; ms: number; radius: number }
  /** Self: a jump toward the cursor, through walls (blink.ts). */
  | { do: "blink"; maxDist: number; minDist: number }
  /** Self, after a blink: a burning band between the two ends. */
  | { do: "trail"; ms: number; halfWidth: number; dps: number; dotMs: number };

/** Which pass of the cast's landing applies an effect (all casts due in a tick land together, self effects first). */
export function effectSide(e: AbilityEffect): "self" | "target" {
  switch (e.do) {
    case "status":
    case "cleanse":
      return e.to;
    case "zone":
      return "target";
    case "deathFloor":
    case "cloud":
    case "blink":
    case "trail":
      return "self";
    default: {
      const unknown: never = e;
      void unknown;
      return "self";
    }
  }
}

export interface AbilityRank {
  cooldownMs: number;
  /** Telegraph and root (ms); 0 = it lands in the tick it is cast. */
  castMs: number;
  targeting: TargetRule;
  shape: AbilityShape;
  effects: readonly AbilityEffect[];
}

export type AbilityIcon = "snowflake" | "swarm" | "scales" | "flame" | "cross";
export type TelegraphArt = "none" | "beam" | "ring" | "swirl" | "flare" | "aura";

export interface AbilityDef {
  id: AbilityId;
  name: string;
  blurb: string;
  kind: AbilityKind;
  /** A Wish's faction; a skill's pool (null: neutral). */
  faction: FactionId | null;
  /** Flat: buffs, relics and cooldown reduction never change it (abilityCooldownMs). */
  flat: boolean;
  /** Per-rank numbers; Wishes have one. */
  ranks: readonly AbilityRank[];
  /** An own order like `move`: at the cast it cancels the own windup and drops the own lock and path. */
  ownOrder: boolean;
  /**
   * At the cast it ends the caster's own target lock and nothing else of its walk (an own order does that too, and the path): the
   * Wish that hides its caster, whose locked auto-attack would reveal it at once, and which must not stop a fleeing walk.
   */
  dropsLock: boolean;
  /** What interrupts its pending cast. */
  cancelledBy: readonly CastCancel[];
  /** What refuses it at validation. */
  blockedBy: readonly ("stun" | "silence" | "root")[];
  ai: readonly AiIntent[];
  /** Its damage is over time: chunked hit fx, no damage flash. */
  dot?: boolean;
  telegraph: TelegraphArt;
  icon: AbilityIcon;
  color: number;
}

/** The rank's numbers; a rank past either end is clamped to 1..ranks.length. */
export function rankOf(def: AbilityDef, rank: number): AbilityRank {
  const i = Math.min(Math.max(Math.floor(Number.isFinite(rank) ? rank : 1), 1), def.ranks.length);
  return def.ranks[i - 1];
}

export function isAbilitySlot(v: unknown): v is AbilitySlot {
  return typeof v === "string" && (ABILITY_SLOTS as readonly string[]).includes(v);
}

export function isAbilityId(v: unknown): v is AbilityId {
  return typeof v === "string" && (ABILITY_IDS as readonly string[]).includes(v);
}

// Wish numbers (ms, world units). Best guesses: the R8 report retunes them.
export const FREEZE_RANGE = 450;
export const FREEZE_STUN_MS = 1250;
export const FREEZE_CAST_MS = 250;
export const SWARM_MS = 8000;
export const SWARM_CAST_MS = 250;
export const SWARM_CLOUD_RADIUS = 72;
export const TRIAL_RANGE = 400;
export const TRIAL_RADIUS = 300;
export const TRIAL_MS = 5000;
export const TRIAL_DEALT_MULT = 0.8;
export const TRIAL_TAKEN_MULT = 1.2;
export const TRIAL_EXIT_STUN_MS = 1000;
export const TRIAL_CAST_MS = 350;
export const BLAZE_RANGE = 300;
export const BLAZE_MIN_DIST = 64;
/** The blink's landing search steps this far along the ray (blink.ts). */
export const BLINK_STEP = 4;
export const BLAZE_TRAIL_MS = 2500;
export const BLAZE_TRAIL_HALF_WIDTH = 20;
export const BLAZE_BURN_DPS = 30;
export const BLAZE_BURN_MS = 2000;
export const LAST_STAND_MS = 5000;
export const LAST_STAND_FLOOR_HP = 1;
export const LAST_STAND_SPEED_BONUS = 0.3;
export const LAST_STAND_HEAL_SHARE = 0.3;

const WISH_COOLDOWN_MS = WISH_COOLDOWN_SECONDS * 1000;
const WISH_BLOCKED_BY = ["stun", "silence"] as const;
const WISH_CANCELLED_BY = ["stun", "silence"] as const;
const unitTarget = (range: number): TargetRule => ({ kind: "unit", range, los: true, snapRadius: TARGET_SNAP_RADIUS, who: "enemy" });

export const ABILITIES: Readonly<Record<AbilityId, AbilityDef>> = {
  freeze: {
    id: "freeze", name: "Freeze", blurb: "Freeze the enemy nearest your cursor in place for a moment.",
    kind: "wish", faction: "frost", flat: true, ownOrder: false, dropsLock: false,
    cancelledBy: WISH_CANCELLED_BY, blockedBy: WISH_BLOCKED_BY, ai: ["control", "peel", "engage"],
    telegraph: "beam", icon: "snowflake", color: 0x81d4fa,
    ranks: [{
      cooldownMs: WISH_COOLDOWN_MS, castMs: FREEZE_CAST_MS, targeting: unitTarget(FREEZE_RANGE), shape: { kind: "none" },
      effects: [{ do: "status", to: "target", status: "stun", ms: FREEZE_STUN_MS }],
    }],
  },
  swarm: {
    id: "swarm", name: "Swarm", blurb: "Dissolve into a swarm: enemies lose sight of you and cannot target you.",
    // Drops the caster's own lock (a best guess), or its locked auto-attack would reveal it at once; its walk in hand goes on.
    kind: "wish", faction: "plague", flat: true, ownOrder: false, dropsLock: true,
    cancelledBy: WISH_CANCELLED_BY, blockedBy: WISH_BLOCKED_BY, ai: ["escape"],
    telegraph: "swirl", icon: "swarm", color: 0x9ccc65,
    ranks: [{
      cooldownMs: WISH_COOLDOWN_MS, castMs: SWARM_CAST_MS, targeting: { kind: "self" }, shape: { kind: "circle", radius: SWARM_CLOUD_RADIUS },
      effects: [
        { do: "status", to: "self", status: "hidden", ms: SWARM_MS },
        { do: "cloud", ms: SWARM_MS, radius: SWARM_CLOUD_RADIUS },
      ],
    }],
  },
  trial: {
    id: "trial", name: "Trial", blurb: "Judge an enemy: inside the ring it deals less and takes more from you, and leaving it stuns.",
    kind: "wish", faction: "sentenced", flat: true, ownOrder: false, dropsLock: false,
    cancelledBy: WISH_CANCELLED_BY, blockedBy: WISH_BLOCKED_BY, ai: ["engage", "control"],
    telegraph: "ring", icon: "scales", color: 0xb39ddb,
    ranks: [{
      cooldownMs: WISH_COOLDOWN_MS, castMs: TRIAL_CAST_MS, targeting: unitTarget(TRIAL_RANGE), shape: { kind: "circle", radius: TRIAL_RADIUS },
      effects: [{
        do: "zone", ms: TRIAL_MS, radius: TRIAL_RADIUS, dealtMult: TRIAL_DEALT_MULT, takenFromCasterMult: TRIAL_TAKEN_MULT,
        exitStunMs: TRIAL_EXIT_STUN_MS,
      }],
    }],
  },
  blaze: {
    id: "blaze", name: "Blaze Step", blurb: "Blink toward your cursor, through walls, leaving a burning trail.",
    kind: "wish", faction: "fire", flat: true, ownOrder: true, dropsLock: false,
    cancelledBy: WISH_CANCELLED_BY, blockedBy: WISH_BLOCKED_BY, ai: ["escape", "engage"], dot: true,
    telegraph: "flare", icon: "flame", color: 0xff7043,
    ranks: [{
      cooldownMs: WISH_COOLDOWN_MS, castMs: 0, targeting: { kind: "point", range: BLAZE_RANGE, minRange: BLAZE_MIN_DIST },
      shape: { kind: "line", length: BLAZE_RANGE, width: BLAZE_TRAIL_HALF_WIDTH * 2 },
      effects: [
        { do: "blink", maxDist: BLAZE_RANGE, minDist: BLAZE_MIN_DIST },
        { do: "trail", ms: BLAZE_TRAIL_MS, halfWidth: BLAZE_TRAIL_HALF_WIDTH, dps: BLAZE_BURN_DPS, dotMs: BLAZE_BURN_MS },
      ],
    }],
  },
  lastStand: {
    id: "lastStand", name: "Last Stand", blurb: "For a few seconds you cannot fall below 1 hp and you run faster; a share of what you survived heals back.",
    kind: "wish", faction: "holy", flat: true, ownOrder: false, dropsLock: false,
    cancelledBy: WISH_CANCELLED_BY, blockedBy: WISH_BLOCKED_BY, ai: ["sustain", "escape"],
    telegraph: "aura", icon: "cross", color: 0xffd54f,
    ranks: [{
      cooldownMs: WISH_COOLDOWN_MS, castMs: 0, targeting: { kind: "self" }, shape: { kind: "none" },
      effects: [
        { do: "deathFloor", ms: LAST_STAND_MS, floorHp: LAST_STAND_FLOOR_HP, healBack: LAST_STAND_HEAL_SHARE },
        { do: "status", to: "self", status: "haste", ms: LAST_STAND_MS, value: LAST_STAND_SPEED_BONUS },
      ],
    }],
  },
};

export const WISHES: Readonly<Record<FactionId, AbilityId>> = {
  frost: "freeze", plague: "swarm", sentenced: "trial", fire: "blaze", holy: "lastStand",
};

/** A faction's Wish, or null for an unknown faction (a training dummy has none). */
export function wishOf(faction: string): AbilityDef | null {
  return isFactionId(faction) ? ABILITIES[WISHES[faction]] : null;
}

/** The ability and rank in a slot: "wish" is the faction's Wish at rank 1; "q" and "e" are null until a later phase reads the skill slots. */
export function abilityInSlot(p: { faction: string }, slot: AbilitySlot): { def: AbilityDef; rank: number } | null {
  if (slot !== "wish") return null;
  const def = wishOf(p.faction);
  return def ? { def, rank: 1 } : null;
}

type SlotTimes = { wishReadyAt: number; qReadyAt: number; eReadyAt: number };

/** The synced ready time of a slot (server ms; 0 = ready). The only reader of wishReadyAt / qReadyAt / eReadyAt. */
export function slotReadyAt(p: SlotTimes, slot: AbilitySlot): number {
  return slot === "wish" ? p.wishReadyAt : slot === "q" ? p.qReadyAt : p.eReadyAt;
}

export function setSlotReadyAt(p: SlotTimes, slot: AbilitySlot, at: number): void {
  if (slot === "wish") p.wishReadyAt = at;
  else if (slot === "q") p.qReadyAt = at;
  else p.eReadyAt = at;
}

/**
 * The ONE cooldown funnel. Training: a Wish takes TRAINING_WISH_COOLDOWN_SECONDS. A flat def ignores `reduction` (a def that
 * is not flat takes it, clamped to 0..0.5).
 */
export function abilityCooldownMs(def: AbilityDef, rank: number, ctx: { training?: boolean; reduction?: number }): number {
  if (ctx.training && def.kind === "wish") return TRAINING_WISH_COOLDOWN_SECONDS * 1000;
  const base = rankOf(def, rank).cooldownMs;
  if (def.flat) return base;
  const reduction = Math.min(Math.max(ctx.reduction ?? 0, 0), 0.5);
  return Math.round(base * (1 - reduction));
}

/** 1 + bonus / max(baseMult, 0.05): adds `bonus` x the base speed on top of whatever `baseMult` already scales it by. */
export function hasteMultiplier(baseMult: number, bonus: number): number {
  return 1 + bonus / Math.max(baseMult, 0.05);
}

/** True for an ability whose damage is over time: its `hit` fx come in chunks and cause no damage flash. */
export function isAbilityDot(ability: AbilityId | undefined): boolean {
  return ability !== undefined && ABILITIES[ability]?.dot === true;
}

/** Why a begun cast ended without landing: fizzled at its landing, interrupted by a cancelling status, or cancelled by the arena. */
export type CastEndReason = "fizzle" | "interrupted" | "cancelled";

/** FieldState.kind codes: append only. */
export type FieldKind = "zone" | "cloud" | "trail";
export const FIELD_KINDS: readonly FieldKind[] = ["zone", "cloud", "trail"];

export function fieldKindOf(code: number): FieldKind | undefined {
  return FIELD_KINDS[code];
}

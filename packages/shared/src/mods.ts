// Stat mirrors (ROGUELIKE_PLAN 3.8): the stats a fighter's effects fold into that a client needs to see, synced on
// PlayerState as `asMult`, `windupMult`, `speedMult`, `armorBonus`, `shieldBonus` and (the balance pass) `adBonus` and
// `apBonus`. The server's sim (sim/mods.ts)
// folds them, writes them in their wire form and then reads them back through the decoders here, never the unencoded
// double, so the local prediction and the fighter art decode exactly the value the server simulated with.
//
// Wire forms (D22: the quantized value is authoritative; the sim simulates with exactly what a client decodes):
//   multipliers (asMult, windupMult, speedMult): uint16 thousandths (MULT_WIRE_PER_UNIT), rounded half up to the 0.001
//     step and clamped to MOD_MULT_MIN..MOD_MULT_MAX (50..20000 on the wire). decodeMult is exactly wire / 1000.
//   flat bonuses (armorBonus, shieldBonus, adBonus, apBonus): int16 in tenths of a point (FLAT_WIRE_PER_POINT), -3276.8..3276.7.
// asMult: the rows (and the sources, slows included) are capped at AS_MULT_CAP (capAsMult) and the `asPost` mults (Boom,
// Machine Gun) multiply AFTER the cap: the server folds, caps, multiplies, then encodes, so that is the value on the wire.
//
// The fold itself (BALANCE_CONTRACT 4.6) is foldRows below, one pure function the sim calls and the tests pin:
//   1. the plain fold: `stat`, `flat` and held `while` rows add within a key (a PRODUCT_STATS key multiplies);
//   2. max hp from the plain sums (G8: never under half the faction's), because a conversion reads it;
//   3. the conversions, ONE pass from the plain sums (a conversion never feeds another; AD and AP from conversions are held
//      to CONVERT_AD_AP_CAP each, G11);
//   4. the caps of the sheet stats (bonus armor and magic resist G7, move speed G10), then AP times its `ap` mult;
//   5. the `mult` rows, one product per key, clamped to their guards (G1, G9, G13).
// A field patches only when its wire value changes (the server compares before writing, and the schema setter skips an
// equal value), so a continuous effect that moves by less than a step patches nothing. Defaults are the identity (1000,
// 1000, 1000, 0, 0), so a fighter nothing ever buffs patches none of them.
import {
  AS_MULT_CAP, AS_POST_MAX, AS_POST_MIN, BARRIER_DECAY_SHARE_PER_SECOND, BARRIER_MAX_SHARE, BONUS_DEFENSE_CAP, CONVERT_AD_AP_CAP,
  CRIT_CHANCE_MAX, HP_RACE_CAP, LIFESTEAL_MAX, LS_CAP, MAX_HP_FLOOR_SHARE, MOVE_BONUS_CAP, OUTGOING_ROW_CAP, WISH_COOLDOWN_MULT_MIN,
} from "./constants";
import {
  isProductStat, MULT_KEYS, requirementsMet, type ConvertFrom, type Effect, type EffectFlag, type EffectOf, type MultKey, type StatKey,
} from "./effects";
import type { FactionSpec } from "./factions";
import { attackInterval, weaponTimings, type WeaponId, type WeaponTimings } from "./weapons";

/** The mirrors as the sim uses them (decoded). */
export interface StatMirrors {
  /** Attack speed: divides the attack interval (attackInterval's `asMult`). */
  asMult: number;
  /** Windup length multiplier (scaleWindup): every attack's windup, and the axe's root with it. */
  windupMult: number;
  /** Walking speed multiplier, before the chill (the other world.moveModifiers). */
  speedMult: number;
  /** Points added to the faction's armor (the damage law's defender armor). */
  armorBonus: number;
  /** Points added to the faction's shield, the magic resistance (D7; not the kill barrier). */
  shieldBonus: number;
  /** Attack damage (AD): points a weapon hit scales with (WEAPONS[w].scaling), written only by recomputeMods. */
  adBonus: number;
  /** Ability power (AP), after the `ap` mult: points a weapon hit and every running damage over time scales with. */
  apBonus: number;
}

export type MirrorField = keyof StatMirrors;
export const MIRROR_FIELDS: readonly MirrorField[] = ["asMult", "windupMult", "speedMult", "armorBonus", "shieldBonus", "adBonus", "apBonus"];
export const IDENTITY_MIRRORS: Readonly<StatMirrors> = {
  asMult: 1, windupMult: 1, speedMult: 1, armorBonus: 0, shieldBonus: 0, adBonus: 0, apBonus: 0,
};

/** A multiplier never goes below or above these, whatever its rows add up to (a -100% windup would be no windup at all). */
export const MOD_MULT_MIN = 0.05;
export const MOD_MULT_MAX = 20;
/** The attack-speed multiplier from every source together, capped (AS_MULT_CAP); a slow below the cap is untouched. */
export function capAsMult(x: number): number {
  return x > AS_MULT_CAP ? AS_MULT_CAP : x;
}
/** Wire units per unit of a multiplier: the wire carries thousandths (uint16). */
export const MULT_WIRE_PER_UNIT = 1000;
/** Wire units per point of a flat bonus: the wire carries tenths. */
export const FLAT_WIRE_PER_POINT = 10;
const INT16_MIN = -32768;
const INT16_MAX = 32767;
const MULT_WIRE_MIN = Math.round(MOD_MULT_MIN * MULT_WIRE_PER_UNIT);
const MULT_WIRE_MAX = Math.round(MOD_MULT_MAX * MULT_WIRE_PER_UNIT);

/**
 * The wire value of a multiplier (what the sim stores on the state): whole thousandths, rounded half up, clamped to
 * MOD_MULT_MIN..MOD_MULT_MAX. Non-finite becomes the identity (1000).
 */
export function encodeMult(x: number): number {
  if (!Number.isFinite(x)) return MULT_WIRE_PER_UNIT;
  const n = Math.floor(x * MULT_WIRE_PER_UNIT + 0.5);
  return n < MULT_WIRE_MIN ? MULT_WIRE_MIN : n > MULT_WIRE_MAX ? MULT_WIRE_MAX : n;
}

/** The multiplier a wire value stands for: exactly wire / 1000 (the double nearest it), on the server and every client. */
export function decodeMult(wire: number): number {
  // A server without the mirror field (an older build) leaves it undefined on the client: read that as no modifier.
  return Number.isFinite(wire) ? wire / MULT_WIRE_PER_UNIT : 1;
}

/**
 * A weapon's timings with the windup scaled by `windupMult` (the decoded mirror), never past the interval. Any optional extra
 * root still scales with its windup. A mult below 1 shortens
 * MELEE windups only (the sword's, the bash's, the axe's): the ranged windups are the anti-kiting lever and nothing shortens
 * them (owner ruling "Melee windups only", testing/TUNING_ROGUE.md section 7), so a ranged attack's timings come back as they
 * were (the same object). A mult of 1 or more lengthens every weapon. The server's timingsOf and a client's draw and root
 * read the same function. (No source lengthens windups today. If one does, the mirror is one product: a Quickdraw rank
 * under a slow would still lengthen the ranged windup by the slow times Quickdraw's share, so a ranged slow wants its own mirror.)
 * A ranged windup is never cut by this function, whatever the mult (NPC mirrorTimings restores its legacy base-speed floor first).
 */
export function scaleWindup(t: WeaponTimings, windupMult: number): WeaponTimings {
  if (windupMult === 1 || !Number.isFinite(windupMult)) return t;
  if (t.ranged && windupMult < 1) return t;
  const windup = t.ranged ? Math.max(t.windup, Math.min(t.interval, t.windup * windupMult)) : Math.min(t.interval, t.windup * windupMult);
  const root = t.root > 0 ? Math.max(windup, Math.min(t.interval, t.root * windupMult)) : 0;
  return { ...t, windup, root };
}

/**
 * The timings of one attack by a fighter whose mirrors are `asMult` and `windupMult` (the server's timingsOf; a client's draw of a
 * bow's pull reads the same). Player attack speed shortens the interval and share-based windups together; NPC ranged windups retain
 * their legacy base-speed floor. A slower fighter's windup grows with its interval up to the cap.
 */
export function mirrorTimings(
  f: Pick<FactionSpec, "rate">, w: WeaponId, asMult: number, windupMult: number, profile: "player" | "npc" = "player",
): WeaponTimings {
  const t = weaponTimings(w, attackInterval(f, w, asMult), profile);
  if (profile === "npc" && t.ranged && asMult > 1) {
    const base = weaponTimings(w, attackInterval(f, w, 1), profile).windup;
    if (t.windup < base) t.windup = base;
  }
  return scaleWindup(t, windupMult);
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

/** The identity mirrors in wire form: what a new PlayerState holds (1000, 1000, 1000, 0, 0, 0, 0). */
export const WIRE_IDENTITY_MIRRORS: Readonly<StatMirrors> = encodeMirrors(IDENTITY_MIRRORS);

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
    adBonus: decodeFlat(p.adBonus),
    apBonus: decodeFlat(p.apBonus),
  };
}

/**
 * Each stat key's rows summed: a fraction for an EffectStat (0.1 = +10%), points for a FlatStat. A PRODUCT_STATS key
 * (`lifestealMult`) is the product of (1 + v) over its rows instead, so its identity is 1.
 */
export type StatSums = Record<StatKey, number>;

export function zeroSums(): StatSums {
  return {
    maxHp: 0, attackSpeed: 0, moveSpeed: 0, damage: 0, windup: 0, lifesteal: 0, markRate: 0, healTaken: 0, damageTaken: 0,
    cooldown: 0, executeBand: 0, slowResist: 0, lifestealMult: 1, lifestealDot: 0, critChance: 0, healBarrier: 0, armor: 0, shield: 0, ad: 0, ap: 0,
  };
}

/** Adds one row's `v` to its key: summed, or multiplied in as 1 + v for a PRODUCT_STATS key. */
export function addToSums(sums: StatSums, stat: StatKey, v: number): void {
  if (isProductStat(stat)) sums[stat] *= 1 + v;
  else sums[stat] += v;
}

export interface FoldContext {
  /** Ids the fighter owns, for rows with `requires` (none owned when omitted, so such rows are off). */
  owns?: (id: string) => boolean;
  /** Whether a `while` row's condition holds now (none does when omitted). */
  holds?: (e: EffectOf<"while">) => boolean;
  /** The faction's hp, the base the max hp rows scale (a `convert` from maxHp reads the folded max hp; omitted = 0). */
  baseMaxHp?: number;
}

/**
 * Folds the rows that act on stats into one sum per key: `stat` and `flat` rows, and `while` rows whose condition holds.
 * Within a key the rows add (two +10% attack speed rows are +20%, not +21%); a multiplier key is then used as 1 + its sum,
 * and keys multiply each other where the sim combines them (attack speed and damage in a hit, speedMult and a burst and the
 * chill in a walk), so one key's bonus is never added to another's. Flat keys add points. `vs`, `scale`, `onHit` and
 * `trigger` rows act per hit or on an event, not on the stat sheet, and are skipped, as are `convert`, `mult` and `flag` rows
 * (foldRows reads those). Rows whose `requires` are not all owned are skipped. This is the plain fold, before any conversion.
 */
export function foldStatRows(effects: readonly Effect[], ctx: FoldContext = {}): StatSums {
  const sums = zeroSums();
  for (const e of effects) {
    if (e.k !== "stat" && e.k !== "flat" && e.k !== "while") continue;
    if (!requirementsMet(e, ctx.owns)) continue;
    if (e.k === "while" && !(ctx.holds?.(e) ?? false)) continue;
    addToSums(sums, e.stat, e.v);
  }
  return sums;
}

/** One product per `mult` key (1 = none), after the guards' clamps. */
export type MultSums = Record<MultKey, number>;

export function identityMults(): MultSums {
  return { asPost: 1, hit: 1, dot: 1, returned: 1, ap: 1, wishCooldown: 1, hpRace: 1, linger: 1 };
}

/** What a fighter's rows fold to (foldRows). */
export interface Folded {
  /** The stat rows summed before any conversion: the plain fold. */
  plain: StatSums;
  /**
   * What the sim and the mirrors read: the plain sums plus the conversions, with the sheet stats capped (bonus armor and magic
   * resist G7, move speed G10, a conversion's AD and AP G11) and `ap` already multiplied by its `ap` mult.
   */
  sums: StatSums;
  /** The `mult` rows' products, clamped (hit to OUTGOING_ROW_CAP, asPost to AS_POST_MIN..AS_POST_MAX, wishCooldown above WISH_COOLDOWN_MULT_MIN, hpRace to HP_RACE_CAP). */
  mults: MultSums;
  /** The `flag` rows that are on. */
  flags: ReadonlySet<EffectFlag>;
  /** baseMaxHp x max(MAX_HP_FLOOR_SHARE, 1 + the maxHp sum), G8; 0 when no baseMaxHp was given. */
  maxHp: number;
}

/** The max hp a faction base and a maxHp sum make: never under MAX_HP_FLOOR_SHARE of the base (G8). */
export function foldedMaxHp(baseMaxHp: number, maxHpSum: number): number {
  return baseMaxHp > 0 ? baseMaxHp * Math.max(MAX_HP_FLOOR_SHARE, 1 + maxHpSum) : 0;
}

/** The input of a `convert` row from the plain sums (bonuses are fractions, never negative, and already inside their caps). */
function convertInput(from: ConvertFrom, plain: Readonly<StatSums>, maxHp: number): number {
  switch (from) {
    case "ad": return plain.ad;
    case "maxHp": return maxHp;
    case "bonusAttackSpeed": return Math.max(0, Math.min(plain.attackSpeed, AS_MULT_CAP - 1));
    case "bonusMoveSpeed": return Math.max(0, Math.min(plain.moveSpeed, MOVE_BONUS_CAP));
  }
}

/**
 * The whole fold (BALANCE_CONTRACT 4.6): the plain sums, the conversions from them in ONE pass (so no conversion feeds
 * another), the caps, and the `mult` and `flag` rows. Pure; the sim (sim/mods.ts) calls it with the rows of one fighter.
 * `ctx.holds` says which `while` rows hold now and `ctx.owns` which ids are owned (for `requires`).
 */
export function foldRows(effects: readonly Effect[], ctx: FoldContext = {}): Folded {
  const plain = foldStatRows(effects, ctx);
  const maxHp = foldedMaxHp(ctx.baseMaxHp ?? 0, plain.maxHp);
  const mults = identityMults();
  const flags = new Set<EffectFlag>();
  const conv = zeroSums();
  for (const e of effects) {
    if (e.k !== "convert" && e.k !== "mult" && e.k !== "flag") continue;
    if (!requirementsMet(e, ctx.owns)) continue;
    if (e.k === "mult") {
      mults[e.key] *= e.v;
    } else if (e.k === "flag") {
      flags.add(e.flag);
    } else if (!isProductStat(e.to) && (e.to as StatKey) !== "maxHp") {
      let out = e.per * convertInput(e.from, plain, maxHp);
      if (e.cap !== undefined && out > e.cap) out = e.cap;
      conv[e.to] += out;
    }
  }
  // G11: the AD and AP that conversions give are each held to CONVERT_AD_AP_CAP (a conversion never feeds another, so this is the sum of its own rows).
  if (conv.ad > CONVERT_AD_AP_CAP) conv.ad = CONVERT_AD_AP_CAP;
  if (conv.ap > CONVERT_AD_AP_CAP) conv.ap = CONVERT_AD_AP_CAP;
  const sums = zeroSums();
  for (const key of Object.keys(plain) as StatKey[]) sums[key] = isProductStat(key) ? plain[key] : plain[key] + conv[key];
  // G7 and G10: the sheet stats the rows build stop at their caps (a slow from a source, applied later, is not capped).
  if (sums.armor > BONUS_DEFENSE_CAP) sums.armor = BONUS_DEFENSE_CAP;
  if (sums.shield > BONUS_DEFENSE_CAP) sums.shield = BONUS_DEFENSE_CAP;
  if (sums.moveSpeed > MOVE_BONUS_CAP) sums.moveSpeed = MOVE_BONUS_CAP;
  // The mults' guards. Absent rows leave every product at exactly 1.
  if (mults.hit > OUTGOING_ROW_CAP) mults.hit = OUTGOING_ROW_CAP; // G1
  if (mults.asPost < AS_POST_MIN) mults.asPost = AS_POST_MIN; // G9
  else if (mults.asPost > AS_POST_MAX) mults.asPost = AS_POST_MAX;
  if (mults.wishCooldown < WISH_COOLDOWN_MULT_MIN) mults.wishCooldown = WISH_COOLDOWN_MULT_MIN; // G13
  if (mults.hpRace > HP_RACE_CAP) mults.hpRace = HP_RACE_CAP; // G4
  for (const k of MULT_KEYS) if (!(mults[k] >= 0)) mults[k] = 0;
  sums.ap *= mults.ap; // Arcane Overload: after the conversions and their cap
  return { plain, sums, mults, flags, maxHp };
}

/** What the registered mod sources (world.modSources) add on top of the rows: multipliers multiply, flat bonuses add. */
export interface SourceMods {
  asMult: number;
  speedMult: number;
  windupMult: number;
  armor: number;
  shield: number;
}
export const NO_SOURCE_MODS: Readonly<SourceMods> = { asMult: 1, speedMult: 1, windupMult: 1, armor: 0, shield: 0 };

/** The mirrors a fold's sums give, unencoded: 1 + the sum for a multiplier, the sum for a flat bonus. (Before the sources and the caps: see mirrorsFromFold.) */
export function mirrorsFromSums(s: StatSums): StatMirrors {
  return {
    asMult: 1 + s.attackSpeed,
    windupMult: 1 + s.windup,
    speedMult: 1 + s.moveSpeed,
    armorBonus: s.armor,
    shieldBonus: s.shield,
    adBonus: s.ad,
    apBonus: s.ap,
  };
}

/**
 * The mirrors, unencoded, that a fold and the sources' answer give: the rows' attack speed times the sources' (slows included),
 * held to AS_MULT_CAP, THEN times the `asPost` product (G9), so the effective attack speed ends between 0.5 and 3.0; the bonus
 * armor and magic resist (rows and sources together) held to BONUS_DEFENSE_CAP (G7); the walk, the windup, AD and AP as folded.
 */
export function mirrorsFromFold(f: Folded, src: Readonly<SourceMods> = NO_SOURCE_MODS): StatMirrors {
  const m = mirrorsFromSums(f.sums);
  m.asMult = capAsMult(m.asMult * src.asMult) * f.mults.asPost;
  m.speedMult *= src.speedMult;
  m.windupMult *= src.windupMult;
  m.armorBonus = Math.min(BONUS_DEFENSE_CAP, m.armorBonus + src.armor);
  m.shieldBonus = Math.min(BONUS_DEFENSE_CAP, m.shieldBonus + src.shield);
  return m;
}

// ---------------------------------------------------------------------------------------------------- the guards' maths

/** G6: the most barrier a fighter with this max hp can hold. */
export function barrierCap(maxHp: number): number {
  return BARRIER_MAX_SHARE * Math.max(0, maxHp);
}

/** G6: a barrier amount held to barrierCap (and never negative). */
export function clampBarrier(barrier: number, maxHp: number): number {
  return Math.min(Math.max(0, barrier), barrierCap(maxHp));
}

/** G6: what is left of a barrier `dtSeconds` later; it loses BARRIER_DECAY_SHARE_PER_SECOND of max hp a second. */
export function decayBarrier(barrier: number, maxHp: number, dtSeconds: number): number {
  const left = barrier - BARRIER_DECAY_SHARE_PER_SECOND * Math.max(0, maxHp) * Math.max(0, dtSeconds);
  return left > 1e-3 ? left : 0;
}

/**
 * G5: the share of the damage it lands that a fighter heals. `own` is its faction's (Holy's); `rows` the sum of its `lifesteal`
 * rows, held to LS_CAP BEFORE `mult` (Bloodthirst's lifestealMult, a product: 2 doubles them, so the rows reach 0.5); `onDot` is
 * `lifestealDot` (Siphon), counted for a damage-over-time tick only. Never more than LIFESTEAL_MAX in all.
 */
export function lifestealTotal(own: number, rows: number, mult = 1, onDot = 0): number {
  const fromRows = rows > 0 ? Math.min(LS_CAP, rows) * Math.max(0, mult) : 0;
  return Math.min(LIFESTEAL_MAX, (own > 0 ? own : 0) + fromRows + (onDot > 0 ? onDot : 0));
}

/**
 * A slow's multiplier (1 = none, 0.7 = a 30% cut) once the victim's `slowResist` (Iron Will 0.4) is counted: the cut shrinks by that
 * share (0.7 becomes 0.82), a resist of 1 cancels it, and anything that is not a slow (1 or more) passes through. The chill's attack
 * rate and move cut, a slowMove or slowAttack status and the bog all go through it (sim/factions.ts, status.ts, terrainEffects.ts).
 */
export function resistSlow(mult: number, resist: number): number {
  return resist > 0 && mult < 1 ? 1 - (1 - mult) * (1 - Math.min(1, resist)) : mult;
}

/** G12: a critical strike chance, from the `critChance` sum: 0 under a `noCrit` flag, never above CRIT_CHANCE_MAX. */
export function critChanceFrom(sum: number, noCrit: boolean): number {
  return noCrit || !(sum > 0) ? 0 : Math.min(CRIT_CHANCE_MAX, sum);
}

/** The wire form of every mirror, ready to store on the state. */
export function encodeMirrors(m: StatMirrors): StatMirrors {
  return {
    asMult: encodeMult(m.asMult),
    windupMult: encodeMult(m.windupMult),
    speedMult: encodeMult(m.speedMult),
    armorBonus: encodeFlat(m.armorBonus),
    shieldBonus: encodeFlat(m.shieldBonus),
    adBonus: encodeFlat(m.adBonus),
    apBonus: encodeFlat(m.apBonus),
  };
}

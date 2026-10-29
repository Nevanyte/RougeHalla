// Faction signatures in real time (GAME_DESIGN 8.3, 10.3, 15): the pure numbers and formulas the sim (sim/factions.ts),
// the harness and the client all read. The per-pair state machine (targets, engagement, the mark, the chill) lives in
// the server; everything here is a function of plain numbers, so it can be tested on its own.
//
// Burn, disease and backlash are raw damage per second (backlash: per enemy swing), multiplied by the attacker's weapon
// dpsMult (bonusMultiplier) and then mitigated by the signature's own damage type (SIGNATURE_SHARES: burn and disease
// magic, backlash physical). The mark is a pulse of true damage on every landed hit (mark.ts, docs/SENTENCED_REDESIGN.md).
// Pass a paced faction (pacedFaction) for in-game numbers.
import { PLAYER_RADIUS, RANGED_HIT_REACH } from "./constants";
import { BEATS, type FactionId, type FactionSpec } from "./factions";
import { WEAPONS, weaponEdge, type WeaponId } from "./weapons";

/** Bonus damage (and the chill) keep applying this long after the target leaves weapon range or line of sight. */
export const ENGAGE_LINGER_SECONDS = 1.25;
/**
 * ...and only while the pair keeps trading: a hit (or a shield block) between them, either way, within this long, or
 * within the slower of the two fighters' current intervals (chill included) plus ENGAGE_TRADE_SLACK_SECONDS when that
 * is longer (a chilled Frost-axe mirror swings every 3.97 s). One tag can't keep a signature running from range.
 */
export const ENGAGE_TRADE_SECONDS = 3;
export const ENGAGE_TRADE_SLACK_SECONDS = 0.5;
/** A target with no hit or block between the pair for this long is forgotten, and a mark on it with it. */
export const TARGET_FORGET_SECONDS = 10;
/** Frost's movement slow reaches only fighters it chills within this distance (centre to centre)... */
export const CHILL_MOVE_RADIUS = 100;
/**
 * ...and multiplies their move speed by this (owner decision: milder than the 0.4 attack slow, so a chilled fighter can
 * still disengage with effort).
 */
export const CHILL_MOVE_MULT = 0.7;
/** The first auto attack holds Frost's full movement slow for this long. */
export const CHILL_MOVE_HOLD_MS = 1_000;
/** The movement slow fades linearly to full speed over this duration after its hold. */
export const CHILL_MOVE_THAW_MS = 3_000;
/** Time outside every active Frost movement chill before its strength fully recovers. */
export const CHILL_MOVE_RESET_MS = CHILL_MOVE_HOLD_MS + CHILL_MOVE_THAW_MS;

/** Frost's movement slow after `exposureMs` in one chill episode: full strength, then thawing, then none. */
export function frostMoveMultiplier(exposureMs: number): number {
  if (!(exposureMs > CHILL_MOVE_HOLD_MS)) return CHILL_MOVE_MULT;
  const thaw = Math.min(1, (exposureMs - CHILL_MOVE_HOLD_MS) / CHILL_MOVE_THAW_MS);
  return CHILL_MOVE_MULT + (1 - CHILL_MOVE_MULT) * thaw;
}
/** Heals (other than Holy's lifesteal) wait until the fighter has been out of combat this long. */
export const HEAL_LOCKOUT_SECONDS = 3;
/** Signature damage over time is reported as one `hit` fx per attacker and victim this often, not every tick. */
export const DOT_FX_MS = 500;

/** The signature a damage packet came from (a `hit` fx and a ledger entry carry it). */
export type SignatureKind = "burn" | "backlash" | "disease" | "mark";
/** The damage type (shares of the packet) each signature deals, whatever the faction's own shares are. */
export { SIGNATURE_SHARES } from "./signatureShares";
/** Damage over time: applied every tick, reported in DOT_FX_MS chunks, and never a reason for a damage flash. The mark is a pulse per hit, not a DoT. */
export function isDot(sig: SignatureKind | undefined): boolean {
  return sig === "burn" || sig === "disease";
}

/** Bits of a fighter's synced `sig` field: the signatures acting on them right now (client visuals). */
export const SIG_CHILLED = 1;
/** Engaged by a Fire: its swings feed Fire's backlash, and it burns. */
export const SIG_BURNING = 2;
export const SIG_DISEASED = 4;
/** Engaged by a Plague while under half hp: the execute is running. */
export const SIG_EXECUTE = 8;
/** Under a Sentenced's mark at tier 2 or more, within its reach: the attack-speed tax is cutting this fighter's rate (`markTax` says by how much). */
export const SIG_TAXED = 16;
/** Under a mark at tier 3 or more: this fighter deals 20% less. */
export const SIG_SUPPRESSED = 32;
/** Under a mark at tier 4: this fighter's execute cannot take the marker below 1 hp. */
export const SIG_EXEC_BLOCKED = 64;

/**
 * How far a fighter's signature reaches with `w` in hand: what the weapon can hit, centre to centre. A swing reaches
 * its arc plus the target's body; a projectile its range plus the hit reach. No weapon reaches nothing.
 */
export function engageRange(w: WeaponId | null): number {
  if (!w) return 0;
  const shape = WEAPONS[w].shape;
  return shape.kind === "arc" ? shape.reach + PLAYER_RADIUS : shape.range + RANGED_HIT_REACH;
}

/** Every signature bonus is multiplied by the weapon in the owner's hands (rule 1 of the counter review). */
export function bonusMultiplier(w: WeaponId | null): number {
  return w ? WEAPONS[w].dpsMult : 0;
}

/** Fire's burn on its engaged target, raw damage per second before the weapon multiplier. */
export function burnDps(f: FactionSpec): number {
  return f.mechanic === "dragonslayer" ? f.params.burn! : 0;
}

/** The hp share below which Plague's execute runs (Pestilence raises it for its owner: server mods.ts executeBandOf). */
export const EXECUTE_BAND = 0.5;

/**
 * Plague's flat disease, raw per second before the weapon multiplier (the execute is `executeDps`, its own ledger entry, so a tier-4
 * mark can deny it).
 */
export function plagueDps(f: FactionSpec): number {
  return f.mechanic === "rat_king" ? f.params.plague! : 0;
}

/**
 * Plague's execute, which grows as the target falls from `band` (EXECUTE_BAND, half hp) to 0 (raw per second). Its slope is the
 * same whatever the band, so a wider band starts it sooner and adds more at every hp.
 */
export function executeDps(f: FactionSpec, foeHpFrac: number, band: number = EXECUTE_BAND): number {
  if (f.mechanic !== "rat_king") return 0;
  return f.params.execute! * Math.max(0, band - foeHpFrac);
}

/** Plague's disease plus its execute together (the sheet's single figure; the sim records the two as separate entries). */
export function diseaseDps(f: FactionSpec, foeHpFrac: number, band: number = EXECUTE_BAND): number {
  return plagueDps(f) + executeDps(f, foeHpFrac, band);
}

export { markPct, markTierOf, markWeight, taxedRate, MARK_AS_EXPONENT, MARK_BONUS_STAT_PER_POINT, MARK_BONUS_AP_WEIGHT, MARK_FARM_AS_EFFICIENCY } from "./mark";

/** Cooldown-progress multiplier this faction's chill puts on everyone engaged with it (1 = none). */
export function chillMultiplier(f: FactionSpec): number {
  return f.aura === "wall_of_ice" ? 1 - f.params.slow! : 1;
}

// ---- Readability (GAME_DESIGN 15) ----

/** +1 when faction `a` beats `b`, -1 when `b` beats `a`, 0 for a mirror. */
export function factionEdge(a: FactionId, b: FactionId): -1 | 0 | 1 {
  for (const [w, l] of BEATS) {
    if (w === a && l === b) return 1;
    if (w === b && l === a) return -1;
  }
  return 0;
}

export interface Loadout { faction: FactionId; weapon: WeaponId | null }

/** Matchup score from `me`'s side, -2..+2: faction edge plus weapon edge (an empty hand has no weapon edge). */
export function matchupScore(me: Loadout, them: Loadout): number {
  const w = me.weapon && them.weapon ? weaponEdge(me.weapon, them.weapon) : 0;
  return factionEdge(me.faction, them.faction) + w;
}

/** The matchup hue shows for enemies in line of sight within this distance... */
export const MATCHUP_RANGE = 450;
/** ...at full strength up to this distance, fading linearly to nothing at MATCHUP_RANGE. */
export const MATCHUP_FULL_RANGE = 150;
/** The hue is recomputed at most this often (Hz). */
export const MATCHUP_HZ = 5;

/**
 * Signed hue strength, -1..+1: positive tints green (you counter them), negative red (they counter you). |score| 1 is
 * half strength, 2 full; distance fades it to 0 at MATCHUP_RANGE.
 */
export function matchupTint(score: number, dist: number): number {
  if (!(dist < MATCHUP_RANGE) || score === 0) return 0;
  const fade = dist <= MATCHUP_FULL_RANGE ? 1 : (MATCHUP_RANGE - dist) / (MATCHUP_RANGE - MATCHUP_FULL_RANGE);
  return (Math.max(-2, Math.min(2, score)) / 2) * fade;
}

/** A hit smaller than this share of max hp doesn't flash the screen... */
export const DAMAGE_FLASH_MIN_SHARE = 0.02;
/** ...and one of this share or more flashes at full strength. */
export const DAMAGE_FLASH_FULL_SHARE = 0.25;
/** The weakest flash a hit that passes the threshold shows. */
const DAMAGE_FLASH_FLOOR = 0.25;

/** Red vignette strength 0..1 for taking `amount` (after mitigation) with `maxHp`. Damage over time never flashes. */
export function damageFlash(amount: number, maxHp: number, sig?: SignatureKind): number {
  if (isDot(sig) || !(amount > 0) || !(maxHp > 0)) return 0;
  const share = amount / maxHp;
  if (share < DAMAGE_FLASH_MIN_SHARE) return 0;
  const k = (share - DAMAGE_FLASH_MIN_SHARE) / (DAMAGE_FLASH_FULL_SHARE - DAMAGE_FLASH_MIN_SHARE);
  return Math.min(1, DAMAGE_FLASH_FLOOR + (1 - DAMAGE_FLASH_FLOOR) * k);
}

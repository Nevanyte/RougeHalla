// The weapon catalog and the faction x weapon formula (GAME_DESIGN 9.1, 10.2, 10.3). Pure and shared: the sim, the
// client (cooldown and draw feedback), bots, policies and the harness all read these. attackInterval, damagePerHit and
// backlashPerSwing must keep matching testing/realtime.py exactly (packages/shared/test/weapons.test.ts); the windups
// must match realtime.py's WEAPONS windup columns (its kiting model).
//
// A weapon is a % boost on the faction's base attack speed, so the speed ratios between factions hold on every weapon:
//   attacks/s = faction.rate x (1 + boost) x asMult         interval = max(floor, 1 / attacks/s)
//   per hit   = faction.rate x faction.hit x dpsMult x asMult x interval
// Attack speed past the floor therefore turns into damage per hit. Windups scale with the interval, so a fast cadence
// is never rooted for good.
import type { FactionId, FactionSpec } from "./factions";

export type WeaponId = "sword" | "bow" | "wand" | "shield" | "axe" | "fists";
/**
 * The five loop weapons (GAME_DESIGN 9.2): the ones that are items (chests, the ground, a mob's hand, the training rack)
 * and that form the counter wheel. Fists are not an item and not in the loop, so they are NOT here; see ALL_WEAPON_IDS.
 */
export const WEAPON_IDS: readonly WeaponId[] = ["sword", "bow", "wand", "shield", "axe"];
/** Every weapon id, the loop's five and then fists (what an empty hand fights with). */
export const ALL_WEAPON_IDS: readonly WeaponId[] = [...WEAPON_IDS, "fists"];
/** What a fighter with an empty hand fights with. Never an item: it cannot be dropped, picked up or looted. */
export const FISTS = "fists" as const satisfies WeaponId;

export type ProjectileKind = "arrow" | "ball";

/** A swing: everything within `reach` of the attacker's centre (plus the target's body) and `halfArc` of the aim. */
export interface ArcShape { kind: "arc"; reach: number; halfArc: number }
/** A projectile flying straight at `speed` (u/s) until it has covered `range` (u). */
export interface ProjectileShape { kind: "projectile"; projectile: ProjectileKind; speed: number; range: number }

/**
 * What a weapon hit adds per point of each stat the fighter has (BALANCE_CONTRACT 3.3), in points of raw damage per second at
 * base attack speed. `ad` and `ap` are the attack damage and ability power mirrors (adBonus, apBonus), `hp` the bonus max hp
 * (max hp over the faction's), `def` the bonus armor plus the bonus magic resist. The ad, hp and def parts are physical damage,
 * the ap part magic. A missing key is 0.
 */
export interface WeaponScaling {
  ad?: number;
  ap?: number;
  hp?: number;
  def?: number;
}

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  /** Display colour (client only). */
  color: number;
  /** Attack-speed boost on the faction's base rate: +115% is 1.15. */
  boost: number;
  /** Shortest interval in seconds. Binds only under attack-speed buffs. */
  floor: number;
  /**
   * Damage multiplier on the faction's damage per second. 9.1 tuning: the bow's must be at least the sword's and the axe's
   * (it wins them on its opening, so it cannot also lose the close trade; against a zigzag approach the axe's must sit
   * clearly under the bow's, 0.77 against 0.8), the axe's no more than 0.04 under the wand's (Axe > Wand), and the ranged
   * ones are maxima for the kiting check (testing/test_kite.py); see testing/TUNING_9_1.md.
   */
  dpsMult: number;
  /** Per point of AD, AP, bonus max hp and bonus defense (BALANCE_CONTRACT 3.3): the cards' power reaches a hit through this. */
  scaling: Readonly<WeaponScaling>;
  shape: ArcShape | ProjectileShape;
}

export const WEAPONS: Readonly<Record<WeaponId, WeaponSpec>> = {
  sword: {
    id: "sword", name: "Sword", color: 0xcfd8dc, boost: 1.15, floor: 0.25, dpsMult: 0.75, scaling: { ad: 1.0 },
    shape: { kind: "arc", reach: 64, halfArc: Math.PI / 4 },
  },
  bow: {
    id: "bow", name: "Bow", color: 0xa1887f, boost: 0.95, floor: 0.25, dpsMult: 0.8, scaling: { ad: 0.9 },
    shape: { kind: "projectile", projectile: "arrow", speed: 900, range: 240 },
  },
  wand: {
    id: "wand", name: "Wand", color: 0xce93d8, boost: 0.65, floor: 0.3, dpsMult: 0.8, scaling: { ad: 0.3, ap: 1.2 },
    shape: { kind: "projectile", projectile: "ball", speed: 380, range: 220 },
  },
  // The bash; the block cone (SHIELD_HALF_ARC) is always up while the shield is in hand.
  shield: {
    id: "shield", name: "Shield", color: 0x90a4ae, boost: 0.6, floor: 0.3, dpsMult: 0.75, scaling: { ap: 0.3, def: 0.4 },
    shape: { kind: "arc", reach: 44, halfArc: Math.PI / 3 },
  },
  axe: {
    id: "axe", name: "Axe", color: 0xef9a9a, boost: 0.4, floor: 0.35, dpsMult: 0.77, scaling: { ad: 1.2, hp: 0.02 },
    shape: { kind: "arc", reach: 60, halfArc: Math.PI / 2 },
  },
  // What an empty hand fights with: the shortest melee reach and the fastest cadence, at 0.60 of a faction's weapon dps
  // (arming is worth x1.25-1.33). It pierces shields, never staggers and has no tie to the loop (WEAPON_BEATS).
  fists: {
    id: "fists", name: "Fists", color: 0xffcc80, boost: 1.5, floor: 0.2, dpsMult: 0.6, scaling: { ad: 0.6, ap: 0.6 },
    shape: { kind: "arc", reach: 40, halfArc: Math.PI / 3 },
  },
};

/** The design's reference weapon per faction (owner decision: Sentenced on the bow): the weapon the harness, the benches, the
 * Python oracle and the test fixtures fight with. A run itself starts on fists (an empty hand), not on this. */
export const SIGNATURE_WEAPONS: Readonly<Record<FactionId, WeaponId>> = {
  fire: "axe",
  sentenced: "bow",
  plague: "bow",
  frost: "shield",
  holy: "wand",
};

/** The designed weapon loop, (winner, loser): each weapon beats exactly two others (GAME_DESIGN 9.2). */
export const WEAPON_BEATS: ReadonlyArray<readonly [WeaponId, WeaponId]> = [
  ["sword", "axe"], ["sword", "wand"],
  ["bow", "sword"], ["bow", "axe"],
  ["wand", "bow"], ["wand", "shield"],
  ["shield", "sword"], ["shield", "bow"],
  ["axe", "wand"], ["axe", "shield"],
];

export function isWeaponId(v: unknown): v is WeaponId {
  return typeof v === "string" && (ALL_WEAPON_IDS as readonly string[]).includes(v);
}

/** One of the five loop weapons (an item); false for fists. */
export function isLoopWeapon(w: WeaponId): boolean {
  return w !== "fists";
}

/** +1 when `a` beats `b` in the weapon loop, -1 when `b` beats `a`, 0 for a mirror. */
export function weaponEdge(a: WeaponId, b: WeaponId): -1 | 0 | 1 {
  for (const [w, l] of WEAPON_BEATS) {
    if (w === a && l === b) return 1;
    if (w === b && l === a) return -1;
  }
  return 0;
}

export function isRanged(w: WeaponId): boolean {
  return WEAPONS[w].shape.kind === "projectile";
}

/** Seconds between attacks: max(floor, 1 / (rate x (1 + boost) x asMult)). */
export function attackInterval(f: Pick<FactionSpec, "rate">, w: WeaponId, asMult = 1): number {
  const spec = WEAPONS[w];
  return Math.max(spec.floor, 1 / (f.rate * (1 + spec.boost) * asMult));
}

/**
 * Raw damage of one full hit, before mitigation: rate x hit x dpsMult x asMult x interval. Pass a paced faction
 * (pacedFaction) for in-game numbers; the plain sheet gives the design values realtime.py prints.
 */
export function damagePerHit(f: Pick<FactionSpec, "rate" | "hit">, w: WeaponId, asMult = 1): number {
  return f.rate * f.hit * WEAPONS[w].dpsMult * asMult * attackInterval(f, w, asMult);
}

/** The stats a weapon hit scales with (WeaponScaling), as the fighter has them. */
export interface ScalingStats {
  /** The adBonus mirror. */
  ad: number;
  /** The apBonus mirror. */
  ap: number;
  /** Max hp over the faction's (0 at the faction's own hp). */
  bonusMaxHp: number;
  /** The armorBonus plus the shieldBonus mirrors. */
  bonusDefense: number;
}

/**
 * What a hit of `w` at attack speed `asMult` (and so interval `interval`) adds on top of damagePerHit for the stats `s`:
 * (scaling.ad x AD + scaling.hp x bonus max hp + scaling.def x bonus defense) physical, scaling.ap x AP magic, each times
 * asMult x interval. At base speed that is the scaling's points per second times the interval; attack speed multiplies the
 * dps, and an interval at its floor turns the surplus into bigger hits, exactly as damagePerHit does for the faction's part.
 */
export function scalingDamage(w: WeaponId, s: ScalingStats, asMult: number, interval: number): { phys: number; magic: number } {
  const sc = WEAPONS[w].scaling;
  const per = asMult * interval;
  return {
    phys: ((sc.ad ?? 0) * s.ad + (sc.hp ?? 0) * s.bonusMaxHp + (sc.def ?? 0) * s.bonusDefense) * per,
    magic: (sc.ap ?? 0) * s.ap * per,
  };
}

/**
 * Fire's backlash per swing of an engaged enemy (Phase 10): backlash x the enemy's base rate x its unbuffed interval,
 * which is backlash / (1 + the enemy weapon's boost) while no floor binds. Attack-speed buffs on the enemy don't shrink it.
 */
export function backlashPerSwing(backlash: number, foe: Pick<FactionSpec, "rate">, foeWeapon: WeaponId): number {
  return backlash * foe.rate * attackInterval(foe, foeWeapon);
}

// Attack windups (GAME_DESIGN 9.1, 10.3, the controls rework): every attack roots its fighter from its start until it lands
// (melee) or its projectile leaves (bow, wand). Then the fighter walks freely until the next attack, LoL-style. Each windup
// is its design seconds or the given share of the interval, whichever is shorter, so it scales with the attack speed. The
// ranged windups are the anti-kiting lever (testing/TUNING_CONTROLS.md): the chaser only closes the gap while the shooter
// winds up, so a shooter that walks away between shots gets about interval / windup times the free fire of one that stands.
const SWORD_WINDUP = 0.1;
const BASH_WINDUP = 0.1;
/** The punch: as short as a sword's (a missing case would be a windup of 0). */
export const FISTS_WINDUP = 0.1;
const AXE_WINDUP = 0.25;
const AXE_WINDUP_SHARE = 0.25;
const AXE_ROOT = 0.5;
const AXE_ROOT_SHARE = 0.5;
/** The bow's fixed full draw (it always looses at full draw, for full damage). */
export const BOW_WINDUP = 0.6;
export const BOW_WINDUP_SHARE = 0.92;
export const WAND_WINDUP = 0.4;
export const WAND_WINDUP_SHARE = 0.8;
// A windup mod (a `windupMult` below 1: Quickdraw, owner ruling "Melee windups only", testing/TUNING_ROGUE.md section 7) shortens
// the sword's, the shield bash's and the axe's windups and NEVER a ranged one: the bow's and the wand's windups are the anti-kiting
// lever, so scaleWindup (shared/mods.ts) leaves them alone whatever the mult. A mult above 1 (a future slow) lengthens every weapon.
// The melee windups are short by design (0.1 s is two 50 ms ticks, the axe's 0.25 s five), so a shortening only shows once it
// removes whole ticks: see the table in testing/TUNING_ROGUE.md 7.1.

/** Everything about one attack's rhythm, for a given interval. All in seconds. */
export interface WeaponTimings {
  interval: number;
  /**
   * From the attack starting to its damage landing (sword, axe, shield bash) or its arrow or ball leaving (bow, wand). The
   * fighter is rooted for all of it. A stagger (not on the bow) or a swap before then cancels the attack.
   */
  windup: number;
  /** Rooted for this long from the attack starting, past the windup (the axe); 0 for the other weapons. */
  root: number;
  /** A projectile weapon (bow, wand). */
  ranged: boolean;
}

export function weaponTimings(w: WeaponId, interval: number): WeaponTimings {
  const t: WeaponTimings = { interval, windup: 0, root: 0, ranged: isRanged(w) };
  switch (w) {
    case "sword": t.windup = Math.min(SWORD_WINDUP, interval); break;
    case "shield": t.windup = Math.min(BASH_WINDUP, interval); break;
    case "fists": t.windup = Math.min(FISTS_WINDUP, interval); break;
    case "axe":
      t.windup = Math.min(AXE_WINDUP, AXE_WINDUP_SHARE * interval);
      t.root = Math.min(AXE_ROOT, AXE_ROOT_SHARE * interval);
      break;
    case "wand":
      t.windup = Math.min(WAND_WINDUP, WAND_WINDUP_SHARE * interval);
      break;
    case "bow":
      t.windup = Math.min(BOW_WINDUP, BOW_WINDUP_SHARE * interval);
      break;
  }
  return t;
}

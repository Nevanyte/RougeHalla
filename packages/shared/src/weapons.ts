// The weapon catalog and the faction x weapon formula (GAME_DESIGN 9.1, 10.2, 10.3). Pure and shared: the sim, the
// client (cooldown and draw feedback), bots, policies and the harness all read these. attackInterval, damagePerHit and
// backlashPerSwing must keep matching testing/realtime.py exactly (packages/shared/test/weapons.test.ts).
//
// A weapon is a % boost on the faction's base attack speed, so the speed ratios between factions hold on every weapon:
//   attacks/s = faction.rate x (1 + boost) x asMult         interval = max(floor, 1 / attacks/s)
//   per hit   = faction.rate x faction.hit x dpsMult x asMult x interval
// Attack speed past the floor therefore turns into damage per hit. Animation timings scale with the interval, so a
// fast cadence is never rooted or slowed for good.
import type { FactionId, FactionSpec } from "./factions";

export type WeaponId = "sword" | "bow" | "wand" | "shield" | "axe";
export const WEAPON_IDS: readonly WeaponId[] = ["sword", "bow", "wand", "shield", "axe"];

export type ProjectileKind = "arrow" | "ball";

/** A swing: everything within `reach` of the attacker's centre (plus the target's body) and `halfArc` of the aim. */
export interface ArcShape { kind: "arc"; reach: number; halfArc: number }
/** A projectile flying straight at `speed` (u/s) until it has covered `range` (u). */
export interface ProjectileShape { kind: "projectile"; projectile: ProjectileKind; speed: number; range: number }

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
   * (it wins them on its opening, so it cannot also lose the close trade), the axe's at least the wand's, and the ranged
   * ones are maxima for the kiting check (testing/test_kite.py); see testing/TUNING_9_1.md.
   */
  dpsMult: number;
  shape: ArcShape | ProjectileShape;
}

export const WEAPONS: Readonly<Record<WeaponId, WeaponSpec>> = {
  sword: {
    id: "sword", name: "Sword", color: 0xcfd8dc, boost: 1.15, floor: 0.25, dpsMult: 0.75,
    shape: { kind: "arc", reach: 64, halfArc: Math.PI / 4 },
  },
  bow: {
    id: "bow", name: "Bow", color: 0xa1887f, boost: 0.95, floor: 0.25, dpsMult: 0.8,
    shape: { kind: "projectile", projectile: "arrow", speed: 900, range: 240 },
  },
  wand: {
    id: "wand", name: "Wand", color: 0xce93d8, boost: 0.65, floor: 0.3, dpsMult: 0.8,
    shape: { kind: "projectile", projectile: "ball", speed: 380, range: 220 },
  },
  // The bash; the block cone (SHIELD_HALF_ARC) is always up while the shield is in hand.
  shield: {
    id: "shield", name: "Shield", color: 0x90a4ae, boost: 0.6, floor: 0.3, dpsMult: 0.75,
    shape: { kind: "arc", reach: 44, halfArc: Math.PI / 3 },
  },
  axe: {
    id: "axe", name: "Axe", color: 0xef9a9a, boost: 0.4, floor: 0.35, dpsMult: 0.8,
    shape: { kind: "arc", reach: 60, halfArc: Math.PI / 2 },
  },
};

/** Each faction starts a run with its signature weapon (owner decision: Sentenced on the bow). */
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
  return typeof v === "string" && (WEAPON_IDS as readonly string[]).includes(v);
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

/**
 * Fire's backlash per swing of an engaged enemy (Phase 10): backlash x the enemy's base rate x its unbuffed interval,
 * which is backlash / (1 + the enemy weapon's boost) while no floor binds. Attack-speed buffs on the enemy don't shrink it.
 */
export function backlashPerSwing(backlash: number, foe: Pick<FactionSpec, "rate">, foeWeapon: WeaponId): number {
  return backlash * foe.rate * attackInterval(foe, foeWeapon);
}

// Animation timings: the design seconds, and the most of the interval each may take (GAME_DESIGN 10.3).
const SWORD_WINDUP = 0.1;
const BASH_WINDUP = 0.1;
const AXE_WINDUP = 0.25;
const AXE_WINDUP_SHARE = 0.25;
const AXE_ROOT = 0.5;
const AXE_ROOT_SHARE = 0.5;
const WAND_CAST = 0.2;
const WAND_CAST_SHARE = 0.4;
const WAND_SLOW = 0.4;
const WAND_SLOW_SHARE = 0.45;
const BOW_FULL_DRAW = 0.6;
const BOW_FULL_DRAW_SHARE = 0.7;
/** The shortest draw that can be loosed, as a share of the full draw (0.15 s of 0.6 s). */
const BOW_MIN_DRAW_SHARE = 0.25;
/** Damage of a minimum draw, as a share of a full one; it rises linearly to 1 at the full draw. */
export const BOW_MIN_DRAW_DAMAGE = 0.4;

/** Everything about one attack's rhythm, for a given interval. All in seconds. */
export interface WeaponTimings {
  interval: number;
  /**
   * From the attack starting to its damage landing (sword, axe, shield bash) or its ball leaving (wand). A stagger or a
   * swap before then cancels the attack. 0 for the bow, which fires on release.
   */
  windup: number;
  /** Rooted for this long from the attack starting (axe). */
  root: number;
  /** Moves at WAND_CAST_MOVE for this long from the attack starting (wand). */
  castSlow: number;
  /** Bow only: the draw that deals full damage, and the shortest one that can be loosed. */
  fullDraw: number;
  minDraw: number;
  /**
   * From the attack (bow: the release) to the next one being allowed to start. The bow's draw is part of its interval,
   * so a full-draw shot every interval is its designed rate: cooldown = interval - fullDraw.
   */
  cooldown: number;
  /** Ranged: moves at RANGED_RECOVERY_MOVE until the cooldown ends. */
  ranged: boolean;
}

export function weaponTimings(w: WeaponId, interval: number): WeaponTimings {
  const t: WeaponTimings = {
    interval, windup: 0, root: 0, castSlow: 0, fullDraw: 0, minDraw: 0, cooldown: interval, ranged: isRanged(w),
  };
  switch (w) {
    case "sword": t.windup = Math.min(SWORD_WINDUP, interval); break;
    case "shield": t.windup = Math.min(BASH_WINDUP, interval); break;
    case "axe":
      t.windup = Math.min(AXE_WINDUP, AXE_WINDUP_SHARE * interval);
      t.root = Math.min(AXE_ROOT, AXE_ROOT_SHARE * interval);
      break;
    case "wand":
      t.windup = Math.min(WAND_CAST, WAND_CAST_SHARE * interval);
      t.castSlow = Math.min(WAND_SLOW, WAND_SLOW_SHARE * interval);
      break;
    case "bow":
      t.fullDraw = Math.min(BOW_FULL_DRAW, BOW_FULL_DRAW_SHARE * interval);
      t.minDraw = BOW_MIN_DRAW_SHARE * t.fullDraw;
      t.cooldown = interval - t.fullDraw;
      break;
  }
  return t;
}

/** Share of a full hit a bow shot deals after drawing `drawSeconds`: BOW_MIN_DRAW_DAMAGE at the minimum, 1 at full. */
export function drawDamageScale(drawSeconds: number, t: Pick<WeaponTimings, "minDraw" | "fullDraw">): number {
  if (drawSeconds >= t.fullDraw) return 1;
  if (drawSeconds <= t.minDraw) return BOW_MIN_DRAW_DAMAGE;
  return BOW_MIN_DRAW_DAMAGE + (1 - BOW_MIN_DRAW_DAMAGE) * (drawSeconds - t.minDraw) / (t.fullDraw - t.minDraw);
}

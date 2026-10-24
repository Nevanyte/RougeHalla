// The rules between weapons (GAME_DESIGN 9.1, 9.2) as pure functions of geometry and weapon ids, shared by the sim,
// the bots, the harness and the tests. Nothing here knows about players, ticks or the network: the sim decides who and
// when, these decide what happens.
//
//   Shield (in hand, always raised toward the aim, +-SHIELD_HALF_ARC): a frontal arrow is reflected (the holder owns
//     the new arrow); a frontal sword hit is negated and RIPOSTE_SHARE of it goes back to the swordsman; a frontal bash
//     is negated. Axe swings and wand balls pierce it.
//   Sword: an unblocked hit staggers (cancels a windup or cast, restarts a bow draw), then STAGGER_IMMUNITY_SECONDS of
//     immunity. Its swing halves (SWORD_BALL_SCALE) enemy balls it meets, once per ball.
//   Axe: its swing destroys enemy balls it meets. No knockback (it would undo both of the axe's wins).
//   Wand: its ball deletes enemy arrows within BALL_ARROW_RADIUS.
//   Swapping shares the cooldown, adds SWAP_SECONDS and cancels the current action.
import {
  BALL_ARROW_RADIUS, BOW_DRAW_MOVE, RANGED_RECOVERY_MOVE, RIPOSTE_SHARE, SHIELD_HALF_ARC, STAGGER_IMMUNITY_SECONDS,
  SWAP_SECONDS, SWORD_BALL_SCALE, WAND_CAST_MOVE,
} from "./constants";
import type { Vec2 } from "./messages";
import type { ProjectileKind, WeaponId } from "./weapons";

/** What reaches a body: a melee swing by a weapon, or a projectile. */
export type HitSource = { melee: WeaponId } | { projectile: ProjectileKind };

/** What a raised shield does to a hit arriving on its front. */
export type ShieldOutcome = "pierce" | "block" | "riposte" | "reflect";

/** Angle wrapped to (-PI, PI]. */
export function wrapAngle(a: number): number {
  // % is exact for any finite input (a - k * 2PI loses everything once |a| is huge, and clients send angles).
  let w = a % (2 * Math.PI);
  if (w > Math.PI) w -= 2 * Math.PI;
  else if (w <= -Math.PI) w += 2 * Math.PI;
  return w;
}

/** Absolute difference between two angles, in [0, PI]. */
export function angleBetween(a: number, b: number): number {
  return Math.abs(wrapAngle(a - b));
}

/**
 * Is a hit coming from `from` on the front of a shield held at `holder` and facing `facing`? Inclusive at the edge.
 * A hit from exactly the holder's position has no direction and counts as frontal.
 */
export function onShieldFront(holder: Vec2, facing: number, from: Vec2): boolean {
  const dx = from.x - holder.x;
  const dy = from.y - holder.y;
  if (dx === 0 && dy === 0) return true;
  return angleBetween(Math.atan2(dy, dx), facing) <= SHIELD_HALF_ARC + 1e-9;
}

/** A projectile arrives from the direction opposite its velocity. */
export function projectileOnShieldFront(facing: number, vx: number, vy: number): boolean {
  if (vx === 0 && vy === 0) return false;
  return angleBetween(Math.atan2(-vy, -vx), facing) <= SHIELD_HALF_ARC + 1e-9;
}

export function shieldOutcome(src: HitSource): ShieldOutcome {
  if ("projectile" in src) return src.projectile === "arrow" ? "reflect" : "pierce";
  switch (src.melee) {
    case "sword": return "riposte";
    case "shield": return "block";
    default: return "pierce"; // axe (bow and wand never swing)
  }
}

/** Share of a negated sword hit dealt back to the swordsman. */
export function riposteShare(): number {
  return RIPOSTE_SHARE;
}

/** Only an unblocked sword hit staggers. */
export function staggers(src: HitSource): boolean {
  return "melee" in src && src.melee === "sword";
}

/** Server ms until which a target staggered at `now` can't be staggered again. */
export function staggerImmuneUntil(now: number): number {
  return now + STAGGER_IMMUNITY_SECONDS * 1000;
}

/** A swing meeting an enemy ball: the sword halves it (scale), the axe destroys it, a bash does nothing. */
export function swingVsBall(w: WeaponId): { scale: number } | "destroy" | null {
  if (w === "sword") return { scale: SWORD_BALL_SCALE };
  if (w === "axe") return "destroy";
  return null;
}

/** A ball deletes an enemy arrow whose centre is within BALL_ARROW_RADIUS of its own (inclusive). */
export function ballDeletesArrow(ball: Vec2, arrow: Vec2): boolean {
  return Math.hypot(ball.x - arrow.x, ball.y - arrow.y) <= BALL_ARROW_RADIUS;
}

/** Mirror reflection of a velocity off a shield facing `facing` (its normal): v' = v - 2 (v . n) n. */
export function reflectVelocity(vx: number, vy: number, facing: number): { vx: number; vy: number } {
  const nx = Math.cos(facing);
  const ny = Math.sin(facing);
  const d = vx * nx + vy * ny;
  return { vx: vx - 2 * d * nx, vy: vy - 2 * d * ny };
}

/**
 * Does a swing from `origin` along `a` with `reach` and `halfArc` touch a body of radius `r` at `p`? The body counts
 * if any of it is within reach (centre within reach + r), and its angular half-width asin(r / d) widens the arc.
 * A body overlapping the attacker is always hit. Walls are the caller's business.
 */
export function inArc(origin: Vec2, a: number, reach: number, halfArc: number, p: Vec2, r: number): boolean {
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  const d = Math.hypot(dx, dy);
  if (d <= r) return true;
  if (d > reach + r) return false;
  return angleBetween(Math.atan2(dy, dx), a) <= halfArc + Math.asin(Math.min(1, r / d)) + 1e-9;
}

/** The ready time after a swap at `now`: the shared cooldown still runs, plus SWAP_SECONDS. */
export function swapReadyAt(readyAt: number, now: number): number {
  return Math.max(readyAt, now) + SWAP_SECONDS * 1000;
}

/** What slows a fighter right now, from its weapon state (all times server ms). */
export interface MoveState {
  now: number;
  rootUntil: number;
  castSlowUntil: number;
  recoverUntil: number;
  drawing: boolean;
}

/** Move speed multiplier: 0 while rooted, else the strongest of the draw, cast and ranged-recovery slows. */
export function moveMultiplier(m: MoveState): number {
  if (m.now < m.rootUntil) return 0;
  let k = 1;
  if (m.drawing) k = Math.min(k, BOW_DRAW_MOVE);
  if (m.now < m.castSlowUntil) k = Math.min(k, WAND_CAST_MOVE);
  if (m.now < m.recoverUntil) k = Math.min(k, RANGED_RECOVERY_MOVE);
  return k;
}

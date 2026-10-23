// How to fight with each weapon: spacing, when to attack, when to loose a bow, which slot to hold. Pure: shared by the
// headless bots, the weapon duel harness and (Phase 11) mob AI, so all three play a weapon the same way. A policy only
// suggests inputs; the server still decides everything.
import { PLAYER_RADIUS } from "./constants";
import type { Vec2 } from "./messages";
import { WEAPONS, weaponEdge, type WeaponId } from "./weapons";

export interface SpacingPolicy {
  /** Close in while the target is farther than this (centre to centre), or out of sight; otherwise stand. */
  far: number;
  /** Attack (or start drawing) when the target is this close with line of sight. */
  attackRange: number;
  /** Ranged only: back off when the target is closer than this. 0 = never back off. */
  retreatBelow: number;
  /** Projectile speed for leading a moving target; 0 for melee (aim straight at it). */
  leadSpeed: number;
}

function melee(w: WeaponId): SpacingPolicy {
  const shape = WEAPONS[w].shape;
  const reach = shape.kind === "arc" ? shape.reach : 0;
  // Swing a little inside the edge: the target keeps moving during the windup and the rewind.
  return { far: reach * 0.85, attackRange: reach + PLAYER_RADIUS - 6, retreatBelow: 0, leadSpeed: 0 };
}

function ranged(w: WeaponId, far: number, attackShare: number, retreatBelow: number): SpacingPolicy {
  const shape = WEAPONS[w].shape;
  const range = shape.kind === "projectile" ? shape.range : 0;
  const speed = shape.kind === "projectile" ? shape.speed : 0;
  return { far, attackRange: range * attackShare, retreatBelow, leadSpeed: speed };
}

export const POLICIES: Readonly<Record<WeaponId, SpacingPolicy>> = {
  sword: melee("sword"),
  axe: melee("axe"),
  shield: melee("shield"),
  bow: ranged("bow", 400, 0.92, 220),
  // Balls are slow (380 u/s): fight closer, so a target can't simply walk out of the way.
  wand: ranged("wand", 280, 0.8, 160),
};

/** What the fighter sees this moment. Positions are world units; times seconds. */
export interface PolicyInput {
  self: Vec2;
  target: Vec2;
  /** The target's velocity (u/s), for leading projectiles; zero when unknown. */
  targetVel: Vec2;
  /** A clear straight line from self to target (walls, closed gates). */
  los: boolean;
  weapon: WeaponId;
  /** The cooldown has ended (the next attack or draw may start). */
  ready: boolean;
  /** Bow: how long it has been drawing (0 = not drawing), and the full draw for this fighter. */
  drawSeconds: number;
  fullDraw: number;
}

export interface PolicyOutput {
  /** Walk toward this point, stand still ("stop"), or leave the current path alone (null). */
  move: Vec2 | "stop" | null;
  /** Aim angle (radians). */
  aim: number;
  /** Hold the trigger (attack when ready; bow: draw). */
  hold: boolean;
  /** Bow: loose now. */
  release: boolean;
}

/** How far a retreat or approach step reaches; the server pathfinds to it. */
const STEP = 160;

/**
 * Where to aim a projectile of `speed` so it meets a target moving at a constant velocity: the earliest intercept,
 * or straight at the target when there is none (or `speed` is 0).
 */
export function leadAim(self: Vec2, target: Vec2, vel: Vec2, speed: number): number {
  const dx = target.x - self.x;
  const dy = target.y - self.y;
  if (speed > 0) {
    // |d + v t| = speed t  ->  (v.v - s^2) t^2 + 2 (d.v) t + d.d = 0
    const a = vel.x * vel.x + vel.y * vel.y - speed * speed;
    const b = 2 * (dx * vel.x + dy * vel.y);
    const c = dx * dx + dy * dy;
    let t = -1;
    if (Math.abs(a) < 1e-9) t = b < 0 ? -c / b : -1;
    else {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const r = Math.sqrt(disc);
        const t1 = (-b - r) / (2 * a);
        const t2 = (-b + r) / (2 * a);
        t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
      }
    }
    if (t > 0) return Math.atan2(dy + vel.y * t, dx + vel.x * t);
  }
  return Math.atan2(dy, dx);
}

/** One decision for a fighter holding `in.weapon` against one target. */
export function decide(input: PolicyInput): PolicyOutput {
  const pol = POLICIES[input.weapon];
  const dx = input.target.x - input.self.x;
  const dy = input.target.y - input.self.y;
  const d = Math.hypot(dx, dy);
  const ux = d > 0 ? dx / d : 1;
  const uy = d > 0 ? dy / d : 0;
  const aim = leadAim(input.self, input.target, input.targetVel, pol.leadSpeed);

  let move: PolicyOutput["move"];
  if (!input.los || d > pol.far) move = { x: input.target.x, y: input.target.y };
  else if (d < pol.retreatBelow) move = { x: input.self.x - ux * STEP, y: input.self.y - uy * STEP };
  else move = "stop";

  const inRange = input.los && d <= pol.attackRange;
  if (input.weapon === "bow") {
    const drawing = input.drawSeconds > 0;
    // Keep a started draw going even if the target steps out of range for a moment; loose it at full draw.
    return { move, aim, hold: inRange || drawing, release: drawing && input.drawSeconds >= input.fullDraw };
  }
  return { move, aim, hold: inRange, release: false };
}

/**
 * Which of two slots to hold against an enemy holding `theirs`: the one with the better weapon edge (beats it, then
 * a mirror or neutral), keeping the current slot on a tie. An empty slot never wins.
 */
export function bestSlot(slots: readonly [WeaponId | null, WeaponId | null], current: 0 | 1, theirs: WeaponId | null): 0 | 1 {
  const score = (w: WeaponId | null): number => (w === null ? -Infinity : theirs === null ? 0 : weaponEdge(w, theirs));
  const other = current === 0 ? 1 : 0;
  return score(slots[other]) > score(slots[current]) ? other : current;
}

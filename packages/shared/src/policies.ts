// How to fight with each weapon: spacing, when to attack, which slot to hold. Pure: shared by the headless bots, the
// weapon duel harness, mob AI and the server's target lock (sim/targeting.ts), so all of them play a weapon the same way.
// A policy only suggests inputs; the server still decides everything.
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
  /** Ranged only: while standing at a good range, sidestep and change side every this many seconds (needs `time`). Off when absent. */
  strafe?: number;
  /**
   * Melee only: while closing in from farther than `within`, walk `angle` radians off the straight line to the target and
   * change side every `period` seconds (needs `time`), then charge straight. A moving approach makes a shooter's lead
   * miss; the harness uses it to test the ranged edges against more than a straight charge. Off when absent.
   */
  weave?: { angle: number; period: number; within: number };
}

function melee(w: WeaponId): SpacingPolicy {
  const shape = WEAPONS[w].shape;
  const reach = shape.kind === "arc" ? shape.reach : 0;
  // Swing a little inside the edge: the target keeps moving during the windup and the rewind.
  return { far: reach * 0.85, attackRange: reach + PLAYER_RADIUS - 6, retreatBelow: 0, leadSpeed: 0 };
}

/** Ranged spacing as shares of the weapon's range, so retuning a range carries the way it is played with it. */
function ranged(w: WeaponId, farShare: number, attackShare: number, retreatShare: number): SpacingPolicy {
  const shape = WEAPONS[w].shape;
  const range = shape.kind === "projectile" ? shape.range : 0;
  const speed = shape.kind === "projectile" ? shape.speed : 0;
  return { far: range * farShare, attackRange: range * attackShare, retreatBelow: range * retreatShare, leadSpeed: speed };
}

export const POLICIES: Readonly<Record<WeaponId, SpacingPolicy>> = {
  sword: melee("sword"),
  axe: melee("axe"),
  shield: melee("shield"),
  bow: ranged("bow", 400 / 480, 0.92, 220 / 480),
  // Balls are slow: fight closer, so a target can't simply walk out of the way.
  wand: ranged("wand", 280 / 420, 0.8, 160 / 420),
};

/**
 * How the server's target lock plays a weapon (sim/targeting.ts): the shared spacing, but it never backs off, strafes or
 * weaves. A locked fighter walks until the target is within `far`, then stands and attacks; moving away is the player's
 * own order (a right-click), which drops the lock.
 */
export function lockSpacing(w: WeaponId): SpacingPolicy {
  const p = POLICIES[w];
  return { far: p.far, attackRange: p.attackRange, retreatBelow: 0, leadSpeed: p.leadSpeed };
}

/** What the fighter sees this moment. Positions are world units; times seconds. */
export interface PolicyInput {
  self: Vec2;
  target: Vec2;
  /** The target's velocity (u/s), for leading projectiles; zero when unknown. */
  targetVel: Vec2;
  /** A clear straight line from self to target (walls, closed gates). */
  los: boolean;
  weapon: WeaponId;
  /** The cooldown has ended (the next attack may start). */
  ready: boolean;
  // Optional, for a caller that sees the world late (a client renders in the past) and acts late (an input takes a tick
  // to be processed). Left out, every field below is zero and the policy acts on the positions it is given as they are.
  /** The fighter's own velocity (u/s). */
  selfVel?: Vec2;
  /** The positions above are this many seconds old. */
  viewLag?: number;
  /** An input sent now takes effect this many seconds from now. */
  inputDelay?: number;
  /** From an attack starting to its swing landing or its arrow or ball leaving (weaponTimings.windup). */
  windup?: number;
  /** Can a body walk straight from `from` to `to`? Lets a retreat slide along a wall instead of walking into it. */
  walkable?: (from: Vec2, to: Vec2) => boolean;
  /** Any steadily rising clock in seconds; a strafing or weaving policy changes side by it. */
  time?: number;
  /** Spacing to use instead of POLICIES[weapon] (experiments: how much does a different way of playing the weapon change a duel?). */
  spacing?: SpacingPolicy;
}

export interface PolicyOutput {
  /** Walk toward this point, stand still ("stop"), or leave the current path alone (null). */
  move: Vec2 | "stop" | null;
  /** Aim angle (radians). */
  aim: number;
  /** Hold the trigger (attack whenever ready). */
  hold: boolean;
}

/** How far a retreat or approach step reaches; the server pathfinds to it. */
const STEP = 160;
/** A retreat blocked by a wall tries these turns (radians) off straight back, then the same at half a step. */
const RETREAT_TURNS = [0, 0.7, -0.7, 1.4, -1.4, 2.1, -2.1];
const ZERO: Vec2 = { x: 0, y: 0 };

function ahead(p: Vec2, v: Vec2, seconds: number): Vec2 {
  return seconds === 0 ? p : { x: p.x + v.x * seconds, y: p.y + v.y * seconds };
}

/** A fighter that keeps closing in is assumed to stop about this far from the other (a chaser halts at its weapon's reach). */
const CONTACT = 40;

/**
 * Both fighters `seconds` from now if each keeps its velocity, except that they never close in past CONTACT: a chaser
 * stops at range, it doesn't run through you. (Without that a shooter led an adjacent chaser to the far side of itself.)
 */
function project(self: Vec2, selfVel: Vec2, target: Vec2, targetVel: Vec2, seconds: number): [Vec2, Vec2] {
  if (seconds <= 0) return [self, target];
  const rx = target.x - self.x;
  const ry = target.y - self.y;
  const vx = targetVel.x - selfVel.x;
  const vy = targetVel.y - selfVel.y;
  const a = vx * vx + vy * vy;
  const b = rx * vx + ry * vy;
  const c = rx * rx + ry * ry - CONTACT * CONTACT;
  let t = seconds;
  if (b < 0 && a > 0) {
    // |r + v t| = CONTACT: the first moment they touch.
    const disc = b * b - a * c;
    if (c <= 0) t = 0;
    else if (disc >= 0) t = Math.min(t, Math.max(0, (-b - Math.sqrt(disc)) / a));
  }
  return [ahead(self, selfVel, t), ahead(target, targetVel, t)];
}

/** The earliest time (s) a projectile of `speed` from `self` meets a target moving at constant `vel`, or -1 for never. */
function interceptTime(self: Vec2, target: Vec2, vel: Vec2, speed: number): number {
  const dx = target.x - self.x;
  const dy = target.y - self.y;
  // |d + v t| = speed t  ->  (v.v - s^2) t^2 + 2 (d.v) t + d.d = 0
  const a = vel.x * vel.x + vel.y * vel.y - speed * speed;
  const b = 2 * (dx * vel.x + dy * vel.y);
  const c = dx * dx + dy * dy;
  if (Math.abs(a) < 1e-9) return b < 0 ? -c / b : -1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const r = Math.sqrt(disc);
  const t1 = (-b - r) / (2 * a);
  const t2 = (-b + r) / (2 * a);
  return Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
}

/**
 * Where to aim a projectile of `speed` so it meets a target moving at a constant velocity: the earliest intercept,
 * or straight at the target when there is none (or `speed` is 0).
 */
export function leadAim(self: Vec2, target: Vec2, vel: Vec2, speed: number): number {
  const dx = target.x - self.x;
  const dy = target.y - self.y;
  if (speed > 0) {
    const t = interceptTime(self, target, vel, speed);
    if (t > 0) return Math.atan2(dy + vel.y * t, dx + vel.x * t);
  }
  return Math.atan2(dy, dx);
}

/**
 * Where a ranged fighter walks to get away from `threat`: straight away from it, turning toward the side when a wall
 * is in the way (so it slides along the wall), or null when it is cornered and may as well stand and shoot.
 */
function retreatPoint(self: Vec2, threat: Vec2, walkable: PolicyInput["walkable"]): Vec2 | null {
  const away = Math.atan2(self.y - threat.y, self.x - threat.x);
  for (const step of walkable ? [STEP, STEP / 2] : [STEP]) {
    for (const turn of walkable ? RETREAT_TURNS : [0]) {
      const p = { x: self.x + Math.cos(away + turn) * step, y: self.y + Math.sin(away + turn) * step };
      if (!walkable || walkable(self, p)) return p;
    }
  }
  return null;
}

/** A sidestep perpendicular to the line to the threat, on the side `time` picks, or the other when a wall is there. */
function strafePoint(self: Vec2, threat: Vec2, period: number, time: number, walkable: PolicyInput["walkable"]): Vec2 | null {
  const toward = Math.atan2(threat.y - self.y, threat.x - self.x);
  const side = Math.floor(time / period) % 2 === 0 ? 1 : -1;
  for (const s of [side, -side]) {
    const p = { x: self.x + Math.cos(toward + s * Math.PI / 2) * STEP / 2, y: self.y + Math.sin(toward + s * Math.PI / 2) * STEP / 2 };
    if (!walkable || walkable(self, p)) return p;
  }
  return null;
}

/**
 * Where a weaving melee fighter walks: `angle` off the line to the threat, on the side `time` picks (it flips every
 * `period` seconds), or the other side when a wall is there, or null when neither is walkable (the caller goes straight).
 * Pure in its inputs, so a run repeats exactly.
 */
function weavePoint(
  self: Vec2, target: Vec2, weave: NonNullable<SpacingPolicy["weave"]>, time: number, walkable: PolicyInput["walkable"],
): Vec2 | null {
  const toward = Math.atan2(target.y - self.y, target.x - self.x);
  const side = Math.floor(time / weave.period) % 2 === 0 ? 1 : -1;
  for (const s of [side, -side]) {
    const p = { x: self.x + Math.cos(toward + s * weave.angle) * STEP, y: self.y + Math.sin(toward + s * weave.angle) * STEP };
    if (!walkable || walkable(self, p)) return p;
  }
  return null;
}

/** One decision for a fighter holding `in.weapon` against one target. */
export function decide(input: PolicyInput): PolicyOutput {
  const pol = input.spacing ?? POLICIES[input.weapon];
  const selfVel = input.selfVel ?? ZERO;
  // A walk takes effect after the view lag and the input delay; an attack leaves or lands after its windup on top of that.
  const lagMove = (input.viewLag ?? 0) + (input.inputDelay ?? 0);
  const lagHit = lagMove + (input.windup ?? 0);
  const [self, target] = project(input.self, selfVel, input.target, input.targetVel, lagMove);
  const [selfHit, targetHit] = project(input.self, selfVel, input.target, input.targetVel, lagHit);

  const dx = target.x - self.x;
  const dy = target.y - self.y;
  const d = Math.hypot(dx, dy);
  // A projectile leaves from where the shooter's client draws it (the position the policy was given, which the sim reads
  // back through the attack's `t`), not from where the shooter will be: aiming from the projected position of a
  // strafing or backing-off shooter misses a standing target by its speed times the lag.
  const origin = pol.leadSpeed > 0 ? input.self : selfHit;
  const aim = leadAim(origin, targetHit, input.targetVel, pol.leadSpeed);

  let move: PolicyOutput["move"];
  if (!input.los || d > pol.far) {
    const { weave } = pol;
    const off = weave && input.los && input.time !== undefined && d > weave.within
      ? weavePoint(self, target, weave, input.time, input.walkable)
      : null;
    move = off ?? { x: target.x, y: target.y };
  } else if (d < pol.retreatBelow) move = retreatPoint(self, target, input.walkable) ?? "stop";
  else if (pol.strafe && input.time !== undefined) move = strafePoint(self, target, pol.strafe, input.time, input.walkable) ?? "stop";
  else move = "stop";

  // Melee judges the swing by where the target will be when it lands; a projectile by where the shot will meet it.
  let reach = Math.hypot(targetHit.x - origin.x, targetHit.y - origin.y);
  if (pol.leadSpeed > 0) {
    const t = interceptTime(origin, targetHit, input.targetVel, pol.leadSpeed);
    if (t > 0) reach = t * pol.leadSpeed;
  }
  return { move, aim, hold: input.los && reach <= pol.attackRange };
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

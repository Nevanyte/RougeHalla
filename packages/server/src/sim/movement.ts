import {
  findPath, MAX_REWIND_MS, newSlip, PLAYER_RADIUS, PLAYER_SPEED, regrip, slipWalk, TICK_MS, type Sample, type Vec2,
} from "@raid/shared";
import type { Combatant } from "./combatant";
import { countHazardSeconds, slipAccelAt, slipAccelOf } from "./terrainEffects";
import { collisionMap, type World } from "./world";

/** How far back a fighter's velocity is measured (to lead a projectile at it). */
export const VELOCITY_WINDOW_MS = 100;

/** What walking reads and writes on any fighter's synced state. */
interface Walker { x: number; y: number; facing: number }

/** Waypoints from `from` to `to` (excluding `from`). Empty if unreachable. */
export function planPath(world: World, from: Vec2, to: Vec2): Vec2[] {
  return findPath(collisionMap(world), { x: from.x, y: from.y }, { x: to.x, y: to.y }, PLAYER_RADIUS);
}

/**
 * Walks along rt.path at PLAYER_SPEED x `speedMult` for dt seconds, consuming reached waypoints. `keepFacing`: the
 * fighter is aiming, so walking doesn't turn it.
 */
export function advanceAlongPath(p: Walker, rt: { path: Vec2[] }, dt: number, keepFacing = false, speedMult = 1): void {
  let budget = PLAYER_SPEED * speedMult * dt;
  while (budget > 0 && rt.path.length > 0) {
    const target = rt.path[0]!;
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= budget) {
      p.x = target.x;
      p.y = target.y;
      budget -= dist;
      rt.path.shift();
    } else {
      p.x += (dx / dist) * budget;
      p.y += (dy / dist) * budget;
      budget = 0;
    }
    if (dist > 0.001 && !keepFacing) p.facing = Math.atan2(dy, dx);
  }
}

/**
 * One tick of a fighter's walk: today's `advanceAlongPath` everywhere except on slippery ground (ice, for a fighter its home
 * rule does not exempt), where the slide of shared/walk.ts takes over. Off ice and carrying no slide it IS advanceAlongPath,
 * bit for bit. On ice the fighter keeps the velocity it walked on with (the last tick's), turns toward the walk by the
 * traction, and a speed multiplier of 0 (a windup, the axe's root, later a stun) plants it. The first tick off ice grips at
 * once and plans the walk again if the slide carried it off the line. A slide stuck on a map it cannot steer on (ice touching a
 * wall, which validateTerrain T11 refuses) grips for a second inside slipWalk (SlipState.gripUntil) and walks its path exactly:
 * nothing to do here, the client's model runs the same call.
 */
export function walkFighter(world: World, c: Combatant, dt: number, keepFacing: boolean, speedMult: number): void {
  const rt = c.rt;
  if (slipAccelOf(world, c) === 0) {
    if (rt.slip) {
      rt.slip = null;
      rt.path = regripPath(world, c);
    }
    advanceAlongPath(c.s, rt, dt, keepFacing, speedMult);
    return;
  }
  if (!rt.slip) {
    const v = tickVelocity(rt.history);
    rt.slip = newSlip(c.s.x, c.s.y, v.x, v.y);
  }
  countHazardSeconds(world, "ice", dt * 1000);
  slipWalk(
    collisionMap(world), c.s, rt.slip, rt.path, dt * 1000, PLAYER_SPEED * speedMult,
    (x, y) => slipAccelAt(world, c, x, y), world.state.serverTime, PLAYER_RADIUS,
  );
  // Where it steers, as the walker turns it (a rooted fighter does not turn).
  if (!keepFacing && speedMult > 0 && rt.path.length > 0) {
    const t = rt.path[0]!;
    const dx = t.x - c.s.x;
    const dy = t.y - c.s.y;
    if (dx * dx + dy * dy > 1e-6) c.s.facing = Math.atan2(dy, dx);
  }
}

/**
 * The velocity (u/s) a fighter walked at in its last tick, from the two newest history samples (zero with fewer than two: just
 * placed, or whatever reset the history to one sample: the teleport, a displacement, a mob's reset, the training revive). It
 * is what a fighter carries onto ice, so stepping onto it is no speed pop.
 */
export function tickVelocity(history: readonly Sample[]): Vec2 {
  const n = history.length;
  if (n < 2) return { x: 0, y: 0 };
  const a = history[n - 2]!;
  const b = history[n - 1]!;
  const dt = (b.t - a.t) / 1000;
  return dt > 0 ? { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt } : { x: 0, y: 0 };
}

/** The walk the fighter slid off ice on, kept if its next leg is clear from where it stands, else planned again (empty if unreachable). */
export function regripPath(world: World, c: Combatant): Vec2[] {
  return regrip(collisionMap(world), c.s, c.rt.path);
}

/** Appends this tick's position and forgets anything older than the rewind window. */
export function recordHistory(rt: { history: Sample[] }, p: Vec2, now: number): void {
  rt.history.push({ t: now, x: p.x, y: p.y });
  const cutoff = now - MAX_REWIND_MS - TICK_MS;
  while (rt.history.length > 2 && rt.history[0]!.t < cutoff) rt.history.shift();
}

/** Where the fighter was at server time `t` (lerped between ticks; clamped to recorded history). */
export function positionAt(rt: { history: Sample[] }, p: Vec2, t: number): Vec2 {
  const h = rt.history;
  if (h.length === 0 || t >= h[h.length - 1]!.t) return { x: p.x, y: p.y };
  if (t <= h[0]!.t) return { x: h[0]!.x, y: h[0]!.y };
  let i = h.length - 2;
  while (i > 0 && h[i]!.t > t) i--;
  const a = h[i]!;
  const b = h[i + 1]!;
  const k = (t - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

/**
 * The fighter's velocity (u/s) over the last VELOCITY_WINDOW_MS of its recorded positions, ending at its latest sample: the
 * position `p` belongs to the tick that recorded it, which is the tick before the one being simulated until movement runs.
 * Zero for a fighter with no more than one sample (just placed).
 */
export function velocityOf(rt: { history: Sample[] }, p: Vec2, now: number): Vec2 {
  const h = rt.history;
  const t = h.length > 0 ? h[h.length - 1]!.t : now;
  const from = Math.max(t - VELOCITY_WINDOW_MS, h.length > 0 ? h[0]!.t : t);
  if (!(t > from)) return { x: 0, y: 0 };
  const before = positionAt(rt, p, from);
  const dt = (t - from) / 1000;
  return { x: (p.x - before.x) / dt, y: (p.y - before.y) / dt };
}

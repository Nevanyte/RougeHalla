import { findPath, MAX_REWIND_MS, PLAYER_RADIUS, PLAYER_SPEED, TICK_MS, type Sample, type Vec2 } from "@raid/shared";
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

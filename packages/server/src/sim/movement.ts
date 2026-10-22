import { findPath, MAX_REWIND_MS, PLAYER_RADIUS, PLAYER_SPEED, TICK_MS, type Vec2 } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import type { PlayerRuntime, World } from "./world";

/** Waypoints from `from` to `to` (excluding `from`). Empty if unreachable. */
export function planPath(world: World, from: Vec2, to: Vec2): Vec2[] {
  return findPath(world.map, { x: from.x, y: from.y }, { x: to.x, y: to.y }, PLAYER_RADIUS);
}

/** Walks along rt.path at PLAYER_SPEED for dt seconds, consuming reached waypoints. */
export function advanceAlongPath(p: PlayerState, rt: PlayerRuntime, dt: number): void {
  let budget = PLAYER_SPEED * dt;
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
    if (dist > 0.001) p.facing = Math.atan2(dy, dx);
  }
}

/** Appends this tick's position and forgets anything older than the rewind window. */
export function recordHistory(rt: PlayerRuntime, p: PlayerState, now: number): void {
  rt.history.push({ t: now, x: p.x, y: p.y });
  const cutoff = now - MAX_REWIND_MS - TICK_MS;
  while (rt.history.length > 2 && rt.history[0]!.t < cutoff) rt.history.shift();
}

/** Where the player was at server time `t` (lerped between ticks; clamped to recorded history). */
export function positionAt(rt: PlayerRuntime, p: PlayerState, t: number): Vec2 {
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

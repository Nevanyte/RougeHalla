import { PLAYER_RADIUS, segmentClear, type GameMap, type Vec2 } from "@raid/shared";

export const MOVEMENT_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"]);

/** Keep keyboard steering on straight, body-clear segments instead of pathfinding around obstacles. */
export function keyboardMoveGoal(map: GameMap, origin: Vec2, keys: ReadonlySet<string>): Vec2 | null {
  const x = Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft"));
  const y = Number(keys.has("KeyS") || keys.has("ArrowDown")) - Number(keys.has("KeyW") || keys.has("ArrowUp"));
  if (x === 0 && y === 0) return null;
  const length = Math.hypot(x, y);
  const headings = [{ x: x / length, y: y / length }];
  if (x !== 0 && y !== 0) headings.push({ x, y: 0 }, { x: 0, y });
  for (const heading of headings) for (let distance = 64; distance >= 8; distance -= 8) {
    const goal = { x: origin.x + heading.x * distance, y: origin.y + heading.y * distance };
    if (segmentClear(map, origin, goal, PLAYER_RADIUS)) return goal;
  }
  return null;
}

/** A held direction is re-sent this often, so the 64 u lookahead goal keeps ahead of the walker and a lost order heals. */
export const STEER_REPEAT_MS = 100;
/** A key event within this long of the last steer waits for the frame instead: a rate cap, not a chord merge. */
export const STEER_COALESCE_MS = 3;

/**
 * Whether the keyboard should send an order now. `changed`: a movement key went down or up since the last send. A key event
 * sends at once (so the order is not quantised to the render frame) unless it follows the last send too closely; the frame
 * picks that one up, since `changed` stays set. A negative gap (the clock stepped back) defers an event instead of sending it.
 * `repeatMs`: the held direction's repeat, which the scene stretches while the tick's deadline is unknown (net/tickPhase.ts sweepMs).
 * `stalled`: the uplink is backed up (net/uplinkPace.ts StallWatch): the repeat, a continuous stream, waits for it to clear; a key
 * change is an order and still goes.
 */
export function steerDue(s: { changed: boolean; lastAt: number }, now: number, fromEvent: boolean, repeatMs = STEER_REPEAT_MS, stalled = false): boolean {
  const gap = now - s.lastAt;
  return fromEvent ? s.changed && gap >= STEER_COALESCE_MS : s.changed || (!stalled && gap >= repeatMs);
}

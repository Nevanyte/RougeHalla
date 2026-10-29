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

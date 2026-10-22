// The client's copy of the server's take rule, so the highlight, F-to-open and the loot panel agree with it.
import { INTERACT_RANGE, hasLineOfSight, type GameMap, type Vec2 } from "@raid/shared";
import type { ContainerState } from "@raid/shared/schema";

/**
 * Within INTERACT_RANGE and a wall-free line between the two points. Callers pass the local player's latest
 * synced position, not the interpolated one (that lags ~INTERP_DELAY_MS behind what the server checks).
 */
export function canInteract(map: GameMap, from: Vec2, to: Vec2): boolean {
  return Math.hypot(from.x - to.x, from.y - to.y) <= INTERACT_RANGE && hasLineOfSight(map, from, to);
}

/**
 * The container the player should loot: of those satisfying `canInteract`, any with items beats an empty
 * one (empty crates and bodies stay around as props), then the closest wins.
 */
export function nearestContainer(
  containers: { forEach(cb: (c: ContainerState, id: string) => void): void },
  map: GameMap,
  from: Vec2,
): ContainerState | null {
  let best: ContainerState | null = null;
  let bestHasLoot = false;
  let bestSq = Infinity;
  containers.forEach((c) => {
    if (!canInteract(map, from, c)) return;
    const hasLoot = c.items.length > 0;
    const sq = (c.x - from.x) ** 2 + (c.y - from.y) ** 2;
    if (!best || (hasLoot !== bestHasLoot ? hasLoot : sq < bestSq)) {
      best = c;
      bestHasLoot = hasLoot;
      bestSq = sq;
    }
  });
  return best;
}

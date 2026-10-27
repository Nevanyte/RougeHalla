// The client's copy of the server's pickup rule, so the highlight, the F key and the weapon bar's hint agree with it.
import { INTERACT_RANGE, MASK_MOVE, hasLineOfSight, isWeaponId, type GameMap, type Vec2, type WeaponId } from "@raid/shared";
import type { ContainerState } from "@raid/shared/schema";

/**
 * Within INTERACT_RANGE and a line between the two points that nothing solid crosses: walls and LOW (a fence, a lava
 * stream), the movement mask like the server's pickup (sim/loot.ts), since a hand does not reach through bars. Callers pass
 * the local player's latest synced position, not the interpolated one (that lags ~INTERP_DELAY_MS behind what the server checks).
 */
export function canInteract(map: GameMap, from: Vec2, to: Vec2): boolean {
  return Math.hypot(from.x - to.x, from.y - to.y) <= INTERACT_RANGE && hasLineOfSight(map, from, to, MASK_MOVE);
}

/**
 * The weapon a pickup would take from this container (its first item), or null: an opened chest, an empty body, and a camp's
 * shared reward chest, which is taken with `choose` from the chest panel and never with F (it holds no items).
 */
export function containerWeapon(c: ContainerState): WeaponId | null {
  if (c.kind === "reward" || c.items.length === 0) return null;
  const def = c.items.at(0).def;
  return isWeaponId(def) ? def : null;
}

/** The closest container holding a weapon that satisfies `canInteract`: what F takes. Opened chests and empty bodies are props. */
export function nearestContainer(
  containers: { forEach(cb: (c: ContainerState, id: string) => void): void },
  map: GameMap,
  from: Vec2,
): ContainerState | null {
  let best: ContainerState | null = null;
  let bestSq = Infinity;
  containers.forEach((c) => {
    if (containerWeapon(c) === null || !canInteract(map, from, c)) return;
    const sq = (c.x - from.x) ** 2 + (c.y - from.y) ** 2;
    if (sq < bestSq) {
      best = c;
      bestSq = sq;
    }
  });
  return best;
}

// The client's copy of the server's pickup rule, so the highlight, the F key and the weapon bar's hint agree with it.
import { INTERACT_RANGE, MASK_MOVE, hasLineOfSight, isWeaponId, questDefById, type GameMap, type Vec2, type WeaponId } from "@raid/shared";
import type { ContainerState } from "@raid/shared/schema";
import { questItemQuestId, type QuestCollection, type QuestStateLike } from "../ui/questModel";

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

export interface QuestPickupContext {
  quests: QuestCollection;
  localId: string;
}

/** No quest is known: no quest item is offered. The default when the caller has nothing to say about quests (a weapons-only test). */
const NO_QUESTS: QuestPickupContext = { quests: { forEach: () => {} }, localId: "" };

/**
 * Whether the server would take this quest item for the local player (sim/loot.ts `handlePickup` -> sim/quests.ts
 * `onQuestPickup`). It names the container the client sends, so there is no tie rule on the server: the client's choice is the
 * one that counts, and an item the server refuses ("That quest is over", "you can carry one quest item", "You have enough
 * tokens") must not be the one F picks, or it shadows a weapon lying next to it for as long as the player stands there.
 */
export function questItemEligible(c: ContainerState, context: QuestPickupContext): boolean {
  const questId = questItemQuestId(c);
  if (!questId) return false;
  let quest: QuestStateLike | undefined;
  let carrying = false;
  context.quests.forEach((candidate, id) => {
    if (candidate.carrier === context.localId) carrying = true;
    if (candidate.id === questId || id === questId) quest = candidate;
  });
  if (!quest || quest.status !== "open") return false;
  const def = questDefById(quest.def);
  if (!def) return false;
  if (def.kind === "fetch") return !carrying && quest.carrier === "";
  return def.kind === "collect" && (quest.progress.get(context.localId) ?? 0) < def.count;
}

/** The closest weapon or quest item the server would take, in reach on the move mask: what F takes. */
export function nearestContainer(
  containers: { forEach(cb: (c: ContainerState, id: string) => void): void },
  map: GameMap,
  from: Vec2,
  questContext: QuestPickupContext = NO_QUESTS,
): ContainerState | null {
  let best: ContainerState | null = null;
  let bestSq = Infinity;
  containers.forEach((c) => {
    const sq = (c.x - from.x) ** 2 + (c.y - from.y) ** 2;
    // Cheapest first: nearer than the best so far and within reach (canInteract is the exact test), the shape of the container,
    // then the pickup rule, then the line.
    if (sq >= bestSq || sq > (INTERACT_RANGE + 1) ** 2) return;
    if (c.kind === "quest" ? c.items.length === 0 || !questItemEligible(c, questContext) : containerWeapon(c) === null) return;
    if (!canInteract(map, from, c)) return;
    best = c;
    bestSq = sq;
  });
  return best;
}

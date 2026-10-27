// The client's copy of the server's pickup rule, so the highlight, the F key and the weapon bar's hint agree with it.
import { INTERACT_RANGE, MASK_MOVE, hasLineOfSight, isWeaponId, questDefById, type GameMap, type QuestDef, type Vec2, type WeaponId } from "@raid/shared";
import type { ContainerState } from "@raid/shared/schema";
import { canTalk } from "../ui/questDialogMath";
import { questAccepted, questItemQuestId, visibleQuest, type QuestCollection, type QuestStateLike } from "../ui/questModel";

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
  // Nothing of an offer is taken before it is accepted at its giver: the server leaves the item and says so.
  if (!questAccepted(quest, context.localId)) return false;
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

/**
 * The closest open public offer whose giver the local player could talk to now (the server's accept rule: within QUEST_ACCEPT_RANGE
 * and a clear line on the collision map, `canTalk`), or null. Pass the public offers (RaidState.quests): a private reveal preview
 * has no giver yet. An offer already accepted is still talked to: the dialog then shows its progress.
 */
export function nearestGiver(quests: QuestCollection, map: GameMap, from: Vec2): { quest: QuestStateLike; def: QuestDef } | null {
  let best: { quest: QuestStateLike; def: QuestDef } | null = null;
  let bestSq = Infinity;
  quests.forEach((quest) => {
    if (!visibleQuest(quest) || quest.status !== "open") return;
    const sq = (quest.x - from.x) ** 2 + (quest.y - from.y) ** 2;
    if (sq >= bestSq) return;
    const def = questDefById(quest.def);
    if (!def || !canTalk(map, from, quest)) return;
    best = { quest, def };
    bestSq = sq;
  });
  return best;
}

/** What F does: take a weapon or quest item from a container, or talk to a quest giver (open its offer's dialog). */
export type Interaction = { kind: "pickup"; container: ContainerState } | { kind: "talk"; quest: QuestStateLike; def: QuestDef };

/**
 * The one thing F does at `from`: the nearest interactable wins, a weapon or an item the server would take (`nearestContainer`)
 * against a giver in talking reach (`nearestGiver`). A tie goes to the pickup, so a weapon lying at a giver's feet is still taken.
 * `publicQuests` are RaidState.quests (the givers); `questContext` is what `nearestContainer` reads of the quests (its previews included).
 */
export function pickInteraction(
  containers: { forEach(cb: (c: ContainerState, id: string) => void): void },
  publicQuests: QuestCollection,
  map: GameMap,
  from: Vec2,
  questContext: QuestPickupContext = NO_QUESTS,
): Interaction | null {
  const container = nearestContainer(containers, map, from, questContext);
  const giver = nearestGiver(publicQuests, map, from);
  if (giver && (!container || Math.hypot(giver.quest.x - from.x, giver.quest.y - from.y) < Math.hypot(container.x - from.x, container.y - from.y))) {
    return { kind: "talk", quest: giver.quest, def: giver.def };
  }
  return container ? { kind: "pickup", container } : null;
}

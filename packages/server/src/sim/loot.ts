// Loot gameplay module: chests and loose weapons, the pickup action (F) and the body-drop hook. A camp's shared skill chest
// (kind "reward", roguelike R5) is a container too, but sim/chests.ts owns it: `pickup` refuses it.
// step.ts only runs actions for alive players in an active raid, so handlers don't re-check that.
//   - A chest holds one weapon and stays (opened, empty) once taken. A loose weapon vanishes when taken. A body holds
//     what the player carried when they went down.
//   - Pickup takes the container's first weapon into a free slot: the hand's own slot if it is empty (an unarmed hand arms
//     at once, which counts as a swap), else the other slot if that is empty (the weapon in hand doesn't change). With both
//     slots full it replaces the weapon in hand, which drops where the player stands; that counts as a swap too
//     (weaponChanged: the action is cancelled and the cooldown gets SWAP_SECONDS). Fists are what an empty slot fights with,
//     never an item: nothing drops, lies in a body or is picked up as fists.
import {
  FISTS, hasLineOfSight, INTERACT_RANGE, isWeaponId, MASK_MOVE, QUEST_ITEM_PREFIX, WEAPONS, type ContainerKind, type ItemDTO, type Vec2,
} from "@raid/shared";
import { ContainerState, ItemState, type PlayerState } from "@raid/shared/schema";
import { setSlot, slotItem } from "./combatant";
import { rollChestWeapon, rollGroundWeapon } from "./lootTables";
import { actionBlocked } from "./status";
import { weaponChanged } from "./weapons";
import { collisionMap, emit, nextId, type ActionHandler, type World } from "./world";

function toast(world: World, to: string, text: string): void {
  emit(world, { type: "toast", to, text });
}

/**
 * Schema nodes can have only one parent, so an item "moves" between arrays by being removed from
 * the source and re-created (same uid/def) in the destination. Never push a live instance elsewhere.
 */
function newItem(uid: string, def: string): ItemState {
  const item = new ItemState();
  item.uid = uid;
  item.def = def;
  return item;
}

/**
 * Tick each container was created in. Container ids are a predictable counter, so without this a
 * scripted client could pick up from a drop or body in the very tick it appears, before any client
 * has been told it exists. Containers made at world creation (tick 0) are never recorded: a step
 * always runs at tick >= 1.
 */
const bornAt = new WeakMap<World, Map<string, number>>();

export function addContainer(world: World, kind: ContainerKind, at: Vec2, label: string, items: ItemDTO[]): ContainerState {
  const c = new ContainerState();
  c.id = nextId(world, "c");
  c.kind = kind;
  c.x = at.x;
  c.y = at.y;
  c.label = label;
  for (const it of items) c.items.push(newItem(it.uid, it.def));
  world.state.containers.set(c.id, c);
  if (world.state.tick > 0) {
    let births = bornAt.get(world);
    if (!births) bornAt.set(world, (births = new Map()));
    // Created between ticks (a body from a leave): first published with the next tick, so that is
    // the tick in which it must not be takeable yet.
    births.set(c.id, world.state.tick + (world.stepping ? 0 : 1));
  }
  return c;
}

/**
 * Holds `id` back one tick: it counts as born in the NEXT tick, so it is first takeable in the one after. For a container born
 * inside a tick (a camp's chest, made in the ledger pass of tick N): addContainer records N, which blocks nothing in tick N+1,
 * and a scripted client guessing the predictable id would win the first pick over players who can only answer a patch they
 * have seen. Between ticks addContainer already records tick + 1, so this changes nothing there.
 */
export function holdBirth(world: World, id: string): void {
  const births = bornAt.get(world);
  if (births?.has(id)) births.set(id, world.state.tick + 1);
}

/** True while `id` was created earlier in the tick being simulated. Forgets older births on the way. sim/chests.ts reads it too. */
export function bornThisTick(world: World, id: string): boolean {
  const births = bornAt.get(world);
  const born = births?.get(id);
  if (born === undefined) return false;
  if (born >= world.state.tick) return true;
  births!.delete(id);
  return false;
}

/** A container leaves the state: its birth tick is no longer needed (a chest nobody picked from would keep it for good). */
export function forgetBirth(world: World, id: string): void {
  bornAt.get(world)?.delete(id);
}

/** How many births are remembered (for tests: the map must not grow with the containers that come and go). */
export function birthsRemembered(world: World): number {
  return bornAt.get(world)?.size ?? 0;
}

/** A loose weapon on the ground at `at`. */
export function dropWeapon(world: World, at: Vec2, def: string): ContainerState {
  return addContainer(world, "ground", at, isWeaponId(def) ? WEAPONS[def].name : def, [{ uid: world.newItemUid(), def }]);
}

/** One chest (one weapon) per chest spot, and a loose weapon on some of the ground spots. */
export function spawnLoot(world: World): void {
  for (const spot of world.map.crateSpots) {
    addContainer(world, "chest", spot, "Chest", [{ uid: world.newItemUid(), def: rollChestWeapon(world.random) }]);
  }
  for (const spot of world.map.groundSpots) {
    const def = rollGroundWeapon(world.random);
    if (def) dropWeapon(world, spot, def);
  }
}

export const handlePickup: ActionHandler = (world, c, cmd) => {
  if (cmd.kind !== "pickup" || c.kind !== "player") return;
  if (actionBlocked(world, c)) { toast(world, c.id, "Can't do that now"); return; }
  const p = c.s;
  const box = world.state.containers.get(cmd.containerId);
  if (!box || bornThisTick(world, box.id)) { toast(world, c.id, "Nothing there"); return; }
  // A camp's shared chest is taken with `choose` (sim/chests.ts), never with the weapon pickup.
  if (box.kind === "reward") { toast(world, c.id, "Nothing to take"); return; }
  if (Math.hypot(p.x - box.x, p.y - box.y) > INTERACT_RANGE) { toast(world, c.id, "Too far away"); return; }
  // Movement reach, not sight: a hand does not go through a fence (centres 56 u apart across one tile, INTERACT_RANGE 56).
  if (!hasLineOfSight(collisionMap(world), p, box, MASK_MOVE)) { toast(world, c.id, "Can't reach that"); return; }
  const item = box.items.length > 0 ? box.items.at(0) : undefined;
  if (!item) { toast(world, c.id, "Nothing to take"); return; }
  if (item.def.startsWith(QUEST_ITEM_PREFIX)) {
    if (!world.quests?.onQuestPickup(world, c, box)) toast(world, c.id, "Nothing to take");
    return;
  }
  if (!isWeaponId(item.def) || item.def === FISTS) { toast(world, c.id, "Nothing to take"); return; }

  const def = item.def;
  box.items.splice(0, 1);
  const hand: 0 | 1 = p.slot === 1 ? 1 : 0;
  // A free slot: the hand's own if it is empty (the weapon is then taken up at once), else the other one (the hand stays).
  const free = slotItem(p, hand) === null ? hand : slotItem(p, 0) === null ? 0 : slotItem(p, 1) === null ? 1 : null;
  if (free !== null) {
    setSlot(p, free, def);
    if (free === hand) weaponChanged(world, c);
  } else {
    const dropped = slotItem(p, hand);
    setSlot(p, hand, def);
    if (dropped) dropWeapon(world, p, dropped);
    weaponChanged(world, c);
  }
  // Loose weapons vanish once picked up; chests and bodies stay as (empty) props.
  if (box.kind === "ground" && box.items.length === 0) world.state.containers.delete(box.id);
};

/** Leaves a body where the player went down, holding the weapons they carried (fists were never carried). */
export function dropBody(world: World, p: PlayerState): void {
  const items = [p.weapon0, p.weapon1].filter((w) => w !== "" && w !== FISTS).map((def) => ({ uid: world.newItemUid(), def }));
  addContainer(world, "body", p, p.name, items);
  p.weapon0 = "";
  p.weapon1 = "";
}

export function install(world: World): void {
  world.actions.pickup = handlePickup;
  world.hooks.dropBody = dropBody;
  spawnLoot(world);
}

// Loot gameplay module: chests and loose weapons, the pickup action (F) and the body-drop hook.
// step.ts only runs actions for alive players in an active raid, so handlers don't re-check that.
//   - A chest holds one weapon and stays (opened, empty) once taken. A loose weapon vanishes when taken. A body holds
//     what the player carried when they went down.
//   - Pickup takes the container's first weapon into an empty slot (the weapon in hand doesn't change), or, with both
//     slots full, replaces the weapon in hand, which drops where the player stands; that counts as a swap
//     (weaponChanged: the action is cancelled and the cooldown gets SWAP_SECONDS).
import {
  hasLineOfSight, INTERACT_RANGE, isWeaponId, WEAPONS, type ContainerKind, type ItemDTO, type Vec2,
} from "@raid/shared";
import { ContainerState, ItemState, type PlayerState } from "@raid/shared/schema";
import { activeWeapon, setSlot } from "./combatant";
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

/** True while `id` was created earlier in the tick being simulated. Forgets older births on the way. */
function bornThisTick(world: World, id: string): boolean {
  const births = bornAt.get(world);
  const born = births?.get(id);
  if (born === undefined) return false;
  if (born >= world.state.tick) return true;
  births!.delete(id);
  return false;
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
  if (Math.hypot(p.x - box.x, p.y - box.y) > INTERACT_RANGE) { toast(world, c.id, "Too far away"); return; }
  if (!hasLineOfSight(collisionMap(world), p, box)) { toast(world, c.id, "Can't reach that"); return; }
  const item = box.items.length > 0 ? box.items.at(0) : undefined;
  if (!item || !isWeaponId(item.def)) { toast(world, c.id, "Nothing to take"); return; }

  const def = item.def;
  box.items.splice(0, 1);
  const empty = p.weapon0 === "" ? 0 : p.weapon1 === "" ? 1 : null;
  if (empty !== null) {
    setSlot(p, empty, def);
  } else {
    const dropped = activeWeapon(p);
    setSlot(p, p.slot === 1 ? 1 : 0, def);
    if (dropped) dropWeapon(world, p, dropped);
    weaponChanged(world, c);
  }
  // Loose weapons vanish once picked up; chests and bodies stay as (empty) props.
  if (box.kind === "ground" && box.items.length === 0) world.state.containers.delete(box.id);
};

/** Leaves a body where the player went down, holding the weapons they carried. */
export function dropBody(world: World, p: PlayerState): void {
  const items = [p.weapon0, p.weapon1].filter((w) => w !== "").map((def) => ({ uid: world.newItemUid(), def }));
  addContainer(world, "body", p, p.name, items);
  p.weapon0 = "";
  p.weapon1 = "";
}

export function install(world: World): void {
  world.actions.pickup = handlePickup;
  world.hooks.dropBody = dropBody;
  spawnLoot(world);
}

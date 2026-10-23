// Loot gameplay module: container spawning plus the take / drop / use actions and the body-drop hook.
// step.ts only runs actions for alive players in an active raid, so handlers don't re-check that.
import {
  hasLineOfSight, INTERACT_RANGE, INVENTORY_SLOTS, itemDef, type ContainerKind, type ItemDTO, type Vec2,
} from "@raid/shared";
import { ContainerState, ItemState, type PlayerState } from "@raid/shared/schema";
import { rollCrate, rollGroundItem } from "./lootTables";
import { emit, nextId, type ActionHandler, type PlayerRuntime, type World } from "./world";

function itemName(def: string): string {
  return itemDef(def)?.name ?? def;
}

function toast(world: World, rt: PlayerRuntime, text: string): void {
  emit(world, { type: "toast", to: rt.id, text });
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
 * scripted client could `take` from a drop or body in the very tick it appears, before any client
 * has been told it exists. Containers made at world creation (tick 0) are never recorded: a step
 * always runs at tick >= 1.
 */
const bornAt = new WeakMap<World, Map<string, number>>();

function addContainer(world: World, kind: ContainerKind, at: Vec2, label: string, items: ItemDTO[]): ContainerState {
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

/** One crate per crate spot (1-3 items) and one loose item per ground spot. */
export function spawnLoot(world: World): void {
  for (const spot of world.map.crateSpots) {
    const items = rollCrate(world.random).map((def) => ({ uid: world.newItemUid(), def }));
    addContainer(world, "crate", spot, "Crate", items);
  }
  for (const spot of world.map.groundSpots) {
    const def = rollGroundItem(world.random);
    addContainer(world, "ground", spot, itemName(def), [{ uid: world.newItemUid(), def }]);
  }
}

export const handleTake: ActionHandler = (world, p, rt, cmd) => {
  if (cmd.kind !== "take") return;
  const c = world.state.containers.get(cmd.containerId);
  if (!c || bornThisTick(world, c.id)) { toast(world, rt, "Item is gone"); return; }
  if (Math.hypot(p.x - c.x, p.y - c.y) > INTERACT_RANGE) { toast(world, rt, "Too far away"); return; }
  if (!hasLineOfSight(world.map, p, c)) { toast(world, rt, "Can't reach that"); return; }
  const idx = c.items.findIndex((i) => i.uid === cmd.uid);
  if (idx < 0) { toast(world, rt, "Item is gone"); return; }
  if (p.inventory.length >= INVENTORY_SLOTS) { toast(world, rt, "Inventory full"); return; }

  const { uid, def } = c.items[idx]!;
  c.items.splice(idx, 1);
  p.inventory.push(newItem(uid, def));
  // Loose items vanish once picked up; crates and bodies stay as (empty) props.
  if (c.kind === "ground" && c.items.length === 0) world.state.containers.delete(c.id);
};

export const handleDrop: ActionHandler = (world, p, _rt, cmd) => {
  if (cmd.kind !== "drop") return;
  const idx = p.inventory.findIndex((i) => i.uid === cmd.uid);
  if (idx < 0) return;

  const { uid, def } = p.inventory[idx]!;
  p.inventory.splice(idx, 1);
  addContainer(world, "ground", p, itemName(def), [{ uid, def }]);
};

export const handleUse: ActionHandler = (world, p, rt, cmd) => {
  if (cmd.kind !== "use") return;
  const idx = p.inventory.findIndex((i) => i.uid === cmd.uid);
  if (idx < 0) return;

  const itemDefId = p.inventory[idx]!.def;
  const def = itemDef(itemDefId);
  if (def?.kind !== "healing") { toast(world, rt, `Can't use ${itemName(itemDefId)}`); return; }
  if (p.hp >= p.maxHp) { toast(world, rt, "Already at full health"); return; }

  const hp = Math.min(p.maxHp, p.hp + def.heal);
  const healed = hp - p.hp;
  p.hp = hp;
  p.inventory.splice(idx, 1);
  emit(world, { type: "fx", fx: { kind: "heal", id: rt.id, amount: healed } });
};

/** Leaves a lootable body where the player went down, holding everything they carried. */
export function dropBody(world: World, p: PlayerState): void {
  const items = p.inventory.map((i) => ({ uid: i.uid, def: i.def }));
  addContainer(world, "body", p, p.name, items);
  p.inventory.clear();
}

export function install(world: World): void {
  world.actions.take = handleTake;
  world.actions.drop = handleDrop;
  world.actions.use = handleUse;
  world.hooks.dropBody = dropBody;
  spawnLoot(world);
}

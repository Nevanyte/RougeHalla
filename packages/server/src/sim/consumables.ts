import {
  CANNON_COOLDOWN_MS, CONSUMABLE_CAP, CONSUMABLES, HEAL_OVER_TIME_STEP_MS, POTION_HEAL_MS, POTION_LARGE_SHARE,
  POTION_SMALL_SHARE, SPEED_BOOST_MS, SPEED_BOOST_MULT, WIND_EMBLEM_DEF, isConsumableId,
  circleClear, hasLineOfSight, MASK_MOVE, mulberry32, PLAYER_RADIUS, TILE, type ConsumableId, type Vec2,
} from "@raid/shared";
import type { ContainerState } from "@raid/shared/schema";
import { standing, type Combatant } from "./combatant";
import { heal } from "./factions";
import { displace } from "./displace";
import { addContainer, bornThisTick, forgetBirth } from "./loot";
import { recomputeMods } from "./mods";
import { actionBlocked, cannotMove } from "./status";
import { weaponChanged } from "./weapons";
import { chainHook, collisionMap, emit, tieRank, type ActionHandler, type World } from "./world";

type Player = Extract<Combatant, { kind: "player" }>;
interface PotionHot { next: number; left: number; amount: number }
const healing = new WeakMap<World, Map<string, PotionHot>>();
const inventoryKey = (id: ConsumableId) => id;
const windTimers = new WeakMap<World, number>();
const windRandom = new WeakMap<World, () => number>();
export const WIND_SPAWN_MIN_MS = 8000;
export const WIND_SPAWN_MAX_MS = 15000;
export const WIND_EMBLEM_LIMIT = 12;
export const WIND_PICKUP_RADIUS = 30;
const toast = (w: World, to: string, text: string) => emit(w, { type: "toast", to, text });

export function grantConsumable(world: World, c: Player, id: ConsumableId, count = 1): boolean {
  if (!standing(c) || !(count > 0)) return false;
  const key = inventoryKey(id);
  const next = Math.min(CONSUMABLE_CAP, c.s[key] + Math.floor(count));
  if (next <= c.s[key]) return false;
  c.s[key] = next;
  toast(world, c.id, `${CONSUMABLES[id].name} stored · ${CONSUMABLES[id].text}`);
  return true;
}

export function dropConsumable(world: World, at: Vec2, id: ConsumableId): ContainerState {
  return addContainer(world, "consumable", at, CONSUMABLES[id].name, [{ uid: world.newItemUid(), def: id }]);
}

/** Called only after the ordinary authoritative pickup range/line-of-sight checks. */
export function pickConsumable(world: World, c: Player, box: ContainerState): boolean {
  const item = box.items[0];
  if (!item || !isConsumableId(item.def)) return false;
  if (!grantConsumable(world, c, item.def)) { toast(world, c.id, "Consumable bag full (5 of each)"); return true; }
  box.items.splice(0, 1);
  if (box.kind === "consumable" && box.items.length === 0) { world.state.containers.delete(box.id); forgetBirth(world, box.id); }
  return true;
}

export const handleUseConsumable: ActionHandler = (world, c, cmd) => {
  if (cmd.kind !== "useConsumable" || c.kind !== "player" || !standing(c)) return;
  if (actionBlocked(world, c)) { toast(world, c.id, "Can't use an item now"); return; }
  const now = world.state.serverTime;
  if (c.s.healingUntil > now) { toast(world, c.id, "Potion already healing"); return; }
  if (c.s.hp >= c.s.maxHp) { toast(world, c.id, "Already at full health"); return; }
  const large = c.s.potionLarge > 0;
  if (!large && c.s.potionSmall <= 0) { toast(world, c.id, "No potion stored"); return; }
  if (large) c.s.potionLarge--; else c.s.potionSmall--;
  c.s.healingUntil = now + POTION_HEAL_MS;
  const steps = POTION_HEAL_MS / HEAL_OVER_TIME_STEP_MS;
  let list = healing.get(world);
  if (!list) healing.set(world, list = new Map());
  list.set(c.id, { next: now + HEAL_OVER_TIME_STEP_MS, left: steps, amount: c.s.maxHp * (large ? POTION_LARGE_SHARE : POTION_SMALL_SHARE) / steps });
  toast(world, c.id, `${large ? "Camp" : "Small"} potion · healing over 5s`);
};

export function updateConsumables(world: World): void {
  const now = world.state.serverTime;
  updateWindEmblems(world);
  const list = healing.get(world);
  for (const [id, hot] of list ?? []) {
    const p = world.state.players.get(id), rt = world.players.get(id);
    if (!p || !rt || p.status !== "alive" || rt.resolved) { list!.delete(id); if (p) p.healingUntil = 0; continue; }
    while (hot.left > 0 && now >= hot.next) {
      heal(world, { kind: "player", id, s: p, rt }, hot.amount, { ignoreLockout: true });
      hot.left--; hot.next += HEAL_OVER_TIME_STEP_MS;
    }
    if (hot.left <= 0) { p.healingUntil = 0; list!.delete(id); }
  }
  for (const [id, p] of world.state.players) {
    if (p.speedBoostUntil > 0 && (p.speedBoostUntil <= now || p.status !== "alive")) {
      p.speedBoostUntil = 0;
      const rt = world.players.get(id);
      if (rt) recomputeMods(world, { kind: "player", id, s: p, rt });
    }
  }
}

export function useCannon(world: World, c: Player, box: ContainerState): void {
  const now = world.state.serverTime;
  if (world.state.gatesLocked) { toast(world, c.id, "Cannons are sealed during the coliseum fight"); return; }
  if (box.readyAt > now) { toast(world, c.id, `Cannon reloads in ${Math.ceil((box.readyAt - now) / 1000)}s`); return; }
  if (cannotMove(world, c)) { toast(world, c.id, "Can't enter a cannon now"); return; }
  const landing = { x: box.targetX, y: box.targetY };
  if (!circleClear(collisionMap(world), landing, PLAYER_RADIUS)) return;
  box.readyAt = now + CANNON_COOLDOWN_MS;
  c.rt.path = [];
  displace(world, c, landing);
  c.rt.inputs.drain();
  c.rt.weapon.lock = null; c.rt.weapon.attackMoveGoal = null; c.rt.weapon.held = false;
  c.s.attackTarget = "";
  weaponChanged(world, c);
  toast(world, c.id, "Cannon blast! Reloading for 75s");
}

export function spawnTravel(world: World): void {
  if (world.config.training) return;
  const occupied = [...world.state.containers.values(), ...world.map.spawns, ...world.map.spawnPool, ...world.map.camps.flatMap(c => [c, c.chest, ...c.spots])];
  const sameTile = (a: Vec2, b: Vec2) => Math.floor(a.x / TILE) === Math.floor(b.x / TILE) && Math.floor(a.y / TILE) === Math.floor(b.y / TILE);
  const sites: Vec2[] = [];
  for (const region of world.map.regions) {
    const candidates: Vec2[] = [];
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) candidates.push({ x: region.pole.x + dx * TILE, y: region.pole.y + dy * TILE });
    candidates.sort((a, b) => Math.hypot(a.x - region.pole.x, a.y - region.pole.y) - Math.hypot(b.x - region.pole.x, b.y - region.pole.y));
    const at = candidates.find(p => circleClear(world.map, p, PLAYER_RADIUS) && !occupied.some(o => sameTile(o, p)) && !sites.some(o => sameTile(o, p)));
    if (at) sites.push(at);
  }
  if (sites.length >= 2) sites.forEach((at, i) => {
    const target = sites[(i + Math.max(1, Math.floor(sites.length / 2))) % sites.length]!;
    const cannon = addContainer(world, "cannon", at, "Travel cannon · F to blast", []);
    cannon.targetX = target.x; cannon.targetY = target.y;
  });
}

export function install(world: World): void {
  world.actions.useConsumable = handleUseConsumable;
  world.systems.push(updateConsumables);
  world.modSources.push((w, c) => c.kind === "player" && c.s.speedBoostUntil > w.state.serverTime ? { speedMult: SPEED_BOOST_MULT } : null);
  chainHook(world, "fighterOut", (w, id) => { healing.get(w)?.delete(id); const p = w.state.players.get(id); if (p) { p.healingUntil = 0; p.speedBoostUntil = 0; } });
  windRandom.set(world, mulberry32(world.orderSalt ^ 0x6a2c581f));
  spawnTravel(world);
  chainHook(world, "raidStarted", (w) => windTimers.set(w, w.state.serverTime + WIND_SPAWN_MIN_MS + windRandom.get(w)!() * (WIND_SPAWN_MAX_MS - WIND_SPAWN_MIN_MS)));
  windTimers.set(world, world.state.serverTime + WIND_SPAWN_MIN_MS + windRandom.get(world)!() * (WIND_SPAWN_MAX_MS - WIND_SPAWN_MIN_MS));
}

/** Wind emblems have no inventory or interact action: the nearest walker consumes one permanently. */
export function updateWindEmblems(world: World): void {
  if (world.config.training || world.state.phase !== "active") return;
  const now = world.state.serverTime;
  const emblems = [...world.state.containers.values()].filter(c => c.kind === "consumable" && c.items[0]?.def === WIND_EMBLEM_DEF);
  for (const box of emblems) {
    if (bornThisTick(world, box.id)) continue;
    const candidates = [...world.players.entries()].flatMap(([id, rt]) => {
      const p = world.state.players.get(id);
      if (!p || p.status !== "alive" || rt.resolved) return [];
      const distance = Math.hypot(p.x - box.x, p.y - box.y);
      if (distance > WIND_PICKUP_RADIUS || !hasLineOfSight(collisionMap(world), p, box, MASK_MOVE)) return [];
      return [{ id, rt, p, distance }];
    }).sort((a, b) => a.distance - b.distance || tieRank(world, a.id) - tieRank(world, b.id));
    const winner = candidates[0];
    if (!winner) continue;
    winner.p.speedBoostUntil = now + SPEED_BOOST_MS;
    recomputeMods(world, { kind: "player", id: winner.id, s: winner.p, rt: winner.rt });
    world.state.containers.delete(box.id); forgetBirth(world, box.id);
    toast(world, winner.id, "Wind emblem · +50% movement for 5s");
  }
  if (now < (windTimers.get(world) ?? 0)) return;
  windTimers.set(world, now + WIND_SPAWN_MIN_MS + windRandom.get(world)!() * (WIND_SPAWN_MAX_MS - WIND_SPAWN_MIN_MS));
  if (emblems.length >= WIND_EMBLEM_LIMIT) return;
  const map = collisionMap(world);
  let at: Vec2 | undefined;
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = { x: (Math.floor(windRandom.get(world)!() * map.w) + 0.5) * TILE, y: (Math.floor(windRandom.get(world)!() * map.h) + 0.5) * TILE };
    if (circleClear(map, candidate, PLAYER_RADIUS) && !emblems.some(e => Math.hypot(e.x - candidate.x, e.y - candidate.y) < TILE * 3)) { at = candidate; break; }
  }
  if (at) addContainer(world, "consumable", at, "Wind emblem · walk over it", [{ uid: world.newItemUid(), def: WIND_EMBLEM_DEF }]);
}

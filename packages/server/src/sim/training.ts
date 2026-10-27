// Training: the practice room (RoomMode "training", SimConfig.training). One player, Phase 9's setup next to their spawn (dummies
// that never die and a rack of every weapon: sim/mobs.ts spawnTraining, switched on by SimConfig.dummies), and none of the
// run's consequences: there is no patience timer, teleport or sudden death, no result, no GV and nothing recorded on the
// profile. Whoever goes down is put back on their feet. Everything here sits behind the flag: an arena world never reaches it.
//
// The practice console (the `train` message, roguelike R4a/R5): set a buff's stacks or a passive's rank, spawn a practice camp,
// drop a reward chest with chosen options, or clear all of it. It is refused at the door outside training
// (inputs.ts enqueueClientMessage), only installed here (a world without installTraining has no `train` handler) and checked
// again in the handler. It changes the player through the same paths a kill or a pick does (grantBuff, build + recomputeMods +
// syncMaxHp, placeMob, dropRewardChest), and none of it is paid or recorded: a practice mob has no camp in the map, so no chest
// drops for its death, and its kill pays no GV, feed, buff or drop (mobLife.payMobKill returns in a training world).
import {
  buffDef, buffText, circleClear, hasLineOfSight, isFactionId, isRegionalKind, mobTypeById, PLAYER_RADIUS, rollChestOptions, skillDef,
  skillLive, skillText, stacksIn, TILE, tileToWorldCenter, TRAIN_CAMP_SIZE, TRAIN_MAX_CHESTS, TRAIN_MAX_MOBS, TRAIN_MAX_MOBS_SPAWNED,
  TRAIN_SPAWN_GAP_MS, worldToTile, type BuffId, type SkillId, type Vec2,
} from "@raid/shared";
import { grantBuff, syncMaxHp } from "./buffs";
import { clearChests, dropRewardChest, rewardChests } from "./chests";
import { standing, type Combatant } from "./combatant";
import { placeMob } from "./mobLife";
import { recomputeMods } from "./mods";
import { planPath } from "./movement";
import { clearProjectilesOf } from "./projectiles";
import { chainHook, collisionMap, emit, type ActionHandler, type PlayerRuntime, type World } from "./world";
import { resetWeapons } from "./weapons";

type PlayerCombatant = Extract<Combatant, { kind: "player" }>;

/**
 * Switches a freshly created world to training. The room calls this right after createGameWorld, and passes
 * `{ dummies: true, training: true }` in the config so the training setup is placed when the run starts.
 */
export function installTraining(world: World): void {
  world.state.training = true;
  world.actions.train = handleTrain;
  // A fighter keeps their weapons when they go down: they are revived at once, not looted.
  world.hooks.dropBody = () => {};
  // beginRun arms the patience timer; nothing here ever teleports, so show none.
  chainHook(world, "raidStarted", (w) => {
    w.state.patienceEndsAt = 0;
  });
}

/**
 * Replaces the end of an active tick (sudden death and settle) in a training world. Nobody's run is settled here, so no
 * result is sent and nothing is banked (the Room refuses a `resolved` event in training in any case: a down between ticks
 * still emits one). Whoever is down, whether it happened this tick (a shield dummy's reflected arrow can hurt its shooter)
 * or between ticks, is revived at full health where they fell. A player removed from the world (MIA) is simply gone.
 */
export function trainingSettle(world: World): void {
  const a = world.arena;
  a.downedThisTick = [];
  a.downsBetweenTicks = 0;
  for (const [id, p] of world.state.players) {
    if (p.status !== "dead") continue;
    const rt = world.players.get(id);
    if (!rt) continue;
    rt.down = null;
    rt.resolved = false;
    rt.killedBy = null;
    rt.lastHit = null;
    rt.path = [];
    p.status = "alive";
    p.hp = p.maxHp;
    resetWeapons({ kind: "player", id: rt.id, s: p, rt });
  }
}

// ============================================================================================ the practice console

/** MobState.camp values the console gives its practice camps (the mobs of one camp share one, so camp-wide aggro, D24, pulls them together). */
export const PRACTICE_CAMP_FIRST = 101;
export const PRACTICE_CAMP_LAST = 255;

/** Where a practice camp's centre goes: tiles from the player, the ring's middle, and how far its other members stand from it. */
const CAMP_MIN_TILES = 5;
const CAMP_MAX_TILES = 9;
const CAMP_TARGET_TILES = 7;
const CAMP_SPREAD_TILES = 2;
/**
 * A chest drops this many tiles away: inside CHEST_RANGE (3 tiles) and the panel's opening range (CHEST_RANGE minus its slack),
 * so it can be picked at once without walking up to it.
 */
const CHEST_MIN_TILES = 1.5;
const CHEST_MAX_TILES = 3;
const CHEST_TARGET_TILES = 2;

interface PracticeRuntime {
  /** Practice mobs placed in this room so far (the fx roster only grows, so the total is bounded: TRAIN_MAX_MOBS_SPAWNED). */
  spawned: number;
  /** Server ms of the last camp and of the last chest (each TRAIN_SPAWN_GAP_MS apart at least). */
  lastCampAt: number;
  lastChestAt: number;
  /** The camp number the next practice camp takes (PRACTICE_CAMP_FIRST..PRACTICE_CAMP_LAST, wrapping, skipping any still in use). */
  nextCamp: number;
}
const practice = new WeakMap<World, PracticeRuntime>();

function practiceOf(world: World): PracticeRuntime {
  let r = practice.get(world);
  if (!r) practice.set(world, (r = { spawned: 0, lastCampAt: -Infinity, lastChestAt: -Infinity, nextCamp: PRACTICE_CAMP_FIRST }));
  return r;
}

function toast(world: World, to: string, text: string): void {
  emit(world, { type: "toast", to, text });
}

const one = (n: number): string => String(Math.round(n * 10) / 10);

/** The training room's `train` action (installTraining registers it; an arena world never has one). */
export const handleTrain: ActionHandler = (world, c, cmd) => {
  if (cmd.kind !== "train" || c.kind !== "player" || !world.config.training || !standing(c)) return;
  switch (cmd.cmd) {
    case "buff": trainBuff(world, c, cmd.id, cmd.amount); return;
    case "passive": trainPassive(world, c, cmd.id, cmd.rank); return;
    case "camp": trainCamp(world, c, cmd.id); return;
    case "chest": trainChest(world, c, cmd.options); return;
    case "clear": trainClear(world, c); return;
  }
};

/** Re-arms the once-per-run triggers whose key starts with `prefix` (a removed buff or passive fires again when given back). */
function rearm(rt: PlayerRuntime, prefix: string): void {
  if (!rt.fired) return;
  for (const key of [...rt.fired]) if (key.startsWith(prefix)) rt.fired.delete(key);
}

/** Sets the stacks of one buff: a rise goes through grantBuff (its `buff` fx and toast), a fall or a removal re-folds the rows by hand. */
function trainBuff(world: World, c: PlayerCombatant, id: BuffId, amount: number): void {
  const p = c.s;
  const def = buffDef(id);
  const held = stacksIn(p.buffs, id);
  if (amount > held) {
    grantBuff(world, p, c.rt, id, amount - held);
  } else if (amount < held) {
    if (amount > 0) p.buffs.set(id, amount);
    else {
      p.buffs.delete(id);
      rearm(c.rt, `${id}:`);
    }
    recomputeMods(world, c);
    syncMaxHp(p);
  }
  const name = def?.name ?? id;
  const note = def?.needs === "status" ? " (needs the status system: not applied yet)" : "";
  toast(world, c.id, amount > 0 ? `${name} ${one(amount)} stacks: ${buffText(id, amount)}${note}` : `${name} removed`);
}

/** Sets one passive's rank (0 removes it) the way a chest pick does: the build, the rows re-folded, max hp following. */
function trainPassive(world: World, c: PlayerCombatant, id: SkillId, rank: 0 | 1 | 2): void {
  const p = c.s;
  const def = skillDef(id)!;
  if (rank === 0) {
    p.build.delete(id);
    rearm(c.rt, `skill:${id}:`);
  } else {
    p.build.set(id, rank);
  }
  recomputeMods(world, c);
  syncMaxHp(p);
  const note = skillLive(def) ? "" : " (not live yet: no effect)";
  toast(world, c.id, rank > 0 ? `${def.name} rank ${rank}: ${skillText(id, rank, p.faction)}${note}` : `${def.name} removed`);
}

/** One number per tile, so a set of claimed tiles needs no strings (the stride keeps columns from wrapping into rows). */
const tileKey = (v: Vec2): number => worldToTile(v.y) * 65536 + worldToTile(v.x);

/** The tiles a practice drop must not land on: every player, mob and container is on one. */
function occupiedTiles(world: World): Set<number> {
  const taken = new Set<number>();
  for (const p of world.state.players.values()) taken.add(tileKey(p));
  for (const m of world.state.mobs.values()) taken.add(tileKey(m));
  for (const b of world.state.containers.values()) taken.add(tileKey(b));
  return taken;
}

/**
 * Free floor tile centres between `minTiles` and `maxTiles` from `from` (a body fits and nothing stands there), the ones
 * nearest `targetTiles` first (ties: row, then column: Array.sort is stable), so the layout depends only on the map and what stands.
 */
function floorTilesAround(
  world: World, from: Vec2, minTiles: number, maxTiles: number, targetTiles: number, taken: ReadonlySet<number>,
): Vec2[] {
  const map = collisionMap(world);
  const out: Array<{ at: Vec2; off: number }> = [];
  const tx0 = worldToTile(from.x);
  const ty0 = worldToTile(from.y);
  const reach = Math.ceil(maxTiles);
  for (let ty = ty0 - reach; ty <= ty0 + reach; ty++) {
    for (let tx = tx0 - reach; tx <= tx0 + reach; tx++) {
      if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) continue;
      const at = { x: tileToWorldCenter(tx), y: tileToWorldCenter(ty) };
      const d = Math.hypot(at.x - from.x, at.y - from.y) / TILE;
      if (d < minTiles || d > maxTiles) continue;
      if (taken.has(tileKey(at)) || !circleClear(map, at, PLAYER_RADIUS)) continue;
      out.push({ at, off: Math.abs(d - targetTiles) });
    }
  }
  return out.sort((a, b) => a.off - b.off).map((e) => e.at);
}

/**
 * Where a practice camp of `count` stands: its centre a free tile about CAMP_TARGET_TILES from `from` that `from` can see and walk to
 * (else one it can only walk to), then the free tiles nearest the centre. Fewer than `count` spots when the floor is crowded; none
 * when there is no centre.
 */
function campSpots(world: World, from: Vec2, count: number): Vec2[] {
  const map = collisionMap(world);
  const taken = occupiedTiles(world);
  const ring = floorTilesAround(world, from, CAMP_MIN_TILES, CAMP_MAX_TILES, CAMP_TARGET_TILES, taken);
  const walkable = new Map<number, boolean>();
  const canWalkTo = (at: Vec2): boolean => {
    const k = tileKey(at);
    let ok = walkable.get(k);
    if (ok === undefined) walkable.set(k, (ok = planPath(world, from, at).length > 0));
    return ok;
  };
  const centre = ring.find((t) => hasLineOfSight(map, from, t) && canWalkTo(t)) ?? ring.find(canWalkTo);
  if (!centre) return [];
  if (count <= 1) return [centre];
  taken.add(tileKey(centre));
  return [centre, ...floorTilesAround(world, centre, 1, CAMP_SPREAD_TILES, 1, taken).slice(0, count - 1)];
}

/** The practice camp number for the next camp: the next free one of PRACTICE_CAMP_FIRST..PRACTICE_CAMP_LAST, wrapping. */
function nextCampRef(world: World, run: PracticeRuntime): number {
  const used = new Set<number>();
  for (const m of world.state.mobs.values()) if (m.camp >= PRACTICE_CAMP_FIRST) used.add(m.camp);
  const span = PRACTICE_CAMP_LAST - PRACTICE_CAMP_FIRST + 1;
  for (let i = 0; i < span; i++) {
    const ref = PRACTICE_CAMP_FIRST + ((run.nextCamp - PRACTICE_CAMP_FIRST + i) % span);
    if (!used.has(ref)) {
      run.nextCamp = ref + 1 > PRACTICE_CAMP_LAST ? PRACTICE_CAMP_FIRST : ref + 1;
      return ref;
    }
  }
  return PRACTICE_CAMP_FIRST;
}

/** The regional mobs in the room: all of them are the console's (a training world places none of its own). Dead ones are not counted. */
function practiceMobIds(world: World, opts: { alive?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const [id, m] of world.state.mobs) if (isRegionalKind(m.kind) && (!opts.alive || m.status === "alive")) out.push(id);
  return out;
}

/** A camp (or a chest) may be dropped now: not within TRAIN_SPAWN_GAP_MS of the last camp (chest). Says so to the player when not. */
function dropAllowed(world: World, c: PlayerCombatant, lastAt: number): boolean {
  if (world.state.serverTime - lastAt >= TRAIN_SPAWN_GAP_MS) return true;
  toast(world, c.id, "Slow down");
  return false;
}

/** A practice camp: TRAIN_CAMP_SIZE mobs of the type (a lone elite for an elite type), asleep on free floor near the player. */
function trainCamp(world: World, c: PlayerCombatant, typeId: string): void {
  const type = mobTypeById(typeId);
  if (!type) return;
  const run = practiceOf(world);
  if (!dropAllowed(world, c, run.lastCampAt)) return;
  const size = type.elite ? 1 : TRAIN_CAMP_SIZE;
  if (practiceMobIds(world, { alive: true }).length + size > TRAIN_MAX_MOBS) {
    toast(world, c.id, `At most ${TRAIN_MAX_MOBS} practice mobs at once: clear some first`);
    return;
  }
  if (run.spawned + size > TRAIN_MAX_MOBS_SPAWNED) {
    toast(world, c.id, "This practice room has spawned its share of mobs: leave and come back");
    return;
  }
  const spots = campSpots(world, c.s, size);
  if (spots.length === 0) {
    toast(world, c.id, "No free floor near you for a camp");
    return;
  }
  const ref = nextCampRef(world, run);
  for (const at of spots) {
    placeMob(world, {
      region: type.zone, elite: type.elite, type: type.id, camp: ref - 1, at, facing: Math.atan2(c.s.y - at.y, c.s.x - at.x),
    });
  }
  run.spawned += spots.length;
  run.lastCampAt = world.state.serverTime;
  toast(world, c.id, `Practice camp: ${spots.length} x ${type.name}${type.elite ? " (elite)" : ""}`);
}

/** A reward chest about two tiles from the player, in view, with `options` (empty: three random live skills for the player's faction). */
function trainChest(world: World, c: PlayerCombatant, options: readonly SkillId[]): void {
  const run = practiceOf(world);
  if (!dropAllowed(world, c, run.lastChestAt)) return;
  if (rewardChests(world).length >= TRAIN_MAX_CHESTS) {
    toast(world, c.id, `At most ${TRAIN_MAX_CHESTS} chests at once: wait for them to expire or clear them`);
    return;
  }
  const map = collisionMap(world);
  const at = floorTilesAround(world, c.s, CHEST_MIN_TILES, CHEST_MAX_TILES, CHEST_TARGET_TILES, occupiedTiles(world))
    .find((t) => hasLineOfSight(map, c.s, t));
  if (!at) {
    toast(world, c.id, "No free floor in view for a chest");
    return;
  }
  const faction = isFactionId(c.s.faction) ? c.s.faction : "fire";
  const ids: readonly SkillId[] = options.length > 0 ? options : rollChestOptions(world.rewardRandom, { zone: faction });
  dropRewardChest(world, at, ids);
  run.lastChestAt = world.state.serverTime;
  const names = ids.map((id) => `${skillDef(id)?.name ?? id}${skillLive(id) ? "" : " (not live yet)"}`);
  toast(world, c.id, `Chest: ${names.join(", ")}`);
}

/** Removes every buff and passive the player holds, every practice mob and every reward chest; once-per-run triggers fire again. */
function trainClear(world: World, c: PlayerCombatant): void {
  const p = c.s;
  p.buffs.clear();
  p.build.clear();
  c.rt.fired?.clear();
  c.rt.hots = undefined;
  recomputeMods(world, c);
  syncMaxHp(p);
  const gone = practiceMobIds(world);
  // Their arrows and balls in the air go with them: an owner outliving its shot is the arena's rule, not a practice room's.
  clearProjectilesOf(world, new Set(gone), "cleared");
  for (const id of gone) {
    world.state.mobs.delete(id);
    world.mobs.delete(id);
  }
  clearChests(world);
  toast(world, c.id, "Cleared: buffs, passives, practice mobs and chests");
}

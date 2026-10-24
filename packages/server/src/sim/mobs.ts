// Mobs: neutral fighters in state.mobs that fight through the same combat code as players (sim/combatant.ts). Phase 9
// has only training dummies: no AI, no faction (so no armor or shield), never die, and heal back to full
// DUMMY_RESET_SECONDS after the last hit. With SimConfig.dummies the run starts with a training setup next to every
// player's spawn (spawnTraining). Phase 11 adds regional mobs (AI, drops, GV) here.
import {
  circleClear, DUMMY_HP, DUMMY_RESET_SECONDS, hasLineOfSight, PLAYER_RADIUS, TILE, tileToWorldCenter, WEAPON_IDS,
  worldToTile, type GameMap, type Vec2, type WeaponId,
} from "@raid/shared";
import { MobState } from "@raid/shared/schema";
import type { Combatant } from "./combatant";
import { InputQueue } from "./inputs";
import { dropWeapon } from "./loot";
import { planPath } from "./movement";
import { chainHook, collisionMap, newWeaponRuntime, nextId, type World } from "./world";

export interface MobSpec {
  /** A training dummy, or a regional mob / elite (sim/mobLife.ts). */
  kind: "dummy" | "mob" | "elite";
  name: string;
  /** A FactionId (a regional mob's region); omitted for a dummy, which has none. */
  faction?: string;
  at: Vec2;
  /** Where it faces (a shield dummy blocks from that side). */
  facing?: number;
  hp?: number;
  /** In hand; a dummy never attacks, but a shield in hand still blocks and reflects. */
  weapon?: WeaponId;
}

/** Adds a mob to the state and its runtime; returns its id. */
export function addMob(world: World, spec: MobSpec): string {
  const id = nextId(world, "mob");
  const m = new MobState();
  m.kind = spec.kind;
  m.name = spec.name;
  m.faction = spec.faction ?? "";
  m.x = spec.at.x;
  m.y = spec.at.y;
  m.facing = spec.facing ?? 0;
  m.hp = m.maxHp = spec.hp ?? DUMMY_HP;
  m.status = "alive";
  m.weapon0 = spec.weapon ?? "";
  world.state.mobs.set(id, m);
  world.mobs.set(id, {
    id, inputs: new InputQueue(), path: [], history: [{ t: world.state.serverTime, x: m.x, y: m.y }],
    weapon: newWeaponRuntime(), lastHitAt: 0,
  });
  return id;
}

/**
 * The ledger's way down for a mob: `amounts` (already mitigated) land at once. A dummy can't die: a hit that would
 * empty it refills it. Returns the hp the hits were worth.
 */
export function damageMob(world: World, c: Extract<Combatant, { kind: "mob" }>, amounts: readonly number[]): number {
  let total = 0;
  for (const a of amounts) if (a > 0) total += a;
  if (!(total > 0) || c.s.status !== "alive") return 0;
  c.rt.lastHitAt = world.state.serverTime;
  c.s.hp -= total;
  if (c.s.hp <= 0) c.s.hp = c.s.maxHp;
  return total;
}

/** System: dummies left alone for DUMMY_RESET_SECONDS heal back to full. */
export function resetDummies(world: World): void {
  const now = world.state.serverTime;
  for (const [id, m] of world.state.mobs) {
    const rt = world.mobs.get(id);
    if (!rt || m.kind !== "dummy" || m.hp >= m.maxHp) continue;
    if (now - rt.lastHitAt >= DUMMY_RESET_SECONDS * 1000) m.hp = m.maxHp;
  }
}

/** The training setup sits this many tiles (centre to centre) from the spawn: near enough to walk to, far enough to shoot at. */
const TRAINING_MIN_TILES = 3;
const TRAINING_MAX_TILES = 6;

/** One number per tile, so a set of claimed tiles needs no strings (the stride keeps columns from wrapping into rows). */
const tileKey = (v: Vec2): number => worldToTile(v.y) * 65536 + worldToTile(v.x);

/** Free floor tile centres in the training band around `from` that nothing has claimed yet, nearest first (ties: row, then column). */
function trainingTiles(map: GameMap, from: Vec2, taken: ReadonlySet<number>): Vec2[] {
  const out: Array<{ at: Vec2; d: number }> = [];
  const tx0 = worldToTile(from.x);
  const ty0 = worldToTile(from.y);
  for (let ty = ty0 - TRAINING_MAX_TILES; ty <= ty0 + TRAINING_MAX_TILES; ty++) {
    for (let tx = tx0 - TRAINING_MAX_TILES; tx <= tx0 + TRAINING_MAX_TILES; tx++) {
      if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) continue;
      const at = { x: tileToWorldCenter(tx), y: tileToWorldCenter(ty) };
      const d = Math.hypot(at.x - from.x, at.y - from.y) / TILE;
      if (d < TRAINING_MIN_TILES || d > TRAINING_MAX_TILES) continue;
      if (taken.has(tileKey(at)) || !circleClear(map, at, PLAYER_RADIUS)) continue;
      out.push({ at, d });
    }
  }
  // Array.sort is stable, so equal distances keep the row-major scan order: the layout depends only on the map.
  return out.sort((a, b) => a.d - b.d).map((e) => e.at);
}

/**
 * The training setup (SimConfig.dummies), placed when the run starts next to each player's spawn on free floor reachable
 * from it: a plain dummy, a dummy holding a shield that faces the spawn (arrows from the player reflect, sword hits are
 * riposted), and a rack of one loose weapon of every type, in a row when the floor allows. Spawns, players, containers
 * and mobs already there keep their tiles, and so does every piece placed here, so setups never overlap. A piece that
 * finds no tile is skipped. Deterministic for a map and a player order (it draws nothing from world.random).
 */
export function spawnTraining(world: World): void {
  const map = collisionMap(world);
  const taken = new Set<number>();
  for (const s of world.map.spawns) taken.add(tileKey(s));
  for (const p of world.state.players.values()) taken.add(tileKey(p));
  for (const c of world.state.containers.values()) taken.add(tileKey(c));
  for (const m of world.state.mobs.values()) taken.add(tileKey(m));

  for (const p of world.state.players.values()) {
    const from = { x: p.x, y: p.y };
    const tiles = trainingTiles(map, from, taken);
    const reachable = new Map<number, boolean>();
    const canWalkTo = (at: Vec2): boolean => {
      const k = tileKey(at);
      let ok = reachable.get(k);
      if (ok === undefined) reachable.set(k, (ok = planPath(world, from, at).length > 0));
      return ok;
    };
    const claim = (at: Vec2): Vec2 => { taken.add(tileKey(at)); return at; };
    const nearest = (accept: (at: Vec2) => boolean): Vec2 | null => {
      const at = tiles.find((t) => !taken.has(tileKey(t)) && canWalkTo(t) && accept(t));
      return at ? claim(at) : null;
    };

    // A dummy is for shooting at, so it prefers a tile the spawn can see; a spawn boxed in by ruins takes one around the corner.
    const visible = (at: Vec2): boolean => hasLineOfSight(map, from, at);
    const dummySpot = (): Vec2 | null => nearest(visible) ?? nearest(() => true);
    const facing = (at: Vec2): number => Math.atan2(from.y - at.y, from.x - at.x);
    const plain = dummySpot();
    if (plain) addMob(world, { kind: "dummy", name: "Dummy", at: plain, facing: facing(plain) });
    const shield = dummySpot();
    if (shield) addMob(world, { kind: "dummy", name: "Shield dummy", at: shield, facing: facing(shield), weapon: "shield" });

    const row = rackRow(tiles, taken, canWalkTo);
    row?.forEach(claim);
    const spots = row ?? WEAPON_IDS.map(() => nearest(() => true));
    WEAPON_IDS.forEach((def, i) => {
      const at = spots[i];
      if (at) dropWeapon(world, at, def);
    });
  }
}

/** Five free, walkable tiles side by side (a row, else a column) from the nearest start that has them, or null. */
function rackRow(tiles: readonly Vec2[], taken: ReadonlySet<number>, canWalkTo: (at: Vec2) => boolean): Vec2[] | null {
  const open = new Map<number, Vec2>();
  for (const t of tiles) if (!taken.has(tileKey(t))) open.set(tileKey(t), t);
  for (const start of tiles) {
    for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
      const row = WEAPON_IDS.map((_, i) => open.get(tileKey({ x: start.x + dx * i * TILE, y: start.y + dy * i * TILE })));
      if (row.every((at): at is Vec2 => at !== undefined && canWalkTo(at))) return row;
    }
  }
  return null;
}

export function install(world: World): void {
  world.systems.push(resetDummies);
  if (world.config.dummies) chainHook(world, "raidStarted", spawnTraining);
}

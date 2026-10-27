// Map contract. `generateMap(seed, attempt)` in mapgen.ts must produce identical output on client and server.
import { TILE } from "./constants";
import type { FactionId } from "./factions";
import type { Vec2 } from "./messages";
import type { WeaponId } from "./weapons";

// Collision classes: distinct bits, FLOOR is the only walkable class (every nonzero class blocks movement). Grow by the
// next free bit (4, 8, ...), never renumber: generator output, tests and the client's art key on these codes.
export const TILE_FLOOR = 0;
/** Blocks movement, sight, projectiles and melee. */
export const TILE_WALL = 1;
/** Blocks movement only (lava, fence, crevasse: which one is `GameMap.terrain`). See through, shoot over. */
export const TILE_LOW = 2;

// What stops each kind of query: a tile blocks it when `(tiles[i] & mask) !== 0`, and out of bounds blocks every query.
// Each query names its mask; nothing else is ever read for sight or movement.
/** Eyes, projectiles in flight, spell LOS, the reach of ranged signatures. */
export const MASK_SIGHT = TILE_WALL;
/** Bodies: A*, discs and sweeps, placement, pickup reach. 0xff, so a future class blocks walkers by default. */
export const MASK_MOVE = 0xff;
/** A melee swing's reach (and the signature reach and lock "clear" of arc weapons). One constant: set to MASK_SIGHT if fences should not stop swings. */
export const MASK_MELEE = TILE_WALL | TILE_LOW;

/** Inclusive-exclusive tile rect: covers tx in [x, x+w), ty in [y, y+h). */
export interface TileRect { x: number; y: number; w: number; h: number }

/** A tile coordinate (not world units). */
export interface TilePt { x: number; y: number }

/** The faction regions, in the same order as FACTION_IDS in factions.ts. */
export const REGION_FACTIONS = ["fire", "sentenced", "plague", "frost", "holy"] as const;
export type RegionFaction = (typeof REGION_FACTIONS)[number];
export type RegionId = RegionFaction | "coliseum" | "none";

export type RegionWeapon = WeaponId;

/**
 * The weapon a region's mobs carry by default: what a mob placed without a type holds, and one of the two or three weapons the
 * zone's 30-type roster drops (each MobTypeDef in mobs.ts carries its own, so every weapon is farmable in at least two zones).
 * Independent of the factions' signature start weapons.
 */
export const REGION_WEAPONS: Readonly<Record<RegionFaction, RegionWeapon>> = {
  fire: "axe",
  sentenced: "sword",
  plague: "bow",
  frost: "shield",
  holy: "wand",
};

/**
 * `GameMap.regionGrid` stores an index into this table per tile. "none" is 0 so a zeroed grid is
 * valid, and the faction codes are 1..5 in REGION_FACTIONS order.
 */
export const REGION_IDS: readonly RegionId[] = ["none", ...REGION_FACTIONS, "coliseum"];
export const REGION_NONE = 0;
export const REGION_COLISEUM = REGION_IDS.length - 1;

export function regionCode(id: RegionId): number {
  return REGION_IDS.indexOf(id);
}

export type GateSide = "n" | "e" | "s" | "w";

export interface GateDef {
  side: GateSide;
  /**
   * The wall-ring tiles this gate opens, in order along the wall. They are floor in `map.tiles` and
   * wall in `withGates(map).tiles`; nothing else differs between the two.
   */
  tiles: TilePt[];
  /** World centre of the opening. */
  x: number;
  y: number;
}

export interface ColiseumDef {
  /** Bounding box of the footprint, wall ring included. Every footprint tile has region "coliseum". */
  rect: TileRect;
  /** World centre of the arena floor (a floor tile centre). */
  centre: Vec2;
  /**
   * One gate per side, in n, e, s, w order. With the gates open they are the only links between the
   * coliseum floor and the rest of the map; with them closed the coliseum floor is sealed off.
   */
  gates: GateDef[];
  /**
   * Teleport destinations: at least MAX_PLAYERS distinct floor tile centres inside the coliseum, each
   * with a clear 3x3 around it, mutually spread out and reachable from `centre` with the gates closed.
   */
  innerSpawns: Vec2[];
}

/** The pre-roguelike view of a camp, derived from its CampDef (`regions[].mobCamps`); kept until its consumers move to `camps`. */
export interface MobCampDef {
  /** Unique across the map, e.g. "fire-1". */
  id: string;
  region: RegionFaction;
  /** World centre (a floor tile centre). */
  x: number;
  y: number;
  /** Clearing radius in world units: every tile whose centre lies within `r` of (x, y) is floor in the camp's region. */
  r: number;
  /** Rest positions, one per mob: distinct floor tile centres inside the clearing. */
  spots: Vec2[];
  /** Exactly one camp per region is elite (its CampDef has an eliteSpot). */
  elite: boolean;
  /** The region's default weapon (REGION_WEAPONS[region]); what a mob carries is its TYPE's weapon (mobs.ts MobTypeDef.weapon). */
  weapon: RegionWeapon;
}

/**
 * A camp (ROGUELIKE_PLAN 3.2). Four per zone, one of them elite; camp centres are at least 9 tiles apart map-wide. The
 * camp sits at the pole of its territory (`territoryGrid`), the part of its zone nearer to it than to the zone's other
 * camps by path cost; the territory is the leash area.
 */
export interface CampDef {
  /** "fire-1": the zone, then 1-based index. `GameMap.camps` is in REGION_FACTIONS order, then camp index. */
  id: string;
  zone: FactionId;
  /** World centre of the camp site (a floor tile centre): also the chest tile. */
  x: number;
  y: number;
  /** Clearing radius in world units: every tile whose centre lies within `r` of (x, y) is floor in the camp's territory. */
  r: number;
  /** 3-5 mob rest positions, distinct floor tile centres in the clearing, never the chest tile. */
  spots: Vec2[];
  /** -1, or the index in `spots` of the elite's rest position: 0 on the zone's elite camp (the spot nearest the centre). */
  eliteSpot: number;
  /** The reward chest's tile centre: the clearing's centre tile, which no spot takes. */
  chest: Vec2;
  /** Floor tiles of the camp's territory. */
  area: number;
  /** Farthest territory floor tile from the camp centre, in world units (at most TERRITORY_RADIUS_MAX tiles): the leash is min(radius, 12 tiles). */
  radius: number;
}

export interface FactionRegionDef {
  id: RegionFaction;
  /**
   * The zone's pole: its walkable floor tile outside ruins farthest (by a 5/7 chamfer) from every other zone, the border
   * and the coliseum. A floor tile centre, for the zone's label.
   */
  pole: Vec2;
  /** Painted tiles of the zone (floor, low ground and walls alike); the five are equal within 8 tiles. */
  area: number;
  /** View of `GameMap.spawnPool`: the members in this zone, in pool order. */
  spawns: Vec2[];
  /** Weapon crate spots of the zone (floor tile centres against a wall), 3-4 per zone. */
  chestSpots: Vec2[];
  /** View of `GameMap.camps`: this zone's camps as MobCampDefs, in camp order. */
  mobCamps: MobCampDef[];
}

/** Cosmetic decor, never read by the sim. `kind` indexes PROP_KINDS (terrain.ts), `v` is the art variant 0..255. */
export interface MapProp {
  kind: number;
  /** World position of the anchor. */
  x: number;
  y: number;
  v: number;
}

export interface GameMap {
  seed: number;
  /** Size in tiles. */
  w: number;
  h: number;
  /**
   * Row-major, length w*h, TILE_FLOOR / TILE_WALL / TILE_LOW. Border is always wall. Gates are open (floor) here. Every
   * query names its mask: walkable is TILE_FLOOR (MASK_MOVE), sight-blocking is TILE_WALL (MASK_SIGHT).
   */
  tiles: Uint8Array;
  /**
   * Row-major, length w*h, an index into TERRAINS (terrain.ts) per tile: 0 = none. A floor kind (ember, bog, ice, light)
   * sits on floor, a LOW kind (lava, fence, crevasse) on LOW, or on a wall standing in that feature (decor only).
   * A hand-built map (mapFromTiles) is all zero, and so is a generated one while no zone styler ships.
   */
  terrain: Uint8Array;
  /** Decor sprites (cosmetic). Empty on hand-built maps and while the zone stylers are off. */
  props: MapProp[];
  /**
   * Row-major, length w*h, a REGION_IDS index per tile. On a generated map every tile off the border ring is in a
   * faction zone or the coliseum, and "none" marks only the border ring. A hand-built map (mapFromTiles) is "none"
   * throughout.
   */
  regionGrid: Uint8Array;
  /**
   * The certified generator attempt this map was built from (the one `generateMap` accepted; later phases hand
   * (seed, attempt) to clients so both run exactly one attempt). 0 for a hand-built map.
   */
  attempt: number;
  /**
   * Row-major, length w*h: 0 = no camp territory, else 1 + the camp's index in `camps`. On a generated map the
   * territories of a zone partition every one of its painted tiles, and each territory's floor is one 4-connected piece
   * holding its camp's clearing, spots and chest. All 0 on hand-built maps.
   */
  territoryGrid: Uint8Array;
  coliseum: ColiseumDef;
  /** One entry per faction, in REGION_FACTIONS order (not map order). Empty on hand-built maps. */
  regions: FactionRegionDef[];
  /** Every camp of the map, in REGION_FACTIONS order, then camp index. Empty on hand-built maps. `regions[].mobCamps` stays as a view. */
  camps: CampDef[];
  /**
   * Candidate player starts, 24-32 tile centres with a clear 3x3 of floor, each tagged with its zone: all within 8% of
   * one walking distance to the coliseum centre, at least 5 tiles apart and from every camp centre, and screened so no
   * member can shoot another within MAX_SIGHT_CORRIDOR.
   */
  spawnPool: { x: number; y: number; zone: FactionId }[];
  /** Ruins (footprints including their walls), for floor shading and loot placement. */
  buildings: TileRect[];
  /** View of `spawnPool`: the members interleaved zone by zone (REGION_FACTIONS order), so the first five are in five zones when every zone has one. */
  spawns: Vec2[];
  /** Weapon crate spots: every region's `chestSpots`, flattened in REGION_FACTIONS order. */
  crateSpots: Vec2[];
  /** Scattered weapon spots on open floor outside ruins, camp clearings and the coliseum. */
  groundSpots: Vec2[];
}

export function tileIndex(map: GameMap, tx: number, ty: number): number {
  return ty * map.w + tx;
}

/** Does the tile stop a query with this mask? Out of bounds blocks every query. */
export function blocksTile(map: GameMap, tx: number, ty: number, mask: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true;
  return (map.tiles[ty * map.w + tx] & mask) !== 0;
}

/**
 * OPAQUE: the tile blocks sight (TILE_WALL; LOW is see-through). The name is kept but it no longer means "solid":
 * movement code asks `isSolidTile`, a swing's reach asks `blocksTile` with `reachMask`. Out of bounds counts as wall.
 */
export function isWallTile(map: GameMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true;
  return (map.tiles[ty * map.w + tx] & MASK_SIGHT) !== 0;
}

/** Opaque at a world point (see isWallTile). */
export function isWallAt(map: GameMap, x: number, y: number): boolean {
  return isWallTile(map, worldToTile(x), worldToTile(y));
}

/** SOLID: the tile blocks movement (any class but TILE_FLOOR). Out of bounds counts as solid. */
export function isSolidTile(map: GameMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true;
  return (map.tiles[ty * map.w + tx] & MASK_MOVE) !== 0;
}

/** Solid at a world point (see isSolidTile). */
export function isSolidAt(map: GameMap, x: number, y: number): boolean {
  return isSolidTile(map, worldToTile(x), worldToTile(y));
}

export function worldToTile(v: number): number {
  return Math.floor(v / TILE);
}

export function tileToWorldCenter(t: number): number {
  return t * TILE + TILE / 2;
}

/** Out-of-bounds counts as "none". */
export function regionAtTile(map: GameMap, tx: number, ty: number): RegionId {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return "none";
  return REGION_IDS[map.regionGrid[ty * map.w + tx]] ?? "none";
}

export function regionAt(map: GameMap, x: number, y: number): RegionId {
  return regionAtTile(map, worldToTile(x), worldToTile(y));
}

/** In the coliseum footprint (its floor, wall ring or a gate). */
export function inColiseum(map: GameMap, x: number, y: number): boolean {
  return regionAt(map, x, y) === "coliseum";
}

const locked = new WeakMap<GameMap, GameMap>();
const lockedMaps = new WeakSet<GameMap>();

/**
 * The same map with every gate tile turned to wall. The locked copy is cached per map, so callers can
 * pass `gatesLocked ? withGates(map) : map` to findPath / raycast / hasLineOfSight every tick, and any
 * per-map cache keyed on the object stays warm. Idempotent: a locked map maps to itself.
 * Maps are treated as read-only: the copy shares every field but `tiles` with the original (terrain and props
 * included: gate tiles are protected, so they carry no terrain and the copy stays consistent).
 */
export function withGates(map: GameMap): GameMap {
  if (lockedMaps.has(map)) return map;
  let out = locked.get(map);
  if (!out) {
    const tiles = map.tiles.slice();
    for (const g of map.coliseum.gates) for (const t of g.tiles) tiles[t.y * map.w + t.x] = TILE_WALL;
    out = { ...map, tiles };
    locked.set(map, out);
    lockedMaps.add(out);
  }
  return out;
}

// Derived views of the collision layer, cached per map OBJECT (the gated copy from withGates gets its own entries). They
// are never GameMap fields: a copy made with `{ ...map, tiles }` would carry a stale one. Maps are read-only, so a cache
// can only go stale in a test that edits tiles after a query: forgetMapCaches.
const sightMasks = new WeakMap<GameMap, Uint8Array>();
const moveMasks = new WeakMap<GameMap, Uint8Array>();
const moveComps = new WeakMap<GameMap, Int32Array>();

/**
 * Uncached, for a generator whose tiles are still changing: 1 where the tile blocks sight (MASK_SIGHT), else 0.
 * `out` (same length as `tiles`) is overwritten and returned; a new array when omitted.
 */
export function sightBlockedTiles(tiles: Uint8Array, out?: Uint8Array): Uint8Array {
  const o = out ?? new Uint8Array(tiles.length);
  if (o.length !== tiles.length) throw new RangeError(`sightBlockedTiles: out has ${o.length} entries for ${tiles.length} tiles`);
  for (let i = 0; i < tiles.length; i++) o[i] = (tiles[i] & MASK_SIGHT) !== 0 ? 1 : 0;
  return o;
}

/** Uncached, like sightBlockedTiles: 1 where the tile blocks movement (MASK_MOVE), else 0. */
export function moveBlockedTiles(tiles: Uint8Array, out?: Uint8Array): Uint8Array {
  const o = out ?? new Uint8Array(tiles.length);
  if (o.length !== tiles.length) throw new RangeError(`moveBlockedTiles: out has ${o.length} entries for ${tiles.length} tiles`);
  for (let i = 0; i < tiles.length; i++) o[i] = (tiles[i] & MASK_MOVE) !== 0 ? 1 : 0;
  return o;
}

/**
 * Uncached: the 4-connected TILE_FLOOR component id of every tile (ids 0.. in row-major order of first tile), -1 on a
 * tile that is not floor. Exactly A*'s reachability: a diagonal step needs both orthogonal neighbours open, so it splits
 * into two 4-steps on floor, and every 4-step is an A* step.
 */
export function moveComponentsOf(tiles: Uint8Array, w: number, h: number): Int32Array {
  const n = w * h;
  const comp = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let id = 0;
  for (let s = 0; s < n; s++) {
    if (tiles[s] !== TILE_FLOOR || comp[s] >= 0) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    comp[s] = id;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      if (x > 0 && tiles[i - 1] === TILE_FLOOR && comp[i - 1] < 0) { comp[i - 1] = id; queue[tail++] = i - 1; }
      if (x < w - 1 && tiles[i + 1] === TILE_FLOOR && comp[i + 1] < 0) { comp[i + 1] = id; queue[tail++] = i + 1; }
      if (i >= w && tiles[i - w] === TILE_FLOOR && comp[i - w] < 0) { comp[i - w] = id; queue[tail++] = i - w; }
      if (i < n - w && tiles[i + w] === TILE_FLOOR && comp[i + w] < 0) { comp[i + w] = id; queue[tail++] = i + w; }
    }
    id++;
  }
  return comp;
}

/** 1 where the tile blocks sight (tiles & MASK_SIGHT), cached per map object. */
export function sightMask(map: GameMap): Uint8Array {
  let m = sightMasks.get(map);
  if (!m) { m = sightBlockedTiles(map.tiles); sightMasks.set(map, m); }
  return m;
}

/** 1 where the tile blocks movement (tiles & MASK_MOVE), cached per map object. */
export function moveMask(map: GameMap): Uint8Array {
  let m = moveMasks.get(map);
  if (!m) { m = moveBlockedTiles(map.tiles); moveMasks.set(map, m); }
  return m;
}

/**
 * 4-connected TILE_FLOOR component id per tile, -1 on solid tiles, cached per map object. Two floor tiles are in one
 * component exactly when `findPath` can walk between them, so it answers "is the goal reachable" in O(1).
 */
export function moveComponents(map: GameMap): Int32Array {
  let c = moveComps.get(map);
  if (!c) { c = moveComponentsOf(map.tiles, map.w, map.h); moveComps.set(map, c); }
  return c;
}

/**
 * For a test that turns wall into floor after a query: drops the per-object caches above and discards the gated copy,
 * so the next `withGates(map)` is rebuilt from the edited tiles. (Floor into wall is safe without it: a stale component
 * only sends the pathfinder to A*, which then finds nothing.) Call it on the map that was edited.
 */
export function forgetMapCaches(map: GameMap): void {
  sightMasks.delete(map);
  moveMasks.delete(map);
  moveComps.delete(map);
  const copy = locked.get(map);
  if (copy) {
    sightMasks.delete(copy);
    moveMasks.delete(copy);
    moveComps.delete(copy);
    locked.delete(map);
  }
}

/**
 * A map from a raw tile grid with no regions, coliseum or spots: test arenas and hand-made maps.
 * `tiles` (and `terrain`, when given) is used as is, not copied; terrain defaults to a fresh zeroed layer. The empty
 * coliseum's centre is the middle tile's centre, which may be a wall here.
 */
export function mapFromTiles(w: number, h: number, tiles: Uint8Array, seed = 0, terrain?: Uint8Array): GameMap {
  if (tiles.length !== w * h) throw new RangeError(`mapFromTiles: ${tiles.length} tiles for ${w}x${h}`);
  if (terrain && terrain.length !== w * h) throw new RangeError(`mapFromTiles: ${terrain.length} terrain entries for ${w}x${h}`);
  const centre = { x: tileToWorldCenter(Math.floor(w / 2)), y: tileToWorldCenter(Math.floor(h / 2)) };
  return {
    seed,
    w,
    h,
    tiles,
    terrain: terrain ?? new Uint8Array(w * h),
    props: [],
    attempt: 0,
    territoryGrid: new Uint8Array(w * h),
    regionGrid: new Uint8Array(w * h),
    coliseum: { rect: { x: 0, y: 0, w: 0, h: 0 }, centre, gates: [], innerSpawns: [] },
    regions: [],
    camps: [],
    spawnPool: [],
    buildings: [],
    spawns: [],
    crateSpots: [],
    groundSpots: [],
  };
}

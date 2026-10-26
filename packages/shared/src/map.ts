// Map contract. `generateMap(seed, attempt)` in mapgen.ts must produce identical output on client and server.
import { TILE } from "./constants";
import type { FactionId } from "./factions";
import type { Vec2 } from "./messages";
import type { WeaponId } from "./weapons";

/** Walkable ground. */
export const TILE_FLOOR = 0;
/** Blocks movement and sight: border, coliseum ring, pillars, ruin walls, rocks. */
export const TILE_WALL = 1;
/**
 * Blocks movement but not sight: fences, lava, bog (written only by the zone stylers, see styler.ts). Shots, line of
 * sight and the anti-kiting lanes pass over it; bodies, paths and the walking distances do not.
 */
export const TILE_LOW = 2;

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
 * A region's mobs always carry one weapon type, so every type is farmable in exactly one region and the
 * map doubles as a shopping list for counters. Independent of the factions' signature start weapons.
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
  /** What every mob of this camp carries: REGION_WEAPONS[region]. */
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

export interface GameMap {
  seed: number;
  /** Size in tiles. */
  w: number;
  h: number;
  /**
   * Row-major, length w*h, TILE_FLOOR / TILE_WALL / TILE_LOW. Border is always wall. Gates are open (floor) here.
   * Walkable means `=== TILE_FLOOR`, sight-blocking means `=== TILE_WALL` (blocksMovementTile / blocksSightTile).
   */
  tiles: Uint8Array;
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

/** A wall tile (TILE_WALL): blocks sight and shots. Out-of-bounds counts as wall. Same as blocksSightTile. */
export function isWallTile(map: GameMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true;
  return map.tiles[ty * map.w + tx] === TILE_WALL;
}

export function isWallAt(map: GameMap, x: number, y: number): boolean {
  return isWallTile(map, worldToTile(x), worldToTile(y));
}

// TILE_LOW support (R2, minimal; the zone-terrain session owns the full version): movement, collision and paths use
// blocksMovementTile, sight, shots and the lane metric use blocksSightTile. They differ only on TILE_LOW.

/** True where a body may not stand or pass: anything but TILE_FLOOR (walls and low ground). Out-of-bounds blocks. */
export function blocksMovementTile(map: GameMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true;
  return map.tiles[ty * map.w + tx] !== TILE_FLOOR;
}

/** True where sight and shots stop: TILE_WALL only (low ground lets them pass). Out-of-bounds blocks. */
export function blocksSightTile(map: GameMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true;
  return map.tiles[ty * map.w + tx] === TILE_WALL;
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
 * Maps are treated as read-only: the copy shares every field but `tiles` with the original.
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

/**
 * A map from a raw tile grid with no regions, coliseum or spots: test arenas and hand-made maps.
 * `tiles` is used as is, not copied. The empty coliseum's centre is the middle tile's centre, which
 * may be a wall here.
 */
export function mapFromTiles(w: number, h: number, tiles: Uint8Array, seed = 0): GameMap {
  if (tiles.length !== w * h) throw new RangeError(`mapFromTiles: ${tiles.length} tiles for ${w}x${h}`);
  const centre = { x: tileToWorldCenter(Math.floor(w / 2)), y: tileToWorldCenter(Math.floor(h / 2)) };
  return {
    seed,
    w,
    h,
    tiles,
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

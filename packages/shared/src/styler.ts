// The zone-interior hooks (zone-terrain contract section 0, zone-shapes contract 2.1 and 3.1; the stylers are zoneStyle/, wired in by
// zoneStyle/hook.ts). generateMap calls two hooks per attempt:
//  - the landmark hook (stage 4), after the zones, the camps and their territories and BEFORE the spawn pool: each zone's styler
//    places up to LANDMARKS_PER_ZONE landmarks through the guard (whole or not at all), from a stream of its own. It runs on every
//    map, whatever the style hook is (the plain generator keeps its landmarks);
//  - the style hook (stage 6), after the pool, with the whole zone grid: shape (walls, LOW features), surface (hazards), props.
//
// Contract (checked by generateMap after each hook; a breach fails the attempt, counted as A:styleBreach in MAPGEN_FAILS, and
// the tests assert that no seed ever has one: it is a styler bug, never a normal retry):
//  - `tiles`: only TILE_FLOOR turned into TILE_WALL (blocks movement and sight) or TILE_LOW (blocks movement only:
//    lava, fence, crevasse), only on painted tiles (`zone` > 0) outside `protect`. It never opens a wall.
//  - `terrain` (all zero on entry): a LOW kind on a LOW or WALL tile, a floor kind (ember, bog, ice, light) on a FLOOR
//    tile, only on painted tiles outside `protect` (terrain.ts T3). `validateTerrain(map, { styled: true })` then gates the
//    finished map: a failure fails the attempt.
//  - with SHAPE_GATES (mapgen.ts), every tile whose class or kind the hook changed is owned by a feature of that tile's zone.
//  - `props`: decor, appended; the generator drops the ones whose tile ends up of another class than their kind wants.
//  - floor kinds keep off what must stay plain: the generator picks crates (3x3) and ground spots only on tiles with no floor
//    hazard and clears hazards from the pool members' 5x5s. ICE keeps one tile of clear ground (terrain.ts T11).
//  - the walkable floor should stay one 4-connected piece: the generator walls up floor cut off from the centre, a camp
//    clearing cut off fails the attempt, and so does a cut-off territory piece over STRAY_MAX tiles.
//  - floor share: max/min walkable floor per zone <= 1.15.
//  - the pool members' findPath walks to the coliseum centre stay within 1.2 max/min (the generator drops extreme members, then
//    fails the attempt): every styler runs the route guard (ShapeCtx.routeGuard).
//  - draws come from the styler's own streams (`styleRng`: mulberry32(hashSeed(seed, attempt, zoneIndex, stream))), never the
//    generator's.
import { MAP_STYLERS } from "./constants";
import type { MapProp, RegionFaction } from "./map";
import { hashSeed, mulberry32 } from "./rng";
import type { Rng } from "./rng";
import { landmarkHook, zoneStylerHook } from "./zoneStyle/hook";
import type { FeatureDraft } from "./zoneStyle/types";

/** A camp as the styler sees it: its site's tile index, clearing radius in tiles and territory id in `territoryGrid`. */
export interface StyleCamp {
  readonly site: number;
  readonly r: number;
  readonly territory: number;
  /** One of its zone's two elite camps. */
  readonly elite: boolean;
}

export interface StyleState {
  readonly w: number;
  readonly h: number;
  readonly seed: number;
  readonly attempt: number;
  /** false: the map is built without its cosmetic layer (the server, the bots): skip the decor stream and add no props. */
  readonly decor: boolean;
  /** Write: TILE_WALL or TILE_LOW over TILE_FLOOR, on painted tiles outside `protect`. */
  readonly tiles: Uint8Array;
  /** Write: terrain kinds (terrain.ts) on painted tiles outside `protect`; all zero on entry. */
  readonly terrain: Uint8Array;
  /** Write: decor, appended. */
  readonly props: MapProp[];
  /** Read: 0 off the painted set (border, coliseum), else 1..5, this attempt's zone index. */
  readonly zone: Uint8Array;
  /** Read: zoneFaction[z - 1] is the faction of zone z. */
  readonly zoneFaction: readonly RegionFaction[];
  /**
   * Read: 1 where nothing may change: the border, the coliseum, the ring road and one tile beyond, the gate lanes and one
   * tile around them, camp halos (clearing + 1), landmark boxes + 1, the 4x4 map corners and the pool members' 3x3s. The styler
   * keeps its own 3-tile rim margin from zone boundaries on top of this.
   */
  readonly protect: Uint8Array;
  /** Read: 0 off the painted set, else 1 + the index in `camps` of the camp whose territory holds the tile. */
  readonly territoryGrid: Uint8Array;
  readonly camps: readonly StyleCamp[];
  /** Read: the pool members (tile indices, pick order). */
  readonly spawns: readonly number[];
  /** Read: walkField16 to the coliseum centre at pool-pick time (fifths of a tile, -1 unreachable). */
  readonly centreWalk: Int32Array;
  /** Append: the attempt's feature log (the landmarks are already in it). */
  readonly features: FeatureDraft[];
  /** Write: 1 + feature-log index per tile (0 = unowned); the generator builds `featureGrid` from it. */
  readonly featureOwner: Uint16Array;
}

/** The hook: styles every zone of one attempt in one pass. */
export type ZoneStyleHook = (state: StyleState) => void;

/** What the landmark stage sees (contract 3.1): the tiles after the fixed walls, the landmark protect, the camps, the feature log. */
export interface LandmarkState {
  readonly w: number;
  readonly h: number;
  readonly seed: number;
  readonly attempt: number;
  /** Write: TILE_WALL over TILE_FLOOR (landmarks write walls only), on painted tiles outside `protect`. */
  readonly tiles: Uint8Array;
  readonly zone: Uint8Array;
  readonly zoneFaction: readonly RegionFaction[];
  /** Read: the landmark protect (mapgen.ts `landmarkProtect`). */
  readonly protect: Uint8Array;
  readonly territoryGrid: Uint8Array;
  readonly camps: readonly StyleCamp[];
  /** Append: the attempt's feature log (empty on entry). */
  readonly features: FeatureDraft[];
  /** Write: 1 + feature-log index per tile. */
  readonly featureOwner: Uint16Array;
}

/** The landmark stage: each zone's styler.landmark in zone index order. */
export type LandmarkHook = (state: LandmarkState) => void;

/** The hook every map uses (client and server alike): the five zone stylers while MAP_STYLERS is on, none when it is off. */
export const ZONE_STYLE_HOOK: ZoneStyleHook | null = MAP_STYLERS ? zoneStylerHook : null;

/** The landmark stage every map runs (independent of MAP_STYLERS: the plain generator keeps its landmarks). */
export const ZONE_LANDMARK_HOOK: LandmarkHook = landmarkHook;

/**
 * The styler's streams per zone (zone-terrain contract 0.3, zone-shapes contract 3.1): 0 shape, 1 decor (props; skipped with decor
 * off), 2 surface, 3 landmark. The noise of a stream is hashSeed(..., stream + 100).
 */
export const STYLE_STREAM = { shape: 0, decor: 1, surface: 2, landmark: 3 } as const;

/**
 * A stream of the styler's own for (seed, attempt, zone index, stream); never the generator's. The seed is `hashSeed`'s (shared/rng.ts,
 * integer mixing only), the one stream function the stylers use.
 */
export function styleRng(seed: number, attempt: number, zoneIndex: number, stream = 0): Rng {
  return mulberry32(hashSeed(seed, attempt, zoneIndex, stream));
}

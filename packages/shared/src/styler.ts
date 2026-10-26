// The zone-interior styler hook (zone-terrain contract, section 0; the zone-terrain session owns the stylers; R2 ships
// none). generateMap calls the hook once per attempt with the whole zone grid, after the zone partition, the camps and
// their territories and the generator's own ruins, and BEFORE the rock chunks, the spawn pool, the crates and the cover
// passes, so the walking contour, the spawn and crate picks and the cover certification all see the styled ground. The
// styler's sight-blocking walls count as cover before any rock is placed, so tall structures take the place of rocks.
//
// Contract (checked by generateMap after the hook; a breach throws, it is a bug in the styler, not a failed attempt):
//  - `tiles`: only TILE_FLOOR turned into TILE_WALL (blocks movement and sight) or TILE_LOW (blocks movement only:
//    lava, fence, crevasse), only on painted tiles (`zone` > 0) outside `protect`. It never opens a wall.
//  - `terrain` (all zero on entry): a LOW kind on a LOW or WALL tile, a floor kind (ember, bog, ice, light) on a FLOOR
//    tile, only on painted tiles outside `protect` (terrain.ts T3). `validateTerrain(map, { styled: true })` then gates the
//    finished map: a failure fails the attempt.
//  - `props`: decor, appended; the generator drops the ones whose tile ends up of another class than their kind wants.
//  - floor kinds keep off what must stay plain: the generator picks spawn-pool members (5x5), crates (3x3) and ground
//    spots only on tiles with no terrain, and a rock that lands on a floor kind clears it (a LOW kind under a rock stays,
//    as decor).
//  - the walkable floor should stay one 4-connected piece: the generator walls up floor cut off from the centre, a camp
//    clearing cut off fails the attempt, and so does a cut-off territory piece over STRAY_MAX tiles.
//  - floor share: max/min walkable floor per zone <= 1.15 after the cover.
//  - the cover may put a rock on any LOW tile not listed in `keepLow`; a straight run of kept LOW over 14.98 tiles cannot
//    be cut and fails the attempt.
//  - draws come from the styler's own streams (zone-terrain: hashSeed(seed, attempt, zoneIndex, stream)), never the
//    generator's.
import type { MapProp, RegionFaction } from "./map";
import { mulberry32 } from "./rng";
import type { Rng } from "./rng";

/** A camp as the styler sees it: its site's tile index, clearing radius in tiles and territory id in `territoryGrid`. */
export interface StyleCamp {
  readonly site: number;
  readonly r: number;
  readonly territory: number;
}

export interface StyleState {
  readonly w: number;
  readonly h: number;
  readonly seed: number;
  readonly attempt: number;
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
   * tile around them, camp halos (clearing + 1), ruins + 1 and the 4x4 map corners. The styler keeps its own 3-tile rim
   * margin from zone boundaries on top of this.
   */
  readonly protect: Uint8Array;
  /** Read: 0 off the painted set, else 1 + the index in `camps` of the camp whose territory holds the tile. */
  readonly territoryGrid: Uint8Array;
  readonly camps: readonly StyleCamp[];
  /** Output: 1 on TILE_LOW tiles the cover may not put a rock on (empty in v1). */
  readonly keepLow: Uint8Array;
}

/** The hook: styles every zone of one attempt in one pass. */
export type ZoneStyleHook = (state: StyleState) => void;

/** The hook every map uses (client and server alike). None in R2: the zone-terrain session supplies it. */
export const ZONE_STYLE_HOOK: ZoneStyleHook | null = null;

/** A stream of the styler's own for (seed, attempt, zone index), for stylers that bring none; never the generator's. */
export function styleRng(seed: number, attempt: number, zoneIndex: number): Rng {
  return mulberry32((seed ^ 0x5bd1e995) + attempt * 0x27d4eb2d + zoneIndex * 0x165667b1);
}

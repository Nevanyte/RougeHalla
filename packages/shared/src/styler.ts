// The zone-interior styler hook (owned by the zone-terrain session; R2 ships no stylers). generateMap runs a zone's
// styler once per attempt, after the zone partition, the camps and their territories and the generator's own ruins,
// and BEFORE the obstacles, the spawn pool, the crates and the cover passes, so the walking contour, the spawn and
// crate picks and the cover certification all see the styled ground. A styler's sight-blocking walls count as cover
// before any rock is placed, so tall structures take the place of rocks.
//
// Contract:
//  - a styler may only turn TILE_FLOOR into TILE_WALL (blocks movement and sight) or TILE_LOW (blocks movement only:
//    fences, lava, bog), only on its own zone's tiles (`zoneMask`) and never on `protect`. It never opens a wall.
//    generateMap checks this after every styler and throws on a breach (a bug in the styler, not a failed attempt).
//  - its zone's walkable floor should stay one 4-connected piece: the generator walls up floor cut off from the
//    centre, a camp clearing cut off fails the attempt, and a cut-off territory piece over STRAY_MAX tiles does too.
//  - floor share: the generator certifies max/min floor per zone <= 1.15 after the cover, so each zone's styler should
//    keep its WALL + LOW footprint to a similar budget (about 8% of the zone or less).
//  - the cover treats TILE_WALL as cover and TILE_LOW as open sight; it may put a sight-blocking rock on a TILE_LOW tile
//    (shown as a basalt column in lava, a fence post) unless the styler lists it in `keepLow`. A straight run of kept
//    low tiles longer than the lane cap (14.98 tiles) cannot be cut and fails the attempt: break straight low features
//    at 12 tiles or less with a wall or a bend.
//  - draws come from the styler's own stream (styleRng), so a styler never shifts the generator's draws.
import type { RegionFaction } from "./map";
import { mulberry32 } from "./rng";
import type { Rng } from "./rng";

export interface ZoneStylerInput {
  readonly w: number;
  readonly h: number;
  readonly zone: RegionFaction;
  /** 1 on this zone's painted tiles. Read only. */
  readonly zoneMask: Uint8Array;
  /**
   * 1 where nothing may change: the border, the coliseum, the ring road and one tile beyond, the gate lanes and one
   * tile around them, camp halos (clearing + 1), ruins + 1 and the 4x4 map corners. Read only.
   */
  readonly protect: Uint8Array;
  /** The map's tiles: write TILE_WALL or TILE_LOW over TILE_FLOOR inside zoneMask and outside protect. */
  readonly tiles: Uint8Array;
  /** 1 + camp index per tile for this attempt's territories (0 off the painted set). Read only. */
  readonly territoryGrid: Uint8Array;
  /** The styler's own stream, derived from (seed, attempt, zone). */
  readonly rng: Rng;
  /** Output: 1 on TILE_LOW tiles the cover may not put a rock on. */
  readonly keepLow: Uint8Array;
}

export type ZoneStyler = (input: ZoneStylerInput) => void;
export type ZoneStylers = Readonly<Partial<Record<RegionFaction, ZoneStyler>>>;

/** The stylers every map uses (client and server alike). Empty in R2: the zone-terrain session fills it. */
export const ZONE_STYLERS: ZoneStylers = Object.freeze({});

/** A zone's styler stream: independent of the generator's, so a styler's draws never move the rest of the map. */
export function styleRng(seed: number, attempt: number, zoneIndex: number): Rng {
  return mulberry32((seed ^ 0x5bd1e995) + attempt * 0x27d4eb2d + zoneIndex * 0x165667b1);
}

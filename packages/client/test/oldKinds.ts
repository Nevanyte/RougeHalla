// A hand-built styled map with every OLD kind of wall and ground (the kinds that existed before the zone shapes) and no features: the
// pre-feature art's whole range, so a test can pin that a map without features is painted as it always was (test/zoneShapesBake.test.ts).
import { PROP_KINDS, TILE, TILE_FLOOR, TILE_LOW, TILE_WALL, mapFromTiles, type GameMap } from "@raid/shared";

/** A hand-built styled map with every old kind of wall and ground in four zones and no features: the pre-feature art's whole range. */
export function oldKindsMap(): GameMap {
  const w = 48, h = 34;
  const tiles = new Uint8Array(w * h);
  const terrain = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x === 0 || y === 0 || x === w - 1 || y === h - 1) tiles[y * w + x] = TILE_WALL;
  const put = (x0: number, y0: number, rw: number, rh: number, tile: number, kind = 0): void => {
    for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) { tiles[y * w + x] = tile; terrain[y * w + x] = kind; }
  };
  put(4, 4, 5, 4, TILE_WALL);        // a mass
  put(12, 4, 1, 1, TILE_WALL);       // a rock
  put(14, 4, 4, 1, TILE_WALL);       // a run of stones
  put(20, 4, 3, 1, TILE_LOW, 2);     // a fence
  put(24, 4, 1, 1, TILE_WALL, 2);    // a gatepost (a pillar in a fence line)
  put(4, 12, 6, 3, TILE_LOW, 1);     // lava
  put(12, 12, 1, 1, TILE_WALL, 1);   // a basalt column
  put(14, 12, 4, 3, TILE_FLOOR, 4);  // embers
  put(20, 12, 4, 3, TILE_FLOOR, 5);  // bog
  put(26, 12, 4, 3, TILE_FLOOR, 6);  // ice
  put(32, 12, 3, 3, TILE_FLOOR, 7);  // light
  put(4, 20, 4, 3, TILE_LOW, 3);     // a crevasse
  put(10, 20, 5, 4, TILE_WALL);      // a mass over a frost shard row below it
  put(10, 24, 1, 3, TILE_WALL);
  put(30, 20, 6, 5, TILE_WALL);
  put(31, 21, 2, 2, TILE_FLOOR);
  const map = mapFromTiles(w, h, tiles, 17, terrain);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) map.regionGrid[y * w + x] = y < 17 ? (x < 24 ? 1 : 3) : (x < 24 ? 4 : 5);
  (map as { regions: unknown[] }).regions = [{ id: "fire" }];
  map.buildings = [{ x: 30, y: 20, w: 6, h: 5 }];
  // Props of the old kinds only (the table's first 22).
  const PROP = Object.fromEntries(PROP_KINDS.map((k, i) => [k.key, i]));
  for (const [key, tx, ty] of [["ember_vent", 15, 13], ["glow_crack", 5, 5], ["banner", 6, 5], ["fungus_cap", 21, 13], ["icicle", 11, 21], ["column_cap", 32, 21], ["lantern", 8, 16], ["snow_drift", 27, 13], ["candelabra", 33, 13], ["chain", 21, 4]] as const) {
    map.props.push({ kind: PROP[key]!, x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, v: 77 });
  }
  return map;
}

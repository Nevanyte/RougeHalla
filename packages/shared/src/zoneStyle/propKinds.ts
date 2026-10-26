// The decor kinds the zone stylers place (part D 7.4). `GameMap.props[].kind` indexes this list: APPEND ONLY, never reorder
// (generator output, tests and the client's art key on the ids). Each kind names the tile class its anchor stands on and
// the zone it belongs to. terrain.ts's PROP_KINDS is the table validateTerrain reads by default; until it holds this
// list, pass `{ propKinds: ZONE_PROP_KINDS }` to validateTerrain.
import { TILE_FLOOR, TILE_LOW, TILE_WALL } from "../map";
import type { PropKindSpec } from "../terrain";

export const ZONE_PROP_KINDS: readonly PropKindSpec[] = [
  // fire (Scorch)
  { key: "ember_vent", on: TILE_FLOOR, home: "fire" },
  { key: "glow_crack", on: TILE_WALL, home: "fire" },
  { key: "basalt_shard", on: TILE_WALL, home: "fire" },
  { key: "ash_drift", on: TILE_FLOOR, home: "fire" },
  // sentenced (Gallows)
  { key: "banner", on: TILE_WALL, home: "sentenced" },
  { key: "chain", on: TILE_LOW, home: "sentenced" },
  { key: "gallows", on: TILE_WALL, home: "sentenced" },
  { key: "cell_bars", on: TILE_WALL, home: "sentenced" },
  { key: "lantern", on: TILE_FLOOR, home: "sentenced" },
  // plague (Warren)
  { key: "fungus_cap", on: TILE_WALL, home: "plague" },
  { key: "bubble", on: TILE_FLOOR, home: "plague" },
  { key: "drip", on: TILE_WALL, home: "plague" },
  { key: "pipe", on: TILE_WALL, home: "plague" },
  // frost (Rime)
  { key: "ice_spire", on: TILE_WALL, home: "frost" },
  { key: "snow_drift", on: TILE_FLOOR, home: "frost" },
  { key: "frost_sparkle", on: TILE_FLOOR, home: "frost" },
  { key: "icicle", on: TILE_WALL, home: "frost" },
  // holy (Sanctum)
  { key: "column_cap", on: TILE_WALL, home: "holy" },
  { key: "banner_red", on: TILE_WALL, home: "holy" },
  { key: "candelabra", on: TILE_FLOOR, home: "holy" },
  { key: "rubble", on: TILE_FLOOR, home: "holy" },
  { key: "stained_glass", on: TILE_FLOOR, home: "holy" },
];

/** Kind id by key: `PROP.ember_vent`. */
export const PROP: Readonly<Record<string, number>> = (() => {
  const out: Record<string, number> = {};
  ZONE_PROP_KINDS.forEach((k, i) => { out[k.key] = i; });
  return out;
})();

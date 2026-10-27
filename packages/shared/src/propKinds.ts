// The decor kinds a map's props may have (part D 7.4). `GameMap.props[].kind` indexes this list: APPEND ONLY, never reorder
// (generator output, tests and the client's art key on the ids). Each kind names the tile class its anchor stands on and the
// zone it belongs to. A LEAF module (types and tile constants only), so terrain.ts can own the table (`PROP_KINDS`, the default
// of validateTerrain's T9) while the zone stylers (zoneStyle/propKinds.ts) place from the very same array without an import cycle.
import { TILE_FLOOR, TILE_LOW, TILE_WALL } from "./map";
import type { RegionFaction } from "./map";

/** What a decor sprite may stand on. */
export interface PropKindSpec {
  readonly key: string;
  /** The tile class its anchor must sit on (TILE_FLOOR, TILE_LOW or TILE_WALL). */
  readonly on: number;
  readonly home: RegionFaction | null;
}

export const PROP_KINDS: readonly PropKindSpec[] = [
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
  // The zone shapes (zone-shapes contract 7.5), appended in this order: the stylers place them, the client draws them.
  { key: "crater_lip", on: TILE_WALL, home: "fire" },
  { key: "anvil", on: TILE_FLOOR, home: "fire" },
  { key: "slag_heap", on: TILE_FLOOR, home: "fire" },
  { key: "gate_post", on: TILE_LOW, home: "sentenced" },
  { key: "stocks", on: TILE_FLOOR, home: "sentenced" },
  { key: "tunnel_beam", on: TILE_WALL, home: "plague" },
  { key: "burrow_rubble", on: TILE_FLOOR, home: "plague" },
  { key: "reed", on: TILE_FLOOR, home: "plague" },
  { key: "tower_frost", on: TILE_WALL, home: "frost" },
  { key: "ice_crack", on: TILE_FLOOR, home: "frost" },
  { key: "altar", on: TILE_FLOOR, home: "holy" },
  { key: "brazier", on: TILE_FLOOR, home: "holy" },
];

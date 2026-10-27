// What the synced state says about the map (roguelike R2, D20): never the map itself, only `seed`, `attempt` and the hash.
import type { GameMap } from "./map";
import { mapHash } from "./mapgen";

/** `mapHash` (the one hash every side compares) as the uint32 that `RaidState.mapHash` carries. */
export function mapHashU32(map: GameMap): number {
  return Number.parseInt(mapHash(map), 16) >>> 0;
}

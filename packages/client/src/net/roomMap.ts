// A joined room's map, checked: the (seed, attempt) the state publishes, built by the map loader (net/mapWorker.ts), must
// hash to the state's `mapHash`. Anything else means this client and the server build different maps (a stale page
// after a deploy, most likely): the player is told to reload, and the room is left (main.ts).
import { mapHashU32, type GameMap } from "@raid/shared";
import type { MapLoader } from "./mapWorker";

/** What the room's state says about its map. */
export interface PublishedMap {
  seed: number;
  attempt: number;
  mapHash: number;
}

export type CheckedMap = { ok: true; map: GameMap } | { ok: false; detail: string };

const hex = (h: number): string => (h >>> 0).toString(16).padStart(8, "0");

/** Never rejects: a build that fails is a mismatch too (that attempt does not certify here). */
export async function checkedMap(published: PublishedMap, loader: MapLoader): Promise<CheckedMap> {
  const { seed, attempt, mapHash } = published;
  let map: GameMap;
  try {
    map = await loader.mapFor(seed, attempt);
  } catch (err) {
    return { ok: false, detail: `seed ${seed} attempt ${attempt} does not build here (${err instanceof Error ? err.message : String(err)}); the server's hash is ${hex(mapHash)}` };
  }
  const built = mapHashU32(map);
  if (built !== mapHash >>> 0) {
    return { ok: false, detail: `seed ${seed} attempt ${attempt}: this client built ${hex(built)}, the server published ${hex(mapHash)}` };
  }
  return { ok: true, map };
}

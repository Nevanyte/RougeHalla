// The one place the game builds its map: the generator's, or, while the zone stylers are on (MAP_STYLERS), a finished wedge
// map with the stylers applied (the dev adapter, retired when the zone generator's own hook lands). Server, bots and
// client all call this, so they all get the same map from the same seed.
import { MAP_STYLERS } from "./constants";
import type { GameMap } from "./map";
import { generateMap } from "./mapgen";
import { styleFinishedMap } from "./zoneStyle/finishedMap";

/** `styled` picks the branch explicitly (tests); buildGameMap reads MAP_STYLERS. */
export function buildGameMapOf(seed: number, styled: boolean): GameMap {
  return styled ? styleFinishedMap(generateMap(seed)) : generateMap(seed);
}

export function buildGameMap(seed: number): GameMap {
  return buildGameMapOf(seed, MAP_STYLERS);
}

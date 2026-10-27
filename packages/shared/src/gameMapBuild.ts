// The one place the game builds its map: the generator's, or, while the zone stylers are on (MAP_STYLERS), a finished wedge
// map with the stylers applied (the dev adapter, retired when the zone generator's own hook lands). Server, bots and
// client all call this, so they all get the same map from the same seed.
import { MAP_STYLERS } from "./constants";
import type { GameMap } from "./map";
import { generateMap } from "./mapgen";
import { styleFinishedMap } from "./zoneStyle/finishedMap";

export interface BuildGameMapOptions {
  /**
   * false = no props (decor): tiles and terrain are byte-equal either way. The server and the bots never read props, so they
   * pass false; the client keeps the default (true) for the art. Has no effect while the stylers are off.
   */
  decor?: boolean;
}

/** `styled` picks the branch explicitly (tests); buildGameMap reads MAP_STYLERS. */
export function buildGameMapOf(seed: number, styled: boolean, opts: BuildGameMapOptions = {}): GameMap {
  return styled ? styleFinishedMap(generateMap(seed), { decor: opts.decor !== false }) : generateMap(seed);
}

export function buildGameMap(seed: number, opts: BuildGameMapOptions = {}): GameMap {
  return buildGameMapOf(seed, MAP_STYLERS, opts);
}

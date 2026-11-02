// Bushes are recorded in `map.features` (kind "bush") by mapgen's own bush stage (10b, `src/bushes.ts`), never by a zone styler.
// The styler tests set them apart with `isBush` and check them with `expectBushFloorOnly`: a bush owns plain floor of its own
// elite camp's territory, with no terrain, and writes no tile or terrain byte, so it cannot hide a styler's wall or hazard.
import { expect } from "vitest";
import { TILE_FLOOR, type GameMap, type MapFeature } from "../src/map";

export const isBush = (f: MapFeature): boolean => f.kind === "bush";

export function expectBushFloorOnly(m: GameMap, f: MapFeature, label = ""): void {
  const k = m.features.indexOf(f);
  expect(k, `${label} bush is a map feature`).toBeGreaterThanOrEqual(0);
  expect(f.jobs, `${label} bush jobs`).toEqual(["cover"]);
  expect(f.p.length, `${label} bush params`).toBe(2);
  const camp = m.camps[f.p[0]];
  expect(camp && camp.eliteSpot >= 0 && camp.zone === f.zone, `${label} bush belongs to an elite camp of its zone`).toBe(true);
  let n = 0;
  for (let i = 0; i < m.featureGrid.length; i++) {
    if (m.featureGrid[i] !== k + 1) continue;
    n++;
    expect(m.tiles[i], `${label} bush tile ${i}`).toBe(TILE_FLOOR);
    expect(m.terrain[i], `${label} bush terrain ${i}`).toBe(0);
    expect(m.territoryGrid[i], `${label} bush territory ${i}`).toBe(f.p[0] + 1);
  }
  expect(n, `${label} bush tiles`).toBe(f.tiles);
  expect(n).toBeGreaterThan(0);
}

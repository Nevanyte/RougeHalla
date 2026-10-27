// The zone style hook (styler.ts) under a demo hook (mapCertify.ts): low ground (lava, fences, a crevasse), floor
// hazards (ember, bog, ice, light) and walls in every zone. Styled maps must certify exactly as plain ones do, with low
// ground blocking movement and letting sight through (connectivity, territories and the spawn walks on the move mask, the
// spawn safety rule on the sight mask), and the terrain layer must pass validateTerrain. The demo hook writes tiles no feature
// owns, so these maps are generated with the shape gates off and certified in the certifier's `styled` mode (no ownership or
// piece checks: those are the `strict` group of real stylers).
import { describe, expect, it } from "vitest";
import { TILE_FLOOR, TILE_LOW, TILE_WALL } from "../src/map";
import { certifiedMap, generateMap, mapHash } from "../src/mapgen";
import type { GameMap, } from "../src/map";
import type { StyleState, ZoneStyleHook } from "../src/mapgen";
import { TERRAINS, TERRAIN_ICE, TERRAIN_NONE, validateTerrain } from "../src/terrain";
import { certifyMap, demoStyleHook } from "./mapCertify";

/** Seeds 300..322, plus 2168 (a hard seed of the retired cover pass, kept as a regression seed). */
const SEEDS = [...Array.from({ length: 23 }, (_, i) => 300 + i), 2168];

/** Runs the demo hook and records what it wrote: the tiles it turned to LOW and the kinds it laid. */
function spyOn(): { hook: ZoneStyleHook; low: number[]; kinds: Map<number, number> } {
  const out = { low: [] as number[], kinds: new Map<number, number>() };
  const hook: ZoneStyleHook = (st: StyleState) => {
    const before = st.tiles.slice();
    demoStyleHook(st);
    for (let i = 0; i < before.length; i++) {
      if (before[i] !== TILE_LOW && st.tiles[i] === TILE_LOW) out.low.push(i);
      if (st.terrain[i] !== TERRAIN_NONE) out.kinds.set(i, st.terrain[i]);
    }
  };
  return { hook, ...out };
}

describe("zone style hook (demo hook, 24 seeds)", () => {
  const maps: (GameMap | null)[] = SEEDS.map((s) => certifiedMap(s, { styleZones: demoStyleHook, shapeGates: false }));

  it("certifies styled maps as it does plain ones (validateTerrain included), discarding fewer than 5%", () => {
    const failures: string[] = [];
    maps.forEach((m, k) => { if (m) for (const f of certifyMap(m, { styled: true }).failures) failures.push(`seed ${SEEDS[k]}: ${f}`); });
    // The demo hook has ICE (a 6x6 sheet in the frost zone, plain floor on all eight sides of each tile): the generator keeps its
    // T11 by clearing the ICE beside any wall the nets add, so validateTerrain is clean.
    const ice = maps.reduce((a, m) => a + (m ? m.terrain.reduce((n, k) => n + (k === TERRAIN_ICE ? 1 : 0), 0) : 0), 0);
    expect(ice, "the demo hook's ice survives somewhere").toBeGreaterThan(50);
    for (const m of maps) if (m) expect(validateTerrain(m, { styled: true }), `seed ${m.seed}`).toEqual([]);
    expect(failures.slice(0, 8), `${failures.length} failures`).toEqual([]);
    expect(maps.filter((m) => !m).length).toBeLessThanOrEqual(1);
  }, 120_000);

  it("rebuilds a styled map from (seed, attempt) byte for byte", () => {
    for (const m of maps.slice(0, 6)) if (m) expect(mapHash(generateMap(m.seed, m.attempt, { styleZones: demoStyleHook, shapeGates: false }))).toBe(mapHash(m));
  }, 120_000);

  it("never lets low ground become floor (a wall standing on it keeps its kind, as decor), and no floor hazard ends under a wall", () => {
    let floorKinds = 0;
    for (const s of SEEDS.slice(0, 8)) {
      const m = certifiedMap(s, { styleZones: demoStyleHook, shapeGates: false });
      if (!m) continue;
      const spy = spyOn();
      generateMap(s, m.attempt, { styleZones: spy.hook });
      expect(spy.low.length, `seed ${s}: the hook wrote no low ground`).toBeGreaterThan(0);
      for (const i of spy.low) {
        expect(m.tiles[i], `seed ${s}: low tile ${i % m.w},${Math.floor(i / m.w)} ended as floor`).not.toBe(TILE_FLOOR);
        if (m.tiles[i] === TILE_WALL) expect(m.terrain[i], `seed ${s}: a wall on lava lost its kind`).toBe(spy.kinds.get(i));
      }
      for (let i = 0; i < m.terrain.length; i++) {
        const k = m.terrain[i];
        if (k !== TERRAIN_NONE && TERRAINS[k].tile === TILE_FLOOR) {
          floorKinds++;
          expect(m.tiles[i], `seed ${s}: a floor hazard under a wall at ${i % m.w},${Math.floor(i / m.w)}`).toBe(TILE_FLOOR);
        }
      }
    }
    expect(floorKinds, "no floor hazard survived: the case is untested").toBeGreaterThan(0);
  }, 120_000);
});

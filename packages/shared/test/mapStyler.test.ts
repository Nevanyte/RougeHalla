// The zone style hook (styler.ts) under a demo hook (mapCertify.ts): low ground (lava, fences, a crevasse), floor
// hazards (ember, bog, ice, light) and walls in every zone. Styled maps must certify exactly as plain ones do, with low
// ground blocking movement and letting sight through (connectivity, territories and the walking contour on the move
// mask, lanes and the spawn screen on the sight mask), and the terrain layer must pass validateTerrain.
import { describe, expect, it } from "vitest";
import { TILE_FLOOR, TILE_LOW, TILE_WALL } from "../src/map";
import { certifiedMap, generateMap, mapHash } from "../src/mapgen";
import type { GameMap, } from "../src/map";
import type { StyleState, ZoneStyleHook } from "../src/mapgen";
import { TERRAINS, TERRAIN_NONE } from "../src/terrain";
import { certifyMap, demoStyleHook } from "./mapCertify";

/** Seeds 300..322, plus 2168: its cover once walled up a pocket inside a ruin past the ruin's rock quota. */
const SEEDS = [...Array.from({ length: 23 }, (_, i) => 300 + i), 2168];

/** Runs the demo hook and records what it wrote: the tiles it turned to LOW and the ones it kept. */
function spyOn(): { hook: ZoneStyleHook; low: number[]; kept: number[]; kinds: Map<number, number> } {
  const out = { low: [] as number[], kept: [] as number[], kinds: new Map<number, number>() };
  const hook: ZoneStyleHook = (st: StyleState) => {
    const before = st.tiles.slice();
    demoStyleHook(st);
    for (let i = 0; i < before.length; i++) {
      if (before[i] !== TILE_LOW && st.tiles[i] === TILE_LOW) out.low.push(i);
      if (st.keepLow[i] && st.tiles[i] === TILE_LOW) out.kept.push(i);
      if (st.terrain[i] !== TERRAIN_NONE) out.kinds.set(i, st.terrain[i]);
    }
  };
  return { hook, ...out };
}

describe("zone style hook (demo hook, 24 seeds)", () => {
  const maps: (GameMap | null)[] = SEEDS.map((s) => certifiedMap(s, { styleZones: demoStyleHook }));

  it("certifies styled maps as it does plain ones (validateTerrain included), discarding fewer than 5%", () => {
    const failures: string[] = [];
    maps.forEach((m, k) => { if (m) for (const f of certifyMap(m, { styled: true }).failures) failures.push(`seed ${SEEDS[k]}: ${f}`); });
    expect(failures.slice(0, 8), `${failures.length} failures`).toEqual([]);
    expect(maps.filter((m) => !m).length).toBeLessThanOrEqual(1);
  }, 120_000);

  it("rebuilds a styled map from (seed, attempt) byte for byte", () => {
    for (const m of maps.slice(0, 6)) if (m) expect(mapHash(generateMap(m.seed, m.attempt, { styleZones: demoStyleHook }))).toBe(mapHash(m));
  }, 120_000);

  it("never lets low ground become floor; the cover may stand a rock on it (its kind stays, as decor) but never on kept low ground", () => {
    let rocked = 0, floorKinds = 0;
    for (const s of SEEDS.slice(0, 8)) {
      const m = certifiedMap(s, { styleZones: demoStyleHook });
      if (!m) continue;
      const spy = spyOn();
      generateMap(s, m.attempt, { styleZones: spy.hook });
      expect(spy.low.length, `seed ${s}: the hook wrote no low ground`).toBeGreaterThan(0);
      for (const i of spy.low) {
        expect(m.tiles[i], `seed ${s}: low tile ${i % m.w},${Math.floor(i / m.w)} ended as floor`).not.toBe(TILE_FLOOR);
        if (m.tiles[i] === TILE_WALL) { rocked++; expect(m.terrain[i], `seed ${s}: a rock on lava lost its kind`).toBe(spy.kinds.get(i)); }
      }
      expect(spy.kept.length, `seed ${s}: no kept low ground to check`).toBeGreaterThan(0);
      for (const i of spy.kept) expect(m.tiles[i], `seed ${s}: kept low tile ${i % m.w},${Math.floor(i / m.w)}`).toBe(TILE_LOW);
      for (let i = 0; i < m.terrain.length; i++) {
        const k = m.terrain[i];
        if (k !== TERRAIN_NONE && TERRAINS[k].tile === TILE_FLOOR) {
          floorKinds++;
          expect(m.tiles[i], `seed ${s}: a floor hazard under a wall at ${i % m.w},${Math.floor(i / m.w)}`).toBe(TILE_FLOOR);
        }
      }
    }
    expect(rocked, "no rock ever stood on low ground: the case is untested").toBeGreaterThan(0);
    expect(floorKinds, "no floor hazard survived: the case is untested").toBeGreaterThan(0);
  }, 120_000);
});

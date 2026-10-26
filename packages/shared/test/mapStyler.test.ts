// The zone styler hook (styler.ts) under a demo styler like R1's: low ground (lava, fences) and wall blocks in every
// zone. The styled maps must certify exactly as plain ones do, with low ground blocking movement and letting sight
// through: connectivity, territories and the walking contour on the walkable floor, lanes and the spawn screen on the
// sight-open ground.
import { describe, expect, it } from "vitest";
import { REGION_FACTIONS, TILE_LOW } from "../src/map";
import { certifiedMap, generateMap, mapHash } from "../src/mapgen";
import type { ZoneStyler } from "../src/mapgen";
import { DEMO_STYLERS as DEMO, certifyMap, demoStyler as demo } from "./mapCertify";

/** Seeds 300..322, plus 2168: its cover once walled up a pocket inside a ruin past the ruin's rock quota. */
const SEEDS = [...Array.from({ length: 23 }, (_, i) => 300 + i), 2168];

describe("zone stylers (demo styler, 24 seeds)", () => {
  const maps = SEEDS.map((s) => certifiedMap(s, { stylers: DEMO }));

  it("certifies styled maps as it does plain ones, discarding fewer than 5%", () => {
    const failures: string[] = [];
    maps.forEach((m, k) => { if (m) for (const f of certifyMap(m, { styled: true }).failures) failures.push(`seed ${SEEDS[k]}: ${f}`); });
    expect(failures.slice(0, 8), `${failures.length} failures`).toEqual([]);
    expect(maps.filter((m) => !m).length).toBeLessThanOrEqual(1);
  }, 120_000);

  it("keeps the low ground: the cover may stand a rock on lava but never on low ground the styler kept", () => {
    let low = 0, rockedLow = 0;
    for (const m of maps) {
      if (!m) continue;
      for (let i = 0; i < m.tiles.length; i++) if (m.tiles[i] === TILE_LOW) low++;
      const plain = generateMap(m.seed, m.attempt, { stylers: DEMO });
      expect(mapHash(plain)).toBe(mapHash(m));
    }
    // Rocks on lava: a styled map has fewer low tiles than its styler wrote when the cover put rocks there.
    for (const s of SEEDS.slice(0, 6)) {
      const m = certifiedMap(s, { stylers: DEMO });
      if (!m) continue;
      let wrote = 0;
      const keep: number[] = [];
      const spy: ZoneStyler = (z) => {
        const before = z.tiles.slice();
        demo(z);
        for (let i = 0; i < before.length; i++) {
          if (before[i] !== TILE_LOW && z.tiles[i] === TILE_LOW) wrote++;
          if (z.keepLow[i] && z.tiles[i] === TILE_LOW) keep.push(i);
        }
      };
      generateMap(s, m.attempt, { stylers: Object.fromEntries(REGION_FACTIONS.map((f) => [f, spy])) });
      let left = 0;
      for (let i = 0; i < m.tiles.length; i++) if (m.tiles[i] === TILE_LOW) left++;
      rockedLow += wrote - left;
      expect(keep.length, `seed ${s}: no kept low ground to check`).toBeGreaterThan(0);
      for (const i of keep) expect(m.tiles[i], `seed ${s}: kept low tile ${i % m.w},${Math.floor(i / m.w)}`).toBe(TILE_LOW);
    }
    expect(low, "low tiles left on the styled maps").toBeGreaterThan(SEEDS.length * 5 * 10);
    expect(rockedLow).toBeGreaterThan(0);
  }, 120_000);
});

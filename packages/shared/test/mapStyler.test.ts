// The zone styler hook (styler.ts) under a demo styler like R1's: low ground (lava, fences) and wall blocks in every
// zone. The styled maps must certify exactly as plain ones do, with low ground blocking movement and letting sight
// through: connectivity, territories and the walking contour on the walkable floor, lanes and the spawn screen on the
// sight-open ground.
import { describe, expect, it } from "vitest";
import { REGION_FACTIONS, TILE_FLOOR, TILE_LOW, TILE_WALL } from "../src/map";
import { certifiedMap, generateMap, mapHash } from "../src/mapgen";
import type { ZoneStyler, ZoneStylers } from "../src/mapgen";
import { randInt } from "../src/rng";
import { certifyMap } from "./mapCertify";

/** A meandering lava river 2 wide and up to 24 long, three fences of 5-9 tiles with a gap (kept low: no rock on them), two 2x2 wall blocks. */
const demo: ZoneStyler = ({ w, h, zoneMask, protect, tiles, rng, keepLow }) => {
  const N = w * h;
  const cells: number[] = [];
  for (let i = 0; i < N; i++) if (zoneMask[i] && !protect[i] && tiles[i] === TILE_FLOOR) cells.push(i);
  if (cells.length === 0) return;
  const free = (i: number): boolean => i >= 0 && i < N && zoneMask[i] === 1 && protect[i] === 0 && tiles[i] === TILE_FLOOR;
  {
    let at = cells[randInt(rng, 0, cells.length)];
    let dx = rng() < 0.5 ? 1 : 0, dy = 1 - dx;
    for (let step = 0; step < 24; step++) {
      const x = at % w, side = dx !== 0 ? w : 1;
      if (!free(at) || !free(at + side) || x <= 1 || x >= w - 2) break;
      tiles[at] = TILE_LOW;
      tiles[at + side] = TILE_LOW;
      if (rng() < 0.25) { const t = dx; dx = dy; dy = t; }
      at += dy * w + dx;
    }
  }
  for (let f = 0; f < 3; f++) {
    const at = cells[randInt(rng, 0, cells.length)];
    const horiz = rng() < 0.5, len = randInt(rng, 5, 10), gap = randInt(rng, 1, len - 1);
    for (let k = 0; k < len; k++) {
      const t = at + (horiz ? k : k * w);
      if (k === gap || !free(t)) continue;
      tiles[t] = TILE_LOW;
      keepLow[t] = 1;
    }
  }
  for (let b = 0; b < 2; b++) {
    const at = cells[randInt(rng, 0, cells.length)];
    for (const o of [0, 1, w, w + 1]) if (free(at + o)) tiles[at + o] = TILE_WALL;
  }
};
const DEMO: ZoneStylers = Object.fromEntries(REGION_FACTIONS.map((f) => [f, demo]));
const SEEDS = Array.from({ length: 24 }, (_, i) => 300 + i);

describe("zone stylers (demo styler, 24 seeds)", () => {
  const maps = SEEDS.map((s) => certifiedMap(s, { stylers: DEMO }));

  it("certifies styled maps as it does plain ones, discarding fewer than 5%", () => {
    const failures: string[] = [];
    maps.forEach((m, k) => { if (m) for (const f of certifyMap(m, { styled: true }).failures) failures.push(`seed ${SEEDS[k]}: ${f}`); });
    expect(failures.slice(0, 8), `${failures.length} failures`).toEqual([]);
    expect(maps.filter((m) => !m).length).toBeLessThanOrEqual(1);
  }, 120_000);

  it("keeps the low ground: it blocks movement but the cover treats it as open sight (kept fences carry no rock, others may)", () => {
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
      const spy: ZoneStyler = (z) => {
        const before = z.tiles.slice();
        demo(z);
        for (let i = 0; i < before.length; i++) if (before[i] !== TILE_LOW && z.tiles[i] === TILE_LOW) wrote++;
      };
      generateMap(s, m.attempt, { stylers: Object.fromEntries(REGION_FACTIONS.map((f) => [f, spy])) });
      let kept = 0;
      for (let i = 0; i < m.tiles.length; i++) if (m.tiles[i] === TILE_LOW) kept++;
      rockedLow += wrote - kept;
    }
    expect(low, "low tiles left on the styled maps").toBeGreaterThan(SEEDS.length * 5 * 10);
    expect(rockedLow).toBeGreaterThan(0);
  }, 120_000);
});

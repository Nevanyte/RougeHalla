import { describe, expect, it } from "vitest";
import { BUSH_REVEAL_RADIUS, TILE } from "../src/constants";
import { generateMap } from "../src/mapgen";
import { TILE_FLOOR } from "../src/map";
import { bushAt, bushConceals } from "../src/vision";

describe("elite camp bushes", () => {
  for (const seed of [1, 2, 3, 7]) {
    const map = generateMap(seed);
    it(`seed ${seed}: floor-only clumps in elite territories, clear of the clearing`, () => {
      const bushes = map.features.map((f, i) => ({ f, id: i + 1 })).filter((b) => b.f.kind === "bush");
      expect(bushes.length).toBeGreaterThanOrEqual(10);
      const withBush = new Set<number>();
      for (const { f, id } of bushes) {
        const camp = map.camps[f.p[0]!];
        expect(camp.eliteSpot).toBeGreaterThanOrEqual(0);
        expect(camp.zone).toBe(f.zone);
        withBush.add(f.p[0]!);
        expect(f.tiles).toBeGreaterThanOrEqual(6);
        for (let i = 0; i < map.featureGrid.length; i++) {
          if (map.featureGrid[i] !== id) continue;
          expect(map.tiles[i]).toBe(TILE_FLOOR);
          expect(map.terrain[i]).toBe(0);
          const x = (i % map.w + 0.5) * TILE, y = (Math.floor(i / map.w) + 0.5) * TILE;
          expect(Math.hypot(x - camp.x, y - camp.y)).toBeGreaterThan(camp.r + TILE);
        }
      }
      map.camps.forEach((c, i) => { if (c.eliteSpot < 0) expect(withBush.has(i)).toBe(false); });
      expect(withBush.size).toBeGreaterThanOrEqual(8);
    });
  }

  it("is the same with decor on and off", () => {
    const a = generateMap(5), b = generateMap(5, a.attempt, { decor: false });
    expect(b.featureGrid).toEqual(a.featureGrid);
  });

  it("conceals from outside, not from inside, up close or when exposed", () => {
    const map = generateMap(1);
    const id = map.features.findIndex((f) => f.kind === "bush") + 1;
    const i = map.featureGrid.indexOf(id);
    const inside = { x: (i % map.w + 0.5) * TILE, y: (Math.floor(i / map.w) + 0.5) * TILE };
    expect(bushAt(map, inside)).toBe(id);
    const far = { x: inside.x + BUSH_REVEAL_RADIUS * 4, y: inside.y };
    const near = { x: inside.x + BUSH_REVEAL_RADIUS / 2, y: inside.y };
    if (bushAt(map, far) !== id) expect(bushConceals(map, far, inside)).toBe(true);
    expect(bushConceals(map, near, inside)).toBe(false);
    expect(bushConceals(map, far, inside, 5000, 1000)).toBe(false);
    expect(bushConceals(map, inside, { x: 0, y: 0 })).toBe(false);
  });
});

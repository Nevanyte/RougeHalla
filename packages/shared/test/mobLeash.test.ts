import { describe, expect, it } from "vitest";
import {
  generateMap, leashOk, mapFromTiles, MOB_LEASH_CAP, MOB_LEASH_RADIUS, territoryAt, territoryLeash, TILE, TILE_FLOOR,
} from "../src";

// The pure side of the territory leash (ROGUELIKE_PLAN D15): the server's mobAI.ts asks `leashOk` every tick of a fight.

describe("territoryLeash and leashOk on generated maps", () => {
  it.each([1, 2, 3, 100])("seed %i: every camp's spots stand inside their own leash, with the cap at 12 tiles", (seed) => {
    const map = generateMap(seed);
    expect(MOB_LEASH_CAP).toBe(12 * TILE);
    map.camps.forEach((camp, ci) => {
      // The generator certifies radius <= 30 tiles; it measures 10.8 and up (the cap binds on all but a few camps).
      expect(camp.radius, camp.id).toBeGreaterThan(10 * TILE);
      for (const spot of camp.spots) {
        expect(territoryAt(map, spot), camp.id).toBe(ci + 1);
        expect(territoryLeash(map, ci + 1, spot), camp.id).toBe(Math.min(camp.radius, MOB_LEASH_CAP));
        expect(leashOk(map, ci + 1, spot, spot), camp.id).toBe(true);
        expect(leashOk(map, ci + 1, spot, spot, 24), camp.id).toBe(true);
        // Past the cap, a point 13 tiles away is out whatever cell it is on.
        expect(leashOk(map, ci + 1, spot, { x: spot.x + MOB_LEASH_CAP + TILE, y: spot.y }), camp.id).toBe(false);
      }
    });
  });

  it("a point on another camp's territory is outside, and so is one off the map or on the border ring", () => {
    const map = generateMap(1);
    const a = map.camps[0]!;
    const b = map.camps[1]!;
    expect(territoryAt(map, b)).toBe(2);
    expect(leashOk(map, 1, a.spots[0]!, b)).toBe(false);
    expect(leashOk(map, 1, a.spots[0]!, { x: -50, y: -50 })).toBe(false);
    expect(territoryAt(map, { x: -1, y: 5 })).toBe(0);
    expect(territoryAt(map, { x: map.w * TILE + 5, y: 5 })).toBe(0);
    // The coliseum footprint belongs to no territory.
    expect(territoryAt(map, map.coliseum.centre)).toBe(0);
  });

  it("the margin keeps a point clear of the territory's edge on every side, not only of the cap", () => {
    const map = generateMap(1);
    let tight = 0;
    map.camps.forEach((camp, ci) => {
      const home = camp.spots[0]!;
      // Walk a ray east from the spot: the first cell it leaves the territory on ends leashOk, and with a margin it ends sooner.
      let edge = -1;
      let edgeMargin = -1;
      for (let d = 0; d <= MOB_LEASH_CAP + TILE; d += 4) {
        const p = { x: home.x + d, y: home.y };
        if (edge < 0 && !leashOk(map, ci + 1, home, p)) edge = d;
        if (edgeMargin < 0 && !leashOk(map, ci + 1, home, p, 24)) edgeMargin = d;
      }
      expect(edgeMargin, camp.id).toBeGreaterThanOrEqual(0);
      expect(edgeMargin, camp.id).toBeLessThanOrEqual(edge);
      if (edgeMargin < edge) tight++;
    });
    // Most rays end at a territory border, not at the cap, so the margin matters on most camps.
    expect(tight).toBeGreaterThan(0);
  });
});

describe("the fallback", () => {
  const home = { x: 20 * TILE + 16, y: 20 * TILE + 16 };

  it("is the 9-tile circle (shrunk by the margin) when there is no camp, no territory or a camp the map does not have", () => {
    const map = mapFromTiles(40, 40, new Uint8Array(40 * 40).fill(TILE_FLOOR));
    for (const campRef of [0, 1, 5]) {
      expect(territoryLeash(map, campRef, home)).toBe(0);
      expect(leashOk(map, campRef, home, { x: home.x + MOB_LEASH_RADIUS, y: home.y })).toBe(true);
      expect(leashOk(map, campRef, home, { x: home.x + MOB_LEASH_RADIUS + 1, y: home.y })).toBe(false);
      expect(leashOk(map, campRef, home, { x: home.x, y: home.y - MOB_LEASH_RADIUS + 24 }, 24)).toBe(true);
      expect(leashOk(map, campRef, home, { x: home.x, y: home.y - MOB_LEASH_RADIUS + 23 }, 24)).toBe(false);
    }
  });

  it("a generated map's mob with no camp (a training dummy, a test's mob) uses the circle too", () => {
    const map = generateMap(1);
    const spot = map.camps[0]!.spots[0]!;
    expect(territoryLeash(map, 0, spot)).toBe(0);
    expect(leashOk(map, 0, spot, { x: spot.x + MOB_LEASH_RADIUS, y: spot.y })).toBe(true);
    expect(leashOk(map, 0, spot, { x: spot.x + MOB_LEASH_RADIUS + 1, y: spot.y })).toBe(false);
  });
});

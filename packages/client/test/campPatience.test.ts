import { describe, expect, it } from "vitest";
import { MOB_LEASH_CAP, TILE, mapFromTiles, type GameMap } from "@raid/shared";
import { campPatienceOutline } from "../src/render/CampPatience";

function campMap(w: number, h: number, radius: number): GameMap {
  const map = mapFromTiles(w, h, new Uint8Array(w * h));
  map.territoryGrid.fill(1);
  map.camps.push({ id: "fire-1", zone: "fire", x: 0, y: 0, r: TILE,
    spots: [], eliteSpot: -1, chest: { x: 0, y: 0 }, area: w * h, radius });
  return map;
}

describe("camp patience outline", () => {
  it("follows the union of mob home ranges and stops at the camp territory", () => {
    const map = campMap(12, 12, 2 * TILE);
    map.territoryGrid.fill(0);
    for (let ty = 3; ty <= 8; ty++) for (let tx = 3; tx <= 8; tx++) map.territoryGrid[ty * map.w + tx] = 1;
    map.camps[0]!.spots = [{ x: 4.5 * TILE, y: 5.5 * TILE }, { x: 7.5 * TILE, y: 5.5 * TILE }];
    const outline = campPatienceOutline(map, 0)!;
    const xs = outline.segments.filter((_n, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBe(3 * TILE);
    expect(Math.max(...xs)).toBe(9 * TILE);
    expect(outline.segments.length).toBeGreaterThan(0);
    // A territory tile beyond both home circles is outside the outline.
    expect(outline.segments.some((_n, i, a) => i % 4 === 0 && a[i] === 6 * TILE && a[i + 1] === 3 * TILE && a[i + 3] === 3 * TILE)).toBe(false);
  });

  it("caps a large territory to the same 24-tile reach as the server", () => {
    const map = campMap(70, 70, 40 * TILE);
    map.camps[0]!.spots = [{ x: 35.5 * TILE, y: 35.5 * TILE }];
    const outline = campPatienceOutline(map, 0)!;
    expect(outline.box.x).toBe(35 * TILE - MOB_LEASH_CAP);
    expect(outline.box.w).toBe(2 * MOB_LEASH_CAP + TILE);
  });

  it("does not draw a range for a camp without territory", () => {
    const map = campMap(4, 4, 2 * TILE);
    map.camps[0]!.area = 0;
    map.camps[0]!.spots = [{ x: 1.5 * TILE, y: 1.5 * TILE }];
    expect(campPatienceOutline(map, 0)).toBeNull();
  });
});

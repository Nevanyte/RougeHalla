import { describe, expect, it } from "vitest";
import { TILE, VISION_UPDATE_MS } from "../src/constants";
import { mapFromTiles, withGates } from "../src/map";
import { hasVisionLineOfSight, VisionMemory } from "../src/vision";

const at = (x: number, y: number) => ({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });

describe("vision regression edge cases", () => {
  it("keeps exploration behind an occluder unknown after moving along a visible corridor", () => {
    const w = 9, h = 5;
    const tiles = new Uint8Array(w * h);
    // The vertical wall divides the map; the lower opening is a corridor around it.
    for (let y = 0; y < h; y++) tiles[y * w + 4] = 1;
    tiles[4 * w + 4] = 0;
    const map = mapFromTiles(w, h, tiles);
    const memory = new VisionMemory(w, h);

    memory.update(map, at(2, 1), 1_000, 60_000, 2 * TILE);
    expect(memory.canSee(at(6, 1), 1_000)).toBe(false);
    memory.update(map, at(2, 4), 2_000, 60_000, 2 * TILE);
    memory.update(map, at(6, 4), 3_000, 60_000, 2 * TILE);

    expect(memory.canSee(at(2, 1), 3_000)).toBe(true);
    expect(memory.canSee(at(6, 1), 3_000)).toBe(false);
    expect(memory.canSee(at(6, 4), 3_000)).toBe(true);
  });

  it("uses full-precision absolute deadlines above the 32-bit timestamp range", () => {
    const map = mapFromTiles(12, 8, new Uint8Array(12 * 8));
    const memory = new VisionMemory(map.w, map.h);
    const origin = at(5, 4);
    const now = 2 ** 40 + 123;
    const ttl = 10_000;

    memory.update(map, origin, now, ttl, 0);
    expect(memory.canSee(origin, now + ttl - 1)).toBe(true);
    expect(memory.canSee(origin, now + ttl)).toBe(false);

    memory.update(map, origin, now + VISION_UPDATE_MS, ttl, 0);
    expect(memory.canSee(origin, now + VISION_UPDATE_MS + ttl - 1)).toBe(true);
    expect(memory.canSee(origin, now + VISION_UPDATE_MS + ttl)).toBe(false);
  });

  it("refreshes stationary cells exactly and invalidates them for position, radius, map and reset changes", () => {
    const tiles = new Uint8Array(12 * 10);
    for (let y = 0; y < 8; y++) tiles[y * 12 + 5] = 1;
    const map = mapFromTiles(12, 10, tiles);
    map.coliseum.gates = [{ side: "e", x: 5 * TILE, y: 8 * TILE, tiles: [{ x: 5, y: 8 }] }];
    const closed = withGates(map), memory = new VisionMemory(12, 10);
    const expected = new Float64Array(120);
    const check = (sight: typeof map, origin: { x: number; y: number }, now: number, radius: number, ttl = 500) => {
      const fresh = new VisionMemory(12, 10);
      fresh.update(sight, origin, now, ttl, radius);
      for (let i = 0; i < expected.length; i++) expected[i] = Math.max(expected[i]!, fresh.expiresAt[i]!);
      memory.update(sight, origin, now, ttl, radius);
      expect(memory.expiresAt).toEqual(expected);
    };
    const origin = at(4, 7);
    check(map, origin, 1000, 8 * TILE);
    check(map, origin, 1100, 8 * TILE); // identical rays, later deadlines
    check(map, origin, 1200, 8 * TILE, 900); // the geometry survives a TTL change
    check(map, { x: origin.x + 7, y: origin.y - 7 }, 1300, 8 * TILE); // same tile, different rays
    check(map, origin, 1400, TILE);
    check(closed, origin, 1401, TILE); // gate change bypasses the scan throttle
    check(closed, at(8, 8), 1501, 8 * TILE); // teleport
    check(closed, at(8, 8), 1400, 8 * TILE); // a backward clock never shortens existing deadlines
    memory.clear(); expected.fill(0);
    check(closed, at(8, 8), 1401, 8 * TILE); // reset must rebuild even at the same position
  });

  it("keeps line of sight symmetric on translated floor and wall layouts", () => {
    const w = 8, h = 7;
    const tiles = new Uint8Array(w * h);
    for (const [x, y] of [[3, 1], [3, 2], [5, 4], [1, 5]] as const) tiles[y * w + x] = 1;
    const map = mapFromTiles(w, h, tiles);
    const shiftedMap = mapFromTiles(w + 2, h + 1, new Uint8Array((w + 2) * (h + 1)));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) shiftedMap.tiles[(y + 1) * shiftedMap.w + x + 1] = tiles[y * w + x]!;

    for (let ay = 0; ay < h; ay++) for (let ax = 0; ax < w; ax++) {
      for (let by = 0; by < h; by++) for (let bx = 0; bx < w; bx++) {
        if (tiles[ay * w + ax] || tiles[by * w + bx]) continue;
        const a = at(ax, ay), b = at(bx, by);
        expect(hasVisionLineOfSight(map, a, b)).toBe(hasVisionLineOfSight(map, b, a));
        const shiftedA = at(ax + 1, ay + 1), shiftedB = at(bx + 1, by + 1);
        expect(hasVisionLineOfSight(map, a, b)).toBe(hasVisionLineOfSight(shiftedMap, shiftedA, shiftedB));
      }
    }
  });
});

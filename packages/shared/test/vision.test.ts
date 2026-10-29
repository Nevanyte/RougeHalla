import { describe, expect, it } from "vitest";
import { TILE, VISION_RADIUS, VISION_TRAIL_MS, VISION_UPDATE_MS } from "../src/constants";
import { hasLineOfSight } from "../src/geometry";
import { mapFromTiles, withGates, type GameMap } from "../src/map";
import { mulberry32 } from "../src/rng";
import { hasVisionLineOfSight, isInVision, VisionMemory } from "../src/vision";

const at = (x: number, y: number) => ({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
function ascii(rows: string[]): GameMap {
  return mapFromTiles(rows[0]!.length, rows.length, Uint8Array.from(rows.join(""), (c) => c === "#" ? 1 : 0));
}

describe("circular, occluded sight", () => {
  it("uses a fixed 900 world-unit circle with an inclusive boundary", () => {
    const map = mapFromTiles(100, 100, new Uint8Array(10_000)), origin = at(40, 40);
    expect(VISION_RADIUS).toBe(900);
    expect(isInVision(map, origin, { x: origin.x + 900, y: origin.y })).toBe(true);
    expect(isInVision(map, origin, { x: origin.x + 900.001, y: origin.y })).toBe(false);
    expect(isInVision(map, origin, { x: origin.x + 700, y: origin.y + 700 })).toBe(false);
    expect(isInVision(map, origin, origin, 0)).toBe(true);
  });

  it("reveals the wall face but never enemies or floor behind it", () => {
    const map = ascii(["########", "#..#...#", "#..#...#", "########"]), origin = at(1, 1);
    expect(hasVisionLineOfSight(map, origin, at(2, 1))).toBe(true);
    expect(hasVisionLineOfSight(map, origin, at(3, 1))).toBe(true);
    expect(hasVisionLineOfSight(map, origin, at(4, 1))).toBe(false);
    const memory = new VisionMemory(map.w, map.h);
    memory.update(map, origin, 100);
    expect(memory.canSee(at(3, 1), 100)).toBe(true);
    expect(memory.canSee(at(4, 1), 100)).toBe(false);
  });

  it("does not peek diagonally through touching wall corners", () => {
    const map = ascii(["....", "..#.", ".#..", "...."]);
    expect(hasVisionLineOfSight(map, at(1, 1), at(2, 2))).toBe(false);
    expect(hasVisionLineOfSight(map, at(2, 2), at(1, 1))).toBe(false);
    expect(hasVisionLineOfSight(map, at(1, 1), at(0, 0))).toBe(true);
  });

  it("respects a gate change immediately, even inside the scan throttle", () => {
    const map = ascii(["########", "#......#", "########"]);
    map.coliseum.gates = [{ side: "e", x: 112, y: 48, tiles: [{ x: 3, y: 1 }] }];
    const closed = withGates(map), memory = new VisionMemory(map.w, map.h);
    expect(isInVision(map, at(1, 1), at(5, 1))).toBe(true);
    expect(isInVision(closed, at(1, 1), at(5, 1))).toBe(false);
    memory.update(closed, at(1, 1), 100);
    expect(memory.canSee(at(5, 1), 100)).toBe(false);
    memory.update(map, at(1, 1), 101);
    expect(memory.canSee(at(5, 1), 101)).toBe(true);
  });

  it("agrees with combat rays for thousands of floor-to-floor lines", () => {
    const random = mulberry32(817), tiles = new Uint8Array(30 * 30);
    for (let i = 0; i < tiles.length; i++) tiles[i] = random() < 0.2 ? 1 : 0;
    const map = mapFromTiles(30, 30, tiles);
    for (let i = 0; i < 3000; i++) {
      const a = at(Math.floor(random() * 30), Math.floor(random() * 30));
      const b = at(Math.floor(random() * 30), Math.floor(random() * 30));
      if (tiles[Math.floor(a.y / TILE) * 30 + Math.floor(a.x / TILE)] || tiles[Math.floor(b.y / TILE) * 30 + Math.floor(b.x / TILE)]) continue;
      expect(hasVisionLineOfSight(map, a, b), JSON.stringify([a, b])).toBe(hasLineOfSight(map, a, b));
    }
  });
});

describe("private live trail memory", () => {
  it("retains seen tiles for exactly 120000ms, refreshes them on revisit, and keeps other players private", () => {
    const map = mapFromTiles(100, 10, new Uint8Array(1000));
    const a = new VisionMemory(map.w, map.h), b = new VisionMemory(map.w, map.h);
    const old = at(2, 2), far = at(95, 2);
    a.update(map, old, 100);
    b.update(map, far, 100);
    a.update(map, far, 200);
    expect(a.canSee(old, 100 + VISION_TRAIL_MS - 1)).toBe(true);
    expect(a.canSee(old, 100 + VISION_TRAIL_MS)).toBe(false);
    expect(b.canSee(old, 200)).toBe(false);
    a.update(map, old, 1000);
    expect(a.canSee(old, 1000 + VISION_TRAIL_MS - 1)).toBe(true);
    expect(a.canSee(old, 1000 + VISION_TRAIL_MS)).toBe(false);
  });

  it("refreshes stationary sight, bounds repeated scans, and reuses its fixed storage", () => {
    const map = mapFromTiles(10, 10, new Uint8Array(100)), memory = new VisionMemory(10, 10), origin = at(3, 3);
    const storage = memory.expiresAt, i = 3 * map.w + 3;
    memory.update(map, origin, 10);
    memory.update(map, origin, 10 + VISION_UPDATE_MS - 1);
    expect(storage[i]).toBe(10 + VISION_TRAIL_MS);
    memory.update(map, origin, 10 + VISION_UPDATE_MS);
    expect(storage[i]).toBe(10 + VISION_UPDATE_MS + VISION_TRAIL_MS);
    expect(memory.expiresAt).toBe(storage);
  });

  it("supports deadline-bounded sources and a full reset without sharing storage", () => {
    const map = mapFromTiles(10, 10, new Uint8Array(100)), memory = new VisionMemory(10, 10);
    memory.update(map, at(2, 2), 100, 500);
    expect(memory.canSee(at(2, 2), 599)).toBe(true);
    expect(memory.canSee(at(2, 2), 600)).toBe(false);
    memory.update(map, at(2, 2), 200, 400);
    expect(memory.expiresAt[22]).toBe(600);
    memory.clear();
    expect(memory.canSee(at(2, 2), 200)).toBe(false);
    memory.update(map, at(2, 2), 201);
    expect(memory.canSee(at(2, 2), 201)).toBe(true);
    expect(new VisionMemory(10, 10).canSee(at(2, 2), 201)).toBe(false);
  });

  it("rejects invalid positions and grid mismatches and retains the standing tile at radius zero", () => {
    const map = mapFromTiles(10, 10, new Uint8Array(100)), memory = new VisionMemory(10, 10);
    expect(() => new VisionMemory(-1, 10)).toThrow(RangeError);
    expect(() => new VisionMemory(10.5, 10)).toThrow(RangeError);
    expect(() => memory.update(mapFromTiles(2, 2, new Uint8Array(4)), at(1, 1), 0)).toThrow(RangeError);
    memory.update(map, { x: 33, y: 33 }, 0, 100, 0);
    expect(memory.canSee({ x: 33, y: 33 }, 99)).toBe(true);
    expect(memory.canSee({ x: NaN, y: 33 }, 99)).toBe(false);
    expect(memory.canSee({ x: -1, y: 33 }, 99)).toBe(false);
    expect(memory.canSee({ x: 9999, y: 33 }, 99)).toBe(false);
    expect(isInVision(map, { x: NaN, y: 0 }, at(1, 1))).toBe(false);
    expect(hasVisionLineOfSight(map, at(1, 1), { x: Infinity, y: 1 })).toBe(false);
    expect(hasVisionLineOfSight(map, at(1, 1), { x: -1, y: 1 })).toBe(false);
  });
});

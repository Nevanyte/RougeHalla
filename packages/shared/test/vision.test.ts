import { describe, expect, it } from "vitest";
import { TILE, VISION_RADIUS, VISION_TRAIL_MS, VISION_UPDATE_MS } from "../src/constants";
import { hasLineOfSight } from "../src/geometry";
import { isWallTile, mapFromTiles, MASK_SIGHT, REGION_COLISEUM, withGates, type GameMap } from "../src/map";
import { mulberry32 } from "../src/rng";
import { hasVisionLineOfSight, isInVision, VisionMemory } from "../src/vision";

const at = (x: number, y: number) => ({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
function ascii(rows: string[]): GameMap {
  return mapFromTiles(rows[0]!.length, rows.length, Uint8Array.from(rows.join(""), (c) => c === "#" ? 1 : 0));
}

/** Original division-based DDA, kept as an oracle while VisionMemory uses a validated-origin ray path. */
function referenceSightLine(map: GameMap, x: number, y: number, endX: number, endY: number): boolean {
  if (!Number.isFinite(x + y + endX + endY)) return false;
  const tileSize = TILE;
  let tx = Math.floor(x / tileSize), ty = Math.floor(y / tileSize);
  const ex = Math.floor(endX / tileSize), ey = Math.floor(endY / tileSize);
  if (ex < 0 || ey < 0 || ex >= map.w || ey >= map.h || isWallTile(map, tx, ty)) return false;
  const tiles = map.tiles, width = map.w;
  let index = ty * width + tx;
  const dx = endX - x, dy = endY - y;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  let crossX = dx === 0 ? Infinity : ((tx + (sx > 0 ? 1 : 0)) * tileSize - x) / dx;
  let crossY = dy === 0 ? Infinity : ((ty + (sy > 0 ? 1 : 0)) * tileSize - y) / dy;
  while (tx !== ex || ty !== ey) {
    if (crossX === crossY) {
      if ((tiles[index + sx]! & MASK_SIGHT) !== 0 || (tiles[index + sy * width]! & MASK_SIGHT) !== 0) return false;
      tx += sx; ty += sy;
      index += sx + sy * width;
      crossX = dx === 0 ? Infinity : ((tx + (sx > 0 ? 1 : 0)) * tileSize - x) / dx;
      crossY = dy === 0 ? Infinity : ((ty + (sy > 0 ? 1 : 0)) * tileSize - y) / dy;
    } else if (crossX < crossY) {
      tx += sx;
      index += sx;
      crossX = ((tx + (sx > 0 ? 1 : 0)) * tileSize - x) / dx;
    } else {
      ty += sy;
      index += sy * width;
      crossY = ((ty + (sy > 0 ? 1 : 0)) * tileSize - y) / dy;
    }
    if (tx === ex && ty === ey) return true;
    if ((tiles[index]! & MASK_SIGHT) !== 0) return false;
  }
  return true;
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

  it("matches the original ray traversal for randomized exact and fractional endpoints", () => {
    const random = mulberry32(0x71e5), w = 80, h = 64, tiles = new Uint8Array(w * h);
    for (let i = 0; i < tiles.length; i++) tiles[i] = random() < 0.22 ? 1 : 0;
    const map = mapFromTiles(w, h, tiles);
    for (let i = 0; i < 40_000; i++) {
      // Exact tile centers stress corner ties; fractional coordinates cover moving origins and f32-like endpoints.
      const point = (): { x: number; y: number } => random() < 0.5
        ? at(Math.floor(random() * w), Math.floor(random() * h))
        : { x: random() * w * TILE, y: random() * h * TILE };
      const from = point(), to = point();
      expect(hasVisionLineOfSight(map, from, to), `ray ${i}: ${JSON.stringify([from, to])}`)
        .toBe(referenceSightLine(map, from.x, from.y, to.x, to.y));
    }

    // VisionMemory's batched ray path must expose the same cells as the standalone/original traversal.
    for (const origin of [at(2, 2), { x: 18.23 * TILE, y: 21.71 * TILE }, { x: 77.5 * TILE, y: 62.5 * TILE }]) {
      const radius = 17 * TILE, now = 500;
      const memory = new VisionMemory(w, h);
      memory.update(map, origin, now, 1000, radius);
      for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) {
        const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
        const dx = x - origin.x, dy = y - origin.y;
        const expected = dx * dx + dy * dy <= radius * radius && referenceSightLine(map, origin.x, origin.y, x, y);
        expect(memory.canSee({ x, y }, now), `memory tile ${tx},${ty} from ${JSON.stringify(origin)}`).toBe(expected);
      }
    }
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
  it("reveals the whole large coliseum plus ordinary sight while inside, and no arena shortcut from outside", () => {
    const map = mapFromTiles(80, 60, new Uint8Array(80 * 60));
    map.coliseum.rect = { x: 10, y: 10, w: 45, h: 35 };
    for (let y = 10; y < 45; y++) for (let x = 10; x < 55; x++) map.regionGrid[y * map.w + x] = REGION_COLISEUM;
    for (let y = 10; y < 45; y++) map.tiles[y * map.w + 32] = 1;
    const memory = new VisionMemory(map.w, map.h), origin = at(20, 25);
    memory.update(map, origin, 100);
    expect(memory.canSee(at(50, 25), 100)).toBe(true); // across a wall and beyond 900 units
    expect(memory.canSee(at(20, 26), 100)).toBe(true); // normal circular vision still applies
    expect(memory.canSee(at(65, 25), 100)).toBe(false); // outside the footprint and circle
    memory.clear();
    memory.update(map, at(2, 25), 200);
    expect(memory.canSee(at(50, 25), 200)).toBe(false);
  });
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

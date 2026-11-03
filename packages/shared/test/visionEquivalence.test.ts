import { describe, expect, it } from "vitest";
import { TILE, VISION_RADIUS } from "../src/constants";
import { generateMap } from "../src/mapgen";
import { inColiseum, isWallTile, MASK_SIGHT, withGates, type GameMap } from "../src/map";
import { mulberry32 } from "../src/rng";
import { VisionMemory } from "../src/vision";

// The pre-optimisation tracer and update loop, kept verbatim as the reference.
function oldTrace(map: GameMap, x: number, y: number, endX: number, endY: number, tx: number, ty: number, ex: number, ey: number): boolean {
  const tiles = map.tiles, width = map.w;
  let index = ty * width + tx;
  const dx = endX - x, dy = endY - y;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  let crossX = dx === 0 ? Infinity : ((tx + (sx > 0 ? 1 : 0)) * TILE - x) / dx;
  let crossY = dy === 0 ? Infinity : ((ty + (sy > 0 ? 1 : 0)) * TILE - y) / dy;
  while (tx !== ex || ty !== ey) {
    if (crossX === crossY) {
      if ((tiles[index + sx]! & MASK_SIGHT) !== 0 || (tiles[index + sy * width]! & MASK_SIGHT) !== 0) return false;
      tx += sx; ty += sy;
      index += sx + sy * width;
      crossX = dx === 0 ? Infinity : ((tx + (sx > 0 ? 1 : 0)) * TILE - x) / dx;
      crossY = dy === 0 ? Infinity : ((ty + (sy > 0 ? 1 : 0)) * TILE - y) / dy;
    } else if (crossX < crossY) {
      tx += sx; index += sx;
      crossX = ((tx + (sx > 0 ? 1 : 0)) * TILE - x) / dx;
    } else {
      ty += sy; index += sy * width;
      crossY = ((ty + (sy > 0 ? 1 : 0)) * TILE - y) / dy;
    }
    if (tx === ex && ty === ey) return true;
    if ((tiles[index]! & MASK_SIGHT) !== 0) return false;
  }
  return true;
}

function oldReveal(map: GameMap, o: { x: number; y: number }, until: number, radius: number): Float64Array {
  const out = new Float64Array(map.w * map.h);
  const arena = inColiseum(map, o.x, o.y) ? map.coliseum.rect : null;
  if (arena) {
    for (let ty = Math.max(0, arena.y); ty < Math.min(map.h, arena.y + arena.h); ty++)
      for (let tx = Math.max(0, arena.x); tx < Math.min(map.w, arena.x + arena.w); tx++) out[ty * map.w + tx] = until;
  }
  const minX = Math.max(0, Math.floor((o.x - radius) / TILE)), maxX = Math.min(map.w - 1, Math.floor((o.x + radius) / TILE));
  const minY = Math.max(0, Math.floor((o.y - radius) / TILE)), maxY = Math.min(map.h - 1, Math.floor((o.y + radius) / TILE));
  const otx = Math.floor(o.x / TILE), oty = Math.floor(o.y / TILE);
  const ok = otx >= 0 && oty >= 0 && otx < map.w && oty < map.h && !isWallTile(map, otx, oty);
  if (!ok) return out;
  for (let ty = minY; ty <= maxY; ty++) for (let tx = minX; tx <= maxX; tx++) {
    if (arena && tx >= arena.x && tx < arena.x + arena.w && ty >= arena.y && ty < arena.y + arena.h) continue;
    const dx = (tx + 0.5) * TILE - o.x, dy = (ty + 0.5) * TILE - o.y;
    if (dx * dx + dy * dy > radius * radius || !oldTrace(map, o.x, o.y, (tx + 0.5) * TILE, (ty + 0.5) * TILE, otx, oty, tx, ty)) continue;
    out[ty * map.w + tx] = until;
  }
  out[oty * map.w + otx] = until;
  return out;
}

describe("vision update equivalence", () => {
  it("reveals exactly the cells and deadlines of the per-tile ray trace", () => {
    let checked = 0;
    for (const seed of [1, 42]) {
      const base = generateMap(seed);
      const rng = mulberry32(seed * 31 + 5);
      for (const map of [base, withGates(base)]) {
        const memory = new VisionMemory(map.w, map.h);
        const cases: { x: number; y: number }[] = [];
        for (let n = 0; n < 30; n++) cases.push({ x: rng() * map.w * TILE, y: rng() * map.h * TILE });
        // Next to walls and on exact tile edges and corners.
        for (let n = 0; n < 30; n++) {
          const tx = Math.floor(rng() * map.w), ty = Math.floor(rng() * map.h);
          const e = [0, 0.0001, 0.5, 0.9999, 1][Math.floor(rng() * 5)]!, f = [0, 0.0001, 0.5, 0.9999, 1][Math.floor(rng() * 5)]!;
          cases.push({ x: (tx + e) * TILE, y: (ty + f) * TILE });
        }
        for (const g of map.coliseum.gates) for (const t of g.tiles) cases.push({ x: (t.x + 0.5) * TILE, y: (t.y + 0.5) * TILE });
        let now = 1000;
        for (const origin of cases) {
          for (const radius of [VISION_RADIUS, 5 * TILE + 3]) {
            memory.clear();
            memory.update(map, origin, now, 60_000, radius);
            expect(memory.expiresAt).toEqual(oldReveal(map, origin, now + 60_000, radius));
            now += 1000;
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(240);
  });
});

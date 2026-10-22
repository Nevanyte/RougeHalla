import { describe, expect, it, vi } from "vitest";
import { EXTRACT_RADIUS, MAP_TILES_H, MAP_TILES_W, TILE } from "../src/constants";
import { TILE_FLOOR, TILE_WALL, isWallTile, tileToWorldCenter, worldToTile } from "../src/map";
import type { GameMap, TileRect } from "../src/map";
import { generateMap } from "../src/mapgen";

const seeds = (n: number, from = 0) => Array.from({ length: n }, (_, i) => from + i);
const tile = (v: number) => worldToTile(v);
const isFloorTile = (m: GameMap, tx: number, ty: number) => !isWallTile(m, tx, ty);
const inRect = (b: TileRect, tx: number, ty: number) => tx >= b.x && tx < b.x + b.w && ty >= b.y && ty < b.y + b.h;
const inAnyBuilding = (m: GameMap, tx: number, ty: number) => m.buildings.some((b) => inRect(b, tx, ty));
const cheb = (ax: number, ay: number, bx: number, by: number) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

function floorComponents(m: GameMap): number {
  const seen = new Uint8Array(m.w * m.h);
  let comps = 0;
  for (let i = 0; i < m.tiles.length; i++) {
    if (m.tiles[i] !== TILE_FLOOR || seen[i]) continue;
    comps++;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % m.w, y = (c - x) / m.w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
        const j = ny * m.w + nx;
        if (m.tiles[j] === TILE_FLOOR && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
  }
  return comps;
}

/** Floor runs along each side of a building's outer wall ring: side 0 top, 1 right, 2 bottom, 3 left. */
function doorRuns(m: GameMap, b: TileRect): { side: number; start: number; len: number }[] {
  const runs: { side: number; start: number; len: number }[] = [];
  for (let side = 0; side < 4; side++) {
    const len = side % 2 === 0 ? b.w : b.h;
    let runStart = -1;
    for (let i = 0; i <= len; i++) {
      let floor = false;
      if (i < len) {
        const tx = side === 0 || side === 2 ? b.x + i : side === 1 ? b.x + b.w - 1 : b.x;
        const ty = side === 1 || side === 3 ? b.y + i : side === 0 ? b.y : b.y + b.h - 1;
        floor = isFloorTile(m, tx, ty);
      }
      if (floor && runStart < 0) runStart = i;
      if (!floor && runStart >= 0) { runs.push({ side, start: runStart, len: i - runStart }); runStart = -1; }
    }
  }
  return runs;
}

function doorTiles(m: GameMap, b: TileRect): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = b.y; y < b.y + b.h; y++) {
    for (let x = b.x; x < b.x + b.w; x++) {
      const ring = x === b.x || y === b.y || x === b.x + b.w - 1 || y === b.y + b.h - 1;
      if (ring && isFloorTile(m, x, y)) out.push({ x, y });
    }
  }
  return out;
}

/** Outdoor wall chunks: 8-connected wall components that are neither border nor building. */
function obstacleChunks(m: GameMap): { x0: number; y0: number; x1: number; y1: number; size: number }[] {
  const seen = new Uint8Array(m.w * m.h);
  const chunks: { x0: number; y0: number; x1: number; y1: number; size: number }[] = [];
  const outdoorWall = (x: number, y: number) =>
    x > 0 && y > 0 && x < m.w - 1 && y < m.h - 1 && m.tiles[y * m.w + x] === TILE_WALL && !inAnyBuilding(m, x, y);
  for (let y = 1; y < m.h - 1; y++) {
    for (let x = 1; x < m.w - 1; x++) {
      if (!outdoorWall(x, y) || seen[y * m.w + x]) continue;
      const c = { x0: x, y0: y, x1: x, y1: y, size: 0 };
      const stack = [[x, y]];
      seen[y * m.w + x] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        c.size++;
        c.x0 = Math.min(c.x0, cx); c.x1 = Math.max(c.x1, cx);
        c.y0 = Math.min(c.y0, cy); c.y1 = Math.max(c.y1, cy);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (outdoorWall(nx, ny) && !seen[ny * m.w + nx]) { seen[ny * m.w + nx] = 1; stack.push([nx, ny]); }
          }
        }
      }
      chunks.push(c);
    }
  }
  return chunks;
}

describe("determinism", () => {
  it("same seed gives byte-identical tiles and deep-equal everything else (50 seeds)", () => {
    for (const s of seeds(50)) {
      const a = generateMap(s);
      generateMap(s + 1000); // no hidden state may leak between calls
      const b = generateMap(s);
      expect(Buffer.from(a.tiles).equals(Buffer.from(b.tiles))).toBe(true);
      expect(a).toEqual(b);
      expect(a.tiles).not.toBe(b.tiles);
      expect(a.seed).toBe(s);
    }
  });

  it("different seeds give different maps", () => {
    const hashes = new Set<string>();
    for (const s of seeds(50)) hashes.add(Buffer.from(generateMap(s).tiles).toString("base64"));
    expect(hashes.size).toBe(50);
    const a = generateMap(1), b = generateMap(2);
    expect(a.spawns).not.toEqual(b.spawns);
    expect(a.crateSpots).not.toEqual(b.crateSpots);
  });

  it("varies structure across seeds rather than just shifting a template", () => {
    const counts = new Set(seeds(60).map((s) => generateMap(s).buildings.length));
    expect(counts.size).toBeGreaterThanOrEqual(4);
  });

  it("never calls Math.random", () => {
    const spy = vi.spyOn(Math, "random");
    try {
      for (const s of seeds(10)) generateMap(s);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("accepts unusual seeds deterministically", () => {
    for (const s of [0, -1, 2 ** 31, 2 ** 32 + 5, 123456789]) {
      expect(generateMap(s)).toEqual(generateMap(s));
    }
  });
});

describe("tile grid", () => {
  it("is 64x64, row-major, and the border ring is wall (200 seeds)", () => {
    for (const s of seeds(200)) {
      const m = generateMap(s);
      expect(m.w).toBe(MAP_TILES_W);
      expect(m.h).toBe(MAP_TILES_H);
      expect(m.tiles).toBeInstanceOf(Uint8Array);
      expect(m.tiles.length).toBe(MAP_TILES_W * MAP_TILES_H);
      for (let i = 0; i < m.tiles.length; i++) expect(m.tiles[i] === TILE_FLOOR || m.tiles[i] === TILE_WALL).toBe(true);
      for (let x = 0; x < m.w; x++) {
        expect(m.tiles[x]).toBe(TILE_WALL);
        expect(m.tiles[(m.h - 1) * m.w + x]).toBe(TILE_WALL);
      }
      for (let y = 0; y < m.h; y++) {
        expect(m.tiles[y * m.w]).toBe(TILE_WALL);
        expect(m.tiles[y * m.w + m.w - 1]).toBe(TILE_WALL);
      }
    }
  });

  it("has all floor tiles in a single 4-connected component (200 seeds)", () => {
    for (const s of seeds(200)) expect(floorComponents(generateMap(s)), `seed ${s}`).toBe(1);
  });

  it("has a reasonable amount of open floor", () => {
    for (const s of seeds(50)) {
      const m = generateMap(s);
      const floor = m.tiles.reduce((n, v) => n + (v === TILE_FLOOR ? 1 : 0), 0);
      expect(floor / m.tiles.length).toBeGreaterThan(0.55);
      expect(floor / m.tiles.length).toBeLessThan(0.9);
    }
  });
});

describe("buildings", () => {
  it("has 8-12 buildings of 7-13 tiles, kept off the border and apart from each other (200 seeds)", () => {
    for (const s of seeds(200)) {
      const m = generateMap(s);
      expect(m.buildings.length).toBeGreaterThanOrEqual(8);
      expect(m.buildings.length).toBeLessThanOrEqual(12);
      for (const b of m.buildings) {
        expect(b.w).toBeGreaterThanOrEqual(7);
        expect(b.w).toBeLessThanOrEqual(13);
        expect(b.h).toBeGreaterThanOrEqual(7);
        expect(b.h).toBeLessThanOrEqual(13);
        // At least 3 open tiles between the border ring (tile 0) and the footprint.
        expect(b.x).toBeGreaterThanOrEqual(4);
        expect(b.y).toBeGreaterThanOrEqual(4);
        expect(b.x + b.w).toBeLessThanOrEqual(MAP_TILES_W - 4);
        expect(b.y + b.h).toBeLessThanOrEqual(MAP_TILES_H - 4);
      }
      for (let i = 0; i < m.buildings.length; i++) {
        for (let j = i + 1; j < m.buildings.length; j++) {
          const a = m.buildings[i], b = m.buildings[j];
          const gapX = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w));
          const gapY = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h));
          expect(Math.max(gapX, gapY), `seed ${s} buildings ${i},${j}`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it("has solid 1-thick wall rings with 1-3 two-wide doors on distinct sides, never on corners (200 seeds)", () => {
    for (const s of seeds(200)) {
      const m = generateMap(s);
      for (const b of m.buildings) {
        const runs = doorRuns(m, b);
        const sides = new Set(runs.map((r) => r.side));
        expect(sides.size, `seed ${s}: one door per side`).toBe(runs.length);
        expect(runs.length).toBeGreaterThanOrEqual(1);
        expect(runs.length).toBeLessThanOrEqual(3);
        for (const r of runs) {
          expect(r.len).toBe(2);
          const sideLen = r.side % 2 === 0 ? b.w : b.h;
          expect(r.start).toBeGreaterThanOrEqual(1);
          expect(r.start + r.len).toBeLessThanOrEqual(sideLen - 1);
        }
        for (const [cx, cy] of [[b.x, b.y], [b.x + b.w - 1, b.y], [b.x, b.y + b.h - 1], [b.x + b.w - 1, b.y + b.h - 1]]) {
          expect(isWallTile(m, cx, cy)).toBe(true);
        }
        // Interior is mostly open: the ring is one tile thick, so tile just inside a wall mid-side is floor or a partition.
        const interior = (b.w - 2) * (b.h - 2);
        let open = 0;
        for (let y = b.y + 1; y < b.y + b.h - 1; y++) for (let x = b.x + 1; x < b.x + b.w - 1; x++) if (isFloorTile(m, x, y)) open++;
        expect(open / interior).toBeGreaterThan(0.6);
      }
    }
  });

  it("sometimes carves interior partitions", () => {
    let withPartition = 0;
    for (const s of seeds(40)) {
      const m = generateMap(s);
      for (const b of m.buildings) {
        let interiorWalls = 0;
        for (let y = b.y + 1; y < b.y + b.h - 1; y++) for (let x = b.x + 1; x < b.x + b.w - 1; x++) if (!isFloorTile(m, x, y)) interiorWalls++;
        if (interiorWalls > 0) withPartition++;
      }
    }
    expect(withPartition).toBeGreaterThan(20);
  });
});

describe("obstacles", () => {
  it("has 15-30 small chunks that avoid the border and buildings (200 seeds)", () => {
    for (const s of seeds(200)) {
      const m = generateMap(s);
      const chunks = obstacleChunks(m);
      expect(chunks.length, `seed ${s}`).toBeGreaterThanOrEqual(15);
      expect(chunks.length).toBeLessThanOrEqual(30);
      for (const c of chunks) {
        const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
        expect(c.size).toBe(w * h); // a filled rectangle
        expect(Math.min(w, h)).toBeLessThanOrEqual(2);
        expect(Math.max(w, h)).toBeLessThanOrEqual(3);
        expect(c.x0).toBeGreaterThanOrEqual(4);
        expect(c.y0).toBeGreaterThanOrEqual(4);
        expect(c.x1).toBeLessThanOrEqual(MAP_TILES_W - 5);
        expect(c.y1).toBeLessThanOrEqual(MAP_TILES_H - 5);
        for (const b of m.buildings) {
          // Not touching: even diagonally.
          const gapX = Math.max(c.x0 - (b.x + b.w - 1), b.x - c.x1) - 1;
          const gapY = Math.max(c.y0 - (b.y + b.h - 1), b.y - c.y1) - 1;
          expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });
});

describe("spawns", () => {
  it("has 12 distinct outdoor tile centres whose 8 neighbours are floor (200 seeds)", () => {
    for (const s of seeds(200)) {
      const m = generateMap(s);
      expect(m.spawns.length).toBe(12);
      expect(new Set(m.spawns.map((p) => `${p.x},${p.y}`)).size).toBe(12);
      for (const p of m.spawns) {
        const tx = tile(p.x), ty = tile(p.y);
        expect(p.x).toBe(tileToWorldCenter(tx));
        expect(p.y).toBe(tileToWorldCenter(ty));
        expect(inAnyBuilding(m, tx, ty)).toBe(false);
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) expect(isFloorTile(m, tx + i, ty + j)).toBe(true);
      }
    }
  });

  it("are well spread: farthest-point order means nearest-previous distance never increases", () => {
    for (const s of seeds(100)) {
      const m = generateMap(s);
      const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
      let prev = Infinity;
      for (let k = 1; k < m.spawns.length; k++) {
        let nearest = Infinity;
        for (let j = 0; j < k; j++) nearest = Math.min(nearest, d(m.spawns[k], m.spawns[j]));
        expect(nearest).toBeLessThanOrEqual(prev + 1e-9);
        prev = nearest;
      }
      // Loose absolute floor: no two spawns closer than 8 tiles.
      expect(prev).toBeGreaterThanOrEqual(8 * TILE);
    }
  });
});

describe("extracts", () => {
  const edgeOf = (m: GameMap, e: { x: number; y: number }) => {
    const tx = tile(e.x), ty = tile(e.y);
    const dist = [ty, m.w - 1 - tx, m.h - 1 - ty, tx];
    const min = Math.min(...dist);
    return { edge: dist.indexOf(min), tilesIn: min };
  };

  it("has 3 zones on 3 different edges, 3-5 tiles in, with a clear 5x5 floor patch (200 seeds)", () => {
    const names = ["North Gate", "East Docks", "South Tunnel", "West Road"];
    for (const s of seeds(200)) {
      const m = generateMap(s);
      expect(m.extracts.map((e) => e.id)).toEqual(["x1", "x2", "x3"]);
      const edges = new Set<number>();
      for (const e of m.extracts) {
        expect(e.r).toBe(EXTRACT_RADIUS);
        const { edge, tilesIn } = edgeOf(m, e);
        edges.add(edge);
        expect(tilesIn).toBeGreaterThanOrEqual(3);
        expect(tilesIn).toBeLessThanOrEqual(5);
        // World-space distance of the centre from its edge is also within 3-5 tiles.
        const worldIn = [e.y, m.w * TILE - e.x, m.h * TILE - e.y, e.x][edge] / TILE;
        expect(worldIn).toBeGreaterThanOrEqual(3);
        expect(worldIn).toBeLessThanOrEqual(5);
        expect(e.name).toBe(names[edge]);
        const tx = tile(e.x), ty = tile(e.y);
        expect(e.x).toBe(tileToWorldCenter(tx));
        expect(e.y).toBe(tileToWorldCenter(ty));
        for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) expect(isFloorTile(m, tx + i, ty + j), `seed ${s} ${e.id}`).toBe(true);
      }
      expect(edges.size).toBe(3);
    }
  });

  it("keeps spawns out of the extract zones", () => {
    for (const s of seeds(100)) {
      const m = generateMap(s);
      for (const sp of m.spawns) for (const e of m.extracts) expect(Math.hypot(sp.x - e.x, sp.y - e.y)).toBeGreaterThan(e.r * 2);
    }
  });
});

describe("crate spots", () => {
  it("has 2-4 per building, interior, against a wall, away from doors, no duplicates (200 seeds)", () => {
    for (const s of seeds(200)) {
      const m = generateMap(s);
      const keys = m.crateSpots.map((p) => `${p.x},${p.y}`);
      expect(new Set(keys).size).toBe(keys.length);
      let total = 0;
      for (const b of m.buildings) {
        const doors = doorTiles(m, b);
        const mine = m.crateSpots.filter((p) => inRect(b, tile(p.x), tile(p.y)));
        expect(mine.length, `seed ${s}`).toBeGreaterThanOrEqual(2);
        expect(mine.length).toBeLessThanOrEqual(4);
        total += mine.length;
        for (const p of mine) {
          const tx = tile(p.x), ty = tile(p.y);
          expect(p.x).toBe(tileToWorldCenter(tx));
          expect(p.y).toBe(tileToWorldCenter(ty));
          // Strictly inside the wall ring.
          expect(tx).toBeGreaterThan(b.x);
          expect(tx).toBeLessThan(b.x + b.w - 1);
          expect(ty).toBeGreaterThan(b.y);
          expect(ty).toBeLessThan(b.y + b.h - 1);
          expect(isFloorTile(m, tx, ty)).toBe(true);
          expect(
            isWallTile(m, tx - 1, ty) || isWallTile(m, tx + 1, ty) || isWallTile(m, tx, ty - 1) || isWallTile(m, tx, ty + 1),
          ).toBe(true);
          for (const d of doors) expect(cheb(tx, ty, d.x, d.y)).toBeGreaterThanOrEqual(2);
        }
      }
      expect(total).toBe(m.crateSpots.length);
    }
  });
});

describe("ground spots", () => {
  it("has 20-30 outdoor floor tile centres at least 3 tiles from every spawn (200 seeds)", () => {
    for (const s of seeds(200)) {
      const m = generateMap(s);
      expect(m.groundSpots.length).toBeGreaterThanOrEqual(20);
      expect(m.groundSpots.length).toBeLessThanOrEqual(30);
      expect(new Set(m.groundSpots.map((p) => `${p.x},${p.y}`)).size).toBe(m.groundSpots.length);
      for (const p of m.groundSpots) {
        const tx = tile(p.x), ty = tile(p.y);
        expect(p.x).toBe(tileToWorldCenter(tx));
        expect(p.y).toBe(tileToWorldCenter(ty));
        expect(isFloorTile(m, tx, ty)).toBe(true);
        expect(inAnyBuilding(m, tx, ty)).toBe(false);
        for (const sp of m.spawns) expect(Math.hypot(p.x - sp.x, p.y - sp.y)).toBeGreaterThanOrEqual(3 * TILE);
      }
    }
  });
});

describe("performance", () => {
  it("generates a map in well under 20 ms on average", () => {
    for (let i = 0; i < 10; i++) generateMap(i); // warm up the JIT
    const runs = 50;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) generateMap(10_000 + i);
    const avg = (performance.now() - t0) / runs;
    expect(avg).toBeLessThan(20);
  });
});

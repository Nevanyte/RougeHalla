// walkField16, descentPath and segmentBlocked (contract 3.2, WP0k): the 5-7-11 walk field the pool pick and the route guards use.
// The field is checked against an independent reference (Bellman-Ford over the 16 moves, legality by geometry.raycast on the
// real tile centres: a move is legal when its straight segment meets no blocked tile), so neither the move tables nor the
// bucket queue can agree with themselves by accident.
import { describe, expect, it } from "vitest";
import { TILE } from "../src/constants";
import { raycast } from "../src/geometry";
import { descentPath, segmentBlocked, walkField16 } from "../src/gridTopology";
import { MASK_MELEE, MASK_MOVE, MASK_SIGHT, TILE_FLOOR, TILE_LOW, TILE_WALL } from "../src/map";
import type { GameMap } from "../src/map";
import { mulberry32 } from "../src/rng";

const MOVES: Array<[number, number, number]> = [
  [1, 0, 5], [-1, 0, 5], [0, 1, 5], [0, -1, 5],
  [1, 1, 7], [1, -1, 7], [-1, 1, 7], [-1, -1, 7],
  [2, 1, 11], [2, -1, 11], [-2, 1, 11], [-2, -1, 11], [1, 2, 11], [-1, 2, 11], [1, -2, 11], [-1, -2, 11],
];

const mapOf = (tiles: Uint8Array, w: number, h: number): GameMap => ({ tiles, w, h }) as unknown as GameMap;

/** Is the move from tile (x, y) by (dx, dy) legal on real geometry: both tiles floor and the centre-to-centre segment meets nothing. */
function legal(map: GameMap, x: number, y: number, dx: number, dy: number): boolean {
  const nx = x + dx, ny = y + dy;
  if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) return false;
  if (map.tiles[ny * map.w + nx] !== TILE_FLOOR || map.tiles[y * map.w + x] !== TILE_FLOOR) return false;
  return !raycast(map, (x + 0.5) * TILE, (y + 0.5) * TILE, (nx + 0.5) * TILE, (ny + 0.5) * TILE, MASK_MOVE).hit;
}

/** Bellman-Ford to a fixed point: an independent implementation of the same metric. */
function reference(tiles: Uint8Array, w: number, h: number, seeds: number[], values: number[], scope: Uint8Array | null): Int32Array {
  const map = mapOf(tiles, w, h);
  const INF = 1 << 30;
  const d = new Int32Array(w * h).fill(INF);
  seeds.forEach((s, k) => { if (tiles[s] === TILE_FLOOR && values[k] < d[s]) d[s] = values[k]; });
  // legality of every move, once
  const ok: boolean[][] = Array.from({ length: w * h }, () => []);
  for (let i = 0; i < w * h; i++) {
    if (tiles[i] !== TILE_FLOOR) continue;
    const x = i % w, y = (i - x) / w;
    ok[i] = MOVES.map(([dx, dy]) => legal(map, x, y, dx, dy));
  }
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < w * h; i++) {
      if (d[i] === INF) continue;
      const x = i % w, y = (i - x) / w;
      MOVES.forEach(([dx, dy, c], m) => {
        if (!ok[i][m]) return;
        const j = (y + dy) * w + x + dx;
        if (scope && scope[j] !== 1) return;
        if (d[i] + c < d[j]) { d[j] = d[i] + c; changed = true; }
      });
    }
  }
  return d.map((v) => (v === INF ? -1 : v)) as Int32Array;
}

function randomGrid(seed: number, w: number, h: number, wallP: number, lowP: number): Uint8Array {
  const r = mulberry32(seed);
  const t = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const v = r();
    t[i] = v < wallP ? TILE_WALL : v < wallP + lowP ? TILE_LOW : TILE_FLOOR;
  }
  for (let x = 0; x < w; x++) { t[x] = TILE_WALL; t[(h - 1) * w + x] = TILE_WALL; }
  for (let y = 0; y < h; y++) { t[y * w] = TILE_WALL; t[y * w + w - 1] = TILE_WALL; }
  return t;
}

const grid = (rows: string[]): { tiles: Uint8Array; w: number; h: number } => {
  const h = rows.length, w = rows[0].length;
  const tiles = new Uint8Array(w * h);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { tiles[y * w + x] = ch === "#" ? TILE_WALL : ch === "~" ? TILE_LOW : TILE_FLOOR; }));
  return { tiles, w, h };
};

describe("walkField16", () => {
  it("equals a reference Dijkstra on 20 random grids (seed values, scopes and all)", () => {
    for (let g = 0; g < 20; g++) {
      const r = mulberry32(900 + g);
      const w = 22 + Math.floor(r() * 24), h = 22 + Math.floor(r() * 24);
      const tiles = randomGrid(5000 + g, w, h, 0.1 + 0.25 * r(), 0.05 * r());
      const floor: number[] = [];
      for (let i = 0; i < w * h; i++) if (tiles[i] === TILE_FLOOR) floor.push(i);
      const nSeeds = 1 + Math.floor(r() * 4);
      const seeds: number[] = [];
      for (let k = 0; k < nSeeds; k++) seeds.push(floor[Math.floor(r() * floor.length)]);
      const withValues = g % 2 === 1;
      const values = seeds.map(() => (withValues ? Math.floor(r() * 400) - 40 : 0));
      let scope: Uint8Array | null = null;
      if (g % 3 === 0) {
        scope = new Uint8Array(w * h);
        const x0 = Math.floor(r() * (w / 2)), y0 = Math.floor(r() * (h / 2)), x1 = x0 + 6 + Math.floor(r() * (w / 2)), y1 = y0 + 6 + Math.floor(r() * (h / 2));
        for (let y = y0; y < Math.min(h, y1); y++) for (let x = x0; x < Math.min(w, x1); x++) scope[y * w + x] = 1;
      }
      const got = walkField16(tiles, w, h, seeds, withValues ? values : undefined, scope ?? undefined);
      const want = reference(tiles, w, h, seeds, values, scope);
      let bad = -1;
      for (let i = 0; i < w * h && bad < 0; i++) if (got[i] !== want[i]) bad = i;
      expect(bad, `grid ${g} (${w}x${h}) tile ${bad}: got ${got[bad]}, want ${want[bad]}`).toBe(-1);
      // a sanity floor: the field reaches something (a scope can be shut off from every seed)
      if (!scope) expect(got.some((v) => v > 0)).toBe(true);
    }
  });

  it("is orthogonal 5, diagonal 7, knight 11 on open ground, and -1 on walls and LOW", () => {
    const { tiles, w, h } = grid([
      "#########",
      "#.......#",
      "#.......#",
      "#...~...#",
      "#.......#",
      "#.......#",
      "#########",
    ]);
    const c = 3 * w + 2;
    const f = walkField16(tiles, w, h, [c]);
    const at = (x: number, y: number): number => f[y * w + x];
    expect(at(2, 3)).toBe(0);
    expect(at(3, 3)).toBe(5); expect(at(2, 4)).toBe(5);
    expect(at(3, 4)).toBe(7);
    expect(at(4, 4)).toBe(11); // knight (2, 1)
    expect(at(3, 5)).toBe(11); // knight (1, 2)
    expect(at(5, 5)).toBe(18); // knight + diagonal
    expect(f[3 * w + 4]).toBe(-1);
    expect(f[0]).toBe(-1);
    expect(f.length).toBe(w * h);
  });

  it("does not cut corners: a diagonal needs both orthogonal cells free", () => {
    const { tiles, w, h } = grid([
      "#####",
      "#.#.#",
      "#...#",
      "#####",
    ]);
    // (1,1) and (3,1) are floor, (2,1) wall: from (1,1) the diagonal to (2,2)? (2,1) is wall -> blocked; the walk goes down first
    const f = walkField16(tiles, w, h, [1 * w + 1]);
    expect(f[2 * w + 1]).toBe(5);
    expect(f[2 * w + 2]).toBe(10); // not 7: through (1,2), not across the corner
    expect(f[1 * w + 3]).toBeGreaterThan(0);
    // and the same for a LOW corner
    const g = grid(["#####", "#.~.#", "#...#", "#####"]);
    const fg = walkField16(g.tiles, g.w, g.h, [1 * g.w + 1]);
    expect(fg[2 * g.w + 2]).toBe(10);
  });

  it("knight moves need the two cells their segment brushes, and only those", () => {
    // from (1,2) to (3,3): brushes (2,2) and (2,3)
    const open = ["#######", "#.....#", "#.....#", "#.....#", "#.....#", "#######"];
    const at = (rows: string[], x: number, y: number): number => {
      const { tiles, w, h } = grid(rows);
      return walkField16(tiles, w, h, [2 * w + 1])[y * w + x];
    };
    expect(at(open, 3, 3)).toBe(11);
    const block = (x: number, y: number): string[] => open.map((r, j) => (j === y ? r.slice(0, x) + "#" + r.slice(x + 1) : r));
    expect(at(block(2, 2), 3, 3)).toBeGreaterThan(11); // (sx, 0)
    expect(at(block(2, 3), 3, 3)).toBeGreaterThan(11); // (sx, sy)
    expect(at(block(3, 2), 3, 3)).toBe(11); // (2sx, 0) is not on the segment
    expect(at(block(1, 3), 3, 3)).toBe(11); // (0, sy) neither
    // the vertical orientation: from (2,1) to (3,3) brushes (2,2) and (3,2)
    const v = (rows: string[], x: number, y: number): number => {
      const { tiles, w, h } = grid(rows);
      return walkField16(tiles, w, h, [1 * w + 2])[y * w + x];
    };
    expect(v(open, 3, 3)).toBe(11);
    expect(v(block(2, 2), 3, 3)).toBeGreaterThan(11);
    expect(v(block(3, 2), 3, 3)).toBeGreaterThan(11);
    expect(v(block(1, 2), 3, 3)).toBe(11);
  });

  it("starts every seed at its value, takes the minimum, ignores seeds that are not floor, and ignores order", () => {
    const { tiles, w, h } = grid(["#########", "#.......#", "#.......#", "#########"]);
    const a = 1 * w + 1, b = 1 * w + 7;
    const f = walkField16(tiles, w, h, [a, b], [100, 20]);
    expect(f[a]).toBe(Math.min(100, 20 + 6 * 5));
    expect(f[b]).toBe(20);
    expect(f[1 * w + 4]).toBe(20 + 15);
    const g = walkField16(tiles, w, h, [b, a], [20, 100]);
    expect(Array.from(g)).toEqual(Array.from(f));
    // default value 0, a wall seed and an off-grid seed are ignored
    const d = walkField16(tiles, w, h, [a, 0, -3, 999]);
    expect(d[a]).toBe(0);
    expect(d[0]).toBe(-1);
    expect(Array.from(walkField16(tiles, w, h, [0]))).toEqual(new Array(w * h).fill(-1));
    expect(Array.from(walkField16(tiles, w, h, []))).toEqual(new Array(w * h).fill(-1));
    // negative values and values far apart (the bucket queue jumps)
    const far = walkField16(tiles, w, h, [a, b], [-7, 5000]);
    expect(far[a]).toBe(-7);
    expect(far[b]).toBe(-7 + 30);
    const jump = walkField16(tiles, w, h, [a, b], [0, 5000]);
    expect(jump[b]).toBe(30);
  });

  it("limits relaxation to the scope but lets seeds lie outside it, and reads corner cells from the tiles whatever the scope", () => {
    const { tiles, w, h } = grid(["#########", "#.......#", "#.......#", "#########"]);
    const scope = new Uint8Array(w * h);
    for (let y = 1; y <= 2; y++) for (let x = 3; x <= 5; x++) scope[y * w + x] = 1;
    // the seed at (1,1) is outside the scope; its neighbours at x = 2 are outside too: nothing is relaxed except by knight moves
    const f = walkField16(tiles, w, h, [1 * w + 2], [40], scope);
    expect(f[1 * w + 2]).toBe(40); // the seed keeps its own value
    expect(f[1 * w + 3]).toBe(45);
    expect(f[1 * w + 4]).toBe(50);
    expect(f[1 * w + 6]).toBe(-1); // outside the scope on the far side
    expect(f[1 * w + 1]).toBe(-1);
  });

  it("copes with a frontier far larger than its first queue (10,000 seeds at one value), and gives the same field again afterwards", () => {
    const w = 200, h = 200;
    const tiles = new Uint8Array(w * h);
    const seeds: number[] = [];
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) seeds.push(y * w + x);
    const f = walkField16(tiles, w, h, seeds);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const want = x % 2 === 0 && y % 2 === 0 ? 0 : x % 2 === 1 && y % 2 === 1 ? 7 : 5;
        if (f[y * w + x] !== want) throw new Error(`(${x},${y}) ${f[y * w + x]} against ${want}`);
      }
    }
    // an ordinary call after the big one
    const small = grid(["#####", "#...#", "#...#", "#####"]);
    const a = walkField16(small.tiles, small.w, small.h, [1 * small.w + 1]);
    expect(Array.from(a)).toEqual(Array.from(walkField16(small.tiles, small.w, small.h, [1 * small.w + 1])));
    expect(a[2 * small.w + 3]).toBe(11);
    // seeds with spread values: the queue holds many values at once
    const spread = walkField16(tiles, w, h, seeds, seeds.map((_, k) => (k * 7) % 40));
    for (let k = 0; k < seeds.length; k += 997) expect(spread[seeds[k]]).toBeLessThanOrEqual((k * 7) % 40);
  });

  it("is deterministic and leaves its inputs alone", () => {
    const tiles = randomGrid(31, 40, 40, 0.25, 0.03);
    const copy = tiles.slice();
    const floor = Array.from(tiles).map((v, i) => (v === TILE_FLOOR ? i : -1)).filter((i) => i >= 0);
    const seeds = [floor[3], floor[40], floor[99]];
    const a = walkField16(tiles, 40, 40, seeds, [3, 0, 50]);
    const b = walkField16(tiles, 40, 40, seeds, [3, 0, 50]);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(tiles)).toEqual(Array.from(copy));
  });
});

describe("descentPath", () => {
  it("walks the field down to a seed over legal moves, one strictly lower tile at a time", () => {
    for (let g = 0; g < 8; g++) {
      const w = 40, h = 36;
      const tiles = randomGrid(700 + g, w, h, 0.22, 0.03);
      const map = mapOf(tiles, w, h);
      const floor = Array.from(tiles).map((v, i) => (v === TILE_FLOOR ? i : -1)).filter((i) => i >= 0);
      const seed = floor[Math.floor(floor.length / 3)];
      const f = walkField16(tiles, w, h, [seed]);
      for (let k = 0; k < 25; k++) {
        const from = floor[(k * 37 + g * 11) % floor.length];
        const path = descentPath(f, tiles, w, h, from);
        expect(path[0]).toBe(from);
        if (f[from] < 0) { expect(path).toEqual([from]); continue; }
        expect(f[path[path.length - 1]]).toBe(0);
        let cost = 0;
        for (let s = 1; s < path.length; s++) {
          const a = path[s - 1], b = path[s];
          expect(f[b]).toBeLessThan(f[a]);
          const ax = a % w, ay = (a - ax) / w, bx = b % w, by = (b - bx) / w;
          const m = MOVES.find(([dx, dy]) => ax + dx === bx && ay + dy === by);
          expect(m, `step ${a} -> ${b} is a 16-neighbour move`).toBeDefined();
          expect(legal(map, ax, ay, bx - ax, by - ay), `step ${a} -> ${b} is legal`).toBe(true);
          cost += m![2];
        }
        expect(cost).toBeGreaterThanOrEqual(f[from]);
      }
    }
  });

  it("takes the lowest-index neighbour among equal lowest values, and stops at a seed or an unreachable start", () => {
    const { tiles, w, h } = grid(["#####", "#...#", "#...#", "#...#", "#####"]);
    // seed at (2,2): from (1,1) the orthogonal neighbours (2,1) and (1,2) are 10 away... the diagonal to the seed is 7
    const f = walkField16(tiles, w, h, [2 * w + 2]);
    expect(descentPath(f, tiles, w, h, 1 * w + 1)).toEqual([1 * w + 1, 2 * w + 2]);
    // two equal seeds: the descent from the middle of them goes to the lower index
    const g = walkField16(tiles, w, h, [1 * w + 1, 3 * w + 3]);
    const p = descentPath(g, tiles, w, h, 2 * w + 2);
    expect(p).toEqual([2 * w + 2, 1 * w + 1]);
    expect(descentPath(f, tiles, w, h, 0)).toEqual([0]);
    expect(descentPath(f, tiles, w, h, 2 * w + 2)).toEqual([2 * w + 2]);
  });
});

describe("segmentBlocked", () => {
  it("agrees with geometry.raycast on tile-centre segments, for every query mask", () => {
    let total = 0, blockedCount = 0;
    for (let g = 0; g < 6; g++) {
      const w = 36, h = 30;
      const tiles = randomGrid(1200 + g, w, h, 0.12 + 0.03 * g, 0.06);
      const map = mapOf(tiles, w, h);
      const r = mulberry32(40 + g);
      for (let k = 0; k < 1500; k++) {
        const ax = Math.floor(r() * (w + 2)) - 1, ay = Math.floor(r() * (h + 2)) - 1;
        // half the segments are short, so both answers are common
        const reach = k % 2 === 0 ? 5 : 40;
        const bx = Math.max(-1, Math.min(w, ax + Math.floor(r() * (2 * reach + 1)) - reach)), by = Math.max(-1, Math.min(h, ay + Math.floor(r() * (2 * reach + 1)) - reach));
        for (const mask of [MASK_SIGHT, MASK_MOVE, MASK_MELEE]) {
          const want = raycast(map, (ax + 0.5) * TILE, (ay + 0.5) * TILE, (bx + 0.5) * TILE, (by + 0.5) * TILE, mask).hit;
          const got = segmentBlocked(tiles, w, h, ax, ay, bx, by, mask);
          if (got !== want) throw new Error(`grid ${g} (${ax},${ay})-(${bx},${by}) mask ${mask}: segmentBlocked ${got}, raycast ${want}`);
          if (segmentBlocked(tiles, w, h, bx, by, ax, ay, mask) !== got) throw new Error(`asymmetric (${ax},${ay})-(${bx},${by})`);
          total++;
          if (got) blockedCount++;
        }
      }
    }
    expect(total).toBe(6 * 1500 * 3);
    // the sample must exercise both answers
    expect(blockedCount).toBeGreaterThan(total * 0.1);
    expect(total - blockedCount).toBeGreaterThan(total * 0.05);
  });

  it("defaults to MASK_SIGHT (a LOW tile does not block), counts a vertex as both tiles, and blocks on a wall start or end", () => {
    const { tiles, w, h } = grid([
      "######",
      "#....#",
      "#.~..#",
      "#....#",
      "######",
    ]);
    expect(segmentBlocked(tiles, w, h, 1, 2, 4, 2)).toBe(false); // across the LOW tile: sight passes
    expect(segmentBlocked(tiles, w, h, 1, 2, 4, 2, MASK_MOVE)).toBe(true);
    // a diagonal through a vertex between a wall and floor: both neighbours count
    const d = grid(["#####", "#.#.#", "#...#", "#####"]);
    expect(segmentBlocked(d.tiles, d.w, d.h, 1, 1, 2, 2)).toBe(true); // the wall at (2,1) is one of the two tiles at the vertex
    expect(segmentBlocked(d.tiles, d.w, d.h, 1, 2, 3, 2)).toBe(false);
    expect(segmentBlocked(d.tiles, d.w, d.h, 0, 0, 1, 1)).toBe(true); // wall start
    expect(segmentBlocked(d.tiles, d.w, d.h, 1, 1, 2, 1)).toBe(true); // wall end
    expect(segmentBlocked(d.tiles, d.w, d.h, 1, 1, 1, 1)).toBe(false); // a floor tile to itself
    expect(segmentBlocked(d.tiles, d.w, d.h, 0, 0, 0, 0)).toBe(true);
    expect(segmentBlocked(d.tiles, d.w, d.h, 1, 1, 9, 9)).toBe(true); // off the grid blocks
    expect(segmentBlocked(d.tiles, d.w, d.h, -1, 1, 1, 1)).toBe(true);
  });
});

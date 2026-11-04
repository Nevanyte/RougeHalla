// The placed barrier's shared rule (shared/barriers.ts): where a wall stands for an aim, which tiles it takes, the wire form of
// those tiles, and the collision overlay. The server's cast and the client's aim preview both run these.
import { describe, expect, it } from "vitest";
import {
  decodeCells, encodeCells, mapFromTiles, MASK_MOVE, MASK_SIGHT, TILE, TILE_FLOOR, TILE_LOW, TILE_WALL, wallCells, wallSegmentFor, withBarriers,
} from "../src/index";

const W = 20;
const H = 12;
function room(): ReturnType<typeof mapFromTiles> {
  const tiles = new Uint8Array(W * H).fill(TILE_FLOOR);
  for (let x = 0; x < W; x++) { tiles[x] = TILE_WALL; tiles[(H - 1) * W + x] = TILE_WALL; }
  for (let y = 0; y < H; y++) { tiles[y * W] = TILE_WALL; tiles[y * W + W - 1] = TILE_WALL; }
  return mapFromTiles(W, H, tiles);
}
const tc = (t: number) => t * TILE + TILE / 2;

describe("wallSegmentFor", () => {
  it("centres on the aim clamped to [minRange, range], square to the line from the caster, `length` long", () => {
    const s = wallSegmentFor({ x: 0, y: 0 }, { x: 1000, y: 0 }, 300, 50, 200);
    expect(s.cx).toBeCloseTo(300, 9);
    expect(s.cy).toBeCloseTo(0, 9);
    expect(s.x1).toBeCloseTo(300, 9);
    expect(s.x2).toBeCloseTo(300, 9);
    expect(Math.abs(s.y1 - s.y2)).toBeCloseTo(200, 9);
    const near = wallSegmentFor({ x: 0, y: 0 }, { x: 10, y: 0 }, 300, 50, 200);
    expect(near.cx).toBeCloseTo(50, 9);
  });

  it("aims along the facing for a cursor on the caster", () => {
    const s = wallSegmentFor({ x: 100, y: 100 }, { x: 100, y: 100 }, 300, 64, 100, Math.PI / 2);
    expect(s.cx).toBeCloseTo(100, 9);
    expect(s.cy).toBeCloseTo(164, 9);
  });
});

describe("wallCells", () => {
  it("is one tile thick along an axis and takes floor only", () => {
    const map = room();
    const cells = wallCells(map, wallSegmentFor({ x: tc(2), y: tc(5) }, { x: tc(8), y: tc(5) }, 400, 0, TILE * 5));
    const cols = new Set(cells.map((i) => i % W));
    expect([...cols]).toEqual([8]);
    expect(cells).toHaveLength(5);
    for (const i of cells) expect(map.tiles[i]).toBe(TILE_FLOOR);
    // Into the border wall: those tiles are skipped.
    const edge = wallCells(map, wallSegmentFor({ x: tc(2), y: tc(5) }, { x: tc(8), y: tc(5) }, 400, 0, TILE * 30));
    for (const i of edge) expect(map.tiles[i]).toBe(TILE_FLOOR);
    expect(edge.length).toBe(H - 2);
  });

  it("on a diagonal it is a closed staircase: no two consecutive tiles touch only at a corner", () => {
    const map = room();
    const seg = wallSegmentFor({ x: tc(3), y: tc(3) }, { x: tc(9), y: tc(7) }, 400, 0, TILE * 6);
    const set = new Set(wallCells(map, seg));
    for (const i of set) {
      const x = i % W, y = Math.floor(i / W);
      for (const [dx, dy] of [[1, 1], [1, -1]] as const) {
        const j = (y + dy) * W + (x + dx);
        if (!set.has(j)) continue;
        // A diagonal neighbour in the wall must share an orthogonal neighbour in it too, or a body could squeeze between.
        expect(set.has(y * W + x + dx) || set.has((y + dy) * W + x), `corner gap at ${x},${y}`).toBe(true);
      }
    }
  });
});

describe("the wire form and the overlay", () => {
  it("round-trips, and drops anything that is not a tile index", () => {
    const cells = [0, 35, 239, 47];
    expect(decodeCells(encodeCells(cells), W * H)).toEqual(cells);
    expect(decodeCells("", W * H)).toEqual([]);
    expect(decodeCells("zz,-1,5,9999", W * H)).toEqual([5]);
  });

  it("turns the floor tiles LOW (bodies stop, sight passes) on a copy, never the map", () => {
    const map = room();
    const i = 5 * W + 5;
    const over = withBarriers(map, [i, 0]);
    expect(over).not.toBe(map);
    expect(over.tiles[i]).toBe(TILE_LOW);
    expect(over.tiles[0]).toBe(TILE_WALL);
    expect(map.tiles[i]).toBe(TILE_FLOOR);
    expect(over.tiles[i]! & MASK_MOVE).not.toBe(0);
    expect(over.tiles[i]! & MASK_SIGHT).toBe(0);
  });
});

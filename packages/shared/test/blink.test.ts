import { describe, expect, it } from "vitest";
import {
  BLAZE_MIN_DIST, BLAZE_RANGE, BLINK_STEP, blinkLanding, circleClear, coliseumRingMask, findPath, floorComponents, generateMap,
  inColiseum, mapFromTiles, moveComponents, mulberry32, PLAYER_RADIUS, REGION_COLISEUM, segmentCrossesRing, TILE, TILE_FLOOR, TILE_LOW, TILE_WALL, withGates,
  type GameMap, type Vec2,
} from "../src/index";

const R = PLAYER_RADIUS;
const centre = (tx: number, ty: number): Vec2 => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
const tileOf = (map: GameMap, p: Vec2): number => Math.floor(p.y / TILE) * map.w + Math.floor(p.x / TILE);

/** A w x h map of floor inside a wall border. */
function room(w: number, h: number, walls: Array<[number, number, number, number]> = []): GameMap {
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) tiles[y * w + x] = x === 0 || y === 0 || x === w - 1 || y === h - 1 ? TILE_WALL : TILE_FLOOR;
  for (const [x0, y0, x1, y1] of walls) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles[y * w + x] = TILE_WALL;
  return mapFromTiles(w, h, tiles);
}

/**
 * A 30 x 20 room with a 10 x 10 "coliseum" block at tiles 10..19 x 5..14: its outer ring is wall, except a two tile gate in
 * the west side, (10, 9) and (10, 10), which is floor on this (open) map and wall in withGates(map). `marked` false builds
 * the same tiles with no coliseum region, so the ring rule has nothing to act on.
 */
function miniColiseum(marked: boolean): GameMap {
  const map = room(30, 20);
  const gate = [{ x: 10, y: 9 }, { x: 10, y: 10 }];
  for (let y = 5; y <= 14; y++) {
    for (let x = 10; x <= 19; x++) {
      if (marked) map.regionGrid[y * map.w + x] = REGION_COLISEUM;
      if (x === 10 || x === 19 || y === 5 || y === 14) map.tiles[y * map.w + x] = TILE_WALL;
    }
  }
  for (const t of gate) map.tiles[t.y * map.w + t.x] = TILE_FLOOR;
  map.coliseum = { ...map.coliseum, rect: { x: 10, y: 5, w: 10, h: 10 }, gates: [{ side: "w", tiles: gate, x: 336, y: 320 }] };
  return map;
}

describe("blinkLanding: open ground", () => {
  const map = room(20, 11);
  const from = centre(5, 5);

  it("lands exactly where the cursor is, within range", () => {
    expect(blinkLanding(map, false, from, { x: from.x + 200, y: from.y })).toEqual({ x: from.x + 200, y: from.y });
    expect(blinkLanding(map, false, from, { x: from.x, y: from.y - 100 })).toEqual({ x: from.x, y: from.y - 100 });
  });

  it("is capped at 300 u along the ray however far the cursor is", () => {
    expect(BLAZE_RANGE).toBe(300);
    expect(blinkLanding(map, false, from, { x: from.x + 1000, y: from.y })).toEqual({ x: from.x + 300, y: from.y });
    const big = room(30, 20);
    const p = blinkLanding(big, false, from, { x: from.x + 300, y: from.y + 400 })!;
    expect(Math.hypot(p.x - from.x, p.y - from.y)).toBeCloseTo(300, 9);
    expect((p.x - from.x) / 300).toBeCloseTo(0.6, 9);
    expect((p.y - from.y) / 300).toBeCloseTo(0.8, 9);
  });

  it("still blinks 64 u toward a cursor that is nearer, in the cursor's direction", () => {
    expect(BLAZE_MIN_DIST).toBe(64);
    expect(blinkLanding(map, false, from, { x: from.x + 20, y: from.y })).toEqual({ x: from.x + 64, y: from.y });
    const p = blinkLanding(map, false, from, { x: from.x - 10, y: from.y - 10 })!;
    expect(Math.hypot(p.x - from.x, p.y - from.y)).toBeCloseTo(64, 9);
    expect(p.x).toBeLessThan(from.x);
    expect(p.y).toBeLessThan(from.y);
    expect(p.x - from.x).toBeCloseTo(p.y - from.y, 9);
  });

  it("has no direction to a cursor within 1 u of the caster: refused", () => {
    expect(blinkLanding(map, false, from, from)).toBeNull();
    expect(blinkLanding(map, false, from, { x: from.x + 0.5, y: from.y })).toBeNull();
    expect(blinkLanding(map, false, from, { x: from.x + 0.7, y: from.y + 0.7 })).toBeNull();
    expect(blinkLanding(map, false, from, { x: from.x + 1, y: from.y })).toEqual({ x: from.x + 64, y: from.y });
  });

  it("refuses a point that is not a number", () => {
    expect(blinkLanding(map, false, from, { x: Number.NaN, y: 0 })).toBeNull();
    expect(blinkLanding(map, false, from, { x: Number.POSITIVE_INFINITY, y: from.y })).toBeNull();
    expect(blinkLanding(map, false, { x: Number.NaN, y: from.y }, { x: 10, y: 10 })).toBeNull();
  });

  it("steps back 4 u at a time from the far end (the cursor's own distance), so the landing sits on that lattice", () => {
    expect(BLINK_STEP).toBe(4);
    // A wall at x 416..448 with a gap in row 9. The cursor is 250.5 u away (x = 426.5, in the wall): the disc must clear x <= 404,
    // so d <= 228, and the farthest 250.5 - 4k that fits is 226.5, not a round number.
    const wall = room(20, 11, [[13, 1, 13, 8]]);
    expect(blinkLanding(wall, false, from, { x: from.x + 250.5, y: from.y })).toEqual({ x: from.x + 226.5, y: from.y });
  });

  it("honours a custom maximum and minimum", () => {
    expect(blinkLanding(map, false, from, { x: from.x + 500, y: from.y }, 100, 10)).toEqual({ x: from.x + 100, y: from.y });
    expect(blinkLanding(map, false, from, { x: from.x + 3, y: from.y }, 100, 10)).toEqual({ x: from.x + 10, y: from.y });
    expect(blinkLanding(map, false, from, { x: from.x + 500, y: from.y }, 5, 10)).toBeNull();
  });

  it("does not change its arguments, and gives the same answer twice", () => {
    const f = { x: 176, y: 176 }, t = { x: 400, y: 200 };
    const a = blinkLanding(map, false, f, t);
    const b = blinkLanding(map, false, f, t);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(f).toEqual({ x: 176, y: 176 });
    expect(t).toEqual({ x: 400, y: 200 });
  });
});

describe("blinkLanding: the map edge", () => {
  it("never lands off the map, or with the disc over its edge: a borderless map stops at the world boundary", () => {
    const w = 20, h = 11;
    const bare = mapFromTiles(w, h, new Uint8Array(w * h).fill(TILE_FLOOR));
    // x + 12 <= 640: the farthest lattice point from 560 with want 300 is 560 + 68 = 628 (the disc touches the edge, not over it).
    expect(blinkLanding(bare, false, centre(17, 5), { x: 1060, y: 176 })).toEqual({ x: 628, y: 176 });
    expect(blinkLanding(bare, false, centre(17, 5), { x: 400, y: 176 })).toEqual({ x: 400, y: 176 }); // back inland: the cursor itself
    // Too close to the edge to fit the minimum 64: refused.
    expect(blinkLanding(bare, false, { x: 600, y: 176 }, { x: 1200, y: 176 })).toBeNull();
    // Toward the top-left corner.
    expect(blinkLanding(bare, false, { x: 40, y: 40 }, { x: -1000, y: -1000 })).toBeNull();
    const up = blinkLanding(bare, false, { x: 300, y: 40 }, { x: 300, y: -400 });
    expect(up).toBeNull();
  });

  it("stops at the border wall of a walled room", () => {
    const map = room(20, 11);
    expect(blinkLanding(map, false, centre(17, 5), { x: 1060, y: 176 })).toBeNull(); // 560 + d <= 596 leaves d < 64
    // From tile 16: 528 + d <= 596 gives 68 (the disc just touches the wall tile).
    expect(blinkLanding(map, false, centre(16, 5), { x: 1060, y: 176 })).toEqual({ x: 596, y: 176 });
  });
});

describe("blinkLanding: through walls", () => {
  const from = { x: 272, y: 176 }; // tile (8, 5)
  const gapRowOnly = (x0: number, x1: number): GameMap => room(20, 11, [[x0, 1, x1, 8]]); // the wall leaves row 9 open

  it("crosses a thin wall to the floor beyond it", () => {
    const map = gapRowOnly(10, 10);
    expect(blinkLanding(map, false, from, { x: from.x + 200, y: from.y })).toEqual({ x: 472, y: 176 });
  });

  it("crosses a thicker wall when the far side is within reach", () => {
    const map = gapRowOnly(10, 13); // x 320..448
    expect(blinkLanding(map, false, from, { x: from.x + 200, y: from.y })).toEqual({ x: 472, y: 176 });
  });

  it("is refused when the whole reach is rock", () => {
    const map = gapRowOnly(10, 14); // x 320..480: 272 + 64 .. 272 + 200 never clears
    expect(blinkLanding(map, false, from, { x: from.x + 200, y: from.y })).toBeNull();
    // ...but a far cursor reaches the floor past it.
    expect(blinkLanding(map, false, from, { x: from.x + 400, y: from.y })).toEqual({ x: 572, y: 176 });
  });

  it("lands before a wall it cannot clear: the farthest clear lattice point on this side", () => {
    const map = gapRowOnly(13, 17); // x 416..576; 572 is inside
    // Clear on this side: x + 12 <= 416, x <= 404, d <= 132, which is on the 300 - 4k lattice.
    expect(blinkLanding(map, false, from, { x: from.x + 400, y: from.y })).toEqual({ x: 404, y: 176 });
  });

  it("never lands in a sealed pocket, and never leaves one", () => {
    const pocket: Array<[number, number, number, number]> = [[12, 3, 16, 3], [12, 7, 16, 7], [12, 4, 12, 6], [16, 4, 16, 6]];
    const map = room(30, 12, pocket); // the floor inside, tiles 13..15 x 4..6, is cut off from the rest
    expect(floorComponents(map)[tileOf(map, { x: 464, y: 176 })]).not.toBe(floorComponents(map)[tileOf(map, from)]);
    // From outside toward the pocket's middle: the interior would fit a disc (428 <= x <= 500) but is a different component.
    const p = blinkLanding(map, false, from, { x: from.x + 200, y: from.y })!;
    expect(p).toEqual({ x: 372, y: 176 });
    // From inside, no 64 u point fits in the pocket and none outside it counts.
    expect(blinkLanding(map, false, { x: 464, y: 176 }, { x: 664, y: 176 })).toBeNull();
    expect(blinkLanding(map, false, { x: 464, y: 176 }, { x: 264, y: 176 })).toBeNull();
  });

  it("refuses an origin inside rock or off the map", () => {
    const map = room(20, 11, [[10, 1, 10, 8]]);
    expect(blinkLanding(map, false, centre(10, 3), { x: 500, y: 100 })).toBeNull();
    expect(blinkLanding(map, false, { x: -5, y: 100 }, { x: 200, y: 100 })).toBeNull();
    expect(blinkLanding(map, false, { x: 10_000, y: 100 }, { x: 200, y: 100 })).toBeNull();
    expect(blinkLanding(map, false, { x: 100, y: 5 }, { x: 200, y: 100 })).toBeNull(); // the border row
  });
});

describe("floorComponents", () => {
  it("labels walls 0 and each 4-connected pocket of floor with its own number", () => {
    const map = room(12, 8, [[5, 1, 5, 6]]); // a wall column across every floor row: two rooms
    const lab = floorComponents(map);
    expect(lab).toHaveLength(12 * 8);
    expect(lab[0]).toBe(0);
    expect(lab[tileOf(map, centre(5, 3))]).toBe(0);
    expect(lab[tileOf(map, centre(2, 3))]).toBeGreaterThan(0);
    expect(lab[tileOf(map, centre(2, 3))]).not.toBe(lab[tileOf(map, centre(8, 3))]);
    const open = room(12, 8, [[5, 1, 5, 5]]); // the same column with row 6 open: one room
    const lab2 = floorComponents(open);
    expect(lab2[tileOf(open, centre(2, 3))]).toBe(lab2[tileOf(open, centre(8, 3))]);
  });

  it("joins tiles only across an edge, never across a corner", () => {
    const tiles = new Uint8Array(16).fill(TILE_WALL); // 4 x 4: two floor tiles touching at a corner
    tiles[1 * 4 + 1] = TILE_FLOOR;
    tiles[2 * 4 + 2] = TILE_FLOOR;
    const map = mapFromTiles(4, 4, tiles);
    const lab = floorComponents(map);
    expect(lab[5]).toBeGreaterThan(0);
    expect(lab[10]).toBeGreaterThan(0);
    expect(lab[5]).not.toBe(lab[10]);
  });

  it("is moveComponents shifted up by one: the same pockets, 0 for every tile bodies cannot stand on (walls and LOW)", () => {
    const styled = generateMap(5);
    expect(styled.tiles.some((t) => t === TILE_LOW)).toBe(true);
    for (const map of [generateMap(7), generateMap(12), styled, withGates(generateMap(7)), room(12, 8, [[5, 1, 5, 6]])]) {
      const lab = floorComponents(map), comp = moveComponents(map);
      expect(lab).toHaveLength(comp.length);
      for (let i = 0; i < comp.length; i++) {
        if (lab[i] !== comp[i]! + 1) throw new Error(`tile ${i}: label ${lab[i]} against component ${comp[i]}`);
        if (map.tiles[i] !== TILE_FLOOR) expect(lab[i]).toBe(0);
      }
    }
  });

  it("is cached per map object, and the locked copy has its own, with the arena sealed", () => {
    const map = generateMap(7);
    const open = floorComponents(map);
    expect(floorComponents(map)).toBe(open);
    const locked = withGates(map);
    const sealed = floorComponents(locked);
    expect(sealed).not.toBe(open);
    expect(floorComponents(locked)).toBe(sealed);
    const inside = tileOf(map, map.coliseum.centre);
    const outside = tileOf(map, map.spawns[0]!);
    expect(open[inside]).toBe(open[outside]); // the gates connect them
    expect(sealed[inside]).toBeGreaterThan(0);
    expect(sealed[outside]).toBeGreaterThan(0);
    expect(sealed[inside]).not.toBe(sealed[outside]); // locked: the arena is its own pocket
  });
});

describe("coliseumRingMask", () => {
  it("is the coliseum tiles with an 8-neighbour outside it, gates included, and cached", () => {
    const map = miniColiseum(true);
    const ring = coliseumRingMask(map);
    expect(ring).toHaveLength(30 * 20);
    expect([...ring].reduce((n, v) => n + v, 0)).toBe(36);
    for (let y = 5; y <= 14; y++) {
      for (let x = 10; x <= 19; x++) expect(ring[y * 30 + x], `${x},${y}`).toBe(x === 10 || x === 19 || y === 5 || y === 14 ? 1 : 0);
    }
    expect(ring[9 * 30 + 10]).toBe(1); // the gate tiles are ring tiles
    expect(ring[10 * 30 + 10]).toBe(1);
    expect(ring[8 * 30 + 9]).toBe(0); // outside the coliseum
    expect(coliseumRingMask(map)).toBe(ring);
    expect(coliseumRingMask(withGates(map))).toBe(ring);
  });

  it("is empty for a map with no coliseum", () => {
    expect([...coliseumRingMask(miniColiseum(false))].some((v) => v === 1)).toBe(false);
    expect([...coliseumRingMask(room(8, 8))].some((v) => v === 1)).toBe(false);
  });

  it("on a generated map: ring tiles are walls once the gates lock, the open ones are exactly the gate tiles", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const map = generateMap(seed);
      const locked = withGates(map);
      const ring = coliseumRingMask(map);
      const gateTiles = new Set(map.coliseum.gates.flatMap((g) => g.tiles.map((t) => t.y * map.w + t.x)));
      let ringTiles = 0;
      for (let i = 0; i < ring.length; i++) {
        if (ring[i] !== 1) continue;
        ringTiles++;
        expect(locked.tiles[i], `seed ${seed} tile ${i}: a wall once locked`).toBe(TILE_WALL);
        expect(map.tiles[i] === TILE_FLOOR, `seed ${seed} tile ${i}: open only at a gate`).toBe(gateTiles.has(i));
      }
      for (const i of gateTiles) expect(ring[i], `seed ${seed}: gate tile ${i} is in the mask`).toBe(1);
      expect(gateTiles.size).toBeGreaterThan(0);
      expect(ringTiles).toBeGreaterThan(gateTiles.size);
    }
  });
});

describe("segmentCrossesRing", () => {
  const map = miniColiseum(true);
  const locked = withGates(map);
  const crosses = (cmap: GameMap, a: Vec2, b: Vec2): boolean => segmentCrossesRing(map, cmap, a, b);

  it("is true through a ring wall and false along a clear line, from either end", () => {
    const a = { x: 208, y: 270 }, b = { x: 480, y: 270 }; // row 8, the wall tile (10, 8) beside the gate
    expect(crosses(map, a, b)).toBe(true);
    expect(crosses(map, b, a)).toBe(true);
    expect(crosses(map, { x: 40, y: 40 }, { x: 280, y: 40 })).toBe(false); // outside the coliseum
    expect(crosses(map, { x: 400, y: 200 }, { x: 500, y: 330 })).toBe(false); // inside it
    expect(crosses(map, { x: 400, y: 100 }, { x: 400, y: 400 })).toBe(true); // north wall
  });

  it("lets a segment through an OPEN gate, and not through a locked one", () => {
    const a = { x: 208, y: 320 }, b = { x: 458, y: 320 }; // the line between the two gate tiles
    expect(crosses(map, a, b)).toBe(false);
    expect(crosses(map, b, a)).toBe(false);
    expect(crosses(locked, a, b)).toBe(true);
    expect(crosses(map, { x: 208, y: 300 }, { x: 458, y: 340 })).toBe(false); // slanted, still inside the gate opening
  });

  it("blocks a segment that clips the wall beside the gate, even with the gate open", () => {
    expect(crosses(map, { x: 208, y: 232 }, { x: 458, y: 320 })).toBe(true);
  });

  it("counts a vertex hit as both neighbours (symmetrically)", () => {
    // From tile (9, 8) to tile (10, 9) straight through the vertex (320, 288): (10, 8) is a ring wall, (9, 9) is open floor.
    const a = { x: 300, y: 268 }, b = { x: 340, y: 308 };
    expect(crosses(map, a, b)).toBe(true);
    expect(crosses(map, b, a)).toBe(true);
    // The other diagonal of the same vertex: from (10, 9) up to (9, 8) is the same segment, and (9, 9) -> (10, 8) ends in the wall.
    expect(crosses(map, { x: 300, y: 308 }, { x: 340, y: 268 })).toBe(true);
    // A vertex with floor on both sides: through (320, 320) between the gate tiles and the outside tiles (9, 9), (9, 10).
    expect(crosses(map, { x: 300, y: 340 }, { x: 340, y: 300 })).toBe(false);
  });

  it("is false when the map has no ring, and true for a non-finite end", () => {
    const bare = miniColiseum(false);
    expect(segmentCrossesRing(bare, bare, { x: 208, y: 270 }, { x: 480, y: 270 })).toBe(false);
    expect(crosses(map, { x: 208, y: 320 }, { x: Number.NaN, y: 320 })).toBe(true);
  });

  it("a zero-length segment in the open is clear", () => {
    expect(crosses(map, { x: 100, y: 100 }, { x: 100, y: 100 })).toBe(false);
  });
});

describe("blinkLanding: the coliseum", () => {
  const map = miniColiseum(true);
  const bare = miniColiseum(false);
  const outside = { x: 208, y: 320 };

  it("goes in through an open gate", () => {
    expect(blinkLanding(map, false, outside, { x: 458, y: 320 })).toEqual({ x: 458, y: 320 });
    const slanted = blinkLanding(map, false, { x: 208, y: 300 }, { x: 458, y: 340 })!;
    expect(slanted.x).toBeCloseTo(458, 6);
    expect(slanted.y).toBeCloseTo(340, 6);
  });

  it("is stopped by a locked gate: it lands outside the wall", () => {
    // Clear outside: x + 12 <= 320, so d <= 100 on the 250 - 4k lattice: 98.
    expect(blinkLanding(map, true, outside, { x: 458, y: 320 })).toEqual({ x: 306, y: 320 });
  });

  it("does not jump the wall beside an open gate (the footprint is crossed only through the gate)", () => {
    const from = { x: 208, y: 232 }, toward = { x: 458, y: 320 };
    // Without the coliseum region the same blink goes through the wall to the arena floor, where the open gate makes it reachable.
    const through = blinkLanding(bare, false, from, toward)!;
    expect(through.x).toBeCloseTo(458, 6);
    expect(through.y).toBeCloseTo(320, 6);
    const stopped = blinkLanding(map, false, from, toward)!;
    expect(stopped.x).toBeLessThanOrEqual(320 - R + 1e-9);
    expect(segmentCrossesRing(map, map, from, stopped)).toBe(false);
  });

  it("jumps out of the arena only through the gate too, and not at all once it locks", () => {
    const inside = { x: 400, y: 320 };
    expect(blinkLanding(map, false, inside, { x: 150, y: 320 })).toEqual({ x: 150, y: 320 }); // out through the open gate
    // North from (400, 200): everything 64 u or more up is past the north wall (row 5), so there is no landing.
    expect(blinkLanding(map, false, { x: 400, y: 200 }, { x: 400, y: 20 })).toBeNull();
    // Locked: west is sealed (the gate is a wall), and east stops on the arena's own floor, tangent to the east wall.
    expect(blinkLanding(map, true, inside, { x: 150, y: 320 })).toBeNull();
    expect(blinkLanding(map, true, inside, { x: 560, y: 320 })).toEqual({ x: 560, y: 320 });
    const east = blinkLanding(map, true, inside, { x: 900, y: 320 })!;
    expect(east).toEqual({ x: 596, y: 320 });
    expect(inColiseum(map, east.x, east.y)).toBe(true);
  });

  it("refuses an origin in a gate tile once the gates lock (it is rock then)", () => {
    expect(blinkLanding(map, false, { x: 336, y: 304 }, { x: 600, y: 304 })).not.toBeNull();
    expect(blinkLanding(map, true, { x: 336, y: 304 }, { x: 600, y: 304 })).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------------------------------------
// The property sweep. Every check below is written against the rules in blink.ts's doc comment, not against its code: the
// floor components, the ring mask and the segment test are recomputed here the dull way.

/** 4-connected labelling by a plain breadth-first search over arrays. */
function oracleLabels(map: GameMap): Int32Array {
  const lab = new Int32Array(map.w * map.h);
  let next = 0;
  for (let s = 0; s < lab.length; s++) {
    if (map.tiles[s] === TILE_WALL || lab[s] !== 0) continue;
    next++;
    const queue = [s];
    lab[s] = next;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q]!;
      const x = i % map.w, y = Math.floor(i / map.w);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
        const j = ny * map.w + nx;
        if (map.tiles[j] !== TILE_WALL && lab[j] === 0) { lab[j] = next; queue.push(j); }
      }
    }
  }
  return lab;
}

/** The coliseum's outer ring, from the region grid: a coliseum tile with any of its 8 neighbours not in it. */
function oracleRing(map: GameMap): boolean[] {
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < map.w && y < map.h && map.regionGrid[y * map.w + x] === REGION_COLISEUM;
  const out: boolean[] = new Array<boolean>(map.w * map.h).fill(false);
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (!inside(x, y)) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx !== 0 || dy !== 0) && !inside(x + dx, y + dy)) out[y * map.w + x] = true;
    }
  }
  return out;
}

interface Rect { x0: number; y0: number; x1: number; y1: number }

/** A ring tile that is a wall on `cmap`, as a world rectangle. */
function ringWalls(ring: boolean[], cmap: GameMap): Rect[] {
  const out: Rect[] = [];
  for (let i = 0; i < ring.length; i++) {
    if (!ring[i] || cmap.tiles[i] !== TILE_WALL) continue;
    const x = i % cmap.w, y = Math.floor(i / cmap.w);
    out.push({ x0: x * TILE, y0: y * TILE, x1: (x + 1) * TILE, y1: (y + 1) * TILE });
  }
  return out;
}

/** The segment visits a ring wall: samples every unit along it, which sees every tile it crosses by more than a unit. */
function sampledCrossesRing(ring: boolean[], cmap: GameMap, a: Vec2, b: Vec2): boolean {
  const len = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
  const n = Math.max(1, Math.ceil(len));
  for (let i = 0; i <= n; i++) {
    const x = a.x + ((b.x - a.x) * i) / n, y = a.y + ((b.y - a.y) * i) / n;
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= cmap.w || ty >= cmap.h) return true;
    if (ring[ty * cmap.w + tx] && cmap.tiles[ty * cmap.w + tx] === TILE_WALL) return true;
  }
  return false;
}

/** The closed rectangle, grown by `eps`, meets the segment (Liang-Barsky). */
function touches(a: Vec2, b: Vec2, r: Rect, eps: number): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, a.x - (r.x0 - eps)) && clip(dx, r.x1 + eps - a.x) && clip(-dy, a.y - (r.y0 - eps)) && clip(dy, r.y1 + eps - a.y);
}

interface World {
  seed: number;
  map: GameMap;
  ring: boolean[];
  /** Per gate state: the collision map, its labels and its ring walls. */
  mode: Array<{ locked: boolean; cmap: GameMap; labels: Int32Array; walls: Rect[] }>;
}

function worldOf(seed: number): World {
  const map = generateMap(seed);
  const ring = oracleRing(map);
  const mode = [false, true].map((locked) => {
    const cmap = locked ? withGates(map) : map;
    return { locked, cmap, labels: oracleLabels(cmap), walls: ringWalls(ring, cmap) };
  });
  return { seed, map, ring, mode };
}

/** Four start points: two floor tile centres, one off-centre, and one in the arena. All are floor with the gates locked too. */
function startsOf(w: World): Vec2[] {
  const rng = mulberry32(w.seed * 7919 + 17);
  const locked = w.mode[1]!.cmap;
  const floor: number[] = [], arena: number[] = [];
  for (let i = 0; i < locked.tiles.length; i++) {
    if (locked.tiles[i] !== TILE_FLOOR) continue;
    floor.push(i);
    if (w.map.regionGrid[i] === REGION_COLISEUM) arena.push(i);
  }
  const at = (list: number[], jitter: number): Vec2 => {
    const i = list[Math.floor(rng() * list.length)]!;
    return { x: (i % locked.w) * TILE + TILE / 2 + (rng() - 0.5) * jitter, y: Math.floor(i / locked.w) * TILE + TILE / 2 + (rng() - 0.5) * jitter };
  };
  return [at(floor, 0), at(floor, 7), at(floor, 0), at(arena, 0)];
}

const DISTANCES = [80, 220, 450];
const EPS = 1e-6;

interface Tally { calls: number; nulls: number; shortened: number; ring: number; arena: number; paths: number; maximal: number }

function sweep(seeds: number[]): { failures: string[]; tally: Tally } {
  const failures: string[] = [];
  const tally: Tally = { calls: 0, nulls: 0, shortened: 0, ring: 0, arena: 0, paths: 0, maximal: 0 };
  const fail = (msg: string): void => { if (failures.length < 25) failures.push(msg); };

  for (const seed of seeds) {
    const w = worldOf(seed);
    const rng = mulberry32(seed * 104729 + 5);
    const starts = startsOf(w);
    for (const [si, from] of starts.entries()) {
      const angles = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => (k * Math.PI) / 4).concat([rng() * 2 * Math.PI, rng() * 2 * Math.PI]);
      for (const angle of angles) {
        for (const dist of DISTANCES) {
          const toward = { x: from.x + Math.cos(angle) * dist, y: from.y + Math.sin(angle) * dist };
          for (const m of w.mode) {
            tally.calls++;
            const tag = `seed ${seed} start ${si} (${from.x.toFixed(1)}, ${from.y.toFixed(1)}) angle ${angle.toFixed(3)} dist ${dist} ${m.locked ? "locked" : "open"}`;
            const p = blinkLanding(w.map, m.locked, from, toward);
            if (p !== null && JSON.stringify(p) !== JSON.stringify(blinkLanding(w.map, m.locked, from, toward))) fail(`${tag}: not deterministic`);

            const dx = toward.x - from.x, dy = toward.y - from.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            const want = Math.min(BLAZE_RANGE, Math.max(len, BLAZE_MIN_DIST));
            const ux = dx / len, uy = dy / len;
            const home = m.labels[Math.floor(from.y / TILE) * m.cmap.w + Math.floor(from.x / TILE)]!;
            const startInArena = inColiseum(w.map, from.x, from.y);
            if (startInArena) tally.arena++;

            // The same rules, written out, for one candidate distance along the ray. The ring is held to the touching
            // rectangles (grown by EPS): a superset of what blink.ts refuses, so "no candidate passes" is a fair test of nulls.
            const valid = (d: number): boolean => {
              const c = { x: from.x + ux * d, y: from.y + uy * d };
              if (!circleClear(m.cmap, c, R)) return false;
              if (m.labels[Math.floor(c.y / TILE) * m.cmap.w + Math.floor(c.x / TILE)] !== home) return false;
              if (m.locked && inColiseum(w.map, c.x, c.y) !== startInArena) return false;
              const lo = { x: Math.min(from.x, c.x) - 1, y: Math.min(from.y, c.y) - 1 };
              const hi = { x: Math.max(from.x, c.x) + 1, y: Math.max(from.y, c.y) + 1 };
              for (const r of m.walls) {
                if (r.x1 < lo.x || r.x0 > hi.x || r.y1 < lo.y || r.y0 > hi.y) continue;
                if (touches(from, c, r, EPS)) return false;
              }
              return true;
            };

            if (sampledCrossesRing(w.ring, m.cmap, from, { x: from.x + ux * want, y: from.y + uy * want })) tally.ring++;

            if (p === null) {
              tally.nulls++;
              // Null only when no candidate on the lattice is valid.
              for (let d = want; d >= BLAZE_MIN_DIST; d -= BLINK_STEP) {
                if (valid(d)) { fail(`${tag}: refused, but ${d} u is a valid landing`); break; }
              }
              tally.maximal++;
              continue;
            }

            // The landing itself.
            const ex = p.x - from.x, ey = p.y - from.y;
            const d = Math.sqrt(ex * ex + ey * ey);
            if (Math.abs(ex * uy - ey * ux) > 1e-6) fail(`${tag}: ${JSON.stringify(p)} is off the ray`);
            if (ex * ux + ey * uy < 0) fail(`${tag}: landed behind the caster`);
            if (d < BLAZE_MIN_DIST - 1e-6 || d > want + 1e-6) fail(`${tag}: distance ${d} outside [${BLAZE_MIN_DIST}, ${want}]`);
            const steps = (want - d) / BLINK_STEP;
            if (Math.abs(steps - Math.round(steps)) > 1e-6) fail(`${tag}: ${d} is not on the ${BLINK_STEP} u lattice from ${want}`);
            if (d < want - 1e-6) tally.shortened++;

            if (!circleClear(m.cmap, p, R)) fail(`${tag}: no disc fits at ${JSON.stringify(p)}`);
            for (let k = 0; k < 16; k++) {
              const a = (k * Math.PI) / 8;
              const sx = Math.floor((p.x + Math.cos(a) * (R - 1e-6)) / TILE), sy = Math.floor((p.y + Math.sin(a) * (R - 1e-6)) / TILE);
              if (sx < 0 || sy < 0 || sx >= m.cmap.w || sy >= m.cmap.h || m.cmap.tiles[sy * m.cmap.w + sx] === TILE_WALL) {
                fail(`${tag}: the disc at ${JSON.stringify(p)} touches rock or the edge (sample ${k})`);
                break;
              }
            }
            if (m.labels[Math.floor(p.y / TILE) * m.cmap.w + Math.floor(p.x / TILE)] !== home) fail(`${tag}: landed in another pocket of floor`);
            if (sampledCrossesRing(w.ring, m.cmap, from, p)) fail(`${tag}: the path to ${JSON.stringify(p)} crosses a coliseum ring wall`);
            if (m.locked && inColiseum(w.map, p.x, p.y) !== startInArena) fail(`${tag}: left (or entered) the arena with the gates locked`);
            if (tally.calls % 8 === 0) {
              tally.paths++;
              if (findPath(m.cmap, from, p).length === 0) fail(`${tag}: no path from the caster to ${JSON.stringify(p)}`);
            }

            // The farthest: nothing farther on the lattice is valid (checked on every call that landed short, and one in four otherwise).
            if (d < want - 1e-6 || tally.calls % 4 === 0) {
              tally.maximal++;
              for (let dd = want; dd > d + 1e-6; dd -= BLINK_STEP) {
                if (valid(dd)) { fail(`${tag}: landed at ${d} but ${dd} u is valid`); break; }
              }
            }
          }
        }
      }
    }
  }
  return { failures, tally };
}

describe("blinkLanding: property sweep over generated maps", () => {
  // 200 seeds x 4 starts x 10 angles (the 8 compass points and 2 random) x 3 distances x gates open and locked = 48 000 blinks.
  const chunks: Array<[number, number]> = [[1, 50], [51, 100], [101, 150], [151, 200]];
  const totals: Tally = { calls: 0, nulls: 0, shortened: 0, ring: 0, arena: 0, paths: 0, maximal: 0 };

  for (const [lo, hi] of chunks) {
    it(`seeds ${lo}..${hi}: every landing is valid, collinear, in range, on the lattice and the farthest; every refusal is justified`, () => {
      const seeds = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
      const { failures, tally } = sweep(seeds);
      expect(failures).toEqual([]);
      for (const k of Object.keys(totals) as Array<keyof Tally>) totals[k] += tally[k];
      expect(tally.calls).toBe(seeds.length * 4 * 10 * 3 * 2);
    }, 120_000);
  }

  it("exercised what it claims to: refusals, shortened blinks, the coliseum ring, arena starts and path checks", () => {
    expect(totals.calls).toBe(48_000);
    expect(totals.nulls).toBeGreaterThan(100);
    expect(totals.nulls).toBeLessThan(totals.calls / 2);
    expect(totals.shortened).toBeGreaterThan(1000);
    expect(totals.ring).toBeGreaterThan(500);
    expect(totals.arena).toBeGreaterThan(2000);
    expect(totals.paths).toBeGreaterThan(1000);
    expect(totals.maximal).toBeGreaterThan(5000);
  });
});

// Unit tests for the map.ts contract helpers: hand-built maps first, then a few generated ones.
import { describe, expect, it } from "vitest";
import { TILE } from "../src/constants";
import { hasLineOfSight } from "../src/geometry";
import {
  REGION_COLISEUM,
  REGION_FACTIONS,
  REGION_IDS,
  REGION_NONE,
  REGION_WEAPONS,
  TILE_FLOOR,
  TILE_WALL,
  inColiseum,
  isWallTile,
  mapFromTiles,
  regionAt,
  regionAtTile,
  regionCode,
  tileToWorldCenter,
  withGates,
} from "../src/map";
import type { GameMap, GateSide, RegionId } from "../src/map";
import { generateMap } from "../src/mapgen";
import { findPath } from "../src/pathfind";

const seeds = (n: number, from = 0) => Array.from({ length: n }, (_, i) => from + i);
const at = (m: GameMap, x: number, y: number) => m.tiles[y * m.w + x];
const tc = tileToWorldCenter;

/** Two 5x5 rooms side by side, split by the wall column x=6, which has a 2-tile gate at y=2..3. */
function twoRooms(): GameMap {
  const w = 12, h = 7;
  const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
  for (let x = 0; x < w; x++) { tiles[x] = TILE_WALL; tiles[(h - 1) * w + x] = TILE_WALL; }
  for (let y = 0; y < h; y++) { tiles[y * w] = TILE_WALL; tiles[y * w + w - 1] = TILE_WALL; tiles[y * w + 6] = TILE_WALL; }
  tiles[2 * w + 6] = TILE_FLOOR;
  tiles[3 * w + 6] = TILE_FLOOR;
  const m = mapFromTiles(w, h, tiles, 5);
  m.coliseum.gates = [{ side: "e", tiles: [{ x: 6, y: 2 }, { x: 6, y: 3 }], x: tc(6), y: (tc(2) + tc(3)) / 2 }];
  return m;
}

describe("mapFromTiles", () => {
  it("wraps the tile grid as is, with no regions, coliseum or spots", () => {
    const tiles = new Uint8Array(5 * 4);
    const m = mapFromTiles(5, 4, tiles);
    expect(m.w).toBe(5);
    expect(m.h).toBe(4);
    expect(m.seed).toBe(0);
    expect(m.tiles).toBe(tiles); // used as is, not copied
    expect(m.regionGrid).toBeInstanceOf(Uint8Array);
    expect(m.regionGrid.length).toBe(20);
    expect(Array.from(m.regionGrid).every((c) => c === REGION_NONE)).toBe(true);
    expect(m.coliseum.rect).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(m.coliseum.gates).toEqual([]);
    expect(m.coliseum.innerSpawns).toEqual([]);
    // The middle tile's centre, so it is a real tile centre even on an even-sized grid: tile (2, 2) of 5x4.
    expect(m.coliseum.centre).toEqual({ x: tc(Math.floor(5 / 2)), y: tc(Math.floor(4 / 2)) });
    expect(m.coliseum.centre).toEqual({ x: 80, y: 80 });
    expect(m.regions).toEqual([]);
    expect(m.buildings).toEqual([]);
    expect(m.spawns).toEqual([]);
    expect(m.extracts).toEqual([]);
    expect(m.crateSpots).toEqual([]);
    expect(m.groundSpots).toEqual([]);
  });

  it("keeps the seed it is given", () => {
    expect(mapFromTiles(2, 2, new Uint8Array(4), 77).seed).toBe(77);
  });

  it("throws a RangeError when the tile count does not match w*h", () => {
    expect(() => mapFromTiles(3, 3, new Uint8Array(8))).toThrow(RangeError);
    expect(() => mapFromTiles(3, 3, new Uint8Array(10))).toThrow(RangeError);
    expect(() => mapFromTiles(0, 5, new Uint8Array(1))).toThrow(RangeError);
    expect(() => mapFromTiles(3, 3, new Uint8Array(9))).not.toThrow();
  });

  it("does not share state between maps", () => {
    const a = mapFromTiles(2, 2, new Uint8Array(4));
    const b = mapFromTiles(2, 2, new Uint8Array(4));
    a.spawns.push({ x: 1, y: 1 });
    a.regionGrid[0] = REGION_COLISEUM;
    a.coliseum.gates.push({ side: "n", tiles: [], x: 0, y: 0 });
    expect(b.spawns).toEqual([]);
    expect(b.regionGrid[0]).toBe(REGION_NONE);
    expect(b.coliseum.gates).toEqual([]);
  });
});

describe("region table", () => {
  it("is none, the five factions in order, then the coliseum", () => {
    expect([...REGION_FACTIONS]).toEqual(["fire", "sentenced", "plague", "frost", "holy"]);
    expect([...REGION_IDS]).toEqual(["none", "fire", "sentenced", "plague", "frost", "holy", "coliseum"]);
    expect(REGION_IDS[REGION_NONE]).toBe("none");
    expect(REGION_NONE).toBe(0);
    expect(REGION_COLISEUM).toBe(REGION_IDS.length - 1);
    expect(REGION_IDS[REGION_COLISEUM]).toBe("coliseum");
    expect(new Set(REGION_IDS).size).toBe(REGION_IDS.length);
    expect(REGION_IDS.length).toBeLessThanOrEqual(256); // codes live in a Uint8Array
  });

  it("round-trips through regionCode", () => {
    REGION_IDS.forEach((id, i) => expect(regionCode(id)).toBe(i));
    expect(regionCode("none")).toBe(REGION_NONE);
    expect(regionCode("coliseum")).toBe(REGION_COLISEUM);
    REGION_FACTIONS.forEach((f, i) => expect(regionCode(f)).toBe(i + 1));
  });
});

describe("REGION_WEAPONS", () => {
  it("maps fire to axe, sentenced to sword, plague to bow, frost to shield and holy to wand", () => {
    expect(REGION_WEAPONS).toEqual({ fire: "axe", sentenced: "sword", plague: "bow", frost: "shield", holy: "wand" });
    expect(REGION_WEAPONS.fire).toBe("axe");
    expect(REGION_WEAPONS.sentenced).toBe("sword");
    expect(REGION_WEAPONS.plague).toBe("bow");
    expect(REGION_WEAPONS.frost).toBe("shield");
    expect(REGION_WEAPONS.holy).toBe("wand");
  });

  it("has exactly one entry per faction and gives every faction a different weapon", () => {
    expect(Object.keys(REGION_WEAPONS).sort()).toEqual([...REGION_FACTIONS].sort());
    expect(new Set(Object.values(REGION_WEAPONS)).size).toBe(REGION_FACTIONS.length);
  });
});

describe("regionAt / regionAtTile / inColiseum", () => {
  function painted(): GameMap {
    const m = mapFromTiles(4, 3, new Uint8Array(12));
    m.regionGrid[1 * 4 + 2] = REGION_COLISEUM; // tile (2, 1)
    m.regionGrid[0 * 4 + 0] = regionCode("fire"); // tile (0, 0)
    m.regionGrid[2 * 4 + 3] = regionCode("holy"); // tile (3, 2)
    return m;
  }

  it("reads the region of a tile", () => {
    const m = painted();
    expect(regionAtTile(m, 2, 1)).toBe("coliseum");
    expect(regionAtTile(m, 0, 0)).toBe("fire");
    expect(regionAtTile(m, 3, 2)).toBe("holy");
    expect(regionAtTile(m, 1, 1)).toBe("none");
  });

  it("treats out-of-bounds tiles as none", () => {
    const m = painted();
    for (const [x, y] of [[-1, 0], [0, -1], [4, 0], [0, 3], [4, 3], [-5, -5], [100, 100]]) {
      expect(regionAtTile(m, x, y), `${x},${y}`).toBe("none");
    }
    // The grid is row-major: x past the row end must not wrap into the next row.
    m.regionGrid[1 * 4 + 0] = regionCode("plague");
    expect(regionAtTile(m, 4, 0)).toBe("none");
    expect(regionAtTile(m, -1, 1)).toBe("none");
  });

  it("maps world coordinates to tiles, including tile edges and negatives", () => {
    const m = painted();
    expect(regionAt(m, 2 * TILE, 1 * TILE)).toBe("coliseum"); // top-left corner belongs to the tile
    expect(regionAt(m, 2 * TILE + TILE - 0.001, 1 * TILE + TILE - 0.001)).toBe("coliseum");
    expect(regionAt(m, 2 * TILE - 0.001, 1 * TILE)).toBe("none");
    expect(regionAt(m, 3 * TILE + 5, 2 * TILE + 5)).toBe("holy");
    expect(regionAt(m, 0, 0)).toBe("fire");
    expect(regionAt(m, -0.001, 0)).toBe("none");
    expect(regionAt(m, 0, -0.001)).toBe("none");
    expect(regionAt(m, 4 * TILE, 0)).toBe("none");
    expect(regionAt(m, 0, 3 * TILE)).toBe("none");
    expect(regionAt(m, tc(0), tc(0))).toBe("fire");
  });

  it("inColiseum is true exactly on coliseum-region tiles", () => {
    const m = painted();
    for (let ty = 0; ty < m.h; ty++) {
      for (let tx = 0; tx < m.w; tx++) {
        expect(inColiseum(m, tc(tx), tc(ty)), `${tx},${ty}`).toBe(tx === 2 && ty === 1);
      }
    }
    expect(inColiseum(m, -10, -10)).toBe(false);
    expect(inColiseum(m, 1e6, 1e6)).toBe(false);
  });

  it("does not depend on the wall/floor layer", () => {
    const m = painted();
    m.tiles[1 * 4 + 2] = TILE_WALL;
    expect(isWallTile(m, 2, 1)).toBe(true);
    expect(inColiseum(m, tc(2), tc(1))).toBe(true);
    expect(regionAtTile(m, 2, 1)).toBe("coliseum");
  });
});

describe("withGates (hand-built map)", () => {
  it("turns exactly the gate tiles to wall", () => {
    const m = twoRooms();
    const locked = withGates(m);
    expect(at(locked, 6, 2)).toBe(TILE_WALL);
    expect(at(locked, 6, 3)).toBe(TILE_WALL);
    for (let i = 0; i < m.tiles.length; i++) {
      const x = i % m.w, y = (i - x) / m.w;
      if (x === 6 && (y === 2 || y === 3)) continue;
      expect(locked.tiles[i], `tile ${x},${y}`).toBe(m.tiles[i]);
    }
    expect(locked.w).toBe(m.w);
    expect(locked.h).toBe(m.h);
    expect(locked.seed).toBe(m.seed);
    expect(locked.regionGrid).toEqual(m.regionGrid);
    expect(locked.coliseum.gates).toEqual(m.coliseum.gates);
  });

  it("leaves the original map untouched", () => {
    const m = twoRooms();
    const before = Uint8Array.from(m.tiles);
    const locked = withGates(m);
    expect(locked).not.toBe(m);
    expect(locked.tiles).not.toBe(m.tiles);
    expect(m.tiles).toEqual(before);
    expect(at(m, 6, 2)).toBe(TILE_FLOOR);
    expect(at(m, 6, 3)).toBe(TILE_FLOOR);
  });

  it("is cached per map and idempotent", () => {
    const m = twoRooms();
    const locked = withGates(m);
    expect(withGates(m)).toBe(locked);
    expect(withGates(locked)).toBe(locked);
    expect(withGates(withGates(m))).toBe(withGates(m));
    // A different map object gets its own locked copy.
    const other = twoRooms();
    expect(withGates(other)).not.toBe(locked);
    expect(withGates(other)).toBe(withGates(other));
  });

  it("gives identical tiles for a map without gates", () => {
    const tiles = new Uint8Array(6 * 6).fill(TILE_FLOOR);
    tiles[7] = TILE_WALL;
    const m = mapFromTiles(6, 6, tiles);
    const locked = withGates(m);
    expect(Array.from(locked.tiles)).toEqual(Array.from(m.tiles));
    expect(withGates(locked)).toBe(locked);
  });

  it("keeps a gate tile that was already wall as wall, and handles several gates", () => {
    const m = twoRooms();
    m.coliseum.gates.push({ side: "n", tiles: [{ x: 3, y: 0 }, { x: 4, y: 0 }, { x: 8, y: 4 }], x: 0, y: 0 });
    const locked = withGates(m);
    expect(at(locked, 3, 0)).toBe(TILE_WALL);
    expect(at(locked, 4, 0)).toBe(TILE_WALL);
    expect(at(locked, 8, 4)).toBe(TILE_WALL);
    expect(at(locked, 6, 2)).toBe(TILE_WALL);
    expect(at(m, 8, 4)).toBe(TILE_FLOOR);
  });

  it("makes findPath and hasLineOfSight stop at a closed gate", () => {
    const m = twoRooms();
    const locked = withGates(m);
    const a = { x: tc(2), y: tc(2) }, b = { x: tc(9), y: tc(2) };
    expect(findPath(m, a, b).length).toBeGreaterThan(0);
    expect(findPath(locked, a, b)).toEqual([]);
    expect(findPath(locked, a, { x: tc(2), y: tc(4) }).length).toBeGreaterThan(0); // same room still works
    expect(hasLineOfSight(m, a, b)).toBe(true);
    expect(hasLineOfSight(locked, a, b)).toBe(false);
    // The wall beside the gate blocks either way.
    const c = { x: tc(2), y: tc(5) }, d = { x: tc(9), y: tc(5) };
    expect(hasLineOfSight(m, c, d)).toBe(false);
  });
});

describe("generated maps", () => {
  const maps = seeds(12).map((s) => generateMap(s));
  const each = (fn: (m: GameMap, s: number) => void) => maps.forEach((m, s) => fn(m, s));
  const OUT: Record<GateSide, readonly [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };

  it("has four gates, open in map.tiles and closed in withGates(map).tiles, differing nowhere else", () => {
    each((m, s) => {
      expect(m.coliseum.gates.length, `seed ${s}`).toBe(4);
      const gates = new Set(m.coliseum.gates.flatMap((g) => g.tiles.map((t) => t.y * m.w + t.x)));
      const before = Uint8Array.from(m.tiles);
      const locked = withGates(m);
      expect(m.tiles, `seed ${s}: original mutated`).toEqual(before);
      for (let i = 0; i < m.tiles.length; i++) {
        if (gates.has(i)) {
          expect(m.tiles[i]).toBe(TILE_FLOOR);
          expect(locked.tiles[i]).toBe(TILE_WALL);
        } else {
          expect(locked.tiles[i], `seed ${s} tile ${i}`).toBe(m.tiles[i]);
        }
      }
    });
  });

  it("caches the locked copy and is idempotent", () => {
    each((m, s) => {
      const locked = withGates(m);
      expect(withGates(m), `seed ${s}`).toBe(locked);
      expect(withGates(locked), `seed ${s}`).toBe(locked);
      expect(locked.regionGrid, `seed ${s}`).toEqual(m.regionGrid);
      expect(locked.coliseum, `seed ${s}`).toEqual(m.coliseum);
      expect(locked.spawns, `seed ${s}`).toEqual(m.spawns);
    });
  });

  it("gives identical tiles when the same map has no gates", () => {
    each((m, s) => {
      const bare: GameMap = { ...m, coliseum: { ...m.coliseum, gates: [] } };
      expect(Array.from(withGates(bare).tiles), `seed ${s}`).toEqual(Array.from(m.tiles));
    });
  });

  it("carries the region's weapon on every mob camp", () => {
    each((m, s) => {
      for (const r of m.regions) for (const c of r.mobCamps) expect(c.weapon, `seed ${s} ${c.id}`).toBe(REGION_WEAPONS[r.id]);
    });
  });

  it("agrees between regionAt, regionAtTile and inColiseum", () => {
    each((m, s) => {
      for (let ty = 0; ty < m.h; ty++) {
        for (let tx = 0; tx < m.w; tx++) {
          const id = REGION_IDS[m.regionGrid[ty * m.w + tx]] as RegionId;
          expect(regionAtTile(m, tx, ty), `seed ${s} ${tx},${ty}`).toBe(id);
          expect(regionAt(m, tc(tx), tc(ty)), `seed ${s} ${tx},${ty}`).toBe(id);
          expect(inColiseum(m, tc(tx), tc(ty)), `seed ${s} ${tx},${ty}`).toBe(id === "coliseum");
        }
      }
      expect(inColiseum(m, m.coliseum.centre.x, m.coliseum.centre.y), `seed ${s}`).toBe(true);
      expect(inColiseum(m, tc(1), tc(1)), `seed ${s}`).toBe(false);
      expect(regionAt(m, -TILE, -TILE), `seed ${s}`).toBe("none");
      expect(regionAt(m, m.w * TILE + 1, m.h * TILE + 1), `seed ${s}`).toBe("none");
      for (const r of m.regions) {
        expect(regionAt(m, r.anchor.x, r.anchor.y), `seed ${s}`).toBe(r.id);
        for (const p of r.spawns) expect(regionAt(m, p.x, p.y), `seed ${s}`).toBe(r.id);
      }
    });
  });

  it("lets findPath walk from outside to the coliseum centre when open and not when the gates are closed", () => {
    each((m, s) => {
      const locked = withGates(m);
      for (const p of m.spawns) {
        expect(inColiseum(m, p.x, p.y), `seed ${s}`).toBe(false);
        expect(findPath(m, p, m.coliseum.centre).length, `seed ${s} open`).toBeGreaterThan(0);
        expect(findPath(locked, p, m.coliseum.centre), `seed ${s} locked`).toEqual([]);
        expect(findPath(locked, m.coliseum.centre, p), `seed ${s} locked, outwards`).toEqual([]);
      }
      // Inside the sealed arena everything still connects.
      for (const p of m.coliseum.innerSpawns) {
        expect(findPath(locked, p, m.coliseum.centre).length, `seed ${s} inner ${p.x},${p.y}`).toBeGreaterThan(0);
        expect(findPath(m, p, m.spawns[0]).length, `seed ${s} inner to outside, open`).toBeGreaterThan(0);
      }
    });
  });

  it("has line of sight straight through a gate when open and not when locked", () => {
    each((m, s) => {
      const locked = withGates(m);
      for (const g of m.coliseum.gates) {
        const [ox, oy] = OUT[g.side];
        for (const t of g.tiles) {
          const mid = { x: tc(t.x), y: tc(t.y) };
          const inside = { x: mid.x - 2 * TILE * ox, y: mid.y - 2 * TILE * oy };
          const outside = { x: mid.x + 2 * TILE * ox, y: mid.y + 2 * TILE * oy };
          expect(hasLineOfSight(m, inside, outside), `seed ${s} gate ${g.side} open`).toBe(true);
          expect(hasLineOfSight(locked, inside, outside), `seed ${s} gate ${g.side} locked`).toBe(false);
          expect(hasLineOfSight(m, outside, inside), `seed ${s} gate ${g.side} open, reversed`).toBe(true);
          expect(hasLineOfSight(locked, outside, inside), `seed ${s} gate ${g.side} locked, reversed`).toBe(false);
        }
      }
    });
  });
});

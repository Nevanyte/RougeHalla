// Unit tests for the map.ts contract helpers: hand-built maps first, then a few generated ones.
import { describe, expect, it } from "vitest";
import { TILE } from "../src/constants";
import { hasLineOfSight } from "../src/geometry";
import {
  FEATURE_JOBS,
  FEATURE_KINDS,
  MASK_MELEE,
  MASK_MOVE,
  MASK_SIGHT,
  REGION_COLISEUM,
  REGION_FACTIONS,
  REGION_IDS,
  REGION_NONE,
  REGION_WEAPONS,
  TILE_FLOOR,
  TILE_LOW,
  TILE_WALL,
  blocksTile,
  forgetMapCaches,
  inColiseum,
  isSolidAt,
  isSolidTile,
  isWallAt,
  isWallTile,
  mapFromTiles,
  moveBlockedTiles,
  moveComponents,
  moveComponentsOf,
  moveMask,
  regionAt,
  regionAtTile,
  regionCode,
  sightBlockedTiles,
  sightMask,
  tileToWorldCenter,
  withGates,
} from "../src/map";
import type { GameMap, GateSide, RegionId } from "../src/map";
import { generateMap } from "../src/mapgen";
import { findPath } from "../src/pathfind";
import { mulberry32 } from "../src/rng";

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
    expect(m.crateSpots).toEqual([]);
    expect(m.groundSpots).toEqual([]);
  });

  it("fills the roguelike contract fields with empty values: attempt 0, no territory, no camps, no spawn pool", () => {
    const m = mapFromTiles(5, 4, new Uint8Array(5 * 4));
    expect(m.attempt).toBe(0);
    expect(m.territoryGrid).toBeInstanceOf(Uint8Array);
    expect(m.territoryGrid.length).toBe(20);
    expect(Array.from(m.territoryGrid).every((v) => v === 0)).toBe(true);
    expect(m.territoryGrid).not.toBe(m.regionGrid);
    expect(m.camps).toEqual([]);
    expect(m.spawnPool).toEqual([]);
  });

  it("fills the zone-shape fields with empty values: no features, an all-zero featureGrid of its own", () => {
    const m = mapFromTiles(5, 4, new Uint8Array(5 * 4));
    expect(m.features).toEqual([]);
    expect(m.featureGrid).toBeInstanceOf(Uint8Array);
    expect(m.featureGrid.length).toBe(20);
    expect(Array.from(m.featureGrid).every((v) => v === 0)).toBe(true);
    expect(m.featureGrid).not.toBe(m.territoryGrid);
    const other = mapFromTiles(5, 4, new Uint8Array(5 * 4));
    m.featureGrid[3] = 1;
    m.features.push({ kind: "infill", variant: "", zone: "fire", jobs: ["seal"], ax: 3, ay: 0, p: [], bbox: { x: 3, y: 0, w: 1, h: 1 }, tiles: 1 });
    expect(other.featureGrid[3]).toBe(0);
    expect(other.features).toEqual([]);
  });

  it("pins the feature tables (append only: the client's art, the hash and the certifier key on these)", () => {
    expect([...FEATURE_KINDS]).toEqual(["landmark", "crater", "lavaRiver", "fenceRow", "gallows", "barrow", "mere", "headland", "spire", "causeway", "hall", "infill"]);
    expect([...FEATURE_JOBS]).toEqual(["landmark", "pen", "crossing", "lane", "fork", "lee", "choke", "cover", "rest", "seal"]);
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
    a.territoryGrid[0] = 2;
    a.camps.push({ id: "fire-1", zone: "fire", x: 1, y: 1, r: 1, spots: [], eliteSpot: -1, chest: { x: 1, y: 1 }, area: 0, radius: 1 });
    a.spawnPool.push({ x: 1, y: 1, zone: "fire" });
    a.coliseum.gates.push({ side: "n", tiles: [], x: 0, y: 0 });
    expect(b.camps).toEqual([]);
    expect(b.spawnPool).toEqual([]);
    expect(b.territoryGrid[0]).toBe(0);
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

  it("passes the roguelike contract fields through unchanged", () => {
    const m = twoRooms();
    m.attempt = 3;
    m.territoryGrid[5] = 2;
    m.camps.push({ id: "fire-1", zone: "fire", x: 40, y: 40, r: 80, spots: [{ x: 48, y: 48 }], eliteSpot: 0, chest: { x: 80, y: 80 }, area: 0, radius: 288 });
    m.spawnPool.push({ x: 48, y: 48, zone: "fire" });
    const locked = withGates(m);
    expect(locked.attempt).toBe(3);
    expect(locked.territoryGrid).toBe(m.territoryGrid);
    expect(locked.camps).toBe(m.camps);
    expect(locked.spawnPool).toBe(m.spawnPool);
    expect(locked.regions).toBe(m.regions);
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

  it("keeps the roguelike contract fields when the gates lock (shared, not copied)", () => {
    each((m, s) => {
      const locked = withGates(m);
      expect(locked.attempt, `seed ${s}`).toBe(m.attempt);
      expect(locked.territoryGrid, `seed ${s}`).toBe(m.territoryGrid);
      expect(locked.camps, `seed ${s}`).toBe(m.camps);
      expect(locked.spawnPool, `seed ${s}`).toBe(m.spawnPool);
      expect(locked.camps.length, `seed ${s}`).toBeGreaterThan(0);
      expect(locked.regions[0].pole, `seed ${s}`).toEqual(m.regions[0].pole);
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
        expect(regionAt(m, r.pole.x, r.pole.y), `seed ${s}`).toBe(r.id);
        for (const p of r.spawns) expect(regionAt(m, p.x, p.y), `seed ${s}`).toBe(r.id);
      }
    });
  });

  it("lets findPath walk from outside to the coliseum centre when open and not when the gates are closed", () => {
    each((m, s) => {
      const locked = withGates(m);
      for (const p of m.spawns.slice(0, 8)) {
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

// ---------------------------------------------------------------------------------------------------------------------
// Collision classes, masks and the terrain layer.

/** "#" wall, "~" LOW, anything else floor. */
function ascii(rows: string[]): GameMap {
  const h = rows.length, w = rows[0].length;
  const tiles = new Uint8Array(w * h);
  rows.forEach((row, y) => { for (let x = 0; x < w; x++) tiles[y * w + x] = row[x] === "#" ? TILE_WALL : row[x] === "~" ? TILE_LOW : TILE_FLOOR; });
  return mapFromTiles(w, h, tiles);
}

describe("tile classes and masks", () => {
  it("pins the codes: floor 0, wall 1, low 2, each nonzero class one distinct bit that movement blocks", () => {
    expect(TILE_FLOOR).toBe(0);
    expect(TILE_WALL).toBe(1);
    expect(TILE_LOW).toBe(2);
    for (const code of [TILE_WALL, TILE_LOW]) {
      expect(code & (code - 1), `code ${code} is a single bit`).toBe(0);
      expect(code & MASK_MOVE).not.toBe(0);
    }
    expect(TILE_WALL & TILE_LOW).toBe(0);
    expect(TILE_FLOOR & MASK_MOVE).toBe(0);
  });

  it("MASK_SIGHT is the wall alone, MASK_MOVE every class, MASK_MELEE the wall and LOW", () => {
    expect(MASK_SIGHT).toBe(TILE_WALL);
    expect(MASK_MOVE).toBe(0xff);
    expect(MASK_MELEE).toBe(TILE_WALL | TILE_LOW);
    expect(MASK_SIGHT & TILE_LOW).toBe(0);
    // A class that does not exist yet (the next bit) still blocks a walker.
    expect(4 & MASK_MOVE).not.toBe(0);
  });

  const m = ascii(["####", "#.~#", "####"]);

  it("blocksTile tests (tile & mask), and out of bounds blocks every query", () => {
    expect(blocksTile(m, 1, 1, MASK_SIGHT)).toBe(false);
    expect(blocksTile(m, 1, 1, MASK_MOVE)).toBe(false);
    expect(blocksTile(m, 2, 1, MASK_SIGHT)).toBe(false);
    expect(blocksTile(m, 2, 1, MASK_MOVE)).toBe(true);
    expect(blocksTile(m, 2, 1, MASK_MELEE)).toBe(true);
    expect(blocksTile(m, 0, 0, MASK_SIGHT)).toBe(true);
    expect(blocksTile(m, 0, 0, TILE_LOW)).toBe(false); // a mask that names only LOW does not see a wall
    for (const mask of [MASK_SIGHT, MASK_MOVE, MASK_MELEE, TILE_LOW, 0]) {
      for (const [x, y] of [[-1, 1], [1, -1], [4, 1], [1, 3]]) expect(blocksTile(m, x, y, mask), `${x},${y} mask ${mask}`).toBe(true);
    }
  });

  it("isWallTile means opaque and isSolidTile means blocks movement: LOW is solid but not opaque", () => {
    expect([isWallTile(m, 1, 1), isSolidTile(m, 1, 1)]).toEqual([false, false]); // floor
    expect([isWallTile(m, 0, 0), isSolidTile(m, 0, 0)]).toEqual([true, true]); // wall
    expect([isWallTile(m, 2, 1), isSolidTile(m, 2, 1)]).toEqual([false, true]); // LOW
    for (const [x, y] of [[-1, 0], [0, -1], [4, 0], [0, 3]]) expect([isWallTile(m, x, y), isSolidTile(m, x, y)]).toEqual([true, true]);
  });

  it("isWallAt and isSolidAt read the tile under a world point, tile edges included", () => {
    expect(isSolidAt(m, 2 * TILE + 5, TILE + 5)).toBe(true);
    expect(isWallAt(m, 2 * TILE + 5, TILE + 5)).toBe(false);
    expect(isSolidAt(m, 2 * TILE - 0.001, TILE + 5)).toBe(false);
    expect(isSolidAt(m, 2 * TILE, TILE + 5)).toBe(true); // the west face belongs to the LOW tile
    expect(isWallAt(m, 5, 5)).toBe(true);
    expect(isSolidAt(m, -1, 40)).toBe(true);
    expect(isWallAt(m, 40, -1)).toBe(true);
  });
});

describe("mapFromTiles terrain and props", () => {
  it("terrain defaults to zeros, a fresh array per map, and props to an empty fresh list", () => {
    const a = mapFromTiles(3, 2, new Uint8Array(6));
    const b = mapFromTiles(3, 2, new Uint8Array(6));
    expect(a.terrain).toBeInstanceOf(Uint8Array);
    expect(a.terrain.length).toBe(6);
    expect(Array.from(a.terrain).every((k) => k === 0)).toBe(true);
    expect(a.terrain).not.toBe(b.terrain);
    expect(a.terrain).not.toBe(a.regionGrid);
    expect(a.props).toEqual([]);
    a.props.push({ kind: 0, x: 1, y: 2, v: 3 });
    expect(b.props).toEqual([]);
  });

  it("uses a supplied terrain as is", () => {
    const terrain = new Uint8Array(6);
    terrain[4] = 2;
    const m = mapFromTiles(3, 2, new Uint8Array(6), 7, terrain);
    expect(m.terrain).toBe(terrain);
    expect(m.seed).toBe(7);
  });

  it("throws a RangeError for a terrain of the wrong length", () => {
    expect(() => mapFromTiles(3, 2, new Uint8Array(6), 0, new Uint8Array(5))).toThrow(RangeError);
    expect(() => mapFromTiles(3, 2, new Uint8Array(6), 0, new Uint8Array(7))).toThrow(RangeError);
    expect(() => mapFromTiles(3, 2, new Uint8Array(6), 0, new Uint8Array(6))).not.toThrow();
  });
});

describe("withGates and the terrain layer", () => {
  it("shares terrain and props with the locked copy, and differs from the original only on the gate tiles", () => {
    const m = twoRooms();
    m.terrain[8 * 1 + 1] = 4;
    m.props.push({ kind: 0, x: 40, y: 40, v: 1 });
    const locked = withGates(m);
    expect(locked.terrain).toBe(m.terrain);
    expect(locked.props).toBe(m.props);
    expect(locked.tiles).not.toBe(m.tiles);
    const diff: number[] = [];
    for (let i = 0; i < m.tiles.length; i++) if (locked.tiles[i] !== m.tiles[i]) diff.push(i);
    expect(diff).toEqual([2 * m.w + 6, 3 * m.w + 6]);
  });

  it("keeps LOW tiles as LOW in the locked copy", () => {
    const m = twoRooms();
    m.tiles[4 * m.w + 3] = TILE_LOW;
    expect(at(withGates(m), 3, 4)).toBe(TILE_LOW);
  });
});

/** Reference: 4-connected floor components by repeated relabelling, no queue. */
function bruteComponents(tiles: Uint8Array, w: number, h: number): Int32Array {
  const id = new Int32Array(w * h).fill(-1);
  let next = 0;
  for (let s = 0; s < w * h; s++) {
    if (tiles[s] !== TILE_FLOOR || id[s] >= 0) continue;
    const stack = [s];
    id[s] = next;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w, y = (i - x) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (tiles[j] === TILE_FLOOR && id[j] < 0) { id[j] = next; stack.push(j); }
      }
    }
    next++;
  }
  return id;
}

describe("sightMask, moveMask and moveComponents", () => {
  const m = ascii([
    "#########",
    "#..~....#",
    "#..~.##.#",
    "#..~.#..#",
    "#~~~.#~~#",
    "#.......#",
    "#########",
  ]);

  it("sightMask marks the walls only, moveMask every class but floor", () => {
    const sight = sightMask(m), move = moveMask(m);
    expect(sight).toBeInstanceOf(Uint8Array);
    expect(sight.length).toBe(m.w * m.h);
    for (let i = 0; i < m.tiles.length; i++) {
      expect(sight[i], `sight ${i}`).toBe(m.tiles[i] === TILE_WALL ? 1 : 0);
      expect(move[i], `move ${i}`).toBe(m.tiles[i] !== TILE_FLOOR ? 1 : 0);
    }
    expect(sight.some((v, i) => v === 0 && move[i] === 1)).toBe(true); // LOW is in the second only
  });

  it("moveComponents labels 4-connected floor like a brute-force flood, -1 on solid tiles", () => {
    const comp = moveComponents(m);
    const ref = bruteComponents(m.tiles, m.w, m.h);
    expect(comp).toBeInstanceOf(Int32Array);
    expect(Array.from(comp)).toEqual(Array.from(ref));
    for (let i = 0; i < m.tiles.length; i++) expect(comp[i] === -1).toBe(m.tiles[i] !== TILE_FLOOR);
    expect(Math.max(...comp) + 1).toBe(2); // the 2x3 room on the left is closed in by the LOW column and the LOW row
    // A diagonal step is not a link: two floor tiles that touch only at a corner are two components.
    const diag = ascii(["####", "#.##", "##.#", "####"]);
    const dc = moveComponents(diag);
    expect(dc[1 * 4 + 1]).not.toBe(dc[2 * 4 + 2]);
  });

  it("agrees with a brute-force flood on random maps with walls and LOW tiles", () => {
    const rng = mulberry32(5);
    for (let k = 0; k < 30; k++) {
      const w = 10 + (k % 5), h = 9 + (k % 4);
      const tiles = new Uint8Array(w * h);
      for (let i = 0; i < tiles.length; i++) { const r = rng(); tiles[i] = r < 0.2 ? TILE_WALL : r < 0.4 ? TILE_LOW : TILE_FLOOR; }
      const map = mapFromTiles(w, h, tiles);
      expect(Array.from(moveComponents(map))).toEqual(Array.from(bruteComponents(tiles, w, h)));
      expect(Array.from(sightMask(map))).toEqual(Array.from(tiles, (t) => (t === TILE_WALL ? 1 : 0)));
      expect(Array.from(moveMask(map))).toEqual(Array.from(tiles, (t) => (t === TILE_FLOOR ? 0 : 1)));
    }
  });

  it("caches per map object: the second call returns the same array", () => {
    expect(sightMask(m)).toBe(sightMask(m));
    expect(moveMask(m)).toBe(moveMask(m));
    expect(moveComponents(m)).toBe(moveComponents(m));
    const copy = mapFromTiles(m.w, m.h, m.tiles.slice());
    expect(moveMask(copy)).not.toBe(moveMask(m));
    expect(Array.from(moveMask(copy))).toEqual(Array.from(moveMask(m)));
  });

  it("gives the locked copy its own entries, built from the locked tiles", () => {
    const rooms = twoRooms();
    const locked = withGates(rooms);
    expect(moveMask(locked)).not.toBe(moveMask(rooms));
    expect(sightMask(locked)).not.toBe(sightMask(rooms));
    expect(moveComponents(locked)).not.toBe(moveComponents(rooms));
    expect(moveMask(locked)).toBe(moveMask(locked));
    expect(moveMask(rooms)[2 * rooms.w + 6]).toBe(0);
    expect(moveMask(locked)[2 * rooms.w + 6]).toBe(1);
    expect(Math.max(...moveComponents(rooms)) + 1).toBe(1);
    expect(Math.max(...moveComponents(locked)) + 1).toBe(2);
    // Asking the original again is untouched by the locked copy's cache.
    expect(moveMask(rooms)[2 * rooms.w + 6]).toBe(0);
  });

  it("forgetMapCaches rebuilds after tiles are edited, and the next withGates is built from the edited tiles", () => {
    const rooms = twoRooms();
    const before = { sight: sightMask(rooms), move: moveMask(rooms), comp: moveComponents(rooms), locked: withGates(rooms) };
    expect(Math.max(...before.comp) + 1).toBe(1);
    // Wall off the gate for good: floor into wall, then a query that must see it.
    rooms.tiles[2 * rooms.w + 6] = TILE_WALL;
    rooms.tiles[3 * rooms.w + 6] = TILE_WALL;
    expect(moveMask(rooms)).toBe(before.move); // stale until told
    forgetMapCaches(rooms);
    const after = { sight: sightMask(rooms), move: moveMask(rooms), comp: moveComponents(rooms), locked: withGates(rooms) };
    expect(after.sight).not.toBe(before.sight);
    expect(after.move).not.toBe(before.move);
    expect(after.comp).not.toBe(before.comp);
    expect(after.locked).not.toBe(before.locked);
    expect(after.move[2 * rooms.w + 6]).toBe(1);
    expect(Math.max(...after.comp) + 1).toBe(2);
    expect(moveMask(rooms)).toBe(after.move); // and cached again
    // Forgetting a map that has nothing cached is fine.
    expect(() => forgetMapCaches(ascii(["###"]))).not.toThrow();
  });
});

describe("sightBlockedTiles, moveBlockedTiles and moveComponentsOf (uncached, for a generator still editing)", () => {
  const rows = ["#####", "#.~.#", "#####"];
  const m = ascii(rows);

  it("give the same answers as the cached views", () => {
    expect(Array.from(sightBlockedTiles(m.tiles))).toEqual(Array.from(sightMask(m)));
    expect(Array.from(moveBlockedTiles(m.tiles))).toEqual(Array.from(moveMask(m)));
    expect(Array.from(moveComponentsOf(m.tiles, m.w, m.h))).toEqual(Array.from(moveComponents(m)));
  });

  it("fill and return a supplied array, and reject one of the wrong length", () => {
    const out = new Uint8Array(m.tiles.length).fill(9);
    expect(sightBlockedTiles(m.tiles, out)).toBe(out);
    expect(Array.from(out)).toEqual(Array.from(sightMask(m)));
    expect(moveBlockedTiles(m.tiles, out)).toBe(out);
    expect(Array.from(out)).toEqual(Array.from(moveMask(m)));
    expect(() => sightBlockedTiles(m.tiles, new Uint8Array(3))).toThrow(RangeError);
    expect(() => moveBlockedTiles(m.tiles, new Uint8Array(99))).toThrow(RangeError);
  });

  it("see an edit at once, where the cached views would be stale", () => {
    const tiles = m.tiles.slice();
    expect(moveBlockedTiles(tiles)[1 * m.w + 2]).toBe(1);
    tiles[1 * m.w + 2] = TILE_FLOOR;
    expect(moveBlockedTiles(tiles)[1 * m.w + 2]).toBe(0);
    expect(Math.max(...moveComponentsOf(tiles, m.w, m.h)) + 1).toBe(1);
    tiles[1 * m.w + 2] = TILE_LOW;
    expect(Math.max(...moveComponentsOf(tiles, m.w, m.h)) + 1).toBe(2);
  });
});

describe("generated maps and the new layers", () => {
  const maps = seeds(12, 1).map((s) => generateMap(s));
  const plainMaps = seeds(12, 1).map((s) => generateMap(s, undefined, { styleZones: null }));

  it("carry a terrain layer of their own size, and the gated copy shares it", () => {
    for (const m of [...maps, ...plainMaps]) {
      expect(m.terrain.length).toBe(m.w * m.h);
      expect(withGates(m).terrain).toBe(m.terrain);
    }
  });

  it("have a zero terrain layer, no props and only floor and wall tiles without the zone stylers", () => {
    for (const m of plainMaps) {
      expect(m.terrain.every((k) => k === 0)).toBe(true);
      expect(m.props).toEqual([]);
      expect(m.tiles.every((t) => t === TILE_FLOOR || t === TILE_WALL)).toBe(true);
    }
  });

  it("have one floor component with the gates open and two with them closed; sight equals movement without low ground and differs exactly at it with", () => {
    for (const m of [...maps, ...plainMaps]) {
      expect(Math.max(...moveComponents(m)) + 1).toBe(1);
      expect(Math.max(...moveComponents(withGates(m))) + 1).toBe(2);
    }
    for (const m of plainMaps) expect(Array.from(sightMask(m))).toEqual(Array.from(moveMask(m)));
    let low = 0;
    for (const m of maps) {
      const sight = sightMask(m), move = moveMask(m);
      for (let i = 0; i < sight.length; i++) {
        expect(sight[i] === move[i], `tile ${i}`).toBe(m.tiles[i] !== TILE_LOW);
        if (m.tiles[i] === TILE_LOW) low++;
      }
    }
    expect(low, "the stylers laid low ground at all").toBeGreaterThan(0);
  });
});

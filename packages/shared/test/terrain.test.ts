import { describe, expect, it } from "vitest";
import { PLAYER_SPEED, TILE } from "../src/constants";
import { FACTION_IDS } from "../src/factions";
import {
  REGION_COLISEUM,
  REGION_FACTIONS,
  REGION_NONE,
  TILE_FLOOR,
  TILE_LOW,
  TILE_WALL,
  mapFromTiles,
  regionCode,
  tileToWorldCenter,
} from "../src/map";
import type { GameMap } from "../src/map";
import { generateMap } from "../src/mapgen";
import { ZONE_PROP, ZONE_PROP_KINDS } from "../src/zoneStyle";
import {
  PROP_KINDS,
  TERRAINS,
  TERRAIN_BOG,
  TERRAIN_CREVASSE,
  TERRAIN_EMBER,
  TERRAIN_FENCE,
  TERRAIN_ICE,
  TERRAIN_LAVA,
  TERRAIN_LIGHT,
  TERRAIN_NONE,
  terrainAt,
  terrainAtTile,
  validateTerrain,
  MOVE_MULT_FLOOR,
  forgetHazards,
  hazardsOf,
  slipAccel,
  surfaceAt,
  surfaceEffect,
} from "../src/terrain";

const tc = tileToWorldCenter;

describe("the terrain catalog", () => {
  it("has the eight v1 kinds in this order (append only: a pinned list)", () => {
    expect(TERRAINS.map((t) => t.key)).toEqual(["none", "lava", "fence", "crevasse", "ember", "bog", "ice", "light"]);
    expect(TERRAINS[0].key).toBe("none");
    expect([TERRAIN_NONE, TERRAIN_LAVA, TERRAIN_FENCE, TERRAIN_CREVASSE, TERRAIN_EMBER, TERRAIN_BOG, TERRAIN_ICE, TERRAIN_LIGHT]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(TERRAINS.length).toBeLessThanOrEqual(256); // a kind is a byte
  });

  it("puts every kind on a tile class: floor kinds on FLOOR, LOW kinds on LOW, none on nothing", () => {
    expect(TERRAINS[TERRAIN_NONE].tile).toBeNull();
    for (const k of [TERRAIN_LAVA, TERRAIN_FENCE, TERRAIN_CREVASSE]) expect(TERRAINS[k].tile, TERRAINS[k].key).toBe(TILE_LOW);
    for (const k of [TERRAIN_EMBER, TERRAIN_BOG, TERRAIN_ICE, TERRAIN_LIGHT]) expect(TERRAINS[k].tile, TERRAINS[k].key).toBe(TILE_FLOOR);
    for (const t of TERRAINS.slice(1)) expect([TILE_FLOOR, TILE_LOW]).toContain(t.tile);
  });

  it("gives each kind its home faction (a real one or none)", () => {
    expect(TERRAINS.map((t) => t.home)).toEqual([null, "fire", "sentenced", "frost", "fire", "plague", "frost", "holy"]);
    for (const t of TERRAINS) if (t.home !== null) expect(REGION_FACTIONS).toContain(t.home);
  });

  it("keeps every number in range", () => {
    for (const t of TERRAINS) {
      expect(t.speedMult, t.key).toBeGreaterThan(0);
      expect(t.speedMult, t.key).toBeLessThanOrEqual(1);
      expect(t.slipMs, t.key).toBeGreaterThanOrEqual(0);
      expect(t.burnShare, t.key).toBeGreaterThanOrEqual(0);
      expect(t.healShare, t.key).toBeGreaterThanOrEqual(0);
      expect(t.homeMult, t.key).toBeGreaterThanOrEqual(1);
      if (t.homeRule !== "boost") expect(t.homeMult, t.key).toBe(1);
      expect(Number.isInteger(t.color) && t.color >= 0 && t.color <= 0xffffff, t.key).toBe(true);
      expect(t.name.length, t.key).toBeGreaterThan(0);
    }
  });

  it("gives a LOW kind and NONE no effects: nobody stands on them", () => {
    for (const k of [TERRAIN_NONE, TERRAIN_LAVA, TERRAIN_FENCE, TERRAIN_CREVASSE]) {
      const t = TERRAINS[k];
      expect([t.speedMult, t.slipMs, t.burnShare, t.healShare, t.homeMult], t.key).toEqual([1, 0, 0, 0, 1]);
      expect(t.homeRule, t.key).toBe("none");
    }
  });

  it("carries the first-pick hazard numbers: one effect per floor kind, the home faction exempt or boosted", () => {
    const ember = TERRAINS[TERRAIN_EMBER], bog = TERRAINS[TERRAIN_BOG], ice = TERRAINS[TERRAIN_ICE], light = TERRAINS[TERRAIN_LIGHT];
    expect(ember).toMatchObject({ burnShare: 0.02, homeRule: "exempt", speedMult: 1, slipMs: 0, healShare: 0 });
    expect(bog).toMatchObject({ speedMult: 0.7, homeRule: "exempt", burnShare: 0, slipMs: 0, healShare: 0 });
    expect(ice).toMatchObject({ slipMs: 400, homeRule: "exempt", burnShare: 0, speedMult: 1, healShare: 0 });
    expect(light).toMatchObject({ healShare: 0.006, homeRule: "boost", homeMult: 2, burnShare: 0, speedMult: 1, slipMs: 0 });
  });

  it("owns the real prop table: the stylers' own array, ids append only", () => {
    expect(PROP_KINDS).toBe(ZONE_PROP_KINDS);
    expect(PROP_KINDS).toHaveLength(34);
    expect(PROP_KINDS.map((k) => k.key).slice(0, 5)).toEqual(["ember_vent", "glow_crack", "basalt_shard", "ash_drift", "banner"]);
    // The zone shapes' kinds, appended in the contract's order (zone-shapes contract 7.5).
    expect(PROP_KINDS.map((k) => k.key).slice(22)).toEqual([
      "crater_lip", "anvil", "slag_heap", "gate_post", "stocks", "tunnel_beam", "burrow_rubble", "reed", "tower_frost", "ice_crack", "altar", "brazier",
    ]);
    expect(PROP_KINDS[ZONE_PROP.stained_glass]).toMatchObject({ key: "stained_glass", home: "holy" });
    expect(new Set(PROP_KINDS.map((k) => k.key)).size).toBe(PROP_KINDS.length);
    for (const k of PROP_KINDS) expect([TILE_FLOOR, TILE_LOW, TILE_WALL], k.key).toContain(k.on);
  });
});

describe("terrainAt and terrainAtTile", () => {
  const m = mapFromTiles(4, 3, new Uint8Array(12));
  m.terrain[1 * 4 + 2] = TERRAIN_BOG;
  m.terrain[0] = TERRAIN_LAVA;

  it("read the kind of the tile, and out of bounds is NONE", () => {
    expect(terrainAtTile(m, 2, 1)).toBe(TERRAIN_BOG);
    expect(terrainAtTile(m, 0, 0)).toBe(TERRAIN_LAVA);
    expect(terrainAtTile(m, 1, 1)).toBe(TERRAIN_NONE);
    for (const [x, y] of [[-1, 0], [0, -1], [4, 0], [0, 3], [99, 99]]) expect(terrainAtTile(m, x, y), `${x},${y}`).toBe(TERRAIN_NONE);
  });

  it("terrainAt agrees with terrainAtTile on the tile under a world point, edges included", () => {
    expect(terrainAt(m, 2 * TILE, 1 * TILE)).toBe(TERRAIN_BOG);
    expect(terrainAt(m, 2 * TILE + 31.99, 1 * TILE + 31.99)).toBe(TERRAIN_BOG);
    expect(terrainAt(m, 2 * TILE - 0.01, 1 * TILE + 5)).toBe(TERRAIN_NONE);
    expect(terrainAt(m, 5, 5)).toBe(TERRAIN_LAVA);
    expect(terrainAt(m, -1, 5)).toBe(TERRAIN_NONE);
    expect(terrainAt(m, 4 * TILE, 5)).toBe(TERRAIN_NONE);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) expect(terrainAt(m, tc(x), tc(y))).toBe(terrainAtTile(m, x, y));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// validateTerrain: a clean map, then one broken map per rule id.

const ruleIds = (errs: string[]): string[] => [...new Set(errs.map((e) => e.split(" ")[0]))];

/** A 13x13 hand-built map: wall border, floor inside, no regions (so T1..T5 only). */
function plain(): GameMap {
  const n = 13;
  const tiles = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) tiles[y * n + x] = x === 0 || y === 0 || x === n - 1 || y === n - 1 ? TILE_WALL : TILE_FLOOR;
  return mapFromTiles(n, n, tiles);
}
const idx = (m: GameMap, x: number, y: number): number => y * m.w + x;
const put = (m: GameMap, x: number, y: number, tile: number, kind = TERRAIN_NONE): void => {
  m.tiles[idx(m, x, y)] = tile;
  m.terrain[idx(m, x, y)] = kind;
};

describe("validateTerrain, T1..T5 (any map)", () => {
  it("accepts a clean map, and a map with every legal combination of class and kind", () => {
    const m = plain();
    expect(validateTerrain(m)).toEqual([]);
    put(m, 3, 3, TILE_LOW, TERRAIN_LAVA);
    put(m, 3, 4, TILE_LOW, TERRAIN_FENCE);
    put(m, 3, 5, TILE_LOW, TERRAIN_CREVASSE);
    put(m, 3, 6, TILE_LOW, TERRAIN_NONE); // a generic barrier of a hand-built map
    put(m, 6, 3, TILE_FLOOR, TERRAIN_EMBER);
    put(m, 6, 4, TILE_FLOOR, TERRAIN_BOG);
    put(m, 6, 5, TILE_FLOOR, TERRAIN_ICE);
    put(m, 6, 6, TILE_FLOOR, TERRAIN_LIGHT);
    put(m, 9, 3, TILE_WALL, TERRAIN_LAVA); // a pillar standing in the feature: decor only
    put(m, 9, 4, TILE_WALL, TERRAIN_FENCE);
    put(m, 9, 5, TILE_WALL, TERRAIN_CREVASSE);
    put(m, 9, 6, TILE_WALL, TERRAIN_NONE); // an ordinary rock
    expect(validateTerrain(m)).toEqual([]);
    expect(validateTerrain(m, { styled: false })).toEqual([]);
  });

  it("T1: tiles, terrain and regionGrid must each be w*h long, and nothing else is checked then", () => {
    const base = plain();
    for (const broken of [
      { ...base, tiles: new Uint8Array(5) },
      { ...base, terrain: new Uint8Array(3) },
      { ...base, regionGrid: new Uint8Array(200) },
    ]) {
      const errs = validateTerrain(broken);
      expect(errs.length).toBe(1);
      expect(ruleIds(errs)).toEqual(["T1"]);
    }
    const all = validateTerrain({ ...base, tiles: new Uint8Array(1), terrain: new Uint8Array(1), regionGrid: new Uint8Array(1) });
    expect(all.length).toBe(3);
  });

  it("T2: a tile code outside {floor, wall, low}, and a terrain kind past the catalog", () => {
    const code = plain();
    code.tiles[idx(code, 5, 5)] = 3; // wall | low
    expect(ruleIds(validateTerrain(code))).toEqual(["T2"]);
    const code4 = plain();
    code4.tiles[idx(code4, 5, 5)] = 4; // the next class, not generated yet
    expect(ruleIds(validateTerrain(code4))).toEqual(["T2"]);
    const kind = plain();
    kind.terrain[idx(kind, 5, 5)] = TERRAINS.length;
    expect(ruleIds(validateTerrain(kind))).toEqual(["T2"]);
    const kind2 = plain();
    kind2.terrain[idx(kind2, 5, 5)] = 255;
    expect(ruleIds(validateTerrain(kind2))).toEqual(["T2"]);
  });

  it("T3: a floor kind only on floor, a LOW kind on LOW or on a wall", () => {
    const cases: Array<[string, number, number]> = [
      ["ember on a wall", TILE_WALL, TERRAIN_EMBER],
      ["ice on LOW", TILE_LOW, TERRAIN_ICE],
      ["bog on LOW", TILE_LOW, TERRAIN_BOG],
      ["lava on floor", TILE_FLOOR, TERRAIN_LAVA],
      ["fence on floor", TILE_FLOOR, TERRAIN_FENCE],
      ["light on a wall", TILE_WALL, TERRAIN_LIGHT],
    ];
    for (const [label, tile, kind] of cases) {
      const m = plain();
      put(m, 5, 5, tile, kind);
      expect(ruleIds(validateTerrain(m)), label).toEqual(["T3"]);
    }
  });

  it("T4: the border ring must be wall, never LOW or floor", () => {
    const corners: Array<[number, number]> = [[0, 0], [12, 0], [0, 12], [12, 12], [5, 0], [5, 12], [0, 5], [12, 5]];
    for (const [x, y] of corners) {
      for (const tile of [TILE_LOW, TILE_FLOOR]) {
        const m = plain();
        m.tiles[idx(m, x, y)] = tile;
        expect(ruleIds(validateTerrain(m)), `${x},${y} as ${tile}`).toEqual(["T4"]);
      }
    }
  });

  it("T5: every LOW tile must lie within four tiles of floor, and four is allowed", () => {
    // LOW from 2 to 8 is seven wide inside a floor ring: the centre is four from the ring.
    const four = plain();
    for (let y = 2; y <= 8; y++) for (let x = 2; x <= 8; x++) put(four, x, y, TILE_LOW, TERRAIN_LAVA);
    expect(validateTerrain(four)).toEqual([]);
    // Nine wide (2..10): the centre is five away.
    const five = plain();
    for (let y = 2; y <= 10; y++) for (let x = 2; x <= 10; x++) put(five, x, y, TILE_LOW, TERRAIN_LAVA);
    const errs = validateTerrain(five);
    expect(ruleIds(errs)).toEqual(["T5"]);
    expect(errs[0]).toContain("(6, 6)");
  });

  it("T5 counts the manhattan distance, not a walk through LOW (the click snap looks through anything)", () => {
    const m = plain();
    // LOW at (6,6) with walls around it: floor is two tiles away in manhattan terms even though no LOW path leads there.
    for (let y = 5; y <= 7; y++) for (let x = 5; x <= 7; x++) put(m, x, y, TILE_WALL);
    put(m, 6, 6, TILE_LOW, TERRAIN_LAVA);
    expect(validateTerrain(m)).toEqual([]);
  });

  it("does not use the map caches: it sees an edit made after a previous call", () => {
    const m = plain();
    expect(validateTerrain(m)).toEqual([]);
    put(m, 5, 5, TILE_FLOOR, TERRAIN_LAVA);
    expect(ruleIds(validateTerrain(m))).toEqual(["T3"]);
    put(m, 5, 5, TILE_LOW, TERRAIN_LAVA);
    expect(validateTerrain(m)).toEqual([]);
  });
});

/**
 * A hand-built map that looks generated: a 16x7 board whose west room (x 1..5) is the coliseum, a wall column x=6 with a
 * two-tile gate at y=2..3, and a fire room (x 7..14). One spawn, chest, camp and inner spawn, all on plain floor.
 */
function regioned(): GameMap {
  const w = 16, h = 7;
  const tiles = new Uint8Array(w * h);
  const regionGrid = new Uint8Array(w * h);
  const fire = regionCode("fire");
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      tiles[y * w + x] = edge || x === 6 ? TILE_WALL : TILE_FLOOR;
      regionGrid[y * w + x] = edge ? REGION_NONE : x <= 6 ? REGION_COLISEUM : fire;
    }
  }
  tiles[2 * w + 6] = TILE_FLOOR;
  tiles[3 * w + 6] = TILE_FLOOR;
  const m = mapFromTiles(w, h, tiles);
  m.regionGrid = regionGrid;
  m.coliseum.gates = [{ side: "e", tiles: [{ x: 6, y: 2 }, { x: 6, y: 3 }], x: tc(6), y: (tc(2) + tc(3)) / 2 }];
  m.coliseum.innerSpawns = [{ x: tc(3), y: tc(3) }];
  m.spawns = [{ x: tc(9), y: tc(3) }];
  m.crateSpots = [{ x: tc(8), y: tc(5) }];
  m.camps = [{ id: "fire-1", zone: "fire", x: tc(9), y: tc(2), r: 40, spots: [{ x: tc(9), y: tc(2) }], eliteSpot: -1, chest: { x: tc(9), y: tc(1) }, area: 0, radius: 288 }];
  m.regions = [{ id: "fire", pole: { x: tc(9), y: tc(3) }, area: 20, spawns: [{ x: tc(9), y: tc(3) }], chestSpots: [{ x: tc(8), y: tc(5) }], mobCamps: [] }];
  return m;
}

describe("validateTerrain, T6..T10 (generated-looking maps)", () => {
  it("accepts the clean board, and a LOW feature and a floor hazard in the home zone off the protected cells", () => {
    const m = regioned();
    expect(validateTerrain(m)).toEqual([]);
    put(m, 7, 4, TILE_LOW, TERRAIN_LAVA); // fire's lava in fire's room
    put(m, 13, 5, TILE_FLOOR, TERRAIN_EMBER); // off the spawn's 5x5 and the chest's 3x3
    put(m, 14, 4, TILE_FLOOR, TERRAIN_EMBER);
    expect(validateTerrain(m)).toEqual([]);
    expect(validateTerrain(m, { styled: true })).toEqual([]);
  });

  it("T6: a LOW or kinded tile outside every faction region, or outside the kind's home zone", () => {
    const none = regioned();
    put(none, 7, 4, TILE_LOW, TERRAIN_LAVA);
    none.regionGrid[idx(none, 7, 4)] = REGION_NONE;
    expect(ruleIds(validateTerrain(none))).toEqual(["T6"]);

    const coliseum = regioned();
    put(coliseum, 7, 4, TILE_LOW, TERRAIN_NONE);
    coliseum.regionGrid[idx(coliseum, 7, 4)] = REGION_COLISEUM;
    expect(ruleIds(validateTerrain(coliseum))).toEqual(["T6", "T8"]); // and the footprint must hold no LOW at all

    const wrongHome = regioned();
    put(wrongHome, 7, 4, TILE_LOW, TERRAIN_FENCE); // the Gallows' fence in fire's room
    expect(ruleIds(validateTerrain(wrongHome))).toEqual(["T6"]);

    const floorKind = regioned();
    put(floorKind, 13, 5, TILE_FLOOR, TERRAIN_BOG); // Plague's bog in fire's room
    expect(ruleIds(validateTerrain(floorKind))).toEqual(["T6"]);

    const wallKind = regioned();
    put(wallKind, 7, 5, TILE_WALL, TERRAIN_LAVA); // a pillar in a feature, outside every zone
    wallKind.regionGrid[idx(wallKind, 7, 5)] = REGION_NONE;
    expect(ruleIds(validateTerrain(wallKind))).toEqual(["T6"]);

    const other = regioned();
    put(other, 7, 4, TILE_LOW, TERRAIN_LAVA);
    other.regionGrid[idx(other, 7, 4)] = regionCode("plague");
    expect(ruleIds(validateTerrain(other))).toEqual(["T6"]);
  });

  it("T7: floor in two pieces with the gates open, or not exactly two with them closed", () => {
    const split = regioned();
    for (let y = 1; y <= 5; y++) put(split, 7, y, TILE_LOW, TERRAIN_LAVA); // a river between the gate and the fire room
    const errs = validateTerrain(split);
    expect(ruleIds(errs)).toEqual(["T7"]);
    expect(errs).toHaveLength(1); // two pieces with the gates open; closed it is still the arena and the fire room
    expect(errs[0]).toContain("gates open");

    const unsealed = regioned();
    unsealed.coliseum.gates = []; // closing nothing leaves one piece
    const unsealedErrs = validateTerrain(unsealed);
    expect(ruleIds(unsealedErrs)).toEqual(["T7"]);
    expect(unsealedErrs[0]).toContain("gates closed");

    const pocket = regioned();
    put(pocket, 10, 1, TILE_FLOOR);
    put(pocket, 9, 1, TILE_WALL);
    put(pocket, 11, 1, TILE_WALL);
    put(pocket, 10, 2, TILE_WALL);
    // (10,1) is a one-tile floor island (and the camp chest is now a wall, which T8 reports as well).
    const pocketErrs = validateTerrain(pocket);
    expect(ruleIds(pocketErrs)).toContain("T7");
  });

  it("T8: spawn, chest, camp clearing, inner spawn, gate and coliseum cells must be plain floor", () => {
    const only = (m: GameMap): string[] => ruleIds(validateTerrain(m));
    const spawn = regioned();
    put(spawn, 9, 3, TILE_FLOOR, TERRAIN_EMBER);
    expect(only(spawn)).toEqual(["T8"]);
    expect(validateTerrain(spawn)[0]).toContain("spawn");

    const spawnEdge = regioned();
    put(spawnEdge, 8, 4, TILE_FLOOR, TERRAIN_EMBER); // a corner of the 3x3
    expect(only(spawnEdge)).toEqual(["T8"]);
    const spawnOut = regioned();
    put(spawnOut, 12, 4, TILE_FLOOR, TERRAIN_EMBER); // just outside the 5x5 (x 7..11)
    expect(only(spawnOut)).toEqual([]);
    const spawnRing = regioned();
    put(spawnRing, 7, 4, TILE_FLOOR, TERRAIN_EMBER); // the 5x5 ring: not the 3x3, but no hazard may sit there
    expect(only(spawnRing)).toEqual(["T8"]);
    expect(validateTerrain(spawnRing)[0]).toContain("5x5");
    const spawnRingFence = regioned();
    put(spawnRingFence, 7, 4, TILE_LOW, TERRAIN_LAVA); // lava (fire's own LOW kind) is not a floor hazard
    expect(only(spawnRingFence)).toEqual([]);

    const chest = regioned();
    put(chest, 8, 5, TILE_LOW, TERRAIN_LAVA);
    expect(only(chest)).toEqual(["T8"]);
    expect(validateTerrain(chest)[0]).toContain("chest");

    const clearing = regioned();
    put(clearing, 9, 1, TILE_FLOOR, TERRAIN_EMBER); // the camp's chest tile and part of its clearing (r 40 reaches the 4 neighbours)
    expect(only(clearing)).toEqual(["T8"]);
    const beyond = regioned();
    put(beyond, 8, 1, TILE_LOW, TERRAIN_LAVA); // diagonal: 45 u from the camp centre, outside r 40 (lava is not a floor hazard, so the spawn's 5x5 allows it)
    expect(only(beyond)).toEqual([]);

    // Cells in the coliseum region also break T6, but T8 must be among the reasons.
    const inner = regioned();
    put(inner, 3, 3, TILE_FLOOR, TERRAIN_ICE);
    expect(ruleIds(validateTerrain(inner))).toContain("T8");
    const gate = regioned();
    put(gate, 6, 2, TILE_LOW, TERRAIN_NONE);
    expect(ruleIds(validateTerrain(gate))).toContain("T8");
    const arena = regioned();
    put(arena, 5, 5, TILE_FLOOR, TERRAIN_LIGHT);
    expect(ruleIds(validateTerrain(arena))).toEqual(expect.arrayContaining(["T6", "T8"]));
    const wall = regioned();
    put(wall, 3, 3, TILE_WALL); // a spawn cell that is a wall
    expect(ruleIds(validateTerrain(wall))).toContain("T8");

    // A spawn 3x3 that leaves the board is a violation as well.
    const edge = regioned();
    edge.spawns = [{ x: tc(15), y: tc(5) }]; // its 3x3 reaches column 16, off a 16-wide board
    expect(only(edge)).toEqual(["T8"]);
  });

  it("T8 hazard rings: no floor hazard on a spawn's 5x5, beside a crate or chest, near a ground-loot spot, or within one tile of a camp clearing", () => {
    const only = (m: GameMap): string[] => ruleIds(validateTerrain(m));
    const first = (m: GameMap): string => validateTerrain(m).find((e) => e.startsWith("T8")) ?? "";
    /** The fire room with no spawn, so each ring is judged alone: crate (8,5), one camp at (13,3) (clearing: a plus of 5 tiles), camp chest (13,2). */
    const bare = (): GameMap => {
      const m = regioned();
      m.spawns = [];
      m.regions[0].spawns = [];
      m.camps = [{ ...m.camps[0], id: "fire-2", x: tc(13), y: tc(3), spots: [{ x: tc(13), y: tc(3) }], chest: { x: tc(13), y: tc(2) } }];
      return m;
    };
    expect(validateTerrain(bare())).toEqual([]);

    // A spawn: the corners and edges of its 5x5 (the 3x3 is the plain-floor rule, the outer ring the hazard rule)
    for (const [dx, dy] of [[-2, -2], [2, -2], [-2, 2], [2, 2], [2, 0], [-2, 1], [2, 1]]) {
      const m = regioned();
      put(m, 9 + dx, 3 + dy, TILE_FLOOR, TERRAIN_EMBER);
      expect(only(m), `ember at ${dx},${dy}`).toEqual(["T8"]);
      expect(first(m), `ember at ${dx},${dy}`).toContain("spawn 5x5");
    }
    const pool = regioned();
    pool.spawnPool = [{ x: tc(12), y: tc(4), zone: "fire" }];
    put(pool, 14, 2, TILE_FLOOR, TERRAIN_EMBER); // the corner of a pool spawn's 5x5, far from the main spawn's
    expect(only(pool)).toEqual(["T8"]);
    expect(first(pool)).toContain("spawn 5x5");
    const regionSpawn = regioned();
    regionSpawn.spawns = [];
    put(regionSpawn, 11, 5, TILE_FLOOR, TERRAIN_EMBER); // the region's own spawn list counts
    expect(only(regionSpawn)).toEqual(["T8"]);
    const outside = regioned();
    put(outside, 12, 5, TILE_FLOOR, TERRAIN_EMBER); // x = 12 is past the 5x5 (7..11)
    expect(only(outside)).toEqual([]);
    const lowInRing = regioned();
    put(lowInRing, 11, 5, TILE_LOW, TERRAIN_LAVA); // a LOW kind may stand in the ring
    expect(only(lowInRing)).toEqual([]);

    // A crate (or chest) 3x3: beside it and on its diagonals; two tiles off is fine; a LOW kind is allowed
    for (const [x, y] of [[7, 5], [9, 5], [7, 4], [8, 4], [9, 4]]) {
      const m = bare();
      put(m, x, y, TILE_FLOOR, TERRAIN_EMBER);
      expect(only(m), `beside the crate: ${x},${y}`).toEqual(["T8"]);
      expect(first(m), `beside the crate: ${x},${y}`).toContain("chest or crate 3x3");
    }
    const crateTwo = bare();
    put(crateTwo, 10, 5, TILE_FLOOR, TERRAIN_EMBER); // two tiles from the crate at (8,5)
    expect(only(crateTwo)).toEqual([]);
    const crateLow = bare();
    put(crateLow, 9, 4, TILE_LOW, TERRAIN_LAVA);
    expect(only(crateLow)).toEqual([]);
    const campChest = bare();
    put(campChest, 14, 1, TILE_FLOOR, TERRAIN_EMBER); // the camp chest is at (13,2): its 3x3 reaches (14,1)
    expect(only(campChest)).toEqual(["T8"]);
    expect(first(campChest)).toContain("chest or crate 3x3");

    // A ground-loot spot at (8,2): on it and in its 3x3, whichever floor kind; two tiles off or a LOW kind is fine
    const spotted = (): GameMap => { const m = bare(); m.groundSpots = [{ x: tc(8), y: tc(2) }]; return m; };
    expect(validateTerrain(spotted())).toEqual([]);
    for (const kind of [TERRAIN_EMBER, TERRAIN_BOG, TERRAIN_ICE, TERRAIN_LIGHT]) {
      for (const [x, y] of [[8, 2], [9, 3], [7, 1]]) {
        const m = spotted();
        put(m, x, y, TILE_FLOOR, kind);
        expect(ruleIds(validateTerrain(m)), `${TERRAINS[kind].key} at ${x},${y}`).toContain("T8");
        expect(first(m), `${TERRAINS[kind].key} at ${x},${y}`).toContain("ground-loot spot 3x3");
      }
    }
    const groundEmber = spotted();
    put(groundEmber, 8, 2, TILE_FLOOR, TERRAIN_EMBER);
    expect(only(groundEmber)).toEqual(["T8"]); // fire's own kind in fire's room: nothing else objects
    const groundTwo = spotted();
    put(groundTwo, 10, 2, TILE_FLOOR, TERRAIN_EMBER); // two tiles from the spot
    expect(only(groundTwo)).toEqual([]);
    const groundLow = spotted();
    put(groundLow, 9, 2, TILE_LOW, TERRAIN_LAVA);
    expect(only(groundLow)).toEqual([]);
    const noGround = bare();
    put(noGround, 8, 2, TILE_FLOOR, TERRAIN_EMBER); // without the spot nothing protects (8,2)
    expect(only(noGround)).toEqual([]);

    // A camp clearing is the plus of tiles within r = 40 of (13,3): (13,3) (12,3) (14,3) (13,2) (13,4). One tile outside it is a
    // violation, two tiles outside is fine; a LOW kind in the halo is allowed, and a hazard IN the clearing breaks plain floor.
    const halo = bare();
    put(halo, 11, 3, TILE_FLOOR, TERRAIN_EMBER);
    expect(only(halo)).toEqual(["T8"]);
    expect(first(halo)).toContain("camp clearing (+1 tile)");
    const haloDiagonal = bare();
    put(haloDiagonal, 14, 5, TILE_FLOOR, TERRAIN_EMBER); // the clearing's (13,4) has (14,5) on its diagonal
    expect(only(haloDiagonal)).toEqual(["T8"]);
    expect(first(haloDiagonal)).toContain("camp clearing (+1 tile)");
    const twoOut = bare();
    put(twoOut, 10, 3, TILE_FLOOR, TERRAIN_EMBER);
    expect(only(twoOut)).toEqual([]);
    const haloLow = bare();
    put(haloLow, 11, 3, TILE_LOW, TERRAIN_LAVA);
    expect(only(haloLow)).toEqual([]);
    const inside = bare();
    put(inside, 12, 3, TILE_FLOOR, TERRAIN_EMBER);
    expect(validateTerrain(inside)).toContain("T8 camp clearing tile (12, 3) is not plain floor");
    const mobCamp = bare();
    mobCamp.regions[0].mobCamps = [{ id: "fire-mob", region: "fire", x: tc(9), y: tc(4), r: 40, spots: [{ x: tc(9), y: tc(4) }], elite: false, weapon: "sword" }];
    put(mobCamp, 11, 4, TILE_FLOOR, TERRAIN_EMBER); // a region mob camp's halo counts as well (its clearing's (10,4) is a tile away)
    expect(only(mobCamp)).toEqual(["T8"]);
    expect(first(mobCamp)).toContain("camp clearing (+1 tile)");
  });

  it("T9: a prop must be in bounds, of a known kind, and stand on its kind's tile class", () => {
    const m = regioned();
    expect(validateTerrain(m)).toEqual([]);
    const kinds = [{ key: "rock", on: TILE_WALL, home: null }, { key: "reed", on: TILE_FLOOR, home: null }] as const;

    const ok = regioned();
    ok.props.push({ kind: 1, x: tc(8), y: tc(1), v: 0 }, { kind: 0, x: tc(6), y: tc(4), v: 3 });
    expect(validateTerrain(ok, { propKinds: kinds })).toEqual([]);

    const unknown = regioned();
    unknown.props.push({ kind: PROP_KINDS.length, x: tc(8), y: tc(1), v: 0 }); // one past the default table
    expect(ruleIds(validateTerrain(unknown))).toEqual(["T9"]);
    const known = regioned();
    known.props.push({ kind: ZONE_PROP.ember_vent, x: tc(10), y: tc(5), v: 0 }); // the default table is the real one: a fire vent on floor is fine
    expect(validateTerrain(known, { styled: true })).toEqual([]);
    const wrongTile = regioned();
    wrongTile.props.push({ kind: ZONE_PROP.glow_crack, x: tc(10), y: tc(5), v: 0 }); // a wall decor on floor
    expect(ruleIds(validateTerrain(wrongTile))).toEqual(["T9"]);
    const unknown2 = regioned();
    unknown2.props.push({ kind: 2, x: tc(8), y: tc(1), v: 0 });
    expect(ruleIds(validateTerrain(unknown2, { propKinds: kinds }))).toEqual(["T9"]);

    for (const [x, y] of [[-5, 40], [40, -5], [16 * TILE, 40], [40, 7 * TILE], [NaN, 40]]) {
      const oob = regioned();
      oob.props.push({ kind: 1, x, y, v: 0 });
      expect(ruleIds(validateTerrain(oob, { propKinds: kinds })), `${x},${y}`).toEqual(["T9"]);
    }

    const wrongClass = regioned();
    wrongClass.props.push({ kind: 0, x: tc(8), y: tc(1), v: 0 }); // a rock on floor
    expect(ruleIds(validateTerrain(wrongClass, { propKinds: kinds }))).toEqual(["T9"]);
    const lowSeat = regioned();
    put(lowSeat, 7, 4, TILE_LOW, TERRAIN_LAVA);
    lowSeat.props.push({ kind: 1, x: tc(7), y: tc(4), v: 0 }); // a reed on LOW
    expect(ruleIds(validateTerrain(lowSeat, { propKinds: kinds }))).toEqual(["T9"]);
  });

  it("T10: with the stylers on, a LOW tile needs a kind; off, a kindless LOW is a legal barrier", () => {
    const m = regioned();
    put(m, 7, 4, TILE_LOW, TERRAIN_NONE);
    expect(validateTerrain(m)).toEqual([]);
    expect(validateTerrain(m, { styled: false })).toEqual([]);
    const errs = validateTerrain(m, { styled: true });
    expect(ruleIds(errs)).toEqual(["T10"]);
    expect(errs[0]).toContain("(7, 4)");
    put(m, 7, 4, TILE_LOW, TERRAIN_LAVA);
    expect(validateTerrain(m, { styled: true })).toEqual([]);
  });

  it("T6..T10 are skipped for a map without regions", () => {
    const m = plain();
    put(m, 5, 5, TILE_LOW, TERRAIN_NONE); // a kindless LOW tile in region none: T6 and T10 would object on a generated map
    m.props.push({ kind: 7, x: 40, y: 40, v: 0 }); // unknown kind: T9 would object
    expect(validateTerrain(m, { styled: true })).toEqual([]);
  });

  it("every string starts with its rule id", () => {
    const m = regioned();
    put(m, 9, 3, TILE_FLOOR, TERRAIN_EMBER);
    put(m, 7, 4, TILE_LOW, TERRAIN_FENCE);
    for (const e of validateTerrain(m, { styled: true })) expect(e).toMatch(/^T\d+ /);
  });
});

describe("validateTerrain, T11 (ice keeps one tile of clear floor around it)", () => {
  const iceAt = (m: GameMap, x: number, y: number): void => put(m, x, y, TILE_FLOOR, TERRAIN_ICE);

  it("accepts ice with floor all round, and a wall two tiles away", () => {
    const m = plain();
    for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) iceAt(m, x, y);
    put(m, 7, 4, TILE_WALL); // the ice's east edge is x 5: column 6 is clear floor, 7 is not its neighbour
    expect(validateTerrain(m)).toEqual([]);
    // One tile in from the border ring's inner row: the ring is two tiles away.
    const edge = plain();
    iceAt(edge, 2, 2);
    expect(validateTerrain(edge)).toEqual([]);
  });

  it("flags a wall or a LOW tile in any of the eight neighbours, and names the first ice tile", () => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      for (const tile of [TILE_WALL, TILE_LOW]) {
        const m = plain();
        iceAt(m, 6, 6);
        put(m, 6 + dx, 6 + dy, tile, tile === TILE_LOW ? TERRAIN_LAVA : TERRAIN_NONE);
        const errs = validateTerrain(m);
        expect(ruleIds(errs), `${dx},${dy} tile ${tile}`).toEqual(["T11"]);
        expect(errs[0], `${dx},${dy}`).toContain("(6, 6)");
      }
    }
  });

  it("flags ice on the ring's inner edge and ice off the map", () => {
    const inner = plain();
    iceAt(inner, 1, 5); // west neighbour (0,5) is the border wall
    expect(ruleIds(validateTerrain(inner))).toEqual(["T11"]);
    // A board with no wall at all: ice on its edge has only floor and the cells off the map beside it. The off-map cells count.
    const open = mapFromTiles(7, 7, new Uint8Array(49));
    open.terrain[3 * 7 + 3] = TERRAIN_ICE;
    expect(ruleIds(validateTerrain(open))).toEqual(["T4"]); // its middle is clear (the ring is not wall: T4's business)
    open.terrain[3 * 7 + 3] = TERRAIN_NONE;
    open.terrain[3 * 7 + 0] = TERRAIN_ICE;
    const errs = validateTerrain(open);
    expect(ruleIds(errs)).toEqual(["T4", "T11"]);
    expect(errs.find((e) => e.startsWith("T11"))).toContain("(0, 3)");
  });

  it("counts the violations in one string, and leaves the ice tile's own class to T3", () => {
    const m = plain();
    iceAt(m, 3, 3);
    iceAt(m, 6, 6);
    put(m, 4, 3, TILE_WALL);
    put(m, 7, 6, TILE_WALL);
    const errs = validateTerrain(m);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/^T11 2 ICE tile/);
    // Ice on a wall is T3's, not T11's.
    const onWall = plain();
    put(onWall, 6, 6, TILE_WALL, TERRAIN_ICE);
    expect(ruleIds(validateTerrain(onWall))).toEqual(["T3"]);
  });

  it("holds for any map, not only a styled one or a generated one", () => {
    const m = regioned();
    put(m, 7, 4, TILE_FLOOR, TERRAIN_ICE); // beside the wall column at x=6
    expect(ruleIds(validateTerrain(m))).toContain("T11");
    expect(ruleIds(validateTerrain(m, { styled: true }))).toContain("T11");
    const noRegions = plain();
    iceAt(noRegions, 1, 1);
    expect(ruleIds(validateTerrain(noRegions))).toEqual(["T11"]);
    // Ice costs nothing when the map holds none.
    expect(validateTerrain(plain())).toEqual([]);
  });

  it("is passed by every generated map, seeds 1..40, which hold ice at all (the generator keeps rocks off the ice, or clears it beside one)", () => {
    let ice = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const map = generateMap(seed);
      for (const k of map.terrain) if (k === TERRAIN_ICE) ice++;
      expect(validateTerrain(map, { styled: true }), `seed ${seed}`).toEqual([]);
    }
    expect(ice, "the seeds hold ice at all: not a vacuous pass").toBeGreaterThan(100);
  }, 60_000);
});

describe("validateTerrain on generated maps", () => {
  it("accepts the generator's maps with the stylers off, which have no terrain (seeds 1..12)", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const m = generateMap(seed, undefined, { styleZones: null });
      expect(m.terrain.every((k) => k === TERRAIN_NONE), `seed ${seed}`).toBe(true);
      expect(validateTerrain(m), `seed ${seed}`).toEqual([]);
    }
  });
});

describe("surface effects (part B)", () => {
  const OTHERS = FACTION_IDS.filter((f) => f !== "fire");

  it("pins the numbers: ember burns 2% of max hp per second for everyone but fire", () => {
    for (const f of OTHERS) expect(surfaceEffect(TERRAIN_EMBER, f).burnShare).toBe(0.02);
    expect(surfaceEffect(TERRAIN_EMBER, "fire").burnShare).toBe(0);
    expect(surfaceEffect(TERRAIN_EMBER, "").burnShare).toBe(0.02);
  });

  it("bog slows to 0.7 for everyone but plague", () => {
    for (const f of FACTION_IDS) expect(surfaceEffect(TERRAIN_BOG, f).speedMult).toBe(f === "plague" ? 1 : 0.7);
    expect(surfaceEffect(TERRAIN_BOG, "").speedMult).toBe(0.7);
  });

  it("ice has the traction of 400 ms to PLAYER_SPEED for everyone but frost, which keeps full grip", () => {
    for (const f of FACTION_IDS) expect(surfaceEffect(TERRAIN_ICE, f).accel).toBe(f === "frost" ? 0 : (PLAYER_SPEED * 1000) / 400);
    expect(surfaceEffect(TERRAIN_ICE, "").accel).toBe(425);
    expect(slipAccel(400)).toBe(425);
    expect(slipAccel(0)).toBe(0);
  });

  it("light heals 0.6% of max hp per second, and holy twice that", () => {
    for (const f of FACTION_IDS) expect(surfaceEffect(TERRAIN_LIGHT, f).healShare).toBeCloseTo(f === "holy" ? 0.012 : 0.006, 12);
    expect(surfaceEffect(TERRAIN_LIGHT, "").healShare).toBe(0.006);
  });

  it("an empty or unknown faction gets the base effect, and every other kind is neutral for everyone", () => {
    expect(surfaceEffect(TERRAIN_BOG, "nobody").speedMult).toBe(0.7);
    for (const kind of [TERRAIN_NONE, TERRAIN_LAVA, TERRAIN_FENCE, TERRAIN_CREVASSE]) {
      for (const f of ["", ...FACTION_IDS]) {
        const e = surfaceEffect(kind, f);
        expect([e.kind, e.speedMult, e.accel, e.burnShare, e.healShare]).toEqual([kind, 1, 0, 0, 0]);
      }
    }
    // A kind byte the catalog lacks is plain ground.
    expect(surfaceEffect(200, "frost")).toBe(surfaceEffect(TERRAIN_NONE, ""));
  });

  it("exempt gives the neutral effect, boost multiplies the kind's own magnitude, and the lookup allocates nothing", () => {
    const home = surfaceEffect(TERRAIN_EMBER, "fire");
    expect(home).toEqual({ kind: TERRAIN_EMBER, speedMult: 1, accel: 0, burnShare: 0, healShare: 0 });
    expect(surfaceEffect(TERRAIN_LIGHT, "holy").healShare).toBeCloseTo(TERRAINS[TERRAIN_LIGHT].healShare * TERRAINS[TERRAIN_LIGHT].homeMult, 12);
    expect(surfaceEffect(TERRAIN_LIGHT, "holy").kind).toBe(TERRAIN_LIGHT);
    expect(surfaceEffect(TERRAIN_EMBER, "frost")).toBe(surfaceEffect(TERRAIN_EMBER, "sentenced"));
    expect(surfaceEffect(TERRAIN_BOG, "fire")).toBe(surfaceEffect(TERRAIN_BOG, "fire"));
  });

  it("surfaceAt reads the tile under the centre: x = 64.0 is tile 2, 0.01 u inside is bog and 0.01 u outside is not", () => {
    const tiles = new Uint8Array(8 * 4).fill(TILE_FLOOR);
    const terrain = new Uint8Array(8 * 4);
    terrain[1 * 8 + 2] = TERRAIN_BOG; // tile (2, 1): x in [64, 96), y in [32, 64)
    const map = mapFromTiles(8, 4, tiles, 0, terrain);
    expect(surfaceAt(map, 64, 40, "frost").speedMult).toBe(0.7);
    expect(surfaceAt(map, 64 + 0.01, 40, "frost").speedMult).toBe(0.7);
    expect(surfaceAt(map, 64 - 0.01, 40, "frost").speedMult).toBe(1);
    expect(surfaceAt(map, 96 - 0.01, 40, "frost").speedMult).toBe(0.7);
    expect(surfaceAt(map, 96, 40, "frost").speedMult).toBe(1);
    expect(surfaceAt(map, 80, 32 - 0.01, "frost").speedMult).toBe(1);
    expect(surfaceAt(map, 80, 40, "plague").speedMult).toBe(1);
    // Out of bounds is plain ground.
    expect(surfaceAt(map, -5, 40, "frost").kind).toBe(TERRAIN_NONE);
    expect(surfaceAt(map, 9000, 40, "frost").kind).toBe(TERRAIN_NONE);
  });

  it("hazardsOf is all false on a zero terrain, and is cached per terrain array", () => {
    const map = mapFromTiles(6, 6, new Uint8Array(36));
    const h = hazardsOf(map);
    expect(h).toEqual({ burn: false, slow: false, slip: false, heal: false });
    expect(hazardsOf(map)).toBe(h);
    // A copy that shares the terrain array (what withGates makes) shares the answer.
    expect(hazardsOf({ ...map, tiles: map.tiles.slice() })).toBe(h);
  });

  it("hazardsOf lists the effects the map holds, one kind at a time", () => {
    const cases: Array<[number, { burn: boolean; slow: boolean; slip: boolean; heal: boolean }]> = [
      [TERRAIN_EMBER, { burn: true, slow: false, slip: false, heal: false }],
      [TERRAIN_BOG, { burn: false, slow: true, slip: false, heal: false }],
      [TERRAIN_ICE, { burn: false, slow: false, slip: true, heal: false }],
      [TERRAIN_LIGHT, { burn: false, slow: false, slip: false, heal: true }],
      [TERRAIN_LAVA, { burn: false, slow: false, slip: false, heal: false }],
      [TERRAIN_FENCE, { burn: false, slow: false, slip: false, heal: false }],
    ];
    for (const [kind, want] of cases) {
      const terrain = new Uint8Array(36);
      terrain[14] = kind;
      expect(hazardsOf(mapFromTiles(6, 6, new Uint8Array(36), 0, terrain)), TERRAINS[kind].key).toEqual(want);
    }
    const mixed = new Uint8Array(36);
    mixed[7] = TERRAIN_EMBER;
    mixed[20] = TERRAIN_ICE;
    expect(hazardsOf(mapFromTiles(6, 6, new Uint8Array(36), 0, mixed))).toEqual({ burn: true, slow: false, slip: true, heal: false });
  });

  it("forgetHazards drops the cached answer for a terrain that was edited", () => {
    const map = mapFromTiles(6, 6, new Uint8Array(36));
    expect(hazardsOf(map).burn).toBe(false);
    map.terrain[9] = TERRAIN_EMBER;
    expect(hazardsOf(map).burn).toBe(false); // stale until told
    forgetHazards(map);
    expect(hazardsOf(map).burn).toBe(true);
  });

  it("the move-speed floor is 0.35", () => {
    expect(MOVE_MULT_FLOOR).toBe(0.35);
    // Today's worst stack, chill x bog, is above it.
    expect(0.7 * 0.7).toBeGreaterThan(MOVE_MULT_FLOOR);
  });
});

// The certifier's own tests (zone-shapes contract 6.2-6.3): every measure on hand-made grids with known answers, every feature and
// piece check against a deliberately bad map, and every hard check of certifyMap against a generated map broken on purpose.
// Hand-made grids use this legend (rows of equal length):
//   #  WALL of zone 1        .  FLOOR of zone 1       ~  LOW (fence) of zone 1     B  WALL outside every zone (the border)
//   o  FLOOR of zone 2       C  FLOOR of the coliseum  X  WALL of the coliseum
import { describe, expect, it } from "vitest";
import { TILE } from "../src/constants";
import { FEATURE_JOBS, FEATURE_KINDS, REGION_COLISEUM, REGION_FACTIONS, TILE_FLOOR, TILE_LOW, TILE_WALL, mapFromTiles, tileToWorldCenter } from "../src/map";
import type { CampDef, GameMap, MapFeature, RegionFaction } from "../src/map";
import { SHAPE_GATES, generateMap, mapHash } from "../src/mapgen";
import { findPath } from "../src/pathfind";
import { TERRAIN_BOG, TERRAIN_EMBER, TERRAIN_FENCE, TERRAIN_ICE, TERRAIN_LAVA } from "../src/terrain";
import {
  BOW_TILES, CERT_FEATURE_JOBS, CERT_FEATURE_KINDS, FEATURE_CHECKS, LANDMARK_ZONE, PAIR_DRAWS, PAIR_TARGET, RAY_DIRECTIONS, ZONE_MEASURE_VALUES,
  ZONE_WINDOWS, campGraph, campGraphNodes, certifyMap, cyclomaticNumber, decorProblems, engagementPairs, featureProblems, gabriel, judgeWindow, lcgNext,
  pieceProblems, pieceStats, pieces, rayLengthsAt, rayProfile, strictZoneCodes, walkSegment, zoneMeasures,
} from "./mapCertify";

// ---- Hand-made grids ---------------------------------------------------------------------------------------------------------

function gridMap(rows: string[]): GameMap {
  const h = rows.length, w = rows[0].length;
  const tiles = new Uint8Array(w * h), terrain = new Uint8Array(w * h), region = new Uint8Array(w * h);
  rows.forEach((row, y) => {
    expect(row.length, `row ${y}`).toBe(w);
    [...row].forEach((ch, x) => {
      const i = y * w + x;
      if (ch === "#") { tiles[i] = TILE_WALL; region[i] = 1; }
      else if (ch === ".") region[i] = 1;
      else if (ch === "~") { tiles[i] = TILE_LOW; terrain[i] = TERRAIN_FENCE; region[i] = 1; }
      else if (ch === "B") tiles[i] = TILE_WALL;
      else if (ch === "o") region[i] = 2;
      else if (ch === "C") region[i] = REGION_COLISEUM;
      else if (ch === "X") { tiles[i] = TILE_WALL; region[i] = REGION_COLISEUM; }
      else throw new Error(`gridMap: unknown tile ${ch}`);
    });
  });
  const m = mapFromTiles(w, h, tiles, 0, terrain);
  m.regionGrid = region;
  return m;
}

/** A w x h grid with a border of B; `paint(x, y)` gives the character of an inner tile (default floor of zone 1). */
function field(w: number, h: number, paint: (x: number, y: number) => string = () => "."): string[] {
  return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (x === 0 || y === 0 || x === w - 1 || y === h - 1 ? "B" : paint(x, y))).join(""));
}

const camp = (zone: RegionFaction, tx: number, ty: number, elite = false): CampDef => ({
  id: `${zone}-x`, zone, x: tileToWorldCenter(tx), y: tileToWorldCenter(ty), r: 2.5 * TILE, spots: [], eliteSpot: elite ? 0 : -1,
  chest: { x: tileToWorldCenter(tx), y: tileToWorldCenter(ty) }, area: 0, radius: 0,
});

/** max(|cos|, |sin|) of the k-th ray direction: a ray from the middle of a square room reaches its wall at half / that. */
const dirMax = (k: number): number => Math.max(Math.abs(Math.cos((k * 2 * Math.PI) / RAY_DIRECTIONS)), Math.abs(Math.sin((k * 2 * Math.PI) / RAY_DIRECTIONS)));
const meanOver = (f: (k: number) => number): number => Array.from({ length: RAY_DIRECTIONS }, (_, k) => f(k)).reduce((a, v) => a + v, 0) / RAY_DIRECTIONS;

describe("the tables the certifier re-declares", () => {
  it("equal map.ts's: the same feature kinds and jobs in the same order, and every landmark design belongs to one zone", () => {
    expect([...CERT_FEATURE_KINDS]).toEqual([...FEATURE_KINDS]);
    expect([...CERT_FEATURE_JOBS]).toEqual([...FEATURE_JOBS]);
    expect(Object.keys(LANDMARK_ZONE).sort()).toEqual(["burrow", "forge", "guardHouse", "shrine", "watchtower"]);
    expect(Object.values(LANDMARK_ZONE).sort()).toEqual([...REGION_FACTIONS].sort());
  });

  it("holds section 4's windows: every windowed measure exists, and the numbers are the contract's", () => {
    for (const f of REGION_FACTIONS) for (const name of Object.keys(ZONE_WINDOWS[f])) expect(ZONE_MEASURE_VALUES[name], `${f}: ${name}`).toBeTypeOf("function");
    expect(ZONE_WINDOWS.fire["rays>=7.5t %"]).toEqual({ lo: 48, hi: 64 });
    expect(ZONE_WINDOWS.fire["pairs wall %"].lo).toBe(18);
    expect(ZONE_WINDOWS.sentenced["rays>=7.5t %"]).toEqual({ lo: 72, hi: 88 });
    expect(ZONE_WINDOWS.sentenced["pairs wall %"].hi).toBe(8);
    expect(ZONE_WINDOWS.plague["rays>=7.5t %"]).toEqual({ lo: 60, hi: 74 });
    expect(ZONE_WINDOWS.plague.loops.lo).toBe(6);
    expect(ZONE_WINDOWS.frost["rays>=7.5t %"]).toEqual({ lo: 62, hi: 78 });
    expect(ZONE_WINDOWS.holy["rays>=7.5t %"]).toEqual({ lo: 60, hi: 74 });
    expect(ZONE_WINDOWS.holy.piers).toEqual({ lo: 18, hi: 30 });
  });

  it("judges a window by the mean, or by the share of seeds inside when it names one", () => {
    expect(judgeWindow([1, 2, 3], { lo: 1.5, hi: 2.5 })).toMatchObject({ ok: true, mean: 2 });
    expect(judgeWindow([1, 2, 9], { lo: 1.5, hi: 2.5 }).ok).toBe(false);
    expect(judgeWindow([2, 2, 2, 2, 9], { lo: 1.5, hi: 2.5, share: 0.8 })).toMatchObject({ ok: true, inside: 0.8 });
    expect(judgeWindow([2, 2, 2, 9, 9], { lo: 1.5, hi: 2.5, share: 0.8 }).ok).toBe(false);
    expect(judgeWindow([], { lo: 1, hi: 2 }).ok).toBe(true);
  });
});

// ---- Ray profile --------------------------------------------------------------------------------------------------------------

describe("ray profile", () => {
  it("measures a sample in the middle of an open 21x21 room: every ray reaches the wall at 9.5 / max(|cos|, |sin|) tiles", () => {
    const m = gridMap(field(21, 21, (x, y) => (x === 10 && y === 10 ? "." : "o")));
    const lens = rayLengthsAt(m, 10, 10);
    expect(lens).toHaveLength(RAY_DIRECTIONS);
    lens.forEach((r, k) => expect(r, `ray ${k}`).toBeCloseTo(9.5 / dirMax(k), 6));
    const p = rayProfile(m, 1);
    expect(p.samples).toBe(1);
    expect(p.rays).toBe(RAY_DIRECTIONS);
    expect(p.mean).toBeCloseTo(meanOver((k) => 9.5 / dirMax(k)), 9);
    expect(p.share75).toBe(1);
    expect(p.share15).toBe(0);
    expect(p.openBow).toBe(1);
  });

  it("measures a 3x3 closed room: no ray reaches the bow's range, and the open-bow mean is the mean of r / 7.5", () => {
    // Room at tiles 3..5 x 3..5, centre (4, 4): walls 1.5 tiles away on every side.
    const m = gridMap(field(11, 11, (x, y) => (x >= 3 && x <= 5 && y >= 3 && y <= 5 ? "." : "#")));
    const p = rayProfile(m, 1);
    expect(p.samples).toBe(1);
    expect(p.share75).toBe(0);
    expect(p.share15).toBe(0);
    expect(p.mean).toBeCloseTo(meanOver((k) => 1.5 / dirMax(k)), 9);
    expect(p.openBow).toBeCloseTo(meanOver((k) => Math.min(1.5 / dirMax(k), BOW_TILES) / BOW_TILES), 9);
  });

  it("sees along a 1-wide corridor only: the two rays along it are long, the other 22 stop within two tiles", () => {
    const m = gridMap(field(9, 61, (x) => (x === 4 ? "." : "#")));
    const lens = rayLengthsAt(m, 4, 30);
    const long = lens.map((r, k) => ({ r, k })).filter((e) => e.r >= 15);
    expect(long.map((e) => e.k).sort((a, b) => a - b)).toEqual([6, 18]);
    expect(lens.filter((r) => r < 2.1)).toHaveLength(RAY_DIRECTIONS - 2);
    expect(lens[6]).toBeCloseTo(29.5, 6);
  });

  it("caps a ray at 40 tiles, and lets a ray through LOW ground but not through a wall", () => {
    const open = gridMap(field(101, 101));
    expect(rayLengthsAt(open, 50, 50)[0]).toBe(40);
    const fence = gridMap(field(31, 31, (x) => (x === 20 ? "~" : ".")));
    const wall = gridMap(field(31, 31, (x) => (x === 20 ? "#" : ".")));
    expect(rayLengthsAt(fence, 10, 10)[0]).toBeGreaterThan(18);
    expect(rayLengthsAt(wall, 10, 10)[0]).toBeCloseTo(9.5, 6);
  });

  it("samples only the zone's FLOOR tiles with even x and even y", () => {
    const m = gridMap(field(21, 21, (x, y) => (x >= 5 && x <= 8 && y >= 5 && y <= 8 ? (x === 6 && y === 6 ? "#" : ".") : "o")));
    // Tiles 5..8 x 5..8: even/even are (6, 6) [a wall: not a sample], (6, 8), (8, 6), (8, 8).
    expect(rayProfile(m, 1).samples).toBe(3);
    expect(rayProfile(m, 2).samples).toBeGreaterThan(50);
    expect(rayProfile(m, 3).samples).toBe(0);
    expect(rayProfile(m, 3).mean).toBe(0);
  });
});

// ---- Segments and engagement pairs --------------------------------------------------------------------------------------------

describe("walkSegment (the supercover between tile centres)", () => {
  const cells = (ax: number, ay: number, bx: number, by: number, w = 20): string[] => {
    const out: string[] = [];
    walkSegment(w, ax, ay, bx, by, (i) => { out.push(`${i % w},${Math.floor(i / w)}`); });
    return out;
  };
  it("visits a straight line tile by tile, both ends included, in either direction", () => {
    expect(cells(0, 0, 3, 0)).toEqual(["0,0", "1,0", "2,0", "3,0"]);
    expect(cells(3, 2, 3, 0)).toEqual(["3,2", "3,1", "3,0"]);
    expect(cells(2, 2, 2, 2)).toEqual(["2,2"]);
  });
  it("visits both neighbours of a corner a diagonal passes through, then the tile beyond", () => {
    expect(cells(0, 0, 2, 2)).toEqual(["0,0", "1,0", "0,1", "1,1", "2,1", "1,2", "2,2"]);
  });
  it("follows a knight's line through the tiles it really crosses", () => {
    expect(cells(0, 0, 2, 1)).toEqual(["0,0", "1,0", "1,1", "2,1"]);
    expect(cells(2, 1, 0, 0)).toEqual(["2,1", "1,1", "1,0", "0,0"]);
  });
  it("stops at the first tile the visitor accepts and says so", () => {
    let seen = 0;
    expect(walkSegment(20, 0, 0, 10, 0, (i) => { seen++; return i === 4; })).toBe(true);
    expect(seen).toBe(5);
    expect(walkSegment(20, 0, 0, 10, 0, () => false)).toBe(false);
  });
});

describe("engagement pairs", () => {
  it("is the exact LCG: seed 12345 steps to (12345 * 1103515245 + 12345) mod 2^31", () => {
    const step = (s: number): number => Number((BigInt(s) * 1103515245n + 12345n) % 2147483648n);
    let s = 12345, t = 12345;
    for (let k = 0; k < 20; k++) { s = lcgNext(s); t = step(t); expect(s).toBe(t); }
    expect(lcgNext(12345)).not.toBe(lcgNext(12345 + 7));
  });

  it("finds nothing to cut in an open field: 2500 pairs, all clear", () => {
    const p = engagementPairs(gridMap(field(61, 61)), 1, 0);
    expect(p.pairs).toBe(PAIR_TARGET);
    expect(p.draws).toBeLessThanOrEqual(PAIR_DRAWS);
    expect([p.wallBlocked, p.lowSeparated, p.clear]).toEqual([0, 0, 1]);
  });

  it("calls a wall across the room wall-blocked and a fence across it LOW-separated, and the three shares sum to 1", () => {
    const wall = engagementPairs(gridMap(field(61, 61, (_, y) => (y === 30 ? "#" : "."))), 1, 0);
    const fence = engagementPairs(gridMap(field(61, 61, (_, y) => (y === 30 ? "~" : "."))), 1, 0);
    expect(wall.pairs).toBe(PAIR_TARGET);
    expect(wall.wallBlocked).toBeGreaterThan(0.02);
    expect(wall.wallBlocked).toBeLessThan(0.4);
    expect(wall.lowSeparated).toBe(0);
    expect(wall.wallBlocked + wall.lowSeparated + wall.clear).toBeCloseTo(1, 12);
    expect(fence.lowSeparated).toBeGreaterThan(0.02);
    expect(fence.wallBlocked).toBe(0);
    // The same room, wall or fence: the same pairs (the sampling never looks at the row), so the same share cut.
    expect(fence.lowSeparated).toBe(wall.wallBlocked);
  });

  it("puts a wall before a fence: every pair across a wall row next to a fence row is wall-blocked, none is merely LOW-separated", () => {
    const both = engagementPairs(gridMap(field(61, 61, (_, y) => (y === 30 ? "#" : y === 31 ? "~" : "."))), 1, 0);
    expect(both.wallBlocked).toBeGreaterThan(0.02);
    expect(both.lowSeparated).toBe(0);
    expect(both.wallBlocked + both.lowSeparated + both.clear).toBeCloseTo(1, 12);
  });

  it("counts a ring of walls as separating inside from outside, and is repeatable", () => {
    // A 20x20 room inside a 61x61 field, its wall one tile thick: pairs from inside to outside are blocked.
    const ring = field(61, 61, (x, y) => ((x === 20 || x === 40 || y === 20 || y === 40) && x >= 20 && x <= 40 && y >= 20 && y <= 40 ? "#" : "."));
    const a = engagementPairs(gridMap(ring), 1, 3), b = engagementPairs(gridMap(ring), 1, 3);
    expect(a).toEqual(b);
    expect(a.wallBlocked).toBeGreaterThan(0.03);
    expect(engagementPairs(gridMap(ring), 1, 0)).not.toEqual(engagementPairs(gridMap(ring), 1, 4));
  });

  it("only draws floor of the zone: a zone with no floor, or no room for a pair, has none", () => {
    expect(engagementPairs(gridMap(field(21, 21, () => "o")), 1, 0)).toEqual({ draws: 0, pairs: 0, wallBlocked: 0, lowSeparated: 0, clear: 0 });
    const one = engagementPairs(gridMap(field(21, 21, (x, y) => (x === 10 && y === 10 ? "." : "o"))), 1, 0);
    expect(one.pairs).toBe(0);
    expect(one.draws).toBe(PAIR_DRAWS);
  });
});

// ---- Pieces -------------------------------------------------------------------------------------------------------------------

describe("pieces", () => {
  it("separates 4- and 8-connected components", () => {
    const rows = ["#.#", ".#.", "#.#"];
    const ok = (i: number): boolean => rows[Math.floor(i / 3)][i % 3] === "#";
    expect(pieces(3, 3, ok, true).sizes).toEqual([5]);
    expect(pieces(3, 3, ok, false).sizes).toEqual([1, 1, 1, 1, 1]);
  });

  it("counts the wall pieces of a zone on a hand-made grid: a single, a block of 4, a diagonal of 3, an L of 12, a bar of 7", () => {
    const m = gridMap(field(40, 40, (x, y) => {
      if (x === 3 && y === 3) return "#"; // single
      if (x >= 7 && x <= 8 && y >= 3 && y <= 4) return "#"; // 2x2
      if ((x === 12 && y === 3) || (x === 13 && y === 4) || (x === 14 && y === 5)) return "#"; // diagonal of 3 (one piece under 8-connection)
      if ((x === 20 && y >= 3 && y <= 9) || (y === 9 && x >= 20 && x <= 25)) return "#"; // an L: 7 + 5 = 12
      if (y === 20 && x >= 5 && x <= 11) return "#"; // a bar of 7
      return ".";
    }));
    const s = pieceStats(m, 1, TILE_WALL);
    expect(s.sizes).toEqual([1, 3, 4, 7, 12]);
    expect(s.count).toBe(5);
    expect(s.tiles).toBe(27);
    expect(s.singles).toBe(1);
    expect(s.under6).toBe(3);
    expect(s.largest).toBe(12);
    expect(s.bigShare).toBeCloseTo(12 / 27, 12);
    expect(pieceStats(m, 2, TILE_WALL).count).toBe(0);
    expect(pieceStats(m, 1, TILE_LOW).count).toBe(0);
  });

  it("counts LOW pieces apart, and walls of another zone not at all", () => {
    const m = gridMap(field(30, 30, (x, y) => (y === 10 && x >= 5 && x <= 8 ? "~" : y === 15 && x >= 5 && x <= 14 ? "~" : "o")));
    m.regionGrid.fill(1, 0, 0);
    for (let i = 0; i < m.regionGrid.length; i++) if (m.tiles[i] === TILE_LOW) m.regionGrid[i] = 1;
    const low = pieceStats(m, 1, TILE_LOW);
    expect(low.sizes).toEqual([4, 10]);
    expect(low.under6).toBe(1);
    expect(pieceStats(m, 1, TILE_WALL).count).toBe(0);
  });

  it("rejects a strict zone with a single tile or a piece under 6, and accepts one without", () => {
    const bad = gridMap(field(30, 30, (x, y) => (x === 5 && y === 5 ? "#" : x >= 10 && x <= 12 && y >= 10 && y <= 11 ? "#" : ".")));
    const good = gridMap(field(30, 30, (x, y) => (x >= 10 && x <= 12 && y >= 10 && y <= 11 ? "#" : ".")));
    expect(pieceProblems(bad, [1])).toHaveLength(1);
    expect(pieceProblems(bad, [1])[0]).toContain(FEATURE_CHECKS.pieces);
    expect(pieceProblems(bad, [1])[0]).toContain("fire has 1 (1 single tiles");
    expect(pieceProblems(bad, [2])).toEqual([]);
    expect(pieceProblems(good, [1])).toEqual([]);
    expect(pieceProblems(bad, [])).toEqual([]);
  });
});

// ---- The camp graph -----------------------------------------------------------------------------------------------------------

describe("camp graph", () => {
  it("has the Gabriel edges: a collinear triple loses its long edge, a square keeps all six (its diagonals touch the circle), a triangle all three", () => {
    expect(gabriel([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }])).toEqual([[0, 1], [1, 2]]);
    expect(gabriel([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }])).toHaveLength(6);
    expect(gabriel([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 9 }])).toHaveLength(3);
    // A node strictly inside the diametral circle of a pair removes that pair.
    expect(gabriel([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 2 }])).toEqual([[0, 2], [1, 2]]);
    expect(gabriel([])).toEqual([]);
  });

  it("counts loops as E - V + C", () => {
    expect(cyclomaticNumber(4, [[0, 1], [1, 2], [2, 3]])).toBe(0);
    expect(cyclomaticNumber(3, [[0, 1], [1, 2], [0, 2]])).toBe(1);
    expect(cyclomaticNumber(6, [[0, 1], [1, 2], [0, 2], [3, 4], [4, 5], [3, 5]])).toBe(2);
    expect(cyclomaticNumber(4, [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]])).toBe(3);
    expect(cyclomaticNumber(5, [])).toBe(0);
  });

  it("measures four camps at the corners of an open arena: K4, three loops, routes as straight as the lines", () => {
    const m = gridMap(field(61, 61));
    m.camps = [camp("fire", 10, 10), camp("fire", 50, 10), camp("fire", 10, 50), camp("fire", 50, 50)];
    const g = campGraph(m, "fire");
    expect(g.nodes.map((n) => n.kind)).toEqual(["camp", "camp", "camp", "camp"]);
    expect(g.edges).toHaveLength(6);
    expect(g.traversable.every(Boolean)).toBe(true);
    expect(g.campEdges).toBe(6);
    expect(g.loops).toBe(3);
    expect(g.stretchMean).toBeGreaterThanOrEqual(1);
    expect(g.stretchMax).toBeLessThan(1.02);
  });

  it("measures three camps in a line as a path: two edges, no loop", () => {
    const m = gridMap(field(61, 31));
    m.camps = [camp("plague", 10, 15), camp("plague", 30, 15), camp("plague", 50, 15)];
    const g = campGraph(m, "plague");
    expect(g.edges).toEqual([[0, 1], [1, 2]]);
    expect(g.loops).toBe(0);
    expect(g.stretchMax).toBeLessThan(1.02);
    // Camps of another zone are not nodes.
    m.camps.push(camp("fire", 30, 5));
    expect(campGraph(m, "plague").nodes).toHaveLength(3);
  });

  it("reads a wall in the way as stretch, and a wall with no gap as no route (an edge that is not traversable and not in the loops)", () => {
    // Two camps with a wall between them and a gap at the far end: the route goes round.
    const gap = gridMap(field(61, 61, (x, y) => (x === 30 && y > 2 ? "#" : ".")));
    gap.camps = [camp("fire", 10, 30), camp("fire", 50, 30)];
    const g = campGraph(gap, "fire");
    expect(g.edges).toEqual([[0, 1]]);
    expect(g.stretch[0]).toBeGreaterThan(1.5);
    expect(g.traversable[0]).toBe(false);
    expect(g.loops).toBe(0);
    expect(g.stretchMax).toBeGreaterThan(1.5);
    // No gap at all: no route, stretch 0, nothing to average.
    const sealed = gridMap(field(61, 61, (x) => (x === 30 ? "#" : ".")));
    sealed.camps = [camp("fire", 10, 30), camp("fire", 50, 30)];
    const s = campGraph(sealed, "fire");
    expect(s.stretch).toEqual([0]);
    expect(s.traversable).toEqual([false]);
    expect([s.stretchMean, s.stretchMax, s.loops]).toEqual([0, 0, 0]);
    // A small detour stays traversable: a bar the route goes round, within 1.5 x straight + 4 tiles.
    const bar = gridMap(field(61, 61, (x, y) => (x === 30 && y >= 26 && y <= 34 ? "#" : ".")));
    bar.camps = [camp("fire", 10, 30), camp("fire", 50, 30)];
    const b = campGraph(bar, "fire");
    expect(b.stretch[0]).toBeGreaterThan(1.01);
    expect(b.stretch[0]).toBeLessThan(1.5);
    expect(b.traversable[0]).toBe(true);
  });

  it("adds the front door: the zone's floor at ring distance 5 to 7 from the coliseum nearest the zone's centroid", () => {
    // A coliseum block of 6x6 at the left edge, the zone everywhere else; the door is the tile at ring distance 7 level with its middle.
    const m = gridMap(field(60, 40, (x, y) => (x >= 1 && x <= 6 && y >= 17 && y <= 22 ? "C" : ".")));
    m.camps = [camp("fire", 30, 8), camp("fire", 30, 32)];
    const nodes = campGraphNodes(m, "fire");
    expect(nodes.map((n) => n.kind)).toEqual(["camp", "camp", "door"]);
    expect(nodes[2].x).toBe(13);
    expect([19, 20]).toContain(nodes[2].y);
    // No coliseum on the map: no door.
    expect(campGraphNodes(gridMap(field(60, 40)), "fire")).toHaveLength(0);
    // The door joins the graph: its edges are in `edges` but not among the camp-camp edges.
    const g = campGraph(m, "fire");
    expect(g.nodes).toHaveLength(3);
    expect(g.edges.some(([a, b]) => a === 2 || b === 2)).toBe(true);
    expect(g.campEdges).toBeLessThan(g.edges.length);
  });
});

// ---- A generated map: the measures hold together --------------------------------------------------------------------------------

describe("zone measures on a generated map", () => {
  const plain = generateMap(1, undefined, { styleZones: null, landmarks: null });
  it("are shares and counts that add up, five zones, repeatable", () => {
    const zs = REGION_FACTIONS.map((_, z) => zoneMeasures(plain, z));
    expect(zs.map((z) => z.zone)).toEqual([...REGION_FACTIONS]);
    for (const z of zs) {
      expect(z.rays.samples).toBeGreaterThan(500);
      expect(z.rays.share15).toBeLessThanOrEqual(z.rays.share75);
      expect(z.rays.share75).toBeLessThanOrEqual(1);
      expect(z.pairs.wallBlocked + z.pairs.lowSeparated + z.pairs.clear).toBeCloseTo(1, 12);
      expect(z.graph.nodes).toHaveLength(9);
      expect(z.graph.nodes.filter((n) => n.kind === "camp")).toHaveLength(8);
      expect(z.graph.loops).toBeGreaterThanOrEqual(0);
      expect(z.eliteSep).toBeGreaterThanOrEqual(16);
      expect(z.walls + z.lows).toBe(0);
      expect(z.footprint).toBe(0);
      expect(z.painted).toBeGreaterThan(3000);
    }
    expect(zoneMeasures(plain, 2)).toEqual(zs[2]);
    // An unstyled map is open: most rays reach the bow's range.
    expect(Math.min(...zs.map((z) => z.rays.share75))).toBeGreaterThan(0.8);
  });

  it("fills stats.zones in zone mode, and nothing when measures are off", () => {
    expect(certifyMap(plain, { zone: false }).stats.zones).toEqual([]);
    expect(certifyMap(plain, { zone: true, measures: false }).stats.zones).toEqual([]);
    expect(certifyMap(plain, { measures: true }).stats.zones).toHaveLength(5);
  });
});

// ---- Features -----------------------------------------------------------------------------------------------------------------

/** A 40x40 map, zone 1 (fire) inside the border, a coliseum nowhere; helpers to add features by hand. */
function featureMap(): GameMap {
  const m = gridMap(field(40, 40));
  m.camps = [camp("fire", 30, 30)];
  return m;
}
function setTile(m: GameMap, x: number, y: number, tile: number, terrain = 0): number {
  const i = y * m.w + x;
  m.tiles[i] = tile;
  m.terrain[i] = terrain;
  return i;
}
/** Records a feature that owns `tiles`: featureGrid, bbox and tile count filled the way the generator does. */
function own(m: GameMap, kind: MapFeature["kind"], zone: RegionFaction, tiles: number[], extra: Partial<MapFeature> = {}): number {
  const xs = tiles.map((i) => i % m.w), ys = tiles.map((i) => Math.floor(i / m.w));
  const f: MapFeature = {
    kind, variant: "", zone, jobs: [kind === "crater" ? "pen" : kind === "infill" ? "seal" : kind === "lavaRiver" ? "crossing" : kind === "fenceRow" ? "lane" : kind === "landmark" ? "landmark" : "cover"],
    ax: xs[0], ay: ys[0], p: [], bbox: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1 },
    tiles: tiles.length, ...extra,
  };
  m.features.push(f);
  for (const i of tiles) m.featureGrid[i] = m.features.length;
  return m.features.length - 1;
}
/** A solid block of walls, x0..x1 by y0..y1. */
function block(m: GameMap, x0: number, y0: number, x1: number, y1: number, tile = TILE_WALL, terrain = 0): number[] {
  const out: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(setTile(m, x, y, tile, terrain));
  return out;
}
const hasCheck = (problems: string[], name: keyof typeof FEATURE_CHECKS): boolean => problems.some((p) => p.startsWith(FEATURE_CHECKS[name]));
/** The check names present, for an exact comparison. */
const checksOf = (problems: string[]): string[] => (Object.keys(FEATURE_CHECKS) as Array<keyof typeof FEATURE_CHECKS>).filter((k) => hasCheck(problems, k)).sort();

describe("feature checks (always on)", () => {
  it("accepts an empty list, and a clean wall feature that owns exactly its tiles", () => {
    const m = featureMap();
    expect(featureProblems(m)).toEqual([]);
    own(m, "gallows", "fire", block(m, 5, 5, 7, 7), { jobs: ["landmark"] });
    expect(featureProblems(m)).toEqual([]);
    expect(featureProblems(m, [1])).toEqual([]);
  });

  it("rejects a featureGrid of the wrong size or naming a feature that is not there", () => {
    const m = featureMap();
    m.featureGrid = new Uint8Array(5);
    expect(checksOf(featureProblems(m))).toEqual(["grid"]);
    const n = featureMap();
    n.featureGrid[100] = 3;
    expect(hasCheck(featureProblems(n), "grid")).toBe(true);
  });

  it("rejects more than 250 features", () => {
    const m = featureMap();
    for (let k = 0; k < 251; k++) m.features.push({ kind: "infill", variant: "", zone: "fire", jobs: ["seal"], ax: 5, ay: 5, p: [], bbox: { x: 5, y: 5, w: 1, h: 1 }, tiles: 0 });
    expect(hasCheck(featureProblems(m), "grid")).toBe(true);
  });

  it("rejects a feature outside the tables: kind, zone, variant, jobs, params, anchor, box", () => {
    const base = (): GameMap => { const m = featureMap(); own(m, "gallows", "fire", block(m, 5, 5, 7, 7), { jobs: ["landmark"] }); return m; };
    const cases: Array<[string, (f: MapFeature) => void]> = [
      ["kind", (f) => { (f as { kind: string }).kind = "pyramid"; }],
      ["zone", (f) => { (f as { zone: string }).zone = "ice"; }],
      ["variant", (f) => { f.variant = "forge"; }],
      ["no job", (f) => { f.jobs = []; }],
      ["three jobs", (f) => { f.jobs = ["landmark", "lee", "rest"]; }],
      ["a job twice", (f) => { f.jobs = ["lee", "lee"]; }],
      ["an unknown job", (f) => { (f.jobs as string[]) = ["banana"]; }],
      ["a fractional param", (f) => { f.p = [1.5]; }],
      ["an anchor off the map", (f) => { f.ax = 400; }],
      ["a negative anchor", (f) => { f.ay = -1; }],
      ["an empty box", (f) => { f.bbox = { x: 5, y: 5, w: 0, h: 3 }; }],
      ["a box off the map", (f) => { f.bbox = { x: 38, y: 5, w: 5, h: 3 }; }],
    ];
    for (const [what, edit] of cases) {
      const m = base();
      edit(m.features[0]);
      expect(hasCheck(featureProblems(m), "table"), what).toBe(true);
    }
    expect(featureProblems(base())).toEqual([]);
  });

  it("rejects a variant on a non-landmark, and a landmark without a design", () => {
    const m = featureMap();
    own(m, "landmark", "fire", block(m, 5, 5, 8, 8), { variant: "" });
    expect(hasCheck(featureProblems(m), "table")).toBe(true);
  });

  it("rejects a tile count that is not the ownership, a tile outside the box, and a feature that owns nothing", () => {
    const counts = featureMap();
    own(counts, "gallows", "fire", block(counts, 5, 5, 7, 7), { jobs: ["landmark"] });
    counts.features[0].tiles = 8;
    expect(hasCheck(featureProblems(counts), "tiles")).toBe(true);
    const box = featureMap();
    own(box, "gallows", "fire", block(box, 5, 5, 7, 7), { jobs: ["landmark"] });
    box.features[0].bbox = { x: 5, y: 5, w: 2, h: 3 };
    expect(hasCheck(featureProblems(box), "tiles")).toBe(true);
    const empty = featureMap();
    own(empty, "gallows", "fire", block(empty, 5, 5, 7, 7), { jobs: ["landmark"] });
    empty.featureGrid.fill(0);
    expect(hasCheck(featureProblems(empty), "tiles")).toBe(true);
  });

  it("rejects a feature that owns a tile of another zone or of no zone", () => {
    const m = featureMap();
    const tiles = block(m, 5, 5, 7, 7);
    own(m, "gallows", "fire", tiles, { jobs: ["landmark"] });
    m.regionGrid[tiles[4]] = 2;
    expect(hasCheck(featureProblems(m), "zone")).toBe(true);
    const n = featureMap();
    own(n, "gallows", "sentenced", block(n, 5, 5, 7, 7), { jobs: ["landmark"] });
    expect(hasCheck(featureProblems(n), "zone")).toBe(true);
  });

  it("keeps the order: zones by REGION_FACTIONS, a zone's landmarks first, one infill last", () => {
    const m = featureMap();
    for (let y = 0; y < 40; y++) for (let x = 20; x < 39; x++) if (y > 0 && y < 39) m.regionGrid[y * 40 + x] = 2;
    const a = own(m, "gallows", "sentenced", block(m, 25, 5, 27, 7), { jobs: ["landmark"] });
    own(m, "gallows", "fire", block(m, 5, 5, 7, 7), { jobs: ["landmark"] });
    expect(a).toBe(0);
    expect(hasCheck(featureProblems(m), "order")).toBe(true);
    const o = featureMap();
    own(o, "infill", "fire", block(o, 5, 5, 7, 7), { jobs: ["seal"] });
    own(o, "crater", "fire", block(o, 10, 5, 12, 7), { jobs: ["pen"] });
    expect(hasCheck(featureProblems(o), "order")).toBe(true);
    const two = featureMap();
    own(two, "infill", "fire", block(two, 5, 5, 7, 7), { jobs: ["seal"] });
    own(two, "infill", "fire", block(two, 10, 5, 12, 7), { jobs: ["seal"] });
    expect(hasCheck(featureProblems(two), "order")).toBe(true);
    const good = featureMap();
    own(good, "gallows", "fire", block(good, 5, 5, 7, 7), { jobs: ["landmark"] });
    own(good, "crater", "fire", block(good, 10, 5, 12, 7), { jobs: ["pen"] });
    own(good, "infill", "fire", block(good, 15, 5, 17, 7), { jobs: ["seal"] });
    expect(featureProblems(good)).toEqual([]);
  });
});

/** The forge template at orientation 0 (contract 5.2), stamped at (x0, y0): walls, owned floor and its door tiles. */
function stampForge(m: GameMap, x0: number, y0: number): { tiles: number[]; doors: number[]; walls: number[] } {
  const rows = ["###dd####", "#c......#", "#.......#", "#..###..#", "#..###..d", "#c......d", "#########"];
  const tiles: number[] = [], doors: number[] = [], walls: number[] = [];
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => {
    const i = (y0 + dy) * m.w + x0 + dx;
    tiles.push(i);
    if (ch === "#") { m.tiles[i] = TILE_WALL; walls.push(i); } else if (ch === "d") doors.push(i);
  }));
  return { tiles, doors: doors.sort((a, b) => a - b), walls };
}
function forgeMap(x0 = 10, y0 = 10): GameMap {
  const m = featureMap();
  const s = stampForge(m, x0, y0);
  own(m, "landmark", "fire", s.tiles, { variant: "forge", jobs: ["landmark", "lee"], p: [0, 0, ...s.doors] });
  m.buildings = [{ x: x0, y: y0, w: 9, h: 7 }];
  return m;
}

describe("landmark checks (always on)", () => {
  it("accepts the forge of the contract, stamped whole, with its doors, interior and building box", () => {
    expect(featureProblems(forgeMap())).toEqual([]);
    expect(featureProblems(forgeMap(), [1])).toEqual([]);
  });

  it("rejects a design in the wrong zone, a missing building, and a box whose margin leaves the zone", () => {
    const wrongZone = forgeMap();
    wrongZone.features[0].variant = "shrine";
    expect(hasCheck(featureProblems(wrongZone), "landmark")).toBe(true);
    const noBuilding = forgeMap();
    noBuilding.buildings = [];
    expect(hasCheck(featureProblems(noBuilding), "buildings")).toBe(true);
    const moved = forgeMap();
    moved.buildings = [{ x: 30, y: 30, w: 5, h: 5 }];
    expect(hasCheck(featureProblems(moved), "buildings")).toBe(true);
    const margin = forgeMap(1, 10);
    expect(hasCheck(featureProblems(margin), "landmark")).toBe(true);
    const edge = forgeMap();
    edge.regionGrid[9 * 40 + 10] = 2; // the row above the box belongs to another zone
    expect(hasCheck(featureProblems(edge), "landmark")).toBe(true);
  });

  it("rejects a door one tile wide, a door that is a wall, and a landmark with no door", () => {
    const narrow = forgeMap();
    narrow.features[0].p = [0, 0, ...narrow.features[0].p.slice(2).filter((i) => i !== 10 * 40 + 13 + 0)];
    // Drop one tile of the two-wide top door: p keeps 3 door tiles, the top one now alone.
    const top = narrow.features[0].p.slice(2).filter((i) => Math.floor(i / 40) === 10);
    expect(top.length).toBeLessThanOrEqual(1);
    expect(hasCheck(featureProblems(narrow), "landmark")).toBe(true);
    const walled = forgeMap();
    walled.tiles[walled.features[0].p[2]] = TILE_WALL;
    expect(hasCheck(featureProblems(walled), "landmark")).toBe(true);
    const none = forgeMap();
    none.features[0].p = [0, 0];
    expect(hasCheck(featureProblems(none), "landmark")).toBe(true);
  });

  it("rejects an interior under 60% floor", () => {
    const m = forgeMap();
    for (let y = 11; y <= 15; y++) for (let x = 11; x <= 17; x++) if (m.tiles[y * 40 + x] === TILE_FLOOR && (x + y) % 3 !== 0) { m.tiles[y * 40 + x] = TILE_WALL; }
    expect(hasCheck(featureProblems(m), "landmark")).toBe(true);
  });

  it("rejects a landmark closer than 3 tiles to a camp halo", () => {
    const m = forgeMap(10, 10);
    // The camp's clearing reaches 2.5 tiles, its halo 3.5: a camp 4 tiles right of the box puts the halo 1 tile away.
    m.camps = [camp("fire", 23, 14)];
    expect(hasCheck(featureProblems(m), "landmark")).toBe(true);
    m.camps = [camp("fire", 30, 30)];
    expect(featureProblems(m)).toEqual([]);
    // Exactly 3 tiles away is allowed: halo edge at x = 22, box edge at x = 18 -> gap of 3.
    const near = forgeMap(10, 10);
    near.camps = [camp("fire", 23, 30)];
    near.camps = [camp("fire", 22 + 3, 14)];
    expect(hasCheck(featureProblems(near), "landmark")).toBe(false);
  });
});

describe("feature checks (strict: the shape gates)", () => {
  it("flags a zone WALL or LOW tile no feature owns, only in the strict zones", () => {
    const m = featureMap();
    setTile(m, 20, 20, TILE_WALL);
    setTile(m, 25, 25, TILE_LOW, TERRAIN_FENCE);
    expect(featureProblems(m)).toEqual([]);
    expect(featureProblems(m, [2])).toEqual([]);
    const p = featureProblems(m, [1]);
    expect(checksOf(p)).toContain("unowned");
    expect(p.find((q) => q.startsWith(FEATURE_CHECKS.unowned))).toContain("2 tiles, first at 20,20");
    const owned = featureMap();
    own(owned, "infill", "fire", [setTile(owned, 20, 20, TILE_WALL)], { jobs: ["seal"] });
    expect(hasCheck(featureProblems(owned, [1]), "unowned")).toBe(false);
  });

  it("flags a floor hazard no feature owns, and lets a feature own it as floor", () => {
    const m = featureMap();
    m.terrain[20 * 40 + 20] = TERRAIN_EMBER;
    expect(hasCheck(featureProblems(m, [1]), "hazards")).toBe(true);
    own(m, "lavaRiver", "fire", [20 * 40 + 20], { jobs: ["crossing"] });
    expect(hasCheck(featureProblems(m, [1]), "hazards")).toBe(false);
  });

  it("flags a tile class the feature's kind does not write: a wall in a river, LOW ground in a crater, a wall in a lake", () => {
    const river = featureMap();
    own(river, "lavaRiver", "fire", [...block(river, 5, 5, 10, 5, TILE_LOW, TERRAIN_LAVA), setTile(river, 11, 5, TILE_WALL)], { jobs: ["crossing"] });
    expect(hasCheck(featureProblems(river, [1]), "kindTiles")).toBe(true);
    const crater = featureMap();
    own(crater, "crater", "fire", [...block(crater, 5, 5, 10, 5, TILE_WALL), setTile(crater, 11, 5, TILE_LOW, TERRAIN_LAVA)], { jobs: ["pen"] });
    expect(hasCheck(featureProblems(crater, [1]), "kindTiles")).toBe(true);
    const mere = featureMap();
    own(mere, "mere", "fire", block(mere, 5, 5, 10, 10, TILE_WALL), { jobs: ["crossing"] });
    expect(hasCheck(featureProblems(mere, [1]), "kindTiles")).toBe(true);
    const ok = featureMap();
    own(ok, "lavaRiver", "fire", block(ok, 5, 5, 10, 5, TILE_LOW, TERRAIN_LAVA), { jobs: ["crossing"] });
    own(ok, "crater", "fire", block(ok, 5, 9, 10, 9, TILE_WALL), { jobs: ["pen"] });
    expect(featureProblems(ok, [1])).toEqual([]);
  });

  it("flags LOW tiles of a river or a fence row that carry the wrong terrain", () => {
    const m = featureMap();
    own(m, "fenceRow", "fire", block(m, 5, 5, 10, 5, TILE_LOW, TERRAIN_LAVA), { jobs: ["lane"] });
    expect(hasCheck(featureProblems(m, [1]), "kindTiles")).toBe(true);
    const ok = featureMap();
    own(ok, "fenceRow", "fire", block(ok, 5, 5, 10, 5, TILE_LOW, TERRAIN_FENCE), { jobs: ["lane"] });
    expect(featureProblems(ok, [1])).toEqual([]);
  });

  it("flags a wall feature smaller than 6 tiles (the infill is exempt: it joins other walls)", () => {
    const small = featureMap();
    own(small, "crater", "fire", block(small, 5, 5, 7, 6).slice(0, 5), { jobs: ["pen"] });
    expect(hasCheck(featureProblems(small, [1]), "size")).toBe(true);
    const infill = featureMap();
    own(infill, "infill", "fire", [setTile(infill, 5, 5, TILE_WALL)], { jobs: ["seal"] });
    expect(hasCheck(featureProblems(infill, [1]), "size")).toBe(false);
    const lake = featureMap();
    own(lake, "mere", "fire", [5 * 40 + 5], { jobs: ["crossing"] });
    expect(hasCheck(featureProblems(lake, [1]), "size")).toBe(false);
  });

  it("flags a wall or LOW tile on a camp clearing, a halo or a spawn pad, but not owned floor there", () => {
    const m = featureMap();
    m.camps = [camp("fire", 20, 20)];
    own(m, "crater", "fire", [setTile(m, 20, 20, TILE_WALL), ...block(m, 5, 5, 9, 5)], { jobs: ["pen"] });
    expect(hasCheck(featureProblems(m, [1]), "overlap")).toBe(true);
    const halo = featureMap();
    halo.camps = [camp("fire", 20, 20)];
    own(halo, "crater", "fire", [setTile(halo, 23, 20, TILE_WALL), ...block(halo, 5, 5, 9, 5)], { jobs: ["pen"] });
    expect(hasCheck(featureProblems(halo, [1]), "overlap")).toBe(true);
    const pad = featureMap();
    pad.spawnPool = [{ x: tileToWorldCenter(30), y: tileToWorldCenter(10), zone: "fire" }];
    own(pad, "barrow", "fire", [setTile(pad, 31, 11, TILE_WALL), ...block(pad, 5, 5, 9, 5)], { jobs: ["fork"] });
    expect(hasCheck(featureProblems(pad, [1]), "overlap")).toBe(true);
    // A crater's bowl is owned floor around the camp: allowed.
    const bowl = featureMap();
    bowl.camps = [camp("fire", 20, 20)];
    own(bowl, "crater", "fire", [20 * 40 + 20, 20 * 40 + 21, ...block(bowl, 5, 5, 10, 5)], { jobs: ["pen"] });
    expect(featureProblems(bowl, [1])).toEqual([]);
  });

  it("flags jobs that do not fit the kind", () => {
    const m = featureMap();
    own(m, "crater", "fire", block(m, 5, 5, 10, 5), { jobs: ["lane"] });
    expect(hasCheck(featureProblems(m, [1]), "jobs")).toBe(true);
    const landmark = forgeMap();
    landmark.features[0].jobs = ["lee"];
    expect(hasCheck(featureProblems(landmark, [1]), "jobs")).toBe(true);
    const ok = featureMap();
    own(ok, "barrow", "fire", block(ok, 5, 5, 10, 5), { jobs: ["fork", "choke"] });
    expect(featureProblems(ok, [1])).toEqual([]);
  });

  it("accepts a clean strict zone with every kind of feature", () => {
    const m = featureMap();
    own(m, "crater", "fire", block(m, 3, 3, 8, 3), { jobs: ["pen"] });
    own(m, "lavaRiver", "fire", block(m, 3, 6, 8, 6, TILE_LOW, TERRAIN_LAVA), { jobs: ["crossing"] });
    own(m, "fenceRow", "fire", block(m, 3, 9, 8, 9, TILE_LOW, TERRAIN_FENCE), { jobs: ["lane"] });
    own(m, "mere", "fire", [12 * 40 + 3, 12 * 40 + 4], { jobs: ["crossing"] });
    m.terrain[12 * 40 + 3] = TERRAIN_ICE;
    own(m, "infill", "fire", block(m, 3, 15, 8, 15), { jobs: ["seal"] });
    expect(featureProblems(m, [1])).toEqual([]);
    expect(pieceProblems(m, [1])).toEqual([]);
  });
});

describe("strict selection", () => {
  it("follows the generator's gates in zone mode, takes true/false/a list when told, and is off outside zone mode", () => {
    expect(strictZoneCodes(true, undefined)).toEqual(SHAPE_GATES ? [1, 2, 3, 4, 5] : []);
    expect(strictZoneCodes(false, undefined)).toEqual([]);
    expect(strictZoneCodes(true, true)).toEqual([1, 2, 3, 4, 5]);
    expect(strictZoneCodes(false, true)).toEqual([1, 2, 3, 4, 5]);
    expect(strictZoneCodes(true, false)).toEqual([]);
    expect(strictZoneCodes(true, ["holy", "fire"])).toEqual([5, 1]);
  });
});

// ---- Decor ------------------------------------------------------------------------------------------------------------------

describe("decor equality", () => {
  const base = generateMap(1, undefined, { styleZones: null, landmarks: null });
  it("accepts maps that differ in props only, and names every other difference", () => {
    const withProps = structuredClone(base);
    withProps.props.push({ kind: 1, x: 100, y: 100, v: 3 });
    expect(decorProblems(withProps, base)).toEqual([]);
    expect(mapHash(withProps)).toBe(mapHash(base));
    const edits: Array<[string, (m: GameMap) => void, string]> = [
      ["tiles", (m) => { m.tiles[300] ^= 1; }, "tiles"],
      ["terrain", (m) => { m.terrain[300] = 4; }, "terrain"],
      ["regionGrid", (m) => { m.regionGrid[300] ^= 1; }, "regionGrid"],
      ["territoryGrid", (m) => { m.territoryGrid[400] ^= 1; }, "territoryGrid"],
      ["featureGrid", (m) => { m.featureGrid[400] = 1; }, "featureGrid"],
      ["features", (m) => { m.features.push({ kind: "infill", variant: "", zone: "fire", jobs: ["seal"], ax: 1, ay: 1, p: [], bbox: { x: 1, y: 1, w: 1, h: 1 }, tiles: 1 }); }, "features"],
      ["camps", (m) => { m.camps[2].spots[0].x += TILE; }, "camps"],
      ["spawnPool", (m) => { m.spawnPool[3].x += TILE; }, "spawnPool"],
      ["buildings", (m) => { m.buildings.push({ x: 1, y: 1, w: 2, h: 2 }); }, "buildings"],
      ["crateSpots", (m) => { m.crateSpots[0].y += TILE; }, "crateSpots"],
      ["groundSpots", (m) => { m.groundSpots.pop(); }, "groundSpots"],
      ["attempt", (m) => { m.attempt++; }, "attempt"],
    ];
    for (const [what, edit, word] of edits) {
      const m = structuredClone(base);
      edit(m);
      const p = decorProblems(m, base);
      expect(p.length, what).toBeGreaterThan(0);
      expect(p.join(" "), what).toContain(word);
    }
  });
});

// ---- Every hard check of certifyMap rejects a map broken on purpose -----------------------------------------------------------------

let baseMap: GameMap | null = null;
/** A plain generated map (no stylers, no landmarks: the oldest, steadiest map the generator makes), cloned for each break. */
function base(): GameMap {
  if (!baseMap) {
    for (let s = 1; s < 40 && !baseMap; s++) {
      try {
        const m = generateMap(s, undefined, { styleZones: null, landmarks: null });
        if (certifyMap(m).failures.length === 0) baseMap = m;
      } catch { /* a seed the plain generator cannot seat: the next */ }
    }
  }
  if (!baseMap) throw new Error("no plain map certifies");
  return structuredClone(baseMap);
}

/** The Chebyshev distance of a tile from the nearest of `points` (tile indices). */
const cheb = (w: number, a: number, b: number): number => Math.max(Math.abs((a % w) - (b % w)), Math.abs(Math.floor(a / w) - Math.floor(b / w)));
/** Every tile index that some part of the map's records stands on or near: camps, spots, pool members, crates, ground spots. */
function busyTiles(m: GameMap): number[] {
  const at = (p: { x: number; y: number }): number => Math.floor(p.y / TILE) * m.w + Math.floor(p.x / TILE);
  return [...m.camps.flatMap((c) => [at(c), ...c.spots.map(at)]), ...m.spawnPool.map(at), ...m.crateSpots.map(at), ...m.groundSpots.map(at)];
}
/** A floor tile of zone `code` with floor all round (3 tiles) and nothing recorded within 6 tiles. */
function quiet(m: GameMap, code: number, skip = 0): number {
  const busy = busyTiles(m);
  let seen = 0;
  for (let i = 0; i < m.w * m.h; i++) {
    if (m.regionGrid[i] !== code || m.tiles[i] !== TILE_FLOOR) continue;
    const x = i % m.w, y = Math.floor(i / m.w);
    let clear = true;
    for (let dy = -3; dy <= 3 && clear; dy++) for (let dx = -3; dx <= 3; dx++) if (m.tiles[(y + dy) * m.w + x + dx] !== TILE_FLOOR || m.regionGrid[(y + dy) * m.w + x + dx] !== code) { clear = false; break; }
    if (clear && busy.every((b) => cheb(m.w, i, b) > 6) && seen++ >= skip) return i;
  }
  throw new Error(`no quiet tile in zone ${code}`);
}
const tileAt = (m: GameMap, p: { x: number; y: number }): number => Math.floor(p.y / TILE) * m.w + Math.floor(p.x / TILE);
const failuresOf = (m: GameMap, o: Parameters<typeof certifyMap>[1] = {}): string[] => certifyMap(m, { measures: false, ...o }).failures;

/** A break: it edits a clone of the base map, and certifyMap must report a failure starting with `expect`. */
const BREAKS: Array<{ what: string; expect: string; edit: (m: GameMap) => void; options?: Parameters<typeof certifyMap>[1] }> = [
  // grid
  { what: "a tile value that is not 0, 1 or 2", expect: "grid: 136x136", edit: (m) => { m.tiles[quiet(m, 1)] = 7; } },
  { what: "a floor tile on the border", expect: "grid: 136x136", edit: (m) => { m.tiles[5] = TILE_FLOOR; } },
  { what: "a region on the border", expect: "grid: 136x136", edit: (m) => { m.regionGrid[5] = 1; } },
  { what: "a territoryGrid of the wrong size", expect: "grid: territoryGrid", edit: (m) => { m.territoryGrid = new Uint8Array(5); } },
  // connectivity
  { what: "an island of floor", expect: "connectivity: all walkable floor is one 4-connected component", edit: (m) => { const i = quiet(m, 1); for (const d of [1, -1, m.w, -m.w]) m.tiles[i + d] = TILE_WALL; } },
  { what: "a hole in the arena wall", expect: "connectivity: gates closed", edit: (m) => { const g = m.coliseum.gates[0].tiles[0]; m.tiles[g.y * m.w + g.x - 1] = TILE_FLOOR; } },
  // gates and the coliseum
  { what: "gates out of order", expect: "gates: four straight", edit: (m) => { m.coliseum.gates.reverse(); } },
  { what: "a gate tile that is wall", expect: "gates: four straight", edit: (m) => { const g = m.coliseum.gates[1].tiles[2]; m.tiles[g.y * m.w + g.x] = TILE_WALL; } },
  { what: "a second link between arena and the rest", expect: "gates: the only links", edit: (m) => {
    const open = new Set(m.coliseum.gates.flatMap((g) => g.tiles.map((t) => t.y * m.w + t.x)));
    for (let i = 0; i < m.w * m.h; i++) {
      if (m.regionGrid[i] !== REGION_COLISEUM || m.tiles[i] !== TILE_WALL || open.has(i)) continue;
      if ([1, -1, m.w, -m.w].some((d) => m.regionGrid[i + d] === REGION_COLISEUM && m.tiles[i + d] === TILE_FLOOR && !open.has(i + d)) && [1, -1, m.w, -m.w].some((d) => m.regionGrid[i + d] !== REGION_COLISEUM && m.tiles[i + d] === TILE_FLOOR)) { m.tiles[i] = TILE_FLOOR; return; }
    }
    throw new Error("no wall ring tile");
  } },
  { what: "a wall in the lane in front of a gate", expect: "gates: a clear floor lane", edit: (m) => {
    const g = m.coliseum.gates[0], t = g.tiles[1];
    m.tiles[(t.y - 2) * m.w + t.x] = TILE_WALL; // gate "n": two tiles outside
  } },
  { what: "too few inner spawns", expect: "coliseum: centre tile floor", edit: (m) => { m.coliseum.innerSpawns.length = 3; } },
  { what: "a coliseum rect that is not its footprint", expect: "coliseum: centred footprint", edit: (m) => { m.coliseum.rect.x += 1; } },
  // zones
  { what: "areas more than 8 apart", expect: "zones: painted areas within 8 tiles", edit: (m) => { let n = 0; for (let i = 0; i < m.w * m.h && n < 14; i++) if (m.regionGrid[i] === 1) { m.regionGrid[i] = 2; n++; } } },
  { what: "an enclave of another zone", expect: "zones: five, each one 4-connected painted piece", edit: (m) => { m.regionGrid[quiet(m, 1)] = 2; } },
  { what: "a zone with half its floor walled", expect: "zones: walkable floor share", edit: (m) => { for (let i = 0; i < m.w * m.h; i++) if (m.regionGrid[i] === 3 && m.tiles[i] === TILE_FLOOR && Math.floor(i / m.w) % 2 === 0) m.tiles[i] = TILE_WALL; } },
  { what: "a zone off the ring road", expect: "zones: ring-road contact", edit: (m) => {
    for (let i = 0; i < m.w * m.h; i++) {
      if (m.regionGrid[i] !== 1) continue;
      const x = i % m.w, y = Math.floor(i / m.w);
      let near = false;
      for (let dy = -3; dy <= 3 && !near; dy++) for (let dx = -3; dx <= 3; dx++) if (m.regionGrid[(y + dy) * m.w + x + dx] === REGION_COLISEUM) { near = true; break; }
      if (near) m.regionGrid[i] = 2;
    }
  } },
  { what: "slivers: 130 lone tiles of one zone inside another", expect: "zones: sliver tiles", edit: (m) => {
    let n = 0;
    for (let y = 3; y < m.h - 3 && n < 130; y += 3) for (let x = 3; x < m.w - 3 && n < 130; x += 3) if (m.regionGrid[y * m.w + x] === 2 && m.regionGrid[(y + 1) * m.w + x] === 2 && m.regionGrid[(y - 1) * m.w + x] === 2) { m.regionGrid[y * m.w + x] = 1; n++; }
  } },
  { what: "a ring road cut in two", expect: "zones: the ring road's floor is one piece", edit: (m) => {
    // Wall every ring tile on the middle column, above and below the coliseum (the ring is a loop: two cuts make two pieces).
    const cx = m.w / 2;
    for (let y = 0; y < m.h; y++) for (const x of [cx - 1, cx]) {
      const i = y * m.w + x;
      if (m.regionGrid[i] === REGION_COLISEUM || m.tiles[i] !== TILE_FLOOR) continue;
      let ring = false;
      for (let dy = -3; dy <= 3 && !ring; dy++) for (let dx = -3; dx <= 3; dx++) if (m.regionGrid[(y + dy) * m.w + x + dx] === REGION_COLISEUM) { ring = true; break; }
      if (ring) m.tiles[i] = TILE_WALL;
    }
  } },
  // camps and territories
  { what: "a camp short", expect: "camps: 8 per zone, exactly two elite camps per zone", edit: (m) => { m.camps.splice(3, 1); } },
  { what: "an elite camp short", expect: "camps: 8 per zone, exactly two elite camps per zone", edit: (m) => { const c = m.camps.find((q) => q.eliteSpot >= 0)!; c.eliteSpot = -1; } },
  { what: "camp ids out of order", expect: "camps: ids in zone order", edit: (m) => { const t = m.camps[0].id; m.camps[0].id = m.camps[1].id; m.camps[1].id = t; } },
  { what: "two camps 2 tiles apart", expect: "camps: centres at least 9 tiles apart", edit: (m) => { m.camps[1].x = m.camps[0].x + 2 * TILE; m.camps[1].y = m.camps[0].y; } },
  { what: "a rock in a camp's clearing", expect: "camps: fire-1 clearing grown by one tile", edit: (m) => { m.tiles[tileAt(m, m.camps[0]) + 1] = TILE_WALL; } },
  { what: "a camp with two spots", expect: "camps: fire-1 3-5 distinct tile-centre spots", edit: (m) => { m.camps[0].spots.length = 2; } },
  { what: "a chest off the centre", expect: "camps: fire-1 on a tile centre", edit: (m) => { m.camps[0].chest.x += TILE; } },
  { what: "an elite spot that is not the nearest", expect: "camps: fire-", edit: (m) => { const c = m.camps.find((q) => q.eliteSpot >= 0)!; c.eliteSpot = c.spots.length - 1 > 0 ? 1 : 2; } },
  { what: "elite flags on the wrong camps", expect: "camps: fire elite camps are its farthest", edit: (m) => {
    const zc = m.camps.filter((c) => c.zone === "fire"), elites = zc.filter((c) => c.eliteSpot >= 0), other = zc.find((c) => c.eliteSpot < 0)!;
    elites[0].eliteSpot = -1;
    other.eliteSpot = 0;
    other.spots.sort((a, b) => Math.hypot(a.x - other.x, a.y - other.y) - Math.hypot(b.x - other.x, b.y - other.y));
  } },
  { what: "a zone tile with no territory", expect: "territories: partition", edit: (m) => { m.territoryGrid[quiet(m, 2)] = 0; } },
  { what: "a territory handed to another camp", expect: "territories: ", edit: (m) => {
    const c = m.camps[0], cx = tileAt(m, c);
    const far = m.territoryGrid.findIndex((v, i) => v === 1 && m.tiles[i] === TILE_FLOOR && cheb(m.w, i, cx) > 8);
    m.territoryGrid[far] = 2;
  } },
  { what: "a territory reaching past 30 tiles", expect: "territories: fire-1 reaches at most 30 tiles", edit: (m) => {
    const cx = tileAt(m, m.camps[0]);
    let far = -1;
    for (let i = 0; i < m.w * m.h; i++) if (m.regionGrid[i] === 1 && m.tiles[i] === TILE_FLOOR && Math.hypot((i % m.w) - (cx % m.w), Math.floor(i / m.w) - Math.floor(cx / m.w)) > 31) { far = i; break; }
    if (far < 0) throw new Error("no far tile");
    m.territoryGrid[far] = 1;
  } },
  // the spawn pool
  { what: "a pool of 20", expect: "spawns: pool of 24-32 in 4+ zones", edit: (m) => { m.spawnPool.length = 20; } },
  { what: "a pool of 33", expect: "spawns: pool of 24-32 in 4+ zones", edit: (m) => { while (m.spawnPool.length < 33) m.spawnPool.push({ ...m.spawnPool[m.spawnPool.length - 1] }); } },
  { what: "a pool in three zones", expect: "spawns: pool of 24-32 in 4+ zones", edit: (m) => { m.spawnPool.forEach((s, k) => { s.zone = (["fire", "plague", "holy"] as const)[k % 3]; }); } },
  { what: "a member with a wall in its 3x3", expect: "spawns: tile centres with a clear 3x3", edit: (m) => { m.tiles[tileAt(m, m.spawnPool[4]) + 1] = TILE_WALL; } },
  { what: "a member tagged with the wrong zone", expect: "spawns: tile centres with a clear 3x3", edit: (m) => { const s = m.spawnPool[2]; s.zone = s.zone === "fire" ? "holy" : "fire"; } },
  { what: "two members 3 tiles apart", expect: "spawns: 5+ tiles apart, pool-wide", edit: (m) => { m.spawnPool[1] = { ...m.spawnPool[1], x: m.spawnPool[0].x + 3 * TILE, y: m.spawnPool[0].y }; } },
  { what: "a member 3 tiles from a camp centre", expect: "spawns: 5+ tiles from every camp centre", edit: (m) => { m.spawnPool[0] = { ...m.spawnPool[0], x: m.camps[5].x + 3 * TILE, y: m.camps[5].y }; } },
  { what: "two members 6 tiles apart in sight of each other", expect: "spawns: members under 10 tiles apart have a wall on the line between them", edit: (m) => {
    const a = m.spawnPool[0];
    m.spawnPool[1] = { ...m.spawnPool[1], x: a.x + 6 * TILE, y: a.y };
    for (let k = 0; k <= 6; k++) m.tiles[tileAt(m, { x: a.x + k * TILE, y: a.y })] = TILE_FLOOR;
  } },
  { what: "a member that walks far less than the rest", expect: "spawns: every member walks to the centre (findPath), max/min <= 1.2", edit: (m) => {
    const cx = m.w / 2, cy = m.h / 2;
    // A floor tile just outside the ring road, level with the coliseum: its walk to the centre is about 10 tiles against 40+.
    for (let x = cx + 11; x < cx + 20; x++) if (m.tiles[cy * m.w + x] === TILE_FLOOR) { m.spawnPool[0] = { x: tileToWorldCenter(x), y: tileToWorldCenter(cy), zone: m.spawnPool[0].zone }; return; }
    throw new Error("no near tile");
  } },
  { what: "nine hazard tiles on a member's walk", expect: "spawns: at most 8 floor-hazard tiles on every member's walk", edit: (m) => {
    const s = m.spawnPool[3], path = findPath(m, s, m.coliseum.centre);
    const seen = new Set<number>();
    let ax = s.x, ay = s.y;
    for (const q of path) {
      const steps = Math.ceil(Math.hypot(q.x - ax, q.y - ay) / 4);
      for (let k = 0; k <= steps; k++) {
        const t = Math.floor((ay + ((q.y - ay) * k) / Math.max(1, steps)) / TILE) * m.w + Math.floor((ax + ((q.x - ax) * k) / Math.max(1, steps)) / TILE);
        if (m.regionGrid[t] >= 1 && m.regionGrid[t] <= 5 && cheb(m.w, t, tileAt(m, s)) > 3) seen.add(t);
      }
      ax = q.x; ay = q.y;
    }
    [...seen].slice(0, 12).forEach((t) => { m.terrain[t] = TERRAIN_EMBER; });
  } },
  // views
  { what: "a region area that is not the painted count", expect: "views: mobCamps", edit: (m) => { m.regions[0].area += 1; } },
  { what: "a pole in a wall", expect: "views: mobCamps", edit: (m) => { m.regions[1].pole = { x: tileToWorldCenter(0), y: tileToWorldCenter(0) }; } },
  // features
  { what: "a featureGrid byte naming a feature that is not there", expect: FEATURE_CHECKS.grid, edit: (m) => { m.featureGrid[quiet(m, 1)] = 1; } },
  { what: "a landmark box in no zone", expect: "landmarks: each box", edit: (m) => { m.buildings.push({ x: 0, y: 0, w: 4, h: 4 }); } },
  // crates and ground
  { what: "three crates in a zone", expect: "crates: 4-6 per zone", edit: (m) => { m.regions[0].chestSpots.length = 3; m.crateSpots = m.regions.flatMap((r) => r.chestSpots); } },
  { what: "a crate in the middle of nowhere's wall", expect: "crates: 4-6 per zone", edit: (m) => { m.regions[2].chestSpots[0] = { x: tileToWorldCenter(1), y: tileToWorldCenter(1) }; m.crateSpots = m.regions.flatMap((r) => r.chestSpots); } },
  { what: "29 ground spots", expect: "ground: 30-45", edit: (m) => { m.groundSpots.length = 29; } },
  { what: "a ground spot in a camp clearing", expect: "ground: 30-45", edit: (m) => { m.groundSpots[0] = { x: m.camps[4].x, y: m.camps[4].y }; } },
  // terrain
  { what: "terrain on an unstyled map", expect: "terrain: an unstyled map has no terrain", edit: (m) => { m.terrain[quiet(m, 4)] = TERRAIN_ICE; } },
  { what: "a hazard on a camp clearing", expect: "terrain: no kind on a spawn 3x3", options: { styled: true }, edit: (m) => { m.terrain[tileAt(m, m.camps[2]) + 1] = TERRAIN_EMBER; } },
  { what: "a hazard on a spawn 5x5", expect: "terrain: no kind on a spawn 3x3", options: { styled: true }, edit: (m) => { m.terrain[tileAt(m, m.spawnPool[1]) + 2] = TERRAIN_EMBER; } },
  { what: "ICE beside a wall", expect: "terrain: every ICE tile has floor on all eight sides", options: { styled: true }, edit: (m) => { const i = quiet(m, 4); m.terrain[i] = TERRAIN_ICE; m.tiles[i + 1] = TILE_WALL; } },
  { what: "LOW ground with no kind", expect: "terrain: validateTerrain clean", options: { styled: true }, edit: (m) => { m.tiles[quiet(m, 2)] = TILE_LOW; } },
  { what: "a hazard in another zone's ground", expect: "styler=zone: every terrain kind lies in its home zone", options: { zone: true }, edit: (m) => { m.terrain[quiet(m, 2)] = TERRAIN_EMBER; } },
  { what: "bog outside the Warren", expect: "styler=zone: every terrain kind lies in its home zone", options: { zone: true }, edit: (m) => { m.terrain[quiet(m, 4)] = TERRAIN_BOG; } },
  { what: "a zone's floor in two pieces", expect: "styler=zone: every zone's walkable floor is one 4-connected piece", options: { zone: true }, edit: (m) => { const i = quiet(m, 3); for (const d of [1, -1, m.w, -m.w]) m.tiles[i + d] = TILE_WALL; } },
  // reachability
  { what: "a ground spot walled in", expect: "reachability:", edit: (m) => { const i = tileAt(m, m.groundSpots[0]); for (const d of [1, -1, m.w, -m.w]) m.tiles[i + d] = TILE_WALL; } },
];

describe("every hard check rejects a map broken on purpose", () => {
  it("passes the unbroken base map in both strict and loose modes", () => {
    expect(failuresOf(base())).toEqual([]);
    expect(failuresOf(base(), { zone: true })).toEqual([]);
    expect(failuresOf(base(), { zone: true, strict: true })).toEqual([]);
  });
  for (const b of BREAKS) {
    it(`rejects ${b.what}`, () => {
      const m = base();
      b.edit(m);
      const got = failuresOf(m, b.options);
      expect(got.some((f) => f.startsWith(b.expect)), `${b.expect}\n  got: ${got.slice(0, 6).join("\n       ")}`).toBe(true);
    });
  }
});

describe("the strict group through certifyMap", () => {
  /** Walling a floor tile also changes the camps' territory areas: only the feature and piece checks are of interest here. */
  const shapeFailures = (m: GameMap, o: Parameters<typeof certifyMap>[1]): string[] => failuresOf(m, o).filter((f) => f.startsWith("features:") || f.startsWith("pieces:"));

  it("fails a wall no feature owns and a single tile only when asked, for all zones or for one", () => {
    const m = base();
    const i = quiet(m, 3);
    m.tiles[i] = TILE_WALL;
    expect(shapeFailures(m, { zone: true }).length > 0).toBe(SHAPE_GATES);
    const strict = shapeFailures(m, { zone: true, strict: true });
    expect(strict.some((f) => f.startsWith(FEATURE_CHECKS.unowned))).toBe(true);
    expect(strict.some((f) => f.startsWith(FEATURE_CHECKS.pieces))).toBe(true);
    // The wall is in the plague zone: a strict list that leaves plague out does not see it.
    expect(shapeFailures(m, { zone: true, strict: ["fire", "holy"] })).toEqual([]);
    const only = shapeFailures(m, { zone: true, strict: ["plague"] });
    expect(only.some((f) => f.startsWith(FEATURE_CHECKS.unowned))).toBe(true);
    expect(certifyMap(m, { zone: true, strict: ["plague"] }).stats.strictZones).toEqual([3]);
    expect(certifyMap(m, { zone: true, strict: false }).stats.strictZones).toEqual([]);
  });

  it("accepts the same wall once a feature owns it, grown to a piece of 6", () => {
    const m = base();
    const i = quiet(m, 3), x = i % m.w, y = Math.floor(i / m.w);
    const tiles = block(m, x, y, x + 2, y + 1);
    own(m, "crater", "plague", tiles, { jobs: ["pen"], ax: x, ay: y });
    expect(shapeFailures(m, { zone: true, strict: true })).toEqual([]);
    m.featureGrid[tiles[0]] = 0;
    m.features[0].tiles--;
    expect(shapeFailures(m, { zone: true, strict: true }).length).toBeGreaterThan(0);
  });
});

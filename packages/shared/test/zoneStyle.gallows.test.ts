// Gallows, the Rows (zone-shapes contract 4.2, WP2): the gate rule the zone duel harness shares, the guard house template, the
// styler on a synthetic open fixture (both axes), and on the generator's maps with ONLY this styler new and the others old (a
// test-local hook: the registry still holds the phase A styler until WP7 swaps it in phase C). The 200-seed acceptance table is a
// script's (the report), these are the invariants every seed must keep.
import { describe, expect, it, vi } from "vitest";
import { MAPGEN_FAILS, generateMap, mapHash } from "../src/mapgen";
import type { LandmarkHook, ZoneStyleHook } from "../src/mapgen";
import { REGION_FACTIONS, TILE_FLOOR, TILE_LOW, TILE_WALL } from "../src/map";
import type { GameMap, RegionFaction } from "../src/map";
import { TERRAIN_FENCE, validateTerrain } from "../src/terrain";
import { styleLandmarks, styleZones } from "../src/zoneStyle/styleZones";
import {
  GALLOWS_DIALS, GATE_PERIOD, GATE_PHASES, GATE_W, GUARD_HOUSE, ROW_GAP_MAX, ROW_GAP_MIN, ROW_MIN_PIECE, gallowsGateOpen, gallowsMaxGateDistance,
  gallowsRowPhase, gallowsRows, makeGallows,
} from "../src/zoneStyle/gallows";
import type { GallowsRowsPlan } from "../src/zoneStyle/gallows";
import { stampTemplate, templateProblems } from "../src/zoneStyle/landmarks";
import { ROUTE_STRETCH_MAX } from "../src/zoneStyle/features";
import { ZONE_PROP_KINDS } from "../src/zoneStyle/propKinds";
import type { LandmarkState } from "../src/styler";
import type { StyleResult, ZoneStyleState, ZoneStyler } from "../src/zoneStyle/types";

const HEAVY_MS = 180_000;
const FACTION: RegionFaction = "sentenced";
const ZONE_CODE = REGION_FACTIONS.indexOf(FACTION) + 1;

// ------------------------------------------------------------------------------------------------ the generator, one new styler
interface Sink { plan: GallowsRowsPlan | null; results: StyleResult[] }

/**
 * The test-local hook: this zone gets `styler`, every other zone its registry styler (the phase A ones today). `others` replaces
 * other zones' styler in the STYLE pass only (the landmark pass keeps the registry's, so the pool and the protect the style pass
 * sees are the same either way); `record` receives the tiles and terrain right after the style pass.
 */
function hooks(styler: ZoneStyler<any>, sink?: Sink, others: Partial<Record<RegionFaction, ZoneStyler<any>>> = {}, record?: (st: { tiles: Uint8Array; terrain: Uint8Array }) => void, landmarkStyler: ZoneStyler<any> = styler): { styleZones: ZoneStyleHook; landmarks: LandmarkHook } {
  const stylers = { ...others, [FACTION]: styler } as Partial<Record<RegionFaction, ZoneStyler<any>>>;
  const landmarkStylers = { [FACTION]: landmarkStyler } as Partial<Record<RegionFaction, ZoneStyler<any>>>;
  return {
    styleZones: (st) => {
      const results = styleZones({
        w: st.w, h: st.h, seed: st.seed, attempt: st.attempt, tiles: st.tiles, terrain: st.terrain, props: st.props, zone: st.zone,
        zoneFaction: st.zoneFaction, protect: st.protect, territory: st.territoryGrid, camps: st.camps,
        spawns: st.spawns, centreWalk: st.centreWalk, features: st.features, featureOwner: st.featureOwner,
      }, { decor: st.decor, stylers });
      if (sink) {
        sink.results = results;
        sink.plan = (results.find((r) => r.faction === FACTION)?.plan as GallowsRowsPlan | undefined) ?? null;
      }
      record?.({ tiles: st.tiles.slice(), terrain: st.terrain.slice() });
    },
    landmarks: (st: LandmarkState) => { styleLandmarks(st, { stylers: landmarkStylers }); },
  };
}

const cache = new Map<number, { map: GameMap; plan: GallowsRowsPlan }>();
/** The map of `seed` with the new Gallows only (shapeGates off: the other zones' phase A stylers write unowned tiles). */
function mapOf(seed: number, styler: ZoneStyler<any> = gallowsRows): { map: GameMap; plan: GallowsRowsPlan } {
  const cached = styler === gallowsRows ? cache.get(seed) : undefined;
  if (cached) return cached;
  const sink: Sink = { plan: null, results: [] };
  const map = generateMap(seed, undefined, { ...hooks(styler, sink), shapeGates: false });
  const out = { map, plan: sink.plan! };
  if (styler === gallowsRows) cache.set(seed, out);
  return out;
}

const SEEDS = Array.from({ length: 50 }, (_, i) => i);

/** 8-connected pieces of one tile class inside a mask: their sizes. */
function pieceSizes(tiles: Uint8Array, mask: Uint8Array, w: number, h: number, cls: number): number[] {
  const seen = new Uint8Array(w * h);
  const out: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || !mask[s] || tiles[s] !== cls) continue;
    const stack = [s];
    seen[s] = 1;
    let n = 0;
    while (stack.length) {
      const i = stack.pop()!;
      n++;
      const x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (mask[j] && !seen[j] && tiles[j] === cls) { seen[j] = 1; stack.push(j); }
      }
    }
    out.push(n);
  }
  return out;
}

/**
 * The fence detour rule, checked on a finished grid by its own definition: for a fence tile and k = 1..3, two floor tiles k steps
 * either side of it (along its row or column) still walk to each other within 2k + cap steps (4-connected floor of the zone).
 */
function fenceDetourViolations(tiles: Uint8Array, terrain: Uint8Array, mask: Uint8Array, w: number, h: number, cap = 10): number {
  let bad = 0;
  const depth = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || tiles[i] !== TILE_LOW || terrain[i] !== TERRAIN_FENCE) continue;
    const x = i % w, y = (i - x) / w;
    for (const [sx, sy] of [[1, 0], [0, 1]] as const) {
      for (let k = 1; k <= 3; k++) {
        const ax = x - k * sx, ay = y - k * sy, bx = x + k * sx, by = y + k * sy;
        if (ax < 0 || ay < 0 || bx >= w || by >= h) break;
        const a = ay * w + ax, b = by * w + bx;
        if (tiles[a] !== TILE_FLOOR || tiles[b] !== TILE_FLOOR || !mask[a] || !mask[b]) break;
        const limit = 2 * k + cap;
        depth.fill(-1);
        const queue = [a];
        depth[a] = 0;
        let found = false;
        for (let head = 0; head < queue.length && !found; head++) {
          const cur = queue[head];
          if (cur === b) { found = true; break; }
          if (depth[cur] >= limit) continue;
          const cx = cur % w, cy = (cur - cx) / w;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const j = ny * w + nx;
            if (j === i || depth[j] >= 0 || tiles[j] !== TILE_FLOOR || !mask[j]) continue;
            depth[j] = depth[cur] + 1;
            queue.push(j);
          }
        }
        if (!found) bad++;
      }
    }
  }
  return bad;
}

/** Is the zone's FLOOR one 4-connected piece? */
function floorPieces(tiles: Uint8Array, mask: Uint8Array, w: number, h: number): number {
  const seen = new Uint8Array(w * h);
  let pieces = 0;
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || !mask[s] || tiles[s] !== TILE_FLOOR) continue;
    pieces++;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w, y = (i - x) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (mask[j] && !seen[j] && tiles[j] === TILE_FLOOR) { seen[j] = 1; stack.push(j); }
      }
    }
  }
  return pieces;
}

// ------------------------------------------------------------------------------------------------ the rule and the template
describe("the gate rule (shared with the zone duel harness)", () => {
  it("is a true modulo: a gate is GATE_W positions every GATE_PERIOD from the phase, the lead of the row (s < phase) and negative s included", () => {
    expect([GATE_PERIOD, GATE_W, [...GATE_PHASES]]).toEqual([12, 3, [2, 8]]);
    for (const phase of GATE_PHASES) {
      for (let s = -40; s < 80; s++) {
        const rel = (((s - phase) % 12) + 12) % 12;
        expect(gallowsGateOpen(s, phase), `s ${s} phase ${phase}`).toBe(rel < 3);
      }
    }
    // phase 2: gates at 2 3 4 | 14 15 16 ... and, by the true modulo, at -10 -9 -8 in the lead; phase 8: 8 9 10 | 20 ... and -4 -3 -2
    expect([0, 1, 2, 3, 4, 5].map((s) => gallowsGateOpen(s, 2))).toEqual([false, false, true, true, true, false]);
    expect([-11, -10, -9, -8, -7].map((s) => gallowsGateOpen(s, 2))).toEqual([false, true, true, true, false]);
    expect([-5, -4, -3, -2, -1].map((s) => gallowsGateOpen(s, 8))).toEqual([false, true, true, true, false]);
    expect([7, 8, 9, 10, 11].map((s) => gallowsGateOpen(s, 8))).toEqual([false, true, true, true, false]);
  });

  it("alternates the phase row to row (2 on even indices) and keeps every fence tile within 5 tiles of a gate, so a detour is at most 10", () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => gallowsRowPhase(i))).toEqual([2, 8, 2, 8, 2, 8]);
    expect(gallowsMaxGateDistance()).toBe(5);
    for (const phase of GATE_PHASES) {
      for (let s = 0; s < 120; s++) {
        if (gallowsGateOpen(s, phase)) continue;
        let near = 99;
        for (let g = s - 12; g <= s + 12; g++) if (gallowsGateOpen(g, phase)) near = Math.min(near, Math.abs(g - s));
        expect(near, `s ${s} phase ${phase}`).toBeLessThanOrEqual(5);
      }
    }
    // the variants of the harness: period 10 / width 4 are tighter, never looser
    expect(gallowsMaxGateDistance(10, 3)).toBe(4);
    expect(gallowsMaxGateDistance(12, 4)).toBe(5);
    // a crosser changes lane about 6 tiles sideways: neighbouring rows' gates are shifted by half a period
    for (let s = 0; s < 60; s++) expect(gallowsGateOpen(s, 2) && gallowsGateOpen(s, 8)).toBe(false);
  });

  it("holds the dials of the contract", () => {
    expect([ROW_GAP_MIN, ROW_GAP_MAX, ROW_MIN_PIECE]).toEqual([7, 9, 6]);
    expect(GALLOWS_DIALS).toMatchObject({ gapMin: 7, gapMax: 9, gapTarget: 8, gapPenalty: 2, period: 12, width: 3, minRun: 10, squares: 1 });
  });
});

describe("the guard house", () => {
  it("is valid in all 8 orientations (wall pieces >= 6, doors 2-3 wide with a way through, floor connected, two crate nooks)", () => {
    expect(GUARD_HOUSE.key).toBe("guardHouse");
    expect(GUARD_HOUSE.jobs).toEqual(["landmark", "lee"]);
    expect(templateProblems(GUARD_HOUSE, { minNooks: 2 })).toEqual([]);
    const s = stampTemplate(GUARD_HOUSE, 0, 0, 0, false, 20, 20)!;
    expect([s.walls.length, s.doors.length, s.nooks.length, s.bbox.w, s.bbox.h]).toEqual([22, 4, 3, 8, 7]);
  });
});

// ------------------------------------------------------------------------------------------------ a synthetic open fixture
/** One sentenced zone on an open grid; the coliseum is the grid's centre, so the zone's side picks the axis. */
function fixture(w: number, h: number, x0: number, y0: number, x1: number, y1: number): { st: ZoneStyleState; lm: LandmarkState; mask: Uint8Array } {
  const n = w * h;
  const tiles = new Uint8Array(n), zone = new Uint8Array(n), protect = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (x < 3 || y < 3 || x >= w - 3 || y >= h - 3) { tiles[i] = TILE_WALL; protect[i] = 1; continue; }
    if (x >= x0 && x < x1 && y >= y0 && y < y1) zone[i] = 1;
  }
  const camps: Array<{ site: number; r: number; territory: number; elite: boolean }> = [];
  const camp = (cx: number, cy: number): void => {
    camps.push({ site: cy * w + cx, r: 2.5, territory: 0, elite: false });
    for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 4; x <= cx + 4; x++) protect[y * w + x] = 1;
  };
  camp(x0 + 14, y0 + 12); camp(x1 - 14, y1 - 12); camp(Math.floor((x0 + x1) / 2), Math.floor((y0 + y1) / 2) + 3);
  const mask = zone.slice();
  const features: ZoneStyleState["features"] = [];
  const featureOwner = new Uint16Array(n);
  const lm: LandmarkState = {
    w, h, seed: 1, attempt: 0, tiles, zone, zoneFaction: [FACTION], protect, territoryGrid: new Uint8Array(n), camps: camps.map((c) => ({ ...c })),
    features: features!, featureOwner,
  };
  const st: ZoneStyleState = {
    w, h, seed: 1, attempt: 0, tiles, terrain: new Uint8Array(n), props: [], zone, zoneFaction: [FACTION], protect, territory: null, camps,
    features, featureOwner,
  };
  return { st, lm, mask };
}

describe("the Rows on an open fixture", () => {
  const cases: Array<{ name: string; w: number; h: number; box: [number, number, number, number]; axis: number }> = [
    { name: "a zone to the right of the coliseum: rows run along x", w: 120, h: 100, box: [50, 8, 114, 66], axis: 0 },
    { name: "a zone below the coliseum: rows run along y", w: 100, h: 120, box: [10, 66, 68, 114], axis: 1 },
  ];
  for (const c of cases) {
    it(`${c.name}`, () => {
      const f = fixture(c.w, c.h, ...c.box);
      styleLandmarks(f.lm, { stylers: { [FACTION]: gallowsRows } });
      expect(f.lm.features.length, "guard houses stood in the landmark stage").toBeGreaterThanOrEqual(1);
      const results = styleZones(f.st, { stylers: { [FACTION]: gallowsRows } });
      const plan = results[0].plan as GallowsRowsPlan;
      const { w, h } = c;
      expect(plan.axis).toBe(c.axis);
      expect(plan.rows.length, "rows").toBeGreaterThanOrEqual(5);
      expect(plan.gallows.length, "the gallows").toBe(9);
      // ownership and pieces: every zone wall and fence tile belongs to a feature; no piece under 6 tiles
      for (let i = 0; i < w * h; i++) if (f.mask[i] && f.st.tiles[i] !== TILE_FLOOR) expect(f.st.featureOwner![i], `tile ${i} is owned`).toBeGreaterThan(0);
      expect(pieceSizes(f.st.tiles, f.mask, w, h, TILE_WALL).filter((n) => n < 6)).toEqual([]);
      expect(pieceSizes(f.st.tiles, f.mask, w, h, TILE_LOW).filter((n) => n < 6)).toEqual([]);
      expect(floorPieces(f.st.tiles, f.mask, w, h), "the zone's floor stays one piece").toBe(1);
      expect(fenceDetourViolations(f.st.tiles, f.st.terrain, f.mask, w, h), "fence detour rule").toBe(0);
      // the rule: no fence tile at a gate position of its row, and the rows are the features
      const feats = f.st.features!;
      const rowFeatures = feats.filter((x) => x.kind === "fenceRow");
      expect(rowFeatures.length).toBe(plan.rows.length);
      plan.rows.forEach((row, k) => {
        expect(rowFeatures[k].p).toEqual([c.axis, row.index, row.index % 2 === 0 ? 2 : 8]);
        expect(row.phase).toBe(gallowsRowPhase(row.index));
        expect(rowFeatures[k].jobs).toEqual(["lane"]);
        for (const i of row.tiles) {
          const s = c.axis === 0 ? i % w : Math.floor(i / w);
          expect(gallowsGateOpen(s - plan.sLo, row.phase), `row ${row.index} tile ${i} stands at a gate`).toBe(false);
          expect(f.st.tiles[i]).toBe(TILE_LOW);
          expect(f.st.terrain[i]).toBe(TERRAIN_FENCE);
        }
        for (const i of row.gates) expect(f.st.tiles[i], `row ${row.index} gate tile ${i} is open`).toBe(TILE_FLOOR);
      });
      // rows are 7-9 apart (the Viterbi's gap range) and the square leaves two neighbouring rows open round the gallows
      for (let k = 1; k < plan.baseRows.length; k++) {
        const gap = plan.baseRows[k] - plan.baseRows[k - 1];
        expect(gap, `base rows ${plan.baseRows[k - 1]} -> ${plan.baseRows[k]}`).toBeGreaterThanOrEqual(ROW_GAP_MIN);
        expect(gap).toBeLessThanOrEqual(ROW_GAP_MAX);
      }
      expect(plan.square).not.toBeNull();
      const sq = plan.square!;
      for (const row of plan.rows) {
        if (row.index !== sq.k && row.index !== sq.k + 1) continue;
        for (const i of row.tiles) {
          const s = c.axis === 0 ? i % w : Math.floor(i / w);
          expect(s >= plan.sLo + sq.s && s < plan.sLo + sq.s + 9, `row ${row.index} has fence inside the square`).toBe(false);
        }
      }
      // the gallows is a 3x3 wall block, a feature of its own
      const gal = feats.find((x) => x.kind === "gallows")!;
      expect(gal.jobs).toEqual(["landmark"]);
      expect(gal.p).toEqual([]);
      expect(gal.tiles).toBe(9);
      for (const i of plan.gallows) expect(f.st.tiles[i]).toBe(TILE_WALL);
      // the guard houses
      for (const house of feats.filter((x) => x.kind === "landmark")) {
        expect(house.variant).toBe("guardHouse");
        expect(house.jobs).toEqual(["landmark", "lee"]);
        const s = stampTemplate(GUARD_HOUSE, house.ax, house.ay, house.p[0] as 0 | 1 | 2 | 3, house.p[1] === 1, w, h)!;
        for (const i of s.walls) expect(f.st.tiles[i]).toBe(TILE_WALL);
        expect(house.p.slice(2)).toEqual(s.doors.slice().sort((p, q) => p - q));
      }
      // decor: chains, gate posts and lanterns beside the gates, the gallows prop
      const names = new Set(f.st.props.map((p) => ZONE_PROP_KINDS[p.kind].key));
      for (const key of ["chain", "gate_post", "lantern", "gallows", "banner", "stocks"]) expect(names.has(key), `a ${key} prop stands`).toBe(true);
      // a gate post stands on a fence tile at the foot of a gate, a lantern on floor beside it, stocks and banners inside a guard house
      for (const p of f.st.props) {
        const key = ZONE_PROP_KINDS[p.kind].key, tile = Math.floor(p.y / 32) * w + Math.floor(p.x / 32);
        if (key === "gate_post") expect(f.st.tiles[tile]).toBe(TILE_LOW);
        if (key === "lantern" || key === "stocks") expect(f.st.tiles[tile]).toBe(TILE_FLOOR);
        if (key === "banner" || key === "gallows") expect(f.st.tiles[tile]).toBe(TILE_WALL);
      }
    });
  }

  it("is deterministic and leaves tiles and terrain the same with decor off", () => {
    const run = (decor: boolean): { tiles: Uint8Array; terrain: Uint8Array; owner: Uint16Array; props: number } => {
      const f = fixture(120, 100, 50, 8, 114, 66);
      styleLandmarks(f.lm, { stylers: { [FACTION]: gallowsRows } });
      styleZones(f.st, { stylers: { [FACTION]: gallowsRows }, decor });
      return { tiles: f.st.tiles, terrain: f.st.terrain, owner: f.st.featureOwner!, props: f.st.props.length };
    };
    const a = run(true), b = run(true), c = run(false);
    expect(Buffer.from(a.tiles).equals(Buffer.from(b.tiles))).toBe(true);
    expect(Buffer.from(a.owner).equals(Buffer.from(b.owner))).toBe(true);
    expect(a.props).toBe(b.props);
    expect(a.props).toBeGreaterThan(0);
    expect(c.props).toBe(0);
    expect(Buffer.from(a.tiles).equals(Buffer.from(c.tiles))).toBe(true);
    expect(Buffer.from(a.terrain).equals(Buffer.from(c.terrain))).toBe(true);
  });

  it("builds a styler with other dials: period 10 and gate width 4 move the gates, fewer squares leave the rows whole", () => {
    const tilesOf = (styler: ZoneStyler<any>): { tiles: Uint8Array; gallows: number } => {
      const f = fixture(120, 100, 50, 8, 114, 66);
      styleLandmarks(f.lm, { stylers: { [FACTION]: styler } });
      const r = styleZones(f.st, { stylers: { [FACTION]: styler } });
      return { tiles: f.st.tiles, gallows: (r[0].plan as GallowsRowsPlan).gallows.length };
    };
    const base = tilesOf(gallowsRows);
    const p10 = tilesOf(makeGallows({ period: 10 })), w4 = tilesOf(makeGallows({ width: 4 })), none = tilesOf(makeGallows({ squares: 0 }));
    expect(Buffer.from(p10.tiles).equals(Buffer.from(base.tiles))).toBe(false);
    expect(Buffer.from(w4.tiles).equals(Buffer.from(base.tiles))).toBe(false);
    expect(none.gallows).toBe(0);
    expect(base.gallows).toBe(9);
  });
});

// ------------------------------------------------------------------------------------------------ the generator's maps
describe("the Rows on the generator's maps (50 seeds, only this styler new)", () => {
  it("never breaks the hook's contract, certifies every terrain rule, and is deterministic", () => {
    for (const s of SEEDS) {
      const { map } = mapOf(s);
      expect(validateTerrain(map, { styled: true }), `seed ${s}`).toEqual([]);
    }
    expect(MAPGEN_FAILS["A:styleBreach"] ?? 0).toBe(0);
    for (const s of [3, 11]) {
      const again = generateMap(s, undefined, { ...hooks(gallowsRows), shapeGates: false });
      expect(mapHash(again), `seed ${s}`).toBe(mapHash(mapOf(s).map));
    }
  }, HEAVY_MS);

  it("owns every wall and fence tile of its zone by a named feature of that zone, with no piece under 6 tiles and no single tile", () => {
    for (const s of SEEDS) {
      const { map } = mapOf(s);
      const { w, h } = map;
      const mask = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) mask[i] = map.regionGrid[i] === ZONE_CODE ? 1 : 0;
      const count = new Map<number, number>();
      for (let i = 0; i < w * h; i++) {
        if (!mask[i]) continue;
        const g = map.featureGrid[i];
        if (g > 0) count.set(g, (count.get(g) ?? 0) + 1);
        if (map.tiles[i] !== TILE_FLOOR) {
          expect(g, `seed ${s} tile ${i} (${map.tiles[i] === TILE_WALL ? "wall" : "fence"}) is owned`).toBeGreaterThan(0);
          const f = map.features[g - 1];
          expect(f.zone).toBe(FACTION);
          expect(["landmark", "gallows", "fenceRow", "infill"], `seed ${s} feature ${f.kind}`).toContain(f.kind);
          if (map.tiles[i] === TILE_LOW) expect(f.kind).toBe("fenceRow");
        }
      }
      for (const [g, n] of count) {
        const f = map.features[g - 1];
        expect(f.tiles, `seed ${s} feature ${g - 1} ${f.kind}`).toBe(n);
      }
      expect(pieceSizes(map.tiles, mask, w, h, TILE_WALL).filter((n) => n < 6), `seed ${s} wall pieces`).toEqual([]);
      expect(pieceSizes(map.tiles, mask, w, h, TILE_LOW).filter((n) => n < 6), `seed ${s} fence pieces`).toEqual([]);
      expect(fenceDetourViolations(map.tiles, map.terrain, mask, w, h), `seed ${s} fence detour`).toBe(0);
    }
  }, HEAVY_MS);

  it("lays rows, a gallows and guard houses: rows >= 6 on 95% of the seeds, fence 100-340, every row on the gate rule, the footprint under 13%", () => {
    let rowsOk = 0, houses1 = 0, houses2 = 0, gallows = 0, stretchOk = 0;
    for (const s of SEEDS) {
      const { map, plan } = mapOf(s);
      const feats = map.features.filter((f) => f.zone === FACTION);
      const rows = feats.filter((f) => f.kind === "fenceRow");
      if (rows.length >= 6) rowsOk++;
      const houses = feats.filter((f) => f.kind === "landmark").length;
      if (houses >= 1) houses1++;
      if (houses === 2) houses2++;
      if (feats.some((f) => f.kind === "gallows")) gallows++;
      let fence = 0, wall = 0, painted = 0;
      for (let i = 0; i < map.regionGrid.length; i++) {
        if (map.regionGrid[i] !== ZONE_CODE) continue;
        painted++;
        if (map.tiles[i] === TILE_LOW) fence++;
        else if (map.tiles[i] === TILE_WALL) wall++;
      }
      expect(fence, `seed ${s} fence tiles`).toBeGreaterThanOrEqual(100);
      expect(fence, `seed ${s} fence tiles`).toBeLessThanOrEqual(340);
      expect((100 * (fence + wall)) / painted, `seed ${s} footprint %`).toBeLessThanOrEqual(13);
      // p = [axis, rowIndex, phase]; one axis per zone; phase 2 / 8 by the row index
      for (const r of rows) {
        expect(r.p.length).toBe(3);
        expect(r.p[0]).toBe(plan.axis);
        expect(r.p[2]).toBe(r.p[1] % 2 === 0 ? 2 : 8);
      }
      for (const row of plan.rows) {
        for (const i of row.tiles) {
          const s2 = plan.axis === 0 ? i % map.w : Math.floor(i / map.w);
          expect(gallowsGateOpen(s2 - plan.sLo, row.phase), `seed ${s} row ${row.index}`).toBe(false);
        }
      }
      // the route guard's last word: under the styler threshold on nearly every seed (the contract accepts 1050; the generator's gate
      // drops the members beyond it)
      expect(plan.stretch, `seed ${s} route stretch`).toBeLessThanOrEqual(1050);
      if (plan.stretch <= ROUTE_STRETCH_MAX) stretchOk++;
    }
    expect(stretchOk / SEEDS.length, "seeds whose worst pool member's walk is stretched by at most 3%").toBeGreaterThanOrEqual(0.95);
    expect(rowsOk / SEEDS.length).toBeGreaterThanOrEqual(0.95);
    expect(houses1, "seeds with a guard house").toBe(SEEDS.length);
    expect(houses2 / SEEDS.length, "seeds with two guard houses").toBeGreaterThanOrEqual(0.9);
    expect(gallows, "seeds with the gallows").toBeGreaterThanOrEqual(Math.ceil(0.98 * SEEDS.length));
  }, HEAVY_MS);

  it("keeps the guard houses whole and 14 tiles apart: every wall stands, every door open, a crate nook next to a wall", () => {
    let twoHouses = 0;
    for (const s of SEEDS) {
      const { map } = mapOf(s);
      const houses = map.features.filter((f) => f.zone === FACTION && f.kind === "landmark");
      for (const house of houses) {
        const st = stampTemplate(GUARD_HOUSE, house.ax, house.ay, house.p[0] as 0 | 1 | 2 | 3, house.p[1] === 1, map.w, map.h)!;
        for (const i of st.walls) expect(map.tiles[i], `seed ${s}`).toBe(TILE_WALL);
        for (const i of [...st.doors, ...st.floor, ...st.nooks]) expect(map.tiles[i], `seed ${s}`).toBe(TILE_FLOOR);
        expect(map.buildings.some((b) => b.x === st.bbox.x && b.y === st.bbox.y && b.w === st.bbox.w && b.h === st.bbox.h), `seed ${s} building box`).toBe(true);
      }
      if (houses.length === 2) {
        twoHouses++;
        const [a, b] = houses.map((f) => f.bbox);
        const dx = (a.x + a.w / 2) - (b.x + b.w / 2), dy = (a.y + a.h / 2) - (b.y + b.h / 2);
        expect(Math.sqrt(dx * dx + dy * dy), `seed ${s} houses apart`).toBeGreaterThanOrEqual(14);
      }
    }
    expect(twoHouses).toBeGreaterThan(SEEDS.length / 2);
  }, HEAVY_MS);

  it("is the same map with decor off, and styles its zone alone: the other zones' stylers swapped for no-ops leave the Gallows zone byte-identical after the pass, and a no-op Gallows leaves the other zones so", () => {
    const noop = (faction: RegionFaction): ZoneStyler<unknown> => ({ id: "scorch", faction, version: 0, shape: () => null });
    const afterStyle = (s: number, attempt: number, styler: ZoneStyler<any>, others: Partial<Record<RegionFaction, ZoneStyler<any>>>): { tiles: Uint8Array; terrain: Uint8Array } => {
      let rec: { tiles: Uint8Array; terrain: Uint8Array } | null = null;
      // the landmark pass is always the Rows' (the pool and the protect the style pass sees stay the same)
      try { generateMap(s, attempt, { ...hooks(styler, undefined, others, (r) => { rec = r; }, gallowsRows), shapeGates: false }); } catch { /* a later stage may refuse a map with unstyled zones */ }
      if (!rec) throw new Error(`seed ${s}: the style pass did not run`);
      return rec;
    };
    for (const s of [2, 7, 13, 21]) {
      const { map } = mapOf(s);
      const plain = generateMap(s, undefined, { ...hooks(gallowsRows), shapeGates: false, decor: false });
      expect(mapHash(plain), `seed ${s} decor off`).toBe(mapHash(map));
      const mask = (i: number): boolean => map.regionGrid[i] === ZONE_CODE;
      const others: Partial<Record<RegionFaction, ZoneStyler<any>>> = {};
      for (const f of REGION_FACTIONS) if (f !== FACTION) others[f] = noop(f);
      const full = afterStyle(s, map.attempt, gallowsRows, {});
      const solo = afterStyle(s, map.attempt, gallowsRows, others);
      const gone = afterStyle(s, map.attempt, noop(FACTION), {});
      let styled = 0;
      for (let i = 0; i < full.tiles.length; i++) {
        if (mask(i)) {
          if (full.tiles[i] !== solo.tiles[i] || full.terrain[i] !== solo.terrain[i]) throw new Error(`seed ${s}: tile ${i} of the Gallows zone depends on another zone's styler`);
          if (full.tiles[i] !== gone.tiles[i]) styled++;
        } else if (full.tiles[i] !== gone.tiles[i] || full.terrain[i] !== gone.terrain[i]) {
          throw new Error(`seed ${s}: tile ${i} outside the Gallows zone depends on the Gallows styler`);
        }
      }
      expect(styled, `seed ${s}: the Gallows really changed its zone`).toBeGreaterThan(100);
    }
  }, HEAVY_MS);

  it("keeps every pool member's walk exactly as long in the \"open\" mode (no fence on a corridor), and in \"repair\" at most 3% longer", () => {
    const open = makeGallows({ route: "open" });
    let withMembers = 0;
    for (const s of SEEDS.slice(0, 12)) {
      const sink: Sink = { plan: null, results: [] };
      generateMap(s, undefined, { ...hooks(open, sink), shapeGates: false });
      expect(sink.plan!.stretch, `seed ${s}`).toBeLessThanOrEqual(1010);
      if (sink.plan!.stretch >= 1000 && sink.plan!.corridorOpened > 0) withMembers++;
    }
    expect(withMembers, "seeds where a corridor really kept a row open").toBeGreaterThanOrEqual(8);
  }, HEAVY_MS);

  it("never calls Math.random or an engine-approximated Math function: landmark pass, shape pass and props", () => {
    const names = [
      "random", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh",
      "exp", "expm1", "log", "log1p", "log2", "log10", "pow", "hypot", "cbrt",
    ] as const;
    const spies = names.map((n) => vi.spyOn(Math, n));
    const calls: Record<string, number> = {};
    try {
      for (const s of [40, 41, 42]) generateMap(s, undefined, { ...hooks(makeGallows({ route: "repair" })), shapeGates: false });
      names.forEach((n, i) => { calls[`Math.${n}`] = spies[i].mock.calls.length; });
    } finally {
      for (const sp of spies) sp.mockRestore();
    }
    expect(calls).toEqual(Object.fromEntries(names.map((n) => [`Math.${n}`, 0])));
  }, HEAVY_MS);
});

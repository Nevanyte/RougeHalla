// Sanctum: The Hypostyle (zone-shapes contract 4.5, WP5; zoneStyle/sanctum.ts `sanctum`). Three layers:
//  - the hall's tables and the shrine template, and the styler on small hand-built zones (a runtime on a grid, a stub route guard);
//  - the styler on generated maps: the generator is run with a pair of hooks that map the holy zone to the registry's styler and
//    leave the other four on the registry's too (`mapOf` swaps one for the isolation tests): ownership, whole piers, the
//    lattice, light, shrines, the acceptance windows of contract 4.5 / 8.4 over the first 50 seeds (WP5 ran 200 for its report),
//    attempts per seed, validateTerrain;
//  - isolation (another zone's styler changes nothing here and vice versa), determinism, decor off, and the Math spy.
import { describe, expect, it, vi } from "vitest";
import { MASK_SIGHT, REGION_FACTIONS, TILE_FLOOR, TILE_LOW, TILE_WALL } from "../src/map";
import type { GameMap, RegionFaction } from "../src/map";
import { raycast } from "../src/geometry";
import { MAPGEN_FAILS, certifiedMap, mapHash, tryAttempt } from "../src/mapgen";
import { findPath, pathLength } from "../src/pathfind";
import type { LandmarkHook, ZoneStyleHook } from "../src/styler";
import { TERRAIN_LIGHT, validateTerrain } from "../src/terrain";
import { TILE } from "../src/constants";
import { LANDMARKS_PER_ZONE, areaScale, styleLandmarks, styleZones } from "../src/zoneStyle";
import type { BaseCtx, CampInfo, RouteGuard, StyleCaps, ZoneStyler } from "../src/zoneStyle";
import { landmarkCtx, makeScratch, shapeCtx, surfaceCtx, ZoneRuntime, zoneInfoOf } from "../src/zoneStyle/context";
import { gabrielEdges, ROUTE_STRETCH_MAX } from "../src/zoneStyle/features";
import { stampTemplate, templateProblems } from "../src/zoneStyle/landmarks";
import { chamfer } from "../src/zoneStyle/kit";
import { HALL_PITCH, SANCTUM_TEMPLATES, SHRINE, hallAxis, hallLayout, hallRadius, sanctum } from "../src/zoneStyle/sanctum";
import type { SanctumPlan } from "../src/zoneStyle/sanctum";
import { ZONE_STYLE_CAPS, LANDMARK_CAPS } from "../src/zoneStyle/types";
import { ZONE_PROP_KINDS } from "../src/zoneStyle/propKinds";

const HEAVY_MS = 240_000;
const HOLY: RegionFaction = "holy";
const HOLY_CODE = REGION_FACTIONS.indexOf(HOLY) + 1;

// ------------------------------------------------------------------------------------------------ hooks for generated maps
/** The registry as hooks (`mapOf` names the holy zone's styler, the registry's by default): the others run whatever the registry has. */
function hooks(mapOf: (zone: RegionFaction) => ZoneStyler<unknown> | undefined = () => sanctum as ZoneStyler<unknown>): {
  style: ZoneStyleHook;
  landmarks: LandmarkHook;
  /** The holy zone's plan and styler result of the LAST style pass (the certified attempt's: the loop stops at it). */
  last: { plan: SanctumPlan | null; ms: number; landmarkMs: number; refused: number; repaired: number; joinChecks: number };
} {
  const last = { plan: null as SanctumPlan | null, ms: 0, landmarkMs: 0, refused: 0, repaired: 0, joinChecks: 0 };
  const stylers: Partial<Record<RegionFaction, ZoneStyler<unknown>>> = { holy: mapOf(HOLY) };
  const style: ZoneStyleHook = (st) => {
    const res = styleZones({
      w: st.w, h: st.h, seed: st.seed, attempt: st.attempt, tiles: st.tiles, terrain: st.terrain, props: st.props, zone: st.zone,
      zoneFaction: st.zoneFaction, protect: st.protect, territory: st.territoryGrid, camps: st.camps,
      spawns: st.spawns, centreWalk: st.centreWalk, features: st.features, featureOwner: st.featureOwner,
    }, { decor: st.decor, stylers });
    const r = res.find((x) => x.faction === HOLY)!;
    last.plan = r.plan as SanctumPlan;
    last.ms = r.ms; last.refused = r.refused; last.repaired = r.repaired; last.joinChecks = r.joinChecks;
  };
  const landmarks: LandmarkHook = (st) => {
    const res = styleLandmarks(st, { stylers });
    last.landmarkMs = res.find((x) => x.faction === HOLY)!.ms;
  };
  return { style, landmarks, last };
}

interface Built { seed: number; map: GameMap; plan: SanctumPlan; ms: number; landmarkMs: number }
const built = new Map<number, Built>();
function holyMap(seed: number): Built {
  let b = built.get(seed);
  if (!b) {
    const h = hooks();
    const map = certifiedMap(seed, { styleZones: h.style, landmarks: h.landmarks });
    if (!map) throw new Error(`seed ${seed} has no certified attempt`);
    b = { seed, map, plan: h.last.plan!, ms: h.last.ms, landmarkMs: h.last.landmarkMs };
    built.set(seed, b);
  }
  return b;
}
const SEEDS = Array.from({ length: 50 }, (_, i) => i);

// ------------------------------------------------------------------------------------------------ measures (contract 6.2)
function holyTiles(m: GameMap): Uint8Array {
  const out = new Uint8Array(m.tiles.length);
  for (let i = 0; i < out.length; i++) out[i] = m.regionGrid[i] === HOLY_CODE ? 1 : 0;
  return out;
}

/** 8-connected WALL pieces inside the zone: their sizes. */
function wallPieces(m: GameMap, zone: Uint8Array): number[] {
  const { w, h } = m;
  const seen = new Uint8Array(w * h), sizes: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!zone[s] || m.tiles[s] !== TILE_WALL || seen[s]) continue;
    const stack = [s];
    seen[s] = 1;
    let size = 0;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (m.tiles[j] === TILE_WALL && zone[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    sizes.push(size);
  }
  return sizes;
}

/** Share of rays that reach bow range (7.5 tiles): 24 directions from the zone FLOOR tiles with x and y a multiple of `step`, capped at 40 tiles. */
function bowRayShare(m: GameMap, zone: Uint8Array, step: number): number {
  const { w, h } = m;
  let n = 0, bow = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = y * w + x;
      if (!zone[i] || m.tiles[i] !== TILE_FLOOR) continue;
      const cx = (x + 0.5) * TILE, cy = (y + 0.5) * TILE;
      for (let k = 0; k < 24; k++) {
        const a = (k * 15 * Math.PI) / 180;
        const hit = raycast(m, cx, cy, cx + Math.cos(a) * 40 * TILE, cy + Math.sin(a) * 40 * TILE, MASK_SIGHT);
        n++;
        if (hit.dist >= 7.5 * TILE) bow++;
      }
    }
  }
  return n > 0 ? bow / n : 0;
}

/** Share of engagement pairs (zone FLOOR tiles 3-7.5 tiles apart, the contract's LCG) whose straight line a wall blocks. */
function blockedPairShare(m: GameMap, zone: Uint8Array, zoneIndex: number): number {
  const { w } = m;
  const floor: number[] = [];
  for (let i = 0; i < m.tiles.length; i++) if (zone[i] && m.tiles[i] === TILE_FLOOR) floor.push(i);
  let s = 12345 + 7 * zoneIndex;
  const next = (): number => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s; };
  let pairs = 0, blocked = 0;
  for (let draws = 0; pairs < 2500 && draws < 6000; draws++) {
    const a = floor[next() % floor.length], b = floor[next() % floor.length];
    const ax = a % w, ay = (a - ax) / w, bx = b % w, by = (b - bx) / w;
    const d = Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
    if (d < 3 || d > 7.5) continue;
    pairs++;
    if (raycast(m, (ax + 0.5) * TILE, (ay + 0.5) * TILE, (bx + 0.5) * TILE, (by + 0.5) * TILE, MASK_SIGHT).hit) blocked++;
  }
  return pairs > 0 ? blocked / pairs : 0;
}

/** Mean findPath / straight over the Gabriel graph of the zone's camps (the front door is not a camp-camp edge, so it is left out). */
function campStretch(m: GameMap): number {
  const camps = m.camps.filter((c) => c.zone === HOLY);
  const nodes = camps.map((c, k) => ({ x: Math.floor(c.x / TILE), y: Math.floor(c.y / TILE), kind: "camp" as const, camp: k, elite: c.eliteSpot >= 0 }));
  let sum = 0, count = 0;
  for (const [a, b] of gabrielEdges(nodes)) {
    const A = camps[a], B = camps[b];
    const path = findPath(m, { x: A.x, y: A.y }, { x: B.x, y: B.y });
    if (path.length === 0) continue;
    sum += pathLength({ x: A.x, y: A.y }, path) / Math.sqrt((A.x - B.x) * (A.x - B.x) + (A.y - B.y) * (A.y - B.y));
    count++;
  }
  return count > 0 ? sum / count : 1;
}

/** Mean distance (tiles) from the zone's camps to the nearest LIGHT tile. */
function nearestLight(m: GameMap): number {
  const lights: number[] = [];
  for (let i = 0; i < m.tiles.length; i++) if (m.regionGrid[i] === HOLY_CODE && m.terrain[i] === TERRAIN_LIGHT) lights.push(i);
  const camps = m.camps.filter((c) => c.zone === HOLY);
  if (lights.length === 0 || camps.length === 0) return 0;
  let sum = 0;
  for (const c of camps) {
    let best = Infinity;
    for (const l of lights) {
      const dx = (l % m.w) + 0.5 - c.x / TILE, dy = Math.floor(l / m.w) + 0.5 - c.y / TILE;
      best = Math.min(best, Math.sqrt(dx * dx + dy * dy));
    }
    sum += best;
  }
  return sum / camps.length;
}

const mean = (a: readonly number[]): number => (a.length === 0 ? 0 : a.reduce((p, q) => p + q, 0) / a.length);

// ------------------------------------------------------------------------------------------------ a runtime on a hand-built zone
interface Fixture {
  rt: ZoneRuntime;
  w: number;
  h: number;
  tiles: Uint8Array;
  terrain: Uint8Array;
  features: ZoneRuntime["init"]["features"];
  owner: Uint16Array;
}

/**
 * A `side` x `side` zone inside a wall border (the whole zone is the styler's), with `hard` tiles (protected) given as tile indices
 * of the zone, an optional route guard builder, and the guard caps of the shape pass (or the landmark pass).
 */
function fixture(side: number, opts: { hard?: readonly number[]; guard?: (c: BaseCtx) => RouteGuard; caps?: StyleCaps; camps?: CampInfo[] } = {}): Fixture {
  const w = side + 2, h = side + 2, n = w * h;
  const tiles = new Uint8Array(n).fill(TILE_WALL), terrain = new Uint8Array(n), mask = new Uint8Array(n), hard = new Uint8Array(n);
  for (let y = 1; y <= side; y++) for (let x = 1; x <= side; x++) { tiles[y * w + x] = TILE_FLOOR; mask[y * w + x] = 1; }
  for (const t of opts.hard ?? []) hard[(1 + Math.floor(t / side)) * w + 1 + (t % side)] = 1;
  const edgeDist = chamfer(mask, w, h);
  const info = zoneInfoOf(1, HOLY, mask, tiles, edgeDist, w, h);
  const features: ZoneRuntime["init"]["features"] = [];
  const owner = new Uint16Array(n);
  const caps: StyleCaps = opts.caps ?? { ...ZONE_STYLE_CAPS, rimTiles: 0, footprintPct: 100 };
  const rt = new ZoneRuntime({
    w, h, seed: 1, attempt: 0, info, mask, hard, noBlock: hard.slice(), noProp: hard, tiles, terrain, props: [], edgeDist, territory: null,
    camps: opts.camps ?? [], caps, scratch: makeScratch(n), wrote: new Uint8Array(n), propKinds: ZONE_PROP_KINDS, features, featureOwner: owner,
    spawns: [], centreWalk: null, routeGuard: opts.guard,
  });
  return { rt, w, h, tiles, terrain, features, owner };
}

/** The piers of a hall on a grid: tiles of the hall feature, as 3x3 blocks on the lattice of centre (cx, cy). Returns problems found. */
function latticeProblems(f: Fixture | { tiles: Uint8Array; w: number }, featureTiles: readonly number[], cx: number, cy: number, axis: 0 | 1): string[] {
  const out: string[] = [];
  const w = f.w;
  const cells = new Map<string, number>();
  for (const i of featureTiles) {
    const x = i % w, y = (i - x) / w;
    const u = axis === 0 ? x - cx : y - cy, v = axis === 0 ? y - cy : x - cx;
    // pier tiles lie at u0..u0+2 with u0 = 2 + 6i: (u - 2) mod 6 in 0..2 (floor modulo), same for v
    const mu = (((u - 2) % HALL_PITCH) + HALL_PITCH) % HALL_PITCH, mv = (((v - 2) % HALL_PITCH) + HALL_PITCH) % HALL_PITCH;
    if (mu > 2 || mv > 2) { out.push(`wall ${x},${y} is in an aisle (u ${u}, v ${v})`); continue; }
    const key = `${Math.floor((u - 2) / HALL_PITCH)},${Math.floor((v - 2) / HALL_PITCH)}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }
  for (const [key, count] of cells) if (count !== 9) out.push(`pier ${key} has ${count} tiles`);
  return out;
}

// ================================================================================================ templates and tables
describe("the shrine and the hall's tables", () => {
  it("the shrine is a valid landmark template in all 8 orientations (wall piece >= 6, 3-wide doors, connected, nooks) and is exported", () => {
    expect(templateProblems(SHRINE, { minNooks: 1 })).toEqual([]);
    expect(SANCTUM_TEMPLATES).toEqual([SHRINE]);
    expect(SHRINE.key).toBe("shrine");
    expect(SHRINE.jobs).toEqual(["landmark", "rest"]);
    const s = stampTemplate(SHRINE, 0, 0, 0, false, 20, 20)!;
    expect(s.walls.length).toBe(9 + 8 + 4 + 6); // top row, the sides of rows 1-4, row 5's corners, row 6's ends
    expect(s.doors.length).toBe(3);
    expect(s.lights.length).toBe(9);
    expect(s.nooks.length).toBe(2);
  });

  it("the radius is 13 at the reference zone, 19 at 136x136 (3534 tiles) and clamped to 11-19", () => {
    expect(hallRadius(1710)).toBe(13);
    expect(hallRadius(3534)).toBe(19);
    expect(hallRadius(3535)).toBe(19);
    expect(hallRadius(400)).toBe(11);
    expect(hallRadius(20_000)).toBe(19);
  });

  it("the offset tables: 32 piers and 9 bays at radius 19, 16 piers and 5 bays at 13; piers on the 6-lattice, every aisle 3 wide", () => {
    const big = hallLayout(19), ref = hallLayout(13);
    expect(big.piers.length).toBe(32);
    expect(big.bays.length).toBe(9);
    expect(ref.piers.length).toBe(16);
    expect(ref.bays.length).toBe(5);
    for (const l of [big, ref, hallLayout(11), hallLayout(16)]) {
      for (const [u0, v0] of l.piers) {
        expect((u0 - 2) % HALL_PITCH === 0).toBe(true);
        expect((v0 - 2) % HALL_PITCH === 0).toBe(true);
        expect((u0 + 1) ** 2 + (v0 + 1) ** 2).toBeLessThanOrEqual(l.r * l.r);
      }
      // symmetric about the centre crossing
      const set = new Set(l.piers.map(([u, v]) => `${u},${v}`));
      for (const [u0, v0] of l.piers) expect(set.has(`${-u0 - 2},${-v0 - 2}`), `${l.r}: mirror of ${u0},${v0}`).toBe(true);
      // the bays sit on crossings: multiples of 6, never inside a pier footprint
      for (const [u, v] of l.bays) {
        expect(u % HALL_PITCH === 0).toBe(true);
        expect(v % HALL_PITCH === 0).toBe(true);
        for (const [u0, v0] of l.piers) expect(u - 1 > u0 + 2 || u + 1 < u0 || v - 1 > v0 + 2 || v + 1 < v0, `bay ${u},${v} against pier ${u0},${v0}`).toBe(true);
      }
      // the floor region covers every footprint and the circle
      const floor = new Set(l.floor.map(([u, v]) => `${u},${v}`));
      for (const [u0, v0] of l.piers) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) expect(floor.has(`${u0 + a},${v0 + b}`)).toBe(true);
    }
  });

  it("the styler's identity: id sanctum, faction holy, version 400, with all four passes", () => {
    expect(sanctum.id).toBe("sanctum");
    expect(sanctum.faction).toBe("holy");
    expect(sanctum.version).toBe(400);
    expect(typeof sanctum.landmark).toBe("function");
    expect(typeof sanctum.shape).toBe("function");
    expect(typeof sanctum.surface).toBe("function");
    expect(typeof sanctum.props).toBe("function");
    expect(LANDMARKS_PER_ZONE).toBeGreaterThanOrEqual(2);
    expect(areaScale(3534)).toBeGreaterThan(2);
  });
});

// ================================================================================================ small zones
describe("the hall on hand-built zones", () => {
  it("fills an open 70x70 zone with 32 whole piers on the lattice of its centre: 288 wall tiles, 9 bays, one feature with p = [axis, 6, 19, 32, 9]", () => {
    const f = fixture(70);
    const plan = sanctum.shape(shapeCtx(f.rt)) as SanctumPlan;
    expect(plan.hall).toBe(true);
    expect(plan.radius).toBe(19);
    expect(plan.axis).toBe(hallAxis(f.rt.init.info));
    expect(plan.piers.length).toBe(32);
    expect(plan.planned).toBe(32);
    expect(f.rt.walls).toBe(288);
    expect(f.features.length).toBe(1);
    const feat = f.features[0];
    expect(feat.kind).toBe("hall");
    expect(feat.jobs).toEqual(["cover", "rest"]);
    expect(feat.ax).toBe(plan.cx);
    expect(feat.ay).toBe(plan.cy);
    expect(feat.p).toEqual([plan.axis, 6, 19, 32, 9]);
    const walls: number[] = [];
    for (let i = 0; i < f.tiles.length; i++) if (f.tiles[i] === TILE_WALL && f.rt.init.mask[i]) walls.push(i);
    expect(walls.length).toBe(288);
    expect(latticeProblems(f, walls, plan.cx, plan.cy, plan.axis)).toEqual([]);
    for (const i of walls) expect(f.owner[i]).toBe(1);
    // the centre crossing and the aisles stay floor and owned
    expect(f.tiles[plan.cy * f.w + plan.cx]).toBe(TILE_FLOOR);
    expect(f.owner[plan.cy * f.w + plan.cx]).toBe(1);
    // surface: nine bays, every tile of each 3x3
    const surf = surfaceCtx(f.rt);
    sanctum.surface!(surf, plan);
    expect(plan.lit.length).toBe(9);
    let light = 0;
    for (let i = 0; i < f.terrain.length; i++) if (f.terrain[i] === TERRAIN_LIGHT) { light++; expect(f.tiles[i]).toBe(TILE_FLOOR); }
    expect(light).toBe(81);
  });

  it("a hall off the axis x puts u along y when the zone leans that way", () => {
    // a tall zone: 40 wide, 90 high -> the major axis is y
    const w = 42, h = 92, n = w * h;
    const tiles = new Uint8Array(n).fill(TILE_WALL), mask = new Uint8Array(n);
    for (let y = 1; y <= 90; y++) for (let x = 1; x <= 40; x++) { tiles[y * w + x] = TILE_FLOOR; mask[y * w + x] = 1; }
    const edgeDist = chamfer(mask, w, h);
    const info = zoneInfoOf(1, HOLY, mask, tiles, edgeDist, w, h);
    expect(hallAxis(info)).toBe(1);
    const features: ZoneRuntime["init"]["features"] = [];
    const rt = new ZoneRuntime({
      w, h, seed: 1, attempt: 0, info, mask, hard: new Uint8Array(n), noBlock: new Uint8Array(n), noProp: new Uint8Array(n), tiles, terrain: new Uint8Array(n),
      props: [], edgeDist, territory: null, camps: [], caps: { ...ZONE_STYLE_CAPS, rimTiles: 0, footprintPct: 100 }, scratch: makeScratch(n), wrote: new Uint8Array(n),
      propKinds: ZONE_PROP_KINDS, features, featureOwner: new Uint16Array(n), spawns: [], centreWalk: null,
    });
    const plan = sanctum.shape(shapeCtx(rt)) as SanctumPlan;
    expect(plan.hall).toBe(true);
    expect(plan.axis).toBe(1);
    const walls: number[] = [];
    for (let i = 0; i < n; i++) if (tiles[i] === TILE_WALL && mask[i]) walls.push(i);
    expect(latticeProblems({ tiles, w }, walls, plan.cx, plan.cy, 1)).toEqual([]);
    expect(walls.length).toBe(9 * plan.piers.length);
  });

  it("never builds a partial pier: with protected tiles sprinkled over the zone every wall block is a whole pier and no protected tile is walled", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      let s = seed * 7919;
      const next = (): number => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s; };
      const hard: number[] = [];
      for (let t = 0; t < 70 * 70; t++) if (next() % 100 < 2 + seed) hard.push(t);
      const f = fixture(70, { hard });
      const plan = sanctum.shape(shapeCtx(f.rt)) as SanctumPlan;
      const walls: number[] = [];
      for (let i = 0; i < f.tiles.length; i++) if (f.tiles[i] === TILE_WALL && f.rt.init.mask[i]) walls.push(i);
      expect(walls.length, `seed ${seed}`).toBe(9 * plan.piers.length);
      expect(latticeProblems(f, walls, plan.cx, plan.cy, plan.axis), `seed ${seed}`).toEqual([]);
      for (const i of walls) expect(f.rt.init.hard[i], `seed ${seed} tile ${i}`).toBe(0);
      expect(plan.hall ? f.features[0].p[3] : 0, `seed ${seed}`).toBe(plan.piers.length);
    }
  });

  it("places two shrines whole, doors toward the hall, then a hall that keeps clear of them", () => {
    const f = fixture(70, { caps: { ...LANDMARK_CAPS, rimTiles: 0 } });
    sanctum.landmark!(landmarkCtx(f.rt));
    const shrines = f.features.filter((x) => x.kind === "landmark");
    expect(shrines.length).toBe(2);
    for (const s of shrines) {
      expect(s.variant).toBe("shrine");
      expect(s.zone).toBe(HOLY);
      expect(s.jobs).toEqual(["landmark", "rest"]);
      const st = stampTemplate(SHRINE, s.ax, s.ay, s.p[0] as 0 | 1 | 2 | 3, s.p[1] === 1, f.w, f.h)!;
      expect(s.bbox).toEqual(st.bbox);
      for (const i of st.walls) expect(f.tiles[i]).toBe(TILE_WALL);
      for (const list of [st.floor, st.doors, st.nooks, st.lights]) for (const i of list) { expect(f.tiles[i]).toBe(TILE_FLOOR); expect(f.owner[i]).not.toBe(0); }
      expect(s.p.slice(2)).toEqual(st.doors.slice().sort((a, b) => a - b));
    }
    // the gap rule between the two boxes
    const [a, b] = [shrines[0].bbox, shrines[1].bbox];
    expect(a.x - 3 < b.x + b.w && a.x + a.w + 3 > b.x && a.y - 3 < b.y + b.h && a.y + a.h + 3 > b.y).toBe(false);
    // the shape pass, now with the shrines in place and the box + 1 protected the way the generator protects it
    const n = f.w * f.h;
    for (const s of shrines) for (let y = s.bbox.y - 1; y <= s.bbox.y + s.bbox.h; y++) for (let x = s.bbox.x - 1; x <= s.bbox.x + s.bbox.w; x++) { f.rt.init.hard[y * f.w + x] = 1; f.rt.init.noBlock[y * f.w + x] = 1; }
    expect(n).toBeGreaterThan(0);
    const plan = sanctum.shape(shapeCtx(f.rt)) as SanctumPlan;
    expect(plan.hall).toBe(true);
    // each shrine faces the hall: its doors lie on the hall's side of the box centre
    for (const s of shrines) {
      const st = stampTemplate(SHRINE, s.ax, s.ay, s.p[0] as 0 | 1 | 2 | 3, s.p[1] === 1, f.w, f.h)!;
      const bx = s.bbox.x + (s.bbox.w - 1) / 2, by = s.bbox.y + (s.bbox.h - 1) / 2;
      let dx = 0, dy = 0;
      for (const i of st.doors) { dx += (i % f.w) - bx; dy += Math.floor(i / f.w) - by; }
      const toHall = (plan.cx - bx) * dx + (plan.cy - by) * dy;
      expect(toHall, `shrine at ${s.ax},${s.ay}`).toBeGreaterThan(0);
    }
  });

  describe("the route guard's stretch decides which piers stay (stub guards)", () => {
    /** A guard whose stretch is 1000 until a wall stands on its corridor band (or is asked about there) and `bad` permille while one does. */
    function stub(fx: () => Fixture, bad: number, band: (w: number) => number[], log: { calls: number }): (c: BaseCtx) => RouteGuard {
      return () => {
        const corridor = new Uint8Array(fx().w * fx().h);
        for (const i of band(fx().w)) corridor[i] = 1;
        return {
          members: [1], base: Int32Array.of(100), corridor,
          corridorOf: () => band(fx().w),
          worstStretch: (extra?: ArrayLike<number>) => {
            log.calls++;
            for (const i of band(fx().w)) if (fx().tiles[i] === TILE_WALL) return bad;
            if (extra) for (let k = 0; k < extra.length; k++) if (corridor[extra[k]]) return bad;
            return 1000;
          },
          worstMember: () => 0,
          touches: (t) => { for (let k = 0; k < t.length; k++) if (corridor[t[k]]) return true; return false; },
        };
      };
    }

    it("leaves every pier alone when the walks hold (one measurement), and thins the piers on a corridor when they do not", () => {
      // an open 70x70 zone; the corridor is a 3-wide band across the middle row (an aisle row when the lattice lines up, a cut otherwise)
      const band = (w: number): number[] => { const out: number[] = []; for (let y = 34; y <= 37; y++) for (let x = 5; x <= 66; x++) out.push(y * w + x); return out; };
      const calm = { calls: 0 };
      let fxRef!: Fixture;
      fxRef = fixture(70, { guard: stub(() => fxRef, 1000, band, calm) });
      const plan = sanctum.shape(shapeCtx(fxRef.rt)) as SanctumPlan;
      expect(plan.piers.length).toBe(32);
      expect(plan.measures).toBe(1);
      expect(plan.stretch).toBe(1000);
      expect(calm.calls).toBe(1);

      const tight = { calls: 0 };
      let fy!: Fixture;
      fy = fixture(70, { guard: stub(() => fy, 1100, band, tight) });
      const plan2 = sanctum.shape(shapeCtx(fy.rt)) as SanctumPlan;
      expect(plan2.hall).toBe(true);
      expect(plan2.piers.length).toBeLessThan(32);
      expect(plan2.piers.length).toBeGreaterThanOrEqual(4);
      expect(plan2.stretch).toBeLessThanOrEqual(ROUTE_STRETCH_MAX);
      // no wall on the band, and the piers that stand are still whole
      for (const i of band(fy.w)) expect(fy.tiles[i], `band tile ${i}`).toBe(TILE_FLOOR);
      const walls: number[] = [];
      for (let i = 0; i < fy.tiles.length; i++) if (fy.tiles[i] === TILE_WALL && fy.rt.init.mask[i]) walls.push(i);
      expect(walls.length).toBe(9 * plan2.piers.length);
      expect(latticeProblems(fy, walls, plan2.cx, plan2.cy, plan2.axis)).toEqual([]);
      // within the contract's budget of measurements
      expect(plan2.measures).toBeLessThanOrEqual(6);
      expect(tight.calls).toBeLessThanOrEqual(6);
      // the guard only ever saw trial walls it was given back: the feature log holds the one hall and the tile counters agree
      expect(fy.features.length).toBe(1);
      expect(fy.rt.walls).toBe(9 * plan2.piers.length);
    });

    it("falls back to every pier off every corridor when the stretch never comes down, and still reports a measurement", () => {
      const band = (w: number): number[] => { const out: number[] = []; for (let y = 30; y <= 40; y++) for (let x = 5; x <= 66; x++) out.push(y * w + x); return out; };
      const stuck = { calls: 0 };
      let fz!: Fixture;
      // a guard that always says 1200: no pruning can satisfy it
      fz = fixture(70, { guard: () => ({
        members: [1], base: Int32Array.of(100), corridor: (() => { const c = new Uint8Array(fz.w * fz.h); for (const i of band(fz.w)) c[i] = 1; return c; })(),
        corridorOf: () => band(fz.w), worstStretch: () => { stuck.calls++; return 1200; }, worstMember: () => 0, touches: () => false,
      }) });
      const plan = sanctum.shape(shapeCtx(fz.rt)) as SanctumPlan;
      expect(stuck.calls).toBeLessThanOrEqual(6);
      expect(plan.hall).toBe(true);
      // the fallback left the corridor band clear of piers
      for (const i of band(fz.w)) expect(fz.tiles[i]).toBe(TILE_FLOOR);
    });
  });
});

// ================================================================================================ generated maps
describe("the styler on generated maps (seeds 0-49, the five zone stylers)", () => {
  it("raises no breach, needs no repair, and every holy wall is owned by a hall or a shrine of the holy zone: no single tile, no wall piece under 6", () => {
    const breaches = MAPGEN_FAILS["A:styleBreach"] ?? 0;
    for (const s of SEEDS) {
      const { map: m } = holyMap(s);
      const zone = holyTiles(m);
      for (let i = 0; i < m.tiles.length; i++) {
        if (!zone[i] || (m.tiles[i] !== TILE_WALL && m.tiles[i] !== TILE_LOW)) continue;
        const o = m.featureGrid[i];
        expect(o, `seed ${s} tile ${i} unowned`).not.toBe(0);
        const f = m.features[o - 1];
        expect(f.zone, `seed ${s} tile ${i}`).toBe(HOLY);
        expect(["hall", "landmark"], `seed ${s} tile ${i} owned by ${f.kind}`).toContain(f.kind);
      }
      const sizes = wallPieces(m, zone);
      expect(Math.min(...sizes), `seed ${s} pieces ${sizes.join(",")}`).toBeGreaterThanOrEqual(6);
      // the zone has no LOW tile at all: the Sanctum builds walls and light
      for (let i = 0; i < m.tiles.length; i++) if (zone[i]) expect(m.tiles[i], `seed ${s} tile ${i}`).not.toBe(TILE_LOW);
    }
    expect(MAPGEN_FAILS["A:styleBreach"] ?? 0).toBe(breaches);
    const hooksOnce = hooks();
    const m = certifiedMap(SEEDS[7], { styleZones: hooksOnce.style, landmarks: hooksOnce.landmarks })!;
    expect(m).not.toBeNull();
    expect(hooksOnce.last.repaired, "the connectivity net gave tiles back").toBe(0);
  }, HEAVY_MS);

  it("the hall: one per map, its p record true, piers whole 3x3 on the lattice of its centre, aisles clear, every wall tile owned by it", () => {
    for (const s of SEEDS) {
      const { map: m, plan } = holyMap(s);
      const halls = m.features.filter((f) => f.zone === HOLY && f.kind === "hall");
      expect(halls.length, `seed ${s}`).toBe(1);
      const hall = halls[0], id = m.features.indexOf(hall) + 1;
      const painted = holyTiles(m).reduce((a, b) => a + b, 0);
      const axis = hall.p[0] as 0 | 1;
      expect(hall.jobs).toEqual(["cover", "rest"]);
      expect(hall.variant).toBe("");
      expect(hall.p[1]).toBe(6);
      expect(hall.p[2], `seed ${s} radius`).toBe(hallRadius(painted));
      const walls: number[] = [];
      for (let i = 0; i < m.tiles.length; i++) {
        if (m.featureGrid[i] !== id) continue;
        if (m.tiles[i] === TILE_WALL) walls.push(i);
        else expect(m.tiles[i], `seed ${s}: the hall owns only walls and floor`).toBe(TILE_FLOOR);
      }
      expect(walls.length, `seed ${s}: p[3] piers`).toBe(9 * hall.p[3]);
      expect(plan.piers.length).toBe(hall.p[3]);
      expect(latticeProblems(m, walls, hall.ax, hall.ay, axis), `seed ${s}`).toEqual([]);
      // light: only in bays of the hall, and the bay count p[4] is the bays with a lit tile
      const l = hallLayout(hall.p[2]);
      const litBays = new Set<number>();
      for (let i = 0; i < m.tiles.length; i++) {
        if (m.terrain[i] !== TERRAIN_LIGHT) continue;
        expect(m.regionGrid[i], `seed ${s} light outside the zone`).toBe(HOLY_CODE);
        const x = i % m.w, y = (i - x) / m.w;
        // a shrine's own light (its `l` tiles) belongs to the shrine, not to a bay
        if (m.features[m.featureGrid[i] - 1].kind === "landmark") continue;
        const u = axis === 0 ? x - hall.ax : y - hall.ay, v = axis === 0 ? y - hall.ay : x - hall.ax;
        const a = Math.round(u / 6), b = Math.round(v / 6);
        expect(Math.abs(u - 6 * a) <= 1 && Math.abs(v - 6 * b) <= 1, `seed ${s}: light at ${x},${y} is off every crossing`).toBe(true);
        const bay = l.bays.findIndex(([bu, bv]) => bu === 6 * a && bv === 6 * b);
        expect(bay, `seed ${s}: light at ${x},${y} is not in a bay`).toBeGreaterThanOrEqual(0);
        litBays.add(bay);
        expect(m.featureGrid[i], `seed ${s}: lit tile ${x},${y} belongs to the hall`).toBe(id);
      }
      expect(litBays.size, `seed ${s}: p[4]`).toBe(hall.p[4]);
      // the hall is never partial: the route guard's last measurement, when taken, held
      if (plan.stretch > 0) expect(plan.stretch, `seed ${s} stretch`).toBeLessThanOrEqual(ROUTE_STRETCH_MAX);
      expect(plan.measures).toBeLessThanOrEqual(6);
    }
  }, HEAVY_MS);

  it("the shrines: placed whole on at least 90% of the seeds (and two on most), doors true, outside the camps' clearings, and the crates take their nooks", () => {
    let withOne = 0, withTwo = 0, withCrate = 0, shrineLights = 0, shrineLit = 0;
    for (const s of SEEDS) {
      const { map: m } = holyMap(s);
      const shrines = m.features.filter((f) => f.zone === HOLY && f.kind === "landmark");
      expect(shrines.length).toBeLessThanOrEqual(LANDMARKS_PER_ZONE);
      if (shrines.length >= 1) withOne++;
      if (shrines.length === 2) withTwo++;
      // a crate stands on one of a shrine's nooks (the generator tries them first)
      const nooks = new Set<number>();
      for (const f of shrines) for (const i of stampTemplate(SHRINE, f.ax, f.ay, f.p[0] as 0 | 1 | 2 | 3, f.p[1] === 1, m.w, m.h)!.nooks) nooks.add(i);
      if (m.crateSpots.some((c) => nooks.has(Math.floor(c.y / TILE) * m.w + Math.floor(c.x / TILE)))) withCrate++;
      for (const f of shrines) {
        expect(f.variant).toBe("shrine");
        expect(f.jobs).toEqual(["landmark", "rest"]);
        const st = stampTemplate(SHRINE, f.ax, f.ay, f.p[0] as 0 | 1 | 2 | 3, f.p[1] === 1, m.w, m.h)!;
        expect(st, `seed ${s}`).not.toBeNull();
        for (const i of st.walls) expect(m.tiles[i], `seed ${s} shrine wall`).toBe(TILE_WALL);
        for (const list of [st.floor, st.doors, st.nooks, st.lights]) for (const i of list) {
          expect(m.tiles[i], `seed ${s} shrine floor`).toBe(TILE_FLOOR);
          expect(m.featureGrid[i], `seed ${s} shrine floor owner`).toBe(m.features.indexOf(f) + 1);
        }
        for (const i of st.lights) { shrineLights++; if (m.terrain[i] === TERRAIN_LIGHT) shrineLit++; }
        expect(f.p.slice(2)).toEqual(st.doors.slice().sort((a, b) => a - b));
        expect(m.buildings.some((b) => b.x === f.bbox.x && b.y === f.bbox.y && b.w === f.bbox.w && b.h === f.bbox.h), `seed ${s} building`).toBe(true);
        // a camp's clearing and its halo stay clear of the shrine's box
        for (const c of m.camps) {
          const cx = c.x / TILE, cy = c.y / TILE;
          const dx = Math.max(f.bbox.x - cx, 0, cx - (f.bbox.x + f.bbox.w)), dy = Math.max(f.bbox.y - cy, 0, cy - (f.bbox.y + f.bbox.h));
          expect(Math.sqrt(dx * dx + dy * dy), `seed ${s} shrine against ${c.id}`).toBeGreaterThan(c.r / TILE + 2);
        }
      }
    }
    console.info(`[sanctum] shrines: at least one on ${withOne} of ${SEEDS.length} seeds, two on ${withTwo}, a crate in a nook on ${withCrate}`);
    expect(withOne).toBeGreaterThanOrEqual(Math.ceil(0.9 * SEEDS.length));
    expect(withTwo).toBeGreaterThanOrEqual(Math.ceil(0.6 * SEEDS.length));
    expect(withCrate).toBeGreaterThanOrEqual(Math.ceil(0.6 * withOne));
    // the shrine's `l` tiles are lit: its box is no longer protect (its feature owns it), so the surface pass reaches them
    console.info(`[sanctum] shrine light: ${shrineLit} of ${shrineLights} tiles lit`);
    expect(shrineLights).toBeGreaterThan(0);
    expect(shrineLit / shrineLights).toBeGreaterThanOrEqual(0.95);
  }, HEAVY_MS);

  it("meets the acceptance windows of contract 4.5 (means over the 50 seeds): piers 18-30 and at least 14 on 95%, walls 200-330, light 60-100, rays at bow range 60-74%, blocked pairs >= 10%, camp stretch <= 1.10", () => {
    const piers: number[] = [], walls: number[] = [], light: number[] = [], rays: number[] = [], pairs: number[] = [], stretch: number[] = [], nearest: number[] = [], guard: number[] = [];
    for (const s of SEEDS) {
      const { map: m, plan } = holyMap(s);
      const zone = holyTiles(m);
      piers.push(plan.piers.length);
      let wl = 0, lt = 0;
      for (let i = 0; i < m.tiles.length; i++) if (zone[i]) { if (m.tiles[i] === TILE_WALL) wl++; if (m.terrain[i] === TERRAIN_LIGHT) lt++; }
      walls.push(wl);
      light.push(lt);
      rays.push(bowRayShare(m, zone, 4));
      pairs.push(blockedPairShare(m, zone, REGION_FACTIONS.indexOf(HOLY)));
      stretch.push(campStretch(m));
      nearest.push(nearestLight(m));
      guard.push(plan.stretch);
    }
    const lowPiers = piers.filter((p) => p < 14).length;
    console.info(
      `[sanctum] ${SEEDS.length} seeds: piers ${mean(piers).toFixed(1)} (min ${Math.min(...piers)}, under 14: ${lowPiers}), walls ${mean(walls).toFixed(0)}, light ${mean(light).toFixed(0)} ` +
      `(min ${Math.min(...light)}), rays>=7.5 ${(100 * mean(rays)).toFixed(1)}%, pairs blocked ${(100 * mean(pairs)).toFixed(1)}%, camp stretch ${mean(stretch).toFixed(3)}, ` +
      `nearest light ${mean(nearest).toFixed(1)} tiles, guard stretch max ${Math.max(...guard)}`,
    );
    expect(mean(piers)).toBeGreaterThanOrEqual(18);
    expect(mean(piers)).toBeLessThanOrEqual(30);
    expect(lowPiers).toBeLessThanOrEqual(Math.floor(0.05 * SEEDS.length) + 1);
    expect(Math.max(...piers)).toBeLessThanOrEqual(32);
    expect(mean(walls)).toBeGreaterThanOrEqual(200);
    expect(mean(walls)).toBeLessThanOrEqual(330);
    expect(mean(light)).toBeGreaterThanOrEqual(60);
    expect(mean(light)).toBeLessThanOrEqual(100);
    expect(mean(rays)).toBeGreaterThanOrEqual(0.6);
    expect(mean(rays)).toBeLessThanOrEqual(0.74);
    expect(mean(pairs)).toBeGreaterThanOrEqual(0.1);
    expect(mean(stretch)).toBeLessThanOrEqual(1.1);
    for (const g of guard) expect(g).toBeLessThanOrEqual(ROUTE_STRETCH_MAX);
  }, HEAVY_MS);

  it("certifies with validateTerrain (T1-T11) and costs the generator about one attempt per seed (50 seeds)", () => {
    let attempts = 0;
    for (const s of SEEDS) {
      const { map: m } = holyMap(s);
      expect(validateTerrain(m, { styled: true }), `seed ${s}`).toEqual([]);
      attempts += m.attempt + 1;
    }
    console.info(`[sanctum] attempts per seed: ${(attempts / SEEDS.length).toFixed(3)}`);
    expect(attempts / SEEDS.length).toBeLessThanOrEqual(1.15);
  }, HEAVY_MS);

  it("is fast: the shape + surface + props passes and the landmark pass, per call (a report; the bound on the median only catches a blow-up on a loaded machine)", () => {
    const shape = SEEDS.map((s) => holyMap(s).ms).sort((a, b) => a - b), lm = SEEDS.map((s) => holyMap(s).landmarkMs).sort((a, b) => a - b);
    const med = (a: readonly number[]): number => a[a.length >> 1];
    console.info(`[sanctum] styler mean ${mean(shape).toFixed(2)} ms per zone (median ${med(shape).toFixed(2)}, max ${shape[shape.length - 1].toFixed(2)}), landmark pass mean ${mean(lm).toFixed(2)} ms (median ${med(lm).toFixed(2)})`);
    // about 1.5 ms and 0.3 ms on a quiet machine; the bounds are 20x and 30x that
    expect(med(shape)).toBeLessThan(30);
    expect(med(lm)).toBeLessThan(10);
  });
});

// ================================================================================================ isolation, determinism, Math
describe("isolation, determinism and integer maths", () => {
  const noop: ZoneStyler<unknown> = { id: "sanctum", faction: HOLY, version: 0, shape: () => null };

  it("styles the zone alone: with the holy styler swapped for a no-op every other zone is byte-identical, and the new styler writes only holy tiles", () => {
    for (const s of [3, 8, 14, 21, 33, 40]) {
      const attempt = holyMap(s).map.attempt;
      const record = (holy: ZoneStyler<unknown>): { tiles: Uint8Array; terrain: Uint8Array; owner: Uint16Array; before: Uint8Array; zone: Uint8Array; faction: readonly RegionFaction[]; features: unknown[] } => {
        let out!: ReturnType<typeof record>;
        const h = hooks();
        const style: ZoneStyleHook = (st) => {
          const before = st.tiles.slice();
          styleZones({
            w: st.w, h: st.h, seed: st.seed, attempt: st.attempt, tiles: st.tiles, terrain: st.terrain, props: st.props, zone: st.zone,
            zoneFaction: st.zoneFaction, protect: st.protect, territory: st.territoryGrid, camps: st.camps,
            spawns: st.spawns, centreWalk: st.centreWalk, features: st.features, featureOwner: st.featureOwner,
          }, { decor: st.decor, stylers: { holy } });
          out = { tiles: st.tiles.slice(), terrain: st.terrain.slice(), owner: st.featureOwner.slice(), before, zone: st.zone.slice(), faction: st.zoneFaction, features: st.features.map((f) => structuredClone(f)) };
        };
        // the landmark pass is the new styler's in both runs, so the pool and the style state are the same
        generateOnce(s, attempt, style, h.landmarks);
        return out;
      };
      const withNew = record(sanctum as ZoneStyler<unknown>), withNoop = record(noop);
      const holyZone = withNew.faction.indexOf(HOLY) + 1;
      let holyChanged = 0;
      for (let i = 0; i < withNew.tiles.length; i++) {
        if (withNew.zone[i] === holyZone) { if (withNew.tiles[i] !== withNew.before[i] || withNew.terrain[i] !== 0) holyChanged++; continue; }
        expect(withNew.tiles[i], `seed ${s} tile ${i}`).toBe(withNoop.tiles[i]);
        expect(withNew.terrain[i], `seed ${s} terrain ${i}`).toBe(withNoop.terrain[i]);
        // the log numbers shift when the holy zone adds a feature before a later zone's, so compare the owning features themselves
        const a = withNew.owner[i], b = withNoop.owner[i];
        expect(a === 0, `seed ${s} owner ${i}`).toBe(b === 0);
        if (a !== 0) expect(withNew.features[a - 1], `seed ${s} owner ${i}`).toEqual(withNoop.features[b - 1]);
      }
      expect(holyChanged, `seed ${s}`).toBeGreaterThan(0);
    }
  }, HEAVY_MS);

  it("is deterministic and decor-blind: two builds hash equal, and with decor off tiles, terrain, features and ownership are the same", () => {
    for (const s of [2, 11, 26, 38]) {
      const a = holyMap(s).map;
      const h = hooks();
      const b = certifiedMap(s, { styleZones: h.style, landmarks: h.landmarks })!;
      expect(mapHash(b), `seed ${s}`).toBe(mapHash(a));
      expect(Buffer.from(b.tiles).equals(Buffer.from(a.tiles))).toBe(true);
      expect(b.features).toEqual(a.features);
      const h2 = hooks();
      const bare = certifiedMap(s, { styleZones: h2.style, landmarks: h2.landmarks, decor: false })!;
      expect(mapHash(bare), `seed ${s} decor off`).toBe(mapHash(a));
      expect(Buffer.from(bare.featureGrid).equals(Buffer.from(a.featureGrid))).toBe(true);
      expect(bare.props.length).toBe(0);
      // the decor itself: columns on the piers, candelabra in the bays, glass on the floor
      const kinds = new Set(a.props.map((p) => ZONE_PROP_KINDS[p.kind].key));
      expect(kinds.has("column_cap"), `seed ${s}`).toBe(true);
      expect(kinds.has("candelabra"), `seed ${s}`).toBe(true);
    }
  }, HEAVY_MS);

  it("never calls Math.random or an engine-approximated Math function: landmark, shape, surface and props passes through the generator, on a fresh module copy", async () => {
    const names = [
      "random", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh",
      "exp", "expm1", "log", "log1p", "log2", "log10", "pow", "hypot", "cbrt",
    ] as const;
    const spies = names.map((n) => vi.spyOn(Math, n));
    const calls: Record<string, number> = {};
    try {
      vi.resetModules();
      const fresh = await import("../src/mapgen");
      const zs = await import("../src/zoneStyle");
      const san = await import("../src/zoneStyle/sanctum");
      const stylers = { holy: san.sanctum as ZoneStyler<unknown> };
      const style: ZoneStyleHook = (st) => {
        zs.styleZones({
          w: st.w, h: st.h, seed: st.seed, attempt: st.attempt, tiles: st.tiles, terrain: st.terrain, props: st.props, zone: st.zone,
          zoneFaction: st.zoneFaction, protect: st.protect, territory: st.territoryGrid, camps: st.camps,
          spawns: st.spawns, centreWalk: st.centreWalk, features: st.features, featureOwner: st.featureOwner,
        }, { decor: st.decor, stylers });
      };
      const landmarks: LandmarkHook = (st) => { zs.styleLandmarks(st, { stylers }); };
      let halls = 0;
      for (const s of [70_100, 70_101, 70_102, 70_103, 70_104, 70_105]) {
        const m = fresh.certifiedMap(s, { styleZones: style, landmarks })!;
        if (m.features.some((f) => f.kind === "hall" && f.zone === HOLY)) halls++;
      }
      expect(halls).toBeGreaterThanOrEqual(5);
      names.forEach((n, i) => { calls[`Math.${n}`] = spies[i].mock.calls.length; });
    } finally {
      for (const sp of spies) sp.mockRestore();
    }
    expect(calls).toEqual(Object.fromEntries(names.map((n) => [`Math.${n}`, 0])));
  }, HEAVY_MS);
});

/** One attempt of `seed` with these hooks (the isolation test needs the same attempt twice). */
function generateOnce(seed: number, attempt: number, style: ZoneStyleHook, landmarks: LandmarkHook): GameMap | null {
  return tryAttempt(seed, attempt, { styleZones: style, landmarks });
}

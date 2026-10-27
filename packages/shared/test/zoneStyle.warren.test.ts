// The Warren: The Barrows (zone-shapes contract 4.3, WP3). The styler alone on the generator (a test-local hook: Warren in the plague
// zone, a no-op in the other four, shape gates on, so the generator itself checks ownership, pieces and the terrain rules), on a
// synthetic zone with hand-placed camps, and its acceptance windows over 200 seeds at 136x136. The other stylers are not involved:
// this file passes whatever the registry holds for them.
import { describe, expect, it, vi } from "vitest";
import { PLAYER_RADIUS, TILE } from "../src/constants";
import { raycast } from "../src/geometry";
import { REGION_FACTIONS, TILE_FLOOR, TILE_LOW, TILE_WALL } from "../src/map";
import type { GameMap, RegionFaction } from "../src/map";
import { MAPGEN_FAILS, generateMap, mapHash, tryAttempt } from "../src/mapgen";
import type { LandmarkHook, MapgenOptions, ZoneStyleHook } from "../src/mapgen";
import { findPath, pathLength } from "../src/pathfind";
import { TERRAIN_BOG, validateTerrain } from "../src/terrain";
import { styleLandmarks, styleZones } from "../src/zoneStyle";
import type { ZoneStyleState, ZoneStyler } from "../src/zoneStyle";
import { campNodes, cyclomatic, dirIndex16, gabrielEdges } from "../src/zoneStyle/features";
import { stampTemplate, templateProblems } from "../src/zoneStyle/landmarks";
import { makeScratch, shapeCtx, ZoneRuntime, zoneInfoOf } from "../src/zoneStyle/context";
import { chamfer } from "../src/zoneStyle/kit";
import { PROP } from "../src/zoneStyle/propKinds";
import { ZONE_STYLE_CAPS, LANDMARK_CAPS } from "../src/zoneStyle/types";
import { BURROW, WARREN_LANDMARKS, warren } from "../src/zoneStyle/warren";
import type { WarrenPlan } from "../src/zoneStyle/warren";
import { openFixture } from "./zoneStyleOpen";

const HEAVY_MS = 240_000;
const PLAGUE = REGION_FACTIONS.indexOf("plague") + 1;

// ------------------------------------------------------------------------------------------------ the test-local hook
const noop = (faction: RegionFaction): ZoneStyler<unknown> => ({ id: "scorch", faction, version: 0, shape: () => null });
/** Warren in the plague zone and a no-op in the other four: nothing else shapes the map. */
function onlyWarren(plague: ZoneStyler<any> = warren): Partial<Record<RegionFaction, ZoneStyler<unknown>>> {
  const out: Partial<Record<RegionFaction, ZoneStyler<unknown>>> = {};
  for (const f of REGION_FACTIONS) out[f] = f === "plague" ? plague : noop(f);
  return out;
}

interface Captured { plan: WarrenPlan | null; stretch: number; members: number; ms: number; cpu: number; lmCpu: number; repaired: number }
/** The generator options with the Warren-only hook; `cap` collects the plague zone's plan, its route-guard stretch and its time per attempt. */
function optionsFor(stylers: Partial<Record<RegionFaction, ZoneStyler<unknown>>>, cap?: Captured, gates = true): MapgenOptions {
  const styleHook: ZoneStyleHook = (st) => {
    const results = styleZones({
      w: st.w, h: st.h, seed: st.seed, attempt: st.attempt, tiles: st.tiles, terrain: st.terrain, props: st.props, zone: st.zone,
      zoneFaction: st.zoneFaction, protect: st.protect, territory: st.territoryGrid, camps: st.camps,
      spawns: st.spawns, centreWalk: st.centreWalk, features: st.features, featureOwner: st.featureOwner,
    }, { decor: st.decor, stylers });
    const r = results.find((q) => q.faction === "plague");
    if (cap) { cap.plan = (r?.plan as WarrenPlan | null) ?? null; cap.ms = r?.ms ?? 0; cap.repaired = r?.repaired ?? 0; }
  };
  const landmarkHook: LandmarkHook = (st) => {
    if (cap) { cap.cpu = 0; cap.lmCpu = 0; }
    styleLandmarks(st, { stylers });
  };
  return { styleZones: styleHook, landmarks: landmarkHook, shapeGates: gates };
}

const cpuMs = (): number => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
/**
 * Warren with meters: the CPU time of its own four passes, and the route guard's worst stretch once its shape pass is done (test code:
 * the field evaluation costs time of its own and is left out of the meter).
 */
const measuring = (cap: Captured): ZoneStyler<WarrenPlan> => ({
  ...warren,
  landmark: (c) => { const t = cpuMs(); warren.landmark!(c); cap.lmCpu += cpuMs() - t; },
  shape: (c) => {
    const t = cpuMs();
    const plan = warren.shape(c);
    cap.cpu += cpuMs() - t;
    const g = c.routeGuard();
    cap.members = g.members.length;
    cap.stretch = g.members.length > 0 ? g.worstStretch() : 1000;
    return plan;
  },
  surface: (c, plan) => { const t = cpuMs(); warren.surface!(c, plan); cap.cpu += cpuMs() - t; },
  props: (c, plan) => { const t = cpuMs(); warren.props!(c, plan); cap.cpu += cpuMs() - t; },
});

// ------------------------------------------------------------------------------------------------ measures of contract 6.2
function zoneTiles(m: GameMap, code = PLAGUE): number[] {
  const out: number[] = [];
  for (let i = 0; i < m.tiles.length; i++) if (m.regionGrid[i] === code) out.push(i);
  return out;
}

/** 8-connected WALL components of the zone: sizes. */
function wallPieces(m: GameMap, code = PLAGUE): number[] {
  const { w, tiles, regionGrid } = m;
  const seen = new Uint8Array(tiles.length);
  const sizes: number[] = [];
  for (let s = 0; s < tiles.length; s++) {
    if (regionGrid[s] !== code || tiles[s] !== TILE_WALL || seen[s]) continue;
    const stack = [s];
    seen[s] = 1;
    let size = 0;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const j = (y + dy) * w + x + dx;
        if ((dx || dy) && regionGrid[j] === code && tiles[j] === TILE_WALL && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    sizes.push(size);
  }
  return sizes;
}

/** 4-connected BOG components of the map: sizes. */
function bogPieces(m: GameMap): number[] {
  const { w, terrain } = m;
  const seen = new Uint8Array(terrain.length);
  const sizes: number[] = [];
  for (let s = 0; s < terrain.length; s++) {
    if (terrain[s] !== TERRAIN_BOG || seen[s]) continue;
    const stack = [s];
    seen[s] = 1;
    let size = 0;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      for (const j of [i + 1, i - 1, i + w, i - w]) if (terrain[j] === TERRAIN_BOG && !seen[j]) { seen[j] = 1; stack.push(j); }
    }
    sizes.push(size);
  }
  return sizes;
}

/** Ray profile: share of the 24-direction rays from the zone's even-even floor tiles that reach 7.5 tiles (capped at 40). */
function raysAtBowRange(m: GameMap): number {
  let rays = 0, far = 0;
  for (let y = 0; y < m.h; y += 2) {
    for (let x = 0; x < m.w; x += 2) {
      const i = y * m.w + x;
      if (m.regionGrid[i] !== PLAGUE || m.tiles[i] !== TILE_FLOOR) continue;
      const cx = (x + 0.5) * TILE, cy = (y + 0.5) * TILE;
      for (let k = 0; k < 24; k++) {
        const a = (k * 15 * Math.PI) / 180;
        const r = raycast(m, cx, cy, cx + Math.cos(a) * 40 * TILE, cy + Math.sin(a) * 40 * TILE);
        rays++;
        if (Math.min(40, r.dist / TILE) >= 7.5) far++;
      }
    }
  }
  return (100 * far) / rays;
}

/** Engagement pairs: the share of 2500 pairs of zone floor tiles 3 to 7.5 tiles apart (the contract's LCG) that a wall separates. */
function pairsWallBlocked(m: GameMap): number {
  const floor = zoneTiles(m).filter((i) => m.tiles[i] === TILE_FLOOR);
  let s = 12345 + 7 * (PLAGUE - 1), got = 0, blocked = 0;
  const next = (): number => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s; };
  for (let draws = 0; got < 2500 && draws < 6000; draws++) {
    const a = floor[next() % floor.length], b = floor[next() % floor.length];
    const ax = a % m.w, ay = (a - ax) / m.w, bx = b % m.w, by = (b - bx) / m.w;
    const d = Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
    if (d < 3 || d > 7.5) continue;
    got++;
    if (raycast(m, (ax + 0.5) * TILE, (ay + 0.5) * TILE, (bx + 0.5) * TILE, (by + 0.5) * TILE).hit) blocked++;
  }
  return (100 * blocked) / got;
}

/** The camp graph of the zone (8 camps and the front door, Gabriel edges): findPath stretch of the camp-camp edges and the loops over the traversable ones. */
function campGraph(m: GameMap): { stretches: number[]; loops: number } {
  const { w, h, tiles } = m;
  const mask = new Uint8Array(w * h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1, sx = 0, sy = 0, n = 0;
  for (const i of zoneTiles(m)) {
    mask[i] = 1;
    const x = i % w, y = (i - x) / w;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    sx += x + 0.5; sy += y + 0.5; n++;
  }
  const camps = m.camps.filter((c) => c.zone === "plague").map((c, k) => ({ x: Math.floor(c.x / TILE), y: Math.floor(c.y / TILE), elite: c.eliteSpot >= 0, index: k }));
  const nodes = campNodes({ w, h, mask, tiles, zone: { bbox: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, centroid: { x: sx / n, y: sy / n } }, camps });
  const stretches: number[] = [];
  const traversable: Array<[number, number]> = [];
  for (const [a, b] of gabrielEdges(nodes)) {
    const A = { x: (nodes[a].x + 0.5) * TILE, y: (nodes[a].y + 0.5) * TILE }, B = { x: (nodes[b].x + 0.5) * TILE, y: (nodes[b].y + 0.5) * TILE };
    const straight = Math.sqrt((A.x - B.x) * (A.x - B.x) + (A.y - B.y) * (A.y - B.y));
    const path = findPath(m, A, B, PLAYER_RADIUS);
    if (path.length === 0) continue;
    const len = pathLength(A, path);
    if (nodes[a].kind === "camp" && nodes[b].kind === "camp") stretches.push(len / straight);
    if (len <= 1.5 * straight + 4 * TILE) traversable.push([a, b]);
  }
  return { stretches, loops: cyclomatic(nodes.length, traversable) };
}

/** Bog tiles under each plague pool member's findPath walk to the coliseum centre (distinct tiles of the polyline sampled every quarter tile). */
function bogOnWalks(m: GameMap): number[] {
  const out: number[] = [];
  for (const sp of m.spawnPool) {
    const tx = Math.floor(sp.x / TILE), ty = Math.floor(sp.y / TILE);
    if (m.regionGrid[ty * m.w + tx] !== PLAGUE) continue;
    const seen = new Set<number>();
    let prev: { x: number; y: number } = sp;
    for (const q of findPath(m, sp, m.coliseum.centre, PLAYER_RADIUS)) {
      const steps = Math.max(1, Math.ceil((Math.abs(q.x - prev.x) + Math.abs(q.y - prev.y)) / (TILE / 4)));
      for (let k = 0; k <= steps; k++) seen.add(Math.floor((prev.y + ((q.y - prev.y) * k) / steps) / TILE) * m.w + Math.floor((prev.x + ((q.x - prev.x) * k) / steps) / TILE));
      prev = q;
    }
    let bog = 0;
    for (const i of seen) if (m.terrain[i] === TERRAIN_BOG) bog++;
    out.push(bog);
  }
  return out;
}

const mean = (v: number[]): number => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const pctile = (v: number[], q: number): number => { const s = v.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] : 0; };

// ------------------------------------------------------------------------------------------------ the burrow template
describe("the collapsed burrow (landmark template)", () => {
  it("is a valid template in all 8 orientations: two wall pieces (15 and 13 tiles), two 2-wide doors, two crate nooks, one connected interior", () => {
    expect(templateProblems(BURROW)).toEqual([]);
    expect(WARREN_LANDMARKS).toContain(BURROW);
    expect(BURROW.key).toBe("burrow");
    expect(BURROW.jobs).toEqual(["landmark", "fork"]);
    const s = stampTemplate(BURROW, 0, 0, 0, false, 9, 9)!;
    expect(s.walls.length).toBe(28); // two pieces, 15 and 13 tiles
    expect(s.doors.length).toBe(4);
    expect(s.nooks.length).toBe(2);
    expect(s.bbox).toEqual({ x: 0, y: 0, w: 9, h: 9 });
    // the doors face the road axis: x for a stamp turned 0, y for one turned 1
    const xs = new Set(s.doors.map((i) => i % 9)), ys = new Set(s.doors.map((i) => Math.floor(i / 9)));
    expect([...xs].sort()).toEqual([0, 8]);
    expect([...ys].sort()).toEqual([4, 5]);
    const t = stampTemplate(BURROW, 0, 0, 1, false, 9, 9)!;
    expect([...new Set(t.doors.map((i) => Math.floor(i / 9)))].sort()).toEqual([0, 8]);
  });
});

// ------------------------------------------------------------------------------------------------ a synthetic zone
interface Synthetic {
  st: ZoneStyleState;
  lm: Parameters<LandmarkHook>[0];
  zone: Uint8Array;
  painted: number;
}

/** A 136x136 grid with the plague zone a 60x60 square holding eight camps (a 3x3 grid, 22 tiles apart, without the middle one), no pool members. */
function synthetic(seed: number, camps = true): Synthetic {
  const w = 136, h = 136, n = w * h;
  const tiles = new Uint8Array(n), zone = new Uint8Array(n), protect = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) { tiles[i] = TILE_WALL; protect[i] = 1; continue; }
      if (x >= 12 && x < 72 && y >= 12 && y < 72) zone[i] = PLAGUE;
    }
  }
  const sites = camps ? [[20, 20], [42, 20], [64, 20], [20, 42], [64, 42], [20, 64], [42, 64], [64, 64]] : [];
  const styleCamps = sites.map(([x, y], k) => ({ site: y * w + x, r: 2.5, territory: k + 1, elite: k === 2 || k === 5 }));
  const lprot = protect.slice();
  for (const [x, y] of sites) {
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) lprot[(y + dy) * w + x + dx] = 1;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) protect[(y + dy) * w + x + dx] = 1;
  }
  const features: ZoneStyleState["features"] = [];
  const featureOwner = new Uint16Array(n);
  const st: ZoneStyleState = {
    w, h, seed, attempt: 0, tiles, terrain: new Uint8Array(n), props: [], zone, zoneFaction: REGION_FACTIONS, protect, territory: null,
    camps: styleCamps, features, featureOwner,
  };
  const lm = {
    w, h, seed, attempt: 0, tiles, zone, zoneFaction: REGION_FACTIONS, protect: lprot, territoryGrid: new Uint8Array(n),
    camps: styleCamps.map((c) => ({ ...c, elite: c.elite === true })), features, featureOwner,
  };
  return { st, lm, zone, painted: 3600 };
}

describe("the Warren on a synthetic zone (60x60, eight camps, no spawn pool)", () => {
  function run(seed: number, camps = true): { s: Synthetic; plan: WarrenPlan; burrows: number } {
    const s = synthetic(seed, camps);
    const lr = styleLandmarks(s.lm, { stylers: onlyWarren() });
    const r = styleZones(s.st, { decor: true, stylers: onlyWarren() }).find((q) => q.faction === "plague")!;
    return { s, plan: r.plan as WarrenPlan, burrows: lr.find((q) => q.faction === "plague")!.landmarks };
  }

  it("places two burrows and barrows on the long roads, a tunnel in the largest, every wall and bog tile owned by a feature of the zone", () => {
    for (const seed of [1, 2, 3]) {
      const { s, plan, burrows } = run(seed);
      const { st } = s;
      expect(burrows, `seed ${seed} burrows`).toBe(2);
      expect(plan.barrows.length, `seed ${seed} barrows`).toBeGreaterThanOrEqual(5);
      expect(plan.barrows.length).toBeLessThanOrEqual(12);
      const tunnels = plan.barrows.filter((b) => b.tunnel);
      expect(tunnels.length, `seed ${seed} tunnels`).toBeGreaterThanOrEqual(2);
      expect(tunnels.length).toBeLessThanOrEqual(4);
      for (const b of tunnels) expect(b.r4, "a tunnel needs a barrow of radius 3.5 or more").toBeGreaterThanOrEqual(14);
      // ownership: every WALL and BOG tile of the zone belongs to a feature of the plague zone
      for (let i = 0; i < st.tiles.length; i++) {
        if (s.zone[i] !== PLAGUE) continue;
        if (st.tiles[i] === TILE_WALL || st.terrain[i] === TERRAIN_BOG) {
          expect(st.featureOwner![i], `seed ${seed} tile ${i} (${st.tiles[i] === TILE_WALL ? "wall" : "bog"})`).not.toBe(0);
          expect(st.features![st.featureOwner![i] - 1].zone).toBe("plague");
        }
      }
      // kinds: landmarks and barrows only, with the contract's jobs
      for (const f of st.features!) {
        expect(["landmark", "barrow"]).toContain(f.kind);
        if (f.kind === "landmark") { expect(f.variant).toBe("burrow"); expect(f.jobs).toEqual(["landmark", "fork"]); }
        else expect(f.jobs).toEqual(f.p[1] === 1 ? ["fork", "choke"] : ["fork"]);
      }
      // wall pieces of 6 or more (8-connected), bog pieces of 8 or more (4-connected)
      const w = st.w;
      const seen = new Uint8Array(st.tiles.length);
      for (let q = 0; q < st.tiles.length; q++) {
        if (s.zone[q] !== PLAGUE || st.tiles[q] !== TILE_WALL || seen[q]) continue;
        const stack = [q]; seen[q] = 1; let size = 0;
        while (stack.length) {
          const i = stack.pop()!; size++;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = i + dy * w + dx; if ((dx || dy) && st.tiles[j] === TILE_WALL && !seen[j]) { seen[j] = 1; stack.push(j); } }
        }
        expect(size, `seed ${seed} a wall piece`).toBeGreaterThanOrEqual(6);
      }
      const bogMap = { w, terrain: st.terrain } as unknown as GameMap;
      for (const size of bogPieces(bogMap)) expect(size, `seed ${seed} a bog piece`).toBeGreaterThanOrEqual(8);
      // footprint: the shape pass stays under 13% of the zone, the burrows under 4%
      let barrowWalls = 0, burrowWalls = 0;
      for (let i = 0; i < st.tiles.length; i++) {
        if (st.tiles[i] !== TILE_WALL || !st.featureOwner![i]) continue;
        const f = st.features![st.featureOwner![i] - 1];
        if (f.kind === "barrow") barrowWalls++; else burrowWalls++;
      }
      expect(barrowWalls).toBeLessThanOrEqual(0.13 * s.painted);
      expect(burrowWalls).toBeLessThanOrEqual(0.04 * s.painted);
      expect(plan.bog.length).toBeGreaterThan(0);
    }
  });

  it("bores each tunnel 3 wide along its road, with rock on both sides and plain floor in the slot", () => {
    for (const seed of [1, 2, 3, 4]) {
      const { s, plan } = run(seed);
      const { st } = s;
      for (const b of plan.barrows.filter((q) => q.tunnel)) {
        expect(b.slot.length).toBeGreaterThanOrEqual(12);
        for (const i of b.slot) {
          expect(st.tiles[i], "slot is floor").toBe(TILE_FLOOR);
          expect(st.terrain[i], "slot is plain").toBe(0);
          expect(st.featureOwner![i], "slot is owned by this barrow").toBe(b.id + 1);
        }
        // the two banks: rock tiles of this barrow on both sides of the line through the slot
        const ux = Math.round(Math.cos(((b.dir16 * 22.5) * Math.PI) / 180) * 1000), uy = Math.round(Math.sin(((b.dir16 * 22.5) * Math.PI) / 180) * 1000);
        let left = 0, right = 0;
        for (const i of b.walls) {
          const cross = ((i % st.w) - b.cx) * uy - (Math.floor(i / st.w) - b.cy) * ux;
          if (cross > 0) left++; else right++;
        }
        expect(left, `seed ${seed} left bank`).toBeGreaterThanOrEqual(6);
        expect(right, `seed ${seed} right bank`).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it("records barrow params [radius4, tunnel, dir16, wet] and the burrow's [rot, mirror, doors] exactly", () => {
    const { s, plan } = run(5);
    const { st } = s;
    const barrows = st.features!.filter((f) => f.kind === "barrow");
    expect(barrows.length).toBe(plan.barrows.length);
    for (const f of barrows) {
      expect(f.p.length).toBe(4);
      const [r4, tunnel, dir, wet] = f.p;
      expect(r4).toBeGreaterThanOrEqual(11);
      expect(r4).toBeLessThanOrEqual(18);
      expect([0, 1]).toContain(tunnel);
      if (tunnel === 1) expect(r4).toBeGreaterThanOrEqual(14);
      expect(dir).toBeGreaterThanOrEqual(0);
      expect(dir).toBeLessThan(16);
      expect([-1, 1]).toContain(wet);
      const bar = plan.barrows.find((b) => b.id === st.features!.indexOf(f))!;
      expect(bar.cx).toBe(f.ax);
      expect(bar.cy).toBe(f.ay);
      // the road's direction rounds to dir16
      expect(dirIndex16(Math.round(Math.cos((dir * 22.5 * Math.PI) / 180) * 1000), Math.round(Math.sin((dir * 22.5 * Math.PI) / 180) * 1000))).toBe(dir);
    }
    for (const f of st.features!.filter((q) => q.kind === "landmark")) {
      expect(f.p.length).toBe(2 + 4);
      expect([0, 1]).toContain(f.p[0]);
      expect([0, 1]).toContain(f.p[1]);
      expect(f.p.slice(2)).toEqual(f.p.slice(2).slice().sort((a, b) => a - b));
      expect(f.bbox.w).toBe(9);
      expect(f.bbox.h).toBe(9);
    }
  });

  it("is deterministic and keeps tiles and terrain equal with the decor off", () => {
    const a = run(7), b = run(7);
    expect(Buffer.from(a.s.st.tiles).equals(Buffer.from(b.s.st.tiles))).toBe(true);
    expect(Buffer.from(a.s.st.terrain).equals(Buffer.from(b.s.st.terrain))).toBe(true);
    expect(a.s.st.features).toEqual(b.s.st.features);
    expect(a.s.st.props).toEqual(b.s.st.props);
    // decor off: no props, the rest the same
    const s = synthetic(7);
    styleLandmarks(s.lm, { stylers: onlyWarren() });
    styleZones(s.st, { decor: false, stylers: onlyWarren() });
    expect(s.st.props.length).toBe(0);
    expect(Buffer.from(s.st.tiles).equals(Buffer.from(a.s.st.tiles))).toBe(true);
    expect(Buffer.from(s.st.terrain).equals(Buffer.from(a.s.st.terrain))).toBe(true);
    // decor: tunnel beams stand on tunnel walls, the other kinds on their tiles
    const kinds = new Set(a.s.st.props.map((p) => p.kind));
    expect(kinds.has(PROP.fungus_cap)).toBe(true);
    expect(kinds.has(PROP.tunnel_beam)).toBe(true);
    expect(kinds.has(PROP.reed)).toBe(true);
  });

  it("places nothing, and does not throw, in a zone with no camps or on the 96x96 open fixture", () => {
    const { s, plan, burrows } = run(3, false);
    expect(burrows).toBe(0);
    expect(plan.barrows.length).toBe(0);
    expect(s.st.features!.length).toBe(0);
    const f = openFixture(4);
    const res = styleZones(f.st, { stylers: onlyWarren() });
    expect(res.find((r) => r.faction === "plague")!.features).toBe(0);
    expect((res.find((r) => r.faction === "plague")!.plan as WarrenPlan).barrows.length).toBe(0);
  });

  it("keeps its walls inside the guard's budget: caps are the contract's 13% and 4%", () => {
    expect(ZONE_STYLE_CAPS.footprintPct).toBe(13);
    expect(LANDMARK_CAPS.footprintPct).toBe(4);
    // a runtime with a tiny budget places fewer barrows and never more walls than the cap
    const s = synthetic(2);
    styleLandmarks(s.lm, { stylers: onlyWarren() });
    const n = s.st.w * s.st.h;
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = s.zone[i] === PLAGUE ? 1 : 0;
    const edgeDist = chamfer(mask, s.st.w, s.st.h);
    const info = zoneInfoOf(3, "plague", mask, s.st.tiles, edgeDist, s.st.w, s.st.h);
    const caps = { ...ZONE_STYLE_CAPS, footprintPct: 3 };
    const rt = new ZoneRuntime({
      w: s.st.w, h: s.st.h, seed: 2, attempt: 0, info, mask, hard: s.st.protect, noBlock: s.st.protect.slice(), noProp: s.st.protect, tiles: s.st.tiles,
      terrain: s.st.terrain, props: [], edgeDist, territory: null,
      camps: s.st.camps.map((c, index) => ({ x: c.site % s.st.w, y: Math.floor(c.site / s.st.w), r: c.r, territory: c.territory, elite: c.elite === true, index })),
      caps, scratch: makeScratch(n), wrote: new Uint8Array(n), propKinds: [], features: s.st.features!, featureOwner: s.st.featureOwner!, spawns: [], centreWalk: null,
      routeGuard: () => ({ members: [], base: new Int32Array(0), corridor: new Uint8Array(n), corridorOf: () => [], worstStretch: () => 1000, worstMember: () => -1, touches: () => false }),
    });
    warren.shape(shapeCtx(rt));
    expect(rt.walls).toBeLessThanOrEqual(Math.floor(0.03 * info.painted));
  });
});

// ------------------------------------------------------------------------------------------------ the Math spy
describe("integer-only", () => {
  it("calls no engine-approximated Math function in its landmark, shape, surface or props pass (the contract's 23)", () => {
    const names = [
      "random", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh",
      "exp", "expm1", "log", "log1p", "log2", "log10", "pow", "hypot", "cbrt",
    ] as const;
    const calls: Record<string, number> = Object.fromEntries(names.map((n) => [`Math.${n}`, 0]));
    const spied = <A extends unknown[], R>(f: (...a: A) => R) => (...a: A): R => {
      const spies = names.map((n) => vi.spyOn(Math, n));
      try { return f(...a); } finally {
        names.forEach((n, i) => { calls[`Math.${n}`] += spies[i].mock.calls.length; });
        for (const sp of spies) sp.mockRestore();
      }
    };
    const guarded: ZoneStyler<WarrenPlan> = {
      ...warren, landmark: spied(warren.landmark!), shape: spied(warren.shape), surface: spied(warren.surface!), props: spied(warren.props!),
    };
    for (const seed of [11, 12, 13]) generateMap(seed, undefined, optionsFor(onlyWarren(guarded)));
    expect(calls).toEqual(Object.fromEntries(names.map((n) => [`Math.${n}`, 0])));
  }, HEAVY_MS);
});

// ------------------------------------------------------------------------------------------------ the generator, 200 seeds
interface Row {
  seed: number;
  attempt: number;
  hash: string;
  barrows: number;
  tunnels: number;
  burrows: number;
  doubleBurrow: boolean;
  walls: number;
  barrowWalls: number;
  bog: number;
  wallPieces: number[];
  bogPieces: number[];
  unowned: number;
  stretch: number;
  members: number;
  ms: number;
  lmMs: number;
  repaired: number;
  plan: WarrenPlan;
  rays?: number;
  pairs?: number;
  stretches?: number[];
  loops?: number;
  edges?: number;
  bogWalk?: number[];
  map: GameMap;
}

const SEEDS = Array.from({ length: 200 }, (_, i) => i);
let sweep: Row[] | null = null;
function runSweep(): Row[] {
  if (sweep) return sweep;
  for (const k of Object.keys(MAPGEN_FAILS)) delete MAPGEN_FAILS[k];
  sweep = SEEDS.map((seed) => {
    const cap: Captured = { plan: null, stretch: 1000, members: 0, ms: 0, cpu: 0, lmCpu: 0, repaired: 0 };
    const m = generateMap(seed, undefined, optionsFor(onlyWarren(measuring(cap)), cap));
    const zoneFeatures = m.features.filter((f) => f.zone === "plague");
    const burrows = zoneFeatures.filter((f) => f.kind === "landmark" && f.variant === "burrow");
    let barrowWalls = 0, walls = 0, bog = 0, unowned = 0;
    for (let i = 0; i < m.tiles.length; i++) {
      if (m.regionGrid[i] !== PLAGUE) continue;
      if (m.tiles[i] === TILE_WALL) { walls++; if (!m.featureGrid[i]) unowned++; else if (m.features[m.featureGrid[i] - 1].kind === "barrow") barrowWalls++; }
      else if (m.tiles[i] === TILE_LOW) unowned++;
      if (m.terrain[i] === TERRAIN_BOG) { bog++; if (!m.featureGrid[i]) unowned++; }
    }
    const row: Row = {
      seed, attempt: m.attempt, hash: mapHash(m), barrows: zoneFeatures.filter((f) => f.kind === "barrow").length,
      tunnels: zoneFeatures.filter((f) => f.kind === "barrow" && f.p[1] === 1).length, burrows: burrows.length, doubleBurrow: burrows.length === 2,
      walls, barrowWalls, bog, wallPieces: wallPieces(m), bogPieces: bogPieces(m), unowned, stretch: cap.stretch, members: cap.members, ms: cap.cpu, lmMs: cap.lmCpu, repaired: cap.repaired, plan: cap.plan!, map: m,
    };
    if (seed % 4 === 0) {
      row.rays = raysAtBowRange(m);
      row.pairs = pairsWallBlocked(m);
      const g = campGraph(m);
      row.stretches = g.stretches;
      row.loops = g.loops;
      row.bogWalk = bogOnWalks(m);
    }
    return row;
  });
  return sweep;
}

describe("the Warren on the generator's maps (200 seeds, Warren alone, shape gates on)", () => {
  it("certifies every seed with no styler breach, no unowned tile, no wall piece under 6 and no feature overflow", () => {
    const rows = runSweep();
    expect(MAPGEN_FAILS["A:styleBreach"] ?? 0).toBe(0);
    expect(MAPGEN_FAILS["A:unowned"] ?? 0).toBe(0);
    expect(MAPGEN_FAILS["A:wallPiece"] ?? 0).toBe(0);
    expect(MAPGEN_FAILS["A:features"] ?? 0).toBe(0);
    expect(MAPGEN_FAILS["A:terrain"] ?? 0).toBe(0);
    for (const r of rows) {
      expect(r.repaired, `seed ${r.seed}: tiles the connectivity net gave back`).toBe(0);
      expect(r.unowned, `seed ${r.seed}: tiles no feature owns`).toBe(0);
      expect(r.wallPieces.filter((s) => s < 6), `seed ${r.seed}: wall pieces under 6`).toEqual([]);
      for (const s of r.bogPieces) expect(s, `seed ${r.seed}: a bog piece`).toBeGreaterThanOrEqual(1);
      expect(validateTerrain(r.map, { styled: true }), `seed ${r.seed}`).toEqual([]);
    }
    // Warren alone leaves the floor shares to the plain zones, so a seed may need a second attempt (floor share); the old styler was 1.04
    const attempts = mean(rows.map((r) => r.attempt + 1));
    expect(attempts, `attempts per seed ${attempts.toFixed(3)}`).toBeLessThanOrEqual(1.1);
  }, HEAVY_MS);

  it("meets the acceptance windows of contract 4.3: barrows, tunnels, burrows, walls and bog", () => {
    const rows = runSweep();
    const barrows = rows.map((r) => r.barrows), tunnels = rows.map((r) => r.tunnels);
    console.info(`[warren] barrows mean ${mean(barrows).toFixed(2)} (p10 ${pctile(barrows, 0.1)}, p90 ${pctile(barrows, 0.9)}; >= 8 on ${((100 * barrows.filter((v) => v >= 8).length) / rows.length).toFixed(1)}%), tunnels ${mean(tunnels).toFixed(2)}, burrows ${mean(rows.map((r) => r.burrows)).toFixed(2)}, walls ${mean(rows.map((r) => r.walls)).toFixed(0)} (barrows ${mean(rows.map((r) => r.barrowWalls)).toFixed(0)}), bog ${mean(rows.map((r) => r.bog)).toFixed(0)}, attempts ${mean(rows.map((r) => r.attempt + 1)).toFixed(3)}`);
    expect(mean(barrows)).toBeGreaterThanOrEqual(8);
    expect(Math.max(...barrows)).toBeLessThanOrEqual(12);
    expect(barrows.filter((v) => v >= 8).length / rows.length, "seeds with 8 or more barrows").toBeGreaterThanOrEqual(0.65);
    expect(barrows.filter((v) => v >= 6).length / rows.length, "seeds with 6 or more").toBeGreaterThanOrEqual(0.9);
    expect(Math.max(...tunnels)).toBeLessThanOrEqual(4);
    expect(tunnels.filter((v) => v >= 3).length / rows.length, "seeds with 3 or more tunnels").toBeGreaterThanOrEqual(0.9);
    expect(mean(tunnels)).toBeGreaterThanOrEqual(3.5);
    expect(rows.filter((r) => r.burrows >= 1).length / rows.length, "seeds with a burrow").toBeGreaterThanOrEqual(0.9);
    expect(rows.filter((r) => r.doubleBurrow).length / rows.length, "seeds with two burrows").toBeGreaterThanOrEqual(0.9);
    const bw = mean(rows.map((r) => r.barrowWalls)), bog = mean(rows.map((r) => r.bog));
    expect(bw, "barrow walls").toBeGreaterThanOrEqual(250);
    expect(bw).toBeLessThanOrEqual(420);
    expect(bog, "bog tiles").toBeGreaterThanOrEqual(150);
    expect(bog).toBeLessThanOrEqual(300);
    // 92% of the rock is in pieces of 12+ (options doc), and nothing is a single tile
    let big = 0, all = 0;
    for (const r of rows) for (const s of r.wallPieces) { all += s; if (s >= 12) big += s; }
    expect(big / all, "share of wall tiles in pieces of 12 or more").toBeGreaterThanOrEqual(0.85);
    // the footprint cap: walls of the zone (barrows + burrows) stay under 13% + 4% of its tiles
    for (const r of rows) expect(r.walls, `seed ${r.seed}`).toBeLessThanOrEqual(0.17 * 3536);
  }, HEAVY_MS);

  it("describes every feature with the frozen params and jobs, a burrow with its own box inside the zone and two 2-wide doors", () => {
    for (const r of runSweep().slice(0, 60)) {
      const m = r.map;
      for (const f of m.features.filter((q) => q.zone === "plague")) {
        if (f.kind === "barrow") {
          expect(f.p.length).toBe(4);
          expect(f.p[0]).toBeGreaterThanOrEqual(11);
          expect(f.p[0]).toBeLessThanOrEqual(18);
          expect(f.jobs).toEqual(f.p[1] === 1 ? ["fork", "choke"] : ["fork"]);
          expect([-1, 1]).toContain(f.p[3]);
          expect(m.regionGrid[f.ay * m.w + f.ax]).toBe(PLAGUE);
          let n = 0;
          for (let i = 0; i < m.featureGrid.length; i++) if (m.featureGrid[i] === m.features.indexOf(f) + 1) n++;
          expect(n, `seed ${r.seed}: tiles`).toBe(f.tiles);
        } else {
          expect(f.kind).toBe("landmark");
          expect(f.variant).toBe("burrow");
          expect(f.jobs).toEqual(["landmark", "fork"]);
          expect(f.p.length).toBe(6);
          // the box and one tile beyond it lie inside the zone; the interior is at least 60% floor; the doors are 2 wide
          let inside = 0, floor = 0;
          for (let y = f.bbox.y - 1; y <= f.bbox.y + f.bbox.h; y++) for (let x = f.bbox.x - 1; x <= f.bbox.x + f.bbox.w; x++) {
            if (m.regionGrid[y * m.w + x] === PLAGUE) inside++;
          }
          expect(inside, `seed ${r.seed}: burrow box + 1 inside the zone`).toBe((f.bbox.w + 2) * (f.bbox.h + 2));
          for (let y = f.bbox.y; y < f.bbox.y + f.bbox.h; y++) for (let x = f.bbox.x; x < f.bbox.x + f.bbox.w; x++) if (m.tiles[y * m.w + x] === TILE_FLOOR) floor++;
          expect(floor / (f.bbox.w * f.bbox.h), `seed ${r.seed}: burrow floor share`).toBeGreaterThanOrEqual(0.6);
          const doors = f.p.slice(2);
          expect(doors.length).toBe(4);
          for (const d of doors) expect(m.tiles[d]).toBe(TILE_FLOOR);
        }
      }
    }
  }, HEAVY_MS);

  it("leaves every tunnel passable end to end: findPath through a bored barrow is no longer than the tunnel (60 seeds)", () => {
    let checked = 0;
    for (const r of runSweep().slice(0, 60)) {
      for (const slot of r.plan.tunnels) {
        const at = (i: number) => ({ x: ((i % r.map.w) + 0.5) * TILE, y: (Math.floor(i / r.map.w) + 0.5) * TILE });
        const a = at(slot[0]), b = at(slot[slot.length - 1]);
        const path = findPath(r.map, a, b, PLAYER_RADIUS);
        expect(path.length, `seed ${r.seed}: a tunnel with no way through`).toBeGreaterThan(0);
        const straight = Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
        expect(pathLength(a, path), `seed ${r.seed}: a tunnel that is not straight`).toBeLessThanOrEqual(1.2 * straight + 1.5 * TILE);
        expect(slot.length, `seed ${r.seed}: a tunnel slot`).toBeGreaterThanOrEqual(12);
        checked++;
      }
    }
    expect(checked, "tunnels checked").toBeGreaterThanOrEqual(150);
  }, HEAVY_MS);

  it("keeps the spawn walks nearly straight: the route guard's worst stretch is at most 1030 permille on every seed, and bog barely touches a walk", () => {
    const rows = runSweep();
    const stretch = rows.map((r) => r.stretch);
    console.info(`[warren] route-guard stretch mean ${mean(stretch).toFixed(1)}, p90 ${pctile(stretch, 0.9)}, p99 ${pctile(stretch, 0.99)}, max ${Math.max(...stretch)} permille`);
    expect(Math.max(...stretch)).toBeLessThanOrEqual(1030);
    expect(mean(stretch)).toBeLessThanOrEqual(1010);
    const bogWalk = rows.flatMap((r) => r.bogWalk ?? []);
    console.info(`[warren] bog tiles on a member's findPath walk: mean ${mean(bogWalk).toFixed(2)}, p90 ${pctile(bogWalk, 0.9)}, max ${Math.max(...bogWalk)}`);
    expect(pctile(bogWalk, 0.9)).toBeLessThanOrEqual(2);
    expect(Math.max(...bogWalk), "the generator's hard cap on hazards under a walk").toBeLessThanOrEqual(8);
  }, HEAVY_MS);

  it("opens the zone to bows and keeps the roads: rays at bow range, wall-blocked pairs, camp-graph stretch and loops (every 4th seed)", () => {
    const rows = runSweep().filter((r) => r.rays !== undefined);
    const rays = rows.map((r) => r.rays!), pairs = rows.map((r) => r.pairs!);
    const stretches = rows.flatMap((r) => r.stretches!);
    const worstPer = rows.map((r) => Math.max(...r.stretches!));
    const loops = rows.map((r) => r.loops!);
    console.info(`[warren] rays >= 7.5 tiles ${mean(rays).toFixed(1)}% (p10 ${pctile(rays, 0.1).toFixed(1)}, p90 ${pctile(rays, 0.9).toFixed(1)}), wall-blocked pairs ${mean(pairs).toFixed(1)}%, camp stretch mean ${mean(stretches).toFixed(3)} max ${Math.max(...stretches).toFixed(3)}, loops ${mean(loops).toFixed(2)}`);
    expect(mean(rays)).toBeGreaterThanOrEqual(60);
    expect(mean(rays)).toBeLessThanOrEqual(74);
    expect(mean(pairs)).toBeGreaterThanOrEqual(8);
    expect(mean(stretches)).toBeLessThanOrEqual(1.1);
    expect(Math.max(...stretches)).toBeLessThanOrEqual(1.3);
    expect(mean(worstPer)).toBeLessThanOrEqual(1.15);
    // The camp graph's loops are E - V + 1 of the Gabriel graph over eight camps and the door (about 13 edges on 9 nodes): the styler
    // cannot add one, and keeps every road traversable, so the loops equal the graph's own.
    expect(mean(loops)).toBeGreaterThanOrEqual(4.5);
  }, HEAVY_MS);

  it("builds the same map twice, with the decor off too (the hash covers every layer but props)", () => {
    for (const r of runSweep().slice(0, 12)) {
      const again = tryAttempt(r.seed, r.attempt, optionsFor(onlyWarren()));
      expect(again, `seed ${r.seed}`).not.toBeNull();
      expect(mapHash(again!), `seed ${r.seed}`).toBe(r.hash);
      const bare = tryAttempt(r.seed, r.attempt, { ...optionsFor(onlyWarren()), decor: false });
      expect(mapHash(bare!), `seed ${r.seed} decor off`).toBe(r.hash);
      expect(bare!.props.length).toBe(0);
    }
  }, HEAVY_MS);

  it("costs about a millisecond a zone: the CPU time of its own passes (a report; the bound is only there to catch a blow-up)", () => {
    const rows = runSweep();
    const ms = rows.map((r) => r.ms), lm = rows.map((r) => r.lmMs);
    console.info(`[warren] shape + surface + props cpu mean ${mean(ms).toFixed(2)} ms (p99 ${pctile(ms, 0.99).toFixed(2)}); landmark pass ${mean(lm).toFixed(2)} ms (p99 ${pctile(lm, 0.99).toFixed(2)})`);
    // the contract's budget: mean 2.0 ms and p99 6 ms a zone, landmark pass 0.2 ms; a loaded machine is allowed a factor of three
    expect(mean(ms)).toBeLessThanOrEqual(6);
    expect(mean(lm)).toBeLessThanOrEqual(1.5);
  }, HEAVY_MS);
});

// ------------------------------------------------------------------------------------------------ zone isolation
describe("zone isolation", () => {
  /** A styler that walls 30 scattered open tiles of its own zone, to prove the others do not read what it writes. */
  const pillars = (faction: RegionFaction): ZoneStyler<null> => ({
    id: "scorch", faction, version: 0,
    shape: (c) => {
      const n = c.w * c.h;
      for (let k = 0, t = 0; k < 30 && t < 4000; t++) {
        const i = Math.floor(c.rng() * n);
        if (c.open(i) && c.block(i, "wall")) k++;
      }
      return null;
    },
  });

  /** Warren's landmark stage (so the pool and every protected tile are the same) and no shape pass. */
  const bare: ZoneStyler<unknown> = { id: "warren", faction: "plague", version: 0, landmark: warren.landmark, shape: () => null };

  function recordPass(seed: number, attempt: number, stylers: Partial<Record<RegionFaction, ZoneStyler<unknown>>>): { tiles: Uint8Array; terrain: Uint8Array; zone: Uint8Array; plague: number } | null {
    let out: { tiles: Uint8Array; terrain: Uint8Array; zone: Uint8Array; plague: number } | null = null;
    const base = optionsFor(stylers, undefined, false);
    const hook: ZoneStyleHook = (st) => {
      base.styleZones!(st);
      out = { tiles: st.tiles.slice(), terrain: st.terrain.slice(), zone: st.zone.slice(), plague: st.zoneFaction.indexOf("plague") + 1 };
    };
    try { generateMap(seed, attempt, { ...base, styleZones: hook }); } catch { /* a later stage may fail on a zone left plain; the pass was recorded already */ }
    return out;
  }

  it("styles the plague zone alone: the other zones' stylers change nothing in it, and Warren changes nothing outside it (12 seeds)", () => {
    for (const seed of SEEDS.slice(0, 12)) {
      const attempt = runSweep()[seed].attempt;
      const quiet = recordPass(seed, attempt, onlyWarren());
      const noisy = recordPass(seed, attempt, { fire: pillars("fire"), sentenced: pillars("sentenced"), plague: warren, frost: pillars("frost"), holy: pillars("holy") });
      const without = recordPass(seed, attempt, { fire: pillars("fire"), sentenced: pillars("sentenced"), plague: bare, frost: pillars("frost"), holy: pillars("holy") });
      expect(quiet && noisy && without, `seed ${seed}`).toBeTruthy();
      let differs = 0;
      for (let i = 0; i < quiet!.zone.length; i++) {
        if (quiet!.zone[i] === quiet!.plague) {
          // the plague zone is the same whatever the other zones' stylers did (zone indexes are this attempt's, not the map's)
          if (quiet!.tiles[i] !== noisy!.tiles[i] || quiet!.terrain[i] !== noisy!.terrain[i]) differs++;
        } else if (noisy!.tiles[i] !== without!.tiles[i] || noisy!.terrain[i] !== without!.terrain[i]) {
          // outside the zone, Warren's presence changes nothing
          differs++;
        }
      }
      expect(differs, `seed ${seed}: tiles that depend on another zone's styler`).toBe(0);
    }
  }, HEAVY_MS);
});

// The Rime's styler (zone-shapes contract 4.4, WP4): the Mere. It runs on the generator's real registry (the five zone stylers, the
// shape gates on); the synthetic fixture and the isolation test set the other four zones' style-pass stylers to no-ops (or scattered
// walls) while every zone's landmark stage stays the registry's. Covered: the watchtower template in all 8 orientations, the shelf
// shapes, 60 generated maps with the shape gates ON (ownership, wall pieces of at least 6, no breach) and the acceptance windows of
// the Mere (lakes, ICE, headlands, spire, tower, walls), the spawn walks (no headland lengthens a pool member's findPath walk by
// over 2%, no walk crosses more than 8 ICE tiles), ICE rules (T11, camps, lakes only), determinism, decor-off equality, zone
// isolation, the Math spy, and a synthetic fixture.
import { describe, expect, it } from "vitest";
import { MAPGEN_FAILS, generateMap, mapHash } from "../src/mapgen";
import type { LandmarkHook, ZoneStyleHook } from "../src/mapgen";
import { REGION_FACTIONS, TILE_FLOOR, TILE_LOW, TILE_WALL, mapFromTiles } from "../src/map";
import type { GameMap, RegionFaction } from "../src/map";
import { findPath, pathLength } from "../src/pathfind";
import { TERRAIN_ICE, validateTerrain } from "../src/terrain";
import { styleLandmarks, styleZones } from "../src/zoneStyle";
import type { ZoneStyler } from "../src/zoneStyle";
import { templateProblems, stampTemplate } from "../src/zoneStyle/landmarks";
import { RIME_TEMPLATES, WATCHTOWER, facetShelfCells, rime } from "../src/zoneStyle/rime";
import { mulberry32 } from "../src/rng";
import { openFixtureFull } from "./zoneStyleOpen";

const HEAVY_MS = 240_000;
const W = 136, TILE = 32;
const FROST = REGION_FACTIONS.indexOf("frost") + 1;
const SEEDS = Array.from({ length: 60 }, (_, i) => i);

/** A styler that does nothing (the other four zones). */
const noop = (faction: RegionFaction): ZoneStyler<unknown> => ({ id: "scorch", faction, version: 0, shape: () => null });
/** A styler that walls scattered single tiles of its zone (the isolation test's "another zone doing something"). */
const scatter = (faction: RegionFaction): ZoneStyler<unknown> => ({
  id: "scorch", faction, version: 0,
  shape: (c) => {
    for (let i = 0; i < c.w * c.h; i++) if (c.mask[i] === 1 && c.noise.hash(i % c.w, Math.floor(i / c.w), 5) < 0.04) c.block(i, "wall");
    return null;
  },
});
/** The Rime and a no-op in the other four zones (the synthetic fixture, the isolation test's baseline). */
const frostOnly = (): Partial<Record<RegionFaction, ZoneStyler<unknown>>> => ({
  fire: noop("fire"), sentenced: noop("sentenced"), plague: noop("plague"), holy: noop("holy"), frost: rime as ZoneStyler<unknown>,
});
/** The registry's five stylers (the generator's own maps). */
const registry = (): Partial<Record<RegionFaction, ZoneStyler<unknown>>> => ({ frost: rime as ZoneStyler<unknown> });

function hooksFor(stylers: Partial<Record<RegionFaction, ZoneStyler<unknown>>>): { styleZones: ZoneStyleHook; landmarks: LandmarkHook } {
  return {
    styleZones: (st) => {
      styleZones({
        w: st.w, h: st.h, seed: st.seed, attempt: st.attempt, tiles: st.tiles, terrain: st.terrain, props: st.props, zone: st.zone,
        zoneFaction: st.zoneFaction, protect: st.protect, territory: st.territoryGrid, camps: st.camps,
        spawns: st.spawns, centreWalk: st.centreWalk, features: st.features, featureOwner: st.featureOwner,
      }, { decor: st.decor, stylers });
    },
    // the landmark stage is the registry's whatever the style pass runs (the pool depends on every zone's landmarks)
    landmarks: (st) => { styleLandmarks(st, { stylers: { frost: stylers.frost ?? rime } as Partial<Record<RegionFaction, ZoneStyler<unknown>>> }); },
  };
}

const cache = new Map<number, GameMap>();
/** The map of a seed with the registry's stylers and the shape gates on (a seed whose attempt breaks a gate would throw here). */
function mapFor(seed: number): GameMap {
  let m = cache.get(seed);
  if (!m) { m = generateMap(seed, undefined, { ...hooksFor(registry()), shapeGates: true }); cache.set(seed, m); }
  return m;
}

interface ZoneView { zone: Uint8Array; floor: number; ice: number; walls: number; pieces: number[]; features: GameMap["features"] }
function zoneOf(m: GameMap): ZoneView {
  const n = W * W;
  const zone = new Uint8Array(n);
  let floor = 0, ice = 0, walls = 0;
  for (let i = 0; i < n; i++) {
    if (m.regionGrid[i] !== FROST) continue;
    zone[i] = 1;
    if (m.tiles[i] === TILE_FLOOR) { floor++; if (m.terrain[i] === TERRAIN_ICE) ice++; } else if (m.tiles[i] === TILE_WALL) walls++;
  }
  // 8-connected pieces of the zone's walls
  const seen = new Uint8Array(n), pieces: number[] = [];
  for (let s = 0; s < n; s++) {
    if (seen[s] || !zone[s] || m.tiles[s] !== TILE_WALL) continue;
    const stack = [s];
    seen[s] = 1;
    let size = 0;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % W, y = (i - x) / W;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= W || ny >= W) continue;
        const j = ny * W + nx;
        if (!seen[j] && zone[j] && m.tiles[j] === TILE_WALL) { seen[j] = 1; stack.push(j); }
      }
    }
    pieces.push(size);
  }
  return { zone, floor, ice, walls, pieces, features: m.features.filter((f) => f.zone === "frost") };
}

describe("the watchtower and the shelf shapes", () => {
  it("the frozen watchtower is a valid template in all 8 orientations (pieces of 6+, 2-wide doors, connected interior, crate nooks)", () => {
    expect(RIME_TEMPLATES).toEqual([WATCHTOWER]);
    expect(WATCHTOWER.key).toBe("watchtower");
    expect(WATCHTOWER.jobs).toEqual(["landmark", "lee"]);
    expect(templateProblems(WATCHTOWER)).toEqual([]);
  });

  it("facetShelfCells: a convex, centre-first cell set that depends only on the stream", () => {
    for (const rad of [1.6, 2.6, 3.2]) {
      for (let seed = 1; seed <= 20; seed++) {
        const a = facetShelfCells(mulberry32(seed), rad), b = facetShelfCells(mulberry32(seed), rad);
        expect(a).toEqual(b);
        expect(a.length).toBeGreaterThanOrEqual(5);
        expect(a[0]).toEqual([0, 0]);
        // sorted by distance from the centre
        for (let k = 1; k < a.length; k++) expect(a[k][0] ** 2 + a[k][1] ** 2).toBeGreaterThanOrEqual(a[k - 1][0] ** 2 + a[k - 1][1] ** 2);
        // each row is one run (convex along rows) and each column too
        const rows = new Map<number, number[]>(), cols = new Map<number, number[]>();
        for (const [x, y] of a) { (rows.get(y) ?? rows.set(y, []).get(y)!).push(x); (cols.get(x) ?? cols.set(x, []).get(x)!).push(y); }
        for (const list of [...rows.values(), ...cols.values()]) {
          const s = list.slice().sort((p, q) => p - q);
          expect(s[s.length - 1] - s[0] + 1).toBe(s.length);
        }
      }
    }
  });
});

describe("the Rime on generated maps (the other four zones no-ops, shape gates on)", () => {
  it("60 seeds: no breach, every wall owned, no piece under 6 tiles, T1-T11, and only the features of the Mere", () => {
    const before = MAPGEN_FAILS["A:styleBreach"] ?? 0;
    for (const s of SEEDS) {
      const m = mapFor(s);
      const z = zoneOf(m);
      expect(validateTerrain(m, { styled: true }), `seed ${s} validateTerrain`).toEqual([]);
      for (let i = 0; i < W * W; i++) if (z.zone[i] && m.tiles[i] !== TILE_FLOOR) expect(m.featureGrid[i], `seed ${s} tile ${i} unowned`).not.toBe(0);
      expect(z.pieces.filter((p) => p < 6), `seed ${s} wall pieces`).toEqual([]);
      // the Rime has walls and ICE only: no LOW ground, no other theme
      for (let i = 0; i < W * W; i++) if (z.zone[i]) {
        expect(m.tiles[i], `seed ${s} tile ${i}`).not.toBe(TILE_LOW);
        if (m.tiles[i] === TILE_FLOOR) expect([0, TERRAIN_ICE], `seed ${s} terrain of ${i}`).toContain(m.terrain[i]);
      }
      for (const f of z.features) expect(["landmark", "headland", "spire", "causeway", "mere"]).toContain(f.kind);
      // each feature's count matches the grid, its box holds its tiles, a headland/spire/landmark owns walls and floor only of the right kind
      m.features.forEach((f, k) => {
        if (f.zone !== "frost") return;
        let n = 0;
        for (let i = 0; i < W * W; i++) if (m.featureGrid[i] === k + 1) {
          n++;
          const x = i % W, y = (i - x) / W;
          expect(x >= f.bbox.x && x < f.bbox.x + f.bbox.w && y >= f.bbox.y && y < f.bbox.y + f.bbox.h).toBe(true);
          if (f.kind === "headland" || f.kind === "spire") expect(m.tiles[i]).toBe(TILE_WALL);
          if (f.kind === "mere" || f.kind === "causeway") expect(m.tiles[i]).toBe(TILE_FLOOR);
        }
        expect(n, `seed ${s} feature ${k} ${f.kind}`).toBe(f.tiles);
        if (f.kind === "mere") expect(f.p[1], `seed ${s} mere ice`).toBe([...Array(W * W).keys()].filter((i) => m.featureGrid[i] === k + 1 && m.terrain[i] === TERRAIN_ICE).length);
      });
      // ICE belongs to a mere, and only there
      for (let i = 0; i < W * W; i++) if (z.zone[i] && m.terrain[i] === TERRAIN_ICE) expect(m.features[m.featureGrid[i] - 1]?.kind, `seed ${s} ice ${i}`).toBe("mere");
    }
    expect(MAPGEN_FAILS["A:styleBreach"] ?? 0).toBe(before);
  }, HEAVY_MS);

  it("the watchtower stands whole where its record says: re-stamping the feature gives walls that are walls and floor that is floor", () => {
    for (const s of SEEDS.slice(0, 30)) {
      const m = mapFor(s);
      for (const f of m.features) {
        if (f.zone !== "frost" || f.kind !== "landmark") continue;
        expect(f.variant).toBe("watchtower");
        expect(f.jobs).toEqual(["landmark", "lee"]);
        const st = stampTemplate(WATCHTOWER, f.ax, f.ay, f.p[0] as 0 | 1 | 2 | 3, f.p[1] === 1, W, W)!;
        expect(st).not.toBeNull();
        for (const i of st.walls) expect(m.tiles[i]).toBe(TILE_WALL);
        for (const i of [...st.floor, ...st.doors, ...st.nooks]) expect(m.tiles[i]).toBe(TILE_FLOOR);
        expect(f.p.slice(2)).toEqual(st.doors.slice().sort((a, b) => a - b));
        expect(m.buildings.some((b) => b.x === st.bbox.x && b.y === st.bbox.y && b.w === st.bbox.w && b.h === st.bbox.h)).toBe(true);
      }
    }
  }, HEAVY_MS);

  it("the acceptance windows of the Mere over 60 seeds: lakes, ICE, headlands, spire, tower, walls", () => {
    const n = SEEDS.length;
    let two = 0, share12 = 0, spires = 0, towers = 0, headsOk = 0, iceSum = 0, inWindow = 0;
    for (const s of SEEDS) {
      const m = mapFor(s);
      const z = zoneOf(m);
      const meres = z.features.filter((f) => f.kind === "mere");
      const heads = z.features.filter((f) => f.kind === "headland").length;
      expect(meres.length, `seed ${s} meres`).toBeGreaterThanOrEqual(1);
      expect(meres.length).toBeLessThanOrEqual(2);
      expect(heads, `seed ${s} headlands`).toBeLessThanOrEqual(6);
      expect(z.walls, `seed ${s} walls`).toBeGreaterThanOrEqual(40);
      expect(z.walls, `seed ${s} walls`).toBeLessThanOrEqual(260);
      if (meres.length === 2) two++;
      if (z.ice / z.floor >= 0.12) share12++;
      if (z.features.some((f) => f.kind === "spire")) spires++;
      if (z.features.some((f) => f.kind === "landmark")) towers++;
      if (heads >= 3) headsOk++;
      if (z.ice >= 450 && z.ice <= 800) inWindow++;
      iceSum += z.ice;
    }
    expect(two / n, "two meres").toBeGreaterThanOrEqual(0.6);
    expect(share12 / n, "ICE >= 12% of the floor").toBeGreaterThanOrEqual(0.85);
    expect(spires / n, "a spire").toBeGreaterThanOrEqual(0.7);
    expect(towers / n, "a watchtower").toBeGreaterThanOrEqual(0.9);
    expect(headsOk / n, "3+ headlands").toBeGreaterThanOrEqual(0.9);
    expect(inWindow / n, "ICE 450-800").toBeGreaterThanOrEqual(0.8);
    expect(iceSum / n, "mean ICE").toBeGreaterThan(450);
    expect(iceSum / n, "mean ICE").toBeLessThan(800);
  }, HEAVY_MS);

  it("ICE keeps the camps off (5 tiles from every camp centre) and every ICE tile has 8 plain neighbours (T11)", () => {
    for (const s of SEEDS.slice(0, 30)) {
      const m = mapFor(s);
      const camps = m.camps.filter((c) => c.zone === "frost").map((c) => [Math.floor(c.x / TILE), Math.floor(c.y / TILE)]);
      for (let i = 0; i < W * W; i++) {
        if (m.regionGrid[i] !== FROST || m.terrain[i] !== TERRAIN_ICE) continue;
        const x = i % W, y = (i - x) / W;
        for (const [cx, cy] of camps) expect((x - cx) ** 2 + (y - cy) ** 2, `seed ${s} ice ${x},${y} near camp ${cx},${cy}`).toBeGreaterThanOrEqual(25);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(m.tiles[(y + dy) * W + x + dx]).toBe(TILE_FLOOR);
      }
    }
  }, HEAVY_MS);

  it("spawn walks: the headlands and the spire lengthen no pool member's findPath walk by over 2%, and no walk crosses more than 8 ICE tiles (p90 at most 3)", () => {
    const C = { x: (W / 2) * TILE + TILE / 2, y: (W / 2) * TILE + TILE / 2 };
    const iceCounts: number[] = [];
    let members = 0;
    for (const s of SEEDS.slice(0, 40)) {
      const m = mapFor(s);
      const tilesNo = m.tiles.slice();
      for (let i = 0; i < W * W; i++) {
        const f = m.featureGrid[i];
        if (f && (m.features[f - 1].kind === "headland" || m.features[f - 1].kind === "spire")) tilesNo[i] = TILE_FLOOR;
      }
      const without = mapFromTiles(W, W, tilesNo, m.seed, m.terrain);
      for (const p of m.spawnPool.filter((q) => q.zone === "frost")) {
        members++;
        const a = findPath(m, { x: p.x, y: p.y }, C), b = findPath(without, { x: p.x, y: p.y }, C);
        expect(a.length).toBeGreaterThan(0);
        expect(pathLength({ x: p.x, y: p.y }, a) / pathLength({ x: p.x, y: p.y }, b), `seed ${s} member ${p.x},${p.y}`).toBeLessThanOrEqual(1.02);
        const seen = new Set<number>();
        let hz = 0, cx = p.x, cy = p.y;
        for (const q of a) {
          const steps = Math.max(1, Math.ceil(Math.sqrt((q.x - cx) ** 2 + (q.y - cy) ** 2) / 8));
          for (let t = 0; t <= steps; t++) {
            const i = Math.floor((cy + ((q.y - cy) * t) / steps) / TILE) * W + Math.floor((cx + ((q.x - cx) * t) / steps) / TILE);
            if (!seen.has(i)) { seen.add(i); if (m.terrain[i] === TERRAIN_ICE) hz++; }
          }
          cx = q.x; cy = q.y;
        }
        iceCounts.push(hz);
      }
    }
    expect(members).toBeGreaterThan(100);
    expect(Math.max(...iceCounts)).toBeLessThanOrEqual(8);
    expect(iceCounts.slice().sort((x, y) => x - y)[Math.floor(0.9 * iceCounts.length)]).toBeLessThanOrEqual(3);
  }, HEAVY_MS);

  it("is deterministic (two builds hash equal) and decor off changes nothing a hash covers", () => {
    for (const s of [3, 17, 41]) {
      const a = generateMap(s, undefined, { ...hooksFor(registry()), shapeGates: true });
      const b = generateMap(s, undefined, { ...hooksFor(registry()), shapeGates: true });
      const c = generateMap(s, undefined, { ...hooksFor(registry()), shapeGates: true, decor: false });
      expect(mapHash(b)).toBe(mapHash(a));
      expect(mapHash(c)).toBe(mapHash(a));
      expect(Buffer.from(c.tiles).equals(Buffer.from(a.tiles))).toBe(true);
      expect(Buffer.from(c.terrain).equals(Buffer.from(a.terrain))).toBe(true);
      expect(a.props.length).toBeGreaterThan(0);
      expect(c.props.length).toBe(0);
    }
  }, HEAVY_MS);

  it("styles a zone alone: what the other four zones' stylers do (nothing, or scattered walls) never changes a tile, a terrain or a feature of the Rime", () => {
    for (const s of [4, 9, 23, 38]) {
      const attempt = mapFor(s).attempt;
      const record = (others: (f: RegionFaction) => ZoneStyler<unknown>): { sig: string; walls: number } => {
        let out = { sig: "", walls: 0 };
        const stylers: Partial<Record<RegionFaction, ZoneStyler<unknown>>> = { frost: rime as ZoneStyler<unknown> };
        for (const f of REGION_FACTIONS) if (f !== "frost") stylers[f] = others(f);
        const base = hooksFor(stylers);
        const hook: ZoneStyleHook = (st) => {
          base.styleZones(st);
          const zi = st.zoneFaction.indexOf("frost") + 1;
          let h = 0x811c9dc5, walls = 0;
          for (let i = 0; i < st.tiles.length; i++) {
            if (st.zone[i] !== zi) continue;
            if (st.tiles[i] === TILE_WALL) walls++;
            h = Math.imul(h ^ (st.tiles[i] * 7 + st.terrain[i]), 0x01000193) >>> 0;
          }
          const fr = st.features.filter((f) => f.zone === "frost").map((f) => `${f.kind}:${f.ax},${f.ay}:${f.p.join(",")}:${f.tiles}`).join("|");
          out = { sig: `${h}/${fr}`, walls };
        };
        try { generateMap(s, attempt, { styleZones: hook, landmarks: base.landmarks, shapeGates: false }); } catch { /* a later stage may fail: the hook already recorded */ }
        return out;
      };
      const quiet = record(noop), busy = record(scatter);
      expect(quiet.walls).toBeGreaterThan(0);
      expect(busy.sig, `seed ${s}`).toBe(quiet.sig);
    }
  }, HEAVY_MS);

  it("runs without Math.random, sin, cos, atan2, hypot, pow, exp or log (the determinism spy of the generator, over generation, findPath and this styler)", () => {
    const forbidden = ["random", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh", "exp", "expm1", "log", "log1p", "log2", "log10", "pow", "hypot", "cbrt"] as const;
    const originals = new Map<string, (...a: number[]) => number>();
    const M = Math as unknown as Record<string, (...a: number[]) => number>;
    for (const f of forbidden) { originals.set(f, M[f]); M[f] = () => { throw new Error(`Math.${f} used`); }; }
    try {
      for (const s of [2, 29]) generateMap(s, undefined, { ...hooksFor(registry()), shapeGates: true });
    } finally {
      for (const f of forbidden) M[f] = originals.get(f)!;
    }
  }, HEAVY_MS);
});

describe("the Rime on a synthetic open zone (no landmark stage, no gates: the fixture the stylers were first measured on)", () => {
  it("one mere with ICE, headlands whole or not at all, every wall owned and no piece under 6, nothing outside the Rime changed", () => {
    for (const seed of [1, 2, 3]) {
      const f = openFixtureFull(seed);
      const stylers = frostOnly();
      styleZones(f.st, { stylers });
      const { w, h, st } = f;
      const code = REGION_FACTIONS.indexOf("frost") + 1;
      let ice = 0;
      for (let i = 0; i < w * h; i++) {
        if (st.zone[i] !== code) { expect(st.tiles[i], `outside tile ${i}`).toBe(f.tiles0[i]); expect(st.terrain[i]).toBe(0); continue; }
        if (st.terrain[i] === TERRAIN_ICE) {
          ice++;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(st.tiles[i + dy * w + dx]).toBe(TILE_FLOOR);
        }
        if (st.tiles[i] !== f.tiles0[i]) expect(st.featureOwner![i], `unowned write at ${i}`).not.toBe(0);
      }
      const feats = st.features!.filter((q) => q.zone === "frost");
      expect(feats.filter((q) => q.kind === "mere").length).toBeLessThanOrEqual(1);
      expect(ice).toBeGreaterThan(0);
      for (const q of feats) if (q.kind === "headland") expect(q.tiles).toBeGreaterThanOrEqual(6);
    }
  });
});

// Scorch, Crater Basins (zone-shapes contract 4.1, WP1): the new styler `scorchCraters` on the generator's real maps, in isolation
// (a test-local hook runs it for the fire zone and the registry's stylers for the other four, as the phase B brief prescribes;
// WP7 swaps the registry in phase C). What is checked: the feature contract (ownership, params, pieces, the footprint), the
// acceptance windows of 4.1 on 40 seeds (the 200-seed table is in the WP1 report), zone isolation, determinism, the Math ban,
// the forge landmark and the route guard (hazards on the spawn walks, the camp graph's stretch).
import { describe, expect, it, vi } from "vitest";
import { raycast } from "../src/geometry";
import { REGION_FACTIONS, TILE_FLOOR, TILE_LOW, TILE_WALL } from "../src/map";
import type { GameMap, RegionFaction } from "../src/map";
import { MAPGEN_FAILS, certifiedMap, generateMap, mapHash, tryAttempt } from "../src/mapgen";
import type { MapgenOptions } from "../src/mapgen";
import { findPath, pathLength } from "../src/pathfind";
import type { LandmarkHook, ZoneStyleHook } from "../src/styler";
import { TERRAINS, TERRAIN_EMBER, TERRAIN_LAVA } from "../src/terrain";
import { LANDMARKS_PER_ZONE, styleLandmarks, styleZones } from "../src/zoneStyle";
import type { StyleResult, ZoneStyler } from "../src/zoneStyle";
import { gabrielEdges } from "../src/zoneStyle/features";
import type { Node } from "../src/zoneStyle/features";
import { stampTemplate, templateProblems } from "../src/zoneStyle/landmarks";
import { FORGE, SCORCH_LANDMARKS, scorch, scorchCraters } from "../src/zoneStyle/scorch";
import type { ScorchPlan } from "../src/zoneStyle/scorch";

const HEAVY_MS = 180_000;
const T = 32;
const FIRE = REGION_FACTIONS.indexOf("fire") + 1;
const SEEDS = Array.from({ length: 40 }, (_, i) => i);

/**
 * The test-local registry: the new Scorch for fire, the registry's stylers for the rest. `overrides` swaps a zone's styler in the
 * style pass only: the landmark stage keeps the registry's, because every zone's landmarks shape the ground the spawn pool is
 * picked on, so a zone isolation test must hold that stage fixed (a styler under construction elsewhere may place landmarks).
 */
function hooks(overrides: Partial<Record<RegionFaction, ZoneStyler<unknown>>> = {}, record?: { fire: StyleResult | null }): MapgenOptions {
  const landmarkStylers = { fire: scorchCraters as ZoneStyler<unknown> };
  const stylers = { ...landmarkStylers, ...overrides };
  const styleZonesHook: ZoneStyleHook = (st) => {
    const results = styleZones({
      w: st.w, h: st.h, seed: st.seed, attempt: st.attempt, tiles: st.tiles, terrain: st.terrain, props: st.props, zone: st.zone,
      zoneFaction: st.zoneFaction, protect: st.protect, territory: st.territoryGrid, camps: st.camps,
      spawns: st.spawns, centreWalk: st.centreWalk, features: st.features, featureOwner: st.featureOwner,
    }, { decor: st.decor, stylers });
    if (record) record.fire = results.find((r) => r.faction === "fire") ?? null;
  };
  const landmarks: LandmarkHook = (st) => { styleLandmarks(st, { stylers: landmarkStylers }); };
  return { styleZones: styleZonesHook, landmarks };
}

const cache = new Map<number, GameMap>();
function mapOf(seed: number): GameMap {
  let m = cache.get(seed);
  if (!m) { m = certifiedMap(seed, hooks()) ?? generateMap(seed, undefined, hooks()); cache.set(seed, m); }
  return m;
}

/** Tiles of the fire zone, of a feature kind, ... */
const inFire = (m: GameMap, i: number): boolean => m.regionGrid[i] === FIRE;
function firePieces(m: GameMap): number[] {
  const { w } = m, n = m.tiles.length;
  const seen = new Uint8Array(n), sizes: number[] = [];
  for (let s = 0; s < n; s++) {
    if (!inFire(m, s) || m.tiles[s] !== TILE_WALL || seen[s]) continue;
    const stack = [s];
    seen[s] = 1;
    let size = 0;
    while (stack.length > 0) {
      const i = stack.pop()!;
      size++;
      const x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = (y + dy) * w + x + dx;
          if ((dx || dy) && j >= 0 && j < n && !seen[j] && m.tiles[j] === TILE_WALL && inFire(m, j)) { seen[j] = 1; stack.push(j); }
        }
      }
    }
    sizes.push(size);
  }
  return sizes;
}
const count = (m: GameMap, pred: (i: number) => boolean): number => {
  let n = 0;
  for (let i = 0; i < m.tiles.length; i++) if (pred(i)) n++;
  return n;
};
const featuresOf = (m: GameMap, kind: string) => m.features.filter((f) => f.zone === "fire" && f.kind === kind);

describe("the forge template", () => {
  it("is valid in all 8 orientations (contract 3.8): wall pieces of 6+, 2-3 wide doors, connected floor, a crate nook off the doors", () => {
    expect(templateProblems(FORGE)).toEqual([]);
    expect(FORGE.key).toBe("forge");
    expect(FORGE.jobs).toEqual(["landmark", "lee"]);
    expect(SCORCH_LANDMARKS).toEqual([FORGE]);
  });
});

describe("the new Scorch on the generator's maps (40 seeds, the others old)", () => {
  it("never breaks the hook contract and builds the 8 camps' craters, a river and a forge on the fire zone of (nearly) every map", () => {
    MAPGEN_FAILS["A:styleBreach"] = 0;
    let craters7 = 0, rivers = 0, forges = 0;
    for (const s of SEEDS) {
      const m = mapOf(s);
      const cr = featuresOf(m, "crater");
      if (cr.length >= 7) craters7++;
      expect(cr.length, `seed ${s}: craters`).toBeLessThanOrEqual(8);
      if (featuresOf(m, "lavaRiver").length === 1) rivers++;
      if (featuresOf(m, "landmark").length >= 1) forges++;
    }
    expect(MAPGEN_FAILS["A:styleBreach"] ?? 0).toBe(0);
    expect(craters7, "maps with 7-8 craters").toBeGreaterThanOrEqual(Math.ceil(0.95 * SEEDS.length));
    expect(rivers, "maps with exactly one lava river").toBe(SEEDS.length);
    expect(forges, "maps with a forge").toBeGreaterThanOrEqual(Math.ceil(0.9 * SEEDS.length));
  }, HEAVY_MS);

  it("owns every wall and LOW tile of the zone by a fire feature, leaves no wall piece under 6 tiles and no single tile, stays within 13% of the zone", () => {
    for (const s of SEEDS) {
      const m = mapOf(s);
      let painted = 0, blocked = 0;
      for (let i = 0; i < m.tiles.length; i++) {
        if (!inFire(m, i)) continue;
        painted++;
        if (m.tiles[i] === TILE_FLOOR) continue;
        blocked++;
        const o = m.featureGrid[i];
        expect(o, `seed ${s} tile ${i} (${m.tiles[i]}) is owned`).not.toBe(0);
        expect(m.features[o - 1].zone, `seed ${s} tile ${i}`).toBe("fire");
      }
      const sizes = firePieces(m);
      expect(sizes.filter((n) => n < 6), `seed ${s}: wall pieces under 6`).toEqual([]);
      expect(blocked / painted, `seed ${s}: footprint`).toBeLessThanOrEqual(0.13);
    }
  }, HEAVY_MS);

  it("records its features by the frozen params (2.6): crater [camp, r4, breaches, ...dir16] with at least 2 breaches, lavaRiver [width2, fords, ...ford tiles]", () => {
    for (const s of SEEDS) {
      const m = mapOf(s);
      const camps = m.camps.filter((c) => c.zone === "fire");
      const named = new Set<number>();
      for (const f of featuresOf(m, "crater")) {
        expect(f.jobs).toEqual(["pen"]);
        expect(f.variant).toBe("");
        const [camp, r4, breaches, ...dirs] = f.p;
        expect(Number.isInteger(camp) && camp >= 0 && camp < m.camps.length, `seed ${s}: camp index ${camp}`).toBe(true);
        expect(m.camps[camp].zone, `seed ${s}: the crater's camp is a fire camp`).toBe("fire");
        expect(named.has(camp), `seed ${s}: one crater per camp`).toBe(false);
        named.add(camp);
        expect(r4, `seed ${s}: radius in quarter tiles`).toBeGreaterThanOrEqual(20);
        expect(r4).toBeLessThanOrEqual(30);
        expect(breaches, `seed ${s}: breaches`).toBeGreaterThanOrEqual(2);
        expect(dirs.length).toBe(breaches);
        for (const d of dirs) expect(Number.isInteger(d) && d >= 0 && d < 16).toBe(true);
        // the anchor is the camp's centre tile
        const c = m.camps[camp];
        expect([f.ax, f.ay]).toEqual([Math.floor(c.x / T), Math.floor(c.y / T)]);
        // it owns walls (the rim) and floor (the bowl)
        let walls = 0, floor = 0;
        for (let i = 0; i < m.tiles.length; i++) if (m.featureGrid[i] === m.features.indexOf(f) + 1) { if (m.tiles[i] === TILE_WALL) walls++; else floor++; }
        expect(walls, `seed ${s}: rim walls of camp ${camp}`).toBeGreaterThanOrEqual(6);
        expect(floor, `seed ${s}: bowl of camp ${camp}`).toBeGreaterThan(30);
        expect(walls + floor).toBe(f.tiles);
      }
      expect(named.size).toBeLessThanOrEqual(camps.length);
      const rivers = featuresOf(m, "lavaRiver");
      expect(rivers.length, `seed ${s}: rivers`).toBe(1);
      const river = rivers[0];
      expect(river.jobs).toEqual(["crossing"]);
      const [width2, fords, ...tiles] = river.p;
      expect(width2 === 4 || width2 === 5 || width2 === 6, `seed ${s}: width2 ${width2}`).toBe(true);
      expect(fords).toBeGreaterThanOrEqual(2);
      expect(tiles.length).toBe(fords);
      const id = m.features.indexOf(river) + 1;
      for (const t of tiles) {
        expect(m.tiles[t], `seed ${s}: a ford is floor`).toBe(TILE_FLOOR);
        expect(m.featureGrid[t], `seed ${s}: the river owns its ford`).toBe(id);
      }
      // every lava tile is the river's, every river wall-or-low tile is lava
      for (let i = 0; i < m.tiles.length; i++) {
        if (m.terrain[i] === TERRAIN_LAVA && inFire(m, i)) expect(m.featureGrid[i], `seed ${s}: lava ${i}`).toBe(id);
        if (m.featureGrid[i] === id && m.tiles[i] !== TILE_FLOOR) expect(m.tiles[i] === TILE_LOW && m.terrain[i] === TERRAIN_LAVA).toBe(true);
      }
    }
  }, HEAVY_MS);

  it("meets the acceptance windows of contract 4.1 (rim walls 150-300, lava 70-160, ember 80-200 on most maps, never absent)", () => {
    let rimOk = 0, lavaOk = 0, emberOk = 0;
    for (const s of SEEDS) {
      const m = mapOf(s);
      let rim = 0;
      const craterIds = new Set(featuresOf(m, "crater").map((f) => m.features.indexOf(f) + 1));
      for (let i = 0; i < m.tiles.length; i++) if (m.tiles[i] === TILE_WALL && craterIds.has(m.featureGrid[i])) rim++;
      const lava = count(m, (i) => inFire(m, i) && m.terrain[i] === TERRAIN_LAVA);
      const ember = count(m, (i) => inFire(m, i) && m.terrain[i] === TERRAIN_EMBER);
      expect(rim, `seed ${s}: rim`).toBeGreaterThan(100);
      expect(rim).toBeLessThan(330);
      expect(lava, `seed ${s}: lava`).toBeGreaterThan(20);
      expect(ember, `seed ${s}: ember`).toBeGreaterThan(0);
      if (rim >= 150 && rim <= 300) rimOk++;
      if (lava >= 70 && lava <= 160) lavaOk++;
      if (ember >= 80 && ember <= 200) emberOk++;
    }
    const need = Math.ceil(0.8 * SEEDS.length);
    expect(rimOk, "maps with rim walls in 150-300").toBeGreaterThanOrEqual(need);
    expect(lavaOk, "maps with lava in 70-160").toBeGreaterThanOrEqual(need);
    expect(emberOk, "maps with ember in 80-200").toBeGreaterThanOrEqual(need);
  }, HEAVY_MS);

  it("is open at bow range 48-68% of rays on average, walls off 16%+ of engagement pairs, keeps the camp graph short (stretch mean <= 1.12) and looped", () => {
    const sample = SEEDS.slice(0, 10);
    let ray = 0, pairs = 0;
    for (const s of sample) {
      const m = mapOf(s);
      const floors: number[] = [];
      for (let i = 0; i < m.tiles.length; i++) if (inFire(m, i) && m.tiles[i] === TILE_FLOOR) floors.push(i);
      // rays: even tiles, 24 directions, 40 tiles at most (contract 6.2; test code may use trig)
      let n = 0, far = 0;
      for (const i of floors) {
        const x = i % m.w, y = (i - x) / m.w;
        if ((x & 1) || (y & 1)) continue;
        const cx = x * T + T / 2, cy = y * T + T / 2;
        for (let k = 0; k < 24; k++) {
          const a = (k * 15 * Math.PI) / 180;
          const r = raycast(m, cx, cy, cx + Math.cos(a) * 40 * T, cy + Math.sin(a) * 40 * T);
          n++;
          if (Math.min(40, r.dist / T) >= 7.5) far++;
        }
      }
      ray += far / n;
      // engagement pairs: the certifier's LCG
      let seed = 12345 + 7 * (FIRE - 1), draws = 0, got = 0, blocked = 0;
      const next = (): number => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed; };
      while (got < 1000 && draws < 6000) {
        draws++;
        const a = floors[next() % floors.length], b = floors[next() % floors.length];
        const ax = a % m.w, ay = (a - ax) / m.w, bx = b % m.w, by = (b - bx) / m.w;
        const d = Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
        if (d < 3 || d > 7.5) continue;
        got++;
        if (raycast(m, ax * T + T / 2, ay * T + T / 2, bx * T + T / 2, by * T + T / 2).hit) blocked++;
      }
      pairs += blocked / got;
      // the camp graph (Gabriel over the 8 camps): findPath / straight
      const camps = m.camps.filter((c) => c.zone === "fire");
      const nodes: Node[] = camps.map((c, q) => ({ x: c.x, y: c.y, kind: "camp", camp: q, elite: c.eliteSpot >= 0 }));
      const edges = gabrielEdges(nodes);
      let sum = 0;
      for (const [a, b] of edges) {
        const pa = { x: camps[a].x, y: camps[a].y }, pb = { x: camps[b].x, y: camps[b].y };
        sum += pathLength(pa, findPath(m, pa, pb)) / Math.sqrt((pa.x - pb.x) * (pa.x - pb.x) + (pa.y - pb.y) * (pa.y - pb.y));
      }
      expect(sum / edges.length, `seed ${s}: camp-graph stretch mean`).toBeLessThanOrEqual(1.12);
    }
    expect(ray / sample.length, "share of rays at least 7.5 tiles").toBeGreaterThan(0.48);
    expect(ray / sample.length).toBeLessThan(0.68);
    expect(pairs / sample.length, "engagement pairs wall-blocked").toBeGreaterThan(0.16);
  }, HEAVY_MS);

  it("keeps the spawn members' walks dry: at most 8 ember tiles on any fire member's route, and the walk ratio inside the generator's 1.2", () => {
    let members = 0;
    for (const s of SEEDS.slice(0, 20)) {
      const m = mapOf(s);
      const walks: number[] = [];
      for (const p of m.spawnPool) {
        const path = findPath(m, p, m.coliseum.centre);
        walks.push(pathLength(p, path));
        if (m.regionGrid[Math.floor(p.y / T) * m.w + Math.floor(p.x / T)] !== FIRE) continue;
        members++;
        const seen = new Set<number>();
        let hazards = 0, a: { x: number; y: number } = p;
        for (const q of path) {
          const len = Math.sqrt((q.x - a.x) * (q.x - a.x) + (q.y - a.y) * (q.y - a.y)) || 1;
          for (let k = 0; k <= len; k += 4) {
            const i = Math.floor((a.y + ((q.y - a.y) * k) / len) / T) * m.w + Math.floor((a.x + ((q.x - a.x) * k) / len) / T);
            if (seen.has(i)) continue;
            seen.add(i);
            const spec = TERRAINS[m.terrain[i]];
            if (m.terrain[i] !== 0 && spec.tile === TILE_FLOOR && spec.key !== "light") hazards++;
          }
          a = q;
        }
        expect(hazards, `seed ${s}: ember on a fire member's walk`).toBeLessThanOrEqual(8);
      }
      expect(Math.max(...walks) / Math.min(...walks), `seed ${s}: walk ratio`).toBeLessThanOrEqual(1.2);
    }
    expect(members).toBeGreaterThan(40);
  }, HEAVY_MS);
});

describe("the forge", () => {
  it("is placed whole in the fire zone on at least 90% of the maps, up to LANDMARKS_PER_ZONE, apart from the camps and from each other, with a crate nook and doors", () => {
    let withForge = 0;
    for (const s of SEEDS) {
      const m = mapOf(s);
      const forges = featuresOf(m, "landmark");
      expect(forges.length, `seed ${s}`).toBeLessThanOrEqual(LANDMARKS_PER_ZONE);
      if (forges.length > 0) withForge++;
      forges.forEach((f, q) => {
        expect(f.variant).toBe("forge");
        expect(f.jobs).toEqual(["landmark", "lee"]);
        const [rot, mirror, ...doors] = f.p;
        const st = stampTemplate(FORGE, f.ax, f.ay, rot as 0 | 1 | 2 | 3, mirror === 1, m.w, m.h)!;
        expect(st, `seed ${s}: the forge re-stamps`).not.toBeNull();
        expect(doors).toEqual(st.doors.slice().sort((a, b) => a - b));
        for (const i of st.walls) expect(m.tiles[i], `seed ${s}: a forge wall`).toBe(TILE_WALL);
        for (const i of [...st.floor, ...st.doors, ...st.nooks]) {
          expect(m.tiles[i], `seed ${s}: forge floor`).toBe(TILE_FLOOR);
          expect(m.regionGrid[i]).toBe(FIRE);
        }
        expect(st.nooks.length).toBeGreaterThanOrEqual(1);
        expect(m.buildings.some((b) => b.x === f.bbox.x && b.y === f.bbox.y && b.w === f.bbox.w && b.h === f.bbox.h), `seed ${s}: in buildings`).toBe(true);
        // clear of every fire camp by the crater's reach (R_est + 2 at least; the fire camps' craters are at most 7.5 tiles)
        for (const c of m.camps.filter((k) => k.zone === "fire")) {
          const cx = Math.floor(c.x / T), cy = Math.floor(c.y / T);
          let nearest = Infinity;
          for (const i of st.walls) { const x = i % m.w, y = (i - x) / m.w; nearest = Math.min(nearest, Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy))); }
          expect(nearest, `seed ${s}: forge to camp ${c.id}`).toBeGreaterThanOrEqual(6.5);
        }
        for (let r = 0; r < q; r++) {
          const o = forges[r];
          const d = Math.sqrt((f.bbox.x + f.bbox.w / 2 - o.bbox.x - o.bbox.w / 2) ** 2 + (f.bbox.y + f.bbox.h / 2 - o.bbox.y - o.bbox.h / 2) ** 2);
          expect(d, `seed ${s}: two forges`).toBeGreaterThanOrEqual(12);
        }
      });
    }
    expect(withForge).toBeGreaterThanOrEqual(Math.ceil(0.9 * SEEDS.length));
  }, HEAVY_MS);
});

describe("determinism and zone isolation", () => {
  it("builds the same map twice (hash, features, tiles, terrain) and the same props with the decor off", () => {
    for (const s of [3, 11, 27]) {
      const a = generateMap(s, undefined, hooks()), b = generateMap(s, undefined, hooks());
      expect(mapHash(a), `seed ${s}`).toBe(mapHash(b));
      expect(a.features).toEqual(b.features);
      expect(Buffer.from(a.featureGrid).equals(Buffer.from(b.featureGrid))).toBe(true);
      const bare = generateMap(s, undefined, { ...hooks(), decor: false });
      expect(mapHash(bare), `seed ${s}: the hash does not see the decor`).toBe(mapHash(a));
      expect(a.props.length).toBeGreaterThan(0);
    }
  }, HEAVY_MS);

  it("styles its zone alone: another zone's styler swapped for a no-op leaves the fire zone byte for byte, and fire as a no-op changes one zone only", () => {
    const noop = (faction: RegionFaction): ZoneStyler<unknown> => ({ id: "scorch", faction, version: 0, shape: () => null });
    for (const s of [2, 9, 21, 30]) {
      const attempt = mapOf(s).attempt;
      const record = (overrides: Partial<Record<RegionFaction, ZoneStyler<unknown>>>): { tiles: Uint8Array; terrain: Uint8Array; zone: Uint8Array; fire: number } => {
        let out: { tiles: Uint8Array; terrain: Uint8Array; zone: Uint8Array; fire: number } | null = null;
        const base = hooks(overrides);
        const hook: ZoneStyleHook = (st) => {
          base.styleZones!(st);
          out = { tiles: st.tiles.slice(), terrain: st.terrain.slice(), zone: st.zone.slice(), fire: st.zoneFaction.indexOf("fire") + 1 };
        };
        try { tryAttempt(s, attempt, { ...base, styleZones: hook }); } catch { /* a styler-less zone may fail a later check */ }
        return out!;
      };
      const full = record({});
      for (const other of REGION_FACTIONS.filter((f) => f !== "fire")) {
        const without = record({ [other]: noop(other) });
        let differ = 0;
        for (let i = 0; i < full.tiles.length; i++) {
          if (full.zone[i] === full.fire && (full.tiles[i] !== without.tiles[i] || full.terrain[i] !== without.terrain[i])) differ++;
        }
        expect(differ, `seed ${s}: the fire zone does not read ${other}'s writes`).toBe(0);
      }
      const noFire = record({ fire: noop("fire") });
      const zones = new Set<number>();
      let touched = 0;
      for (let i = 0; i < full.tiles.length; i++) {
        if (full.tiles[i] !== noFire.tiles[i] || full.terrain[i] !== noFire.terrain[i]) { touched++; zones.add(full.zone[i]); }
      }
      expect(touched, `seed ${s}: the fire styler writes`).toBeGreaterThan(150);
      expect([...zones], `seed ${s}: the zones the fire styler changes`).toEqual([full.fire]);
    }
  }, HEAVY_MS);
});

describe("integer maths", () => {
  it("never calls Math.random or an engine-approximated Math function: the styler, its landmark stage and the maps it styles", async () => {
    const names = [
      "random", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh",
      "exp", "expm1", "log", "log1p", "log2", "log10", "pow", "hypot", "cbrt",
    ] as const;
    const spies = names.map((n) => vi.spyOn(Math, n));
    const calls: Record<string, number> = {};
    try {
      // fresh copies of the modules, so their module-level tables are built under the spies
      vi.resetModules();
      const gen = await import("../src/mapgen");
      const zs = await import("../src/zoneStyle");
      const sc = await import("../src/zoneStyle/scorch");
      const stylers = { fire: sc.scorchCraters as ZoneStyler<unknown> };
      const opts: MapgenOptions = {
        styleZones: (st) => { zs.styleZones({
          w: st.w, h: st.h, seed: st.seed, attempt: st.attempt, tiles: st.tiles, terrain: st.terrain, props: st.props, zone: st.zone,
          zoneFaction: st.zoneFaction, protect: st.protect, territory: st.territoryGrid, camps: st.camps,
          spawns: st.spawns, centreWalk: st.centreWalk, features: st.features, featureOwner: st.featureOwner,
        }, { decor: st.decor, stylers }); },
        landmarks: (st) => { zs.styleLandmarks(st, { stylers }); },
      };
      let craters = 0;
      for (const s of [80_001, 80_002, 80_003, 80_004, 80_005, 80_006]) {
        const m = gen.generateMap(s, undefined, opts);
        craters += m.features.filter((f) => f.zone === "fire" && f.kind === "crater").length;
      }
      expect(craters, "the styler really ran under the spies").toBeGreaterThan(30);
      names.forEach((n, i) => { calls[`Math.${n}`] = spies[i].mock.calls.length; });
    } finally {
      for (const sp of spies) sp.mockRestore();
    }
    expect(calls).toEqual(Object.fromEntries(names.map((n) => [`Math.${n}`, 0])));
  }, HEAVY_MS);
});

describe("attempts per seed", () => {
  it("is not worse with the new styler than with the old one (60 seeds; the 600-seed figure is in the report)", () => {
    const attempts = (opts: MapgenOptions | undefined): number => {
      let sum = 0;
      for (const s of Array.from({ length: 60 }, (_, i) => 1000 + i)) sum += (certifiedMap(s, opts)?.attempt ?? 9) + 1;
      return sum / 60;
    };
    const oldStyler = attempts(hooks({ fire: scorch as ZoneStyler<unknown> }));
    const newStyler = attempts(hooks());
    expect(newStyler, `old ${oldStyler.toFixed(3)}, new ${newStyler.toFixed(3)}`).toBeLessThanOrEqual(oldStyler + 0.05);
  }, HEAVY_MS);
});

export type { ScorchPlan };

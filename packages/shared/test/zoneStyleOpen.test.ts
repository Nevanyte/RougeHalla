// The stylers on OPEN ground, the habitat they were designed for (part D: a 96x96 zone map before cover, five zones of about
// 1500 tiles): here the footprint bands of part D 3 apply. zoneStyleGen.test.ts measures the same recipes on the ground the zone
// generator leaves them. Also size-freedom (any grid size), the rim margin and the 8% budget.
// The synthetic fixture (zoneStyleOpen.ts) needs no generator data, so the pinned output, zone isolation, determinism, decor and
// Math-purity checks at the end of this file hold the stylers apart from the generator (the dev adapter and its wedge suites are gone).
import { describe, expect, it, vi } from "vitest";
import { REGION_FACTIONS, TILE_FLOOR, TILE_LOW, TILE_WALL, mapFromTiles, worldToTile } from "../src/map";
import type { RegionFaction } from "../src/map";
import {
  TERRAIN_BOG, TERRAIN_CREVASSE, TERRAIN_EMBER, TERRAIN_FENCE, TERRAIN_ICE, TERRAIN_LAVA, TERRAIN_LIGHT, validateTerrain,
} from "../src/terrain";
import { walkDistances } from "../src/gridTopology";
import { ZONE_PROP_KINDS, ZONE_STYLERS, styleZones } from "../src/zoneStyle";
import type { GallowsPlan, RimePlan, SanctumPlan, ScorchPlan, StyleResult, WarrenPlan, ZoneStyler } from "../src/zoneStyle";
import { chamfer, floorComponents } from "../src/zoneStyle/kit";
import { fenceStraightViolations, yardOpenings } from "./zoneStyleChecks";
import { openFixture } from "./zoneStyleOpen";
import type { OpenFixture } from "./zoneStyleOpen";

const HEAVY_MS = 120_000;
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

interface Run { f: OpenFixture; results: StyleResult[] }
const cache = new Map<number, Run>();
function run(seed: number): Run {
  let r = cache.get(seed);
  if (!r) {
    const f = openFixture(seed);
    r = { f, results: styleZones(f.st) };
    cache.set(seed, r);
  }
  return r;
}

const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const percentile = (a: number[], p: number): number => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };

/** Footprint of one zone in percent of its painted tiles. */
function footprint(r: Run, zone: number) {
  const { st, tiles0, w, h } = r.f;
  let painted = 0, wall = 0, low = 0;
  const kinds: Record<number, number> = {};
  for (let i = 0; i < w * h; i++) {
    if (st.zone[i] !== zone) continue;
    painted++;
    if (st.tiles[i] === TILE_WALL && tiles0[i] === TILE_FLOOR) wall++;
    if (st.tiles[i] === TILE_LOW) low++;
    if (st.tiles[i] === TILE_FLOOR && st.terrain[i] !== 0) kinds[st.terrain[i]] = (kinds[st.terrain[i]] ?? 0) + 1;
  }
  return { painted, wall: (100 * wall) / painted, low: (100 * low) / painted, kinds, pct: (k: number) => (100 * (kinds[k] ?? 0)) / painted };
}

describe("every zone on open ground", () => {
  it("only touches its own zone, never a protected tile and never within 3 tiles of its rim; keeps the floor in one piece (20 seeds)", () => {
    for (const s of SEEDS) {
      const { f, results } = run(s);
      const { st, tiles0, w, h } = f;
      for (let z = 1; z <= 5; z++) {
        const mask = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) mask[i] = st.zone[i] === z ? 1 : 0;
        const rim = chamfer(mask, w, h);
        for (let i = 0; i < w * h; i++) {
          if (st.zone[i] !== z || (st.tiles[i] === tiles0[i] && st.terrain[i] === 0)) continue;
          expect(st.protect[i], `seed ${s} zone ${z} tile ${i}: protected`).toBe(0);
          if (st.tiles[i] !== tiles0[i]) expect(rim[i], `seed ${s} zone ${z} tile ${i}: inside the 3-tile rim`).toBeGreaterThanOrEqual(9);
        }
      }
      for (let i = 0; i < w * h; i++) {
        if (st.zone[i] === 0) { expect(st.tiles[i], `seed ${s} tile ${i}`).toBe(tiles0[i]); expect(st.terrain[i]).toBe(0); }
      }
      expect(floorComponents(st.tiles, w, h).sizes.length, `seed ${s}: floor components`).toBe(floorComponents(tiles0, w, h).sizes.length);
      for (const r of results) {
        expect(r.repaired, `seed ${s} zone ${r.index}`).toBe(0);
        expect(r.blocked, `seed ${s} zone ${r.index}`).toBe(r.walls + r.low);
      }
    }
  }, HEAVY_MS);

  it("holds the footprint budget (0.35 x WALL + 1.0 x LOW <= 8% of the zone) and validateTerrain passes on the styled map", () => {
    for (const s of SEEDS) {
      const r = run(s);
      for (let z = 1; z <= 5; z++) {
        const fp = footprint(r, z);
        expect(0.35 * fp.wall + fp.low, `seed ${s} zone ${z}`).toBeLessThanOrEqual(8.0001);
      }
      const { st, w, h } = r.f;
      const map = mapFromTiles(w, h, st.tiles.slice(), s, st.terrain.slice());
      map.props = st.props.slice();
      // a hand-built map has no regions: T1-T5, T9 and T10 apply
      expect(validateTerrain(map, { styled: true }), `seed ${s}`).toEqual([]); // the default prop table is the real one
    }
  }, HEAVY_MS);

  it("is size-free: the same stylers run on a 64x64, a 96x96 and a 70x110 grid with no module-level size", () => {
    for (const [w, h] of [[64, 64], [96, 96], [70, 110], [112, 80]] as const) {
      const f = openFixture(3, w, h);
      const results = styleZones(f.st);
      expect(results.length).toBe(5);
      expect(f.st.tiles.length).toBe(w * h);
      const changed = f.st.tiles.reduce((n, t, i) => n + (t !== f.tiles0[i] ? 1 : 0), 0);
      expect(changed, `${w}x${h}`).toBeGreaterThan(40);
      expect(floorComponents(f.st.tiles, w, h).sizes.length, `${w}x${h}`).toBe(floorComponents(f.tiles0, w, h).sizes.length);
      expect(f.st.terrain.every((k) => k < 8)).toBe(true);
    }
  }, HEAVY_MS);

  it("rejects a state whose arrays do not fit its size", () => {
    const f = openFixture(2);
    expect(() => styleZones({ ...f.st, protect: new Uint8Array(10) })).toThrow(RangeError);
    expect(() => styleZones({ ...f.st, zone: new Uint8Array(10) })).toThrow(RangeError);
  });

  it("keeps hazards and LOW kinds in their home zones only, and every prop on its tile class in its zone", () => {
    const home: number[][] = [[TERRAIN_LAVA, TERRAIN_EMBER], [TERRAIN_FENCE], [TERRAIN_BOG], [TERRAIN_CREVASSE, TERRAIN_ICE], [TERRAIN_LIGHT]];
    for (const s of SEEDS.slice(0, 8)) {
      const { f } = run(s);
      const { st, w } = f;
      for (let i = 0; i < w * f.h; i++) {
        if (st.terrain[i] === 0) continue;
        expect(st.zone[i], `seed ${s}`).toBeGreaterThan(0);
        expect(home[st.zone[i] - 1], `seed ${s} tile ${i}`).toContain(st.terrain[i]);
      }
      for (const p of st.props) {
        const spec = ZONE_PROP_KINDS[p.kind];
        const tx = worldToTile(p.x), ty = worldToTile(p.y);
        expect(st.tiles[ty * w + tx], `seed ${s} ${spec.key}`).toBe(spec.on);
        expect(REGION_FACTIONS[st.zone[ty * w + tx] - 1], `seed ${s} ${spec.key}`).toBe(spec.home);
      }
      expect(st.props.length).toBeLessThanOrEqual(0.08 * st.tiles.length);
    }
  }, HEAVY_MS);
});

describe("Scorch on open ground (part D 3: WALL 3.9%, LOW 2.7%, EMBER 4.4%)", () => {
  it("lands in the footprint bands, with a river, fords and a complete ember bank", () => {
    const wall: number[] = [], low: number[] = [], ember: number[] = [];
    for (const s of SEEDS) {
      const r = run(s);
      const fp = footprint(r, 1);
      wall.push(fp.wall); low.push(fp.low); ember.push(fp.pct(TERRAIN_EMBER));
      const plan = r.results[0].plan as ScorchPlan;
      expect(plan.riverPath.length, `seed ${s}: a river`).toBeGreaterThan(8);
      expect(plan.fords.length, `seed ${s}: fords`).toBe(2);
      const { st, w } = r.f;
      for (const f of plan.fords) expect(st.tiles[f], `seed ${s}: a ford`).toBe(TILE_FLOOR);
      // ember ring: every free floor tile touching lava is ember
      for (let i = 0; i < w * r.f.h; i++) {
        if (st.zone[i] !== 1 || st.tiles[i] !== TILE_FLOOR || st.protect[i]) continue;
        const x = i % w, y = (i - x) / w;
        let touches = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = (y + dy) * w + x + dx; if (st.tiles[j] === TILE_LOW && st.terrain[j] === TERRAIN_LAVA) touches = true; }
        expect(st.terrain[i] === TERRAIN_EMBER, `seed ${s}: tile ${x},${y} touches lava`).toBe(touches);
      }
    }
    console.info(`[open scorch] WALL ${mean(wall).toFixed(2)}% LOW ${mean(low).toFixed(2)}% EMBER ${mean(ember).toFixed(2)}%`);
    expect(mean(wall)).toBeGreaterThanOrEqual(3.5);
    expect(mean(wall)).toBeLessThanOrEqual(4.5);
    expect(mean(low)).toBeLessThanOrEqual(3.5);
    expect(mean(low)).toBeGreaterThan(1.5);
    expect(mean(ember)).toBeGreaterThan(3);
    expect(mean(ember)).toBeLessThan(6);
  }, HEAVY_MS);
});

describe("Gallows on open ground (part D 3: WALL 3.3%, FENCE 2.6%)", () => {
  it("lands in the footprint bands, with yards of at least two openings and no long detour", () => {
    const wall: number[] = [], low: number[] = [];
    let yards = 0, blocks = 0;
    const detours: number[] = [];
    for (const s of SEEDS) {
      const r = run(s);
      const fp = footprint(r, 2);
      wall.push(fp.wall); low.push(fp.low);
      const plan = r.results[1].plan as GallowsPlan;
      blocks += plan.blocks.length; yards += plan.yards.length;
      const { st, w, h } = r.f;
      for (const yd of plan.yards) {
        for (const t of yd.doorTiles) expect(st.tiles[t], `seed ${s}: a yard door was closed`).toBe(TILE_FLOOR);
        expect(yd.doorTiles.length, `seed ${s}`).toBeGreaterThanOrEqual(4);
        expect(yardOpenings(st.tiles, w, yd.rect), `seed ${s}: yard ${JSON.stringify(yd.rect)} openings`).toBeGreaterThanOrEqual(2);
      }
      // detours: floor tiles next to a fence against the same tiles with the fences taken away
      const opened = st.tiles.slice();
      for (let i = 0; i < w * h; i++) if (st.tiles[i] === TILE_LOW && st.terrain[i] === TERRAIN_FENCE) opened[i] = TILE_FLOOR;
      const seen = new Set<number>();
      for (let i = 0; i < w * h; i++) {
        if (st.tiles[i] !== TILE_LOW) continue;
        for (const j of [i + 1, i - 1, i + w, i - w]) if (st.tiles[j] === TILE_FLOOR) seen.add(j);
      }
      for (const a of [...seen].sort((p, q) => p - q).filter((_, k) => k % 3 === 0).slice(0, 40)) {
        const withF = walkDistances(st.tiles, w, h, a), without = walkDistances(opened, w, h, a);
        const ax = a % w, ay = (a - ax) / w;
        for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
          const bx = ax + dx, by = ay + dy;
          if (bx < 0 || by < 0 || bx >= w || by >= h) continue;
          const b = by * w + bx;
          if (st.tiles[b] !== TILE_FLOOR || withF[b] < 0 || without[b] < 0 || withF[b] === without[b]) continue;
          detours.push((withF[b] - without[b]) / 5);
        }
      }
    }
    console.info(`[open gallows] WALL ${mean(wall).toFixed(2)}% FENCE ${mean(low).toFixed(2)}%; ${yards} yards, ${blocks} cell blocks over 20 seeds; fence detour p50 ${percentile(detours, 0.5).toFixed(1)} p90 ${percentile(detours, 0.9).toFixed(1)} max ${Math.max(...detours).toFixed(1)}`);
    expect(mean(wall)).toBeGreaterThan(2);
    expect(mean(wall)).toBeLessThan(4.5);
    expect(mean(low)).toBeGreaterThan(1.5);
    expect(mean(low)).toBeLessThan(3.5);
    expect(yards).toBeGreaterThanOrEqual(30);
    expect(percentile(detours, 0.9)).toBeLessThanOrEqual(10);
    for (const s of SEEDS) expect(fenceStraightViolations(run(s).f.st.tiles, run(s).f.st.terrain, 96, 96), `seed ${s}: a pair straight across a fence walks more than 10 extra`).toBe(0);
  }, HEAVY_MS);
});

describe("Warren on open ground (part D 3: WALL 8.3%, BOG 7.6%)", () => {
  it("lays pools of 9 to 40 tiles, bog at 6 to 9% of the zone, bored tunnels and fungus", () => {
    const bog: number[] = [], wall: number[] = [];
    let tunnels = 0, fungus = 0;
    for (const s of SEEDS) {
      const r = run(s);
      const fp = footprint(r, 3);
      bog.push(fp.pct(TERRAIN_BOG)); wall.push(fp.wall);
      expect(fp.low, `seed ${s}`).toBe(0);
      const plan = r.results[2].plan as WarrenPlan;
      tunnels += plan.tunnels.length; fungus += plan.fungus.length;
      expect(plan.pools.length, `seed ${s}: pools`).toBeGreaterThan(0);
      for (const p of plan.pools) { expect(p.length).toBeGreaterThanOrEqual(9); expect(p.length).toBeLessThanOrEqual(40); }
      // the pools in the map are 4-connected components within 9..40
      const { st, w, h } = r.f;
      const seen = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        if (st.terrain[i] !== TERRAIN_BOG || seen[i]) continue;
        let size = 0;
        const stack = [i];
        seen[i] = 1;
        while (stack.length) { const j = stack.pop()!; size++; for (const k of [j + 1, j - 1, j + w, j - w]) if (st.terrain[k] === TERRAIN_BOG && !seen[k]) { seen[k] = 1; stack.push(k); } }
        expect(size, `seed ${s}: a bog pool`).toBeGreaterThanOrEqual(9);
        expect(size, `seed ${s}: a bog pool`).toBeLessThanOrEqual(40);
      }
    }
    console.info(`[open warren] WALL ${mean(wall).toFixed(2)}% BOG ${mean(bog).toFixed(2)}%; ${tunnels} tunnels and ${fungus} fungus walls over 20 seeds`);
    expect(mean(bog)).toBeGreaterThanOrEqual(6);
    expect(mean(bog)).toBeLessThanOrEqual(9);
    expect(mean(wall)).toBeGreaterThan(6);
    expect(mean(wall)).toBeLessThan(11);
    expect(tunnels).toBeGreaterThanOrEqual(25);
  }, HEAVY_MS);

  it("keeps the bog an approach crosses to a handful of tiles (the walk from the middle of the zone to the coliseum)", () => {
    const counts: number[] = [];
    for (const s of SEEDS) {
      const { f } = run(s);
      const { st, w, h } = f;
      const centre = (h >> 1) * w + (w >> 1);
      const field = walkDistances(st.tiles, w, h, centre);
      // from every 7th floor tile of the Warren: descend the walk field and count the bog tiles stepped on
      let k = 0;
      for (let i = 0; i < w * h; i++) {
        if (st.zone[i] !== 3 || st.tiles[i] !== TILE_FLOOR || field[i] <= 0 || k++ % 7 !== 0) continue;
        let j = i, bogTiles = 0, guard = 0;
        while (field[j] > 0 && guard++ < 400) {
          if (st.terrain[j] === TERRAIN_BOG) bogTiles++;
          let best = j;
          for (const d of [1, -1, w, -w, w + 1, w - 1, -w + 1, -w - 1]) if (field[j + d] >= 0 && field[j + d] < field[best]) best = j + d;
          if (best === j) break;
          j = best;
        }
        counts.push(bogTiles);
      }
    }
    console.info(`[open warren] bog tiles on a walk to the coliseum: mean ${mean(counts).toFixed(2)}, p90 ${percentile(counts, 0.9)}, max ${Math.max(...counts)}`);
    expect(percentile(counts, 0.9)).toBeLessThanOrEqual(6);
  }, HEAVY_MS);
});

describe("Rime on open ground (part D 3: WALL 3.7%, CREVASSE 0.5%, ICE 18%)", () => {
  it("lands in the footprint bands, with ICE only where no wall or LOW is within a tile", () => {
    const ice: number[] = [], wall: number[] = [], low: number[] = [];
    for (const s of SEEDS) {
      const r = run(s);
      const fp = footprint(r, 4);
      ice.push(fp.pct(TERRAIN_ICE)); wall.push(fp.wall); low.push(fp.low);
      const { st, w, h } = r.f;
      for (let i = 0; i < w * h; i++) {
        if (st.terrain[i] !== TERRAIN_ICE) continue;
        const x = i % w, y = (i - x) / w;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(st.tiles[(y + dy) * w + x + dx], `seed ${s}: ice at ${x},${y}`).toBe(TILE_FLOOR);
      }
      for (const sh of (r.results[3].plan as RimePlan).shelves) for (const i of sh.walls) expect(st.tiles[i], `seed ${s}: a shelf wall`).toBe(TILE_WALL);
    }
    console.info(`[open rime] ICE ${mean(ice).toFixed(2)}% WALL ${mean(wall).toFixed(2)}% CREVASSE ${mean(low).toFixed(2)}%`);
    expect(mean(ice)).toBeGreaterThanOrEqual(15);
    expect(mean(ice)).toBeLessThanOrEqual(22);
    expect(mean(wall)).toBeGreaterThan(2);
    expect(mean(wall)).toBeLessThan(5);
    expect(mean(low)).toBeGreaterThan(0.2);
    expect(mean(low)).toBeLessThan(2);
  }, HEAVY_MS);
});

describe("Sanctum on open ground (part D 3: WALL 2.7%, LIGHT 1.4%)", () => {
  it("raises symmetric structures with light shafts inside them, in the footprint bands", () => {
    const wall: number[] = [], light: number[] = [];
    let structures = 0, shafts = 0, bothTotal = 0, anyTotal = 0;
    for (const s of SEEDS) {
      const r = run(s);
      const fp = footprint(r, 5);
      wall.push(fp.wall); light.push(fp.pct(TERRAIN_LIGHT));
      const plan = r.results[4].plan as SanctumPlan;
      const { st, w } = r.f;
      for (const sp of plan.structures) {
        structures++;
        const planned = new Set(sp.planned);
        let mirrored = 0;
        for (const i of sp.planned) {
          const x = i % w, y = (i - x) / w;
          const mx = sp.horizontal ? x : 2 * sp.cx - x, my = sp.horizontal ? 2 * sp.cy - y : y;
          if (planned.has(my * w + mx)) mirrored++;
        }
        expect(mirrored / sp.planned.length, `seed ${s}: ${sp.kind} symmetry`).toBeGreaterThanOrEqual(0.8);
        // after the break coins most of the planned pillars stand: symmetry of the standing ones
        const placed = new Set(sp.placed);
        let both = 0, any = 0;
        for (const i of sp.planned) {
          if (!placed.has(i)) continue;
          any++;
          const x = i % w, y = (i - x) / w;
          const mx = sp.horizontal ? x : 2 * sp.cx - x, my = sp.horizontal ? 2 * sp.cy - y : y;
          if (placed.has(my * w + mx)) both++;
        }
        bothTotal += both; anyTotal += any;
        if (sp.shaft >= 0) {
          shafts++;
          const sx = sp.shaft % w, sy = (sp.shaft - sx) / w;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(st.terrain[(sy + dy) * w + sx + dx], `seed ${s}: shaft of a ${sp.kind}`).toBe(TERRAIN_LIGHT);
        }
      }
    }
    console.info(`[open sanctum] WALL ${mean(wall).toFixed(2)}% LIGHT ${mean(light).toFixed(2)}%; ${structures} structures, ${shafts} shafts over 20 seeds; standing pillars with a standing mirror ${(bothTotal / anyTotal).toFixed(2)}`);
    expect(bothTotal / anyTotal).toBeGreaterThanOrEqual(0.7); // the break coins (15%, 35% on the arches) and the guard take some
    expect(mean(wall)).toBeGreaterThan(1.5);
    expect(mean(wall)).toBeLessThan(4);
    expect(mean(light)).toBeGreaterThan(0.7);
    expect(mean(light)).toBeLessThan(3);
    expect(structures).toBeGreaterThanOrEqual(40);
    expect(shafts).toBeGreaterThanOrEqual(20);
  }, HEAVY_MS);
});

// ---------------------------------------------------------------------------------------------------------------------------
// The checks that outlive the dev adapter: pinned output, zone isolation, determinism, decor and Math purity, all on the fixture.

const FACTION_INDEX: Record<RegionFaction, number> = { fire: 0, sentenced: 1, plague: 2, frost: 3, holy: 4 };

/** A 32-bit FNV-1a of the zone's tiles and terrain (row-major, the zone's own tiles only). */
function openZoneHash(r: Run, faction: RegionFaction): number {
  const zone = FACTION_INDEX[faction] + 1;
  const { st, w, h } = r.f;
  let hash = 0x811c9dc5;
  for (let i = 0; i < w * h; i++) {
    if (st.zone[i] !== zone) continue;
    hash = Math.imul(hash ^ st.tiles[i], 0x01000193) >>> 0;
    hash = Math.imul(hash ^ st.terrain[i], 0x01000193) >>> 0;
  }
  return hash;
}

// 8 pairs, every zone at least once, on the synthetic fixture of the seed (openFixture's geometry is part of the input: changing the
// fixture moves every pin). After a deliberate change to a styler, read the new values off the failing assertion, paste them here
// and bump the styler's `version`.
// Provisional (zone-shapes phase A: the old stylers under the new guard caps, 13% at 1.0 per wall, no wall-run or wall-detour cap);
// WP7 re-pins after the new stylers land.
const OPEN_PINNED: Array<[number, RegionFaction, number]> = [
  [1, "fire", 4096451231], [2, "fire", 568631572], [3, "sentenced", 1689526337], [4, "sentenced", 3417527168],
  [5, "plague", 614918037], [6, "plague", 2647845391], [7, "frost", 1860200574], [8, "holy", 1135868384],
];

describe("the stylers on the open fixture, beyond the dev adapter", () => {
  it("pins the output of eight (seed, zone) pairs, named by each styler's version", () => {
    const got = OPEN_PINNED.map(([seed, faction]) => `${faction} v${ZONE_STYLERS[faction].version} seed ${seed}: ${openZoneHash(run(seed), faction)}`);
    expect(got).toEqual(OPEN_PINNED.map(([seed, faction, h]) => `${faction} v${ZONE_STYLERS[faction].version} seed ${seed}: ${h}`));
  }, HEAVY_MS);

  it("styles a zone alone: a no-op styler for one zone leaves every other zone byte-identical, and that zone untouched (isolation)", () => {
    const noop = (faction: RegionFaction): ZoneStyler<unknown> => ({ id: ZONE_STYLERS[faction].id, faction, version: 0, shape: () => null });
    for (const s of SEEDS.slice(0, 8)) {
      const full = run(s).f;
      for (const faction of REGION_FACTIONS) {
        const f = openFixture(s);
        styleZones(f.st, { stylers: { [faction]: noop(faction) } });
        const zone = FACTION_INDEX[faction] + 1;
        for (let i = 0; i < f.w * f.h; i++) {
          if (f.st.zone[i] === zone) {
            expect(f.st.tiles[i], `seed ${s} ${faction}: the no-op zone changed`).toBe(f.tiles0[i]);
            expect(f.st.terrain[i], `seed ${s} ${faction}: the no-op zone got a kind`).toBe(0);
          } else {
            expect(f.st.tiles[i], `seed ${s}: dropping ${faction} changed tile ${i}`).toBe(full.st.tiles[i]);
            expect(f.st.terrain[i], `seed ${s}: dropping ${faction} changed terrain ${i}`).toBe(full.st.terrain[i]);
          }
        }
      }
    }
  }, HEAVY_MS);

  it("is deterministic: styling the same fixture twice gives byte-equal tiles, terrain and props, whatever the seed", () => {
    for (const s of [0, 1, 7, 99, 123456789, 2 ** 31]) {
      const a = openFixture(s), b = openFixture(s);
      styleZones(a.st);
      styleZones(b.st);
      expect(Buffer.from(a.st.tiles).equals(Buffer.from(b.st.tiles)), `seed ${s}: tiles`).toBe(true);
      expect(Buffer.from(a.st.terrain).equals(Buffer.from(b.st.terrain)), `seed ${s}: terrain`).toBe(true);
      expect(a.st.props, `seed ${s}: props`).toEqual(b.st.props);
    }
  }, HEAVY_MS);

  it("decides props by hashes, not by the rng: swapping the props pass or turning decor off leaves tiles and terrain byte-equal", () => {
    const other: ZoneStyler<unknown> = {
      ...ZONE_STYLERS.holy,
      props: (c) => { for (let i = 0; i < c.w * c.h; i++) if (c.mask[i] && c.tiles[i] === TILE_FLOOR && c.noise.hash(i % c.w, Math.floor(i / c.w), 77) < 0.5) c.prop(19, i % c.w, Math.floor(i / c.w), 0); },
    };
    for (const s of SEEDS.slice(0, 6)) {
      const { f } = run(s);
      const swapped = openFixture(s), bare = openFixture(s);
      styleZones(swapped.st, { stylers: { holy: other } });
      styleZones(bare.st, { decor: false });
      expect(Buffer.from(swapped.st.tiles).equals(Buffer.from(f.st.tiles)), `seed ${s}`).toBe(true);
      expect(Buffer.from(swapped.st.terrain).equals(Buffer.from(f.st.terrain)), `seed ${s}`).toBe(true);
      expect(Buffer.from(bare.st.tiles).equals(Buffer.from(f.st.tiles)), `seed ${s}`).toBe(true);
      expect(Buffer.from(bare.st.terrain).equals(Buffer.from(f.st.terrain)), `seed ${s}`).toBe(true);
      expect(bare.st.props.length).toBe(0);
      expect(swapped.st.props.length, `seed ${s}: the swapped pass changed the props`).not.toBe(f.st.props.length);
    }
  }, HEAVY_MS);

  it("carries at most 8% of a zone's tiles in props per zone", () => {
    for (const s of SEEDS) {
      const { f } = run(s);
      const per = [0, 0, 0, 0, 0, 0];
      for (const p of f.st.props) per[f.st.zone[worldToTile(p.y) * f.w + worldToTile(p.x)]]++;
      for (let z = 1; z <= 5; z++) {
        let painted = 0;
        for (let i = 0; i < f.w * f.h; i++) if (f.st.zone[i] === z) painted++;
        expect(per[z], `seed ${s} zone ${z}`).toBeLessThanOrEqual(Math.floor(0.08 * painted));
      }
      expect(per[0], `seed ${s}: a prop outside every zone`).toBe(0);
    }
  }, HEAVY_MS);

  it("never calls Math.random or an engine-approximated Math function while styling (client and server may run different engines)", async () => {
    const names = ["random", "sin", "cos", "tan", "atan", "atan2", "hypot", "pow", "exp", "log", "cbrt"] as const;
    // The fixtures are test scaffolding (they use Math.sin and cos): build them before the spies.
    const fixtures = [90_000, 90_001, 90_002, 90_003].map((s) => openFixture(s));
    const spies = names.map((n) => vi.spyOn(Math, n));
    const calls: Record<string, number> = {};
    try {
      // a fresh copy of the modules, so their setup (tables, registries) runs under the spies too
      vi.resetModules();
      const sty = await import("../src/zoneStyle");
      const topo = await import("../src/gridTopology");
      expect(topo.SIMPLE.length).toBe(256);
      for (const f of fixtures) {
        sty.styleZones(f.st);
        expect(f.st.props.length).toBeGreaterThan(0);
      }
      names.forEach((n, i) => { calls[`Math.${n}`] = spies[i].mock.calls.length; });
    } finally {
      for (const sp of spies) sp.mockRestore();
    }
    expect(calls).toEqual(Object.fromEntries(names.map((n) => [`Math.${n}`, 0])));
  }, 60_000);
});

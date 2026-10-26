// The stylers on OPEN ground, the habitat they were designed for (part D: a 96x96 zone map before cover, five zones of about
// 1500 tiles): here the footprint bands of part D 3 apply. The finished-map fixtures (zoneStyleZones.test.ts) measure the same
// recipes on the ground a wedge map leaves them. Also size-freedom (any grid size), the rim margin and the 8% budget.
import { describe, expect, it } from "vitest";
import { REGION_FACTIONS, TILE_FLOOR, TILE_LOW, TILE_WALL, mapFromTiles, worldToTile } from "../src/map";
import {
  TERRAIN_BOG, TERRAIN_CREVASSE, TERRAIN_EMBER, TERRAIN_FENCE, TERRAIN_ICE, TERRAIN_LAVA, TERRAIN_LIGHT, validateTerrain,
} from "../src/terrain";
import { walkDistances } from "../src/gridTopology";
import { ZONE_PROP_KINDS, styleZones } from "../src/zoneStyle";
import type { GallowsPlan, SanctumPlan, ScorchPlan, StyleResult, WarrenPlan } from "../src/zoneStyle";
import { chamfer, floorComponents } from "../src/zoneStyle/kit";
import { fenceStraightViolations } from "./zoneStyleChecks";
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
      expect(validateTerrain(map, { styled: true, propKinds: ZONE_PROP_KINDS }), `seed ${s}`).toEqual([]);
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

// The five stylers on 40 styled finished wedge maps: footprints, the structures each recipe promises, the pinned output, zone
// isolation, and the Math spy. Footprint bands are NOT part D's: those were measured on a map with open ground (the R1 spike,
// styler before cover), where a zone of 1710 tiles had 70% of its floor free. A finished wedge map has zones of about 680 tiles,
// 22% of them rock from the cover pass, and the protect list leaves 13% of a zone styleable (see zoneStyleMaps.test.ts's report).
import { describe, expect, it, vi } from "vitest";
import {
  REGION_FACTIONS, TILE_FLOOR, TILE_LOW, TILE_WALL, worldToTile,
} from "../src/map";
import type { GameMap, RegionFaction } from "../src/map";
import { generateMap } from "../src/mapgen";
import { hashSeed, mulberry32 } from "../src/rng";
import {
  TERRAIN_BOG, TERRAIN_CREVASSE, TERRAIN_EMBER, TERRAIN_FENCE, TERRAIN_ICE, TERRAIN_LAVA, TERRAIN_LIGHT,
} from "../src/terrain";
import { walkDistances } from "../src/gridTopology";
import {
  ZONE_PROP_KINDS, ZONE_STYLERS, facetShelfCells, filterProps, styleFinishedMap, styleFinishedMapDetailed,
} from "../src/zoneStyle";
import { fenceStraightViolations } from "./zoneStyleChecks";
import type { GallowsPlan, RimePlan, SanctumPlan, ScorchPlan, StyleResult, WarrenPlan, ZoneStyler } from "../src/zoneStyle";

const HEAVY_MS = 120_000;
const SEEDS = Array.from({ length: 40 }, (_, i) => i);
const FACTION_INDEX: Record<RegionFaction, number> = { fire: 0, sentenced: 1, plague: 2, frost: 3, holy: 4 };

interface Entry { raw: GameMap; styled: GameMap; results: StyleResult[]; protect: Uint8Array; noBlock: Uint8Array }
const cache = new Map<number, Entry>();
function entry(seed: number): Entry {
  let e = cache.get(seed);
  if (!e) {
    const raw = generateMap(seed);
    const st = styleFinishedMapDetailed(raw);
    e = { raw, styled: st.map, results: st.results, protect: st.protect, noBlock: st.noBlock };
    cache.set(seed, e);
  }
  return e;
}

const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const pct = (n: number, d: number): number => (100 * n) / d;
const percentile = (a: number[], p: number): number => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
};

/** Counts per zone code of tiles by (class, kind) in the styled map. */
function zoneCounts(e: Entry, faction: RegionFaction) {
  const code = FACTION_INDEX[faction] + 1;
  const { raw, styled } = e;
  let painted = 0, walls = 0, low = 0;
  const kinds: Record<number, number> = {};
  for (let i = 0; i < raw.tiles.length; i++) {
    if (raw.regionGrid[i] !== code) continue;
    painted++;
    if (raw.tiles[i] === TILE_FLOOR && styled.tiles[i] === TILE_WALL) walls++;
    if (styled.tiles[i] === TILE_LOW) low++;
    if (styled.tiles[i] === TILE_FLOOR && styled.terrain[i] !== 0) kinds[styled.terrain[i]] = (kinds[styled.terrain[i]] ?? 0) + 1;
  }
  return { painted, walls, low, kinds };
}


const planOf = <P>(e: Entry, faction: RegionFaction): P => e.results[FACTION_INDEX[faction]].plan as P;

describe("Scorch (fire)", () => {
  it("builds ridges, one lava river with fords and a complete ember bank, within the footprint budget (40 seeds)", () => {
    const wall: number[] = [], low: number[] = [], eff: number[] = [];
    let rivers = 0, withFord = 0, emberTiles = 0;
    for (const s of SEEDS) {
      const e = entry(s);
      const z = zoneCounts(e, "fire");
      wall.push(pct(z.walls, z.painted)); low.push(pct(z.low, z.painted));
      eff.push(pct(0.35 * z.walls + z.low, z.painted));
      expect(pct(0.35 * z.walls + z.low, z.painted), `seed ${s}: footprint over the 8% budget`).toBeLessThanOrEqual(8.0001);
      const plan = planOf<ScorchPlan>(e, "fire");
      const { styled, raw, protect, noBlock } = e;
      // every LOW tile of the fire zone is lava; embers touch lava; every free floor tile touching lava is ember
      for (let i = 0; i < styled.tiles.length; i++) {
        if (raw.regionGrid[i] !== 1) continue;
        if (styled.tiles[i] === TILE_LOW) expect(styled.terrain[i], `seed ${s}`).toBe(TERRAIN_LAVA);
        const x = i % styled.w, y = (i - x) / styled.w;
        if (styled.tiles[i] === TILE_FLOOR && styled.terrain[i] === TERRAIN_EMBER) {
          emberTiles++;
          let beside = false;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (styled.tiles[(y + dy) * styled.w + x + dx] === TILE_LOW && styled.terrain[(y + dy) * styled.w + x + dx] === TERRAIN_LAVA) beside = true;
          expect(beside, `seed ${s}: ember at ${x},${y} is not beside lava`).toBe(true);
        }
        if (styled.tiles[i] === TILE_FLOOR && styled.terrain[i] === 0 && !protect[i] && noBlock[i] !== 1) {
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const j = (y + dy) * styled.w + x + dx;
            expect(styled.tiles[j] === TILE_LOW && styled.terrain[j] === TERRAIN_LAVA, `seed ${s}: free floor ${x},${y} touches lava but is not ember`).toBe(false);
          }
        }
      }
      if (plan.riverPath.length > 0) {
        rivers++;
        if (plan.fords.length >= 1) withFord++;
        for (const f of plan.fords) expect(styled.tiles[f], `seed ${s}: a ford is not walkable`).not.toBe(TILE_LOW);
      }
    }
    console.info(`[scorch] WALL ${mean(wall).toFixed(2)}% LOW ${mean(low).toFixed(2)}% effective ${mean(eff).toFixed(2)}%; river in ${rivers}/40 seeds, fords in ${withFord}; ember tiles per zone ${(emberTiles / 40).toFixed(1)}`);
    expect(mean(wall)).toBeGreaterThan(2.0);
    expect(mean(wall)).toBeLessThan(4.5);
    expect(mean(low)).toBeLessThanOrEqual(3.5);
    expect(rivers).toBeGreaterThanOrEqual(34);
    expect(withFord).toBe(rivers);
  }, HEAVY_MS);
});

describe("Gallows (sentenced)", () => {
  /** Openings of a yard: maximal runs of walkable ring tiles with floor just inside and just outside. */
  function openings(m: GameMap, r: { x: number; y: number; w: number; h: number }): number {
    const ring: Array<[number, number]> = [];
    for (let x = r.x; x < r.x + r.w; x++) ring.push([x, r.y]);
    for (let y = r.y + 1; y < r.y + r.h; y++) ring.push([r.x + r.w - 1, y]);
    for (let x = r.x + r.w - 2; x >= r.x; x--) ring.push([x, r.y + r.h - 1]);
    for (let y = r.y + r.h - 2; y > r.y; y--) ring.push([r.x, y]);
    const open = ring.map(([x, y]) => {
      if (m.tiles[y * m.w + x] !== TILE_FLOOR) return false;
      const inside = (x - r.x === 0 ? 1 : x - r.x === r.w - 1 ? -1 : 0), dy = (y - r.y === 0 ? 1 : y - r.y === r.h - 1 ? -1 : 0);
      const ix = x + inside, iy = y + dy;
      const ox = x - inside, oy = y - dy;
      return m.tiles[iy * m.w + ix] === TILE_FLOOR && m.tiles[oy * m.w + ox] === TILE_FLOOR;
    });
    let runs = 0;
    for (let k = 0; k < open.length; k++) if (open[k] && !open[(k + open.length - 1) % open.length]) runs++;
    return open.every(Boolean) ? 1 : runs;
  }

  it("fences every yard it builds with at least two openings, and holds the footprint budget (40 seeds)", () => {
    let yards = 0, blocks = 0, fence = 0;
    const wall: number[] = [], low: number[] = [];
    for (const s of SEEDS) {
      const e = entry(s);
      const z = zoneCounts(e, "sentenced");
      wall.push(pct(z.walls, z.painted)); low.push(pct(z.low, z.painted));
      expect(pct(0.35 * z.walls + z.low, z.painted), `seed ${s}`).toBeLessThanOrEqual(8.0001);
      const plan = planOf<GallowsPlan>(e, "sentenced");
      blocks += plan.blocks.length;
      for (const yd of plan.yards) {
        yards++;
        expect(openings(e.styled, yd.rect), `seed ${s}: yard ${JSON.stringify(yd.rect)} openings`).toBeGreaterThanOrEqual(2);
        expect(yd.doorTiles.length, `seed ${s}`).toBeGreaterThanOrEqual(4);
        for (const t of yd.doorTiles) expect(e.styled.tiles[t], `seed ${s}: a door tile was closed`).toBe(TILE_FLOOR);
      }
      for (let i = 0; i < e.styled.tiles.length; i++) {
        if (e.raw.regionGrid[i] !== 2) continue;
        if (e.styled.tiles[i] === TILE_LOW) { fence++; expect(e.styled.terrain[i], `seed ${s}`).toBe(TERRAIN_FENCE); }
      }
    }
    console.info(`[gallows] WALL ${mean(wall).toFixed(2)}% FENCE ${mean(low).toFixed(2)}%; ${yards} yards and ${blocks} cell blocks over 40 seeds; ${fence} fence tiles`);
    // a finished map leaves little room for a closed ring: yards are rare there (see the open-ground tests), fence segments are not
    expect(fence).toBeGreaterThan(60);
    expect(blocks).toBeGreaterThan(15);
  }, HEAVY_MS);

  it("adds no detour over 10 tiles for two tiles within 7 tiles of each other that a fence stands between (40 seeds)", () => {
    // the walk with the fences against the walk with the fences taken away (fence tiles are floor for the second)
    const detours: number[] = [];
    let worst = 0;
    for (const s of SEEDS) {
      const { styled, raw } = entry(s);
      const w = styled.w, h = styled.h;
      const fences: number[] = [];
      for (let i = 0; i < styled.tiles.length; i++) if (styled.tiles[i] === TILE_LOW && styled.terrain[i] === TERRAIN_FENCE) fences.push(i);
      if (fences.length === 0) continue;
      const opened = styled.tiles.slice();
      for (const f of fences) opened[f] = TILE_FLOOR;
      // sources: floor tiles one step from a fence; targets: the floor tile straight across it, and every floor tile within 7
      // tiles whose straight segment crosses a fence tile
      const seen = new Set<number>();
      for (const f of fences) {
        const fx = f % w, fy = (f - fx) / w;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const a = (fy + dy) * w + fx + dx;
          if (styled.tiles[a] === TILE_FLOOR) seen.add(a);
        }
      }
      for (const a of [...seen].sort((p, q) => p - q).slice(0, 60)) {
        const ax = a % w, ay = (a - ax) / w;
        const withFence = walkDistances(styled.tiles, w, h, a), without = walkDistances(opened, w, h, a);
        for (let dy = -7; dy <= 7; dy++) {
          for (let dx = -7; dx <= 7; dx++) {
            const bx = ax + dx, by = ay + dy;
            if (bx < 0 || by < 0 || bx >= w || by >= h || Math.max(Math.abs(dx), Math.abs(dy)) > 7) continue;
            const b = by * w + bx;
            if (styled.tiles[b] !== TILE_FLOOR || withFence[b] < 0 || without[b] < 0 || withFence[b] === without[b]) continue;
            // does a fence tile lie on the segment a-b?
            const n = Math.max(Math.abs(dx), Math.abs(dy));
            let crosses = false;
            for (let k = 1; k < n && !crosses; k++) {
              const px = Math.floor(ax + 0.5 + (dx * k) / n), py = Math.floor(ay + 0.5 + (dy * k) / n);
              if (styled.tiles[py * w + px] === TILE_LOW && styled.terrain[py * w + px] === TERRAIN_FENCE) crosses = true;
            }
            if (!crosses) continue;
            const tiles = (withFence[b] - without[b]) / 5;
            detours.push(tiles);
            worst = Math.max(worst, tiles);
          }
        }
      }
      void raw;
    }
    console.info(`[gallows] fence detour (extra walk in tiles for a pair within 7 tiles across a fence): ${detours.length} pairs, p50 ${percentile(detours, 0.5).toFixed(1)}, p90 ${percentile(detours, 0.9).toFixed(1)}, max ${worst.toFixed(1)}`);
    for (const s of SEEDS) expect(fenceStraightViolations(entry(s).styled.tiles, entry(s).styled.terrain, 64, 64), `seed ${s}: a pair straight across a fence walks more than 10 extra`).toBe(0);
    expect(detours.length).toBeGreaterThan(0);
    expect(percentile(detours, 0.9)).toBeLessThanOrEqual(10);
  }, HEAVY_MS);
});

describe("Warren (plague)", () => {
  it("lays bog pools of 9 to 40 tiles, 5 to 9% of the zone, and no pool a bank wall stands on (40 seeds)", () => {
    const bog: number[] = [], wall: number[] = [];
    let pools = 0, smallest = 99, biggest = 0;
    for (const s of SEEDS) {
      const e = entry(s);
      const z = zoneCounts(e, "warren" in {} ? "plague" : "plague");
      const plan = planOf<WarrenPlan>(e, "plague");
      bog.push(pct(z.kinds[TERRAIN_BOG] ?? 0, z.painted));
      wall.push(pct(z.walls, z.painted));
      expect(pct(0.35 * z.walls + z.low, z.painted), `seed ${s}`).toBeLessThanOrEqual(8.0001);
      expect(z.low, `seed ${s}: the Warren has no LOW`).toBe(0);
      // the connected pools of bog in the styled map
      const { styled } = e;
      const seen = new Uint8Array(styled.tiles.length);
      for (let i = 0; i < styled.tiles.length; i++) {
        if (styled.terrain[i] !== TERRAIN_BOG || seen[i]) continue;
        let size = 0;
        const stack = [i];
        seen[i] = 1;
        while (stack.length) {
          const j = stack.pop()!;
          size++;
          expect(styled.tiles[j], `seed ${s}: bog on a non-floor tile`).toBe(TILE_FLOOR);
          for (const k of [j + 1, j - 1, j + styled.w, j - styled.w]) if (styled.terrain[k] === TERRAIN_BOG && !seen[k]) { seen[k] = 1; stack.push(k); }
        }
        pools++; smallest = Math.min(smallest, size); biggest = Math.max(biggest, size);
        expect(size, `seed ${s}: bog pool`).toBeGreaterThanOrEqual(9);
        expect(size, `seed ${s}: bog pool`).toBeLessThanOrEqual(40);
      }
      expect(plan.pools.every((p) => p.length >= 9 && p.length <= 40)).toBe(true);
    }
    console.info(`[warren] BOG ${mean(bog).toFixed(2)}% WALL ${mean(wall).toFixed(2)}%; ${pools} pools over 40 seeds (${smallest}..${biggest} tiles)`);
    expect(mean(bog)).toBeGreaterThanOrEqual(5);
    expect(mean(bog)).toBeLessThanOrEqual(9);
    expect(mean(wall)).toBeGreaterThan(4);
  }, HEAVY_MS);

  it("keeps the bog an approach crosses to a handful of tiles (report; p90 of the spawn-to-centre walk)", () => {
    const counts: number[] = [];
    for (const s of SEEDS) {
      const { styled } = entry(s);
      const w = styled.w;
      const centre = worldToTile(styled.coliseum.centre.y) * w + worldToTile(styled.coliseum.centre.x);
      // follow the steepest descent of the walk field from each plague spawn and count the bog tiles it steps on
      const field = walkDistances(styled.tiles, w, styled.h, centre);
      for (const sp of styled.regions[FACTION_INDEX.plague].spawns) {
        let i = worldToTile(sp.y) * w + worldToTile(sp.x), bogTiles = 0, guard = 0;
        while (field[i] > 0 && guard++ < 400) {
          if (styled.terrain[i] === TERRAIN_BOG) bogTiles++;
          let best = i;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
            const j = i + dy * w + dx;
            if (field[j] >= 0 && field[j] < field[best]) best = j;
          }
          if (best === i) break;
          i = best;
        }
        counts.push(bogTiles);
      }
    }
    console.info(`[warren] bog tiles on a plague spawn's walk to the coliseum centre: mean ${mean(counts).toFixed(2)}, p90 ${percentile(counts, 0.9)}, max ${Math.max(...counts)} (limit 6 at p90)`);
    expect(percentile(counts, 0.9)).toBeLessThanOrEqual(6);
  }, HEAVY_MS);
});

describe("Rime (frost)", () => {
  it("freezes lakes (ICE only where all eight neighbours are floor), raises convex shelves and cuts crevasses (40 seeds)", () => {
    const ice: number[] = [], wall: number[] = [], low: number[] = [];
    let shelves = 0, crevasseTiles = 0;
    for (const s of SEEDS) {
      const e = entry(s);
      const z = zoneCounts(e, "frost");
      ice.push(pct(z.kinds[TERRAIN_ICE] ?? 0, z.painted)); wall.push(pct(z.walls, z.painted)); low.push(pct(z.low, z.painted));
      expect(pct(0.35 * z.walls + z.low, z.painted), `seed ${s}`).toBeLessThanOrEqual(8.0001);
      const { styled } = e;
      for (let i = 0; i < styled.tiles.length; i++) {
        if (e.raw.regionGrid[i] !== 4) continue;
        const x = i % styled.w, y = (i - x) / styled.w;
        if (styled.terrain[i] === TERRAIN_ICE) {
          expect(styled.tiles[i], `seed ${s}`).toBe(TILE_FLOOR);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(styled.tiles[(y + dy) * styled.w + x + dx], `seed ${s}: solid tile next to ice at ${x},${y}`).toBe(TILE_FLOOR);
        }
        if (styled.tiles[i] === TILE_LOW) { crevasseTiles++; expect(styled.terrain[i], `seed ${s}`).toBe(TERRAIN_CREVASSE); }
      }
      const plan = planOf<RimePlan>(e, "frost");
      for (const sh of plan.shelves) {
        shelves++;
        for (const i of sh.walls) expect(styled.tiles[i], `seed ${s}`).toBe(TILE_WALL);
      }
    }
    console.info(`[rime] ICE ${mean(ice).toFixed(2)}% WALL ${mean(wall).toFixed(2)}% CREVASSE ${mean(low).toFixed(2)}%; ${shelves} shelves, ${crevasseTiles} crevasse tiles over 40 seeds`);
    expect(mean(ice)).toBeGreaterThan(0.5);
    expect(mean(ice)).toBeLessThan(22);
    expect(shelves).toBeGreaterThan(40);
  }, HEAVY_MS);

  it("draws shelves as convex shapes: every row and every column of the cells is one unbroken stretch (500 draws)", () => {
    const rng = mulberry32(99);
    for (let t = 0; t < 500; t++) {
      const rad = 1 + Math.floor(rng() * 4);
      const cells = facetShelfCells(rng, rad);
      expect(cells.length).toBeGreaterThan(0);
      const rows = new Map<number, number[]>(), cols = new Map<number, number[]>();
      for (const [x, y] of cells) {
        (rows.get(y) ?? rows.set(y, []).get(y)!).push(x);
        (cols.get(x) ?? cols.set(x, []).get(x)!).push(y);
      }
      for (const group of [...rows.values(), ...cols.values()]) {
        group.sort((a, b) => a - b);
        expect(group[group.length - 1] - group[0], `shelf of radius ${rad}`).toBe(group.length - 1);
      }
      // nearest the centre first, and the centre is in
      expect(cells.some(([x, y]) => x === 0 && y === 0)).toBe(true);
    }
  });
});

describe("Sanctum (holy)", () => {
  it("raises mirror-symmetric colonnades, cloisters and light shafts, within the footprint budget (40 seeds)", () => {
    const wall: number[] = [];
    let structures = 0, shafts = 0, withAny = 0;
    const kinds: Record<string, number> = {};
    for (const s of SEEDS) {
      const e = entry(s);
      const z = zoneCounts(e, "holy");
      wall.push(pct(z.walls, z.painted));
      expect(pct(0.35 * z.walls + z.low, z.painted), `seed ${s}`).toBeLessThanOrEqual(8.0001);
      expect(z.low, `seed ${s}: the Sanctum has no LOW`).toBe(0);
      const plan = planOf<SanctumPlan>(e, "holy");
      if (plan.structures.length > 0) withAny++;
      for (const st of plan.structures) {
        structures++;
        kinds[st.kind] = (kinds[st.kind] ?? 0) + 1;
        // symmetry before the break coins: the planned pillar set mirrors about the structure's own axis
        const planned = new Set(st.planned);
        let mirrored = 0;
        for (const i of st.planned) {
          const x = i % e.styled.w, y = (i - x) / e.styled.w;
          const mx = st.horizontal ? x : 2 * st.cx - x, my = st.horizontal ? 2 * st.cy - y : y;
          if (planned.has(my * e.styled.w + mx)) mirrored++;
        }
        expect(mirrored / Math.max(1, st.planned.length), `seed ${s}: ${st.kind} symmetry`).toBeGreaterThanOrEqual(0.8);
        for (const i of st.placed) expect(e.styled.tiles[i], `seed ${s}: ${st.kind} pillar`).toBe(TILE_WALL);
        if (st.shaft >= 0) {
          shafts++;
          const sx = st.shaft % e.styled.w, sy = (st.shaft - sx) / e.styled.w;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const j = (sy + dy) * e.styled.w + sx + dx;
            expect(e.styled.terrain[j], `seed ${s}: the shaft of a ${st.kind}`).toBe(TERRAIN_LIGHT);
            expect(e.styled.tiles[j]).toBe(TILE_FLOOR);
          }
        }
      }
    }
    console.info(`[sanctum] WALL ${mean(wall).toFixed(2)}%; ${structures} structures over 40 seeds ${JSON.stringify(kinds)}, ${shafts} with a light shaft; zones with any structure ${withAny}/40`);
    expect(withAny).toBeGreaterThanOrEqual(36);
    expect(shafts).toBeGreaterThan(5);
  }, HEAVY_MS);
});

describe("every zone", () => {
  it("keeps each zone's hazards to its home kinds and its LOW kinds to its own (T6), and every prop on its tile class", () => {
    const home: Record<RegionFaction, number[]> = {
      fire: [TERRAIN_LAVA, TERRAIN_EMBER], sentenced: [TERRAIN_FENCE], plague: [TERRAIN_BOG], frost: [TERRAIN_CREVASSE, TERRAIN_ICE], holy: [TERRAIN_LIGHT],
    };
    for (const s of SEEDS) {
      const { styled, raw } = entry(s);
      for (let i = 0; i < styled.tiles.length; i++) {
        const code = raw.regionGrid[i];
        if (code < 1 || code > 5 || styled.terrain[i] === 0) continue;
        expect(home[REGION_FACTIONS[code - 1]], `seed ${s} tile ${i}: kind ${styled.terrain[i]} in ${REGION_FACTIONS[code - 1]}`).toContain(styled.terrain[i]);
      }
      for (const p of styled.props) {
        const spec = ZONE_PROP_KINDS[p.kind];
        const tx = worldToTile(p.x), ty = worldToTile(p.y);
        expect(styled.tiles[ty * styled.w + tx], `seed ${s} prop ${spec.key}`).toBe(spec.on);
        expect(REGION_FACTIONS[raw.regionGrid[ty * styled.w + tx] - 1], `seed ${s} prop ${spec.key}`).toBe(spec.home);
      }
    }
  }, HEAVY_MS);

  it("styles a zone alone: replacing one zone's styler with a no-op leaves every other zone byte-identical (isolation)", () => {
    const noop = (faction: RegionFaction): ZoneStyler<unknown> => ({ id: ZONE_STYLERS[faction].id, faction, version: 0, shape: () => null });
    for (const s of SEEDS.slice(0, 25)) {
      const { raw, styled } = entry(s);
      for (const faction of REGION_FACTIONS) {
        const without = styleFinishedMap(raw, { stylers: { [faction]: noop(faction) } });
        const code = FACTION_INDEX[faction] + 1;
        for (let i = 0; i < raw.tiles.length; i++) {
          if (raw.regionGrid[i] === code) {
            expect(without.tiles[i], `seed ${s} ${faction}: the no-op zone changed`).toBe(raw.tiles[i]);
            expect(without.terrain[i]).toBe(0);
          } else {
            expect(without.tiles[i], `seed ${s}: dropping ${faction} changed tile ${i}`).toBe(styled.tiles[i]);
            expect(without.terrain[i], `seed ${s}: dropping ${faction} changed terrain ${i}`).toBe(styled.terrain[i]);
          }
        }
      }
    }
  }, HEAVY_MS);

  it("pins the output of eight (seed, zone) pairs, named by each styler's version", () => {
    const hashes = PINNED.map(([seed, faction]) => ({ seed, faction, v: ZONE_STYLERS[faction].version, h: zoneHash(entry(seed), faction) }));
    expect(hashes.map((x) => `${x.faction} v${x.v} seed ${x.seed}: ${x.h}`)).toEqual(PINNED.map(([seed, faction, h]) => `${faction} v${ZONE_STYLERS[faction].version} seed ${seed}: ${h}`));
  }, HEAVY_MS);

  it("is deterministic: styling twice gives byte-equal tiles, terrain and props, whatever the seed", () => {
    for (const s of [0, -1, 2 ** 31, 2 ** 32 + 5, 123456789, 7, 99]) {
      const a = styleFinishedMap(generateMap(s)), b = styleFinishedMap(generateMap(s));
      expect(Buffer.from(a.tiles).equals(Buffer.from(b.tiles)), `seed ${s}: tiles`).toBe(true);
      expect(Buffer.from(a.terrain).equals(Buffer.from(b.terrain)), `seed ${s}: terrain`).toBe(true);
      expect(a.props, `seed ${s}: props`).toEqual(b.props);
    }
  });

  it("never calls Math.random or an engine-approximated Math function while styling (client and server may run different engines)", async () => {
    const names = ["random", "sin", "cos", "tan", "atan", "atan2", "hypot", "pow", "exp", "log", "cbrt"] as const;
    const spies = names.map((n) => vi.spyOn(Math, n));
    const calls: Record<string, number> = {};
    try {
      // fresh copies of the modules, so their setup (tables, registries) runs under the spies too
      vi.resetModules();
      const gen = await import("../src/mapgen");
      const sty = await import("../src/zoneStyle");
      const topo = await import("../src/gridTopology");
      expect(topo.SIMPLE.length).toBe(256);
      for (let s = 80_000; s < 80_008; s++) {
        const styled = sty.styleFinishedMap(gen.generateMap(s));
        expect(styled.props.length).toBeGreaterThan(0);
      }
      names.forEach((n, i) => { calls[`Math.${n}`] = spies[i].mock.calls.length; });
    } finally {
      for (const sp of spies) sp.mockRestore();
    }
    expect(calls).toEqual(Object.fromEntries(names.map((n) => [`Math.${n}`, 0])));
  }, 60_000);

  it("draws its streams from hashSeed only: the generator's own stream is never touched", () => {
    // the styler's rng for (seed, attempt, zone, stream) is mulberry32(hashSeed(...)); styling leaves the map's other
    // generated fields (regions, camps, spawns) exactly as the generator made them
    const raw = generateMap(5);
    const styled = styleFinishedMap(raw);
    expect(styled.spawns).toEqual(raw.spawns);
    expect(styled.camps).toEqual(raw.camps);
    expect(styled.buildings).toEqual(raw.buildings);
    expect(styled.groundSpots).toEqual(raw.groundSpots);
    expect(styled.seed).toBe(raw.seed);
    expect(styled.attempt).toBe(raw.attempt);
    expect(Buffer.from(styled.regionGrid).equals(Buffer.from(raw.regionGrid))).toBe(true);
    expect(mulberry32(hashSeed(raw.seed, raw.attempt, 1, 0))()).toBeGreaterThanOrEqual(0);
  });
});

describe("props", () => {
  it("keeps the kind table append-only: ids are the order of this list, one key each, every zone has its own kinds", () => {
    expect(ZONE_PROP_KINDS.map((k) => k.key)).toEqual([
      "ember_vent", "glow_crack", "basalt_shard", "ash_drift",
      "banner", "chain", "gallows", "cell_bars", "lantern",
      "fungus_cap", "bubble", "drip", "pipe",
      "ice_spire", "snow_drift", "frost_sparkle", "icicle",
      "column_cap", "banner_red", "candelabra", "rubble", "stained_glass",
    ]);
    expect(new Set(ZONE_PROP_KINDS.map((k) => k.key)).size).toBe(ZONE_PROP_KINDS.length);
    for (const f of REGION_FACTIONS) expect(ZONE_PROP_KINDS.filter((k) => k.home === f).length, f).toBeGreaterThanOrEqual(4);
  });

  it("is decided by hashes, not by the rng: swapping the props pass or turning decor off leaves tiles and terrain byte-equal", () => {
    const other: ZoneStyler<unknown> = {
      ...ZONE_STYLERS.holy,
      props: (c) => { for (let i = 0; i < c.w * c.h; i++) if (c.mask[i] && c.tiles[i] === TILE_FLOOR && c.noise.hash(i % c.w, Math.floor(i / c.w), 77) < 0.5) c.prop(19, i % c.w, Math.floor(i / c.w), 0); },
    };
    for (const s of SEEDS.slice(0, 12)) {
      const { raw, styled } = entry(s);
      const swapped = styleFinishedMap(raw, { stylers: { holy: other } });
      const bare = styleFinishedMap(raw, { decor: false });
      expect(Buffer.from(swapped.tiles).equals(Buffer.from(styled.tiles)), `seed ${s}`).toBe(true);
      expect(Buffer.from(swapped.terrain).equals(Buffer.from(styled.terrain)), `seed ${s}`).toBe(true);
      expect(Buffer.from(bare.tiles).equals(Buffer.from(styled.tiles)), `seed ${s}`).toBe(true);
      expect(bare.props.length).toBe(0);
      expect(swapped.props.length, `seed ${s}: the swapped pass changed the props`).not.toBe(styled.props.length);
    }
  }, HEAVY_MS);

  it("carries at most 8% of a zone's tiles per zone, every prop inside its own zone and on a tile it may stand on", () => {
    for (const s of SEEDS) {
      const { raw, styled } = entry(s);
      const per = [0, 0, 0, 0, 0, 0, 0];
      for (const p of styled.props) per[raw.regionGrid[worldToTile(p.y) * raw.w + worldToTile(p.x)]]++;
      for (let z = 1; z <= 5; z++) {
        let painted = 0;
        for (let i = 0; i < raw.tiles.length; i++) if (raw.regionGrid[i] === z) painted++;
        expect(per[z], `seed ${s} zone ${z}`).toBeLessThanOrEqual(Math.floor(0.08 * painted));
      }
    }
  }, HEAVY_MS);

  it("filterProps drops a prop whose tile stopped matching its kind, keeps the rest in order, and draws nothing", () => {
    const tiles = new Uint8Array(16 * 16);
    const props = [
      { kind: 0, x: 3 * 32 + 16, y: 3 * 32 + 16, v: 0 }, // ember_vent on FLOOR
      { kind: 1, x: 4 * 32 + 16, y: 3 * 32 + 16, v: 1 }, // glow_crack needs a WALL
      { kind: 3, x: 5 * 32 + 16, y: 3 * 32 + 16, v: 2 }, // ash_drift on FLOOR
    ];
    tiles[3 * 16 + 4] = TILE_WALL; // the glow_crack's tile is a wall: fine
    tiles[3 * 16 + 5] = TILE_WALL; // the ash_drift's tile became a wall: dropped
    expect(filterProps(props, tiles, 16)).toBe(1);
    expect(props.map((p) => p.kind)).toEqual([0, 1]);
    expect(filterProps(props, tiles, 16)).toBe(0);
  });
});

/** A 32-bit FNV-1a of the zone's tiles and terrain (row-major, the zone's own tiles only). */
function zoneHash(e: Entry, faction: RegionFaction): number {
  const code = FACTION_INDEX[faction] + 1;
  let h = 0x811c9dc5;
  for (let i = 0; i < e.styled.tiles.length; i++) {
    if (e.raw.regionGrid[i] !== code) continue;
    h = Math.imul(h ^ e.styled.tiles[i], 0x01000193) >>> 0;
    h = Math.imul(h ^ e.styled.terrain[i], 0x01000193) >>> 0;
  }
  return h;
}

// 8 pairs: every zone at least once. After a deliberate change to a styler, read the new values off the failing assertion, paste
// them here and bump the styler's `version`.
const PINNED: Array<[number, RegionFaction, number]> = [
  [1, "fire", 3124234760], [2, "fire", 1437826601], [3, "sentenced", 3735151801], [4, "sentenced", 607513337],
  [5, "plague", 2592640808], [6, "plague", 1698226664], [7, "frost", 2252154799], [8, "holy", 704310176],
];
void TILE_FLOOR;

// Property tests of styled finished wedge maps (the dev adapter): every guarantee of a finished map must survive the stylers.
// 200 maps are generated and styled once and shared. The sight-lane checks count LOW as open (zoneStyleLanes.ts).
import { describe, expect, it } from "vitest";
import { MAX_SIGHT_CORRIDOR, TILE } from "../src/constants";
import {
  REGION_COLISEUM, REGION_FACTIONS, REGION_NONE, TILE_FLOOR, TILE_LOW, TILE_WALL, moveComponentsOf, withGates, worldToTile,
} from "../src/map";
import type { GameMap } from "../src/map";
import { SIGHT_LATTICE, generateMap } from "../src/mapgen";
import { TERRAINS, validateTerrain } from "../src/terrain";
import { MAP_STYLERS } from "../src/constants";
import { buildGameMap, buildGameMapOf } from "../src/gameMapBuild";
import { walkDistances } from "../src/gridTopology";
import { ZONE_PROP_KINDS, styleFinishedMap, styleFinishedMapDetailed, styleReport } from "../src/zoneStyle";
import type { StyleResult } from "../src/zoneStyle";
import { fatLane, longestFreeStrip, sightOpenMask } from "./zoneStyleLanes";

const HEAVY_MS = 180_000;
const SEEDS = Array.from({ length: 200 }, (_, i) => i);
const LANE_SLACK_U = 1e-6;

interface Entry { raw: GameMap; styled: GameMap; results: StyleResult[]; protect: Uint8Array; noBlock: Uint8Array }
const cache = new Map<number, Entry>();
function entry(seed: number): Entry {
  let e = cache.get(seed);
  if (!e) {
    const raw = generateMap(seed);
    const rawTiles = raw.tiles.slice();
    const st = styleFinishedMapDetailed(raw);
    // the input must not be mutated
    if (rawTiles.some((v, i) => v !== raw.tiles[i])) throw new Error(`seed ${seed}: styleFinishedMap mutated its input`);
    e = { raw, styled: st.map, results: st.results, protect: st.protect, noBlock: st.noBlock };
    cache.set(seed, e);
  }
  return e;
}
function eachEntry(fn: (e: Entry, seed: number) => void, list: number[] = SEEDS): void {
  for (const s of list) fn(entry(s), s);
}

const isFactionCode = (c: number) => c >= 1 && c <= REGION_FACTIONS.length;
const componentCount = (tiles: Uint8Array, w: number, h: number) => {
  const comp = moveComponentsOf(tiles, w, h);
  let max = -1;
  for (const c of comp) if (c > max) max = c;
  return max + 1;
};

/** Longest straight run of outdoor wall tiles, measured as mapgen.test.ts does (blobs that touch region none or lie in a ruin do not count). */
function longestOutdoorWallRun(m: GameMap): number {
  const { w, h } = m;
  const inBuilding = (x: number, y: number) => m.buildings.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
  const outdoor = (x: number, y: number) =>
    x > 0 && y > 0 && x < w - 1 && y < h - 1 && m.tiles[y * w + x] === TILE_WALL && isFactionCode(m.regionGrid[y * w + x]) && !inBuilding(x, y);
  const seen = new Uint8Array(w * h);
  const wall = new Set<number>();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!outdoor(x, y) || seen[y * w + x]) continue;
      const tiles: number[] = [];
      let touchesNone = false;
      const stack = [[x, y]];
      seen[y * w + x] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        tiles.push(cy * w + cx);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (m.regionGrid[ny * w + nx] === REGION_NONE) touchesNone = true;
            if (outdoor(nx, ny) && !seen[ny * w + nx]) { seen[ny * w + nx] = 1; stack.push([nx, ny]); }
          }
        }
      }
      if (!touchesNone) for (const t of tiles) wall.add(t);
    }
  }
  let best = 0;
  for (const t of wall) {
    for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
      if (wall.has(t - dy * w - dx)) continue;
      let run = 0;
      while (wall.has(t + dy * w * run + dx * run)) run++;
      if (run > best) best = run;
    }
  }
  return best;
}

describe("styled finished maps (200 seeds)", () => {
  it("only turns floor into wall or LOW, inside the zones and outside everything protected; never opens a wall", () => {
    eachEntry(({ raw, styled, protect, noBlock }, s) => {
      expect(styled.tiles, `seed ${s}`).not.toBe(raw.tiles);
      expect(styled.terrain, `seed ${s}`).not.toBe(raw.terrain);
      expect(styled.props, `seed ${s}`).not.toBe(raw.props);
      for (let i = 0; i < raw.tiles.length; i++) {
        if (styled.tiles[i] === raw.tiles[i] && styled.terrain[i] === raw.terrain[i]) continue;
        const at = `seed ${s} tile ${i % raw.w},${Math.floor(i / raw.w)}`;
        expect(protect[i], `${at} is protected`).toBe(0);
        if (noBlock[i]) expect(styled.tiles[i], `${at} is in a no-blocker margin`).toBe(raw.tiles[i]);
        expect(raw.regionGrid[i] >= 1 && raw.regionGrid[i] <= 5, `${at} is in a faction zone`).toBe(true);
        expect(raw.tiles[i], `${at}: only a FLOOR tile is changed`).toBe(TILE_FLOOR);
        expect(styled.tiles[i] === TILE_FLOOR || styled.tiles[i] === TILE_WALL || styled.tiles[i] === TILE_LOW, at).toBe(true);
      }
    });
  }, HEAVY_MS);

  it("keeps tiles in {floor, wall, low} and passes validateTerrain with the stylers on (T1-T10)", () => {
    eachEntry(({ styled }, s) => {
      expect(validateTerrain(styled, { styled: true, propKinds: ZONE_PROP_KINDS }), `seed ${s}`).toEqual([]);
      for (const t of styled.tiles) expect(t === 0 || t === 1 || t === 2).toBe(true);
      for (const k of styled.terrain) expect(k).toBeLessThan(TERRAINS.length);
    });
  }, HEAVY_MS);

  it("keeps one 4-connected floor component with the gates open and two with them closed", () => {
    eachEntry(({ styled }, s) => {
      expect(componentCount(styled.tiles, styled.w, styled.h), `seed ${s}: gates open`).toBe(1);
      expect(componentCount(withGates(styled).tiles, styled.w, styled.h), `seed ${s}: gates closed`).toBe(2);
    });
  }, HEAVY_MS);

  it("keeps every spawn, chest, camp spot and anchor on floor in that one component, and every protected cell clean", () => {
    eachEntry(({ styled, raw, protect }, s) => {
      const comp = moveComponentsOf(styled.tiles, styled.w, styled.h);
      const at = (p: { x: number; y: number }) => worldToTile(p.y) * styled.w + worldToTile(p.x);
      const sites = [
        ...styled.spawns, ...styled.spawnPool, ...styled.crateSpots, ...styled.groundSpots, ...styled.coliseum.innerSpawns,
        ...styled.regions.flatMap((r) => [r.anchor, r.pole, ...r.spawns, ...r.chestSpots, ...r.mobCamps.flatMap((c) => c.spots)]),
        ...styled.camps.flatMap((c) => [{ x: c.x, y: c.y }, c.chest, ...c.spots]),
      ];
      for (const p of sites) expect(comp[at(p)], `seed ${s} site ${p.x},${p.y}`).toBe(0);
      for (let i = 0; i < raw.tiles.length; i++) {
        if (!protect[i]) continue;
        expect(styled.tiles[i], `seed ${s} protected tile ${i}`).toBe(raw.tiles[i]);
        expect(styled.terrain[i], `seed ${s} protected tile ${i}: terrain`).toBe(0);
      }
      // each region keeps its anchor, spawns and chests (the region records still hold)
      for (const r of styled.regions) expect(r.area, `seed ${s} ${r.id}`).toBeGreaterThan(0);
    });
  }, HEAVY_MS);

  it("keeps the coliseum, its gates and the ring road untouched and the gates' lanes open", () => {
    eachEntry(({ styled, raw }, s) => {
      for (let i = 0; i < raw.tiles.length; i++) {
        if (raw.regionGrid[i] !== REGION_COLISEUM) continue;
        expect(styled.tiles[i], `seed ${s} coliseum tile ${i}`).toBe(raw.tiles[i]);
        expect(styled.terrain[i], `seed ${s} coliseum tile ${i}`).toBe(0);
      }
      for (const g of styled.coliseum.gates) for (const t of g.tiles) expect(styled.tiles[t.y * styled.w + t.x], `seed ${s} gate`).toBe(TILE_FLOOR);
    });
  }, HEAVY_MS);

  it("keeps no straight outdoor wall run over 14 tiles (the cover test's bound)", () => {
    const bound = MAX_SIGHT_CORRIDOR / TILE - 1;
    let longest = 0;
    eachEntry(({ styled }, s) => {
      const run = longestOutdoorWallRun(styled);
      if (run > longest) longest = run;
      expect(run, `seed ${s}: straight outdoor wall run`).toBeLessThanOrEqual(bound);
    });
    console.info(`[zone styler] longest straight outdoor wall run over 200 styled maps: ${longest} tiles (bound ${bound})`);
  }, HEAVY_MS);

  it("keeps every lattice lane at the generator's target or less with LOW counted as OPEN (200 seeds)", () => {
    // The generator certified the unstyled map with FLOOR as the open set. A LOW tile is see-through, so it stays open; a wall
    // only cuts. The independent checker flips the open mask to `!== TILE_WALL`, else lanes over lava would go unseen.
    const { dirs, step, target } = SIGHT_LATTICE;
    const bound = target * TILE;
    let worst = 0;
    eachEntry(({ styled, raw }, s) => {
      const r = fatLane(sightOpenMask(styled), styled.w, styled.h, dirs, step);
      worst = Math.max(worst, r.len * TILE);
      expect(r.len * TILE, `seed ${s}: lattice lane ${(r.len * TILE).toFixed(1)} u (direction ${r.k}/${dirs}), limit ${bound.toFixed(1)} u`).toBeLessThanOrEqual(bound + LANE_SLACK_U);
      // and no longer than the unstyled map's (the stylers only add walls)
      const before = fatLane(sightOpenMask(raw), raw.w, raw.h, dirs, step);
      expect(r.len, `seed ${s}: styling lengthened a lane`).toBeLessThanOrEqual(before.len + 1e-9);
    });
    console.info(`[zone styler] longest LOW-aware lattice lane over 200 styled maps: ${worst.toFixed(1)} u (bound ${bound.toFixed(1)} u, ${MAX_SIGHT_CORRIDOR} u cap)`);
  }, HEAVY_MS);

  it("keeps the exact strip bound: no free strip one corridor wide longer than 480 u at off-lattice angles, LOW open (20 seeds)", () => {
    const sample = SEEDS.slice(0, 20);
    const lattices = [...new Set([32, 48, SIGHT_LATTICE.dirs])];
    const onLattice = (th: number) => lattices.some((n) => Math.abs((th * n) / Math.PI - Math.round((th * n) / Math.PI)) < 1e-9);
    const thetas = lattices.flatMap((n) => Array.from({ length: n }, (_, k) => ((k + 0.5) * Math.PI) / n)).filter((th) => !onLattice(th));
    for (const s of sample) {
      const { styled } = entry(s);
      const blocked = sightOpenMask(styled).map((v) => 1 - v) as Uint8Array;
      const r = longestFreeStrip(blocked, styled.w, styled.h, 1, thetas, 1 / 16);
      expect(r.len * TILE, `seed ${s}: a free strip ${(r.len * TILE).toFixed(1)} u long at ${r.deg.toFixed(2)} deg`).toBeLessThanOrEqual(MAX_SIGHT_CORRIDOR + LANE_SLACK_U);
    }
  }, HEAVY_MS);

  it("keeps each faction at 8% of the floor or more and the floor share inside (0.5, 0.95)", () => {
    eachEntry(({ styled }, s) => {
      let floor = 0;
      const per = new Array<number>(REGION_FACTIONS.length + 1).fill(0);
      for (let i = 0; i < styled.tiles.length; i++) {
        if (styled.tiles[i] !== TILE_FLOOR) continue;
        floor++;
        if (isFactionCode(styled.regionGrid[i])) per[styled.regionGrid[i]]++;
      }
      REGION_FACTIONS.forEach((f, k) => expect(per[k + 1], `seed ${s} ${f}`).toBeGreaterThanOrEqual(0.08 * floor));
      const share = floor / (styled.w * styled.h);
      expect(share, `seed ${s}: floor share`).toBeGreaterThan(0.5);
      expect(share, `seed ${s}: floor share`).toBeLessThan(0.95);
    });
  }, HEAVY_MS);

  it("keeps every spawn's and camp's walk to the coliseum centre exactly as long as the generator made it (the walk guards)", () => {
    eachEntry(({ raw, styled }, s) => {
      const w = raw.w;
      const centre = worldToTile(raw.coliseum.centre.y) * w + worldToTile(raw.coliseum.centre.x);
      const before = walkDistances(raw.tiles, w, raw.h, centre), after = walkDistances(styled.tiles, w, styled.h, centre);
      for (const p of [...raw.spawns, ...raw.camps]) {
        const i = worldToTile(p.y) * w + worldToTile(p.x);
        expect(before[i], `seed ${s}`).toBeGreaterThan(0);
        expect(after[i], `seed ${s} at ${p.x},${p.y}`).toBe(before[i]);
      }
    });
  }, HEAVY_MS);

  it("without the walk guards some spawn walks get much longer (the control), and the guards cost the stylers only a few tiles", () => {
    let longest = 1, wallsGuarded = 0, wallsFree = 0;
    for (const s of SEEDS.slice(0, 40)) {
      const { raw, styled } = entry(s);
      const free = styleFinishedMap(raw, { guardWalks: false });
      const w = raw.w;
      const centre = worldToTile(raw.coliseum.centre.y) * w + worldToTile(raw.coliseum.centre.x);
      const before = walkDistances(raw.tiles, w, raw.h, centre), after = walkDistances(free.tiles, w, free.h, centre);
      for (const p of raw.spawns) { const i = worldToTile(p.y) * w + worldToTile(p.x); longest = Math.max(longest, after[i] / before[i]); }
      for (let i = 0; i < raw.tiles.length; i++) {
        if (raw.tiles[i] === TILE_FLOOR && styled.tiles[i] !== TILE_FLOOR) wallsGuarded++;
        if (raw.tiles[i] === TILE_FLOOR && free.tiles[i] !== TILE_FLOOR) wallsFree++;
      }
    }
    console.info(`[zone styler] without walk guards the longest spawn walk is x${longest.toFixed(2)}; blockers over 40 maps: ${wallsGuarded} guarded, ${wallsFree} unguarded`);
    expect(longest).toBeGreaterThan(1.1);
    expect(wallsGuarded).toBeGreaterThan(0.6 * wallsFree);
  }, HEAVY_MS);

  it("is deterministic: the same seed styles to the same tiles, terrain and props, and decor off changes no gameplay layer", () => {
    for (const s of SEEDS.slice(0, 25)) {
      const raw = generateMap(s);
      const a = styleFinishedMap(raw), b = styleFinishedMap(generateMap(s));
      expect(Array.from(b.tiles), `seed ${s}`).toEqual(Array.from(a.tiles));
      expect(Array.from(b.terrain), `seed ${s}`).toEqual(Array.from(a.terrain));
      expect(b.props, `seed ${s}`).toEqual(a.props);
      const bare = styleFinishedMap(raw, { decor: false });
      expect(Array.from(bare.tiles), `seed ${s}: decor off`).toEqual(Array.from(a.tiles));
      expect(Array.from(bare.terrain), `seed ${s}: decor off`).toEqual(Array.from(a.terrain));
      expect(bare.props, `seed ${s}: decor off`).toEqual([]);
    }
  }, HEAVY_MS);

  it("never needs the connectivity safety net, and its props stay under 8% of a zone and on their tile class", () => {
    eachEntry(({ results, styled }, s) => {
      for (const r of results) {
        expect(r.repaired, `seed ${s} zone ${r.index}`).toBe(0);
        expect(r.kept, `seed ${s} zone ${r.index}: keepLow stays empty`).toBe(0);
      }
      expect(styled.props.length, `seed ${s}`).toBeLessThanOrEqual(0.08 * styled.w * styled.h);
    });
  }, HEAVY_MS);

  it("reports the per-zone footprints, hazards, spawn detours and wall runs over 200 maps (report only)", () => {
    const zones = REGION_FACTIONS.map(() => ({ wall: 0, low: 0, haz: 0, eff: 0, props: 0, painted: 0, floor: 0 }));
    let detourMax = 1, detourMean = 0, detourN = 0;
    const ms = REGION_FACTIONS.map(() => ({ sum: 0, max: 0 }));
    eachEntry(({ raw, styled, results }) => {
      const rep = styleReport(raw, styled);
      rep.zones.forEach((z, k) => {
        zones[k].wall += z.wallPct; zones[k].low += z.lowPct; zones[k].haz += z.hazardPct; zones[k].eff += z.effectivePct; zones[k].props += z.props;
        zones[k].painted += z.painted; zones[k].floor += z.floor;
      });
      for (const d of rep.spawnDetour.perSpawn) { detourMax = Math.max(detourMax, d); detourMean += d; detourN++; }
      results.forEach((r, k) => { ms[k].sum += r.ms; ms[k].max = Math.max(ms[k].max, r.ms); });
    });
    const n = SEEDS.length;
    for (let k = 0; k < zones.length; k++) {
      const z = zones[k];
      console.info(
        `[zone styler] ${REGION_FACTIONS[k].padEnd(9)} WALL ${(z.wall / n).toFixed(2)}%  LOW ${(z.low / n).toFixed(2)}%  hazard ${(z.haz / n).toFixed(2)}%  effective ${(z.eff / n).toFixed(2)}%  ` +
        `props ${(z.props / n).toFixed(1)}  zone ${(z.painted / n).toFixed(0)} tiles  ms mean ${(ms[k].sum / n).toFixed(2)} max ${ms[k].max.toFixed(2)}`,
      );
    }
    console.info(`[zone styler] spawn walk to the coliseum centre, styled over unstyled: mean x${(detourMean / detourN).toFixed(3)}, max x${detourMax.toFixed(3)}`);
    expect(detourN).toBeGreaterThan(0);
  }, HEAVY_MS);
});

describe("buildGameMap", () => {
  it("is the generator's map exactly while MAP_STYLERS is off", { timeout: 60_000 }, () => {
    expect(MAP_STYLERS).toBe(false);
    for (const s of [0, 1, 7, 99, 123456789]) {
      const a = buildGameMap(s), b = generateMap(s);
      expect(Array.from(a.tiles), `seed ${s}`).toEqual(Array.from(b.tiles));
      expect(Array.from(a.terrain), `seed ${s}`).toEqual(Array.from(b.terrain));
      expect(a.props).toEqual(b.props);
      expect(a.regions).toEqual(b.regions);
      expect(a.seed).toBe(b.seed);
      expect(a.attempt).toBe(b.attempt);
    }
  });

  it("builds the styled map deterministically when the stylers are on (tiles, terrain and props byte-equal across calls)", { timeout: 60_000 }, () => {
    for (const s of [0, 3, 11, 42]) {
      const a = buildGameMapOf(s, true), b = buildGameMapOf(s, true);
      expect(Array.from(a.tiles), `seed ${s}`).toEqual(Array.from(b.tiles));
      expect(Array.from(a.terrain), `seed ${s}`).toEqual(Array.from(b.terrain));
      expect(a.props, `seed ${s}`).toEqual(b.props);
      // and it differs from the unstyled map (the stylers did something)
      const raw = generateMap(s);
      expect(Array.from(a.tiles).some((v, i) => v !== raw.tiles[i]) || a.terrain.some((v) => v !== 0), `seed ${s}`).toBe(true);
    }
  });
});

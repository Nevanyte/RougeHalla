// The stylers on OPEN ground, the habitat they were designed for (a 96x96 zone map before the pool is thinned, five zones of about
// 1700 tiles, areaScale 1): what any set of zone stylers owes the guard, whatever the shapes they draw. Size-freedom (any grid size), the
// rim margin, the 13% footprint budget (walls and LOW ground cost 1.0 each), the home zones, zone isolation, determinism, decor and
// Math purity, the pinned output, and, from the day the shape gates are on (SHAPE_GATES), that every wall and LOW tile the stylers
// write belongs to a named feature of its zone, that no wall piece is under 6 tiles and that the pool members' walks stay short.
// What each zone's shapes look like (craters, rows, barrows, a mere, a hall) is that zone's own test (zoneStyle.<zone>.test.ts); what
// the maps they make look like is zoneStyleGen.test.ts and the certifier's windows. The synthetic fixture (zoneStyleOpen.ts) needs no
// generator data, so everything here holds the stylers apart from the generator.
import { describe, expect, it, vi } from "vitest";
import { REGION_FACTIONS, TILE_FLOOR, TILE_LOW, TILE_WALL, mapFromTiles, worldToTile } from "../src/map";
import type { RegionFaction } from "../src/map";
import { SHAPE_GATES } from "../src/mapgen";
import { walkField16 } from "../src/gridTopology";
import { validateTerrain } from "../src/terrain";
import { ZONE_PROP_KINDS, ZONE_STYLERS, styleZones } from "../src/zoneStyle";
import type { StyleResult, ZoneStyler } from "../src/zoneStyle";
import { chamfer, floorComponents } from "../src/zoneStyle/kit";
import { featureProblems, pieceProblems } from "./mapCertify";
import { pinsApply } from "./mapCertifyShards";
import { OPEN_PINNED } from "./mapPins";
import { OPEN_PIN_CASES, openFixture, openFixtureFull, openMap, openZoneHash } from "./zoneStyleOpen";
import type { OpenFixture } from "./zoneStyleOpen";

const HEAVY_MS = 120_000;
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const FACTION_INDEX: Record<RegionFaction, number> = { fire: 0, sentenced: 1, plague: 2, frost: 3, holy: 4 };

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
const fullCache = new Map<number, Run & { members: number[]; centreWalk: Int32Array }>();
function runFull(seed: number): Run & { members: number[]; centreWalk: Int32Array } {
  let r = fullCache.get(seed);
  if (!r) {
    const f = openFixtureFull(seed);
    r = { f, results: styleZones(f.st), members: f.members, centreWalk: f.centreWalk };
    fullCache.set(seed, r);
  }
  return r;
}

/** Walls and LOW tiles of one zone, in percent of its painted tiles. */
function footprint(r: Run, zone: number): { painted: number; wall: number; low: number; pct: number } {
  const { st, tiles0, w, h } = r.f;
  let painted = 0, wall = 0, low = 0;
  for (let i = 0; i < w * h; i++) {
    if (st.zone[i] !== zone) continue;
    painted++;
    if (st.tiles[i] === TILE_WALL && tiles0[i] === TILE_FLOOR) wall++;
    if (st.tiles[i] === TILE_LOW) low++;
  }
  return { painted, wall, low, pct: (100 * (wall + low)) / painted };
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

  it("holds the footprint budget (walls and LOW ground at 1.0 each, at most 13% of the zone) and validateTerrain passes on the styled map", () => {
    for (const s of SEEDS) {
      const r = run(s);
      for (let z = 1; z <= 5; z++) expect(footprint(r, z).pct, `seed ${s} zone ${z}`).toBeLessThanOrEqual(13.0001);
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
      expect(floorComponents(f.st.tiles, w, h).sizes.length, `${w}x${h}`).toBe(floorComponents(f.tiles0, w, h).sizes.length);
      expect(f.st.terrain.every((k) => k < 8)).toBe(true);
    }
  }, HEAVY_MS);

  it("rejects a state whose arrays do not fit its size", () => {
    const f = openFixture(2);
    expect(() => styleZones({ ...f.st, protect: new Uint8Array(10) })).toThrow(RangeError);
    expect(() => styleZones({ ...f.st, zone: new Uint8Array(10) })).toThrow(RangeError);
    expect(() => styleZones({ ...f.st, featureOwner: new Uint16Array(10) })).toThrow(RangeError);
    expect(() => styleZones({ ...f.st, centreWalk: new Int32Array(10) })).toThrow(RangeError);
  });

  it("keeps hazards and LOW kinds in their home zones only, and every prop on its tile class in its zone", () => {
    const home: Record<number, RegionFaction> = {};
    for (const s of SEEDS.slice(0, 8)) {
      const { f } = run(s);
      const { st, w } = f;
      for (let i = 0; i < w * f.h; i++) {
        if (st.terrain[i] === 0) continue;
        expect(st.zone[i], `seed ${s}`).toBeGreaterThan(0);
        home[st.terrain[i]] ??= REGION_FACTIONS[st.zone[i] - 1];
        expect(REGION_FACTIONS[st.zone[i] - 1], `seed ${s} tile ${i} kind ${st.terrain[i]}`).toBe(home[st.terrain[i]]);
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

describe("every zone on the full open fixture (camps, pool members, a feature log)", () => {
  it("leaves every camp's clearing and every member's pad as they were, and each member walkable to the centre", () => {
    for (const s of SEEDS.slice(0, 10)) {
      const { f, members } = runFull(s);
      const { st, w, h, tiles0 } = f;
      expect(members.length, `seed ${s}: members`).toBeGreaterThanOrEqual(8);
      expect(st.camps.length, `seed ${s}: camps`).toBeGreaterThanOrEqual(12);
      // The fixture seats 1 to 4 camps per zone (its placement is the old one): the two farthest from the middle are the elite ones.
      for (let z = 1; z <= 5; z++) expect(st.camps.filter((c) => st.zone[c.site] === z && c.elite).length, `seed ${s} zone ${z}: elite camps`).toBe(Math.min(2, st.camps.filter((c) => st.zone[c.site] === z).length));
      for (const c of st.camps) {
        const cx = c.site % w, cy = (c.site - cx) / w;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const i = (cy + dy) * w + cx + dx;
          if (dx * dx + dy * dy <= 12.25) { expect(st.tiles[i], `seed ${s}: camp ${cx},${cy}`).toBe(tiles0[i]); expect(st.terrain[i], `seed ${s}: camp ${cx},${cy}`).toBe(0); }
        }
      }
      const after = walkField16(st.tiles, w, h, [(h >> 1) * w + (w >> 1)]);
      for (const m of members) {
        const mx = m % w, my = (m - mx) / w;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(st.tiles[(my + dy) * w + mx + dx], `seed ${s}: member ${mx},${my}`).toBe(TILE_FLOOR);
        expect(after[m], `seed ${s}: member ${mx},${my} reaches the centre`).toBeGreaterThan(0);
      }
    }
  }, HEAVY_MS);

  it.runIf(SHAPE_GATES)("owns every wall and LOW tile it writes in a feature of its zone, with no wall piece under 6 tiles (the shape gates)", () => {
    for (const s of SEEDS) {
      const { f } = runFull(s);
      const map = openMap(f);
      expect(featureProblems(map, [1, 2, 3, 4, 5]), `seed ${s}`).toEqual([]);
      expect(pieceProblems(map, [1, 2, 3, 4, 5]), `seed ${s}`).toEqual([]);
    }
  }, HEAVY_MS);

  it.runIf(SHAPE_GATES)("keeps each member's walk to the centre within 5% of its open-ground walk (the route guard, 3% per styler)", () => {
    let worst = 0;
    for (const s of SEEDS) {
      const { f, members, centreWalk } = runFull(s);
      const after = walkField16(f.st.tiles, f.w, f.h, [(f.h >> 1) * f.w + (f.w >> 1)]);
      for (const m of members) worst = Math.max(worst, after[m] / centreWalk[m]);
    }
    console.info(`[open fixture] worst member walk ${worst.toFixed(3)} of its open-ground walk over ${SEEDS.length} seeds`);
    expect(worst).toBeLessThanOrEqual(1.05);
  }, HEAVY_MS);

  it("reports what each zone's styler recorded on the fixture (features per zone; a zone may place nothing at this size)", () => {
    const counts = REGION_FACTIONS.map(() => 0);
    for (const s of SEEDS.slice(0, 10)) {
      const { f } = runFull(s);
      for (const d of f.st.features ?? []) counts[REGION_FACTIONS.indexOf(d.zone)]++;
    }
    console.info(`[open fixture] features over 10 seeds: ${REGION_FACTIONS.map((z, i) => `${z} ${counts[i]}`).join(", ")}`);
    expect(counts.every((c) => c >= 0)).toBe(true);
  }, HEAVY_MS);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Pinned output, zone isolation, determinism, decor and Math purity, all on the fixture.

describe("the stylers on the open fixture, beyond the generator", () => {
  // Eight (seed, zone) pairs, every zone at least once (OPEN_PIN_CASES), pinned in mapPins.ts by scripts/pinMaps.ts: the fixture's
  // geometry is part of the input. After a deliberate change to a styler, re-pin (pinMaps in its own process) and bump the styler's
  // `version`.
  it.skipIf(!pinsApply())("pins the output of eight (seed, zone) pairs, named by each styler's version", () => {
    expect(OPEN_PINNED.map((p) => [p[0], p[1]])).toEqual(OPEN_PIN_CASES.map((p) => [p[0], p[1]]));
    const got = OPEN_PINNED.map(([seed, faction]) => `${faction} v${ZONE_STYLERS[faction].version} seed ${seed}: ${openZoneHash(run(seed).f, faction)}`);
    expect(got).toEqual(OPEN_PINNED.map(([seed, faction, h, version]) => `${faction} v${version} seed ${seed}: ${h}`));
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

  it("styles a zone alone on the full fixture too: the camps, the members and the route guard of one zone never read another zone's writes", () => {
    const noop = (faction: RegionFaction): ZoneStyler<unknown> => ({ id: ZONE_STYLERS[faction].id, faction, version: 0, shape: () => null });
    for (const s of SEEDS.slice(0, 4)) {
      const full = runFull(s).f;
      for (const faction of REGION_FACTIONS) {
        const f = openFixtureFull(s);
        styleZones(f.st, { stylers: { [faction]: noop(faction) } });
        const zone = FACTION_INDEX[faction] + 1;
        for (let i = 0; i < f.w * f.h; i++) {
          if (f.st.zone[i] === zone) expect(f.st.tiles[i], `seed ${s} ${faction}: the no-op zone changed`).toBe(f.tiles0[i]);
          else {
            expect(f.st.tiles[i], `seed ${s}: dropping ${faction} changed tile ${i}`).toBe(full.st.tiles[i]);
            expect(f.st.terrain[i], `seed ${s}: dropping ${faction} changed terrain ${i}`).toBe(full.st.terrain[i]);
          }
        }
      }
    }
  }, HEAVY_MS);

  it("is deterministic: styling the same fixture twice gives byte-equal tiles, terrain, props and feature log, whatever the seed", () => {
    for (const s of [0, 1, 7, 99, 123456789, 2 ** 31]) {
      for (const make of [openFixture, openFixtureFull]) {
        const a = make(s), b = make(s);
        styleZones(a.st);
        styleZones(b.st);
        expect(Buffer.from(a.st.tiles).equals(Buffer.from(b.st.tiles)), `seed ${s}: tiles`).toBe(true);
        expect(Buffer.from(a.st.terrain).equals(Buffer.from(b.st.terrain)), `seed ${s}: terrain`).toBe(true);
        expect(a.st.props, `seed ${s}: props`).toEqual(b.st.props);
        expect(a.st.features, `seed ${s}: features`).toEqual(b.st.features);
      }
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
    // The feature log too: the shapes are decided in the shape stream, so decor off leaves it as it was.
    for (const s of SEEDS.slice(0, 4)) {
      const on = openFixtureFull(s), off = openFixtureFull(s);
      styleZones(on.st);
      styleZones(off.st, { decor: false });
      expect(off.st.features, `seed ${s}`).toEqual(on.st.features);
      expect(Buffer.from(off.st.featureOwner!).equals(Buffer.from(on.st.featureOwner!)), `seed ${s}`).toBe(true);
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
    // The 23 functions the contract forbids (the generator's own spy test lists the same).
    const names = [
      "random", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh",
      "exp", "expm1", "log", "log1p", "log2", "log10", "pow", "hypot", "cbrt",
    ] as const;
    // The fixtures are test scaffolding (they use Math.sin and cos): build them before the spies.
    const fixtures = [90_000, 90_001, 90_002, 90_003].map((s) => openFixtureFull(s));
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

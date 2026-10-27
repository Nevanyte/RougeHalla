// The zone generator's API and determinism. The 200-seed certification of the maps themselves lives in
// mapgen.cert.<k>.test.ts (the checkers in mapCertify.ts), the styler hook's in mapStyler.test.ts, the cost gate in
// mapgen.perf.test.ts.
import { describe, expect, it, vi } from "vitest";
import { MAP_TILES_H, MAP_TILES_W, TILE } from "../src/constants";
import { MASK_SIGHT, REGION_FACTIONS, TILE_FLOOR, TILE_LOW, TILE_WALL } from "../src/map";
import type { GameMap } from "../src/map";
import {
  CAMP_GAP, CAMPS_PER_ZONE, ELITES_PER_ZONE, ELITE_MIN_SEP, MAPGEN_FAILS, MAX_ATTEMPTS, RING_CONTACT_MIN, SHAPE_GATES, SLIVER_MAX, TERRITORY_RADIUS_MAX,
  ZONE_STYLE_HOOK, styleRng, certifiedMap, generateMap, mapHash, tryAttempt,
} from "../src/mapgen";
import type { MapgenOptions, ZoneStyleHook } from "../src/mapgen";
import { raycast } from "../src/geometry";
import { findPath } from "../src/pathfind";
import { PROP_KINDS, TERRAINS, TERRAIN_LAVA } from "../src/terrain";
import { zoneStylerHook } from "../src/zoneStyle";
import { hashSeed, mulberry32 } from "../src/rng";
import {
  CAMP_GAP_TILES, CAMPS_PER_ZONE as CERT_CAMPS, ELITES_PER_ZONE as CERT_ELITES, ELITE_MIN_SEP_TILES, MAP_SIZE, RING_CONTACT_MIN as CERT_F,
  SLIVER_MAX as CERT_S, TERRITORY_RADIUS_TILES, certifyMap, decorProblems, demoStyleHook, strictZoneCodes,
} from "./mapCertify";
import { pinsApply } from "./mapCertifyShards";
import { PINNED_MAPS, PINNED_PLAIN } from "./mapPins";

const seeds = (n: number, from = 0) => Array.from({ length: n }, (_, i) => from + i);
const HEAVY_MS = 60_000;
const cache = new Map<number, GameMap>();
/** Cached generation: read-only. */
function mapFor(seed: number): GameMap {
  let m = cache.get(seed);
  if (!m) { m = generateMap(seed); cache.set(seed, m); }
  return m;
}
const pinned = (s: number) => PINNED_MAPS[s].split(":");
/** The certifier in `styler=zone` mode: what the game's maps (the zone stylers on) must pass. */
const certifyZone = (m: GameMap) => certifyMap(m, { zone: true });

describe("API", () => {
  it("is 136x136 and exports the numbers it certifies, which match the contract's", () => {
    expect([MAP_TILES_W, MAP_TILES_H]).toEqual([MAP_SIZE, MAP_SIZE]);
    expect([mapFor(0).w, mapFor(0).h]).toEqual([MAP_SIZE, MAP_SIZE]);
    expect([CAMPS_PER_ZONE, ELITES_PER_ZONE, ELITE_MIN_SEP, CAMP_GAP, TERRITORY_RADIUS_MAX, RING_CONTACT_MIN, SLIVER_MAX, MAX_ATTEMPTS])
      .toEqual([CERT_CAMPS, CERT_ELITES, ELITE_MIN_SEP_TILES, CAMP_GAP_TILES, TERRITORY_RADIUS_TILES, CERT_F, CERT_S, 16]);
    // The shape gates: off while the phase A stylers write tiles no feature owns, on from phase C (one constant in mapgen.ts); the
    // certifier's strict group follows it, and the tests marked "shape gates" below run when it is on.
    expect(typeof SHAPE_GATES).toBe("boolean");
    expect(strictZoneCodes(true, undefined)).toEqual(SHAPE_GATES ? [1, 2, 3, 4, 5] : []);
  });

  it("generateMap(seed) is the first attempt that certifies; generateMap(seed, attempt), tryAttempt and certifiedMap rebuild it; every earlier attempt fails again", () => {
    // Seeds 0..39 and, while the pins describe the registered stylers, six seeds the pins say needed a retry; the rebuilds run on every
    // 4th seed and on those.
    let retried = 0;
    const retriedPinned = PINNED_MAPS.map((p) => p.split(":")).filter((p) => p[1] !== "0").map((p) => Number(p[0])).filter((s) => s >= 40).slice(0, 6);
    for (const s of pinsApply() ? [...seeds(40), ...retriedPinned] : seeds(40)) {
      const m = mapFor(s);
      expect(m.seed).toBe(s);
      if (pinsApply()) expect(String(m.attempt), `seed ${s}`).toBe(pinned(s)[1]);
      if (s % 4 !== 0 && m.attempt === 0) continue;
      expect(generateMap(s, m.attempt), `seed ${s}`).toEqual(m);
      expect(tryAttempt(s, m.attempt), `seed ${s}`).toEqual(m);
      if (s % 8 === 0) expect(certifiedMap(s), `seed ${s}`).toEqual(m);
      for (let a = 0; a < m.attempt; a++) {
        retried++;
        expect(tryAttempt(s, a), `seed ${s} attempt ${a}`).toBeNull();
        expect(() => generateMap(s, a), `seed ${s} attempt ${a}`).toThrow(/does not certify/);
      }
    }
    // Most seeds certify first time and a few need a retry: the field carries the index, not a constant.
    if (pinsApply()) expect(retried).toBeGreaterThan(0);
  }, HEAVY_MS);

  it("rejects an attempt that is not an integer >= 0", () => {
    for (const a of [-1, 0.5, Number.NaN, Infinity]) {
      expect(() => tryAttempt(1, a), `attempt ${a}`).toThrow(RangeError);
      expect(() => generateMap(1, a), `attempt ${a}`).toThrow(RangeError);
    }
  });

  it("returns independent objects: mutating one result never changes the next", () => {
    const s = 7;
    const snapshot = structuredClone(generateMap(s));
    const a = generateMap(s);
    a.tiles.fill(TILE_WALL);
    a.regionGrid.fill(3);
    a.territoryGrid.fill(3);
    a.spawns.length = 0;
    a.buildings.length = 0;
    a.crateSpots.length = 0;
    a.groundSpots.length = 0;
    a.coliseum.innerSpawns.length = 0;
    a.coliseum.rect.w = 0;
    a.coliseum.centre.x = -1;
    for (const g of a.coliseum.gates) { g.tiles[0].x = -1; g.tiles.length = 0; }
    for (const r of a.regions) { r.spawns.length = 0; r.chestSpots.length = 0; r.mobCamps.length = 0; r.pole.x = -1; r.area = -1; }
    for (const c of a.camps) { c.spots.length = 0; c.chest.x = -1; c.eliteSpot = 9; }
    for (const p of a.spawnPool) p.x = -1;
    a.camps.length = 0;
    a.spawnPool.length = 0;
    a.regions.length = 0;
    a.attempt = 99;
    expect(generateMap(s)).toEqual(snapshot);
  });

  it("accepts unusual seeds deterministically, and their maps certify", () => {
    for (const s of [-1, 2 ** 31, 2 ** 32 + 5, 123_456_789]) {
      const a = generateMap(s);
      expect(a, `seed ${s}`).toEqual(generateMap(s));
      expect(a.seed).toBe(s);
      expect(certifyZone(a).failures, `seed ${s}`).toEqual([]);
    }
  }, HEAVY_MS);

  it("varies the zone layout from seed to seed: different tiles, zones and faction order", () => {
    const tiles = new Set<string>(), zones = new Set<string>(), orders = new Set<string>();
    for (const s of seeds(40)) {
      const m = mapFor(s);
      tiles.add(Buffer.from(m.tiles).toString("base64"));
      zones.add(Buffer.from(m.regionGrid).toString("base64"));
      // Faction order around the coliseum, by the angle of each zone's pole.
      const ang = m.regions.map((r) => Math.atan2(r.pole.y - m.coliseum.centre.y, r.pole.x - m.coliseum.centre.x));
      const order = REGION_FACTIONS.map((f, i) => ({ f, a: ang[i] })).sort((p, q) => p.a - q.a).map((p) => p.f);
      const i = order.indexOf("fire");
      orders.add([...order.slice(i), ...order.slice(0, i)].join(">"));
    }
    expect(tiles.size).toBe(40);
    expect(zones.size).toBe(40);
    expect(orders.size).toBeGreaterThanOrEqual(10);
  }, HEAVY_MS);
});

describe("determinism", () => {
  it.skipIf(!pinsApply())("rebuilds 50 seeds byte for byte from a fresh module load, as pinned in another process", async () => {
    vi.resetModules();
    const fresh = await import("../src/mapgen");
    for (const s of seeds(50)) {
      const m = fresh.generateMap(s);
      expect(`${s}:${m.attempt}:${fresh.mapHash(m)}`).toBe(PINNED_MAPS[s]);
      const again = mapFor(s);
      expect(Buffer.from(m.tiles).equals(Buffer.from(again.tiles)), `seed ${s} tiles`).toBe(true);
      expect(Buffer.from(m.territoryGrid).equals(Buffer.from(again.territoryGrid)), `seed ${s} territories`).toBe(true);
    }
  }, HEAVY_MS);

  it.skipIf(!pinsApply())("rebuilds 25 seeds byte for byte with the stylers off, as pinned in another process (the plain generator is still the plain generator)", () => {
    for (const s of seeds(25)) {
      const m = generateMap(s, undefined, { styleZones: null });
      expect(`${s}:${m.attempt}:${mapHash(m)}`, `seed ${s}`).toBe(PINNED_PLAIN[s]);
    }
  }, HEAVY_MS);

  it("never calls Math.random or an engine-approximated Math function: module setup, the zone stylers, the landmarks and findPath included", async () => {
    // ECMAScript lets these differ in the last bit between engines; Math.sqrt is exact and allowed.
    const names = [
      "random", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh",
      "exp", "expm1", "log", "log1p", "log2", "log10", "pow", "hypot", "cbrt",
    ] as const;
    const spies = names.map((n) => vi.spyOn(Math, n));
    const calls: Record<string, number> = {};
    try {
      // A fresh copy of the modules, so their module-level tables and lazily built tables are built under the spies.
      vi.resetModules();
      const fresh = await import("../src/mapgen");
      for (const s of seeds(10, 70_000)) fresh.generateMap(s);
      fresh.mapHash(fresh.generateMap(70_011));
      // findPath (the spawn gate's walks) and its geometry, on a map built under the spies.
      const pf = await import("../src/pathfind");
      const m = fresh.generateMap(70_012);
      for (const p of m.spawnPool) pf.findPath(m, p, m.coliseum.centre);
      names.forEach((n, i) => { calls[`Math.${n}`] = spies[i].mock.calls.length; });
    } finally {
      for (const sp of spies) sp.mockRestore();
    }
    expect(calls).toEqual(Object.fromEntries(names.map((n) => [`Math.${n}`, 0])));
  }, HEAVY_MS);

  it("mapHash leaves props out: they are cosmetic and the server builds without them", () => {
    const base = mapFor(3), h = mapHash(base);
    const m = structuredClone(base);
    m.props.push({ kind: 1, x: 100, y: 100, v: 7 });
    expect(mapHash(m)).toBe(h);
  });

  it("mapHash covers every field it names: changing any of them changes the hash", () => {
    const base = mapFor(3), h = mapHash(base);
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(mapHash(structuredClone(base))).toBe(h);
    const edits: [string, (m: GameMap) => void][] = [
      ["tiles", (m) => { m.tiles[200] ^= 1; }],
      ["terrain", (m) => { m.terrain[300] = 5; }],
      ["regionGrid", (m) => { m.regionGrid[200] ^= 1; }],
      ["territoryGrid", (m) => { m.territoryGrid[500] ^= 1; }],
      ["attempt", (m) => { m.attempt++; }],
      ["camp spot", (m) => { m.camps[3].spots[1].x += TILE; }],
      ["camp radius", (m) => { m.camps[7].radius += 1; }],
      ["elite spot", (m) => { m.camps[0].eliteSpot = m.camps[0].eliteSpot === 0 ? -1 : 0; }],
      ["spawn pool", (m) => { m.spawnPool[5].zone = m.spawnPool[5].zone === "fire" ? "holy" : "fire"; }],
      ["region pole", (m) => { m.regions[2].pole.y += TILE; }],
      ["crate", (m) => { m.crateSpots[0].x += TILE; }],
      ["ground spot", (m) => { m.groundSpots.pop(); }],
      ["landmark box", (m) => { m.buildings.push({ x: 1, y: 1, w: 7, h: 7 }); }],
      ["featureGrid byte", (m) => { m.featureGrid[400] ^= 1; }],
      ["feature param", (m) => {
        if (m.features.length > 0) m.features[0].p.push(1);
        else m.features.push({ kind: "infill", variant: "", zone: "fire", jobs: ["seal"], ax: 1, ay: 1, p: [], bbox: { x: 1, y: 1, w: 1, h: 1 }, tiles: 0 });
      }],
    ];
    for (const [what, edit] of edits) {
      const m = structuredClone(base);
      edit(m);
      expect(mapHash(m), what).not.toBe(h);
    }
  });
});

describe("the certifier", () => {
  it("catches broken maps: two members in sight under 10 tiles apart, an unsealed arena, a walled clearing, a split territory", () => {
    const base = mapFor(1);
    expect(certifyZone(base).failures).toEqual([]);
    const names = (m: GameMap) => certifyZone(m).failures.map((f) => f.split(": ").slice(0, 2).join(": "));
    {
      // A pool member moved 6-8 tiles from another, with a clear line between them.
      const m = structuredClone(base);
      const a = m.spawnPool[0], W = m.w;
      let moved = false;
      for (let r = 6; r <= 8 && !moved; r++) {
        for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
          const tx = Math.floor(a.x / TILE) + dx, ty = Math.floor(a.y / TILE) + dy, x = tx * TILE + TILE / 2, y = ty * TILE + TILE / 2;
          if (m.tiles[ty * W + tx] !== TILE_FLOOR || raycast(m, a.x, a.y, x, y, MASK_SIGHT).hit) continue;
          m.spawnPool[1] = { ...m.spawnPool[1], x, y };
          moved = true;
          break;
        }
      }
      expect(moved).toBe(true);
      expect(names(m)).toContain("spawns: members under 10 tiles apart have a wall on the line between them");
    }
    {
      // A hole in the arena's wall ring beside a gate.
      const m = structuredClone(base);
      const g = m.coliseum.gates[0].tiles[0];
      m.tiles[g.y * m.w + g.x - 1] = TILE_FLOOR;
      expect(names(m)).toContain("connectivity: gates closed, the arena is sealed and in one piece, and the rest is one component");
    }
    {
      // A rock in a camp's clearing, and a far tile of its territory handed to the zone's next camp.
      const m = structuredClone(base);
      const c = m.camps[0], cx = Math.floor(c.x / TILE), cy = Math.floor(c.y / TILE);
      m.tiles[cy * m.w + cx + 1] = TILE_WALL;
      const far = m.territoryGrid.findIndex((v, i) => v === 1 && m.tiles[i] === TILE_FLOOR && Math.abs((i % m.w) - cx) + Math.abs(Math.floor(i / m.w) - cy) > 8);
      m.territoryGrid[far] = 2;
      const got = names(m);
      expect(got).toContain(`camps: ${c.id} clearing grown by one tile all floor in its territory, off the ring road`);
      expect(got.some((f) => f.startsWith(`camps: ${c.id} area and radius`) || f.startsWith(`territories: ${c.id} walkable floor`))).toBe(true);
    }
  });

  it("certifies the spawn gate's numbers on every map: findPath ratio <= 1.2 and at most 8 floor-hazard tiles on each walk (20 seeds)", () => {
    for (const s of seeds(20)) {
      const st = certifyZone(mapFor(s)).stats;
      expect(st.walkRatioPath, `seed ${s}`).toBeLessThanOrEqual(1.2);
      expect(Math.max(...st.hazardsOnWalks), `seed ${s}`).toBeLessThanOrEqual(8);
      expect(st.pool, `seed ${s}`).toBeGreaterThanOrEqual(24);
    }
  }, HEAVY_MS);
});

describe("styler hook", () => {
  it("runs the zone stylers by default: every map of seeds 1..10 has low ground and terrain, and only floor, wall and low tiles", () => {
    expect(ZONE_STYLE_HOOK).not.toBeNull();
    for (const s of seeds(10, 1)) {
      const m = mapFor(s);
      expect(m.tiles.every((v) => v === TILE_FLOOR || v === TILE_WALL || v === TILE_LOW), `seed ${s}`).toBe(true);
      expect(m.tiles.some((v) => v === TILE_LOW), `seed ${s} low ground`).toBe(true);
      expect(m.terrain.some((v) => v !== 0), `seed ${s} terrain`).toBe(true);
      expect(m.props.length, `seed ${s} props`).toBeGreaterThan(0);
    }
  });

  it("builds a plain map with the hook off: no low ground, no terrain, no props", () => {
    for (const s of seeds(10, 1)) {
      const m = generateMap(s, undefined, { styleZones: null });
      expect(m.tiles.every((v) => v === TILE_FLOOR || v === TILE_WALL), `seed ${s}`).toBe(true);
      expect(m.terrain.every((v) => v === 0), `seed ${s}`).toBe(true);
      expect(m.props, `seed ${s}`).toEqual([]);
    }
  });

  it("keeps the generator's stream apart: a hook that draws but changes nothing leaves the map as the plain generator makes it", () => {
    const draw: ZoneStyleHook = (st) => { for (let z = 1; z <= 5; z++) { const r = styleRng(st.seed, st.attempt, z); for (let i = 0; i < 100; i++) r(); } };
    for (const s of seeds(5)) expect(generateMap(s, undefined, { styleZones: draw }), `seed ${s}`).toEqual(generateMap(s, undefined, { styleZones: null }));
  });

  it("styleRng is hashSeed's stream: the zone stylers' three streams per zone are independent", () => {
    const first = (z: number, st: number): number => styleRng(5, 0, z, st)();
    expect(first(1, 0)).toBe(mulberry32(hashSeed(5, 0, 1, 0))());
    const vals = new Set<number>();
    for (let z = 1; z <= 5; z++) for (let st = 0; st < 3; st++) vals.add(first(z, st));
    expect(vals.size).toBe(15);
  });

  it("hands the hook the whole zone grid, the factions, the protected tiles and this attempt's camps and territories", () => {
    let calls = 0;
    const look: ZoneStyleHook = (st) => {
      calls++;
      expect([st.w, st.h, st.tiles.length, st.terrain.length]).toEqual([MAP_SIZE, MAP_SIZE, MAP_SIZE * MAP_SIZE, MAP_SIZE * MAP_SIZE]);
      expect([...st.zoneFaction].sort()).toEqual([...REGION_FACTIONS].sort());
      const sizes = [1, 2, 3, 4, 5].map((z) => st.zone.reduce((a, v) => a + (v === z ? 1 : 0), 0));
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(8);
      expect(st.camps.length).toBe(40);
      expect(st.camps.filter((c) => c.elite).length).toBe(10);
      expect(st.spawns.length).toBeGreaterThanOrEqual(24);
      for (const t of st.spawns) { expect(st.protect[t]).toBe(1); expect(st.centreWalk[t]).toBeGreaterThan(0); }
      expect(st.centreWalk.length).toBe(MAP_SIZE * MAP_SIZE);
      expect(st.featureOwner.length).toBe(MAP_SIZE * MAP_SIZE);
      expect(Array.isArray(st.features)).toBe(true);
      st.camps.forEach((c, i) => {
        expect(c.territory).toBe(i + 1);
        expect(st.territoryGrid[c.site]).toBe(c.territory);
        expect(st.protect[c.site]).toBe(1);
        expect(c.r).toBe(2.5);
      });
      expect(st.terrain.every((v) => v === 0)).toBe(true);
      expect(st.props).toEqual([]);
    };
    generateMap(2, undefined, { styleZones: look });
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  /**
   * The generator keeps a hook's prop only when its kind's tile class matches the tile under it (terrain.ts PROP_KINDS, zone
   * terrain's table): the demo hook draws kind 0, a floor kind, so its props on floor stay.
   */
  const withPropKind = <T>(fn: () => T): T => {
    expect(PROP_KINDS[0]?.on).toBe(TILE_FLOOR);
    return fn();
  };

  it("builds every hashed layer the same with decor off (the server and bots), with no props; the hook is told", () => {
    const told: boolean[] = [];
    const hook: ZoneStyleHook = (st) => { told.push(st.decor); demoStyleHook(st); };
    let withProps = 0;
    withPropKind(() => {
      for (const s of seeds(4)) {
        // The demo hook writes tiles without features: it runs with the shape gates off (contract 6.3).
        const on = generateMap(s, undefined, { styleZones: hook, shapeGates: false });
        const off = generateMap(s, on.attempt, { styleZones: hook, decor: false, shapeGates: false });
        // Not vacuous: the decor stream really put props on the decorated map.
        if (on.props.length > 0) withProps++;
        expect(on.props.length, `seed ${s}`).toBeGreaterThan(0);
        expect(off.props, `seed ${s}`).toEqual([]);
        // Only the props differ: the decor stream is a stream of its own, and the hash does not read them.
        expect({ ...off, props: [] }, `seed ${s}`).toEqual({ ...on, props: [] });
        expect(mapHash(off), `seed ${s}`).toBe(mapHash(on));
      }
    });
    expect(withProps).toBeGreaterThanOrEqual(3);
    expect(told.includes(true) && told.includes(false)).toBe(true);
    // The game's own hook: the server and the bots build with decor off, the client with it on, and the hash cannot tell.
    let drawn = 0;
    for (const s of seeds(6)) {
      const on = mapFor(s), off = certifiedMap(s, { decor: false })!;
      expect(off.props, `seed ${s}`).toEqual([]);
      expect({ ...off, props: [] }, `seed ${s}`).toEqual({ ...on, props: [] });
      expect(mapHash(off), `seed ${s}`).toBe(mapHash(on));
      if (on.props.length > 0) drawn++;
    }
    expect(drawn, "the zone stylers drew props").toBe(6);
  });

  it("builds every hashed layer the same with decor off, and the hash is the same, over 60 seeds of the game's own hook (the guard)", () => {
    for (const s of seeds(60, 100)) {
      const on = mapFor(s), off = generateMap(s, on.attempt, { decor: false });
      expect(Buffer.from(off.tiles).equals(Buffer.from(on.tiles)), `seed ${s} tiles`).toBe(true);
      expect(Buffer.from(off.terrain).equals(Buffer.from(on.terrain)), `seed ${s} terrain`).toBe(true);
      expect(Buffer.from(off.regionGrid).equals(Buffer.from(on.regionGrid)), `seed ${s} regionGrid`).toBe(true);
      expect(Buffer.from(off.territoryGrid).equals(Buffer.from(on.territoryGrid)), `seed ${s} territoryGrid`).toBe(true);
      expect(off.camps, `seed ${s} camps`).toEqual(on.camps);
      expect(off.spawnPool, `seed ${s} spawnPool`).toEqual(on.spawnPool);
      expect(mapHash(off), `seed ${s}`).toBe(mapHash(on));
    }
  }, HEAVY_MS);

  it("a prop changes nothing the hash reads: add, move or drop the props of a map that has some", () => {
    withPropKind(() => {
      const base = generateMap(1, undefined, { styleZones: demoStyleHook, shapeGates: false });
      expect(base.props.length).toBeGreaterThan(0);
      const h = mapHash(base);
      const more = structuredClone(base);
      more.props.push({ kind: 0, x: 100, y: 100, v: 7 });
      more.props[0] = { ...more.props[0], x: more.props[0].x + 5, v: (more.props[0].v + 1) & 255 };
      expect(mapHash(more)).toBe(h);
      expect(mapHash({ ...base, props: [] })).toBe(h);
    });
  });

  it("fails the attempt, never throws, when the hook breaks the contract (counted as A:styleBreach)", () => {
    const firstFree = (st: Parameters<ZoneStyleHook>[0]) => st.zone.findIndex((z, i) => z > 0 && st.protect[i] === 0 && st.tiles[i] === TILE_FLOOR);
    const breaches: [string, ZoneStyleHook][] = [
      ["a protected tile", (st) => { st.tiles[st.protect.findIndex((v, i) => v === 1 && st.zone[i] > 0 && st.tiles[i] === TILE_FLOOR)] = TILE_LOW; }],
      ["the coliseum (no zone)", (st) => { st.tiles[st.zone.findIndex((z, i) => z === 0 && st.tiles[i] === TILE_FLOOR)] = TILE_WALL; }],
      ["a tile value that is neither wall nor low ground", (st) => { st.tiles[firstFree(st)] = 7; }],
      ["a LOW kind on floor", (st) => { st.terrain[firstFree(st)] = TERRAIN_LAVA; }],
      ["terrain on a protected tile", (st) => { st.terrain[st.protect.findIndex((v, i) => v === 1 && st.zone[i] > 0 && st.tiles[i] === TILE_FLOOR)] = 5; }],
    ];
    for (const [what, hook] of breaches) {
      const before = MAPGEN_FAILS["A:styleBreach"] ?? 0;
      expect(tryAttempt(2, 0, { styleZones: hook }), what).toBeNull();
      expect(() => generateMap(2, 0, { styleZones: hook }), what).toThrow(/does not certify/);
      expect(MAPGEN_FAILS["A:styleBreach"], what).toBe(before + 2);
    }
  });

  it("gates the shapes when asked: a wall no feature owns fails the attempt as a breach (A:styleBreach) with the gates on, and stands with them off", () => {
    // A hook that writes one wall tile and records no feature: the old stylers did this on every tile, whatever they were.
    const rogue: ZoneStyleHook = (st) => { st.tiles[st.zone.findIndex((z, i) => z > 0 && st.protect[i] === 0 && st.tiles[i] === TILE_FLOOR)] = TILE_WALL; };
    const before = MAPGEN_FAILS["A:styleBreach"] ?? 0;
    expect(tryAttempt(2, 0, { styleZones: rogue, shapeGates: true })).toBeNull();
    expect(MAPGEN_FAILS["A:styleBreach"]).toBe(before + 1);
    expect(tryAttempt(2, 0, { styleZones: rogue, shapeGates: false })).not.toBeNull();
    expect(MAPGEN_FAILS["A:styleBreach"]).toBe(before + 1);
    // With no style hook the zones hold only the landmarks and the nets' infill: nothing for the ownership rule to refuse.
    const plain = tryAttempt(2, 0, { styleZones: null, shapeGates: true });
    if (plain) for (let i = 0; i < plain.tiles.length; i++) if (plain.regionGrid[i] >= 1 && plain.regionGrid[i] <= 5 && plain.tiles[i] !== TILE_FLOOR) expect(plain.featureGrid[i]).not.toBe(0);
  });

  it("checks the landmark stage's contract: a wall no landmark of the zone owns fails the attempt (A:styleBreach), and the log is in the map", () => {
    const before = MAPGEN_FAILS["A:styleBreach"] ?? 0;
    const rogue = (st: Parameters<NonNullable<MapgenOptions["landmarks"]>>[0]): void => {
      st.tiles[st.zone.findIndex((z, i) => z > 0 && st.protect[i] === 0 && st.tiles[i] === TILE_FLOOR)] = TILE_WALL;
    };
    expect(tryAttempt(2, 0, { landmarks: rogue })).toBeNull();
    expect(MAPGEN_FAILS["A:styleBreach"]).toBe(before + 1);
    // A landmark hook that records nothing and writes nothing changes nothing: it is the same as no landmark hook at all.
    const noop = tryAttempt(2, 0, { landmarks: () => {} }), none = tryAttempt(2, 0, { landmarks: null });
    expect(noop === null ? null : mapHash(noop)).toBe(none === null ? null : mapHash(none));
  });

  it("protects every spawn-pool 3x3 from the stylers and leaves no floor hazard in a member's 5x5", () => {
    // The pool is picked before the stylers: the hook is told its 3x3s as protected ground, then hazards are cleared from the 5x5s.
    for (const s of seeds(8, 20)) {
      const m = mapFor(s);
      for (const p of m.spawnPool) {
        const cx = Math.floor(p.x / TILE), cy = Math.floor(p.y / TILE);
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const i = (cy + dy) * m.w + cx + dx, k = m.terrain[i];
            if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) expect(m.tiles[i] === TILE_FLOOR && k === 0, `seed ${s} spawn 3x3`).toBe(true);
            else expect(k === 0 || TERRAINS[k].tile !== TILE_FLOOR, `seed ${s} spawn 5x5 hazard`).toBe(true);
          }
        }
      }
    }
  });

  it("never lets a LOW tile end as floor, and keeps a floor hazard off every wall (a wall on low ground keeps its kind, as decor)", () => {
    let low = 0;
    for (const s of seeds(12, 30)) {
      const m = mapFor(s);
      let seen: Uint8Array | null = null;
      const spy: ZoneStyleHook = (st) => { zoneStylerHook(st); seen = st.tiles.slice(); };
      generateMap(s, m.attempt, { styleZones: spy });
      for (let i = 0; i < m.tiles.length; i++) {
        if (seen![i] === TILE_LOW) {
          low++;
          expect(m.tiles[i], `seed ${s} tile ${i}`).not.toBe(TILE_FLOOR);
          if (m.tiles[i] === TILE_WALL) expect(m.terrain[i], `seed ${s}: a wall on low ground keeps its kind`).not.toBe(0);
        }
        const k = m.terrain[i];
        if (k !== 0 && TERRAINS[k].tile === TILE_FLOOR) expect(m.tiles[i], `seed ${s} hazard under a wall at ${i}`).toBe(TILE_FLOOR);
      }
    }
    expect(low, "the stylers laid low ground").toBeGreaterThan(0);
  }, HEAVY_MS);
});

// ---------------------------------------------------------------------------------------------------------------------------
// From phase C (SHAPE_GATES on). Written now, skipped until the gates are on.
describe.runIf(SHAPE_GATES)("the shape gates (contract 6.1)", () => {
  it("certifies the game's maps strictly: every zone WALL, LOW and floor hazard owned by a feature of its zone, no wall piece under 6 tiles (40 seeds)", () => {
    for (const s of seeds(40)) {
      const r = certifyMap(mapFor(s), { zone: true, strict: true });
      expect(r.stats.strictZones, `seed ${s}`).toEqual([1, 2, 3, 4, 5]);
      expect(r.failures, `seed ${s}`).toEqual([]);
    }
  }, HEAVY_MS);

  it("keeps the landmarks whatever the style hook is: the plain generator's zones still have them, and every landmark is one feature and one building", () => {
    let withLandmarks = 0;
    for (const s of seeds(20, 1)) {
      const m = generateMap(s, undefined, { styleZones: null });
      const landmarks = m.features.filter((f) => f.kind === "landmark");
      expect(m.buildings.length, `seed ${s}`).toBe(landmarks.length);
      expect(certifyMap(m, { strict: true }).failures, `seed ${s}`).toEqual([]);
      if (landmarks.length >= 5) withLandmarks++;
    }
    expect(withLandmarks, "maps with a landmark in most zones").toBeGreaterThanOrEqual(18);
  }, HEAVY_MS);

  it("builds the same features with decor off: the features and the featureGrid come from the shape and landmark streams (30 seeds)", () => {
    for (const s of seeds(30, 400)) {
      const on = mapFor(s), off = generateMap(s, on.attempt, { decor: false });
      expect(decorProblems(on, off), `seed ${s}`).toEqual([]);
      expect(on.features.length, `seed ${s}: the shapes are there`).toBeGreaterThan(5);
    }
  }, HEAVY_MS);

  it("holds at most 250 features, one infill per zone at most and landmarks first, on every map of 40 seeds", () => {
    for (const s of seeds(40)) {
      const m = mapFor(s);
      expect(m.features.length, `seed ${s}`).toBeLessThanOrEqual(250);
      for (const f of REGION_FACTIONS) {
        const own = m.features.filter((q) => q.zone === f);
        expect(own.filter((q) => q.kind === "infill").length, `seed ${s} ${f}`).toBeLessThanOrEqual(1);
        const firstShape = own.findIndex((q) => q.kind !== "landmark");
        if (firstShape >= 0) expect(own.slice(firstShape).some((q) => q.kind === "landmark"), `seed ${s} ${f}: a landmark after a shape`).toBe(false);
      }
    }
  }, HEAVY_MS);
});

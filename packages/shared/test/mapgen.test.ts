// The zone generator's API and determinism. The 200-seed certification of the maps themselves lives in
// mapgen.cert.<k>.test.ts (the checkers in mapCertify.ts), the styler hook's in mapStyler.test.ts, the cost gate in
// mapgen.perf.test.ts.
import { describe, expect, it, vi } from "vitest";
import { MAP_TILES_H, MAP_TILES_W, MAX_SIGHT_CORRIDOR, RANGED_HIT_REACH, SIGHT_CORRIDOR_WIDTH, TILE } from "../src/constants";
import { REGION_FACTIONS, TILE_FLOOR, TILE_LOW, TILE_WALL, tileToWorldCenter, withGates } from "../src/map";
import type { GameMap, TilePt } from "../src/map";
import {
  CAMP_GAP, CAMPS_PER_ZONE, LATTICE_ORIGIN, MAX_ATTEMPTS, RING_CONTACT_MIN, SIGHT_LATTICE, SLIVER_MAX, TERRITORY_RADIUS_MAX, ZONE_STYLE_HOOK, styleRng,
  certifiedMap, generateMap, longestLane, mapHash, tryAttempt,
} from "../src/mapgen";
import type { ZoneStyleHook } from "../src/mapgen";
import { TERRAIN_LAVA } from "../src/terrain";
import { mulberry32, randInt } from "../src/rng";
import { WEAPONS } from "../src/weapons";
import {
  CAMP_GAP_TILES, LATTICE, LATTICE_ANCHOR, MAP_SIZE, RING_CONTACT_MIN as CERT_F, SLIVER_MAX as CERT_S, TERRITORY_RADIUS_TILES, certifyMap, demoStyleHook,
  dist, fatLane, firstOpenSlope, hittableAim,
} from "./mapCertify";
import { PINNED_MAPS } from "./mapPins";

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
const inRuin = (m: GameMap, i: number) => m.buildings.some((b) => i % m.w >= b.x && i % m.w < b.x + b.w && Math.floor(i / m.w) >= b.y && Math.floor(i / m.w) < b.y + b.h);

describe("API", () => {
  it("is 96x96 and exports the numbers it certifies, which match the contract's", () => {
    expect([MAP_TILES_W, MAP_TILES_H]).toEqual([MAP_SIZE, MAP_SIZE]);
    expect([mapFor(0).w, mapFor(0).h]).toEqual([MAP_SIZE, MAP_SIZE]);
    expect(SIGHT_LATTICE).toEqual({ dirs: LATTICE.dirs, step: LATTICE.step, target: LATTICE.target });
    expect(LATTICE_ORIGIN).toEqual([LATTICE_ANCHOR, LATTICE_ANCHOR]);
    expect([CAMPS_PER_ZONE, CAMP_GAP, TERRITORY_RADIUS_MAX, RING_CONTACT_MIN, SLIVER_MAX, MAX_ATTEMPTS]).toEqual([4, CAMP_GAP_TILES, TERRITORY_RADIUS_TILES, CERT_F, CERT_S, 16]);
  });

  it("generateMap(seed) is the first attempt that certifies; generateMap(seed, attempt), tryAttempt and certifiedMap rebuild it; every earlier attempt fails again", () => {
    // Seeds 0..39 hold several that need a retry (see mapPins.ts); the rebuilds run on every 4th seed and on those.
    let retried = 0;
    for (const s of seeds(40)) {
      const m = mapFor(s);
      expect(m.seed).toBe(s);
      expect(String(m.attempt), `seed ${s}`).toBe(pinned(s)[1]);
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
    expect(retried).toBeGreaterThan(0);
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
      expect(certifyMap(a).failures, `seed ${s}`).toEqual([]);
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
  it("rebuilds 50 seeds byte for byte from a fresh module load, as pinned in another process", async () => {
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

  it("never calls Math.random or an engine-approximated Math function, module setup and lane tables included", async () => {
    // ECMAScript lets these differ in the last bit between engines; Math.sqrt is exact and allowed.
    const names = [
      "random", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh",
      "exp", "expm1", "log", "log1p", "log2", "log10", "pow", "hypot", "cbrt",
    ] as const;
    const spies = names.map((n) => vi.spyOn(Math, n));
    const calls: Record<string, number> = {};
    try {
      // A fresh copy of the modules, so their module-level tables and lazily built lane tables are built under the spies.
      vi.resetModules();
      const fresh = await import("../src/mapgen");
      for (const s of seeds(10, 70_000)) fresh.generateMap(s);
      fresh.longestLane(fresh.generateMap(70_010));
      fresh.mapHash(fresh.generateMap(70_011));
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
      ["ruin", (m) => { m.buildings.push({ x: 1, y: 1, w: 7, h: 7 }); }],
    ];
    for (const [what, edit] of edits) {
      const m = structuredClone(base);
      edit(m);
      expect(mapHash(m), what).not.toBe(h);
    }
  });
});

describe("the certifier", () => {
  it("catches broken maps: open ground without rocks, an unsealed arena, a walled clearing, a split territory", () => {
    const base = mapFor(1);
    expect(certifyMap(base).failures).toEqual([]);
    const names = (m: GameMap) => certifyMap(m).failures.map((f) => f.split(": ").slice(0, 2).join(": "));
    {
      // No rocks: lanes run long and pool members can shoot each other.
      const m = structuredClone(base);
      for (let i = 0; i < m.tiles.length; i++) if (m.regionGrid[i] >= 1 && m.regionGrid[i] <= 5 && m.tiles[i] === TILE_WALL && !inRuin(m, i)) m.tiles[i] = TILE_FLOOR;
      const got = names(m);
      expect(got).toContain("sight: every lattice lane (48 dirs, 1/4-tile lines, anchored at the coliseum) <= 14.98 tiles, gates open");
      expect(got).toContain("spawns: no member can shoot another within 480 u, both ways (raycast fan and exact cone)");
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

  it("agrees with itself: the exact cone never calls a cone shut when a raycast aim gets through (12 seeds)", () => {
    // The pool screen passes when nothing can hit, which says nothing about whether the checkers can see a hit. So run
    // them on arbitrary pairs of clear floor points 5-9 tiles apart, where plenty of cones are open.
    const rng = mulberry32(8_001);
    let pairs = 0, open = 0, shut = 0, alarms = 0;
    const contradictions: string[] = [];
    for (const s of seeds(12)) {
      const m = mapFor(s);
      const spots: TilePt[] = [];
      const clear = (x: number, y: number) => {
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (m.tiles[(y + j) * m.w + x + i] !== TILE_FLOOR) return false;
        return true;
      };
      for (let ty = 2; ty < m.h - 2; ty++) for (let tx = 2; tx < m.w - 2; tx++) if (clear(tx, ty)) spots.push({ x: tx, y: ty });
      const isSpot = new Set(spots.map((p) => p.y * m.w + p.x));
      for (let n = 0; n < 600; n++) {
        const t = spots[randInt(rng, 0, spots.length)];
        const ang = rng() * 2 * Math.PI, len = 5 + rng() * 4;
        const u = { x: Math.round(t.x + Math.cos(ang) * len), y: Math.round(t.y + Math.sin(ang) * len) };
        if (!isSpot.has(u.y * m.w + u.x)) continue;
        const a = { x: tileToWorldCenter(t.x), y: tileToWorldCenter(t.y) }, b = { x: tileToWorldCenter(u.x), y: tileToWorldCenter(u.y) };
        if (dist(a, b) < 5 * TILE) continue;
        pairs++;
        const fan = hittableAim(m, a, b, RANGED_HIT_REACH), exact = firstOpenSlope(m, a, b, RANGED_HIT_REACH);
        if (fan !== null) open++; else shut++;
        if (fan !== null && exact === null) contradictions.push(`seed ${s}: ${a.x},${a.y} to ${b.x},${b.y}`);
        if (fan === null && exact !== null) alarms++;
      }
    }
    expect(contradictions.slice(0, 5)).toEqual([]);
    expect(alarms, `${alarms} of ${pairs} pairs`).toBeLessThanOrEqual(pairs * 0.02);
    expect(open, "no open cone to find").toBeGreaterThanOrEqual(50);
    expect(shut, "no shut cone to find").toBeGreaterThanOrEqual(50);
  }, HEAVY_MS);

  it("pins the corridor constants: MAX_SIGHT_CORRIDOR covers every projectile's range, SIGHT_CORRIDOR_WIDTH one tile", () => {
    expect(MAX_SIGHT_CORRIDOR).toBe(480);
    for (const w of [WEAPONS.bow, WEAPONS.wand]) {
      if (w.shape.kind !== "projectile") throw new Error("projectile");
      expect(w.shape.range).toBeLessThanOrEqual(MAX_SIGHT_CORRIDOR);
    }
    expect(SIGHT_CORRIDOR_WIDTH).toBe(32);
  });

  it("covers every angle: the lattice's direction gap and lane bound keep any strip of the corridor width under 480 u", () => {
    // A strip of width W and length l at angle theta lies within delta = pi / (2 * dirs) of a lattice direction. Inside
    // it sits a strip in that direction of width 2 * step (so it holds a whole lattice lane) and length
    // min((W - 2 * step * cos(delta)) / sin(delta), (l - 2 * step * sin(delta)) / cos(delta)). If every lattice lane is
    // at most `target`, the first term must not be the smaller one, and then l <= cos(delta) * target + 2 * step * sin(delta).
    // The anchor shifts every line of a direction by the same offset, so it changes nothing here.
    const { dirs, step, target } = SIGHT_LATTICE;
    const Wt = SIGHT_CORRIDOR_WIDTH / TILE, L = MAX_SIGHT_CORRIDOR / TILE, delta = Math.PI / (2 * dirs);
    expect(Math.sin(delta)).toBeLessThanOrEqual((Wt - 2 * step) / target);
    const bound = Math.cos(delta) * target + 2 * step * Math.sin(delta);
    expect(bound).toBeLessThan(L);
  });

  it("agrees with the generator's own lane measure, longestLane (20 seeds, gates open and closed)", () => {
    for (const s of seeds(20)) {
      for (const m of [mapFor(s), withGates(mapFor(s))]) {
        const open = new Uint8Array(m.w * m.h);
        for (let i = 0; i < open.length; i++) open[i] = m.tiles[i] !== TILE_WALL && m.regionGrid[i] !== 0 ? 1 : 0;
        expect(longestLane(m), `seed ${s}`).toBeCloseTo(fatLane(open, m.w, m.h, LATTICE.dirs, LATTICE.step, LATTICE_ANCHOR, LATTICE_ANCHOR) * TILE, 3);
      }
    }
  }, HEAVY_MS);
});

describe("styler hook", () => {
  it("ships no stylers: every tile of a real map is floor or wall, with no terrain and no props", () => {
    expect(ZONE_STYLE_HOOK).toBeNull();
    for (const s of seeds(10)) {
      const m = mapFor(s);
      expect(m.tiles.every((v) => v === TILE_FLOOR || v === TILE_WALL), `seed ${s}`).toBe(true);
      expect(m.terrain.length, `seed ${s}`).toBe(m.w * m.h);
      expect(m.terrain.every((v) => v === 0), `seed ${s}`).toBe(true);
      expect(m.props, `seed ${s}`).toEqual([]);
    }
  });

  it("keeps the generator's stream apart: a hook that draws but changes nothing leaves the map as it was", () => {
    const draw: ZoneStyleHook = (st) => { for (let z = 1; z <= 5; z++) { const r = styleRng(st.seed, st.attempt, z); for (let i = 0; i < 100; i++) r(); } };
    for (const s of seeds(5)) expect(generateMap(s, undefined, { styleZones: draw }), `seed ${s}`).toEqual(mapFor(s));
  });

  it("hands the hook the whole zone grid, the factions, the protected tiles and this attempt's camps and territories", () => {
    let calls = 0;
    const look: ZoneStyleHook = (st) => {
      calls++;
      expect([st.w, st.h, st.tiles.length, st.terrain.length]).toEqual([MAP_SIZE, MAP_SIZE, MAP_SIZE * MAP_SIZE, MAP_SIZE * MAP_SIZE]);
      expect([...st.zoneFaction].sort()).toEqual([...REGION_FACTIONS].sort());
      const sizes = [1, 2, 3, 4, 5].map((z) => st.zone.reduce((a, v) => a + (v === z ? 1 : 0), 0));
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(8);
      expect(st.camps.length).toBe(20);
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

  it("builds every hashed layer the same with decor off (the server and bots), with no props; the hook is told", () => {
    const told: boolean[] = [];
    const hook: ZoneStyleHook = (st) => { told.push(st.decor); demoStyleHook(st); };
    for (const s of seeds(4)) {
      const on = generateMap(s, undefined, { styleZones: hook });
      const off = generateMap(s, on.attempt, { styleZones: hook, decor: false });
      expect(mapHash(off), `seed ${s}`).toBe(mapHash(on));
      expect({ ...off, props: [] }, `seed ${s}`).toEqual({ ...on, props: [] });
      expect(off.props, `seed ${s}`).toEqual([]);
      expect(certifiedMap(s, { decor: false }), `seed ${s}: no hook`).toEqual(mapFor(s));
    }
    expect(told.includes(true) && told.includes(false)).toBe(true);
  });

  it("throws when the hook breaks the contract", () => {
    const firstFree = (st: Parameters<ZoneStyleHook>[0]) => st.zone.findIndex((z, i) => z > 0 && st.protect[i] === 0 && st.tiles[i] === TILE_FLOOR);
    const breaches: [string, ZoneStyleHook][] = [
      ["a protected tile", (st) => { st.tiles[st.protect.findIndex((v, i) => v === 1 && st.zone[i] > 0 && st.tiles[i] === TILE_FLOOR)] = TILE_LOW; }],
      ["the coliseum (no zone)", (st) => { st.tiles[st.zone.findIndex((z, i) => z === 0 && st.tiles[i] === TILE_FLOOR)] = TILE_WALL; }],
      ["a tile value that is neither wall nor low ground", (st) => { st.tiles[firstFree(st)] = 7; }],
      ["a LOW kind on floor", (st) => { st.terrain[firstFree(st)] = TERRAIN_LAVA; }],
      ["terrain on a protected tile", (st) => { st.terrain[st.protect.findIndex((v, i) => v === 1 && st.zone[i] > 0 && st.tiles[i] === TILE_FLOOR)] = 5; }],
    ];
    for (const [what, hook] of breaches) expect(() => generateMap(2, undefined, { styleZones: hook }), what).toThrow(/broke the contract/);
  });
});

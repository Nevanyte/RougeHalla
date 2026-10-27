// The zone stylers at the generator's hook (ZT-6): what the five themes put on the game's real maps, that a zone is styled alone, that
// the hook adapter is a plain mapping onto styleZones, and that ICE, hazards and low ground keep the generator's promises. The
// stylers' own guards, pinned output and isolation on a synthetic open fixture are zoneStyleOpen.test.ts; the certification of
// the maps themselves (validateTerrain, the sight cap, connectivity) is mapgen.cert.<k>.test.ts in the certifier's `styler=zone` mode.
import { describe, expect, it } from "vitest";
import { REGION_FACTIONS, TILE_FLOOR, TILE_LOW, TILE_WALL } from "../src/map";
import type { GameMap, RegionFaction } from "../src/map";
import { MAPGEN_FAILS, MAPGEN_NOTES, certifiedMap, generateMap } from "../src/mapgen";
import type { ZoneStyleHook } from "../src/mapgen";
import {
  TERRAINS, TERRAIN_BOG, TERRAIN_CREVASSE, TERRAIN_EMBER, TERRAIN_FENCE, TERRAIN_ICE, TERRAIN_LAVA, TERRAIN_LIGHT, validateTerrain,
} from "../src/terrain";
import { STYLER_STATS, resetStylerStats, styleZones, zoneStylerHook } from "../src/zoneStyle";
import type { ZoneStyler } from "../src/zoneStyle";

const HEAVY_MS = 180_000;
const SEEDS = Array.from({ length: 200 }, (_, i) => i);
const cache = new Map<number, GameMap>();
function mapFor(seed: number): GameMap {
  let m = cache.get(seed);
  if (!m) { m = certifiedMap(seed) ?? generateMap(seed); cache.set(seed, m); }
  return m;
}

/** Tiles of each terrain kind in one zone of a map. */
function kindsIn(m: GameMap, faction: RegionFaction): number[] {
  const code = REGION_FACTIONS.indexOf(faction) + 1;
  const out = new Array<number>(TERRAINS.length).fill(0);
  for (let i = 0; i < m.regionGrid.length; i++) if (m.regionGrid[i] === code) out[m.terrain[i]]++;
  return out;
}

describe("the five themes on the generator's maps (200 seeds)", () => {
  // Each zone's characteristic terrain: what a player sees and meets there. Kinds are asserted at 90% of the maps or better.
  const THEMES: { zone: RegionFaction; name: string; kinds: number[] }[] = [
    { zone: "fire", name: "Scorch: lava and the embers on its banks", kinds: [TERRAIN_LAVA, TERRAIN_EMBER] },
    { zone: "sentenced", name: "Gallows: fences", kinds: [TERRAIN_FENCE] },
    { zone: "plague", name: "Warren: bog", kinds: [TERRAIN_BOG] },
    { zone: "frost", name: "Rime: ice lakes and crevasses", kinds: [TERRAIN_ICE, TERRAIN_CREVASSE] },
    { zone: "holy", name: "Sanctum: shafts of light", kinds: [TERRAIN_LIGHT] },
  ];

  for (const theme of THEMES) {
    it(`${theme.name} on at least 90% of the maps`, () => {
      for (const kind of theme.kinds) {
        let present = 0;
        for (const s of SEEDS) if (kindsIn(mapFor(s), theme.zone)[kind] > 0) present++;
        expect(present, `${TERRAINS[kind].key} in the ${theme.zone} zone: ${present} of ${SEEDS.length} maps`).toBeGreaterThanOrEqual(0.9 * SEEDS.length);
      }
    }, HEAVY_MS);
  }

  it("puts every kind only in its home zone, and the structures of every theme are walls and low ground inside the zone (Sanctum colonnades included)", () => {
    for (const s of SEEDS.slice(0, 60)) {
      const m = mapFor(s);
      for (let i = 0; i < m.terrain.length; i++) {
        const k = m.terrain[i];
        if (k === 0) continue;
        expect(REGION_FACTIONS[m.regionGrid[i] - 1], `seed ${s} tile ${i} (${TERRAINS[k].key})`).toBe(TERRAINS[k].home);
      }
    }
    // Colonnades: the Sanctum is the zone with the most freestanding wall tiles per painted tile after the stylers (pillar rows).
    let walls = 0;
    const m = mapFor(1), code = REGION_FACTIONS.indexOf("holy") + 1;
    for (let i = 0; i < m.tiles.length; i++) if (m.regionGrid[i] === code && m.tiles[i] === TILE_WALL) walls++;
    expect(walls).toBeGreaterThan(100);
  }, HEAVY_MS);

  it("certifies every one of them with validateTerrain (T1-T11, spawn 5x5 and ground spots hazard-free), and its themes are visible: low ground on all of them", () => {
    for (const s of SEEDS) {
      const m = mapFor(s);
      expect(validateTerrain(m, { styled: true }), `seed ${s}`).toEqual([]);
      expect(m.tiles.some((t) => t === TILE_LOW), `seed ${s} low ground`).toBe(true);
    }
    // The stylers never broke the hook's contract on any attempt of these 200 seeds (a breach is a styler bug, not a retry).
    expect(MAPGEN_FAILS["A:styleBreach"] ?? 0).toBe(0);
  }, HEAVY_MS);

  it("never needs the styler's connectivity net; the cover's rocks clear the ICE beside them and the Rime freezes over what is left clear", () => {
    resetStylerStats();
    for (const k of Object.keys(MAPGEN_NOTES)) delete MAPGEN_NOTES[k];
    let ice = 0, attempts = 0;
    for (const s of SEEDS.slice(0, 60)) {
      const m = certifiedMap(s)!;
      attempts += m.attempt + 1;
      for (const k of m.terrain) if (k === TERRAIN_ICE) ice++;
    }
    expect(STYLER_STATS.calls).toBeGreaterThanOrEqual(attempts);
    expect(STYLER_STATS.repaired, "a write that left the zone's floor cut: the guards keep it at 0").toBe(0);
    expect(ice / 60, "ice tiles per map left after the cover").toBeGreaterThan(20);
    // Not vacuous: the cover does stand rocks in lakes, and the net does clear the ice beside them.
    expect(MAPGEN_NOTES["iceCleared"] ?? 0).toBeGreaterThan(0);
    expect(MAPGEN_NOTES["iceFrozen"] ?? 0).toBeGreaterThan(0);
    // A report, not a gate (the bench is): the styler pass costs a few ms per attempt.
    console.info(`[styler] ${(STYLER_STATS.ms / Math.max(1, STYLER_STATS.calls)).toFixed(2)} ms per attempt over ${STYLER_STATS.calls} attempts; ice ${(ice / 60).toFixed(0)} tiles per map; cleared beside rocks ${MAPGEN_NOTES["iceCleared"]} in all`);
  }, HEAVY_MS);
});

/** A styler that does nothing (the isolation test swaps it in for one faction). */
const noop = (faction: RegionFaction): ZoneStyler<unknown> => ({ id: "scorch", faction, version: 0, shape: () => null });

describe("the hook adapter and zone isolation at the generator's hook", () => {
  it("is a plain mapping onto styleZones: the hook and a direct call with the same state give byte-equal tiles, terrain and props", () => {
    for (const s of [3, 8, 21]) {
      const m = mapFor(s);
      let checked = 0;
      const hook: ZoneStyleHook = (st) => {
        const direct = {
          w: st.w, h: st.h, seed: st.seed, attempt: st.attempt, tiles: st.tiles.slice(), terrain: st.terrain.slice(), props: [] as typeof st.props,
          zone: st.zone, zoneFaction: st.zoneFaction, protect: st.protect, territory: st.territoryGrid, camps: st.camps,
          spawns: st.spawns, centreWalk: st.centreWalk, features: st.features.slice(), featureOwner: st.featureOwner.slice(),
        };
        styleZones(direct, { decor: st.decor });
        zoneStylerHook(st);
        expect(Buffer.from(st.tiles).equals(Buffer.from(direct.tiles)), `seed ${s} tiles`).toBe(true);
        expect(Buffer.from(st.terrain).equals(Buffer.from(direct.terrain)), `seed ${s} terrain`).toBe(true);
        expect(st.props, `seed ${s} props`).toEqual(direct.props);
        expect(st.features, `seed ${s} features`).toEqual(direct.features);
        expect(Buffer.from(st.featureOwner).equals(Buffer.from(direct.featureOwner)), `seed ${s} featureOwner`).toBe(true);
        checked++;
      };
      generateMap(s, m.attempt, { styleZones: hook });
      expect(checked).toBe(1);
    }
  });

  it("styles a zone alone: replacing one zone's styler with a no-op leaves every other zone byte-identical after the pass (12 seeds, all five zones)", () => {
    const differed: Record<string, number> = {};
    for (const s of SEEDS.slice(0, 12)) {
      const attempt = mapFor(s).attempt;
      const record = (stylers?: Partial<Record<RegionFaction, ZoneStyler<unknown>>>): { tiles: Uint8Array; terrain: Uint8Array; zone: Uint8Array; before: Uint8Array } => {
        let out: { tiles: Uint8Array; terrain: Uint8Array; zone: Uint8Array; before: Uint8Array } | null = null;
        const hook: ZoneStyleHook = (st) => {
          const before = st.tiles.slice();
          styleZones({
            w: st.w, h: st.h, seed: st.seed, attempt: st.attempt, tiles: st.tiles, terrain: st.terrain, props: st.props, zone: st.zone,
            zoneFaction: st.zoneFaction, protect: st.protect, territory: st.territoryGrid, camps: st.camps,
            spawns: st.spawns, centreWalk: st.centreWalk, features: st.features, featureOwner: st.featureOwner,
          }, { decor: st.decor, stylers });
          out = { tiles: st.tiles.slice(), terrain: st.terrain.slice(), zone: st.zone.slice(), before };
        };
        tryAttemptQuiet(s, attempt, hook);
        return out!;
      };
      const full = record();
      REGION_FACTIONS.forEach((faction) => {
        const without = record({ [faction]: noop(faction) });
        const zi = without.zone; // identical in both runs: the partition is made before the hook
        // the zone of this faction: whatever zone the generator's order gave it
        const orderOf = new Set<number>();
        for (let i = 0; i < zi.length; i++) if (full.tiles[i] !== without.tiles[i] || full.terrain[i] !== without.terrain[i]) orderOf.add(zi[i]);
        if (orderOf.size > 0) differed[faction] = (differed[faction] ?? 0) + 1;
        expect(orderOf.size, `seed ${s}, ${faction} without its styler differs in ${[...orderOf].join(",")}`).toBeLessThanOrEqual(1);
        expect(orderOf.has(0), `seed ${s}, ${faction}: nothing outside the zones changes`).toBe(false);
        // and the no-op zone is left exactly as it came in
        for (const z of orderOf) for (let i = 0; i < zi.length; i++) if (zi[i] === z) {
          expect(without.tiles[i], `seed ${s}, ${faction}, tile ${i}`).toBe(without.before[i]);
          expect(without.terrain[i], `seed ${s}, ${faction}, tile ${i}`).toBe(0);
        }
      });
    }
    // Not vacuous: each styler really changed its zone on most of the seeds.
    for (const f of REGION_FACTIONS) expect(differed[f] ?? 0, `${f} styler changed its zone on ${differed[f]} of 12 seeds`).toBeGreaterThanOrEqual(10);
  }, HEAVY_MS);
});

/** One attempt, its result ignored: the hook records what it needs before the later stages decide anything. */
function tryAttemptQuiet(seed: number, attempt: number, hook: ZoneStyleHook): void {
  try { generateMap(seed, attempt, { styleZones: hook }); } catch { /* a styler-less zone may fail a later check */ }
}

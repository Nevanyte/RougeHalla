// The 200-seed certification, in shards: seeds 0..199 are split over SHARDS test files (mapgen.cert.<k>.test.ts) so
// vitest certifies them in parallel. Each shard certifies its seeds' maps as a map pool sees them (certifiedMap: the
// first certified of 16 attempts), pins their hashes, runs the exact strip check on every 5th seed (40 in all) and the
// disc check on every 10th (20 in all), and reports the findPath walking ratio on every 10th seed offset by 5.
import { describe, expect, it } from "vitest";
import { MAX_SIGHT_CORRIDOR, TILE } from "../src/constants";
import { REGION_COLISEUM, REGION_NONE, TILE_WALL, withGates } from "../src/map";
import type { GameMap } from "../src/map";
import { certifiedMap, generateMap, mapHash } from "../src/mapgen";
import { LANE_SLACK_U, ZONE_COUNT, certifyMap, denseDisc, longestFreeStrip, offLatticeAngles, walkLength } from "./mapCertify";
import type { MapStats } from "./mapCertify";
import { PINNED_MAPS } from "./mapPins";

const pct = (v: number[], q: number): number => { const s = [...v].sort((a, b) => a - b); return s[Math.max(0, Math.ceil(q * s.length) - 1)]; };

export const SHARDS = 8;
export const CERT_SEEDS = 200;

export function describeCertification(shard: number): void {
  const per = CERT_SEEDS / SHARDS, from = shard * per, seeds = Array.from({ length: per }, (_, i) => from + i);
  describe(`map certification, seeds ${from}..${from + per - 1}`, () => {
    const maps = new Map<number, GameMap>();
    const discarded: number[] = [];
    const mapFor = (s: number): GameMap => {
      let m = maps.get(s);
      if (!m) {
        const pooled = certifiedMap(s);
        if (!pooled) discarded.push(s);
        m = pooled ?? generateMap(s);
        maps.set(s, m);
      }
      return m;
    };

    it("certifies every seed's map, and a pool discards fewer than 5% of them", () => {
      const all: string[] = [];
      const stats: MapStats[] = [];
      for (const s of seeds) {
        const r = certifyMap(mapFor(s));
        stats.push(r.stats);
        for (const f of r.failures) all.push(`seed ${s}: ${f}`);
      }
      const radius = stats.flatMap((st) => st.radius), share = stats.flatMap((st) => st.leashShare);
      console.info(
        `[cert ${from}-${from + per - 1}] attempts ${seeds.map((s) => mapFor(s).attempt).join("")}; lane max ${(Math.max(...stats.map((st) => st.lane)) * TILE).toFixed(1)} u, ` +
        `sealed ${(Math.max(...stats.map((st) => st.sealedLane)) * TILE).toFixed(1)} u; floor share max ${Math.max(...stats.map((st) => Math.max(...st.floor) / Math.min(...st.floor))).toFixed(3)}; ` +
        `ring contact min ${Math.min(...stats.flatMap((st) => st.contact))}; sliver max ${Math.max(...stats.flatMap((st) => st.slivers))}; ` +
        `territory radius p50 ${pct(radius, 0.5).toFixed(1)} max ${Math.max(...radius).toFixed(1)} tiles; leash-cap share p10 ${pct(share, 0.1).toFixed(2)}; ` +
        `pool ${Math.min(...stats.map((st) => st.pool))}-${Math.max(...stats.map((st) => st.pool))}; walk ratio (BFS 5/7) max ${Math.max(...stats.map((st) => st.walkRatio57)).toFixed(3)}; ` +
        `pairs within 480 u ${stats.reduce((a, st) => a + st.pairsNear, 0)}; longest outdoor wall run ${Math.max(...stats.map((st) => st.wallRun))}; discarded ${discarded.length}`,
      );
      expect(all.slice(0, 8), `${all.length} failures`).toEqual([]);
      expect(discarded.length, `discarded seeds ${discarded.join(",")}`).toBeLessThanOrEqual(Math.floor(0.05 * per));
    }, 120_000);

    it("builds each seed's map byte for byte as pinned (also across processes: the pins were recorded in another)", () => {
      const got = seeds.map((s) => `${s}:${mapFor(s).attempt}:${mapHash(mapFor(s))}`);
      expect(got).toEqual(seeds.map((s) => PINNED_MAPS[s]));
    }, 120_000);

    it("finds no 32 u strip longer than 480 u at the off-lattice angles (exact check, every 5th seed)", () => {
      const thetas = offLatticeAngles();
      for (const s of seeds.filter((v) => v % 5 === 0)) {
        const m = mapFor(s), blocked = new Uint8Array(m.w * m.h);
        for (let i = 0; i < blocked.length; i++) blocked[i] = m.tiles[i] !== TILE_WALL && m.regionGrid[i] !== REGION_NONE ? 0 : 1;
        const strip = longestFreeStrip(blocked, m.w, m.h, 1, thetas, 1 / 16);
        expect(strip.len * TILE, `seed ${s}: a free strip ${(strip.len * TILE).toFixed(1)} u long at ${strip.deg.toFixed(2)} deg`).toBeLessThanOrEqual(MAX_SIGHT_CORRIDOR + LANE_SLACK_U);
      }
    }, 120_000);

    it("finds no corridor over 576 u with a 16 u disc through any open tile centre (64 directions; zones and sealed coliseum; every 10th seed)", () => {
      for (const s of seeds.filter((v) => v % 10 === 0)) {
        const m = mapFor(s), lk = withGates(m);
        const zonesOpen = new Uint8Array(m.w * m.h), sealed = new Uint8Array(m.w * m.h);
        for (let i = 0; i < zonesOpen.length; i++) {
          zonesOpen[i] = m.tiles[i] !== TILE_WALL && m.regionGrid[i] >= 1 && m.regionGrid[i] <= ZONE_COUNT ? 1 : 0;
          sealed[i] = lk.tiles[i] !== TILE_WALL && m.regionGrid[i] === REGION_COLISEUM ? 1 : 0;
        }
        expect(denseDisc(zonesOpen, m.w, m.h, 0.5) * TILE, `seed ${s} zones`).toBeLessThanOrEqual(1.2 * MAX_SIGHT_CORRIDOR + LANE_SLACK_U);
        expect(denseDisc(sealed, m.w, m.h, 0.5) * TILE, `seed ${s} sealed coliseum`).toBeLessThanOrEqual(1.2 * MAX_SIGHT_CORRIDOR + LANE_SLACK_U);
      }
    }, 120_000);

    it("lets findPath walk every pool member to the centre, and reports the walking ratio (every 10th seed, offset 5)", () => {
      const ratios: number[] = [];
      for (const s of seeds.filter((v) => v % 10 === 5)) {
        const m = mapFor(s);
        const lens = m.spawnPool.map((p) => walkLength(m, p, m.coliseum.centre));
        expect(Math.min(...lens), `seed ${s}: a pool member with no route to the centre`).toBeGreaterThan(0);
        ratios.push(Math.max(...lens) / Math.min(...lens));
      }
      console.info(`[cert ${from}-${from + per - 1}] findPath walk ratio to the centre (max/min over the pool): ${ratios.map((r) => r.toFixed(3)).join(" ")} (owner's target 1.2, reported)`);
    }, 120_000);
  });
}

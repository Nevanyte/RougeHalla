// The 200-seed certification, in shards: seeds 0..199 are split over SHARDS test files (mapgen.cert.<k>.test.ts) so
// vitest certifies them in parallel. Each shard certifies its seeds' maps as a map pool sees them (certifiedMap: the
// first certified of 16 attempts, the zone stylers on: the certifier's `styler=zone` mode), which includes the findPath walk
// ratio (<= 1.2) and the hazards on every member's walk, and pins their hashes.
import { describe, expect, it } from "vitest";
import type { GameMap } from "../src/map";
import { certifiedMap, generateMap, mapHash } from "../src/mapgen";
import { certifyMap } from "./mapCertify";
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
        const r = certifyMap(mapFor(s), { zone: true });
        stats.push(r.stats);
        for (const f of r.failures) all.push(`seed ${s}: ${f}`);
      }
      const radius = stats.flatMap((st) => st.radius), share = stats.flatMap((st) => st.leashShare);
      console.info(
        `[cert ${from}-${from + per - 1}] attempts ${seeds.map((s) => mapFor(s).attempt).join("")}; floor share max ${Math.max(...stats.map((st) => Math.max(...st.floor) / Math.min(...st.floor))).toFixed(3)}; ` +
        `ring contact min ${Math.min(...stats.flatMap((st) => st.contact))}; sliver max ${Math.max(...stats.flatMap((st) => st.slivers))}; ` +
        `territory radius p50 ${pct(radius, 0.5).toFixed(1)} max ${Math.max(...radius).toFixed(1)} tiles; leash-cap share p10 ${pct(share, 0.1).toFixed(2)}; ` +
        `pool ${Math.min(...stats.map((st) => st.pool))}-${Math.max(...stats.map((st) => st.pool))}; walk ratio findPath max ${Math.max(...stats.map((st) => st.walkRatioPath)).toFixed(3)} ` +
        `(BFS 5/7 ${Math.max(...stats.map((st) => st.walkRatio57)).toFixed(3)}); hazards on walks max ${Math.max(...stats.flatMap((st) => st.hazardsOnWalks))}; discarded ${discarded.length}`,
      );
      expect(all.slice(0, 8), `${all.length} failures`).toEqual([]);
      expect(discarded.length, `discarded seeds ${discarded.join(",")}`).toBeLessThanOrEqual(Math.floor(0.05 * per));
    }, 120_000);

    it("builds each seed's map byte for byte as pinned (also across processes: the pins were recorded in another)", () => {
      const got = seeds.map((s) => `${s}:${mapFor(s).attempt}:${mapHash(mapFor(s))}`);
      expect(got).toEqual(seeds.map((s) => PINNED_MAPS[s]));
    }, 120_000);

  });
}

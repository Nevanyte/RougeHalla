// The 200-seed certification, in shards: seeds 0..199 are split over SHARDS test files (mapgen.cert.<k>.test.ts) so
// vitest certifies them in parallel. Each shard certifies its seeds' maps as a map pool sees them (certifiedMap: the
// first certified of 16 attempts, the zone stylers on: the certifier's `styler=zone` mode), which includes the findPath walk
// ratio (<= 1.2) and the hazards on every member's walk, and pins their hashes.
import { describe, expect, it } from "vitest";
import { REGION_FACTIONS } from "../src/map";
import type { GameMap } from "../src/map";
import { certifiedMap, generateMap, mapHash } from "../src/mapgen";
import { TERRAIN_ICE } from "../src/terrain";
import { certifyMap } from "./mapCertify";
import type { MapStats, ZoneMeasures } from "./mapCertify";
import { ZONE_STYLERS } from "../src/zoneStyle";
import { PINNED_MAPS, PIN_STYLER_VERSIONS } from "./mapPins";

const mean = (v: number[]): number => (v.length ? v.reduce((a, x) => a + x, 0) / v.length : 0);
const pct = (v: number[], q: number): number => { const s = [...v].sort((a, b) => a - b); return s[Math.max(0, Math.ceil(q * s.length) - 1)]; };

/**
 * Do the pins in mapPins.ts describe the stylers this tree registers? They name the styler versions they were recorded with (a styler
 * bumps its `version` on any output change): while one differs (a zone WP's new styler, before phase C re-pins) a pin test is skipped
 * rather than failed, so a styler under construction does not turn the generator's tests red for everybody else.
 */
export function pinsApply(): boolean {
  return REGION_FACTIONS.every((f) => ZONE_STYLERS[f].version === PIN_STYLER_VERSIONS[f]);
}

export const SHARDS = 8;
export const CERT_SEEDS = 200;

export function describeCertification(shard: number): void {
  const perShard = CERT_SEEDS / SHARDS, from = shard * perShard, seeds = Array.from({ length: perShard }, (_, i) => from + i);
  describe(`map certification, seeds ${from}..${from + perShard - 1}`, () => {
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
        // The spawn gate's certificate on every seed (also a failure of certifyMap; kept explicit so a shard names the seed and the number).
        expect(r.stats.walkRatioPath, `seed ${s}: findPath walk ratio`).toBeLessThanOrEqual(1.2 + 1e-9);
        expect(Math.max(0, ...r.stats.hazardsOnWalks), `seed ${s}: hazard tiles on a member's walk`).toBeLessThanOrEqual(8);
      }
      const radius = stats.flatMap((st) => st.radius), share = stats.flatMap((st) => st.leashShare);
      const perZone = (f: (z: ZoneMeasures) => number): string => REGION_FACTIONS.map((_, zi) => mean(stats.map((st) => f(st.zones[zi])))).map((v) => v.toFixed(2)).join("/");
      console.info(
        `[cert ${from}-${from + perShard - 1}] attempts ${seeds.map((s) => mapFor(s).attempt).join("")}; floor share max ${Math.max(...stats.map((st) => Math.max(...st.floor) / Math.min(...st.floor))).toFixed(3)}; ` +
        `ring contact min ${Math.min(...stats.flatMap((st) => st.contact))}; sliver max ${Math.max(...stats.flatMap((st) => st.slivers))}; ` +
        `territory radius p50 ${pct(radius, 0.5).toFixed(1)} max ${Math.max(...radius).toFixed(1)} tiles; leash-cap share p10 ${pct(share, 0.1).toFixed(2)}; ` +
        `pool ${Math.min(...stats.map((st) => st.pool))}-${Math.max(...stats.map((st) => st.pool))}; walk ratio findPath max ${Math.max(...stats.map((st) => st.walkRatioPath)).toFixed(3)} ` +
        `(BFS 5/7 ${Math.max(...stats.map((st) => st.walkRatio57)).toFixed(3)}); hazards on walks max ${Math.max(...stats.flatMap((st) => st.hazardsOnWalks))}; discarded ${discarded.length}`,
      );
      // Per zone in REGION_FACTIONS order (fire/sentenced/plague/frost/holy), means over the shard's maps.
      console.info(
        `[cert ${from}-${from + perShard - 1}] zones fire/sentenced/plague/frost/holy: rays>=7.5t % ${perZone((z) => 100 * z.rays.share75)}; pairs wall % ${perZone((z) => 100 * z.pairs.wallBlocked)}; ` +
        `pairs LOW % ${perZone((z) => 100 * z.pairs.lowSeparated)}; wall pieces ${perZone((z) => z.wallPieces.count)} (under 6: ${perZone((z) => z.wallPieces.under6)}); loops ${perZone((z) => z.graph.loops)}; ` +
        `stretch mean ${perZone((z) => z.graph.stretchMean)} max ${perZone((z) => z.graph.stretchMax)}; ice ${perZone((z) => z.terrain[TERRAIN_ICE])}; features ${mean(stats.map((st) => st.features)).toFixed(1)} per map`,
      );
      expect(all.slice(0, 8), `${all.length} failures`).toEqual([]);
      expect(discarded.length, `discarded seeds ${discarded.join(",")}`).toBeLessThanOrEqual(Math.floor(0.05 * perShard));
    }, 120_000);

    it.skipIf(!pinsApply())("builds each seed's map byte for byte as pinned (also across processes: the pins were recorded in another)", () => {
      const got = seeds.map((s) => `${s}:${mapFor(s).attempt}:${mapHash(mapFor(s))}`);
      expect(got).toEqual(seeds.map((s) => PINNED_MAPS[s]));
    }, 120_000);

  });
}

// Re-pins the generator's output after a deliberate change: `npx tsx packages/shared/scripts/pinMaps.ts > packages/shared/test/mapPins.ts`.
// Each entry is "seed:attempt:mapHash" of the map a pool serves for that seed (certifiedMap; generateMap when discarded): PINNED_MAPS with the
// generator's default hook (the zone stylers while MAP_STYLERS is on), PINNED_PLAIN with the stylers off (`styleZones: null`).
import { certifiedMap, generateMap, mapHash, warmMapgen } from "../src/mapgen";
import type { MapgenOptions } from "../src/mapgen";

const SEEDS = 200;
warmMapgen();
const pins = (options?: MapgenOptions): string => {
  const lines: string[] = [];
  for (let s = 0; s < SEEDS; s++) {
    const m = certifiedMap(s, options) ?? generateMap(s, undefined, options);
    lines.push(`"${s}:${m.attempt}:${mapHash(m)}"`);
  }
  const rows: string[] = [];
  for (let i = 0; i < lines.length; i += 8) rows.push(`  ${lines.slice(i, i + 8).join(", ")},`);
  return rows.join("\n");
};
process.stdout.write(
  `// The zone generator's output for seeds 0..${SEEDS - 1}, pinned: "seed:attempt:mapHash" of the map a pool serves for each\n` +
  `// seed. Recorded by scripts/pinMaps.ts in its own process, so the certification shards that compare against it also\n` +
  `// prove the generator is deterministic across processes. Re-pin only after a deliberate change to the generator.\n` +
  `// PINNED_MAPS is the game's map (the zone stylers on); PINNED_PLAIN the same seeds with the stylers off.\n` +
  `export const PINNED_MAPS: readonly string[] = [\n${pins()}\n];\n` +
  `export const PINNED_PLAIN: readonly string[] = [\n${pins({ styleZones: null })}\n];\n`,
);

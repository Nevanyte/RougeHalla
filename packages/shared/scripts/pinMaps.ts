// Re-pins the generator's output after a deliberate change: `npx tsx packages/shared/scripts/pinMaps.ts > packages/shared/test/mapPins.ts`.
// Each entry is "seed:attempt:mapHash" of the map a pool serves for that seed (certifiedMap; generateMap when discarded).
import { certifiedMap, generateMap, mapHash, warmMapgen } from "../src/mapgen";

const SEEDS = 200;
warmMapgen();
const lines: string[] = [];
for (let s = 0; s < SEEDS; s++) {
  const m = certifiedMap(s) ?? generateMap(s);
  lines.push(`"${s}:${m.attempt}:${mapHash(m)}"`);
}
const rows: string[] = [];
for (let i = 0; i < lines.length; i += 8) rows.push(`  ${lines.slice(i, i + 8).join(", ")},`);
process.stdout.write(
  `// The zone generator's output for seeds 0..${SEEDS - 1}, pinned: "seed:attempt:mapHash" of the map a pool serves for each\n` +
  `// seed. Recorded by scripts/pinMaps.ts in its own process, so the certification shards that compare against it also\n` +
  `// prove the generator is deterministic across processes. Re-pin only after a deliberate change to the generator.\n` +
  `export const PINNED_MAPS: readonly string[] = [\n${rows.join("\n")}\n];\n`,
);

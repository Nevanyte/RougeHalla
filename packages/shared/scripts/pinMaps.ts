// Re-pins the generator's output after a deliberate change: `npx tsx packages/shared/scripts/pinMaps.ts > packages/shared/test/mapPins.ts`.
// `pinMaps.ts final` drops the PROVISIONAL line (phase C, after the zone stylers and PULL_WINDOW are settled). Run it in its own process (the pins the certification shards compare against prove the generator is deterministic across processes).
// Each map entry is "seed:attempt:mapHash" of the map a pool serves for that seed (certifiedMap; generateMap when discarded): PINNED_MAPS with the
// generator's default hook (the zone stylers), PINNED_PLAIN with the stylers off (`styleZones: null`). OPEN_PINNED is the stylers' own output on
// the synthetic open fixture (test/zoneStyleOpen.ts): [seed, zone, hash of the zone's tiles and terrain, the styler's version].
import { certifiedMap, generateMap, mapHash, warmMapgen } from "../src/mapgen";
import type { MapgenOptions } from "../src/mapgen";
import { REGION_FACTIONS } from "../src/map";
import { ZONE_STYLERS, styleZones } from "../src/zoneStyle";
import { OPEN_PIN_CASES, openFixture, openZoneHash } from "../test/zoneStyleOpen";

const SEEDS = 200;
const FINAL = process.argv[2] === "final";
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
const openPins = (): string => {
  const fixtures = new Map<number, ReturnType<typeof openFixture>>();
  return OPEN_PIN_CASES.map(([seed, faction]) => {
    let f = fixtures.get(seed);
    if (!f) { f = openFixture(seed); styleZones(f.st); fixtures.set(seed, f); }
    return `  [${seed}, "${faction}", ${openZoneHash(f, faction)}, ${ZONE_STYLERS[faction].version}],`;
  }).join("\n");
};
process.stdout.write(
  `// The zone generator's output for seeds 0..${SEEDS - 1}, pinned: "seed:attempt:mapHash" of the map a pool serves for each\n` +
  `// seed. Recorded by scripts/pinMaps.ts in its own process, so the certification shards that compare against it also\n` +
  `// prove the generator is deterministic across processes. Re-pin only after a deliberate change to the generator.\n` +
  `// PINNED_MAPS is the game's map (the zone stylers on); PINNED_PLAIN the same seeds with the stylers off.\n` +
  (FINAL ? "" : `// PROVISIONAL (zone shapes, phase B: 136x136, the phase A stylers through the new runtime): WP7 records the final pins in phase C.\n`) +
  `// OPEN_PINNED: the stylers' output on the synthetic open fixture, [seed, zone, hash of the zone's tiles and terrain, styler version].\n` +
  `// The stylers' versions the pins were recorded with: while any registered styler has another version the pins do not apply (the tests skip them).\n` +
  `export const PIN_STYLER_VERSIONS: Readonly<Record<string, number>> = { ${REGION_FACTIONS.map((f) => `${f}: ${ZONE_STYLERS[f].version}`).join(", ")} };\n` +
  `export const PINNED_MAPS: readonly string[] = [\n${pins()}\n];\n` +
  `export const PINNED_PLAIN: readonly string[] = [\n${pins({ styleZones: null })}\n];\n` +
  `export const OPEN_PINNED: ReadonlyArray<readonly [number, "fire" | "sentenced" | "plague" | "frost" | "holy", number, number]> = [\n${openPins()}\n];\n`,
);

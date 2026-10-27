// Certification sweep with the independent certifier (test/mapCertify.ts):
// `npx tsx packages/shared/scripts/mapSweep.ts <count> [from=0] [styler=default|none|zone|demo]` (default: what the game builds, the
// zone stylers while MAP_STYLERS is on; none: the plain generator; zone: the zone stylers whatever the flag; demo: the demo hook)
// Every seed's pool map (certifiedMap) gets every per-map check (the findPath walk ratio and the hazards on the members' walks
// included). Prints one JSON line of totals, so several processes can each take a range and their lines can be merged.
// (Phase A of the zone shapes: the strip and disc checks of the retired 480 u sight cap are gone; WP7 adds the per-zone measures.)
import { MAPGEN_FAILS, MAPGEN_NOTES, ZONE_STYLE_HOOK, certifiedMap, warmMapgen } from "../src/mapgen";
import type { MapgenOptions } from "../src/mapgen";
import { zoneStylerHook } from "../src/zoneStyle";
import { certifyMap, demoStyleHook } from "../test/mapCertify";
import type { CertifyOptions } from "../test/mapCertify";

const args = process.argv.slice(2);
const count = Number(args.find((a) => !a.includes("=")) ?? 100);
const opt = (k: string): string | undefined => args.find((a) => a.startsWith(`${k}=`))?.slice(k.length + 1);
const from = Number(opt("from") ?? 0);
const styler = opt("styler") ?? "default";
if (!["default", "none", "zone", "demo"].includes(styler)) throw new Error(`styler=${styler}: expected default, none, zone or demo`);
const options: MapgenOptions | undefined =
  styler === "none" ? { styleZones: null } : styler === "demo" ? { styleZones: demoStyleHook, shapeGates: false } : styler === "zone" ? { styleZones: zoneStylerHook } : undefined;
const mode: CertifyOptions = styler === "none" ? {} : styler === "demo" ? { styled: true } : styler === "zone" || ZONE_STYLE_HOOK !== null ? { zone: true } : {};

warmMapgen();
const out = {
  from, count, styler, discarded: [] as number[], failed: [] as string[], attempts: [] as number[],
  floorShare: 0, minContact: 1e9, maxSliver: 0, radius: [] as number[], pool: [] as number[], walk57: 0, walkPath: [] as number[], rocks: [] as number[],
  /** Per pool member: floor-hazard tiles (ember, bog, ice) its findPath route to the centre crosses (the gate caps it at 8). */
  hazardsOnWalks: [] as number[],
  /** Per pool member (zone mode): distinct tiles with terrain its findPath route crosses. */
  hazardTiles: [] as number[],
  /** Maps with each zone's characteristic terrain (lava, fence, bog, ice, light), in REGION_FACTIONS order. */
  themePresent: [0, 0, 0, 0, 0],
  features: [] as number[],
  notes: {} as Record<string, number>,
  fails: {} as Record<string, number>,
};
const THEME_KIND = [1, 2, 5, 6, 7]; // lava, fence, bog, ice, light
for (let s = from; s < from + count; s++) {
  const m = certifiedMap(s, options);
  if (!m) { out.discarded.push(s); continue; }
  out.attempts.push(m.attempt);
  const r = certifyMap(m, mode);
  for (const f of r.failures) out.failed.push(`seed ${s}: ${f}`);
  const st = r.stats;
  out.hazardTiles.push(...st.hazardExposure);
  out.hazardsOnWalks.push(...st.hazardsOnWalks);
  st.kinds.forEach((row, z) => { if (row[THEME_KIND[z]] > 0) out.themePresent[z]++; });
  out.floorShare = Math.max(out.floorShare, Math.max(...st.floor) / Math.min(...st.floor));
  out.minContact = Math.min(out.minContact, ...st.contact);
  out.maxSliver = Math.max(out.maxSliver, ...st.slivers);
  out.radius.push(...st.radius);
  out.pool.push(st.pool);
  out.walk57 = Math.max(out.walk57, st.walkRatio57);
  out.walkPath.push(st.walkRatioPath);
  out.rocks.push(st.rocks);
  out.features.push(st.features);
}
out.notes = { ...MAPGEN_NOTES };
out.fails = { ...MAPGEN_FAILS };
console.log(JSON.stringify(out));

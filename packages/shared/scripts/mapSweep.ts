// Certification sweep with the independent certifier (test/mapCertify.ts):
// `npx tsx packages/shared/scripts/mapSweep.ts <count> [from=0] [styler=default|none|zone|demo]` (default: what the game builds, the
// zone stylers while MAP_STYLERS is on; none: the plain generator; zone: the zone stylers whatever the flag; demo: the demo hook)
// Every seed's pool map (certifiedMap) gets every per-map check; every 5th seed also the exact strip check at the
// off-lattice angles, every 10th the 16 u disc check and the findPath walking ratio. Prints one JSON line of totals, so
// several processes can each take a range and their lines can be merged.
import { MAX_SIGHT_CORRIDOR, TILE } from "../src/constants";
import { REGION_COLISEUM, REGION_NONE, TILE_WALL, withGates } from "../src/map";
import { MAPGEN_FAILS, MAPGEN_NOTES, ZONE_STYLE_HOOK, certifiedMap, warmMapgen } from "../src/mapgen";
import type { MapgenOptions } from "../src/mapgen";
import { zoneStylerHook } from "../src/zoneStyle";
import { LANE_SLACK_U, ZONE_COUNT, certifyMap, demoStyleHook, denseDisc, longestFreeStrip, offLatticeAngles, walkLength } from "../test/mapCertify";
import type { CertifyOptions } from "../test/mapCertify";

const args = process.argv.slice(2);
const count = Number(args.find((a) => !a.includes("=")) ?? 100);
const opt = (k: string): string | undefined => args.find((a) => a.startsWith(`${k}=`))?.slice(k.length + 1);
const from = Number(opt("from") ?? 0);
const styler = opt("styler") ?? "default";
if (!["default", "none", "zone", "demo"].includes(styler)) throw new Error(`styler=${styler}: expected default, none, zone or demo`);
const options: MapgenOptions | undefined =
  styler === "none" ? { styleZones: null } : styler === "demo" ? { styleZones: demoStyleHook } : styler === "zone" ? { styleZones: zoneStylerHook } : undefined;
const mode: CertifyOptions = styler === "none" ? {} : styler === "demo" ? { styled: true } : styler === "zone" || ZONE_STYLE_HOOK !== null ? { zone: true } : {};

warmMapgen();
const thetas = offLatticeAngles();
const out = {
  from, count, styler, discarded: [] as number[], failed: [] as string[], attempts: [] as number[], lane: 0, sealed: 0, strip: 0, disc: 0, discSealed: 0,
  floorShare: 0, minContact: 1e9, maxSliver: 0, radius: [] as number[], pool: [] as number[], walk57: 0, walkPath: [] as number[], wallRun: 0, rocks: [] as number[],
  /** Per pool member (every seed in zone mode): distinct tiles with terrain its findPath route to the centre crosses (contract 0.8, report only). */
  hazardTiles: [] as number[],
  /** Terrain kind tiles per map, summed per zone in REGION_FACTIONS order, and the maps with each zone's characteristic terrain (lava, fence, bog, ice, light). */
  kindTiles: [] as number[][],
  themePresent: [0, 0, 0, 0, 0],
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
  st.kinds.forEach((row, z) => { if (row[THEME_KIND[z]] > 0) out.themePresent[z]++; });
  out.lane = Math.max(out.lane, st.lane * TILE);
  out.sealed = Math.max(out.sealed, st.sealedLane * TILE);
  out.floorShare = Math.max(out.floorShare, Math.max(...st.floor) / Math.min(...st.floor));
  out.minContact = Math.min(out.minContact, ...st.contact);
  out.maxSliver = Math.max(out.maxSliver, ...st.slivers);
  out.radius.push(...st.radius);
  out.pool.push(st.pool);
  out.walk57 = Math.max(out.walk57, st.walkRatio57);
  out.wallRun = Math.max(out.wallRun, st.wallRun);
  out.rocks.push(st.rocks);
  if (s % 5 === 0) {
    const blocked = new Uint8Array(m.w * m.h);
    for (let i = 0; i < blocked.length; i++) blocked[i] = m.tiles[i] !== TILE_WALL && m.regionGrid[i] !== REGION_NONE ? 0 : 1;
    const strip = longestFreeStrip(blocked, m.w, m.h, 1, thetas, 1 / 16).len * TILE;
    out.strip = Math.max(out.strip, strip);
    if (strip > MAX_SIGHT_CORRIDOR + LANE_SLACK_U) out.failed.push(`seed ${s}: exact strip ${strip.toFixed(1)} u`);
  }
  if (s % 10 === 0) {
    const lk = withGates(m), zonesOpen = new Uint8Array(m.w * m.h), sealed = new Uint8Array(m.w * m.h);
    for (let i = 0; i < zonesOpen.length; i++) {
      zonesOpen[i] = m.tiles[i] !== TILE_WALL && m.regionGrid[i] >= 1 && m.regionGrid[i] <= ZONE_COUNT ? 1 : 0;
      sealed[i] = lk.tiles[i] !== TILE_WALL && m.regionGrid[i] === REGION_COLISEUM ? 1 : 0;
    }
    const d1 = denseDisc(zonesOpen, m.w, m.h, 0.5) * TILE, d2 = denseDisc(sealed, m.w, m.h, 0.5) * TILE;
    out.disc = Math.max(out.disc, d1);
    out.discSealed = Math.max(out.discSealed, d2);
    if (Math.max(d1, d2) > 1.2 * MAX_SIGHT_CORRIDOR + LANE_SLACK_U) out.failed.push(`seed ${s}: disc ${d1.toFixed(1)} / ${d2.toFixed(1)} u`);
    const lens = m.spawnPool.map((p) => walkLength(m, p, m.coliseum.centre));
    if (Math.min(...lens) <= 0) out.failed.push(`seed ${s}: a pool member with no path to the centre`);
    out.walkPath.push(Math.max(...lens) / Math.min(...lens));
  }
}
out.notes = { ...MAPGEN_NOTES };
out.fails = { ...MAPGEN_FAILS };
console.log(JSON.stringify(out));

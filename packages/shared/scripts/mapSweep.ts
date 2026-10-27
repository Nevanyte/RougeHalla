// Certification sweep with the independent certifier (test/mapCertify.ts), zone-shapes contract 6.2-6.4:
//   npx tsx packages/shared/scripts/mapSweep.ts <count> [from=0] [styler=default|none|zone|demo] [strict=auto|0|1|fire,holy,...] [decor=10] [table=stderr|stdout|off]
//   npx tsx packages/shared/scripts/mapSweep.ts merge=a.json,b.json,...     (re-prints the merged line and table of several shards)
// styler: default = what the game builds (the zone stylers); none = the plain generator; zone = the zone stylers whatever the flag; demo = the demo hook.
// strict: the shape gates' checks (ownership, wall pieces, tile classes, sizes, overlaps). auto (default) follows the generator's SHAPE_GATES; 1 forces
// them on for every zone, 0 off, a faction list for those zones only.
// decor=N: every Nth seed is also built with decor off and must equal the decorated map in every hashed layer (0 = never; default 10).
// Every seed's pool map (certifiedMap) gets every per-map check. stdout is ONE JSON line (shardable: run several ranges in parallel, then `merge=`):
// scalars are totals or maxima, arrays hold one value per seed (per pool member for the walk arrays), and `zones[faction][measure]` holds the report
// measure of every seed (the names of ZONE_MEASURE_VALUES). The readable table (per-zone matrix, window breaches, hard checks) goes to stderr by default.
import { readFileSync } from "node:fs";
import { MAPGEN_FAILS, MAPGEN_NOTES, ZONE_STYLE_HOOK, certifiedMap, warmMapgen } from "../src/mapgen";
import type { MapgenOptions } from "../src/mapgen";
import { REGION_FACTIONS } from "../src/map";
import type { RegionFaction } from "../src/map";
import { zoneStylerHook } from "../src/zoneStyle";
import {
  CERT_FEATURE_KINDS, SWEEP_THRESHOLDS, ZONE_MEASURE_VALUES, ZONE_WINDOWS, certifyMap, decorProblems, demoStyleHook, judgeWindow,
} from "../test/mapCertify";
import type { CertifyOptions } from "../test/mapCertify";

const THEME_KIND = [1, 2, 5, 6, 7]; // lava, fence, bog, ice, light
const THEME_NAME = ["lava", "fence", "bog", "ice", "light"];

interface Sweep {
  from: number;
  count: number;
  styler: string;
  strict: string;
  decorEvery: number;
  discarded: number[];
  failed: string[];
  decorBad: string[];
  attempts: number[];
  pool: number[];
  walkPath: number[];
  rocks: number[];
  features: number[];
  featureKinds: Record<string, number>;
  /** Per pool member: floor-hazard tiles its findPath route crosses (the generator caps it at 8). */
  hazardsOnWalks: number[];
  /** Per pool member (zone mode): distinct tiles with terrain its findPath route crosses. */
  hazardTiles: number[];
  /** Maps with each zone's characteristic terrain (lava, fence, bog, ice, light), in REGION_FACTIONS order. */
  themePresent: number[];
  floorShareMax: number;
  minContact: number;
  maxSliver: number;
  walk57Max: number;
  radiusMax: number;
  leashShareMin: number;
  /** Seeds certified with the measures (the length of every zones array). */
  measured: number;
  zones: Record<string, Record<string, number[]>>;
  ms: { generate: number; certify: number };
  notes: Record<string, number>;
  fails: Record<string, number>;
}

const empty = (): Sweep => ({
  from: 0, count: 0, styler: "default", strict: "auto", decorEvery: 0, discarded: [], failed: [], decorBad: [], attempts: [], pool: [], walkPath: [], rocks: [],
  features: [], featureKinds: {}, hazardsOnWalks: [], hazardTiles: [], themePresent: [0, 0, 0, 0, 0], floorShareMax: 0, minContact: 1e9, maxSliver: 0, walk57Max: 0,
  radiusMax: 0, leashShareMin: 1, measured: 0, zones: Object.fromEntries(REGION_FACTIONS.map((f) => [f, {}])), ms: { generate: 0, certify: 0 }, notes: {}, fails: {},
});

const round = (v: number): number => Math.round(v * 10000) / 10000;
const pct = (v: readonly number[], q: number): number => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]; };
const mean = (v: readonly number[]): number => (v.length ? v.reduce((a, x) => a + x, 0) / v.length : 0);

function run(args: string[]): Sweep {
  const opt = (k: string): string | undefined => args.find((a) => a.startsWith(`${k}=`))?.slice(k.length + 1);
  const count = Number(args.find((a) => !a.includes("=")) ?? 100);
  const from = Number(opt("from") ?? 0);
  const styler = opt("styler") ?? "default";
  if (!["default", "none", "zone", "demo"].includes(styler)) throw new Error(`styler=${styler}: expected default, none, zone or demo`);
  const strictArg = opt("strict") ?? "auto";
  const strict: CertifyOptions["strict"] = strictArg === "auto" ? undefined : strictArg === "1" ? true : strictArg === "0" ? false : (strictArg.split(",") as RegionFaction[]);
  if (Array.isArray(strict) && strict.some((f) => !REGION_FACTIONS.includes(f))) throw new Error(`strict=${strictArg}: expected auto, 0, 1 or factions`);
  const decorEvery = Number(opt("decor") ?? 10);
  const options: MapgenOptions | undefined =
    styler === "none" ? { styleZones: null } : styler === "demo" ? { styleZones: demoStyleHook, shapeGates: false } : styler === "zone" ? { styleZones: zoneStylerHook } : undefined;
  const mode: CertifyOptions = styler === "none" ? {} : styler === "demo" ? { styled: true } : styler === "zone" || ZONE_STYLE_HOOK !== null ? { zone: true } : {};
  if (strict !== undefined) mode.strict = strict;

  warmMapgen();
  const out = empty();
  Object.assign(out, { from, count, styler, strict: strictArg, decorEvery });
  for (let s = from; s < from + count; s++) {
    const t0 = performance.now();
    const m = certifiedMap(s, options);
    const t1 = performance.now();
    out.ms.generate += t1 - t0;
    if (!m) { out.discarded.push(s); continue; }
    out.attempts.push(m.attempt);
    const r = certifyMap(m, mode);
    out.ms.certify += performance.now() - t1;
    for (const f of r.failures) out.failed.push(`seed ${s}: ${f}`);
    const st = r.stats;
    out.hazardTiles.push(...st.hazardExposure);
    out.hazardsOnWalks.push(...st.hazardsOnWalks);
    st.kinds.forEach((row, z) => { if (row[THEME_KIND[z]] > 0) out.themePresent[z]++; });
    out.floorShareMax = Math.max(out.floorShareMax, Math.max(...st.floor) / Math.min(...st.floor));
    out.minContact = Math.min(out.minContact, ...st.contact);
    out.maxSliver = Math.max(out.maxSliver, ...st.slivers);
    out.radiusMax = Math.max(out.radiusMax, ...st.radius);
    out.leashShareMin = Math.min(out.leashShareMin, ...st.leashShare);
    out.pool.push(st.pool);
    out.walk57Max = Math.max(out.walk57Max, st.walkRatio57);
    out.walkPath.push(round(st.walkRatioPath));
    out.rocks.push(st.rocks);
    out.features.push(st.features);
    for (const [k, v] of Object.entries(st.featureKinds)) out.featureKinds[k] = (out.featureKinds[k] ?? 0) + v;
    if (st.zones.length > 0) {
      out.measured++;
      st.zones.forEach((z, zi) => {
        const row = out.zones[REGION_FACTIONS[zi]];
        for (const [name, f] of Object.entries(ZONE_MEASURE_VALUES)) (row[name] ??= []).push(round(f(z)));
      });
    }
    if (decorEvery > 0 && (s - from) % decorEvery === 0) {
      const off = certifiedMap(s, { ...options, decor: false });
      const bad = off ? decorProblems(m, off) : ["no map with decor off"];
      for (const b of bad) out.decorBad.push(`seed ${s}: ${b}`);
    }
  }
  out.notes = { ...MAPGEN_NOTES };
  out.fails = { ...MAPGEN_FAILS };
  out.ms.generate = Math.round(out.ms.generate);
  out.ms.certify = Math.round(out.ms.certify);
  return out;
}

/** Merges shards: arrays concatenate, counts add, maxima and minima combine. */
function merge(parts: Sweep[]): Sweep {
  const out = empty();
  out.from = Math.min(...parts.map((p) => p.from));
  out.styler = parts[0].styler;
  out.strict = parts[0].strict;
  out.decorEvery = parts[0].decorEvery;
  for (const p of parts) {
    out.count += p.count;
    out.discarded.push(...p.discarded);
    out.failed.push(...p.failed);
    out.decorBad.push(...p.decorBad);
    for (const k of ["attempts", "pool", "walkPath", "rocks", "features", "hazardsOnWalks", "hazardTiles"] as const) out[k].push(...p[k]);
    p.themePresent.forEach((v, i) => { out.themePresent[i] += v; });
    out.floorShareMax = Math.max(out.floorShareMax, p.floorShareMax);
    out.minContact = Math.min(out.minContact, p.minContact);
    out.maxSliver = Math.max(out.maxSliver, p.maxSliver);
    out.walk57Max = Math.max(out.walk57Max, p.walk57Max);
    out.radiusMax = Math.max(out.radiusMax, p.radiusMax);
    out.leashShareMin = Math.min(out.leashShareMin, p.leashShareMin);
    out.measured += p.measured;
    for (const [k, v] of Object.entries(p.featureKinds)) out.featureKinds[k] = (out.featureKinds[k] ?? 0) + v;
    for (const f of REGION_FACTIONS) for (const [name, vals] of Object.entries(p.zones[f] ?? {})) (out.zones[f][name] ??= []).push(...vals);
    out.ms.generate += p.ms.generate;
    out.ms.certify += p.ms.certify;
    for (const [k, v] of Object.entries(p.notes)) out.notes[k] = (out.notes[k] ?? 0) + v;
    for (const [k, v] of Object.entries(p.fails)) out.fails[k] = (out.fails[k] ?? 0) + v;
  }
  return out;
}

const ROW_ORDER = Object.keys(ZONE_MEASURE_VALUES);

/** The readable table: hard checks, then the per-zone matrix (mean [p10-p90], `!` on a window breach), then the breaches. */
function renderTable(o: Sweep): string {
  const L: string[] = [];
  const maps = o.attempts.length;
  const T = SWEEP_THRESHOLDS;
  L.push(`mapSweep seeds ${o.from}..${o.from + o.count - 1} (${o.count}), styler=${o.styler}, strict=${o.strict}, ${maps} maps, certify ${(o.ms.certify / Math.max(1, maps)).toFixed(0)} ms and generate ${(o.ms.generate / Math.max(1, maps)).toFixed(0)} ms per map`);
  L.push("");
  L.push("HARD (a failure rejects the map)");
  L.push(`  failures ${o.failed.length}${o.failed.length ? "   <-- FAIL" : ""}${o.failed.slice(0, 8).map((f) => `\n    ${f}`).join("")}`);
  L.push(`  decor on/off mismatches ${o.decorBad.length}${o.decorBad.slice(0, 4).map((f) => `\n    ${f}`).join("")}`);
  L.push(`  findPath walk ratio max ${Math.max(0, ...o.walkPath).toFixed(3)} (hard <= 1.2), p90 ${pct(o.walkPath, 0.9).toFixed(3)} (report <= ${T.walkRatioP90}); BFS 5/7 max ${o.walk57Max.toFixed(3)} (report only)`);
  L.push(`  hazards on member walks max ${Math.max(0, ...o.hazardsOnWalks)} (hard <= 8), p90 ${pct(o.hazardsOnWalks, 0.9)} (report <= ${T.hazardsP90})`);
  L.push(`  pool ${Math.min(...o.pool)}..${Math.max(...o.pool)} (24..32); floor share max ${o.floorShareMax.toFixed(3)} (<= 1.15); ring contact min ${o.minContact}; sliver max ${o.maxSliver}; territory radius max ${o.radiusMax.toFixed(1)} tiles`);
  L.push("");
  L.push("REPORT thresholds (across the sweep)");
  const aps = maps ? 1 + mean(o.attempts) : 0;
  L.push(`  attempts per seed ${aps.toFixed(3)} (<= ${T.attemptsPerSeed})${aps > T.attemptsPerSeed ? " !" : ""}; discarded ${o.discarded.length} (${T.discards})${o.discarded.length > T.discards ? " !" : ""}${o.discarded.length ? ` [${o.discarded.slice(0, 10).join(",")}]` : ""}`);
  L.push(`  theme present on ${o.themePresent.map((n, i) => `${THEME_NAME[i]} ${n}/${maps}`).join(", ")}`);
  const kinds = CERT_FEATURE_KINDS.filter((k) => o.featureKinds[k]).map((k) => `${k} ${(o.featureKinds[k] / Math.max(1, maps)).toFixed(2)}`);
  L.push(`  features per map ${kinds.length ? kinds.join(", ") : "none"} (total ${mean(o.features).toFixed(1)}, max ${Math.max(0, ...o.features)}); wall tiles per map ${mean(o.rocks).toFixed(0)}`);
  if (Object.keys(o.fails).length) L.push(`  attempt failures ${Object.entries(o.fails).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  L.push("");
  L.push(`PER ZONE over ${o.measured} measured maps: mean [p10-p90]; ! = outside its contract window (section 4)`);
  const W = 23;
  L.push(`  ${"measure".padEnd(15)}${REGION_FACTIONS.map((f) => f.padEnd(W)).join("")}`);
  const breaches: string[] = [];
  for (const name of ROW_ORDER) {
    const cells = REGION_FACTIONS.map((f) => {
      const v = o.zones[f][name] ?? [];
      if (!v.length) return "-".padEnd(W);
      const w = ZONE_WINDOWS[f][name];
      const j = w ? judgeWindow(v, w) : null;
      if (j && !j.ok) breaches.push(`  ${f.padEnd(10)} ${name.padEnd(15)} mean ${mean(v).toFixed(2)}, window ${w.lo}..${w.hi === Infinity ? "+" : w.hi}${w.share !== undefined ? ` on ${(w.share * 100).toFixed(0)}% of seeds (got ${(j.inside * 100).toFixed(0)}%)` : ""}`);
      const f2 = (x: number): string => (Math.abs(x) >= 100 ? x.toFixed(0) : Number.isInteger(x) ? String(x) : x.toFixed(Math.abs(x) >= 10 ? 1 : 2));
      return `${f2(mean(v))} [${f2(pct(v, 0.1))}-${f2(pct(v, 0.9))}]${j && !j.ok ? " !" : ""}`.padEnd(W);
    });
    if (REGION_FACTIONS.every((f) => !(o.zones[f][name] ?? []).some((x) => x !== 0)) && !REGION_FACTIONS.some((f) => ZONE_WINDOWS[f][name])) continue;
    L.push(`  ${name.padEnd(15)}${cells.join("")}`);
  }
  L.push("");
  L.push(`WINDOW BREACHES (report only: investigated, never an automatic failure) ${breaches.length}`);
  for (const b of breaches) L.push(b);
  return L.join("\n");
}

const args = process.argv.slice(2);
const mergeArg = args.find((a) => a.startsWith("merge="));
let result: Sweep;
if (mergeArg) {
  const parts = mergeArg.slice(6).split(",").map((f) => {
    const lines = readFileSync(f, "utf8").trim().split("\n");
    return JSON.parse(lines[lines.length - 1]) as Sweep;
  });
  result = merge(parts);
} else result = run(args);
console.log(JSON.stringify(result));
const where = args.find((a) => a.startsWith("table="))?.slice(6) ?? "stderr";
if (where === "stdout") console.log(renderTable(result));
else if (where !== "off") console.error(renderTable(result));

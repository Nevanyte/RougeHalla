// Report CLI for the faction-cycle harness (factionCycle.ts): the 50 mirror cells and the 10 signature openings through
// the real sim, printed like COUNTER_REVIEW.md's tables, optionally checked pair by pair against testing/realtime.py.
// Report-only: it never fails the build, it exits non-zero only for bad arguments or a run that throws.
//
//   npm run harness:factions -- [--mode trades|full|policy] [--nmax 12] [--sub 1] [--ref path.json | --python] [--json out.json]
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { BEATS, DUEL_PACE, FACTIONS, SIGNATURE_WEAPONS, type WeaponId } from "@raid/shared";
import { cellStats, phaseGrid, runCell, type CellStats, type DuelMode, type Fighter } from "./factionCycle";
import { fullSetups } from "./matrix";

const USAGE = `Usage: harness:factions [--mode trades|full|policy] [--nmax 12] [--sub 1] [--ref path.json | --python] [--json out.json]

Runs the faction cycle through the real sim: every designed edge with the same weapon on both sides (10 x 5 mirror
cells) and with both on their signature weapons (10 openings).

  --mode trades  every swing that lands and every projectile that leaves hits the other fighter in that same tick, so
                 a duel is the faction rules alone; comparable with testing/realtime_paced.py (default)
  --mode full    real melee arcs and projectile flight, with blocks, reflections and stagger; the two still stand face
                 to face, so shields facing each other block every bash (only damage over time gets through)
  --mode policy  both play their weapon by the shared policies (Phase 9's weapon duel: moving, spacing, strafing),
                 from the weapon matrix's 18 starting setups per cell (--nmax and --sub don't apply)
  --nmax N       at most N first-swing offsets per fighter, thinned evenly: up to N x N phase pairs per cell (default 12)
  --sub S        refine the first-swing grid S times (default 1)
  --ref FILE     compare with the JSON of \`python3 testing/realtime_paced.py --k 2 --nmax N --sub S --pairs\`
  --python       run that script with the same nmax and sub and compare with it (needs python3 with numpy)
  --json FILE    write every cell, with its stats and phase pairs, in realtime_paced.py's JSON format

Report only: exits 0 unless the arguments are invalid or the run throws.`;

/** The order of realtime.py's WEAPONS (and COUNTER_REVIEW.md's columns), not shared's WEAPON_IDS. */
const MIRROR_WEAPONS: readonly WeaponId[] = ["sword", "axe", "bow", "wand", "shield"];
/** "Same hp" in the comparison; realtime_paced.py rounds the fractions to 6 decimals, so exact agreement shows ~5e-7. */
const HP_TOLERANCE = 1e-4;

type CellKind = "mirror" | "sig";
interface CellSpec { kind: CellKind; a: Fighter; b: Fighter }
/** realtime_paced.py's pair rows: [win, frac0, frac1, t]. */
type PairRow = [number, number, number, number];
interface CellReport extends CellSpec { stats: CellStats; pairs: PairRow[] }
/** realtime_paced.py's JSON plus `mode`, so a trades run and a full run cannot be mixed up when diffed. */
interface Report { k: number; sub: number; nmax: number; mode: DuelMode; cells: CellReport[] }
interface RefCell extends CellSpec { stats: CellStats; pairs?: PairRow[] }
interface RefReport { k: number; sub: number; nmax: number; cells: RefCell[] }

interface Options {
  mode: DuelMode;
  nmax: number;
  sub: number;
  ref?: string;
  python: boolean;
  json?: string;
}

class UsageError extends Error {}

function parseCli(args: string[]): Options | null {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      allowPositionals: false,
      options: {
        mode: { type: "string" }, nmax: { type: "string" }, sub: { type: "string" }, ref: { type: "string" },
        python: { type: "boolean" }, json: { type: "string" }, help: { type: "boolean", short: "h" },
      },
    }));
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
  if (values.help) return null;
  const mode = values.mode ?? "trades";
  if (mode !== "trades" && mode !== "full" && mode !== "policy") {
    throw new UsageError(`--mode must be trades, full or policy, not "${mode}"`);
  }
  const int = (name: string, raw: string | undefined, fallback: number, min: number): number => {
    if (raw === undefined) return fallback;
    const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!(n >= min)) throw new UsageError(`--${name} must be an integer of at least ${min}, not "${raw}"`);
    return n;
  };
  if (values.ref !== undefined && values.python) throw new UsageError("--ref and --python are mutually exclusive");
  return {
    mode, nmax: int("nmax", values.nmax, 12, 2), sub: int("sub", values.sub, 1, 1),
    ref: values.ref, python: values.python === true, json: values.json,
  };
}

/** Every edge in BEATS order: its five mirror cells, then its signature opening (realtime_paced.py's order). */
function cellSpecs(): CellSpec[] {
  const out: CellSpec[] = [];
  for (const [win, lose] of BEATS) {
    for (const weapon of MIRROR_WEAPONS) {
      out.push({ kind: "mirror", a: { faction: win, weapon }, b: { faction: lose, weapon } });
    }
    out.push({
      kind: "sig", a: { faction: win, weapon: SIGNATURE_WEAPONS[win] }, b: { faction: lose, weapon: SIGNATURE_WEAPONS[lose] },
    });
  }
  return out;
}

const round = (x: number, digits: number): number => Math.round(x * 10 ** digits) / 10 ** digits;
const pad = (s: string, w: number): string => s.padEnd(w);
const padL = (s: string, w: number): string => s.padStart(w);
const signed = (x: number, digits: number): string => {
  const text = x.toFixed(digits);
  return Number(text) < 0 ? text : `+${text.replace(/^-/, "")}`;
};

/** "Sentenced > Plague" is the longest edge. */
const EDGE_WIDTH = 20;
const edgeLabel = (c: CellSpec): string => `${FACTIONS[c.a.faction].name} > ${FACTIONS[c.b.faction].name}`;
const weaponLabel = (c: CellSpec): string => (c.kind === "sig" ? `${c.a.weapon}/${c.b.weapon}` : c.a.weapon);
const cellLabel = (c: CellSpec): string => `${pad(edgeLabel(c), EDGE_WIDTH)} ${weaponLabel(c)}`;
const cellKey = (c: CellSpec): string => `${c.kind}|${c.a.faction}:${c.a.weapon}|${c.b.faction}:${c.b.weapon}`;

/** A win rate in whole percent; one decimal when rounding would hide that it is below 100. */
function winPct(rate: number): string {
  const p = rate * 100;
  return `${p.toFixed(rate < 1 && p >= 99.5 ? 1 : 0)}%`;
}
const hpPct = (frac: number): string => (frac * 100).toFixed(1);

function printHeader(o: Options, specs: CellSpec[]): void {
  if (o.mode === "policy") {
    const n = fullSetups().length;
    console.log(`Faction cycle harness | mode: policy | k (DUEL_PACE): ${DUEL_PACE} | ${n} weapon-matrix setups per cell`);
    console.log(`${specs.length} cells, ${specs.length * n} duels`);
    return;
  }
  const sizes = specs.map((c) => phaseGrid(c.a, c.b, o.sub, o.nmax).offs.length * phaseGrid(c.b, c.a, o.sub, o.nmax).offs.length);
  const total = sizes.reduce((s, n) => s + n, 0);
  console.log(`Faction cycle harness | mode: ${o.mode} | k (DUEL_PACE): ${DUEL_PACE} | grid: nmax ${o.nmax}, sub ${o.sub}`);
  console.log(`${specs.length} cells, ${Math.min(...sizes)}-${Math.max(...sizes)} phase pairs each, ${total} duels`);
  if (o.mode === "full") console.log("note: face to face, shields block each other's bashes; see --mode policy for moving fighters");
}

function printMirror(cells: CellReport[]): void {
  const mirror = cells.filter((c) => c.kind === "mirror");
  console.log("\nMirror cells (same weapon on both sides): win rate, worst winner hp %. \"!\" marks a cell below 100%.");
  console.log((pad("", EDGE_WIDTH) + MIRROR_WEAPONS.map((w) => pad(w, 13)).join("")).trimEnd());
  for (const [win, lose] of BEATS) {
    const row = MIRROR_WEAPONS.map((weapon) => {
      const c = mirror.find((m) => m.a.faction === win && m.b.faction === lose && m.a.weapon === weapon)!;
      return pad(`${winPct(c.stats.rate)} ${hpPct(c.stats.worst)}${c.stats.rate < 1 ? " !" : ""}`, 13);
    });
    console.log((pad(`${FACTIONS[win].name} > ${FACTIONS[lose].name}`, EDGE_WIDTH) + row.join("")).trimEnd());
  }
  console.log(summary("Mirror", mirror));
}

function printSignatures(cells: CellReport[]): void {
  const sig = cells.filter((c) => c.kind === "sig");
  console.log("\nSignature openings (each faction on its starting weapon)");
  console.log(`${pad("Pair", EDGE_WIDTH)}${pad("Weapons", 13)}${padL("Win", 6)}${padL("Worst %", 9)}${padL("Mean %", 8)}${padL("Median t", 10)}`);
  for (const c of sig) {
    const s = c.stats;
    console.log(
      pad(edgeLabel(c), EDGE_WIDTH) + pad(weaponLabel(c), 13) + padL(winPct(s.rate), 6) + padL(hpPct(s.worst), 9) +
      padL(hpPct(s.mean), 8) + padL(`${s.t.toFixed(1)} s`, 10) + (s.rate < 1 ? "  !" : ""),
    );
  }
  console.log(summary("Signature openings", sig));
}

function summary(name: string, cells: CellReport[]): string {
  const full = cells.filter((c) => c.stats.rate >= 1).length;
  const low = cells.reduce((m, c) => (c.stats.worst < m.stats.worst ? c : m));
  return `${name}: ${full}/${cells.length} cells at 100%; lowest worst hp ${hpPct(low.stats.worst)}% (${edgeLabel(low)}, ${weaponLabel(low)})`;
}

// ---- reference (testing/realtime_paced.py) ----

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
/** npm runs workspace scripts in packages/server; relative paths on the command line mean where the user typed them. */
const userPath = (p: string): string => resolve(process.env.INIT_CWD || process.cwd(), p);

function isRefReport(v: unknown): v is RefReport {
  const r = v as RefReport | null;
  return !!r && typeof r === "object" && Array.isArray(r.cells) && r.cells.every((c) => c && c.a && c.b && c.stats);
}

function parseRef(text: string, what: string): { ref?: RefReport; note?: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { note: `${what} is not valid JSON` };
  }
  return isRefReport(data) ? { ref: data } : { note: `${what} is not realtime_paced.py output (no cells)` };
}

function loadRef(path: string): { ref?: RefReport; note?: string } {
  try {
    return parseRef(readFileSync(userPath(path), "utf8"), path);
  } catch (e) {
    return { note: `cannot read ${path}: ${(e as Error).message}` };
  }
}

function runPython(nmax: number, sub: number): { ref?: RefReport; note?: string } {
  const script = resolve(REPO_ROOT, "testing/realtime_paced.py");
  const args = [script, "--k", String(DUEL_PACE), "--nmax", String(nmax), "--sub", String(sub), "--pairs"];
  const r = spawnSync("python3", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.error) return { note: `could not run python3 (${r.error.message})` };
  if (r.status !== 0) {
    const err = (r.stderr ?? "").trim();
    return {
      note: /No module named ['"]?numpy/.test(err)
        ? "python3 has no numpy (pip install numpy), which testing/realtime.py needs"
        : `testing/realtime_paced.py failed (exit ${r.status}): ${err.split("\n").slice(-3).join(" | ")}`,
    };
  }
  return parseRef(r.stdout, "testing/realtime_paced.py output");
}

interface CellDiff {
  cell: CellReport;
  /** Why the cell does not agree; empty when it does. */
  problems: string[];
  /** Pair-level numbers; undefined when the pairs do not line up. */
  sameWinner?: number;
  maxHp?: number;
  dRate?: number;
  dWorst?: number;
  dMean?: number;
  dT?: number;
}

function compare(cell: CellReport, ref: RefCell | undefined): CellDiff {
  if (!ref) return { cell, problems: ["not in the reference"] };
  const out: CellDiff = {
    cell, problems: [],
    dRate: (cell.stats.rate - ref.stats.rate) * 100, dWorst: (cell.stats.worst - ref.stats.worst) * 100,
    dMean: (cell.stats.mean - ref.stats.mean) * 100, dT: cell.stats.t - ref.stats.t,
  };
  if (!ref.pairs) {
    out.problems.push("the reference has no pairs (run it with --pairs)");
  } else if (ref.pairs.length !== cell.pairs.length) {
    out.problems.push(`${cell.pairs.length} pairs here, ${ref.pairs.length} in the reference (different nmax or sub)`);
  } else {
    let same = 0;
    let maxHp = 0;
    cell.pairs.forEach((p, i) => {
      const q = ref.pairs![i]!;
      if (p[0] === q[0]) same++;
      maxHp = Math.max(maxHp, Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));
    });
    out.sameWinner = same;
    out.maxHp = maxHp;
    if (same < cell.pairs.length) out.problems.push(`winner differs on ${cell.pairs.length - same}/${cell.pairs.length} pairs`);
    if (maxHp > HP_TOLERANCE) out.problems.push(`hp fraction differs by up to ${maxHp.toPrecision(3)}`);
  }
  return out;
}

function printComparison(o: Options, report: Report, ref: RefReport, source: string): void {
  console.log(`\nComparison with realtime.py (${source}; k ${ref.k}, nmax ${ref.nmax}, sub ${ref.sub})`);
  if (ref.k !== DUEL_PACE || ref.nmax !== o.nmax || ref.sub !== o.sub) {
    console.log(`warning: the reference was not run at this k, nmax and sub (${DUEL_PACE}, ${o.nmax}, ${o.sub}); pairs may not line up`);
  }
  if (o.mode !== "trades") console.log(`note: realtime.py is the trades model; in ${o.mode} mode differences are expected`);
  const byKey = new Map(ref.cells.map((c) => [cellKey(c), c]));
  const diffs = report.cells.map((c) => compare(c, byKey.get(cellKey(c))));

  console.log(
    `${pad("Cell", 40)}${padL("Winner", 8)}${padL("Max dhp", 10)}${padL("dRate", 8)}${padL("dWorst", 8)}${padL("dMean", 8)}${padL("dT s", 8)}`,
  );
  for (const d of diffs) {
    const pairs = d.cell.pairs.length;
    const winner = d.sameWinner === undefined ? "-" : `${d.sameWinner}/${pairs}`;
    const maxHp = d.maxHp === undefined ? "-" : d.maxHp.toExponential(1);
    const delta = (x: number | undefined, digits: number): string => (x === undefined ? "-" : signed(x, digits));
    console.log(
      pad(`${d.cell.kind === "sig" ? "sig   " : "mirror"} ${cellLabel(d.cell)}`, 40) + padL(winner, 8) + padL(maxHp, 10) +
      padL(delta(d.dRate, 2), 8) + padL(delta(d.dWorst, 2), 8) + padL(delta(d.dMean, 2), 8) + padL(delta(d.dT, 2), 8) +
      (d.problems.length ? "  DIFF" : ""),
    );
  }
  console.log("Deltas are harness minus realtime.py (rate, worst and mean in percentage points).");
  console.log(
    "Median t can differ where Holy loses: realtime.py applies Holy's same-tick lifesteal with the killing blow, the sim applies damage first.",
  );

  const agree = diffs.filter((d) => d.problems.length === 0).length;
  const pairsTotal = diffs.reduce((s, d) => s + d.cell.pairs.length, 0);
  const pairsSame = diffs.reduce((s, d) => s + (d.sameWinner ?? 0), 0);
  const maxHp = Math.max(0, ...diffs.map((d) => d.maxHp ?? 0));
  console.log(`\nPairs with the same winner: ${pairsSame}/${pairsTotal}; largest hp fraction difference: ${maxHp.toExponential(2)}`);
  console.log(`Verdict: agrees with realtime.py on ${agree}/${diffs.length} cells (same winner on every pair and hp within ${HP_TOLERANCE.toExponential(0)})`);
  for (const d of diffs) {
    if (d.problems.length) console.log(`  ${d.cell.kind} ${cellLabel(d.cell)}: ${d.problems.join("; ")}`);
  }
}

function writeJson(path: string, report: Report): void {
  const file = userPath(path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(report, null, 1) + "\n");
  console.log(`\nWrote ${file}`);
}

function parseOrExit(): Options | null {
  try {
    return parseCli(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`${e.message}\n\n${USAGE}`);
    return process.exit(2);
  }
}

function main(): void {
  const o = parseOrExit();
  if (!o) {
    console.log(USAGE);
    return;
  }

  const t0 = performance.now();
  const specs = cellSpecs();
  printHeader(o, specs);

  const cells: CellReport[] = specs.map((spec, i) => {
    if (process.stderr.isTTY) process.stderr.write(`\r  cell ${i + 1}/${specs.length}`);
    const results = runCell(spec.a, spec.b, { mode: o.mode, nmax: o.nmax, sub: o.sub });
    return {
      ...spec,
      stats: cellStats(results),
      pairs: results.map((r): PairRow => [r.win, round(r.frac0, 6), round(r.frac1, 6), round(r.t, 4)]),
    };
  });
  if (process.stderr.isTTY) process.stderr.write("\r                \r");
  const simSeconds = (performance.now() - t0) / 1000;

  const report: Report = { k: DUEL_PACE, sub: o.sub, nmax: o.nmax, mode: o.mode, cells };
  printMirror(cells);
  printSignatures(cells);

  let pythonSeconds = 0;
  if (o.ref !== undefined || o.python) {
    const t1 = performance.now();
    const { ref, note } = o.ref !== undefined ? loadRef(o.ref) : runPython(o.nmax, o.sub);
    pythonSeconds = o.python ? (performance.now() - t1) / 1000 : 0;
    if (ref) printComparison(o, report, ref, o.ref ?? "testing/realtime_paced.py --pairs");
    else console.log(`\nNo comparison with realtime.py: ${note}`);
  }
  if (o.json !== undefined) writeJson(o.json, report);

  const total = (performance.now() - t0) / 1000;
  console.log(`\nElapsed ${total.toFixed(1)} s (sim ${simSeconds.toFixed(1)} s${o.python ? `, realtime.py ${pythonSeconds.toFixed(1)} s` : ""})`);
}

main();

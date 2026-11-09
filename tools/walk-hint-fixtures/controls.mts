// Compiled actual-source semantic controls for the reached walk-hint fixture. Each mutation is applied
// to the actual walkHint.ts text in memory, bundled with the real scenario/other source modules, and
// checked by the same assertFacts verifier used by capture. Compiler/setup failures are not kills.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { assertFacts } from "/repo/tools/walk-hint-fixtures/scenario.mts";

const OUT = process.env.RH_WALK_HINT_OUTPUT || "/tmp/walk-hint-controls";
const CANON = "/repo/parity/walk-hint/source.json";
const WALK = "/repo/packages/server/src/sim/walkHint.ts";
const MUTATIONS = [
  { id: "forced-zero", find: "export function updateWalkHints(world: World): void {\n", replace: "export function updateWalkHints(world: World): void {\n  return;\n" },
  { id: "wrong-cap", find: "const cap = locked || amove ? 1 : WALK_HINT_MAX_TICKS;", replace: "const cap = locked || amove ? 1 : WALK_HINT_MAX_TICKS - 1;" },
  { id: "hysteresis-always", find: "if (Math.min(d, 256 - d) >= WALK_DIR_HYSTERESIS) x.walkDir = dir;", replace: "if (Math.min(d, 256 - d) >= 0) x.walkDir = dir;" },
  { id: "provenance-only-comment", find: "const SPEED_SLACK = 1.01;", replace: "const SPEED_SLACK = 1.01; // provenance-only control" },
];
function apply(source, m) {
  const first = source.indexOf(m.find);
  if (first < 0) throw new Error("mutation target missing: " + m.id);
  if (source.indexOf(m.find, first + 1) >= 0) throw new Error("mutation target not unique: " + m.id);
  return source.slice(0, first) + m.replace + source.slice(first + m.find.length);
}
function semantic(corpus) {
  const clone = JSON.parse(JSON.stringify(corpus));
  delete clone.profile;
  return clone;
}
function diff(a, b, path = "") {
  if (a === b) return null;
  if (typeof a !== typeof b) return path + " type";
  if (a === null || b === null) return path + " value";
  if (typeof a !== "object") return path;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return path + " length";
    for (let i = 0; i < a.length; i++) { const d = diff(a[i], b[i], path + "/" + i); if (d) return d; }
    return null;
  }
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    if (!(k in a) || !(k in b)) return path + "/" + k + " key";
    const d = diff(a[k], b[k], path + "/" + k); if (d) return d;
  }
  return null;
}
async function buildWithMutation(mutation) {
  const built = await build({
    entryPoints: ["/repo/tools/walk-hint-fixtures/scenario.mts"],
    bundle: true, write: false, platform: "node", format: "esm", absWorkingDir: "/repo", logLevel: "silent",
    plugins: [{ name: "walk-hint-mutation", setup(b) {
      b.onLoad({ filter: /\/packages\/server\/src\/sim\/walkHint\.ts$/ }, (args) => {
        let contents = readFileSync(args.path, "utf8");
        if (mutation) contents = apply(contents, mutation);
        return { contents, loader: "ts", resolveDir: dirname(args.path) };
      });
    } }],
  });
  if (built.outputFiles.length !== 1) throw new Error("expected one bundle");
  const out = join("/tmp", "walk-hint-control-" + (mutation ? mutation.id : "restored") + "-" + process.pid + ".mjs");
  writeFileSync(out, built.outputFiles[0].text);
  const mod = await import(pathToFileURL(out).href);
  if (typeof mod.runProbe !== "function" || typeof mod.assertFacts !== "function") throw new Error("scenario exports missing");
  return mod;
}
const canonical = JSON.parse(readFileSync(CANON, "utf8"));
assertFacts(canonical);
const rows = [];
let kills = 0;
for (const mutation of MUTATIONS) {
  const row = { id: mutation.id, status: "run" };
  try {
    const mod = await buildWithMutation(mutation);
    const { corpus } = mod.runProbe();
    const d = diff(semantic(canonical), semantic(corpus));
    row.changed = d !== null;
    row.firstDiff = d;
    if (mutation.id === "provenance-only-comment") {
      if (d === null) { row.status = "NON-KILL"; try { mod.assertFacts(corpus); row.verifier = "PASS"; } catch (e) { row.verifier = "FAIL"; row.status = "UNEXPECTED"; } }
      else row.status = "UNEXPECTED";
    } else {
      try {
        mod.assertFacts(corpus);
        row.status = "SURVIVOR";
      } catch (e) {
        row.status = "KILL";
        row.verifierError = String(e);
        kills++;
      }
    }
  } catch (error) {
    row.status = "ERROR";
    row.error = String(error);
  }
  rows.push(row);
  console.log("CONTROL " + row.id + ": " + row.status + (row.firstDiff ? " " + row.firstDiff : ""));
}
const restored = await buildWithMutation(null);
const restoredCorpus = restored.runProbe().corpus;
const restoredEqual = JSON.stringify(semantic(canonical)) === JSON.stringify(semantic(restoredCorpus));
let restoredVerifier = "PASS";
try { restored.assertFacts(restoredCorpus); } catch (e) { restoredVerifier = "FAIL: " + String(e); }
const required = MUTATIONS.filter((m) => m.id !== "provenance-only-comment").length;
const good = kills === required && restoredEqual && restoredVerifier === "PASS" && rows.every((r) => r.status === "KILL" || r.status === "NON-KILL") && rows.find((r) => r.id === "provenance-only-comment")?.status === "NON-KILL";
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "controls.json"), JSON.stringify({ format: "rh-walk-hint-controls/1", required, kills, restoredEqual, restoredVerifier, canonicalAssertions: "PASS", rows }, null, 2) + "\n");
console.log(JSON.stringify({ mode: "controls", required, kills, restoredEqual, restoredVerifier, ok: good }));
if (!good) throw new Error("controls failed");

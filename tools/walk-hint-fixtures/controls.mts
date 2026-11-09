// Compiled actual-source semantic controls for the reached walk-hint fixture. Each mutation is applied
// to the actual walkHint.ts text in memory, bundled with the real scenario/other source modules, and
// checked by the same assertFacts verifier. Baseline disk pins and executed mutated source are distinct.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { assertFacts } from "/repo/tools/walk-hint-fixtures/scenario.mts";

const OUT = process.env.RH_WALK_HINT_OUTPUT || "/tmp/walk-hint-controls";
const CANON = "/repo/parity/walk-hint/repair/source.json";
const WALK = "/repo/packages/server/src/sim/walkHint.ts";
const WALK_REL = "packages/server/src/sim/walkHint.ts";
const MUTATIONS = [
  { id: "forced-zero", find: "export function updateWalkHints(world: World): void {\n", replace: "export function updateWalkHints(world: World): void {\n  return;\n" },
  { id: "wrong-cap", find: "const cap = locked || amove ? 1 : WALK_HINT_MAX_TICKS;", replace: "const cap = locked || amove ? 1 : WALK_HINT_MAX_TICKS - 1;" },
  { id: "hysteresis-always", find: "if (Math.min(d, 256 - d) >= WALK_DIR_HYSTERESIS) x.walkDir = dir;", replace: "if (Math.min(d, 256 - d) >= 0) x.walkDir = dir;" },
  { id: "provenance-only-comment", find: "const SPEED_SLACK = 1.01;", replace: "const SPEED_SLACK = 1.01; // provenance-only control" },
];
function sha(s) { return createHash("sha256").update(s).digest("hex"); }
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
const baselineDisk = readFileSync(WALK, "utf8");
const baselineSha = sha(baselineDisk);
let buildSeq = 0;
async function buildScenario(mutation) {
  const onLoads = [];
  const built = await build({
    entryPoints: ["/repo/tools/walk-hint-fixtures/scenario.mts"],
    bundle: true, write: false, platform: "node", format: "esm", absWorkingDir: "/repo", logLevel: "silent",
    plugins: [{ name: "walk-hint-mutation", setup(b) {
      b.onLoad({ filter: /\/packages\/server\/src\/sim\/walkHint\.ts$/ }, (args) => {
        const original = readFileSync(args.path, "utf8");
        const executed = mutation ? apply(original, mutation) : original;
        onLoads.push({
          path: args.path, originalBytes: Buffer.byteLength(original), executedBytes: Buffer.byteLength(executed),
          originalSha256: sha(original), executedSha256: sha(executed), mutation: mutation ? mutation.id : null,
        });
        return { contents: executed, loader: "ts", resolveDir: dirname(args.path) };
      });
    } }],
  });
  if (built.outputFiles.length !== 1) throw new Error("expected one bundle");
  const bundleText = built.outputFiles[0].text;
  const bundleSha256 = sha(bundleText);
  if (onLoads.length !== 1) throw new Error("expected exactly one intended walkHint onLoad, got " + onLoads.length);
  const load = onLoads[0];
  if (load.path !== WALK) throw new Error("executed unexpected module path: " + load.path);
  if (load.originalSha256 !== baselineSha) throw new Error("onLoad original does not match baseline disk source");
  if (!mutation && load.executedSha256 !== load.originalSha256) throw new Error("pristine executed source differs from baseline");
  if (mutation && load.executedSha256 === load.originalSha256) throw new Error("mutation did not change executed source: " + mutation.id);
  buildSeq++;
  const bundlePath = join("/tmp", "walk-hint-control-" + (mutation ? mutation.id : "restored") + "-" + process.pid + "-" + buildSeq + "-" + bundleSha256.slice(0, 8) + ".mjs");
  writeFileSync(bundlePath, bundleText);
  if (sha(readFileSync(bundlePath, "utf8")) !== bundleSha256) throw new Error("bundle hash did not bind to written file");
  const mod = await import(pathToFileURL(bundlePath).href);
  if (typeof mod.runProbe !== "function" || typeof mod.assertFacts !== "function") throw new Error("scenario exports missing");
  return {
    mod,
    provenance: {
      mutation: mutation ? mutation.id : null,
      onLoadCount: onLoads.length, onLoadPath: load.path,
      originalBytes: load.originalBytes, executedBytes: load.executedBytes,
      originalSha256: load.originalSha256, executedSha256: load.executedSha256,
      bundleBytes: Buffer.byteLength(bundleText), bundleSha256, bundlePath,
      baselineDiskSha256: baselineSha,
    },
  };
}
const canonical = JSON.parse(readFileSync(CANON, "utf8"));
assertFacts(canonical);
if (canonical.profile?.source?.files?.[WALK_REL]?.sha256 !== baselineSha) throw new Error("canonical profile baseline walkHint pin does not equal baseline disk");
const pristine = await buildScenario(null);
const pristineCorpus = pristine.mod.runProbe().corpus;
const pristineSemanticEqual = diff(semantic(canonical), semantic(pristineCorpus)) === null;
if (!pristineSemanticEqual) throw new Error("pristine bundle semantic projection differs from canonical fixture");
pristine.mod.assertFacts(pristineCorpus);
const rows = [];
let kills = 0;
for (const mutation of MUTATIONS) {
  const row = { id: mutation.id, status: "run" };
  try {
    const built = await buildScenario(mutation);
    row.provenance = built.provenance;
    const { corpus } = built.mod.runProbe();
    row.runProbeSucceeded = true;
    const d = diff(semantic(canonical), semantic(corpus));
    row.semanticEqual = d === null;
    row.changed = d !== null;
    row.firstDiff = d;
    if (mutation.id === "provenance-only-comment") {
      if (!row.semanticEqual) {
        row.status = "UNEXPECTED";
      } else if (built.provenance.executedSha256 === built.provenance.originalSha256) {
        row.status = "UNEXPECTED";
      } else {
        try {
          built.mod.assertFacts(corpus);
          row.verifier = "PASS";
          row.executedProvenanceChanged = true;
          row.status = "NON-KILL";
        } catch (e) {
          row.verifier = "FAIL";
          row.verifierError = String(e);
          row.status = "UNEXPECTED";
        }
      }
    } else if (row.semanticEqual) {
      row.status = "SURVIVOR";
    } else {
      try {
        built.mod.assertFacts(corpus);
        row.status = "SURVIVOR";
      } catch (e) {
        row.verifier = "FAIL";
        row.verifierError = String(e);
        row.status = "KILL";
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
const restored = await buildScenario(null);
const restoredCorpus = restored.mod.runProbe().corpus;
const restoredEqual = diff(semantic(canonical), semantic(restoredCorpus)) === null;
let restoredVerifier = "PASS";
try { restored.mod.assertFacts(restoredCorpus); } catch (e) { restoredVerifier = "FAIL: " + String(e); }
const provKey = (p) => JSON.stringify({ originalSha256: p.originalSha256, executedSha256: p.executedSha256, bundleSha256: p.bundleSha256, onLoadCount: p.onLoadCount, onLoadPath: p.onLoadPath });
const restoredProvenanceEqual = provKey(pristine.provenance) === provKey(restored.provenance);
const required = MUTATIONS.filter((m) => m.id !== "provenance-only-comment").length;
const comment = rows.find((r) => r.id === "provenance-only-comment");
const good = kills === required && restoredEqual && restoredVerifier === "PASS" && restoredProvenanceEqual
  && rows.every((r) => r.status === "KILL" || r.status === "NON-KILL")
  && comment?.status === "NON-KILL" && comment?.semanticEqual === true && comment?.executedProvenanceChanged === true;
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "controls.json"), JSON.stringify({
  format: "rh-walk-hint-controls/2",
  required, kills,
  baseline: {
    diskWalkHint: { path: WALK, bytes: Buffer.byteLength(baselineDisk), sha256: baselineSha },
    canonicalProfileSource: canonical.profile.source.files[WALK_REL],
    note: "profile/source pins are baseline disk provenance; each row carries the executed onLoad/bundle provenance",
  },
  canonicalAssertions: "PASS",
  pristine: { provenance: pristine.provenance, semanticEqualCanonical: pristineSemanticEqual },
  restored: { provenance: restored.provenance, semanticEqualCanonical: restoredEqual, provenanceEqualPristine: restoredProvenanceEqual, verifier: restoredVerifier },
  rows,
}, null, 2) + "\n");
console.log(JSON.stringify({ mode: "controls", required, kills, restoredEqual, restoredProvenanceEqual, restoredVerifier, ok: good }));
if (!good) throw new Error("controls failed");

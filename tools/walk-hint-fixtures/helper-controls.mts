// Compiled actual-source semantic controls for the complete helper corpus. Each mutation is applied to
// the actual walkHint.ts text in esbuild onLoad, compiled with the real helper scenario, and checked by
// the same actual-source assertHelperFacts verifier. Compiler/setup failures are ERROR, never KILL.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { assertHelperFacts as assertBaseline } from "/repo/tools/walk-hint-fixtures/helper-scenario.mts";

const OUT = process.env.RH_WALK_HINT_OUTPUT || "/tmp/walk-hint-helper-controls";
const CANON = "/repo/parity/walk-hint/helpers/source.json";
const WALK = "/repo/packages/server/src/sim/walkHint.ts";
const MUTATIONS = [
  { id: "lock-always-free", find: "function lockNext(world: World, c: PlayerCombatant, at: number): { free: boolean; hold: boolean } {\n", replace: "function lockNext(world: World, c: PlayerCombatant, at: number): { free: boolean; hold: boolean } {\n  return { free: true, hold: false };\n" },
  { id: "amove-never-acquires", find: "function acquireNext(world: World, c: PlayerCombatant, at: number): boolean {\n", replace: "function acquireNext(world: World, c: PlayerCombatant, at: number): boolean {\n  return false;\n" },
  { id: "ice-never-holds", find: "function iceAlong(world: World, c: PlayerCombatant, ux: number, uy: number, dist: number): boolean {\n", replace: "function iceAlong(world: World, c: PlayerCombatant, ux: number, uy: number, dist: number): boolean {\n  return false;\n" },
  { id: "held-never-held", find: "  if (!(held || w.bufferedUntil >= c.s.readyAt)) return false;\n", replace: "  return false;\n" },
  { id: "hook-no-zero", find: "function zeroAll(world: World): void {\n", replace: "function zeroAll(world: World): void {\n  return;\n" },
  { id: "hysteresis-always", find: "if (Math.min(d, 256 - d) >= WALK_DIR_HYSTERESIS) x.walkDir = dir;", replace: "if (Math.min(d, 256 - d) >= 0) x.walkDir = dir;" },
  { id: "provenance-only-comment", find: "const SPEED_SLACK = 1.01;", replace: "const SPEED_SLACK = 1.01; // provenance-only helper control" },
];
function sha(s) { return createHash("sha256").update(s).digest("hex"); }
function semantic(corpus) { const c = JSON.parse(JSON.stringify(corpus)); delete c.profile; return c; }
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
const baseline = readFileSync(WALK, "utf8");
const baselineSha = sha(baseline);
let buildSeq = 0;
async function buildScenario(mutation) {
  const loads = [];
  const built = await build({
    entryPoints: ["/repo/tools/walk-hint-fixtures/helper-scenario.mts"],
    bundle: true, write: false, platform: "node", format: "esm", absWorkingDir: "/repo", logLevel: "silent",
    plugins: [{ name: "helper-walk-hint-mutation", setup(b) {
      b.onLoad({ filter: /\/packages\/server\/src\/sim\/walkHint\.ts$/ }, (args) => {
        const original = readFileSync(args.path, "utf8");
        const executed = mutation ? (() => {
          const first = original.indexOf(mutation.find);
          if (first < 0) throw new Error("mutation target missing: " + mutation.id);
          if (original.indexOf(mutation.find, first + 1) >= 0) throw new Error("mutation target not unique: " + mutation.id);
          return original.slice(0, first) + mutation.replace + original.slice(first + mutation.find.length);
        })() : original;
        loads.push({ path: args.path, originalBytes: Buffer.byteLength(original), executedBytes: Buffer.byteLength(executed), originalSha256: sha(original), executedSha256: sha(executed) });
        return { contents: executed, loader: "ts", resolveDir: dirname(args.path) };
      });
    } }],
  });
  if (built.outputFiles.length !== 1) throw new Error("expected one helper bundle");
  const bundleText = built.outputFiles[0].text;
  const bundleSha256 = sha(bundleText);
  if (loads.length !== 1) throw new Error("expected exactly one intended walkHint load, got " + loads.length);
  const load = loads[0];
  if (load.path !== WALK) throw new Error("unexpected module loaded: " + load.path);
  if (load.originalSha256 !== baselineSha) throw new Error("onLoad original differs from baseline");
  if (!mutation && load.executedSha256 !== baselineSha) throw new Error("pristine executed source differs from baseline");
  if (mutation && load.executedSha256 === baselineSha) throw new Error("mutation did not alter executed source: " + mutation.id);
  buildSeq++;
  const bundlePath = join("/tmp", "walk-hint-helper-control-" + (mutation ? mutation.id : "restored") + "-" + process.pid + "-" + buildSeq + "-" + bundleSha256.slice(0, 8) + ".mjs");
  writeFileSync(bundlePath, bundleText);
  if (sha(readFileSync(bundlePath, "utf8")) !== bundleSha256) throw new Error("bundle write/hash mismatch");
  const mod = await import(pathToFileURL(bundlePath).href);
  if (typeof mod.runHelpers !== "function" || typeof mod.assertHelperFacts !== "function") throw new Error("helper exports missing");
  return { mod, provenance: { mutation: mutation ? mutation.id : null, onLoadCount: loads.length, onLoadPath: load.path, originalBytes: load.originalBytes, executedBytes: load.executedBytes, originalSha256: load.originalSha256, executedSha256: load.executedSha256, bundleBytes: Buffer.byteLength(bundleText), bundleSha256, bundlePath, baselineDiskSha256: baselineSha } };
}
const canonical = JSON.parse(readFileSync(CANON, "utf8"));
assertBaseline(canonical);
const pristine = await buildScenario(null);
const pristineCorpus = pristine.mod.runHelpers();
pristine.mod.assertHelperFacts({ format: "rh-walk-hint-helpers/1", profile: canonical.profile, cases: pristineCorpus });
const pristineEqual = diff(semantic(canonical), semantic({ format: "rh-walk-hint-helpers/1", profile: canonical.profile, cases: pristineCorpus })) === null;
if (!pristineEqual) {
  const d = diff(semantic(canonical), semantic({ format: "rh-walk-hint-helpers/1", profile: canonical.profile, cases: pristineCorpus }));
  mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, "pristine-diff.json"), JSON.stringify({ diff: d, canonicalCases: canonical.cases, pristineCases: pristineCorpus }, null, 2) + "\n");
  throw new Error("pristine bundle differs semantically from canonical: " + d);
}
const rows = [];
let kills = 0;
for (const mutation of MUTATIONS) {
  const row = { id: mutation.id, status: "run" };
  try {
    const built = await buildScenario(mutation);
    row.provenance = built.provenance;
    const cases = built.mod.runHelpers();
    row.runHelpersSucceeded = true;
    const corpus = { format: "rh-walk-hint-helpers/1", profile: canonical.profile, cases };
    const d = diff(semantic(canonical), semantic(corpus));
    row.changed = d !== null; row.firstDiff = d; row.semanticEqual = d === null;
    if (mutation.id === "provenance-only-comment") {
      if (!row.semanticEqual || built.provenance.executedSha256 === baselineSha) row.status = "UNEXPECTED";
      else {
        try { built.mod.assertHelperFacts(corpus); row.verifier = "PASS"; row.status = "NON-KILL"; }
        catch (e) { row.verifier = "FAIL"; row.verifierError = String(e); row.status = "UNEXPECTED"; }
      }
    } else if (row.semanticEqual) row.status = "SURVIVOR";
    else {
      try { built.mod.assertHelperFacts(corpus); row.status = "SURVIVOR"; }
      catch (e) { row.verifier = "FAIL"; row.verifierError = String(e); row.status = "KILL"; kills++; }
    }
  } catch (error) { row.status = "ERROR"; row.error = String(error); }
  rows.push(row);
  console.log("HELPER CONTROL " + row.id + ": " + row.status + (row.firstDiff ? " " + row.firstDiff : ""));
}
const restored = await buildScenario(null);
const restoredCases = restored.mod.runHelpers();
const restoredCorpus = { format: "rh-walk-hint-helpers/1", profile: canonical.profile, cases: restoredCases };
const restoredEqual = diff(semantic(canonical), semantic(restoredCorpus)) === null;
let restoredVerifier = "PASS";
try { restored.mod.assertHelperFacts(restoredCorpus); } catch (e) { restoredVerifier = "FAIL: " + String(e); }
const provKey = (p) => JSON.stringify({ originalSha256: p.originalSha256, executedSha256: p.executedSha256, bundleSha256: p.bundleSha256, onLoadCount: p.onLoadCount, onLoadPath: p.onLoadPath });
const restoredProvenanceEqual = provKey(pristine.provenance) === provKey(restored.provenance);
const required = MUTATIONS.filter((m) => m.id !== "provenance-only-comment").length;
const comment = rows.find((r) => r.id === "provenance-only-comment");
const good = kills === required && restoredEqual && restoredProvenanceEqual && restoredVerifier === "PASS"
  && rows.every((r) => r.status === "KILL" || r.status === "NON-KILL")
  && comment?.status === "NON-KILL" && comment?.semanticEqual === true && comment?.provenance.executedSha256 !== baselineSha;
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "controls.json"), JSON.stringify({
  format: "rh-walk-hint-helper-controls/1", required, kills,
  baseline: { diskWalkHint: { path: WALK, bytes: Buffer.byteLength(baseline), sha256: baselineSha }, note: "sourceInfo/profile pins are baseline; rows carry executed onLoad/bundle provenance" },
  canonicalAssertions: "PASS", pristine: { provenance: pristine.provenance, semanticEqualCanonical: pristineEqual },
  restored: { provenance: restored.provenance, semanticEqualCanonical: restoredEqual, provenanceEqualPristine: restoredProvenanceEqual, verifier: restoredVerifier }, rows,
}, null, 2) + "\n");
console.log(JSON.stringify({ mode: "helper-controls", required, kills, restoredEqual, restoredProvenanceEqual, restoredVerifier, ok: good }));
if (!good) throw new Error("helper controls failed");
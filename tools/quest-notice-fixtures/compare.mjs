// Semantic corpus comparator for the quest-notice controls: reports the first mismatch by JSON path, skipping only the
// provenance profile (a mutant necessarily changes the mutated file's source hash, which is not a corpus-output change).
// Arrays are compared element by element before length, so the reported path names the exact recorded field.
import { readFileSync } from "node:fs";

const [baselinePath, mutantPath] = process.argv.slice(2);
if (!baselinePath || !mutantPath) {
  console.error("usage: compare.mjs <baseline.json> <mutant.json>");
  process.exit(2);
}
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const mutant = JSON.parse(readFileSync(mutantPath, "utf8"));
const mismatches = [];

function walk(expected, actual, path) {
  if (path === "/profile") return;
  const te = typeof expected;
  const ta = typeof actual;
  if (te !== ta || expected === null || actual === null || te !== "object") {
    if (expected !== actual) mismatches.push({ path, expected, actual });
    return;
  }
  const ae = Array.isArray(expected);
  const aa = Array.isArray(actual);
  if (ae !== aa) { mismatches.push({ path, expected, actual }); return; }
  if (ae) {
    const n = Math.max(expected.length, actual.length);
    for (let i = 0; i < n; i++) {
      if (i >= expected.length || i >= actual.length) mismatches.push({ path: path + "/" + i, expected: expected[i], actual: actual[i] });
      else walk(expected[i], actual[i], path + "/" + i);
    }
    return;
  }
  const keys = [];
  for (const k of Object.keys(expected)) if (!keys.includes(k)) keys.push(k);
  for (const k of Object.keys(actual)) if (!keys.includes(k)) keys.push(k);
  for (const k of keys) {
    if (!(k in expected) || !(k in actual)) { mismatches.push({ path: path + "/" + k, expected: expected[k], actual: actual[k] }); continue; }
    walk(expected[k], actual[k], path + "/" + k);
  }
}

walk(baseline, mutant, "");
if (mismatches.length === 0) {
  console.log("IDENTICAL");
  process.exit(0);
}
const first = mismatches[0];
console.log("FIRST_MISMATCH " + (first.path === "" ? "/" : first.path) + " expected=" + JSON.stringify(first.expected) + " mutant=" + JSON.stringify(first.actual));
const m = /^\/cases\/([0-9]+)\//.exec(first.path);
const caseName = m && baseline.cases && baseline.cases[Number(m[1])] ? baseline.cases[Number(m[1])].input.name : "";
console.log("MISMATCH_CASE " + caseName);
console.log("TOTAL_MISMATCHES " + mismatches.length);

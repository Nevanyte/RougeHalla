import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Compare method output/input only. Source/tool hashes deliberately cannot kill a semantic mutant.
export function assertSemantics(expected, actual) {
  assert.equal(expected.format, "rh-quest-room-feedback/1");
  assert.equal(actual.format, expected.format);
  assert.deepEqual(actual.input, expected.input, "INPUT_BATCH_MISMATCH");
  assert.deepEqual(actual.receivers, expected.receivers, "ROOM_OUTPUT_SEMANTIC_MISMATCH");
}
function firstDifference(expected, actual, path) {
  if (Object.is(expected, actual)) return null;
  if (expected === null || actual === null || typeof expected !== "object" || typeof actual !== "object")
    return { path, expected, actual };
  for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    const diff = firstDifference(expected[key], actual[key], path + (Array.isArray(expected) ? `[${key}]` : `.${key}`));
    if (diff) return diff;
  }
  return null;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(process.argv.length, 4, "compare requires expected.json actual.json");
  const expected = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const actual = JSON.parse(readFileSync(process.argv[3], "utf8"));
  try {
    assertSemantics(expected, actual);
    console.log(JSON.stringify({ status: "IDENTICAL_SEMANTICS", provenanceCompared: false, provenanceChanged: JSON.stringify(actual.provenance) !== JSON.stringify(expected.provenance) }));
  } catch (error) {
    if (error?.code !== "ERR_ASSERTION" || !String(error.message).includes("ROOM_OUTPUT_SEMANTIC_MISMATCH")) throw error;
    console.error("ROOM_OUTPUT_SEMANTIC_MISMATCH: actual recipient/text/order differs; provenance excluded");
    console.error(JSON.stringify(firstDifference(expected.receivers, actual.receivers, "$.receivers")));
    process.exitCode = 1;
  }
}

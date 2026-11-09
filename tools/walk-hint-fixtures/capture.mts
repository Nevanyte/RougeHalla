// Actual-source walk-hint fixture capture/check. The scenario module owns the real World producer;
// this wrapper writes/checks canonical bytes and runs the focused verifier.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { runProbe, assertFacts } from "/repo/tools/walk-hint-fixtures/scenario.mts";

const OUTPUT = process.env.RH_WALK_HINT_OUTPUT || "/out";
const MODE = process.env.RH_WALK_HINT_MODE || "capture";
function sha(s) { return createHash("sha256").update(s).digest("hex"); }
const { corpus } = runProbe();
assertFacts(corpus);
const text = JSON.stringify(corpus, null, 2) + "\n";
if (MODE === "capture") {
  mkdirSync(OUTPUT, { recursive: true });
  writeFileSync(join(OUTPUT, "source.json"), text);
  console.log(JSON.stringify({ mode: "capture", bytes: Buffer.byteLength(text), sha256: sha(text), frames: corpus.frames.length, hintSequence: corpus.summary.hintSequence, replayEqual: corpus.replay.equal }));
} else if (MODE === "--check") {
  const expected = readFileSync(join(OUTPUT, "source.json"), "utf8");
  if (expected !== text) throw new Error("canonical walk-hint source bytes differ");
  console.log(JSON.stringify({ mode: "check", bytes: Buffer.byteLength(text), sha256: sha(text), frames: corpus.frames.length, replayEqual: corpus.replay.equal }));
} else {
  throw new Error("unknown mode " + MODE);
}

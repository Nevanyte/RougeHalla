// Helper corpus capture: compile the actual-source helper scenario with esbuild, bind its full
// executed bundle hash, call real walkHintOf/weaponHoldsAt/updateWalkHints/installed hooks, and write
// the labelled declared-helper corpus. No installed expected hint or copied formula oracle.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const OUTPUT = process.env.RH_WALK_HINT_OUTPUT || "/out";
const MODE = process.env.RH_WALK_HINT_MODE || "capture";
const BASE = process.env.RH_WALK_HINT_BASE || "2547a1c5766a8046aa725f5f3b3b38d244c38371";
const IMAGE = process.env.RH_WALK_HINT_IMAGE || "";
const ENTRY = "/repo/tools/walk-hint-fixtures/helper-scenario.mts";
function sha(s) { return createHash("sha256").update(s).digest("hex"); }
const built = await build({
  entryPoints: [ENTRY], bundle: true, write: false, platform: "node", format: "esm", absWorkingDir: "/repo", logLevel: "silent",
});
if (built.outputFiles.length !== 1) throw new Error("expected one helper bundle");
const bundleText = built.outputFiles[0].text;
const bundleSha256 = sha(bundleText);
const bundlePath = join("/tmp", "walk-hint-helpers-" + process.pid + "-" + bundleSha256.slice(0, 8) + ".mjs");
writeFileSync(bundlePath, bundleText);
if (sha(readFileSync(bundlePath, "utf8")) !== bundleSha256) throw new Error("helper bundle hash did not bind");
const mod = await import(pathToFileURL(bundlePath).href);
const cases = mod.runHelpers();
const corpus = {
  format: "rh-walk-hint-helpers/1",
  profile: {
    base: BASE, node: process.version, platform: process.platform, arch: process.arch, image: IMAGE,
    entry: ENTRY, bundle: { bytes: Buffer.byteLength(bundleText), sha256: bundleSha256, path: bundlePath },
    source: mod.sourceInfo(),
    relatedPlayerTimingCorpus: (() => { const p = "/repo/parity/policy/bot-fight/source.json"; const s = readFileSync(p); return { path: "parity/policy/bot-fight/source.json", bytes: Buffer.byteLength(s), sha256: sha(s), note: "existing accepted 90 player timing rows; pure-kernel helper rows are separate and do not overwrite it" }; })(),
    contextPolicy: "declared HELPER inputs; actual imported source outputs only; no earned World history or installed expected hint",
    sourceFunctions: "walkHintOf/weaponHoldsAt/updateWalkHints exported; installed teleported/runEnded hooks invoked directly; all other branches through walkHintOf",
  },
  cases,
};
const text = JSON.stringify(corpus, null, 2) + "\n";
if (process.env.RH_HELPER_DEBUG === "1") { mkdirSync(OUTPUT, { recursive: true }); writeFileSync(join(OUTPUT, "debug.json"), text); }
mod.assertHelperFacts(corpus);
if (MODE === "capture") {
  mkdirSync(OUTPUT, { recursive: true });
  writeFileSync(join(OUTPUT, "source.json"), text);
  console.log(JSON.stringify({ mode: "capture", bytes: Buffer.byteLength(text), sha256: sha(text), cases: cases.length, errors: cases.filter((c) => c.error).length, bundleSha256 }));
} else if (MODE === "--check") {
  const expected = readFileSync(join(OUTPUT, "source.json"), "utf8");
  if (expected !== text) throw new Error("canonical helper bytes differ");
  console.log(JSON.stringify({ mode: "check", bytes: Buffer.byteLength(text), sha256: sha(text), cases: cases.length, bundleSha256 }));
} else throw new Error("unknown mode " + MODE);
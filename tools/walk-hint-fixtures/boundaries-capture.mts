// Boundary helper corpus capture: compile the actual-source boundary scenario, bind executed
// provenance, call real walkHintOf/decide/isUntargetableAt, and write declared helper vectors.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
const OUTPUT = process.env.RH_WALK_HINT_OUTPUT || "/out";
const MODE = process.env.RH_WALK_HINT_MODE || "capture";
const BASE = process.env.RH_WALK_HINT_BASE || "70433a9834ccf082b5ca449dca0fd4319cd072ca";
const IMAGE = process.env.RH_WALK_HINT_IMAGE || "";
const ENTRY = "/repo/tools/walk-hint-fixtures/boundaries-scenario.mts";
function sha(s) { return createHash("sha256").update(s).digest("hex"); }
const built = await build({ entryPoints: [ENTRY], bundle: true, write: false, platform: "node", format: "esm", absWorkingDir: "/repo", logLevel: "silent" });
if (built.outputFiles.length !== 1) throw new Error("expected one boundary bundle");
const bundleText = built.outputFiles[0].text, bundleSha256 = sha(bundleText);
const bundlePath = join("/tmp", "walk-hint-boundaries-" + process.pid + "-" + bundleSha256.slice(0, 8) + ".mjs");
writeFileSync(bundlePath, bundleText);
if (sha(readFileSync(bundlePath, "utf8")) !== bundleSha256) throw new Error("boundary bundle hash did not bind");
const mod = await import(pathToFileURL(bundlePath).href);
const cases = mod.runBoundaries();
const helperCorpus = readFileSync("/repo/parity/walk-hint/helpers/source.json");
const playerCorpus = readFileSync("/repo/parity/policy/bot-fight/source.json");
const corpus = {
  format: "rh-walk-hint-helper-boundaries/1",
  profile: {
    base: BASE, node: process.version, platform: process.platform, arch: process.arch, image: IMAGE,
    entry: ENTRY, bundle: { bytes: Buffer.byteLength(bundleText), sha256: bundleSha256, path: bundlePath },
    source: mod.sourceInfo(), sourceFileCount: Object.keys(mod.sourceInfo()).length,
    related: {
      helper69: { path: "parity/walk-hint/helpers/source.json", bytes: helperCorpus.length, sha256: sha(helperCorpus), note: "released 69-row helper corpus remains historical/untouched" },
      player90: { path: "parity/policy/bot-fight/source.json", bytes: playerCorpus.length, sha256: sha(playerCorpus), note: "existing accepted 90-row player timing corpus; README 46672 typo corrected here to 467672" },
    },
    corrections: { priorSourceFileCount: 14, correctedSourceFileCount: 17, priorPlayerCorpusBytesTypo: 46672, correctedPlayerCorpusBytes: 467672 },
    contextPolicy: "declared helper inputs; actual imported source outputs only; no expected hint or recreated algorithm",
  },
  cases,
};
const text = JSON.stringify(corpus, null, 2) + "\n";
if (process.env.RH_BOUNDARY_DEBUG === "1") { mkdirSync(OUTPUT, { recursive: true }); writeFileSync(join(OUTPUT, "debug.json"), text); }
mod.assertBoundaryFacts(corpus);
if (MODE === "capture") { mkdirSync(OUTPUT, { recursive: true }); writeFileSync(join(OUTPUT, "source.json"), text); console.log(JSON.stringify({ mode: "capture", bytes: Buffer.byteLength(text), sha256: sha(text), cases: cases.length, errors: cases.filter((c) => c.error).length, bundleSha256 })); }
else if (MODE === "--check") { const expected = readFileSync(join(OUTPUT, "source.json"), "utf8"); if (expected !== text) throw new Error("canonical boundary bytes differ"); console.log(JSON.stringify({ mode: "check", bytes: Buffer.byteLength(text), sha256: sha(text), cases: cases.length, bundleSha256 })); }
else throw new Error("unknown mode " + MODE);

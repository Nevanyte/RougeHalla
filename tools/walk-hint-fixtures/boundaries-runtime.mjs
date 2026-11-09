// Runtime-only boundary producer. Imports ONLY the frozen relative scenario bundle, validates the
// build manifest/source readset and pinned Node runtime, then captures or byte-checks. No esbuild,
// tsx, npm, child process, compiler, network, image pull or home/config reads.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
function sha(s) { return createHash("sha256").update(s).digest("hex"); }
function arg(name) {
  const pref = name + "=";
  const eq = process.argv.find((x) => x.startsWith(pref));
  if (eq) return eq.slice(pref.length);
  const i = process.argv.indexOf(name);
  if (i < 0 || i === process.argv.length - 1) throw new Error("missing " + name);
  return process.argv[i + 1];
}
const MODE = arg("--mode");
if (MODE !== "capture" && MODE !== "check") throw new Error("unknown mode " + MODE);
const OUT = arg("--output");
if (process.version !== "v22.23.4" || process.platform !== "linux" || process.arch !== "x64") throw new Error("runtime not pinned Node v22.23.4 linux/x64: " + process.version + " " + process.platform + "/" + process.arch);
const manifestText = readFileSync(join(HERE, "build-manifest.json"), "utf8");
const manifest = JSON.parse(manifestText);
if (manifest.format !== "rh-walk-hint-boundary-build/1") throw new Error("wrong build manifest format");
const scenarioPath = join(HERE, "scenario.mjs");
const scenarioBytes = readFileSync(scenarioPath);
if (sha(scenarioBytes) !== manifest.outputs.scenario.sha256) throw new Error("scenario bundle hash mismatch");
const runtimeBytes = readFileSync(fileURLToPath(import.meta.url));
if (sha(runtimeBytes) !== manifest.outputs.runtime.sha256) throw new Error("runtime source hash mismatch");
for (const [rel, pin] of Object.entries(manifest.selectedSource)) {
  const b = readFileSync("/repo/" + rel);
  if (sha(b) !== pin) throw new Error("selected source pin mismatch " + rel);
}
for (const [name, pin] of Object.entries(manifest.related)) {
  const b = readFileSync("/repo/" + pin.path);
  if (sha(b) !== pin.sha256) throw new Error("related corpus mismatch " + name);
}
const { runBoundaries, assertBoundaryFacts, sourceInfo } = await import(new URL("./scenario.mjs", import.meta.url).href);
const cases = runBoundaries();
const corpus = {
  format: "rh-walk-hint-helper-boundaries/1",
  profile: {
    base: manifest.base, node: process.version, platform: process.platform, arch: process.arch,
    image: "node@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292",
    bundle: { bytes: manifest.outputs.scenario.bytes, sha256: manifest.outputs.scenario.sha256 },
    source: sourceInfo(), selectedSource: manifest.selectedSource,
    sourceFileCount: Object.keys(manifest.selectedSource).length,
    loadedInputCount: manifest.loadedInputCount, loadedInputs: manifest.loadedInputs,
    related: manifest.related, corrections: manifest.corrections,
    contextPolicy: manifest.contextPolicy,
  },
  cases,
};
const text = JSON.stringify(corpus, null, 2) + "\n";
assertBoundaryFacts(corpus);
if (MODE === "capture") {
  if (existsSync(join(OUT, "source.json"))) throw new Error("refusing to overwrite existing source.json");
  writeFileSync(join(OUT, "source.json"), text);
  console.log(JSON.stringify({ mode: "capture", bytes: Buffer.byteLength(text), sha256: sha(text), cases: cases.length, bundleSha256: manifest.outputs.scenario.sha256 }));
} else {
  const expected = readFileSync(join(OUT, "source.json"), "utf8");
  if (expected !== text) throw new Error("canonical boundary bytes differ");
  console.log(JSON.stringify({ mode: "check", bytes: Buffer.byteLength(text), sha256: sha(text), cases: cases.length, bundleSha256: manifest.outputs.scenario.sha256 }));
}

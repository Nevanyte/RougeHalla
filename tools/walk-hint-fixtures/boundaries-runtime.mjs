// LINUX RUNTIME ONLY. No compiler/tsx/npm/spawn, source rewrites or fallback dependencies.
// Root approves explicit expected manifest+bundle hashes AFTER the separate host build.
import { createHash } from "node:crypto";
import { constants, closeSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGE = "node@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292";
const MAX_CORPUS = 2 * 1024 * 1024;
const sha = b => createHash("sha256").update(b).digest("hex");
const fail = text => { throw new Error(text); };
function args() {
  const out = new Map(), allowed = new Set(["--mode", "--output", "--expected-manifest", "--expected-bundle"]);
  for (let i = 2; i < process.argv.length; i++) {
    const eq = process.argv[i].indexOf("="), key = eq >= 0 ? process.argv[i].slice(0, eq) : process.argv[i];
    const value = eq >= 0 ? process.argv[i].slice(eq + 1) : process.argv[++i];
    if (!allowed.has(key) || out.has(key) || !value) fail("unknown/duplicate/missing argument " + key);
    out.set(key, value);
  }
  for (const key of allowed) if (!out.has(key)) fail("missing " + key);
  return out;
}
function regular(path) {
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() || realpathSync(path) !== path) fail("nonregular/noncanonical runtime file " + path);
  return readFileSync(path);
}
const a = args(), mode = a.get("--mode");
if (!['capture', 'check'].includes(mode) || a.get("--output") !== "/out" || HERE !== "/run") fail("runtime requires exact /run + /out and capture/check mode");
for (const name of ["--expected-manifest", "--expected-bundle"]) if (!/^[0-9a-f]{64}$/.test(a.get(name))) fail("expected hash must be a Root-approved SHA256");
if (process.version !== "v22.23.4" || process.platform !== "linux" || process.arch !== "x64") fail("actual runtime is not Node22.23.4/linux/x64");
const manifestBytes = regular(join(HERE, "build-manifest.json"));
if (sha(manifestBytes) !== a.get("--expected-manifest")) fail("Root-approved manifest mismatch");
const m = JSON.parse(manifestBytes);
if (m.format !== "rh-walk-hint-boundary-build/2" || m.image !== IMAGE || !/^[0-9a-f]{40}$/.test(m.code)) fail("unexpected frozen build metadata");
if (m.outputs.scenario.sha256 !== a.get("--expected-bundle") || m.limits.maxContexts !== 24 || m.limits.maxCorpusBytes !== MAX_CORPUS) fail("unexpected bundle pin/bounds");
for (const output of Object.values(m.outputs)) {
  if (!/^[A-Za-z0-9_.-]+$/.test(output.path)) fail("unsafe prepared output path");
  const b = regular(join(HERE, output.path));
  if (b.length !== output.bytes || sha(b) !== output.sha256) fail("prepared output mismatch " + output.path);
}
function sourcePin(rel, pin) {
  if (!rel || rel.startsWith("/") || rel.includes("\\") || rel.split("/").some(x => !x || x === "." || x === "..")) fail("unsafe readset path");
  const b = regular("/repo/" + rel);
  if (b.length !== pin.bytes || sha(b) !== pin.sha256) fail("frozen source/data pin mismatch " + rel);
}
for (const [rel, pin] of Object.entries(m.selectedSource)) sourcePin(rel, pin);
for (const x of Object.values(m.related)) sourcePin(x.path, x);
if (!lstatSync("/out").isDirectory() || lstatSync("/out").isSymbolicLink() || realpathSync("/out") !== "/out") fail("unsafe output mount");
if (mode === "capture" && readdirSync("/out").length !== 0) fail("capture requires a fresh empty output before any scenario import");
if (mode === "check") regular("/out/source.json");
const mod = await import(new URL("./scenario.mjs", import.meta.url).href);
const cases = mod.runBoundaries();
if (!Array.isArray(cases) || cases.length > 24) fail("unbounded source case inventory");
const observedPins = mod.sourceInfo();
if (Object.keys(observedPins).length !== Object.keys(m.selectedSource).length) fail("selected source inventory differs");
for (const [rel, pin] of Object.entries(m.selectedSource))
  if (observedPins[rel]?.bytes !== pin.bytes || observedPins[rel]?.sha256 !== pin.sha256) fail("actual sourceInfo differs " + rel);
const corpus = { format: "rh-walk-hint-helper-boundaries/1", profile: { base: m.base, code: m.code,
  node: process.version, platform: process.platform, arch: process.arch, image: IMAGE,
  bundle: m.outputs.scenario, source: observedPins, configuration: m.configuration,
  sourceFileCount: Object.keys(observedPins).length, loadedInputCount: m.loadedInputs.length, loadedInputs: m.loadedInputs,
  related: m.related, contextPolicy: m.contextPolicy,
  scope: "24 declared actual-source method contexts. Actual direction path boundary may remain OPEN; not earned World/native/Full proof." }, cases };
const text = JSON.stringify(corpus, null, 2) + "\n";
if (Buffer.byteLength(text) > MAX_CORPUS) fail("actual observation output exceeds approved finite bound");
function writeNew(name, value) {
  const fd = openSync(join("/out", name), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, value); } finally { closeSync(fd); }
}
// Preserve source surprises/setup errors as noncanonical observations before throwing.
// Readonly check writes NOTHING; canonical publication still requires verification.
if (mode === "capture") writeNew("observations-before-verification.json", text);
const coverage = mod.assertBoundaryFacts(corpus);
if (mode === "capture") {
  writeNew("source.json", text); writeNew("verification.json", JSON.stringify(coverage, null, 2) + "\n");
} else if (regular("/out/source.json").toString("utf8") !== text) fail("canonical boundary bytes differ");
console.log(JSON.stringify({ mode, bytes: Buffer.byteLength(text), sha256: sha(text), bundleSha256: m.outputs.scenario.sha256, ...coverage }));

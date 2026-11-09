// Runtime ONLY: actual8151 no-symlink/pin/output guards, adapted to capture/tag codec.
// No compiler, child process, npm, package resolution, networking or host World.
import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = "bb564d3b53728cbd205af375b5342eca466f3656";
const IMAGE = "node@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292";
const SOURCE_ROOT = "/Users/nevinmckinnon/Documents/Projects/RogueHalla-bot-own-timings";
const MAX_CORPUS = 128 * 1024 * 1024, MAX_BUNDLE = 16 * 1024 * 1024, MAX_VERIFY = 1024 * 1024;
const PREPARED = ["build-manifest.json", "metafile.json", "runtime.mjs", "scenario.mjs", "verify.mjs"];
const SUCCESS_OUTPUT = ["observations-before-verification.json", "source.json", "verification.json"];
const EXTERNALS = ["node:assert/strict", "node:crypto", "node:fs"];
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = message => { throw new Error(message); };
const hash = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const code = value => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
function keys(value, expected, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) fail("invalid " + name + " keys");
}
function args() {
  const allowed = new Set(["--mode", "--output", "--expected-code-sha", "--expected-manifest-sha256", "--expected-bundle-sha256", "--expected-runtime-sha256", "--expected-verify-sha256"]), out = new Map();
  for (let i = 2; i < process.argv.length; i++) {
    const token = process.argv[i], eq = token.indexOf("=");
    const key = eq < 0 ? token : token.slice(0, eq), value = eq < 0 ? process.argv[++i] : token.slice(eq + 1);
    if (!allowed.has(key) || out.has(key) || !value || value.startsWith("--")) fail("unknown/duplicate/missing argument " + key);
    out.set(key, value);
  }
  if (out.size !== allowed.size) fail("missing literal runtime arguments");
  return out;
}
function noLinks(path, file = false) {
  if (path !== resolve(path)) fail("noncanonical literal path " + path);
  let at = sep;
  for (const part of path.split(sep).filter(Boolean)) {
    at = join(at, part); const st = lstatSync(at);
    if (st.isSymbolicLink() || (at !== path && !st.isDirectory())) fail("symlink/non-directory ancestor " + at);
  }
  const st = lstatSync(path);
  if (realpathSync(path) !== path || (file ? !st.isFile() : !st.isDirectory())) fail("wrong runtime path kind " + path);
  return st;
}
function regular(path, limit = MAX_BUNDLE) {
  const before = noLinks(path, true);
  if (before.size > limit) fail("file exceeds bounded runtime read " + path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const held = fstatSync(fd);
    if (!held.isFile() || held.dev !== before.dev || held.ino !== before.ino) fail("changed file before read " + path);
    const bytes = readFileSync(fd), after = fstatSync(fd), named = noLinks(path, true);
    if (held.dev !== after.dev || held.ino !== after.ino || held.size !== after.size || held.mtimeMs !== after.mtimeMs || named.dev !== held.dev || named.ino !== held.ino || named.size !== held.size || named.mtimeMs !== held.mtimeMs) fail("changed runtime file " + path);
    return bytes;
  } finally { closeSync(fd); }
}
function relativePath(path) {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\") || path.split("/").some(x => !x || x === "." || x === "..")) fail("unsafe frozen relative path");
  return path;
}
function pin(path, expected, limit = MAX_CORPUS) {
  keys(expected, ["bytes", "sha256"], "source pin");
  if (!Number.isSafeInteger(expected.bytes) || expected.bytes < 0 || expected.bytes > limit || !hash(expected.sha256)) fail("invalid frozen file pin");
  const bytes = regular(path);
  if (bytes.length !== expected.bytes || sha(bytes) !== expected.sha256) fail("frozen pin mismatch " + path);
  return bytes;
}
// All envelope/output guards precede verifier/scenario evaluation.
const a = args(), mode = a.get("--mode");
if (!["capture", "check-consistency"].includes(mode) || a.get("--output") !== "/out" || HERE !== "/run" || fileURLToPath(import.meta.url) !== "/run/runtime.mjs") fail("requires exact /run/runtime.mjs,/out and capture/check-consistency");
if (!code(a.get("--expected-code-sha"))) fail("expected code must be Root-supplied full40hex");
for (const key of ["--expected-manifest-sha256", "--expected-bundle-sha256", "--expected-runtime-sha256", "--expected-verify-sha256"]) if (!hash(a.get(key))) fail("expected hash must be Root-supplied SHA256 " + key);
if (process.version !== "v22.23.4" || process.platform !== "linux" || process.arch !== "x64" || process.execArgv.length !== 0 || process.env.NODE_OPTIONS || process.env.NODE_PATH || process.env.NODE_COMPILE_CACHE) fail("requires exact clean Node22.23.4/linux/x64 runtime");
noLinks(HERE);
if (JSON.stringify(readdirSync(HERE).sort()) !== JSON.stringify(PREPARED)) fail("prepared directory must contain exactly five approved files");
const manifestBytes = regular(join(HERE, "build-manifest.json"));
if (sha(manifestBytes) !== a.get("--expected-manifest-sha256")) fail("independent Root manifest pin mismatch");
const m = JSON.parse(manifestBytes.toString("utf8"));
if (m.format !== "rh-p15-protection-cues-build/2" || m.sourceBase !== BASE || m.code !== a.get("--expected-code-sha") || m.image !== IMAGE) fail("wrong frozen driver/base/runtime identity");
keys(m.limits, ["maxCases", "maxStepsPerCase", "totalMaxSteps", "maxCorpusBytes", "maxBundleBytes", "maxVerificationBytes"], "limits");
if (m.limits.maxCases !== 11 || m.limits.maxStepsPerCase !== 96 || m.limits.totalMaxSteps !== 1056 || m.limits.maxCorpusBytes !== MAX_CORPUS || m.limits.maxBundleBytes !== MAX_BUNDLE || m.limits.maxVerificationBytes !== MAX_VERIFY) fail("different finite capture envelope");
if (JSON.stringify(m.externals) !== JSON.stringify(EXTERNALS) || JSON.stringify(m.preparedInventory) !== JSON.stringify(PREPARED)) fail("different external/artifact envelope");
keys(m.outputs, ["scenario", "runtime", "verify", "metafile"], "outputs");
for (const [kind, name] of [["scenario", "scenario.mjs"], ["runtime", "runtime.mjs"], ["verify", "verify.mjs"], ["metafile", "metafile.json"]]) {
  const output = m.outputs[kind]; keys(output, ["path", "bytes", "sha256"], "prepared pin");
  if (output.path !== name) fail("substituted prepared output name");
  pin(join(HERE, name), { bytes: output.bytes, sha256: output.sha256 }, MAX_BUNDLE);
}
if (m.outputs.scenario.sha256 !== a.get("--expected-bundle-sha256") || m.outputs.runtime.sha256 !== a.get("--expected-runtime-sha256") || m.outputs.verify.sha256 !== a.get("--expected-verify-sha256")) fail("independent Root executable pins differ");
if (!Array.isArray(m.loadedInputs) || !m.loadedInputs.length) fail("missing frozen loaded closure");
const loaded = new Map();
for (const row of m.loadedInputs) {
  keys(row, ["path", "bytes", "sha256", "executedBytes", "executedSha256", "instrumentation"], "loaded input");
  if (loaded.has(row.path) || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || !hash(row.sha256) || row.executedBytes !== row.bytes || row.executedSha256 !== row.sha256 || row.instrumentation !== null) fail("changed/duplicate/instrumented source input");
  if (row.path !== "npm:@colyseus/schema/build/index.mjs") {
    relativePath(row.path);
    if (!["packages/server/src/", "packages/shared/src/", "tools/bot-protection-cues-fixtures/"].some(prefix => row.path.startsWith(prefix))) fail("loaded input outside bounded closure");
  }
  loaded.set(row.path, row);
}
const metafile = JSON.parse(regular(join(HERE, "metafile.json")).toString("utf8")), normalized = new Map();
for (const [path, value] of Object.entries(metafile.inputs)) {
  const rel = path === "pinned-schema:@colyseus/schema/build/index.mjs" ? "npm:@colyseus/schema/build/index.mjs" : path.startsWith(SOURCE_ROOT + "/") ? path.slice(SOURCE_ROOT.length + 1) : relativePath(path);
  if (normalized.has(rel)) fail("duplicate normalized metafile input");
  normalized.set(rel, value.bytes);
}
if (normalized.size !== loaded.size || [...loaded].some(([path, row]) => normalized.get(path) !== row.executedBytes)) fail("exact loaded closure/metafile disagreement");
for (const output of Object.values(metafile.outputs)) for (const item of output.imports) if (item.external && !EXTERNALS.includes(item.path)) fail("unapproved emitted external");
if (!m.selectedSource || !Object.keys(m.selectedSource).length) fail("missing selected runtime source pins");
for (const [rel, expected] of Object.entries(m.selectedSource)) {
  relativePath(rel);
  if (!["packages/server/src/", "packages/shared/src/"].some(prefix => rel.startsWith(prefix))) fail("selected source outside application prefix");
  pin("/repo/" + rel, expected);
}
keys(m.related, ["bornMap"], "related input");
if (m.related.bornMap.path !== "tools/ability-fixtures/born-input.json") fail("different source map");
pin("/repo/" + m.related.bornMap.path, { bytes: m.related.bornMap.bytes, sha256: m.related.bornMap.sha256 });
if (m.related.bornMap.bytes !== 7510 || m.related.bornMap.sha256 !== "5ee388ca61234bae0e7dc04adca00702fbc6199f048487490fcbca25b2cffb16") fail("different born map identity");
keys(m.readset, ["selectedSource", "related", "prep"], "readset");
const mounts = [...m.readset.selectedSource, ...m.readset.related], expectedMounts = [...Object.keys(m.selectedSource), m.related.bornMap.path];
if (mounts.length !== expectedMounts.length || JSON.stringify(m.readset.prep) !== JSON.stringify(PREPARED)) fail("different mount inventory");
for (let i = 0; i < mounts.length; i++) {
  keys(mounts[i], ["host", "container"], "readonly mount");
  if (mounts[i].host !== SOURCE_ROOT + "/" + expectedMounts[i] || mounts[i].container !== "/repo/" + expectedMounts[i]) fail("unbounded/substituted runtime mount");
}
const outputDir = noLinks("/out");
keys(m.outputOwnership, ["hostUid", "hostGid", "directoryMode"], "output ownership");
if ((outputDir.mode & 0o777) !== 0o700 || outputDir.uid !== m.outputOwnership.hostUid || outputDir.gid !== m.outputOwnership.hostGid || m.outputOwnership.directoryMode !== 0o700) fail("output is not the approved owned0700 mount");
const prior = readdirSync("/out").sort();
if (mode === "capture" ? prior.length !== 0 : JSON.stringify(prior) !== JSON.stringify(SUCCESS_OUTPUT)) fail("capture requires fresh empty output; check requires exact prior successful files");
if (mode === "check-consistency") for (const name of SUCCESS_OUTPUT) {
  const st = noLinks(join("/out", name), true);
  if (st.size > (name === "verification.json" ? MAX_VERIFY : MAX_CORPUS)) fail("oversized prior output before verifier import");
}
function writeNew(name, text) {
  if (![...SUCCESS_OUTPUT, "runtime-failure.json"].includes(name)) fail("unapproved captured output name");
  noLinks("/out");
  const fd = openSync(join("/out", name), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.size !== 0 || (st.mode & 0o777) !== 0o600) fail("nonregular/nonexclusive0600 output");
    writeFileSync(fd, text);
  } finally { closeSync(fd); }
}
const serialize = value => JSON.stringify(value, null, 2) + "\n";
function bounded(text, limit, name) {
  const bytes = Buffer.byteLength(text);
  if (bytes > limit) {
    const error = new Error(name + " exceeds approved artifact bound: " + bytes + " > " + limit);
    error.bound = { name, bytes, sha256: sha(text), limit };
    throw error;
  }
  return text;
}
function validateProfile(raw) {
  if (raw?.profile?.driverCode !== m.code || raw.profile.sourceBase !== BASE || !Array.isArray(raw.cases) || raw.cases.length > 11) fail("capture provenance/case envelope differs");
  const frozen = raw.profile.frozenBuild;
  if (frozen?.code !== m.code || frozen.sourceBase !== BASE || frozen.manifestSha256 !== sha(manifestBytes) || frozen.bundle?.sha256 !== m.outputs.scenario.sha256 || frozen.mapInput?.sha256 !== m.related.bornMap.sha256) fail("raw frozen-build provenance differs from independently approved envelope");
}
function recheckEnvelope() {
  if (sha(regular("/run/build-manifest.json")) !== a.get("--expected-manifest-sha256")) fail("manifest changed during runtime");
  for (const output of Object.values(m.outputs)) pin(join(HERE, output.path), { bytes: output.bytes, sha256: output.sha256 }, MAX_BUNDLE);
  for (const [rel, expected] of Object.entries(m.selectedSource)) pin("/repo/" + rel, expected);
  pin("/repo/" + m.related.bornMap.path, { bytes: m.related.bornMap.bytes, sha256: m.related.bornMap.sha256 });
}
let stage = "import-verifier", rawWritten = false;
try {
  const verifier = await import(new URL("./verify.mjs", import.meta.url).href);
  if (typeof verifier.verify !== "function" || typeof verifier.encodeRaw !== "function" || typeof verifier.decodeRaw !== "function") fail("frozen verifier API differs");
  if (mode === "check-consistency") {
    stage = "check-consistency";
    const rawText = bounded(regular("/out/observations-before-verification.json", MAX_CORPUS).toString("utf8"), MAX_CORPUS, "existing raw"), raw = JSON.parse(rawText);
    validateProfile(raw);
    const result = verifier.verify(raw); keys(result, ["canonical", "verification"], "verifier result");
    if (serialize(result.canonical) !== regular("/out/source.json", MAX_CORPUS).toString("utf8") || serialize(result.verification) !== regular("/out/verification.json", MAX_VERIFY).toString("utf8")) fail("existing raw/canonical/verification consistency differs");
    recheckEnvelope();
    console.log(serialize({ mode, sourceExecuted: false, independentFrozenReproduction: false, code: m.code, cases: raw.cases.length, rawBytes: Buffer.byteLength(rawText), rawSha256: sha(rawText) }).trim());
  } else {
    stage = "import-scenario";
    const scenario = await import(new URL("./scenario.mjs", import.meta.url).href);
    if (typeof scenario.capture !== "function") fail("frozen capture API differs");
    stage = "capture";
    const nativeRaw = scenario.capture({ codeSha: m.code, sourceBase: m.sourceBase });
    if (nativeRaw?.profile && typeof nativeRaw.profile === "object") {
      nativeRaw.profile.frozenBuild = { code: m.code, sourceBase: m.sourceBase, image: m.image, manifestSha256: sha(manifestBytes), bundle: m.outputs.scenario, loadedInputs: m.loadedInputs, configuration: m.configuration, selectedSource: m.selectedSource, mapInput: m.related.bornMap };
    }
    stage = "encode-raw";
    const raw = verifier.encodeRaw(nativeRaw), rawText = bounded(serialize(raw), MAX_CORPUS, "raw observation");
    writeNew("observations-before-verification.json", rawText); rawWritten = true;
    stage = "post-capture-envelope"; recheckEnvelope();
    stage = "verify"; validateProfile(raw);
    const result = verifier.verify(raw); keys(result, ["canonical", "verification"], "verifier result");
    const canonicalText = bounded(serialize(result.canonical), MAX_CORPUS, "canonical source"), verificationText = bounded(serialize(result.verification), MAX_VERIFY, "verification");
    stage = "publish-canonical";
    writeNew("source.json", canonicalText); writeNew("verification.json", verificationText);
    if (JSON.stringify(readdirSync("/out").sort()) !== JSON.stringify(SUCCESS_OUTPUT)) fail("unexpected success output inventory");
    console.log(serialize({ mode, sourceExecuted: true, independentFrozenReproduction: false, code: m.code, cases: raw.cases.length, rawBytes: Buffer.byteLength(rawText), rawSha256: sha(rawText), sourceBytes: Buffer.byteLength(canonicalText), sourceSha256: sha(canonicalText), verificationSha256: sha(verificationText) }).trim());
  }
} catch (error) {
  // Actual caught case failures return partial raw and are written before verification.
  // Import/encoding failures cannot honestly reconstruct unavailable partial World rows.
  if (mode === "capture") {
    const failure = { format: "rh-p15-protection-cues-runtime-failure/1", code: m.code, sourceBase: BASE, stage, rawObservationPreserved: rawWritten, sourceRowsReconstructed: false, error: { name: String(error?.name ?? "Error"), message: String(error?.message ?? error), stack: String(error?.stack ?? ""), bound: error?.bound ?? null } };
    if (!rawWritten) writeNew("observations-before-verification.json", serialize(failure));
    writeNew("runtime-failure.json", serialize(failure));
  }
  throw error;
}
// check-consistency writes NOTHING and never imports scenario. SIGKILL/process loss
// before capture returns cannot promise partial rows; no such claim is made.

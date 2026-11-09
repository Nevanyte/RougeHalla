// ONE-VARIANT runtime ONLY. Validate the exact single transform before any verifier/scenario import.
// No compiler, child process, npm, package resolution, networking or host World.
import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = "bb564d3b53728cbd205af375b5342eca466f3656";
const PRISTINE_CODE = "4fe7aa8285ad65f2c9a1123297426cd48b03bdef";
const PRISTINE_MANIFEST_SHA = "53a54a282bd09da615088bf352ddbd0ef65514bdc72e806f69b1ba74c9c47e16";
const CONTROLS_SHA = "a27967aef45638c64d2873063d66669f5724abf869d51e328c511a15b4ef837c";
const PRISTINE_FILES = {
  "observations-before-verification.json": { bytes: 45077539, sha256: "6449038bfbe6dc75d9afe1ce66f9172dd44cb23fb3048871a03e8ca16f6aac53" },
  "source.json": { bytes: 45079140, sha256: "0a8af4c8dee518e5e6bc6b31c3445dc2e5ab61e889810a830642381d9cf92e6e" },
  "verification.json": { bytes: 1558, sha256: "e5ded300c248096a6319bec9252efef53e28212d47862a1387a9e67056c35987" },
};
const CONTROL_SPECS = [
  {
    "id": "teleport-immunity",
    "kind": "semantic",
    "file": "packages/server/src/sim/arena.ts",
    "expectedMatches": 1,
    "find": "p.immuneUntil = now + TELEPORT_IMMUNITY_MS;",
    "replace": "p.immuneUntil = 0;",
    "firstFailureCase": "P0"
  },
  {
    "id": "remote-lower-guard",
    "kind": "semantic",
    "file": "packages/server/src/bots/brain/perception.ts",
    "expectedMatches": 1,
    "find": "immune: until > 0 && left > 0 && left <= TELEPORT_IMMUNITY_MS,",
    "replace": "immune: until > 0 && left >= 0 && left <= TELEPORT_IMMUNITY_MS,",
    "firstFailureCase": "P0"
  },
  {
    "id": "remote-upper-guard",
    "kind": "semantic",
    "file": "packages/server/src/bots/brain/perception.ts",
    "expectedMatches": 1,
    "find": "immune: until > 0 && left > 0 && left <= TELEPORT_IMMUNITY_MS,",
    "replace": "immune: until > 0 && left > 0,",
    "firstFailureCase": "P0"
  },
  {
    "id": "preserve-ranged-cancel",
    "kind": "semantic",
    "file": "packages/server/src/sim/step.ts",
    "expectedMatches": 1,
    "find": "cancelLockedWindup(world, c, true);",
    "replace": "cancelLockedWindup(world, c, false);",
    "firstFailureCase": "W1"
  },
  {
    "id": "different-target-cancel",
    "kind": "semantic",
    "file": "packages/server/src/sim/targeting.ts",
    "expectedMatches": 1,
    "find": "if (w.action?.target !== t.id) cancelLockedWindup(world, c);",
    "replace": "if (w.action?.target !== t.id) { /* control: cancellation removed */ }",
    "firstFailureCase": "W0"
  },
  {
    "id": "bow-stagger-exclusion",
    "kind": "semantic",
    "file": "packages/server/src/sim/weapons.ts",
    "expectedMatches": 1,
    "find": "if (w.action && w.action.kind !== \"draw\") {",
    "replace": "if (w.action) {",
    "firstFailureCase": "B2"
  },
  {
    "id": "comment-provenance",
    "kind": "comment-nonkill",
    "file": "packages/server/src/sim/arena.ts",
    "expectedMatches": 1,
    "find": "export function teleportToColiseum(world: World): void {",
    "replace": "export function teleportToColiseum(world: World): void { // control: comment-only nonkill",
    "firstFailureCase": null
  }
];
const PRISTINE_TOOL_SHA = {
 "build.mjs": "3d10dbcaa2315a09f24cc583315f9b6572dfe0950edb78563cc41ef2fe8ffe17",
 "runtime.mjs": "730bc3f6276ff9ca497876f7810bf31d7d6985c0046560eb518583765be5d303",
 "controls.mjs": CONTROLS_SHA,
 "scenario.mts": "d054bcfec6ccf513c5e238b2c9c7eb4f4313bf06707236ef3da2da6d07243c39",
 "verify.mjs": "10188528d712c8000000db548caa2388c74c56c03d5bb7f9af4a6b996853e935",
};


const IMAGE = "node@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292";
const SOURCE_ROOT = "/Users/nevinmckinnon/Documents/Projects/RogueHalla-bot-own-timings";
const MAX_CORPUS = 128 * 1024 * 1024, MAX_BUNDLE = 16 * 1024 * 1024, MAX_VERIFY = 1024 * 1024;
const PREPARED = ["build-manifest.json", "metafile.json", "scenario.mjs", "variants-runtime.mjs", "verify.mjs"];
const KILL_OUTPUT = ["classification.json", "observations-before-verification.json"];
const NONKILL_OUTPUT = ["classification.json", "observations-before-verification.json", "source.json", "verification.json"];
const EXTERNALS = ["node:assert/strict", "node:crypto", "node:fs"];
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = message => { throw new Error(message); };
const hash = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const code = value => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
function keys(value, expected, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) fail("invalid " + name + " keys");
}
function args() {
  const allowed = new Set(["--mode", "--output", "--expected-code-sha", "--expected-manifest-sha256", "--expected-bundle-sha256", "--expected-runtime-sha256", "--expected-verify-sha256", "--expected-control-id", "--expected-pristine-manifest-sha256", "--expected-pristine-raw-sha256", "--expected-pristine-source-sha256", "--expected-pristine-verification-sha256"]), out = new Map();
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
  const bytes = regular(path, limit);
  if (bytes.length !== expected.bytes || sha(bytes) !== expected.sha256) fail("frozen pin mismatch " + path);
  return bytes;
}
// Manifest assertions are not a blanket instrumentation permit. The independently pinned pristine manifest
// supplies the original133 bodies; the only executed change is recomputed below from a mounted original.
const a = args(), mode = a.get("--mode"), control = CONTROL_SPECS.find(x => x.id === a.get("--expected-control-id"));
if (!control || !["capture", "check-consistency"].includes(mode) || a.get("--output") !== "/out" || HERE !== "/run" || fileURLToPath(import.meta.url) !== "/run/variants-runtime.mjs") fail("exact ONE control/mode/path required");
if (!code(a.get("--expected-code-sha"))) fail("Root-supplied full driver code required");
for (const key of ["--expected-manifest-sha256", "--expected-bundle-sha256", "--expected-runtime-sha256", "--expected-verify-sha256"]) if (!hash(a.get(key))) fail("Root-supplied hash required " + key);
if (a.get("--expected-pristine-manifest-sha256") !== PRISTINE_MANIFEST_SHA ||
    a.get("--expected-pristine-raw-sha256") !== PRISTINE_FILES["observations-before-verification.json"].sha256 ||
    a.get("--expected-pristine-source-sha256") !== PRISTINE_FILES["source.json"].sha256 ||
    a.get("--expected-pristine-verification-sha256") !== PRISTINE_FILES["verification.json"].sha256) fail("wrong independently approved pristine proof");
if (process.version !== "v22.23.4" || process.platform !== "linux" || process.arch !== "x64" || process.execArgv.length || process.env.NODE_OPTIONS || process.env.NODE_PATH || process.env.NODE_COMPILE_CACHE) fail("clean pinned Node22.23.4/linux/x64 required");
noLinks(HERE); noLinks("/pristine");
if (JSON.stringify(readdirSync("/pristine").sort()) !== JSON.stringify(["build-manifest.json", "observations-before-verification.json", "source.json", "verification.json"])) fail("exact four individually mounted pristine proof files required");
if (JSON.stringify(readdirSync(HERE).sort()) !== JSON.stringify(PREPARED)) fail("exact five variant prepared files required");
const manifestBytes = regular("/run/build-manifest.json"), pristineManifestBytes = regular("/pristine/build-manifest.json");
if (sha(manifestBytes) !== a.get("--expected-manifest-sha256") || sha(pristineManifestBytes) !== PRISTINE_MANIFEST_SHA) fail("independent variant/pristine manifest hash mismatch");
const m = JSON.parse(manifestBytes.toString("utf8")), pristine = JSON.parse(pristineManifestBytes.toString("utf8"));
const equal = (x, y, why) => { if (JSON.stringify(x) !== JSON.stringify(y)) fail(why); };
if (m.format !== "rh-p15-protection-cues-variant-build/1" || m.code !== a.get("--expected-code-sha") || m.sourceBase !== BASE || m.image !== IMAGE || pristine.code !== PRISTINE_CODE || pristine.sourceBase !== BASE || pristine.image !== IMAGE) fail("variant/pristine identity differs");
equal(m.pristine, { code: PRISTINE_CODE, manifestSha256: PRISTINE_MANIFEST_SHA, files: PRISTINE_FILES, tools: PRISTINE_TOOL_SHA }, "pristine provenance differs");
equal(m.configuration, pristine.configuration, "compiler configuration changed");
equal(m.selectedSource, pristine.selectedSource, "mounted original source inventory changed");
equal(m.related, pristine.related, "map/related input changed");
equal(m.externals, EXTERNALS, "different external envelope"); equal(m.preparedInventory, PREPARED, "different prepared inventory");
equal(m.limits, { maxCases: 11, maxStepsPerCase: 96, totalMaxSteps: 1056, maxCorpusBytes: MAX_CORPUS, maxBundleBytes: MAX_BUNDLE, maxVerificationBytes: MAX_VERIFY }, "different finite limits");
keys(m.outputs, ["scenario", "runtime", "verify", "metafile"], "outputs");
for (const [kind, name] of [["scenario", "scenario.mjs"], ["runtime", "variants-runtime.mjs"], ["verify", "verify.mjs"], ["metafile", "metafile.json"]]) {
  const output = m.outputs[kind]; keys(output, ["path", "bytes", "sha256"], "prepared pin");
  if (output.path !== name) fail("substituted executable path"); pin(join(HERE, name), { bytes: output.bytes, sha256: output.sha256 }, MAX_BUNDLE);
}
if (m.outputs.scenario.sha256 !== a.get("--expected-bundle-sha256") || m.outputs.runtime.sha256 !== a.get("--expected-runtime-sha256") || m.outputs.verify.sha256 !== a.get("--expected-verify-sha256") || m.outputs.verify.sha256 !== PRISTINE_TOOL_SHA["verify.mjs"]) fail("independent executable/verifier hash differs");
const originalBodies = new Map(pristine.loadedInputs.map(x => [x.path, x]));
if (originalBodies.size !== 133 || !Array.isArray(m.loadedInputs) || m.loadedInputs.length !== 133) fail("exact original133 closure required");
const loads = new Map();
for (const row of m.loadedInputs) {
  keys(row, ["path", "bytes", "sha256", "executedBytes", "executedSha256", "instrumentation"], "loaded row");
  const old = originalBodies.get(row.path);
  if (!old || loads.has(row.path) || old.bytes !== row.bytes || old.sha256 !== row.sha256 || !Number.isSafeInteger(row.executedBytes) || row.executedBytes < 0 || !hash(row.executedSha256)) fail("changed/extra original closure body");
  loads.set(row.path, row);
}
for (const [rel, expected] of Object.entries(m.selectedSource)) { relativePath(rel); pin("/repo/" + rel, expected); }
if (m.related.bornMap.path !== "tools/ability-fixtures/born-input.json" || m.related.bornMap.bytes !== 7510 || m.related.bornMap.sha256 !== "5ee388ca61234bae0e7dc04adca00702fbc6199f048487490fcbca25b2cffb16") fail("different source map");
pin("/repo/" + m.related.bornMap.path, { bytes: m.related.bornMap.bytes, sha256: m.related.bornMap.sha256 });
const original = regular("/repo/" + control.file), text = original.toString("utf8");
if (!Buffer.from(text, "utf8").equals(original) || text.split(control.find).length - 1 !== 1 || control.expectedMatches !== 1) fail("exact single original source anchor required");
const executed = Buffer.from(text.replace(control.find, control.replace), "utf8");
const instrumentation = { kind: "exact-once-replacement", controlId: control.id, file: control.file,
  controlsSha256: CONTROLS_SHA, find: control.find, replace: control.replace, expectedMatches: 1 };
const variant = { control, controlsSha256: CONTROLS_SHA, original: { path: control.file, bytes: original.length, sha256: sha(original) }, executed: { bytes: executed.length, sha256: sha(executed) }, instrumentation };
equal(m.variant, variant, "ONE chosen transform does not equal independently recomputed mounted-original replacement");
for (const row of loads.values()) {
  if (row.path === control.file) {
    if (row.executedBytes !== executed.length || row.executedSha256 !== sha(executed)) fail("executed control body differs");
    equal(row.instrumentation, instrumentation, "wrong exact instrumentation record");
  } else if (row.executedBytes !== row.bytes || row.executedSha256 !== row.sha256 || row.instrumentation !== null) fail("second/unapproved transform");
}
if ([...loads.values()].filter(x => x.instrumentation !== null).length !== 1) fail("exactly one transform required");
const meta = JSON.parse(regular("/run/metafile.json").toString("utf8")), normalized = new Map();
for (let [path, value] of Object.entries(meta.inputs)) {
  path = path === "pinned-schema:@colyseus/schema/build/index.mjs" ? "npm:@colyseus/schema/build/index.mjs" : path.startsWith(SOURCE_ROOT + "/") ? path.slice(SOURCE_ROOT.length + 1) : relativePath(path);
  if (normalized.has(path)) fail("duplicate metafile input"); normalized.set(path, value.bytes);
}
if (normalized.size !== 133 || [...loads.values()].some(x => normalized.get(x.path) !== x.executedBytes)) fail("variant executed closure/metafile mismatch");
for (const output of Object.values(meta.outputs)) for (const imp of output.imports) if (imp.external && !EXTERNALS.includes(imp.path)) fail("unapproved emitted external");
keys(m.readset, ["selectedSource", "related", "prep", "pristine"], "readset");
const mountPaths = [...Object.keys(pristine.selectedSource), pristine.related.bornMap.path];
equal([...m.readset.selectedSource, ...m.readset.related], mountPaths.map(rel => ({ host: SOURCE_ROOT + "/" + rel, container: "/repo/" + rel })), "different original source/map mount set");
equal(m.readset.prep, PREPARED, "different prepared readset");
const oldRun = SOURCE_ROOT + "/docs/evidence/bot-protection-cues/offline-root-reviewed-01";
equal(m.readset.pristine, [{ host: oldRun + "/prepared/build-manifest.json", container: "/pristine/build-manifest.json" },
  ...Object.keys(PRISTINE_FILES).map(name => ({ host: oldRun + "/captured/" + name, container: "/pristine/" + name }))], "different pristine proof mounts");
function streamPin(path, expected) {
  const before = noLinks(path, true); if (before.size !== expected.bytes || before.size > MAX_CORPUS) fail("wrong pristine proof size");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW), h = createHash("sha256");
  try {
    const held = fstatSync(fd), buffer = Buffer.alloc(65536); let n, bytes = 0;
    if (held.dev !== before.dev || held.ino !== before.ino) fail("pristine proof replaced before read");
    while ((n = readSync(fd, buffer, 0, buffer.length, null)) !== 0) { bytes += n; if (bytes > expected.bytes) fail("pristine proof grew"); h.update(buffer.subarray(0, n)); }
    const after = fstatSync(fd), named = noLinks(path, true);
    if (bytes !== expected.bytes || h.digest("hex") !== expected.sha256 || held.dev !== after.dev || held.ino !== after.ino || held.size !== after.size || held.mtimeMs !== after.mtimeMs || named.dev !== held.dev || named.ino !== held.ino || named.size !== held.size || named.mtimeMs !== held.mtimeMs) fail("pristine proof pin changed");
  } finally { closeSync(fd); }
}
for (const [name, expected] of Object.entries(PRISTINE_FILES)) streamPin("/pristine/" + name, expected);
const originalVerification = JSON.parse(regular("/pristine/verification.json", MAX_VERIFY).toString("utf8"));
if (originalVerification.status !== "PASS" || originalVerification.cases !== 11 || originalVerification.driverCode !== PRISTINE_CODE || originalVerification.sourceBase !== BASE) fail("baseline is not the exact independently accepted11-case proof");
const outputDir = noLinks("/out"); keys(m.outputOwnership, ["hostUid", "hostGid", "directoryMode"], "ownership");
if ((outputDir.mode & 0o777) !== 0o700 || outputDir.uid !== m.outputOwnership.hostUid || outputDir.gid !== m.outputOwnership.hostGid || m.outputOwnership.directoryMode !== 0o700) fail("owned0700 output required");
const expectedOutput = control.kind === "semantic" ? KILL_OUTPUT : NONKILL_OUTPUT, prior = readdirSync("/out").sort();
if (mode === "capture" ? prior.length !== 0 : JSON.stringify(prior) !== JSON.stringify(expectedOutput)) fail("fresh empty capture or exact prior classified output required");
if (mode === "check-consistency") for (const name of expectedOutput) { const st = noLinks("/out/" + name, true); if (st.size > (name === "verification.json" || name === "classification.json" ? MAX_VERIFY : MAX_CORPUS)) fail("oversized prior output before imports"); }
function writeNew(name, bytes) {
  if (![...NONKILL_OUTPUT, "runtime-failure.json"].includes(name)) fail("unapproved output name"); noLinks("/out");
  const fd = openSync("/out/" + name, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { const st = fstatSync(fd); if (!st.isFile() || st.nlink !== 1 || st.size !== 0 || (st.mode & 0o777) !== 0o600) fail("exclusive regular0600 output required"); writeFileSync(fd, bytes); }
  finally { closeSync(fd); }
}
const serialize = value => JSON.stringify(value, null, 2) + "\n";
function bounded(text, limit, name) { if (Buffer.byteLength(text) > limit) fail(name + " exceeds finite artifact guard"); return text; }
function recheck() {
  if (sha(regular("/run/build-manifest.json")) !== a.get("--expected-manifest-sha256") || sha(regular("/pristine/build-manifest.json")) !== PRISTINE_MANIFEST_SHA) fail("manifest changed");
  for (const output of Object.values(m.outputs)) pin("/run/" + output.path, { bytes: output.bytes, sha256: output.sha256 }, MAX_BUNDLE);
  for (const [rel, expected] of Object.entries(m.selectedSource)) pin("/repo/" + rel, expected);
  pin("/repo/" + m.related.bornMap.path, { bytes: m.related.bornMap.bytes, sha256: m.related.bornMap.sha256 });
  for (const [name, expected] of Object.entries(PRISTINE_FILES)) streamPin("/pristine/" + name, expected);
}
function validateProfile(raw) {
  const f = raw?.profile?.frozenBuild;
  if (raw?.profile?.driverCode !== m.code || raw.profile.sourceBase !== BASE || f?.code !== m.code || f.sourceBase !== BASE || f.manifestSha256 !== sha(manifestBytes)) fail("raw provenance differs");
  equal(f.bundle, m.outputs.scenario, "raw bundle pin differs"); equal(f.variant, variant, "raw chosen transform differs");
  equal(f.loadedInputs, m.loadedInputs, "raw closure provenance differs"); equal(f.configuration, m.configuration, "raw config provenance differs");
  equal(f.selectedSource, m.selectedSource, "raw original source pins differ"); equal(f.mapInput, m.related.bornMap, "raw map pin differs");
}
function loadPristineRaw() {
  // Source/canonical relation was independently accepted and all3 exact bytes are pinned above; no new World is run.
  const raw = JSON.parse(regular("/pristine/observations-before-verification.json", MAX_CORPUS).toString("utf8"));
  if (raw.status !== "ok" || raw.cases?.length !== 11 || raw.profile?.driverCode !== PRISTINE_CODE || raw.profile.sourceBase !== BASE || raw.profile.frozenBuild.manifestSha256 !== PRISTINE_MANIFEST_SHA) fail("wrong pristine raw identity");
  return raw;
}
// Complete equality except individually checked provenance leaves. Never drop profile/config/gameplay groups.
function commentEquality(actual, baseline) {
  equal(Object.keys(actual), Object.keys(baseline), "top-level raw shape/order changed");
  equal(Object.keys(actual.profile), Object.keys(baseline.profile), "profile shape/order changed");
  for (const key of Object.keys(baseline)) if (key !== "profile" && key !== "cases") equal(actual[key], baseline[key], "functional top-level changed " + key);
  if (actual.cases.length !== 11) fail("comment requires all11 functional cases");
  for (let i = 0; i < 11; i++) equal(actual.cases[i], baseline.cases[i], "complete functional case changed " + i);
  const p = structuredClone(actual.profile), old = baseline.profile, f = p.frozenBuild, of = old.frozenBuild;
  if (p.driverCode !== m.code || old.driverCode !== PRISTINE_CODE || f.code !== m.code || of.code !== PRISTINE_CODE || f.manifestSha256 !== sha(manifestBytes) || of.manifestSha256 !== PRISTINE_MANIFEST_SHA) fail("unexpected provenance code/manifest");
  p.driverCode = old.driverCode; f.code = of.code; f.manifestSha256 = of.manifestSha256;
  equal(f.bundle, m.outputs.scenario, "actual variant bundle differs"); equal(of.bundle, pristine.outputs.scenario, "baseline bundle differs");
  f.bundle.bytes = of.bundle.bytes; f.bundle.sha256 = of.bundle.sha256;
  equal(f.variant, variant, "unexpected added variant provenance"); delete f.variant;
  const at = f.loadedInputs.findIndex(x => x.path === control.file);
  if (at < 0 || of.loadedInputs[at]?.path !== control.file) fail("control row order changed");
  equal(f.loadedInputs[at].instrumentation, instrumentation, "unexpected control instrumentation");
  if (f.loadedInputs[at].executedBytes !== executed.length || f.loadedInputs[at].executedSha256 !== sha(executed) || of.loadedInputs[at].instrumentation !== null) fail("unexpected original/executed provenance");
  f.loadedInputs[at].executedBytes = of.loadedInputs[at].executedBytes;
  f.loadedInputs[at].executedSha256 = of.loadedInputs[at].executedSha256; f.loadedInputs[at].instrumentation = null;
  equal(p, old, "a non-allowlisted profile/config/provenance field changed");
  return { allCases: 11, allFunctionalFieldsExact: true, allowedDifferences: ["profile.driverCode", "profile.frozenBuild.code", "profile.frozenBuild.manifestSha256", "profile.frozenBuild.bundle.bytes", "profile.frozenBuild.bundle.sha256", "profile.frozenBuild.variant (exact added record)", "profile.frozenBuild.loadedInputs[" + at + "].executedBytes", "profile.frozenBuild.loadedInputs[" + at + "].executedSha256", "profile.frozenBuild.loadedInputs[" + at + "].instrumentation (exact chosen control)"] };
}
function expectedSemantic(raw, baseline, verifier) {
  const ids = ["P0", "P1", "B0", "B1", "B2", "W0", "W1", "W2", "W3", "W4", "W5"], at = ids.indexOf(control.firstFailureCase);
  if (raw.status !== "error" || raw.cases.length !== at + 1) fail("not the intended FIRST failed case");
  for (let i = 0; i < at; i++) { if (raw.cases[i].status !== "ok") fail("earlier case failed"); equal(raw.cases[i], baseline.cases[i], "earlier functional case differs"); }
  const c = verifier.decodeRaw(raw.cases[at]), b = verifier.decodeRaw(baseline.cases[at]);
  if (c.caseId !== control.firstFailureCase || c.status !== "error" || typeof c.error !== "string" || !c.error.startsWith("AssertionError")) fail("setup/non-assertion failure is not a semantic kill");
  equal(c.spec, b.spec, "declared recipe changed"); equal(c.declared, b.declared, "declared constructor inputs changed"); equal(c.assembler, b.assembler, "actual source config/map changed");
  equal(c.composition, b.composition, "temporal input configuration changed");
  if (c.rows.length !== c.steps || c.steps <= 0 || c.steps > 96 || c.T !== b.T) fail("incomplete producer clock evidence");
  equal(c.randomTape, b.randomTape.filter(x => x.time <= c.rows.at(-1).time), "actual random draw prefix changed");
  const row = (v, t) => { const xs = v.rows.filter(x => x.time === t); if (xs.length !== 1) fail("missing exact effect row"); return xs[0]; };
  const own = (v, t) => { const p = row(v, t).ownerFields.find(x => x.id === "cue-caster"); if (!p) fail("missing actual caster owner"); return p; };
  const diag = (v, t) => { const p = row(v, t).sourceDiagnostic.players.find(x => x.id === "cue-caster"); if (!p) fail("missing actual diagnostic"); return p; };
  const fx = (v, pred) => v.rows.flatMap(r => r.sourceFx.map(f => ({ ...f, t: r.time }))).filter(pred);
  const frame = (v, t) => { const xs = v.temporal.filter(x => x.viewerId === "cue-observer" && x.time === t); if (xs.length !== 1) fail("missing actual observer frame"); return xs[0]; };
  const remote = (v, t) => { const p = frame(v, t).frame.fighters.find(x => x.id === "cue-caster"); if (!p) fail("missing remote caster"); return p; };
  const order = (v, who, type, t) => { const xs = row(v, t).orders.filter(x => x.actor === who && x.type === type && x.accepted === true && x.applyTime === t); if (xs.length !== 1) fail("missing actual queued input drain"); return xs[0]; };
  const births = (v, kind) => v.birthRecords.filter(x => x.ownerId === "cue-caster" && x.kind === kind);
  const teleport = fx(c, f => f.kind === "teleport"); if (teleport.length !== 1 || teleport[0].t !== c.T || row(c, c.T).phase !== "active" || !row(c, c.T).sourceDiagnostic.gatesLocked || row(c, c.T).sourceDiagnostic.players.some(p => p.status !== "alive")) fail("genuine active teleport prerequisite absent");
  if (control.id === "teleport-immunity") {
    if (!c.error.includes("missing positive produced owner u32 deadline") || own(c, c.T).immuneUntil !== 0 || !(own(b, b.T).immuneUntil > b.T) || own(c, c.T - 50).immuneUntil !== 0) fail("deadline assignment effect not witnessed");
    return { caseId: c.caseId, assertion: c.error, teleportTime: c.T, baselineDeadline: b.U, observedDeadline: own(c, c.T).immuneUntil, steps: c.steps };
  }
  if (c.steps !== 96 || c.failure?.stage !== "completed-case producer precondition" || c.U !== b.U || c.C !== b.C || !(c.U > c.T)) fail("not a completed-case intended producer assertion");
  if (control.id === "remote-lower-guard" || control.id === "remote-upper-guard") {
    const t = control.id === "remote-lower-guard" ? c.U + 100 : c.T;
    if (!c.error.includes("exact remote lower/upper guard") || remote(c, t).immune !== true || remote(b, t).immune !== false || remote(c, c.U).immune !== true || own(c, t).immuneUntil !== c.U) fail("intended remote guard effect absent");
    if (control.id === "remote-upper-guard" && (remote(c, c.T + 50).immune !== true || remote(b, b.T + 50).immune !== false)) fail("upper guard's second sample absent");
    return { caseId: c.caseId, assertion: c.error, sampleTime: t, baselineRemoteImmune: false, observedRemoteImmune: true, positiveOwnerDeadline: c.U };
  }
  const start = diag(c, c.C), firstWindup = fx(c, f => f.kind === "windup" && f.by === "cue-caster" && f.weapon === "wand" && f.t === c.C);
  if (control.id === "preserve-ranged-cancel") {
    order(c, "cue-caster", "target", c.C); order(c, "cue-caster", "stop", c.C + 50);
    if (!c.error.includes("same committed cast survives order") || start.action?.kind !== "cast" || start.action.target !== "cue-observer" || !(start.action.landsAt > c.C + 50) || firstWindup.length !== 1 || diag(c, c.C + 50).action !== null || own(c, c.C + 50).attackTarget !== "" || own(c, c.C + 50).moveSeq !== 1 || fx(c, f => f.kind === "cancel" && f.id === "cue-caster" && f.t === c.C + 50).length !== 1 || births(c, "ball").length !== 0 || births(b, "ball").length !== 1) fail("real queued Stop/ranged cancellation effect absent");
    return { caseId: c.caseId, assertion: c.error, targetedCastTime: c.C, actualStopApplyTime: c.C + 50, cancelTime: c.C + 50, observedBallBirths: 0, baselineBallBirths: 1 };
  }
  if (control.id === "different-target-cancel") {
    if (order(c, "cue-caster", "target", c.C).msg.id !== "cue-observer" || order(c, "cue-caster", "target", c.C + 50).msg.id !== "cue-other") fail("actual retarget messages differ");
    order(c, "cue-caster", "swap", c.C + 100);
    const after = diag(c, c.C + 50), later = frame(c, c.C + 350).memory.fighters.get("cue-caster"), oldLater = frame(b, b.C + 350).memory.fighters.get("cue-caster");
    const actualWindupStimuli = c.temporal.filter(x => x.viewerId === "cue-observer").flatMap(x => x.stimuli).filter(x => x.kind === "windupAtMe" && x.subject === "cue-caster");
    if (c.error !== "AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n\n0 !== 1\n" || start.action?.target !== "cue-observer" || firstWindup.length !== 1 || own(c, c.C + 50).attackTarget !== "cue-other" || after.action?.target !== "cue-observer" || fx(c, f => f.kind === "cancel" && f.id === "cue-caster").length !== 0 || fx(b, f => f.kind === "cancel" && f.id === "cue-caster").length !== 1 || actualWindupStimuli.length === 0 || !later || !oldLater || later.feints !== 0 || later.lastFeintAt !== null || oldLater.feints !== 1 || oldLater.lastFeintAt !== b.C + 50) fail("retarget/cancel/observer-feint effect absent; later swap/no-Ball is insufficient");
    return { caseId: c.caseId, assertion: c.error, realTargetApplyTime: c.C + 50, publicLock: "cue-other", retainedActionTarget: "cue-observer", observedCancelCount: 0, baselineCancelCount: 1, observedFeints: later.feints, observedLastFeintAt: later.lastFeintAt, baselineFeints: oldLater.feints, baselineLastFeintAt: oldLater.lastFeintAt };
  }
  if (control.id === "bow-stagger-exclusion") {
    order(c, "cue-caster", "attack", c.C); order(c, "cue-observer", "attack", c.C + 50);
    const paid = fx(c, f => f.kind === "hit" && f.id === "cue-caster" && f.by === "cue-observer" && f.weapon === "sword" && f.amount > 0 && !f.passive && f.t === c.C + 50);
    if (c.error !== "AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n+ actual - expected\n\n+ undefined\n- 'draw'\n" || start.action?.kind !== "draw" || start.action.weapon !== "bow" || !(start.action.landsAt > c.C + 50) || own(c, c.C).drawStartedAt !== c.C || paid.length !== 1 || own(c, c.C + 50).status !== "alive" || !(own(c, c.C + 50).hp < own(c, c.C).hp) || diag(c, c.C + 50).action !== null || own(c, c.C + 50).drawStartedAt !== 0 || fx(c, f => f.kind === "stagger" && f.id === "cue-caster" && f.t === c.C + 50).length !== 1 || births(c, "arrow").length !== 0 || births(b, "arrow").length !== 1) fail("paid Sword/Bow draw-exception effect absent");
    return { caseId: c.caseId, assertion: c.error, positiveDrawTime: c.C, paidHitTime: c.C + 50, paidHitAmount: paid[0].amount, observedStagger: true, observedArrowBirths: 0, baselineArrowBirths: 1 };
  }
  fail("no intended semantic classifier for this chosen control");
}
let stage = "import-verifier", rawWritten = false;
try {
  const verifier = await import(new URL("./verify.mjs", import.meta.url).href);
  if (!["verify", "encodeRaw", "decodeRaw"].every(k => typeof verifier[k] === "function")) fail("unchanged verifier API differs");
  let raw;
  if (mode === "capture") {
    stage = "import-scenario"; const scenario = await import(new URL("./scenario.mjs", import.meta.url).href);
    if (typeof scenario.capture !== "function") fail("unchanged capture API differs");
    stage = "capture"; const native = scenario.capture({ codeSha: m.code, sourceBase: BASE });
    if (native?.profile && typeof native.profile === "object") native.profile.frozenBuild = { code: m.code, sourceBase: BASE, image: IMAGE,
      manifestSha256: sha(manifestBytes), bundle: m.outputs.scenario, loadedInputs: m.loadedInputs, configuration: m.configuration,
      selectedSource: m.selectedSource, mapInput: m.related.bornMap, variant };
    stage = "encode-raw"; raw = verifier.encodeRaw(native);
    writeNew("observations-before-verification.json", bounded(serialize(raw), MAX_CORPUS, "actual variant raw")); rawWritten = true;
  } else { stage = "read-classified-raw"; raw = JSON.parse(regular("/out/observations-before-verification.json", MAX_CORPUS).toString("utf8")); }
  stage = "post-capture-envelope"; recheck(); validateProfile(raw);
  const baseline = loadPristineRaw(); let result, classification;
  if (control.kind === "semantic" && raw.status === "ok") {
    stage = "semantic-survived"; verifier.verify(raw);
    classification = { format: "rh-p15-protection-cues-variant-classification/1", status: "SURVIVED", controlId: control.id,
      code: m.code, sourceBase: BASE, pristineCode: PRISTINE_CODE, transform: variant, actualCases: raw.cases.length,
      reason: "unchanged source verifier accepted all11 under the exact chosen semantic transform; NOT a kill",
      independentSourceReproduction: false };
  } else if (control.kind === "semantic") {
    stage = "intended-semantic-evidence"; const evidence = expectedSemantic(raw, baseline, verifier);
    let refused = false;
    try { verifier.verify(raw); } catch (error) { if (error?.name !== "AssertionError") throw error; refused = true; }
    if (!refused) fail("semantic mutant unexpectedly verified as pristine source");
    classification = { format: "rh-p15-protection-cues-variant-classification/1", status: "KILL", controlId: control.id,
      code: m.code, sourceBase: BASE, pristineCode: PRISTINE_CODE, transform: variant, firstFailure: evidence,
      canonicalRefused: true, compileEnvelopeProvenanceTimeoutMissingRawCountAsKill: false, independentSourceReproduction: false };
  } else {
    stage = "verify-comment"; result = verifier.verify(raw);
    stage = "full-functional-nonkill"; const equality = commentEquality(raw, baseline);
    classification = { format: "rh-p15-protection-cues-variant-classification/1", status: "NONKILL", controlId: control.id,
      code: m.code, sourceBase: BASE, pristineCode: PRISTINE_CODE, transform: variant, equality,
      sourceVerifierStatus: result.verification.status, independentSourceReproduction: false };
  }
  stage = "post-classification-envelope"; recheck();
  const classificationText = bounded(serialize(classification), MAX_VERIFY, "classification");
  if (mode === "capture") {
    if (result && control.kind === "comment-nonkill") { writeNew("source.json", bounded(serialize(result.canonical), MAX_CORPUS, "comment canonical")); writeNew("verification.json", bounded(serialize(result.verification), MAX_VERIFY, "comment verification")); }
    writeNew("classification.json", classificationText);
    equal(readdirSync("/out").sort(), expectedOutput, "classified output inventory differs");
  } else {
    if (classificationText !== regular("/out/classification.json", MAX_VERIFY).toString("utf8")) fail("stored classification consistency differs");
    if (result && (serialize(result.canonical) !== regular("/out/source.json", MAX_CORPUS).toString("utf8") || serialize(result.verification) !== regular("/out/verification.json", MAX_VERIFY).toString("utf8"))) fail("stored comment canonical consistency differs");
  }
  console.log(serialize({ mode, controlId: control.id, classification: classification.status, sourceExecuted: mode === "capture",
    code: m.code, actualCases: raw.cases.length, independentSourceReproduction: false }).trim());
  if (classification.status === "SURVIVED") process.exitCode = 2;
} catch (error) {
  // No compile/import/envelope/missingraw/timeout/ambiguous effect is ever a KILL. Signals before return cannot
  // promise World rows. Actual caught source assertions are in raw; unexpected failures are distinct ERROR receipts.
  if (mode === "capture") {
    const failure = { format: "rh-p15-protection-cues-variant-runtime-failure/1", status: "ERROR", controlId: control.id,
      code: m.code, stage, rawObservationPreserved: rawWritten, sourceRowsReconstructed: false,
      error: { name: String(error?.name ?? "Error"), message: String(error?.message ?? error), stack: String(error?.stack ?? "") } };
    if (!rawWritten) writeNew("observations-before-verification.json", serialize(failure));
    writeNew("runtime-failure.json", bounded(serialize(failure), MAX_VERIFY, "failure receipt"));
  }
  throw error;
}
// No loop/second World/retry/restored run is chained. check-consistency never imports scenario or writes files.

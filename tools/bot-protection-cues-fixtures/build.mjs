// HOST BUILD ONLY. Derived from actual reviewed8151 guard implementation. No scenario/World import or capture.
// Root must separately approve immutable source HEAD, fresh output and generated runtime pins.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const SOURCE_ROOT = "/Users/nevinmckinnon/Documents/Projects/RogueHalla-bot-own-timings";
const TOOL_ROOT = "/Users/nevinmckinnon/Documents/Projects/RogueHalla/node_modules";
const HOST_NODE = "/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/map-styled-bench/npm-cache/_npx/361c55be1121897e/node_modules/node/bin/node";
const HOST_SHA = "2cc28a1880d0774616959f2210ee739bffa6ac695c887e8988a496a21271f6c0";
const BASE = "bb564d3b53728cbd205af375b5342eca466f3656";
const IMAGE = "node@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292";
const ENTRY = "tools/bot-protection-cues-fixtures/scenario.mts";
const RUNTIME = "tools/bot-protection-cues-fixtures/runtime.mjs";
const VERIFY = "tools/bot-protection-cues-fixtures/verify.mjs";
const SOURCE_PREFIXES = ["packages/server/src/", "packages/shared/src/", "tools/bot-protection-cues-fixtures/"];
const EXTERNALS = new Set(["node:assert/strict", "node:crypto", "node:fs"]);
const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
const CONTROLS = "tools/bot-protection-cues-fixtures/controls.mjs";
const GIT = "/Library/Developer/CommandLineTools/usr/bin/git";
const GIT_SHA = "be4afb2b003904725826250de9fb76567bbacf82323457b5a1ec26706b66bcae";
const MAX_CORPUS_BYTES = 128 * 1024 * 1024;
const PREPARED_NAMES = ["build-manifest.json", "metafile.json", "runtime.mjs", "scenario.mjs", "verify.mjs"];
const TOOL_HASHES = {
  "esbuild/lib/main.js": "61ec0ba144ff93f4bf0e96ad6fab6f430ede0aa13e27ace8063ed63ba416b3cd",
  "esbuild/package.json": "9d0bc453f4e791553c4cc2298ba023b409241fd9801e494741666eb0f6051490",
  "esbuild/bin/esbuild": "10b6243df618d374bb2d5c9cfbe7052e1405f6aa4e53a6164f11a91b9f2e1384",
  "@esbuild/darwin-arm64/bin/esbuild": "10b6243df618d374bb2d5c9cfbe7052e1405f6aa4e53a6164f11a91b9f2e1384",
  "@colyseus/schema/build/index.mjs": "c5d2c222121377565fda9799c7e1b852c70a21877136498add79795f2055face",
  "@colyseus/schema/package.json": "e132bda166931370e39bddc3e03f778734e957f964134b6f2baa09f66ddd225d",
};
const SELECTED = {
  "packages/server/src/sim/arena.ts": {
    "bytes": 29450,
    "sha256": "f8395e83f1f7f81d91bbc51d8fdec4e025f95d299c42f7229250be908341191a"
  },
  "packages/server/src/sim/weapons.ts": {
    "bytes": 17776,
    "sha256": "581ba4cf9ae93af5d3753cbb3cdf6b823bfaf730448edab7669e6c6d84c86f26"
  },
  "packages/server/src/sim/step.ts": {
    "bytes": 14822,
    "sha256": "5ff90451b4b27b12ddfe8175745cf38892eaf07a851282c904076edc46896634"
  },
  "packages/server/src/sim/targeting.ts": {
    "bytes": 10392,
    "sha256": "13125287cec7cd39f550af50e1d18c15d3146357f249cfe3beeb9e00a334f0fd"
  },
  "packages/server/src/sim/inputs.ts": {
    "bytes": 15914,
    "sha256": "47bda82b978e67922c9d2361bfcd51be4555a55691453a4e0393deb917be4cde"
  },
  "packages/server/src/sim/gameplay.ts": {
    "bytes": 5104,
    "sha256": "70f6f2b67571783f3042309bef01dc75aabd2656c59a184d0f97c9c0a8b8cf78"
  },
  "packages/server/src/sim/world.ts": {
    "bytes": 58199,
    "sha256": "b98376a7f022ec6f9b681e368d62c18fbe524d95408b2d4eec93909934454d54"
  },
  "packages/server/src/sim/combatant.ts": {
    "bytes": 9454,
    "sha256": "3c2fac6ed6fbee82802c5bea86b0131d36e8ebf86eceb2c1a99ce58664fa7e60"
  },
  "packages/server/src/sim/ledger.ts": {
    "bytes": 24320,
    "sha256": "cc73151c50c43f65a85fc922050b2ea6a34973794ec893c7b7d51d657a4e6437"
  },
  "packages/server/src/sim/status.ts": {
    "bytes": 17222,
    "sha256": "55bc525be1ac832f04b0f134cee6769b0b99f4d45ce182ec7db9d3670ba35642"
  },
  "packages/server/src/bots/brain/perception.ts": {
    "bytes": 36755,
    "sha256": "059dba28d67a588be8b9f491cd69a242e841545a3b1863ce798da2e3f085390a"
  },
  "packages/server/src/bots/brain/memory.ts": {
    "bytes": 35038,
    "sha256": "29c2086be936ec867ddec97c2e4442b86acdbf1255e55de001e73892f7b128a8"
  },
  "packages/server/src/bots/brain/vision.ts": {
    "bytes": 4865,
    "sha256": "e4418c5bbd8e9d8e3c21e3b1b9b8f677c947d178f812c9d634934c6c8c92f34c"
  },
  "packages/server/src/bots/brain/frames.ts": {
    "bytes": 20904,
    "sha256": "aa8fcb62e8039d37d3c9f6cb000687fbfea61e12ab50805dfe45dae06119d6c6"
  },
  "packages/server/src/bots/brain/types.ts": {
    "bytes": 57792,
    "sha256": "12b3cae05bcde760cd642b9c5eb9919bfc47189882c81258994c9f1122d3d361"
  },
  "packages/server/src/rooms/FxChannel.ts": {
    "bytes": 5438,
    "sha256": "14dcbc44ae20f8e882846bb9231a842e2369d4c7a6c0d2c15e659a76c85e8776"
  },
  "packages/shared/src/schema.ts": {
    "bytes": 21469,
    "sha256": "245486da649ea5bc5d8b9b0d5d75f3e860fc8f153574fa2b9ee091dcb52e99cb"
  },
  "packages/shared/src/constants.ts": {
    "bytes": 46007,
    "sha256": "51ce4dd800ec868abee525fb1ae375688066f336972a7da878644df1235924e7"
  },
  "packages/shared/src/fxCodec.ts": {
    "bytes": 24844,
    "sha256": "db2080230ad1b3702e37d3e339384e4a071ef899a8203026e20038a3a2b0f0ba"
  },
  "packages/shared/src/weapons.ts": {
    "bytes": 15391,
    "sha256": "2f22f037502fe63fae6b47f20408cfd35ebc72bfea081194ae8d18cfc21df99b"
  },
  "packages/shared/src/signatures.ts": {
    "bytes": 9370,
    "sha256": "0a6befbb5a6fe9870b13a540d72235085c491668c8cae3674fa8faf89816e191"
  },
  "packages/shared/src/mods.ts": {
    "bytes": 23134,
    "sha256": "10e9dcd3d7417c4fe85d1c36ef33afe5abf7a5703a59b42a3a825a66aa4efaff"
  }
};
const METADATA = {
  "package.json": {
    "bytes": 2247,
    "sha256": "9da8ab00050db3ec14c083365ab0c3a5b8986e38fd13c086b2913249d531422c"
  },
  "package-lock.json": {
    "bytes": 153409,
    "sha256": "991869bdfbbefb6874220500197c61db302a4d2b2603dfc2288fd7032ce1d481"
  },
  "tsconfig.base.json": {
    "bytes": 410,
    "sha256": "017575ec3101f44df43b5a7cc850779582650d9e01a2090b7e311b213b98ef88"
  },
  "packages/server/package.json": {
    "bytes": 981,
    "sha256": "d4965c850237876a64a02cd1c7c554f1a64d97392344cae3b63d4bd688e2f7b8"
  },
  "packages/server/tsconfig.json": {
    "bytes": 153,
    "sha256": "38a209200ba0dde3bbaeee8df1e29755aa35b63c588367da486b31a83b90cd15"
  },
  "packages/shared/package.json": {
    "bytes": 427,
    "sha256": "6e9c040348c50e0ad5043ec4cb9b4206f68f29cf4eeb4dec5f635f37a6f87f35"
  },
  "packages/shared/tsconfig.json": {
    "bytes": 124,
    "sha256": "e81b194f96f35e0d1e9e8069998a30740b08703e085bb7d0f92922d7b6d06193"
  }
};
const RELATED = {
  "bornMap": {
    "path": "tools/ability-fixtures/born-input.json",
    "bytes": 7510,
    "sha256": "5ee388ca61234bae0e7dc04adca00702fbc6199f048487490fcbca25b2cffb16"
  }
};

function fail(message) { throw new Error(message); }
function sha(b) { return createHash("sha256").update(b).digest("hex"); }
function parseArgs() {
  const out = new Map(), allowed = new Set(["--source-root", "--tool-root", "--output", "--expected-code-sha"]);
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i], value = process.argv[i + 1];
    if (!allowed.has(key) || out.has(key) || (!value || value.startsWith("--"))) fail("unknown/duplicate/missing argument " + key);
    out.set(key, value);
  }
  for (const key of allowed) if (!out.has(key)) fail("missing " + key);
  return out;
}
function noLinksAbsolute(path, wantFile = false) {
  const absolute = resolve(path);
  let at = sep;
  for (const part of absolute.split(sep).filter(Boolean)) {
    at = join(at, part); const st = lstatSync(at);
    if (st.isSymbolicLink()) fail("symlink refused before reading: " + at);
    if (at !== absolute && !st.isDirectory()) fail("nondirectory ancestor " + at);
  }
  const st = lstatSync(absolute);
  if (wantFile ? !st.isFile() : !st.isDirectory()) fail("wrong path kind " + absolute);
  if (realpathSync(absolute) !== absolute) fail("noncanonical path " + absolute);
  return absolute;
}
function readChecked(path) {
  const canonical = noLinksAbsolute(path, true), before = lstatSync(canonical);
  const fd = openSync(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const held = fstatSync(fd);
    if (!held.isFile() || held.dev !== before.dev || held.ino !== before.ino) fail("input changed before descriptor read " + path);
    const bytes = readFileSync(fd), after = fstatSync(fd);
    noLinksAbsolute(canonical, true);
    const named = lstatSync(canonical);
    if (held.dev !== after.dev || held.ino !== after.ino || held.size !== after.size || held.mtimeMs !== after.mtimeMs || named.dev !== held.dev || named.ino !== held.ino || named.size !== held.size || named.mtimeMs !== held.mtimeMs) fail("input changed during descriptor read " + path);
    return bytes;
  } finally { closeSync(fd); }
}
function relativePath(rel) {
  if (!rel || rel.startsWith("/") || rel.includes("\\") || rel.split("/").some(p => !p || p === "." || p === "..")) fail("unsafe relative path " + rel);
  return rel;
}
const args = parseArgs();
if (args.get("--source-root") !== SOURCE_ROOT || args.get("--tool-root") !== TOOL_ROOT) fail("unexpected project/tool root before filesystem access");
const sourceRoot = noLinksAbsolute(SOURCE_ROOT), toolRoot = noLinksAbsolute(TOOL_ROOT);
if (fileURLToPath(import.meta.url) !== join(sourceRoot, "tools/bot-protection-cues-fixtures/build.mjs")) fail("driver must execute the exact frozen source path");
const expectedHead = args.get("--expected-code-sha");
if (!/^[0-9a-f]{40}$/.test(expectedHead)) fail("expected-code-sha must be the Root-reviewed full code seal");
if (process.execArgv.length !== 0 || process.env.NODE_OPTIONS || process.env.NODE_PATH || process.env.NODE_COMPILE_CACHE || process.version !== "v22.23.4" || process.platform !== "darwin" || process.arch !== "arm64") fail("unexpected host Node runtime");
if (resolve(process.execPath) !== HOST_NODE || noLinksAbsolute(HOST_NODE, true) !== HOST_NODE || sha(readChecked(HOST_NODE)) !== HOST_SHA) fail("host Node binary pin mismatch");
const gitEnv = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_ATTR_NOSYSTEM: "1", GIT_OPTIONAL_LOCKS: "0" };
if (sha(readChecked(GIT)) !== GIT_SHA) fail("readonly Git executable pin mismatch");
function git(argv) { return execFileSync(GIT, ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-C", sourceRoot, ...argv], { env: gitEnv, maxBuffer: 64 * 1024 * 1024 }); }
function requireHead() { if (git(["rev-parse", "HEAD"]).toString("utf8").trim() !== expectedHead) fail("working HEAD is not approved immutable code seal"); }
requireHead(); git(["merge-base", "--is-ancestor", BASE, expectedHead]);
function blob(ref, rel) { return git(["show", ref + ":" + relativePath(rel)]); }
function frozen(rel) {
  relativePath(rel); const p = noLinksAbsolute(join(sourceRoot, rel), true), bytes = readChecked(p);
  if (!bytes.equals(blob(expectedHead, rel))) fail("disk differs from exact approved blob: " + rel);
  if (rel.startsWith("packages/") && !bytes.equals(blob(BASE, rel))) fail("application source changed from released baseline: " + rel);
  return bytes;
}
function pin(rel, expected) {
  const b = frozen(rel);
  if (b.length !== expected.bytes || sha(b) !== expected.sha256) fail("source/metadata pin mismatch " + rel);
  return b;
}
function tool(rel) {
  const p = noLinksAbsolute(join(toolRoot, relativePath(rel)), true), b = readChecked(p);
  if (sha(b) !== TOOL_HASHES[rel]) fail("pinned tool changed " + rel);
  return p;
}
for (const rel of Object.keys(TOOL_HASHES)) tool(rel);
for (const [rel, expected] of Object.entries(SELECTED)) pin(rel, expected);
for (const [rel, expected] of Object.entries(METADATA)) pin(rel, expected);
const runtimeBytes = frozen(RUNTIME), verifyBytes = frozen(VERIFY), driverBytes = frozen("tools/bot-protection-cues-fixtures/build.mjs"), controlsBytes = frozen(CONTROLS);
frozen(ENTRY);
for (const x of Object.values(RELATED)) pin(x.path, x);
// Only one previously nonexistent offline-<nonce> parent is allowed. Create it ourselves,
// never follow/reuse caller-created parents. All writes below are exclusive and no-follow.
const evidence = noLinksAbsolute(join(sourceRoot, "docs/evidence/bot-protection-cues"));
const output = args.get("--output"), runRoot = dirname(output);
if (output !== resolve(output)) fail("output must be an exact canonical absolute literal");
const runName = relative(evidence, runRoot);
if (!/^offline-[A-Za-z0-9_-]{1,80}$/.test(runName) || output !== join(evidence, runName, "prepared")) fail("output must be exact fresh offline-<nonce>/prepared");
if (existsSync(runRoot)) fail("offline run root exists; refuse reuse/deletion");
mkdirSync(runRoot, { mode: 0o700 }); noLinksAbsolute(runRoot);
mkdirSync(output, { mode: 0o700 });
const captured = join(runRoot, "captured"); mkdirSync(captured, { mode: 0o700 });
for (const path of [runRoot, output, captured]) {
  noLinksAbsolute(path);
  const st = lstatSync(path);
  if ((st.mode & 0o777) !== 0o700 || st.uid !== process.getuid()) fail("fresh directory is not owned0700 " + path);
}
function writeNew(name, bytes) {
  if (name.includes("/") || !/^[A-Za-z0-9_.-]+$/.test(name)) fail("unsafe output filename");
  noLinksAbsolute(output);
  const fd = openSync(join(output, name), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.size !== 0 || (st.mode & 0o777) !== 0o600) fail("nonregular/nonexclusive0600 prepared output");
    writeFileSync(fd, bytes);
  } finally { closeSync(fd); }
}
process.env.ESBUILD_BINARY_PATH = tool("@esbuild/darwin-arm64/bin/esbuild");
delete process.env.NODE_OPTIONS; delete process.env.NODE_PATH;
const esbuild = createRequire(import.meta.url)(tool("esbuild/lib/main.js"));
if (esbuild.version !== "0.28.2" || JSON.parse(readChecked(tool("@colyseus/schema/package.json"))).version !== "5.0.42") fail("different pinned compiler/schema version");
const schemaPath = tool("@colyseus/schema/build/index.mjs");
const loads = new Map(), resolutionMetadata = new Set();
function checkMetadataAncestors(dir) {
  for (let at = dir; at === sourceRoot || at.startsWith(sourceRoot + sep); at = dirname(at)) {
    for (const name of ["package.json", "tsconfig.json"]) {
      const rel = relative(sourceRoot, join(at, name)).split(sep).join("/");
      resolutionMetadata.add(rel);
      if (existsSync(join(sourceRoot, rel))) {
        if (!METADATA[rel]) fail("unapproved compiler metadata " + rel);
        pin(rel, METADATA[rel]);
      }
    }
    if (at === sourceRoot) break;
  }
}
function sourcePath(p) {
  const abs = resolve(p), rel = relative(sourceRoot, abs).split(sep).join("/");
  relativePath(rel);
  if (!SOURCE_PREFIXES.some(prefix => rel.startsWith(prefix))) fail("disallowed source import " + rel);
  noLinksAbsolute(abs, true); return { path: abs, rel };
}
function moduleState(abs) {
  const rel = relative(sourceRoot, abs).split(sep).join("/");
  relativePath(rel);
  if (!SOURCE_PREFIXES.some(prefix => rel.startsWith(prefix))) fail("relative import escapes approved source prefixes " + rel);
  let at = sourceRoot;
  const parts = rel.split("/");
  for (let i = 0; i < parts.length; i++) {
    at = join(at, parts[i]); let st;
    try { st = lstatSync(at); } catch (e) { if (e.code === "ENOENT" || e.code === "ENOTDIR") return null; throw e; }
    if (st.isSymbolicLink()) fail("symlink module ancestor/candidate " + at);
    if (i < parts.length - 1 && !st.isDirectory()) return null;
    if (i === parts.length - 1) return st;
  }
  return null;
}
function resolveRelative(args) {
  if (!args.resolveDir) fail("relative import without explicit resolveDir " + args.path);
  const base = resolve(args.resolveDir, args.path);
  const candidates = [base, ...[".ts", ".mts", ".js", ".mjs", ".json"].map(s => base + s), ...["index.ts", "index.mts", "index.js", "index.mjs"].map(s => join(base, s))];
  for (const p of candidates) {
    const st = moduleState(p);
    if (st?.isFile()) return { path: sourcePath(p).path };
  }
  fail("unresolved bounded relative import " + args.path);
}
const plugin = {
  name: "protection-cues-frozen-resolver",
  setup(b) {
    b.onResolve({ filter: /^node:/ }, args => { if (!EXTERNALS.has(args.path)) fail("unapproved Node external " + args.path); return { path: args.path, external: true }; });
    b.onResolve({ filter: /^@colyseus\/schema$/ }, () => ({ path: "@colyseus/schema/build/index.mjs", namespace: "pinned-schema" }));
    b.onResolve({ filter: /^@raid\/shared(?:\/.*)?$/ }, args => {
      const suffix = args.path.slice("@raid/shared".length), rel = suffix === "" ? "index.ts" : suffix === "/schema" ? "schema.ts" : suffix === "/telemetry" ? "telemetry.ts" : null;
      if (!rel) fail("unknown shared export " + args.path);
      return { path: sourcePath(join(sourceRoot, "packages/shared/src", rel)).path };
    });
    b.onResolve({ filter: /^\/repo\// }, args => ({ path: sourcePath(join(sourceRoot, args.path.slice(6))).path }));
    b.onResolve({ filter: /^\./ }, resolveRelative);
    b.onResolve({ filter: /^\// }, args => ({ path: sourcePath(args.path).path }));
    b.onResolve({ filter: /.*/ }, args => fail("unapproved bare/dynamic import " + args.path));
    b.onLoad({ filter: /.*/, namespace: "pinned-schema" }, () => {
      const bytes = readChecked(tool("@colyseus/schema/build/index.mjs"));
      loads.set("npm:@colyseus/schema/build/index.mjs", { path: "npm:@colyseus/schema/build/index.mjs", bytes: bytes.length, sha256: sha(bytes), executedBytes: bytes.length, executedSha256: sha(bytes), instrumentation: null });
      return { contents: bytes, loader: "js", resolveDir: dirname(schemaPath) };
    });
    b.onLoad({ filter: /.*/, namespace: "file" }, args => {
      const { path, rel } = sourcePath(args.path); checkMetadataAncestors(dirname(path));
      const original = frozen(rel);
      loads.set(rel, { path: rel, bytes: original.length, sha256: sha(original), executedBytes: original.length,
        executedSha256: sha(original), instrumentation: null });
      return { contents: original, loader: /\.(?:ts|mts)$/.test(path) ? "ts" : path.endsWith(".json") ? "json" : "js", resolveDir: dirname(path) };
    });
  },
};
let built;
try { built = await esbuild.build({ entryPoints: [join(sourceRoot, ENTRY)], absWorkingDir: sourceRoot,
  tsconfig: join(sourceRoot, "tsconfig.base.json"), bundle: true, write: false, platform: "node", format: "esm",
  metafile: true, sourcemap: false, logLevel: "silent", nodePaths: [], plugins: [plugin] }); } finally { esbuild.stop(); }
if (built.errors.length || built.warnings.length || built.outputFiles.length !== 1 || built.outputFiles[0].contents.length > MAX_BUNDLE_BYTES) fail("unexpected/warned/budget-exceeding build output");
const metaInputs = new Set(Object.keys(built.metafile.inputs).map(key => {
  if (key === "pinned-schema:@colyseus/schema/build/index.mjs") return "npm:@colyseus/schema/build/index.mjs";
  return sourcePath(resolve(sourceRoot, key)).rel;
}));
if (metaInputs.size !== loads.size || [...metaInputs].some(key => !loads.has(key))) fail("metafile and exact loaded closure disagree");
for (const output of Object.values(built.metafile.outputs)) for (const imp of output.imports)
  if (imp.external && !EXTERNALS.has(imp.path)) fail("unapproved emitted external " + imp.path);
requireHead();
for (const load of loads.values()) {
  const b = load.path.startsWith("npm:") ? readChecked(tool("@colyseus/schema/build/index.mjs")) : frozen(load.path);
  if (sha(b) !== load.sha256 || b.length !== load.bytes) fail("loaded input changed during build " + load.path);
}
for (const [rel, expected] of Object.entries(SELECTED)) pin(rel, expected);
for (const rel of Object.keys(TOOL_HASHES)) tool(rel);
if (sha(readChecked(HOST_NODE)) !== HOST_SHA || sha(readChecked(GIT)) !== GIT_SHA) fail("host executable changed during build");
for (const [rel, expected] of Object.entries(METADATA)) pin(rel, expected);
for (const rel of resolutionMetadata) {
  if (existsSync(join(sourceRoot, rel))) {
    if (!METADATA[rel]) fail("compiler metadata appeared during build " + rel);
    pin(rel, METADATA[rel]);
  }
}
for (const rel of [ENTRY, RUNTIME, VERIFY, CONTROLS, "tools/bot-protection-cues-fixtures/build.mjs"]) frozen(rel);
for (const x of Object.values(RELATED)) pin(x.path, x);
const bundle = built.outputFiles[0].contents, meta = Buffer.from(JSON.stringify(built.metafile, null, 2) + "\n");
const outputPin = (path, b) => ({ path, bytes: b.length, sha256: sha(b) });
const manifest = {
  format: "rh-p15-protection-cues-build/2", sourceBase: BASE, code: expectedHead, image: IMAGE,
  host: { node: process.version, platform: process.platform, arch: process.arch, execPath: HOST_NODE, sha256: HOST_SHA },
  driver: { path: "tools/bot-protection-cues-fixtures/build.mjs", bytes: driverBytes.length, sha256: sha(driverBytes) },
  compiler: { version: "0.28.2", files: TOOL_HASHES,
    processEnvelope: { node: HOST_NODE, nativeHelper: join(toolRoot, "@esbuild/darwin-arm64/bin/esbuild"), readonlyGit: { path: GIT, sha256: GIT_SHA, commands: ["rev-parse HEAD", "merge-base --is-ancestor", "show <frozen-ref>:<bounded-path>"] }, otherChildren: false, sourceEvaluation: false, networkOrInstall: false } },
  configuration: METADATA, resolutionMetadataChecked: [...resolutionMetadata].sort(), selectedSource: SELECTED, related: RELATED,
  loadedInputs: [...loads.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  outputs: { scenario: outputPin("scenario.mjs", bundle), runtime: outputPin("runtime.mjs", runtimeBytes), verify: outputPin("verify.mjs", verifyBytes), metafile: outputPin("metafile.json", meta) },
  limits: { maxCases: 11, maxStepsPerCase: 96, totalMaxSteps: 1056, maxCorpusBytes: MAX_CORPUS_BYTES, maxBundleBytes: MAX_BUNDLE_BYTES, maxVerificationBytes: 1024 * 1024 },
  externals: [...EXTERNALS], preparedInventory: PREPARED_NAMES,
  runtimeApi: { capture: "capture({codeSha:manifest.code,sourceBase:manifest.sourceBase})", serialization: "verify.encodeRaw/verify.decodeRaw", verifier: "verify(serializedRaw)", modes: ["capture", "check-consistency"], checkMeaning: "existing tagged raw-to-canonical consistency only; NO source recapture or independent frozen execution" },
  contextPolicy: "exact fixed11 actual-source producer contexts with separately labelled initial loadout/HP input; native/P15/fullworld admission remains held",
  controls: { source: CONTROLS, bytes: controlsBytes.length, sha256: sha(controlsBytes), semanticCount: 6, commentNonkillCount: 1, status: "DEFINITIONS_ONLY_UNRUN", preparedArtifact: false },
  outputOwnership: { hostUid: lstatSync(captured).uid, hostGid: lstatSync(captured).gid, directoryMode: 0o700 },
  readset: { selectedSource: Object.keys(SELECTED).map(rel => ({ host: join(sourceRoot, rel), container: "/repo/" + rel })), related: Object.values(RELATED).map(x => ({ host: join(sourceRoot, x.path), container: "/repo/" + x.path })), prep: PREPARED_NAMES },
};
writeNew("scenario.mjs", bundle); writeNew("metafile.json", meta); writeNew("runtime.mjs", runtimeBytes); writeNew("verify.mjs", verifyBytes);
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n"); writeNew("build-manifest.json", manifestBytes);
if (JSON.stringify(readdirSync(output).sort()) !== JSON.stringify(PREPARED_NAMES)) fail("prepared inventory differs from exact five artifacts");
for (const pin of Object.values(manifest.outputs)) { const bytes = readChecked(join(output, pin.path)); if (bytes.length !== pin.bytes || sha(bytes) !== pin.sha256) fail("written artifact mismatch " + pin.path); }
if (!readChecked(join(output, "build-manifest.json")).equals(manifestBytes)) fail("written manifest mismatch");
if (readdirSync(captured).length !== 0) fail("fresh captured directory was changed during build");
requireHead();
console.log(JSON.stringify({ mode: "build-only", code: expectedHead, sourceBase: BASE, output, captured, bundleSha256: sha(bundle), manifestSha256: sha(manifestBytes), loadedInputs: loads.size,
  next: "STOP: Root must independently inspect generated closure/readset/pins and authorize an exact Phase B command; no runtime/control/frozen execution is chained" }));

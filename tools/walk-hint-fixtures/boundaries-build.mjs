// HOST BUILD ONLY. Does not import the scenario, evaluate World, or run a capture.
// Root must separately approve immutable source HEAD, fresh output and generated runtime pins.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";
const SOURCE_ROOT = "/Users/nevinmckinnon/Documents/Projects/RogueHalla-bot-own-timings";
const TOOL_ROOT = "/Users/nevinmckinnon/Documents/Projects/RogueHalla/node_modules";
const HOST_NODE = "/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/map-styled-bench/npm-cache/_npx/361c55be1121897e/node_modules/node/bin/node";
const HOST_SHA = "2cc28a1880d0774616959f2210ee739bffa6ac695c887e8988a496a21271f6c0";
const BASE = "70433a9834ccf082b5ca449dca0fd4319cd072ca";
const IMAGE = "node@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292";
const ENTRY = "tools/walk-hint-fixtures/boundaries-scenario.mts";
const RUNTIME = "tools/walk-hint-fixtures/boundaries-runtime.mjs";
const VERIFY = "tools/walk-hint-fixtures/boundaries-verify.mjs";
const SOURCE_PREFIXES = ["packages/server/src/", "packages/shared/src/", "tools/walk-hint-fixtures/"];
const EXTERNALS = new Set(["node:crypto", "node:fs", "node:path", "node:url"]);
const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
const INSTRUMENT_REL = "packages/server/src/sim/walkHint.ts";
const APPEND_EXPORT = "\n// Capture-only exposure of the existing input-geometry constant; no body changes.\nexport { SPEED_SLACK };\n";
const TOOL_HASHES = {
  "esbuild/lib/main.js": "61ec0ba144ff93f4bf0e96ad6fab6f430ede0aa13e27ace8063ed63ba416b3cd",
  "esbuild/package.json": "9d0bc453f4e791553c4cc2298ba023b409241fd9801e494741666eb0f6051490",
  "esbuild/bin/esbuild": "10b6243df618d374bb2d5c9cfbe7052e1405f6aa4e53a6164f11a91b9f2e1384",
  "@esbuild/darwin-arm64/bin/esbuild": "10b6243df618d374bb2d5c9cfbe7052e1405f6aa4e53a6164f11a91b9f2e1384",
  "@colyseus/schema/build/index.mjs": "c5d2c222121377565fda9799c7e1b852c70a21877136498add79795f2055face",
  "@colyseus/schema/package.json": "e132bda166931370e39bddc3e03f778734e957f964134b6f2baa09f66ddd225d",
};
const SELECTED = {
  "packages/server/src/sim/walkHint.ts": {
    "bytes": 10241,
    "sha256": "9030f17e7e76a5dda94bba76347e2993a5265d8d36e145b9d1f889f3f988af16"
  },
  "packages/server/src/sim/gameplay.ts": {
    "bytes": 5104,
    "sha256": "70f6f2b67571783f3042309bef01dc75aabd2656c59a184d0f97c9c0a8b8cf78"
  },
  "packages/server/src/sim/step.ts": {
    "bytes": 14822,
    "sha256": "5ff90451b4b27b12ddfe8175745cf38892eaf07a851282c904076edc46896634"
  },
  "packages/server/src/sim/status.ts": {
    "bytes": 17222,
    "sha256": "55bc525be1ac832f04b0f134cee6769b0b99f4d45ce182ec7db9d3670ba35642"
  },
  "packages/server/src/sim/targeting.ts": {
    "bytes": 10392,
    "sha256": "13125287cec7cd39f550af50e1d18c15d3146357f249cfe3beeb9e00a334f0fd"
  },
  "packages/server/src/sim/combatant.ts": {
    "bytes": 9454,
    "sha256": "3c2fac6ed6fbee82802c5bea86b0131d36e8ebf86eceb2c1a99ce58664fa7e60"
  },
  "packages/server/src/sim/movement.ts": {
    "bytes": 5986,
    "sha256": "86ebd2205a0af4608ed484317bea3723bb378b3e138954a44140e340adab1f93"
  },
  "packages/server/src/sim/world.ts": {
    "bytes": 58199,
    "sha256": "b98376a7f022ec6f9b681e368d62c18fbe524d95408b2d4eec93909934454d54"
  },
  "packages/server/src/sim/vision.ts": {
    "bytes": 4504,
    "sha256": "25838e435b6e5282d31b28758e1955d36c8118086700e1e6497a979647287e56"
  },
  "packages/server/src/sim/weapons.ts": {
    "bytes": 17776,
    "sha256": "581ba4cf9ae93af5d3753cbb3cdf6b823bfaf730448edab7669e6c6d84c86f26"
  },
  "packages/shared/src/constants.ts": {
    "bytes": 46007,
    "sha256": "51ce4dd800ec868abee525fb1ae375688066f336972a7da878644df1235924e7"
  },
  "packages/shared/src/mods.ts": {
    "bytes": 23134,
    "sha256": "10e9dcd3d7417c4fe85d1c36ef33afe5abf7a5703a59b42a3a825a66aa4efaff"
  },
  "packages/shared/src/weapons.ts": {
    "bytes": 15391,
    "sha256": "2f22f037502fe63fae6b47f20408cfd35ebc72bfea081194ae8d18cfc21df99b"
  },
  "packages/shared/src/policies.ts": {
    "bytes": 13185,
    "sha256": "3a08aef58ae780bb2417781e735ff75c310de08db43b47a742714bcf94619fbd"
  },
  "packages/shared/src/terrain.ts": {
    "bytes": 21947,
    "sha256": "5ee4fe11e793f83f3d095720ba1156a186c5c7704e864f2cad74503ab13a07d6"
  },
  "packages/shared/src/interp.ts": {
    "bytes": 20983,
    "sha256": "83cf2ac2359058b1e0497e636f83e36b1d60c97e13f81e15e6edf39d8f231eb4"
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
  "helper69": {
    "path": "parity/walk-hint/helpers/source.json",
    "bytes": 40317,
    "sha256": "a7b8feda1aca08fe20f5a46ee11f57959a2a186619caf73611a67cb086eaae06"
  },
  "player90": {
    "path": "parity/policy/bot-fight/source.json",
    "bytes": 467672,
    "sha256": "197fe5d24b6b34822a3ef76e2999d422e6127bbda1e8dfda0ba0af3ee5e2785e"
  }
};

function fail(message) { throw new Error(message); }
function sha(b) { return createHash("sha256").update(b).digest("hex"); }
function parseArgs() {
  const out = new Map(), allowed = new Set(["--source-root", "--tool-root", "--output", "--expected-head"]);
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i], value = process.argv[i + 1];
    if (!allowed.has(key) || out.has(key) || !value) fail("unknown/duplicate/missing argument " + key);
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
function relativePath(rel) {
  if (!rel || rel.startsWith("/") || rel.includes("\\") || rel.split("/").some(p => !p || p === "." || p === "..")) fail("unsafe relative path " + rel);
  return rel;
}
const args = parseArgs();
if (resolve(args.get("--source-root")) !== SOURCE_ROOT || resolve(args.get("--tool-root")) !== TOOL_ROOT) fail("unexpected project/tool root before filesystem access");
const sourceRoot = noLinksAbsolute(SOURCE_ROOT), toolRoot = noLinksAbsolute(TOOL_ROOT);
const expectedHead = args.get("--expected-head");
if (!/^[0-9a-f]{40}$/.test(expectedHead)) fail("expected-head must be the Root-reviewed full code seal");
if (process.version !== "v22.23.4" || process.platform !== "darwin" || process.arch !== "arm64") fail("unexpected host Node runtime");
if (resolve(process.execPath) !== HOST_NODE || noLinksAbsolute(HOST_NODE, true) !== HOST_NODE || sha(readFileSync(HOST_NODE)) !== HOST_SHA) fail("host Node binary pin mismatch");
const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0" };
function git(argv) { return execFileSync("/usr/bin/git", ["-c", "core.fsmonitor=false", "-C", sourceRoot, ...argv], { env: gitEnv, maxBuffer: 64 * 1024 * 1024 }); }
function requireHead() { if (git(["rev-parse", "HEAD"]).toString("utf8").trim() !== expectedHead) fail("working HEAD is not approved immutable code seal"); }
requireHead(); git(["merge-base", "--is-ancestor", BASE, expectedHead]);
function blob(ref, rel) { return git(["show", ref + ":" + relativePath(rel)]); }
function frozen(rel) {
  relativePath(rel); const p = noLinksAbsolute(join(sourceRoot, rel), true), bytes = readFileSync(p);
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
  const p = noLinksAbsolute(join(toolRoot, relativePath(rel)), true), b = readFileSync(p);
  if (sha(b) !== TOOL_HASHES[rel]) fail("pinned tool changed " + rel);
  return p;
}
for (const rel of Object.keys(TOOL_HASHES)) tool(rel);
for (const [rel, expected] of Object.entries(SELECTED)) pin(rel, expected);
for (const [rel, expected] of Object.entries(METADATA)) pin(rel, expected);
const runtimeBytes = frozen(RUNTIME), verifyBytes = frozen(VERIFY), driverBytes = frozen("tools/walk-hint-fixtures/boundaries-build.mjs");
frozen(ENTRY);
for (const x of Object.values(RELATED)) pin(x.path, x);
// Only one previously nonexistent offline-<nonce> parent is allowed. Create it ourselves,
// never follow/reuse caller-created parents. All writes below are exclusive and no-follow.
const evidence = noLinksAbsolute(join(sourceRoot, "docs/evidence/walk-hint-helper-boundaries"));
const output = resolve(args.get("--output")), runRoot = dirname(output);
const runName = relative(evidence, runRoot);
if (!/^offline-[A-Za-z0-9_-]{1,80}$/.test(runName) || output !== join(evidence, runName, "prepared")) fail("output must be exact fresh offline-<nonce>/prepared");
if (existsSync(runRoot)) fail("offline run root exists; refuse reuse/deletion");
mkdirSync(runRoot, { mode: 0o700 }); noLinksAbsolute(runRoot);
mkdirSync(output, { mode: 0o700 });
const captured = join(runRoot, "captured"); mkdirSync(captured, { mode: 0o700 });
function writeNew(name, bytes) {
  if (name.includes("/") || !/^[A-Za-z0-9_.-]+$/.test(name)) fail("unsafe output filename");
  noLinksAbsolute(output);
  const fd = openSync(join(output, name), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); } finally { closeSync(fd); }
}
process.env.ESBUILD_BINARY_PATH = tool("@esbuild/darwin-arm64/bin/esbuild");
delete process.env.NODE_OPTIONS; delete process.env.NODE_PATH;
const esbuild = createRequire(import.meta.url)(tool("esbuild/lib/main.js"));
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
  name: "boundaries-frozen-resolver",
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
      const bytes = readFileSync(tool("@colyseus/schema/build/index.mjs"));
      loads.set("npm:@colyseus/schema/build/index.mjs", { path: "npm:@colyseus/schema/build/index.mjs", bytes: bytes.length, sha256: sha(bytes), executedBytes: bytes.length, executedSha256: sha(bytes), instrumentation: null });
      return { contents: bytes, loader: "js", resolveDir: dirname(schemaPath) };
    });
    b.onLoad({ filter: /.*/, namespace: "file" }, args => {
      const { path, rel } = sourcePath(args.path); checkMetadataAncestors(dirname(path));
      const original = frozen(rel);
      const append = rel === INSTRUMENT_REL ? APPEND_EXPORT : "", executed = append ? Buffer.concat([original, Buffer.from(append)]) : original;
      loads.set(rel, { path: rel, bytes: original.length, sha256: sha(original), executedBytes: executed.length,
        executedSha256: sha(executed), instrumentation: append ? { append, sha256: sha(append) } : null });
      return { contents: executed, loader: /\.(?:ts|mts)$/.test(path) ? "ts" : path.endsWith(".json") ? "json" : "js", resolveDir: dirname(path) };
    });
  },
};
const built = await esbuild.build({ entryPoints: [join(sourceRoot, ENTRY)], absWorkingDir: sourceRoot,
  tsconfig: join(sourceRoot, "tsconfig.base.json"), bundle: true, write: false, platform: "node", format: "esm",
  metafile: true, sourcemap: false, logLevel: "silent", nodePaths: [], plugins: [plugin] });
if (built.errors.length || built.outputFiles.length !== 1 || built.outputFiles[0].contents.length > MAX_BUNDLE_BYTES) fail("unexpected/budget-exceeding build output");
const metaInputs = new Set(Object.keys(built.metafile.inputs).map(key => {
  if (key === "pinned-schema:@colyseus/schema/build/index.mjs") return "npm:@colyseus/schema/build/index.mjs";
  return sourcePath(resolve(sourceRoot, key)).rel;
}));
if (metaInputs.size !== loads.size || [...metaInputs].some(key => !loads.has(key))) fail("metafile and exact loaded closure disagree");
for (const output of Object.values(built.metafile.outputs)) for (const imp of output.imports)
  if (imp.external && !EXTERNALS.has(imp.path)) fail("unapproved emitted external " + imp.path);
requireHead();
for (const load of loads.values()) {
  const b = load.path.startsWith("npm:") ? readFileSync(tool("@colyseus/schema/build/index.mjs")) : frozen(load.path);
  if (sha(b) !== load.sha256 || b.length !== load.bytes) fail("loaded input changed during build " + load.path);
}
for (const [rel, expected] of Object.entries(METADATA)) pin(rel, expected);
for (const rel of resolutionMetadata) {
  if (existsSync(join(sourceRoot, rel))) {
    if (!METADATA[rel]) fail("compiler metadata appeared during build " + rel);
    pin(rel, METADATA[rel]);
  }
}
for (const rel of [ENTRY, RUNTIME, VERIFY, "tools/walk-hint-fixtures/boundaries-build.mjs"]) frozen(rel);
for (const x of Object.values(RELATED)) pin(x.path, x);
const bundle = built.outputFiles[0].contents, meta = Buffer.from(JSON.stringify(built.metafile, null, 2) + "\n");
const outputPin = (path, b) => ({ path, bytes: b.length, sha256: sha(b) });
const manifest = { format: "rh-walk-hint-boundary-build/2", base: BASE, code: expectedHead, image: IMAGE,
  host: { node: process.version, platform: process.platform, arch: process.arch, sha256: HOST_SHA },
  driver: { bytes: driverBytes.length, sha256: sha(driverBytes) }, compiler: { version: "0.28.2", files: TOOL_HASHES },
  configuration: METADATA, resolutionMetadataChecked: [...resolutionMetadata].sort(), selectedSource: SELECTED, related: RELATED,
  loadedInputs: [...loads.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  outputs: { scenario: outputPin("scenario.mjs", bundle), runtime: outputPin("boundaries-runtime.mjs", runtimeBytes),
    verify: outputPin("boundaries-verify.mjs", verifyBytes), metafile: outputPin("metafile.json", meta) },
  limits: { maxContexts: 24, maxCorpusBytes: 2 * 1024 * 1024, maxBundleBytes: MAX_BUNDLE_BYTES },
  externals: [...EXTERNALS],
  contextPolicy: "declared source method contexts, not earned World/Full/native evidence; path direction isolation may remain OPEN",
  readset: { selectedSource: Object.keys(SELECTED).map(rel => ({ host: join(sourceRoot, rel), container: "/repo/" + rel })),
    related: Object.values(RELATED).map(x => ({ host: join(sourceRoot, x.path), container: "/repo/" + x.path })),
    prep: ["scenario.mjs", "boundaries-runtime.mjs", "boundaries-verify.mjs", "metafile.json", "build-manifest.json"] } };
writeNew("scenario.mjs", bundle); writeNew("metafile.json", meta); writeNew("boundaries-runtime.mjs", runtimeBytes); writeNew("boundaries-verify.mjs", verifyBytes);
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n"); writeNew("build-manifest.json", manifestBytes);
console.log(JSON.stringify({ mode: "build-only", code: expectedHead, output, captured, bundleSha256: sha(bundle), manifestSha256: sha(manifestBytes),
  loadedInputs: loads.size, next: "STOP: Root must inspect generated closure and pin manifest/bundle before any container execution" }));

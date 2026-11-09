// Phase A host-only builder for P15. CODE-ONLY, NOT EXECUTED. Imports Node builtins and the exact
// independently pinned esbuild installation; never imports/executes the scenario or World.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";

const HOST_NODE = "v22.23.4", HOST_PLATFORM = "darwin", HOST_ARCH = "arm64";
const SOURCE_ROOT = "/Users/nevinmckinnon/Documents/Projects/RogueHalla-bot-own-timings";
const TOOL_ROOT = "/Users/nevinmckinnon/Documents/Projects/RogueHalla/node_modules";
const HOST_NODE_BIN = "/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/map-styled-bench/npm-cache/_npx/361c55be1121897e/node_modules/node/bin/node";
const TOOL_HASHES = {
  "esbuild/lib/main.js": "61ec0ba144ff93f4bf0e96ad6fab6f430ede0aa13e27ace8063ed63ba416b3cd",
  "esbuild/package.json": "9d0bc453f4e791553c4cc2298ba023b409241fd9801e494741666eb0f6051490",
  "@esbuild/darwin-arm64/bin/esbuild": "10b6243df618d374bb2d5c9cfbe7052e1405f6aa4e53a6164f11a91b9f2e1384",
  "@colyseus/schema/build/index.mjs": "c5d2c222121377565fda9799c7e1b852c70a21877136498add79795f2055face",
  "@colyseus/schema/package.json": "e132bda166931370e39bddc3e03f778734e957f964134b6f2baa09f66ddd225d",
};
const SCENARIO = "tools/bot-protection-cues-fixtures/scenario.mts";
const RUNTIME = "tools/bot-protection-cues-fixtures/runtime.mjs";
const VERIFY = "tools/bot-protection-cues-fixtures/verify.mjs";
const CONTROLS = "tools/bot-protection-cues-fixtures/controls.mjs";
const MAP = "tools/ability-fixtures/born-input.json";
const CRITICAL = [
  "packages/server/src/sim/arena.ts", "packages/server/src/sim/weapons.ts", "packages/server/src/sim/targeting.ts",
  "packages/server/src/sim/step.ts", "packages/server/src/sim/inputs.ts", "packages/server/src/sim/gameplay.ts",
  "packages/server/src/sim/world.ts", "packages/server/src/sim/combatant.ts", "packages/server/src/sim/step.ts",
  "packages/server/src/bots/brain/perception.ts", "packages/server/src/bots/brain/memory.ts",
  "packages/server/src/bots/brain/vision.ts", "packages/server/src/bots/brain/frames.ts",
  "packages/server/src/rooms/FxChannel.ts", "packages/shared/src/schema.ts", "packages/shared/src/constants.ts",
  "packages/shared/src/interp.ts", "packages/shared/src/mods.ts",
];
const SOURCE_PREFIXES = ["packages/server/src/", "packages/shared/src/", "tools/bot-protection-cues-fixtures/"];
function sha(b) { return createHash("sha256").update(b).digest("hex"); }
function arg(n) { const i = process.argv.indexOf(n); if (i < 0 || i === process.argv.length - 1) throw new Error("missing " + n); return process.argv[i + 1]; }
function real(p) { return realpathSync(p); }
function gitBlob(rel) { return execFileSync("/usr/bin/git", ["-C", sourceRoot, "show", "HEAD:" + rel], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }); }
function verifyGit(rel) { const disk = readFileSync(join(sourceRoot, rel)); const blob = Buffer.from(gitBlob(rel), "utf8"); if (!disk.equals(blob)) throw new Error("disk differs from HEAD: " + rel); return sha(disk); }
function tool(rel) { const b = readFileSync(join(TOOL_ROOT, rel)); if (sha(b) !== TOOL_HASHES[rel]) throw new Error("tool pin mismatch " + rel); return join(TOOL_ROOT, rel); }
function allowed(rel) { return SOURCE_PREFIXES.some((p) => rel.startsWith(p)); }
const sourceRoot = real(arg("--source-root")), toolRoot = real(arg("--tool-root")), output = resolve(arg("--output"));
if (sourceRoot !== SOURCE_ROOT || toolRoot !== TOOL_ROOT) throw new Error("unexpected source/tool root");
if (process.version !== HOST_NODE || process.platform !== HOST_PLATFORM || process.arch !== HOST_ARCH) throw new Error("unexpected host Node");
const evidenceRoot = join(sourceRoot, "docs/evidence/bot-protection-cues");
if (!output.startsWith(evidenceRoot + sep) || !output.endsWith(sep + "prepared")) throw new Error("output must be a fresh prepared child of " + evidenceRoot);
if (existsSync(output)) throw new Error("refusing existing output " + output);
for (const rel of Object.keys(TOOL_HASHES)) tool(rel);
for (const rel of [SCENARIO, RUNTIME, VERIFY, CONTROLS, MAP]) verifyGit(rel);
const critical = Object.fromEntries(CRITICAL.map((rel) => [rel, verifyGit(rel)]));
mkdirSync(output, { recursive: false, mode: 0o755 });
process.env.ESBUILD_BINARY_PATH = tool("@esbuild/darwin-arm64/bin/esbuild");
delete process.env.NODE_OPTIONS; delete process.env.NODE_PATH;
const require = createRequire(import.meta.url);
const esbuild = require(tool("esbuild/lib/main.js"));
const schemaPath = tool("@colyseus/schema/build/index.mjs"), schemaReal = real(schemaPath);
const loaded = [];
const plugin = { name: "p15-reviewed-resolver", setup(b) {
  b.onResolve({ filter: /^@raid\/shared(?:\/.*)?$/ }, (a) => { const s = a.path.slice("@raid/shared".length); const rel = s === "" ? "packages/shared/src/index.ts" : s === "/schema" ? "packages/shared/src/schema.ts" : s === "/telemetry" ? "packages/shared/src/telemetry.ts" : null; if (!rel) throw new Error("disallowed shared subpath " + a.path); return { path: join(sourceRoot, rel) }; });
  b.onResolve({ filter: /^@colyseus\/schema$/ }, () => ({ path: schemaPath }));
  b.onResolve({ filter: /^node:/ }, () => ({ external: true }));
  b.onResolve({ filter: /^[^./]/ }, (a) => { throw new Error("unexpected bare import " + a.path + " from " + a.importer); });
  b.onLoad({ filter: /.*/ }, (a) => {
    const p = real(a.path);
    if (p === schemaReal) { const bytes = readFileSync(p); if (sha(bytes) !== TOOL_HASHES["@colyseus/schema/build/index.mjs"]) throw new Error("schema source mismatch"); loaded.push({ path: "npm:@colyseus/schema/build/index.mjs", bytes: bytes.length, sha256: sha(bytes) }); return { contents: bytes, loader: "js" }; }
    if (!p.startsWith(sourceRoot + sep)) throw new Error("input outside source root " + p);
    const rel = relative(sourceRoot, p).split(sep).join("/");
    if (!allowed(rel) && rel !== MAP) throw new Error("disallowed input " + rel);
    const bytes = readFileSync(p); if (rel !== MAP) verifyGit(rel);
    loaded.push({ path: rel, bytes: bytes.length, sha256: sha(bytes) });
    return { contents: bytes, loader: rel.endsWith(".ts") ? "ts" : rel.endsWith(".mjs") ? "js" : rel.endsWith(".json") ? "json" : "js" };
  });
} };
const built = await esbuild.build({ entryPoints: [join(sourceRoot, SCENARIO)], absWorkingDir: sourceRoot, bundle: true, write: false, platform: "node", format: "esm", metafile: true, sourcemap: false, logLevel: "silent", nodePaths: [], plugins: [plugin] });
if (built.outputFiles.length !== 1 || built.errors.length) throw new Error("expected one scenario bundle");
const bundle = built.outputFiles[0].text, bundleSha = sha(bundle);
for (const rel of Object.keys(critical)) verifyGit(rel);
for (const rel of [SCENARIO, RUNTIME, VERIFY, CONTROLS, MAP]) verifyGit(rel);
writeFileSync(join(output, "scenario.mjs"), bundle);
const copies = {};
for (const [name, rel] of [["runtime.mjs", RUNTIME], ["verify.mjs", VERIFY], ["controls.mjs", CONTROLS]]) { const b = readFileSync(join(sourceRoot, rel)); writeFileSync(join(output, name), b); copies[name] = { bytes: b.length, sha256: sha(b), source: rel }; }
const meta = JSON.stringify(built.metafile, null, 2) + "\n"; writeFileSync(join(output, "metafile.json"), meta);
const manifest = {
  format: "rh-p15-protection-cues-build/1", code: "bb564d3b53728cbd205af375b5342eca466f3656",
  sourceRoot, toolRoot, hostRuntime: { node: process.version, platform: process.platform, arch: process.arch }, hostNodeBin: HOST_NODE_BIN,
  compiler: { package: "esbuild", version: "0.28.2", pins: TOOL_HASHES, binaryPath: process.env.ESBUILD_BINARY_PATH, schema: { version: "5.0.42", path: schemaPath, sha256: TOOL_HASHES["@colyseus/schema/build/index.mjs"] } },
  entry: SCENARIO, output: { scenario: { bytes: Buffer.byteLength(bundle), sha256: bundleSha }, copies, metafile: { bytes: Buffer.byteLength(meta), sha256: sha(meta) } },
  criticalSource: critical, loadedInputs: loaded, inputCount: loaded.length,
  mapInput: { path: MAP, bytes: readFileSync(join(sourceRoot, MAP)).length, sha256: sha(readFileSync(join(sourceRoot, MAP))) },
  config: { seed: 7, maxStepsPerCase: 96, totalMaxSteps: 1056, rewardSalt: [7, 6, 5, 4], questSalt: [3, 2, 1, 0], modules: { signatures: false, walkHints: false } },
  readset: { map: "/repo/" + MAP, criticalSource: CRITICAL.map((rel) => ({ path: "/repo/" + rel, sha256: critical[rel] })), prep: ["scenario.mjs", "runtime.mjs", "verify.mjs", "controls.mjs", "metafile.json", "build-manifest.json"] },
  expected: { note: "Root must independently supply expected manifest/bundle pins to runtime before Phase B; no automatic link.", runtimeBundleSha256: bundleSha },
  controls: { path: "controls.mjs", count: 6, status: "DEFINED_NOT_RUN" },
  envelope: { phaseA: "host-only compiler", phaseB: "runtime-only; no compiler/child/npm/tsx/network", image: "node@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292", docker: ["--pull=never", "--network=none", "--platform linux/amd64", "readonly root", "minimal exact mounts", "no HOME/config"] },
  limits: ["UNRUN code preparation only", "no source capture", "no controls/frozen", "P15/live/native already HELD"],
};
writeFileSync(join(output, "build-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ mode: "build-only", code: manifest.code, bundleSha256: bundleSha, bundleBytes: Buffer.byteLength(bundle), inputCount: loaded.length, copySha256: Object.fromEntries(Object.entries(copies).map(([k, v]) => [k, v.sha256])) }));

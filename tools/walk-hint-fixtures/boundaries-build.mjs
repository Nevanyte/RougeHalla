// Host-only boundary compiler. Imports Node builtins and the exact pinned esbuild installation only.
// It never imports the scenario, World code, or executes application modules. Writes only a fresh
// authorized preparation directory under docs/evidence/walk-hint-helper-boundaries/offline-*/prepared.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";

const EXPECTED_HOST_NODE = "v22.23.4";
const EXPECTED_HOST_PLATFORM = "darwin";
const EXPECTED_HOST_ARCH = "arm64";
const EXPECTED_SOURCE_ROOT = "/Users/nevinmckinnon/Documents/Projects/RogueHalla-bot-own-timings";
const EXPECTED_TOOL_ROOT = "/Users/nevinmckinnon/Documents/Projects/RogueHalla/node_modules";
const TOOL_HASHES = {
  "esbuild/lib/main.js": "61ec0ba144ff93f4bf0e96ad6fab6f430ede0aa13e27ace8063ed63ba416b3cd",
  "esbuild/package.json": "9d0bc453f4e791553c4cc2298ba023b409241fd9801e494741666eb0f6051490",
  "esbuild/bin/esbuild": "10b6243df618d374bb2d5c9cfbe7052e1405f6aa4e53a6164f11a91b9f2e1384",
  "@esbuild/darwin-arm64/bin/esbuild": "10b6243df618d374bb2d5c9cfbe7052e1405f6aa4e53a6164f11a91b9f2e1384",
  "@colyseus/schema/build/index.mjs": "c5d2c222121377565fda9799c7e1b852c70a21877136498add79795f2055face",
  "@colyseus/schema/package.json": "e132bda166931370e39bddc3e03f778734e957f964134b6f2baa09f66ddd225d",
};
const SCENARIO_ENTRY = "tools/walk-hint-fixtures/boundaries-scenario.mts";
const RUNTIME_ENTRY = "tools/walk-hint-fixtures/boundaries-runtime.mjs";
const VERIFY_ENTRY = "tools/walk-hint-fixtures/boundaries-verify.mjs";
const SELECTED_SOURCE = {
  "packages/server/src/sim/walkHint.ts": "9030f17e7e76a5dda94bba76347e2993a5265d8d36e145b9d1f889f3f988af16",
  "packages/server/src/sim/gameplay.ts": "70f6f2b67571783f3042309bef01dc75aabd2656c59a184d0f97c9c0a8b8cf78",
  "packages/server/src/sim/step.ts": "5ff90451b4b27b12ddfe8175745cf38892eaf07a851282c904076edc46896634",
  "packages/server/src/sim/status.ts": "55bc525be1ac832f04b0f134cee6769b0b99f4d45ce182ec7db9d3670ba35642",
  "packages/server/src/sim/targeting.ts": "13125287cec7cd39f550af50e1d18c15d3146357f249cfe3beeb9e00a334f0fd",
  "packages/server/src/sim/combatant.ts": "3c2fac6ed6fbee82802c5bea86b0131d36e8ebf86eceb2c1a99ce58664fa7e60",
  "packages/server/src/sim/movement.ts": "86ebd2205a0af4608ed484317bea3723bb378b3e138954a44140e340adab1f93",
  "packages/server/src/sim/world.ts": "b98376a7f022ec6f9b681e368d62c18fbe524d95408b2d4eec93909934454d54",
  "packages/shared/src/constants.ts": "51ce4dd800ec868abee525fb1ae375688066f336972a7da878644df1235924e7",
  "packages/shared/src/mods.ts": "10e9dcd3d7417c4fe85d1c36ef33afe5abf7a5703a59b42a3a825a66aa4efaff",
  "packages/shared/src/weapons.ts": "2f22f037502fe63fae6b47f20408cfd35ebc72bfea081194ae8d18cfc21df99b",
  "packages/shared/src/policies.ts": "3a08aef58ae780bb2417781e735ff75c310de08db43b47a742714bcf94619fbd",
  "packages/shared/src/terrain.ts": "5ee4fe11e793f83f3d095720ba1156a186c5c7704e864f2cad74503ab13a07d6",
};
const RELATED = {
  helper69: { path: "parity/walk-hint/helpers/source.json", sha256: "a7b8feda1aca08fe20f5a46ee11f57959a2a186619caf73611a67cb086eaae06" },
  player90: { path: "parity/policy/bot-fight/source.json", sha256: "197fe5d24b6b34822a3ef76e2999d422e6127bbda1e8dfda0ba0af3ee5e2785e" },
};
const ALLOWED_PREFIXES = ["packages/server/src/", "packages/shared/src/", "tools/walk-hint-fixtures/"];
function sha(s) { return createHash("sha256").update(s).digest("hex"); }
function arg(name) { const i = process.argv.indexOf(name); if (i < 0 || i === process.argv.length - 1) throw new Error("missing " + name); return process.argv[i + 1]; }
function real(path) { return realpathSync(path); }
function gitBlob(root, rel) { return execFileSync("/usr/bin/git", ["-C", root, "show", "HEAD:" + rel], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); }
function toolFile(toolRoot, rel) { const p = join(toolRoot, rel); const b = readFileSync(p); const h = sha(b); if (TOOL_HASHES[rel] !== h) throw new Error("tool hash mismatch " + rel + " " + h); return p; }
function allowedRel(rel) { return ALLOWED_PREFIXES.some((p) => rel.startsWith(p)); }
function verifyGitFile(root, rel) {
  const p = join(root, rel); const b = readFileSync(p); const blob = Buffer.from(gitBlob(root, rel), "utf8");
  if (!b.equals(blob)) throw new Error("working source differs from HEAD blob: " + rel);
  return sha(b);
}
const sourceRoot = real(arg("--source-root"));
const toolRoot = real(arg("--tool-root"));
const output = resolve(arg("--output"));
if (sourceRoot !== EXPECTED_SOURCE_ROOT) throw new Error("unexpected source root " + sourceRoot);
if (toolRoot !== EXPECTED_TOOL_ROOT) throw new Error("unexpected tool root " + toolRoot);
if (process.version !== EXPECTED_HOST_NODE || process.platform !== EXPECTED_HOST_PLATFORM || process.arch !== EXPECTED_HOST_ARCH) throw new Error("unexpected host runtime " + process.version + " " + process.platform + "/" + process.arch);
const evidenceRoot = join(sourceRoot, "docs/evidence/walk-hint-helper-boundaries");
if (!output.startsWith(evidenceRoot + sep) || !output.endsWith(sep + "prepared")) throw new Error("output must be a fresh prepared child of " + evidenceRoot);
if (existsSync(output)) throw new Error("output already exists; refusing to modify or delete it: " + output);
for (const rel of Object.keys(TOOL_HASHES)) toolFile(toolRoot, rel);
for (const rel of Object.keys(SELECTED_SOURCE)) { const final = verifyGitFile(sourceRoot, rel); if (SELECTED_SOURCE[rel] !== final) throw new Error("selected source hash mismatch " + rel); }
for (const rel of [SCENARIO_ENTRY, RUNTIME_ENTRY, VERIFY_ENTRY]) verifyGitFile(sourceRoot, rel);
for (const rel of Object.values(RELATED)) { const p = join(sourceRoot, rel.path); const h = sha(readFileSync(p)); if (h !== rel.sha256) throw new Error("related corpus hash mismatch " + rel.path); }
mkdirSync(output, { recursive: false, mode: 0o755 });
mkdirSync(join(output, "logs"), { recursive: false, mode: 0o755 });
process.env.ESBUILD_BINARY_PATH = toolFile(toolRoot, "@esbuild/darwin-arm64/bin/esbuild");
delete process.env.NODE_OPTIONS;
delete process.env.NODE_PATH;
const require = createRequire(import.meta.url);
const esbuild = require(toolFile(toolRoot, "esbuild/lib/main.js"));
const schemaPath = toolFile(toolRoot, "@colyseus/schema/build/index.mjs");
const schemaReal = real(schemaPath);
const loaded = [];
const allowPath = (args, p) => {
  const r = real(p);
  if (r.startsWith(sourceRoot + sep)) {
    const rel = relative(sourceRoot, r).split(sep).join("/");
    if (!allowedRel(rel)) throw new Error("disallowed source input: " + rel);
    return { path: r, namespace: "file" };
  }
  if (r === schemaReal) return { path: r, namespace: "file" };
  throw new Error("disallowed input outside source/tool roots: " + p);
};
const plugin = {
  name: "boundaries-reviewed-resolver",
  setup(b) {
    b.onResolve({ filter: /^\/repo\// }, (args) => ({ path: join(sourceRoot, args.path.slice("/repo/".length)) }));
    b.onResolve({ filter: /^@raid\/shared(?:\/.*)?$/ }, (args) => {
      const suffix = args.path.slice("@raid/shared".length);
      const rel = suffix === "" ? "packages/shared/src/index.ts" : suffix === "/schema" ? "packages/shared/src/schema.ts" : suffix === "/telemetry" ? "packages/shared/src/telemetry.ts" : null;
      if (!rel) throw new Error("disallowed @raid/shared subpath: " + args.path);
      return { path: join(sourceRoot, rel) };
    });
    b.onResolve({ filter: /^@colyseus\/schema$/ }, () => ({ path: schemaPath }));
    b.onResolve({ filter: /^node:/ }, () => ({ external: true }));
    b.onResolve({ filter: /^[^./]/ }, (args) => { throw new Error("unexpected bare import: " + args.path + " from " + args.importer); });
    b.onLoad({ filter: /.*/ }, (args) => {
      const p = allowPath(args, args.path);
      const buf = readFileSync(p.path);
      let rel = relative(sourceRoot, p.path).split(sep).join("/");
      const diskSha = sha(buf);
      if (p.path === schemaReal) { if (diskSha !== TOOL_HASHES["@colyseus/schema/build/index.mjs"]) throw new Error("schema source changed"); }
      else { verifyGitFile(sourceRoot, rel); }
      loaded.push({ path: rel, bytes: buf.length, sha256: diskSha });
      return { contents: buf, loader: p.path.endsWith(".ts") ? "ts" : p.path.endsWith(".mjs") ? "js" : p.path.endsWith(".json") ? "json" : "js" };
    });
  },
};
const built = await esbuild.build({
  entryPoints: [join(sourceRoot, SCENARIO_ENTRY)],
  absWorkingDir: sourceRoot,
  bundle: true, write: false, platform: "node", format: "esm", metafile: true, sourcemap: false,
  logLevel: "silent", nodePaths: [], plugins: [plugin],
});
if (built.outputFiles.length !== 1 || built.errors.length > 0) throw new Error("expected one boundary bundle");
const bundleText = built.outputFiles[0].text;
const bundleSha = sha(bundleText);
for (const rel of Object.keys(SELECTED_SOURCE)) verifyGitFile(sourceRoot, rel);
for (const rel of [SCENARIO_ENTRY, RUNTIME_ENTRY, VERIFY_ENTRY]) verifyGitFile(sourceRoot, rel);
if (existsSync(join(output, "scenario.mjs"))) throw new Error("refusing to overwrite scenario.mjs");
writeFileSync(join(output, "scenario.mjs"), bundleText);
writeFileSync(join(output, "metafile.json"), JSON.stringify(built.metafile, null, 2) + "\n");
const runtimeText = readFileSync(join(sourceRoot, RUNTIME_ENTRY));
const verifyText = readFileSync(join(sourceRoot, VERIFY_ENTRY));
writeFileSync(join(output, "boundaries-runtime.mjs"), runtimeText);
writeFileSync(join(output, "boundaries-verify.mjs"), verifyText);
const manifest = {
  format: "rh-walk-hint-boundary-build/1",
  base: "70433a9834ccf082b5ca449dca0fd4319cd072ca",
  sourceRoot, toolRoot, hostRuntime: { node: process.version, platform: process.platform, arch: process.arch },
  compiler: { package: "esbuild", version: "0.28.2", files: TOOL_HASHES, binaryPath: process.env.ESBUILD_BINARY_PATH },
  schema: { version: "5.0.42", path: schemaPath, sha256: TOOL_HASHES["@colyseus/schema/build/index.mjs"] },
  options: { entry: SCENARIO_ENTRY, bundle: true, write: false, platform: "node", format: "esm", metafile: true, sourcemap: false, nodePaths: [], plugins: ["boundaries-reviewed-resolver"] },
  outputs: {
    scenario: { path: "scenario.mjs", bytes: Buffer.byteLength(bundleText), sha256: bundleSha },
    runtime: { path: "boundaries-runtime.mjs", bytes: runtimeText.length, sha256: sha(runtimeText) },
    verify: { path: "boundaries-verify.mjs", bytes: verifyText.length, sha256: sha(verifyText) },
    metafile: { path: "metafile.json", bytes: readFileSync(join(output, "metafile.json")).length, sha256: sha(readFileSync(join(output, "metafile.json"))) },
  },
  selectedSource: SELECTED_SOURCE,
  related: RELATED,
  loadedInputs: loaded,
  selectedSourceCount: Object.keys(SELECTED_SOURCE).length,
  loadedInputCount: loaded.length,
  readset: {
    selectedSource: Object.keys(SELECTED_SOURCE).map((rel) => ({ host: join(sourceRoot, rel), container: "/repo/" + rel })),
    related: Object.values(RELATED).map((x) => ({ host: join(sourceRoot, x.path), container: "/repo/" + x.path, sha256: x.sha256 })),
    prep: ["scenario.mjs", "build-manifest.json", "boundaries-runtime.mjs", "boundaries-verify.mjs", "metafile.json"],
  },
  contextPolicy: "no scenario/World import on the host compiler; runtime imports only the frozen relative bundle; selected source pins are baseline, loadedInputs is the actual compiled closure",
  corrections: { priorSourceFileCount: 14, correctedSourceFileCount: 17, priorPlayerCorpusBytesTypo: 46672, correctedPlayerCorpusBytes: 467672 },
};
writeFileSync(join(output, "build-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ mode: "build", output, bundleSha256: bundleSha, bundleBytes: Buffer.byteLength(bundleText), loadedInputs: loaded.length, selectedSource: Object.keys(SELECTED_SOURCE).length }));

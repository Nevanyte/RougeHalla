// Phase B runtime only. CODE-ONLY, NOT EXECUTED. Imports only the frozen relative scenario/verifier
// after validating Root-supplied expected manifest, scenario and runtime pins. No compiler/child/npm/tsx.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = new URL(".", import.meta.url).pathname;
function sha(b) { return createHash("sha256").update(b).digest("hex"); }
function arg(name) { const pref = name + "="; const eq = process.argv.find((x) => x.startsWith(pref)); if (eq) return eq.slice(pref.length); const i = process.argv.indexOf(name); if (i < 0 || i === process.argv.length - 1) throw new Error("missing " + name); return process.argv[i + 1]; }
if (process.version !== "v22.23.4" || process.platform !== "linux" || process.arch !== "x64") throw new Error("unpinned runtime " + process.version + " " + process.platform + "/" + process.arch);
const mode = arg("--mode");
if (mode !== "capture" && mode !== "check") throw new Error("unknown mode " + mode);
const output = arg("--output");
const expectedManifest = arg("--expected-manifest-sha256");
const expectedBundle = arg("--expected-bundle-sha256");
const expectedRuntime = arg("--expected-runtime-sha256");
const expectedVerify = arg("--expected-verify-sha256");
const manifestBytes = readFileSync(join(HERE, "build-manifest.json"));
if (sha(manifestBytes) !== expectedManifest) throw new Error("Root-supplied expected manifest pin does not match");
const manifest = JSON.parse(manifestBytes.toString("utf8"));
if (manifest.format !== "rh-p15-protection-cues-build/1") throw new Error("wrong manifest format");
const scenarioBytes = readFileSync(join(HERE, "scenario.mjs"));
if (sha(scenarioBytes) !== expectedBundle || manifest.output.scenario.sha256 !== expectedBundle) throw new Error("Root-supplied scenario pin mismatch");
const runtimeBytes = readFileSync(fileURLToPath(import.meta.url));
if (sha(runtimeBytes) !== expectedRuntime || manifest.output.copies["runtime.mjs"].sha256 !== expectedRuntime) throw new Error("Root-supplied runtime pin mismatch");
const verifyBytes = readFileSync(join(HERE, "verify.mjs"));
if (sha(verifyBytes) !== expectedVerify || manifest.output.copies["verify.mjs"].sha256 !== expectedVerify) throw new Error("Root-supplied verify pin mismatch");
for (const pin of manifest.readset.criticalSource) {
  const b = readFileSync(pin.path);
  if (sha(b) !== pin.sha256) throw new Error("critical source pin mismatch " + pin.path);
}
const map = readFileSync(manifest.readset.map);
if (sha(map) !== manifest.mapInput.sha256) throw new Error("map input pin mismatch");
if (mode === "check") {
  const rawPath = join(output, "observations-before-verification.json");
  const sourcePath = join(output, "source.json");
  for (const p of [rawPath, sourcePath]) if (!existsSync(p)) throw new Error("missing captured file " + p);
  const rawText = readFileSync(rawPath, "utf8");
  const raw = JSON.parse(rawText);
  const { verify } = await import(new URL("./verify.mjs", import.meta.url).href);
  const result = verify(raw);
  const expected = JSON.stringify(result.canonical, null, 2) + "\n";
  const actual = readFileSync(sourcePath, "utf8");
  if (expected !== actual) throw new Error("canonical boundary bytes differ from verified raw");
  console.log(JSON.stringify({ mode: "check", rawBytes: Buffer.byteLength(rawText), rawSha256: sha(rawText), sourceBytes: Buffer.byteLength(actual), sourceSha256: sha(actual), cases: raw.cases.length }));
} else {
  const { capture } = await import(new URL("./scenario.mjs", import.meta.url).href);
  const { verify } = await import(new URL("./verify.mjs", import.meta.url).href);
  const raw = capture();
  const rawText = JSON.stringify(raw, null, 2) + "\n";
  const rawPath = join(output, "observations-before-verification.json");
  const sourcePath = join(output, "source.json");
  const verificationPath = join(output, "verification.json");
  for (const p of [rawPath, sourcePath, verificationPath]) if (existsSync(p)) throw new Error("refusing to overwrite " + p);
  writeFileSync(rawPath, rawText, { flag: "wx" });
  const result = verify(raw);
  const canonicalText = JSON.stringify(result.canonical, null, 2) + "\n";
  const verificationText = JSON.stringify(result.verification, null, 2) + "\n";
  writeFileSync(sourcePath, canonicalText, { flag: "wx" });
  writeFileSync(verificationPath, verificationText, { flag: "wx" });
  console.log(JSON.stringify({ mode: "capture", rawBytes: Buffer.byteLength(rawText), rawSha256: sha(rawText), sourceBytes: Buffer.byteLength(canonicalText), sourceSha256: sha(canonicalText), verificationSha256: sha(verificationText), cases: raw.cases.length }));
}
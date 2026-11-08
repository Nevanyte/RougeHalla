#!/usr/bin/env node
// Recapture the six P-FACTION-4 scenarios with the pinned Linux x64 Node 22.23.4 runtime and require byte-exact fixtures.
// Run inside that container: node tools/hunt-fixtures/check.mjs
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const names = [
  "sentenced_hunt_select_and_death",
  "sentenced_hunt_mia_clears",
  "sentenced_hunt_hunter_death_clears",
  "sentenced_hunt_toward_move",
  "sentenced_hunt_vision_exception",
  "sentenced_hunt_run_end_clears",
];
if (process.version !== "v22.23.4" || process.platform !== "linux" || process.arch !== "x64") {
  throw new Error(`requires Linux x64 Node22.23.4, got ${process.platform}/${process.arch} ${process.version}`);
}
const manifest = JSON.parse(readFileSync(join(repo, "parity/hunt/source-manifest.json"), "utf8"));
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
for (const [name, expected] of Object.entries(manifest.sourceFiles)) {
  if (sha(join(repo, name)) !== expected) throw new Error(`source drift: ${name}`);
}
const out = mkdtempSync(join(tmpdir(), "rh-hunt-"));
try {
  for (const name of names) {
    execFileSync(process.execPath, ["--import", "tsx", "parity/legacy-capture/capture.ts", "--out", out, "--only", name], {
      cwd: repo,
      stdio: ["ignore", "ignore", "inherit"],
    });
    const got = readFileSync(join(out, `${name}.json`));
    const want = readFileSync(join(repo, "parity/fixtures", `${name}.json`));
    if (!got.equals(want)) throw new Error(`${name}: recapture is not byte-exact`);
    if (sha(join(out, `${name}.json`)) !== manifest.fixtures[`${name}.json`]) throw new Error(`${name}: manifest hash drift`);
  }
  console.log(`sentenced hunt: ${names.length} scenarios byte-exact`);
} finally {
  rmSync(out, { recursive: true, force: true });
}

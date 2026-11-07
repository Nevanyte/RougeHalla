// Confirms the pinned Plague-corpse source manifest and its actual-source fixtures.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("../..", import.meta.url).pathname);
const manifest = JSON.parse(readFileSync(join(root, "parity/corpses/source-manifest.json"), "utf8"));
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
let checks = 0;
for (const [path, want] of Object.entries(manifest.sourceFiles)) {
  if (sha(join(root, path)) !== want) throw new Error(`source hash changed: ${path}`);
  checks++;
}
for (const [name, want] of Object.entries(manifest.fixtures)) {
  const path = join(root, "parity/fixtures", name);
  if (sha(path) !== want) throw new Error(`fixture hash changed: ${name}`);
  const fx = JSON.parse(readFileSync(path, "utf8"));
  if (!fx.ticks?.length || !fx.ticks.every((t) => t.corpses)) throw new Error(`missing corpse diagnostics: ${name}`);
  if (fx.parity === "slice" && fx.legacyConfig.rustSlice !== "plague-corpses/1") throw new Error(`wrong slice: ${name}`);
  checks++;
}
const fixtures = readdirSync(join(root, "parity/fixtures")).filter((n) => n.startsWith("corpse_")).sort();
if (fixtures.join(",") !== Object.keys(manifest.fixtures).sort().join(",")) throw new Error("fixture inventory drift");
console.log(`Plague corpse source manifest: ${checks} checks, ${fixtures.length} fixtures, ${Object.keys(manifest.sourceFiles).length} source files`);

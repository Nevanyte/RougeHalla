// Compare a recapture with the committed tree, ignoring provenance alone. Added/deleted fixtures are changes too.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const generatedArg = process.argv.indexOf("--generated");
const generated = generatedArg < 0 ? undefined : resolve(process.argv[generatedArg + 1]);
const baseline = generatedArg < 0 ? process.argv[2] ?? "HEAD" : "HEAD";
const roots = ["parity/fixtures", "parity/maps"];
const files = (dir, base = dir) => !existsSync(dir) ? [] : readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name), base) : e.name.endsWith(".json") ? [relative(base, join(dir, e.name))] : []);
const committed = execFileSync("git", ["ls-tree", "-r", "--name-only", baseline, "--", ...roots], { cwd: repo, encoding: "utf8" }).trim().split("\n").filter(p => p.endsWith(".json") && (!generated || p !== "parity/maps/duel.map.json"));
const generatedFiles = generated ? files(generated) : [];
const current = generated ? generatedFiles.map(p => p.startsWith("maps/") ? `parity/${p}` : `parity/fixtures/${p}`) : roots.flatMap(root => files(join(repo, root)).map(p => `${root}/${p}`));
const currentPath = path => !generated ? join(repo, path) : join(generated, path.startsWith("parity/maps/") ? path.slice("parity/".length) : path.slice("parity/fixtures/".length));
const normalized = text => {
  const data = JSON.parse(text);
  delete data.legacyRevision;
  return data;
};
const changed = [];
for (const path of [...new Set([...committed, ...current])].sort()) {
  if (!committed.includes(path) || !current.includes(path)) { changed.push(path); continue; }
  const before = normalized(execFileSync("git", ["show", `${baseline}:${path}`], { cwd: repo, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
  const after = normalized(readFileSync(currentPath(path), "utf8"));
  if (!isDeepStrictEqual(before, after)) changed.push(path);
}
if (changed.length) {
  console.error(`Changed parity scenarios/maps:\n${changed.map(p => `  ${p}`).join("\n")}\na legacy rule changed: update Rust or re-record on purpose`);
  process.exitCode = 1;
} else console.log(`Recapture matches ${current.length} committed fixtures/maps (ignoring legacyRevision).`);

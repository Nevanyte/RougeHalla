import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export const here = dirname(fileURLToPath(import.meta.url));
export const repo = resolve(here, "../..");
export function stateDirectory() {
  const value = process.env.RH_MAP_BENCH_STATE;
  if (!value || !value.startsWith("/")) throw new Error("RH_MAP_BENCH_STATE must name an absolute external directory");
  const state = resolve(value);
  if (state === repo || state.startsWith(`${repo}/`)) throw new Error("RH_MAP_BENCH_STATE must be outside the repository");
  return state;
}
export function pinArrays() {
  const path = join(repo, "packages/shared/test/mapPins.ts");
  const source = readFileSync(path, "utf8");
  const extract = name => {
    const start = source.indexOf(`export const ${name}`);
    const end = source.indexOf("];", start);
    if (start < 0 || end < 0) throw new Error(`cannot find ${name} in mapPins.ts`);
    const values = [...source.slice(start, end).matchAll(/"([^"]+)"/g)].map(match => match[1]);
    if (values.length !== 200) throw new Error(`${name} expected 200 original pins; found ${values.length}`);
    return values;
  };
  return { sha256: createHash("sha256").update(source).digest("hex"), plain: extract("PINNED_PLAIN"), styled: extract("PINNED_MAPS") };
}
export function inventory() {
  const files = [];
  function walk(dir, predicate) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, predicate);
      else if (entry.isFile() && predicate(path)) files.push(path);
    }
  }
  walk(join(repo, "crates/rh-sim/src"), () => true);
  walk(join(repo, "packages/shared/src"), () => true);
  files.push(join(repo, "crates/rh-sim/Cargo.toml"), join(repo, "Cargo.toml"), join(repo, "Cargo.lock"), join(repo, "packages/shared/test/mapPins.ts"));
  walk(here, path => /\.(rs|mts|mjs|toml|lock)$/.test(path));
  const result = [...new Set(files)].sort().map(path => ({
    path: path.startsWith(repo + "/") ? relative(repo, path) : `tools/map-bench/${relative(here, path)}`,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  }));
  const snapshot = join(stateDirectory(), "pins.json");
  result.push({ path: "state/pins.json", sha256: createHash("sha256").update(readFileSync(snapshot)).digest("hex") });
  return result;
}
export function revision() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
}
function packageVersions(tree) {
  const found = new Map();
  for (const line of tree.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_.-]+) v([^ ]+)/);
    if (!match) continue;
    const versions = found.get(match[1]) ?? new Set();
    versions.add(match[2]);
    found.set(match[1], versions);
  }
  return found;
}
export function rhSimDependencyVersions() {
  const common = ["--prefix", "none", "--edges", "normal", "--offline", "--locked"];
  const rootTree = execFileSync("cargo", ["tree", "--manifest-path", join(repo, "Cargo.toml"), "-p", "rh-sim", ...common], { cwd: repo, encoding: "utf8" });
  const benchTree = execFileSync("cargo", ["tree", "--manifest-path", join(here, "Cargo.toml"), ...common], { cwd: repo, encoding: "utf8" });
  const rootPackages = packageVersions(rootTree);
  const benchPackages = packageVersions(benchTree);
  const shared = {};
  for (const [name, versions] of rootPackages) {
    if (name === "rh-sim") continue;
    const candidate = benchPackages.get(name);
    if (versions.size !== 1 || !candidate?.has([...versions][0])) {
      throw new Error(`standalone lock does not match root rh-sim dependency ${name}: root=${[...versions].join(",")} standalone=${[...(candidate ?? [])].join(",")}`);
    }
    shared[name] = [...versions][0];
  }
  return Object.fromEntries(Object.entries(shared).sort(([a], [b]) => a.localeCompare(b, "en")));
}

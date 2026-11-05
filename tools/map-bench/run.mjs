import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { here, inventory, pinArrays, repo, revision, rhSimDependencyVersions, stateDirectory } from "./source.mjs";

const state = stateDirectory();
mkdirSync(state, { recursive: true });
const logPath = join(state, "run.log");
const chunks = [];
const log = value => { chunks.push(value); process.stdout.write(value); };
try {
  if (process.version !== "v22.23.4" || process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error(`requires native Darwin arm64 Node v22.23.4; got ${process.platform}/${process.arch} ${process.version}`);
  }
  const pinData = pinArrays();
  const pinSnapshot = JSON.parse(readFileSync(join(state, "pins.json"), "utf8"));
  if (pinSnapshot.format !== "rh-map-bench-pins/1" || pinSnapshot.mapPinsSha256 !== pinData.sha256 || JSON.stringify(pinSnapshot.plain) !== JSON.stringify(pinData.plain.slice(0, 40)) || JSON.stringify(pinSnapshot.styled) !== JSON.stringify(pinData.styled.slice(0, 40))) {
    throw new Error("prepared pins snapshot does not match unchanged mapPins.ts");
  }
  const sourceFingerprint = inventory();
  const sourceRevision = revision();
  const buildManifest = JSON.parse(readFileSync(join(state, "build-source.json"), "utf8"));
  const resolvedVersions = rhSimDependencyVersions();
  if (buildManifest.revision !== sourceRevision || buildManifest.pins_sha256 !== pinData.sha256 || JSON.stringify(buildManifest.source_fingerprint) !== JSON.stringify(sourceFingerprint) || JSON.stringify(buildManifest.rh_sim_dependency_versions) !== JSON.stringify(resolvedVersions) || buildManifest.release_debug !== 1) {
    throw new Error("source inputs differ from last release build; run prepare.mjs after source freeze");
  }
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }).trim().length > 0;
  const cpu = execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"], { encoding: "utf8" }).trim();
  if (!cpu.includes("Apple M5 Pro")) throw new Error(`expected Apple M5 Pro, got ${cpu}`);
  const cpuCount = Number(execFileSync("sysctl", ["-n", "hw.ncpu"], { encoding: "utf8" }).trim());
  const memoryBytes = Number(execFileSync("sysctl", ["-n", "hw.memsize"], { encoding: "utf8" }).trim());
  const osVersion = execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim();
  const env = { ...process.env, RH_MAP_BENCH_STATE: state };
  const rust = spawnSync(join(state, "target/release/rh-map-styled-bench"), { cwd: repo, env, encoding: "utf8" });
  if (rust.status !== 0) throw new Error(`Rust benchmark exited ${rust.status}: ${rust.stderr}`);
  writeFileSync(join(state, "rust-results.json"), rust.stdout);
  const tsOut = join(state, "typescript-results.json");
  const ts = spawnSync(process.execPath, ["--import", "tsx", join(here, "ts-bench.mts"), tsOut], { cwd: repo, env, encoding: "utf8" });
  if (ts.status !== 0) throw new Error(`TypeScript benchmark exited ${ts.status}: ${ts.stderr}`);
  if (ts.stdout) log(ts.stdout);
  if (ts.stderr) log(ts.stderr);
  const result = {
    format: "rh-map-styled-release-benchmark/1",
    runtime: { rustc: execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim(), cargo: execFileSync("cargo", ["--version"], { encoding: "utf8" }).trim(), node: process.version, tsx: JSON.parse(readFileSync(join(repo, "node_modules/tsx/package.json"), "utf8")).version },
    revision: sourceRevision,
    dirty,
    mapPinsSha256: pinData.sha256,
    rust_sim_dependency_versions: resolvedVersions,
    release_profile: { debug: 1 },
    source_fingerprint: sourceFingerprint,
    hardware: { cpu, logical_cpu_count: cpuCount, memory_bytes: memoryBytes, operating_system: `macOS ${osVersion}`, platform: process.platform, native_architecture: process.arch },
    configuration: { measured_seeds: Array.from({ length: 40 }, (_, i) => i), warmups_per_mode: 5, alternating_first_mode_by_seed_parity: true, clock_scope: "certified call only; hash and pin check outside timing", fps_inference: false },
    rust: JSON.parse(rust.stdout),
    typescript: JSON.parse(readFileSync(tsOut, "utf8")),
  };
  if (JSON.stringify(inventory()) !== JSON.stringify(sourceFingerprint) || revision() !== sourceRevision || pinArrays().sha256 !== pinData.sha256) throw new Error("source tree or pins changed during measurement; discard this run");
  const output = join(state, "result.json");
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  log(`Wrote ${output}\n`);
} catch (error) {
  log(`ERROR: ${error?.stack ?? error}\n`);
  process.exitCode = 1;
} finally {
  writeFileSync(logPath, chunks.join(""));
}

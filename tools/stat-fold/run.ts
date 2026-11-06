import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { coverageFor, coverageRequirements, generateInventory } from "./inventory.ts";
import { captureCase } from "./oracle.ts";
import {
  BASE_COMMIT, FORMAT, PRESET_COUNTS, parseCaseSpec, parseCorpusCase, semanticKey,
  type CaseInput, type CaseSpec, type Corpus, type CorpusCase, type Preset, type Provenance,
} from "./schema.ts";

type RunPreset = Exclude<Preset, "canonical">;
export interface RunOptions {
  command: RunPreset;
  preset: RunPreset;
  count: number;
  batchSize: number;
  workers: 1 | 2;
  timeoutMs: number;
}
export interface CaseOptions {
  command: "case";
  preset: RunPreset;
  id: string;
  count: 1;
  batchSize: 1;
  workers: 1;
  timeoutMs: number;
}
export type CliOptions = RunOptions | CaseOptions;
export interface RunSummary {
  status: "verified";
  preset: RunPreset;
  verified: number;
  batches: number;
  batchSize: number;
  workers: 1 | 2;
  durationMs: number;
  id?: string;
}

interface Batch {
  index: number;
  offset: number;
  specs: CaseSpec[];
  corpusPath: string;
  failurePath: string;
}
interface ProcessFailure {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const root = fileURLToPath(new URL("../..", import.meta.url));
const sourcePaths = [
  "packages/shared/src/mods.ts", "packages/shared/src/effects.ts", "packages/shared/src/chestBoosts.ts",
  "packages/shared/src/constants.ts", "packages/shared/src/cards.ts", "tools/stat-fold/float.ts",
  "tools/stat-fold/schema.ts", "tools/stat-fold/inventory.ts", "tools/stat-fold/oracle.ts",
  "tools/stat-fold/capture.ts", "tools/stat-fold/run.ts",
];
const usage = [
  "usage:",
  "  node --import tsx tools/stat-fold/run.ts ci [--count 4096] [--batch-size 1..256] [--workers 1] [--timeout-ms MS]",
  "  node --import tsx tools/stat-fold/run.ts soak [--count 100000] [--batch-size 1..256] [--workers 1|2] [--timeout-ms MS]",
  "  node --import tsx tools/stat-fold/run.ts case --preset ci|soak --id ID",
].join("\n");

function positiveInteger(value: string, flag: string): number {
  if (!/^[0-9]+$/.test(value)) throw new Error(`${flag}: expected a nonnegative integer\n${usage}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${flag}: out of range\n${usage}`);
  return parsed;
}
function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag}: missing value\n${usage}`);
  return value;
}
function defaults(preset: RunPreset): Omit<RunOptions, "command" | "preset"> {
  return {
    count: PRESET_COUNTS[preset], batchSize: 128, workers: preset === "ci" ? 1 : 2,
    timeoutMs: preset === "ci" ? 120000 : 300000,
  };
}

export function parseCliArgs(args: string[]): CliOptions {
  const command = args[0];
  if (command !== "ci" && command !== "soak" && command !== "case") throw new Error(`unknown or missing command\n${usage}`);
  if (command === "case") {
    let preset: RunPreset | undefined;
    let id: string | undefined;
    const seen = new Set<string>();
    for (let i = 1; i < args.length; i += 1) {
      const flag = args[i];
      if (flag !== "--preset" && flag !== "--id") throw new Error(`unknown argument ${flag}\n${usage}`);
      if (seen.has(flag)) throw new Error(`duplicate argument ${flag}\n${usage}`);
      seen.add(flag);
      const value = requiredValue(args, i, flag);
      i += 1;
      if (flag === "--preset") {
        if (value !== "ci" && value !== "soak") throw new Error(`unknown preset ${value}\n${usage}`);
        preset = value;
      } else {
        if (value.length === 0) throw new Error("--id: empty value");
        id = value;
      }
    }
    if (preset === undefined) throw new Error(`case: missing --preset\n${usage}`);
    if (id === undefined) throw new Error(`case: missing --id\n${usage}`);
    const match = /^(ci|soak)-([0-9]{5})$/.exec(id);
    if (match === null || match[1] !== preset || Number(match[2]) >= PRESET_COUNTS[preset]) {
      throw new Error(`case: id does not belong to ${preset}\n${usage}`);
    }
    return { command, preset, id, count: 1, batchSize: 1, workers: 1, timeoutMs: defaults(preset).timeoutMs };
  }

  const out: RunOptions = { command, preset: command, ...defaults(command) };
  const allowed = new Set(["--count", "--batch-size", "--workers", "--timeout-ms"]);
  const seen = new Set<string>();
  for (let i = 1; i < args.length; i += 1) {
    const flag = args[i];
    if (!allowed.has(flag)) throw new Error(`unknown argument ${flag}\n${usage}`);
    if (seen.has(flag)) throw new Error(`duplicate argument ${flag}\n${usage}`);
    seen.add(flag);
    const value = positiveInteger(requiredValue(args, i, flag), flag);
    i += 1;
    switch (flag) {
      case "--count": out.count = value; break;
      case "--batch-size": out.batchSize = value; break;
      case "--workers": out.workers = value as 1 | 2; break;
      case "--timeout-ms": out.timeoutMs = value; break;
    }
  }
  if (out.count !== PRESET_COUNTS[command]) throw new Error(`--count: ${command} requires exactly ${PRESET_COUNTS[command]}\n${usage}`);
  if (out.batchSize < 1 || out.batchSize > 256) throw new Error(`--batch-size: expected 1..256\n${usage}`);
  if (command === "ci" ? out.workers !== 1 : out.workers !== 1 && out.workers !== 2) {
    throw new Error(`--workers: ${command} requires ${command === "ci" ? "1" : "1 or 2"}\n${usage}`);
  }
  if (out.timeoutMs < 1) throw new Error(`--timeout-ms: expected a positive integer\n${usage}`);
  return out;
}

export function validateInventory(preset: RunPreset, inventory: CaseSpec[] = generateInventory(preset)): CaseSpec[] {
  if (!Array.isArray(inventory) || inventory.length !== PRESET_COUNTS[preset]) {
    throw new Error(`${preset}: expected exactly ${PRESET_COUNTS[preset]} cases, got ${Array.isArray(inventory) ? inventory.length : "non-array"}`);
  }
  const ids = new Set<string>();
  const semantics = new Set<string>();
  inventory.forEach((testCase, index) => {
    parseCaseSpec(testCase, `cases[${index}]`);
    const expectedId = `${preset}-${index.toString().padStart(5, "0")}`;
    if (testCase.id !== expectedId) throw new Error(`cases[${index}].id: expected ${expectedId}, got ${testCase.id}; missing, extra, duplicate, or reordered inventory`);
    if (ids.has(testCase.id)) throw new Error(`cases: duplicate id ${testCase.id}`);
    ids.add(testCase.id);
    const key = semanticKey({ kind: testCase.kind, input: testCase.input } as CaseInput);
    if (semantics.has(key)) throw new Error(`cases: semantic duplicate ${testCase.id}`);
    semantics.add(key);
  });
  coverageFor(inventory);
  return inventory;
}

function replay(preset: RunPreset, id: string): string {
  return `node --import tsx tools/stat-fold/run.ts case --preset ${preset} --id ${id}`;
}
function commandArgs(options: CliOptions): string[] {
  if (options.command === "case") return ["case", "--preset", options.preset, "--id", options.id];
  return [
    options.command, "--count", String(options.count), "--batch-size", String(options.batchSize),
    "--workers", String(options.workers), "--timeout-ms", String(options.timeoutMs),
  ];
}
function captureProvenance(options: CliOptions, rawArgs?: string[]): Provenance {
  const canonicalRuntime = process.version === "v22.23.4" && process.platform === "linux" && process.arch === "x64";
  return {
    mode: canonicalRuntime ? "canonical" : "diagnostic",
    command: `node --import tsx tools/stat-fold/run.ts ${(rawArgs ?? commandArgs(options)).join(" ")}`,
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    base: BASE_COMMIT,
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    sources: sourcePaths.map((path) => ({
      path, sha256: createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex"),
    })),
  };
}
function batchCoverage(cases: readonly CorpusCase[]): Array<{ id: string; count: number }> {
  const counts = new Map<string, number>();
  for (const testCase of cases) for (const tag of testCase.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return coverageRequirements().flatMap((id) => {
    const count = counts.get(id) ?? 0;
    return count === 0 ? [] : [{ id, count }];
  });
}
function captureBatch(preset: RunPreset, specs: CaseSpec[], provenance: Provenance): Corpus {
  const cases = specs.map((spec) => parseCorpusCase({ ...spec, expected: captureCase(spec) }, `case ${spec.id}`));
  return { format: FORMAT, preset, provenance, coverage: batchCoverage(cases), cases };
}
function remaining(deadline: number): number {
  const milliseconds = deadline - Date.now();
  if (milliseconds <= 0) throw new Error("stat-fold total timeout expired");
  return milliseconds;
}
function outputTail(value: string): string {
  return value.length <= 65536 ? value : `...${value.slice(-65535)}`;
}

async function buildTestExecutable(deadline: number): Promise<string> {
  const targetDir = process.env.RH_STAT_FOLD_TARGET_DIR ?? resolve(root, "target/stat-fold-differential");
  const args = [
    "test", "-p", "rh-sim", "--test", "stat_fold", "--no-run", "--jobs", "2", "--message-format=json", "--locked",
  ];
  let stdout = "";
  let stderr = "";
  await new Promise<void>((resolveBuild, rejectBuild) => {
    execFile("cargo", args, {
      cwd: root, encoding: "utf8", timeout: remaining(deadline), killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, CARGO_TARGET_DIR: targetDir },
    }, (error, buildStdout, buildStderr) => {
      stdout = buildStdout;
      stderr = buildStderr;
      if (error !== null) rejectBuild(new Error(`locked Cargo build failed: ${error.message}\n${outputTail(buildStderr)}`));
      else resolveBuild();
    });
  });
  const executables: string[] = [];
  for (const [index, line] of stdout.split(/\r?\n/).entries()) {
    if (line.length === 0) continue;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch (error) {
      throw new Error(`Cargo output line ${index + 1}: malformed JSON: ${(error as Error).message}`);
    }
    if (message === null || typeof message !== "object" || Array.isArray(message)) continue;
    const artifact = message as {
      reason?: unknown; executable?: unknown; target?: { name?: unknown; kind?: unknown };
    };
    if (artifact.reason !== "compiler-artifact" || artifact.target?.name !== "stat_fold") continue;
    const kinds = artifact.target.kind;
    if (!Array.isArray(kinds) || !kinds.includes("test") || typeof artifact.executable !== "string") continue;
    executables.push(artifact.executable);
  }
  if (executables.length !== 1) {
    throw new Error(`Cargo produced ${executables.length} stat_fold test executables; expected exactly one\n${outputTail(stderr)}`);
  }
  const executable = resolve(root, executables[0]);
  if (!existsSync(executable)) throw new Error(`Cargo test executable does not exist: ${executable}`);
  return executable;
}

class BatchFailure extends Error {
  constructor(message: string, readonly batch: Batch, readonly processFailure?: ProcessFailure) {
    super(message);
  }
}
export class RunFailure extends Error {
  constructor(message: string, readonly failurePath: string) {
    super(message);
  }
}

function runRustBatch(executable: string, batch: Batch, deadline: number, active: Set<ChildProcess>): Promise<void> {
  const timeoutMs = remaining(deadline);
  return new Promise((resolveBatch, rejectBatch) => {
    let timedOut = false;
    let spawnError: Error | undefined;
    let stdout = "";
    let stderr = "";
    const child = spawn(executable, ["--exact", "external_batch", "--nocapture"], {
      cwd: root,
      env: { ...process.env, RH_STAT_FOLD_BATCH: batch.corpusPath, RH_STAT_FOLD_FAILURE: batch.failurePath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    active.add(child);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout = outputTail(stdout + chunk); });
    child.stderr.on("data", (chunk: string) => { stderr = outputTail(stderr + chunk); });
    child.on("error", (error) => { spawnError = error; });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      active.delete(child);
      const processFailure = { code, signal, stdout, stderr, timedOut, spawnError };
      if (timedOut) {
        rejectBatch(new BatchFailure("Rust external batch exceeded the total timeout", batch, processFailure));
      } else if (spawnError !== undefined) {
        rejectBatch(new BatchFailure(`could not execute Rust external batch: ${spawnError.message}`, batch, processFailure));
      } else if (code !== 0 || existsSync(batch.failurePath)) {
        rejectBatch(new BatchFailure(
          `Rust external batch failed (exit ${code ?? signal ?? "unknown"})\n${outputTail(stderr || stdout)}`,
          batch, processFailure,
        ));
      } else {
        resolveBatch();
      }
    });
  });
}

function removeIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
/** Generated runner replay is valid only for an identified member of its actual batch. */
export function generatedReplay(preset: "ci" | "soak", specs: readonly CaseSpec[], evidence: unknown): string | null {
  if (evidence === null || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const failure = evidence as { id?: unknown; seed?: unknown };
  const spec = specs.find((entry) => entry.id === failure.id && entry.seed === failure.seed);
  return spec === undefined ? null : replay(preset, spec.id);
}

function writeRunnerFailure(
  options: CliOptions, temp: string, failurePath: string, error: unknown, stage: string, batch?: Batch,
): void {
  if (!existsSync(failurePath)) {
    const batchFailure = error instanceof BatchFailure;
    const spec = batchFailure ? batch?.specs[0] : undefined;
    const processFailure = batchFailure ? error.processFailure : undefined;
    writeFileSync(failurePath, `${JSON.stringify({
      format: "rh-stat-fold-runner-failure/1",
      stage,
      preset: options.preset,
      caseIndex: batchFailure ? batch?.offset ?? null : null,
      caseId: spec?.id ?? null,
      seed: spec?.seed ?? null,
      function: batchFailure ? "external_batch" : null,
      fieldPath: null,
      input: spec?.input ?? null,
      expected: null,
      actual: null,
      error: error instanceof Error ? error.message : String(error),
      process: processFailure ?? null,
      replay: spec === undefined ? null : replay(options.preset, spec.id),
    })}\n`, { flag: "w" });
  }
  else {
    const evidence = JSON.parse(readFileSync(failurePath, "utf8"));
    evidence.replay = generatedReplay(options.preset, batch?.specs ?? [], evidence);
    writeFileSync(failurePath, `${JSON.stringify(evidence)}\n`, { flag: "w" });
  }
  for (const entry of readdirSync(temp)) {
    if (resolve(temp, entry) !== resolve(failurePath)) rmSync(resolve(temp, entry), { recursive: true, force: true });
  }
}

export async function runStatFold(options: CliOptions, rawArgs?: string[]): Promise<RunSummary> {
  const started = Date.now();
  const deadline = started + options.timeoutMs;
  const temp = mkdtempSync(join(tmpdir(), "rh-stat-fold-"));
  const batches: Batch[] = [];
  let stage = "inventory";
  try {
    const inventory = validateInventory(options.preset);
    const specs = options.command === "case"
      ? inventory.filter((testCase) => testCase.id === options.id)
      : inventory;
    if (options.command === "case" && specs.length !== 1) throw new Error(`case ${options.id}: missing from freshly generated inventory`);
    stage = "batch";
    for (let offset = 0, index = 0; offset < specs.length; offset += options.batchSize, index += 1) {
      batches.push({
        index, offset, specs: specs.slice(offset, offset + options.batchSize),
        corpusPath: join(temp, `batch-${index.toString().padStart(5, "0")}.json`),
        failurePath: join(temp, `failure-${index.toString().padStart(5, "0")}.json`),
      });
    }
    stage = "build";
    remaining(deadline);
    const executable = await buildTestExecutable(deadline);
    stage = "provenance";
    const provenance = captureProvenance(options, rawArgs);
    stage = "batch";
    const active = new Set<ChildProcess>();
    let next = 0;
    let stopped = false;
    let firstFailure: unknown;
    const workers = Array.from({ length: options.workers }, async () => {
      while (!stopped) {
        const batch = batches[next];
        next += 1;
        if (batch === undefined) return;
        try {
          const corpus = captureBatch(options.preset, batch.specs, provenance);
          writeFileSync(batch.corpusPath, `${JSON.stringify(corpus)}\n`, { flag: "wx" });
          await runRustBatch(executable, batch, deadline, active);
          removeIfPresent(batch.corpusPath);
          removeIfPresent(batch.failurePath);
        } catch (error) {
          if (firstFailure === undefined) {
            firstFailure = error instanceof BatchFailure
              ? error
              : new BatchFailure(error instanceof Error ? error.message : String(error), batch);
            stopped = true;
            for (const child of active) child.kill("SIGKILL");
          }
        }
      }
    });
    await Promise.all(workers);
    if (firstFailure !== undefined) throw firstFailure;
    remaining(deadline);
    rmSync(temp, { recursive: true, force: true });
    return {
      status: "verified", preset: options.preset, verified: specs.length, batches: batches.length,
      batchSize: options.batchSize, workers: options.workers, durationMs: Date.now() - started,
      ...(options.command === "case" ? { id: options.id } : {}),
    };
  } catch (error) {
    const batch = error instanceof BatchFailure ? error.batch : undefined;
    const failurePath = batch?.failurePath ?? join(temp, "failure.json");
    writeRunnerFailure(options, temp, failurePath, error, error instanceof BatchFailure ? "batch" : stage, batch);
    throw new RunFailure(`${error instanceof Error ? error.message : String(error)}\nfailure evidence: ${failurePath}`, failurePath);
  }
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const rawArgs = process.argv.slice(2);
    const summary = await runStatFold(parseCliArgs(rawArgs), rawArgs);
    console.log(JSON.stringify(summary));
  } catch (error) {
    console.error(JSON.stringify({
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof RunFailure ? { failure: error.failurePath } : {}),
    }));
    process.exitCode = 1;
  }
}

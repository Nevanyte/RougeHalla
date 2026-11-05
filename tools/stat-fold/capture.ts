import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { coverageFor, coverageRequirements, generateInventory } from "./inventory.ts";
import { captureCase } from "./oracle.ts";
import { BASE_COMMIT, FORMAT, parseCorpus, type Corpus, type Preset, type Provenance } from "./schema.ts";

interface Options {
  preset: Preset;
  output?: string;
  check: boolean;
  diagnostic: boolean;
}
function usage(): string {
  return "usage: node --import tsx tools/stat-fold/capture.ts [--preset canonical|ci|soak] [--output PATH] [--check] [--diagnostic]";
}
function options(args: string[]): Options {
  const out: Options = { preset: "canonical", check: false, diagnostic: false };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!["--preset", "--output", "--check", "--diagnostic"].includes(arg)) throw new Error(`unknown argument ${arg}\n${usage()}`);
    if (seen.has(arg)) throw new Error(`duplicate argument ${arg}\n${usage()}`);
    seen.add(arg);
    if (arg === "--check") out.check = true;
    else if (arg === "--diagnostic") out.diagnostic = true;
    else {
      const value = args[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg}: missing value\n${usage()}`);
      if (arg === "--preset") {
        if (!["canonical", "ci", "soak"].includes(value)) throw new Error(`unknown preset ${value}\n${usage()}`);
        out.preset = value as Preset;
      } else {
        if (value.length === 0) throw new Error("--output: empty path");
        out.output = value;
      }
    }
  }
  if (out.check && out.diagnostic) throw new Error("--check cannot be combined with --diagnostic");
  if (out.check && out.preset !== "canonical") throw new Error("--check is only for the canonical corpus");
  if (out.diagnostic && out.output === undefined) throw new Error("diagnostic capture requires explicit --output");
  if (out.preset !== "canonical" && out.output === undefined) throw new Error(`${out.preset} capture is ephemeral and requires explicit --output`);
  return out;
}
function canonicalRuntime(): void {
  if (process.version !== "v22.23.4" || process.platform !== "linux" || process.arch !== "x64") {
    throw new Error(`canonical capture requires Linux x64 Node22.23.4; got ${process.platform} ${process.arch} ${process.version}; use --diagnostic --output PATH for host output`);
  }
}
const root = fileURLToPath(new URL("../..", import.meta.url));
const canonicalPath = resolve(root, "parity/stat-fold/canonical.json");
const sourcePaths = [
  "packages/shared/src/mods.ts", "packages/shared/src/effects.ts", "packages/shared/src/chestBoosts.ts", "packages/shared/src/constants.ts", "packages/shared/src/cards.ts",
  "tools/stat-fold/float.ts", "tools/stat-fold/schema.ts", "tools/stat-fold/inventory.ts", "tools/stat-fold/oracle.ts", "tools/stat-fold/capture.ts",
];
function provenance(mode: Provenance["mode"], preset: Preset, output: string | undefined): Provenance {
  const command = mode === "canonical"
    ? "node --import tsx tools/stat-fold/capture.ts --preset canonical"
    : `node --import tsx tools/stat-fold/capture.ts --preset ${preset} --diagnostic --output ${output}`;
  return {
    mode, command, commit: BASE_COMMIT, base: BASE_COMMIT,
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    sources: sourcePaths.map((path) => ({ path, sha256: createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex") })),
  };
}

const opts = options(process.argv.slice(2));
if (!opts.diagnostic) canonicalRuntime();
const destination = resolve(root, opts.output ?? "parity/stat-fold/canonical.json");
if (opts.diagnostic && destination === canonicalPath) throw new Error("diagnostic output can never replace canonical.json");
if (opts.check && destination !== canonicalPath) throw new Error("--check reads only parity/stat-fold/canonical.json");
const inventory = generateInventory(opts.preset);
const corpus: Corpus = {
  format: FORMAT, preset: opts.preset, provenance: provenance(opts.diagnostic ? "diagnostic" : "canonical", opts.preset, opts.output),
  coverage: coverageFor(inventory),
  cases: inventory.map((testCase) => ({ ...testCase, expected: captureCase(testCase) })),
};
parseCorpus(corpus, coverageRequirements());
const bytes = `${JSON.stringify(corpus)}\n`;
if (opts.check) {
  if (readFileSync(destination, "utf8") !== bytes) throw new Error("stat-fold canonical capture differs; no file was rewritten");
} else {
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes, { flag: "w" });
}
console.log(JSON.stringify({
  mode: corpus.provenance.mode, preset: opts.preset, cases: corpus.cases.length, coverage: corpus.coverage.length,
  bytes: Buffer.byteLength(bytes), output: relative(root, destination) || destination, checked: opts.check,
}));

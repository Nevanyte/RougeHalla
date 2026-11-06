import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import test from "node:test";
import { generateInventory } from "./inventory.ts";
import { generatedReplay, parseCliArgs, RunFailure, runStatFold, validateInventory } from "./run.ts";
import { PRESET_COUNTS, parseCorpus, type CaseSpec } from "./schema.ts";

test("CI and soak defaults retain the complete fixed inventories", () => {
  assert.deepEqual(parseCliArgs(["ci"]), {
    command: "ci", preset: "ci", count: 4096, batchSize: 128, workers: 1, timeoutMs: 120000,
  });
  assert.deepEqual(parseCliArgs(["soak"]), {
    command: "soak", preset: "soak", count: 100000, batchSize: 128, workers: 2, timeoutMs: 300000,
  });
  assert.equal(PRESET_COUNTS.ci, 4096);
  assert.equal(PRESET_COUNTS.soak, 100000);
  assert.equal(parseCliArgs(["ci", "--count", "4096", "--batch-size", "256", "--workers", "1"]).count, 4096);
  assert.equal(parseCliArgs(["soak", "--count", "100000", "--workers", "1"]).count, 100000);
});

test("runner arguments reject zero, partial counts, unknown, duplicate, missing, and extra values", () => {
  const invalid = [
    [], ["unknown"], ["ci", "--count", "0"], ["ci", "--count", "4095"], ["ci", "--count", "4097"],
    ["soak", "--count", "99999"], ["soak", "--count", "100001"], ["ci", "--batch-size", "0"],
    ["ci", "--batch-size", "257"], ["ci", "--batch-size", "1.5"], ["ci", "--workers", "0"],
    ["ci", "--workers", "2"], ["soak", "--workers", "3"], ["ci", "--timeout-ms", "0"],
    ["ci", "--count"], ["ci", "--count", "--workers", "1"], ["ci", "--unknown", "1"],
    ["ci", "extra"], ["ci", "--count", "4096", "--count", "4096"], ["soak", "--batch-size", "128", "--batch-size", "128"],
  ];
  for (const args of invalid) assert.throws(() => parseCliArgs(args), args.join(" "));
});

test("case replay syntax is closed and preset-specific", () => {
  assert.deepEqual(parseCliArgs(["case", "--preset", "ci", "--id", "ci-00000"]), {
    command: "case", preset: "ci", id: "ci-00000", count: 1, batchSize: 1, workers: 1, timeoutMs: 120000,
  });
  const soakCase = parseCliArgs(["case", "--id", "soak-99999", "--preset", "soak"]);
  assert.equal(soakCase.command, "case");
  if (soakCase.command === "case") assert.equal(soakCase.id, "soak-99999");
  const invalid = [
    ["case"], ["case", "--preset", "ci"], ["case", "--id", "ci-00000"],
    ["case", "--preset", "canonical", "--id", "canonical-00000"],
    ["case", "--preset", "ci", "--id", "soak-00000"], ["case", "--preset", "ci", "--id", "ci-04096"],
    ["case", "--preset", "ci", "--id", "ci-0"], ["case", "--preset", "ci", "--id", "ci-00000", "--count", "1"],
    ["case", "--preset", "ci", "--preset", "ci", "--id", "ci-00000"],
    ["case", "--preset", "ci", "--id"], ["case", "--preset", "ci", "--id", "ci-00000", "extra"],
  ];
  for (const args of invalid) assert.throws(() => parseCliArgs(args), args.join(" "));
});

test("full inventory validation rejects missing, extra, reordered, duplicate, and malformed cases", () => {
  const inventory = validateInventory("ci", generateInventory("ci"));
  assert.equal(inventory.length, 4096);
  assert.throws(() => validateInventory("ci", inventory.slice(1)), /exactly 4096/);
  assert.throws(() => validateInventory("ci", [...inventory, inventory[0]]), /exactly 4096/);
  assert.throws(() => validateInventory("ci", [inventory[1], inventory[0], ...inventory.slice(2)]), /reordered/);
  assert.throws(() => validateInventory("ci", inventory.map((testCase, index) => index === 1
    ? { ...testCase, id: inventory[0].id }
    : testCase)), /expected ci-00001/);
  assert.throws(() => validateInventory("ci", inventory.map((testCase, index) => index === 1
    ? { ...testCase, kind: inventory[0].kind, input: inventory[0].input } as CaseSpec
    : testCase)), /semantic duplicate/);
  assert.throws(() => validateInventory("ci", inventory.map((testCase, index) => index === 1
    ? { ...testCase, seed: "1" } as unknown as CaseSpec
    : testCase)), /seed/);
  assert.throws(() => validateInventory("ci", inventory.map((testCase, index) => index === 1
    ? { ...testCase, unknown: true } as unknown as CaseSpec
    : testCase)), /unknown key/);
});

test("Cargo spawn failure is build-stage evidence without first-case attribution", async () => {
  const originalPath = process.env.PATH;
  let failurePath: string | undefined;
  process.env.PATH = "";
  try {
    await assert.rejects(
      runStatFold(parseCliArgs(["case", "--preset", "ci", "--id", "ci-00000"])),
      (error) => {
        assert.ok(error instanceof RunFailure);
        failurePath = error.failurePath;
        return true;
      },
    );
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }
  assert.ok(failurePath !== undefined);
  try {
    const evidence = JSON.parse(readFileSync(failurePath, "utf8"));
    assert.equal(evidence.format, "rh-stat-fold-runner-failure/1");
    assert.equal(evidence.stage, "build");
    assert.match(evidence.error, /Cargo build failed/);
    for (const key of ["caseIndex", "caseId", "seed", "function", "fieldPath", "input", "expected", "actual", "replay"]) {
      assert.equal(evidence[key], null, key);
    }
  } finally {
    rmSync(dirname(failurePath), { recursive: true, force: true });
  }
});

test("one real external batch replays a freshly generated actual-source case", { timeout: 180000 }, async () => {
  const summary = await runStatFold(parseCliArgs(["case", "--preset", "ci", "--id", "ci-00000"]));
  assert.equal(summary.status, "verified");
  assert.equal(summary.verified, 1);
  assert.equal(summary.batches, 1);
  assert.equal(summary.id, "ci-00000");
});


test("source provenance requires the exact inventory and canonical runtime", () => {
  const corpus = JSON.parse(readFileSync("parity/stat-fold/canonical.json", "utf8"));
  parseCorpus(corpus);
  const badSources = [[], corpus.provenance.sources.slice(1),
    corpus.provenance.sources.map((source: unknown, i: number) => i === 0 ? { ...(source as object), path: "unrelated.ts" } : source),
    [...corpus.provenance.sources, corpus.provenance.sources[0]]];
  for (const sources of badSources) assert.throws(() => parseCorpus({ ...corpus, provenance: { ...corpus.provenance, sources } }));
  assert.throws(() => parseCorpus({ ...corpus, provenance: { ...corpus.provenance,
    runtime: { ...corpus.provenance.runtime, node: "v25.8.1" } } }));
});


test("generated replay identifies the actual failed batch member", () => {
  const specs = validateInventory("ci", generateInventory("ci")).slice(0, 2);
  assert.equal(generatedReplay("ci", specs, { id: specs[1].id, seed: specs[1].seed }),
    "node --import tsx tools/stat-fold/run.ts case --preset ci --id ci-00001");
  for (const bad of [null, [], {}, { id: specs[1].id }, { id: specs[1].id, seed: specs[1].seed + 1 },
    { id: "ci-09999", seed: specs[1].seed }]) assert.equal(generatedReplay("ci", specs, bad), null);
});

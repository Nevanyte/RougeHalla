import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  checkInventory,
  generateGaps,
  loadProtocolSources,
  presentationModules,
  protocolSymbols,
} from "./check-inventory.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const INVENTORY_PATH = resolve(ROOT, "docs/unity/presentation-inventory.json");
const REPORT_PATH = resolve(ROOT, "docs/unity/PROTOCOL_GAPS.md");
const CHECKER_PATH = resolve(ROOT, "tools/unity-readiness/check-inventory.mjs");
const inventory = JSON.parse(readFileSync(INVENTORY_PATH, "utf8"));
const protocolSources = loadProtocolSources(ROOT, inventory.protocol.revision);

function check(value = inventory, sources = protocolSources) {
  return checkInventory({ root: ROOT, inventory: value, protocolSources: sources });
}

function entry(value, id) {
  const found = value.entries.find((candidate) => candidate.id === id);
  assert.ok(found, id);
  return found;
}

test("checked-in inventory covers every module/protocol symbol and its generated report is exact", () => {
  const result = check();
  assert.deepEqual(result.errors, []);
  assert.ok(result.modules.length > 0);
  assert.deepEqual(result.modules, presentationModules(ROOT));
  assert.ok(result.symbols.size > 0);
  assert.equal(result.report, readFileSync(REPORT_PATH, "utf8"));
  assert.equal(result.report, generateGaps(inventory));
});

test("unknown and missing keys are rejected at every schema level", () => {
  const root = structuredClone(inventory);
  root.unexpected = true;
  assert.ok(check(root).errors.some((error) => error.includes("inventory has unknown key unexpected")));

  const nested = structuredClone(inventory);
  entry(nested, "map.collision").trigger.mystery = true;
  assert.ok(check(nested).errors.some((error) => error.includes("unknown key mystery")));

  const missing = structuredClone(inventory);
  delete entry(missing, "map.collision").privacy;
  assert.ok(check(missing).errors.some((error) => error.includes("missing key privacy")));
});

test("legacy source symbol and module removal are drift failures", () => {
  const symbol = structuredClone(inventory);
  entry(symbol, "map.collision").legacySources[0].symbol = "NoSuchLegacySymbol";
  assert.ok(check(symbol).errors.some((error) => error.includes("NoSuchLegacySymbol")));

  const coverage = structuredClone(inventory);
  entry(coverage, "render.projection-camera").legacySources = [entry(coverage, "render.projection-camera").legacySources[0]];
  assert.ok(check(coverage).errors.some((error) => error.includes("packages/client/src/render/CameraFollow.ts")));

  const exclusion = structuredClone(inventory);
  exclusion.intentionalExclusions[0].coveredBy = "no.such.entry";
  assert.ok(check(exclusion).errors.some((error) => error.includes("coveredBy is not an entry")));
});

test("unknown, reclassified and newly added protocol members fail closed", () => {
  const unknown = structuredClone(inventory);
  entry(unknown, "combat.hit-numbers-flash").trigger.symbol = "WireFx.NoSuchEvent";
  assert.ok(check(unknown).errors.some((error) => error.includes("WireFx.NoSuchEvent")));

  const unused = structuredClone(inventory);
  unused.protocolUnused = unused.protocolUnused.filter((item) => item.symbol !== "WireSelf.id");
  assert.ok(check(unused).errors.some((error) => error.includes("protocol symbol has no consumption or unused status: WireSelf.id")));

  const sources = { ...protocolSources };
  const path = "crates/rh-protocol/src/lib.rs";
  sources[path] = sources[path].replace("pub struct WireSelf {", "pub struct WireSelf {\n    pub future_cue: u32,");
  const added = check(inventory, sources);
  assert.ok(added.symbols.has("WireSelf.future_cue"));
  assert.ok(added.errors.some((error) => error.includes("WireSelf.future_cue")));
});

test("version and available/missing status drift are rejected", () => {
  const version = structuredClone(inventory);
  version.protocol.protocolVersion = 6;
  assert.ok(check(version).errors.some((error) => error.includes("protocolVersion 6 != inspected 7")));

  const status = structuredClone(inventory);
  entry(status, "combat.hit-numbers-flash").status = "missing-in-protocol";
  assert.ok(check(status).errors.some((error) => error.includes("missing-in-protocol needs an event or field")));

  const available = structuredClone(inventory);
  entry(available, "combat.windup").status = "available";
  assert.ok(check(available).errors.some((error) => error.includes("available cue cannot request")));
});

test("generated gaps retain exact per-mechanic events, fields and mechanics", () => {
  const report = generateGaps(inventory);
  assert.match(report, /## combat\.windup:/);
  assert.match(report, /WireFx\.Windup \{ by, weapon, a, ms \}/);
  assert.match(report, /## planning\.deal:/);
  assert.match(report, /PlanningView\.options\[\] \{ index, at, zone, walk_distance, walk_seconds \}/);
  assert.match(report, /## quest\.world-markers:/);
  assert.match(report, /Port quest definitions, acceptance, carriers, hidden offers and lifecycle/);
  assert.ok(!report.includes("## map.collision:"));

  const changed = structuredClone(inventory);
  entry(changed, "combat.windup").protocolNeeds.fields = ["WireFx.Windup.exact_test_field"];
  assert.match(generateGaps(changed), /WireFx\.Windup\.exact_test_field/);
});

test("CLI exits nonzero on drift and does not write generated output", () => {
  const temporary = mkdtempSync(resolve(ROOT, "tools/unity-readiness/.test-"));
  try {
    const changed = structuredClone(inventory);
    changed.extra = "drift";
    const input = resolve(temporary, "inventory.json");
    const output = resolve(temporary, "gaps.md");
    writeFileSync(input, JSON.stringify(changed));
    const result = spawnSync(process.execPath, [CHECKER_PATH, "--inventory", input, "--output", output], { cwd: ROOT, encoding: "utf8" });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /unknown key extra/);
    assert.throws(() => readFileSync(output, "utf8"), /ENOENT/, "failing CLI must not create generated output");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("CLI --check exits nonzero for stale generated output", () => {
  const temporary = mkdtempSync(resolve(ROOT, "tools/unity-readiness/.test-"));
  try {
    const output = resolve(temporary, "gaps.md");
    writeFileSync(output, "stale\n");
    const result = spawnSync(process.execPath, [CHECKER_PATH, "--inventory", INVENTORY_PATH, "--output", output, "--check"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /stale or missing/);
    assert.equal(readFileSync(output, "utf8"), "stale\n");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("protocol parser has no silent empty or missing source/type escape", () => {
  const symbols = protocolSymbols({ "crates/rh-protocol/src/lib.rs": "pub struct WireSelf { pub hp: f32, }" });
  assert.ok(symbols.has("WireSelf.hp"));
  for (const path of Object.keys(protocolSources)) {
    if (path !== "crates/rh-protocol/src/lib.rs") assert.ok(symbols.has(`${path}:missing-source`));
  }
  assert.ok(symbols.has("WireActor:missing-type"));
});

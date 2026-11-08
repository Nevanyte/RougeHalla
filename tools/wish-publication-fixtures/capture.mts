import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
  ABILITIES, ABILITY_IDS, abilityCooldownMs, chargesAt, nextChargeAt,
} from "../../packages/shared/src/abilities.ts";
import { version as nodeVersion } from "node:process";

assert.equal(nodeVersion, "v22.23.4");
assert.equal(process.platform, "linux");
assert.equal(process.arch, "x64");
assert(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === "--check"));
Math.random = () => { throw Error("undeclared randomness"); };

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const built = await build({
  absWorkingDir: repo,
  entryPoints: ["packages/client/src/ui/abilitySlot.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  loader: { ".css": "empty" },
});
const ui = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].contents).toString("base64")}`);

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const sourceFiles = [
  "packages/shared/src/abilities.ts",
  "packages/shared/src/constants.ts",
  "packages/client/src/ui/abilitySlot.ts",
  "packages/client/src/ui/combatTip.ts",
];
const harnessFiles = ["tools/wish-publication-fixtures/capture.mts", "tools/wish-publication-fixtures/capture.sh"];
const stockInputs = [
  { name: "zero_recharge_full", fullAt: 0, now: 0, max: 2, rechargeMs: 0 },
  { name: "zero_recharge_future", fullAt: 100, now: 0, max: 2, rechargeMs: 0 },
  { name: "zero_recharge_future_fractional", fullAt: 100.5, now: 0.5, max: 2, rechargeMs: 0 },
  { name: "blaze_one_charge", fullAt: 130_000, now: 100_000, max: 2, rechargeMs: 30_000 },
  { name: "blaze_empty", fullAt: 160_000, now: 110_000, max: 2, rechargeMs: 30_000 },
];
const stock = stockInputs.map((input) => ({
  input,
  charges: chargesAt(input.fullAt, input.now, input.max, input.rechargeMs),
  next: nextChargeAt(input.fullAt, input.now, input.max, input.rechargeMs),
}));

const cooldown = ABILITY_IDS.flatMap((ability) => [
  { training: false, wishCooldownMult: 1 },
  { training: true, wishCooldownMult: 2 },
].map((context) => ({
  input: { ability, context },
  output: abilityCooldownMs(ABILITIES[ability], 1, context),
})));

const base = (ability: typeof ABILITY_IDS[number], now: number, values: Record<string, unknown> = {}) => {
  const def = ABILITIES[ability];
  const input = {
    phase: "active", alive: true, ability: def, rank: 1,
    readyAt: now, cooldownLen: def.ranks[0].cooldownMs, effects: 0,
    blockedBy: def.blockedBy, castUntil: 0,
    ...values,
  };
  const model = ui.abilitySlotModel(input, now);
  return {
    state: model.state, charges: model.charges, maxCharges: model.maxCharges,
    secondsLeft: model.secondsLeft, sweep: model.sweep,
  };
};
const display = [
  { name: "full_at_absent_fallback", input: { ability: "blaze", now: 100_000, fullAt: undefined }, output: base("blaze", 100_000, { fullAt: undefined }) },
  { name: "full_at_null_fallback", input: { ability: "blaze", now: 100_000, fullAt: null }, output: base("blaze", 100_000, { fullAt: null }) },
  { name: "opening_lock", input: { ability: "blaze", now: 100_000, readyAt: 145_000, fullAt: 145_000, cooldownLen: 45_000 }, output: base("blaze", 100_000, { readyAt: 145_000, fullAt: 145_000, cooldownLen: 45_000 }) },
  { name: "blaze_partial", input: { ability: "blaze", now: 100_000, fullAt: 130_000 }, output: base("blaze", 100_000, { fullAt: 130_000 }) },
  { name: "blaze_empty", input: { ability: "blaze", now: 110_000, readyAt: 130_000, fullAt: 160_000 }, output: base("blaze", 110_000, { readyAt: 130_000, fullAt: 160_000 }) },
  { name: "training_blaze", input: { ability: "blaze", now: 0, training: true, readyAt: 5_000, fullAt: 5_000, cooldownLen: 5_000 }, output: base("blaze", 0, { training: true, readyAt: 5_000, fullAt: 5_000, cooldownLen: 5_000 }) },
];

const output = {
  format: "rh-wish-display-source/1",
  provenance: {
    runtime: "Node.js 22.23.4 linux amd64",
    image: "node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292",
    compiler: {
      tsx: JSON.parse(readFileSync("node_modules/tsx/package.json", "utf8")).version,
      esbuild: JSON.parse(readFileSync("node_modules/esbuild/package.json", "utf8")).version,
      packageLockSha256: hash(readFileSync("package-lock.json")),
    },
    sourceInventory: sourceFiles.map((path) => ({ path, sha256: hash(readFileSync(path)) })),
    harnessInventory: harnessFiles.map((path) => ({ path, sha256: hash(readFileSync(path)) })),
    capture: "Direct imports of legacy stock/cooldown helpers and the actual abilitySlotModel; no seeded game state or expected output injection.",
  },
  stock, cooldown, display,
};
const bytes = JSON.stringify(output, null, 2) + "\n";
const path = process.env.RH_WISH_DISPLAY_OUTPUT ?? "parity/abilities/wish-display.json";
if (process.argv[2] === "--check") assert.equal(readFileSync(path, "utf8"), bytes, "actual-source Wish display capture bytes");
else writeFileSync(path, bytes);
process.stdout.write(JSON.stringify({ stock: stock.length, cooldown: cooldown.length, display: display.length, sha256: hash(bytes) }) + "\n");

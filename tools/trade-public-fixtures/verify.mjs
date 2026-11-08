// Independent checker for the trade-public corpora. It does not recapture; capture.sh's --check does that. This script
// re-derives every canonical byte/hash from the checked-in files, re-runs the real enqueueClientMessage on every recorded
// door payload, and inspects the door/intake/action/schema/receiver bindings. Run in the pinned container:
//   node --import tsx tools/trade-public-fixtures/verify.mjs <out-dir> <repo-root>
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [outDir, repoRoot] = process.argv.slice(2);
if (!outDir || !repoRoot) { console.error("usage: verify.mjs <out-dir> <repo-root>"); process.exit(2); }
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const load = (p) => import(pathToFileURL(join(repoRoot, p)).href);
const read = (name) => readFileSync(join(outDir, name), "utf8");
const parse = (name) => JSON.parse(read(name));

assert.equal(process.version, "v22.23.4");
assert.equal(process.platform, "linux");
assert.equal(process.arch, "x64");
const manifest = parse("manifest.json");
assert.equal(manifest.image, "node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292");
const corpora = {};
for (const entry of manifest.files) {
  const text = read(entry.file);
  assert.equal(Buffer.byteLength(text, "utf8"), entry.bytes, entry.file + " bytes");
  assert.equal(sha256(text), entry.sha256, entry.file + " sha256");
  const corpus = JSON.parse(text);
  assert.equal(JSON.stringify(corpus) + "\n", text, entry.file + " canonical JSON.stringify + newline");
  const claimed = corpus.profile.captureSha256;
  delete corpus.profile.captureSha256;
  assert.equal(sha256(JSON.stringify(corpus)), claimed, entry.file + " captureSha256");
  assert.equal(corpus.profile.imageDigest, "sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292");
  assert.ok(corpus.profile.sourceClosure.sourceFileCount > 100);
  for (const p of ["packages/shared/src/schema.ts", "packages/shared/src/traders.ts", "packages/server/src/sim/inputs.ts", "packages/server/src/sim/traders.ts", "packages/client/src/ui/traderPanel.ts", "packages/client/src/render/TraderView.ts"]) {
    assert.ok(corpus.profile.sourceClosure.sourceFiles[p], entry.file + " source closure includes " + p);
  }
  corpora[entry.file] = corpus;
}
const doors = corpora["doors.json"];
const schema = corpora["schema-receivers.json"];
const wording = corpora["wording.json"];
const { InputQueue, enqueueClientMessage } = await load("packages/server/src/sim/inputs.ts");
const S = await load("packages/shared/src/index.ts");

// Door payload -> the exact queued action the real intake makes.
for (const c of doors.clientDoor.cases) {
  const sent = c.actual.sent ?? [];
  if (sent.length === 0) continue;
  const binding = c.actual.binding;
  assert.ok(binding, c.id + " sent payload must have a binding");
  const q = new InputQueue();
  assert.equal(enqueueClientMessage(q, sent[0].type, sent[0].payload), true, c.id + " real intake accepts the door payload");
  assert.deepEqual(q.drain().actions, binding.actions, c.id + " door payload queues exactly the recorded action");
  assert.equal(binding.actions[0].kind, "trade");
  assert.equal(binding.actions[0].trader, sent[0].payload.trader);
  assert.equal(binding.actions[0].pick, sent[0].payload.pick);
}
{
  const c = doors.clientDoor.cases.find((x) => x.id === "stats-options-and-click");
  assert.ok(c);
  assert.equal(c.actual.sent.length, 1);
  assert.equal(c.actual.sent[0].payload.trader, "trader-stats");
  assert.equal(c.actual.sent[0].payload.pick, 1);
  assert.equal(c.actual.offers.length, 3);
  assert.ok(c.actual.view.choices.every((x) => !x.disabled));
  assert.deepEqual(c.actual.view.choices.map((x) => x.text), c.actual.offers.map((o) => o.parsed.label));
}
{
  const c = doors.clientDoor.cases.find((x) => x.id === "pick2-disabled-gates");
  assert.equal(c.actual.noPotion.view.choices[2].disabled, true);
  assert.equal(c.actual.both.view.choices[2].disabled, true);
  assert.equal(c.actual.noPotion.sent.length, 0);
  assert.equal(c.actual.both.sent.length, 0);
}
{
  const c = doors.clientDoor.cases.find((x) => x.id === "committed-second-slot");
  assert.equal(c.actual.sent.length, 1);
  assert.deepEqual(c.actual.sent[0].payload, { trader: "trader-barter", pick: 2 });
  assert.deepEqual(c.actual.toasts, [{ to: "p0", text: "Make an empty weapon slot first" }]);
  assert.equal(c.actual.player.potionSmall, 1);
  assert.equal(c.actual.cooldownAfter.length, 0);
}
{
  const c = doors.clientDoor.cases.find((x) => x.id === "panel-visibility-gates");
  for (const k of ["far", "dead", "hidden", "blocked"]) assert.equal(c.actual[k].hidden, true, "panel gate " + k);
  assert.equal(c.actual.los, false);
  assert.ok(c.actual.distance <= c.actual.traderRange);
}
{
  const c = doors.clientDoor.cases.find((x) => x.id === "training-room-edge");
  assert.equal(c.actual.traders, 0);
  assert.equal(c.actual.tradeHandler, "undefined");
  assert.equal(c.actual.parsedTrade, true);
  assert.equal(c.actual.queued.length, 1);
}
{
  const c = doors.clientDoor.cases.find((x) => x.id === "trader-view-receiver");
  assert.equal(c.actual.visible.length, 2);
  assert.equal(c.actual.hidden.length, 0);
  assert.equal(c.actual.dead.length, 2);
  assert.ok(c.actual.dead.every((f) => !f.hint.visible));
  assert.ok(c.actual.visible.find((f) => f.id === "trader-barter").hint.visible === true);
}
for (const c of doors.intake.cases) {
  if (c.id === "per-tick-queue-cap") continue;
  if (c.returned) {
    assert.equal(c.actions.length, 1, c.id + " accepted rows queue one action");
    assert.equal(c.actions[0].kind, "trade");
  } else {
    assert.equal(c.actions.length, 0, c.id + " refused rows queue nothing");
  }
}
{
  const c = doors.intake.cases.find((x) => x.id === "per-tick-queue-cap");
  assert.equal(c.actions.length, 6);
  assert.equal(c.dropped, 2);
}
// Action cases: exact source refusal/success text and the state consequences.
const actions = new Map(doors.actions.cases.map((c) => [c.id, c]));
const toasts = (id) => (actions.get(id)?.actual.toasts ?? []).map((t) => t.text);
assert.ok(toasts("stat-trade")[0].startsWith("Stat trade: "));
assert.equal(actions.get("stat-trade").actual.player.tradeUsed, true);
assert.ok(actions.get("stat-trade").actual.player.tradeStats.length > 0);
assert.deepEqual(toasts("stat-repeat").slice(1), ["You already made your stat trade this run"]);
assert.equal(actions.get("stat-offer-roll").actual.offers.length, 3);
assert.ok(actions.get("stat-offer-roll").actual.offers.every((o) => o.parsed !== null));
assert.deepEqual(toasts("stat-no-offers-yet"), ["Wait for the trader's offers"]);
assert.ok(actions.get("stat-no-offers-yet").actual.offersAfterFirstStep.length === 3);
assert.deepEqual(toasts("barter-no-weapon"), ["Hold a weapon to trade"]);
assert.deepEqual(toasts("barter-full-pouch"), ["Your small potion pouch is full"]);
assert.deepEqual(toasts("barter-no-potion"), ["Bring a small healing potion"]);
assert.deepEqual(toasts("barter-both-slots"), ["Make an empty weapon slot first"]);
assert.deepEqual(toasts("barter-committed"), ["Make an empty weapon slot first"]);
assert.deepEqual(actions.get("barter-committed").actual.cooldownAfter, []);
assert.deepEqual(toasts("range-refusal"), ["Move closer to the trader"]);
assert.deepEqual(toasts("los-refusal"), ["Move closer to the trader"]);
assert.equal(actions.get("los-refusal").actual.los, false);
assert.deepEqual(toasts("dead-silent"), []);
assert.deepEqual(toasts("unknown-trader-silent"), []);
assert.deepEqual(toasts("stunned-silent"), []);
assert.deepEqual(toasts("order-cooldown-before-held"), ["Traded for Bow", "The villager is packing your last trade"]);
{
  const cycle = toasts("barter-cycle");
  assert.ok(cycle.includes("Traded for Bow"));
  assert.ok(cycle.includes("The villager is packing your last trade"));
  assert.ok(cycle.includes("Traded weapon for a small healing potion"));
  assert.ok(cycle.filter((t) => t.startsWith("Traded for ")).length >= 2);
}
assert.equal(actions.get("phase-ended-not-drained").actual.queueAfter, 1);
assert.deepEqual(actions.get("phase-ended-not-drained").actual.eventsThisStep, []);
// Schema and disclosure.
const kind = (name) => schema.schema.kinds.find((k) => k.name === name);
assert.equal(kind("TraderState").fields.length, 5);
assert.deepEqual(kind("TraderState").fields.map((f) => f.name).sort(), ["id", "kind", "name", "x", "y"]);
const tradeFields = kind("PlayerState (selected trade/body fields)").fields;
for (const name of ["tradeUsed", "tradeOffers", "tradeStats"]) assert.ok(tradeFields.some((f) => f.name === name && f.noSync === false), "public field " + name);
const rounds = new Map(schema.schema.rounds.map((r) => [r.label, r]));
assert.equal(rounds.get("after-offer-roll-before-trade").decoded.players[0].tradeUsed, false);
assert.equal(rounds.get("after-stat-trade").decoded.players[0].tradeUsed, true);
assert.equal(rounds.get("after-stat-trade").decoded.players[0].tradeOffers.length, 3);
assert.equal(rounds.get("after-stat-trade").decoded.players[0].tradeStats.length, 2);
assert.equal(rounds.get("after-stat-trade").decoded.players[1].tradeOffers.length, 0);
const matrix = new Map(schema.disclosure.matrix.map((m) => [m.id, m]));
assert.equal(matrix.get("trader-actor-public").classification, "PUBLIC ACTOR (no offer on the actor)");
assert.ok(matrix.get("player-trade-offers").classification.startsWith("SOURCE FINDING"));
assert.ok(matrix.get("player-trade-offers").actual.decodedP0.tradeOffers.length === 3);
assert.ok(matrix.get("player-trade-offers").actual.decodedP0.tradeStats.length > 0);
assert.equal(matrix.get("player-trade-offers").actual.decodedP1.tradeOffers.length, 0);
assert.equal(matrix.get("owner-barter-cooldown").actual.decodedPlayersWithDeadline.every((r) => r.hasDeadlineField === false), true);
assert.ok(matrix.get("owner-barter-cooldown").actual.cooldown.length > 0);
for (const r of schema.schema.rounds) assert.ok(r.sha256.length === 64 && r.bytes > 0);
// Wording: helper declarations vs runtime toasts.
assert.deepEqual(Object.keys(wording.helpers.tradeStatNames).sort(), ["ad", "ap", "armor", "attackSpeed", "maxHp", "moveSpeed", "shield"]);
assert.equal(wording.helpers.barterLabels.sword[0], "Give Sword → Bow");
assert.ok(wording.strings.some((s) => s.id === "panel-stats-description" && s.value.includes("Choose one permanent exchange")));
assert.ok(wording.strings.some((s) => s.id === "panel-barter-description" && s.value.includes("One trade every 5 seconds")));
for (const text of ["Move closer to the trader", "You already made your stat trade this run", "The villager is packing your last trade", "Bring a small healing potion", "Make an empty weapon slot first", "Hold a weapon to trade", "Your small potion pouch is full"]) {
  const row = wording.strings.find((s) => s.id === "runtime-string:" + text);
  assert.ok(row && row.runtime.length > 0, "runtime toast for " + text);
  assert.ok(row.runtime.every((t) => t.to === "p0" && t.text === text));
}
assert.ok(wording.runtimeToasts.every((t) => t.to === "p0"));
console.log(JSON.stringify({
  ok: true,
  corpora: manifest.files.map((f) => ({ file: f.file, bytes: f.bytes, sha256: f.sha256, captureSha256: f.captureSha256 })),
  doorCases: doors.clientDoor.cases.length,
  intakeCases: doors.intake.cases.length,
  actionCases: doors.actions.cases.length,
  schemaRounds: schema.schema.rounds.length,
  wordingStrings: wording.strings.length,
}));

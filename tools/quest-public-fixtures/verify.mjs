// Independent checker for the quest-public corpora. It does not recapture; capture.sh's --check does that. This script
// re-derives every canonical byte/hash from the checked-in files, re-runs the real enqueueClientMessage on every recorded
// door payload, and inspects the door/intake/action/schema/receiver bindings. Run in the pinned container:
//   node --import tsx tools/quest-public-fixtures/verify.mjs <out-dir> <repo-root>
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
  for (const p of ["packages/shared/src/schema.ts", "packages/server/src/sim/inputs.ts", "packages/server/src/sim/quests.ts", "packages/client/src/ui/questDialog.ts"]) {
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
  const q = new InputQueue();
  assert.equal(enqueueClientMessage(q, sent[0].type, sent[0].payload), true, c.id + " real intake accepts the door payload");
  const drained = q.drain();
  if (binding) assert.deepEqual(drained.actions, binding.actions, c.id + " door payload queues exactly the recorded action");
  assert.equal(drained.actions.length, 1);
  assert.equal(drained.actions[0].kind, "questAccept");
  assert.equal(drained.actions[0].quest, sent[0].payload.quest);
}
{
  const c = doors.clientDoor.cases.find((x) => x.id === "known-open-accept");
  assert.ok(c);
  assert.equal(c.actual.accepted, true);
  assert.equal(c.actual.sent[0].payload.quest, c.actual.before.questId);
  assert.ok(c.actual.publicRow.accepted.some(([id, on]) => id === "p0" && on === true));
  assert.ok(c.actual.toasts.some((t) => t.to === "p0" && t.text.startsWith("Quest accepted: ")));
  assert.equal(c.actual.afterServer.acceptHidden, true);
}
{
  const c = doors.clientDoor.cases.find((x) => x.id === "click-guard-and-pending-latch");
  assert.equal(c.actual.early.sent, 0);
  assert.equal(c.actual.late.sent, 1);
  assert.equal(c.actual.afterSecondClick.sent.length, 1);
}
{
  const c = doors.clientDoor.cases.find((x) => x.id === "reconnect-gate");
  assert.equal(c.actual.accepted, false);
  assert.equal(c.actual.sent.length, 0);
  assert.match(c.actual.view.status, /^Reconnecting:/);
}
{
  const c = doors.clientDoor.cases.find((x) => x.id === "open-gates");
  for (const k of ["outOfRange", "dead", "closed", "inactive"]) assert.equal(c.actual[k], false, "open gate " + k);
}
{
  const c = doors.clientDoor.cases.find((x) => x.id === "training-room-edge");
  assert.equal(c.actual.questRuntime, false);
  assert.equal(c.actual.questHandler, "undefined");
  assert.equal(c.actual.tradeHandler, "undefined");
  assert.equal(c.actual.parsedQuest, true);
  assert.equal(c.actual.queued.length, 2);
}
// Intake table: return value agrees with the queue; parse output agrees with the queued action.
for (const c of doors.intake.cases) {
  if (c.id === "per-tick-queue-cap") continue;
  if (c.returned) {
    assert.equal(c.actions.length, 1, c.id + " accepted rows queue one action");
    assert.deepEqual(c.parsed, c.actions[0], c.id + " parseQuestAccept equals the queued command");
  } else {
    assert.equal(c.actions.length, 0, c.id + " refused rows queue nothing");
  }
}
{
  const c = doors.intake.cases.find((x) => x.id === "per-tick-queue-cap");
  assert.equal(c.actions.length, 6);
  assert.equal(c.dropped, 2);
}
// Action cases: the real source refusal strings and the private reveal/public boundary.
const actions = new Map(doors.actions.cases.map((c) => [c.id, c]));
const toastTexts = (id) => (actions.get(id)?.actual.toasts ?? []).map((t) => t.text);
assert.deepEqual(toastTexts("far-refusal"), [S.QUEST_REFUSAL.far]);
assert.deepEqual(toastTexts("busy-stun"), [S.QUEST_REFUSAL.busy]);
assert.deepEqual(toastTexts("los-blocked"), [S.QUEST_REFUSAL.blocked]);
assert.deepEqual(toastTexts("unknown-id"), [S.QUEST_REFUSAL.over]);
assert.deepEqual(toastTexts("stale-closed"), [S.QUEST_REFUSAL.over]);
assert.ok(toastTexts("repeat-already").includes(S.QUEST_REFUSAL.already));
assert.deepEqual(toastTexts("dead-silent"), []);
assert.deepEqual(toastTexts("order-busy-before-offer"), [S.QUEST_REFUSAL.busy]);
assert.deepEqual(toastTexts("order-offer-before-range"), [S.QUEST_REFUSAL.over]);
const orderRange = toastTexts("order-range-before-already");
assert.equal(orderRange.length, 2);
assert.ok(orderRange[0].startsWith("Quest accepted: "));
assert.equal(orderRange[1], S.QUEST_REFUSAL.far);
{
  const c = actions.get("hidden-reveal-publish").actual;
  assert.equal(c.before.publicHas, false);
  assert.equal(c.revealed.publicHas, false);
  assert.equal(c.revealed.unknown, 10);
  assert.ok(c.revealEvents.filter((e) => e.type === "questReveal").every((e) => e.to === "p0"));
  assert.equal(c.headStart.publicHas, false);
  assert.equal(c.published.publicHas, true);
  assert.equal(c.published.unknown, 9);
  assert.ok(c.publishEvents.some((e) => e.type === "toast" && e.to === null));
}
{
  assert.equal(actions.get("phase-ended-not-drained").actual.queueAfter, 1);
  assert.deepEqual(actions.get("phase-ended-not-drained").actual.eventsThisStep, []);
  assert.equal(actions.get("dead-silent").actual.queueAfter, 0);
  assert.deepEqual(actions.get("dead-silent").actual.eventsThisStep, []);
}
// Schema and disclosure.
const kind = (name) => schema.schema.kinds.find((k) => k.name === name);
assert.equal(kind("QuestState").fields.length, 11);
assert.equal(kind("TraderState").fields.length, 5);
const tradeFields = kind("PlayerState (selected trade/body fields)").fields;
for (const name of ["tradeUsed", "tradeOffers", "tradeStats"]) assert.ok(tradeFields.some((f) => f.name === name && f.noSync === false), "public field " + name);
assert.equal(schema.disclosure.matrix.find((m) => m.id === "hidden-quest-before-reveal").actual.publicHasHidden, false);
assert.equal(schema.disclosure.matrix.find((m) => m.id === "private-reveal-message").actual.stateStillHidden, false);
assert.ok(schema.disclosure.matrix.find((m) => m.id === "player-trade-offers-and-stats").classification.startsWith("SOURCE FINDING"));
assert.equal(schema.schema.rounds.find((r) => r.label === "before-publish").decoded.quests.length, 10);
assert.equal(schema.schema.rounds.find((r) => r.label === "after-publish").decoded.quests.length, 11);
assert.equal(schema.schema.rounds.find((r) => r.label === "after-publish").decoded.unknownQuests, 9);
for (const r of schema.schema.rounds) assert.ok(r.sha256.length === 64 && r.bytes > 0);
const previewCase = schema.receivers.cases[0];
assert.equal(previewCase.collections.hidden, 9);
assert.ok(previewCase.collections.questKeys.includes(previewCase.quest.id));
assert.equal(previewCase.accepted, false);
// Wording: helper declarations and runtime toasts are distinct and the runtime rows exist.
assert.deepEqual(Object.keys(wording.helpers.questRefusal).sort(), ["already", "blocked", "busy", "far", "over"]);
for (const key of ["busy", "far", "blocked", "over", "already"]) {
  const pair = wording.refusalPairs.find((p) => p.key === key);
  assert.ok(pair.runtime.length > 0, "runtime toast for QUEST_REFUSAL." + key);
  assert.ok(pair.runtime.every((t) => t.to === "p0" && t.text === wording.helpers.questRefusal[key]));
}
assert.ok(wording.strings.some((s) => s.id === "dialog-accepting" && s.value === "Accepting..."));
assert.ok(wording.strings.some((s) => s.id === "dialog-accepted" && s.value === "Quest accepted. It counts from now."));
assert.ok(wording.strings.some((s) => s.id === "dialog-reconnecting" && s.value === wording.helpers.acceptReconnecting));
assert.ok(wording.runtimeToasts.every((t) => t.to === "p0" || t.to === null));
console.log(JSON.stringify({
  ok: true,
  corpora: manifest.files.map((f) => ({ file: f.file, bytes: f.bytes, sha256: f.sha256, captureSha256: f.captureSha256 })),
  doorCases: doors.clientDoor.cases.length,
  intakeCases: doors.intake.cases.length,
  actionCases: doors.actions.cases.length,
  schemaRounds: schema.schema.rounds.length,
  wordingStrings: wording.strings.length,
}));

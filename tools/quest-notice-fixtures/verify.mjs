// Independent verifier for parity/quest-notices/source.json. Recomputes the canonical bytes, capture SHA, complete
// source/tool/lock inventories and source anchors from the read-only repo copy, then re-checks the actual recorded
// events/recipients/order for all six cases. It consumes actual emitted events, not helper/provenance text.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const [corpusArg, repoArg] = process.argv.slice(2);
assert.ok(corpusArg && repoArg, "usage: verify.mjs <source.json> <repo-root>");
const corpusPath = resolve(corpusArg);
const repoRoot = resolve(repoArg);
const raw = readFileSync(corpusPath, "utf8");
const corpus = JSON.parse(raw);
const sha = (s) => createHash("sha256").update(s).digest("hex");
const fail = (message) => { throw new Error(message); };
const eq = (actual, expected, message) => { try { assert.deepEqual(actual, expected); } catch { fail(message + " (got " + JSON.stringify(actual) + ")"); } };
const ok = (condition, message) => { if (!condition) fail(message); };

assert.equal(corpus.format, "rh-quest-notices-source/1", "format");
eq(raw, JSON.stringify(corpus, null, 1) + "\n", "canonical serialization is JSON.stringify(body, null, 1) + newline");
const clone = JSON.parse(JSON.stringify(corpus));
const claimedCapture = clone.profile.captureSha256;
delete clone.profile.captureSha256;
eq(sha(JSON.stringify(clone, null, 1) + "\n"), claimedCapture, "profile.captureSha256 recomputes over the body without itself");

function walk(rel) {
  const out = [];
  const visit = (dir) => {
    for (const entry of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
      const p = dir + "/" + entry.name;
      if (entry.isDirectory()) visit(p);
      else if (entry.isFile()) out.push(p);
    }
  };
  visit(rel);
  return out.sort();
}
const sourceFiles = ["packages/shared/src", "packages/server/src/sim"].flatMap(walk).filter((p) => p.endsWith(".ts"));
eq(Object.keys(corpus.profile.sourceSha256), sourceFiles, "source closure inventory is exact and sorted");
for (const p of sourceFiles) eq(sha(readFileSync(join(repoRoot, p))), corpus.profile.sourceSha256[p], "source hash " + p);
eq(corpus.profile.sourceClosureFiles, sourceFiles.length, "source closure count");
const toolFiles = walk("tools/quest-notice-fixtures");
eq(Object.keys(corpus.profile.tools.files), toolFiles, "tool inventory is exact and sorted");
for (const p of toolFiles) eq(sha(readFileSync(join(repoRoot, p))), corpus.profile.tools.files[p], "tool hash " + p);
eq(corpus.profile.tools.count, toolFiles.length, "tool count");
eq(corpus.profile.tools.packageLock, sha(readFileSync(join(repoRoot, "package-lock.json"))), "package-lock hash");
eq(corpus.profile.tools.packageJson, sha(readFileSync(join(repoRoot, "package.json"))), "package.json hash");
eq(corpus.profile.tools.tsconfigBase, sha(readFileSync(join(repoRoot, "tsconfig.base.json"))), "tsconfig.base hash");
eq(corpus.profile.tools.sharedTsconfig, sha(readFileSync(join(repoRoot, "packages/shared/tsconfig.json"))), "shared tsconfig hash");
eq(corpus.profile.tools.serverTsconfig, sha(readFileSync(join(repoRoot, "packages/server/tsconfig.json"))), "server tsconfig hash");
eq(corpus.profile.sourceIssues, [], "canonical capture has no source-binding issues");
for (const anchor of corpus.profile.sourceAnchors) {
  ok(typeof anchor.line === "number" && anchor.line > 0, "anchor line for " + anchor.file);
  const line = readFileSync(join(repoRoot, anchor.file), "utf8").split("\n")[anchor.line - 1];
  eq(line, anchor.text, "anchor line text " + anchor.file + ":" + anchor.line);
  ok(line.includes(anchor.needle), "anchor needle present " + anchor.file + ":" + anchor.line);
}

function finite(v, path) {
  if (typeof v === "number") ok(Number.isFinite(v), "nonfinite number at " + path);
  else if (Array.isArray(v)) v.forEach((x, i) => finite(x, path + "[" + i + "]"));
  else if (v && typeof v === "object") for (const k of Object.keys(v)) finite(v[k], path + "." + k);
}
finite(corpus, "$");

const expectedNames = [
  "parcel-feedback", "pickup-closed-guard", "expiry-cohort-order",
  "teleport-close-notices", "run-end-silent-close", "camp-and-publication-closure",
];
eq(corpus.cases.map((c) => c.input.name), expectedNames, "six cases in order");
for (const c of corpus.cases) {
  eq(c.input.base, "dbd70f9d810330099b754281b70d511a60f62cf8", "base binding");
  eq(c.input.actors.length, 3, c.input.name + " three human seats");
  for (const actor of c.input.actors) {
    ok(actor.seatLabel === "human-seat-" + actor.seat, c.input.name + " seat label");
    ok(actor.note.includes("not ownership or capability"), c.input.name + " binding disclaimer");
  }
  ok(c.events.length > 0, c.input.name + " has actual events");
  ok(c.frames.length > 0, c.input.name + " has snapshots");
  for (const e of c.events) {
    ok(Number.isFinite(e.tick) && Number.isFinite(e.time), c.input.name + " event clock");
    eq(e.time, e.tick * 50, c.input.name + " event time is the tick clock");
    ok(e.via === "step" || e.via === "inline-producer", c.input.name + " event capture point");
    ok(typeof e.type === "string", c.input.name + " event type");
    if (e.type === "toast") {
      ok(e.to === null || /^p[0-2]$/.test(e.to), c.input.name + " toast recipient is a typed seat id or null room");
      ok(typeof e.text === "string" && e.text.length > 0, c.input.name + " toast text");
    } else if (e.type === "questReveal") {
      ok(/^p[0-2]$/.test(e.to), c.input.name + " questReveal recipient is a typed private seat id");
    } else {
      ok(!("to" in e), c.input.name + " non-toast/non-reveal event has no recipient field");
    }
  }
}

const evAt = (c, index, what) => {
  ok(Number.isInteger(index) && index >= 0 && index < c.events.length, c.input.name + " " + what + " index valid");
  return c.events[index];
};

// 1 parcel-feedback
{
  const c = corpus.cases[0];
  const f = c.facts;
  const i = f.indices;
  for (const key of Object.keys(i)) ok(i[key] >= 0, "parcel index " + key);
  const before = evAt(c, i.beforeAcceptIdx, "before-accept");
  eq([before.type, before.to], ["toast", "p0"], "pre-accept refusal is a private p0 toast");
  ok(before.text.startsWith("Accept "), "pre-accept refusal is the source accept-first wording");
  const pickup = evAt(c, i.pickupIdx, "first pickup");
  eq([pickup.type, pickup.to], ["toast", "p0"], "first pickup is private to p0");
  ok(pickup.text.startsWith("Picked up: "), "first pickup text");
  const carry = evAt(c, i.carryIdx, "carry refusal");
  eq([carry.type, carry.to, carry.text], ["toast", "p0", "you can carry one quest item"], "carry-limit refusal is the private shared source text");
  const drop = evAt(c, i.dropIdx, "drop");
  eq([drop.type, drop.to], ["toast", null], "drop notice is a room toast");
  ok(drop.text.includes(" dropped parcel: "), "drop notice text");
  const stolen = evAt(c, i.stolenIdx, "stolen");
  eq([stolen.type, stolen.to], ["toast", null], "stolen notice is a room toast");
  ok(stolen.text.includes(" stole parcel: "), "stolen notice text");
  const picked = evAt(c, i.privatePickedIdx, "private picked");
  eq([picked.type, picked.to], ["toast", "p2"], "steal pickup is private to the stealer p2");
  ok(picked.text.startsWith("Picked up: "), "steal pickup text");
  ok(i.dropIdx < i.stolenIdx && i.stolenIdx < i.privatePickedIdx, "dropped -> stolen -> private picked order");
  const gv = evAt(c, i.gvIdx, "gv");
  eq([gv.type, gv.id, gv.reason], ["gv", "p2", "quest"], "completion quest GV is private to p2");
  const farm = evAt(c, i.farmIdx, "farm");
  eq([farm.type, farm.to], ["toast", "p2"], "farm-stat notice is private to p2");
  ok(!farm.text.startsWith("Quest complete:"), "farm notice is not the completion notice");
  const done = evAt(c, i.privateDoneIdx, "private done");
  eq([done.type, done.to], ["toast", "p2"], "private completion is to p2");
  ok(done.text.startsWith("Quest complete: "), "private completion text");
  const room = evAt(c, i.roomDoneIdx, "room done");
  eq([room.type, room.to], ["toast", null], "room completion is public");
  ok(room.text.includes(" completed quest: "), "room completion text");
  ok(i.gvIdx < i.farmIdx && i.farmIdx < i.privateDoneIdx && i.privateDoneIdx < i.roomDoneIdx, "GV -> farm -> private -> room order");
  eq(f.carryRefusalConsumedNothing, true, "carry refusal consumed nothing");
  eq(f.finalQuestStatus, "done", "real Fetch turn-in retired the offer");
}

// 2 pickup-closed-guard
{
  const c = corpus.cases[1];
  const f = c.facts;
  ok(f.staleClosed.noncanonical && f.staleCarrierSilent.noncanonical, "guard fixtures are labelled noncanonical");
  ok(c.input.setup.some((s) => s.includes("NONCANONICAL")), "input setup states the noncanonical boundary");
  eq(f.staleClosed.privateSharedOver, true, "stale/closed guard produced the shared Over");
  const over = c.events.find((e) => e.tick === f.ticks.staleClosed && e.type === "toast" && e.to === "p0" && e.text === "That quest is over");
  ok(over, "private shared Over event is recorded");
  eq(f.staleClosed.boxStillPresent, true, "stale/closed guard left the real box present");
  eq(f.staleClosed.sameItemUid, true, "stale/closed guard consumed no item");
  eq(f.staleCarrierSilent.eventCountInStep, 0, "existing-carrier guard is silent");
  eq(f.staleCarrierSilent.boxStillPresent, true, "existing-carrier guard left the box present");
  eq(f.staleCarrierSilent.sameItemUid, true, "existing-carrier guard consumed no item");
  eq(c.events.filter((e) => e.tick === f.ticks.staleCarrier).length, 0, "no event was emitted in the silent carrier step");
}

// 3 expiry-cohort-order
{
  const c = corpus.cases[2];
  const f = c.facts;
  const i = f.indices;
  for (const key of Object.keys(i)) ok(i[key] >= 0, "cohort index " + key);
  const reveal = evAt(c, i.revealIdx, "reveal");
  eq([reveal.type, reveal.to], ["questReveal", "p1"], "finder-private questReveal to p1");
  ok(reveal.quest && reveal.quest.id && reveal.quest.def && Number.isFinite(reveal.quest.x) && Number.isFinite(reveal.quest.y), "questReveal carries the private preview payload");
  const discovery = evAt(c, i.discoveryIdx, "discovery");
  eq([discovery.type, discovery.to], ["toast", "p1"], "discovery toast is private to the finder");
  ok(discovery.text.startsWith("Quest discovered: "), "discovery text");
  ok(i.revealIdx < i.discoveryIdx, "reveal precedes discovery toast");
  const aggregate = evAt(c, i.aggregateIdx, "aggregate");
  eq([aggregate.type, aggregate.to, aggregate.text], ["toast", null, "2 quests expired"], "same-step expiries aggregated with no names");
  eq(f.hiddenLeakInPublicNotices.length, 0, "no hidden name appears in a public notice");
  const gv = evAt(c, i.gvIdx, "gv");
  eq([gv.type, gv.id, gv.reason], ["gv", "p0", "quest"], "ready turn-in GV");
  ok(i.discoveryIdx < i.aggregateIdx && i.aggregateIdx < i.gvIdx, "discovery -> aggregate -> completion order");
  eq(f.statuses.C, "expired", "published C expired");
  eq(f.statuses.D, "expired", "published D expired");
  eq(f.statuses.A, "done", "ready turn-in completed");
  eq([f.statuses.H, f.statuses.HPublished], ["open", false], "the discovered hidden offer stayed hidden with unknown count retained");
  const targetEvents = c.events.filter((e) => e.tick === f.ticks.target);
  ok(targetEvents.every((e) => e.time === f.ticks.target * 50), "target cohort is one step");
  eq(f.order.sameStep, true, "discovery, expiry and completion are the same step");
}

// 4 teleport-close-notices
{
  const c = corpus.cases[3];
  const f = c.facts;
  eq(c.input.setup.some((s) => s.includes("before the next step")), true, "queue is declared as recorded before the step clears it");
  ok(f.queueEventsFull.every((e) => e.via === "inline-producer" && e.producer === "teleportToColiseum"), "queue is recorded at the inline producer point");
  eq(f.queueToasts, 1, "one aggregate public notice");
  eq([f.aggregate.type, f.aggregate.to, f.aggregate.text], ["toast", null, f.expectedAggregateText], "aggregate room notice");
  eq(f.aggregate.text, "10 quests expired", "aggregate counts every published open offer");
  eq(f.queueEventsFull.some((e) => e.type === "fx" && e.fx.kind === "teleport"), true, "producer teleport fx is in the same queue");
  eq(f.hiddenLeakInQueue.length, 0, "no hidden def leaks into the queue");
  eq(f.unknownAfter, 0, "hidden unknown count falls to zero");
  eq(f.hiddenAfter, 0, "hidden offers deleted");
  eq(f.expiredAfter, 10, "all published offers expired");
  eq(f.stepTick, f.aggregate.tick + 1, "the next step clears the queue");
}

// 5 run-end-silent-close
{
  const c = corpus.cases[4];
  const f = c.facts;
  eq(f.phase, "ended", "the run ended");
  eq(f.winner, "name0", "real winner");
  eq(f.expiryNotices.length, 0, "no quest-expiry notice at run end");
  eq(f.endStepToasts.length, 0, "the run-end step emitted no toast");
  const end = c.events.filter((e) => e.tick === f.ticks.runEnd);
  ok(end.some((e) => e.type === "raidEnded"), "raidEnded preserved");
  ok(end.some((e) => e.type === "fx" && e.fx.kind === "victory"), "victory fx preserved");
  ok(end.some((e) => e.type === "resolved" && e.id === "p2"), "final rival resolved preserved");
  ok(end.some((e) => e.type === "resolved" && e.id === "p0"), "winner resolved preserved");
  ok(end.some((e) => e.type === "gv" && e.id === "p0" && e.reason === "kill"), "final kill GV preserved");
  eq(f.unknownAfter, 0, "hidden offers deleted silently");
  eq(f.hiddenAfter, 0, "no hidden offers remain");
  eq(f.expiredAfter, 10, "all published offers closed");
}

// 6 camp-and-publication-closure
{
  const c = corpus.cases[5];
  const f = c.facts;
  eq(f.fire.liveAfter, 0, "the fire region was wiped through killMob");
  ok(f.fire.expiry && f.fire.expiry.type === "toast" && f.fire.expiry.to === null && f.fire.expiry.text.startsWith("Quest expired: "), "the recheck announced one named expiry");
  eq(f.fire.namedSingle, true, "one named expiry, not a count");
  eq(f.inlineProducerLabels.length, 2, "both region wipes are labelled inline producer calls");
  eq(f.inlineProducerLabels.map((x) => x.producer), ["killMob", "killMob"], "producer labels name killMob");
  eq(f.inlineProducerLabels.map((x) => x.region), ["fire", "frost"], "producer labels name the regions");
  ok(f.frost.reveal && f.frost.reveal.type === "questReveal" && f.frost.reveal.to === "p0", "finder-private reveal for the impossible offer");
  ok(f.frost.discoveryToast && f.frost.discoveryToast.to === "p0" && f.frost.discoveryToast.text.startsWith("Quest discovered: "), "finder discovery toast");
  eq(f.frost.acceptBeforePublication.text, "That quest is over", "hidden offer is nonactionable before publication");
  eq(f.frost.acceptBeforePublication.to, "p0", "nonactionable answer is private");
  ok(f.frost.publication && f.frost.publication.to === null && f.frost.publication.text.includes(" revealed quest: "), "public publication announcement");
  eq([f.frost.aggregate.type, f.frost.aggregate.to, f.frost.aggregate.text], ["toast", null, "2 quests expired"], "same-step count aggregation");
  eq(f.frost.publicationBeforeAggregate, true, "publication precedes expiry");
  eq(f.frost.sameStepAggregation, true, "two offers closed in the publication step");
  eq(f.frost.statuses.B, "expired", "impossible published offer closed");
  eq(f.frost.statuses.BPublished, true, "impossible offer did publish first");
  eq(f.frost.statuses.C, "expired", "nudged published offer expired the same step");
  eq(f.frost.hiddenLeakInPublicationToasts.length, 0, "no still-hidden name leaked");
  eq(c.input.setup.some((s) => s.includes("expireSoon")) || c.actions.some((a) => a.kind === "expireSoon"), true, "the declared order-only deadline nudge is recorded");
}

console.log(JSON.stringify({
  verified: corpusPath, bytes: raw.length, sha256: sha(raw), captureSha256: claimedCapture,
  cases: corpus.cases.length, events: corpus.cases.reduce((n, c) => n + c.events.length, 0),
  frames: corpus.cases.reduce((n, c) => n + c.frames.length, 0),
  sourceFiles: sourceFiles.length, toolFiles: toolFiles.length, anchors: corpus.profile.sourceAnchors.length,
}));

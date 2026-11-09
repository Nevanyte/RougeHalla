#!/usr/bin/env node
// Real-producer consumer for the owner-combat farm corpus. It verifies the actual recorded output against the actual
// shared source fold/encode functions and the checked-in source/tool/lock hashes; it never trusts a declared outcome.
//
//   node --import tsx tools/owner-combat-farm-fixtures/verify.mjs --repo /repo [--corpus <path>]
//   node --import tsx tools/owner-combat-farm-fixtures/verify.mjs --repo /repo --corpus <mutant> --semantic-only
//   node --import tsx tools/owner-combat-farm-fixtures/verify.mjs --repo /repo --compare <baseline> --corpus <candidate>
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
let repoRoot = "/repo";
let corpusPath = null;
let semanticOnly = false;
let comparePath = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--repo") repoRoot = resolve(argv[++i]);
  else if (argv[i] === "--corpus") corpusPath = resolve(argv[++i]);
  else if (argv[i] === "--semantic-only") semanticOnly = true;
  else if (argv[i] === "--compare") comparePath = resolve(argv[++i]);
  else assert.fail("unknown argument " + argv[i]);
}
repoRoot = resolve(repoRoot);
if (corpusPath === null) corpusPath = join(repoRoot, "parity/policy/owner-combat-farm/source.json");
const sha = (data) => createHash("sha256").update(data).digest("hex");
const shaFile = (p) => sha(readFileSync(p));
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const typed = (v) => {
  if (typeof v === "number") {
    if (Number.isFinite(v)) return Object.is(v, -0) ? "-0" : v;
    return Number.isNaN(v) ? "NaN" : v > 0 ? "+Infinity" : "-Infinity";
  }
  if (Array.isArray(v)) return v.map(typed);
  if (v && typeof v === "object") { const out = {}; for (const k of Object.keys(v)) out[k] = typed(v[k]); return out; }
  return v;
};
const entries = (v) => {
  if (!v) return {};
  const out = {};
  for (const [k, n] of v.entries || v) out[String(k)] = n;
  return out;
};
let failed = false;
function mismatch(path, expected, actual, note = "") {
  if (failed) return false;
  failed = true;
  console.log("FIRST_MISMATCH " + path + " expected=" + JSON.stringify(expected) + " actual=" + JSON.stringify(actual) + (note ? " (" + note + ")" : ""));
  console.log("FAIL");
  return false;
}
function check(condition, path, expected, actual, note = "") {
  if (!condition) return mismatch(path, expected, actual, note);
  return true;
}

// --------------------------------------------------------------------------------------------------------------- integrity
if (corpus.format !== "rh-owner-combat-farm/1") mismatch("format", "rh-owner-combat-farm/1", corpus.format);
const profile = corpus.profile;
if (!profile || typeof profile !== "object") mismatch("profile", "object", typeof profile);
if (profile.captureSha256 !== undefined) {
  const unsigned = JSON.parse(JSON.stringify(corpus));
  delete unsigned.profile.captureSha256;
  const captureSha = sha(JSON.stringify(typed(unsigned)));
  check(captureSha === profile.captureSha256, "profile.captureSha256", captureSha, profile.captureSha256);
}
if (!semanticOnly) {
  check(profile.pinned === true, "profile.pinned", true, profile.pinned);
  check(profile.node === "v22.23.4", "profile.node", "v22.23.4", profile.node);
  check(profile.platform === "linux", "profile.platform", "linux", profile.platform);
  check(profile.arch === "x64", "profile.arch", "x64", profile.arch);
  check(profile.base && profile.base.commit === "dbd70f9d810330099b754281b70d511a60f62cf8", "profile.base.commit", "dbd70f9d810330099b754281b70d511a60f62cf8", profile.base && profile.base.commit);
  check(profile.base && profile.base.branch === "deepseek/owner-combat-farm", "profile.base.branch", "deepseek/owner-combat-farm", profile.base && profile.base.branch);
  for (const [rel, expected] of Object.entries(profile.sourceFiles || {})) {
    const p = join(repoRoot, rel);
    if (!existsSync(p) || !statSync(p).isFile()) { mismatch("profile.sourceFiles[" + JSON.stringify(rel) + "]", expected, "<missing>"); break; }
    const actual = shaFile(p);
    if (!check(actual === expected, "profile.sourceFiles[" + JSON.stringify(rel) + "]", expected, actual)) break;
  }
  for (const [rel, expected] of Object.entries(profile.tool || {})) {
    const p = join(repoRoot, rel);
    if (!existsSync(p) || !statSync(p).isFile()) { mismatch("profile.tool[" + JSON.stringify(rel) + "]", expected, "<missing>"); break; }
    const actual = shaFile(p);
    if (!check(actual === expected, "profile.tool[" + JSON.stringify(rel) + "]", expected, actual)) break;
  }
  for (const [rel, expected] of Object.entries(profile.manifests || {})) {
    if (expected === null) continue;
    const p = join(repoRoot, rel);
    if (!existsSync(p)) { mismatch("profile.manifests[" + JSON.stringify(rel) + "]", expected, "<missing>"); break; }
    const actual = shaFile(p);
    if (!check(actual === expected, "profile.manifests[" + JSON.stringify(rel) + "]", expected, actual)) break;
  }
  for (const [name, expected] of Object.entries(profile.externalVersions || {})) {
    const p = join(repoRoot, "node_modules", name, "package.json");
    const actual = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")).version : "<missing>";
    if (!check(actual === expected, "profile.externalVersions[" + JSON.stringify(name) + "]", expected, actual)) break;
  }
}

// ---------------------------------------------------------------------------------------------------------- actual source
const shared = await import(pathToFileURL(join(repoRoot, "packages/shared/src/index.ts")).href);
const {
  MOB_KILL_STACKS, mobStatReward, mobStatRows, foldRows, mirrorsFromFold, encodeMirrors, decodeMirrors, decodeMult,
} = shared;
const frames = corpus.frames;
if (!Array.isArray(frames) || frames.length === 0) { mismatch("frames", "non-empty array", frames && frames.length); }
const kill = corpus.kill;
if (!kill || !Number.isInteger(kill.frameIndex)) mismatch("kill.frameIndex", "integer", kill && kill.frameIndex);
const type = corpus.setup && corpus.setup.target && corpus.setup.target.actual ? corpus.setup.target.actual.type : null;
if (!check(type === "plagueRat" || type === "frostbowSentry", "setup.target.actual.type", "plagueRat|frostbowSentry", type)) process.exit(1);
const reward = mobStatReward(type);
if (!check(!!reward, "mobStatReward(" + type + ")", "defined", reward)) process.exit(1);
check(reward.effect.k === "stat" && reward.effect.stat === "attackSpeed" && reward.effect.v === 0.01, "target reward", "stat attackSpeed v=0.01", JSON.stringify(reward.effect));
check(MOB_KILL_STACKS === 3, "MOB_KILL_STACKS", 3, MOB_KILL_STACKS);
const targetActual = corpus.setup.target.actual;
check(targetActual.elite === false, "setup.target.actual.elite", false, targetActual.elite);
check(corpus.setup.map && corpus.setup.map.seed === 20261101, "setup.map.seed", 20261101, corpus.setup.map && corpus.setup.map.seed);
check(corpus.setup.map && corpus.setup.map.attempt === 0, "setup.map.attempt", 0, corpus.setup.map && corpus.setup.map.attempt);
check(targetActual.campIndex === 20 && targetActual.campRef === 21 && targetActual.campId === "plague-1" && targetActual.slot === 0, "target camp identity", "campIndex=20 campRef=21 id=plague-1 slot=0", JSON.stringify({ campIndex: targetActual.campIndex, campRef: targetActual.campRef, campId: targetActual.campId, slot: targetActual.slot }));

// The expected mirror comes from the ACTUAL recorded farm count through the source's own shared functions, never a copied
// formula. The same fold the sim uses: farm rows -> foldRows -> mirrorsFromFold -> encodeMirrors.
const killFrame = frames[kill.frameIndex];
if (!killFrame) { mismatch("frames[kill.frameIndex]", "a frame", kill.frameIndex); process.exit(1); }
const preFrame = frames[kill.frameIndex - 1];
if (!preFrame) { mismatch("frames[kill.frameIndex-1]", "a frame", kill.frameIndex - 1); process.exit(1); }
const beforeStats = entries(preFrame.ownerMobStats);
const afterStats = entries(killFrame.ownerMobStats);
const expectedBefore = encodeMirrors(mirrorsFromFold(foldRows([], { farmRows: mobStatRows(beforeStats) })));
const expectedAfter = encodeMirrors(mirrorsFromFold(foldRows([], { farmRows: mobStatRows(afterStats) })));
check(expectedBefore.asMult === 1000, "expectedBefore.asMult", 1000, expectedBefore.asMult);
check(expectedAfter.asMult === 1030, "expectedAfter.asMult", 1030, expectedAfter.asMult);
check(afterStats[type] === MOB_KILL_STACKS, "killFrame.ownerMobStats[" + type + "]", MOB_KILL_STACKS, afterStats[type]);
check(!beforeStats[type], "preFrame.ownerMobStats[" + type + "]", "absent/0", beforeStats[type]);

// --------------------------------------------------------------------------------------------------- actual frames, in order
// The first semantic mismatch is the recorded owner asMult at the kill frame when the mirror write is suppressed.
for (let i = 0; i < frames.length; i++) {
  const f = frames[i];
  const expected = f.step >= kill.step ? expectedAfter.asMult : expectedBefore.asMult;
  if (!check(f.owner && f.owner.asMult === expected, "frames[" + i + "].owner.asMult", expected, f.owner && f.owner.asMult, "kill step " + kill.step)) break;
  if (!check(f.ownerDecoded && f.ownerDecoded.asMult === expected, "frames[" + i + "].ownerDecoded.asMult", expected, f.ownerDecoded && f.ownerDecoded.asMult, "kill step " + kill.step)) break;
}
for (let i = 0; i < frames.length; i++) {
  const f = frames[i];
  const expectedMobStats = f.step >= kill.step ? MOB_KILL_STACKS : 0;
  const actual = entries(f.ownerMobStats)[type] ?? 0;
  if (!check(actual === expectedMobStats, "frames[" + i + "].ownerMobStats[" + type + "]", expectedMobStats, actual, "kill step " + kill.step)) break;
}
for (let i = 0; i < frames.length; i++) {
  const f = frames[i];
  if (!check(f.owner && f.owner.windupMult === expectedAfter.windupMult, "frames[" + i + "].owner.windupMult", expectedAfter.windupMult, f.owner && f.owner.windupMult)) break;
  if (!check(f.owner && f.owner.speedMult === expectedAfter.speedMult, "frames[" + i + "].owner.speedMult", expectedAfter.speedMult, f.owner && f.owner.speedMult)) break;
}
for (let i = 0; i < frames.length; i++) {
  const f = frames[i];
  const owned = f.ownerMirrors || {};
  const decoded = f.ownerDecodedMirrors || {};
  for (const k of ["asMult", "windupMult", "speedMult"]) {
    if (!check(f.owner && f.owner[k] === owned[k], "frames[" + i + "].ownerMirrors." + k, f.owner && f.owner[k], owned[k])) break;
  }
  for (const k of ["asMult", "windupMult", "speedMult", "armorBonus", "shieldBonus", "adBonus", "apBonus"]) {
    if (!check(decoded[k] === decodeMirrors(f.ownerDecodedWireMirrors)[k], "frames[" + i + "].ownerDecodedMirrors." + k, decodeMirrors(f.ownerDecodedWireMirrors)[k], decoded[k])) break;
  }
}
for (let i = 0; i < frames.length; i++) {
  const f = frames[i];
  if (!check(f.bot && f.bot.self && f.bot.self.asMult === decodeMult(f.owner.asMult), "frames[" + i + "].bot.self.asMult", decodeMult(f.owner.asMult), f.bot && f.bot.self && f.bot.self.asMult)) break;
  if (!check(f.botDecoded && f.botDecoded.self && f.botDecoded.self.asMult === decodeMult(f.ownerDecoded.asMult), "frames[" + i + "].botDecoded.self.asMult", decodeMult(f.ownerDecoded.asMult), f.botDecoded && f.botDecoded.self && f.botDecoded.self.asMult)) break;
  if (!check(f.schema && f.schema.fullGroup && f.schema.fullGroup.decoded && f.schema.fullGroup.decoded.asMult === f.owner.asMult, "frames[" + i + "].schema.fullGroup.decoded.asMult", f.owner.asMult, f.schema && f.schema.fullGroup && f.schema.fullGroup.decoded && f.schema.fullGroup.decoded.asMult)) break;
}

// Kill/event facts, read from the actual source state and hooks.
check(typeof kill.targetHpBefore === "number" && kill.targetHpBefore > 0, "kill.targetHpBefore", ">0", kill.targetHpBefore);
check(kill.before.target && kill.before.target.present && kill.before.target.status === "alive" && kill.before.target.hp > 0, "kill.before.target", "alive with hp", JSON.stringify(kill.before.target && { present: kill.before.target.present, status: kill.before.target.status, hp: kill.before.target.hp }));
check(kill.targetHpAtKill === 0, "kill.targetHpAtKill", 0, kill.targetHpAtKill);
check(kill.at.target && kill.at.target.status === "dead" && kill.at.target.hp === 0, "kill.at.target", "dead at hp 0", JSON.stringify(kill.at.target && { status: kill.at.target.status, hp: kill.at.target.hp }));
check(kill.after.target && kill.after.target.status === "dead" && kill.after.target.hp === 0, "kill.after.target", "dead at hp 0", JSON.stringify(kill.after.target && { status: kill.after.target.status, hp: kill.after.target.hp }));
check(kill.targetStatusAtKill === "dead", "kill.targetStatusAtKill", "dead", kill.targetStatusAtKill);
check(kill.deathEvent && kill.deathEvent.fx && kill.deathEvent.fx.id === kill.targetId && kill.deathEvent.fx.by === "own", "kill.deathEvent", "fx death by own", kill.deathEvent);
check(kill.mobKilledObserver && kill.mobKilledObserver.killer && kill.mobKilledObserver.killer.id === "own", "kill.mobKilledObserver.killer.id", "own", kill.mobKilledObserver && kill.mobKilledObserver.killer && kill.mobKilledObserver.killer.id);
check(kill.mobKilledObserver && kill.mobKilledObserver.mob && kill.mobKilledObserver.mob.type === type && kill.mobKilledObserver.mob.elite === false && kill.mobKilledObserver.mob.camp === 20, "kill.mobKilledObserver.mob", JSON.stringify({ type, elite: false, camp: 20 }), JSON.stringify(kill.mobKilledObserver && kill.mobKilledObserver.mob));
check(kill.grantToast && kill.grantToast.to === "own" && typeof kill.grantToast.text === "string" && kill.grantToast.text.includes("+3 kill stacks"), "kill.grantToast", "the actual +3 kill stacks toast", kill.grantToast && kill.grantToast.text);
check(kill.gvEvent && kill.gvEvent.reason === "mob" && kill.gvEvent.id === "own", "kill.gvEvent", "mob gv for own", JSON.stringify(kill.gvEvent));
check(kill.lethalHit && kill.lethalHit.by && kill.lethalHit.by.id === "own" && kill.lethalHit.victim === kill.targetId, "kill.lethalHit", "a real hit by own on the target", JSON.stringify(kill.lethalHit && { by: kill.lethalHit.by, victim: kill.lethalHit.victim, applied: kill.lethalHit.applied }));
const mobKills = (corpus.observers || []).filter((o) => o.kind === "mobKilled");
check(mobKills.length === 1, "observers.mobKilled.count", 1, mobKills.length);
const last = frames[frames.length - 1];
check(last.source.phase === "active", "lastFrame.source.phase", "active", last.source.phase);
check(last.owner.status === "alive" && last.owner.hp > 0, "lastFrame.owner", "alive with hp", JSON.stringify({ status: last.owner.status, hp: last.owner.hp }));
check(last.source.counts.playersAlive >= 2, "lastFrame.source.counts.playersAlive", ">=2", last.source.counts.playersAlive);
check(kill.at && kill.at.botSelf && kill.at.botSelf.asMult === decodeMult(1030), "kill.at.botSelf.asMult", decodeMult(1030), kill.at && kill.at.botSelf && kill.at.botSelf.asMult);
check(kill.at && kill.at.botSelf && kill.at.botSelf.mobStats && kill.at.botSelf.mobStats[type] === 3, "kill.at.botSelf.mobStats[" + type + "]", 3, kill.at && kill.at.botSelf && kill.at.botSelf.mobStats && kill.at.botSelf.mobStats[type]);
check(kill.at && kill.at.botDecodedSelf && kill.at.botDecodedSelf.asMult === decodeMult(1030), "kill.at.botDecodedSelf.asMult", decodeMult(1030), kill.at && kill.at.botDecodedSelf && kill.at.botDecodedSelf.asMult);
check(kill.at.mirrors.host.asMult === expectedAfter.asMult && kill.at.mirrors.decoded.asMult === decodeMult(expectedAfter.asMult), "kill.at.mirrors.asMult", expectedAfter.asMult, JSON.stringify(kill.at.mirrors));
check(kill.before.mirrors.host.asMult === expectedBefore.asMult && kill.before.mirrors.decoded.asMult === decodeMult(expectedBefore.asMult), "kill.before.mirrors.asMult", expectedBefore.asMult, JSON.stringify(kill.before.mirrors));
check(corpus.setup.owner.declaredLoadout.rackDef === "wand" && corpus.actions.some((a) => a.message === "pickup" && a.accepted === true) && corpus.actions.some((a) => a.message === "target" && a.accepted === true), "corpus.actions", "accepted pickup and target", JSON.stringify(corpus.actions));

// --------------------------------------------------------------------------------------------------------------- --compare
if (comparePath !== null) {
  const baseline = JSON.parse(readFileSync(comparePath, "utf8"));
  const skip = (path) => path === "profile" || path.startsWith("profile.");
  let firstDiffPath = null;
  let firstExpected = null;
  let firstActual = null;
  function walk(a, b, path) {
    if (firstDiffPath !== null) return;
    if (skip(path)) return;
    if (typeof a !== typeof b) { firstDiffPath = path; firstExpected = a; firstActual = b; return; }
    if (a === null || b === null || typeof a !== "object") { if (a !== b) { firstDiffPath = path; firstExpected = a; firstActual = b; } return; }
    if (Array.isArray(a) !== Array.isArray(b)) { firstDiffPath = path; firstExpected = a; firstActual = b; return; }
    if (Array.isArray(a)) {
      if (a.length !== b.length) { firstDiffPath = path + ".length"; firstExpected = a.length; firstActual = b.length; return; }
      for (let i = 0; i < a.length; i++) walk(a[i], b[i], path + "[" + i + "]");
      return;
    }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) walk(a[k], b[k], path === "" ? k : path + "." + k);
  }
  walk(baseline, corpus, "");
  if (firstDiffPath !== null) { console.log("FIRST_DIFF " + firstDiffPath + " expected=" + JSON.stringify(firstExpected) + " actual=" + JSON.stringify(firstActual)); failed = true; }
  else console.log("compare identical (excluding /profile)");
}

if (failed) process.exit(1);
console.log("OK corpus=" + corpusPath + " sha256=" + shaFile(corpusPath) + " frames=" + frames.length + " killStep=" + kill.step + " asMult=" + kill.before.mirrors.host.asMult + "->" + kill.at.mirrors.host.asMult + " mobStats=" + JSON.stringify(afterStats) + " target=" + targetActual.type + "@" + targetActual.campId + " slot=" + targetActual.slot);

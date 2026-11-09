// P15 raw-observation verifier. CODE-ONLY, NOT EXECUTED. Consumes actual recorded rows/temporal
// observations; it never imports the source, installs expected state, or reads private memory as input.
import assert from "node:assert/strict";
const CASES = ["P0","P1","B0","B1","B2","W0","W1","W2","W3","W4","W5"];
function find(raw, id) { const c = raw.cases.find((x) => x.caseId === id); assert(c, "missing case " + id); return c; }
function fullRows(c) { return (c.rows ?? []).filter((r) => r.sourceDiagnostic || r.full); }
function temporal(c) { return c.temporal ?? []; }
function allFrames(c) { return temporal(c).map((t) => t.frame).filter(Boolean); }
function fxKinds(c) { return (c.rows ?? []).flatMap((r) => r.sourceFx ?? []).map((x) => x.kind); }
function launchList(c) { return (c.rows ?? []).flatMap((r) => r.fx?.launches ?? []); }
function allViewerStimuli(c) { return (c.rows ?? []).flatMap((r) => (r.viewers ?? []).flatMap((v) => v.stimuli ?? []).map((s) => s.kind)); }
function orderTimes(c, actor, type) { return (c.rows ?? []).flatMap((r) => (r.orders ?? []).filter((o) => o.actor === actor && o.type === type).map((o) => r.time)); }
function sourcePlayerAt(c, id, pred) { for (const r of c.rows ?? []) if (pred(r) && r.sourceDiagnostic) { const p = r.sourceDiagnostic.players.find((x) => x.id === id); if (p) return p; } return null; }
function firstFrameNear(c, id, time) { const best = temporal(c).filter((t) => t.viewerId === id && Math.abs((t.time ?? -1) - time) <= 150).sort((a,b)=>Math.abs(a.time-time)-Math.abs(b.time-time))[0]; return best?.frame ?? null; }
function fighterIn(frame, id) { return (frame?.fighters ?? []).find((f) => f.id === id) ?? null; }
function positiveLaunchAfter(c, time) { return (c.rows ?? []).filter((r) => r.time > time).flatMap((r) => r.fx?.launches ?? []).some((l) => l.ownerId === "cue-caster" || l.from === "cue-caster"); }
function checks(raw) {
  const done = [];
  assert.equal(raw?.format, "rh-p15-protection-cues-raw/1");
  assert.equal(raw.cases.length, 11, "exact eleven cases");
  assert.deepEqual(raw.cases.map((c) => c.caseId), CASES);
  assert(raw.profile?.map?.sha256 && raw.profile?.code === "bb564d3b53728cbd205af375b5342eca466f3656");
  for (const c of raw.cases) {
    assert.equal(c.status, "ok", c.caseId + " status " + c.error);
    assert(c.steps <= 96, c.caseId + " over96");
    assert(c.T > 0 && c.U > 0 && c.C === c.U + 50, c.caseId + " clocks");
    assert(c.temporalCount === c.steps * c.spec.viewers.length, c.caseId + " temporal count");
    assert(c.rows.some((r) => r.teleport), c.caseId + " teleport row");
    for (const r of c.rows ?? []) for (const o of r.orders ?? []) assert.equal(o.accepted, true, c.caseId + " refused input");
    for (const f of c.temporal ?? []) { assert(f.frame && typeof f.frame === "object", "frame missing"); assert("composed" in f, "composed return missing"); assert(f.composeConfigSha256 === c.composition?.featuresSha256, "compose config pin mismatch"); }
    done.push(c.caseId + ": clocks/full temporal");
  }
  // P0: positive owner deadline and both remote guards are read from actual prefilter Frames around U.
  const p0 = find(raw, "P0");
  const ownerAtU = firstFrameNear(p0, "cue-caster", p0.U);
  const casterAtU = fighterIn(ownerAtU, "cue-caster");
  assert(casterAtU && casterAtU.immune === true, "P0 remote positive guard");
  const pre = firstFrameNear(p0, "cue-caster", p0.T + 50);
  const casterPre = fighterIn(pre, "cue-caster");
  assert(casterPre && casterPre.immune === false, "P0 remote before guard");
  done.push("P0 positive/zero remote guards");
  // P1: paid HP loss only after expiry.
  const p1 = find(raw, "P1");
  const atEnd = p1.final.players.find((p) => p.id === "cue-caster");
  const atT = sourcePlayerAt(p1, "cue-caster", (r) => Math.abs(r.time - p1.T) <= 50);
  assert(atT && atEnd && atEnd.hp < atT.hp, "P1 paid unprotected HP loss");
  done.push("P1 paid HP loss");
  for (const id of ["B0", "B2", "W1", "W2", "W5"]) {
    const c = find(raw, id);
    assert(launchList(c).some((l) => l.ownerId === "cue-caster" || l.from === "cue-caster"), id + " actual caster launch");
    done.push(id + " actual launch");
  }
  const b1 = find(raw, "B1");
  assert(!launchList(b1).some((l) => l.ownerId === "cue-caster" || l.from === "cue-caster"), "B1 no caster launch after committed swap");
  done.push("B1 swap cancellation absence");
  const w0 = find(raw, "W0");
  assert(fxKinds(w0).includes("cancel"), "W0 actual cancel FX");
  assert(allViewerStimuli(w0).some((k) => /windup/i.test(k)) && allViewerStimuli(w0).some((k) => /cancel/i.test(k)), "W0 observer windup/cancel feint");
  done.push("W0 real cancel + observer feint");
  const w3 = find(raw, "W3");
  assert(fxKinds(w3).includes("stagger"), "W3 real stagger");
  assert(w3.final.players.find((p) => p.id === "cue-caster").status === "alive", "W3 remains standing");
  assert(!launchList(w3).some((l) => l.ownerId === "cue-caster" || l.from === "cue-caster"), "W3 no Ball");
  done.push("W3 paid stagger no Ball");
  const w4 = find(raw, "W4");
  assert(w4.final.phase === "ended", "W4 ended");
  assert((w4.rows ?? []).some((r) => r.sourceFx?.some((f) => f.kind === "death" && f.id === "cue-caster")), "W4 real death FX");
  assert(!(w4.rows ?? []).some((r) => r.sourceFx?.some((f) => f.kind === "projStart") && false), "W4 no fabricated launch");
  done.push("W4 real death/end");
  const w5 = find(raw, "W5");
  assert(fxKinds(w5).filter((k) => /windup/i.test(k)).length >= 1, "W5 wand windup");
  assert((w5.rows ?? []).some((r) => r.time > w5.C + 300), "W5 tail");
  done.push("W5 chronological second lifecycle");
  return done;
}
export function verify(raw) {
  const done = checks(raw);
  const verification = { format: "rh-p15-protection-cues-verification/1", status: "PASS", checks: done, cases: raw.cases.length, temporalFrames: raw.cases.reduce((n, c) => n + (c.temporal?.length ?? 0), 0), sourceCode: raw.profile.code, limits: ["finite source method witness only", "controls/frozen/native/P15/live UNRUN", "no renderer/private-memory/foreign-deadline claim"] };
  const canonical = { format: "rh-p15-protection-cues-source/1", profile: raw.profile, cases: raw.cases, verification };
  return { canonical, verification };
}

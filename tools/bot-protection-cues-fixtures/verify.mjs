// Pure tool codec/verifier; no game-source imports or installed expected outcomes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const IDS = ["P0", "P1", "B0", "B1", "B2", "W0", "W1", "W2", "W3", "W4", "W5"];
const C = "cue-caster", O = "cue-observer", THIRD = "cue-other";
const BASE = "bb564d3b53728cbd205af375b5342eca466f3656";
const MAP_SHA = "5ee388ca61234bae0e7dc04adca00702fbc6199f048487490fcbca25b2cffb16";
const FRAME_KEYS = ["t", "self", "hud", "fighters", "mobs", "containers", "projectiles", "minimap", "events", "immediate", "extras"];
const TYPED = { Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array };
const sha = (b) => createHash("sha256").update(b).digest("hex");
const f64bits = (n) => { const b = Buffer.alloc(8); b.writeDoubleBE(n); return b.toString("hex"); };
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function object(entries) {
  const out = {};
  for (const [k, v] of entries) { assert.equal(typeof k, "string"); assert(!has(out, k), "duplicate object key");
    Object.defineProperty(out, k, { value: v, writable: true, enumerable: true, configurable: true }); }
  return out;
}
// Exactly one whole-result encoding at the runtime boundary. A genuine object with a reserved key is escaped,
// so source data cannot impersonate a tag. Explicit undefined properties and sparse-array holes differ.
export function encodeRaw(raw) {
  const active = new Set();
  function encode(v, depth = 0) {
    assert(depth < 256, "tag codec depth");
    if (v === undefined) return { $rh: "undefined" };
    if (typeof v === "number") {
      if (Number.isNaN(v)) return { $rh: "number", value: "NaN" };
      if (!Number.isFinite(v)) return { $rh: "number", value: v > 0 ? "Infinity" : "-Infinity" };
      return Object.is(v, -0) ? { $rh: "number", value: "-0" } : v;
    }
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    assert.equal(typeof v, "object", "unsupported non-data value in raw");
    assert(!active.has(v), "cycle in raw"); active.add(v);
    let out;
    if (v instanceof Map) out = { $rh: "map", entries: [...v].map(([k, x]) => [encode(k, depth + 1), encode(x, depth + 1)]) };
    else if (v instanceof Set) out = { $rh: "set", values: [...v].map((x) => encode(x, depth + 1)) };
    else if (ArrayBuffer.isView(v)) {
      const type = v.constructor.name; assert(has(TYPED, type), "unsupported typed array");
      out = { $rh: "typed", type, values: Array.from(v, (x) => encode(x, depth + 1)) };
    } else if (Array.isArray(v)) {
      out = [];
      for (let i = 0; i < v.length; i++) out.push(has(v, i) ? encode(v[i], depth + 1) : { $rh: "hole" });
    } else {
      assert(Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null, "raw must be copied plain data");
      const entries = Object.entries(v).map(([k, x]) => [k, encode(x, depth + 1)]);
      out = has(v, "$rh") ? { $rh: "object", entries } : object(entries);
    }
    active.delete(v); return out;
  }
  return encode(raw);
}
export function decodeRaw(encoded) {
  function exact(v, keys) { assert.deepEqual(Object.keys(v).sort(), keys.sort(), "invalid tag fields"); }
  function pairs(entries, depth, values) {
    assert(Array.isArray(entries)); return entries.map((e) => { assert(Array.isArray(e) && e.length === 2);
      return [values ? decode(e[0], depth + 1) : e[0], decode(e[1], depth + 1)]; });
  }
  function decode(v, depth = 0) {
    assert(depth < 256, "tag codec depth");
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number") { assert(Number.isFinite(v) && !Object.is(v, -0), "untagged special number"); return v; }
    assert(v && typeof v === "object", "invalid serialized data");
    if (Array.isArray(v)) {
      const out = new Array(v.length);
      v.forEach((x, i) => { if (x && !Array.isArray(x) && x.$rh === "hole") exact(x, ["$rh"]); else out[i] = decode(x, depth + 1); });
      return out;
    }
    if (!has(v, "$rh")) return object(Object.entries(v).map(([k, x]) => [k, decode(x, depth + 1)]));
    switch (v.$rh) {
      case "undefined": exact(v, ["$rh"]); return undefined;
      case "number": exact(v, ["$rh", "value"]); assert(["NaN", "Infinity", "-Infinity", "-0"].includes(v.value));
        return { NaN, Infinity, "-Infinity": -Infinity, "-0": -0 }[v.value];
      case "object": exact(v, ["$rh", "entries"]); return object(pairs(v.entries, depth, false));
      case "map": { exact(v, ["$rh", "entries"]); const ps = pairs(v.entries, depth, true), m = new Map(ps);
        assert.equal(m.size, ps.length, "duplicate map key"); return m; }
      case "set": { exact(v, ["$rh", "values"]); assert(Array.isArray(v.values)); const xs = v.values.map((x) => decode(x, depth + 1)), s = new Set(xs);
        assert.equal(s.size, xs.length, "duplicate set value"); return s; }
      case "typed": { exact(v, ["$rh", "type", "values"]); assert(has(TYPED, v.type) && Array.isArray(v.values));
        const xs = v.values.map((x) => decode(x, depth + 1)); assert(xs.every((x) => typeof x === "number"));
        const a = new TYPED[v.type](xs); assert(xs.every((x, i) => Object.is(a[i], x)), "lossy typed tag"); return a; }
      default: throw new Error("unknown/out-of-place tag " + v.$rh);
    }
  }
  return decode(encoded);
}
// Pure indexing of ACTUAL public codec output, in perception's order: batch.p, then FX tuples.
// Full unannounced projEnd has9 fields. Short6's decoded x0/y0/t0 are defaults, never a birth.
// Preserve the actual source form; an embedded end carries NO original velocity/range/course.
export function publicProjectileObservations(batch, decodedFx, decodedLaunches, deliveryTime, deliveryTick) {
  if (batch === null) { assert.equal(decodedFx.length, 0); assert.equal(decodedLaunches.length, 0); return []; }
  assert.equal(batch.t, deliveryTime); assert(Array.isArray(batch.l));
  assert.equal(decodedFx.length, batch.l.length, "valid actual source FX must decode in exact tuple order");
  assert(batch.p === undefined || Array.isArray(batch.p), "actual launch tuple list shape");
  assert.equal(decodedLaunches.length, batch.p?.length ?? 0, "valid actual launch tuple must decode");
  const observations = decodedLaunches.map((value, tupleIndex) => ({ source: "batch.p", tupleIndex,
    tuple: structuredClone(batch.p[tupleIndex]), value: structuredClone(value), deliveryTime, deliveryTick }));
  for (let tupleIndex = 0; tupleIndex < decodedFx.length; tupleIndex++) {
    const value = decodedFx[tupleIndex]; if (value.kind !== "projEnd") continue;
    const tuple = batch.l[tupleIndex]; assert(Array.isArray(tuple) && tuple[0] === 5, "projEnd codec tag mismatch");
    assert(tuple.length === 6 || tuple.length === 9, "unsupported actual projEnd tuple form");
    observations.push({ source: tuple.length === 9 ? "projEnd.embedded" : "projEnd.short", tupleIndex,
      tuple: structuredClone(tuple), value: structuredClone(value), deliveryTime, deliveryTick });
  }
  return observations;
}
export function indexPublicProjectileObservation(index, observation) {
  const v = observation.value;
  const id = v.id; assert.equal(typeof id, "string"); assert(id.length > 0);
  if (observation.source === "projEnd.short") {
    assert(index.has(id), "dangling short projEnd has no prior actual public birth: " + id);
    assert.equal(index.get(id).kind, v.proj);
    if (v.ownerId !== undefined) assert.equal(index.get(id).ownerId, v.ownerId);
    return;
  }
  assert(observation.source === "batch.p" || observation.source === "projEnd.embedded");
  const kind = observation.source === "batch.p" ? v.kind : v.proj;
  const bornAt = observation.source === "batch.p" ? v.t : v.t0;
  assert(kind === "arrow" || kind === "ball"); assert(Number.isFinite(bornAt) && bornAt <= observation.deliveryTime);
  // This fixed profile has no reflected arrows. Missing public ownership cannot prove a caster absence.
  assert.equal(typeof v.ownerId, "string", "fixed unreflected profile requires actual public owner metadata");
  let birth = index.get(id);
  if (!birth) {
    birth = { id, kind, bornAt, ownerId: v.ownerId, firstDeliveryTime: observation.deliveryTime,
      firstDeliveryTick: observation.deliveryTick, forms: [] }; index.set(id, birth);
  } else {
    assert.equal(birth.kind, kind); assert.equal(birth.bornAt, bornAt); assert.equal(birth.ownerId, v.ownerId);
  }
  assert(!birth.forms.some((f) => f.source === observation.source && f.deliveryTick === observation.deliveryTick
    && f.tupleIndex === observation.tupleIndex), "duplicate source-form observation");
  birth.forms.push(structuredClone(observation));
}
const row = (c, time) => { const xs = c.rows.filter((r) => r.time === time); assert.equal(xs.length, 1, c.caseId + " missing exact row " + time); return xs[0]; };
const view = (c, id, time) => { const xs = c.temporal.filter((v) => v.viewerId === id && v.time === time); assert.equal(xs.length, 1, c.caseId + " missing exact viewer row"); return xs[0]; };
const own = (c, id, time) => { const p = row(c, time).ownerFields.find((x) => x.id === id); assert(p); return p; };
const diag = (c, id, time) => { const p = row(c, time).sourceDiagnostic.players.find((x) => x.id === id); assert(p); return p; };
const sourceFx = (c, pred) => c.rows.flatMap((r) => r.sourceFx.map((f) => ({ ...f, t: r.time, tick: r.tick }))).filter(pred);
const births = (c, kind) => c.birthRecords.filter((l) => l.ownerId === C && (!kind || l.kind === kind));
const delivered = (c, viewer, pred) => c.temporal.filter((v) => v.viewerId === viewer && v.filtered !== null)
  .flatMap((v) => v.filtered.events.filter(pred).map((e) => ({ event: e, deliveryTime: v.time, memory: v.memory, percept: v.filtered })));
const stimuli = (c, viewer, kind, subject) => c.temporal.filter((v) => v.viewerId === viewer)
  .flatMap((v) => v.stimuli.filter((s) => s.kind === kind && s.subject === subject).map((s) => ({ ...s, time: v.time })));
const casterWindups = (c) => sourceFx(c, (f) => f.kind === "windup" && f.by === C && f.weapon === "wand");
const cueKey = (e) => ({ kind: e.kind, t: e.t, id: e.id ?? null, by: e.by ?? null });
function visibleCueOrder(c, viewer, pred) {
  assert.deepEqual(delivered(c, viewer, pred).map((d) => cueKey(d.event)), sourceFx(c, pred).map(cueKey),
    c.caseId + " exact original cue identity/time/occurrence/order through delayed filter");
}
function order(c, actor, type, time) { const xs = row(c, time).orders.filter((o) => o.actor === actor && o.type === type);
  assert.equal(xs.length, 1, `${c.caseId} queued ${actor}/${type}/${time}`); return xs[0]; }
function tail(c, terminal) { assert(c.rows.at(-1).time >= terminal + 300, c.caseId + " missing300ms delivery tail"); }
function hit(c, time) {
  const hits = sourceFx(c, (f) => f.kind === "hit" && f.id === C && f.by === O && f.weapon === "sword" && f.amount > 0 && !f.passive);
  assert.equal(hits.length, 1, c.caseId + " actual paid Sword hit"); assert.equal(hits[0].t, time);
  assert(own(c, C, time).hp < own(c, C, time - 50).hp, c.caseId + " paid hit must reduce real hp"); return hits[0];
}
function wandStart(c) {
  const w = casterWindups(c); assert(w.length > 0 && w[0].t === c.C, c.caseId + " missing real initial Wand windup");
  const a = diag(c, C, c.C).action; assert(a && a.kind === "cast" && a.weapon === "wand" && a.startedAt === c.C && a.landsAt > c.C);
  assert.equal(w[0].ms, a.landsAt - c.C); return a;
}
function oneBirth(c, kind, exclusive = true) {
  const ls = births(c, exclusive ? undefined : kind); assert.equal(ls.length, 1, c.caseId + " exact one actual public caster birth"); assert.equal(ls[0].kind, kind);
  assert(ls[0].bornAt >= c.C && ls[0].firstDeliveryTime >= ls[0].bornAt); tail(c, ls[0].firstDeliveryTime); return ls[0];
}
function bowStart(c) {
  const p = own(c, C, c.C), a = diag(c, C, c.C).action;
  assert.equal(p.drawStartedAt, c.C); assert(a && a.kind === "draw" && a.weapon === "bow" && a.landsAt > c.C);
  assert.equal(sourceFx(c, (f) => f.kind === "windup" && f.by === C && f.weapon === "bow").length, 0, "Bow announces synced draw, not windupFX");
  return a;
}
function preflight(raw, prefix = false) {
  assert.equal(raw.format, "rh-p15-protection-cues-raw/2");
  assert(prefix ? raw.status === "running" : raw.status === "ok", raw.error);
  assert.equal(raw.profile.sourceBase, BASE); assert.match(raw.profile.driverCode, /^[0-9a-f]{40}$/);
  assert.equal(raw.serialization.codec, "rh-tagged-value/1"); assert.equal(raw.profile.map.sha256, MAP_SHA);
  assert(raw.cases.length > 0 && raw.cases.length <= 11);
  assert.deepEqual(raw.cases.map((c) => c.caseId), prefix ? IDS.slice(0, raw.cases.length) : IDS); assert.equal(raw.profile.dtMs, 50);
  assert.equal(raw.profile.views.worldDelayMs, 125); assert.equal(raw.profile.views.selfDelayMs, 0);
  for (const c of raw.cases) {
    assert.equal(c.status, "ok", `${c.caseId}: ${c.error}`);
    assert.deepEqual(c.spec.viewers, [C, O]); assert.deepEqual(c.spec.seats, c.caseId === "W0" ? [C, O, THIRD] : [C, O]);
    assert.deepEqual(c.assembler.config, { minPlayers: c.spec.seats.length, lobbySeconds: 0, fillSeconds: 0, planSeconds: 0,
      firstPatienceSeconds: 1, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 60, training: false,
      dummies: false, mobs: false, quests: false, hazards: false, regen: false });
    assert.deepEqual(c.assembler.modules, { signatures: false, walkHints: false });
    assert.equal(c.assembler.actualMapIdentity.seed, c.composition.map.seed);
    assert.equal(c.assembler.actualMapIdentity.attempt, c.composition.map.attempt); assert.equal(c.steps, 96); assert.equal(c.rows.length, c.steps);
    assert.equal(c.temporal.length, c.steps * 2); assert.equal(c.temporalCount, c.temporal.length);
    assert(c.T > 0 && c.U > c.T && c.C === c.U + 50); assert.equal(c.composition.worldDelayMs, 125);
    assert.equal(c.composition.selfDelayMs, 0); assert.equal(c.composition.mapInput.sha256, MAP_SHA);
    const { selfDelayMs, worldDelayMs, attentionCentral, features, mapSha256 } = c.composition;
    assert.equal(sha(JSON.stringify({ selfDelayMs, worldDelayMs, attentionCentral, features, mapSha256 })), c.composition.sha256);
    const m = c.composition.map; assert(m.w > 0 && m.h > 0 && m.coliseum && Array.isArray(m.camps));
    for (const k of ["tiles", "terrain", "regionGrid", "territoryGrid", "featureGrid"]) assert(m[k] instanceof Uint8Array && m[k].length === m.w * m.h);
    assert.equal(c.declared.filter((p) => p.stage === "joined").length, c.spec.seats.length);
    const declared = c.declared.filter((p) => p.stage === "declared-before-first-step");
    assert.equal(declared.length, c.spec.seats.length);
    for (const p of declared) { assert.equal(p.tick, 0); assert.equal(p.time, 0); assert.equal(p.immuneUntil, 0);
      assert.equal(p.slot, 0); assert.equal(p.bot, false); assert.equal(p.faction, p.id === C ? "holy" : "fire");
      assert.equal(p.weapon0, c.spec.loadouts[p.id].weapon0 ?? "");
      assert.equal(p.weapon1, c.spec.loadouts[p.id].weapon1 ?? "");
      if (c.caseId === "W4" && p.id === C) assert.equal(p.hp, 1); else assert.equal(p.hp, p.maxHp); }
    assert.equal(sourceFx(c, (f) => f.kind === "teleport").length, 1);
    assert.equal(row(c, c.T).teleport, true); assert(c.prerequisites.los && c.prerequisites.movementLos);
    assert(c.prerequisites.distance <= c.prerequisites.swordReach && c.prerequisites.gatesLocked && c.prerequisites.inColiseum);
    assert.deepEqual(c.prerequisites.standing, c.spec.seats);
    let arrivals = 0; const publicBirthIndex = new Map();
    for (let i = 0; i < c.steps; i++) {
      const r = c.rows[i]; assert.equal(r.time, (i + 1) * 50); assert.equal(r.tick, i + 1); assert.equal(r.step, i + 1);
      assert.equal(r.caseId, c.caseId); assert(Array.isArray(r.sourceEvents) && Array.isArray(r.sourceFx));
      const observed = publicProjectileObservations(r.fx.batch, r.fx.unpackedFx, r.fx.launches, r.time, r.tick);
      assert.deepEqual(r.fx.projectileObservations, observed, "actual public birth/end source forms");
      for (const observation of observed) indexPublicProjectileObservation(publicBirthIndex, observation);
      assert.deepEqual(r.fx.unpackedFx.map(cueKey), r.sourceFx.map((f) => cueKey({ ...f, t: r.time })),
        "actual source -> packed -> unpacked cue occurrence/identity/order");
      assert.match(r.schema.bytesBase64, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
      const wire = Buffer.from(r.schema.bytesBase64, "base64"); assert.equal(wire.toString("base64"), r.schema.bytesBase64);
      assert.equal(wire.length, r.schema.byteLength); assert.equal(sha(wire), r.schema.sha256);
      for (let j = 0; j < 2; j++) {
        const v = c.temporal[i * 2 + j]; assert.equal(v.step, i + 1); assert.equal(v.tick, r.tick); assert.equal(v.time, r.time);
        assert.equal(v.viewerId, c.spec.viewers[j]); assert.equal(v.viewerOrder, j); assert.equal(v.composeConfigSha256, c.composition.sha256);
        assert.deepEqual(Object.keys(v.frame).sort(), [...FRAME_KEYS].sort()); assert.equal(v.frame.t, r.time);
        assert.equal(v.frame.self.id, v.viewerId); assert(!v.frame.fighters.some((f) => f.id === v.viewerId));
        const p = own(c, v.viewerId, r.time);
        for (const k of ["immuneUntil", "readyAt", "drawStartedAt", "slot", "moveSeq"]) assert.equal(v.frame.self[k], p[k]);
        assert(v.memory.fighters instanceof Map && v.memory.self && Array.isArray(v.stimuli));
        assert.deepEqual(v.memory.stimuli, v.stimuli);
        if (r.time < 175) { assert.equal(v.composed, null); assert.equal(v.filtered, null); }
        else { assert(v.composed && v.filtered); assert.equal(v.composed.now, r.time); assert.equal(v.composed.viewT, r.time - 125);
          assert.equal(v.filtered.now, v.composed.now); assert.equal(v.filtered.viewT, v.composed.viewT); }
      }
      if (c.caseId !== "W4") { assert.equal(r.phase, "active"); for (const p of r.ownerFields) assert.equal(p.status, "alive"); }
      for (const o of r.orders) {
        assert.equal(o.arrivalOrder, ++arrivals); assert.equal(o.accepted, true); assert.equal(o.scheduleFor, r.time);
        assert.equal(o.arrivalTime, r.time - 50); assert.equal(o.arrivalTick, r.tick - 1); assert(r.time > c.T);
        assert.equal(o.publicBasis.time, o.arrivalTime);
        const inputView = view(c, o.actor, o.arrivalTime).frame;
        assert.deepEqual(o.publicBasis.actor, { x: inputView.self.x, y: inputView.self.y });
        if (o.publicBasis.targetId !== undefined) {
          const seenTarget = inputView.fighters.find((f) => f.id === o.publicBasis.targetId); assert(seenTarget && o.publicBasis.targetVisible);
          assert.deepEqual(o.publicBasis.target, { x: seenTarget.x, y: seenTarget.y });
          if (o.type === "target") assert.equal(o.msg.id, o.publicBasis.targetId);
          else assert.equal(o.msg.a, Math.atan2(seenTarget.y - inputView.self.y, seenTarget.x - inputView.self.x));
        }
        if (o.type === "move") assert.deepEqual(o.msg, { x: inputView.self.x, y: inputView.self.y, seq: 1 });
        if (o.terminalCleanup) {
          assert.equal(c.caseId, "W4"); assert.equal(o.actor, O); assert.equal(o.type, "release"); assert.equal(r.time, c.C + 100);
          assert.equal(o.arrivalPhase, "ended"); assert.equal(r.phase, "ended"); assert.equal(o.applyTime, null); assert.equal(o.applyTick, null);
          assert.equal(o.unappliedReason, "Ended: source step advances clock but does not drain inputs");
        } else {
          assert.equal(o.arrivalPhase, "active"); assert.equal(o.applyTime, r.time); assert.equal(o.applyTick, r.tick);
          const ds = c.inputDrains.filter((d) => d.actor === o.actor && d.time === r.time && d.tick === r.tick);
          assert.equal(ds.length, 1); const d = ds[0].drained;
          assert(o.type === "move" || o.type === "stop" ? d.move?.kind === o.type : d.actions.some((a) => a.kind === o.type));
        }
      }
      const tape = c.randomTape.filter((d) => d.time <= r.time); assert.equal(r.rng.draws, tape.length);
      for (const name of ["main", "reward", "quest"]) assert.equal(r.rng.counts[name], tape.filter((d) => d.stream === name).length);
    }
    assert.equal(c.pendingOrders.length, 0); assert.equal(c.pendingStep, null);
    const q = (actor, type, time) => ({ actor, type, time });
    const attacks = [q(C, "attack", c.C), q(C, "release", c.C + 50)];
    let expected;
    switch (c.caseId) {
      case "P0": expected = []; break;
      case "P1": expected = [q(O, "attack", c.T + 50), q(O, "release", c.T + 100), q(O, "attack", c.U), q(O, "release", c.U + 50)]; break;
      case "B0": expected = attacks; break;
      case "B1": expected = [q(C, "attack", c.C), q(C, "swap", c.C + 150), q(C, "release", c.C + 200)]; break;
      case "B2": case "W3": case "W4": expected = [...attacks, q(O, "attack", c.C + 50), q(O, "release", c.C + 100)]; break;
      case "W0": expected = [q(C, "target", c.C), q(C, "target", c.C + 50), q(C, "swap", c.C + 100), q(C, "release", c.C + 150)]; break;
      case "W1": case "W2": expected = [q(C, "target", c.C), q(C, c.caseId === "W1" ? "stop" : "move", c.C + 50)]; break;
      case "W5": assert(c.secondSchedule, "W5 missing genuine public-ready second schedule");
        expected = [...attacks, q(C, "attack", c.secondSchedule.observedAt + 50), q(C, "swap", c.secondSchedule.observedAt + 100)]; break;
      default: throw new Error("unknown case");
    }
    assert.deepEqual(c.rows.flatMap((r) => r.orders.map((o) => q(o.actor, o.type, r.time))), expected.sort((a, b) => a.time - b.time),
      "exact declared queued recipe/arrival order; no extra or missing commands");
    assert.deepEqual(c.birthRecords, [...publicBirthIndex.values()], "complete deduplicated public birth union, no invented embedded course");
    assert(c.birthRecords.every((b) => c.spec.seats.includes(b.ownerId)), "fixed profile birth owner must be an actual declared public seat");
    assert.deepEqual(c.launchRecords, c.rows.flatMap((r) => r.fx.launches.map((l) => ({ ...l, deliveryTime: r.time, deliveryTick: r.tick }))));
    assert.equal(new Set(c.launchRecords.map((l) => l.id)).size, c.launchRecords.length);
    const seen = { main: 0, reward: 0, quest: 0 };
    for (const d of c.randomTape) { assert(has(seen, d.stream)); assert.equal(d.ordinal, ++seen[d.stream]);
      assert.equal(d.bits, f64bits(d.value)); assert(d.value >= 0 && d.value < 1);
      if (d.phase === "constructor") assert.equal(d.time, 0); else assert.equal(d.time, d.tick * 50); }
    assert.equal(c.randomTape[0].stream, "main"); assert.equal(c.randomTape[0].phase, "constructor");
    for (const k of ["reward", "quest"]) assert.match(c.rngScope[k], /post-constructor.*UNOBSERVED/);
  }
}
function checks(raw, prefix = false) {
  preflight(raw, prefix); const done = [raw.cases.length + " completed exact96-step cases; complete codec/frame/config/wire/input/RNG preflight"];
  const get = (id) => raw.cases.find((c) => c.caseId === id);
  const p0 = get("P0");
  assert.equal(own(p0, C, p0.T - 50).immuneUntil, 0);
  for (const time of [p0.T, p0.T + 50, p0.T + 100, p0.U - 50, p0.U, p0.U + 50, p0.U + 100, p0.U + 150]) {
    assert.equal(own(p0, C, time).immuneUntil, p0.U, "owner deadline retained after expiry");
    const f = view(p0, O, time).frame.fighters.find((f) => f.id === C); assert(f, "remote caster genuinely visible");
    assert.equal(f.immune, [p0.T + 100, p0.U - 50, p0.U, p0.U + 50].includes(time), "exact remote lower/upper guard");
  }
  done.push("P0 genuine before/positive/past owner deadline and exact remote guard boundaries");
  const p1 = get("P1"); if (p1) { order(p1, O, "attack", p1.T + 50); order(p1, O, "release", p1.T + 100);
  assert.equal(own(p1, C, p1.T + 50).hp, own(p1, C, p1.T).hp);
  assert.equal(sourceFx(p1, (f) => f.kind === "hit" && f.id === C && f.t < p1.U).length, 0);
  order(p1, O, "attack", p1.U); order(p1, O, "release", p1.U + 50); hit(p1, p1.U); tail(p1, p1.U);
  done.push("P1 protected attempt then distinct actual unprotected paid Sword hit"); }
  for (const id of ["B0", "B1", "B2"].filter((id) => get(id))) {
    const c = get(id); bowStart(c); order(c, C, "attack", c.C);
    if (id === "B2") { hit(c, c.C + 50); assert.equal(diag(c, C, c.C + 50).action?.kind, "draw");
      assert(own(c, C, c.C + 50).drawStartedAt > 0); assert.equal(sourceFx(c, (f) => f.kind === "stagger" && f.id === C).length, 0); }
    if (id !== "B1") {
      order(c, C, "release", c.C + 50); const l = oneBirth(c, "arrow");
      assert.equal(own(c, C, l.firstDeliveryTime).drawStartedAt, 0); assert.equal(diag(c, C, l.firstDeliveryTime).action, null);
      assert.equal(stimuli(c, O, "drawAtMe", C).length, 1, "actual draw cue dedupe");
      assert(stimuli(c, O, "incoming", l.id).length > 0, "actual incoming Arrow cue");
    } else {
      assert(own(c, C, c.C + 100).drawStartedAt > 0); order(c, C, "swap", c.C + 150);
      assert.equal(own(c, C, c.C + 150).slot, 1); assert.equal(own(c, C, c.C + 150).weapon1, "wand");
      assert.equal(own(c, C, c.C + 150).drawStartedAt, 0); assert.equal(diag(c, C, c.C + 150).action, null);
      assert.equal(births(c, "arrow").length, 0); assert.equal(sourceFx(c, (f) => f.kind === "cancel" && f.id === C).length, 0); tail(c, c.C + 150);
    }
    done.push(id + " actual Bow draw/release or paid-hit/swap positive and launch discrimination");
  }
  for (const id of ["W0", "W1", "W2", "W3", "W4", "W5"].filter((id) => get(id))) wandStart(get(id));
  const w0 = get("W0"); if (w0) { order(w0, C, "target", w0.C); order(w0, C, "target", w0.C + 50);
  assert.equal(diag(w0, C, w0.C).action.target, O);
  const cancels = sourceFx(w0, (f) => f.kind === "cancel" && f.id === C); assert.equal(cancels.length, 1); assert.equal(cancels[0].t, w0.C + 50);
  const replacement = diag(w0, C, w0.C + 50).action;
  if (replacement !== null) { assert.equal(replacement.kind, "cast"); assert.equal(replacement.target, THIRD); }
  const replacementWindups = casterWindups(w0).filter((f) => f.t !== w0.C);
  assert(replacementWindups.every((f) => f.t === w0.C + 50)); assert.equal(replacementWindups.length, replacement === null ? 0 : 1);
  order(w0, C, "swap", w0.C + 100);
  assert.equal(own(w0, C, w0.C + 100).slot, 1); assert.equal(diag(w0, C, w0.C + 100).action, null); assert.equal(births(w0, "ball").length, 0);
  const winds = delivered(w0, O, (e) => e.kind === "windup" && e.by === C && e.weapon === "wand" && e.t === w0.C);
  const cancelDeliveries = delivered(w0, O, (e) => e.kind === "cancel" && e.id === C);
  assert.equal(winds.length, 1); assert.equal(cancelDeliveries.length, 1); assert(winds[0].deliveryTime < cancelDeliveries[0].deliveryTime);
  assert(stimuli(w0, O, "windupAtMe", C).length > 0);
  const cd = cancelDeliveries[0], before = view(w0, O, cd.deliveryTime - 50).memory.fighters.get(C), after = cd.memory.fighters.get(C);
  assert(before && after); assert.equal(after.feints, before.feints + 1); assert.equal(after.lastFeintAt, w0.C + 50); tail(w0, cd.deliveryTime);
  visibleCueOrder(w0, O, (e) => (e.kind === "windup" && e.by === C) || (e.kind === "cancel" && e.id === C));
  done.push("W0 exact real retarget cancel and observer feint, not nonexistent cancel stimulus"); }
  for (const id of ["W1", "W2"].filter((id) => get(id))) {
    const c = get(id), a = diag(c, C, c.C).action; assert.equal(a.target, O);
    order(c, C, "target", c.C); order(c, C, id === "W1" ? "stop" : "move", c.C + 50);
    assert.equal(own(c, C, c.C + 50).attackTarget, ""); assert.equal(own(c, C, c.C + 50).moveSeq, 1);
    assert.deepEqual(diag(c, C, c.C + 50).action, a, "same committed cast survives order");
    assert.equal(sourceFx(c, (f) => f.kind === "cancel" && f.id === C).length, 0); oneBirth(c, "ball");
    done.push(id + " actual lock/seq drop preserves committed cast and Ball");
  }
  const w3 = get("W3"); if (w3) { const a3 = diag(w3, C, w3.C).action; hit(w3, w3.C + 50);
  const sg = sourceFx(w3, (f) => f.kind === "stagger" && f.id === C); assert.equal(sg.length, 1); assert.equal(sg[0].t, w3.C + 50);
  assert.equal(diag(w3, C, w3.C + 50).action, null); assert.equal(own(w3, C, w3.C + 50).status, "alive");
  assert.equal(own(w3, C, w3.C + 50).readyAt, own(w3, C, w3.C).readyAt); assert(a3.landsAt > sg[0].t);
  assert.equal(births(w3, "ball").length, 0); assert.equal(delivered(w3, O, (e) => e.kind === "stagger" && e.id === C).length, 1); tail(w3, sg[0].t);
  assert(stimuli(w3, O, "windupAtMe", C).length > 0);
  visibleCueOrder(w3, O, (e) => (e.kind === "windup" && e.by === C) || (e.kind === "hit" && e.id === C && e.by === O) || (e.kind === "stagger" && e.id === C));
  done.push("W3 paid Sword/windup/stagger, standing/cooldown retained and no Ball"); }
  const w4 = get("W4"); if (w4) { hit(w4, w4.C + 50);
  const deaths = sourceFx(w4, (f) => f.kind === "death" && f.id === C && f.by === O); assert.equal(deaths.length, 1); assert.equal(deaths[0].t, w4.C + 50);
  assert.equal(row(w4, deaths[0].t).phase, "ended"); assert.equal(own(w4, C, deaths[0].t).status, "dead");
  assert.equal(diag(w4, C, deaths[0].t).action, null); assert.equal(own(w4, C, deaths[0].t).drawStartedAt, 0);
  assert.equal(sourceFx(w4, (f) => f.kind === "stagger" && f.id === C).length, 0); assert.equal(births(w4, "ball").length, 0);
  const dd = delivered(w4, O, (e) => e.kind === "death" && e.id === C); assert.equal(dd.length, 1); assert.equal(dd[0].event.t, deaths[0].t);
  const dead = dd[0].memory.fighters.get(C); assert(dead && dead.alive === false && dead.diedAt !== null);
  assert(delivered(w4, O, (e) => e.kind === "victory").length === 1); assert(row(w4, deaths[0].t).sourceEvents.some((e) => e.type === "raidEnded"));
  assert.equal(order(w4, O, "release", w4.C + 100).terminalCleanup, true); tail(w4, dd[0].deliveryTime);
  visibleCueOrder(w4, O, (e) => (e.kind === "windup" && e.by === C) || (e.kind === "hit" && e.id === C && e.by === O) || (e.kind === "death" && e.id === C) || e.kind === "victory");
  done.push("W4 real paid death/end/action cleanup, delayed observer death and zero Ball; terminal release honestly unapplied"); }
  const w5 = get("W5"); if (w5) { const l5 = oneBirth(w5, "ball", false), firstAction = diag(w5, C, w5.C).action;
  assert.equal(raw.profile.sourceWeaponTieEpsMs, 1e-6);
  const eps = raw.profile.sourceWeaponTieEpsMs;
  const before = w5.rows.filter((r) => r.time + eps < firstAction.landsAt).at(-1), afterDue = w5.rows.find((r) => r.time + eps >= firstAction.landsAt);
  assert(before && afterDue && afterDue.time - before.time === 50); assert.equal(diag(w5, C, before.time).action?.landsAt, firstAction.landsAt);
  assert.equal(l5.firstDeliveryTime, afterDue.time); assert.equal(l5.bornAt, afterDue.time, "source stamps actual ordinary launch time");
  const sc = w5.secondSchedule; assert(sc && sc.observedAt >= l5.firstDeliveryTime + 300 && sc.observedAt >= sc.ownerReadyAt);
  assert.equal(sc.firstBirthDeliveryTime, l5.firstDeliveryTime);
  assert.equal(sc.ownerReadyAt, own(w5, C, sc.observedAt).readyAt);
  order(w5, C, "attack", sc.observedAt + 50); order(w5, C, "swap", sc.observedAt + 100);
  const second = casterWindups(w5).filter((f) => f.t === sc.observedAt + 50); assert.equal(second.length, 1);
  assert.equal(own(w5, C, sc.observedAt + 100).slot, 1); assert.equal(own(w5, C, sc.observedAt + 100).weapon1, "bow");
  assert.equal(diag(w5, C, sc.observedAt + 100).action, null);
  const delayedSecond = delivered(w5, O, (e) => e.kind === "windup" && e.by === C && e.weapon === "wand" && e.t === second[0].t);
  assert.equal(delayedSecond.length, 1); assert(delayedSecond[0].deliveryTime > sc.observedAt + 100);
  assert.equal(delayedSecond[0].percept.fighters.find((f) => f.id === C)?.inHand, "bow");
  assert.equal(births(w5, "ball").length, 1, "no second Ball"); tail(w5, delayedSecond[0].deliveryTime);
  visibleCueOrder(w5, O, (e) => e.kind === "windup" && e.by === C);
  done.push("W5 one chronological first deadline/launch/ready wait/second swapped-hand delayed windup; no second Ball"); }
  return done;
}
// Shared producer-precondition reads: stop the fixed World sequence at its first failed case.
// This never publishes canonical bytes; the runtime still writes raw BEFORE the final verify below.
export function checkCompletedPrefix(nativeRaw) { return checks(nativeRaw, true); }
export function verify(serialized) {
  const raw = decodeRaw(serialized);
  // This also proves the exact serialized form is canonical for the codec (including escaped tags and omissions).
  assert.deepEqual(encodeRaw(raw), serialized, "noncanonical tagged raw");
  const frozen = raw.profile?.frozenBuild;
  assert(frozen && frozen.code === raw.profile.driverCode && frozen.sourceBase === raw.profile.sourceBase, "frozen runtime provenance");
  assert.match(frozen.manifestSha256, /^[0-9a-f]{64}$/); assert.match(frozen.bundle?.sha256, /^[0-9a-f]{64}$/);
  assert.equal(frozen.mapInput?.sha256, MAP_SHA);
  const done = checks(raw);
  const verification = { format: "rh-p15-protection-cues-verification/2", status: "PASS", checks: done, cases: raw.cases.length,
    temporalFrames: raw.cases.reduce((n, c) => n + c.temporal.length, 0), sourceBase: raw.profile.sourceBase, driverCode: raw.profile.driverCode,
    limits: ["finite declared source-method inputs", "no socket/renderer/Brain/P15/native claim", "constructor reward/quest prefixes UNOBSERVED",
      "W4 post-Ended release accepted but unapplied", "controls/bytecheck/frozen export UNRUN"] };
  return { canonical: { format: "rh-p15-protection-cues-source/2", profile: serialized.profile, cases: serialized.cases,
    serialization: serialized.serialization, verification }, verification };
}

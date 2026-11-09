// CODE-ONLY fixed source producer. Only the approved runtime imports/calls capture.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Encoder, Decoder } from "@colyseus/schema";
import * as S from "@raid/shared";
import { RaidState, PlayerState } from "../../packages/shared/src/schema.ts";
import { createGameWorld } from "../../packages/server/src/sim/gameplay.ts";
import { addPlayer, step } from "../../packages/server/src/sim/step.ts";
import { enqueueClientMessage } from "../../packages/server/src/sim/inputs.ts";
import { TIE_EPS_MS } from "../../packages/server/src/sim/weapons.ts";
import { FxChannel } from "../../packages/server/src/rooms/FxChannel.ts";
import { BotVision } from "../../packages/server/src/bots/brain/vision.ts";
import { createFrameRing } from "../../packages/server/src/bots/brain/frames.ts";
import { detectFeatures, perceive } from "../../packages/server/src/bots/brain/perception.ts";
import { createMemory } from "../../packages/server/src/bots/brain/memory.ts";
import { TIERS } from "../../packages/server/src/bots/brain/types.ts";
import { checkCompletedPrefix, publicProjectileObservations, indexPublicProjectileObservation } from "./verify.mjs";

const SOURCE_BASE = "bb564d3b53728cbd205af375b5342eca466f3656";
const BORN = "/repo/tools/ability-fixtures/born-input.json";
const MAP_SHA = "5ee388ca61234bae0e7dc04adca00702fbc6199f048487490fcbca25b2cffb16";
const MAX_STEPS = 96, DT = 50, COMPOSE_DELAY_MS = 125;
const CASTER = "cue-caster", OBSERVER = "cue-observer", OTHER = "cue-other";
const FACTIONS: Record<string, string> = { [CASTER]: "holy", [OBSERVER]: "fire", [OTHER]: "fire" };
const FRAME_KEYS = ["t", "self", "hud", "fighters", "mobs", "containers", "projectiles", "minimap", "events", "immediate", "extras"];
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const clone = <T>(v: T): T => structuredClone(v);
const bits = (v: number) => { const b = Buffer.alloc(8); b.writeDoubleBE(v); return b.toString("hex"); };
const angle = (a: any, b: any) => Math.atan2(b.y - a.y, b.x - a.x);
function pos(decoded: any, id: string) {
  const p = decoded.players.get(id); assert(p, "missing decoded player " + id);
  return { x: p.x, y: p.y };
}
function owner(decoded: any, id: string) {
  const p = decoded.players.get(id); assert(p, "missing decoded owner " + id);
  return { id, hp: p.hp, maxHp: p.maxHp, status: p.status, faction: p.faction, bot: p.bot, x: p.x, y: p.y, facing: p.facing,
    weapon0: p.weapon0, weapon1: p.weapon1, slot: p.slot, drawStartedAt: p.drawStartedAt,
    readyAt: p.readyAt, immuneUntil: p.immuneUntil, moveSeq: p.moveSeq, attackTarget: p.attackTarget, barrier: p.barrier };
}
function diagnostic(world: any, id: string) {
  const p = world.state.players.get(id), rt = world.players.get(id); assert(p && rt, "missing source player " + id);
  return { ...owner(world.state, id), action: clone(rt.weapon.action), lock: rt.weapon.lock,
    path: clone(rt.path), held: rt.weapon.held, rootUntil: rt.weapon.rootUntil,
    staggerImmuneUntil: rt.weapon.staggerImmuneUntil };
}
function frameCopy(frame: any) {
  assert.deepEqual(Object.keys(frame).sort(), [...FRAME_KEYS].sort(), "actual Frame field set changed");
  return clone(frame);
}
function memoryCopy(memory: any) {
  // Public MemoryView data only; deliberately do not traverse its function or private windup maps.
  const v = memory.view;
  return clone({ stimuli: v.stimuli, self: v.self, fighters: v.fighters, mobs: v.mobs,
    camps: v.camps, containers: v.containers, bounties: v.bounties, choices: v.choices });
}
function plans() {
  const s = (id: string, caster: any = {}, observer: any = {}, extra: any = {}) => ({ id,
    seats: id === "W0" ? [CASTER, OBSERVER, OTHER] : [CASTER, OBSERVER], viewers: [CASTER, OBSERVER],
    loadouts: { [CASTER]: caster, [OBSERVER]: observer, ...(id === "W0" ? { [OTHER]: {} } : {}) }, ...extra });
  return [s("P0"), s("P1", {}, { weapon0: "sword" }), s("B0", { weapon0: "bow" }),
    s("B1", { weapon0: "bow", weapon1: "wand" }), s("B2", { weapon0: "bow" }, { weapon0: "sword" }),
    s("W0", { weapon0: "wand", weapon1: "bow" }), s("W1", { weapon0: "wand" }), s("W2", { weapon0: "wand" }),
    s("W3", { weapon0: "wand" }, { weapon0: "sword" }),
    s("W4", { weapon0: "wand" }, { weapon0: "sword" }, { hp1Caster: true }),
    s("W5", { weapon0: "wand", weapon1: "bow" })];
}
function context(spec: any, raw: any) {
  const bytes = readFileSync(BORN); assert.equal(bytes.length, 7510); assert.equal(sha(bytes), MAP_SHA);
  const json = JSON.parse(bytes.toString("utf8")), map = clone(json);
  for (const key of ["tiles", "terrain", "regionGrid", "territoryGrid", "featureGrid"]) map[key] = Uint8Array.from(map[key]);
  // Safe before createGameWorld finishes: no const-world TDZ, no extra draw/peek.
  let live: any = null, uid = 0;
  const counts: Record<string, number> = { main: 0, reward: 0, quest: 0 };
  const stamp = () => live ? { tick: live.state.tick, time: live.state.serverTime, phase: live.state.phase }
    : { tick: 0, time: 0, phase: "constructor" };
  const record = (stream: string, next: () => number) => () => {
    const value = next(); counts[stream]++;
    raw.randomTape.push({ stream, ordinal: counts[stream], value, bits: bits(value), ...stamp() }); return value;
  };
  const world: any = createGameWorld({ map, config: {
    minPlayers: spec.seats.length, lobbySeconds: 0, fillSeconds: 0, planSeconds: 0, firstPatienceSeconds: 1,
    patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 60, training: false,
    dummies: false, mobs: false, quests: false, hazards: false, regen: false,
  }, random: record("main", S.mulberry32(7)), rewardSalt: [7, 6, 5, 4], questSalt: [3, 2, 1, 0],
  newItemUid: () => { const id = "U" + (++uid); raw.uidTape.push({ id, ...stamp() }); return id; },
  }, { signatures: false, walkHints: false });
  live = world;
  raw.assembler = { config: clone(world.config), modules: { signatures: false, walkHints: false },
    actualMapIdentity: { seed: world.state.seed, attempt: world.state.attempt, mapHash: world.state.mapHash } };
  world.rewardRandom = record("reward", world.rewardRandom);
  world.questRandom = record("quest", world.questRandom);
  raw.rngScope = { main: "constructor and subsequent draws", reward: "post-constructor only; constructor prefix UNOBSERVED",
    quest: "post-constructor only; constructor prefix UNOBSERVED" };
  for (const id of spec.seats) {
    addPlayer(world, id, id, { faction: FACTIONS[id], bot: false });
    raw.declared.push({ stage: "joined", ...diagnostic(world, id) });
  }
  for (const id of spec.seats) {
    const p = world.state.players.get(id), load = spec.loadouts[id];
    p.weapon0 = load.weapon0 ?? ""; p.weapon1 = load.weapon1 ?? ""; p.slot = 0;
    if (spec.hp1Caster && id === CASTER) p.hp = 1;
    raw.declared.push({ stage: "declared-before-first-step", tick: world.state.tick, time: world.state.serverTime, ...diagnostic(world, id) });
  }
  const state: any = { spec, raw, world, map, counts, viewers: new Map(), channel: new FxChannel(), encoder: new Encoder(world.state),
    schedules: new Map(), currentOrders: [], arrival: 0, lastDecoded: null, launchIds: new Set(), birthIndex: new Map(), firstBirth: null, secondScheduled: false };
  // The source invokes this once AFTER the actual drain and BEFORE normal dispatch. It is an application-boundary
  // observation, not proof a gameplay handler accepted an otherwise-invalid order. Preserve the prior callback once.
  const previous = world.hooks.inputsApplied;
  world.hooks.inputsApplied = (w: any, c: any, drained: any) => {
    previous?.call(w.hooks, w, c, drained);
    const trace = { actor: c.id, tick: w.state.tick, time: w.state.serverTime, phase: w.state.phase, drained: clone(drained) };
    raw.inputDrains.push(trace);
    for (const o of state.currentOrders.filter((v: any) => v.actor === c.id)) {
      const matching = o.type === "move" || o.type === "stop" ? drained.move?.kind === o.type
        : drained.actions.some((a: any) => a.kind === o.type);
      assert(matching, "scheduled input absent at actual drain: " + o.type);
      assert.equal(o.applyTime, null, "duplicate input application boundary");
      o.applyTime = trace.time; o.applyTick = trace.tick; o.applicationBoundary = "inputsApplied: after drain, before dispatch";
    }
  };
  return state;
}
function initViewers(s: any, decoded: any) {
  const features = detectFeatures({ state: decoded, player: new PlayerState(), map: s.map, messageTypes: S.CLIENT_MESSAGE_TYPES });
  const config = { selfDelayMs: 0, worldDelayMs: COMPOSE_DELAY_MS, attentionCentral: TIERS.normal.attention.central,
    features: clone(features), mapSha256: MAP_SHA };
  s.raw.composition = { ...config, sha256: sha(JSON.stringify(config)), map: clone(s.map),
    mapInput: { path: BORN, bytes: 7510, sha256: MAP_SHA } };
  for (const id of s.spec.viewers) s.viewers.set(id, { id, vision: new BotVision(s.map), ring: createFrameRing(), lastMinimap: null,
    memory: createMemory({ tier: TIERS.normal, map: s.map, selfId: id, features }), features });
}
function publish(s: any, events: any[], orders: any[]) {
  const w = s.world, time = w.state.serverTime, tick = w.state.tick;
  const sourceFx = events.filter((e: any) => e.type === "fx").map((e: any) => e.fx);
  const batch = s.channel.batch(sourceFx, time, w.projectiles);
  s.channel.extendRoster(w.state);
  const offset = { offset: 0 }; s.encoder.encodeAll(offset);
  const bytes = Buffer.from(s.encoder.sharedBuffer.slice(0, offset.offset));
  const decoded = new RaidState(); new Decoder(decoded).decode(bytes); s.channel.rosterSent(); s.lastDecoded = decoded;
  s.raw.pendingStep.publication = { time, tick, sourceFx: clone(sourceFx), batch: clone(batch),
    schema: { byteLength: bytes.length, bytesBase64: bytes.toString("base64"), sha256: sha(bytes) } };
  const unpackedFx = batch ? S.unpackFx(batch, decoded.roster) : [], launches = batch ? S.unpackLaunches(batch) : [];
  for (const l of launches) {
    assert(!s.launchIds.has(l.id), "duplicate actual launch announcement " + l.id); s.launchIds.add(l.id);
    const record = { ...clone(l), deliveryTime: time, deliveryTick: tick };
    s.raw.launchRecords.push(record);
  }
  // Keep decoded data available in partial raw before validating/indexing any birth forms.
  s.raw.pendingStep.publication.unpackedFx = clone(unpackedFx); s.raw.pendingStep.publication.launches = clone(launches);
  const projectileObservations = publicProjectileObservations(batch, unpackedFx, launches, time, tick);
  for (const observation of projectileObservations) {
    indexPublicProjectileObservation(s.birthIndex, observation);
    s.raw.birthRecords = [...s.birthIndex.values()];
    const birth = s.birthIndex.get(observation.value.id);
    if (birth && birth.ownerId === CASTER && birth.kind === "ball" && s.firstBirth === null) s.firstBirth = clone(birth);
  }
  s.raw.birthRecords = [...s.birthIndex.values()];
  if (s.viewers.size === 0) initViewers(s, decoded);
  const viewers: any[] = [];
  for (const [viewerOrder, v] of [...s.viewers.values()].entries()) {
    const input = { state: decoded, ...(batch ? { fxs: [batch] } : {}) };
    v.vision.update(input, v.id);
    const frame = perceive(input, { selfId: v.id, map: s.map, features: v.features, lastMinimap: v.lastMinimap, canSee: v.vision.canSee });
    const beforePush = frameCopy(frame); v.lastMinimap = frame.minimap; v.ring.push(frame);
    const composed = v.ring.compose({ selfDelayMs: 0, worldDelayMs: COMPOSE_DELAY_MS, map: s.map,
      features: v.features, attentionCentral: TIERS.normal.attention.central });
    const beforeFilter = clone(composed);
    const filtered = composed === null ? null : v.vision.filter(composed);
    const stimuli = filtered === null ? [] : v.memory.observe(filtered);
    // Copy NOW, before the next source update; no live Schema/Memory/Frame references are historical evidence.
    const temporal = { step: s.raw.steps, tick, time, viewerId: v.id, viewerOrder, frame: beforePush,
      composed: beforeFilter, filtered: clone(filtered), memory: memoryCopy(v.memory), stimuli: clone(stimuli),
      composeConfigSha256: s.raw.composition.sha256 };
    s.raw.temporal.push(temporal); viewers.push(temporal);
  }
  const row = { caseId: s.spec.id, step: s.raw.steps, tick, time, phase: w.state.phase, orders: clone(orders),
    sourceEvents: clone(events), sourceFx: clone(sourceFx), schema: { byteLength: bytes.length, bytesBase64: bytes.toString("base64"),
      sha256: sha(bytes), roster: [...decoded.roster] }, fx: { batch: clone(batch), unpackedFx: clone(unpackedFx), launches: clone(launches), projectileObservations: clone(projectileObservations) },
    ownerFields: s.spec.viewers.map((id: string) => owner(decoded, id)),
    rng: { counts: { ...s.counts }, draws: s.raw.randomTape.length },
    sourceDiagnostic: { label: "server-only diagnostics; never fair input", players: s.spec.seats.map((id: string) => diagnostic(w, id)),
      gatesLocked: w.state.gatesLocked, inColiseum: w.state.inColiseum, phase: w.state.phase },
    viewerOrders: viewers.map((v) => ({ viewerId: v.viewerId, viewerOrder: v.viewerOrder })) };
  s.raw.rows.push(row); return { row, decoded, viewers };
}
function schedule(s: any, time: number, actor: string, type: string, msg: any) {
  assert(time > s.world.state.serverTime && time % DT === 0, "schedule must precede an ordinary apply step");
  const list = s.schedules.get(time) ?? []; list.push({ actor, type, msg: clone(msg) }); s.schedules.set(time, list);
}
function plan(s: any, pub: any) {
  const { T, U, C } = s.raw, p = pos(pub.decoded, CASTER), q = pos(pub.decoded, OBSERVER);
  const co = angle(p, q), oc = angle(q, p);
  const a = (actor: string, type: string, msg: any, t: number) => schedule(s, t, actor, type, msg);
  switch (s.spec.id) {
    case "P0": break;
    case "P1": a(OBSERVER, "attack", { a: oc }, T + 50); a(OBSERVER, "release", { a: oc }, T + 100);
      a(OBSERVER, "attack", { a: oc }, U); a(OBSERVER, "release", { a: oc }, U + 50); break;
    case "B0": a(CASTER, "attack", { a: co }, C); a(CASTER, "release", { a: co }, C + 50); break;
    case "B1": a(CASTER, "attack", { a: co }, C); a(CASTER, "swap", { slot: 1 }, C + 150); a(CASTER, "release", { a: co }, C + 200); break;
    case "B2": case "W3": case "W4": a(CASTER, "attack", { a: co }, C); a(CASTER, "release", { a: co }, C + 50);
      a(OBSERVER, "attack", { a: oc }, C + 50); a(OBSERVER, "release", { a: oc }, C + 100); break;
    case "W0": a(CASTER, "target", { id: OBSERVER }, C); a(CASTER, "target", { id: OTHER }, C + 50);
      a(CASTER, "swap", { slot: 1 }, C + 100); a(CASTER, "release", { a: co }, C + 150); break;
    case "W1": case "W2": a(CASTER, "target", { id: OBSERVER }, C);
      a(CASTER, s.spec.id === "W1" ? "stop" : "move", s.spec.id === "W1" ? { seq: 1 } : { ...p, seq: 1 }, C + 50); break;
    case "W5": a(CASTER, "attack", { a: co }, C); a(CASTER, "release", { a: co }, C + 50); break;
    default: throw new Error("unknown case");
  }
}
function queued(s: any) {
  const next = s.world.state.serverTime + DT, list = s.schedules.get(next) ?? []; s.schedules.delete(next);
  const orders: any[] = []; s.currentOrders = orders;
  for (const o of list) {
    const rt = s.world.players.get(o.actor); assert(rt, "missing queued actor");
    const publicView = [...s.raw.temporal].reverse().find((v: any) => v.viewerId === o.actor);
    assert(publicView && publicView.time === s.world.state.serverTime, "missing current public input view");
    const targetId = o.type === "target" ? o.msg.id : (o.type === "attack" || o.type === "release") ? (o.actor === CASTER ? OBSERVER : CASTER) : null;
    let msg = clone(o.msg), publicBasis: any = { time: publicView.time, actor: pos(s.lastDecoded, o.actor) };
    if (targetId !== null) {
      const seen = publicView.frame.fighters.find((f: any) => f.id === targetId);
      assert(seen, "queued target/aim lacks actual public visibility: " + targetId);
      const target = pos(s.lastDecoded, targetId); publicBasis = { ...publicBasis, targetId, target, targetVisible: true };
      if (o.type === "attack" || o.type === "release") msg = { ...msg, a: angle(publicBasis.actor, target) };
    }
    if (o.type === "move") { msg = { ...publicBasis.actor, seq: 1 }; }
    const accepted = enqueueClientMessage(rt.inputs, o.type, msg, { training: false });
    const terminalCleanup = s.spec.id === "W4" && o.actor === OBSERVER && o.type === "release" && next === s.raw.C + 100
      && s.world.state.phase === "ended";
    orders.push({ ...clone(o), msg, publicBasis, arrivalOrder: ++s.arrival, arrivalTime: s.world.state.serverTime, arrivalTick: s.world.state.tick,
      arrivalPhase: s.world.state.phase, scheduleFor: next, accepted, terminalCleanup, applyTime: null, applyTick: null });
    // Publish acceptance in the partial raw even if the required enqueue is refused.
    s.raw.pendingOrders = clone(orders); assert.equal(accepted, true, "required enqueue refused");
  }
  return orders;
}
function teleportPrerequisites(s: any, pub: any) {
  const row = pub.row, decoded = pub.decoded;
  assert.equal(row.phase, "active"); assert.equal(decoded.gatesLocked, true); assert.equal(decoded.inColiseum, true);
  for (const id of s.spec.seats) assert.equal(decoded.players.get(id)?.status, "alive", "standing teleport seat " + id);
  for (const v of pub.viewers) for (const id of s.spec.seats) if (id !== v.viewerId)
    assert(v.frame.fighters.some((f: any) => f.id === id && f.status === "alive"), "required actual public visibility " + id);
  const p = pos(decoded, CASTER), q = pos(decoded, OBSERVER), distance = Math.hypot(q.x - p.x, q.y - p.y);
  const sight = S.withGates(s.map), sword: any = S.WEAPONS.sword.shape;
  assert.equal(sword.kind, "arc");
  const los = S.hasLineOfSight(sight, p, q), movementLos = S.hasLineOfSight(sight, p, q, S.MASK_MOVE);
  assert(los && movementLos && distance <= sword.reach, "fixed public pair LoS/reach prerequisite failed");
  s.raw.prerequisites = { time: row.time, tick: row.tick, standing: [...s.spec.seats], distance, swordReach: sword.reach,
    los, movementLos, gatesLocked: decoded.gatesLocked, inColiseum: decoded.inColiseum };
}
function runCase(spec: any) {
  const raw: any = { caseId: spec.id, spec: clone(spec), status: "running", steps: 0, maxSteps: MAX_STEPS,
    T: null, U: null, C: null, declared: [], rows: [], temporal: [], randomTape: [], uidTape: [], inputDrains: [],
    pendingOrders: [], launchRecords: [], birthRecords: [], error: null };
  let s: any = null;
  try {
    s = context(spec, raw);
    while (raw.steps < MAX_STEPS) {
      const orders = queued(s); const events = step(s.world, DT); raw.steps++;
      raw.pendingStep = { step: raw.steps, time: s.world.state.serverTime, tick: s.world.state.tick,
        phase: s.world.state.phase, sourceEvents: clone(events) };
      for (const o of orders) {
        if (o.applyTime === null) {
          assert(o.terminalCleanup && s.world.state.phase === "ended", "accepted active input never reached source drain");
          o.unappliedReason = "Ended: source step advances clock but does not drain inputs";
        } else { assert.equal(o.applyTime, o.scheduleFor); assert.equal(o.applyTick, s.world.state.tick); }
      }
      const pub = publish(s, events, orders); raw.pendingOrders = []; raw.pendingStep = null;
      const teleports = pub.row.sourceFx.filter((f: any) => f.kind === "teleport");
      if (teleports.length) {
        assert.equal(teleports.length, 1); assert.equal(raw.T, null, "unexpected second teleport");
        raw.T = pub.row.time; raw.U = owner(pub.decoded, CASTER).immuneUntil; raw.C = raw.U + DT;
        assert(raw.U > raw.T && Number.isInteger(raw.U), "missing positive produced owner u32 deadline");
        pub.row.teleport = true; teleportPrerequisites(s, pub); plan(s, pub);
      }
      if (raw.T === null) assert.equal(orders.length, 0, "input before genuine teleport");
      if (spec.id !== "W4") for (const id of spec.seats)
        assert.equal(pub.decoded.players.get(id)?.status, "alive", "unintended death of " + id);
      if (spec.id === "W5" && s.firstBirth && !s.secondScheduled && pub.row.time >= s.firstBirth.firstDeliveryTime + 300
        && pub.row.time >= owner(pub.decoded, CASTER).readyAt) {
        // Scheduling uses ONLY actual decoded public owner/visible positions, not source runtime diagnostic clocks.
        const publicCaster = owner(pub.decoded, CASTER);
        const publicObserver = pub.viewers.find((v: any) => v.viewerId === CASTER).frame.fighters.find((f: any) => f.id === OBSERVER);
        assert(publicObserver, "W5 ready-time target not publicly visible");
        raw.secondSchedule = { observedAt: pub.row.time, observedTick: pub.row.tick, ownerReadyAt: publicCaster.readyAt,
          firstBirthDeliveryTime: s.firstBirth.firstDeliveryTime };
        schedule(s, pub.row.time + DT, CASTER, "attack", { a: angle(publicCaster, publicObserver) });
        schedule(s, pub.row.time + 2 * DT, CASTER, "swap", { slot: 1 }); s.secondScheduled = true;
      }
    }
    assert(raw.T !== null, "teleport not produced within96 steps"); assert.equal(s.schedules.size, 0, "scheduled input outside96-step bound");
    raw.final = clone(raw.rows.at(-1).sourceDiagnostic); raw.temporalCount = raw.temporal.length; raw.status = "ok";
  } catch (error) {
    raw.status = "error"; raw.error = String(error);
    try {
      raw.failure = s ? { time: s.world.state.serverTime, tick: s.world.state.tick, phase: s.world.state.phase,
        pendingOrders: clone(s.currentOrders), sourceDiagnostic: spec.seats.map((id: string) => diagnostic(s.world, id)) } : { stage: "constructor/setup" };
    } catch (diagnosticError) { raw.failure = { stage: "failure-diagnostic unavailable", error: String(diagnosticError) }; }
    raw.temporalCount = raw.temporal.length;
  }
  return raw;
}
export function capture(provenance: { codeSha: string; sourceBase: string }) {
  const raw: any = { format: "rh-p15-protection-cues-raw/2", status: "running", profile: null, cases: [], error: null,
    serialization: { codec: "rh-tagged-value/1", negativeZero: "tagged, preserved", nonfinite: "tagged, preserved",
      undefined: "explicit own-property tag, omission remains omission" } };
  try {
    assert.equal(provenance?.sourceBase, SOURCE_BASE); assert.match(provenance?.codeSha, /^[0-9a-f]{40}$/);
    raw.profile = { sourceBase: SOURCE_BASE, driverCode: provenance.codeSha, packet: "P-P15-PROTECTION-CUES-SOURCE",
      map: { path: BORN, bytes: 7510, sha256: MAP_SHA }, mainSeed: 7, rewardSalt: [7, 6, 5, 4], questSalt: [3, 2, 1, 0],
      maxStepsPerCase: MAX_STEPS, totalMaxSteps: 11 * MAX_STEPS, dtMs: DT, sourceWeaponTieEpsMs: TIE_EPS_MS,
      views: { viewers: [CASTER, OBSERVER], selfDelayMs: 0, worldDelayMs: COMPOSE_DELAY_MS, tier: "normal" },
      assembler: { modules: { signatures: false, walkHints: false }, profile: "supported weapon-only; not full-signature" },
      publication: "actual step -> FX batch against sent roster -> extend -> encodeAll/fresh decode -> rosterSent -> viewers",
      application: "source inputsApplied drain boundary; post-Ended W4 observer release explicitly accepted but UNAPPLIED",
      limitations: "finite method inputs; no earned gear/HP, socket, renderer, Brain, new P15 disclosure or native activation" };
    for (const spec of plans()) {
      const c = runCase(spec); raw.cases.push(c);
      if (c.status !== "ok") { raw.status = "error"; raw.error = "first case failed: " + spec.id; return raw; }
      try { checkCompletedPrefix(raw); } catch (error) {
        c.status = "error"; c.error = String(error); c.failure = { stage: "completed-case producer precondition" };
        raw.status = "error"; raw.error = "first case failed: " + spec.id; return raw;
      }
    }
    raw.status = "ok";
  } catch (error) { raw.status = "error"; raw.error = String(error); }
  return raw;
}

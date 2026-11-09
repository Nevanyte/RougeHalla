// P15 protection/cue source scenario. CODE-ONLY: exports capture() and has no host entry point.
// Declared seats/loadouts plus actual source inputs only; no desired result, state, RNG, visibility or HP
// installation. All schedules enqueue through enqueueClientMessage before the step that applies at C.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Encoder, Decoder } from "@colyseus/schema";
import * as S from "@raid/shared";
import { RaidState } from "../../packages/shared/src/schema.ts";
import { createGameWorld } from "../../packages/server/src/sim/gameplay.ts";
import { addPlayer, step } from "../../packages/server/src/sim/step.ts";
import { enqueueClientMessage } from "../../packages/server/src/sim/inputs.ts";
import { FxChannel } from "../../packages/server/src/rooms/FxChannel.ts";
import { BotVision } from "../../packages/server/src/bots/brain/vision.ts";
import { createFrameRing } from "../../packages/server/src/bots/brain/frames.ts";
import { detectFeatures, perceive } from "../../packages/server/src/bots/brain/perception.ts";
import { createMemory } from "../../packages/server/src/bots/brain/memory.ts";
import { TIERS, WORLD_RENDER_DELAY_MS } from "../../packages/server/src/bots/brain/types.ts";

const BORN = "/repo/tools/ability-fixtures/born-input.json";
const MAX_STEPS = 96;
const SEATS = ["cue-caster", "cue-observer", "cue-other"] as const;
const SEAT_FACTION: any = { "cue-caster": "holy", "cue-observer": "fire", "cue-other": "fire" };
const MAP_KEYS = ["tiles", "terrain", "regionGrid", "territoryGrid", "featureGrid"];
function sha(v: any) { return createHash("sha256").update(v).digest("hex"); }
function copy(v: any) { return structuredClone(v); }
function plain(v: any): any {
  if (v === undefined) return { $undefined: true };
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isNaN(v) ? { $number: "NaN" } : v === Infinity ? { $number: "Infinity" } : v === -Infinity ? { $number: "-Infinity" } : Object.is(v, -0) ? { $number: "-0" } : v;
  if (Array.isArray(v)) return v.map(plain);
  if (v instanceof Map) return { $map: [...v].map(([k, x]) => [plain(k), plain(x)]) };
  if (v instanceof Set) return { $set: [...v].map(plain) };
  if (ArrayBuffer.isView(v)) return Array.from(v as any);
  if (typeof v?.toJSON === "function") return plain(v.toJSON());
  if (typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x !== "function").map(([k, x]) => [k, plain(x)]));
  return String(v);
}
const FRAME_FIELDS = ["t","self","hud","fighters","mobs","containers","projectiles","minimap","events","immediate","extras"];
function deep(v: any): any { return v === null || typeof v !== "object" ? v : structuredClone(v); }
function temporalFrame(frame: any) {
  const out: any = {};
  for (const key of FRAME_FIELDS) if (Object.prototype.hasOwnProperty.call(frame, key)) out[key] = deep(frame[key]);
  return out;
}
function readBornMap() {
  const raw = readFileSync(BORN);
  const json = JSON.parse(raw.toString("utf8"));
  const map = copy(json);
  for (const key of MAP_KEYS) map[key] = Uint8Array.from(map[key]);
  return { map, raw, json };
}
function positionOf(state: any, id: string) {
  const p = state.players.get(id);
  if (!p) throw new Error("missing decoded player " + id);
  return { x: p.x, y: p.y };
}
function angle(a: any, b: any) { return Math.atan2(b.y - a.y, b.x - a.x); }
function snapshotOwner(decoded: any, id: string) {
  const p = decoded.players.get(id);
  if (!p) return null;
  return { id, hp: p.hp, status: p.status, weapon0: p.weapon0, weapon1: p.weapon1, slot: p.slot, drawStartedAt: p.drawStartedAt, readyAt: p.readyAt, immuneUntil: p.immuneUntil, moveSeq: p.moveSeq };
}
function sourcePlayer(world: any, id: string) {
  const p = world.state.players.get(id), rt = world.players.get(id);
  return { id, hp: p.hp, maxHp: p.maxHp, status: p.status, x: p.x, y: p.y, weapon0: p.weapon0, weapon1: p.weapon1, slot: p.slot, drawStartedAt: p.drawStartedAt, readyAt: p.readyAt, immuneUntil: p.immuneUntil, action: rt.weapon.action ? plain(rt.weapon.action) : null, lock: rt.weapon.lock, path: plain(rt.path) };
}
function makeCaseContext(spec: any) {
  const { map, raw: mapRaw } = readBornMap();
  const randomTape: any[] = [];
  const uidTape: any[] = [];
  let draws = 0;
  const rng = S.mulberry32(7);
  const random = () => { const v = rng(); draws++; randomTape.push({ stream: "main", value: v, tick: 0, time: 0, phase: "constructor" }); return v; };
  let uid = 0;
  const world: any = createGameWorld({
    map, config: {
      minPlayers: spec.seats.length, lobbySeconds: 0, fillSeconds: 0, planSeconds: 0, firstPatienceSeconds: 1,
      patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 60, training: false, dummies: false,
      mobs: false, quests: false, hazards: false, regen: false,
    }, random, rewardSalt: [7, 6, 5, 4], questSalt: [3, 2, 1, 0],
    newItemUid: () => { const id = "U" + (++uid); uidTape.push({ id, tick: world?.state.tick ?? 0, time: world?.state.serverTime ?? 0, phase: world?.state.phase ?? "constructor" }); return id; },
  }, { signatures: false, walkHints: false });
  for (const [stream, key] of [["reward", "rewardRandom"], ["quest", "questRandom"]] as const) {
    const next = world[key];
    world[key] = () => { const v = next(); draws++; randomTape.push({ stream, value: v, tick: world.state.tick, time: world.state.serverTime, phase: world.state.phase }); return v; };
  }
  const declared: any[] = [];
  for (const id of spec.seats) {
    const p = addPlayer(world, id, id, { faction: SEAT_FACTION[id], bot: false });
    declared.push({ id, phase: "joined", hp: p.hp, maxHp: p.maxHp, weapon0: "", weapon1: "", slot: 0 });
  }
  for (const id of spec.seats) {
    const p = world.state.players.get(id);
    const load = spec.loadouts[id] ?? {};
    p.weapon0 = load.weapon0 ?? ""; p.weapon1 = load.weapon1 ?? ""; p.slot = load.slot ?? 0;
    if (spec.hp1Caster && id === "cue-caster") p.hp = 1;
    declared.push({ id, phase: "declared-before-first-step", hp: p.hp, maxHp: p.maxHp, weapon0: p.weapon0, weapon1: p.weapon1, slot: p.slot });
  }
  const channel = new FxChannel();
  let encoder: any = null;
  const viewers = new Map<string, any>();
  let features: any = null;
  const state: any = {
    spec, world, map, mapRaw, randomTape, uidTape, draws, channel, encoder, viewers, features, steps: 0,
    rows: [] as any[], digests: [] as any[], errors: [] as string[], events: [] as any[], batches: [] as any[], temporal: [] as any[], composition: null as any,
    T: null as number | null, U: null as number | null, C: null as number | null, boundaryTimes: new Set<number>(),
    schedules: new Map<number, any[]>(), launchRecords: [] as any[], firstLaunchAt: null as number | null,
    secondAttackScheduled: false, secondSwapScheduled: false, terminated: false,
  };
  return state;
}
function schedule(state: any, time: number, actor: string, type: string, msg: any) {
  if (!(time > state.world.state.serverTime)) throw new Error("schedule must be before its apply step: " + time);
  if (!state.schedules.has(time)) state.schedules.set(time, []);
  state.schedules.get(time).push({ actor, type, msg });
  state.boundaryTimes.add(time);
}
function setupViewers(state: any, decoded: any) {
  if (state.features !== null) return;
  state.features = detectFeatures({ state: decoded, map: state.map });
  state.composition = { selfDelayMs: 0, worldDelayMs: WORLD_RENDER_DELAY_MS, attentionCentral: TIERS.normal.attention.central, features: deep(state.features), featuresSha256: sha(plain(state.features)), map: { path: BORN, sha256: sha(state.mapRaw), bytes: state.mapRaw.length, tiles: Array.from(state.map.tiles), terrain: Array.from(state.map.terrain), regionGrid: Array.from(state.map.regionGrid), territoryGrid: Array.from(state.map.territoryGrid), featureGrid: Array.from(state.map.featureGrid) } };
  for (const id of state.spec.viewers) {
    state.viewers.set(id, { id, vision: new BotVision(state.map), ring: createFrameRing(), lastMinimap: null, memory: createMemory({ tier: TIERS.normal, map: state.map, selfId: id, features: state.features }), frames: 0 });
  }
}
function fullViewer(state: any) {
  const out: any[] = [];
  for (const v of state.viewers.values()) out.push({ id: v.id, frames: v.frames });
  return out;
}
function publish(state: any, events: any[], orders: any[]) {
  const w = state.world;
  const fxEvents = events.filter((e: any) => e.type === "fx").map((e: any) => e.fx);
  // Reviewed order: batch against the previously SENT roster, then extend roster, full patch/decode, rosterSent.
  const batch = state.channel.batch(fxEvents, w.state.serverTime, w.projectiles);
  if (batch) state.batches.push(batch);
  state.channel.extendRoster(w.state);
  if (state.encoder === null) state.encoder = new Encoder(w.state);
  const offset = { offset: 0 }; state.encoder.encodeAll(offset);
  const bytes = Buffer.from(state.encoder.sharedBuffer.slice(0, offset.offset));
  const decoded = new RaidState(); new Decoder(decoded).decode(bytes);
  state.channel.rosterSent();
  const unpackedFx = batch ? S.unpackFx(batch, [...decoded.roster]) : [];
  const launches = batch ? S.unpackLaunches(batch) : [];
  for (const launch of launches) state.launchRecords.push({ ...launch, step: w.state.tick, time: w.state.serverTime });
  setupViewers(state, decoded);
  const viewerRows: any[] = [];
  for (const v of state.viewers.values()) {
    const input = { state: decoded, ...(batch ? { fxs: [batch] } : {}) };
    v.vision.update(input, v.id);
    const frame = perceive({ state: decoded, ...(batch ? { fxs: [batch] } : {}) }, { selfId: v.id, map: state.map, features: state.features, lastMinimap: v.lastMinimap, canSee: v.vision.canSee });
    const prePush = temporalFrame(frame);
    v.lastMinimap = frame.minimap;
    v.ring.push(frame);
    v.frames++;
    const percept = v.ring.compose({ selfDelayMs: 0, worldDelayMs: WORLD_RENDER_DELAY_MS, map: state.map, features: state.features, attentionCentral: TIERS.normal.attention.central });
    state.temporal.push({ step: state.steps, time: w.state.serverTime, tick: w.state.tick, viewerId: v.id, viewerOrder: [...state.viewers.keys()].indexOf(v.id), frame: prePush, composed: percept === null ? null : deep(percept), composeConfigSha256: state.composition.featuresSha256 });
    let filtered = null, stimuli: any[] = [];
    if (percept) { filtered = v.vision.filter(percept); stimuli = v.memory.observe(filtered); }
    viewerRows.push({ id: v.id, frame: prePush, composed: percept === null ? null : deep(percept), filtered: filtered === null ? null : deep(filtered), memory: plain(v.memory.view), stimuli: plain(stimuli) });
  }
  return { time: w.state.serverTime, tick: w.state.tick, phase: w.state.phase, events, batch, unpackedFx, launches, decoded, viewerRows, temporal: state.temporal.slice(-state.spec.viewers.length), composition: state.composition, schemaBytes: bytes.byteLength, schemaSha256: sha(bytes), roster: plain(decoded.roster), ownerFields: state.spec.viewers.map((id: string) => snapshotOwner(decoded, id)) };
}
function rowFor(state: any, pub: any, orders: any[], full: boolean) {
  const row: any = {
    caseId: state.spec.id, step: state.steps, tick: pub.tick, time: pub.time, phase: pub.phase, full,
    orders: plain(orders), accepted: orders.map((o: any) => o.accepted), apply: orders.map((o: any) => o.applyTime ?? null),
    sourceFx: pub.events.filter((e: any) => e.type === "fx").map((e: any) => plain(e.fx)),
    schema: { bytes: pub.schemaBytes, sha256: pub.schemaSha256, roster: pub.roster },
    fx: full ? { batch: plain(pub.batch), unpackedFx: plain(pub.unpackedFx), launches: plain(pub.launches) } : null,
    ownerFields: pub.ownerFields,
    rng: { draws: state.draws, lastStream: state.randomTape.at(-1)?.stream ?? null, lastValue: state.randomTape.at(-1)?.value ?? null },
    sourceDiagnostic: full ? { players: state.spec.seats.map((id: string) => sourcePlayer(state.world, id)), launches: plain(state.launchRecords), phase: state.world.state.phase, gatesLocked: state.world.state.gatesLocked } : null,
    viewers: full ? plain(pub.viewerRows) : pub.viewerRows.map((v: any) => ({ id: v.id, frames: state.viewers.get(v.id).frames, composed: !!v.composed, memoryStimuli: Array.isArray(v.stimuli) ? v.stimuli.length : null })),
  };
  if (!full) row.summary = { events: pub.events.length, launches: pub.launches.length, batch: pub.batch ? 1 : 0 };
  return row;
}
function planCases() {
  return [
    { id: "P0", seats: ["cue-caster", "cue-observer"], viewers: ["cue-caster", "cue-observer"], loadouts: { "cue-caster": {}, "cue-observer": {} } },
    { id: "P1", seats: ["cue-caster", "cue-observer"], viewers: ["cue-caster", "cue-observer"], loadouts: { "cue-caster": {}, "cue-observer": { weapon0: "sword" } } },
    { id: "B0", seats: ["cue-caster", "cue-observer"], viewers: ["cue-caster", "cue-observer"], loadouts: { "cue-caster": { weapon0: "bow" }, "cue-observer": {} } },
    { id: "B1", seats: ["cue-caster", "cue-observer"], viewers: ["cue-caster", "cue-observer"], loadouts: { "cue-caster": { weapon0: "bow", weapon1: "wand" }, "cue-observer": {} } },
    { id: "B2", seats: ["cue-caster", "cue-observer"], viewers: ["cue-caster", "cue-observer"], loadouts: { "cue-caster": { weapon0: "bow" }, "cue-observer": { weapon0: "sword" } } },
    { id: "W0", seats: ["cue-caster", "cue-observer", "cue-other"], viewers: ["cue-caster", "cue-observer"], loadouts: { "cue-caster": { weapon0: "wand", weapon1: "bow" }, "cue-observer": {}, "cue-other": {} } },
    { id: "W1", seats: ["cue-caster", "cue-observer"], viewers: ["cue-caster", "cue-observer"], loadouts: { "cue-caster": { weapon0: "wand" }, "cue-observer": {} } },
    { id: "W2", seats: ["cue-caster", "cue-observer"], viewers: ["cue-caster", "cue-observer"], loadouts: { "cue-caster": { weapon0: "wand" }, "cue-observer": {} } },
    { id: "W3", seats: ["cue-caster", "cue-observer"], viewers: ["cue-caster", "cue-observer"], loadouts: { "cue-caster": { weapon0: "wand" }, "cue-observer": { weapon0: "sword" } } },
    { id: "W4", seats: ["cue-caster", "cue-observer"], viewers: ["cue-caster", "cue-observer"], loadouts: { "cue-caster": { weapon0: "wand" }, "cue-observer": { weapon0: "sword" } }, hp1Caster: true },
    { id: "W5", seats: ["cue-caster", "cue-observer"], viewers: ["cue-caster", "cue-observer"], loadouts: { "cue-caster": { weapon0: "wand", weapon1: "bow" }, "cue-observer": {} } },
  ];
}
function planAfterTeleport(state: any) {
  const w = state.world, T = state.T!, U = state.U!, C = state.C!;
  const positions = { caster: positionOf(state.teleportDecoded, "cue-caster"), observer: positionOf(state.teleportDecoded, "cue-observer") };
  const aimCO = angle(positions.caster, positions.observer), aimOC = angle(positions.observer, positions.caster);
  const a = (id: string, type: string, msg: any, time: number) => schedule(state, time, id, type, msg);
  if (state.spec.id === "P1") {
    a("cue-observer", "attack", { a: aimOC }, T + 50); a("cue-observer", "release", { a: aimOC }, T + 100);
    a("cue-observer", "attack", { a: aimOC }, U); a("cue-observer", "release", { a: aimOC }, U + 50);
  } else if (state.spec.id === "B0") {
    a("cue-caster", "attack", { a: aimCO }, C); a("cue-caster", "release", { a: aimCO }, C + 50);
  } else if (state.spec.id === "B1") {
    a("cue-caster", "attack", { a: aimCO }, C); a("cue-caster", "swap", {}, C + 150); a("cue-caster", "release", { a: aimCO }, C + 200);
  } else if (state.spec.id === "B2") {
    a("cue-caster", "attack", { a: aimCO }, C); a("cue-caster", "release", { a: aimCO }, C + 50);
    a("cue-observer", "attack", { a: aimOC }, C + 50); a("cue-observer", "release", { a: aimOC }, C + 100);
  } else if (state.spec.id === "W0") {
    a("cue-caster", "target", { id: "cue-observer" }, C); a("cue-caster", "target", { id: "cue-other" }, C + 50);
    a("cue-caster", "swap", {}, C + 100); a("cue-caster", "release", { a: aimCO }, C + 150);
  } else if (state.spec.id === "W1") {
    a("cue-caster", "target", { id: "cue-observer" }, C); a("cue-caster", "stop", { seq: 1 }, C + 50);
  } else if (state.spec.id === "W2") {
    a("cue-caster", "target", { id: "cue-observer" }, C); a("cue-caster", "move", { ...positions.caster, seq: 1 }, C + 50);
  } else if (state.spec.id === "W3" || state.spec.id === "W4") {
    a("cue-caster", "attack", { a: aimCO }, C); a("cue-caster", "release", { a: aimCO }, C + 50);
    a("cue-observer", "attack", { a: aimOC }, C + 50); a("cue-observer", "release", { a: aimOC }, C + 100);
  } else if (state.spec.id === "W5") {
    a("cue-caster", "attack", { a: aimCO }, C); a("cue-caster", "release", { a: aimCO }, C + 50);
  }
}
function afterStep(state: any, pub: any) {
  if (state.spec.id !== "W5" || state.secondSwapScheduled) return;
  const caster = sourcePlayer(state.world, "cue-caster");
  const firstLaunch = state.launchRecords.find((l: any) => l.ownerId === "cue-caster" || l.from === "cue-caster");
  if (!firstLaunch || state.firstLaunchAt === null) return;
  if (!state.secondAttackScheduled && pub.time >= state.firstLaunchAt + 300 && pub.time >= caster.readyAt) {
    schedule(state, pub.time + 50, "cue-caster", "attack", { a: angle(sourcePlayer(state.world, "cue-caster"), sourcePlayer(state.world, "cue-observer")) });
    state.secondAttackScheduled = true;
    schedule(state, pub.time + 100, "cue-caster", "swap", {});
    state.secondSwapScheduled = true;
  }
}
function applyOrders(state: any, nextTime: number) {
  const list = state.schedules.get(nextTime) ?? [];
  state.schedules.delete(nextTime);
  const resolved: any[] = [];
  for (const o of list) {
    const rt = state.world.players.get(o.actor);
    if (!rt) throw new Error("missing input player " + o.actor);
    const accepted = enqueueClientMessage(rt.inputs, o.type, o.msg, { training: false });
    if (!accepted) throw new Error("required input refused: " + o.actor + " " + o.type);
    resolved.push({ actor: o.actor, type: o.type, msg: o.msg, accepted, scheduleFor: nextTime, applyTime: nextTime });
  }
  return resolved;
}
function runCase(spec: any) {
  const raw: any = { caseId: spec.id, spec: plain(spec), status: "running", maxSteps: MAX_STEPS, steps: 0, T: null, U: null, C: null, rows: [], digests: [], temporal: [], errors: [], randomTape: [], uidTape: [] };
  try {
    const state = makeCaseContext(spec);
    raw.seats = spec.seats;
    raw.declared = [];
    // First ordinary step starts the run; capture pre-first-step declarations.
    const firstStep = step(state.world, 50); state.steps++;
    const firstPub = (() => {
      const events = firstStep; const fx = events.filter((e: any) => e.type === "fx").map((e: any) => e.fx);
      const batch = state.channel.batch(fx, state.world.state.serverTime, state.world.projectiles);
      state.channel.extendRoster(state.world.state);
      state.encoder = new Encoder(state.world.state);
      const offset = { offset: 0 }; state.encoder.encodeAll(offset);
      const bytes = Buffer.from(state.encoder.sharedBuffer.slice(0, offset.offset));
      const decoded = new RaidState(); new Decoder(decoded).decode(bytes);
      state.channel.rosterSent();
      setupViewers(state, decoded);
      const unpackedFx = batch ? S.unpackFx(batch, [...decoded.roster]) : [];
      const launches = batch ? S.unpackLaunches(batch) : [];
      for (const launch of launches) state.launchRecords.push({ ...launch, step: state.world.state.tick, time: state.world.state.serverTime });
      const viewerRows: any[] = [];
      for (const v of state.viewers.values()) {
        const input = { state: decoded, ...(batch ? { fxs: [batch] } : {}) };
        v.vision.update(input, v.id);
        const frame = perceive({ state: decoded, ...(batch ? { fxs: [batch] } : {}) }, { selfId: v.id, map: state.map, features: state.features, lastMinimap: v.lastMinimap, canSee: v.vision.canSee });
        const prePush = temporalFrame(frame);
        v.lastMinimap = frame.minimap; v.ring.push(frame); v.frames++;
        const percept = v.ring.compose({ selfDelayMs: 0, worldDelayMs: WORLD_RENDER_DELAY_MS, map: state.map, features: state.features, attentionCentral: TIERS.normal.attention.central });
        state.temporal.push({ step: 1, time: state.world.state.serverTime, tick: state.world.state.tick, viewerId: v.id, viewerOrder: [...state.viewers.keys()].indexOf(v.id), frame: prePush, composed: percept === null ? null : deep(percept), composeConfigSha256: state.composition.featuresSha256 });
        let filtered = null, stimuli: any[] = [];
        if (percept) { filtered = v.vision.filter(percept); stimuli = v.memory.observe(filtered); }
        viewerRows.push({ id: v.id, frame: prePush, composed: percept === null ? null : deep(percept), filtered: filtered === null ? null : deep(filtered), memory: plain(v.memory.view), stimuli: plain(stimuli) });
      }
      return { events, batch, unpackedFx, launches, decoded, viewerRows, temporal: state.temporal.slice(0), composition: state.composition, schemaBytes: bytes.byteLength, schemaSha256: sha(bytes), roster: plain(decoded.roster), ownerFields: spec.viewers.map((id: string) => snapshotOwner(decoded, id)) };
    })();
    assert.equal(state.world.state.phase, "active", "first step active");
    raw.rows.push(rowFor(state, firstPub, [], true));
    raw.digests.push({ step: 1, time: firstPub.time, tick: firstPub.tick, phase: firstPub.phase, orders: 0, events: firstPub.events.length, launches: firstPub.launches.length, batch: firstPub.batch ? 1 : 0 });
    raw.temporal.push(...firstPub.temporal.map(plain)); raw.composition = plain(firstPub.composition);
    raw.declared = plain([...state.world.state.players].map(([id, p]: any) => ({ id, hp: p.hp, maxHp: p.maxHp, weapon0: p.weapon0, weapon1: p.weapon1, slot: p.slot, phase: state.world.state.phase })));
    // Common prefix: no inputs before teleport.
    let lastPrefix = firstPub;
    while (!state.teleportDecoded && state.steps < MAX_STEPS) {
      const nextTime = state.world.state.serverTime + 50;
      const orders = applyOrders(state, nextTime);
      const events = step(state.world, 50); state.steps++;
      const pub = publish(state, events, orders);
      const full = state.steps < 3 || pub.events.some((e: any) => e.type === "fx" && (e.fx.kind === "teleport" || e.fx.kind === "victory")) || pub.events.some((e: any) => e.type === "raidEnded") || state.steps === MAX_STEPS || pub.events.length > 0;
      raw.rows.push(rowFor(state, { ...pub, schemaBytes: pub.schemaBytes ?? 0, schemaSha256: pub.schemaSha256 ?? "", roster: pub.roster ?? [] }, orders, full));
      raw.digests.push({ step: state.steps, time: pub.time, tick: pub.tick, phase: pub.phase, orders: orders.length, events: pub.events.length, launches: pub.launches.length, batch: pub.batch ? 1 : 0 });
      raw.temporal.push(...pub.temporal.map(plain)); raw.composition = plain(pub.composition);
      if (pub.events.some((e: any) => e.type === "fx" && e.fx.kind === "teleport") && state.world.state.gatesLocked) {
        state.teleportDecoded = pub.decoded;
        state.T = pub.time;
        const owner = pub.decoded.players.get("cue-caster");
        state.U = owner?.immuneUntil ?? null;
        if (state.U === null || !(state.U > 0)) throw new Error("no positive owner deadline after teleport");
        state.C = state.U + 50;
        state.boundaryTimes.add(state.T); state.boundaryTimes.add(state.U); state.boundaryTimes.add(state.C);
        for (const dt of [-150, -100, -50, 0, 50, 100, 150]) state.boundaryTimes.add(state.U + dt);
        planAfterTeleport(state);
        raw.T = state.T; raw.U = state.U; raw.C = state.C;
        // Mark the teleport row full.
        const last = raw.rows[raw.rows.length - 1]; last.full = true; last.teleport = true;
      }
      lastPrefix = pub;
    }
    if (!state.teleportDecoded) throw new Error("teleport not produced within bound");
    // Post-teleport clocks: one ordinary step per schedule, all inputs enqueued before the step that applies them.
    while (state.steps < MAX_STEPS) {
      const nextTime = state.world.state.serverTime + 50;
      const orders = applyOrders(state, nextTime);
      const events = step(state.world, 50); state.steps++;
      const pub = publish(state, events, orders);
      const near = [...state.boundaryTimes].some((t) => Math.abs(pub.time - t) <= 50);
      const full = orders.length > 0 || pub.events.length > 0 || near || state.steps <= 3 || state.steps === MAX_STEPS;
      raw.rows.push(rowFor(state, { ...pub, schemaBytes: pub.schemaBytes ?? 0, schemaSha256: pub.schemaSha256 ?? "", roster: pub.roster ?? [] }, orders, full));
      raw.digests.push({ step: state.steps, time: pub.time, tick: pub.tick, phase: pub.phase, orders: orders.length, events: pub.events.length, launches: pub.launches.length, batch: pub.batch ? 1 : 0 });
      raw.temporal.push(...pub.temporal); raw.composition = pub.composition;
      if (state.spec.id === "W5" && state.firstLaunchAt === null && state.launchRecords.some((l: any) => l.ownerId === "cue-caster" || l.from === "cue-caster")) state.firstLaunchAt = pub.time;
      afterStep(state, pub);
      if (state.world.state.phase === "ended" && state.steps > 3) state.terminated = true;
    }
    raw.status = "ok";
    raw.steps = state.steps;
    raw.digests = raw.digests;
    raw.randomTape = state.randomTape; raw.uidTape = state.uidTape; raw.temporalCount = state.temporal.length;
    raw.launchRecords = plain(state.launchRecords);
    raw.final = plain({ phase: state.world.state.phase, gatesLocked: state.world.state.gatesLocked, players: spec.seats.map((id: string) => sourcePlayer(state.world, id)) });
  } catch (error) {
    raw.status = "error";
    raw.error = String(error);
    raw.rows = raw.rows ?? [];
  }
  return raw;
}
export function capture() {
  const cases = planCases().map((spec: any) => runCase(spec));
  return {
    format: "rh-p15-protection-cues-raw/1",
    profile: {
      packet: "P-P15-PROTECTION-CUES-SOURCE",
      code: "bb564d3b53728cbd205af375b5342eca466f3656",
      map: { path: BORN, bytes: readFileSync(BORN).byteLength, sha256: sha(readFileSync(BORN)) },
      seed: 7, maxStepsPerCase: MAX_STEPS, totalMaxSteps: 11 * MAX_STEPS,
      mainSeed: 7, rewardSalt: [7, 6, 5, 4], questSalt: [3, 2, 1, 0],
      assembler: { config: "packet fixed", modules: { signatures: false, walkHints: false }, profile: "actual supported weapon-only assembler; not live full-signature" },
      views: { viewers: ["cue-caster", "cue-observer"], selfDelayMs: 0, worldDelayMs: WORLD_RENDER_DELAY_MS, tier: "normal", attentionCentral: TIERS.normal.attention.central },
      clocks: "ordinary step(world,50); inputs enqueued before the step whose post-step time equals the declared apply time",
      publication: "actual events -> FxChannel.batch against previously sent roster -> extendRoster -> encodeAll/decode fresh RaidState -> rosterSent -> viewers",
      limitations: "Finite declared method contexts; no socket delivery, renderer/Phaser, full Brain, P15 disclosure or live fairness proof.",
    },
    cases,
    serialization: { policy: "finite JSON numbers remain numbers; NaN/Infinity/-Infinity/-0 and undefined use explicit {$number}/{$undefined} tags before serialization; tags are part of the raw bytes and must be decoded by the pinned verifier, never silently converted to null", negativeZero: "tagged as {$number:\"-0\"}", nonfinite: "tagged explicitly" },
  };
}
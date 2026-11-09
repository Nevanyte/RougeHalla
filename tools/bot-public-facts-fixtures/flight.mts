/**
 * A bounded source-to-bot witness.  The setup declares only the initial arena, seats, factions and
 * loadouts; after the first raid step all movement/weapon work is driven through normal queued
 * client messages and the real fixed-step simulation.
 */
import * as S from "@raid/shared";
import assert from "node:assert/strict";
import { createWorld } from "../../packages/server/src/sim/world.ts";
import { addPlayer, step } from "../../packages/server/src/sim/step.ts";
import { enqueueClientMessage } from "../../packages/server/src/sim/inputs.ts";
import { install as installWeapons } from "../../packages/server/src/sim/weapons.ts";
import { install as installTargeting } from "../../packages/server/src/sim/targeting.ts";
import { install as installProjectiles } from "../../packages/server/src/sim/projectiles.ts";
import { install as installVision, canPlayerSee } from "../../packages/server/src/sim/vision.ts";
import { FxChannel } from "../../packages/server/src/rooms/FxChannel.ts";
import { createFrameRing } from "../../packages/server/src/bots/brain/frames.ts";
import { detectFeatures, perceive } from "../../packages/server/src/bots/brain/perception.ts";
import { createMemory } from "../../packages/server/src/bots/brain/memory.ts";
import { createReflexes } from "../../packages/server/src/bots/brain/tactics/kite.ts";
import { createKnowledge } from "../../packages/server/src/bots/brain/knowledge.ts";
import { createPathBudget, createPathService } from "../../packages/server/src/bots/brain/services.ts";
import { PERSONAS, TIERS, WORLD_RENDER_DELAY_MS, type BrainContext, type Features, type TierId } from "../../packages/server/src/bots/brain/types.ts";

const MAP_W = 64;
const MAP_H = 48;
const TICK_MS = 50;
const MAX_STEPS = 180;
const SOURCE_WORLD_DELAY_MS = WORLD_RENDER_DELAY_MS + 25;
const SHOOTER = "flight-shooter";
const WATCHER = "flight-watcher";
const EFFECT_HIDDEN = S.EFFECT_HIDDEN;

const featuresFor = (state: any, map: any): Features => detectFeatures({ state, map });

function stream(seed: number): { next: () => number; readonly draws: number } {
  const nextValue = S.mulberry32(seed >>> 0);
  let n = 0;
  return {
    next() { n++; return nextValue(); },
    get draws() { return n; },
  };
}

function contextFor(tierId: TierId, seed: number, map: any, features: Features, p: any, mem: any, probe: any): BrainContext {
  const tier = TIERS[tierId];
  probe.pathBudget.startTick();
  probe.paths.setFrame(p.now, p.hud.gatesLocked);
  const cfg = {
    id: WATCHER, name: `declared-${tierId}-method-probe`, tier, persona: PERSONAS.hunter, seed,
    map, features, learned: { enabled: false, bias: () => 0 }, services: { paths: probe.paths, log: () => {} }, modules: [],
  } as any;
  return {
    cfg, p, mem: mem.view, know: probe.knowledge, svc: { paths: probe.paths, log: () => {} },
    rng: { decide: probe.decide.next, motor: probe.motor.next, lapse: probe.lapse.next }, engaged: false,
  };
}

function pointDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function projectFlight(p: any): any {
  return {
    id: p.id, kind: p.kind, from: p.from, x: p.x, y: p.y, vx: p.vx, vy: p.vy,
    x0: p.x0, y0: p.y0, t0: p.t0, range: p.range,
  };
}

/** A short real queued attack→swap case: the public windup event is delayed past the source hand change. */
function capturePreReleaseSwapCueWitness(map: any, features: Features): any {
  const swapMap = { ...map, spawns: [{ x: 320, y: 640 }, { x: 576, y: 640 }] };
  const world = createWorld({
    map: swapMap,
    config: {
      minPlayers: 2, lobbySeconds: 0, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
      suddenDeathSeconds: 60, hazards: false, wishLockSeconds: 0, regen: false,
    },
    random: S.mulberry32(7), rewardSalt: [7, 6, 5, 4], questSalt: [3, 2, 1, 0],
    newItemUid: (() => { let id = 0; return () => `swap-cue-item-${++id}`; })(),
  });
  installWeapons(world);
  installTargeting(world);
  installProjectiles(world);
  installVision(world);
  const shooter = addPlayer(world, SHOOTER, "Declared pre-release shooter", { faction: "holy" });
  const watcher = addPlayer(world, WATCHER, "Declared pre-release observer", { faction: "fire" });
  shooter.weapon0 = "wand";
  shooter.weapon1 = "bow";
  const declaredLoadout = {
    shooter: [shooter.weapon0, shooter.weapon1],
    watcher: [watcher.weapon0, watcher.weapon1],
  };

  const channel = new FxChannel();
  const ring = createFrameRing();
  let lastMinimap: any = null;
  const accepted: any[] = [];
  const sourceSteps: any[] = [];
  const delayedChecks: any[] = [];
  const memories = new Map<TierId, ReturnType<typeof createMemory>>();
  const reflexes = new Map<TierId, ReturnType<typeof createReflexes>>();
  const probes = new Map<TierId, any>();
  for (const tier of ["normal", "hard"] as const) {
    memories.set(tier, createMemory({ tier: TIERS[tier], map: world.map, selfId: WATCHER, features }));
    reflexes.set(tier, createReflexes());
    const pathBudget = createPathBudget(64);
    const seed = 7;
    probes.set(tier, {
      pathBudget, paths: createPathService(world.map, pathBudget),
      decide: stream(seed + 0x101), motor: stream(seed + 0x303), lapse: stream(seed + 0x505),
      knowledge: createKnowledge(TIERS[tier], S.mulberry32((seed + 0x707) >>> 0)),
    });
  }

  const stepOnce = (orders: Array<{ actor: string; type: string; msg: any }> = []): void => {
    for (const order of orders) {
      const rt = world.players.get(order.actor);
      const ok = rt ? enqueueClientMessage(rt.inputs, order.type, order.msg) : false;
      accepted.push({ actor: order.actor, type: order.type, accepted: ok, applyTick: world.state.tick + 1 });
    }
    const events = step(world, TICK_MS);
    channel.extendRoster(world.state);
    channel.rosterSent();
    const fxBatch = channel.batch(events.filter((e: any) => e.type === "fx").map((e: any) => e.fx), world.state.serverTime, world.projectiles);
    const frame = perceive({ state: world.state, ...(fxBatch ? { fxs: [fxBatch] } : {}) } as any, {
      selfId: WATCHER, map: world.map, features, canSee: (pt: any) => canPlayerSee(world, WATCHER, pt), lastMinimap,
    } as any);
    lastMinimap = frame.minimap;
    ring.push(frame);
    const percept = ring.compose({
      selfDelayMs: 0, worldDelayMs: SOURCE_WORLD_DELAY_MS, map: world.map, features,
      attentionCentral: TIERS.hard.attention.central,
    });
    sourceSteps.push({
      tick: world.state.tick, time: world.state.serverTime, currentShooterHand: shooter.slot === 1 ? shooter.weapon1 : shooter.weapon0,
      events: events.filter((e: any) => e.type === "fx").map((e: any) => e.fx), fxBatch,
    });
    if (percept) {
      const perceivedShooter = percept.fighters.find((f: any) => f.id === SHOOTER) ?? null;
      for (const tier of ["normal", "hard"] as const) {
        const mem = memories.get(tier)!;
        const stimuli = mem.observe(percept);
        const reflex = reflexes.get(tier)!.check(contextFor(tier, 7, world.map, features, percept, mem, probes.get(tier)));
        const windup = percept.events.find((e: any) => e.kind === "windup" && e.by === SHOOTER) ?? null;
        if (windup || (perceivedShooter?.inHand === "bow" && stimuli.length > 0)) {
          delayedChecks.push({
            tier, now: percept.now, viewT: percept.viewT,
            currentRemoteHand: perceivedShooter?.inHand ?? null,
            deliveredWindup: windup ? { t: windup.t, weapon: windup.weapon, ms: windup.ms, by: windup.by } : null,
            deliveredCancel: percept.events.find((e: any) => e.kind === "cancel" && e.id === SHOOTER)?.t ?? null,
            stimuli, reflex,
          });
        }
      }
    }
  };

  stepOnce();
  const aim = Math.atan2(watcher.y - shooter.y, watcher.x - shooter.x);
  stepOnce([{ actor: SHOOTER, type: "attack", msg: { a: aim, t: world.state.serverTime } }]);
  const attackTime = world.state.serverTime;
  stepOnce([{ actor: SHOOTER, type: "swap", msg: { slot: 1 } }]);
  const swapTime = world.state.serverTime;
  for (let i = 0; i < 8; i++) {
    stepOnce();
    if (delayedChecks.some((x) => x.deliveredWindup && x.currentRemoteHand === "bow")) break;
  }
  const deliveredAfterSwap = delayedChecks.some((x) => x.deliveredWindup && x.currentRemoteHand === "bow");
  assert.ok(deliveredAfterSwap, "the delayed real windup should be observed after the source swap with the current remote hand set to Bow");
  return {
    label: "declared two-seat queued-input case; not ordinary loot or full-world bot proof",
    setup: { spawns: swapMap.spawns, declaredLoadout, seed: 7 },
    attackTime, swapTime, sourceHandAfterSwap: shooter.slot === 1 ? shooter.weapon1 : shooter.weapon0,
    inputReceipts: accepted, sourceSteps, delayedChecks,
    claim: "a source windup batch survives delayed delivery after an actual queued swap; the same Reflexes check receives the delayed percept with the remote shooter currently shown holding Bow",
  };
}

/**
 * Capture actual launch, decoded public batch, delayed perception, memory stimulus and reflex calls.
 * The sole counterfactual is a mathematically rebased copy of the first actual in-flight observation;
 * it is explicitly marked as a consumer-method probe, never as a source-produced launch.
 */
export async function captureFlightWitness(): Promise<Record<string, unknown>> {
  const tiles = new Uint8Array(MAP_W * MAP_H);
  for (let x = 0; x < MAP_W; x++) { tiles[x] = S.TILE_WALL; tiles[(MAP_H - 1) * MAP_W + x] = S.TILE_WALL; }
  for (let y = 0; y < MAP_H; y++) { tiles[y * MAP_W] = S.TILE_WALL; tiles[y * MAP_W + MAP_W - 1] = S.TILE_WALL; }
  const map = S.mapFromTiles(MAP_W, MAP_H, tiles, 20261109);
  // A declared open test arena: the real sim's spawn shuffle chooses the seat positions from these two public points.
  map.spawns = [{ x: 320, y: 640 }, { x: 832, y: 640 }];
  const world = createWorld({
    map,
    config: {
      minPlayers: 2, lobbySeconds: 0, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
      suddenDeathSeconds: 60, hazards: false, wishLockSeconds: 0, regen: false,
    },
    random: S.mulberry32(0x464c4954), rewardSalt: [1, 2, 3, 4], questSalt: [5, 6, 7, 8],
    newItemUid: (() => { let id = 0; return () => `flight-item-${++id}`; })(),
  });
  installWeapons(world);
  installTargeting(world);
  installProjectiles(world);
  installVision(world);

  const shooter = addPlayer(world, SHOOTER, "Declared source shooter", { faction: "holy" });
  const watcher = addPlayer(world, WATCHER, "Declared observer", { faction: "fire" });
  // Declared initial loadout only. No live-time weapon/state/output is installed by this fixture.
  shooter.weapon0 = "wand";
  shooter.weapon1 = "bow";
  watcher.weapon0 = "bow";

  const channel = new FxChannel();
  const ring = createFrameRing();
  const features = featuresFor(world.state, world.map);
  let lastMinimap: any = null;
  let ownerLastMinimap: any = null;
  const perceiveContext = { selfId: WATCHER, map: world.map, features, canSee: (pt: any) => canPlayerSee(world, WATCHER, pt) };
  const memories = new Map<TierId, ReturnType<typeof createMemory>>();
  const reflexes = new Map<TierId, ReturnType<typeof createReflexes>>();
  const probes = new Map<TierId, any>();
  for (const tier of ["normal", "hard"] as const) {
    memories.set(tier, createMemory({ tier: TIERS[tier], map: world.map, selfId: WATCHER, features }));
    reflexes.set(tier, createReflexes());
    const pathBudget = createPathBudget(64);
    // Declared deterministic Reflexes stream for this capture. Record its outcomes verbatim;
    // the seed does not guarantee or imply a juke.
    const seed = tier === "normal" ? 0x46574954 : 6;
    const decide = stream(seed + (tier === "normal" ? 0x101 : 0x202));
    const motor = stream(seed + (tier === "normal" ? 0x303 : 0x404));
    const lapse = stream(seed + (tier === "normal" ? 0x505 : 0x606));
    probes.set(tier, {
      pathBudget,
      paths: createPathService(world.map, pathBudget),
      decide, motor, lapse,
      knowledge: createKnowledge(TIERS[tier], S.mulberry32((seed + (tier === "normal" ? 0x707 : 0x808)) >>> 0)),
    });
  }

  const accepted: Array<{ actor: string; type: string; accepted: boolean; tick: number }> = [];
  const sourceSteps: Array<{ tick: number; time: number; phase: string; events: unknown[]; fxBatch: unknown; launches: unknown[] }> = [];
  const perceptions: Array<{ now: number; viewT: number; watcher: unknown; shooter: unknown; flights: unknown[]; events: unknown[] }> = [];
  const incomingFirstSeen: any[] = [];
  const reflexDecisions: any[] = [];
  const reflexEvaluations: any[] = [];
  const bowDrawObservations: any[] = [];
  const immunityObservations: any[] = [];
  let firstFlightId: string | null = null;
  let firstLaunch: any = null;
  let wandSwapAppliedAt: number | null = null;
  let wandStillVisibleAfterSwap: any = null;
  let bowAttackQueued = false;
  let bowReleaseQueued = false;
  let bowLaunch: any = null;
  let sawBowDraw = false;
  let ownerHealthAtLaunch: number | null = null;
  let ownerHitIds: string[] = [];
  let firstPercept: any = null;
  let joinDisclosureProbe: any = null;

  const captureJoinDisclosure = (): any => {
    const now = world.state.serverTime;
    const liveBefore = world.state.players.get(SHOOTER)?.effects ?? 0;
    const inFlightBatch = channel.inFlight(world.projectiles, now);
    const unpacked = S.unpackLaunches(inFlightBatch);
    const launch = unpacked.find((p: any) => p.id === firstFlightId);
    assert.ok(launch, "the real FxChannel reconnect batch must contain the still-live first projectile");

    const perceiveJoin = (state: any): any => {
      const frame = perceive({ state, fxs: [inFlightBatch] } as any, {
        selfId: WATCHER, map: world.map, features,
        canSee: (pt: any) => canPlayerSee(world, WATCHER, pt), lastMinimap: null,
      } as any);
      const joinRing = createFrameRing();
      joinRing.push(frame);
      return joinRing.compose({
        selfDelayMs: 0, worldDelayMs: 0, map: world.map, features,
        attentionCentral: TIERS.hard.attention.central,
      });
    };

    const visible = perceiveJoin(world.state);
    // This is a declared StateLike projection probe only. the source createWorld uses RaidState, but this is an explicitly declared StateLike copy, not another schema roundtrip.
    // Copy the public player map and exactly one row; never mutate source World or pretend this is a network encoder.
    const projectedState = {
      phase: world.state.phase, serverTime: world.state.serverTime, lobbyEndsAt: world.state.lobbyEndsAt,
      raidStartedAt: world.state.raidStartedAt, minPlayers: world.state.minPlayers, startedWith: world.state.startedWith,
      patienceEndsAt: world.state.patienceEndsAt, inColiseum: world.state.inColiseum, gatesLocked: world.state.gatesLocked,
      suddenDeathAt: world.state.suddenDeathAt, winner: world.state.winner, training: world.state.training,
      players: new Map(world.state.players), mobs: world.state.mobs, containers: world.state.containers,
      roster: world.state.roster, fields: world.state.fields, camps: world.state.camps,
    };
    const sourceShooter = world.state.players.get(SHOOTER);
    assert.ok(sourceShooter, "the current source state must contain the declared shooter");
    const originalCopiedEffects = sourceShooter.effects ?? 0;
    const projectedShooter = { ...sourceShooter, effects: originalCopiedEffects | EFFECT_HIDDEN };
    projectedState.players.set(SHOOTER, projectedShooter);
    const hiddenProjection = perceiveJoin(projectedState);
    assert.equal(world.state.players.get(SHOOTER)?.effects ?? 0, liveBefore, "the declared hidden projection must not mutate the live World");

    const visibleFlight = visible?.projectiles.find((p: any) => p.id === firstFlightId) ?? null;
    const hiddenFlight = hiddenProjection?.projectiles.find((p: any) => p.id === firstFlightId) ?? null;
    assert.ok(visibleFlight && hiddenFlight, "the same actual in-flight batch must survive both current-state projections");
    assert.ok(visible?.fighters.some((f: any) => f.id === SHOOTER), "the unmodified current state should draw the shooter");
    assert.ok(!hiddenProjection?.fighters.some((f: any) => f.id === SHOOTER), "the declared hidden projection should omit the caster from fighters");
    assert.ok(visibleFlight.t0 < now && hiddenFlight.t0 < now, "the reconnect batch should first reveal an already-launched flight");
    const rawOwner = (inFlightBatch.o ?? []).find((pair: any) => pair[0] === firstFlightId)?.[1] ?? null;
    return {
      label: "declared copied-state disclosure probe; not an earned hidden attack or live status transition",
      now,
      currentStateProjection: "declared copied StateLike view over actual RaidState values; not a schema/network hidden-status roundtrip",
      input: "actual FxChannel.inFlight(world.projectiles, now) batch, decoded by shared unpackLaunches",
      onlyProjectionMutation: { actor: SHOOTER, field: "effects", before: originalCopiedEffects, after: projectedShooter.effects, hiddenBit: EFFECT_HIDDEN },
      liveWorldEffectsAfter: world.state.players.get(SHOOTER)?.effects ?? 0,
      rawPublicBatch: {
        time: inFlightBatch.t,
        launchTuple: inFlightBatch.p?.find((tuple: any) => tuple[0] === firstFlightId) ?? null,
        ownerIdForFlight: rawOwner,
        decodedLaunch: {
          id: launch.id, kind: launch.kind, x: launch.x, y: launch.y, vx: launch.vx, vy: launch.vy,
          t: launch.t, range: launch.range, ownerId: launch.ownerId ?? null,
        },
      },
      visibleCurrentState: {
        shooterDrawn: visible.fighters.some((f: any) => f.id === SHOOTER),
        launch: projectFlight(visibleFlight),
        attributedFrom: visibleFlight.from,
      },
      hiddenDeclaredProjection: {
        shooterDrawn: hiddenProjection.fighters.some((f: any) => f.id === SHOOTER),
        launch: projectFlight(hiddenFlight),
        attributedFrom: hiddenFlight.from,
      },
      interpretation: "the copied projection removes the caster row while the same public reconnect launch retains origin/time/velocity/range; frame attribution is null when no visible fighter is near that origin, while the raw public Fx side table still names its owner",
    };
  };

  const runStep = (orders: Array<{ actor: string; type: string; msg: unknown }> = []): void => {
    for (const order of orders) {
      const rt = world.players.get(order.actor);
      const result = rt ? enqueueClientMessage(rt.inputs, order.type, order.msg) : false;
      accepted.push({ actor: order.actor, type: order.type, accepted: result, tick: world.state.tick + 1 });
    }
    const events = step(world, TICK_MS);
    channel.extendRoster(world.state);
    channel.rosterSent();
    const batch = channel.batch(events.filter((e: any) => e.type === "fx").map((e: any) => e.fx), world.state.serverTime, world.projectiles);
    const decodedLaunches = batch ? S.unpackLaunches(batch) : [];
    const input = { state: world.state, ...(batch ? { fxs: [batch] } : {}) } as any;
    const frame = perceive(input, { ...perceiveContext, lastMinimap } as any);
    lastMinimap = frame.minimap;
    const ownerFrame = perceive(input, { ...perceiveContext, selfId: SHOOTER, lastMinimap: ownerLastMinimap } as any);
    ownerLastMinimap = ownerFrame.minimap;
    ring.push(frame);
    const percept = ring.compose({
      selfDelayMs: 0, worldDelayMs: SOURCE_WORLD_DELAY_MS, map: world.map, features,
      attentionCentral: TIERS.hard.attention.central,
    });
    const simEvents = events.map((e: any) => e.type === "fx" ? { type: e.type, fx: e.fx } : { type: e.type });
    sourceSteps.push({
      tick: world.state.tick, time: world.state.serverTime, phase: world.state.phase,
      events: simEvents, fxBatch: batch, launches: decodedLaunches,
    });
    if (decodedLaunches.length > 0) {
      for (const launch of decodedLaunches as any[]) {
        if (firstLaunch === null) {
          firstLaunch = launch;
          firstFlightId = launch.id;
          ownerHealthAtLaunch = world.state.players.get(SHOOTER)?.hp ?? null;
        } else if (launch.kind === "arrow" && bowLaunch === null) bowLaunch = launch;
      }
    }
    if (percept) {
      const liveShooter = percept.fighters.find((f: any) => f.id === SHOOTER) ?? null;
      const me = percept.self;
      const flights = percept.projectiles.map(projectFlight);
      immunityObservations.push({
        now: percept.now, viewT: percept.viewT, ownerSelfImmuneUntil: ownerFrame.self.immuneUntil,
        ownerAsSeenByWatcherImmune: liveShooter?.immune ?? null,
      });
      if (liveShooter?.inHand === "bow" && liveShooter.drawStartedAt > 0) {
        bowDrawObservations.push({
          now: percept.now, viewT: percept.viewT, id: liveShooter.id, inHand: liveShooter.inHand,
          drawStartedAt: liveShooter.drawStartedAt, facing: liveShooter.facing,
        });
      }
      const eventsHere = percept.events.map((e: any) => ({ kind: e.kind, by: e.by ?? null, weapon: e.weapon ?? null, at: e.at, t: e.t }));
      perceptions.push({
        now: percept.now, viewT: percept.viewT,
        watcher: { id: me.id, x: me.x, y: me.y, faction: me.faction },
        shooter: liveShooter ? { id: liveShooter.id, x: liveShooter.x, y: liveShooter.y, inHand: liveShooter.inHand, drawStartedAt: liveShooter.drawStartedAt, facing: liveShooter.facing } : null,
        flights, events: eventsHere,
      });
      if (firstPercept === null && firstFlightId && flights.some((p: any) => p.id === firstFlightId)) firstPercept = percept;
      for (const tier of ["normal", "hard"] as const) {
        const mem = memories.get(tier)!;
        const stimuli = mem.observe(percept);
        const incoming = stimuli.filter((s: any) => s.kind === "incoming");
        if (incoming.some((s: any) => s.subject === firstFlightId)) {
          incomingFirstSeen.push({ tier, now: percept.now, viewT: percept.viewT, stimuli: incoming, flight: flights.find((p: any) => p.id === firstFlightId) ?? null });
        }
        const ctx = contextFor(tier, 0x46574954, world.map, features, percept, mem, probes.get(tier));
        const reflex = reflexes.get(tier)!.check(ctx);
        if (reflex) reflexDecisions.push({ tier, now: percept.now, viewT: percept.viewT, reflex });
        if (incoming.length > 0 || (liveShooter?.inHand === "bow" && liveShooter.drawStartedAt > 0)) {
          reflexEvaluations.push({
            tier, now: percept.now, viewT: percept.viewT,
            incoming: incoming.map((s: any) => ({ subject: s.subject, value: s.value })),
            bowDraw: liveShooter?.inHand === "bow" && liveShooter.drawStartedAt > 0
              ? { id: liveShooter.id, drawStartedAt: liveShooter.drawStartedAt, facing: liveShooter.facing } : null,
            reflex,
          });
        }
        if (!sawBowDraw && liveShooter?.inHand === "bow" && liveShooter.drawStartedAt > 0) sawBowDraw = true;
        if (wandSwapAppliedAt !== null && wandStillVisibleAfterSwap === null && liveShooter?.inHand === "bow" && flights.some((p: any) => p.id === firstFlightId && p.kind === "ball")) {
          wandStillVisibleAfterSwap = { now: percept.now, viewT: percept.viewT, shooterHand: liveShooter.inHand, flight: flights.find((p: any) => p.id === firstFlightId) };
        }
      }
    }
    const hits = events.filter((e: any) => e.type === "fx" && e.fx?.kind === "hit" && e.fx.id === SHOOTER);
    ownerHitIds.push(...hits.map((e: any) => e.fx.id));
    if (!joinDisclosureProbe && firstFlightId && world.projectiles.has(firstFlightId) && world.state.serverTime >= 800) {
      joinDisclosureProbe = captureJoinDisclosure();
    }
    if (!bowAttackQueued && wandSwapAppliedAt !== null && world.state.serverTime >= (shooter.readyAt ?? 0) && world.state.players.get(SHOOTER)?.slot === 1) {
      const a = Math.atan2(watcher.y - shooter.y, watcher.x - shooter.x);
      bowAttackQueued = enqueueClientMessage(world.players.get(SHOOTER)!.inputs, "attack", { a, t: world.state.serverTime });
      accepted.push({ actor: SHOOTER, type: "attack", accepted: bowAttackQueued, tick: world.state.tick + 1 });
      // The just-queued attack is applied on the next simulation step, so this is an audit marker only.
    }
  };

  // Real lobby-to-active transition. The fixed step starts the raid and assigns the declared map spawns.
  runStep();
  const initialPositions = {
    shooter: { x: shooter.x, y: shooter.y, faction: shooter.faction, slots: [shooter.weapon0, shooter.weapon1] },
    watcher: { x: watcher.x, y: watcher.y, faction: watcher.faction, slots: [watcher.weapon0, watcher.weapon1] },
  };
  const aim = Math.atan2(watcher.y - shooter.y, watcher.x - shooter.x);
  runStep([{ actor: SHOOTER, type: "attack", msg: { a: aim, t: world.state.serverTime } }]);
  runStep([{ actor: SHOOTER, type: "release", msg: { a: aim, t: world.state.serverTime } }]);

  for (let n = 0; n < MAX_STEPS; n++) {
    const orders: Array<{ actor: string; type: string; msg: unknown }> = [];
    if (firstLaunch && wandSwapAppliedAt === null && world.state.serverTime > firstLaunch.t + TICK_MS) {
      orders.push({ actor: SHOOTER, type: "swap", msg: { slot: 1 } });
    } else if (firstLaunch && wandSwapAppliedAt !== null && !bowReleaseQueued && bowAttackQueued) {
      const a = Math.atan2(watcher.y - shooter.y, watcher.x - shooter.x);
      orders.push({ actor: SHOOTER, type: "release", msg: { a, t: world.state.serverTime } });
      bowReleaseQueued = true;
    }
    runStep(orders);
    if (orders.some((o) => o.type === "swap") && world.state.players.get(SHOOTER)?.slot === 1) wandSwapAppliedAt = world.state.serverTime;
    if (bowLaunch && !world.projectiles.has(bowLaunch.id) && bowReleaseQueued && sourceSteps.length > 20) break;
    if (world.state.phase === "ended") break;
    if (n > 25 && bowLaunch !== null && wandStillVisibleAfterSwap !== null) break;
  }

  let rebaseProbe: any = null;
  if (firstPercept && firstFlightId) {
    const actual = firstPercept.projectiles.find((p: any) => p.id === firstFlightId);
    if (actual) {
      const distance = pointDistance(actual, { x: actual.x0, y: actual.y0 });
      const rebased = {
        ...actual, x0: actual.x, y0: actual.y, t0: firstPercept.viewT, range: Math.max(0, actual.range - distance),
      };
      const comparisons: any[] = [];
      for (const tier of ["normal", "hard"] as const) {
        const mem = memories.get(tier)!;
        // These are separate identical-seed method probes over the same actual source Percept.
        const probeSeed = 0x52454241 + (tier === "normal" ? 0 : 1);
        const makeProbe = (): any => {
          const pathBudget = createPathBudget(64);
          const decide = stream(probeSeed + (tier === "normal" ? 0x101 : 0x202));
          return {
            pathBudget, paths: createPathService(world.map, pathBudget), decide,
            motor: stream(probeSeed + (tier === "normal" ? 0x303 : 0x404)),
            lapse: stream(probeSeed + (tier === "normal" ? 0x505 : 0x606)),
            knowledge: createKnowledge(TIERS[tier], S.mulberry32((probeSeed + (tier === "normal" ? 0x707 : 0x808)) >>> 0)),
          };
        };
        const actualMem = createMemory({ tier: TIERS[tier], map: world.map, selfId: WATCHER, features });
        actualMem.observe(firstPercept);
        const candidateMem = createMemory({ tier: TIERS[tier], map: world.map, selfId: WATCHER, features });
        candidateMem.observe(firstPercept);
        const actualProbe = makeProbe();
        const rebasedProbe = makeProbe();
        const actualCtx = contextFor(tier, probeSeed, world.map, features, firstPercept, actualMem, actualProbe);
        const candidatePercept = { ...firstPercept, projectiles: [rebased] };
        const candidateCtx = contextFor(tier, probeSeed, world.map, features, candidatePercept, candidateMem, rebasedProbe);
        const actualReflex = createReflexes().check(actualCtx);
        const rebasedReflex = createReflexes().check(candidateCtx);
        comparisons.push({ tier, actualReflex, rebasedReflex });
      }
      rebaseProbe = {
        label: "derived candidate only; not source output",
        scope: "one actual first-visible Percept with isolated Reflexes calls; this sample does not claim multi-frame history or dedupe equivalence",
        actual: projectFlight(actual),
        candidate: { ...projectFlight(rebased), remainingRangeDerivedFromActualFlight: true },
        actualFirstVisibleTravelled: distance,
        comparisons,
      };
    }
  }

  assert.equal(firstLaunch?.kind, "ball", "the real queued Wand input must produce a decoded public ball launch");
  assert.equal(bowLaunch?.kind, "arrow", "the real post-swap Bow input must produce a decoded public arrow launch");
  assert.ok(wandStillVisibleAfterSwap, "the already-launched public Wand flight must remain in the delayed view after hand swap");
  assert.ok(incomingFirstSeen.length > 0, "the real delayed percept and memory must expose the first-seen flight");
  assert.ok(rebaseProbe && rebaseProbe.actualFirstVisibleTravelled > 0, "the first delayed flight view must be midflight");
  assert.ok(sawBowDraw && bowDrawObservations.length > 0, "the public Bow draw state must be observed before its source launch");

  const sourceShooter = world.state.players.get(SHOOTER)!;
  const sourceWatcher = world.state.players.get(WATCHER)!;
  const preReleaseSwapCueWitness = capturePreReleaseSwapCueWitness(map, features);
  return {
    schema: "bot-public-facts-flight/1",
    claimScope: "declared map, seats, factions and initial loadouts; actual queued inputs, fixed-step weapons, projectile spawn, FxChannel encoding, shared unpacking, source perception, FrameRing, memory and real Reflexes; not ordinary loot-acquisition or full-world bot proof",
    setup: {
      map: { seed: map.seed, widthTiles: map.w, heightTiles: map.h, boundaryWalls: true, spawns: map.spawns },
      config: { minPlayers: world.config.minPlayers, lobbySeconds: world.config.lobbySeconds, tickMs: TICK_MS, worldRenderDelayMs: SOURCE_WORLD_DELAY_MS, sourceRenderDelayMs: WORLD_RENDER_DELAY_MS, maxSteps: MAX_STEPS },
      initialPositions,
    },
    inputs: accepted,
    firstSourceFlight: firstLaunch,
    bowSourceFlight: bowLaunch,
    joinDisclosureProbe,
    sourceSteps,
    firstSeenIncoming: incomingFirstSeen,
    reflexDecisions,
    reflexEvaluations,
    rebaseProbe,
    retainedBallAfterSwap: wandStillVisibleAfterSwap,
    bowDrawObservations,
    bowPublicDrawObserved: sawBowDraw,
    ownerSelfImmunityClock: immunityObservations,
    joinDisclosureProbe,
    preReleaseSwapCueWitness,
    ownProjectileExclusion: {
      launchOwnerId: firstLaunch?.ownerId ?? null,
      shooterHpAtLaunch: ownerHealthAtLaunch,
      shooterHpAfterRun: sourceShooter.hp,
      hitEventsNamingShooter: ownerHitIds,
      trackedProjectilesAtEnd: [...world.projectiles.keys()],
    },
    final: {
      time: world.state.serverTime, tick: world.state.tick, phase: world.state.phase,
      shooter: { x: sourceShooter.x, y: sourceShooter.y, hp: sourceShooter.hp, status: sourceShooter.status, hand: sourceShooter.slot === 1 ? sourceShooter.weapon1 : sourceShooter.weapon0 },
      watcher: { x: sourceWatcher.x, y: sourceWatcher.y, hp: sourceWatcher.hp, status: sourceWatcher.status },
    },
  };
}

/**
 * Actual fixed-step World witness for public NPC continuity. The only declared inputs are the
 * immutable test arena, seats, configuration and deterministic RNG seeds. Camps and their mobs are
 * produced by the ordinary createGameWorld/raidStarted path. The queued observer movements enter the
 * regular per-player input queue; every simulation advance is one real 50 ms step.
 */
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  CAMP_RESPAWN_MS, TILE_FLOOR, TICK_MS, VISION_RADIUS, VISION_TRAIL_MS,
  mapFromTiles, mulberry32, type CampDef,
} from "@raid/shared";
import { createGameWorld } from "../../packages/server/src/sim/gameplay.ts";
import { addPlayer, step } from "../../packages/server/src/sim/step.ts";
import { enqueueClientMessage } from "../../packages/server/src/sim/inputs.ts";
import { canPlayerSee } from "../../packages/server/src/sim/vision.ts";
import type { World } from "../../packages/server/src/sim/world.ts";
import { BOT_VIEW, WORLD_RENDER_DELAY_MS } from "../../packages/server/src/bots/brain/types.ts";

const WIDTH = 96;
const HEIGHT = 48;
const WORLD_SEED = 0x4e504331;
const WORLD_RANDOM_SEED = 0x6e706331;
const REWARD_SALT = [0x101, 0x202, 0x303, 0x404] as const;
const QUEST_SALT = [0x505, 0x606, 0x707, 0x808] as const;
const PLAYER_IDS = ["continuity-a", "continuity-b"] as const;
const CAMP_SPOTS = [
  { x: 1584, y: 624 },
  { x: 1616, y: 624 },
  { x: 1552, y: 624 },
] as const;
const SPAWNS = [
  { x: 784, y: 624 },
  { x: 2704, y: 624 },
] as const;
const OUTBOUND = { x: 80, y: 624 } as const;
const ON_SCREEN_MARGIN = 100;
const MOVE_TICK_LIMIT = 500;
const TRAIL_WAIT_MS = VISION_TRAIL_MS + 250;
const SETTLE_AFTER_REENTRY_MS = WORLD_RENDER_DELAY_MS + 2 * TICK_MS;

export interface WorldStepContext {
  world: World;
  events: ReturnType<typeof step>;
  label: string;
  viewerId: string | null;
  targetId: string | null;
}

export type WorldStepObserver = (context: WorldStepContext) => void | Promise<void>;

interface VisibilitySample {
  tick: number;
  serverTime: number;
  observer: { x: number; y: number };
  target: { x: number; y: number; status: string } | null;
  distance: number | null;
  canPlayerSee: boolean | null;
}

/**
 * Capture a single earned lifecycle: normal camp spawn, initially visible mob, living mob outside
 * the observer's sight after the full trail expiry, then that same source actor visible on return.
 * `onStep` runs after every actual fixed 50 ms step and can feed the same World to Schema/human/bot
 * readers. No source actor, phase, HP, loadout or movement field is written after createGameWorld.
 */
export async function captureWorldHistory(onStep: WorldStepObserver): Promise<Record<string, unknown>> {
  const tiles = new Uint8Array(WIDTH * HEIGHT).fill(TILE_FLOOR);
  const map = mapFromTiles(WIDTH, HEIGHT, tiles, WORLD_SEED);
  map.spawns = SPAWNS.map((p) => ({ ...p }));
  const camp: CampDef = {
    id: "fire-1",
    zone: "fire",
    x: CAMP_SPOTS[0].x,
    y: CAMP_SPOTS[0].y,
    r: 128,
    spots: CAMP_SPOTS.map((p) => ({ ...p })),
    eliteSpot: -1,
    chest: { x: 1584, y: 656 },
    area: 64,
    radius: 128,
  };
  map.camps = [camp];

  const rng = mulberry32(WORLD_RANDOM_SEED);
  const rngHash = createHash("sha256");
  let rngDraws = 0;
  const tracedRandom = (): number => {
    const value = rng();
    const bytes = Buffer.allocUnsafe(8);
    bytes.writeDoubleLE(value, 0);
    rngHash.update(bytes);
    rngDraws++;
    return value;
  };

  const config = {
    minPlayers: 2,
    lobbySeconds: 30,
    fillSeconds: 0,
    patienceSeconds: 3600,
    patienceMinSeconds: 3600,
    suddenDeathSeconds: 3600,
    mobs: true,
    training: false,
    dummies: false,
    planSeconds: 0,
    pvpRules: false,
  };
  let itemUid = 0;
  const world = createGameWorld({
    seed: WORLD_SEED,
    map,
    config,
    random: tracedRandom,
    rewardSalt: REWARD_SALT,
    questSalt: QUEST_SALT,
    newItemUid: () => `npc-continuity-${++itemUid}`,
  });
  assert.equal(world.map.camps.length, 1, "one declared natural camp in this focused arena");
  for (const id of PLAYER_IDS) addPlayer(world, id, id, { faction: "fire" });

  let viewerId: string | null = null;
  let targetId: string | null = null;
  let sourceStepCount = 0;
  let tickLabel = "lobby";
  const inputs: Array<Record<string, unknown>> = [];
  const visibility: VisibilitySample[] = [];
  const milestones: Record<string, unknown> = {
    initiallyVisible: null,
    initialOnScreen: null,
    livingOutOfSightAfterTrail: null,
    sameActorVisibleOnReturn: null,
  };
  let outboundReached = false;
  let outboundReachedAt: number | null = null;
  let returnQueuedAt: number | null = null;

  const sourceStep = async (label: string): Promise<ReturnType<typeof step>> => {
    const events = step(world, TICK_MS);
    sourceStepCount++;
    if (viewerId === null && world.state.phase === "active") {
      const mob = [...world.state.mobs].find(([, state]) => state.kind === "mob" && state.status === "alive");
      assert(mob, "normal raid start must spawn the declared non-elite camp roster");
      assert.equal(world.state.mobs.size, CAMP_SPOTS.length, "raidStarted creates exactly one normal mob per declared camp spot");
      targetId = mob[0];
      const target = world.state.mobs.get(targetId)!;
      const placements = [...world.state.players].map(([id, player]) => ({
        id,
        position: { x: player.x, y: player.y },
        distance: Math.hypot(player.x - target.x, player.y - target.y),
      })).sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
      viewerId = placements[0]!.id;
      const observer = world.state.players.get(viewerId)!;
      assert(placements[0]!.distance <= VISION_RADIUS, "one shuffled seat should begin inside actual camp sight");
      assert(placements[1]!.distance > VISION_RADIUS, "second shuffled seat is reserved as a non-interacting control");
      tickLabel = "active-visible-start";
      milestones.initialPlacement = {
        actualObserverId: viewerId,
        actualTargetId: targetId,
        observer: { x: observer.x, y: observer.y, faction: observer.faction, weapon0: observer.weapon0, weapon1: observer.weapon1, slot: observer.slot },
        target: { x: target.x, y: target.y, kind: target.kind, type: target.type, faction: target.faction, status: target.status, camp: target.camp },
        sourceSpawnedMobs: [...world.state.mobs].map(([id, state]) => ({
          id, x: state.x, y: state.y, kind: state.kind, type: state.type, faction: state.faction, status: state.status, camp: state.camp,
        })),
        sourceCamp: [...world.state.camps].map((state) => ({ type: state.type, elite: state.elite, alive: state.alive, state: state.state })),
        distance: placements[0]!.distance,
      };
    }
    const thisLabel = label || tickLabel;
    if (viewerId !== null && targetId !== null) {
      const player = world.state.players.get(viewerId)!;
      const target = world.state.mobs.get(targetId);
      const canSee = target ? canPlayerSee(world, viewerId, { x: target.x, y: target.y }) : false;
      const distance = target ? Math.hypot(player.x - target.x, player.y - target.y) : null;
      const sample: VisibilitySample = {
        tick: world.state.tick,
        serverTime: world.state.serverTime,
        observer: { x: player.x, y: player.y },
        target: target ? { x: target.x, y: target.y, status: target.status } : null,
        distance,
        canPlayerSee: canSee,
      };
      visibility.push(sample);
      if (outboundReached && !milestones.livingOutOfSightAfterTrail && target?.status === "alive"
          && distance !== null && distance > VISION_RADIUS && !canSee
          && world.state.serverTime - outboundReachedAt! >= TRAIL_WAIT_MS) {
        milestones.livingOutOfSightAfterTrail = { ...sample, sameTargetId: targetId, trailWaitMs: world.state.serverTime - outboundReachedAt! };
      }
      const insideScreenWindow = distance !== null
        && Math.abs(player.x - target!.x) <= BOT_VIEW.halfW - ON_SCREEN_MARGIN
        && Math.abs(player.y - target!.y) <= BOT_VIEW.halfH - ON_SCREEN_MARGIN;
      if (returnQueuedAt !== null && milestones.livingOutOfSightAfterTrail && !milestones.sameActorVisibleOnReturn
          && target?.status === "alive" && canSee && insideScreenWindow && targetId === milestones.targetId) {
        milestones.sameActorVisibleOnReturn = { ...sample, sameTargetId: targetId };
      }
    }
    await onStep({ world, events, label: thisLabel, viewerId, targetId });
    return events;
  };

  const queueMove = (id: string, at: { x: number; y: number }, label: string): void => {
    const runtime = world.players.get(id);
    assert(runtime, `known player runtime: ${id}`);
    const accepted = enqueueClientMessage(runtime.inputs, "move", { x: at.x, y: at.y });
    inputs.push({ tick: world.state.tick, serverTime: world.state.serverTime, actorId: id, kind: "move", target: at, accepted, label });
    assert.equal(accepted, true, `normal queued move accepted: ${label}`);
  };

  for (let i = 0; i < 2 && world.state.phase !== "active"; i++) await sourceStep("lobby-to-raid");
  assert.equal(world.state.phase, "active", "two joined human seats should start the raid through ordinary lobby stepping");
  assert(viewerId && targetId, "actual active viewer and natural camp mob resolved before the first active callback");
  const initialObserver = world.state.players.get(viewerId)!;
  const initialTarget = world.state.mobs.get(targetId)!;
  assert.equal(initialTarget.kind, "mob");
  assert.equal(initialTarget.status, "alive");
  assert.equal(milestones.initialPlacement === null, false);
  const initialPosition = { x: initialObserver.x, y: initialObserver.y };
  const closeReturnTarget = { x: initialTarget.x + (initialPosition.x < initialTarget.x ? -584 : 584), y: initialTarget.y };
  const observerSpawn = [...SPAWNS].sort((a, b) =>
    Math.hypot(a.x - initialPosition.x, a.y - initialPosition.y) - Math.hypot(b.x - initialPosition.x, b.y - initialPosition.y),
  )[0]!;
  milestones.initiallyVisible = {
    tick: world.state.tick,
    serverTime: world.state.serverTime,
    observer: { x: initialObserver.x, y: initialObserver.y },
    target: { id: targetId, x: initialTarget.x, y: initialTarget.y, status: initialTarget.status },
    distance: Math.hypot(initialObserver.x - initialTarget.x, initialObserver.y - initialTarget.y),
    canPlayerSee: canPlayerSee(world, viewerId, { x: initialTarget.x, y: initialTarget.y }),
  };
  assert.equal(milestones.initiallyVisible.canPlayerSee, true, "source initial observer has sight of target");
  milestones.targetId = targetId;

  // Move a little closer on ordinary queued input so downstream Percept/FrameRing readers see an
  // unambiguous on-screen row, away from both the 900u sight edge and the 800u screen edge.
  queueMove(viewerId, closeReturnTarget, "initial-on-screen-confirmation");
  let reachedOnScreen = false;
  for (let i = 0; i < MOVE_TICK_LIMIT; i++) {
    await sourceStep("observer-approaching-on-screen");
    const p = world.state.players.get(viewerId)!;
    const m = world.state.mobs.get(targetId)!;
    const dx = Math.abs(p.x - m.x), dy = Math.abs(p.y - m.y);
    if (m.status === "alive" && canPlayerSee(world, viewerId, { x: m.x, y: m.y })
        && dx <= BOT_VIEW.halfW - ON_SCREEN_MARGIN && dy <= BOT_VIEW.halfH - ON_SCREEN_MARGIN) {
      reachedOnScreen = true;
      milestones.initialOnScreen = {
        tick: world.state.tick,
        serverTime: world.state.serverTime,
        observer: { x: p.x, y: p.y },
        target: { id: targetId, x: m.x, y: m.y, status: m.status },
        delta: { x: m.x - p.x, y: m.y - p.y },
        sourceCanSee: true,
        withinScreenWindow: true,
      };
      break;
    }
  }
  assert(reachedOnScreen, "target becomes safely on-screen after a real queued approach move");

  const outboundAt = world.state.serverTime;
  // Use the map edge on the same half as the observer's real shuffled placement and far beyond the sight radius.
  const outboundTarget = observerSpawn.x === SPAWNS[0].x
    ? OUTBOUND
    : { x: WIDTH * 32 - OUTBOUND.x, y: OUTBOUND.y };
  queueMove(viewerId, outboundTarget, "leave-target-sight");
  let reached = false;
  for (let i = 0; i < MOVE_TICK_LIMIT; i++) {
    await sourceStep("observer-moving-out");
    const p = world.state.players.get(viewerId)!;
    if (Math.hypot(p.x - outboundTarget.x, p.y - outboundTarget.y) <= 20) { reached = true; break; }
  }
  assert(reached, "observer reaches declared out-of-sight map point via queued move");
  outboundReached = true;
  outboundReachedAt = world.state.serverTime;
  milestones.outboundReached = {
    tick: world.state.tick,
    serverTime: world.state.serverTime,
    observer: { x: world.state.players.get(viewerId)!.x, y: world.state.players.get(viewerId)!.y },
    targetId,
    targetStatus: world.state.mobs.get(targetId)!.status,
    distance: Math.hypot(world.state.players.get(viewerId)!.x - world.state.mobs.get(targetId)!.x, world.state.players.get(viewerId)!.y - world.state.mobs.get(targetId)!.y),
  };
  const trailTicks = Math.ceil(TRAIL_WAIT_MS / TICK_MS);
  for (let i = 0; i < trailTicks; i++) await sourceStep("hold-outside-through-trail-expiry");
  assert(milestones.livingOutOfSightAfterTrail, "target remains alive and actually unseen after the full source vision trail expires");
  queueMove(viewerId, closeReturnTarget, "return-to-camp-sight");
  returnQueuedAt = world.state.serverTime;
  let returned = false;
  for (let i = 0; i < MOVE_TICK_LIMIT; i++) {
    await sourceStep("observer-returning");
    if (milestones.sameActorVisibleOnReturn) { returned = true; break; }
  }
  assert(returned, "same live source mob becomes visible again after ordinary queued return movement");
  for (let i = 0; i < Math.ceil(SETTLE_AFTER_REENTRY_MS / TICK_MS); i++) await sourceStep("settle-screen-reentry-delay");
  const endHash = rngHash.digest("hex");
  return {
    format: "rh-npc-continuity-world/1",
    sourceStepCount,
    declaredSetup: {
      map: { seed: WORLD_SEED, widthTiles: WIDTH, heightTiles: HEIGHT, allFloor: true, spawns: SPAWNS, camp },
      seats: PLAYER_IDS.map((id) => ({ id, faction: "fire", loadout: "source default empty hands" })),
      config,
      movement: {
        initialOnScreenTarget: closeReturnTarget,
        outboundTarget,
        returnTarget: closeReturnTarget,
        sourceVisionRadius: VISION_RADIUS,
        sourceTrailMs: VISION_TRAIL_MS,
        botView: { halfWidth: BOT_VIEW.halfW, halfHeight: BOT_VIEW.halfH, safeMargin: ON_SCREEN_MARGIN },
        settleAfterReentryMs: SETTLE_AFTER_REENTRY_MS,
      },
      classification: "declared arena geometry and starting seats; all actors and observed positions are source-produced",
    },
    rng: {
      worldRandom: { seed: WORLD_RANDOM_SEED, calls: rngDraws, sha256OfLittleEndianF64Draws: endHash, scope: "opts.random only; createGameWorld separates fixed rewardSalt/questSalt streams" },
      rewardSalt: REWARD_SALT,
      questSalt: QUEST_SALT,
      itemUidCalls: itemUid,
    },
    actualInputs: inputs,
    actualLifecycle: milestones,
    visibilitySamples: visibility,
    lifecycleGaps: {
      hiddenDeathAndReplacement: "not attempted in this bounded witness; this proves living out-of-sight return only",
      observerMemorySemantics: "parent consumer derives its own result from every actual step; this source producer does not infer death from absence",
      observedOutputProvenance: "all lifecycle positions/statuses above are sampled from the live World after step; no fixture snapshot is installed",
      outboundStartedAt: outboundAt,
      outboundReachedAt: outboundReachedAt!,
      returnQueuedAt,
      campRespawnMs: CAMP_RESPAWN_MS,
    },
  };
}

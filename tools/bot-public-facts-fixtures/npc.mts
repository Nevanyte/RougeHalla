// Narrow actual-source witness for human NPC publication and bot-facing public memory.
// All actor timelines below are DECLARED RaidState snapshots, round-tripped through the real Colyseus schema
// Encoder/Decoder. They exercise the actual human visibility/perception/FrameRing/Memory functions, but do not claim
// a Sim-earned NPC death, return-home action, or respawn.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Decoder, Encoder } from "@colyseus/schema";
import { mapFromTiles, TILE_FLOOR, TILE_WALL } from "../../packages/shared/src/map.ts";
import { RaidState, PlayerState, MobState } from "../../packages/shared/src/schema.ts";
import { RaidVision } from "../../packages/client/src/render/RaidVision.ts";
import { shouldRenderActor } from "../../packages/client/src/render/visibility.ts";
import { perceive } from "../../packages/server/src/bots/brain/perception.ts";
import { FrameRing } from "../../packages/server/src/bots/brain/frames.ts";
import { createMemory } from "../../packages/server/src/bots/brain/memory.ts";
import { TIERS, type Features, type MobView } from "../../packages/server/src/bots/brain/types.ts";
import { MOB_HUNT, MobHunter } from "../../packages/server/src/bots/mobHunt.ts";

const SELF_ID = "viewer-human";
const FLOOR = TILE_FLOOR;
const FEATURES: Features = {
  messageTypes: [], wishes: false, statusEffects: true, fields: false, planning: false,
  chests: false, skills: false, relics: false, camps: false, hazards: false,
};
const sha256 = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
const repoRootUrl = new URL("../../", import.meta.url);
const repoPath = (relative: string): string => fileURLToPath(new URL(relative, repoRootUrl));

const SOURCE_FILES = [
  "packages/shared/src/schema.ts",
  "packages/shared/src/map.ts",
  "packages/shared/src/constants.ts",
  "packages/shared/src/messages.ts",
  "packages/shared/src/vision.ts",
  "packages/shared/src/factions.ts",
  "packages/shared/src/mobs.ts",
  "packages/shared/src/weapons.ts",
  "packages/server/src/bots/brain/perception.ts",
  "packages/server/src/bots/brain/frames.ts",
  "packages/server/src/bots/brain/memory.ts",
  "packages/server/src/bots/brain/types.ts",
  "packages/server/src/bots/mobHunt.ts",
  "packages/client/src/render/RaidVision.ts",
  "packages/client/src/render/visibility.ts",
  "package-lock.json",
  "packages/shared/package.json",
  "packages/server/package.json",
  "packages/client/package.json",
  "tsconfig.base.json",
];

function floorMap(): ReturnType<typeof mapFromTiles> {
  const w = 64, h = 40;
  return mapFromTiles(w, h, new Uint8Array(w * h).fill(FLOOR));
}

function stateRoundTrip(atMs: number, npcRows: readonly {
  id: string; x: number; y: number; hp: number; maxHp: number; effects?: number; name?: string;
}[], mapHash: number, rosterHistory: readonly string[] = []): { state: InstanceType<typeof RaidState>; bytes: number; rawActors: object[] } {
  const state = new RaidState();
  state.phase = "active";
  state.serverTime = atMs;
  state.training = false;
  state.gatesLocked = false;
  state.seed = mapHash >>> 0;

  const player = new PlayerState();
  player.name = "Witness viewer";
  player.status = "alive";
  player.x = 528;
  player.y = 528;
  player.hp = player.maxHp = 100;
  player.faction = "fire";
  player.weapon0 = "sword";
  state.players.set(SELF_ID, player);
  state.roster.push(SELF_ID);
  const rosterIds = new Set<string>([SELF_ID]);
  for (const id of rosterHistory) {
    if (rosterIds.has(id)) continue;
    rosterIds.add(id);
    state.roster.push(id);
  }

  const rawActors: object[] = [];
  for (const row of npcRows) {
    const mob = new MobState();
    mob.kind = "mob";
    mob.name = row.name ?? "Ember Imp";
    mob.type = "emberImp";
    mob.faction = "fire";
    mob.status = "alive";
    mob.x = row.x;
    mob.y = row.y;
    mob.hp = row.hp;
    mob.maxHp = row.maxHp;
    mob.weapon0 = "sword";
    mob.effects = row.effects ?? 0;
    state.mobs.set(row.id, mob);
    if (!rosterIds.has(row.id)) {
      rosterIds.add(row.id);
      state.roster.push(row.id);
    }
    rawActors.push({ id: row.id, kind: mob.kind, name: mob.name, type: mob.type, status: mob.status,
      x: mob.x, y: mob.y, hp: mob.hp, maxHp: mob.maxHp, effects: mob.effects });
  }

  const encoder = new Encoder(state);
  const offset = { offset: 0 };
  encoder.encodeAll(offset);
  const wire = encoder.sharedBuffer.slice(0, offset.offset);
  const decoded = new RaidState();
  new Decoder(decoded).decode(wire);
  return { state: decoded, bytes: wire.byteLength, rawActors };
}

function summarizeActor(m: MobView | { id: string; x: number; y: number; hpFrac: number; kind: string; name: string; status: string }): object {
  return { id: m.id, kind: m.kind, name: m.name, status: m.status, x: m.x, y: m.y, hpFrac: m.hpFrac };
}

function summarizeMemory(memory: ReturnType<typeof createMemory>, ids: readonly string[], now: number): object[] {
  return ids.map((id) => {
    const m = memory.view.mobs.get(id);
    return m ? {
      id: m.id, kind: m.kind, name: m.name ?? null, type: m.type ?? null,
      pos: { ...m.pos }, home: m.home ? { ...m.home } : null,
      alive: m.alive, hpFrac: m.hpFrac, seenAt: m.seenAt, dotAt: m.dotAt,
      returning: m.returning, awake: m.awake,
    } : { id, absentFromMemory: true };
  });
}

function canonicalizeIdentities(value: unknown, bijection: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return bijection.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => canonicalizeIdentities(item, bijection));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, canonicalizeIdentities(child, bijection)]));
  }
  return value;
}

function fogIdentityRelation(timeline: ReturnType<typeof runTimeline>): object[] {
  return timeline.ticks.map((tick) => ({
    humanWorldVisibility: tick.humanWorldVisibility,
    frame: tick.frame,
    delayedPercept: tick.delayedPercept,
    memory: tick.memory,
  }));
}

function newVision(map: ReturnType<typeof floorMap>, at: number): RaidVision {
  const vision = new RaidVision();
  vision.reset(map);
  vision.update(map, false, { x: 528, y: 528 }, true, true, false, SELF_ID, [], at);
  return vision;
}

function runTimeline(map: ReturnType<typeof floorMap>, rows: readonly {
  t: number; actors: readonly { id: string; x: number; y: number; hp: number; maxHp: number; effects?: number }[];
}[]) {
  const ring = new FrameRing();
  const memory = createMemory({ tier: TIERS.normal, map, selfId: SELF_ID, features: FEATURES });
  let lastMinimap = null;
  const ticks = [];
  let wireBytes = 0;
  const rosterHistory = new Set<string>();
  const memoryIds = new Set(["npc-runtime-A", "npc-runtime-B"]);
  for (const row of rows) for (const actor of row.actors) memoryIds.add(actor.id);

  for (const tick of rows) {
    for (const actor of tick.actors) rosterHistory.add(actor.id);
    const published = stateRoundTrip(tick.t, tick.actors, 0x4e504331, [...rosterHistory]);
    wireBytes += published.bytes;
    const vision = newVision(map, tick.t);
    const frame = perceive({ state: published.state }, {
      selfId: SELF_ID, map, features: FEATURES, lastMinimap, canSee: vision.canSee,
    });
    lastMinimap = frame.minimap;
    ring.push(frame);
    const percept = ring.compose({ selfDelayMs: 0, worldDelayMs: 0, map, features: FEATURES, attentionCentral: 0.5 });
    assert(percept, "zero-delay FrameRing should compose a pushed source frame");
    memory.observe(percept);

    const clientRows = [...published.state.mobs.entries()].map(([id, m]) => ({
      id, x: m.x, y: m.y, kind: m.kind, effects: m.effects,
      currentVision: vision.canSee({ x: m.x, y: m.y }),
      shouldRenderActorGate: shouldRenderActor(false, m.effects, { x: m.x, y: m.y }, vision.canSee),
      cameraPixels: "not evaluated; this source helper is the world-visibility gate, not a Phaser screenshot",
    }));
    ticks.push({
      t: tick.t,
      publication: {
        bytes: published.bytes,
        actorMapKeys: [...published.state.mobs.keys()],
        rosterIds: [...published.state.roster],
        decodedActors: published.rawActors,
      },
      humanWorldVisibility: clientRows,
      frame: {
        actorIds: frame.mobs.map((m) => m.id),
        minimapDots: frame.minimap.mobs.map((m) => ({ id: m.id, x: m.x, y: m.y })),
      },
      delayedPercept: {
        actorIds: percept.mobs.map((m) => m.id),
        minimapIds: percept.minimap.mobs.map((m) => m.id),
        viewT: percept.viewT,
      },
      memory: summarizeMemory(memory, [...memoryIds], tick.t),
    });
  }
  return { wireBytes, ticks };
}

function equalCueOrderProbe() {
  const cfg = { ...MOB_HUNT, maxCandidates: 8, firstReach: 1000, reach: 1000, skipRanged: false };
  const mob = (id: string) => [id, {
    kind: "mob", status: "alive", x: 628, y: 528, hp: 60, maxHp: 100,
    faction: "fire", weapon0: "sword", type: "emberImp",
  }] as const;
  const run = (entries: readonly (readonly [string, object])[]) => {
    const hunter = new MobHunter(cfg);
    const decision = hunter.decide({
      now: 1000, self: { faction: "fire", x: 528, y: 528, hp: 100, maxHp: 100, weapons: ["sword", null], power: 0, mobKills: 0 },
      playerDistance: Infinity, players: [], inColiseum: false, mobs: entries as never,
      walk: (p) => Math.hypot(p.x - 528, p.y - 528), attacking: false, shotByPlayerAt: -Infinity,
    });
    return { idOrder: entries.map(([id]) => id), decision, target: hunter.target };
  };
  return {
    provenance: "declared equal-score MobHunter input; this is a tie/order probe, not a simulated hunt",
    runs: [run([mob("npc-runtime-A"), mob("npc-runtime-B")]), run([mob("npc-runtime-B"), mob("npc-runtime-A")])],
  };
}

export async function captureNpcWitness(): Promise<object> {
  const map = floorMap();
  const sourceHashes = Object.fromEntries(SOURCE_FILES.map((path) => [path, sha256(readFileSync(repoPath(path)))]));
  const visibility = new RaidVision();
  visibility.reset(map);
  visibility.update(map, false, { x: 528, y: 528 }, true, true, false, SELF_ID, [], 0);

  // Same runtime identity: on-screen -> outside the delayed camera view but still inside the real vision radius
  // (therefore a minimap dot remains) -> HP rises while away (source memory's return heuristic) -> visible again.
  const sameEntity = runTimeline(map, [
    { t: 1000, actors: [{ id: "npc-runtime-A", x: 650, y: 528, hp: 60, maxHp: 100 }] },
    { t: 1050, actors: [{ id: "npc-runtime-A", x: 1370, y: 528, hp: 60, maxHp: 100 }] },
    { t: 1100, actors: [{ id: "npc-runtime-A", x: 1370, y: 528, hp: 100, maxHp: 100 }] },
    { t: 1150, actors: [{ id: "npc-runtime-A", x: 650, y: 528, hp: 100, maxHp: 100 }] },
  ]);

  // Identity replacement control: a new declared state key at the same coordinates/name is not inferred to be the old actor.
  // This is not a source Sim death/respawn or a claim that runtime ids may be reused.
  const replacement = runTimeline(map, [
    { t: 2000, actors: [{ id: "npc-runtime-A", x: 650, y: 528, hp: 60, maxHp: 100 }] },
    { t: 2150, actors: [{ id: "npc-runtime-B", x: 650, y: 528, hp: 60, maxHp: 100 }] },
  ]);

  // Memory's source return heuristic is a separate declared snapshot probe: an NPC is first seen at a home point,
  // observed away with a rising bar, then observed at home. No source Sim return path or earned heal is claimed.
  const returnHome = runTimeline(map, [
    { t: 3000, actors: [{ id: "npc-runtime-A", x: 650, y: 528, hp: 60, maxHp: 100 }] },
    { t: 3050, actors: [{ id: "npc-runtime-A", x: 750, y: 528, hp: 60, maxHp: 100 }] },
    { t: 3100, actors: [{ id: "npc-runtime-A", x: 750, y: 528, hp: 100, maxHp: 100 }] },
    { t: 3150, actors: [{ id: "npc-runtime-A", x: 650, y: 528, hp: 100, maxHp: 100 }] },
  ]);

  // The human's actual visibility helper is exercised with source-generated clear LOS and an actual wall-blocked line.
  const wallTiles = new Uint8Array(64 * 40).fill(FLOOR);
  for (let y = 1; y < 39; y++) wallTiles[y * 64 + 18] = TILE_WALL;
  const wallMap = mapFromTiles(64, 40, wallTiles);
  const wallVision = new RaidVision();
  wallVision.reset(wallMap);
  wallVision.update(wallMap, false, { x: 528, y: 528 }, true, true, false, SELF_ID, [], 3000);
  const blockedPoint = { x: 720, y: 528 };
  const wallLos = {
    sourceMap: { width: wallMap.w, height: wallMap.h, wallTile: { x: 18, yFrom: 1, yTo: 38 } },
    actor: { id: "npc-wall-probe", at: blockedPoint, effects: 0 },
    canSee: wallVision.canSee(blockedPoint),
    shouldRenderActorGate: shouldRenderActor(false, 0, blockedPoint, wallVision.canSee),
  };

  // Fog history uses actual RaidVision against the same opaque wall. The source Memory treats a dotted mob that
  // disappears from a refreshed minimap as dead; this witness records that behavior even when the same public ID later
  // becomes visible again. It is a declared snapshot sequence, not a death or respawn from Sim.
  const fogSameRows = [
    { t: 5000, actors: [{ id: "npc-fog-A", x: 550, y: 528, hp: 60, maxHp: 100 }] },
    { t: 5050, actors: [{ id: "npc-fog-A", x: 720, y: 528, hp: 60, maxHp: 100 }] },
    { t: 5100, actors: [{ id: "npc-fog-A", x: 720, y: 528, hp: 60, maxHp: 100 }] },
    { t: 5150, actors: [{ id: "npc-fog-A", x: 550, y: 528, hp: 60, maxHp: 100 }] },
    { t: 5200, actors: [{ id: "npc-fog-A", x: 550, y: 528, hp: 60, maxHp: 100 }] },
  ] as const;
  const fogSameEntity = runTimeline(wallMap, fogSameRows);
  const fogIdBijection = new Map([["npc-fog-A", "npc-new-A"]]);
  const fogRenamedRows = fogSameRows.map((tick) => ({
    t: tick.t,
    actors: tick.actors.map((actor) => ({ ...actor, id: fogIdBijection.get(actor.id) ?? actor.id })),
  }));
  const fogSameEntityRenamed = runTimeline(wallMap, fogRenamedRows);
  const fogIdentityRelationMatches = JSON.stringify(canonicalizeIdentities(
    fogIdentityRelation(fogSameEntityRenamed), new Map([...fogIdBijection].map(([before, after]) => [after, before])),
  )) === JSON.stringify(fogIdentityRelation(fogSameEntity));
  assert(fogIdentityRelationMatches, "wall history public identity relations should match under one fixed id bijection");

  // A second actor key replaces the still-occluded row before it returns to sight. The old id is not joined by
  // coordinates/name, and the new id starts with its own visible memory when it first crosses the real LOS boundary.
  const fogReplacement = runTimeline(wallMap, [
    { t: 6000, actors: [{ id: "npc-fog-A", x: 550, y: 528, hp: 60, maxHp: 100 }] },
    { t: 6050, actors: [{ id: "npc-fog-A", x: 720, y: 528, hp: 60, maxHp: 100 }] },
    { t: 6100, actors: [{ id: "npc-fog-B", x: 720, y: 528, hp: 60, maxHp: 100 }] },
    { t: 6150, actors: [{ id: "npc-fog-B", x: 550, y: 528, hp: 60, maxHp: 100 }] },
    { t: 6200, actors: [{ id: "npc-fog-B", x: 550, y: 528, hp: 60, maxHp: 100 }] },
  ]);

  const wallProjection = (actorId: string) => {
    const published = stateRoundTrip(3500, [{ id: actorId, x: blockedPoint.x, y: blockedPoint.y, hp: 60, maxHp: 100 }], 0x4e504331);
    const frame = perceive({ state: published.state }, {
      selfId: SELF_ID, map: wallMap, features: FEATURES, lastMinimap: null, canSee: wallVision.canSee,
    });
    return {
      schemaReceipt: { bytes: published.bytes, actorCount: published.state.mobs.size },
      humanShouldRenderActorGate: shouldRenderActor(false, 0, blockedPoint, wallVision.canSee),
      perceivedActorIds: frame.mobs.map((m) => m.id),
      minimapIds: frame.minimap.mobs.map((m) => m.id),
    };
  };

  // Alpha rename only the state/map key; same public row data. The public projection is expected to carry runtime actor
  // identity, while the memory lookup is keyed by that same public id (not matched by coordinate/name).
  const alphaA = stateRoundTrip(4000, [{ id: "npc-alpha-A", x: 650, y: 528, hp: 60, maxHp: 100 }], 0x4e504331);
  const alphaB = stateRoundTrip(4000, [{ id: "npc-alpha-B", x: 650, y: 528, hp: 60, maxHp: 100 }], 0x4e504331);
  const alphaProjection = (state: InstanceType<typeof RaidState>) => {
    const frame = perceive({ state }, { selfId: SELF_ID, map, features: FEATURES, lastMinimap: null, canSee: visibility.canSee });
    const m = frame.mobs[0];
    return m ? { id: m.id, kind: m.kind, name: m.name, x: m.x, y: m.y, hpFrac: m.hpFrac } : null;
  };

  return {
    format: "rh-bot-public-facts-npc/1",
    provenance: {
      repoHead: "a3d4b3ce575442c9a06916888035ca849a6cd05a",
      node: process.version, platform: process.platform, arch: process.arch,
      classification: "declared RaidState snapshots round-tripped by actual @colyseus/schema Encoder/Decoder and passed to actual source visibility/perception/FrameRing/Memory helpers; no earned Sim NPC death/return/respawn",
      sourceFiles: sourceHashes,
      sourceAnchors: {
        schema: "packages/shared/src/schema.ts:162-200 (MobState), :364-378 (mobs map and append-only roster)",
        humanVisibility: "packages/client/src/render/visibility.ts:8; RaidVision.canSee/canSeeActor in packages/client/src/render/RaidVision.ts:53-80",
        perception: "packages/server/src/bots/brain/perception.ts:578-639 (public NPC list and minimap), :622-637 (NPC row/dot filtering)",
        delayRing: "packages/server/src/bots/brain/frames.ts:124-218 (delayed public view), :175-188 (mob window)",
        memory: "packages/server/src/bots/brain/memory.ts:561-623 (minimap/visible NPC identity and HP memory), :625-642 (awake/returning inference)",
        equalCue: "packages/server/src/bots/mobHunt.ts:429-476 (distance sort; strict lower-score replacement preserves first equal-score candidate)",
        clientRenderBoundary: "packages/client/src/scenes/RaidScene.ts:639-660 applies actor visibility then calls MobView; no Phaser pixels are sampled by this witness",
      },
    },
    sourceMap: { width: map.w, height: map.h, construction: "mapFromTiles floor arena with source-generated border; no visibility callback stub" },
    sameEntity: {
      provenance: "declared schema timeline; returning/healing fields are observations of source Memory behavior, not earned sim outcomes",
      wireBytes: sameEntity.wireBytes,
      ticks: sameEntity.ticks,
    },
    memoryReturnHeuristic: {
      provenance: "declared schema timeline that exercises the actual memory return heuristic; not an earned simulation return/heal",
      wireBytes: returnHome.wireBytes,
      ticks: returnHome.ticks,
    },
    replacement: {
      provenance: "declared identity replacement control at equal name/location; not a death/respawn simulation",
      wireBytes: replacement.wireBytes,
      ticks: replacement.ticks,
    },
    wallLos,
    wallFogHistory: {
      sceneAdmission: "Unsupported for World/intended-behavior admission: declared snapshots execute real helpers, but actual Room publication/vision/minimap consistency and reachability of the living same-id fog return are not established. Neither a source bug nor intended death semantics is proved.",
      sameIdentity: {
        provenance: "declared same-id snapshots cross actual wall LOS; includes source Memory's minimap-disappearance dead marking and later visible row, without repairing or interpreting it as an earned death",
        wireBytes: fogSameEntity.wireBytes,
        ticks: fogSameEntity.ticks,
      },
      consistentAlphaRename: {
        provenance: "the full same-entity wall timeline is rerun with npc-fog-A consistently renamed to same-length npc-new-A in every declared snapshot and derived append-only roster; comparison canonicalizes that one fixed bijection over human visibility, Percept, and Memory identities/relationships only; no byte-equality claim",
        idBijection: { "npc-fog-A": "npc-new-A" },
        sourceIdentityRelationMatchesAfterCanonicalRename: fogIdentityRelationMatches,
        ticks: fogSameEntityRenamed.ticks,
      },
      hiddenReplacement: {
        provenance: "declared replacement id while behind actual wall; same row attributes, old id and new id remain distinct in actual source memory",
        wireBytes: fogReplacement.wireBytes,
        ticks: fogReplacement.ticks,
      },
    },
    occludedIdRename: {
      provenance: "declared two-state occlusion control behind an actual opaque wall; raw map key changes, actual human visibility and source Percept should not publish the actor",
      a: wallProjection("npc-occluded-A"),
      b: wallProjection("npc-occluded-B"),
    },
    alphaRename: {
      provenance: "declared map-key rename with all NPC row fields unchanged; actor IDs are included in actual public projection",
      a: { encodedBytes: alphaA.bytes, projection: alphaProjection(alphaA.state) },
      b: { encodedBytes: alphaB.bytes, projection: alphaProjection(alphaB.state) },
    },
    equalCueOrder: equalCueOrderProbe(),
  };
}

/** Actual source runner/Brain replay, with commands refused at a passive adapter boundary. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Session } from "node:inspector";
import { Decoder } from "@colyseus/schema";
import { type FxBatch, type GameMap } from "@raid/shared";
import { RaidState } from "@raid/shared/schema";
import { createBrain } from "../../packages/server/src/bots/brain/brain.ts";
import { createBotRunner } from "../../packages/server/src/bots/brain/runner.ts";
import { createFrameRing } from "../../packages/server/src/bots/brain/frames.ts";
import { detectFeatures } from "../../packages/server/src/bots/brain/perception.ts";
import { enabledModules } from "../../packages/server/src/bots/brain/modules/index.ts";
import { createPathBudget, createPathService } from "../../packages/server/src/bots/brain/services.ts";
import { NO_BIAS } from "../../packages/server/src/bots/learning/BotStatsStore.ts";
import { BOT_FRAME_EVERY_TICKS } from "../../packages/server/src/bots/BotManager.ts";
import {
  PERSONAS, TIERS, type Brain, type Frame, type FrameRingApi, type MemoryView,
  type Percept, type TimedCommand,
} from "../../packages/server/src/bots/brain/types.ts";

export interface RunnerSnapshot {
  bytes: Uint8Array;
  sourceTick: number;
  sourceTime: number;
  fxBatch: FxBatch | null;
  observerId?: string;
  targetId?: string;
}

export interface RunnerProfile {
  id: string;
  every: number;
  phase: number;
  selfDelayMs: number;
  worldDelayMs: number;
}

const BRAIN_SEED = 0x4e504352;
const copy = <T>(value: T): T => structuredClone(value);
const sha = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

// Preserve source ordering and all exceptional numbers/undefined in hashes; never normalize actor identities or lists.
function plain(value: any): any {
  if (value === undefined) return { $undefined: true };
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) && !Object.is(value, -0)
    ? value : { $number: Object.is(value, -0) ? "-0" : String(value) };
  if (Array.isArray(value)) return value.map(plain);
  if (value instanceof Map) return { $map: [...value].map(([key, child]) => [plain(key), plain(child)]) };
  if (value instanceof Set) return { $set: [...value].map(plain) };
  if (ArrayBuffer.isView(value)) return Array.from(value as any);
  assert.equal(typeof value, "object", "only actual data values can be hashed");
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plain(child)]));
}

const inputHash = (value: unknown): string => sha(JSON.stringify(plain(value)));

function cue(percept: Percept | null) {
  if (percept === null) return null;
  return copy({
    now: percept.now, viewT: percept.viewT,
    self: {
      id: percept.self.id, status: percept.self.status, x: percept.self.x, y: percept.self.y,
      hp: percept.self.hp, maxHp: percept.self.maxHp, faction: percept.self.faction,
      weapons: percept.self.weapons, attackTarget: percept.self.attackTarget,
    },
    hud: percept.hud, mobs: percept.mobs, minimap: percept.minimap,
  });
}

function filterDifference(before: Percept | null, after: Percept | null) {
  if (before === null || after === null) return null;
  const retainedMobs = new Set(after.mobs.map(row => row.id));
  const retainedDots = new Set(after.minimap.mobs.map(row => row.id));
  return {
    beforeMobs: before.mobs.length, afterMobs: after.mobs.length,
    beforeDots: before.minimap.mobs.length, afterDots: after.minimap.mobs.length,
    removedMobIds: before.mobs.filter(row => !retainedMobs.has(row.id)).map(row => row.id),
    removedDotIds: before.minimap.mobs.filter(row => !retainedDots.has(row.id)).map(row => row.id),
    beforeInputSha256: inputHash(before), afterInputSha256: inputHash(after),
  };
}

// This is a source scheduling-model constant, not a bound on source producers or a protocol admission.
const managerText = readFileSync(new URL("../../packages/server/src/bots/BotManager.ts", import.meta.url), "utf8");
const heldMatch = managerText.match(/const MAX_HELD_BATCHES\s*=\s*([0-9_]+)\s*;/);
assert(heldMatch, "actual BotManager held-FX limit must remain an explicit source literal");
const MAX_HELD_BATCHES = Number(heldMatch[1].replaceAll("_", ""));
let replayActive = false;
const HELPER_GLOBALS = ["__rhInspectFunction", "__rhInspectGetter"] as const;
const helperGlobalPresence = () => Object.fromEntries(HELPER_GLOBALS.map(key => [key, Reflect.has(globalThis, key)]));

function disconnectedSession(session: Session): boolean {
  // A disconnected real Session rejects post synchronously. No Memory or source state is queried by this cleanup check.
  try { session.post("Runtime.evaluate", { expression: "0" }, () => {}); }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ERR_INSPECTOR_NOT_CONNECTED"; }
  return false;
}

export async function runRunnerProfile({ map, viewerId, targetId, snapshots, profile, observeMemory = true }: {
  map: GameMap;
  viewerId: string;
  targetId: string;
  snapshots: readonly RunnerSnapshot[];
  profile: RunnerProfile;
  observeMemory?: boolean;
}) {
  assert(!replayActive, "profiles must replay sequentially because the unchanged inspector helper uses one global getter slot");
  assert(snapshots.length > 0, "actual earned Schema snapshots are required");
  assert(profile.every === 1 || profile.every === BOT_FRAME_EVERY_TICKS,
    "this finite model supports network every-patch or actual default manager cadence only");
  assert(Number.isInteger(profile.phase) && profile.phase >= 0 && profile.phase < profile.every);
  assert(profile.selfDelayMs >= 0 && profile.worldDelayMs >= 0);
  const globalsBefore = helperGlobalPresence();
  const globalValuesBefore = HELPER_GLOBALS.map(key => Reflect.get(globalThis, key));
  if (observeMemory) assert(Object.values(globalsBefore).every(present => !present), "ON must start without the inspection helper globals");
  replayActive = true;

  const tier = TIERS.normal, persona = PERSONAS.farmer;
  const pathBudget = createPathBudget();
  const paths = createPathService(map, pathBudget);
  const sourceLogs: string[] = [];
  const publicTrace: any[] = [];
  const privateMemoryRows: any[] = [];
  const inspectionTrace: any[] = [];
  const rows: any[] = [];
  const held: FxBatch[] = [];
  const managerModel = profile.every !== 1;
  let startedActive = false;
  let skipped = 0, heldDropped = 0, brainTicks = 0;
  let frame: Frame | null = null, prefilter: Percept | null = null, postfilter: Percept | null = null;
  let tickOutput: readonly TimedCommand[] | null = null;
  let adapterAttempts: any[] = [];
  let brain: Brain | null = null;
  let runner: ReturnType<typeof createBotRunner> | null = null;
  let memoryGetter: (() => MemoryView) | null = null;
  let inspection: Awaited<ReturnType<typeof import("../card-runtime-fixtures/private-inspection.mts")["inspectClosure"]>> | null = null;
  let inspectorOpen = false;
  let getterReads = 0;
  let actualSession: Session | null = null;
  const inspectionLifetime = {
    globalsBefore, actualSessionConnections: 0, helperCloseCompleted: false,
    sessionConnectMethodRestored: null as boolean | null,
    sessionClosed: null as boolean | null, globalsAfterClose: null as ReturnType<typeof helperGlobalPresence> | null,
    getterCapturedAtFirstTickEntry: false, firstGetterReadAfterWholeOriginalTick: false,
    readsAfterDebuggerDisconnect: 0, readsBeforeDebuggerDisconnect: 0,
    getterReleasedInFinally: false, helperReferenceReleasedInFinally: false, sessionReferenceReleasedInFinally: false,
    globalsAfterFinally: null as ReturnType<typeof helperGlobalPresence> | null,
    offGlobalPresenceUnchanged: null as boolean | null, offGlobalValuesUnchanged: null as boolean | null,
    replayActiveAfterFinally: null as boolean | null, forcedSessionDisconnectOnFailure: false,
  };

  async function closeInspection(sourceTick: number | null, sourceTime: number | null) {
    assert(inspection && inspectorOpen && actualSession, "actual helper Session must exist before close");
    await inspection.close();
    inspectionLifetime.helperCloseCompleted = true;
    inspectionLifetime.sessionClosed = disconnectedSession(actualSession);
    inspectionLifetime.globalsAfterClose = helperGlobalPresence();
    assert(inspectionLifetime.sessionClosed, "actual helper Session must reject post after close");
    assert(Object.values(inspectionLifetime.globalsAfterClose).every(present => !present), "helper globals must be absent after helper close");
    inspectorOpen = false;
    inspectionTrace.push({
      event: "helper-closed-and-actual-session-disconnection-checked", sourceTick, sourceTime,
      postAfterCloseRejectedAsNotConnected: inspectionLifetime.sessionClosed,
      helperGlobals: inspectionLifetime.globalsAfterClose,
    });
    inspection = null;
  }

  try {
    for (let patchIndex = 0; patchIndex < snapshots.length; patchIndex++) {
      const snapshot = snapshots[patchIndex];
      const decoded = new RaidState();
      new Decoder(decoded).decode(snapshot.bytes);
      assert.equal(decoded.serverTime, snapshot.sourceTime, "actual decoded time must match the immutable source snapshot metadata");
      const viewer = decoded.players.get(viewerId);
      assert(viewer, "the earned snapshot must contain the same viewer");
      if (snapshot.observerId !== undefined) assert.equal(snapshot.observerId, viewerId);
      if (snapshot.targetId !== undefined) assert.equal(snapshot.targetId, targetId);

      const planning = decoded.phase === "planning";
      const eligible = !managerModel || ((decoded.phase === "active" || planning) && viewer.status === (planning ? "lobby" : "alive"));
      if (!eligible) { skipped++; continue; }
      let selected: boolean;
      if (managerModel && !planning && !startedActive) {
        selected = true;
        startedActive = true;
      } else selected = (patchIndex + profile.phase) % profile.every === 0;
      if (!selected) {
        if (snapshot.fxBatch) {
          if (held.length < MAX_HELD_BATCHES) held.push(snapshot.fxBatch);
          else heldDropped++;
        }
        skipped++;
        continue;
      }

      if (runner === null) {
        const features = detectFeatures({ state: decoded, player: viewer, map });
        brain = createBrain({
          id: viewerId, name: `NPC runner callsite ${profile.id}`, tier, persona, seed: BRAIN_SEED,
          map, features, learned: NO_BIAS,
          services: { paths, log: message => sourceLogs.push(message) }, modules: enabledModules(features),
        });
        const originalTick = brain.tick;
        if (observeMemory) {
          const { inspectClosure } = await import("../card-runtime-fixtures/private-inspection.mts");
          const originalConnect = Session.prototype.connect;
          Session.prototype.connect = function (this: Session) {
            const returned = originalConnect.call(this);
            actualSession = this;
            inspectorOpen = true;
            inspectionLifetime.actualSessionConnections++;
            return returned;
          };
          try { inspection = await inspectClosure(originalTick, "memory", "()=>memory.view"); }
          finally {
            Session.prototype.connect = originalConnect;
            inspectionLifetime.sessionConnectMethodRestored = Session.prototype.connect === originalConnect;
            assert(inspectionLifetime.sessionConnectMethodRestored, "Session connect forwarder must be restored immediately after setup");
          }
          assert.equal(inspectionLifetime.actualSessionConnections, 1, "ON must retain exactly the helper's actual Session");
          assert(actualSession, "actual helper Session connect must have been observed");
          inspectorOpen = true;
          inspectionTrace.push({
            event: "breakpoint-installed-before-first-original-tick", sourceTick: snapshot.sourceTick, sourceTime: snapshot.sourceTime,
            helperGlobals: helperGlobalPresence(), actualSessionConnections: inspectionLifetime.actualSessionConnections,
          });
        }
        // The same recording wrapper is installed in both observer variants. It returns the original result unchanged.
        brain.tick = (percept: Percept) => {
          postfilter = copy(percept);
          const output = originalTick.call(brain, percept);
          tickOutput = copy(output);
          brainTicks++;
          return output;
        };
        const realRing = createFrameRing();
        const ring: FrameRingApi = {
          push(actualFrame) { frame = copy(actualFrame); realRing.push(actualFrame); },
          compose(config) {
            const composed = realRing.compose(config);
            prefilter = copy(composed);
            return composed;
          },
        };
        runner = createBotRunner({
          brain, vision: true, map, features, tier, ring,
          cfg: { selfDelayMs: profile.selfDelayMs, worldDelayMs: profile.worldDelayMs },
          adapter: {
            selfId: viewerId,
            supports: type => features.messageTypes.includes(type),
            send(command, at) { adapterAttempts.push(copy({ command, at, returned: false })); return false; },
          },
        });
      }

      frame = null; prefilter = null; postfilter = null; tickOutput = null; adapterAttempts = [];
      const fxs = held.splice(0);
      if (snapshot.fxBatch) fxs.push(snapshot.fxBatch);
      pathBudget.startTick();
      const sent = runner.frame({ state: decoded, ...(fxs.length > 0 ? { fxs } : {}) });
      if (observeMemory && tickOutput !== null && memoryGetter === null) {
        assert(inspection && inspectorOpen, "the first actual tick must have the read-only inspection prepared");
        memoryGetter = inspection.capture() as () => MemoryView;
        inspectionLifetime.getterCapturedAtFirstTickEntry = typeof memoryGetter === "function";
        inspectionTrace.push({
          event: "entry-installed-getter-retrieved-after-whole-first-original-tick", sourceTick: snapshot.sourceTick, sourceTime: snapshot.sourceTime,
          getterIsFunction: typeof memoryGetter === "function", helperGlobals: helperGlobalPresence(),
        });
        await closeInspection(snapshot.sourceTick, snapshot.sourceTime);
      }
      let privateRow: any = null;
      if (observeMemory && tickOutput !== null) {
        const disconnected = !inspectorOpen && inspectionLifetime.sessionClosed === true
          && Object.values(helperGlobalPresence()).every(present => !present);
        if (!disconnected) inspectionLifetime.readsBeforeDebuggerDisconnect++;
        assert(memoryGetter && disconnected, "ordinary actual Memory reads happen only through the captured getter after measured disconnect");
        const memory = memoryGetter();
        getterReads++;
        inspectionLifetime.readsAfterDebuggerDisconnect++;
        if (getterReads === 1) inspectionLifetime.firstGetterReadAfterWholeOriginalTick = tickOutput !== null;
        privateRow = copy({
          sourceTick: snapshot.sourceTick, sourceTime: snapshot.sourceTime, getterRead: getterReads,
          sessionDisconnectedAtRead: disconnected, helperGlobalsAtRead: helperGlobalPresence(),
          target: memory.mobs.get(targetId) ?? null,
          mobs: [...memory.mobs.values()], camps: [...memory.camps.values()],
        });
        privateMemoryRows.push(privateRow);
      }

      const trace = copy({
        patchIndex, sourceTick: snapshot.sourceTick, sourceTime: snapshot.sourceTime,
        schemaSha256: sha(snapshot.bytes),
        frame, prefilterPercept: prefilter, postfilterPercept: postfilter,
        originalTickOutput: tickOutput, adapterAttempts, sentResults: sent,
        sourceBrainLogs: sourceLogs.splice(0), sourceBrainGoal: brain!.goal, sourceBrainStats: brain!.stats,
      });
      publicTrace.push(trace);
      rows.push({
        patchIndex, sourceTick: snapshot.sourceTick, sourceTime: snapshot.sourceTime,
        brainTicked: tickOutput !== null,
        prefilter: cue(prefilter), postfilter: cue(postfilter),
        fullPrefilterInputSha256: prefilter === null ? null : inputHash(prefilter),
        fullPostfilterInputSha256: postfilter === null ? null : inputHash(postfilter),
        filterDifference: filterDifference(prefilter, postfilter),
        privateMemoryRow: privateRow === null ? null : privateMemoryRows.length - 1,
      });
    }
    if (observeMemory) assert(memoryGetter && !inspectorOpen, "at least one actual Brain tick must have supplied and detached the actual Memory getter");
    const firstAlive = privateMemoryRows.find(row => row.target?.alive === true) ?? null;
    const firstFalse = privateMemoryRows.find(row => row.target?.alive === false) ?? null;
    const resight = firstFalse === null ? null : rows.find(row => row.sourceTime > firstFalse.sourceTime
      && row.postfilter?.mobs.some((mob: any) => mob.id === targetId && mob.status === "alive")) ?? null;
    const resightMemory = resight?.privateMemoryRow === null || resight === null
      ? null : privateMemoryRows[resight.privateMemoryRow] ?? null;
    return {
      provenance: {
        actualFactories: ["createBrain(normal, farmer, enabledModules, NO_BIAS)", "createBotRunner(vision:true)", "createFrameRing", "createPathService"],
        brainSeed: BRAIN_SEED, brainRng: "actual source derive tags0/1/2 and separate Knowledge3; no stream substituted or inspected",
        profile: copy(profile),
        cadence: managerModel
          ? "default-manager cadence MODEL: first eligible active frame regardless phase, then original patchIndex+phase modulo; no multi-seat startup contention, actual BotManager lifecycle or socket execution"
          : "network every-patch MODEL over the immutable source snapshots; no actual socket or network timing execution",
        heldFxCap: { source: "BotManager.MAX_HELD_BATCHES", value: MAX_HELD_BATCHES, classification: "modeled undelivered FX retention, not a producer bound" },
        publication: "fresh actual Schema Decoder per snapshot; selected states alone enter actual runner; each selected call receives actual batches held in original order",
        recording: "identical passive original-tick/ring/log/adapter wrappers in observer OFF and ON; original returns and composed objects are forwarded unchanged",
        observeMemory,
        memoryObservation: observeMemory
          ? "unchanged helper installs ()=>memory.view at first original tick ENTRY; its getter reference is retrieved only after the whole original tick returns, debugger/session disconnection is measured, then pure reads occur after completed ticks; this is not an immediate-post-memory.observe snapshot"
          : "no inspector session and no Memory getter reads",
        sessionObservation: "ON temporarily forwards Session.prototype.connect unchanged to retain only the helper's actual Session, restores it immediately, then checks real post rejection after helper.close; no Session is created in OFF",
        inputHash: "SHA256 of ordered explicit-data JSON; preserves undefined, signed zero/nonfinite numbers and collection order; no ID renaming or sorting",
        scope: "open-loop actual source caller witness; adapter records/refuses every command and applies nothing to World; no validated action, full match policy, survival, live-driver lifecycle or humanizer acceptance claim",
      },
      rows, publicTrace, privateMemoryRows, inspectionTrace, inspectionLifetime,
      summary: {
        snapshotCount: snapshots.length, selectedCalls: rows.length, skippedSnapshots: skipped,
        actualBrainTicks: brainTicks, getterReads, heldFxDropped: heldDropped,
        firstAlive: firstAlive === null ? null : { sourceTick: firstAlive.sourceTick, sourceTime: firstAlive.sourceTime, target: firstAlive.target },
        firstFalse: firstFalse === null ? null : { sourceTick: firstFalse.sourceTick, sourceTime: firstFalse.sourceTime, target: firstFalse.target },
        actualPostfilterResightAfterFalse: resight === null ? null : {
          sourceTick: resight.sourceTick, sourceTime: resight.sourceTime,
          target: resightMemory?.target ?? null, filterDifference: resight.filterDifference,
        },
        observedFalseMemoryOnActualPostfilterLivingResight: resight === null ? null : resightMemory?.target?.alive === false,
        boundary: "derived source-call observations only; no expected belief or conclusion is installed into the Brain or World",
      },
    };
  } finally {
    try { if (inspection && inspectorOpen) await closeInspection(null, null); }
    finally {
      try {
        if (actualSession && inspectorOpen) {
          // Preserve a failed observation as a failure while ensuring its own Session cannot leak into the next attempt.
          actualSession.disconnect();
          inspectionLifetime.forcedSessionDisconnectOnFailure = true;
          inspectorOpen = false;
        }
        const hadGetter = memoryGetter !== null;
        memoryGetter = null;
        inspection = null;
        actualSession = null;
        inspectionLifetime.getterReleasedInFinally = memoryGetter === null;
        inspectionLifetime.helperReferenceReleasedInFinally = inspection === null;
        inspectionLifetime.sessionReferenceReleasedInFinally = actualSession === null;
        inspectionLifetime.globalsAfterFinally = helperGlobalPresence();
        if (observeMemory) {
          assert(Object.values(inspectionLifetime.globalsAfterFinally).every(present => !present), "ON helper globals must remain absent at final release");
          assert.equal(inspectionLifetime.readsBeforeDebuggerDisconnect, 0);
        } else {
          inspectionLifetime.offGlobalPresenceUnchanged = JSON.stringify(inspectionLifetime.globalsAfterFinally) === JSON.stringify(globalsBefore);
          inspectionLifetime.offGlobalValuesUnchanged = HELPER_GLOBALS.every((key, index) => Reflect.get(globalThis, key) === globalValuesBefore[index]);
          assert(inspectionLifetime.offGlobalPresenceUnchanged && inspectionLifetime.offGlobalValuesUnchanged, "OFF must leave helper global presence and values unchanged");
          assert.equal(inspectionLifetime.actualSessionConnections, 0);
          assert.equal(getterReads, 0);
          assert.equal(privateMemoryRows.length, 0);
        }
        inspectionTrace.push({
          event: "getter-helper-and-session-references-released-in-finally", hadGetter,
          getterIsNull: memoryGetter === null, helperIsNull: inspection === null, sessionIsNull: actualSession === null,
          helperGlobals: inspectionLifetime.globalsAfterFinally,
        });
      } finally {
        replayActive = false;
        inspectionLifetime.replayActiveAfterFinally = replayActive;
        inspectionTrace.push({ event: "replay-active-reset", replayActive });
        assert.equal(replayActive, false);
      }
    }
  }
}

// A headless game client for measuring the netcode: it joins a real server like the browser does and runs the CLIENT'S OWN net
// code (EntityInterpolator + ServerClock/SnapshotBuffer, LocalPrediction/LocalMotion) at a fixed frame rate, sending orders
// like a player (move with seq, right-hold repeats, stop, target locks on nearby mobs and bots, a streamed aim).
//   npx tsx packages/server/bench/netProbe.ts --url http://localhost:2567 [--seconds 60] [--seed 1] [--hz 144] [--label text] [--json file]
// It needs other fighters to be worth anything: run it against a server with mobs on and a few `npm run bots` (netProbeMatrix.ts
// starts both for each network profile). Only the time the probe is alive in a running raid is measured; when it dies it queues
// into the next run and carries on until it has `--seconds` of that.
//
// What it records (see ProbeReport):
//   patches      inter-arrival of the state patches (p50/p95/p99/max), and their lateness against the server's own tick spacing
//   clock        how far render time advances per frame against real time (1.0 is perfect), per frame and over 1 s windows, the
//                frames it ran backwards, and the delay actually drawn behind the estimated server clock
//   starvation   frames where render time is past the newest sample while a remote fighter moves (the buffer holds, the fighter
//                freezes and then jumps), as a share of such frames, the longest hold, and entity-frames where a fighter that was
//                moving drew no step; the biggest one-frame step of a remote fighter
//   prediction   snaps (by who made them), divergence drops, the smoothing offset (p50/p95/max), the distance from the drawn local
//                fighter to the server's own path where the prediction aims it (S(c + delay)), and how far it leads the newest sample
//   orders       wall-clock delay from sending a move to the first patch that shows its seq, the prediction's own delay estimate,
//                and what became of each lock click (shown by the server, or refused)
import { performance } from "node:perf_hooks";
import fs from "node:fs";
import { Client, type Room } from "@colyseus/sdk";
import {
  abilityInSlot, blinkLanding, findPath, generateMap, mulberry32, PLAYER_RADIUS, rankOf, ROOM_NAME, slotReadyAt, TARGET_RANGE,
  TELEPORT_DISTANCE, TRAINING_ROOM_NAME, unpackFx, withGates, WORLD_H, WORLD_W,
  type FxBatch, type GameMap, type ProfileResponse, type Vec2,
} from "@raid/shared";
import type { PlayerState, RaidState } from "@raid/shared/schema";
import type { RenderClockOptions } from "@raid/shared";
import { EntityInterpolator } from "../../client/src/net/interpolation";
import { JUMP_ORDER_EXPIRE_MS, ORDER_EXPIRE_MS, seqAcked, type LocalMotion } from "../../client/src/net/localMotion";
import { castUnanswered, LocalPrediction, type SentCast } from "../../client/src/net/localPrediction";

export interface ProbeOptions {
  url: string;
  /** Seconds to measure: alive in a running raid with a remote fighter moving. */
  seconds: number;
  seed?: number;
  /** Frame rate of the loop (the browser's frame, 144 Hz by default). */
  hz?: number;
  label?: string;
  verbose?: boolean;
  /** Called every frame with the interpolator, for experiments that read more than the report does. */
  onFrame?: (now: number, interp: EntityInterpolator) => void;
  /** The faction to ask for. */
  faction?: string;
  /** Draw with the pre-adaptive interpolator: a fixed 100 ms behind a clock that snaps on late patches. */
  legacy?: boolean;
  /** Overrides of the adaptive delay's numbers. */
  render?: Partial<RenderClockOptions>;
  /** Keep every patch's (arrival, server time), for netTraceEval.ts. */
  trace?: boolean;
  /** Cast the faction's Wish when it is ready (a blink for Fire: ask for `faction: "fire"`), and report what the prediction did around the casts. */
  wish?: boolean;
  /** A training room instead of an arena run: nothing moves but the probe, a Wish is ready every 5 s, and `seconds` counts the time alive. */
  training?: boolean;
}

export interface Dist { n: number; p50: number; p95: number; p99: number; max: number; min: number; mean: number }

export interface ProbeReport {
  /** With ProbeOptions.trace: per session, [arrival, server time] of every patch. */
  traces?: number[][][];
  label: string;
  url: string;
  hz: number;
  activeSeconds: number;
  /** Seconds alive in a running raid with a remote fighter moving: the sample the numbers below come from. */
  contestedSeconds: number;
  frames: number;
  sessions: number;
  deaths: number;
  patchGapMs: Dist;
  /** (arrival gap − server time gap) per patch: how irregular delivery is, whatever the server's own timer does. */
  patchLateMs: Dist;
  serverStepGapMs: Dist;
  pingMs: Dist;
  clock: {
    ratio: Dist;
    ratioWindow1s: Dist;
    backwardsFrames: number;
    fastFrames: number;
    slowFrames: number;
    /** Estimated server time now minus the time drawn: what INTERP_DELAY_MS is. */
    delayMs: Dist;
    syncSnaps: number;
  };
  starvation: {
    movingFrames: number;
    starvedFrames: number;
    starvedPct: number;
    longestHoldMs: number;
    holdsOver50ms: number;
    holdsOver100ms: number;
    maxRemoteStep: number;
    remoteStepsOver3: number;
    remoteStepsOver8: number;
    /** Share of the frames with a mover in which some remote fighter was drawn stepping more than 3 u (nominal 1.2 u at 144 Hz). */
    remoteHitchPct: number;
  };
  prediction: {
    snaps: Record<string, number>;
    snapsTotal: number;
    divergenceDrops: number;
    visualOffset: Dist;
    /** |drawn(c) − S(c + delay)|: how close the drawn fighter is to where the server's own path puts it at the aimed time. */
    errAtDelay: Dist;
    /** How far the drawn fighter leads the newest server sample carried to now (by design about speed x delay while walking). */
    lead: Dist;
    delayEstimate: Dist;
    walkingFrames: number;
  };
  wish: {
    casts: number;
    accepted: number;
    refused: number;
    unanswered: number;
    /** Wall-clock ms from sending a blink to the first patch that acks its order number. */
    ackWallMs: Dist;
    /** Distance (u) between the landing the client predicted and the server's position at the acking patch (one tick of walking included). */
    landingErr: Dist;
    /** Per cast, over the 2 s from sending it: the largest smoothing offset, and (from 150 ms after the ack on) the largest and 95th-percentile distance from the server's path (as errAtDelay). */
    visualMaxPerCast: Dist;
    errMaxPerCast: Dist;
    errP95PerCast: Dist;
    snapsInWindows: number;
    snapsByWho: Record<string, number>;
    /** Casts after which the drawn fighter made a second big step (more than 25 u) in the 2 s, beside the blink's own: a pop back. */
    popBacks: number;
    divergenceDropsInWindows: number;
  };
  orders: {
    moves: number;
    acked: number;
    ackWallMs: Dist;
    locks: number;
    locksShown: number;
    locksRefused: number;
    lockShownMs: Dist;
    /** Frames the prediction was in follow with no lock on the server (a hoped-for lock that has not shown, or one already gone). */
    followWithoutLockFrames: number;
    followWithoutLockMs: Dist;
  };
}

// ------------------------------------------------------------------------------------------------------------------ stats

function dist(values: number[]): Dist {
  if (values.length === 0) return { n: 0, p50: NaN, p95: NaN, p99: NaN, max: NaN, min: NaN, mean: NaN };
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
  let sum = 0;
  for (const v of s) sum += v;
  return { n: s.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: s[s.length - 1]!, min: s[0]!, mean: sum / s.length };
}

/** A session in which nothing but the probe has moved for this long is a stuck run (a bot swinging at a mob it cannot hurt): leave it. */
const STALL_MS = 40_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ------------------------------------------------------------------------------------------------------------------ the client

interface Trace { t: number; x: number; y: number }

/** Everything one probe accumulates across sessions. */
class Metrics {
  frames = 0;
  activeMs = 0;
  /** Time with at least one remote fighter moving: what `seconds` counts. */
  contestedMs = 0;
  sessions = 0;
  deaths = 0;
  patchGaps: number[] = [];
  patchLate: number[] = [];
  serverGaps: number[] = [];
  pings: number[] = [];
  ratios: number[] = [];
  ratioWindows: number[] = [];
  backwards = 0;
  fast = 0;
  slow = 0;
  delays: number[] = [];
  syncSnaps = 0;
  movingFrames = 0;
  starvedFrames = 0;
  holds: number[] = [];
  maxRemoteStep = 0;
  remoteStepsOver3 = 0;
  remoteStepsOver8 = 0;
  remoteHitchFrames = 0;
  snaps: Record<string, number> = {};
  divergenceDrops = 0;
  visual: number[] = [];
  err: number[] = [];
  lead: number[] = [];
  delayEst: number[] = [];
  walkingFrames = 0;
  moves = 0;
  ackWall: number[] = [];
  locks = 0;
  locksShown = 0;
  locksRefused = 0;
  lockShown: number[] = [];
  followWithoutLockFrames = 0;
  followWithoutLockRuns: number[] = [];
  frameGaps: number[] = [];
  /** Per session: [arrival ms, server time ms] of every patch. */
  traces: number[][][] = [];
  castsSent = 0;
  castsAccepted = 0;
  castsRefused = 0;
  castsUnanswered = 0;
  castAckWall: number[] = [];
  castLandingErr: number[] = [];
  castVisualMax: number[] = [];
  castErrMax: number[] = [];
  castErrP95: number[] = [];
  castSnaps = 0;
  castSnapsByWho: Record<string, number> = {};
  castPopBacks = 0;
  castDivDrops = 0;
}

interface CastRec { seq: number; sentAt: number; c: number; landing: Vec2; displace0: number; acked: boolean; accepted: boolean; ackedAt: number }

/** One run in one room: the scene's net half, driven by a script instead of a mouse. */
class Session {
  readonly interp: EntityInterpolator;
  readonly predict = new LocalPrediction();
  private readonly sid: string;
  private map: GameMap;
  private readonly rnd: () => number;
  private others: Array<{ x: number; y: number; faction: string; status: string }> = [];
  private lastFrameAt = 0;
  private lastPatchAt = 0;
  private lastPatchServerT = 0;
  private prevRender = NaN;
  private prevNow = NaN;
  private windowStart = NaN;
  private windowStartRender = NaN;
  private sendAt = new Map<number, number>();
  private lastSeqSeen = 0;
  /** Per remote id: the last two patch positions (is it moving?) and where it was drawn last frame. */
  private readonly track = new Map<string, { px: number; py: number; qx: number; qy: number; drawn: Vec2 | null; n: number }>();
  private readonly tmp = { x: 0, y: 0 };
  private starveRun = 0;
  private starveRunStart = 0;
  private followRunStart = 0;
  private lockOn = false;
  private pendingCast: SentCast | null = null;
  private lastCastTry = 0;
  private casts: CastRec[] = [];
  private snapLog: Array<{ at: number; who: string }> = [];
  private divLog: number[] = [];
  private pendingLocks: Array<{ id: string; sentAt: number; shown: boolean; done: boolean }> = [];
  // The script.
  private nextActionAt = 0;
  private holdUntil = 0;
  private holdNextAt = 0;
  private holdAngle = 0;
  private holdCentre: Vec2 = { x: 0, y: 0 };
  private lockUntil = 0;
  private lastAimAt = 0;
  private aimAngle = 0;
  private aimOn = true;
  private patchTrace: Trace[] = [];
  readonly arrivals: number[][] = [];
  private frameLog: Array<{ now: number; c: number; x: number; y: number; delay: number; visual: number }> = [];
  private dead = false;
  private resultIn = false;
  /** The frame being run counts (alive in a running raid). */
  private measuring = false;
  private readonly onFrame: ProbeOptions["onFrame"];
  private quietUntil = 0;
  private activeSince = 0;
  private lastMover = 0;
  private stalled = false;
  /** Server time the clock was last seen to snap (detected from a drop of its offset). */
  private lastOffset: number | null = null;

  constructor(private readonly room: Room<any, RaidState>, private readonly m: Metrics, seed: number, private readonly opts: ProbeOptions) {
    this.onFrame = opts.onFrame;
    this.interp = new EntityInterpolator({ adaptive: opts.legacy ? false : true, render: opts.render });
    this.sid = room.sessionId;
    this.rnd = mulberry32(seed);
    this.map = generateMap(room.state.seed);
    this.instrument(this.predict.motion);
    room.onStateChange((state) => this.onPatch(state, performance.now()));
    room.onMessage("fxs", (b: FxBatch) => this.onFx(b));
    room.onMessage("result", () => { this.resultIn = true; });
    room.onMessage("toast", () => {});
    room.onLeave(() => { this.dead = true; });
    this.onPatch(room.state, performance.now());
  }

  /** The raid is over for us, or nothing but the probe has moved for STALL_MS (a stuck run: it is left and the next one joined). */
  get over(): boolean { return this.dead || this.resultIn || this.stalled; }

  private instrument(motion: LocalMotion): void {
    const raw = motion as unknown as Record<string, (...a: unknown[]) => unknown>;
    const snap = raw.snapTo!.bind(motion);
    raw.snapTo = (...args: unknown[]) => {
      if (!this.measuring) return snap(...args);
      const stack = new Error().stack ?? "";
      const who = /at (?:LocalMotion\.)?(rebase|observe|frame|noteDivergence)\b/.exec(stack.split("\n").slice(2).join("\n"))?.[1] ?? "other";
      this.m.snaps[who] = (this.m.snaps[who] ?? 0) + 1;
      this.snapLog.push({ at: performance.now(), who });
      return snap(...args);
    };
    const div = raw.noteDivergence!.bind(motion);
    raw.noteDivergence = (err: unknown) => {
      if (!this.measuring) return div(err);
      const before = (raw as unknown as { path: unknown[] }).path.length;
      const r = div(err);
      if (before > 0 && (raw as unknown as { path: unknown[] }).path.length === 0) { this.m.divergenceDrops++; this.divLog.push(performance.now()); }
      return r;
    };
  }

  private active(state: RaidState): boolean {
    return state.phase === "active" && state.players.get(this.sid)?.status === "alive";
  }

  private onPatch(state: RaidState, now: number): void {
    if (!state.players) return;
    const t = state.serverTime;
    if (this.lastPatchAt > 0 && state.phase === "active") {
      const gap = now - this.lastPatchAt;
      this.m.patchGaps.push(gap);
      this.m.patchLate.push(gap - (t - this.lastPatchServerT));
      this.m.serverGaps.push(t - this.lastPatchServerT);
    }
    this.lastPatchAt = now;
    this.lastPatchServerT = t;
    this.arrivals.push([Math.round(now * 100) / 100, t]);
    this.interp.onPatch(state, now);
    state.players.forEach((p, id) => { if (id !== this.sid) this.noteRemote(id, p); });
    state.mobs.forEach((p, id) => this.noteRemote(id, p));
    for (const id of this.track.keys()) if (!state.players.has(id) && !state.mobs.has(id)) this.track.delete(id);
    const me = state.players.get(this.sid);
    if (me) {
      this.predict.observe(
        { x: me.x, y: me.y, t, moveSeq: me.moveSeq, locked: me.attackTarget !== "", displaceSeq: me.displaceSeq },
        this.interp.clock.synced ? this.interp.clock.now(now) : t,
      );
      this.patchTrace.push({ t, x: me.x, y: me.y });
      for (const k of this.casts) {
        if (k.acked || !seqAcked(k.seq, me.moveSeq)) continue;
        k.acked = true;
        k.ackedAt = now;
        k.accepted = me.displaceSeq !== k.displace0;
        this.m.castAckWall.push(now - k.sentAt);
        if (k.accepted) {
          this.m.castsAccepted++;
          this.m.castLandingErr.push(Math.hypot(me.x - k.landing.x, me.y - k.landing.y));
        } else this.m.castsRefused++;
      }
      if (me.moveSeq !== 0 && me.moveSeq !== this.lastSeqSeen) {
        // Every sent seq up to this one counts as applied.
        const sent = this.sendAt.get(me.moveSeq);
        if (sent !== undefined && this.active(state)) { this.m.ackWall.push(now - sent); this.sendAt.delete(me.moveSeq); }
        this.lastSeqSeen = me.moveSeq;
      }
      this.noteLock(me, now);
      if (me.status === "dead") this.dead = true;
    }
  }

  private noteRemote(id: string, p: { x: number; y: number; status: string }): void {
    let e = this.track.get(id);
    if (!e) { e = { px: p.x, py: p.y, qx: p.x, qy: p.y, drawn: null, n: 0 }; this.track.set(id, e); }
    e.qx = e.px;
    e.qy = e.py;
    e.px = p.x;
    e.py = p.y;
    e.n++;
  }

  private noteLock(me: PlayerState, now: number): void {
    for (const l of this.pendingLocks) {
      if (l.done) continue;
      if (me.attackTarget === l.id) {
        l.done = true;
        this.m.locksShown++;
        this.m.lockShown.push(now - l.sentAt);
      } else if (now - l.sentAt > ORDER_EXPIRE_MS + 300) {
        l.done = true;
        this.m.locksRefused++;
      }
    }
    this.pendingLocks = this.pendingLocks.filter((l) => !l.done);
  }

  private onFx(batch: FxBatch): void {
    const me = this.room.state.players.get(this.sid);
    for (const fx of unpackFx(batch, this.room.state.roster)) {
      this.predict.noteFx(fx, this.sid, me);
      if (fx.kind === "teleport") { this.interp.markCut(fx.t); this.quietUntil = performance.now() + 3000; }
    }
  }

  // ---------------------------------------------------------------------------------------------------------- one frame

  frame(now: number, frameGap: number): void {
    const state = this.room.state;
    const me = state.players.get(this.sid);
    if (!me) return;
    const active = this.active(state);
    // A teleport (the patience timer's) is a cut for everyone: the seconds around it say nothing about the network.
    const measure = active && now >= this.quietUntil;
    this.measuring = measure;
    if (active && this.activeSince === 0) this.activeSince = now;
    if (active && !this.opts.training && now - Math.max(this.lastMover, this.activeSince) > STALL_MS) this.stalled = true;
    const trueT = this.interp.renderTime(now);
    const synced = this.interp.clock.synced;
    const c = synced ? this.interp.clock.now(now) : state.serverTime;
    // Clock quality: render time against real time, whether anything moves or not.
    const offset = synced ? c - now : 0;
    if (this.lastOffset !== null && offset < this.lastOffset - 5) this.m.syncSnaps++;
    this.lastOffset = offset;
    if (measure) {
      this.m.frames++;
      this.m.activeMs += frameGap;
      this.m.frameGaps.push(frameGap);
      if (Number.isFinite(this.prevRender)) {
        const dReal = now - this.prevNow;
        const dRender = trueT - this.prevRender;
        if (dReal > 0) {
          const ratio = dRender / dReal;
          this.m.ratios.push(ratio);
          if (dRender < 0) this.m.backwards++;
          else if (ratio > 1.05) this.m.fast++;
          else if (ratio < 0.95) this.m.slow++;
        }
      }
      if (!Number.isFinite(this.windowStart)) { this.windowStart = now; this.windowStartRender = trueT; }
      else if (now - this.windowStart >= 1000) {
        this.m.ratioWindows.push((trueT - this.windowStartRender) / (now - this.windowStart));
        this.windowStart = now;
        this.windowStartRender = trueT;
      }
      this.m.delays.push(c - trueT);
    } else {
      this.windowStart = NaN;
    }
    this.prevRender = trueT;
    this.prevNow = now;
    this.onFrame?.(now, this.interp);

    // Orders, then the prediction, as the scene does it.
    if (active) this.script(now, c, me, state);
    const dt = this.lastFrameAt > 0 ? now - this.lastFrameAt : 0;
    this.lastFrameAt = now;
    const others = this.others;
    others.length = 0;
    if (me.sig !== 0) {
      state.players.forEach((p, id) => { if (id !== this.sid) others.push(p); });
      state.mobs.forEach((p) => { others.push(p); });
    }
    const motion = this.predict.motion;
    motion.frame(c, dt, this.predict.frameInput(c, active, me, others, this.aimOn && now - this.lastAimAt < 500));

    if (!measure) return;
    // Starvation and freezes of the remote fighters.
    let movingNow = 0;
    let hitch = false;
    for (const [id, e] of this.track) {
      const status = (state.players.get(id) ?? state.mobs.get(id))?.status;
      if (status !== "alive") { e.drawn = null; continue; }
      if (!this.interp.sample(id, trueT, this.tmp)) continue;
      const moving = Math.hypot(e.px - e.qx, e.py - e.qy) > 0.25 && e.n > 2;
      if (e.drawn) {
        const step = Math.hypot(this.tmp.x - e.drawn.x, this.tmp.y - e.drawn.y);
        if (moving) movingNow++;
        // A step of a whole teleport distance is a cut (a fighter placed at its spawn), not a hitch.
        if (step < TELEPORT_DISTANCE) {
          if (step > this.m.maxRemoteStep) this.m.maxRemoteStep = step;
          if (step > 3) { this.m.remoteStepsOver3++; hitch = true; }
          if (step > 8) this.m.remoteStepsOver8++;
        }
      }
      e.drawn = { x: this.tmp.x, y: this.tmp.y };
    }
    if (movingNow > 0) {
      this.lastMover = now;
      this.m.movingFrames++;
      this.m.contestedMs += frameGap;
      if (hitch) this.m.remoteHitchFrames++;
      const starved = trueT > this.lastPatchServerT + 1e-6;
      if (starved) {
        this.m.starvedFrames++;
        if (this.starveRun === 0) this.starveRunStart = now;
        this.starveRun++;
      }
      if (!starved && this.starveRun > 0) { this.m.holds.push(now - this.starveRunStart); this.starveRun = 0; }
    } else if (this.starveRun > 0) { this.m.holds.push(now - this.starveRunStart); this.starveRun = 0; }

    // Prediction health.
    this.m.visual.push(motion.visualOffset);
    this.m.delayEst.push(motion.delay);
    if (motion.walking) this.m.walkingFrames++;
    if (motion.ready) this.frameLog.push({ now, c, x: motion.drawn.x, y: motion.drawn.y, delay: motion.delay, visual: motion.visualOffset });
    // Follow mode with no lock on the server.
    if (motion.mode === "follow" && me.attackTarget === "") {
      if (this.followRunStart === 0) this.followRunStart = now;
      this.m.followWithoutLockFrames++;
    } else if (this.followRunStart > 0) {
      this.m.followWithoutLockRuns.push(now - this.followRunStart);
      this.followRunStart = 0;
    }
  }

  /** Called once at the end: the distance of each drawn position from the server's own path, which only exists afterwards. */
  finish(): void {
    const tr = this.patchTrace;
    const at = (T: number, out: Vec2): boolean => {
      if (tr.length < 2 || T < tr[0]!.t || T > tr[tr.length - 1]!.t) return false;
      let lo = 0, hi = tr.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (tr[mid]!.t <= T) lo = mid; else hi = mid; }
      const a = tr[lo]!, b = tr[hi]!;
      const k = b.t > a.t ? (T - a.t) / (b.t - a.t) : 0;
      // A teleport between samples: do not interpolate across it.
      if (Math.hypot(b.x - a.x, b.y - a.y) > 200) { out.x = a.x; out.y = a.y; } else { out.x = a.x + (b.x - a.x) * k; out.y = a.y + (b.y - a.y) * k; }
      return true;
    };
    const p = { x: 0, y: 0 };
    for (const f of this.frameLog) {
      if (at(f.c + f.delay, p)) this.m.err.push(Math.hypot(f.x - p.x, f.y - p.y));
      if (at(f.c, p)) this.m.lead.push(Math.hypot(f.x - p.x, f.y - p.y));
    }
    // The two seconds after each blink: how far the drawn fighter was from where the server's path puts it, how big the smoothing
    // offset got, the snaps and divergence drops of the model, and whether it jumped again after the blink itself (a pop back).
    for (const k of this.casts) {
      this.m.castsSent++;
      if (!k.acked) this.m.castsUnanswered++;
      const errs: number[] = [];
      let vmax = 0;
      let big = 0;
      let prev: { x: number; y: number } | null = null;
      for (const f of this.frameLog) {
        if (f.now < k.sentAt - 100 || f.now > k.sentAt + 2000) continue;
        // Until the ack and a moment after it the drawn fighter has blinked and the server's path has not (or only just): by design.
        if (k.acked && f.now >= k.ackedAt + 150 && at(f.c + f.delay, p)) errs.push(Math.hypot(f.x - p.x, f.y - p.y));
        vmax = Math.max(vmax, f.visual);
        if (prev && Math.hypot(f.x - prev.x, f.y - prev.y) > 25) big++;
        prev = f;
      }
      if (errs.length > 0) {
        errs.sort((a, b) => a - b);
        this.m.castErrMax.push(errs[errs.length - 1]!);
        this.m.castErrP95.push(errs[Math.min(errs.length - 1, Math.floor(0.95 * errs.length))]!);
      }
      this.m.castVisualMax.push(vmax);
      if (big > 1) this.m.castPopBacks++;
      for (const sn of this.snapLog) {
        if (sn.at < k.sentAt || sn.at > k.sentAt + 2000) continue;
        this.m.castSnaps++;
        this.m.castSnapsByWho[sn.who] = (this.m.castSnapsByWho[sn.who] ?? 0) + 1;
      }
      for (const d of this.divLog) if (d >= k.sentAt && d <= k.sentAt + 2000) this.m.castDivDrops++;
    }
    if (this.starveRun > 0) this.m.holds.push(this.prevNow - this.starveRunStart);
    if (this.followRunStart > 0) this.m.followWithoutLockRuns.push(this.prevNow - this.followRunStart);
  }

  /** The Wish, when the slot is ready: a blink toward a random point in reach, cast the way RaidScene.castSlot does it. */
  private tryWish(now: number, c: number, me: PlayerState, state: RaidState): void {
    if (now - this.lastCastTry < 1500 + this.rnd() * 2500) return;
    const entry = abilityInSlot(me, "wish");
    if (!entry) return;
    const readyAt = slotReadyAt(me, "wish");
    if (readyAt > c) return;
    const motion = this.predict.motion;
    if (castUnanswered(this.pendingCast, "wish", now, readyAt, this.pendingCast !== null && motion.orderPending(this.pendingCast.seq))) return;
    const r = rankOf(entry.def, entry.rank);
    const blink = r.effects.find((e) => e.do === "blink");
    if (!blink || blink.do !== "blink") return;
    this.lastCastTry = now;
    const from = motion.ready ? { x: motion.predicted.x, y: motion.predicted.y } : { x: me.x, y: me.y };
    const a = this.rnd() * Math.PI * 2;
    const d = 120 + this.rnd() * 300;
    const aim = { x: Math.min(Math.max(from.x + Math.cos(a) * d, 0), WORLD_W), y: Math.min(Math.max(from.y + Math.sin(a) * d, 0), WORLD_H) };
    const landing = blinkLanding(this.map, state.gatesLocked, from, aim, blink.maxDist, blink.minDist);
    if (!landing) return;
    const seq = this.predict.nextSeq();
    this.predict.noteCast(c, { castMs: r.castMs, seq, blink: { landing } });
    this.room.send("cast", { slot: "wish", x: aim.x, y: aim.y, seq });
    this.pendingCast = { slot: "wish", seq, readyAt, until: now + JUMP_ORDER_EXPIRE_MS };
    this.casts.push({ seq, sentAt: now, c, landing, displace0: me.displaceSeq, acked: false, accepted: false, ackedAt: 0 });
    this.lockOn = false;
  }

  // ---------------------------------------------------------------------------------------------------------- the player

  private planMap(state: RaidState): GameMap {
    return state.gatesLocked ? withGates(this.map) : this.map;
  }

  private sendMove(now: number, c: number, to: Vec2, state: RaidState): void {
    const seq = this.predict.nextSeq();
    const map = this.planMap(state);
    const clamped = { x: Math.min(Math.max(to.x, 0), WORLD_W), y: Math.min(Math.max(to.y, 0), WORLD_H) };
    this.predict.motion.order("move", seq, c, clamped, map);
    this.room.send("move", { x: clamped.x, y: clamped.y, seq });
    this.sendAt.set(seq, now);
    this.m.moves++;
    this.lockOn = false;
  }

  private sendStop(now: number, c: number, state: RaidState): void {
    const seq = this.predict.nextSeq();
    this.predict.motion.order("stop", seq, c, undefined, this.planMap(state));
    this.room.send("stop", { seq });
    this.sendAt.set(seq, now);
  }

  private randomReachable(from: Vec2, state: RaidState, min = 120, max = 520): Vec2 | null {
    const map = this.planMap(state);
    for (let i = 0; i < 6; i++) {
      const a = this.rnd() * Math.PI * 2;
      const d = min + this.rnd() * (max - min);
      const to = { x: from.x + Math.cos(a) * d, y: from.y + Math.sin(a) * d };
      if (to.x < 40 || to.y < 40 || to.x > WORLD_W - 40 || to.y > WORLD_H - 40) continue;
      if (findPath(map, from, to, PLAYER_RADIUS).length > 0) return to;
    }
    return null;
  }

  private candidates(state: RaidState, from: Vec2): string[] {
    const out: Array<{ id: string; d: number }> = [];
    const add = (id: string, status: string) => {
      const e = this.track.get(id);
      if (status !== "alive" || !e?.drawn) return;
      const d = Math.hypot(e.drawn.x - from.x, e.drawn.y - from.y);
      if (d <= TARGET_RANGE) out.push({ id, d });
    };
    state.players.forEach((p, id) => { if (id !== this.sid) add(id, p.status); });
    if (!state.gatesLocked) state.mobs.forEach((p, id) => add(id, p.status));
    // Prefer the far ones: a click near the limit is where drawn positions and the server's disagree.
    out.sort((a, b) => b.d - a.d);
    return out.map((o) => o.id);
  }

  private script(now: number, c: number, me: PlayerState, state: RaidState): void {
    const at = this.predict.motion.drawn;
    const pos = this.predict.motion.ready ? { x: at.x, y: at.y } : { x: me.x, y: me.y };
    // The streamed aim: about 20 Hz while the cursor is on the canvas.
    if (this.aimOn && now - this.lastAimAt >= 50) {
      this.aimAngle += (this.rnd() - 0.5) * 0.4;
      this.room.send("aim", { a: this.aimAngle });
      this.lastAimAt = now;
    }
    if (this.opts.wish) this.tryWish(now, c, me, state);
    if (now < this.holdUntil) {
      // Right button held: a move to the cursor every 100 ms, the cursor drifting.
      if (now >= this.holdNextAt) {
        this.holdAngle += (this.rnd() - 0.5) * 0.5;
        const to = { x: pos.x + Math.cos(this.holdAngle) * 260, y: pos.y + Math.sin(this.holdAngle) * 260 };
        if (findPath(this.planMap(state), pos, to, PLAYER_RADIUS).length > 0) this.sendMove(now, c, to, state);
        else this.holdAngle += Math.PI / 2;
        this.holdNextAt = now + 100;
      }
      return;
    }
    if (this.lockOn && now < this.lockUntil) return; // fighting
    if (now < this.nextActionAt) return;
    if (this.nextActionAt === 0) { this.nextActionAt = now + 500; return; }
    const r = this.rnd();
    this.nextActionAt = now + 500 + this.rnd() * 1500;
    if (r < 0.5) {
      const to = this.randomReachable(pos, state);
      if (to) this.sendMove(now, c, to, state);
    } else if (r < 0.65) {
      this.holdUntil = now + 1000 + this.rnd() * 1000;
      this.holdAngle = this.rnd() * Math.PI * 2;
      this.holdNextAt = now;
    } else if (r < 0.75) {
      this.sendStop(now, c, state);
    } else {
      const cand = this.candidates(state, pos);
      const id = cand.length > 0 ? cand[Math.floor(this.rnd() * Math.min(3, cand.length))]! : null;
      if (id) {
        this.room.send("target", { id });
        this.predict.motion.expectLock(c);
        this.pendingLocks.push({ id, sentAt: now, shown: false, done: false });
        this.m.locks++;
        this.lockOn = true;
        this.lockUntil = now + 1500 + this.rnd() * 2000;
        this.nextActionAt = this.lockUntil;
      } else {
        const to = this.randomReachable(pos, state);
        if (to) this.sendMove(now, c, to, state);
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------------------------ run

async function claim(base: string, name: string): Promise<{ token: string }> {
  // A tunnel answers 530 for a moment when its connection to the edge is being re-made: retried, as a person pressing play again would.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base}/api/profile/${encodeURIComponent(name)}`, { headers: {} }).catch(() => null);
    if (res?.ok) return { token: ((await res.json()) as ProfileResponse).token };
    if (attempt >= 20 || (res && res.status !== 530 && res.status < 500)) throw new Error(`profile ${name}: ${res ? `HTTP ${res.status}` : "no answer"}`);
    await sleep(2000);
  }
}

export async function runProbe(opts: ProbeOptions): Promise<ProbeReport> {
  const hz = opts.hz ?? 144;
  const base = opts.url.replace(/\/+$/, "").replace(/^ws/, "http");
  const name = `probe${Math.floor(Math.random() * 1e6)}`;
  const { token } = await claim(base, name);
  const m = new Metrics();
  const client = new Client(base);
  const started = Date.now();
  const wallLimit = opts.seconds * 1000 * 6 + 180_000;
  let seed = opts.seed ?? 1;
  const done = () => (opts.training ? m.activeMs : m.contestedMs) >= opts.seconds * 1000;
  while (!done() && Date.now() - started < wallLimit) {
    let room: Room<any, RaidState>;
    try {
      const join = { profile: name, token, ...(opts.faction ? { faction: opts.faction } : {}) };
      room = opts.training ? await client.create<RaidState>(TRAINING_ROOM_NAME, join) : await client.joinOrCreate<RaidState>(ROOM_NAME, join);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (opts.verbose) console.log(`[probe] join refused (${msg}); retrying`);
      await sleep(1500);
      continue;
    }
    room.reconnection.enabled = false;
    for (let i = 0; !room.state?.players && i < 500; i++) await sleep(10);
    m.sessions++;
    const session = new Session(room, m, seed++, opts);
    const pinger = setInterval(() => { try { room.ping((ms) => m.pings.push(ms)); } catch { /* closed */ } }, 1000);
    const frameMs = 1000 / hz;
    await new Promise<void>((resolve) => {
      let next = performance.now();
      let last = next;
      const timer = setInterval(() => {
        const now = performance.now();
        if (now < next) return;
        const gap = now - last;
        last = now;
        // The browser's vsync: a frame every frameMs, never a burst to catch up.
        next = Math.max(next + frameMs, now - frameMs);
        session.frame(now, Math.min(gap, 100));
        if (session.over || done()) { clearInterval(timer); resolve(); }
      }, 1);
    });
    clearInterval(pinger);
    session.finish();
    if (opts.trace) m.traces.push(session.arrivals);
    if (session.over) m.deaths++;
    if (opts.verbose) console.log(`[probe] session ${m.sessions} ended (active ${(m.activeMs / 1000).toFixed(1)} s, with movers ${(m.contestedMs / 1000).toFixed(1)} s)`);
    await Promise.race([room.leave(true).catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
    await sleep(1000);
  }
  const rep = report(m, opts, hz);
  if (opts.trace) rep.traces = m.traces;
  return rep;
}

function report(m: Metrics, opts: ProbeOptions, hz: number): ProbeReport {
  const pct = (a: number, b: number) => (b > 0 ? (100 * a) / b : 0);
  return {
    label: opts.label ?? "", url: opts.url, hz, activeSeconds: m.activeMs / 1000, contestedSeconds: m.contestedMs / 1000, frames: m.frames, sessions: m.sessions, deaths: m.deaths,
    patchGapMs: dist(m.patchGaps), patchLateMs: dist(m.patchLate), serverStepGapMs: dist(m.serverGaps), pingMs: dist(m.pings),
    clock: {
      ratio: dist(m.ratios), ratioWindow1s: dist(m.ratioWindows), backwardsFrames: m.backwards, fastFrames: m.fast, slowFrames: m.slow,
      delayMs: dist(m.delays), syncSnaps: m.syncSnaps,
    },
    starvation: {
      movingFrames: m.movingFrames, starvedFrames: m.starvedFrames, starvedPct: pct(m.starvedFrames, m.movingFrames),
      longestHoldMs: m.holds.length ? Math.max(...m.holds) : 0, holdsOver50ms: m.holds.filter((h) => h > 50).length,
      holdsOver100ms: m.holds.filter((h) => h > 100).length, maxRemoteStep: m.maxRemoteStep, remoteStepsOver3: m.remoteStepsOver3,
      remoteStepsOver8: m.remoteStepsOver8, remoteHitchPct: pct(m.remoteHitchFrames, m.movingFrames),
    },
    prediction: {
      snaps: m.snaps, snapsTotal: Object.values(m.snaps).reduce((a, b) => a + b, 0), divergenceDrops: m.divergenceDrops,
      visualOffset: dist(m.visual), errAtDelay: dist(m.err), lead: dist(m.lead), delayEstimate: dist(m.delayEst), walkingFrames: m.walkingFrames,
    },
    wish: {
      casts: m.castsSent, accepted: m.castsAccepted, refused: m.castsRefused, unanswered: m.castsUnanswered,
      ackWallMs: dist(m.castAckWall), landingErr: dist(m.castLandingErr), visualMaxPerCast: dist(m.castVisualMax),
      errMaxPerCast: dist(m.castErrMax), errP95PerCast: dist(m.castErrP95), snapsInWindows: m.castSnaps, snapsByWho: m.castSnapsByWho,
      popBacks: m.castPopBacks, divergenceDropsInWindows: m.castDivDrops,
    },
    orders: {
      moves: m.moves, acked: m.ackWall.length, ackWallMs: dist(m.ackWall), locks: m.locks, locksShown: m.locksShown,
      locksRefused: m.locksRefused, lockShownMs: dist(m.lockShown), followWithoutLockFrames: m.followWithoutLockFrames,
      followWithoutLockMs: dist(m.followWithoutLockRuns),
    },
  };
}

const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "-");
const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "-");
const f3 = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : "-");

/** A multi-line summary, one concern per line. */
export function formatReport(r: ProbeReport): string {
  const d = (x: Dist, f = f1) => `p50 ${f(x.p50)}  p95 ${f(x.p95)}  p99 ${f(x.p99)}  max ${f(x.max)}`;
  return [
    `== ${r.label} == ${r.activeSeconds.toFixed(0)} s alive, ${r.contestedSeconds.toFixed(0)} s with movers, ${r.frames} frames at ${r.hz} Hz, ${r.sessions} session(s), ${r.deaths} ended`,
    `patches   gap ms ${d(r.patchGapMs)}   late ms ${d(r.patchLateMs)}   (server step gap ${d(r.serverStepGapMs)})`,
    `ping      ms ${d(r.pingMs)}`,
    `clock     ratio ${d(r.clock.ratio, f3)}   1s windows min ${f3(r.clock.ratioWindow1s.min)} max ${f3(r.clock.ratioWindow1s.max)}   ` +
      `back ${r.clock.backwardsFrames}  fast ${r.clock.fastFrames}  slow ${r.clock.slowFrames}  snaps ${r.clock.syncSnaps}`,
    `delay     drawn ms ${d(r.clock.delayMs)}  mean ${f1(r.clock.delayMs.mean)}`,
    `starve    ${r.starvation.starvedFrames}/${r.starvation.movingFrames} frames (${f2(r.starvation.starvedPct)}%)  longest ${f1(r.starvation.longestHoldMs)} ms  holds>50 ${r.starvation.holdsOver50ms}  >100 ${r.starvation.holdsOver100ms}   ` +
      `hitch frames ${f2(r.starvation.remoteHitchPct)}%  max remote step ${f1(r.starvation.maxRemoteStep)} u  steps>3u ${r.starvation.remoteStepsOver3} >8u ${r.starvation.remoteStepsOver8}`,
    `predict   snaps ${r.prediction.snapsTotal} ${JSON.stringify(r.prediction.snaps)}  div drops ${r.prediction.divergenceDrops}   ` +
      `visual u ${d(r.prediction.visualOffset, f2)}   err@delay u ${d(r.prediction.errAtDelay)}   lead u ${d(r.prediction.lead)}   delay est ms ${d(r.prediction.delayEstimate)}`,
    ...(r.wish.casts > 0 ? [
      `wish      casts ${r.wish.casts} (accepted ${r.wish.accepted}, refused ${r.wish.refused}, unanswered ${r.wish.unanswered})  ack wall ms ${d(r.wish.ackWallMs)}   ` +
      `landing err u ${d(r.wish.landingErr)}   per cast 2 s: err max u ${d(r.wish.errMaxPerCast)}  err p95 u ${d(r.wish.errP95PerCast)}  visual max u ${d(r.wish.visualMaxPerCast)}   ` +
      `snaps ${r.wish.snapsInWindows} ${JSON.stringify(r.wish.snapsByWho)}  div drops ${r.wish.divergenceDropsInWindows}  pop backs ${r.wish.popBacks}`,
    ] : []),
    `orders    moves ${r.orders.moves} acked ${r.orders.acked}  ack wall ms ${d(r.orders.ackWallMs)}   locks ${r.orders.locks} shown ${r.orders.locksShown} refused ${r.orders.locksRefused}  ` +
      `shown ms ${d(r.orders.lockShownMs)}   follow-without-lock ${r.orders.followWithoutLockFrames} frames (runs ${d(r.orders.followWithoutLockMs)})`,
  ].join("\n");
}

function parseArgs(argv: string[]): ProbeOptions & { json?: string } {
  const o: ProbeOptions & { json?: string } = { url: "http://localhost:2567", seconds: 60 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const v = () => argv[++i]!;
    if (a === "--url") o.url = v();
    else if (a === "--seconds") o.seconds = Number(v());
    else if (a === "--seed") o.seed = Number(v());
    else if (a === "--hz") o.hz = Number(v());
    else if (a === "--label") o.label = v();
    else if (a === "--json") o.json = v();
    else if (a === "--faction") o.faction = v();
    else if (a === "--verbose") o.verbose = true;
    else if (a === "--legacy") o.legacy = true;
    else if (a === "--wish") o.wish = true;
    else if (a === "--training") o.training = true;
    else if (a === "--trace") o.trace = true;
    else if (a === "--render") o.render = JSON.parse(v()) as Partial<RenderClockOptions>;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

const entry = process.argv[1];
if (entry && import.meta.url === new URL(`file://${entry}`).href) {
  const opts = parseArgs(process.argv.slice(2));
  runProbe(opts).then((r) => {
    console.log(formatReport(r));
    if (opts.json) fs.writeFileSync(opts.json, JSON.stringify(r, null, 2));
    process.exit(0);
  }, (err) => { console.error(err); process.exit(1); });
}

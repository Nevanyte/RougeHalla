// Scores the client's draw-ahead of remote fighters (client net/remoteDraw.ts; docs/PLAYER_PREDICTION.md Stage 2) against what the
// server really did, frame by frame, for one or more arms (draw-ahead on and off) fed the same patches. Pure, no I/O: netProbe.ts runs
// it live against a server, netTraceEval.ts on recorded traces.
//
// Every patch gives each remote fighter a raw sample (the server's tick position); every frame of every arm queues what it drew and
// the time that drawing claims to show (`tDrawn`: min(render time, newest sample + the arm's cap)). A frame is judged once the samples
// after it are in: its error is its distance from the server's position at tDrawn (the lerp of the tick samples around it, which is
// what the off arm draws), its age is the estimated server clock less tDrawn. Labels need hindsight (did the fighter stand, turn, ...),
// so they are given then too. A frame whose bracket crosses a cut (a teleport, a blink) is left out and counted.
import { MAX_REWIND_MS, PLAYER_SPEED, TELEPORT_DISTANCE, TICK_MS, type GameMap, type TimedFx } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import type { EntityInterpolator } from "../../client/src/net/interpolation";
import type { RemoteDraw, RemoteDrawStats } from "../../client/src/net/remoteDraw";

export interface ScoreDist { n: number; mean: number; p50: number; p95: number; p99: number; max: number; min: number }

export function scoreDist(values: number[]): ScoreDist {
  if (values.length === 0) return { n: 0, mean: NaN, p50: NaN, p95: NaN, p99: NaN, max: NaN, min: NaN };
  const s = Float64Array.from(values).sort();
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
  let sum = 0;
  for (const v of s) sum += v;
  return { n: s.length, mean: sum / s.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: s[s.length - 1]!, min: s[0]! };
}

export const BEHAVIOURS = ["still", "turning", "locked", "held", "hasted", "straight"] as const;
export type Behaviour = (typeof BEHAVIOURS)[number];

/** One arm's numbers for one kind of fighter. */
export interface KindReport {
  frames: number;
  /** Estimated server clock less the time the drawing claims to show; less the newest sample it used; less the claim its budget allowed. */
  ageMs: ScoreDist;
  dataAgeMs: ScoreDist;
  claimAgeMs: ScoreDist;
  /** Distance from the server's position at the claimed time: all frames, those where the fighter moved, those in combat, per behaviour. */
  errU: ScoreDist;
  errMovingU: ScoreDist;
  errCombatU: ScoreDist;
  errBy: Record<Behaviour, ScoreDist>;
  /** Distance from the spot melee would rewind to for an attack sent this frame (report only: the attack's `t` is render time). */
  testedU: ScoreDist;
  /** Frames drawn past the newest sample, and how far (ms). */
  aheadMs: ScoreDist;
  extrapolatedPct: number;
  /** Share of the frames in which the fighter moved that held it (no budget). */
  heldMovingPct: number;
  /** The correction's one-frame step (u), and the share of frames (all, in combat) where it was over 4 u. */
  corrStepU: ScoreDist;
  jumpPct: number;
  jumpCombatPct: number;
  /** Share of frames whose drawn step differed from the truth's own step by over 4 u (hitches left out). */
  hindsightJumpPct: number;
  /** Corrections of 32 u or more (snaps), not across a cut. */
  snaps32: number;
  cutFrames: number;
}

export interface RemoteArmReport {
  players: KindReport;
  mobs: KindReport;
  /** The arm's render delay (interp.delayMs) per frame measured. */
  delayMs: ScoreDist;
  /** RemoteDraw's own counters over the run, and its reversals per minute of drawn fighters (players and mobs). */
  remote: RemoteDrawStats & { reversalsPerMin: number };
}

/** What an arm drew of one fighter in one frame. */
export interface ScoreFrame {
  id: string;
  kind: "player" | "mob";
  frame: number;
  dtMs: number;
  c: number;
  renderT: number;
  tDrawn: number;
  newestT: number;
  x: number;
  y: number;
  aheadMs: number;
  budgetMs: number;
  corrStep: number;
  snapped: boolean;
  testedT: number;
}

interface Raw { t: number; x: number; y: number; cut: boolean; locked: boolean }
interface Prev { frame: number; tDrawn: number; x: number; y: number; tx: number; ty: number }

class Acc {
  frames = 0;
  age: number[] = [];
  dataAge: number[] = [];
  claimAge: number[] = [];
  err: number[] = [];
  errMoving: number[] = [];
  errCombat: number[] = [];
  errBy = Object.fromEntries(BEHAVIOURS.map((b) => [b, [] as number[]])) as Record<Behaviour, number[]>;
  tested: number[] = [];
  ahead: number[] = [];
  extrapolated = 0;
  moving = 0;
  heldMoving = 0;
  corr: number[] = [];
  jumps = 0;
  combat = 0;
  jumpsCombat = 0;
  hindsightFrames = 0;
  hindsightJumps = 0;
  snaps32 = 0;
  cutFrames = 0;
  ms = 0;

  /** Adds another accumulator's frames to this one. */
  merge(o: Acc): void {
    for (const k of ["age", "dataAge", "claimAge", "err", "errMoving", "errCombat", "tested", "ahead", "corr"] as const) {
      for (const v of o[k]) this[k].push(v);
    }
    for (const b of BEHAVIOURS) for (const v of o.errBy[b]) this.errBy[b].push(v);
    for (const k of ["frames", "extrapolated", "moving", "heldMoving", "jumps", "combat", "jumpsCombat", "hindsightFrames", "hindsightJumps", "snaps32", "cutFrames", "ms"] as const) {
      this[k] += o[k];
    }
  }

  report(): KindReport {
    const pct = (a: number, b: number) => (b > 0 ? (100 * a) / b : 0);
    return {
      frames: this.frames, ageMs: scoreDist(this.age), dataAgeMs: scoreDist(this.dataAge), claimAgeMs: scoreDist(this.claimAge),
      errU: scoreDist(this.err), errMovingU: scoreDist(this.errMoving), errCombatU: scoreDist(this.errCombat),
      errBy: Object.fromEntries(BEHAVIOURS.map((b) => [b, scoreDist(this.errBy[b])])) as Record<Behaviour, ScoreDist>,
      testedU: scoreDist(this.tested), aheadMs: scoreDist(this.ahead), extrapolatedPct: pct(this.extrapolated, this.frames),
      heldMovingPct: pct(this.heldMoving, this.moving), corrStepU: scoreDist(this.corr), jumpPct: pct(this.jumps, this.frames),
      jumpCombatPct: pct(this.jumpsCombat, this.combat), hindsightJumpPct: pct(this.hindsightJumps, this.hindsightFrames),
      snaps32: this.snaps32, cutFrames: this.cutFrames,
    };
  }
}

const EMPTY_STATS = (): RemoteDrawStats => ({ snaps: 0, resetsUnderSnap: 0, cutsCrossed: 0, reversals: 0, discontinuities: 0, frozenFrames: 0, maxCorrStep: 0 });

/** How long the raw samples of a fighter are kept (ms of server time). */
const KEEP_MS = 3000;
/** A frame is judged once the samples reach this far past its claimed time (the turning label looks 100 ms ahead). */
const LOOKAHEAD_MS = 100;
/** In combat: it hit, was hit, blocked, wound up or cast within this long of the claimed time, or holds a lock. */
const COMBAT_MS = 1000;

export class DrawAheadScorer {
  private readonly raw = new Map<string, Raw[]>();
  private readonly lastCombat = new Map<string, number>();
  private readonly queues = new Map<string, ScoreFrame[]>();
  private readonly prev = new Map<string, Prev>();
  private readonly acc = new Map<string, { players: Acc; mobs: Acc; delays: number[]; stats: RemoteDrawStats }>();

  constructor(readonly arms: readonly string[], private readonly nominalFrameMs = 1000 / 144) {
    for (const a of arms) this.acc.set(a, { players: new Acc(), mobs: new Acc(), delays: [], stats: EMPTY_STATS() });
  }

  /** A patch's position of a remote fighter. `cut`: its displaceSeq changed, or the teleport's patch. `locked`: it holds a target lock. */
  sample(id: string, t: number, x: number, y: number, cut: boolean, locked: boolean): void {
    let list = this.raw.get(id);
    if (!list) { list = []; this.raw.set(id, list); }
    const last = list[list.length - 1];
    if (last && t <= last.t) return;
    // A jump the client takes for a teleport (SnapshotBuffer's TELEPORT_DISTANCE: a placement at the run's start, a respawn) is a cut here too.
    const jump = last !== undefined && Math.hypot(x - last.x, y - last.y) > TELEPORT_DISTANCE;
    list.push({ t, x, y, cut: cut || jump, locked });
    while (list.length > 2 && list[0]!.t < t - KEEP_MS) list.shift();
  }

  /** It hit, was hit, blocked, wound up or cast at server time t. */
  combat(id: string, t: number): void {
    if (t > (this.lastCombat.get(id) ?? -Infinity)) this.lastCombat.set(id, t);
  }

  /**
   * What one arm drew of one fighter this frame. Its ages need no truth and are counted at once, over every frame drawn (so two arms
   * fed the same patches count the same frames); the rest is judged later, by resolve().
   */
  frame(arm: string, f: ScoreFrame): void {
    const acc = this.acc.get(arm)!;
    const a = f.kind === "player" ? acc.players : acc.mobs;
    a.age.push(f.c - f.tDrawn);
    a.dataAge.push(f.c - Math.min(f.renderT, f.newestT));
    a.claimAge.push(f.c - Math.min(f.renderT, f.newestT + f.budgetMs));
    const key = `${arm}\u0000${f.id}`;
    let q = this.queues.get(key);
    if (!q) { q = []; this.queues.set(key, q); }
    q.push({ ...f });
  }

  /** The arm's render delay this frame. */
  armFrame(arm: string, delayMs: number): void {
    this.acc.get(arm)?.delays.push(delayMs);
  }

  /** Adds a session's RemoteDraw counters to the arm. */
  addStats(arm: string, s: RemoteDrawStats): void {
    const a = this.acc.get(arm)!.stats;
    a.snaps += s.snaps;
    a.resetsUnderSnap += s.resetsUnderSnap;
    a.cutsCrossed += s.cutsCrossed;
    a.reversals += s.reversals;
    a.discontinuities += s.discontinuities;
    a.frozenFrames += s.frozenFrames;
    a.maxCorrStep = Math.max(a.maxCorrStep, s.maxCorrStep);
  }

  /** Judges every queued frame whose truth is now known. Call after every patch. */
  resolve(): void {
    for (const [key, q] of this.queues) {
      const sep = key.indexOf("\u0000");
      const arm = key.slice(0, sep);
      const id = key.slice(sep + 1);
      const list = this.raw.get(id);
      if (!list || list.length === 0) continue;
      const newest = list[list.length - 1]!.t;
      let k = 0;
      for (; k < q.length; k++) {
        const f = q[k]!;
        if (Math.max(f.tDrawn + LOOKAHEAD_MS, f.testedT) > newest) break;
        this.judge(arm, f, list);
      }
      if (k > 0) q.splice(0, k);
    }
  }

  /** Frames still waiting for their truth are dropped (a session's end); the fighters it knew are forgotten. */
  endSession(): void {
    this.queues.clear();
    this.raw.clear();
    this.prev.clear();
    this.lastCombat.clear();
  }

  /** Adds another scorer's judged frames and counters (the same arms) to this one: the merged row of several sessions. */
  merge(other: DrawAheadScorer): void {
    for (const arm of this.arms) {
      const a = this.acc.get(arm)!;
      const o = other.acc.get(arm);
      if (!o) continue;
      a.players.merge(o.players);
      a.mobs.merge(o.mobs);
      for (const v of o.delays) a.delays.push(v);
      this.addStats(arm, o.stats);
    }
  }

  report(arm: string): RemoteArmReport {
    const a = this.acc.get(arm)!;
    const minutes = (a.players.ms + a.mobs.ms) / 60_000;
    return {
      players: a.players.report(), mobs: a.mobs.report(), delayMs: scoreDist(a.delays),
      remote: { ...a.stats, reversalsPerMin: minutes > 0 ? a.stats.reversals / minutes : 0 },
    };
  }

  private judge(arm: string, f: ScoreFrame, list: Raw[]): void {
    const acc = this.acc.get(arm)!;
    const a = f.kind === "player" ? acc.players : acc.mobs;
    const key = `${arm}\u0000${f.id}`;
    const truth = at(list, f.tDrawn);
    if (!truth) return;
    // Within two ticks before a cut the client's own buffer has already dropped the samples before the pre-cut one (it holds that one
    // until the cut is due), in either arm: not the draw-ahead's doing.
    if (truth.crossesCut || cutBetween(list, f.tDrawn, f.tDrawn + 2 * TICK_MS)) {
      a.cutFrames++;
      this.prev.delete(key);
      return;
    }
    const err = Math.hypot(f.x - truth.x, f.y - truth.y);
    const before50 = at(list, f.tDrawn - 50);
    const before100 = at(list, f.tDrawn - 100);
    const after100 = at(list, f.tDrawn + 100);
    const step50 = before50 ? Math.hypot(truth.x - before50.x, truth.y - before50.y) : 0;
    const still = step50 <= 0.5;
    const speed = step50 / 0.05;
    let turning = false;
    if (before100 && after100) {
      const v1x = truth.x - before100.x;
      const v1y = truth.y - before100.y;
      const v2x = after100.x - truth.x;
      const v2y = after100.y - truth.y;
      const m1 = Math.hypot(v1x, v1y) > 2;
      const m2 = Math.hypot(v2x, v2y) > 2;
      turning = m1 !== m2 || (m1 && m2 && Math.abs(Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y)) >= Math.PI / 4);
    }
    const locked = truth.locked;
    const held = !still && f.budgetMs === 0;
    const behaviour: Behaviour = still ? "still" : turning ? "turning" : locked ? "locked" : held ? "held" : speed > 1.2 * PLAYER_SPEED ? "hasted" : "straight";
    const combat = locked || f.tDrawn - (this.lastCombat.get(f.id) ?? -Infinity) <= COMBAT_MS;

    a.frames++;
    a.ms += f.dtMs;
    a.err.push(err);
    a.errBy[behaviour].push(err);
    if (!still) {
      a.moving++;
      a.errMoving.push(err);
      if (held) a.heldMoving++;
    }
    if (combat) a.errCombat.push(err);
    const tested = at(list, f.testedT);
    if (tested && !tested.crossesCut) a.tested.push(Math.hypot(f.x - tested.x, f.y - tested.y));
    if (f.aheadMs > 0) { a.extrapolated++; a.ahead.push(f.aheadMs); }
    a.corr.push(f.corrStep);
    if (f.corrStep > 4) a.jumps++;
    if (combat) {
      a.combat++;
      if (f.corrStep > 4) a.jumpsCombat++;
    }
    if (f.snapped && f.corrStep >= 32) a.snaps32++;
    const p = this.prev.get(key);
    if (p && p.frame === f.frame - 1 && f.dtMs <= 2.5 * this.nominalFrameMs && !cutBetween(list, p.tDrawn, f.tDrawn)) {
      a.hindsightFrames++;
      const j = Math.hypot((f.x - p.x) - (truth.x - p.tx), (f.y - p.y) - (truth.y - p.ty));
      if (j > 4) a.hindsightJumps++;
    }
    this.prev.set(key, { frame: f.frame, tDrawn: f.tDrawn, x: f.x, y: f.y, tx: truth.x, ty: truth.y });
  }
}

/** The server's position at T from the tick samples: their lerp, a cut held until its own tick; flags a bracket that crosses one. */
function at(list: Raw[], T: number): { x: number; y: number; locked: boolean; crossesCut: boolean } | null {
  const n = list.length;
  if (n === 0 || T < list[0]!.t || T > list[n - 1]!.t) return null;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.t <= T) lo = mid;
    else hi = mid;
  }
  const a = list[lo]!;
  const b = list[hi]!;
  if (T === b.t) return { x: b.x, y: b.y, locked: b.locked, crossesCut: false };
  if (T === a.t || hi === lo) return { x: a.x, y: a.y, locked: a.locked, crossesCut: false };
  if (b.cut) return { x: a.x, y: a.y, locked: a.locked, crossesCut: true };
  const k = (T - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, locked: a.locked, crossesCut: false };
}

function cutBetween(list: Raw[], t0: number, t1: number): boolean {
  for (const s of list) if (s.cut && s.t > t0 && s.t <= t1) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------------------------- the rig

/** One way of drawing: an interpolator and its RemoteDraw. `owned`: the rig feeds the interpolator (patches, cuts, its render time). */
export interface DrawAheadArm { name: string; interp: EntityInterpolator; draw: RemoteDraw; owned: boolean }

/** A remote fighter as the patch shows it (PlayerState and MobState both fit). */
interface Shown { x: number; y: number; status: string; effects: number; displaceSeq?: number; drawStartedAt?: number; attackTarget?: string; kind?: string }

/**
 * Feeds every arm the same patches and fx, draws every remote player and every mob near `selfId` in each arm each frame (as RaidScene
 * does, at the arm's render time), and scores what was drawn. The caller owns the clocks of arms it does not hand to the rig.
 */
export class DrawAheadRig {
  readonly scorer: DrawAheadScorer;
  private state: RaidState | null = null;
  private teleportAt = Infinity;
  private readonly seqs = new Map<string, number>();
  private readonly out = { x: 0, y: 0 };
  private frameNo = 0;

  constructor(readonly arms: readonly DrawAheadArm[], scorer: DrawAheadScorer, private readonly selfId: string | null, private readonly within = 1200) {
    this.scorer = scorer;
  }

  /** Every fx at its arrival. */
  onFx(fx: TimedFx): void {
    for (const a of this.arms) {
      a.draw.noteFx(fx);
      if (a.owned && fx.kind === "teleport") a.interp.markCut(fx.t);
    }
    switch (fx.kind) {
      case "teleport": this.teleportAt = Math.min(this.teleportAt, fx.t); break;
      case "hit": this.scorer.combat(fx.id, fx.t); if (fx.by) this.scorer.combat(fx.by, fx.t); break;
      case "block": this.scorer.combat(fx.id, fx.t); this.scorer.combat(fx.by, fx.t); break;
      case "windup": case "cast": this.scorer.combat(fx.by, fx.t); break;
      default: break;
    }
  }

  /** Every patch at its arrival: the owned arms' interpolators, then the truth samples, then the frames it lets be judged. */
  onPatch(state: RaidState, now: number): void {
    if (!state.players) return;
    this.state = state;
    for (const a of this.arms) if (a.owned) a.interp.onPatch(state, now);
    const t = state.serverTime;
    const cutAll = t >= this.teleportAt;
    if (cutAll) this.teleportAt = Infinity;
    this.forEachFighter((id, kind, f) => {
      const seq = f.displaceSeq ?? 0;
      const before = this.seqs.get(id);
      this.seqs.set(id, seq);
      this.scorer.sample(id, t, f.x, f.y, cutAll || (before !== undefined && before !== seq), kind === "player" && (f.attackTarget ?? "") !== "");
    });
    this.scorer.resolve();
  }

  /**
   * One frame of every arm. `given(arm)` is the render time of an arm the rig does not own (the caller read it this frame); `rttMs`
   * the round trip the client estimates (for the rewound spot). Nothing is scored unless `measure`.
   */
  frame(now: number, dtMs: number, measure: boolean, map: GameMap | null, rttMs: number, given: (arm: string) => number | undefined): void {
    const state = this.state;
    if (!state) return;
    for (const a of this.arms) {
      const r = a.owned ? a.interp.renderTime(now) : given(a.name);
      if (r === undefined) continue;
      a.draw.beginFrame(map, r);
      const c = a.interp.clock.synced ? a.interp.clock.now(now) : state.serverTime;
      // An attack sent this frame lands at the first tick a round trip after the clock's estimate, and melee rewinds to its `t`
      // (render time), clamped into [one tick, MAX_REWIND_MS] behind that tick (sim/weapons.ts noteLag, rewindTime).
      const applyT = (Math.floor((c + Math.max(0, rttMs)) / TICK_MS) + 1) * TICK_MS;
      const testedT = Math.max(applyT - MAX_REWIND_MS, Math.min(r, applyT - TICK_MS));
      this.forEachFighter((id, kind, f) => {
        if (!a.draw.draw(id, kind, { x: f.x, y: f.y, status: f.status, effects: f.effects, drawStartedAt: f.drawStartedAt ?? 0 }, r, this.out)) return;
        if (!measure) return;
        const newest = a.interp.buffer(id)?.latest;
        if (!newest) return;
        const info = a.draw.lastOf(id);
        this.scorer.frame(a.name, {
          id, kind, frame: this.frameNo, dtMs, c, renderT: r, tDrawn: info ? info.tDrawn : Math.min(r, newest.t), newestT: newest.t,
          x: this.out.x, y: this.out.y, aheadMs: info?.aheadMs ?? 0, budgetMs: info?.budgetMs ?? 0, corrStep: info?.corrStep ?? 0,
          snapped: info?.snapped ?? false, testedT,
        });
      });
      if (measure) this.scorer.armFrame(a.name, a.interp.delayMs);
    }
    this.frameNo++;
  }

  /** The session is over: its RemoteDraw counters go to the scorer, and the frames still waiting are dropped. */
  endSession(): void {
    for (const a of this.arms) this.scorer.addStats(a.name, a.draw.stats);
    this.scorer.endSession();
  }

  private forEachFighter(cb: (id: string, kind: "player" | "mob", f: Shown) => void): void {
    const state = this.state!;
    const self = this.selfId ? state.players.get(this.selfId) : undefined;
    state.players.forEach((p: Shown, id: string) => { if (id !== this.selfId) cb(id, "player", p); });
    state.mobs?.forEach((m: Shown, id: string) => {
      if (m.kind === "quest") return;
      if (self && Math.hypot(m.x - self.x, m.y - self.y) > this.within) return;
      cb(id, "mob", m);
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------- the verdict

const fx1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "-");
const fx2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "-");
const mark = (ok: boolean) => (ok ? "PASS" : "FAIL");

/**
 * The acceptance gates on remote players (docs/PLAYER_PREDICTION.md): G2 the displayed age drops by at least 50 ms; G3 the error is
 * at most 1.5 u mean, 8.5 u p95, 17 u p99; G4 a correction over 4 u on at most 2% of the combat frames, nothing reset under 32 u.
 * Report-only lines follow. Never sets an exit code.
 */
export function verdict(on: RemoteArmReport, off: RemoteArmReport, label = ""): { pass: boolean; lines: string[] } {
  const p = on.players;
  const drop = off.players.ageMs.mean - p.ageMs.mean;
  // Both arms count the ages of the same frames: below the ceiling the drop is exactly 50 ms by construction (paired render clocks),
  // so what this checks is the wiring, and that stalls and the ceiling do not eat the gain.
  const g2 = drop >= 50 - 0.01;
  const g3 = p.errU.mean <= 1.5 && p.errU.p95 <= 8.5 && p.errU.p99 <= 17;
  const g4 = p.jumpCombatPct <= 2 && on.remote.resetsUnderSnap === 0;
  const pre = label ? `${label} ` : "";
  const lines = [
    `${pre}G2 ${mark(g2)}  displayed age drop ${fx2(drop)} ms (off ${fx1(off.players.ageMs.mean)} -> on ${fx1(p.ageMs.mean)}; >= 50)`,
    `${pre}G3 ${mark(g3)}  error u mean ${fx2(p.errU.mean)} (<= 1.5)  p95 ${fx2(p.errU.p95)} (<= 8.5)  p99 ${fx2(p.errU.p99)} (<= 17)   over ${p.errU.n} remote-player frames`,
    `${pre}G4 ${mark(g4)}  corrections over 4 u ${fx2(p.jumpCombatPct)}% of combat frames (<= 2), resets under 32 u ${on.remote.resetsUnderSnap}, snaps ${p.snaps32}`,
    `${pre}   report  moving-only error u mean ${fx2(p.errMovingU.mean)} p95 ${fx2(p.errMovingU.p95)} p99 ${fx2(p.errMovingU.p99)}` +
      `   data age drop ${fx1(off.players.dataAgeMs.mean - p.dataAgeMs.mean)} ms  claim age drop ${fx1(off.players.claimAgeMs.mean - p.claimAgeMs.mean)} ms`,
    `${pre}   report  error by behaviour: ${BEHAVIOURS.map((b) => `${b} ${fx2(p.errBy[b].mean)}/${fx2(p.errBy[b].p95)} (${p.errBy[b].n})`).join("  ")}`,
    `${pre}   report  hindsight jumps ${fx2(p.hindsightJumpPct)}% (off ${fx2(off.players.hindsightJumpPct)}%)   held while moving ${fx1(p.heldMovingPct)}%` +
      `   tested spot u mean ${fx2(p.testedU.mean)} p95 ${fx2(p.testedU.p95)} (off ${fx2(off.players.testedU.mean)}/${fx2(off.players.testedU.p95)})`,
  ];
  return { pass: g2 && g3 && g4, lines };
}

/** One arm, a few lines. */
export function formatArm(name: string, r: RemoteArmReport): string[] {
  const k = (label: string, x: KindReport) =>
    `drawahead ${name.padEnd(3)} ${label.padEnd(7)} frames ${x.frames}  age ms ${fx1(x.ageMs.mean)} (data ${fx1(x.dataAgeMs.mean)}, claim ${fx1(x.claimAgeMs.mean)})` +
    `  err u all ${fx2(x.errU.mean)}/${fx2(x.errU.p95)}/${fx2(x.errU.p99)}  moving ${fx2(x.errMovingU.mean)}/${fx2(x.errMovingU.p95)}/${fx2(x.errMovingU.p99)}` +
    `  combat ${fx2(x.errCombatU.mean)}/${fx2(x.errCombatU.p95)}  tested ${fx2(x.testedU.mean)}/${fx2(x.testedU.p95)}` +
    `  extrapolated ${fx1(x.extrapolatedPct)}% (ahead ms mean ${fx1(x.aheadMs.mean)})  held-moving ${fx1(x.heldMovingPct)}%` +
    `  jumps>4u ${fx2(x.jumpPct)}% (combat ${fx2(x.jumpCombatPct)}%)  hindsight ${fx2(x.hindsightJumpPct)}%  snaps ${x.snaps32}  cut frames ${x.cutFrames}`;
  return [
    k("players", r.players),
    k("mobs", r.mobs),
    `drawahead ${name.padEnd(3)} delay ms mean ${fx1(r.delayMs.mean)} p95 ${fx1(r.delayMs.p95)}   remote: snaps ${r.remote.snaps}, resets under snap ${r.remote.resetsUnderSnap}, ` +
      `cuts ${r.remote.cutsCrossed}, reversals ${r.remote.reversals} (${fx2(r.remote.reversalsPerMin)}/fighter-min), max corr step ${fx2(r.remote.maxCorrStep)} u`,
  ];
}

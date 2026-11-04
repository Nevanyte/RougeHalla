// When the continuous input streams leave (pure: every time is an argument). The server keeps only the latest aim of a tick and
// re-plans a held move each time one arrives, so what matters for both is how old the newest one is when a tick wakes, not how
// many are sent. Discrete orders (a key change, a click, a lock, an attack, a cast) never come through here: the server applies
// them at the first wake after they arrive, so holding one back can only make it later.
//
//   aim   A floor gate of half a tick (two sends a tick on average, wherever the tick is) instead of one tick; and, once the order
//         acks show where the deadline is (net/tickPhase.ts, which needs a server that wakes on its grid) and frames are short
//         enough to place a send, one in the last frame before each wake's deadline and a backup a quarter tick before it.
//   hold  The right button held re-sends its move only when the cursor's ground point moved, about every HOLD_REPEAT_MS (in every
//         second slot before a wake while the deadline is known), and an unchanged one as a keepalive. Every message but `aim`
//         spends the server's per-player order budget (ORDER_BURST 30, ORDER_PER_SECOND 15, dropped past it): a hold at one a tick
//         would empty it in seconds and silently drop the clicks, casts and locks sent beside it.
//
// The aim stands back when the client's own rate nears the server's steady message rate (RaidRoom's MESSAGE_RATE, 200 a second,
// past which a client is closed once its MESSAGE_BURST is spent): one a tick from AIM_BUDGET_SLOW a second, keepalives only from
// AIM_BUDGET_STOP. The meter counts sends, so it cannot see a stalled TCP that delivers seconds of them at once. The stall watch
// helps when the browser can see the stall: while the socket holds unsent bytes (WebSocket.bufferedAmount above 0 for a tick) the
// continuous streams (the aim, the held button's re-sends, the keyboard's repeat) send nothing, so what piles up behind the stall
// is orders only. It cannot see most of them (the operating system's send buffer takes many seconds of these small messages before
// bufferedAmount moves, and a stall of the server or of a hop past the browser never shows here), so the server's budget is sized for
// the whole backlog (docs/NETWORK_INVESTIGATION_2026-11-04.md). The first fresh sample after the socket drains goes out at once.
import { TICK_MS, type Vec2 } from "@raid/shared";
import type { PhaseSource } from "./tickPhase";

/** The aim stream's gate when the deadline is not known (TICK_MS reproduces the gate before the floor). */
export const AIM_FLOOR_MS = TICK_MS / 2;
/**
 * The aligned aim: one send in the last frame before each wake's deadline, and a backup this long before it, for when the deadline
 * was read a little late (a quarter tick: server/test/aimLag.test.ts's harness measured it ahead of a half tick, 61.6 against
 * 75.6 ms at p99, at 144 fps on a grid tick).
 */
export const AIM_BACKUP_MS = TICK_MS / 4;
/**
 * The aligned aim needs frames shorter than this (ms, between two judgments of the gate): a frame sends up to its length before
 * the deadline, and at 60 fps that is no better than the floor's half tick (measured: a few ms worse on the mean).
 */
export const AIM_ALIGN_FRAME_MS = 15;
/** Off switch for the aligned slots (the floor gate then always runs). */
export const ALIGNED_UPLINK = true;
/** An unchanged aim is re-sent after this long: the server turns a fighter to its walk once the aim is AIM_STALE_MS (1000) old. */
export const AIM_KEEPALIVE_MS = 500;
/** The aligned path sends anyway after this long without a send (a slot the frames never met). */
export const AIM_STARVE_MS = 150;
/** Messages a second (all of them, `sendInput`) from which the aim slows to one a tick, and from which it sends keepalives only. */
export const AIM_BUDGET_SLOW = 70;
export const AIM_BUDGET_STOP = 88;
/** A held right button: re-sent when the ground point moved this far (u) from the last one sent... */
export const HOLD_MOVE_MIN = 6;
/** ...at most once per this (ms) while the deadline is not known (the minimap's and the old hold's MOVE_REPEAT_MS)... */
export const HOLD_REPEAT_MS = 100;
/**
 * ...and while it is known, in a slot at least this long after the last send: every second slot, so the hold stays at about 10
 * a second inside the server's order budget (15 a second) with room for clicks, as the unaligned repeat does.
 */
export const HOLD_ALIGNED_GAP_MS = HOLD_REPEAT_MS - TICK_MS / 2;
/** ...and unchanged after this long. */
export const HOLD_KEEPALIVE_MS = 250;
/** A held move this long after the last one goes out at once, not in a slot: the stream was quiet (past the second slot). */
const HOLD_QUIET_MS = 3 * TICK_MS;
/** The frame time is the longest of the last few frames, each clamped to this range (ms). */
const FRAME_SAMPLES = 6;
const FRAME_MIN_MS = 1;
const FRAME_MAX_MS = 50;
const METER_SIZE = 128;
const METER_WINDOW_MS = 1000;
/**
 * The socket must hold unsent bytes this long (ms, read once a frame) before the uplink counts as stalled: a send's own bytes
 * still read above 0 for a frame or two on a healthy link, and a backlog shorter than a tick costs the server nothing, since it
 * wakes once a tick and keeps only the newest aim of it.
 */
export const STALL_AFTER_MS = TICK_MS;

/**
 * Whether the uplink is backed up (pure: `now` and the reading are arguments). Fed once a frame with the socket's
 * `bufferedAmount` (net/connection.ts socketBufferedBytes; undefined when there is no open socket to read, which also clears
 * it), it says `stalled` once the reading has stayed above 0 for STALL_AFTER_MS and clears at the first reading of 0.
 */
export class StallWatch {
  private since = Number.NaN;

  sample(now: number, buffered: number | undefined): void {
    if (!(typeof buffered === "number" && buffered > 0)) this.since = Number.NaN;
    else if (Number.isNaN(this.since)) this.since = now;
  }

  stalled(now: number): boolean {
    return !Number.isNaN(this.since) && now - this.since >= STALL_AFTER_MS;
  }

  reset(): void {
    this.since = Number.NaN;
  }
}

/** Sends over the last second: a ring of the last METER_SIZE send times, so it reads at most METER_SIZE. Allocation free. */
export class MessageMeter {
  private readonly times = new Float64Array(METER_SIZE);
  private head = 0;
  private count = 0;

  note(now: number): void {
    this.times[this.head] = now;
    this.head = (this.head + 1) % METER_SIZE;
    if (this.count < METER_SIZE) this.count++;
  }

  perSecond(now: number): number {
    let n = 0;
    for (let i = 1; i <= this.count; i++) {
      if (this.times[(this.head - i + METER_SIZE) % METER_SIZE]! <= now - METER_WINDOW_MS) break;
      n++;
    }
    return n;
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
  }
}

/** How long the next frame may take: the longest of the last FRAME_SAMPLES frames (Infinity until two frames were seen). */
export class FramePace {
  private readonly dts = new Float64Array(FRAME_SAMPLES);
  private n = 0;
  private i = 0;
  private last = Number.NaN;

  frame(now: number): void {
    if (Number.isFinite(this.last) && now > this.last) {
      this.dts[this.i] = Math.min(FRAME_MAX_MS, Math.max(FRAME_MIN_MS, now - this.last));
      this.i = (this.i + 1) % FRAME_SAMPLES;
      if (this.n < FRAME_SAMPLES) this.n++;
    }
    this.last = now;
  }

  get ms(): number {
    if (this.n === 0) return Infinity;
    let m = 0;
    for (let k = 0; k < this.n; k++) m = Math.max(m, this.dts[k]!);
    return m;
  }

  reset(): void {
    this.n = 0;
    this.i = 0;
    this.last = Number.NaN;
  }
}

/**
 * Whether the aim may be sent this frame. `now` local ms, `c` the estimated server clock at the same instant, `synced` whether
 * that clock is set, `perSecond` the messages sent in the last second, `phase` the deadline learner (null: none), `stalled` whether
 * the uplink is backed up (StallWatch: the answer is then always no). A true answer
 * in the aligned path uses its slot up even if nothing is sent (the cursor did not turn): the next slot carries the turn.
 */
export interface AimGateOptions {
  /** The gate while the deadline is not known (AIM_FLOOR_MS; TICK_MS is the gate before the floor). */
  floorMs?: number;
  /** Use the learned deadline at all (ALIGNED_UPLINK). */
  aligned?: boolean;
  backupMs?: number;
  alignFrameMs?: number;
}

export class AimGate {
  /** Fed with the instant the gate is judged each frame (not the frame's start: the work before it varies). */
  readonly frames = new FramePace();
  readonly floorMs: number;
  readonly aligned: boolean;
  readonly backupMs: number;
  readonly alignFrameMs: number;
  private lastSentAt = -Infinity;
  private lastSlot = Number.NaN;
  private lastBackup = Number.NaN;

  constructor(o: AimGateOptions = {}) {
    this.floorMs = o.floorMs ?? AIM_FLOOR_MS;
    this.aligned = o.aligned ?? ALIGNED_UPLINK;
    this.backupMs = o.backupMs ?? AIM_BACKUP_MS;
    this.alignFrameMs = o.alignFrameMs ?? AIM_ALIGN_FRAME_MS;
  }

  due(now: number, c: number, synced: boolean, perSecond: number, phase: PhaseSource | null, stalled = false): boolean {
    // A backed-up uplink delivers whatever is sent into it later, in one burst: nothing continuous goes (not even the keepalive).
    if (stalled) return false;
    const since = now - this.lastSentAt;
    if (perSecond >= AIM_BUDGET_STOP) return since >= AIM_KEEPALIVE_MS;
    if (perSecond >= AIM_BUDGET_SLOW) return since >= TICK_MS;
    const fdt = this.frames.ms;
    if (this.aligned && synced && phase !== null && fdt < this.alignFrameMs && phase.status(c).ready) {
      if (since > AIM_STARVE_MS) return true;
      // The next frame may come `fdt` from now: this is the last one before the deadline when that is past it.
      const slot = phase.slot(c, TICK_MS);
      if (slot.id !== this.lastSlot && c + fdt >= slot.deadline) {
        this.lastSlot = slot.id;
        this.lastBackup = slot.id;
        return true;
      }
      const backup = slot.deadline - this.backupMs;
      if (slot.id === this.lastBackup || c > backup || c + fdt < backup) return false;
      this.lastBackup = slot.id;
      return true;
    }
    return since >= this.floorMs;
  }

  /** The aim went out at `now`. */
  sent(now: number): void {
    this.lastSentAt = now;
  }

  reset(): void {
    this.frames.reset();
    this.lastSentAt = -Infinity;
    this.lastSlot = Number.NaN;
    this.lastBackup = Number.NaN;
  }
}

/** What a held right button does this frame: nothing, a move now, or a move in the slot before a wake (`aligned`). */
export type HoldSend = "none" | "now" | "aligned";

/** The right button's re-sends while it is held (the press itself is an order of its own, `sent` tells the gate of it). */
export class HoldGate {
  private readonly last: Vec2 = { x: 0, y: 0 };
  private hasLast = false;
  private lastSentAt = -Infinity;
  private lastSlot = Number.NaN;

  /** `target` the cursor's ground point now; `fdt` how long the next frame may take (FramePace.ms); `stalled` the uplink is backed up. */
  next(target: Vec2, now: number, c: number, synced: boolean, phase: PhaseSource | null, fdt: number, stalled = false): HoldSend {
    if (stalled) return "none";
    const since = now - this.lastSentAt;
    const moved = !this.hasLast || Math.hypot(target.x - this.last.x, target.y - this.last.y) > HOLD_MOVE_MIN;
    if (!moved) return since >= HOLD_KEEPALIVE_MS ? "now" : "none";
    if (since >= HOLD_QUIET_MS) return "now";
    if (synced && phase !== null && fdt < TICK_MS && phase.status(c).ready) {
      if (since < HOLD_ALIGNED_GAP_MS) return "none";
      const slot = phase.slot(c, TICK_MS);
      if (slot.id === this.lastSlot || c + fdt < slot.deadline) return "none";
      this.lastSlot = slot.id;
      return "aligned";
    }
    return since >= HOLD_REPEAT_MS ? "now" : "none";
  }

  /** A move to `target` went out at `now` (the press, or a re-send `next` asked for). */
  sent(target: Vec2, now: number): void {
    this.last.x = target.x;
    this.last.y = target.y;
    this.hasLast = true;
    this.lastSentAt = now;
  }

  reset(): void {
    this.hasLast = false;
    this.lastSentAt = -Infinity;
    this.lastSlot = Number.NaN;
  }
}

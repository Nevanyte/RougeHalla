// When a room steps. Core's setTimestep is a setInterval, which Node re-arms from the moment it fired, so its wakes drift about a
// millisecond late each and an accumulator repays the drift with a wake of two steps every second or so: one patch whose server
// time jumps 100 ms. Server time is virtual (+TICK_MS a step), so every client's RenderClock reads that sawtooth as network jitter
// and draws the remote world further back. The pacer counts steps against a fixed grid on a float clock instead, and the Room
// re-arms its timer for the next slot of that grid, so a late wake does not move the next one. Pure: the Room passes the time in.
import { TICK_MS } from "@raid/shared";

/** Steps one wake runs at most. A longer backlog (a stall: a first-join map, GC, a throttled host) is dropped and the grid moved. */
export const MAX_CATCHUP_STEPS = 3;

/** A wake this early still owns its slot: Node truncates a timer's delay and libuv's clock to whole milliseconds. */
export const EARLY_TOLERANCE_MS = 1;

export class TickPacer {
  private t0: number;
  private done = 0;
  /** The last take(): how long after the first slot it owed it came (negative: early). */
  lastLateMs = 0;
  /** The last take() dropped a backlog and moved the grid to it. */
  reanchored = false;

  constructor(startMs: number, readonly stepMs = TICK_MS, readonly maxCatchup = MAX_CATCHUP_STEPS) {
    this.t0 = startMs;
  }

  /**
   * The steps owed at `now` on the grid `t0 + k * stepMs`, counted as run before the caller runs them, so a step that throws is not
   * owed again.
   */
  take(now: number): number {
    this.lastLateMs = now - (this.t0 + (this.done + 1) * this.stepMs);
    this.reanchored = false;
    let n = Math.floor((now + EARLY_TOLERANCE_MS - this.t0) / this.stepMs) - this.done;
    if (n <= 0) return 0;
    if (n > this.maxCatchup) {
      // As the old accumulator did: the rest is dropped, and the next slot is a whole step from now.
      n = this.maxCatchup;
      this.reanchored = true;
    }
    this.done += n;
    if (this.reanchored) this.t0 = now - this.done * this.stepMs;
    return n;
  }

  /**
   * Whole ms, at least 1, from `now` to the next slot. Read after the work, so the step's own cost does not push the grid. Rounded
   * up: Node starts a timer from its millisecond-truncated clock, so it can fire up to 1 ms before `now + delay`, and that must
   * still land within EARLY_TOLERANCE_MS of the slot (rounded down, the model of Node's timers in test/tickPacer.test.ts has one
   * wake in ten come too early and step nothing).
   */
  delayMs(now: number): number {
    return Math.max(1, Math.ceil(this.t0 + (this.done + 1) * this.stepMs - now));
  }
}

/** A room's offset on the grid in [0, stepMs), from its id (FNV-1a): rooms made in the same millisecond do not all wake together. */
export function phaseOf(roomId: string, stepMs = TICK_MS): number {
  let h = 2166136261;
  for (let i = 0; i < roomId.length; i++) {
    h ^= roomId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 4294967296) * stepMs;
}

/** Upper bounds (ms) of the lateness buckets; past the last is the overflow. */
const LATE_BOUNDS = [0, 1, 2, 4, 8, 16, 32] as const;

/** Every room's wakes in this process, for /readyz: fixed counters, nothing kept per wake or per room. */
export class TickStats {
  wakes = 0;
  /** Wakes that ran 0, 1, 2 and 3 or more steps. */
  readonly steps = [0, 0, 0, 0];
  /** Wakes that ran a step, by how late they came after its slot (LATE_BOUNDS, then the overflow). */
  readonly late: number[] = new Array<number>(LATE_BOUNDS.length + 1).fill(0);
  reanchors = 0;

  note(steps: number, lateMs: number, reanchored: boolean): void {
    this.wakes++;
    this.steps[Math.min(steps, 3)]!++;
    if (reanchored) this.reanchors++;
    if (steps === 0) return;
    let i = 0;
    while (i < LATE_BOUNDS.length && lateMs > LATE_BOUNDS[i]!) i++;
    this.late[i]!++;
  }

  /** The bucket bound under which a share `p` of the stepping wakes came; null when that is past the last bound (or none came). */
  latePercentile(p: number): number | null {
    const total = this.late.reduce((a, b) => a + b, 0);
    let seen = 0;
    for (let i = 0; i < LATE_BOUNDS.length; i++) {
      seen += this.late[i]!;
      if (total > 0 && seen >= p * total) return LATE_BOUNDS[i]!;
    }
    return null;
  }

  snapshot() {
    const pct = (n: number) => (this.wakes > 0 ? Math.round((10000 * n) / this.wakes) / 100 : 0);
    return {
      wakes: this.wakes,
      zeroStepPct: pct(this.steps[0]!),
      doubleStepPct: pct(this.steps[2]! + this.steps[3]!),
      catchupReanchors: this.reanchors,
      lateMsP50: this.latePercentile(0.5),
      lateMsP95: this.latePercentile(0.95),
    };
  }
}

export const tickStats = new TickStats();

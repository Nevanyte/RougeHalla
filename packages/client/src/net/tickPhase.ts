// Where the server's tick deadline lies on the client clock, learned from the order acks (pure: every time is an argument).
//
// Every order the server echoes gives d = T - TICK_MS - c (LocalMotion.ack): T the server time of the patch that applied it, c the
// client clock it was sent at. The clock reads the newest stamp as it arrives, so the step stamped T ran at client clock T - down,
// and an order applied there arrived within the tick before it: d = up + down - the wait it had, in [RTT - TICK_MS, RTT). Over
// orders sent at every phase of the tick, the top of that range is how early a send must leave to make a given step, so a stream
// that only the latest value per tick counts for (the aim) can leave in the last frame before that deadline instead of free-running.
//
// It only means something when the server wakes on its grid. A tick that drifts against its own clock spreads d over more than a
// tick; one that runs two steps at once (the setTimestep accumulator's catch-up, seen as a patch two ticks after the one before)
// is off its grid by definition, and on today's server the samples between two catch-ups agreed often enough to mislead (a real
// server probe: ready in 18-62% of frames, the aligned aim a millisecond worse than the floor), so a catch-up quiets the learner
// for PHASE_QUIET_MS; and orders sent at one phase only (a repeat that is a whole number of ticks) say nothing about the rest.
// Any of these keeps it not ready, and the callers fall back to a plain rate gate.
import { TICK_MS } from "@raid/shared";

/** Samples older than this (client clock ms) are dropped, and at most this many are kept. */
export const PHASE_WINDOW_MS = 15_000;
export const PHASE_MAX_SAMPLES = 64;
/** Fewer samples than this say nothing. */
export const PHASE_MIN_SAMPLES = 8;
/** d's range (trimmed by one at each end from 16 samples) beyond a tick plus this is a drifting or double-stepping tick: unlearnable. */
export const PHASE_SPREAD_SLACK_MS = 30;
/**
 * Beyond a tick plus this much range the uplink jitters enough that an aligned send is no better than a send every half tick
 * (the model: +0.3 ms at +-10 ms of jitter), so the learner calls itself not ready.
 */
export const PHASE_JITTER_OFF_MS = 8;
/** The widest gap (ms, circular) allowed between the tick phases the samples were sent at: a narrower view under-reads the deadline. */
export const PHASE_GAP_MAX_MS = 16;
/** Which share of d the lead is set to: the maximum would let one late ack pull every deadline early. */
export const PHASE_LEAD_QUANTILE = 0.95;
/** The lead and the margin move at most this much per sample once ready, so slot boundaries do not jitter. */
export const PHASE_SLEW_MS = 1;
/** The clock's offset moving more than this between two frames is a resync (or a stall), not its slew: the samples are void. */
export const PHASE_CLOCK_STEP_MS = 4;
/**
 * A patch that is not one tick after the one before means the server ran a catch-up step: its wakes are off the grid (today's
 * setTimestep accumulator does it every few seconds, a grid pacer only after a hitch). The samples go, and the learner stays not
 * ready this long after (client clock ms) whatever the new samples say: on the accumulator they agreed often enough to mislead.
 */
export const PHASE_QUIET_MS = 10_000;
/** Added to an order repeat while the samples cover too few phases, so its sends sweep the tick (31 of 50: a golden-ish step). */
export const PHASE_SWEEP_MS = 31;
const MARGIN_MIN_MS = 4;
const MARGIN_MAX_MS = 16;
/** LocalMotion's DELAY_MIN_MS / DELAY_MAX_MS: a delay at either clamp is not a measurement. */
const D_MIN_MS = -TICK_MS;
const D_MAX_MS = 400;
/** A sample sent this close (ms) to an aligned send of our own is that send: it sits at the deadline and says nothing new. */
const ALIGNED_MATCH_MS = 1;
const ALIGNED_KEEP = 8;

export interface PhaseStatus {
  /** The deadlines below can be trusted. */
  ready: boolean;
  /** Samples in the window. */
  n: number;
  /** The quantile of d, about the round trip: a send at client clock (a step's stamp - lead) reaches that step about as it runs. */
  leadMs: number;
  /** Kept between the deadline and the wake for what the samples could not show: 4..16 ms, more for jitter and thin coverage. */
  marginMs: number;
  /** Server time modulo TICK_MS of the newest acked patch: where the wakes sit on the grid (not assumed 0). */
  gridMs: number;
  /** d's range (trimmed from 16 samples). */
  spreadMs: number;
  /** The widest circular gap between the samples' send phases. */
  gapMs: number;
}

/** A send slot: an integer id (one send per id) and the client clock by which a send must have left. */
export interface PhaseSlot { id: number; deadline: number }

/** What the send gates read. */
export interface PhaseSource {
  status(at: number): PhaseStatus;
  slot(c: number, period: number): PhaseSlot;
}

/**
 * The slot at or after client clock `c` for one send per `period` (TICK_MS: one per step): id k is for the step stamped
 * k * period + grid, and its deadline is that stamp less the lead and the margin. Ids are integers, so a lead that moves between
 * two frames never sends a slot twice.
 */
export function phaseSlot(st: PhaseStatus, c: number, period: number, out: PhaseSlot = { id: 0, deadline: 0 }): PhaseSlot {
  const k = Math.ceil((c + st.leadMs + st.marginMs - st.gridMs) / period);
  out.id = k;
  out.deadline = k * period + st.gridMs - st.leadMs - st.marginMs;
  return out;
}

const mod = (v: number, m: number): number => ((v % m) + m) % m;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

interface Sample { d: number; c: number; at: number }

export class TickPhase implements PhaseSource {
  private samples: Sample[] = [];
  private grid = 0;
  private lastOffset = Number.NaN;
  /** The samples agree on a deadline (the status is ready only if no catch-up step came within PHASE_QUIET_MS too). */
  private agreed = false;
  private irregularAt = -Infinity;
  private readonly aligned: number[] = [];
  private readonly st: PhaseStatus = { ready: false, n: 0, leadMs: 0, marginMs: MARGIN_MAX_MS, gridMs: 0, spreadMs: 0, gapMs: TICK_MS };
  private readonly ds: number[] = [];
  private readonly phases: number[] = [];
  private readonly slotOut: PhaseSlot = { id: 0, deadline: 0 };

  /** The numbers are the defaults above; the options are for the probe's and the model's experiments. */
  constructor(private readonly opts: { leadQuantile?: number; jitterOffMs?: number } = {}) {}

  /**
   * The order sent at client clock `c` was applied by the patch stamped `t`, which arrived at client clock `at` and followed the
   * one before it by `patchDt`: `d` = t - TICK_MS - c. A patch after a gap or a double step can be either step's: refused.
   */
  push(d: number, c: number, t: number, at: number, patchDt: number): void {
    if (!Number.isFinite(d) || !Number.isFinite(c) || !Number.isFinite(t) || !Number.isFinite(at)) return;
    if (patchDt !== TICK_MS || d <= D_MIN_MS || d >= D_MAX_MS) return;
    for (const a of this.aligned) if (Math.abs(a - c) <= ALIGNED_MATCH_MS) return;
    this.grid = mod(t, TICK_MS);
    this.prune(at);
    this.samples.push({ d, c, at });
    while (this.samples.length > PHASE_MAX_SAMPLES) this.samples.shift();
    this.recompute(true);
  }

  /** An order of ours left in an aligned slot at client clock `c`: its ack sits at the deadline and would narrow the view. */
  noteAlignedSend(c: number): void {
    this.aligned.push(c);
    if (this.aligned.length > ALIGNED_KEEP) this.aligned.shift();
  }

  /** Once per frame: the estimated clock's offset (server - local). A step past its slew re-bases every sample: they go. */
  noteClock(offsetMs: number): void {
    if (!Number.isFinite(offsetMs)) return;
    if (Number.isFinite(this.lastOffset) && Math.abs(offsetMs - this.lastOffset) > PHASE_CLOCK_STEP_MS) this.flush();
    this.lastOffset = offsetMs;
  }

  /** Every patch: its server time less the one before (`at` the client clock it arrived at). Anything but one tick is a catch-up. */
  notePatch(patchDt: number, at: number): void {
    if (!Number.isFinite(patchDt) || patchDt === TICK_MS) return;
    this.flush();
    this.irregularAt = at;
  }

  /** Forgets everything (a reconnect, a new scene). */
  reset(): void {
    this.flush();
    this.lastOffset = Number.NaN;
    this.irregularAt = -Infinity;
    this.aligned.length = 0;
  }

  /** The learner as of client clock `at` (samples older than the window dropped). The object is reused: read it, do not keep it. */
  status(at: number): PhaseStatus {
    if (this.prune(at)) this.recompute(false);
    this.st.ready = this.agreed && at - this.irregularAt >= PHASE_QUIET_MS;
    return this.st;
  }

  /** The send slot at or after `c` for `period` (the last status's numbers; meaningful only while it is ready). */
  slot(c: number, period: number): PhaseSlot {
    return phaseSlot(this.st, c, period, this.slotOut);
  }

  /** What an order repeat adds to its interval while the samples cover too few phases (0 otherwise): it sweeps the tick. */
  sweepMs(): number {
    return this.st.n >= PHASE_MIN_SAMPLES && this.st.gapMs > PHASE_GAP_MAX_MS ? PHASE_SWEEP_MS : 0;
  }

  private flush(): void {
    this.samples = [];
    this.agreed = false;
    this.st.ready = false;
    this.st.n = 0;
    this.st.spreadMs = 0;
    this.st.gapMs = TICK_MS;
  }

  private prune(at: number): boolean {
    const s = this.samples;
    let i = 0;
    while (i < s.length && s[i]!.at < at - PHASE_WINDOW_MS) i++;
    if (i === 0) return false;
    s.splice(0, i);
    return true;
  }

  private recompute(slew: boolean): void {
    const st = this.st;
    const s = this.samples;
    const n = s.length;
    st.n = n;
    st.gridMs = this.grid;
    if (n < PHASE_MIN_SAMPLES) {
      this.agreed = false;
      st.spreadMs = 0;
      st.gapMs = TICK_MS;
      return;
    }
    const ds = this.ds;
    const ph = this.phases;
    ds.length = 0;
    ph.length = 0;
    for (const x of s) {
      ds.push(x.d);
      ph.push(mod(x.c - this.grid, TICK_MS));
    }
    ds.sort((a, b) => a - b);
    ph.sort((a, b) => a - b);
    const trim = n >= 16 ? 1 : 0;
    const spread = ds[n - 1 - trim]! - ds[trim]!;
    let gap = ph[0]! + TICK_MS - ph[n - 1]!;
    for (let i = 1; i < n; i++) gap = Math.max(gap, ph[i]! - ph[i - 1]!);
    const q = this.opts.leadQuantile ?? PHASE_LEAD_QUANTILE;
    const lead = ds[Math.min(n - 1, Math.floor(q * (n - 1) + 0.5))]!;
    const margin = clamp(MARGIN_MIN_MS + 0.5 * Math.max(0, spread - TICK_MS) + 0.5 * gap, MARGIN_MIN_MS, MARGIN_MAX_MS);
    const agreed = spread <= TICK_MS + PHASE_SPREAD_SLACK_MS && gap <= PHASE_GAP_MAX_MS
      && spread - TICK_MS <= (this.opts.jitterOffMs ?? PHASE_JITTER_OFF_MS);
    if (agreed && !this.agreed) {
      st.leadMs = lead;
      st.marginMs = margin;
    } else if (agreed && slew) {
      st.leadMs += clamp(lead - st.leadMs, -PHASE_SLEW_MS, PHASE_SLEW_MS);
      st.marginMs += clamp(margin - st.marginMs, -PHASE_SLEW_MS, PHASE_SLEW_MS);
    }
    this.agreed = agreed;
    st.spreadMs = spread;
    st.gapMs = gap;
  }
}

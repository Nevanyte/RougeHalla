// Snapshot interpolation. Pure so it can be unit-tested and reused by headless bots.
import { INTERP_DELAY_MS, MAX_INTERP_DELAY_MS, MIN_INTERP_DELAY_MS, PATCH_MS, TELEPORT_DISTANCE } from "./constants";

export interface Sample {
  t: number;
  x: number;
  y: number;
  /** Teleport: hold the previous position until render time reaches `t`, then snap. */
  cut?: boolean;
}

/**
 * Per-entity history of authoritative positions keyed by server time (ms).
 * `sample(t)` lerps between the two samples bracketing t, holds the newest
 * sample when starved (no extrapolation), and never lerps across a teleport.
 */
export class SnapshotBuffer {
  private samples: Sample[] = [];

  constructor(
    private readonly maxSamples = 40,
    private readonly teleportDistance = TELEPORT_DISTANCE,
  ) {}

  get size(): number { return this.samples.length; }

  get latest(): Sample | undefined { return this.samples[this.samples.length - 1]; }

  clear(): void { this.samples.length = 0; }

  /** `forceCut`: the server said this sample is a teleport, however short the jump (see EntityInterpolator.markCut). */
  push(t: number, x: number, y: number, forceCut = false): void {
    let last = this.samples[this.samples.length - 1];
    if (last && t < last.t) return; // out of order: ignore
    // Same timestamp: replace the sample, re-checking the teleport rule against the one before it.
    if (last && t === last.t) { this.samples.pop(); last = this.samples[this.samples.length - 1]; }
    let cut = false;
    if (last && (forceCut || Math.hypot(x - last.x, y - last.y) > this.teleportDistance)) {
      // Keep only the pre-teleport sample so the entity stays put until the cut is due.
      this.samples.splice(0, this.samples.length - 1);
      cut = true;
    }
    this.samples.push(cut ? { t, x, y, cut } : { t, x, y });
    if (this.samples.length > this.maxSamples) this.samples.shift();
  }

  /** Writes the interpolated position into `out`. Returns false if there is no data yet. */
  sample(t: number, out: { x: number; y: number }): boolean {
    const s = this.samples;
    const n = s.length;
    if (n === 0) return false;
    const first = s[0]!;
    const last = s[n - 1]!;
    if (n === 1 || t <= first.t) { out.x = first.x; out.y = first.y; return true; }
    if (t >= last.t) { out.x = last.x; out.y = last.y; return true; }
    // Render time sits near the end of the buffer, so scan backwards.
    let i = n - 2;
    while (i > 0 && s[i]!.t > t) i--;
    const a = s[i]!;
    const b = s[i + 1]!;
    if (b.cut) {
      out.x = a.x;
      out.y = a.y;
    } else {
      const k = (t - a.t) / (b.t - a.t);
      out.x = a.x + (b.x - a.x) * k;
      out.y = a.y + (b.y - a.y) * k;
    }
    // Keep one sample before the bracket; everything older is dead weight.
    if (i > 1) s.splice(0, i - 1);
    return true;
  }
}

/**
 * Estimates the server clock from patch arrivals. The offset tracks
 * (serverTime − localArrivalTime), so render time follows the arrival stream.
 *
 * The offset only ever slews by a bounded amount per patch in either direction, so the render
 * clock runs within a few percent of real time even when patches bunch up (e.g. a server step
 * that ran two ticks at once). A patch that is much later than expected snaps the offset down at
 * once instead, so render time can't run past the data it has.
 */
export class ServerClock {
  private offset: number | null = null;

  constructor(
    /** Max offset change per observed patch (≈ 2 ms × 20 Hz = 4% clock speed). */
    private readonly maxSlewMs = 2,
    private readonly resyncThresholdMs = 250,
    /** A patch this much later than expected is treated as real lag, not jitter. */
    private readonly lateSnapMs = 20,
  ) {}

  get synced(): boolean { return this.offset !== null; }

  /** The estimated (server time − local time), 0 before the first patch. */
  get offsetMs(): number { return this.offset ?? 0; }

  observe(serverTime: number, localNow: number): void {
    const sample = serverTime - localNow;
    if (this.offset === null || Math.abs(sample - this.offset) > this.resyncThresholdMs) {
      this.offset = sample;
      return;
    }
    const err = sample - this.offset;
    if (err < -this.lateSnapMs) this.offset = sample;
    else this.offset += Math.max(-this.maxSlewMs, Math.min(this.maxSlewMs, err));
  }

  now(localNow: number): number {
    return localNow + (this.offset ?? 0);
  }

  renderTime(localNow: number, delayMs = INTERP_DELAY_MS): number {
    return this.now(localNow) - delayMs;
  }
}


export interface RenderClockOptions {
  /** The delay is never below / above this (ms), measured as `PATCH_MS` plus how far render time trails the patch stream's median. */
  minMs: number;
  maxMs: number;
  /** Added to what the percentile asks: what a window of a few seconds could not see (a patch later than any in it). */
  marginMs: number;
  /** Which share of the recent patches the delay must be enough for (0..1). */
  percentile: number;
  /** How far back the percentile looks (ms of local time). */
  windowMs: number;
  /** Patches seen before the window is trusted; until then render time trails the clock by `initialMs`. */
  warmup: number;
  initialMs: number;
  /** How fast the delay may grow, as a share of real time (0.2: render time then runs at 80% speed while it does). */
  growRate: number;
  /** How fast it may shrink when it is close to where it should be (0.01: render time runs at 101%)... */
  shrinkRate: number;
  /** ...and when it is `shrinkFarMs` or more away from it (after a bad stretch, or at the start). In between it is linear. */
  shrinkFastRate: number;
  shrinkFarMs: number;
  /** Render time jumps instead of slewing when the wanted value is this far (ms) from it: a stalled tab, a resync. */
  snapMs: number;
}

export const RENDER_CLOCK_DEFAULTS: RenderClockOptions = {
  minMs: MIN_INTERP_DELAY_MS,
  maxMs: MAX_INTERP_DELAY_MS,
  marginMs: 10,
  percentile: 0.98,
  windowMs: 4000,
  warmup: 20,
  initialMs: INTERP_DELAY_MS,
  growRate: 0.2,
  shrinkRate: 0.01,
  shrinkFastRate: 0.05,
  shrinkFarMs: 80,
  snapMs: 250,
};

/**
 * Render time for a snapshot stream, drawn far enough behind the newest data that an interpolation segment is complete when render
 * time reaches it, and no further.
 *
 * Each patch is judged by `r = (server time of the previous patch) − (local time it arrived)`: render time may be `r` ahead of local
 * time at most, or the patch that completes the segment before the previous patch's time is not there yet when render time reaches
 * it. `r` is one patch interval smaller when the network or the server's own step ran late, and when two ticks came in one patch
 * (the previous patch's time is then 100 ms back). Render time is held at the `percentile` of the last few seconds of those, less
 * a margin: the delay (`PATCH_MS` + how far that is behind the median `r`) is a function of the network and nothing else, so the
 * estimate of the server clock under it (a ServerClock, which the scene also stamps its orders with) can wobble without moving the
 * picture. It is bounded below and above, rises as fast as `growRate` allows and falls at `shrinkRate` (faster when far above what
 * is asked): render time therefore never runs backwards and its speed stays within [1 − growRate, 1 + shrinkFastRate], except
 * when it re-anchors after a gap of `snapMs`.
 */
export class RenderClock {
  /** The estimated server clock (`now()`): what orders are stamped with. A late patch moves it by at most `maxSlewMs`, never snaps it back. */
  readonly clock: ServerClock;
  readonly options: RenderClockOptions;
  private samples: Array<{ at: number; r: number }> = [];
  private scratch: number[] = [];
  private pending: { t: number; at: number } | null = null;
  private prevT = Number.NaN;
  /** render time = local time + this. */
  private offset = 0;
  private anchored = false;
  private lastNow = 0;
  /** Median `r` and the delay asked for, as of the last frame. */
  private median = 0;
  private asked: number;

  constructor(options: Partial<RenderClockOptions> = {}, clock?: ServerClock) {
    this.options = { ...RENDER_CLOCK_DEFAULTS, ...options };
    this.clock = clock ?? new ServerClock(2, 250, Infinity);
    this.asked = this.options.initialMs;
  }

  /** A patch arrived (once per patch): its server time and the local time it arrived. */
  onPatch(serverTime: number, localNow: number): void {
    if (Number.isFinite(this.prevT) && serverTime > this.prevT) {
      const s = this.samples;
      s.push({ at: localNow, r: this.prevT - localNow });
      while (s.length > 0 && s[0]!.at < localNow - this.options.windowMs) s.shift();
    }
    if (!(serverTime <= this.prevT)) this.prevT = serverTime;
    // Only the newest patch since the last frame feeds the clock: a burst after a stall would skew it.
    if (!this.pending || serverTime > this.pending.t) this.pending = { t: serverTime, at: localNow };
  }

  /** Once per frame, before sampling. */
  renderTime(localNow: number): number {
    if (this.pending) {
      this.clock.observe(this.pending.t, this.pending.at);
      this.pending = null;
    }
    const o = this.options;
    const want = this.want();
    const dt = this.anchored ? clamp(localNow - this.lastNow, 0, o.snapMs) : 0;
    this.lastNow = localNow;
    if (!this.anchored || Math.abs(want - this.offset) > o.snapMs) {
      this.offset = want;
      this.anchored = true;
    } else {
      const diff = want - this.offset;
      // diff > 0: render time is further behind than asked, so it may move up (the delay shrinks): slowly, unless it is far.
      const shrink = o.shrinkRate + (o.shrinkFastRate - o.shrinkRate) * clamp((diff - o.shrinkFarMs / 4) / (o.shrinkFarMs * 3 / 4), 0, 1);
      this.offset += clamp(diff, -o.growRate * dt, shrink * dt);
    }
    return localNow + this.offset;
  }

  /** The render offset wanted now (render time − local time), and the delay it makes (`asked`). */
  private want(): number {
    const o = this.options;
    const s = this.samples;
    if (s.length < o.warmup) {
      // Not enough to judge: trail the clock's estimate by the initial delay.
      this.asked = o.initialMs;
      this.median = this.clock.offsetMs - PATCH_MS;
      return this.clock.offsetMs - o.initialMs;
    }
    const v = this.scratch;
    v.length = 0;
    for (const x of s) v.push(x.r);
    v.sort((a, b) => a - b);
    const low = v[Math.min(v.length - 1, Math.floor((1 - o.percentile) * v.length))]!;
    this.median = v[v.length >> 1]!;
    const lag = clamp(this.median - low + o.marginMs, o.minMs - PATCH_MS, o.maxMs - PATCH_MS);
    this.asked = PATCH_MS + lag;
    return this.median - lag;
  }

  /** The delay the network asks for (ms): `PATCH_MS` plus how far render time is to trail the median patch. Render time slews towards it. */
  get targetMs(): number { return this.asked; }

  /** The delay render time has now (ms): the same measure as `targetMs`, so it is the one that is bounded and tuned. */
  get delayMs(): number {
    return this.anchored ? PATCH_MS + (this.median - this.offset) : this.options.initialMs;
  }
}

function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }

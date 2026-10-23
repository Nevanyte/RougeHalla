// Snapshot interpolation. Pure so it can be unit-tested and reused by headless bots.
import { INTERP_DELAY_MS, TELEPORT_DISTANCE } from "./constants";

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

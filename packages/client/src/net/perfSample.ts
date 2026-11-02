// The client's one perf sample of an arena run (docs/TELEMETRY.md 3.9): an always-on frame-time histogram and a 2 s ping
// histogram, independent of the FPS/ping readout, sent once at the run's result. Presentation-side only: nothing it measures
// reaches the sim, and the server sanitizes whatever arrives (sanitizeClientPerf).
import { histogramQuantile, type ClientPerfSample } from "@raid/shared";
import { FPS_GAP_MS, PING_EVERY_MS, PING_TIMEOUT_MS, type PingRoom } from "../ui/perfMeter";

/** 1 ms frame buckets up to 100 ms, plus an overflow bucket. */
const FRAME_BUCKETS = 101;
/** 5 ms ping buckets up to 1 s, plus an overflow bucket. */
const RTT_WIDTH = 5;
const RTT_BUCKETS = 201;
const LONG_FRAME_MS = 50;

export class PerfSampler {
  readonly frames = new Uint16Array(FRAME_BUCKETS);
  readonly rtt = new Uint16Array(RTT_BUCKETS);
  private lastFrame = -1;
  private hiddenMs = 0;
  private longFrames = 0;
  private rttSamples = 0;
  private delaySum = 0;
  private delayN = 0;
  private nextPingAt = 0;
  private pingSentAt = -1;
  private pingSeq = 0;
  private room: PingRoom | null = null;

  reset(): void {
    this.frames.fill(0);
    this.rtt.fill(0);
    this.lastFrame = -1;
    this.hiddenMs = this.longFrames = this.rttSamples = this.delaySum = this.delayN = 0;
    this.nextPingAt = 0;
    this.pingSentAt = -1;
    this.pingSeq++;
    this.room = null;
  }

  /** Once per rendered frame of an arena run (RaidScene.update). `delayMs`: the render delay in use. */
  frame(now: number, room: PingRoom | null, delayMs?: number): void {
    if (this.lastFrame >= 0) {
      const dt = now - this.lastFrame;
      if (dt > FPS_GAP_MS) this.hiddenMs += dt; // a hidden tab or a stall: not a frame time
      else if (dt >= 0) {
        const i = Math.min(FRAME_BUCKETS - 1, Math.floor(dt));
        if (this.frames[i]! < 0xffff) this.frames[i]!++;
        if (dt > LONG_FRAME_MS) this.longFrames++;
      }
    }
    this.lastFrame = now;
    if (delayMs !== undefined && Number.isFinite(delayMs)) { this.delaySum += delayMs; this.delayN++; }
    this.ping(now, room);
  }

  private ping(now: number, room: PingRoom | null): void {
    if (room !== this.room) { this.room = room; this.pingSeq++; this.pingSentAt = -1; }
    if (!room || room.connection?.isOpen === false) return;
    if (this.pingSentAt >= 0) {
      if (now - this.pingSentAt >= PING_TIMEOUT_MS) this.pingSentAt = -1;
      return;
    }
    if (now < this.nextPingAt) return;
    const seq = ++this.pingSeq;
    this.pingSentAt = now;
    this.nextPingAt = now + PING_EVERY_MS;
    try {
      room.ping((ms) => {
        if (seq !== this.pingSeq) return;
        this.pingSentAt = -1;
        if (!Number.isFinite(ms) || ms < 0) return;
        const i = Math.min(RTT_BUCKETS - 1, Math.floor(ms / RTT_WIDTH));
        if (this.rtt[i]! < 0xffff) this.rtt[i]!++;
        this.rttSamples++;
      });
    } catch {
      this.pingSentAt = -1;
    }
  }

  toSample(view: { dpr?: number; canvasW?: number; canvasH?: number; ua?: string } = {}): ClientPerfSample {
    const out: ClientPerfSample = { v: 1 };
    const p50 = histogramQuantile(this.frames, 1, 0.5);
    const p95 = histogramQuantile(this.frames, 1, 0.95);
    const p99 = histogramQuantile(this.frames, 1, 0.99);
    if (p50 !== null && p50 > 0) out.fpsP50 = round1(1000 / p50);
    if (p95 !== null) out.frameMsP95 = p95;
    if (p99 !== null) out.frameMsP99 = p99;
    out.longFrames = this.longFrames;
    const r50 = histogramQuantile(this.rtt, RTT_WIDTH, 0.5);
    const r95 = histogramQuantile(this.rtt, RTT_WIDTH, 0.95);
    if (r50 !== null) out.rttP50 = r50;
    if (r95 !== null) out.rttP95 = r95;
    out.rttSamples = this.rttSamples;
    if (this.delayN > 0) out.interpDelayMs = round1(this.delaySum / this.delayN);
    out.hiddenSec = round1(this.hiddenMs / 1000);
    if (view.dpr !== undefined) out.dpr = view.dpr;
    if (view.canvasW !== undefined) out.canvasW = view.canvasW;
    if (view.canvasH !== undefined) out.canvasH = view.canvasH;
    if (view.ua !== undefined) out.ua = uaBucket(view.ua);
    return out;
  }
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** The four-way browser bucket: never the user agent itself. */
export function uaBucket(ua: string): NonNullable<ClientPerfSample["ua"]> {
  if (/Firefox\//.test(ua)) return "firefox";
  if (/(Chrome|Chromium|Edg)\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua)) return "safari";
  return "other";
}

/** The sampler of the arena run on screen: RaidScene resets and feeds it, main.ts sends it at the result. */
export const runPerf = new PerfSampler();

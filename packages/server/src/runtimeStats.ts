// What /readyz says about the process itself: event-loop delay and tick cost over a recent window, and the container's CPU quota.
// A throttled cgroup shows as bursts of delay with a low cpuSeconds, which the lifetime figures this replaces could not tell apart.
import fs from "node:fs";
import { monitorEventLoopDelay } from "node:perf_hooks";

type IntervalHistogram = ReturnType<typeof monitorEventLoopDelay>;

export interface DelayStats { p50: number; p95: number; p99: number; max: number }

const NS_PER_MS = 1e6;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Event-loop delay beyond the sampling timer's own period, over a recent window. The histogram records the whole timer interval
 * (period plus lateness), so the resolution is taken off; a reading is "how late", not "how long". Histograms cannot be merged,
 * so the window is the current one once it holds MIN_SAMPLES (10 s), else the last completed one; each lasts `windowMs`.
 */
export class LoopDelayWindow {
  private current: IntervalHistogram;
  private previous: IntervalHistogram | null = null;
  private rotatedAt: number;

  constructor(readonly resolutionMs = 10, readonly windowMs = 60_000, now = Date.now()) {
    this.current = monitorEventLoopDelay({ resolution: resolutionMs });
    this.current.enable();
    this.rotatedAt = now;
  }

  private rotate(now: number): void {
    if (now - this.rotatedAt < this.windowMs) return;
    this.previous?.disable();
    this.previous = this.current;
    this.previous.disable();
    this.current = monitorEventLoopDelay({ resolution: this.resolutionMs });
    this.current.enable();
    this.rotatedAt = now;
  }

  snapshot(now = Date.now()): DelayStats | null {
    this.rotate(now);
    const h = this.current.count >= 1000 || !this.previous ? this.current : this.previous;
    if (h.count === 0) return null;
    const excess = (ns: number) => round2(Math.max(0, ns / NS_PER_MS - this.resolutionMs));
    return { p50: excess(h.percentile(50)), p95: excess(h.percentile(95)), p99: excess(h.percentile(99)), max: excess(h.max) };
  }

  disable(): void {
    this.current.disable();
    this.previous?.disable();
  }
}

/** The last `size` samples in a ring: percentiles are computed on request, so recording one is a single store. */
export class SampleWindow {
  private readonly buf: Float64Array;
  private n = 0;

  constructor(readonly size = 2400) {
    this.buf = new Float64Array(size);
  }

  add(v: number): void {
    this.buf[this.n % this.size] = v;
    this.n++;
  }

  snapshot(): (DelayStats & { samples: number }) | null {
    const k = Math.min(this.n, this.size);
    if (k === 0) return null;
    const sorted = Array.from(this.buf.subarray(0, k)).sort((a, b) => a - b);
    const at = (p: number) => sorted[Math.min(k - 1, Math.ceil(p * k) - 1)]!;
    return { p50: round2(at(0.5)), p95: round2(at(0.95)), p99: round2(at(0.99)), max: round2(sorted[k - 1]!), samples: k };
  }
}

export interface CgroupCpu {
  version: 1 | 2;
  /** CPUs the quota allows (quota / period); null when unlimited. */
  limitCpus: number | null;
  periods: number;
  throttledPeriods: number;
  throttledSeconds: number;
  /** throttledPeriods / periods since the cgroup began, in percent. */
  throttledPct: number;
}

const num = (text: string, key: string): number | null => {
  const m = new RegExp(`^${key}\\s+(\\d+)\\s*$`, "m").exec(text);
  return m ? Number(m[1]) : null;
};

function build(version: 1 | 2, limitCpus: number | null, periods: number, throttled: number, throttledUsec: number): CgroupCpu {
  return {
    version, limitCpus: limitCpus === null ? null : round2(limitCpus), periods, throttledPeriods: throttled,
    throttledSeconds: round2(throttledUsec / 1e6), throttledPct: periods > 0 ? round2((100 * throttled) / periods) : 0,
  };
}

/** cgroup v2: cpu.max is "<quota|max> <period>", cpu.stat has nr_periods, nr_throttled, throttled_usec. */
export function parseCgroupV2(cpuMax: string, cpuStat: string): CgroupCpu | null {
  const periods = num(cpuStat, "nr_periods");
  const throttled = num(cpuStat, "nr_throttled");
  const usec = num(cpuStat, "throttled_usec");
  if (periods === null || throttled === null || usec === null) return null;
  const [quota, period] = cpuMax.trim().split(/\s+/);
  const q = quota === "max" ? null : Number(quota);
  const p = Number(period);
  const limit = q !== null && Number.isFinite(q) && p > 0 ? q / p : null;
  return build(2, limit, periods, throttled, usec);
}

/** cgroup v1: cpu.cfs_quota_us is -1 when unlimited; cpu.stat has nr_periods, nr_throttled and throttled_time in ns. */
export function parseCgroupV1(quotaUs: string, periodUs: string, cpuStat: string): CgroupCpu | null {
  const periods = num(cpuStat, "nr_periods");
  const throttled = num(cpuStat, "nr_throttled");
  const ns = num(cpuStat, "throttled_time");
  if (periods === null || throttled === null || ns === null) return null;
  const q = Number(quotaUs.trim());
  const p = Number(periodUs.trim());
  const limit = q > 0 && p > 0 ? q / p : null;
  return build(1, limit, periods, throttled, ns / 1000);
}

const read = (file: string): string | null => {
  try { return fs.readFileSync(file, "utf8"); } catch { return null; }
};

/** Cheap enough for a request (two or three small procfs reads); null where there is no cgroup (macOS) or it is unreadable. */
export function readCgroupCpu(root = "/sys/fs/cgroup"): CgroupCpu | null {
  const max = read(`${root}/cpu.max`);
  const stat = read(`${root}/cpu.stat`);
  if (max !== null && stat !== null) return parseCgroupV2(max, stat);
  const v1 = `${root}/cpu`;
  const q = read(`${v1}/cpu.cfs_quota_us`);
  const p = read(`${v1}/cpu.cfs_period_us`);
  const s = read(`${v1}/cpu.stat`);
  return q !== null && p !== null && s !== null ? parseCgroupV1(q, p, s) : null;
}

// What /readyz says about the process itself: event-loop delay and tick cost over a recent window, and the container's CPU quota.
// A throttled cgroup shows as bursts of delay with a low cpuSeconds, which the lifetime figures this replaces could not tell apart.
import fs from "node:fs";
import { monitorEventLoopDelay, PerformanceObserver } from "node:perf_hooks";

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

let gcTotalMs = 0;
let gcObserver: PerformanceObserver | null = null;

/** Milliseconds the process has spent in GC since the first call (the observer starts then). */
export function gcMsSoFar(): number {
  if (!gcObserver) {
    gcObserver = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) gcTotalMs += e.duration;
    });
    gcObserver.observe({ entryTypes: ["gc"] });
  }
  return gcTotalMs;
}

const RECENT_SLOW_TICKS = 30;
const WORST_SLOW_TICKS = 10;

/** Above this a wake's work is logged with its breakdown (one line a second at most). */
export const SLOW_TICK_MS = 25;

/** The one-line JSON record of a slow wake, rate-limited so a stall that repeats every tick does not flood the log. */
export class SlowTickLog {
  private lastAt = -Infinity;
  private suppressed = 0;
  /** The last lines written, oldest first, for /readyz. */
  readonly recent: Array<Record<string, unknown>> = [];
  /** The slowest wakes since the process started, slowest first, logged or not. */
  readonly worst: Array<Record<string, unknown> & { wakeMs: number }> = [];

  constructor(private readonly write: (line: string) => void = (l) => console.warn(l), readonly minGapMs = 1000) {}

  note(now: number, record: Record<string, unknown> & { wakeMs: number }): void {
    this.keepWorst({ at: new Date().toISOString(), ...record });
    if (now - this.lastAt < this.minGapMs) {
      this.suppressed++;
      return;
    }
    this.lastAt = now;
    const extra = this.suppressed > 0 ? { suppressed: this.suppressed } : {};
    this.suppressed = 0;
    const line = { at: new Date().toISOString(), ...record, ...extra };
    this.recent.push(line);
    if (this.recent.length > RECENT_SLOW_TICKS) this.recent.shift();
    this.write(`[slow-tick] ${JSON.stringify(line)}`);
  }

  private keepWorst(line: Record<string, unknown> & { wakeMs: number }): void {
    const w = this.worst;
    if (w.length >= WORST_SLOW_TICKS && line.wakeMs <= w[w.length - 1]!.wakeMs) return;
    let i = w.findIndex((x) => x.wakeMs < line.wakeMs);
    if (i < 0) i = w.length;
    w.splice(i, 0, line);
    if (w.length > WORST_SLOW_TICKS) w.pop();
  }
}

/** Shared by every room of the process, like tickStats. */
export const slowTickLog = new SlowTickLog();

/**
 * The host's CPU steal (time this VM's vCPUs were runnable but the hypervisor ran something else), sampled from /proc/stat once
 * a second: a slow wake with CPU close to wall and steal in the same second was slowed by the host, not by our code.
 */
export class StealSampler {
  private readonly samples: Array<{ at: number; stealS: number; totalS: number }> = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly read: () => string | null = readProcStat, readonly keepMs = 120_000) {}

  start(periodMs = 1000): void {
    if (this.timer || this.read() === null) return;
    this.sample();
    this.timer = setInterval(() => this.sample(), periodMs);
    this.timer.unref();
  }

  sample(at = performance.now()): void {
    const parsed = parseProcStatCpu(this.read());
    if (!parsed) return;
    this.samples.push({ at, ...parsed });
    while (this.samples.length > 2 && at - this.samples[0]!.at > this.keepMs) this.samples.shift();
  }

  /** Steal as a share of all CPU time between the sample at or before `sinceMs` ago and the newest; null without two samples. */
  stealPct(sinceMs: number, now = performance.now()): number | null {
    const s = this.samples;
    if (s.length < 2) return null;
    const last = s[s.length - 1]!;
    let first = s[0]!;
    for (const x of s) if (x.at <= now - sinceMs) first = x;
    if (first === last) first = s[s.length - 2]!;
    const total = last.totalS - first.totalS;
    return total > 0 ? round2((100 * (last.stealS - first.stealS)) / total) : 0;
  }

  /** Steal seconds summed over every CPU since boot (the newest sample), null where /proc/stat is absent. */
  stealSeconds(): number | null {
    const last = this.samples[this.samples.length - 1];
    return last ? round2(last.stealS) : null;
  }
}

function readProcStat(): string | null {
  try {
    return fs.readFileSync("/proc/stat", "utf8");
  } catch {
    return null;
  }
}

const USER_HZ = 100;

/** The aggregate `cpu` line of /proc/stat: steal is its 8th value; all values are in USER_HZ ticks. */
export function parseProcStatCpu(text: string | null): { stealS: number; totalS: number } | null {
  const line = text?.split("\n").find((l) => l.startsWith("cpu "));
  if (!line) return null;
  const v = line.trim().split(/\s+/).slice(1).map(Number);
  if (v.length < 8 || v.some((n) => !Number.isFinite(n))) return null;
  const total = v.slice(0, 8).reduce((a, b) => a + b, 0);
  return { stealS: v[7]! / USER_HZ, totalS: total / USER_HZ };
}

export const stealSampler = new StealSampler();

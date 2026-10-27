// Replays the patch arrivals netProbe recorded (`--trace`) through the client's render clocks at 144 Hz, to compare delay settings
// without running a game for each: the arrivals do not depend on the client, so the same trace feeds the legacy clock (a fixed
// 100 ms behind a clock that snaps on late patches) and every adaptive setting.
//   npx tsx packages/server/bench/netTraceEval.ts trace1.json [trace2.json ...] [--set '{"percentile":0.99}' ...]
// Per trace and setting: the delay drawn (mean, p95, max), starvation (frames where render time is past the newest patch: the
// buffer would hold and the fighter freeze), how far past (p99 / max, ms), the longest run, frames where render time ran
// backwards, and the render clock's speed over 1 s windows. Every moving fighter would be starved on a starved frame.
import fs from "node:fs";
import { RenderClock, ServerClock, INTERP_DELAY_MS, type RenderClockOptions } from "@raid/shared";

interface Setting { name: string; legacy?: boolean; opts?: Partial<RenderClockOptions> }

interface Row {
  /** Mean true lag: how far render time is behind the server time of the fastest path (the 99th percentile of server time minus arrival). */
  lagMean: number;
  name: string; delayMean: number; delayP95: number; delayMax: number;
  starvedPct: number; overP99: number; overMax: number; longestMs: number; backwards: number; speedMin: number; speedMax: number;
}

const FRAME = 1000 / 144;

export function evaluate(arrivals: number[][], s: Setting): Row {
  let legacyClock: ServerClock | null = null;
  let rc: RenderClock | null = null;
  if (s.legacy) legacyClock = new ServerClock();
  else rc = new RenderClock(s.opts ?? {});
  let pendingLegacy: { t: number; at: number } | null = null;
  const delays: number[] = [];
  const lags: number[] = [];
  const overs: number[] = [];
  const sBest = (() => {
    const v = arrivals.map(([at, t]) => t! - at!).sort((a, b) => a - b);
    return v[Math.floor(0.99 * v.length)]!;
  })();
  let starved = 0;
  let frames = 0;
  let run = 0;
  let runStart = 0;
  let longest = 0;
  let backwards = 0;
  let prevR = NaN;
  let prevNow = NaN;
  let winStart = NaN;
  let winStartR = NaN;
  let speedMin = Infinity;
  let speedMax = -Infinity;
  let newestT = -Infinity;
  let i = 0;
  const first = arrivals[0]![0]!;
  const last = arrivals[arrivals.length - 1]![0]!;
  // Skip the first seconds: the estimator warms up, and the first run of a session is not the steady state.
  const warm = first + 6000;
  for (let now = first; now <= last; now += FRAME) {
    while (i < arrivals.length && arrivals[i]![0]! <= now) {
      const [at, t] = arrivals[i]! as [number, number];
      if (rc) rc.onPatch(t, at);
      else if (!pendingLegacy || t > pendingLegacy.t) pendingLegacy = { t, at };
      if (t > newestT) newestT = t;
      i++;
    }
    let r: number;
    let delay: number;
    if (rc) {
      r = rc.renderTime(now);
      delay = rc.delayMs;
    } else {
      if (pendingLegacy) { legacyClock!.observe(pendingLegacy.t, pendingLegacy.at); pendingLegacy = null; }
      r = legacyClock!.renderTime(now);
      delay = INTERP_DELAY_MS;
    }
    if (now < warm) { prevR = r; prevNow = now; continue; }
    frames++;
    delays.push(delay);
    lags.push(now + sBest - r);
    if (Number.isFinite(prevR) && r < prevR) backwards++;
    if (!Number.isFinite(winStart)) { winStart = now; winStartR = r; }
    else if (now - winStart >= 1000) {
      const sp = (r - winStartR) / (now - winStart);
      speedMin = Math.min(speedMin, sp);
      speedMax = Math.max(speedMax, sp);
      winStart = now;
      winStartR = r;
    }
    prevR = r;
    prevNow = now;
    const over = r - newestT;
    if (over > 1e-6) {
      starved++;
      overs.push(over);
      if (run === 0) runStart = now;
      run++;
      longest = Math.max(longest, now - runStart);
    } else run = 0;
  }
  void prevNow;
  delays.sort((a, b) => a - b);
  overs.sort((a, b) => a - b);
  const q = (v: number[], p: number) => (v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))]! : 0);
  return {
    name: s.name, lagMean: lags.reduce((a, b) => a + b, 0) / Math.max(1, lags.length),
    delayMean: delays.reduce((a, b) => a + b, 0) / Math.max(1, delays.length), delayP95: q(delays, 0.95), delayMax: delays[delays.length - 1] ?? 0,
    starvedPct: (100 * starved) / Math.max(1, frames), overP99: q(overs, 0.99), overMax: overs[overs.length - 1] ?? 0, longestMs: longest,
    backwards, speedMin, speedMax,
  };
}

/**
 * What the arrivals would be if the server published a patch for every step it ran: a patch 100 ms of server time after the one
 * before (two ticks run in one callback, one patch sent) becomes two patches that arrive together.
 */
export function splitDoubles(arrivals: number[][]): number[][] {
  const out: number[][] = [];
  let prevT = NaN;
  for (const [at, t] of arrivals as Array<[number, number]>) {
    if (Number.isFinite(prevT) && t - prevT > 75 && t - prevT < 125) out.push([at, t - 50]);
    out.push([at, t]);
    prevT = t;
  }
  return out;
}

export function formatRow(r: Row): string {
  const f = (v: number, d = 1) => v.toFixed(d);
  return `${r.name.padEnd(34)} lag ${f(r.lagMean).padStart(5)} delay ${f(r.delayMean).padStart(5)} p95 ${f(r.delayP95).padStart(5)} max ${f(r.delayMax).padStart(5)}   ` +
    `starved ${f(r.starvedPct, 2).padStart(5)}%  over p99 ${f(r.overP99).padStart(5)} max ${f(r.overMax).padStart(5)}  longest ${f(r.longestMs).padStart(5)} ms   ` +
    `back ${String(r.backwards).padStart(3)}  speed ${f(r.speedMin, 3)}..${f(r.speedMax, 3)}`;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const files: string[] = [];
  let split = false;
  const sets: Setting[] = [{ name: "legacy (fixed 100, snapping)", legacy: true }, { name: "adaptive (defaults)", opts: {} }];
  const a = process.argv.slice(2);
  for (let k = 0; k < a.length; k++) {
    if (a[k] === "--split") split = true;
    else if (a[k] === "--set") {
      const o = JSON.parse(a[++k]!) as Partial<RenderClockOptions>;
      sets.push({ name: JSON.stringify(o).replace(/"/g, ""), opts: o });
    } else files.push(a[k]!);
  }
  for (const file of files) {
    const rep = JSON.parse(fs.readFileSync(file, "utf8")) as { label: string; traces?: number[][][] };
    console.log(`== ${rep.label} (${file})`);
    for (const s of sets) {
      // Each session separately: a session's arrivals run on their own clock.
      const rows = (rep.traces ?? []).filter((t) => t.length > 200).map((t) => evaluate(split ? splitDoubles(t) : t, s));
      if (rows.length === 0) continue;
      const w = rows.map((r) => 1);
      const sum = (g: (r: Row) => number) => rows.reduce((acc, r, k) => acc + g(r) * w[k]!, 0) / w.reduce((x, y) => x + y, 0);
      const merged: Row = {
        name: s.name, lagMean: sum((r) => r.lagMean), delayMean: sum((r) => r.delayMean), delayP95: sum((r) => r.delayP95), delayMax: Math.max(...rows.map((r) => r.delayMax)),
        starvedPct: sum((r) => r.starvedPct), overP99: sum((r) => r.overP99), overMax: Math.max(...rows.map((r) => r.overMax)),
        longestMs: Math.max(...rows.map((r) => r.longestMs)), backwards: rows.reduce((x, r) => x + r.backwards, 0),
        speedMin: Math.min(...rows.map((r) => r.speedMin)), speedMax: Math.max(...rows.map((r) => r.speedMax)),
      };
      console.log(formatRow(merged));
    }
  }
}

// Replays the patch arrivals netProbe recorded (`--trace`) through the client's render clocks at 144 Hz, to compare delay settings
// without running a game for each: the arrivals do not depend on the client, so the same trace feeds the legacy clock (a fixed
// 100 ms behind a clock that snaps on late patches) and every adaptive setting.
//   npx tsx packages/server/bench/netTraceEval.ts trace1.json [trace2.json ...] [--set '{"percentile":0.99}' ...]
// Per trace and setting: the delay drawn (mean, p95, max), starvation (frames where render time is past the newest patch: the
// buffer would hold and the fighter freeze), how far past (p99 / max, ms), the longest run, frames where render time ran
// backwards, and the render clock's speed over 1 s windows. Every moving fighter would be starved on a starved frame.
// `fx wait`: from each patch's arrival to the first frame whose render time reaches its server time, the wait an fx played at render
// time pays after its step's batch arrived; `patch wait` is the same to the first frame after the arrival, what an fx presented with
// its state patch pays (RaidScene's confirmed hits on the local player and its own melee blows).
//
// `--drawahead` replays trace v2 (netProbe --trace: `fighterTraces`, the remote fighters' patches and fx) through two arms of the
// client's own draw-ahead (client net/remoteDraw.ts), off and on, at each rate of `--hz` (default 60,144), and scores them with
// drawAheadScore.ts as netProbe does live: per session a row, then the merged arms and the acceptance gates' verdict. The same
// arrivals feed both arms, so the comparison is paired and deterministic. `--set` tunes the RenderClock of both arms (one replay per
// setting), `--ahead '{"heldMoverMs":25}'` the on arm's RemoteDrawOptions (one replay per --ahead).
//   npx tsx packages/server/bench/netTraceEval.ts --drawahead run.json [--hz 60,144] [--ahead '{"heldMoverMs":25}'] [--set '{...}']
import fs from "node:fs";
import {
  generateMap, RenderClock, ServerClock, INTERP_DELAY_MS, withGates, type GameMap, type RenderClockOptions, type TimedFx,
} from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { EntityInterpolator } from "../../client/src/net/interpolation";
import { RemoteDraw, type RemoteDrawOptions } from "../../client/src/net/remoteDraw";
import { DrawAheadRig, DrawAheadScorer, formatArm, verdict } from "./drawAheadScore";
import type { FighterTrace } from "./netProbe";

interface Setting { name: string; legacy?: boolean; opts?: Partial<RenderClockOptions> }

interface Row {
  /** Mean true lag: how far render time is behind the server time of the fastest path (the 99th percentile of server time minus arrival). */
  lagMean: number;
  name: string; delayMean: number; delayP95: number; delayMax: number;
  starvedPct: number; overP99: number; overMax: number; longestMs: number; backwards: number; speedMin: number; speedMax: number;
  fxWaitMean: number; fxWaitP95: number; patchWaitMean: number; patchWaitP95: number;
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
  const fxWaits: number[] = [];
  const patchWaits: number[] = [];
  /** Patches whose render time has not come yet: [arrival, server time]. */
  const waiting: Array<[number, number]> = [];
  for (let now = first; now <= last; now += FRAME) {
    while (i < arrivals.length && arrivals[i]![0]! <= now) {
      const [at, t] = arrivals[i]! as [number, number];
      if (rc) rc.onPatch(t, at);
      else if (!pendingLegacy || t > pendingLegacy.t) pendingLegacy = { t, at };
      if (t > newestT) newestT = t;
      if (at >= warm) { patchWaits.push(now - at); waiting.push([at, t]); }
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
    for (let k = waiting.length - 1; k >= 0; k--) {
      if (waiting[k]![1] > r) continue;
      fxWaits.push(now - waiting[k]![0]);
      waiting.splice(k, 1);
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
  fxWaits.sort((a, b) => a - b);
  patchWaits.sort((a, b) => a - b);
  const q = (v: number[], p: number) => (v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))]! : 0);
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
  return {
    fxWaitMean: mean(fxWaits), fxWaitP95: q(fxWaits, 0.95), patchWaitMean: mean(patchWaits), patchWaitP95: q(patchWaits, 0.95),
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
    `back ${String(r.backwards).padStart(3)}  speed ${f(r.speedMin, 3)}..${f(r.speedMax, 3)}   ` +
    `fx wait ${f(r.fxWaitMean).padStart(5)} p95 ${f(r.fxWaitP95).padStart(5)}  patch wait ${f(r.patchWaitMean).padStart(4)} p95 ${f(r.patchWaitP95).padStart(4)}`;
}

const maps = new Map<number, GameMap>();

/** The fake state a trace patch stands for: what the interpolator, the draw-ahead and the scorer read of it. */
function stateOf(row: FighterTrace["patches"][number]): RaidState {
  const [, t, gates, players, mobs] = row;
  const p = new Map(players.map(([id, x, y, displaceSeq, effects, alive, walkDir, walkTicks, locked]) => [id, {
    x, y, displaceSeq, effects, status: alive ? "alive" : "dead", attackTarget: locked ? "?" : "", extra: { walkDir, walkTicks },
  }]));
  const m = new Map(mobs.map(([id, x, y, displaceSeq, effects, alive, drawStartedAt]) => [id, {
    x, y, displaceSeq, effects, status: alive ? "alive" : "dead", drawStartedAt, kind: "mob",
  }]));
  return { serverTime: t, gatesLocked: gates === 1, players: p, mobs: m } as unknown as RaidState;
}

/**
 * Replays one session of trace v2 through an off and an on arm at `hz` (frames at exact intervals) into `scorer` (arms "off", "on").
 * The first `warmMs` (10 s) of the session warm the clocks and are not scored: a join often drives both delays to the ceiling, where
 * the arms are not paired, and the on arm takes a few seconds longer to come down from it (it has 50 ms further to go).
 */
export function replayDrawAhead(
  trace: FighterTrace, hz: number, scorer: DrawAheadScorer,
  opts: { render?: Partial<RenderClockOptions>; ahead?: Partial<RemoteDrawOptions>; warmMs?: number } = {},
): void {
  let map = maps.get(trace.seed);
  if (!map) { map = generateMap(trace.seed); maps.set(trace.seed, map); }
  const offInterp = new EntityInterpolator({ render: opts.render });
  const onInterp = new EntityInterpolator({ render: opts.render, drawAhead: true });
  const onDraw = new RemoteDraw(onInterp, opts.ahead);
  onDraw.setEnabled(true);
  const rig = new DrawAheadRig([
    { name: "off", interp: offInterp, draw: new RemoteDraw(offInterp), owned: true },
    { name: "on", interp: onInterp, draw: onDraw, owned: true },
  ], scorer, null, Infinity);
  const events: Array<{ at: number; fx?: TimedFx; patch?: FighterTrace["patches"][number] }> = [
    ...trace.fx.map(([at, fx]) => ({ at, fx })),
    ...trace.patches.map((row) => ({ at: row[0], patch: row })),
  ];
  // By arrival; an fx before a patch that arrived with it (the fx of a tick are sent before its patch).
  events.sort((a, b) => a.at - b.at || (a.fx ? 0 : 1) - (b.fx ? 0 : 1));
  if (events.length === 0) return;
  const frame = 1000 / hz;
  const first = events[0]!.at;
  const last = events[events.length - 1]!.at;
  const warm = first + (opts.warmMs ?? 10_000);
  let gates = false;
  let i = 0;
  for (let now = first; now <= last; now += frame) {
    while (i < events.length && events[i]!.at <= now) {
      const e = events[i++]!;
      if (e.fx) rig.onFx(e.fx);
      else if (e.patch) { gates = e.patch[2] === 1; rig.onPatch(stateOf(e.patch), e.at); }
    }
    rig.frame(now, frame, now >= warm, gates ? withGates(map) : map, trace.rttMs, () => undefined);
  }
  rig.endSession();
}

function drawAheadMain(files: string[], hzs: number[], sets: Array<{ name: string; opts?: Partial<RenderClockOptions> }>, aheads: Array<Partial<RemoteDrawOptions>>): void {
  const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "-");
  const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "-");
  for (const file of files) {
    const rep = JSON.parse(fs.readFileSync(file, "utf8")) as { label: string; fighterTraces?: FighterTrace[] };
    const traces = (rep.fighterTraces ?? []).filter((t) => t.patches.length > 200);
    console.log(`== ${rep.label} (${file}): ${traces.length} session(s) with fighter traces`);
    for (const set of sets) {
      for (const ahead of aheads) {
        for (const hz of hzs) {
          const label = `${hz} Hz ${set.name}${Object.keys(ahead).length ? ` ahead ${JSON.stringify(ahead).replace(/"/g, "")}` : ""}`;
          const merged = new DrawAheadScorer(["off", "on"], 1000 / hz);
          traces.forEach((trace, k) => {
            const one = new DrawAheadScorer(["off", "on"], 1000 / hz);
            replayDrawAhead(trace, hz, one, { render: set.opts, ahead });
            const on = one.report("on").players;
            const off = one.report("off").players;
            console.log(`  ${label} session ${k + 1} (rtt ${f1(trace.rttMs)} ms): age ${f1(off.ageMs.mean)} -> ${f1(on.ageMs.mean)} ms  ` +
              `err u ${f2(on.errU.mean)}/${f2(on.errU.p95)}/${f2(on.errU.p99)} (moving ${f2(on.errMovingU.mean)}/${f2(on.errMovingU.p95)}/${f2(on.errMovingU.p99)})  ` +
              `visible jumps ${f2(on.hindsightJumpCombatPct)}% of combat frames  held-moving ${f1(on.heldMovingPct)}%  frames ${on.frames}`);
            merged.merge(one);
          });
          const on = merged.report("on");
          const off = merged.report("off");
          for (const line of [...formatArm("off", off), ...formatArm("on", on), ...verdict(on, off, label).lines]) console.log(`  ${line}`);
        }
      }
    }
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const files: string[] = [];
  let split = false;
  let drawAhead = false;
  let hzs = [60, 144];
  const aheads: Array<Partial<RemoteDrawOptions>> = [];
  const extra: Array<{ name: string; opts: Partial<RenderClockOptions> }> = [];
  const sets: Setting[] = [{ name: "legacy (fixed 100, snapping)", legacy: true }, { name: "adaptive (defaults)", opts: {} }];
  const a = process.argv.slice(2);
  for (let k = 0; k < a.length; k++) {
    if (a[k] === "--split") split = true;
    else if (a[k] === "--drawahead") drawAhead = true;
    else if (a[k] === "--hz") hzs = a[++k]!.split(",").map(Number);
    else if (a[k] === "--ahead") aheads.push(JSON.parse(a[++k]!) as Partial<RemoteDrawOptions>);
    else if (a[k] === "--set") {
      const o = JSON.parse(a[++k]!) as Partial<RenderClockOptions>;
      sets.push({ name: JSON.stringify(o).replace(/"/g, ""), opts: o });
      extra.push({ name: JSON.stringify(o).replace(/"/g, ""), opts: o });
    } else files.push(a[k]!);
  }
  if (drawAhead) {
    drawAheadMain(files, hzs, [{ name: "defaults" }, ...extra], aheads.length > 0 ? [{}, ...aheads] : [{}]);
    process.exit(0);
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
        fxWaitMean: sum((r) => r.fxWaitMean), fxWaitP95: sum((r) => r.fxWaitP95),
        patchWaitMean: sum((r) => r.patchWaitMean), patchWaitP95: sum((r) => r.patchWaitP95),
      };
      console.log(formatRow(merged));
    }
  }
}

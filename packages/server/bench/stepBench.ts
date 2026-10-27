// Budget check for the Phase 11 tick: a headless 8-player run with 60 regional mobs, most players fighting mobs near
// their camps, arrows and balls in the air, mobs chasing and retreating. Reports the cost of one `step()`.
//   npx tsx packages/server/bench/stepBench.ts                       (from the repo root)
//   npx tsx packages/server/bench/stepBench.ts --buffs               every player starts with 4 stacks of every buff (R4a's gate)
//   npx tsx packages/server/bench/stepBench.ts --bots 8              8 in-process fill bots instead of the scripted players
// Flags: --seed N, --ticks N (measured, default 1200), --warmup N, --mobs N; with --bots also --tier easy|normal|hard (every bot),
// --coliseum (the endgame: all eight sealed in), --clock cpu|wall (default wall) and --repeat N (min / median / max over N runs).
// test/perf.test.ts runs the same scenarios against the gates.
//
// Two clocks for the scripted-player run. Wall time per step is what the CLI has always reported, but on a loaded machine (another
// test file, another process) a step that was preempted counts the wait too: 0.59 ms average and 8.8 ms p99 were seen against
// 0.15 and 0.43 unloaded. The gate therefore reads `gateMs`: per step, the smaller of the wall time and this thread's CPU time
// (process.threadCpuUsage, else process.cpuUsage), which a descheduled step does not accrue. A real regression adds work, so it
// raises both; a stall that is not the sim's own cost raises only the wall time. Where the CPU clock is too coarse to time one
// step (a probe at the start decides) the gate falls back to the wall time. A bots run is on the one clock `--clock` names.
//
// With `--bots N` the players are N fill bots seated by the BotManager in a headless room (bots/tournament/headlessRoom.ts, the
// Room's own tick order): no human, 60 mobs, nothing ends the run, a bot below half its hp is healed so none drops out of the
// measurement. One Room tick is timed as three stretches, whose sum is the whole tick the gate reads:
//   beforeStep  the due commands reach the bots' input queues
//   step        the sim step, plus the Room's own event routing and fx batch (what a Room does with or without bots)
//   afterPatch  every bot's frame: perceive, compose, memory, strategy, tactics, humanizer
// The bots' share is beforeStep + afterPatch. The first `warmup` ticks (200 with bots: JIT warm-up and the first path
// searches make them spike) are left out of the gated numbers and reported on their own.
import { BUFF_IDS, TICK_MS, mulberry32, type FactionId, type MobCampDef, type Vec2 } from "@raid/shared";
import { BOT_FILL_DEFAULTS, TIER_IDS, type TierId } from "../src/bots/brain/types";
import type { BotManagerStats } from "../src/bots/BotManager";
import { createHeadlessRoom, HEADLESS_CONFIG } from "../src/bots/tournament/headlessRoom";
import { grantBuff } from "../src/sim/buffs";
import { aggro } from "../src/sim/mobAI";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { placeMob } from "../src/sim/mobLife";
import { addPlayer, step } from "../src/sim/step";
import type { SimConfig, World } from "../src/sim/world";

/** The gates (docs/BOTS.md 9.2). */
export const AVG_BUDGET_MS = 5;
export const P99_BUDGET_MS = 15;
export const BOTS_SHARE_AVG_BUDGET_MS = 1.5;
export const BOTS_SHARE_P99_BUDGET_MS = 6;
/** Active ticks left out of the bots' gates (and reported on their own): the first frames run cold. */
export const BOTS_WARMUP_TICKS = 200;
/** The coliseum variant teleports at 10 s (tick 200); its window opens 10 s after the teleport. */
export const BOTS_COLISEUM_WARMUP_TICKS = 400;

export interface BenchOptions {
  seed?: number;
  players?: number;
  mobs?: number;
  /** Ticks measured after the warm-up. */
  ticks?: number;
  warmup?: number;
  /** In-process fill bots instead of scripted players (a human-less lineup of this many, at most 8). 0 / absent: the scripted players. */
  bots?: number;
  /** Fixes every bot's tier (the rest of the lineup is drawn from the fill config's mixes); absent: drawn. */
  botTier?: TierId;
  /**
   * Which clock times a bots run. "wall" (default) is elapsed time, which a busy machine inflates with spikes that are not ours;
   * "cpu" is the CPU time of this thread (`process.threadCpuUsage`, microsecond steps), which preemption by other processes
   * cannot add to. The gates in test/perf.test.ts read "cpu"; the scripted-player run has only the wall clock.
   */
  clock?: "wall" | "cpu";
  /** The endgame: the patience timer (10 s) sends everyone into the locked coliseum, where they fight each other with no mob awake. */
  coliseum?: boolean;
  /** Every player starts with 4 stacks of every buff (roguelike R4a's gate: all buffs on 8 players). `--buffs` on the CLI. */
  buffs?: boolean;
}

/** Milliseconds per tick (or per stretch of it). */
export interface TimingStats {
  avgMs: number;
  p50Ms: number;
  p99Ms: number;
  maxMs: number;
}

export interface BotsBench {
  bots: number;
  /** The clock the times below are on. */
  clock: "wall" | "cpu";
  /** The lineup the manager drew, as `tier/persona/faction`. */
  lineup: string[];
  /** Ticks left out of the stats below and reported in `warm`. */
  warmupTicks: number;
  /** The whole tick: beforeStep + step + afterPatch. This is what `BenchResult.avgMs` and friends are. */
  whole: TimingStats;
  /** The bots' share: beforeStep + afterPatch. */
  share: TimingStats;
  beforeStep: TimingStats;
  step: TimingStats;
  afterPatch: TimingStats;
  /** The warm-up window (the first `warmupTicks` active ticks, unwarmed JIT included). */
  warm: { wholeAvgMs: number; wholeMaxMs: number; shareAvgMs: number; shareMaxMs: number; worstTick: number };
  /** The worst single measured tick of the bots' share, and which tick it was. */
  worstShare: { ms: number; tick: number };
  /** Bots alive at the end, whether the coliseum gates were locked then, and the manager's counters over the whole run (warm-up included). */
  aliveBots: number;
  gatesLocked: boolean;
  manager: BotManagerStats;
  /** Commands the brains issued over the whole run, by type (so a feature module's casts show up). */
  commands: Record<string, number>;
}

export interface BenchResult extends TimingStats {
  ticks: number;
  mobs: number;
  /** Mean over the measured ticks of how many mobs were fighting, and of arrows and balls in flight. */
  avgFighting: number;
  avgProjectiles: number;
  /** Set for a bots run. avgMs, p50Ms, p99Ms and maxMs are then the whole tick; without bots they are the wall-clock cost of step(). */
  bots?: BotsBench;
  /** The CPU milliseconds per step() of the sim's thread, or null when the CPU clock is too coarse to time one step (a bots run: its whole tick when it ran on the cpu clock). */
  cpuMs: TimingStats | null;
  /** What the scripted-player gate reads: per step the smaller of the wall time and the CPU time (the wall time alone without a usable CPU clock). A bots run: its whole tick on its clock. */
  gateMs: TimingStats;
}

const NAMES = ["alice", "bob", "carol", "dave", "erin", "frank", "gina", "hank"];

function config(players: number): SimConfig {
  // Nothing ends the run while we measure: no teleport, no sudden death.
  return {
    minPlayers: players, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 1e6, patienceMinSeconds: 1e6,
    suddenDeathSeconds: 1e6, mobs: true,
  };
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

function allCamps(world: World): Array<{ region: FactionId; camp: MobCampDef }> {
  const out: Array<{ region: FactionId; camp: MobCampDef }> = [];
  for (const r of world.map.regions) for (const camp of r.mobCamps) out.push({ region: r.id, camp });
  return out;
}

/** Adds mobs next to camp spots (round robin) until there are `target`. */
function topUp(world: World, target: number, camps: ReturnType<typeof allCamps>, cursor: { i: number }): void {
  while (world.mobs.size < target && camps.length > 0) {
    const { region, camp } = camps[cursor.i++ % camps.length]!;
    const spot = camp.spots[cursor.i % camp.spots.length]!;
    const a = cursor.i * 2.4;
    placeMob(world, { region, elite: false, at: { x: spot.x + Math.cos(a) * 18, y: spot.y + Math.sin(a) * 18 } });
  }
}

function stats(times: readonly number[]): TimingStats {
  if (times.length === 0) return { avgMs: 0, p50Ms: 0, p99Ms: 0, maxMs: 0 };
  const sorted = [...times].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return {
    avgMs: times.reduce((a, b) => a + b, 0) / times.length,
    p50Ms: at(0.5),
    p99Ms: at(0.99),
    maxMs: sorted[sorted.length - 1]!,
  };
}

const wallMs = (): number => Number(process.hrtime.bigint()) / 1e6;
const cpuMs = (): number => {
  const u = process.threadCpuUsage();
  return (u.user + u.system) / 1000;
};

/** CPU time of the calling thread (the sim's), else of the whole process (its GC and compiler threads count too): the difference from `prev` when given. */
const cpuClock: (prev?: NodeJS.CpuUsage) => NodeJS.CpuUsage =
  (process as { threadCpuUsage?: (prev?: NodeJS.CpuUsage) => NodeJS.CpuUsage }).threadCpuUsage?.bind(process) ?? process.cpuUsage.bind(process);

/**
 * Can the CPU clock time one step? A ~0.3 ms spin must show a CPU delta between 0 and 0.5 ms on at least one of a few
 * tries: a clock that only advances by scheduler ticks (1 ms or more) never does.
 */
export function cpuClockIsFine(): boolean {
  for (let k = 0; k < 40; k++) {
    const c0 = cpuClock();
    const t0 = process.hrtime.bigint();
    while (process.hrtime.bigint() - t0 < 300_000n) { /* spin */ }
    const d = cpuClock(c0);
    const us = d.user + d.system;
    if (us > 0 && us < 500) return true;
  }
  return false;
}

export function runStepBench(opts: BenchOptions = {}): BenchResult {
  if ((opts.bots ?? 0) > 0) return runBotsBench(opts);
  const players = opts.players ?? 8;
  const targetMobs = opts.mobs ?? 60;
  const seed = opts.seed ?? 1;
  const world = createGameWorld({ seed, config: config(players), random: mulberry32(seed + 1) });
  for (let i = 0; i < players; i++) addPlayer(world, `p${i}`, NAMES[i]!);
  step(world, TICK_MS);
  if (world.state.phase !== "active") throw new Error("the bench run did not start");
  if (opts.buffs) {
    for (const [id, rt] of world.players) for (const b of BUFF_IDS) grantBuff(world, world.state.players.get(id)!, rt, b, 4);
  }

  const camps = allCamps(world);
  const cursor = { i: 0 };
  topUp(world, targetMobs, camps, cursor);

  // One player per camp, a little way out from the camp so mobs are in reach when they wake.
  const ids = [...world.players.keys()];
  ids.forEach((id, i) => {
    const camp = camps[(i * 2) % camps.length]!.camp;
    const p = world.state.players.get(id)!;
    p.x = camp.x - 70;
    p.y = camp.y;
    world.players.get(id)!.history = [{ t: world.state.serverTime, x: p.x, y: p.y }];
  });

  const times: number[] = [];
  const cpuTimes: number[] = [];
  const gateTimes: number[] = [];
  const cpuFine = cpuClockIsFine();
  let fighting = 0;
  let projectiles = 0;
  const warmup = opts.warmup ?? 100;
  const ticks = opts.ticks ?? 1200;

  for (let n = 0; n < warmup + ticks; n++) {
    topUp(world, targetMobs, camps, cursor);
    for (const id of ids) {
      const p = world.state.players.get(id)!;
      const rt = world.players.get(id)!;
      if (p.status !== "alive") continue;
      // The bench is about the sim's cost, not about who wins: nobody dies.
      p.hp = p.maxHp;
      let near: { x: number; y: number; id: string; d: number } | null = null;
      for (const [mid, m] of world.state.mobs) {
        if (m.status !== "alive") continue;
        const d = dist(p, m);
        if (!near || d < near.d) near = { x: m.x, y: m.y, id: mid, d };
      }
      if (!near) continue;
      const a = Math.atan2(near.y - p.y, near.x - p.x);
      rt.inputs.pushAim(a);
      if (n % 8 === 0) rt.inputs.pushAction({ kind: "attack", a });
      // A new walk every second or so keeps the pathfinder in the measurement.
      if (n % 25 === (ids.indexOf(id) * 3) % 25) rt.inputs.pushMove({ kind: "move", x: near.x - Math.cos(a) * 90, y: near.y - Math.sin(a) * 90 });
      if (n % 60 === 0 && near.d < 300) {
        const m = combatant(world, near.id);
        if (m?.kind === "mob" && m.s.kind !== "dummy") aggro(world, m, id, 1);
      }
    }
    const c0 = cpuClock();
    const t0 = process.hrtime.bigint();
    step(world, TICK_MS);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const cd = cpuClock(c0);
    const cpu = (cd.user + cd.system) / 1000;
    if (n >= warmup) {
      times.push(ms);
      cpuTimes.push(cpu);
      gateTimes.push(cpuFine ? Math.min(ms, cpu) : ms);
      projectiles += world.projectiles.size;
      for (const m of world.mobs.values()) if (m.brain?.mode === "fight") fighting++;
    }
  }

  return {
    ticks: times.length,
    mobs: world.mobs.size,
    avgFighting: fighting / times.length,
    avgProjectiles: projectiles / times.length,
    ...stats(times),
    cpuMs: cpuFine ? stats(cpuTimes) : null,
    gateMs: stats(gateTimes),
  };
}

/** The bots run: a human-less lineup in a headless room, every tick timed in its three stretches. */
function runBotsBench(opts: BenchOptions): BenchResult {
  const count = Math.min(8, Math.floor(opts.bots ?? 8));
  const targetMobs = opts.mobs ?? 60;
  const seed = opts.seed ?? 1;
  const coliseum = opts.coliseum === true;
  const warmup = opts.warmup ?? (coliseum ? BOTS_COLISEUM_WARMUP_TICKS : BOTS_WARMUP_TICKS);
  const ticks = opts.ticks ?? 1200;
  const patience = coliseum ? 10 : 1e6;
  // Older Node has no per-thread CPU clock: the run is then on the wall clock, and says so.
  const clock = opts.clock === "cpu" && typeof process.threadCpuUsage === "function" ? "cpu" : "wall";
  const nowMs = clock === "cpu" ? cpuMs : wallMs;
  const room = createHeadlessRoom({
    seed,
    // Nothing ends the run while we measure (sudden death never comes); the headless defaults are short timers for a tournament.
    config: { ...HEADLESS_CONFIG, patienceSeconds: patience, patienceMinSeconds: patience, suddenDeathSeconds: 1e6 },
    bots: { ...BOT_FILL_DEFAULTS, fillTo: count },
    lineup: Array.from({ length: count }, () => (opts.botTier ? { tier: opts.botTier } : {})),
  });
  const { world, manager } = room;

  // Stopwatches on the manager's two entry points; the stretch between them is the sim's.
  let beforeMs = 0;
  let afterMs = 0;
  let beforeEnd = 0;
  let afterStart = 0;
  const beforeStep = manager.beforeStep.bind(manager);
  const afterPatch = manager.afterPatch.bind(manager);
  manager.beforeStep = (t) => {
    const t0 = nowMs();
    beforeStep(t);
    beforeEnd = nowMs();
    beforeMs = beforeEnd - t0;
  };
  manager.afterPatch = (batches) => {
    afterStart = nowMs();
    afterPatch(batches);
    afterMs = nowMs() - afterStart;
  };

  const whole: number[] = [];
  const before: number[] = [];
  const sim: number[] = [];
  const after: number[] = [];
  const share: number[] = [];
  let camps: ReturnType<typeof allCamps> = [];
  const cursor = { i: 0 };
  let fighting = 0;
  let projectiles = 0;
  let measured = 0;

  for (let n = 0; n < warmup + ticks; n++) {
    if (n > 0) {
      topUp(world, targetMobs, camps, cursor);
      // The bench is about the cost of the tick, not about who wins: a bot below half its hp is healed.
      for (const p of world.state.players.values()) if (p.status === "alive" && p.hp < p.maxHp * 0.5) p.hp = p.maxHp;
    }
    const t0 = nowMs();
    room.tick();
    const total = nowMs() - t0;
    if (n === 0) {
      if (world.state.phase !== "active") throw new Error("the bench run did not start");
      camps = allCamps(world);
    }
    whole.push(total);
    before.push(beforeMs);
    sim.push(Math.max(0, afterStart - beforeEnd));
    after.push(afterMs);
    share.push(beforeMs + afterMs);
    if (n >= warmup) {
      measured++;
      projectiles += world.projectiles.size;
      for (const m of world.mobs.values()) if (m.brain?.mode === "fight") fighting++;
    }
  }

  const from = (xs: readonly number[]): readonly number[] => xs.slice(warmup);
  const warmWhole = whole.slice(0, warmup);
  const warmShare = share.slice(0, warmup);
  const worstShare = from(share).reduce((w, ms, i) => (ms > w.ms ? { ms, tick: warmup + i } : w), { ms: 0, tick: warmup });
  const warmMax = warmWhole.reduce((w, ms, i) => (ms > warmWhole[w]! ? i : w), 0);
  let alive = 0;
  for (const p of world.state.players.values()) if (p.status === "alive") alive++;
  const commands: Record<string, number> = {};
  for (const spec of room.seats) {
    for (const [type, n] of Object.entries(manager.brainOf(spec.id)?.stats.commands ?? {})) commands[type] = (commands[type] ?? 0) + n;
  }
  const avg = (xs: readonly number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  const wholeStats = stats(from(whole));

  return {
    ...wholeStats,
    ticks: measured,
    mobs: world.mobs.size,
    avgFighting: fighting / Math.max(1, measured),
    avgProjectiles: projectiles / Math.max(1, measured),
    cpuMs: clock === "cpu" ? wholeStats : null,
    gateMs: wholeStats,
    bots: {
      bots: count,
      clock,
      lineup: room.seats.map((s) => `${s.tier}/${s.persona}/${s.faction}`),
      warmupTicks: warmup,
      whole: wholeStats,
      share: stats(from(share)),
      beforeStep: stats(from(before)),
      step: stats(from(sim)),
      afterPatch: stats(from(after)),
      warm: {
        wholeAvgMs: avg(warmWhole), wholeMaxMs: Math.max(0, ...warmWhole), shareAvgMs: avg(warmShare), shareMaxMs: Math.max(0, ...warmShare),
        worstTick: warmMax,
      },
      worstShare,
      aliveBots: alive,
      gatesLocked: world.state.gatesLocked,
      manager: { ...manager.stats },
      commands,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------- the CLI

function argsOf(argv: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")) out[a.slice(2)] = argv[++i]!;
    else out[a.slice(2)] = "1";
  }
  return out;
}

const f = (n: number): string => n.toFixed(3);
const line = (label: string, s: TimingStats): string =>
  `  ${label.padEnd(11)} avg ${f(s.avgMs)}  p50 ${f(s.p50Ms)}  p99 ${f(s.p99Ms)}  max ${f(s.maxMs)} ms`;

function printBots(r: BenchResult): void {
  const b = r.bots!;
  console.log(
    `${r.ticks} ticks after a ${b.warmupTicks}-tick warm-up, ${b.bots} bots, ${r.mobs} mobs, ${r.avgFighting.toFixed(1)} fighting, ` +
    `${r.avgProjectiles.toFixed(1)} projectiles in flight, ${b.aliveBots} bots alive at the end, ${b.clock} clock` +
    `${b.gatesLocked ? ", coliseum gates locked" : ""}\n` +
    `  lineup: ${b.lineup.join(", ")}\n` +
    `${line("whole tick", b.whole)}   (gate: avg < ${AVG_BUDGET_MS}, p99 < ${P99_BUDGET_MS})\n` +
    `${line("bots' share", b.share)}   (gate: avg < ${BOTS_SHARE_AVG_BUDGET_MS}, p99 < ${BOTS_SHARE_P99_BUDGET_MS})\n` +
    `${line("beforeStep", b.beforeStep)}\n${line("step + room", b.step)}\n${line("afterPatch", b.afterPatch)}\n` +
    `  warm-up (first ${b.warmupTicks} ticks, not gated): whole avg ${f(b.warm.wholeAvgMs)} max ${f(b.warm.wholeMaxMs)} ms, ` +
    `bots' share avg ${f(b.warm.shareAvgMs)} max ${f(b.warm.shareMaxMs)} ms (worst tick ${b.warm.worstTick})\n` +
    `  worst bots' share after warm-up: ${f(b.worstShare.ms)} ms at tick ${b.worstShare.tick}\n` +
    `  manager: ${b.manager.frames} frames, ${b.manager.sent} commands sent, ${b.manager.applied} applied, ${b.manager.refused} refused, ` +
    `${b.manager.errors} errors\n` +
    `  commands: ${Object.entries(b.commands).filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n}`).join(", ")}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = argsOf(process.argv.slice(2));
  const botTier = args.tier as TierId | undefined;
  if (botTier !== undefined && !TIER_IDS.includes(botTier)) throw new Error(`--tier takes ${TIER_IDS.join(" | ")}`);
  const opts: BenchOptions = {
    ...(args.seed !== undefined ? { seed: Number(args.seed) } : {}),
    ...(args.ticks !== undefined ? { ticks: Number(args.ticks) } : {}),
    ...(args.warmup !== undefined ? { warmup: Number(args.warmup) } : {}),
    ...(args.mobs !== undefined ? { mobs: Number(args.mobs) } : {}),
    ...(args.bots !== undefined ? { bots: Number(args.bots) } : {}),
    ...(botTier ? { botTier } : {}),
    ...(args.coliseum !== undefined ? { coliseum: true } : {}),
    ...(args.buffs !== undefined ? { buffs: true } : {}),
    ...(args.clock === "cpu" || args.clock === "wall" ? { clock: args.clock } : {}),
  };
  const repeat = Math.max(1, Number(args.repeat ?? 1));
  const runs: BenchResult[] = [];
  for (let i = 0; i < repeat; i++) {
    const r = runStepBench(opts);
    runs.push(r);
    if (r.bots) {
      if (repeat > 1) console.log(`--- run ${i + 1} of ${repeat}`);
      printBots(r);
    } else {
      const row = (name: string, x: TimingStats): string => `${name}: avg ${f(x.avgMs)} ms, p50 ${f(x.p50Ms)} ms, p99 ${f(x.p99Ms)} ms, max ${f(x.maxMs)} ms`;
      console.log(
        `${r.ticks} ticks, ${r.mobs} mobs, ${r.avgFighting.toFixed(1)} fighting, ${r.avgProjectiles.toFixed(1)} projectiles in flight\n` +
        `${row("step() wall", r)}\n` +
        `${r.cpuMs ? row("step() cpu ", r.cpuMs) : "step() cpu : clock too coarse, the gate reads wall time"}\n` +
        `${row("step() gate ", r.gateMs)} (gate: avg < ${AVG_BUDGET_MS}, p99 < ${P99_BUDGET_MS}; the gate reads the smaller of wall and cpu per step)`,
      );
    }
  }
  if (repeat > 1) {
    const of = (pick: (r: BenchResult) => number): string => {
      const xs = runs.map(pick).sort((a, b) => a - b);
      return `min ${f(xs[0]!)}  median ${f(xs[Math.floor(xs.length / 2)]!)}  max ${f(xs[xs.length - 1]!)}`;
    };
    console.log(`=== over ${repeat} runs`);
    console.log(`  ${(runs[0]!.bots ? "whole tick" : "step()").padEnd(14)} avg: ${of((r) => r.avgMs)}   p99: ${of((r) => r.p99Ms)}`);
    if (runs[0]!.bots) {
      console.log(`  ${"bots' share".padEnd(14)} avg: ${of((r) => r.bots!.share.avgMs)}   p99: ${of((r) => r.bots!.share.p99Ms)}`);
    }
  }
}

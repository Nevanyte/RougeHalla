// Budget check for the Phase 11 tick: a headless 8-player run with 60 regional mobs, most players fighting mobs near
// their camps, arrows and balls in the air, mobs chasing and retreating. Reports the cost of one `step()`.
//   npx tsx bench/stepBench.ts            (from packages/server)
// test/perf.test.ts runs the same scenario against the gate (average < 5 ms, p99 < 15 ms per tick).
//
// Two clocks. Wall time per step is what the CLI has always reported, but on a loaded machine (another test file, another
// process) a step that was preempted counts the wait too: 0.59 ms average and 8.8 ms p99 were seen against 0.15 and 0.43
// unloaded. The gate therefore reads `gateMs`: per step, the smaller of the wall time and this thread's CPU time
// (process.threadCpuUsage, else process.cpuUsage), which a descheduled step does not accrue. A real regression adds work, so
// it raises both; a stall that is not the sim's own cost raises only the wall time. Where the CPU clock is too coarse to time
// one step (a probe at the start decides) the gate falls back to the wall time.
import { BUFF_IDS, TICK_MS, mulberry32, type FactionId, type MobCampDef, type Vec2 } from "@raid/shared";
import { grantBuff } from "../src/sim/buffs";
import { aggro } from "../src/sim/mobAI";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { placeMob } from "../src/sim/mobLife";
import { addPlayer, step } from "../src/sim/step";
import type { SimConfig, World } from "../src/sim/world";

export interface BenchOptions {
  seed?: number;
  players?: number;
  mobs?: number;
  /** Ticks measured after the warm-up. */
  ticks?: number;
  warmup?: number;
  /** Every player starts with 4 stacks of every buff (roguelike R4a's gate: all buffs on 8 players). `--buffs` on the CLI. */
  buffs?: boolean;
}

/** Milliseconds per step(): the mean, the median, the 99th percentile and the worst. */
export interface StepStats {
  avgMs: number;
  p50Ms: number;
  p99Ms: number;
  maxMs: number;
}

export interface BenchResult {
  ticks: number;
  mobs: number;
  /** Mean over the measured ticks of how many mobs were fighting, and of arrows and balls in flight. */
  avgFighting: number;
  avgProjectiles: number;
  /** Wall-clock milliseconds per step(). */
  avgMs: number;
  p50Ms: number;
  p99Ms: number;
  maxMs: number;
  /** The CPU milliseconds per step() of the sim's thread, or null when the CPU clock is too coarse to time one step. */
  cpuMs: StepStats | null;
  /** What the gate reads: per step the smaller of the wall time and the CPU time (the wall time alone without a usable CPU clock). */
  gateMs: StepStats;
}

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

function statsOf(samples: readonly number[]): StepStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return { avgMs: sorted.reduce((a, b) => a + b, 0) / sorted.length, p50Ms: at(0.5), p99Ms: at(0.99), maxMs: sorted[sorted.length - 1]! };
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

export function runStepBench(opts: BenchOptions = {}): BenchResult {
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

  const wall = statsOf(times);
  return {
    ticks: times.length,
    mobs: world.mobs.size,
    avgFighting: fighting / times.length,
    avgProjectiles: projectiles / times.length,
    ...wall,
    cpuMs: cpuFine ? statsOf(cpuTimes) : null,
    gateMs: statsOf(gateTimes),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runStepBench({ buffs: process.argv.includes("--buffs") });
  const f = (n: number): string => n.toFixed(3);
  const line = (name: string, x: StepStats): string => `${name}: avg ${f(x.avgMs)} ms, p50 ${f(x.p50Ms)} ms, p99 ${f(x.p99Ms)} ms, max ${f(x.maxMs)} ms`;
  console.log(
    `${r.ticks} ticks, ${r.mobs} mobs, ${r.avgFighting.toFixed(1)} fighting, ${r.avgProjectiles.toFixed(1)} projectiles in flight\n` +
    `${line("step() wall", r)}\n` +
    `${r.cpuMs ? line("step() cpu ", r.cpuMs) : "step() cpu : clock too coarse, the gate reads wall time"}\n` +
    `${line("step() gate ", r.gateMs)} (gate: avg < 5, p99 < 15; the gate reads the smaller of wall and cpu per step)`,
  );
}

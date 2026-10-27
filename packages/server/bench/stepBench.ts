// Budget check for the Phase 11 tick: a headless 8-player run with the map's regional mobs (20 camps of 3 to 5, about 80,
// roguelike R2), eight players fighting at eight camps, arrows and balls in the air, mobs chasing and retreating.
// Reports the cost of one `step()`.
//   npx tsx packages/server/bench/stepBench.ts                       (from the repo root; --cards, --stress, --quests)
//   npx tsx packages/server/bench/stepBench.ts --bots 8              8 in-process fill bots instead of the scripted players
// Flags: --seed N, --ticks N (measured, default 1200), --warmup N, --mobs N; with --bots also --tier easy|normal|hard (every bot),
// --coliseum (the endgame: all eight sealed in), --clock cpu|wall (default wall) and --repeat N (min / median / max over N runs).
// test/perf.test.ts runs the same scenarios against the gates (average < 5 ms, p99 < 15 ms per tick). Without --bots the CLI
// also runs the terrain variant (a hazard on every fourth floor tile, against the same map with the effects off;
// test/terrainPerf.test.ts).
//
// `--stress` is the worst case for the pathfinder: every mob of every camp is woken onto its nearest player once a second
// (a camp chasing for 12 tiles, giving up, walking home and waking again, so most of the 80 are in motion and repathing
// every MOB_REPATH_MS), and the players play like clients with the target lock: a `target` order every TARGET_REPATH_MS,
// alternating between their two nearest mobs, so every order is a lock change. test/pathLoad.test.ts counts the searches.
//
// With `--bots N` the players are N fill bots seated by the BotManager in a headless room (bots/tournament/headlessRoom.ts, the
// Room's own tick order): no human, the map's mobs, nothing ends the run, a bot below half its hp is healed so none drops out of
// the measurement. One Room tick is timed as three stretches, whose sum is the whole tick the gate reads:
//   beforeStep  the due commands reach the bots' input queues
//   step        the sim step, plus the Room's own event routing and fx batch (what a Room does with or without bots)
//   afterPatch  every bot's frame: perceive, compose, memory, strategy, tactics, humanizer
// The bots' share is beforeStep + afterPatch. The first `warmup` ticks (200 with bots: JIT warm-up and the first path
// searches make them spike) are left out of the gated numbers and reported on their own. A bots run is on the one clock
// `--clock` names.
import {
  CARDS, cardLive, generateMap, mulberry32, TARGET_REPATH_MS, TERRAIN_BOG, TERRAIN_EMBER, TERRAIN_ICE, TERRAIN_LIGHT, TICK_MS, TILE_FLOOR,
  type CampDef, type FactionId, type GameMap, type Vec2,
} from "@raid/shared";
import { BOT_FILL_DEFAULTS, TIER_IDS, type TierId } from "../src/bots/brain/types";
import type { BotManagerStats } from "../src/bots/BotManager";
import { createHeadlessRoom, HEADLESS_CONFIG } from "../src/bots/tournament/headlessRoom";
import { grantCard } from "../src/sim/chests";
import { aggro } from "../src/sim/mobAI";
import { combatant, type Combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
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
   * cannot add to. The bots' gates in test/perf.test.ts read "cpu"; the scripted-player run times both clocks (gateMs).
   */
  clock?: "wall" | "cpu";
  /** The endgame: the patience timer (10 s) sends everyone into the locked coliseum, where they fight each other with no mob awake. */
  coliseum?: boolean;
  /** Every player starts holding every live card once (R4a's gate, now the card build: the fold in sim/mods.ts with all its rows on 8 players). `--cards` on the CLI. */
  cards?: boolean;
  /** Quest offers, givers and items (the shipped default, off here unless asked). `--quests` on the CLI; with `--bots` too (the bots do not take quests). */
  quests?: boolean;
  /** The pathfinder's worst case: every camp woken every second, players re-locking every TARGET_REPATH_MS (see the header). `--stress` on the CLI. */
  stress?: boolean;
  /**
   * "heavy": the generated map with a hazard on every fourth floor tile (ember, bog, ice and light in turn), camps and spawns
   * included: the terrain passes at their worst. `hazards: false` plays the same map with the effects off (the control).
   */
  terrain?: "heavy";
  hazards?: boolean;
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

export interface BenchResult {
  ticks: number;
  mobs: number;
  /** Quest offers in the synced state at the end (0 with quests off): the run is only a quests run when this is above 0. */
  quests: number;
  /** Mean over the measured ticks of how many mobs were fighting, how many were awake (fighting or walking home), and of arrows and balls in flight. */
  avgFighting: number;
  avgAwake: number;
  /** Mean number of players holding a target lock (the stress scenario's players re-lock every TARGET_REPATH_MS). */
  avgLocked: number;
  avgProjectiles: number;
  /** Wall-clock milliseconds per step(). */
  avgMs: number;
  p50Ms: number;
  p99Ms: number;
  maxMs: number;
  /**
   * The same per step() in CPU milliseconds (`process.cpuUsage`, user + system of every thread of the process). A machine
   * busy with other work preempts the process in the middle of a step, which wall time counts and CPU time does not; CPU
   * time in turn counts the JIT and GC threads, so it reads higher than wall time on a quiet machine. A gate that must hold
   * in both worlds takes the smaller of the two (`gateMs`).
   */
  cpuAvgMs: number;
  cpuP99Ms: number;
  /** Set for a bots run. avgMs, p50Ms, p99Ms and maxMs (and the cpu pair) are then the whole tick on its clock. */
  bots?: BotsBench;
  /** Fighter-seconds each hazard acted on (world.hazards.stats): all zero on a map without terrain or with the effects off. */
  hazardSeconds: { ember: number; bog: number; ice: number; light: number };
  /** Mean milliseconds per tick of the burn and light passes, timed on their own (the terrain variant only). */
  passMs: { burn: number; light: number } | null;
}

/** The step cost a gate should judge: the smaller of the wall-clock and the CPU measure (see BenchResult.cpuAvgMs). */
export function gateMs(r: BenchResult): { avg: number; p99: number } {
  return { avg: Math.min(r.avgMs, r.cpuAvgMs), p99: Math.min(r.p99Ms, r.cpuP99Ms) };
}

const NAMES = ["alice", "bob", "carol", "dave", "erin", "frank", "gina", "hank"];

function config(players: number, quests: boolean): SimConfig {
  // Nothing ends the run while we measure: no teleport, no sudden death.
  return {
    minPlayers: players, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 1e6, patienceMinSeconds: 1e6,
    suddenDeathSeconds: 1e6, mobs: true, quests,
  };
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
/** A camp mob, not a quest giver (quests add `kind: "quest"` mobs to world.mobs; the benches fight and count camp mobs only). */
const isRegionalMob = (m: { kind: string }): boolean => m.kind === "mob" || m.kind === "elite";

/** The camp mobs in the world (quest givers left out). */
function regionalCount(world: World): number {
  let n = 0;
  for (const m of world.state.mobs.values()) if (isRegionalMob(m)) n++;
  return n;
}

/** Ticks between the wake-ups (a mob already fighting just gains threat). */
const WAKE_TICKS = 20;

/** The map of `seed` with a hazard on every fourth floor tile (a diagonal lattice), the four kinds in turn by 2 x 2 block. */
export function heavyTerrainMap(seed: number): GameMap {
  const map = generateMap(seed);
  const terrain = new Uint8Array(map.w * map.h);
  const kinds = [TERRAIN_EMBER, TERRAIN_BOG, TERRAIN_ICE, TERRAIN_LIGHT];
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const i = y * map.w + x;
      if (map.tiles[i] === TILE_FLOOR && (x + 2 * y) % 4 === 0) terrain[i] = kinds[((x >> 1) + (y >> 1)) & 3]!;
    }
  }
  return { ...map, terrain };
}

/** Wraps the system called `name` in `list` so its time is summed into `acc`. */
function timePass(list: Array<(w: World, dtMs: number) => void>, name: string, acc: { ms: number }): void {
  const i = list.findIndex((f) => f.name === name);
  if (i < 0) return;
  const inner = list[i]!;
  list[i] = (w, dt) => {
    const t0 = process.hrtime.bigint();
    inner(w, dt);
    acc.ms += Number(process.hrtime.bigint() - t0) / 1e6;
  };
}

interface BenchCamp { region: FactionId; camp: CampDef }

function allCamps(world: World): BenchCamp[] {
  return world.map.camps.map((camp) => ({ region: camp.zone, camp }));
}

/**
 * Adds mobs next to camp spots (round robin) until there are `target`. A replacement stands 18 u off a spot, inside the
 * clearing and so inside the camp's territory, and carries the camp's reference, so it leashes like the shipped mobs.
 */
function topUp(world: World, target: number, camps: BenchCamp[], cursor: { i: number }): void {
  let count = regionalCount(world);
  while (count < target && camps.length > 0) {
    const ci = cursor.i++ % camps.length;
    const { region, camp } = camps[ci]!;
    const spot = camp.spots[cursor.i % camp.spots.length]!;
    const a = cursor.i * 2.4;
    placeMob(world, { region, elite: false, at: { x: spot.x + Math.cos(a) * 18, y: spot.y + Math.sin(a) * 18 }, camp: ci });
    count++;
  }
}

interface Near { x: number; y: number; id: string; d: number }

/** The two live mobs nearest to `p`, nearest first. */
function nearestTwo(world: World, p: Vec2): [Near | null, Near | null] {
  let a: Near | null = null;
  let b: Near | null = null;
  for (const [mid, m] of world.state.mobs) {
    if (!isRegionalMob(m) || m.status !== "alive") continue;
    const d = dist(p, m);
    if (!a || d < a.d) {
      b = a;
      a = { x: m.x, y: m.y, id: mid, d };
    } else if (!b || d < b.d) b = { x: m.x, y: m.y, id: mid, d };
  }
  return [a, b];
}

/** Stress: once per WAKE_TICKS every idle mob turns on its nearest player, wherever that is. */
function wakeEverything(world: World, ids: string[]): void {
  if (world.state.tick % WAKE_TICKS !== 0) return;
  for (const [mid, m] of world.state.mobs) {
    const rt = world.mobs.get(mid);
    if (!isRegionalMob(m) || m.status !== "alive" || !rt?.brain || rt.brain.mode !== "idle") continue;
    let best: string | null = null;
    let bestD = Infinity;
    for (const id of ids) {
      const p = world.state.players.get(id)!;
      const d = dist(p, m);
      if (p.status === "alive" && d < bestD) {
        bestD = d;
        best = id;
      }
    }
    if (best !== null) aggro(world, { kind: "mob", id: mid, s: m, rt }, best, 1);
  }
}

export function runStepBench(opts: BenchOptions = {}): BenchResult {
  if ((opts.bots ?? 0) > 0) return runBotsBench(opts);
  const players = opts.players ?? 8;
  const seed = opts.seed ?? 1;
  const cfg = config(players, opts.quests === true);
  if (opts.hazards === false) cfg.hazards = false;
  const world = createGameWorld({
    seed, config: cfg, random: mulberry32(seed + 1), ...(opts.terrain === "heavy" ? { map: heavyTerrainMap(seed) } : {}),
  });
  const burn = { ms: 0 };
  const light = { ms: 0 };
  if (opts.terrain === "heavy") {
    timePass(world.beforeDamage, "burnPass", burn);
    timePass(world.systems, "lightPass", light);
  }
  // The map's own mobs (one per camp spot); a replacement is placed whenever the count falls below it.
  const targetMobs = opts.mobs ?? world.map.camps.reduce((n, c) => n + c.spots.length, 0);
  for (let i = 0; i < players; i++) addPlayer(world, `p${i}`, NAMES[i]!);
  step(world, TICK_MS);
  if (world.state.phase !== "active") throw new Error("the bench run did not start");
  if (opts.cards) {
    for (const id of world.players.keys()) {
      const c = combatant(world, id) as Extract<Combatant, { kind: "player" }>;
      for (const def of CARDS) if (cardLive(def)) grantCard(world, c, def.id);
    }
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
  const cpus: number[] = [];
  let fighting = 0;
  let awake = 0;
  let locked = 0;
  let projectiles = 0;
  const warmup = opts.warmup ?? 100;
  const ticks = opts.ticks ?? 1200;

  const stress = opts.stress === true;
  const campOf = new Map(ids.map((id, i) => [id, (i * 2) % camps.length]));

  for (let n = 0; n < warmup + ticks; n++) {
    topUp(world, targetMobs, camps, cursor);
    if (stress) wakeEverything(world, ids);
    for (const id of ids) {
      const p = world.state.players.get(id)!;
      const rt = world.players.get(id)!;
      if (p.status !== "alive") continue;
      // The bench is about the sim's cost, not about who wins: nobody dies.
      p.hp = p.maxHp;
      const [near, second] = nearestTwo(world, p);
      if (!near) continue;
      const a = Math.atan2(near.y - p.y, near.x - p.x);
      if (stress) {
        // The game client's way: a lock on one of the two nearest mobs every TARGET_REPATH_MS, alternating, so every order is a change.
        if (n % Math.round(TARGET_REPATH_MS / TICK_MS) === ids.indexOf(id) % 5) {
          const pick = (n / Math.round(TARGET_REPATH_MS / TICK_MS)) % 2 < 1 || !second ? near : second;
          enqueueClientMessage(rt.inputs, "target", { id: pick.id });
        }
        continue;
      }
      rt.inputs.pushAim(a);
      if (n % 8 === 0) rt.inputs.pushAction({ kind: "attack", a });
      // A new walk every second or so keeps the pathfinder in the measurement.
      if (n % 25 === (ids.indexOf(id) * 3) % 25) rt.inputs.pushMove({ kind: "move", x: near.x - Math.cos(a) * 90, y: near.y - Math.sin(a) * 90 });
      // Whole camps wake: every mob of the player's camp turns on it (a camp-mate hurt wakes the rest, D24).
      if (n % WAKE_TICKS === 0) {
        const ci = campOf.get(id)!;
        for (const [mid, m] of world.state.mobs) {
          if (m.camp !== ci + 1 || m.status !== "alive") continue;
          const mc = combatant(world, mid);
          if (mc?.kind === "mob" && mc.s.kind !== "dummy") aggro(world, mc, id, 1);
        }
      }
    }
    const cpu0 = process.cpuUsage();
    const t0 = process.hrtime.bigint();
    step(world, TICK_MS);
    const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
    const cpu = process.cpuUsage(cpu0);
    const ms = (cpu.user + cpu.system) / 1000;
    if (n === warmup - 1) { burn.ms = 0; light.ms = 0; }
    if (n >= warmup) {
      times.push(wallMs);
      cpus.push(ms);
      projectiles += world.projectiles.size;
      for (const rt of world.players.values()) if (rt.weapon.lock !== null) locked++;
      for (const m of world.mobs.values()) {
        if (m.brain?.mode === "fight") fighting++;
        if (m.brain !== undefined && m.brain.mode !== "idle") awake++;
      }
    }
  }

  const cpuAvgMs = cpus.reduce((a, b) => a + b, 0) / cpus.length;
  cpus.sort((a, b) => a - b);
  times.sort((a, b) => a - b);
  const at = (q: number): number => times[Math.min(times.length - 1, Math.floor(q * times.length))]!;
  return {
    ticks: times.length,
    mobs: world.mobs.size,
    quests: world.state.quests.size,
    avgFighting: fighting / times.length,
    avgAwake: awake / times.length,
    avgLocked: locked / times.length,
    avgProjectiles: projectiles / times.length,
    avgMs: times.reduce((a, b) => a + b, 0) / times.length,
    p50Ms: at(0.5),
    p99Ms: at(0.99),
    maxMs: times[times.length - 1]!,
    cpuAvgMs,
    cpuP99Ms: cpus[Math.min(cpus.length - 1, Math.floor(0.99 * cpus.length))]!,
    hazardSeconds: { ...world.hazards.stats.seconds },
    passMs: opts.terrain === "heavy" ? { burn: burn.ms / times.length, light: light.ms / times.length } : null,
  };
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

const wallNow = (): number => Number(process.hrtime.bigint()) / 1e6;
const cpuNow = (): number => {
  const u = process.threadCpuUsage();
  return (u.user + u.system) / 1000;
};

/** The bots run: a human-less lineup in a headless room, every tick timed in its three stretches. */
function runBotsBench(opts: BenchOptions): BenchResult {
  const count = Math.min(8, Math.floor(opts.bots ?? 8));
  const seed = opts.seed ?? 1;
  const coliseum = opts.coliseum === true;
  const warmup = opts.warmup ?? (coliseum ? BOTS_COLISEUM_WARMUP_TICKS : BOTS_WARMUP_TICKS);
  const ticks = opts.ticks ?? 1200;
  const patience = coliseum ? 10 : 1e6;
  // Older Node has no per-thread CPU clock: the run is then on the wall clock, and says so.
  const clock = opts.clock === "cpu" && typeof process.threadCpuUsage === "function" ? "cpu" : "wall";
  const nowMs = clock === "cpu" ? cpuNow : wallNow;
  const room = createHeadlessRoom({
    seed,
    // Nothing ends the run while we measure (sudden death never comes); the headless defaults are short timers for a tournament.
    config: { ...HEADLESS_CONFIG, patienceSeconds: patience, patienceMinSeconds: patience, suddenDeathSeconds: 1e6, quests: opts.quests === true },
    bots: { ...BOT_FILL_DEFAULTS, fillTo: count },
    lineup: Array.from({ length: count }, () => (opts.botTier ? { tier: opts.botTier } : {})),
  });
  const { world, manager } = room;
  // The map's own mobs (one per camp spot), as the scripted run keeps them.
  const targetMobs = opts.mobs ?? world.map.camps.reduce((n, c) => n + c.spots.length, 0);

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
  let awake = 0;
  let locked = 0;
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
      for (const rt of world.players.values()) if (rt.weapon.lock !== null) locked++;
      for (const m of world.mobs.values()) {
        if (m.brain?.mode === "fight") fighting++;
        if (m.brain !== undefined && m.brain.mode !== "idle") awake++;
      }
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
    quests: world.state.quests.size,
    avgFighting: fighting / Math.max(1, measured),
    avgAwake: awake / Math.max(1, measured),
    avgLocked: locked / Math.max(1, measured),
    avgProjectiles: projectiles / Math.max(1, measured),
    // One clock for a bots run: gateMs reads the whole tick on it.
    cpuAvgMs: wholeStats.avgMs,
    cpuP99Ms: wholeStats.p99Ms,
    hazardSeconds: { ...world.hazards.stats.seconds },
    passMs: null,
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

const f3 = (n: number): string => n.toFixed(3);
const line = (label: string, s: TimingStats): string =>
  `  ${label.padEnd(11)} avg ${f3(s.avgMs)}  p50 ${f3(s.p50Ms)}  p99 ${f3(s.p99Ms)}  max ${f3(s.maxMs)} ms`;

function printBots(r: BenchResult): void {
  const b = r.bots!;
  console.log(
    `${r.ticks} ticks after a ${b.warmupTicks}-tick warm-up, ${b.bots} bots, ${r.mobs} mobs (${r.quests} quest offers), ${r.avgFighting.toFixed(1)} fighting, ` +
    `${r.avgProjectiles.toFixed(1)} projectiles in flight, ${b.aliveBots} bots alive at the end, ${b.clock} clock` +
    `${b.gatesLocked ? ", coliseum gates locked" : ""}\n` +
    `  lineup: ${b.lineup.join(", ")}\n` +
    `${line("whole tick", b.whole)}   (gate: avg < ${AVG_BUDGET_MS}, p99 < ${P99_BUDGET_MS})\n` +
    `${line("bots' share", b.share)}   (gate: avg < ${BOTS_SHARE_AVG_BUDGET_MS}, p99 < ${BOTS_SHARE_P99_BUDGET_MS})\n` +
    `${line("beforeStep", b.beforeStep)}\n${line("step + room", b.step)}\n${line("afterPatch", b.afterPatch)}\n` +
    `  warm-up (first ${b.warmupTicks} ticks, not gated): whole avg ${f3(b.warm.wholeAvgMs)} max ${f3(b.warm.wholeMaxMs)} ms, ` +
    `bots' share avg ${f3(b.warm.shareAvgMs)} max ${f3(b.warm.shareMaxMs)} ms (worst tick ${b.warm.worstTick})\n` +
    `  worst bots' share after warm-up: ${f3(b.worstShare.ms)} ms at tick ${b.worstShare.tick}\n` +
    `  manager: ${b.manager.frames} frames, ${b.manager.sent} commands sent, ${b.manager.applied} applied, ${b.manager.refused} refused, ` +
    `${b.manager.errors} errors\n` +
    `  commands: ${Object.entries(b.commands).filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n}`).join(", ")}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = argsOf(process.argv.slice(2));
  const botTier = args.tier as TierId | undefined;
  if (botTier !== undefined && !TIER_IDS.includes(botTier)) throw new Error(`--tier takes ${TIER_IDS.join(" | ")}`);
  const cards = args.cards !== undefined;
  const opts: BenchOptions = {
    ...(args.seed !== undefined ? { seed: Number(args.seed) } : {}),
    ...(args.ticks !== undefined ? { ticks: Number(args.ticks) } : {}),
    ...(args.warmup !== undefined ? { warmup: Number(args.warmup) } : {}),
    ...(args.mobs !== undefined ? { mobs: Number(args.mobs) } : {}),
    ...(args.bots !== undefined ? { bots: Number(args.bots) } : {}),
    ...(botTier ? { botTier } : {}),
    ...(args.coliseum !== undefined ? { coliseum: true } : {}),
    ...(cards ? { cards: true } : {}),
    ...(args.stress !== undefined ? { stress: true } : {}),
    ...(args.quests !== undefined ? { quests: true } : {}),
    ...(args.clock === "cpu" || args.clock === "wall" ? { clock: args.clock } : {}),
  };
  const f = f3;
  const show = (tag: string, r: BenchResult): void => console.log(
    `${tag}${r.ticks} ticks, ${r.mobs} mobs (${r.quests} quest offers), ${r.avgFighting.toFixed(1)} fighting, ${r.avgAwake.toFixed(1)} awake, ${r.avgLocked.toFixed(1)} locked players, ${r.avgProjectiles.toFixed(1)} projectiles in flight\n` +
    `step(): avg ${f(r.avgMs)} ms, p50 ${f(r.p50Ms)} ms, p99 ${f(r.p99Ms)} ms, max ${f(r.maxMs)} ms (gate: avg < ${AVG_BUDGET_MS}, p99 < ${P99_BUDGET_MS})\n` +
    `step() CPU time: avg ${f(r.cpuAvgMs)} ms, p99 ${f(r.cpuP99Ms)} ms (every thread of the process; wall time is inflated while the machine is busy, CPU time by the JIT and GC threads)`,
  );
  const repeat = Math.max(1, Number(args.repeat ?? 1));
  const runs: BenchResult[] = [];
  for (let i = 0; i < repeat; i++) {
    const r = runStepBench(opts);
    runs.push(r);
    if (repeat > 1) console.log(`--- run ${i + 1} of ${repeat}`);
    if (r.bots) printBots(r);
    else show("", r);
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
  if (!runs[0]!.bots) {
    // The terrain variant: a hazard on every fourth floor tile, against the same map with the effects off.
    const quests = opts.quests === true;
    const heavy = runStepBench({ terrain: "heavy", cards, quests });
    const control = runStepBench({ terrain: "heavy", hazards: false, cards, quests });
    show("terrain (every 4th tile a hazard): ", heavy);
    show("terrain map, effects off (control):  ", control);
    const s = heavy.hazardSeconds;
    console.log(
      `terrain passes: burn ${f(heavy.passMs!.burn)} ms/tick, light ${f(heavy.passMs!.light)} ms/tick, all effects together ` +
      `${f(heavy.avgMs - control.avgMs)} ms/tick over the control (fighter-seconds on ember ${s.ember.toFixed(0)}, bog ${s.bog.toFixed(0)}, ice ${s.ice.toFixed(0)}, light ${s.light.toFixed(0)})`,
    );
  }
}

// Budget check for the Phase 11 tick: a headless 8-player run with the map's regional mobs (20 camps of 3 to 5, about 80,
// roguelike R2), eight players fighting at eight camps, arrows and balls in the air, mobs chasing and retreating.
// Reports the cost of one `step()`.
//   npx tsx bench/stepBench.ts            (from packages/server; --buffs, --stress)
// test/perf.test.ts runs the same scenarios against the gate (average < 5 ms, p99 < 15 ms per tick). The CLI also runs the
// terrain variant (a hazard on every fourth floor tile, against the same map with the effects off; test/terrainPerf.test.ts).
//
// `--stress` is the worst case for the pathfinder: every mob of every camp is woken onto its nearest player once a second
// (a camp chasing for 12 tiles, giving up, walking home and waking again, so most of the 80 are in motion and repathing
// every MOB_REPATH_MS), and the players play like clients with the target lock: a `target` order every TARGET_REPATH_MS,
// alternating between their two nearest mobs, so every order is a lock change. test/pathLoad.test.ts counts the searches.
import {
  BUFF_IDS, generateMap, mulberry32, TARGET_REPATH_MS, TERRAIN_BOG, TERRAIN_EMBER, TERRAIN_ICE, TERRAIN_LIGHT, TICK_MS, TILE_FLOOR,
  type CampDef, type FactionId, type GameMap, type Vec2,
} from "@raid/shared";
import { grantBuff } from "../src/sim/buffs";
import { aggro } from "../src/sim/mobAI";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
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
  /** The pathfinder's worst case: every camp woken every second, players re-locking every TARGET_REPATH_MS (see the header). `--stress` on the CLI. */
  stress?: boolean;
  /**
   * "heavy": the generated map with a hazard on every fourth floor tile (ember, bog, ice and light in turn), camps and spawns
   * included: the terrain passes at their worst. `hazards: false` plays the same map with the effects off (the control).
   */
  terrain?: "heavy";
  hazards?: boolean;
}

export interface BenchResult {
  ticks: number;
  mobs: number;
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

function config(players: number): SimConfig {
  // Nothing ends the run while we measure: no teleport, no sudden death.
  return {
    minPlayers: players, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 1e6, patienceMinSeconds: 1e6,
    suddenDeathSeconds: 1e6, mobs: true,
  };
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

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
  while (world.mobs.size < target && camps.length > 0) {
    const ci = cursor.i++ % camps.length;
    const { region, camp } = camps[ci]!;
    const spot = camp.spots[cursor.i % camp.spots.length]!;
    const a = cursor.i * 2.4;
    placeMob(world, { region, elite: false, at: { x: spot.x + Math.cos(a) * 18, y: spot.y + Math.sin(a) * 18 }, camp: ci });
  }
}

interface Near { x: number; y: number; id: string; d: number }

/** The two live mobs nearest to `p`, nearest first. */
function nearestTwo(world: World, p: Vec2): [Near | null, Near | null] {
  let a: Near | null = null;
  let b: Near | null = null;
  for (const [mid, m] of world.state.mobs) {
    if (m.status !== "alive") continue;
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
    if (m.status !== "alive" || !rt?.brain || rt.brain.mode !== "idle") continue;
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
  const players = opts.players ?? 8;
  const seed = opts.seed ?? 1;
  const cfg = config(players);
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const f = (n: number): string => n.toFixed(3);
  const show = (tag: string, r: BenchResult): void => console.log(
    `${tag}${r.ticks} ticks, ${r.mobs} mobs, ${r.avgFighting.toFixed(1)} fighting, ${r.avgAwake.toFixed(1)} awake, ${r.avgLocked.toFixed(1)} locked players, ${r.avgProjectiles.toFixed(1)} projectiles in flight\n` +
    `step(): avg ${f(r.avgMs)} ms, p50 ${f(r.p50Ms)} ms, p99 ${f(r.p99Ms)} ms, max ${f(r.maxMs)} ms (gate: avg < 5, p99 < 15)\n` +
    `step() CPU time: avg ${f(r.cpuAvgMs)} ms, p99 ${f(r.cpuP99Ms)} ms (every thread of the process; wall time is inflated while the machine is busy, CPU time by the JIT and GC threads)`,
  );
  const buffs = process.argv.includes("--buffs");
  show("", runStepBench({ buffs, stress: process.argv.includes("--stress") }));
  // The terrain variant: a hazard on every fourth floor tile, against the same map with the effects off.
  const heavy = runStepBench({ terrain: "heavy", buffs });
  const control = runStepBench({ terrain: "heavy", hazards: false, buffs });
  show("terrain (every 4th tile a hazard): ", heavy);
  show("terrain map, effects off (control):  ", control);
  const s = heavy.hazardSeconds;
  console.log(
    `terrain passes: burn ${f(heavy.passMs!.burn)} ms/tick, light ${f(heavy.passMs!.light)} ms/tick, all effects together ` +
    `${f(heavy.avgMs - control.avgMs)} ms/tick over the control (fighter-seconds on ember ${s.ember.toFixed(0)}, bog ${s.bog.toFixed(0)}, ice ${s.ice.toFixed(0)}, light ${s.light.toFixed(0)})`,
  );
}

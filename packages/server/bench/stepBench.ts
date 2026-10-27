// Budget check for the Phase 11 tick: a headless 8-player run with 60 regional mobs, most players fighting mobs near
// their camps, arrows and balls in the air, mobs chasing and retreating. Reports the cost of one `step()`.
//   npx tsx bench/stepBench.ts            (from packages/server)
// test/perf.test.ts runs the same scenario against the gate (average < 5 ms, p99 < 15 ms per tick).
import {
  BUFF_IDS, generateMap, mulberry32, TERRAIN_BOG, TERRAIN_EMBER, TERRAIN_ICE, TERRAIN_LIGHT, TICK_MS, TILE_FLOOR,
  type FactionId, type GameMap, type MobCampDef, type Vec2,
} from "@raid/shared";
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
  /** Mean over the measured ticks of how many mobs were fighting, and of arrows and balls in flight. */
  avgFighting: number;
  avgProjectiles: number;
  /** Milliseconds per step(). */
  avgMs: number;
  p50Ms: number;
  p99Ms: number;
  maxMs: number;
  /** Fighter-seconds each hazard acted on (world.hazards.stats): all zero on a map without terrain or with the effects off. */
  hazardSeconds: { ember: number; bog: number; ice: number; light: number };
  /** Mean milliseconds per tick of the burn and light passes, timed on their own (the terrain variant only). */
  passMs: { burn: number; light: number } | null;
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
    const t0 = process.hrtime.bigint();
    step(world, TICK_MS);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (n === warmup - 1) { burn.ms = 0; light.ms = 0; }
    if (n >= warmup) {
      times.push(ms);
      projectiles += world.projectiles.size;
      for (const m of world.mobs.values()) if (m.brain?.mode === "fight") fighting++;
    }
  }

  times.sort((a, b) => a - b);
  const at = (q: number): number => times[Math.min(times.length - 1, Math.floor(q * times.length))]!;
  return {
    ticks: times.length,
    mobs: world.mobs.size,
    avgFighting: fighting / times.length,
    avgProjectiles: projectiles / times.length,
    avgMs: times.reduce((a, b) => a + b, 0) / times.length,
    p50Ms: at(0.5),
    p99Ms: at(0.99),
    maxMs: times[times.length - 1]!,
    hazardSeconds: { ...world.hazards.stats.seconds },
    passMs: opts.terrain === "heavy" ? { burn: burn.ms / times.length, light: light.ms / times.length } : null,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const f = (n: number): string => n.toFixed(3);
  const show = (tag: string, r: BenchResult): void => console.log(
    `${tag}${r.ticks} ticks, ${r.mobs} mobs, ${r.avgFighting.toFixed(1)} fighting, ${r.avgProjectiles.toFixed(1)} projectiles in flight\n` +
    `step(): avg ${f(r.avgMs)} ms, p50 ${f(r.p50Ms)} ms, p99 ${f(r.p99Ms)} ms, max ${f(r.maxMs)} ms (gate: avg < 5, p99 < 15)`,
  );
  const buffs = process.argv.includes("--buffs");
  show("", runStepBench({ buffs }));
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

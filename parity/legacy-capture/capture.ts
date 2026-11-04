// Captures legacy (TypeScript) simulation scenarios as canonical JSON fixtures for the Rust parity harness.
//
//   npx tsx parity/legacy-capture/capture.ts [--out parity/fixtures]
//
// Each scenario runs the REAL legacy sim (createGameWorld + step, the same functions RaidRoom ticks) headless, on a hand-built
// map, with every nondeterministic input injected: `world.random` is mulberry32(randomSeed) so the secret order salt is fixed,
// and the reward salt is fixed. Client messages go through the real validator (enqueueClientMessage) and are recorded verbatim,
// so the Rust side replays exactly the same inputs. Nothing here changes legacy behaviour; it only reads state after each step.
//
// Fixture format "rh-legacy-scenario/1" (see parity/README.md):
//   map.rows      one string per tile row: '#' wall (TILE_WALL), '~' low (TILE_LOW), '.' floor
//   players       id, faction, starting x/y/hp after the run started (set by the scenario, history reset there)
//   inputs        {tick, player, type, msg}: enqueued just before step() makes state.tick == tick
//   ticks         per step: serverTime, every player's x, y, facing, hp, status, readyAt, and the canonical events
//   results       every `resolved` event's result (outcome, place, kills, killedBy, gv.total, players)
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FACTIONS, findPath, generateMap, mapFromTiles, mapHashU32, mulberry32, TICK_MS, TILE, TILE_FLOOR, TILE_LOW, TILE_WALL,
  type FactionId, type GameMap, type Vec2,
} from "@raid/shared";
import { createGameWorld } from "../../packages/server/src/sim/gameplay";
import { enqueueClientMessage } from "../../packages/server/src/sim/inputs";
import { addPlayer, removePlayer, step } from "../../packages/server/src/sim/step";
import type { SimEvent, World } from "../../packages/server/src/sim/world";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const outArg = process.argv.indexOf("--out");
const OUT = resolve(repo, outArg > 0 ? process.argv[outArg + 1]! : "parity/fixtures");

function revision(): string {
  try {
    const sha = execSync("git rev-parse HEAD", { cwd: repo }).toString().trim();
    const dirty = execSync("git status --porcelain -- packages", { cwd: repo }).toString().trim() !== "";
    return dirty ? `${sha}+dirty-packages` : sha;
  } catch { return "unknown"; }
}

function parseRows(rows: readonly string[]): GameMap {
  const h = rows.length;
  const w = rows[0]!.length;
  const tiles = new Uint8Array(w * h);
  rows.forEach((r, y) => {
    if (r.length !== w) throw new Error(`row ${y} has ${r.length} columns, expected ${w}`);
    for (let x = 0; x < w; x++) tiles[y * w + x] = r[x] === "#" ? TILE_WALL : r[x] === "~" ? TILE_LOW : TILE_FLOOR;
  });
  return mapFromTiles(w, h, tiles, 11);
}

function rowsOf(map: GameMap): string[] {
  const out: string[] = [];
  for (let y = 0; y < map.h; y++) {
    let s = "";
    for (let x = 0; x < map.w; x++) {
      const t = map.tiles[y * map.w + x]!;
      s += t === TILE_FLOOR ? "." : t === TILE_LOW ? "~" : "#";
    }
    out.push(s);
  }
  return out;
}

interface PlayerDef { id: string; faction: FactionId; at: Vec2; hp?: number; weapon0?: string }
interface Input { tick: number; player: string; type: string; msg: unknown }
interface Ctx { world: World; tick: number; send: (player: string, type: string, msg: unknown) => void; pos: (id: string) => Vec2 }
interface Scenario {
  name: string;
  description: string;
  /** Which parts the Rust slice is expected to reproduce (the harness reads this). */
  parity: "slice" | "capture-only";
  rows: string[];
  randomSeed: number;
  players: PlayerDef[];
  maxTicks: number;
  /** Called before each step with the tick about to run. */
  drive: (ctx: Ctx) => void;
  /** Extra per-tick hook after the step (e.g. remove a player between ticks, as a leave would). */
  after?: (ctx: Ctx) => void;
}

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;

function canonicalEvent(e: SimEvent): unknown | null {
  if (e.type === "resolved") return null; // reported in `results`
  if (e.type !== "fx") return e.type === "raidEnded" ? { kind: "raidEnded" } : null;
  const fx = e.fx;
  switch (fx.kind) {
    case "hit": return { kind: "hit", id: fx.id, by: fx.by, amount: r6(fx.amount), weapon: fx.weapon, ...(fx.sig ? { sig: fx.sig } : {}), ...(fx.passive ? { passive: true } : {}) };
    case "swing": return { kind: "swing", by: fx.by, weapon: fx.weapon, x: r6(fx.x), y: r6(fx.y), a: r6(fx.a) };
    case "death": return { kind: "death", id: fx.id, by: fx.by };
    case "victory": return { kind: "victory", id: fx.id, draw: fx.draw };
    case "windup": return { kind: "windup", by: fx.by, weapon: fx.weapon };
    case "block": return { kind: "block", id: fx.id, by: fx.by };
    case "stagger": return { kind: "stagger", id: fx.id };
    case "cancel": return { kind: "cancel", id: fx.id };
    default: return { kind: fx.kind };
  }
}

function run(sc: Scenario): unknown {
  const map = parseRows(sc.rows);
  const world = createGameWorld({
    seed: 11,
    map,
    config: {
      minPlayers: sc.players.length, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
      suddenDeathSeconds: 3600,
    },
    random: mulberry32(sc.randomSeed),
    rewardSalt: [1, 2, 3, 4],
    questSalt: [5, 6, 7, 8],
  }, { signatures: false, walkHints: false });
  for (const p of sc.players) {
    const s = addPlayer(world, p.id, p.id.toUpperCase(), { faction: p.faction });
    s.weapon0 = p.weapon0 ?? "";
  }
  // The lobby closes on the first step (minPlayers reached, fillSeconds 0): the run starts there.
  const startEvents = step(world, TICK_MS);
  if (world.state.phase !== "active") throw new Error(`${sc.name}: run did not start`);
  for (const p of sc.players) {
    const s = world.state.players.get(p.id)!;
    s.x = p.at.x;
    s.y = p.at.y;
    s.facing = 0;
    if (p.hp !== undefined) s.hp = p.hp;
    world.players.get(p.id)!.history = [{ t: world.state.serverTime, x: p.at.x, y: p.at.y }];
  }
  const inputs: Input[] = [];
  const ticks: unknown[] = [];
  const results: unknown[] = [];
  const unexpected = new Set<string>();
  const ctx: Ctx = {
    world,
    tick: 0,
    send: (player, type, msg) => {
      const rt = world.players.get(player);
      if (!rt) return;
      if (!enqueueClientMessage(rt.inputs, type, msg)) throw new Error(`${sc.name}: rejected ${type}`);
      inputs.push({ tick: ctx.tick, player, type, msg });
    },
    pos: (id) => { const s = world.state.players.get(id)!; return { x: s.x, y: s.y }; },
  };
  const startTick = world.state.tick;
  for (let i = 0; i < sc.maxTicks && world.state.phase === "active"; i++) {
    ctx.tick = world.state.tick + 1;
    sc.drive(ctx);
    const events = step(world, TICK_MS);
    sc.after?.(ctx);
    const evs: unknown[] = [];
    for (const e of events) {
      if (e.type === "resolved") {
        const r = e.result;
        results.push({ tick: ctx.tick, id: e.id, outcome: r.outcome, place: r.place, players: r.players, kills: r.kills, killedBy: r.killedBy, gvTotal: r.gv.total, gvWin: r.gv.win, gvKills: r.gv.kills });
        continue;
      }
      const c = canonicalEvent(e);
      if (c) evs.push(c);
      else if (e.type !== "gv" && e.type !== "toast") unexpected.add(e.type);
    }
    const players = [...world.state.players.entries()].map(([id, s]) => ({
      id, x: r6(s.x), y: r6(s.y), facing: r6(s.facing), hp: r6(s.hp), status: s.status, readyAt: r6(s.readyAt),
    }));
    ticks.push({ tick: ctx.tick, serverTime: world.state.serverTime, players, events: evs });
  }
  const mobs = world.state.mobs.size;
  return {
    format: "rh-legacy-scenario/1",
    scenario: sc.name,
    description: sc.description,
    parity: sc.parity,
    legacyRevision: revision(),
    legacyConfig: {
      world: "createGameWorld(signatures:false, walkHints:false), hand-built map, mobs/quests/hazards/regen off, pvpRules on (default), no cards",
      tickMs: TICK_MS,
      randomSeed: sc.randomSeed,
      orderSalt: world.orderSalt,
      startTick,
      startServerTime: startTick * TICK_MS,
      mobsPresent: mobs,
      startEvents: startEvents.map((e) => e.type),
      unexpectedEventTypes: [...unexpected],
    },
    map: { w: map.w, h: map.h, tile: TILE, rows: sc.rows },
    players: sc.players.map((p) => ({ id: p.id, faction: p.faction, x: p.at.x, y: p.at.y, hp: p.hp ?? FACTIONS[p.faction].hp, maxHp: FACTIONS[p.faction].hp, weapon0: p.weapon0 ?? "" })),
    inputs,
    ticks,
    results,
  };
}

// ---- maps ---------------------------------------------------------------------------------------------------------------
function boxRows(w: number, h: number, carve?: (x: number, y: number) => string | null): string[] {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let s = "";
    for (let x = 0; x < w; x++) {
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      s += edge ? "#" : carve?.(x, y) ?? ".";
    }
    rows.push(s);
  }
  return rows;
}

// A room with an L-shaped wall, a pillar block and a low fence: movement must path around walls and LOW tiles.
const WALLS = boxRows(32, 20, (x, y) => {
  if (x === 12 && y >= 3 && y <= 14) return "#";
  if (y === 14 && x >= 12 && x <= 20) return "#";
  if (x >= 22 && x <= 24 && y >= 5 && y <= 7) return "#";
  if (x === 6 && y >= 9 && y <= 16) return "~";
  return null;
});
const OPEN = boxRows(40, 20);
const ARENA = boxRows(30, 30, (x, y) => (x >= 13 && x <= 16 && y >= 13 && y <= 16 ? "#" : null));

const T = (tx: number, ty: number): Vec2 => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
const angle = (a: Vec2, b: Vec2): number => Math.atan2(b.y - a.y, b.x - a.x);
const dist = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

// ---- scenarios ----------------------------------------------------------------------------------------------------------
const SCENARIOS: Scenario[] = [
  {
    name: "movement_walls",
    description: "Two walkers path around an L wall, a pillar block and a LOW fence; a replacement order mid-walk, a stop, and a seq echo.",
    parity: "slice",
    rows: WALLS,
    randomSeed: 12,
    players: [{ id: "p0", faction: "fire", at: T(3, 3) }, { id: "p1", faction: "holy", at: T(3, 17) }],
    maxTicks: 220,
    drive: ({ tick, send }) => {
      const t0 = 2;
      if (tick === t0) send("p0", "move", { ...T(18, 10), seq: 1 });
      if (tick === t0) send("p1", "move", { ...T(28, 3), seq: 7 });
      if (tick === t0 + 40) send("p0", "move", { ...T(27, 17), seq: 2 });
      if (tick === t0 + 70) send("p1", "stop", { seq: 8 });
      if (tick === t0 + 80) send("p1", "move", { x: 9 * TILE + 3.25, y: 12 * TILE + 30.5, seq: 9 });
      if (tick === t0 + 120) send("p0", "move", { x: 12 * TILE + 16, y: 8 * TILE + 16 }); // into the wall: snaps to floor
      if (tick === t0 + 150) send("p1", "move", { x: -50, y: 99999 }); // clamped to the world, then snapped
    },
  },
  {
    name: "fists_duel",
    description: "Fire vs Holy on fists, standing in reach, both pressing a directional attack every tick with a 100 ms render lag, until one dies.",
    parity: "slice",
    rows: OPEN,
    randomSeed: 12,
    players: [{ id: "p0", faction: "fire", at: { x: 400, y: 320 } }, { id: "p1", faction: "holy", at: { x: 456, y: 320 } }],
    maxTicks: 1200,
    drive: ({ tick, send, pos, world }) => {
      const now = world.state.serverTime;
      if (tick < 3) return;
      send("p0", "attack", { a: angle(pos("p0"), pos("p1")), t: now - 100 });
      send("p1", "attack", { a: angle(pos("p1"), pos("p0")), t: now - 100 });
    },
  },
  {
    name: "duel_chase",
    description: "Plague chases a walking Frost: move orders toward the target and attack presses only when within fists reach (72 + 12).",
    parity: "slice",
    rows: OPEN,
    randomSeed: 99,
    players: [{ id: "p0", faction: "plague", at: { x: 200, y: 300 } }, { id: "p1", faction: "frost", at: { x: 420, y: 330 } }],
    maxTicks: 1600,
    drive: ({ tick, send, pos, world }) => {
      const now = world.state.serverTime;
      const a = pos("p0"), b = pos("p1");
      if (tick % 4 === 0) send("p0", "move", { x: b.x, y: b.y });
      if (tick === 3) send("p1", "move", { x: 1100, y: 330 });
      if (tick === 120) send("p1", "move", { x: 300, y: 500 });
      if (dist(a, b) < 80) send("p0", "attack", { a: angle(a, b), t: now - 75 });
      if (tick > 200 && dist(a, b) < 80) send("p1", "attack", { a: angle(b, a), t: now - 120 });
    },
  },
  {
    name: "simultaneous_lethal",
    description: "Both fighters at low hp hit each other in the same tick: both die; the higher hp fraction at tick start wins.",
    parity: "slice",
    rows: OPEN,
    randomSeed: 12,
    players: [{ id: "p0", faction: "holy", at: { x: 400, y: 320 }, hp: 10 }, { id: "p1", faction: "holy", at: { x: 450, y: 320 }, hp: 12 }],
    maxTicks: 20,
    drive: ({ tick, send, pos, world }) => {
      if (tick !== 3) return;
      const now = world.state.serverTime;
      send("p0", "attack", { a: angle(pos("p0"), pos("p1")), t: now - 50 });
      send("p1", "attack", { a: angle(pos("p1"), pos("p0")), t: now - 50 });
    },
  },
  {
    name: "simultaneous_draw",
    description: "Equal hp fractions, mutual lethal hits in one tick: a draw (place 1 each, no win bonus).",
    parity: "slice",
    rows: OPEN,
    randomSeed: 12,
    players: [{ id: "p0", faction: "holy", at: { x: 400, y: 320 }, hp: 10 }, { id: "p1", faction: "holy", at: { x: 450, y: 320 }, hp: 10 }],
    maxTicks: 20,
    drive: ({ tick, send, pos, world }) => {
      if (tick !== 3) return;
      const now = world.state.serverTime;
      send("p0", "attack", { a: angle(pos("p0"), pos("p1")), t: now - 50 });
      send("p1", "attack", { a: angle(pos("p1"), pos("p0")), t: now - 50 });
    },
  },
  {
    name: "rewind",
    description: "The target walks out of reach; an attack whose render time saw it in reach hits (rewind), the same swing at lag 50 ms misses.",
    parity: "slice",
    rows: OPEN,
    randomSeed: 12,
    players: [
      { id: "p0", faction: "sentenced", at: { x: 400, y: 320 } }, { id: "p1", faction: "frost", at: { x: 470, y: 320 } },
      { id: "p2", faction: "sentenced", at: { x: 400, y: 520 } }, { id: "p3", faction: "frost", at: { x: 470, y: 520 } },
    ],
    maxTicks: 40,
    drive: ({ tick, send, world }) => {
      const now = world.state.serverTime;
      if (tick === 3) { send("p1", "move", { x: 900, y: 320 }); send("p3", "move", { x: 900, y: 520 }); }
      // By tick 6 both targets are ~42 u farther: out of fists reach now, in reach 250 ms ago.
      if (tick === 6) { send("p0", "attack", { a: 0, t: now - 250 }); send("p2", "attack", { a: 0, t: now }); }
      if (tick === 7) { send("p0", "release", { a: 0 }); send("p2", "release", { a: 0 }); }
    },
  },
  {
    name: "crowded_8",
    description: "Eight fighters of all factions in a tight ring, each pressing at its nearest standing foe every tick: ordering, kill credit and simultaneous deaths.",
    parity: "slice",
    rows: ARENA,
    randomSeed: 4242,
    players: (["fire", "sentenced", "plague", "frost", "holy", "fire", "plague", "holy"] as FactionId[]).map((faction, i) => {
      const a = (i / 8) * Math.PI * 2;
      return { id: `p${i}`, faction, at: { x: 15 * TILE + Math.cos(a) * 170 - 120, y: 15 * TILE + Math.sin(a) * 170 - 300 } };
    }),
    maxTicks: 2400,
    drive: ({ tick, send, world }) => {
      if (tick < 3) return;
      const now = world.state.serverTime;
      const standing = [...world.state.players.entries()].filter(([, s]) => s.status === "alive");
      for (const [id, s] of standing) {
        let best: [string, number] | null = null;
        for (const [oid, o] of standing) {
          if (oid === id) continue;
          const d = Math.hypot(o.x - s.x, o.y - s.y);
          if (!best || d < best[1] || (d === best[1] && oid < best[0])) best = [oid, d];
        }
        if (!best) continue;
        const o = world.state.players.get(best[0])!;
        if (best[1] > 70) { if (tick % 5 === 0) send(id, "move", { x: o.x, y: o.y }); continue; }
        send(id, "attack", { a: Math.atan2(o.y - s.y, o.x - s.x), t: now - 100 });
      }
    },
  },
  {
    name: "leave_mia",
    description: "Three fighters; one leaves mid-run (MIA, removed between ticks as the Room does), then a duel decides the winner.",
    parity: "slice",
    rows: OPEN,
    randomSeed: 7,
    players: [{ id: "p0", faction: "frost", at: { x: 400, y: 320 } }, { id: "p1", faction: "plague", at: { x: 450, y: 320 } }, { id: "p2", faction: "sentenced", at: { x: 900, y: 320 } }],
    maxTicks: 2000,
    drive: ({ tick, send, pos, world }) => {
      if (tick < 3 || !world.state.players.has("p0") || !world.state.players.has("p1")) return;
      const now = world.state.serverTime;
      send("p0", "attack", { a: angle(pos("p0"), pos("p1")), t: now - 100 });
      send("p1", "attack", { a: angle(pos("p1"), pos("p0")), t: now - 100 });
    },
    after: ({ tick, world }) => { if (tick === 40) removePlayer(world, "p2"); },
  },
  {
    name: "bow_wand_capture",
    description: "CAPTURE ONLY (projectiles are not in the Rust slice yet): a bow and a wand fighter trade shots at range.",
    parity: "capture-only",
    rows: OPEN,
    randomSeed: 12,
    players: [{ id: "p0", faction: "sentenced", at: { x: 300, y: 320 }, weapon0: "bow" }, { id: "p1", faction: "holy", at: { x: 600, y: 330 }, weapon0: "wand" }],
    maxTicks: 1600,
    drive: ({ tick, send, pos, world }) => {
      if (tick < 3) return;
      const now = world.state.serverTime;
      send("p0", "attack", { a: angle(pos("p0"), pos("p1")), t: now - 100 });
      if (tick === 3) send("p1", "target", { id: "p0" });
    },
  },
];

// ---- pathfinding on a real generated map ---------------------------------------------------------------------------------
function pathfindingFixture(seed: number, queries: number): unknown {
  const map = generateMap(seed);
  const rng = mulberry32(seed ^ 0x51f15e);
  const floors: number[] = [];
  for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === TILE_FLOOR) floors.push(i);
  const pick = (): Vec2 => {
    const i = floors[Math.floor(rng() * floors.length)]!;
    return { x: (i % map.w) * TILE + 2 + rng() * (TILE - 4), y: Math.floor(i / map.w) * TILE + 2 + rng() * (TILE - 4) };
  };
  const out: unknown[] = [];
  for (let q = 0; q < queries; q++) {
    const from = pick();
    // A mix: random floor goals, raw points that may be in walls, and short hops.
    const kind = q % 3;
    const to = kind === 0 ? pick() : kind === 1 ? { x: rng() * map.w * TILE, y: rng() * map.h * TILE } : { x: from.x + (rng() - 0.5) * 400, y: from.y + (rng() - 0.5) * 400 };
    const path = findPath(map, from, to);
    out.push({ from: [from.x, from.y], to: [to.x, to.y], path: path.map((p) => [p.x, p.y]) });
  }
  return {
    format: "rh-legacy-pathfinding/1",
    legacyRevision: revision(),
    seed,
    attempt: map.attempt,
    mapHashU32: mapHashU32(map),
    map: { w: map.w, h: map.h, tile: TILE, rows: rowsOf(map) },
    radius: 12,
    queries: out,
  };
}

mkdirSync(OUT, { recursive: true });
const only = process.argv.indexOf("--only") > 0 ? process.argv[process.argv.indexOf("--only") + 1] : undefined;
for (const sc of SCENARIOS) {
  if (only && sc.name !== only) continue;
  const t0 = performance.now();
  const fx = run(sc) as { ticks: unknown[]; results: unknown[]; legacyConfig: { unexpectedEventTypes: string[]; mobsPresent: number } };
  writeFileSync(join(OUT, `${sc.name}.json`), JSON.stringify(fx));
  console.log(`${sc.name}: ${fx.ticks.length} ticks, ${fx.results.length} results, mobs ${fx.legacyConfig.mobsPresent}, unexpected [${fx.legacyConfig.unexpectedEventTypes.join(",")}] (${(performance.now() - t0).toFixed(0)} ms)`);
}
// The canonical public map for the Rust server and headless runner: the legacy generator's certified map of a seed, exported once
// (docs/adr/0003-canonical-map.md). The generator itself is not ported yet (docs/backlog P-MAP-1).
function exportMap(seed: number): unknown {
  const map = generateMap(seed);
  return {
    format: "rh-map/1", source: "legacy generateMap", legacyRevision: revision(), seed, attempt: map.attempt, mapHashU32: mapHashU32(map),
    w: map.w, h: map.h, tile: TILE, rows: rowsOf(map), spawns: map.spawnPool.map((s) => [s.x, s.y]),
  };
}

if (!only || only === "map") {
  mkdirSync(resolve(repo, "parity/maps"), { recursive: true });
  writeFileSync(resolve(repo, "parity/maps/seed1.map.json"), JSON.stringify(exportMap(1)));
  console.log("parity/maps/seed1.map.json written");
}
if (!only || only === "pathfinding") {
  const t0 = performance.now();
  writeFileSync(join(OUT, "pathfinding_seed1.json"), JSON.stringify(pathfindingFixture(1, 300)));
  console.log(`pathfinding_seed1: 300 queries (${(performance.now() - t0).toFixed(0)} ms)`);
}

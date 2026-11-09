// Actual-source walk-hint producer. Runs the real createGameWorld/addPlayer/step/enqueueClientMessage
// with walkHints enabled, a declared constructor map/roster/RNG stream, fixed 50 ms steps and ordinary
// Move/Stop orders. No private path/position/hint/status/clock assignment and no copied formula oracle.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGameWorld } from "/repo/packages/server/src/sim/gameplay.ts";
import { addPlayer, step } from "/repo/packages/server/src/sim/step.ts";
import { enqueueClientMessage } from "/repo/packages/server/src/sim/inputs.ts";
import { mapFromTiles, mulberry32, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, WALK_HINT_MAX_TICKS } from "@raid/shared";

const OUTPUT = process.env.RH_WALK_HINT_OUTPUT || "/out";
const MODE = process.env.RH_WALK_HINT_MODE || "capture";
const BASE = process.env.RH_WALK_HINT_BASE || "db5ed80b2b89a156eae09cd0bd3f4c9e77e9e6de";
const IMAGE = process.env.RH_WALK_HINT_IMAGE || "";
const SOURCE_FILES = [
  "packages/server/src/sim/walkHint.ts",
  "packages/server/src/sim/gameplay.ts",
  "packages/server/src/sim/step.ts",
  "packages/server/src/sim/inputs.ts",
  "packages/server/src/sim/movement.ts",
  "packages/server/src/sim/world.ts",
  "packages/shared/src/constants.ts",
  "packages/shared/src/walk.ts",
  "packages/shared/src/schema.ts",
];
function sha(s) { return createHash("sha256").update(s).digest("hex"); }
function json(v) { return v === undefined ? null : JSON.parse(JSON.stringify(v)); }
function span(source, marker) {
  const idx = source.indexOf(marker);
  if (idx < 0) throw new Error("missing source marker " + marker);
  const start = source.lastIndexOf("\n", idx) + 1;
  let braces = 0, seen = false, end = source.length;
  for (let i = idx; i < source.length; i++) {
    if (source[i] === "{") { braces++; seen = true; }
    else if (source[i] === "}") { braces--; if (seen && braces === 0) { end = i + 1; break; } }
  }
  const text = source.slice(start, end);
  return { startLine: source.slice(0, start).split("\n").length, endLine: source.slice(0, end).split("\n").length, bytes: Buffer.byteLength(text), sha256: sha(text) };
}
const WE = (ty, tx) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
const MAP_W = 64, MAP_H = 40, SEED = 7;
function makeMap() {
  const tiles = new Uint8Array(MAP_W * MAP_H).fill(TILE_FLOOR);
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1) tiles[y * MAP_W + x] = TILE_WALL;
  }
  const terrain = new Uint8Array(MAP_W * MAP_H);
  const map = mapFromTiles(MAP_W, MAP_H, tiles, 0, terrain);
  map.spawns = [WE(5, 5), WE(6, 5)];
  return { map, tiles, terrain };
}
const CONFIG = {
  minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 1e6, patienceMinSeconds: 1e6,
  suddenDeathSeconds: 1e6, planSeconds: 0, firstPatienceSeconds: 0, pvpRules: false, wishLockSeconds: 0,
};
function snapshot(world) {
  return {
    tick: world.state.tick, serverTime: world.state.serverTime, phase: world.state.phase, seed: world.state.seed, mapHash: world.state.mapHash,
    players: [...world.state.players].map(([id, p]) => {
      const rt = world.players.get(id);
      return {
        id, name: p.name, faction: p.faction, x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, status: p.status, facing: p.facing,
        weapon0: p.weapon0, weapon1: p.weapon1, speedMult: p.speedMult, asMult: p.asMult, windupMult: p.windupMult,
        extra: json(p.extra), path: rt.path.map((q) => ({ x: q.x, y: q.y })), weapon: json(rt.weapon), statuses: json(rt.statuses),
        history: rt.history.map((h) => ({ t: h.t, x: h.x, y: h.y })),
      };
    }),
  };
}
function order(world, type, msg) {
  const rt = world.players.get("p0");
  if (!rt) throw new Error("missing p0 runtime");
  const accepted = enqueueClientMessage(rt.inputs, type, msg);
  if (!accepted) throw new Error("source refused ordinary " + type + " order");
  return { type, msg, accepted };
}
function runScenario(recordRng) {
  const { map, tiles } = makeMap();
  const baseRng = mulberry32(SEED);
  const draws = [];
  const random = recordRng ? () => { const v = baseRng(); draws.push(v); return v; } : baseRng;
  let uid = 0;
  const world = createGameWorld({
    map, seed: map.seed, random, config: CONFIG, newItemUid: () => "u" + (uid++),
  }, { walkHints: true });
  addPlayer(world, "p0", "walk-hint-probe", { faction: "holy" });
  const setupEvents = step(world, TICK_MS);
  const setup = { events: setupEvents, draws: draws.slice(), snapshot: snapshot(world) };
  const drawAt = draws.length;
  const frames = [{ label: "setup-active", order: null, events: setupEvents, draws: [], snapshot: setup.snapshot }];
  const capture = (label, ord) => {
    const at = draws.length;
    const events = step(world, TICK_MS);
    frames.push({ label, order: ord, events, draws: recordRng ? draws.slice(at) : [], snapshot: snapshot(world) });
    return frames[frames.length - 1];
  };
  const player = () => world.state.players.get("p0");
  const p0 = () => player();
  const initial = capture("move-initial", order(world, "move", { x: p0().x + Math.cos(0.37) * 64, y: p0().y + Math.sin(0.37) * 64, seq: 1 }));
  const idle = capture("move-idle", null);
  const small = capture("move-small-turn", order(world, "move", { x: p0().x + Math.cos(0.37 + 0.017) * 64, y: p0().y + Math.sin(0.37 + 0.017) * 64, seq: 2 }));
  const large = capture("move-large-turn", order(world, "move", { x: p0().x + Math.cos(0.37 + 10 * Math.PI / 180) * 64, y: p0().y + Math.sin(0.37 + 10 * Math.PI / 180) * 64, seq: 3 }));
  const stop = capture("stop", order(world, "stop", { seq: 4 }));
  order(world, "move", { x: p0().x + Math.cos(0.37) * 64, y: p0().y + Math.sin(0.37) * 64, seq: 5 });
  const waypointFrames = [];
  for (let i = 0; i < 30; i++) {
    const f = capture("waypoint-" + i, null);
    waypointFrames.push(f);
    const rt = world.players.get("p0");
    if (rt.path.length === 0 && p0().extra.walkTicks === 0) break;
  }
  const last = frames[frames.length - 1];
  const hints = frames.map((f) => f.snapshot.players[0].extra.walkTicks);
  const dirs = frames.map((f) => f.snapshot.players[0].extra.walkDir);
  const issues = [];
  if (!(initial.snapshot.players[0].extra.walkTicks > 0)) issues.push("no positive hint after move");
  if (!(initial.snapshot.players[0].path.length > 0)) issues.push("no path after move");
  if (initial.snapshot.players[0].x === setup.snapshot.players[0].x && initial.snapshot.players[0].y === setup.snapshot.players[0].y) issues.push("no movement after move");
  if (!(initial.snapshot.players[0].extra.walkDir !== 0)) issues.push("walkDir zero after initial move");
  if (!hints.includes(WALK_HINT_MAX_TICKS)) issues.push("cap3 never reached");
  if (!(small.snapshot.players[0].extra.walkTicks > 0)) issues.push("small-turn hint inactive");
  if (small.snapshot.players[0].extra.walkDir !== initial.snapshot.players[0].extra.walkDir) issues.push("small-turn hysteresis changed walkDir");
  if (!(large.snapshot.players[0].extra.walkTicks > 0)) issues.push("large-turn hint inactive");
  if (large.snapshot.players[0].extra.walkDir === initial.snapshot.players[0].extra.walkDir) issues.push("large-turn heading did not transition");
  if (stop.snapshot.players[0].extra.walkTicks !== 0) issues.push("stop did not zero hint");
  if (stop.snapshot.players[0].path.length !== 0) issues.push("stop did not clear path");
  if (last.snapshot.players[0].extra.walkTicks !== 0 || last.snapshot.players[0].path.length !== 0) issues.push("waypoint end did not zero");
  if (!waypointFrames.some((f) => f.snapshot.players[0].extra.walkTicks > 0)) issues.push("waypoint approach was never hinted");
  const uniqueDirs = [...new Set(dirs)];
  return {
    frames, setup, issues, hints, uniqueDirs,
    summary: {
      initialHint: initial.snapshot.players[0].extra.walkTicks, initialDir: initial.snapshot.players[0].extra.walkDir,
      initialPathLength: initial.snapshot.players[0].path.length, capReached: hints.includes(WALK_HINT_MAX_TICKS),
      smallTurnDirStable: small.snapshot.players[0].extra.walkDir === initial.snapshot.players[0].extra.walkDir,
      largeTurnDirChanged: large.snapshot.players[0].extra.walkDir !== initial.snapshot.players[0].extra.walkDir,
      stopZero: stop.snapshot.players[0].extra.walkTicks === 0, waypointEndZero: last.snapshot.players[0].extra.walkTicks === 0,
      hintSequence: hints, dirSequence: dirs,
    },
  };
}
function sourceInfo() {
  const repo = "/repo";
  const files = {};
  for (const rel of SOURCE_FILES) {
    const text = readFileSync(join(repo, rel), "utf8");
    files[rel] = { bytes: Buffer.byteLength(text), sha256: sha(text) };
  }
  const walk = readFileSync(join(repo, SOURCE_FILES[0]), "utf8");
  const gameplay = readFileSync(join(repo, SOURCE_FILES[1]), "utf8");
  return {
    files,
    walkHint: {
      install: span(walk, "export function install(world: World)"),
      updateWalkHints: span(walk, "export function updateWalkHints(world: World)"),
      walkHintOf: span(walk, "export function walkHintOf(world: World"),
      zeroAll: span(walk, "function zeroAll(world: World)"),
    },
    gameplay: { createGameWorld: span(gameplay, "export function createGameWorld(opts: CreateOpts") },
    lock: readFileSync(join(repo, "package-lock.json"), "utf8").length > 0 ? sha(readFileSync(join(repo, "package-lock.json"), "utf8")) : null,
  };
}
export function runProbe() {
  const instrumented = runScenario(true);
  const replay = runScenario(false);
const stripRng = (frames) => frames.map((f) => ({ ...f, draws: undefined }));
const replayEqual = JSON.stringify(stripRng(instrumented.frames)) === JSON.stringify(stripRng(replay.frames));
const profile = {
  format: "rh-walk-hint-source/1",
  base: BASE,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  image: IMAGE,
  source: sourceInfo(),
  install: {
    systems: instrumented.setup.snapshot.players.length ? undefined : undefined,
    systemsAtSetup: undefined,
  },
  constructor: {
    createGameWorld: true,
    modules: { walkHints: true },
    map: { w: MAP_W, h: MAP_H, seed: 0, spawns: [WE(5, 5), WE(6, 5)], tiles: { bytes: MAP_W * MAP_H, sha256: sha(Buffer.from(makeMap().tiles)) } },
    config: CONFIG,
    random: { stream: "mulberry32", seed: SEED },
    roster: [{ id: "p0", profile: "walk-hint-probe", faction: "holy" }],
  },
  sourceOrder: "actual createGameWorld module order; walkHint install pushes updateWalkHints last and chains teleported/runEnded to zeroAll",
};
// Runtime installation names are obtained from the actual world.
{
  const { map } = makeMap();
  const rng = mulberry32(SEED);
  const w = createGameWorld({ map, seed: map.seed, random: rng, config: CONFIG, newItemUid: () => "probe" }, { walkHints: true });
  addPlayer(w, "p0", "install-probe", { faction: "holy" });
  const systems = w.systems.map((f) => f.name);
  profile.install = {
    systems,
    lastSystem: systems[systems.length - 1] ?? null,
    walkHintSystemLast: systems[systems.length - 1] === "updateWalkHints",
    actionKeys: Object.keys(w.actions).sort(),
    hookKeys: Object.keys(w.hooks).sort(),
  };
}
const corpus = {
  format: "rh-walk-hint-source/1",
  profile,
  setup: instrumented.setup,
  frames: instrumented.frames,
  replay: { equal: replayEqual, framesCompared: instrumented.frames.length, instrumentation: "random wrapper forwarded each source draw exactly once; disabled replay used raw mulberry32" },
  summary: instrumented.summary,
};

  return { corpus, instrumented, replay };
}

export function assertFacts(corpus) {
  const fail = (m) => { throw new Error(m); };
  if (!corpus || corpus.format !== "rh-walk-hint-source/1") fail("wrong format");
  if (!Array.isArray(corpus.frames) || corpus.frames.length < 6) fail("too few frames");
  const p0 = (f) => f.snapshot.players[0];
  const first = corpus.frames.find((f) => f.label === "move-initial");
  const small = corpus.frames.find((f) => f.label === "move-small-turn");
  const large = corpus.frames.find((f) => f.label === "move-large-turn");
  const stop = corpus.frames.find((f) => f.label === "stop");
  if (!first || !small || !large || !stop) fail("missing named frame");
  if (!(p0(first).extra.walkTicks > 0 && p0(first).path.length > 0)) fail("initial move did not produce hint/path");
  if (!(p0(first).extra.walkDir !== 0)) fail("initial walkDir is zero");
  if (!(p0(first).x !== corpus.setup.snapshot.players[0].x || p0(first).y !== corpus.setup.snapshot.players[0].y)) fail("no actual movement");
  if (!corpus.summary.capReached) fail("cap3 not reached");
  if (!(p0(small).extra.walkTicks > 0 && p0(small).extra.walkDir === p0(first).extra.walkDir)) fail("small-turn hysteresis not observed");
  if (!(p0(large).extra.walkTicks > 0 && p0(large).extra.walkDir !== p0(first).extra.walkDir)) fail("large-turn heading transition not observed");
  if (p0(stop).extra.walkTicks !== 0 || p0(stop).path.length !== 0) fail("stop did not zero");
  const last = corpus.frames[corpus.frames.length - 1];
  if (p0(last).extra.walkTicks !== 0 || p0(last).path.length !== 0) fail("waypoint end did not zero");
  if (!corpus.frames.some((f) => p0(f).extra.walkTicks > 0 && f.label.startsWith("waypoint-"))) fail("waypoint approach never hinted");
  if (!corpus.replay || corpus.replay.equal !== true) fail("instrumentation-disabled replay changed facts");
  for (const f of corpus.frames) {
    if (p0(f).extra.walkTicks > 3) fail("hint over cap at " + f.label);
    if (!Array.isArray(f.events)) fail("events missing at " + f.label);
    if (!Array.isArray(f.snapshot.players[0].path)) fail("path missing at " + f.label);
  }
}

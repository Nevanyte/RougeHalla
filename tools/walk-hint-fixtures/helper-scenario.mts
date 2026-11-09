// Declared HELPER contexts for the full source walkHint producer. Every observed value comes from the
// actual imported source (walkHintOf/weaponHoldsAt/updateWalkHints or installed hooks); inputs are
// explicit synthetic helper state, never earned World history or installed expected hints.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  mapFromTiles, mulberry32, encodeMult, MOVE_MULT_FLOOR, PLAYER_SPEED, TERRAIN_ICE, TICK_MS,
  WALK_HINT_MAX_TICKS, FACTIONS, mirrorTimings,
} from "@raid/shared";
import { createGameWorld } from "/repo/packages/server/src/sim/gameplay.ts";
import { addPlayer, step } from "/repo/packages/server/src/sim/step.ts";
import { enqueueClientMessage } from "/repo/packages/server/src/sim/inputs.ts";
import { addStatus } from "/repo/packages/server/src/sim/status.ts";
import { slipAccelAt } from "/repo/packages/server/src/sim/terrainEffects.ts";
import { activeWeapon, combatant, timingsOf } from "/repo/packages/server/src/sim/combatant.ts";
import { walkHintOf, weaponHoldsAt, updateWalkHints } from "/repo/packages/server/src/sim/walkHint.ts";
import { TIE_EPS_MS } from "/repo/packages/server/src/sim/weapons.ts";

const MAP_W = 64, MAP_H = 40, SEED = 7;
const BASE_CONFIG = {
  minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 1e6, patienceMinSeconds: 1e6,
  suddenDeathSeconds: 1e6, planSeconds: 0, firstPatienceSeconds: 0, pvpRules: false, wishLockSeconds: 0,
};
const SOURCE_FILES = [
  "packages/server/src/sim/walkHint.ts",
  "packages/server/src/sim/gameplay.ts",
  "packages/server/src/sim/step.ts",
  "packages/server/src/sim/inputs.ts",
  "packages/server/src/sim/status.ts",
  "packages/server/src/sim/terrainEffects.ts",
  "packages/server/src/sim/combatant.ts",
  "packages/server/src/sim/targeting.ts",
  "packages/server/src/sim/movement.ts",
  "packages/server/src/sim/world.ts",
  "packages/shared/src/constants.ts",
  "packages/shared/src/mods.ts",
  "packages/shared/src/weapons.ts",
  "packages/shared/src/factions.ts",
  "packages/shared/src/walk.ts",
  "packages/shared/src/status.ts",
  "packages/shared/src/terrain.ts",
];
function sha(s) { return createHash("sha256").update(s).digest("hex"); }
function json(v) { return v === undefined ? null : JSON.parse(JSON.stringify(v)); }
const at = (tx, ty) => ({ x: tx * 32 + 16, y: ty * 32 + 16 });
function makeMap(opts = {}) {
  const tiles = new Uint8Array(MAP_W * MAP_H).fill(0);
  const terrain = new Uint8Array(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1) tiles[y * MAP_W + x] = 1;
  }
  for (const [x, y] of opts.wall ?? []) tiles[y * MAP_W + x] = 1;
  for (const [x, y] of opts.ice ?? []) terrain[y * MAP_W + x] = TERRAIN_ICE;
  const map = mapFromTiles(MAP_W, MAP_H, tiles, 0, terrain);
  map.spawns = [at(5, 5), at(10, 5)];
  return { map, tiles, terrain };
}
function makeWorld(opts = {}) {
  const { map } = makeMap(opts);
  let draws = 0;
  const rnd = mulberry32(SEED);
  const random = () => { draws++; return rnd(); };
  const players = opts.players ?? 1;
  const world = createGameWorld({
    map, seed: 0, random, config: { ...BASE_CONFIG, minPlayers: players, ...(opts.hazardsAll ? { hazards: "all" } : {}) },
    newItemUid: (() => { let n = 0; return () => "u" + (n++); })(),
  }, { walkHints: true });
  for (let i = 0; i < players; i++) addPlayer(world, "p" + i, "helper-p" + i, { faction: i === 0 ? (opts.faction ?? "holy") : "frost" });
  const setupEvents = step(world, TICK_MS);
  world.events = [];
  return { world, draws: () => draws, setupEvents };
}
function put(world, id, x, y) {
  const p = world.state.players.get(id), rt = world.players.get(id);
  p.x = x; p.y = y; p.status = "alive"; rt.path = []; rt.slip = null;
  rt.history = [{ t: world.state.serverTime, x, y }];
  p.extra.walkTicks = 0; p.extra.walkDir = 0;
}
function path(world, id, points) { world.players.get(id).path = points.map((q) => ({ x: q.x, y: q.y })); }
function equip(world, id, weapon) {
  const p = world.state.players.get(id);
  p.weapon0 = weapon === "fists" ? "" : weapon; p.weapon1 = ""; p.slot = 0;
  const rt = world.players.get(id);
  rt.weapon.action = null; rt.weapon.rootUntil = 0; rt.weapon.held = false; rt.weapon.bufferedUntil = 0;
  rt.weapon.lock = null; rt.weapon.lockSeen = false; rt.weapon.lockLosLostAt = 0; rt.weapon.lockPlanAt = -Infinity;
  rt.weapon.lockGoal = null; rt.weapon.attackMoveGoal = null; rt.weapon.lastShotAt = -Infinity;
  if (weapon !== "fists") rt.weapon.lockSearchAt = -Infinity;
}
const C = (world, id) => combatant(world, id);
function hint(ctx) { return walkHintOf(ctx.world, C(ctx.world, "p0")); }
function observeHint(ctx) { ctx.world.events = []; const h = hint(ctx); return { kind: "walkHintOf", hint: { dir: h.dir, ticks: h.ticks } }; }
function run(id, family, setup, observe = observeHint) {
  try {
    const ctx = setup();
    ctx.world.events = [];
    const d0 = ctx.draws();
    const out = observe(ctx);
    return { id, family, helper: true, input: ctx.facts, observed: out, setupEvents: ctx.setupEvents, events: ctx.world.events.slice(), draws: ctx.draws() - d0 };
  } catch (error) {
    return { id, family, helper: true, error: String(error) };
  }
}
function adjacentDir(world, id) { return hint({ world }); }
export function runHelpers() {
  const cases = [];
  // gates / early exits
  cases.push(run("gate-phase-lobby", "gates", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); path(ctx.world, "p0", [{ x: 300, y: 200 }]);
    ctx.world.state.phase = "lobby";
    return { ...ctx, facts: { phase: "lobby", path: [{ x: 300, y: 200 }], extra: { walkTicks: 0, walkDir: 0 } } };
  }));
  cases.push(run("gate-phase-ended", "gates", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); path(ctx.world, "p0", [{ x: 300, y: 200 }]);
    ctx.world.state.phase = "ended";
    return { ...ctx, facts: { phase: "ended", path: [{ x: 300, y: 200 }] } };
  }));
  cases.push(run("gate-standing-dead", "gates", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); path(ctx.world, "p0", [{ x: 300, y: 200 }]);
    ctx.world.state.players.get("p0").status = "dead";
    return { ...ctx, facts: { status: "dead", path: [{ x: 300, y: 200 }] } };
  }));
  cases.push(run("gate-hidden", "gates", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); path(ctx.world, "p0", [{ x: 300, y: 200 }]);
    addStatus(ctx.world, C(ctx.world, "p0"), { kind: "hidden", source: { id: "helper", name: "helper" }, ms: 5000 });
    return { ...ctx, facts: { status: "hidden", path: [{ x: 300, y: 200 }] } };
  }));
  cases.push(run("gate-stun", "gates", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); path(ctx.world, "p0", [{ x: 300, y: 200 }]);
    addStatus(ctx.world, C(ctx.world, "p0"), { kind: "stun", source: { id: "helper", name: "helper" }, ms: 500 });
    return { ...ctx, facts: { status: "stun", path: [{ x: 300, y: 200 }] } };
  }));
  cases.push(run("gate-root", "gates", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); path(ctx.world, "p0", [{ x: 300, y: 200 }]);
    addStatus(ctx.world, C(ctx.world, "p0"), { kind: "root", source: { id: "helper", name: "helper" }, ms: 500 });
    return { ...ctx, facts: { status: "root", path: [{ x: 300, y: 200 }] } };
  }));
  cases.push(run("gate-slip-center", "gates", () => {
    const ctx = makeWorld({ ice: [[8, 6]] }); put(ctx.world, "p0", at(8, 6).x, at(8, 6).y); path(ctx.world, "p0", [{ x: at(12, 6).x, y: at(8, 6).y }]);
    return { ...ctx, facts: { onIce: true, path: [{ x: at(12, 6).x, y: at(8, 6).y }] } };
  }));
  cases.push(run("gate-path-empty", "gates", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200);
    return { ...ctx, facts: { path: [] } };
  }));
  cases.push(run("gate-tiny-segment", "gates", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); path(ctx.world, "p0", [{ x: 200.0005, y: 200 }]);
    return { ...ctx, facts: { path: [{ x: 200.0005, y: 200 }] } };
  }));
  cases.push(run("positive-baseline", "positive", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); path(ctx.world, "p0", [{ x: 300, y: 200 }]);
    return { ...ctx, facts: { path: [{ x: 300, y: 200 }] } };
  }));
  // move factor / upper bound
  cases.push(run("factor-dt0", "factors", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); path(ctx.world, "p0", [{ x: 300, y: 200 }]);
    const seen = []; ctx.world.moveModifiers.push((_w, _c, dt) => { seen.push(dt); return 1; });
    return { ...ctx, facts: { moveModifier: "returns1", recordDt: true, seen } };
  }, (ctx) => { const h = hint(ctx); return { kind: "walkHintOf", hint: { dir: h.dir, ticks: h.ticks }, dtSeen: ctx.world.moveModifiers.map((m) => m(ctx.world, C(ctx.world, "p0"), 0)) }; }));
  cases.push(run("factor-zero", "factors", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); path(ctx.world, "p0", [{ x: 300, y: 200 }]);
    ctx.world.moveModifiers.push(() => 0);
    return { ...ctx, facts: { moveModifier: "returns0" } };
  }));
  cases.push(run("factor-floor", "factors", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); path(ctx.world, "p0", [{ x: 300, y: 200 }]);
    ctx.world.moveModifiers.push(() => 0.1);
    return { ...ctx, facts: { moveModifier: "returns0.1", floor: MOVE_MULT_FLOOR } };
  }));
  cases.push(run("factor-hazard-noninterference", "factors", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); path(ctx.world, "p0", [{ x: 300, y: 200 }]);
    const before = json(ctx.world.hazards.stats), slip = json(ctx.world.players.get("p0").slip);
    return { ...ctx, facts: { beforeHazards: before, beforeSlip: slip } };
  }, (ctx) => {
    const h = hint(ctx);
    return { kind: "walkHintOf", hint: { dir: h.dir, ticks: h.ticks }, afterHazards: json(ctx.world.hazards.stats), afterSlip: json(ctx.world.players.get("p0").slip) };
  }));
  cases.push(run("speed-mirror-boost", "factors", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); path(ctx.world, "p0", [{ x: 300, y: 200 }]);
    ctx.world.state.players.get("p0").speedMult = encodeMult(1.5);
    return { ...ctx, facts: { speedMult: encodeMult(1.5) } };
  }));
  cases.push(run("sentenced-hunt", "factors", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); path(ctx.world, "p0", [{ x: 300, y: 200 }]);
    const p = ctx.world.state.players.get("p0"); p.faction = "sentenced"; p.huntTarget = "p-helper";
    return { ...ctx, facts: { faction: "sentenced", huntTarget: "p-helper" } };
  }));
  // weapon / held
  cases.push(run("weapon-root-active", "weapon", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); equip(ctx.world, "p0", "wand"); path(ctx.world, "p0", [{ x: 300, y: 200 }]);
    ctx.world.players.get("p0").weapon.rootUntil = ctx.world.state.serverTime + 1000;
    return { ...ctx, facts: { weapon: "wand", rootUntil: "now+1000" } };
  }));
  cases.push(run("weapon-root-expired", "weapon", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); equip(ctx.world, "p0", "wand"); path(ctx.world, "p0", [{ x: 300, y: 200 }]);
    ctx.world.players.get("p0").weapon.rootUntil = ctx.world.state.serverTime + 1;
    return { ...ctx, facts: { weapon: "wand", rootUntil: "now+1" } };
  }));
  cases.push(run("weapon-action-swing", "weapon", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); equip(ctx.world, "p0", "wand"); path(ctx.world, "p0", [{ x: 300, y: 200 }]);
    const now = ctx.world.state.serverTime;
    ctx.world.players.get("p0").weapon.action = { kind: "swing", weapon: "wand", startedAt: now, landsAt: now + 500, a: 0, packet: {} };
    return { ...ctx, facts: { weapon: "wand", action: { kind: "swing", landsAt: "now+500" } } };
  }));
  cases.push(run("weapon-action-draw", "weapon", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); equip(ctx.world, "p0", "wand"); path(ctx.world, "p0", [{ x: 300, y: 200 }]);
    const now = ctx.world.state.serverTime;
    ctx.world.players.get("p0").weapon.action = { kind: "draw", weapon: "bow", startedAt: now, landsAt: now + 500, a: 0, packet: {} };
    return { ...ctx, facts: { weapon: "wand", action: { kind: "draw", landsAt: "now+500" } } };
  }));
  cases.push(run("weapon-held-ready", "weapon", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); equip(ctx.world, "p0", "wand"); path(ctx.world, "p0", [{ x: 300, y: 200 }]);
    const rt = ctx.world.players.get("p0"), p = ctx.world.state.players.get("p0");
    rt.weapon.held = true; rt.weapon.bufferedUntil = ctx.world.state.serverTime + 100; p.readyAt = ctx.world.state.serverTime;
    return { ...ctx, facts: { weapon: "wand", held: true, ready: "now", bufferedUntil: "now+100" } };
  }));
  cases.push(run("weapon-buffered-not-ready", "weapon", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); equip(ctx.world, "p0", "wand"); path(ctx.world, "p0", [{ x: 300, y: 200 }]);
    const rt = ctx.world.players.get("p0"), p = ctx.world.state.players.get("p0");
    rt.weapon.held = false; rt.weapon.bufferedUntil = ctx.world.state.serverTime - 1; p.readyAt = ctx.world.state.serverTime + 1000;
    return { ...ctx, facts: { weapon: "wand", held: false, ready: "now+1000", bufferedUntil: "now-1" } };
  }));
  const wh = (id, rootOffset, action) => cases.push(run(id, "weaponHoldsAt", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); equip(ctx.world, "p0", "wand");
    const now = ctx.world.state.serverTime, rt = ctx.world.players.get("p0");
    rt.weapon.rootUntil = rootOffset === null ? 0 : now + rootOffset;
    if (action) rt.weapon.action = { kind: action.kind, weapon: action.weapon, startedAt: now, landsAt: now + action.landsOffset, a: 0, packet: {} };
    return { ...ctx, facts: { weapon: "wand", at: "now+50", rootUntil: rootOffset === null ? 0 : "now+" + rootOffset, action: action ? { kind: action.kind, landsAt: "now+" + action.landsOffset } : null } };
  }, (ctx) => {
    const now = ctx.world.state.serverTime;
    return { kind: "weaponHoldsAt", at: "now+50", observed: weaponHoldsAt(C(ctx.world, "p0"), now + 50) };
  }));
  wh("weaponHoldsAt-root-before", 51, null);
  wh("weaponHoldsAt-root-at", 50, null);
  wh("weaponHoldsAt-swing-before", null, { kind: "swing", weapon: "sword", landsOffset: 500 });
  wh("weaponHoldsAt-swing-tie", null, { kind: "swing", weapon: "sword", landsOffset: TIE_EPS_MS + 50 + 1 });
  wh("weaponHoldsAt-draw-before", null, { kind: "draw", weapon: "bow", landsOffset: 500 });
  // lock
  function lockBase(ctx, opts = {}) {
    const w = ctx.world; put(w, "p0", 200, 200); put(w, "p1", opts.targetX ?? 820, 200); equip(w, "p0", "wand");
    path(w, "p0", [{ x: 250, y: 200 }]);
    const rt = w.players.get("p0"); rt.weapon.lock = opts.lock ?? "p1"; rt.weapon.lockSeen = opts.lockSeen ?? true;
    rt.weapon.lockPlanAt = opts.planAt ?? w.state.serverTime; rt.weapon.lockGoal = opts.lockGoal ?? null;
    rt.weapon.lockLosLostAt = opts.losLostAt ?? 0;
    return { ...ctx, facts: { weapon: "wand", lock: opts.lock ?? "p1", targetX: opts.targetX ?? 820, planAt: opts.planAt ?? "now", lockGoal: opts.lockGoal ?? null, lockSeen: opts.lockSeen ?? true } };
  }
  cases.push(run("lock-free", "lock", () => { const ctx = makeWorld({ players: 2 }); return lockBase(ctx); }));
  cases.push(run("lock-stop", "lock", () => { const ctx = makeWorld({ players: 2 }); return lockBase(ctx, { targetX: 220 }); }));
  cases.push(run("lock-missing", "lock", () => { const ctx = makeWorld({ players: 2 }); return lockBase(ctx, { lock: "missing" }); }));
  cases.push(run("lock-replan", "lock", () => { const ctx = makeWorld({ players: 2 }); return lockBase(ctx, { planAt: ctx.world.state.serverTime - 300, lockGoal: { x: 0, y: 0 } }); }));
  cases.push(run("lock-future-hidden", "lock", () => {
    const ctx = makeWorld({ players: 2 }); const base = lockBase(ctx);
    addStatus(ctx.world, C(ctx.world, "p1"), { kind: "hidden", source: { id: "helper", name: "helper" }, ms: 5000 });
    return { ...base, facts: { ...base.facts, targetStatus: "hidden" } };
  }));
  // attack-move
  cases.push(run("amove-no-target", "amove", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); equip(ctx.world, "p0", "wand"); path(ctx.world, "p0", [{ x: 300, y: 200 }]);
    ctx.world.players.get("p0").weapon.attackMoveGoal = { x: 300, y: 200 };
    return { ...ctx, facts: { weapon: "wand", attackMoveGoal: { x: 300, y: 200 }, targets: 0 } };
  }));
  cases.push(run("amove-acquire", "amove", () => {
    const ctx = makeWorld({ players: 2 }); put(ctx.world, "p0", 200, 200); put(ctx.world, "p1", 400, 200); equip(ctx.world, "p0", "wand");
    path(ctx.world, "p0", [{ x: 250, y: 200 }]); ctx.world.players.get("p0").weapon.attackMoveGoal = { x: 250, y: 200 };
    return { ...ctx, facts: { weapon: "wand", attackMoveGoal: { x: 250, y: 200 }, targetX: 400 } };
  }));
  cases.push(run("amove-current-hidden", "amove", () => {
    const ctx = makeWorld({ players: 2 }); put(ctx.world, "p0", 200, 200); put(ctx.world, "p1", 820, 200); equip(ctx.world, "p0", "wand");
    path(ctx.world, "p0", [{ x: 250, y: 200 }]); ctx.world.players.get("p0").weapon.attackMoveGoal = { x: 250, y: 200 };
    addStatus(ctx.world, C(ctx.world, "p1"), { kind: "hidden", source: { id: "helper", name: "helper" }, ms: 5000 });
    return { ...ctx, facts: { weapon: "wand", attackMoveGoal: { x: 250, y: 200 }, targetStatus: "hidden" } };
  }));
  // ice
  cases.push(run("ice-center", "ice", () => {
    const ctx = makeWorld({ ice: [[8, 6]] }); put(ctx.world, "p0", at(8, 6).x, at(8, 6).y); path(ctx.world, "p0", [{ x: at(12, 6).x, y: at(8, 6).y }]);
    return { ...ctx, facts: { onIceCenter: true, path: [{ x: at(12, 6).x, y: at(8, 6).y }] } };
  }));
  cases.push(run("ice-thin-strip", "ice", () => {
    const ctx = makeWorld({ ice: [[7, 6]] }); put(ctx.world, "p0", 220, at(6, 6).y); path(ctx.world, "p0", [{ x: at(12, 6).x, y: at(6, 6).y }]);
    const c = C(ctx.world, "p0");
    return { ...ctx, facts: { iceCell: [7, 6], path: [{ x: at(12, 6).x, y: at(6, 6).y }], terrainAtProbe: ctx.world.map.terrain[6 * 64 + 7], terrainAtCenter: ctx.world.map.terrain[6 * 64 + 8], probes: [220, 228.5, 237, 250, 400].map((x) => ({ x, accel: slipAccelAt(ctx.world, c, x, at(6, 6).y) })) } };
  }));
  cases.push(run("ice-clear", "ice", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", at(7, 6).x, at(8, 6).y); path(ctx.world, "p0", [{ x: at(12, 6).x, y: at(8, 6).y }]);
    return { ...ctx, facts: { ice: false, path: [{ x: at(12, 6).x, y: at(8, 6).y }] } };
  }));
  cases.push(run("ice-home-frost", "ice", () => {
    const ctx = makeWorld({ ice: [[8, 6]], faction: "frost" }); put(ctx.world, "p0", at(8, 6).x, at(8, 6).y); path(ctx.world, "p0", [{ x: at(12, 6).x, y: at(8, 6).y }]);
    return { ...ctx, facts: { onIceCenter: true, faction: "frost" } };
  }));
  cases.push(run("ice-all-hazards", "ice", () => {
    const ctx = makeWorld({ ice: [[8, 6]], faction: "frost", hazardsAll: true }); put(ctx.world, "p0", at(8, 6).x, at(8, 6).y); path(ctx.world, "p0", [{ x: at(12, 6).x, y: at(8, 6).y }]);
    return { ...ctx, facts: { onIceCenter: true, faction: "frost", hazards: "all" } };
  }));
  // hysteresis / direction
  function hysteresisCase(id, oldTicks, chooseOld) {
    cases.push(run(id, "hysteresis", () => {
      const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); path(ctx.world, "p0", [{ x: 300, y: 200 }]);
      const newHint = hint(ctx); const oldDir = chooseOld ? chooseOld(newHint.dir) : 0;
      const p = ctx.world.state.players.get("p0"); p.extra.walkTicks = oldTicks; p.extra.walkDir = oldDir;
      return { ...ctx, facts: { path: [{ x: 300, y: 200 }], oldTicks, oldDir, newDirObservedBefore: newHint.dir } };
    }, (ctx) => { updateWalkHints(ctx.world); const p = ctx.world.state.players.get("p0"); return { kind: "updateWalkHints", observed: { dir: p.extra.walkDir, ticks: p.extra.walkTicks } }; }));
  }
  hysteresisCase("hysteresis-old-zero", 0, (d) => (d + 77) % 256);
  hysteresisCase("hysteresis-delta2", 3, (d) => (d + 254) % 256);
  hysteresisCase("hysteresis-delta3", 3, (d) => (d + 253) % 256);
  hysteresisCase("hysteresis-wrap-255", 3, () => 255);
  hysteresisCase("hysteresis-wrap-253", 3, () => 253);
  cases.push(run("negative-rounding-a", "direction", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); path(ctx.world, "p0", [{ x: 200 + Math.cos(-Math.PI / 2) * 100, y: 200 + Math.sin(-Math.PI / 2) * 100 }]);
    return { ...ctx, facts: { angle: -Math.PI / 2, path: "negative-y" } };
  }));
  cases.push(run("negative-rounding-b", "direction", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); path(ctx.world, "p0", [{ x: 200 + Math.cos(-Math.PI / 2 - Math.PI / 256) * 100, y: 200 + Math.sin(-Math.PI / 2 - Math.PI / 256) * 100 }]);
    return { ...ctx, facts: { angle: -Math.PI / 2 - Math.PI / 256, path: "adjacent-negative" } };
  }));
  cases.push(run("waypoint-cap3", "waypoint", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); path(ctx.world, "p0", [{ x: 250, y: 200 }]);
    return { ...ctx, facts: { segment: 50 } };
  }));
  cases.push(run("waypoint-cap2", "waypoint", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); path(ctx.world, "p0", [{ x: 220, y: 200 }]);
    return { ...ctx, facts: { segment: 20 } };
  }));
  // hooks
  function hookCase(id, hookName) {
    cases.push(run(id, "hook", () => {
      const ctx = makeWorld(); put(ctx.world, "p0", 200, 200);
      const rt = ctx.world.players.get("p0");
      enqueueClientMessage(rt.inputs, "move", { x: 300, y: 260, seq: 1 });
      step(ctx.world, TICK_MS);
      ctx.world.events = [];
      const p = ctx.world.state.players.get("p0");
      const before = { dir: p.extra.walkDir, ticks: p.extra.walkTicks, path: json(rt.path) };
      const hook = ctx.world.hooks[hookName];
      return { ...ctx, facts: { hook: hookName, before, action: "ordinary accepted Move before synthetic hook invocation" }, hook };
    }, (ctx) => {
      ctx.hook(ctx.world);
      const players = [...ctx.world.state.players.values()].map((p) => ({ id: p.id, dir: p.extra.walkDir, ticks: p.extra.walkTicks }));
      return { kind: "installedHook", hook: ctx.facts.hook, players, events: json(ctx.world.events) };
    }));
  }
  hookCase("hook-teleported", "teleported");
  hookCase("hook-runEnded", "runEnded");
  // Pure shared timing kernel rows for the native worker: actual mirrorTimings(profile:"npc"), six weapons x
  // three declared AS/windup pairs. These are kernel vectors, not World-earned hint contexts.
  const NPC_PAIRS = [
    { id: "baseline", asMult: 1, windupMult: 1 },
    { id: "fast-as-reduced-windup", asMult: 1.5, windupMult: 0.5 },
    { id: "slow-as-increased-windup", asMult: 0.5, windupMult: 1.5 },
  ];
  for (const pair of NPC_PAIRS) for (const weapon of ["sword", "bow", "wand", "shield", "axe", "fists"]) {
    const t = mirrorTimings(FACTIONS.fire, weapon, pair.asMult, pair.windupMult, "npc");
    cases.push({
      id: "mirrorTimings-" + weapon + "-" + pair.id, family: "mirrorTimings", helper: true,
      input: { profile: "npc", faction: "fire", weapon, asMult: pair.asMult, windupMult: pair.windupMult, pair: pair.id, source: "actual shared mirrorTimings" },
      observed: { interval: t.interval, windup: t.windup, root: t.root, ranged: t.ranged, intervalMs: t.interval * 1000, windupMs: t.windup * 1000 },
    });
  }
  return cases;
}
export function assertHelperFacts(corpus) {
  const fail = (m) => { throw new Error(m); };
  if (!corpus || corpus.format !== "rh-walk-hint-helpers/1") fail("wrong helper corpus format");
  const by = Object.fromEntries((corpus.cases ?? []).map((c) => [c.id, c]));
  const get = (id) => { const c = by[id]; if (!c) fail("missing helper context " + id); if (c.error) fail("helper context errored: " + id + ": " + c.error); return c; };
  const hint = (id) => { const o = get(id).observed; if (!o || !o.hint) fail("missing hint output " + id); return o.hint; };
  const zero = (id) => { const h = hint(id); if (h.ticks !== 0) fail(id + " expected zero ticks, got " + h.ticks); };
  const positive = (id) => { const h = hint(id); if (!(h.ticks > 0 && h.ticks <= 3)) fail(id + " expected positive ticks, got " + h.ticks); };
  for (const id of ["gate-phase-lobby", "gate-phase-ended", "gate-standing-dead", "gate-hidden", "gate-stun", "gate-root", "gate-slip-center", "gate-path-empty", "gate-tiny-segment"]) zero(id);
  positive("positive-baseline");
  const f0 = get("factor-dt0"); if (!f0.observed || !Array.isArray(f0.input.seen) || !f0.input.seen.every((dt) => dt === 0)) fail("factor dt0 not observed");
  positive("factor-dt0"); zero("factor-zero"); positive("factor-floor");
  const hz = get("factor-hazard-noninterference");
  if (JSON.stringify(hz.input.beforeHazards) !== JSON.stringify(hz.observed.afterHazards)) fail("hazard stats changed by hint");
  if (JSON.stringify(hz.input.beforeSlip) !== JSON.stringify(hz.observed.afterSlip)) fail("slip changed by hint");
  positive("speed-mirror-boost"); positive("sentenced-hunt");
  zero("weapon-root-active"); positive("weapon-root-expired"); zero("weapon-action-swing"); const heldReady = get("weapon-held-ready").observed.hint; if (heldReady.ticks !== 2) fail("weapon-held-ready expected the observed 2-tick hold lower bound"); positive("weapon-buffered-not-ready");
  const wh1 = get("weaponHoldsAt-root-before").observed.observed;
  const wh2 = get("weaponHoldsAt-root-at").observed.observed;
  if (wh1 !== true || wh2 !== false) fail("weaponHoldsAt root boundary not observed");
  positive("lock-free"); zero("lock-stop"); zero("lock-missing"); zero("lock-replan"); zero("lock-future-hidden");
  positive("amove-no-target"); zero("amove-acquire");
  zero("ice-center"); zero("ice-thin-strip"); positive("ice-clear"); positive("ice-home-frost"); zero("ice-all-hazards");
  const h0 = get("hysteresis-old-zero").observed.observed.dir;
  const oldDir = get("hysteresis-old-zero").input.oldDir;
  if (h0 === oldDir) fail("old ticks0 did not assign a new direction");
  const d2 = get("hysteresis-delta2"), d3 = get("hysteresis-delta3");
  if (d2.observed.observed.dir !== d2.input.oldDir) fail("delta2 incorrectly changed direction");
  if (d3.observed.observed.dir === d3.input.oldDir) fail("delta3 did not change direction");
  const w255 = get("hysteresis-wrap-255"), w253 = get("hysteresis-wrap-253");
  if (w255.observed.observed.dir !== 255) fail("wrap255 changed direction");
  if (w253.observed.observed.dir === 253) fail("wrap253 did not change direction");
  if (hint("waypoint-cap3").ticks !== 3) fail("cap3 waypoint context not observed");
  if (hint("waypoint-cap2").ticks !== 2) fail("cap2 waypoint context not observed");
  const mirror = corpus.cases.filter((c) => c.family === "mirrorTimings");
  if (mirror.length !== 18) fail("mirrorTimings row count " + mirror.length + " !== 18");
  const mt = (weapon, pair) => mirror.find((c) => c.input.weapon === weapon && c.input.pair === pair)?.observed;
  for (const weapon of ["sword", "bow", "wand", "shield", "axe", "fists"]) {
    const base = mt(weapon, "baseline"), fast = mt(weapon, "fast-as-reduced-windup"), slow = mt(weapon, "slow-as-increased-windup");
    if (!base || !fast || !slow) fail("missing mirrorTimings pair " + weapon);
    if (!(fast.interval > 0 && slow.interval > 0 && base.interval > 0)) fail("mirror interval not finite/positive " + weapon);
    if (!(fast.interval < base.interval)) fail("fast AS did not reduce interval " + weapon);
    if (fast.ranged) { if (fast.windup !== base.windup) fail("NPC ranged fast-AS base-speed floor lost " + weapon); }
    else if (!(fast.windup <= base.windup)) fail("melee fast windup not reduced " + weapon);
    if (!(slow.windup >= base.windup)) fail("slow windup not increased " + weapon);
  }
  for (const id of ["hook-teleported", "hook-runEnded"]) {
    const c = get(id); const players = c.observed.players;
    if (c.input.before.ticks <= 0) fail(id + " had no nonzero hint before hook");
    if (players.some((p) => p.ticks !== 0)) fail(id + " did not zero every player's ticks");
    if (!players.some((p) => p.dir !== 0)) fail(id + " lost every direction");
  }
}
export function sourceInfo() {
  const files = {};
  for (const rel of SOURCE_FILES) { const text = readFileSync(join("/repo", rel), "utf8"); files[rel] = { bytes: Buffer.byteLength(text), sha256: sha(text) }; }
  return files;
}
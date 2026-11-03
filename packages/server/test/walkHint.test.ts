// The walk hint (sim/walkHint.ts; docs/PLAYER_PREDICTION.md Stage 2): two presentation mirrors per player. That it changes no
// outcome (a world with it and one without step identically, field for field but the two mirrors), what it says (the waypoint,
// the roots, ice, a lock's and an attack-move's next tick), that it never claims a tick the server does not walk along it absent a
// new order or another fighter's act, that it patches only on a change, and that its copy of the weapon's root rule cannot drift.
import { Encoder } from "@colyseus/schema";
import { describe, expect, it } from "vitest";
import {
  decodeWalkDir, EFFECT_HIDDEN, encodeMult, encodeWalkDir, hasLineOfSight, mapFromTiles, mulberry32, PLAYER_SPEED, RANGED_RELEASE_PAUSE_MS,
  TERRAIN_ICE, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, WALK_HINT_MAX_TICKS, type FactionId, type GameMap, type Vec2, type WeaponId,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { BOT_FILL_DEFAULTS } from "../src/bots/brain/types";
import { createHeadlessRoom, type HeadlessRoom } from "../src/bots/tournament/headlessRoom";
import { removePlayer } from "../src/sim/step";
import { combatant, type Combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { addMob } from "../src/sim/mobs";
import { addStatus } from "../src/sim/status";
import { addPlayer, step } from "../src/sim/step";
import { walkHintOf, weaponHoldsAt } from "../src/sim/walkHint";
import { moveMultiplierOf } from "../src/sim/weapons";
import { chainHook, type PlayerRuntime, type SimConfig, type SimEvent, type World } from "../src/sim/world";

const STEP_U = (PLAYER_SPEED * TICK_MS) / 1000;
/** The heading may be off by the hysteresis (2 steps unwritten) plus the rounding (half a step): 2.5 / 256 of a turn. */
const DIR_TOLERANCE = (2.5 * Math.PI) / 128;
const tc = (t: number): number => t * TILE + TILE / 2;
const at = (tx: number, ty: number): Vec2 => ({ x: tc(tx), y: tc(ty) });

interface MapOpts { w?: number; h?: number; ice?: (tx: number, ty: number) => boolean; wall?: (tx: number, ty: number) => boolean }

function roomMap(o: MapOpts = {}): GameMap {
  const w = o.w ?? 64;
  const h = o.h ?? 40;
  const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
  const terrain = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || o.wall?.(x, y)) tiles[i] = TILE_WALL;
      else if (o.ice?.(x, y)) terrain[i] = TERRAIN_ICE;
    }
  }
  const map = mapFromTiles(w, h, tiles, 0, terrain);
  map.spawns = Array.from({ length: 8 }, (_, i) => at(2 + i, 2));
  return map;
}

interface PlayerSpec { faction: FactionId; weapon?: WeaponId | ""; at: Vec2 }

const BASE: SimConfig = {
  minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 1e6, patienceMinSeconds: 1e6, suddenDeathSeconds: 1e6,
  planSeconds: 0, firstPatienceSeconds: 0, pvpRules: false, wishLockSeconds: 0,
};

/** An active run of players p0, p1, ... placed where asked; the first step starts it. */
function rig(players: PlayerSpec[], o: { map?: GameMap; hints?: boolean; signatures?: boolean; config?: Partial<SimConfig> } = {}): World {
  let uid = 0;
  const world = createGameWorld({
    config: { ...BASE, minPlayers: players.length, ...o.config }, random: mulberry32(3), map: o.map ?? roomMap(), newItemUid: () => `u${uid++}`,
  }, { signatures: o.signatures ?? false, walkHints: o.hints ?? true });
  players.forEach((spec, i) => addPlayer(world, `p${i}`, `player${i}`, { faction: spec.faction }));
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  players.forEach((spec, i) => {
    const p = world.state.players.get(`p${i}`)!;
    p.weapon0 = spec.weapon ?? "";
    put(world, `p${i}`, spec.at);
  });
  return world;
}

function put(world: World, id: string, v: Vec2): void {
  const p = world.state.players.get(id)!;
  const rt = world.players.get(id)!;
  p.x = v.x;
  p.y = v.y;
  rt.path = [];
  rt.slip = null;
  rt.history = [{ t: world.state.serverTime, x: v.x, y: v.y }];
}

const P = (w: World, id: string): PlayerState => w.state.players.get(id)!;
const RT = (w: World, id: string): PlayerRuntime => w.players.get(id)!;
const C = (w: World, id: string): Extract<Combatant, { kind: "player" }> => ({ kind: "player", id, s: P(w, id), rt: RT(w, id) });
const hint = (w: World, id: string) => walkHintOf(w, C(w, id));
const send = (w: World, id: string, type: string, msg: object = {}): void => {
  expect(enqueueClientMessage(RT(w, id).inputs, type, msg)).toBe(true);
};
const tick = (w: World): SimEvent[] => step(w, TICK_MS);
const src = (id: string) => ({ id, name: id });

/** The synced state as JSON with the two hint mirrors taken out of every player. */
function stripHints(w: World): unknown {
  const json = w.state.toJSON() as { players: Record<string, { extra?: Record<string, unknown> }> };
  for (const p of Object.values(json.players)) {
    if (p.extra) { delete p.extra.walkDir; delete p.extra.walkTicks; }
  }
  return json;
}

const mapsAsArrays = (_k: string, v: unknown): unknown => (v instanceof Map ? [...v.entries()] : v instanceof Set ? [...v] : v);
const paths = (w: World): string => JSON.stringify([...w.players.values(), ...w.mobs.values()].map((rt) => [rt.id, rt.path]));

/**
 * Checks, tick after tick, that a player whose hint said walkTicks >= 1 walks its next tick along walkDir, unless that tick gave it
 * an order or a status, moved it by force (displaceSeq, the teleport), or did either to the fighter it has locked. Returns how many
 * ticks it checked.
 */
function neverLies(world: World, ticks: number, script: (i: number) => void, stepper: () => void = () => { tick(world); }): number {
  const touched = new Set<string>();
  // The hook runs for every fighter every tick: only a tick that brought it something counts.
  chainHook(world, "inputsApplied", (_w, c, d) => { if (d.move !== null || d.aim !== null || d.actions.length > 0) touched.add(c.id); });
  chainHook(world, "statusApplied", (_w, c) => { touched.add(c.id); });
  let checked = 0;
  for (let i = 0; i < ticks && world.state.phase !== "ended"; i++) {
    script(i);
    const before = new Map<string, { x: number; y: number; ticks: number; dir: number; seq: number; lock: string; lockSeq: number }>();
    for (const [id, p] of world.state.players) {
      const lock = p.attackTarget;
      const t = lock ? combatant(world, lock) : null;
      before.set(id, { x: p.x, y: p.y, ticks: p.extra.walkTicks, dir: p.extra.walkDir, seq: p.displaceSeq, lock, lockSeq: t?.s.displaceSeq ?? -1 });
    }
    const gates = world.state.gatesLocked;
    touched.clear();
    stepper();
    if (world.state.gatesLocked !== gates || world.state.phase !== "active") continue;
    for (const [id, b] of before) {
      const p = world.state.players.get(id);
      if (!p || b.ticks < 1 || touched.has(id) || p.displaceSeq !== b.seq) continue;
      if (b.lock) {
        const t = combatant(world, b.lock);
        if (!t || touched.has(b.lock) || t.s.displaceSeq !== b.lockSeq || t.s.status !== "alive") continue;
      }
      const dx = p.x - b.x;
      const dy = p.y - b.y;
      const len = Math.hypot(dx, dy);
      expect(len, `${id} stood still at tick ${world.state.tick} after walkTicks ${b.ticks}`).toBeGreaterThan(1e-6);
      const a = decodeWalkDir(b.dir);
      const off = Math.abs(Math.atan2(dx * Math.sin(a) - dy * Math.cos(a), dx * Math.cos(a) + dy * Math.sin(a)));
      expect(off, `${id} turned at tick ${world.state.tick}`).toBeLessThanOrEqual(DIR_TOLERANCE + 1e-9);
      checked++;
    }
  }
  return checked;
}

describe("walk hint: no outcome change", () => {
  it("a scripted run with and without the hint steps identically, every field but the two mirrors, tick for tick", () => {
    const map = roomMap({ wall: (x, y) => (x === 20 && y >= 8 && y <= 20) || (x >= 36 && x <= 38 && y === 25), ice: (x, y) => x >= 44 && y >= 20 });
    const specs: PlayerSpec[] = [
      { faction: "sentenced", weapon: "wand", at: at(6, 10) },
      { faction: "frost", weapon: "bow", at: at(30, 12) },
      { faction: "fire", weapon: "sword", at: at(12, 28) },
      { faction: "plague", weapon: "wand", at: at(40, 30) },
      { faction: "holy", weapon: "axe", at: at(50, 8) },
    ];
    const a = rig(specs, { map, hints: true, signatures: true });
    const b = rig(specs, { map, hints: false, signatures: true });
    for (const w of [a, b]) {
      addMob(w, { kind: "dummy", name: "d0", faction: "", at: at(26, 18) });
      addMob(w, { kind: "dummy", name: "d1", faction: "", at: at(46, 12) });
    }
    const ids = specs.map((_, i) => `p${i}`);
    const targets = [...ids, ...a.state.mobs.keys()];
    const rnd = mulberry32(2024);
    let hinted = 0;
    let teleported = false;
    for (let i = 0; i < 700; i++) {
      // The same orders reach both worlds, drawn once.
      const orders: Array<[string, string, object]> = [];
      for (const id of ids) {
        const r = rnd();
        const point = { x: TILE * (2 + rnd() * 60), y: TILE * (2 + rnd() * 36) };
        if (r < 0.04) orders.push([id, "move", point]);
        else if (r < 0.06) orders.push([id, "stop", {}]);
        else if (r < 0.08) orders.push([id, "attackMove", point]);
        else if (r < 0.1) orders.push([id, "target", { id: targets[Math.floor(rnd() * targets.length)]! }]);
        else if (r < 0.12) orders.push([id, "attack", { a: rnd() * 6 - 3, t: a.state.serverTime - 80 }]);
        else if (r < 0.14) orders.push([id, "release", { a: rnd() * 6 - 3, t: a.state.serverTime - 80 }]);
        else if (r < 0.2) orders.push([id, "aim", { a: rnd() * 6 - 3 }]);
        else if (r < 0.205) orders.push([id, "cast", { slot: "wish", x: point.x, y: point.y }]);
        else if (r < 0.21) orders.push([id, "swap", {}]);
      }
      // WASD-like re-sends from p2: a goal 64 u ahead, every other tick.
      if (i % 2 === 0) {
        const p = P(a, "p2");
        const h = Math.floor(i / 24) * 0.7;
        orders.push(["p2", "move", { x: Math.max(40, Math.min(1990, p.x + Math.cos(h) * 64)), y: Math.max(40, Math.min(1230, p.y + Math.sin(h) * 64)) }]);
      }
      if (i === 400) { a.state.patienceEndsAt = a.state.serverTime; b.state.patienceEndsAt = b.state.serverTime; }
      for (const w of [a, b]) for (const [id, type, msg] of orders) if (w.players.has(id)) enqueueClientMessage(RT(w, id).inputs, type, msg);
      const ea = tick(a);
      const eb = tick(b);
      expect(JSON.stringify(ea), `events at tick ${a.state.tick}`).toBe(JSON.stringify(eb));
      expect(stripHints(a), `state at tick ${a.state.tick}`).toEqual(stripHints(b));
      expect(JSON.stringify(a.hazards.stats, mapsAsArrays)).toBe(JSON.stringify(b.hazards.stats, mapsAsArrays));
      expect(paths(a)).toBe(paths(b));
      for (const p of a.state.players.values()) {
        expect(p.extra.walkTicks).toBeLessThanOrEqual(WALK_HINT_MAX_TICKS);
        if (p.extra.walkTicks > 0) hinted++;
      }
      for (const p of b.state.players.values()) expect(p.extra.walkTicks).toBe(0);
      if (a.state.gatesLocked) teleported = true;
    }
    expect(teleported).toBe(true);
    expect(hinted).toBeGreaterThan(200);
  });

  it("8 bots through a teleport to the run's end: the same game with and without the hint", () => {
    const room = (walkHints: boolean): HeadlessRoom => createHeadlessRoom({
      seed: 4242,
      config: { patienceSeconds: 25, patienceMinSeconds: 25, suddenDeathSeconds: 8 },
      bots: { ...BOT_FILL_DEFAULTS, fillTo: 8 },
      lineup: Array.from({ length: 8 }, (_, i) => ({ tier: (["easy", "normal", "hard"] as const)[i % 3] })),
      walkHints,
    });
    const a = room(true);
    const b = room(false);
    let teleported = false;
    let hinted = 0;
    let ticks = 0;
    for (; ticks < 6000 && a.world.state.phase !== "ended"; ticks++) {
      const ea = a.tick();
      const eb = b.tick();
      if (JSON.stringify(ea) !== JSON.stringify(eb)) expect.fail(`events differ at tick ${a.world.state.tick}`);
      // The whole state every 10 ticks and on every tick with a teleport or a death (the full JSON is the slow part).
      const eventful = ea.some((e) => e.type === "resolved" || (e.type === "fx" && (e.fx.kind === "teleport" || e.fx.kind === "death")));
      if (ticks % 10 === 0 || eventful) expect(stripHints(a.world), `state at tick ${a.world.state.tick}`).toEqual(stripHints(b.world));
      else if (paths(a.world) !== paths(b.world)) expect.fail(`paths differ at tick ${a.world.state.tick}`);
      if (a.world.state.gatesLocked) teleported = true;
      for (const p of a.world.state.players.values()) if (p.extra.walkTicks > 0) hinted++;
    }
    expect(stripHints(a.world)).toEqual(stripHints(b.world));
    expect(teleported).toBe(true);
    expect(a.world.state.phase).toBe("ended");
    expect(hinted).toBeGreaterThan(500);
    for (const p of a.world.state.players.values()) expect(p.extra.walkTicks).toBe(0);
  }, 240_000);
});

describe("walk hint: what it says", () => {
  it("a straight far walk: 3 ticks along its heading, never past the waypoint, counting down 3, 2, 1, 0 at its end", () => {
    const w = rig([{ faction: "holy", at: at(4, 4) }]);
    const goal = at(30, 22);
    send(w, "p0", "move", goal);
    tick(w);
    const p = P(w, "p0");
    const q = RT(w, "p0").path[0]!;
    expect(p.extra.walkTicks).toBe(3);
    expect(p.extra.walkDir).toBe(encodeWalkDir(Math.atan2(q.y - p.y, q.x - p.x)));
    const seen: number[] = [3];
    for (let i = 0; i < 200 && RT(w, "p0").path.length > 0; i++) {
      tick(w);
      const k = p.extra.walkTicks;
      const path = RT(w, "p0").path;
      if (k > 0) expect(k * STEP_U).toBeLessThanOrEqual(Math.hypot(path[0]!.x - p.x, path[0]!.y - p.y) + 1e-6);
      if (k !== seen[seen.length - 1]) seen.push(k);
    }
    expect(seen.slice(-4)).toEqual([3, 2, 1, 0]);
  });

  it("nothing to walk, or anything that stops the walk, says 0: no path, dead, stun, root, a cast with a cast time, hidden by Swarm", () => {
    const w = rig([{ faction: "plague", at: at(4, 10) }]);
    expect(hint(w, "p0").ticks).toBe(0);
    send(w, "p0", "move", at(50, 10));
    tick(w);
    expect(hint(w, "p0")).toEqual({ dir: encodeWalkDir(0), ticks: 3 });
    const c = C(w, "p0");

    addStatus(w, c, { kind: "stun", source: src("x"), ms: 500 });
    expect(hint(w, "p0").ticks).toBe(0);
    c.rt.statuses = [];
    addStatus(w, c, { kind: "root", source: src("x"), ms: 500 });
    expect(hint(w, "p0").ticks).toBe(0);
    c.rt.statuses = [];
    expect(hint(w, "p0").ticks).toBe(3);

    const now = w.state.serverTime;
    c.rt.cast = { landsAt: now + 400, startedAt: now } as unknown as NonNullable<PlayerRuntime["cast"]>;
    expect(hint(w, "p0").ticks).toBe(0);
    c.rt.cast = null;

    const hidden = addStatus(w, c, { kind: "hidden", source: src("p0"), ms: 5000 })!;
    expect(hint(w, "p0").ticks).toBe(0);
    // Its own attack or cast shows it for a moment: walking while shown is drawn.
    hidden.revealFrom = now - 1;
    hidden.revealUntil = now + 500;
    expect(hint(w, "p0").ticks).toBe(3);
    c.rt.statuses = [];

    P(w, "p0").status = "dead";
    expect(hint(w, "p0").ticks).toBe(0);
    P(w, "p0").status = "alive";
    send(w, "p0", "stop");
    tick(w);
    expect(hint(w, "p0").ticks).toBe(0);
  });

  it("ice: 0 on it, and 0 once it lies inside the next step's travel; the count never reaches into it", () => {
    const iceX = 20 * TILE;
    const w = rig([{ faction: "plague", at: at(8, 10) }], { map: roomMap({ ice: (x) => x >= 20 }) });
    send(w, "p0", "move", at(40, 10));
    let zeroBefore = false;
    for (let i = 0; i < 60; i++) {
      tick(w);
      const p = P(w, "p0");
      const k = p.extra.walkTicks;
      if (p.x >= iceX) expect(k).toBe(0);
      else {
        expect(p.x + k * STEP_U).toBeLessThan(iceX);
        if (k === 0 && p.x + STEP_U * 1.02 >= iceX) zeroBefore = true;
      }
    }
    expect(zeroBefore).toBe(true);
  });

  it("a bow draw in hand: the count stops before the release pause; a held melee trigger never stops it", () => {
    const w = rig([{ faction: "frost", weapon: "bow", at: at(4, 10) }, { faction: "fire", weapon: "sword", at: at(4, 30) }]);
    send(w, "p0", "attack", { a: 0 });
    send(w, "p0", "move", at(60, 10));
    send(w, "p1", "attack", { a: 0 });
    send(w, "p1", "move", at(60, 30));
    let draws = 0;
    let walkingDraws = 0;
    for (let i = 0; i < 80; i++) {
      tick(w);
      const now = w.state.serverTime;
      const act = RT(w, "p0").weapon.action;
      const k = P(w, "p0").extra.walkTicks;
      if (act && act.kind === "draw") {
        draws++;
        if (k > 0) walkingDraws++;
        // No tick it claims falls in the pause before the arrow leaves.
        for (let j = 1; j <= k; j++) {
          const t = now + j * TICK_MS;
          expect(t >= act.landsAt - RANGED_RELEASE_PAUSE_MS && t < act.landsAt, `tick ${w.state.tick} claims ${j}`).toBe(false);
        }
      }
      const q = RT(w, "p1").path[0];
      if (q && Math.hypot(q.x - P(w, "p1").x, q.y - P(w, "p1").y) > 4 * STEP_U) expect(P(w, "p1").extra.walkTicks).toBe(3);
    }
    expect(draws).toBeGreaterThan(10);
    expect(walkingDraws).toBeGreaterThan(0);
  });

  it("a held ranged trigger between shots: the count stops where the next draw's release pause starts", () => {
    const w = rig([{ faction: "frost", weapon: "wand", at: at(4, 10) }]);
    send(w, "p0", "attack", { a: 0 });
    send(w, "p0", "move", at(60, 10));
    let between = 0;
    let lastWindup = 0;
    for (let i = 0; i < 80; i++) {
      tick(w);
      const now = w.state.serverTime;
      const rt = RT(w, "p0");
      const p = P(w, "p0");
      const k = p.extra.walkTicks;
      if (!rt.weapon.action && rt.weapon.held && lastWindup > 0) {
        between++;
        const pause = Math.max(p.readyAt, now) + lastWindup - RANGED_RELEASE_PAUSE_MS;
        expect(now + k * TICK_MS).toBeLessThan(pause);
      }
      if (rt.weapon.action) lastWindup = rt.weapon.action.landsAt - rt.weapon.action.startedAt;
    }
    expect(between).toBeGreaterThan(0);
  });

  it("a slow that is about to end does not let the count reach the waypoint: it reads the step of the buffed mirror", () => {
    const w = rig([{ faction: "holy", at: at(4, 10) }]);
    const c = C(w, "p0");
    c.rt.path = [{ x: c.s.x + 30, y: c.s.y }];
    c.s.speedMult = encodeMult(1.5);
    addStatus(w, c, { kind: "slowMove", source: src("x"), ms: 60, value: 0.5 });
    // Walking at x0.75 it would cover 19 u in 3 ticks; the slow ends after one, and at x1.5 three ticks are 38 u: two fit in 30 u.
    expect(hint(w, "p0").ticks).toBe(2);
    c.rt.statuses = [];
    expect(hint(w, "p0").ticks).toBe(2);
    c.s.speedMult = encodeMult(1);
    expect(hint(w, "p0").ticks).toBe(3);
  });
});

/** A wand fighter walking to its lock: the hint is 1 on exactly the ticks whose next tick walks on along the same path. */
describe("walk hint: a target lock's walk", () => {
  it("a stationary target in sight: 1 on every tick whose next tick walks a full step on; 0 before the pause and the stop", () => {
    const w = rig([{ faction: "holy", weapon: "wand", at: at(4, 10) }]);
    const dummy = addMob(w, { kind: "dummy", name: "d", faction: "", at: { x: P(w, "p0").x + 620, y: P(w, "p0").y } });
    send(w, "p0", "target", { id: dummy });
    tick(w);
    expect(P(w, "p0").attackTarget).toBe(dummy);
    expect(P(w, "p0").extra.walkTicks).toBe(1);
    let ones = 0;
    let zeros = 0;
    for (let i = 0; i < 40 && RT(w, "p0").path.length > 0; i++) {
      const p = P(w, "p0");
      const before = { x: p.x, y: p.y, k: p.extra.walkTicks, plan: RT(w, "p0").weapon.lockPlanAt };
      expect(before.k).toBeLessThanOrEqual(1);
      tick(w);
      const full = Math.abs(p.x - before.x - STEP_U) < 1e-6 && Math.abs(p.y - before.y) < 1e-6;
      expect(RT(w, "p0").weapon.lockPlanAt).toBe(before.plan);
      expect(before.k === 1, `tick ${w.state.tick}`).toBe(full);
      if (before.k === 1) ones++;
      else zeros++;
    }
    expect(ones).toBeGreaterThan(3);
    expect(zeros).toBeGreaterThan(0);
  });

  it("a target walking at full speed: 0 exactly on the ticks before a re-plan (about one in five), else 1 when the next tick walks on", () => {
    const w = rig([{ faction: "holy", weapon: "wand", at: at(3, 4) }, { faction: "frost", at: at(3, 4) }]);
    // The target walks away down the diagonal as fast as the chaser walks, about 600 u ahead: past the lock's stopping distance
    // and inside its leash, so the chase walks all the way and re-plans as the goal moves.
    put(w, "p1", { x: P(w, "p0").x + 430, y: P(w, "p0").y + 430 });
    send(w, "p1", "move", at(60, 38));
    send(w, "p0", "target", { id: "p1" });
    tick(w);
    let replans = 0;
    let moving = 0;
    for (let i = 0; i < 120; i++) {
      const p = P(w, "p0");
      const before = { x: p.x, y: p.y, k: p.extra.walkTicks, plan: RT(w, "p0").weapon.lockPlanAt };
      tick(w);
      if (p.attackTarget !== "p1") break;
      const replanned = RT(w, "p0").weapon.lockPlanAt !== before.plan;
      const moved = Math.hypot(p.x - before.x, p.y - before.y);
      if (moved > 0) moving++;
      if (replanned) {
        replans++;
        expect(before.k, `tick ${w.state.tick}`).toBe(0);
      } else if (moved > STEP_U - 1e-6) expect(before.k, `tick ${w.state.tick}`).toBe(1);
    }
    expect(moving).toBeGreaterThan(30);
    expect(replans / moving).toBeGreaterThan(0.1);
    expect(replans / moving).toBeLessThan(0.35);
  });

  it("a lock whose target dies, or whose holder swaps off the wand: 0 from that tick on", () => {
    const w = rig([{ faction: "holy", weapon: "wand", at: at(4, 10) }, { faction: "frost", at: at(30, 30) }]);
    P(w, "p0").weapon1 = "sword";
    const dummy = addMob(w, { kind: "dummy", name: "d", faction: "", at: { x: P(w, "p0").x + 630, y: P(w, "p0").y } });
    send(w, "p0", "target", { id: dummy });
    tick(w);
    expect(P(w, "p0").extra.walkTicks).toBe(1);
    w.state.mobs.get(dummy)!.status = "dead";
    expect(hint(w, "p0").ticks).toBe(0);
    w.state.mobs.get(dummy)!.status = "alive";
    expect(hint(w, "p0").ticks).toBe(1);
    send(w, "p0", "swap", { slot: 1 });
    tick(w);
    expect(P(w, "p0").extra.walkTicks).toBe(0);
  });

  it("an attack-move with a wand: at most 1, and 0 on the tick before it locks someone", () => {
    const w = rig([{ faction: "holy", weapon: "wand", at: at(4, 10) }]);
    const dummy = addMob(w, { kind: "dummy", name: "d", faction: "", at: at(40, 10) });
    send(w, "p0", "attackMove", at(60, 10));
    let prev = -1;
    let locked = false;
    for (let i = 0; i < 80 && !locked; i++) {
      tick(w);
      const p = P(w, "p0");
      if (p.attackTarget === dummy) {
        locked = true;
        expect(prev).toBe(0);
        break;
      }
      expect(p.extra.walkTicks).toBeLessThanOrEqual(1);
      prev = p.extra.walkTicks;
    }
    expect(locked).toBe(true);
  });

  it("the coliseum teleport and the run's end leave every walkTicks at 0", () => {
    const w = rig([{ faction: "holy", at: at(4, 10) }, { faction: "frost", at: at(4, 30) }]);
    send(w, "p0", "move", at(60, 10));
    send(w, "p1", "move", at(60, 30));
    tick(w);
    expect(P(w, "p0").extra.walkTicks).toBe(3);
    w.state.patienceEndsAt = w.state.serverTime;
    tick(w);
    expect(w.state.gatesLocked).toBe(true);
    for (const p of w.state.players.values()) expect(p.extra.walkTicks).toBe(0);
    for (let i = 0; i < 25; i++) tick(w);
    send(w, "p0", "move", { x: P(w, "p0").x + 200, y: P(w, "p0").y });
    tick(w);
    expect(P(w, "p0").extra.walkTicks).toBeGreaterThan(0);
    removePlayer(w, "p1");
    for (let i = 0; i < 3 && w.state.phase !== "ended"; i++) tick(w);
    expect(w.state.phase).toBe("ended");
    for (const p of w.state.players.values()) expect(p.extra.walkTicks).toBe(0);
  });
});

describe("walk hint: it never claims a tick the server does not walk", () => {
  it("over a headless 8-bot run", () => {
    const room = createHeadlessRoom({
      seed: 77,
      config: { patienceSeconds: 40, patienceMinSeconds: 40, suddenDeathSeconds: 10 },
      bots: { ...BOT_FILL_DEFAULTS, fillTo: 8 },
      lineup: Array.from({ length: 8 }, (_, i) => ({ tier: (["easy", "normal", "hard"] as const)[i % 3] })),
    });
    const checked = neverLies(room.world, 2400, () => {}, () => { room.tick(); });
    expect(checked).toBeGreaterThan(300);
  }, 120_000);

  it("over scripted play: locks in and out of sight, attack-moves, ice, Swarm, a bow draw, a blink, a slow ending, WASD re-sends", () => {
    const map = roomMap({ wall: (x, y) => x === 26 && y >= 6 && y <= 22, ice: (x, y) => x >= 44 && x <= 46 });
    const w = rig([
      // p0 starts below the wall at column 26, seeing both sides, then walks behind it: what it saw stays in its vision trail, so
      // it can lock fighters there out of sight (chased around the wall until seen).
      { faction: "holy", weapon: "wand", at: at(26, 28) },
      { faction: "plague", weapon: "bow", at: at(30, 12) },
      { faction: "fire", weapon: "sword", at: at(10, 30) },
      { faction: "frost", weapon: "wand", at: at(50, 30) },
      { faction: "sentenced", weapon: "axe", at: at(40, 34) },
    ], { map, signatures: true });
    const d0 = addMob(w, { kind: "dummy", name: "d0", faction: "", at: at(30, 14) });
    let heading = 0;
    const seen = { lockOutOfSight: 0, lockInSight: 0, amoveLocked: 0, hidden: 0, blink: 0, slid: 0, drawing: 0 };
    const seq0 = P(w, "p2").displaceSeq;
    const checked = neverLies(w, 900, (i) => {
      const p0 = P(w, "p0");
      const t0 = p0.attackTarget ? combatant(w, p0.attackTarget) : null;
      if (t0) seen[hasLineOfSight(w.map, p0, t0.s) ? "lockInSight" : "lockOutOfSight"]++;
      if (P(w, "p3").attackTarget) seen.amoveLocked++;
      if ((P(w, "p1").effects & EFFECT_HIDDEN) !== 0) seen.hidden++;
      if (P(w, "p2").displaceSeq !== seq0) seen.blink++;
      if (RT(w, "p4").slip) seen.slid++;
      if (RT(w, "p1").weapon.action?.kind === "draw") seen.drawing++;
      const phase = Math.floor(i / 150);
      if (i === 0) send(w, "p0", "move", at(14, 14));
      if (i % 150 === 90) send(w, "p0", "target", { id: phase % 2 === 0 ? "p1" : d0 });
      if (i % 150 === 0) {
        if (i > 0) send(w, "p1", "move", phase % 2 === 0 ? at(36, 34) : at(36, 4));
        send(w, "p3", "attackMove", phase % 2 === 0 ? at(30, 30) : at(58, 30));
        send(w, "p4", "move", phase % 2 === 0 ? at(60, 34) : at(30, 34));
      }
      if (i % 150 === 40) send(w, "p1", "attack", { a: 1 });
      if (i % 150 === 70) send(w, "p1", "release", { a: 1 });
      if (i === 200) send(w, "p1", "cast", { slot: "wish", x: P(w, "p1").x, y: P(w, "p1").y });
      if (i === 320) send(w, "p2", "cast", { slot: "wish", x: P(w, "p2").x + 150, y: P(w, "p2").y });
      if (i === 500) addStatus(w, combatant(w, "p4")!, { kind: "slowMove", source: src("x"), ms: 120, value: 0.5 });
      // WASD-style: a goal 64 u ahead of where it stands, re-sent every other tick with +-1 u of noise; a new heading every 1.2 s.
      if (i % 2 === 0) {
        if (i % 24 === 0) heading += 0.9;
        const p = P(w, "p2");
        const n = (i % 3) - 1;
        const g = { x: p.x + Math.cos(heading) * 64 - Math.sin(heading) * n, y: p.y + Math.sin(heading) * 64 + Math.cos(heading) * n };
        if (g.x > 48 && g.x < 63 * TILE - 16 && g.y > 48 && g.y < 39 * TILE - 16) send(w, "p2", "move", g);
      }
    });
    expect(checked).toBeGreaterThan(400);
    // Each case it names was played.
    for (const [k, n] of Object.entries(seen)) expect(n, k).toBeGreaterThan(0);
  });
});

describe("walk hint: patches", () => {
  it("costs nothing while everyone stands: the patches are byte for byte those of a world without it", () => {
    const specs: PlayerSpec[] = [{ faction: "holy", at: at(4, 10) }, { faction: "frost", at: at(20, 20) }];
    const a = rig(specs, { hints: true });
    const b = rig(specs, { hints: false });
    const ea = new Encoder(a.state);
    const eb = new Encoder(b.state);
    ea.encodeAll();
    eb.encodeAll();
    ea.discardChanges();
    eb.discardChanges();
    for (let i = 0; i < 40; i++) {
      tick(a);
      tick(b);
      const pa = ea.hasChanges ? Buffer.from(ea.encode()).toString("hex") : "";
      const pb = eb.hasChanges ? Buffer.from(eb.encode()).toString("hex") : "";
      expect(pa).toBe(pb);
      ea.discardChanges();
      eb.discardChanges();
    }
  });

  it("a straight walk writes walkDir once and walkTicks 0, 3, 2, 1, 0 only", () => {
    const w = rig([{ faction: "holy", at: at(4, 4) }]);
    send(w, "p0", "move", at(40, 30));
    const dirs: number[] = [];
    const counts: number[] = [P(w, "p0").extra.walkTicks];
    for (let i = 0; i < 200; i++) {
      tick(w);
      const x = P(w, "p0").extra;
      if (x.walkTicks > 0 && dirs[dirs.length - 1] !== x.walkDir) dirs.push(x.walkDir);
      if (counts[counts.length - 1] !== x.walkTicks) counts.push(x.walkTicks);
    }
    expect(RT(w, "p0").path).toEqual([]);
    expect(dirs).toHaveLength(1);
    expect(counts).toEqual([0, 3, 2, 1, 0]);
  });

  it("WASD re-sends with +-1 u of noise along one heading write walkDir once; a 10 degree turn writes it once more", () => {
    const w = rig([{ faction: "holy", at: at(4, 6) }]);
    const writes: number[] = [];
    let last = P(w, "p0").extra.walkDir;
    let heading = 0.37;
    for (let i = 0; i < 80; i++) {
      if (i === 40) heading += (10 * Math.PI) / 180;
      if (i % 2 === 0) {
        const p = P(w, "p0");
        const n = (i % 4 === 0 ? 1 : -1) * 0.999;
        send(w, "p0", "move", { x: p.x + Math.cos(heading) * 64 - Math.sin(heading) * n, y: p.y + Math.sin(heading) * 64 + Math.cos(heading) * n });
      }
      tick(w);
      const d = P(w, "p0").extra.walkDir;
      if (d !== last) writes.push(i);
      last = d;
      expect(P(w, "p0").extra.walkTicks).toBeGreaterThan(0);
    }
    expect(writes).toHaveLength(2);
    expect(writes[0]).toBe(0);
    expect(writes[1]).toBeGreaterThanOrEqual(40);
  });
});

describe("walk hint: its copy of the weapon's root rule", () => {
  it("weaponHoldsAt(c, now) is moveMultiplierOf(c) === 0 for every standing player, at movement time, through swings, draws, casts and roots", () => {
    const w = rig([
      { faction: "frost", weapon: "bow", at: at(4, 8) },
      { faction: "holy", weapon: "wand", at: at(4, 16) },
      { faction: "fire", weapon: "axe", at: at(4, 24) },
      { faction: "plague", weapon: "sword", at: at(4, 32) },
    ]);
    let checked = 0;
    let held = 0;
    w.afterWeapons.push((world) => {
      for (const [id, p] of world.state.players) {
        if (p.status !== "alive") continue;
        const c = C(world, id);
        const holds = weaponHoldsAt(c, world.state.serverTime);
        expect(holds).toBe(moveMultiplierOf(world, c) === 0);
        if (holds) held++;
        checked++;
      }
    });
    const rnd = mulberry32(5);
    for (let i = 0; i < 300; i++) {
      for (let k = 0; k < 4; k++) {
        const id = `p${k}`;
        const r = rnd();
        if (r < 0.1) send(w, id, "attack", { a: rnd() * 6 - 3 });
        else if (r < 0.15) send(w, id, "release", { a: 0 });
        else if (r < 0.25) send(w, id, "move", { x: TILE * (2 + rnd() * 60), y: TILE * (2 + rnd() * 36) });
      }
      tick(w);
    }
    expect(checked).toBeGreaterThan(1000);
    expect(held).toBeGreaterThan(20);
  });
});

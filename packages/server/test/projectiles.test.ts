// sim/projectiles.ts: arrows and wand balls from the loosing input to the projEnd. What is pinned here is the netcode
// contract (a projectile is announced once, in the fx batch of the step that loosed it, and never updated; the end point
// and reason arrive as a projEnd), the flight in
// present time against where bodies are at that moment, and the interactions: walls and gates, range, shield
// reflections, ball-versus-arrow deletion, the teleport clear, a shooter who is gone, and the swing interceptions.
// Melee is not involved: the swing side of interceptBall is driven by hand, in the slot where the melee phase runs.
// Worlds are a hand-built open arena (1280 x 640 u); the shots are real inputs (a tap, then the windup runs out).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Decoder, Encoder, getRawChangesCallback, Reflection } from "@colyseus/schema";
import {
  ARROW_REFLECT_SHARE, BALL_AFTER_ARROW, BALL_ARROW_RADIUS, damagePerHit, damageShares, DUEL_PACE, FACTIONS, GV_KILL, mapFromTiles, MAX_ARROW_REFLECTIONS,
  mitigateShares, mulberry32,
  pacedFaction, PLAYER_SPEED, PROJECTILE_SUBSTEP_MS, RANGED_HIT_REACH, reflectVelocity, SIGNATURE_WEAPONS, SWORD_BALL_SCALE, TICK_MS, TILE,
  TILE_FLOOR, TILE_WALL, unpackFx, unpackLaunches, WEAPONS, type Effect, type FactionId, type FxEvent, type GameMap, type ProjectileLaunch,
  type TimedFx, type Vec2, type WeaponId,
} from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { FxChannel } from "../src/rooms/FxChannel";
import { applyDamage } from "../src/sim/arena";
import { activeWeapon, combatant, standingCombatants, timingsOf } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { applyLedger } from "../src/sim/ledger";
import { addMob } from "../src/sim/mobs";
import { recomputeMods, setExtraRows } from "../src/sim/mods";
import { positionAt, recordHistory } from "../src/sim/movement";
import {
  ballsThisTick, endProjectile, interceptBall, spawnProjectiles, sweepProjectiles,
} from "../src/sim/projectiles";
import { addPlayer, removePlayer, step } from "../src/sim/step";
import type { ProjectileRuntime, SimEvent, World } from "../src/sim/world";

type Fx<K extends FxEvent["kind"]> = Extract<FxEvent, { kind: K }>;
type EventOf<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;

// ---------------------------------------------------------------------------------------------------------------
// These tests pin the projectile mechanics (the netcode contract, 10 ms substeps, walls, gates, reflections), not the
// tuned numbers. The 9.1 tuning cut the ranges to 240 and 220 u; the long-flight geometry below (far walls, a flight of
// many substeps, a shot across the arena) was built for the original 480 and 420, so this file flies at those. What the
// catalog really says is pinned in shared/test/weapons.test.ts and by "flies the catalog's own ranges" below.
// The catalog is shared module state, so the longer ranges are set only while this file's tests run (beforeAll) and the
// catalog's own are put back afterwards (afterAll): nothing else that imports @raid/shared in this worker can see them.
const CATALOG_RANGES = { bow: 0, wand: 0 };
const TEST_RANGES = { bow: 480, wand: 420 };
function setRanges(ranges: { bow: number; wand: number }): void {
  for (const w of ["bow", "wand"] as const) {
    const shape = WEAPONS[w].shape;
    if (shape.kind !== "projectile") throw new Error(`${w} is not a projectile weapon`);
    shape.range = ranges[w];
  }
}
for (const w of ["bow", "wand"] as const) {
  const shape = WEAPONS[w].shape;
  if (shape.kind !== "projectile") throw new Error(`${w} is not a projectile weapon`);
  CATALOG_RANGES[w] = shape.range;
}
beforeAll(() => setRanges(TEST_RANGES));
afterAll(() => setRanges(CATALOG_RANGES));

// ---------------------------------------------------------------------------------------------------------------
// Scenario helpers

const W_TILES = 40;
const H_TILES = 20;
const SEED = 7;
const ARROW = WEAPONS.bow.shape.kind === "projectile" ? WEAPONS.bow.shape : null!;
const BALL = WEAPONS.wand.shape.kind === "projectile" ? WEAPONS.wand.shape : null!;
/** World units an arrow / a ball flies in one tick. */
const ARROW_TICK = (ARROW.speed * TICK_MS) / 1000;
const BALL_TICK = (BALL.speed * TICK_MS) / 1000;

const tileCentre = (t: number): number => t * TILE + TILE / 2;

/** Floor inside a wall border; `edit` changes tiles. Eight spawns so the run can start. */
function openMap(edit?: (tiles: Uint8Array) => void): GameMap {
  const tiles = new Uint8Array(W_TILES * H_TILES).fill(TILE_FLOOR);
  for (let tx = 0; tx < W_TILES; tx++) { tiles[tx] = TILE_WALL; tiles[(H_TILES - 1) * W_TILES + tx] = TILE_WALL; }
  for (let ty = 0; ty < H_TILES; ty++) { tiles[ty * W_TILES] = TILE_WALL; tiles[ty * W_TILES + W_TILES - 1] = TILE_WALL; }
  edit?.(tiles);
  const spawns = Array.from({ length: 8 }, (_, i) => ({ x: tileCentre(3 + i), y: tileCentre(3) }));
  return { ...mapFromTiles(W_TILES, H_TILES, tiles), spawns };
}

/** A wall across the arena at tile column 12 (x 384..416), with a three-tile gate (rows 9..11) that closes with the gates. */
function gatedMap(): GameMap {
  const base = openMap((tiles) => { for (let ty = 1; ty < H_TILES - 1; ty++) tiles[ty * W_TILES + 12] = ty >= 9 && ty <= 11 ? TILE_FLOOR : TILE_WALL; });
  const gate = { side: "w" as const, tiles: [9, 10, 11].map((y) => ({ x: 12, y })), x: tileCentre(12), y: tileCentre(10) };
  return { ...base, coliseum: { ...base.coliseum, gates: [gate] } };
}

interface Fighter {
  id: string;
  at: Vec2;
  faction: FactionId;
  /** Slots 0 and 1; the first faction signature weapon by default. */
  weapons?: [WeaponId, WeaponId?];
  facing?: number;
  hp?: number;
}

const nameOf = (id: string): string => id[0]!.toUpperCase() + id.slice(1);
const archer = (at: Vec2 = { x: 200, y: 320 }, hp?: number): Fighter => ({ id: "archer", at, faction: "sentenced", hp });
const mage = (at: Vec2 = { x: 200, y: 320 }): Fighter => ({ id: "mage", at, faction: "holy" });
const target = (at: Vec2, hp?: number): Fighter => ({ id: "target", at, faction: "fire", hp });
/** Faces the archer (facing PI) with its shield in hand. */
const holder = (at: Vec2, facing = Math.PI): Fighter => ({ id: "holder", at, faction: "frost", facing });
/** Keeps the run going when someone dies, far from every line of fire. */
const idle = (id = "idle", at: Vec2 = { x: 1200, y: 600 }): Fighter => ({ id, at, faction: "frost", facing: 0 });

const P = (world: World, id: string) => world.state.players.get(id)!;
const RT = (world: World, id: string) => world.players.get(id)!;

function place(world: World, id: string, at: Vec2, facing?: number): void {
  const p = P(world, id);
  p.x = at.x;
  p.y = at.y;
  if (facing !== undefined) p.facing = facing;
  RT(world, id).history = [{ t: world.state.serverTime, x: at.x, y: at.y }];
}

/** An active run (the first step starts it) with the fighters where each test wants them. */
function arena(fighters: Fighter[], map: GameMap = openMap()): World {
  const world = createGameWorld({
    seed: SEED,
    config: {
      minPlayers: fighters.length, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
      suddenDeathSeconds: 3600, pvpRules: false,
    },
    random: mulberry32(SEED + 1),
  }, { signatures: false });
  world.map = map;
  for (const f of fighters) {
    const p = addPlayer(world, f.id, nameOf(f.id));
    p.faction = f.faction;
    p.hp = p.maxHp = FACTIONS[f.faction].hp;
    p.weapon0 = f.weapons?.[0] ?? SIGNATURE_WEAPONS[f.faction];
    p.weapon1 = f.weapons?.[1] ?? "";
  }
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  for (const f of fighters) {
    place(world, f.id, f.at, f.facing);
    if (f.hp !== undefined) P(world, f.id).hp = f.hp;
  }
  return world;
}

const tick = (world: World): SimEvent[] => step(world, TICK_MS);

function ticks(world: World, n: number): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < n; i++) all.push(...tick(world));
  return all;
}

function ofType<T extends SimEvent["type"]>(events: SimEvent[], type: T): Array<EventOf<T>> {
  return events.filter((e): e is EventOf<T> => e.type === type);
}

function fxOf<K extends FxEvent["kind"]>(events: SimEvent[], kind: K): Array<Fx<K>> {
  return ofType(events, "fx").map((e) => e.fx).filter((fx): fx is Fx<K> => fx.kind === kind);
}

interface Shot { id: string; a: number }

/**
 * Real inputs: each shooter taps (press and release) so that its fixed draw ends in the same tick for every arrow. Cooldowns
 * are not what is under test, so they are reset first. Returns the events of the tick the arrows left. `beforeLoose` runs
 * just before that tick.
 */
function loose(world: World, shots: Shot[], beforeLoose?: () => void): SimEvent[] {
  const need = shots.map((s) => {
    const c = P(world, s.id);
    expect(activeWeapon(c)).toBe("bow");
    c.readyAt = 0;
    return Math.ceil((timingsOf(c, "bow")!.windup * 1000) / TICK_MS - 1e-9);
  });
  const total = Math.max(...need);
  let out: SimEvent[] = [];
  for (let i = 0; i <= total; i++) {
    if (i === total) beforeLoose?.();
    shots.forEach((s, k) => {
      const q = RT(world, s.id).inputs;
      if (i === total - need[k]!) {
        q.pushAction({ kind: "attack", a: s.a });
        q.pushAction({ kind: "release", a: s.a });
      }
    });
    out = tick(world);
  }
  return out;
}

/** Wand casts: everyone presses together, then the balls leave in the same tick; returns that tick's events. */
function castBalls(world: World, shots: Shot[]): SimEvent[] {
  const before = world.projectiles.size;
  for (const s of shots) {
    const c = P(world, s.id);
    expect(activeWeapon(c)).toBe("wand");
    c.readyAt = 0;
    RT(world, s.id).inputs.pushAction({ kind: "attack", a: s.a });
  }
  let out = tick(world);
  for (const s of shots) RT(world, s.id).inputs.pushAction({ kind: "release", a: s.a });
  for (let i = 0; i < 30 && world.projectiles.size === before; i++) out = tick(world);
  expect(world.projectiles.size).toBe(before + shots.length);
  return out;
}

const castBall = (world: World, id: string, a: number): SimEvent[] => castBalls(world, [{ id, a }]);

/** The newest projectile still flying. */
const lastProjectile = (world: World): ProjectileRuntime => [...world.projectiles.values()].at(-1)!;

/** Ticks until a projEnd appears; the tick count, the end and everything emitted on the way. */
function flyUntilEnd(world: World, max = 80): { ticks: number; events: SimEvent[]; end: Fx<"projEnd"> } {
  const events: SimEvent[] = [];
  for (let n = 1; n <= max; n++) {
    const evs = tick(world);
    events.push(...evs);
    const end = fxOf(evs, "projEnd")[0];
    if (end) return { ticks: n, events, end };
  }
  throw new Error(`no projectile ended within ${max} ticks`);
}

/**
 * The projectile phases of one tick with nothing else: record history, sweep, spawn, then `mid` (where the melee phase
 * runs in step.ts), then the ledger. For driving interceptBall at the moment a swing would land.
 */
function flyTick(world: World, mid?: (w: World) => void): SimEvent[] {
  const s = world.state;
  s.serverTime += TICK_MS;
  s.tick++;
  for (const c of standingCombatants(world)) recordHistory(c.rt, c.s, s.serverTime);
  world.combat.ledger = [];
  sweepProjectiles(world, TICK_MS);
  spawnProjectiles(world);
  mid?.(world);
  applyLedger(world);
  const out = world.events;
  world.events = [];
  return out;
}

/**
 * Launches hand-placed shots in the spawn phase, from the origin the weapon state machine would give them (a request's
 * `origin`). They first move in the next sweep, from the time of this call.
 */
function launchShots(world: World, shots: Array<{ owner: string; kind: "arrow" | "ball"; at: Vec2; a: number }>): ProjectileRuntime[] {
  world.combat.spawns = shots.map((s) => ({
    owner: s.owner, kind: s.kind, weapon: s.kind === "arrow" ? "bow" : "wand", a: s.a,
    packet: { raw: 10, phys: 1, magic: 0, true: 0 }, origin: s.at,
  }));
  const before = new Set(world.projectiles.keys());
  spawnProjectiles(world);
  return [...world.projectiles.values()].filter((pr) => !before.has(pr.id));
}

/** One 10 ms substep of the sweep and nothing else: the clock moves on by it. */
function substep(world: World): SimEvent[] {
  world.state.serverTime += PROJECTILE_SUBSTEP_MS;
  sweepProjectiles(world, PROJECTILE_SUBSTEP_MS);
  const out = world.events;
  world.events = [];
  return out;
}

/** How a projectile left (what every client is told, see FxChannel) and who the server says owns it (no client is told). */
const launched = (pr: ProjectileRuntime) => ({
  kind: pr.launch.kind, owner: pr.owner, x: pr.launch.x, y: pr.launch.y, vx: pr.launch.vx, vy: pr.launch.vy, t: pr.launch.t,
  range: pr.launch.range,
});

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** What one full hit of `weapon` by `from` costs `to` after the damage law (DUEL_PACE applied), times `scale`. */
function hitAmount(from: FactionId, weapon: WeaponId, to: FactionId, scale = 1): number {
  const spec = pacedFaction(FACTIONS[from]);
  return mitigateShares(damagePerHit(spec, weapon) * scale, damageShares(spec), FACTIONS[to]);
}

/** The closest the body came to `at` at any 10 ms sample of the last tick (where the sweep looked for it). */
function closestSample(world: World, id: string, at: Vec2): number {
  const now = world.state.serverTime;
  let best = Infinity;
  for (let k = 1; k <= 5; k++) best = Math.min(best, dist(positionAt(RT(world, id), P(world, id), now - TICK_MS + 10 * k), at));
  return best;
}

// ---------------------------------------------------------------------------------------------------------------

describe("the launch: written once at spawn, never updated, and not in the synced state", () => {
  it("records one launch when an arrow is loosed, with its start, velocity, time and range", () => {
    const w = arena([archer(), target({ x: 900, y: 500 }), idle()]);
    expect(w.projectiles.size).toBe(0);
    const a = 0.3;
    loose(w, [{ id: "archer", a }]);
    expect(w.projectiles.size).toBe(1);
    const [id, pr] = [...w.projectiles][0]!;
    expect(launched(pr)).toEqual({
      kind: "arrow", owner: "archer", x: 200, y: 320, vx: Math.cos(a) * 900, vy: Math.sin(a) * 900, t: w.state.serverTime,
      range: 480,
    });
    expect(pr.launch.id).toBe(id);
    expect(pr).toMatchObject({ id, kind: "arrow", weapon: "bow", owner: "archer", ownerName: "Archer", ended: false, halved: false });
    // It is plain data in the runtime. The room state has no map of projectiles: the schema encoder never lets go of an entry
    // of a map it does not walk, so each arrow ever loosed would stay in server memory for the room's lifetime.
    expect((w.state as unknown as Record<string, unknown>).projectiles).toBeUndefined();
  });

  it("records a ball the same way, with the ball's speed and range", () => {
    const w = arena([mage(), target({ x: 900, y: 500 }), idle()]);
    const a = -0.4;
    castBall(w, "mage", a);
    expect(launched(lastProjectile(w))).toEqual({
      kind: "ball", owner: "mage", x: 200, y: 320, vx: Math.cos(a) * 380, vy: Math.sin(a) * 380, t: w.state.serverTime, range: 420,
    });
    expect(lastProjectile(w).weapon).toBe("wand");
  });

  it("never touches the launch while it flies", () => {
    const w = arena([archer(), target({ x: 900, y: 500 }), idle()]);
    loose(w, [{ id: "archer", a: 0.3 }]);
    const pr = lastProjectile(w);
    const before = launched(pr);
    const same = pr.launch;
    ticks(w, 6);
    expect(w.projectiles.has(pr.id)).toBe(true);
    expect(pr.launch).toBe(same);
    expect(launched(pr)).toEqual(before);
    expect(pr.x).toBeGreaterThan(before.x + 200); // it did fly: only the runtime moved
  });

  it("first moves in the tick after it was loosed", () => {
    const w = arena([archer(), target({ x: 900, y: 500 }), idle()]);
    loose(w, [{ id: "archer", a: 0 }]);
    const pr = lastProjectile(w);
    expect([pr.x, pr.y, pr.traveled, pr.simT]).toEqual([200, 320, 0, w.state.serverTime]);
    expect([pr.tickX, pr.tickY]).toEqual([200, 320]);
    tick(w);
    expect(pr.traveled).toBeCloseTo(ARROW_TICK, 9);
    expect(pr.x).toBeCloseTo(200 + ARROW_TICK, 9);
    expect(pr.simT).toBe(w.state.serverTime);
  });

  it("remembers where each tick's sweep began, for a swing landing in that tick", () => {
    const w = arena([mage(), target({ x: 900, y: 500 }), idle()]);
    castBall(w, "mage", 0);
    const pr = lastProjectile(w);
    tick(w);
    tick(w);
    expect([pr.tickX, pr.tickY]).toEqual([expect.closeTo(200 + BALL_TICK, 9), 320]);
    expect(pr.x).toBeCloseTo(200 + 2 * BALL_TICK, 9);
  });

  it("leaves the world when it stops, and a second stop does nothing", () => {
    const w = arena([archer(), target({ x: 900, y: 500 }), idle()]);
    loose(w, [{ id: "archer", a: 0 }]);
    const pr = lastProjectile(w);
    endProjectile(w, pr, 300, 320, "wall");
    expect(w.projectiles.size).toBe(0);
    expect(pr.ended).toBe(true);
    endProjectile(w, pr, 999, 999, "range");
    expect(fxOf(w.events, "projEnd")).toEqual([
      expect.objectContaining({ id: pr.id, x: 300, y: 320, reason: "wall" }),
    ]);
  });
});

describe("what a client sees over the wire", () => {
  /**
   * The server's encoder with one connected decoder, as in a Room, and the Room's fx channel in front of it: each step's
   * events become a batch that is read (against the roster of the patches before) ahead of the tick's patch.
   */
  function wire(world: World) {
    const encoder = new Encoder(world.state);
    const decoder = Reflection.decode(Reflection.encode(encoder)) as Decoder<RaidState>;
    decoder.decode(encoder.encodeAll());
    const channel = new FxChannel();
    const changes: Array<{ ref: unknown; field?: string }> = [];
    getRawChangesCallback(decoder, (list) => { for (const c of list) changes.push({ ref: c.ref, field: c.field }); });
    /** What ProjectileView flies: announced by a batch, until a projEnd. */
    const flying = new Map<string, ProjectileLaunch>();
    const ends: Array<Extract<TimedFx, { kind: "projEnd" }>> = [];
    return {
      encoder,
      channel,
      client: decoder.state,
      changes,
      flying,
      ends,
      flush: (events: SimEvent[] = []) => {
        const fxs = ofType(events, "fx").map((e) => e.fx);
        const batch = channel.batch(fxs, world.state.serverTime, world.projectiles);
        if (batch) {
          for (const l of unpackLaunches(batch)) flying.set(l.id, l);
          for (const fx of unpackFx(batch, decoder.state.roster)) {
            if (fx.kind !== "projEnd") continue;
            flying.delete(fx.id);
            ends.push(fx);
          }
        }
        channel.extendRoster(world.state);
        decoder.decode(encoder.encode());
        encoder.discardChanges();
        channel.rosterSent();
      },
    };
  }

  it("announces a projectile once, in a batch and never in a patch, and says nothing more until it ends", () => {
    const w = arena([archer(), target({ x: 900, y: 500 }), idle()]);
    const net = wire(w);
    net.flush();
    net.flush(loose(w, [{ id: "archer", a: 0.3 }]));
    const pr = lastProjectile(w);
    const { id, launch: st } = pr;
    expect((net.client as unknown as Record<string, unknown>).projectiles).toBeUndefined(); // no map of them to patch
    const sent = net.flying.get(id)!;
    expect(sent).toMatchObject({ id, kind: "arrow", t: st.t, range: st.range });
    for (const key of ["x", "y", "vx", "vy"] as const) expect(Math.abs(sent[key] - st[key]), key).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(pr.owner).toBe("archer"); // the server keeps who loosed it; no client is told
    net.changes.length = 0;
    for (let i = 0; i < 6; i++) net.flush(tick(w));
    expect(w.projectiles.has(id)).toBe(true);
    expect(net.changes.some((c) => c.field === "serverTime")).toBe(true); // the patches did flow: the room state kept changing
    expect(net.changes.map((c) => c.field).filter((f) => f !== "serverTime" && f !== "tick")).toEqual([]); // and carried only the clock
    expect([...net.flying.keys()]).toEqual([id]);
  });

  it("lets a client extrapolate the straight flight to where the server has it, and ends it with the projEnd", () => {
    const w = arena([archer(), target({ x: 900, y: 500 }), idle()]);
    const net = wire(w);
    net.flush(loose(w, [{ id: "archer", a: 0.3 }]));
    const pr = lastProjectile(w);
    const id = pr.id;
    for (let i = 0; i < 8; i++) {
      net.flush(tick(w));
      const c = net.flying.get(id)!;
      const dt = (net.client.serverTime - c.t) / 1000;
      expect(Math.abs(c.x + c.vx * dt - pr.x)).toBeLessThan(0.15);
      expect(Math.abs(c.y + c.vy * dt - pr.y)).toBeLessThan(0.15);
    }
    const { end, events } = flyUntilEnd(w);
    net.flush(events);
    expect(end.reason).toBe("range");
    expect(net.flying.size).toBe(0);
    expect(end.x0).toBeCloseTo(200, 6);
    expect(Math.hypot(end.x - end.x0, end.y - end.y0)).toBeCloseTo(480, 6);
    // The client was told where it stopped, to the nearest unit; it was not told where it started (it has the launch).
    expect(net.ends).toHaveLength(1);
    expect(Math.hypot(net.ends[0]!.x - end.x, net.ends[0]!.y - end.y)).toBeLessThanOrEqual(Math.SQRT1_2 + 1e-9);
  });

  it("a client that joins while it flies is sent it in a batch of its own, and without its owner", () => {
    const w = arena([archer(), target({ x: 900, y: 500 }), idle()]);
    const net = wire(w);
    net.flush(loose(w, [{ id: "archer", a: 0.3 }]));
    for (let i = 0; i < 3; i++) net.flush(tick(w));
    const pr = lastProjectile(w);
    const batch = net.channel.inFlight(w.projectiles, w.state.serverTime);
    expect(batch.l).toEqual([]);
    expect(batch.p).toHaveLength(1);
    const [sent] = unpackLaunches(batch);
    expect(sent).toMatchObject({ id: pr.id, kind: "arrow", t: pr.launch.t, range: pr.launch.range });
    for (const key of ["x", "y", "vx", "vy"] as const) expect(Math.abs(sent![key] - pr.launch[key]), key).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(JSON.stringify(batch)).not.toContain("archer");
    // The same launch the clients that were there got when it left: flying it from either lands in the same place.
    expect(sent).toEqual(net.flying.get(pr.id));
  });
});

describe("flight in present time", () => {
  it.each([100, 300, 466])("an arrow loosed at a body %i u away hits it in the tick the flight reaches it", (d) => {
    const w = arena([archer(), target({ x: 200 + d, y: 320 }), idle()]);
    expect(fxOf(loose(w, [{ id: "archer", a: 0 }]), "projEnd")).toEqual([]);
    const hp = P(w, "target").hp;
    const { ticks: n, end, events } = flyUntilEnd(w);
    expect(n).toBe(Math.ceil((d - RANGED_HIT_REACH) / ARROW_TICK));
    expect(end.reason).toBe("hit");
    expect(end.x).toBeCloseTo(200 + d - RANGED_HIT_REACH, 6);
    expect(end.y).toBeCloseTo(320, 6);
    expect(hp - P(w, "target").hp).toBeCloseTo(hitAmount("sentenced", "bow", "fire"), 9);
    expect(fxOf(events, "hit")).toEqual([
      { kind: "hit", id: "target", by: "archer", amount: expect.closeTo(hitAmount("sentenced", "bow", "fire"), 9), weapon: "bow" },
    ]);
  });

  it.each([200, 433])("a ball loosed at a body %i u away takes its own (slower) time", (d) => {
    const w = arena([mage(), target({ x: 200 + d, y: 320 }), idle()]);
    castBall(w, "mage", 0);
    const hp = P(w, "target").hp;
    const { ticks: n, end } = flyUntilEnd(w);
    expect(n).toBe(Math.ceil((d - RANGED_HIT_REACH) / BALL_TICK));
    expect(end).toMatchObject({ proj: "ball", reason: "hit" });
    expect(end.x).toBeCloseTo(200 + d - RANGED_HIT_REACH, 6);
    expect(hp - P(w, "target").hp).toBeCloseTo(hitAmount("holy", "wand", "fire"), 9);
  });

  it("hits a body at the very end of the range and not one just beyond its reach", () => {
    const near = arena([archer(), target({ x: 200 + ARROW.range + RANGED_HIT_REACH - 1, y: 320 }), idle()]);
    loose(near, [{ id: "archer", a: 0 }]);
    expect(flyUntilEnd(near).end.reason).toBe("hit");
    const far = arena([archer(), target({ x: 200 + ARROW.range + RANGED_HIT_REACH + 1, y: 320 }), idle()]);
    loose(far, [{ id: "archer", a: 0 }]);
    expect(flyUntilEnd(far).end.reason).toBe("range");
    expect(P(far, "target").hp).toBe(FACTIONS.fire.hp);
  });

  it("misses a body that was on the line when it was loosed but has walked off by the time the arrow gets there", () => {
    const w = arena([archer(), target({ x: 500, y: 320 }), idle()]);
    loose(w, [{ id: "archer", a: 0 }], () => { RT(w, "target").path = [{ x: 500, y: 600 }]; });
    const { end } = flyUntilEnd(w);
    expect(end.reason).toBe("range");
    expect(P(w, "target").hp).toBe(FACTIONS.fire.hp);
  });

  it("hits a body that was far off the line when it was loosed but walks onto it as the arrow gets there", () => {
    // The arrow reaches x = 500 about 333 ms after it leaves; the body, walking at PLAYER_SPEED, crosses y = 320 then.
    const flightMs = (500 - 200) / (ARROW.speed / 1000);
    const startY = 320 - (PLAYER_SPEED * (flightMs + TICK_MS)) / 1000;
    const w = arena([archer(), target({ x: 500, y: startY }), idle()]);
    loose(w, [{ id: "archer", a: 0 }], () => { RT(w, "target").path = [{ x: 500, y: 600 }]; });
    const spawnedAt = { x: P(w, "target").x, y: P(w, "target").y };
    expect(Math.abs(spawnedAt.y - 320)).toBeGreaterThan(40); // where a loosing-time test would look: nowhere near the line
    const { end } = flyUntilEnd(w);
    expect(end.reason).toBe("hit");
    expect(closestSample(w, "target", end)).toBeLessThanOrEqual(RANGED_HIT_REACH + 1e-6);
    expect(P(w, "target").hp).toBeLessThan(FACTIONS.fire.hp);
  });

  it("does not skip a body at 900 u/s, at any distance or phase of the 10 ms steps", () => {
    const w = arena([archer(), target({ x: 300, y: 320 }), idle()]);
    for (let d = 60; d <= 470; d += 13) {
      place(w, "target", { x: 200 + d, y: 320 });
      const hp = P(w, "target").hp;
      loose(w, [{ id: "archer", a: 0 }]);
      expect(flyUntilEnd(w).end.reason, `d = ${d}`).toBe("hit");
      expect(P(w, "target").hp, `d = ${d}`).toBeLessThan(hp);
    }
  });

  it("does not skip a body that crosses the line at full walking speed, whatever the phase of the crossing", () => {
    for (let k = 0; k < 10; k++) {
      const x = 500 + k * 1.1;
      const flightMs = (x - 200) / (ARROW.speed / 1000);
      const startY = 320 - (PLAYER_SPEED * (flightMs + TICK_MS)) / 1000;
      const w = arena([archer(), target({ x, y: startY }), idle()]);
      loose(w, [{ id: "archer", a: 0 }], () => { RT(w, "target").path = [{ x, y: 600 }]; });
      expect(flyUntilEnd(w).end.reason, `k = ${k}`).toBe("hit");
    }
  });

  it("flies in 10 ms substeps, each tested against where the body was at that moment: a body leaving the line mid-tick is hit", () => {
    expect(PROJECTILE_SUBSTEP_MS).toBe(10);
    // The arrow covers 45 u a tick and passes the body's x in the middle of tick 7. The body walks off the line at
    // PLAYER_SPEED (8.5 u a tick): 5.75 u from it when the tick starts, 10 u mid-tick, 14.25 u (past the 14 u reach) at the end.
    const x = 200 + 6 * ARROW_TICK + ARROW_TICK / 2;
    const w = arena([archer(), target({ x: 900, y: 560 }), idle()]);
    loose(w, [{ id: "archer", a: 0 }]);
    ticks(w, 6);
    place(w, "target", { x, y: 320 + 5.75 });
    RT(w, "target").path = [{ x, y: 600 }];
    const events = tick(w);
    expect(P(w, "target").y - 320).toBeCloseTo(14.25, 9);
    expect(P(w, "target").y - 320).toBeGreaterThan(RANGED_HIT_REACH); // tested where it ends the tick, the arrow would pass it by
    expect(fxOf(events, "projEnd")).toEqual([expect.objectContaining({ proj: "arrow", reason: "hit" })]);
    expect(P(w, "target").hp).toBeLessThan(FACTIONS.fire.hp);
  });

  it.each([
    ["an arrow passing exactly at the reach", "arrow", 14, "hit"],
    ["an arrow passing exactly at the reach, on the other side", "arrow", -14, "hit"],
    ["an arrow passing just outside it", "arrow", 14.5, "range"],
    ["a ball passing exactly at the reach", "ball", 14, "hit"],
    ["a ball passing just outside it", "ball", 14.5, "range"],
  ] as const)("RANGED_HIT_REACH is 14 u from the body's centre: %s", (_name, kind, offset, reason) => {
    expect(RANGED_HIT_REACH).toBe(14);
    const w = arena([kind === "arrow" ? archer() : mage(), target({ x: 400, y: 320 + offset }), idle()]);
    if (kind === "arrow") loose(w, [{ id: "archer", a: 0 }]);
    else castBall(w, "mage", 0);
    const { end } = flyUntilEnd(w);
    expect(end.reason).toBe(reason);
    expect(P(w, "target").hp < FACTIONS.fire.hp).toBe(reason === "hit");
  });

  it("applies the reach to a shot straight down as well", () => {
    for (const [dx, reason] of [[14, "hit"], [14.5, "range"]] as const) {
      const w = arena([archer({ x: 400, y: 100 }), target({ x: 400 + dx, y: 400 }), idle()]);
      loose(w, [{ id: "archer", a: Math.PI / 2 }]);
      expect(flyUntilEnd(w).end.reason, `dx = ${dx}`).toBe(reason);
    }
  });
});

describe("where a projectile leaves from", () => {
  // The shooter's client draws it LAG ms behind the server and measures its aim from there, so the shot leaves from that
  // rewound position (the `t` of the attack or release names it). From the present position the same aim would pass the
  // target by the shooter's speed times the lag.
  const LAG = 250;
  /** The `t` of an input stamped by a client `lag` ms behind the server, processed in the next tick. */
  const stamp = (w: World, lag: number): number => w.state.serverTime + TICK_MS - lag;
  it("an arrow leaves from the drawn position at the START of the draw, so an archer who walked, then drew, hits what it aimed at", () => {
    const w = arena([archer({ x: 200, y: 100 }), target({ x: 500, y: 320 }), idle()]);
    const c = P(w, "archer");
    const q = RT(w, "archer").inputs;
    c.readyAt = 0;
    RT(w, "archer").path = [{ x: 200, y: 560 }];
    ticks(w, 8); // walking at full speed
    const t = stamp(w, LAG);
    const drawn = positionAt(RT(w, "archer"), c, t);
    const a = Math.atan2(320 - drawn.y, 500 - drawn.x);
    q.pushAction({ kind: "attack", a, t });
    q.pushAction({ kind: "release", a, t });
    for (let i = 0; i < 40 && w.projectiles.size === 0; i++) tick(w);
    const arrow = lastProjectile(w);
    expect(arrow.kind).toBe("arrow");
    expect([arrow.launch.x, arrow.launch.y]).toEqual([expect.closeTo(drawn.x, 9), expect.closeTo(drawn.y, 9)]);
    expect(dist(drawn, c)).toBeGreaterThan(RANGED_HIT_REACH); // the present position is nowhere near it
    const hp = P(w, "target").hp;
    expect(flyUntilEnd(w).end.reason).toBe("hit");
    expect(P(w, "target").hp).toBeLessThan(hp);
  });

  it("without a timestamp an arrow leaves from where the shooter stood one tick back: the draw roots it there", () => {
    const w = arena([archer({ x: 200, y: 100 }), target({ x: 500, y: 320 }), idle()]);
    const c = P(w, "archer");
    const q = RT(w, "archer").inputs;
    c.readyAt = 0;
    RT(w, "archer").path = [{ x: 200, y: 560 }];
    ticks(w, 8);
    const before = { x: c.x, y: c.y };
    const a = Math.atan2(320 - before.y, 500 - before.x);
    q.pushAction({ kind: "attack", a });
    q.pushAction({ kind: "release", a });
    for (let i = 0; i < 40 && w.projectiles.size === 0; i++) {
      tick(w);
      // The press is processed before the archer would have moved that tick, and the draw holds it still until the arrow goes.
      if (w.projectiles.size === 0) expect([c.x, c.y]).toEqual([before.x, before.y]);
    }
    const arrow = lastProjectile(w);
    expect(c.y).toBeGreaterThan(before.y + 3); // it walks on in the tick the arrow leaves
    expect([arrow.launch.x, arrow.launch.y]).toEqual([expect.closeTo(before.x, 9), expect.closeTo(before.y, 9)]);
    expect(flyUntilEnd(w).end.reason).toBe("hit");
  });

  it("a ball leaves from the drawn position at the START of the cast, so a strafing caster hits what it aimed at", () => {
    const w = arena([mage({ x: 200, y: 100 }), target({ x: 500, y: 320 }), idle()]);
    const c = P(w, "mage");
    const q = RT(w, "mage").inputs;
    c.readyAt = 0;
    RT(w, "mage").path = [{ x: 200, y: 560 }];
    ticks(w, 8); // walking at full speed
    const t = stamp(w, LAG);
    const drawn = positionAt(RT(w, "mage"), c, t);
    const a = Math.atan2(320 - drawn.y, 500 - drawn.x);
    q.pushAction({ kind: "attack", a, t });
    q.pushAction({ kind: "release", a, t });
    for (let i = 0; i < 30 && w.projectiles.size === 0; i++) tick(w);
    const ball = lastProjectile(w);
    expect(ball.kind).toBe("ball");
    expect([ball.launch.x, ball.launch.y]).toEqual([expect.closeTo(drawn.x, 9), expect.closeTo(drawn.y, 9)]);
    expect(dist(drawn, c)).toBeGreaterThan(RANGED_HIT_REACH); // the caster walked on over the lag and the cast
    const hp = P(w, "target").hp;
    expect(flyUntilEnd(w).end.reason).toBe("hit");
    expect(P(w, "target").hp).toBeLessThan(hp);
  });
});

describe("bodies on the path", () => {
  it("never hits its owner, which it starts inside, nor a body behind the owner", () => {
    const w = arena([archer({ x: 400, y: 320 }), target({ x: 380, y: 320 }), idle()]);
    loose(w, [{ id: "archer", a: 0 }]);
    const { end, events } = flyUntilEnd(w);
    expect(end.reason).toBe("range");
    expect(end.x).toBeCloseTo(880, 6);
    expect(fxOf(events, "hit")).toEqual([]);
    expect(P(w, "archer").hp).toBe(FACTIONS.sentenced.hp);
    expect(P(w, "target").hp).toBe(FACTIONS.fire.hp);
  });

  it("hits a body that stands over its muzzle at once, at the muzzle", () => {
    const w = arena([archer({ x: 400, y: 320 }), target({ x: 410, y: 320 }), idle()]);
    loose(w, [{ id: "archer", a: 0 }]);
    const { ticks: n, end } = flyUntilEnd(w);
    expect(n).toBe(1);
    expect(end).toMatchObject({ reason: "hit", x: 400, y: 320 });
  });

  it("hits a body overlapping the shooter in front, and not one overlapping it from behind, when the arrow leaves", () => {
    // Within RANGED_HIT_REACH (14 u) of the muzzle either way; only the direction of fire tells them apart.
    for (const [name, at, reason] of [
      ["directly in front", { x: 410, y: 320 }, "hit"],
      ["in front, to the side", { x: 408, y: 328 }, "hit"],
      ["directly behind", { x: 390, y: 320 }, "range"],
      ["behind, to the side", { x: 392, y: 328 }, "range"],
    ] as const) {
      const w = arena([archer({ x: 400, y: 320 }), target(at), idle()]);
      loose(w, [{ id: "archer", a: 0 }]);
      const { end, events } = flyUntilEnd(w);
      expect(end.reason, name).toBe(reason);
      expect(fxOf(events, "hit").length, name).toBe(reason === "hit" ? 1 : 0);
      expect(P(w, "target").hp < FACTIONS.fire.hp, name).toBe(reason === "hit");
    }
  });

  it("hits the first body along the path and no other", () => {
    // `second` joined before `first`, so list order is the opposite of path order.
    const w = arena([
      archer(), { id: "second", at: { x: 450, y: 320 }, faction: "plague" }, { id: "first", at: { x: 400, y: 320 }, faction: "plague" },
      idle(),
    ]);
    loose(w, [{ id: "archer", a: 0 }]);
    const { end, events } = flyUntilEnd(w);
    expect(end).toMatchObject({ reason: "hit" });
    expect(end.x).toBeCloseTo(386, 6);
    expect(fxOf(events, "hit").map((h) => h.id)).toEqual(["first"]);
    expect(P(w, "first").hp).toBeLessThan(FACTIONS.plague.hp);
    expect(P(w, "second").hp).toBe(FACTIONS.plague.hp);
    expect(w.projectiles.size).toBe(0);
  });

  it("flies through a fighter who is already down", () => {
    const w = arena([archer(), { id: "down", at: { x: 400, y: 320 }, faction: "plague" }, target({ x: 450, y: 320 }), idle()]);
    applyDamage(w, P(w, "down"), RT(w, "down"), 5000, "test");
    expect(P(w, "down").status).toBe("dead");
    loose(w, [{ id: "archer", a: 0 }]);
    const { end, events } = flyUntilEnd(w);
    expect(end.x).toBeCloseTo(436, 6);
    expect(fxOf(events, "hit").map((h) => h.id)).toEqual(["target"]);
  });

  it("hits a mob like a player, with no armor or shield to cut it", () => {
    const w = arena([archer(), idle(), idle("idle2", { x: 1200, y: 100 })]);
    const mob = addMob(w, { kind: "dummy", name: "Dummy", at: { x: 400, y: 320 } });
    loose(w, [{ id: "archer", a: 0 }]);
    const { end } = flyUntilEnd(w);
    expect(end).toMatchObject({ reason: "hit" });
    const raw = damagePerHit(pacedFaction(FACTIONS.sentenced), "bow");
    expect(w.state.mobs.get(mob)!.hp).toBeCloseTo(w.state.mobs.get(mob)!.maxHp - raw, 9);
  });
});

describe("walls and gates", () => {
  it("stops an arrow at the face of a wall and leaves what is behind it alone", () => {
    const w = arena([archer(), target({ x: 500, y: 320 }), idle()], openMap((tiles) => {
      for (let ty = 1; ty < H_TILES - 1; ty++) tiles[ty * W_TILES + 12] = TILE_WALL;
    }));
    loose(w, [{ id: "archer", a: 0 }]);
    const { ticks: n, end } = flyUntilEnd(w);
    expect(end).toMatchObject({ proj: "arrow", reason: "wall" });
    expect(end.x).toBeCloseTo(12 * TILE, 6);
    expect(end.y).toBeCloseTo(320, 6);
    expect(n).toBe(Math.ceil((12 * TILE - 200) / ARROW_TICK));
    expect(P(w, "target").hp).toBe(FACTIONS.fire.hp);
  });

  it("stops a ball at a wall, and an arrow at the border above", () => {
    const wall = arena([mage(), idle(), idle("idle2", { x: 1200, y: 100 })], openMap((tiles) => {
      for (let ty = 1; ty < H_TILES - 1; ty++) tiles[ty * W_TILES + 12] = TILE_WALL;
    }));
    castBall(wall, "mage", 0);
    expect(flyUntilEnd(wall).end).toMatchObject({ proj: "ball", reason: "wall", x: expect.closeTo(384, 6) });

    const up = arena([archer(), idle(), idle("idle2", { x: 1200, y: 100 })]);
    loose(up, [{ id: "archer", a: -Math.PI / 2 }]);
    const { end } = flyUntilEnd(up);
    expect(end.reason).toBe("wall");
    expect(end.y).toBeCloseTo(TILE, 6);
    expect(end.x).toBeCloseTo(200, 6);
  });

  it("hits a body standing in front of the wall before it reaches the wall", () => {
    const w = arena([archer(), target({ x: 370, y: 320 }), idle()], openMap((tiles) => {
      for (let ty = 1; ty < H_TILES - 1; ty++) tiles[ty * W_TILES + 12] = TILE_WALL;
    }));
    loose(w, [{ id: "archer", a: 0 }]);
    expect(flyUntilEnd(w).end).toMatchObject({ reason: "hit", x: expect.closeTo(356, 6) });
  });

  it("flies through an open gate and stops at it once the gates are locked", () => {
    const open = arena([archer(), target({ x: 500, y: 320 }), idle()], gatedMap());
    expect(open.state.gatesLocked).toBe(false);
    loose(open, [{ id: "archer", a: 0 }]);
    expect(flyUntilEnd(open).end).toMatchObject({ reason: "hit", x: expect.closeTo(486, 6) });

    const shut = arena([archer(), target({ x: 500, y: 320 }), idle()], gatedMap());
    shut.state.gatesLocked = true;
    loose(shut, [{ id: "archer", a: 0 }]);
    expect(flyUntilEnd(shut).end).toMatchObject({ reason: "wall", x: expect.closeTo(12 * TILE, 6), y: expect.closeTo(320, 6) });
    expect(P(shut, "target").hp).toBe(FACTIONS.fire.hp);
  });

  it("reads the gates every substep: a gate that shuts mid-flight stops the arrow", () => {
    const w = arena([archer(), target({ x: 500, y: 320 }), idle()], gatedMap());
    loose(w, [{ id: "archer", a: 0 }]);
    ticks(w, 2);
    w.state.gatesLocked = true;
    expect(flyUntilEnd(w).end.reason).toBe("wall");
  });
});

describe("range", () => {
  it("flies the catalog's own ranges (the 9.1 tuning: bow 240 u, wand 220 u)", () => {
    expect(CATALOG_RANGES).toEqual({ bow: 240, wand: 220 });
    const bow = WEAPONS.bow.shape;
    const wand = WEAPONS.wand.shape;
    if (bow.kind !== "projectile" || wand.kind !== "projectile") throw new Error("projectile");
    const [bowTest, wandTest] = [bow.range, wand.range];
    bow.range = CATALOG_RANGES.bow;
    wand.range = CATALOG_RANGES.wand;
    try {
      const a = arena([archer({ x: 100, y: 320 }), idle(), idle("idle2", { x: 1200, y: 100 })]);
      loose(a, [{ id: "archer", a: 0 }]);
      expect(lastProjectile(a).launch.range).toBe(240);
      const arrow = flyUntilEnd(a);
      expect(arrow.end.reason).toBe("range");
      expect(arrow.end.x).toBeCloseTo(100 + 240, 6);

      const m = arena([mage({ x: 100, y: 320 }), idle(), idle("idle2", { x: 1200, y: 100 })]);
      castBall(m, "mage", 0);
      expect(lastProjectile(m).launch.range).toBe(220);
      const ball = flyUntilEnd(m);
      expect(ball.end).toMatchObject({ proj: "ball", reason: "range" });
      expect(ball.end.x).toBeCloseTo(100 + 220, 6);
      // A body just inside the reach of the end of the range is still hit; just outside it is not.
      const far = arena([archer({ x: 100, y: 320 }), target({ x: 100 + 240 + RANGED_HIT_REACH + 1, y: 320 }), idle()]);
      loose(far, [{ id: "archer", a: 0 }]);
      expect(flyUntilEnd(far).end.reason).toBe("range");
    } finally {
      bow.range = bowTest;
      wand.range = wandTest;
    }
  });

  it("stops an arrow exactly 480 u from where it left, in the tick that covers it", () => {
    const w = arena([archer({ x: 100, y: 320 }), idle(), idle("idle2", { x: 1200, y: 100 })]);
    loose(w, [{ id: "archer", a: 0 }]);
    const { ticks: n, end } = flyUntilEnd(w);
    expect(end.reason).toBe("range");
    expect(end.x).toBeCloseTo(580, 6);
    expect(end.y).toBeCloseTo(320, 6);
    expect(n).toBe(Math.ceil(ARROW.range / ARROW_TICK));
    expect(w.projectiles.size).toBe(0);
  });

  it("stops a ball exactly 420 u out", () => {
    const w = arena([mage({ x: 100, y: 320 }), idle(), idle("idle2", { x: 1200, y: 100 })]);
    castBall(w, "mage", 0);
    const { ticks: n, end } = flyUntilEnd(w);
    expect(end).toMatchObject({ proj: "ball", reason: "range" });
    expect(end.x).toBeCloseTo(520, 6);
    expect(n).toBe(Math.ceil(BALL.range / BALL_TICK));
  });

  it("measures the range along the flight, not along an axis", () => {
    const w = arena([archer({ x: 100, y: 320 }), idle(), idle("idle2", { x: 1200, y: 100 })]);
    const a = -0.5;
    loose(w, [{ id: "archer", a }]);
    const { end } = flyUntilEnd(w);
    expect(end.reason).toBe("range");
    expect(end.x).toBeCloseTo(100 + Math.cos(a) * 480, 6);
    expect(end.y).toBeCloseTo(320 + Math.sin(a) * 480, 6);
  });

  it("is still in flight a tick before it, and gone after", () => {
    const w = arena([archer({ x: 100, y: 320 }), idle(), idle("idle2", { x: 1200, y: 100 })]);
    loose(w, [{ id: "archer", a: 0 }]);
    ticks(w, 10);
    expect(w.projectiles.size).toBe(1);
    expect(fxOf(tick(w), "projEnd")).toHaveLength(1);
    expect(w.projectiles.size).toBe(0);
  });
});

describe("the projEnd fx", () => {
  it("carries the projectile's id, kind, origin and launch time, and the exact end point and reason", () => {
    const w = arena([archer({ x: 100, y: 300 }), idle(), idle("idle2", { x: 1200, y: 100 })]);
    loose(w, [{ id: "archer", a: 0.2 }]);
    const { id, launch: st } = lastProjectile(w);
    const { end } = flyUntilEnd(w);
    expect(end).toEqual({
      kind: "projEnd", id, proj: "arrow", x0: 100, y0: 300, t0: st.t, x: expect.closeTo(100 + Math.cos(0.2) * 480, 6),
      y: expect.closeTo(300 + Math.sin(0.2) * 480, 6), reason: "range",
    });
  });

  it("says where a hit landed: the contact point, not the body's centre", () => {
    const w = arena([archer(), target({ x: 400, y: 330 }), idle()]);
    loose(w, [{ id: "archer", a: 0 }]);
    const { end } = flyUntilEnd(w);
    expect(end.reason).toBe("hit");
    expect(end.y).toBeCloseTo(320, 6);
    expect(dist(end, { x: 400, y: 330 })).toBeCloseTo(RANGED_HIT_REACH, 6);
  });
});

describe("shield reflection", () => {
  const archerAt = { x: 200, y: 320 };
  const holderAt = { x: 500, y: 320 };

  it("reflects a frontal arrow into a new one owned by the holder, from the contact point, with the mirrored velocity", () => {
    const w = arena([archer(archerAt), holder(holderAt), idle()]);
    loose(w, [{ id: "archer", a: 0 }]);
    const original = lastProjectile(w);
    const packet = { ...original.packet };
    const { end, events } = flyUntilEnd(w);
    expect(end).toMatchObject({ id: original.id, proj: "arrow", reason: "reflected" });
    expect(end.x).toBeCloseTo(486, 6);
    expect(end.y).toBeCloseTo(320, 6);
    expect(w.projectiles.has(original.id)).toBe(false);

    const next = lastProjectile(w);
    expect(next.id).not.toBe(original.id);
    const v = reflectVelocity(900, 0, Math.PI);
    expect(launched(next)).toMatchObject({
      kind: "arrow", owner: "holder", x: expect.closeTo(486, 6), y: expect.closeTo(320, 6), vx: expect.closeTo(v.vx, 6),
      vy: expect.closeTo(v.vy, 6), range: 480,
    });
    expect(v.vx).toBeCloseTo(-900, 6);
    expect(next).toMatchObject({ kind: "arrow", weapon: "shield", owner: "holder", ownerName: "Holder" });
    // The shield returns only ARROW_REFLECT_SHARE of the arrow; the holder takes the rest as a hit.
    expect(next.packet).toEqual({ ...packet, raw: packet.raw * ARROW_REFLECT_SHARE });
    // It left in the substep of the contact, so its time is on the 10 ms grid inside this tick.
    const tickStart = w.state.serverTime - TICK_MS;
    expect(next.launch.t).toBeGreaterThan(tickStart);
    expect((next.launch.t - tickStart) % 10).toBe(0);
    expect(fxOf(events, "block")).toEqual([{ kind: "block", id: "holder", by: "archer", weapon: "bow" }]);
    const through = hitAmount("sentenced", "bow", "frost") * (1 - ARROW_REFLECT_SHARE);
    expect(fxOf(events, "hit")).toEqual([{ kind: "hit", id: "holder", by: "archer", amount: expect.closeTo(through, 9), weapon: "bow" }]);
    expect(FACTIONS.frost.hp - P(w, "holder").hp).toBeCloseTo(through, 9);
  });

  it("mirrors an oblique arrow about the shield's facing, keeps its speed and flies the full bow range from the contact", () => {
    const facing = Math.PI - 0.3;
    const w = arena([archer(archerAt), holder(holderAt, facing), idle()]);
    loose(w, [{ id: "archer", a: 0 }]);
    expect(flyUntilEnd(w).end.reason).toBe("reflected");
    const next = lastProjectile(w);
    const v = reflectVelocity(900, 0, facing);
    expect(next.launch.vx).toBeCloseTo(v.vx, 6);
    expect(next.launch.vy).toBeCloseTo(v.vy, 6);
    expect(Math.hypot(next.launch.vx, next.launch.vy)).toBeCloseTo(900, 6);
    expect(next.launch.range).toBe(480);
    const { end } = flyUntilEnd(w);
    expect(end.reason).toBe("range");
    expect(end.x0).toBeCloseTo(486, 6);
    expect(Math.hypot(end.x - end.x0, end.y - end.y0)).toBeCloseTo(480, 6);
    expect(P(w, "archer").hp).toBe(FACTIONS.sentenced.hp);
  });

  it("gives the reflected arrow the full bow range, however much of the first one's range was used", () => {
    // The first arrow has flown 286 of its 480 u when it reaches the shield; the reflected one still gets all 480.
    const w = arena([archer(archerAt), holder(holderAt, Math.PI - 0.3), idle()]);
    loose(w, [{ id: "archer", a: 0 }]);
    const { end } = flyUntilEnd(w);
    const used = Math.hypot(end.x - end.x0, end.y - end.y0);
    expect(used).toBeCloseTo(286, 6);
    expect(lastProjectile(w).launch.range).toBe(ARROW.range);
    expect(lastProjectile(w).launch.range).toBeGreaterThan(ARROW.range - used);
  });

  it("two shields facing each other cannot bounce an arrow forever: a second reflection keeps only the range it has left", () => {
    // The archer stands between them at x 400, looses east and is gone; the shields at 300 (facing east) and 500 (facing
    // west) are 172 u apart between their contact points (314 and 486).
    const w = arena([archer({ x: 400, y: 320 }), holder({ x: 500, y: 320 }), { ...holder({ x: 300, y: 320 }, 0), id: "holder2" }]);
    loose(w, [{ id: "archer", a: 0 }]);
    applyDamage(w, P(w, "archer"), RT(w, "archer"), 5000, "test");
    const reasons: string[] = [];
    const ranges: number[] = [];
    let flown = 0;
    while (w.projectiles.size > 0 && flown < 40) {
      flown++;
      for (const e of fxOf(tick(w), "projEnd")) {
        reasons.push(e.reason);
        if (e.reason === "reflected") ranges.push(lastProjectile(w).launch.range);
      }
    }
    // 86 u to the first shield, a full 480 u from there, the second reflection keeps what is left (480 - 172), and the
    // third shield front just blocks it (MAX_ARROW_REFLECTIONS).
    expect(MAX_ARROW_REFLECTIONS).toBe(2);
    expect(w.projectiles.size).toBe(0);
    expect(reasons).toEqual(["reflected", "reflected", "blocked"]);
    expect(ranges).toEqual([ARROW.range, expect.closeTo(ARROW.range - 172, 6)]);
    expect(flown * TICK_MS).toBeLessThan(2000);
    // Each reflection costs the holder the part it did not return (1 - share) of what the arrow still carries; the block takes nothing more.
    const full = hitAmount("sentenced", "bow", "frost");
    expect(FACTIONS.frost.hp - P(w, "holder").hp).toBeCloseTo(full * (1 - ARROW_REFLECT_SHARE), 9);
    expect(FACTIONS.frost.hp - P(w, "holder2").hp).toBeCloseTo(full * ARROW_REFLECT_SHARE * (1 - ARROW_REFLECT_SHARE), 9);
  });

  it("a block of an arrow that was already reflected is passive: it is no attack of the holder that owns it", () => {
    // Same layout as above: the first shield blocks the archer's own arrow, the second blocks the one the first sent back.
    const w = arena([archer({ x: 400, y: 320 }), holder({ x: 500, y: 320 }), { ...holder({ x: 300, y: 320 }, 0), id: "holder2" }]);
    loose(w, [{ id: "archer", a: 0 }]);
    applyDamage(w, P(w, "archer"), RT(w, "archer"), 5000, "test");
    const blocks: Array<Fx<"block">> = [];
    for (let n = 0; n < 40 && blocks.length < 2; n++) blocks.push(...fxOf(tick(w), "block"));
    expect(blocks).toEqual([
      { kind: "block", id: "holder", by: "archer", weapon: "bow" },
      { kind: "block", id: "holder2", by: "holder", weapon: "shield", passive: true },
    ]);
    expect(blocks[0]).not.toHaveProperty("passive");
  });

  /** Two Frost shields face to face, overlapping (A at 300 facing east, B 16 u east facing west), and an archer. */
  function contactPair(archerAt: Vec2): World {
    return arena([
      archer(archerAt), { id: "a", at: { x: 300, y: 320 }, faction: "frost", facing: 0 },
      { id: "b", at: { x: 316, y: 320 }, faction: "frost", facing: Math.PI },
    ]);
  }

  /** Flies until nothing is left or `maxTicks` pass; counts reflections and blocks. */
  function flyOut(w: World, maxTicks: number): { ticks: number; reflected: number; blocked: number } {
    let reflected = 0;
    let blocked = 0;
    let n = 0;
    while (w.projectiles.size > 0 && n < maxTicks) {
      n++;
      for (const e of fxOf(tick(w), "projEnd")) {
        if (e.reason === "reflected") reflected++;
        if (e.reason === "blocked") blocked++;
      }
    }
    return { ticks: n, reflected, blocked };
  }

  it("ends an arrow that hits two overlapping shields face to face: at most two reflections, then it is blocked", () => {
    // The exact setup that bounced about five times a tick forever before the cap (every reflection started inside the
    // other shield's reach, so it hit again at its own start point, and range never shrank).
    const w = contactPair({ x: 567.8, y: 470 });
    loose(w, [{ id: "archer", a: -2.653 }]);
    const out = flyOut(w, 40);
    expect(w.projectiles.size).toBe(0);
    expect(out.reflected).toBeLessThanOrEqual(MAX_ARROW_REFLECTIONS);
    expect(out.ticks).toBeLessThan(20);
    // The two reflections cost the pair share^k x (1 - share) of the arrow each: together 1 - share^reflections of it.
    const lost = FACTIONS.frost.hp * 2 - P(w, "a").hp - P(w, "b").hp;
    expect(lost).toBeCloseTo(hitAmount("sentenced", "bow", "frost") * (1 - ARROW_REFLECT_SHARE ** out.reflected), 9);
  });

  it("ends every arrow chain quickly from any angle around the overlapping pair (a sweep of the geometry)", () => {
    const mid = { x: 308, y: 320 };
    let checked = 0;
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = (deg * Math.PI) / 180;
      const from = { x: mid.x + Math.cos(rad) * 300, y: mid.y + Math.sin(rad) * 300 };
      for (const off of [-12, -4, 0, 4, 12]) {
        const w = contactPair(from);
        loose(w, [{ id: "archer", a: Math.atan2(mid.y + off - from.y, mid.x - from.x) }]);
        const out = flyOut(w, 60);
        expect(w.projectiles.size, `from ${deg} deg, offset ${off}`).toBe(0);
        expect(out.reflected, `from ${deg} deg, offset ${off}`).toBeLessThanOrEqual(2);
        checked++;
      }
    }
    expect(checked).toBe(24 * 5);
  });

  it("can hit the archer on the way back, dealing the same packet under the archer's own armor and shield", () => {
    const w = arena([archer(archerAt), holder(holderAt), idle()]);
    loose(w, [{ id: "archer", a: 0 }]);
    const packet = { ...lastProjectile(w).packet };
    flyUntilEnd(w);
    const { end, events } = flyUntilEnd(w);
    expect(end).toMatchObject({ reason: "hit" });
    expect(end.x).toBeCloseTo(214, 6);
    const expected = mitigateShares(packet.raw * ARROW_REFLECT_SHARE, packet, FACTIONS.sentenced);
    expect(fxOf(events, "hit")).toEqual([{ kind: "hit", id: "archer", by: "holder", amount: expect.closeTo(expected, 9), weapon: "shield" }]);
    expect(FACTIONS.sentenced.hp - P(w, "archer").hp).toBeCloseTo(expected, 9);
    // Reflection preserves the launched packet; only the archer's current defenses mitigate the reflected share.
    expect(expected).toBeCloseTo(hitAmount("sentenced", "bow", "sentenced", ARROW_REFLECT_SHARE), 9);
  });

  it("a reflected arrow is returned damage: passive, so a Spiked Shell on the archer does not answer its own arrow (the final review's m1)", () => {
    const w = arena([archer(archerAt), holder(holderAt), idle()]);
    P(w, "archer").build.set("spikedShell", 1);
    recomputeMods(w, combatant(w, "archer")!);
    loose(w, [{ id: "archer", a: 0 }]);
    flyUntilEnd(w);
    const { end } = flyUntilEnd(w);
    expect(end).toMatchObject({ reason: "hit" });
    const back = w.combat.landed.filter((h) => h.victim === "archer");
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ by: "holder", weapon: "shield", passive: true });
    // Not a melee hit taken: nothing queued for the next tick, and the archer's hit does not count as a weapon hit of the holder's.
    expect(w.combat.deferred).toEqual([]);
  });

  it("the arrow that hits the first holder's shield again is returned damage too (the second reflection's rest)", () => {
    const w = arena([archer({ x: 400, y: 320 }), holder({ x: 500, y: 320 }), { ...holder({ x: 300, y: 320 }, 0), id: "holder2" }]);
    loose(w, [{ id: "archer", a: 0 }]);
    applyDamage(w, P(w, "archer"), RT(w, "archer"), 5000, "test");
    const seen: Array<{ by: string; victim: string; passive?: boolean }> = [];
    for (let n = 0; n < 40 && w.projectiles.size > 0; n++) {
      tick(w);
      for (const h of w.combat.landed) seen.push(h);
    }
    // holder takes the archer's own arrow as a normal hit; holder2 takes holder's reflected arrow, which is returned damage.
    expect(seen.find((h) => h.victim === "holder")).toMatchObject({ by: "archer" });
    expect(seen.find((h) => h.victim === "holder")?.passive).toBeUndefined();
    expect(seen.find((h) => h.victim === "holder2")).toMatchObject({ by: "holder", passive: true });
  });

  it("a Boom holder's returned x1.25 is in the arrow it reflects, and only in that (the final review's m2)", () => {
    const hitOn = (rows: Effect[]): number => {
      const w = arena([archer(archerAt), holder(holderAt), idle()]);
      setExtraRows(w, combatant(w, "holder")!, rows);
      loose(w, [{ id: "archer", a: 0 }]);
      flyUntilEnd(w);
      flyUntilEnd(w);
      return FACTIONS.sentenced.hp - P(w, "archer").hp;
    };
    const plain = hitOn([]);
    expect(plain).toBeGreaterThan(0);
    expect(hitOn([{ k: "mult", key: "returned", v: 1.25 }])).toBeCloseTo(plain * 1.25, 9);
    expect(hitOn([{ k: "mult", key: "dot", v: 1.25 }, { k: "mult", key: "hit", v: 2.5 }])).toBeCloseTo(plain, 9); // the other kinds' mults are not
  });

  it("credits the kill to the shield holder", () => {
    // 0.2 hp: the reflected arrow carries ARROW_REFLECT_SHARE (0.15) of its damage, about 0.4 hp against Sentenced's magic resist.
    const w = arena([archer(archerAt, 0.2), holder(holderAt), idle()]);
    loose(w, [{ id: "archer", a: 0 }]);
    expect(flyUntilEnd(w).end.reason).toBe("reflected");
    const rest = flyUntilEnd(w);
    expect(fxOf(rest.events, "death")).toEqual([{ kind: "death", id: "archer", x: 200, y: 320, by: "holder" }]);
    const result = ofType(rest.events, "resolved").find((e) => e.id === "archer")!.result;
    expect(result).toMatchObject({ outcome: "died", killedBy: "Holder" });
    expect(P(w, "holder").kills).toBe(1);
    expect(P(w, "holder").gv).toBe(GV_KILL);
    expect(RT(w, "holder").damaged.has("archer")).toBe(true);
  });

  it.each([
    [59, true],
    [61, false],
  ])("covers a hit %i degrees off the shield's facing: %s", (deg, covered) => {
    const facing = Math.PI + (deg * Math.PI) / 180;
    const w = arena([archer(archerAt), holder(holderAt, facing), idle()]);
    loose(w, [{ id: "archer", a: 0 }]);
    const { end, events } = flyUntilEnd(w);
    expect(end.reason).toBe(covered ? "reflected" : "hit");
    expect(fxOf(events, "block")).toHaveLength(covered ? 1 : 0);
    // Covered: the part the shield does not return still hits the holder; uncovered: the whole arrow does.
    expect(fxOf(events, "hit")).toHaveLength(1);
    expect(fxOf(events, "hit")[0]!.amount).toBeCloseTo(hitAmount("sentenced", "bow", "frost") * (covered ? 1 - ARROW_REFLECT_SHARE : 1), 9);
  });

  it("hits a holder whose shield faces away", () => {
    const w = arena([archer(archerAt), holder(holderAt, 0), idle()]);
    loose(w, [{ id: "archer", a: 0 }]);
    const { end, events } = flyUntilEnd(w);
    expect(end.reason).toBe("hit");
    expect(fxOf(events, "block")).toEqual([]);
    expect(FACTIONS.frost.hp - P(w, "holder").hp).toBeCloseTo(hitAmount("sentenced", "bow", "frost"), 9);
  });

  it("does not reflect when the shield is in the bag and another weapon is in hand", () => {
    const w = arena([archer(archerAt), { ...holder(holderAt), weapons: ["axe", "shield"] }, idle()]);
    loose(w, [{ id: "archer", a: 0 }]);
    expect(flyUntilEnd(w).end.reason).toBe("hit");
  });

  it("lets a wand ball pierce a shield", () => {
    const w = arena([mage(archerAt), holder(holderAt), idle()]);
    castBall(w, "mage", 0);
    const { end, events } = flyUntilEnd(w);
    expect(end).toMatchObject({ proj: "ball", reason: "hit" });
    expect(fxOf(events, "block")).toEqual([]);
    expect(FACTIONS.frost.hp - P(w, "holder").hp).toBeCloseTo((96 * DUEL_PACE * WEAPONS.wand.dpsMult) / 1.65 / (1 + 20 / 100), 9);
  });

  it("reflects off a shield held by a mob; a kill by that arrow is credited to its name only", () => {
    const w = arena([archer(archerAt, 0.2), idle(), idle("idle2", { x: 1200, y: 100 })]);
    const mob = addMob(w, { kind: "dummy", name: "Warden", at: holderAt, facing: Math.PI, weapon: "shield" });
    loose(w, [{ id: "archer", a: 0 }]);
    expect(flyUntilEnd(w).end.reason).toBe("reflected");
    expect(lastProjectile(w)).toMatchObject({ owner: mob, ownerName: "Warden", weapon: "shield" });
    const { events } = flyUntilEnd(w);
    expect(ofType(events, "resolved").find((e) => e.id === "archer")!.result.killedBy).toBe("Warden");
    expect(fxOf(events, "death")).toEqual([expect.objectContaining({ id: "archer", by: null })]);
    expect([...w.state.players.values()].map((p) => p.kills)).toEqual([0, 0, 0]);
  });
});

describe("balls and arrows meeting in the air", () => {
  const archerAt = { x: 900, y: 320 };
  const mageAt = { x: 420, y: 320 };

  /** Arrow loosed from the east, then a ball from the west toward it; stops when the arrow's projEnd shows up. */
  function headOn(offset: number) {
    const w = arena([archer({ x: archerAt.x, y: archerAt.y + offset }), mage(mageAt), idle()]);
    loose(w, [{ id: "archer", a: Math.PI }]);
    const arrow = lastProjectile(w);
    castBall(w, "mage", 0);
    const ball = lastProjectile(w);
    return { w, arrow, ball };
  }

  it("deletes an enemy arrow that comes within BALL_ARROW_RADIUS of the ball and flies on", () => {
    const { w, arrow, ball } = headOn(20);
    const ballRaw = ball.packet.raw;
    const { end, events } = flyUntilEnd(w);
    expect(end).toMatchObject({ id: arrow.id, proj: "arrow", reason: "deleted" });
    expect(ball.packet.raw).toBeCloseTo(ballRaw * BALL_AFTER_ARROW, 12); // deleting an arrow costs the ball part of its damage
    // At the substep it went, the ball (where its announced straight line puts it) was within the radius of where the arrow stopped.
    const st = ball.launch;
    const ballAt = (t: number): Vec2 => ({ x: st.x + (st.vx * (t - st.t)) / 1000, y: st.y + (st.vy * (t - st.t)) / 1000 });
    const tickStart = w.state.serverTime - TICK_MS;
    const gaps = [1, 2, 3, 4, 5].map((k) => dist(end, ballAt(tickStart + 10 * k)));
    expect(Math.min(...gaps)).toBeLessThanOrEqual(BALL_ARROW_RADIUS);
    expect(arrow.ended).toBe(true);
    expect(w.projectiles.has(arrow.id)).toBe(false);
    expect(ball.ended).toBe(false);
    expect(fxOf(events, "hit")).toEqual([]);
    expect(ball.simT).toBe(w.state.serverTime); // not slowed or stopped by the meeting
    const next = flyUntilEnd(w);
    expect(next.end).toMatchObject({ id: ball.id, proj: "ball", reason: "range" }); // an arrow never deletes a ball
  });

  it("lets an arrow pass a ball that is farther away than BALL_ARROW_RADIUS", () => {
    const { w, arrow, ball } = headOn(40);
    const ends = new Map<string, string>();
    for (let i = 0; i < 40 && w.projectiles.size > 0; i++) for (const e of fxOf(tick(w), "projEnd")) ends.set(e.id, e.reason);
    expect(ends.get(arrow.id)).toBe("range");
    expect(ends.get(ball.id)).toBe("range");
  });

  describe("where they came closest, and in sight", () => {
    /** Out of the way of every line below. */
    const duelists = (map?: GameMap): World => arena([archer({ x: 1200, y: 500 }), mage({ x: 1200, y: 100 }), idle("idle", { x: 1200, y: 300 })], map);
    const endOf = (pr: ProjectileRuntime): Vec2 => ({ x: pr.launch.x + pr.launch.vx / 100, y: pr.launch.y + pr.launch.vy / 100 });

    /** A ball flying east and an arrow flying west `offset` u to one side of it, 6.4 u apart along the line: they pass in mid-substep. */
    function pass(offset: number) {
      const w = duelists();
      const [ball, arrow] = launchShots(w, [
        { owner: "mage", kind: "ball", at: { x: 600, y: 320 }, a: 0 },
        { owner: "archer", kind: "arrow", at: { x: 606.4, y: 320 + offset }, a: Math.PI },
      ]) as [ProjectileRuntime, ProjectileRuntime];
      // Head on they close 12.8 u a substep, and at the end of it they are already past each other.
      expect(dist(endOf(ball), endOf(arrow))).toBeGreaterThan(BALL_ARROW_RADIUS);
      return { w, ball, arrow, events: substep(w) };
    }

    it("deletes an arrow whose path passes 27.5 u from the ball's, though the substep ends more than 28 u apart", () => {
      const { ball, arrow, events } = pass(27.5);
      expect(arrow.ended).toBe(true);
      expect(ball.ended).toBe(false);
      // Where they were closest: the middle of the substep.
      expect(fxOf(events, "projEnd")).toEqual([
        expect.objectContaining({ id: arrow.id, proj: "arrow", reason: "deleted", x: expect.closeTo(601.9, 6), y: expect.closeTo(347.5, 6) }),
      ]);
    });

    it("lets an arrow pass 28.5 u from the ball's, whatever the substep ends look like", () => {
      const { ball, arrow, events } = pass(28.5);
      expect([arrow.ended, ball.ended]).toEqual([false, false]);
      expect(fxOf(events, "projEnd")).toEqual([]);
    });

    it("does not delete an arrow 24 u from the ball across a wall corner, where neither can see the other; in the open it does", () => {
      // The wall is tile (12, 9): x 384..416, y 288..320. The ball climbs its east face (x 418), the arrow runs along its south one (y 322).
      const pair = (map: GameMap): boolean => {
        const w = duelists(map);
        const [ball, arrow] = launchShots(w, [
          { owner: "mage", kind: "ball", at: { x: 418, y: 303 }, a: -Math.PI / 2 },
          { owner: "archer", kind: "arrow", at: { x: 401.5, y: 322 }, a: 0 },
        ]) as [ProjectileRuntime, ProjectileRuntime];
        expect(dist(endOf(ball), endOf(arrow))).toBeCloseTo(24, 0);
        substep(w);
        return arrow.ended;
      };
      expect(pair(openMap((tiles) => { tiles[9 * W_TILES + 12] = TILE_WALL; }))).toBe(false);
      expect(pair(openMap())).toBe(true);
    });

    it("keeps a pair that skirts a wall corner apart for the whole flight, and the same pair in the open meets", () => {
      // The same wall; the ball climbs its east face, the arrow runs along its south one and on past the ball's line.
      const fly = (map: GameMap) => {
        const w = duelists(map);
        const [ball, arrow] = launchShots(w, [
          { owner: "mage", kind: "ball", at: { x: 418, y: 306 }, a: -Math.PI / 2 },
          { owner: "archer", kind: "arrow", at: { x: 388, y: 322 }, a: 0 },
        ]) as [ProjectileRuntime, ProjectileRuntime];
        const reasons = new Map<string, string>();
        for (let i = 0; i < 40 && w.projectiles.size > 0; i++) for (const e of fxOf(tick(w), "projEnd")) reasons.set(e.id, e.reason);
        return { arrow: reasons.get(arrow.id), ball: reasons.get(ball.id) };
      };
      expect(fly(openMap((tiles) => { tiles[9 * W_TILES + 12] = TILE_WALL; }))).toEqual({ arrow: "range", ball: "wall" });
      expect(fly(openMap())).toEqual({ arrow: "deleted", ball: "wall" });
    });
  });

  it("does not delete the arrows of the ball's own owner", () => {
    const w = arena([{ ...mage(), weapons: ["wand", "bow"] }, target({ x: 1100, y: 500 }), idle()]);
    castBall(w, "mage", 0);
    const ball = lastProjectile(w);
    P(w, "mage").slot = 1; // the swap itself is not under test
    loose(w, [{ id: "mage", a: 0 }]);
    const arrow = lastProjectile(w);
    expect(arrow.kind).toBe("arrow");
    let closest = Infinity;
    const ends = new Map<string, string>();
    for (let i = 0; i < 40 && w.projectiles.size > 0; i++) {
      for (const e of fxOf(tick(w), "projEnd")) ends.set(e.id, e.reason);
      if (!arrow.ended && !ball.ended) closest = Math.min(closest, dist(arrow, ball));
    }
    expect(closest).toBeLessThan(BALL_ARROW_RADIUS); // it did fly through the ball
    expect(ends.get(arrow.id)).toBe("range");
    expect(ends.get(ball.id)).toBe("range");
  });

  it("lets two balls, and two arrows, cross without touching each other", () => {
    const balls = arena([mage({ x: 300, y: 320 }), { ...mage({ x: 900, y: 320 }), id: "mage2" }, idle()]);
    castBall(balls, "mage", 0);
    castBall(balls, "mage2", Math.PI);
    const seen = new Map<string, string>();
    for (let i = 0; i < 40 && balls.projectiles.size > 0; i++) for (const e of fxOf(tick(balls), "projEnd")) seen.set(e.id, e.reason);
    expect([...seen.values()]).toEqual(["range", "range"]);

    const arrows = arena([archer({ x: 300, y: 320 }), { ...archer({ x: 900, y: 320 }), id: "archer2" }, idle()]);
    loose(arrows, [{ id: "archer", a: 0 }, { id: "archer2", a: Math.PI }]);
    const reasons = new Map<string, string>();
    for (let i = 0; i < 40 && arrows.projectiles.size > 0; i++) for (const e of fxOf(tick(arrows), "projEnd")) reasons.set(e.id, e.reason);
    expect([...reasons.values()]).toEqual(["range", "range"]);
  });
});

describe("the arena teleport", () => {
  it("clears every projectile in flight with reason cleared, at the place each had reached", () => {
    const w = arena([archer(), mage({ x: 200, y: 500 }), idle()]);
    // Both start at once and let go of the trigger a tick later: the ball leaves first (0.4 s of wand against 0.52 s of bow),
    // and a tick after the arrow both are in the air.
    for (const id of ["archer", "mage"]) {
      P(w, id).readyAt = 0;
      RT(w, id).inputs.pushAction({ kind: "attack", a: 0 });
    }
    tick(w);
    for (const id of ["archer", "mage"]) RT(w, id).inputs.pushAction({ kind: "release", a: 0 });
    for (let i = 0; i < 30 && w.projectiles.size < 2; i++) tick(w);
    ticks(w, 1);
    const flying = [...w.projectiles.values()].map((p) => ({ id: p.id, proj: p.kind, x: p.x, y: p.y }));
    expect(flying).toHaveLength(2);
    w.hooks.teleported!(w);
    expect(w.projectiles.size).toBe(0);
    const ends = fxOf(tick(w), "projEnd");
    expect(ends.map((e) => ({ id: e.id, proj: e.proj, x: e.x, y: e.y, reason: e.reason }))).toEqual(
      flying.map((f) => ({ ...f, reason: "cleared" })),
    );
  });

  it("is what a real coliseum teleport does, so nothing follows the players in", () => {
    const w = arena([archer(), target({ x: 800, y: 320 }), idle()]);
    loose(w, [{ id: "archer", a: 0 }]);
    ticks(w, 2);
    expect(w.projectiles.size).toBe(1);
    const id = lastProjectile(w).id;
    w.state.patienceEndsAt = w.state.serverTime + TICK_MS;
    const events = tick(w);
    expect(fxOf(events, "teleport")).toHaveLength(1);
    expect(w.state.gatesLocked).toBe(true);
    expect(fxOf(events, "projEnd")).toEqual([expect.objectContaining({ id, reason: "cleared" })]);
    expect(w.projectiles.size).toBe(0);
    ticks(w, 20);
    expect(w.projectiles.size).toBe(0);
  });

});

describe("the end of the run", () => {
  it("removes every projectile still in flight, with the reason cleared, in the tick the run ends", () => {
    const w = arena([archer(), mage({ x: 200, y: 500 }), target({ x: 900, y: 560 })]);
    loose(w, [{ id: "archer", a: 0 }]);
    castBall(w, "mage", 0);
    const flying = [...w.projectiles.values()].map((pr) => pr.id).sort();
    expect(flying).toHaveLength(2);
    // The caster and the target go down between ticks: the next tick leaves the archer the winner.
    applyDamage(w, P(w, "mage"), RT(w, "mage"), 5000, "test");
    applyDamage(w, P(w, "target"), RT(w, "target"), 5000, "test");
    const events = tick(w);
    expect(w.state).toMatchObject({ phase: "ended", winner: "Archer" });
    expect(fxOf(events, "projEnd").map((e) => [e.id, e.reason]).sort()).toEqual(flying.map((id) => [id, "cleared"]));
    expect(w.projectiles.size).toBe(0);
    expect(ticks(w, 5).filter((e) => e.type === "fx" && e.fx.kind === "projEnd")).toEqual([]);
  });

  it("clears the shots of a shooter who is out of the run too, while the arrow that won it stays a hit", () => {
    const w = arena([archer(), target({ x: 500, y: 320 }, 1), { ...archer({ x: 200, y: 560 }), id: "archer2" }]);
    loose(w, [{ id: "archer", a: 0 }, { id: "archer2", a: 0 }]);
    applyDamage(w, P(w, "archer2"), RT(w, "archer2"), 5000, "test");
    expect(w.projectiles.size).toBe(2);
    const events: SimEvent[] = [];
    for (let i = 0; i < 20 && w.state.phase === "active"; i++) events.push(...tick(w));
    expect(w.state).toMatchObject({ phase: "ended", winner: "Archer" });
    expect(fxOf(events, "projEnd").map((e) => e.reason).sort()).toEqual(["cleared", "hit"]);
    expect(w.projectiles.size).toBe(0);
  });
});

describe("a projectile outlives its owner", () => {
  it("still lands when the owner leaves; the victim's result names the owner and nobody is credited", () => {
    const w = arena([archer(), target({ x: 500, y: 320 }, 1), idle(), idle("idle2", { x: 1200, y: 100 })]);
    loose(w, [{ id: "archer", a: 0 }]);
    ticks(w, 2);
    removePlayer(w, "archer");
    expect(w.players.has("archer")).toBe(false);
    expect(w.projectiles.size).toBe(1);
    w.events = [];
    const { end, events } = flyUntilEnd(w);
    expect(end.reason).toBe("hit");
    expect(fxOf(events, "hit")).toEqual([expect.objectContaining({ id: "target", by: "archer", weapon: "bow" })]);
    expect(P(w, "target").status).toBe("dead");
    expect(ofType(events, "resolved").find((e) => e.id === "target")!.result).toMatchObject({ outcome: "died", killedBy: "Archer" });
    expect(fxOf(events, "death")).toEqual([expect.objectContaining({ id: "target", by: null })]);
    expect(ofType(events, "gv")).toEqual([]);
    expect([...w.state.players.values()].map((p) => p.kills)).toEqual([0, 0, 0]);
  });

  it("lands a non-lethal hit for a departed owner like any other", () => {
    const w = arena([archer(), target({ x: 500, y: 320 }), idle(), idle("idle2", { x: 1200, y: 100 })]);
    loose(w, [{ id: "archer", a: 0 }]);
    removePlayer(w, "archer");
    w.events = [];
    flyUntilEnd(w);
    expect(FACTIONS.fire.hp - P(w, "target").hp).toBeCloseTo(hitAmount("sentenced", "bow", "fire"), 9);
    expect(RT(w, "target").lastHit).toBeNull();
  });

  it("pays no kill GV to an owner whose own result is already out", () => {
    const w = arena([archer(), target({ x: 500, y: 320 }, 1), idle(), idle("idle2", { x: 1200, y: 100 })]);
    loose(w, [{ id: "archer", a: 0 }]);
    applyDamage(w, P(w, "archer"), RT(w, "archer"), 5000, "test");
    expect(RT(w, "archer").resolved).toBe(true);
    w.events = [];
    const { events } = flyUntilEnd(w);
    expect(ofType(events, "resolved").find((e) => e.id === "target")!.result.killedBy).toBe("Archer");
    expect(P(w, "archer").kills).toBe(0);
    expect(P(w, "archer").gv).toBe(0);
    expect(ofType(events, "gv")).toEqual([]);
  });
});

describe("damage numbers", () => {
  it("cuts a Sentenced arrow on Fire using the faction packet and current defenses", () => {
    const w = arena([archer(), target({ x: 400, y: 320 }), idle()]);
    loose(w, [{ id: "archer", a: 0 }]);
    const packet = lastProjectile(w).packet;
    const sentenced = pacedFaction(FACTIONS.sentenced);
    expect(packet.raw).toBeCloseTo(damagePerHit(sentenced, "bow"), 9);
    expect(packet).toMatchObject({ phys: sentenced.phys, true: sentenced.trueShare });
    expect(packet.magic).toBeCloseTo(1 - sentenced.phys - sentenced.trueShare, 12);
    flyUntilEnd(w);
    expect(FACTIONS.fire.hp - P(w, "target").hp).toBeCloseTo(hitAmount("sentenced", "bow", "fire"), 9);
  });

  it("cuts a Holy ball on Frost by Frost's armor (it is all physical)", () => {
    const w = arena([mage(), { id: "frost", at: { x: 400, y: 320 }, faction: "frost", facing: 0 }, idle()]);
    castBall(w, "mage", 0);
    flyUntilEnd(w);
    // hit x pace x wand multiplier / (1 + boost), then Frost's 20 armor.
    expect(FACTIONS.frost.hp - P(w, "frost").hp).toBeCloseTo((96 * DUEL_PACE * WEAPONS.wand.dpsMult) / 1.65 / (1 + 20 / 100), 9);
  });
});

describe("swing interceptions", () => {
  /** A mage and a Frost target in the open; the ball is in the air and `ball` is its runtime. */
  function ballShot() {
    const w = arena([mage(), { id: "frost", at: { x: 500, y: 320 }, faction: "frost", facing: 0 }, idle()]);
    castBall(w, "mage", 0);
    return { w, ball: lastProjectile(w), full: hitAmount("holy", "wand", "frost") };
  }

  it("halves a ball for the rest of its flight, so its hit deals half", () => {
    const { w, ball, full } = ballShot();
    const packet = ball.packet;
    const raw = packet.raw;
    interceptBall(w, ball, { scale: SWORD_BALL_SCALE });
    expect(ball.halved).toBe(true);
    expect(ball.packet).not.toBe(packet); // the old object may be shared with a ledger entry
    expect(packet.raw).toBe(raw);
    expect(ball.packet.raw).toBeCloseTo(raw * SWORD_BALL_SCALE, 12);
    flyUntilEnd(w);
    expect(FACTIONS.frost.hp - P(w, "frost").hp).toBeCloseTo(full * SWORD_BALL_SCALE, 9);
  });

  it("halves a ball only once, however often swings meet it", () => {
    const { w, ball, full } = ballShot();
    interceptBall(w, ball, { scale: SWORD_BALL_SCALE });
    const halved = ball.packet;
    interceptBall(w, ball, { scale: SWORD_BALL_SCALE });
    expect(ball.packet).toBe(halved);
    flyUntilEnd(w);
    expect(FACTIONS.frost.hp - P(w, "frost").hp).toBeCloseTo(full * SWORD_BALL_SCALE, 9);
  });

  it("halves a hit the ball made in the same tick, once", () => {
    const { w, ball, full } = ballShot();
    let n = 0;
    while (ball.traveled < 280 && n++ < 40) flyTick(w);
    expect(ball.ended).toBe(false);
    let entryScale: number[] = [];
    const events = flyTick(w, (world) => {
      interceptBall(world, ball, { scale: SWORD_BALL_SCALE });
      interceptBall(world, ball, { scale: SWORD_BALL_SCALE });
      entryScale = world.combat.ledger.map((e) => e.scale);
    });
    expect(ball.ended).toBe(true);
    expect(entryScale).toEqual([SWORD_BALL_SCALE]);
    expect(fxOf(events, "hit")).toEqual([expect.objectContaining({ id: "frost", amount: expect.closeTo(full * SWORD_BALL_SCALE, 9) })]);
    expect(FACTIONS.frost.hp - P(w, "frost").hp).toBeCloseTo(full * SWORD_BALL_SCALE, 9);
  });

  it("destroys a ball in flight: projEnd destroyed where it was, and it can never hit", () => {
    const { w, ball } = ballShot();
    ticks(w, 3);
    const at = { x: ball.x, y: ball.y };
    interceptBall(w, ball, "destroy");
    expect(fxOf(w.events, "projEnd")).toEqual([expect.objectContaining({ id: ball.id, ...at, reason: "destroyed" })]);
    expect(w.projectiles.size).toBe(0);
    ticks(w, 30);
    expect(P(w, "frost").hp).toBe(FACTIONS.frost.hp);
  });

  it("cancels a hit the ball made in the same tick, with no hit fx and no second projEnd", () => {
    const { w, ball } = ballShot();
    let n = 0;
    while (ball.traveled < 280 && n++ < 40) flyTick(w);
    const events = flyTick(w, (world) => {
      expect(world.combat.ledger).toHaveLength(1);
      interceptBall(world, ball, "destroy");
    });
    expect(fxOf(events, "hit")).toEqual([]);
    expect(fxOf(events, "projEnd")).toEqual([expect.objectContaining({ id: ball.id, reason: "hit" })]);
    expect(P(w, "frost").hp).toBe(FACTIONS.frost.hp);
  });

  it("only touches the ledger entries of the ball it was handed", () => {
    // Two balls reach two different bodies in the same tick; only the first is halved.
    // The two bodies stand farther apart than the wand's splash reaches (each ball would otherwise also splash the other body).
    const w = arena([
      mage({ x: 200, y: 300 }), { ...mage({ x: 200, y: 420 }), id: "mage2" },
      { id: "frostA", at: { x: 500, y: 300 }, faction: "frost", facing: 0 }, { id: "frostB", at: { x: 500, y: 420 }, faction: "frost", facing: 0 },
    ]);
    castBalls(w, [{ id: "mage", a: 0 }, { id: "mage2", a: 0 }]);
    const [a, b] = [...w.projectiles.values()];
    let n = 0;
    while (a!.traveled < 280 && n++ < 60) flyTick(w);
    flyTick(w, (world) => {
      expect(world.combat.ledger).toHaveLength(2);
      interceptBall(world, a!, { scale: 0.5 });
      expect(world.combat.ledger.map((e) => [e.projectile, e.scale])).toEqual([[a!.id, 0.5], [b!.id, 1]]);
    });
    const full = hitAmount("holy", "wand", "frost");
    expect(FACTIONS.frost.hp - P(w, "frostA").hp).toBeCloseTo(full / 2, 9);
    expect(FACTIONS.frost.hp - P(w, "frostB").hp).toBeCloseTo(full, 9);
  });

  it("lists the balls of other owners that flew, were loosed or stopped this tick", () => {
    const w = arena([mage(), { id: "mage2", at: { x: 200, y: 500 }, faction: "holy" }, archer({ x: 200, y: 100 }), idle()]);
    castBall(w, "mage", 0);
    const flying = lastProjectile(w);
    loose(w, [{ id: "archer", a: 0 }]);
    const arrow = lastProjectile(w);
    expect(arrow.kind).toBe("arrow");
    // Loosed this very tick: the ball counts at once, as a point.
    castBall(w, "mage2", 0);
    const fresh = lastProjectile(w);
    expect(ballsThisTick(w, "mage").map((b) => b.id)).toEqual([fresh.id]);
    expect(ballsThisTick(w, "mage2").map((b) => b.id)).toEqual([flying.id]);
    expect(ballsThisTick(w, "archer").map((b) => b.id).sort()).toEqual([flying.id, fresh.id].sort());
    // A ball that stops this tick is still listed for it.
    const stopper = arena([mage({ x: 100, y: 320 }), idle(), idle("idle2", { x: 1200, y: 100 })]);
    castBall(stopper, "mage", 0);
    const ball = lastProjectile(stopper);
    let last: ProjectileRuntime[] = [];
    while (!ball.ended) { tick(stopper); last = ballsThisTick(stopper, "someone"); }
    expect(last.map((b) => b.id)).toEqual([ball.id]);
    expect(ballsThisTick(stopper, "mage")).toEqual([]);
  });
});

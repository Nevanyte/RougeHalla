// The weapon state machine (sim/weapons.ts) driven the way a client drives it: input messages queued, then step().
// The melee phase is replaced by a recorder, so these tests see exactly which swings landed and when, and no damage
// from sim/melee.ts can interfere. Everything is read back from the synced state, the runtime and the emitted fx.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AIM_STALE_MS, attackInterval, ATTACK_BUFFER_MS, BOW_DRAW_MOVE, BOW_MIN_DRAW_DAMAGE, damagePerHit, damageShares, FACTIONS,
  mapFromTiles, MAX_REWIND_MS, mulberry32, pacedFaction, PLAYER_SPEED, RANGED_HIT_REACH, RANGED_RECOVERY_MOVE,
  SIGNATURE_WEAPONS, STAGGER_IMMUNITY_SECONDS, SWAP_SECONDS, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, WAND_CAST_MOVE,
  weaponTimings, wrapAngle, type FactionId, type FxEvent, type GameMap, type Vec2, type WeaponId,
} from "@raid/shared";
import { applyDamage, downPlayer } from "../src/sim/arena";
import { activeWeapon, combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { addMob } from "../src/sim/mobs";
import { positionAt } from "../src/sim/movement";
import { addPlayer, step } from "../src/sim/step";
import {
  cancelAction, moveMultiplierOf, packetFor, resetWeapons, rewindTime, setAim, stagger, weaponChanged,
} from "../src/sim/weapons";
import { newWeaponRuntime, type MeleeRequest, type SimEvent, type World } from "../src/sim/world";

// Every swing that landed, as the melee phase would have received it (the recorder drains world.combat.melee).
const landed = vi.hoisted(() => [] as Array<{ at: number; req: MeleeRequest }>);
vi.mock("../src/sim/melee", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/sim/melee")>();
  return {
    ...real,
    resolveMelee: (world: World): void => {
      for (const req of world.combat.melee) landed.push({ at: world.state.serverTime, req });
      world.combat.melee = [];
    },
  };
});

/** An arrow or ball as it left its owner (what clients are told), plus the damage packet the server keeps. */
interface Shot {
  at: number; id: string; kind: string; owner: string; weapon: WeaponId;
  x: number; y: number; vx: number; vy: number; t: number; range: number; raw: number;
}
const shots: Shot[] = [];
const seenShots = new Set<string>();
const fxLog: Array<{ at: number; fx: FxEvent }> = [];

const NAMES = ["alice", "bob", "carol", "dave", "erin"];
const idOf = (i: number): string => `p${i}`;
/** Far apart, so no arrow or ball in these tests ever reaches another player. */
const HOME: Vec2[] = [{ x: 144, y: 336 }, { x: 1136, y: 112 }, { x: 640, y: 80 }];
const STEP = (PLAYER_SPEED * TICK_MS) / 1000;

/** A walled 40 x 20 tile room, all open floor inside. */
function arenaMap(): GameMap {
  const w = 40;
  const h = 20;
  const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
  for (let x = 0; x < w; x++) { tiles[x] = TILE_WALL; tiles[(h - 1) * w + x] = TILE_WALL; }
  for (let y = 0; y < h; y++) { tiles[y * w] = TILE_WALL; tiles[y * w + w - 1] = TILE_WALL; }
  return { ...mapFromTiles(w, h, tiles), spawns: [{ x: 3 * TILE + 16, y: 10 * TILE + 16 }, { x: 36 * TILE + 16, y: 10 * TILE + 16 }] };
}

function makeWorld(n: number, cfg: { patienceSeconds?: number } = {}): World {
  const patienceSeconds = cfg.patienceSeconds ?? 3600;
  const world = createGameWorld({
    seed: 7,
    config: {
      minPlayers: n, lobbySeconds: 15, fillSeconds: 0, patienceSeconds, patienceMinSeconds: patienceSeconds,
      suddenDeathSeconds: 60,
    },
    random: mulberry32(8),
  });
  world.map = arenaMap();
  for (let i = 0; i < n; i++) addPlayer(world, idOf(i), NAMES[i]!);
  return world;
}

const P = (world: World, i = 0) => world.state.players.get(idOf(i))!;
const RT = (world: World, i = 0) => world.players.get(idOf(i))!;
const C = (world: World, i = 0) => combatant(world, idOf(i))!;
const T = (world: World): number => world.state.serverTime;

/** `n` players in an active run (it starts on the first step, at serverTime TICK_MS), each standing at its HOME. */
function startRun(n = 1, cfg: { patienceSeconds?: number } = {}): World {
  landed.length = 0;
  shots.length = 0;
  seenShots.clear();
  fxLog.length = 0;
  const world = makeWorld(n, cfg);
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  for (let i = 0; i < n; i++) place(world, i, HOME[i]!);
  return world;
}

function place(world: World, i: number, at: Vec2): void {
  const p = P(world, i);
  p.x = at.x;
  p.y = at.y;
  RT(world, i).path = [];
  RT(world, i).history = [{ t: T(world), x: at.x, y: at.y }];
}

/** Gives player `i` a faction and weapons (the faction decides the interval, the damage and so the timings). */
function arm(world: World, i: number, faction: FactionId, w0: WeaponId | "", w1: WeaponId | "" = ""): void {
  const p = P(world, i);
  p.faction = faction;
  p.hp = p.maxHp = FACTIONS[faction].hp;
  p.weapon0 = w0;
  p.weapon1 = w1;
  p.slot = 0;
}

/** One fixed step, logging every fx and every projectile that appeared in it. */
function tick(world: World): SimEvent[] {
  const events = step(world, TICK_MS);
  const at = T(world);
  for (const e of events) if (e.type === "fx") fxLog.push({ at, fx: e.fx });
  for (const pr of world.projectiles.values()) {
    if (seenShots.has(pr.id)) continue;
    seenShots.add(pr.id);
    const st = pr.state;
    shots.push({
      at, id: pr.id, kind: pr.kind, owner: pr.owner, weapon: pr.weapon, x: st.x, y: st.y, vx: st.vx, vy: st.vy, t: st.t,
      range: st.range, raw: pr.packet.raw,
    });
  }
  return events;
}

function run(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) tick(world);
}

/** Steps until serverTime is exactly `time`. */
function runTo(world: World, time: number): void {
  expect(time).toBeGreaterThanOrEqual(T(world));
  while (T(world) < time) tick(world);
  expect(T(world)).toBe(time);
}

function fxOf<K extends FxEvent["kind"]>(kind: K): Array<{ at: number } & Extract<FxEvent, { kind: K }>> {
  return fxLog.filter((e) => e.fx.kind === kind).map((e) => ({ at: e.at, ...e.fx })) as Array<{ at: number } & Extract<FxEvent, { kind: K }>>;
}

function send(world: World, i: number, type: string, msg: unknown = {}): void {
  expect(enqueueClientMessage(RT(world, i).inputs, type, msg)).toBe(true);
}
const press = (world: World, i = 0, a = 0, t?: number): void => send(world, i, "attack", t === undefined ? { a } : { a, t });
const release = (world: World, i = 0, a = 0, t?: number): void => send(world, i, "release", t === undefined ? { a } : { a, t });
/** A click: pressed and released in the same tick. */
const tap = (world: World, i = 0, a = 0): void => { press(world, i, a); release(world, i, a); };
const swap = (world: World, i = 0, slot?: number): void => send(world, i, "swap", slot === undefined ? {} : { slot });

const ceilTick = (t: number): number => Math.ceil(t / TICK_MS - 1e-6) * TICK_MS;
/** The faction's attack interval with the weapon, in ms. */
const intervalMs = (f: FactionId, w: WeaponId): number => attackInterval(FACTIONS[f], w) * 1000;
const timings = (f: FactionId, w: WeaponId) => weaponTimings(w, attackInterval(FACTIONS[f], w));
/** Raw damage of a full hit as fought (duel pace). */
const fullHit = (f: FactionId, w: WeaponId): number => damagePerHit(pacedFaction(FACTIONS[f]), w);

/**
 * Walks player `i` east along its row for `ticks` ticks and returns the distance covered in each. `before(k)` runs just
 * ahead of tick k, so a test can press, swap or release at a chosen tick of the walk.
 */
function walk(world: World, i: number, ticks: number, before: (k: number) => void = () => {}): number[] {
  const p = P(world, i);
  send(world, i, "move", { x: 36 * TILE, y: p.y });
  const out: number[] = [];
  for (let k = 0; k < ticks; k++) {
    before(k);
    const x0 = p.x;
    const y0 = p.y;
    tick(world);
    out.push(Math.hypot(p.x - x0, p.y - y0));
  }
  return out;
}

const repeat = (value: number, n: number): number[] => Array.from({ length: n }, () => value);
const expectCloseAll = (actual: number[], expected: number[]): void => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((v, k) => expect(v, `tick ${k}`).toBeCloseTo(expected[k]!, 6));
};

beforeEach(() => {
  landed.length = 0;
});

describe("setup", () => {
  it("gives each joiner the next faction's signature weapon in the first slot and nothing in the second", () => {
    const world = makeWorld(5);
    const defs = [...world.state.players.values()].map((p) => [p.faction, p.weapon0, p.weapon1, p.slot]);
    expect(defs).toEqual([
      ["fire", "axe", "", 0], ["sentenced", "bow", "", 0], ["plague", "bow", "", 0], ["frost", "shield", "", 0], ["holy", "wand", "", 0],
    ]);
    expect(SIGNATURE_WEAPONS.fire).toBe("axe");
  });

  it("registers the three weapon actions", () => {
    const world = makeWorld(1);
    for (const kind of ["attack", "release", "swap"] as const) expect(world.actions[kind]).toBeTypeOf("function");
  });

  it("a fresh weapon runtime is idle: nothing held, never aimed", () => {
    expect(newWeaponRuntime()).toEqual({
      action: null, rootUntil: 0, castSlowUntil: 0, recoverUntil: 0, staggerImmuneUntil: 0,
      held: false, pressedAt: 0, bufferedUntil: 0, releasePending: false, aim: 0, aimAt: 0, lagMs: 0,
    });
  });
});

describe("the trigger and the shared cooldown", () => {
  it("a press starts the attack in the tick it arrives and spends the cooldown", () => {
    const world = startRun();
    arm(world, 0, "fire", "axe");
    tick(world);
    expect(fxOf("windup")).toHaveLength(0);
    expect(P(world).readyAt).toBe(0);
    press(world, 0, 1);
    tick(world);
    expect(fxOf("windup")).toEqual([{ at: T(world), kind: "windup", by: "p0", weapon: "axe", a: 1, ms: 250 }]);
    expect(P(world).readyAt).toBeCloseTo(T(world) + intervalMs("fire", "axe"), 6);
    expect(RT(world).weapon.action).toMatchObject({ kind: "swing", weapon: "axe", startedAt: T(world) });
  });

  it("a held trigger repeats exactly at the interval, with the remainder carried (Plague's sword, 251.4 ms)", () => {
    const world = startRun();
    arm(world, 0, "plague", "sword");
    const I = intervalMs("plague", "sword");
    expect(I).toBeCloseTo(251.414, 3);
    press(world, 0);
    tick(world);
    const S = T(world);
    const end = S + 10_000;
    runTo(world, end);
    const expected: number[] = [];
    for (let k = 0; S + k * I <= end; k++) expected.push(ceilTick(S + k * I));
    // 40 attacks in 10 s, not the 34 a cadence rounded up to 0.3 s would give.
    expect(expected).toHaveLength(40);
    expect(fxOf("windup").map((w) => w.at)).toEqual(expected);
    expect(P(world).readyAt).toBeCloseTo(S + 40 * I, 6);
  });

  it("a repeat is timed from when the cooldown ended, so its windup is shorter by the part of the tick already gone", () => {
    const world = startRun();
    arm(world, 0, "plague", "sword");
    const I = intervalMs("plague", "sword");
    press(world, 0);
    tick(world);
    const S = T(world);
    runTo(world, ceilTick(S + 5 * I));
    const windups = fxOf("windup");
    expect(windups.length).toBeGreaterThanOrEqual(5);
    windups.forEach((w, k) => expect(w.at + w.ms, `attack ${k}`).toBeCloseTo(S + k * I + 100, 6));
    expect(windups[1]!.ms).toBeLessThan(100);
  });

  it("a press that lands within ATTACK_BUFFER_MS of the cooldown ending attacks the moment it ends, even if released at once", () => {
    expect(ATTACK_BUFFER_MS).toBe(150);
    for (const gapTicks of [1, 2, 3]) {
      const world = startRun();
      arm(world, 0, "frost", "sword");
      tap(world);
      tick(world);
      const first = T(world);
      const ready = P(world).readyAt;
      const readyTick = ceilTick(ready);
      runTo(world, readyTick - gapTicks * TICK_MS - TICK_MS);
      tap(world);
      runTo(world, readyTick - TICK_MS);
      expect(fxOf("windup"), `gap ${gapTicks}`).toHaveLength(1);
      tick(world);
      expect(fxOf("windup"), `gap ${gapTicks}`).toHaveLength(2);
      // It starts from the instant the cooldown ended, not from the tick that noticed.
      expect(fxOf("windup")[1]!.at).toBe(readyTick);
      expect(P(world).readyAt).toBeCloseTo(ready + intervalMs("frost", "sword"), 6);
      expect(first).toBeLessThan(readyTick);
    }
  });

  it("a press earlier than that, released, is forgotten", () => {
    for (const gapTicks of [4, 5, 6]) {
      const world = startRun();
      arm(world, 0, "frost", "sword");
      tap(world);
      tick(world);
      const readyTick = ceilTick(P(world).readyAt);
      runTo(world, readyTick - gapTicks * TICK_MS - TICK_MS);
      tap(world);
      runTo(world, readyTick + 10 * TICK_MS);
      expect(fxOf("windup"), `gap ${gapTicks}`).toHaveLength(1);
    }
  });

  it("a trigger held down since long before the cooldown ends attacks the moment it does", () => {
    const world = startRun();
    arm(world, 0, "frost", "sword");
    press(world);
    tick(world);
    const ready = P(world).readyAt;
    runTo(world, ceilTick(ready) - TICK_MS);
    expect(fxOf("windup")).toHaveLength(1);
    tick(world);
    expect(fxOf("windup")).toHaveLength(2);
    expect(P(world).readyAt).toBeCloseTo(ready + intervalMs("frost", "sword"), 6);
  });

  it("releasing stops the repeating", () => {
    const world = startRun();
    arm(world, 0, "plague", "sword");
    press(world);
    run(world, 4);
    const n = fxOf("windup").length;
    expect(n).toBeGreaterThanOrEqual(1);
    release(world);
    run(world, 60);
    expect(fxOf("windup")).toHaveLength(n);
  });

  it("pressing twice in a tick, or again while held, is one attack", () => {
    const world = startRun();
    arm(world, 0, "frost", "sword");
    press(world);
    press(world);
    tick(world);
    press(world);
    run(world, 3);
    expect(fxOf("windup")).toHaveLength(1);
    expect(landed).toHaveLength(1);
  });

  it("a fighter with an empty hand never attacks", () => {
    const world = startRun();
    arm(world, 0, "fire", "");
    press(world);
    run(world, 20);
    expect(fxOf("windup")).toHaveLength(0);
    expect(P(world).readyAt).toBe(0);
  });
});

describe("windups and landing", () => {
  const cases: Array<[string, FactionId, WeaponId, number, number]> = [
    ["sword", "plague", "sword", 100, 100],
    ["shield bash", "frost", "shield", 100, 100],
    ["Fire's slow axe", "fire", "axe", 250, 250],
    ["Plague's fast axe (25% of its interval)", "plague", "axe", 0.25 * intervalMs("plague", "axe"), 100],
  ];

  it.each(cases)("%s: a windup fx, then one melee request when it ends", (_name, faction, weapon, windupMs, landMs) => {
    const world = startRun();
    arm(world, 0, faction, weapon);
    tap(world, 0, 0.3);
    tick(world);
    const S = T(world);
    const [wu] = fxOf("windup");
    expect(wu).toMatchObject({ by: "p0", weapon, a: 0.3 });
    expect(wu!.ms).toBeCloseTo(windupMs, 6);
    expect(landed).toHaveLength(0);
    runTo(world, S + landMs - TICK_MS);
    expect(landed).toHaveLength(0);
    tick(world);
    expect(landed).toHaveLength(1);
    const { at, req } = landed[0]!;
    expect(at).toBe(S + landMs);
    expect(req).toMatchObject({ attacker: "p0", weapon, a: 0.3 });
    expect(req.packet.raw).toBeCloseTo(fullHit(faction, weapon), 9);
    expect(req.packet).toMatchObject(damageShares(FACTIONS[faction]));
    expect(RT(world).weapon.action).toBeNull();
    run(world, 40);
    expect(landed).toHaveLength(1); // the tap did not hold the trigger
  });

  it("the swing's direction is fixed when it starts, though the fighter turns during the windup", () => {
    const world = startRun();
    arm(world, 0, "fire", "axe");
    tap(world, 0, 0.5);
    tick(world);
    send(world, 0, "aim", { a: 2 });
    run(world, 5);
    expect(P(world).facing).toBeCloseTo(2, 12);
    expect(landed).toHaveLength(1);
    expect(landed[0]!.req.a).toBeCloseTo(0.5, 12);
  });

  it("each swing of a held trigger lands once, at its own time", () => {
    const world = startRun();
    arm(world, 0, "plague", "sword");
    const I = intervalMs("plague", "sword");
    press(world);
    tick(world);
    const S = T(world);
    runTo(world, ceilTick(S + 5 * I + 200));
    // fx.at + fx.ms is the exact moment each windup ends; the request is made at the first tick from then on.
    const ends = fxOf("windup").map((w) => w.at + w.ms).filter((t) => t <= T(world));
    expect(ends.length).toBeGreaterThanOrEqual(5);
    expect(landed.map((l) => l.at)).toEqual(ends.map(ceilTick));
  });
});

describe("the wand", () => {
  it("casts for 200 ms, and the ball leaves from where the caster stands then", () => {
    const world = startRun();
    arm(world, 0, "holy", "wand");
    tap(world, 0, -0.4);
    tick(world);
    const S = T(world);
    expect(fxOf("windup")).toMatchObject([{ by: "p0", weapon: "wand", a: -0.4, ms: 200 }]);
    runTo(world, S + 150);
    expect(world.state.projectiles.size).toBe(0);
    tick(world);
    expect(shots).toHaveLength(1);
    expect(world.state.projectiles.size).toBe(1);
    const shot = shots[0]!;
    expect(shot).toMatchObject({ at: S + 200, kind: "ball", owner: "p0", weapon: "wand", t: S + 200, range: 240 });
    expect(shot.x).toBe(P(world).x);
    expect(shot.y).toBe(P(world).y);
    expect(shot.vx).toBeCloseTo(Math.cos(-0.4) * 380, 9);
    expect(shot.vy).toBeCloseTo(Math.sin(-0.4) * 380, 9);
    expect(shot.raw).toBeCloseTo(fullHit("holy", "wand"), 9);
    expect(landed).toHaveLength(0); // a cast is not a swing
  });

  it("slows the caster to WAND_CAST_MOVE for its cast slow, then RANGED_RECOVERY_MOVE until the cooldown ends", () => {
    const world = startRun();
    arm(world, 0, "fire", "wand");
    const tm = timings("fire", "wand");
    expect(tm.castSlow).toBeCloseTo(0.4, 12);
    expect(intervalMs("fire", "wand")).toBeCloseTo(1010.1, 1);
    // Cast at tick 2: the cast slow on ticks S .. S+350 (400 ms), the recovery on S+400 .. S+1000 (until 1010.1), then full speed.
    const d = walk(world, 0, 28, (k) => { if (k === 2) tap(world); });
    expectCloseAll(d, [...repeat(STEP, 2), ...repeat(STEP * WAND_CAST_MOVE, 8), ...repeat(STEP * RANGED_RECOVERY_MOVE, 13), ...repeat(STEP, 5)]);
  });

  it("a short interval shortens the slow with it (the cast slow is at most 45% of the interval)", () => {
    const world = startRun();
    arm(world, 0, "holy", "wand");
    const tm = timings("holy", "wand");
    expect(tm.castSlow).toBeCloseTo(0.45 * tm.interval, 12);
    const d = walk(world, 0, 20, (k) => { if (k === 1) tap(world); });
    const slow = Math.ceil((tm.castSlow * 1000) / TICK_MS - 1e-6);
    const recover = Math.ceil((tm.interval * 1000) / TICK_MS - 1e-6) - slow;
    expectCloseAll(d, [
      STEP, ...repeat(STEP * WAND_CAST_MOVE, slow), ...repeat(STEP * RANGED_RECOVERY_MOVE, recover), ...repeat(STEP, 20 - 1 - slow - recover),
    ]);
  });
});

describe("the axe root", () => {
  it("roots the swinger for 500 ms from the swing's start, then the walk resumes along the same path", () => {
    const world = startRun();
    arm(world, 0, "fire", "axe");
    expect(timings("fire", "axe").root).toBe(0.5);
    const t0 = T(world);
    const d = walk(world, 0, 18, (k) => { if (k === 2) tap(world); });
    expectCloseAll(d, [...repeat(STEP, 2), ...repeat(0, 10), ...repeat(STEP, 6)]);
    expect(RT(world).weapon.rootUntil).toBe(t0 + 3 * TICK_MS + 500); // the swing started in tick 2, which runs at t0 + 3 ticks
  });

  it("keeps the path while rooted", () => {
    const world = startRun();
    arm(world, 0, "fire", "axe");
    walk(world, 0, 4, (k) => { if (k === 1) tap(world); });
    expect(RT(world).path.length).toBeGreaterThan(0);
    expect(RT(world).weapon.rootUntil).toBeGreaterThan(T(world));
  });

  it("is a share of the interval for a fast axe: 50% of Plague's 386 ms, 193 ms", () => {
    const world = startRun();
    arm(world, 0, "plague", "axe");
    expect(timings("plague", "axe").root).toBeCloseTo(0.5 * 0.3861, 3);
    // Rooted on S, S+50, S+100, S+150 (now < S+193); free from S+200.
    const d = walk(world, 0, 10, (k) => { if (k === 2) tap(world); });
    expectCloseAll(d, [...repeat(STEP, 2), ...repeat(0, 4), ...repeat(STEP, 4)]);
  });

  it("only the axe roots: a sword swing does not slow the walk", () => {
    const world = startRun();
    arm(world, 0, "plague", "sword");
    const d = walk(world, 0, 8, (k) => { if (k === 2) tap(world); });
    expectCloseAll(d, repeat(STEP, 8));
  });
});

describe("the bow", () => {
  // Frost's bow: interval 1139.6 ms, full draw 600 ms, minimum draw 150 ms, cooldown after the shot 539.6 ms.
  const FROST_I = intervalMs("frost", "bow");

  /** Presses, holds `heldMs`, and releases toward `a` in the tick that ends the hold. Returns the press time. */
  function drawAndLoose(world: World, heldMs: number, a = 0): number {
    press(world, 0, a);
    tick(world);
    const start = T(world);
    runTo(world, start + heldMs - TICK_MS);
    release(world, 0, a);
    tick(world);
    return start;
  }

  it("has the timings these tests rely on", () => {
    const tm = timings("frost", "bow");
    expect(tm.fullDraw).toBeCloseTo(0.6, 12);
    expect(tm.minDraw).toBeCloseTo(0.15, 12);
    expect(tm.cooldown).toBeCloseTo(FROST_I / 1000 - 0.6, 12);
  });

  it("a press starts the draw: drawStartedAt is synced, no windup fx, no arrow while held", () => {
    const world = startRun();
    arm(world, 0, "frost", "bow");
    expect(P(world).drawStartedAt).toBe(0);
    press(world);
    tick(world);
    const S = T(world);
    expect(P(world).drawStartedAt).toBe(S);
    expect(RT(world).weapon.action).toMatchObject({ kind: "draw", startedAt: S });
    run(world, 40); // far past the full draw: it holds until released
    expect(P(world).drawStartedAt).toBe(S);
    expect(shots).toHaveLength(0);
    expect(fxOf("windup")).toHaveLength(0);
    expect(P(world).readyAt).toBe(0); // the cooldown only starts at the release
  });

  it("walks at BOW_DRAW_MOVE while drawing, then RANGED_RECOVERY_MOVE after the shot until the cooldown ends", () => {
    const world = startRun();
    arm(world, 0, "frost", "bow");
    // Press on tick 2, release on tick 14 (a 600 ms draw): the draw slow on ticks 2..13, the recovery for 539.6 ms (ticks 14..24).
    const d = walk(world, 0, 30, (k) => {
      if (k === 2) press(world);
      if (k === 14) release(world);
    });
    expectCloseAll(d, [...repeat(STEP, 2), ...repeat(STEP * BOW_DRAW_MOVE, 12), ...repeat(STEP * RANGED_RECOVERY_MOVE, 11), ...repeat(STEP, 5)]);
  });

  it("a full draw looses a full-damage arrow at the release, along the release's aim", () => {
    const world = startRun();
    arm(world, 0, "frost", "bow");
    const start = drawAndLoose(world, 600, -0.7);
    expect(shots).toHaveLength(1);
    const shot = shots[0]!;
    expect(shot).toMatchObject({ at: start + 600, kind: "arrow", owner: "p0", weapon: "bow", t: start + 600, range: 260 });
    expect(shot.x).toBe(P(world).x);
    expect(shot.vx).toBeCloseTo(Math.cos(-0.7) * 900, 9);
    expect(shot.vy).toBeCloseTo(Math.sin(-0.7) * 900, 9);
    expect(shot.raw).toBeCloseTo(fullHit("frost", "bow"), 9);
    expect(world.projectiles.get(shot.id)!.packet).toMatchObject(damageShares(FACTIONS.frost));
    expect(P(world).drawStartedAt).toBe(0);
    expect(RT(world).weapon.action).toBeNull();
    expect(landed).toHaveLength(0);
  });

  it("overholding past the full draw does not add damage", () => {
    const world = startRun();
    arm(world, 0, "frost", "bow");
    drawAndLoose(world, 1200);
    expect(shots[0]!.raw).toBeCloseTo(fullHit("frost", "bow"), 9);
  });

  it.each([
    [150, BOW_MIN_DRAW_DAMAGE],
    [300, 0.6],
    [450, 0.8],
    [550, 0.4 + (0.6 * 400) / 450],
    [600, 1],
  ])("a %i ms draw deals %f of a full hit (linear from the minimum draw to the full draw)", (heldMs, share) => {
    const world = startRun();
    arm(world, 0, "frost", "bow");
    drawAndLoose(world, heldMs);
    expect(shots).toHaveLength(1);
    expect(shots[0]!.raw).toBeCloseTo(fullHit("frost", "bow") * share, 9);
  });

  it("a release before the minimum draw looses at the minimum draw, for 40% damage", () => {
    const world = startRun();
    arm(world, 0, "frost", "bow");
    press(world);
    tick(world);
    const S = T(world);
    runTo(world, S + 50);
    release(world);
    runTo(world, S + 100);
    expect(shots).toHaveLength(0);
    expect(P(world).drawStartedAt).toBe(S); // still drawing
    tick(world);
    expect(shots).toHaveLength(1);
    expect(shots[0]!.at).toBe(S + 150);
    expect(shots[0]!.raw).toBeCloseTo(fullHit("frost", "bow") * BOW_MIN_DRAW_DAMAGE, 9);
    expect(P(world).drawStartedAt).toBe(0);
  });

  it("a click (press and release in one tick) draws and looses at the minimum draw", () => {
    const world = startRun();
    arm(world, 0, "frost", "bow");
    tap(world, 0, 0.25);
    tick(world);
    const S = T(world);
    expect(P(world).drawStartedAt).toBe(S);
    runTo(world, S + 100);
    expect(shots).toHaveLength(0);
    tick(world);
    expect(shots).toHaveLength(1);
    expect(shots[0]!.at).toBe(S + 150);
    expect(shots[0]!.vx).toBeCloseTo(Math.cos(0.25) * 900, 9);
    expect(shots[0]!.raw).toBeCloseTo(fullHit("frost", "bow") * BOW_MIN_DRAW_DAMAGE, 9);
  });

  it("a release with no draw and no recent press does nothing, and does not pre-load the next draw", () => {
    const world = startRun();
    arm(world, 0, "frost", "bow");
    release(world);
    run(world, 10);
    expect(shots).toHaveLength(0);
    press(world);
    run(world, 12);
    expect(shots).toHaveLength(0);
    expect(RT(world).weapon.action).toMatchObject({ kind: "draw" });
  });

  it("a click made long before the cooldown ends is forgotten, and does not loose the next draw early", () => {
    const world = startRun();
    arm(world, 0, "frost", "bow");
    drawAndLoose(world, 600);
    const ready = P(world).readyAt;
    expect(ready - T(world)).toBeGreaterThan(400);
    tap(world); // well outside the buffer: nothing will start from it
    runTo(world, ceilTick(ready) + TICK_MS);
    expect(P(world).drawStartedAt).toBe(0);
    press(world); // a fresh press, held like a real draw
    run(world, 12);
    expect(RT(world).weapon.action).toMatchObject({ kind: "draw" });
    expect(shots).toHaveLength(1); // only the first shot: the held draw has not been loosed
  });

  it("the cooldown after the shot is the interval minus the full draw, so a full-draw shot every interval is the designed rate", () => {
    const world = startRun();
    arm(world, 0, "frost", "bow");
    const start = drawAndLoose(world, 600);
    expect(P(world).readyAt).toBeCloseTo(start + FROST_I, 6);
    expect(RT(world).weapon.recoverUntil).toBe(P(world).readyAt);
  });

  it("an overhold of up to one tick is refunded from the cooldown, a longer one only by that tick", () => {
    const refunded = startRun();
    arm(refunded, 0, "frost", "bow");
    const s1 = drawAndLoose(refunded, 650);
    expect(P(refunded).readyAt).toBeCloseTo(s1 + FROST_I, 6);

    const late = startRun();
    arm(late, 0, "frost", "bow");
    const s2 = drawAndLoose(late, 700);
    expect(P(late).readyAt).toBeCloseTo(s2 + FROST_I + TICK_MS, 6);
  });

  it("a draw that is not a whole number of ticks long gets its overhold back too (Sentenced, full draw 398.9 ms)", () => {
    const world = startRun();
    arm(world, 0, "sentenced", "bow");
    const tm = timings("sentenced", "bow");
    expect(tm.fullDraw * 1000).toBeCloseTo(398.86, 2);
    const start = drawAndLoose(world, 400);
    expect(P(world).readyAt).toBeCloseTo(start + intervalMs("sentenced", "bow"), 6);
  });

  it("a partial draw pays the whole cooldown", () => {
    const world = startRun();
    arm(world, 0, "frost", "bow");
    drawAndLoose(world, 300);
    expect(P(world).readyAt).toBeCloseTo(T(world) + FROST_I - 600, 6);
  });

  it("the next draw waits for the cooldown and then starts from the instant it ended", () => {
    const world = startRun();
    arm(world, 0, "frost", "bow");
    drawAndLoose(world, 600);
    const ready = P(world).readyAt;
    press(world); // trigger held again during the cooldown
    runTo(world, ceilTick(ready) - TICK_MS);
    expect(P(world).drawStartedAt).toBe(0);
    tick(world);
    expect(P(world).drawStartedAt).toBeCloseTo(ready, 6);
    expect(P(world).drawStartedAt).not.toBe(T(world));
  });

  it("a click during the cooldown, within the buffer, draws the moment it ends and looses at the minimum draw", () => {
    const world = startRun();
    arm(world, 0, "frost", "bow");
    drawAndLoose(world, 600);
    const ready = P(world).readyAt;
    runTo(world, ceilTick(ready) - 2 * TICK_MS);
    tap(world);
    runTo(world, ceilTick(ready));
    expect(P(world).drawStartedAt).toBeCloseTo(ready, 6);
    run(world, 4);
    expect(shots).toHaveLength(2);
    // The draw began between ticks and the minimum draw is only noticed at the next one: a little over 40%.
    const drawnMs = shots[1]!.at - ready;
    expect(drawnMs).toBeGreaterThanOrEqual(150);
    expect(drawnMs).toBeLessThan(150 + TICK_MS);
    expect(shots[1]!.raw).toBeCloseTo(fullHit("frost", "bow") * (0.4 + (0.6 * (drawnMs - 150)) / 450), 9);
  });
});

describe("swapping", () => {
  const swapped: Array<{ id: string; slot: number }> = [];
  function start(): World {
    const world = startRun();
    swapped.length = 0;
    world.hooks.weaponSwapped = (_w, c) => { swapped.push({ id: c.id, slot: c.s.slot }); };
    arm(world, 0, "frost", "sword", "axe");
    return world;
  }

  it("without a slot it goes to the other one and back", () => {
    const world = start();
    swap(world);
    tick(world);
    expect(P(world).slot).toBe(1);
    expect(activeWeapon(P(world))).toBe("axe");
    swap(world);
    tick(world);
    expect(P(world).slot).toBe(0);
    expect(swapped).toEqual([{ id: "p0", slot: 1 }, { id: "p0", slot: 0 }]);
  });

  it("with a slot it goes there", () => {
    const world = start();
    swap(world, 0, 1);
    tick(world);
    expect(P(world).slot).toBe(1);
    swap(world, 0, 0);
    tick(world);
    expect(P(world).slot).toBe(0);
  });

  it("to the slot already in hand, or to an empty slot, is ignored: no cooldown, no hook", () => {
    const world = start();
    swap(world, 0, 0);
    tick(world);
    expect(P(world).slot).toBe(0);
    expect(P(world).readyAt).toBe(0);
    P(world).weapon1 = "";
    swap(world);
    swap(world, 0, 1);
    tick(world);
    expect(P(world).slot).toBe(0);
    expect(P(world).readyAt).toBe(0);
    expect(swapped).toHaveLength(0);
  });

  it("a fighter with nothing in either slot can't swap", () => {
    const world = start();
    P(world).weapon0 = "";
    P(world).weapon1 = "";
    swap(world);
    tick(world);
    expect(P(world).slot).toBe(0);
    expect(swapped).toHaveLength(0);
  });

  it("adds SWAP_SECONDS after the cooldown still running, or after now when it is over", () => {
    expect(SWAP_SECONDS).toBe(0.25);
    const idle = start();
    swap(idle);
    tick(idle);
    expect(P(idle).readyAt).toBe(T(idle) + 250);

    const busy = start();
    tap(busy);
    tick(busy);
    const ready = P(busy).readyAt;
    expect(ready).toBeGreaterThan(T(busy) + 500);
    run(busy, 2);
    swap(busy);
    tick(busy);
    expect(P(busy).readyAt).toBeCloseTo(ready + 250, 6);
  });

  it("calls the weaponSwapped hook once, after the slot changed", () => {
    const world = start();
    swap(world);
    tick(world);
    expect(swapped).toEqual([{ id: "p0", slot: 1 }]);
  });

  it("cancels a windup: the swing never lands, the cooldown stays spent (and grows)", () => {
    const world = start();
    tap(world);
    tick(world);
    const ready = P(world).readyAt;
    swap(world);
    tick(world);
    expect(RT(world).weapon.action).toBeNull();
    run(world, 10);
    expect(landed).toHaveLength(0);
    expect(P(world).readyAt).toBeCloseTo(ready + 250, 6);
  });

  it("cancels an axe root at once", () => {
    const world = start();
    arm(world, 0, "fire", "axe", "sword");
    const d = walk(world, 0, 8, (k) => {
      if (k === 1) tap(world);
      if (k === 4) swap(world);
    });
    expectCloseAll(d, [STEP, 0, 0, 0, STEP, STEP, STEP, STEP]);
  });

  it("keeps what is left of an axe root once the swing has landed; only a pending swing takes its root with it", () => {
    const world = start();
    arm(world, 0, "fire", "axe", "sword");
    // Pressed in tick 1: the swing lands 250 ms later (tick 6) and the root runs 500 ms (ticks 1..10). A swap at tick 7 is
    // after the landing, so the walk resumes only when the root ends.
    const d = walk(world, 0, 14, (k) => {
      if (k === 1) tap(world);
      if (k === 7) swap(world);
    });
    expect(landed).toHaveLength(1);
    expect(P(world).slot).toBe(1);
    expectCloseAll(d, [STEP, ...repeat(0, 10), STEP, STEP, STEP]);
  });

  it("keeps the cast slow and the ranged recovery of a wand cast whose ball has gone", () => {
    const world = start();
    arm(world, 0, "fire", "wand", "sword");
    expect(timings("fire", "wand").windup).toBeCloseTo(0.2, 12);
    // Cast in tick 1, ball at tick 5; the swap at tick 6 changes neither the cast slow (ticks 1..8) nor the recovery after it.
    const d = walk(world, 0, 25, (k) => {
      if (k === 1) tap(world);
      if (k === 6) swap(world);
    });
    expect(shots).toHaveLength(1);
    expectCloseAll(d, [STEP, ...repeat(STEP * WAND_CAST_MOVE, 8), ...repeat(STEP * RANGED_RECOVERY_MOVE, 13), ...repeat(STEP, 3)]);
  });

  it("cancels a wand cast: no ball, and neither the cast slow nor a ranged recovery outlives it", () => {
    const world = start();
    arm(world, 0, "fire", "wand", "sword");
    const d = walk(world, 0, 8, (k) => {
      if (k === 1) tap(world);
      if (k === 2) swap(world);
    });
    expect(d[1]).toBeCloseTo(STEP * WAND_CAST_MOVE, 6);
    // No ball left, so no ranged attack happened: full speed at once.
    expect(d[2]).toBeCloseTo(STEP, 6);
    expect(RT(world).weapon.castSlowUntil).toBeLessThanOrEqual(T(world));
    run(world, 12);
    expect(shots).toHaveLength(0);
  });

  it("cancels a bow draw: nothing is drawn, and a release afterwards looses nothing", () => {
    const world = start();
    arm(world, 0, "frost", "bow", "sword");
    press(world);
    run(world, 4);
    expect(P(world).drawStartedAt).toBeGreaterThan(0);
    swap(world);
    tick(world);
    expect(P(world).drawStartedAt).toBe(0);
    expect(RT(world).weapon.action).toBeNull();
    release(world);
    run(world, 30);
    expect(shots).toHaveLength(0);
  });

  it("forgets a pending release, so the next draw is not loosed at once", () => {
    const world = start();
    arm(world, 0, "frost", "bow", "sword");
    tap(world); // a draw with a release pending
    tick(world);
    swap(world);
    tick(world);
    swap(world); // back to the bow
    run(world, 12);
    expect(RT(world).weapon.releasePending).toBe(false);
    expect(shots).toHaveLength(0);
  });

  it("a trigger kept down carries across: the new weapon attacks when the swap's cooldown ends", () => {
    const world = start();
    press(world);
    tick(world);
    swap(world);
    tick(world);
    const ready = P(world).readyAt;
    runTo(world, ceilTick(ready) - TICK_MS);
    expect(fxOf("windup").map((w) => w.weapon)).toEqual(["sword"]);
    tick(world);
    expect(fxOf("windup").map((w) => w.weapon)).toEqual(["sword", "axe"]);
  });

  it("the next attack with the new weapon waits out the swap", () => {
    const world = start();
    swap(world);
    tick(world);
    const ready = P(world).readyAt;
    press(world);
    runTo(world, ceilTick(ready) - TICK_MS);
    expect(fxOf("windup")).toHaveLength(0);
    tick(world);
    expect(fxOf("windup")).toMatchObject([{ weapon: "axe" }]);
  });
});

describe("aim and facing", () => {
  it("an aim message turns the fighter at once, wrapped to (-PI, PI]", () => {
    const world = startRun();
    send(world, 0, "aim", { a: 4 });
    tick(world);
    expect(P(world).facing).toBeCloseTo(wrapAngle(4), 12);
    expect(RT(world).weapon.aim).toBeCloseTo(wrapAngle(4), 12);
    expect(RT(world).weapon.aimAt).toBe(T(world));
  });

  it("attack and release carry an aim too, and the action's aim beats an aim message in the same tick", () => {
    const world = startRun();
    arm(world, 0, "frost", "bow");
    send(world, 0, "aim", { a: 1 });
    press(world, 0, 2);
    tick(world);
    expect(P(world).facing).toBeCloseTo(2, 12);
    release(world, 0, -1.5);
    tick(world);
    expect(P(world).facing).toBeCloseTo(-1.5, 12);
  });

  it("the arrow flies where the release aimed, not where the press aimed", () => {
    const world = startRun();
    arm(world, 0, "frost", "bow");
    press(world, 0, 0.5);
    tick(world);
    send(world, 0, "aim", { a: 1.1 });
    run(world, 13);
    release(world, 0, -0.3);
    tick(world);
    expect(shots).toHaveLength(1);
    expect(Math.atan2(shots[0]!.vy, shots[0]!.vx)).toBeCloseTo(-0.3, 12);
  });

  it("an aim sent after an attack in the same tick wins: the swing goes where the aim was last pointed", () => {
    const world = startRun();
    arm(world, 0, "frost", "sword");
    press(world, 0, 0);
    send(world, 0, "aim", { a: Math.PI / 2 });
    tick(world);
    expect(P(world).facing).toBeCloseTo(Math.PI / 2, 12);
    expect(RT(world).weapon.aim).toBeCloseTo(Math.PI / 2, 12);
    expect(fxOf("windup")).toMatchObject([{ a: expect.closeTo(Math.PI / 2, 12) }]);
  });

  it("an attack sent after an aim in the same tick wins, as it did", () => {
    const world = startRun();
    arm(world, 0, "frost", "sword");
    send(world, 0, "aim", { a: Math.PI / 2 });
    press(world, 0, 0);
    tick(world);
    expect(P(world).facing).toBeCloseTo(0, 12);
    expect(fxOf("windup")).toMatchObject([{ a: 0 }]);
  });

  it("an aim sent after a release in the same tick sends the arrow where the aim points", () => {
    const world = startRun();
    arm(world, 0, "frost", "bow");
    press(world, 0, 0.2);
    run(world, 13);
    release(world, 0, -1);
    send(world, 0, "aim", { a: 0.4 });
    tick(world);
    expect(shots).toHaveLength(1);
    expect(Math.atan2(shots[0]!.vy, shots[0]!.vx)).toBeCloseTo(0.4, 12);
    expect(P(world).facing).toBeCloseTo(0.4, 12);
  });

  it("an aim with no actions in the tick still turns the fighter", () => {
    const world = startRun();
    arm(world, 0, "frost", "sword");
    send(world, 0, "aim", { a: -2 });
    tick(world);
    expect(P(world).facing).toBeCloseTo(-2, 12);
    expect(RT(world).weapon.aimAt).toBe(T(world));
  });

  it("walking does not turn a fighter who is aiming", () => {
    const world = startRun();
    send(world, 0, "aim", { a: 1 });
    walk(world, 0, 10);
    expect(P(world).facing).toBeCloseTo(1, 12);
    expect(P(world).x).toBeGreaterThan(HOME[0]!.x + 50);
  });

  it("walking turns the fighter again AIM_STALE_MS after the last aim input", () => {
    expect(AIM_STALE_MS).toBe(1000);
    const world = startRun();
    send(world, 0, "aim", { a: 1 });
    const facings: number[] = [];
    send(world, 0, "move", { x: 36 * TILE, y: HOME[0]!.y });
    for (let k = 0; k < 24; k++) {
      tick(world);
      facings.push(P(world).facing);
    }
    // Aim at tick 0; stale at 0 + 1000 ms = tick 20.
    expect(facings[19]).toBeCloseTo(1, 12);
    expect(facings[20]).toBeCloseTo(0, 12);
    expect(facings[23]).toBeCloseTo(0, 12);
  });

  it("any aim input, an attack's included, restarts that clock", () => {
    const world = startRun();
    arm(world, 0, "frost", "sword");
    send(world, 0, "move", { x: 36 * TILE, y: HOME[0]!.y });
    send(world, 0, "aim", { a: 1 });
    run(world, 15);
    tap(world, 0, 1.3);
    run(world, 20); // 1.75 s after the first aim, but 0.95 s after the tap
    expect(P(world).facing).toBeCloseTo(1.3, 12);
    run(world, 1);
    expect(P(world).facing).toBeCloseTo(0, 12);
  });

  it("a fighter who never aimed faces the way it walks", () => {
    const world = startRun();
    send(world, 0, "move", { x: HOME[0]!.x, y: 17 * TILE });
    run(world, 3);
    expect(P(world).facing).toBeCloseTo(Math.PI / 2, 6);
    expect(RT(world).weapon.aimAt).toBe(0);
  });
});

describe("lag compensation", () => {
  /** A sword swing started with `t` set `lag` ms behind the server, landing 100 ms later. Returns rewindT less the landing time. */
  function rewindFor(lag: number | null): number {
    const world = startRun();
    arm(world, 0, "frost", "sword");
    const now = T(world) + TICK_MS; // the tick the press is processed in
    const t = lag === null ? undefined : now - lag;
    press(world, 0, 0, t);
    release(world, 0, 0, t);
    runTo(world, now + 100);
    expect(landed).toHaveLength(1);
    return landed[0]!.req.rewindT - landed[0]!.at;
  }

  it.each([
    [120, -120],
    [90, -90],
    [MAX_REWIND_MS, -MAX_REWIND_MS],
  ])("a client %i ms behind is rewound by %i ms", (lag, delta) => {
    expect(rewindFor(lag)).toBe(delta);
  });

  it("clamps a stale timestamp to MAX_REWIND_MS", () => {
    expect(MAX_REWIND_MS).toBe(300);
    expect(rewindFor(1000)).toBe(-300);
    expect(rewindFor(301)).toBe(-300);
  });

  it("never rewinds by less than one tick: a timestamp in the present or the future counts as one tick behind", () => {
    expect(rewindFor(0)).toBe(-TICK_MS);
    expect(rewindFor(20)).toBe(-TICK_MS);
    expect(rewindFor(-400)).toBe(-TICK_MS);
  });

  it("no timestamp counts as one tick behind", () => {
    expect(rewindFor(null)).toBe(-TICK_MS);
  });

  it("the latest attack or release before the landing sets the lag", () => {
    const world = startRun();
    arm(world, 0, "frost", "sword");
    const S = T(world) + TICK_MS;
    press(world, 0, 0, S - 200);
    tick(world);
    release(world, 0, 0, T(world) + TICK_MS - 80);
    runTo(world, S + 100);
    expect(landed[0]!.req.rewindT).toBe(S + 100 - 80);
  });

  it("rewindTime is the landing time less the lag, clamped to [TICK_MS, MAX_REWIND_MS]", () => {
    expect(rewindTime(1000, 120)).toBe(880);
    expect(rewindTime(1000, 0)).toBe(1000 - TICK_MS);
    expect(rewindTime(1000, 5000)).toBe(1000 - MAX_REWIND_MS);
  });
});

describe("where projectiles leave from", () => {
  // A client draws its own player `lag` ms behind the server and measures its aim from there, so an arrow or a ball
  // leaves from that rewound position (the same one a melee swing is sampled at), not from the present one. A shooter
  // strafing south at 0.75 x PLAYER_SPEED while it draws would otherwise miss by its speed times the lag.
  const south = (world: World): void => send(world, 0, "move", { x: HOME[0]!.x, y: 17 * TILE });
  /** The `t` of an input stamped by a client `lag` ms behind the server, processed in the next tick. */
  const stamp = (world: World, lag: number): number => T(world) + TICK_MS - lag;
  const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

  /**
   * p0 (Frost, bow) strafes south, presses (stamped `pressLag` behind the server, or unstamped), holds a full draw and
   * releases in the tick that ends it (stamped `releaseLag`, or unstamped). `at(lag)` is where the shooter was `lag` ms
   * before the release was processed.
   */
  function strafeAndLoose(pressLag: number | null, releaseLag: number | null) {
    const world = startRun();
    arm(world, 0, "frost", "bow");
    south(world);
    run(world, 8);
    press(world, 0, 0, pressLag === null ? undefined : stamp(world, pressLag));
    tick(world);
    runTo(world, T(world) + 600 - TICK_MS);
    const releasedAt = T(world) + TICK_MS;
    release(world, 0, 0, releaseLag === null ? undefined : stamp(world, releaseLag));
    tick(world);
    expect(shots).toHaveLength(1);
    const at = (lag: number): Vec2 => positionAt(RT(world), P(world), releasedAt - lag);
    return { world, shot: shots[0]!, at };
  }

  it.each([150, 200, MAX_REWIND_MS])("an arrow leaves from where a client %i ms behind drew the shooter", (lag) => {
    const { world, shot, at } = strafeAndLoose(lag, lag);
    expect(shot.x).toBeCloseTo(at(lag).x, 9);
    expect(shot.y).toBeCloseTo(at(lag).y, 9);
    // The shooter has walked on since (slowly: it is drawing a bow): the present position is where the aim would not start from.
    expect(dist(shot, P(world))).toBeCloseTo((BOW_DRAW_MOVE * PLAYER_SPEED * lag) / 1000, 6);
    expect(dist(shot, P(world))).toBeGreaterThan(1);
  });

  it("clamps a stale timestamp to MAX_REWIND_MS, and a fresher one than a tick (or one in the future) to one tick back", () => {
    const stale = strafeAndLoose(1000, 1000);
    expect(stale.shot.y).toBeCloseTo(stale.at(MAX_REWIND_MS).y, 9);
    const future = strafeAndLoose(-400, -400);
    expect(future.shot.y).toBeCloseTo(future.at(TICK_MS).y, 9);
    const fresh = strafeAndLoose(20, 20);
    expect(fresh.shot.y).toBeCloseTo(fresh.at(TICK_MS).y, 9);
  });

  it("without a timestamp it leaves from the latest position: where the shooter stood one tick back", () => {
    const { world, shot, at } = strafeAndLoose(null, null);
    expect(shot.x).toBeCloseTo(at(TICK_MS).x, 9);
    expect(shot.y).toBeCloseTo(at(TICK_MS).y, 9);
    // It moved on in the release tick (RANGED_RECOVERY_MOVE x speed after the shot), which the arrow does not include.
    expect(P(world).y - shot.y).toBeCloseTo(RANGED_RECOVERY_MOVE * STEP, 6);
  });

  it("uses the lag of the release when it carries a timestamp, and the press's when it does not", () => {
    const stamped = strafeAndLoose(100, 250);
    expect(stamped.shot.y).toBeCloseTo(stamped.at(250).y, 9);
    const unstamped = strafeAndLoose(250, null);
    expect(unstamped.shot.y).toBeCloseTo(unstamped.at(250).y, 9);
  });

  it.each([120, 250])("a ball leaves from where a client %i ms behind drew the caster when the cast began", (lag) => {
    const world = startRun();
    arm(world, 0, "holy", "wand");
    south(world);
    run(world, 8);
    const begun = T(world) + TICK_MS;
    const t = stamp(world, lag);
    press(world, 0, 0, t);
    release(world, 0, 0, t);
    tick(world);
    const drawn = positionAt(RT(world), P(world), begun - lag);
    // A later input from a client at another lag moves the cast's lag, not where this ball leaves from.
    release(world, 0, 0, stamp(world, MAX_REWIND_MS));
    runTo(world, begun + 200);
    expect(shots).toHaveLength(1);
    expect(shots[0]!.x).toBeCloseTo(drawn.x, 9);
    expect(shots[0]!.y).toBeCloseTo(drawn.y, 9);
    expect(dist(shots[0]!, P(world))).toBeGreaterThan(RANGED_HIT_REACH); // the caster walked on, over the lag and through the cast
  });
});

describe("teleport, death and fighters that can't fight", () => {
  it("the teleported hook cancels the action and the root, and releases the trigger", () => {
    const world = startRun();
    arm(world, 0, "fire", "axe");
    press(world);
    tick(world);
    expect(RT(world).weapon.action).not.toBeNull();
    expect(RT(world).weapon.rootUntil).toBeGreaterThan(T(world));
    world.hooks.teleported!(world);
    const w = RT(world).weapon;
    expect(w.action).toBeNull();
    expect(w.held).toBe(false);
    expect(w.bufferedUntil).toBe(0);
    expect(w.rootUntil).toBeLessThanOrEqual(T(world));
    run(world, 40); // past the swing's landing and the cooldown: nothing lands, the held trigger does not restart
    expect(landed).toHaveLength(0);
    expect(fxOf("windup")).toHaveLength(1);
    press(world);
    tick(world);
    expect(fxOf("windup")).toHaveLength(2);
  });

  it("the teleported hook drops a bow draw and a cast in flight", () => {
    const world = startRun(2);
    arm(world, 0, "frost", "bow");
    arm(world, 1, "holy", "wand");
    press(world, 0);
    tap(world, 1);
    run(world, 2);
    expect(P(world, 0).drawStartedAt).toBeGreaterThan(0);
    world.hooks.teleported!(world);
    expect(P(world, 0).drawStartedAt).toBe(0);
    release(world, 0);
    run(world, 20);
    expect(shots).toHaveLength(0);
  });

  it("a real teleport into the coliseum cancels the swing it interrupts", () => {
    const world = startRun(1, { patienceSeconds: 1 }); // the patience timer ends at serverTime 1050
    arm(world, 0, "plague", "sword");
    runTo(world, 950);
    press(world);
    tick(world);
    expect(T(world)).toBe(1000);
    expect(fxOf("windup")).toHaveLength(1);
    const before = { x: P(world).x, y: P(world).y };
    run(world, 2); // 1050: teleported
    expect(world.state.gatesLocked).toBe(true);
    expect(Math.hypot(P(world).x - before.x, P(world).y - before.y)).toBeGreaterThan(100);
    run(world, 40);
    expect(landed).toHaveLength(0);
    expect(fxOf("windup")).toHaveLength(1);
  });

  it("a player killed during a windup never lands the swing", () => {
    const world = startRun(3);
    arm(world, 0, "fire", "axe");
    tap(world, 0);
    run(world, 2);
    applyDamage(world, P(world, 0), RT(world, 0), P(world, 0).hp + 1000, "test");
    expect(P(world, 0).status).toBe("dead");
    run(world, 10);
    expect(landed).toHaveLength(0);
  });

  it("a player killed mid-draw (release pending) or mid-cast looses nothing", () => {
    const world = startRun(3);
    arm(world, 0, "frost", "bow");
    arm(world, 1, "holy", "wand");
    press(world, 0);
    tap(world, 1);
    run(world, 2);
    release(world, 0); // too early for the minimum draw: the arrow is pending
    tick(world);
    expect(RT(world, 0).weapon.releasePending).toBe(true);
    applyDamage(world, P(world, 0), RT(world, 0), P(world, 0).hp + 1000, "test");
    applyDamage(world, P(world, 1), RT(world, 1), P(world, 1).hp + 1000, "test");
    run(world, 20);
    expect(shots).toHaveLength(0);
  });

  it("a player who goes down mid-draw lets go of the trigger: no synced draw, nothing held or pending", () => {
    const world = startRun(3);
    arm(world, 0, "frost", "bow");
    press(world, 0);
    run(world, 4);
    expect(P(world, 0).drawStartedAt).toBeGreaterThan(0);
    expect(RT(world, 0).weapon.held).toBe(true);
    applyDamage(world, P(world, 0), RT(world, 0), P(world, 0).hp + 1000, "test");
    const w = RT(world, 0).weapon;
    expect(P(world, 0).status).toBe("dead");
    expect(P(world, 0).drawStartedAt).toBe(0);
    expect([w.held, w.action, w.bufferedUntil, w.releasePending]).toEqual([false, null, 0, false]);
    run(world, 20);
    expect(shots).toHaveLength(0);
    expect(P(world, 0).drawStartedAt).toBe(0);
  });

  it("a player who goes down mid-swing, or leaves, lets go of the trigger and the swing too", () => {
    for (const outcome of ["died", "mia"] as const) {
      const world = startRun(3);
      arm(world, 0, "fire", "axe");
      press(world, 0);
      tick(world);
      expect(RT(world, 0).weapon.action).toMatchObject({ kind: "swing" });
      expect(RT(world, 0).weapon.held).toBe(true);
      downPlayer(world, P(world, 0), RT(world, 0), outcome);
      const w = RT(world, 0).weapon;
      expect([w.held, w.action, w.bufferedUntil], outcome).toEqual([false, null, 0]);
      run(world, 40);
      expect(landed, outcome).toHaveLength(0);
      expect(fxOf("windup"), outcome).toHaveLength(1);
    }
  });

  it("a fighter with no faction (a dummy) never attacks, whatever it holds", () => {
    const world = startRun(2);
    const id = addMob(world, { kind: "dummy", name: "dummy", at: { x: 1000, y: 500 }, weapon: "sword" });
    const mob = world.mobs.get(id)!;
    expect(world.state.mobs.get(id)!.faction).toBe("");
    enqueueClientMessage(mob.inputs, "attack", { a: 0 });
    run(world, 20);
    expect(landed).toHaveLength(0);
    expect(fxOf("windup")).toHaveLength(0);
    expect(world.state.mobs.get(id)!.readyAt).toBe(0);
  });

  it("a player whose faction is gone never attacks or draws", () => {
    const world = startRun();
    arm(world, 0, "frost", "bow", "sword");
    P(world).faction = "";
    press(world);
    run(world, 20);
    expect(P(world).drawStartedAt).toBe(0);
    expect(P(world).readyAt).toBe(0);
    expect(shots).toHaveLength(0);
    expect(fxOf("windup")).toHaveLength(0);
  });

  it("resetWeapons gives a fresh state machine and cooldown", () => {
    const world = startRun();
    arm(world, 0, "frost", "bow");
    press(world);
    run(world, 5);
    RT(world).weapon.recoverUntil = 99999;
    P(world).readyAt = 1234;
    resetWeapons(C(world));
    expect(RT(world).weapon).toEqual(newWeaponRuntime());
    expect(P(world).readyAt).toBe(0);
    expect(P(world).drawStartedAt).toBe(0);
  });

  it("the run start resets the weapons of everyone who joined", () => {
    const world = makeWorld(1);
    RT(world).weapon.held = true;
    RT(world).weapon.rootUntil = 5000;
    P(world).readyAt = 4321;
    P(world).drawStartedAt = 77;
    tick(world);
    expect(world.state.phase).toBe("active");
    expect(RT(world).weapon).toEqual(newWeaponRuntime());
    expect(P(world).readyAt).toBe(0);
    expect(P(world).drawStartedAt).toBe(0);
  });
});

describe("stagger", () => {
  it("cancels a windup but leaves the cooldown spent, and grants immunity", () => {
    const world = startRun();
    arm(world, 0, "frost", "sword");
    tap(world);
    tick(world);
    const ready = P(world).readyAt;
    expect(stagger(world, C(world))).toBe(true);
    expect(RT(world).weapon.action).toBeNull();
    expect(P(world).readyAt).toBe(ready);
    expect(RT(world).weapon.staggerImmuneUntil).toBe(T(world) + 500);
    expect(world.events.some((e) => e.type === "fx" && e.fx.kind === "stagger" && e.fx.id === "p0")).toBe(true);
    run(world, 10);
    expect(landed).toHaveLength(0);
  });

  it("cancels a wand cast and an axe root", () => {
    const wand = startRun();
    arm(wand, 0, "fire", "wand");
    tap(wand);
    tick(wand);
    stagger(wand, C(wand));
    run(wand, 12);
    expect(shots).toHaveLength(0);
    expect(RT(wand).weapon.castSlowUntil).toBeLessThanOrEqual(T(wand));

    const axe = startRun();
    arm(axe, 0, "fire", "axe");
    tap(axe);
    tick(axe);
    stagger(axe, C(axe));
    expect(RT(axe).weapon.rootUntil).toBeLessThanOrEqual(T(axe));
  });

  it("a staggered wand cast leaves no ranged recovery: full speed right after, as after a swap", () => {
    const world = startRun();
    arm(world, 0, "fire", "wand");
    const d = walk(world, 0, 8, (k) => {
      if (k === 1) tap(world);
      if (k === 2) expect(stagger(world, C(world))).toBe(true);
    });
    expect(d[1]).toBeCloseTo(STEP * WAND_CAST_MOVE, 6);
    expect(d[2]).toBeCloseTo(STEP, 6);
    expect(RT(world).weapon.recoverUntil).toBeLessThanOrEqual(T(world));
    run(world, 12);
    expect(shots).toHaveLength(0);
  });

  it("does not interrupt a bow draw (9.1 tuning): it keeps its progress, and the stagger still starts the immunity", () => {
    const world = startRun();
    arm(world, 0, "frost", "bow");
    press(world);
    tick(world);
    const drawStart = T(world);
    runTo(world, drawStart + 300);
    const hurtAt = T(world);
    expect(stagger(world, C(world))).toBe(true);
    expect(P(world).drawStartedAt).toBe(drawStart);
    expect(RT(world).weapon.action).toMatchObject({ kind: "draw", startedAt: drawStart });
    expect(RT(world).weapon.staggerImmuneUntil).toBe(hurtAt + STAGGER_IMMUNITY_SECONDS * 1000);
    // Released at the full draw it already had: a full-damage arrow, no second draw.
    runTo(world, drawStart + 600 - TICK_MS);
    release(world);
    tick(world);
    expect(shots).toHaveLength(1);
    expect(shots[0]!.at).toBe(drawStart + 600);
    expect(shots[0]!.raw).toBeCloseTo(fullHit("frost", "bow"), 9);
  });

  it("is ignored for STAGGER_IMMUNITY_SECONDS after a stagger, then works again", () => {
    expect(STAGGER_IMMUNITY_SECONDS).toBe(0.5);
    const world = startRun();
    arm(world, 0, "frost", "sword");
    expect(stagger(world, C(world))).toBe(true);
    const first = T(world);
    tap(world);
    tick(world);
    expect(RT(world).weapon.action).not.toBeNull();
    expect(stagger(world, C(world))).toBe(false); // immune: the swing is not cancelled
    expect(RT(world).weapon.action).not.toBeNull();
    runTo(world, first + 450);
    expect(stagger(world, C(world))).toBe(false);
    tick(world);
    expect(stagger(world, C(world))).toBe(true);
    expect(RT(world).weapon.action).toBeNull();
    tick(world);
    expect(fxOf("stagger")).toHaveLength(2); // only the two that took effect
  });
});

describe("helpers", () => {
  it("setAim turns the fighter and notes when", () => {
    const world = startRun();
    tick(world);
    setAim(world, C(world), 2.5);
    expect(P(world).facing).toBe(2.5);
    expect(RT(world).weapon).toMatchObject({ aim: 2.5, aimAt: T(world) });
  });

  it("weaponChanged cancels the action, adds the swap to the cooldown and calls the hook (a pickup that replaced the weapon)", () => {
    const world = startRun();
    arm(world, 0, "frost", "sword");
    const calls: string[] = [];
    world.hooks.weaponSwapped = (_w, c) => { calls.push(c.id); };
    tap(world);
    tick(world);
    const ready = P(world).readyAt;
    weaponChanged(world, C(world));
    expect(RT(world).weapon.action).toBeNull();
    expect(P(world).readyAt).toBeCloseTo(ready + 250, 6);
    expect(calls).toEqual(["p0"]);
  });

  it("cancelAction keeps the cooldown and clears the draw", () => {
    const world = startRun();
    arm(world, 0, "frost", "bow");
    press(world);
    run(world, 3);
    P(world).readyAt = 4000;
    cancelAction(world, C(world));
    expect(RT(world).weapon.action).toBeNull();
    expect(P(world).drawStartedAt).toBe(0);
    expect(P(world).readyAt).toBe(4000);
  });

  it("moveMultiplierOf reads the runtime's root, slows and draw", () => {
    const world = startRun();
    arm(world, 0, "frost", "bow");
    const now = T(world);
    expect(moveMultiplierOf(world, C(world))).toBe(1);
    RT(world).weapon.recoverUntil = now + 1;
    expect(moveMultiplierOf(world, C(world))).toBe(RANGED_RECOVERY_MOVE);
    RT(world).weapon.castSlowUntil = now + 1;
    expect(moveMultiplierOf(world, C(world))).toBe(Math.min(WAND_CAST_MOVE, RANGED_RECOVERY_MOVE));
    RT(world).weapon.rootUntil = now + 1;
    expect(moveMultiplierOf(world, C(world))).toBe(0);
  });

  it("packetFor is the faction's paced hit and damage shares; a draw scales it; no faction deals nothing", () => {
    const world = startRun();
    arm(world, 0, "plague", "sword");
    const packet = packetFor(C(world), "sword");
    expect(packet.raw).toBeCloseTo(fullHit("plague", "sword"), 9);
    expect(packet).toMatchObject({ phys: 0.8, magic: expect.closeTo(0.2, 12), true: 0 });
    expect(packetFor(C(world), "bow", 0.4).raw).toBeCloseTo(fullHit("plague", "bow") * 0.4, 9);
    P(world).faction = "";
    expect(packetFor(C(world), "sword")).toEqual({ raw: 0, phys: 1, magic: 0, true: 0 });
  });
});

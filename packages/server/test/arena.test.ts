import { describe, expect, it } from "vitest";
import {
  bountyFor, BOUNTY_ANNOUNCE_MS, feedScore,
  circleClear, COLISEUM_RING_RADIUS, defaultFaction, FACTIONS, findPath, generateMap, GV_ELITE, GV_KILL, GV_MOB, GV_MOB_CAP, GV_WIN, MAX_PLAYERS,
  inColiseum, KILL_CREDIT_SECONDS, mapFromTiles, mulberry32, PATIENCE_MIN_SECONDS, PATIENCE_SECONDS, PLAYER_RADIUS, SIGNATURE_WEAPONS,
  SUDDEN_DEATH_KILLER, SUDDEN_DEATH_RAMP_FRACTION,
  SUDDEN_DEATH_START_FRACTION, TELEPORT_IMMUNITY_MS, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, WIN_BONUS_MIN_OPPONENTS,
  WIN_BONUS_MIN_PLAYERS, withGates, type FxEvent, type GameMap, type RunResult, type Vec2,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { loadConfig } from "../src/config";
import {
  applyDamage, applyHits, awardGv, beginRun, coliseumSpots, creditMobKill, downPlayer, markDropped, markReconnected, markTickStart,
  patienceMs, suddenDeath, suddenDeathShare, unbankedGv, type Attacker, type Hit,
} from "../src/sim/arena";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { abandonPlayer, addPlayer, removePlayer, step } from "../src/sim/step";
import { moveMultiplierOf } from "../src/sim/weapons";
import { collisionMap, createWorld, type PlayerRuntime, type SimConfig, type SimEvent, type World } from "../src/sim/world";

type EventOf<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;
type Fx<K extends FxEvent["kind"]> = Extract<FxEvent, { kind: K }>;

const NAMES = ["alice", "bob", "carol", "dave", "erin", "frank", "gina", "hank"];
const idOf = (i: number): string => `p${i}`;

/** Small timers so a whole lifecycle fits in a few dozen ticks. The run starts on the first step, at TICK_MS. */
function makeConfig(cfg: Partial<SimConfig> = {}): SimConfig {
  // Flat unless a test sets patienceMinSeconds: the timers then keep the length the test names, whoever is standing.
  const patienceSeconds = cfg.patienceSeconds ?? 2;
  return {
    minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds, patienceMinSeconds: patienceSeconds,
    suddenDeathSeconds: 1, ...cfg,
  };
}

interface RunOpts {
  seed?: number;
  random?: () => number;
  game?: boolean;
  /**
   * Every player gets this hp and maxHp instead of their faction's (500 fire, 700 sentenced, 1000 plague, ...). The
   * tie-break between simultaneous last deaths compares hp *fractions*, so a test that sets literal hp values needs one
   * shared maxHp for the numbers to mean what they say.
   */
  hp?: number;
}

/**
 * `n` players (p0 alice, p1 bob, ...) in a run that started on the first step, i.e. at serverTime TICK_MS. Players get
 * a faction by join order (fire, sentenced, plague, frost, holy, ...) and that faction's hp.
 */
function startRun(n: number, cfg: Partial<SimConfig> = {}, opts: RunOpts = {}): World {
  const seed = opts.seed ?? 1234;
  const options = { seed, config: makeConfig({ minPlayers: n, ...cfg }), random: opts.random ?? mulberry32(seed + 1) };
  const world = opts.game ? createGameWorld(options) : createWorld(options);
  for (let i = 0; i < n; i++) addPlayer(world, idOf(i), NAMES[i]!);
  if (opts.hp !== undefined) for (const p of world.state.players.values()) { p.hp = opts.hp; p.maxHp = opts.hp; }
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  return world;
}

const P = (world: World, i: number): PlayerState => world.state.players.get(idOf(i))!;
const RT = (world: World, i: number) => world.players.get(idOf(i))!;
const key = (v: Vec2): string => `${v.x},${v.y}`;
const posOf = (p: Vec2): Vec2 => ({ x: p.x, y: p.y });

function ofType<T extends SimEvent["type"]>(events: SimEvent[], type: T): Array<EventOf<T>> {
  return events.filter((e): e is EventOf<T> => e.type === type);
}

function fxOf<K extends FxEvent["kind"]>(events: SimEvent[], kind: K): Array<Fx<K>> {
  return ofType(events, "fx").map((e) => e.fx).filter((fx): fx is Fx<K> => fx.kind === kind);
}

/** Result of each player resolved in `events`, by session id. Fails on a second result for the same player. */
function resultsOf(events: SimEvent[]): Record<string, RunResult> {
  const out: Record<string, RunResult> = {};
  for (const e of ofType(events, "resolved")) {
    expect(out[e.id], `second result for ${e.id}`).toBeUndefined();
    out[e.id] = e.result;
  }
  return out;
}

const tick = (world: World): SimEvent[] => step(world, TICK_MS);

/** Steps until serverTime is exactly `serverTime` and returns everything emitted on the way. */
function runTo(world: World, serverTime: number): SimEvent[] {
  const all: SimEvent[] = [];
  while (world.state.serverTime < serverTime) all.push(...tick(world));
  expect(world.state.serverTime).toBe(serverTime);
  return all;
}

/** Runs `fn` in the combat/DoT stage of the step that lands on `serverTime`: after actions, before the arena settles. */
function atTick(world: World, serverTime: number, fn: (w: World) => void): void {
  world.systems.push((w) => { if (w.state.serverTime === serverTime) fn(w); });
}

/** The map spawn farthest from `from`, so a walk there takes longer than the tests run. */
function farthestSpawn(world: World, from: Vec2): Vec2 {
  const d = (v: Vec2) => Math.hypot(v.x - from.x, v.y - from.y);
  return world.map.spawns.reduce((best, sp) => (d(sp) > d(best) ? sp : best));
}

const attacker = (world: World, i: number): Attacker => ({ id: idOf(i), p: P(world, i), rt: RT(world, i) });

/**
 * Damage that is certainly lethal to a player who isn't immune. Returns what applyDamage returned. A source that isn't a
 * player is a stray death: nobody hit the victim lately (their last hit is forgotten first), so nobody takes the kill.
 * A mob finishing a player a rival hit within KILL_CREDIT_SECONDS is the "a mob finishes a hunted player" tests below.
 */
function kill(world: World, victim: number, source: Attacker | string = "test"): number {
  if (typeof source === "string") RT(world, victim).lastHit = null;
  return applyDamage(world, P(world, victim), RT(world, victim), P(world, victim).hp + 1000, source);
}

/** `from` lands a non-lethal blow (1 hp unless told otherwise) on `to`: the cheapest way to have damaged them. */
const strike = (world: World, from: number, to: number, amount = 1): number =>
  applyDamage(world, P(world, to), RT(world, to), amount, attacker(world, from));

/** Counts `hooks.teleported` calls. */
function countTeleports(world: World): { n: number } {
  const calls = { n: 0 };
  world.hooks.teleported = (w) => { expect(w).toBe(world); calls.n++; };
  return calls;
}

describe("beginRun", () => {
  it("arms the patience timer from the start time and records how many players started", () => {
    const w = startRun(3, { patienceSeconds: 2 });
    expect(w.state.raidStartedAt).toBe(TICK_MS);
    expect(w.state.patienceEndsAt).toBe(TICK_MS + 2000);
    expect(w.arena.startedWith).toBe(3);
    expect(w.state.startedWith).toBe(3); // the synced copy the HUD reads: leavers drop out of `players`
    expect(w.state).toMatchObject({ inColiseum: false, gatesLocked: false, suddenDeathAt: 0, winner: "", phase: "active" });
  });

  it("starts everyone at their faction's hp with its signature weapon: join order picks the faction", () => {
    const w = startRun(6);
    for (let i = 0; i < 6; i++) {
      const faction = defaultFaction(i);
      expect(P(w, i), `p${i}`).toMatchObject({
        faction, hp: FACTIONS[faction].hp, maxHp: FACTIONS[faction].hp, weapon0: SIGNATURE_WEAPONS[faction], weapon1: "",
        slot: 0, status: "alive",
      });
    }
    expect(new Set([0, 1, 2, 3, 4].map((i) => P(w, i).faction)).size).toBe(5); // a lobby of five has one of each
    expect(P(w, 5).faction).toBe(P(w, 0).faction); // and the sixth wraps round
  });

  it("counts the players present when the run starts, not the ones who joined and left in the lobby", () => {
    const w = createWorld({ seed: 1234, config: makeConfig({ minPlayers: 2 }), random: mulberry32(1) });
    for (let i = 0; i < 3; i++) addPlayer(w, idOf(i), NAMES[i]!);
    removePlayer(w, idOf(2));
    step(w, TICK_MS);
    expect(w.state.phase).toBe("active");
    expect(w.arena.startedWith).toBe(2);
    expect(w.state.startedWith).toBe(2);
  });

  it("starts a one-player room as a solo run", () => {
    const w = startRun(1);
    expect(w.arena.startedWith).toBe(1);
    expect(w.state.startedWith).toBe(1);
  });

  it("runs before hooks.raidStarted, which sees an armed timer and the player count", () => {
    const w = createWorld({ seed: 1234, config: makeConfig({ minPlayers: 2, patienceSeconds: 7 }), random: mulberry32(1) });
    let seen: { patienceEndsAt: number; startedWith: number; syncedStartedWith: number } | null = null;
    w.hooks.raidStarted = (world) => {
      seen = {
        patienceEndsAt: world.state.patienceEndsAt, startedWith: world.arena.startedWith,
        syncedStartedWith: world.state.startedWith,
      };
    };
    addPlayer(w, "p0", "alice");
    addPlayer(w, "p1", "bob");
    step(w, TICK_MS);
    expect(seen).toEqual({ patienceEndsAt: TICK_MS + 7000, startedWith: 2, syncedStartedWith: 2 });
  });

  it("is not armed in the lobby", () => {
    const w = createWorld({ seed: 1234, config: makeConfig({ lobbySeconds: 1000 }), random: mulberry32(1) });
    addPlayer(w, "p0", "alice");
    for (let i = 0; i < 10; i++) tick(w);
    expect(w.state.phase).toBe("lobby");
    expect(w.state.patienceEndsAt).toBe(0);
    expect(w.arena.startedWith).toBe(0);
    expect(w.state.startedWith).toBe(0);
  });

  it("resets whatever a previous run left behind", () => {
    const w = startRun(2, { patienceSeconds: 5 });
    w.state.inColiseum = true;
    w.state.gatesLocked = true;
    w.state.suddenDeathAt = 99;
    w.state.winner = "ghost";
    w.state.startedWith = 7;
    w.state.patienceEndsAt = 0;
    w.arena.downedThisTick.push({ p: P(w, 0), rt: RT(w, 0) });
    w.arena.downsBetweenTicks = 3;
    beginRun(w);
    expect(w.state).toMatchObject({
      patienceEndsAt: w.state.serverTime + 5000, inColiseum: false, gatesLocked: false, suddenDeathAt: 0, winner: "",
      startedWith: 2,
    });
    expect(w.arena).toEqual({
      startedWith: 2, startedHumans: 2, downedThisTick: [], downsBetweenTicks: 0, voided: false, bountyAtTickStart: new Map(),
    });
  });
});

describe("patience timer and the teleport", () => {
  it("does nothing until the timer runs out", () => {
    const w = startRun(3); // patienceEndsAt = 2050
    const start = [0, 1, 2].map((i) => posOf(P(w, i)));
    const teleports = countTeleports(w);
    const events = runTo(w, 2000);
    expect(fxOf(events, "teleport")).toEqual([]);
    expect(teleports.n).toBe(0);
    expect(w.state).toMatchObject({ gatesLocked: false, inColiseum: false, patienceEndsAt: 2050, suddenDeathAt: 0 });
    expect([0, 1, 2].map((i) => posOf(P(w, i)))).toEqual(start);
  });

  it("teleports in the first tick whose serverTime reaches patienceEndsAt", () => {
    const w = startRun(3);
    runTo(w, 2000);
    const teleports = countTeleports(w);
    const events = tick(w);
    expect(w.state.serverTime).toBe(2050);
    expect(fxOf(events, "teleport")).toEqual([{ kind: "teleport" }]);
    expect(teleports.n).toBe(1);
    expect(w.state).toMatchObject({
      gatesLocked: true, inColiseum: true, patienceEndsAt: 0, suddenDeathAt: 2050 + 1000, phase: "active",
    });
  });

  it("when the timer falls between ticks, the next tick on the grid teleports", () => {
    const w = startRun(3, { patienceSeconds: 0.725 }); // ends at 775
    expect(w.state.patienceEndsAt).toBeCloseTo(775, 6);
    expect(fxOf(runTo(w, 750), "teleport")).toEqual([]);
    expect(w.state.gatesLocked).toBe(false);
    expect(fxOf(tick(w), "teleport")).toHaveLength(1);
    expect(w.state.serverTime).toBe(800);
    expect(w.state.suddenDeathAt).toBe(800 + 1000);
  });

  it("puts every standing player on a distinct coliseum spot", () => {
    for (const n of [2, 3, 5, MAX_PLAYERS]) {
      const w = startRun(n);
      runTo(w, 2050);
      const spots = coliseumSpots(w.map, n).map(key).sort();
      const at = Array.from({ length: n }, (_, i) => key(P(w, i)));
      expect(new Set(at).size, `n=${n}`).toBe(n);
      expect([...at].sort(), `n=${n}`).toEqual(spots);
    }
  });

  it("clears paths, so nobody keeps walking from the spot they were teleported to", () => {
    const w = startRun(3);
    for (let i = 0; i < 3; i++) {
      expect(enqueueClientMessage(RT(w, i).inputs, "move", farthestSpawn(w, P(w, i)))).toBe(true);
    }
    runTo(w, 2000);
    for (let i = 0; i < 3; i++) expect(RT(w, i).path.length, `p${i} walking`).toBeGreaterThan(0);
    tick(w);
    const spots = [0, 1, 2].map((i) => posOf(P(w, i)));
    for (let i = 0; i < 3; i++) expect(RT(w, i).path, `p${i}`).toEqual([]);
    for (let k = 0; k < 10; k++) tick(w);
    expect([0, 1, 2].map((i) => posOf(P(w, i)))).toEqual(spots);
  });

  it("drops input still queued when the teleport happens, and takes new input afterwards", () => {
    const w = startRun(2);
    // A queue can only hold something at that point if a system filled it during the tick.
    atTick(w, 2050, (world) => {
      for (let i = 0; i < 2; i++) {
        RT(world, i).inputs.pushMove({ kind: "move", x: world.map.spawns[0]!.x, y: world.map.spawns[0]!.y });
        RT(world, i).inputs.pushAction({ kind: "attack", a: 0 });
      }
    });
    runTo(w, 2050);
    const spots = [0, 1].map((i) => posOf(P(w, i)));
    for (let i = 0; i < 2; i++) {
      expect(RT(w, i).inputs.move, `p${i}`).toBeNull();
      expect(RT(w, i).inputs.actions, `p${i}`).toEqual([]);
    }
    tick(w);
    expect([0, 1].map((i) => posOf(P(w, i)))).toEqual(spots);

    // Input sent after the teleport works normally. The gates are locked now, so the target is inside the coliseum.
    const target = w.map.coliseum.centre;
    expect(key(target)).not.toBe(key(P(w, 0)));
    expect(enqueueClientMessage(RT(w, 0).inputs, "move", target)).toBe(true);
    tick(w);
    expect(posOf(P(w, 0))).not.toEqual(spots[0]);
  });

  it("seals the coliseum while the gates are locked, and opens it again when they unlock", () => {
    const w = startRun(2);
    expect(collisionMap(w)).toBe(w.map);
    runTo(w, 2050);
    expect(w.state.gatesLocked).toBe(true);
    expect(collisionMap(w)).toBe(withGates(w.map));
    const at = posOf(P(w, 0));
    const outside = w.map.spawns[0]!;
    expect(inColiseum(w.map, outside.x, outside.y)).toBe(false);
    expect(enqueueClientMessage(RT(w, 0).inputs, "move", outside)).toBe(true);
    for (let i = 0; i < 5; i++) tick(w);
    // No path out: the move is refused rather than walked toward a wall.
    expect(posOf(P(w, 0))).toEqual(at);
    w.state.gatesLocked = false;
    expect(collisionMap(w)).toBe(w.map);
  });

  it("resets the rewind history to a single sample at the new spot", () => {
    const w = startRun(3);
    runTo(w, 2000);
    for (let i = 0; i < 3; i++) expect(RT(w, i).history.length).toBeGreaterThan(1);
    tick(w);
    for (let i = 0; i < 3; i++) expect(RT(w, i).history, `p${i}`).toEqual([{ t: 2050, x: P(w, i).x, y: P(w, i).y }]);
  });

  it("gives everyone TELEPORT_IMMUNITY_MS of immunity from the teleport tick", () => {
    const w = startRun(3);
    runTo(w, 2050);
    for (let i = 0; i < 3; i++) expect(P(w, i).immuneUntil).toBe(2050 + TELEPORT_IMMUNITY_MS);
  });

  it("emits one teleport fx and calls hooks.teleported once, with the world", () => {
    const w = startRun(4);
    const teleports = countTeleports(w);
    const events = runTo(w, 2050);
    expect(fxOf(events, "teleport")).toHaveLength(1);
    expect(teleports.n).toBe(1);
    runTo(w, 3000); // locked: no second teleport
    expect(teleports.n).toBe(1);
  });

  it("calls hooks.teleported after positions, paths and history are in place", () => {
    const w = startRun(2);
    const seen: Array<{ pos: string; path: number; history: number; locked: boolean }> = [];
    w.hooks.teleported = (world) => {
      seen.push({
        pos: key(P(world, 0)), path: RT(world, 0).path.length, history: RT(world, 0).history.length,
        locked: world.state.gatesLocked,
      });
    };
    runTo(w, 2050);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ pos: key(P(w, 0)), path: 0, history: 1, locked: true });
  });

  it("only moves players who are still standing; a dead player stays where they fell", () => {
    const w = startRun(3);
    atTick(w, 500, (world) => kill(world, 2));
    runTo(w, 500);
    const fell = posOf(P(w, 2));
    runTo(w, 500 + 2000); // the death pushed the timer to 2500
    expect(w.state.gatesLocked).toBe(true);
    expect(posOf(P(w, 2))).toEqual(fell);
    expect(P(w, 2).immuneUntil).toBe(0);
    expect(new Set([key(P(w, 0)), key(P(w, 1))]).size).toBe(2);
    expect([key(P(w, 0)), key(P(w, 1))].sort()).toEqual(coliseumSpots(w.map, 2).map(key).sort());
    expect(P(w, 0).immuneUntil).toBe(2500 + TELEPORT_IMMUNITY_MS);
  });

  it("assigns spots with the server-private random stream: repeatable per stream, different across streams", () => {
    const assignment = (s: number) => {
      const w = startRun(4, {}, { random: mulberry32(s) });
      runTo(w, 2050);
      return [0, 1, 2, 3].map((i) => key(P(w, i))).join("|");
    };
    expect(assignment(5)).toBe(assignment(5));
    const seen = new Set<string>();
    for (let s = 1; s <= 10; s++) seen.add(assignment(s));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("does not teleport again while the gates are locked", () => {
    const w = startRun(3, { suddenDeathSeconds: 600 });
    const teleports = countTeleports(w);
    const events = runTo(w, 2050 + 20 * 60);
    expect(fxOf(events, "teleport")).toHaveLength(1);
    expect(teleports.n).toBe(1);
    expect(w.state).toMatchObject({ gatesLocked: true, patienceEndsAt: 0, suddenDeathAt: 2050 + 600_000 });
  });
});

describe("deaths restart the timer", () => {
  it("a death restarts the patience timer from the tick it happened in", () => {
    const w = startRun(3); // 2050
    atTick(w, 500, (world) => kill(world, 2));
    runTo(w, 450);
    expect(w.state.patienceEndsAt).toBe(2050);
    const events = tick(w);
    expect(w.state.serverTime).toBe(500);
    expect(w.state.patienceEndsAt).toBe(500 + 2000);
    expect(resultsOf(events)[idOf(2)]).toMatchObject({ outcome: "died", place: 3, killedBy: "test" });
    // Nothing happens at the old deadline; the teleport comes at the new one.
    expect(fxOf(runTo(w, 2450), "teleport")).toEqual([]);
    expect(w.state.gatesLocked).toBe(false);
    expect(fxOf(tick(w), "teleport")).toHaveLength(1);
    expect(w.state.serverTime).toBe(2500);
  });

  it("two deaths in one tick restart it once", () => {
    const w = startRun(4);
    atTick(w, 500, (world) => { kill(world, 2); kill(world, 3); });
    runTo(w, 500);
    expect(w.state.patienceEndsAt).toBe(2500);
  });

  it("a death in the very tick the timer expires prevents the teleport", () => {
    const w = startRun(3); // 2050
    const teleports = countTeleports(w);
    atTick(w, 2050, (world) => kill(world, 2));
    runTo(w, 2000);
    const before = [0, 1].map((i) => posOf(P(w, i)));
    const events = tick(w);
    expect(w.state.serverTime).toBe(2050);
    expect(fxOf(events, "teleport")).toEqual([]);
    expect(teleports.n).toBe(0);
    expect(w.state).toMatchObject({ gatesLocked: false, inColiseum: false, patienceEndsAt: 2050 + 2000, suddenDeathAt: 0 });
    expect([0, 1].map((i) => posOf(P(w, i)))).toEqual(before);
    expect(P(w, 0).immuneUntil).toBe(0);
    // The timer then runs its full length again.
    expect(fxOf(runTo(w, 4000), "teleport")).toEqual([]);
    expect(fxOf(tick(w), "teleport")).toHaveLength(1);
    expect(w.state.serverTime).toBe(4050);
    expect(teleports.n).toBe(1);
  });

  it("a death in the coliseum unlocks the gates, cancels sudden death and restarts the timer", () => {
    const w = startRun(3, { suddenDeathSeconds: 2 });
    const teleports = countTeleports(w);
    atTick(w, 3600, (world) => kill(world, 2)); // immunity ended at 3550
    runTo(w, 2050);
    expect(w.state).toMatchObject({ gatesLocked: true, suddenDeathAt: 2050 + 2000 });
    runTo(w, 3600);
    expect(w.state).toMatchObject({
      gatesLocked: false, suddenDeathAt: 0, patienceEndsAt: 3600 + 2000, inColiseum: true, phase: "active",
    });
    // The sudden death that would have started at 4050 never does.
    runTo(w, 5000);
    expect(P(w, 0).hp).toBe(P(w, 0).maxHp);
    expect(P(w, 1).hp).toBe(P(w, 1).maxHp);
    expect(teleports.n).toBe(1);
  });

  it("with nobody dying again, a second teleport happens patienceSeconds after the death", () => {
    const w = startRun(3, { suddenDeathSeconds: 5 });
    const teleports = countTeleports(w);
    atTick(w, 4000, (world) => kill(world, 2));
    expect(fxOf(runTo(w, 2050), "teleport")).toHaveLength(1);
    runTo(w, 4000);
    expect(w.state).toMatchObject({ gatesLocked: false, patienceEndsAt: 6000, suddenDeathAt: 0 });
    // Walk someone away so the second teleport visibly moves them back.
    const away = w.map.spawns.find((sp) => key(sp) !== key(P(w, 0)))!;
    enqueueClientMessage(RT(w, 0).inputs, "move", away);
    expect(fxOf(runTo(w, 5950), "teleport")).toEqual([]);
    expect(teleports.n).toBe(1);
    expect(fxOf(tick(w), "teleport")).toHaveLength(1);
    expect(w.state.serverTime).toBe(6000);
    expect(teleports.n).toBe(2);
    expect(w.state).toMatchObject({ gatesLocked: true, inColiseum: true, patienceEndsAt: 0, suddenDeathAt: 6000 + 5000 });
    for (const i of [0, 1]) expect(P(w, i).immuneUntil).toBe(6000 + TELEPORT_IMMUNITY_MS);
    expect([key(P(w, 0)), key(P(w, 1))].sort()).toEqual(coliseumSpots(w.map, 2).map(key).sort());
    expect(RT(w, 0).history).toEqual([{ t: 6000, x: P(w, 0).x, y: P(w, 0).y }]);
    expect(RT(w, 0).path).toEqual([]);
  });

  it("burning stops the moment a death unlocks the gates", () => {
    const w = startRun(3, { suddenDeathSeconds: 2 });
    for (let i = 0; i < 3; i++) { P(w, i).hp = 1000; P(w, i).maxHp = 1000; }
    atTick(w, 4300, (world) => kill(world, 2));
    runTo(w, 4300);
    const hp = P(w, 0).hp;
    expect(hp).toBeLessThan(1000); // burning from 4100; the death tick itself still burns
    runTo(w, 5000);
    expect(P(w, 0).hp).toBe(hp);
    expect(P(w, 1).hp).toBe(hp);
  });
});

describe("the patience timer scales with the players standing", () => {
  // 20 s with PATIENCE_FULL_ALIVE (8) or more standing, 5 s with PATIENCE_MIN_ALIVE (3) or fewer, 3 s more per player between.
  const SCALED = { patienceSeconds: 20, patienceMinSeconds: 5 } as const;
  const SECONDS: Record<number, number> = { 1: 5, 2: 5, 3: 5, 4: 8, 5: 11, 6: 14, 7: 17, 8: 20 };

  it.each(Object.entries(SECONDS).map(([n, secs]) => [Number(n), secs] as const))(
    "beginRun arms the timer for the %i players that started: %i s",
    (n, secs) => {
      const w = startRun(n, SCALED);
      expect(w.state.patienceEndsAt).toBeCloseTo(TICK_MS + secs * 1000, 6);
    },
  );

  it("patienceMs is the length for a given number standing, in ms", () => {
    const w = startRun(2, SCALED);
    const expected: Array<[number, number]> = [[0, 5000], [3, 5000], [4, 8000], [5, 11000], [6, 14000], [7, 17000], [8, 20000], [50, 20000]];
    for (const [alive, ms] of expected) expect(patienceMs(w, alive), `alive ${alive}`).toBeCloseTo(ms, 6);
  });

  it("patienceMs is flat when the minimum equals the full length", () => {
    const w = startRun(2, { patienceSeconds: 3 });
    for (let alive = 0; alive <= 9; alive++) expect(patienceMs(w, alive), `alive ${alive}`).toBe(3000);
  });

  it("with the real defaults, 8 players start on 5:00, 5 on 3:12 and 3 on 2:00", () => {
    const real = { patienceSeconds: PATIENCE_SECONDS, patienceMinSeconds: PATIENCE_MIN_SECONDS };
    expect(startRun(8, real).state.patienceEndsAt).toBeCloseTo(TICK_MS + 300_000, 6);
    expect(startRun(5, real).state.patienceEndsAt).toBeCloseTo(TICK_MS + 192_000, 6);
    expect(startRun(3, real).state.patienceEndsAt).toBeCloseTo(TICK_MS + 120_000, 6);
    expect(startRun(2, real).state.patienceEndsAt).toBeCloseTo(TICK_MS + 120_000, 6);
  });

  it("teleports when the scaled timer for the starting count runs out", () => {
    const w = startRun(5, SCALED); // 11 s: ends at 11050
    const teleports = countTeleports(w);
    expect(fxOf(runTo(w, 11_000), "teleport")).toEqual([]);
    expect(w.state.gatesLocked).toBe(false);
    expect(fxOf(tick(w), "teleport")).toHaveLength(1);
    expect(w.state.serverTime).toBe(11_050);
    expect(teleports.n).toBe(1);
  });

  it("leaves a running timer alone: only a death re-arms it", () => {
    const w = startRun(6, SCALED);
    const armed = w.state.patienceEndsAt;
    runTo(w, 5000);
    expect(w.state.patienceEndsAt).toBe(armed);
  });

  it("a death re-arms the timer for the players left, every time", () => {
    const w = startRun(6, SCALED); // 14 s
    atTick(w, 500, (world) => kill(world, 5)); // 5 left: 11 s
    atTick(w, 1000, (world) => kill(world, 4)); // 4 left: 8 s
    atTick(w, 1500, (world) => kill(world, 3)); // 3 left: 5 s
    atTick(w, 2000, (world) => kill(world, 2)); // 2 left: still 5 s
    expect(w.state.patienceEndsAt).toBeCloseTo(50 + 14_000, 6);
    runTo(w, 500);
    expect(w.state.patienceEndsAt).toBeCloseTo(500 + 11_000, 6);
    runTo(w, 1000);
    expect(w.state.patienceEndsAt).toBeCloseTo(1000 + 8000, 6);
    runTo(w, 1500);
    expect(w.state.patienceEndsAt).toBeCloseTo(1500 + 5000, 6);
    runTo(w, 2000);
    expect(w.state.patienceEndsAt).toBeCloseTo(2000 + 5000, 6);
    // The last restart is the one that counts: nothing at 6500, the teleport at 7000.
    expect(fxOf(runTo(w, 6950), "teleport")).toEqual([]);
    expect(fxOf(tick(w), "teleport")).toHaveLength(1);
    expect(w.state.serverTime).toBe(7000);
  });

  it("counts every player who went down in the tick, not just one", () => {
    const w = startRun(7, SCALED); // 17 s
    atTick(w, 500, (world) => { kill(world, 5); kill(world, 6); });
    runTo(w, 500);
    expect(w.state.patienceEndsAt).toBeCloseTo(500 + 11_000, 6); // 5 left, not 6 (14 s)
  });

  it("counts a leave between ticks in the next tick", () => {
    const w = startRun(6, SCALED);
    removePlayer(w, idOf(5));
    tick(w);
    expect(w.state.serverTime).toBe(100);
    expect(w.state.patienceEndsAt).toBeCloseTo(100 + 11_000, 6);
  });

  it("counts a leave between ticks together with a death in that tick", () => {
    const w = startRun(6, SCALED);
    removePlayer(w, idOf(5));
    removePlayer(w, idOf(4));
    atTick(w, 100, (world) => kill(world, 3));
    runTo(w, 100);
    expect(w.state.patienceEndsAt).toBeCloseTo(100 + 5000, 6); // 3 left
  });

  it("a death in the very tick the timer expires prevents the teleport and re-arms it for the players left", () => {
    const w = startRun(4, SCALED); // 8 s: ends at 8050
    const teleports = countTeleports(w);
    atTick(w, 8050, (world) => kill(world, 3));
    expect(fxOf(runTo(w, 8050), "teleport")).toEqual([]);
    expect(teleports.n).toBe(0);
    expect(w.state.patienceEndsAt).toBeCloseTo(8050 + 5000, 6); // 3 left
    expect(fxOf(runTo(w, 13_000), "teleport")).toEqual([]);
    expect(fxOf(tick(w), "teleport")).toHaveLength(1);
    expect(w.state.serverTime).toBe(13_050);
  });

  it("a death in the coliseum re-arms it for the players left", () => {
    const w = startRun(5, { ...SCALED, suddenDeathSeconds: 100 });
    atTick(w, 13_000, (world) => kill(world, 4)); // after the immunity (teleport at 11050, immune to 12550)
    atTick(w, 14_000, (world) => kill(world, 3));
    runTo(w, 11_050);
    expect(w.state).toMatchObject({ gatesLocked: true, inColiseum: true, patienceEndsAt: 0 });
    runTo(w, 13_000);
    expect(w.state.gatesLocked).toBe(false);
    expect(w.state.patienceEndsAt).toBeCloseTo(13_000 + 8000, 6); // 4 left
    runTo(w, 14_000);
    expect(w.state.patienceEndsAt).toBeCloseTo(14_000 + 5000, 6); // 3 left
    expect(fxOf(runTo(w, 18_950), "teleport")).toEqual([]);
    expect(fxOf(tick(w), "teleport")).toHaveLength(1);
    expect(w.state.serverTime).toBe(19_000);
  });

  it("uses the config as it stands when the timer is re-armed", () => {
    const w = startRun(6, SCALED);
    w.config = { ...w.config, patienceSeconds: 40, patienceMinSeconds: 10 }; // what the Room tests' retime() does
    atTick(w, 500, (world) => kill(world, 5));
    runTo(w, 500);
    expect(w.state.patienceEndsAt).toBeCloseTo(500 + 10_000 + 30_000 * (2 / 5), 6); // 5 left: 10 + 30 × 2/5 = 22 s
  });
});

describe("loadConfig patience settings", () => {
  it("defaults to the design: PATIENCE_SECONDS at full strength, PATIENCE_MIN_SECONDS at the short end", () => {
    const c = loadConfig({});
    expect(c.patienceSeconds).toBe(PATIENCE_SECONDS);
    expect(c.patienceMinSeconds).toBeCloseTo(PATIENCE_MIN_SECONDS, 9);
    expect([PATIENCE_SECONDS, PATIENCE_MIN_SECONDS]).toEqual([300, 120]);
  });

  it("honours PATIENCE_MIN_SECONDS", () => {
    const c = loadConfig({ PATIENCE_MIN_SECONDS: "45" });
    expect(c.patienceMinSeconds).toBe(45);
    expect(c.patienceSeconds).toBe(PATIENCE_SECONDS);
  });

  it("honours both when both are set, and does not tie the short end to the long one", () => {
    expect(loadConfig({ PATIENCE_SECONDS: "20", PATIENCE_MIN_SECONDS: "9" })).toMatchObject({ patienceSeconds: 20, patienceMinSeconds: 9 });
    expect(loadConfig({ PATIENCE_SECONDS: "20", PATIENCE_MIN_SECONDS: "20" })).toMatchObject({ patienceSeconds: 20, patienceMinSeconds: 20 });
    expect(loadConfig({ PATIENCE_MIN_SECONDS: "0" }).patienceMinSeconds).toBe(0);
  });

  it("with only PATIENCE_SECONDS set, the short end keeps the default proportion (PATIENCE_SECONDS × 120/300)", () => {
    for (const secs of [20, 2.5, 150, 600]) {
      const c = loadConfig({ PATIENCE_SECONDS: String(secs) });
      expect(c.patienceSeconds).toBe(secs);
      expect(c.patienceMinSeconds, `PATIENCE_SECONDS=${secs}`).toBeCloseTo((secs * 120) / 300, 9);
    }
    expect(loadConfig({ PATIENCE_SECONDS: "20" }).patienceMinSeconds).toBeCloseTo(8, 9);
  });

  it("clamps PATIENCE_MIN_SECONDS into [0, PATIENCE_SECONDS], so the timer never grows as players fall", () => {
    expect(loadConfig({ PATIENCE_SECONDS: "20", PATIENCE_MIN_SECONDS: "200" }).patienceMinSeconds).toBe(20);
    expect(loadConfig({ PATIENCE_SECONDS: "20", PATIENCE_MIN_SECONDS: "-5" }).patienceMinSeconds).toBe(0);
  });

  it("falls back to the proportion for an empty or invalid PATIENCE_MIN_SECONDS", () => {
    for (const bad of ["", "soon", "NaN", "Infinity"]) {
      expect(loadConfig({ PATIENCE_SECONDS: "50", PATIENCE_MIN_SECONDS: bad }).patienceMinSeconds, JSON.stringify(bad)).toBeCloseTo(20, 9);
    }
  });

  it("gives a world a scaled timer: 20 s with 8 standing, 8 s with 3 or fewer when only PATIENCE_SECONDS=20 is set", () => {
    const w = createWorld({ seed: 1, config: loadConfig({ PATIENCE_SECONDS: "20" }), random: mulberry32(1) });
    expect(patienceMs(w, 8)).toBeCloseTo(20_000, 6);
    expect(patienceMs(w, 4)).toBeCloseTo(8000 + 12_000 * 0.2, 6);
    expect(patienceMs(w, 3)).toBeCloseTo(8000, 6);
    expect(patienceMs(w, 1)).toBeCloseTo(8000, 6);
  });
});

describe("loadConfig mobs", () => {
  it("runs the regional mobs unless MOBS is 0 or false", () => {
    expect(loadConfig({}).mobs).toBe(true);
    expect(loadConfig({ MOBS: "1" }).mobs).toBe(true);
    expect(loadConfig({ MOBS: "true" }).mobs).toBe(true);
    expect(loadConfig({ MOBS: "" }).mobs).toBe(true);
    expect(loadConfig({ MOBS: "0" }).mobs).toBe(false);
    expect(loadConfig({ MOBS: "false" }).mobs).toBe(false);
  });
});

describe("disconnect and reconnect grace", () => {
  it("a leaver drops out of `players` but not out of the synced startedWith", () => {
    const w = startRun(3);
    removePlayer(w, idOf(1));
    tick(w);
    expect(w.state.players.size).toBe(2);
    expect(w.state.startedWith).toBe(3);
    expect(w.arena.startedWith).toBe(3);
  });

  it("a disconnect counts as a death: immediate MIA result, a body, no death fx, and the timer restarts on the next tick", () => {
    const w = startRun(3, {}, { game: true });
    runTo(w, 500);
    const bodies = () => [...w.state.containers.values()].filter((c) => c.kind === "body");
    expect(bodies()).toHaveLength(0);

    removePlayer(w, idOf(1));
    const queued = ofType(w.events, "resolved");
    expect(queued).toHaveLength(1);
    expect(queued[0]!.id).toBe(idOf(1));
    // Place = standing players + 1: alice and carol are still up.
    expect(queued[0]!.result).toMatchObject({ outcome: "mia", profile: "bob", place: 3, killedBy: null, players: 3 });
    expect(fxOf(w.events, "death")).toEqual([]);
    expect(bodies().map((b) => b.label)).toEqual(["bob"]);
    expect(w.state.patienceEndsAt).toBe(2050); // between ticks nothing else moves

    const events = tick(w);
    expect(w.state.patienceEndsAt).toBe(550 + 2000);
    expect(ofType(events, "resolved").map((e) => e.id)).toEqual([idOf(1)]); // delivered with this step, not repeated
    expect(fxOf(events, "death")).toEqual([]);
  });

  it("places a leaver behind the players still standing, so later leavers rank higher", () => {
    const w = startRun(4);
    removePlayer(w, idOf(3));
    removePlayer(w, idOf(2));
    const results = resultsOf(w.events);
    expect(results[idOf(3)]!.place).toBe(4);
    expect(results[idOf(2)]!.place).toBe(3);
  });

  it("a leave just before the expiry tick means that tick does not teleport", () => {
    const w = startRun(3);
    const teleports = countTeleports(w);
    runTo(w, 2000);
    removePlayer(w, idOf(2));
    const events = tick(w);
    expect(w.state.serverTime).toBe(2050);
    expect(fxOf(events, "teleport")).toEqual([]);
    expect(teleports.n).toBe(0);
    expect(w.state).toMatchObject({ gatesLocked: false, patienceEndsAt: 4050 });
  });

  describe("a dropped connection lets go of the trigger", () => {
    // Its release never arrives, so the server lets go itself: otherwise the trigger stays down (a bow keeps drawing and
    // looses again) until the player is back.
    function drawing() {
      const w = startRun(3, { patienceSeconds: 3600 }, { game: true });
      enqueueClientMessage(RT(w, 1).inputs, "attack", { a: 0 }); // p1 is Sentenced: a bow
      runTo(w, 200);
      expect(P(w, 1).drawStartedAt).toBeGreaterThan(0);
      expect(RT(w, 1).weapon.held).toBe(true);
      expect(moveMultiplierOf(w, combatant(w, idOf(1))!)).toBe(0); // rooted while the draw runs
      return w;
    }

    it.each([["markDropped", markDropped], ["markReconnected", markReconnected]] as const)(
      "%s: nothing held or buffered, the draw cancelled, full speed again and no arrow later", (_name, mark) => {
        const w = drawing();
        mark(w, idOf(1));
        const weapon = RT(w, 1).weapon;
        expect([weapon.held, weapon.bufferedUntil, weapon.action, weapon.lock]).toEqual([false, 0, null, null]);
        expect(P(w, 1).drawStartedAt).toBe(0);
        expect(moveMultiplierOf(w, combatant(w, idOf(1))!)).toBe(1);
        runTo(w, 1500); // far past a full draw
        expect(P(w, 1).drawStartedAt).toBe(0);
        expect(w.projectiles.size).toBe(0);
        // The client presses again when it is back: a fresh draw.
        enqueueClientMessage(RT(w, 1).inputs, "attack", { a: 0 });
        tick(w);
        expect(P(w, 1).drawStartedAt).toBe(w.state.serverTime);
      },
    );

    it("a press still queued when the connection drops is dropped with it, so nothing attacks through the grace", () => {
      const w = startRun(3, { patienceSeconds: 3600 }, { game: true });
      const rt = RT(w, 1);
      P(w, 1).weapon0 = "axe";
      P(w, 1).slot = 0;
      enqueueClientMessage(rt.inputs, "attack", { a: 0, t: w.state.serverTime - 100 });
      markDropped(w, idOf(1));
      const windups: SimEvent[] = [];
      for (let i = 0; i < 40; i++) windups.push(...tick(w).filter((e) => e.type === "fx" && e.fx.kind === "windup"));
      expect(windups).toEqual([]);
      expect(rt.weapon.held).toBe(false);
    });

    it("a drop still records when the connection went, and a reconnect clears it", () => {
      const w = drawing();
      markDropped(w, idOf(1));
      expect(RT(w, 1).droppedAt).toBe(w.state.serverTime);
      markReconnected(w, idOf(1));
      expect(RT(w, 1).droppedAt).toBeNull();
    });
  });

  it("a leave in the coliseum unlocks the gates and cancels sudden death on the next tick", () => {
    const w = startRun(3);
    runTo(w, 2500);
    expect(w.state.gatesLocked).toBe(true);
    removePlayer(w, idOf(2));
    expect(w.state.gatesLocked).toBe(true); // not until the next tick
    tick(w);
    expect(w.state).toMatchObject({ gatesLocked: false, suddenDeathAt: 0, patienceEndsAt: 2550 + 2000 });
  });

  it("leaving a two-player run hands the other the win on the next tick", () => {
    const w = startRun(2);
    removePlayer(w, idOf(0));
    const events = tick(w);
    expect(resultsOf(events)).toMatchObject({
      p0: { outcome: "mia", place: 2, winBonusWithheld: false },
      p1: { outcome: "won", place: 1, gv: { win: 0, total: 0 }, winBonusWithheld: true }, // a 2-player run pays no win bonus
    });
    expect(w.state).toMatchObject({ phase: "ended", winner: "bob" });
  });

  it("a player whose client is gone but who was not removed still counts as standing", () => {
    // The Room holds the seat for the reconnect window and the sim never hears of it: p2 just sends nothing.
    const w = startRun(3);
    atTick(w, 500, (world) => kill(world, 1));
    const events = runTo(w, 500);
    expect(w.state.phase).toBe("active"); // p0 and the silent p2 both stand
    expect(resultsOf(events)[idOf(1)]).toMatchObject({ outcome: "died", place: 3 });
    expect(P(w, 2).status).toBe("alive");
  });

  it("can be damaged, teleported and can win", () => {
    const w = startRun(3, { suddenDeathSeconds: 5 });
    atTick(w, 500, (world) => kill(world, 1));
    runTo(w, 500);
    const full = P(w, 2).maxHp;
    expect(applyDamage(w, P(w, 2), RT(w, 2), 30, "test")).toBe(30);
    expect(P(w, 2).hp).toBe(full - 30);

    runTo(w, 2500); // the death at 500 moved the timer to 2500
    expect(w.state.gatesLocked).toBe(true);
    expect(P(w, 2).immuneUntil).toBe(2500 + TELEPORT_IMMUNITY_MS);
    expect([key(P(w, 0)), key(P(w, 2))].sort()).toEqual(coliseumSpots(w.map, 2).map(key).sort());

    atTick(w, 4100, (world) => kill(world, 0));
    const end = runTo(w, 4100);
    expect(resultsOf(end)).toMatchObject({ p0: { outcome: "died", place: 2 }, p2: { outcome: "won", place: 1 } });
    expect(w.state.winner).toBe("carol");
  });

  it("does not count once removed", () => {
    const w = startRun(3);
    removePlayer(w, idOf(2));
    atTick(w, 200, (world) => kill(world, 1));
    const events = runTo(w, 200);
    expect(w.state.phase).toBe("ended"); // only alice is left
    expect(resultsOf(events)).toMatchObject({ p1: { outcome: "died", place: 2 }, p0: { outcome: "won" } });
  });
});

describe("end of a contested run", () => {
  /** p0 wounds p1 and p2 at 300; both go down in the tick at 500, leaving p0 standing with two opponents damaged. */
  function wipe() {
    const w = startRun(3);
    atTick(w, 300, (world) => { strike(world, 0, 1); strike(world, 0, 2); });
    atTick(w, 500, (world) => { kill(world, 1); kill(world, 2); });
    runTo(w, 450);
    const events = tick(w);
    return { w, events };
  }

  it("the last player standing wins: outcome, place, GV_WIN, winner name, phase and victory fx", () => {
    const { w, events } = wipe();
    const results = resultsOf(events);
    expect(results[idOf(0)]).toEqual({
      outcome: "won", profile: "alice", durationSec: 0, kills: 0, killedBy: null, place: 1, players: 3,
      gv: { kills: 0, mobs: 0, bounty: 0, win: GV_WIN, total: GV_WIN }, winBonusWithheld: false,
    });
    expect(P(w, 0).status).toBe("alive");
    expect(w.state.winner).toBe("alice");
    expect(w.state.phase).toBe("ended");
    expect(w.state).toMatchObject({ patienceEndsAt: 0, gatesLocked: false, suddenDeathAt: 0 });
    expect(fxOf(events, "victory")).toEqual([{ kind: "victory", id: idOf(0), name: "alice", draw: false }]);
    expect(ofType(events, "raidEnded")).toHaveLength(1);
  });

  it("players downed in the final tick get place 2 and their own outcomes", () => {
    const { w, events } = wipe();
    const results = resultsOf(events);
    expect(results[idOf(1)]).toMatchObject({ outcome: "died", place: 2, killedBy: "test", gv: { win: 0 }, winBonusWithheld: false });
    expect(results[idOf(2)]).toMatchObject({ outcome: "died", place: 2, killedBy: "test", gv: { win: 0 }, winBonusWithheld: false });
    expect(Object.keys(results).sort()).toEqual(["p0", "p1", "p2"]);
    expect([P(w, 1).status, P(w, 2).status]).toEqual(["dead", "dead"]);
  });

  it("resolves the losers before the winner, then the victory fx, then raidEnded", () => {
    const { events } = wipe();
    const order = events
      .filter((e) => e.type === "resolved" || e.type === "raidEnded" || (e.type === "fx" && e.fx.kind === "victory"))
      .map((e) => (e.type === "resolved" ? e.id : e.type === "fx" ? "victory" : e.type));
    expect(order).toEqual(["p1", "p2", "p0", "victory", "raidEnded"]);
  });

  it("further steps do nothing", () => {
    const { w } = wipe();
    const snapshot = JSON.stringify([...w.state.players.values()].map((p) => [p.x, p.y, p.status, p.hp, p.gv, p.kills]));
    const time = w.state.serverTime;
    for (let i = 0; i < 100; i++) expect(tick(w)).toEqual([]);
    expect(w.state.serverTime).toBe(time + 100 * TICK_MS);
    expect(JSON.stringify([...w.state.players.values()].map((p) => [p.x, p.y, p.status, p.hp, p.gv, p.kills]))).toBe(snapshot);
    expect(w.state).toMatchObject({ phase: "ended", winner: "alice", patienceEndsAt: 0 });
  });

  it("damage after the end changes nothing and pays nobody", () => {
    const { w } = wipe();
    const hp = P(w, 0).hp;
    expect(kill(w, 0)).toBe(0); // the winner's result is out: they are no longer standing
    expect(P(w, 0).hp).toBe(hp);
    expect(awardGv(w, P(w, 0), RT(w, 0), "kill")).toBe(0);
    expect(w.events).toEqual([]);
  });

  it("earlier deaths keep the place they had when they went down", () => {
    const w = startRun(4);
    atTick(w, 300, (world) => kill(world, 3));
    atTick(w, 500, (world) => kill(world, 2));
    atTick(w, 700, (world) => kill(world, 1));
    const results = resultsOf(runTo(w, 700));
    expect(results).toMatchObject({
      p3: { outcome: "died", place: 4 }, p2: { outcome: "died", place: 3 }, p1: { outcome: "died", place: 2 },
      p0: { outcome: "won", place: 1 },
    });
  });

  it("two players going down together share a place behind the ones still standing", () => {
    const w = startRun(4);
    atTick(w, 500, (world) => { kill(world, 2); kill(world, 3); });
    const results = resultsOf(runTo(w, 500));
    expect(results).toMatchObject({ p2: { place: 3 }, p3: { place: 3 } });
    expect(w.state.phase).toBe("active");
  });

  it("a kill credited to the winner pays kill GV on top of GV_WIN", () => {
    const w = startRun(3);
    strike(w, 0, 2); // p0 has now hurt two different players: the one it kills and p2, who dies to something else
    atTick(w, 500, (world) => { kill(world, 1, attacker(world, 0)); kill(world, 2); });
    const events = runTo(w, 500);
    const winner = resultsOf(events)[idOf(0)]!;
    expect(winner).toMatchObject({ outcome: "won", kills: 1, place: 1, winBonusWithheld: false });
    expect(winner.gv).toEqual({ kills: GV_KILL, mobs: 0, bounty: 0, win: GV_WIN, total: GV_KILL + GV_WIN });
    expect(resultsOf(events)[idOf(1)]).toMatchObject({ outcome: "died", killedBy: "alice", place: 2 });
    expect(fxOf(events, "death")).toEqual([
      { kind: "death", id: idOf(1), x: P(w, 1).x, y: P(w, 1).y, by: idOf(0) },
      { kind: "death", id: idOf(2), x: P(w, 2).x, y: P(w, 2).y, by: null },
    ]);
  });

  it("the survivor of a leave and a death in the same tick wins", () => {
    const w = startRun(3);
    removePlayer(w, idOf(2)); // between ticks
    atTick(w, 100, (world) => kill(world, 1));
    const events = runTo(w, 100);
    expect(resultsOf(events)).toMatchObject({
      p2: { outcome: "mia", place: 3 }, p1: { outcome: "died", place: 2 }, p0: { outcome: "won", place: 1 },
    });
  });

  it("the last to go down wins when everyone else left before the final tick", () => {
    const w = startRun(2);
    removePlayer(w, idOf(1)); // already resolved as MIA, between ticks
    atTick(w, 100, (world) => kill(world, 0));
    const events = runTo(w, 100);
    // alice is the only one downed in the final tick, so the tie-break has a single candidate.
    expect(resultsOf(events)).toMatchObject({ p1: { outcome: "mia" }, p0: { outcome: "won", place: 1 } });
    expect(w.state.winner).toBe("alice");
  });

  it("nobody wins when everyone left", () => {
    const w = startRun(2);
    removePlayer(w, idOf(0));
    removePlayer(w, idOf(1));
    const events = tick(w);
    expect(w.state).toMatchObject({ phase: "ended", winner: "" });
    expect(Object.values(resultsOf(events)).map((r) => r.outcome)).toEqual(["mia", "mia"]);
    expect(fxOf(events, "victory")).toEqual([{ kind: "victory", id: null, name: null, draw: false }]);
    expect(ofType(events, "raidEnded")).toHaveLength(1);
  });

  it("uses the run duration at the end in rounded whole seconds", () => {
    const w = startRun(2, { patienceSeconds: 60 });
    atTick(w, 3050, (world) => kill(world, 1)); // 3000 ms after the start
    const results = resultsOf(runTo(w, 3050));
    expect(results[idOf(0)]!.durationSec).toBe(3);
    expect(results[idOf(1)]!.durationSec).toBe(3);
  });
});

describe("simultaneous last deaths", () => {
  /**
   * Runs a 2-second sudden death far enough that the first burning tick is the next one; hp is set by the caller. Every
   * player has 100 max hp, so the tiny hp values the tests set are fractions of one shared maxHp.
   */
  function toBurnEdge(n: number) {
    const w = startRun(n, { suddenDeathSeconds: 2 }, { hp: 100 });
    runTo(w, 4050); // teleport at 2050, sudden death starts at 4050: the tick at 4100 is the first to burn
    return w;
  }

  it("the higher hp fraction at the start of the tick wins, even though dead", () => {
    const w = toBurnEdge(3);
    strike(w, 1, 0, 0.001); // the winner has hurt both opponents, so the win bonus is theirs
    strike(w, 1, 2, 0.001);
    P(w, 0).hp = 0.05;
    P(w, 1).hp = 0.09;
    P(w, 2).hp = 0.02;
    const events = tick(w);
    expect(w.state.serverTime).toBe(4100);
    const results = resultsOf(events);
    expect(results[idOf(1)]).toMatchObject({
      outcome: "won", place: 1, killedBy: null, gv: { kills: 0, mobs: 0, bounty: 0, win: GV_WIN, total: GV_WIN },
      winBonusWithheld: false,
    });
    expect(results[idOf(0)]).toMatchObject({ outcome: "died", place: 2, killedBy: SUDDEN_DEATH_KILLER, gv: { win: 0 } });
    expect(results[idOf(2)]).toMatchObject({ outcome: "died", place: 2, killedBy: SUDDEN_DEATH_KILLER });
    expect(P(w, 1).status).toBe("dead"); // the winner is not "alive"
    expect(w.state).toMatchObject({ winner: "bob", phase: "ended" });
    expect(fxOf(events, "victory")).toEqual([{ kind: "victory", id: idOf(1), name: "bob", draw: false }]);
    expect(ofType(events, "raidEnded")).toHaveLength(1);
  });

  it("works for two players going down together", () => {
    const w = toBurnEdge(2);
    P(w, 0).hp = 0.04;
    P(w, 1).hp = 0.08;
    const results = resultsOf(tick(w));
    expect(results).toMatchObject({ p1: { outcome: "won", place: 1 }, p0: { outcome: "died", place: 2 } });
    expect(w.state.winner).toBe("bob");
  });

  it("compares fractions of max hp, not absolute hp", () => {
    const w = toBurnEdge(2);
    // p1 has twice the hp but a quarter of the fraction. Both are inside the first burning tick's reach.
    P(w, 0).hp = 0.0625;
    P(w, 1).maxHp = 400;
    P(w, 1).hp = 0.125;
    const results = resultsOf(tick(w));
    expect(results).toMatchObject({ p0: { outcome: "won", place: 1 }, p1: { outcome: "died", place: 2 } });
  });

  it("equal fractions with different max hp are an exact tie", () => {
    const w = toBurnEdge(2);
    P(w, 0).hp = 0.0625; // 0.0625 / 100
    P(w, 1).maxHp = 200;
    P(w, 1).hp = 0.125; //   0.125 / 200: the same fraction
    const results = resultsOf(tick(w));
    expect(results).toMatchObject({ p0: { outcome: "draw", place: 1 }, p1: { outcome: "draw", place: 1 } });
  });

  it("exact ties are a draw for everyone tied: place 1, no win GV, no winner", () => {
    const w = toBurnEdge(3);
    P(w, 0).hp = 0.05;
    P(w, 1).hp = 0.05;
    P(w, 2).hp = 0.05;
    const events = tick(w);
    const results = resultsOf(events);
    for (let i = 0; i < 3; i++) {
      expect(results[idOf(i)], `p${i}`).toMatchObject({
        outcome: "draw", place: 1, killedBy: null, gv: { kills: 0, mobs: 0, bounty: 0, win: 0, total: 0 },
      });
      expect(P(w, i).status).toBe("dead");
    }
    expect(w.state).toMatchObject({ winner: "", phase: "ended" });
    expect(fxOf(events, "victory")).toEqual([{ kind: "victory", id: null, name: null, draw: true }]);
    expect(ofType(events, "raidEnded")).toHaveLength(1);
  });

  it("players below the tied ones get place = tied count + 1", () => {
    const w = toBurnEdge(4);
    P(w, 0).hp = 0.05;
    P(w, 1).hp = 0.05;
    P(w, 2).hp = 0.03;
    P(w, 3).hp = 0.01;
    const results = resultsOf(tick(w));
    expect(results).toMatchObject({
      p0: { outcome: "draw", place: 1 }, p1: { outcome: "draw", place: 1 },
      p2: { outcome: "died", place: 3, killedBy: SUDDEN_DEATH_KILLER }, p3: { outcome: "died", place: 3 },
    });
  });

  it("a draw pays the GV earned in the run but no win bonus", () => {
    const w = toBurnEdge(2);
    awardGv(w, P(w, 0), RT(w, 0), "kill");
    awardGv(w, P(w, 1), RT(w, 1), "mob");
    P(w, 0).hp = 0.05;
    P(w, 1).hp = 0.05;
    const results = resultsOf(tick(w));
    expect(results[idOf(0)]!.gv).toEqual({ kills: GV_KILL, mobs: 0, bounty: 0, win: 0, total: GV_KILL });
    expect(results[idOf(1)]!.gv).toEqual({ kills: 0, mobs: GV_MOB, bounty: 0, win: 0, total: GV_MOB });
  });

  it("the fraction at the start of the tick decides, not hp lost during it", () => {
    // p0 starts the tick healthiest but takes the most damage in it; p1 and p2 are hit exactly lethally.
    for (const order of [[0, 1, 2], [2, 1, 0], [1, 0, 2]]) {
      const w = startRun(3, {}, { hp: 100 });
      P(w, 0).hp = 60;
      P(w, 1).hp = 50;
      P(w, 2).hp = 40;
      atTick(w, 500, (world) => {
        applyDamage(world, P(world, 0), RT(world, 0), 59, "test"); // hp 1, still standing
        for (const i of order) {
          const p = P(world, i);
          applyDamage(world, p, RT(world, i), p.hp, "test"); // exactly lethal
        }
      });
      const events = runTo(w, 500);
      const results = resultsOf(events);
      expect(results[idOf(0)], `order ${order}`).toMatchObject({ outcome: "won", place: 1 });
      expect(results[idOf(1)], `order ${order}`).toMatchObject({ outcome: "died", place: 2 });
      expect(results[idOf(2)], `order ${order}`).toMatchObject({ outcome: "died", place: 2 });
      expect(P(w, 0).status).toBe("dead");
      expect(w.state.winner).toBe("alice");
    }
  });

  it("the winner can be the one who took the most damage in the tick", () => {
    const w = startRun(2, {}, { hp: 100 });
    P(w, 0).hp = 60;
    P(w, 1).hp = 50;
    atTick(w, 500, (world) => {
      kill(world, 1);
      applyDamage(world, P(world, 0), RT(world, 0), 10_000, "test");
    });
    const results = resultsOf(runTo(w, 500));
    expect(results).toMatchObject({ p0: { outcome: "won", place: 1 }, p1: { outcome: "died", place: 2 } });
  });

  it("the kill barrier is hp for the tie too: 10 hp and a barrier of 200 beats 50 hp when both fall in one tick", () => {
    for (const swap of [false, true]) {
      const w = startRun(2, {}, { hp: 100 });
      const [shielded, bare] = swap ? [1, 0] : [0, 1];
      P(w, shielded).hp = 10;
      P(w, shielded).barrier = 200;
      P(w, bare).hp = 50;
      atTick(w, 500, (world) => {
        kill(world, bare);
        kill(world, shielded); // far more than the barrier and the hp together
      });
      const results = resultsOf(runTo(w, 500));
      expect(results[idOf(shielded)], `shielded p${shielded}`).toMatchObject({ outcome: "won", place: 1 });
      expect(results[idOf(bare)], `bare p${bare}`).toMatchObject({ outcome: "died", place: 2 });
    }
  });

  it("the barrier is counted as it stood at the start of the tick, not as the tick's hits left it", () => {
    const w = startRun(2, {}, { hp: 100 });
    P(w, 0).hp = 20;
    P(w, 0).barrier = 0;
    P(w, 1).hp = 50;
    atTick(w, 500, (world) => {
      P(world, 0).barrier = 500; // won mid-tick: too late to count
      kill(world, 1);
      kill(world, 0);
    });
    const results = resultsOf(runTo(w, 500));
    expect(results[idOf(1)]).toMatchObject({ outcome: "won", place: 1 });
    expect(results[idOf(0)]).toMatchObject({ outcome: "died", place: 2 });
  });

  it("two players killing each other in one tick: both get the kill, the higher fraction wins", () => {
    const w = startRun(2, {}, { hp: 100 });
    P(w, 0).hp = 80;
    P(w, 1).hp = 20;
    atTick(w, 500, (world) => {
      kill(world, 1, attacker(world, 0));
      kill(world, 0, attacker(world, 1)); // p1 is down but its swing in this tick still lands
    });
    const events = runTo(w, 500);
    const results = resultsOf(events);
    // Two starters: the win stands, the bonus does not.
    expect(results[idOf(0)]).toMatchObject({
      outcome: "won", kills: 1, killedBy: null, place: 1, gv: { kills: GV_KILL, win: 0, total: GV_KILL }, winBonusWithheld: true,
    });
    expect(results[idOf(1)]).toMatchObject({
      outcome: "died", kills: 1, killedBy: "alice", place: 2, gv: { kills: GV_KILL, win: 0, total: GV_KILL }, winBonusWithheld: false,
    });
  });

  it("two players killing each other with equal hp: a draw that still pays each kill", () => {
    const w = startRun(2);
    atTick(w, 500, (world) => {
      kill(world, 1, attacker(world, 0));
      kill(world, 0, attacker(world, 1));
    });
    const results = resultsOf(runTo(w, 500));
    expect(results).toMatchObject({
      p0: { outcome: "draw", place: 1, kills: 1, gv: { kills: GV_KILL, win: 0, total: GV_KILL } },
      p1: { outcome: "draw", place: 1, kills: 1, gv: { kills: GV_KILL, win: 0, total: GV_KILL } },
    });
    expect(w.state.winner).toBe("");
  });

  describe("through the real weapons and the damage ledger", () => {
    /** Two axe fighters (both fire) 20 u apart on open floor facing each other with `hp0` and `hp1` left, both swinging. */
    function axeDuel(hp0: number, hp1: number): { w: World; events: SimEvent[] } {
      const w = startRun(2, { patienceSeconds: 3600 }, { game: true });
      Object.assign(P(w, 1), { faction: "fire", maxHp: P(w, 0).maxHp, weapon0: "axe" });
      const at = w.map.spawns[0]!; // a tile centre: both ends of a 20 u line stay inside its tile
      const fighters = [{ i: 0, x: at.x - 10, hp: hp0, a: 0 }, { i: 1, x: at.x + 10, hp: hp1, a: Math.PI }];
      for (const { i, x, hp, a } of fighters) {
        Object.assign(P(w, i), { x, y: at.y, hp });
        RT(w, i).history = [{ t: w.state.serverTime, x, y: at.y }];
        enqueueClientMessage(RT(w, i).inputs, "attack", { a });
      }
      // The swings start this tick and land a few ticks on, in the same one.
      const events: SimEvent[] = [];
      for (let k = 0; k < 12 && w.state.phase === "active"; k++) events.push(...tick(w));
      expect(w.state.phase).toBe("ended");
      return { w, events };
    }

    it("two fighters hitting each other in one tick both land their blows: both die, each is credited, equal fractions draw", () => {
      const { w, events } = axeDuel(0.01, 0.01);
      expect(fxOf(events, "death").map((d) => [d.id, d.by]).sort()).toEqual([[idOf(0), idOf(1)], [idOf(1), idOf(0)]]);
      expect(resultsOf(events)).toMatchObject({
        p0: { outcome: "draw", place: 1, kills: 1, gv: { kills: GV_KILL, win: 0, total: GV_KILL } },
        p1: { outcome: "draw", place: 1, kills: 1, gv: { kills: GV_KILL, win: 0, total: GV_KILL } },
      });
      expect(w.state.winner).toBe("");
    });

    it("the higher hp fraction at the start of the tick wins, though both die", () => {
      const { w, events } = axeDuel(0.01, 0.02);
      expect(resultsOf(events)).toMatchObject({
        p1: { outcome: "won", place: 1, kills: 1, killedBy: null }, p0: { outcome: "died", place: 2, kills: 1, killedBy: "bob" },
      });
      expect(w.state.winner).toBe("bob");
    });
  });

  it("markTickStart snapshots every player's hp fraction, and in-tick damage does not change it", () => {
    const w = startRun(2, {}, { hp: 100 });
    P(w, 0).hp = 25;
    P(w, 1).maxHp = 200;
    P(w, 1).hp = 50;
    let seen: number[] = [];
    w.systems.push((world) => {
      applyDamage(world, P(world, 0), RT(world, 0), 5, "test");
      seen = [RT(world, 0).hpFracAtTickStart, RT(world, 1).hpFracAtTickStart];
    });
    tick(w);
    expect(seen).toEqual([0.25, 0.25]);
    expect(P(w, 0).hp).toBe(20);
    markTickStart(w);
    expect(RT(w, 0).hpFracAtTickStart).toBe(0.2);
  });
});

describe("solo runs", () => {
  it("never end while the player stands, through the teleport and into sudden death", () => {
    const w = startRun(1, { suddenDeathSeconds: 3 });
    const events = runTo(w, 2050 + 3000 + 2000);
    expect(fxOf(events, "teleport")).toHaveLength(1);
    expect(ofType(events, "resolved")).toEqual([]);
    expect(ofType(events, "raidEnded")).toEqual([]);
    expect(w.state).toMatchObject({ phase: "active", winner: "" });
    expect(P(w, 0).status).toBe("alive");
    expect(P(w, 0).hp).toBeLessThan(P(w, 0).maxHp); // sudden death is on
  });

  it("a long solo run with nobody around just goes on", () => {
    const w = startRun(1, { patienceSeconds: 300, suddenDeathSeconds: 60 });
    expect(runTo(w, 250_000)).toEqual([]);
    expect(w.state.phase).toBe("active");
  });

  it("ends when the player dies: outcome died, no win GV, no winner", () => {
    const w = startRun(1);
    atTick(w, 500, (world) => kill(world, 0));
    const events = runTo(w, 500);
    expect(resultsOf(events)[idOf(0)]).toEqual({
      outcome: "died", profile: "alice", durationSec: 0, kills: 0, killedBy: "test", place: 1, players: 1,
      gv: { kills: 0, mobs: 0, bounty: 0, win: 0, total: 0 }, winBonusWithheld: false,
    });
    expect(w.state).toMatchObject({ phase: "ended", winner: "" });
    expect(fxOf(events, "victory")).toEqual([{ kind: "victory", id: null, name: null, draw: false }]);
    expect(ofType(events, "raidEnded")).toHaveLength(1);
  });

  it("ends when the player leaves: outcome mia", () => {
    const w = startRun(1);
    removePlayer(w, idOf(0));
    const events = tick(w);
    expect(Object.values(resultsOf(events))).toEqual([
      expect.objectContaining({ outcome: "mia", place: 1, players: 1, gv: { kills: 0, mobs: 0, bounty: 0, win: 0, total: 0 } }),
    ]);
    expect(w.state).toMatchObject({ phase: "ended", winner: "" });
    expect(ofType(events, "raidEnded")).toHaveLength(1);
  });

  it("dies to sudden death eventually, keeping the mob GV it earned", () => {
    const w = startRun(1);
    awardGv(w, P(w, 0), RT(w, 0), "mob");
    const events = runTo(w, 1000);
    for (let i = 0; i < 4000 && w.state.phase === "active"; i++) events.push(...tick(w));
    expect(w.state.phase).toBe("ended");
    const r = resultsOf(events)[idOf(0)]!;
    expect(r).toMatchObject({ outcome: "died", killedBy: SUDDEN_DEATH_KILLER, gv: { mobs: GV_MOB, bounty: 0, win: 0, total: GV_MOB } });
    expect(w.state.winner).toBe("");
  });
});

describe("sudden death", () => {
  /** Two players in the coliseum with 1000 hp each; sudden death starts at 4050 and the first burning tick is 4100. */
  function inColiseum(cfg: Partial<SimConfig> = {}) {
    const w = startRun(2, { suddenDeathSeconds: 2, ...cfg });
    for (let i = 0; i < 2; i++) { P(w, i).hp = 1000; P(w, i).maxHp = 1000; }
    return w;
  }

  it("share starts at SUDDEN_DEATH_START_FRACTION and steps up by SUDDEN_DEATH_RAMP_FRACTION each whole second", () => {
    expect(suddenDeathShare(0)).toBe(SUDDEN_DEATH_START_FRACTION);
    expect(suddenDeathShare(999)).toBe(SUDDEN_DEATH_START_FRACTION);
    expect(suddenDeathShare(1000)).toBeCloseTo(SUDDEN_DEATH_START_FRACTION + SUDDEN_DEATH_RAMP_FRACTION, 12);
    expect(suddenDeathShare(2999)).toBeCloseTo(SUDDEN_DEATH_START_FRACTION + 2 * SUDDEN_DEATH_RAMP_FRACTION, 12);
    expect(suddenDeathShare(10_000)).toBeCloseTo(SUDDEN_DEATH_START_FRACTION + 10 * SUDDEN_DEATH_RAMP_FRACTION, 12);
    expect(suddenDeathShare(-500)).toBe(SUDDEN_DEATH_START_FRACTION);
  });

  it("does no damage before suddenDeathAt", () => {
    const w = inColiseum();
    runTo(w, 2050);
    expect(w.state.suddenDeathAt).toBe(4050);
    const events = runTo(w, 4050);
    expect(P(w, 0).hp).toBe(1000);
    expect(P(w, 1).hp).toBe(1000);
    expect(fxOf(events, "death")).toEqual([]);
  });

  it("the first burning tick is the one that starts at suddenDeathAt, and burns the start share of max hp x dt", () => {
    const w = inColiseum();
    runTo(w, 4050); // starts at 4000: before suddenDeathAt, so no burn
    expect(P(w, 0).hp).toBe(1000);
    tick(w); // 4100: starts exactly at suddenDeathAt
    const burn = SUDDEN_DEATH_START_FRACTION * (TICK_MS / 1000) * 1000;
    expect(burn).toBeCloseTo(1, 12);
    expect(P(w, 0).hp).toBeCloseTo(1000 - burn, 9);
    expect(P(w, 1).hp).toBeCloseTo(1000 - burn, 9);
  });

  it("ramps up by one step every whole second after the first burning tick", () => {
    const w = inColiseum();
    runTo(w, 4100 - TICK_MS);
    for (let k = 0; k < 70; k++) {
      const before = P(w, 0).hp;
      tick(w);
      const elapsed = k * TICK_MS; // the tick began this long after suddenDeathAt
      const share = SUDDEN_DEATH_START_FRACTION + SUDDEN_DEATH_RAMP_FRACTION * Math.floor(elapsed / 1000);
      expect(before - P(w, 0).hp, `tick ${k}`).toBeCloseTo(share * (TICK_MS / 1000) * 1000, 9);
    }
    // 20 ticks at each of 1, 2, 3 hp, then 10 at 4.
    expect(P(w, 0).hp).toBeCloseTo(1000 - (20 * 1 + 20 * 2 + 20 * 3 + 10 * 4), 6);
  });

  it("burns every standing player the same share of their own max hp", () => {
    const w = inColiseum();
    P(w, 1).maxHp = 2000;
    P(w, 1).hp = 2000;
    runTo(w, 4100);
    expect(1000 - P(w, 0).hp).toBeCloseTo(1, 9);
    expect(2000 - P(w, 1).hp).toBeCloseTo(2, 9);
  });

  it("kills with SUDDEN_DEATH_KILLER and a death fx with no killer", () => {
    const w = inColiseum();
    runTo(w, 4050);
    P(w, 0).hp = 0.05;
    const x = P(w, 0).x;
    const y = P(w, 0).y;
    const events = tick(w);
    expect(fxOf(events, "death")).toEqual([{ kind: "death", id: idOf(0), x, y, by: null }]);
    expect(RT(w, 0).killedBy).toBe(SUDDEN_DEATH_KILLER);
    expect(P(w, 0).status).toBe("dead");
    expect(resultsOf(events)[idOf(0)]).toMatchObject({ outcome: "died", killedBy: SUDDEN_DEATH_KILLER, place: 2 });
    expect(P(w, 0).kills + P(w, 1).kills).toBe(0);
    expect(ofType(events, "gv")).toEqual([]);
  });

  it("the sudden-death victim's death is a death like any other: the other player wins at once", () => {
    const w = inColiseum();
    runTo(w, 4050);
    P(w, 0).hp = 0.05;
    tick(w);
    expect(w.state).toMatchObject({ phase: "ended", winner: "bob" });
  });

  it.each(Object.keys(FACTIONS))("the burn is true damage: %s's armor and shield cut none of it", (faction) => {
    const w = inColiseum();
    P(w, 0).faction = faction;
    runTo(w, 4050);
    const before = P(w, 0).hp;
    tick(w);
    expect(before - P(w, 0).hp).toBeCloseTo(1, 9);
  });

  it("shows no hit fx and counts as no combat: it is the arena's damage, not a hit", () => {
    const w = inColiseum();
    runTo(w, 4050);
    const events = tick(w);
    expect(P(w, 0).hp).toBeLessThan(1000);
    expect(fxOf(events, "hit")).toEqual([]);
    expect(w.combat.landed).toEqual([]);
  });

  describe("lands in the same pass as the tick's hits", () => {
    /** The first burning tick (4100), and a hit that kills whoever it lands on: a tick's own hits are recorded before the pass. */
    const FIRST_BURN = 4100;
    function lethalHit(w: World, by: number, victim: number, raw = 1e6): void {
      w.beforeDamage.push((world) => {
        if (world.state.serverTime !== FIRST_BURN) return;
        recordHit(world, {
          victim: idOf(victim), by: { id: idOf(by), name: NAMES[by]! }, packet: { raw, phys: 1, magic: 0, true: 0 }, weapon: "sword",
          stagger: false,
        });
      });
    }

    /**
     * Fire p0 (500 hp, so the first burn is 0.5) with `hp` left kills a full-hp p1 in the first burning tick. What that kill
     * pays would save p0 from the burn: a kill barrier (hp stacks) or, from a bountied victim, half of its hp stacks.
     */
    function standoff(spoils: "barrier" | "bounty", hp: number): World {
      const w = startRun(2, { suddenDeathSeconds: 2 }, { game: true });
      runTo(w, FIRST_BURN - TICK_MS);
      expect(w.state).toMatchObject({ gatesLocked: true, suddenDeathAt: 4050 });
      P(w, 0).hp = hp;
      if (spoils === "barrier") {
        P(w, 0).stacksHp = 3; // the kill shield combo: 15% of max hp
      } else {
        P(w, 1).stacksHp = 6;
        P(w, 1).kills = 3;
        P(w, 1).bounty = 10; // p0 claims it, with 3 of those hp stacks
      }
      lethalHit(w, 0, 1);
      return w;
    }

    it("pays the kill after the burn: the control, with hp to spare, does get the barrier", () => {
      const w = standoff("barrier", 100);
      tick(w);
      expect(P(w, 1).status).toBe("dead");
      expect(P(w, 0).status).toBe("alive");
      expect(P(w, 0).hp).toBeCloseTo(100 - 0.5, 9);
      expect(P(w, 0).barrier).toBeCloseTo(0.15 * 500, 9);
      expect(w.state).toMatchObject({ phase: "ended", winner: "alice" });
    });

    it("pays the bounty after the burn: the control, with hp to spare, does get the stacks", () => {
      const w = standoff("bounty", 100);
      tick(w);
      expect(P(w, 1).status).toBe("dead");
      expect(P(w, 0).stacksHp).toBe(3);
      expect(P(w, 0).maxHp).toBeGreaterThan(500);
      expect(P(w, 0).hp).toBeGreaterThan(100);
    });

    it.each(["barrier", "bounty"] as const)(
      "a killer the burn would kill without the %s its kill wins goes down with its victim", (spoils) => {
        const w = standoff(spoils, 0.25);
        const events = tick(w);
        expect(P(w, 1).status).toBe("dead"); // the hit it started still lands
        expect(P(w, 0).status).toBe("dead");
        expect(P(w, 0).barrier).toBe(0);
        expect(P(w, 0).maxHp).toBe(500);
        expect(RT(w, 0).killedBy).toBe(SUDDEN_DEATH_KILLER);
        expect(resultsOf(events)[idOf(0)]).toMatchObject({ outcome: "died", killedBy: SUDDEN_DEATH_KILLER });
        // Both went down in the same tick: the higher hp fraction at its start wins, not whoever's kill paid out.
        expect(w.state).toMatchObject({ phase: "ended", winner: "bob" });
      },
    );

    it("is credited to nobody, but a rival whose hit is in the lethal pass takes the kill", () => {
      const w = startRun(3, { suddenDeathSeconds: 2 });
      runTo(w, FIRST_BURN - TICK_MS);
      P(w, 0).hp = 0.8; // the burn is 0.5 and p1's hit 0.4: neither kills alone
      lethalHit(w, 1, 0, 0.4);
      const events = tick(w);
      expect(P(w, 0).status).toBe("dead");
      expect(RT(w, 0).killedBy).toBe("bob");
      expect(P(w, 1).kills).toBe(1);
      expect(resultsOf(events)[idOf(0)]).toMatchObject({ outcome: "died", killedBy: "bob" });
    });
  });

  it("stops burning when the gates unlock", () => {
    const w = inColiseum({ suddenDeathSeconds: 2 });
    atTick(w, 4300, (world) => { world.state.gatesLocked = false; }); // what a death does at settle, without the death
    runTo(w, 4300);
    const hp = P(w, 0).hp;
    expect(hp).toBeLessThan(1000);
    runTo(w, 4600);
    expect(P(w, 0).hp).toBe(hp);
  });

  it("does nothing while the gates are open or no start is scheduled", () => {
    const w = inColiseum();
    w.state.gatesLocked = false;
    w.state.suddenDeathAt = 1;
    w.state.serverTime += TICK_MS;
    suddenDeath(w, TICK_MS);
    expect(w.combat.ledger).toEqual([]);
    applyLedger(w);
    expect(P(w, 0).hp).toBe(1000);
    w.state.gatesLocked = true;
    w.state.suddenDeathAt = 0;
    suddenDeath(w, TICK_MS);
    expect(w.combat.ledger).toEqual([]);
    applyLedger(w);
    expect(P(w, 0).hp).toBe(1000);
  });

  it("is absorbed by teleport immunity when it starts inside the immunity window", () => {
    const w = inColiseum({ suddenDeathSeconds: 1 }); // sudden death at 3050, immunity until 3550
    runTo(w, 3500);
    expect(w.state.suddenDeathAt).toBe(3050);
    expect(P(w, 0).hp).toBe(1000); // ten burning ticks, all ignored
    tick(w); // 3550: immunity is over; the tick began 500 ms into sudden death, still in the first second
    expect(P(w, 0).hp).toBeCloseTo(1000 - 1, 9);
  });

  it("the ramp counts from suddenDeathAt, whether or not immunity swallowed the early burn", () => {
    const w = inColiseum({ suddenDeathSeconds: 1 }); // sudden death at 3050, immune until 3550
    runTo(w, 4000);
    const before = P(w, 0).hp;
    tick(w); // 4050 began 950 ms into sudden death: still the first second's share
    expect(before - P(w, 0).hp).toBeCloseTo(1, 9);
    const mid = P(w, 0).hp;
    tick(w); // 4100 began 1000 ms in: the second second's share
    expect(mid - P(w, 0).hp).toBeCloseTo(2, 9);
  });

  it("a step only burns once it started at or after suddenDeathAt, whatever its length", () => {
    const w = inColiseum();
    runTo(w, 4050);
    w.state.serverTime = 4060; // a 20 ms step that began at 4040, before suddenDeathAt
    suddenDeath(w, 20);
    applyLedger(w);
    expect(P(w, 0).hp).toBe(1000);
    w.state.serverTime = 4070; // began at 4050 = suddenDeathAt
    suddenDeath(w, 20);
    applyLedger(w);
    expect(1000 - P(w, 0).hp).toBeCloseTo(SUDDEN_DEATH_START_FRACTION * 0.02 * 1000, 9);
  });
});

describe("teleport immunity", () => {
  it("applyDamage returns 0 and changes nothing while serverTime < immuneUntil", () => {
    const w = startRun(2);
    P(w, 1).immuneUntil = w.state.serverTime + 100;
    const hp = P(w, 1).hp;
    expect(applyDamage(w, P(w, 1), RT(w, 1), 999, attacker(w, 0))).toBe(0);
    expect(P(w, 1).hp).toBe(hp);
    expect(P(w, 1).status).toBe("alive");
    expect(RT(w, 1).down).toBeNull();
    expect(RT(w, 1).killedBy).toBeNull();
    expect(P(w, 0).kills).toBe(0);
    expect(P(w, 0).gv).toBe(0);
    expect(w.events).toEqual([]);
  });

  it("works again from the tick serverTime reaches immuneUntil", () => {
    const w = startRun(2);
    const full = P(w, 1).maxHp;
    P(w, 1).immuneUntil = w.state.serverTime + 100;
    w.state.serverTime += 50;
    expect(applyDamage(w, P(w, 1), RT(w, 1), 10, "test")).toBe(0);
    w.state.serverTime += 49;
    expect(applyDamage(w, P(w, 1), RT(w, 1), 10, "test")).toBe(0);
    w.state.serverTime += 1;
    expect(w.state.serverTime).toBe(P(w, 1).immuneUntil);
    expect(applyDamage(w, P(w, 1), RT(w, 1), 10, "test")).toBe(10);
    expect(P(w, 1).hp).toBe(full - 10);
  });

  it("covers the TELEPORT_IMMUNITY_MS after a real teleport and no longer", () => {
    const w = startRun(2, { suddenDeathSeconds: 60 });
    const full = P(w, 1).maxHp;
    const landed: Array<[number, number]> = [];
    for (const t of [2100, 3500, 3550, 3600]) {
      atTick(w, t, (world) => landed.push([t, applyDamage(world, P(world, 1), RT(world, 1), 1, "test")]));
    }
    runTo(w, 3600);
    expect(P(w, 1).immuneUntil).toBe(2050 + TELEPORT_IMMUNITY_MS);
    expect(landed).toEqual([[2100, 0], [3500, 0], [3550, 1], [3600, 1]]);
    expect(P(w, 1).hp).toBe(full - 2);
  });

  it("does not stop a leave from downing the player", () => {
    const w = startRun(2);
    runTo(w, 2050);
    expect(P(w, 1).immuneUntil).toBeGreaterThan(w.state.serverTime);
    removePlayer(w, idOf(1));
    expect(resultsOf(w.events)[idOf(1)]).toMatchObject({ outcome: "mia" });
  });
});

describe("applyDamage and downPlayer", () => {
  it("returns the hp removed: the amount for a non-lethal hit, the hp left for an overkill", () => {
    const w = startRun(2);
    const full = P(w, 1).maxHp;
    expect(applyDamage(w, P(w, 1), RT(w, 1), 30, "test")).toBe(30);
    expect(P(w, 1).hp).toBe(full - 30);
    expect(applyDamage(w, P(w, 1), RT(w, 1), full + 500, "test")).toBe(full - 30);
    expect(P(w, 1).hp).toBe(0);
  });

  it("ignores zero, negative and non-numeric amounts", () => {
    const w = startRun(2);
    for (const amount of [0, -5, NaN]) expect(applyDamage(w, P(w, 1), RT(w, 1), amount, "test")).toBe(0);
    expect(P(w, 1).hp).toBe(P(w, 1).maxHp);
    expect(w.events).toEqual([]);
  });

  it("ignores anyone who is not standing", () => {
    const w = startRun(3);
    downPlayer(w, P(w, 2), RT(w, 2), "died");
    expect(applyDamage(w, P(w, 2), RT(w, 2), 10, "test")).toBe(0);
    P(w, 1).status = "lobby";
    expect(applyDamage(w, P(w, 1), RT(w, 1), 10, "test")).toBe(0);
    RT(w, 1).resolved = true;
    P(w, 1).status = "alive";
    expect(applyDamage(w, P(w, 1), RT(w, 1), 10, "test")).toBe(0);
    expect(P(w, 1).hp).toBe(P(w, 1).maxHp);
  });

  it("credits the killer's kills, names them as killedBy and sets the death fx's by", () => {
    const w = startRun(3);
    expect(kill(w, 1, attacker(w, 0))).toBeGreaterThan(0);
    expect(P(w, 0).kills).toBe(1);
    expect(RT(w, 1).killedBy).toBe("alice");
    expect(fxOf(w.events, "death")).toEqual([{ kind: "death", id: idOf(1), x: P(w, 1).x, y: P(w, 1).y, by: idOf(0) }]);
  });

  it("a non-lethal hit credits nobody", () => {
    const w = startRun(2);
    applyDamage(w, P(w, 1), RT(w, 1), 10, attacker(w, 0));
    expect(P(w, 0).kills).toBe(0);
    expect(RT(w, 0).gv).toEqual({ kills: 0, mobs: 0, bounty: 0 });
    expect(w.events).toEqual([]);
  });

  it("downPlayer inside a step defers the result to the end of the tick", () => {
    const w = startRun(3);
    let during: SimEvent[] = [];
    atTick(w, 200, (world) => {
      downPlayer(world, P(world, 2), RT(world, 2), "died");
      during = ofType(world.events, "resolved");
      expect(P(world, 2).status).toBe("dead");
      expect(RT(world, 2).down).toEqual({ outcome: "died" });
      expect(RT(world, 2).resolved).toBe(false);
    });
    const events = runTo(w, 200);
    expect(during).toEqual([]);
    expect(resultsOf(events)[idOf(2)]).toMatchObject({ outcome: "died" });
    expect(RT(w, 2).resolved).toBe(true);
  });

  it("downPlayer between steps resolves at once, and only once", () => {
    const w = startRun(3);
    downPlayer(w, P(w, 2), RT(w, 2), "mia");
    expect(P(w, 2).status).toBe("mia");
    expect(ofType(w.events, "resolved")).toHaveLength(1);
    downPlayer(w, P(w, 2), RT(w, 2), "died");
    expect(P(w, 2).status).toBe("mia");
    expect(ofType(w.events, "resolved")).toHaveLength(1);
    expect(w.arena.downsBetweenTicks).toBe(1);
  });

  it("downPlayer clears the path and drops the body through the hook", () => {
    const w = startRun(2);
    const dropped: string[] = [];
    w.hooks.dropBody = (_w, p) => { dropped.push(p.name); };
    RT(w, 1).path = [{ x: 1, y: 1 }];
    downPlayer(w, P(w, 1), RT(w, 1), "died");
    expect(RT(w, 1).path).toEqual([]);
    expect(dropped).toEqual(["bob"]);
  });

  it("without a body hook, the weapons a downed player carried are discarded", () => {
    const w = startRun(2);
    P(w, 1).weapon1 = "sword";
    expect([P(w, 1).weapon0, P(w, 1).weapon1]).toEqual([SIGNATURE_WEAPONS.sentenced, "sword"]);
    downPlayer(w, P(w, 1), RT(w, 1), "died");
    expect([P(w, 1).weapon0, P(w, 1).weapon1]).toEqual(["", ""]);
    expect([P(w, 0).weapon0, P(w, 0).weapon1]).toEqual([SIGNATURE_WEAPONS.fire, ""]);
  });
});

describe("applyHits", () => {
  // Several hits landing on one player in the same moment (the per-tick damage ledger): their sum comes off at once, so
  // no hit is "first", and the kill goes to the largest hit from a rival player.
  const hit = (amount: number, source: Attacker | string): Hit => ({ amount, source });

  it("takes the sum of the hits at once and returns the hp removed", () => {
    const w = startRun(3);
    const full = P(w, 1).maxHp;
    expect(applyHits(w, P(w, 1), RT(w, 1), [hit(10, attacker(w, 0)), hit(20, attacker(w, 2)), hit(5, "lava")])).toBe(35);
    expect(P(w, 1).hp).toBe(full - 35);
    expect(P(w, 1).status).toBe("alive");
    expect(w.events).toEqual([]);
  });

  it("counts every player among the sources as having damaged the victim, and the largest rival hit as the last hit", () => {
    const w = startRun(3);
    applyHits(w, P(w, 1), RT(w, 1), [hit(10, attacker(w, 0)), hit(20, attacker(w, 2)), hit(500, "lava")]);
    expect([...RT(w, 0).damaged]).toEqual([idOf(1)]);
    expect([...RT(w, 2).damaged]).toEqual([idOf(1)]);
    expect(RT(w, 1).lastHit).toEqual({ by: idOf(2), at: w.state.serverTime });
  });

  it("a lethal sum credits the largest hit from a rival player, even when a bigger hit came from the world", () => {
    const w = startRun(3);
    P(w, 1).hp = 50;
    expect(applyHits(w, P(w, 1), RT(w, 1), [hit(40, "lava"), hit(30, attacker(w, 0)), hit(20, attacker(w, 2))])).toBe(50);
    expect(P(w, 1).status).toBe("dead");
    expect(RT(w, 1).killedBy).toBe("alice");
    expect([P(w, 0).kills, P(w, 2).kills]).toEqual([1, 0]);
    expect(fxOf(w.events, "death")).toEqual([{ kind: "death", id: idOf(1), x: P(w, 1).x, y: P(w, 1).y, by: idOf(0) }]);
    expect(fxOf(w.events, "death")).toHaveLength(1);
  });

  it("equal rival hits go to the earlier one", () => {
    const w = startRun(3);
    P(w, 1).hp = 50;
    applyHits(w, P(w, 1), RT(w, 1), [hit(30, attacker(w, 2)), hit(30, attacker(w, 0))]);
    expect(RT(w, 1).killedBy).toBe("carol");
    expect([P(w, 0).kills, P(w, 2).kills]).toEqual([0, 1]);
  });

  it("a lethal sum from the world alone credits the world by name and no player", () => {
    const w = startRun(3);
    P(w, 1).hp = 50;
    applyHits(w, P(w, 1), RT(w, 1), [hit(40, "lava"), hit(30, "sudden death")]);
    expect(RT(w, 1).killedBy).toBe("lava");
    expect(fxOf(w.events, "death")).toEqual([{ kind: "death", id: idOf(1), x: P(w, 1).x, y: P(w, 1).y, by: null }]);
    expect([0, 1, 2].map((i) => P(w, i).kills)).toEqual([0, 0, 0]);
  });

  it("the victim's own hit is never a rival's: it can't credit them, and a rival's smaller hit still gets the kill", () => {
    const w = startRun(3);
    P(w, 1).hp = 50;
    applyHits(w, P(w, 1), RT(w, 1), [hit(100, attacker(w, 1)), hit(10, attacker(w, 0))]);
    expect(RT(w, 1).damaged.size).toBe(0);
    expect(RT(w, 0).damaged.has(idOf(1))).toBe(true);
    expect(P(w, 1).kills).toBe(0);
    expect(P(w, 0).kills).toBe(1);
  });

  it("ignores empty, zero, negative and non-numeric hits, and is ignored for anyone not standing", () => {
    const w = startRun(3);
    expect(applyHits(w, P(w, 1), RT(w, 1), [])).toBe(0);
    expect(applyHits(w, P(w, 1), RT(w, 1), [hit(0, attacker(w, 0)), hit(-5, attacker(w, 0)), hit(NaN, attacker(w, 0))])).toBe(0);
    expect(RT(w, 0).damaged.size).toBe(0); // a hit with no damage in it does not count
    expect(applyHits(w, P(w, 1), RT(w, 1), [hit(NaN, "lava"), hit(7, "lava")])).toBe(7);
    downPlayer(w, P(w, 2), RT(w, 2), "died");
    expect(applyHits(w, P(w, 2), RT(w, 2), [hit(10, attacker(w, 0))])).toBe(0);
    expect(RT(w, 0).damaged.has(idOf(2))).toBe(false);
  });

  it("teleport immunity absorbs the whole batch", () => {
    const w = startRun(3);
    P(w, 1).immuneUntil = w.state.serverTime + 100;
    expect(applyHits(w, P(w, 1), RT(w, 1), [hit(30, attacker(w, 0)), hit(20, attacker(w, 2)), hit(10_000, "lava")])).toBe(0);
    expect(P(w, 1).hp).toBe(P(w, 1).maxHp);
    expect(P(w, 1).status).toBe("alive");
    expect([...RT(w, 0).damaged, ...RT(w, 2).damaged]).toEqual([]);
    expect(RT(w, 1).lastHit).toBeNull();
  });

  it("applyDamage is the one-hit case: it credits the same way", () => {
    const w = startRun(3);
    P(w, 1).hp = 50;
    expect(applyDamage(w, P(w, 1), RT(w, 1), 80, attacker(w, 0))).toBe(50);
    expect(RT(w, 1).killedBy).toBe("alice");
    expect(P(w, 0).kills).toBe(1);
  });
});

describe("Glorious Victory", () => {
  it("a kill pays the killer GV_KILL: rt.gv.kills, the synced p.gv and a gv event", () => {
    const w = startRun(3);
    kill(w, 1, attacker(w, 0));
    expect(RT(w, 0).gv).toEqual({ kills: GV_KILL, mobs: 0, bounty: 0 });
    expect(P(w, 0).gv).toBe(GV_KILL);
    expect(ofType(w.events, "gv")).toEqual([{ type: "gv", id: idOf(0), amount: GV_KILL, reason: "kill" }]);
    // After the death fx (that is what clients show it next to), before any bounty fx.
    expect(w.events.map((e) => (e.type === "fx" ? e.fx.kind : e.type)).slice(0, 2)).toEqual(["death", "gv"]);
  });

  it("kills add up, and are not subject to the mob cap", () => {
    const w = startRun(4);
    for (let i = 0; i < 15; i++) awardGv(w, P(w, 0), RT(w, 0), "mob"); // hits the cap
    expect(RT(w, 0).gv.mobs).toBe(GV_MOB_CAP);
    kill(w, 1, attacker(w, 0));
    kill(w, 2, attacker(w, 0));
    expect(RT(w, 0).gv).toEqual({ kills: 2 * GV_KILL, mobs: GV_MOB_CAP, bounty: 0 });
    expect(P(w, 0).gv).toBe(2 * GV_KILL + GV_MOB_CAP);
    expect(P(w, 0).kills).toBe(2);
  });

  it("mob awards pay GV_MOB and elite awards GV_ELITE", () => {
    const w = startRun(2);
    expect(awardGv(w, P(w, 0), RT(w, 0), "mob")).toBe(GV_MOB);
    expect(awardGv(w, P(w, 0), RT(w, 0), "elite")).toBe(GV_ELITE);
    expect(ofType(w.events, "gv")).toEqual([
      { type: "gv", id: idOf(0), amount: GV_MOB, reason: "mob" },
      { type: "gv", id: idOf(0), amount: GV_ELITE, reason: "elite" },
    ]);
    expect(P(w, 0).gv).toBe(GV_MOB + GV_ELITE);
  });

  it("mob and elite awards together stop at GV_MOB_CAP, paying the remainder exactly", () => {
    const w = startRun(2);
    let total = 0;
    for (let i = 0; i < 14; i++) total += awardGv(w, P(w, 0), RT(w, 0), "mob");
    expect(total).toBe(14 * GV_MOB);
    const partial = awardGv(w, P(w, 0), RT(w, 0), "elite"); // only 2 of the 10 fit
    expect(partial).toBe(GV_MOB_CAP - 14 * GV_MOB);
    expect(RT(w, 0).gv.mobs).toBe(GV_MOB_CAP);
    const events = w.events.length;
    expect(awardGv(w, P(w, 0), RT(w, 0), "mob")).toBe(0);
    expect(awardGv(w, P(w, 0), RT(w, 0), "elite")).toBe(0);
    expect(w.events).toHaveLength(events); // a capped award makes no event
    expect(P(w, 0).gv).toBe(GV_MOB_CAP);
  });

  it("three elites reach the cap exactly; the cap is per player", () => {
    const w = startRun(2);
    for (let i = 0; i < 4; i++) awardGv(w, P(w, 0), RT(w, 0), "elite");
    expect(RT(w, 0).gv.mobs).toBe(GV_MOB_CAP);
    expect(GV_MOB_CAP).toBe(3 * GV_ELITE);
    expect(awardGv(w, P(w, 1), RT(w, 1), "elite")).toBe(GV_ELITE);
  });

  it("p.gv follows what the player has earned, never the win bonus", () => {
    const w = startRun(3);
    strike(w, 0, 2);
    atTick(w, 200, (world) => { kill(world, 1, attacker(world, 0)); kill(world, 2, "test"); });
    const events = runTo(w, 200);
    expect(P(w, 0).gv).toBe(GV_KILL);
    expect(resultsOf(events)[idOf(0)]!.gv.total).toBe(GV_KILL + GV_WIN);
  });

  it("is kept on death: a killer who later dies banks their kills in their result", () => {
    const w = startRun(4);
    atTick(w, 300, (world) => kill(world, 3, attacker(world, 1)));
    atTick(w, 500, (world) => { awardGv(world, P(world, 1), RT(world, 1), "mob"); kill(world, 1, attacker(world, 2)); });
    const events = runTo(w, 500);
    const results = resultsOf(events);
    expect(results[idOf(1)]).toMatchObject({
      outcome: "died", kills: 1, killedBy: "carol", gv: { kills: GV_KILL, mobs: GV_MOB, bounty: 0, win: 0, total: GV_KILL + GV_MOB },
    });
    expect(results[idOf(3)]!.gv.total).toBe(0);
  });

  it("awardGv after the player's result is out returns 0 and changes nothing", () => {
    const w = startRun(3);
    downPlayer(w, P(w, 2), RT(w, 2), "died"); // between steps: resolved at once
    expect(RT(w, 2).resolved).toBe(true);
    const events = w.events.length;
    expect(awardGv(w, P(w, 2), RT(w, 2), "kill")).toBe(0);
    expect(awardGv(w, P(w, 2), RT(w, 2), "mob")).toBe(0);
    expect(w.events).toHaveLength(events);
    expect(RT(w, 2).gv).toEqual({ kills: 0, mobs: 0, bounty: 0 });
    expect(P(w, 2).gv).toBe(0);
  });

  it("a player downed this tick but not yet resolved can still earn GV in that tick", () => {
    const w = startRun(3);
    atTick(w, 200, (world) => {
      kill(world, 0, "test"); // p0 goes down...
      expect(awardGv(world, P(world, 0), RT(world, 0), "mob")).toBe(GV_MOB); // ...and a swing of theirs lands in the same tick
    });
    const results = resultsOf(runTo(w, 200));
    expect(results[idOf(0)]!.gv).toEqual({ kills: 0, mobs: GV_MOB, bounty: 0, win: 0, total: GV_MOB });
  });

  it("unbankedGv is what the player has earned until their result is out", () => {
    const w = startRun(3);
    expect(unbankedGv(RT(w, 0))).toBe(0);
    awardGv(w, P(w, 0), RT(w, 0), "mob");
    kill(w, 1, attacker(w, 0));
    expect(unbankedGv(RT(w, 0))).toBe(GV_MOB + GV_KILL);
    expect(unbankedGv(RT(w, 1))).toBe(0);
    downPlayer(w, P(w, 0), RT(w, 0), "died");
    expect(unbankedGv(RT(w, 0))).toBe(0); // banked with the result
  });

  it("abandonPlayer returns the unbanked GV, resolves nobody and emits nothing", () => {
    const w = startRun(3);
    awardGv(w, P(w, 0), RT(w, 0), "mob");
    awardGv(w, P(w, 0), RT(w, 0), "elite");
    w.events = [];
    const rt = RT(w, 0);
    expect(abandonPlayer(w, idOf(0))).toBe(GV_MOB + GV_ELITE);
    expect(rt.resolved).toBe(true);
    expect(w.events).toEqual([]);
    expect(w.state.players.has(idOf(0))).toBe(false);
    expect(abandonPlayer(w, idOf(0))).toBe(0); // gone
    expect(abandonPlayer(w, "nobody")).toBe(0);
  });

  it("abandonPlayer returns 0 for a player whose result is out (already banked)", () => {
    const w = startRun(3);
    awardGv(w, P(w, 0), RT(w, 0), "mob");
    downPlayer(w, P(w, 0), RT(w, 0), "died");
    w.events = [];
    expect(abandonPlayer(w, idOf(0))).toBe(0);
    expect(w.events).toEqual([]);
  });

  it("abandonPlayer returns 0 for a player who earned nothing", () => {
    const w = startRun(2);
    expect(abandonPlayer(w, idOf(1))).toBe(0);
  });

  it("the GV ledger balances over a scripted run", () => {
    const w = startRun(4);
    for (let i = 0; i < 5; i++) awardGv(w, P(w, 2), RT(w, 2), "mob");
    atTick(w, 500, (world) => kill(world, 1, attacker(world, 0)));
    atTick(w, 700, (world) => kill(world, 0, attacker(world, 2)));
    atTick(w, 900, (world) => kill(world, 3, attacker(world, 2)));
    const results = resultsOf(runTo(w, 900));
    expect(w.state.winner).toBe("carol");
    expect(results[idOf(0)]!.gv).toEqual({ kills: GV_KILL, mobs: 0, bounty: 0, win: 0, total: GV_KILL });
    expect(results[idOf(1)]!.gv.total).toBe(0);
    expect(results[idOf(3)]!.gv.total).toBe(0);
    expect(results[idOf(2)]!.gv).toEqual({
      kills: 2 * GV_KILL, mobs: 5 * GV_MOB, bounty: 0, win: GV_WIN, total: 2 * GV_KILL + 5 * GV_MOB + GV_WIN,
    });
    const sum = Object.values(results).reduce((n, r) => n + r.gv.total, 0);
    expect(sum).toBe(3 * GV_KILL + 5 * GV_MOB + GV_WIN);
    for (const r of Object.values(results)) expect(r.gv.total).toBe(r.gv.kills + r.gv.mobs + r.gv.bounty + r.gv.win);
  });

  it("a draw's ledger has no win bonus", () => {
    const w = startRun(2);
    awardGv(w, P(w, 0), RT(w, 0), "elite");
    atTick(w, 300, (world) => { kill(world, 1, attacker(world, 0)); kill(world, 0, attacker(world, 1)); });
    const results = resultsOf(runTo(w, 300));
    expect(Object.values(results).map((r) => r.outcome)).toEqual(["draw", "draw"]);
    const sum = Object.values(results).reduce((n, r) => n + r.gv.total, 0);
    expect(sum).toBe(2 * GV_KILL + GV_ELITE);
  });

  /**
   * `dealt` is what the melee saw land, tracked independently of the sim: for each player, the different opponents
   * they hurt (applyDamage returned hp removed). `rts` keeps every runtime, leavers included.
   */
  interface Melee {
    w: World; all: SimEvent[]; n: number; teleports: number; dealt: Map<string, Set<string>>; rts: Map<string, PlayerRuntime>;
  }

  /**
   * A seeded melee of kills, mob awards, leaves and sudden death (every fourth seed is peaceful, so sudden death
   * alone decides it; every fifth is full of leavers). Checks the arena's state machine after every tick on the way.
   * A hunt (5 to 8 players, never peaceful) also has the best-fed player go on a spree and others go for the biggest
   * bounty, so bounties get announced, claimed and passed on.
   */
  function playMelee(seed: number, hunt = false): Melee {
    const rnd = mulberry32(seed * 7919);
    const n = hunt ? 5 + (seed % 4) : 2 + (seed % (MAX_PLAYERS - 1));
    const peaceful = !hunt && seed % 4 === 0;
    const patience = 1 + (seed % 3);
    const leaveChance = seed % 5 === 0 ? 0.03 : 0.004;
    const w = startRun(n, { patienceSeconds: patience, suddenDeathSeconds: 1 }, { seed, random: mulberry32(seed) });
    const all: SimEvent[] = [];
    const rts = new Map([...w.players]);
    const dealt = new Map<string, Set<string>>();
    const hurt = (world: World, victim: string, amount: number, by: Attacker | string): void => {
      const landed = applyDamage(world, world.state.players.get(victim)!, world.players.get(victim)!, amount, by);
      if (landed > 0 && typeof by !== "string" && by.id !== victim) {
        if (!dealt.has(by.id)) dealt.set(by.id, new Set());
        dealt.get(by.id)!.add(victim);
      }
    };
    const standingIds = () => [...w.state.players.keys()].filter((id) => w.state.players.get(id)!.status === "alive");
    w.systems.push((world) => {
      if (world.state.phase !== "active" || peaceful) return;
      const standing = standingIds();
      if (standing.length === 0) return;
      const pick = () => standing[Math.floor(rnd() * standing.length)]!;
      const who = (x: string) => ({ id: x, p: world.state.players.get(x)!, rt: world.players.get(x)! });
      if (hunt && rnd() < 0.15) {
        const fed = (x: string) => world.state.players.get(x)!.kills;
        const bountyOn = (x: string) => world.state.players.get(x)!.bounty;
        const hunter = standing.reduce((best, x) => (fed(x) > fed(best) ? x : best), standing[0]!);
        const target = standing.reduce((best, x) => (bountyOn(x) > bountyOn(best) ? x : best), standing[0]!);
        const others = (not: string) => standing.filter((x) => x !== not);
        if (bountyOn(target) > 0 && rnd() < 0.5) {
          const claimers = others(target);
          if (claimers.length > 0) hurt(world, target, 150, who(claimers[Math.floor(rnd() * claimers.length)]!));
        } else {
          const prey = others(hunter);
          if (prey.length > 0) {
            const victim = prey[Math.floor(rnd() * prey.length)]!;
            hurt(world, victim, 150, who(hunter));
          }
        }
        return;
      }
      const r = rnd();
      const id = pick();
      if (r < 0.04) {
        awardGv(world, who(id).p, who(id).rt, rnd() < 0.5 ? "mob" : "elite");
      } else if (r < 0.07) {
        const victim = pick();
        if (victim !== id) hurt(world, victim, 5 + rnd() * 120, who(id));
      } else if (r < 0.08) {
        hurt(world, id, 5 + rnd() * 60, "test");
      }
    });
    let teleports = 0;
    for (let ticks = 0; w.state.phase === "active" && ticks < 6000; ticks++) {
      if (rnd() < leaveChance) {
        const standing = standingIds();
        if (standing.length > 0) removePlayer(w, standing[Math.floor(rnd() * standing.length)]!);
      }
      const events = tick(w);
      all.push(...events);
      const s = w.state;
      const teleported = fxOf(events, "teleport").length;
      const downs = ofType(events, "resolved").filter((e) => e.result.outcome === "died" || e.result.outcome === "mia").length;
      teleports += teleported;
      if (s.phase !== "active") break;
      expect(teleported).toBeLessThanOrEqual(1);
      if (downs > 0) {
        // Any death, leaves included, takes the gates down and restarts the full patience timer.
        expect(teleported).toBe(0);
        expect(s.gatesLocked).toBe(false);
        expect(s.suddenDeathAt).toBe(0);
        expect(s.patienceEndsAt).toBe(s.serverTime + patience * 1000);
      }
      if (teleported === 1) {
        expect(downs).toBe(0);
        expect(s.gatesLocked).toBe(true);
        expect(s.inColiseum).toBe(true);
        expect(s.suddenDeathAt).toBe(s.serverTime + 1000);
        for (const id of standingIds()) expect(s.players.get(id)!.immuneUntil).toBe(s.serverTime + TELEPORT_IMMUNITY_MS);
      }
      if (s.gatesLocked) {
        expect(s.patienceEndsAt).toBe(0);
        expect(s.suddenDeathAt).toBeGreaterThan(0);
      } else {
        expect(s.suddenDeathAt).toBe(0);
        expect(s.patienceEndsAt).toBeGreaterThan(s.serverTime - TICK_MS); // never overdue: it teleports the tick it expires
      }
      for (const p of s.players.values()) {
        expect(p.hp).toBeGreaterThanOrEqual(0);
        expect(p.hp).toBeLessThanOrEqual(p.maxHp);
        if (p.status === "alive") expect(p.hp).toBeGreaterThan(0);
      }
    }
    return { w, all, n, teleports, dealt, rts };
  }

  const melees = new Map<number, Melee>();
  const melee = (seed: number): Melee => {
    if (!melees.has(seed)) melees.set(seed, playMelee(seed));
    return melees.get(seed)!;
  };
  const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);
  const hunts = new Map<number, Melee>();
  const huntFor = (seed: number): Melee => {
    if (!hunts.has(seed)) hunts.set(seed, playMelee(seed, true));
    return hunts.get(seed)!;
  };
  const HUNT_SEEDS = Array.from({ length: 40 }, (_, i) => 100 + i);

  /**
   * Reads the kills and bounties back off the event stream alone. A kill is a gv "kill" event: straight after the
   * victim's death fx, or, for a kill credited on a leave, ahead of the leaver's `mia` result. The bounty it must have
   * paid is what the victim's own player kills so far earn (bountyFor; mob kills never count), as a gv
   * "bounty" event right behind the kill's own. Announcements are throttled (BOUNTY_ANNOUNCE_MS) and can lag behind the
   * bounty, so the amount owed is not read from them; each one that does go out must still carry the amount then owed.
   */
  function readKills(all: SimEvent[]) {
    const made = new Map<string, number>(); // kills credited so far, by killer
    const owedBy = (id: string): number => bountyFor(made.get(id) ?? 0);
    const out = { kills: 0, leaveKills: 0, claims: 0, bounties: 0 };
    all.forEach((e, i) => {
      if (e.type === "fx" && e.fx.kind === "bounty") expect(e.fx.bounty, `announced bounty of ${e.fx.id}`).toBe(owedBy(e.fx.id));
      if (e.type !== "gv" || e.reason !== "kill") return;
      made.set(e.id, (made.get(e.id) ?? 0) + 1);
      out.kills++;
      const before = all[i - 1];
      let victim: string;
      // A death fx with no killer is a mob (or sudden death) finishing someone: when a kill follows it, a player took the credit
      // for a hit they landed within KILL_CREDIT_SECONDS.
      if (before?.type === "fx" && before.fx.kind === "death" && (before.fx.by === e.id || before.fx.by === null)) {
        victim = before.fx.id;
      } else {
        const leaver = all.slice(i + 1).find((x): x is EventOf<"resolved"> => x.type === "resolved");
        expect(leaver?.result.outcome, "a kill with no death behind it must be a credited leave").toBe("mia");
        victim = leaver!.id;
        out.leaveKills++;
      }
      const owed = owedBy(victim);
      const next = all[i + 1];
      if (owed > 0) {
        expect(next, `the bounty on ${victim}`).toEqual({ type: "gv", id: e.id, amount: owed, reason: "bounty" });
        out.claims++;
        out.bounties += owed;
      } else {
        expect(next?.type === "gv" && next.reason === "bounty", `no bounty on ${victim}`).toBe(false);
      }
    });
    return out;
  }

  /** Everything that must hold at the end of any seeded run, whoever won. */
  function expectRun({ w, all, n, dealt, rts }: Melee): void {
    expect(w.state.phase, "the run must end").toBe("ended");
    const results = resultsOf(all); // also fails on a double result
    expect(Object.keys(results).sort()).toEqual(Array.from({ length: n }, (_, i) => idOf(i)).sort());
    expect(ofType(all, "raidEnded")).toHaveLength(1);

    const announced = ofType(all, "gv").reduce((sum, e) => sum + e.amount, 0);
    const mobGv = ofType(all, "gv").filter((e) => e.reason === "mob" || e.reason === "elite").reduce((sum, e) => sum + e.amount, 0);
    const outcomes = Object.values(results).map((r) => r.outcome);
    const winners = outcomes.filter((o) => o === "won").length;
    const draws = outcomes.filter((o) => o === "draw").length;
    expect(winners).toBeLessThanOrEqual(1);
    expect(winners === 1 && draws > 0).toBe(false);
    expect(draws).not.toBe(1);
    const winnerResult = Object.values(results).find((r) => r.outcome === "won");
    const winnerId = winnerResult ? `p${NAMES.indexOf(winnerResult.profile)}` : null;
    // The runtime's own record of who each player hurt is what the melee saw land, leavers and the dead included.
    for (const [id, rt] of rts) expect([...rt.damaged].sort(), `${id} damaged`).toEqual([...(dealt.get(id) ?? [])].sort());
    // The bonus is paid to a winner of a run that started with enough players who hurt enough different ones.
    const eligible = winnerId !== null && n >= WIN_BONUS_MIN_PLAYERS && (dealt.get(winnerId)?.size ?? 0) >= WIN_BONUS_MIN_OPPONENTS;
    const bonus = eligible ? GV_WIN : 0;
    const banked = Object.values(results).reduce((sum, r) => sum + r.gv.total, 0);
    expect(banked).toBe(announced + bonus);

    // The same ledger, built from the kills and the victims' announced bounties rather than from the gv amounts.
    const { kills, claims, bounties } = readKills(all);
    expect(Object.values(results).reduce((sum, r) => sum + r.kills, 0), "kills in the results").toBe(kills);
    expect(banked, "GV_KILL × kills + mob GV + bounties paid + the win bonus actually paid").toBe(
      GV_KILL * kills + mobGv + bounties + bonus,
    );
    expect(Object.values(results).reduce((sum, r) => sum + r.gv.bounty, 0), "bounty GV in the results").toBe(bounties);
    expect(ofType(all, "gv").filter((e) => e.reason === "bounty")).toHaveLength(claims);

    for (const r of Object.values(results)) {
      expect(r.gv.total).toBe(r.gv.kills + r.gv.mobs + r.gv.bounty + r.gv.win);
      expect(r.gv.kills, `${r.profile} kill GV`).toBe(GV_KILL * r.kills);
      expect(r.gv.bounty).toBeGreaterThanOrEqual(0);
      if (r.gv.bounty > 0) {
        // Only a victim with 3 or more kills carries a bounty.
        expect(Math.max(...Object.values(results).filter((o) => o !== r).map((o) => o.kills))).toBeGreaterThanOrEqual(3);
      }
      expect(r.gv.mobs).toBeLessThanOrEqual(GV_MOB_CAP);
      expect(r.gv.win).toBe(r.outcome === "won" ? bonus : 0);
      expect(r.winBonusWithheld, `${r.profile} ${r.outcome}`).toBe(r.outcome === "won" && !eligible);
      expect(r.players).toBe(n);
      expect(r.place).toBeGreaterThanOrEqual(1);
      expect(r.place).toBeLessThanOrEqual(n);
      if (r.outcome === "won" || r.outcome === "draw") expect(r.place).toBe(1);
      else if (winners + draws > 0) expect(r.place, `${r.profile} ${r.outcome}`).toBeGreaterThanOrEqual(2);
    }
    expect(w.state.winner).toBe(winnerResult ? winnerResult.profile : "");
    const [victory] = fxOf(all, "victory");
    expect(fxOf(all, "victory")).toHaveLength(1);
    expect(victory).toEqual({
      kind: "victory", id: winnerId, name: winnerResult?.profile ?? null, draw: draws > 0,
    });
  }

  it.each(SEEDS)("holds the ledger and the outcome rules in a random run (seed %i)", (seed) => {
    expectRun(melee(seed));
  });

  it.each(HUNT_SEEDS)("holds the ledger and the outcome rules in a bounty hunt (seed %i)", (seed) => {
    expectRun(huntFor(seed));
  });

  it("the random runs between them reach wins, draws, leaves, kills, elite awards and repeated teleports", () => {
    const all = SEEDS.map(melee);
    const outcomeSets = all.map((m) => new Set(Object.values(resultsOf(m.all)).map((r) => r.outcome)));
    expect(outcomeSets.some((o) => o.has("won"))).toBe(true);
    expect(outcomeSets.some((o) => o.has("draw"))).toBe(true);
    expect(outcomeSets.some((o) => o.has("mia"))).toBe(true);
    expect(all.some((m) => ofType(m.all, "gv").some((e) => e.reason === "kill"))).toBe(true);
    expect(all.some((m) => ofType(m.all, "gv").some((e) => e.reason === "elite"))).toBe(true);
    expect(all.some((m) => m.teleports >= 2)).toBe(true);
    const winnerFlags = all.flatMap((m) => Object.values(resultsOf(m.all)).filter((r) => r.outcome === "won").map((r) => r.winBonusWithheld));
    expect(winnerFlags).toContain(true); // winners whose bonus was withheld...
    expect(winnerFlags).toContain(false); // ...and winners who earned it
  });

  it("the hunts between them announce bounties, pay them out, pass them on and credit kills on leaves", () => {
    const ran = HUNT_SEEDS.map(huntFor);
    const read = ran.map((m) => readKills(m.all));
    expect(ran.some((m) => fxOf(m.all, "bounty").length > 0)).toBe(true);
    expect(read.some((r) => r.claims > 0)).toBe(true);
    expect(read.reduce((n, r) => n + r.claims, 0)).toBeGreaterThanOrEqual(5);
    // A player who claimed a bounty went on to carry one, and had theirs claimed in turn.
    const chained = ran.some((m) => {
      const bountied = new Set(fxOf(m.all, "bounty").map((fx) => fx.id));
      return ofType(m.all, "gv").some((e) => e.reason === "bounty" && bountied.has(e.id));
    });
    expect(chained).toBe(true);
    const everything = [...SEEDS.map(melee), ...ran];
    expect(everything.some((m) => readKills(m.all).leaveKills > 0)).toBe(true);
    expect(ran.some((m) => Object.values(resultsOf(m.all)).some((r) => r.gv.bounty > 0 && r.outcome === "won"))).toBe(true);
  });

  it.each([1, 2, 3, 4, 5, 6])("replays a random run identically (seed %i)", (seed) => {
    const again = playMelee(seed);
    expect(again.all).toEqual(melee(seed).all);
    expect([...again.w.state.players.values()].map((p) => [p.name, p.x, p.y, p.hp, p.status, p.gv, p.kills])).toEqual(
      [...melee(seed).w.state.players.values()].map((p) => [p.name, p.x, p.y, p.hp, p.status, p.gv, p.kills]),
    );
  });

  it.each([100, 101, 102])("replays a bounty hunt identically (seed %i)", (seed) => {
    const again = playMelee(seed, true);
    expect(again.all).toEqual(huntFor(seed).all);
    expect([...again.w.state.players.values()].map((p) => [p.name, p.hp, p.status, p.gv, p.kills, p.bounty])).toEqual(
      [...huntFor(seed).w.state.players.values()].map((p) => [p.name, p.hp, p.status, p.gv, p.kills, p.bounty]),
    );
  });
});

describe("win bonus eligibility", () => {
  const LONG = { patienceSeconds: 3600 } as const; // nothing happens in the arena by itself
  /** The ids the sim has recorded `rt` as having damaged, sorted. */
  const damagedBy = (rt: PlayerRuntime): string[] => [...rt.damaged].sort();
  const winnerOf = (events: SimEvent[], i = 0): RunResult => resultsOf(events)[idOf(i)]!;
  /** Everyone from `from` up dies to something that isn't a player (the "test" source). */
  const killRest = (world: World, from: number, n: number): void => { for (let i = from; i < n; i++) kill(world, i); };

  it("the rule's numbers: 3 players started and 2 different opponents damaged", () => {
    expect(WIN_BONUS_MIN_PLAYERS).toBe(3);
    expect(WIN_BONUS_MIN_OPPONENTS).toBe(2);
    expect(GV_WIN).toBe(50);
  });

  describe("who is paid", () => {
    it("pays GV_WIN at exactly 3 starters when the winner damaged exactly 2 different opponents", () => {
      const w = startRun(3, LONG);
      strike(w, 0, 1);
      strike(w, 0, 2);
      atTick(w, 200, (world) => killRest(world, 1, 3));
      const events = runTo(w, 200);
      const r = winnerOf(events);
      expect(r).toMatchObject({ outcome: "won", place: 1, players: 3, kills: 0, winBonusWithheld: false });
      expect(r.gv).toEqual({ kills: 0, mobs: 0, bounty: 0, win: GV_WIN, total: GV_WIN });
      expect(damagedBy(RT(w, 0))).toEqual([idOf(1), idOf(2)]);
    });

    it("damaging more than the minimum pays the same single GV_WIN", () => {
      const w = startRun(4, LONG);
      for (const v of [1, 2, 3]) strike(w, 0, v);
      atTick(w, 200, (world) => killRest(world, 1, 4));
      expect(winnerOf(runTo(w, 200)).gv.win).toBe(GV_WIN);
    });

    it("never pays a 2-player run, even when the winner damaged their only opponent", () => {
      const w = startRun(2, LONG);
      strike(w, 0, 1);
      atTick(w, 200, (world) => kill(world, 1, attacker(world, 0)));
      const r = winnerOf(runTo(w, 200));
      expect(damagedBy(RT(w, 0))).toEqual([idOf(1)]);
      expect(r).toMatchObject({ outcome: "won", place: 1, players: 2, kills: 1, winBonusWithheld: true });
      expect(r.gv).toEqual({ kills: GV_KILL, mobs: 0, bounty: 0, win: 0, total: GV_KILL });
    });

    it("withholds it from the winner of a 2-player run who did nothing because the other left", () => {
      const w = startRun(2, LONG);
      removePlayer(w, idOf(1));
      const events = tick(w);
      expect(damagedBy(RT(w, 0))).toEqual([]);
      expect(winnerOf(events)).toMatchObject({
        outcome: "won", place: 1, players: 2, gv: { win: 0, total: 0 }, winBonusWithheld: true,
      });
      expect(resultsOf(events)[idOf(1)]).toMatchObject({ outcome: "mia", winBonusWithheld: false });
    });

    it("withholds it at 3 starters from a winner who damaged only 1 opponent, however many times they hit them", () => {
      const w = startRun(3, LONG);
      for (let i = 0; i < 25; i++) strike(w, 0, 1, 0.5);
      expect(P(w, 1).hp).toBe(P(w, 1).maxHp - 25 * 0.5);
      expect(RT(w, 0).damaged.size).toBe(1); // one opponent, however many blows
      atTick(w, 200, (world) => { kill(world, 2); kill(world, 1, attacker(world, 0)); });
      const r = winnerOf(runTo(w, 200));
      expect(r).toMatchObject({ outcome: "won", place: 1, players: 3, kills: 1, winBonusWithheld: true });
      expect(r.gv).toEqual({ kills: GV_KILL, mobs: 0, bounty: 0, win: 0, total: GV_KILL });
    });

    it("withholds it from a winner who damaged nobody, in a run of any size", () => {
      for (const n of [3, 4, MAX_PLAYERS]) {
        const w = startRun(n, LONG);
        atTick(w, 200, (world) => killRest(world, 1, n));
        expect(winnerOf(runTo(w, 200)), `${n} players`).toMatchObject({ outcome: "won", gv: { win: 0 }, winBonusWithheld: true });
      }
    });

    // starters, different opponents the winner damaged (and finished off), whether the bonus is paid
    it.each([
      [2, 0, false], [2, 1, false],
      [3, 0, false], [3, 1, false], [3, 2, true],
      [4, 1, false], [4, 2, true], [4, 3, true],
      [MAX_PLAYERS, 1, false], [MAX_PLAYERS, 2, true], [MAX_PLAYERS, MAX_PLAYERS - 1, true],
    ] as const)("%i starters, winner damaged %i different opponents: bonus paid %s", (n, hurt, paid) => {
      const w = startRun(n, LONG);
      atTick(w, 200, (world) => {
        for (let i = 1; i <= hurt; i++) kill(world, i, attacker(world, 0));
        killRest(world, hurt + 1, n);
      });
      const events = runTo(w, 200);
      const results = resultsOf(events);
      expect(results[idOf(0)]).toMatchObject({
        outcome: "won", place: 1, players: n, kills: hurt, winBonusWithheld: !paid,
        gv: { kills: hurt * GV_KILL, win: paid ? GV_WIN : 0, total: hurt * GV_KILL + (paid ? GV_WIN : 0) },
      });
      for (let i = 1; i < n; i++) expect(results[idOf(i)], `p${i}`).toMatchObject({ outcome: "died", winBonusWithheld: false, gv: { win: 0 } });
      const banked = Object.values(results).reduce((sum, r) => sum + r.gv.total, 0);
      expect(banked).toBe(hurt * GV_KILL + (paid ? GV_WIN : 0));
    });
  });

  describe("the player count is who the run went active with", () => {
    it("does not count a lobby leaver: 3 joined, 1 left in the lobby, the run went active with 2", () => {
      const w = createWorld({ seed: 1234, config: makeConfig({ minPlayers: 2 }), random: mulberry32(1) });
      for (let i = 0; i < 3; i++) addPlayer(w, idOf(i), NAMES[i]!);
      removePlayer(w, idOf(2));
      step(w, TICK_MS);
      expect(w.state.phase).toBe("active");
      expect(w.arena.startedWith).toBe(2);
      strike(w, 0, 1);
      atTick(w, 200, (world) => kill(world, 1, attacker(world, 0)));
      const r = winnerOf(runTo(w, 200));
      expect(r).toMatchObject({ outcome: "won", players: 2, kills: 1, winBonusWithheld: true });
      expect(r.gv).toEqual({ kills: GV_KILL, mobs: 0, bounty: 0, win: 0, total: GV_KILL });
    });

    it("counts the players present when it started: 4 joined, 1 left in the lobby, 3 started", () => {
      const w = createWorld({ seed: 1234, config: makeConfig({ minPlayers: 3 }), random: mulberry32(1) });
      for (let i = 0; i < 4; i++) addPlayer(w, idOf(i), NAMES[i]!);
      removePlayer(w, idOf(3));
      step(w, TICK_MS);
      expect(w.arena.startedWith).toBe(3);
      strike(w, 0, 1);
      strike(w, 0, 2);
      atTick(w, 200, (world) => killRest(world, 1, 3));
      expect(winnerOf(runTo(w, 200))).toMatchObject({ outcome: "won", players: 3, gv: { win: GV_WIN }, winBonusWithheld: false });
    });
  });

  describe("what counts as damaging an opponent", () => {
    it("a blow that lands counts, and so does a lethal blow", () => {
      const w = startRun(3, LONG);
      expect(strike(w, 0, 1, 10)).toBe(10);
      expect(damagedBy(RT(w, 0))).toEqual([idOf(1)]);
      expect(kill(w, 2, attacker(w, 0))).toBeGreaterThan(0);
      expect(damagedBy(RT(w, 0))).toEqual([idOf(1), idOf(2)]);
      expect(P(w, 2).status).toBe("dead");
    });

    it("a winner of 3 who only ever landed lethal blows has damaged both victims", () => {
      const w = startRun(3, LONG);
      atTick(w, 200, (world) => { kill(world, 1, attacker(world, 0)); kill(world, 2, attacker(world, 0)); });
      const r = winnerOf(runTo(w, 200));
      expect(r).toMatchObject({ outcome: "won", kills: 2, winBonusWithheld: false });
      expect(r.gv).toEqual({ kills: 2 * GV_KILL, mobs: 0, bounty: 0, win: GV_WIN, total: 2 * GV_KILL + GV_WIN });
    });

    it("damaging someone does not need a kill: the winner can have no kills and still be paid", () => {
      const w = startRun(3, LONG);
      strike(w, 0, 1);
      strike(w, 0, 2);
      atTick(w, 200, (world) => killRest(world, 1, 3));
      const r = winnerOf(runTo(w, 200));
      expect(r.kills).toBe(0);
      expect(r.gv.win).toBe(GV_WIN);
    });

    it("damage to an opponent who later left still counts", () => {
      const w = startRun(3, LONG);
      const rt0 = RT(w, 0);
      strike(w, 0, 1);
      removePlayer(w, idOf(1)); // credited as p0's kill: the hit was just now
      expect(w.state.players.has(idOf(1))).toBe(false);
      expect(w.arena.startedWith).toBe(3); // a player who leaves after the start is still one of the starters
      expect(damagedBy(rt0)).toEqual([idOf(1)]); // the record outlives the leaver
      strike(w, 0, 2);
      atTick(w, 200, (world) => kill(world, 2, attacker(world, 0)));
      const r = winnerOf(runTo(w, 200));
      expect(r).toMatchObject({ outcome: "won", players: 3, kills: 2, winBonusWithheld: false });
      expect(r.gv).toEqual({ kills: 2 * GV_KILL, mobs: 0, bounty: 0, win: GV_WIN, total: 2 * GV_KILL + GV_WIN });
    });

    it("self-damage does not count, lethal or not", () => {
      const w = startRun(3, LONG);
      expect(applyDamage(w, P(w, 0), RT(w, 0), 10, attacker(w, 0))).toBe(10);
      expect(P(w, 0).hp).toBe(P(w, 0).maxHp - 10);
      expect(RT(w, 0).damaged.size).toBe(0);
      expect(RT(w, 0).lastHit).toBeNull();
      kill(w, 0, attacker(w, 0));
      expect(P(w, 0).status).toBe("dead");
      expect(P(w, 0).kills).toBe(0);
      expect(RT(w, 0).damaged.size).toBe(0);
    });

    it("string sources (the world, sudden death) count for nobody", () => {
      const w = startRun(3, LONG);
      for (const source of ["test", SUDDEN_DEATH_KILLER, "lava"]) {
        for (let i = 0; i < 3; i++) expect(applyDamage(w, P(w, i), RT(w, i), 5, source)).toBe(5);
      }
      for (let i = 0; i < 3; i++) expect(damagedBy(RT(w, i)), `p${i}`).toEqual([]);
    });

    it("the sudden death burn does not count", () => {
      const w = startRun(3, { suddenDeathSeconds: 1 });
      runTo(w, 4500); // teleport at 2050, burning from 3100 on
      expect(w.state.phase).toBe("active");
      for (let i = 0; i < 3; i++) {
        expect(P(w, i).hp, `p${i} hp`).toBeLessThan(P(w, i).maxHp);
        expect(damagedBy(RT(w, i)), `p${i}`).toEqual([]);
      }
    });

    it("a run decided by sudden death alone pays nobody the bonus: the last one burning wins without it", () => {
      const w = startRun(3, { suddenDeathSeconds: 1 });
      P(w, 1).hp = 30;
      P(w, 2).hp = 40; // p0, on full hp, outlasts them
      const events = runTo(w, 2050);
      for (let i = 0; i < 4000 && w.state.phase === "active"; i++) events.push(...tick(w));
      expect(w.state.phase).toBe("ended");
      const results = resultsOf(events);
      expect(results[idOf(0)]).toMatchObject({
        outcome: "won", place: 1, gv: { kills: 0, mobs: 0, bounty: 0, win: 0, total: 0 }, winBonusWithheld: true,
      });
      for (const i of [1, 2]) expect(results[idOf(i)], `p${i}`).toMatchObject({ outcome: "died", killedBy: SUDDEN_DEATH_KILLER, winBonusWithheld: false });
      expect(w.state.winner).toBe("alice");
    });

    it("a blow absorbed by teleport immunity does not count; the same blow once it ends does", () => {
      const w = startRun(3, { suddenDeathSeconds: 60 });
      runTo(w, 2050); // teleported: immune until 2050 + TELEPORT_IMMUNITY_MS
      expect(w.state.inColiseum).toBe(true);
      expect(strike(w, 0, 1, 10)).toBe(0);
      expect(kill(w, 2, attacker(w, 0))).toBe(0); // not even a lethal blow gets through
      expect(P(w, 1).hp).toBe(P(w, 1).maxHp);
      expect(P(w, 2).status).toBe("alive");
      expect(RT(w, 0).damaged.size).toBe(0);
      expect(RT(w, 1).lastHit).toBeNull();

      runTo(w, 2050 + TELEPORT_IMMUNITY_MS);
      expect(strike(w, 0, 1, 10)).toBe(10);
      expect(damagedBy(RT(w, 0))).toEqual([idOf(1)]);
    });

    it("blows with no damage in them do not count", () => {
      const w = startRun(3, LONG);
      for (const amount of [0, -5, NaN]) expect(strike(w, 0, 1, amount)).toBe(0);
      expect(RT(w, 0).damaged.size).toBe(0);
    });

    it("a blow at someone who is no longer standing does not count", () => {
      const w = startRun(4, LONG);
      kill(w, 1, attacker(w, 0)); // p1 is down, result out
      expect(strike(w, 2, 1)).toBe(0);
      expect(RT(w, 2).damaged.size).toBe(0);
      // A separate applyDamage on a victim the first call already downed finds nobody there. (The tick's damage ledger
      // never calls it that way: it hands a victim all of a tick's hits in one applyHits, where every attacker counts.)
      atTick(w, 200, (world) => { kill(world, 3, attacker(world, 0)); strike(world, 2, 3); });
      runTo(w, 200);
      expect(RT(w, 2).damaged.size).toBe(0);
      expect(damagedBy(RT(w, 0))).toEqual([idOf(1), idOf(3)]);
    });

    it("mob kills do not count as damaging a player", () => {
      const w = startRun(3, LONG);
      for (let i = 0; i < 12; i++) creditMobKill(w, P(w, 0), RT(w, 0), i < 3);
      expect(RT(w, 0).damaged.size).toBe(0);
      atTick(w, 200, (world) => { kill(world, 1, attacker(world, 0)); kill(world, 2); });
      const r = winnerOf(runTo(w, 200));
      expect(r).toMatchObject({ outcome: "won", winBonusWithheld: true });
      expect(r.gv).toEqual({ kills: GV_KILL, mobs: GV_MOB_CAP, bounty: 0, win: 0, total: GV_KILL + GV_MOB_CAP });
    });
  });

  describe("winners decided by the tie-break", () => {
    /** 3 players at the edge of the first burning tick: `winner` has the highest fraction and has hurt `hurt`. */
    function burnEdge(winner: number, hurt: number[]) {
      const w = startRun(3, { suddenDeathSeconds: 2 }, { hp: 100 });
      runTo(w, 4050);
      for (const v of hurt) strike(w, winner, v, 0.001);
      [0, 1, 2].forEach((i) => { P(w, i).hp = i === winner ? 0.09 : 0.02 + i * 0.01; });
      return { w, events: tick(w) };
    }

    it.each([0, 1, 2])("p%i, the higher fraction, is paid when they hurt both others", (winner) => {
      const { w, events } = burnEdge(winner, [0, 1, 2].filter((i) => i !== winner));
      expect(w.state.serverTime).toBe(4100);
      expect(winnerOf(events, winner)).toMatchObject({ outcome: "won", gv: { win: GV_WIN }, winBonusWithheld: false });
      expect(w.state.winner).toBe(NAMES[winner]);
    });

    it.each([0, 1, 2])("p%i, the higher fraction, is withheld when they hurt only one", (winner) => {
      const other = (winner + 1) % 3;
      const { w, events } = burnEdge(winner, [other]);
      expect(winnerOf(events, winner)).toMatchObject({
        outcome: "won", place: 1, gv: { win: 0, total: 0 }, winBonusWithheld: true,
      });
      expect(w.state.winner).toBe(NAMES[winner]); // still the winner
    });

    it("two players killing each other in a run of three: the higher fraction wins and the rule applies to them", () => {
      // p0 killed p2 earlier and now trades with p1, who has only ever hurt p0: p0 has hurt two players, p1 one.
      const cases = [
        { hp0: 80, hp1: 20, winner: 0, winnerKills: 2, paid: true },
        { hp0: 20, hp1: 80, winner: 1, winnerKills: 1, paid: false },
      ];
      for (const { hp0, hp1, winner, winnerKills, paid } of cases) {
        const w = startRun(3, LONG, { hp: 100 });
        atTick(w, 300, (world) => kill(world, 2, attacker(world, 0)));
        runTo(w, 300);
        P(w, 0).hp = hp0;
        P(w, 1).hp = hp1;
        atTick(w, 500, (world) => {
          kill(world, 1, attacker(world, 0));
          kill(world, 0, attacker(world, 1)); // p1 is down but its blow in this tick still lands
        });
        const results = resultsOf(runTo(w, 500));
        expect(results[idOf(winner)], `winner p${winner}`).toMatchObject({
          outcome: "won", place: 1, kills: winnerKills, winBonusWithheld: !paid,
          gv: { kills: winnerKills * GV_KILL, win: paid ? GV_WIN : 0, total: winnerKills * GV_KILL + (paid ? GV_WIN : 0) },
        });
        expect(results[idOf(1 - winner)]).toMatchObject({ outcome: "died", place: 2, winBonusWithheld: false, gv: { win: 0 } });
        expect(w.state.winner).toBe(NAMES[winner]);
      }
    });

    it("a 2-player tie-break winner is withheld", () => {
      const w = startRun(2, { suddenDeathSeconds: 2 }, { hp: 100 });
      runTo(w, 4050);
      strike(w, 1, 0, 0.001);
      P(w, 0).hp = 0.04;
      P(w, 1).hp = 0.08;
      expect(winnerOf(tick(w), 1)).toMatchObject({ outcome: "won", winBonusWithheld: true, gv: { win: 0 } });
    });
  });

  describe("draws are never withheld", () => {
    it("a draw between players who both earned the bonus pays nobody and withholds nothing", () => {
      const w = startRun(3, { suddenDeathSeconds: 2 }, { hp: 100 });
      runTo(w, 4050);
      for (const [from, to] of [[0, 1], [0, 2], [1, 0], [1, 2]] as const) strike(w, from, to, 0.001);
      P(w, 0).hp = 0.05;
      P(w, 1).hp = 0.05;
      P(w, 2).hp = 0.01;
      const results = resultsOf(tick(w));
      for (const i of [0, 1]) expect(results[idOf(i)], `p${i}`).toMatchObject({ outcome: "draw", place: 1, gv: { win: 0 }, winBonusWithheld: false });
      expect(results[idOf(2)]).toMatchObject({ outcome: "died", place: 3, winBonusWithheld: false });
      expect(w.state.winner).toBe("");
    });

    it("a draw in a 2-player run, or between players who hurt nobody, is a draw and not a withheld win", () => {
      const two = startRun(2, { suddenDeathSeconds: 2 }, { hp: 100 });
      runTo(two, 4050);
      for (const p of two.state.players.values()) p.hp = 0.05;
      for (const r of Object.values(resultsOf(tick(two)))) expect(r).toMatchObject({ outcome: "draw", winBonusWithheld: false });

      const three = startRun(3, { suddenDeathSeconds: 2 }, { hp: 100 });
      runTo(three, 4050);
      for (const p of three.state.players.values()) p.hp = 0.05;
      for (const r of Object.values(resultsOf(tick(three)))) expect(r).toMatchObject({ outcome: "draw", winBonusWithheld: false });
    });

    it("mutual kills with equal hp in a run of two: a draw, not withheld", () => {
      const w = startRun(2, LONG);
      atTick(w, 500, (world) => { kill(world, 1, attacker(world, 0)); kill(world, 0, attacker(world, 1)); });
      for (const r of Object.values(resultsOf(runTo(w, 500)))) {
        expect(r).toMatchObject({ outcome: "draw", gv: { win: 0 }, winBonusWithheld: false });
      }
    });
  });

  describe("a withheld win is still a win", () => {
    it("keeps the outcome, place, winner, phase, victory fx and the order of the end of the run", () => {
      const w = startRun(2, LONG);
      atTick(w, 500, (world) => kill(world, 1, attacker(world, 0)));
      const events = runTo(w, 500);
      expect(winnerOf(events)).toMatchObject({
        outcome: "won", profile: "alice", kills: 1, killedBy: null, place: 1, players: 2, winBonusWithheld: true,
      });
      expect(P(w, 0).status).toBe("alive");
      expect(w.state).toMatchObject({ phase: "ended", winner: "alice", patienceEndsAt: 0, gatesLocked: false, suddenDeathAt: 0 });
      expect(fxOf(events, "victory")).toEqual([{ kind: "victory", id: idOf(0), name: "alice", draw: false }]);
      expect(ofType(events, "raidEnded")).toHaveLength(1);
      const order = events
        .filter((e) => e.type === "resolved" || e.type === "raidEnded" || (e.type === "fx" && e.fx.kind === "victory"))
        .map((e) => (e.type === "resolved" ? e.id : e.type === "fx" ? "victory" : e.type));
      expect(order).toEqual(["p1", "p0", "victory", "raidEnded"]);
    });

    it("differs from a paid win only in the flag and the bonus: same events, same result otherwise", () => {
      const play = (hurtFirst: number[]) => {
        const w = startRun(3, LONG);
        for (const v of hurtFirst) strike(w, 0, v);
        atTick(w, 200, (world) => { kill(world, 1, attacker(world, 0)); kill(world, 2); });
        return { w, events: runTo(w, 200) };
      };
      const paid = play([2]);
      const withheld = play([]);
      const kinds = (events: SimEvent[]) => events.map((e) => (e.type === "fx" ? e.fx.kind : e.type));
      expect(kinds(withheld.events)).toEqual(kinds(paid.events));
      expect(winnerOf(paid.events)).toMatchObject({ winBonusWithheld: false, gv: { win: GV_WIN } });
      expect(winnerOf(withheld.events)).toMatchObject({ winBonusWithheld: true, gv: { win: 0 } });
      const bare = (r: RunResult): RunResult => ({ ...r, gv: { ...r.gv, win: 0, total: r.gv.kills }, winBonusWithheld: false });
      expect(bare(winnerOf(withheld.events))).toEqual(bare(winnerOf(paid.events)));
      expect(withheld.w.state.winner).toBe(paid.w.state.winner);
      expect(P(withheld.w, 0).kills).toBe(P(paid.w, 0).kills);
    });
  });

  describe("kill GV and bounties are unaffected, and the ledger balances", () => {
    it.each([[false], [true]])("a winner who earned the bonus: %s", (paid) => {
      const w = startRun(5, LONG);
      if (paid) strike(w, 4, 1); // p4 will have hurt p1 and, below, p0
      for (const v of [1, 2, 3]) kill(w, v, attacker(w, 0)); // p0: three kills, a bounty of 10
      for (let i = 0; i < 5; i++) awardGv(w, P(w, 4), RT(w, 4), "mob");
      expect(P(w, 0).bounty).toBe(10);
      kill(w, 0, attacker(w, 4)); // p4 claims it, and is the last one standing
      const events = tick(w);
      const results = resultsOf(events);

      expect(results[idOf(4)]).toMatchObject({
        outcome: "won", place: 1, kills: 1, winBonusWithheld: !paid,
        gv: { kills: GV_KILL, mobs: 5 * GV_MOB, bounty: 10, win: paid ? GV_WIN : 0, total: GV_KILL + 5 * GV_MOB + 10 + (paid ? GV_WIN : 0) },
      });
      expect(results[idOf(0)]).toMatchObject({ outcome: "died", kills: 3, winBonusWithheld: false, gv: { kills: 3 * GV_KILL, bounty: 0, win: 0 } });
      const all = Object.values(results);
      for (const r of all) expect(r.gv.total).toBe(r.gv.kills + r.gv.mobs + r.gv.bounty + r.gv.win);
      const announced = ofType(events, "gv").reduce((n, e) => n + e.amount, 0);
      const kills = all.reduce((n, r) => n + r.kills, 0);
      expect(kills).toBe(4);
      expect(announced).toBe(4 * GV_KILL + 5 * GV_MOB + 10);
      expect(all.reduce((n, r) => n + r.gv.total, 0)).toBe(GV_KILL * kills + 5 * GV_MOB + 10 + (paid ? GV_WIN : 0));
      expect(P(w, 4).gv).toBe(GV_KILL + 5 * GV_MOB + 10); // the synced gv never includes the win bonus
    });
  });

  describe("only a withheld winner is flagged", () => {
    it("losers, leavers and a winner who earned it are not", () => {
      const w = startRun(4, LONG);
      removePlayer(w, idOf(3)); // MIA, never hit: no kill credit for anyone
      atTick(w, 200, (world) => { kill(world, 2); kill(world, 1, attacker(world, 0)); });
      const results = resultsOf(runTo(w, 200));
      expect(results[idOf(0)]).toMatchObject({ outcome: "won", winBonusWithheld: true });
      expect(results[idOf(1)]).toMatchObject({ outcome: "died", winBonusWithheld: false });
      expect(results[idOf(2)]).toMatchObject({ outcome: "died", winBonusWithheld: false });
      expect(results[idOf(3)]).toMatchObject({ outcome: "mia", winBonusWithheld: false });
      expect(Object.values(results).filter((r) => r.winBonusWithheld).map((r) => r.outcome)).toEqual(["won"]);
    });

    it("a solo player has no winner, so nothing is withheld whether they die or leave", () => {
      const died = startRun(1, LONG);
      atTick(died, 200, (world) => kill(world, 0));
      expect(winnerOf(runTo(died, 200))).toMatchObject({ outcome: "died", players: 1, winBonusWithheld: false, gv: { win: 0 } });
      expect(died.state.winner).toBe("");

      const left = startRun(1, LONG);
      removePlayer(left, idOf(0));
      expect(winnerOf(tick(left))).toMatchObject({ outcome: "mia", winBonusWithheld: false, gv: { win: 0 } });
      expect(left.state.winner).toBe("");

      const stays = startRun(1, LONG);
      expect(ofType(runTo(stays, 10_000), "resolved")).toEqual([]); // alone, alive: the run just goes on
      expect(stays.state).toMatchObject({ phase: "active", winner: "" });
    });
  });
});

describe("feed and bounty", () => {
  const bountyFxOf = (events: SimEvent[]) => fxOf(events, "bounty");
  const kinds = (events: SimEvent[]) => events.map((e) => (e.type === "fx" ? e.fx.kind : e.type));

  /** `killer` takes down each of `victims`, in order, between ticks. */
  function slay(w: World, killer: number, victims: number[]): void {
    for (const v of victims) kill(w, v, attacker(w, killer));
  }

  /** What hooks.bountyClaimed saw, with the killer's bounty GV and the bounty gv events already out at that moment. */
  interface Claim {
    world: World; killer: PlayerRuntime; victim: PlayerRuntime; bounty: number; killerBountyGv: number; announced: number;
  }
  function recordClaims(w: World): Claim[] {
    const claims: Claim[] = [];
    w.hooks.bountyClaimed = (world, killer, victim, bounty) => {
      claims.push({
        world, killer, victim, bounty, killerBountyGv: killer.gv.bounty,
        announced: ofType(world.events, "gv").filter((e) => e.reason === "bounty").length,
      });
    };
    return claims;
  }

  describe("when it appears", () => {
    it("a player's 3rd kill puts a bounty of 10 on them, announced once with their id, name and amount", () => {
      const w = startRun(8);
      slay(w, 0, [1, 2]);
      expect(bountyFxOf(w.events)).toEqual([]);
      expect(P(w, 0).bounty).toBe(0);
      w.events = [];
      slay(w, 0, [3]);
      expect(bountyFxOf(w.events)).toEqual([{ kind: "bounty", id: idOf(0), name: "alice", bounty: 10 }]);
      expect(P(w, 0).bounty).toBe(10);
      // To everyone: a plain fx event, not addressed to anybody, after the kill's own GV.
      expect(ofType(w.events, "fx").find((e) => e.fx.kind === "bounty")).toEqual({
        type: "fx", fx: { kind: "bounty", id: idOf(0), name: "alice", bounty: 10 },
      });
      expect(kinds(w.events)).toEqual(["death", "gv", "bounty", "resolved"]);
      for (let i = 1; i < 8; i++) expect(P(w, i).bounty, `p${i}`).toBe(0);
    });

    // Phase 11: announcements are throttled to one per player per BOUNTY_ANNOUNCE_MS; a rise held back goes out, with the
    // value then, when the window ends (the flush system, so this needs a game world).
    it("announces the first rise at once, holds the rises inside the 10 s window and announces the value then: 10, then 80", () => {
      const w = startRun(8, { patienceSeconds: 3600 }, { game: true });
      const bounties: number[] = [];
      const announced: number[] = [];
      for (const victim of [1, 2, 3, 4, 5, 6]) {
        w.events = [];
        slay(w, 0, [victim]);
        bounties.push(P(w, 0).bounty);
        announced.push(...bountyFxOf(w.events).map((fx) => fx.bounty));
        for (const fx of bountyFxOf(w.events)) expect(fx).toMatchObject({ id: idOf(0), name: "alice" });
      }
      expect(bounties).toEqual([0, 0, 10, 28, 52, 80]);
      expect(announced).toEqual([10]); // 28, 52 and 80 came inside the window that the 10 opened at TICK_MS
      w.events = [];
      const windowEnd = TICK_MS + BOUNTY_ANNOUNCE_MS;
      expect(bountyFxOf(runTo(w, windowEnd - TICK_MS))).toEqual([]);
      expect(bountyFxOf(tick(w))).toEqual([{ kind: "bounty", id: idOf(0), name: "alice", bounty: 80 }]); // the value now, not 28 or 52
      expect(w.state.serverTime).toBe(windowEnd);
      expect(bountyFxOf(runTo(w, windowEnd + 5000))).toEqual([]); // and only once
    });

    it("announces nothing when the bounty does not rise", () => {
      const w = startRun(8);
      slay(w, 0, [1, 2]);
      applyDamage(w, P(w, 3), RT(w, 3), 10, attacker(w, 0)); // a hit that doesn't kill
      kill(w, 4, "test"); // killed by something else
      kill(w, 5, SUDDEN_DEATH_KILLER);
      expect(bountyFxOf(w.events)).toEqual([]);
      slay(w, 0, [3]); // the 3rd kill
      expect(bountyFxOf(w.events)).toHaveLength(1);
      w.events = [];
      awardGv(w, P(w, 0), RT(w, 0), "mob"); // GV alone is not feed
      awardGv(w, P(w, 0), RT(w, 0), "elite");
      expect(bountyFxOf(w.events)).toEqual([]);
      expect(P(w, 0).bounty).toBe(10);
      expect(P(w, 0).kills).toBe(3);
    });

    it("someone else's kill doesn't announce a bounty for a player who didn't rise", () => {
      const w = startRun(8);
      slay(w, 0, [1, 2, 3]);
      w.events = [];
      slay(w, 4, [5]);
      expect(bountyFxOf(w.events)).toEqual([]);
      expect(P(w, 0).bounty).toBe(10);
      expect(P(w, 4).bounty).toBe(0);
    });

    it("a bounty stays on a player after they die", () => {
      const w = startRun(8);
      slay(w, 0, [1, 2, 3]);
      kill(w, 0, "test");
      expect(P(w, 0).status).toBe("dead");
      expect(P(w, 0).bounty).toBe(10);
    });

    describe("a killer who goes down in the pass of their kill", () => {
      /** p0 has two kills and makes a 3rd, p3's, in the pass; in that same pass p7 kills p0 when `diesToo`. */
      function thirdKill(diesToo: boolean): { w: World; events: SimEvent[] } {
        const w = startRun(8);
        slay(w, 0, [1, 2]);
        w.events = [];
        const lethal = (world: World, by: number, victim: number): void => {
          recordHit(world, {
            victim: idOf(victim), by: { id: idOf(by), name: NAMES[by]! }, packet: { raw: 1e6, phys: 1, magic: 0, true: 0 }, weapon: "sword",
            stagger: false,
          });
        };
        w.beforeDamage.push((world) => {
          lethal(world, 0, 3);
          if (diesToo) lethal(world, 7, 0);
        });
        return { w, events: tick(w) };
      }

      it("control: a killer who stands afterwards is on a rampage", () => {
        const { w, events } = thirdKill(false);
        expect(P(w, 0).status).toBe("alive");
        expect(P(w, 0).bounty).toBe(10);
        expect(bountyFxOf(events)).toEqual([{ kind: "bounty", id: idOf(0), name: "alice", bounty: 10 }]);
      });

      it("keeps the kill and its GV but raises no bounty and announces nothing", () => {
        const { w, events } = thirdKill(true);
        expect(P(w, 0).status).toBe("dead");
        expect(P(w, 3).status).toBe("dead");
        expect(P(w, 0).kills).toBe(3);
        expect(P(w, 0).bounty).toBe(0);
        expect(bountyFxOf(events)).toEqual([]);
        expect(resultsOf(events)[idOf(0)]).toMatchObject({ outcome: "died", kills: 3, killedBy: "hank", gv: { kills: 3 * GV_KILL, bounty: 0 } });
      });
    });
  });

  describe("when it is claimed", () => {
    it.each([[3, 10], [4, 28], [5, 52], [6, 80]] as const)(
      "killing a player with %i kills pays the killer exactly their bounty (%i) on top of the kill GV", (kills, bounty) => {
        const w = startRun(8);
        slay(w, 0, [1, 2, 3, 4, 5, 6].slice(0, kills));
        expect(P(w, 0).bounty).toBe(bounty);
        w.events = [];
        kill(w, 0, attacker(w, 7));
        expect(ofType(w.events, "gv")).toEqual([
          { type: "gv", id: idOf(7), amount: GV_KILL, reason: "kill" },
          { type: "gv", id: idOf(7), amount: bounty, reason: "bounty" },
        ]);
        expect(RT(w, 7).gv).toEqual({ kills: GV_KILL, mobs: 0, bounty });
        expect(P(w, 7).gv).toBe(GV_KILL + bounty);
        expect(P(w, 7).kills).toBe(1);
        // The victim keeps what they earned: their own result carries their kills and no bounty GV.
        expect(resultsOf(w.events)[idOf(0)]!.gv).toEqual({ kills: kills * GV_KILL, mobs: 0, bounty: 0, win: 0, total: kills * GV_KILL });
        expect(RT(w, 0).gv.bounty).toBe(0);
      },
    );

    it("pays the kill first, then the bounty, and the killer's own bounty last when the claim is their 3rd kill", () => {
      const w = startRun(8);
      slay(w, 0, [1, 2, 3]);
      slay(w, 4, [5, 6]);
      w.events = [];
      kill(w, 0, attacker(w, 4));
      expect(kinds(w.events)).toEqual(["death", "gv", "gv", "bounty", "resolved"]);
      expect(ofType(w.events, "gv").map((e) => e.reason)).toEqual(["kill", "bounty"]);
      expect(bountyFxOf(w.events)).toEqual([{ kind: "bounty", id: idOf(4), name: "erin", bounty: 10 }]);
      expect(P(w, 4).bounty).toBe(10);
      expect(P(w, 4).gv).toBe(3 * GV_KILL + 10);
      expect(RT(w, 4).gv).toEqual({ kills: 3 * GV_KILL, mobs: 0, bounty: 10 });
    });

    it("the killer's result carries the bounty, and the ledger adds up", () => {
      const w = startRun(5);
      strike(w, 4, 1); // p4 hurts p1 before p0 finishes them, and p0 after: two different opponents
      atTick(w, 100, (world) => slay(world, 0, [1]));
      atTick(w, 150, (world) => slay(world, 0, [2]));
      atTick(w, 200, (world) => slay(world, 0, [3]));
      atTick(w, 250, (world) => slay(world, 4, [0]));
      const events = runTo(w, 250);
      const results = resultsOf(events);
      expect(w.state.winner).toBe("erin");
      expect(results[idOf(4)]).toMatchObject({
        outcome: "won", kills: 1, gv: { kills: GV_KILL, mobs: 0, bounty: 10, win: GV_WIN, total: GV_KILL + 10 + GV_WIN },
        winBonusWithheld: false,
      });
      expect(results[idOf(0)]).toMatchObject({
        outcome: "died", kills: 3, killedBy: "erin", gv: { kills: 3 * GV_KILL, mobs: 0, bounty: 0, win: 0, total: 3 * GV_KILL },
      });
      expect(P(w, 4).gv).toBe(GV_KILL + 10); // the synced gv is what was earned, not the win bonus
      const sum = Object.values(results).reduce((n, r) => n + r.gv.total, 0);
      expect(sum).toBe(4 * GV_KILL + 10 + GV_WIN);
      for (const r of Object.values(results)) expect(r.gv.total).toBe(r.gv.kills + r.gv.mobs + r.gv.bounty + r.gv.win);
    });

    it.each([[0, 1], [1, 0]] as const)(
      "kills in one tick pay the victim's bounty from the start of the tick, whoever was killed first (p%i is killed first, then p%i)",
      (first, second) => {
        const w = startRun(3);
        // p0 has three kills (bounty 10) and p1 four (28): each kill below would raise its killer's own bounty (28 and 52).
        P(w, 0).kills = 3;
        P(w, 0).bounty = 10;
        P(w, 1).kills = 4;
        P(w, 1).bounty = 28;
        const claims = recordClaims(w);
        // p2 stands by, so the run goes on past the tick. In this tick p0 and p1 kill each other.
        atTick(w, 100, (world) => {
          kill(world, first, attacker(world, second));
          kill(world, second, attacker(world, first));
        });
        const events = runTo(w, 100);
        // Called one after the other (no pass to wait for), only the killer still standing when its kill was paid is on a rampage.
        expect(P(w, second).bounty).toBe(second === 0 ? 28 : 52);
        expect(P(w, first).bounty).toBe(first === 0 ? 10 : 28);
        expect(claims.map((c) => [c.killer.id, c.victim.id, c.bounty]).sort()).toEqual([[idOf(0), idOf(1), 28], [idOf(1), idOf(0), 10]]);
        expect([RT(w, 0).gv.bounty, RT(w, 1).gv.bounty]).toEqual([28, 10]);
        const results = resultsOf(events);
        expect([results[idOf(0)]!.gv.bounty, results[idOf(1)]!.gv.bounty]).toEqual([28, 10]);
        expect(results[idOf(2)]).toMatchObject({ outcome: "won" });
      },
    );

    it("a bounty raised by a kill between ticks is paid at once: only kills inside a tick are simultaneous", () => {
      const w = startRun(3);
      P(w, 0).kills = 3;
      P(w, 0).bounty = 10;
      kill(w, 1, attacker(w, 0)); // p0's 4th kill: its bounty is 28 from now on
      expect(P(w, 0).bounty).toBe(28);
      w.events = [];
      kill(w, 0, attacker(w, 2));
      expect(RT(w, 2).gv.bounty).toBe(28);
    });

    it("calls hooks.bountyClaimed once, after the bounty was paid, with the world, the killer, the victim and the amount", () => {
      const w = startRun(8);
      const claims = recordClaims(w);
      slay(w, 0, [1, 2, 3]);
      expect(claims).toEqual([]); // nobody has claimed anything yet
      kill(w, 0, attacker(w, 4));
      expect(claims).toHaveLength(1);
      const [claim] = claims;
      expect(claim!.world).toBe(w);
      expect(claim!.killer).toBe(RT(w, 4));
      expect(claim!.victim).toBe(RT(w, 0));
      expect(claim!.bounty).toBe(10);
      expect(claim!.killerBountyGv).toBe(10); // already paid when the hook runs
      expect(claim!.announced).toBe(1); // and already announced
    });

    it("passes the bounty on: each claim is paid its own victim's bounty", () => {
      const w = startRun(8);
      const claims = recordClaims(w);
      slay(w, 0, [1, 2, 3]); // p0: bounty 10
      slay(w, 4, [5, 6]);
      kill(w, 0, attacker(w, 4)); // p4's 3rd kill: p4 now carries 10 and collects p0's
      slay(w, 7, [4]); // p7 collects p4's
      expect(claims.map((c) => [c.killer.id, c.victim.id, c.bounty])).toEqual([[idOf(4), idOf(0), 10], [idOf(7), idOf(4), 10]]);
      expect(RT(w, 4).gv.bounty).toBe(10);
      expect(RT(w, 7).gv).toEqual({ kills: GV_KILL, mobs: 0, bounty: 10 });
      expect(P(w, 7).bounty).toBe(0);
    });

    it("does not call the hook, or pay a bounty, for a victim without one", () => {
      const w = startRun(8);
      const claims = recordClaims(w);
      slay(w, 0, [1, 2]); // 2 kills: nothing yet
      kill(w, 0, attacker(w, 3));
      expect(claims).toEqual([]);
      expect(ofType(w.events, "gv").filter((e) => e.reason === "bounty")).toEqual([]);
      expect(RT(w, 3).gv).toEqual({ kills: GV_KILL, mobs: 0, bounty: 0 });
    });

    it("works without a hook installed", () => {
      const w = startRun(8);
      expect(w.hooks.bountyClaimed).toBeUndefined();
      slay(w, 0, [1, 2, 3]);
      expect(() => kill(w, 0, attacker(w, 4))).not.toThrow();
      expect(RT(w, 4).gv.bounty).toBe(10);
    });

    it("a player who goes down in the same tick still collects the bounty they killed for, and banks it", () => {
      const w = startRun(6);
      strike(w, 5, 1); // p5 hurts p1 first, so the p4 it kills later makes two opponents and the win bonus is theirs
      atTick(w, 100, (world) => slay(world, 0, [1, 2, 3]));
      atTick(w, 300, (world) => {
        slay(world, 4, [0]); // p4 claims p0's bounty...
        slay(world, 5, [4]); // ...and is killed in the same tick (p4 has one kill: no bounty on them)
      });
      const results = resultsOf(runTo(w, 300));
      expect(results[idOf(4)]).toMatchObject({
        outcome: "died", kills: 1, killedBy: "frank", gv: { kills: GV_KILL, bounty: 10, win: 0, total: GV_KILL + 10 },
      });
      expect(results[idOf(5)]).toMatchObject({
        outcome: "won", kills: 1, gv: { kills: GV_KILL, bounty: 0, win: GV_WIN }, winBonusWithheld: false,
      });
      expect(w.state.winner).toBe("frank");
    });
  });

  describe("when nobody is paid", () => {
    it("a bountied player killed by something other than a player pays nobody", () => {
      const w = startRun(8);
      const claims = recordClaims(w);
      slay(w, 0, [1, 2, 3]);
      w.events = [];
      kill(w, 0, "test");
      expect(ofType(w.events, "gv")).toEqual([]);
      expect(claims).toEqual([]);
      for (let i = 1; i < 8; i++) expect(RT(w, i).gv.bounty, `p${i}`).toBe(0);
    });

    it("a bountied player who dies to sudden death pays nobody", () => {
      const w = startRun(5, { patienceSeconds: 1, suddenDeathSeconds: 1 });
      const claims = recordClaims(w);
      atTick(w, 100, (world) => {
        slay(world, 0, [1, 2, 3]); // p0: bounty 10, alone with p4
        P(world, 0).hp = 0.05; // the first burn kills p0 and leaves p4 on 1 000
        P(world, 4).hp = 1000;
        P(world, 4).maxHp = 1000;
      });
      const events = runTo(w, 100);
      expect(P(w, 0).bounty).toBe(10);
      const rest: SimEvent[] = [];
      for (let i = 0; i < 400 && w.state.phase === "active"; i++) rest.push(...tick(w));
      expect(w.state.phase).toBe("ended");
      const results = resultsOf([...events, ...rest]);
      expect(results[idOf(0)]).toMatchObject({ outcome: "died", killedBy: SUDDEN_DEATH_KILLER, kills: 3 });
      // p4 never hurt anyone (sudden death killed p0): the win stands, the bonus does not.
      expect(results[idOf(4)]).toMatchObject({
        outcome: "won", gv: { kills: 0, mobs: 0, bounty: 0, win: 0, total: 0 }, winBonusWithheld: true,
      });
      expect(ofType(rest, "gv")).toEqual([]);
      expect(claims).toEqual([]);
      expect(RT(w, 4).gv.bounty).toBe(0);
    });

    it("a bountied player who leaves pays nobody", () => {
      const w = startRun(5);
      const claims = recordClaims(w);
      slay(w, 0, [1, 2, 3]);
      w.events = [];
      removePlayer(w, idOf(0));
      const events = tick(w); // the events of a leave between ticks come out with the next step's
      expect(resultsOf(events)[idOf(0)]).toMatchObject({ outcome: "mia", kills: 3, gv: { kills: 3 * GV_KILL, bounty: 0 } });
      expect(ofType(events, "gv")).toEqual([]);
      expect(claims).toEqual([]);
      // p4 won without hurting anyone: no bonus.
      expect(resultsOf(events)[idOf(4)]).toMatchObject({ outcome: "won", gv: { bounty: 0, win: 0, total: 0 }, winBonusWithheld: true });
    });

    it("a killer whose result is already out gets no kill credit at all: no kill, no GV, no bounty, no hook call", () => {
      const w = startRun(8);
      const claims = recordClaims(w);
      slay(w, 0, [1, 2, 3]);
      downPlayer(w, P(w, 4), RT(w, 4), "died"); // between steps: p4's result is out
      expect(RT(w, 4).resolved).toBe(true);
      w.events = [];
      kill(w, 0, attacker(w, 4)); // a bountied victim...
      kill(w, 5, attacker(w, 4)); // ...and an ordinary one
      // The victims still die...
      expect([P(w, 0).status, P(w, 5).status]).toEqual(["dead", "dead"]);
      expect(fxOf(w.events, "death").map((fx) => [fx.id, fx.by])).toEqual([[idOf(0), idOf(4)], [idOf(5), idOf(4)]]);
      expect(resultsOf(w.events)[idOf(0)]).toMatchObject({ outcome: "died" });
      // ...but nothing is credited to the one who is already out.
      expect(P(w, 4).kills).toBe(0);
      expect(P(w, 4).bounty).toBe(0);
      expect(P(w, 4).gv).toBe(0);
      expect(RT(w, 4).gv).toEqual({ kills: 0, mobs: 0, bounty: 0 });
      expect(ofType(w.events, "gv")).toEqual([]);
      expect(bountyFxOf(w.events)).toEqual([]);
      expect(claims).toEqual([]);
    });
  });

  describe("mob kills", () => {
    it("creditMobKill counts toward the feed, pays mob GV (elite GV for elites) and leaves the player kills alone", () => {
      const w = startRun(2);
      expect(creditMobKill(w, P(w, 0), RT(w, 0), false)).toBe(GV_MOB);
      expect(creditMobKill(w, P(w, 0), RT(w, 0), true)).toBe(GV_ELITE);
      expect(RT(w, 0).mobKills).toBe(2);
      expect(P(w, 0).kills).toBe(0);
      expect(RT(w, 0).gv).toEqual({ kills: 0, mobs: GV_MOB + GV_ELITE, bounty: 0 });
      expect(P(w, 0).gv).toBe(GV_MOB + GV_ELITE);
      expect(ofType(w.events, "gv")).toEqual([
        { type: "gv", id: idOf(0), amount: GV_MOB, reason: "mob" },
        { type: "gv", id: idOf(0), amount: GV_ELITE, reason: "elite" },
      ]);
      expect(bountyFxOf(w.events)).toEqual([]); // a feed of 0.5
    });

    // Owner decision: the bounty follows PLAYER kills only (bountyFor(p.kills)); mob kills feed the reward curve, never the bounty.
    it("12 mob kills are a feed of 3 but no bounty, and three elites reached GV_MOB_CAP and the rest paid nothing", () => {
      const w = startRun(3);
      const paid: number[] = [];
      for (let i = 0; i < 3; i++) paid.push(creditMobKill(w, P(w, 0), RT(w, 0), true));
      for (let i = 0; i < 9; i++) paid.push(creditMobKill(w, P(w, 0), RT(w, 0), false));
      // Elite GV is round(GV_ELITE x reward): 9.8, 9.7 and 9.7 at feeds 0, 0.25 and 0.5 all round to GV_ELITE.
      expect(paid).toEqual([GV_ELITE, GV_ELITE, GV_ELITE, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(RT(w, 0).mobKills).toBe(12);
      expect(P(w, 0).mobKills).toBe(12);
      expect(feedScore(P(w, 0).kills, RT(w, 0).mobKills)).toBe(3); // the feed counts them...
      expect(RT(w, 0).gv.mobs).toBe(GV_MOB_CAP); // GV stays capped...
      expect(P(w, 0).gv).toBe(GV_MOB_CAP);
      expect(P(w, 0).bounty).toBe(0); // ...and the bounty never sees them
      expect(bountyFxOf(w.events)).toEqual([]);
      expect(ofType(w.events, "gv")).toHaveLength(3); // a capped kill makes no gv event
    });

    it("mob and player kills share one feed, but only player kills make a bounty: two kills and four mob kills are a feed of 3 and a bounty of 0", () => {
      const w = startRun(8);
      slay(w, 0, [1, 2]);
      w.events = [];
      for (let i = 0; i < 4; i++) {
        creditMobKill(w, P(w, 0), RT(w, 0), false);
        expect(P(w, 0).bounty).toBe(0);
      }
      expect(feedScore(P(w, 0).kills, RT(w, 0).mobKills)).toBe(3);
      expect(bountyFxOf(w.events)).toEqual([]);
      slay(w, 0, [3]); // the 3rd player kill: 10, as for anyone (a feed of 4 would have made it 28)
      expect(P(w, 0).bounty).toBe(10);
      expect(bountyFxOf(w.events).map((fx) => fx.bounty)).toEqual([10]);
      for (let i = 0; i < 8; i++) creditMobKill(w, P(w, 0), RT(w, 0), i < 2); // feed 7: still 10
      expect(P(w, 0).bounty).toBe(10);
      slay(w, 0, [4]); // the 4th
      expect(P(w, 0).bounty).toBe(28);
    });

    it("mob kills alone put no bounty on a player: killing them pays the kill and no bounty, and the claim hook is not called", () => {
      const w = startRun(8);
      const claims = recordClaims(w);
      for (let i = 0; i < 12; i++) creditMobKill(w, P(w, 0), RT(w, 0), i < 3);
      w.events = [];
      kill(w, 0, attacker(w, 1));
      expect(ofType(w.events, "gv")).toEqual([{ type: "gv", id: idOf(1), amount: GV_KILL, reason: "kill" }]);
      expect(claims).toEqual([]);
      expect(RT(w, 1).gv).toEqual({ kills: GV_KILL, mobs: 0, bounty: 0 });
      expect(resultsOf(w.events)[idOf(0)]!.gv).toEqual({ kills: 0, mobs: GV_MOB_CAP, bounty: 0, win: 0, total: GV_MOB_CAP });
    });

    it("a bounty built from player kills is claimed like any other, whatever the mob kills", () => {
      const w = startRun(8);
      const claims = recordClaims(w);
      slay(w, 0, [2, 3, 4]); // 3 player kills: 10
      for (let i = 0; i < 12; i++) creditMobKill(w, P(w, 0), RT(w, 0), i < 3);
      expect(P(w, 0).bounty).toBe(10); // a feed of 6 does not change it
      w.events = [];
      kill(w, 0, attacker(w, 1));
      expect(ofType(w.events, "gv")).toEqual([
        { type: "gv", id: idOf(1), amount: GV_KILL, reason: "kill" },
        { type: "gv", id: idOf(1), amount: 10, reason: "bounty" },
      ]);
      expect(claims.map((c) => c.bounty)).toEqual([10]);
      expect(resultsOf(w.events)[idOf(0)]!.gv).toEqual({
        kills: 3 * GV_KILL, mobs: GV_MOB_CAP, bounty: 0, win: 0, total: 3 * GV_KILL + GV_MOB_CAP,
      });
    });

    it("counts nothing for a player whose result is out", () => {
      const w = startRun(3);
      downPlayer(w, P(w, 2), RT(w, 2), "died");
      w.events = [];
      expect(creditMobKill(w, P(w, 2), RT(w, 2), true)).toBe(0);
      expect(RT(w, 2).mobKills).toBe(0);
      expect(w.events).toEqual([]);
    });

    it("counts for a player downed this tick but not yet resolved, like any other GV", () => {
      const w = startRun(3);
      atTick(w, 200, (world) => {
        kill(world, 0, "test");
        expect(creditMobKill(world, P(world, 0), RT(world, 0), false)).toBe(GV_MOB);
      });
      const results = resultsOf(runTo(w, 200));
      expect(RT(w, 0).mobKills).toBe(1);
      expect(results[idOf(0)]!.gv).toEqual({ kills: 0, mobs: GV_MOB, bounty: 0, win: 0, total: GV_MOB });
    });
  });

  describe("unbanked GV", () => {
    it("unbankedGv includes the bounty GV, until the player's result is out", () => {
      const w = startRun(8);
      slay(w, 0, [1, 2, 3]);
      awardGv(w, P(w, 4), RT(w, 4), "mob");
      kill(w, 0, attacker(w, 4));
      expect(unbankedGv(RT(w, 4))).toBe(GV_MOB + GV_KILL + 10);
      expect(unbankedGv(RT(w, 0))).toBe(0); // resolved
      downPlayer(w, P(w, 4), RT(w, 4), "died");
      expect(unbankedGv(RT(w, 4))).toBe(0); // banked with the result, bounty included
    });

    it("abandonPlayer returns the bounty GV along with the rest", () => {
      const w = startRun(8);
      slay(w, 0, [1, 2, 3]);
      awardGv(w, P(w, 4), RT(w, 4), "elite");
      kill(w, 0, attacker(w, 4));
      const events = w.events.length;
      expect(abandonPlayer(w, idOf(4))).toBe(GV_ELITE + GV_KILL + 10);
      expect(w.events).toHaveLength(events);
      expect(abandonPlayer(w, idOf(4))).toBe(0);
    });

    it("a result that carries a bounty banks it once: the sum of the totals is the sum of what was announced", () => {
      const w = startRun(8);
      atTick(w, 100, (world) => slay(world, 0, [1, 2, 3]));
      atTick(w, 200, (world) => { slay(world, 4, [0]); });
      const events = runTo(w, 200);
      const announced = ofType(events, "gv").reduce((n, e) => n + e.amount, 0);
      expect(announced).toBe(4 * GV_KILL + 10);
      expect(w.state.phase).toBe("active"); // 5 left
      // Everyone left in the run is resolved by the rest of the melee.
      atTick(w, 300, (world) => { for (const i of [2, 3]) if (P(world, i).status === "alive") kill(world, i, attacker(world, 4)); });
      atTick(w, 400, (world) => { for (const i of [5, 6, 7]) kill(world, i, attacker(world, 4)); });
      const rest = runTo(w, 400);
      const results = resultsOf([...events, ...rest]);
      expect(w.state.winner).toBe("erin");
      const banked = Object.values(results).reduce((n, r) => n + r.gv.total, 0);
      const all = ofType([...events, ...rest], "gv").reduce((n, e) => n + e.amount, 0);
      expect(banked).toBe(all + GV_WIN);
    });
  });

  describe("kill credit when a player leaves", () => {
    const LONG = { patienceSeconds: 3600 } as const; // nothing happens in the arena by itself
    const WINDOW_MS = KILL_CREDIT_SECONDS * 1000;
    const hit = (w: World, from: number, to: number, amount = 10) =>
      applyDamage(w, P(w, to), RT(w, to), amount, attacker(w, from));

    it("the window is 5 seconds", () => {
      expect(KILL_CREDIT_SECONDS).toBe(5);
    });

    it("applyDamage remembers the last player to hurt someone, and when", () => {
      const w = startRun(3, LONG);
      expect(RT(w, 1).lastHit).toBeNull();
      hit(w, 0, 1);
      expect(RT(w, 1).lastHit).toEqual({ by: idOf(0), at: TICK_MS });
      runTo(w, 500);
      hit(w, 2, 1);
      expect(RT(w, 1).lastHit).toEqual({ by: idOf(2), at: 500 });
      expect(RT(w, 0).lastHit).toBeNull(); // nobody hit p0
    });

    it("only a player's blow counts, and only one that lands", () => {
      const w = startRun(3, LONG);
      applyDamage(w, P(w, 1), RT(w, 1), 5, "test");
      applyDamage(w, P(w, 1), RT(w, 1), 5, SUDDEN_DEATH_KILLER);
      expect(RT(w, 1).lastHit).toBeNull();
      P(w, 1).immuneUntil = 10_000;
      expect(hit(w, 0, 1)).toBe(0); // immune: ignored
      expect(RT(w, 1).lastHit).toBeNull();
      P(w, 1).immuneUntil = 0;
      hit(w, 0, 1, 0); // no damage at all
      expect(RT(w, 1).lastHit).toBeNull();
    });

    it("a killing blow is recorded as the last hit too", () => {
      const w = startRun(3, LONG);
      hit(w, 0, 1);
      hit(w, 2, 1, 1000); // kills
      expect(RT(w, 1).killedBy).toBe("carol");
      expect(RT(w, 1).lastHit).toEqual({ by: idOf(2), at: TICK_MS });
    });

    it("credits the last hitter exactly like a kill when the victim leaves within the window", () => {
      const w = startRun(4, LONG);
      hit(w, 0, 1);
      runTo(w, 2050);
      w.events = [];
      removePlayer(w, idOf(1));
      expect(kinds(w.events)).toEqual(["gv", "resolved"]); // no death fx
      expect(ofType(w.events, "gv")).toEqual([{ type: "gv", id: idOf(0), amount: GV_KILL, reason: "kill" }]);
      expect(P(w, 0).kills).toBe(1);
      expect(P(w, 0).gv).toBe(GV_KILL);
      expect(RT(w, 0).gv).toEqual({ kills: GV_KILL, mobs: 0, bounty: 0 });
      // The leaver's result is the same as any leaver's.
      expect(resultsOf(w.events)[idOf(1)]).toEqual({
        outcome: "mia", profile: "bob", durationSec: 2, kills: 0, killedBy: null, place: 4, players: 4,
        gv: { kills: 0, mobs: 0, bounty: 0, win: 0, total: 0 }, winBonusWithheld: false,
      });
      expect(fxOf(w.events, "death")).toEqual([]);
    });

    it.each([
      [0, true], [1000, true], [WINDOW_MS, true], [WINDOW_MS + TICK_MS, false], [WINDOW_MS + 1000, false], [60_000, false],
    ] as const)("a leave %i ms after the hit is credited: %s", (afterMs, credited) => {
      const w = startRun(4, LONG);
      hit(w, 0, 1); // at TICK_MS
      runTo(w, TICK_MS + afterMs);
      w.events = [];
      removePlayer(w, idOf(1));
      expect(P(w, 0).kills).toBe(credited ? 1 : 0);
      expect(ofType(w.events, "gv")).toHaveLength(credited ? 1 : 0);
      expect(RT(w, 0).gv.kills).toBe(credited ? GV_KILL : 0);
      expect(resultsOf(w.events)[idOf(1)]).toMatchObject({ outcome: "mia", killedBy: null });
    });

    it("the window runs from the last hit: a later blow keeps the credit, and goes to whoever struck it", () => {
      const w = startRun(4, LONG);
      hit(w, 0, 1); // at 50
      runTo(w, 4000);
      hit(w, 2, 1); // p2 takes over
      runTo(w, 4000 + WINDOW_MS);
      removePlayer(w, idOf(1));
      expect(P(w, 2).kills).toBe(1);
      expect(P(w, 0).kills).toBe(0);
      expect(ofType(w.events, "gv")).toEqual([{ type: "gv", id: idOf(2), amount: GV_KILL, reason: "kill" }]);
    });

    it("an old hit by the same player is refreshed by a new one", () => {
      const w = startRun(4, LONG);
      hit(w, 0, 1);
      runTo(w, 4000);
      hit(w, 0, 1);
      runTo(w, 8000); // 7 950 ms after the first hit, 4 000 after the second
      removePlayer(w, idOf(1));
      expect(P(w, 0).kills).toBe(1);
    });

    it("pays the victim's bounty, calls hooks.bountyClaimed and updates the attacker's own bounty", () => {
      const w = startRun(8, LONG);
      const claims = recordClaims(w);
      slay(w, 0, [1, 2, 3]); // p0: bounty 10
      slay(w, 4, [5, 6]); // p4: 2 kills
      hit(w, 4, 0);
      w.events = [];
      removePlayer(w, idOf(0));
      expect(kinds(w.events)).toEqual(["gv", "gv", "bounty", "resolved"]);
      expect(ofType(w.events, "gv")).toEqual([
        { type: "gv", id: idOf(4), amount: GV_KILL, reason: "kill" },
        { type: "gv", id: idOf(4), amount: 10, reason: "bounty" },
      ]);
      expect(bountyFxOf(w.events)).toEqual([{ kind: "bounty", id: idOf(4), name: "erin", bounty: 10 }]); // the 3rd kill
      expect(P(w, 4).kills).toBe(3);
      expect(P(w, 4).bounty).toBe(10);
      expect(RT(w, 4).gv).toEqual({ kills: 3 * GV_KILL, mobs: 0, bounty: 10 });
      expect(claims).toHaveLength(1);
      expect(claims[0]).toMatchObject({ bounty: 10, killerBountyGv: 10, announced: 1 });
      expect(claims[0]!.killer).toBe(RT(w, 4));
      expect(claims[0]!.victim.id).toBe(idOf(0));
      // The leaver keeps what they earned and is still MIA with nobody to blame.
      expect(resultsOf(w.events)[idOf(0)]).toMatchObject({
        outcome: "mia", kills: 3, killedBy: null, gv: { kills: 3 * GV_KILL, bounty: 0, total: 3 * GV_KILL },
      });
      expect(fxOf(w.events, "death")).toEqual([]);
    });

    it("works the same when the leave is processed inside a step", () => {
      const w = startRun(4, LONG);
      hit(w, 0, 1);
      atTick(w, 500, (world) => downPlayer(world, P(world, 1), RT(world, 1), "mia"));
      const events = runTo(w, 500);
      expect(P(w, 0).kills).toBe(1);
      expect(ofType(events, "gv")).toEqual([{ type: "gv", id: idOf(0), amount: GV_KILL, reason: "kill" }]);
      expect(resultsOf(events)[idOf(1)]).toMatchObject({ outcome: "mia", killedBy: null });
      expect(fxOf(events, "death")).toEqual([]);
    });

    it("still restarts the patience timer once, like any leave", () => {
      const w = startRun(4, { patienceSeconds: 20, patienceMinSeconds: 5 });
      hit(w, 0, 1);
      removePlayer(w, idOf(1));
      tick(w);
      expect(w.state.patienceEndsAt).toBeCloseTo(100 + 5000, 6); // 3 left
    });

    it("gives nobody the kill when nobody hit the leaver", () => {
      const w = startRun(4, LONG);
      runTo(w, 1000);
      w.events = [];
      removePlayer(w, idOf(1));
      expect(ofType(w.events, "gv")).toEqual([]);
      for (let i = 0; i < 4; i++) if (i !== 1) expect(P(w, i).kills, `p${i}`).toBe(0);
    });

    it("gives nobody the kill when the only damage came from something that is not a player", () => {
      const w = startRun(4, LONG);
      applyDamage(w, P(w, 1), RT(w, 1), 30, "test");
      w.events = [];
      removePlayer(w, idOf(1));
      expect(ofType(w.events, "gv")).toEqual([]);
    });

    it("gives nobody the kill when the leaver was only being burnt by sudden death", () => {
      const w = startRun(3, { patienceSeconds: 1, suddenDeathSeconds: 1 });
      for (let i = 0; i < 3; i++) { P(w, i).hp = 1000; P(w, i).maxHp = 1000; }
      runTo(w, 3300); // teleported at 1050, immune until 2550, burning since 2600
      expect(P(w, 1).hp).toBeLessThan(1000);
      expect(w.state.gatesLocked).toBe(true);
      w.events = [];
      removePlayer(w, idOf(1));
      expect(ofType(w.events, "gv")).toEqual([]);
      for (const i of [0, 2]) expect(P(w, i).kills, `p${i}`).toBe(0);
    });

    it("gives nobody the kill when the attacker already left", () => {
      const w = startRun(4, LONG);
      hit(w, 0, 1);
      removePlayer(w, idOf(0));
      w.events = [];
      removePlayer(w, idOf(1));
      expect(ofType(w.events, "gv")).toEqual([]);
      expect(resultsOf(w.events)[idOf(1)]).toMatchObject({ outcome: "mia", killedBy: null });
    });

    it("gives nobody the kill when the attacker's result is already out", () => {
      const w = startRun(4, LONG);
      hit(w, 0, 1);
      kill(w, 0, "test"); // p0 dies; their result goes out between steps
      expect(RT(w, 0).resolved).toBe(true);
      w.events = [];
      removePlayer(w, idOf(1));
      expect(ofType(w.events, "gv")).toEqual([]);
      expect(P(w, 0).kills).toBe(0);
      expect(P(w, 0).gv).toBe(0);
    });

    it("pays no bounty to an attacker whose result is out either, and does not call the hook", () => {
      const w = startRun(8, LONG);
      const claims = recordClaims(w);
      slay(w, 0, [1, 2, 3]);
      hit(w, 4, 0);
      kill(w, 4, "test");
      w.events = [];
      removePlayer(w, idOf(0));
      expect(ofType(w.events, "gv")).toEqual([]);
      expect(claims).toEqual([]);
    });

    it("a server shutdown (abandonPlayer) credits nobody", () => {
      const w = startRun(4, LONG);
      hit(w, 0, 1);
      w.events = [];
      expect(abandonPlayer(w, idOf(1))).toBe(0);
      expect(w.events).toEqual([]);
      expect(P(w, 0).kills).toBe(0);
    });

    it("the ledger balances with a credited leave in it", () => {
      const w = startRun(3, LONG);
      hit(w, 0, 1);
      removePlayer(w, idOf(1)); // credited to p0
      atTick(w, 300, (world) => kill(world, 2, attacker(world, 0)));
      const results = resultsOf(runTo(w, 300));
      expect(w.state.winner).toBe("alice");
      expect(results[idOf(0)]).toMatchObject({ outcome: "won", kills: 2, gv: { kills: 2 * GV_KILL, win: GV_WIN, total: 2 * GV_KILL + GV_WIN } });
      expect(results[idOf(2)]).toMatchObject({ outcome: "died", killedBy: "alice", gv: { total: 0 } });
      expect(results[idOf(1)]).toMatchObject({ outcome: "mia", gv: { total: 0 } });
      expect(Object.values(results).reduce((n, r) => n + r.gv.total, 0)).toBe(2 * GV_KILL + GV_WIN);
    });

    it("a dropped connection left when it dropped: a hit just before the drop is credited when the grace runs out", () => {
      const w = startRun(4, LONG);
      hit(w, 0, 1); // at 50
      runTo(w, 150);
      markDropped(w, idOf(1));
      expect(RT(w, 1).droppedAt).toBe(150);
      runTo(w, 150 + 10_000); // a 10 s reconnect grace, far past the window measured from now
      removePlayer(w, idOf(1));
      expect(P(w, 0).kills).toBe(1);
      expect(RT(w, 0).gv.kills).toBe(GV_KILL);
    });

    it("a drop long after the last hit earns nothing, and a hit during the grace counts", () => {
      const w = startRun(4, LONG);
      hit(w, 0, 1); // at 50
      runTo(w, 50 + WINDOW_MS + 1000);
      markDropped(w, idOf(1));
      runTo(w, 9000);
      removePlayer(w, idOf(1));
      expect(P(w, 0).kills).toBe(0);

      const v = startRun(4, LONG);
      runTo(v, 100);
      markDropped(v, idOf(1));
      runTo(v, 7000);
      hit(v, 2, 1); // the body is still in the fight during the grace
      runTo(v, 10_100);
      removePlayer(v, idOf(1));
      expect(P(v, 2).kills).toBe(1);
    });

    it("a reconnect clears the drop time, so a later leave is measured from when it happens", () => {
      const w = startRun(4, LONG);
      hit(w, 0, 1);
      markDropped(w, idOf(1));
      markReconnected(w, idOf(1));
      expect(RT(w, 1).droppedAt).toBeNull();
      runTo(w, 50 + WINDOW_MS + 1000);
      removePlayer(w, idOf(1));
      expect(P(w, 0).kills).toBe(0);
    });

    it("markDropped keeps the first drop and does nothing outside an active run", () => {
      const w = startRun(3, LONG);
      runTo(w, 200);
      markDropped(w, idOf(1));
      runTo(w, 400);
      markDropped(w, idOf(1));
      expect(RT(w, 1).droppedAt).toBe(200);
      markDropped(w, "nobody");
      const lobby = createWorld({ seed: 3, config: makeConfig({ minPlayers: 2 }), random: mulberry32(3) });
      addPlayer(lobby, "x", "xavier");
      markDropped(lobby, "x");
      expect(lobby.players.get("x")!.droppedAt).toBeNull();
    });

    describe("a mob finishes a hunted player", () => {
      // The same rule as leaving: running into a camp can't dodge a bounty. A mob (or the arrow of a shooter who has gone)
      // is a string source; the death fx names no killer, and killedBy stays the mob.
      const finish = (w: World, victim: number, source: string): void => {
        applyDamage(w, P(w, victim), RT(w, victim), P(w, victim).hp + 1000, source);
      };

      it.each([
        [0, true], [1000, true], [WINDOW_MS, true], [WINDOW_MS + TICK_MS, false], [60_000, false],
      ] as const)("a finishing blow %i ms after the hit credits the hunter: %s", (afterMs, credited) => {
        const w = startRun(4, LONG);
        hit(w, 0, 1); // at TICK_MS
        runTo(w, TICK_MS + afterMs);
        w.events = [];
        finish(w, 1, "Warden");
        expect(RT(w, 1).killedBy).toBe("Warden");
        expect(fxOf(w.events, "death")).toEqual([{ kind: "death", id: idOf(1), x: P(w, 1).x, y: P(w, 1).y, by: null }]);
        expect(P(w, 0).kills).toBe(credited ? 1 : 0);
        expect(RT(w, 0).gv.kills).toBe(credited ? GV_KILL : 0);
        expect(ofType(w.events, "gv")).toHaveLength(credited ? 1 : 0);
      });

      it("pays the bounty on the victim and counts toward the hunter's own", () => {
        const w = startRun(4, LONG);
        P(w, 1).bounty = 80;
        hit(w, 0, 1);
        w.events = [];
        finish(w, 1, "Warden");
        expect(RT(w, 0).gv).toEqual({ kills: GV_KILL, mobs: 0, bounty: 80 });
        expect(ofType(w.events, "gv").map((e) => e.reason)).toEqual(["kill", "bounty"]);
        expect(P(w, 0).kills).toBe(1);
      });

      it("sudden death credits nobody, whoever hit the victim a moment ago", () => {
        const w = startRun(4, LONG);
        hit(w, 0, 1);
        w.events = [];
        finish(w, 1, SUDDEN_DEATH_KILLER);
        expect(P(w, 0).kills).toBe(0);
        expect(ofType(w.events, "gv")).toEqual([]);
      });

      it("a rival's hit in the killing pass takes the kill, not the hunter from before", () => {
        const w = startRun(4, LONG);
        hit(w, 0, 1);
        w.events = [];
        applyHits(w, P(w, 1), RT(w, 1), [{ amount: 1000, source: "Warden" }, { amount: 1, source: attacker(w, 2) }]);
        expect(P(w, 2).kills).toBe(1);
        expect(P(w, 0).kills).toBe(0);
        expect(fxOf(w.events, "death")).toEqual([{ kind: "death", id: idOf(1), x: P(w, 1).x, y: P(w, 1).y, by: idOf(2) }]);
      });

      it("a hunter who has left the run is paid nothing, and nothing breaks", () => {
        const w = startRun(4, LONG);
        hit(w, 0, 1);
        removePlayer(w, idOf(0));
        w.events = [];
        finish(w, 1, "Warden");
        expect(P(w, 1).status).toBe("dead");
        expect(ofType(w.events, "gv")).toEqual([]);
      });

      it("the hunter's kill is paid once the pass is over, and only once", () => {
        const w = startRun(4, LONG);
        hit(w, 0, 1);
        w.events = [];
        applyHits(w, P(w, 1), RT(w, 1), [{ amount: 1000, source: "Warden" }]);
        applyHits(w, P(w, 1), RT(w, 1), [{ amount: 1000, source: "Warden" }]); // already down: ignored
        expect(P(w, 0).kills).toBe(1);
        expect(ofType(w.events, "gv")).toHaveLength(1);
      });
    });

    it("hurting yourself is never your own kill or leave credit", () => {
      const w = startRun(3, LONG);
      hit(w, 1, 1, 10);
      expect(RT(w, 1).lastHit).toBeNull();
      P(w, 1).bounty = 28;
      w.events = [];
      hit(w, 1, 1, 1000);
      expect(P(w, 1).status).toBe("dead");
      expect(P(w, 1).kills).toBe(0);
      expect(RT(w, 1).gv).toEqual({ kills: 0, mobs: 0, bounty: 0 });
      expect(ofType(w.events, "gv")).toEqual([]);
      expect(fxOf(w.events, "death")).toEqual([{ kind: "death", id: idOf(1), x: P(w, 1).x, y: P(w, 1).y, by: idOf(1) }]);
    });

    it("a bountyClaimed hook that hits the victim again can't pay the kill twice", () => {
      const w = startRun(4, LONG);
      P(w, 1).bounty = 80;
      let calls = 0;
      w.hooks.bountyClaimed = (world) => {
        calls++;
        expect(applyDamage(world, P(world, 1), RT(world, 1), 1000, attacker(world, 0))).toBe(0);
      };
      w.events = [];
      hit(w, 0, 1, 1000);
      expect(calls).toBe(1);
      expect(P(w, 0).kills).toBe(1);
      expect(RT(w, 0).gv).toEqual({ kills: GV_KILL, mobs: 0, bounty: 80 });
      expect(fxOf(w.events, "death")).toHaveLength(1);
    });
  });
});

describe("coliseumSpots", () => {
  const SEEDS = Array.from({ length: 30 }, (_, i) => 1 + i * 37);

  it("returns n distinct free floor points, reachable from the first spawn, for n = 1..MAX_PLAYERS on many maps", () => {
    for (const seed of SEEDS) {
      const map = generateMap(seed);
      for (let n = 1; n <= MAX_PLAYERS; n++) {
        const spots = coliseumSpots(map, n);
        const label = `seed ${seed} n ${n}`;
        expect(spots, label).toHaveLength(n);
        expect(new Set(spots.map(key)).size, label).toBe(n);
        for (const spot of spots) {
          expect(circleClear(map, spot, PLAYER_RADIUS), `${label} ${key(spot)} clear`).toBe(true);
          const origin = map.spawns[0]!;
          const reachable = key(origin) === key(spot) || findPath(map, origin, spot, PLAYER_RADIUS).length > 0;
          expect(reachable, `${label} ${key(spot)} reachable`).toBe(true);
        }
      }
    }
  });

  it("hands out the map's own teleport spots: every spot is one of coliseum.innerSpawns, for n = 1..MAX_PLAYERS", () => {
    for (const seed of SEEDS) {
      const map = generateMap(seed);
      const inner = new Set(map.coliseum.innerSpawns.map(key));
      expect(inner.size, `seed ${seed}`).toBeGreaterThanOrEqual(MAX_PLAYERS);
      for (let n = 1; n <= MAX_PLAYERS; n++) {
        const spots = coliseumSpots(map, n);
        const label = `seed ${seed} n ${n}`;
        expect(spots, label).toHaveLength(n);
        for (const spot of spots) expect(inner.has(key(spot)), `${label}: ${key(spot)} is not an inner spawn`).toBe(true);
        expect(new Set(spots.map(key)).size, `${label}: distinct`).toBe(n);
      }
    }
  });

  it("is deterministic per map", () => {
    for (const seed of SEEDS.slice(0, 10)) {
      for (const n of [1, 4, MAX_PLAYERS]) {
        expect(coliseumSpots(generateMap(seed), n)).toEqual(coliseumSpots(generateMap(seed), n));
      }
    }
  });

  it("puts each spot within a few tiles of its point on the ring about the map centre", () => {
    for (const seed of SEEDS) {
      const map = generateMap(seed);
      const cx = (map.w * TILE) / 2;
      const cy = (map.h * TILE) / 2;
      for (let n = 1; n <= MAX_PLAYERS; n++) {
        coliseumSpots(map, n).forEach((spot, i) => {
          const angle = (2 * Math.PI * i) / n;
          const want = { x: cx + Math.cos(angle) * COLISEUM_RING_RADIUS, y: cy + Math.sin(angle) * COLISEUM_RING_RADIUS };
          expect(Math.hypot(spot.x - want.x, spot.y - want.y), `seed ${seed} n ${n} i ${i}`).toBeLessThanOrEqual(3 * TILE);
        });
      }
    }
  });

  it("spreads the players around the ring, not into one corner of it", () => {
    const map = generateMap(1234);
    const cx = (map.w * TILE) / 2;
    const cy = (map.h * TILE) / 2;
    const spots = coliseumSpots(map, 4);
    const xs = spots.map((s) => s.x - cx);
    const ys = spots.map((s) => s.y - cy);
    expect(Math.max(...xs)).toBeGreaterThan(COLISEUM_RING_RADIUS / 2);
    expect(Math.min(...xs)).toBeLessThan(-COLISEUM_RING_RADIUS / 2);
    expect(Math.max(...ys)).toBeGreaterThan(COLISEUM_RING_RADIUS / 2);
    expect(Math.min(...ys)).toBeLessThan(-COLISEUM_RING_RADIUS / 2);
  });

  it("falls back to the map's spawns when no ring point finds a free tile", () => {
    const w = 8;
    const h = 8;
    const walled: GameMap = {
      ...mapFromTiles(w, h, new Uint8Array(w * h).fill(TILE_WALL)), spawns: [{ x: 40, y: 40 }, { x: 100, y: 100 }],
    };
    expect(coliseumSpots(walled, 3)).toEqual([walled.spawns[0], walled.spawns[1], walled.spawns[0]]);
  });

  /** '#' is a wall, anything else floor. */
  function gridMap(rows: string[], spawns: Vec2[]): GameMap {
    const h = rows.length;
    const w = rows[0]!.length;
    const tiles = new Uint8Array(w * h);
    rows.forEach((row, ty) => [...row].forEach((c, tx) => { tiles[ty * w + tx] = c === "#" ? TILE_WALL : TILE_FLOOR; }));
    return { ...mapFromTiles(w, h, tiles), spawns };
  }
  const tileCentre = (tx: number, ty: number): Vec2 => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });

  it("hands out different tiles even when every ring point is nearest to the same one", () => {
    // Only three free tiles in the whole map, all near the middle.
    const rows = Array.from({ length: 20 }, (_, ty) => (ty === 10 ? "#########...########" : "#".repeat(20)));
    const map = gridMap(rows, [tileCentre(9, 10)]);
    const spots = coliseumSpots(map, 3);
    expect(spots.map(key).sort()).toEqual([tileCentre(9, 10), tileCentre(10, 10), tileCentre(11, 10)].map(key).sort());
  });

  it("skips free tiles that cannot be reached from the first spawn", () => {
    // A sealed one-tile cell sits right on the first ring point; the reachable corridor is ten tiles away.
    const rows = Array.from({ length: 20 }, (_, ty) => (ty === 10 ? "##....#######.######" : "#".repeat(20)));
    expect(rows[10]!.length).toBe(20);
    const map = gridMap(rows, [tileCentre(3, 10)]);
    const [spot] = coliseumSpots(map, 1);
    expect(key(spot!)).not.toBe(key(tileCentre(13, 10)));
    expect(findPath(map, map.spawns[0]!, spot!, PLAYER_RADIUS).length > 0 || key(spot!) === key(map.spawns[0]!)).toBe(true);
    expect(spot!.x).toBeLessThan(7 * TILE);
  });

  it("skips tiles that are walls or already taken", () => {
    // An open room with a pillar exactly on the ring point of the first player.
    const w = 20;
    const h = 20;
    const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
    for (let i = 0; i < w; i++) { tiles[i] = TILE_WALL; tiles[(h - 1) * w + i] = TILE_WALL; tiles[i * w] = TILE_WALL; tiles[i * w + w - 1] = TILE_WALL; }
    const cx = (w * TILE) / 2;
    const ringTx = Math.floor((cx + COLISEUM_RING_RADIUS) / TILE);
    tiles[10 * w + ringTx] = TILE_WALL;
    const map: GameMap = { ...mapFromTiles(w, h, tiles), spawns: [{ x: 3 * TILE + 16, y: 3 * TILE + 16 }] };
    const spots = coliseumSpots(map, 2);
    expect(new Set(spots.map(key)).size).toBe(2);
    for (const s of spots) expect(circleClear(map, s, PLAYER_RADIUS)).toBe(true);
    expect(key(spots[0]!)).not.toBe(key({ x: ringTx * TILE + TILE / 2, y: 10 * TILE + TILE / 2 }));
  });
});

describe("determinism", () => {
  it("identical inputs and random stream give identical events, results and positions", () => {
    const simulate = (seed: number) => {
      const w = startRun(4, { patienceSeconds: 2, suddenDeathSeconds: 1 }, { random: mulberry32(seed) });
      for (let i = 0; i < 4; i++) {
        enqueueClientMessage(RT(w, i).inputs, "move", w.map.groundSpots[i * 3]!);
      }
      atTick(w, 600, (world) => kill(world, 3, attacker(world, 0)));
      const all: SimEvent[] = [];
      for (let i = 0; i < 3000 && w.state.phase === "active"; i++) all.push(...tick(w));
      return {
        events: all,
        players: [...w.state.players.values()].map((p) => [p.name, p.x, p.y, p.hp, p.status, p.gv, p.kills, p.immuneUntil]),
        time: w.state.serverTime,
        winner: w.state.winner,
      };
    };
    const first = simulate(11);
    expect(first.events.some((e) => e.type === "fx" && e.fx.kind === "teleport")).toBe(true);
    expect(first.events.filter((e) => e.type === "raidEnded")).toHaveLength(1);
    expect(simulate(11)).toEqual(first);
  });

  it("a different random stream changes only who stands where", () => {
    const run = (seed: number) => {
      const w = startRun(3, {}, { random: mulberry32(seed) });
      runTo(w, 2050);
      return [0, 1, 2].map((i) => key(P(w, i)));
    };
    const sets = new Set<string>();
    const layouts = new Set<string>();
    for (let s = 1; s <= 8; s++) {
      const spots = run(s);
      sets.add([...spots].sort().join("|"));
      layouts.add(spots.join("|"));
    }
    expect(sets.size).toBe(1); // the same three coliseum spots every time
    expect(layouts.size).toBeGreaterThan(1); // handed out differently
  });
});

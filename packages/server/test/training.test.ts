// Training mode (its own room name, TRAINING_ROOM_NAME, and SimConfig.training): a private room of one, Phase 9's dummies
// and a rack of every weapon next to the spawn, and none of the run's consequences. Two halves:
//   - the world, headless, built the way the Room builds it (createGameWorld with the training config, installTraining,
//     addPlayer, startRaid): what the sim does and does not do in a training tick, with an arena world as the control;
//   - the Room over real sockets (the real server in this process, a temp profile file, SDK clients that send inputs only):
//     who may get in, that nothing is recorded however the visit ends, and that the arena is untouched by it.
// The server's timers are short (patience and sudden death a fraction of a second) so a training room that still ran the
// arena's rules would show it at once; arena rooms in these tests are given long ones. Every room is given the same map
// seed (the room draws it with randomInt, mocked below) so the rack and the dummies are placed the same way each run.
// Every test claims profiles of its own, so nothing leaks between them.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import {
  defaultFaction, DUMMY_HP, FACTION_IDS, FACTIONS, GV_KILL, isRanged, MAX_PLAYERS, mulberry32, ROOM_NAME, SIGNATURE_WEAPONS,
  TICK_MS, TILE, TRAINING_ROOM_NAME, unpackFx, WEAPON_IDS, type FactionId, type FxBatch, type FxEvent, type JoinOptions, type RunResult,
  type TimedFx, type Vec2, type WeaponId,
} from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { loadConfig } from "../src/config";
import { startServer, type RaidServer } from "../src/index";
import { RaidRoom } from "../src/rooms/RaidRoom";
import { applyDamage, downPlayer } from "../src/sim/arena";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { addPlayer, removePlayer, startRaid, step } from "../src/sim/step";
import { installTraining } from "../src/sim/training";
import type { SimConfig, SimEvent, World } from "../src/sim/world";

const { ROOM_SEED } = vi.hoisted(() => ({ ROOM_SEED: 1234 }));

// Only the room's map seed is pinned; every other use of the module is the real one.
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  const randomInt = ((...args: unknown[]) =>
    (args[0] === 0 && args[1] === 2 ** 31 ? ROOM_SEED : (actual.randomInt as (...a: unknown[]) => unknown)(...args))) as typeof actual.randomInt;
  return { ...actual, default: { ...actual, randomInt }, randomInt };
});

type ClientRoom = Room<any, RaidState>;
type EventOf<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;
type Fx<K extends FxEvent["kind"]> = Extract<FxEvent, { kind: K }>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(pred: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    let ok = false;
    try { ok = pred(); } catch { /* state not there yet */ }
    if (ok) return;
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await sleep(10);
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

function ofType<T extends SimEvent["type"]>(events: SimEvent[], type: T): Array<EventOf<T>> {
  return events.filter((e): e is EventOf<T> => e.type === type);
}

function fxOf<K extends FxEvent["kind"]>(events: SimEvent[], kind: K): Array<Fx<K>> {
  return ofType(events, "fx").map((e) => e.fx).filter((fx): fx is Fx<K> => fx.kind === kind);
}

/** The numbers in the ids world.nextId hands out (mob ids and container ids share one counter, so creation order shows). */
const idNumber = (id: string): number => parseInt(id.replace(/^(mob|c)/, ""), 36);

// ================================================================= the training world, headless

const BASE: SimConfig = {
  minPlayers: 8, lobbySeconds: 120, fillSeconds: 0, patienceSeconds: 2, patienceMinSeconds: 2, suddenDeathSeconds: 2,
};
const SEED = ROOM_SEED;
const ME = "p0";

/** What RaidRoom.onCreate and onJoin build for a training room: one player, in the run at once. */
function trainingWorld(faction: FactionId | null = null, seed = SEED): World {
  const world = createGameWorld({ seed, config: { ...BASE, dummies: true, training: true }, random: mulberry32(seed + 1) });
  installTraining(world);
  addPlayer(world, ME, "alice", { faction });
  startRaid(world);
  return world;
}

/** The same world as an arena run of one: the control for everything the training world must not do. */
function arenaWorld(seed = SEED): World {
  const world = createGameWorld({ seed, config: { ...BASE, minPlayers: 1 }, random: mulberry32(seed + 1) });
  addPlayer(world, ME, "alice");
  startRaid(world);
  return world;
}

const tick = (world: World): SimEvent[] => step(world, TICK_MS);

function run(world: World, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...tick(world));
  return events;
}

const me = (world: World) => world.state.players.get(ME)!;
const mobNamed = (world: World, name: string): string => [...world.state.mobs].find(([, m]) => m.name === name)![0];

/** The loose weapons the training setup placed: created after the mobs, so with later ids than any of them. */
function rackOf(world: World) {
  const lastMob = Math.max(...[...world.state.mobs.keys()].map(idNumber));
  return [...world.state.containers.values()].filter((c) => c.kind === "ground" && idNumber(c.id) > lastMob);
}

function place(world: World, id: string, at: Vec2): void {
  const p = world.state.players.get(id)!;
  p.x = at.x;
  p.y = at.y;
  const rt = world.players.get(id)!;
  rt.path = [];
  rt.history = [{ t: world.state.serverTime, x: at.x, y: at.y }];
}

function send(world: World, type: string, msg: unknown): void {
  expect(enqueueClientMessage(world.players.get(ME)!.inputs, type, msg), `${type} accepted`).toBe(true);
}

/**
 * The player takes `weapon` in hand, stands by `mobId` on the side it faces (the side of the spawn, which sees it, so the
 * way is clear), aims at it, and attacks the way a client does: a press, and the release after the draw if it is a bow.
 */
function attackMob(world: World, weapon: WeaponId, mobId: string): SimEvent[] {
  const p = me(world);
  const m = world.state.mobs.get(mobId)!;
  p.weapon0 = weapon;
  p.weapon1 = "";
  p.slot = 0;
  const gap = isRanged(weapon) ? 90 : 36;
  place(world, ME, { x: m.x + Math.cos(m.facing) * gap, y: m.y + Math.sin(m.facing) * gap });
  const a = Math.atan2(m.y - p.y, m.x - p.x);
  const events: SimEvent[] = [];
  send(world, "attack", { a });
  if (weapon === "bow") events.push(...run(world, 15));
  send(world, "release", { a });
  events.push(...run(world, 40));
  return events;
}

/** Nothing a run pays or ends with: no result, no GV, no kills, no bounty, and the run still on. */
function expectNoConsequences(world: World, events: SimEvent[]): void {
  const p = me(world);
  const rt = world.players.get(ME)!;
  expect([p.kills, p.gv, p.bounty]).toEqual([0, 0, 0]);
  expect(rt.gv).toEqual({ kills: 0, mobs: 0, bounty: 0, quest: 0 });
  expect(rt.mobKills).toBe(0);
  expect(rt.resolved).toBe(false);
  expect(ofType(events, "resolved")).toEqual([]);
  expect(ofType(events, "gv")).toEqual([]);
  expect(ofType(events, "raidEnded")).toEqual([]);
  expect(world.state.phase).toBe("active");
}

describe("the training world (headless)", () => {
  describe("setup", () => {
    it("is an active run from the first tick, with the training flag up, no timer and nobody in the coliseum", () => {
      const world = trainingWorld();
      const s = world.state;
      expect(s.training).toBe(true);
      expect(s.phase).toBe("active");
      expect(s.players.size).toBe(1);
      expect(s.startedWith).toBe(1);
      expect(s.patienceEndsAt).toBe(0);
      expect(s.inColiseum).toBe(false);
      expect(s.gatesLocked).toBe(false);
      expect(s.suddenDeathAt).toBe(0);
      expect(me(world).status).toBe("alive");
      expect(ofType(tick(world), "raidStarted")).toHaveLength(1);
    });

    it("places a plain dummy, a shield dummy and one loose weapon of every id, 3 to 6 tiles from the spawn", () => {
      const world = trainingWorld();
      const spawn = { x: me(world).x, y: me(world).y };
      const mobs = [...world.state.mobs.values()];
      expect(mobs.map((m) => [m.name, m.kind, m.weapon0])).toEqual([["Dummy", "dummy", ""], ["Shield dummy", "dummy", "shield"]]);
      const rack = rackOf(world);
      expect(rack.map((c) => c.items.at(0)!.def).sort()).toEqual([...WEAPON_IDS].sort());
      for (const c of rack) expect(c.items).toHaveLength(1);
      for (const at of [...mobs, ...rack]) {
        const d = Math.hypot(at.x - spawn.x, at.y - spawn.y) / TILE;
        expect(d).toBeGreaterThanOrEqual(3);
        expect(d).toBeLessThanOrEqual(6);
      }
    });

    it.each(FACTION_IDS)("the player asking for %s starts on fists (the rack has the weapons) and has its hp", (faction) => {
      const p = me(trainingWorld(faction));
      expect(p).toMatchObject({
        faction, hp: FACTIONS[faction].hp, maxHp: FACTIONS[faction].hp, weapon0: "", weapon1: "", slot: 0,
      });
    });

    it("takes the server's default faction when none is asked for", () => {
      expect(me(trainingWorld(null)).faction).toBe(defaultFaction(0));
    });
  });

  describe("an arena world next to it", () => {
    it("has no flag, no dummies, no rack of its own, and a patience timer that runs", () => {
      const world = arenaWorld();
      expect(world.state.training).toBe(false);
      expect(world.state.mobs.size).toBe(0);
      expect(world.state.patienceEndsAt).toBeGreaterThan(0);
    });

    it("regional mobs: an arena world with mobs on has them, a training world asked for the same gets only its dummies", () => {
      const withMobs = (extra: Partial<SimConfig>): World => {
        const world = createGameWorld({ seed: SEED, config: { ...BASE, minPlayers: 1, mobs: true, ...extra }, random: mulberry32(SEED + 1) });
        if (extra.training) installTraining(world);
        addPlayer(world, ME, "alice");
        startRaid(world);
        return world;
      };
      const regional = (world: World) => [...world.state.mobs.values()].filter((m) => m.kind === "mob" || m.kind === "elite");
      expect(regional(withMobs({})).length).toBeGreaterThan(10);
      const training = withMobs({ dummies: true, training: true });
      expect(regional(training)).toEqual([]);
      expect([...training.state.mobs.values()].map((m) => m.kind)).toEqual(["dummy", "dummy"]);
      expect(training.mobs.size).toBe(2);
      run(training, 40);
      expect(training.state.mobs.size).toBe(2);
    });

    it("DUMMIES=1 alone (dummies without the training flag) is still an arena run", () => {
      const world = createGameWorld({ seed: SEED, config: { ...BASE, minPlayers: 1, dummies: true }, random: mulberry32(SEED + 1) });
      addPlayer(world, ME, "alice");
      startRaid(world);
      expect(world.state.training).toBe(false);
      expect(world.state.mobs.size).toBe(2);
      expect(world.state.patienceEndsAt).toBeGreaterThan(0);
      const events = run(world, 100);
      expect(fxOf(events, "teleport")).toHaveLength(1);
    });
  });

  describe("however long it runs", () => {
    const TICKS = Math.round((120 * 1000) / TICK_MS); // two minutes, against a 2 s patience timer and a 2 s sudden death

    it("never teleports, locks the gates, burns anyone or ends, and says nothing a result would", () => {
      const world = trainingWorld("fire"); // the frailest faction: any stray damage would show
      const start = { x: me(world).x, y: me(world).y };
      const events: SimEvent[] = [];
      for (let i = 0; i < TICKS; i++) {
        events.push(...tick(world));
        if (i % 20 !== 0) continue;
        const s = world.state;
        expect([s.gatesLocked, s.inColiseum, s.patienceEndsAt, s.suddenDeathAt], `tick ${i}`).toEqual([false, false, 0, 0]);
        expect([me(world).x, me(world).y, me(world).hp, me(world).status], `tick ${i}`).toEqual([start.x, start.y, me(world).maxHp, "alive"]);
        expect(s.phase).toBe("active");
      }
      expect(fxOf(events, "teleport")).toEqual([]);
      expect(fxOf(events, "victory")).toEqual([]);
      expect(fxOf(events, "death")).toEqual([]);
      expectNoConsequences(world, events);
    });

    it("and the same timers do teleport, burn and end an arena run, so the test above could have failed", () => {
      const world = arenaWorld();
      const events = run(world, TICKS);
      expect(fxOf(events, "teleport")).toHaveLength(1);
      expect(ofType(events, "resolved")).toHaveLength(1);
      expect(world.state.phase).toBe("ended");
    });
  });

  describe("hitting the dummies", () => {
    it.each(WEAPON_IDS)("a %s hits the plain dummy: it takes damage, and the player earns nothing", (weapon) => {
      const world = trainingWorld();
      run(world, 70); // the dummies are full, the weapon is ready
      const plain = mobNamed(world, "Dummy");
      const events = attackMob(world, weapon, plain);
      const hits = fxOf(events, "hit").filter((h) => h.id === plain);
      expect(hits.length, "hits on the dummy").toBeGreaterThan(0);
      expect(hits[0]).toMatchObject({ by: ME, weapon });
      expect(world.mobs.get(plain)!.lastHitAt).toBeGreaterThan(0);
      expectNoConsequences(world, events);
      expect(world.state.mobs.get(plain)!.status).toBe("alive");
    });

    it.each(WEAPON_IDS)("a %s against the shield dummy: the shield answers, the player earns nothing, the run goes on", (weapon) => {
      const world = trainingWorld();
      run(world, 70);
      const shield = mobNamed(world, "Shield dummy");
      const p = me(world);
      p.hp = p.maxHp = 1e6; // so a riposte or a reflected arrow cannot end the player's try
      const events = attackMob(world, weapon, shield);
      const touched = [...fxOf(events, "hit"), ...fxOf(events, "block")].filter((f) => f.id === shield || f.id === ME);
      expect(touched.length, "the shield dummy was engaged").toBeGreaterThan(0);
      expectNoConsequences(world, events);
      expect(world.state.mobs.get(shield)!.status).toBe("alive");
    });

    it("a dummy never dies: a hit worth far more than its hp refills it, and nothing is paid or announced", () => {
      const world = trainingWorld();
      const events: SimEvent[] = [];
      for (const id of world.state.mobs.keys()) {
        recordHit(world, {
          victim: id, by: { id: ME, name: "alice" }, packet: { raw: DUMMY_HP * 40, phys: 1, magic: 0, true: 0 }, weapon: "axe", stagger: false,
        });
        applyLedger(world);
        events.push(...world.events.splice(0));
        expect(world.state.mobs.get(id)).toMatchObject({ hp: DUMMY_HP, status: "alive" });
      }
      events.push(...run(world, 5));
      expect(world.state.mobs.size).toBe(2);
      expect(fxOf(events, "death")).toEqual([]);
      expectNoConsequences(world, events);
    });
  });

  describe("a player who goes down", () => {
    const WEAPONS_IN_HAND = { weapon0: "bow", weapon1: "sword", slot: 0 } as const;

    /** Arms the player with a bow and a sword, and leaves them on a sliver of hp so the next hit that lands downs them. */
    function doomed(world: World): void {
      Object.assign(me(world), WEAPONS_IN_HAND, { hp: 0.01 });
    }

    /** On their feet at full health with their weapons, and nothing left of the fall: no flag, no body, nothing queued to resolve. */
    function expectOnFeet(world: World): void {
      const p = me(world);
      const rt = world.players.get(ME)!;
      expect(p.status).toBe("alive");
      expect(p.hp).toBe(p.maxHp);
      expect({ weapon0: p.weapon0, weapon1: p.weapon1, slot: p.slot }).toEqual(WEAPONS_IN_HAND);
      expect(world.arena.downedThisTick).toEqual([]);
      expect(world.arena.downsBetweenTicks).toBe(0);
      expect(rt.down).toBeNull();
      expect(rt.resolved).toBe(false);
      expect(rt.killedBy).toBeNull();
      expect(world.state.phase).toBe("active");
      expect([...world.state.containers.values()].filter((c) => c.kind === "body"), "no body was left").toEqual([]);
    }

    /** On their feet, and the run said nothing of it. */
    function expectRevived(world: World, events: SimEvent[]): void {
      expectOnFeet(world);
      expect(ofType(events, "resolved")).toEqual([]);
    }

    it("a reflected arrow that downs them: back on their feet in the same tick, at full health, with their weapons", () => {
      const world = trainingWorld();
      run(world, 70);
      const shield = mobNamed(world, "Shield dummy");
      doomed(world);
      const m = world.state.mobs.get(shield)!;
      place(world, ME, { x: m.x + Math.cos(m.facing) * 90, y: m.y + Math.sin(m.facing) * 90 });
      const a = Math.atan2(m.y - me(world).y, m.x - me(world).x);
      const events: SimEvent[] = [];
      send(world, "attack", { a });
      events.push(...run(world, 15));
      send(world, "release", { a });
      let downTick: SimEvent[] | null = null;
      for (let i = 0; i < 40 && !downTick; i++) {
        const out = tick(world);
        events.push(...out);
        if (fxOf(out, "death").some((d) => d.id === ME)) downTick = out;
      }
      expect(downTick, "the reflected arrow downed the player").not.toBeNull();
      // Checked right after the tick the death was reported in: nothing waits for a later one.
      expectRevived(world, events);
      expectNoConsequences(world, events);
    });

    it("a riposte of the shield dummy against a sword does the same", () => {
      const world = trainingWorld();
      run(world, 70);
      const shield = mobNamed(world, "Shield dummy");
      doomed(world);
      const m = world.state.mobs.get(shield)!;
      place(world, ME, { x: m.x + Math.cos(m.facing) * 36, y: m.y + Math.sin(m.facing) * 36 });
      me(world).slot = 1; // the sword in hand, the bow behind it
      const a = Math.atan2(m.y - me(world).y, m.x - me(world).x);
      send(world, "attack", { a });
      send(world, "release", { a });
      const events = run(world, 40);
      expect(fxOf(events, "death").some((d) => d.id === ME), "the riposte downed the player").toBe(true);
      me(world).slot = 0;
      expectRevived(world, events);
      expectNoConsequences(world, events);
    });

    it("any way down inside a tick is undone at its end, every time, and the run never resolves", () => {
      const world = trainingWorld("plague");
      Object.assign(me(world), WEAPONS_IN_HAND);
      const rt = world.players.get(ME)!;
      let downs = 0;
      world.systems.push((w) => {
        if (w.state.tick % 7 === 0) { applyDamage(w, me(w), rt, 1e9, "test"); downs++; }
      });
      const events: SimEvent[] = [];
      for (let i = 0; i < 100; i++) {
        events.push(...tick(world));
        expectRevived(world, events);
      }
      expect(downs).toBeGreaterThan(10);
      expect(fxOf(events, "death").filter((d) => d.id === ME)).toHaveLength(downs);
      expectNoConsequences(world, events);
    });

    describe("between ticks, outside any step", () => {
      // The sim's own way down from outside a tick: a leave, or a hook damaging a player. Until the next step the player
      // is down (and the sim has announced it, which the Room ignores in training: see the live tests); that step stands them up.
      const WAYS_DOWN: Array<[string, (world: World) => void]> = [
        ["applyDamage", (world) => { applyDamage(world, me(world), world.players.get(ME)!, 1e9, "test"); }],
        ["downPlayer (died)", (world) => { downPlayer(world, me(world), world.players.get(ME)!, "died"); }],
      ];

      it.each(WAYS_DOWN)("%s leaves them down until the next step, which stands them up at full health with their weapons", (_name, goDown) => {
        const world = trainingWorld();
        Object.assign(me(world), WEAPONS_IN_HAND);
        run(world, 3);
        goDown(world);
        const rt = world.players.get(ME)!;
        expect(me(world).status, "down until a step").toBe("dead");
        expect(rt.resolved, "the sim marked the run resolved").toBe(true);

        const events = tick(world);
        expectOnFeet(world);
        expect(ofType(events, "gv")).toEqual([]);
        expect(ofType(events, "raidEnded")).toEqual([]);
        expect([me(world).kills, me(world).gv, me(world).bounty]).toEqual([0, 0, 0]);
        // And it is not a one-off: every tick for a while.
        for (let i = 0; i < 30; i++) {
          goDown(world);
          expect(me(world).status).toBe("dead");
          tick(world);
          expectOnFeet(world);
        }
        expect(world.state.phase).toBe("active");
      });

      it("the player can fight at once afterwards", () => {
        const world = trainingWorld();
        Object.assign(me(world), WEAPONS_IN_HAND);
        applyDamage(world, me(world), world.players.get(ME)!, 1e9, "test");
        tick(world);
        me(world).slot = 1; // the sword
        send(world, "attack", { a: 0 });
        send(world, "release", { a: 0 });
        expect(fxOf(run(world, 2), "windup")).toMatchObject([{ by: ME, weapon: "sword" }]);
      });

      it("removePlayer takes the player out of the world for good (MIA is not revived), and the world carries on", () => {
        const world = trainingWorld();
        removePlayer(world, ME);
        expect(world.state.players.size).toBe(0);
        expect(world.players.size).toBe(0);
        const events = run(world, 40); // nothing to revive, nothing to fail on
        expect(world.state.players.size).toBe(0);
        expect(world.state.phase).toBe("active");
        expect(ofType(events, "raidEnded")).toEqual([]);
        expect(ofType(events, "gv")).toEqual([]);
      });

      it("a player still in the state with status mia stays mia: only the dead are stood up", () => {
        const world = trainingWorld();
        downPlayer(world, me(world), world.players.get(ME)!, "mia");
        expect(me(world).status).toBe("mia");
        run(world, 10);
        expect(me(world).status).toBe("mia");
        expect(me(world).hp).toBeGreaterThan(0);
      });
    });

    it("can fight again at once: the next attack starts its windup", () => {
      const world = trainingWorld();
      Object.assign(me(world), WEAPONS_IN_HAND);
      const rt = world.players.get(ME)!;
      world.systems.push((w) => { if (w.state.tick === 3) applyDamage(w, me(w), rt, 1e9, "test"); });
      expect(fxOf(run(world, 4), "death")).toMatchObject([{ id: ME }]);
      expect(me(world).status).toBe("alive");
      me(world).slot = 1; // the sword
      send(world, "attack", { a: 0 });
      send(world, "release", { a: 0 });
      expect(fxOf(run(world, 2), "windup")).toMatchObject([{ by: ME, weapon: "sword" }]);
    });
  });
});

// ================================================================= the training room, over sockets

describe("the training room (live)", () => {
  /** Timers short enough that an arena rule would show within a second; arena rooms are retimed to LONG. */
  const SHORT = { patienceSeconds: 0.3, patienceMinSeconds: 0.3, suddenDeathSeconds: 0.3 };
  const LONG = { patienceSeconds: 120, patienceMinSeconds: 120, suddenDeathSeconds: 120 };

  let server: RaidServer;
  let stopped = false;
  let port = 0;
  let dir = "";
  let profileFile = "";
  let client: Client;
  const restoreConsole: Array<() => void> = [];

  beforeAll(async () => {
    // The SDK prints this on every join the server refuses, which is most of what these tests do.
    for (const method of ["error", "warn"] as const) {
      const original = console[method];
      console[method] = (...args: unknown[]) => {
        if (typeof args[0] === "string" && args[0].startsWith("Room connection was closed unexpectedly")) return;
        original(...args);
      };
      restoreConsole.push(() => { console[method] = original; });
    }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-training-"));
    profileFile = path.join(dir, "data", "stash.json");
    port = await freePort();
    server = await startServer({
      ...loadConfig({ BOTS_FILL_TO: "0" }),
      port,
      minPlayers: MAX_PLAYERS, // an arena lobby never starts by itself
      fillSeconds: 0,
      lobbySeconds: 120,
      ...SHORT,
      planSeconds: 0, // an arena run here starts straight from the lobby, as it did before planning
      firstPatienceSeconds: 0,
      latencyMs: 0,
      stashFile: profileFile,
    });
    client = new Client(`http://127.0.0.1:${port}`);
  });

  afterAll(async () => {
    try {
      if (!stopped) await server.stop();
    } finally {
      for (const restore of restoreConsole) restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------- accounts
  const url = (p: string) => `http://127.0.0.1:${port}${p}`;
  let counter = 0;
  interface Account { name: string; token: string }

  /** A brand new profile, claimed over HTTP the way the menu does it. */
  async function claim(): Promise<Account> {
    const name = `tr${++counter}`;
    const res = await fetch(url(`/api/profile/${name}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: boolean; token: string };
    expect(body.created).toBe(true);
    return { name, token: body.token };
  }

  /** The whole record, as the store holds it: what "byte-identical" is compared on. */
  const snapshot = (who: Account): string => JSON.stringify(server.store.get(who.name));
  const isActive = (who: Account) => server.profiles.isActive(who.name);
  const joinOptions = (who: Account): JoinOptions => ({ profile: who.name, token: who.token });
  const trainingOptions = (who: Account, extra: object = {}) => ({ ...joinOptions(who), ...extra });

  // ---------------------------------------------------------------- rooms
  interface Player {
    who: Account;
    room: ClientRoom;
    results: RunResult[];
    toasts: string[];
    fx: TimedFx[];
    left: boolean;
  }
  const players: Player[] = [];

  function track(who: Account, room: ClientRoom): Player {
    const p: Player = { who, room, results: [], toasts: [], fx: [], left: false };
    room.onMessage("result", (r: RunResult) => p.results.push(r));
    room.onMessage("toast", (m: { text: string }) => p.toasts.push(m.text));
    room.onMessage("fxs", (b: FxBatch) => p.fx.push(...unpackFx(b, room.state.roster)));
    room.onLeave(() => { p.left = true; });
    players.push(p);
    return p;
  }

  interface ServerRoomView {
    world: World;
    clients: { getById(id: string): { ref: { terminate(): void } } | undefined; length: number };
    /** Private to the Room; peeked at to prove what a training room does not remember. */
    picked: Map<string, FactionId>;
    training: boolean;
    maxClients: number;
  }
  const serverRoom = (p: Player) => matchMaker.getLocalRoomById(p.room.roomId) as unknown as ServerRoomView;
  const worldOf = (p: Player) => serverRoom(p).world;
  const sessionOf = (p: Player) => p.room.sessionId;
  const serverPlayer = (p: Player) => worldOf(p).state.players.get(sessionOf(p))!;
  /** The matchmaker's listing of the player's room, whichever handler made it. */
  const listingOf = async (p: Player) => {
    const all = [...(await matchMaker.query({ name: ROOM_NAME })), ...(await matchMaker.query({ name: TRAINING_ROOM_NAME }))];
    return all.find((r) => r.roomId === p.room.roomId);
  };
  const allRooms = async () =>
    [...(await matchMaker.query({ name: ROOM_NAME })), ...(await matchMaker.query({ name: TRAINING_ROOM_NAME }))].map((r) => r.roomId).sort();

  /** A training room for `who` (`extra` is anything else a client might send), once the player is in the run and the client has the state. */
  async function startTraining(who: Account, extra: object = {}): Promise<Player> {
    const p = track(who, await client.create<RaidState>(TRAINING_ROOM_NAME, trainingOptions(who, extra)));
    await until(() => p.room.state.players.has(sessionOf(p)) && p.room.state.phase === "active", "the client to see the run");
    return p;
  }

  /** A new arena lobby (never someone else's), retimed so that nothing happens in it by itself. */
  async function createArena(who: Account, minPlayers = MAX_PLAYERS): Promise<Player> {
    const p = track(who, await client.create<RaidState>(ROOM_NAME, joinOptions(who)));
    retime(p, { minPlayers, ...LONG });
    return p;
  }

  async function joinArena(into: Player, who: Account): Promise<Player> {
    return track(who, await client.joinById<RaidState>(into.room.roomId, joinOptions(who)));
  }

  type Timers = Partial<Pick<SimConfig, "minPlayers" | "patienceSeconds" | "patienceMinSeconds" | "suddenDeathSeconds">>;
  function retime(p: Player, timers: Timers): void {
    const world = worldOf(p);
    world.config = { ...world.config, ...timers };
  }

  async function leave(p: Player): Promise<void> {
    if (p.left) return;
    await p.room.leave(true);
    await until(() => p.left, "client to report the leave");
  }

  afterEach(async () => {
    for (const p of players.splice(0)) {
      try { await leave(p); } catch { /* connection already gone */ }
    }
    // Every test must end with no profile held: a leak here would lock a player out for good.
    await until(() => server.profiles.size === 0, "all profiles to be released", 5000);
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------- moving and fighting
  /** Moves a player on the server only, like a walk would; a client never sees where it was put. */
  function placeOnServer(p: Player, at: Vec2): void {
    const world = worldOf(p);
    const sp = serverPlayer(p);
    sp.x = at.x;
    sp.y = at.y;
    const rt = world.players.get(sessionOf(p))!;
    rt.path = [];
    rt.history = [{ t: world.state.serverTime, x: at.x, y: at.y }];
  }

  const mobIdNamed = (p: Player, name: string): string => mobNamed(worldOf(p), name);

  /** Stands the player `gap` units from the mob on the side it faces (the spawn's), and returns the aim at it. */
  function standBy(p: Player, mobId: string, gap: number): number {
    const m = worldOf(p).state.mobs.get(mobId)!;
    const at = { x: m.x + Math.cos(m.facing) * gap, y: m.y + Math.sin(m.facing) * gap };
    placeOnServer(p, at);
    return Math.atan2(m.y - at.y, m.x - at.x);
  }

  /**
   * The player attacks the way a client does, with inputs only: a press toward `a` and its release, which is one swing, one
   * cast or one arrow at the minimum draw whatever they hold. A tap the cooldown swallowed is repeated until `done()`.
   */
  async function strike(p: Player, a: number, done: () => boolean): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (!done() && Date.now() < deadline) {
      p.room.send("attack", { a });
      p.room.send("release", { a });
      const settle = Date.now() + 300;
      while (!done() && Date.now() < settle) await sleep(20);
    }
    expect(done(), "the attack to reach its goal").toBe(true);
  }

  /** The rack's weapons by id, as they lay when the run began. */
  const rackIds = (p: Player): Map<WeaponId, string> =>
    new Map(rackOf(worldOf(p)).map((c) => [c.items.at(0)!.def as WeaponId, c.id]));

  /** The weapon in the player's hand, on the server. */
  const inHand = (p: Player): string => {
    const sp = serverPlayer(p);
    return sp.slot === 1 ? sp.weapon1 : sp.weapon0;
  };

  /**
   * Takes the rack's `weapon` with a pickup input (into the free slot, else over the weapon in hand) and has it in hand,
   * swapping to it if the pickup put it in the other slot.
   */
  async function takeFromRack(p: Player, rack: Map<WeaponId, string>, weapon: WeaponId): Promise<void> {
    const world = worldOf(p);
    const box = world.state.containers.get(rack.get(weapon)!)!;
    placeOnServer(p, box);
    await sleep(120); // a tick or two, so the history holds the new spot
    p.room.send("pickup", { containerId: box.id });
    await until(() => !world.state.containers.has(box.id), `the ${weapon} to be taken from the rack`);
    if (inHand(p) !== weapon) {
      p.room.send("swap", { slot: serverPlayer(p).slot === 1 ? 0 : 1 });
      await until(() => inHand(p) === weapon, `the ${weapon} in hand`);
    }
    await sleep(500); // the swap's cooldown
  }

  // ---------------------------------------------------------------- arena duels, cut connections
  /** A spawn point nobody else is near, so a duel there cannot hit a bystander. */
  function duelSpot(world: World, fighters: string[]): Vec2 {
    let best = world.map.spawns[0]!;
    let bestDistance = -1;
    for (const spawn of world.map.spawns) {
      let nearest = Infinity;
      for (const [id, q] of world.state.players) {
        if (fighters.includes(id) || q.status !== "alive") continue;
        nearest = Math.min(nearest, Math.hypot(q.x - spawn.x, q.y - spawn.y));
      }
      if (nearest > bestDistance) { bestDistance = nearest; best = spawn; }
    }
    return best;
  }

  /** `killer` takes `victim` down in an arena run: the victim is put on a sliver of hp so that any hit that lands is lethal. */
  async function kill(killer: Player, victim: Player): Promise<void> {
    const at = duelSpot(worldOf(killer), [sessionOf(killer), sessionOf(victim)]);
    placeOnServer(victim, { x: at.x + 12, y: at.y });
    placeOnServer(killer, { x: at.x - 12, y: at.y });
    serverPlayer(victim).hp = 0.01;
    await sleep(120);
    await strike(killer, 0, () => serverPlayer(victim).status !== "alive");
  }

  /** Cuts the player's socket from the server side, as a dropped transport would, and waits until the room noticed. */
  async function dropConnection(p: Player): Promise<void> {
    const sid = sessionOf(p);
    const room = serverRoom(p);
    room.clients.getById(sid)!.ref.terminate();
    await until(() => room.clients.getById(sid) === undefined, "the room to notice the drop");
  }

  // ---------------------------------------------------------------- the tests

  describe("setup", () => {
    it("starts the run at once: active, flagged, one player, no timer, private and full", async () => {
      const who = await claim();
      const p = await startTraining(who);
      const s = worldOf(p).state;
      expect(serverRoom(p).training).toBe(true);
      expect(s.phase).toBe("active");
      expect(s.training).toBe(true);
      expect(s.players.size).toBe(1);
      expect(s.startedWith).toBe(1);
      expect(s.patienceEndsAt).toBe(0);
      expect(s.inColiseum).toBe(false);
      expect(s.gatesLocked).toBe(false);
      expect(serverPlayer(p).status).toBe("alive");
      expect(isActive(who)).toBe(true);
      expect(server.profiles.ownerOf(who.name)).toBe(`${p.room.roomId}:${sessionOf(p)}`);
      // The server runs with mobs on (the default), and a training room still has only its two dummies: no camp, no elite.
      expect(loadConfig({}).mobs).toBe(true);
      expect([...s.mobs.values()].map((m) => m.kind)).toEqual(["dummy", "dummy"]);
      expect(p.room.state.mobs.size).toBe(2);
      // The clients are told: the HUD reads this flag.
      expect(p.room.state.training).toBe(true);
      expect(p.room.state.patienceEndsAt).toBe(0);
      expect(p.room.state.inColiseum).toBe(false);

      expect(serverRoom(p).maxClients).toBe(1);
      expect(await listingOf(p)).toMatchObject({ private: true, maxClients: 1, clients: 1, locked: true });
    });

    it("holds a plain dummy, a shield dummy and one loose weapon of every id", async () => {
      const p = await startTraining(await claim());
      const world = worldOf(p);
      expect(world.state.seed).toBe(ROOM_SEED);
      expect([...world.state.mobs.values()].map((m) => [m.name, m.weapon0])).toEqual([["Dummy", ""], ["Shield dummy", "shield"]]);
      const rack = rackOf(world);
      expect(rack.map((c) => c.items.at(0)!.def).sort()).toEqual([...WEAPON_IDS].sort());
      const spawn = serverPlayer(p);
      for (const at of [...world.state.mobs.values(), ...rack]) {
        const d = Math.hypot(at.x - spawn.x, at.y - spawn.y) / TILE;
        expect(d).toBeGreaterThanOrEqual(3);
        expect(d).toBeLessThanOrEqual(6);
      }
      // The client sees the same.
      await until(() => p.room.state.mobs.size === 2 && p.room.state.containers.size === world.state.containers.size, "the mobs and the rack to sync");
    });

    it("gives the player the hp of the faction they asked for and empty hands (fists)", async () => {
      const p = await startTraining(await claim(), { faction: "frost" });
      expect(serverPlayer(p)).toMatchObject({
        faction: "frost", hp: FACTIONS.frost.hp, maxHp: FACTIONS.frost.hp, weapon0: "", weapon1: "", slot: 0,
      });
      const seen = p.room.state.players.get(sessionOf(p))!;
      expect([seen.faction, seen.weapon0, seen.weapon1, seen.maxHp]).toEqual(["frost", "", "", FACTIONS.frost.hp]);
    });

    it.each([
      ["nothing", {}],
      ["a faction that isn't one", { faction: "dragon" }],
      ["a number", { faction: 3 }],
    ])("takes the server's default faction when asked for %s", async (_label, extra) => {
      const p = await startTraining(await claim(), extra);
      expect(serverPlayer(p)).toMatchObject({
        faction: defaultFaction(0), weapon0: "", hp: FACTIONS[defaultFaction(0)].hp,
      });
    });

    it("does not remember the picked faction for achievements, where an arena join does", async () => {
      const trainee = await startTraining(await claim(), { faction: "holy" });
      expect(serverRoom(trainee).picked.size).toBe(0);
      const who = await claim();
      const raider = track(who, await client.create<RaidState>(ROOM_NAME, { ...joinOptions(who), faction: "holy" }));
      expect(serverRoom(raider).picked.get(sessionOf(raider))).toBe("holy");
    });
  });

  describe("no consequences", () => {
    it("runs well past the timers an arena would obey, and the profile is byte-identical afterwards, in memory and on disk", async () => {
      const who = await claim();
      await server.store.flush();
      const before = snapshot(who);
      const recordRun = vi.spyOn(server.store, "recordRun");
      const bankGv = vi.spyOn(server.store, "bankGv");

      const p = await startTraining(who, { faction: "fire" }); // the frailest faction: any stray damage would show
      const world = worldOf(p);
      const sid = sessionOf(p);
      const start = { x: serverPlayer(p).x, y: serverPlayer(p).y };
      const t0 = world.state.serverTime;
      const end = Date.now() + 3000; // ten times the patience timer, and the sudden death timer on top of that
      while (Date.now() < end) {
        const s = world.state;
        expect([s.phase, s.gatesLocked, s.inColiseum, s.patienceEndsAt, s.suddenDeathAt]).toEqual(["active", false, false, 0, 0]);
        const sp = serverPlayer(p);
        expect([sp.x, sp.y, sp.hp, sp.status, sp.immuneUntil]).toEqual([start.x, start.y, sp.maxHp, "alive", 0]);
        await sleep(100);
      }
      expect(world.state.serverTime - t0, "the room really ran that long").toBeGreaterThan(2500);

      // What the client heard and saw is just as quiet.
      expect(p.room.state).toMatchObject({ phase: "active", training: true, gatesLocked: false, inColiseum: false, patienceEndsAt: 0 });
      expect(p.results).toEqual([]);
      expect(p.fx.filter((f) => ["teleport", "victory", "death"].includes(f.kind))).toEqual([]);
      expect(p.toasts.filter((t) => /GV/.test(t))).toEqual([]);
      expect(p.room.state.players.get(sid)).toMatchObject({ gv: 0, kills: 0, bounty: 0, status: "alive" });
      expect(snapshot(who)).toBe(before);

      // Leaving, and the room going away, change nothing either.
      await leave(p);
      await until(() => !isActive(who), "the profile to be released");
      await until(() => matchMaker.getLocalRoomById(p.room.roomId) === undefined, "the room to be disposed");
      await sleep(100);
      await server.store.flush();
      expect(snapshot(who)).toBe(before);
      const saved = JSON.parse(fs.readFileSync(profileFile, "utf8")).profiles[who.name];
      expect(saved).toEqual(JSON.parse(before));
      expect(saved).toMatchObject({
        gv: 0, gvLifetime: 0, gvByMonth: {}, stats: { runs: 0, wins: 0, draws: 0, deaths: 0, kills: 0 }, achievements: {},
        cosmetics: { owned: [] },
      });
      expect(recordRun).not.toHaveBeenCalled();
      expect(bankGv).not.toHaveBeenCalled();
    });

    it("and the same short timers do teleport an arena run, so the test above could have failed", async () => {
      const [A, B] = [await claim(), await claim()];
      const lead = await createArena(A, 2);
      retime(lead, SHORT);
      await joinArena(lead, B);
      const world = worldOf(lead);
      await until(() => world.state.gatesLocked && world.state.inColiseum, "the arena teleport", 3000);
      expect(world.state.training).toBe(false);
      expect(world.state.suddenDeathAt).toBeGreaterThan(0);
    });

    it("the Room itself refuses to settle a training result, where it settles the same result in an arena room", async () => {
      const [T, B] = [await claim(), await claim()];
      const resultOf = (who: Account): RunResult => ({
        outcome: "won", profile: who.name, durationSec: 5, kills: 3, killedBy: null, place: 1, players: 4,
        gv: { kills: 3 * GV_KILL, mobs: 0, bounty: 0, quest: 0, win: 100, total: 3 * GV_KILL + 100 }, winBonusWithheld: false,
      });
      const recordRun = vi.spyOn(server.store, "recordRun");
      const before = snapshot(T);

      const trainee = await startTraining(T);
      worldOf(trainee).events.push({ type: "resolved", id: sessionOf(trainee), result: resultOf(T) });
      await sleep(200);
      expect(recordRun).not.toHaveBeenCalled();
      expect(trainee.results).toEqual([]);
      expect(snapshot(T)).toBe(before);
      expect(isActive(T)).toBe(true); // and it did not free the profile as a result does

      // The control: the same event in an arena room is banked and sent.
      const raider = await createArena(B);
      worldOf(raider).events.push({ type: "resolved", id: sessionOf(raider), result: resultOf(B) });
      await until(() => raider.results.length === 1, "the arena result");
      expect(recordRun).toHaveBeenCalledTimes(1);
      expect(recordRun.mock.calls[0]![0]).toBe(B.name);
      expect(snapshot(T)).toBe(before);
    });
  });

  describe("hitting the dummies", () => {
    it("each of the rack's five weapons, taken with a pickup input, hits the plain dummy, and the run pays nothing", async () => {
      const who = await claim();
      const before = snapshot(who);
      const p = await startTraining(who);
      const world = worldOf(p);
      const rack = rackIds(p);
      const plain = mobIdNamed(p, "Dummy");
      const dummy = world.mobs.get(plain)!;
      expect([...rack.keys()].sort()).toEqual([...WEAPON_IDS].sort());

      for (const weapon of WEAPON_IDS) {
        await takeFromRack(p, rack, weapon);
        expect(inHand(p)).toBe(weapon);
        const a = standBy(p, plain, isRanged(weapon) ? 90 : 36);
        await sleep(120);
        const hitAt = dummy.lastHitAt;
        await strike(p, a, () => dummy.lastHitAt > hitAt);
        expect(world.state.mobs.get(plain)!.status, `${weapon}: the dummy stands`).toBe("alive");
        await until(() => p.fx.some((f) => f.kind === "hit" && f.id === plain && f.by === sessionOf(p) && f.weapon === weapon), `the client to hear the ${weapon} hit`);
      }

      const sp = serverPlayer(p);
      expect([sp.kills, sp.gv, sp.bounty]).toEqual([0, 0, 0]);
      expect(world.players.get(sessionOf(p))!.gv).toEqual({ kills: 0, mobs: 0, bounty: 0, quest: 0 });
      expect(p.toasts.filter((t) => /GV/.test(t))).toEqual([]);
      expect(p.results).toEqual([]);
      await until(() => p.room.state.players.get(sessionOf(p))?.gv === 0, "the client to see no GV");
      expect(world.state.phase).toBe("active");
      expect(snapshot(who)).toBe(before);
    });

    it("a dummy never dies: a hit worth many times its hp leaves it standing, with no kill, GV or bounty", async () => {
      const p = await startTraining(await claim());
      const world = worldOf(p);
      for (const id of world.state.mobs.keys()) {
        recordHit(world, {
          victim: id, by: { id: sessionOf(p), name: p.who.name }, packet: { raw: DUMMY_HP * 40, phys: 1, magic: 0, true: 0 },
          weapon: "axe", stagger: false,
        });
      }
      await sleep(200);
      for (const m of world.state.mobs.values()) expect(m).toMatchObject({ hp: DUMMY_HP, status: "alive" });
      expect(serverPlayer(p)).toMatchObject({ kills: 0, gv: 0, bounty: 0 });
      expect(p.fx.filter((f) => f.kind === "death")).toEqual([]);
      expect(p.toasts).toEqual([]);
    });

    it("a reflected arrow that downs the player puts them back on their feet at full health, with their weapons, and no result", async () => {
      const who = await claim();
      const before = snapshot(who);
      const p = await startTraining(who, { faction: "sentenced" });
      expect(SIGNATURE_WEAPONS.sentenced).toBe("bow");
      serverPlayer(p).weapon0 = SIGNATURE_WEAPONS.sentenced; // training starts on fists: the bow is taken from the rack in play
      const sid = sessionOf(p);
      const world = worldOf(p);
      const shield = mobIdNamed(p, "Shield dummy");
      serverPlayer(p).hp = 0.01; // any hit that lands downs them
      const a = standBy(p, shield, 90);
      await sleep(120);
      await strike(p, a, () => p.fx.some((f) => f.kind === "death" && f.id === sid));

      await sleep(300);
      const sp = serverPlayer(p);
      expect(sp).toMatchObject({ status: "alive", hp: sp.maxHp, maxHp: FACTIONS.sentenced.hp, weapon0: "bow", weapon1: "", slot: 0 });
      expect(world.state.phase).toBe("active");
      expect(world.arena.downedThisTick).toEqual([]);
      expect(world.players.get(sid)!.resolved).toBe(false);
      expect([...world.state.containers.values()].filter((c) => c.kind === "body")).toEqual([]);
      expect(p.results).toEqual([]);
      expect(p.fx.filter((f) => f.kind === "victory")).toEqual([]);
      const seen = p.room.state.players.get(sid)!;
      expect([seen.status, seen.hp, seen.weapon0]).toEqual(["alive", sp.maxHp, "bow"]);
      expect(isActive(who)).toBe(true);
      expect(snapshot(who)).toBe(before);
    });
  });

  describe("isolation", () => {
    it("an arena joinOrCreate never lands in a training room: strangers share a public lobby of their own", async () => {
      const trainee = await startTraining(await claim());
      const strangers = [await claim(), await claim(), await claim()];
      const landed: Player[] = [];
      for (const who of strangers) {
        const p = track(who, await client.joinOrCreate<RaidState>(ROOM_NAME, joinOptions(who)));
        retime(p, { minPlayers: MAX_PLAYERS, ...LONG });
        landed.push(p);
      }
      for (const p of landed) {
        expect(p.room.roomId).not.toBe(trainee.room.roomId);
        expect(serverRoom(p).training).toBe(false);
        expect(worldOf(p).state).toMatchObject({ training: false, phase: "lobby" });
        expect(serverPlayer(p).status).toBe("lobby");
      }
      expect(new Set(landed.map((p) => p.room.roomId)).size).toBe(1);
      expect(await listingOf(landed[0]!)).toMatchObject({ private: false, locked: false, clients: 3, maxClients: MAX_PLAYERS });

      // The trainee's room is exactly as it was: one client, one player, still private and shut.
      expect(serverRoom(trainee).clients.length).toBe(1);
      expect([...worldOf(trainee).state.players.values()].map((q) => q.name)).toEqual([trainee.who.name]);
      expect(await listingOf(trainee)).toMatchObject({ private: true, locked: true, clients: 1, maxClients: 1 });
    });

    it("nobody else gets into a training room: not by its id, not as a stranger, not as the same profile", async () => {
      const [A, B] = [await claim(), await claim()];
      const trainee = await startTraining(A);
      const id = trainee.room.roomId;
      const beforeB = snapshot(B);

      await expect(client.joinById(id, joinOptions(B))).rejects.toThrow(/is locked/);
      await expect(client.joinById(id, trainingOptions(B, { mode: "training" }))).rejects.toThrow(/is locked/);
      await expect(client.joinById(id, joinOptions(A))).rejects.toThrow(/is locked/);
      expect(isActive(B)).toBe(false);

      expect(worldOf(trainee).state.players.size).toBe(1);
      expect(serverRoom(trainee).clients.length).toBe(1);
      expect(server.profiles.ownerOf(A.name)).toBe(`${id}:${sessionOf(trainee)}`);
      expect(snapshot(B)).toBe(beforeB);
    });

    it("a joinOrCreate for training never joins somebody else's training room: it makes one of its own", async () => {
      const [A, B] = [await claim(), await claim()];
      const first = await startTraining(A);
      const second = track(B, await client.joinOrCreate<RaidState>(TRAINING_ROOM_NAME, joinOptions(B)));
      await until(() => second.room.state.phase === "active", "the run to start");
      expect(second.room.roomId).not.toBe(first.room.roomId);
      for (const [p, who] of [[first, A], [second, B]] as const) {
        expect([...worldOf(p).state.players.values()].map((q) => q.name)).toEqual([who.name]);
        expect(worldOf(p).state.training).toBe(true);
        expect(await listingOf(p)).toMatchObject({ private: true, locked: true, clients: 1, maxClients: 1 });
      }
      expect(serverRoom(first).clients.length).toBe(1);
    });

    it("a joinOrCreate for the arena that passes mode training is an ordinary arena join: the handler's mode wins over the client's", async () => {
      const who = await claim();
      const p = track(who, await client.joinOrCreate<RaidState>(ROOM_NAME, { ...joinOptions(who), mode: "training" }));
      retime(p, { minPlayers: MAX_PLAYERS, ...LONG });
      expect(serverRoom(p).training).toBe(false);
      expect(worldOf(p).state).toMatchObject({ training: false, phase: "lobby" });
      expect(worldOf(p).state.mobs.size).toBe(0);
      expect(serverPlayer(p).status).toBe("lobby");
      expect(await listingOf(p)).toMatchObject({ private: false, locked: false, maxClients: MAX_PLAYERS });
    });

    // What a client might send as its `mode`. The server's handler options are merged over the client's, so none of it matters.
    const MODES = [
      { label: "training", mode: "training" },
      { label: "arena", mode: "arena" },
      { label: "TRAINING", mode: "TRAINING" },
      { label: "Training", mode: "Training" },
      { label: " training", mode: " training" },
      { label: "a number", mode: 1 },
      { label: "true", mode: true },
      { label: "an empty object", mode: {} },
      { label: "null", mode: null },
      { label: "a list holding training", mode: ["training"] },
      { label: "the empty string", mode: "" },
    ];

    it.each(MODES)("a mode of $label sent to the arena handler still makes an ordinary arena lobby", async ({ mode }) => {
      const who = await claim();
      const p = track(who, await client.create<RaidState>(ROOM_NAME, { ...joinOptions(who), mode }));
      retime(p, { minPlayers: MAX_PLAYERS, ...LONG });
      expect(serverRoom(p).training).toBe(false);
      expect(worldOf(p).state).toMatchObject({ training: false, phase: "lobby" });
      expect(worldOf(p).config.training ?? false).toBe(false);
      expect(worldOf(p).config.dummies ?? false).toBe(false);
      expect(worldOf(p).state.mobs.size).toBe(0);
      expect(serverPlayer(p).status).toBe("lobby");
      expect(serverRoom(p).maxClients).toBe(MAX_PLAYERS);
      expect(await listingOf(p)).toMatchObject({ private: false, locked: false, maxClients: MAX_PLAYERS });
    });

    it.each(MODES)("a mode of $label sent to the training handler still makes a private room of one, in training", async ({ mode }) => {
      const p = await startTraining(await claim(), { mode });
      expect(serverRoom(p).training).toBe(true);
      expect(serverRoom(p).maxClients).toBe(1);
      expect(worldOf(p).state).toMatchObject({ training: true, phase: "active", patienceEndsAt: 0 });
      expect(worldOf(p).state.mobs.size).toBe(2);
      expect(await listingOf(p)).toMatchObject({ private: true, locked: true, clients: 1, maxClients: 1 });
      expect(p.room.state.training).toBe(true);
    });

    it("two profiles each get their own training room at the same time, and what one does stays in it", async () => {
      const [A, B] = [await claim(), await claim()];
      const [pa, pb] = await Promise.all([startTraining(A, { faction: "fire" }), startTraining(B, { faction: "frost" })]);
      expect(pa.room.roomId).not.toBe(pb.room.roomId);
      expect(worldOf(pa)).not.toBe(worldOf(pb));
      for (const [p, who, faction] of [[pa, A, "fire"], [pb, B, "frost"]] as const) {
        expect([...worldOf(p).state.players.values()].map((q) => [q.name, q.faction])).toEqual([[who.name, faction]]);
        expect(worldOf(p).state.training).toBe(true);
        expect(await listingOf(p)).toMatchObject({ private: true, locked: true, clients: 1, maxClients: 1 });
      }

      const plain = mobIdNamed(pa, "Dummy");
      const dummy = worldOf(pa).mobs.get(plain)!;
      const a = standBy(pa, plain, 36);
      await sleep(120);
      await strike(pa, a, () => dummy.lastHitAt > 0);
      for (const m of worldOf(pb).mobs.values()) expect(m.lastHitAt).toBe(0);
      expect(pb.fx.filter((f) => f.kind === "hit")).toEqual([]);
    });

    describe("the profile registry spans both kinds of room", () => {
      it("a profile in training cannot also be in an arena lobby, or in a second training room", async () => {
        const A = await claim();
        const trainee = await startTraining(A);
        const owner = `${trainee.room.roomId}:${sessionOf(trainee)}`;
        const before = snapshot(A);
        await expect(client.create(ROOM_NAME, joinOptions(A))).rejects.toThrow(/already in a raid/);
        await expect(client.joinOrCreate(ROOM_NAME, joinOptions(A))).rejects.toThrow(/already in a raid/);
        await expect(client.create(TRAINING_ROOM_NAME, joinOptions(A))).rejects.toThrow(/already in a raid/);
        await expect(client.joinOrCreate(TRAINING_ROOM_NAME, joinOptions(A))).rejects.toThrow(/already in a raid/);
        expect(server.profiles.ownerOf(A.name)).toBe(owner);
        expect(worldOf(trainee).state.players.size).toBe(1);
        expect(snapshot(A)).toBe(before);
      });

      it("a profile in an arena lobby cannot start training", async () => {
        const A = await claim();
        const lobby = await createArena(A);
        const before = snapshot(A);
        await expect(client.create(TRAINING_ROOM_NAME, joinOptions(A))).rejects.toThrow(/already in a raid/);
        await expect(client.joinOrCreate(TRAINING_ROOM_NAME, joinOptions(A))).rejects.toThrow(/already in a raid/);
        expect(server.profiles.ownerOf(A.name)).toBe(`${lobby.room.roomId}:${sessionOf(lobby)}`);
        expect(worldOf(lobby).state.players.size).toBe(1);
        expect(snapshot(A)).toBe(before);
      });

      it("and is free again as soon as it leaves training", async () => {
        const A = await claim();
        const first = await startTraining(A);
        await leave(first);
        await until(() => !isActive(A), "the profile to be released");
        const lobby = await createArena(A); // an arena lobby straight away
        expect(serverPlayer(lobby).status).toBe("lobby");
        await leave(lobby);
        await until(() => !isActive(A), "the profile to be released");
        const again = await startTraining(A); // and training again
        expect(worldOf(again).state.training).toBe(true);
        expect(again.room.roomId).not.toBe(first.room.roomId);
      });
    });
  });

  describe("the arena is unchanged", () => {
    it("a two-player run still resolves and banks while a training room is open on the same server", async () => {
      const [T, A, B] = [await claim(), await claim(), await claim()];
      const trainee = await startTraining(T);
      const trainingBefore = snapshot(T);
      const recordRun = vi.spyOn(server.store, "recordRun");
      const bankGv = vi.spyOn(server.store, "bankGv");

      const a = await createArena(A, 2);
      const b = await joinArena(a, B);
      const world = worldOf(a);
      await until(() => world.state.phase === "active" && serverPlayer(a).status === "alive" && serverPlayer(b).status === "alive", "the run to start");
      expect(world.state).toMatchObject({ training: false, startedWith: 2 });
      expect([...world.state.mobs.values()].filter((m) => m.kind === "dummy")).toEqual([]); // no dummies unless the server config asks for them (the camp mobs are the arena's own)
      expect(world.state.patienceEndsAt).toBeGreaterThan(0);

      await kill(a, b);
      await until(() => a.results.length === 1 && b.results.length === 1, "both results");
      expect(a.results[0]).toMatchObject({ outcome: "won", profile: A.name, kills: 1, gv: { kills: GV_KILL, total: GV_KILL }, winBonusWithheld: true });
      expect(b.results[0]).toMatchObject({ outcome: "died", profile: B.name, killedBy: A.name });
      const stats = (who: Account) => server.store.get(who.name)!;
      expect(stats(A)).toMatchObject({ gv: GV_KILL, gvLifetime: GV_KILL, stats: { runs: 1, wins: 1, draws: 0, deaths: 0, kills: 1 } });
      expect(stats(B)).toMatchObject({ gv: 0, stats: { runs: 1, wins: 0, deaths: 1, kills: 0 } });
      expect(recordRun.mock.calls.map(([name]) => name).sort()).toEqual([A.name, B.name]);
      expect(bankGv).not.toHaveBeenCalled();
      expect(world.state.phase).toBe("ended");

      // The practice room next door did not notice.
      expect(snapshot(T)).toBe(trainingBefore);
      expect(trainee.results).toEqual([]);
      expect(worldOf(trainee).state).toMatchObject({ phase: "active", training: true });
      expect(isActive(T)).toBe(true);
    });
  });

  describe("leaving a training room", () => {
    // Every way a visit can end. The shipped client goes back to the hub with a non-consented close, and a training room
    // holds no seat for it: the profile is free at once, not after the reconnect hold an arena run keeps.
    const WAYS: Array<{ label: string; end: (p: Player) => Promise<unknown> }> = [
      { label: "a consented leave", end: (p) => p.room.leave(true) },
      { label: "a non-consented close (what the client does on its way back to the hub)", end: (p) => p.room.leave(false) },
      { label: "the transport cut from the server side", end: (p) => dropConnection(p) },
    ];

    it.each(WAYS)("$label frees the profile within a second and a half, records nothing and takes the room with it", async ({ end }) => {
      const who = await claim();
      const before = snapshot(who);
      const recordRun = vi.spyOn(server.store, "recordRun");
      const bankGv = vi.spyOn(server.store, "bankGv");
      const p = await startTraining(who);
      const world = worldOf(p);
      const roomId = p.room.roomId;
      const plain = mobIdNamed(p, "Dummy");
      const a = standBy(p, plain, 36);
      await sleep(120);
      await strike(p, a, () => world.mobs.get(plain)!.lastHitAt > 0); // the visit had some content

      await end(p);
      await until(() => !isActive(who), "the profile to be released", 1500);
      expect(world.state.players.size).toBe(0);
      expect(world.players.size).toBe(0);
      await until(() => matchMaker.getLocalRoomById(roomId) === undefined, "the room to be disposed", 3000);
      await sleep(100);
      await server.store.flush();
      expect(snapshot(who)).toBe(before);
      expect(server.store.get(who.name)!.stats).toEqual({ runs: 0, wins: 0, draws: 0, deaths: 0, kills: 0 });
      expect(recordRun).not.toHaveBeenCalled();
      expect(bankGv).not.toHaveBeenCalled();
      expect(JSON.parse(fs.readFileSync(profileFile, "utf8")).profiles[who.name]).toEqual(JSON.parse(before));

      // Straight away: an arena lobby, and training again.
      const lobby = track(who, await client.joinOrCreate<RaidState>(ROOM_NAME, joinOptions(who)));
      retime(lobby, { minPlayers: MAX_PLAYERS, ...LONG });
      expect(worldOf(lobby).state.training).toBe(false);
      expect(serverPlayer(lobby).status).toBe("lobby");
      await leave(lobby);
      await until(() => !isActive(who), "the profile to be released", 1500);
      const again = await startTraining(who);
      expect(again.room.roomId).not.toBe(roomId);
      expect(snapshot(who)).toBe(before);
    });

    it("a cut transport leaves nothing to reconnect to: the SDK's retries find no seat and the player stays gone", async () => {
      const who = await claim();
      const before = snapshot(who);
      const p = await startTraining(who);
      const roomId = p.room.roomId;
      p.room.reconnection.minUptime = 0; // the SDK would retry as soon as it can
      p.room.reconnection.delay = 1;
      p.room.reconnection.minDelay = 1;
      await dropConnection(p);
      await until(() => !isActive(who), "the profile to be released", 1500);
      await sleep(600); // long enough for the SDK to have tried
      expect(matchMaker.getLocalRoomById(roomId)?.clients.length ?? 0).toBe(0);
      expect(isActive(who)).toBe(false);
      expect(snapshot(who)).toBe(before);
    });
  });

  describe("the practice console (`train`)", () => {
    it("a training room applies it: cards, a camp and a chest reach the client's state, the reply toasts come back, and nothing is recorded", async () => {
      const who = await claim();
      const before = snapshot(who);
      const recordRun = vi.spyOn(server.store, "recordRun");
      const bankGv = vi.spyOn(server.store, "bankGv");
      const p = await startTraining(who);
      const myState = () => p.room.state.players.get(sessionOf(p))!;

      p.room.send("train", { cmd: "card", id: "haste2", count: 3 });
      await until(() => myState().build.get("haste2") === 3, "the cards in the client's state");
      await until(() => p.toasts.some((t) => /^Haste II x3: /.test(t)), "the reply toast");
      expect(myState().asMult).toBe(worldOf(p).state.players.get(sessionOf(p))!.asMult);
      expect(myState().asMult).toBeGreaterThan(1000); // the mirror the client reads is folded

      p.room.send("train", { cmd: "card", id: "armor2" });
      await until(() => myState().build.get("armor2") === 1, "the second card in the client's state");

      p.room.send("train", { cmd: "camp", id: "bailiff" });
      await until(() => [...p.room.state.mobs.values()].filter((m) => m.type === "bailiff").length === 3, "a camp of three Bailiffs");

      p.room.send("train", { cmd: "chest", options: ["haste1", "witness"] });
      await until(() => [...p.room.state.containers.values()].some((c) => c.kind === "reward"), "the chest in the client's state");
      const chest = [...p.room.state.containers.values()].find((c) => c.kind === "reward")!;
      expect([...chest.options]).toEqual(["haste1", "witness"]);
      expect(chest.expiresAt).toBeGreaterThan(p.room.state.serverTime);

      p.room.send("train", { cmd: "clear" });
      await until(() => myState().build.size === 0, "the build to be cleared");
      await until(() => [...p.room.state.mobs.values()].every((m) => m.kind === "dummy"), "the practice mobs to be gone");
      await until(() => ![...p.room.state.containers.values()].some((c) => c.kind === "reward"), "the chest to be gone");

      await leave(p);
      await until(() => !isActive(who), "the profile to be released", 2000);
      expect(recordRun).not.toHaveBeenCalled();
      expect(bankGv).not.toHaveBeenCalled();
      expect(snapshot(who)).toBe(before);
    });

    it("a training room's door passes a good message on to the sim and drops a bad one", async () => {
      const p = await startTraining(await claim());
      const handler = vi.fn();
      worldOf(p).actions.train = handler;
      p.room.send("train", { cmd: "card", id: "nope" });
      p.room.send("train", { cmd: "buff", id: "emberImp", amount: 3 });
      p.room.send("train", "clear");
      p.room.send("train", { cmd: "clear" });
      await until(() => handler.mock.calls.length >= 1, "the one good message");
      await sleep(200);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0]![2]).toEqual({ kind: "train", cmd: "clear" });
    });

    it("an arena room never queues it: with a handler installed by hand, a running arena player's message still never reaches it", async () => {
      const p = await createArena(await claim(), 1);
      await until(() => worldOf(p).state.phase === "active" && serverPlayer(p)?.status === "alive", "the arena run to start");
      expect(serverRoom(p).training).toBe(false);
      const handler = vi.fn();
      worldOf(p).actions.train = handler;
      const mobs = worldOf(p).state.mobs.size; // an arena run has its camps' mobs
      const containers = worldOf(p).state.containers.size;
      for (const msg of [{ cmd: "card", id: "armor2", count: 9 }, { cmd: "camp", id: "emberImp" }, { cmd: "chest" }, { cmd: "clear" }]) {
        p.room.send("train", msg);
      }
      await sleep(500);
      expect(handler).not.toHaveBeenCalled();
      expect(serverPlayer(p).build.size).toBe(0);
      expect(worldOf(p).state.mobs.size).toBe(mobs);
      expect(worldOf(p).state.containers.size).toBe(containers);
      expect(p.toasts.filter((text) => !text.startsWith("Quest discovered:"))).toEqual([]);
    });
  });

  describe("the idle limit", () => {
    /** Training rooms read the limit when they are created, so a test sets it before making one. Returns the undo. */
    function idleLimit(seconds: number): () => void {
      const saved = RaidRoom.ctx.config;
      RaidRoom.ctx.config = { ...saved, trainingIdleSeconds: seconds };
      return () => { RaidRoom.ctx.config = saved; };
    }

    it("closes a training room whose player sends nothing, frees the profile and records nothing; an arena lobby next to it stays", async () => {
      const restore = idleLimit(1);
      try {
        const [T, A] = [await claim(), await claim()];
        const before = snapshot(T);
        const recordRun = vi.spyOn(server.store, "recordRun");
        const bankGv = vi.spyOn(server.store, "bankGv");
        const arena = await createArena(A);
        const trainee = await startTraining(T); // and then says nothing
        const roomId = trainee.room.roomId;

        await until(() => trainee.left, "the idle limit to close the room", 6000);
        await until(() => !isActive(T), "the profile to be released", 2000);
        await until(() => matchMaker.getLocalRoomById(roomId) === undefined, "the room to be disposed", 3000);
        expect(snapshot(T)).toBe(before);
        expect(trainee.results).toEqual([]);
        expect(recordRun).not.toHaveBeenCalled();
        expect(bankGv).not.toHaveBeenCalled();

        // The arena player has said just as little for just as long, and is still waiting in the lobby.
        expect(arena.left).toBe(false);
        expect(isActive(A)).toBe(true);
        expect(worldOf(arena).state.players.size).toBe(1);
        expect(worldOf(arena).state.phase).toBe("lobby");

        // And the profile can train again.
        const again = await startTraining(T);
        expect(worldOf(again).state.training).toBe(true);
      } finally {
        restore();
      }
    });

    it("lets a player who keeps sending stay as long as they like, and closes the room once they stop", async () => {
      const restore = idleLimit(1);
      try {
        const who = await claim();
        const p = await startTraining(who);
        for (let i = 0; i < 12; i++) { // 3.6 s: more than three limits
          p.room.send("aim", { a: i / 10 });
          await sleep(300);
          expect(p.left, `still in the room after ${(i + 1) * 0.3} s`).toBe(false);
        }
        expect(isActive(who)).toBe(true);
        expect(worldOf(p).state.phase).toBe("active");
        await until(() => p.left, "the room to close once the player stopped", 6000);
        await until(() => !isActive(who), "the profile to be released", 2000);
      } finally {
        restore();
      }
    });

    it("does not count a message the server rejects as activity: a player who only sends junk is let go like one who sends nothing", async () => {
      const restore = idleLimit(1);
      try {
        const who = await claim();
        const p = await startTraining(who);
        // One of every kind the Room listens for ("stop" has nothing to get wrong), each failing its own check.
        const junk: Array<[string, unknown]> = [
          ["move", { x: "nope", y: 1 }], ["move", null], ["aim", { a: Infinity }], ["aim", {}], ["attack", { a: "up" }],
          ["release", null], ["swap", { slot: 7 }], ["pickup", { containerId: "" }], ["pickup", { containerId: "x".repeat(65) }],
        ];
        // Longer than the limit plus the room's check interval (1 s for a 1 s limit): the junk must not hold the room open.
        const deadline = Date.now() + 6000;
        while (!p.left && Date.now() < deadline) {
          for (const [type, msg] of junk) p.room.send(type, msg);
          await sleep(100);
        }
        expect(p.left, "the room to close although junk kept arriving").toBe(true);
        await until(() => !isActive(who), "the profile to be released", 2000);
      } finally {
        restore();
      }
    });

    it("counts an accepted `train` as presence and a refused one as nothing", async () => {
      const restore = idleLimit(1);
      try {
        const who = await claim();
        const p = await startTraining(who);
        for (let i = 0; i < 9; i++) { // 2.7 s: more than two limits, kept open by the console alone
          p.room.send("train", { cmd: "clear" });
          await sleep(300);
          expect(p.left, `still in the room after ${(i + 1) * 0.3} s`).toBe(false);
        }
        // Now only refused ones: the room closes as if the player had gone quiet.
        const junk: unknown[] = [{ cmd: "card", id: "nope" }, { cmd: "buff", id: "emberImp" }, { cmd: "camp" }, {}, null, "clear"];
        const deadline = Date.now() + 6000;
        while (!p.left && Date.now() < deadline) {
          for (const msg of junk) p.room.send("train", msg);
          await sleep(100);
        }
        expect(p.left, "the room to close although refused console messages kept arriving").toBe(true);
        await until(() => !isActive(who), "the profile to be released", 2000);
      } finally {
        restore();
      }
    });

    it("is far longer by default than a test lasts: a quiet training room is left alone", async () => {
      const who = await claim();
      const p = await startTraining(who);
      await sleep(1500);
      expect(p.left).toBe(false);
      expect(isActive(who)).toBe(true);
      expect(RaidRoom.ctx.config.trainingIdleSeconds).toBeGreaterThan(60);
    });
  });

  describe("a down outside a tick (the sim's between-ticks path)", () => {
    it("emits a result the Room ignores: nothing recorded, no result sent, and the player is back on their feet", async () => {
      const who = await claim();
      const before = snapshot(who);
      const recordRun = vi.spyOn(server.store, "recordRun");
      const bankGv = vi.spyOn(server.store, "bankGv");
      const p = await startTraining(who, { faction: "sentenced" });
      const world = worldOf(p);
      const sp = serverPlayer(p);
      sp.weapon0 = SIGNATURE_WEAPONS.sentenced; // training starts on fists: it carries a bow for the revive to keep
      const rt = world.players.get(sessionOf(p))!;

      // JavaScript runs this to the end before the next tick, so this really is between two ticks.
      applyDamage(world, sp, rt, 1e9, "test");
      expect(sp.status).toBe("dead");
      expect(world.events.some((e) => e.type === "resolved"), "the sim did resolve the run").toBe(true);

      await until(() => sp.status === "alive", "the player to be stood up");
      expect(sp.hp).toBe(sp.maxHp);
      expect([sp.weapon0, sp.weapon1]).toEqual(["bow", ""]);
      expect(rt.resolved).toBe(false);
      await until(() => p.room.state.players.get(sessionOf(p))?.status === "alive", "the client to see them up");
      await sleep(200);
      expect(recordRun).not.toHaveBeenCalled();
      expect(bankGv).not.toHaveBeenCalled();
      expect(p.results).toEqual([]);
      expect(isActive(who)).toBe(true);
      expect(world.state.phase).toBe("active");
      expect(snapshot(who)).toBe(before);
    });

    it("a player removed from the world mid-run (MIA) is simply gone: the same event is ignored, and leaving afterwards is quiet", async () => {
      const who = await claim();
      const before = snapshot(who);
      const recordRun = vi.spyOn(server.store, "recordRun");
      const p = await startTraining(who);
      const world = worldOf(p);
      const sid = sessionOf(p);

      removePlayer(world, sid);
      expect(world.events.some((e) => e.type === "resolved")).toBe(true);
      await sleep(250);
      expect(world.state.players.size).toBe(0); // not revived
      expect(world.state.phase).toBe("active");
      expect(recordRun).not.toHaveBeenCalled();
      expect(p.results).toEqual([]);
      expect(snapshot(who)).toBe(before);

      await leave(p);
      await until(() => !isActive(who), "the profile to be released", 1500);
      expect(recordRun).not.toHaveBeenCalled();
      expect(snapshot(who)).toBe(before);
    });
  });

  describe("a training join needs the same credentials as an arena join", () => {
    interface Case { label: string; options: (me: Account, other: Account) => object; message: RegExp }
    const cases: Case[] = [
      { label: "no token", options: (me) => ({ profile: me.name }), message: /unknown profile or bad token/ },
      { label: "a wrong token", options: (me) => ({ profile: me.name, token: "nope" }), message: /unknown profile or bad token/ },
      { label: "an empty token", options: (me) => ({ profile: me.name, token: "" }), message: /unknown profile or bad token/ },
      { label: "a numeric token", options: (me) => ({ profile: me.name, token: 123 }), message: /unknown profile or bad token/ },
      { label: "another profile's token", options: (me, other) => ({ profile: me.name, token: other.token }), message: /unknown profile or bad token/ },
      { label: "a profile nobody claimed", options: (me) => ({ profile: `${me.name}zz`, token: me.token }), message: /unknown profile or bad token/ },
      { label: "no profile", options: (me) => ({ token: me.token }), message: /invalid profile name/ },
      { label: "a malformed profile name", options: (me) => ({ profile: "no good!", token: me.token }), message: /invalid profile name/ },
      { label: "a non-string profile", options: (me) => ({ profile: 42, token: me.token }), message: /invalid profile name/ },
    ];

    it.each(cases)("$label: refused as an arena join is, with no room created and nothing held", async ({ options, message }) => {
      const me = await claim();
      const other = await claim();
      const [meBefore, otherBefore] = [snapshot(me), snapshot(other)];
      const before = await allRooms();
      const bad = options(me, other);

      await expect(client.create(TRAINING_ROOM_NAME, bad)).rejects.toThrow(message);
      await expect(client.joinOrCreate(TRAINING_ROOM_NAME, bad)).rejects.toThrow(message);
      await expect(client.create(ROOM_NAME, bad)).rejects.toThrow(message); // the arena join, for comparison
      expect(await allRooms()).toEqual(before);
      expect(server.profiles.size).toBe(0);
      expect([snapshot(me), snapshot(other)]).toEqual([meBefore, otherBefore]);

      // Nothing was left half done: the legitimate training join works straight afterwards.
      const p = await startTraining(me);
      expect(worldOf(p).state.training).toBe(true);
    });

    it("over plain HTTP too: no room and no seat for an anonymous or bad-token request to the training route", async () => {
      const before = await allRooms();
      for (const body of [{}, { mode: "training" }, { profile: "nobody1", token: "x" }]) {
        for (const method of ["joinOrCreate", "create"]) {
          const res = await fetch(url(`/matchmake/${method}/${TRAINING_ROOM_NAME}`), {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
          });
          expect(res.ok, `${method} ${JSON.stringify(body)}`).toBe(false);
        }
      }
      expect(await allRooms()).toEqual(before);
      expect(server.profiles.size).toBe(0);
    });
  });

  // Last: Colyseus' matchmaker is a process-wide singleton, so the server cannot come back after stop().
  describe("a graceful server stop", () => {
    it("banks nothing for a player in training, where it pays an arena player's earnings", async () => {
      const [T, A, B, C] = [await claim(), await claim(), await claim(), await claim()];
      const trainee = await startTraining(T);
      // Not reachable in play: run GV a training player does not have, so that banking it would show.
      worldOf(trainee).players.get(sessionOf(trainee))!.gv.kills = 7;
      serverPlayer(trainee).gv = 7;

      const lead = await createArena(A, 3);
      const rest = [await joinArena(lead, B), await joinArena(lead, C)];
      await until(() => worldOf(lead).state.phase === "active" && [lead, ...rest].every((q) => serverPlayer(q).status === "alive"), "the run to start");
      await kill(lead, rest[0]!);
      await until(() => rest[0]!.results.length === 1, "B's result");
      expect(serverPlayer(lead).gv).toBe(GV_KILL); // A's, still in the run

      for (const q of players) q.room.reconnection.enabled = false; // the server is about to go away for good
      await server.store.flush();
      const trainedBefore = snapshot(T);
      const recordRun = vi.spyOn(server.store, "recordRun");
      const bankGv = vi.spyOn(server.store, "bankGv");
      stopped = true;
      await server.stop();

      expect(bankGv.mock.calls.map(([name, gv]) => [name, gv])).toEqual([[A.name, GV_KILL]]);
      expect(recordRun).not.toHaveBeenCalled();
      expect(snapshot(T)).toBe(trainedBefore);
      const disk = JSON.parse(fs.readFileSync(profileFile, "utf8")).profiles as Record<string, unknown>;
      expect(disk[T.name]).toEqual(JSON.parse(trainedBefore));
      expect(disk[A.name]).toMatchObject({ gv: GV_KILL, stats: { runs: 0, kills: 0 } }); // a void run: paid, not counted
      expect(server.profiles.size).toBe(0);
    });
  });
});

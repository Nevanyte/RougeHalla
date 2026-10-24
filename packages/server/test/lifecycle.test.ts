import { describe, expect, it } from "vitest";
import {
  AIM_STALE_MS, FACTION_IDS, FACTIONS, generateMap, GV_WIN, isWallAt, MAX_PLAYERS, MAX_REWIND_MS, mulberry32, PLAYER_RADIUS,
  PLAYER_SPEED, SIGNATURE_WEAPONS, TICK_MS, TILE_FLOOR, TILE_WALL, WORLD_H, WORLD_W, wrapAngle, type Vec2, type WeaponId,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { applyDamage, downPlayer } from "../src/sim/arena";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage, MAX_ACTIONS_PER_TICK } from "../src/sim/inputs";
import { recordHit } from "../src/sim/ledger";
import { planPath, positionAt } from "../src/sim/movement";
import { abandonPlayer, actionOrder, addPlayer, removePlayer, step } from "../src/sim/step";
import { createWorld, emit, newWeaponRuntime, type SimConfig, type SimEvent, type World } from "../src/sim/world";

type EventOf<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;

const TICKS_PER_SEC = 1000 / TICK_MS;
/** The farthest a player can move in one fixed step. */
const STEP = PLAYER_SPEED * (TICK_MS / 1000);

/**
 * fillSeconds defaults to 0 here: the raid then starts on the first step after minPlayers have joined,
 * which is what most tests want. The lobby-fill tests set their own value. The patience timer is set far beyond
 * anything these tests run, so nobody gets teleported unless a test asks for it (arena.test.ts covers that).
 */
function makeConfig(cfg: Partial<SimConfig> = {}): SimConfig {
  // Flat unless a test sets patienceMinSeconds, so the timer keeps the length the test names (arena.test.ts covers scaling).
  const patienceSeconds = cfg.patienceSeconds ?? 3600;
  return {
    minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds, patienceMinSeconds: patienceSeconds,
    suddenDeathSeconds: 60, ...cfg,
  };
}

/** Every world gets its own fresh, seeded `random`, so two calls with the same arguments are identical. */
function makeWorld(cfg: Partial<SimConfig> = {}, seed = 1234, random = mulberry32(seed + 1)): World {
  return createWorld({ seed, config: makeConfig(cfg), random });
}

/** addPlayer hands out the faction's signature weapon; tests that care what a player carries swap it for these. */
function arm(p: PlayerState, w0: WeaponId | "", w1: WeaponId | "" = ""): void {
  p.weapon0 = w0;
  p.weapon1 = w1;
}

/** The `attack` action takes the acting player out of the fight, standing in for a lethal blow. */
function downOnAttack(world: World): void {
  world.actions.attack = (w, c) => { if (c.kind === "player") downPlayer(w, c.s, c.rt, "died"); };
}

function run(world: World, ticks: number): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) all.push(...step(world, TICK_MS));
  return all;
}

function ofType<T extends SimEvent["type"]>(events: SimEvent[], type: T): Array<EventOf<T>> {
  return events.filter((e): e is EventOf<T> => e.type === type);
}

/** One solo player in a world whose raid starts on the first step. Returns the world after that step. */
function activeSolo(cfg: Partial<SimConfig> = {}) {
  const world = makeWorld({ minPlayers: 1, ...cfg });
  const p = addPlayer(world, "a", "alice");
  const events = step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  return { world, p, rt: world.players.get("a")!, startEvents: events };
}

/** Two players, `a` and `b`, in a raid that started on the first step. */
function activePair(cfg: Partial<SimConfig> = {}) {
  const world = makeWorld({ minPlayers: 2, ...cfg });
  const a = addPlayer(world, "a", "alice");
  const b = addPlayer(world, "b", "bob");
  const startEvents = step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  return { world, a, b, rtA: world.players.get("a")!, rtB: world.players.get("b")!, startEvents };
}

/** Three players: one can go down and the run goes on. */
function activeTrio(cfg: Partial<SimConfig> = {}) {
  const world = makeWorld({ minPlayers: 3, ...cfg });
  const a = addPlayer(world, "a", "alice");
  const b = addPlayer(world, "b", "bob");
  const c = addPlayer(world, "c", "carol");
  const startEvents = step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  return {
    world, a, b, c, rtA: world.players.get("a")!, rtB: world.players.get("b")!, rtC: world.players.get("c")!, startEvents,
  };
}

const player = (world: World, id: string) => world.state.players.get(id)!;
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const posOf = (p: Vec2): Vec2 => ({ x: p.x, y: p.y });

function pathLength(from: Vec2, wps: Vec2[]): number {
  return wps.reduce((acc, w, i) => acc + dist(i === 0 ? from : wps[i - 1]!, w), 0);
}

/** Where a walker is after covering `d` units along from -> wps[0] -> wps[1] ... */
function pointAlong(from: Vec2, wps: Vec2[], d: number): Vec2 {
  let prev = from;
  for (const w of wps) {
    const seg = dist(prev, w);
    if (d <= seg) {
      const k = seg === 0 ? 0 : d / seg;
      return { x: prev.x + (w.x - prev.x) * k, y: prev.y + (w.y - prev.y) * k };
    }
    d -= seg;
    prev = w;
  }
  return { x: prev.x, y: prev.y };
}

/** The map spawn farthest from `from`, so the walk there is long and winding. */
function farthestSpawn(world: World, from: Vec2): Vec2 {
  return world.map.spawns.reduce((best, s) => (dist(s, from) > dist(best, from) ? s : best));
}

/** The map spawn closest to `from` that is not `from` itself. */
function nearestOtherSpawn(world: World, from: Vec2): Vec2 {
  const others = world.map.spawns.filter((s) => dist(s, from) > 1);
  return others.reduce((best, s) => (dist(s, from) < dist(best, from) ? s : best));
}

/** One step of an active raid, asserting the movement invariants for every player. */
function stepChecked(world: World): SimEvent[] {
  const before = new Map<string, Vec2>();
  for (const [id, p] of world.state.players) before.set(id, posOf(p));
  const events = step(world, TICK_MS);
  for (const [id, p] of world.state.players) {
    expect(dist(before.get(id)!, p)).toBeLessThanOrEqual(STEP + 1e-6);
    expect(isWallAt(world.map, p.x, p.y)).toBe(false);
  }
  return events;
}

function walk(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepChecked(world);
}

describe("createWorld / addPlayer", () => {
  it("starts in an empty lobby at time zero", () => {
    const w = makeWorld({ minPlayers: 3 }, -1);
    expect(w.state.phase).toBe("lobby");
    expect(w.state.serverTime).toBe(0);
    expect(w.state.tick).toBe(0);
    expect(w.state.minPlayers).toBe(3);
    expect(w.state.seed).toBe(0xffffffff); // seed is coerced to uint32
    expect(w.state.players.size).toBe(0);
    expect(w.players.size).toBe(0);
    expect(w.events).toEqual([]);
  });

  it("starts with the arena idle: no timer, no gates, no winner", () => {
    const w = makeWorld();
    expect(w.state).toMatchObject({
      patienceEndsAt: 0, inColiseum: false, gatesLocked: false, suddenDeathAt: 0, winner: "", startedWith: 0,
    });
    expect(w.arena).toEqual({ startedWith: 0, downedThisTick: [], downsBetweenTicks: 0, voided: false });
  });

  it("generates the map from the (coerced) state seed, exactly as clients do", () => {
    for (const seed of [1234, 7, -1]) {
      const w = makeWorld({}, seed);
      expect(w.map.seed).toBe(w.state.seed);
      expect(w.map).toEqual(generateMap(w.state.seed));
    }
  });

  it("registers synced state and server-only runtime for a joining player", () => {
    const w = makeWorld();
    const p = addPlayer(w, "a", "alice");
    expect(player(w, "a")).toBe(p);
    expect(p).toMatchObject({
      name: "alice", faction: "fire", hp: FACTIONS.fire.hp, maxHp: FACTIONS.fire.hp, status: "lobby",
      weapon0: SIGNATURE_WEAPONS.fire, weapon1: "", slot: 0, drawStartedAt: 0, readyAt: 0,
      kills: 0, gv: 0, bounty: 0, immuneUntil: 0,
    });
    const rt = w.players.get("a")!;
    expect(rt).toMatchObject({
      id: "a", profile: "alice", path: [], history: [], resolved: false, killedBy: null,
      gv: { kills: 0, mobs: 0, bounty: 0 }, mobKills: 0, lastHit: null, hpFracAtTickStart: 1, down: null,
    });
    expect(rt.weapon).toEqual(newWeaponRuntime());
  });

  it("gives each joiner the next faction in join order, with its hp and its signature weapon in the first slot", () => {
    const w = makeWorld();
    const joined = Array.from({ length: FACTION_IDS.length + 2 }, (_, i) => addPlayer(w, `p${i}`, `p${i}`));
    joined.forEach((p, i) => {
      const faction = FACTION_IDS[i % FACTION_IDS.length]!;
      expect(p).toMatchObject({
        faction, hp: FACTIONS[faction].hp, maxHp: FACTIONS[faction].hp, weapon0: SIGNATURE_WEAPONS[faction], weapon1: "", slot: 0,
      });
    });
    expect(joined.slice(0, 5).map((p) => p.faction)).toEqual(["fire", "sentenced", "plague", "frost", "holy"]);
    expect(joined.slice(0, 5).map((p) => p.hp)).toEqual([500, 700, 1000, 1750, 1450]);
    expect(joined.slice(0, 5).map((p) => p.weapon0)).toEqual(["axe", "bow", "bow", "shield", "wand"]);
  });

  it("brings nothing in: there is no inventory, only the weapon slots", () => {
    const w = makeWorld();
    const p = addPlayer(w, "a", "alice");
    expect("inventory" in p).toBe(false);
    expect([p.weapon0, p.weapon1].filter((x) => x !== "")).toEqual([SIGNATURE_WEAPONS.fire]);
  });

  it("follows the join counter, not the seats: a leave does not hand the next joiner the freed faction", () => {
    const w = makeWorld({ minPlayers: 5, lobbySeconds: 1000 });
    addPlayer(w, "a", "alice");
    addPlayer(w, "b", "bob");
    removePlayer(w, "a");
    expect(addPlayer(w, "c", "carol").faction).toBe("plague");
  });

  it("mints item uids from the world's counter when it has one, and unique ones when it doesn't", () => {
    let n = 0;
    const counted = createWorld({ seed: 1234, config: makeConfig(), random: mulberry32(1), newItemUid: () => `U${++n}` });
    expect([counted.newItemUid(), counted.newItemUid()]).toEqual(["U1", "U2"]);
    const plain = makeWorld();
    const uids = Array.from({ length: 3 }, () => plain.newItemUid());
    expect(new Set(uids).size).toBe(3);
  });

  it("places lobby players on the map's spawns in join order", () => {
    const w = makeWorld();
    const { spawns } = w.map;
    const a = addPlayer(w, "a", "alice");
    const b = addPlayer(w, "b", "bob");
    const c = addPlayer(w, "c", "carol");
    expect(posOf(a)).toEqual(spawns[0]);
    expect(posOf(b)).toEqual(spawns[1]);
    expect(posOf(c)).toEqual(spawns[2]);
    for (const p of [a, b, c]) expect(isWallAt(w.map, p.x, p.y)).toBe(false);
  });

  it("wraps around the spawn list when there are more players than spawns", () => {
    const w = makeWorld();
    const n = w.map.spawns.length;
    const players = Array.from({ length: n + 2 }, (_, i) => addPlayer(w, `p${i}`, `p${i}`));
    expect(posOf(players[n]!)).toEqual(w.map.spawns[0]);
    expect(posOf(players[n + 1]!)).toEqual(w.map.spawns[1]);
  });

  it("arms the lobby timer when the first player joins, and only then", () => {
    const w = makeWorld({ lobbySeconds: 10, minPlayers: 5 });
    run(w, 4); // empty lobby ticks: serverTime = 200
    addPlayer(w, "a", "alice");
    expect(w.state.lobbyEndsAt).toBe(200 + 10_000);
    run(w, 4);
    addPlayer(w, "b", "bob");
    expect(w.state.lobbyEndsAt).toBe(200 + 10_000);
  });

  it("re-arms the lobby timer if the lobby empties and someone joins again", () => {
    const w = makeWorld({ lobbySeconds: 10, minPlayers: 5 });
    addPlayer(w, "a", "alice");
    run(w, 10);
    removePlayer(w, "a");
    expect(w.state.players.size).toBe(0);
    addPlayer(w, "b", "bob");
    expect(w.state.lobbyEndsAt).toBe(w.state.serverTime + 10_000);
  });
});

describe("per-world registries", () => {
  it("createWorld starts with empty action and system registries and a default dropBody hook", () => {
    const w = makeWorld();
    expect(w.actions).toEqual({});
    expect(w.systems).toEqual([]);
    expect(typeof w.hooks.dropBody).toBe("function");
    expect(w.hooks.teleported).toBeUndefined();
  });

  it("handlers, systems and hooks registered on one world never leak into another", () => {
    const w1 = makeWorld({ minPlayers: 1 });
    const w2 = makeWorld({ minPlayers: 1 });
    expect(w1.actions).not.toBe(w2.actions);
    expect(w1.systems).not.toBe(w2.systems);
    expect(w1.hooks).not.toBe(w2.hooks);
    expect(w1.arena).not.toBe(w2.arena);

    const calls: string[] = [];
    w1.actions.swap = () => { calls.push("w1 swap"); };
    w1.systems.push(() => { calls.push("w1 system"); });

    for (const w of [w1, w2]) {
      addPlayer(w, "a", "alice");
      step(w, TICK_MS);
      enqueueClientMessage(w.players.get("a")!.inputs, "swap", {});
    }
    run(w2, 3); // the untouched world: no handler, no system
    expect(calls).toEqual([]);
    expect(w2.systems).toEqual([]);

    step(w1, TICK_MS);
    expect(calls).toEqual(["w1 swap", "w1 system"]);
    expect(w2.actions).toEqual({});
  });

  it("two raids can run side by side without sharing hooks or handlers", () => {
    const downed: string[] = [];
    const w1 = makeWorld();
    const w2 = makeWorld();
    w1.hooks.dropBody = (_w, p) => { downed.push(`w1:${p.name}`); };
    const alices = [w1, w2].map((w) => {
      const a = addPlayer(w, "a", "alice");
      addPlayer(w, "b", "bob");
      step(w, TICK_MS);
      return a;
    });
    downPlayer(w1, alices[0]!, w1.players.get("a")!, "died");
    downPlayer(w2, alices[1]!, w2.players.get("a")!, "died");
    expect(downed).toEqual(["w1:alice"]);
    expect(alices[0]!.weapon0).toBe(SIGNATURE_WEAPONS.fire); // w1's hook replaced the default, which clears the slots
    expect(alices[1]!.weapon0).toBe(""); // w2 still uses the default
  });
});

describe("createGameWorld", () => {
  const opts = () => ({ seed: 99, config: makeConfig({ minPlayers: 1 }), random: mulberry32(5) });

  it("builds a normal lobby world from the same options as createWorld", () => {
    const g = createGameWorld(opts());
    const base = createWorld(opts());
    expect(g.state.phase).toBe("lobby");
    expect(g.state.seed).toBe(99);
    expect(g.state.minPlayers).toBe(1);
    expect(g.map).toEqual(base.map);
    expect(g.config).toEqual(base.config);
    expect(g.players.size).toBe(0);
    expect(typeof g.hooks.dropBody).toBe("function");
  });

  it("gives every world its own registries, whatever gameplay modules install into them", () => {
    const g1 = createGameWorld(opts());
    const g2 = createGameWorld(opts());
    expect(g1.actions).not.toBe(g2.actions);
    expect(g1.systems).not.toBe(g2.systems);
    expect(g1.hooks).not.toBe(g2.hooks);
    const baseline = g2.systems.length;
    g1.systems.push(() => {});
    g1.actions.swap = () => {};
    expect(g2.systems).toHaveLength(baseline);
    expect(g2.actions.swap).not.toBe(g1.actions.swap);
  });

  it("installs a handler for every action a client can send", () => {
    const g = createGameWorld(opts());
    expect(Object.keys(g.actions).sort()).toEqual(["attack", "pickup", "release", "swap"]);
  });

  it("runs a whole run through the shared lifecycle: a kill ends it with a winner", () => {
    const g = createGameWorld({ seed: 99, config: makeConfig(), random: mulberry32(5) });
    const a = addPlayer(g, "a", "alice");
    const b = addPlayer(g, "b", "bob");
    const events = step(g, TICK_MS);
    // Alice (a bow in hand, so no swing needs a target in reach) stands on Bob: her arrow meets him wherever the map put them.
    arm(a, "bow");
    b.x = a.x;
    b.y = a.y;
    g.players.get("b")!.history = [];
    b.hp = 10;
    const inputs = g.players.get("a")!.inputs;
    enqueueClientMessage(inputs, "attack", { a: 0 });
    enqueueClientMessage(inputs, "release", { a: 0 });
    // Draw to the minimum, loose, fly one tick, land: a handful of ticks.
    for (let i = 0; i < 20 && g.state.phase === "active"; i++) events.push(...step(g, TICK_MS));
    expect(ofType(events, "raidStarted")).toHaveLength(1);
    expect(ofType(events, "raidEnded")).toHaveLength(1);
    expect(g.state.phase).toBe("ended");
    expect(g.state.winner).toBe("alice");
    expect(b.status).toBe("dead");
    expect(a.status).toBe("alive");
    expect(ofType(events, "resolved").map((e) => [e.id, e.result.outcome])).toEqual([["b", "died"], ["a", "won"]]);
    // The loot module is installed: Bob's body holds the weapon he carried.
    const bodies = [...g.state.containers.values()].filter((c) => c.kind === "body");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.label).toBe("bob");
    expect(bodies[0]!.items.map((i) => i.def)).toEqual([SIGNATURE_WEAPONS.sentenced]);
    expect([b.weapon0, b.weapon1]).toEqual(["", ""]);
  });
});

describe("lobby phase", () => {
  it("waits while fewer than minPlayers are present", () => {
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 1000 });
    addPlayer(w, "a", "alice");
    const events = run(w, 50);
    expect(events).toEqual([]);
    expect(w.state.phase).toBe("lobby");
    expect(player(w, "a").status).toBe("lobby");
  });

  it("with fillSeconds 0, starts on the first step after minPlayers have joined", () => {
    const w = makeWorld({ minPlayers: 2, patienceSeconds: 100, fillSeconds: 0 });
    addPlayer(w, "a", "alice");
    expect(run(w, 5)).toEqual([]);
    addPlayer(w, "b", "bob");
    expect(w.state.phase).toBe("lobby"); // joining alone never starts it; only step() does
    const events = step(w, TICK_MS);
    expect(events).toEqual([{ type: "raidStarted" }]);
    expect(w.state.phase).toBe("active");
    expect(w.state.raidStartedAt).toBe(w.state.serverTime);
    expect(w.state.patienceEndsAt).toBe(w.state.serverTime + 100_000);
    expect(player(w, "a").status).toBe("alive");
    expect(player(w, "b").status).toBe("alive");
  });

  it("emits raidStarted exactly once", () => {
    const { world, startEvents } = activeSolo();
    expect(ofType(startEvents, "raidStarted")).toHaveLength(1);
    expect(ofType(run(world, 100), "raidStarted")).toHaveLength(0);
  });

  it("starts after lobbySeconds with a single player (below minPlayers)", () => {
    const lobbySeconds = 3;
    const w = makeWorld({ minPlayers: 2, lobbySeconds });
    addPlayer(w, "a", "alice");
    const lobbyTicks = lobbySeconds * TICKS_PER_SEC;
    expect(run(w, lobbyTicks - 1)).toEqual([]);
    expect(w.state.phase).toBe("lobby");
    expect(w.state.serverTime).toBe(lobbySeconds * 1000 - TICK_MS);
    expect(step(w, TICK_MS)).toEqual([{ type: "raidStarted" }]);
    expect(w.state.phase).toBe("active");
    expect(w.state.serverTime).toBe(lobbySeconds * 1000);
    expect(player(w, "a").status).toBe("alive");
  });

  it("a second joiner does not extend the lobby timer", () => {
    const w = makeWorld({ minPlayers: 3, lobbySeconds: 2 });
    addPlayer(w, "a", "alice");
    run(w, 20);
    addPlayer(w, "b", "bob"); // 1s in; timer must still end at 2s
    run(w, 19);
    expect(w.state.phase).toBe("lobby");
    step(w, TICK_MS);
    expect(w.state.phase).toBe("active");
  });

  it("never starts an empty lobby, however long it idles", () => {
    const w = makeWorld({ minPlayers: 1, lobbySeconds: 1 });
    expect(run(w, 200)).toEqual([]);
    expect(w.state.phase).toBe("lobby");
    expect(w.state.serverTime).toBe(200 * TICK_MS);
  });

  it("drains and ignores inputs while in the lobby", () => {
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 1000 });
    const p = addPlayer(w, "a", "alice");
    const rt = w.players.get("a")!;
    const { x, y, facing } = p;
    const target = w.map.groundSpots[0]!;
    expect(enqueueClientMessage(rt.inputs, "move", target)).toBe(true);
    expect(enqueueClientMessage(rt.inputs, "aim", { a: 1 })).toBe(true);
    enqueueClientMessage(rt.inputs, "swap", {});
    step(w, TICK_MS);
    expect(rt.inputs.move).toBeNull();
    expect(rt.inputs.aim).toBeNull();
    expect(rt.inputs.actions).toEqual([]);
    expect(rt.path).toEqual([]);
    expect([p.x, p.y, p.facing]).toEqual([x, y, facing]);
  });

  it("does not carry lobby-era inputs into the raid", () => {
    const w = makeWorld({ minPlayers: 1 });
    const p = addPlayer(w, "a", "alice");
    const rt = w.players.get("a")!;
    enqueueClientMessage(rt.inputs, "move", w.map.groundSpots[0]!);
    enqueueClientMessage(rt.inputs, "aim", { a: 1 });
    step(w, TICK_MS); // lobby -> active
    const { x, y, facing } = p;
    run(w, 5);
    expect([p.x, p.y, p.facing]).toEqual([x, y, facing]);
    expect(rt.path).toEqual([]);
    expect(rt.weapon.aimAt).toBe(0); // never aimed: the lobby aim was dropped
  });

  it("does not run action handlers or systems during the lobby", () => {
    let calls = 0;
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 1000 });
    w.actions.swap = () => { calls++; };
    w.systems.push(() => { calls++; });
    addPlayer(w, "a", "alice");
    enqueueClientMessage(w.players.get("a")!.inputs, "swap", {});
    run(w, 5);
    expect(calls).toBe(0);
  });
});

describe("lobby fill window (fillSeconds)", () => {
  const fillWorld = (cfg: Partial<SimConfig> = {}) =>
    makeWorld({ minPlayers: 2, lobbySeconds: 15, fillSeconds: 5, ...cfg });

  it("does not start on the tick minPlayers is reached; it waits fillSeconds first", () => {
    const w = fillWorld();
    addPlayer(w, "a", "alice");
    run(w, 5);
    addPlayer(w, "b", "bob"); // minPlayers reached between steps
    expect(step(w, TICK_MS)).toEqual([]);
    expect(w.state.phase).toBe("lobby");
    const deadline = w.state.serverTime + 5000;
    expect(w.state.lobbyEndsAt).toBe(deadline);

    while (w.state.serverTime < deadline - TICK_MS) expect(step(w, TICK_MS)).toEqual([]);
    expect(w.state.phase).toBe("lobby");
    expect(step(w, TICK_MS)).toEqual([{ type: "raidStarted" }]); // serverTime >= lobbyEndsAt
    expect(w.state.serverTime).toBe(deadline);
    expect(w.state.raidStartedAt).toBe(deadline);
    expect(w.state.phase).toBe("active");
  });

  it("pulls lobbyEndsAt in to serverTime + fillSeconds when that is sooner", () => {
    const w = fillWorld({ lobbySeconds: 60, fillSeconds: 2 });
    addPlayer(w, "a", "alice");
    expect(w.state.lobbyEndsAt).toBe(60_000);
    run(w, 10);
    expect(w.state.lobbyEndsAt).toBe(60_000); // one player: below minPlayers, nothing changes
    addPlayer(w, "b", "bob");
    step(w, TICK_MS);
    expect(w.state.lobbyEndsAt).toBe(w.state.serverTime + 2000);
  });

  it("never pushes lobbyEndsAt later than the normal lobby timer", () => {
    const w = fillWorld({ lobbySeconds: 2, fillSeconds: 5 });
    addPlayer(w, "a", "alice");
    addPlayer(w, "b", "bob");
    run(w, 10);
    expect(w.state.lobbyEndsAt).toBe(2000);
    expect(run(w, 29)).toEqual([]); // up to serverTime 1950
    expect(step(w, TICK_MS)).toEqual([{ type: "raidStarted" }]);
    expect(w.state.serverTime).toBe(2000);
  });

  it("leaves the normal timer alone while fewer than minPlayers are present", () => {
    const w = fillWorld({ minPlayers: 3, lobbySeconds: 15, fillSeconds: 1 });
    addPlayer(w, "a", "alice");
    addPlayer(w, "b", "bob");
    expect(run(w, 100)).toEqual([]); // five seconds, far longer than the fill window
    expect(w.state.lobbyEndsAt).toBe(15_000);
    expect(w.state.phase).toBe("lobby");
    addPlayer(w, "c", "carol");
    step(w, TICK_MS);
    expect(w.state.lobbyEndsAt).toBe(w.state.serverTime + 1000);
  });

  it("later joiners do not extend the fill window", () => {
    const w = fillWorld({ minPlayers: 2, lobbySeconds: 60, fillSeconds: 5 });
    addPlayer(w, "a", "alice");
    addPlayer(w, "b", "bob");
    step(w, TICK_MS);
    const deadline = w.state.lobbyEndsAt;
    expect(deadline).toBe(TICK_MS + 5000);
    run(w, 40); // two seconds later
    addPlayer(w, "c", "carol");
    run(w, 10);
    expect(w.state.lobbyEndsAt).toBe(deadline);
    run(w, (deadline - w.state.serverTime) / TICK_MS);
    expect(w.state.phase).toBe("active");
    expect(w.state.serverTime).toBe(deadline);
    expect(w.state.raidStartedAt).toBe(deadline);
  });

  it("with fillSeconds 0 it starts on the next step at the latest", () => {
    const w = fillWorld({ fillSeconds: 0, lobbySeconds: 60 });
    addPlayer(w, "a", "alice");
    run(w, 7);
    expect(w.state.phase).toBe("lobby");
    addPlayer(w, "b", "bob");
    expect(step(w, TICK_MS)).toEqual([{ type: "raidStarted" }]);
  });

  it.each([MAX_PLAYERS, MAX_PLAYERS + 1])("starts as soon as the lobby holds %i players, ignoring both timers", (n) => {
    const w = fillWorld({ lobbySeconds: 1000, fillSeconds: 600 });
    for (let i = 0; i < MAX_PLAYERS - 1; i++) addPlayer(w, `p${i}`, `p${i}`);
    expect(run(w, 20)).toEqual([]); // one short of full: still waiting for the fill window
    expect(w.state.phase).toBe("lobby");
    for (let i = MAX_PLAYERS - 1; i < n; i++) addPlayer(w, `p${i}`, `p${i}`);
    expect(step(w, TICK_MS)).toEqual([{ type: "raidStarted" }]);
    expect(w.state.phase).toBe("active");
    expect([...w.state.players.values()].every((p) => p.status === "alive")).toBe(true);
  });

  it("a full lobby starts even when minPlayers is above the room size", () => {
    const w = fillWorld({ minPlayers: MAX_PLAYERS + 10, lobbySeconds: 1000 });
    for (let i = 0; i < MAX_PLAYERS; i++) addPlayer(w, `p${i}`, `p${i}`);
    expect(step(w, TICK_MS)).toEqual([{ type: "raidStarted" }]);
  });

  it("re-arming an emptied lobby discards a previously pulled-in deadline", () => {
    const w = fillWorld({ lobbySeconds: 60, fillSeconds: 2 });
    addPlayer(w, "a", "alice");
    addPlayer(w, "b", "bob");
    step(w, TICK_MS);
    expect(w.state.lobbyEndsAt).toBe(TICK_MS + 2000);
    removePlayer(w, "a");
    removePlayer(w, "b");
    run(w, 4);
    addPlayer(w, "c", "carol");
    expect(w.state.lobbyEndsAt).toBe(w.state.serverTime + 60_000);
    expect(run(w, 100)).toEqual([]);
    expect(w.state.phase).toBe("lobby");
  });
});

describe("raid spawns", () => {
  it("moves every player onto a distinct, walkable map spawn when the raid starts", () => {
    const w = makeWorld({ minPlayers: 3 });
    for (const id of ["a", "b", "c"]) addPlayer(w, id, id);
    step(w, TICK_MS);
    const ps = ["a", "b", "c"].map((id) => player(w, id));
    const keys = (v: Vec2) => `${v.x},${v.y}`;
    const spawnKeys = new Set(w.map.spawns.map(keys));
    for (const p of ps) {
      expect(spawnKeys.has(keys(p))).toBe(true);
      expect(isWallAt(w.map, p.x, p.y)).toBe(false);
    }
    expect(new Set(ps.map(keys)).size).toBe(3);
  });

  it("gives a full raid (MAX_PLAYERS) a spawn each, all distinct", () => {
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 1000, fillSeconds: 600 });
    for (let i = 0; i < MAX_PLAYERS; i++) addPlayer(w, `p${i}`, `p${i}`);
    step(w, TICK_MS);
    const keys = new Set([...w.state.players.values()].map((p) => `${p.x},${p.y}`));
    expect(keys.size).toBe(MAX_PLAYERS);
  });

  /** Spawn positions handed out to three players by a world driven by `random`. */
  const assignment = (random: () => number): string[] => {
    const w = makeWorld({ minPlayers: 3 }, 1234, random);
    for (const id of ["a", "b", "c"]) addPlayer(w, id, id);
    step(w, TICK_MS);
    return ["a", "b", "c"].map((id) => `${player(w, id).x},${player(w, id).y}`);
  };

  it("is a shuffle driven by world.random: the same stream gives the same assignment", () => {
    expect(assignment(mulberry32(42))).toEqual(assignment(mulberry32(42)));
  });

  it("different random streams give different assignments", () => {
    const seen = new Set<string>();
    for (let s = 1; s <= 8; s++) seen.add(assignment(mulberry32(s)).join("|"));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("consults world.random when the raid starts", () => {
    let calls = 0;
    const counting = mulberry32(3);
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 1000, fillSeconds: 0 }, 1234, () => { calls++; return counting(); });
    calls = 0; // createWorld draws the action-order salt
    addPlayer(w, "a", "alice");
    expect(run(w, 5)).toEqual([]);
    expect(calls).toBe(0); // the lobby is not random
    addPlayer(w, "b", "bob");
    step(w, TICK_MS);
    expect(calls).toBeGreaterThan(0);
  });

  it("starts every fighter with a fresh weapon state and the weapons and hp they joined with", () => {
    const w = makeWorld({ minPlayers: 2 });
    const a = addPlayer(w, "a", "alice");
    const b = addPlayer(w, "b", "bob");
    const rtA = w.players.get("a")!;
    rtA.weapon.held = true;
    rtA.weapon.aim = 2;
    a.readyAt = 5000;
    a.drawStartedAt = 99;
    step(w, TICK_MS);
    expect(w.state.phase).toBe("active");
    expect(rtA.weapon).toEqual(newWeaponRuntime());
    expect([a.readyAt, a.drawStartedAt]).toEqual([0, 0]);
    expect(a).toMatchObject({ faction: "fire", hp: 500, weapon0: "axe", weapon1: "", slot: 0 });
    expect(b).toMatchObject({ faction: "sentenced", hp: 700, weapon0: "bow", weapon1: "", slot: 0 });
  });

  it("re-spawns players onto map spawns wherever they stood in the lobby", () => {
    const w = makeWorld({ minPlayers: 2 });
    const a = addPlayer(w, "a", "alice");
    const b = addPlayer(w, "b", "bob");
    a.x = 1;
    a.y = 1;
    b.x = 1;
    b.y = 1;
    step(w, TICK_MS);
    const spawnKeys = new Set(w.map.spawns.map((s) => `${s.x},${s.y}`));
    expect(spawnKeys.has(`${a.x},${a.y}`)).toBe(true);
    expect(spawnKeys.has(`${b.x},${b.y}`)).toBe(true);
    expect(posOf(a)).not.toEqual(posOf(b));
  });
});


describe("clock", () => {
  it("advances serverTime by dtMs and tick by 1 per step in every phase", () => {
    const w = makeWorld({ minPlayers: 2 });
    addPlayer(w, "a", "alice");
    addPlayer(w, "b", "bob");
    const phases = new Set<string>();
    for (let i = 1; i <= 60; i++) {
      if (i === 30) removePlayer(w, "b"); // a leave ends the run on the next step
      step(w, TICK_MS);
      phases.add(w.state.phase);
      expect(w.state.serverTime).toBe(i * TICK_MS);
      expect(w.state.tick).toBe(i);
    }
    expect(phases).toEqual(new Set(["active", "ended"]));
  });

  it("uses whatever dtMs it is given", () => {
    const w = makeWorld();
    step(w, 33);
    step(w, 17);
    expect(w.state.serverTime).toBe(50);
    expect(w.state.tick).toBe(2);
  });

  it("returns a fresh event list per step (events are drained)", () => {
    const { world } = activeSolo();
    const a = step(world, TICK_MS);
    const b = step(world, TICK_MS);
    expect(a).not.toBe(b);
    expect(world.events).toEqual([]);
  });
});

describe("movement during a raid", () => {
  it.each([1, 7, 20, 40])("a move input covers PLAYER_SPEED x time along the planned path over %i ticks", (ticks) => {
    const { world, p, rt } = activeSolo();
    const start = posOf(p);
    const target = farthestSpawn(world, start);
    const planned = planPath(world, start, target);
    expect(pathLength(start, planned)).toBeGreaterThan(40 * STEP); // far enough that nobody arrives early
    expect(enqueueClientMessage(rt.inputs, "move", target)).toBe(true);
    walk(world, ticks);
    const expected = pointAlong(start, planned, ticks * STEP);
    expect(p.x).toBeCloseTo(expected.x, 6);
    expect(p.y).toBeCloseTo(expected.y, 6);
    // Never faster than the straight line at full speed.
    expect(dist(start, p)).toBeLessThanOrEqual(ticks * STEP + 1e-6);
  });

  it("faces the first waypoint after the first step", () => {
    const { world, p, rt } = activeSolo();
    const start = posOf(p);
    const target = farthestSpawn(world, start);
    const first = planPath(world, start, target)[0]!;
    expect(dist(start, first)).toBeGreaterThan(STEP);
    enqueueClientMessage(rt.inputs, "move", target);
    step(world, TICK_MS);
    expect(p.facing).toBeCloseTo(Math.atan2(first.y - start.y, first.x - start.x), 9);
  });

  it("keeps walking from queued input without re-sending it every tick", () => {
    const { world, p, rt } = activeSolo();
    const start = posOf(p);
    const target = farthestSpawn(world, start);
    const planned = planPath(world, start, target);
    enqueueClientMessage(rt.inputs, "move", target);
    walk(world, 10);
    const mid = dist(start, p);
    expect(mid).toBeGreaterThan(0);
    const midPos = posOf(p);
    walk(world, 10);
    expect(midPos.x).toBeCloseTo(pointAlong(start, planned, 10 * STEP).x, 6);
    expect(p.x).toBeCloseTo(pointAlong(start, planned, 20 * STEP).x, 6);
    expect(p.y).toBeCloseTo(pointAlong(start, planned, 20 * STEP).y, 6);
  });

  it("walks to the target, arrives on exactly the tick the path length requires, and stays put", () => {
    const { world, p, rt } = activeSolo();
    const start = posOf(p);
    const target = farthestSpawn(world, start);
    const needed = Math.ceil(pathLength(start, planPath(world, start, target)) / STEP - 1e-9);
    enqueueClientMessage(rt.inputs, "move", target);
    walk(world, needed - 1);
    expect(rt.path.length).toBeGreaterThan(0);
    expect(dist(p, target)).toBeGreaterThan(0);
    walk(world, 1);
    expect(p.x).toBeCloseTo(target.x, 9);
    expect(p.y).toBeCloseTo(target.y, 9);
    expect(rt.path).toEqual([]);
    const settled = posOf(p);
    walk(world, 20);
    expect(posOf(p)).toEqual(settled);
  });

  it("reaches a series of ground spots, never entering a wall or exceeding PLAYER_SPEED", () => {
    const { world, p, rt } = activeSolo();
    const spots = world.map.groundSpots.slice(0, 8);
    expect(spots.length).toBe(8);
    for (const spot of spots) {
      enqueueClientMessage(rt.inputs, "move", spot);
      let guard = 0;
      do {
        stepChecked(world);
        expect(++guard).toBeLessThan(600);
      } while (rt.path.length > 0);
      expect(p.x).toBeCloseTo(spot.x, 9);
      expect(p.y).toBeCloseTo(spot.y, 9);
    }
  });

  it("snaps targets outside the world onto nearby floor, so the body stays inside the map", () => {
    const { world, p, rt } = activeSolo();
    const corners: Array<[Vec2, Vec2]> = [
      [{ x: -5000, y: -5000 }, { x: 0, y: 0 }],
      [{ x: 1e9, y: 1e9 }, { x: WORLD_W, y: WORLD_H }],
    ];
    for (const [target, corner] of corners) {
      enqueueClientMessage(rt.inputs, "move", target);
      walk(world, 600);
      expect(rt.path).toEqual([]);
      expect(p.x).toBeGreaterThanOrEqual(PLAYER_RADIUS);
      expect(p.x).toBeLessThanOrEqual(WORLD_W - PLAYER_RADIUS);
      expect(p.y).toBeGreaterThanOrEqual(PLAYER_RADIUS);
      expect(p.y).toBeLessThanOrEqual(WORLD_H - PLAYER_RADIUS);
      expect(dist(p, corner)).toBeLessThan(6 * 32); // within snapping reach of the clamped target
    }
  });

  it("a target nobody can reach does not move the player", () => {
    const { world, p, rt } = activeSolo();
    // Seal tile (3,3) of a hand-built room and put the player outside it.
    const rows = [
      "############",
      "#..........#",
      "#.###......#",
      "#.#.#......#",
      "#.###......#",
      "#..........#",
      "############",
    ];
    const tiles = new Uint8Array(12 * 7);
    rows.forEach((row, ty) => [...row].forEach((c, tx) => { tiles[ty * 12 + tx] = c === "#" ? TILE_WALL : TILE_FLOOR; }));
    world.map = { ...world.map, w: 12, h: 7, tiles, buildings: [], spawns: [], crateSpots: [], groundSpots: [], extracts: [] };
    p.x = 8 * 32 + 16;
    p.y = 3 * 32 + 16;
    const start = posOf(p);
    enqueueClientMessage(rt.inputs, "move", { x: 3 * 32 + 16, y: 3 * 32 + 16 });
    run(world, 20);
    expect(rt.path).toEqual([]);
    expect(posOf(p)).toEqual(start);
  });

  it("moving to the spot you already stand on is a no-op", () => {
    const { world, p, rt } = activeSolo();
    const start = posOf(p);
    enqueueClientMessage(rt.inputs, "move", start);
    walk(world, 5);
    expect(posOf(p)).toEqual(start);
    expect(rt.path).toEqual([]);
  });

  it("a later move replans from where the player is and redirects them mid-walk", () => {
    const { world, p, rt } = activeSolo();
    const start = posOf(p);
    const first = farthestSpawn(world, start);
    enqueueClientMessage(rt.inputs, "move", first);
    walk(world, 10);
    const mid = posOf(p);
    const second = nearestOtherSpawn(world, mid);
    expect(dist(second, first)).toBeGreaterThan(1);
    const replanned = planPath(world, mid, second);
    enqueueClientMessage(rt.inputs, "move", second);
    walk(world, 5);
    expect(posOf(rt.path[rt.path.length - 1]!)).toEqual(second); // replanned, not the old route
    const expected = pointAlong(mid, replanned, 5 * STEP);
    expect(p.x).toBeCloseTo(expected.x, 6);
    expect(p.y).toBeCloseTo(expected.y, 6);
    let guard = 0;
    while (rt.path.length > 0) {
      stepChecked(world);
      expect(++guard).toBeLessThan(1000);
    }
    expect(p.x).toBeCloseTo(second.x, 9);
    expect(p.y).toBeCloseTo(second.y, 9);
  });

  it("stop clears the path and the player stays where the stop tick found them", () => {
    const { world, p, rt } = activeSolo();
    enqueueClientMessage(rt.inputs, "move", farthestSpawn(world, posOf(p)));
    walk(world, 5);
    expect(rt.path.length).toBeGreaterThan(0);
    const before = posOf(p);
    enqueueClientMessage(rt.inputs, "stop", {});
    step(world, TICK_MS);
    expect(rt.path).toEqual([]);
    expect(posOf(p)).toEqual(before); // the stop tick itself does not move
    run(world, 20);
    expect(posOf(p)).toEqual(before);
  });

  it("when move and stop arrive in the same tick, the later one wins", () => {
    const { world, p, rt } = activeSolo();
    const start = posOf(p);
    const target = farthestSpawn(world, start);
    const planned = planPath(world, start, target);
    enqueueClientMessage(rt.inputs, "move", target);
    enqueueClientMessage(rt.inputs, "stop", {});
    run(world, 5);
    expect(posOf(p)).toEqual(start);

    enqueueClientMessage(rt.inputs, "stop", {});
    enqueueClientMessage(rt.inputs, "move", target);
    walk(world, 5);
    const expected = pointAlong(start, planned, 5 * STEP);
    expect(p.x).toBeCloseTo(expected.x, 6);
    expect(p.y).toBeCloseTo(expected.y, 6);
  });

  it("rejected (malformed) messages never move anyone", () => {
    const { world, p, rt } = activeSolo();
    const start = posOf(p);
    expect(enqueueClientMessage(rt.inputs, "move", { x: NaN, y: 5 })).toBe(false);
    expect(enqueueClientMessage(rt.inputs, "move", { x: "5", y: 5 })).toBe(false);
    run(world, 10);
    expect(posOf(p)).toEqual(start);
  });

  it("each player moves independently", () => {
    const { world, a, b, rtA } = activePair();
    const a0 = posOf(a);
    const b0 = posOf(b);
    const target = farthestSpawn(world, a0);
    const planned = planPath(world, a0, target);
    enqueueClientMessage(rtA.inputs, "move", target);
    walk(world, 10);
    const expected = pointAlong(a0, planned, 10 * STEP);
    expect(a.x).toBeCloseTo(expected.x, 6);
    expect(a.y).toBeCloseTo(expected.y, 6);
    expect(posOf(b)).toEqual(b0);
  });

  it("two players walk at once without interfering", () => {
    const { world, a, b, rtA, rtB } = activePair();
    const a0 = posOf(a);
    const b0 = posOf(b);
    const aTarget = world.map.groundSpots[0]!;
    const bTarget = world.map.groundSpots[1]!;
    enqueueClientMessage(rtA.inputs, "move", aTarget);
    enqueueClientMessage(rtB.inputs, "move", bTarget);
    const aTicks = Math.ceil(pathLength(a0, planPath(world, a0, aTarget)) / STEP);
    const bTicks = Math.ceil(pathLength(b0, planPath(world, b0, bTarget)) / STEP);
    walk(world, Math.max(aTicks, bTicks) + 1);
    expect(a.x).toBeCloseTo(aTarget.x, 9);
    expect(a.y).toBeCloseTo(aTarget.y, 9);
    expect(b.x).toBeCloseTo(bTarget.x, 9);
    expect(b.y).toBeCloseTo(bTarget.y, 9);
  });
});


describe("aiming during a raid", () => {
  const AIM = 1;

  it("turns a standing player to the aim and remembers it", () => {
    const { world, p, rt } = activeSolo();
    enqueueClientMessage(rt.inputs, "aim", { a: AIM });
    step(world, TICK_MS);
    expect(p.facing).toBe(AIM);
    expect(rt.weapon.aim).toBe(AIM);
    expect(rt.weapon.aimAt).toBe(world.state.serverTime);
  });

  it("an aim of exactly 0 counts: it turns the player to face east", () => {
    const { world, p, rt } = activeSolo();
    p.facing = 2;
    enqueueClientMessage(rt.inputs, "aim", { a: 0 });
    step(world, TICK_MS);
    expect(p.facing).toBe(0);
    expect(rt.weapon.aimAt).toBe(world.state.serverTime);
  });

  it("stores the wrapped angle", () => {
    const { world, p, rt } = activeSolo();
    enqueueClientMessage(rt.inputs, "aim", { a: 7 });
    step(world, TICK_MS);
    expect(p.facing).toBeCloseTo(wrapAngle(7), 12);
    expect(rt.weapon.aim).toBe(p.facing);
  });

  it("the latest aim of a tick wins, and the aim is drained with the tick", () => {
    const { world, p, rt } = activeSolo();
    for (const a of [0.5, 1.5, -2]) enqueueClientMessage(rt.inputs, "aim", { a });
    step(world, TICK_MS);
    expect(p.facing).toBe(-2);
    expect(rt.inputs.aim).toBeNull();
    step(world, TICK_MS);
    expect(p.facing).toBe(-2); // not re-applied
  });

  it("an aim does not use up the tick's action budget", () => {
    const { world, rt } = activeSolo();
    const seen: string[] = [];
    world.actions.pickup = (_w, _c, cmd) => { if (cmd.kind === "pickup") seen.push(cmd.containerId); };
    for (let i = 0; i < 100; i++) enqueueClientMessage(rt.inputs, "aim", { a: i / 100 });
    for (let i = 0; i < MAX_ACTIONS_PER_TICK; i++) enqueueClientMessage(rt.inputs, "pickup", { containerId: `c${i}` });
    step(world, TICK_MS);
    expect(seen).toHaveLength(MAX_ACTIONS_PER_TICK);
    expect(rt.inputs.dropped).toBe(0);
  });

  it("a walking player keeps facing the aim instead of the way it walks", () => {
    const { world, p, rt } = activeSolo();
    const start = posOf(p);
    const target = farthestSpawn(world, start);
    const first = planPath(world, start, target)[0]!;
    expect(Math.atan2(first.y - start.y, first.x - start.x)).not.toBeCloseTo(AIM, 2); // walking would turn it elsewhere
    enqueueClientMessage(rt.inputs, "aim", { a: AIM });
    enqueueClientMessage(rt.inputs, "move", target);
    for (let i = 0; i < 10; i++) {
      stepChecked(world);
      expect(p.facing).toBe(AIM);
    }
    expect(dist(start, p)).toBeGreaterThan(5 * STEP);
  });

  it("walking turns the player again once the aim is stale (AIM_STALE_MS), and not a tick sooner", () => {
    const { world, p, rt } = activeSolo();
    const start = posOf(p);
    const target = farthestSpawn(world, start);
    expect(pathLength(start, planPath(world, start, target))).toBeGreaterThan((AIM_STALE_MS / TICK_MS + 5) * STEP);
    enqueueClientMessage(rt.inputs, "move", target);
    enqueueClientMessage(rt.inputs, "aim", { a: AIM });
    step(world, TICK_MS);
    const aimedAt = rt.weapon.aimAt;
    while (world.state.serverTime + TICK_MS - aimedAt < AIM_STALE_MS) {
      stepChecked(world);
      expect(p.facing).toBe(AIM); // still fresh
    }
    const before = posOf(p);
    const waypoints = rt.path.length;
    stepChecked(world);
    expect(world.state.serverTime - aimedAt).toBe(AIM_STALE_MS);
    expect(rt.path.length).toBe(waypoints); // no corner on this step: the heading is the straight line walked
    expect(p.facing).toBeCloseTo(Math.atan2(p.y - before.y, p.x - before.x), 9);
    expect(p.facing).not.toBeCloseTo(AIM, 2);
  });

  it("an aim sent every half second keeps a long walk aimed", () => {
    const { world, p, rt } = activeSolo();
    const start = posOf(p);
    const legs = [farthestSpawn(world, start), start];
    let leg = 0;
    let walked = 0;
    for (let tick = 0; tick < 60; tick++) {
      if (tick % 10 === 0) enqueueClientMessage(rt.inputs, "aim", { a: AIM });
      if (rt.path.length === 0) enqueueClientMessage(rt.inputs, "move", legs[leg++ % 2]!);
      const before = posOf(p);
      stepChecked(world);
      walked += dist(before, p);
      expect(p.facing).toBe(AIM);
    }
    expect(walked).toBeGreaterThan(40 * STEP);
  });

  it("a player who is down ignores everything they send", () => {
    const { world, a, rtA } = activeTrio();
    downPlayer(world, a, rtA, "died");
    const { x, y, facing } = a;
    enqueueClientMessage(rtA.inputs, "aim", { a: AIM });
    enqueueClientMessage(rtA.inputs, "move", world.map.groundSpots[0]!);
    enqueueClientMessage(rtA.inputs, "swap", {});
    run(world, 3);
    expect([a.x, a.y, a.facing]).toEqual([x, y, facing]);
    expect(rtA.path).toEqual([]);
    expect(rtA.inputs.aim).toBeNull();
    expect(rtA.inputs.actions).toEqual([]);
  });
});

describe("action dispatch", () => {
  it("ignores actions that have no registered handler", () => {
    const { world, p, rt } = activeSolo();
    enqueueClientMessage(rt.inputs, "swap", {});
    enqueueClientMessage(rt.inputs, "attack", { a: 1 });
    enqueueClientMessage(rt.inputs, "pickup", { containerId: "c1" });
    expect(() => run(world, 3)).not.toThrow();
    expect(p.status).toBe("alive");
    expect(rt.inputs.actions).toEqual([]);
  });

  it("calls the handler registered under the action's kind with (world, combatant, command)", () => {
    const { world, p, rt } = activeSolo();
    const seen: Array<{ kind: string; same: boolean }> = [];
    const cmds: unknown[] = [];
    for (const kind of ["attack", "release", "swap", "pickup"] as const) {
      world.actions[kind] = (w, c, cmd) => {
        seen.push({ kind: cmd.kind, same: w === world && c.kind === "player" && c.id === "a" && c.s === p && c.rt === rt });
        cmds.push(cmd);
      };
    }
    enqueueClientMessage(rt.inputs, "attack", { a: 0.5, t: 40 });
    enqueueClientMessage(rt.inputs, "release", { a: 0.75 });
    enqueueClientMessage(rt.inputs, "swap", { slot: 1 });
    enqueueClientMessage(rt.inputs, "pickup", { containerId: "c1" });
    step(world, TICK_MS);
    expect(seen).toEqual([
      { kind: "attack", same: true }, { kind: "release", same: true }, { kind: "swap", same: true },
      { kind: "pickup", same: true },
    ]);
    expect(cmds).toEqual([
      { kind: "attack", a: 0.5, t: 40 }, { kind: "release", a: 0.75 }, { kind: "swap", slot: 1 },
      { kind: "pickup", containerId: "c1" },
    ]);
  });

  it("passes drained actions to their handlers in order, capped at MAX_ACTIONS_PER_TICK", () => {
    const seen: string[] = [];
    const { world, rt } = activeSolo();
    world.actions.pickup = (_w, _c, cmd) => { if (cmd.kind === "pickup") seen.push(cmd.containerId); };
    for (let i = 0; i < MAX_ACTIONS_PER_TICK + 3; i++) enqueueClientMessage(rt.inputs, "pickup", { containerId: `c${i}` });
    step(world, TICK_MS);
    expect(seen).toEqual(Array.from({ length: MAX_ACTIONS_PER_TICK }, (_, i) => `c${i}`));
    step(world, TICK_MS);
    expect(seen).toHaveLength(MAX_ACTIONS_PER_TICK); // nothing is replayed next tick
  });

  it("applies the aim after planning the move and before the actions run", () => {
    const { world, p, rt } = activeSolo();
    const seen: Array<{ facing: number; aim: number; aimAt: number; pathLen: number }> = [];
    world.actions.attack = (_w, c) => {
      seen.push({ facing: c.s.facing, aim: c.rt.weapon.aim, aimAt: c.rt.weapon.aimAt, pathLen: c.rt.path.length });
    };
    enqueueClientMessage(rt.inputs, "move", farthestSpawn(world, posOf(p)));
    enqueueClientMessage(rt.inputs, "aim", { a: 1.5 });
    enqueueClientMessage(rt.inputs, "attack", { a: 2 });
    step(world, TICK_MS);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.facing).toBe(1.5);
    expect(seen[0]!.aim).toBe(1.5);
    expect(seen[0]!.aimAt).toBe(world.state.serverTime);
    expect(seen[0]!.pathLen).toBeGreaterThan(0);
  });

  it("shuffles the per-tick action order so no seat or pair of seats is favoured", () => {
    const world = makeWorld({ minPlayers: 3 });
    for (const [id, name] of [["a", "alice"], ["b", "bob"], ["c", "carol"]] as const) addPlayer(world, id, name);
    step(world, TICK_MS); // lobby -> active
    let seen: string[] = [];
    world.actions.swap = (_w, c) => { seen.push(c.id); };
    const firsts = new Map<string, number>();
    let aBeforeB = 0;
    const N = 300;
    for (let i = 0; i < N; i++) {
      seen = [];
      for (const id of ["a", "b", "c"]) enqueueClientMessage(world.players.get(id)!.inputs, "swap", {});
      step(world, TICK_MS);
      expect([...seen].sort()).toEqual(["a", "b", "c"]); // everyone still acts exactly once
      expect(seen).toEqual(actionOrder(world)); // the exported order is the one applied
      firsts.set(seen[0]!, (firsts.get(seen[0]!) ?? 0) + 1);
      if (seen.indexOf("a") < seen.indexOf("b")) aBeforeB++;
    }
    for (const id of ["a", "b", "c"]) expect(firsts.get(id) ?? 0).toBeGreaterThan(N / 3 - 45);
    // A subset of contenders (a vs b, with c idle) is also fair, unlike a rotation.
    expect(Math.abs(aBeforeB - N / 2)).toBeLessThan(45);
  });

  it("still moves and records everyone each tick when the order is shuffled", () => {
    const world = makeWorld({ minPlayers: 2 });
    addPlayer(world, "a", "alice");
    addPlayer(world, "b", "bob");
    step(world, TICK_MS);
    for (const id of ["a", "b"]) {
      enqueueClientMessage(world.players.get(id)!.inputs, "move", farthestSpawn(world, posOf(player(world, id))));
    }
    run(world, 6);
    for (const id of ["a", "b"]) {
      expect(world.players.get(id)!.history.map((h) => h.t)).toEqual([1, 2, 3, 4, 5, 6, 7].map((n) => n * TICK_MS));
      expect(world.players.get(id)!.path.length).toBeGreaterThan(0);
    }
  });

  it("plans the move before actions run, and moves the player after them", () => {
    const { world, p, rt } = activeSolo();
    const start = posOf(p);
    const seen: Array<{ pathLen: number; pos: Vec2 }> = [];
    world.actions.swap = (_w, c) => { seen.push({ pathLen: c.rt.path.length, pos: posOf(c.s) }); };
    enqueueClientMessage(rt.inputs, "move", farthestSpawn(world, start));
    enqueueClientMessage(rt.inputs, "swap", {});
    step(world, TICK_MS);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.pathLen).toBeGreaterThan(0); // the new path is already in place...
    expect(seen[0]!.pos).toEqual(start); // ...but nobody has moved yet
    expect(dist(start, p)).toBeGreaterThan(0);
  });

  it("runs registered systems after movement, every active step, with the step dt", () => {
    const log: Array<{ n: number; dt: number; pos: Vec2 }> = [];
    const { world, p, rt } = activeSolo();
    world.systems.push((w, dt) => log.push({ n: 1, dt, pos: posOf(w.state.players.get("a")!) }));
    world.systems.push((_w, dt) => log.push({ n: 2, dt, pos: { x: 0, y: 0 } }));
    const start = posOf(p);
    enqueueClientMessage(rt.inputs, "move", farthestSpawn(world, start));
    run(world, 2);
    expect(log.map((l) => l.n)).toEqual([1, 2, 1, 2]);
    expect(log.every((l) => l.dt === TICK_MS)).toBe(true);
    // The first system call already sees this tick's movement: one full step from the start.
    expect(dist(start, log[0]!.pos)).toBeCloseTo(STEP, 9);
    expect(dist(log[0]!.pos, log[2]!.pos)).toBeCloseTo(STEP, 6);
  });

  it("systems run in registration order and see the same tick's history sample", () => {
    const { world, p, rt } = activeSolo();
    const order: string[] = [];
    const sampled: Array<number | undefined> = [];
    world.systems.push(() => { order.push("first"); sampled.push(rt.history[rt.history.length - 1]?.t); });
    world.systems.push(() => { order.push("second"); });
    enqueueClientMessage(rt.inputs, "move", farthestSpawn(world, posOf(p)));
    run(world, 3);
    expect(order).toEqual(["first", "second", "first", "second", "first", "second"]);
    expect(sampled).toEqual([2, 3, 4].map((n) => n * TICK_MS)); // history is recorded before systems run
  });


  it("a handler that downs the player stops further actions and movement that tick", () => {
    const { world, p, rt } = activeSolo();
    downOnAttack(world);
    const calls: string[] = [];
    world.actions.swap = () => { calls.push("swap"); };
    const start = posOf(p);
    enqueueClientMessage(rt.inputs, "move", farthestSpawn(world, start));
    enqueueClientMessage(rt.inputs, "attack", { a: 1 });
    enqueueClientMessage(rt.inputs, "swap", {});
    const events = step(world, TICK_MS);
    expect(calls).toEqual([]);
    expect(posOf(p)).toEqual(start);
    expect(rt.path).toEqual([]);
    expect(p.status).toBe("dead");
    // The result comes from settle() at the end of the same step.
    const resolved = ofType(events, "resolved");
    expect(resolved).toHaveLength(1);
    expect(resolved[0].result).toMatchObject({ outcome: "died", players: 1, place: 1 });
    // The only player is down, so the run ends right away, without a second (mia) resolution.
    expect(ofType(events, "raidEnded")).toHaveLength(1);
    expect(world.state.phase).toBe("ended");
  });

  it("systems still run on the tick the last player goes down", () => {
    const { world, rt } = activeSolo();
    let runs = 0;
    world.systems.push(() => { runs++; });
    downOnAttack(world);
    enqueueClientMessage(rt.inputs, "attack", { a: 1 });
    step(world, TICK_MS);
    expect(runs).toBe(1);
    step(world, TICK_MS); // the run is over: no more system ticks
    expect(runs).toBe(1);
  });
});

describe("lag-compensation history", () => {
  it("is empty in the lobby; the raid start seeds one published sample at the spawn", () => {
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 1000 });
    addPlayer(w, "a", "alice");
    run(w, 10);
    expect(w.players.get("a")!.history).toEqual([]);
    addPlayer(w, "b", "bob");
    step(w, TICK_MS); // lobby -> active
    expect(w.state.phase).toBe("active");
    for (const id of ["a", "b"]) {
      const p = player(w, id);
      expect(w.players.get(id)!.history).toEqual([{ t: w.state.serverTime, x: p.x, y: p.y }]);
    }
  });

  it("starting the raid discards any history left over from before it", () => {
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 1000 });
    addPlayer(w, "a", "alice");
    addPlayer(w, "b", "bob");
    w.players.get("a")!.history.push({ t: -500, x: 1, y: 1 }); // stale: it would let attackers rewind into the lobby
    step(w, TICK_MS);
    expect(w.state.phase).toBe("active");
    const a = player(w, "a");
    expect(w.players.get("a")!.history).toEqual([{ t: w.state.serverTime, x: a.x, y: a.y }]);
  });

  it("records every alive player once per step, after movement, including idle ones", () => {
    const { world, a, b, rtA, rtB } = activePair();
    enqueueClientMessage(rtA.inputs, "move", farthestSpawn(world, posOf(a)));
    const bPos = posOf(b);
    // history[0] is the spawn sample seeded at raid start.
    for (let n = 1; n <= 5; n++) {
      stepChecked(world);
      expect(rtA.history).toHaveLength(n + 1);
      expect(rtB.history).toHaveLength(n + 1);
      expect(rtA.history[n]).toEqual({ t: world.state.serverTime, x: a.x, y: a.y }); // post-move position
      expect(rtB.history[n]).toEqual({ t: world.state.serverTime, x: bPos.x, y: bPos.y });
    }
    // Consecutive samples are one tick apart and a walker's samples are one step apart.
    for (let i = 1; i < 5; i++) {
      expect(rtA.history[i]!.t - rtA.history[i - 1]!.t).toBe(TICK_MS);
      expect(dist(rtA.history[i - 1]!, rtA.history[i]!)).toBeLessThanOrEqual(STEP + 1e-6);
    }
    expect(dist(rtA.history[0]!, rtA.history[4]!)).toBeGreaterThan(0);
  });

  it("keeps just over MAX_REWIND_MS of history: it covers the window plus at most one tick", () => {
    const { world, a, rtA } = activePair();
    enqueueClientMessage(rtA.inputs, "move", farthestSpawn(world, posOf(a)));
    const firstSampleAt = world.state.serverTime + TICK_MS;
    for (let tick = 1; tick <= 100; tick++) {
      stepChecked(world);
      const now = world.state.serverTime;
      const age = now - rtA.history[0]!.t;
      expect(age).toBeLessThanOrEqual(MAX_REWIND_MS + TICK_MS);
      if (now - firstSampleAt >= MAX_REWIND_MS) expect(age).toBeGreaterThanOrEqual(MAX_REWIND_MS);
      expect(rtA.history.length).toBeLessThanOrEqual((MAX_REWIND_MS + TICK_MS) / TICK_MS + 1);
    }
    expect(rtA.history.at(-1)!.t).toBe(world.state.serverTime);
  });

  it("lets positionAt rewind a walking player by whole ticks, fractions of a tick, and beyond the window", () => {
    const { world, a, rtA } = activePair();
    enqueueClientMessage(rtA.inputs, "move", farthestSpawn(world, posOf(a)));
    const trail = new Map<number, Vec2>();
    for (let tick = 1; tick <= 30; tick++) {
      stepChecked(world);
      trail.set(world.state.serverTime, posOf(a));
    }
    const now = world.state.serverTime;
    // Whole ticks back, within the rewind window.
    for (let k = 0; k * TICK_MS <= MAX_REWIND_MS; k++) {
      const want = trail.get(now - k * TICK_MS)!;
      const got = positionAt(rtA, a, now - k * TICK_MS);
      expect(got.x).toBeCloseTo(want.x, 9);
      expect(got.y).toBeCloseTo(want.y, 9);
    }
    // Half a tick back: halfway between the two neighbouring ticks.
    const prev = trail.get(now - TICK_MS)!;
    const mid = positionAt(rtA, a, now - TICK_MS / 2);
    expect(mid.x).toBeCloseTo((prev.x + a.x) / 2, 9);
    expect(mid.y).toBeCloseTo((prev.y + a.y) / 2, 9);
    // Newer than the newest sample: live. Older than the history: clamps to the oldest sample.
    expect(positionAt(rtA, a, now + 1000)).toEqual(posOf(a));
    const oldest = rtA.history[0]!;
    expect(positionAt(rtA, a, 0)).toEqual({ x: oldest.x, y: oldest.y });
  });


  it("stops recording a player once they are down, while the others carry on", () => {
    const { world, rtA, rtB } = activeTrio();
    world.actions.attack = (w, c) => { if (c.kind === "player" && c.id === "a") downPlayer(w, c.s, c.rt, "died"); };
    run(world, 3);
    expect(rtA.history).toHaveLength(4); // spawn sample + 3 steps
    enqueueClientMessage(rtA.inputs, "attack", { a: 1 });
    run(world, 6);
    expect(player(world, "a").status).toBe("dead");
    expect(rtA.history).toHaveLength(4); // not recorded on the tick they died, nor afterwards
    expect(rtA.history.at(-1)!.t).toBe(4 * TICK_MS); // the start step is the first tick
    expect(rtB.history.at(-1)!.t).toBe(world.state.serverTime);
    expect(world.state.phase).toBe("active");
  });

  it("stops recording once the run has ended", () => {
    const { world, rtA } = activePair();
    removePlayer(world, "b");
    run(world, 2);
    expect(world.state.phase).toBe("ended");
    const frozen = rtA.history.map((s) => ({ ...s }));
    expect(frozen.length).toBeGreaterThan(0);
    run(world, 10);
    expect(rtA.history).toEqual(frozen);
  });
});

describe("end of a run", () => {
  it("has no clock: runs where everyone stands just go on", () => {
    for (const make of [activeSolo, activePair]) {
      const { world } = make();
      expect(run(world, 2400)).toEqual([]); // two minutes
      expect(world.state.phase).toBe("active");
    }
  });

  it("the default dropBody clears a downed player's weapon slots", () => {
    const { world, a, rtA } = activePair();
    arm(a, "axe", "shield");
    downPlayer(world, a, rtA, "died");
    expect([a.weapon0, a.weapon1]).toEqual(["", ""]);
  });

  it.each([[28, 1], [30, 2], [59, 3], [60, 3]])("reports the run duration in rounded whole seconds (%i ticks in: %i)", (ticks, seconds) => {
    const { world } = activePair();
    run(world, ticks);
    removePlayer(world, "b");
    const [r] = ofType(world.events, "resolved");
    expect(r!.result.durationSec).toBe(seconds);
  });

  it("emits raidEnded exactly once and further steps do nothing", () => {
    const { world, startEvents } = activePair();
    removePlayer(world, "b");
    const all = [...startEvents, ...run(world, 200)];
    expect(ofType(all, "raidEnded")).toHaveLength(1);
    expect(ofType(all, "resolved")).toHaveLength(2); // bob left, alice won
    expect(world.state.phase).toBe("ended");

    const snapshot = JSON.stringify([...world.state.players.values()].map((p) => [p.x, p.y, p.status, p.hp]));
    for (let i = 0; i < 50; i++) expect(step(world, TICK_MS)).toEqual([]);
    expect(JSON.stringify([...world.state.players.values()].map((p) => [p.x, p.y, p.status, p.hp]))).toBe(snapshot);
    expect(world.state.phase).toBe("ended");
  });

  it("ignores inputs sent after the run ended", () => {
    const { world, a, rtA } = activePair();
    removePlayer(world, "b");
    run(world, 2);
    expect(world.state.phase).toBe("ended");
    const start = posOf(a);
    enqueueClientMessage(rtA.inputs, "move", world.map.groundSpots[0]!);
    expect(run(world, 10)).toEqual([]);
    expect(posOf(a)).toEqual(start);
  });

  it("a player who was mid-walk when the run ended stays where they were", () => {
    const { world, a, rtA } = activePair();
    enqueueClientMessage(rtA.inputs, "move", farthestSpawn(world, posOf(a)));
    run(world, 5);
    expect(rtA.path.length).toBeGreaterThan(0);
    removePlayer(world, "b");
    run(world, 2);
    expect(world.state.phase).toBe("ended");
    expect(rtA.path).toEqual([]); // resolving the winner clears the path
    const { x, y } = a;
    run(world, 10);
    expect([a.x, a.y]).toEqual([x, y]);
  });

  it("a lone survivor wins a contested run with GV_WIN on top of nothing else, once they hurt two of the three who started", () => {
    const { world, a, b, c, rtA, rtB, rtC } = activeTrio();
    const alice = { id: "a", p: a, rt: rtA };
    applyDamage(world, b, rtB, 1, alice);
    applyDamage(world, c, rtC, 1, alice);
    run(world, 5 * TICKS_PER_SEC + 1); // long enough that leaving now is not credited to alice as a kill
    removePlayer(world, "b");
    removePlayer(world, "c");
    const events = step(world, TICK_MS);
    const won = ofType(events, "resolved").find((e) => e.id === "a")!;
    expect(won.result).toMatchObject({
      outcome: "won", place: 1, gv: { kills: 0, mobs: 0, bounty: 0, win: GV_WIN, total: GV_WIN }, winBonusWithheld: false,
    });
  });

  describe("players who hit each other dead in the same tick", () => {
    /**
     * Both players' `attack` lands a lethal hit on the other through the damage ledger. Which of them acts first
     * is the per-tick shuffle, and the seed picks it; the outcome must not depend on it.
     */
    function mutualKill(seed: number, hpA: number, hpB: number) {
      const world = makeWorld({ minPlayers: 2 }, 1234, mulberry32(seed));
      const a = addPlayer(world, "a", "alice");
      const b = addPlayer(world, "b", "bob");
      step(world, TICK_MS);
      const order: string[] = [];
      world.actions.attack = (w, c) => {
        if (c.kind !== "player") return;
        order.push(c.id);
        recordHit(w, {
          victim: c.id === "a" ? "b" : "a", by: { id: c.id, name: c.s.name },
          packet: { raw: 10_000, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false,
        });
      };
      a.hp = hpA;
      b.hp = hpB;
      for (const id of ["a", "b"]) enqueueClientMessage(world.players.get(id)!.inputs, "attack", { a: 0 });
      const events = step(world, TICK_MS);
      return { world, a, b, events, order: order.join("") };
    }
    const SEEDS = Array.from({ length: 16 }, (_, i) => i + 1);

    it("both blows land and the higher hp fraction at the start of the tick wins, whoever acted first", () => {
      const orders = new Set<string>();
      for (const [hpA, hpB, winner, loser] of [[100, 350, "b", "a"], [400, 70, "a", "b"]] as const) {
        for (const seed of SEEDS) {
          const { world, a, b, events, order } = mutualKill(seed, hpA, hpB);
          orders.add(order);
          expect([a.status, b.status]).toEqual(["dead", "dead"]); // neither blow was lost
          expect(ofType(events, "fx").filter((e) => e.fx.kind === "death")).toHaveLength(2);
          expect(world.state.winner).toBe(winner === "a" ? "alice" : "bob");
          const results = new Map(ofType(events, "resolved").map((e) => [e.id, e.result]));
          expect(results.get(winner)).toMatchObject({ outcome: "won", place: 1 });
          expect(results.get(loser)).toMatchObject({
            outcome: "died", place: 2, killedBy: winner === "a" ? "alice" : "bob",
          });
          expect(world.state.phase).toBe("ended");
        }
      }
      expect(orders).toEqual(new Set(["ab", "ba"])); // the seeds covered both processing orders
    });

    it("an exact tie in hp fraction is a draw", () => {
      for (const seed of SEEDS) {
        const { world, events } = mutualKill(seed, 250, 350); // 250/500 = 350/700
        const results = ofType(events, "resolved");
        expect(results.map((e) => [e.result.outcome, e.result.place])).toEqual([["draw", 1], ["draw", 1]]);
        expect(world.state.winner).toBe("");
        expect(ofType(events, "fx").find((e) => e.fx.kind === "victory")!.fx).toMatchObject({ draw: true, id: null });
      }
    });
  });

  it("a lone survivor of a two-player run still wins, without the win bonus", () => {
    const { world } = activePair();
    removePlayer(world, "b");
    const events = step(world, TICK_MS);
    const won = ofType(events, "resolved").find((e) => e.id === "a")!;
    expect(won.result).toMatchObject({
      outcome: "won", place: 1, gv: { kills: 0, mobs: 0, bounty: 0, win: 0, total: 0 }, winBonusWithheld: true,
    });
    expect(world.state.winner).toBe("alice");
  });
});

describe("dropBody hook", () => {
  interface Call { world: World; player: unknown; status: string; held: string[] }
  /** Replaces the world's hook with a recorder that deliberately leaves the weapon slots alone. */
  function recordDrops(world: World): Call[] {
    const calls: Call[] = [];
    world.hooks.dropBody = (w, p) => {
      calls.push({ world: w, player: p, status: p.status, held: [p.weapon0, p.weapon1].filter((x) => x !== "") });
    };
    return calls;
  }

  it("runs when a player dies, after their status flips, with the weapons still on them", () => {
    const { world, a, rtA } = activePair();
    arm(a, "sword", "wand");
    downOnAttack(world);
    const calls = recordDrops(world);
    enqueueClientMessage(rtA.inputs, "attack", { a: 1 });
    const events = step(world, TICK_MS);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.world).toBe(world);
    expect(calls[0]!.player).toBe(a);
    expect(calls[0]!.status).toBe("dead");
    expect(calls[0]!.held).toEqual(["sword", "wand"]);
    // The hook replaces the default clear, so what it leaves behind stays on the player.
    expect([a.weapon0, a.weapon1]).toEqual(["sword", "wand"]);
    expect(ofType(events, "resolved").find((e) => e.id === "a")!.result.outcome).toBe("died");
  });

  it("the default hook clears the weapon slots of a player who died", () => {
    const { world, a, rtA } = activePair();
    arm(a, "sword", "wand");
    downOnAttack(world);
    enqueueClientMessage(rtA.inputs, "attack", { a: 1 });
    step(world, TICK_MS);
    expect([a.weapon0, a.weapon1]).toEqual(["", ""]);
  });

  it("runs the moment a player goes down, not at the end of the tick", () => {
    const { world, rtA } = activePair();
    const order: string[] = [];
    world.hooks.dropBody = () => { order.push("hook"); };
    world.actions.attack = (w, c) => { order.push("down"); if (c.kind === "player") downPlayer(w, c.s, c.rt, "died"); };
    world.systems.push(() => { order.push("system"); });
    enqueueClientMessage(rtA.inputs, "attack", { a: 1 });
    step(world, TICK_MS);
    expect(order).toEqual(["down", "hook", "system"]);
  });

  it("runs synchronously when removePlayer downs an alive player as mia", () => {
    const { world, a } = activePair();
    arm(a, "shield");
    const calls = recordDrops(world);
    removePlayer(world, "a");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.player).toBe(a);
    expect(calls[0]!.status).toBe("mia");
    expect(calls[0]!.held).toEqual(["shield"]);
  });

  it("runs once per player even if they are removed again later", () => {
    const { world, rtA } = activeTrio();
    downOnAttack(world);
    const calls = recordDrops(world);
    enqueueClientMessage(rtA.inputs, "attack", { a: 1 });
    step(world, TICK_MS);
    removePlayer(world, "a"); // already dead: no mia on top
    removePlayer(world, "b"); // still standing: mia
    expect(calls.map((c) => c.status)).toEqual(["dead", "mia"]);
  });

  it("does not run for a player who leaves during the lobby", () => {
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 1000 });
    const calls = recordDrops(w);
    addPlayer(w, "a", "alice");
    removePlayer(w, "a");
    expect(calls).toEqual([]);
  });

  it("does not run for a player who leaves after the run ended", () => {
    const { world } = activePair();
    removePlayer(world, "b");
    run(world, 2);
    expect(world.state.phase).toBe("ended");
    const calls = recordDrops(world);
    removePlayer(world, "a");
    expect(calls).toEqual([]);
  });

  it("can emit events that are delivered with that step's events", () => {
    const { world, rtA } = activePair();
    downOnAttack(world);
    world.hooks.dropBody = (w, p) => {
      emit(w, { type: "toast", to: "b", text: `${p.name} dropped a body` });
    };
    enqueueClientMessage(rtA.inputs, "attack", { a: 1 });
    const events = step(world, TICK_MS);
    expect(ofType(events, "toast")).toEqual([{ type: "toast", to: "b", text: "alice dropped a body" }]);
    expect(ofType(events, "resolved").map((e) => e.id)).toEqual(["a", "b"]); // alice died, bob won
  });
});

describe("removePlayer", () => {
  it("resolves an alive player in an active run as MIA at once, behind the players still standing", () => {
    const { world: w } = activeTrio();
    run(w, 40); // 2 seconds into the run

    removePlayer(w, "a");
    expect(w.state.players.has("a")).toBe(false);
    expect(w.players.has("a")).toBe(false);

    const events = step(w, TICK_MS);
    const resolved = ofType(events, "resolved");
    expect(resolved).toHaveLength(1);
    expect(resolved[0].id).toBe("a");
    expect(resolved[0].result).toEqual({
      outcome: "mia", profile: "alice", durationSec: 2, kills: 0, killedBy: null, place: 3, players: 3,
      gv: { kills: 0, mobs: 0, bounty: 0, win: 0, total: 0 }, winBonusWithheld: false,
    });
    // The others keep the run going.
    expect(ofType(events, "raidEnded")).toHaveLength(0);
    expect(w.state.phase).toBe("active");
    expect(player(w, "b").status).toBe("alive");
  });

  it("queues the event immediately so the Room can flush it with the next step", () => {
    const { world: w } = activePair();
    removePlayer(w, "a");
    expect(w.events).toHaveLength(1);
    expect(w.events[0]).toMatchObject({ type: "resolved", id: "a", result: { outcome: "mia" } });
  });

  it("leaves one player standing, who then wins on the next step", () => {
    const { world: w } = activePair();
    removePlayer(w, "a");
    const events = step(w, TICK_MS);
    expect(events.map((e) => (e.type === "fx" ? e.fx.kind : e.type))).toEqual(["resolved", "resolved", "victory", "raidEnded"]);
    expect(ofType(events, "resolved").map((e) => [e.id, e.result.outcome, e.result.place])).toEqual([
      ["a", "mia", 2], ["b", "won", 1],
    ]);
    expect(w.state.winner).toBe("bob");
    expect(w.state.phase).toBe("ended");
  });

  it("ends the run when the last alive player leaves, resolving them once and crowning nobody", () => {
    const { world } = activeSolo();
    run(world, 5);
    removePlayer(world, "a");
    const events = step(world, TICK_MS);
    expect(events.map((e) => (e.type === "fx" ? e.fx.kind : e.type))).toEqual(["resolved", "victory", "raidEnded"]);
    expect(world.state.phase).toBe("ended");
    expect(world.state.winner).toBe("");
    expect(ofType(events, "resolved")[0].result).toMatchObject({ outcome: "mia", place: 1, players: 1 });
  });

  it("emits nothing for a player who leaves during the lobby", () => {
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 1000 });
    addPlayer(w, "a", "alice");
    removePlayer(w, "a");
    expect(w.events).toEqual([]);
    expect(w.state.players.size).toBe(0);
    expect(w.players.size).toBe(0);
    expect(run(w, 5)).toEqual([]);
  });

  it("does not resolve a player twice (a leave after the run ended)", () => {
    const { world } = activePair();
    removePlayer(world, "b");
    run(world, 2);
    expect(world.state.phase).toBe("ended");
    removePlayer(world, "a");
    expect(world.events).toEqual([]);
    expect(step(world, TICK_MS)).toEqual([]);
  });

  it("does not resolve a player who is already dead", () => {
    const { world: w } = activeTrio();
    downOnAttack(w);
    enqueueClientMessage(w.players.get("a")!.inputs, "attack", { a: 1 });
    const events = step(w, TICK_MS);
    expect(ofType(events, "resolved")).toHaveLength(1);
    removePlayer(w, "a");
    expect(w.events).toEqual([]);
    expect(step(w, TICK_MS)).toEqual([]); // no mia event on top of the death
    expect(w.state.phase).toBe("active");
  });

  it("is a no-op for an unknown id", () => {
    const w = makeWorld();
    addPlayer(w, "a", "alice");
    expect(() => removePlayer(w, "ghost")).not.toThrow();
    expect(w.state.players.size).toBe(1);
    expect(w.events).toEqual([]);
  });

  it("a removed player's pending inputs are discarded with them", () => {
    const { world: w } = activeTrio();
    enqueueClientMessage(w.players.get("a")!.inputs, "move", w.map.groundSpots[0]!);
    removePlayer(w, "a");
    expect(() => run(w, 5)).not.toThrow();
    expect(w.state.players.has("a")).toBe(false);
  });
});

describe("abandonPlayer", () => {
  it("removes an alive player from the state and the runtime without resolving them", () => {
    const { world: w } = activeTrio();
    run(w, 40);
    expect(abandonPlayer(w, "a")).toBe(0);
    expect(w.state.players.has("a")).toBe(false);
    expect(w.players.has("a")).toBe(false);
    expect(w.events).toEqual([]);
    const events = run(w, 5);
    expect(ofType(events, "resolved")).toEqual([]);
    expect(w.state.phase).toBe("active");
    expect(player(w, "b").status).toBe("alive");
  });

  it("never drops a body: the run is void and nothing is looted", () => {
    const { world: w } = activeTrio();
    const drops: string[] = [];
    w.hooks.dropBody = (_w, p) => { drops.push(p.name); };
    abandonPlayer(w, "a");
    run(w, 5);
    expect(drops).toEqual([]);
  });

  it("voids the run: once anyone is abandoned, later steps resolve, end and teleport nothing", () => {
    const { world } = activeSolo();
    abandonPlayer(world, "a");
    expect(run(world, 5)).toEqual([]);
    expect(world.state.phase).toBe("active");
    expect(world.state.players.size).toBe(0);
  });

  it("a step between two abandons can't hand the other player a win in the void run", () => {
    const { world, b, rtB } = activePair({ patienceSeconds: 0.05 });
    abandonPlayer(world, "a");
    const hp = b.hp;
    expect(run(world, 20)).toEqual([]);
    expect(world.state.phase).toBe("active");
    expect(world.state.winner).toBe("");
    expect(world.state.gatesLocked).toBe(false);
    expect(rtB.resolved).toBe(false);
    expect(b.status).toBe("alive");
    expect(b.hp).toBe(hp);
    abandonPlayer(world, "b");
    expect(world.state.players.size).toBe(0);
  });

  it("works in the lobby and for an unknown id", () => {
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 1000 });
    addPlayer(w, "a", "alice");
    expect(abandonPlayer(w, "ghost")).toBe(0);
    expect(w.state.players.size).toBe(1);
    expect(abandonPlayer(w, "a")).toBe(0);
    expect(w.state.players.size).toBe(0);
    expect(w.players.size).toBe(0);
    expect(w.events).toEqual([]);
  });

  it("does not touch a player who was already resolved", () => {
    const { world: w } = activeTrio();
    downOnAttack(w);
    enqueueClientMessage(w.players.get("a")!.inputs, "attack", { a: 1 });
    expect(ofType(step(w, TICK_MS), "resolved")).toHaveLength(1);
    expect(abandonPlayer(w, "a")).toBe(0);
    expect(w.events).toEqual([]);
  });
});

describe("determinism", () => {
  it("identical inputs produce identical worlds, teleport and sudden death included", () => {
    const simulate = () => {
      const w = makeWorld({ minPlayers: 2, patienceSeconds: 2, suddenDeathSeconds: 1 });
      addPlayer(w, "a", "alice");
      addPlayer(w, "b", "bob");
      step(w, TICK_MS);
      enqueueClientMessage(w.players.get("a")!.inputs, "move", w.map.groundSpots[2]!);
      enqueueClientMessage(w.players.get("b")!.inputs, "move", w.map.groundSpots[9]!);
      const events = run(w, 150);
      return {
        events,
        players: [...w.state.players.entries()].map(([id, p]) => [id, p.x, p.y, p.facing, p.status, p.hp, p.immuneUntil]),
        history: [...w.players.values()].map((rt) => rt.history),
        time: w.state.serverTime,
        arena: [w.state.gatesLocked, w.state.inColiseum, w.state.patienceEndsAt, w.state.suddenDeathAt],
      };
    };
    const first = simulate();
    expect(first.players.every(([, x, y]) => typeof x === "number" && typeof y === "number")).toBe(true);
    expect(first.events.some((e) => e.type === "fx" && e.fx.kind === "teleport")).toBe(true); // the run did reach the coliseum
    expect(simulate()).toEqual(first);
  });

  it("a different random stream changes the spawns, and nothing else is random", () => {
    const spawnsFor = (s: number) => {
      const w = makeWorld({ minPlayers: 2 }, 1234, mulberry32(s));
      addPlayer(w, "a", "alice");
      addPlayer(w, "b", "bob");
      step(w, TICK_MS);
      return [posOf(player(w, "a")), posOf(player(w, "b"))];
    };
    expect(spawnsFor(1)).toEqual(spawnsFor(1));
    const variants = new Set([1, 2, 3, 4, 5, 6].map((s) => JSON.stringify(spawnsFor(s))));
    expect(variants.size).toBeGreaterThan(1);
  });
});

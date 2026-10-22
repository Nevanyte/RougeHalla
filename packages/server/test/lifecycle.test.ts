import { describe, expect, it } from "vitest";
import {
  generateMap, isWallAt, MAX_PLAYERS, MAX_REWIND_MS, mulberry32, PLAYER_MAX_HP, PLAYER_RADIUS, PLAYER_SPEED,
  TICK_MS, TILE_FLOOR, TILE_WALL, WORLD_H, WORLD_W, type ItemDTO, type Vec2,
} from "@raid/shared";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage, MAX_ACTIONS_PER_TICK } from "../src/sim/inputs";
import { planPath, positionAt } from "../src/sim/movement";
import { actionOrder, addPlayer, removePlayer, resolvePlayer, step } from "../src/sim/step";
import { createWorld, emit, type SimConfig, type SimEvent, type World } from "../src/sim/world";

type EventOf<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;

const TICKS_PER_SEC = 1000 / TICK_MS;
/** The farthest a player can move in one fixed step. */
const STEP = PLAYER_SPEED * (TICK_MS / 1000);

/**
 * fillSeconds defaults to 0 here: the raid then starts on the first step after minPlayers have joined,
 * which is what most tests want. The lobby-fill tests set their own value.
 */
function makeConfig(cfg: Partial<SimConfig> = {}): SimConfig {
  return { minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, raidSeconds: 360, extractSeconds: 5, ...cfg };
}

/** Every world gets its own fresh, seeded `random`, so two calls with the same arguments are identical. */
function makeWorld(cfg: Partial<SimConfig> = {}, seed = 1234, random = mulberry32(seed + 1)): World {
  return createWorld({ seed, config: makeConfig(cfg), random });
}

const gear = (...defs: string[]): ItemDTO[] => defs.map((def, i) => ({ uid: `${def}#${i}`, def }));

function run(world: World, ticks: number): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) all.push(...step(world, TICK_MS));
  return all;
}

function ofType<T extends SimEvent["type"]>(events: SimEvent[], type: T): Array<EventOf<T>> {
  return events.filter((e): e is EventOf<T> => e.type === type);
}

/** One solo player in a world whose raid starts on the first step. Returns the world after that step. */
function activeSolo(cfg: Partial<SimConfig> = {}, items: ItemDTO[] = []) {
  const world = makeWorld({ minPlayers: 1, ...cfg });
  const p = addPlayer(world, "a", "alice", items);
  const events = step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  return { world, p, rt: world.players.get("a")!, startEvents: events };
}

/** Two players, `a` and `b`, in a raid that started on the first step. */
function activePair(cfg: Partial<SimConfig> = {}, aItems: ItemDTO[] = [], bItems: ItemDTO[] = []) {
  const world = makeWorld({ minPlayers: 2, ...cfg });
  const a = addPlayer(world, "a", "alice", aItems);
  const b = addPlayer(world, "b", "bob", bItems);
  const startEvents = step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  return { world, a, b, rtA: world.players.get("a")!, rtB: world.players.get("b")!, startEvents };
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

  it("generates the map from the (coerced) state seed, exactly as clients do", () => {
    for (const seed of [1234, 7, -1]) {
      const w = makeWorld({}, seed);
      expect(w.map.seed).toBe(w.state.seed);
      expect(w.map).toEqual(generateMap(w.state.seed));
    }
  });

  it("registers synced state and server-only runtime for a joining player", () => {
    const w = makeWorld();
    const items = gear("knife", "gold");
    const p = addPlayer(w, "a", "alice", items);
    expect(player(w, "a")).toBe(p);
    expect(p).toMatchObject({ name: "alice", hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, status: "lobby" });
    expect(p.inventory.map((i) => ({ uid: i.uid, def: i.def }))).toEqual(items);
    const rt = w.players.get("a")!;
    expect(rt).toMatchObject({
      id: "a", profile: "alice", path: [], history: [], extracting: null, resolved: false, killedBy: null,
    });
    expect(rt.broughtIn).toEqual(items);
  });

  it("snapshots broughtIn so later edits to the loadout array do not leak in", () => {
    const w = makeWorld();
    const items = gear("knife");
    addPlayer(w, "a", "alice", items);
    items[0].def = "gpu";
    items.push({ uid: "extra", def: "gold" });
    expect(w.players.get("a")!.broughtIn).toEqual([{ uid: "knife#0", def: "knife" }]);
  });

  it("places lobby players on the map's spawns in join order", () => {
    const w = makeWorld();
    const { spawns } = w.map;
    const a = addPlayer(w, "a", "alice", []);
    const b = addPlayer(w, "b", "bob", []);
    const c = addPlayer(w, "c", "carol", []);
    expect(posOf(a)).toEqual(spawns[0]);
    expect(posOf(b)).toEqual(spawns[1]);
    expect(posOf(c)).toEqual(spawns[2]);
    for (const p of [a, b, c]) expect(isWallAt(w.map, p.x, p.y)).toBe(false);
  });

  it("wraps around the spawn list when there are more players than spawns", () => {
    const w = makeWorld();
    const n = w.map.spawns.length;
    const players = Array.from({ length: n + 2 }, (_, i) => addPlayer(w, `p${i}`, `p${i}`, []));
    expect(posOf(players[n]!)).toEqual(w.map.spawns[0]);
    expect(posOf(players[n + 1]!)).toEqual(w.map.spawns[1]);
  });

  it("arms the lobby timer when the first player joins, and only then", () => {
    const w = makeWorld({ lobbySeconds: 10, minPlayers: 5 });
    run(w, 4); // empty lobby ticks: serverTime = 200
    addPlayer(w, "a", "alice", []);
    expect(w.state.lobbyEndsAt).toBe(200 + 10_000);
    run(w, 4);
    addPlayer(w, "b", "bob", []);
    expect(w.state.lobbyEndsAt).toBe(200 + 10_000);
  });

  it("re-arms the lobby timer if the lobby empties and someone joins again", () => {
    const w = makeWorld({ lobbySeconds: 10, minPlayers: 5 });
    addPlayer(w, "a", "alice", []);
    run(w, 10);
    removePlayer(w, "a");
    expect(w.state.players.size).toBe(0);
    addPlayer(w, "b", "bob", []);
    expect(w.state.lobbyEndsAt).toBe(w.state.serverTime + 10_000);
  });
});

describe("per-world registries", () => {
  it("createWorld starts with empty action and system registries and a default dropBody hook", () => {
    const w = makeWorld();
    expect(w.actions).toEqual({});
    expect(w.systems).toEqual([]);
    expect(typeof w.hooks.dropBody).toBe("function");
  });

  it("handlers, systems and hooks registered on one world never leak into another", () => {
    const w1 = makeWorld({ minPlayers: 1 });
    const w2 = makeWorld({ minPlayers: 1 });
    expect(w1.actions).not.toBe(w2.actions);
    expect(w1.systems).not.toBe(w2.systems);
    expect(w1.hooks).not.toBe(w2.hooks);

    const calls: string[] = [];
    w1.actions.extract = () => { calls.push("w1 extract"); };
    w1.systems.push(() => { calls.push("w1 system"); });

    for (const w of [w1, w2]) {
      addPlayer(w, "a", "alice", gear("knife"));
      step(w, TICK_MS);
      enqueueClientMessage(w.players.get("a")!.inputs, "extract", {});
    }
    run(w2, 3); // the untouched world: no handler, no system
    expect(calls).toEqual([]);
    expect(w2.systems).toEqual([]);

    step(w1, TICK_MS);
    expect(calls).toEqual(["w1 extract", "w1 system"]);
    expect(w2.actions).toEqual({});
  });

  it("two raids can run side by side without sharing hooks or handlers", () => {
    const downed: string[] = [];
    const w1 = makeWorld({ minPlayers: 1, raidSeconds: 1 });
    const w2 = makeWorld({ minPlayers: 1, raidSeconds: 1 });
    w1.hooks.dropBody = (_w, p) => { downed.push(`w1:${p.name}`); };
    addPlayer(w1, "a", "alice", gear("gold"));
    addPlayer(w2, "a", "alice", gear("gold"));
    run(w1, 30);
    run(w2, 30);
    expect(downed).toEqual(["w1:alice"]);
    expect(player(w1, "a").inventory.length).toBe(1); // w1's hook replaced the default discard
    expect(player(w2, "a").inventory.length).toBe(0); // w2 still uses the default
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
    g1.actions.use = () => {};
    expect(g2.systems).toHaveLength(baseline);
    expect(g2.actions.use).not.toBe(g1.actions.use);
  });

  it("runs a whole raid through the shared lifecycle", () => {
    const g = createGameWorld({ seed: 99, config: makeConfig({ minPlayers: 1, raidSeconds: 2 }), random: mulberry32(5) });
    addPlayer(g, "a", "alice", []);
    const events = run(g, 60);
    expect(ofType(events, "raidStarted")).toHaveLength(1);
    expect(ofType(events, "raidEnded")).toHaveLength(1);
    expect(g.state.phase).toBe("ended");
  });
});

describe("lobby phase", () => {
  it("waits while fewer than minPlayers are present", () => {
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 1000 });
    addPlayer(w, "a", "alice", []);
    const events = run(w, 50);
    expect(events).toEqual([]);
    expect(w.state.phase).toBe("lobby");
    expect(player(w, "a").status).toBe("lobby");
  });

  it("with fillSeconds 0, starts on the first step after minPlayers have joined", () => {
    const w = makeWorld({ minPlayers: 2, raidSeconds: 100, fillSeconds: 0 });
    addPlayer(w, "a", "alice", gear("knife"));
    expect(run(w, 5)).toEqual([]);
    addPlayer(w, "b", "bob", []);
    expect(w.state.phase).toBe("lobby"); // joining alone never starts it; only step() does
    const events = step(w, TICK_MS);
    expect(events).toEqual([{ type: "raidStarted" }]);
    expect(w.state.phase).toBe("active");
    expect(w.state.raidStartedAt).toBe(w.state.serverTime);
    expect(w.state.raidEndsAt).toBe(w.state.serverTime + 100_000);
    expect(player(w, "a").status).toBe("alive");
    expect(player(w, "b").status).toBe("alive");
  });

  it("emits raidStarted exactly once", () => {
    const { world, startEvents } = activeSolo({ raidSeconds: 100 });
    expect(ofType(startEvents, "raidStarted")).toHaveLength(1);
    expect(ofType(run(world, 100), "raidStarted")).toHaveLength(0);
  });

  it("starts after lobbySeconds with a single player (below minPlayers)", () => {
    const lobbySeconds = 3;
    const w = makeWorld({ minPlayers: 2, lobbySeconds });
    addPlayer(w, "a", "alice", []);
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
    addPlayer(w, "a", "alice", []);
    run(w, 20);
    addPlayer(w, "b", "bob", []); // 1s in; timer must still end at 2s
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
    const p = addPlayer(w, "a", "alice", []);
    const rt = w.players.get("a")!;
    const { x, y } = p;
    const target = w.map.groundSpots[0]!;
    expect(enqueueClientMessage(rt.inputs, "move", target)).toBe(true);
    enqueueClientMessage(rt.inputs, "use", { uid: "x" });
    step(w, TICK_MS);
    expect(rt.inputs.move).toBeNull();
    expect(rt.inputs.actions).toEqual([]);
    expect(rt.path).toEqual([]);
    expect([p.x, p.y]).toEqual([x, y]);
  });

  it("does not carry lobby-era inputs into the raid", () => {
    const w = makeWorld({ minPlayers: 1 });
    const p = addPlayer(w, "a", "alice", []);
    const rt = w.players.get("a")!;
    enqueueClientMessage(rt.inputs, "move", w.map.groundSpots[0]!);
    step(w, TICK_MS); // lobby -> active
    const { x, y } = p;
    run(w, 5);
    expect([p.x, p.y]).toEqual([x, y]);
    expect(rt.path).toEqual([]);
  });

  it("does not run action handlers or systems during the lobby", () => {
    let calls = 0;
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 1000 });
    w.actions.extract = () => { calls++; };
    w.systems.push(() => { calls++; });
    addPlayer(w, "a", "alice", []);
    enqueueClientMessage(w.players.get("a")!.inputs, "extract", {});
    run(w, 5);
    expect(calls).toBe(0);
  });
});

describe("lobby fill window (fillSeconds)", () => {
  const fillWorld = (cfg: Partial<SimConfig> = {}) =>
    makeWorld({ minPlayers: 2, lobbySeconds: 15, fillSeconds: 5, ...cfg });

  it("does not start on the tick minPlayers is reached; it waits fillSeconds first", () => {
    const w = fillWorld();
    addPlayer(w, "a", "alice", []);
    run(w, 5);
    addPlayer(w, "b", "bob", []); // minPlayers reached between steps
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
    addPlayer(w, "a", "alice", []);
    expect(w.state.lobbyEndsAt).toBe(60_000);
    run(w, 10);
    expect(w.state.lobbyEndsAt).toBe(60_000); // one player: below minPlayers, nothing changes
    addPlayer(w, "b", "bob", []);
    step(w, TICK_MS);
    expect(w.state.lobbyEndsAt).toBe(w.state.serverTime + 2000);
  });

  it("never pushes lobbyEndsAt later than the normal lobby timer", () => {
    const w = fillWorld({ lobbySeconds: 2, fillSeconds: 5 });
    addPlayer(w, "a", "alice", []);
    addPlayer(w, "b", "bob", []);
    run(w, 10);
    expect(w.state.lobbyEndsAt).toBe(2000);
    expect(run(w, 29)).toEqual([]); // up to serverTime 1950
    expect(step(w, TICK_MS)).toEqual([{ type: "raidStarted" }]);
    expect(w.state.serverTime).toBe(2000);
  });

  it("leaves the normal timer alone while fewer than minPlayers are present", () => {
    const w = fillWorld({ minPlayers: 3, lobbySeconds: 15, fillSeconds: 1 });
    addPlayer(w, "a", "alice", []);
    addPlayer(w, "b", "bob", []);
    expect(run(w, 100)).toEqual([]); // five seconds, far longer than the fill window
    expect(w.state.lobbyEndsAt).toBe(15_000);
    expect(w.state.phase).toBe("lobby");
    addPlayer(w, "c", "carol", []);
    step(w, TICK_MS);
    expect(w.state.lobbyEndsAt).toBe(w.state.serverTime + 1000);
  });

  it("later joiners do not extend the fill window", () => {
    const w = fillWorld({ minPlayers: 2, lobbySeconds: 60, fillSeconds: 5 });
    addPlayer(w, "a", "alice", []);
    addPlayer(w, "b", "bob", []);
    step(w, TICK_MS);
    const deadline = w.state.lobbyEndsAt;
    expect(deadline).toBe(TICK_MS + 5000);
    run(w, 40); // two seconds later
    addPlayer(w, "c", "carol", []);
    run(w, 10);
    expect(w.state.lobbyEndsAt).toBe(deadline);
    run(w, (deadline - w.state.serverTime) / TICK_MS);
    expect(w.state.phase).toBe("active");
    expect(w.state.serverTime).toBe(deadline);
    expect(w.state.raidStartedAt).toBe(deadline);
  });

  it("with fillSeconds 0 it starts on the next step at the latest", () => {
    const w = fillWorld({ fillSeconds: 0, lobbySeconds: 60 });
    addPlayer(w, "a", "alice", []);
    run(w, 7);
    expect(w.state.phase).toBe("lobby");
    addPlayer(w, "b", "bob", []);
    expect(step(w, TICK_MS)).toEqual([{ type: "raidStarted" }]);
  });

  it.each([MAX_PLAYERS, MAX_PLAYERS + 1])("starts as soon as the lobby holds %i players, ignoring both timers", (n) => {
    const w = fillWorld({ lobbySeconds: 1000, fillSeconds: 600 });
    for (let i = 0; i < MAX_PLAYERS - 1; i++) addPlayer(w, `p${i}`, `p${i}`, []);
    expect(run(w, 20)).toEqual([]); // one short of full: still waiting for the fill window
    expect(w.state.phase).toBe("lobby");
    for (let i = MAX_PLAYERS - 1; i < n; i++) addPlayer(w, `p${i}`, `p${i}`, []);
    expect(step(w, TICK_MS)).toEqual([{ type: "raidStarted" }]);
    expect(w.state.phase).toBe("active");
    expect([...w.state.players.values()].every((p) => p.status === "alive")).toBe(true);
  });

  it("a full lobby starts even when minPlayers is above the room size", () => {
    const w = fillWorld({ minPlayers: MAX_PLAYERS + 10, lobbySeconds: 1000 });
    for (let i = 0; i < MAX_PLAYERS; i++) addPlayer(w, `p${i}`, `p${i}`, []);
    expect(step(w, TICK_MS)).toEqual([{ type: "raidStarted" }]);
  });

  it("re-arming an emptied lobby discards a previously pulled-in deadline", () => {
    const w = fillWorld({ lobbySeconds: 60, fillSeconds: 2 });
    addPlayer(w, "a", "alice", []);
    addPlayer(w, "b", "bob", []);
    step(w, TICK_MS);
    expect(w.state.lobbyEndsAt).toBe(TICK_MS + 2000);
    removePlayer(w, "a");
    removePlayer(w, "b");
    run(w, 4);
    addPlayer(w, "c", "carol", []);
    expect(w.state.lobbyEndsAt).toBe(w.state.serverTime + 60_000);
    expect(run(w, 100)).toEqual([]);
    expect(w.state.phase).toBe("lobby");
  });
});

describe("raid spawns", () => {
  it("moves every player onto a distinct, walkable map spawn when the raid starts", () => {
    const w = makeWorld({ minPlayers: 3 });
    for (const id of ["a", "b", "c"]) addPlayer(w, id, id, []);
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
    for (let i = 0; i < MAX_PLAYERS; i++) addPlayer(w, `p${i}`, `p${i}`, []);
    step(w, TICK_MS);
    const keys = new Set([...w.state.players.values()].map((p) => `${p.x},${p.y}`));
    expect(keys.size).toBe(MAX_PLAYERS);
  });

  /** Spawn positions handed out to three players by a world driven by `random`. */
  const assignment = (random: () => number): string[] => {
    const w = makeWorld({ minPlayers: 3 }, 1234, random);
    for (const id of ["a", "b", "c"]) addPlayer(w, id, id, []);
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
    addPlayer(w, "a", "alice", []);
    expect(run(w, 5)).toEqual([]);
    expect(calls).toBe(0); // the lobby is not random
    addPlayer(w, "b", "bob", []);
    step(w, TICK_MS);
    expect(calls).toBeGreaterThan(0);
  });

  it("re-spawns players onto map spawns wherever they stood in the lobby", () => {
    const w = makeWorld({ minPlayers: 2 });
    const a = addPlayer(w, "a", "alice", []);
    const b = addPlayer(w, "b", "bob", []);
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
    const w = makeWorld({ minPlayers: 1, raidSeconds: 1 });
    addPlayer(w, "a", "alice", []);
    const phases = new Set<string>();
    for (let i = 1; i <= 60; i++) {
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
    const { world, p, rt } = activeSolo({ raidSeconds: 60 });
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
    const { world, p, rt } = activeSolo({ raidSeconds: 60 });
    const start = posOf(p);
    const target = farthestSpawn(world, start);
    const first = planPath(world, start, target)[0]!;
    expect(dist(start, first)).toBeGreaterThan(STEP);
    enqueueClientMessage(rt.inputs, "move", target);
    step(world, TICK_MS);
    expect(p.facing).toBeCloseTo(Math.atan2(first.y - start.y, first.x - start.x), 9);
  });

  it("keeps walking from queued input without re-sending it every tick", () => {
    const { world, p, rt } = activeSolo({ raidSeconds: 60 });
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
    const { world, p, rt } = activeSolo({ raidSeconds: 120 });
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
    const { world, p, rt } = activeSolo({ raidSeconds: 300 });
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
    const { world, p, rt } = activeSolo({ raidSeconds: 300 });
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
    const { world, p, rt } = activeSolo({ raidSeconds: 60 });
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
    const { world, p, rt } = activeSolo({ raidSeconds: 60 });
    const start = posOf(p);
    enqueueClientMessage(rt.inputs, "move", start);
    walk(world, 5);
    expect(posOf(p)).toEqual(start);
    expect(rt.path).toEqual([]);
  });

  it("a later move replans from where the player is and redirects them mid-walk", () => {
    const { world, p, rt } = activeSolo({ raidSeconds: 120 });
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
    const { world, p, rt } = activeSolo({ raidSeconds: 60 });
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
    const { world, p, rt } = activeSolo({ raidSeconds: 60 });
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
    const { world, p, rt } = activeSolo({ raidSeconds: 60 });
    const start = posOf(p);
    expect(enqueueClientMessage(rt.inputs, "move", { x: NaN, y: 5 })).toBe(false);
    expect(enqueueClientMessage(rt.inputs, "move", { x: "5", y: 5 })).toBe(false);
    run(world, 10);
    expect(posOf(p)).toEqual(start);
  });

  it("each player moves independently", () => {
    const { world, a, b, rtA } = activePair({ raidSeconds: 60 });
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
    const { world, a, b, rtA, rtB } = activePair({ raidSeconds: 120 });
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

describe("action dispatch", () => {
  it("ignores actions that have no registered handler", () => {
    const { world, p, rt } = activeSolo({ raidSeconds: 60 });
    enqueueClientMessage(rt.inputs, "extract", {});
    enqueueClientMessage(rt.inputs, "attack", { x: 1, y: 1 });
    expect(() => run(world, 3)).not.toThrow();
    expect(p.status).toBe("alive");
    expect(rt.inputs.actions).toEqual([]);
  });

  it("calls the handler registered under the action's kind with (world, player, runtime, command)", () => {
    const { world, p, rt } = activeSolo({ raidSeconds: 60 });
    const seen: Array<{ kind: string; same: boolean }> = [];
    for (const kind of ["attack", "take", "drop", "use", "extract"] as const) {
      world.actions[kind] = (w, pl, r, cmd) => {
        seen.push({ kind: cmd.kind, same: w === world && pl === p && r === rt });
      };
    }
    enqueueClientMessage(rt.inputs, "attack", { x: 5, y: 6 });
    enqueueClientMessage(rt.inputs, "take", { containerId: "c1", uid: "u1" });
    enqueueClientMessage(rt.inputs, "drop", { uid: "u2" });
    enqueueClientMessage(rt.inputs, "use", { uid: "u3" });
    step(world, TICK_MS);
    enqueueClientMessage(rt.inputs, "extract", {});
    step(world, TICK_MS);
    expect(seen).toEqual([
      { kind: "attack", same: true }, { kind: "take", same: true }, { kind: "drop", same: true },
      { kind: "use", same: true }, { kind: "extract", same: true },
    ]);
  });

  it("passes drained actions to their handlers in order, capped at MAX_ACTIONS_PER_TICK", () => {
    const seen: string[] = [];
    const { world, rt } = activeSolo({ raidSeconds: 60 });
    world.actions.use = (_w, _p, _rt, cmd) => { if (cmd.kind === "use") seen.push(cmd.uid); };
    for (let i = 0; i < MAX_ACTIONS_PER_TICK + 3; i++) enqueueClientMessage(rt.inputs, "use", { uid: `u${i}` });
    step(world, TICK_MS);
    expect(seen).toEqual(Array.from({ length: MAX_ACTIONS_PER_TICK }, (_, i) => `u${i}`));
    step(world, TICK_MS);
    expect(seen).toHaveLength(MAX_ACTIONS_PER_TICK); // nothing is replayed next tick
  });

  it("shuffles the per-tick action order so no seat or pair of seats is favoured", () => {
    const world = makeWorld({ minPlayers: 3, raidSeconds: 60 });
    for (const [id, name] of [["a", "alice"], ["b", "bob"], ["c", "carol"]] as const) addPlayer(world, id, name, []);
    step(world, TICK_MS); // lobby -> active
    let seen: string[] = [];
    world.actions.extract = (_w, _p, rt) => { seen.push(rt.id); };
    const firsts = new Map<string, number>();
    let aBeforeB = 0;
    const N = 300;
    for (let i = 0; i < N; i++) {
      seen = [];
      for (const id of ["a", "b", "c"]) enqueueClientMessage(world.players.get(id)!.inputs, "extract", {});
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
    const world = makeWorld({ minPlayers: 2, raidSeconds: 60 });
    addPlayer(world, "a", "alice", []);
    addPlayer(world, "b", "bob", []);
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
    const { world, p, rt } = activeSolo({ raidSeconds: 60 });
    const start = posOf(p);
    const seen: Array<{ pathLen: number; pos: Vec2 }> = [];
    world.actions.use = (_w, pl, r) => { seen.push({ pathLen: r.path.length, pos: posOf(pl) }); };
    enqueueClientMessage(rt.inputs, "move", farthestSpawn(world, start));
    enqueueClientMessage(rt.inputs, "use", { uid: "x" });
    step(world, TICK_MS);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.pathLen).toBeGreaterThan(0); // the new path is already in place...
    expect(seen[0]!.pos).toEqual(start); // ...but nobody has moved yet
    expect(dist(start, p)).toBeGreaterThan(0);
  });

  it("runs registered systems after movement, every active step, with the step dt", () => {
    const log: Array<{ n: number; dt: number; pos: Vec2 }> = [];
    const { world, p, rt } = activeSolo({ raidSeconds: 60 });
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
    const { world, p, rt } = activeSolo({ raidSeconds: 60 });
    const order: string[] = [];
    const sampled: Array<number | undefined> = [];
    world.systems.push(() => { order.push("first"); sampled.push(rt.history[rt.history.length - 1]?.t); });
    world.systems.push(() => { order.push("second"); });
    enqueueClientMessage(rt.inputs, "move", farthestSpawn(world, posOf(p)));
    run(world, 3);
    expect(order).toEqual(["first", "second", "first", "second", "first", "second"]);
    expect(sampled).toEqual([2, 3, 4].map((n) => n * TICK_MS)); // history is recorded before systems run
  });

  it("a handler that resolves the player stops further actions and movement that tick", () => {
    const { world, p, rt } = activeSolo({ raidSeconds: 60 }, gear("knife"));
    world.actions.attack = (w, pl, r) => resolvePlayer(w, pl, r, "died");
    const calls: string[] = [];
    world.actions.use = () => { calls.push("use"); };
    const start = posOf(p);
    enqueueClientMessage(rt.inputs, "move", farthestSpawn(world, start));
    enqueueClientMessage(rt.inputs, "attack", { x: 1, y: 1 });
    enqueueClientMessage(rt.inputs, "use", { uid: "late" });
    const events = step(world, TICK_MS);
    expect(calls).toEqual([]);
    expect(posOf(p)).toEqual(start);
    expect(rt.path).toEqual([]);
    expect(p.status).toBe("dead");
    const resolved = ofType(events, "resolved");
    expect(resolved).toHaveLength(1);
    expect(resolved[0].result.outcome).toBe("died");
    expect(resolved[0].result.lost).toEqual(gear("knife"));
    // The only player is down, so the raid ends right away, without a second (mia) resolution.
    expect(ofType(events, "raidEnded")).toHaveLength(1);
    expect(world.state.phase).toBe("ended");
  });

  it("systems still run on the tick the last player goes down", () => {
    const { world, rt } = activeSolo({ raidSeconds: 60 });
    let runs = 0;
    world.systems.push(() => { runs++; });
    world.actions.attack = (w, pl, r) => resolvePlayer(w, pl, r, "died");
    enqueueClientMessage(rt.inputs, "attack", { x: 1, y: 1 });
    step(world, TICK_MS);
    expect(runs).toBe(1);
    step(world, TICK_MS); // the raid is over: no more system ticks
    expect(runs).toBe(1);
  });
});

describe("lag-compensation history", () => {
  it("is empty in the lobby; the raid start seeds one published sample at the spawn", () => {
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 1000 });
    addPlayer(w, "a", "alice", []);
    run(w, 10);
    expect(w.players.get("a")!.history).toEqual([]);
    addPlayer(w, "b", "bob", []);
    step(w, TICK_MS); // lobby -> active
    expect(w.state.phase).toBe("active");
    for (const id of ["a", "b"]) {
      const p = player(w, id);
      expect(w.players.get(id)!.history).toEqual([{ t: w.state.serverTime, x: p.x, y: p.y }]);
    }
  });

  it("starting the raid discards any history left over from before it", () => {
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 1000 });
    addPlayer(w, "a", "alice", []);
    addPlayer(w, "b", "bob", []);
    w.players.get("a")!.history.push({ t: -500, x: 1, y: 1 }); // stale: it would let attackers rewind into the lobby
    step(w, TICK_MS);
    expect(w.state.phase).toBe("active");
    const a = player(w, "a");
    expect(w.players.get("a")!.history).toEqual([{ t: w.state.serverTime, x: a.x, y: a.y }]);
  });

  it("records every alive player once per step, after movement, including idle ones", () => {
    const { world, a, b, rtA, rtB } = activePair({ raidSeconds: 60 });
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
    const { world, a, rtA } = activePair({ raidSeconds: 120 });
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
    const { world, a, rtA } = activePair({ raidSeconds: 120 });
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
    const { world, rtA, rtB } = activePair({ raidSeconds: 60 });
    world.actions.attack = (w, pl, r) => { if (r.id === "a") resolvePlayer(w, pl, r, "died"); };
    run(world, 3);
    expect(rtA.history).toHaveLength(4); // spawn sample + 3 steps
    enqueueClientMessage(rtA.inputs, "attack", { x: 1, y: 1 });
    run(world, 6);
    expect(player(world, "a").status).toBe("dead");
    expect(rtA.history).toHaveLength(4); // not recorded on the tick they died, nor afterwards
    expect(rtA.history.at(-1)!.t).toBe(4 * TICK_MS); // the start step is the first tick
    expect(rtB.history.at(-1)!.t).toBe(world.state.serverTime);
    expect(world.state.phase).toBe("active");
  });

  it("stops recording once the raid has ended", () => {
    const { world, rtA } = activePair({ raidSeconds: 1 });
    run(world, 25);
    expect(world.state.phase).toBe("ended");
    const frozen = rtA.history.map((s) => ({ ...s }));
    expect(frozen.length).toBeGreaterThan(0);
    run(world, 10);
    expect(rtA.history).toEqual(frozen);
  });
});

describe("raid end by timer", () => {
  it("ends exactly when serverTime reaches raidEndsAt", () => {
    const { world } = activeSolo({ raidSeconds: 2 });
    const endsAt = world.state.raidEndsAt;
    expect(endsAt).toBe(TICK_MS + 2000);
    // Step until one tick before the deadline.
    while (world.state.serverTime < endsAt - TICK_MS) {
      expect(step(world, TICK_MS)).toEqual([]);
      expect(world.state.phase).toBe("active");
    }
    expect(world.state.serverTime).toBe(endsAt - TICK_MS);
    const events = step(world, TICK_MS);
    expect(world.state.serverTime).toBe(endsAt);
    expect(world.state.phase).toBe("ended");
    expect(ofType(events, "raidEnded")).toHaveLength(1);
  });

  it("resolves every alive player as MIA with `lost` equal to what they carried", () => {
    const aItems = gear("knife", "gold", "medkit");
    const bItems = gear("gpu");
    const { world: w } = activePair({ raidSeconds: 2 }, aItems, bItems);
    const events = run(w, 41);
    expect(w.state.phase).toBe("ended");
    const resolved = ofType(events, "resolved");
    expect(resolved).toHaveLength(2);
    const byId = new Map(resolved.map((e) => [e.id, e.result]));
    expect(byId.get("a")).toEqual({
      outcome: "mia", profile: "alice", durationSec: 2, kills: 0, killedBy: null,
      broughtIn: aItems, extracted: [], lost: aItems,
    });
    expect(byId.get("b")).toEqual({
      outcome: "mia", profile: "bob", durationSec: 2, kills: 0, killedBy: null,
      broughtIn: bItems, extracted: [], lost: bItems,
    });
    expect(player(w, "a").status).toBe("mia");
    expect(player(w, "b").status).toBe("mia");
    // resolved events come before the single raidEnded
    expect(events.map((e) => e.type)).toEqual(["resolved", "resolved", "raidEnded"]);
  });

  it("MIA players with nothing on them lose nothing", () => {
    const { world } = activeSolo({ raidSeconds: 1 }, []);
    const events = run(world, 25);
    const [r] = ofType(events, "resolved");
    expect(r.result.outcome).toBe("mia");
    expect(r.result.lost).toEqual([]);
    expect(r.result.broughtIn).toEqual([]);
  });

  it("`lost` reflects the inventory at the deadline, not the loadout they brought", () => {
    const items = gear("knife", "gold");
    const { world, rt } = activeSolo({ raidSeconds: 1 }, items);
    world.actions.drop = (_w, p, _rt, cmd) => {
      if (cmd.kind !== "drop") return;
      for (let i = p.inventory.length - 1; i >= 0; i--) if (p.inventory[i].uid === cmd.uid) p.inventory.splice(i, 1);
    };
    enqueueClientMessage(rt.inputs, "drop", { uid: items[1].uid });
    const [r] = ofType(run(world, 25), "resolved");
    expect(r.result.broughtIn).toEqual(items);
    expect(r.result.lost).toEqual([items[0]]);
  });

  it("the default dropBody discards a downed player's inventory", () => {
    const { world, p } = activeSolo({ raidSeconds: 1 }, gear("rifle", "watch"));
    expect(p.inventory.length).toBe(2);
    run(world, 25);
    expect(p.inventory.length).toBe(0);
  });

  it("reports the raid duration in whole seconds", () => {
    const { world } = activeSolo({ raidSeconds: 3 });
    const [r] = ofType(run(world, 70), "resolved");
    expect(r.result.durationSec).toBe(3);
  });

  it("emits raidEnded exactly once and further steps do nothing", () => {
    const { world, startEvents } = activeSolo({ raidSeconds: 1 }, gear("knife"));
    const all = [...startEvents, ...run(world, 200)];
    expect(ofType(all, "raidEnded")).toHaveLength(1);
    expect(ofType(all, "resolved")).toHaveLength(1);
    expect(world.state.phase).toBe("ended");

    const snapshot = JSON.stringify([...world.state.players.values()].map((p) => [p.x, p.y, p.status, p.hp]));
    for (let i = 0; i < 50; i++) expect(step(world, TICK_MS)).toEqual([]);
    expect(JSON.stringify([...world.state.players.values()].map((p) => [p.x, p.y, p.status, p.hp]))).toBe(snapshot);
    expect(world.state.phase).toBe("ended");
  });

  it("ignores inputs sent after the raid ended", () => {
    const { world, p, rt } = activeSolo({ raidSeconds: 1 });
    run(world, 25);
    expect(world.state.phase).toBe("ended");
    const start = posOf(p);
    enqueueClientMessage(rt.inputs, "move", world.map.groundSpots[0]!);
    expect(run(world, 10)).toEqual([]);
    expect(posOf(p)).toEqual(start);
  });

  it("a player who was mid-walk when time ran out stays where they were", () => {
    const { world, p, rt } = activeSolo({ raidSeconds: 1 });
    enqueueClientMessage(rt.inputs, "move", farthestSpawn(world, posOf(p)));
    run(world, 25);
    expect(world.state.phase).toBe("ended");
    expect(rt.path).toEqual([]); // resolvePlayer clears the path
    const { x, y } = p;
    run(world, 10);
    expect([p.x, p.y]).toEqual([x, y]);
  });
});

describe("dropBody hook", () => {
  interface Call { world: World; player: unknown; status: string; held: string[] }
  /** Replaces the world's hook with a recorder that deliberately leaves the inventory alone. */
  function recordDrops(world: World): Call[] {
    const calls: Call[] = [];
    world.hooks.dropBody = (w, p) => {
      calls.push({ world: w, player: p, status: p.status, held: p.inventory.map((i) => i.uid) });
    };
    return calls;
  }
  const dieOnAttack = (world: World) => {
    world.actions.attack = (w, p, rt) => resolvePlayer(w, p, rt, "died");
  };

  it("runs when a player dies, after their status flips, with the inventory still on them", () => {
    const items = gear("rifle", "watch");
    const { world, a, rtA } = activePair({ raidSeconds: 60 }, items);
    dieOnAttack(world);
    const calls = recordDrops(world);
    enqueueClientMessage(rtA.inputs, "attack", { x: 1, y: 1 });
    const events = step(world, TICK_MS);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.world).toBe(world);
    expect(calls[0]!.player).toBe(a);
    expect(calls[0]!.status).toBe("dead");
    expect(calls[0]!.held).toEqual(["rifle#0", "watch#1"]);
    // The hook replaces the default discard, so what it leaves behind stays on the player.
    expect(a.inventory.length).toBe(2);
    expect(ofType(events, "resolved")[0]!.result.lost).toEqual(items);
  });

  it("the default hook discards the inventory of a player who died", () => {
    const items = gear("rifle", "watch");
    const { world, a, rtA } = activePair({ raidSeconds: 60 }, items);
    dieOnAttack(world);
    enqueueClientMessage(rtA.inputs, "attack", { x: 1, y: 1 });
    const events = step(world, TICK_MS);
    expect(a.inventory.length).toBe(0);
    expect(ofType(events, "resolved")[0]!.result.lost).toEqual(items);
  });

  it("`lost` is computed before the hook runs, so a hook that empties the inventory cannot erase it", () => {
    const items = gear("gold", "gpu");
    const { world, rtA } = activePair({ raidSeconds: 60 }, items);
    dieOnAttack(world);
    world.hooks.dropBody = (_w, p) => { p.inventory.clear(); };
    enqueueClientMessage(rtA.inputs, "attack", { x: 1, y: 1 });
    const [r] = ofType(step(world, TICK_MS), "resolved");
    expect(r.result.lost).toEqual(items);
  });

  it("runs for every alive player when the raid times out (mia)", () => {
    const { world } = activePair({ raidSeconds: 1 }, gear("knife"), gear("gold"));
    const calls = recordDrops(world);
    run(world, 25);
    expect(world.state.phase).toBe("ended");
    expect(calls.map((c) => c.status)).toEqual(["mia", "mia"]);
    expect(calls.map((c) => c.held)).toEqual([["knife#0"], ["gold#0"]]);
  });

  it("runs synchronously when removePlayer resolves an alive player as mia", () => {
    const { world, a } = activePair({ raidSeconds: 60 }, gear("rifle"));
    const calls = recordDrops(world);
    removePlayer(world, "a");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.player).toBe(a);
    expect(calls[0]!.status).toBe("mia");
    expect(calls[0]!.held).toEqual(["rifle#0"]);
  });

  it("does not run for an extraction, which hands the inventory over instead", () => {
    const items = gear("gold", "gpu");
    const { world, a, rtA } = activePair({ raidSeconds: 60 }, items);
    world.actions.extract = (w, p, rt) => resolvePlayer(w, p, rt, "extracted");
    const calls = recordDrops(world);
    enqueueClientMessage(rtA.inputs, "extract", {});
    const [r] = ofType(step(world, TICK_MS), "resolved");
    expect(calls).toEqual([]);
    expect(r.result).toMatchObject({ outcome: "extracted", extracted: items, lost: [] });
    expect(a.inventory.length).toBe(0);
    expect(a.status).toBe("extracted");
  });

  it("runs once per player even if they are resolved again later", () => {
    const { world, rtA } = activePair({ raidSeconds: 1 }, gear("knife"), gear("gold"));
    dieOnAttack(world);
    const calls = recordDrops(world);
    enqueueClientMessage(rtA.inputs, "attack", { x: 1, y: 1 });
    step(world, TICK_MS);
    removePlayer(world, "a"); // already dead: no mia on top
    run(world, 25); // the deadline resolves only b
    expect(calls.map((c) => c.status)).toEqual(["dead", "mia"]);
  });

  it("does not run for a player who leaves during the lobby", () => {
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 1000 });
    const calls = recordDrops(w);
    addPlayer(w, "a", "alice", gear("gold"));
    removePlayer(w, "a");
    expect(calls).toEqual([]);
  });

  it("can emit events that are delivered with that step's events", () => {
    const { world, rtA } = activePair({ raidSeconds: 60 }, gear("gold"));
    dieOnAttack(world);
    world.hooks.dropBody = (w, p) => {
      emit(w, { type: "toast", to: "b", text: `${p.name} dropped a body` });
    };
    enqueueClientMessage(rtA.inputs, "attack", { x: 1, y: 1 });
    const events = step(world, TICK_MS);
    expect(ofType(events, "toast")).toEqual([{ type: "toast", to: "b", text: "alice dropped a body" }]);
    expect(ofType(events, "resolved")).toHaveLength(1);
  });
});

describe("removePlayer", () => {
  it("resolves an alive player in an active raid as MIA, losing what they carried", () => {
    const items = gear("rifle", "gpu");
    const { world: w } = activePair({ raidSeconds: 100 }, items, gear("knife"));
    run(w, 40); // 2 seconds into the raid

    removePlayer(w, "a");
    expect(w.state.players.has("a")).toBe(false);
    expect(w.players.has("a")).toBe(false);

    const events = step(w, TICK_MS);
    const resolved = ofType(events, "resolved");
    expect(resolved).toHaveLength(1);
    expect(resolved[0].id).toBe("a");
    expect(resolved[0].result).toMatchObject({
      outcome: "mia", profile: "alice", broughtIn: items, extracted: [], lost: items, kills: 0, killedBy: null,
    });
    expect(resolved[0].result.durationSec).toBe(2);
    // The other player keeps the raid alive.
    expect(ofType(events, "raidEnded")).toHaveLength(0);
    expect(w.state.phase).toBe("active");
    expect(player(w, "b").status).toBe("alive");
  });

  it("queues the event immediately so the Room can flush it with the next step", () => {
    const { world: w } = activePair({ raidSeconds: 100 }, gear("watch"));
    removePlayer(w, "a");
    expect(w.events).toHaveLength(1);
    expect(w.events[0]).toMatchObject({ type: "resolved", id: "a", result: { outcome: "mia" } });
  });

  it("ends the raid when the last alive player leaves, resolving them once", () => {
    const { world } = activeSolo({ raidSeconds: 100 }, gear("gold"));
    run(world, 5);
    removePlayer(world, "a");
    const events = step(world, TICK_MS);
    expect(events.map((e) => e.type)).toEqual(["resolved", "raidEnded"]);
    expect(world.state.phase).toBe("ended");
    expect(ofType(events, "resolved")[0].result.lost).toEqual(gear("gold"));
  });

  it("emits nothing for a player who leaves during the lobby", () => {
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 1000 });
    addPlayer(w, "a", "alice", gear("gold"));
    removePlayer(w, "a");
    expect(w.events).toEqual([]);
    expect(w.state.players.size).toBe(0);
    expect(w.players.size).toBe(0);
    expect(run(w, 5)).toEqual([]);
  });

  it("does not resolve a player twice (already MIA after the raid ended)", () => {
    const { world } = activeSolo({ raidSeconds: 1 }, gear("gold"));
    run(world, 25);
    expect(world.state.phase).toBe("ended");
    removePlayer(world, "a");
    expect(world.events).toEqual([]);
    expect(step(world, TICK_MS)).toEqual([]);
  });

  it("does not resolve a player who is already dead", () => {
    const { world: w } = activePair({ raidSeconds: 100 }, gear("gold"));
    w.actions.attack = (world, p, rt) => resolvePlayer(world, p, rt, "died");
    enqueueClientMessage(w.players.get("a")!.inputs, "attack", { x: 1, y: 1 });
    const events = step(w, TICK_MS);
    expect(ofType(events, "resolved")).toHaveLength(1);
    removePlayer(w, "a");
    expect(step(w, TICK_MS)).toEqual([]); // no mia event on top of the death
    expect(w.state.phase).toBe("active");
  });

  it("is a no-op for an unknown id", () => {
    const w = makeWorld();
    addPlayer(w, "a", "alice", []);
    expect(() => removePlayer(w, "ghost")).not.toThrow();
    expect(w.state.players.size).toBe(1);
    expect(w.events).toEqual([]);
  });

  it("a removed player's pending inputs are discarded with them", () => {
    const { world: w } = activePair({ raidSeconds: 100 });
    enqueueClientMessage(w.players.get("a")!.inputs, "move", w.map.groundSpots[0]!);
    removePlayer(w, "a");
    expect(() => run(w, 5)).not.toThrow();
    expect(w.state.players.has("a")).toBe(false);
  });
});

describe("determinism", () => {
  it("identical inputs produce identical worlds", () => {
    const simulate = () => {
      const w = makeWorld({ minPlayers: 2, raidSeconds: 5 });
      addPlayer(w, "a", "alice", gear("knife"));
      addPlayer(w, "b", "bob", gear("gold"));
      step(w, TICK_MS);
      enqueueClientMessage(w.players.get("a")!.inputs, "move", w.map.groundSpots[2]!);
      enqueueClientMessage(w.players.get("b")!.inputs, "move", w.map.groundSpots[9]!);
      const events = run(w, 150);
      return {
        events,
        players: [...w.state.players.entries()].map(([id, p]) => [id, p.x, p.y, p.facing, p.status]),
        history: [...w.players.values()].map((rt) => rt.history),
        time: w.state.serverTime,
      };
    };
    const first = simulate();
    expect(first.players.every(([, x, y]) => typeof x === "number" && typeof y === "number")).toBe(true);
    expect(simulate()).toEqual(first);
  });

  it("a different random stream changes the spawns, and nothing else is random", () => {
    const spawnsFor = (s: number) => {
      const w = makeWorld({ minPlayers: 2 }, 1234, mulberry32(s));
      addPlayer(w, "a", "alice", []);
      addPlayer(w, "b", "bob", []);
      step(w, TICK_MS);
      return [posOf(player(w, "a")), posOf(player(w, "b"))];
    };
    expect(spawnsFor(1)).toEqual(spawnsFor(1));
    const variants = new Set([1, 2, 3, 4, 5, 6].map((s) => JSON.stringify(spawnsFor(s))));
    expect(variants.size).toBeGreaterThan(1);
  });
});

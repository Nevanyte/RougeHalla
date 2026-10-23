import { describe, expect, it, vi } from "vitest";
import {
  generateMap, hasLineOfSight, INTERACT_RANGE, INVENTORY_SLOTS, isWallTile, ITEMS, mulberry32, TICK_MS, TILE, withGates,
  type ContainerKind, type GameMap, type GateDef, type GateSide, type HealingDef, type ItemDTO, type Vec2,
} from "@raid/shared";
import { ContainerState, ItemState, type PlayerState } from "@raid/shared/schema";
import { downPlayer } from "../src/sim/arena";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { dropBody, handleDrop, handleTake, handleUse, install, spawnLoot } from "../src/sim/loot";
import {
  CRATE_SIZES, GROUND_EXCLUDED, GROUND_TABLE, LOOT_TABLE, rollCrate, rollGroundItem, rollItem,
} from "../src/sim/lootTables";
import { actionOrder, addPlayer, removePlayer, step } from "../src/sim/step";
import { createWorld, nextId, type SimConfig, type SimEvent, type World } from "../src/sim/world";

type EventOf<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;

const BANDAGE = ITEMS.bandage as HealingDef;
const MEDKIT = ITEMS.medkit as HealingDef;

/** Loot uids come from a counter so assertions never depend on UUIDs; the "L" prefix can't clash with `gear`. */
function makeWorld(cfg: Partial<SimConfig> = {}, seed = 1234, random = mulberry32(seed + 1)): World {
  let n = 0;
  const patienceSeconds = cfg.patienceSeconds ?? 3600;
  const config: SimConfig = {
    minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds, patienceMinSeconds: patienceSeconds,
    suddenDeathSeconds: 60, ...cfg,
  };
  return createGameWorld({ seed, config, random, newItemUid: () => `L${++n}` });
}

const gear = (...defs: string[]): ItemDTO[] => defs.map((def, i) => ({ uid: `${def}#${i}`, def }));

interface Seat { id: string; name: string; items?: ItemDTO[] }
const alice = (items: ItemDTO[] = []): Seat => ({ id: "a", name: "alice", items });
const bob = (items: ItemDTO[] = []): Seat => ({ id: "b", name: "bob", items });
const carol = (items: ItemDTO[] = []): Seat => ({ id: "c", name: "carol", items });
const SEATS: Record<string, (items?: ItemDTO[]) => Seat> = { a: alice, b: bob, c: carol };

/** addPlayer mints the run kit; tests want exact contents, so the kit is swapped for `items`. */
function setGear(p: PlayerState, items: ItemDTO[]): void {
  p.inventory.clear();
  for (const it of items) {
    const item = new ItemState();
    item.uid = it.uid;
    item.def = it.def;
    p.inventory.push(item);
  }
}

/** Seats join in the given order (which is the order the sim iterates players); the raid starts on the first step. */
function startRaid(seats: Seat[], cfg: Partial<SimConfig> = {}): World {
  const world = makeWorld({ minPlayers: seats.length, ...cfg });
  for (const s of seats) setGear(addPlayer(world, s.id, s.name), s.items ?? []);
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  return world;
}

const P = (world: World, id: string): PlayerState => world.state.players.get(id)!;
const RT = (world: World, id: string) => world.players.get(id)!;

/** Puts a player at an exact spot; the sim only moves players that have a path. */
function place(world: World, id: string, at: Vec2): void {
  const p = P(world, id);
  p.x = at.x;
  p.y = at.y;
}

const send = (world: World, id: string, type: string, msg: unknown) =>
  expect(enqueueClientMessage(RT(world, id).inputs, type, msg)).toBe(true);

function ofType<T extends SimEvent["type"]>(events: SimEvent[], type: T): Array<EventOf<T>> {
  return events.filter((e): e is EventOf<T> => e.type === type);
}

const toastsOf = (events: SimEvent[]) => ofType(events, "toast").map((e) => ({ to: e.to, text: e.text }));

const dto = (items: Iterable<{ uid: string; def: string }>): ItemDTO[] =>
  Array.from(items, (i) => ({ uid: i.uid, def: i.def }));

/** Hand-built container so tests control exactly what is in it (and don't depend on rolled loot). */
function putContainer(world: World, kind: ContainerKind, at: Vec2, defs: string[]): ContainerState {
  const c = new ContainerState();
  c.id = nextId(world, "t");
  c.kind = kind;
  c.x = at.x;
  c.y = at.y;
  c.label = kind;
  for (const def of defs) {
    const item = new ItemState();
    item.uid = world.newItemUid();
    item.def = def;
    c.items.push(item);
  }
  world.state.containers.set(c.id, c);
  return c;
}

/** Everything a loot action could change, for "nothing happened" assertions. */
function dump(world: World): string {
  const players: unknown[] = [];
  for (const [id, p] of world.state.players) players.push([id, p.hp, p.x, p.y, dto(p.inventory)]);
  const containers: unknown[] = [];
  for (const [id, c] of world.state.containers) containers.push([id, c.kind, c.x, c.y, c.label, dto(c.items)]);
  return JSON.stringify({ players, containers });
}

const AT: Vec2 = { x: 100, y: 100 };

/** Line-of-sight tests need real geometry: a one-tile-thick wall with floor on both sides, on the default test map. */
function findSlab(map: GameMap): { west: number; east: number; y: number } {
  for (let ty = 1; ty < map.h - 1; ty++) {
    for (let tx = 1; tx < map.w - 3; tx++) {
      if (!isWallTile(map, tx, ty) && isWallTile(map, tx + 1, ty) && !isWallTile(map, tx + 2, ty)) {
        // Stand a player radius off each face: the two spots are exactly INTERACT_RANGE apart.
        return { west: (tx + 1) * TILE - 12, east: (tx + 2) * TILE + 12, y: ty * TILE + TILE / 2 };
      }
    }
  }
  throw new Error("no one-tile wall on the test map");
}
const SLAB = findSlab(generateMap(1234));
const WEST: Vec2 = { x: SLAB.west, y: SLAB.y };
const EAST: Vec2 = { x: SLAB.east, y: SLAB.y };
/** The id the next container will get, for tests playing a client that guesses ids. */
const nextContainerId = (world: World): string => `c${(world.idCounter + 1).toString(36)}`;
/** Steps until `id` is the first player processed on the following tick (see actionOrder). */
function stepUntilFirst(world: World, id: string): void {
  for (let i = 0; i < 1000 && actionOrder(world, world.state.tick + 1)[0] !== id; i++) step(world, TICK_MS);
  expect(actionOrder(world, world.state.tick + 1)[0]).toBe(id);
}

describe("loot tables", () => {
  const N = 10_000;

  /** Observed counts must sit within 5 sigma of the binomial expectation: loose, but catches a wrong table. */
  function expectProportional(counts: Map<string, number>, weights: Map<string, number>, n: number) {
    let total = 0;
    for (const w of weights.values()) total += w;
    for (const [key, w] of weights) {
      const p = w / total;
      const sigma = Math.sqrt(n * p * (1 - p));
      expect(Math.abs((counts.get(key) ?? 0) - n * p), `share of ${key}`).toBeLessThanOrEqual(5 * sigma);
    }
  }

  const tally = (keys: Iterable<string>) => {
    const m = new Map<string, number>();
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  };

  it("only references real catalog items, once each, with positive weights", () => {
    const ids = LOOT_TABLE.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of LOOT_TABLE) {
      expect(ITEMS[e.id], e.id).toBeDefined();
      expect(e.weight).toBeGreaterThan(0);
    }
    expect(CRATE_SIZES.map((s) => s.count)).toEqual([1, 2, 3]);
  });

  it("ships the designed weights", () => {
    expect(Object.fromEntries(LOOT_TABLE.map((e) => [e.id, e.weight]))).toEqual({
      watch: 20, gold: 8, gpu: 3, bandage: 18, medkit: 7, knife: 8, pistol: 8, rifle: 3, vest: 7, plate: 3,
    });
    expect(CRATE_SIZES.map((s) => s.weight)).toEqual([50, 35, 15]);
  });

  it("is deterministic for a given random() and varies with it", () => {
    const rolls = (seed: number) => {
      const r = mulberry32(seed);
      return Array.from({ length: 200 }, () => [rollItem(r), rollCrate(r), rollGroundItem(r)]);
    };
    expect(rolls(7)).toEqual(rolls(7));
    expect(rolls(7)).not.toEqual(rolls(8));
  });

  it("takes all of its entropy from the random() it is given", () => {
    const spy = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("Math.random used"); });
    try {
      const r = mulberry32(3);
      for (let i = 0; i < 100; i++) { rollItem(r); rollCrate(r); rollGroundItem(r); }
    } finally {
      spy.mockRestore();
    }
  });

  it("maps the ends of the unit interval to the first and last table entries", () => {
    expect(rollItem(() => 0)).toBe(LOOT_TABLE[0]!.id);
    expect(rollItem(() => 0.999999999)).toBe(LOOT_TABLE[LOOT_TABLE.length - 1]!.id);
    expect(rollGroundItem(() => 0)).toBe(GROUND_TABLE[0]!.id);
    expect(rollGroundItem(() => 0.999999999)).toBe(GROUND_TABLE[GROUND_TABLE.length - 1]!.id);
    expect(rollCrate(() => 0)).toHaveLength(1);
    expect(rollCrate(() => 0.999999999)).toHaveLength(3);
  });

  it("consumes one random() per item, plus one for a crate's size", () => {
    const counted = (fn: (r: () => number) => unknown) => {
      let calls = 0;
      const r = mulberry32(5);
      fn(() => { calls++; return r(); });
      return calls;
    };
    expect(counted(rollItem)).toBe(1);
    expect(counted(rollGroundItem)).toBe(1);
    // Size-first roll: random() below 0.5 is one item, so a constant 0.1 gives 1 size roll + 1 item roll.
    let calls = 0;
    expect(rollCrate(() => { calls++; return 0.1; })).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it("honors the item weights over 10k rolls", () => {
    const r = mulberry32(42);
    const counts = tally(Array.from({ length: N }, () => rollItem(r)));
    expectProportional(counts, new Map(LOOT_TABLE.map((e) => [e.id, e.weight])), N);
    // Sanity on the shape the weights are meant to give.
    expect(counts.get("watch")!).toBeGreaterThan(counts.get("gold")!);
    expect(counts.get("bandage")!).toBeGreaterThan(counts.get("medkit")!);
    expect(counts.get("pistol")!).toBeGreaterThan(counts.get("rifle")!);
  });

  it("rolls crates of 1-3 valid items, sized 50/35/15", () => {
    const r = mulberry32(43);
    const crates = Array.from({ length: N }, () => rollCrate(r));
    for (const c of crates) {
      expect(c.length).toBeGreaterThanOrEqual(1);
      expect(c.length).toBeLessThanOrEqual(3);
      for (const id of c) expect(ITEMS[id], id).toBeDefined();
    }
    const sizes = tally(crates.map((c) => String(c.length)));
    expectProportional(sizes, new Map([["1", 50], ["2", 35], ["3", 15]]), N);
    // Items inside crates follow the same table.
    expectProportional(tally(crates.flat()), new Map(LOOT_TABLE.map((e) => [e.id, e.weight])), crates.flat().length);
  });

  it("never rolls rifle, plate or gpu for floor items, and keeps the other weights", () => {
    const r = mulberry32(44);
    const rolls = Array.from({ length: N }, () => rollGroundItem(r));
    for (const id of GROUND_EXCLUDED) expect(rolls).not.toContain(id);
    expect([...GROUND_EXCLUDED].sort()).toEqual(["gpu", "plate", "rifle"]);
    const weights = new Map(LOOT_TABLE.filter((e) => !GROUND_EXCLUDED.has(e.id)).map((e) => [e.id, e.weight]));
    expect(new Set(rolls)).toEqual(new Set(weights.keys()));
    expectProportional(tally(rolls), weights, N);
  });
});

describe("spawnLoot / install", () => {
  it("is part of createGameWorld: handlers, body hook and containers are installed", () => {
    const world = makeWorld();
    expect(world.actions.take).toBe(handleTake);
    expect(world.actions.drop).toBe(handleDrop);
    expect(world.actions.use).toBe(handleUse);
    expect(world.hooks.dropBody).toBe(dropBody);
    expect(world.state.containers.size).toBe(world.map.crateSpots.length + world.map.groundSpots.length);
  });

  it("install() works on a bare world and registers nothing beyond loot", () => {
    const bare = createWorld({
      seed: 1234, config: { minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 60 },
      random: mulberry32(9),
    });
    expect(bare.state.containers.size).toBe(0);
    install(bare);
    expect(Object.keys(bare.actions).sort()).toEqual(["drop", "take", "use"]);
    expect(bare.systems).toEqual([]);
    expect(bare.state.containers.size).toBe(bare.map.crateSpots.length + bare.map.groundSpots.length);
  });

  it("creates one container per spot, in spot order, with unique ids and unique item uids", () => {
    const world = makeWorld();
    const { crateSpots, groundSpots } = world.map;
    expect(crateSpots.length).toBeGreaterThan(0);
    expect(groundSpots.length).toBeGreaterThan(0);

    const all = [...world.state.containers.values()];
    expect(all).toHaveLength(crateSpots.length + groundSpots.length);
    for (const [key, c] of world.state.containers) expect(c.id).toBe(key);
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);

    const uids = all.flatMap((c) => c.items.map((i) => i.uid));
    expect(uids.length).toBeGreaterThan(all.length - 1);
    expect(new Set(uids).size).toBe(uids.length);

    const crates = all.filter((c) => c.kind === "crate");
    const ground = all.filter((c) => c.kind === "ground");
    expect(crates.map((c) => ({ x: c.x, y: c.y }))).toEqual(crateSpots);
    expect(ground.map((c) => ({ x: c.x, y: c.y }))).toEqual(groundSpots);
    expect(crates.length + ground.length).toBe(all.length);
  });

  it("fills crates with 1-3 items and ground spots with one non-premium item named after it", () => {
    const world = makeWorld();
    for (const c of world.state.containers.values()) {
      for (const i of c.items) expect(ITEMS[i.def], i.def).toBeDefined();
      if (c.kind === "crate") {
        expect(c.label).toBe("Crate");
        expect(c.items.length).toBeGreaterThanOrEqual(1);
        expect(c.items.length).toBeLessThanOrEqual(3);
      } else {
        expect(c.kind).toBe("ground");
        expect(c.items).toHaveLength(1);
        expect(c.label).toBe(ITEMS[c.items[0]!.def]!.name);
        expect(GROUND_EXCLUDED.has(c.items[0]!.def)).toBe(false);
      }
    }
  });

  it("is reproducible from world.random alone, and independent of the public map seed", () => {
    const sameRandom = (seed: number, rnd: number) => dump(makeWorld({}, seed, mulberry32(rnd)));
    expect(sameRandom(1234, 1)).toBe(sameRandom(1234, 1));
    expect(sameRandom(1234, 1)).not.toBe(sameRandom(1234, 2));

    // Same public seed (so same map and spots) but a different server rng: same places, different contents.
    const a = makeWorld({}, 1234, mulberry32(1));
    const b = makeWorld({}, 1234, mulberry32(2));
    const places = (w: World) => [...w.state.containers.values()].map((c) => [c.kind, c.x, c.y]);
    const contents = (w: World) => [...w.state.containers.values()].map((c) => dto(c.items).map((i) => i.def));
    expect(places(a)).toEqual(places(b));
    expect(contents(a)).not.toEqual(contents(b));
  });

  it("does not touch Math.random", () => {
    const spy = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("Math.random used"); });
    try {
      expect(() => makeWorld()).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });

  it("falls back to unique UUIDs for item uids when the world isn't given a counter", () => {
    const world = createGameWorld({
      seed: 5,
      config: { minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 60 },
      random: mulberry32(1),
    });
    const uids = [...world.state.containers.values()].flatMap((c) => c.items.map((i) => i.uid));
    expect(uids.length).toBeGreaterThan(0);
    expect(new Set(uids).size).toBe(uids.length);
  });

  it("draws container ids from the world counter, so a later spawn never overwrites earlier containers", () => {
    const world = makeWorld();
    const before = world.state.containers.size;
    spawnLoot(world);
    expect(world.state.containers.size).toBe(before * 2);
    const uids = [...world.state.containers.values()].flatMap((c) => c.items.map((i) => i.uid));
    expect(new Set(uids).size).toBe(uids.length);
  });
});

describe("take", () => {
  it("moves the item into the inventory as a fresh ItemState with the same uid and def", () => {
    const world = startRaid([alice()]);
    const crate = putContainer(world, "crate", AT, ["gold", "knife"]);
    const original = crate.items[0]!;
    const { uid, def } = original;
    place(world, "a", AT);

    send(world, "a", "take", { containerId: crate.id, uid });
    expect(step(world, TICK_MS)).toEqual([]);

    expect(dto(P(world, "a").inventory)).toEqual([{ uid, def: "gold" }]);
    expect(P(world, "a").inventory[0]).not.toBe(original);
    expect(dto(crate.items).map((i) => i.def)).toEqual(["knife"]);
    expect(crate.items.some((i) => i.uid === uid)).toBe(false);
  });

  it("works from inside a generated crate, one item at a time, and conserves items", () => {
    const world = startRaid([alice()]);
    const crate = [...world.state.containers.values()].find((c) => c.kind === "crate")!;
    const loot = dto(crate.items);
    place(world, "a", crate);

    for (const it of loot) send(world, "a", "take", { containerId: crate.id, uid: it.uid });
    expect(toastsOf(step(world, TICK_MS))).toEqual([]);

    expect(dto(P(world, "a").inventory)).toEqual(loot);
    expect(crate.items).toHaveLength(0);
    expect(world.state.containers.get(crate.id)).toBe(crate);
  });

  it("accepts a player exactly INTERACT_RANGE away and refuses one just beyond it", () => {
    const world = startRaid([alice(), bob()]);
    const crate = putContainer(world, "crate", AT, ["gold", "watch"]);
    place(world, "a", { x: AT.x + INTERACT_RANGE, y: AT.y });
    place(world, "b", { x: AT.x, y: AT.y + INTERACT_RANGE + 0.5 });

    send(world, "a", "take", { containerId: crate.id, uid: crate.items[0]!.uid });
    send(world, "b", "take", { containerId: crate.id, uid: crate.items[1]!.uid });
    const events = step(world, TICK_MS);

    expect(P(world, "a").inventory).toHaveLength(1);
    expect(P(world, "b").inventory).toHaveLength(0);
    expect(toastsOf(events)).toEqual([{ to: "b", text: "Too far away" }]);
    expect(dto(crate.items).map((i) => i.def)).toEqual(["watch"]);
  });

  it("toasts 'Too far away' to the actor and changes nothing", () => {
    const world = startRaid([alice(gear("knife"))]);
    const crate = putContainer(world, "crate", AT, ["gold"]);
    place(world, "a", { x: AT.x + 400, y: AT.y });
    const before = dump(world);

    send(world, "a", "take", { containerId: crate.id, uid: crate.items[0]!.uid });
    expect(toastsOf(step(world, TICK_MS))).toEqual([{ to: "a", text: "Too far away" }]);
    expect(dump(world)).toBe(before);
  });

  it("toasts 'Item is gone' for a uid that isn't in the container, changing nothing", () => {
    const world = startRaid([alice()]);
    const crate = putContainer(world, "crate", AT, ["gold"]);
    place(world, "a", AT);
    const before = dump(world);

    send(world, "a", "take", { containerId: crate.id, uid: "no-such-uid" });
    expect(toastsOf(step(world, TICK_MS))).toEqual([{ to: "a", text: "Item is gone" }]);
    expect(dump(world)).toBe(before);
  });

  it("refuses a uid that lives in a different container", () => {
    const world = startRaid([alice()]);
    const one = putContainer(world, "crate", AT, ["gold"]);
    const two = putContainer(world, "crate", AT, ["watch"]);
    place(world, "a", AT);
    const before = dump(world);

    send(world, "a", "take", { containerId: one.id, uid: two.items[0]!.uid });
    expect(toastsOf(step(world, TICK_MS))).toEqual([{ to: "a", text: "Item is gone" }]);
    expect(dump(world)).toBe(before);
  });

  it("toasts 'Item is gone' for a container that doesn't exist, changing nothing", () => {
    const world = startRaid([alice()]);
    const crate = putContainer(world, "crate", AT, ["gold"]);
    place(world, "a", AT);
    const before = dump(world);

    send(world, "a", "take", { containerId: "nope", uid: crate.items[0]!.uid });
    expect(toastsOf(step(world, TICK_MS))).toEqual([{ to: "a", text: "Item is gone" }]);
    expect(dump(world)).toBe(before);
  });

  it("toasts 'Inventory full' when every slot is used, changing nothing", () => {
    const full = Array.from({ length: INVENTORY_SLOTS }, (_, i) => ({ uid: `own#${i}`, def: "watch" }));
    const world = startRaid([alice(full)]);
    const crate = putContainer(world, "crate", AT, ["gold"]);
    place(world, "a", AT);
    const before = dump(world);

    send(world, "a", "take", { containerId: crate.id, uid: crate.items[0]!.uid });
    expect(toastsOf(step(world, TICK_MS))).toEqual([{ to: "a", text: "Inventory full" }]);
    expect(dump(world)).toBe(before);
    expect(P(world, "a").inventory).toHaveLength(INVENTORY_SLOTS);
  });

  it("fills the last free slot but not one more", () => {
    const nearlyFull = Array.from({ length: INVENTORY_SLOTS - 1 }, (_, i) => ({ uid: `own#${i}`, def: "watch" }));
    const world = startRaid([alice(nearlyFull)]);
    const crate = putContainer(world, "crate", AT, ["gold", "gpu"]);
    place(world, "a", AT);

    send(world, "a", "take", { containerId: crate.id, uid: crate.items[0]!.uid });
    send(world, "a", "take", { containerId: crate.id, uid: crate.items[1]!.uid });
    const events = step(world, TICK_MS);

    expect(P(world, "a").inventory).toHaveLength(INVENTORY_SLOTS);
    expect(P(world, "a").inventory[INVENTORY_SLOTS - 1]!.def).toBe("gold");
    expect(toastsOf(events)).toEqual([{ to: "a", text: "Inventory full" }]);
    expect(dto(crate.items).map((i) => i.def)).toEqual(["gpu"]);
  });

  it("checks container, then distance, then item, then space", () => {
    const full = Array.from({ length: INVENTORY_SLOTS }, (_, i) => ({ uid: `own#${i}`, def: "watch" }));
    const world = startRaid([alice(full)]);
    const crate = putContainer(world, "crate", AT, ["gold"]);
    const take = (containerId: string, uid: string) => {
      send(world, "a", "take", { containerId, uid });
      return toastsOf(step(world, TICK_MS)).map((t) => t.text);
    };

    place(world, "a", { x: AT.x + 500, y: AT.y });
    expect(take("nope", "nope")).toEqual(["Item is gone"]); // no container beats "too far"
    expect(take(crate.id, "nope")).toEqual(["Too far away"]); // too far beats unknown item
    place(world, "a", AT);
    expect(take(crate.id, "nope")).toEqual(["Item is gone"]); // unknown item beats full inventory
    expect(take(crate.id, crate.items[0]!.uid)).toEqual(["Inventory full"]);
  });

  it("sends failure toasts only to the player who failed", () => {
    const world = startRaid([alice(), bob()]);
    const crate = putContainer(world, "crate", AT, ["gold"]);
    place(world, "a", { x: AT.x + 500, y: AT.y });
    place(world, "b", AT);

    send(world, "a", "take", { containerId: crate.id, uid: crate.items[0]!.uid });
    expect(toastsOf(step(world, TICK_MS))).toEqual([{ to: "a", text: "Too far away" }]);
    expect(P(world, "b").inventory).toHaveLength(0);
  });

  it("lets a player loot a body", () => {
    const world = startRaid([alice(), bob(gear("rifle")), carol()]); // carol keeps the run going
    place(world, "b", AT);
    downPlayer(world, P(world, "b"), RT(world, "b"), "died");
    const body = [...world.state.containers.values()].find((c) => c.kind === "body")!;
    place(world, "a", { x: AT.x + 10, y: AT.y });
    step(world, TICK_MS); // created between ticks: clients first see it in this tick's patch

    send(world, "a", "take", { containerId: body.id, uid: "rifle#0" });
    step(world, TICK_MS);
    expect(dto(P(world, "a").inventory)).toEqual([{ uid: "rifle#0", def: "rifle" }]);
    expect(body.items).toHaveLength(0);
  });

  /** Seats join in `ids` order, idle `idle` ticks, then all take the same item in one tick. */
  function contest(ids: string[], kind: ContainerKind, idle: number) {
    const world = startRaid(ids.map((id) => SEATS[id]!()));
    for (let i = 0; i < idle; i++) step(world, TICK_MS);
    const container = putContainer(world, kind, AT, ["gold"]);
    const { uid } = container.items[0]!;
    for (const id of ids) { place(world, id, AT); send(world, id, "take", { containerId: container.id, uid }); }
    const events = step(world, TICK_MS);
    const winners = ids.filter((id) => P(world, id).inventory.length === 1);
    return { world, container, uid, events, winners };
  }

  it("gives an item taken by several players in the same tick to exactly one of them", () => {
    for (const ids of [["a", "b"], ["b", "a"], ["a", "b", "c"], ["c", "a", "b"]]) {
      for (let idle = 0; idle < 6; idle++) {
        const { world, container, uid, events, winners } = contest(ids, "crate", idle);
        const label = `${ids.join("")} after ${idle} idle ticks`;
        expect(winners, label).toHaveLength(1);
        expect(dto(P(world, winners[0]!).inventory), label).toEqual([{ uid, def: "gold" }]);
        expect(container.items, label).toHaveLength(0);
        const losers = ids.filter((id) => id !== winners[0]);
        expect(toastsOf(events).sort((x, y) => x.to.localeCompare(y.to)), label)
          .toEqual(losers.map((to) => ({ to, text: "Item is gone" })).sort((x, y) => x.to.localeCompare(y.to)));
        for (const id of losers) expect(P(world, id).inventory, label).toHaveLength(0);
      }
    }
  });

  it("does not favour whoever joined first: over consecutive ticks every contender wins at least once", () => {
    for (const ids of [["a", "b"], ["b", "a"], ["a", "b", "c"]]) {
      const wins = new Map<string, number>(ids.map((id) => [id, 0]));
      for (let idle = 0; idle < ids.length * 3; idle++) {
        const { winners } = contest(ids, "crate", idle);
        wins.set(winners[0]!, wins.get(winners[0]!)! + 1);
      }
      for (const id of ids) expect(wins.get(id), `${ids.join("")}: wins for ${id}`).toBeGreaterThan(0);
    }
  });

  it("does the same for a loose item, whose container disappears under the later taker", () => {
    const winners = new Set<string>();
    for (let idle = 0; idle < 16; idle++) {
      const { world, container, uid, events, winners: won } = contest(["a", "b"], "ground", idle);
      expect(won).toHaveLength(1);
      const [winner] = won;
      const loser = winner === "a" ? "b" : "a";
      winners.add(winner!);
      expect(dto(P(world, winner!).inventory)).toEqual([{ uid, def: "gold" }]);
      expect(P(world, loser).inventory).toHaveLength(0);
      expect(toastsOf(events)).toEqual([{ to: loser, text: "Item is gone" }]);
      expect(world.state.containers.has(container.id)).toBe(false);
    }
    expect(winners).toEqual(new Set(["a", "b"]));
  });

  it("deletes a ground container once emptied, but keeps emptied crates and bodies", () => {
    const world = startRaid([alice()]);
    const ground = putContainer(world, "ground", AT, ["knife"]);
    const crate = putContainer(world, "crate", AT, ["gold"]);
    const body = putContainer(world, "body", AT, ["watch"]);
    place(world, "a", AT);

    for (const c of [ground, crate, body]) send(world, "a", "take", { containerId: c.id, uid: c.items[0]!.uid });
    step(world, TICK_MS);

    expect(P(world, "a").inventory).toHaveLength(3);
    expect(world.state.containers.has(ground.id)).toBe(false);
    expect(world.state.containers.get(crate.id)).toBe(crate);
    expect(world.state.containers.get(body.id)).toBe(body);
    expect(crate.items).toHaveLength(0);
    expect(body.items).toHaveLength(0);
  });

  it("keeps a ground container that still holds something", () => {
    const world = startRaid([alice()]);
    const ground = putContainer(world, "ground", AT, ["knife", "watch"]);
    place(world, "a", AT);
    send(world, "a", "take", { containerId: ground.id, uid: ground.items[0]!.uid });
    step(world, TICK_MS);
    expect(world.state.containers.get(ground.id)).toBe(ground);
    expect(ground.items).toHaveLength(1);
  });

  it("ignores actions of other kinds when the handler is called directly", () => {
    const world = startRaid([alice()]);
    const crate = putContainer(world, "crate", AT, ["gold"]);
    place(world, "a", AT);
    const before = dump(world);
    handleTake(world, P(world, "a"), RT(world, "a"), { kind: "drop", uid: crate.items[0]!.uid });
    handleTake(world, P(world, "a"), RT(world, "a"), { kind: "attack", x: 0, y: 0 });
    expect(dump(world)).toBe(before);
    expect(world.events).toEqual([]);
  });
});

describe("take: line of sight", () => {
  it("has a one-tile wall to test with, and its two sides are within reach of each other", () => {
    const world = startRaid([alice()]);
    expect(isWallTile(world.map, Math.floor(SLAB.west / TILE) + 1, Math.floor(SLAB.y / TILE))).toBe(true);
    expect(Math.hypot(WEST.x - EAST.x, WEST.y - EAST.y)).toBe(INTERACT_RANGE);
  });

  it("refuses a crate that is in range but behind a wall, changing nothing", () => {
    const world = startRaid([alice(gear("knife"))]);
    const crate = putContainer(world, "crate", { x: EAST.x - 8, y: EAST.y }, ["gold"]);
    place(world, "a", WEST);
    expect(Math.hypot(WEST.x - crate.x, WEST.y - crate.y)).toBeLessThanOrEqual(INTERACT_RANGE);
    const before = dump(world);

    send(world, "a", "take", { containerId: crate.id, uid: crate.items[0]!.uid });
    expect(toastsOf(step(world, TICK_MS))).toEqual([{ to: "a", text: "Can't reach that" }]);
    expect(dump(world)).toBe(before);
  });

  it("allows the same crate from its own side of the wall, and from the far side once the player has crossed over", () => {
    const world = startRaid([alice(), bob()]);
    const crate = putContainer(world, "crate", { x: EAST.x - 8, y: EAST.y }, ["gold", "watch"]);
    place(world, "a", EAST);
    place(world, "b", WEST);
    send(world, "a", "take", { containerId: crate.id, uid: crate.items[0]!.uid });
    send(world, "b", "take", { containerId: crate.id, uid: crate.items[1]!.uid });

    expect(toastsOf(step(world, TICK_MS))).toEqual([{ to: "b", text: "Can't reach that" }]);
    expect(dto(P(world, "a").inventory).map((i) => i.def)).toEqual(["gold"]);
    expect(P(world, "b").inventory).toHaveLength(0);

    place(world, "b", { x: EAST.x + 6, y: EAST.y });
    send(world, "b", "take", { containerId: crate.id, uid: crate.items[0]!.uid });
    expect(toastsOf(step(world, TICK_MS))).toEqual([]);
    expect(dto(P(world, "b").inventory).map((i) => i.def)).toEqual(["watch"]);
  });

  it("refuses a dropped item across a one-tile wall, then lets it be taken from the same side", () => {
    const world = startRaid([alice(), bob(gear("pistol"))]);
    place(world, "b", EAST);
    place(world, "a", WEST);
    send(world, "b", "drop", { uid: "pistol#0" });
    step(world, TICK_MS);
    const dropped = [...world.state.containers.values()].find((c) => c.kind === "ground" && c.items[0]?.uid === "pistol#0")!;
    expect(dropped).toMatchObject({ x: EAST.x, y: EAST.y });
    expect(Math.hypot(WEST.x - dropped.x, WEST.y - dropped.y)).toBeLessThanOrEqual(INTERACT_RANGE);
    const before = dump(world);

    send(world, "a", "take", { containerId: dropped.id, uid: "pistol#0" });
    expect(toastsOf(step(world, TICK_MS))).toEqual([{ to: "a", text: "Can't reach that" }]);
    expect(dump(world)).toBe(before);

    place(world, "a", { x: EAST.x + 10, y: EAST.y });
    send(world, "a", "take", { containerId: dropped.id, uid: "pistol#0" });
    expect(toastsOf(step(world, TICK_MS))).toEqual([]);
    expect(dto(P(world, "a").inventory)).toEqual([{ uid: "pistol#0", def: "pistol" }]);
    expect(world.state.containers.has(dropped.id)).toBe(false);
  });

  it("refuses a body behind a wall", () => {
    const world = startRaid([alice(), bob(gear("rifle")), carol()]);
    place(world, "b", EAST);
    downPlayer(world, P(world, "b"), RT(world, "b"), "died");
    step(world, TICK_MS); // flush the 'resolved' event; the body is now an ordinary old container
    const body = [...world.state.containers.values()].find((c) => c.kind === "body")!;
    place(world, "a", WEST);
    const before = dump(world);

    send(world, "a", "take", { containerId: body.id, uid: "rifle#0" });
    expect(toastsOf(step(world, TICK_MS))).toEqual([{ to: "a", text: "Can't reach that" }]);
    expect(dump(world)).toBe(before);
  });

  it("is checked after distance and before the item and inventory checks", () => {
    const full = Array.from({ length: INVENTORY_SLOTS }, (_, i) => ({ uid: `own#${i}`, def: "watch" }));
    const world = startRaid([alice(full)]);
    const crate = putContainer(world, "crate", { x: EAST.x - 8, y: EAST.y }, ["gold"]);
    const take = (uid: string) => {
      send(world, "a", "take", { containerId: crate.id, uid });
      return toastsOf(step(world, TICK_MS)).map((t) => t.text);
    };

    place(world, "a", { x: WEST.x - 100, y: WEST.y });
    expect(take("nope")).toEqual(["Too far away"]); // out of range beats the wall
    place(world, "a", WEST);
    expect(take("nope")).toEqual(["Can't reach that"]); // the wall beats an unknown item
    expect(take(crate.items[0]!.uid)).toEqual(["Can't reach that"]); // and a full inventory
    place(world, "a", EAST);
    expect(take(crate.items[0]!.uid)).toEqual(["Inventory full"]);
  });

  it("lets a player take from their own feet and from a few units away on the same side", () => {
    const world = startRaid([alice()]);
    const crate = putContainer(world, "crate", WEST, ["gold", "watch"]);
    place(world, "a", WEST);
    send(world, "a", "take", { containerId: crate.id, uid: crate.items[0]!.uid });
    place(world, "a", { x: WEST.x - 8, y: WEST.y });
    send(world, "a", "take", { containerId: crate.id, uid: crate.items[1]!.uid });
    expect(toastsOf(step(world, TICK_MS))).toEqual([]);
    expect(P(world, "a").inventory).toHaveLength(2);
  });
});

describe("take: through a closed coliseum gate", () => {
  const OUT: Record<GateSide, readonly [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
  const SIDES: GateSide[] = ["n", "e", "s", "w"];
  const SEEDS = [1234, 7, 99];
  const gateOf = (map: GameMap, side: GateSide): GateDef => map.coliseum.gates.find((g) => g.side === side)!;

  /** Just outside and just inside the middle of a gate: 8 u past each face of the gate tile, so 48 u apart (in reach). */
  function gateSpots(g: GateDef): { outside: Vec2; inside: Vec2 } {
    const [ox, oy] = OUT[g.side];
    const d = TILE / 2 + 8;
    return { outside: { x: g.x + ox * d, y: g.y + oy * d }, inside: { x: g.x - ox * d, y: g.y - oy * d } };
  }

  /** A one-player raid on the map generated from `seed`, with a crate of gold just inside `side`'s gate and the player just outside it. */
  function setup(seed: number, side: GateSide) {
    const world = makeWorld({ minPlayers: 1 }, seed);
    setGear(addPlayer(world, "a", "alice"), []);
    step(world, TICK_MS);
    expect(world.state.phase).toBe("active");
    const { outside, inside } = gateSpots(gateOf(world.map, side));
    const crate = putContainer(world, "crate", inside, ["gold"]);
    place(world, "a", outside);
    return { world, crate, outside };
  }

  it("has a gate to test with: the crate is within reach, in sight with the gates open and out of sight once they close", () => {
    for (const seed of SEEDS) {
      const map = generateMap(seed);
      expect(map.coliseum.gates.map((g) => g.side)).toEqual(SIDES);
      for (const side of SIDES) {
        const { outside, inside } = gateSpots(gateOf(map, side));
        const label = `seed ${seed} gate ${side}`;
        expect(Math.hypot(outside.x - inside.x, outside.y - inside.y), label).toBeLessThanOrEqual(INTERACT_RANGE);
        expect(hasLineOfSight(map, outside, inside), `${label} open`).toBe(true);
        expect(hasLineOfSight(withGates(map), outside, inside), `${label} closed`).toBe(false);
      }
    }
  });

  it("refuses a crate just inside a closed gate from just outside it, changing nothing, and allows it once the gates open", () => {
    for (const seed of SEEDS) {
      for (const side of SIDES) {
        const label = `seed ${seed} gate ${side}`;
        const { world, crate } = setup(seed, side);
        world.state.gatesLocked = true;
        const before = dump(world);

        send(world, "a", "take", { containerId: crate.id, uid: crate.items[0]!.uid });
        expect(toastsOf(step(world, TICK_MS)), `${label} locked`).toEqual([{ to: "a", text: "Can't reach that" }]);
        expect(dump(world), `${label} locked: nothing changed`).toBe(before);

        world.state.gatesLocked = false;
        send(world, "a", "take", { containerId: crate.id, uid: crate.items[0]!.uid });
        expect(toastsOf(step(world, TICK_MS)), `${label} open`).toEqual([]);
        expect(dto(P(world, "a").inventory).map((it) => it.def), `${label} open`).toEqual(["gold"]);
      }
    }
  });

  it("still lets a player take from a crate on their own side of a closed gate", () => {
    for (const seed of SEEDS) {
      for (const side of SIDES) {
        const label = `seed ${seed} gate ${side}`;
        const { world, outside } = setup(seed, side);
        world.state.gatesLocked = true;
        const [ox, oy] = OUT[side];
        const near = putContainer(world, "crate", { x: outside.x + ox * 8, y: outside.y + oy * 8 }, ["watch"]);
        send(world, "a", "take", { containerId: near.id, uid: near.items[0]!.uid });
        expect(toastsOf(step(world, TICK_MS)), label).toEqual([]);
        expect(dto(P(world, "a").inventory).map((it) => it.def), label).toEqual(["watch"]);
      }
    }
  });
});

describe("take: containers created this tick", () => {
  it("refuses an item dropped earlier in the same tick by a client that guessed the id, then allows it next tick", () => {
    const world = startRaid([alice(gear("pistol"))]);
    place(world, "a", AT);
    const guess = nextContainerId(world);

    send(world, "a", "drop", { uid: "pistol#0" });
    send(world, "a", "take", { containerId: guess, uid: "pistol#0" });
    expect(toastsOf(step(world, TICK_MS))).toEqual([{ to: "a", text: "Item is gone" }]);
    expect(P(world, "a").inventory).toHaveLength(0);
    expect(dto(world.state.containers.get(guess)!.items)).toEqual(gear("pistol"));

    send(world, "a", "take", { containerId: guess, uid: "pistol#0" });
    expect(toastsOf(step(world, TICK_MS))).toEqual([]);
    expect(dto(P(world, "a").inventory)).toEqual(gear("pistol"));
    expect(world.state.containers.has(guess)).toBe(false);
  });

  it("stops a second player grabbing a drop that appears in the same tick, even though they act after the dropper", () => {
    const world = startRaid([alice(gear("pistol")), bob()]);
    place(world, "a", AT);
    place(world, "b", AT);
    stepUntilFirst(world, "a");
    const guess = nextContainerId(world);

    send(world, "a", "drop", { uid: "pistol#0" });
    send(world, "b", "take", { containerId: guess, uid: "pistol#0" });
    expect(toastsOf(step(world, TICK_MS))).toEqual([{ to: "b", text: "Item is gone" }]);
    expect(P(world, "b").inventory).toHaveLength(0);
    expect(world.state.containers.get(guess)?.items).toHaveLength(1);

    send(world, "b", "take", { containerId: guess, uid: "pistol#0" });
    expect(toastsOf(step(world, TICK_MS))).toEqual([]);
    expect(dto(P(world, "b").inventory)).toEqual(gear("pistol"));
  });

  it("stops a body being looted in the tick its owner goes down, but not on the next one", () => {
    const world = startRaid([alice(), bob(gear("rifle")), carol()]);
    // Stands in for a combat system: acting kills the actor mid-tick.
    world.actions.attack = (w, p, rt) => downPlayer(w, p, rt, "died");
    place(world, "a", AT);
    place(world, "b", AT);
    stepUntilFirst(world, "b");
    const guess = nextContainerId(world);

    send(world, "b", "attack", { x: 0, y: 0 });
    send(world, "a", "take", { containerId: guess, uid: "rifle#0" });
    expect(toastsOf(step(world, TICK_MS))).toEqual([{ to: "a", text: "Item is gone" }]);
    expect(P(world, "b").status).toBe("dead");
    expect(P(world, "a").inventory).toHaveLength(0);
    expect(world.state.containers.get(guess)).toMatchObject({ kind: "body" });

    send(world, "a", "take", { containerId: guess, uid: "rifle#0" });
    expect(toastsOf(step(world, TICK_MS))).toEqual([]);
    expect(dto(P(world, "a").inventory)).toEqual(gear("rifle").map((i) => ({ ...i, uid: "rifle#0" })));
  });

  it("gates the body of a player who disconnected between ticks until clients have seen it", () => {
    const world = startRaid([alice(), bob(gear("gold")), carol()]);
    place(world, "a", AT);
    place(world, "b", AT);
    removePlayer(world, "b");
    const body = [...world.state.containers.values()].find((c) => c.kind === "body")!;

    // The next tick is the first patch that carries the body: a take in it can only be a guessed id.
    send(world, "a", "take", { containerId: body.id, uid: "gold#0" });
    expect(toastsOf(step(world, TICK_MS))).toEqual([{ to: "a", text: "Item is gone" }]);
    expect(P(world, "a").inventory).toHaveLength(0);

    send(world, "a", "take", { containerId: body.id, uid: "gold#0" });
    expect(toastsOf(step(world, TICK_MS))).toEqual([]);
    expect(dto(P(world, "a").inventory)).toEqual(gear("gold"));
  });

  it("never gates containers spawned with the world, even when asked at tick 0", () => {
    const world = makeWorld();
    setGear(addPlayer(world, "a", "alice"), []);
    const crate = [...world.state.containers.values()].find((c) => c.kind === "crate")!;
    place(world, "a", crate);
    expect(world.state.tick).toBe(0);

    handleTake(world, P(world, "a"), RT(world, "a"), { kind: "take", containerId: crate.id, uid: crate.items[0]!.uid });
    expect(world.events).toEqual([]);
    expect(P(world, "a").inventory).toHaveLength(1);
  });

  it("does not gate hand-placed containers, nor leak births between worlds", () => {
    const one = startRaid([alice(gear("pistol"))]);
    const two = startRaid([alice()]);
    place(one, "a", AT);
    place(two, "a", AT);
    expect(one.state.tick).toBe(two.state.tick);

    const guess = nextContainerId(one);
    send(one, "a", "drop", { uid: "pistol#0" });
    step(one, TICK_MS);
    // A container with the same id in the other world, at the same tick, is a different container.
    const twin = putContainer(two, "crate", AT, ["gold"]);
    twin.id = guess;
    two.state.containers.set(guess, twin);
    send(two, "a", "take", { containerId: guess, uid: twin.items[0]!.uid });
    expect(toastsOf(step(two, TICK_MS))).toEqual([]);
    expect(P(two, "a").inventory).toHaveLength(1);
  });
});

describe("drop", () => {
  it("removes the item and leaves a ground container at the player's position holding a fresh copy", () => {
    const items = gear("knife", "gold");
    const world = startRaid([alice(items)]);
    const original = P(world, "a").inventory[1]!;
    place(world, "a", { x: 321, y: 654 });
    const sizeBefore = world.state.containers.size;

    send(world, "a", "drop", { uid: items[1]!.uid });
    expect(step(world, TICK_MS)).toEqual([]);

    expect(dto(P(world, "a").inventory)).toEqual([items[0]]);
    expect(world.state.containers.size).toBe(sizeBefore + 1);
    const dropped = [...world.state.containers.values()].find((c) => c.items.some((i) => i.uid === items[1]!.uid))!;
    expect(dropped).toMatchObject({ kind: "ground", x: 321, y: 654, label: ITEMS.gold!.name });
    expect(world.state.containers.get(dropped.id)).toBe(dropped);
    expect(dto(dropped.items)).toEqual([items[1]]);
    expect(dropped.items[0]).not.toBe(original);
  });

  it("gives every dropped item its own container with a unique id", () => {
    const items = gear("knife", "gold", "watch");
    const world = startRaid([alice(items)]);
    const before = new Set(world.state.containers.keys());
    place(world, "a", AT);
    for (const it of items) send(world, "a", "drop", { uid: it.uid });
    step(world, TICK_MS); // MAX_ACTIONS_PER_TICK is 4, so all three fit

    const added = [...world.state.containers.values()].filter((c) => !before.has(c.id));
    expect(added).toHaveLength(3);
    expect(new Set(added.map((c) => c.id)).size).toBe(3);
    expect(added.map((c) => c.label)).toEqual(["Knife", "Gold Bar", "Watch"]);
    expect(P(world, "a").inventory).toHaveLength(0);
  });

  it("can be picked straight back up", () => {
    const items = gear("pistol");
    const world = startRaid([alice(items)]);
    place(world, "a", AT);
    send(world, "a", "drop", { uid: "pistol#0" });
    step(world, TICK_MS);
    const dropped = [...world.state.containers.values()].find((c) => c.items.some((i) => i.uid === "pistol#0"))!;

    send(world, "a", "take", { containerId: dropped.id, uid: "pistol#0" });
    step(world, TICK_MS);
    expect(dto(P(world, "a").inventory)).toEqual(items);
    expect(world.state.containers.has(dropped.id)).toBe(false);
  });

  it("ignores a uid the player doesn't carry, including one lying in a container", () => {
    const world = startRaid([alice(gear("knife"))]);
    const crate = putContainer(world, "crate", AT, ["gold"]);
    place(world, "a", AT);
    const before = dump(world);

    send(world, "a", "drop", { uid: "ghost" });
    send(world, "a", "drop", { uid: crate.items[0]!.uid });
    expect(step(world, TICK_MS)).toEqual([]);
    expect(dump(world)).toBe(before);
  });

  it("works with a full inventory, and drops each uid only once", () => {
    const full = Array.from({ length: INVENTORY_SLOTS }, (_, i) => ({ uid: `own#${i}`, def: "watch" }));
    const world = startRaid([alice(full)]);
    const before = world.state.containers.size;
    send(world, "a", "drop", { uid: "own#2" });
    send(world, "a", "drop", { uid: "own#2" });
    expect(step(world, TICK_MS)).toEqual([]);
    expect(P(world, "a").inventory).toHaveLength(INVENTORY_SLOTS - 1);
    expect(world.state.containers.size).toBe(before + 1);
  });
});

describe("use", () => {
  const heal = (events: SimEvent[]) => ofType(events, "fx").map((e) => e.fx);

  it("heals, consumes the item and reports the amount actually healed", () => {
    const world = startRaid([alice(gear("bandage", "knife"))]);
    P(world, "a").hp = 40;

    send(world, "a", "use", { uid: "bandage#0" });
    const events = step(world, TICK_MS);

    expect(P(world, "a").hp).toBe(40 + BANDAGE.heal);
    expect(dto(P(world, "a").inventory)).toEqual([{ uid: "knife#1", def: "knife" }]);
    expect(events).toEqual([{ type: "fx", fx: { kind: "heal", id: "a", amount: BANDAGE.heal } }]);
  });

  it("clamps to max HP and reports only the part that was needed", () => {
    const world = startRaid([alice(gear("medkit"))]);
    const p = P(world, "a");
    p.hp = p.maxHp - 7;

    send(world, "a", "use", { uid: "medkit#0" });
    const events = step(world, TICK_MS);

    expect(MEDKIT.heal).toBeGreaterThan(7);
    expect(p.hp).toBe(p.maxHp);
    expect(p.inventory).toHaveLength(0);
    expect(heal(events)).toEqual([{ kind: "heal", id: "a", amount: 7 }]);
  });

  it("heals one item per use and leaves duplicates alone", () => {
    const world = startRaid([alice(gear("bandage", "bandage"))]);
    P(world, "a").hp = 10;
    send(world, "a", "use", { uid: "bandage#1" });
    step(world, TICK_MS);
    expect(dto(P(world, "a").inventory)).toEqual([{ uid: "bandage#0", def: "bandage" }]);
    expect(P(world, "a").hp).toBe(10 + BANDAGE.heal);
  });

  it("uses several in one tick, healing each only as far as needed", () => {
    const world = startRaid([alice(gear("medkit", "bandage", "bandage"))]);
    const p = P(world, "a");
    p.hp = p.maxHp - 70; // medkit heals 60, then one bandage tops up the last 10
    for (const it of dto(p.inventory)) send(world, "a", "use", { uid: it.uid });
    const events = step(world, TICK_MS);

    expect(p.hp).toBe(p.maxHp);
    expect(heal(events).map((f) => (f.kind === "heal" ? f.amount : -1))).toEqual([MEDKIT.heal, 10]);
    expect(toastsOf(events)).toEqual([{ to: "a", text: "Already at full health" }]);
    expect(dto(p.inventory)).toEqual([{ uid: "bandage#2", def: "bandage" }]);
  });

  it("keeps the item and toasts at full health", () => {
    const world = startRaid([alice(gear("bandage"))]);
    const p = P(world, "a");
    expect(p.hp).toBe(p.maxHp);
    const before = dump(world);

    send(world, "a", "use", { uid: "bandage#0" });
    const events = step(world, TICK_MS);

    expect(events).toEqual([{ type: "toast", to: "a", text: "Already at full health" }]);
    expect(dump(world)).toBe(before);
  });

  it("toasts for items that can't be used and keeps them", () => {
    const world = startRaid([alice(gear("knife", "watch", "vest"))]);
    P(world, "a").hp = 50;
    const before = dump(world);

    for (const it of gear("knife", "watch", "vest")) send(world, "a", "use", { uid: it.uid });
    const events = step(world, TICK_MS);

    expect(toastsOf(events)).toEqual([
      { to: "a", text: "Can't use Knife" },
      { to: "a", text: "Can't use Watch" },
      { to: "a", text: "Can't use Vest" },
    ]);
    expect(heal(events)).toEqual([]);
    expect(dump(world)).toBe(before);
  });

  it("ignores a uid the player doesn't carry", () => {
    const world = startRaid([alice()]);
    const crate = putContainer(world, "crate", AT, ["medkit"]);
    P(world, "a").hp = 10;
    const before = dump(world);

    send(world, "a", "use", { uid: crate.items[0]!.uid });
    send(world, "a", "use", { uid: "ghost" });
    expect(step(world, TICK_MS)).toEqual([]);
    expect(dump(world)).toBe(before);
  });

  it("only acts on the sender", () => {
    const world = startRaid([alice(gear("bandage")), bob()]);
    P(world, "a").hp = 10;
    P(world, "b").hp = 10;
    send(world, "b", "use", { uid: "bandage#0" }); // bob can't use alice's bandage
    expect(step(world, TICK_MS)).toEqual([]);
    expect(P(world, "a").inventory).toHaveLength(1);
    expect(P(world, "b").hp).toBe(10);
  });

  it("ignores actions of other kinds when the handler is called directly", () => {
    const world = startRaid([alice(gear("bandage"))]);
    P(world, "a").hp = 10;
    handleUse(world, P(world, "a"), RT(world, "a"), { kind: "take", containerId: "x", uid: "bandage#0" });
    handleDrop(world, P(world, "a"), RT(world, "a"), { kind: "use", uid: "bandage#0" });
    expect(P(world, "a").inventory).toHaveLength(1);
    expect(P(world, "a").hp).toBe(10);
    expect(world.events).toEqual([]);
  });
});

describe("players who have left the raid", () => {
  it.each(["died", "mia"] as const)("a %s player's take, drop, use and move on later ticks change nothing", (outcome) => {
    const world = startRaid([alice(gear("bandage", "knife")), bob(gear("watch")), carol()]);
    const crate = putContainer(world, "crate", AT, ["gold", "medkit"]);
    const ground = putContainer(world, "ground", AT, ["pistol"]);
    place(world, "a", AT);
    P(world, "a").hp = 50;
    downPlayer(world, P(world, "a"), RT(world, "a"), outcome);
    expect(ofType(step(world, TICK_MS), "resolved")).toHaveLength(1); // flush the result; everything after is "later"
    const before = dump(world);
    const status = P(world, "a").status;
    expect(status).toBe(outcome === "died" ? "dead" : "mia");

    for (let tick = 0; tick < 3; tick++) {
      send(world, "a", "take", { containerId: crate.id, uid: crate.items[0]!.uid });
      send(world, "a", "take", { containerId: ground.id, uid: ground.items[0]!.uid });
      send(world, "a", "drop", { uid: "knife#1" });
      send(world, "a", "use", { uid: "bandage#0" });
      send(world, "a", "move", { x: AT.x + 200, y: AT.y });
      expect(step(world, TICK_MS), `tick ${tick}`).toEqual([]);
      expect(dump(world), `tick ${tick}`).toBe(before);
      expect(P(world, "a").status).toBe(status);
      expect(RT(world, "a").inputs.actions).toEqual([]); // drained, not left to pile up
      expect(RT(world, "a").path).toEqual([]);
    }
    expect(P(world, "a").inventory).toHaveLength(0);
    expect(P(world, "a").hp).toBe(50);
    expect(dto(crate.items).map((i) => i.def)).toEqual(["gold", "medkit"]);
  });

  it("a player who goes down mid-tick drops nothing further from the actions queued behind it", () => {
    const world = startRaid([alice(gear("bandage", "knife")), bob()]);
    world.actions.attack = (w, p, rt) => downPlayer(w, p, rt, "died");
    place(world, "a", AT);
    P(world, "a").hp = 50;
    const existing = new Set(world.state.containers.keys());
    send(world, "a", "attack", { x: 0, y: 0 });
    send(world, "a", "drop", { uid: "knife#1" });
    send(world, "a", "use", { uid: "bandage#0" });

    step(world, TICK_MS);
    const added = [...world.state.containers.values()].filter((c) => !existing.has(c.id));
    expect(added).toHaveLength(1); // the body, and no ground drop from the queued "drop"
    expect(added[0]).toMatchObject({ kind: "body" });
    expect(dto(added[0]!.items)).toEqual(gear("bandage", "knife"));
    expect(P(world, "a").hp).toBe(50);
  });
});

describe("dropBody", () => {
  it("leaves a body with every item when a player dies, and the player is resolved at once outside a step", () => {
    const items = gear("rifle", "gold", "bandage");
    const world = startRaid([alice(items), bob()]);
    const a = P(world, "a");
    place(world, "a", { x: 480, y: 272 });
    const originals = [...a.inventory];
    const before = new Set(world.state.containers.keys());

    downPlayer(world, a, RT(world, "a"), "died");

    const bodies = [...world.state.containers.values()].filter((c) => !before.has(c.id));
    expect(bodies).toHaveLength(1);
    const body = bodies[0]!;
    expect(body).toMatchObject({ kind: "body", x: 480, y: 272, label: "alice" });
    expect(world.state.containers.get(body.id)).toBe(body);
    expect(dto(body.items)).toEqual(items);
    body.items.forEach((it, i) => expect(it).not.toBe(originals[i]));
    expect(a.inventory).toHaveLength(0);
    expect(a.status).toBe("dead");

    const [resolved] = ofType(world.events, "resolved");
    expect(resolved!.id).toBe("a");
    expect(resolved!.result).toMatchObject({ outcome: "died", profile: "alice", place: 2, players: 2 });
  });

  it("records the position at the moment of death, not the spawn", () => {
    const world = startRaid([alice(gear("knife")), bob()]);
    const spawn = { x: P(world, "a").x, y: P(world, "a").y };
    place(world, "a", { x: spawn.x + 64, y: spawn.y });
    downPlayer(world, P(world, "a"), RT(world, "a"), "died");
    const body = [...world.state.containers.values()].find((c) => c.kind === "body")!;
    expect({ x: body.x, y: body.y }).toEqual({ x: spawn.x + 64, y: spawn.y });
  });

  it("leaves an empty body for a player who died with nothing", () => {
    const world = startRaid([alice(), bob()]);
    downPlayer(world, P(world, "a"), RT(world, "a"), "died");
    const body = [...world.state.containers.values()].find((c) => c.kind === "body")!;
    expect(body.label).toBe("alice");
    expect(body.items).toHaveLength(0);
  });

  it("is a second body for a second death, with its own id", () => {
    const world = startRaid([alice(gear("knife")), bob(gear("pistol"))]);
    downPlayer(world, P(world, "a"), RT(world, "a"), "died");
    downPlayer(world, P(world, "b"), RT(world, "b"), "died");
    const bodies = [...world.state.containers.values()].filter((c) => c.kind === "body");
    expect(bodies.map((b) => b.label)).toEqual(["alice", "bob"]);
    expect(new Set(bodies.map((b) => b.id)).size).toBe(2);
  });

  it("also covers MIA: a disconnect mid-raid leaves the body", () => {
    const dc = startRaid([alice(gear("gold")), bob()]);
    removePlayer(dc, "a");
    const left = [...dc.state.containers.values()].filter((c) => c.kind === "body");
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ label: "alice" });
    expect(dto(left[0]!.items)).toEqual(gear("gold"));
  });

  it("a disconnect after looting leaves a body holding everything carried, and no death fx", () => {
    const dc = startRaid([alice(gear("gold", "bandage")), bob(gear("watch"))]);
    const crate = putContainer(dc, "crate", AT, ["knife", "vest"]);
    place(dc, "a", AT);
    for (const it of crate.items) send(dc, "a", "take", { containerId: crate.id, uid: it.uid });
    step(dc, TICK_MS);
    const carried = dto(P(dc, "a").inventory);
    expect(carried.map((i) => i.def)).toEqual(["gold", "bandage", "knife", "vest"]);
    removePlayer(dc, "a");
    const [left] = ofType(dc.events, "resolved");
    expect(left!.id).toBe("a");
    expect(left!.result).toMatchObject({ outcome: "mia", place: 2 });
    const body = [...dc.state.containers.values()].find((c) => c.kind === "body" && c.label === "alice")!;
    expect(dto(body.items)).toEqual(carried);
    expect(ofType(dc.events, "fx")).toEqual([]);
  });

  it("can be called directly and takes exactly what the player carries", () => {
    const world = startRaid([alice(gear("vest", "medkit"))]);
    const a = P(world, "a");
    place(world, "a", AT);
    dropBody(world, a);
    const body = [...world.state.containers.values()].find((c) => c.kind === "body")!;
    expect(dto(body.items)).toEqual(gear("vest", "medkit"));
    expect(a.inventory).toHaveLength(0);
  });
});

describe("loot flow through the sim", () => {
  it("lets a player loot a crate, heal, drop and re-take over several ticks", () => {
    const world = startRaid([alice(gear("bandage"))]);
    const crate = [...world.state.containers.values()].find((c) => c.kind === "crate")!;
    const loot = dto(crate.items);
    const p = P(world, "a");
    place(world, "a", crate);
    p.hp = 50;

    for (const it of loot) send(world, "a", "take", { containerId: crate.id, uid: it.uid });
    step(world, TICK_MS);
    expect(dto(p.inventory)).toEqual([...gear("bandage"), ...loot]);

    send(world, "a", "use", { uid: "bandage#0" });
    const healed = step(world, TICK_MS);
    expect(p.hp).toBe(50 + BANDAGE.heal);
    expect(ofType(healed, "fx")).toHaveLength(1);

    const first = loot[0]!;
    send(world, "a", "drop", { uid: first.uid });
    step(world, TICK_MS);
    expect(p.inventory.some((i) => i.uid === first.uid)).toBe(false);

    const dropped = [...world.state.containers.values()].find((c) => c.kind === "ground" && c.items[0]?.uid === first.uid)!;
    send(world, "a", "take", { containerId: dropped.id, uid: first.uid });
    step(world, TICK_MS);
    expect(p.inventory.some((i) => i.uid === first.uid)).toBe(true);
    expect(world.state.containers.has(dropped.id)).toBe(false);
  });

  it("never duplicates or loses an item uid across containers and inventories", () => {
    const world = startRaid([alice(gear("knife")), bob(gear("watch"))]);
    const census = () => {
      const uids: string[] = [];
      for (const p of world.state.players.values()) for (const i of p.inventory) uids.push(i.uid);
      for (const c of world.state.containers.values()) for (const i of c.items) uids.push(i.uid);
      return uids.sort();
    };
    const start = census();
    expect(new Set(start).size).toBe(start.length);

    const crates = [...world.state.containers.values()].filter((c) => c.kind === "crate").slice(0, 3);
    const rnd = mulberry32(77);
    for (let t = 0; t < 120; t++) {
      for (const id of ["a", "b"]) {
        const p = P(world, id);
        const c = crates[Math.floor(rnd() * crates.length)]!;
        place(world, id, c);
        const roll = rnd();
        if (roll < 0.5 && c.items.length > 0) {
          send(world, id, "take", { containerId: c.id, uid: c.items[Math.floor(rnd() * c.items.length)]!.uid });
        } else if (p.inventory.length > 0) {
          send(world, id, "drop", { uid: p.inventory[Math.floor(rnd() * p.inventory.length)]!.uid });
        }
      }
      step(world, TICK_MS);
    }
    expect(census()).toEqual(start);
  });
});

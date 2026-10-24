import { describe, expect, it, vi } from "vitest";
import {
  generateMap, hasLineOfSight, INTERACT_RANGE, mapFromTiles, mulberry32, PLAYER_RADIUS, SWAP_SECONDS, TICK_MS, TILE, TILE_FLOOR,
  TILE_WALL, tileToWorldCenter, WEAPON_IDS, WEAPONS, withGates, type ContainerKind, type GameMap, type GateDef, type GateSide, type Vec2,
  type WeaponId,
} from "@raid/shared";
import { ContainerState, ItemState, type PlayerState } from "@raid/shared/schema";
import { downPlayer } from "../src/sim/arena";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { dropBody, dropWeapon, handlePickup, install, spawnLoot } from "../src/sim/loot";
import { CHEST_TABLE, GROUND_WEAPON_CHANCE, rollChestWeapon, rollGroundWeapon } from "../src/sim/lootTables";
import { addMob } from "../src/sim/mobs";
import { actionOrder, addPlayer, removePlayer, step } from "../src/sim/step";
import { createWorld, nextId, type SimConfig, type SimEvent, type World } from "../src/sim/world";

type EventOf<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;
type Slots = [WeaponId | "", WeaponId | ""];

function makeConfig(cfg: Partial<SimConfig> = {}): SimConfig {
  const patienceSeconds = cfg.patienceSeconds ?? 3600;
  return {
    minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds, patienceMinSeconds: patienceSeconds,
    suddenDeathSeconds: 60, ...cfg,
  };
}

const centre = (tx: number, ty: number): Vec2 => ({ x: tileToWorldCenter(tx), y: tileToWorldCenter(ty) });
const tick = (world: World): SimEvent[] => step(world, TICK_MS);

/** Item uids come from a counter, so assertions never depend on UUIDs. */
function counter(): () => string {
  let n = 0;
  return () => `L${++n}`;
}

/** The generated map of `seed` with the game modules installed (and so its chests and loose weapons laid out). */
function makeWorld(cfg: Partial<SimConfig> = {}, seed = 1234, random = mulberry32(seed + 1)): World {
  return createGameWorld({ seed, config: makeConfig(cfg), random, newItemUid: counter() });
}

/** A walled hall of open floor (no ruins), with an optional predicate for the tiles that stay floor. Spawns are tiles. */
function hall(w: number, h: number, spawns: Array<[number, number]>, open?: (tx: number, ty: number) => boolean): GameMap {
  const tiles = new Uint8Array(w * h);
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const edge = tx === 0 || ty === 0 || tx === w - 1 || ty === h - 1;
      tiles[ty * w + tx] = !edge && (open?.(tx, ty) ?? true) ? TILE_FLOOR : TILE_WALL;
    }
  }
  const map = mapFromTiles(w, h, tiles, 1);
  map.spawns = spawns.map(([tx, ty]) => centre(tx, ty));
  return map;
}

/** Where players stand in most tests: the middle of the open hall. */
const AT = centre(10, 10);

interface Seat { id: string; name: string; weapons?: Slots }
const alice = (weapons?: Slots): Seat => ({ id: "a", name: "alice", weapons });
const bob = (weapons?: Slots): Seat => ({ id: "b", name: "bob", weapons });
const carol = (weapons?: Slots): Seat => ({ id: "c", name: "carol", weapons });
const SEATS: Record<string, (weapons?: Slots) => Seat> = { a: alice, b: bob, c: carol };

function setWeapons(p: PlayerState, [w0, w1]: Slots, slot = 0): void {
  p.weapon0 = w0;
  p.weapon1 = w1;
  p.slot = slot;
}

/**
 * Seats join in the given order (which is the order the sim iterates players) on `map` with its generated loot cleared
 * away; the raid starts on the first step. Weapons default to a sword in hand and an empty second slot, so a pickup
 * lands in slot 1 without touching the weapon in hand.
 */
function startRaid(seats: Seat[], cfg: Partial<SimConfig> = {}, map: GameMap = hall(40, 20, [[10, 10]])): World {
  const world = makeWorld({ minPlayers: seats.length, ...cfg });
  world.map = map;
  world.state.containers.clear();
  for (const s of seats) {
    const p = addPlayer(world, s.id, s.name);
    setWeapons(p, s.weapons ?? ["sword", ""]);
  }
  tick(world);
  expect(world.state.phase).toBe("active");
  for (const s of seats) place(world, s.id, AT);
  return world;
}

const P = (world: World, id: string): PlayerState => world.state.players.get(id)!;
const RT = (world: World, id: string) => world.players.get(id)!;
const slotsOf = (world: World, id: string): Slots => [P(world, id).weapon0 as WeaponId | "", P(world, id).weapon1 as WeaponId | ""];

/** Puts a player at an exact spot; the sim only moves players that have a path. */
function place(world: World, id: string, at: Vec2): void {
  const p = P(world, id);
  p.x = at.x;
  p.y = at.y;
}

const send = (world: World, id: string, type: string, msg: unknown) =>
  expect(enqueueClientMessage(RT(world, id).inputs, type, msg)).toBe(true);
const pickup = (world: World, id: string, containerId: string) => send(world, id, "pickup", { containerId });

function ofType<T extends SimEvent["type"]>(events: SimEvent[], type: T): Array<EventOf<T>> {
  return events.filter((e): e is EventOf<T> => e.type === type);
}

const toastsOf = (events: SimEvent[]) => ofType(events, "toast").map((e) => ({ to: e.to, text: e.text }));
const defsOf = (c: ContainerState): string[] => c.items.map((i) => i.def);

/** Hand-built container so tests control exactly what is in it, and it is never gated as "born this tick". */
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

/** Everything a pickup could change, for "nothing happened" assertions. */
function dump(world: World): string {
  const players: unknown[] = [];
  for (const [id, p] of world.state.players) players.push([id, p.hp, p.x, p.y, p.weapon0, p.weapon1, p.slot, p.readyAt]);
  const containers: unknown[] = [];
  for (const [id, c] of world.state.containers) containers.push([id, c.kind, c.x, c.y, c.label, defsOf(c)]);
  return JSON.stringify({ players, containers });
}

/** Containers that exist now and did not in `before`. */
const addedSince = (world: World, before: ReadonlySet<string>): ContainerState[] =>
  [...world.state.containers.values()].filter((c) => !before.has(c.id));

/** The id the next container will get, for tests playing a client that guesses ids. */
const nextContainerId = (world: World): string => `c${(world.idCounter + 1).toString(36)}`;

/** Steps until `id` is the first player processed on the following tick (see actionOrder). */
function stepUntilFirst(world: World, id: string): void {
  for (let i = 0; i < 1000 && actionOrder(world, world.state.tick + 1)[0] !== id; i++) tick(world);
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

  /** How many times `fn` calls the random() it is given. */
  const callsOf = (fn: (r: () => number) => unknown): number => {
    let calls = 0;
    const r = mulberry32(5);
    fn(() => { calls++; return r(); });
    return calls;
  };

  it("holds every weapon type exactly once with equal positive weights", () => {
    expect(CHEST_TABLE.map((e) => e.id).sort()).toEqual([...WEAPON_IDS].sort());
    for (const e of CHEST_TABLE) expect(e.weight, e.id).toBeGreaterThan(0);
    expect(new Set(CHEST_TABLE.map((e) => e.weight)).size).toBe(1);
  });

  it("rolls a chest weapon with exactly one random() call, mapping the ends of the unit interval to the first and last entries", () => {
    expect(callsOf(rollChestWeapon)).toBe(1);
    expect(rollChestWeapon(() => 0)).toBe(CHEST_TABLE[0]!.id);
    expect(rollChestWeapon(() => 0.999999999)).toBe(CHEST_TABLE[CHEST_TABLE.length - 1]!.id);
  });

  it("rolls a ground weapon with exactly two random() calls, the first deciding whether there is one", () => {
    expect(callsOf(rollGroundWeapon)).toBe(2);
    // Below the chance there is a weapon, at it there is none; the second call picks the type either way.
    const roll = (there: number, which: number) => { const seq = [there, which]; return rollGroundWeapon(() => seq.shift()!); };
    expect(roll(GROUND_WEAPON_CHANCE - 1e-9, 0)).toBe(CHEST_TABLE[0]!.id);
    expect(roll(GROUND_WEAPON_CHANCE - 1e-9, 0.999999999)).toBe(CHEST_TABLE[CHEST_TABLE.length - 1]!.id);
    expect(roll(GROUND_WEAPON_CHANCE, 0)).toBeNull();
    expect(roll(0.999999999, 0.5)).toBeNull();
    expect(roll(0, 0.5)).toBe(rollChestWeapon(() => 0.5));
  });

  it("is deterministic for a given random() and varies with it", () => {
    const rolls = (seed: number) => {
      const r = mulberry32(seed);
      return Array.from({ length: 200 }, () => [rollChestWeapon(r), rollGroundWeapon(r)]);
    };
    expect(rolls(7)).toEqual(rolls(7));
    expect(rolls(7)).not.toEqual(rolls(8));
  });

  it("takes all of its entropy from the random() it is given", () => {
    const spy = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("Math.random used"); });
    try {
      const r = mulberry32(3);
      for (let i = 0; i < 100; i++) { rollChestWeapon(r); rollGroundWeapon(r); }
    } finally {
      spy.mockRestore();
    }
  });

  it("honors the chest weights over 10k rolls", () => {
    const r = mulberry32(42);
    const counts = tally(Array.from({ length: N }, () => rollChestWeapon(r)));
    expectProportional(counts, new Map(CHEST_TABLE.map((e) => [e.id, e.weight])), N);
    expect(new Set(counts.keys())).toEqual(new Set(WEAPON_IDS));
  });

  it("puts a weapon on about GROUND_WEAPON_CHANCE of ground rolls, of the same kinds as a chest", () => {
    expect(GROUND_WEAPON_CHANCE).toBeGreaterThan(0);
    expect(GROUND_WEAPON_CHANCE).toBeLessThan(1);
    const r = mulberry32(43);
    const rolls = Array.from({ length: N }, () => rollGroundWeapon(r));
    const there = rolls.filter((w): w is WeaponId => w !== null);
    const sigma = Math.sqrt(N * GROUND_WEAPON_CHANCE * (1 - GROUND_WEAPON_CHANCE));
    expect(Math.abs(there.length - N * GROUND_WEAPON_CHANCE)).toBeLessThanOrEqual(5 * sigma);
    expectProportional(tally(there), new Map(CHEST_TABLE.map((e) => [e.id, e.weight])), there.length);
  });
});

describe("spawnLoot / install", () => {
  /** A world on a hand-built map with exactly these spots, rolling from `random` only. */
  function lootWorld(random: () => number, crateSpots: Vec2[], groundSpots: Vec2[]): World {
    const world = createWorld({ seed: 1, config: makeConfig(), random: mulberry32(1), newItemUid: counter() });
    world.map = hall(8, 8, [[2, 2]]);
    world.map.crateSpots = crateSpots;
    world.map.groundSpots = groundSpots;
    world.random = random;
    spawnLoot(world);
    return world;
  }

  /** Plays `values` in order (then repeats them) and counts the calls. */
  function scripted(values: number[]) {
    const out = { calls: 0, random: () => values[out.calls++ % values.length]! };
    return out;
  }

  const SPOTS = [centre(1, 1), centre(2, 1), centre(3, 1), centre(4, 1)];

  it("is part of createGameWorld: the handler, the body hook and the containers are installed", () => {
    const world = makeWorld();
    expect(world.actions.pickup).toBe(handlePickup);
    expect(world.hooks.dropBody).toBe(dropBody);
    expect(world.state.containers.size).toBeGreaterThan(world.map.crateSpots.length);
  });

  it("install() works on a bare world and registers nothing beyond loot", () => {
    const bare = createWorld({ seed: 1234, config: makeConfig(), random: mulberry32(9) });
    expect(bare.state.containers.size).toBe(0);
    install(bare);
    expect(Object.keys(bare.actions)).toEqual(["pickup"]);
    expect(bare.systems).toEqual([]);
    expect(bare.state.containers.size).toBeGreaterThan(0);
  });

  it("puts one chest holding one weapon on every chest spot, in spot order, and loose weapons on some ground spots", () => {
    const world = makeWorld();
    const { crateSpots, groundSpots } = world.map;
    expect(crateSpots.length).toBeGreaterThan(0);
    expect(groundSpots.length).toBeGreaterThan(0);
    const all = [...world.state.containers.values()];
    for (const [key, c] of world.state.containers) expect(c.id).toBe(key);
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);

    const chests = all.filter((c) => c.kind === "chest");
    const ground = all.filter((c) => c.kind === "ground");
    expect(chests.length + ground.length).toBe(all.length);
    expect(chests.map((c) => ({ x: c.x, y: c.y }))).toEqual(crateSpots);
    for (const c of chests) {
      expect(c.label).toBe("Chest");
      expect(c.items).toHaveLength(1);
      expect(WEAPON_IDS).toContain(c.items.at(0)!.def);
    }
    // Loose weapons sit on a subset of the ground spots, in order, one on each, named after what they are.
    let next = 0;
    for (const c of ground) {
      while (next < groundSpots.length && (groundSpots[next]!.x !== c.x || groundSpots[next]!.y !== c.y)) next++;
      expect(next, `ground weapon at ${c.x},${c.y} is on a ground spot`).toBeLessThan(groundSpots.length);
      next++;
      expect(c.items).toHaveLength(1);
      expect(c.label).toBe(WEAPONS[c.items.at(0)!.def as WeaponId].name);
    }
    expect(ground.length).toBeGreaterThan(0);
    expect(ground.length).toBeLessThan(groundSpots.length);
    const uids = all.flatMap((c) => c.items.map((i) => i.uid));
    expect(new Set(uids).size).toBe(uids.length);
  });

  it("rolls a chest from one random() call and a ground spot from two, in spot order", () => {
    const s = scripted([0.1]);
    const world = lootWorld(s.random, SPOTS.slice(0, 3), SPOTS);
    expect(s.calls).toBe(3 + 2 * SPOTS.length);
    expect(world.state.containers.size).toBe(3 + SPOTS.length);
  });

  it("maps rolls to weapons: the first entry for a low roll, the last for a high one, and no loose weapon at or above the chance", () => {
    const first = CHEST_TABLE[0]!.id;
    const last = CHEST_TABLE[CHEST_TABLE.length - 1]!.id;
    // chests: low, high; ground (there?, which): present+low, present+high, absent, exactly at the chance (absent)
    const s = scripted([0, 0.999999999, 0.1, 0, 0.1, 0.999999999, 0.9, 0, GROUND_WEAPON_CHANCE, 0]);
    const world = lootWorld(s.random, SPOTS.slice(0, 2), SPOTS);
    expect(s.calls).toBe(10);
    const boxes = [...world.state.containers.values()];
    expect(boxes.map((c) => [c.kind, c.x, c.y, defsOf(c)])).toEqual([
      ["chest", SPOTS[0]!.x, SPOTS[0]!.y, [first]],
      ["chest", SPOTS[1]!.x, SPOTS[1]!.y, [last]],
      ["ground", SPOTS[0]!.x, SPOTS[0]!.y, [first]],
      ["ground", SPOTS[1]!.x, SPOTS[1]!.y, [last]],
    ]);
    expect(boxes[2]!.label).toBe(WEAPONS[first].name);
  });

  it("puts a loose weapon on about GROUND_WEAPON_CHANCE of the ground spots", () => {
    const n = 20_000;
    const spots = Array.from({ length: n }, (_, i) => centre(1 + (i % 6), 1 + Math.floor(i / 6) % 6));
    const world = lootWorld(mulberry32(11), [], spots);
    const sigma = Math.sqrt(n * GROUND_WEAPON_CHANCE * (1 - GROUND_WEAPON_CHANCE));
    expect(Math.abs(world.state.containers.size - n * GROUND_WEAPON_CHANCE)).toBeLessThanOrEqual(5 * sigma);
  });

  it("is reproducible from world.random alone, and independent of the public map seed", () => {
    const layout = (w: World) => JSON.stringify([...w.state.containers.values()].map((c) => [c.kind, c.x, c.y, defsOf(c)]));
    expect(layout(makeWorld({}, 1234, mulberry32(1)))).toBe(layout(makeWorld({}, 1234, mulberry32(1))));
    expect(layout(makeWorld({}, 1234, mulberry32(1)))).not.toBe(layout(makeWorld({}, 1234, mulberry32(2))));

    // Same public seed (so same map and spots) but a different server rng: same chests, different contents.
    const a = makeWorld({}, 1234, mulberry32(1));
    const b = makeWorld({}, 1234, mulberry32(2));
    const chests = (w: World) => [...w.state.containers.values()].filter((c) => c.kind === "chest");
    expect(chests(a).map((c) => [c.x, c.y])).toEqual(chests(b).map((c) => [c.x, c.y]));
    expect(chests(a).map(defsOf)).not.toEqual(chests(b).map(defsOf));
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
    const world = createGameWorld({ seed: 5, config: makeConfig(), random: mulberry32(1) });
    const uids = [...world.state.containers.values()].flatMap((c) => c.items.map((i) => i.uid));
    expect(uids.length).toBeGreaterThan(0);
    expect(new Set(uids).size).toBe(uids.length);
  });

  it("draws container ids from the world counter, so a later spawn never overwrites earlier containers", () => {
    const world = makeWorld();
    const before = world.state.containers.size;
    const chests = world.map.crateSpots.length;
    spawnLoot(world);
    expect(world.state.containers.size).toBeGreaterThanOrEqual(before + chests);
    const uids = [...world.state.containers.values()].flatMap((c) => c.items.map((i) => i.uid));
    expect(new Set(uids).size).toBe(uids.length);
  });

  it("dropWeapon makes one loose weapon, named after it, with its own uid", () => {
    const world = makeWorld();
    const a = dropWeapon(world, AT, "wand");
    const b = dropWeapon(world, AT, "wand");
    expect(a).toMatchObject({ kind: "ground", x: AT.x, y: AT.y, label: "Wand" });
    expect(defsOf(a)).toEqual(["wand"]);
    expect(a.id).not.toBe(b.id);
    expect(a.items.at(0)!.uid).not.toBe(b.items.at(0)!.uid);
    expect(world.state.containers.get(a.id)).toBe(a);
  });
});

describe("pickup", () => {
  it("takes the weapon into an empty second slot and leaves the weapon in hand, the cooldown and the action alone", () => {
    const world = startRaid([alice(["sword", ""])]);
    const swapped: string[] = [];
    world.hooks.weaponSwapped = (_w, c) => swapped.push(c.id);
    const bow = putContainer(world, "ground", AT, ["bow"]);
    const p = P(world, "a");
    p.readyAt = world.state.serverTime + 1000;
    const readyAt = p.readyAt;
    const action = { kind: "swing" as const, weapon: "sword" as const, startedAt: 0, landsAt: world.state.serverTime + 5000, a: 0, packet: { raw: 1, phys: 1, magic: 0, true: 0 } };
    RT(world, "a").weapon.action = action;

    pickup(world, "a", bow.id);
    expect(toastsOf(tick(world))).toEqual([]);
    expect(slotsOf(world, "a")).toEqual(["sword", "bow"]);
    expect(p.slot).toBe(0);
    expect(p.readyAt).toBe(readyAt);
    expect(RT(world, "a").weapon.action).toBe(action);
    expect(swapped).toEqual([]);
    expect(world.state.containers.has(bow.id)).toBe(false);
    expect(world.state.containers.size).toBe(0);
  });

  it("fills an empty slot 0 first, whichever slot is in hand", () => {
    const world = startRaid([alice(["", "axe"])]);
    P(world, "a").slot = 1;
    const sword = putContainer(world, "ground", AT, ["sword"]);
    pickup(world, "a", sword.id);
    tick(world);
    expect(slotsOf(world, "a")).toEqual(["sword", "axe"]);
    expect(P(world, "a").slot).toBe(1);

    const bare = startRaid([bob(["", ""])]);
    const wand = putContainer(bare, "ground", AT, ["wand"]);
    pickup(bare, "b", wand.id);
    tick(bare);
    expect(slotsOf(bare, "b")).toEqual(["wand", ""]);
  });

  it("with both slots full replaces the weapon in hand; the old one drops where the player stands, as a swap", () => {
    for (const [slot, expected] of [[0, ["axe", "bow"]], [1, ["sword", "axe"]]] as const) {
      const world = startRaid([alice(["sword", "bow"])]);
      const swapped: string[] = [];
      world.hooks.weaponSwapped = (_w, c) => swapped.push(c.id);
      const p = P(world, "a");
      p.slot = slot;
      const axe = putContainer(world, "ground", AT, ["axe"]);
      const before = new Set(world.state.containers.keys());
      place(world, "a", { x: AT.x + 5, y: AT.y - 3 });

      pickup(world, "a", axe.id);
      expect(toastsOf(tick(world)), `slot ${slot}`).toEqual([]);
      expect(slotsOf(world, "a"), `slot ${slot}`).toEqual(expected);
      expect(p.slot).toBe(slot);
      expect(world.state.containers.has(axe.id)).toBe(false);
      const dropped = addedSince(world, before);
      expect(dropped, `slot ${slot}: what was in hand lies at the player's feet`).toHaveLength(1);
      expect(dropped[0]).toMatchObject({ kind: "ground", x: AT.x + 5, y: AT.y - 3, label: WEAPONS[slot === 0 ? "sword" : "bow"].name });
      expect(defsOf(dropped[0]!)).toEqual([slot === 0 ? "sword" : "bow"]);
      expect(swapped).toEqual(["a"]);
    }
  });

  it("counts that swap like any other: the action is cancelled and the cooldown grows by SWAP_SECONDS", () => {
    const extra = SWAP_SECONDS * 1000;
    for (const lead of [-1000, 0, 700]) {
      const world = startRaid([alice(["sword", "bow"])]);
      const p = P(world, "a");
      const rt = RT(world, "a");
      p.readyAt = world.state.serverTime + 50 + lead;
      const before = p.readyAt;
      rt.weapon.action = { kind: "draw", weapon: "bow", startedAt: world.state.serverTime };
      p.drawStartedAt = world.state.serverTime;
      rt.weapon.rootUntil = world.state.serverTime + 5000;
      const axe = putContainer(world, "ground", AT, ["axe"]);

      pickup(world, "a", axe.id);
      tick(world);
      const now = world.state.serverTime;
      expect(p.readyAt, `lead ${lead}`).toBe(Math.max(before, now) + extra);
      expect(rt.weapon.action, `lead ${lead}`).toBeNull();
      expect(p.drawStartedAt, `lead ${lead}`).toBe(0);
      expect(rt.weapon.rootUntil, `lead ${lead}`).toBeLessThanOrEqual(now);
    }
  });

  it("takes a chest's weapon the same way and leaves the chest standing, empty", () => {
    const world = startRaid([alice(["sword", "bow"])]);
    const chest = putContainer(world, "chest", AT, ["wand"]);
    pickup(world, "a", chest.id);
    expect(toastsOf(tick(world))).toEqual([]);
    expect(slotsOf(world, "a")).toEqual(["wand", "bow"]);
    expect(world.state.containers.get(chest.id)).toBe(chest);
    expect(chest.items).toHaveLength(0);

    pickup(world, "a", chest.id);
    expect(toastsOf(tick(world))).toEqual([{ to: "a", text: "Nothing to take" }]);
    expect(slotsOf(world, "a")).toEqual(["wand", "bow"]);
  });

  it("takes the first weapon of a container and keeps the rest where they are", () => {
    const world = startRaid([alice()]);
    const pile = putContainer(world, "ground", AT, ["axe", "wand"]);
    pickup(world, "a", pile.id);
    tick(world);
    expect(slotsOf(world, "a")).toEqual(["sword", "axe"]);
    expect(world.state.containers.get(pile.id)).toBe(pile);
    expect(defsOf(pile)).toEqual(["wand"]);
  });

  it("lets a dropped weapon be taken back, and so swaps between the ground and the hand as often as asked", () => {
    const world = startRaid([alice(["sword", "bow"])]);
    const axe = putContainer(world, "ground", AT, ["axe"]);
    let lying = axe.id;
    const expected: Array<[WeaponId, WeaponId]> = [["axe", "sword"], ["sword", "axe"], ["axe", "sword"]];
    for (const [inHand, onGround] of expected) {
      const before = new Set(world.state.containers.keys());
      pickup(world, "a", lying);
      expect(toastsOf(tick(world))).toEqual([]);
      expect(P(world, "a").weapon0).toBe(inHand);
      const [dropped] = addedSince(world, before);
      expect(defsOf(dropped!)).toEqual([onGround]);
      expect(world.state.containers.size).toBe(1);
      lying = dropped!.id;
      tick(world); // the drop is first takeable one tick after it appears
    }
  });

  describe("refusals", () => {
    /** Runs one pickup and returns its toasts, asserting that nothing in the world changed unless `changes`. */
    function attempt(world: World, id: string, containerId: string, changes = false): string[] {
      const before = dump(world);
      pickup(world, id, containerId);
      const toasts = toastsOf(tick(world));
      for (const t of toasts) expect(t.to).toBe(id);
      if (!changes) expect(dump(world)).toBe(before);
      return toasts.map((t) => t.text);
    }

    it("toasts 'Too far away' beyond INTERACT_RANGE and takes at exactly that range", () => {
      const world = startRaid([alice()]);
      const bow = putContainer(world, "ground", AT, ["bow"]);
      place(world, "a", { x: AT.x + INTERACT_RANGE + 0.5, y: AT.y });
      expect(attempt(world, "a", bow.id)).toEqual(["Too far away"]);
      place(world, "a", { x: AT.x + INTERACT_RANGE, y: AT.y });
      expect(attempt(world, "a", bow.id, true)).toEqual([]);
      expect(slotsOf(world, "a")).toEqual(["sword", "bow"]);
      // Distance is straight-line, not per axis.
      const wand = putContainer(world, "ground", AT, ["wand"]);
      const d = INTERACT_RANGE / Math.SQRT2 + 1;
      place(world, "a", { x: AT.x + d, y: AT.y + d });
      expect(attempt(world, "a", wand.id)).toEqual(["Too far away"]);
    });

    it("toasts 'Nothing there' for an id that does not exist, or that was taken while the request waited", () => {
      const world = startRaid([alice()]);
      expect(attempt(world, "a", "nope")).toEqual(["Nothing there"]);
      const bow = putContainer(world, "ground", AT, ["bow"]);
      expect(attempt(world, "a", bow.id, true)).toEqual([]);
      expect(attempt(world, "a", bow.id)).toEqual(["Nothing there"]);
    });

    it("toasts 'Nothing to take' for an empty container, or one that holds something that is not a weapon", () => {
      const world = startRaid([alice()]);
      const empty = putContainer(world, "chest", AT, []);
      const junk = putContainer(world, "chest", AT, ["gold"]);
      const body = putContainer(world, "body", AT, []);
      for (const box of [empty, junk, body]) expect(attempt(world, "a", box.id), box.id).toEqual(["Nothing to take"]);
      expect(defsOf(junk)).toEqual(["gold"]);
    });

    it("toasts 'Can't reach that' for a container in range behind a wall, and allows it from its own side", () => {
      const map = hall(40, 20, [[10, 10]], (tx) => tx !== 20);
      const west = { x: 20 * TILE - PLAYER_RADIUS, y: centre(0, 10).y };
      const east = { x: 21 * TILE + PLAYER_RADIUS, y: west.y };
      const world = startRaid([alice(), bob()], {}, map);
      expect(Math.hypot(west.x - east.x, west.y - east.y)).toBe(INTERACT_RANGE);
      const bow = putContainer(world, "ground", { x: east.x - 8, y: east.y }, ["bow"]);
      place(world, "a", west);
      place(world, "b", east);
      expect(Math.hypot(west.x - bow.x, west.y - bow.y)).toBeLessThanOrEqual(INTERACT_RANGE);

      expect(attempt(world, "a", bow.id)).toEqual(["Can't reach that"]);
      expect(slotsOf(world, "a")).toEqual(["sword", ""]);
      expect(attempt(world, "b", bow.id, true)).toEqual([]);
      expect(slotsOf(world, "b")).toEqual(["sword", "bow"]);
    });

    it("does not let a weapon dropped on the near side of a wall be taken from the far side", () => {
      const map = hall(40, 20, [[10, 10]], (tx) => tx !== 20);
      const west = { x: 20 * TILE - PLAYER_RADIUS, y: centre(0, 10).y };
      const east = { x: 21 * TILE + PLAYER_RADIUS, y: west.y };
      const world = startRaid([alice(["sword", "bow"]), bob()], {}, map);
      place(world, "a", west);
      place(world, "b", east);
      // a swaps at the wall: the sword drops at its feet; b, exactly in range on the other side, cannot take it.
      pickup(world, "a", putContainer(world, "ground", west, ["wand"]).id);
      tick(world);
      const sword = [...world.state.containers.values()].find((c) => defsOf(c)[0] === "sword")!;
      tick(world);
      expect(Math.hypot(sword.x - east.x, sword.y - east.y)).toBeLessThanOrEqual(INTERACT_RANGE);
      expect(attempt(world, "b", sword.id)).toEqual(["Can't reach that"]);
    });

    it("does not let a body behind a wall be looted", () => {
      const map = hall(40, 20, [[10, 10]], (tx) => tx !== 20);
      const west = { x: 20 * TILE - PLAYER_RADIUS, y: centre(0, 10).y };
      const east = { x: 21 * TILE + PLAYER_RADIUS, y: west.y };
      const world = startRaid([alice(), bob(), carol(["axe", "wand"])], {}, map);
      place(world, "c", east);
      downPlayer(world, P(world, "c"), RT(world, "c"), "died");
      tick(world); // flush the 'resolved' event; the body is now an ordinary old container
      const body = [...world.state.containers.values()].find((c) => c.kind === "body")!;
      place(world, "a", west);
      expect(attempt(world, "a", body.id)).toEqual(["Can't reach that"]);
      expect(defsOf(body)).toEqual(["axe", "wand"]);
    });

    it("checks the container, then the distance, then the line of sight, then the contents", () => {
      const map = hall(40, 20, [[10, 10]], (tx) => tx !== 20);
      const west = { x: 20 * TILE - PLAYER_RADIUS, y: centre(0, 10).y };
      const east = { x: 21 * TILE + PLAYER_RADIUS, y: west.y };
      const world = startRaid([alice()], {}, map);
      const empty = putContainer(world, "chest", { x: east.x - 8, y: east.y }, []);
      place(world, "a", { x: west.x - 100, y: west.y });
      expect(attempt(world, "a", "nope")).toEqual(["Nothing there"]); // an unknown id beats everything
      expect(attempt(world, "a", empty.id)).toEqual(["Too far away"]); // out of range beats the wall
      place(world, "a", west);
      expect(attempt(world, "a", empty.id)).toEqual(["Can't reach that"]); // the wall beats an empty chest
      place(world, "a", east);
      expect(attempt(world, "a", empty.id)).toEqual(["Nothing to take"]);
    });

    it("lets a player take from their own feet and from a few units away", () => {
      const world = startRaid([alice(["", ""])]);
      const a = putContainer(world, "ground", AT, ["bow"]);
      const b = putContainer(world, "ground", { x: AT.x - 8, y: AT.y }, ["wand"]);
      pickup(world, "a", a.id);
      pickup(world, "a", b.id);
      expect(toastsOf(tick(world))).toEqual([]);
      expect(slotsOf(world, "a")).toEqual(["bow", "wand"]);
    });
  });
});

describe("pickup through a closed coliseum gate", () => {
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

  /** A one-player raid on the generated map of `seed`, with a loose bow just inside `side`'s gate and the player just outside it. */
  function setup(seed: number, side: GateSide) {
    const world = makeWorld({ minPlayers: 1 }, seed);
    setWeapons(addPlayer(world, "a", "alice"), ["sword", ""]);
    tick(world);
    expect(world.state.phase).toBe("active");
    const { outside, inside } = gateSpots(gateOf(world.map, side));
    const bow = putContainer(world, "ground", inside, ["bow"]);
    place(world, "a", outside);
    return { world, bow, outside };
  }

  it("has a gate to test with: the weapon is within reach, in sight with the gates open and out of sight once they close", () => {
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

  it("refuses a weapon just inside a closed gate from just outside it, changing nothing, and allows it once the gates open", () => {
    for (const seed of SEEDS) {
      for (const side of SIDES) {
        const label = `seed ${seed} gate ${side}`;
        const { world, bow } = setup(seed, side);
        world.state.gatesLocked = true;
        const before = dump(world);

        pickup(world, "a", bow.id);
        expect(toastsOf(tick(world)), `${label} locked`).toEqual([{ to: "a", text: "Can't reach that" }]);
        expect(dump(world), `${label} locked: nothing changed`).toBe(before);

        world.state.gatesLocked = false;
        pickup(world, "a", bow.id);
        expect(toastsOf(tick(world)), `${label} open`).toEqual([]);
        expect(slotsOf(world, "a"), `${label} open`).toEqual(["sword", "bow"]);
      }
    }
  });

  it("still lets a player take a weapon on their own side of a closed gate", () => {
    for (const seed of SEEDS) {
      for (const side of SIDES) {
        const label = `seed ${seed} gate ${side}`;
        const { world, outside } = setup(seed, side);
        world.state.gatesLocked = true;
        const [ox, oy] = OUT[side];
        const near = putContainer(world, "ground", { x: outside.x + ox * 8, y: outside.y + oy * 8 }, ["wand"]);
        pickup(world, "a", near.id);
        expect(toastsOf(tick(world)), label).toEqual([]);
        expect(slotsOf(world, "a"), label).toEqual(["sword", "wand"]);
      }
    }
  });
});

describe("pickup of containers created this tick", () => {
  it("refuses a weapon dropped earlier in the same tick by a client that guessed the id, then allows it next tick", () => {
    const world = startRaid([alice(["sword", "bow"])]);
    const axe = putContainer(world, "ground", AT, ["axe"]);
    const guess = nextContainerId(world);

    pickup(world, "a", axe.id); // drops the sword as container `guess`
    pickup(world, "a", guess);
    expect(toastsOf(tick(world))).toEqual([{ to: "a", text: "Nothing there" }]);
    expect(slotsOf(world, "a")).toEqual(["axe", "bow"]);
    expect(defsOf(world.state.containers.get(guess)!)).toEqual(["sword"]);

    pickup(world, "a", guess);
    expect(toastsOf(tick(world))).toEqual([]);
    expect(slotsOf(world, "a")).toEqual(["sword", "bow"]);
  });

  it("stops a second player grabbing a drop that appears in the same tick, even though they act after the dropper", () => {
    const world = startRaid([alice(["sword", "bow"]), bob()]);
    const axe = putContainer(world, "ground", AT, ["axe"]);
    stepUntilFirst(world, "a");
    const guess = nextContainerId(world);

    pickup(world, "a", axe.id);
    pickup(world, "b", guess);
    expect(toastsOf(tick(world))).toEqual([{ to: "b", text: "Nothing there" }]);
    expect(slotsOf(world, "b")).toEqual(["sword", ""]);
    expect(world.state.containers.get(guess)?.items).toHaveLength(1);

    pickup(world, "b", guess);
    expect(toastsOf(tick(world))).toEqual([]);
    expect(slotsOf(world, "b")).toEqual(["sword", "sword"]);
  });

  it("stops a body being looted in the tick its owner goes down, but not on the next one", () => {
    const world = startRaid([alice(["", ""]), bob(["axe", "wand"]), carol()]);
    // Stands in for a combat system: acting kills the actor mid-tick.
    world.actions.attack = (w, c) => { if (c.kind === "player") downPlayer(w, c.s, c.rt, "died"); };
    stepUntilFirst(world, "b");
    const guess = nextContainerId(world);

    send(world, "b", "attack", { a: 0 });
    pickup(world, "a", guess);
    expect(toastsOf(tick(world))).toEqual([{ to: "a", text: "Nothing there" }]);
    expect(P(world, "b").status).toBe("dead");
    expect(slotsOf(world, "a")).toEqual(["", ""]);
    expect(world.state.containers.get(guess)).toMatchObject({ kind: "body" });

    pickup(world, "a", guess);
    expect(toastsOf(tick(world))).toEqual([]);
    expect(slotsOf(world, "a")).toEqual(["axe", ""]);
  });

  it("gates the body of a player who disconnected between ticks until clients have seen it", () => {
    const world = startRaid([alice(["", ""]), bob(["axe", ""]), carol()]);
    removePlayer(world, "b");
    const body = [...world.state.containers.values()].find((c) => c.kind === "body")!;

    // The next tick is the first patch that carries the body: a pickup in it can only be a guessed id.
    pickup(world, "a", body.id);
    expect(toastsOf(tick(world))).toEqual([{ to: "a", text: "Nothing there" }]);
    expect(slotsOf(world, "a")).toEqual(["", ""]);

    pickup(world, "a", body.id);
    expect(toastsOf(tick(world))).toEqual([]);
    expect(slotsOf(world, "a")).toEqual(["axe", ""]);
  });

  it("never gates containers spawned with the world, even when asked at tick 0", () => {
    const world = makeWorld();
    setWeapons(addPlayer(world, "a", "alice"), ["sword", ""]);
    const chest = [...world.state.containers.values()].find((c) => c.kind === "chest")!;
    place(world, "a", chest);
    expect(world.state.tick).toBe(0);

    handlePickup(world, combatant(world, "a")!, { kind: "pickup", containerId: chest.id });
    expect(world.events).toEqual([]);
    expect(chest.items).toHaveLength(0);
    expect(P(world, "a").weapon1).not.toBe("");
  });

  it("does not gate hand-placed containers, nor leak births between worlds", () => {
    const one = startRaid([alice(["sword", "bow"])]);
    const two = startRaid([alice()]);
    expect(one.state.tick).toBe(two.state.tick);

    const axe = putContainer(one, "ground", AT, ["axe"]);
    const guess = nextContainerId(one);
    pickup(one, "a", axe.id);
    tick(one); // the drop is container `guess`, born this tick
    // A container with the same id in the other world, at the same tick, is a different container.
    const twin = putContainer(two, "ground", AT, ["axe"]);
    two.state.containers.delete(twin.id);
    twin.id = guess;
    two.state.containers.set(guess, twin);
    pickup(two, "a", guess);
    expect(toastsOf(tick(two))).toEqual([]);
    expect(slotsOf(two, "a")).toEqual(["sword", "axe"]);
  });
});

describe("bodies", () => {
  it("hold both weapons a fallen player carried, where they fell, and the player keeps nothing", () => {
    const world = startRaid([alice(), bob(["axe", "wand"]), carol()]);
    place(world, "b", { x: AT.x + 7, y: AT.y + 9 });
    downPlayer(world, P(world, "b"), RT(world, "b"), "died");
    const body = [...world.state.containers.values()].find((c) => c.kind === "body")!;
    expect(body).toMatchObject({ x: AT.x + 7, y: AT.y + 9, label: "bob" });
    expect(defsOf(body)).toEqual(["axe", "wand"]);
    expect(slotsOf(world, "b")).toEqual(["", ""]);
    expect(P(world, "b").status).toBe("dead");
  });

  it("can be emptied with two pickups, one weapon each, and then hold nothing", () => {
    for (const sameTick of [false, true]) {
      const world = startRaid([alice(["", ""]), bob(["axe", "wand"]), carol()]);
      downPlayer(world, P(world, "b"), RT(world, "b"), "died");
      const body = [...world.state.containers.values()].find((c) => c.kind === "body")!;
      tick(world); // created between ticks: clients first see it in this tick's patch

      pickup(world, "a", body.id);
      if (!sameTick) { expect(toastsOf(tick(world))).toEqual([]); expect(slotsOf(world, "a")).toEqual(["axe", ""]); }
      pickup(world, "a", body.id);
      expect(toastsOf(tick(world)), `same tick ${sameTick}`).toEqual([]);
      expect(slotsOf(world, "a"), `same tick ${sameTick}`).toEqual(["axe", "wand"]);
      expect(P(world, "a").slot).toBe(0);
      expect(world.state.containers.get(body.id)).toBe(body);
      expect(body.items).toHaveLength(0);

      pickup(world, "a", body.id);
      expect(toastsOf(tick(world))).toEqual([{ to: "a", text: "Nothing to take" }]);
    }
  });

  it("hold one weapon for a player who carried one, and none for a player who carried none", () => {
    const world = startRaid([alice(), bob(["", "bow"]), carol(["", ""])]);
    const dies = (id: string) => { downPlayer(world, P(world, id), RT(world, id), "died"); };
    const bodies = () => [...world.state.containers.values()].filter((c) => c.kind === "body");
    dies("b");
    expect(bodies().map(defsOf)).toEqual([["bow"]]);
    dies("c");
    expect(bodies().map(defsOf)).toEqual([["bow"], []]);
    expect(new Set(bodies().map((c) => c.id)).size).toBe(2);
  });

  it("are left by a player who disconnects mid-raid too, with no death fx", () => {
    const world = startRaid([alice(), bob(["shield", "axe"]), carol()]);
    removePlayer(world, "b");
    const events = tick(world);
    const body = [...world.state.containers.values()].find((c) => c.kind === "body")!;
    expect(defsOf(body)).toEqual(["shield", "axe"]);
    expect(ofType(events, "fx").filter((e) => e.fx.kind === "death")).toEqual([]);
  });

  it("dropBody called directly takes exactly what the player carries, in slot order", () => {
    const world = startRaid([alice(["", "wand"]), bob()]);
    dropBody(world, P(world, "a"));
    const body = [...world.state.containers.values()].find((c) => c.kind === "body")!;
    expect(defsOf(body)).toEqual(["wand"]);
    expect(body).toMatchObject({ x: AT.x, y: AT.y, label: "alice" });
    expect(slotsOf(world, "a")).toEqual(["", ""]);
    expect(body.items.at(0)!.uid).toMatch(/^L\d+$/);
  });
});

describe("who can pick up", () => {
  it("only players: a mob's pickup, queued or handed straight to the handler, does nothing", () => {
    const world = startRaid([alice(), bob()]);
    const bow = putContainer(world, "ground", AT, ["bow"]);
    const mob = addMob(world, { kind: "dummy", name: "Dummy", at: AT });
    const before = dump(world);

    world.mobs.get(mob)!.inputs.pushAction({ kind: "pickup", containerId: bow.id });
    expect(toastsOf(tick(world))).toEqual([]);
    handlePickup(world, combatant(world, mob)!, { kind: "pickup", containerId: bow.id });
    expect(world.events).toEqual([]);
    expect(dump(world)).toBe(before);
    expect(world.state.mobs.get(mob)).toMatchObject({ weapon0: "", weapon1: "" });
  });

  it("ignores actions of other kinds when the handler is called directly", () => {
    const world = startRaid([alice()]);
    const bow = putContainer(world, "ground", AT, ["bow"]);
    const before = dump(world);
    handlePickup(world, combatant(world, "a")!, { kind: "attack", a: 0 });
    handlePickup(world, combatant(world, "a")!, { kind: "swap" });
    expect(world.events).toEqual([]);
    expect(dump(world)).toBe(before);
    expect(world.state.containers.has(bow.id)).toBe(true);
  });
});

describe("pickup races", () => {
  /** Seats join in `ids` order, idle `idle` ticks, then all take the same weapon in one tick. */
  function contest(ids: string[], kind: ContainerKind, idle: number) {
    const world = startRaid(ids.map((id) => SEATS[id]!()));
    for (let i = 0; i < idle; i++) tick(world);
    const box = putContainer(world, kind, AT, ["axe"]);
    for (const id of ids) pickup(world, id, box.id);
    const events = tick(world);
    const winners = ids.filter((id) => P(world, id).weapon1 === "axe");
    return { world, box, events, winners };
  }

  it("gives a weapon taken by several players in the same tick to exactly one of them, and the rest are told it is gone", () => {
    for (const ids of [["a", "b"], ["b", "a"], ["a", "b", "c"], ["c", "a", "b"]]) {
      for (const kind of ["chest", "ground"] as const) {
        for (let idle = 0; idle < 6; idle++) {
          const { world, box, events, winners } = contest(ids, kind, idle);
          const label = `${ids.join("")} ${kind} after ${idle} idle ticks`;
          expect(winners, label).toHaveLength(1);
          const losers = ids.filter((id) => id !== winners[0]);
          // A chest is still there, empty; a loose weapon is gone from under the later taker.
          const why = kind === "chest" ? "Nothing to take" : "Nothing there";
          expect(toastsOf(events).sort((x, y) => x.to.localeCompare(y.to)), label)
            .toEqual(losers.map((to) => ({ to, text: why })).sort((x, y) => x.to.localeCompare(y.to)));
          for (const id of losers) expect(slotsOf(world, id), label).toEqual(["sword", ""]);
          expect(world.state.containers.has(box.id), label).toBe(kind === "chest");
        }
      }
    }
  });

  it("does not favour whoever joined first: over consecutive ticks every contender wins at least once", () => {
    for (const ids of [["a", "b"], ["b", "a"], ["a", "b", "c"]]) {
      const wins = new Map<string, number>(ids.map((id) => [id, 0]));
      for (let idle = 0; idle < ids.length * 6; idle++) {
        const { winners } = contest(ids, "ground", idle);
        wins.set(winners[0]!, wins.get(winners[0]!)! + 1);
      }
      for (const id of ids) expect(wins.get(id), `${ids.join("")}: wins for ${id}`).toBeGreaterThan(0);
    }
  });
});

describe("loot flow through the sim", () => {
  it("never duplicates or loses a weapon, whatever players grab from a pile over many ticks", () => {
    const world = startRaid([alice(["sword", "bow"]), bob(["axe", ""]), carol(["", "wand"])]);
    putContainer(world, "chest", AT, ["shield"]);
    putContainer(world, "ground", AT, ["bow"]);
    putContainer(world, "ground", AT, ["axe"]);
    putContainer(world, "body", AT, ["wand", "sword"]);
    const census = (): string[] => {
      const out: string[] = [];
      for (const p of world.state.players.values()) for (const w of [p.weapon0, p.weapon1]) if (w) out.push(w);
      for (const c of world.state.containers.values()) out.push(...defsOf(c));
      return out.sort();
    };
    const expected = census();
    expect(expected).toHaveLength(9);

    const rnd = mulberry32(99);
    for (let t = 0; t < 300; t++) {
      const ids = [...world.state.containers.keys()];
      for (const id of ["a", "b", "c"]) {
        if (rnd() < 0.7) pickup(world, id, ids[Math.floor(rnd() * ids.length)]!);
      }
      tick(world);
      expect(census(), `tick ${t}`).toEqual(expected);
      const uids = [...world.state.containers.values()].flatMap((c) => c.items.map((i) => i.uid));
      expect(new Set(uids).size, `tick ${t}: uids`).toBe(uids.length);
    }
  });

  it("lets a player take a chest's weapon on a generated map", () => {
    const world = makeWorld({ minPlayers: 1 });
    setWeapons(addPlayer(world, "a", "alice"), ["sword", ""]);
    tick(world);
    const chest = [...world.state.containers.values()].find((c) => c.kind === "chest")!;
    const weapon = defsOf(chest)[0]!;
    place(world, "a", chest);
    tick(world);
    pickup(world, "a", chest.id);
    expect(toastsOf(tick(world))).toEqual([]);
    expect(slotsOf(world, "a")).toEqual(["sword", weapon]);
    expect(chest.items).toHaveLength(0);
  });
});

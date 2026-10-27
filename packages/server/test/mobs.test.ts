import { describe, expect, it } from "vitest";
import {
  circleClear, damagePerHit, DUMMY_HP, DUMMY_RESET_SECONDS, FACTIONS, findPath, hasLineOfSight, mapFromTiles, mulberry32,
  pacedFaction, PLAYER_RADIUS, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, tileToWorldCenter, WEAPON_IDS, WEAPONS, worldToTile,
  type FxEvent, type GameMap, type Vec2, type WeaponId,
} from "@raid/shared";
import type { ContainerState, MobState } from "@raid/shared/schema";
import { applyDamage } from "../src/sim/arena";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage, InputQueue } from "../src/sim/inputs";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { dropWeapon } from "../src/sim/loot";
import { addMob, damageMob, resetDummies, spawnTraining } from "../src/sim/mobs";
import { addPlayer, removePlayer, step } from "../src/sim/step";
import { newWeaponRuntime, type SimConfig, type SimEvent, type World } from "../src/sim/world";

type EventOf<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;
type Fx<K extends FxEvent["kind"]> = Extract<FxEvent, { kind: K }>;

function makeConfig(cfg: Partial<SimConfig> = {}): SimConfig {
  return {
    minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
    suddenDeathSeconds: 60, ...cfg,
  };
}

const idOf = (i: number): string => `p${i}`;
const NAMES = ["alice", "bob", "carol", "dave", "erin", "frank", "gina", "hank"];
const centre = (tx: number, ty: number): Vec2 => ({ x: tileToWorldCenter(tx), y: tileToWorldCenter(ty) });
const tileOf = (v: Vec2): string => `${worldToTile(v.x)},${worldToTile(v.y)}`;
const tick = (world: World): SimEvent[] => step(world, TICK_MS);

function ofType<T extends SimEvent["type"]>(events: SimEvent[], type: T): Array<EventOf<T>> {
  return events.filter((e): e is EventOf<T> => e.type === type);
}

function fxOf<K extends FxEvent["kind"]>(events: SimEvent[], kind: K): Array<Fx<K>> {
  return ofType(events, "fx").map((e) => e.fx).filter((fx): fx is Fx<K> => fx.kind === kind);
}

/** `n` players (p0 alice, p1 bob, ...) on the generated map of `seed`, joined but not started: the first step starts the run. */
function lobby(n: number, cfg: Partial<SimConfig> = {}, seed = 1234): World {
  const world = createGameWorld({ seed, config: makeConfig({ minPlayers: n, ...cfg }), random: mulberry32(seed + 1) });
  for (let i = 0; i < n; i++) addPlayer(world, idOf(i), NAMES[i]!);
  return world;
}

function started(world: World): World {
  tick(world);
  expect(world.state.phase).toBe("active");
  return world;
}

/** A walled hall of open floor with no ruins: shots and walks go exactly where a test says. Spawns are tile coordinates. */
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

/** `n` players on a hand-built map, run started. The game modules are installed, but the generated map's loot is cleared away. */
function startHall(map: GameMap, n: number, cfg: Partial<SimConfig> = {}): World {
  // Weapon behaviour on dummies: the shooter's faction signature would add its own damage once in contact.
  const world = createGameWorld({ seed: 1234, config: makeConfig({ minPlayers: n, ...cfg }), random: mulberry32(7) }, { signatures: false });
  world.map = map;
  world.state.containers.clear();
  for (let i = 0; i < n; i++) addPlayer(world, idOf(i), NAMES[i]!);
  return started(world);
}

/** Puts a player at an exact spot (and forgets where they were: lag compensation rewinds along the history). */
function place(world: World, id: string, at: Vec2): void {
  const p = world.state.players.get(id)!;
  p.x = at.x;
  p.y = at.y;
  world.players.get(id)!.history = [{ t: world.state.serverTime, x: at.x, y: at.y }];
}

const mobOf = (world: World, id: string): MobState => world.state.mobs.get(id)!;

function mobCombatant(world: World, id: string): Extract<NonNullable<ReturnType<typeof combatant>>, { kind: "mob" }> {
  const c = combatant(world, id);
  if (c?.kind !== "mob") throw new Error(`${id} is not a mob`);
  return c;
}

/** A hit of `raw` on a mob, applied now (between ticks) through the ledger, the way every damage source lands. */
function hitMob(world: World, id: string, raw: number, shares = { phys: 1, magic: 0, true: 0 }): void {
  recordHit(world, {
    victim: id, by: { id: idOf(0), name: NAMES[0]! }, packet: { raw, ...shares }, weapon: "sword", stagger: false,
  });
  applyLedger(world);
}

describe("addMob", () => {
  it("adds a dummy to the state and a runtime with a seeded history", () => {
    const world = startHall(hall(12, 12, [[3, 3]]), 1);
    const id = addMob(world, { kind: "dummy", name: "Dummy", at: centre(8, 8) });
    expect(world.state.mobs.get(id)).toMatchObject({
      kind: "dummy", name: "Dummy", x: centre(8, 8).x, y: centre(8, 8).y, facing: 0, hp: DUMMY_HP, maxHp: DUMMY_HP,
      status: "alive", faction: "", weapon0: "", weapon1: "", slot: 0, drawStartedAt: 0, readyAt: 0,
    });
    const rt = world.mobs.get(id)!;
    expect(rt.id).toBe(id);
    expect(rt.inputs).toBeInstanceOf(InputQueue);
    expect(rt.path).toEqual([]);
    expect(rt.history).toEqual([{ t: world.state.serverTime, x: centre(8, 8).x, y: centre(8, 8).y }]);
    expect(rt.weapon).toEqual(newWeaponRuntime());
    expect(rt.lastHitAt).toBe(0);
  });

  it("takes hp, facing and a weapon from the spec, and gives every mob its own id", () => {
    const world = startHall(hall(12, 12, [[3, 3]]), 1);
    const a = addMob(world, { kind: "dummy", name: "A", at: centre(6, 6), hp: 80, facing: 1.5, weapon: "shield" });
    const b = addMob(world, { kind: "dummy", name: "B", at: centre(7, 6) });
    expect(a).not.toBe(b);
    expect(mobOf(world, a)).toMatchObject({ hp: 80, maxHp: 80, facing: 1.5, weapon0: "shield" });
    expect(mobOf(world, b)).toMatchObject({ hp: DUMMY_HP, weapon0: "" });
    expect(world.mobs.size).toBe(2);
  });
});

describe("damage", () => {
  it("lands through the ledger as the packet's raw damage whatever its shares: a dummy has no armor or shield", () => {
    const world = startHall(hall(12, 12, [[3, 3]]), 1);
    for (const shares of [{ phys: 1, magic: 0, true: 0 }, { phys: 0, magic: 1, true: 0 }, { phys: 0, magic: 0, true: 1 }]) {
      const id = addMob(world, { kind: "dummy", name: "Dummy", at: centre(8, 8) });
      hitMob(world, id, 100, shares);
      expect(mobOf(world, id).hp, JSON.stringify(shares)).toBe(DUMMY_HP - 100);
      expect(fxOf(world.events, "hit").at(-1)).toMatchObject({ id, by: idOf(0), amount: 100, weapon: "sword" });
    }
  });

  it("sums the hits of one moment, ignores empty ones and stamps the time of the last hit", () => {
    const world = startHall(hall(12, 12, [[3, 3]]), 1);
    const id = addMob(world, { kind: "dummy", name: "Dummy", at: centre(8, 8) });
    const c = mobCombatant(world, id);
    expect(damageMob(world, c, [30, 0, -5, 20])).toBe(50);
    expect(c.s.hp).toBe(DUMMY_HP - 50);
    expect(c.rt.lastHitAt).toBe(world.state.serverTime);
    tick(world);
    expect(damageMob(world, c, [0, -3])).toBe(0);
    expect(damageMob(world, c, [])).toBe(0);
    expect(c.rt.lastHitAt).toBe(world.state.serverTime - TICK_MS);
  });

  it("never kills: a hit worth more than its hp refills it, and so do several that add up to more", () => {
    const world = startHall(hall(12, 12, [[3, 3]]), 1);
    const small = addMob(world, { kind: "dummy", name: "Small", at: centre(8, 8), hp: 100 });
    hitMob(world, small, 123);
    expect(mobOf(world, small)).toMatchObject({ hp: 100, maxHp: 100, status: "alive" });
    expect(world.state.mobs.has(small)).toBe(true);
    expect(fxOf(world.events, "death")).toEqual([]);

    const big = mobCombatant(world, addMob(world, { kind: "dummy", name: "Big", at: centre(9, 8) }));
    expect(damageMob(world, big, [3000, 3000])).toBe(6000);
    expect(big.s.hp).toBe(DUMMY_HP);
    expect(damageMob(world, big, [3000, 1000])).toBe(4000);
    expect(big.s.hp).toBe(DUMMY_HP - 4000);
    hitMob(world, big.id, DUMMY_HP * 10);
    expect(big.s).toMatchObject({ hp: DUMMY_HP, status: "alive" });
  });

  it("heals back to full exactly DUMMY_RESET_SECONDS after the last hit, and every hit restarts the wait", () => {
    const world = startHall(hall(12, 12, [[3, 3]]), 1);
    const id = addMob(world, { kind: "dummy", name: "Dummy", at: centre(8, 8) });
    const wait = DUMMY_RESET_SECONDS * 1000;
    const runTo = (serverTime: number) => { while (world.state.serverTime < serverTime) tick(world); };

    hitMob(world, id, 400);
    const firstHit = world.state.serverTime;
    runTo(firstHit + wait - TICK_MS);
    expect(mobOf(world, id).hp).toBe(DUMMY_HP - 400);
    runTo(firstHit + 2000);
    hitMob(world, id, 100);
    const secondHit = world.state.serverTime;
    runTo(firstHit + wait);
    expect(mobOf(world, id).hp, "the first hit's wait is over, the second one's is not").toBe(DUMMY_HP - 500);
    runTo(secondHit + wait - TICK_MS);
    expect(mobOf(world, id).hp).toBe(DUMMY_HP - 500);
    tick(world);
    expect(mobOf(world, id).hp).toBe(DUMMY_HP);
  });

  it("leaves a dummy at full hp alone, and the system is installed by createGameWorld", () => {
    const world = startHall(hall(12, 12, [[3, 3]]), 1);
    expect(world.systems).toContain(resetDummies);
    const id = addMob(world, { kind: "dummy", name: "Dummy", at: centre(8, 8), hp: 100 });
    for (let i = 0; i < 80; i++) tick(world);
    expect(mobOf(world, id).hp).toBe(100);
  });
});

describe("a dummy in a fight", () => {
  /** One archer (p0, bow, aiming east) six tiles from a dummy holding `weapon` and facing back at them. */
  function range(weapon?: WeaponId) {
    const world = startHall(hall(24, 16, [[4, 8]]), 1);
    const p = world.state.players.get(idOf(0))!;
    p.weapon0 = "bow";
    p.weapon1 = "";
    p.slot = 0;
    place(world, idOf(0), centre(4, 8));
    const dummy = addMob(world, { kind: "dummy", name: "Dummy", at: centre(10, 8), facing: Math.PI, weapon });
    return { world, p, dummy };
  }

  /** A full draw, a release, and enough ticks for the arrow to land (or come back). */
  function shoot(world: World): SimEvent[] {
    const events: SimEvent[] = [];
    const send = (type: string) => expect(enqueueClientMessage(world.players.get(idOf(0))!.inputs, type, { a: 0 })).toBe(true);
    send("attack");
    for (let i = 0; i < 15; i++) events.push(...tick(world));
    send("release");
    for (let i = 0; i < 30; i++) events.push(...tick(world));
    return events;
  }

  it("takes an arrow as damage, shows it in a hit fx, and pays the shooter nothing", () => {
    const { world, p, dummy } = range();
    const events = shoot(world);
    const expected = damagePerHit(pacedFaction(FACTIONS[p.faction as keyof typeof FACTIONS]), "bow");
    const hits = fxOf(events, "hit");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id: dummy, by: idOf(0), weapon: "bow" });
    expect(hits[0]!.amount).toBeCloseTo(expected, 9);
    expect(mobOf(world, dummy).hp).toBeCloseTo(DUMMY_HP - expected, 9);
    expect(world.mobs.get(dummy)!.lastHitAt).toBeGreaterThan(0);
    expect(fxOf(events, "projEnd").map((e) => e.reason)).toEqual(["hit"]);

    expect(p.hp).toBe(p.maxHp);
    expect(p.kills).toBe(0);
    expect(p.gv).toBe(0);
    expect(world.players.get(idOf(0))!.gv).toEqual({ kills: 0, mobs: 0, bounty: 0, quest: 0 });
    expect(ofType(events, "gv")).toEqual([]);
  });

  it("reflects the arrow with a shield facing it: the dummy is untouched and the arrow flies back at the shooter", () => {
    const { world, p, dummy } = range("shield");
    const events = shoot(world);
    expect(fxOf(events, "projEnd").map((e) => e.reason)).toEqual(["reflected", "hit"]);
    expect(fxOf(events, "block")).toMatchObject([{ id: dummy, by: idOf(0), weapon: "bow" }]);
    expect(mobOf(world, dummy).hp).toBe(DUMMY_HP);
    expect(world.mobs.get(dummy)!.lastHitAt).toBe(0);
    // The reflected arrow is the dummy's, and it lands on the archer.
    const hits = fxOf(events, "hit");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id: idOf(0), by: dummy, weapon: "shield" });
    expect(p.hp).toBeLessThan(p.maxHp);
    expect(world.projectiles.size).toBe(0);
  });

  it("takes the arrow after all when its shield faces away", () => {
    const { world, dummy } = range("shield");
    mobOf(world, dummy).facing = 0;
    const events = shoot(world);
    expect(fxOf(events, "projEnd").map((e) => e.reason)).toEqual(["hit"]);
    expect(fxOf(events, "block")).toEqual([]);
    expect(mobOf(world, dummy).hp).toBeLessThan(DUMMY_HP);
  });

  it("never attacks, not even when told to: it has no faction, so no weapon rhythm", () => {
    const world = startHall(hall(12, 12, [[3, 3]]), 1);
    place(world, idOf(0), centre(6, 6));
    const shield = addMob(world, { kind: "dummy", name: "Shield dummy", at: centre(7, 6), facing: Math.PI, weapon: "shield" });
    const plain = addMob(world, { kind: "dummy", name: "Dummy", at: centre(6, 7) });
    const events: SimEvent[] = [];
    for (let i = 0; i < 60; i++) {
      for (const id of [shield, plain]) {
        enqueueClientMessage(world.mobs.get(id)!.inputs, "attack", { a: Math.PI });
        enqueueClientMessage(world.mobs.get(id)!.inputs, "release", { a: Math.PI });
      }
      events.push(...tick(world));
    }
    const p = world.state.players.get(idOf(0))!;
    expect(p.hp).toBe(p.maxHp);
    expect(fxOf(events, "windup")).toEqual([]);
    expect(fxOf(events, "hit")).toEqual([]);
    for (const id of [shield, plain]) {
      expect(world.mobs.get(id)!.weapon.action).toBeNull();
      expect(mobOf(world, id).readyAt).toBe(0);
    }
  });
});

describe("dummies and the arena", () => {
  const dummyRun = (n: number) => started(lobby(n, { dummies: true }));

  it("don't count as players: the last player standing still wins and the run ends with the dummies up", () => {
    const world = dummyRun(3);
    expect(world.state.mobs.size).toBe(6);
    for (const i of [1, 2]) applyDamage(world, world.state.players.get(idOf(i))!, world.players.get(idOf(i))!, 1e6, "test");
    const events = tick(world);
    expect(world.state.phase).toBe("ended");
    expect(world.state.winner).toBe("alice");
    expect(ofType(events, "resolved").map((e) => [e.id, e.result.outcome]).sort()).toEqual([
      ["p0", "won"], ["p1", "died"], ["p2", "died"],
    ]);
    expect(world.state.mobs.size).toBe(6);
    for (const m of world.state.mobs.values()) expect(m.status).toBe("alive");
  });

  it("don't keep a solo run alive after its player leaves", () => {
    const world = dummyRun(1);
    expect(world.state.mobs.size).toBe(2);
    removePlayer(world, idOf(0));
    tick(world);
    expect(world.state.phase).toBe("ended");
  });

  it("give no GV, kills or bounty however hard they are hit", () => {
    const world = dummyRun(2);
    const p = world.state.players.get(idOf(0))!;
    const events: SimEvent[] = [];
    for (const id of world.state.mobs.keys()) {
      hitMob(world, id, 1e6);
      events.push(...world.events);
    }
    expect(world.state.mobs.size).toBe(4);
    expect([p.kills, p.gv, p.bounty]).toEqual([0, 0, 0]);
    expect(world.players.get(idOf(0))!.mobKills).toBe(0);
    expect(world.players.get(idOf(0))!.gv).toEqual({ kills: 0, mobs: 0, bounty: 0, quest: 0 });
    expect(ofType(events, "gv")).toEqual([]);
  });
});

/** Everything spawnTraining placed in `world`: the dummies, and the loose weapons that were not there before the run began. */
function trainingOf(world: World, before: ReadonlySet<string>): { mobs: MobState[]; rack: ContainerState[] } {
  return {
    mobs: [...world.state.mobs.values()],
    rack: [...world.state.containers.values()].filter((c) => !before.has(c.id)),
  };
}

/** Is `at` a spot a player can walk to and stand on, `lo` to `hi` tiles from `from`? */
function expectNear(world: World, from: Vec2, at: Vec2, label: string, lo = 3, hi = 6): void {
  const d = Math.hypot(at.x - from.x, at.y - from.y) / TILE;
  expect(d, `${label}: distance in tiles`).toBeGreaterThanOrEqual(lo);
  expect(d, `${label}: distance in tiles`).toBeLessThanOrEqual(hi);
  expect(circleClear(world.map, at, PLAYER_RADIUS), `${label}: free floor`).toBe(true);
  expect(findPath(world.map, from, at, PLAYER_RADIUS).length, `${label}: reachable`).toBeGreaterThan(0);
}

describe("spawnTraining", () => {
  describe("installation", () => {
    it("is chained onto raidStarted only when config.dummies is set", () => {
      const off = lobby(2);
      const loot = off.state.containers.size;
      started(off);
      expect(off.state.mobs.size).toBe(0);
      expect(off.state.containers.size).toBe(loot);

      const on = lobby(2, { dummies: true });
      const before = on.state.containers.size;
      expect(on.state.mobs.size).toBe(0);
      started(on);
      expect(on.state.mobs.size).toBe(4);
      expect(on.state.containers.size).toBe(before + 2 * WEAPON_IDS.length);
    });

    it("waits for the run to start: nothing exists in the lobby", () => {
      const world = lobby(2, { dummies: true });
      expect(world.state.mobs.size).toBe(0);
      expect(world.state.phase).toBe("lobby");
    });

    it("draws nothing from world.random, so a training run rolls the same as any other", () => {
      const next = (dummies: boolean) => {
        const world = started(lobby(3, { dummies }));
        return [world.random(), world.random()];
      };
      expect(next(true)).toEqual(next(false));
    });
  });

  describe("on generated maps", () => {
    const SEEDS = [1234, 7, 99, 1, 2, 3, 42, 732, 2547, 3129, 5000, 31337];

    it.each(SEEDS)("seed %i: every one of 8 players gets 2 dummies and the 5 weapons on free floor they can walk to", (seed) => {
      const world = lobby(8, { dummies: true }, seed);
      const before = new Set(world.state.containers.keys());
      started(world);
      const { mobs, rack } = trainingOf(world, before);
      const players = [...world.state.players.values()];
      expect(mobs, "dummies").toHaveLength(2 * players.length);
      expect(rack, "rack weapons").toHaveLength(WEAPON_IDS.length * players.length);

      // Tiles nothing may share: every spawn, every pre-existing container, and every piece placed.
      const seen = new Map<string, string>();
      const claim = (at: Vec2, label: string) => {
        const key = tileOf(at);
        expect(seen.get(key), `${label} is on the tile of ${seen.get(key)}`).toBeUndefined();
        seen.set(key, label);
      };
      world.map.spawns.forEach((s, i) => claim(s, `spawn ${i}`));
      for (const id of before) claim(world.state.containers.get(id)!, `loot ${id}`);

      players.forEach((p, i) => {
        const spawn = { x: p.x, y: p.y };
        const [plain, shield] = mobs.slice(2 * i, 2 * i + 2) as [MobState, MobState];
        const weapons = rack.slice(WEAPON_IDS.length * i, WEAPON_IDS.length * (i + 1));
        const who = `player ${i}`;

        expect(plain, `${who} dummy`).toMatchObject({ name: "Dummy", kind: "dummy", weapon0: "", weapon1: "", faction: "", hp: DUMMY_HP });
        expect(shield, `${who} shield dummy`).toMatchObject({ name: "Shield dummy", weapon0: "shield", weapon1: "", slot: 0, faction: "" });
        for (const m of [plain, shield]) {
          expectNear(world, spawn, m, `${who} ${m.name}`);
          expect(hasLineOfSight(world.map, spawn, m), `${who} ${m.name}: in sight of the spawn`).toBe(true);
          expect(m.facing, `${who} ${m.name} faces the spawn`).toBeCloseTo(Math.atan2(spawn.y - m.y, spawn.x - m.x), 9);
          claim(m, `${who} ${m.name}`);
        }

        expect(weapons.map((c) => c.items.at(0)?.def), `${who} rack`).toEqual([...WEAPON_IDS]);
        for (const c of weapons) {
          const def = c.items.at(0)!.def as WeaponId;
          expect(c).toMatchObject({ kind: "ground", label: WEAPONS[def].name });
          expect(c.items).toHaveLength(1);
          expectNear(world, spawn, c, `${who} ${def}`);
          claim(c, `${who} ${def}`);
        }
        // A short row: five neighbouring tiles in a line, in catalog order.
        const row = weapons.every((c) => c.y === weapons[0]!.y) ? weapons.map((c) => c.x) : weapons.map((c) => c.y);
        expect(row.map((v, k) => (k === 0 ? TILE : v - row[k - 1]!)), `${who} rack is a row`).toEqual(Array(WEAPON_IDS.length).fill(TILE));
      });
    });

    it("is deterministic for a map and a player order", () => {
      const layout = (seed: number, n: number) => {
        const world = started(lobby(n, { dummies: true }, seed));
        const mobs = [...world.state.mobs.values()].map((m) => [m.name, m.x, m.y, m.facing, m.weapon0]);
        const ground = [...world.state.containers.values()].filter((c) => c.kind === "ground").map((c) => [c.label, c.x, c.y]);
        return JSON.stringify({ mobs, ground });
      };
      expect(layout(1234, 8)).toBe(layout(1234, 8));
      expect(layout(99, 4)).toBe(layout(99, 4));
      expect(layout(1234, 8)).not.toBe(layout(99, 8));
    });

    it("leaves the rack weapons as ordinary loose weapons a player can walk up to and take", () => {
      const world = started(lobby(1, { dummies: true }));
      const bow = [...world.state.containers.values()].find((c) => c.kind === "ground" && c.items.at(0)?.def === "bow" && c.label === "Bow")!;
      const p = world.state.players.get(idOf(0))!;
      const carried = p.weapon0;
      expect(p.weapon1).toBe("");
      place(world, idOf(0), bow);
      enqueueClientMessage(world.players.get(idOf(0))!.inputs, "pickup", { containerId: bow.id });
      tick(world);
      expect(p.weapon1).toBe("bow");
      expect(p.weapon0).toBe(carried);
      expect(world.state.containers.has(bow.id)).toBe(false);
    });
  });

  describe("on hand-built maps", () => {
    /** Calls spawnTraining by hand once the run is on, so a test controls what is already lying around. */
    const train = (world: World) => { const before = new Set(world.state.containers.keys()); spawnTraining(world); return trainingOf(world, before); };

    it("puts the nearest free tiles to use first: dummy, shield dummy, then the weapons in catalog order", () => {
      // A one-tile corridor with the spawn at its west end: tiles 4..7 are the only ones 3 to 6 tiles away.
      const world = startHall(hall(14, 5, [[1, 2]], (_tx, ty) => ty === 2), 1);
      expect(world.state.mobs.size).toBe(0);
      const { mobs, rack } = train(world);
      expect(mobs.map((m) => [m.name, tileOf(m)])).toEqual([["Dummy", "4,2"], ["Shield dummy", "5,2"]]);
      // Four tiles are not a row of five, so the weapons take what is left, nearest first; the rest are skipped.
      expect(rack.map((c) => [c.items.at(0)!.def, tileOf(c)])).toEqual([["sword", "6,2"], ["bow", "7,2"]]);
      expect(mobs[1]!.facing).toBeCloseTo(Math.PI, 9);
    });

    it("keeps off tiles that already hold a container or a mob", () => {
      const world = startHall(hall(14, 5, [[1, 2]], (_tx, ty) => ty === 2), 1);
      dropWeapon(world, centre(4, 2), "axe");
      addMob(world, { kind: "dummy", name: "Guard", at: centre(5, 2) });
      const { mobs, rack } = train(world);
      expect(mobs.slice(1).map((m) => [m.name, tileOf(m)])).toEqual([["Dummy", "6,2"], ["Shield dummy", "7,2"]]);
      expect(rack).toEqual([]);
    });

    it("skips every piece when no tile is both free and in range", () => {
      // A 3x3 room: nothing is 3 tiles from its middle.
      const world = startHall(hall(5, 5, [[2, 2]]), 1);
      const { mobs, rack } = train(world);
      expect([mobs.length, rack.length]).toEqual([0, 0]);
    });

    it("skips floor the spawn cannot walk to", () => {
      // The player's 3x3 room, a wall, and a pocket whose nearest tile is exactly 6 tiles from the spawn.
      const map = hall(16, 9, [[2, 2]], (tx, ty) => (tx <= 3 && ty <= 3) || (tx >= 8 && ty <= 7));
      const pocket = centre(8, 2);
      expect(circleClear(map, pocket, PLAYER_RADIUS)).toBe(true);
      expect(Math.hypot(pocket.x - map.spawns[0]!.x, pocket.y - map.spawns[0]!.y) / TILE).toBe(6);
      expect(findPath(map, map.spawns[0]!, pocket, PLAYER_RADIUS)).toEqual([]);
      const world = startHall(map, 1);
      const { mobs, rack } = train(world);
      expect([mobs.length, rack.length]).toEqual([0, 0]);
    });

    it("lets neighbouring spawns share a hall without sharing a tile, or standing on a spawn", () => {
      const world = startHall(hall(30, 20, [[6, 10], [10, 10]]), 2);
      const { mobs, rack } = train(world);
      expect([mobs.length, rack.length]).toEqual([4, 10]);
      const tiles = [...mobs, ...rack, ...world.map.spawns].map(tileOf);
      expect(new Set(tiles).size).toBe(tiles.length);
    });
  });
});

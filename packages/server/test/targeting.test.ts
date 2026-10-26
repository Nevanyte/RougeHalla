// The target lock (sim/targeting.ts): the `target` order, the chase into range, the auto-attack, the aim, and every way a
// lock ends. Worlds are a hand-built open arena (1280 x 640 u) with the real melee, projectile and ledger phases and no
// faction signatures, so what a test sees is the lock and the weapon state machine it drives. Fighters:
//   players p0 (the one that locks), p1, p2 ...   training dummies (no faction, 5000 hp, never fight back)   regional mobs.
import { describe, expect, it } from "vitest";
import {
  damagePerHit, FACTIONS, leadAim, mapFromTiles, MOB_AIM_DEADBAND, mulberry32, pacedFaction, PLAYER_SPEED, TARGET_LOS_GRACE_MS,
  TARGET_RANGE, TARGET_REPATH_MS, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, WEAPONS, weaponTimings, attackInterval,
  type FactionId, type FxEvent, type GameMap, type Vec2, type WeaponId,
} from "@raid/shared";
import { applyDamage, downPlayer, markDropped } from "../src/sim/arena";
import { combatant, hostile, type Combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { placeMob } from "../src/sim/mobLife";
import { addMob } from "../src/sim/mobs";
import { addPlayer, removePlayer, startRaid, step } from "../src/sim/step";
import { handleTarget } from "../src/sim/targeting";
import { installTraining } from "../src/sim/training";
import { moveMultiplierOf, weaponChanged } from "../src/sim/weapons";
import type { SimEvent, World } from "../src/sim/world";

const W_TILES = 40;
const H_TILES = 20;
const STEP = (PLAYER_SPEED * TICK_MS) / 1000;
const BIG_HP = 1e9;

const log: Array<{ at: number; fx: FxEvent }> = [];

/** A walled 40 x 20 tile room, all floor inside, with `walls` (tile coordinates) as obstacles. */
function arenaMap(walls: ReadonlyArray<readonly [number, number]> = []): GameMap {
  const tiles = new Uint8Array(W_TILES * H_TILES).fill(TILE_FLOOR);
  for (let x = 0; x < W_TILES; x++) { tiles[x] = TILE_WALL; tiles[(H_TILES - 1) * W_TILES + x] = TILE_WALL; }
  for (let y = 0; y < H_TILES; y++) { tiles[y * W_TILES] = TILE_WALL; tiles[y * W_TILES + W_TILES - 1] = TILE_WALL; }
  for (const [x, y] of walls) tiles[y * W_TILES + x] = TILE_WALL;
  return { ...mapFromTiles(W_TILES, H_TILES, tiles), spawns: Array.from({ length: 8 }, (_, i) => ({ x: (3 + i) * TILE + 16, y: 3 * TILE + 16 })) };
}

/** A column of wall tiles at tile column `tx`, rows `y0..y1`. */
const column = (tx: number, y0: number, y1: number): Array<[number, number]> =>
  Array.from({ length: y1 - y0 + 1 }, (_, i) => [tx, y0 + i]);

interface Fighter {
  faction: FactionId;
  weapons: [WeaponId | "", (WeaponId | "")?];
  at: Vec2;
  /** Defaults to BIG_HP, so a fight never ends the run. */
  hp?: number;
}

/** An active run (the first step starts it) of players p0, p1, ... where each test wants them. */
function arena(fighters: Fighter[], map: GameMap = arenaMap()): World {
  log.length = 0;
  const world = createGameWorld({
    seed: 7,
    config: {
      minPlayers: fighters.length, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
      suddenDeathSeconds: 3600,
    },
    random: mulberry32(8),
  }, { signatures: false });
  world.map = map;
  fighters.forEach((f, i) => {
    const p = addPlayer(world, `p${i}`, `player${i}`);
    p.faction = f.faction;
    p.weapon0 = f.weapons[0];
    p.weapon1 = f.weapons[1] ?? "";
    p.slot = 0;
  });
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  fighters.forEach((f, i) => {
    const p = P(world, i);
    p.maxHp = p.hp = f.hp ?? BIG_HP;
    place(world, `p${i}`, f.at);
  });
  return world;
}

const id = (i: number): string => `p${i}`;
const P = (world: World, i = 0) => world.state.players.get(id(i))!;
const RT = (world: World, i = 0) => world.players.get(id(i))!;
const C = (world: World, i = 0): Combatant => combatant(world, id(i))!;
const T = (world: World): number => world.state.serverTime;
const W = (world: World, i = 0) => RT(world, i).weapon;

/** Teleports a fighter (a player id, or a mob id) and forgets where it was, as a placed test fighter has no past. */
function place(world: World, who: string, at: Vec2): void {
  const c = combatant(world, who)!;
  c.s.x = at.x;
  c.s.y = at.y;
  c.rt.path = [];
  c.rt.history = [{ t: T(world), x: at.x, y: at.y }];
}

/** A training dummy (no faction, 5000 hp). */
function dummy(world: World, at: Vec2): string {
  return addMob(world, { kind: "dummy", name: "dummy", at });
}
const M = (world: World, mobId: string) => world.state.mobs.get(mobId)!;

function tick(world: World): SimEvent[] {
  const events = step(world, TICK_MS);
  for (const e of events) if (e.type === "fx") log.push({ at: T(world), fx: e.fx });
  return events;
}
function run(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) tick(world);
}
function runTo(world: World, time: number): void {
  expect(time).toBeGreaterThanOrEqual(T(world));
  while (T(world) < time) tick(world);
}
const fxOf = <K extends FxEvent["kind"]>(kind: K): Array<{ at: number } & Extract<FxEvent, { kind: K }>> =>
  log.filter((e) => e.fx.kind === kind).map((e) => ({ at: e.at, ...e.fx })) as Array<{ at: number } & Extract<FxEvent, { kind: K }>>;

function send(world: World, i: number, type: string, msg: unknown = {}): void {
  expect(enqueueClientMessage(RT(world, i).inputs, type, msg), type).toBe(true);
}
const target = (world: World, who: string, i = 0): void => send(world, i, "target", { id: who });
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const at = (world: World, who: string): Vec2 => { const c = combatant(world, who)!; return { x: c.s.x, y: c.s.y }; };

/** A snapshot of everything a rejected `target` must leave alone. */
function state(world: World, i = 0): string {
  return JSON.stringify({ weapon: W(world, i), path: RT(world, i).path, attackTarget: P(world, i).attackTarget, facing: P(world, i).facing });
}

/** The raw damage of a full hit as fought (duel pace). */
const fullHit = (f: FactionId, w: WeaponId): number => damagePerHit(pacedFaction(FACTIONS[f]), w);
const timings = (f: FactionId, w: WeaponId) => weaponTimings(w, attackInterval(FACTIONS[f], w));

// Positions used throughout: p0 on the left, the foe 100 u to its right, in open floor.
const ME: Vec2 = { x: 300, y: 320 };
const NEAR: Vec2 = { x: 400, y: 320 };

// ----------------------------------------------------------------------------------------------------------------

describe("hostile", () => {
  it("is never a fighter against itself, never mob against mob, and otherwise any two fighters", () => {
    const world = arena([{ faction: "fire", weapons: ["axe"], at: ME }, { faction: "frost", weapons: ["shield"], at: NEAR }]);
    const d1 = combatant(world, dummy(world, { x: 600, y: 320 }))!;
    const d2 = combatant(world, dummy(world, { x: 700, y: 320 }))!;
    expect(hostile(C(world, 0), C(world, 1))).toBe(true);
    expect(hostile(C(world, 0), d1)).toBe(true);
    expect(hostile(d1, C(world, 0))).toBe(true);
    expect(hostile(C(world, 0), C(world, 0))).toBe(false);
    expect(hostile(d1, d1)).toBe(false);
    expect(hostile(d1, d2)).toBe(false); // mobs are allies of each other
  });
});

describe("the target order", () => {
  const duel = (): { world: World; foe: string } => {
    const world = arena([
      { faction: "plague", weapons: ["sword"], at: ME },
      { faction: "frost", weapons: ["shield"], at: NEAR },
    ]);
    return { world, foe: id(1) };
  };

  it("locks a standing enemy in range and sight, mirrors it in attackTarget and lets go of the trigger", () => {
    const { world, foe } = duel();
    send(world, 0, "attack", { a: 1 }); // a trigger pressed before
    tick(world);
    expect(W(world).held).toBe(true);
    target(world, foe);
    tick(world);
    expect(W(world).lock).toBe(foe);
    expect(P(world).attackTarget).toBe(foe);
    expect(W(world).bufferedUntil).toBe(0);
    // The trigger is the lock's now: it holds it exactly while the foe is in range.
    expect(W(world).held).toBe(false);
    expect(P(world, 1).attackTarget).toBe(""); // nobody else's mirror changes
  });

  it("locks a training dummy and a regional mob too", () => {
    const world = arena([{ faction: "plague", weapons: ["sword"], at: ME }]);
    const d = dummy(world, NEAR);
    target(world, d);
    tick(world);
    expect(W(world).lock).toBe(d);
    const mob = placeMob(world, { region: "fire", elite: false, at: { x: 300, y: 420 } });
    world.mobs.get(mob)!.brain!.mode = "idle";
    target(world, mob);
    tick(world);
    expect(W(world).lock).toBe(mob);
    expect(P(world).attackTarget).toBe(mob);
  });

  it("is accepted out to exactly TARGET_RANGE and ignored a unit further", () => {
    expect(TARGET_RANGE).toBe(640);
    const world = arena([{ faction: "plague", weapons: ["sword"], at: { x: 100, y: 320 } }]);
    const far = dummy(world, { x: 100 + TARGET_RANGE + 1, y: 320 });
    const edge = dummy(world, { x: 100 + TARGET_RANGE, y: 320 });
    const before = state(world);
    handleTarget(world, C(world), { kind: "target", id: far });
    expect(state(world)).toBe(before);
    handleTarget(world, C(world), { kind: "target", id: edge });
    expect(W(world).lock).toBe(edge);
  });

  describe("is ignored, with no change at all, when the target", () => {
    /** The order goes straight to the handler: whatever it was told, nothing about the fighter may differ afterwards. */
    function ignored(world: World, who: string, i = 0): void {
      const before = state(world, i);
      handleTarget(world, C(world, i), { kind: "target", id: who });
      expect(state(world, i)).toBe(before);
      expect(W(world, i).lock).toBeNull();
      expect(P(world, i).attackTarget).toBe("");
    }
    /** And through the queue and a tick: the lock is not made either. */
    function ignoredByTick(world: World, who: string): void {
      target(world, who);
      tick(world);
      expect(W(world).lock).toBeNull();
      expect(P(world).attackTarget).toBe("");
    }

    it("is the fighter itself", () => {
      const { world } = duel();
      ignored(world, id(0));
      ignoredByTick(world, id(0));
    });

    it("does not exist", () => {
      const { world } = duel();
      ignored(world, "nobody");
      ignoredByTick(world, "nobody");
    });

    it("is down: a player who died or left, a mob that is dead", () => {
      const { world } = duel();
      P(world, 1).status = "dead";
      ignored(world, id(1));
      ignoredByTick(world, id(1));
      const down = arena([{ faction: "plague", weapons: ["sword"], at: ME }, { faction: "frost", weapons: ["shield"], at: NEAR }]);
      RT(down, 1).down = { outcome: "died" }; // downed this tick, its status not yet changed: not standing
      ignored(down, id(1));
      const corpse = dummy(down, { x: 400, y: 400 });
      M(down, corpse).status = "dead";
      ignored(down, corpse);
    });

    it("is a mob walking home (evading)", () => {
      const world = arena([{ faction: "plague", weapons: ["sword"], at: ME }]);
      const mob = placeMob(world, { region: "fire", elite: false, at: NEAR });
      world.mobs.get(mob)!.brain!.mode = "return";
      ignored(world, mob);
      ignoredByTick(world, mob);
    });

    it("is out of line of sight", () => {
      const world = arena(
        [{ faction: "plague", weapons: ["sword"], at: ME }, { faction: "frost", weapons: ["shield"], at: { x: 500, y: 320 } }],
        arenaMap(column(12, 8, 11)), // x 384..416, between the two
      );
      ignored(world, id(1));
      ignoredByTick(world, id(1));
      const d = dummy(world, { x: 500, y: 330 });
      ignored(world, d);
    });

    it("is farther than TARGET_RANGE", () => {
      const world = arena([{ faction: "plague", weapons: ["sword"], at: { x: 100, y: 320 } }, { faction: "frost", weapons: ["shield"], at: { x: 800, y: 320 } }]);
      ignored(world, id(1));
      ignoredByTick(world, id(1));
    });

    it("is anything at all when the fighter holds no weapon", () => {
      const { world } = duel();
      P(world).weapon0 = "";
      ignored(world, id(1));
    });

    it("is refused for a trigger held before, which it leaves held", () => {
      const { world } = duel();
      send(world, 0, "attack", { a: 0.5 });
      tick(world);
      expect(W(world).held).toBe(true);
      target(world, id(0));
      target(world, "nobody");
      tick(world);
      expect(W(world).held).toBe(true);
      expect(W(world).lock).toBeNull();
    });
  });

  it("is never made by a mob: a mob has no target order, whoever it is aimed at", () => {
    const world = arena([{ faction: "plague", weapons: ["sword"], at: ME }]);
    const a = dummy(world, { x: 600, y: 320 });
    const b = dummy(world, { x: 640, y: 320 });
    const mobC = combatant(world, a)!;
    const before = JSON.stringify(mobC.rt.weapon);
    handleTarget(world, mobC, { kind: "target", id: b }); // mob against mob
    handleTarget(world, mobC, { kind: "target", id: id(0) }); // mob against a player
    expect(JSON.stringify(mobC.rt.weapon)).toBe(before);
    mobC.rt.inputs.pushAction({ kind: "target", id: id(0) });
    run(world, 2);
    expect(mobC.rt.weapon.lock).toBeNull();
    expect(W(world).lock).toBeNull();
  });

  it("the attackTarget mirror is a plain string on players only", () => {
    const world = arena([{ faction: "plague", weapons: ["sword"], at: ME }]);
    expect(P(world).attackTarget).toBe("");
    expect(Object.keys(M(world, dummy(world, NEAR)).toJSON())).not.toContain("attackTarget");
  });
});

// ----------------------------------------------------------------------------------------------------------------

describe("chasing into range", () => {
  it("a sword walks to the foe, stops within its far distance, and swings from then on", () => {
    const world = arena([{ faction: "plague", weapons: ["sword"], at: { x: 200, y: 320 } }]);
    const d = dummy(world, { x: 600, y: 320 });
    const max = M(world, d).maxHp;
    target(world, d);
    const far = 0.85 * 64;
    let firstHit = -1;
    let settled = -1;
    for (let i = 0; i < 80; i++) {
      tick(world);
      if (firstHit < 0 && M(world, d).hp < max) firstHit = i;
      if (settled < 0 && RT(world).path.length === 0) settled = i;
      if (firstHit < 0) expect(dist(P(world), at(world, d)), `tick ${i}`).toBeGreaterThan(far - STEP - 1e-6);
    }
    // 400 u at 8.5 u a tick: about 40 ticks of walking before the first swing can reach (and 2 more to land it).
    expect(settled).toBeGreaterThan(30);
    expect(firstHit).toBeGreaterThan(30);
    expect(dist(P(world), at(world, d))).toBeLessThanOrEqual(far + 1e-6);
    expect(dist(P(world), at(world, d))).toBeGreaterThan(far - STEP);
    expect(W(world).lock).toBe(d);
    expect(M(world, d).hp).toBeLessThan(max);
    expect(fxOf("swing").length).toBeGreaterThan(5);
  });

  it("a bow walks until the foe is within its far distance, draws as soon as it is within range, and shoots", () => {
    const world = arena([{ faction: "sentenced", weapons: ["bow"], at: { x: 200, y: 320 } }]);
    const d = dummy(world, { x: 600, y: 320 });
    const pol = { far: (WEAPONS.bow.shape.kind === "projectile" ? WEAPONS.bow.shape.range : 0) * (400 / 480), attack: (WEAPONS.bow.shape.kind === "projectile" ? WEAPONS.bow.shape.range : 0) * 0.92 };
    expect(pol.far).toBe(200);
    target(world, d);
    let drawAt = -1;
    for (let i = 0; i < 120; i++) {
      tick(world);
      if (drawAt < 0 && P(world).drawStartedAt > 0) drawAt = dist(P(world), at(world, d));
    }
    // The draw began as the foe came within attack range (220.8 u), a step or two before the walk ended at 200 u.
    expect(drawAt).toBeLessThanOrEqual(pol.attack + 1e-6);
    expect(drawAt).toBeGreaterThan(pol.far - 1);
    expect(dist(P(world), at(world, d))).toBeLessThanOrEqual(pol.far + 1e-6);
    expect(RT(world).path).toEqual([]);
    expect(M(world, d).hp).toBeLessThan(M(world, d).maxHp);
  });

  it("a wand does the same at its own distances", () => {
    const world = arena([{ faction: "holy", weapons: ["wand"], at: { x: 200, y: 320 } }]);
    const d = dummy(world, { x: 600, y: 320 });
    target(world, d);
    run(world, 120);
    const range = WEAPONS.wand.shape.kind === "projectile" ? WEAPONS.wand.shape.range : 0;
    expect(dist(P(world), at(world, d))).toBeLessThanOrEqual(range * (280 / 420) + 1e-6);
    expect(M(world, d).hp).toBeLessThan(M(world, d).maxHp);
  });

  it("a foe that is already in range is attacked at once, with no walking", () => {
    const world = arena([{ faction: "plague", weapons: ["sword"], at: ME }]);
    const d = dummy(world, { x: 300 + 50, y: 320 });
    const x0 = P(world).x;
    target(world, d);
    tick(world);
    expect(P(world).x).toBe(x0);
    expect(RT(world).path).toEqual([]);
    expect(fxOf("windup")).toHaveLength(1);
    expect(W(world).held).toBe(true);
  });

  it("follows a moving foe, re-planning no more than every TARGET_REPATH_MS", () => {
    expect(TARGET_REPATH_MS).toBe(250);
    const world = arena([{ faction: "plague", weapons: ["sword"], at: { x: 200, y: 320 } }]);
    const d = dummy(world, { x: 500, y: 320 });
    target(world, d);
    // The foe walks away across the floor; its goal moves every tick, the chase's path is replaced at most every 250 ms.
    M(world, d).weapon0 = "";
    world.mobs.get(d)!.path = [{ x: 500, y: 600 }, { x: 1100, y: 600 }];
    const paths = new Set<unknown>();
    let last: unknown = null;
    let replans = 0;
    for (let i = 0; i < 40; i++) {
      tick(world);
      const p = RT(world).path;
      if (p !== last) { replans++; last = p; }
      paths.add(p);
    }
    expect(replans).toBeGreaterThanOrEqual(3);
    expect(replans).toBeLessThanOrEqual(1 + Math.floor((40 * TICK_MS) / TARGET_REPATH_MS) + 1);
    expect(W(world).lock).toBe(d);
    expect(dist(P(world), at(world, d))).toBeLessThan(260); // it has been gaining
  });

  it("a still foe is planned for once", () => {
    const world = arena([{ faction: "plague", weapons: ["sword"], at: { x: 200, y: 320 } }]);
    const d = dummy(world, { x: 700, y: 320 });
    target(world, d);
    tick(world);
    const first = RT(world).path;
    expect(first.length).toBeGreaterThan(0);
    const same: boolean[] = [];
    for (let i = 0; i < 20; i++) { tick(world); same.push(RT(world).path === first); }
    expect(same.every(Boolean)).toBe(true);
  });

  it("faces the foe, aims at it and ignores the cursor's aim while it walks", () => {
    const world = arena([{ faction: "plague", weapons: ["sword"], at: { x: 200, y: 320 } }]);
    const d = dummy(world, { x: 600, y: 520 });
    target(world, d);
    const bearing = Math.atan2(520 - 320, 600 - 200);
    for (let i = 0; i < 10; i++) {
      send(world, 0, "aim", { a: -2 }); // the cursor points elsewhere
      tick(world);
      expect(W(world).aim).toBeCloseTo(Math.atan2(520 - P(world).y, 600 - P(world).x), 6);
      expect(Math.abs(P(world).facing - bearing)).toBeLessThan(0.05);
    }
  });
});

// ----------------------------------------------------------------------------------------------------------------

describe("orders replace the lock", () => {
  /** A pocket of floor walled in on every side: no path leads into it. */
  const pocket = column(30, 8, 12).concat(column(32, 8, 12), [[31, 8], [31, 12]], [[31, 9], [31, 11]]).filter(([x, y]) => !(x === 31 && y === 10));
  const locked = (map?: GameMap): { world: World; foe: string } => {
    const world = arena([{ faction: "plague", weapons: ["sword"], at: { x: 200, y: 320 } }], map);
    const foe = dummy(world, { x: 700, y: 320 });
    target(world, foe);
    run(world, 3);
    expect(W(world).lock).toBe(foe);
    expect(RT(world).path.length).toBeGreaterThan(0);
    return { world, foe };
  };

  it("a move drops the lock, the trigger and the chase, and walks where it was told", () => {
    const { world } = locked();
    send(world, 0, "move", { x: 200, y: 560 });
    tick(world);
    expect(W(world).lock).toBeNull();
    expect(P(world).attackTarget).toBe("");
    expect(W(world).held).toBe(false);
    const end = RT(world).path.at(-1)!;
    expect(end).toEqual({ x: 200, y: 560 });
    run(world, 40);
    expect(P(world).y).toBeGreaterThan(500);
    expect(fxOf("windup")).toHaveLength(0);
  });

  it("a move to a point that cannot be reached still drops the lock, and the fighter stands", () => {
    const { world } = locked(arenaMap(pocket));
    send(world, 0, "move", { x: 31 * TILE + 16, y: 10 * TILE + 16 }); // inside the walled pocket
    tick(world);
    expect(W(world).lock).toBeNull();
    expect(P(world).attackTarget).toBe("");
    expect(RT(world).path).toEqual([]);
    const x = P(world).x;
    run(world, 5);
    expect(P(world).x).toBe(x);
  });

  it("a stop drops the lock and the path: the fighter stops where it is", () => {
    const { world } = locked();
    send(world, 0, "stop");
    tick(world);
    expect(W(world).lock).toBeNull();
    expect(P(world).attackTarget).toBe("");
    expect(RT(world).path).toEqual([]);
    const x = P(world).x;
    run(world, 10);
    expect(P(world).x).toBe(x);
    expect(fxOf("windup")).toHaveLength(0);
  });

  it("a directional attack drops the lock, and the swing goes where the press aims", () => {
    const { world } = locked();
    send(world, 0, "attack", { a: Math.PI });
    tick(world);
    expect(W(world).lock).toBeNull();
    expect(P(world).attackTarget).toBe("");
    expect(W(world).held).toBe(true); // the press is the player's own
    expect(fxOf("windup")).toMatchObject([{ by: id(0), weapon: "sword", a: expect.closeTo(Math.PI, 12) }]);
    expect(RT(world).path).toEqual([]); // and the chase is over
  });

  it("a swap and a pickup that replaces the weapon do not drop it, and the new weapon plays the chase from then on", () => {
    const world = arena([{ faction: "plague", weapons: ["sword", "bow"], at: ME }]);
    const d = dummy(world, { x: 700, y: 320 });
    target(world, d);
    tick(world);
    send(world, 0, "swap");
    tick(world);
    expect(P(world).slot).toBe(1);
    expect(W(world).lock).toBe(d);
    expect(P(world).attackTarget).toBe(d);
    weaponChanged(world, C(world)); // what a pickup that replaced the weapon in hand does
    tick(world);
    expect(W(world).lock).toBe(d);
    // The bow's far distance is 200 u: the chase now stops there, not at a sword's 54.
    run(world, 120);
    expect(dist(P(world), at(world, d))).toBeLessThanOrEqual(200 + 1e-6);
    expect(dist(P(world), at(world, d))).toBeGreaterThan(150);
  });

  it("a release does not drop it", () => {
    const { world, foe } = locked();
    send(world, 0, "release", { a: 0 });
    tick(world);
    expect(W(world).lock).toBe(foe);
  });
});

describe("orders in one tick apply in the order they arrived", () => {
  const setup = (): { world: World; foe: string; other: string } => {
    const world = arena([{ faction: "plague", weapons: ["sword"], at: { x: 200, y: 320 } }]);
    return { world, foe: dummy(world, { x: 700, y: 320 }), other: dummy(world, { x: 700, y: 420 }) };
  };

  it("a target and then a move: the move wins, unlocked", () => {
    const { world, foe } = setup();
    target(world, foe);
    send(world, 0, "move", { x: 200, y: 560 });
    tick(world);
    expect(W(world).lock).toBeNull();
    expect(P(world).attackTarget).toBe("");
    expect(RT(world).path.at(-1)).toEqual({ x: 200, y: 560 });
  });

  it("a move and then a target: the target wins, locked", () => {
    const { world, foe } = setup();
    send(world, 0, "move", { x: 200, y: 560 });
    target(world, foe);
    tick(world);
    expect(W(world).lock).toBe(foe);
    expect(P(world).attackTarget).toBe(foe);
    // The lock's chase replaced the move's path: it heads for the foe, not for (200, 560).
    expect(RT(world).path.at(-1)!.x).toBeGreaterThan(600);
  });

  it("a target, a move and a target: locked on the last", () => {
    const { world, foe, other } = setup();
    target(world, foe);
    send(world, 0, "move", { x: 200, y: 560 });
    target(world, other);
    tick(world);
    expect(W(world).lock).toBe(other);
  });

  it("a stop and then a target locks; a target and then a stop does not", () => {
    const a = setup();
    send(a.world, 0, "stop");
    target(a.world, a.foe);
    tick(a.world);
    expect(W(a.world).lock).toBe(a.foe);
    const b = setup();
    target(b.world, b.foe);
    send(b.world, 0, "stop");
    tick(b.world);
    expect(W(b.world).lock).toBeNull();
  });

  it("an attack and then a target locks and lets go of the trigger; a target and then an attack ends unlocked, trigger held", () => {
    const a = setup();
    send(a.world, 0, "attack", { a: 1 });
    target(a.world, a.foe);
    tick(a.world);
    expect(W(a.world).lock).toBe(a.foe);
    expect(W(a.world).held).toBe(false);
    const b = setup();
    target(b.world, b.foe);
    send(b.world, 0, "attack", { a: 1 });
    tick(b.world);
    expect(W(b.world).lock).toBeNull();
    expect(W(b.world).held).toBe(true);
  });

  it("an aim sent after a move that ended the lock counts; one sent while it held does not", () => {
    const { world, foe } = setup();
    target(world, foe);
    tick(world);
    send(world, 0, "aim", { a: -1 });
    tick(world);
    expect(Math.abs(P(world).facing - -1)).toBeGreaterThan(0.5); // ignored while locked
    send(world, 0, "move", { x: 200, y: 560 });
    send(world, 0, "aim", { a: -1 });
    tick(world);
    expect(P(world).facing).toBeCloseTo(-1, 12);
  });
});

// ----------------------------------------------------------------------------------------------------------------

describe("how a lock ends", () => {
  const chasing = (): { world: World; foe: string } => {
    const world = arena([
      { faction: "plague", weapons: ["sword"], at: { x: 200, y: 320 } },
      { faction: "frost", weapons: ["shield"], at: { x: 600, y: 320 } },
      { faction: "frost", weapons: ["shield"], at: { x: 1200, y: 100 } },
    ]);
    target(world, id(1));
    run(world, 3);
    expect(W(world).lock).toBe(id(1));
    return { world, foe: id(1) };
  };
  const ended = (world: World): void => {
    expect(W(world).lock).toBeNull();
    expect(P(world).attackTarget).toBe("");
    expect(W(world).held).toBe(false);
    expect(RT(world).path).toEqual([]);
  };

  it("when the target dies: the player stops where it stands", () => {
    const { world, foe } = chasing();
    applyDamage(world, P(world, 1), RT(world, 1), P(world, 1).hp + 1000, "test");
    expect(P(world, 1).status).toBe("dead");
    tick(world);
    ended(world);
    const x = P(world).x;
    run(world, 5);
    expect(P(world).x).toBe(x);
    expect(foe).toBe(id(1));
  });

  it("when the target is a mob and it dies", () => {
    const world = arena([{ faction: "plague", weapons: ["sword"], at: ME }]);
    const d = dummy(world, { x: 700, y: 320 });
    target(world, d);
    run(world, 2);
    M(world, d).status = "dead";
    tick(world);
    ended(world);
  });

  it("when the target leaves the run", () => {
    const { world } = chasing();
    removePlayer(world, id(1));
    tick(world);
    ended(world);
  });

  it("when the target begins to evade", () => {
    const world = arena([{ faction: "plague", weapons: ["sword"], at: ME }]);
    const mob = placeMob(world, { region: "fire", elite: false, at: { x: 700, y: 320 } });
    world.mobs.get(mob)!.weapon.held = false;
    M(world, mob).weapon0 = "";
    target(world, mob);
    run(world, 2);
    expect(W(world).lock).toBe(mob);
    world.mobs.get(mob)!.brain!.mode = "return";
    tick(world);
    ended(world);
  });

  it("when the target gets farther than TARGET_RANGE, and not before", () => {
    const { world } = chasing();
    place(world, id(1), { x: P(world).x + TARGET_RANGE - 1, y: 320 });
    tick(world);
    expect(W(world).lock).toBe(id(1));
    place(world, id(1), { x: P(world).x + TARGET_RANGE + 2 * STEP, y: 320 });
    tick(world);
    ended(world);
  });

  it("when the fighter holds no weapon any more", () => {
    const { world } = chasing();
    P(world).weapon0 = "";
    tick(world);
    ended(world);
  });

  it("when the fighter goes down, or its connection drops", () => {
    const { world } = chasing();
    markDropped(world, id(0));
    ended(world);
    const b = chasing();
    downPlayer(b.world, P(b.world), RT(b.world), "died");
    expect(W(b.world).lock).toBeNull();
    expect(P(b.world).attackTarget).toBe("");
    const c = chasing();
    downPlayer(c.world, P(c.world), RT(c.world), "mia");
    expect(W(c.world).lock).toBeNull();
    expect(P(c.world).attackTarget).toBe("");
  });

  it("on the teleport into the coliseum", () => {
    const { world } = chasing();
    world.hooks.teleported!(world);
    ended(world);
    expect(W(world).action).toBeNull();
    run(world, 10);
    expect(W(world).lock).toBeNull();
  });

  describe("line of sight", () => {
    // A wall across the floor at tile column 20 (x 640..672), rows 1..16, with a gap at the bottom (rows 17, 18): to reach
    // the other side the chaser walks down to the gap and back, far longer than the grace.
    const walled = (): { world: World; foe: string } => {
      const world = arena(
        [{ faction: "plague", weapons: ["sword"], at: { x: 560, y: 100 } }, { faction: "frost", weapons: ["shield"], at: { x: 620, y: 100 } }],
        arenaMap(column(20, 1, 16)),
      );
      target(world, id(1));
      tick(world);
      expect(W(world).lock).toBe(id(1));
      return { world, foe: id(1) };
    };
    const behindWall: Vec2 = { x: 740, y: 100 };

    it("is kept for TARGET_LOS_GRACE_MS after the target steps out of sight, with the chase walking around the wall", () => {
      expect(TARGET_LOS_GRACE_MS).toBe(1500);
      const { world, foe } = walled();
      place(world, foe, behindWall);
      const lostAt = T(world) + TICK_MS;
      runTo(world, lostAt + TARGET_LOS_GRACE_MS - 2 * TICK_MS);
      expect(W(world).lock).toBe(foe);
      expect(W(world).lockLosLostAt).toBe(lostAt);
      expect(P(world).y).toBeGreaterThan(100); // heading down, around the wall
      expect(RT(world).path.length).toBeGreaterThan(0);
    });

    it("is dropped once it has lasted that long", () => {
      const { world, foe } = walled();
      place(world, foe, behindWall);
      const lostAt = T(world) + TICK_MS;
      runTo(world, lostAt + TARGET_LOS_GRACE_MS + TICK_MS);
      expect(W(world).lock).toBeNull();
      expect(P(world).attackTarget).toBe("");
      expect(RT(world).path).toEqual([]);
    });

    it("starts over when the target is seen again", () => {
      const { world, foe } = walled();
      place(world, foe, behindWall);
      run(world, 20); // 1 s out of sight
      expect(W(world).lock).toBe(foe);
      place(world, foe, { x: P(world).x - 40, y: P(world).y }); // back in view
      tick(world);
      expect(W(world).lockLosLostAt).toBe(0);
      place(world, foe, behindWall);
      run(world, 20); // another second, not a second and a half in all
      expect(W(world).lock).toBe(foe);
    });
  });
});

// ----------------------------------------------------------------------------------------------------------------

describe("the windup root under a lock", () => {
  // A foe just inside attackRange but outside far: the lock holds the trigger AND keeps walking (decide says both), so the
  // attack starts with a path in hand. The fighter must not move until the attack lands or the projectile leaves.
  const cases: Array<[string, FactionId, WeaponId, number]> = [
    ["sword", "plague", "sword", 66],
    ["wand", "holy", "wand", 170],
    ["bow", "sentenced", "bow", 215],
  ];

  it.each(cases)("%s: no step while the swing, the cast or the draw winds up, and it walks again once it ends", (_n, faction, weapon, gap) => {
    const world = arena([{ faction, weapons: [weapon], at: ME }]);
    const d = dummy(world, { x: ME.x + gap, y: 320 });
    const tm = timings(faction, weapon);
    target(world, d);
    const xs: number[] = [P(world).x];
    const rooted: number[] = [];
    const paths: number[] = [];
    for (let i = 0; i < 24; i++) {
      tick(world);
      xs.push(P(world).x);
      rooted.push(moveMultiplierOf(world, C(world)));
      paths.push(RT(world).path.length);
    }
    const startedAt = fxOf("windup")[0]?.at ?? P(world).readyAt; // the bow has no windup fx: it draws from tick 1 here
    void startedAt;
    const windupTicks = Math.ceil((tm.windup * 1000) / TICK_MS - 1e-6);
    // The attack began in the first tick (the foe is in range): that tick and the ones until it lands are rooted, with the
    // path still there.
    for (let k = 0; k < windupTicks; k++) {
      expect(rooted[k], `tick ${k}`).toBe(0);
      expect(xs[k + 1], `tick ${k}`).toBe(xs[0]);
      expect(paths[k], `tick ${k}`).toBeGreaterThan(0);
    }
    // And it walks as soon as the attack has landed or the projectile has left (until the far distance, a step or two on).
    expect(rooted[windupTicks]).toBe(1);
    expect(xs[windupTicks + 1]).toBeGreaterThan(xs[0]!);
  });
});

describe("when damage lands", () => {
  it("a sword hits in the tick its windup ends: the first tick of a 100 ms windup does nothing, the third lands", () => {
    const world = arena([{ faction: "plague", weapons: ["sword"], at: ME }]);
    const d = dummy(world, { x: 366, y: 320 }); // 66 u: inside attackRange (70), so the swing starts at once
    const full = M(world, d).maxHp;
    target(world, d);
    tick(world); // the swing starts
    const start = T(world);
    expect(fxOf("windup")).toMatchObject([{ at: start, weapon: "sword", ms: 100 }]);
    expect(M(world, d).hp).toBe(full);
    tick(world);
    expect(M(world, d).hp).toBe(full); // a tick before the end: nothing yet
    tick(world);
    expect(T(world)).toBe(start + 100);
    expect(M(world, d).hp).toBeLessThan(full);
    expect(full - M(world, d).hp).toBeCloseTo(fullHit("plague", "sword"), 6);
  });

  it("a wand ball leaves in the tick its cast ends, from where the caster stands, along the aim at the foe", () => {
    const world = arena([{ faction: "holy", weapons: ["wand"], at: ME }]);
    const d = dummy(world, { x: 470, y: 320 });
    target(world, d);
    tick(world);
    const start = T(world);
    expect(world.projectiles.size).toBe(0);
    runTo(world, start + 150);
    expect(world.projectiles.size).toBe(0);
    tick(world);
    expect(world.projectiles.size).toBe(1);
    const ball = [...world.projectiles.values()][0]!;
    expect(ball.launch.t).toBe(start + 200);
    expect([ball.launch.x, ball.launch.y]).toEqual([ME.x, ME.y]);
    expect(Math.atan2(ball.launch.vy, ball.launch.vx)).toBeCloseTo(0, 6);
    expect(M(world, d).hp).toBe(M(world, d).maxHp); // it has not arrived
  });

  it("a bow looses in the tick its draw ends, for full damage, however it was held", () => {
    const world = arena([{ faction: "sentenced", weapons: ["bow"], at: ME }]);
    const d = dummy(world, { x: 515, y: 320 });
    const tm = timings("sentenced", "bow");
    target(world, d);
    tick(world);
    const start = T(world);
    expect(P(world).drawStartedAt).toBe(start);
    runTo(world, start + 350);
    expect(world.projectiles.size).toBe(0);
    tick(world);
    expect(world.projectiles.size).toBe(1);
    const arrow = [...world.projectiles.values()][0]!;
    expect(arrow.launch.t).toBe(start + Math.ceil((tm.windup * 1000) / TICK_MS) * TICK_MS);
    expect(arrow.packet.raw).toBeCloseTo(fullHit("sentenced", "bow"), 9);
    // Every arrow of the fight is a full-damage one.
    const raws = new Set<string>();
    for (let i = 0; i < 100; i++) {
      tick(world);
      for (const pr of world.projectiles.values()) raws.add(pr.packet.raw.toFixed(6));
    }
    expect(raws.size).toBe(1);
    expect(M(world, d).hp).toBeLessThan(M(world, d).maxHp);
  });

  it("keeps attacking at the weapon's interval while the foe stays in range", () => {
    const world = arena([{ faction: "plague", weapons: ["sword"], at: ME }]);
    const d = dummy(world, { x: 350, y: 320 });
    target(world, d);
    run(world, 40); // 2 s
    const starts = fxOf("windup").map((w) => w.at);
    const interval = timings("plague", "sword").interval * 1000;
    expect(starts.length).toBeGreaterThanOrEqual(7);
    const span = (starts.at(-1)! - starts[0]!) / (starts.length - 1);
    expect(Math.abs(span - interval)).toBeLessThan(TICK_MS / 2);
  });
});

describe("a locked attack is aimed again as it lands", () => {
  it("a swing goes at the foe's position when it lands, not where it was when the swing began", () => {
    const world = arena([{ faction: "plague", weapons: ["sword"], at: ME }]);
    const d = dummy(world, { x: 366, y: 320 });
    const full = M(world, d).maxHp;
    target(world, d);
    tick(world); // the swing starts, aimed along +x
    expect(fxOf("windup")[0]!.a).toBeCloseTo(0, 6);
    // The foe steps to the caster's south side (a quarter turn off the swing's arc, but inside its reach) during the windup.
    place(world, d, { x: ME.x, y: ME.y + 46 });
    run(world, 2);
    expect(M(world, d).hp).toBeLessThan(full);
    expect(fxOf("swing")[0]!.a).toBeCloseTo(Math.PI / 2, 6);
    expect(M(world, d).hp).toBeLessThan(full);
  });

  it("the same swing without a lock goes where it was aimed", () => {
    const world = arena([{ faction: "plague", weapons: ["sword"], at: ME }]);
    const d = dummy(world, { x: 366, y: 320 });
    const full = M(world, d).maxHp;
    send(world, 0, "attack", { a: 0 });
    send(world, 0, "release", { a: 0 });
    tick(world);
    place(world, d, { x: ME.x, y: ME.y + 46 });
    run(world, 2);
    expect(M(world, d).hp).toBe(full);
    expect(fxOf("swing")[0]!.a).toBeCloseTo(0, 6);
  });

  it("a ball is led at where the foe is now, with its velocity", () => {
    const world = arena([{ faction: "holy", weapons: ["wand"], at: ME }]);
    const d = dummy(world, { x: 470, y: 320 });
    target(world, d);
    tick(world); // the cast starts, aimed along +x
    // The foe walks south at full speed during the cast.
    world.mobs.get(d)!.path = [{ x: 470, y: 600 }];
    runTo(world, T(world) + 150);
    expect(world.projectiles.size).toBe(0);
    const foe = at(world, d);
    const vel = { x: 0, y: PLAYER_SPEED };
    tick(world);
    const ball = [...world.projectiles.values()][0]!;
    const now = at(world, d);
    const aimed = Math.atan2(ball.launch.vy, ball.launch.vx);
    const shape = WEAPONS.wand.shape;
    expect(shape.kind).toBe("projectile");
    const speed = shape.kind === "projectile" ? shape.speed : 0;
    // From the origin it was drawn at, at the foe's present position (it has just moved on one more step), led by its velocity.
    expect(aimed).toBeGreaterThan(0.05);
    expect(aimed).toBeGreaterThan(Math.atan2(foe.y - ME.y, foe.x - ME.x));
    const expected = leadAim({ x: ME.x, y: ME.y }, { x: now.x, y: now.y - STEP }, vel, speed);
    expect(Math.abs(aimed - expected)).toBeLessThan(0.02);
  });

  it("an arrow goes at the foe's present position when the draw ends", () => {
    const world = arena([{ faction: "sentenced", weapons: ["bow"], at: ME }]);
    const d = dummy(world, { x: 515, y: 320 });
    target(world, d);
    tick(world);
    place(world, d, { x: 470, y: 420 });
    runTo(world, T(world) + 450);
    const arrow = [...world.projectiles.values()][0] ?? null;
    expect(arrow).not.toBeNull();
    const a = Math.atan2(arrow!.launch.vy, arrow!.launch.vx);
    expect(a).toBeCloseTo(Math.atan2(420 - ME.y, 470 - ME.x), 6);
    // The foe is still there and the shot meets it.
    run(world, 5);
    expect(M(world, d).hp).toBeLessThan(M(world, d).maxHp);
  });

  it("goes where it was aimed at the start when the foe is no longer standing", () => {
    const world = arena([
      { faction: "holy", weapons: ["wand"], at: ME },
      { faction: "frost", weapons: ["shield"], at: { x: 470, y: 320 } },
      { faction: "frost", weapons: ["shield"], at: { x: 1200, y: 100 } },
    ]);
    target(world, id(1));
    tick(world);
    place(world, id(1), { x: 470, y: 420 });
    applyDamage(world, P(world, 1), RT(world, 1), P(world, 1).hp + 1000, "test");
    expect(P(world, 1).status).toBe("dead");
    runTo(world, T(world) + 200);
    const ball = [...world.projectiles.values()].find((p) => p.owner === id(0))!;
    expect(ball).toBeDefined();
    expect(Math.atan2(ball.launch.vy, ball.launch.vx)).toBeCloseTo(0, 6);
  });

  it("a locked attack is timed like an input with no timestamp: one tick of rewind, whatever the last press said", () => {
    const world = arena([{ faction: "plague", weapons: ["sword"], at: ME }]);
    const d = dummy(world, { x: 366, y: 320 });
    send(world, 0, "attack", { a: 0, t: T(world) + TICK_MS - 250 });
    send(world, 0, "release", { a: 0, t: T(world) + TICK_MS - 250 });
    tick(world);
    expect(W(world).lagMs).toBe(250);
    target(world, d);
    tick(world);
    expect(W(world).lagMs).toBe(TICK_MS);
  });
});

// ----------------------------------------------------------------------------------------------------------------

describe("the shield faces the locked target", () => {
  const rig = (): { world: World; foe: string } => {
    const world = arena([{ faction: "frost", weapons: ["shield"], at: ME }]);
    return { world, foe: dummy(world, { x: ME.x, y: ME.y + 120 }) };
  };

  it("while locked it faces the foe and the cursor is ignored; once unlocked the cursor turns it", () => {
    const { world, foe } = rig();
    target(world, foe);
    for (let i = 0; i < 6; i++) {
      send(world, 0, "aim", { a: 0 }); // the cursor points east, the foe is south
      tick(world);
    }
    expect(P(world).facing).toBeCloseTo(Math.PI / 2, 2);
    expect(W(world).aim).toBeCloseTo(Math.PI / 2, 2);
    send(world, 0, "stop");
    send(world, 0, "aim", { a: 0 });
    tick(world);
    expect(W(world).lock).toBeNull();
    expect(P(world).facing).toBeCloseTo(0, 12);
  });

  it("follows the foe around, writing the synced facing only past MOB_AIM_DEADBAND", () => {
    const world = arena([{ faction: "frost", weapons: ["shield"], at: ME }]);
    const foe = dummy(world, { x: ME.x, y: ME.y + 280 });
    target(world, foe);
    run(world, 3);
    const first = P(world).facing;
    expect(first).toBeCloseTo(Math.PI / 2, 2);
    const x0 = P(world).x;
    // A shift of well under the deadband (3 u sideways at 250 u is 0.7 degrees) leaves the synced facing alone...
    place(world, foe, { x: x0 + 3, y: at(world, foe).y });
    tick(world);
    expect(P(world).facing).toBe(first);
    expect(Math.abs(W(world).aim - first)).toBeGreaterThan(0.001); // ...though the aim itself is exact
    expect(Math.abs(W(world).aim - first)).toBeLessThan(MOB_AIM_DEADBAND);
    // ... and a bigger one turns it.
    place(world, foe, { x: x0 + 60, y: at(world, foe).y });
    tick(world);
    expect(P(world).facing).not.toBe(first);
    expect(Math.abs(P(world).facing - W(world).aim)).toBeLessThan(MOB_AIM_DEADBAND);
    expect(P(world).facing).toBeLessThan(Math.PI / 2);
  });
});

// ----------------------------------------------------------------------------------------------------------------

describe("training", () => {
  const BASE = { minPlayers: 8, lobbySeconds: 120, fillSeconds: 0, patienceSeconds: 2, patienceMinSeconds: 2, suddenDeathSeconds: 2 };

  function trainingWorld(): World {
    const world = createGameWorld({ seed: 1234, config: { ...BASE, dummies: true, training: true }, random: mulberry32(1235) });
    installTraining(world);
    addPlayer(world, "p0", "alice", { faction: "plague" });
    startRaid(world);
    return world;
  }

  it("locks a dummy and attacks it", () => {
    const world = trainingWorld();
    world.state.players.get("p0")!.weapon0 = "sword";
    const dummies = [...world.state.mobs].filter(([, m]) => m.kind === "dummy").map(([mid]) => mid);
    expect(dummies.length).toBeGreaterThan(0);
    // Whichever dummy the map lets it see (the training setup puts them a few tiles from the spawn).
    for (const mid of dummies) {
      target(world, mid);
      tick(world);
      if (W(world).lock === mid) break;
    }
    expect(W(world).lock).not.toBeNull();
    expect(P(world).attackTarget).toBe(W(world).lock);
    const mob = world.state.mobs.get(W(world).lock!)!;
    run(world, 140);
    expect(mob.hp).toBeLessThan(mob.maxHp); // it walked up to the dummy and is hitting it
    expect(world.state.phase).toBe("active");
  });

  it("a revived player loses its lock (and its mirror)", () => {
    const world = trainingWorld();
    const p = world.state.players.get("p0")!;
    const rt = world.players.get("p0")!;
    const dummies = [...world.state.mobs].filter(([, m]) => m.kind === "dummy").map(([mid]) => mid);
    for (const mid of dummies) {
      target(world, mid);
      tick(world);
      if (rt.weapon.lock === mid) break;
    }
    expect(rt.weapon.lock).not.toBeNull();
    expect(p.attackTarget).not.toBe("");
    applyDamage(world, p, rt, p.hp + 1000, "test");
    expect(rt.weapon.lock).toBeNull(); // going down lets go of it at once
    expect(p.attackTarget).toBe("");
    tick(world); // and the next tick revives the player in place
    expect(p.status).toBe("alive");
    expect(rt.weapon.lock).toBeNull();
    expect(p.attackTarget).toBe("");
    expect(rt.weapon.held).toBe(false);
  });
});

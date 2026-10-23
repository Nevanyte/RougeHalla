import { describe, expect, it } from "vitest";
import {
  FISTS, generateMap, isWallTile, ITEMS, mapFromTiles, MAX_REWIND_MS, mulberry32, PLAYER_RADIUS, TICK_MS, TILE, TILE_FLOOR,
  TILE_WALL, type ArmorDef, type FxEvent, type GameMap, type ItemDTO, type WeaponDef,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import {
  damageAgainst, handleAttack, install, MELEE_SLACK, projectOnRay, RANGED_SLACK,
} from "../src/sim/combat";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage, InputQueue } from "../src/sim/inputs";
import { handleTake } from "../src/sim/loot";
import { actionOrder, addPlayer, step } from "../src/sim/step";
import { createWorld, type SimConfig, type SimEvent, type World } from "../src/sim/world";

type EventOf<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;
type Fx<K extends FxEvent["kind"]> = Extract<FxEvent, { kind: K }>;

const WEAPONS = { fists: FISTS, knife: ITEMS.knife as WeaponDef, pistol: ITEMS.pistol as WeaponDef, rifle: ITEMS.rifle as WeaponDef };
const VEST = ITEMS.vest as ArmorDef;
const PLATE = ITEMS.plate as ArmorDef;

const gear = (...defs: string[]): ItemDTO[] => defs.map((def, i) => ({ uid: `${def}#${i}`, def }));

interface Seat { id: string; name: string; items: ItemDTO[] }
const alice = (items: ItemDTO[] = []): Seat => ({ id: "a", name: "alice", items });
const bob = (items: ItemDTO[] = []): Seat => ({ id: "b", name: "bob", items });
const carol = (items: ItemDTO[] = []): Seat => ({ id: "c", name: "carol", items });

/** Open floor inside a wall border, so geometry in the tests is exactly what the test says it is. */
function arena(walls: Array<{ tx: number; ty0: number; ty1: number }> = []): GameMap {
  const w = 64;
  const h = 64;
  const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
  for (let i = 0; i < w; i++) { tiles[i] = TILE_WALL; tiles[(h - 1) * w + i] = TILE_WALL; }
  for (let j = 0; j < h; j++) { tiles[j * w] = TILE_WALL; tiles[j * w + w - 1] = TILE_WALL; }
  for (const wall of walls) for (let ty = wall.ty0; ty <= wall.ty1; ty++) tiles[ty * w + wall.tx] = TILE_WALL;
  return { ...mapFromTiles(w, h, tiles, 1), spawns: [{ x: 3 * TILE + 16, y: 3 * TILE + 16 }] };
}

/** A wall one tile thick covering x in [320, 352), y in [160, 672). */
const WALL_X = 10 * TILE;
const walledArena = (): GameMap => arena([{ tx: 10, ty0: 5, ty1: 20 }]);

/** Players start the raid on the first step (minPlayers = seat count). Positions are set by each test via `place`. */
function raid(seats: Seat[], map: GameMap | "generated" = arena(), seed = 1234): World {
  let n = 0;
  const config: SimConfig = {
    minPlayers: seats.length, lobbySeconds: 15, fillSeconds: 0, raidSeconds: 360, extractSeconds: 5,
  };
  const world = createGameWorld({ seed, config, random: mulberry32(seed + 1), newItemUid: () => `L${++n}` });
  if (map !== "generated") world.map = map;
  for (const s of seats) addPlayer(world, s.id, s.name, s.items);
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  return world;
}

const P = (world: World, id: string): PlayerState => world.state.players.get(id)!;
const RT = (world: World, id: string) => world.players.get(id)!;

/** Puts a player at an exact spot with no recorded past, so rewinding finds only the present. */
function place(world: World, id: string, x: number, y: number): void {
  const p = P(world, id);
  p.x = x;
  p.y = y;
  RT(world, id).history = [];
}

function run(world: World, ticks: number): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) all.push(...step(world, TICK_MS));
  return all;
}

/** The server time an action enqueued now will be handled at. */
const handlerNow = (world: World): number => world.state.serverTime + TICK_MS;

/** Queues an attack from `id` toward (x, y) and runs one step. */
function swing(world: World, id: string, x: number, y: number, t?: number): SimEvent[] {
  const msg: Record<string, number> = { x, y };
  if (t !== undefined) msg.t = t;
  expect(enqueueClientMessage(RT(world, id).inputs, "attack", msg)).toBe(true);
  return step(world, TICK_MS);
}

function ofType<T extends SimEvent["type"]>(events: SimEvent[], type: T): Array<EventOf<T>> {
  return events.filter((e): e is EventOf<T> => e.type === type);
}

function fxOf<K extends FxEvent["kind"]>(events: SimEvent[], kind: K): Array<Fx<K>> {
  return ofType(events, "fx").map((e) => e.fx).filter((fx): fx is Fx<K> => fx.kind === kind);
}

/** The single shot fx of a step (every non-ignored attack makes exactly one). */
function shotOf(events: SimEvent[]): Fx<"shot"> {
  const shots = fxOf(events, "shot");
  expect(shots).toHaveLength(1);
  return shots[0]!;
}

const dto = (items: Iterable<{ uid: string; def: string }>): ItemDTO[] =>
  Array.from(items, (i) => ({ uid: i.uid, def: i.def }));

/** hp lost by `id` since it had `before` hp. */
const lost = (world: World, id: string, before = 100): number => before - P(world, id).hp;

describe("damageAgainst / projectOnRay", () => {
  it("scales by the armor reduction and rounds to the nearest point", () => {
    expect(damageAgainst(WEAPONS.rifle, null)).toBe(28);
    expect(damageAgainst(WEAPONS.knife, VEST)).toBe(17); // 16.5 rounds up
    expect(damageAgainst(WEAPONS.fists, PLATE)).toBe(4); // 4.4 rounds down
    expect(damageAgainst(WEAPONS.pistol, PLATE)).toBe(9); // 8.8 rounds up
  });

  it("always deals at least 1, however good the armor", () => {
    const wall: ArmorDef = { ...VEST, reduction: 0.99 };
    expect(damageAgainst(WEAPONS.fists, wall)).toBe(1); // 0.08 would round to 0
    expect(damageAgainst(WEAPONS.fists, { ...VEST, reduction: 1 })).toBe(1);
  });

  it("measures distance along the ray and off it", () => {
    expect(projectOnRay(10, 10, 1, 0, 40, 10)).toEqual({ s: 30, perp: 0 });
    expect(projectOnRay(10, 10, 1, 0, 40, 4)).toEqual({ s: 30, perp: 6 });
    expect(projectOnRay(10, 10, 0, 1, 7, 50)).toEqual({ s: 40, perp: 3 });
    expect(projectOnRay(10, 10, 1, 0, 0, 10).s).toBe(-10); // behind the shooter
  });
});

describe("install", () => {
  it("is part of createGameWorld, next to the loot actions", () => {
    const world = raid([alice()]);
    expect(world.actions.attack).toBe(handleAttack);
    expect(world.actions.take).toBe(handleTake);
  });

  it("registers only the attack action on a bare world", () => {
    const bare = createWorld({
      seed: 1234, config: { minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, raidSeconds: 360, extractSeconds: 5 },
      random: mulberry32(9),
    });
    const dropBody = bare.hooks.dropBody;
    install(bare);
    expect(Object.keys(bare.actions)).toEqual(["attack"]);
    expect(bare.systems).toEqual([]);
    expect(bare.hooks.dropBody).toBe(dropBody);
  });

  it("ignores other action kinds when called directly", () => {
    const world = raid([alice(), bob()]);
    place(world, "a", 200, 400);
    place(world, "b", 220, 400);
    handleAttack(world, P(world, "a"), RT(world, "a"), { kind: "extract" });
    expect(world.events).toEqual([]);
    expect(P(world, "b").hp).toBe(100);
    expect(RT(world, "a").nextAttackAt).toBe(0);
  });
});

describe("attack input parsing of t", () => {
  const attackWith = (extra: Record<string, unknown>) => {
    const q = new InputQueue();
    expect(enqueueClientMessage(q, "attack", { x: 10, y: 20, ...extra })).toBe(true);
    return q.drain().actions;
  };

  it("keeps a finite t", () => {
    expect(attackWith({ t: 1234.5 })).toEqual([{ kind: "attack", x: 10, y: 20, t: 1234.5 }]);
    expect(attackWith({ t: -5 })).toEqual([{ kind: "attack", x: 10, y: 20, t: -5 }]); // combat clamps it
    expect(attackWith({ t: 0 })).toEqual([{ kind: "attack", x: 10, y: 20, t: 0 }]);
  });

  it("omits a missing or malformed t but still queues the attack", () => {
    for (const t of [undefined, NaN, Infinity, -Infinity, "300", null, true, {}, [1]]) {
      const [cmd] = attackWith({ t });
      expect(cmd, String(t)).toEqual({ kind: "attack", x: 10, y: 20 });
      expect("t" in cmd!, `t=${String(t)} must be omitted, not undefined`).toBe(false);
    }
    const q = new InputQueue();
    expect(enqueueClientMessage(q, "attack", { x: 10, y: 20 })).toBe(true);
    expect("t" in q.actions[0]!).toBe(false);
  });

  it("still clamps and validates the target point", () => {
    const q = new InputQueue();
    expect(enqueueClientMessage(q, "attack", { x: NaN, y: 5, t: 10 })).toBe(false);
    expect(q.actions).toEqual([]);
  });

  it("treats a non-finite t as 'now' when the handler is called directly", () => {
    const world = raid([alice(gear("rifle")), bob()]);
    place(world, "a", 200, 400);
    place(world, "b", 300, 400);
    world.state.serverTime += TICK_MS;
    handleAttack(world, P(world, "a"), RT(world, "a"), { kind: "attack", x: 300, y: 400, t: NaN });
    expect(P(world, "b").hp).toBe(72);
  });
});

describe("fists", () => {
  it("hit an adjacent unarmed target for 8, in melee", () => {
    const world = raid([alice(), bob()]);
    place(world, "a", 200, 400);
    place(world, "b", 230, 400);
    const events = swing(world, "a", 230, 400);
    expect(P(world, "b").hp).toBe(92);
    expect(P(world, "b").status).toBe("alive");
    expect(shotOf(events)).toEqual({
      kind: "shot", by: "a", x1: 200, y1: 400, x2: 230, y2: 400, hit: "b", melee: true,
    });
    expect(RT(world, "a").nextAttackAt).toBe(world.state.serverTime + FISTS.cooldownMs);
  });

  it("reach exactly FISTS.range along the ray and no further", () => {
    for (const [d, expectedHit] of [[FISTS.range, true], [FISTS.range + 0.5, false]] as const) {
      const world = raid([alice(), bob()]);
      place(world, "a", 200, 400);
      place(world, "b", 200 + d, 400);
      const shot = shotOf(swing(world, "a", 200 + d, 400));
      expect(shot.hit, `d=${d}`).toBe(expectedHit ? "b" : null);
      expect(lost(world, "b"), `d=${d}`).toBe(expectedHit ? 8 : 0);
    }
  });

  it("clicking short of the target still swings the full fist length", () => {
    const world = raid([alice(), bob()]);
    place(world, "a", 200, 400);
    place(world, "b", 230, 400);
    expect(shotOf(swing(world, "a", 205, 400)).hit).toBe("b");
  });

  it("do not need the click to reach the target: direction is all that matters", () => {
    const world = raid([alice(), bob()]);
    place(world, "a", 200, 400);
    place(world, "b", 200, 430);
    const shot = shotOf(swing(world, "a", 200, 1800)); // far past bob, straight down
    expect(shot.hit).toBe("b");
    expect(lost(world, "b")).toBe(8);
  });

  it("have a melee-sized hit radius", () => {
    const radius = PLAYER_RADIUS + MELEE_SLACK;
    expect(radius).toBe(20);
    for (const [off, expectedHit] of [[radius - 1, true], [radius, true], [radius + 1, false]] as const) {
      const world = raid([alice(), bob()]);
      place(world, "a", 200, 400);
      place(world, "b", 220, 400 + off);
      expect(shotOf(swing(world, "a", 240, 400)).hit, `off=${off}`).toBe(expectedHit ? "b" : null);
    }
  });
});

describe("weapon choice", () => {
  it("uses the highest-damage weapon carried, with its damage, range and cooldown", () => {
    const world = raid([alice(gear("knife", "pistol", "rifle", "vest", "bandage")), bob()]);
    place(world, "a", 200, 400);
    place(world, "b", 580, 400); // 380 away: only the rifle reaches
    const events = swing(world, "a", 580, 400);
    expect(shotOf(events)).toMatchObject({ hit: "b", melee: false });
    expect(lost(world, "b")).toBe(28);
    expect(RT(world, "a").nextAttackAt).toBe(world.state.serverTime + WEAPONS.rifle.cooldownMs);
  });

  it("picks by damage, not by range: a knife beats a pistol", () => {
    const world = raid([alice(gear("pistol", "knife")), bob()]);
    place(world, "a", 200, 400);
    place(world, "b", 300, 400); // pistol range, outside the knife's
    const events = swing(world, "a", 300, 400);
    expect(shotOf(events)).toMatchObject({ hit: null, melee: true });
    expect(lost(world, "b")).toBe(0);
    expect(RT(world, "a").nextAttackAt).toBe(world.state.serverTime + WEAPONS.knife.cooldownMs);

    place(world, "b", 230, 400);
    run(world, 20);
    expect(shotOf(swing(world, "a", 230, 400)).hit).toBe("b");
    expect(lost(world, "b")).toBe(22);
  });

  it("falls back to fists when the inventory has no weapon", () => {
    const world = raid([alice(gear("vest", "bandage", "gold")), bob()]);
    place(world, "a", 200, 400);
    place(world, "b", 230, 400);
    swing(world, "a", 230, 400);
    expect(lost(world, "b")).toBe(FISTS.damage);
    expect(RT(world, "a").nextAttackAt).toBe(world.state.serverTime + FISTS.cooldownMs);
  });

  it("re-evaluates the weapon on every swing, so a dropped weapon is gone", () => {
    const world = raid([alice(gear("rifle")), bob()]);
    place(world, "a", 200, 400);
    place(world, "b", 230, 400);
    swing(world, "a", 230, 400);
    expect(lost(world, "b")).toBe(28);
    P(world, "a").inventory.clear();
    run(world, 20);
    swing(world, "a", 230, 400);
    expect(lost(world, "b")).toBe(28 + FISTS.damage);
  });

  it("uses a ranged hit radius for guns", () => {
    const radius = PLAYER_RADIUS + RANGED_SLACK;
    expect(radius).toBe(14);
    for (const [off, expectedHit] of [[radius - 1, true], [radius, true], [radius + 1, false]] as const) {
      const world = raid([alice(gear("pistol")), bob()]);
      place(world, "a", 200, 400);
      place(world, "b", 300, 400 + off);
      expect(shotOf(swing(world, "a", 400, 400)).hit, `off=${off}`).toBe(expectedHit ? "b" : null);
    }
  });

  it("stops a ray at the weapon's range", () => {
    for (const [weapon, def] of [["pistol", WEAPONS.pistol], ["rifle", WEAPONS.rifle]] as const) {
      for (const [d, expectedHit] of [[def.range, true], [def.range + 1, false]] as const) {
        const world = raid([alice(gear(weapon)), bob()]);
        place(world, "a", 200, 400);
        place(world, "b", 200 + d, 400);
        const shot = shotOf(swing(world, "a", 200 + d, 400));
        expect(shot.hit, `${weapon} d=${d}`).toBe(expectedHit ? "b" : null);
        if (!expectedHit) expect(shot.x2, weapon).toBeCloseTo(200 + def.range, 9); // tracer ends at max range
      }
    }
  });
});

describe("cooldown", () => {
  it("ignores swings inside the cooldown silently, and allows one when it has elapsed", () => {
    const world = raid([alice(), bob()]);
    place(world, "a", 200, 400);
    place(world, "b", 230, 400);
    P(world, "b").hp = 100;
    swing(world, "a", 230, 400);
    const readyAt = RT(world, "a").nextAttackAt;
    expect(lost(world, "b")).toBe(8);

    // Every step up to (but not including) readyAt is too early.
    while (handlerNow(world) < readyAt) {
      const events = swing(world, "a", 230, 400);
      expect(events).toEqual([]); // no shot, no toast, nothing
      expect(lost(world, "b")).toBe(8);
      expect(RT(world, "a").nextAttackAt).toBe(readyAt);
    }
    expect(handlerNow(world)).toBe(readyAt);
    expect(shotOf(swing(world, "a", 230, 400)).hit).toBe("b");
    expect(lost(world, "b")).toBe(16);
    expect(RT(world, "a").nextAttackAt).toBe(readyAt + FISTS.cooldownMs);
  });

  it("counts a slower weapon's longer cooldown", () => {
    const world = raid([alice(gear("rifle")), bob()]);
    place(world, "a", 200, 400);
    place(world, "b", 300, 400);
    swing(world, "a", 300, 400);
    const ticks = WEAPONS.rifle.cooldownMs / TICK_MS;
    expect(Number.isInteger(ticks)).toBe(true);
    for (let i = 1; i < ticks; i++) expect(swing(world, "a", 300, 400), `tick ${i}`).toEqual([]);
    expect(lost(world, "b")).toBe(28);
    expect(shotOf(swing(world, "a", 300, 400)).hit).toBe("b");
    expect(lost(world, "b")).toBe(56);
  });

  it("allows one swing per tick even if several are queued", () => {
    const world = raid([alice(gear("pistol")), bob()]);
    place(world, "a", 200, 400);
    place(world, "b", 300, 400);
    const q = RT(world, "a").inputs;
    for (let i = 0; i < 3; i++) enqueueClientMessage(q, "attack", { x: 300, y: 400 });
    const events = step(world, TICK_MS);
    expect(fxOf(events, "shot")).toHaveLength(1);
    expect(lost(world, "b")).toBe(16);
  });

  it("is per shooter", () => {
    const world = raid([alice(), bob()]);
    place(world, "a", 200, 400);
    place(world, "b", 220, 400);
    enqueueClientMessage(RT(world, "a").inputs, "attack", { x: 220, y: 400 });
    enqueueClientMessage(RT(world, "b").inputs, "attack", { x: 200, y: 400 });
    const events = step(world, TICK_MS);
    expect(fxOf(events, "shot").map((s) => s.by).sort()).toEqual(["a", "b"]);
    expect(lost(world, "a")).toBe(8);
    expect(lost(world, "b")).toBe(8);
  });

  it("an ignored swing neither turns the player nor cancels extraction", () => {
    const world = raid([alice(), bob()]);
    place(world, "a", 200, 400);
    place(world, "b", 230, 400);
    swing(world, "a", 230, 400);
    const a = P(world, "a");
    const rt = RT(world, "a");
    rt.extracting = { zoneId: "z", startedAt: world.state.serverTime };
    a.extractProgress = 0.4;
    const facing = a.facing;
    swing(world, "a", 200, 100);
    expect(a.facing).toBe(facing);
    expect(rt.extracting).not.toBeNull();
    expect(a.extractProgress).toBe(0.4);
  });
});

describe("aim and facing", () => {
  it("turns the shooter toward the click", () => {
    const world = raid([alice()]);
    place(world, "a", 200, 400);
    swing(world, "a", 200, 300);
    expect(P(world, "a").facing).toBeCloseTo(-Math.PI / 2, 12);
    run(world, 20);
    swing(world, "a", 100, 400);
    expect(Math.abs(P(world, "a").facing)).toBeCloseTo(Math.PI, 12);
  });

  it("aims along the facing when the click is on top of the shooter", () => {
    for (const click of [{ x: 200, y: 400 }, { x: 200.0004, y: 400 }]) {
      const world = raid([alice(), bob()]);
      place(world, "a", 200, 400);
      place(world, "b", 200, 425);
      P(world, "a").facing = Math.PI / 2; // facing +y
      const shot = shotOf(swing(world, "a", click.x, click.y));
      expect(shot.hit, String(click.x)).toBe("b");
      expect(P(world, "a").facing).toBeCloseTo(Math.PI / 2, 12);
    }
  });

  it("fires along the facing even when that points away from the target", () => {
    const world = raid([alice(), bob()]);
    place(world, "a", 200, 400);
    place(world, "b", 225, 400);
    P(world, "a").facing = Math.PI; // facing -x
    expect(shotOf(swing(world, "a", 200, 400)).hit).toBe(null);
  });

  it("does not hit a target behind the shooter", () => {
    const world = raid([alice(gear("rifle")), bob()]);
    place(world, "a", 200, 400);
    place(world, "b", 150, 400);
    expect(shotOf(swing(world, "a", 300, 400)).hit).toBe(null);
  });

  it("clamps an out-of-world click at the input layer, so the ray still goes that way", () => {
    const world = raid([alice(gear("rifle")), bob()]);
    place(world, "a", 200, 400);
    place(world, "b", 300, 400);
    expect(shotOf(swing(world, "a", 1e9, 400)).hit).toBe("b");
  });
});

describe("line of fire", () => {
  it("the nearest body on the ray takes the hit, whatever the iteration order", () => {
    for (const nearFirst of [true, false]) {
      // bob is near and carol is far; the order they joined decides who the sim visits first.
      const seats = nearFirst ? [alice(gear("rifle")), bob(), carol()] : [alice(gear("rifle")), carol(), bob()];
      const world = raid(seats);
      place(world, "a", 200, 400);
      place(world, "b", 300, 400);
      place(world, "c", 380, 406); // inside carol's hit radius, behind bob
      const shot = shotOf(swing(world, "a", 500, 400));
      expect(shot.hit, `nearFirst=${nearFirst}`).toBe("b");
      expect(shot.x2).toBeCloseTo(300, 9);
      expect(shot.y2).toBeCloseTo(400, 9);
      expect(lost(world, "b")).toBe(28);
      expect(lost(world, "c")).toBe(0);
    }
  });

  it("a nearer body off the line does not shield one on it", () => {
    const world = raid([alice(gear("rifle")), bob(), carol()]);
    place(world, "a", 200, 400);
    place(world, "b", 300, 440); // 40 off the line
    place(world, "c", 380, 400);
    expect(shotOf(swing(world, "a", 500, 400)).hit).toBe("c");
    expect(lost(world, "b")).toBe(0);
  });

  it("ends the tracer at the point on the ray nearest the body, not at its centre", () => {
    const world = raid([alice(gear("rifle")), bob()]);
    place(world, "a", 200, 400);
    place(world, "b", 300, 410);
    const shot = shotOf(swing(world, "a", 500, 400));
    expect(shot.hit).toBe("b");
    expect(shot.x2).toBeCloseTo(300, 9);
    expect(shot.y2).toBeCloseTo(400, 9);
    expect(shot.x1).toBe(200);
    expect(shot.y1).toBe(400);
  });

  it("works along diagonals", () => {
    const world = raid([alice(gear("rifle")), bob()]);
    place(world, "a", 200, 200);
    place(world, "b", 300, 300);
    const shot = shotOf(swing(world, "a", 250, 250));
    expect(shot.hit).toBe("b");
    expect(shot.x2).toBeCloseTo(300, 9);
    expect(shot.y2).toBeCloseTo(300, 9);
  });

  it("a target on top of the shooter is hit", () => {
    const world = raid([alice(), bob()]);
    place(world, "a", 200, 400);
    place(world, "b", 200, 400);
    expect(shotOf(swing(world, "a", 220, 400)).hit).toBe("b");
  });

  it("never hits the shooter", () => {
    const world = raid([alice(gear("rifle"))]);
    place(world, "a", 200, 400);
    const shot = shotOf(swing(world, "a", 300, 400));
    expect(shot.hit).toBe(null);
    expect(P(world, "a").hp).toBe(100);
    expect(P(world, "a").status).toBe("alive");
    expect(P(world, "a").kills).toBe(0);
  });

  it("does not hit players who are not alive", () => {
    for (const status of ["lobby", "dead", "extracted", "mia"]) {
      const world = raid([alice(gear("rifle")), bob(), carol()]);
      place(world, "a", 200, 400);
      place(world, "b", 300, 400);
      place(world, "c", 380, 400);
      P(world, "b").status = status; // in front, not a valid target
      const shot = shotOf(swing(world, "a", 500, 400));
      expect(shot.hit, status).toBe("c"); // the shot goes through to the living player behind
      expect(lost(world, "b"), status).toBe(0);
    }
  });
});

describe("walls", () => {
  it("block the ray: a target behind a wall is untouched and the tracer ends on the wall face", () => {
    const world = raid([alice(gear("rifle")), bob()], walledArena());
    place(world, "a", 200, 400);
    place(world, "b", 500, 400);
    const shot = shotOf(swing(world, "a", 500, 400));
    expect(shot.hit).toBe(null);
    expect(shot.melee).toBe(false);
    expect(shot.x1).toBe(200);
    expect(shot.x2).toBeCloseTo(WALL_X, 9);
    expect(shot.y2).toBeCloseTo(400, 9);
    expect(P(world, "b").hp).toBe(100);
    expect(RT(world, "a").nextAttackAt).toBe(world.state.serverTime + WEAPONS.rifle.cooldownMs);
  });

  it("do not stop a target in front of them", () => {
    const world = raid([alice(gear("rifle")), bob(), carol()], walledArena());
    place(world, "a", 200, 400);
    place(world, "b", 300, 400);
    place(world, "c", 500, 400);
    const shot = shotOf(swing(world, "a", 500, 400));
    expect(shot.hit).toBe("b");
    expect(lost(world, "c")).toBe(0);
  });

  it("block at any angle: the cut-off tracer lies on the aimed ray", () => {
    const world = raid([alice(gear("rifle")), bob()], walledArena());
    place(world, "a", 200, 400);
    place(world, "b", 460, 420);
    const shot = shotOf(swing(world, "a", 460, 420));
    expect(shot.hit).toBe(null);
    expect(shot.x2).toBeCloseTo(WALL_X, 9);
    // On the line from (200,400) toward (460,420).
    expect(shot.y2).toBeCloseTo(400 + (WALL_X - 200) * (20 / 260), 9);
  });

  it("block melee swings too", () => {
    const world = raid([alice(), bob()], walledArena());
    // Closer to the wall than a real body can stand, so the fists could reach the far side if the wall let them.
    place(world, "a", WALL_X - 1, 400);
    place(world, "b", WALL_X + TILE + 1, 400);
    expect(TILE + 2).toBeLessThanOrEqual(FISTS.range);
    const shot = shotOf(swing(world, "a", WALL_X + 50, 400));
    expect(shot).toMatchObject({ hit: null, melee: true });
    expect(shot.x2).toBeCloseTo(WALL_X, 9);
    expect(lost(world, "b")).toBe(0);
  });

  it("only block rays that cross them", () => {
    const world = raid([alice(gear("rifle")), bob()], walledArena());
    place(world, "a", 200, 100); // above the wall (it starts at y = 160)
    place(world, "b", 500, 100);
    expect(shotOf(swing(world, "a", 500, 100)).hit).toBe("b");
  });

  it("block on a generated map too", () => {
    const map = generateMap(1234);
    let slab: { west: number; east: number; y: number } | null = null;
    for (let ty = 1; ty < map.h - 1 && !slab; ty++) {
      for (let tx = 1; tx < map.w - 3 && !slab; tx++) {
        if (!isWallTile(map, tx, ty) && isWallTile(map, tx + 1, ty) && !isWallTile(map, tx + 2, ty)) {
          slab = { west: (tx + 1) * TILE - 12, east: (tx + 2) * TILE + 12, y: ty * TILE + TILE / 2 };
        }
      }
    }
    expect(slab, "a one-tile wall on the generated map").not.toBeNull();
    const world = raid([alice(gear("rifle")), bob()], "generated");
    place(world, "a", slab!.west, slab!.y);
    place(world, "b", slab!.east, slab!.y);
    const shot = shotOf(swing(world, "a", slab!.east, slab!.y));
    expect(shot.hit).toBe(null);
    expect(shot.x2).toBeCloseTo(slab!.west + 12, 9);
    expect(shot.y2).toBeCloseTo(slab!.y, 9);
    expect(P(world, "b").hp).toBe(100);
  });
});

describe("armor", () => {
  // [weapon, armor items, expected damage]. Rounding is to the nearest point (halves up).
  const table: Array<[keyof typeof WEAPONS, string[], number]> = [
    ["fists", [], 8], ["fists", ["vest"], 6], ["fists", ["plate"], 4],
    ["knife", [], 22], ["knife", ["vest"], 17], ["knife", ["plate"], 12],
    ["pistol", [], 16], ["pistol", ["vest"], 12], ["pistol", ["plate"], 9],
    ["rifle", [], 28], ["rifle", ["vest"], 21], ["rifle", ["plate"], 15],
  ];

  it.each(table)("%s against %j deals %i", (weapon, armor, expected) => {
    const world = raid([alice(weapon === "fists" ? [] : gear(weapon)), bob(gear(...armor))]);
    place(world, "a", 200, 400);
    place(world, "b", 230, 400);
    swing(world, "a", 230, 400);
    expect(lost(world, "b")).toBe(expected);
    expect(expected).toBe(damageAgainst(WEAPONS[weapon], armor.length ? (ITEMS[armor[0]!] as ArmorDef) : null));
  });

  it("uses the best armor carried, ignoring other items", () => {
    const world = raid([alice(gear("rifle")), bob(gear("vest", "gold", "plate", "bandage"))]);
    place(world, "a", 200, 400);
    place(world, "b", 300, 400);
    swing(world, "a", 300, 400);
    expect(lost(world, "b")).toBe(15);
  });

  it("is judged when the shot lands: armor looted away earlier no longer helps", () => {
    const world = raid([alice(), bob(gear("plate"))]);
    place(world, "a", 200, 400);
    place(world, "b", 230, 400);
    swing(world, "a", 230, 400);
    expect(lost(world, "b")).toBe(4);
    P(world, "b").inventory.clear();
    run(world, 20);
    swing(world, "a", 230, 400);
    expect(lost(world, "b")).toBe(4 + 8);
  });

  it("never reduces hp below 0", () => {
    const world = raid([alice(gear("rifle")), bob()]);
    place(world, "a", 200, 400);
    place(world, "b", 300, 400);
    P(world, "b").hp = 5;
    swing(world, "a", 300, 400);
    expect(P(world, "b").hp).toBe(0);
  });
});

describe("kills", () => {
  function killScene() {
    const world = raid([alice(gear("rifle")), bob(gear("bandage", "watch"))]);
    place(world, "a", 200, 400);
    place(world, "b", 300, 400);
    P(world, "b").hp = 20;
    const events = swing(world, "a", 300, 400);
    return { world, events };
  }

  it("marks the victim dead with 0 hp and credits the killer", () => {
    const { world } = killScene();
    expect(P(world, "b").hp).toBe(0);
    expect(P(world, "b").status).toBe("dead");
    expect(RT(world, "b").killedBy).toBe("alice");
    expect(RT(world, "b").resolved).toBe(true);
    expect(P(world, "a").kills).toBe(1);
    expect(P(world, "a").status).toBe("alive");
    expect(RT(world, "a").killedBy).toBe(null);
  });

  it("emits the shot and a death fx at the victim, before the result", () => {
    const { events } = killScene();
    expect(shotOf(events)).toMatchObject({ hit: "b", by: "a" });
    expect(fxOf(events, "death")).toEqual([{ kind: "death", id: "b", x: 300, y: 400, by: "a" }]);
    const order = events.map((e) => (e.type === "fx" ? e.fx.kind : e.type));
    expect(order).toEqual(["shot", "death", "resolved"]);
  });

  it("leaves a body holding everything the victim carried", () => {
    const { world } = killScene();
    const bodies = [...world.state.containers.values()].filter((c) => c.kind === "body");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ x: 300, y: 400, label: "bob" });
    expect(dto(bodies[0]!.items)).toEqual(gear("bandage", "watch"));
    expect(P(world, "b").inventory.length).toBe(0);
  });

  it("resolves the victim as died, losing what they carried", () => {
    const { events } = killScene();
    const resolved = ofType(events, "resolved");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.id).toBe("b");
    expect(resolved[0]!.result).toMatchObject({
      outcome: "died", profile: "bob", kills: 0, killedBy: "alice", extracted: [],
      broughtIn: gear("bandage", "watch"), lost: gear("bandage", "watch"),
    });
  });

  it("counts kills, and stands over the body for the next shot", () => {
    const world = raid([alice(gear("rifle")), bob(), carol()]);
    place(world, "a", 200, 400);
    place(world, "b", 300, 400);
    place(world, "c", 380, 400);
    P(world, "b").hp = 10;
    P(world, "c").hp = 10;
    swing(world, "a", 380, 400);
    expect(P(world, "b").status).toBe("dead");
    expect(P(world, "a").kills).toBe(1);
    run(world, WEAPONS.rifle.cooldownMs / TICK_MS);

    // bob's corpse is on the line but is not a target: the shot reaches carol.
    const events = swing(world, "a", 380, 400);
    expect(shotOf(events).hit).toBe("c");
    expect(P(world, "c").status).toBe("dead");
    expect(P(world, "a").kills).toBe(2);
    expect(RT(world, "c").killedBy).toBe("alice");
    expect(fxOf(events, "death").map((d) => d.id)).toEqual(["c"]);
    expect(ofType(events, "resolved").map((r) => r.id)).toEqual(["c"]);
    expect(P(world, "b").hp).toBe(0);
  });

  it("a non-lethal hit does not resolve anyone", () => {
    const world = raid([alice(), bob()]);
    place(world, "a", 200, 400);
    place(world, "b", 230, 400);
    const events = swing(world, "a", 230, 400);
    expect(fxOf(events, "death")).toEqual([]);
    expect(ofType(events, "resolved")).toEqual([]);
    expect(RT(world, "b").killedBy).toBe(null);
    expect(P(world, "a").kills).toBe(0);
  });

  it("exactly lethal damage kills", () => {
    const world = raid([alice(), bob()]);
    place(world, "a", 200, 400);
    place(world, "b", 230, 400);
    P(world, "b").hp = FISTS.damage;
    swing(world, "a", 230, 400);
    expect(P(world, "b").status).toBe("dead");
  });

  it("when two players kill each other in one tick, only the first one processed lands its blow", () => {
    const world = raid([alice(), bob()]);
    place(world, "a", 200, 400);
    place(world, "b", 220, 400);
    P(world, "a").hp = 5;
    P(world, "b").hp = 5;
    enqueueClientMessage(RT(world, "a").inputs, "attack", { x: 220, y: 400 });
    enqueueClientMessage(RT(world, "b").inputs, "attack", { x: 200, y: 400 });
    const events = step(world, TICK_MS);
    const dead = ["a", "b"].filter((id) => P(world, id).status === "dead");
    const alive = ["a", "b"].filter((id) => P(world, id).status === "alive");
    expect(dead).toHaveLength(1);
    expect(alive).toHaveLength(1);
    expect(P(world, alive[0]!).hp).toBe(5); // the loser's queued swing never happened
    expect(P(world, alive[0]!).kills).toBe(1);
    expect(fxOf(events, "shot")).toHaveLength(1);
    expect(fxOf(events, "death").map((d) => d.id)).toEqual(dead);
  });

  it("a killed player's later attack messages do nothing", () => {
    const { world } = killScene();
    expect(enqueueClientMessage(RT(world, "b").inputs, "attack", { x: 200, y: 400 })).toBe(true);
    expect(step(world, TICK_MS)).toEqual([]);
    expect(P(world, "a").hp).toBe(100);
  });
});

describe("attacking while extracting", () => {
  it("cancels the extraction", () => {
    const world = raid([alice(), bob()]);
    place(world, "a", 200, 400);
    place(world, "b", 600, 600);
    const rt = RT(world, "a");
    rt.extracting = { zoneId: "z1", startedAt: world.state.serverTime };
    P(world, "a").extractProgress = 0.6;
    swing(world, "a", 220, 400);
    expect(rt.extracting).toBeNull();
    expect(P(world, "a").extractProgress).toBe(0);
  });

  it("cancels even when nothing is hit", () => {
    const world = raid([alice(gear("rifle"))], walledArena());
    place(world, "a", 200, 400);
    const rt = RT(world, "a");
    rt.extracting = { zoneId: "z1", startedAt: 0 };
    P(world, "a").extractProgress = 0.2;
    expect(shotOf(swing(world, "a", 500, 400)).hit).toBe(null);
    expect(rt.extracting).toBeNull();
    expect(P(world, "a").extractProgress).toBe(0);
  });
});

describe("lag compensation", () => {
  /**
   * Alice (rifle) at (200, 400) shoots along +x. Bob's recorded past is `past` (ms before the moment
   * the attack is handled, x, y) and he is at `now` at that moment. Bob is on the line of fire at y = 400.
   */
  function lagScene(past: Array<[ago: number, x: number, y: number]>, nowAt = { x: 300, y: 500 }) {
    const world = raid([alice(gear("rifle")), bob()]);
    run(world, 12);
    place(world, "a", 200, 400);
    place(world, "b", nowAt.x, nowAt.y);
    const now = handlerNow(world);
    RT(world, "b").history = past.map(([ago, x, y]) => ({ t: now - ago, x, y }));
    return { world, now };
  }

  /** Bob stood on the line until 175 ms ago, then stepped off it. */
  const stepsOff: Array<[number, number, number]> = [
    [300, 300, 400], [250, 300, 400], [200, 300, 400], [150, 300, 500], [100, 300, 500], [50, 300, 500],
  ];

  it("hits a target where the shooter saw it, even though it has since moved off the line", () => {
    const { world, now } = lagScene(stepsOff);
    const shot = shotOf(swing(world, "a", 500, 400, now - 250));
    expect(shot.hit).toBe("b");
    expect(lost(world, "b")).toBe(28);
    expect(shot.x2).toBeCloseTo(300, 9);
    expect(shot.y2).toBeCloseTo(400, 9);
  });

  it("misses at the present position when no render time is given", () => {
    const { world } = lagScene(stepsOff);
    const shot = shotOf(swing(world, "a", 500, 400));
    expect(shot.hit).toBe(null);
    expect(lost(world, "b")).toBe(0);
  });

  it("misses when the render time is after the target moved", () => {
    const { world, now } = lagScene(stepsOff);
    expect(shotOf(swing(world, "a", 500, 400, now - 100)).hit).toBe(null);
    expect(lost(world, "b")).toBe(0);
  });

  it("interpolates between recorded ticks", () => {
    // Between the samples at -200 (y=400) and -150 (y=500): 195 ms ago is 10% of the way along.
    const a = lagScene(stepsOff);
    expect(shotOf(swing(a.world, "a", 500, 400, a.now - 195)).hit).toBe("b");
    // 175 ms ago is halfway, y = 450: well off the line.
    const b = lagScene(stepsOff);
    expect(shotOf(swing(b.world, "a", 500, 400, b.now - 175)).hit).toBe(null);
  });

  it("rewinds every candidate: a body that is in front now but was elsewhere then does not shield the one behind", () => {
    const world = raid([alice(gear("rifle")), bob(), carol()]);
    run(world, 12);
    place(world, "a", 200, 400);
    place(world, "b", 300, 400);
    place(world, "c", 400, 400);
    const now = handlerNow(world);
    const past: Array<[number, number, number]> = [[300, 300, 700], [250, 300, 700], [100, 300, 700]];
    RT(world, "b").history = past.map(([ago, x, y]) => ({ t: now - ago, x, y }));
    expect(shotOf(swing(world, "a", 500, 400, now - 250)).hit).toBe("c");
    expect(lost(world, "b")).toBe(0);
    expect(lost(world, "c")).toBe(28);
  });

  it("clamps a render time older than MAX_REWIND_MS to exactly MAX_REWIND_MS back", () => {
    // Bob was on the line only before the window: an unclamped ancient t would find him there.
    const before = lagScene([
      [400, 300, 400], [350, 300, 400], [MAX_REWIND_MS + 10, 300, 400],
      [MAX_REWIND_MS, 300, 500], [100, 300, 500], [50, 300, 500],
    ]);
    expect(shotOf(swing(before.world, "a", 500, 400, before.now - 5000)).hit).toBe(null);
    expect(lost(before.world, "b")).toBe(0);

    // Bob is on the line at the very edge of the window and off it a tick later: the clamp lands on the edge.
    const edge = () => lagScene([
      [400, 300, 400], [MAX_REWIND_MS, 300, 400], [MAX_REWIND_MS - TICK_MS, 300, 500], [100, 300, 500], [50, 300, 500],
    ]);
    const old = edge();
    expect(shotOf(swing(old.world, "a", 500, 400, old.now - 5000)).hit).toBe("b");
    const ancient = edge();
    expect(shotOf(swing(ancient.world, "a", 500, 400, -1e12)).hit).toBe("b");
  });

  it("uses a render time inside the window as given", () => {
    // On the line only for the 50 ms around 290 ms ago. Using t as-is hits; clamping to the edge or ignoring t misses.
    const { world, now } = lagScene([
      [400, 300, 500], [300, 300, 500], [290, 300, 400], [240, 300, 400], [190, 300, 500], [50, 300, 500],
    ]);
    expect(shotOf(swing(world, "a", 500, 400, now - 290)).hit).toBe("b");
  });

  it("clamps a render time in the future to the last published tick, never the live position", () => {
    // Published (one tick ago) bob was off the line; live he is on it. A future t must not see the live spot.
    const off = lagScene([[300, 300, 500], [100, 300, 500], [TICK_MS, 300, 500]], { x: 300, y: 400 });
    expect(shotOf(swing(off.world, "a", 500, 400, off.now + 10_000)).hit).toBe(null);
    expect(lost(off.world, "b")).toBe(0);
    // Published he was on the line; live he has left it: a hit, because that is what clients were shown.
    const on = lagScene([[300, 300, 400], [100, 300, 400], [TICK_MS, 300, 400]], { x: 300, y: 500 });
    expect(shotOf(swing(on.world, "a", 500, 400, on.now + 10_000)).hit).toBe("b");
  });

  it("falls back to the present when the target has no recorded past", () => {
    const { world, now } = lagScene([], { x: 300, y: 400 });
    expect(shotOf(swing(world, "a", 500, 400, now - 200)).hit).toBe("b");
  });

  it("casts the ray from the shooter's present position, not a rewound one", () => {
    const world = raid([alice(gear("rifle")), bob()]);
    run(world, 12);
    place(world, "a", 200, 400);
    place(world, "b", 300, 400);
    const now = handlerNow(world);
    RT(world, "a").history = [{ t: now - 250, x: 900, y: 900 }, { t: now - 50, x: 200, y: 400 }];
    const shot = shotOf(swing(world, "a", 500, 400, now - 250));
    expect(shot).toMatchObject({ x1: 200, y1: 400, hit: "b" });
  });

  it("works against a target that really walked: hit at the recorded position, miss at the present one", () => {
    // Bob crosses alice's firing line (y = 400) walking down the x = 400 column.
    const walkerScene = () => {
      const world = raid([alice(gear("rifle")), bob()]);
      place(world, "a", 200, 400);
      place(world, "b", 400, 300);
      expect(enqueueClientMessage(RT(world, "b").inputs, "move", { x: 400, y: 560 })).toBe(true);
      for (let i = 0; i < 200 && P(world, "b").y < 430; i++) step(world, TICK_MS);
      expect(P(world, "b").y).toBeGreaterThanOrEqual(430);
      expect(P(world, "b").y).toBeLessThan(560);
      return world;
    };

    const lagged = walkerScene();
    const rtB = RT(lagged, "b");
    const crossing = rtB.history.reduce((m, s) => (Math.abs(s.y - 400) < Math.abs(m.y - 400) ? s : m));
    expect(Math.abs(crossing.y - 400)).toBeLessThan(10); // he was on the line at this sample
    expect(handlerNow(lagged) - crossing.t).toBeLessThanOrEqual(MAX_REWIND_MS);
    expect(Math.abs(P(lagged, "b").y - 400)).toBeGreaterThan(PLAYER_RADIUS + RANGED_SLACK + 10); // and not any more
    expect(shotOf(swing(lagged, "a", 400, 400, crossing.t)).hit).toBe("b");
    expect(lost(lagged, "b")).toBe(28);

    const live = walkerScene();
    expect(shotOf(swing(live, "a", 400, 400)).hit).toBe(null);
    expect(lost(live, "b")).toBe(0);
  });
});

describe("same-tick ordering", () => {
  it("credits exactly one shooter when two shots would kill the same victim in one tick", () => {
    const orders = new Set<string>();
    for (let seed = 1; seed < 60 && orders.size < 2; seed++) {
      const world = raid([alice(gear("rifle")), carol(gear("rifle")), bob(gear("gold"))], arena(), seed);
      place(world, "a", 200, 400);
      place(world, "c", 200, 430);
      place(world, "b", 300, 400);
      P(world, "b").hp = 20;
      const first = actionOrder(world, world.state.tick + 1).find((id) => id === "a" || id === "c")!;
      orders.add(first);
      enqueueClientMessage(RT(world, "a").inputs, "attack", { x: 300, y: 400 });
      enqueueClientMessage(RT(world, "c").inputs, "attack", { x: 300, y: 400 });
      const events = step(world, TICK_MS);

      const winner = first === "a" ? "alice" : "carol";
      expect(P(world, first).kills).toBe(1);
      expect(P(world, first === "a" ? "c" : "a").kills).toBe(0);
      expect(RT(world, "b").killedBy).toBe(winner);
      expect(fxOf(events, "death")).toHaveLength(1);
      expect(ofType(events, "resolved")).toHaveLength(1);
      const bodies = [...world.state.containers.values()].filter((c) => c.kind === "body" && c.label === "bob");
      expect(bodies).toHaveLength(1);
      expect(dto(bodies[0]!.items)).toEqual(gear("gold"));
      // The second shot still happens but finds no living target.
      const shots = fxOf(events, "shot");
      expect(shots).toHaveLength(2);
      expect(shots.filter((s) => s.hit === "b")).toHaveLength(1);
    }
    expect(orders).toEqual(new Set(["a", "c"]));
  });

  it("resolves a shot against the last published position, whichever of shooter/target acts first", () => {
    const outcomes = new Map<string, string | null>();
    for (let seed = 1; seed < 60 && outcomes.size < 2; seed++) {
      const world = raid([alice(gear("rifle")), bob()], arena(), seed);
      place(world, "a", 200, 400);
      place(world, "b", 300, 380);
      const now = handlerNow(world);
      // Bob was published 20 units off the firing line and walks onto it this very tick.
      RT(world, "b").history = [{ t: now - TICK_MS, x: 300, y: 380 }];
      RT(world, "b").path = [{ x: 300, y: 600 }];
      const first = actionOrder(world, world.state.tick + 1)[0]!;
      const shot = shotOf(swing(world, "a", 500, 400)); // no t: defaults to the published tick
      outcomes.set(first, shot.hit);
    }
    expect([...outcomes.keys()].sort()).toEqual(["a", "b"]);
    expect([...outcomes.values()]).toEqual([null, null]);
  });
});

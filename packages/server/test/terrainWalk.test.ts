// LOW tiles (a fence, a lava stream) against bodies and hands: a walk order goes round them, a pickup does not reach through
// them, a melee mob shot from across one walks round and gives up, a ranged mob never retreats onto one, and no training piece
// lands on one. The sim reads the move mask for all of it (MASK_MOVE through circleClear, segmentClear, findPath and the
// pickup's line), so these run on the real phases with hand-built rooms (test/terrainWorld.ts); the reach side (swings, shots,
// the lock) is in terrainReach.test.ts.
import { describe, expect, it } from "vitest";
import {
  circleClear, INTERACT_RANGE, mulberry32, MOB_GIVE_UP_SECONDS, MOB_HOME_RADIUS, MOB_LEASH_RADIUS, PLAYER_RADIUS, TICK_MS, TILE,
  TILE_FLOOR, TILE_LOW, WEAPON_IDS, type FxEvent, type GameMap, type Vec2,
} from "@raid/shared";
import { ContainerState, ItemState } from "@raid/shared/schema";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { placeMob, type MobCombatant } from "../src/sim/mobLife";
import { addPlayer, step } from "../src/sim/step";
import { nextId, type SimConfig, type SimEvent, type World } from "../src/sim/world";
import { eastOf, roomMap, tileCentre, tileClassAt, vertical, westOf } from "./terrainWorld";

type Fx<K extends FxEvent["kind"]> = Extract<FxEvent, { kind: K }>;
const fxOf = <K extends FxEvent["kind"]>(events: SimEvent[], kind: K): Array<Fx<K>> =>
  events.flatMap((e) => (e.type === "fx" && e.fx.kind === kind ? [e.fx as Fx<K>] : []));

function config(n: number, extra: Partial<SimConfig> = {}): SimConfig {
  return { minPlayers: n, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600, ...extra };
}

/** `n` players p0, p1, ... in an active run on `map`: the map's loot cleared, a sword in hand, huge hp. */
function startRun(map: GameMap, n = 1, extra: Partial<SimConfig> = {}): World {
  const world = createGameWorld({ seed: 7, config: config(n, extra), random: mulberry32(8) }, { signatures: false });
  world.map = map;
  world.state.containers.clear();
  for (let i = 0; i < n; i++) {
    const p = addPlayer(world, `p${i}`, `player${i}`, { faction: "plague" });
    p.weapon0 = "sword";
    p.maxHp = p.hp = 1e9;
  }
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  return world;
}

function put(world: World, id: string, at: Vec2): void {
  const c = combatant(world, id)!;
  c.s.x = at.x;
  c.s.y = at.y;
  c.rt.path = [];
  c.rt.history = [{ t: world.state.serverTime, x: at.x, y: at.y }];
}

const pos = (world: World, id: string): Vec2 => { const c = combatant(world, id)!; return { x: c.s.x, y: c.s.y }; };
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

// ---- a walk order ---------------------------------------------------------------------------------------------------------

describe("a move order across a LOW fence", () => {
  // 40 x 20; a fence at column 20 (x 640..672), rows 1..13; the gap is rows 14..18.
  const map = () => roomMap(40, 20, { low: vertical(20, 1, 13) });

  it("walks the gap: the disc is clear on the move mask on every tick, the centre is never on LOW, and it arrives", () => {
    const m = map();
    const world = startRun(m);
    const from = westOf(20, 176);
    const to = eastOf(20, 176);
    put(world, "p0", from);
    enqueueClientMessage(world.players.get("p0")!.inputs, "move", { x: to.x, y: to.y });
    let maxY = 0;
    const bad: number[] = [];
    for (let i = 0; i < 400 && dist(pos(world, "p0"), to) > 1; i++) {
      step(world, TICK_MS);
      const me = pos(world, "p0");
      maxY = Math.max(maxY, me.y);
      if (!circleClear(m, me, PLAYER_RADIUS) || tileClassAt(m, me) === TILE_LOW) bad.push(i);
    }
    expect(bad).toEqual([]);
    expect(maxY).toBeGreaterThan(14 * TILE); // through the gap, not over the fence
    expect(dist(pos(world, "p0"), to)).toBeLessThan(1);
  });

  it("a click on the fence itself walks to the bank nearest the click, never onto it", () => {
    const m = map();
    const world = startRun(m);
    put(world, "p0", westOf(20, 176));
    enqueueClientMessage(world.players.get("p0")!.inputs, "move", { x: 20 * TILE + 8, y: 176 });
    for (let i = 0; i < 100; i++) {
      step(world, TICK_MS);
      expect(tileClassAt(m, pos(world, "p0"))).toBe(TILE_FLOOR);
    }
    expect(dist(pos(world, "p0"), westOf(20, 176))).toBeLessThan(40);
  });
});

// ---- a pickup -------------------------------------------------------------------------------------------------------------

describe("a pickup across a LOW fence", () => {
  const toasts = (events: SimEvent[]): string[] => events.flatMap((e) => (e.type === "toast" ? [e.text] : []));

  function putGround(world: World, at: Vec2, def: string): ContainerState {
    const c = new ContainerState();
    c.id = nextId(world, "t");
    c.kind = "ground";
    c.x = at.x;
    c.y = at.y;
    c.label = "ground";
    const item = new ItemState();
    item.uid = world.newItemUid();
    item.def = def;
    c.items.push(item);
    world.state.containers.set(c.id, c);
    return c;
  }

  /** p0 on the west face, the weapon on the east face: exactly INTERACT_RANGE apart. */
  function attempt(map: GameMap): { toasts: string[]; slots: [string, string] } {
    const world = startRun(map);
    const west = westOf(12, 256);
    const east = eastOf(12, 256);
    expect(dist(west, east)).toBe(INTERACT_RANGE);
    put(world, "p0", west);
    const bow = putGround(world, east, "bow");
    step(world, TICK_MS);
    enqueueClientMessage(world.players.get("p0")!.inputs, "pickup", { containerId: bow.id });
    const out = toasts(step(world, TICK_MS));
    const p = world.state.players.get("p0")!;
    return { toasts: out, slots: [p.weapon0, p.weapon1] };
  }

  it("is refused at exactly 56 u: 'Can't reach that', and nothing changes", () => {
    const r = attempt(roomMap(24, 16, { low: vertical(12, 1, 14) }));
    expect(r.toasts).toEqual(["Can't reach that"]);
    expect(r.slots).toEqual(["sword", ""]);
  });

  it("is accepted at the same distance on open floor", () => {
    const r = attempt(roomMap(24, 16));
    expect(r.toasts).toEqual([]);
    expect(r.slots).toEqual(["sword", "bow"]);
  });

  it("is refused across lava too (the class decides)", () => {
    const r = attempt(roomMap(24, 16, { low: vertical(12, 1, 14), kind: 1 }));
    expect(r.toasts).toEqual(["Can't reach that"]);
  });
});

// ---- mobs -----------------------------------------------------------------------------------------------------------------

describe("regional mobs and LOW", () => {
  const TILES = 64;
  const HOME = tileCentre(32, 32);

  function mobWorld(map: GameMap): World {
    return startRun(map, 1);
  }

  const spawn = (world: World, region: "sentenced" | "plague", at: Vec2 = HOME): MobCombatant =>
    combatant(world, placeMob(world, { region, elite: false, at, facing: 0 })) as MobCombatant;

  /** A hit on the mob from p0 through the real path (recordHit, applyLedger, hurtMob, aggro): it wakes onto p0. */
  function shoot(world: World, mob: MobCombatant): void {
    recordHit(world, {
      victim: mob.id, by: { id: "p0", name: "player0" }, packet: { raw: 1, phys: 0, magic: 0, true: 1 }, weapon: "bow", stagger: false,
    });
    applyLedger(world);
  }

  function displace(world: World, mob: MobCombatant, at: Vec2): void {
    mob.s.x = at.x;
    mob.s.y = at.y;
    mob.rt.path = [];
    mob.rt.history = [{ t: world.state.serverTime, x: at.x, y: at.y }];
  }

  it("a melee mob shot from across a fence paths round, swings at nothing, gives up and returns whole", () => {
    // A fence at column 34 (x 1088..1120) from row 2 to row 57: the only way round is rows 58..62, far past the leash.
    const map = roomMap(TILES, TILES, { low: vertical(34, 2, 57) });
    const world = mobWorld(map);
    const mob = spawn(world, "sentenced");
    const hugging = westOf(34, HOME.y);
    displace(world, mob, hugging);
    put(world, "p0", eastOf(34, HOME.y)); // 56 u from the mob, across the fence: inside a sword's reach as the crow flies
    const hpBefore = world.state.players.get("p0")!.hp;
    shoot(world, mob);
    expect(mob.rt.brain!.mode).toBe("fight");

    const modes: string[] = [];
    let maxY = hugging.y;
    let maxX = hugging.x;
    let swings = 0;
    const bad: number[] = [];
    for (let i = 0; i < 20 * 20; i++) {
      const events = step(world, TICK_MS);
      swings += fxOf(events, "swing").filter((fx) => fx.by === mob.id).length;
      const me = pos(world, mob.id);
      maxY = Math.max(maxY, me.y);
      maxX = Math.max(maxX, me.x);
      if (!circleClear(map, me, PLAYER_RADIUS)) bad.push(i);
      const mode = mob.rt.brain!.mode;
      if (modes.at(-1) !== mode) modes.push(mode);
    }
    expect(modes).toEqual(["fight", "return", "idle"]);
    expect(swings).toBe(0); // never a swing at the fence
    expect(world.state.players.get("p0")!.hp).toBe(hpBefore);
    expect(maxY - hugging.y).toBeGreaterThan(40); // it walked the way round (south along the fence), not stood at it
    expect(maxX).toBeLessThan(34 * TILE); // and never crossed
    expect(bad).toEqual([]);
    // Home, whole.
    expect(dist(pos(world, mob.id), HOME)).toBeLessThanOrEqual(MOB_HOME_RADIUS);
    expect(mob.s.hp).toBe(mob.s.maxHp);
  });

  it("gives up by the leash or by MOB_GIVE_UP_SECONDS without having dealt damage, whichever comes first", () => {
    const map = roomMap(TILES, TILES, { low: vertical(34, 2, 57) });
    const world = mobWorld(map);
    const mob = spawn(world, "sentenced");
    displace(world, mob, westOf(34, HOME.y));
    put(world, "p0", eastOf(34, HOME.y));
    shoot(world, mob);
    let at = -1;
    for (let i = 0; i < 20 * 12 && at < 0; i++) {
      step(world, TICK_MS);
      if (mob.rt.brain!.mode === "return") at = i + 1;
    }
    expect(at).toBeGreaterThan(0);
    expect(at * TICK_MS / 1000).toBeLessThanOrEqual(MOB_GIVE_UP_SECONDS + 0.1);
    expect(dist(pos(world, mob.id), HOME)).toBeLessThanOrEqual(MOB_LEASH_RADIUS + 40);
  });

  it("a ranged mob (a bow) shoots across the fence and does not walk round", () => {
    const map = roomMap(TILES, TILES, { low: vertical(34, 2, 57) });
    const world = mobWorld(map);
    const mob = spawn(world, "plague");
    displace(world, mob, westOf(34, HOME.y));
    put(world, "p0", eastOf(34, HOME.y));
    world.state.players.get("p0")!.weapon0 = "";
    shoot(world, mob);
    let shots = 0;
    for (let i = 0; i < 60; i++) {
      const events = step(world, TICK_MS);
      shots += fxOf(events, "projEnd").filter((fx) => fx.reason === "hit").length;
    }
    expect(shots).toBeGreaterThan(0);
    expect(world.state.players.get("p0")!.hp).toBeLessThan(1e9);
  });

  it("a ranged mob's retreat never targets LOW, and it never stands on it", () => {
    // A LOW block west of the camp spot (columns 27..30, rows 28..36): the straight retreat from a player standing close on the
    // east ends on it (160 u and 80 u west of the mob), and the sight mask would let that point through.
    const low = [27, 28, 29, 30].flatMap((tx) => vertical(tx, 28, 36));
    const map = roomMap(TILES, TILES, { low });
    const world = mobWorld(map);
    const mob = spawn(world, "plague");
    put(world, "p0", { x: HOME.x + 60, y: HOME.y });
    world.state.players.get("p0")!.weapon0 = "";
    const targets: Vec2[] = [];
    const q = mob.rt.inputs;
    const push = q.pushMove;
    q.pushMove = (cmd) => { if (cmd.kind === "move") targets.push({ x: cmd.x, y: cmd.y }); push.call(q, cmd); };
    shoot(world, mob);
    const bad: number[] = [];
    for (let i = 0; i < 100; i++) {
      step(world, TICK_MS);
      const me = pos(world, mob.id);
      if (!circleClear(map, me, PLAYER_RADIUS) || tileClassAt(map, me) === TILE_LOW) bad.push(i);
    }
    const retreats = targets.filter((t) => dist(t, HOME) > 1 && dist(t, { x: HOME.x + 60, y: HOME.y }) > 1);
    expect(retreats.length).toBeGreaterThan(0); // the retreat was exercised
    for (const t of targets) {
      expect(circleClear(map, t, PLAYER_RADIUS), `target ${t.x},${t.y}`).toBe(true);
      expect(tileClassAt(map, t)).toBe(TILE_FLOOR);
    }
    expect(bad).toEqual([]);
  });
});

// ---- training ---------------------------------------------------------------------------------------------------------------

describe("the training setup and LOW", () => {
  it("places no dummy and no rack weapon on a LOW tile (nor within a body's reach of one)", () => {
    // LOW on every third diagonal of the band around the spawn, so a good share of the candidate tiles is fence.
    const low: Array<readonly [number, number]> = [];
    for (let ty = 2; ty < 28; ty++) for (let tx = 2; tx < 28; tx++) if ((tx + ty) % 3 === 0) low.push([tx, ty]);
    const spawn = tileCentre(14, 14);
    const map = roomMap(30, 30, { low, spawns: [spawn] });
    expect(map.tiles[14 * 30 + 14]).toBe(TILE_FLOOR); // (14 + 14) % 3 = 1: the spawn stands on floor
    const world = startRun(map, 1, { dummies: true });
    expect(world.state.mobs.size).toBeGreaterThan(0);
    expect(world.state.containers.size).toBeGreaterThanOrEqual(WEAPON_IDS.length);
    const pieces = [...world.state.mobs.values(), ...world.state.containers.values()];
    for (const piece of pieces) {
      expect(circleClear(map, piece, PLAYER_RADIUS), `piece at ${piece.x},${piece.y}`).toBe(true);
      expect(tileClassAt(map, piece), `piece at ${piece.x},${piece.y}`).toBe(TILE_FLOOR);
    }
  });
});

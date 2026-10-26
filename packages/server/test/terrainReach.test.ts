// What a LOW tile (a fence, a lava stream) stops and what it does not (zone terrain, RULING 4): it stops bodies AND melee
// swings; projectiles, sight, signature reach of ranged weapons, target acceptance and abilities pass over it. Every "reach"
// site reads reachMask(weapon): the swing and the swing-vs-ball test (sim/melee.ts), the signature reach (sim/factions.ts) and
// the lock's `clear` test for `decide` (sim/targeting.ts); the lock's `seen` stays plain sight.
//
// The worlds are hand-built rooms (test/terrainWorld.ts) with real inputs, ledger and phases. `MASK_MELEE` is one constant
// in the shared map module; the "flip" cases prove it is the only thing that decides melee's reach, by making reachMask
// answer MASK_SIGHT for every weapon through a mock (the constant itself is never edited). findPath is wrapped to count the
// path searches an order costs.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  circleClear, mulberry32, PLAYER_RADIUS, TERRAIN_LAVA, TICK_MS, TILE, TILE_LOW,
  type FactionId, type FxEvent, type GameMap, type Vec2, type WeaponId,
} from "@raid/shared";
import { combatant, standingCombatants } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { applyLedger } from "../src/sim/ledger";
import { resolveMelee } from "../src/sim/melee";
import { addMob } from "../src/sim/mobs";
import { recordHistory } from "../src/sim/movement";
import { spawnProjectiles, sweepProjectiles } from "../src/sim/projectiles";
import { noteContact, signatureState } from "../src/sim/factions";
import { addPlayer, step } from "../src/sim/step";
import { handleTarget } from "../src/sim/targeting";
import type { MeleeRequest, ProjectileRuntime, SimEvent, World } from "../src/sim/world";
import { eastOf, roomMap, tileClassAt, vertical, westOf } from "./terrainWorld";

const mode = vi.hoisted(() => ({ reachIsSight: false }));
const searches = vi.hoisted(() => ({ n: 0 }));
vi.mock("@raid/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@raid/shared")>();
  return {
    ...mod,
    reachMask: (w: WeaponId | null) => (mode.reachIsSight ? mod.MASK_SIGHT : mod.reachMask(w)),
    findPath: (...args: Parameters<typeof mod.findPath>) => {
      searches.n++;
      return mod.findPath(...args);
    },
  };
});
afterEach(() => { mode.reachIsSight = false; });

type Fx<K extends FxEvent["kind"]> = Extract<FxEvent, { kind: K }>;
const fxOf = <K extends FxEvent["kind"]>(events: SimEvent[], kind: K): Array<Fx<K>> =>
  events.flatMap((e) => (e.type === "fx" && e.fx.kind === kind ? [e.fx as Fx<K>] : []));

const BIG_HP = 1e9;
const PACKET = { raw: 100, phys: 1, magic: 0, true: 0 };

interface Fighter { id: string; faction: FactionId; weapon: WeaponId | ""; at: Vec2; facing?: number }

/** An active run of the given fighters (huge hp, nobody dies) on `map`; long timers keep the arena quiet. */
function arena(fighters: Fighter[], map: GameMap, signatures = false): World {
  const world = createGameWorld({
    seed: 7,
    config: {
      minPlayers: fighters.length, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
      suddenDeathSeconds: 3600,
    },
    random: mulberry32(8),
  }, { signatures });
  world.map = map;
  for (const f of fighters) addPlayer(world, f.id, f.id.toUpperCase(), { faction: f.faction });
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  for (const f of fighters) {
    const p = world.state.players.get(f.id)!;
    p.maxHp = p.hp = BIG_HP;
    p.weapon0 = f.weapon;
    p.weapon1 = "";
    p.slot = 0;
    put(world, f.id, f.at, f.facing);
  }
  return world;
}

/** Moves a fighter and forgets where it was: it has always been here. */
function put(world: World, id: string, at: Vec2, facing?: number): void {
  const c = combatant(world, id)!;
  c.s.x = at.x;
  c.s.y = at.y;
  c.rt.path = [];
  c.rt.history = [{ t: world.state.serverTime, x: at.x, y: at.y }];
  if (facing !== undefined) c.s.facing = facing;
}

const pos = (world: World, id: string): Vec2 => { const c = combatant(world, id)!; return { x: c.s.x, y: c.s.y }; };

// ---- melee -------------------------------------------------------------------------------------------------------------

describe("a melee swing and a LOW tile", () => {
  /** A 24 x 16 room; a one-tile LOW strip at column 12 across it (x 384..416): the two bodies hug its faces, 56 u apart. */
  const FENCE = () => roomMap(24, 16, { low: vertical(12, 1, 14) });
  const OPEN = () => roomMap(24, 16);
  const west = westOf(12, 256);
  const east = eastOf(12, 256);

  /** `weapon` swung by p0 at p1 (east of it, 56 u away); who the swing hit. */
  function victims(map: GameMap, weapon: WeaponId, from: Vec2 = west, to: Vec2 = east): string[] {
    const world = arena([
      { id: "p0", faction: "plague", weapon, at: from, facing: 0 },
      { id: "p1", faction: "holy", weapon: "", at: to, facing: Math.PI },
    ], map);
    world.combat.ledger = [];
    const req: MeleeRequest = { attacker: "p0", weapon, a: Math.atan2(to.y - from.y, to.x - from.x), rewindT: world.state.serverTime, packet: PACKET };
    world.combat.melee = [req];
    resolveMelee(world);
    return world.combat.ledger.map((e) => e.victim).sort();
  }

  it("the bodies hug the strip 56 u apart (the geometry the rest relies on)", () => {
    expect(Math.hypot(east.x - west.x, east.y - west.y)).toBe(56);
    const map = FENCE();
    expect(circleClear(map, west, PLAYER_RADIUS)).toBe(true);
    expect(circleClear(map, east, PLAYER_RADIUS)).toBe(true);
  });

  it.each(["sword", "axe"] as const)("a %s swing lands on open floor at 56 u and does not land across a one-tile LOW strip", (weapon) => {
    expect(victims(OPEN(), weapon)).toEqual(["p1"]);
    expect(victims(FENCE(), weapon)).toEqual([]);
  });

  it("a swing still emits its swing fx when the fence stopped it", () => {
    const world = arena([
      { id: "p0", faction: "plague", weapon: "sword", at: west, facing: 0 },
      { id: "p1", faction: "holy", weapon: "", at: east, facing: Math.PI },
    ], FENCE());
    world.combat.melee = [{ attacker: "p0", weapon: "sword", a: 0, rewindT: world.state.serverTime, packet: PACKET }];
    world.events = [];
    resolveMelee(world);
    expect(fxOf(world.events, "swing")).toHaveLength(1);
    expect(world.combat.ledger).toEqual([]);
  });

  it("a swing is stopped by every LOW kind, lava and crevasse included (the class decides, not the kind)", () => {
    const lava = roomMap(24, 16, { low: vertical(12, 1, 14), kind: TERRAIN_LAVA });
    expect(victims(lava, "sword")).toEqual([]);
    const kindless = roomMap(24, 16, { low: vertical(12, 1, 14), kind: 0 });
    expect(victims(kindless, "sword")).toEqual([]);
  });

  it("a swing past the end of the strip, with a clear line, lands", () => {
    const short = roomMap(24, 16, { low: vertical(12, 1, 6) }); // the strip ends above y 224
    expect(victims(short, "sword")).toEqual(["p1"]);
  });

  it("a wall stops it as ever", () => {
    expect(victims(roomMap(24, 16, { walls: vertical(12, 1, 14) }), "sword")).toEqual([]);
  });

  it("MASK_MELEE is the single switch: with reach read as sight the same swings land across the strip", () => {
    for (const weapon of ["sword", "axe"] as const) {
      expect(victims(FENCE(), weapon), `${weapon} default`).toEqual([]);
      mode.reachIsSight = true;
      expect(victims(FENCE(), weapon), `${weapon} flipped`).toEqual(["p1"]);
      mode.reachIsSight = false;
    }
  });

  describe("a swing meeting a ball (crossesArc)", () => {
    /** p0 swings from the west face; p1 owns a ball flying west toward it from the east side of the strip. */
    function halved(map: GameMap, weapon: "sword" | "axe"): { halved: boolean; destroyed: boolean } {
      const world = arena([
        { id: "p0", faction: "plague", weapon, at: west, facing: 0 },
        { id: "p1", faction: "holy", weapon: "wand", at: { x: 600, y: 420 }, facing: Math.PI },
      ], map);
      world.combat.spawns = [{ owner: "p1", kind: "ball", weapon: "wand", a: Math.PI, packet: PACKET, origin: { x: 440, y: 256 } }];
      spawnProjectiles(world);
      const ball = [...world.projectiles.values()].at(-1)!;
      // One tick of the combat tail, in step.ts order: history, sweep, spawns, melee.
      const s = world.state;
      s.serverTime += TICK_MS;
      s.tick++;
      world.combat.ledger = [];
      for (const c of standingCombatants(world)) recordHistory(c.rt, c.s, s.serverTime);
      sweepProjectiles(world, TICK_MS);
      world.combat.melee = [{ attacker: "p0", weapon, a: 0, rewindT: s.serverTime, packet: PACKET }];
      resolveMelee(world);
      return { halved: ball.halved, destroyed: ball.ended };
    }

    it("a ball in the arc on the far side of a LOW strip is not met (open floor halves a sword's, destroys an axe's)", () => {
      expect(halved(OPEN(), "sword")).toEqual({ halved: true, destroyed: false });
      expect(halved(OPEN(), "axe")).toEqual({ halved: false, destroyed: true });
      expect(halved(FENCE(), "sword")).toEqual({ halved: false, destroyed: false });
      expect(halved(FENCE(), "axe")).toEqual({ halved: false, destroyed: false });
    });

    it("with reach read as sight the swing meets it across the strip", () => {
      mode.reachIsSight = true;
      expect(halved(FENCE(), "sword")).toEqual({ halved: true, destroyed: false });
      expect(halved(FENCE(), "axe")).toEqual({ halved: false, destroyed: true });
    });
  });
});

// ---- projectiles -------------------------------------------------------------------------------------------------------

describe("projectiles over a LOW tile", () => {
  /** 40 x 20, a one-tile strip at column 12 (x 384..416) across it, either LOW or (the control) WALL. */
  const strip = (kind: "low" | "wall") => roomMap(40, 20, kind === "low" ? { low: vertical(12, 1, 18) } : { walls: vertical(12, 1, 18) });
  const SHOT = { raw: 10, phys: 1, magic: 0, true: 0 };
  const Y = 320;

  const archer = (at: Vec2): Fighter => ({ id: "archer", faction: "sentenced", weapon: "bow", at });
  const mage = (at: Vec2): Fighter => ({ id: "mage", faction: "holy", weapon: "wand", at });
  /** Out of every line of fire (y 320), but present, so the run goes on. */
  const bystander = (id: string, x: number): Fighter => ({ id, faction: "frost", weapon: "", at: { x, y: 560 } });
  const body = (at: Vec2): Fighter => ({ id: "body", faction: "fire", weapon: "", at });

  /** The projectile phases of one tick with nothing else (record history, sweep, spawn, ledger). */
  function flyTick(world: World): SimEvent[] {
    const s = world.state;
    s.serverTime += TICK_MS;
    s.tick++;
    for (const c of standingCombatants(world)) recordHistory(c.rt, c.s, s.serverTime);
    world.combat.ledger = [];
    sweepProjectiles(world, TICK_MS);
    spawnProjectiles(world);
    applyLedger(world);
    const out = world.events;
    world.events = [];
    return out;
  }

  function launch(world: World, shots: Array<{ owner: string; kind: "arrow" | "ball"; at: Vec2; a: number }>): ProjectileRuntime[] {
    world.combat.spawns = shots.map((s) => ({
      owner: s.owner, kind: s.kind, weapon: s.kind === "arrow" ? "bow" : "wand", a: s.a, packet: SHOT, origin: s.at,
    }));
    const before = new Set(world.projectiles.keys());
    spawnProjectiles(world);
    return [...world.projectiles.values()].filter((pr) => !before.has(pr.id));
  }

  /** Every projEnd until nothing flies (or 60 ticks), by projectile id. */
  function flyOut(world: World): Map<string, Fx<"projEnd">> {
    const ends = new Map<string, Fx<"projEnd">>();
    for (let i = 0; i < 60 && world.projectiles.size > 0; i++) for (const e of fxOf(flyTick(world), "projEnd")) ends.set(e.id, e);
    return ends;
  }

  it.each(["arrow", "ball"] as const)("%s: crosses a LOW strip and hits a body behind it; the same shot stops at a wall", (kind) => {
    const run = (map: GameMap) => {
      const shooter = kind === "arrow" ? archer({ x: 300, y: Y }) : mage({ x: 300, y: Y });
      const world = arena([shooter, body({ x: 440, y: Y }), bystander("idle", 900)], map);
      const [pr] = launch(world, [{ owner: shooter.id, kind, at: { x: 300, y: Y }, a: 0 }]);
      const end = flyOut(world).get(pr!.id)!;
      return { end, hurt: BIG_HP - world.state.players.get("body")!.hp };
    };
    const low = run(strip("low"));
    expect(low.end.reason).toBe("hit");
    expect(low.end.x).toBeGreaterThan(416);
    expect(low.hurt).toBeGreaterThan(0);

    const wall = run(strip("wall"));
    expect(wall.end.reason).toBe("wall");
    expect(wall.end.x).toBeCloseTo(384, 0);
    expect(wall.hurt).toBe(0);
  });

  it("an arrow with nothing in its line ends by range past the strip, not on it", () => {
    const world = arena([archer({ x: 300, y: Y }), bystander("a", 700), bystander("b", 800)], strip("low"));
    const [pr] = launch(world, [{ owner: "archer", kind: "arrow", at: { x: 300, y: Y }, a: 0 }]);
    const end = flyOut(world).get(pr!.id)!;
    expect(end.reason).toBe("range");
    expect(end.x).toBeCloseTo(300 + 240, 0);
  });

  it("a ball deletes an enemy arrow over LOW (the sight check between them passes); behind a wall it does not", () => {
    // Head-on along y 320: the ball from x 370 (380 u/s), the arrow from x 470 (900 u/s); they meet at about x 400, over the strip.
    const fly = (map: GameMap) => {
      const world = arena([mage({ x: 200, y: 560 }), archer({ x: 700, y: 560 }), bystander("idle", 900)], map);
      const [ball, arrow] = launch(world, [
        { owner: "mage", kind: "ball", at: { x: 370, y: Y }, a: 0 },
        { owner: "archer", kind: "arrow", at: { x: 470, y: Y }, a: Math.PI },
      ]) as [ProjectileRuntime, ProjectileRuntime];
      const ends = flyOut(world);
      return { arrow: ends.get(arrow.id)?.reason, ball: ends.get(ball.id)?.reason, arrowAt: ends.get(arrow.id)?.x };
    };
    const low = fly(strip("low"));
    expect(low.arrow).toBe("deleted");
    expect(low.ball).not.toBe("wall");
    expect(low.arrowAt).toBeGreaterThan(384);
    const wall = fly(strip("wall"));
    expect(wall.arrow).not.toBe("deleted");
    expect(wall.ball).toBe("wall");
  });
});

// ---- signatures --------------------------------------------------------------------------------------------------------

describe("signature reach across a LOW tile follows the weapon in hand", () => {
  /** 24 x 24; a one-tile strip at column 5 (x 160..192): Fire hugs its west face, Holy its east face (56 u). */
  const map = () => roomMap(24, 24, { low: vertical(5, 1, 22) });
  const a = westOf(5, 200);
  const b = eastOf(5, 200);

  function reach(weapon: WeaponId, m: GameMap = map()): { inReach: boolean; engaged: boolean } {
    const world = arena([
      { id: "a", faction: "fire", weapon, at: a },
      { id: "b", faction: "holy", weapon: "", at: b },
    ], m, true);
    noteContact(world, "a", "b");
    step(world, TICK_MS);
    const st = signatureState(world, "a")!;
    return { inReach: st.inReach, engaged: st.engaged };
  }

  it("a melee faction's signature does not engage across a fence; a ranged one does", () => {
    for (const weapon of ["sword", "axe"] as const) expect(reach(weapon), weapon).toEqual({ inReach: false, engaged: false });
    for (const weapon of ["bow", "wand"] as const) expect(reach(weapon), weapon).toEqual({ inReach: true, engaged: true });
  });

  it("the same melee pair on open floor engages", () => {
    expect(reach("sword", roomMap(24, 24))).toEqual({ inReach: true, engaged: true });
  });

  it("with reach read as sight a melee faction engages across the fence", () => {
    mode.reachIsSight = true;
    expect(reach("sword")).toEqual({ inReach: true, engaged: true });
  });
});

// ---- the target lock ---------------------------------------------------------------------------------------------------

describe("the target lock across a LOW fence", () => {
  const FENCE_COL = 20;
  /** 40 x 20; a fence at column 20 (x 640..672), rows 1..13; the gap is rows 14..18. The lock and its target hug it, 56 u apart. */
  const fenceRoom = () => roomMap(40, 20, { low: vertical(FENCE_COL, 1, 13) });
  const wallRoom = () => roomMap(40, 20, { walls: vertical(FENCE_COL, 1, 13) });
  const Y = 176;
  const west = westOf(FENCE_COL, Y);
  const east = eastOf(FENCE_COL, Y);

  function lockWorld(weapon: WeaponId, faction: FactionId, map: GameMap): { world: World; dummy: string } {
    const world = arena([{ id: "p0", faction, weapon, at: west, facing: 0 }], map);
    const dummy = addMob(world, { kind: "dummy", name: "dummy", at: east });
    return { world, dummy };
  }

  const order = (world: World, dummy: string): void => {
    expect(enqueueClientMessage(world.players.get("p0")!.inputs, "target", { id: dummy })).toBe(true);
  };

  interface Trace { swings: number; hits: number; swingsWest: number; hitsWest: number; blocked: number[]; wall: number; seenAll: boolean; lockKept: boolean }

  /** Runs the lock `ticks` ticks, checking on every one that the fighter's disc is off LOW and (move mask) clear. */
  function follow(world: World, dummy: string, ticks: number): Trace {
    const map = world.map;
    const t: Trace = { swings: 0, hits: 0, swingsWest: 0, hitsWest: 0, blocked: [], wall: 0, seenAll: true, lockKept: true };
    const rt = world.players.get("p0")!;
    for (let i = 0; i < ticks; i++) {
      const events = step(world, TICK_MS);
      const me = pos(world, "p0");
      const onWest = me.x < FENCE_COL * TILE;
      for (const fx of fxOf(events, "swing")) if (fx.by === "p0") { t.swings++; if (onWest) t.swingsWest++; }
      for (const fx of fxOf(events, "hit")) if (fx.by === "p0" && fx.id === dummy) { t.hits++; if (onWest) t.hitsWest++; }
      for (const fx of fxOf(events, "projEnd")) if (fx.reason === "wall") t.wall++;
      if (!circleClear(map, me, PLAYER_RADIUS) || tileClassAt(map, me) === TILE_LOW) t.blocked.push(i);
      if (!rt.weapon.lockSeen) t.seenAll = false;
      if (rt.weapon.lock !== dummy) t.lockKept = false;
    }
    return t;
  }

  it("is accepted without a path search, as a target in plain sight; across a wall the order is a search", () => {
    const { world, dummy } = lockWorld("sword", "plague", fenceRoom());
    const c = combatant(world, "p0")!;
    searches.n = 0;
    handleTarget(world, c, { kind: "target", id: dummy });
    expect(searches.n).toBe(0);
    expect(world.players.get("p0")!.weapon.lock).toBe(dummy);
    expect(c.rt.path).toEqual([]);
    expect(world.players.get("p0")!.weapon.lockPlanAt).toBe(-Infinity); // the chase plans on the next upkeep

    const walled = lockWorld("sword", "plague", wallRoom());
    searches.n = 0;
    handleTarget(walled.world, combatant(walled.world, "p0")!, { kind: "target", id: walled.dummy });
    expect(searches.n).toBe(1);
    expect(walled.world.players.get("p0")!.weapon.lock).toBe(walled.dummy);
  });

  it("is seen across the fence: lockSeen is set on the first upkeep, and the lock is not dropped by the grace", () => {
    const { world, dummy } = lockWorld("sword", "plague", fenceRoom());
    order(world, dummy);
    step(world, TICK_MS);
    expect(world.players.get("p0")!.weapon.lockSeen).toBe(true);
    expect(world.players.get("p0")!.weapon.lockLosLostAt).toBe(0);
  });

  it("a bow within its far range stands and shoots across the fence: the arrows fly over it and hit", () => {
    const { world, dummy } = lockWorld("bow", "sentenced", fenceRoom());
    order(world, dummy);
    const t = follow(world, dummy, 60);
    const hp = world.state.mobs.get(dummy)!;
    expect(hp.hp).toBeLessThan(hp.maxHp);
    expect(t.hits).toBeGreaterThan(0);
    expect(t.wall).toBe(0);
    expect(t.blocked).toEqual([]);
    expect(Math.hypot(pos(world, "p0").x - west.x, pos(world, "p0").y - west.y)).toBeLessThan(1); // it stood
    expect(t.seenAll && t.lockKept).toBe(true);
  });

  it("a sword walks the gap round the fence and swings at nothing on the way; then it hits", () => {
    const { world, dummy } = lockWorld("sword", "plague", fenceRoom());
    order(world, dummy);
    const t = follow(world, dummy, 220); // 11 s: about 4 s of walking, then the fight
    expect(t.swingsWest).toBe(0); // not one swing at the fence
    expect(t.swings).toBeGreaterThan(5);
    expect(t.hits).toBeGreaterThan(0);
    expect((t.swings - t.hits) / t.swings).toBeLessThan(0.02);
    expect(t.blocked).toEqual([]); // the disc is clear (move mask) and off LOW on every tick
    expect(t.seenAll && t.lockKept).toBe(true);
    expect(pos(world, "p0").x).toBeGreaterThan(FENCE_COL * TILE + TILE); // it went round
    expect(Math.hypot(pos(world, "p0").x - east.x, pos(world, "p0").y - east.y)).toBeLessThan(80);
  });

  it("an axe does the same", () => {
    const { world, dummy } = lockWorld("axe", "fire", fenceRoom());
    order(world, dummy);
    const t = follow(world, dummy, 220);
    expect(t.swingsWest).toBe(0);
    expect(t.hits).toBeGreaterThan(0);
    expect((t.swings - t.hits) / t.swings).toBeLessThan(0.02);
    expect(t.blocked).toEqual([]);
  });

  it("while it is walking round, the fence blocks the swing but the lock keeps chasing: it neither stands at the fence nor drops", () => {
    const { world, dummy } = lockWorld("sword", "plague", fenceRoom());
    order(world, dummy);
    // The first second: it walks south along the fence face (toward the gap at y 448).
    const t = follow(world, dummy, 20);
    expect(pos(world, "p0").y).toBeGreaterThan(Y + 100);
    expect(t.swings).toBe(0);
    expect(world.players.get("p0")!.weapon.held).toBe(false);
    expect(world.players.get("p0")!.weapon.lock).toBe(dummy);
  });

  it("with reach read as sight (the flip) the sword swings through the fence as soon as it is in reach", () => {
    mode.reachIsSight = true;
    const { world, dummy } = lockWorld("sword", "plague", fenceRoom());
    order(world, dummy);
    const t = follow(world, dummy, 20);
    expect(t.hitsWest).toBeGreaterThan(0);
  });
});

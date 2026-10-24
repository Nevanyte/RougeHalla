// The melee phase (sim/melee.ts): arcs, the shield, lag compensation, stagger, balls. Most tests drive resolveMelee
// with hand-built requests on a hand-built open map, so each case pins one rule (landSwings: the ledger before it is
// applied; tick: the combat tail of a step, with time moving); the "real" ones press the trigger through the input
// queue and run whole steps, so windups, cooldowns and the stagger timings are the real ones.
import { describe, expect, it } from "vitest";
import {
  damagePerHit, damageShares, FACTIONS, mapFromTiles, mitigateShares, mulberry32, pacedFaction, RIPOSTE_SHARE,
  STAGGER_IMMUNITY_SECONDS, SWORD_BALL_SCALE, TICK_MS, TILE_FLOOR, TILE_WALL, WEAPONS,
  type FactionId, type FxEvent, type GameMap, type Vec2, type WeaponId,
} from "@raid/shared";
import { combatant, standingCombatants } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { applyLedger } from "../src/sim/ledger";
import { resolveMelee } from "../src/sim/melee";
import { addMob, type MobSpec } from "../src/sim/mobs";
import { recordHistory } from "../src/sim/movement";
import { spawnProjectiles, sweepProjectiles } from "../src/sim/projectiles";
import { addPlayer, step } from "../src/sim/step";
import type { DamagePacket, LedgerEntry, MeleeRequest, ProjectileRuntime, SimEvent, World } from "../src/sim/world";

type Fx<K extends FxEvent["kind"]> = Extract<FxEvent, { kind: K }>;

const NAMES = ["alice", "bob", "carol", "dave"];
const idOf = (i: number): string => `p${i}`;
const P = (world: World, i: number) => world.state.players.get(idOf(i))!;
const RT = (world: World, i: number) => world.players.get(idOf(i))!;

/** A packet that needs no faction: a plain 100 raw, all physical. */
const PACKET: DamagePacket = { raw: 100, phys: 1, magic: 0, true: 0 };
const DUMMY_HP = 5000;
const deg = (d: number): number => (d * Math.PI) / 180;
const polar = (o: Vec2, dist: number, angleDeg: number): Vec2 => ({
  x: o.x + Math.cos(deg(angleDeg)) * dist, y: o.y + Math.sin(deg(angleDeg)) * dist,
});

// ---- worlds ----------------------------------------------------------------------------------------------------

const MAP_W = 24;
const MAP_H = 16;
const ORIGIN: Vec2 = { x: 300, y: 256 };
/** Out of reach of everything the tests do around ORIGIN. */
const FAR: Vec2 = { x: 700, y: 440 };

/** A walled room of floor, plus any extra wall tiles `[tx, ty]`. */
function openMap(walls: ReadonlyArray<readonly [number, number]> = []): GameMap {
  const tiles = new Uint8Array(MAP_W * MAP_H).fill(TILE_FLOOR);
  for (let x = 0; x < MAP_W; x++) { tiles[x] = TILE_WALL; tiles[(MAP_H - 1) * MAP_W + x] = TILE_WALL; }
  for (let y = 0; y < MAP_H; y++) { tiles[y * MAP_W] = TILE_WALL; tiles[y * MAP_W + MAP_W - 1] = TILE_WALL; }
  for (const [tx, ty] of walls) tiles[ty * MAP_W + tx] = TILE_WALL;
  return mapFromTiles(MAP_W, MAP_H, tiles);
}

interface Spec { faction: FactionId; weapon: WeaponId; at: Vec2; facing?: number; weapon1?: WeaponId; slot?: 0 | 1; hp?: number }
const fighter = (faction: FactionId, weapon: WeaponId, at: Vec2, extra: Partial<Spec> = {}): Spec => ({ faction, weapon, at, ...extra });

/** Moves a fighter (player or mob) and forgets where it was: it has always been here. */
function put(world: World, id: string, at: Vec2, facing?: number): void {
  const c = combatant(world, id)!;
  c.s.x = at.x;
  c.s.y = at.y;
  c.rt.path = [];
  c.rt.history = [{ t: world.state.serverTime, x: at.x, y: at.y }];
  if (facing !== undefined) c.s.facing = facing;
}

/** The fighter's recent positions as `[ms before now, x, y]`, oldest first; the last is where it stands now. */
function trail(world: World, id: string, samples: Array<[number, number, number]>): void {
  const c = combatant(world, id)!;
  const now = world.state.serverTime;
  c.rt.history = samples.map(([ago, x, y]) => ({ t: now - ago, x, y }));
  const last = samples[samples.length - 1]!;
  c.s.x = last[1];
  c.s.y = last[2];
}

/**
 * A run in progress (players p0, p1, ... with the given faction, weapon and place) on a hand-built map. Long timers keep
 * the arena quiet: no teleport, no sudden death.
 */
function arena(specs: Spec[], map: GameMap = openMap()): World {
  const config = {
    minPlayers: specs.length, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 300, patienceMinSeconds: 300,
    suddenDeathSeconds: 60,
  };
  const world = createGameWorld({ seed: 1234, config, random: mulberry32(5) }, { signatures: false });
  specs.forEach((_, i) => addPlayer(world, idOf(i), NAMES[i]!));
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  world.map = map;
  specs.forEach((sp, i) => {
    const p = P(world, i);
    p.faction = sp.faction;
    p.hp = p.maxHp = sp.hp ?? FACTIONS[sp.faction].hp;
    p.weapon0 = sp.weapon;
    p.weapon1 = sp.weapon1 ?? "";
    p.slot = sp.slot ?? 0;
    put(world, idOf(i), sp.at, sp.facing ?? 0);
  });
  return world;
}

function dummy(world: World, at: Vec2, extra: Partial<MobSpec> = {}): string {
  return addMob(world, { kind: "dummy", name: "dummy", at, ...extra });
}
const mob = (world: World, id: string) => world.state.mobs.get(id)!;

// ---- driving the combat phase ------------------------------------------------------------------------------------

interface Swing { by: string; weapon: WeaponId; a: number; lag?: number; packet?: DamagePacket }
interface Landed { ledger: LedgerEntry[]; events: SimEvent[] }

/** `lag` ms before now is the time the attacker's client was drawing (0 = the present). */
function requestsOf(world: World, swings: Swing[]): MeleeRequest[] {
  const now = world.state.serverTime;
  return swings.map((s) => ({
    attacker: s.by, weapon: s.weapon, a: s.a, rewindT: now - (s.lag ?? 0), packet: s.packet ?? PACKET,
  }));
}

/** Resolves swings that land right now and returns what went into the ledger (not yet applied) and what was emitted. */
function landSwings(world: World, swings: Swing[]): Landed {
  world.combat.ledger = [];
  world.combat.melee = requestsOf(world, swings);
  resolveMelee(world);
  expect(world.combat.melee).toEqual([]);
  const events = world.events;
  world.events = [];
  return { ledger: world.combat.ledger, events };
}
const swing = (world: World, by: string, weapon: WeaponId, a: number, extra: Partial<Swing> = {}): Landed =>
  landSwings(world, [{ by, weapon, a, ...extra }]);
const victimsOf = (l: Landed): string[] => l.ledger.map((e) => e.victim).sort();

/**
 * One tick's combat tail, in the order of step.ts (history, projectile sweep, spawns, melee, ledger), without inputs
 * or weapon timers: the swings land now, balls fly 50 ms, and the hits are applied.
 */
function tick(world: World, swings: Swing[] = []): SimEvent[] {
  const s = world.state;
  s.serverTime += TICK_MS;
  s.tick++;
  world.combat.ledger = [];
  world.combat.melee = [];
  world.combat.spawns = [];
  for (const c of standingCombatants(world)) recordHistory(c.rt, c.s, s.serverTime);
  sweepProjectiles(world, TICK_MS);
  spawnProjectiles(world);
  world.combat.melee = requestsOf(world, swings);
  resolveMelee(world);
  applyLedger(world);
  const events = world.events;
  world.events = [];
  return events;
}

function fxOf<K extends FxEvent["kind"]>(events: SimEvent[], kind: K): Array<Fx<K>> {
  return events.flatMap((e) => (e.type === "fx" && e.fx.kind === kind ? [e.fx as Fx<K>] : []));
}

/** A wand ball loosed at `from` toward `a` by `owner` (who need not stand there), as the spawn phase does it. */
function launchBall(world: World, owner: string, from: Vec2, a: number, packet: DamagePacket = PACKET): ProjectileRuntime {
  const c = combatant(world, owner)!;
  const home = { x: c.s.x, y: c.s.y };
  c.s.x = from.x;
  c.s.y = from.y;
  world.combat.spawns = [{ owner, kind: "ball", weapon: "wand", a, packet }];
  spawnProjectiles(world);
  c.s.x = home.x;
  c.s.y = home.y;
  const all = [...world.projectiles.values()];
  return all[all.length - 1]!;
}

// ---- driving real steps ------------------------------------------------------------------------------------------

/**
 * Presses the trigger of player `i` toward `a` and lets go in the same tick: exactly one attack (a bow: a quick tap).
 * The release carries `t` as well: it notes the lag too, so one without would undo the press's.
 */
function tap(world: World, i: number, a: number, t?: number): void {
  const q = RT(world, i).inputs;
  const stamp = t === undefined ? {} : { t };
  enqueueClientMessage(q, "attack", { a, ...stamp });
  enqueueClientMessage(q, "release", { a, ...stamp });
}
/** Presses and holds (a bow draws until released). */
function hold(world: World, i: number, a: number): void {
  enqueueClientMessage(RT(world, i).inputs, "attack", { a });
}
function run(world: World, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...step(world, TICK_MS));
  return out;
}
const hpLost = (world: World, i: number): number => P(world, i).maxHp - P(world, i).hp;

// ---- hit regions --------------------------------------------------------------------------------------------------

/**
 * Reports whether a dummy `dist` u from ORIGIN, `off` degrees off the aim, is hit by `weapon` swung from ORIGIN along
 * `aimDeg`. One world serves every probe.
 */
function reachProbe(weapon: WeaponId, aimDeg = 0): (dist: number, off: number) => boolean {
  const world = arena([fighter("plague", weapon, ORIGIN), fighter("holy", "wand", FAR)]);
  const target = dummy(world, FAR);
  return (dist, off) => {
    put(world, target, polar(ORIGIN, dist, aimDeg + off));
    return victimsOf(swing(world, "p0", weapon, deg(aimDeg))).includes(target);
  };
}

describe("hit regions", () => {
  // Distance is centre to centre; the body (12 u) counts, and the arc is widened by the body's own angular half-width
  // (asin(12 / distance)): at 50 u that is 13.9 degrees, at 40 u 17.5 degrees, at 30 u 23.6 degrees.
  const ARCS: Array<{
    weapon: WeaponId; reach: number; halfArcDeg: number; hit: Array<[number, number]>; miss: Array<[number, number]>;
  }> = [
    {
      weapon: "sword", reach: 64, halfArcDeg: 45,
      hit: [[50, 0], [50, 58], [50, -58], [76, 0], [30, 44], [30, 68]],
      miss: [[50, 60], [50, -60], [76.5, 0], [30, 70], [30, 90], [30, 180]],
    },
    {
      weapon: "axe", reach: 60, halfArcDeg: 90,
      hit: [[40, 0], [40, 90], [40, -90], [40, 105], [30, 90], [72, 0]],
      miss: [[40, 110], [40, -110], [40, 160], [30, 180], [72.5, 0]],
    },
    {
      weapon: "shield", reach: 44, halfArcDeg: 60,
      hit: [[40, 0], [40, 75], [40, -75], [30, 50], [56, 0]],
      miss: [[40, 80], [40, -80], [30, 90], [30, 180], [56.5, 0]],
    },
  ];

  it.each(ARCS)("$weapon: reach and angle, the target's body included", ({ weapon, reach, halfArcDeg, hit, miss }) => {
    expect(WEAPONS[weapon].shape).toEqual({ kind: "arc", reach, halfArc: deg(halfArcDeg) });
    const probe = reachProbe(weapon);
    for (const [dist, off] of hit) expect(probe(dist, off), `${dist} u at ${off} deg should be hit`).toBe(true);
    for (const [dist, off] of miss) expect(probe(dist, off), `${dist} u at ${off} deg should be missed`).toBe(false);
  });

  it("follows the aim at any angle, wrapping across the branch cut", () => {
    for (const aimDeg of [90, -90, 135, 180, 175]) {
      const probe = reachProbe("sword", aimDeg);
      expect(probe(50, 0), `aim ${aimDeg}`).toBe(true);
      expect(probe(50, 40), `aim ${aimDeg}`).toBe(true);
      expect(probe(50, -40), `aim ${aimDeg}`).toBe(true);
      expect(probe(50, 90), `aim ${aimDeg}`).toBe(false);
      expect(probe(50, 180), `aim ${aimDeg}`).toBe(false);
    }
  });

  it("always hits a body that overlaps the attacker, whatever the aim", () => {
    for (const weapon of ["sword", "axe", "shield"] as const) {
      const probe = reachProbe(weapon);
      expect(probe(5, 180), weapon).toBe(true);
      expect(probe(12, 180), weapon).toBe(true);
    }
    expect(reachProbe("sword")(12.5, 180)).toBe(false);
  });

  it("hits a target standing exactly on the attacker", () => {
    const world = arena([fighter("plague", "sword", ORIGIN), fighter("holy", "wand", FAR)]);
    const target = dummy(world, ORIGIN);
    expect(victimsOf(swing(world, "p0", "sword", 0))).toEqual([target]);
  });
});

// ---- who a swing reaches ------------------------------------------------------------------------------------------

describe("who a swing reaches", () => {
  it("cleaves: everyone in the arc is hit, nobody outside it, each exactly once", () => {
    const world = arena([fighter("plague", "axe", ORIGIN), fighter("holy", "wand", FAR)]);
    const a = dummy(world, polar(ORIGIN, 40, 0));
    const b = dummy(world, polar(ORIGIN, 40, 80));
    const c = dummy(world, polar(ORIGIN, 40, -80));
    const behind = dummy(world, polar(ORIGIN, 40, 180));
    const tooFar = dummy(world, polar(ORIGIN, 100, 0));
    const hit = victimsOf(swing(world, "p0", "axe", 0));
    expect(hit).toEqual([a, b, c].sort());
    expect(hit).not.toContain(behind);
    expect(hit).not.toContain(tooFar);
  });

  it("hits players and mobs alike, and never the attacker", () => {
    const world = arena([fighter("plague", "sword", ORIGIN), fighter("holy", "wand", polar(ORIGIN, 40, 10))]);
    const d = dummy(world, polar(ORIGIN, 50, -10));
    expect(victimsOf(swing(world, "p0", "sword", 0))).toEqual(["p1", d].sort());
  });

  it("with nobody else in reach the ledger stays empty", () => {
    const world = arena([fighter("plague", "sword", ORIGIN), fighter("holy", "wand", FAR)]);
    expect(swing(world, "p0", "sword", 0).ledger).toEqual([]);
  });

  it("skips targets that are not standing: dead, down this tick, or a dead mob", () => {
    const world = arena([
      fighter("plague", "sword", ORIGIN), fighter("holy", "wand", polar(ORIGIN, 40, 10)),
      fighter("frost", "shield", polar(ORIGIN, 40, -10)),
    ]);
    const d = dummy(world, polar(ORIGIN, 50, 0));
    const alive = dummy(world, polar(ORIGIN, 30, 20));
    P(world, 1).status = "dead";
    RT(world, 2).down = { outcome: "died" };
    mob(world, d).status = "dead";
    expect(victimsOf(swing(world, "p0", "sword", 0))).toEqual([alive]);
  });

  it("records the request's packet, weapon and attacker; only a sword hit staggers", () => {
    const world = arena([fighter("plague", "sword", ORIGIN), fighter("holy", "wand", FAR)]);
    const d = dummy(world, polar(ORIGIN, 40, 0));
    for (const [weapon, staggers] of [["sword", true], ["axe", false], ["shield", false]] as const) {
      const { ledger } = swing(world, "p0", weapon, 0);
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({
        victim: d, by: { id: "p0", name: "alice" }, packet: PACKET, weapon, stagger: staggers, scale: 1,
      });
      expect(ledger[0]!.projectile).toBeUndefined();
    }
  });

  it("a mob can swing like a player, and is credited by name", () => {
    const world = arena([fighter("plague", "sword", FAR), fighter("holy", "wand", polar(ORIGIN, 40, 0))]);
    const d = dummy(world, ORIGIN, { name: "Ratling", weapon: "sword" });
    const { ledger } = swing(world, d, "sword", 0);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ victim: "p1", by: { id: d, name: "Ratling" }, weapon: "sword" });
  });

  it("ignores a swing whose attacker is gone or down, and a request for a weapon without an arc", () => {
    const world = arena([fighter("plague", "sword", ORIGIN), fighter("holy", "wand", polar(ORIGIN, 40, 0))]);
    const gone = landSwings(world, [{ by: "nobody", weapon: "sword", a: 0 }]);
    expect(gone).toEqual({ ledger: [], events: [] });
    const bow = swing(world, "p0", "bow", 0);
    expect(bow).toEqual({ ledger: [], events: [] });
    RT(world, 0).down = { outcome: "died" };
    P(world, 0).status = "dead";
    expect(swing(world, "p0", "sword", 0)).toEqual({ ledger: [], events: [] });
  });

  it("drains the queue, and with no requests does nothing", () => {
    const world = arena([fighter("plague", "sword", ORIGIN), fighter("holy", "wand", polar(ORIGIN, 40, 0))]);
    expect(landSwings(world, [])).toEqual({ ledger: [], events: [] });
    world.combat.melee = requestsOf(world, [{ by: "p0", weapon: "sword", a: 0 }]);
    resolveMelee(world);
    expect(world.combat.melee).toEqual([]);
    world.combat.ledger = [];
    resolveMelee(world);
    expect(world.combat.ledger).toEqual([]);
  });
});

describe("the swing fx", () => {
  it("is emitted for every swing, hit or miss, from the sampled origin along the aim", () => {
    const world = arena([fighter("plague", "sword", ORIGIN), fighter("holy", "wand", FAR)]);
    const { events } = swing(world, "p0", "sword", 1.25);
    expect(events).toEqual([{ type: "fx", fx: { kind: "swing", by: "p0", weapon: "sword", x: ORIGIN.x, y: ORIGIN.y, a: 1.25 } }]);
  });

  it("comes once per swing and before the swing's block", () => {
    const world = arena([fighter("plague", "sword", ORIGIN), fighter("holy", "wand", FAR)]);
    const holder = dummy(world, polar(ORIGIN, 40, 0), { weapon: "shield", facing: Math.PI });
    const { events } = landSwings(world, [
      { by: "p0", weapon: "sword", a: 0 },
      { by: "p1", weapon: "sword", a: 0 },
    ]);
    expect(fxOf(events, "swing").map((f) => f.by)).toEqual(["p0", "p1"]);
    expect(fxOf(events, "block")).toEqual([{ kind: "block", id: holder, by: "p0", weapon: "sword" }]);
    expect(events.findIndex((e) => e.type === "fx" && e.fx.kind === "swing")).toBeLessThan(
      events.findIndex((e) => e.type === "fx" && e.fx.kind === "block"),
    );
  });
});

// ---- walls --------------------------------------------------------------------------------------------------------

describe("walls", () => {
  // Tile (3, 6) spans x 96..128, y 192..224. The attacker stands at (80, 200), 16 u west of it.
  const attacker: Spec = fighter("plague", "sword", { x: 80, y: 200 });

  it("a wall tile between the attacker and a target in the arc blocks the hit", () => {
    const open = arena([attacker, fighter("holy", "wand", FAR)]);
    const walled = arena([attacker, fighter("holy", "wand", FAR)], openMap([[3, 6]]));
    const a = dummy(open, { x: 140, y: 200 });
    dummy(walled, { x: 140, y: 200 });
    expect(victimsOf(swing(open, "p0", "sword", 0))).toEqual([a]);
    expect(swing(walled, "p0", "sword", 0).ledger).toEqual([]);
  });

  it("a wall off the line of the hit, or behind the target, blocks nothing", () => {
    const beside = arena([attacker, fighter("holy", "wand", FAR)], openMap([[3, 4], [3, 8], [5, 6]]));
    const d = dummy(beside, { x: 140, y: 200 });
    expect(victimsOf(swing(beside, "p0", "sword", 0))).toEqual([d]);
  });

  it("one wall shields only the targets behind it", () => {
    const world = arena([attacker, fighter("holy", "wand", FAR)], openMap([[3, 6]]));
    const behindWall = dummy(world, { x: 140, y: 200 });
    const clear = dummy(world, { x: 112, y: 166 });
    const hit = victimsOf(swing(world, "p0", "sword", deg(-20)));
    expect(hit).toContain(clear);
    expect(hit).not.toContain(behindWall);
  });

  it("closed coliseum gates block the hit, open ones do not", () => {
    const map = openMap();
    map.coliseum.gates = [{ side: "e", tiles: [{ x: 5, y: 6 }], x: 176, y: 208 }];
    const world = arena([fighter("plague", "sword", { x: 140, y: 208 }), fighter("holy", "wand", FAR)], map);
    const d = dummy(world, { x: 212, y: 208 });
    expect(victimsOf(swing(world, "p0", "sword", 0))).toEqual([d]);
    world.state.gatesLocked = true;
    expect(swing(world, "p0", "sword", 0).ledger).toEqual([]);
  });
});

// ---- what I saw is what I hit ------------------------------------------------------------------------------------

describe("lag compensation", () => {
  it("hits a target where the attacker saw it, not where it is now", () => {
    const world = arena([fighter("plague", "sword", ORIGIN), fighter("holy", "wand", FAR)]);
    const d = dummy(world, FAR);
    trail(world, d, [[100, 340, 256], [0, 340, 400]]);
    expect(victimsOf(swing(world, "p0", "sword", 0, { lag: 100 }))).toEqual([d]);
    expect(swing(world, "p0", "sword", 0).ledger).toEqual([]);
  });

  it("misses a target that has only just stepped into the arc", () => {
    const world = arena([fighter("plague", "sword", ORIGIN), fighter("holy", "wand", FAR)]);
    const d = dummy(world, FAR);
    trail(world, d, [[100, 340, 400], [0, 340, 256]]);
    expect(swing(world, "p0", "sword", 0, { lag: 100 }).ledger).toEqual([]);
    expect(victimsOf(swing(world, "p0", "sword", 0))).toEqual([d]);
  });

  it("samples the attacker at the same time: the swing fx and the reach come from where it was drawn", () => {
    const world = arena([fighter("plague", "sword", ORIGIN), fighter("holy", "wand", FAR)]);
    const d = dummy(world, { x: 140, y: 256 });
    trail(world, "p0", [[100, 100, 256], [0, 300, 256]]);
    const seen = swing(world, "p0", "sword", 0, { lag: 100 });
    expect(victimsOf(seen)).toEqual([d]);
    expect(fxOf(seen.events, "swing")[0]).toMatchObject({ x: 100, y: 256 });
    const present = swing(world, "p0", "sword", 0);
    expect(present.ledger).toEqual([]);
    expect(fxOf(present.events, "swing")[0]).toMatchObject({ x: 300, y: 256 });
  });

  it("interpolates between recorded ticks", () => {
    const world = arena([fighter("plague", "sword", ORIGIN), fighter("holy", "wand", FAR)]);
    const d = dummy(world, FAR);
    // 200 u apart at the two samples, so only the midpoint (on top of the attacker) is in reach.
    trail(world, d, [[100, 300, 156], [0, 300, 356]]);
    expect(victimsOf(swing(world, "p0", "sword", 0, { lag: 50 }))).toEqual([d]);
    expect(swing(world, "p0", "sword", 0, { lag: 100 }).ledger).toEqual([]);
    expect(swing(world, "p0", "sword", 0, { lag: 0 }).ledger).toEqual([]);
  });

  it("tests walls on the line between the sampled positions, with today's walls", () => {
    const world = arena([fighter("plague", "sword", { x: 80, y: 200 }), fighter("holy", "wand", FAR)], openMap([[3, 6]]));
    const d = dummy(world, FAR);
    // Now at (130, 170) the line is clear; where it was seen, (140, 200), the wall tile (3, 6) was in between.
    trail(world, d, [[100, 140, 200], [0, 130, 170]]);
    expect(victimsOf(swing(world, "p0", "sword", deg(-30)))).toEqual([d]);
    expect(swing(world, "p0", "sword", deg(-30), { lag: 100 }).ledger).toEqual([]);
  });

  it("a shield is tested at the sampled positions of both fighters", () => {
    const world = arena([fighter("plague", "sword", ORIGIN), fighter("holy", "wand", FAR)]);
    const holder = dummy(world, { x: 340, y: 256 }, { weapon: "shield", facing: Math.PI });
    // Drawn in front of the shield (west of it) but now behind it: the shield was in the way.
    trail(world, "p0", [[100, 300, 256], [0, 380, 256]]);
    const seen = swing(world, "p0", "sword", 0, { lag: 100 });
    expect(fxOf(seen.events, "block")).toHaveLength(1);
    expect(seen.ledger.map((e) => e.victim)).toEqual(["p0"]);
    // And the other way round: drawn behind the shield, standing in front of it now.
    trail(world, "p0", [[100, 380, 256], [0, 300, 256]]);
    const behind = swing(world, "p0", "sword", Math.PI, { lag: 100 });
    expect(fxOf(behind.events, "block")).toEqual([]);
    expect(victimsOf(behind)).toEqual([holder]);
  });

  it("an attack's own timestamp sets the rewind (real input, real windup)", () => {
    const run1 = (withT: boolean): { world: World; d: string } => {
      const world = arena([fighter("plague", "sword", ORIGIN), fighter("holy", "wand", FAR)]);
      const d = dummy(world, { x: 340, y: 256 });
      // The press lands in the step at 100 ms; the swing lands at 200 ms and is drawn where the client saw it at 100 ms.
      tap(world, 0, 0, withT ? 0 : undefined);
      run(world, 1);
      mob(world, d).y = 400;
      run(world, 2);
      return { world, d };
    };
    const seen = run1(true);
    expect(mob(seen.world, seen.d).hp).toBeLessThan(DUMMY_HP);
    const unlagged = run1(false);
    expect(mob(unlagged.world, unlagged.d).hp).toBe(DUMMY_HP);
  });
});

// ---- the shield ---------------------------------------------------------------------------------------------------

describe("shield", () => {
  const HOLDER: Vec2 = { x: 340, y: 256 };
  /** p0 swings from the west at a shield holder (a dummy) facing it. */
  function front(extra: Partial<MobSpec> = {}): { world: World; holder: string } {
    const world = arena([fighter("plague", "sword", ORIGIN), fighter("holy", "wand", FAR)]);
    return { world, holder: dummy(world, HOLDER, { weapon: "shield", facing: Math.PI, ...extra }) };
  }

  it("negates a frontal sword hit, deals half of it back, credited to the holder, with no stagger", () => {
    const { world, holder } = front();
    const packet: DamagePacket = { raw: 100, phys: 0.8, magic: 0.2, true: 0 };
    const { ledger, events } = swing(world, "p0", "sword", 0, { packet });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      victim: "p0", by: { id: holder, name: "dummy" }, weapon: "shield", stagger: false, scale: 1,
      packet: { raw: 100 * RIPOSTE_SHARE, phys: 0.8, magic: 0.2, true: 0 },
    });
    expect(fxOf(events, "block")).toEqual([{ kind: "block", id: holder, by: "p0", weapon: "sword" }]);
    expect(packet.raw).toBe(100);
  });

  it("negates a frontal bash outright", () => {
    const { world, holder } = front();
    const { ledger, events } = swing(world, "p0", "shield", 0);
    expect(ledger).toEqual([]);
    expect(fxOf(events, "block")).toEqual([{ kind: "block", id: holder, by: "p0", weapon: "shield" }]);
  });

  it("is pierced by an axe: a normal hit, no block", () => {
    const { world, holder } = front();
    const { ledger, events } = swing(world, "p0", "axe", 0);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ victim: holder, by: { id: "p0" }, weapon: "axe", stagger: false });
    expect(fxOf(events, "block")).toEqual([]);
  });

  it("a sword hit from behind lands, staggering", () => {
    const { world, holder } = front({ facing: 0 });
    const { ledger, events } = swing(world, "p0", "sword", 0);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ victim: holder, weapon: "sword", stagger: true });
    expect(fxOf(events, "block")).toEqual([]);
  });

  it("covers 60 degrees either side of where it faces, edge included", () => {
    const world = arena([fighter("plague", "sword", ORIGIN), fighter("holy", "wand", FAR)]);
    dummy(world, HOLDER, { weapon: "shield", facing: 0 });
    const blocked = (offDeg: number): boolean => {
      put(world, "p0", polar(HOLDER, 40, offDeg));
      const { ledger, events } = swing(world, "p0", "sword", deg(offDeg + 180));
      return fxOf(events, "block").length === 1 && ledger.every((e) => e.victim === "p0");
    };
    for (const off of [0, 30, 59, -59, 60, -60]) expect(blocked(off), `${off} deg`).toBe(true);
    for (const off of [61, -61, 90, 135, 180]) expect(blocked(off), `${off} deg`).toBe(false);
  });

  it("treats a hit from exactly the holder's position as frontal", () => {
    const { world } = front({ facing: 0 });
    put(world, "p0", HOLDER);
    const { ledger, events } = swing(world, "p0", "sword", 0);
    expect(fxOf(events, "block")).toHaveLength(1);
    expect(ledger.map((e) => e.victim)).toEqual(["p0"]);
  });

  it("only blocks while the shield is in hand", () => {
    const { world, holder } = front();
    const m = mob(world, holder);
    m.weapon1 = "sword";
    m.slot = 1;
    const { ledger, events } = swing(world, "p0", "sword", 0);
    expect(ledger.map((e) => e.victim)).toEqual([holder]);
    expect(fxOf(events, "block")).toEqual([]);
    m.slot = 0;
    expect(fxOf(swing(world, "p0", "sword", 0).events, "block")).toHaveLength(1);
  });

  it("blocks the targets it covers and lets the rest of a cleave through", () => {
    const { world, holder } = front();
    const plain = dummy(world, polar(ORIGIN, 40, 30));
    const { ledger, events } = swing(world, "p0", "sword", 0);
    expect(fxOf(events, "block").map((f) => f.id)).toEqual([holder]);
    expect(ledger.map((e) => `${e.victim}:${e.weapon}`).sort()).toEqual([`${plain}:sword`, "p0:shield"].sort());
  });

  it("a player holding a shield blocks like a dummy does", () => {
    const world = arena([fighter("plague", "sword", ORIGIN), fighter("frost", "shield", HOLDER, { facing: Math.PI })]);
    const { ledger, events } = swing(world, "p0", "sword", 0);
    expect(fxOf(events, "block")).toEqual([{ kind: "block", id: "p1", by: "p0", weapon: "sword" }]);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ victim: "p0", by: { id: "p1", name: "bob" }, weapon: "shield", stagger: false });
  });

  it("neither a block nor the riposte staggers anyone", () => {
    const world = arena([
      fighter("plague", "sword", ORIGIN), fighter("frost", "shield", HOLDER, { facing: Math.PI }), fighter("holy", "wand", FAR),
    ]);
    const events = tick(world, [{ by: "p0", weapon: "sword", a: 0 }]);
    expect(fxOf(events, "stagger")).toEqual([]);
    expect(RT(world, 0).weapon.staggerImmuneUntil).toBe(0);
    expect(RT(world, 1).weapon.staggerImmuneUntil).toBe(0);
    expect(hpLost(world, 1)).toBe(0);
    expect(hpLost(world, 0)).toBeGreaterThan(0);
  });
});

// ---- stagger ------------------------------------------------------------------------------------------------------

describe("sword stagger, through real windups", () => {
  // Both press in the first step (100 ms). The sword lands at 200 ms (windup 0.1 s), the axe at 350 ms (0.25 s), the
  // wand's ball leaves at 300 ms (0.2 s).
  const FACING_WEST = Math.PI;

  it("an axe windup left alone lands at 250 ms (the baseline the next test cancels)", () => {
    const world = arena([fighter("fire", "axe", ORIGIN), fighter("plague", "sword", polar(ORIGIN, 40, 0))]);
    tap(world, 0, 0);
    run(world, 5);
    expect(hpLost(world, 1)).toBe(0);
    run(world, 1);
    expect(hpLost(world, 1)).toBeGreaterThan(0);
  });

  it("cancels an axe windup: the axe never lands", () => {
    const world = arena([fighter("fire", "axe", ORIGIN), fighter("plague", "sword", polar(ORIGIN, 40, 0))]);
    tap(world, 0, 0);
    tap(world, 1, FACING_WEST);
    const events = run(world, 8);
    expect(hpLost(world, 0)).toBeGreaterThan(0);
    expect(hpLost(world, 1)).toBe(0);
    expect(fxOf(events, "stagger")).toEqual([{ kind: "stagger", id: "p0" }]);
    expect(fxOf(events, "swing").map((f) => f.weapon)).toEqual(["sword"]);
    expect(RT(world, 0).weapon.action).toBeNull();
  });

  it("restarts a bow draw, which carries on", () => {
    const world = arena([fighter("sentenced", "bow", ORIGIN), fighter("plague", "sword", polar(ORIGIN, 40, 0))]);
    hold(world, 0, 0);
    run(world, 1);
    expect(P(world, 0).drawStartedAt).toBe(100);
    tap(world, 1, FACING_WEST); // pressed at 150 ms, lands at 250 ms
    run(world, 3);
    expect(world.state.serverTime).toBe(250);
    expect(P(world, 0).drawStartedAt).toBe(250);
    expect(RT(world, 0).weapon.action).toMatchObject({ kind: "draw", startedAt: 250 });
    expect(hpLost(world, 0)).toBeGreaterThan(0);
  });

  it("cancels a wand cast: no ball leaves", () => {
    const world = arena([fighter("holy", "wand", ORIGIN), fighter("plague", "sword", polar(ORIGIN, 40, 0))]);
    tap(world, 0, 0);
    tap(world, 1, FACING_WEST);
    run(world, 8);
    expect(world.projectiles.size).toBe(0);
    expect(world.state.projectiles.size).toBe(0);
  });

  it("the same cast, left alone, does loose its ball at 300 ms", () => {
    const world = arena([fighter("holy", "wand", ORIGIN), fighter("plague", "sword", polar(ORIGIN, 40, 0))]);
    tap(world, 0, 0);
    run(world, 4);
    expect(world.projectiles.size).toBe(0);
    run(world, 1);
    expect(world.projectiles.size).toBe(1);
  });

  it("an axe or a bash hit staggers nobody", () => {
    for (const weapon of ["axe", "shield"] as const) {
      const world = arena([fighter("plague", weapon, ORIGIN), fighter("sentenced", "bow", polar(ORIGIN, 40, 0))]);
      hold(world, 1, 0);
      run(world, 1);
      const events = tick(world, [{ by: "p0", weapon, a: 0 }]);
      expect(hpLost(world, 1), weapon).toBeGreaterThan(0);
      expect(fxOf(events, "stagger"), weapon).toEqual([]);
      expect(P(world, 1).drawStartedAt, weapon).toBe(100);
    }
  });
});

describe("stagger immunity", () => {
  /** A drawing archer at 40 u from p0, whose draw restarts whenever a sword stagger lands. */
  function archerWorld(): World {
    const world = arena([fighter("plague", "sword", ORIGIN), fighter("sentenced", "bow", polar(ORIGIN, 40, 0))]);
    const now = world.state.serverTime;
    RT(world, 1).weapon.action = { kind: "draw", weapon: "bow", startedAt: now };
    P(world, 1).drawStartedAt = now;
    return world;
  }
  const hitIt = (world: World): SimEvent[] => tick(world, [{ by: "p0", weapon: "sword", a: 0 }]);

  it("lasts half a second: hits inside it still hurt but do not restart the draw", () => {
    expect(STAGGER_IMMUNITY_SECONDS * 1000).toBe(500);
    const world = archerWorld();
    const first = hitIt(world);
    const t0 = world.state.serverTime;
    expect(fxOf(first, "stagger")).toHaveLength(1);
    expect(P(world, 1).drawStartedAt).toBe(t0);
    let lost = hpLost(world, 1);
    // A hit every tick for the next 450 ms.
    for (let ms = 50; ms <= 450; ms += 50) {
      const events = hitIt(world);
      expect(world.state.serverTime).toBe(t0 + ms);
      expect(fxOf(events, "stagger"), `${ms} ms`).toEqual([]);
      expect(P(world, 1).drawStartedAt, `${ms} ms`).toBe(t0);
      expect(hpLost(world, 1), `${ms} ms`).toBeGreaterThan(lost);
      lost = hpLost(world, 1);
    }
  });

  it("is over exactly 500 ms after the stagger", () => {
    const world = archerWorld();
    hitIt(world);
    const t0 = world.state.serverTime;
    for (let i = 0; i < 8; i++) tick(world);
    expect(fxOf(hitIt(world), "stagger")).toEqual([]); // t0 + 450
    expect(world.state.serverTime).toBe(t0 + 450);
    const again = hitIt(world); // t0 + 500
    expect(world.state.serverTime).toBe(t0 + 500);
    expect(fxOf(again, "stagger")).toHaveLength(1);
    expect(P(world, 1).drawStartedAt).toBe(t0 + 500);
  });

  it("two swordsmen landing on one target in the same tick stagger it once", () => {
    const world = arena([
      fighter("plague", "sword", ORIGIN), fighter("sentenced", "bow", polar(ORIGIN, 40, 0)),
      fighter("plague", "sword", polar(ORIGIN, 40, 30)),
    ]);
    const events = tick(world, [{ by: "p0", weapon: "sword", a: 0 }, { by: "p2", weapon: "sword", a: Math.PI }]);
    expect(fxOf(events, "stagger").filter((f) => f.id === "p1")).toHaveLength(1);
  });

  it("a hit that does no damage (teleport immunity) does not stagger", () => {
    const world = archerWorld();
    P(world, 1).immuneUntil = world.state.serverTime + 1000;
    const before = P(world, 1).drawStartedAt;
    const events = hitIt(world);
    expect(hpLost(world, 1)).toBe(0);
    expect(fxOf(events, "stagger")).toEqual([]);
    expect(fxOf(events, "hit")).toEqual([]);
    expect(P(world, 1).drawStartedAt).toBe(before);
    expect(RT(world, 1).weapon.staggerImmuneUntil).toBe(0);
    // Once the immunity is over the same hit staggers.
    P(world, 1).immuneUntil = 0;
    expect(fxOf(hitIt(world), "stagger")).toHaveLength(1);
  });
});

// ---- balls --------------------------------------------------------------------------------------------------------

describe("balls", () => {
  /** p0 swings from ORIGIN; p1 (a caster far away) owns the balls. */
  function ballWorld(): World {
    return arena([fighter("plague", "sword", ORIGIN), fighter("holy", "wand", { x: 650, y: 420 })]);
  }
  const SWORD: Swing = { by: "p0", weapon: "sword", a: 0 };

  it("a sword swing halves a ball in its arc, and the ball keeps the smaller packet", () => {
    const world = ballWorld();
    const ball = launchBall(world, "p1", { x: 330, y: 256 }, 0);
    const events = tick(world, [SWORD]);
    expect(ball.halved).toBe(true);
    expect(ball.packet).toEqual({ ...PACKET, raw: 100 * SWORD_BALL_SCALE });
    expect(ball.ended).toBe(false);
    expect(fxOf(events, "projEnd")).toEqual([]);
  });

  it("the halved ball then deals half damage when it lands", () => {
    const world = ballWorld();
    const target = dummy(world, { x: 420, y: 256 });
    launchBall(world, "p1", { x: 330, y: 256 }, 0);
    tick(world, [SWORD]);
    for (let i = 0; i < 8 && mob(world, target).hp === DUMMY_HP; i++) tick(world);
    expect(DUMMY_HP - mob(world, target).hp).toBeCloseTo(50, 9);
  });

  it("halves a ball once however many swings meet it, in one tick or over several", () => {
    const world = arena([
      fighter("plague", "sword", ORIGIN), fighter("holy", "wand", { x: 650, y: 420 }), fighter("plague", "sword", { x: 300, y: 300 }),
    ]);
    const ball = launchBall(world, "p1", { x: 330, y: 256 }, 0);
    const second: Swing = { by: "p2", weapon: "sword", a: Math.atan2(256 - 300, 330 - 300) };
    tick(world, [SWORD, second]);
    expect(ball.packet.raw).toBe(50);
    tick(world, [SWORD]); // the ball is still in this arc: 349 -> 368
    expect(ball.packet.raw).toBe(50);
  });

  it("an axe swing destroys a ball: it stops, says why, and hurts nobody", () => {
    const world = ballWorld();
    const target = dummy(world, { x: 420, y: 256 });
    const ball = launchBall(world, "p1", { x: 330, y: 256 }, 0);
    const events = tick(world, [{ ...SWORD, weapon: "axe" }]);
    expect(ball.ended).toBe(true);
    expect(world.projectiles.has(ball.id)).toBe(false);
    expect(world.state.projectiles.has(ball.id)).toBe(false);
    expect(fxOf(events, "projEnd")).toHaveLength(1);
    expect(fxOf(events, "projEnd")[0]).toMatchObject({ id: ball.id, proj: "ball", reason: "destroyed" });
    for (let i = 0; i < 10; i++) tick(world);
    expect(mob(world, target).hp).toBe(DUMMY_HP);
  });

  it("a bash does nothing to a ball", () => {
    const world = ballWorld();
    const ball = launchBall(world, "p1", { x: 330, y: 256 }, 0);
    const events = tick(world, [{ ...SWORD, weapon: "shield" }]);
    expect(ball.ended).toBe(false);
    expect(ball.halved).toBe(false);
    expect(ball.packet).toBe(PACKET);
    expect(fxOf(events, "projEnd")).toEqual([]);
  });

  it("ignores the attacker's own balls", () => {
    const world = ballWorld();
    const own = launchBall(world, "p0", { x: 330, y: 256 }, 0);
    const events = tick(world, [{ ...SWORD, weapon: "axe" }]);
    expect(own.ended).toBe(false);
    expect(own.halved).toBe(false);
    expect(fxOf(events, "projEnd")).toEqual([]);
  });

  it("meets the arc out to its reach plus the ball's own radius (66 u for the sword)", () => {
    for (const [x, met] of [[366, true], [366.5, false], [330, true], [250, false]] as const) {
      const world = ballWorld();
      const ball = launchBall(world, "p1", { x, y: 256 }, 0);
      landSwings(world, [SWORD]); // loosed this tick: a point
      expect(ball.halved, `ball at ${x}`).toBe(met);
    }
  });

  it("follows the arc's angle: the axe's half circle, the sword's quarter, nothing behind", () => {
    const side = { x: 300, y: 296 };
    const back = { x: 270, y: 256 };
    const outcome = (weapon: WeaponId, at: Vec2): boolean => {
      const world = ballWorld();
      const ball = launchBall(world, "p1", at, 0);
      landSwings(world, [{ ...SWORD, weapon }]);
      return ball.ended || ball.halved;
    };
    expect(outcome("axe", side)).toBe(true);
    expect(outcome("sword", side)).toBe(false);
    expect(outcome("axe", back)).toBe(false);
    expect(outcome("sword", back)).toBe(false);
  });

  it("meets a ball that crosses the arc during the tick, even if both ends of its path are outside it", () => {
    // The ball flies 19 u down the line x = 365.5, which clips the rim of the sword's reach for under 17 u in the middle.
    const crossing = (x: number): ProjectileRuntime => {
      const world = ballWorld();
      const ball = launchBall(world, "p1", { x, y: 246.5 }, Math.PI / 2);
      tick(world, [SWORD]);
      expect(ball.x).toBeCloseTo(x, 6);
      expect(ball.y).toBeCloseTo(265.5, 6);
      return ball;
    };
    expect(crossing(365.5).halved).toBe(true);
    expect(crossing(367).halved).toBe(false);
  });

  it("meets a ball only with a clear line from the attacker: a one-tile wall hides a ball in the arc from a sword or an axe", () => {
    // The wall is tile (10, 8): x 320..352, y 256..288. p0 stands west of it; the ball flies north just behind it, in the arc.
    const outcome = (weapon: WeaponId, walls: ReadonlyArray<readonly [number, number]>) => {
      const world = arena([fighter("plague", "sword", { x: 300, y: 272 }), fighter("holy", "wand", { x: 650, y: 420 })], openMap(walls));
      const ball = launchBall(world, "p1", { x: 358, y: 281 }, -Math.PI / 2);
      tick(world, [{ by: "p0", weapon, a: 0 }]);
      return { halved: ball.halved, ended: ball.ended };
    };
    expect(outcome("sword", [[10, 8]])).toEqual({ halved: false, ended: false });
    expect(outcome("axe", [[10, 8]])).toEqual({ halved: false, ended: false });
    // The same ball in the open, or with the wall off the line, is halved by the sword and destroyed by the axe.
    expect(outcome("sword", [])).toEqual({ halved: true, ended: false });
    expect(outcome("axe", [])).toEqual({ halved: false, ended: true });
    expect(outcome("sword", [[10, 5]])).toEqual({ halved: true, ended: false });
    expect(outcome("axe", [[10, 5]])).toEqual({ halved: false, ended: true });
  });

  it("flies in present time: the arc for balls is the attacker's present one, though targets are rewound", () => {
    const world = ballWorld();
    const seen = dummy(world, { x: 140, y: 256 });
    trail(world, "p0", [[100, 100, 256], [0, 300, 256]]);
    const nearNow = launchBall(world, "p1", { x: 330, y: 256 }, 0);
    const nearThen = launchBall(world, "p1", { x: 130, y: 256 }, 0);
    const { ledger } = landSwings(world, [{ ...SWORD, lag: 100 }]);
    expect(ledger.map((e) => e.victim)).toEqual([seen]);
    expect(nearNow.halved).toBe(true);
    expect(nearThen.halved).toBe(false);
  });

  it("one swing can hit a body and halve a ball", () => {
    const world = ballWorld();
    const body = dummy(world, polar(ORIGIN, 40, 20));
    const ball = launchBall(world, "p1", { x: 330, y: 256 }, Math.PI / 2);
    const { ledger } = landSwings(world, [SWORD]);
    expect(ledger.map((e) => e.victim)).toEqual([body]);
    expect(ball.halved).toBe(true);
  });

  describe("a ball that already hit the swordsman in this same tick", () => {
    // The ball flies west from (360, 256) and reaches the dummy at (330, 256) within the tick; the dummy swings east.
    function crossfire(weapon: WeaponId): { world: World; target: string; ball: ProjectileRuntime; events: SimEvent[] } {
      const world = ballWorld();
      const target = dummy(world, { x: 330, y: 256 });
      const ball = launchBall(world, "p1", { x: 360, y: 256 }, Math.PI);
      const events = tick(world, [{ by: target, weapon, a: 0 }]);
      return { world, target, ball, events };
    }

    it("a bash leaves the hit alone", () => {
      const { world, target, ball } = crossfire("shield");
      expect(DUMMY_HP - mob(world, target).hp).toBeCloseTo(100, 9);
      expect(ball.halved).toBe(false);
    });

    it("a sword halves the hit through the ledger", () => {
      const { world, target, ball, events } = crossfire("sword");
      expect(DUMMY_HP - mob(world, target).hp).toBeCloseTo(50, 9);
      expect(ball.halved).toBe(true);
      expect(fxOf(events, "hit").filter((f) => f.id === target).map((f) => f.amount)).toEqual([50]);
    });

    it("an axe cancels it: no damage, no hit number, and the ball's end stays a hit", () => {
      const { world, target, events } = crossfire("axe");
      expect(mob(world, target).hp).toBe(DUMMY_HP);
      expect(fxOf(events, "hit")).toEqual([]);
      expect(fxOf(events, "projEnd").map((f) => f.reason)).toEqual(["hit"]);
    });
  });
});

describe("balls in real fights", () => {
  // p0 (Holy, wand) at 300 casts east at 100 ms; its ball leaves at 300 ms and reaches p1, 60 u away, in the step at
  // 450 ms, where it would hit. p1 swings back west: a sword pressed at 300 ms lands at 400 ms (windup 0.1 s), Fire's
  // axe pressed at 150 ms lands at 400 ms and one pressed at 200 ms lands at 450 ms (windup 0.25 s; Plague's axe is
  // quicker, a quarter of its short interval, so it would land before the ball exists).
  const SWINGER: Vec2 = { x: 360, y: 256 };
  /** The step (1 = 100 ms) at whose start p1 presses, or null for never. */
  function fight(faction: FactionId, weapon: WeaponId, pressAtStep: number | null): { world: World; events: SimEvent[] } {
    const world = arena([fighter("holy", "wand", ORIGIN), fighter(faction, weapon, SWINGER)]);
    const events: SimEvent[] = [];
    tap(world, 0, 0);
    for (let n = 1; n <= 9; n++) {
      if (n === pressAtStep) tap(world, 1, Math.PI);
      events.push(...run(world, 1));
    }
    return { world, events };
  }

  it("p1 takes the full ball when it does not swing", () => {
    const { world, events } = fight("plague", "sword", null);
    expect(hpLost(world, 1)).toBeGreaterThan(0);
    expect(fxOf(events, "projEnd").map((f) => f.reason)).toEqual(["hit"]);
  });

  it("a sword that lands before the ball does halves its damage", () => {
    const full = hpLost(fight("plague", "sword", null).world, 1);
    const { world } = fight("plague", "sword", 5);
    expect(hpLost(world, 1)).toBeCloseTo(full * SWORD_BALL_SCALE, 9);
  });

  it("an axe that lands before the ball does destroys it", () => {
    expect(hpLost(fight("fire", "axe", null).world, 1)).toBeGreaterThan(0);
    const { world, events } = fight("fire", "axe", 2);
    expect(hpLost(world, 1)).toBe(0);
    expect(world.projectiles.size).toBe(0);
    expect(fxOf(events, "projEnd").map((f) => f.reason)).toEqual(["destroyed"]);
  });

  it("an axe that lands in the very step the ball hits cancels that hit", () => {
    const { world, events } = fight("fire", "axe", 3);
    expect(hpLost(world, 1)).toBe(0);
    expect(hpLost(world, 0)).toBeGreaterThan(0); // the axe still reached the caster
    expect(fxOf(events, "projEnd").map((f) => f.reason)).toEqual(["hit"]);
    expect(fxOf(events, "hit").filter((f) => f.id === "p1")).toEqual([]);
  });
});

// ---- exact numbers ------------------------------------------------------------------------------------------------

describe("damage through the faction formula", () => {
  // Fire's axe: rate 0.6 x hit 150 x DUEL_PACE 2 x dpsMult 0.9 x interval 1 / (0.6 x 1.4) = 96.43 x 2 = 192.857 raw, all
  // magic. It lands 250 ms after the press: the sixth step.
  const FIRE_AXE = 162 / 0.84;
  const SWORD_PLAGUE = 40 / 2.15;

  it("Fire's axe on a dummy does 192.857 and moves nobody", () => {
    const world = arena([fighter("fire", "axe", ORIGIN), fighter("holy", "wand", FAR)]);
    const d = dummy(world, polar(ORIGIN, 40, 0));
    tap(world, 0, 0);
    const events = run(world, 6);
    expect(DUMMY_HP - mob(world, d).hp).toBeCloseTo(FIRE_AXE, 9);
    expect(FIRE_AXE).toBeCloseTo(192.857, 3);
    expect(fxOf(events, "hit")).toEqual([{ kind: "hit", id: d, by: "p0", amount: expect.closeTo(FIRE_AXE, 9), weapon: "axe" }]);
    run(world, 10);
    expect({ x: mob(world, d).x, y: mob(world, d).y }).toEqual(polar(ORIGIN, 40, 0));
    expect({ x: P(world, 0).x, y: P(world, 0).y }).toEqual(ORIGIN);
  });

  it("Fire's axe on Frost is cut by Frost's shield (100): 96.43", () => {
    const world = arena([fighter("fire", "axe", ORIGIN), fighter("frost", "wand", polar(ORIGIN, 40, 0))]);
    tap(world, 0, 0);
    run(world, 6);
    expect(hpLost(world, 1)).toBeCloseTo(96.4286, 3);
  });

  it("the axe pierces Frost's raised shield for the same 96.43", () => {
    const world = arena([fighter("fire", "axe", ORIGIN), fighter("frost", "shield", polar(ORIGIN, 40, 0), { facing: Math.PI })]);
    tap(world, 0, 0);
    const events = run(world, 6);
    expect(hpLost(world, 1)).toBeCloseTo(96.4286, 3);
    expect(fxOf(events, "block")).toEqual([]);
  });

  it("Plague's sword (80% physical, 20% magic) on a dummy does 18.605, on Frost 9.302", () => {
    const world = arena([fighter("plague", "sword", ORIGIN), fighter("frost", "wand", polar(ORIGIN, 40, 0))]);
    const d = dummy(world, polar(ORIGIN, 40, 20));
    tap(world, 0, 0);
    run(world, 3); // lands at 200 ms
    expect(DUMMY_HP - mob(world, d).hp).toBeCloseTo(SWORD_PLAGUE, 9);
    expect(hpLost(world, 1)).toBeCloseTo(SWORD_PLAGUE / 2, 9); // armor 100 and shield 100 both halve it
    expect(SWORD_PLAGUE).toBeCloseTo(18.6047, 4);
  });

  it("Frost's bash on Demon Blood (shield 250, armor 0): 90% physical, 10% magic", () => {
    const world = arena([fighter("frost", "shield", ORIGIN), fighter("holy", "wand", polar(ORIGIN, 40, 0))]);
    tap(world, 0, 0);
    run(world, 3);
    expect(hpLost(world, 1)).toBeCloseTo(84.375 * (0.9 + 0.1 / 3.5), 9);
    expect(hpLost(world, 1)).toBeCloseTo(78.3482, 3);
  });

  it("a sword into a raised shield: the holder takes nothing, the swordsman 50% of his own hit through his own defense", () => {
    const world = arena([fighter("plague", "sword", ORIGIN), fighter("frost", "shield", polar(ORIGIN, 40, 0), { facing: Math.PI })]);
    tap(world, 0, 0);
    const events = run(world, 3);
    // Plague: armor 200 on its 80% physical, no shield on its 20% magic.
    const riposte = SWORD_PLAGUE * RIPOSTE_SHARE * (0.8 / 3 + 0.2);
    expect(hpLost(world, 0)).toBeCloseTo(riposte, 9);
    expect(riposte).toBeCloseTo(4.3411, 4);
    expect(hpLost(world, 1)).toBe(0);
    expect(fxOf(events, "hit")).toEqual([{ kind: "hit", id: "p0", by: "p1", amount: expect.closeTo(riposte, 9), weapon: "shield" }]);
    expect(fxOf(events, "stagger")).toEqual([]);
  });

  it("agrees with damagePerHit and mitigateShares for every melee faction x weapon x defender", () => {
    for (const weapon of ["sword", "axe", "shield"] as const) {
      for (const atk of ["fire", "plague", "frost", "holy"] as const) {
        for (const dfn of ["plague", "frost", "holy"] as const) {
          const world = arena([fighter(atk, weapon, ORIGIN), fighter(dfn, "wand", polar(ORIGIN, 30, 0))]);
          const f = pacedFaction(FACTIONS[atk]);
          const packet: DamagePacket = { raw: damagePerHit(f, weapon), ...damageShares(f) };
          // Through the real packet builder: a press, then a run long enough for the slowest windup.
          tap(world, 0, 0);
          run(world, 7);
          const def = pacedFaction(FACTIONS[dfn]);
          expect(hpLost(world, 1), `${atk} ${weapon} on ${dfn}`).toBeCloseTo(mitigateShares(packet.raw, packet, def), 9);
        }
      }
    }
  });
});

// ---- simultaneity -------------------------------------------------------------------------------------------------

describe("simultaneous swings", () => {
  it("two swords hitting each other in the same tick both land and both stagger", () => {
    const world = arena([fighter("plague", "sword", ORIGIN), fighter("plague", "sword", polar(ORIGIN, 40, 0))]);
    tap(world, 0, 0);
    tap(world, 1, Math.PI);
    const events = run(world, 3);
    const each = SWORD_PLAGUE_VS_PLAGUE;
    expect(hpLost(world, 0)).toBeCloseTo(each, 9);
    expect(hpLost(world, 1)).toBeCloseTo(each, 9);
    expect(fxOf(events, "stagger").map((f) => f.id).sort()).toEqual(["p0", "p1"]);
  });

  it("a fighter that another swing staggers in the same tick still lands its own axe", () => {
    const world = arena([fighter("plague", "sword", ORIGIN), fighter("fire", "axe", polar(ORIGIN, 40, 0)), fighter("holy", "wand", FAR)]);
    const events = tick(world, [{ by: "p0", weapon: "sword", a: 0 }, { by: "p1", weapon: "axe", a: Math.PI }]);
    expect(fxOf(events, "stagger").map((f) => f.id)).toEqual(["p1"]);
    expect(hpLost(world, 0)).toBeGreaterThan(0);
    expect(hpLost(world, 1)).toBeGreaterThan(0);
  });

  it("two fighters that kill each other in the same tick both die from it", () => {
    const world = arena([
      fighter("plague", "sword", ORIGIN, { hp: 1 }), fighter("plague", "sword", polar(ORIGIN, 40, 0), { hp: 1 }),
      fighter("holy", "wand", FAR),
    ]);
    tap(world, 0, 0);
    tap(world, 1, Math.PI);
    run(world, 3);
    expect(P(world, 0).status).toBe("dead");
    expect(P(world, 1).status).toBe("dead");
    expect(P(world, 0).kills).toBe(1);
    expect(P(world, 1).kills).toBe(1);
  });

  it("the outcome does not depend on the order of the requests", () => {
    const build = (): World => {
      const world = arena([
        fighter("plague", "sword", ORIGIN), fighter("fire", "axe", polar(ORIGIN, 40, 60)), fighter("frost", "shield", polar(ORIGIN, 40, -60)),
      ]);
      dummy(world, polar(ORIGIN, 30, 0), { weapon: "shield", facing: Math.PI });
      dummy(world, polar(ORIGIN, 45, 90));
      return world;
    };
    const swings: Swing[] = [
      { by: "p0", weapon: "sword", a: deg(30) },
      { by: "p1", weapon: "axe", a: deg(-150) },
      { by: "p2", weapon: "shield", a: deg(-100) },
    ];
    const canon = (l: Landed): string[] =>
      [...l.ledger.map((e) => JSON.stringify(e)), ...l.events.map((e) => JSON.stringify(e))].sort();
    const forward = canon(landSwings(build(), swings));
    const backward = canon(landSwings(build(), [...swings].reverse()));
    expect(forward.length).toBeGreaterThan(6);
    expect(backward).toEqual(forward);
  });
});

/** Plague's sword on a Plague body: 18.605 raw, 80% physical through armor 200, 20% magic through shield 0. */
const SWORD_PLAGUE_VS_PLAGUE = (40 / 2.15) * (0.8 / 3 + 0.2);

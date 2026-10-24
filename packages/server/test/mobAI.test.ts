import { describe, expect, it } from "vitest";
import {
  hasLineOfSight, inArc, mapFromTiles, MOB_AIM_DEADBAND, MOB_GIVE_UP_SECONDS, MOB_HOME_RADIUS, MOB_LEASH_RADIUS, MOB_REPATH_MS, mulberry32, PLAYER_RADIUS, POLICIES,
  TICK_MS, TILE, TILE_FLOOR, TILE_WALL, WEAPONS, type FactionId, type GameMap, type WeaponId,
} from "@raid/shared";
import { downPlayer } from "../src/sim/arena";
import { combatant, standingCombatants } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { aggro, install, resetMob, thinkMobs } from "../src/sim/mobAI";
import { hurtMob, placeMob, type MobCombatant } from "../src/sim/mobLife";
import { positionAt } from "../src/sim/movement";
import { addPlayer, removePlayer, step } from "../src/sim/step";
import { createWorld, type MeleeRequest, type SimConfig, type SimEvent, type World } from "../src/sim/world";

// ---------------------------------------------------------------------------------------------------------------------
// Rig: a game world on a small open hand-built map, a raid in progress, and passive players (no weapon, huge hp) that the
// mobs fight. The AI is woken by `aggro` directly, or by `shoot` (a hit through the real ledger and mobLife.hurtMob), and
// its effects are read from the world.
// ---------------------------------------------------------------------------------------------------------------------

const TILES = 64;
const tile = (tx: number, ty: number) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
/** The camp spot of most tests: the middle of the open map, so a mob has room to retreat in every direction. */
const HOME = tile(32, 32);
const MOB_SPEED = 170;

/** An open arena with a wall border. `cells` are single floor tiles sealed off by walls on all eight sides. */
function arenaMap(cells: Array<{ tx: number; ty: number }> = []): GameMap {
  const tiles = new Uint8Array(TILES * TILES).fill(TILE_FLOOR);
  for (let i = 0; i < TILES; i++) {
    tiles[i] = TILE_WALL;
    tiles[(TILES - 1) * TILES + i] = TILE_WALL;
    tiles[i * TILES] = TILE_WALL;
    tiles[i * TILES + TILES - 1] = TILE_WALL;
  }
  for (const c of cells) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx !== 0 || dy !== 0) tiles[(c.ty + dy) * TILES + c.tx + dx] = TILE_WALL;
  }
  return { ...mapFromTiles(TILES, TILES, tiles), spawns: [tile(6, 6), tile(8, 6), tile(10, 6), tile(12, 6), tile(14, 6), tile(16, 6)] };
}

interface Rig { world: World; swings: MeleeRequest[]; events: SimEvent[] }

/** `players` players p0, p1, ... in an active raid. They have no weapon and 1e9 hp, and stand far from HOME until moved. */
function makeRig(opts: { players?: number; map?: GameMap; seed?: number; patience?: number } = {}): Rig {
  const n = opts.players ?? 1;
  const patience = opts.patience ?? 3600;
  const config: SimConfig = {
    minPlayers: n, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: patience, patienceMinSeconds: patience, suddenDeathSeconds: 60,
  };
  const world = createGameWorld({ seed: 7, config, random: mulberry32(opts.seed ?? 99) });
  world.map = opts.map ?? arenaMap();
  for (let i = 0; i < n; i++) addPlayer(world, `p${i}`, `player${i}`);
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  for (let i = 0; i < n; i++) {
    const p = world.state.players.get(`p${i}`)!;
    p.weapon0 = "";
    p.hp = p.maxHp = 1e9;
    put(world, `p${i}`, 200 + 40 * i, 200);
  }
  const rig: Rig = { world, swings: [], events: [] };
  landSwingsLocally(rig);
  return rig;
}

function put(world: World, id: string, x: number, y: number): void {
  const p = world.state.players.get(id)!;
  const rt = world.players.get(id)!;
  p.x = x;
  p.y = y;
  rt.path = [];
  rt.history = [{ t: world.state.serverTime, x, y }];
}

/** Moves a mob away from its camp spot, as if it had been pushed there. */
function displace(world: World, m: MobCombatant, x: number, y: number): void {
  m.s.x = x;
  m.s.y = y;
  m.rt.path = [];
  m.rt.history = [{ t: world.state.serverTime, x, y }];
}

function walk(world: World, id: string, x: number, y: number): void {
  enqueueClientMessage(world.players.get(id)!.inputs, "move", { x, y });
}

function spawn(world: World, region: FactionId, at = HOME, facing = 0): MobCombatant {
  return combatant(world, placeMob(world, { region, elite: false, at, facing })) as MobCombatant;
}

const brain = (m: MobCombatant) => m.rt.brain!;
const hpOf = (world: World, id: string) => world.state.players.get(id)!.hp;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function run(rig: Rig, ticks: number, each?: (tick: number) => void): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    each?.(i);
    out.push(...step(rig.world, TICK_MS));
  }
  rig.events.push(...out);
  return out;
}

const hitsOn = (events: SimEvent[], victim: string) =>
  events.flatMap((e) => (e.type === "fx" && e.fx.kind === "hit" && e.fx.id === victim ? [e.fx] : []));

/**
 * A hit on a mob from player `shooter`, through the real path (recordHit, applyLedger, hurtMob, aggro) and outside any
 * tick. True damage, so the mob's armor does not blur the numbers. Returns the hp it took.
 */
function shoot(world: World, shooter: string, mob: MobCombatant, amount: number): number {
  const before = mob.s.hp;
  recordHit(world, {
    victim: mob.id, by: { id: shooter, name: world.state.players.get(shooter)!.name },
    packet: { raw: amount, phys: 0, magic: 0, true: 1 }, weapon: "bow", stagger: false,
  });
  applyLedger(world);
  return before - mob.s.hp;
}

interface Logged { at: number; kind: string; x?: number; y?: number; a?: number }

/** Records every input the AI pushes into the mob's queue (and still passes it on). */
function spy(world: World, m: MobCombatant): Logged[] {
  const log: Logged[] = [];
  const q = m.rt.inputs;
  const { pushMove, pushAim, pushAction } = q;
  q.pushMove = (cmd) => { log.push({ at: world.state.serverTime, ...cmd }); pushMove.call(q, cmd); };
  q.pushAim = (a) => { log.push({ at: world.state.serverTime, kind: "aim", a }); pushAim.call(q, a); };
  q.pushAction = (cmd) => { log.push({ at: world.state.serverTime, ...cmd }); pushAction.call(q, cmd); };
  return log;
}

const moves = (log: Logged[]) => log.filter((l) => l.kind === "move");

/**
 * packages/server/src/sim/melee.ts is still a stub in this tree, so no swing would ever land. Until it is implemented
 * this stands in for it: a swing becomes ledger hits on every standing fighter inside its arc (the contract in melee.ts,
 * without shields or stagger, which nothing here uses), and the swing is recorded. Once melee.ts lands the real hits come
 * on top, which only makes the damage assertions easier.
 */
function landSwingsLocally(rig: Rig): void {
  const { world } = rig;
  const land = (r: MeleeRequest): void => {
    rig.swings.push(r);
    const shape = WEAPONS[r.weapon].shape;
    const att = combatant(world, r.attacker);
    if (!att || shape.kind !== "arc") return;
    const from = positionAt(att.rt, att.s, r.rewindT);
    for (const t of standingCombatants(world)) {
      if (t.id === r.attacker) continue;
      if (!inArc(from, r.a, shape.reach, shape.halfArc, positionAt(t.rt, t.s, r.rewindT), PLAYER_RADIUS)) continue;
      recordHit(world, { victim: t.id, by: { id: att.id, name: att.s.name }, packet: r.packet, weapon: r.weapon, stagger: false });
    }
  };
  let list: MeleeRequest[] = [];
  const watch = (v: MeleeRequest[]): MeleeRequest[] => {
    v.push = (...items: MeleeRequest[]) => { items.forEach(land); return items.length; };
    return v;
  };
  Object.defineProperty(world.combat, "melee", { configurable: true, get: () => list, set: (v: MeleeRequest[]) => { list = watch(v); } });
  list = watch(list);
}

const REGIONS: ReadonlyArray<readonly [FactionId, WeaponId]> = [
  ["sentenced", "sword"], ["fire", "axe"], ["frost", "shield"], ["plague", "bow"], ["holy", "wand"],
];

// ---------------------------------------------------------------------------------------------------------------------

describe("idle mobs", () => {
  it("send no inputs and do not move, with a player right next to them", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "sentenced");
    put(rig.world, "p0", HOME.x + 30, HOME.y);
    const log = spy(rig.world, mob);
    run(rig, 200);
    expect(log).toEqual([]);
    expect(brain(mob).mode).toBe("idle");
    expect({ x: mob.s.x, y: mob.s.y }).toEqual(HOME);
    expect(hpOf(rig.world, "p0")).toBe(1e9);
  });

  it("cost no input pushes at all for sixty mobs", () => {
    const rig = makeRig();
    const logs = Array.from({ length: 60 }, (_, i) => {
      const m = spawn(rig.world, REGIONS[i % REGIONS.length]![0], tile(8 + (i % 20), 20 + Math.floor(i / 20) * 4));
      return spy(rig.world, m);
    });
    put(rig.world, "p0", tile(10, 21).x, tile(10, 21).y);
    run(rig, 50);
    expect(logs.flat()).toEqual([]);
  });

  it("are cheap to think about: sixty idle mobs take well under a millisecond a tick", () => {
    const rig = makeRig();
    for (let i = 0; i < 60; i++) spawn(rig.world, REGIONS[i % REGIONS.length]![0], tile(8 + (i % 20), 20 + Math.floor(i / 20) * 4));
    thinkMobs(rig.world, TICK_MS);
    const calls = 2000;
    const t0 = performance.now();
    for (let i = 0; i < calls; i++) thinkMobs(rig.world, TICK_MS);
    // Real cost is a few microseconds; the bound is 25 times that of a slow machine and only catches real regressions.
    expect((performance.now() - t0) / calls).toBeLessThan(0.05);
  });

  it("are installed as a system", () => {
    const world = createWorld({
      seed: 1, random: mulberry32(1),
      config: { minPlayers: 1, lobbySeconds: 1, fillSeconds: 0, patienceSeconds: 60, patienceMinSeconds: 60, suddenDeathSeconds: 60 },
    });
    install(world);
    expect(world.systems).toEqual([thinkMobs]);
    expect(createGameWorld({
      seed: 1, random: mulberry32(1),
      config: { minPlayers: 1, lobbySeconds: 1, fillSeconds: 0, patienceSeconds: 60, patienceMinSeconds: 60, suddenDeathSeconds: 60 },
    }).systems.filter((s) => s === thinkMobs)).toHaveLength(1);
  });

  it("do nothing once dead, whatever mode they were in", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "sentenced");
    put(rig.world, "p0", HOME.x + 100, HOME.y);
    aggro(rig.world, mob, "p0", 5);
    run(rig, 3);
    const log = spy(rig.world, mob);
    mob.s.status = "dead";
    run(rig, 20);
    expect(log).toEqual([]);
  });
});

describe("aggro", () => {
  it("wakes an idle mob onto the player who hurt it, and sends its first move at once", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "sentenced");
    put(rig.world, "p0", HOME.x + 150, HOME.y);
    const log = spy(rig.world, mob);
    const now = rig.world.state.serverTime;
    aggro(rig.world, mob, "p0", 10);
    expect(brain(mob).mode).toBe("fight");
    expect(brain(mob).target).toBe("p0");
    expect(brain(mob).threat.get("p0")).toBe(10);
    expect(brain(mob).lastCombatAt).toBe(now);
    run(rig, 1);
    expect(moves(log)).toEqual([{ at: now + TICK_MS, kind: "move", x: HOME.x + 150, y: HOME.y }]);
    // ...and so does its first aim, even though the target is dead ahead of where it already faced (0).
    expect(log.filter((l) => l.kind === "aim")).toEqual([{ at: now + TICK_MS, kind: "aim", a: 0 }]);
    run(rig, 1);
    expect(mob.rt.path.length).toBeGreaterThan(0);
    expect(mob.s.x).toBeGreaterThan(HOME.x);
  });

  it("turns on the player with the most threat, not the last one or the nearest", () => {
    const rig = makeRig({ players: 3 });
    const mob = spawn(rig.world, "sentenced");
    put(rig.world, "p0", HOME.x + 40, HOME.y);
    put(rig.world, "p1", HOME.x, HOME.y + 150);
    put(rig.world, "p2", HOME.x - 120, HOME.y);
    aggro(rig.world, mob, "p0", 10);
    expect(brain(mob).target).toBe("p0");
    // A second hit while fighting only adds threat: the target stays until it is no longer valid.
    aggro(rig.world, mob, "p1", 500);
    aggro(rig.world, mob, "p2", 100);
    expect(brain(mob).target).toBe("p0");
    expect([...brain(mob).threat]).toEqual([["p0", 10], ["p1", 500], ["p2", 100]]);
    aggro(rig.world, mob, "p0", 5);
    expect(brain(mob).threat.get("p0")).toBe(15);
  });

  it("wakes onto the highest threat, even one standing beyond the leash", () => {
    const rig = makeRig({ players: 3 });
    const mob = spawn(rig.world, "sentenced");
    put(rig.world, "p0", HOME.x + 100, HOME.y);
    put(rig.world, "p1", HOME.x - 150, HOME.y);
    // p2 hurts it from outside the leash (a bow's reach is longer than the leash) with the most damage.
    put(rig.world, "p2", HOME.x, HOME.y + MOB_LEASH_RADIUS + 60);
    brain(mob).threat.set("p2", 900);
    brain(mob).threat.set("p0", 5);
    aggro(rig.world, mob, "p1", 30);
    expect(brain(mob).mode).toBe("fight");
    expect(brain(mob).target).toBe("p2");
  });

  it("answers a hit from beyond the leash: it goes for the shooter, gives up at the leash edge and walks home", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "sentenced");
    put(rig.world, "p0", HOME.x + MOB_LEASH_RADIUS + 120, HOME.y);
    aggro(rig.world, mob, "p0", 10);
    expect(brain(mob).mode).toBe("fight");
    expect(brain(mob).target).toBe("p0");
    let farthest = 0;
    for (let i = 0; i < 400; i++) {
      run(rig, 1);
      farthest = Math.max(farthest, Math.hypot(mob.s.x - HOME.x, mob.s.y - HOME.y));
    }
    // It ran out toward the shooter but never past the leash (plus the step that crossed it), then went home.
    expect(farthest).toBeGreaterThan(MOB_LEASH_RADIUS * 0.5);
    expect(farthest).toBeLessThan(MOB_LEASH_RADIUS + 20);
    expect(brain(mob).mode).toBe("idle");
    expect({ x: mob.s.x, y: mob.s.y }).toEqual(HOME);
  });

  it("ignores a dead mob, a returning mob, no damage, other mobs and people who are not in the room", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "sentenced");
    const other = spawn(rig.world, "holy", tile(40, 40));
    put(rig.world, "p0", HOME.x + 100, HOME.y);
    aggro(rig.world, mob, "p0", 0);
    aggro(rig.world, mob, "p0", -3);
    aggro(rig.world, mob, "p0", Number.NaN);
    aggro(rig.world, mob, other.id, 50);
    aggro(rig.world, mob, "nobody", 50);
    expect(brain(mob).mode).toBe("idle");
    expect(brain(mob).threat.size).toBe(0);

    const b = brain(mob);
    b.mode = "return";
    aggro(rig.world, mob, "p0", 50);
    expect(b.mode).toBe("return");
    expect(b.threat.size).toBe(0);
    expect(b.target).toBeNull();

    b.mode = "idle";
    mob.s.status = "dead";
    aggro(rig.world, mob, "p0", 50);
    expect(b.mode).toBe("idle");
    expect(b.threat.size).toBe(0);
  });

  it("does not let a mob, or someone who left, add threat to a mob that is already fighting", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "sentenced");
    const other = spawn(rig.world, "holy", tile(40, 40));
    put(rig.world, "p0", HOME.x + 100, HOME.y);
    aggro(rig.world, mob, "p0", 10);
    run(rig, 2);
    const before = brain(mob).lastCombatAt;
    aggro(rig.world, mob, other.id, 99);
    aggro(rig.world, mob, "gone", 99);
    expect([...brain(mob).threat.keys()]).toEqual(["p0"]);
    expect(brain(mob).lastCombatAt).toBe(before);
  });

  it("does nothing for a mob without a brain (a training dummy)", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "sentenced");
    mob.rt.brain = undefined;
    put(rig.world, "p0", HOME.x + 100, HOME.y);
    expect(() => aggro(rig.world, mob, "p0", 10)).not.toThrow();
    expect(() => resetMob(rig.world, mob)).not.toThrow();
    expect(() => run(rig, 5)).not.toThrow();
  });
});

describe("melee mobs", () => {
  it.each([["sentenced", "sword"], ["fire", "axe"], ["frost", "shield"]] as const)(
    "a %s mob (%s) walks up to its target, turns to it and keeps hitting it",
    (region, weapon) => {
      const rig = makeRig();
      const mob = spawn(rig.world, region);
      put(rig.world, "p0", HOME.x + 200, HOME.y);
      aggro(rig.world, mob, "p0", 10);
      const events = run(rig, 100);
      const hits = hitsOn(events, "p0");
      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(hits[0]!.by).toBe(mob.id);
      expect(hits[0]!.weapon).toBe(weapon);
      expect(hpOf(rig.world, "p0")).toBeLessThan(1e9);
      expect(rig.swings.length).toBeGreaterThanOrEqual(1);
      expect(rig.swings.every((s) => s.attacker === mob.id && s.weapon === weapon)).toBe(true);
      // It stands where the weapon reaches and keeps swinging; it does not run into the player.
      const pol = POLICIES[weapon];
      expect(dist(mob.s, rig.world.state.players.get("p0")!)).toBeLessThanOrEqual(pol.attackRange);
      expect(dist(mob.s, rig.world.state.players.get("p0")!)).toBeGreaterThan(PLAYER_RADIUS);
      expect(Math.abs(mob.s.facing)).toBeLessThan(0.05);
      expect(brain(mob).mode).toBe("fight");
      run(rig, 100);
      expect(hitsOn(rig.events, "p0").length).toBeGreaterThanOrEqual(hits.length + 1);
    },
  );

  it("lets go of the trigger when its target walks out of reach, and follows", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "sentenced");
    put(rig.world, "p0", HOME.x + 60, HOME.y);
    aggro(rig.world, mob, "p0", 10);
    const log = spy(rig.world, mob);
    run(rig, 20);
    expect(brain(mob).holding).toBe(true);
    const x = mob.s.x;
    walk(rig.world, "p0", HOME.x + 400, HOME.y);
    // It follows on its own repath schedule: within MOB_REPATH_MS of the target leaving, plus a tick or two to act on it.
    run(rig, MOB_REPATH_MS / TICK_MS + 4);
    expect(log.filter((l) => l.kind === "attack" || l.kind === "release").map((l) => l.kind)).toEqual(["attack", "release"]);
    expect(brain(mob).holding).toBe(false);
    expect(mob.s.x).toBeGreaterThan(x + 20);
  });

  /** Rotates `p0` about the mob by `deg` degrees (keeping its distance), so its bearing from the mob moves by that much. */
  function turnTarget(rig: Rig, mob: MobCombatant, deg: number): void {
    const p = rig.world.state.players.get("p0")!;
    const d = dist(mob.s, p);
    const a = Math.atan2(p.y - mob.s.y, p.x - mob.s.x) + (deg * Math.PI) / 180;
    put(rig.world, "p0", mob.s.x + d * Math.cos(a), mob.s.y + d * Math.sin(a));
  }
  const DEADBAND_DEG = (MOB_AIM_DEADBAND * 180) / Math.PI;

  it("aims at once, then re-aims only when its target has moved past the deadband", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "sentenced");
    put(rig.world, "p0", HOME.x, HOME.y + 100);
    const log = spy(rig.world, mob);
    const woke = rig.world.state.serverTime;
    aggro(rig.world, mob, "p0", 10);
    run(rig, 1);
    // The first aim goes out on the first think, straight at the target.
    expect(log.filter((l) => l.kind === "aim")).toEqual([{ at: woke + TICK_MS, kind: "aim", a: Math.PI / 2 }]);
    expect(brain(mob).lastAim).toBe(Math.PI / 2);

    // It walks up and swings with the target dead ahead: nothing new to say about where it faces.
    run(rig, 14);
    expect(mob.rt.path).toEqual([]);
    expect(log.some((l) => l.kind === "attack")).toBe(true);
    expect(log.filter((l) => l.kind === "aim")).toHaveLength(1);

    // A nudge inside the deadband is not worth a message, however long it lasts...
    turnTarget(rig, mob, DEADBAND_DEG * 0.5);
    run(rig, 10);
    expect(log.filter((l) => l.kind === "aim")).toHaveLength(1);
    // ...but past it, the new aim goes out on the next think, and is measured from there.
    turnTarget(rig, mob, DEADBAND_DEG * 0.8);
    run(rig, 1);
    const aims = log.filter((l) => l.kind === "aim");
    expect(aims).toHaveLength(2);
    const p = rig.world.state.players.get("p0")!;
    expect(aims[1]!.a).toBeCloseTo(Math.atan2(p.y - mob.s.y, p.x - mob.s.x), 9);
    expect(Math.abs(aims[1]!.a! - Math.PI / 2)).toBeGreaterThanOrEqual(MOB_AIM_DEADBAND);
    expect(brain(mob).lastAim).toBe(aims[1]!.a);
    run(rig, 10);
    expect(log.filter((l) => l.kind === "aim")).toHaveLength(2);
    // Rotating back the other way crosses the deadband from the new aim, not from the first.
    turnTarget(rig, mob, -DEADBAND_DEG * 1.5);
    run(rig, 1);
    expect(log.filter((l) => l.kind === "aim")).toHaveLength(3);
  });

  it("aims a swing exactly, even when the angle is inside the deadband", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "sentenced");
    put(rig.world, "p0", HOME.x, HOME.y + 100);
    const log = spy(rig.world, mob);
    aggro(rig.world, mob, "p0", 10);
    run(rig, 15);
    expect(brain(mob).holding).toBe(true);
    expect(log.filter((l) => l.kind === "aim")).toHaveLength(1);
    // The target backs off out of reach and the trigger comes up...
    const at = (deg: number, d: number) => {
      const a = Math.PI / 2 + (deg * Math.PI) / 180;
      put(rig.world, "p0", mob.s.x + d * Math.cos(a), mob.s.y + d * Math.sin(a));
    };
    at(0, 400);
    run(rig, 2);
    expect(brain(mob).holding).toBe(false);
    // ...and comes back one degree off the aim the mob already sent: no aim goes out, but the swing is pressed exactly.
    at(1, 50);
    run(rig, 1);
    const p = rig.world.state.players.get("p0")!;
    const exact = Math.atan2(p.y - mob.s.y, p.x - mob.s.x);
    const press = log.filter((l) => l.kind === "attack").at(-1)!;
    expect(press.at).toBe(rig.world.state.serverTime);
    expect(press.a).toBe(exact);
    expect(Math.abs(exact - Math.PI / 2)).toBeLessThan(MOB_AIM_DEADBAND);
    expect(Math.abs(exact - Math.PI / 2)).toBeGreaterThan(0.01);
    expect(log.filter((l) => l.kind === "aim")).toHaveLength(1);
    expect(brain(mob).lastAim).toBe(exact);
    run(rig, 1);
    expect(mob.s.facing).toBe(exact);
    expect(mob.rt.weapon.aim).toBe(exact);
  });

  it("lets go of the trigger at the exact angle too, and a bow looses at the angle of the moment", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "sentenced");
    put(rig.world, "p0", HOME.x, HOME.y + 60);
    aggro(rig.world, mob, "p0", 10);
    run(rig, 15);
    const log = spy(rig.world, mob);
    expect(brain(mob).holding).toBe(true);
    // The target steps back along a line one degree off the aim: out of reach, so the trigger comes up, with no aim sent.
    turnTarget(rig, mob, 1);
    const p = rig.world.state.players.get("p0")!;
    put(rig.world, "p0", mob.s.x + (p.x - mob.s.x) * 4, mob.s.y + (p.y - mob.s.y) * 4);
    run(rig, 1);
    const exact = Math.atan2(p.y - mob.s.y, p.x - mob.s.x);
    expect(log.filter((l) => l.kind === "aim")).toEqual([]);
    expect(log.filter((l) => l.kind === "release")).toEqual([{ at: rig.world.state.serverTime, kind: "release", a: exact }]);
    run(rig, 1);
    expect(mob.s.facing).toBe(exact);

    // A bow mob's shots carry the angle of the moment: each release names the lead it computed.
    const rig2 = makeRig();
    const archer = spawn(rig2.world, "plague");
    displace(rig2.world, archer, HOME.x - 150, HOME.y);
    put(rig2.world, "p0", HOME.x + 150, HOME.y);
    const log2 = spy(rig2.world, archer);
    aggro(rig2.world, archer, "p0", 10);
    walk(rig2.world, "p0", HOME.x + 150, HOME.y - 300);
    run(rig2, 40);
    const releases = log2.filter((l) => l.kind === "release");
    expect(releases.length).toBeGreaterThanOrEqual(1);
    // The target is running toward -y: each shot is led that way, and none is the plain bearing (0).
    for (const r of releases) expect(r.a!).toBeLessThan(-0.01);

    // Standing still one degree off the aim it already sent, the target is not worth a new aim, but the arrow goes at it.
    const rig3 = makeRig();
    const bow = spawn(rig3.world, "plague");
    displace(rig3.world, bow, HOME.x - 150, HOME.y);
    put(rig3.world, "p0", HOME.x + 150, HOME.y);
    const log3 = spy(rig3.world, bow);
    aggro(rig3.world, bow, "p0", 10);
    run(rig3, 1);
    const a1 = (1 * Math.PI) / 180;
    put(rig3.world, "p0", bow.s.x + 300 * Math.cos(a1), bow.s.y + 300 * Math.sin(a1));
    run(rig3, 40);
    const loose = log3.find((l) => l.kind === "release");
    expect(loose).toBeDefined();
    const target = rig3.world.state.players.get("p0")!;
    expect(loose!.a).toBe(Math.atan2(target.y - bow.s.y, target.x - bow.s.x));
    expect(loose!.a!).toBeGreaterThan(0.01);
    expect(log3.filter((l) => l.kind === "aim")).toHaveLength(1);
    expect(bow.rt.weapon.aim).toBe(loose!.a);
  });
});

describe("pursuit", () => {
  it("goes around a wall to reach a target it cannot see, and then hits it", () => {
    // A wall four tiles east of the camp, long enough that the way round is a real detour, but inside the leash.
    const map = arenaMap();
    for (let ty = 28; ty <= 36; ty++) map.tiles[ty * TILES + 36] = TILE_WALL;
    const rig = makeRig({ map });
    const mob = spawn(rig.world, "sentenced");
    put(rig.world, "p0", tile(38, 32).x, tile(38, 32).y);
    aggro(rig.world, mob, "p0", 10);
    expect(hasLineOfSight(rig.world.map, mob.s, rig.world.state.players.get("p0")!)).toBe(false);
    const events = run(rig, 200);
    expect(hitsOn(events, "p0").length).toBeGreaterThanOrEqual(1);
    expect(brain(mob).mode).toBe("fight");
  });

  it("an elite fights like any other mob", () => {
    const rig = makeRig();
    const mob = combatant(rig.world, placeMob(rig.world, { region: "fire", elite: true, at: HOME })) as MobCombatant;
    expect(mob.s.kind).toBe("elite");
    put(rig.world, "p0", HOME.x + 150, HOME.y);
    aggro(rig.world, mob, "p0", 10);
    expect(hitsOn(run(rig, 100), "p0").length).toBeGreaterThanOrEqual(1);
  });

  it("a mob with nothing in its hands stays put and goes home when the timer runs out", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "sentenced");
    mob.s.weapon0 = "";
    put(rig.world, "p0", HOME.x + 100, HOME.y);
    aggro(rig.world, mob, "p0", 10);
    const log = spy(rig.world, mob);
    run(rig, (MOB_GIVE_UP_SECONDS * 1000) / TICK_MS - 1);
    expect(brain(mob).mode).toBe("fight");
    expect(log.filter((l) => l.kind !== "aim")).toEqual([]);
    run(rig, 1);
    expect(brain(mob).mode).toBe("idle");
  });
});

describe("ranged mobs", () => {
  it("a bow mob closes to its far distance, then stands and shoots", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "plague");
    displace(rig.world, mob, HOME.x - 200, HOME.y);
    put(rig.world, "p0", HOME.x + 224, HOME.y);
    const pol = POLICIES.bow;
    aggro(rig.world, mob, "p0", 10);
    const log = spy(rig.world, mob);
    const hits = hitsOn(run(rig, 160), "p0");
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.every((h) => h.weapon === "bow")).toBe(true);
    const d = dist(mob.s, rig.world.state.players.get("p0")!);
    expect(d).toBeGreaterThan(pol.far - 12);
    expect(d).toBeLessThanOrEqual(pol.far + 1);
    expect(mob.rt.path).toEqual([]);
    expect(brain(mob).mode).toBe("fight");
    // The trigger goes down, up at full draw, down again: attack, release, attack, release...
    const triggers = log.filter((l) => l.kind === "attack" || l.kind === "release").map((l) => l.kind);
    expect(triggers.length).toBeGreaterThanOrEqual(4);
    triggers.forEach((k, i) => expect(k).toBe(i % 2 === 0 ? "attack" : "release"));
  });

  it("a wand mob closes to its far distance, then stands and casts", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "holy");
    displace(rig.world, mob, HOME.x - 150, HOME.y);
    put(rig.world, "p0", HOME.x + 200, HOME.y);
    const pol = POLICIES.wand;
    aggro(rig.world, mob, "p0", 10);
    const hits = hitsOn(run(rig, 160), "p0");
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.every((h) => h.weapon === "wand")).toBe(true);
    const d = dist(mob.s, rig.world.state.players.get("p0")!);
    expect(d).toBeGreaterThan(pol.far - 12);
    expect(d).toBeLessThanOrEqual(pol.far + 1);
    expect(mob.rt.path).toEqual([]);
  });

  it.each([["plague", "bow", 120], ["holy", "wand", 90]] as const)(
    "a %s mob (%s) backs off from a target that is too close, then stands and shoots",
    (region, weapon, start) => {
      const rig = makeRig();
      const mob = spawn(rig.world, region);
      displace(rig.world, mob, HOME.x - 100, HOME.y);
      put(rig.world, "p0", HOME.x - 100 + start, HOME.y);
      const pol = POLICIES[weapon];
      aggro(rig.world, mob, "p0", 10);
      const ds: number[] = [];
      run(rig, 120, () => ds.push(dist(mob.s, rig.world.state.players.get("p0")!)));
      expect(ds[0]!).toBeLessThan(pol.retreatBelow);
      // It opens the gap (it can only walk, and a bow draw or a cast slows it) and then never lets it close again.
      const opened = ds.findIndex((d) => d >= pol.retreatBelow);
      expect(opened).toBeGreaterThan(0);
      expect(opened).toBeLessThan(100);
      expect(Math.min(...ds.slice(opened))).toBeGreaterThanOrEqual(pol.retreatBelow - 1);
      expect(Math.max(...ds)).toBeLessThanOrEqual(pol.far + 1);
      expect(brain(mob).mode).toBe("fight");
      run(rig, 120);
      expect(hitsOn(rig.events, "p0").length).toBeGreaterThanOrEqual(2);
      expect(hitsOn(rig.events, "p0").every((h) => h.weapon === weapon)).toBe(true);
    },
  );

  it("a bow mob aims ahead of a target that is walking across its line", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "plague");
    displace(rig.world, mob, HOME.x - 150, HOME.y);
    put(rig.world, "p0", HOME.x + 150, HOME.y);
    const log = spy(rig.world, mob);
    aggro(rig.world, mob, "p0", 10);
    walk(rig.world, "p0", HOME.x + 150, HOME.y - 300);
    const p = rig.world.state.players.get("p0")!;
    const leads: number[] = [];
    run(rig, 16, () => {
      const aim = log.filter((l) => l.a !== undefined).at(-1);
      if (aim && p.y < HOME.y - 20) leads.push(Math.atan2(p.y - mob.s.y, p.x - mob.s.x) - aim.a!);
    });
    expect(leads.length).toBeGreaterThan(5);
    // The target runs toward -y: the aim is turned that way of where it stands (~170 u/s over a 300 u flight at 900 u/s).
    for (const lead of leads.slice(2)) expect(lead).toBeGreaterThan(0.1);
  });

  it("a bow mob lands arrows on a target that keeps walking across its line", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "plague");
    displace(rig.world, mob, HOME.x - 150, HOME.y);
    put(rig.world, "p0", HOME.x + 100, HOME.y - 100);
    aggro(rig.world, mob, "p0", 10);
    // The target paces up and down across the mob's line at full speed.
    const hits = hitsOn(run(rig, 240, (i) => {
      if (i % 10 === 0) walk(rig.world, "p0", HOME.x + 100, i % 20 === 0 ? HOME.y + 100 : HOME.y - 100);
    }), "p0");
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });
});

describe("moving", () => {
  it("sends at most one move per MOB_REPATH_MS, each on the mob's own schedule", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "sentenced");
    put(rig.world, "p0", HOME.x + 110, HOME.y);
    aggro(rig.world, mob, "p0", 10);
    const log = spy(rig.world, mob);
    // The player circles the camp, so the goal moves every tick and the mob keeps wanting to path.
    run(rig, 200, (i) => {
      if (i % 10 === 0) {
        const th = (i / 10) * 0.6;
        walk(rig.world, "p0", HOME.x + 110 * Math.cos(th), HOME.y + 110 * Math.sin(th));
      }
    });
    expect(brain(mob).mode).toBe("fight");
    const sent = moves(log);
    expect(sent.length).toBeGreaterThanOrEqual(6);
    expect(sent.length).toBeLessThanOrEqual(200 * TICK_MS / MOB_REPATH_MS + 1);
    sent.slice(1).forEach((m, i) => {
      expect(m.at - sent[i]!.at).toBeGreaterThanOrEqual(MOB_REPATH_MS);
      const slot = (t: number) => Math.floor((t + brain(mob).phase) / MOB_REPATH_MS);
      expect(slot(m.at)).toBeGreaterThan(slot(m.at - TICK_MS));
    });
    // Every window of MOB_REPATH_MS holds at most one.
    for (const m of sent) expect(sent.filter((o) => o.at >= m.at && o.at < m.at + MOB_REPATH_MS)).toHaveLength(1);
  });

  it("spreads the first repaths of mobs that woke on the same tick over several ticks", () => {
    const rig = makeRig();
    const mobs = Array.from({ length: 10 }, (_, i) => spawn(rig.world, "sentenced", { x: HOME.x + (i % 5) * 14, y: HOME.y + Math.floor(i / 5) * 14 }));
    expect(new Set(mobs.map((m) => Math.floor(brain(m).phase / TICK_MS))).size).toBeGreaterThanOrEqual(6);
    put(rig.world, "p0", HOME.x - 120, HOME.y);
    const logs = mobs.map((m) => spy(rig.world, m));
    const woke = rig.world.state.serverTime;
    for (const m of mobs) aggro(rig.world, m, "p0", 10);
    // The player runs away at the mobs' own speed, so they chase for as long as the leash allows.
    run(rig, 24, (i) => { if (i === 0) walk(rig.world, "p0", 60, HOME.y); });
    for (const log of logs) {
      expect(moves(log).length).toBeGreaterThanOrEqual(2);
      expect(moves(log)[0]!.at).toBe(woke + TICK_MS);
    }
    const second = logs.map((log) => moves(log)[1]!.at);
    expect(Math.min(...second) - woke).toBeGreaterThanOrEqual(MOB_REPATH_MS);
    expect(new Set(second).size).toBeGreaterThanOrEqual(6);
    const perTick = new Map<number, number>();
    for (const t of second) perTick.set(t, (perTick.get(t) ?? 0) + 1);
    expect(Math.max(...perTick.values())).toBeLessThanOrEqual(2);
  });

  it("sends a stop once when it has arrived, and nothing while it stands", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "sentenced");
    put(rig.world, "p0", HOME.x + 200, HOME.y);
    aggro(rig.world, mob, "p0", 10);
    const log = spy(rig.world, mob);
    run(rig, 80);
    expect(log.filter((l) => l.kind === "stop")).toHaveLength(1);
    expect(mob.rt.path).toEqual([]);
    const sent = log.length;
    run(rig, 20);
    expect(moves(log.slice(sent))).toEqual([]);
    expect(log.slice(sent).filter((l) => l.kind === "stop")).toEqual([]);
  });
});

describe("giving up", () => {
  const HOME_FACING = 1.25;

  it("walks home when the target runs beyond the leash, and rests there facing its camp", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "sentenced", HOME, HOME_FACING);
    put(rig.world, "p0", HOME.x + 100, HOME.y);
    aggro(rig.world, mob, "p0", 10);
    const log = spy(rig.world, mob);
    walk(rig.world, "p0", HOME.x + 900, HOME.y);
    let away = -1;
    run(rig, 60, () => { if (away < 0 && brain(mob).mode === "return") away = dist(mob.s, HOME); });
    // It turns back as soon as it is farther than the leash allows: not before, and not a step later.
    expect(away).toBeGreaterThan(MOB_LEASH_RADIUS);
    expect(away).toBeLessThan(MOB_LEASH_RADIUS + (MOB_SPEED * TICK_MS) / 1000);
    expect(brain(mob).target).toBeNull();
    expect(brain(mob).threat.size).toBe(0);
    expect(brain(mob).holding).toBe(false);
    expect(moves(log).some((m) => m.x === HOME.x && m.y === HOME.y)).toBe(true);

    run(rig, 120);
    expect(brain(mob).mode).toBe("idle");
    expect({ x: mob.s.x, y: mob.s.y }).toEqual(HOME);
    expect(mob.s.facing).toBe(HOME_FACING);
    expect(mob.rt.path).toEqual([]);
    // Once at rest it sends nothing, even with the player still in view.
    const n = log.length;
    run(rig, 50);
    expect(log.slice(n)).toEqual([]);
  });

  it("gives up after MOB_GIVE_UP_SECONDS of nothing happening, then walks home from where it stood", () => {
    // The target sits in a sealed cell: the mob can neither reach it nor see it, so no damage is dealt or taken.
    const cell = { tx: 35, ty: 32 };
    const rig = makeRig({ map: arenaMap([cell]) });
    const mob = spawn(rig.world, "sentenced", HOME, HOME_FACING);
    displace(rig.world, mob, HOME.x - 100, HOME.y);
    put(rig.world, "p0", tile(cell.tx, cell.ty).x, tile(cell.tx, cell.ty).y);
    aggro(rig.world, mob, "p0", 10);
    const log = spy(rig.world, mob);
    const steps = (MOB_GIVE_UP_SECONDS * 1000) / TICK_MS;
    run(rig, steps - 1);
    expect(brain(mob).mode).toBe("fight");
    expect({ x: mob.s.x, y: mob.s.y }).toEqual({ x: HOME.x - 100, y: HOME.y });
    expect(log.filter((l) => l.kind === "attack")).toEqual([]);
    run(rig, 1);
    expect(brain(mob).mode).toBe("return");
    expect(brain(mob).target).toBeNull();
    run(rig, 60);
    expect(brain(mob).mode).toBe("idle");
    expect({ x: mob.s.x, y: mob.s.y }).toEqual(HOME);
    expect(mob.s.facing).toBe(HOME_FACING);
  });

  it("does not give up while it is swinging at someone, however long that takes", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "sentenced");
    put(rig.world, "p0", HOME.x + 60, HOME.y);
    aggro(rig.world, mob, "p0", 10);
    run(rig, (MOB_GIVE_UP_SECONDS * 1000) / TICK_MS * 2);
    expect(brain(mob).mode).toBe("fight");
    expect(hitsOn(rig.events, "p0").length).toBeGreaterThan(5);
  });

  it("is not kept fighting by a shooter it cannot reach: damage it takes does not restart the timer", () => {
    const cell = { tx: 35, ty: 32 };
    const rig = makeRig({ map: arenaMap([cell]) });
    const mob = spawn(rig.world, "sentenced", HOME, HOME_FACING);
    displace(rig.world, mob, HOME.x - 100, HOME.y);
    put(rig.world, "p0", tile(cell.tx, cell.ty).x, tile(cell.tx, cell.ty).y);
    const woke = rig.world.state.serverTime;
    expect(shoot(rig.world, "p0", mob, mob.s.maxHp / 100)).toBeGreaterThan(0);
    expect(brain(mob).mode).toBe("fight");
    expect(brain(mob).lastCombatAt).toBe(woke);
    const steps = (MOB_GIVE_UP_SECONDS * 1000) / TICK_MS;
    for (let i = 0; i < steps - 1; i++) {
      if (i % 10 === 0) shoot(rig.world, "p0", mob, mob.s.maxHp / 1000);
      run(rig, 1);
    }
    expect(brain(mob).mode).toBe("fight");
    expect(brain(mob).lastCombatAt).toBe(woke);
    run(rig, 1);
    expect(brain(mob).mode).toBe("return");
  });

  it("restarts the give-up timer when it lands a hit on a player, and only then", () => {
    const cell = { tx: 35, ty: 32 };
    const rig = makeRig({ map: arenaMap([cell]) });
    const mob = spawn(rig.world, "sentenced", HOME, HOME_FACING);
    const other = spawn(rig.world, "holy", tile(40, 40));
    displace(rig.world, mob, HOME.x - 100, HOME.y);
    put(rig.world, "p0", tile(cell.tx, cell.ty).x, tile(cell.tx, cell.ty).y);
    aggro(rig.world, mob, "p0", 10);
    const woke = brain(mob).lastCombatAt;
    run(rig, 100);
    const swing = (victim: string, scale?: number) => recordHit(rig.world, {
      victim, by: { id: mob.id, name: mob.s.name }, packet: { raw: 1, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false, scale,
    });
    // A swing that meets a camp-mate, or one that does nothing, is not damage dealt.
    swing(other.id);
    swing("p0", 0);
    expect(brain(mob).lastCombatAt).toBe(woke);
    swing("p0");
    const hitAt = rig.world.state.serverTime;
    expect(brain(mob).lastCombatAt).toBe(hitAt);
    run(rig, (MOB_GIVE_UP_SECONDS * 1000) / TICK_MS - 1);
    expect(brain(mob).mode).toBe("fight");
    run(rig, 1);
    expect(brain(mob).mode).toBe("return");
  });

  it("ignores damage and people while it walks home", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "sentenced", HOME, HOME_FACING);
    displace(rig.world, mob, HOME.x - 150, HOME.y);
    put(rig.world, "p0", HOME.x - 150 + 30, HOME.y);
    brain(mob).mode = "return";
    const log = spy(rig.world, mob);
    for (let i = 0; i < 40 && brain(mob).mode === "return"; i++) {
      // Hit again from point-blank range every tick.
      aggro(rig.world, mob, "p0", 40);
      run(rig, 1);
      expect(brain(mob).target).toBeNull();
      expect(brain(mob).threat.size).toBe(0);
    }
    expect(brain(mob).mode).toBe("idle");
    run(rig, 5);
    expect({ x: mob.s.x, y: mob.s.y }).toEqual(HOME);
    expect(log.filter((l) => l.kind === "attack")).toEqual([]);
    expect(hpOf(rig.world, "p0")).toBe(1e9);
    // It is neutral again: the same hit now wakes it.
    aggro(rig.world, mob, "p0", 40);
    expect(brain(mob).mode).toBe("fight");
  });

  it("holds no trigger when it goes home, even from the middle of a swing", () => {
    // Two more players keep the run going once the first has left (a contested run ends with one player standing).
    const rig = makeRig({ players: 3 });
    const mob = spawn(rig.world, "sentenced");
    put(rig.world, "p0", HOME.x + 60, HOME.y);
    aggro(rig.world, mob, "p0", 10);
    run(rig, 15);
    expect(brain(mob).holding).toBe(true);
    expect(mob.rt.weapon.held).toBe(true);
    removePlayer(rig.world, "p0");
    run(rig, 2);
    expect(brain(mob).mode).toBe("idle");
    expect(brain(mob).holding).toBe(false);
    expect(mob.rt.weapon.held).toBe(false);
  });
});

describe("the trigger", () => {
  it("is let go when a mob away from its camp loses its target, so it does not swing on the way home", () => {
    const rig = makeRig({ players: 3 });
    const mob = spawn(rig.world, "sentenced");
    displace(rig.world, mob, HOME.x - 120, HOME.y);
    put(rig.world, "p0", HOME.x - 120 + 50, HOME.y);
    aggro(rig.world, mob, "p0", 10);
    run(rig, 15);
    expect(rig.world.mobs.get(mob.id)!.weapon.held).toBe(true);
    removePlayer(rig.world, "p0");
    run(rig, 2);
    expect(brain(mob).mode).toBe("return");
    expect(mob.rt.weapon.held).toBe(false);
    expect(brain(mob).holding).toBe(false);
  });

  it("is pressed again if something other than the mob let go of it", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "sentenced");
    put(rig.world, "p0", HOME.x + 60, HOME.y);
    aggro(rig.world, mob, "p0", 10);
    run(rig, 15);
    const swings = rig.swings.length;
    expect(mob.rt.weapon.held).toBe(true);
    // What a teleport does to every fighter's trigger.
    mob.rt.weapon.held = false;
    mob.rt.weapon.bufferedUntil = 0;
    run(rig, 2);
    expect(mob.rt.weapon.held).toBe(true);
    run(rig, 40);
    expect(rig.swings.length).toBeGreaterThan(swings);
  });

  it("does not swing through a wall", () => {
    // A wall one tile thick between a mob and a target that are close enough for the swing's reach.
    const map = arenaMap();
    for (let ty = 28; ty <= 36; ty++) map.tiles[ty * TILES + 36] = TILE_WALL;
    const rig = makeRig({ map });
    const mob = spawn(rig.world, "sentenced", tile(35, 32));
    displace(rig.world, mob, 36 * TILE - PLAYER_RADIUS, tile(35, 32).y);
    put(rig.world, "p0", 37 * TILE + PLAYER_RADIUS, tile(35, 32).y);
    const d = dist(mob.s, rig.world.state.players.get("p0")!);
    expect(d).toBeLessThanOrEqual(POLICIES.sword.attackRange);
    const log = spy(rig.world, mob);
    aggro(rig.world, mob, "p0", 10);
    run(rig, 5);
    expect(log.filter((l) => l.kind === "attack")).toEqual([]);
    expect(brain(mob).holding).toBe(false);
  });
});

describe("evading", () => {
  it("nothing hurts a mob that is walking home: no damage, no number, no wake", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "sentenced");
    displace(rig.world, mob, HOME.x - 150, HOME.y);
    put(rig.world, "p0", HOME.x - 150 + 100, HOME.y);
    brain(mob).mode = "return";
    mob.s.hp = mob.s.maxHp / 2;
    const entry = {
      victim: mob.id, by: { id: "p0", name: "player0" }, packet: { raw: 50, phys: 0, magic: 0, true: 1 }, weapon: "bow" as const,
      scale: 1, stagger: false,
    };
    expect(hurtMob(rig.world, mob, [50], [entry])).toBe(0);
    rig.world.events = [];
    const before = mob.s.hp;
    expect(shoot(rig.world, "p0", mob, 50)).toBe(0);
    expect(mob.s.hp).toBe(before);
    expect(hitsOn(rig.world.events, mob.id)).toEqual([]);
    expect(brain(mob).mode).toBe("return");
    expect(brain(mob).threat.size).toBe(0);
    expect(mob.rt.lastHitAt).toBe(0);
  });

  it("a sniper beyond the leash wakes the mob; it runs to the leash edge, gives up, and is home whole and idle; the next hit wakes it again", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "sentenced", HOME, 1);
    put(rig.world, "p0", HOME.x + MOB_LEASH_RADIUS + 180, HOME.y);
    const max = mob.s.maxHp;
    expect(shoot(rig.world, "p0", mob, max / 2)).toBeCloseTo(max / 2);
    expect(brain(mob).mode).toBe("fight");
    expect(brain(mob).target).toBe("p0");
    let farthest = 0;
    let returned = 0;
    for (let i = 0; i < 300 && brain(mob).mode !== "idle"; i++) {
      run(rig, 1);
      farthest = Math.max(farthest, dist(mob.s, HOME));
      if (brain(mob).mode === "return") {
        returned++;
        // Shot at again on the way home: it does not feel it.
        const hp = mob.s.hp;
        expect(shoot(rig.world, "p0", mob, max / 2)).toBe(0);
        expect(mob.s.hp).toBe(hp);
      }
    }
    expect(farthest).toBeGreaterThan(MOB_LEASH_RADIUS);
    expect(farthest).toBeLessThan(MOB_LEASH_RADIUS + 20);
    expect(returned).toBeGreaterThan(3);
    expect(brain(mob).mode).toBe("idle");
    // Healing on the way (MOB_REGEN_SECONDS) is not enough in so short a walk: arriving is what makes it whole.
    expect(mob.s.hp).toBe(max);
    run(rig, 5);
    expect({ x: mob.s.x, y: mob.s.y }).toEqual(HOME);
    expect(mob.s.facing).toBe(1);

    expect(shoot(rig.world, "p0", mob, max / 2)).toBeCloseTo(max / 2);
    expect(brain(mob).mode).toBe("fight");
    expect(brain(mob).target).toBe("p0");
  });

  it("kiting gains nothing: a shooter hitting a sword mob from 300 u for a minute never kills it, and it is whole every time it is idle", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "sentenced");
    put(rig.world, "p0", HOME.x + 300, HOME.y);
    const max = mob.s.maxHp;
    let wakes = 0;
    let lowest = max;
    let was = brain(mob).mode;
    for (let i = 0; i < (60 * 1000) / TICK_MS; i++) {
      // Half a second between shots: each eighth of its hp. A round trip to the leash edge and back takes it about 2.7 s.
      if (i % 10 === 0) shoot(rig.world, "p0", mob, max / 8);
      expect(mob.s.status).toBe("alive");
      run(rig, 1);
      const mode = brain(mob).mode;
      if (mode === "fight" && was !== "fight") wakes++;
      was = mode;
      lowest = Math.min(lowest, mob.s.hp);
      if (mode === "idle") expect(mob.s.hp).toBe(max);
    }
    expect(mob.s.status).toBe("alive");
    expect(wakes).toBeGreaterThanOrEqual(10);
    expect(lowest).toBeGreaterThan(0);
    // The shooter never got more than a few shots into one round.
    expect(lowest).toBeGreaterThan(max * 0.3);
  });
});

describe("retargeting", () => {
  /** Five players on a ring of radius 120 around HOME; the mob fights whoever it must. */
  function ringRig() {
    const rig = makeRig({ players: 5 });
    for (let i = 0; i < 5; i++) {
      const th = (i * 2 * Math.PI) / 5;
      put(rig.world, `p${i}`, HOME.x + 120 * Math.cos(th), HOME.y + 120 * Math.sin(th));
    }
    return rig;
  }

  it("moves on to the next highest threat when the target dies, and again when it leaves", () => {
    const rig = ringRig();
    const mob = spawn(rig.world, "sentenced");
    aggro(rig.world, mob, "p2", 30);
    aggro(rig.world, mob, "p0", 100);
    aggro(rig.world, mob, "p1", 60);
    aggro(rig.world, mob, "p4", 1);
    // p2 hurt it first but p0 hurt it most; it woke on p2 (the only one then) and keeps p2 while p2 stands.
    expect(brain(mob).target).toBe("p2");
    run(rig, 5);
    expect(brain(mob).target).toBe("p2");

    downPlayer(rig.world, rig.world.state.players.get("p2")!, rig.world.players.get("p2")!, "died");
    run(rig, 1);
    expect(brain(mob).target).toBe("p0");
    expect(brain(mob).mode).toBe("fight");

    removePlayer(rig.world, "p0");
    run(rig, 1);
    expect(brain(mob).target).toBe("p1");

    const p1 = rig.world.state.players.get("p1")!;
    rig.world.players.get("p1")!.resolved = true;
    p1.status = "mia";
    run(rig, 1);
    expect(brain(mob).target).toBe("p4");
    expect(brain(mob).threat.has("p2")).toBe(false);
    expect(brain(mob).threat.has("p0")).toBe(false);
  });

  it("goes home when nobody who hurt it is left standing", () => {
    const rig = ringRig();
    const mob = spawn(rig.world, "sentenced");
    aggro(rig.world, mob, "p0", 100);
    aggro(rig.world, mob, "p1", 10);
    run(rig, 3);
    downPlayer(rig.world, rig.world.state.players.get("p0")!, rig.world.players.get("p0")!, "died");
    run(rig, 1);
    expect(brain(mob).target).toBe("p1");
    downPlayer(rig.world, rig.world.state.players.get("p1")!, rig.world.players.get("p1")!, "died");
    run(rig, 1);
    // p2, p3 and p4 never touched it: they are not enemies.
    expect(brain(mob).mode === "return" || brain(mob).mode === "idle").toBe(true);
    expect(brain(mob).target).toBeNull();
    expect(brain(mob).threat.size).toBe(0);
    run(rig, 80);
    expect(brain(mob).mode).toBe("idle");
    expect({ x: mob.s.x, y: mob.s.y }).toEqual(HOME);
  });

  it("retargets onto the highest threat even when they stand beyond the leash", () => {
    const rig = ringRig();
    const mob = spawn(rig.world, "sentenced");
    aggro(rig.world, mob, "p0", 10);
    aggro(rig.world, mob, "p1", 1000);
    put(rig.world, "p1", HOME.x + MOB_LEASH_RADIUS + 80, HOME.y);
    downPlayer(rig.world, rig.world.state.players.get("p0")!, rig.world.players.get("p0")!, "died");
    run(rig, 1);
    expect(brain(mob).mode).toBe("fight");
    expect(brain(mob).target).toBe("p1");
  });

  it("sets off for a new target at once", () => {
    const rig = ringRig();
    const mob = spawn(rig.world, "sentenced");
    aggro(rig.world, mob, "p0", 100);
    aggro(rig.world, mob, "p3", 50);
    run(rig, 3);
    const log = spy(rig.world, mob);
    downPlayer(rig.world, rig.world.state.players.get("p0")!, rig.world.players.get("p0")!, "died");
    const t = rig.world.state.serverTime + TICK_MS;
    run(rig, 1);
    expect(brain(mob).target).toBe("p3");
    const p3 = rig.world.state.players.get("p3")!;
    expect(moves(log)).toEqual([{ at: t, kind: "move", x: p3.x, y: p3.y }]);
  });
});

describe("resetMob", () => {
  it("drops the fight, the queued inputs, the path and the trigger, and puts the mob back on its spot at full hp", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "sentenced", HOME, 0.5);
    put(rig.world, "p0", HOME.x + 150, HOME.y);
    aggro(rig.world, mob, "p0", 10);
    run(rig, 12);
    expect(brain(mob).holding || brain(mob).moving).toBe(true);
    expect(dist(mob.s, HOME)).toBeGreaterThan(MOB_HOME_RADIUS);
    mob.s.hp = mob.s.maxHp / 3;
    mob.rt.inputs.pushMove({ kind: "move", x: 1, y: 1 });
    mob.rt.inputs.pushAim(1);
    mob.rt.inputs.pushAction({ kind: "attack", a: 1 });
    mob.rt.weapon.held = true;
    mob.rt.weapon.bufferedUntil = rig.world.state.serverTime + 1000;
    mob.rt.weapon.action = { kind: "swing", weapon: "sword", startedAt: 0, landsAt: rig.world.state.serverTime + 100, a: 0, packet: { raw: 1, phys: 1, magic: 0, true: 0 } };
    expect(mob.rt.path.length).toBeGreaterThan(0);
    const log = spy(rig.world, mob);

    resetMob(rig.world, mob);
    const b = brain(mob);
    expect(b.mode).toBe("idle");
    expect(b.target).toBeNull();
    expect(b.threat.size).toBe(0);
    expect([b.holding, b.moving, b.goal]).toEqual([false, false, null]);
    expect(mob.rt.inputs.move).toBeNull();
    expect(mob.rt.inputs.aim).toBeNull();
    expect(mob.rt.inputs.actions).toEqual([]);
    expect(mob.rt.path).toEqual([]);
    expect(mob.rt.weapon.held).toBe(false);
    expect(mob.rt.weapon.action).toBeNull();
    expect(mob.rt.weapon.bufferedUntil).toBe(0);
    expect({ x: mob.s.x, y: mob.s.y }).toEqual(HOME);
    expect(mob.s.facing).toBe(0.5);
    expect(mob.s.hp).toBe(mob.s.maxHp);
    expect(mob.rt.history).toEqual([{ t: rig.world.state.serverTime, x: HOME.x, y: HOME.y }]);

    // It stays there and says nothing, with the player standing next to it.
    const hp = hpOf(rig.world, "p0");
    run(rig, 60);
    expect(log).toEqual([]);
    expect({ x: mob.s.x, y: mob.s.y }).toEqual(HOME);
    expect(hpOf(rig.world, "p0")).toBe(hp);
  });

  it.each([
    ["outside the leash", HOME.x + 3 * MOB_LEASH_RADIUS, HOME.y],
    ["on a tile that has just become a gate", 20 * TILE + 16, 20 * TILE + 16],
  ])("puts a mob %s back on its spot at full hp, idle", (_where, x, y) => {
    const map = arenaMap();
    map.tiles[20 * TILES + 20] = TILE_WALL; // the gate that locked behind the players
    const rig = makeRig({ map });
    const mob = spawn(rig.world, "plague", HOME, 2.5);
    put(rig.world, "p0", HOME.x + 100, HOME.y);
    aggro(rig.world, mob, "p0", 10);
    run(rig, 5);
    displace(rig.world, mob, x, y);
    mob.s.hp = 1;
    mob.rt.weapon.held = true;
    resetMob(rig.world, mob);
    expect(brain(mob).mode).toBe("idle");
    expect({ x: mob.s.x, y: mob.s.y }).toEqual(HOME);
    expect(mob.s.facing).toBe(2.5);
    expect(mob.s.hp).toBe(mob.s.maxHp);
    expect(mob.rt.weapon.held).toBe(false);
    const log = spy(rig.world, mob);
    run(rig, 40);
    expect(log).toEqual([]);
    expect({ x: mob.s.x, y: mob.s.y }).toEqual(HOME);
  });

  it("is what the coliseum teleport does to every mob in a fight", () => {
    const rig = makeRig({ players: 2, patience: 3 });
    const mob = spawn(rig.world, "sentenced", HOME, 0.5);
    put(rig.world, "p0", HOME.x + 120, HOME.y);
    put(rig.world, "p1", HOME.x - 120, HOME.y);
    aggro(rig.world, mob, "p0", 10);
    const log = spy(rig.world, mob);
    mob.s.hp = mob.s.maxHp / 2;
    let ticks = 0;
    while (!rig.world.state.gatesLocked && ticks++ < 200) {
      run(rig, 1);
      if (!rig.world.state.gatesLocked) expect(brain(mob).mode).toBe("fight");
    }
    expect(rig.world.state.gatesLocked).toBe(true);
    expect(brain(mob).mode).toBe("idle");
    expect({ x: mob.s.x, y: mob.s.y }).toEqual(HOME);
    expect(mob.s.facing).toBe(0.5);
    expect(mob.s.hp).toBe(mob.s.maxHp);
    expect(mob.rt.weapon.held).toBe(false);
    expect(brain(mob).threat.size).toBe(0);
    const n = log.length;
    run(rig, 40);
    expect(log.slice(n)).toEqual([]);
  });

  it("puts a mob that is already at its camp straight back to idle, facing the way it should", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "holy", HOME, 2);
    put(rig.world, "p0", HOME.x + 100, HOME.y);
    aggro(rig.world, mob, "p0", 10);
    run(rig, 2);
    expect(mob.s.facing).toBeCloseTo(0, 1);
    resetMob(rig.world, mob);
    expect(brain(mob).mode).toBe("idle");
    const log = spy(rig.world, mob);
    run(rig, 3);
    expect(mob.s.facing).toBe(2);
    expect({ x: mob.s.x, y: mob.s.y }).toEqual(HOME);
    expect(moves(log)).toEqual([]);
    run(rig, 50);
    expect(log.filter((l) => l.kind !== "aim")).toEqual([]);
  });

  it("brings a mob that is within the home radius but off its spot back onto it", () => {
    const rig = makeRig();
    const mob = spawn(rig.world, "sentenced", HOME, 1);
    displace(rig.world, mob, HOME.x + MOB_HOME_RADIUS - 2, HOME.y);
    brain(mob).mode = "fight";
    resetMob(rig.world, mob);
    expect(brain(mob).mode).toBe("idle");
    run(rig, 10);
    expect({ x: mob.s.x, y: mob.s.y }).toEqual(HOME);
  });
});

describe("mobs and mobs", () => {
  it("never target, wake or hurt each other", () => {
    const rig = makeRig();
    const a = spawn(rig.world, "sentenced", HOME);
    const b = spawn(rig.world, "fire", { x: HOME.x + 40, y: HOME.y });
    const c = spawn(rig.world, "holy", { x: HOME.x + 40, y: HOME.y + 20 });
    put(rig.world, "p0", HOME.x + 180, HOME.y);
    const logs = [b, c].map((m) => spy(rig.world, m));
    const hpB = b.s.hp;
    const hpC = c.s.hp;
    aggro(rig.world, a, "p0", 10);
    aggro(rig.world, b, a.id, 100);
    aggro(rig.world, c, a.id, 100);
    expect(brain(b).mode).toBe("idle");
    expect(brain(c).mode).toBe("idle");
    let targets = 0;
    run(rig, 120, () => {
      const t = brain(a).target;
      if (t !== null) { targets++; expect(rig.world.players.has(t)).toBe(true); }
    });
    expect(targets).toBeGreaterThan(0);
    // The sword mob swung through its neighbours on the way, and it hit the player.
    expect(rig.swings.filter((s) => s.attacker === a.id).length).toBeGreaterThan(0);
    expect(hitsOn(rig.events, "p0").length).toBeGreaterThan(0);
    expect(hitsOn(rig.events, b.id)).toEqual([]);
    expect(hitsOn(rig.events, c.id)).toEqual([]);
    expect([b.s.hp, c.s.hp]).toEqual([hpB, hpC]);
    expect(logs.flat()).toEqual([]);
    expect(brain(b).threat.size + brain(c).threat.size).toBe(0);
  });

  it.each([["plague", "bow", 220], ["holy", "wand", 250]] as const)(
    "a camp %s mob's shots fly past its neighbour and hit the player behind it, so it keeps fighting",
    (region, weapon, range) => {
      const rig = makeRig();
      const shooter = spawn(rig.world, region, HOME);
      const neighbour = spawn(rig.world, "sentenced", { x: HOME.x + 100, y: HOME.y });
      put(rig.world, "p0", HOME.x + range, HOME.y);
      const hp = neighbour.s.hp;
      const woke = rig.world.state.serverTime;
      aggro(rig.world, shooter, "p0", 10);
      // Longer than the give-up time: it only keeps fighting because its shots land.
      const events = run(rig, (MOB_GIVE_UP_SECONDS * 1000) / TICK_MS + 40);
      const onPlayer = hitsOn(events, "p0");
      expect(onPlayer.length).toBeGreaterThanOrEqual(4);
      expect(onPlayer.every((h) => h.by === shooter.id && h.weapon === weapon)).toBe(true);
      expect(hitsOn(events, neighbour.id)).toEqual([]);
      expect(neighbour.s.hp).toBe(hp);
      expect(brain(neighbour).mode).toBe("idle");
      expect(brain(neighbour).threat.size).toBe(0);
      expect(brain(shooter).mode).toBe("fight");
      expect(brain(shooter).target).toBe("p0");
      // Its last landed shot is recent: the give-up timer keeps being restarted.
      expect(rig.world.state.serverTime - brain(shooter).lastCombatAt).toBeLessThan(3000);
      expect(brain(shooter).lastCombatAt).toBeGreaterThan(woke + MOB_GIVE_UP_SECONDS * 500);
    },
  );
});

describe("determinism", () => {
  function scenario() {
    const rig = makeRig({ players: 2, seed: 5 });
    const mobs = [spawn(rig.world, "plague", tile(30, 30)), spawn(rig.world, "holy", tile(34, 30)), spawn(rig.world, "sentenced", tile(32, 35))];
    const logs = mobs.map((m) => spy(rig.world, m));
    put(rig.world, "p0", HOME.x, HOME.y - 20);
    put(rig.world, "p1", HOME.x + 60, HOME.y + 40);
    for (const m of mobs) { aggro(rig.world, m, "p0", 10); aggro(rig.world, m, "p1", 4); }
    const trace: unknown[] = [];
    run(rig, 400, (i) => {
      if (i % 25 === 0) walk(rig.world, "p0", HOME.x + 150 * Math.cos(i / 25), HOME.y + 150 * Math.sin(i / 25));
      trace.push(mobs.map((m) => [m.s.x, m.s.y, m.s.facing, m.s.hp, m.s.readyAt, brain(m).mode, brain(m).target]));
      trace.push([hpOf(rig.world, "p0"), hpOf(rig.world, "p1")]);
    });
    return { trace, logs, events: rig.events };
  }

  it("gives identical mob traces, inputs and events for the same seed and the same inputs", () => {
    const first = scenario();
    expect(first.logs.map((l) => l.length)).toSatisfy((ns: number[]) => ns.every((n) => n > 20));
    expect(first.events.some((e) => e.type === "fx" && e.fx.kind === "hit")).toBe(true);
    const second = scenario();
    expect(second.trace).toEqual(first.trace);
    expect(second.logs).toEqual(first.logs);
    expect(second.events).toEqual(first.events);
  });
});

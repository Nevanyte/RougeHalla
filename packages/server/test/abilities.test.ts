import { VISION_RADIUS, VISION_TRAIL_MS } from "@raid/shared";
import { getVisionMemory } from "../src/sim/vision";
// The cast pipeline and the five Wishes (sim/abilities.ts), driven through the real step(): `cast` messages queued, then ticks.
// Worlds are a hand-built open arena (1280 x 640 u) with the real melee, projectile, ledger and status phases and, unless a test
// asks for them, no faction signatures, so what a test sees is the cast, the status it leaves and the damage it deals. Players
// are p0, p1, ... with a faction each (frost freezes, plague swarms, sentenced judges, fire blinks, holy stands last); a big hp
// keeps a fight from ending the run unless a test sets hp. Times are server ms; a tick is TICK_MS.
import { describe, expect, it } from "vitest";
import {
  ABILITIES, BLAZE_BURN_DPS, BLAZE_BURN_MS, BLAZE_MIN_DIST, BLAZE_RANGE, BLAZE_TRAIL_HALF_WIDTH, BLAZE_TRAIL_MS, blinkLanding, bountyFor,
  CAST_RANGE_SLACK, CAST_TELEPORT_GRACE_MS, DOT_FX_MS, EFFECT_CASTING, EFFECT_DOT, EFFECT_HASTE, EFFECT_HIDDEN, EFFECT_LAST_STAND, EFFECT_STUNNED, EFFECT_ZONED,
  FIELD_KINDS, FREEZE_CAST_MS, FREEZE_RANGE, FREEZE_STUN_MS, GV_KILL, HIDDEN_REVEAL_MS, LAST_STAND_HEAL_SHARE, LAST_STAND_MS,
  LAST_STAND_SPEED_BONUS, mapFromTiles, mitigateShares, mulberry32, PLAYER_SPEED, SIG_CHILLED, STATUS_RULES, SWARM_CAST_MS, SWARM_CLOUD_RADIUS, SWARM_MS, TICK_MS, TILE,
  TILE_FLOOR, TILE_WALL, TRAINING_WISH_COOLDOWN_SECONDS, TRIAL_CAST_MS, TRIAL_DEALT_MULT, TRIAL_EXIT_STUN_MS, TRIAL_MS, TRIAL_RADIUS,
  TARGET_RANGE, TRIAL_RANGE, TRIAL_TAKEN_MULT, WISH_COOLDOWN_SECONDS, WISH_LOCK_SECONDS, wishOf,
  ABILITY_IDS, type AbilityId, type FactionId, type FxEvent, type GameMap, type Vec2, type WeaponId,
  STAGGER_IMMUNITY_SECONDS,
} from "@raid/shared";
import { loadConfig } from "../src/config";
import { abandonPlayer, addPlayer, removePlayer, startRaid, step } from "../src/sim/step";
import { applyDamage, markDropped, markReconnected } from "../src/sim/arena";
import {
  abilityDotFx, armWishes, cancelCast, clearAll, clearFighter, handleCast, statusDamage, updateAbilities, validUnitTarget,
} from "../src/sim/abilities";
import { moveSpeedMult } from "../src/sim/buffs";
import { grantCard } from "../src/sim/chests";
import { combatant, defenseOf, type Combatant } from "../src/sim/combatant";
import { heal, noteContact } from "../src/sim/factions";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { aggro } from "../src/sim/mobAI";
import { recomputeMods } from "../src/sim/mods";
import { placeMob } from "../src/sim/mobLife";
import { addMob } from "../src/sim/mobs";
import { positionAt } from "../src/sim/movement";
import { addStatus, findStatus, isHidden, isStunned, isUntargetable, reveal, statusesOf, statusValue } from "../src/sim/status";
import { installTraining } from "../src/sim/training";
import { stagger } from "../src/sim/weapons";
import type { SimEvent, World } from "../src/sim/world";

const W_TILES = 40;
const H_TILES = 20;
const BIG_HP = 1e9;
const STEP = (PLAYER_SPEED * TICK_MS) / 1000;
const SEC = 1000;

/** A walled 40 x 20 tile room, all floor inside, with `walls` (tile coordinates) as obstacles. */
function arenaMap(walls: ReadonlyArray<readonly [number, number]> = []): GameMap {
  const tiles = new Uint8Array(W_TILES * H_TILES).fill(TILE_FLOOR);
  for (let x = 0; x < W_TILES; x++) { tiles[x] = TILE_WALL; tiles[(H_TILES - 1) * W_TILES + x] = TILE_WALL; }
  for (let y = 0; y < H_TILES; y++) { tiles[y * W_TILES] = TILE_WALL; tiles[y * W_TILES + W_TILES - 1] = TILE_WALL; }
  for (const [x, y] of walls) tiles[y * W_TILES + x] = TILE_WALL;
  return { ...mapFromTiles(W_TILES, H_TILES, tiles), spawns: Array.from({ length: 8 }, (_, i) => ({ x: (3 + i) * TILE + 16, y: 3 * TILE + 16 })) };
}

/** Wall tiles of column `tx`, rows `y0..y1`. */
const column = (tx: number, y0: number, y1: number): Array<[number, number]> =>
  Array.from({ length: y1 - y0 + 1 }, (_, i) => [tx, y0 + i]);

/** A wall at tile column 20 (rows 1 to 18) with a one-tile gate at row 10: a line of sight through it exists until the gates lock. */
function gatedMap(): GameMap {
  const map = arenaMap(column(20, 1, 18).filter(([, y]) => y !== 10));
  const gate = { side: "e" as const, tiles: [{ x: 20, y: 10 }], x: 20 * TILE + 16, y: 10 * TILE + 16 };
  return { ...map, coliseum: { ...map.coliseum, gates: [gate] } };
}

const log: Array<{ at: number; fx: FxEvent }> = [];

interface Fighter {
  faction: FactionId;
  weapons?: [WeaponId | "", (WeaponId | "")?];
  at: Vec2;
  /** Defaults to BIG_HP. */
  hp?: number;
  maxHp?: number;
}

interface RigOpts {
  map?: GameMap;
  /** wishLockSeconds (default 0: every Wish is ready at once); "default" leaves it unset. */
  lock?: number | "default";
  training?: boolean;
  signatures?: boolean;
  patience?: number;
  suddenDeath?: number;
  seed?: number;
}

/** An active run (the first step starts it) of players p0, p1, ... where each test wants them. */
function arena(fighters: Fighter[], opts: RigOpts = {}): World {
  log.length = 0;
  const patience = opts.patience ?? 3600;
  const world = createGameWorld({
    seed: 7, map: { ...(opts.map ?? arenaMap()), seed: 7 },
    config: {
      minPlayers: fighters.length, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: patience, patienceMinSeconds: patience,
      suddenDeathSeconds: opts.suddenDeath ?? 3600, pvpRules: false, ...(opts.lock === "default" ? {} : { wishLockSeconds: opts.lock ?? 0 }),
      ...(opts.training ? { training: true, dummies: false } : {}),
    },
    random: mulberry32(opts.seed ?? 8),
  }, { signatures: opts.signatures === true });
  if (opts.training) installTraining(world);
  world.map = opts.map ?? arenaMap();
  fighters.forEach((f, i) => {
    const p = addPlayer(world, `p${i}`, `player${i}`, { faction: f.faction });
    if (f.weapons) { p.weapon0 = f.weapons[0]; p.weapon1 = f.weapons[1] ?? ""; }
    p.slot = 0;
  });
  if (opts.training) startRaid(world);
  else step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  fighters.forEach((f, i) => {
    const p = P(world, i);
    p.maxHp = f.maxHp ?? f.hp ?? BIG_HP;
    p.hp = f.hp ?? BIG_HP;
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

/** Puts a fighter (a player id, or a mob id) somewhere, with no past, as a placed test fighter has none. */
function place(world: World, who: string, at: Vec2): void {
  const c = combatant(world, who)!;
  c.s.x = at.x;
  c.s.y = at.y;
  c.rt.path = [];
  c.rt.history = [{ t: T(world), x: at.x, y: at.y }];
}

function tick(world: World): SimEvent[] {
  const events = step(world, TICK_MS);
  for (const e of events) if (e.type === "fx") log.push({ at: T(world), fx: e.fx });
  return events;
}
function run(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) tick(world);
}
/** Ticks until the server clock reads `time` (or later, if it is not on the tick grid). */
function runTo(world: World, time: number): void {
  expect(time).toBeGreaterThanOrEqual(T(world));
  while (T(world) < time) tick(world);
}
const runFor = (world: World, ms: number): void => runTo(world, T(world) + ms);

type Fx<K extends FxEvent["kind"]> = { at: number } & Extract<FxEvent, { kind: K }>;
const fxOf = <K extends FxEvent["kind"]>(kind: K): Array<Fx<K>> =>
  log.filter((e) => e.fx.kind === kind).map((e) => ({ at: e.at, ...e.fx })) as Array<Fx<K>>;

function send(world: World, i: number, type: string, msg: unknown = {}): void {
  expect(enqueueClientMessage(RT(world, i).inputs, type, msg), type).toBe(true);
}
/** A cast of p`i`'s Wish at p`target`'s ground point (and id), or at an explicit point. */
function cast(world: World, i: number, at: { target?: number | string; x?: number; y?: number; seq?: number; slot?: string } = {}): void {
  const tid = typeof at.target === "number" ? id(at.target) : at.target;
  const tc = tid ? combatant(world, tid) : null;
  send(world, i, "cast", {
    slot: at.slot ?? "wish", x: at.x ?? tc?.s.x ?? 0, y: at.y ?? tc?.s.y ?? 0, ...(tid ? { id: tid } : {}),
    ...(at.seq !== undefined ? { seq: at.seq } : {}),
  });
}
const lockOn = (world: World, i: number, who: number | string): void => {
  const p = P(world, i); if (p.slot === 0) p.weapon0 = "wand"; else p.weapon1 = "wand";
  send(world, i, "target", { id: typeof who === "number" ? id(who) : who });
};
const walkTo = (world: World, i: number, x: number, y: number): void => send(world, i, "move", { x, y });

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const at = (world: World, who: string): Vec2 => { const c = combatant(world, who)!; return { x: c.s.x, y: c.s.y }; };
const src = (who: string) => ({ id: who, name: who });
const near = (x: number, y = 320): Vec2 => ({ x, y });

/** Seed discovery so these fixtures isolate direct LOS and lock chasing from visibility rejection. */
function primeTrail(world: World, observer: number, point: Vec2): void {
  const memory = getVisionMemory(world, id(observer))!;
  memory.clear();
  memory.update(world.map, point, T(world), VISION_TRAIL_MS, VISION_RADIUS);
}

/** Applies a status as another fighter's, outside the ledger pass. */
function afflict(world: World, who: string, kind: Parameters<typeof addStatus>[2]["kind"], ms: number, extra: Partial<Parameters<typeof addStatus>[2]> = {}): void {
  addStatus(world, combatant(world, who)!, { kind, source: src("x"), ms, ...extra });
}

/** Everything a refused cast must leave alone. */
function snapshot(world: World, i = 0): string {
  const p = P(world, i);
  const rt = RT(world, i);
  return JSON.stringify({
    ready: [p.wishReadyAt, p.qReadyAt, p.eReadyAt], cast: rt.cast ?? null, effects: p.effects, readyAt: p.readyAt, facing: p.facing,
    path: rt.path, lock: rt.weapon.lock, action: rt.weapon.action, statuses: rt.statuses ?? [], x: p.x, y: p.y, fields: world.state.fields.size,
  });
}

const ME = near(300);
const FOE = near(400);

const WISH_KINDS = ["cast", "castLand", "castEnd"] as const;
const castFx = (): Array<{ kind: string }> => log.filter((e) => (WISH_KINDS as readonly string[]).includes(e.fx.kind)).map((e) => e.fx);

// ----------------------------------------------------------------------------------------------------------------
// Validation: refused at no cost, accepted at once
// ----------------------------------------------------------------------------------------------------------------

describe("the cast input: acceptance", () => {
  it("starts the cast, spends the 300 s cooldown at once, faces the target and tells everyone", () => {
    const world = arena([{ faction: "frost", at: ME }, { faction: "fire", at: FOE }]);
    cast(world, 0, { target: 1 });
    tick(world);
    const p = P(world);
    expect(p.wishReadyAt).toBe(T(world) + WISH_COOLDOWN_SECONDS * SEC);
    const c = RT(world).cast!;
    expect(c).toMatchObject({ ability: "freeze", rank: 1, slot: "wish", target: "p1", startedAt: T(world), landsAt: T(world) + FREEZE_CAST_MS });
    expect(fxOf("cast")).toEqual([{ at: T(world), kind: "cast", by: "p0", ability: "freeze", ms: FREEZE_CAST_MS, target: "p1", x: 400, y: 320 }]);
    expect(p.facing).toBeCloseTo(0, 6);
    expect(p.effects & EFFECT_CASTING).toBe(EFFECT_CASTING);
  });

  it("echoes `seq` in moveSeq, accepted or refused", () => {
    const world = arena([{ faction: "frost", at: ME }, { faction: "fire", at: FOE }]);
    cast(world, 0, { target: 1, seq: 41 });
    tick(world);
    expect(P(world).moveSeq).toBe(41);
    cast(world, 0, { target: 1, seq: 42 }); // refused: already casting and on cooldown
    tick(world);
    expect(P(world).moveSeq).toBe(42);
    expect(fxOf("cast")).toHaveLength(1);
  });

  it("a mob or an empty slot casts nothing", () => {
    const world = arena([{ faction: "frost", at: ME }, { faction: "fire", at: FOE }]);
    const mob = combatant(world, addMob(world, { kind: "dummy", name: "dummy", at: near(600) }))!;
    handleCast(world, mob, { kind: "cast", slot: "wish", x: 400, y: 320, id: "p1" });
    expect(mob.rt.cast ?? null).toBeNull();
    const before = snapshot(world);
    cast(world, 0, { target: 1, slot: "q" });
    cast(world, 0, { target: 1, slot: "e" });
    tick(world);
    expect(snapshot(world)).toBe(before);
    expect(castFx()).toEqual([]);
  });

  it("casting never touches the weapon cooldown, and attack-speed cards never stretch a cast or its cooldown", () => {
    const world = arena([{ faction: "holy", at: ME }, { faction: "fire", at: FOE }]);
    const p = P(world);
    p.readyAt = T(world) + 777;
    grantCard(world, combatant(world, "p0") as Extract<Combatant, { kind: "player" }>, "haste3");
    grantCard(world, combatant(world, "p0") as Extract<Combatant, { kind: "player" }>, "vitality3");
    expect(p.asMult).toBeGreaterThan(1000);
    cast(world, 0);
    tick(world);
    expect(p.readyAt).toBe(T(world) - TICK_MS + 777);
    expect(p.wishReadyAt).toBe(T(world) + WISH_COOLDOWN_SECONDS * SEC);

    const frost = arena([{ faction: "frost", at: ME }, { faction: "fire", at: FOE }]);
    grantCard(frost, combatant(frost, "p0") as Extract<Combatant, { kind: "player" }>, "haste3");
    cast(frost, 0, { target: 1 });
    tick(frost);
    expect(RT(frost).cast!.landsAt - RT(frost).cast!.startedAt).toBe(FREEZE_CAST_MS);
    expect(P(frost).wishReadyAt).toBe(T(frost) + WISH_COOLDOWN_SECONDS * SEC);
  });
});

describe("the cast input: lag, hiding and the chill", () => {
  it("keeps the client's render time as a clamped lag: a tick at least, the rewind window at most", () => {
    const lagOf = (t: number | undefined): number => {
      const world = arena([{ faction: "frost", at: ME }, { faction: "fire", at: FOE }]);
      send(world, 0, "cast", { slot: "wish", x: 400, y: 320, id: "p1", ...(t === undefined ? {} : { t: t + T(world) + TICK_MS }) });
      tick(world);
      return RT(world).cast!.lagMs;
    };
    expect(lagOf(undefined)).toBe(TICK_MS);
    expect(lagOf(-120)).toBe(120);
    expect(lagOf(-5000)).toBe(300);
    expect(lagOf(+5000)).toBe(TICK_MS);
  });

  it("a hidden fighter that casts is shown from the cast until it has landed and a moment more", () => {
    const world = arena([{ faction: "frost", at: ME }, { faction: "fire", at: FOE }]);
    afflict(world, "p0", "hidden", 30 * SEC);
    expect(isHidden(world, C(world))).toBe(true);
    cast(world, 0, { target: 1 });
    tick(world);
    const landsAt = RT(world).cast!.landsAt;
    // The reveal takes effect from the next tick: nothing another fighter reads in the cast's own tick changes.
    expect(isHidden(world, C(world))).toBe(true);
    tick(world);
    expect(isHidden(world, C(world))).toBe(false);
    expect(P(world).effects & EFFECT_HIDDEN).toBe(0);
    runTo(world, landsAt + HIDDEN_REVEAL_MS - TICK_MS);
    expect(isHidden(world, C(world))).toBe(false);
    tick(world);
    expect(isHidden(world, C(world))).toBe(true);
    expect(P(world).effects & EFFECT_HIDDEN).toBe(EFFECT_HIDDEN);
  });

  it("the chill that stretches a weapon's cooldown never stretches a cast or the Wish's cooldown", () => {
    const world = arena([{ faction: "plague", weapons: ["sword"], at: ME }, { faction: "frost", weapons: ["sword"], at: near(340) }], { signatures: true });
    noteContact(world, "p0", "p1");
    run(world, 4);
    expect(P(world, 0).sig & SIG_CHILLED).toBe(SIG_CHILLED);
    cast(world, 0);
    tick(world);
    const spent = P(world).wishReadyAt;
    const { startedAt, landsAt } = RT(world).cast!;
    expect(landsAt - startedAt).toBe(SWARM_CAST_MS);
    run(world, 4);
    expect(RT(world).cast).toMatchObject({ startedAt, landsAt });
    expect(P(world).wishReadyAt).toBe(spent);
    tick(world);
    expect(fxOf("castLand")).toMatchObject([{ at: landsAt, ability: "swarm" }]);
  });
});

describe("the cast input: refusals change nothing", () => {
  /** Sends the cast, ticks, and asserts nothing but the clock moved: no cooldown spent, no cast, no fx. */
  function refused(world: World, c: Parameters<typeof cast>[2] = { target: 1 }, i = 0): void {
    const before = snapshot(world, i);
    cast(world, i, c);
    tick(world);
    expect(snapshot(world, i)).toBe(before);
    expect(castFx()).toEqual([]);
  }
  const duo = (extra: Partial<Fighter> = {}, opts: RigOpts = {}) =>
    arena([{ faction: "frost", at: ME, ...extra }, { faction: "fire", at: FOE }, { faction: "plague", at: near(700, 500) }], opts);

  it("the slot is on cooldown", () => {
    const world = duo();
    P(world).wishReadyAt = T(world) + 10 * SEC;
    refused(world);
  });

  it("the Wish is locked for the first 45 s (WISH_LOCK_SECONDS), then opens", () => {
    const world = duo({}, { lock: "default" });
    expect(P(world).wishReadyAt).toBe(world.state.raidStartedAt + WISH_LOCK_SECONDS * SEC);
    refused(world);
    runTo(world, world.state.raidStartedAt + WISH_LOCK_SECONDS * SEC - 2 * TICK_MS);
    refused(world);
    cast(world, 0, { target: 1 });
    tick(world);
    expect(T(world)).toBe(world.state.raidStartedAt + WISH_LOCK_SECONDS * SEC);
    expect(RT(world).cast).toMatchObject({ ability: "freeze" });
  });

  it("wishLockSeconds sets the lock, and the server config carries it", () => {
    const world = duo({}, { lock: 5 });
    expect(P(world).wishReadyAt).toBe(world.state.raidStartedAt + 5 * SEC);
    refused(world);
    expect(loadConfig({}).wishLockSeconds).toBe(WISH_LOCK_SECONDS);
    expect(loadConfig({ WISH_LOCK_SECONDS: "5" }).wishLockSeconds).toBe(5);
    expect(loadConfig({ WISH_LOCK_SECONDS: "nonsense" }).wishLockSeconds).toBe(WISH_LOCK_SECONDS);
  });

  it("no run is active (the lobby, a finished run)", () => {
    const world = duo();
    world.state.phase = "lobby";
    const before = snapshot(world);
    handleCast(world, C(world), { kind: "cast", slot: "wish", x: 400, y: 320, id: "p1" });
    expect(snapshot(world)).toBe(before);
    world.state.phase = "ended";
    handleCast(world, C(world), { kind: "cast", slot: "wish", x: 400, y: 320, id: "p1" });
    expect(snapshot(world)).toBe(before);
  });

  it.each(["stun", "silence"] as const)("the caster is %s", (kind) => {
    const world = duo();
    afflict(world, "p0", kind, 5 * SEC);
    const before = snapshot(world);
    cast(world, 0, { target: 1 });
    tick(world);
    expect(snapshot(world)).toBe(before);
    expect(castFx()).toEqual([]);
  });

  it("a root does not stop a Wish", () => {
    const world = duo();
    afflict(world, "p0", "root", 5 * SEC);
    cast(world, 0, { target: 1 });
    tick(world);
    expect(RT(world).cast).toMatchObject({ ability: "freeze" });
  });

  it("the caster is already casting", () => {
    const world = duo();
    cast(world, 0, { target: 1 });
    tick(world);
    P(world).wishReadyAt = 0; // the cooldown alone would refuse it
    const cast0 = RT(world).cast;
    cast(world, 0, { target: 2 });
    tick(world);
    expect(RT(world).cast).toBe(cast0);
    expect(P(world).wishReadyAt).toBe(0);
    expect(fxOf("cast")).toHaveLength(1);
  });

  it("the caster is down", () => {
    const world = duo();
    P(world).status = "dead";
    const before = snapshot(world);
    handleCast(world, C(world), { kind: "cast", slot: "wish", x: 400, y: 320, id: "p1" });
    expect(snapshot(world)).toBe(before);
  });

  it("the target is out of range plus the slack, in range with the slack, or in range", () => {
    const reach = FREEZE_RANGE + CAST_RANGE_SLACK;
    const out = duo();
    place(out, "p1", near(300 + reach + 1));
    refused(out);
    const slack = duo();
    place(slack, "p1", near(300 + reach - 1));
    cast(slack, 0, { target: 1 });
    tick(slack);
    expect(RT(slack).cast).toMatchObject({ target: "p1" });
    const inRange = duo();
    place(inRange, "p1", near(300 + FREEZE_RANGE));
    cast(inRange, 0, { target: 1 });
    tick(inRange);
    expect(RT(inRange).cast).toMatchObject({ target: "p1" });
  });

  it("the target is behind a wall", () => {
    const world = arena([{ faction: "frost", at: ME }, { faction: "fire", at: FOE }], { map: arenaMap(column(11, 1, 18)) });
    refused(world);
  });

  it("the target is behind a locked gate: the line is open until the gates lock", () => {
    const open = arena([{ faction: "frost", at: near(500) }, { faction: "fire", at: near(780) }], { map: gatedMap() });
    cast(open, 0, { target: 1 });
    tick(open);
    expect(RT(open).cast).toMatchObject({ target: "p1" });
    const locked = arena([{ faction: "frost", at: near(500) }, { faction: "fire", at: near(780) }], { map: gatedMap() });
    locked.state.gatesLocked = true;
    refused(locked);
  });

  it("there is no target, an unknown one, or the caster itself", () => {
    const world = duo();
    refused(world, { x: 400, y: 320 });
    refused(world, { target: "nobody" });
    refused(world, { target: 0 });
  });

  it("the target is down, an enemy mob that is walking home, immune, or untargetable", () => {
    const down = duo();
    P(down, 1).status = "dead";
    refused(down);

    const mobWorld = duo();
    const mob = placeMob(mobWorld, { region: "fire", elite: false, at: near(500) });
    mobWorld.mobs.get(mob)!.brain!.mode = "return";
    refused(mobWorld, { target: mob });

    const immune = duo();
    P(immune, 1).immuneUntil = T(immune) + 5 * SEC;
    refused(immune);

    const hidden = duo();
    afflict(hidden, "p1", "hidden", 5 * SEC);
    refused(hidden);

    const untargetable = duo();
    afflict(untargetable, "p1", "untargetable", 5 * SEC);
    refused(untargetable);
  });

  it("a point cast with no landing (no direction, rock all along the blink) is refused for free", () => {
    const rock = arena([{ faction: "fire", at: near(130) }, { faction: "frost", at: near(1000, 500) }], { map: arenaMap(Array.from({ length: 5 }, (_, i) => column(5 + i, 1, 18)).flat()) });
    refused(rock, { x: 200, y: 320 });
    const onSpot = arena([{ faction: "fire", at: ME }, { faction: "frost", at: near(1000, 500) }]);
    refused(onSpot, { x: 300.5, y: 320 });
  });

  it("validUnitTarget: standing enemies only, in range and (when asked) in sight", () => {
    const world = arena([{ faction: "frost", at: ME }, { faction: "fire", at: FOE }], { map: arenaMap(column(20, 1, 18)) });
    const dummy = combatant(world, addMob(world, { kind: "dummy", name: "dummy", at: near(340) }))!;
    const far = combatant(world, addMob(world, { kind: "dummy", name: "dummy", at: near(900) }))!;
    primeTrail(world, 0, far.s);
    expect(validUnitTarget(world, C(world), C(world, 1), 200, true)).toBe(true);
    expect(validUnitTarget(world, C(world), C(world, 1), 99, true)).toBe(false);
    expect(validUnitTarget(world, C(world), C(world), 500, true)).toBe(false);
    expect(validUnitTarget(world, C(world), dummy, 100, true)).toBe(true);
    expect(validUnitTarget(world, C(world), far, 1000, true)).toBe(false); // the wall at column 20
    expect(validUnitTarget(world, C(world), far, 1000, false)).toBe(true);
    expect(validUnitTarget(world, dummy, C(world), 1000, true)).toBe(true);
    expect(validUnitTarget(world, dummy, far, 1000, false)).toBe(false); // mobs are allies of each other
  });
});

// ----------------------------------------------------------------------------------------------------------------
// Landing, fizzles and interrupts
// ----------------------------------------------------------------------------------------------------------------

describe("Freeze (Frost)", () => {
  const duo = () => arena([{ faction: "frost", at: ME }, { faction: "fire", weapons: ["sword"], at: FOE }, { faction: "plague", at: near(1000, 500) }]);

  it("lands 250 ms after the cast and stuns its target for exactly 1.25 s", () => {
    const world = duo();
    cast(world, 0, { target: 1 });
    tick(world);
    const castAt = T(world);
    runTo(world, castAt + FREEZE_CAST_MS - TICK_MS);
    expect(isStunned(world, C(world, 1))).toBe(false);
    expect(fxOf("castLand")).toEqual([]);
    tick(world);
    const landAt = T(world);
    expect(landAt).toBe(castAt + FREEZE_CAST_MS);
    expect(isStunned(world, C(world, 1))).toBe(true);
    expect(fxOf("castLand")).toEqual([{ at: landAt, kind: "castLand", by: "p0", ability: "freeze", target: "p1", x: 400, y: 320 }]);
    expect(fxOf("status")).toEqual([{ at: landAt, kind: "status", id: "p1", status: "stun", ms: FREEZE_STUN_MS, by: "p0" }]);
    expect(RT(world).cast ?? null).toBeNull();
    expect(P(world).effects & EFFECT_CASTING).toBe(0);
    expect(P(world, 1).effects & EFFECT_STUNNED).toBe(EFFECT_STUNNED);
    runTo(world, landAt + FREEZE_STUN_MS - TICK_MS);
    expect(isStunned(world, C(world, 1))).toBe(true);
    tick(world);
    expect(isStunned(world, C(world, 1))).toBe(false);
    expect(P(world, 1).effects & EFFECT_STUNNED).toBe(0);
    expect(findStatus(C(world, 1), "stun")).toBeUndefined();
  });

  it("cancels the target's windup, the bow's draw included: no arrow leaves, the cooldown stays spent", () => {
    const world = arena([{ faction: "frost", at: ME }, { faction: "plague", weapons: ["bow"], at: near(500) }]);
    expect(P(world, 1).weapon0).toBe("bow");
    // Begin the stun first: the new basic draw can finish before Freeze's 250 ms cast if started in advance.
    cast(world, 0, { target: 1 });
    tick(world);
    runTo(world, RT(world).cast!.landsAt - 2 * TICK_MS);
    send(world, 1, "attack", { a: Math.PI });
    tick(world);
    expect(W(world, 1).action?.kind).toBe("draw");
    expect(P(world, 1).drawStartedAt).toBeGreaterThan(0);
    const ready = P(world, 1).readyAt;
    tick(world);
    expect(isStunned(world, C(world, 1))).toBe(true);
    expect(W(world, 1).action).toBeNull();
    expect(P(world, 1).drawStartedAt).toBe(0);
    expect(P(world, 1).readyAt).toBe(ready);
    runFor(world, FREEZE_STUN_MS - 2 * TICK_MS);
    expect(world.projectiles.size).toBe(0);
    expect(W(world, 1).action).toBeNull(); // the lock holds the trigger, but a stunned archer starts nothing
    // The lock survives it: once the stun is over the archer draws again.
    let drew = false;
    for (let i = 0; i < 60 && !drew; i++) { tick(world); drew = W(world, 1).action !== null; }
    expect(drew).toBe(true);
  });

  it("a stunned target's move order applies, but it does not walk, and its aim does not turn it, until the stun is over", () => {
    const world = duo();
    cast(world, 0, { target: 1 });
    runFor(world, FREEZE_CAST_MS + TICK_MS);
    const landAt = fxOf("castLand")[0]!.at;
    walkTo(world, 1, 700, 320);
    send(world, 1, "aim", { a: 1.2 });
    tick(world);
    expect(RT(world, 1).path.length).toBeGreaterThan(0);
    expect(P(world, 1).facing).not.toBeCloseTo(1.2, 3);
    runTo(world, landAt + FREEZE_STUN_MS - TICK_MS);
    expect(P(world, 1).x).toBe(400);
    tick(world);
    // The Fire target may still have a small roaming bonus, or its charge may have been reset by incoming combat.
    expect(P(world, 1).x).toBeGreaterThanOrEqual(400 + STEP);
    expect(P(world, 1).x).toBeLessThan(400 + STEP * 1.1);
  });

  it("does not stack: a second stun from the same source extends, never doubles", () => {
    const world = duo();
    cast(world, 0, { target: 1 });
    runFor(world, FREEZE_CAST_MS + TICK_MS);
    runFor(world, 500);
    afflict(world, "p1", "stun", FREEZE_STUN_MS, { source: src("p0"), ability: "freeze" });
    expect(statusesOf(C(world, 1)).filter((s) => s.kind === "stun")).toHaveLength(1);
  });
});

describe("a cast that fails at its landing keeps its cooldown spent and says so (castEnd fizzle)", () => {
  const duo = () => arena([{ faction: "frost", at: ME }, { faction: "fire", at: FOE }, { faction: "plague", at: near(1000, 500) }]);
  const cases: Array<[string, (w: World) => void]> = [
    ["walks out of range", (w) => place(w, "p1", near(300 + FREEZE_RANGE + CAST_RANGE_SLACK + 5))],
    ["goes behind a wall", (w) => { w.map.tiles[10 * W_TILES + 11] = TILE_WALL; w.map.tiles[9 * W_TILES + 11] = TILE_WALL; }],
    ["turns untargetable", (w) => afflict(w, "p1", "untargetable", 5 * SEC)],
    ["goes hidden", (w) => afflict(w, "p1", "hidden", 5 * SEC)],
    ["gains teleport immunity", (w) => { P(w, 1).immuneUntil = T(w) + 5 * SEC; }],
    ["is killed", (w) => { applyDamage(w, P(w, 1), RT(w, 1), BIG_HP * 2, "test"); }],
  ];
  it.each(cases)("a target that %s", (_name, mutate) => {
    const world = duo();
    cast(world, 0, { target: 1 });
    tick(world);
    const spent = P(world).wishReadyAt;
    expect(spent).toBe(T(world) + WISH_COOLDOWN_SECONDS * SEC);
    mutate(world);
    runTo(world, RT(world).cast!.landsAt);
    expect(fxOf("castEnd")).toEqual([{ at: T(world), kind: "castEnd", by: "p0", ability: "freeze", reason: "fizzle" }]);
    expect(fxOf("castLand")).toEqual([]);
    expect(fxOf("status").filter((f) => f.status === "stun")).toEqual([]);
    expect(RT(world).cast ?? null).toBeNull();
    expect(P(world).effects & EFFECT_CASTING).toBe(0);
    expect(P(world).wishReadyAt).toBe(spent);
    expect(isStunned(world, C(world, 1))).toBe(false);
  });

  it("a mob that started walking home", () => {
    const world = duo();
    const mob = placeMob(world, { region: "fire", elite: false, at: near(500) });
    cast(world, 0, { target: mob });
    tick(world);
    place(world, mob, near(560)); // away from its camp, so the walk home takes longer than the cast
    world.mobs.get(mob)!.brain!.mode = "return";
    runTo(world, RT(world).cast!.landsAt);
    expect(fxOf("castEnd")).toMatchObject([{ reason: "fizzle" }]);
    expect(isStunned(world, combatant(world, mob)!)).toBe(false);
  });

  it("a caster that was stunned or silenced is interrupted instead (castEnd interrupted), never refunded", () => {
    for (const kind of ["stun", "silence"] as const) {
      const world = duo();
      cast(world, 0, { target: 1 });
      tick(world);
      const spent = P(world).wishReadyAt;
      afflict(world, "p1", kind, SEC); // someone else: nothing happens to p0's cast
      expect(RT(world).cast).not.toBeNull();
      afflict(world, "p0", kind, SEC);
      expect(RT(world).cast ?? null).toBeNull();
      expect(P(world).effects & EFFECT_CASTING).toBe(0);
      tick(world);
      expect(fxOf("castEnd")).toEqual([{ at: T(world), kind: "castEnd", by: "p0", ability: "freeze", reason: "interrupted" }]);
      runFor(world, 2 * SEC);
      expect(fxOf("castLand")).toEqual([]);
      expect(P(world).wishReadyAt).toBe(spent);
    }
  });
});

describe("what interrupts a Wish: only a stun or a silence", () => {
  const duo = () => arena([{ faction: "frost", at: ME }, { faction: "fire", weapons: ["sword"], at: FOE }, { faction: "plague", at: near(1000, 500) }]);

  it("a root, a slow and a stagger do not", () => {
    const world = duo();
    cast(world, 0, { target: 1 });
    tick(world);
    afflict(world, "p0", "root", SEC);
    afflict(world, "p0", "slowMove", SEC, { value: 0.4 });
    expect(stagger(world, C(world))).toBe(true);
    expect(fxOf("castEnd")).toEqual([]);
    expect(RT(world).cast).not.toBeNull();
    runTo(world, RT(world).cast!.landsAt);
    expect(fxOf("castLand")).toHaveLength(1);
    expect(isStunned(world, C(world, 1))).toBe(true);
  });

  it("the cast roots the caster; its own move order is kept and walked once the cast has landed, and its lock survives", () => {
    const world = duo();
    lockOn(world, 0, 1);
    tick(world);
    cast(world, 0, { target: 1 });
    tick(world);
    const x0 = P(world).x;
    walkTo(world, 0, 100, 320);
    run(world, 3);
    expect(P(world).x).toBe(x0);
    expect(RT(world).path.length).toBeGreaterThan(0);
    expect(RT(world).cast).not.toBeNull();
    // The walk order ended the lock (a move always does); the cast is the player's own and stays.
    runTo(world, RT(world).cast!.landsAt - TICK_MS);
    expect(P(world).x).toBe(x0);
    tick(world);
    expect(P(world).x).toBeCloseTo(x0 - STEP, 6);
  });

  it("an enemy's lock on the caster does not stop the cast either", () => {
    const world = duo();
    lockOn(world, 1, 0);
    cast(world, 0, { target: 1 });
    runTo(world, T(world) + FREEZE_CAST_MS + TICK_MS);
    expect(fxOf("castLand")).toHaveLength(1);
  });
});

describe("starting a cast and the weapon in hand", () => {
  it("a cast with a telegraph cancels the windup its lock started (cooldown refunded, cancel fx) and keeps the lock", () => {
    const world = arena([{ faction: "frost", weapons: ["bow"], at: ME }, { faction: "fire", at: FOE }]);
    lockOn(world, 0, 1);
    tick(world);
    const act = W(world).action!;
    expect(act.kind).toBe("cast");
    cast(world, 0, { target: 1 });
    tick(world);
    expect(fxOf("cancel")).toEqual([{ at: T(world), kind: "cancel", id: "p0" }]);
    expect(W(world).action).toBeNull();
    expect(P(world).drawStartedAt).toBe(0);
    expect(P(world).readyAt).toBe(act.startedAt);
    expect(W(world).lock).toBe("p1");
    expect(P(world).attackTarget).toBe("p1");
  });

  it("a directional windup (an attack input) is cancelled too, with its cooldown spent", () => {
    const world = arena([{ faction: "frost", weapons: ["axe"], at: ME }, { faction: "fire", at: FOE }]);
    send(world, 0, "attack", { a: 0 });
    tick(world);
    const act = W(world).action!;
    expect(act).not.toBeNull();
    const ready = P(world).readyAt;
    cast(world, 0, { target: 1 });
    tick(world);
    expect(fxOf("cancel")).toEqual([{ at: T(world), kind: "cancel", id: "p0" }]);
    expect(W(world).action).toBeNull();
    expect(P(world).readyAt).toBe(ready);
  });

  it("no attack starts while casting; the held trigger resumes it after the cast lands", () => {
    const world = arena([{ faction: "frost", weapons: ["sword"], at: ME }, { faction: "fire", at: FOE }]);
    lockOn(world, 0, 1);
    cast(world, 0, { target: 1 });
    tick(world);
    const landsAt = RT(world).cast!.landsAt;
    expect(W(world).action).toBeNull();
    while (T(world) < landsAt - TICK_MS) { tick(world); expect(W(world).action).toBeNull(); }
    let swung = false;
    for (let i = 0; i < 20 && !swung; i++) { tick(world); swung = W(world).action !== null; }
    expect(swung).toBe(true);
    expect(RT(world).cast ?? null).toBeNull();
    expect(W(world).lock).toBe("p1");
  });

  it("a cast with no telegraph and no own order (Last Stand) leaves a windup alone", () => {
    const world = arena([{ faction: "holy", weapons: ["axe"], at: ME }, { faction: "fire", at: FOE }]);
    send(world, 0, "attack", { a: 0 });
    tick(world);
    const act = W(world).action;
    expect(act).not.toBeNull();
    cast(world, 0);
    tick(world);
    expect(fxOf("cancel")).toEqual([]);
    expect(W(world).action).toBe(act);
  });
});

describe("casts due in the same tick land together (D8)", () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7];

  it.each(seeds)("two Freezes on each other (seed %i): both land, neither stun interrupts the other", (seed) => {
    const world = arena([{ faction: "frost", at: ME }, { faction: "frost", at: FOE }, { faction: "fire", at: near(1000, 500) }], { seed });
    cast(world, 0, { target: 1 });
    cast(world, 1, { target: 0 });
    runFor(world, FREEZE_CAST_MS + TICK_MS);
    expect(fxOf("castEnd")).toEqual([]);
    expect(fxOf("castLand").map((f) => f.by).sort()).toEqual(["p0", "p1"]);
    expect(isStunned(world, C(world, 0))).toBe(true);
    expect(isStunned(world, C(world, 1))).toBe(true);
  });

  it.each(seeds)("a Freeze and a Swarm on its target (seed %i): the Freeze was valid when the phase began, so it lands on the swarmer", (seed) => {
    const world = arena([{ faction: "frost", at: ME }, { faction: "plague", at: FOE }, { faction: "fire", at: near(1000, 500) }], { seed });
    cast(world, 0, { target: 1 });
    cast(world, 1);
    runFor(world, FREEZE_CAST_MS + TICK_MS);
    expect(fxOf("castEnd")).toEqual([]);
    expect(isHidden(world, C(world, 1))).toBe(true);
    expect(isStunned(world, C(world, 1))).toBe(true);
    expect(isStunned(world, C(world, 0))).toBe(false);
    expect(fxOf("castLand").map((f) => f.ability).sort()).toEqual(["freeze", "swarm"]);
  });

  it.each(seeds)("a Freeze one tick after a Swarm (seed %i) fizzles: the swarmer is untargetable by then", (seed) => {
    const world = arena([{ faction: "frost", at: ME }, { faction: "plague", at: FOE }, { faction: "fire", at: near(1000, 500) }], { seed });
    cast(world, 1);
    tick(world);
    cast(world, 0, { target: 1 });
    runFor(world, FREEZE_CAST_MS + 2 * TICK_MS);
    expect(fxOf("castEnd")).toMatchObject([{ by: "p0", ability: "freeze", reason: "fizzle" }]);
    expect(isStunned(world, C(world, 1))).toBe(false);
  });
});

describe("mobs as targets", () => {
  it("Freeze stuns a dummy", () => {
    const world = arena([{ faction: "frost", at: ME }, { faction: "fire", at: near(1000, 500) }]);
    const dummy = addMob(world, { kind: "dummy", name: "dummy", at: near(400) });
    cast(world, 0, { target: dummy });
    runFor(world, FREEZE_CAST_MS + TICK_MS);
    expect(isStunned(world, combatant(world, dummy)!)).toBe(true);
    expect(combatant(world, dummy)!.s.effects & EFFECT_STUNNED).toBe(EFFECT_STUNNED);
    expect(fxOf("status")).toMatchObject([{ id: dummy, status: "stun", by: "p0" }]);
  });

  it("a stunned regional mob drops its windup, does not walk or attack, and fights again after the stun", () => {
    const world = arena([{ faction: "frost", at: ME }, { faction: "fire", at: near(1000, 500) }]);
    const mobId = placeMob(world, { region: "fire", elite: false, at: near(460) });
    const mob = combatant(world, mobId) as Extract<Combatant, { kind: "mob" }>;
    aggro(world, mob, "p0", 10);
    expect(mob.rt.brain!.mode).toBe("fight");
    run(world, 4);
    cast(world, 0, { target: mobId });
    runFor(world, FREEZE_CAST_MS + TICK_MS);
    const landAt = fxOf("castLand")[0]!.at;
    expect(isStunned(world, mob)).toBe(true);
    expect(mob.rt.weapon.action).toBeNull();
    const frozenAt = at(world, mobId);
    const windups = (): number => fxOf("windup").filter((f) => f.by === mobId && f.at > landAt).length;
    const before = windups();
    runTo(world, landAt + FREEZE_STUN_MS - TICK_MS);
    expect(windups()).toBe(before);
    expect(at(world, mobId)).toEqual(frozenAt);
    run(world, 60);
    expect(windups()).toBeGreaterThan(before);
  });
});

// ----------------------------------------------------------------------------------------------------------------
// The Wishes
// ----------------------------------------------------------------------------------------------------------------

/** A hit through the real ledger (true damage, so the numbers are exact), outside a tick. */
function hit(world: World, by: string, victim: string, raw: number, extra: { arena?: boolean } = {}): number {
  const c = combatant(world, victim)!;
  const before = c.s.hp;
  recordHit(world, {
    victim, by: src(by), packet: { raw, phys: 0, magic: 0, true: 1 }, weapon: "sword", stagger: false, ...(extra.arena ? { arena: true } : {}),
  });
  applyLedger(world);
  return before - c.s.hp;
}

describe("Swarm (Plague)", () => {
  const trio = () => arena([
    { faction: "plague", weapons: ["sword"], at: ME }, { faction: "fire", weapons: ["sword"], at: FOE }, { faction: "holy", at: near(1000, 500) },
  ]);

  it("lands 250 ms after the cast: hidden for 8 s, with a cloud over it that is never moved and goes with it", () => {
    const world = trio();
    cast(world, 0);
    tick(world);
    const castAt = T(world);
    expect(fxOf("cast")).toEqual([{ at: castAt, kind: "cast", by: "p0", ability: "swarm", ms: SWARM_CAST_MS, target: null, x: 300, y: 320 }]);
    expect(P(world).effects & EFFECT_HIDDEN).toBe(0);
    runTo(world, castAt + SWARM_CAST_MS);
    const landAt = T(world);
    expect(isHidden(world, C(world))).toBe(true);
    expect(isUntargetable(world, C(world))).toBe(true);
    expect(P(world).effects & EFFECT_HIDDEN).toBe(EFFECT_HIDDEN);
    expect(fxOf("castLand")).toEqual([{ at: landAt, kind: "castLand", by: "p0", ability: "swarm", target: null, x: 300, y: 320 }]);
    expect(fxOf("status")).toEqual([{ at: landAt, kind: "status", id: "p0", status: "hidden", ms: SWARM_MS, by: "p0" }]);
    const fields = [...world.state.fields.values()];
    expect(fields).toHaveLength(1);
    const f = fields[0]!;
    expect([f.kind, f.ability, f.r, f.owner, f.subject, f.startedAt, f.endsAt]).toEqual([
      FIELD_KINDS.indexOf("cloud"), ABILITY_IDS.indexOf("swarm"), SWARM_CLOUD_RADIUS, "p0", "", landAt, landAt + SWARM_MS,
    ]);
    walkTo(world, 0, 500, 320);
    run(world, 10);
    expect(P(world).x).toBeGreaterThan(300);
    expect([f.x, f.y]).toEqual([300, 320]); // the clients draw the cloud at its owner; the server never moves it
    runTo(world, landAt + SWARM_MS - TICK_MS);
    expect(isHidden(world, C(world))).toBe(true);
    expect(world.state.fields.size).toBe(1);
    tick(world);
    expect(isHidden(world, C(world))).toBe(false);
    expect(P(world).effects & EFFECT_HIDDEN).toBe(0);
    expect(world.state.fields.size).toBe(0);
    expect(statusesOf(C(world))).toEqual([]);
  });

  it("enemies cannot lock it: an existing lock drops in the landing tick, a new order does nothing", () => {
    const world = trio();
    lockOn(world, 1, 0);
    tick(world);
    expect(W(world, 1).lock).toBe("p0");
    cast(world, 0);
    tick(world);
    runTo(world, RT(world).cast!.landsAt - TICK_MS);
    expect(W(world, 1).lock).toBe("p0");
    tick(world);
    expect(isHidden(world, C(world))).toBe(true);
    expect(W(world, 1).lock).toBeNull();
    expect(P(world, 1).attackTarget).toBe("");
    lockOn(world, 1, 0);
    lockOn(world, 2, 0);
    run(world, 2);
    expect(W(world, 1).lock).toBeNull();
    expect(W(world, 2).lock).toBeNull();
    // It can lock them: hiding is not blindness.
    lockOn(world, 0, 1);
    tick(world);
    expect(W(world, 0).lock).toBe("p1");
  });

  it("a mob fighting it loses it as a target and goes home; with someone else in the fight, it turns on them", () => {
    const alone = arena([{ faction: "plague", at: ME }, { faction: "fire", at: near(1000, 500) }]);
    const mobId = placeMob(alone, { region: "holy", elite: false, at: near(500) });
    const mob = combatant(alone, mobId) as Extract<Combatant, { kind: "mob" }>;
    aggro(alone, mob, "p0", 10);
    run(alone, 12);
    expect(mob.rt.brain!.target).toBe("p0");
    cast(alone, 0);
    runFor(alone, SWARM_CAST_MS + 3 * TICK_MS);
    expect(isHidden(alone, C(alone))).toBe(true);
    expect(mob.rt.brain!.target).toBeNull();
    expect(mob.rt.brain!.mode).not.toBe("fight");

    const two = arena([{ faction: "plague", at: ME }, { faction: "fire", at: near(500, 500) }]);
    const mob2Id = placeMob(two, { region: "holy", elite: false, at: near(500) });
    const mob2 = combatant(two, mob2Id) as Extract<Combatant, { kind: "mob" }>;
    aggro(two, mob2, "p0", 10);
    mob2.rt.brain!.threat.set("p1", 5);
    run(two, 4);
    cast(two, 0);
    runFor(two, SWARM_CAST_MS + 3 * TICK_MS);
    expect(mob2.rt.brain!.mode).toBe("fight");
    expect(mob2.rt.brain!.target).toBe("p1");
  });

  it("its own attack shows it from the start until the swing has landed and a moment more, and it can be locked meanwhile", () => {
    const world = trio();
    cast(world, 0);
    runFor(world, SWARM_CAST_MS + TICK_MS);
    expect(isHidden(world, C(world))).toBe(true);
    lockOn(world, 0, 1);
    let act = W(world).action;
    for (let i = 0; i < 40 && !act; i++) { tick(world); act = W(world).action; }
    expect(act).not.toBeNull();
    expect(isHidden(world, C(world))).toBe(true); // shown from the next tick: the attack's own tick reads as before it
    tick(world);
    expect(isHidden(world, C(world))).toBe(false);
    expect(P(world).effects & EFFECT_HIDDEN).toBe(0);
    expect(isUntargetable(world, C(world))).toBe(false);
    lockOn(world, 1, 0);
    tick(world);
    expect(W(world, 1).lock).toBe("p0");
    runTo(world, act!.landsAt + TICK_MS);
    send(world, 0, "stop"); // the swing has landed: stopping cancels nothing, and nothing new starts
    runTo(world, act!.landsAt + HIDDEN_REVEAL_MS - TICK_MS);
    expect(isHidden(world, C(world))).toBe(false);
    expect(W(world, 1).lock).toBe("p0");
    tick(world);
    expect(T(world)).toBe(Math.ceil((act!.landsAt + HIDDEN_REVEAL_MS) / TICK_MS) * TICK_MS);
    expect(isHidden(world, C(world))).toBe(true);
    expect(P(world).effects & EFFECT_HIDDEN).toBe(EFFECT_HIDDEN);
    expect(W(world, 1).lock).toBeNull(); // untargetable again: the lock drops in the same tick
  });

  it("a bow's attack keeps it shown until the arrow has left, however long the draw is stretched", () => {
    const world = arena([{ faction: "plague", weapons: ["bow"], at: ME }, { faction: "fire", weapons: ["sword"], at: near(500) }]);
    expect(P(world).weapon0).toBe("bow");
    cast(world, 0);
    runFor(world, SWARM_CAST_MS + TICK_MS);
    send(world, 0, "attack", { a: 0 });
    let act = W(world).action;
    for (let i = 0; i < 40 && !act; i++) { tick(world); act = W(world).action; }
    expect(act?.kind).toBe("draw");
    act!.landsAt += 400; // a chilled draw ends later than it was started with (sim/factions.ts)
    runTo(world, act!.landsAt + HIDDEN_REVEAL_MS - TICK_MS);
    expect(isHidden(world, C(world))).toBe(false);
  });

  it("is refused by stun, and lands no cloud for a Swarm that was interrupted", () => {
    const world = trio();
    cast(world, 0);
    tick(world);
    afflict(world, "p0", "silence", SEC);
    run(world, 10);
    expect(world.state.fields.size).toBe(0);
    expect(isHidden(world, C(world))).toBe(false);
    expect(fxOf("castEnd")).toMatchObject([{ ability: "swarm", reason: "interrupted" }]);
  });
});

describe("Trial (Sentenced)", () => {
  const trio = () => arena([
    { faction: "sentenced", weapons: ["sword"], at: ME, hp: 1000 }, { faction: "fire", weapons: ["sword"], at: FOE, hp: 1000 },
    { faction: "holy", at: near(450, 500), hp: 1000 },
  ]);
  /** The trio with Trial landed on p1, and the landing time. */
  function judged(): { world: World; landAt: number } {
    const world = trio();
    cast(world, 0, { target: 1 });
    runFor(world, TRIAL_CAST_MS + TICK_MS);
    return { world, landAt: fxOf("castLand")[0]!.at };
  }

  it("lands 350 ms after the cast: a zone around the target, where it stood then, and the target is zoned for 5 s", () => {
    const world = trio();
    cast(world, 0, { target: 1 });
    tick(world);
    const castAt = T(world);
    expect(fxOf("cast")).toEqual([{ at: castAt, kind: "cast", by: "p0", ability: "trial", ms: TRIAL_CAST_MS, target: "p1", x: 400, y: 320 }]);
    walkTo(world, 1, 700, 320);
    runTo(world, castAt + TRIAL_CAST_MS - TICK_MS);
    expect(world.state.fields.size).toBe(0);
    const stood = at(world, "p1"); // where it stood when the landing tick began
    tick(world);
    const landAt = T(world);
    expect(landAt).toBe(castAt + TRIAL_CAST_MS);
    const f = [...world.state.fields.values()][0]!;
    expect([f.kind, f.ability, f.r, f.owner, f.subject, f.startedAt, f.endsAt, f.x, f.y]).toEqual([
      FIELD_KINDS.indexOf("zone"), ABILITY_IDS.indexOf("trial"), TRIAL_RADIUS, "p0", "p1", landAt, landAt + TRIAL_MS, stood.x, stood.y,
    ]);
    const st = findStatus(C(world, 1), "zoned", "p0")!;
    expect(st).toMatchObject({ until: landAt + TRIAL_MS, dealtMult: TRIAL_DEALT_MULT, takenFromSourceMult: TRIAL_TAKEN_MULT });
    expect(P(world, 1).effects & EFFECT_ZONED).toBe(EFFECT_ZONED);
    expect(fxOf("status")).toEqual([{ at: landAt, kind: "status", id: "p1", status: "zoned", ms: TRIAL_MS, by: "p0" }]);
    expect(fxOf("castLand")).toEqual([{ at: landAt, kind: "castLand", by: "p0", ability: "trial", target: "p1", x: stood.x, y: stood.y }]);
  });

  it("the zoned fighter deals 20% less to anyone, takes 20% more from the caster only, and the arena's burn is exempt", () => {
    const { world } = judged();
    expect(hit(world, "p1", "p2", 100)).toBeCloseTo(80, 9);
    expect(hit(world, "p1", "p0", 100)).toBeCloseTo(80, 9);
    expect(hit(world, "p0", "p1", 100)).toBeCloseTo(120, 9);
    expect(hit(world, "p2", "p1", 100)).toBeCloseTo(100, 9);
    expect(hit(world, "p0", "p2", 100)).toBeCloseTo(100, 9);
    expect(hit(world, "p1", "p1", 100, { arena: true })).toBeCloseTo(100, 9);
  });

  it("ends by itself after 5 s: the field and the status go together, with no stun", () => {
    const { world, landAt } = judged();
    runTo(world, landAt + TRIAL_MS - TICK_MS);
    expect(world.state.fields.size).toBe(1);
    expect(isStunned(world, C(world, 1))).toBe(false);
    tick(world);
    expect(world.state.fields.size).toBe(0);
    expect(findStatus(C(world, 1), "zoned")).toBeUndefined();
    expect(P(world, 1).effects & EFFECT_ZONED).toBe(0);
    expect(isStunned(world, C(world, 1))).toBe(false);
    expect(hit(world, "p1", "p2", 100)).toBeCloseTo(100, 9);
  });

  it("leaving the zone ends it and stuns the subject for 1.5 s, from the caster; the edge is inside", () => {
    const { world, landAt } = judged();
    const centre = { x: (world.state.fields.values().next().value!).x, y: 320 };
    run(world, 3);
    place(world, "p1", { x: centre.x + TRIAL_RADIUS, y: 320 });
    tick(world);
    expect(world.state.fields.size).toBe(1);
    place(world, "p1", { x: centre.x + TRIAL_RADIUS + 1, y: 320 });
    tick(world);
    const exitAt = T(world);
    expect(world.state.fields.size).toBe(0);
    expect(findStatus(C(world, 1), "zoned")).toBeUndefined();
    const stun = findStatus(C(world, 1), "stun", "p0")!;
    expect(stun.until).toBe(exitAt + TRIAL_EXIT_STUN_MS);
    expect(fxOf("status").filter((f) => f.at === exitAt)).toEqual([{ at: exitAt, kind: "status", id: "p1", status: "stun", ms: TRIAL_EXIT_STUN_MS, by: "p0" }]);
    expect(isStunned(world, C(world, 1))).toBe(true);
    expect(exitAt).toBeGreaterThan(landAt);
    runTo(world, exitAt + TRIAL_EXIT_STUN_MS);
    expect(isStunned(world, C(world, 1))).toBe(false);
  });

  it("a Blaze Step out of the zone is caught in the same tick it lands", () => {
    const world = arena([
      { faction: "sentenced", weapons: ["sword"], at: ME, hp: 1000 }, { faction: "fire", weapons: ["sword"], at: FOE, hp: 1000 },
      { faction: "holy", at: near(450, 500), hp: 1000 },
    ]);
    cast(world, 0, { target: 1 });
    runFor(world, TRIAL_CAST_MS + TICK_MS);
    const zone = [...world.state.fields.values()][0]!;
    place(world, "p1", near(zone.x + 100)); // still inside the 300 u zone
    tick(world);
    expect(world.state.fields.size).toBe(1);
    cast(world, 1, { x: zone.x + 900, y: 320 }); // Blaze Step 300 u east: 400 u from the zone's centre
    tick(world);
    const landing = near(zone.x + 400);
    expect(at(world, "p1")).toEqual(landing);
    expect([...world.state.fields.values()].filter((f) => f.kind === FIELD_KINDS.indexOf("zone"))).toEqual([]);
    expect(findStatus(C(world, 1), "zoned")).toBeUndefined();
    expect(findStatus(C(world, 1), "stun", "p0")?.until).toBe(T(world) + TRIAL_EXIT_STUN_MS);
  });

  it("ends silently when its subject is gone, dies or walks home: no stun for anyone", () => {
    for (const how of ["leaves", "dies"] as const) {
      const { world } = judged();
      if (how === "leaves") removePlayer(world, "p1");
      else applyDamage(world, P(world, 1), RT(world, 1), 1e6, "test");
      run(world, 2);
      expect(world.state.fields.size).toBe(0);
      expect(fxOf("status").filter((f) => f.status === "stun")).toEqual([]);
    }
    const world = arena([{ faction: "sentenced", at: ME }, { faction: "fire", at: near(1000, 500) }]);
    const mob = placeMob(world, { region: "holy", elite: false, at: near(500) });
    cast(world, 0, { target: mob });
    runFor(world, TRIAL_CAST_MS + TICK_MS);
    expect(world.state.fields.size).toBe(1);
    expect(findStatus(combatant(world, mob)!, "zoned")).toBeDefined();
    place(world, mob, near(560));
    world.mobs.get(mob)!.brain!.mode = "return";
    tick(world);
    expect(world.state.fields.size).toBe(0);
    expect(findStatus(combatant(world, mob)!, "zoned")).toBeUndefined();
    expect(fxOf("status").filter((f) => f.status === "stun")).toEqual([]);
  });

  it("a dummy can be judged, and stunned when it leaves", () => {
    const world = arena([{ faction: "sentenced", at: ME }, { faction: "fire", at: near(1000, 500) }]);
    const dummy = addMob(world, { kind: "dummy", name: "dummy", at: near(450) });
    cast(world, 0, { target: dummy });
    runFor(world, TRIAL_CAST_MS + TICK_MS);
    const zone = [...world.state.fields.values()][0]!;
    expect(zone.subject).toBe(dummy);
    expect(combatant(world, dummy)!.s.effects & EFFECT_ZONED).toBe(EFFECT_ZONED);
    place(world, dummy, near(zone.x + TRIAL_RADIUS + 20));
    tick(world);
    expect(isStunned(world, combatant(world, dummy)!)).toBe(true);
    expect(world.state.fields.size).toBe(0);
  });

  it("the range is 400 u plus the slack", () => {
    const world = trio();
    place(world, "p1", near(300 + TRIAL_RANGE + CAST_RANGE_SLACK + 2));
    cast(world, 0, { target: 1 });
    tick(world);
    expect(RT(world).cast ?? null).toBeNull();
    place(world, "p1", near(300 + TRIAL_RANGE + CAST_RANGE_SLACK - 2));
    cast(world, 0, { target: 1 });
    tick(world);
    expect(RT(world).cast).toMatchObject({ ability: "trial" });
  });
});

describe("Blaze Step (Fire)", () => {
  const trio = (hp = 1000) => arena([
    { faction: "fire", weapons: ["sword"], at: ME, hp }, { faction: "frost", weapons: ["sword"], at: near(450, 600), hp },
    { faction: "holy", at: near(1000, 500), hp },
  ]);
  const blaze = (world: World, to: Vec2, i = 0, seq?: number): void => cast(world, i, { x: to.x, y: to.y, ...(seq !== undefined ? { seq } : {}) });
  const trailOf = (world: World) => [...world.state.fields.values()].filter((f) => f.kind === FIELD_KINDS.indexOf("trail"));

  it("blinks in the tick it is cast: 300 u toward the cursor, history reset, a trail left behind", () => {
    const world = trio();
    const p = P(world);
    const seq0 = p.displaceSeq;
    blaze(world, near(900), 0, 9);
    tick(world);
    const landAt = T(world);
    expect(at(world, "p0")).toEqual(near(600));
    expect(p.displaceSeq).toBe(seq0 + 1);
    expect(p.moveSeq).toBe(9);
    expect(RT(world).history.every((h) => h.x === 600 && h.y === 320)).toBe(true);
    expect(positionAt(RT(world), p, landAt - 200)).toEqual(near(600));
    expect(RT(world).cast ?? null).toBeNull();
    expect(p.effects & EFFECT_CASTING).toBe(0);
    expect(p.wishReadyAt).toBe(landAt + WISH_COOLDOWN_SECONDS * SEC);
    expect(fxOf("cast")).toEqual([]);
    expect(fxOf("castLand")).toEqual([{ at: landAt, kind: "castLand", by: "p0", ability: "blaze", target: null, x: 300, y: 320, x2: 600, y2: 320 }]);
    const [trail] = trailOf(world);
    expect([trail!.x, trail!.y, trail!.x2, trail!.y2, trail!.r, trail!.owner, trail!.startedAt, trail!.endsAt]).toEqual([
      300, 320, 600, 320, BLAZE_TRAIL_HALF_WIDTH, "p0", landAt, landAt + BLAZE_TRAIL_MS,
    ]);
    runTo(world, landAt + BLAZE_TRAIL_MS - TICK_MS);
    expect(trailOf(world)).toHaveLength(1);
    tick(world);
    expect(trailOf(world)).toHaveLength(0);
  });

  it("lands where the shared blinkLanding says, for a far, a near and a point-blank cursor, through a wall", () => {
    // Two tiles of rock with a way round at the bottom: a blink lands only on floor connected to where it started (D16).
    const wall = arenaMap(column(12, 1, 16).concat(column(13, 1, 16)));
    for (const to of [near(900), near(380), near(310), near(300.4 + 1), { x: 300, y: 600 }, { x: 500, y: 100 }]) {
      const world = arena([{ faction: "fire", at: ME }, { faction: "frost", at: near(1000, 500) }], { map: wall });
      const want = blinkLanding(world.map, false, ME, to);
      blaze(world, to);
      tick(world);
      if (want === null) expect(at(world, "p0")).toEqual(ME);
      else expect(at(world, "p0")).toEqual(want);
    }
    const world = arena([{ faction: "fire", at: ME }, { faction: "frost", at: near(1000, 500) }], { map: wall });
    blaze(world, near(500));
    tick(world);
    expect(at(world, "p0")).toEqual(near(500)); // 200 u east, beyond the two wall tiles
    const near64 = arena([{ faction: "fire", at: ME }, { faction: "frost", at: near(1000, 500) }]);
    blaze(near64, near(330)); // a cursor 30 u away still blinks the minimum
    tick(near64);
    expect(at(near64, "p0").x).toBeCloseTo(300 + BLAZE_MIN_DIST, 6);
  });

  it("a locked gate seals the blink: it never lands across it", () => {
    const world = arena([{ faction: "fire", at: near(500) }, { faction: "frost", at: near(1000, 500) }], { map: gatedMap() });
    world.state.gatesLocked = true;
    blaze(world, near(900));
    tick(world);
    expect(at(world, "p0").x).toBeLessThan(640);
    expect(at(world, "p0").x).toBeGreaterThan(500);
  });

  it("is an own order: it cancels the windup its lock started, drops the lock and the path, and the attack comes no more", () => {
    const world = arena([{ faction: "fire", weapons: ["bow"], at: ME }, { faction: "frost", at: near(450) }, { faction: "holy", at: near(1000, 500) }]);
    lockOn(world, 0, 1);
    tick(world);
    const act = W(world).action!;
    expect(act.kind).toBe("cast");
    blaze(world, near(100));
    tick(world);
    expect(fxOf("cancel")).toEqual([{ at: T(world), kind: "cancel", id: "p0" }]);
    expect(W(world).action).toBeNull();
    expect(P(world).readyAt).toBe(act.startedAt);
    expect(W(world).lock).toBeNull();
    expect(P(world).attackTarget).toBe("");
    expect(RT(world).path).toEqual([]);
    expect(at(world, "p0")).toEqual(near(100)); // the cursor 200 u west
    run(world, 20);
    expect(W(world).action).toBeNull();
    expect(world.projectiles.size).toBe(0);
  });

  it("a move ordered after it in the same tick is walked from the landing; one before it is dropped with the path", () => {
    const after = trio();
    blaze(after, near(900));
    walkTo(after, 0, 700, 320);
    tick(after);
    expect(P(after).x).toBeCloseTo(600 + STEP, 6);
    expect(RT(after).path.length).toBeGreaterThan(0);

    const before = trio();
    walkTo(before, 0, 100, 320);
    blaze(before, near(900));
    // The inputs queue as: move (arrived first), then the cast.
    tick(before);
    expect(P(before).x).toBe(600);
    expect(RT(before).path).toEqual([]);
  });

  it("a root does not stop it, a stun or a silence refuses it", () => {
    const rooted = trio();
    afflict(rooted, "p0", "root", 5 * SEC);
    blaze(rooted, near(900));
    tick(rooted);
    expect(at(rooted, "p0")).toEqual(near(600));
    for (const kind of ["stun", "silence"] as const) {
      const world = trio();
      afflict(world, "p0", kind, 5 * SEC);
      blaze(world, near(900));
      tick(world);
      expect(at(world, "p0")).toEqual(ME);
      expect(P(world).wishReadyAt).toBeLessThan(T(world));
    }
  });

  describe("the trail burns", () => {
    const burnTick = (BLAZE_BURN_DPS * TICK_MS) / 1000;

    it("a crossing costs BLAZE_BURN_DPS for BLAZE_BURN_MS (60 true damage), reported in chunks that name the ability, and nothing else", () => {
      const world = trio();
      place(world, "p1", near(450, 320)); // on the segment (300,320) to (600,320)
      blaze(world, near(900));
      tick(world);
      const hitAt = T(world);
      expect(P(world, 1).hp).toBeCloseTo(1000 - burnTick, 9);
      expect(P(world, 1).effects & EFFECT_DOT).toBe(EFFECT_DOT);
      expect(fxOf("status")).toEqual([{ at: hitAt, kind: "status", id: "p1", status: "dot", ms: BLAZE_BURN_MS, by: "p0" }]);
      place(world, "p1", near(450, 600)); // off the trail: no new contact
      runTo(world, hitAt + BLAZE_BURN_MS - TICK_MS);
      expect(P(world, 1).hp).toBeCloseTo(1000 - (BLAZE_BURN_MS / TICK_MS) * burnTick, 6);
      expect(P(world, 1).effects & EFFECT_DOT).toBe(EFFECT_DOT);
      tick(world);
      expect(P(world, 1).effects & EFFECT_DOT).toBe(0);
      runFor(world, DOT_FX_MS + 2 * TICK_MS);
      expect(P(world, 1).hp).toBeCloseTo(1000 - (BLAZE_BURN_DPS * BLAZE_BURN_MS) / 1000, 6);
      const chunks = fxOf("hit");
      expect(chunks.length).toBeGreaterThanOrEqual(3);
      for (const c of chunks) expect(c).toMatchObject({ id: "p1", by: "p0", weapon: null, ability: "blaze" });
      expect(chunks.reduce((sum, c) => sum + c.amount, 0)).toBeCloseTo(60, 6);
      for (const c of chunks.slice(1, -1)) expect(c.amount).toBeCloseTo(burnTick * (DOT_FX_MS / TICK_MS), 6);
      expect(fxOf("status")).toHaveLength(1);
    });

    it("what is left of a chunk is reported when the run ends", () => {
      const world = trio();
      place(world, "p1", near(450, 320));
      blaze(world, near(900));
      run(world, 3);
      expect(fxOf("hit")).toEqual([]);
      const lost = 1000 - P(world, 1).hp;
      expect(lost).toBeGreaterThan(0);
      removePlayer(world, "p2");
      removePlayer(world, "p1");
      tick(world);
      expect(world.state.phase).toBe("ended");
      const chunks = fxOf("hit");
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({ id: "p1", by: "p0", weapon: null, ability: "blaze" });
      expect(chunks[0]!.amount).toBeCloseTo(lost, 6);
    });

    it("standing on the trail keeps it burning: the burn runs out BLAZE_BURN_MS after the trail ends", () => {
      const world = trio();
      place(world, "p1", near(450, 320));
      blaze(world, near(900));
      tick(world);
      runTo(world, world.state.fields.values().next().value!.endsAt + BLAZE_BURN_MS + 4 * TICK_MS);
      const ticks = (BLAZE_TRAIL_MS + BLAZE_BURN_MS) / TICK_MS - 1; // the contacts of 50 ticks, then 40 ticks of burn counted from the last
      expect(P(world, 1).hp).toBeCloseTo(1000 - ticks * burnTick, 6);
    });

    it("the owner is never burned by its own trail, nor is anyone under teleport immunity or a mob walking home", () => {
      const world = trio();
      const mob = placeMob(world, { region: "holy", elite: false, at: near(500, 500) });
      place(world, "p1", near(450, 320));
      P(world, 1).immuneUntil = T(world) + 5 * SEC;
      world.mobs.get(mob)!.brain!.mode = "return";
      place(world, mob, near(520)); // on the trail, walking home to a camp off it
      blaze(world, near(900));
      tick(world);
      place(world, "p0", near(450, 320)); // back onto its own trail
      run(world, 3);
      for (const who of ["p0", "p1", mob]) expect(findStatus(combatant(world, who)!, "dot")).toBeUndefined();
      expect(P(world, 1).hp).toBe(1000);
    });

    it("burns a mob (a dummy, or a regional one that wakes up on its attacker)", () => {
      const world = trio();
      const dummy = addMob(world, { kind: "dummy", name: "dummy", at: near(450), hp: 1000 });
      const mobId = placeMob(world, { region: "holy", elite: false, at: near(520) });
      const mob = world.state.mobs.get(mobId)!;
      const hp0 = mob.hp;
      blaze(world, near(900));
      tick(world);
      run(world, 5);
      expect(world.state.mobs.get(dummy)!.hp).toBeCloseTo(1000 - 6 * burnTick, 6);
      expect(mob.hp).toBeLessThan(hp0);
      expect(world.mobs.get(mobId)!.brain!.mode).toBe("fight");
      expect(world.mobs.get(mobId)!.brain!.target).toBe("p0");
    });

    it("kill credit, GV and the kill count go to the caster", () => {
      const world = arena([
        { faction: "fire", weapons: ["sword"], at: ME, hp: 1000 }, { faction: "frost", weapons: ["sword"], at: near(450), hp: 30 },
        { faction: "holy", at: near(1000, 500), hp: 1000 },
      ]);
      blaze(world, near(900));
      let ended = false;
      for (let i = 0; i < 40 && !ended; i++) { tick(world); ended = P(world, 1).status !== "alive"; }
      expect(P(world, 1).status).toBe("dead");
      expect(fxOf("death")).toMatchObject([{ id: "p1", by: "p0" }]);
      expect(RT(world, 1).killedBy).toBe("player0");
      expect(P(world, 0).kills).toBe(1);
      expect(RT(world, 0).gv.kills).toBe(GV_KILL);
      expect(P(world, 0).bounty).toBe(bountyFor(1));
      // The body's statuses are gone, the trail stays.
      expect(statusesOf(C(world, 1))).toEqual([]);
      expect(trailOf(world)).toHaveLength(1);
    });

    it("a bounty on the victim is paid to the caster", () => {
      const world = arena([
        { faction: "fire", weapons: ["sword"], at: ME, hp: 1000 }, { faction: "frost", weapons: ["sword"], at: near(450), hp: 30 },
        { faction: "holy", at: near(1000, 500), hp: 1000 },
      ]);
      P(world, 1).kills = 5;
      P(world, 1).bounty = bountyFor(5);
      expect(bountyFor(5)).toBeGreaterThan(0);
      blaze(world, near(900));
      for (let i = 0; i < 40 && P(world, 1).status === "alive"; i++) tick(world);
      expect(P(world, 1).status).toBe("dead");
      expect(RT(world, 0).gv.bounty).toBe(bountyFor(5));
      expect(RT(world, 0).gv.kills).toBe(GV_KILL);
    });

    it("a trail outlives its owner: it still burns, and the kill is credited by name", () => {
      const world = arena([
        { faction: "fire", weapons: ["sword"], at: ME, hp: 1000 }, { faction: "frost", weapons: ["sword"], at: near(900, 500), hp: 30 },
        { faction: "holy", at: near(1000, 600), hp: 1000 },
      ]);
      blaze(world, near(900));
      tick(world);
      applyDamage(world, P(world, 0), RT(world, 0), 1e6, "test");
      tick(world);
      expect(P(world, 0).status).toBe("dead");
      expect(trailOf(world)).toHaveLength(1);
      place(world, "p1", near(450, 320));
      for (let i = 0; i < 40 && P(world, 1).status === "alive"; i++) tick(world);
      expect(P(world, 1).status).toBe("dead");
      expect(RT(world, 1).killedBy).toBe("player0");
      expect(P(world, 0).kills).toBe(0);
    });
  });
});

describe("Last Stand (Holy)", () => {
  const trio = (opts: RigOpts = {}, hp = 100) => arena([
    { faction: "holy", weapons: ["sword"], at: ME, hp, maxHp: 1000 }, { faction: "plague", weapons: ["sword"], at: FOE, hp: 1000 },
    { faction: "frost", at: near(1000, 500), hp: 1000 },
  ], opts);
  const floorOf = (world: World) => findStatus(C(world), "deathFloor")!;
  /** Casts it and returns the landing time. */
  function standLast(world: World): number {
    cast(world, 0);
    tick(world);
    return T(world);
  }

  it("lands in the tick it is cast: a 5 s floor at 1 hp and +30% speed, with no telegraph", () => {
    const world = trio();
    const landAt = standLast(world);
    expect(fxOf("cast")).toEqual([]);
    expect(fxOf("castLand")).toEqual([{ at: landAt, kind: "castLand", by: "p0", ability: "lastStand", target: null, x: 300, y: 320 }]);
    expect(fxOf("status")).toEqual([
      { at: landAt, kind: "status", id: "p0", status: "deathFloor", ms: LAST_STAND_MS, by: "p0" },
      { at: landAt, kind: "status", id: "p0", status: "haste", ms: LAST_STAND_MS, by: "p0" },
    ]);
    expect(floorOf(world)).toMatchObject({ until: landAt + LAST_STAND_MS, floorHp: 1, healShare: LAST_STAND_HEAL_SHARE, taken: 0 });
    expect(findStatus(C(world), "haste")).toMatchObject({ until: landAt + LAST_STAND_MS, value: LAST_STAND_SPEED_BONUS });
    expect(P(world).effects & (EFFECT_LAST_STAND | EFFECT_HASTE)).toBe(EFFECT_LAST_STAND | EFFECT_HASTE);
    expect(P(world).wishReadyAt).toBe(landAt + WISH_COOLDOWN_SECONDS * SEC);
    expect(RT(world).cast ?? null).toBeNull();
  });

  it("holds the fighter at 1 hp for 5 s however hard it is hit, and counts what it held up, overkill included", () => {
    const world = trio();
    standLast(world);
    expect(hit(world, "p1", "p0", 30)).toBeCloseTo(30, 9);
    expect(hit(world, "p1", "p0", 30)).toBeCloseTo(30, 9);
    expect(P(world).hp).toBeCloseTo(40, 9);
    expect(floorOf(world).taken).toBeCloseTo(60, 9);
    hit(world, "p2", "p0", 500);
    expect(P(world).status).toBe("alive");
    expect(P(world).hp).toBe(1);
    expect(floorOf(world).taken).toBeCloseTo(560, 9);
    hit(world, "p1", "p0", 1e6);
    expect(P(world).status).toBe("alive");
    expect(P(world).hp).toBe(1);
    expect(floorOf(world).taken).toBeCloseTo(560 + 1e6, 3);

    const control = trio();
    hit(control, "p2", "p0", 500);
    expect(P(control).status).toBe("dead");
  });

  it("pays a third of what it held up when it ends, and the floor is gone from that tick on", () => {
    const world = trio();
    const landAt = standLast(world);
    hit(world, "p1", "p0", 560);
    expect(P(world).hp).toBe(1);
    runTo(world, landAt + LAST_STAND_MS - TICK_MS);
    expect(P(world).hp).toBe(1);
    expect(fxOf("heal")).toEqual([]);
    tick(world);
    const heals = fxOf("heal");
    expect(heals).toHaveLength(1);
    expect(heals[0]!.at).toBe(landAt + LAST_STAND_MS);
    expect(heals[0]).toMatchObject({ id: "p0" });
    expect(heals[0]!.amount).toBeCloseTo(0.3 * 560, 9);
    expect(P(world).hp).toBeCloseTo(1 + 0.3 * 560, 9);
    expect(statusesOf(C(world))).toEqual([]);
    expect(P(world).effects & (EFFECT_LAST_STAND | EFFECT_HASTE)).toBe(0);
    hit(world, "p1", "p0", 1e6);
    expect(P(world).status).toBe("dead");
  });

  it("pays nothing when nothing was taken", () => {
    const world = trio();
    const landAt = standLast(world);
    runTo(world, landAt + LAST_STAND_MS);
    expect(fxOf("heal")).toEqual([]);
    expect(P(world).hp).toBe(100);
  });

  it("the heal is capped at max hp and cut by anti-heal", () => {
    const capped = trio({}, 990);
    let landAt = standLast(capped);
    hit(capped, "p1", "p0", 500);
    P(capped).hp = 990; // back up: only the room to max hp can be healed
    runTo(capped, landAt + LAST_STAND_MS);
    expect(P(capped).hp).toBe(1000);
    expect(fxOf("heal")[0]!.amount).toBeCloseTo(10, 9);

    const cut = trio();
    landAt = standLast(cut);
    hit(cut, "p1", "p0", 500);
    afflict(cut, "p0", "antiHeal", 6 * SEC, { value: 0.5 });
    runTo(cut, landAt + LAST_STAND_MS);
    expect(fxOf("heal").at(-1)!.amount).toBeCloseTo(0.5 * 0.3 * 500, 9);
  });

  it("runs 30% of base speed faster, on top of cards and not multiplied by them, until it ends", () => {
    const world = trio({}, 1000);
    const landAt = standLast(world);
    walkTo(world, 0, 1100, 320);
    walkTo(world, 1, 1100, 320);
    const x0 = [P(world, 0).x, P(world, 1).x];
    run(world, 10);
    expect(P(world, 0).x - x0[0]!).toBeCloseTo(10 * STEP * (1 + LAST_STAND_SPEED_BONUS), 6);
    expect(P(world, 1).x - x0[1]!).toBeCloseTo(10 * STEP, 6);

    const buffed = trio({}, 1000);
    // A faster walk from the speed mirror (whatever feeds it: a source here, as a status or a skill would).
    buffed.modSources.push((_w, c) => (c.id === C(buffed).id ? { speedMult: 1.2 } : null));
    recomputeMods(buffed, C(buffed));
    const m = moveSpeedMult(buffed, C(buffed));
    expect(m).toBeGreaterThan(1);
    standLast(buffed);
    walkTo(buffed, 0, 1100, 320);
    const b0 = P(buffed).x;
    run(buffed, 10);
    expect(P(buffed).x - b0).toBeCloseTo(10 * STEP * (m + LAST_STAND_SPEED_BONUS), 6);

    runTo(world, landAt + LAST_STAND_MS);
    walkTo(world, 0, 100, 320);
    const x1 = P(world).x;
    run(world, 4);
    expect(x1 - P(world).x).toBeCloseTo(4 * STEP, 6);
  });

  it("its heal ignores the 3 s out-of-combat lockout that every other heal obeys", () => {
    const world = arena([
      { faction: "holy", at: ME, hp: 1000 }, { faction: "fire", weapons: ["sword"], at: FOE, hp: 1000 }, { faction: "frost", at: near(1000, 500), hp: 1000 },
    ], { signatures: true });
    const landAt = standLast(world);
    // Fire's burn on Holy for the whole window: damage every tick, so Holy is always "in combat".
    afflict(world, "p0", "dot", 10 * SEC, { source: src("p1"), ability: "blaze", value: 20 });
    runTo(world, landAt + LAST_STAND_MS - TICK_MS);
    const taken = floorOf(world).taken!;
    expect(taken).toBeGreaterThan(90);
    expect(heal(world, C(world), 50)).toBe(0); // an ordinary heal is refused: it took damage this very tick
    const hpBefore = P(world).hp;
    tick(world);
    const paid = fxOf("heal").filter((f) => f.at === landAt + LAST_STAND_MS);
    expect(paid).toHaveLength(1);
    expect(paid[0]!.amount).toBeCloseTo(0.3 * taken, 9);
    expect(P(world).hp).toBeGreaterThan(hpBefore);
  });

  it("holds through sudden death too, and pays a third of the burn it held up", () => {
    const rig = (): World => arena([
      { faction: "holy", at: ME, hp: 100, maxHp: 1000 }, { faction: "fire", at: FOE, hp: 1000 }, { faction: "frost", at: near(1000, 500), hp: 1000 },
    ], { patience: 1, suddenDeath: 1 });
    const control = rig();
    runTo(control, 7500);
    expect(P(control).status).toBe("dead");

    const world = rig();
    runTo(world, world.state.suddenDeathAt === 0 ? 2450 : 2450); // the teleport at 1.05 s, the burn from 2.05 s, immunity until 2.55 s
    expect(world.state.gatesLocked).toBe(true);
    expect(P(world).status).toBe("alive");
    cast(world, 0);
    tick(world);
    const landAt = T(world);
    runTo(world, landAt + LAST_STAND_MS - TICK_MS);
    expect(P(world).status).toBe("alive");
    expect(P(world).hp).toBe(1);
    const taken = floorOf(world).taken!;
    expect(taken).toBeGreaterThan(100);
    expect(P(world, 1).status).toBe("alive");
    tick(world);
    const heal0 = fxOf("heal").find((f) => f.id === "p0" && f.at === landAt + LAST_STAND_MS);
    expect(heal0?.amount).toBeCloseTo(0.3 * taken, 9);
    expect(P(world).status).toBe("alive"); // the heal came before that tick's burn
  });
});

describe("an effect no Wish uses yet: cleanse", () => {
  it("a landing cast cleanses its caster by class, in the self pass, and never what cannot be cleansed", () => {
    const rank = ABILITIES.lastStand.ranks[0]!;
    const original = rank.effects;
    (rank as { effects: unknown }).effects = [{ do: "cleanse", to: "self", classes: ["soft", "hard"] }, ...original];
    try {
      const world = arena([{ faction: "holy", at: ME }, { faction: "fire", at: FOE }, { faction: "frost", at: near(1000, 500) }]);
      afflict(world, "p0", "root", 5 * SEC);
      afflict(world, "p0", "slowMove", 5 * SEC, { value: 0.3 });
      afflict(world, "p0", "antiHeal", 5 * SEC, { value: 0.3 });
      afflict(world, "p0", "untargetable", 5 * SEC);
      cast(world, 0);
      tick(world);
      const kinds = statusesOf(C(world)).map((st) => st.kind).sort();
      expect(kinds).toEqual(["deathFloor", "haste", "untargetable"]);
    } finally {
      (rank as { effects: unknown }).effects = original;
    }
  });
});

describe("the generic damage-over-time ticker", () => {
  const duo = (extra: Partial<Fighter> = {}) => arena([
    { faction: "frost", weapons: ["sword"], at: ME, hp: 1000 }, { faction: "fire", weapons: ["sword"], at: FOE, hp: 1000, ...extra },
    { faction: "plague", at: near(1000, 500), hp: 1000 },
  ]);

  it("a dot status from a source that is not an ability ticks as true damage with no weapon and no per-tick fx (a card's bleed is reported in chunks)", () => {
    const world = duo();
    afflict(world, "p1", "dot", SEC, { source: src("p0"), tag: "relic", value: 40 });
    const landed: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 25; i++) {
      tick(world);
      for (const h of world.combat.landed) landed.push({ ...h });
    }
    // Applied between ticks, it ticks on the 19 ticks after it, and not on the one at which its second is up.
    expect(landed).toHaveLength(19);
    expect(P(world, 1).hp).toBeCloseTo(1000 - 19 * 2, 9);
    for (const h of landed) expect(h).toMatchObject({ victim: "p1", by: "p0", weapon: null, dot: true });
    for (const h of landed) expect(h.ability).toBeUndefined();
    // Not one `hit` fx a tick: the damage of such a status arrives as a chunk every DOT_FX_MS (sim/cardHooks.ts), with no weapon, signature or ability.
    const hits = fxOf("hit");
    expect(hits.length).toBeLessThan(5);
    for (const h of hits) expect(h).toMatchObject({ id: "p1", by: "p0", weapon: null });
    for (const h of hits) expect(h).not.toHaveProperty("ability");
    expect(hits.reduce((n, h) => n + (h as { amount: number }).amount, 0)).toBeGreaterThan(30);
    expect(P(world, 1).effects & EFFECT_DOT).toBe(0);
  });

  it("sources stack, each from its own instance, and the kill goes to the larger", () => {
    const world = arena([
      { faction: "frost", at: ME, hp: 1000 }, { faction: "fire", at: FOE, hp: 30 }, { faction: "plague", at: near(1000, 500), hp: 1000 },
    ]);
    afflict(world, "p1", "dot", 5 * SEC, { source: src("p0"), tag: "a", value: 20 });
    afflict(world, "p1", "dot", 5 * SEC, { source: src("p2"), tag: "b", value: 40 });
    afflict(world, "p1", "dot", 5 * SEC, { source: src("p0"), tag: "c", value: 20 });
    expect(statusesOf(C(world, 1)).filter((s) => s.kind === "dot")).toHaveLength(3);
    run(world, 5);
    expect(P(world, 1).hp).toBeCloseTo(30 - 5 * (80 * TICK_MS) / 1000, 9);
    for (let i = 0; i < 20 && P(world, 1).status === "alive"; i++) tick(world);
    expect(P(world, 1).status).toBe("dead");
    expect(RT(world, 1).killedBy).toBe("player2"); // 40 dps against p0's two 20s: one hit each tick, the larger takes it
    expect(P(world, 2).kills).toBe(1);
  });

  it("custom shares go through the damage law, and a dot on a downed fighter or one walking home does nothing", () => {
    const world = duo();
    const spec = defenseOf(P(world, 1));
    afflict(world, "p1", "dot", SEC, { source: src("p0"), tag: "magic", value: 40, data: { shares: { phys: 0, magic: 1, true: 0 } } });
    run(world, 25);
    const lost = 1000 - P(world, 1).hp;
    expect(lost).toBeCloseTo(19 * mitigateShares(2, { phys: 0, magic: 1, true: 0 }, spec), 9); // Fire's shield cuts it
    expect(lost).toBeLessThan(19 * 2);

    const mob = placeMob(world, { region: "holy", elite: false, at: near(700, 500) });
    afflict(world, mob, "dot", 5 * SEC, { source: src("p0"), tag: "x", value: 100 });
    world.mobs.get(mob)!.brain!.mode = "return";
    place(world, mob, near(760, 500));
    const hp = world.state.mobs.get(mob)!.hp;
    run(world, 5);
    expect(world.state.mobs.get(mob)!.hp).toBe(hp);
  });
});

describe("the lifecycle: what clears what", () => {
  const quartet = (opts: RigOpts = {}) => arena([
    { faction: "frost", at: ME, hp: 1000 }, { faction: "sentenced", at: FOE, hp: 1000 }, { faction: "plague", at: near(300, 500), hp: 1000 },
    { faction: "holy", at: near(1000, 500), hp: 1000 },
  ], opts);
  const noStuns = () => expect(fxOf("status").filter((f) => f.status === "stun")).toEqual([]);

  /** Kills fighter `i` the way the test names, between ticks or in the ledger pass. */
  const killers: Array<[string, (w: World, i: number) => void]> = [
    ["dies between ticks", (w, i) => { applyDamage(w, P(w, i), RT(w, i), 1e6, "test"); }],
    ["dies in the ledger pass", (w, i) => { hit(w, "p3", id(i), 1e6); }],
    ["leaves the run", (w, i) => { removePlayer(w, id(i)); }],
    ["is abandoned (a server shutdown)", (w, i) => { abandonPlayer(w, id(i)); }],
  ];

  describe.each(killers)("a caster that %s", (_name, kill) => {
    it("its pending cast ends with a castEnd (cancelled) and the cooldown stays spent", () => {
      const world = quartet();
      cast(world, 0, { target: 1 });
      tick(world);
      const spent = P(world).wishReadyAt;
      kill(world, 0);
      tick(world);
      expect(fxOf("castEnd")).toEqual([{ at: T(world), kind: "castEnd", by: "p0", ability: "freeze", reason: "cancelled" }]);
      run(world, 8);
      expect(fxOf("castLand")).toEqual([]);
      if (world.state.players.has("p0")) {
        expect(P(world).wishReadyAt).toBe(spent);
        expect(RT(world).cast ?? null).toBeNull();
      }
      expect(isStunned(world, C(world, 1))).toBe(false);
    });

    it("its zone ends with no stun on the subject, and its cloud with its Swarm", () => {
      const world = arena([
        { faction: "sentenced", at: ME, hp: 1000 }, { faction: "fire", at: FOE, hp: 1000 }, { faction: "plague", at: near(300, 500), hp: 1000 },
        { faction: "holy", at: near(1000, 500), hp: 1000 },
      ]);
      cast(world, 0, { target: 1 });
      cast(world, 2);
      runFor(world, TRIAL_CAST_MS + TICK_MS);
      expect(world.state.fields.size).toBe(2);
      expect(findStatus(C(world, 1), "zoned")).toBeDefined();
      kill(world, 0);
      expect(world.state.fields.size).toBe(1);
      expect(findStatus(C(world, 1), "zoned")).toBeUndefined();
      kill(world, 2);
      expect(world.state.fields.size).toBe(0);
      run(world, 2);
      noStuns();
      if (world.state.players.has("p2")) expect(statusesOf(C(world, 2))).toEqual([]);
    });
  });

  it.each(killers)("a subject that %s: its zone goes, silently", (_name, kill) => {
    const world = arena([
      { faction: "sentenced", at: ME, hp: 1000 }, { faction: "fire", at: FOE, hp: 1000 }, { faction: "plague", at: near(300, 500), hp: 1000 },
      { faction: "holy", at: near(1000, 500), hp: 1000 },
    ]);
    cast(world, 0, { target: 1 });
    runFor(world, TRIAL_CAST_MS + TICK_MS);
    expect(world.state.fields.size).toBe(1);
    kill(world, 1);
    expect(world.state.fields.size).toBe(0);
    run(world, 2);
    noStuns();
    expect(findStatus(C(world, 0), "zoned")).toBeUndefined();
  });

  it("every status of a fighter that goes down goes with it, a Last Stand paying nothing", () => {
    for (const how of [0, 1] as const) {
      const world = quartet();
      afflict(world, "p3", "slowMove", 5 * SEC, { value: 0.3 });
      afflict(world, "p3", "dot", 5 * SEC, { source: src("p1"), tag: "x", value: 5 });
      cast(world, 3); // Last Stand
      tick(world);
      hit(world, "p1", "p3", 300);
      expect(findStatus(C(world, 3), "deathFloor")!.taken).toBeGreaterThanOrEqual(300); // the hit, and a tick or two of the burn
      P(world, 3).hp = 5;
      if (how === 0) removePlayer(world, "p3");
      else abandonPlayer(world, "p3");
      run(world, 2);
      expect(fxOf("heal")).toEqual([]);
      expect(world.state.players.get("p3")).toBeUndefined();
    }
    const dead = quartet();
    cast(dead, 3);
    tick(dead);
    hit(dead, "p1", "p3", 300);
    const stunned = placeMob(dead, { region: "fire", elite: false, at: near(700, 500) });
    afflict(dead, stunned, "stun", 5 * SEC);
    hit(dead, "p0", stunned, 1e6);
    expect(combatant(dead, stunned)!.s.status).toBe("dead");
    expect(statusesOf(combatant(dead, stunned)!)).toEqual([]);
    expect(combatant(dead, stunned)!.s.effects).toBe(0);
  });

  it("the trail of a caster that left or died stays", () => {
    for (const how of [0, 1] as const) {
      const world = arena([{ faction: "fire", at: ME, hp: 1000 }, { faction: "frost", at: near(1000, 500), hp: 1000 }, { faction: "plague", at: near(1000, 600), hp: 1000 }]);
      cast(world, 0, { x: 900, y: 320 });
      tick(world);
      if (how === 0) removePlayer(world, "p0");
      else applyDamage(world, P(world, 0), RT(world, 0), 1e6, "test");
      run(world, 2);
      expect([...world.state.fields.values()].map((f) => f.kind)).toEqual([FIELD_KINDS.indexOf("trail")]);
    }
  });

  it("the coliseum teleport cancels pending casts WITH a refund, ends every status and every field, and pays a Last Stand", () => {
    const world = arena([
      { faction: "holy", at: near(300), hp: 500, maxHp: 1000 }, { faction: "frost", at: near(400), hp: 1000 }, { faction: "fire", at: near(500), hp: 1000 },
      { faction: "plague", at: near(300, 420), hp: 1000 }, { faction: "sentenced", at: near(300, 220), hp: 1000 },
    ]);
    cast(world, 0); // Last Stand
    cast(world, 2, { x: 900, y: 320 }); // Blaze Step: a trail
    cast(world, 3); // Swarm: a cloud, hidden
    cast(world, 4, { target: 1 }); // Trial on p1: a zone
    tick(world);
    runTo(world, T(world) + 400);
    expect(world.state.fields.size).toBe(3);
    hit(world, "p3", "p0", 200);
    expect(P(world, 0).hp).toBeCloseTo(300, 9);
    afflict(world, "p2", "slowMove", 5 * SEC, { value: 0.3 });
    const mob = placeMob(world, { region: "holy", elite: false, at: near(700, 500) });
    afflict(world, mob, "stun", 5 * SEC);
    const readyBefore = P(world, 1).wishReadyAt;
    cast(world, 1, { target: 2 }); // Freeze, still pending when the arena teleports everyone
    tick(world);
    const spent = P(world, 1).wishReadyAt;
    expect(spent).toBeGreaterThan(readyBefore);
    expect(RT(world, 1).cast).not.toBeNull();
    world.state.patienceEndsAt = T(world) + TICK_MS;
    tick(world);
    expect(world.state.gatesLocked).toBe(true);
    const at0 = T(world);
    // the cast: cancelled and refunded
    expect(fxOf("castEnd")).toEqual([{ at: at0, kind: "castEnd", by: "p1", ability: "freeze", reason: "cancelled" }]);
    expect(RT(world, 1).cast ?? null).toBeNull();
    expect(P(world, 1).wishReadyAt).toBe(readyBefore);
    // the others' Wishes were spent for good
    for (const i of [0, 2, 3, 4]) expect(P(world, i).wishReadyAt).toBeGreaterThan(at0);
    // statuses and fields
    expect(world.state.fields.size).toBe(0);
    for (let i = 0; i < 5; i++) {
      expect(statusesOf(C(world, i))).toEqual([]);
      expect(P(world, i).effects).toBe(0);
    }
    expect(statusesOf(combatant(world, mob)!)).toEqual([]); // mobs' statuses end too
    expect(combatant(world, mob)!.s.effects).toBe(0);
    // the Last Stand paid its third
    expect(fxOf("heal")).toMatchObject([{ id: "p0" }]);
    expect(fxOf("heal")[0]!.amount).toBeCloseTo(0.3 * 200, 9);
    expect(P(world, 0).hp).toBeCloseTo(300 + 60, 9);
    expect(fxOf("status").filter((f) => f.status === "stun" && f.id !== mob)).toEqual([]);
  });

  it("the end of the run cancels casts (nothing refunded), ends every status and field, and pays no Last Stand", () => {
    const world = arena([{ faction: "holy", at: ME, hp: 500, maxHp: 1000 }, { faction: "frost", at: FOE, hp: 1000 }]);
    cast(world, 0);
    tick(world);
    hit(world, "p1", "p0", 200);
    afflict(world, "p0", "silence", 5 * SEC);
    const frost = arena([{ faction: "frost", at: ME, hp: 1000 }, { faction: "holy", at: FOE, hp: 1000 }]);
    cast(frost, 0, { target: 1 });
    tick(frost);
    const spent = P(frost).wishReadyAt;
    applyDamage(frost, P(frost, 1), RT(frost, 1), 1e6, "test"); // the only rival falls: the run is over after this tick
    tick(frost);
    expect(frost.state.phase).toBe("ended");
    expect(fxOf("castEnd")).toMatchObject([{ by: "p0", ability: "freeze", reason: "cancelled" }]);
    expect(P(frost).wishReadyAt).toBe(spent);
    expect(RT(frost).cast ?? null).toBeNull();

    // And the same for the winner who is standing on a Last Stand: the run's end pays it nothing.
    const holy = arena([{ faction: "holy", at: ME, hp: 500, maxHp: 1000 }, { faction: "frost", at: FOE, hp: 1000 }]);
    cast(holy, 0);
    tick(holy);
    hit(holy, "p1", "p0", 200);
    log.length = 0;
    applyDamage(holy, P(holy, 1), RT(holy, 1), 1e6, "test");
    tick(holy);
    expect(holy.state.phase).toBe("ended");
    expect(fxOf("heal")).toEqual([]);
    expect(P(holy).hp).toBeCloseTo(300, 9);
    expect(statusesOf(C(holy))).toEqual([]);
    expect(P(holy).effects).toBe(0);
    expect(world.state.phase).toBe("active");
  });

  it("a dropped connection leaves casts, statuses and fields alone, and its reconnect changes nothing", () => {
    const world = arena([
      { faction: "frost", at: ME, hp: 1000 }, { faction: "sentenced", at: FOE, hp: 1000 }, { faction: "holy", at: near(300, 500), hp: 100, maxHp: 1000 },
      { faction: "plague", at: near(700), hp: 1000 },
    ]);
    cast(world, 0, { target: 3 }); // Freeze on the swarmer, which lands as its Swarm does
    cast(world, 1, { target: 0 }); // Trial on the freezer
    cast(world, 2);
    cast(world, 3);
    tick(world);
    for (const who of ["p0", "p1", "p2", "p3"]) markDropped(world, who);
    expect(RT(world, 0).cast).not.toBeNull();
    runFor(world, TRIAL_CAST_MS + TICK_MS);
    expect(fxOf("castEnd")).toEqual([]);
    expect(fxOf("castLand").map((f) => f.ability).sort()).toEqual(["freeze", "lastStand", "swarm", "trial"]);
    expect(isStunned(world, C(world, 3))).toBe(true);
    expect(world.state.fields.size).toBe(2); // the zone and the cloud
    hit(world, "p1", "p2", 9999); // a dropped player's floor still holds
    expect(P(world, 2).hp).toBe(1);
    for (const who of ["p0", "p1", "p2", "p3"]) markReconnected(world, who);
    expect(world.state.fields.size).toBe(2);
    expect(isHidden(world, C(world, 3))).toBe(true);
    expect(findStatus(C(world, 0), "zoned")).toBeDefined();
    expect(findStatus(C(world, 2), "deathFloor")).toBeDefined();
    hit(world, "p1", "p2", 9999);
    expect(P(world, 2).status).toBe("alive");
  });
});

describe("training", () => {
  const rig = () => arena([{ faction: "frost", at: ME }], { training: true, lock: 45 });

  it("a Wish is ready at once (the 45 s lock does not apply) and its cooldown is the short one", () => {
    const world = rig();
    expect(P(world).wishReadyAt).toBe(0);
    const dummy = addMob(world, { kind: "dummy", name: "dummy", at: near(400) });
    cast(world, 0, { target: dummy });
    tick(world);
    const castAt = T(world);
    expect(P(world).wishReadyAt).toBe(castAt + TRAINING_WISH_COOLDOWN_SECONDS * SEC);
    runFor(world, FREEZE_CAST_MS);
    expect(isStunned(world, combatant(world, dummy)!)).toBe(true); // a dummy is a valid unit target
    cast(world, 0, { target: dummy });
    tick(world);
    expect(RT(world).cast ?? null).toBeNull();
    runTo(world, castAt + TRAINING_WISH_COOLDOWN_SECONDS * SEC - TICK_MS);
    cast(world, 0, { target: dummy });
    tick(world);
    expect(RT(world).cast).not.toBeNull();
  });

  it("a fighter who goes down is revived with no status and no cast, and its Wish stays spent", () => {
    const world = rig();
    const dummy = addMob(world, { kind: "dummy", name: "dummy", at: near(400) });
    afflict(world, "p0", "slowMove", 5 * SEC, { value: 0.3 });
    cast(world, 0, { target: dummy });
    tick(world);
    const spent = P(world).wishReadyAt;
    applyDamage(world, P(world), RT(world), 1e9, "test");
    run(world, 2);
    expect(P(world).status).toBe("alive");
    expect(P(world).hp).toBe(P(world).maxHp);
    expect(RT(world).cast ?? null).toBeNull();
    expect(statusesOf(C(world))).toEqual([]);
    expect(fxOf("castEnd")).toMatchObject([{ reason: "cancelled" }]);
    expect(P(world).wishReadyAt).toBe(spent);
  });
});

describe("every entry point tolerates a world that has never used abilities", () => {
  it("nothing allocates the ability runtime, and the direct calls are no-ops", () => {
    const world = arena([{ faction: "frost", at: ME }, { faction: "fire", at: FOE }]);
    run(world, 20);
    expect(world.abilities).toBeNull();
    updateAbilities(world);
    statusDamage(world, TICK_MS);
    abilityDotFx(world);
    clearAll(world, "runEnd");
    clearFighter(world, "p0", "down");
    clearFighter(world, "nobody", "removed");
    cancelCast(world, C(world), "cancelled", true);
    expect(world.abilities).toBeNull();
    expect(world.combat.ledger).toEqual([]);
    expect(log.filter((e) => ["castEnd", "status"].includes(e.fx.kind))).toEqual([]);
  });

  it("armWishes can run again and leaves a clean slate", () => {
    const world = arena([{ faction: "frost", at: ME }, { faction: "fire", at: FOE }], { lock: 12 });
    afflict(world, "p0", "stun", 5 * SEC);
    cast(world, 1, { x: 900, y: 320 });
    tick(world);
    P(world, 0).wishReadyAt = 1;
    armWishes(world);
    expect(P(world, 0).wishReadyAt).toBe(world.state.raidStartedAt + 12 * SEC);
    expect(statusesOf(C(world, 0))).toEqual([]);
    expect(world.state.fields.size).toBe(0);
  });

  it("the wish table: every faction has its Wish in its slot", () => {
    for (const [faction, ability] of [["frost", "freeze"], ["plague", "swarm"], ["sentenced", "trial"], ["fire", "blaze"], ["holy", "lastStand"]] as Array<[FactionId, AbilityId]>) {
      expect(wishOf(faction)?.id).toBe(ability);
      expect(ABILITIES[ability].cancelledBy).toEqual(["stun", "silence"]);
    }
    expect(STATUS_RULES.stun.cleanse).toBe("hard");
  });
});

// ----------------------------------------------------------------------------------------------------------------
// Review fixes: each of these fails without its fix
// ----------------------------------------------------------------------------------------------------------------

/** Makes the arena teleport everyone into the coliseum at the next tick, and returns that tick's server time. */
function teleport(world: World): number {
  world.state.patienceEndsAt = T(world) + TICK_MS;
  tick(world);
  expect(world.state.gatesLocked).toBe(true);
  return T(world);
}

describe("a cast in flight across the coliseum teleport (M1)", () => {
  const wishes: Array<[string, FactionId]> = [["Blaze Step", "fire"], ["Last Stand", "holy"], ["Swarm", "plague"]];

  it.each(wishes)("%s that reaches the server within the grace after the teleport is refused for free", (_name, faction) => {
    const world = arena([{ faction, weapons: ["sword"], at: near(300) }, { faction: "frost", at: near(1000, 500) }]);
    const ready0 = P(world).wishReadyAt;
    const tp = teleport(world);
    expect(world.abilities?.teleportedAt).toBe(tp);
    const spot = at(world, "p0");
    // What the client sent while it still drew the old picture: its cursor was somewhere in the world it saw.
    cast(world, 0, { x: 640, y: 320, seq: 7 });
    tick(world);
    expect(castFx()).toEqual([]);
    expect(fxOf("status")).toEqual([]);
    expect(P(world).wishReadyAt).toBe(ready0);
    expect(RT(world).cast ?? null).toBeNull();
    expect(at(world, "p0")).toEqual(spot);
    expect(P(world).moveSeq).toBe(7); // the ack still goes out: the client drops what it predicted
    // The edge: still refused one tick before the grace is over, taken on the tick that is exactly one grace after.
    runTo(world, tp + CAST_TELEPORT_GRACE_MS - 2 * TICK_MS);
    cast(world, 0, { x: 640, y: 320 });
    tick(world);
    expect(T(world)).toBe(tp + CAST_TELEPORT_GRACE_MS - TICK_MS);
    expect(P(world).wishReadyAt).toBe(ready0);
    cast(world, 0, { x: 640, y: 320 });
    tick(world);
    expect(T(world)).toBe(tp + CAST_TELEPORT_GRACE_MS);
    expect(P(world).wishReadyAt).toBe(T(world) + WISH_COOLDOWN_SECONDS * SEC);
    runFor(world, SWARM_CAST_MS + TICK_MS);
    expect(fxOf("castLand")).toHaveLength(1);
  });

  it("the blink that is refused leaves the player where the teleport put it", () => {
    const world = arena([{ faction: "fire", at: near(300) }, { faction: "frost", at: near(1000, 500) }]);
    const tp = teleport(world);
    const spot = at(world, "p0");
    cast(world, 0, { x: 300 + 300, y: 320 });
    run(world, 3);
    expect(at(world, "p0")).toEqual(spot);
    expect(world.abilities?.fields.size ?? 0).toBe(0);
    runTo(world, tp + CAST_TELEPORT_GRACE_MS - TICK_MS);
    cast(world, 0, { x: 640, y: 320 });
    tick(world);
    expect(at(world, "p0")).not.toEqual(spot);
  });

  it("a world that never teleported has no grace: a cast in its first ticks, or at any time, is taken", () => {
    const world = arena([{ faction: "fire", at: near(300) }, { faction: "frost", at: near(1000, 500) }]);
    expect(world.abilities?.teleportedAt).toBeUndefined();
    expect(T(world)).toBeLessThan(CAST_TELEPORT_GRACE_MS);
    cast(world, 0, { x: 600, y: 320 });
    tick(world);
    expect(fxOf("castLand")).toHaveLength(1);
    expect(world.abilities?.teleportedAt).toBeUndefined();
  });
});

describe("Swarm drops its caster's lock, and only the lock (M2)", () => {
  it("is a lock-dropper, not an own order: Blaze Step is the one that also ends the walk", () => {
    expect([ABILITIES.swarm.ownOrder, ABILITIES.swarm.dropsLock]).toEqual([false, true]);
    expect([ABILITIES.blaze.ownOrder, ABILITIES.blaze.dropsLock]).toEqual([true, false]);
  });

  it("casting it drops a locked caster's lock and chase, so its auto-attack does not reveal it at once", () => {
    const world = arena([{ faction: "plague", weapons: ["sword"], at: ME }, { faction: "fire", weapons: ["sword"], at: near(326) }]);
    lockOn(world, 0, 1);
    run(world, 10);
    expect(W(world).lock).toBe("p1");
    cast(world, 0);
    tick(world);
    expect(W(world).lock).toBeNull();
    expect(P(world).attackTarget).toBe("");
    expect(RT(world).path).toEqual([]); // a lock's chase has no walk of its own
    runFor(world, SWARM_CAST_MS);
    let hidden = 0;
    let ticks = 0;
    const end = T(world) + SWARM_MS - 2 * TICK_MS;
    while (T(world) < end) {
      tick(world);
      ticks++;
      if (isHidden(world, C(world))) hidden++;
    }
    expect(hidden).toBe(ticks); // no order, no attack: hidden for the whole of it
    expect(W(world).action).toBeNull();
  });

  it("a walking caster keeps its walk through the cast root and goes on after it", () => {
    const world = arena([{ faction: "plague", weapons: ["sword"], at: ME }, { faction: "fire", weapons: ["sword"], at: near(1000, 500) }]);
    walkTo(world, 0, 800, 320);
    run(world, 3);
    cast(world, 0);
    tick(world);
    const stoppedAt = P(world).x;
    expect(stoppedAt).toBeGreaterThan(300);
    expect(RT(world).path.length).toBeGreaterThan(0);
    expect(RT(world).cast).not.toBeNull();
    runTo(world, RT(world).cast!.landsAt - TICK_MS);
    expect(P(world).x).toBe(stoppedAt); // rooted while it casts
    expect(RT(world).path.length).toBeGreaterThan(0);
    tick(world); // the landing tick: the root is gone before movement runs
    expect(isHidden(world, C(world))).toBe(true);
    expect(P(world).x).toBeCloseTo(stoppedAt + STEP, 6); // the walk resumes
    run(world, 60);
    expect(P(world).x).toBe(800);
    expect(isHidden(world, C(world))).toBe(true);
    expect(fxOf("cancel")).toEqual([]);
  });

  it("an ambush is the player's own click after the cast: it reveals for the swing and a moment more", () => {
    const world = arena([{ faction: "plague", weapons: ["sword"], at: ME }, { faction: "fire", weapons: ["sword"], at: near(326) }]);
    lockOn(world, 0, 1);
    run(world, 4);
    cast(world, 0);
    runFor(world, SWARM_CAST_MS + 2 * TICK_MS);
    expect(isHidden(world, C(world))).toBe(true);
    lockOn(world, 0, 1);
    let act = W(world).action;
    for (let i = 0; i < 30 && !act; i++) { tick(world); act = W(world).action; }
    expect(act).not.toBeNull();
    tick(world);
    expect(isHidden(world, C(world))).toBe(false);
  });

  it("starting the cast cancels the windup the lock had started, with the cooldown refunded", () => {
    const world = arena([{ faction: "plague", weapons: ["bow"], at: ME }, { faction: "fire", weapons: ["sword"], at: near(400) }]);
    lockOn(world, 0, 1);
    tick(world);
    const act = W(world).action!;
    expect(act.kind).toBe("cast");
    cast(world, 0);
    tick(world);
    expect(fxOf("cancel")).toEqual([{ at: T(world), kind: "cancel", id: "p0" }]);
    expect(W(world).action).toBeNull();
    expect(P(world).readyAt).toBe(act.startedAt);
  });
});

describe("a forced displacement does not lose the chasers (m1)", () => {
  it("a Blaze Step through a long wall keeps the lock of a chaser that cannot see it, and the chaser walks round", () => {
    // A wall at column 20, rows 1..16: the only way round is rows 17..18 at the bottom.
    const map = arenaMap(column(20, 1, 16));
    const world = arena([{ faction: "fire", weapons: ["sword"], at: near(600, 160) }, { faction: "frost", weapons: ["sword"], at: near(540, 160) }], { map });
    primeTrail(world, 1, near(900, 160));
    lockOn(world, 1, 0);
    run(world, 2);
    expect(W(world, 1).lock).toBe("p0");
    cast(world, 0, { x: 900, y: 160 });
    tick(world);
    expect(P(world).x).toBeGreaterThan(660);
    const blinkAt = T(world);
    let lowest = 0;
    while (T(world) < blinkAt + 4000) {
      tick(world);
      expect(W(world, 1).lock, `lock at ${T(world) - blinkAt} ms after the blink`).toBe("p0");
      lowest = Math.max(lowest, P(world, 1).y);
    }
    expect(lowest).toBeGreaterThan(400); // it went for the way round at the bottom of the wall
  });

  it("the chase is bounded by the leash: a blink out of TARGET_RANGE still ends the lock", () => {
    const world = arena([{ faction: "fire", at: near(700) }, { faction: "frost", weapons: ["sword"], at: near(300) }]);
    lockOn(world, 1, 0);
    run(world, 2);
    expect(W(world, 1).lock).toBe("p0");
    cast(world, 0, { x: 1100, y: 320 }); // 300 u east: 700 u from the chaser, past TARGET_RANGE
    tick(world);
    expect(dist(at(world, "p0"), at(world, "p1"))).toBeGreaterThan(TARGET_RANGE);
    expect(W(world, 1).lock).toBeNull();
  });
});

describe("a cast with no cast time blocks nothing queued after it in its tick (m2)", () => {
  const toasts = (events: SimEvent[]) => events.flatMap((e) => (e.type === "toast" ? [e.text] : []));

  it.each([["Blaze Step", "fire"], ["Last Stand", "holy"]] as Array<[string, FactionId]>)("%s, then a swap and a pickup in the same tick", (_name, faction) => {
    const world = arena([{ faction, weapons: ["sword", "bow"], at: ME }, { faction: "frost", at: near(1000, 500) }]);
    cast(world, 0, { x: 600, y: 320 });
    send(world, 0, "swap", { slot: 1 });
    send(world, 0, "pickup", { containerId: "nothing-here" });
    const events = tick(world);
    expect(fxOf("castLand")).toHaveLength(1);
    expect(P(world).slot).toBe(1);
    expect(toasts(events)).not.toContain("Can't do that now");
  });

  it("a cast with a telegraph still blocks them while it roots", () => {
    const world = arena([{ faction: "frost", weapons: ["sword", "bow"], at: ME }, { faction: "fire", at: FOE }]);
    cast(world, 0, { target: 1 });
    send(world, 0, "swap", { slot: 1 });
    send(world, 0, "pickup", { containerId: "nothing-here" });
    const events = tick(world);
    expect(RT(world).cast).not.toBeNull();
    expect(P(world).slot).toBe(0);
    expect(toasts(events)).toContain("Can't do that now");
  });
});

describe("a second Swarm while the first is up (m3)", () => {
  it("replaces the first cloud, and the first cloud's end cannot take the second Swarm with it", () => {
    const world = arena([{ faction: "plague", weapons: ["sword"], at: ME }], { training: true });
    cast(world, 0);
    tick(world);
    runFor(world, SWARM_CAST_MS);
    const land1 = T(world);
    expect(isHidden(world, C(world))).toBe(true);
    runTo(world, P(world).wishReadyAt); // training's 5 s cooldown: the first Swarm still has 3 s to run
    cast(world, 0);
    tick(world);
    runFor(world, SWARM_CAST_MS);
    const land2 = T(world);
    expect(world.state.fields.size).toBe(1); // the first cloud went when the second one came
    expect([...world.state.fields.values()][0]!.startedAt).toBe(land2);
    runTo(world, land1 + SWARM_MS + TICK_MS); // the first Swarm's time is over
    expect(isHidden(world, C(world))).toBe(true);
    expect(world.state.fields.size).toBe(1);
    runTo(world, land2 + SWARM_MS - TICK_MS);
    expect(isHidden(world, C(world))).toBe(true);
    tick(world);
    expect(isHidden(world, C(world))).toBe(false);
    expect(world.state.fields.size).toBe(0);
  });
});

describe("a Last Stand that is applied again keeps what it has held up", () => {
  it("a re-application extends it and keeps `taken`; a fresh one starts from nothing", () => {
    const world = arena([{ faction: "holy", at: ME, hp: 1000, maxHp: 1000 }, { faction: "fire", at: near(1000, 500), hp: 1000 }, { faction: "frost", at: near(1000, 600), hp: 1000 }]);
    cast(world, 0);
    tick(world);
    const first = findStatus(C(world), "deathFloor")!;
    hit(world, "p1", "p0", 60);
    expect(first.taken).toBeCloseTo(60, 9);
    runFor(world, 2 * SEC);
    P(world).wishReadyAt = 0; // a stand-in for a skill or relic that applies it again
    cast(world, 0);
    tick(world);
    const again = findStatus(C(world), "deathFloor")!;
    expect(again.until).toBe(T(world) + LAST_STAND_MS);
    expect(again.taken).toBeCloseTo(60, 9);
    // After it has run out, a new one starts from nothing.
    runTo(world, again.until);
    expect(findStatus(C(world), "deathFloor")).toBeUndefined();
    P(world).wishReadyAt = 0;
    cast(world, 0);
    tick(world);
    expect(findStatus(C(world), "deathFloor")!.taken).toBe(0);
  });
});

describe("two small things the review found", () => {
  it("a trail's ignition says so even when the victim already burns from the same owner for another reason", () => {
    const world = arena([
      { faction: "fire", weapons: ["sword"], at: ME, hp: 1000 }, { faction: "frost", weapons: ["sword"], at: near(450), hp: 1000 }, { faction: "holy", at: near(1000, 500), hp: 1000 },
    ]);
    afflict(world, "p1", "dot", 10 * SEC, { source: src("p0"), tag: "relic", value: 5 });
    cast(world, 0, { x: 900, y: 320 });
    tick(world);
    const burns = fxOf("status").filter((f) => f.status === "dot" && f.id === "p1");
    expect(burns).toHaveLength(2); // the relic's, and the trail's own
    expect(statusesOf(C(world, 1)).filter((st) => st.kind === "dot")).toHaveLength(2);
  });

  it("a negative lock cannot put the Wish's ready time before the run's start", () => {
    const world = arena([{ faction: "frost", at: ME }, { faction: "fire", at: FOE }], { lock: -10 });
    expect(P(world).wishReadyAt).toBe(world.state.raidStartedAt);
    expect(P(world).wishReadyAt).toBeGreaterThanOrEqual(0);
  });
});

// ----------------------------------------------------------------------------------------------------------------
// Pre-merge review fixes: each of these fails without its fix
// ----------------------------------------------------------------------------------------------------------------

describe("a hit on a fighter held at the Last Stand floor still lands", () => {
  it("staggers it, shows a number, records the hit and calls hitLanded, though hp stays at 1, and `taken` counts it as before", () => {
    const world = arena([
      { faction: "holy", weapons: ["axe"], at: ME, hp: 100, maxHp: 400 }, { faction: "fire", weapons: ["sword"], at: near(330), hp: 1000 },
      { faction: "frost", at: near(1000, 500), hp: 1000 },
    ]);
    const calls: number[] = [];
    world.hooks.hitLanded = (_w, _e, applied) => { calls.push(applied); };
    function strike(raw: number): { fx: FxEvent[]; landed: typeof world.combat.landed } {
      world.events.length = 0;
      world.combat.landed = [];
      world.combat.ledger = [];
      recordHit(world, { victim: "p0", by: src("p1"), packet: { raw, phys: 0, magic: 0, true: 1 }, weapon: "sword", stagger: true });
      applyLedger(world);
      return { fx: world.events.flatMap((e) => (e.type === "fx" ? [e.fx] : [])), landed: [...world.combat.landed] };
    }
    cast(world, 0);
    tick(world);
    const first = strike(500); // 100 hp down to the floor
    expect(P(world).hp).toBe(1);
    expect(first.fx.filter((f) => f.kind === "hit")).toHaveLength(1);
    expect(calls).toEqual([expect.closeTo(500, 9)]);
    runFor(world, STAGGER_IMMUNITY_SECONDS * 1000 + 100); // past the stagger immunity that hit started
    send(world, 0, "attack", { a: 0 });
    tick(world);
    expect(W(world).action).not.toBeNull();
    expect(W(world).staggerImmuneUntil).toBeLessThan(T(world));

    const second = strike(50); // hp is already 1: it stays 1
    expect(P(world).hp).toBe(1);
    expect(second.fx).toContainEqual({ kind: "stagger", id: "p0" }); // the windup went
    expect(W(world).action).toBeNull();
    expect(W(world).staggerImmuneUntil).toBeGreaterThan(T(world));
    expect(second.fx.filter((f) => f.kind === "hit")).toMatchObject([{ id: "p0", by: "p1", amount: 50 }]);
    expect(second.landed).toMatchObject([{ victim: "p0", by: "p1" }]);
    expect(second.landed[0]!.amount).toBeCloseTo(50, 9);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBeCloseTo(50, 9);
    expect(findStatus(C(world), "deathFloor")!.taken).toBeCloseTo(550, 9);
    // applyDamage says the same: the damage reached the pool.
    expect(applyDamage(world, P(world), RT(world), 7, "test")).toBe(7);
    expect(P(world).hp).toBe(1);
    // Without the floor a hit that kills still reports the hp it took, and one that is swallowed whole reports nothing.
    const plain = arena([{ faction: "fire", at: ME, hp: 100 }, { faction: "frost", at: near(1000, 500), hp: 1000 }]);
    expect(applyDamage(plain, P(plain), RT(plain), 30, "test")).toBe(30);
    expect(applyDamage(plain, P(plain), RT(plain), 1000, "test")).toBe(70);
  });
});

describe("statusValue(zoned) is the multiplier the subject deals", () => {
  it("is the dealt multiplier while zoned and 1 once the zone is over", () => {
    const world = arena([{ faction: "sentenced", at: ME, hp: 1000 }, { faction: "fire", at: FOE, hp: 1000 }, { faction: "holy", at: near(450, 500), hp: 1000 }]);
    expect(statusValue(world, C(world, 1), "zoned")).toBe(1);
    cast(world, 0, { target: 1 });
    runFor(world, TRIAL_CAST_MS + TICK_MS);
    expect(statusValue(world, C(world, 1), "zoned")).toBeCloseTo(TRIAL_DEALT_MULT, 12);
    expect(statusValue(world, C(world, 0), "zoned")).toBe(1);
    runFor(world, TRIAL_MS);
    expect(findStatus(C(world, 1), "zoned")).toBeUndefined();
    expect(statusValue(world, C(world, 1), "zoned")).toBe(1);
  });
});

describe("a reveal does not depend on join order", () => {
  /** An archer's locked arrow, drawn on a hidden Plague that is revealed for a moment and then starts an attack in the very tick the draw lands. */
  function arrowAngle(archerFirst: boolean): number {
    const archer: Fighter = { faction: "holy", weapons: ["wand"], at: near(400) };
    const plague: Fighter = { faction: "plague", weapons: ["sword"], at: near(600) };
    const world = arena(archerFirst ? [archer, plague] : [plague, archer]);
    const a = archerFirst ? 0 : 1;
    const pl = archerFirst ? 1 : 0;
    afflict(world, id(pl), "hidden", 8 * SEC, { ability: "swarm" });
    reveal(world, C(world, pl), T(world) + 120);
    lockOn(world, a, pl); // locked while revealed; the reveal runs out and the lock drops, the draw it started goes on
    tick(world);
    const act = W(world, a).action;
    expect(act?.kind).toBe("cast");
    expect(act!.target).toBe(id(pl));
    while (T(world) + TICK_MS < act!.landsAt) {
      tick(world);
      place(world, id(pl), near(600, 420)); // moved sideways: the start aim and the present position differ
    }
    expect(W(world, a).lock).toBeNull();
    send(world, pl, "attack", { a: 0 }); // it starts an attack in the tick the arrow's draw lands
    tick(world);
    const arrow = [...world.projectiles.values()].find((p) => p.owner === id(a));
    expect(arrow).toBeDefined();
    return (Math.atan2(arrow!.launch.vy, arrow!.launch.vx) * 180) / Math.PI;
  }

  it("the same shot flies the same way whichever of the two joined first", () => {
    const first = arrowAngle(true);
    const second = arrowAngle(false);
    expect(second).toBeCloseTo(first, 6);
    expect(Math.abs(first)).toBeLessThan(1); // along its start aim: the hidden target was not led
  });
});

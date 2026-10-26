// Terrain hazards in the sim (sim/terrainEffects.ts, movement.ts walkFighter, the move-speed floor in step.ts): ember burn,
// bog slow, the ice slide and light heal, on hand-built maps made with mapFromTiles(w, h, tiles, 0, terrain) and the real
// tick. The slide integrator itself is tested in shared/test/walk.test.ts; here it is the fighter that walks.
import { describe, expect, it } from "vitest";
import {
  buffMultiplier, circleClear, GV_KILL, hazardsOf, mapFromTiles, mulberry32, PLAYER_RADIUS, PLAYER_SPEED, segmentClear, SLIP_GRIP_MS,
  TERRAIN_BOG, TERRAIN_EMBER, TERRAIN_FENCE, TERRAIN_ICE, TERRAIN_LIGHT, TICK_MS, TILE, TILE_FLOOR, TILE_LOW, TILE_WALL, worldToTile,
  type FactionId, type FxEvent, type GameMap, type Vec2, type WeaponId,
} from "@raid/shared";
import { downPlayer } from "../src/sim/arena";
import { combatant } from "../src/sim/combatant";
import { displace } from "../src/sim/displace";
import { heal, signatureState } from "../src/sim/factions";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { recordHit } from "../src/sim/ledger";
import { aggro, resetMob } from "../src/sim/mobAI";
import { hurtMob, placeMob, type MobCombatant } from "../src/sim/mobLife";
import { addMob } from "../src/sim/mobs";
import { grantStacks } from "../src/sim/buffs";
import { advanceAlongPath, planPath, regripPath, tickVelocity, walkFighter } from "../src/sim/movement";
import { speedMultOf } from "../src/sim/mods";
import { addPlayer, startRaid, step } from "../src/sim/step";
import { applyBog, LIGHT_FX_MS, slipAccelOf, surfaceOf, TERRAIN_SOURCE } from "../src/sim/terrainEffects";
import { installTraining } from "../src/sim/training";
import type { PlayerRuntime, SimConfig, SimEvent, World } from "../src/sim/world";
import { PlayerState } from "@raid/shared/schema";

// ---------------------------------------------------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------------------------------------------------

const DT = TICK_MS / 1000;
const STEP_U = PLAYER_SPEED * DT;
const tc = (t: number): number => t * TILE + TILE / 2;
const at = (tx: number, ty: number): Vec2 => ({ x: tc(tx), y: tc(ty) });

type TilePredicate = (tx: number, ty: number) => boolean;

interface MapOpts {
  w?: number;
  h?: number;
  /** Terrain kind of a floor tile (a floor kind). */
  kind?: (tx: number, ty: number) => number;
  /** Extra walls inside the border. */
  wall?: TilePredicate;
  /** LOW fence tiles inside the border. */
  fence?: TilePredicate;
}

/** A wall-bordered room of floor with `kind` painted on it, walls and fences as asked, and eight spawns along its top row. */
function terrainMap(o: MapOpts = {}): GameMap {
  const w = o.w ?? 48;
  const h = o.h ?? 30;
  const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
  const terrain = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { tiles[i] = TILE_WALL; continue; }
      if (o.wall?.(x, y)) { tiles[i] = TILE_WALL; continue; }
      if (o.fence?.(x, y)) { tiles[i] = TILE_LOW; terrain[i] = TERRAIN_FENCE; continue; }
      terrain[i] = o.kind?.(x, y) ?? 0;
    }
  }
  const map = mapFromTiles(w, h, tiles, 0, terrain);
  map.spawns = Array.from({ length: 8 }, (_, i) => at(2 + i, 2));
  return map;
}

const everywhere = (kind: number) => (): number => kind;

interface PlayerSpec {
  faction: FactionId;
  weapon?: WeaponId | "";
  at?: Vec2;
  /** Sets hp and max hp (default: the faction's own). */
  hp?: number;
}

interface RigOpts {
  map: GameMap;
  players: PlayerSpec[];
  config?: Partial<SimConfig>;
  signatures?: boolean;
}

const BASE: SimConfig = {
  minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 1e6, patienceMinSeconds: 1e6, suddenDeathSeconds: 1e6,
};

/** An active run of players p0, p1, ... named player0, ... The first step starts it. */
function makeRig(o: RigOpts): World {
  const world = createGameWorld({
    seed: 7, config: { ...BASE, minPlayers: o.players.length, ...o.config }, random: mulberry32(3), map: o.map,
  }, { signatures: o.signatures });
  if (o.config?.training) installTraining(world);
  o.players.forEach((spec, i) => addPlayer(world, `p${i}`, `player${i}`, { faction: spec.faction }));
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  o.players.forEach((spec, i) => {
    const p = world.state.players.get(`p${i}`)!;
    p.weapon0 = spec.weapon ?? "";
    if (spec.hp !== undefined) p.hp = p.maxHp = spec.hp;
    put(world, `p${i}`, spec.at ?? at(4 + 8 * i, 8));
  });
  return world;
}

function put(world: World, id: string, v: Vec2): void {
  const p = world.state.players.get(id)!;
  const rt = world.players.get(id)!;
  p.x = v.x;
  p.y = v.y;
  rt.path = [];
  rt.slip = null;
  rt.history = [{ t: world.state.serverTime, x: v.x, y: v.y }];
}

const P = (world: World, id: string): PlayerState => world.state.players.get(id)!;
const RT = (world: World, id: string): PlayerRuntime => world.players.get(id)!;

function run(world: World, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...step(world, TICK_MS));
  return out;
}

const fxs = (events: SimEvent[]): FxEvent[] => events.flatMap((e) => (e.type === "fx" ? [e.fx] : []));
const fxOf = <K extends FxEvent["kind"]>(events: SimEvent[], kind: K): Array<Extract<FxEvent, { kind: K }>> =>
  fxs(events).filter((f): f is Extract<FxEvent, { kind: K }> => f.kind === kind);

function order(world: World, id: string, type: "move" | "stop" | "target" | "attack", msg: object = {}): void {
  expect(enqueueClientMessage(RT(world, id).inputs, type, msg)).toBe(true);
}

// ---------------------------------------------------------------------------------------------------------------------
// Ember
// ---------------------------------------------------------------------------------------------------------------------

describe("ember burn", () => {
  it("burns an alien 2% of max hp per second as true damage and not Fire, with no hit fx and no combat", () => {
    const world = makeRig({
      map: terrainMap({ kind: everywhere(TERRAIN_EMBER) }),
      players: [{ faction: "frost", at: at(8, 8) }, { faction: "fire", at: at(30, 20) }, { faction: "sentenced", at: at(8, 24) }],
    });
    const frost = P(world, "p0");
    const events = run(world, 20);
    expect(frost.maxHp - frost.hp).toBeCloseTo(0.02 * frost.maxHp, 6);
    expect(P(world, "p1").hp).toBe(P(world, "p1").maxHp);
    expect(P(world, "p2").maxHp - P(world, "p2").hp).toBeCloseTo(0.02 * P(world, "p2").maxHp, 6);
    expect(fxOf(events, "hit")).toEqual([]);
    // Not combat: the clock the heal lockout reads is untouched, and a heal goes through right after.
    expect(signatureState(world, "p0")!.combatAt).toBe(-Infinity);
    expect(heal(world, combatant(world, "p0")!, 5, { quiet: true })).toBe(5);
    // The counters the measurement harness reads.
    const stats = world.hazards.stats;
    expect(stats.damage.get("p0")!.ember).toBeCloseTo(0.02 * frost.maxHp, 6);
    expect(stats.damage.has("p1")).toBe(false);
    expect(stats.seconds.ember).toBeCloseTo(2, 9); // p0 and p2, one second each
  });

  it("a fighter inside teleport immunity loses nothing", () => {
    const world = makeRig({ map: terrainMap({ kind: everywhere(TERRAIN_EMBER) }), players: [{ faction: "frost" }, { faction: "fire" }] });
    P(world, "p0").immuneUntil = world.state.serverTime + 10_000;
    run(world, 20);
    expect(P(world, "p0").hp).toBe(P(world, "p0").maxHp);
  });

  it("a kill barrier absorbs it first, and it never staggers", () => {
    const world = makeRig({ map: terrainMap({ kind: everywhere(TERRAIN_EMBER) }), players: [{ faction: "frost" }, { faction: "fire" }] });
    const p = P(world, "p0");
    p.barrier = 10;
    run(world, 20);
    expect(p.barrier).toBe(0);
    expect(p.maxHp - p.hp).toBeCloseTo(0.02 * p.maxHp - 10, 6);
    expect(RT(world, "p0").weapon.staggerImmuneUntil).toBe(0);
  });

  it("scales with max hp: every hp pool lasts as long", () => {
    const world = makeRig({
      map: terrainMap({ kind: everywhere(TERRAIN_EMBER) }),
      players: [{ faction: "frost", hp: 1000 }, { faction: "holy", hp: 100 }, { faction: "fire" }],
    });
    run(world, 40);
    expect(P(world, "p0").hp).toBeCloseTo(1000 * 0.96, 6);
    expect(P(world, "p1").hp).toBeCloseTo(100 * 0.96, 6);
  });

  describe("the damage counters hold the hp actually lost (m3)", () => {
    const rawPerTick = (maxHp: number): number => 0.02 * maxHp * DT;
    const ember = (world: World, id: string): number | undefined => world.hazards.stats.damage.get(id)?.ember;
    const two = (): World => makeRig({ map: terrainMap({ kind: everywhere(TERRAIN_EMBER) }), players: [{ faction: "frost" }, { faction: "fire" }] });

    it("a kill barrier takes its share first: the counter is the hp that went", () => {
      const world = two();
      const p = P(world, "p0");
      p.barrier = 10;
      run(world, 20);
      expect(p.barrier).toBe(0);
      expect(ember(world, "p0")).toBeCloseTo(0.02 * p.maxHp - 10, 6);
      expect(ember(world, "p0")).toBeCloseTo(p.maxHp - p.hp, 9);
    });

    it("teleport immunity refuses the burn, and the counter stays empty", () => {
      const world = two();
      P(world, "p0").immuneUntil = world.state.serverTime + 10_000;
      run(world, 20);
      expect(world.hazards.stats.damage.has("p0")).toBe(false);
      // The time it stood on the ember is still counted: seconds are fighter-seconds acted on, damage is hp lost.
      expect(world.hazards.stats.seconds.ember).toBeCloseTo(1, 9);
    });

    it("a killing tick counts the hp that was left, not the overkill", () => {
      const world = two();
      const p = P(world, "p0");
      const raw = rawPerTick(p.maxHp);
      p.hp = raw / 4;
      run(world, 1);
      expect(p.status).toBe("dead");
      expect(ember(world, "p0")).toBeCloseTo(raw / 4, 9);
    });

    it("in a pass with a rival's hit the burn is credited its share of what was removed", () => {
      const world = two();
      const p = P(world, "p0");
      const raw = rawPerTick(p.maxHp);
      p.hp = raw / 2;
      world.beforeDamage.push((w) => {
        recordHit(w, { victim: "p0", by: { id: "p1", name: "player1" }, packet: { raw: 3 * raw, phys: 0, magic: 0, true: 1 }, weapon: "sword", stagger: false });
      });
      run(world, 1);
      expect(p.status).toBe("dead");
      // raw/2 hp went; the burn asked for a quarter of the pass.
      expect(ember(world, "p0")).toBeCloseTo(raw / 8, 9);
    });

    it("a regional mob's counter is the hp it lost too", () => {
      const world = makeRig({ map: terrainMap({ kind: everywhere(TERRAIN_EMBER) }), players: [{ faction: "fire", at: at(30, 20) }, { faction: "fire", at: at(30, 24) }] });
      const id = placeMob(world, { region: "plague", elite: false, at: at(10, 10) });
      const m = combatant(world, id) as MobCombatant;
      m.s.hp = 0.2;
      run(world, 1);
      expect(m.s.status).toBe("dead");
      expect(ember(world, id)).toBeCloseTo(0.2, 9);
    });
  });

  describe("a locked arena burns nothing (m4)", () => {
    function locked(suddenDeath: boolean): World {
      const world = makeRig({
        map: terrainMap({ kind: everywhere(TERRAIN_EMBER) }),
        players: [{ faction: "frost", at: at(8, 8) }, { faction: "fire", at: at(30, 20) }],
      });
      world.state.gatesLocked = true;
      world.state.suddenDeathAt = suddenDeath ? world.state.serverTime : 0;
      return world;
    }

    it("ember under a locked coliseum records no terrain entry and takes no hp", () => {
      const world = locked(false);
      let terrainEntries = 0;
      world.beforeDamage.push((w) => { for (const e of w.combat.ledger) if (e.by.id.startsWith("terrain:")) terrainEntries++; });
      run(world, 20);
      expect(terrainEntries).toBe(0);
      expect(P(world, "p0").hp).toBe(P(world, "p0").maxHp);
      expect(world.hazards.stats.seconds.ember).toBe(0);
    });

    it("a death to sudden death credits nobody, rival's hit within 5 s or not", () => {
      const world = locked(true);
      P(world, "p0").hp = 1;
      RT(world, "p0").lastHit = { by: "p1", at: world.state.serverTime - 2000 };
      let terrainEntries = 0;
      world.beforeDamage.push((w) => { for (const e of w.combat.ledger) if (e.by.id.startsWith("terrain:")) terrainEntries++; });
      const events = run(world, 1);
      expect(P(world, "p0").status).toBe("dead");
      expect(terrainEntries).toBe(0);
      expect(P(world, "p1").kills).toBe(0);
      expect(RT(world, "p1").gv.kills).toBe(0);
      const result = events.find((e): e is Extract<SimEvent, { type: "resolved" }> => e.type === "resolved" && e.id === "p0")!;
      expect(result.result.killedBy).toBe("sudden death");
      // Sudden death's own entry is an arena entry too, but not a terrain kind: the hazard counters leave it out.
      expect(world.hazards.stats.damage.size).toBe(0);
    });
  });

  it("only the tile under the centre counts", () => {
    // Ember on columns 10..11 only; a fighter on column 12 is safe, one on column 11 burns.
    const world = makeRig({
      map: terrainMap({ kind: (tx) => (tx === 10 || tx === 11 ? TERRAIN_EMBER : 0) }),
      players: [{ faction: "frost", at: { x: 12 * TILE + 0.01, y: tc(8) } }, { faction: "plague", at: { x: 12 * TILE - 0.01, y: tc(14) } }, { faction: "fire" }],
    });
    run(world, 20);
    expect(P(world, "p0").hp).toBe(P(world, "p0").maxHp);
    expect(P(world, "p1").maxHp - P(world, "p1").hp).toBeCloseTo(0.02 * P(world, "p1").maxHp, 6);
  });

  it("SimConfig.hazards: false switches it off, and 'all' takes the home exemption away", () => {
    const off = makeRig({ map: terrainMap({ kind: everywhere(TERRAIN_EMBER) }), players: [{ faction: "frost" }, { faction: "fire" }], config: { hazards: false } });
    run(off, 20);
    expect(P(off, "p0").hp).toBe(P(off, "p0").maxHp);
    const all = makeRig({ map: terrainMap({ kind: everywhere(TERRAIN_EMBER) }), players: [{ faction: "frost" }, { faction: "fire" }, { faction: "holy" }], config: { hazards: "all" } });
    run(all, 20);
    expect(P(all, "p1").maxHp - P(all, "p1").hp).toBeCloseTo(0.02 * P(all, "p1").maxHp, 6);
  });

  describe("kill credit", () => {
    function dying(opts: { sinceHit?: number; bounty?: number; sameTickHit?: boolean }): { world: World; events: SimEvent[] } {
      const world = makeRig({
        map: terrainMap({ kind: everywhere(TERRAIN_EMBER) }),
        // The rival and the bystander are Fire, so the lava leaves them alone.
        players: [{ faction: "frost", at: at(8, 8) }, { faction: "fire", at: at(30, 20) }, { faction: "fire", at: at(20, 24) }],
      });
      P(world, "p0").hp = 1;
      if (opts.bounty) P(world, "p0").bounty = opts.bounty;
      if (opts.sinceHit !== undefined) RT(world, "p0").lastHit = { by: "p1", at: world.state.serverTime - opts.sinceHit };
      if (opts.sameTickHit) {
        world.beforeDamage.push((w) => {
          recordHit(w, { victim: "p0", by: { id: "p1", name: "player1" }, packet: { raw: 50, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false });
        });
      }
      return { world, events: run(world, 1) };
    }

    it("a rival who hit within 5 s gets the kill, its GV and the recap reads Lava", () => {
      const { world, events } = dying({ sinceHit: 3000 });
      expect(P(world, "p0").status).toBe("dead");
      expect(P(world, "p1").kills).toBe(1);
      expect(RT(world, "p1").gv.kills).toBe(GV_KILL);
      const result = events.find((e): e is Extract<SimEvent, { type: "resolved" }> => e.type === "resolved" && e.id === "p0")!;
      expect(result.result.killedBy).toBe("Lava");
      expect(result.result.outcome).toBe("died");
      const death = fxOf(events, "death").find((d) => d.id === "p0")!;
      expect(death.by).toBeNull();
    });

    it("6 s after the rival's hit there is no credit", () => {
      const { world, events } = dying({ sinceHit: 6000 });
      expect(P(world, "p0").status).toBe("dead");
      expect(P(world, "p1").kills).toBe(0);
      expect(RT(world, "p1").gv.kills).toBe(0);
      const result = events.find((e): e is Extract<SimEvent, { type: "resolved" }> => e.type === "resolved" && e.id === "p0")!;
      expect(result.result.killedBy).toBe("Lava");
    });

    it("a rival's hit in the same pass takes the kill and the recap", () => {
      const { world, events } = dying({ sameTickHit: true });
      expect(P(world, "p0").status).toBe("dead");
      expect(P(world, "p1").kills).toBe(1);
      const result = events.find((e): e is Extract<SimEvent, { type: "resolved" }> => e.type === "resolved" && e.id === "p0")!;
      expect(result.result.killedBy).toBe("player1");
      expect(fxOf(events, "death").find((d) => d.id === "p0")!.by).toBe("p1");
    });

    it("the rival is paid the victim's bounty", () => {
      const { world } = dying({ sinceHit: 2000, bounty: 7 });
      expect(RT(world, "p1").gv.bounty).toBe(7);
    });

    it("nobody is paid for a lava death with no rival, and the run goes on", () => {
      const { world } = dying({});
      expect(P(world, "p1").kills).toBe(0);
      expect(P(world, "p2").kills).toBe(0);
      expect(world.state.phase).toBe("active");
    });
  });

  describe("mobs", () => {
    function mobWorld(): World {
      return makeRig({ map: terrainMap({ kind: everywhere(TERRAIN_EMBER) }), players: [{ faction: "fire", at: at(30, 20) }, { faction: "fire", at: at(30, 24) }] });
    }

    it("an alien regional mob on ember loses hp and is not woken by it", () => {
      const world = mobWorld();
      const id = placeMob(world, { region: "plague", elite: false, at: at(10, 10) });
      const m = combatant(world, id) as MobCombatant;
      run(world, 20);
      expect(m.s.maxHp - m.s.hp).toBeCloseTo(0.02 * m.s.maxHp, 6);
      expect(m.rt.brain!.threat.size).toBe(0);
      expect(m.rt.brain!.mode).toBe("idle");
      expect(m.rt.brain!.target).toBeNull();
    });

    it("a Fire mob, a mob walking home and a training dummy lose nothing", () => {
      const world = mobWorld();
      const fire = combatant(world, placeMob(world, { region: "fire", elite: false, at: at(10, 10) })) as MobCombatant;
      const home = combatant(world, placeMob(world, { region: "plague", elite: false, at: at(14, 10) })) as MobCombatant;
      home.rt.brain!.mode = "return";
      home.rt.brain!.home = at(40, 10); // a long walk: it is evading for all of the 20 ticks
      const dummy = combatant(world, addMob(world, { kind: "dummy", name: "Dummy", at: at(18, 10) }))!;
      run(world, 20);
      expect(fire.s.hp).toBe(fire.s.maxHp);
      expect(home.s.hp).toBe(home.s.maxHp);
      expect(dummy.s.hp).toBe(dummy.s.maxHp);
    });

    it("a mob that burns down dies, nobody is credited and its death fx names no one", () => {
      const world = mobWorld();
      const id = placeMob(world, { region: "plague", elite: false, at: at(10, 10) });
      const m = combatant(world, id) as MobCombatant;
      m.s.hp = 0.2;
      const events = run(world, 1);
      expect(m.s.status).toBe("dead");
      expect(fxOf(events, "death").find((d) => d.id === id)!.by).toBeNull();
      expect(P(world, "p0").mobKills).toBe(0);
    });
  });

  it("is active in training, and a burn death is revived the same tick with nothing resolved", () => {
    const world = makeRig({
      map: terrainMap({ kind: everywhere(TERRAIN_EMBER) }),
      players: [{ faction: "frost" }],
      config: { training: true, patienceSeconds: 1e6 },
    });
    expect(world.state.training).toBe(true);
    const p = P(world, "p0");
    run(world, 20);
    expect(p.maxHp - p.hp).toBeCloseTo(0.02 * p.maxHp, 6);
    p.hp = 1;
    RT(world, "p0").slip = { vx: 5, vy: 0, ax: 0, ay: 0, path: null, replanAt: 0 };
    const events = run(world, 1);
    expect(events.filter((e) => e.type === "resolved")).toEqual([]);
    expect(p.status).toBe("alive");
    expect(p.hp).toBe(p.maxHp);
    expect(RT(world, "p0").slip ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Bog
// ---------------------------------------------------------------------------------------------------------------------

describe("bog slow", () => {
  const bogWorld = (players: PlayerSpec[], config?: Partial<SimConfig>): World =>
    makeRig({ map: terrainMap({ w: 64, kind: everywhere(TERRAIN_BOG) }), players, config });

  const walkOneSecond = (world: World, id: string, before?: () => void): number => {
    const p = P(world, id);
    const x0 = p.x;
    order(world, id, "move", { x: 60 * TILE, y: p.y });
    for (let i = 0; i < 20; i++) {
      before?.();
      step(world, TICK_MS);
    }
    return p.x - x0;
  };

  it("a 1 s walk on bog covers 119 u for Frost and 170 u for Plague (its home)", () => {
    const world = bogWorld([{ faction: "frost", at: at(3, 5) }, { faction: "plague", at: at(3, 12) }, { faction: "fire", at: at(3, 20) }]);
    const moved = [0, 1, 2].map((i) => {
      const p = P(world, `p${i}`);
      order(world, `p${i}`, "move", { x: 60 * TILE, y: p.y });
      return p.x;
    });
    run(world, 20);
    expect(P(world, "p0").x - moved[0]!).toBeCloseTo(119, 6);
    expect(P(world, "p1").x - moved[1]!).toBeCloseTo(170, 6);
    expect(P(world, "p2").x - moved[2]!).toBeCloseTo(119, 6);
    expect(world.hazards.stats.seconds.bog).toBeCloseTo(2, 9);
  });

  it("chilled by a Frost within 100 u it walks at 0.7 x 0.7 = 0.49", () => {
    const world = bogWorld([{ faction: "fire", at: at(3, 10) }, { faction: "frost", at: at(3, 10) }, { faction: "fire", at: at(3, 24) }]);
    const walker = P(world, "p0");
    run(world, 1); // the faction layer keeps a record per fighter once the run is ticking
    const x0 = walker.x;
    order(world, "p0", "move", { x: 60 * TILE, y: walker.y });
    for (let i = 0; i < 20; i++) {
      // A Frost that is chilling it, kept beside it (the chill is recomputed from engagements at the end of every tick).
      put(world, "p1", { x: walker.x + 40, y: walker.y });
      signatureState(world, "p0")!.chillers.push("p1");
      step(world, TICK_MS);
    }
    expect(walker.x - x0).toBeCloseTo(PLAYER_SPEED * 0.49, 6);
  });

  it("with 3 move stacks the buff multiplies in as well", () => {
    const world = bogWorld([{ faction: "fire", at: at(3, 10) }, { faction: "sentenced", at: at(3, 24) }]);
    grantStacks(world, P(world, "p0"), RT(world, "p0"), "moveSpeed", 3);
    const buff = speedMultOf(P(world, "p0"));
    expect(buff).toBeGreaterThan(1.05);
    expect(buff).toBeCloseTo(buffMultiplier("moveSpeed", 3), 1);
    const moved = walkOneSecond(world, "p0");
    expect(moved).toBeCloseTo(PLAYER_SPEED * 0.7 * buff, 6);
  });

  it("a centre on plain ground beside bog walks at full speed, and slows the tick it is on bog", () => {
    const world = makeRig({
      map: terrainMap({ w: 64, kind: (tx) => (tx >= 20 ? TERRAIN_BOG : 0) }),
      players: [{ faction: "fire", at: { x: 20 * TILE - 1, y: tc(8) } }, { faction: "sentenced", at: at(3, 24) }],
    });
    const p = P(world, "p0");
    order(world, "p0", "move", { x: 60 * TILE, y: p.y });
    const x0 = p.x;
    step(world, TICK_MS);
    expect(p.x - x0).toBeCloseTo(STEP_U, 9); // read at tick start: still plain
    const x1 = p.x;
    step(world, TICK_MS);
    expect(p.x - x1).toBeCloseTo(STEP_U * 0.7, 9);
  });

  it("the product of the move modifiers never drops below 0.35, a root stays 0, and a product above 1 is untouched", () => {
    const world = bogWorld([{ faction: "fire", at: at(3, 10) }, { faction: "sentenced", at: at(3, 24) }, { faction: "holy", at: at(3, 17) }]);
    // A (made-up) 0.4 slow on top of the bog's 0.7 would give 0.28.
    world.moveModifiers.push((_w, c) => (c.id === "p0" ? 0.4 : 1));
    world.moveModifiers.push((_w, c) => (c.id === "p2" ? 3 : 1));
    const moved = walkOneSecond(world, "p0");
    expect(moved).toBeCloseTo(PLAYER_SPEED * 0.35, 6);
    // A windup roots the fighter whatever the floor.
    const p1 = P(world, "p1");
    p1.weapon0 = "sword";
    const x1 = p1.x;
    order(world, "p1", "move", { x: 60 * TILE, y: p1.y });
    order(world, "p1", "attack", { a: 0 });
    run(world, 1);
    expect(p1.x).toBe(x1);
    expect(RT(world, "p1").weapon.action).not.toBeNull();
    const p2 = P(world, "p2");
    const x2 = p2.x;
    order(world, "p2", "move", { x: 60 * TILE, y: p2.y });
    run(world, 20);
    expect(p2.x - x2).toBeCloseTo(PLAYER_SPEED * 3 * 0.7, 6);
  });

  it("dummies and mobs read the same table: a Plague mob is at home, a Fire mob is slowed, a dummy is not", () => {
    const world = bogWorld([{ faction: "fire", at: at(40, 20) }, { faction: "fire", at: at(40, 24) }]);
    const plague = combatant(world, placeMob(world, { region: "plague", elite: false, at: at(5, 5) }))!;
    const fire = combatant(world, placeMob(world, { region: "fire", elite: false, at: at(5, 8) }))!;
    const dummy = combatant(world, addMob(world, { kind: "dummy", name: "Dummy", at: at(5, 11) }))!;
    expect(surfaceOf(world, plague).speedMult).toBe(1);
    expect(surfaceOf(world, fire).speedMult).toBe(0.7);
    expect(surfaceOf(world, dummy).speedMult).toBe(1);
    expect(surfaceOf(world, dummy).kind).toBe(0);
  });

  it("SimConfig.hazards: false leaves the walk alone", () => {
    const world = bogWorld([{ faction: "frost", at: at(3, 5) }, { faction: "fire", at: at(3, 20) }], { hazards: false });
    expect(walkOneSecond(world, "p0")).toBeCloseTo(170, 6);
  });

  it("counts the seconds it slowed by the step it was handed, not by TICK_MS", () => {
    const world = bogWorld([{ faction: "frost", at: at(3, 5) }, { faction: "plague", at: at(3, 20) }]);
    for (let i = 0; i < 4; i++) step(world, 25);
    expect(world.hazards.stats.seconds.bog).toBeCloseTo(0.1, 9); // the Frost player only: Plague is at home
    // A caller outside the tick passes nothing: the default step.
    expect(applyBog(world, combatant(world, "p0")!)).toBe(0.7);
    expect(world.hazards.stats.seconds.bog).toBeCloseTo(0.1 + TICK_MS / 1000, 9);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Ice
// ---------------------------------------------------------------------------------------------------------------------

describe("ice", () => {
  const iceWorld = (players: PlayerSpec[], o: Omit<MapOpts, "kind"> = {}, config?: Partial<SimConfig>, signatures?: boolean): World =>
    makeRig({ map: terrainMap({ w: 64, ...o, kind: everywhere(TERRAIN_ICE) }), players, config, signatures });

  describe("off ice, today's walk, bit for bit", () => {
    /**
     * 400 ticks of random orders (from a player who never stands on slippery ground, or is exempt from it) give Object.is-equal
     * x, y, facing and path length to advanceAlongPath, and no slide is ever created.
     */
    function expectPlainWalk(world: World, tiles: { x: number; y: number }): void {
      const ref = { x: P(world, "p0").x, y: P(world, "p0").y, facing: P(world, "p0").facing };
      const refRt = { path: [] as Vec2[] };
      const rnd = mulberry32(99);
      for (let tick = 0; tick < 400; tick++) {
        if (rnd() < 0.12) {
          if (rnd() < 0.15) {
            order(world, "p0", "stop", {});
            refRt.path = [];
          } else {
            const to = { x: (1 + rnd() * tiles.x) * TILE, y: (1 + rnd() * tiles.y) * TILE };
            order(world, "p0", "move", to);
            const path = planPath(world, ref, to);
            if (path.length > 0) refRt.path = path;
          }
        }
        step(world, TICK_MS);
        advanceAlongPath(ref, refRt, DT, false, 1);
        const p = P(world, "p0");
        expect(Object.is(p.x, ref.x), `x at tick ${tick}`).toBe(true);
        expect(Object.is(p.y, ref.y), `y at tick ${tick}`).toBe(true);
        expect(Object.is(p.facing, ref.facing), `facing at tick ${tick}`).toBe(true);
        expect(RT(world, "p0").path.length).toBe(refRt.path.length);
        expect(RT(world, "p0").slip ?? null).toBeNull();
      }
    }
    const pillars: TilePredicate = (x, y) => x % 9 === 4 && y % 7 === 3;

    it("a 400-tick script of random orders gives Object.is-equal x, y, facing and path length to advanceAlongPath", () => {
      // Pillars and a fence on a map with no terrain: the plain walker is the only code that runs.
      const map = terrainMap({ w: 48, h: 30, wall: pillars, fence: (x, y) => x === 30 && y >= 4 && y <= 20 });
      expect(hazardsOf(map).slip).toBe(false);
      expectPlainWalk(makeRig({ map, players: [{ faction: "plague", at: at(6, 6) }, { faction: "fire", at: at(40, 24) }] }), { x: 46, y: 28 });
    });

    it("the same, for a Plague player on plain floor of a map that HAS ice (the slide path is never entered)", () => {
      const map = terrainMap({
        w: 48, h: 30, wall: pillars, fence: (x, y) => x === 30 && y >= 4 && y <= 20, kind: (tx) => (tx >= 36 ? TERRAIN_ICE : 0),
      });
      expect(hazardsOf(map).slip).toBe(true);
      const world = makeRig({ map, players: [{ faction: "plague", at: at(6, 6) }, { faction: "fire", at: at(40, 24) }] });
      expectPlainWalk(world, { x: 28, y: 28 }); // west of the fence and of the ice
      expect(world.hazards.stats.seconds.ice).toBe(0);
    });

    it("the same, for a Frost player on ice (its home exempts it: full grip, no slide)", () => {
      const map = terrainMap({ w: 48, h: 30, wall: pillars, fence: (x, y) => x === 30 && y >= 4 && y <= 20, kind: everywhere(TERRAIN_ICE) });
      const world = makeRig({ map, players: [{ faction: "frost", at: at(6, 6) }, { faction: "fire", at: at(41, 25) }] });
      expect(slipAccelOf(world, combatant(world, "p0")!)).toBe(0);
      expect(slipAccelOf(world, combatant(world, "p1")!)).toBeGreaterThan(0);
      expectPlainWalk(world, { x: 46, y: 28 });
      expect(world.hazards.stats.seconds.ice).toBeGreaterThan(0); // p1, the Fire player, stands on ice the whole time
    });

    it("walkFighter called directly is advanceAlongPath on ground without terrain", () => {
      const world = makeRig({ map: terrainMap(), players: [{ faction: "plague", at: at(6, 6) }, { faction: "fire", at: at(40, 24) }] });
      const c = combatant(world, "p0")!;
      const a = { x: c.s.x, y: c.s.y, facing: 0.3 };
      const rtA = { path: [at(20, 6), at(20, 14)] as Vec2[] };
      c.s.facing = 0.3;
      c.rt.path = [at(20, 6), at(20, 14)];
      for (let i = 0; i < 60; i++) {
        walkFighter(world, c, DT, false, 1);
        advanceAlongPath(a, rtA, DT, false, 1);
        expect(Object.is(c.s.x, a.x) && Object.is(c.s.y, a.y) && Object.is(c.s.facing, a.facing)).toBe(true);
      }
    });
  });

  describe("on the ice", () => {
    it("a Frost fighter keeps full grip and walks the path exactly", () => {
      const world = iceWorld([{ faction: "frost", at: at(4, 8) }, { faction: "fire", at: at(40, 24) }]);
      const p = P(world, "p0");
      order(world, "p0", "move", { x: 40 * TILE, y: p.y });
      let prev = p.x;
      for (let i = 0; i < 10; i++) {
        step(world, TICK_MS);
        expect(p.x - prev).toBeCloseTo(STEP_U, 9);
        prev = p.x;
      }
      expect(RT(world, "p0").slip ?? null).toBeNull();
    });

    it("anyone else accelerates to full speed in 8 ticks over 34 u, and slides 34 u to a stop", () => {
      const world = iceWorld([{ faction: "plague", at: at(4, 8) }, { faction: "fire", at: at(40, 24) }]);
      const p = P(world, "p0");
      const x0 = p.x;
      order(world, "p0", "move", { x: 60 * TILE, y: p.y });
      run(world, 8);
      expect(p.x - x0).toBeCloseTo(34, 9);
      expect(RT(world, "p0").slip!.vx).toBeCloseTo(PLAYER_SPEED, 9);
      run(world, 4);
      const x1 = p.x;
      order(world, "p0", "stop", {});
      run(world, 8);
      expect(p.x - x1).toBeCloseTo(34, 6);
      expect(RT(world, "p0").slip!.vx).toBe(0);
      run(world, 3);
      expect(p.x - x1).toBeCloseTo(34, 6);
      expect(world.hazards.stats.seconds.ice).toBeGreaterThan(1.5);
    });

    it("a clicked point is reached exactly: the walk brakes and never overshoots", () => {
      const world = iceWorld([{ faction: "plague", at: at(4, 8) }, { faction: "fire", at: at(40, 24) }]);
      const p = P(world, "p0");
      const target = { x: p.x + 300, y: p.y };
      order(world, "p0", "move", target);
      let maxX = p.x;
      for (let i = 0; i < 60; i++) {
        step(world, TICK_MS);
        maxX = Math.max(maxX, p.x);
      }
      expect(Math.abs(p.x - target.x)).toBeLessThan(1e-6);
      expect(maxX).toBeLessThan(target.x + 1e-6);
      expect(RT(world, "p0").path).toHaveLength(0);
    });

    it("a chill or a buff scales the top speed, not the traction", () => {
      const world = iceWorld([{ faction: "fire", at: at(4, 8) }, { faction: "fire", at: at(40, 24) }]);
      world.moveModifiers.push((_w, c) => (c.id === "p0" ? 0.5 : 1));
      order(world, "p0", "move", { x: 60 * TILE, y: P(world, "p0").y });
      run(world, 30);
      expect(RT(world, "p0").slip!.vx).toBeCloseTo(PLAYER_SPEED * 0.5, 9);
    });

    it("entering ice carries the walk velocity: the first ice tick moves as far as the tick before", () => {
      const world = makeRig({
        map: terrainMap({ w: 64, kind: (tx) => (tx >= 20 ? TERRAIN_ICE : 0) }),
        players: [{ faction: "plague", at: at(8, 8) }, { faction: "fire", at: at(40, 24) }],
      });
      const p = P(world, "p0");
      order(world, "p0", "move", { x: 60 * TILE, y: p.y });
      const xs = [p.x];
      for (let i = 0; i < 60; i++) {
        step(world, TICK_MS);
        xs.push(p.x);
      }
      // tick t starts at xs[t-1]; the first one that starts on ice:
      const first = xs.findIndex((x, i) => i >= 1 && worldToTile(xs[i - 1]!) >= 20) ;
      expect(first).toBeGreaterThan(3);
      const onIce = xs[first]! - xs[first - 1]!;
      const before = xs[first - 1]! - xs[first - 2]!;
      expect(Math.abs(onIce - before)).toBeLessThan(1e-9);
      expect(onIce).toBeCloseTo(STEP_U, 9);
      expect(RT(world, "p0").slip).not.toBeNull();
    });

    it("tickVelocity is the last tick's displacement over its time, zero with fewer than two samples", () => {
      expect(tickVelocity([])).toEqual({ x: 0, y: 0 });
      expect(tickVelocity([{ t: 0, x: 5, y: 5 }])).toEqual({ x: 0, y: 0 });
      expect(tickVelocity([{ t: 0, x: 0, y: 0 }, { t: 50, x: 8.5, y: -4.25 }, { t: 100, x: 17, y: -8.5 }])).toEqual({ x: 170, y: -85 });
      expect(tickVelocity([{ t: 50, x: 0, y: 0 }, { t: 50, x: 8, y: 0 }])).toEqual({ x: 0, y: 0 });
    });

    it("leaving the ice grips at once, and a walk the slide carried off the line is planned again", () => {
      // A pillar just off the ice: the walk's next leg, from where the fighter stands, runs through it.
      const map = terrainMap({
        w: 64, kind: (tx) => (tx < 20 ? TERRAIN_ICE : 0), wall: (tx, ty) => tx === 23 && ty >= 7 && ty <= 9,
      });
      const world = makeRig({ map, players: [{ faction: "plague", at: { x: 20 * TILE + 4, y: tc(8) } }, { faction: "fire", at: at(40, 24) }] });
      const c = combatant(world, "p0")!;
      c.rt.slip = { vx: 60, vy: 0, ax: c.s.x, ay: c.s.y, path: null, replanAt: 0 };
      c.rt.path = [{ x: tc(26), y: tc(8) }];
      expect(segmentClear(world.map, c.s, c.rt.path[0]!, PLAYER_RADIUS)).toBe(false);
      const replanned = regripPath(world, c);
      expect(replanned.length).toBeGreaterThan(1);
      expect(replanned[replanned.length - 1]).toEqual({ x: tc(26), y: tc(8) });
      expect(segmentClear(world.map, c.s, replanned[0]!, PLAYER_RADIUS)).toBe(true);
      walkFighter(world, c, DT, false, 1);
      expect(c.rt.slip).toBeNull();
      expect(circleClear(world.map, c.s, PLAYER_RADIUS - 1e-6)).toBe(true);
      expect(c.rt.path).not.toBe(replanned); // planned afresh (same route), kept as the fighter's walk
      expect(c.rt.path.length).toBeGreaterThan(0);
      // And it walks that route to the end without touching the pillar.
      for (let i = 0; i < 80; i++) {
        walkFighter(world, c, DT, false, 1);
        expect(circleClear(world.map, c.s, PLAYER_RADIUS - 1e-6)).toBe(true);
      }
      expect(Math.hypot(c.s.x - tc(26), c.s.y - tc(8))).toBeLessThan(1e-9);
    });

    it("leaving the ice with the leg still clear keeps the same path array", () => {
      const world = makeRig({
        map: terrainMap({ w: 64, kind: (tx) => (tx < 20 ? TERRAIN_ICE : 0) }),
        players: [{ faction: "plague", at: { x: 20 * TILE + 4, y: tc(8) } }, { faction: "fire", at: at(40, 24) }],
      });
      const c = combatant(world, "p0")!;
      c.rt.slip = { vx: 60, vy: 0, ax: c.s.x, ay: c.s.y, path: null, replanAt: 0 };
      const path = [at(30, 8)];
      c.rt.path = path;
      expect(regripPath(world, c)).toBe(path);
      expect(slipAccelOf(world, c)).toBe(0);
    });

    it("a windup plants the slide in that tick: nothing moves, the velocity is zero", () => {
      const world = iceWorld([{ faction: "fire", weapon: "sword", at: at(4, 8) }, { faction: "plague", at: at(40, 24) }]);
      const p = P(world, "p0");
      order(world, "p0", "move", { x: 60 * TILE, y: p.y });
      run(world, 8);
      expect(RT(world, "p0").slip!.vx).toBeCloseTo(PLAYER_SPEED, 9);
      const x = p.x;
      order(world, "p0", "attack", { a: 0 });
      run(world, 1);
      expect(RT(world, "p0").weapon.action).not.toBeNull();
      expect(p.x).toBe(x);
      expect([RT(world, "p0").slip!.vx, RT(world, "p0").slip!.vy]).toEqual([0, 0]);
    });

    it("a lock's windup that starts on ice plants the slide too", () => {
      const world = iceWorld(
        [{ faction: "fire", weapon: "sword", at: at(4, 8) }, { faction: "plague", at: at(40, 24) }], {}, undefined, false,
      );
      const dummy = addMob(world, { kind: "dummy", name: "Dummy", at: at(14, 8) });
      order(world, "p0", "target", { id: dummy });
      const p = P(world, "p0");
      let planted = false;
      let fastest = 0;
      for (let i = 0; i < 120 && !planted; i++) {
        const x = p.x;
        step(world, TICK_MS);
        fastest = Math.max(fastest, RT(world, "p0").slip ? Math.hypot(RT(world, "p0").slip!.vx, RT(world, "p0").slip!.vy) : 0);
        if (RT(world, "p0").weapon.action !== null) {
          planted = true;
          expect(p.x).toBe(x);
          expect([RT(world, "p0").slip!.vx, RT(world, "p0").slip!.vy]).toEqual([0, 0]);
        }
      }
      expect(planted).toBe(true);
      expect(fastest).toBeGreaterThan(50);
    });

    it("a sword lock on a dummy across ice reaches it and lands a hit within 3 s", () => {
      const world = iceWorld(
        [{ faction: "fire", weapon: "sword", at: at(4, 8) }, { faction: "plague", at: at(40, 24) }], {}, undefined, false,
      );
      const dummy = addMob(world, { kind: "dummy", name: "Dummy", at: at(16, 10) });
      order(world, "p0", "target", { id: dummy });
      const events = run(world, 60);
      expect(fxOf(events, "hit").some((h) => h.id === dummy && h.by === "p0" && h.weapon === "sword")).toBe(true);
    });

    it("a mob walks home across ice and stops on its spot", () => {
      const world = iceWorld([{ faction: "fire", at: at(40, 24) }, { faction: "fire", at: at(40, 20) }]);
      const home = at(20, 10);
      const id = placeMob(world, { region: "plague", elite: false, at: at(8, 10) });
      const m = combatant(world, id) as MobCombatant;
      m.rt.brain!.home = home;
      m.rt.brain!.mode = "return";
      for (let i = 0; i < 200 && m.rt.brain!.mode === "return"; i++) step(world, TICK_MS);
      expect(m.rt.brain!.mode).toBe("idle");
      expect(Math.hypot(m.s.x - home.x, m.s.y - home.y)).toBeLessThan(12);
    });

    it("SimConfig.hazards: false leaves the walk on ice exact", () => {
      const world = iceWorld([{ faction: "plague", at: at(4, 8) }, { faction: "fire", at: at(40, 24) }], {}, { hazards: false });
      const p = P(world, "p0");
      const x0 = p.x;
      order(world, "p0", "move", { x: 60 * TILE, y: p.y });
      step(world, TICK_MS);
      expect(p.x - x0).toBeCloseTo(STEP_U, 9);
      expect(RT(world, "p0").slip ?? null).toBeNull();
    });
  });

  describe("facing on ice", () => {
    function slider(): { world: World; c: NonNullable<ReturnType<typeof combatant>> } {
      const world = iceWorld([{ faction: "plague", at: at(10, 10) }, { faction: "fire", at: at(40, 24) }]);
      const c = combatant(world, "p0")!;
      c.rt.path = [at(20, 4), at(30, 14)];
      c.s.facing = 3;
      return { world, c };
    }
    const toward = (c: NonNullable<ReturnType<typeof combatant>>): number => Math.atan2(c.rt.path[0]!.y - c.s.y, c.rt.path[0]!.x - c.s.x);

    it("turns toward the waypoint it steers at, tick by tick, as the plain walker turns", () => {
      const { world, c } = slider();
      let turned = 0;
      for (let i = 0; i < 60 && c.rt.path.length > 0; i++) {
        const before = c.s.facing;
        walkFighter(world, c, DT, false, 1);
        if (c.rt.path.length === 0) break;
        expect(c.s.facing, `tick ${i}`).toBeCloseTo(toward(c), 9);
        if (c.s.facing !== before) turned++;
      }
      expect(turned).toBeGreaterThan(20);
      expect(RT(world, "p0").slip).not.toBeNull(); // it slid: this was not the plain walker
    });

    it("an aiming fighter (keepFacing) does not turn, and a rooted one does not either", () => {
      const { world, c } = slider();
      walkFighter(world, c, DT, true, 1);
      expect(c.s.facing).toBe(3);
      expect(c.s.x).toBeGreaterThan(at(10, 10).x); // it moved
      const x = c.s.x;
      for (let i = 0; i < 10; i++) walkFighter(world, c, DT, false, 0);
      expect(c.s.facing).toBe(3);
      walkFighter(world, c, DT, false, 1);
      expect(c.s.facing).not.toBe(3);
      expect(c.s.facing).toBeCloseTo(toward(c), 9);
      expect(c.s.x).toBeGreaterThan(x - 1e-9);
    });

    it("keeps its facing when it has no walk, and when the waypoint is on top of it", () => {
      const { world, c } = slider();
      c.rt.path = [];
      walkFighter(world, c, DT, false, 1);
      expect(c.s.facing).toBe(3);
      c.rt.path = [{ x: c.s.x, y: c.s.y }];
      walkFighter(world, c, DT, false, 1);
      expect(Number.isFinite(c.s.facing)).toBe(true);
    });
  });

  describe("ice that touches a wall (validateTerrain T11 refuses the map; the slide still must not trap anyone)", () => {
    /** The review's T-junction: a one-tile corridor along row 5 and a one-tile corridor down column 10, ice on every floor tile. */
    const tJunction = (): GameMap => terrainMap({
      w: 24, h: 16, kind: everywhere(TERRAIN_ICE), wall: (x, y) => !(y === 5 || (x === 10 && y >= 5 && y <= 12)),
    });

    it("a move order round the corner arrives within 8 s (it livelocked for good: a path search four times a second)", () => {
      const world = makeRig({ map: tJunction(), players: [{ faction: "plague", at: at(3, 5) }, { faction: "fire", at: at(20, 5) }] });
      const p = P(world, "p0");
      const goal = at(10, 12);
      order(world, "p0", "move", goal);
      let arrivedAt = -1;
      let gripped = false;
      for (let tick = 0; tick < 400 && arrivedAt < 0; tick++) {
        step(world, TICK_MS);
        gripped ||= (RT(world, "p0").slip?.gripUntil ?? -Infinity) > world.state.serverTime;
        expect(circleClear(world.map, p, PLAYER_RADIUS - 1e-6), `tick ${tick}`).toBe(true);
        if (RT(world, "p0").path.length === 0) arrivedAt = tick;
      }
      expect(arrivedAt, "arrived").toBeGreaterThanOrEqual(0);
      expect(arrivedAt * TICK_MS).toBeLessThan(8000);
      expect(Math.hypot(p.x - goal.x, p.y - goal.y)).toBeLessThan(1e-6);
      expect(gripped, "the breaker is what did it").toBe(true);
      expect(RT(world, "p0").slip!.gripUntil! - world.state.serverTime).toBeLessThanOrEqual(SLIP_GRIP_MS);
    });

    it("a sword lock on a dummy at the end of the side corridor lands hits (it landed none in 60 s)", () => {
      const world = makeRig({
        map: tJunction(), signatures: false,
        players: [{ faction: "fire", weapon: "sword", at: at(3, 5) }, { faction: "plague", at: at(20, 5) }],
      });
      const dummy = addMob(world, { kind: "dummy", name: "Dummy", at: at(10, 12) });
      order(world, "p0", "target", { id: dummy });
      const events = run(world, 400);
      const hits = fxOf(events, "hit").filter((h) => h.id === dummy && h.by === "p0" && h.weapon === "sword");
      expect(hits.length).toBeGreaterThan(3);
    });
  });

  describe("resets", () => {
    const slide = () => ({ vx: 50, vy: 0, ax: 0, ay: 0, path: null, replanAt: 0 });

    it("a teleport clears every fighter's slide", () => {
      const world = iceWorld([{ faction: "plague" }, { faction: "fire", at: at(40, 24) }]);
      const m = combatant(world, placeMob(world, { region: "plague", elite: false, at: at(30, 10) }))!;
      RT(world, "p0").slip = slide();
      RT(world, "p1").slip = slide();
      m.rt.slip = slide();
      world.hooks.teleported?.(world);
      expect([RT(world, "p0").slip, RT(world, "p1").slip, m.rt.slip]).toEqual([null, null, null]);
    });

    it("going down, a mob's death, resetMob and the start of a run clear it", () => {
      const world = iceWorld([{ faction: "plague" }, { faction: "fire", at: at(40, 24) }, { faction: "holy", at: at(40, 20) }]);
      RT(world, "p0").slip = slide();
      downPlayer(world, P(world, "p0"), RT(world, "p0"), "died");
      expect(RT(world, "p0").slip).toBeNull();

      const id = placeMob(world, { region: "plague", elite: false, at: at(30, 10) });
      const m = combatant(world, id) as MobCombatant;
      m.rt.slip = slide();
      resetMob(world, m);
      expect(m.rt.slip).toBeNull();
      m.rt.slip = slide();
      m.rt.history = [{ t: 0, x: m.s.x, y: m.s.y }];
      hurtMob(world, m, [m.s.hp + 1], [{
        victim: id, by: { id: "p1", name: "player1" }, packet: { raw: 1, phys: 1, magic: 0, true: 0 }, weapon: "sword", scale: 1, stagger: false,
      }]);
      expect(m.s.status).toBe("dead");
      expect(m.rt.slip).toBeNull();

      const lobby = createGameWorld({ seed: 7, config: { ...BASE, minPlayers: 2, lobbySeconds: 1e6 }, random: mulberry32(3), map: terrainMap() });
      addPlayer(lobby, "a", "a");
      lobby.players.get("a")!.slip = slide();
      startRaid(lobby);
      expect(lobby.players.get("a")!.slip).toBeNull();
    });

    it("the training revive clears it", () => {
      const world = iceWorld([{ faction: "plague" }], {}, { training: true });
      RT(world, "p0").slip = slide();
      downPlayer(world, P(world, "p0"), RT(world, "p0"), "died");
      run(world, 1);
      expect(P(world, "p0").status).toBe("alive");
      expect(RT(world, "p0").slip ?? null).toBeNull();
    });

    it("a training death at full slide speed revives at rest: it slides nowhere (the old samples are gone)", () => {
      const world = iceWorld([{ faction: "plague", at: at(4, 8) }], {}, { training: true });
      const p = P(world, "p0");
      order(world, "p0", "move", { x: 60 * TILE, y: p.y });
      run(world, 12);
      expect(RT(world, "p0").slip!.vx).toBeCloseTo(PLAYER_SPEED, 9);
      expect(tickVelocity(RT(world, "p0").history).x).toBeCloseTo(PLAYER_SPEED, 9);
      downPlayer(world, p, RT(world, "p0"), "died");
      run(world, 1);
      expect(p.status).toBe("alive");
      expect(RT(world, "p0").history).toHaveLength(1);
      expect(tickVelocity(RT(world, "p0").history)).toEqual({ x: 0, y: 0 });
      const x = p.x;
      const y = p.y;
      run(world, 20);
      expect([p.x, p.y]).toEqual([x, y]);
    });

    it("a blink from ice onto ice carries no slide: the fighter lands at rest", () => {
      const world = iceWorld([{ faction: "plague", at: at(4, 8) }, { faction: "fire", at: at(40, 24) }]);
      const p = P(world, "p0");
      order(world, "p0", "move", { x: 60 * TILE, y: p.y });
      run(world, 10);
      expect(RT(world, "p0").slip!.vx).toBeCloseTo(PLAYER_SPEED, 9);
      order(world, "p0", "stop", {});
      run(world, 1); // braking: the slide is still carrying about 150 u/s
      expect(RT(world, "p0").slip!.vx).toBeGreaterThan(100);
      const landing = at(5, 20);
      displace(world, combatant(world, "p0")!, landing);
      expect(RT(world, "p0").slip ?? null).toBeNull();
      run(world, 30);
      expect(Math.hypot(p.x - landing.x, p.y - landing.y)).toBeLessThan(1);
    });
  });

  describe("fuzz: no body ever overlaps a solid tile or stands on LOW", () => {
    it.each([2024, 7, 99])("60 s of random orders (players) and chases and orders (mobs) on ice that meets plain floor, with pillars and a fence (seed %i)", (seed) => {
      const map = terrainMap({
        w: 60, h: 30,
        kind: (tx) => (tx < 36 ? TERRAIN_ICE : 0),
        wall: (tx, ty) => (tx % 8 === 3 || tx % 8 === 4) && (ty % 8 === 3 || ty % 8 === 4),
        fence: (tx, ty) => tx === 20 && ty >= 5 && ty <= 22,
      });
      const world = makeRig({
        map, signatures: false,
        players: [
          { faction: "plague", weapon: "sword", at: at(6, 8), hp: 1e9 }, { faction: "fire", weapon: "bow", at: at(30, 20), hp: 1e9 },
          { faction: "sentenced", weapon: "axe", at: at(44, 8), hp: 1e9 }, { faction: "frost", weapon: "wand", at: at(10, 24), hp: 1e9 },
        ],
      });
      const mobs = [
        combatant(world, placeMob(world, { region: "plague", elite: false, at: at(14, 10) })) as MobCombatant,
        combatant(world, placeMob(world, { region: "fire", elite: false, at: at(40, 12) })) as MobCombatant,
        combatant(world, placeMob(world, { region: "sentenced", elite: true, at: at(28, 22) })) as MobCombatant,
      ];
      const rnd = mulberry32(seed);
      const randomPoint = (): Vec2 => ({ x: (1 + rnd() * 58) * TILE, y: (1 + rnd() * 28) * TILE });
      let slid = 0;
      let checks = 0;
      for (let tick = 0; tick < 1200; tick++) {
        for (let i = 0; i < 4; i++) {
          if (rnd() < 0.08) {
            if (rnd() < 0.2) order(world, `p${i}`, "stop", {});
            else order(world, `p${i}`, "move", randomPoint());
          }
        }
        if (tick % 40 === 0) {
          // The mobs are woken onto a player now and then, and sent to random points between fights.
          aggro(world, mobs[tick % 3]!, `p${(tick / 40) % 4}`, 1);
        }
        for (const m of mobs) if (rnd() < 0.05 && m.s.status === "alive") m.rt.inputs.pushMove({ kind: "move", ...randomPoint() });
        step(world, TICK_MS);
        for (const c of [...world.players.keys(), ...world.mobs.keys()].map((id) => combatant(world, id)!)) {
          if (c.s.status !== "alive") continue;
          checks++;
          if (c.rt.slip) slid++;
          expect(circleClear(world.map, c.s, PLAYER_RADIUS - 1e-6), `${c.id} overlaps a solid tile at tick ${tick} (${c.s.x}, ${c.s.y})`).toBe(true);
          const i = worldToTile(c.s.y) * world.map.w + worldToTile(c.s.x);
          expect(world.map.tiles[i], `${c.id} stands on a LOW tile at tick ${tick}`).not.toBe(TILE_LOW);
        }
      }
      // The run actually slid: it is not a vacuous pass.
      expect(slid).toBeGreaterThan(checks / 20);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Light
// ---------------------------------------------------------------------------------------------------------------------

describe("light heal", () => {
  const lightWorld = (players: PlayerSpec[], config?: Partial<SimConfig>): World =>
    makeRig({ map: terrainMap({ kind: everywhere(TERRAIN_LIGHT) }), players, config });

  it("heals 0.6% of max hp per second out of combat, and Holy twice that", () => {
    const world = lightWorld([{ faction: "sentenced", at: at(8, 8) }, { faction: "holy", at: at(20, 12) }, { faction: "plague", at: at(30, 20) }]);
    for (const id of ["p0", "p1"]) P(world, id).hp = P(world, id).maxHp / 2;
    const h0 = P(world, "p0").hp;
    const h1 = P(world, "p1").hp;
    run(world, 20);
    expect(P(world, "p0").hp - h0).toBeCloseTo(0.006 * P(world, "p0").maxHp, 6);
    expect(P(world, "p1").hp - h1).toBeCloseTo(0.012 * P(world, "p1").maxHp, 6);
    expect(P(world, "p2").hp).toBe(P(world, "p2").maxHp);
    expect(world.hazards.stats.heal.get("p0")).toBeCloseTo(0.006 * P(world, "p0").maxHp, 6);
  });

  it("a player who dealt or took damage within 3 s gains nothing until the lockout ends", () => {
    const world = lightWorld([{ faction: "sentenced", at: at(8, 8) }, { faction: "plague", at: at(30, 20) }]);
    P(world, "p0").hp = P(world, "p0").maxHp / 2;
    const hurt = P(world, "p0").hp;
    run(world, 1); // the faction layer keeps a record per fighter once the run is ticking
    P(world, "p0").hp = hurt;
    // Hit 1 s ago.
    world.factions!.fighters.get("p0")!.combatAt = world.state.serverTime - 1000;
    run(world, 39); // up to 1.95 s after the hit... the lockout ends 3 s after it, 40 ticks from now
    expect(P(world, "p0").hp).toBe(hurt);
    run(world, 2);
    expect(P(world, "p0").hp).toBeGreaterThan(hurt);
    expect(P(world, "p0").hp - hurt).toBeLessThan(0.006 * P(world, "p0").maxHp);
  });

  it("sends exactly one heal fx per player per second, with that second's gain as the amount", () => {
    const world = lightWorld([{ faction: "sentenced", at: at(8, 8) }, { faction: "holy", at: at(20, 12) }, { faction: "plague", at: at(30, 20) }]);
    for (const id of ["p0", "p1"]) P(world, id).hp = P(world, id).maxHp / 2;
    const events = run(world, 100);
    const heals = fxOf(events, "heal");
    for (const [id, share] of [["p0", 0.006], ["p1", 0.012]] as const) {
      const mine = heals.filter((h) => h.id === id);
      expect(mine, id).toHaveLength(5);
      for (const h of mine) expect(Math.abs(h.amount - share * P(world, id).maxHp)).toBeLessThan(0.1);
    }
    expect(heals.filter((h) => h.id === "p2")).toEqual([]);
    // Spaced LIGHT_FX_MS apart: five in 100 ticks.
    expect(LIGHT_FX_MS).toBe(1000);
  });

  it("sends no fx at full hp, none for a mob, and a mob in a shaft gains nothing", () => {
    const world = lightWorld([{ faction: "sentenced", at: at(8, 8) }, { faction: "fire", at: at(30, 20) }]);
    const m = combatant(world, placeMob(world, { region: "plague", elite: false, at: at(20, 12) })) as MobCombatant;
    m.s.hp = m.s.maxHp / 2;
    const hp = m.s.hp;
    let events: SimEvent[] = [];
    for (let i = 0; i < 60; i++) {
      m.rt.lastHitAt = world.state.serverTime; // keeps the mob's own idle regeneration quiet
      events = events.concat(step(world, TICK_MS));
    }
    expect(fxOf(events, "heal")).toEqual([]);
    expect(m.s.hp).toBe(hp);
    expect(P(world, "p0").hp).toBe(P(world, "p0").maxHp);
  });

  it("a player who walks off the light before the report still gets it: exactly one fx, for the time it stood in it", () => {
    const world = makeRig({
      map: terrainMap({ kind: (tx) => (tx < 10 ? TERRAIN_LIGHT : 0) }),
      players: [{ faction: "holy", at: at(8, 8) }, { faction: "fire", at: at(30, 20) }],
    });
    const p = P(world, "p0");
    p.hp = p.maxHp / 2;
    const hp0 = p.hp;
    order(world, "p0", "move", { x: 20 * TILE, y: p.y }); // the light ends at x = 320; the walk leaves it in about 0.3 s
    const events = run(world, 40);
    expect(p.x).toBeGreaterThan(10 * TILE);
    const heals = fxOf(events, "heal").filter((h) => h.id === "p0");
    expect(heals).toHaveLength(1);
    const gained = p.hp - hp0;
    expect(gained).toBeGreaterThan(0.5);
    expect(gained).toBeLessThan(0.012 * p.maxHp * 0.5); // well short of a second in the light
    expect(heals[0]!.amount).toBeCloseTo(gained, 6);
  });

  describe("the 3 s lockout does not depend on the faction layer (m2)", () => {
    function fight(): { world: World; hit: { on: boolean } } {
      const world = makeRig({
        map: terrainMap({ kind: everywhere(TERRAIN_LIGHT) }),
        players: [{ faction: "sentenced", at: at(8, 8) }, { faction: "plague", at: at(30, 20) }],
        signatures: false,
      });
      expect(world.factions).toBeNull(); // heal()'s own lockout reads the faction layer's clock: there is none here
      for (const id of ["p0", "p1"]) P(world, id).hp = P(world, id).maxHp / 2;
      const hit = { on: true };
      world.beforeDamage.push((w) => {
        if (hit.on) recordHit(w, { victim: "p0", by: { id: "p1", name: "player1" }, packet: { raw: 1, phys: 0, magic: 0, true: 1 }, weapon: "sword", stagger: false });
      });
      return { world, hit };
    }

    it("the one hit every tick and the one dealing them gain nothing; both heal 3 s after the last hit", () => {
      const { world, hit } = fight();
      const hp0 = P(world, "p0").hp;
      const hp1 = P(world, "p1").hp;
      run(world, 40);
      expect(P(world, "p0").hp).toBe(hp0 - 40);
      expect(P(world, "p1").hp).toBe(hp1);
      expect(world.hazards.stats.heal.size).toBe(0);
      hit.on = false;
      run(world, 58); // 2.9 s after the last hit
      expect(P(world, "p0").hp).toBe(hp0 - 40);
      expect(P(world, "p1").hp).toBe(hp1);
      run(world, 3);
      expect(P(world, "p0").hp).toBeGreaterThan(hp0 - 40);
      expect(P(world, "p1").hp).toBeGreaterThan(hp1);
    });

    it("the run's start clears the clock", () => {
      const { world } = fight();
      run(world, 2);
      expect(world.terrain!.combatAt.size).toBe(2);
      world.hooks.raidStarted?.(world);
      expect(world.terrain!.combatAt.size).toBe(0);
    });
  });

  it("SimConfig.hazards: false switches it off, and 'all' takes Holy's boost away", () => {
    const off = lightWorld([{ faction: "holy" }, { faction: "fire", at: at(30, 20) }], { hazards: false });
    P(off, "p0").hp = 100;
    run(off, 20);
    expect(P(off, "p0").hp).toBe(100);
    const all = lightWorld([{ faction: "holy" }, { faction: "fire", at: at(30, 20) }], { hazards: "all" });
    P(all, "p0").hp = 100;
    run(all, 20);
    expect(P(all, "p0").hp - 100).toBeCloseTo(0.006 * P(all, "p0").maxHp, 6);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The adapter and the flag off
// ---------------------------------------------------------------------------------------------------------------------

describe("the adapter", () => {
  it("names its sources, and registers exactly one entry per seam", () => {
    expect(TERRAIN_SOURCE.ember).toEqual({ id: "terrain:ember", name: "Lava" });
    expect(TERRAIN_SOURCE.bog.id.startsWith("terrain:")).toBe(true);
    const world = createGameWorld({ seed: 1, config: BASE, random: mulberry32(1), map: terrainMap() });
    expect(world.terrain).not.toBeNull();
    expect(world.moveModifiers.filter((m) => m === applyBog)).toHaveLength(1);
    expect(world.beforeDamage.filter((f) => f.name === "burnPass")).toHaveLength(1);
    expect(world.systems.filter((f) => f.name === "lightPass")).toHaveLength(1);
    for (const hook of ["teleported", "raidStarted", "arenaHurt"] as const) expect(world.hooks[hook], hook).toBeTypeOf("function");
    // The burn is a beforeDamage entry that comes after the signatures', and light a system that comes after the faction layer's.
    const names = (list: Array<(w: World, dt: number) => void>): string[] => list.map((f) => f.name);
    expect(names(world.beforeDamage).indexOf("signatureDamage")).toBeLessThan(names(world.beforeDamage).indexOf("burnPass"));
    expect(names(world.systems).indexOf("afterDamage")).toBeLessThan(names(world.systems).indexOf("lightPass"));
  });

  it("a runtime without a slip field walks like any other: nothing creates one off ice, a slide is made on ice", () => {
    const plain = makeRig({ map: terrainMap({ w: 64 }), players: [{ faction: "plague", at: at(4, 8) }, { faction: "fire", at: at(40, 24) }] });
    const rt = RT(plain, "p0");
    delete rt.slip;
    expect("slip" in rt).toBe(false);
    const x0 = P(plain, "p0").x;
    order(plain, "p0", "move", { x: 60 * TILE, y: P(plain, "p0").y });
    run(plain, 5);
    expect(P(plain, "p0").x - x0).toBeCloseTo(5 * STEP_U, 9);
    expect("slip" in rt).toBe(false);

    const icy = makeRig({ map: terrainMap({ w: 64, kind: everywhere(TERRAIN_ICE) }), players: [{ faction: "plague", at: at(4, 8) }, { faction: "fire", at: at(40, 24) }] });
    const rtIce = RT(icy, "p0");
    delete rtIce.slip;
    order(icy, "p0", "move", { x: 60 * TILE, y: P(icy, "p0").y });
    run(icy, 2);
    expect(rtIce.slip).toBeTruthy();
    expect(rtIce.slip!.vx).toBeCloseTo(2 * 21.25, 9);
  });
});

describe("with the flag off, generated maps behave as before", () => {
  /** A few scripted players on a generated map with its mobs: random orders, locks and attacks, for `seconds`. */
  function simulate(seed: number, hazards: boolean | undefined, seconds: number): { world: World; events: SimEvent[]; terrainEntries: number } {
    const world = createGameWorld({
      seed,
      config: { ...BASE, minPlayers: 4, mobs: true, ...(hazards === undefined ? {} : { hazards }) },
      random: mulberry32(seed + 1),
    });
    for (let i = 0; i < 4; i++) addPlayer(world, `p${i}`, `player${i}`);
    let terrainEntries = 0;
    world.beforeDamage.push((w) => {
      for (const e of w.combat.ledger) if (e.by.id.startsWith("terrain:")) terrainEntries++;
    });
    const rnd = mulberry32(seed * 31 + 5);
    const events: SimEvent[] = [];
    events.push(...step(world, TICK_MS));
    for (let i = 0; i < 4; i++) {
      const p = world.state.players.get(`p${i}`)!;
      p.hp = p.maxHp = 1e6;
    }
    for (let tick = 0; tick < seconds * 20; tick++) {
      for (let i = 0; i < 4; i++) {
        const rt = world.players.get(`p${i}`)!;
        const p = world.state.players.get(`p${i}`)!;
        if (p.status !== "alive" || rnd() > 0.08) continue;
        const r = rnd();
        if (r < 0.5) {
          const to = { x: p.x + (rnd() - 0.5) * 600, y: p.y + (rnd() - 0.5) * 600 };
          enqueueClientMessage(rt.inputs, "move", to);
        } else {
          // Lock the nearest other fighter in sight range.
          let best: string | null = null;
          let bestD = 500;
          for (const [id, m] of [...world.state.mobs, ...world.state.players]) {
            if (id === `p${i}` || m.status !== "alive") continue;
            const d = Math.hypot(m.x - p.x, m.y - p.y);
            if (d < bestD) { best = id; bestD = d; }
          }
          if (best) enqueueClientMessage(rt.inputs, "target", { id: best });
        }
      }
      events.push(...step(world, TICK_MS));
    }
    return { world, events, terrainEntries };
  }

  it("seeds 1..20: 30 s of play records no terrain ledger entry and emits exactly what the hazards-off run emits", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const on = simulate(seed, undefined, 30);
      const off = simulate(seed, false, 30);
      expect(on.terrainEntries, `seed ${seed}`).toBe(0);
      expect(on.events, `seed ${seed}`).toEqual(off.events);
      for (const [id, p] of on.world.state.players) {
        const q = off.world.state.players.get(id)!;
        expect([p.x, p.y, p.hp, p.facing, p.kills]).toEqual([q.x, q.y, q.hp, q.facing, q.kills]);
        expect(on.world.players.get(id)!.slip ?? null).toBeNull();
      }
    }
  }, 120_000);

  it("the generated maps hold no terrain, so every pass returns on its first line", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const world = createGameWorld({ seed, config: BASE, random: mulberry32(seed) });
      expect(world.map.terrain.every((k) => k === 0)).toBe(true);
    }
  });
});

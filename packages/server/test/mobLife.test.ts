// A regional mob's life (sim/mobLife.ts): camp spawning, damage taken, death and its rewards, corpses, regeneration and
// the teleport reset. The AI (mobAI.ts) is another module's job: it is replaced here by spies, so nothing below says
// anything about how a mob fights, only about what happens to it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  elitesOf, FACTION_IDS, GV_ELITE, GV_MOB, GV_MOB_CAP, INTERACT_RANGE, mapFromTiles, mobStatCount, mobStatReward, mobStatRows,
  MOB_CORPSE_MS, MOB_REGEN_SECONDS, MOB_REPATH_MS, MOB_TYPES, mobFaction, mobRewardMultiplier, mobTypeById, mobTypeFaction, mobTypeWeapon,
  mobWeapon, mitigateShares, mulberry32, normalTypesOf, pacedFaction, REGION_WEAPONS, rewardCurve, SWAP_SECONDS, TICK_MS, TILE, WEAPONS,
  type FactionId, type FxEvent, type MobTypeId, type Vec2,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import * as arenaModule from "../src/sim/arena";
import { teleportToColiseum } from "../src/sim/arena";
import { grantCard } from "../src/sim/chests";
import { combatant, defenseOf, factionOf } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { aggro, resetMob } from "../src/sim/mobAI";
import {
  hurtMob, install, killMob, mobRoleMove, placeMob, reapMobs, respawnCamps, spawnRegionalMobs, type MobCombatant,
} from "../src/sim/mobLife";
import { grantMobStat } from "../src/sim/mobStats";
import { CAMP_CLEARED } from "../src/sim/camps";
import { addMob } from "../src/sim/mobs";
import { addPlayer, step } from "../src/sim/step";
import { mobRewardFor } from "../src/sim/feed";
import { createWorld, tieRank, type LedgerEntry, type SimConfig, type SimEvent, type World } from "../src/sim/world";

vi.mock("../src/sim/mobAI", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/sim/mobAI")>()),
  aggro: vi.fn(),
  resetMob: vi.fn(),
  install: () => {},
}));

// creditMobKill is spied (it still runs) so a test can read the reward multiplier a kill was paid at (its 5th argument): the value read inside the pass.
const credit = vi.spyOn(arenaModule, "creditMobKill");

beforeEach(() => {
  credit.mockClear();
  vi.mocked(aggro).mockClear();
  vi.mocked(resetMob).mockClear();
});

const NAMES = ["alice", "bob", "carol", "dave"];
const SEEDS = [1, 2, 3, 100, 732];

interface WorldOpts { seed?: number; players?: number; mobs?: boolean; random?: () => number }

/** A game world in the lobby: `players` seats (p0 alice, p1 bob, ...), mobs on or off. */
function makeLobby(o: WorldOpts = {}): World {
  const seed = o.seed ?? 1234;
  const players = o.players ?? 2;
  const config: SimConfig = {
    minPlayers: players, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 60,
    mobs: o.mobs ?? true, pvpRules: false,
  };
  let uid = 0;
  const world = createGameWorld({ seed, config, random: o.random ?? mulberry32(seed + 1), newItemUid: () => `L${++uid}` });
  for (let i = 0; i < players; i++) addPlayer(world, `p${i}`, NAMES[i]!);
  return world;
}

/** The run started on the first step (serverTime TICK_MS). */
function makeRun(o: WorldOpts = {}): World {
  const world = makeLobby(o);
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  return world;
}

/** A run with no camp mobs, for tests that place their own. */
const makeBare = (o: WorldOpts = {}): World => makeRun({ ...o, mobs: false });

const P = (w: World, i: number): PlayerState => w.state.players.get(`p${i}`)!;
const RT = (w: World, i: number) => w.players.get(`p${i}`)!;
const mobOf = (w: World, id: string): MobCombatant => combatant(w, id) as MobCombatant;
const allMobs = (w: World): MobCombatant[] => [...w.state.mobs.keys()].map((id) => mobOf(w, id));

function spawn(w: World, region: FactionId = "fire", elite = false, at: Vec2 = { x: 200, y: 200 }, type?: MobTypeId): MobCombatant {
  return mobOf(w, placeMob(w, { region, elite, at, facing: 0, ...(type !== undefined ? { type } : {}) }));
}

/** The type a mob placed without one pays in: its zone's first normal type, or its elite type (mobLife.ts mobTypeOf). */
const defaultType = (region: FactionId, elite: boolean): MobTypeId => (elite ? elitesOf(region)[0]! : normalTypesOf(region)[0]!).id;

/** The cards a player holds, as a plain record of counts by id: a mob kill gives none (the per-kill buffs are gone). */
const held = (p: PlayerState): Record<string, number> => Object.fromEntries(p.build);
/** The reward multipliers the mob kills so far were paid at, in order (what each kill read inside its ledger pass). */
const paidAt = (): number[] => credit.mock.calls.map((c) => c[4] as number);

const entry = (victim: string, by: string, raw: number): LedgerEntry => ({
  victim, by: { id: by, name: by }, packet: { raw, phys: 1, magic: 0, true: 0 }, weapon: "sword", scale: 1, stagger: false,
});

/** hurtMob with already-mitigated `[attacker id, amount]` hits. */
function hurt(w: World, m: MobCombatant, ...hits: Array<[string, number]>): number {
  return hurtMob(w, m, hits.map((h) => h[1]), hits.map((h) => entry(m.id, h[0], h[1])));
}

/** A hit recorded in the ledger (it lands in the next pass), from `by` with `raw` damage on a victim without mitigation. */
function strike(w: World, victim: string, by: string, raw: number, stagger = false): void {
  recordHit(w, { victim, by: { id: by, name: by }, packet: { raw, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger });
}

/** applyLedger as the step loop runs it: `stepping`, so a death waits for settle() instead of resolving at once. */
function pass(w: World): void {
  w.stepping = true;
  try {
    applyLedger(w);
  } finally {
    w.stepping = false;
  }
}

const kindsOf = (events: SimEvent[]): string[] => events.map((e) => (e.type === "fx" ? `fx:${e.fx.kind}` : e.type));

function fxOf<K extends FxEvent["kind"]>(events: SimEvent[], kind: K): Array<Extract<FxEvent, { kind: K }>> {
  return events.flatMap((e) => (e.type === "fx" && e.fx.kind === kind ? [e.fx as Extract<FxEvent, { kind: K }>] : []));
}

const gvOf = (events: SimEvent[]) => events.flatMap((e) => (e.type === "gv" ? [e] : []));

const aggroCalls = (w: World, m: MobCombatant): Array<[string, number]> =>
  vi.mocked(aggro).mock.calls.map(([world, c, id, amount]) => {
    expect(world).toBe(w);
    expect(c.s).toBe(m.s); // the ledger builds its own Combatant wrapper, so compare what it wraps
    expect(c.rt).toBe(m.rt);
    return [id, amount];
  });

/** Sets a player's feed to kills + 0.25 x mobKills (the two are what feed is made of). */
function setFeed(w: World, i: number, kills: number, mobKills = 0): void {
  P(w, i).kills = kills;
  RT(w, i).mobKills = mobKills;
  P(w, i).mobKills = mobKills;
}

describe("a mob type's weapon and role (shared mobs.ts MOB_TYPES)", () => {
  const OTHER: Record<string, string> = { sword: "bow", bow: "sword", wand: "axe", axe: "wand", shield: "sword" };

  it("places every one of the 30 types with its own weapon, its role's hp and the type's name, in its zone", () => {
    const w = makeBare();
    for (const t of MOB_TYPES) {
      const m = spawn(w, t.zone, t.elite, { x: 200, y: 200 }, t.id);
      expect(m.s.weapon0, t.id).toBe(t.weapon);
      expect(m.s.name, t.id).toBe(t.name);
      expect(m.s.type, t.id).toBe(t.id);
      expect(m.s.faction, t.id).toBe(t.zone);
      expect(m.s.maxHp, t.id).toBeCloseTo(mobFaction(t.zone, t.elite).hp * t.hpMult, 3);
      expect(m.s.hp, t.id).toBe(m.s.maxHp);
    }
  });

  it("fights as the faction scaled by its role: the hit and every damage number times dmgMult (paced), the rest of the sheet untouched", () => {
    const w = makeBare();
    for (const t of MOB_TYPES) {
      const spec = factionOf(spawn(w, t.zone, t.elite, { x: 200, y: 200 }, t.id).s)!;
      const grunt = factionOf(spawn(w, t.zone, t.elite, { x: 220, y: 200 }).s)!;
      expect(spec.hit, t.id).toBeCloseTo(grunt.hit * t.dmgMult, 9);
      for (const key of Object.keys(grunt.params)) {
        const damage = ["burn", "backlash", "plague", "execute", "mark_pct", "mark_kill"].includes(key);
        expect(spec.params[key], `${t.id} ${key}`).toBeCloseTo(damage ? grunt.params[key]! * t.dmgMult : grunt.params[key]!, 9);
      }
      expect([spec.armor, spec.shield, spec.rate], t.id).toEqual([grunt.armor, grunt.shield, grunt.rate]);
      expect(spec.hp, t.id).toBeCloseTo(grunt.hp * t.hpMult, 9);
    }
  });

  it("falls back to the plain zone faction for a mob with no type or a type of another zone", () => {
    const w = makeBare();
    const plain = factionOf(spawn(w, "frost", false, { x: 200, y: 200 }).s)!;
    const foreign = spawn(w, "frost", false, { x: 220, y: 200 }, "emberImp");
    expect(factionOf(foreign.s)).toBe(plain);
    expect(foreign.s.weapon0).toBe(mobWeapon("frost"));
    expect(foreign.s.maxHp).toBeCloseTo(mobFaction("frost", false).hp, 3);
    expect(mobRoleMove(w, foreign)).toBe(1);
    expect(mobRoleMove(w, spawn(w, "frost", false, { x: 240, y: 200 }))).toBe(1);
  });

  it("walks at the role's speed: a modifier of the step loop that is 1 for players, dummies and untyped mobs", () => {
    const w = makeBare();
    expect(w.moveModifiers).toContain(mobRoleMove);
    for (const t of MOB_TYPES) expect(mobRoleMove(w, spawn(w, t.zone, t.elite, { x: 200, y: 200 }, t.id)), t.id).toBe(t.moveMult);
    expect(mobRoleMove(w, combatant(w, "p0")!)).toBe(1);
    const dummy = combatant(w, addMob(w, { kind: "dummy", name: "Dummy", at: { x: 300, y: 300 } }))!;
    expect(mobRoleMove(w, dummy)).toBe(1);
    expect(mobRoleMove(w, spawn(w, "fire", false, { x: 260, y: 200 }, "cinderHound"))).toBeGreaterThan(1);
    expect(mobRoleMove(w, spawn(w, "fire", false, { x: 280, y: 200 }, "magmaBrute"))).toBeLessThan(1);
  });

  it("drops the TYPE's weapon as a loose weapon at its feet when the killer holds neither slot's type (all 30 types)", () => {
    for (const t of MOB_TYPES) {
      const w = makeBare();
      P(w, 0).weapon0 = OTHER[t.weapon]!;
      P(w, 0).weapon1 = "";
      const m = spawn(w, t.zone, t.elite, { x: P(w, 0).x + 8, y: P(w, 0).y }, t.id);
      const before = new Set(w.state.containers.keys());
      hurt(w, m, ["p0", m.s.hp]);
      const created = [...w.state.containers.keys()].filter((id) => !before.has(id));
      const boxes = created.map((id) => w.state.containers.get(id)!);
      const ground = boxes.filter((box) => box.kind === "ground");
      expect(ground, t.id).toHaveLength(1);
      expect(ground[0]!.items.map((it) => it.def), t.id).toEqual([t.weapon]);
      expect(boxes.filter((box) => box.kind === "reward"), t.id).toHaveLength(t.elite ? 1 : 0);
    }
  });

  it("arms an empty-handed killer with the type's weapon, not the zone's (a Flame Caller arms a wand in the axe zone)", () => {
    for (const id of ["flameCaller", "pardoner", "gaoler", "poxBehemoth", "frostbowSentry", "zealot", "archon"] as const) {
      const t = mobTypeById(id)!;
      expect(t.weapon, id).not.toBe(mobWeapon(t.zone));
      const w = makeBare();
      const m = spawn(w, t.zone, t.elite, { x: P(w, 0).x + 8, y: P(w, 0).y }, t.id);
      hurt(w, m, ["p0", m.s.hp]);
      expect([P(w, 0).weapon0, P(w, 0).weapon1], id).toEqual([t.weapon, ""]);
      expect(w.events.filter((e) => e.type === "toast" && e.text.startsWith("Armed:")), id).toEqual([{ type: "toast", to: "p0", text: `Armed: ${WEAPONS[t.weapon].name}` }]);
    }
  });

  it("a mob that dies with no credited killer still drops its type's weapon where it fell", () => {
    const w = makeBare();
    const m = spawn(w, "fire", false, { x: 400, y: 400 }, "flameCaller");
    const before = w.state.containers.size;
    killMob(w, m, [], []);
    for (const pay of w.combat.payouts) pay();
    const box = [...w.state.containers.values()].at(-1)!;
    expect(w.state.containers.size).toBe(before + 1);
    expect(box.items.map((it) => it.def)).toEqual(["wand"]);
  });
});

describe("spawnRegionalMobs", () => {
  it.each(SEEDS)("seed %i: one mob per camp spot, in map order, with the type's weapon, faction, name and role hp", (seed) => {
    const w = makeRun({ seed });
    const expected = w.map.regions.flatMap((r) => r.mobCamps.flatMap((camp) =>
      camp.spots.map((spot, i) => ({ camp, spot, elite: camp.elite && i === 0 }))));
    expect(expected.length).toBeGreaterThan(0);
    expect(w.state.mobs.size).toBe(expected.length);
    expect([...w.mobs.keys()]).toEqual([...w.state.mobs.keys()]);

    const mobs = allMobs(w);
    expected.forEach(({ camp, spot, elite }, i) => {
      const { s, rt } = mobs[i]!;
      const hp = mobTypeFaction(camp.region, elite, s.type).hp;
      expect(s.kind).toBe(elite ? "elite" : "mob");
      // A roster mob is named by its MOB_TYPES row (sim/camps.ts), a type of its own zone, elite only at the elite spot.
      expect(s.name).toBe(mobTypeById(s.type)!.name);
      expect(mobTypeById(s.type)!.zone).toBe(camp.region);
      expect(mobTypeById(s.type)!.elite).toBe(elite);
      expect(s.faction).toBe(camp.region);
      // Each mob carries its TYPE's weapon (shared mobs.ts): the zone's default weapon is only for a mob placed without a type.
      expect(s.weapon0).toBe(mobTypeById(s.type)!.weapon);
      expect(mobTypeWeapon(camp.region, s.type)).toBe(mobTypeById(s.type)!.weapon);
      expect({ x: s.x, y: s.y }).toEqual(spot);
      expect(s.hp).toBe(hp);
      expect(s.maxHp).toBe(hp);
      expect(s.status).toBe("alive");
      expect(s.facing).toBeCloseTo(Math.atan2(camp.y - spot.y, camp.x - spot.x), 12);
      const brain = rt.brain!;
      expect(brain).toMatchObject({ region: camp.region, elite, mode: "idle", target: null, diedAt: 0, homeFacing: s.facing });
      expect(brain.home).toEqual(spot);
      expect(brain.threat.size).toBe(0);
      expect(Number.isInteger(brain.phase) && brain.phase >= 0 && brain.phase < MOB_REPATH_MS).toBe(true);
    });
    expect(new Set(mobs.map((m) => m.rt.brain!.phase)).size).toBeGreaterThan(1); // staggered, not all on one tick
  });

  it.each(SEEDS)("seed %i: one elite per elite camp, at the camp's elite spot, of the type the camp publishes; its camp-mates are normal mobs", (seed) => {
    const w = makeRun({ seed });
    for (const region of w.map.regions) {
      const mine = allMobs(w).filter((m) => m.rt.brain!.region === region.id);
      const elites = mine.filter((m) => m.s.kind === "elite");
      const eliteCamps = w.map.camps.flatMap((c, ci) => (c.zone === region.id && c.eliteSpot >= 0 ? [ci] : []));
      expect(eliteCamps.length, region.id).toBeGreaterThan(0);
      expect(elites, region.id).toHaveLength(eliteCamps.length);
      eliteCamps.forEach((ci, k) => {
        const camp = w.map.camps[ci]!;
        const e = elites.find((m) => m.s.camp === ci + 1)!;
        expect({ x: e.s.x, y: e.s.y }).toEqual(camp.spots[camp.eliteSpot]);
        expect(e.s.type).toBe(w.state.camps[ci]!.elite);
        expect(e.s.type).toBe(elitesOf(region.id)[k % 2]!.id);
        expect(e.s.hp).toBe(mobTypeFaction(region.id, true, e.s.type).hp);
        const normalHp = mobFaction(region.id, false).hp * mobTypeById(w.state.camps[ci]!.type)!.hpMult;
        camp.spots.forEach((spot, i) => {
          if (i === camp.eliteSpot) return;
          const mate = mine.find((m) => m.s.x === spot.x && m.s.y === spot.y)!;
          expect(mate.s.kind).toBe("mob");
          expect(mate.s.type).toBe(w.state.camps[ci]!.type);
          expect(mate.s.maxHp).toBeCloseTo(normalHp, 3);
        });
      });
    }
    expect(FACTION_IDS.every((f) => allMobs(w).some((m) => m.s.kind === "elite" && m.s.faction === f))).toBe(true);
  });

  it("is deterministic: the same room gives the same ids in the same order, and the map alone fixes what stands where", () => {
    const a = makeRun({ seed: 3, random: mulberry32(9) });
    const b = makeRun({ seed: 3, random: mulberry32(9) });
    expect([...a.state.mobs.keys()]).toEqual([...b.state.mobs.keys()]);
    expect(new Set(a.state.mobs.keys()).size).toBe(a.state.mobs.size);
    const c = makeRun({ seed: 3, random: mulberry32(10) }); // loot rolls differ, so ids may too; the camps may not
    const layout = (w: World) => allMobs(w).map((m) => [m.s.kind, m.s.faction, m.s.x, m.s.y]);
    expect(layout(c)).toEqual(layout(a));
  });

  it("places nothing until the run starts, and nothing at all unless SimConfig.mobs is set", () => {
    const lobby = makeLobby({ seed: 2 });
    expect(lobby.state.mobs.size).toBe(0);
    step(lobby, TICK_MS);
    expect(lobby.state.mobs.size).toBeGreaterThan(0);
    expect(makeBare({ seed: 2 }).state.mobs.size).toBe(0);
    const off = makeLobby({ seed: 2 });
    off.config.mobs = undefined;
    expect(off.state.mobs.size).toBe(0);
  });

  it("is a no-op on a map without regions or camps (a hand-built map)", () => {
    const w = makeBare();
    w.map = mapFromTiles(8, 8, new Uint8Array(64));
    spawnRegionalMobs(w);
    expect(w.state.mobs.size).toBe(0);
    expect(w.mobs.size).toBe(0);
    const generated = makeLobby({ seed: 1 });
    generated.map = { ...generated.map, regions: [], camps: [] };
    step(generated, TICK_MS);
    expect(generated.state.mobs.size).toBe(0);
  });

  it("registers the reaper as a system and chains onto hooks already installed", () => {
    const w = createWorld({
      seed: 1, config: { minPlayers: 1, lobbySeconds: 1, fillSeconds: 0, patienceSeconds: 60, patienceMinSeconds: 60, suddenDeathSeconds: 60, mobs: true },
      random: mulberry32(1),
    });
    const order: string[] = [];
    w.hooks.raidStarted = () => order.push("before");
    w.hooks.teleported = () => order.push("before");
    install(w);
    expect(w.systems).toContain(reapMobs);
    w.hooks.raidStarted!(w);
    expect(order).toEqual(["before"]);
    expect(w.state.mobs.size).toBeGreaterThan(0);
    placeMob(w, { region: "fire", elite: false, at: { x: 50, y: 50 } });
    w.hooks.teleported!(w);
    expect(order).toEqual(["before", "before"]);
    expect(vi.mocked(resetMob)).toHaveBeenCalled();
  });
});

describe("hurtMob", () => {
  it("removes the summed hp, stamps lastHitAt, tells the AI who hit it and returns the hp removed", () => {
    const w = makeBare();
    const m = spawn(w, "plague");
    w.state.serverTime = 4321;
    expect(hurt(w, m, ["p0", 10], ["p1", 5.5])).toBe(15.5);
    expect(m.s.hp).toBe(m.s.maxHp - 15.5);
    expect(m.s.status).toBe("alive");
    expect(m.rt.lastHitAt).toBe(4321);
    expect(aggroCalls(w, m)).toEqual([["p0", 10], ["p1", 5.5]]);
    expect(w.events).toEqual([]);
  });

  it("only players are told to the AI, and only for hits that did something", () => {
    const w = makeBare();
    const m = spawn(w, "frost");
    const other = spawn(w, "fire");
    hurt(w, m, ["p0", 0], ["p1", 7], [other.id, 9], ["gone", 3], ["p0", -4]);
    expect(aggroCalls(w, m)).toEqual([["p1", 7]]);
    expect(m.s.hp).toBe(m.s.maxHp - 19); // every positive amount hurts, whoever dealt it
  });

  it("ignores zero and negative damage: nothing changes, nobody is woken", () => {
    const w = makeBare();
    const m = spawn(w);
    m.rt.lastHitAt = 77;
    expect(hurtMob(w, m, [], [])).toBe(0);
    expect(hurt(w, m, ["p0", 0], ["p1", -3])).toBe(0);
    expect(hurt(w, m, ["p0", Number.NaN])).toBe(0);
    expect(m.s.hp).toBe(m.s.maxHp);
    expect(m.rt.lastHitAt).toBe(77);
    expect(aggro).not.toHaveBeenCalled();
  });

  it("ignores a mob that is already dead", () => {
    const w = makeBare();
    const m = spawn(w);
    hurt(w, m, ["p0", m.s.hp]);
    w.events = [];
    m.rt.lastHitAt = 5;
    vi.mocked(aggro).mockClear();
    expect(hurt(w, m, ["p1", 50])).toBe(0);
    expect(m.rt.lastHitAt).toBe(5);
    expect(m.s.hp).toBe(0);
    expect(w.events).toEqual([]);
    expect(aggro).not.toHaveBeenCalled();
    expect(RT(w, 1).mobKills).toBe(0);
  });

  it("a hit that empties it returns only the hp it had left, kills it and wakes nobody", () => {
    const w = makeBare();
    const m = spawn(w, "fire");
    m.s.hp = 4;
    expect(hurt(w, m, ["p0", 10])).toBe(4);
    expect(m.s.hp).toBe(0);
    expect(m.s.status).toBe("dead");
    expect(aggro).not.toHaveBeenCalled();
    expect(fxOf(w.events, "death")).toHaveLength(1);
  });

  it("dies exactly at zero, not before", () => {
    const w = makeBare();
    const m = spawn(w);
    hurt(w, m, ["p0", m.s.maxHp - 1]);
    expect(m.s.status).toBe("alive");
    expect(m.s.hp).toBe(1);
    expect(hurt(w, m, ["p0", 1])).toBe(1);
    expect(m.s.status).toBe("dead");
  });

  it("a mob walking home is evading: nothing hurts it, nothing is recorded, nobody is woken", () => {
    const w = makeBare();
    const m = spawn(w, "plague");
    m.rt.brain!.mode = "return";
    m.s.hp = 100;
    m.rt.lastHitAt = 77;
    expect(hurt(w, m, ["p0", 40], ["p1", 5])).toBe(0);
    expect(hurt(w, m, ["p0", 1e9])).toBe(0); // not even a lethal hit
    expect(m.s.hp).toBe(100);
    expect(m.s.status).toBe("alive");
    expect(m.rt.lastHitAt).toBe(77);
    expect(aggro).not.toHaveBeenCalled();
    expect(w.events).toEqual([]);
    expect(RT(w, 0).mobKills).toBe(0);
  });

  it("through the ledger an evading mob shows no hit number, no stagger and no death", () => {
    const w = makeBare();
    const m = spawn(w, "frost");
    m.rt.brain!.mode = "return";
    strike(w, m.id, "p0", 1e6, true);
    applyLedger(w);
    expect(m.s.hp).toBe(m.s.maxHp);
    expect(m.s.status).toBe("alive");
    expect(w.events).toEqual([]);
    expect(aggro).not.toHaveBeenCalled();
    m.rt.brain!.mode = "idle"; // once it is home and idle again it can be hurt as before
    strike(w, m.id, "p0", 10);
    applyLedger(w);
    expect(m.s.hp).toBeLessThan(m.s.maxHp);
    expect(fxOf(w.events, "hit")).toHaveLength(1);
  });

  it("the ledger path: mitigation uses the mob's own armor and shield, the hit fx names the attacker, the AI hears the mitigated amount", () => {
    const w = makeBare();
    const packet = { raw: 100, phys: 0.5, magic: 0.5, true: 0 };
    const seen = new Set<number>();
    for (const region of FACTION_IDS) {
      for (const elite of [false, true]) {
        const m = spawn(w, region, elite);
        const spec = pacedFaction(mobFaction(region, elite));
        const removed = mitigateShares(100, packet, { armor: spec.armor, shield: spec.shield });
        expect(mitigateShares(100, packet, defenseOf(m.s))).toBe(removed);
        seen.add(Math.round(removed));
        vi.mocked(aggro).mockClear();
        w.events = [];
        recordHit(w, { victim: m.id, by: { id: "p0", name: "alice" }, packet, weapon: "sword", stagger: false });
        applyLedger(w);
        expect(m.s.hp).toBeCloseTo(m.s.maxHp - removed, 9);
        expect(aggroCalls(w, m)).toEqual([["p0", removed]]);
        expect(fxOf(w.events, "hit")).toEqual([{ kind: "hit", id: m.id, by: "p0", amount: removed, weapon: "sword" }]);
      }
    }
    expect(seen.size).toBeGreaterThan(2); // the regions really do defend differently, so the check above bites
  });

  it("the ledger path kills and pays: the hit that empties the mob pays its killer through the ledger", () => {
    const w = makeBare();
    const m = spawn(w, "sentenced");
    recordHit(w, { victim: m.id, by: { id: "p1", name: "bob" }, packet: { raw: 1e6, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: true });
    applyLedger(w);
    expect(m.s.status).toBe("dead");
    expect(RT(w, 1).mobKills).toBe(1);
    expect(fxOf(w.events, "death")).toEqual([{ kind: "death", id: m.id, x: m.s.x, y: m.s.y, by: "p1" }]);
    expect(fxOf(w.events, "stagger")).toEqual([]); // a corpse isn't staggered
  });

  it("friendly fire: a mob's hit on another mob is recorded with scale 0 and takes nothing", () => {
    const w = makeBare();
    const attacker = spawn(w, "fire");
    const victim = spawn(w, "plague", false, { x: 240, y: 200 });
    const e = recordHit(w, { victim: victim.id, by: { id: attacker.id, name: attacker.s.name }, packet: { raw: 9999, phys: 1, magic: 0, true: 0 }, weapon: "axe", stagger: true });
    expect(e.scale).toBe(0);
    applyLedger(w);
    expect(victim.s.hp).toBe(victim.s.maxHp);
    expect(victim.rt.lastHitAt).toBe(0);
    expect(aggro).not.toHaveBeenCalled();
    expect(fxOf(w.events, "hit")).toEqual([]);
    expect(victim.s.status).toBe("alive");
  });

  it("training dummies still never die and pay nothing", () => {
    const w = makeBare();
    const id = addMob(w, { kind: "dummy", name: "Dummy", at: { x: 220, y: 220 } });
    const d = mobOf(w, id);
    recordHit(w, { victim: id, by: { id: "p0", name: "alice" }, packet: { raw: 1e9, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false });
    applyLedger(w);
    expect(d.s.status).toBe("alive");
    expect(d.s.hp).toBe(d.s.maxHp);
    expect(RT(w, 0).mobKills).toBe(0);
    expect(gvOf(w.events)).toEqual([]);
    expect(fxOf(w.events, "death")).toEqual([]);
    expect(aggro).not.toHaveBeenCalled();
    // ...and the reaper leaves them alone: no regen of its own, no removal.
    d.s.hp = 10;
    w.state.serverTime += 60_000;
    reapMobs(w, TICK_MS);
    expect(d.s.hp).toBe(10);
    expect(w.state.mobs.has(id)).toBe(true);
  });
});

describe("killMob: the dying mob", () => {
  it("dies in place: status, hp, diedAt, brain, queued inputs, path, windup and trigger are all cleared", () => {
    const w = makeBare();
    const m = spawn(w, "sentenced");
    w.state.serverTime = 9000;
    const brain = m.rt.brain!;
    brain.mode = "fight";
    brain.target = "p0";
    brain.threat.set("p0", 40);
    brain.goal = { x: 1, y: 2 };
    brain.moving = true;
    brain.holding = true;
    m.rt.inputs.pushMove({ kind: "move", x: 5, y: 5 });
    m.rt.inputs.pushAim(1);
    m.rt.inputs.pushAction({ kind: "attack", a: 1 });
    m.rt.path = [{ x: 9, y: 9 }];
    m.rt.weapon.held = true;
    m.rt.weapon.bufferedUntil = 99999;
    m.rt.weapon.action = {
      kind: "draw", weapon: "bow", startedAt: 8900, landsAt: 9500, a: 0, packet: { raw: 1, phys: 1, magic: 0, true: 0 }, origin: { x: 333, y: 444 },
    };
    m.s.drawStartedAt = 8900;
    m.s.x = 333;
    m.s.y = 444;

    hurt(w, m, ["p0", m.s.hp]);

    expect(m.s.status).toBe("dead");
    expect(m.s.hp).toBe(0);
    expect(brain.diedAt).toBe(9000);
    expect(brain.target).toBeNull();
    expect(brain.threat.size).toBe(0);
    expect(brain.goal).toBeNull();
    expect(brain.moving).toBe(false);
    expect(brain.holding).toBe(false);
    expect(m.rt.inputs.move).toBeNull();
    expect(m.rt.inputs.aim).toBeNull();
    expect(m.rt.inputs.actions).toEqual([]);
    expect(m.rt.path).toEqual([]);
    expect(m.rt.weapon.action).toBeNull();
    expect(m.rt.weapon.held).toBe(false);
    expect(m.rt.weapon.bufferedUntil).toBe(0);
    expect(m.s.drawStartedAt).toBe(0);
    expect(fxOf(w.events, "death")).toEqual([{ kind: "death", id: m.id, x: 333, y: 444, by: "p0" }]);
  });

  it("killMob on its own (a scripted kill) empties the hp itself and pays the largest hitter in the entries", () => {
    const w = makeBare();
    const m = spawn(w, "fire", true);
    killMob(w, m, [entry(m.id, "p1", 3), entry(m.id, "p0", 8)], [3, 8]);
    expect(m.s.hp).toBe(0);
    expect(m.s.status).toBe("dead");
    expect(fxOf(w.events, "death")[0]!.by).toBe("p0");
    expect(RT(w, 0).mobKills).toBe(1);
    expect(RT(w, 1).mobKills).toBe(0);
  });

  it("dies once: killing a corpse again pays nothing and emits nothing", () => {
    const w = makeBare();
    const m = spawn(w);
    hurt(w, m, ["p0", m.s.hp]);
    const before = { mobKills: RT(w, 0).mobKills, gv: RT(w, 0).gv.mobs, events: w.events.length, containers: w.state.containers.size };
    killMob(w, m, [entry(m.id, "p0", 100)], [100]);
    expect(RT(w, 0).mobKills).toBe(before.mobKills);
    expect(RT(w, 0).gv.mobs).toBe(before.gv);
    expect(w.events).toHaveLength(before.events);
    expect(w.state.containers.size).toBe(before.containers);
  });

  it("a mob nobody still in the fight hit just falls: no GV, no feed, no card, no random roll, and its weapon lies where it fell", () => {
    const w = makeBare();
    const random = vi.fn(() => 0.1);
    w.random = random;
    const containers = w.state.containers.size;
    const m = spawn(w, "holy");
    hurt(w, m, ["ghost", m.s.hp]);
    expect(m.s.status).toBe("dead");
    expect(fxOf(w.events, "death")).toEqual([{ kind: "death", id: m.id, x: m.s.x, y: m.s.y, by: null }]);
    expect(w.events).toHaveLength(1);
    expect(random).not.toHaveBeenCalled();
    // Nobody to pay, but nobody holds the weapon either: it is there for the taking.
    expect(w.state.containers.size).toBe(containers + 1);
    const drop = [...w.state.containers.values()].at(-1)!;
    expect(drop).toMatchObject({ kind: "ground", x: m.s.x, y: m.s.y });
    expect(drop.items.map((it) => it.def)).toEqual([mobWeapon("holy")]);
    for (const i of [0, 1]) {
      expect(RT(w, i).mobKills).toBe(0);
      expect(RT(w, i).gv.mobs).toBe(0);
      expect(held(P(w, i))).toEqual({});
    }
  });

  it("another mob can't collect: a (never-ledgered) mob id is not a killer", () => {
    const w = makeBare();
    const m = spawn(w);
    const other = spawn(w, "plague");
    hurt(w, m, [other.id, m.s.hp]);
    expect(fxOf(w.events, "death")[0]!.by).toBeNull();
    expect(gvOf(w.events)).toEqual([]);
  });
});

describe("killMob: who gets the kill", () => {
  it("the most damage in the ledger pass, whatever the position of the hits in it", () => {
    const w = makeBare({ players: 3 });
    const m = spawn(w, "fire");
    hurt(w, m, ["p0", 5], ["p2", 30], ["p1", 12], ["p0", m.s.hp]); // the biggest is p0's last
    expect(fxOf(w.events, "death")[0]!.by).toBe("p0");
    expect([RT(w, 0).mobKills, RT(w, 1).mobKills, RT(w, 2).mobKills]).toEqual([1, 0, 0]);
    const n = spawn(w, "fire");
    w.events = [];
    hurt(w, n, ["p1", 9], ["p2", n.s.hp - 9 + 40], ["p0", 20]);
    expect(fxOf(w.events, "death")[0]!.by).toBe("p2");
    expect([RT(w, 0).mobKills, RT(w, 1).mobKills, RT(w, 2).mobKills]).toEqual([1, 0, 1]);
  });

  it("damage is summed per player: two hits of 60 beat one hit of 100", () => {
    const w = makeBare();
    const m = spawn(w, "plague");
    m.s.hp = 220;
    hurt(w, m, ["p0", 60], ["p1", 100], ["p0", 60]);
    expect(m.s.status).toBe("dead");
    expect(fxOf(w.events, "death")[0]!.by).toBe("p0");
    expect(RT(w, 0).mobKills).toBe(1);
    expect(RT(w, 1).mobKills).toBe(0);
  });

  describe("the whole fight counts, not only the killing pass", () => {
    /** A plague mob with `hp` left, after `threat` (what each player did to it since it last rested). */
    function wounded(w: World, hp: number, threat: Array<[string, number]>): MobCombatant {
      const m = spawn(w, "plague");
      m.s.hp = hp;
      for (const [id, sum] of threat) m.rt.brain!.threat.set(id, sum);
      return m;
    }

    it("a late finisher does not take the kill from the player who did most of the work", () => {
      const w = makeBare();
      const m = wounded(w, 50, [["p0", 200], ["p1", 20]]);
      hurt(w, m, ["p1", 50]); // 70 in all against p0's 200
      expect(fxOf(w.events, "death")[0]!.by).toBe("p0");
      expect([RT(w, 0).mobKills, RT(w, 1).mobKills]).toEqual([1, 0]);
    });

    it("...unless the finisher's total overtakes: the earlier damage and this pass's add up per player", () => {
      const w = makeBare();
      const m = wounded(w, 50, [["p0", 40], ["p1", 20]]);
      hurt(w, m, ["p1", 50]);
      expect(fxOf(w.events, "death")[0]!.by).toBe("p1");
      const n = wounded(w, 50, [["p0", 40], ["p1", 20]]);
      w.events = [];
      hurt(w, n, ["p0", 10], ["p1", 40]); // 50 against 60
      expect(fxOf(w.events, "death")[0]!.by).toBe("p1");
      const o = wounded(w, 50, [["p0", 40], ["p1", 20]]);
      w.events = [];
      hurt(w, o, ["p0", 30], ["p1", 20]); // 70 against 40
      expect(fxOf(w.events, "death")[0]!.by).toBe("p0");
    });

    it("the killing pass counts for the hp it removed, not for its overkill: one huge late hit does not outweigh the work before it", () => {
      const w = makeBare();
      // 225 hp: p0 took 120 of it, 105 is left. p1's one hit of 165 removes only those 105.
      const m = wounded(w, 105, [["p0", 120]]);
      hurt(w, m, ["p1", 165]);
      expect(fxOf(w.events, "death")[0]!.by).toBe("p0");
      // The same hit does win it when what it removed is the larger share.
      const n = wounded(w, 105, [["p0", 50]]);
      w.events = [];
      hurt(w, n, ["p1", 165]);
      expect(fxOf(w.events, "death")[0]!.by).toBe("p1");
    });

    it("the overkill is shared out by hit size within the killing pass", () => {
      const w = makeBare();
      // 100 hp left, hits of 150 (p0) and 50 (p1) land together: 200 in all, so they count 75 and 25.
      const m = wounded(w, 100, [["p1", 60]]);
      hurt(w, m, ["p0", 150], ["p1", 50]);
      expect(fxOf(w.events, "death")[0]!.by).toBe("p1"); // 60 + 25 = 85 beats 75
    });

    it("an earlier leader who is out of the run (resolved, unknown or a mob) is skipped", () => {
      const w = makeBare({ players: 3 });
      RT(w, 0).resolved = true;
      const other = spawn(w, "fire");
      const m = wounded(w, 50, [["p0", 500], ["ghost", 400], [other.id, 300], ["p2", 30], ["p1", 20]]);
      hurt(w, m, ["p1", 50]);
      expect(fxOf(w.events, "death")[0]!.by).toBe("p1");
      expect([RT(w, 0).mobKills, RT(w, 1).mobKills, RT(w, 2).mobKills]).toEqual([0, 1, 0]);
    });

    it("an earlier leader stays the killer with nobody else in the killing pass, and the threat is gone after", () => {
      const w = makeBare();
      const m = wounded(w, 10, [["p0", 90], ["p1", 5]]);
      hurt(w, m, ["ghost", 10]);
      expect(fxOf(w.events, "death")[0]!.by).toBe("p0");
      expect(m.rt.brain!.threat.size).toBe(0);
    });

    it("an exact tie between the earlier leader and the finisher goes to the lower rank, as in any other tie", () => {
      const w = makeBare();
      const lower = tieRank(w, "p0") < tieRank(w, "p1") ? "p0" : "p1";
      const m = wounded(w, 30, [["p0", 60], ["p1", 30]]);
      hurt(w, m, ["p1", 30]);
      expect(fxOf(w.events, "death")[0]!.by).toBe(lower);
    });
  });

  it("an exact tie in what they did goes to the lower order-free rank of the tick, never to whoever hit first", () => {
    const w = makeBare({ players: 3 });
    const lower = (x: string, y: string): string => (tieRank(w, x) < tieRank(w, y) ? x : y);
    const killerOf = (...hits: Array<[string, number]>): string | null => {
      const m = spawn(w, "plague");
      m.s.hp = 120;
      w.events = [];
      hurt(w, m, ...hits);
      return fxOf(w.events, "death")[0]!.by;
    };
    // 60 in one hit ties 40 + 20, and the order the hits came in changes nothing.
    expect(killerOf(["p0", 60], ["p1", 40], ["p1", 20])).toBe(lower("p0", "p1"));
    expect(killerOf(["p1", 40], ["p0", 60], ["p1", 20])).toBe(lower("p0", "p1"));
    expect(killerOf(["p1", 40], ["p1", 20], ["p0", 60])).toBe(lower("p0", "p1"));
    // A tie of two out of three.
    expect(killerOf(["p2", 60], ["p0", 60])).toBe(lower("p0", "p2"));
    expect(killerOf(["p0", 60], ["p2", 60])).toBe(lower("p0", "p2"));
    expect(RT(w, 0).mobKills + RT(w, 1).mobKills + RT(w, 2).mobKills).toBe(5);
  });

  it("two players landing the lethal ledger pass together: one kill, paid once, to the larger hit", () => {
    const w = makeBare();
    const m = spawn(w, "sentenced");
    const hp = m.s.hp;
    expect(hurt(w, m, ["p0", hp / 2 + 3], ["p1", hp / 2 + 10])).toBe(hp);
    expect(fxOf(w.events, "death")).toHaveLength(1);
    expect(fxOf(w.events, "death")[0]!.by).toBe("p1");
    expect(RT(w, 1).mobKills).toBe(1);
    expect(RT(w, 1).gv.mobs).toBe(GV_MOB);
    expect(RT(w, 0).mobKills).toBe(0);
    expect(RT(w, 0).gv.mobs).toBe(0);
    expect(gvOf(w.events)).toEqual([{ type: "gv", id: "p1", amount: GV_MOB, reason: "mob" }]);
    // A kill gives GV and a weapon, no stat: nobody holds a card for it.
    expect(held(P(w, 1))).toEqual({});
    expect(held(P(w, 0))).toEqual({});
  });

  it("a player who is dead or down in the same pass still collects the GV and the feed, and the weapon drops", () => {
    const w = makeBare({ players: 3 });
    P(w, 0).build.set("ad1", 1);
    P(w, 0).weapon0 = "sword";
    P(w, 0).weapon1 = "";
    RT(w, 0).down = { outcome: "died" }; // went down earlier in this very ledger pass
    P(w, 0).status = "dead";
    const containers = w.state.containers.size;
    const m = spawn(w, "fire");
    hurt(w, m, ["p0", 3 * m.s.hp], ["p1", 100], ["p2", m.s.hp]);
    expect(fxOf(w.events, "death")[0]!.by).toBe("p0");
    expect(RT(w, 0).mobKills).toBe(1);
    expect(P(w, 0).mobKills).toBe(1);
    expect(RT(w, 0).gv.mobs).toBe(GV_MOB);
    expect(gvOf(w.events)).toEqual([{ type: "gv", id: "p0", amount: GV_MOB, reason: "mob" }]);
    expect(w.state.containers.size).toBe(containers + 1);
    expect(held(P(w, 0))).toEqual({ ad1: 1 });
    expect(RT(w, 0).boost).toBeUndefined(); // nothing but a card grants a barrier
    expect(RT(w, 1).mobKills + RT(w, 2).mobKills).toBe(0);
  });

  it("the same holds for a runtime that is down while the status has not flipped yet", () => {
    const w = makeBare();
    const m = spawn(w, "frost");
    RT(w, 0).down = { outcome: "died" };
    hurt(w, m, ["p0", 2 * m.s.hp], ["p1", m.s.hp]);
    expect(fxOf(w.events, "death")[0]!.by).toBe("p0");
    expect(RT(w, 0).mobKills).toBe(1);
    expect(RT(w, 1).mobKills).toBe(0);
  });

  it("a hitter whose result is out is skipped: the next most damaging collects", () => {
    const w = makeBare({ players: 3 });
    const m = spawn(w, "frost");
    RT(w, 0).resolved = true;
    hurt(w, m, ["p0", 3 * m.s.hp], ["p2", 2 * m.s.hp], ["p1", m.s.hp]);
    expect(fxOf(w.events, "death")[0]!.by).toBe("p2");
    expect(RT(w, 2).mobKills).toBe(1);
    expect(RT(w, 0).mobKills).toBe(0);
    const n = spawn(w, "frost");
    RT(w, 2).resolved = true;
    w.events = [];
    hurt(w, n, ["p0", 3 * n.s.hp], ["p2", 2 * n.s.hp], ["p1", n.s.hp]);
    expect(fxOf(w.events, "death")[0]!.by).toBe("p1");
    expect(RT(w, 1).mobKills).toBe(1);
  });

  it("pays nobody when the only hitters are resolved players, unknown ids or mobs", () => {
    const w = makeBare({ players: 3 });
    const other = spawn(w, "plague");
    RT(w, 0).resolved = true;
    RT(w, 1).resolved = true;
    const m = spawn(w, "fire");
    hurt(w, m, ["p0", 2 * m.s.hp], ["p1", 2 * m.s.hp], ["nobody", m.s.hp], [other.id, m.s.hp]);
    expect(m.s.status).toBe("dead");
    expect(fxOf(w.events, "death")[0]!.by).toBeNull();
    expect(gvOf(w.events)).toEqual([]);
    expect(RT(w, 0).mobKills + RT(w, 1).mobKills + RT(w, 2).mobKills).toBe(0);
    expect(RT(w, 1).gv.mobs).toBe(0);
  });

  it("a player who has left the room is not a killer", () => {
    const w = makeBare();
    const m = spawn(w);
    hurtMob(w, m, [m.s.hp], [entry(m.id, "left-already", m.s.hp)]);
    expect(fxOf(w.events, "death")[0]!.by).toBeNull();
    expect(gvOf(w.events)).toEqual([]);
  });
});

describe("killMob: rewards", () => {
  it("GV at feed 0 rounds back to the base: 2 for a mob, 10 for an elite", () => {
    const w = makeBare();
    expect(mobRewardMultiplier(0, 0)).toBeCloseTo(0.976, 3);
    const mob = spawn(w, "fire");
    hurt(w, mob, ["p0", mob.s.hp]);
    expect(RT(w, 0).gv.mobs).toBe(GV_MOB);
    const elite = spawn(w, "fire", true);
    hurt(w, elite, ["p0", elite.s.hp]);
    expect(RT(w, 0).gv.mobs).toBe(GV_MOB + GV_ELITE);
    expect(gvOf(w.events)).toEqual([
      { type: "gv", id: "p0", amount: GV_MOB, reason: "mob" },
      { type: "gv", id: "p0", amount: GV_ELITE, reason: "elite" },
    ]);
    expect(P(w, 0).gv).toBe(GV_MOB + GV_ELITE);
  });

  it("the mob counts toward the feed (and so the next mob pays less) but not toward player kills, and never raises a bounty", () => {
    const w = makeBare();
    for (let i = 0; i < 4; i++) {
      const m = spawn(w, "plague");
      w.events = [];
      hurt(w, m, ["p0", m.s.hp]);
      expect(fxOf(w.events, "bounty")).toEqual([]);
    }
    expect(RT(w, 0).mobKills).toBe(4);
    expect(P(w, 0).mobKills).toBe(4);
    expect(P(w, 0).kills).toBe(0);
    expect(P(w, 0).bounty).toBe(0);
    // Each kill was paid at the feed the ones before it left: a quarter point more each time, the lobby median half of that.
    const rewards = paidAt();
    expect(rewards).toHaveLength(4);
    rewards.forEach((got, i) => expect(got).toBeCloseTo(mobRewardMultiplier(0.25 * i, 0.125 * i), 9));
    for (let i = 1; i < rewards.length; i++) expect(rewards[i]!).toBeLessThan(rewards[i - 1]!);

    // However fed on mobs they are, the bounty stays at zero and nothing is announced.
    setFeed(w, 0, 0, 400); // a feed of 100
    const m = spawn(w, "plague");
    w.events = [];
    hurt(w, m, ["p0", m.s.hp]);
    expect(RT(w, 0).mobKills).toBe(401);
    expect(P(w, 0).mobKills).toBe(401);
    expect(P(w, 0).kills).toBe(0);
    expect(P(w, 0).bounty).toBe(0);
    expect(fxOf(w.events, "bounty")).toEqual([]);
    expect(paidAt().at(-1)).toBeCloseTo(mobRewardMultiplier(100, 50), 9);
  });

  it("GV falls for a high-feed killer (feed 8)", () => {
    const w = makeBare();
    setFeed(w, 0, 8);
    const m = spawn(w, "fire", true);
    const mult = mobRewardMultiplier(8, 4);
    expect(mult).toBeCloseTo(0.383, 3);
    hurt(w, m, ["p0", m.s.hp]);
    expect(RT(w, 0).gv.mobs).toBe(Math.round(GV_ELITE * mult));
    expect(RT(w, 0).gv.mobs).toBe(4);
    expect(paidAt()[0]).toBeCloseTo(mult, 9);
    const n = spawn(w, "fire");
    const before = RT(w, 0).gv.mobs;
    hurt(w, n, ["p0", n.s.hp]);
    expect(RT(w, 0).gv.mobs - before).toBe(1); // round(0.77): less than the base 2
  });

  it("GV rises for a catch-up killer (feed more than 2 under the lobby median): x1.25 on top of the curve", () => {
    const w = makeBare({ players: 3 });
    setFeed(w, 1, 5);
    setFeed(w, 2, 5);
    const mult = mobRewardMultiplier(0, 5);
    expect(mult).toBeCloseTo(rewardCurve(0) * 1.25, 12);
    const m = spawn(w, "holy", true);
    hurt(w, m, ["p0", m.s.hp]);
    expect(RT(w, 0).gv.mobs).toBe(Math.round(GV_ELITE * mult));
    expect(RT(w, 0).gv.mobs).toBe(12);
    expect(paidAt()[0]).toBeCloseTo(mult, 9);
    const n = spawn(w, "holy");
    hurt(w, n, ["p0", n.s.hp]);
    // The elite kill is now a quarter of a feed point, still far enough under the median of 5 for the catch-up.
    expect(paidAt()[1]).toBeCloseTo(mobRewardMultiplier(0.25, 5), 9);
    expect(paidAt()[1]).toBeGreaterThan(rewardCurve(0.25)); // the x1.25 is on
  });

  it("reads the reward before the kill is counted: a kill that lifts the killer out of catch-up still pays it", () => {
    const w = makeBare({ players: 3 });
    setFeed(w, 0, 2, 3); // feed 2.75: under 5 - 2; the kill makes it exactly 3, which would no longer qualify
    setFeed(w, 1, 5);
    setFeed(w, 2, 5);
    const before = mobRewardMultiplier(2.75, 5);
    const after = mobRewardMultiplier(3, 5);
    expect(Math.round(GV_ELITE * before)).not.toBe(Math.round(GV_ELITE * after));
    const m = spawn(w, "sentenced", true);
    hurt(w, m, ["p0", m.s.hp]);
    expect(RT(w, 0).gv.mobs).toBe(Math.round(GV_ELITE * before));
    expect(paidAt()[0]).toBeCloseTo(before, 9);
  });

  it("GV_MOB_CAP caps the GV and nothing else: the kill still counts and still drops a weapon", () => {
    const w = makeBare();
    RT(w, 0).gv.mobs = GV_MOB_CAP - 1;
    P(w, 0).weapon0 = "sword";
    P(w, 0).weapon1 = "";
    const m = spawn(w, "plague");
    hurt(w, m, ["p0", m.s.hp]);
    expect(RT(w, 0).gv.mobs).toBe(GV_MOB_CAP);
    expect(gvOf(w.events)).toEqual([{ type: "gv", id: "p0", amount: 1, reason: "mob" }]);
    w.events = [];
    const containers = w.state.containers.size;
    const n = spawn(w, "plague");
    hurt(w, n, ["p0", n.s.hp]);
    expect(RT(w, 0).gv.mobs).toBe(GV_MOB_CAP);
    expect(gvOf(w.events)).toEqual([]);
    expect(RT(w, 0).mobKills).toBe(2);
    expect(w.state.containers.size).toBe(containers + 1);
  });

  describe("a kill gives fixed per-type stat progress", () => {
    it.each(MOB_TYPES.map((t) => [t.id, t] as const))(
      "%s: pays GV and the feed, grants one fixed normal-type stack only, and draws nothing from the world's random", (id, t) => {
        const w = makeBare();
        const random = vi.fn(() => 0.1);
        w.random = random;
        const m = spawn(w, t.zone, t.elite, undefined, id); // the type the mob carries
        expect(m.s.type).toBe(id);
        hurt(w, m, ["p0", m.s.hp]);
        expect(RT(w, 0).mobKills).toBe(1);
        expect(RT(w, 0).gv.mobs).toBeGreaterThan(0);
        expect(held(P(w, 0))).toEqual({});
        expect(mobStatCount(P(w, 0).mobStats, id)).toBe(t.elite ? 0 : 1);
        expect(mobStatRows(P(w, 0).mobStats).length).toBe(t.elite ? 0 : 1);
        expect(random).not.toHaveBeenCalled();
        expect(held(P(w, 1))).toEqual({});
      });

    it("a mob placed without a type pays GV but gives no type stat", () => {
      for (const region of FACTION_IDS) {
        for (const elite of [false, true]) {
          const w = makeBare();
          const m = spawn(w, region, elite);
          expect(m.s.type).toBe("");
          hurt(w, m, ["p0", m.s.hp]);
          expect(held(P(w, 0)), `${region} ${elite}`).toEqual({});
          expect(RT(w, 0).gv.mobs, `${region} ${elite}`).toBeGreaterThan(0);
        }
      }
    });

    it("every mob of a camp is paid at the reward of the feed it finds and grants only normal-type stacks", () => {
      for (const seed of [1, 100]) {
        const w = makeRun({ seed });
        credit.mockClear();
        let feed = 0;
        for (const m of allMobs(w)) {
          const type = m.s.type as MobTypeId;
          expect(mobTypeById(type), `${m.id} has a type`).toBeDefined();
          hurt(w, m, ["p0", m.s.hp]);
          const reward = mobRewardMultiplier(feed, feed / 2); // the other player's feed is 0: the median is half of p0's
          expect(paidAt().at(-1), m.id).toBeCloseTo(reward, 9);
          feed += 0.25;
        }
        expect(RT(w, 0).mobKills).toBe(w.map.camps.reduce((n, c) => n + c.spots.length, 0));
        for (const t of MOB_TYPES.filter((x) => !x.elite)) {
          const count = allMobs(w).filter((m) => m.s.type === t.id && m.s.kind !== "elite").length;
          expect(mobStatCount(P(w, 0).mobStats, t.id)).toBe(count);
        }
      }
    });

    it("what the player holds does not change what the next kill pays: a card is no part of the reward", () => {
      const a = makeBare();
      const b = makeBare();
      for (const id of ["ad2", "vitality3"]) grantCard(b, combatant(b, "p0") as Extract<ReturnType<typeof combatant>, { kind: "player" }>, id);
      for (const w of [a, b]) hurt(w, spawn(w, "fire", true), ["p0", 1e6]);
      expect(RT(b, 0).gv.mobs).toBe(RT(a, 0).gv.mobs);
      expect(paidAt()[1]).toBe(paidAt()[0]);
      expect(mobRewardFor(a, P(a, 0), RT(a, 0))).toBeGreaterThan(0);
    });

    it("the same credited normal kill grants the same stat at different feeds", () => {
      const low = makeBare();
      const high = makeBare();
      setFeed(low, 0, 0, 0);
      setFeed(high, 0, 99, 999);
      hurt(low, spawn(low, "fire", false, undefined, "emberImp"), ["p0", 1e6]);
      hurt(high, spawn(high, "fire", false, undefined, "emberImp"), ["p0", 1e6]);
      expect(mobStatCount(P(low, 0).mobStats, "emberImp")).toBe(1);
      expect(mobStatCount(P(high, 0).mobStats, "emberImp")).toBe(1);
      expect(mobStatRows(P(low, 0).mobStats)).toEqual(mobStatRows(P(high, 0).mobStats));
    });
  });

  it("keeps personal mob stat progress when camps respawn", () => {
    const w = makeRun();
    const p = combatant(w, "p0") as Extract<ReturnType<typeof combatant>, { kind: "player" }>;
    expect(grantMobStat(w, p, "emberImp", 4)).toBe(4);
    const camp = w.state.camps[0]!;
    camp.state = CAMP_CLEARED;
    camp.alive = 0;
    camp.respawnAt = w.state.serverTime + 1;
    w.state.serverTime += 1;
    respawnCamps(w);
    expect(mobStatCount(P(w, 0).mobStats, "emberImp")).toBe(4);
  });

  describe("the weapon drop", () => {
    /** A mob of `region` at the killer's feet, hit to death by p0, who carries `slots`. */
    function killWith(region: FactionId, slots: [string, string]): { w: World; m: MobCombatant; created: string[] } {
      const w = makeBare();
      P(w, 0).weapon0 = slots[0];
      P(w, 0).weapon1 = slots[1];
      const m = spawn(w, region, false, { x: P(w, 0).x + 8, y: P(w, 0).y });
      const before = new Set(w.state.containers.keys());
      hurt(w, m, ["p0", m.s.hp]);
      return { w, m, created: [...w.state.containers.keys()].filter((id) => !before.has(id)) };
    }

    it("lands at the mob's feet as a loose weapon of the mob's type when the killer holds neither slot's type", () => {
      for (const region of FACTION_IDS) {
        const weapon = mobWeapon(region);
        const other = weapon === "sword" ? "bow" : "sword";
        const { w, m, created } = killWith(region, [other, ""]);
        expect(created, region).toHaveLength(1);
        const box = w.state.containers.get(created[0]!)!;
        expect(box.kind).toBe("ground");
        expect(box.x).toBe(m.s.x);
        expect(box.y).toBe(m.s.y);
        expect(box.label).toBe(WEAPONS[weapon].name);
        expect(box.items.map((it) => it.def)).toEqual([weapon]);
      }
    });

    it("arms a killer who stands with an empty hand: the weapon goes into the hand, a toast says so, and nothing lies on the ground", () => {
      for (const region of FACTION_IDS) {
        const weapon = mobWeapon(region);
        const { w, created } = killWith(region, ["", ""]);
        expect(created, region).toEqual([]);
        expect([P(w, 0).weapon0, P(w, 0).weapon1, P(w, 0).slot], region).toEqual([weapon, "", 0]);
        expect(w.events.filter((e) => e.type === "toast" && e.text.startsWith("Armed:")), region).toEqual([{ type: "toast", to: "p0", text: `Armed: ${WEAPONS[weapon].name}` }]);
      }
    });

    it("arms the hand's own slot, not slot 0: the hand on an empty second slot takes the weapon and keeps the first slot's", () => {
      const w = makeBare();
      P(w, 0).weapon0 = "sword";
      P(w, 0).slot = 1; // the hand is the empty second slot (fists)
      const m = spawn(w, "plague", false, { x: P(w, 0).x + 8, y: P(w, 0).y });
      const before = w.state.containers.size;
      hurt(w, m, ["p0", m.s.hp]);
      expect([P(w, 0).weapon0, P(w, 0).weapon1, P(w, 0).slot]).toEqual(["sword", "bow", 1]);
      expect(w.state.containers.size).toBe(before);
    });

    it("costs the swap time like a pickup into the hand, and cancels what the killer was doing", () => {
      const w = makeBare();
      const m = spawn(w, "fire", false, { x: P(w, 0).x + 8, y: P(w, 0).y });
      P(w, 0).readyAt = 0;
      hurt(w, m, ["p0", m.s.hp]);
      expect(P(w, 0).readyAt).toBe(w.state.serverTime + SWAP_SECONDS * 1000);
      expect(RT(w, 0).weapon.action).toBeNull();
    });

    it("leaves the weapon on the ground for a killer whose hand is armed, even with a free second slot", () => {
      const { w, created } = killWith("plague", ["sword", ""]);
      expect(created).toHaveLength(1);
      expect([P(w, 0).weapon0, P(w, 0).weapon1]).toEqual(["sword", ""]);
      expect(w.events.filter((e) => e.type === "toast").map((e) => e.type === "toast" ? e.text : "")).toEqual(["Plague Rat: +1 kill stack · +1% attack speed total"]);
    });

    it("leaves it on the ground for an empty-handed killer who went down in the same pass (a body cannot wield it)", () => {
      const w = makeBare();
      const m = spawn(w, "plague");
      const n = w.state.containers.size;
      w.combat.collecting = true;
      hurt(w, m, ["p0", m.s.hp]);
      RT(w, 0).down = { outcome: "died" } as never; // downed in the pass: not standing when the spoils are paid
      w.combat.collecting = false;
      for (const pay of w.combat.payouts) pay();
      expect(w.state.containers.size).toBe(n + 1);
      expect([P(w, 0).weapon0, P(w, 0).weapon1]).toEqual(["", ""]);
      expect(w.events.filter((e) => e.type === "toast").map((e) => e.type === "toast" ? e.text : "")).toEqual(["Plague Rat: +1 kill stack · +1% attack speed total"]);
    });

    it("is not dropped when the killer already holds that weapon type, in either slot", () => {
      expect(killWith("fire", ["axe", "sword"]).created).toEqual([]);
      expect(killWith("fire", ["sword", "axe"]).created).toEqual([]);
      expect(killWith("plague", ["bow", ""]).created).toEqual([]);
      expect(killWith("fire", ["sword", "bow"]).created).toHaveLength(1);
    });

    it("two mobs with different weapons killed by one empty-handed player in one pass: the lower id arms the hand, whatever order the hits were recorded in (the final review's m6)", () => {
      const outcome = (reverse: boolean, regions: [FactionId, FactionId]): { hand: string[]; loose: string[]; ids: string[] } => {
        const w = makeBare();
        const mobs = regions.map((r, i) => spawn(w, r, false, { x: P(w, 0).x + 8, y: P(w, 0).y + 12 * i }));
        const before = new Set(w.state.containers.keys());
        for (const m of reverse ? [...mobs].reverse() : mobs) strike(w, m.id, "p0", 1e6);
        pass(w);
        const created = [...w.state.containers.keys()].filter((id) => !before.has(id));
        return {
          hand: [P(w, 0).weapon0, P(w, 0).weapon1],
          loose: created.flatMap((id) => w.state.containers.get(id)!.items.map((it) => it.def)),
          ids: mobs.map((m) => m.id),
        };
      };
      for (const regions of [["fire", "plague"], ["plague", "fire"], ["holy", "frost"]] as Array<[FactionId, FactionId]>) {
        const first = mobWeapon(regions[0]);
        const second = mobWeapon(regions[1]);
        expect(first, regions.join()).not.toBe(second);
        const forward = outcome(false, regions);
        const backward = outcome(true, regions);
        expect(forward.hand, `${regions.join()} forward`).toEqual([first, ""]); // the mob placed first has the lower id
        expect(forward.loose).toEqual([second]);
        expect(backward, `${regions.join()} recorded the other way round`).toEqual({ ...forward });
      }
    });

    it("two mobs with the same weapon killed in one pass arm one and drop nothing, in either order", () => {
      for (const reverse of [false, true]) {
        const w = makeBare();
        const mobs = [spawn(w, "plague", false, { x: P(w, 0).x + 8, y: P(w, 0).y }), spawn(w, "plague", false, { x: P(w, 0).x + 8, y: P(w, 0).y + 12 })];
        const n = w.state.containers.size;
        for (const m of reverse ? [...mobs].reverse() : mobs) strike(w, m.id, "p0", 1e6);
        pass(w);
        expect([P(w, 0).weapon0, P(w, 0).weapon1], String(reverse)).toEqual(["bow", ""]);
        expect(w.state.containers.size, String(reverse)).toBe(n);
      }
    });

    it("can be picked up like any loose weapon, once it has been published", () => {
      const { w, created } = killWith("holy", ["sword", ""]);
      const id = created[0]!;
      step(w, TICK_MS);
      step(w, TICK_MS); // a drop can't be taken in the tick it appears
      expect(Math.hypot(P(w, 0).x - w.state.containers.get(id)!.x, P(w, 0).y - w.state.containers.get(id)!.y)).toBeLessThan(INTERACT_RANGE);
      expect(enqueueClientMessage(RT(w, 0).inputs, "pickup", { containerId: id })).toBe(true);
      step(w, TICK_MS);
      expect(P(w, 0).weapon0).toBe("sword");
      expect(P(w, 0).weapon1).toBe("wand");
      expect(w.state.containers.has(id)).toBe(false);
    });

    it("still drops for a mob nobody in the run hit: nobody holds the type, so the weapon lies where it fell", () => {
      const w = makeBare();
      const n = w.state.containers.size;
      const m = spawn(w, "fire");
      hurt(w, m, ["ghost", m.s.hp]);
      expect(w.state.containers.size).toBe(n + 1);
    });

    it("drops where the mob fell when its killer is gone by the time the spoils are paid", () => {
      const w = makeBare();
      const m = spawn(w, "fire");
      const n = w.state.containers.size;
      // The kill is decided in the pass; the payout runs after every victim of the pass has been settled.
      w.combat.collecting = true;
      hurt(w, m, ["p0", m.s.hp]);
      RT(w, 0).resolved = true;
      // As applyLedger does: the pass is over (a payout may call payLater again, and a status change would be queued behind it forever).
      w.combat.collecting = false;
      for (const pay of w.combat.payouts) pay();
      expect(w.state.containers.size).toBe(n + 1);
      expect(RT(w, 0).mobKills).toBe(0);
    });
  });

  it("pays GV, and the weapon lies at the mob's feet after it", () => {
    const w = makeBare();
    P(w, 0).weapon0 = "axe"; // a run starts empty-handed, which arms the killer instead (below): an armed hand leaves the drop
    const m = spawn(w, "plague"); // a bow: p0's axe is not a bow, so it is dropped
    const containers = w.state.containers.size;
    hurt(w, m, ["p0", m.s.hp]);
    expect(kindsOf(w.events)).toEqual(["fx:death", "gv", "toast"]);
    expect(w.state.containers.size).toBe(containers + 1);
  });

  it("pays an empty-handed killer in the order GV, then the weapon in its hand with a toast (nothing lies on the ground)", () => {
    const w = makeBare();
    const m = spawn(w, "plague"); // a bow
    const containers = w.state.containers.size;
    hurt(w, m, ["p0", m.s.hp]);
    expect(kindsOf(w.events)).toEqual(["fx:death", "gv", "toast", "toast"]);
    expect(w.events.at(-1)).toEqual({ type: "toast", to: "p0", text: "Armed: Bow" });
    expect(w.state.containers.size).toBe(containers);
    expect([P(w, 0).weapon0, P(w, 0).weapon1, P(w, 0).slot]).toEqual(["bow", "", 0]);
  });
});

describe("reapMobs: corpses", () => {
  it("a corpse stays MOB_CORPSE_MS, then leaves the state and the runtime map; the living stay", () => {
    const w = makeBare();
    const dead = spawn(w, "fire");
    const alive = spawn(w, "plague", false, { x: 260, y: 200 });
    const diedAt = w.state.serverTime;
    hurt(w, dead, ["p0", dead.s.hp]);
    const ticks = MOB_CORPSE_MS / TICK_MS;
    for (let i = 1; i < ticks; i++) {
      step(w, TICK_MS);
      expect(w.state.mobs.has(dead.id), `tick ${i}`).toBe(true);
      expect(w.mobs.has(dead.id)).toBe(true);
    }
    expect(w.state.serverTime - diedAt).toBe(MOB_CORPSE_MS - TICK_MS);
    step(w, TICK_MS);
    expect(w.state.serverTime - diedAt).toBe(MOB_CORPSE_MS);
    expect(w.state.mobs.has(dead.id)).toBe(false);
    expect(w.mobs.has(dead.id)).toBe(false);
    expect(w.state.mobs.has(alive.id)).toBe(true);
    expect(w.mobs.has(alive.id)).toBe(true);
  });

  it("removes every due corpse in one pass and only those, whatever their order in the map", () => {
    const w = makeBare();
    const mobs = Array.from({ length: 6 }, (_, i) => spawn(w, "fire", false, { x: 200 + 40 * i, y: 300 }));
    const diedAt = [0, 10_000, 0, 10_000, 0, 0];
    mobs.forEach((m, i) => {
      if (i === 5) return; // stays alive
      m.s.status = "dead";
      m.s.hp = 0;
      m.rt.brain!.diedAt = diedAt[i]!;
    });
    w.state.serverTime = 10_000 + MOB_CORPSE_MS - 1; // the two at 10_000 aren't due yet
    reapMobs(w, TICK_MS);
    expect(mobs.map((m) => w.state.mobs.has(m.id))).toEqual([false, true, false, true, false, true]);
    expect(mobs.map((m) => w.mobs.has(m.id))).toEqual([false, true, false, true, false, true]);
    w.state.serverTime += 1;
    reapMobs(w, TICK_MS);
    expect(mobs.map((m) => w.state.mobs.has(m.id))).toEqual([false, false, false, false, false, true]);
  });

  it("a camp's mobs are never respawned", () => {
    const w = makeRun({ seed: 1 });
    const total = w.state.mobs.size;
    for (const m of allMobs(w)) hurt(w, m, ["p0", m.s.hp]);
    for (let i = 0; i < MOB_CORPSE_MS / TICK_MS + 2; i++) step(w, TICK_MS);
    expect(total).toBeGreaterThan(0);
    expect(w.state.mobs.size).toBe(0);
    expect(w.mobs.size).toBe(0);
  });
});

describe("reapMobs: regeneration", () => {
  const perTick = (m: MobCombatant): number => (m.s.maxHp * TICK_MS) / (MOB_REGEN_SECONDS * 1000);

  /** A mob at `hp` in `mode` (walking home unless said otherwise), long after it was last hit. */
  function mobAt(w: World, hp: number, mode: "idle" | "fight" | "return" = "return", region: FactionId = "fire"): MobCombatant {
    const m = spawn(w, region);
    m.s.hp = hp;
    m.rt.brain!.mode = mode;
    m.rt.lastHitAt = 0;
    w.state.serverTime = 100_000;
    return m;
  }

  it("a mob walking home heals maxHp x dt / MOB_REGEN_SECONDS per tick, capped at maxHp", () => {
    const w = makeBare();
    const m = mobAt(w, 100);
    reapMobs(w, TICK_MS);
    expect(m.s.hp).toBeCloseTo(100 + perTick(m), 9);
    m.s.hp = m.s.maxHp - 0.5;
    reapMobs(w, TICK_MS);
    expect(m.s.hp).toBe(m.s.maxHp);
    reapMobs(w, TICK_MS);
    expect(m.s.hp).toBe(m.s.maxHp);
  });

  it("is full again after MOB_REGEN_SECONDS of walking home, not before", () => {
    const w = makeBare();
    const m = mobAt(w, 0.001 * mobFaction("fire", false).hp);
    const ticks = (MOB_REGEN_SECONDS * 1000) / TICK_MS;
    for (let i = 0; i < ticks - 1; i++) reapMobs(w, TICK_MS);
    expect(m.s.hp).toBeLessThan(m.s.maxHp);
    reapMobs(w, TICK_MS);
    expect(m.s.hp).toBe(m.s.maxHp);
  });

  it("works through the step loop: the reaper is a registered system", () => {
    const w = makeBare();
    const m = mobAt(w, 100);
    step(w, TICK_MS);
    expect(m.s.hp).toBeCloseTo(100 + perTick(m), 9);
  });

  it("heals every region's mobs alike, as a share of its own max hp", () => {
    const w = makeBare();
    for (const region of FACTION_IDS) {
      const m = mobAt(w, 1, "return", region);
      reapMobs(w, TICK_MS);
      expect(m.s.hp).toBeCloseTo(1 + perTick(m), 9);
      expect(perTick(m)).toBeCloseTo(m.s.maxHp / 80, 9);
    }
  });

  it("an idle mob below full (its attacker went down before it could wake onto them) heals once left alone for 3 s, not before", () => {
    const w = makeBare();
    const m = mobAt(w, 100, "idle");
    m.s.hp = m.s.maxHp / 2;
    m.rt.lastHitAt = w.state.serverTime;
    const hurtHp = m.s.hp;
    w.state.serverTime += 2900;
    reapMobs(w, TICK_MS);
    expect(m.s.hp).toBe(hurtHp);
    w.state.serverTime += 100;
    reapMobs(w, TICK_MS);
    expect(m.s.hp).toBeCloseTo(hurtHp + perTick(m), 9);
    for (let i = 0; i < 200; i++) reapMobs(w, TICK_MS);
    expect(m.s.hp).toBe(m.s.maxHp);
  });

  it("an idle mob at full hp stays as it is", () => {
    const w = makeBare();
    const m = mobAt(w, 100, "idle");
    w.state.serverTime += 10_000;
    for (let i = 0; i < 50; i++) reapMobs(w, TICK_MS);
    expect(m.s.hp).toBe(m.s.maxHp);
  });

  it("a fighting mob does not heal", () => {
    const w = makeBare();
    const m = mobAt(w, 100, "fight");
    for (let i = 0; i < 200; i++) reapMobs(w, TICK_MS);
    expect(m.s.hp).toBe(100);
  });

  it("a mob hurt in the field stays hurt until it starts walking home, and heals from then on", () => {
    const w = makeBare();
    const m = mobAt(w, mobFaction("fire", false).hp, "idle");
    hurt(w, m, ["p0", 50]);
    const hp = m.s.hp;
    expect(hp).toBe(m.s.maxHp - 50);
    for (let i = 0; i < 100; i++) reapMobs(w, TICK_MS);
    expect(m.s.hp).toBe(hp);
    m.rt.brain!.mode = "return";
    reapMobs(w, TICK_MS);
    expect(m.s.hp).toBeCloseTo(hp + perTick(m), 9);
  });

  it("a corpse is not healed back to life", () => {
    const w = makeBare();
    const m = mobAt(w, 100, "idle");
    hurt(w, m, ["p0", 100]);
    expect(m.s.status).toBe("dead");
    m.rt.brain!.mode = "return"; // even a corpse that somehow says it is walking home
    w.state.serverTime += 1;
    reapMobs(w, TICK_MS);
    expect(m.s.hp).toBe(0);
    expect(m.s.status).toBe("dead");
  });

  it("many mobs at once: only the ones walking home change", () => {
    const w = makeRun({ seed: 3 });
    const mobs = allMobs(w);
    mobs.forEach((m, i) => {
      m.s.hp = m.s.maxHp / 2;
      m.rt.lastHitAt = 100_000; // hit just now: a hurt idle mob is not left alone long enough to heal yet
      m.rt.brain!.mode = i % 3 === 0 ? "fight" : i % 3 === 1 ? "idle" : "return";
    });
    w.state.serverTime = 100_000;
    reapMobs(w, TICK_MS);
    expect(mobs.some((m, i) => i % 3 === 2)).toBe(true);
    mobs.forEach((m, i) => {
      if (i % 3 === 2) expect(m.s.hp).toBeCloseTo(m.s.maxHp / 2 + perTick(m), 9);
      else expect(m.s.hp).toBe(m.s.maxHp / 2);
    });
  });
});

describe("rewards are paid after the whole ledger pass", () => {
  it.each([["the mob first", true], ["the player first", false]] as const)(
    "%s in the ledger: the death shows at once, the spoils come after every victim has taken their damage", (_label, mobFirst) => {
      const w = makeBare();
      P(w, 0).weapon0 = "sword";
      const m = spawn(w, "fire");
      const containers = w.state.containers.size;
      const killMobHit = () => strike(w, m.id, "p0", 1e6);
      const woundPlayer = () => strike(w, "p1", "p0", 10);
      if (mobFirst) { killMobHit(); woundPlayer(); } else { woundPlayer(); killMobHit(); }
      pass(w);

      const kinds = kindsOf(w.events);
      const firstSpoil = kinds.findIndex((k) => k === "gv");
      expect(kinds.filter((k) => k === "fx:hit")).toHaveLength(2);
      expect(kinds.lastIndexOf("fx:hit")).toBeLessThan(firstSpoil);
      expect(kinds.indexOf("fx:death")).toBeLessThan(firstSpoil);
      expect(kinds.slice(firstSpoil)).toEqual(["gv", "toast"]);
      expect(fxOf(w.events, "death")).toEqual([{ kind: "death", id: m.id, x: m.s.x, y: m.s.y, by: "p0" }]);
      expect(RT(w, 0).gv.mobs).toBe(GV_MOB);
      expect(held(P(w, 0))).toEqual({});
      expect(w.state.containers.size).toBe(containers + 1);
      expect(w.combat.payouts).toEqual([]);
      expect(w.combat.collecting).toBe(false);
    });

  describe("the killer's feed is the one the pass started with", () => {
    /** Feeds 0 / 2 / 3 / 3: the median is 2.5, so p0 (feed 0) is in catch-up. */
    function lobby(): World {
      const w = makeBare({ players: 4 });
      [0, 2, 3, 3].forEach((kills, i) => setFeed(w, i, kills));
      return w;
    }
    const gvLine = (w: World): string[] => gvOf(w.events).map((e) => `${e.reason}:${e.amount}`).sort();

    it("p0 killing a player and an elite in one pass is paid the same whichever the ledger reached first", () => {
      const run = (mobFirst: boolean) => {
        const w = lobby();
        const elite = spawn(w, "fire", true);
        const killElite = () => strike(w, elite.id, "p0", 1e6);
        const killPlayer = () => strike(w, "p1", "p0", 1e6);
        if (mobFirst) { killElite(); killPlayer(); } else { killPlayer(); killElite(); }
        pass(w);
        return { gv: gvLine(w), cards: held(P(w, 0)), banked: RT(w, 0).gv };
      };
      const a = run(true);
      const b = run(false);
      expect(b).toEqual(a);
      // The catch-up applied to the elite (the pass started with p0 at feed 0), and the player kill did not eat into it.
      expect(a.banked.mobs).toBeGreaterThan(GV_ELITE);
      expect(a.cards).toEqual({});
    });

    it("two mob kills in one pass each read the pass's start: neither sees the other's feed", () => {
      const alone = (region: FactionId): number => {
        const w = lobby();
        credit.mockClear();
        strike(w, spawn(w, region).id, "p0", 1e6);
        pass(w);
        return paidAt()[0]!;
      };
      const both = (first: FactionId, second: FactionId): number[] => {
        const w = lobby();
        credit.mockClear();
        strike(w, spawn(w, first).id, "p0", 1e6);
        strike(w, spawn(w, second).id, "p0", 1e6);
        pass(w);
        return paidAt();
      };
      const fire = alone("fire");
      const frost = alone("frost");
      expect(fire).toBeCloseTo(mobRewardMultiplier(0, 2.5), 9); // the catch-up is on at the pass's start
      for (const [x, y] of [["fire", "frost"], ["frost", "fire"], ["fire", "fire"]] as const) {
        const paid = both(x, y);
        expect(paid, `${x} then ${y}`).toHaveLength(2);
        expect(paid[0], `${x} then ${y}`).toBeCloseTo(fire, 9);
        expect(paid[1], `${x} then ${y}`).toBeCloseTo(frost, 9); // the second kill never sees the first's feed point
      }
    });
  });

  describe("a barrier is not hp lost", () => {
    it("the damage the systems feed on (lifesteal) is only what got past the barrier", () => {
      const w = makeBare();
      P(w, 1).hp = P(w, 1).maxHp = 1e6;
      P(w, 1).barrier = 290;
      const hp = P(w, 1).hp;
      strike(w, "p1", "p0", 3000);
      pass(w);
      const lost = hp - P(w, 1).hp;
      const absorbed = 290 - P(w, 1).barrier;
      const landed = w.combat.landed.filter((l) => l.victim === "p1");
      expect(landed).toHaveLength(1);
      expect(absorbed).toBeGreaterThan(0);
      expect(landed[0]!.amount).toBeCloseTo(lost, 9);
      // The hit fx still shows the whole hit.
      expect(fxOf(w.events, "hit").find((h) => h.id === "p1")!.amount).toBeCloseTo(lost + absorbed, 9);
    });

    it("a hit that gets all the way through is whole", () => {
      const w = makeBare();
      const hp = P(w, 1).hp;
      strike(w, "p1", "p0", 20);
      pass(w);
      const landed = w.combat.landed.filter((l) => l.victim === "p1");
      expect(landed[0]!.amount).toBeCloseTo(hp - P(w, 1).hp, 9);
    });
  });

  it("a pass that throws leaves nothing behind: the next one starts with no old payouts and a fresh median", () => {
    const w = makeBare({ players: 3 });
    [0, 2, 3].forEach((kills, i) => setFeed(w, i, kills));
    const m = spawn(w, "fire");
    strike(w, m.id, "p0", 1e6);
    strike(w, "p1", "p0", 1e6); // a body to drop: the hook throws
    const dropBody = w.hooks.dropBody;
    w.hooks.dropBody = () => { throw new Error("boom"); };
    expect(() => pass(w)).toThrow("boom");
    w.hooks.dropBody = dropBody;
    expect(w.combat.collecting).toBe(false);
    w.events = [];
    const banked = { ...RT(w, 0).gv };
    // The next pass is someone else's hit entirely.
    setFeed(w, 2, 9);
    strike(w, "p2", "p1", 5);
    pass(w);
    expect(w.combat.payouts).toEqual([]);
    expect(w.combat.medianFeed).toBeNull();
    expect(RT(w, 0).gv).toEqual(banked);
    expect(gvOf(w.events)).toEqual([]);
    expect(w.combat.medianFeed).toBeNull();
  });

  it("a mob nobody collects dies in the pass with by null and queues nothing", () => {
    const w = makeBare();
    const m = spawn(w, "holy");
    strike(w, m.id, "ghost", 1e6);
    pass(w);
    expect(fxOf(w.events, "death")).toEqual([{ kind: "death", id: m.id, x: m.s.x, y: m.s.y, by: null }]);
    expect(kindsOf(w.events)).toEqual(["fx:death", "fx:hit"]);
    expect(w.combat.payouts).toEqual([]);
  });

  it("called directly, outside a pass, the spoils are paid on the spot", () => {
    const w = makeBare();
    const m = spawn(w, "fire");
    expect(w.combat.collecting).toBe(false);
    hurt(w, m, ["p0", m.s.hp]);
    expect(RT(w, 0).gv.mobs).toBe(GV_MOB);
    expect(kindsOf(w.events)).toEqual(["fx:death", "gv", "toast", "toast"]); // fixed stat progress, then armed with the axe
    const n = spawn(w, "fire");
    w.events = [];
    killMob(w, n, [entry(n.id, "p1", 4)], [4]);
    expect(RT(w, 1).gv.mobs).toBe(GV_MOB);
    expect(kindsOf(w.events)).toEqual(["fx:death", "gv", "toast", "toast"]);
  });

  describe("a killer who dies in the same pass", () => {
    /** The wound p1 deals p0 in the same pass: more than the 20 hp p0 has. */
    const WOUND = 25;

    /** p0 (hp 20, a Vitality card) kills a mob; p1 hits p0 for WOUND in the same pass. A kill pays no hp. */
    function setup(): { w: World; m: MobCombatant; held: number; maxHp: number } {
      const w = makeBare();
      grantCard(w, combatant(w, "p0") as Extract<ReturnType<typeof combatant>, { kind: "player" }>, "vitality1");
      w.events = [];
      P(w, 0).hp = 20;
      return { w, m: spawn(w, "frost", false, undefined, "iceGolem"), held: P(w, 0).build.get("vitality1")!, maxHp: P(w, 0).maxHp };
    }

    function snapshot(w: World) {
      return {
        status: P(w, 0).status,
        hp: P(w, 0).hp,
        maxHp: P(w, 0).maxHp,
        barrier: P(w, 0).barrier,
        vitality: P(w, 0).build.get("vitality1"),
        asMult: P(w, 0).asMult,
        mobGv: RT(w, 0).gv.mobs,
        mobKills: RT(w, 0).mobKills,
        killerKills: RT(w, 1).gv.kills,
      };
    }

    function run(mobFirst: boolean): { w: World; held: number; maxHp: number; carried: string; snap: ReturnType<typeof snapshot> & { added: string[] } } {
      const { w, m, held: stacks, maxHp } = setup();
      const carried = P(w, 0).weapon0; // it lies in the body once p0 is down
      const before = new Set(w.state.containers.keys());
      const kill = () => strike(w, m.id, "p0", 1e6);
      const wound = () => strike(w, "p0", "p1", WOUND);
      if (mobFirst) { kill(); wound(); } else { wound(); kill(); }
      pass(w);
      // The killer's body is a new container too; the mob's weapon is the loose one.
      const added = [...w.state.containers].filter(([id]) => !before.has(id)).map(([, c]) => `${c.kind}:${c.items.map((it) => it.def)}`);
      return { w, held: stacks, maxHp, carried, snap: { ...snapshot(w), added: added.sort() } };
    }

    it("is not saved by what the kill pays, whichever hit the ledger recorded first", () => {
      const first = run(true);
      const second = run(false);
      expect(second.snap).toEqual(first.snap);
      // Dead at once; max hp and mirrors are what they were before the pass.
      expect(first.snap).toEqual({
        status: "dead", hp: 0, maxHp: first.maxHp, barrier: 0, vitality: first.held, asMult: 1000, mobGv: GV_MOB, mobKills: 1,
        killerKills: 10, added: [`body:${first.carried}`, `ground:${mobWeapon("frost")}`].sort(),
      });
    });

    it("and their result still carries the mob GV when the tick settles", () => {
      for (const mobFirst of [true, false]) {
        const { w } = run(mobFirst);
        const events = step(w, TICK_MS);
        const result = events.flatMap((e) => (e.type === "resolved" && e.id === "p0" ? [e.result] : []))[0]!;
        expect(result).toMatchObject({ outcome: "died", killedBy: "bob", gv: { mobs: GV_MOB, total: GV_MOB } });
      }
    });
  });
});

describe("teleport", () => {
  it("resets every living regional mob, once each, and none of the dead", () => {
    const w = makeRun({ seed: 2 });
    const mobs = allMobs(w);
    const victim = mobs[0]!;
    hurt(w, victim, ["p0", victim.s.hp]);
    vi.mocked(resetMob).mockClear();
    teleportToColiseum(w);
    const reset = vi.mocked(resetMob).mock.calls.map(([world, c]) => {
      expect(world).toBe(w);
      expect(c.kind).toBe("mob");
      expect(c.s).toBe(w.state.mobs.get(c.id));
      expect(c.rt).toBe(w.mobs.get(c.id));
      return c.id;
    });
    expect(reset).toEqual(mobs.slice(1).map((m) => m.id));
    expect(reset).not.toContain(victim.id);
  });

  it("leaves a dummy alone, and is harmless in a world with no mobs", () => {
    const w = makeBare();
    addMob(w, { kind: "dummy", name: "Dummy", at: { x: 220, y: 220 } });
    teleportToColiseum(w);
    expect(resetMob).not.toHaveBeenCalled();
  });

  it("the earlier teleport hooks still run (weapons cancel their actions)", () => {
    const w = makeRun({ seed: 2 });
    RT(w, 0).weapon.held = true;
    teleportToColiseum(w);
    expect(RT(w, 0).weapon.held).toBe(false);
  });
});

describe("a mob fights as its scaled faction", () => {
  it.each(FACTION_IDS.map((f) => [f]))("%s: mob and elite use the scaled, paced faction in combat", (region) => {
    const w = makeBare();
    for (const elite of [false, true]) {
      const m = spawn(w, region, elite);
      const spec = pacedFaction(mobFaction(region, elite));
      expect(factionOf(m.s)).toEqual(spec);
      expect(defenseOf(m.s)).toEqual({ armor: spec.armor, shield: spec.shield });
      expect(m.s.maxHp).toBe(mobFaction(region, elite).hp);
    }
    const mob = factionOf(spawn(w, region, false).s)!;
    const elite = factionOf(spawn(w, region, true).s)!;
    expect(elite.hit).toBeGreaterThan(mob.hit);
    expect(elite.hp).toBeGreaterThan(mob.hp);
  });

  it("a player of the same faction is not scaled", () => {
    const w = makeBare();
    const m = spawn(w, "fire");
    expect(factionOf(P(w, 0))!.hit).toBeGreaterThan(factionOf(m.s)!.hit);
  });
});

describe("full run through the step loop", () => {
  it("the whole life: spawn at the run start, take a lethal ledger hit, pay, lie there, go", () => {
    const w = makeRun({ seed: 100 });
    const m = allMobs(w).find((x) => x.s.kind === "elite")!;
    const before = w.state.mobs.size;
    recordHit(w, { victim: m.id, by: { id: "p0", name: "alice" }, packet: { raw: 1e6, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false });
    applyLedger(w);
    expect(m.s.status).toBe("dead");
    expect(RT(w, 0).gv.mobs).toBe(GV_ELITE);
    expect(P(w, 0).mobKills).toBe(1);
    // The elite's own type (the roster's elite of its zone); the kill gave GV, no card.
    expect(mobTypeById(m.s.type)!.elite).toBe(true);
    expect(held(P(w, 0))).toEqual({});
    for (let i = 0; i < MOB_CORPSE_MS / TICK_MS; i++) step(w, TICK_MS);
    expect(w.state.mobs.size).toBe(before - 1);
    expect(w.state.mobs.has(m.id)).toBe(false);
    expect(w.state.phase).toBe("active");
  });

  it("a map's tile size is what the camps assume", () => {
    // Guard for the fixtures above: spawn spots are tile centres, so the interaction test's +8 offset stays in its tile.
    const w = makeBare();
    expect(P(w, 0).x % TILE).toBe(TILE / 2);
    expect(P(w, 0).y % TILE).toBe(TILE / 2);
  });
});

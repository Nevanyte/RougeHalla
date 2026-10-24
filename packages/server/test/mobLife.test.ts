// A regional mob's life (sim/mobLife.ts): camp spawning, damage taken, death and its rewards, corpses, regeneration and
// the teleport reset. The AI (mobAI.ts) is another module's job: it is replaced here by spies, so nothing below says
// anything about how a mob fights, only about what happens to it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUFF_STATS, buffMultiplier, ELITE_BUFF_STACKS, FACTION_IDS, GV_ELITE, GV_MOB, GV_MOB_CAP, INTERACT_RANGE, mapFromTiles,
  MOB_BUFF_STACKS, MOB_CORPSE_MS, MOB_REGEN_SECONDS, MOB_REPATH_MS, mobBuffStacks, mobFaction, mobName, mobRewardMultiplier, mobWeapon,
  mitigateShares, mulberry32, pacedFaction, REGION_BUFF, REGION_WEAPONS, rewardCurve, rollBuffStat, TICK_MS, TILE, WEAPONS,
  type BuffStat, type FactionId, type FxEvent, type Vec2,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { teleportToColiseum } from "../src/sim/arena";
import { stacksOf } from "../src/sim/buffs";
import { combatant, defenseOf, factionOf } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { aggro, resetMob } from "../src/sim/mobAI";
import {
  hurtMob, install, killMob, placeMob, reapMobs, spawnRegionalMobs, type MobCombatant,
} from "../src/sim/mobLife";
import { addMob } from "../src/sim/mobs";
import { addPlayer, step } from "../src/sim/step";
import { createWorld, type LedgerEntry, type SimConfig, type SimEvent, type World } from "../src/sim/world";

vi.mock("../src/sim/mobAI", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/sim/mobAI")>()),
  aggro: vi.fn(),
  resetMob: vi.fn(),
  install: () => {},
}));

beforeEach(() => {
  vi.mocked(aggro).mockClear();
  vi.mocked(resetMob).mockClear();
});

const NAMES = ["alice", "bob", "carol", "dave"];
const SEEDS = [1, 2, 3, 100, 732];
/** mobLife.ts keeps this one private: a mob hit within this long does not heal. */
const REGEN_QUIET_MS = 2000;

interface WorldOpts { seed?: number; players?: number; mobs?: boolean; random?: () => number }

/** A game world in the lobby: `players` seats (p0 alice, p1 bob, ...), mobs on or off. */
function makeLobby(o: WorldOpts = {}): World {
  const seed = o.seed ?? 1234;
  const players = o.players ?? 2;
  const config: SimConfig = {
    minPlayers: players, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 60,
    mobs: o.mobs ?? true,
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

function spawn(w: World, region: FactionId = "fire", elite = false, at: Vec2 = { x: 200, y: 200 }): MobCombatant {
  return mobOf(w, placeMob(w, { region, elite, at, facing: 0 }));
}

const entry = (victim: string, by: string, raw: number): LedgerEntry => ({
  victim, by: { id: by, name: by }, packet: { raw, phys: 1, magic: 0, true: 0 }, weapon: "sword", scale: 1, stagger: false,
});

/** hurtMob with already-mitigated `[attacker id, amount]` hits. */
function hurt(w: World, m: MobCombatant, ...hits: Array<[string, number]>): number {
  return hurtMob(w, m, hits.map((h) => h[1]), hits.map((h) => entry(m.id, h[0], h[1])));
}

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

describe("spawnRegionalMobs", () => {
  it.each(SEEDS)("seed %i: one mob per camp spot, in map order, with the camp's weapon, faction, name and hp", (seed) => {
    const w = makeRun({ seed });
    const expected = w.map.regions.flatMap((r) => r.mobCamps.flatMap((camp) =>
      camp.spots.map((spot, i) => ({ camp, spot, elite: camp.elite && i === 0 }))));
    expect(expected.length).toBeGreaterThan(0);
    expect(w.state.mobs.size).toBe(expected.length);
    expect([...w.mobs.keys()]).toEqual([...w.state.mobs.keys()]);

    const mobs = allMobs(w);
    expected.forEach(({ camp, spot, elite }, i) => {
      const { s, rt } = mobs[i]!;
      const hp = mobFaction(camp.region, elite).hp;
      expect(s.kind).toBe(elite ? "elite" : "mob");
      expect(s.name).toBe(mobName(camp.region, elite));
      expect(s.faction).toBe(camp.region);
      expect(s.weapon0).toBe(camp.weapon);
      expect(s.weapon0).toBe(REGION_WEAPONS[camp.region]);
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

  it.each(SEEDS)("seed %i: exactly one elite per region, the first spot of the elite camp; its camp-mates are normal mobs", (seed) => {
    const w = makeRun({ seed });
    for (const region of w.map.regions) {
      const mine = allMobs(w).filter((m) => m.rt.brain!.region === region.id);
      const elites = mine.filter((m) => m.s.kind === "elite");
      expect(elites, region.id).toHaveLength(1);
      const eliteCamp = region.mobCamps.filter((c) => c.elite);
      expect(eliteCamp).toHaveLength(1);
      expect({ x: elites[0]!.s.x, y: elites[0]!.s.y }).toEqual(eliteCamp[0]!.spots[0]);
      expect(elites[0]!.s.hp).toBe(mobFaction(region.id, true).hp);
      expect(elites[0]!.s.hp).toBeGreaterThan(mobFaction(region.id, false).hp);
      for (const spot of eliteCamp[0]!.spots.slice(1)) {
        const mate = mine.find((m) => m.s.x === spot.x && m.s.y === spot.y)!;
        expect(mate.s.kind).toBe("mob");
        expect(mate.s.maxHp).toBe(mobFaction(region.id, false).hp);
      }
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

  it("is a no-op on a map without regions (a hand-built map)", () => {
    const w = makeBare();
    w.map = mapFromTiles(8, 8, new Uint8Array(64));
    spawnRegionalMobs(w);
    expect(w.state.mobs.size).toBe(0);
    expect(w.mobs.size).toBe(0);
    const generated = makeLobby({ seed: 1 });
    generated.map = { ...generated.map, regions: [] };
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
    m.rt.weapon.releasePending = true;
    m.rt.weapon.action = { kind: "draw", weapon: "bow", startedAt: 8900 };
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
    expect(m.rt.weapon.releasePending).toBe(false);
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

  it("a mob nobody still in the fight hit just falls: no GV, no feed, no buff, no drop, no random roll", () => {
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
    expect(w.state.containers.size).toBe(containers);
    for (const i of [0, 1]) {
      expect(RT(w, i).mobKills).toBe(0);
      expect(RT(w, i).gv.mobs).toBe(0);
      expect(stacksOf(P(w, i))).toEqual({ hp: 0, attackSpeed: 0, moveSpeed: 0 });
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
  it("the largest hit in the ledger pass, whatever its position in it", () => {
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

  it("a tie goes to the earlier entry", () => {
    const w = makeBare({ players: 3 });
    const m = spawn(w, "plague");
    const half = m.s.hp / 2;
    hurt(w, m, ["p2", half], ["p0", half]);
    expect(fxOf(w.events, "death")[0]!.by).toBe("p2");
    expect(RT(w, 2).mobKills).toBe(1);
    expect(RT(w, 0).mobKills).toBe(0);
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
    expect(stacksOf(P(w, 0))).toEqual({ hp: 0, attackSpeed: 0, moveSpeed: 0 });
  });

  it("the biggest hitter is skipped when they're no longer in the fight: the next largest collects", () => {
    const w = makeBare({ players: 3 });
    const m = spawn(w, "frost");
    RT(w, 0).down = { outcome: "died" }; // went down earlier in this very ledger pass
    P(w, 0).status = "dead";
    hurt(w, m, ["p0", 3 * m.s.hp], ["p1", 100], ["p2", m.s.hp]);
    expect(fxOf(w.events, "death")[0]!.by).toBe("p2");
    const n = spawn(w, "frost");
    RT(w, 2).resolved = true;
    w.events = [];
    hurt(w, n, ["p0", 3 * n.s.hp], ["p2", 2 * n.s.hp], ["p1", n.s.hp]);
    expect(fxOf(w.events, "death")[0]!.by).toBe("p1");
    expect(RT(w, 1).mobKills).toBe(1);
  });

  it("a hitter whose runtime is already down is skipped even before their status flips", () => {
    const w = makeBare();
    const m = spawn(w, "frost");
    RT(w, 0).down = { outcome: "died" };
    hurt(w, m, ["p0", 2 * m.s.hp], ["p1", m.s.hp]);
    expect(fxOf(w.events, "death")[0]!.by).toBe("p1");
    expect(RT(w, 0).mobKills).toBe(0);
  });

  it("pays nobody when the only hitters are dead, resolved, or gone", () => {
    const w = makeBare({ players: 3 });
    P(w, 0).status = "dead";
    RT(w, 1).resolved = true;
    const m = spawn(w, "fire");
    hurt(w, m, ["p0", 2 * m.s.hp], ["p1", 2 * m.s.hp], ["nobody", m.s.hp]);
    expect(m.s.status).toBe("dead");
    expect(fxOf(w.events, "death")[0]!.by).toBeNull();
    expect(gvOf(w.events)).toEqual([]);
    expect(RT(w, 0).mobKills + RT(w, 1).mobKills).toBe(0);
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

  it("the mob counts toward the feed and the bounty afterwards, not toward player kills", () => {
    const w = makeBare();
    for (let i = 0; i < 4; i++) {
      const m = spawn(w, "plague");
      hurt(w, m, ["p0", m.s.hp]);
    }
    expect(RT(w, 0).mobKills).toBe(4);
    expect(P(w, 0).mobKills).toBe(4);
    expect(P(w, 0).kills).toBe(0);
    expect(P(w, 0).bounty).toBe(0); // a feed of 1
    setFeed(w, 0, 3, 4);
    const m = spawn(w, "plague");
    hurt(w, m, ["p0", m.s.hp]);
    expect(RT(w, 0).mobKills).toBe(5);
    expect(P(w, 0).bounty).toBeGreaterThan(0); // a feed of 4.25
  });

  it("GV falls for a high-feed killer (feed 8) and the buff drop shrinks with it", () => {
    const w = makeBare();
    setFeed(w, 0, 8);
    w.random = () => 0.1;
    const m = spawn(w, "fire", true);
    const mult = mobRewardMultiplier(8, 4);
    expect(mult).toBeCloseTo(0.383, 3);
    hurt(w, m, ["p0", m.s.hp]);
    expect(RT(w, 0).gv.mobs).toBe(Math.round(GV_ELITE * mult));
    expect(RT(w, 0).gv.mobs).toBe(4);
    expect(stacksOf(P(w, 0)).attackSpeed).toBeCloseTo(ELITE_BUFF_STACKS * mult, 9);
    const n = spawn(w, "fire");
    const before = RT(w, 0).gv.mobs;
    hurt(w, n, ["p0", n.s.hp]);
    expect(RT(w, 0).gv.mobs - before).toBe(1); // round(0.77): less than the base 2
  });

  it("GV rises for a catch-up killer (feed more than 2 under the lobby median): x1.25 on top of the curve", () => {
    const w = makeBare({ players: 3 });
    setFeed(w, 1, 5);
    setFeed(w, 2, 5);
    w.random = () => 0.1;
    const mult = mobRewardMultiplier(0, 5);
    expect(mult).toBeCloseTo(rewardCurve(0) * 1.25, 12);
    const m = spawn(w, "holy", true);
    hurt(w, m, ["p0", m.s.hp]);
    expect(RT(w, 0).gv.mobs).toBe(Math.round(GV_ELITE * mult));
    expect(RT(w, 0).gv.mobs).toBe(12);
    expect(stacksOf(P(w, 0)).attackSpeed).toBeCloseTo(ELITE_BUFF_STACKS * mult, 9);
    const n = spawn(w, "holy");
    hurt(w, n, ["p0", n.s.hp]);
    // The elite kill is now a quarter of a feed point, still far enough under the median of 5 for the catch-up.
    expect(stacksOf(P(w, 0)).attackSpeed).toBeCloseTo(ELITE_BUFF_STACKS * mult + MOB_BUFF_STACKS * mobRewardMultiplier(0.25, 5), 9);
    expect(stacksOf(P(w, 0)).attackSpeed).toBeGreaterThan(ELITE_BUFF_STACKS + MOB_BUFF_STACKS);
  });

  it("reads the reward before the kill is counted: a kill that lifts the killer out of catch-up still pays it", () => {
    const w = makeBare({ players: 3 });
    setFeed(w, 0, 2, 3); // feed 2.75: under 5 - 2; the kill makes it exactly 3, which would no longer qualify
    setFeed(w, 1, 5);
    setFeed(w, 2, 5);
    w.random = () => 0.1;
    const before = mobRewardMultiplier(2.75, 5);
    const after = mobRewardMultiplier(3, 5);
    expect(Math.round(GV_ELITE * before)).not.toBe(Math.round(GV_ELITE * after));
    const m = spawn(w, "sentenced", true);
    hurt(w, m, ["p0", m.s.hp]);
    expect(RT(w, 0).gv.mobs).toBe(Math.round(GV_ELITE * before));
    expect(stacksOf(P(w, 0)).moveSpeed).toBeCloseTo(ELITE_BUFF_STACKS * before, 9);
  });

  it("GV_MOB_CAP caps the GV and nothing else: the kill still counts, still drops a buff and a weapon", () => {
    const w = makeBare();
    w.random = () => 0.1;
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
    expect(fxOf(w.events, "buff")).toHaveLength(1);
    expect(w.state.containers.size).toBe(containers + 1);
  });

  describe("the buff drop", () => {
    it("rolls one stat per kill from the region, with the world's random, and grants mobBuffStacks x the reward", () => {
      for (const region of FACTION_IDS) {
        for (const elite of [false, true]) {
          const w = makeBare();
          const random = vi.fn(() => 0.1); // under MOB_PRIMARY_BUFF_SHARE: the region's own stat
          w.random = random;
          const m = spawn(w, region, elite);
          hurt(w, m, ["p0", m.s.hp]);
          expect(random).toHaveBeenCalledTimes(1);
          const stat = REGION_BUFF[region];
          const amount = mobBuffStacks(elite) * mobRewardMultiplier(0, 0);
          expect(elite ? amount / mobRewardMultiplier(0, 0) : amount / mobRewardMultiplier(0, 0)).toBe(elite ? 2 : 1);
          const held = stacksOf(P(w, 0));
          for (const s of BUFF_STATS) expect(held[s], `${region} ${s}`).toBeCloseTo(s === stat ? amount : 0, 9);
          expect(fxOf(w.events, "buff")).toEqual([{ kind: "buff", id: "p0", stat, stacks: amount, total: amount }]);
        }
      }
    });

    it("a high roll is one of the region's other two stats", () => {
      const cases: Array<[FactionId, number, BuffStat]> = [
        ["fire", 0.65, "hp"], ["fire", 0.9, "moveSpeed"], ["plague", 0.65, "attackSpeed"], ["plague", 0.99, "moveSpeed"],
        ["sentenced", 0.65, "hp"], ["sentenced", 0.9, "attackSpeed"],
      ];
      for (const [region, roll, stat] of cases) {
        expect(rollBuffStat(region, () => roll)).toBe(stat);
        const w = makeBare();
        w.random = () => roll;
        const m = spawn(w, region);
        hurt(w, m, ["p0", m.s.hp]);
        expect(fxOf(w.events, "buff").map((fx) => fx.stat), `${region} ${roll}`).toEqual([stat]);
        expect(stacksOf(P(w, 0))[stat]).toBeCloseTo(mobRewardMultiplier(0, 0), 9);
      }
    });

    it("an hp drop raises max hp with it", () => {
      const w = makeBare();
      w.random = () => 0.1;
      const m = spawn(w, "plague");
      const hp = P(w, 0).hp;
      const max = P(w, 0).maxHp;
      hurt(w, m, ["p0", m.s.hp]);
      expect(P(w, 0).maxHp).toBeCloseTo(max * buffMultiplier("hp", mobRewardMultiplier(0, 0)), 9);
      expect(P(w, 0).hp).toBeGreaterThan(hp);
    });
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

    it("is not dropped when the killer already holds that weapon type, in either slot", () => {
      expect(killWith("fire", ["axe", "sword"]).created).toEqual([]);
      expect(killWith("fire", ["sword", "axe"]).created).toEqual([]);
      expect(killWith("plague", ["bow", ""]).created).toEqual([]);
      expect(killWith("fire", ["sword", "bow"]).created).toHaveLength(1);
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

    it("is never dropped for a mob nobody collects", () => {
      const w = makeBare();
      const n = w.state.containers.size;
      const m = spawn(w, "fire");
      hurt(w, m, ["ghost", m.s.hp]);
      expect(w.state.containers.size).toBe(n);
    });
  });

  it("pays in the order GV, buff, combos: the GV event, then the buff, then the tier and the proc of a combo it completes", () => {
    const w = makeBare();
    w.random = () => 0.1;
    P(w, 0).stacksAs = 2.5; // a fire drop is attack speed; one more stack makes three
    const m = spawn(w, "fire");
    hurt(w, m, ["p0", m.s.hp]);
    const kinds = w.events.map((e) => (e.type === "fx" ? `fx:${e.fx.kind}` : e.type));
    expect(kinds).toEqual(["fx:death", "gv", "fx:buff", "fx:combo", "fx:combo"]);
    expect(fxOf(w.events, "combo")).toEqual([
      { kind: "combo", id: "p0", combo: "dash", proc: false },
      { kind: "combo", id: "p0", combo: "dash", proc: true },
    ]);
  });

  describe("kill combos fire on a mob kill", () => {
    it("3 attack-speed stacks: a dash", () => {
      const w = makeBare();
      w.random = () => 0.1;
      P(w, 0).stacksAs = 2.5;
      w.state.serverTime = 7000;
      const m = spawn(w, "fire");
      hurt(w, m, ["p0", m.s.hp]);
      expect(stacksOf(P(w, 0)).attackSpeed).toBeGreaterThanOrEqual(3);
      expect(RT(w, 0).boost!.bursts).toEqual([{ mult: 2.5, until: 7400 }]);
    });

    it("3 hp stacks: a kill shield worth 15% of the new max hp", () => {
      const w = makeBare();
      w.random = () => 0.1;
      P(w, 0).stacksHp = 2.5;
      w.state.serverTime = 7000;
      const m = spawn(w, "plague");
      hurt(w, m, ["p0", m.s.hp]);
      expect(P(w, 0).shield).toBeCloseTo(0.15 * P(w, 0).maxHp, 9);
      expect(RT(w, 0).boost!.shieldUntil).toBe(12000);
    });

    it("the kill that completes the combo counts: the drop is granted before the combos run", () => {
      const w = makeBare();
      w.random = () => 0.1;
      P(w, 0).stacksMs = 2.5;
      const m = spawn(w, "sentenced");
      hurt(w, m, ["p0", m.s.hp]);
      expect(RT(w, 0).boost!.bursts.map((b) => b.mult)).toEqual([1.5]);
    });

    it("no combo, no boost", () => {
      const w = makeBare();
      const m = spawn(w, "fire");
      hurt(w, m, ["p0", m.s.hp]);
      expect(RT(w, 0).boost).toBeUndefined();
      expect(fxOf(w.events, "combo")).toEqual([]);
    });
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
  /** A mob at `hp` that was last hit long ago, in `mode`, at a server time well past the quiet window. */
  function hurtMobAt(w: World, hp: number, mode: "idle" | "fight" | "return" = "idle", region: FactionId = "fire"): MobCombatant {
    const m = spawn(w, region);
    m.s.hp = hp;
    m.rt.brain!.mode = mode;
    m.rt.lastHitAt = 0;
    w.state.serverTime = 100_000;
    return m;
  }

  it("an idle mob heals maxHp x dt / MOB_REGEN_SECONDS per tick, capped at maxHp", () => {
    const w = makeBare();
    const m = hurtMobAt(w, 100);
    reapMobs(w, TICK_MS);
    expect(m.s.hp).toBeCloseTo(100 + (m.s.maxHp * TICK_MS) / (MOB_REGEN_SECONDS * 1000), 9);
    m.s.hp = m.s.maxHp - 0.5;
    reapMobs(w, TICK_MS);
    expect(m.s.hp).toBe(m.s.maxHp);
    reapMobs(w, TICK_MS);
    expect(m.s.hp).toBe(m.s.maxHp);
  });

  it("is full again after MOB_REGEN_SECONDS, not before", () => {
    const w = makeBare();
    const m = hurtMobAt(w, 0.001 * mobFaction("fire", false).hp);
    const ticks = (MOB_REGEN_SECONDS * 1000) / TICK_MS;
    for (let i = 0; i < ticks - 1; i++) reapMobs(w, TICK_MS);
    expect(m.s.hp).toBeLessThan(m.s.maxHp);
    reapMobs(w, TICK_MS);
    expect(m.s.hp).toBe(m.s.maxHp);
  });

  it("works through the step loop: the reaper is a registered system", () => {
    const w = makeBare();
    const m = hurtMobAt(w, 100);
    m.rt.lastHitAt = -10_000;
    step(w, TICK_MS);
    expect(m.s.hp).toBeGreaterThan(100);
  });

  it("a mob heading home heals the same", () => {
    const w = makeBare();
    const m = hurtMobAt(w, 100, "return", "plague");
    reapMobs(w, TICK_MS);
    expect(m.s.hp).toBeCloseTo(100 + (m.s.maxHp * TICK_MS) / (MOB_REGEN_SECONDS * 1000), 9);
  });

  it("a fighting mob does not heal", () => {
    const w = makeBare();
    const m = hurtMobAt(w, 100, "fight");
    for (let i = 0; i < 40; i++) reapMobs(w, TICK_MS);
    expect(m.s.hp).toBe(100);
  });

  it("a mob hit within the last 2 s does not heal; at exactly 2 s it does", () => {
    const w = makeBare();
    const m = hurtMobAt(w, 100);
    m.rt.lastHitAt = w.state.serverTime - (REGEN_QUIET_MS - 1);
    reapMobs(w, TICK_MS);
    expect(m.s.hp).toBe(100);
    m.rt.lastHitAt = w.state.serverTime - REGEN_QUIET_MS;
    reapMobs(w, TICK_MS);
    expect(m.s.hp).toBeGreaterThan(100);
  });

  it("hurtMob starts the quiet window", () => {
    const w = makeBare();
    const m = hurtMobAt(w, mobFaction("fire", false).hp);
    hurt(w, m, ["p0", 50]);
    const hp = m.s.hp;
    w.state.serverTime += REGEN_QUIET_MS - 1;
    reapMobs(w, TICK_MS);
    expect(m.s.hp).toBe(hp);
    w.state.serverTime += 1;
    reapMobs(w, TICK_MS);
    expect(m.s.hp).toBeGreaterThan(hp);
  });

  it("a corpse is not healed back to life", () => {
    const w = makeBare();
    const m = hurtMobAt(w, 100);
    hurt(w, m, ["p0", 100]);
    expect(m.s.status).toBe("dead");
    w.state.serverTime += 1;
    reapMobs(w, TICK_MS);
    expect(m.s.hp).toBe(0);
    expect(m.s.status).toBe("dead");
  });

  it("many mobs at once: only the ones that qualify change", () => {
    const w = makeRun({ seed: 3 });
    const mobs = allMobs(w);
    mobs.forEach((m, i) => {
      m.s.hp = m.s.maxHp / 2;
      m.rt.lastHitAt = 0;
      m.rt.brain!.mode = i % 3 === 0 ? "fight" : i % 3 === 1 ? "idle" : "return";
    });
    w.state.serverTime = 100_000;
    reapMobs(w, TICK_MS);
    mobs.forEach((m, i) => {
      if (i % 3 === 0) expect(m.s.hp).toBe(m.s.maxHp / 2);
      else expect(m.s.hp).toBeGreaterThan(m.s.maxHp / 2);
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
    w.random = () => 0.1;
    recordHit(w, { victim: m.id, by: { id: "p0", name: "alice" }, packet: { raw: 1e6, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false });
    applyLedger(w);
    expect(m.s.status).toBe("dead");
    expect(RT(w, 0).gv.mobs).toBe(GV_ELITE);
    expect(P(w, 0).mobKills).toBe(1);
    expect(stacksOf(P(w, 0))[REGION_BUFF[m.s.faction as FactionId]]).toBeGreaterThan(1.9);
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

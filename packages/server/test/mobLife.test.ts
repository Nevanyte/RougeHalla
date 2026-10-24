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
import { createWorld, tieRank, type LedgerEntry, type SimConfig, type SimEvent, type World } from "../src/sim/world";

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

  it("a mob nobody still in the fight hit just falls: no GV, no feed, no buff, no random roll, and its weapon lies where it fell", () => {
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
    expect(stacksOf(P(w, 0))).toEqual({ hp: 0, attackSpeed: 0, moveSpeed: 0 });
  });

  it("a player who is dead or down in the same pass still collects the GV and the feed, and the weapon drops; stacks and combos need a living player", () => {
    const w = makeBare({ players: 3 });
    w.random = () => 0.1;
    P(w, 0).stacksAs = 2.5; // would complete the dash if the drop and the combos could reach them
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
    expect(stacksOf(P(w, 0)).attackSpeed).toBe(2.5);
    expect(fxOf(w.events, "buff")).toEqual([]);
    expect(fxOf(w.events, "combo")).toEqual([]);
    expect(RT(w, 0).boost).toBeUndefined();
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
    w.random = () => 0.1;
    const stacks: number[] = [];
    for (let i = 0; i < 4; i++) {
      const m = spawn(w, "plague");
      w.events = [];
      hurt(w, m, ["p0", m.s.hp]);
      stacks.push(fxOf(w.events, "buff")[0]!.stacks);
      expect(fxOf(w.events, "bounty")).toEqual([]);
    }
    expect(RT(w, 0).mobKills).toBe(4);
    expect(P(w, 0).mobKills).toBe(4);
    expect(P(w, 0).kills).toBe(0);
    expect(P(w, 0).bounty).toBe(0);
    // Each kill was paid at the feed the ones before it left: a quarter point more each time, the lobby median half of that.
    stacks.forEach((got, i) => expect(got).toBeCloseTo(MOB_BUFF_STACKS * mobRewardMultiplier(0.25 * i, 0.125 * i), 9));
    for (let i = 1; i < stacks.length; i++) expect(stacks[i]!).toBeLessThan(stacks[i - 1]!);

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
    expect(fxOf(w.events, "buff")[0]!.stacks).toBeCloseTo(MOB_BUFF_STACKS * mobRewardMultiplier(100, 50), 9);
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
          expect(amount / mobRewardMultiplier(0, 0)).toBeCloseTo(elite ? ELITE_BUFF_STACKS : MOB_BUFF_STACKS, 12);
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
        expect(stacksOf(P(w, 0))[stat]).toBeCloseTo(MOB_BUFF_STACKS * mobRewardMultiplier(0, 0), 9);
      }
    });

    it("an hp drop raises max hp with it", () => {
      const w = makeBare();
      w.random = () => 0.1;
      const m = spawn(w, "plague");
      const hp = P(w, 0).hp;
      const max = P(w, 0).maxHp;
      hurt(w, m, ["p0", m.s.hp]);
      expect(P(w, 0).maxHp).toBeCloseTo(max * buffMultiplier("hp", MOB_BUFF_STACKS * mobRewardMultiplier(0, 0)), 9);
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
      for (const pay of w.combat.payouts) pay();
      expect(w.state.containers.size).toBe(n + 1);
      expect(RT(w, 0).mobKills).toBe(0);
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
      expect(P(w, 0).barrier).toBeCloseTo(0.15 * P(w, 0).maxHp, 9);
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
      w.random = () => 0.1;
      P(w, 0).stacksAs = 2.5; // the drop completes the dash, so the combo events are in the pass too
      P(w, 0).weapon0 = "sword";
      const m = spawn(w, "fire");
      const containers = w.state.containers.size;
      const killMobHit = () => strike(w, m.id, "p0", 1e6);
      const woundPlayer = () => strike(w, "p1", "p0", 10);
      if (mobFirst) { killMobHit(); woundPlayer(); } else { woundPlayer(); killMobHit(); }
      pass(w);

      const kinds = kindsOf(w.events);
      const firstSpoil = kinds.findIndex((k) => k === "gv" || k === "fx:buff" || k === "fx:combo");
      expect(kinds.filter((k) => k === "fx:hit")).toHaveLength(2);
      expect(kinds.lastIndexOf("fx:hit")).toBeLessThan(firstSpoil);
      expect(kinds.indexOf("fx:death")).toBeLessThan(firstSpoil);
      expect(kinds.slice(firstSpoil)).toEqual(["gv", "fx:buff", "fx:combo", "fx:combo"]);
      expect(fxOf(w.events, "death")).toEqual([{ kind: "death", id: m.id, x: m.s.x, y: m.s.y, by: "p0" }]);
      expect(RT(w, 0).gv.mobs).toBe(GV_MOB);
      expect(stacksOf(P(w, 0)).attackSpeed).toBeGreaterThanOrEqual(3);
      expect(RT(w, 0).boost!.bursts).toHaveLength(1);
      expect(w.state.containers.size).toBe(containers + 1);
      expect(w.combat.payouts).toEqual([]);
      expect(w.combat.collecting).toBe(false);
    });

  describe("the killer's feed is the one the pass started with", () => {
    /** Feeds 0 / 2 / 3 / 3: the median is 2.5, so p0 (feed 0) is in catch-up. */
    function lobby(): World {
      const w = makeBare({ players: 4 });
      w.random = () => 0.1;
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
        return { gv: gvLine(w), stacks: stacksOf(P(w, 0)), banked: RT(w, 0).gv };
      };
      const a = run(true);
      const b = run(false);
      expect(b).toEqual(a);
      // The catch-up applied to the elite (the pass started with p0 at feed 0), and the player kill did not eat into it.
      expect(a.banked.mobs).toBeGreaterThan(GV_ELITE);
      expect(a.stacks.attackSpeed + a.stacks.hp + a.stacks.moveSpeed).toBeGreaterThan(ELITE_BUFF_STACKS);
    });

    it("two mob kills in one pass each read the pass's start: neither sees the other's feed", () => {
      const alone = (region: FactionId) => {
        const w = lobby();
        strike(w, spawn(w, region).id, "p0", 1e6);
        pass(w);
        return stacksOf(P(w, 0));
      };
      const both = (first: FactionId, second: FactionId) => {
        const w = lobby();
        strike(w, spawn(w, first).id, "p0", 1e6);
        strike(w, spawn(w, second).id, "p0", 1e6);
        pass(w);
        return stacksOf(P(w, 0));
      };
      const fire = alone("fire");
      const frost = alone("frost");
      const sum = { hp: fire.hp + frost.hp, attackSpeed: fire.attackSpeed + frost.attackSpeed, moveSpeed: fire.moveSpeed + frost.moveSpeed };
      for (const [x, y] of [["fire", "frost"], ["frost", "fire"]] as const) {
        const s = both(x, y);
        expect(s.hp).toBeCloseTo(sum.hp, 9);
        expect(s.attackSpeed).toBeCloseTo(sum.attackSpeed, 9);
        expect(s.moveSpeed).toBeCloseTo(sum.moveSpeed, 9);
      }
    });
  });

  describe("a kill barrier is not hp lost", () => {
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
    expect(kindsOf(w.events)).toEqual(["fx:death", "gv", "fx:buff"]);
    const n = spawn(w, "fire");
    w.events = [];
    killMob(w, n, [entry(n.id, "p1", 4)], [4]);
    expect(RT(w, 1).gv.mobs).toBe(GV_MOB);
    expect(kindsOf(w.events)).toEqual(["fx:death", "gv", "fx:buff"]);
  });

  describe("a killer who dies in the same pass", () => {
    /** p0 (hp 20, 2.5 hp stacks) kills a plague mob; p1 hits p0 for 60 in the same pass. The spoils would heal and shield them. */
    function setup(): { w: World; m: MobCombatant } {
      const w = makeBare();
      w.random = () => 0.1; // a plague mob's own stat: hp
      P(w, 0).stacksHp = 2.5;
      P(w, 0).hp = 20;
      return { w, m: spawn(w, "plague") };
    }

    function snapshot(w: World) {
      return {
        status: P(w, 0).status,
        hp: P(w, 0).hp,
        maxHp: P(w, 0).maxHp,
        barrier: P(w, 0).barrier,
        stacksHp: P(w, 0).stacksHp,
        boosted: RT(w, 0).boost !== undefined,
        mobGv: RT(w, 0).gv.mobs,
        mobKills: RT(w, 0).mobKills,
        buffFx: fxOf(w.events, "buff").length,
        comboFx: fxOf(w.events, "combo").length,
        killerKills: RT(w, 1).gv.kills,
      };
    }

    function run(mobFirst: boolean): { w: World; snap: ReturnType<typeof snapshot> & { added: string[] } } {
      const { w, m } = setup();
      const before = new Set(w.state.containers.keys());
      const kill = () => strike(w, m.id, "p0", 1e6);
      const wound = () => strike(w, "p0", "p1", 60);
      if (mobFirst) { kill(); wound(); } else { wound(); kill(); }
      pass(w);
      // The killer's body is a new container too; the mob's weapon is the loose one.
      const added = [...w.state.containers].filter(([id]) => !before.has(id)).map(([, c]) => `${c.kind}:${c.items.map((it) => it.def)}`);
      return { w, snap: { ...snapshot(w), added: added.sort() } };
    }

    it("is not saved by what the kill pays, whichever hit the ledger recorded first", () => {
      const first = run(true);
      const second = run(false);
      expect(second.snap).toEqual(first.snap);
      expect(first.snap).toEqual({
        status: "dead", hp: 0, maxHp: 500, barrier: 0, stacksHp: 2.5, boosted: false, mobGv: GV_MOB, mobKills: 1,
        buffFx: 0, comboFx: 0, killerKills: 10, added: ["body:axe", "ground:bow"],
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

    it("control: had the spoils been paid before the wound, the same wound would not have killed them", () => {
      const { w, m } = setup();
      hurt(w, m, ["p0", m.s.hp]); // outside a pass: paid on the spot
      expect(P(w, 0).barrier).toBeGreaterThan(0);
      expect(P(w, 0).hp).toBeGreaterThan(60);
      strike(w, "p0", "p1", 60);
      pass(w);
      expect(P(w, 0).status).toBe("alive");
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

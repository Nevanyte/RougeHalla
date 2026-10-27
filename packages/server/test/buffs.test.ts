// Buffs on the server (sim/buffs.ts and the hunks it feeds in arena.ts, combatant.ts, weapons.ts): the stat multipliers a
// buff's rows reach the sim through (the quantized mirrors), max hp, granting, the barrier, the bounty transfer, the mob
// kill's grant and the real attack/move formulas. The catalog and its maths are tested in
// packages/shared/test/buffsRoguelike.test.ts, and one rig per buff row in buffRows.test.ts; this is the part that touches
// the sim around them. The kill combos (speed bursts, the kill shield, the cooldown reset) are gone with the three stat
// stacks (R4a): there is no test of them, and a kill that crosses 3 or 5 stacks announces nothing but the buff itself.
import { describe, expect, it } from "vitest";
import {
  attackInterval, BOUNTY_STACK_SHARE, BOW_WINDUP, BOW_WINDUP_SHARE, BUFF_IDS, buffScale, damagePerHit, decodeMult,
  ELITE_BUFF_STACKS, eliteTypeOf, encodeMult, FACTIONS, GV_KILL, mapFromTiles, MOB_BUFF_STACKS, mobRewardMultiplier, mobWeapon,
  mulberry32, pacedFaction, PLAYER_SPEED, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, weaponTimings, WEAPONS, type BuffId,
  type FactionId, type FxEvent, type GameMap,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { applyDamage, applyHits, suddenDeath, type Attacker } from "../src/sim/arena";
import {
  absorbShield, attackSpeedMult, baseMaxHp, buffsOf, expireBoosts, grantBarrier, grantBuff, install as installBuffs,
  moveSpeedMult, syncMaxHp, transferBuffs,
} from "../src/sim/buffs";
import { combatant, timingsOf, type Combatant } from "../src/sim/combatant";
import { feedOfPlayer, lobbyMedianFeed } from "../src/sim/feed";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { killMob, placeMob, type MobCombatant } from "../src/sim/mobLife";
import { addMob } from "../src/sim/mobs";
import { recomputeMods } from "../src/sim/mods";
import { addPlayer, removePlayer, step } from "../src/sim/step";
import { moveMultiplierOf, packetFor } from "../src/sim/weapons";
import { createWorld, type SimConfig, type SimEvent, type World } from "../src/sim/world";
import { quoted } from "./support/quoted";

type Fx<K extends FxEvent["kind"]> = Extract<FxEvent, { kind: K }>;

// The default faction of the n-th joiner: p0 Fire (500 hp), p1 Sentenced (700), p2 Plague (1000), p3 Frost (1750), p4 Holy
// (1450), then round again.
const NAMES = ["alice", "bob", "carol", "dave", "erin", "frank", "gina", "hank"];
const idOf = (i: number): string => `p${i}`;

function makeConfig(n: number): SimConfig {
  // A patience timer that never fires: nothing in these tests is about the coliseum.
  return {
    minPlayers: n, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 1,
  };
}

/** `n` players in a run that started on the first step (serverTime TICK_MS), in a world with every gameplay module. */
function startRun(n: number, seed = 1234): World {
  const world = createGameWorld({ seed, config: makeConfig(n), random: mulberry32(seed + 1) });
  for (let i = 0; i < n; i++) addPlayer(world, idOf(i), NAMES[i]!);
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  return world;
}

const P = (world: World, i: number): PlayerState => world.state.players.get(idOf(i))!;
const RT = (world: World, i: number) => world.players.get(idOf(i))!;
const cOf = (world: World, i: number): Combatant => combatant(world, idOf(i))!;
const attacker = (world: World, i: number): Attacker => ({ id: idOf(i), p: P(world, i), rt: RT(world, i) });
const tick = (world: World): SimEvent[] => step(world, TICK_MS);

function runTo(world: World, serverTime: number): SimEvent[] {
  const all: SimEvent[] = [];
  while (world.state.serverTime < serverTime) all.push(...tick(world));
  expect(world.state.serverTime).toBe(serverTime);
  return all;
}

function fxOf<K extends FxEvent["kind"]>(events: SimEvent[], kind: K): Array<Fx<K>> {
  return events
    .filter((e): e is Extract<SimEvent, { type: "fx" }> => e.type === "fx")
    .map((e) => e.fx)
    .filter((fx): fx is Fx<K> => fx.kind === kind);
}

/** Damage that is certainly lethal to a player (their barrier included). */
function kill(world: World, victim: number, source: Attacker | string = "test"): number {
  const p = P(world, victim);
  return applyDamage(world, p, RT(world, victim), p.hp + p.barrier + 1000, source);
}

const grant = (world: World, i: number, id: BuffId, n: number): void => grantBuff(world, P(world, i), RT(world, i), id, n);

/** Sets stacks straight on the state (no fx), the way a test wants them: the rows are re-folded and max hp comes along. */
function setBuffs(world: World, i: number, buffs: Partial<Record<BuffId, number>>): void {
  const p = P(world, i);
  for (const [id, n] of Object.entries(buffs)) p.buffs.set(id, n);
  recomputeMods(world, cOf(world, i));
  syncMaxHp(p);
}

/** `i` makes kills of the given players, which puts a bounty on them from the 3rd. */
function slay(world: World, i: number, victims: number[]): void {
  for (const v of victims) kill(world, v, attacker(world, i));
}

/** The wire value of a folded multiplier: what the sim reads back (decoded) is what a client decodes (D22). */
const sim = (x: number): number => decodeMult(encodeMult(x));
const AS_Q = quoted("plagueRat"); // attack speed
const MS_Q = quoted("cinderHound"); // move speed, while chasing a lock
const ICE_Q = quoted("iceGolem"); // max hp
const BRUTE_HP_Q = quoted("magmaBrute", 0); // max hp
const BRUTE_MR_Q = quoted("magmaBrute", 1); // magic resist, in points
const AS = (stacks: number): number => 1 + AS_Q * buffScale(stacks);
const MS = (stacks: number): number => 1 + MS_Q * buffScale(stacks);
const HP_ICE = (stacks: number): number => 1 + ICE_Q * buffScale(stacks);

describe("the multipliers", () => {
  it("attackSpeedMult and moveSpeedMult are 1 for a player without buffs", () => {
    const w = startRun(2);
    expect(attackSpeedMult(P(w, 0))).toBe(1);
    expect(moveSpeedMult(w, cOf(w, 0))).toBe(1);
  });

  it("attackSpeedMult and moveSpeedMult are 1 for a mob state of any kind, and a mob holds no buffs", () => {
    const w = startRun(2);
    for (const kind of ["dummy", "mob", "elite"] as const) {
      const id = addMob(w, { kind, name: kind, faction: kind === "dummy" ? undefined : "fire", at: { x: P(w, 0).x, y: P(w, 0).y } });
      const m = w.state.mobs.get(id)!;
      expect(attackSpeedMult(m), kind).toBe(1);
      expect(moveSpeedMult(w, combatant(w, id)!), kind).toBe(1);
      expect(buffsOf(m), kind).toEqual(new Map());
    }
  });

  it("buffsOf lists the buffs a player holds above 0 stacks, in catalog order whatever order they were gained in", () => {
    const w = startRun(2);
    expect(buffsOf(P(w, 0))).toEqual(new Map());
    P(w, 0).buffs.set("iceGolem", 1);
    P(w, 0).buffs.set("emberImp", 2.5);
    P(w, 0).buffs.set("plagueRat", 0);
    P(w, 0).buffs.set("wyrmling", 4);
    const owned = buffsOf(P(w, 0));
    expect([...owned]).toEqual([["emberImp", 2.5], ["wyrmling", 4], ["iceGolem", 1]]);
    expect(BUFF_IDS.indexOf("emberImp")).toBeLessThan(BUFF_IDS.indexOf("wyrmling"));
    expect(BUFF_IDS.indexOf("wyrmling")).toBeLessThan(BUFF_IDS.indexOf("iceGolem"));
  });

  it("attackSpeedMult is the attack-speed buff's row at its stacks, and no other buff moves it", () => {
    const w = startRun(2);
    for (const other of ["iceGolem", "cinderHound", "magmaBrute", "emberImp", "rimeStalker"] as const) grant(w, 0, other, 8);
    expect(attackSpeedMult(P(w, 0))).toBe(1);
    for (const n of [0.5, 1, 2, 3, 4, 5, 8]) {
      const v = startRun(2);
      grant(v, 0, "plagueRat", n);
      expect(attackSpeedMult(P(v, 0)), `${n} stacks`).toBe(sim(AS(n)));
    }
    // The quoted number at 3 stacks, then the S-curve's slow plateau (never past 2.1x the quote).
    const v = startRun(2);
    grant(v, 0, "plagueRat", 3);
    expect(attackSpeedMult(P(v, 0))).toBe(sim(1 + AS_Q));
    grant(v, 0, "plagueRat", 50);
    expect(attackSpeedMult(P(v, 0))).toBeLessThan(1 + AS_Q * 2.2);
  });

  it("moveSpeedMult is the move-speed buff's row (its quoted value at 3 stacks) only while the player chases a lock", () => {
    const w = startRun(2);
    for (const other of ["plagueRat", "iceGolem", "magmaBrute"] as const) grant(w, 0, other, 8);
    expect(moveSpeedMult(w, cOf(w, 0))).toBe(1);
    RT(w, 0).weapon.lock = "p1"; // the row's condition (sim/mods.ts holdsNow), read when the rows are folded
    grant(w, 0, "cinderHound", 3);
    expect(moveSpeedMult(w, cOf(w, 0))).toBe(sim(1 + MS_Q));
    expect(moveSpeedMult(w, cOf(w, 0))).toBe(sim(MS(3)));
    // The condition is read once a tick (the step loop's updateMods), so a lock that ends shows by the end of its tick.
    RT(w, 0).weapon.lock = null;
    tick(w);
    expect(moveSpeedMult(w, cOf(w, 0))).toBe(1);
  });
});

describe("syncMaxHp", () => {
  it("max hp is the faction's hp times the maxHp rows, and a full bar stays full", () => {
    const w = startRun(5);
    for (let i = 0; i < 5; i++) {
      const base = [500, 700, 1000, 1750, 1450][i]!;
      const p = P(w, i);
      expect(baseMaxHp(p), `p${i}`).toBe(base);
      setBuffs(w, i, { iceGolem: 3 });
      expect(p.maxHp, `p${i}`).toBeCloseTo(base * (1 + ICE_Q), 9);
      expect(p.hp, `p${i}`).toBeCloseTo(p.maxHp, 9);
    }
    expect(Math.round((P(w, 0).maxHp / 500 - 1) * 100)).toBe(Math.round(ICE_Q * 100)); // the quoted % at 3 stacks
  });

  it("maxHp rows of different buffs add: Ice Golem and Magma Brute at 3 stacks are the sum of their quoted percents", () => {
    const w = startRun(2);
    setBuffs(w, 0, { iceGolem: 3, magmaBrute: 3 });
    expect(P(w, 0).maxHp).toBeCloseTo(500 * (1 + ICE_Q + BRUTE_HP_Q), 9);
    expect(P(w, 0).hp).toBeCloseTo(P(w, 0).maxHp, 9);
  });

  it("hp rises by the same delta, so the missing hp is kept", () => {
    const w = startRun(2);
    const p = P(w, 0);
    p.hp = 200; // 300 missing out of 500
    setBuffs(w, 0, { iceGolem: 4 });
    expect(p.maxHp).toBeCloseTo(500 * HP_ICE(4), 9);
    expect(p.maxHp - p.hp).toBeCloseTo(300, 9);
    expect(p.hp).toBeCloseTo(200 + (p.maxHp - 500), 9);
  });

  it("a further stack adds only the new delta", () => {
    const w = startRun(2);
    const p = P(w, 1);
    setBuffs(w, 1, { iceGolem: 2 });
    p.hp = 400;
    const maxBefore = p.maxHp;
    setBuffs(w, 1, { iceGolem: 3 });
    expect(p.hp).toBeCloseTo(400 + (p.maxHp - maxBefore), 9);
  });

  it("a dead player is not healed, though their max hp still follows", () => {
    const w = startRun(3);
    kill(w, 0, attacker(w, 1));
    expect(P(w, 0).hp).toBe(0);
    expect(P(w, 0).status).toBe("dead");
    setBuffs(w, 0, { iceGolem: 5 });
    expect(P(w, 0).hp).toBe(0);
    expect(P(w, 0).maxHp).toBeCloseTo(500 * HP_ICE(5), 9);
  });

  it("is idempotent", () => {
    const w = startRun(2);
    const p = P(w, 0);
    p.hp = 250;
    setBuffs(w, 0, { iceGolem: 3.7 });
    const after = { max: p.maxHp, hp: p.hp };
    for (let i = 0; i < 3; i++) syncMaxHp(p);
    expect({ max: p.maxHp, hp: p.hp }).toEqual(after);
  });

  it("derives from the faction rather than compounding on the current max hp, and clamps hp when the max falls", () => {
    const w = startRun(2);
    const p = P(w, 0);
    setBuffs(w, 0, { iceGolem: 3 });
    expect(p.hp).toBeGreaterThan(500);
    p.buffs.delete("iceGolem");
    recomputeMods(w, cOf(w, 0));
    syncMaxHp(p);
    expect(p.maxHp).toBe(500);
    expect(p.hp).toBe(500);
  });

  it("does nothing for no buffs", () => {
    const w = startRun(2);
    const p = P(w, 0);
    p.hp = 123;
    syncMaxHp(p);
    expect([p.maxHp, p.hp]).toEqual([500, 123]);
  });

  it("a buff with no maxHp row (Plague Rat, Cinder Hound, Magma Brute's shield alone) leaves max hp and hp as they were", () => {
    const w = startRun(2);
    P(w, 0).hp = 300;
    grant(w, 0, "plagueRat", 4);
    grant(w, 0, "cinderHound", 4);
    grant(w, 0, "rimeStalker", 4);
    expect([P(w, 0).maxHp, P(w, 0).hp]).toEqual([500, 300]);
  });
});

describe("grantBuff", () => {
  it.each(["emberImp", "plagueRat", "iceGolem"] as const)("adds %s stacks, with a buff fx carrying the buff, the amount and the new total", (id) => {
    const w = startRun(2);
    w.events = [];
    grant(w, 0, id, 1.5);
    grant(w, 0, id, 0.25);
    expect(P(w, 0).buffs.get(id)).toBeCloseTo(1.75, 9);
    expect(fxOf(w.events, "buff")).toEqual([
      { kind: "buff", id: idOf(0), buff: id, stacks: 1.5, total: 1.5 },
      { kind: "buff", id: idOf(0), buff: id, stacks: 0.25, total: 1.75 },
    ]);
    // No other buff is touched, and nobody else's buffs.
    expect([...buffsOf(P(w, 0)).keys()]).toEqual([id]);
    expect(buffsOf(P(w, 1)).size).toBe(0);
  });

  it("a max hp buff changes max hp and brings the hp with it; the others leave both alone", () => {
    const w = startRun(2);
    grant(w, 0, "plagueRat", 4);
    grant(w, 0, "cinderHound", 4);
    expect([P(w, 0).maxHp, P(w, 0).hp]).toEqual([500, 500]);
    P(w, 0).hp = 300;
    grant(w, 0, "iceGolem", 3);
    const max = 500 * (1 + ICE_Q);
    expect(P(w, 0).maxHp).toBeCloseTo(max, 9);
    expect(P(w, 0).hp).toBeCloseTo(300 + (max - 500), 9);
  });

  it("re-folds the mirrors in the same call, so the attack changes in the tick of the grant", () => {
    const w = startRun(2);
    const before = timingsOf(P(w, 0), "axe")!.interval;
    grant(w, 0, "plagueRat", 3);
    expect(P(w, 0).asMult).toBe(encodeMult(1 + AS_Q));
    expect(timingsOf(P(w, 0), "axe")!.interval).toBeCloseTo(before / sim(1 + AS_Q), 9);
  });

  it("crossing 3 or 5 stacks announces nothing but the buff fx (the kill combos are gone)", () => {
    const w = startRun(2);
    w.events = [];
    for (let i = 0; i < 6; i++) grant(w, 0, "plagueRat", 1); // totals 1..6
    expect(w.events.map((e) => (e.type === "fx" ? e.fx.kind : e.type))).toEqual(Array(6).fill("buff"));
    expect(fxOf(w.events, "buff").map((fx) => fx.total)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(P(w, 0).barrier).toBe(0);
    expect(RT(w, 0).boost).toBeUndefined();
  });

  it("counts fractions that add up to 3: 1.5 + 1.5 and 2.9 + 0.1 both reach the quoted attack speed", () => {
    const w = startRun(3);
    grant(w, 0, "plagueRat", 1.5);
    expect(P(w, 0).asMult).toBe(encodeMult(AS(1.5)));
    expect(P(w, 0).asMult).toBeLessThan(encodeMult(1 + AS_Q));
    grant(w, 0, "plagueRat", 1.5);
    expect(P(w, 0).buffs.get("plagueRat")).toBe(3);
    expect(P(w, 0).asMult).toBe(encodeMult(1 + AS_Q));
    grant(w, 1, "plagueRat", 2.9);
    grant(w, 1, "plagueRat", 0.1);
    expect(P(w, 1).buffs.get("plagueRat")).toBeCloseTo(3, 12);
    expect(P(w, 1).asMult).toBe(encodeMult(1 + AS_Q));
  });

  it("is ignored for a player whose result is out", () => {
    const w = startRun(3);
    RT(w, 0).resolved = true;
    w.events = [];
    grant(w, 0, "iceGolem", 4);
    expect(buffsOf(P(w, 0)).size).toBe(0);
    expect(P(w, 0).maxHp).toBe(500);
    expect(w.events).toEqual([]);
  });

  it("is ignored for a player who is not alive: dead with the result out, left (mia), or downed this tick and unresolved", () => {
    const w = startRun(4);
    kill(w, 0, attacker(w, 1)); // dead, result out
    const p2 = P(w, 2);
    const rt2 = RT(w, 2);
    removePlayer(w, idOf(2)); // mia, gone from the state
    P(w, 3).status = "dead"; // as in the middle of a tick
    w.events = [];
    grant(w, 0, "plagueRat", 4);
    grantBuff(w, p2, rt2, "plagueRat", 4);
    grant(w, 3, "cinderHound", 4);
    expect([P(w, 0).buffs.size, p2.buffs.size, P(w, 3).buffs.size]).toEqual([0, 0, 0]);
    expect(w.events).toEqual([]);
  });

  it.each([0, -1, -0.5, NaN])("is ignored for an amount of %s", (amount) => {
    const w = startRun(2);
    grant(w, 0, "iceGolem", 2);
    w.events = [];
    grant(w, 0, "iceGolem", amount);
    expect(P(w, 0).buffs.get("iceGolem")).toBe(2);
    expect(w.events).toEqual([]);
  });
});

describe("a mob kill grants the buff of its type", () => {
  /** p`killer` kills a mob of `region` of this `type` (an elite when `elite`): the hit is recorded and the mob killed at once. */
  function killMobBy(w: World, region: FactionId, elite: boolean, type: BuffId, killer = 0): void {
    const id = placeMob(w, { region, elite, type, at: { x: P(w, killer).x + 40, y: P(w, killer).y } });
    const mob = combatant(w, id) as MobCombatant;
    const entry = recordHit(w, {
      victim: id, by: { id: idOf(killer), name: NAMES[killer]! }, packet: { raw: 1, phys: 0, magic: 1, true: 0 }, weapon: "sword", stagger: false,
    });
    w.combat.ledger = [];
    killMob(w, mob, [entry], [mob.s.hp]);
  }

  it("a normal mob gives MOB_BUFF_STACKS x the reward multiplier of its own type, and max hp follows", () => {
    const w = startRun(2);
    const m = mobRewardMultiplier(0, 0);
    expect(m).toBeLessThan(1); // the curve is under 1 even for a hungry killer
    w.events = [];
    killMobBy(w, "fire", false, "magmaBrute");
    const got = MOB_BUFF_STACKS * m;
    expect([...buffsOf(P(w, 0)).keys()]).toEqual(["magmaBrute"]);
    expect(P(w, 0).buffs.get("magmaBrute")).toBeCloseTo(got, 12);
    expect(fxOf(w.events, "buff")).toEqual([{ kind: "buff", id: idOf(0), buff: "magmaBrute", stacks: P(w, 0).buffs.get("magmaBrute"), total: P(w, 0).buffs.get("magmaBrute") }]);
    expect(P(w, 0).maxHp).toBeCloseTo(FACTIONS.fire.hp * (1 + BRUTE_HP_Q * buffScale(got)), 9);
    expect(P(w, 0).shieldBonus).toBe(Math.round(BRUTE_MR_Q * buffScale(got) * 10)); // tenths of a point
  });

  it("an elite gives ELITE_BUFF_STACKS (3.1) x the multiplier, of the zone's elite type, so about the quoted 3 stacks in one kill", () => {
    expect(ELITE_BUFF_STACKS).toBe(3.1);
    const w = startRun(2);
    const type = eliteTypeOf("fire").id;
    killMobBy(w, "fire", true, type);
    const got = ELITE_BUFF_STACKS * mobRewardMultiplier(0, 0);
    expect(P(w, 0).buffs.get(type)).toBeCloseTo(got, 12);
    expect(got).toBeGreaterThan(2.9);
    expect(got).toBeLessThan(3.1);
  });

  it("the grant shrinks as the killer's feed grows (the reward curve) and is not affected by the buffs already held", () => {
    const hungry = startRun(2);
    killMobBy(hungry, "fire", false, "emberImp");
    const fed = startRun(2);
    P(fed, 0).kills = 12;
    const m = mobRewardMultiplier(feedOfPlayer(P(fed, 0), RT(fed, 0)), lobbyMedianFeed(fed));
    grant(fed, 0, "emberImp", 2); // what it holds does not change what the next kill pays
    killMobBy(fed, "fire", false, "emberImp");
    expect(m).toBeLessThan(0.31);
    expect(P(fed, 0).buffs.get("emberImp")! - 2).toBeCloseTo(MOB_BUFF_STACKS * m, 12);
    expect(P(fed, 0).buffs.get("emberImp")! - 2).toBeLessThan(P(hungry, 0).buffs.get("emberImp")!);
  });

  it("a mob placed without a type pays the zone's default buff (its first normal type; an elite its elite type)", () => {
    const w = startRun(2);
    const id = placeMob(w, { region: "plague", elite: false, at: { x: P(w, 0).x + 40, y: P(w, 0).y } });
    const mob = combatant(w, id) as MobCombatant;
    const entry = recordHit(w, { victim: id, by: { id: idOf(0), name: "alice" }, packet: { raw: 1, phys: 0, magic: 1, true: 0 }, weapon: "sword", stagger: false });
    w.combat.ledger = [];
    killMob(w, mob, [entry], [mob.s.hp]);
    expect([...buffsOf(P(w, 0)).keys()]).toEqual(["plagueRat"]);
  });

  it("draws nothing from world.random (the grant is no longer rolled): the loot stream is where an untouched world's is", () => {
    const killed = startRun(2);
    const untouched = startRun(2);
    P(killed, 0).weapon0 = mobWeapon("fire"); // so the mob's weapon is not dropped: this is about the buff
    killMobBy(killed, "fire", false, "emberImp");
    killMobBy(killed, "fire", true, eliteTypeOf("fire").id);
    expect(buffsOf(P(killed, 0)).size).toBe(2);
    const next = (w: World): number[] => [w.random(), w.random(), w.random()];
    expect(next(killed)).toEqual(next(untouched));
  });
});

describe("the barrier", () => {
  it("absorbShield: no barrier passes the whole amount, a small hit only shrinks the barrier, a big one takes the rest off", () => {
    const w = startRun(2);
    const p = P(w, 0);
    expect(absorbShield(p, 50)).toBe(50);
    p.barrier = 100;
    expect(absorbShield(p, 40)).toBe(0);
    expect(p.barrier).toBe(60);
    expect(absorbShield(p, 100)).toBe(40);
    expect(p.barrier).toBe(0);
    expect(absorbShield(p, 7)).toBe(7);
  });

  it("absorbShield: a hit that empties the barrier exactly leaves none, and slivers under 0.001 are dropped", () => {
    const w = startRun(2);
    const p = P(w, 0);
    p.barrier = 25;
    expect(absorbShield(p, 25)).toBe(0);
    expect(p.barrier).toBe(0);
    p.barrier = 25.0005;
    expect(absorbShield(p, 25)).toBe(0);
    expect(p.barrier).toBe(0);
  });

  it("applyDamage: a hit smaller than the barrier only shrinks it: no hp lost, no kill, no stagger-worthy damage returned", () => {
    const w = startRun(3);
    P(w, 1).barrier = 100;
    w.events = [];
    expect(applyDamage(w, P(w, 1), RT(w, 1), 40, attacker(w, 0))).toBe(0);
    expect(P(w, 1).hp).toBe(700);
    expect(P(w, 1).barrier).toBe(60);
    expect(P(w, 1).status).toBe("alive");
    expect(w.events).toEqual([]);
    // The blow was still dealt by p0: it counts for the win bonus and for leave credit (the barrier is a buffer on hp, unlike
    // teleport immunity, which ignores the blow before it gets that far).
    expect(RT(w, 0).damaged.has(idOf(1))).toBe(true);
    expect(RT(w, 1).lastHit).toEqual({ by: idOf(0), at: w.state.serverTime });
  });

  it("applyDamage: a hit larger than the barrier takes the rest off hp, and returns that part", () => {
    const w = startRun(3);
    P(w, 1).barrier = 30;
    expect(applyDamage(w, P(w, 1), RT(w, 1), 100, attacker(w, 0))).toBe(70);
    expect(P(w, 1).hp).toBe(630);
    expect(P(w, 1).barrier).toBe(0);
  });

  it("applyDamage: a hit equal to the barrier costs no hp and leaves no barrier", () => {
    const w = startRun(3);
    P(w, 1).barrier = 80;
    expect(applyDamage(w, P(w, 1), RT(w, 1), 80, attacker(w, 0))).toBe(0);
    expect(P(w, 1).hp).toBe(700);
    expect(P(w, 1).barrier).toBe(0);
  });

  it("applyDamage: a hit that would be lethal to the hp alone but is fully absorbed does not kill, credit or pay anything", () => {
    const w = startRun(3);
    P(w, 1).hp = 10;
    P(w, 1).barrier = 200;
    w.events = [];
    expect(applyDamage(w, P(w, 1), RT(w, 1), 150, attacker(w, 0))).toBe(0);
    expect(P(w, 1).hp).toBe(10);
    expect(P(w, 1).barrier).toBe(50);
    expect(P(w, 1).status).toBe("alive");
    expect(RT(w, 1).down).toBeNull();
    expect(P(w, 0).kills).toBe(0);
    expect(w.events).toEqual([]); // no death, no gv
    // The next blow gets through what the barrier has left and kills; the hp removed is what there was.
    expect(applyDamage(w, P(w, 1), RT(w, 1), 100, attacker(w, 0))).toBe(10);
    expect(P(w, 1).status).toBe("dead");
    expect(P(w, 1).barrier).toBe(0);
    expect(P(w, 0).kills).toBe(1);
  });

  it("applyDamage: a blow bigger than barrier plus hp kills, and the killer is paid as usual", () => {
    const w = startRun(3);
    P(w, 1).barrier = 100;
    w.events = [];
    applyDamage(w, P(w, 1), RT(w, 1), 100 + 700 + 1, attacker(w, 0));
    expect(P(w, 1).status).toBe("dead");
    expect(P(w, 0).kills).toBe(1);
    expect(RT(w, 0).gv.kills).toBe(GV_KILL);
    expect(fxOf(w.events, "death")).toHaveLength(1);
  });

  it("applyHits: simultaneous hits are summed first, then the barrier takes its share of the sum; both attackers count as damagers", () => {
    const w = startRun(4);
    P(w, 2).barrier = 50;
    w.events = [];
    const removed = applyHits(w, P(w, 2), RT(w, 2), [{ amount: 40, source: attacker(w, 0) }, { amount: 30, source: attacker(w, 1) }]);
    expect(removed).toBe(20);
    expect(P(w, 2).hp).toBe(980);
    expect(P(w, 2).barrier).toBe(0);
    expect([...RT(w, 0).damaged]).toEqual([idOf(2)]);
    expect([...RT(w, 1).damaged]).toEqual([idOf(2)]);
    expect(RT(w, 2).lastHit!.by).toBe(idOf(0)); // the biggest hit
    expect(w.events).toEqual([]);
  });

  it("grantBarrier: the larger barrier and the later end win, and it is ignored for no hp or a player who is down", () => {
    const w = startRun(3);
    const now = w.state.serverTime;
    grantBarrier(P(w, 0), RT(w, 0), 80, now + 5000);
    expect(P(w, 0).barrier).toBe(80);
    expect(RT(w, 0).boost).toEqual({ shieldUntil: now + 5000 });
    grantBarrier(P(w, 0), RT(w, 0), 50, now + 2000); // smaller and sooner: neither shrinks
    expect(P(w, 0).barrier).toBe(80);
    expect(RT(w, 0).boost!.shieldUntil).toBe(now + 5000);
    grantBarrier(P(w, 0), RT(w, 0), 120, now + 9000);
    expect([P(w, 0).barrier, RT(w, 0).boost!.shieldUntil]).toEqual([120, now + 9000]);
    grantBarrier(P(w, 1), RT(w, 1), 0, now + 5000);
    grantBarrier(P(w, 1), RT(w, 1), -5, now + 5000);
    expect([P(w, 1).barrier, RT(w, 1).boost]).toEqual([0, undefined]);
    P(w, 2).status = "dead";
    grantBarrier(P(w, 2), RT(w, 2), 80, now + 5000);
    expect([P(w, 2).barrier, RT(w, 2).boost]).toEqual([0, undefined]);
  });

  it("the buffs system sets the barrier to 0 in the tick that reaches shieldUntil, and not before", () => {
    const w = startRun(3);
    const until = w.state.serverTime + 5000;
    grantBarrier(P(w, 0), RT(w, 0), 75, until);
    expect(RT(w, 0).boost).toEqual({ shieldUntil: until });
    runTo(w, until - TICK_MS);
    expect(P(w, 0).barrier).toBe(75);
    tick(w);
    expect(w.state.serverTime).toBe(until);
    expect(P(w, 0).barrier).toBe(0);
    expect(RT(w, 0).boost!.shieldUntil).toBe(0);
    expect(P(w, 0).hp).toBeCloseTo(P(w, 0).maxHp, 9); // and nothing came off the hp
  });

  it("expireBoosts drops the barrier of a player who went down, before its time", () => {
    const w = startRun(3);
    grantBarrier(P(w, 0), RT(w, 0), 75, w.state.serverTime + 5000);
    P(w, 0).status = "dead";
    expireBoosts(w);
    expect(P(w, 0).barrier).toBe(0);
    expect(RT(w, 0).boost!.shieldUntil).toBe(0);
  });

  it("sudden death goes through the ledger like every other hit, so a barrier is burnt through first", () => {
    // What the code does, worth knowing: a barrier is not exempt from sudden death, nor immune to it. It only delays it.
    const w = startRun(2);
    runTo(w, 500); // suddenDeathAt is 0 when unset, so start it on the tick grid after 0
    P(w, 0).barrier = 10;
    const s = w.state;
    s.gatesLocked = true;
    s.suddenDeathAt = s.serverTime - TICK_MS; // the tick being simulated began exactly at suddenDeathAt
    suddenDeath(w, TICK_MS);
    applyLedger(w);
    const burn = 0.02 * (TICK_MS / 1000) * 500; // SUDDEN_DEATH_START_FRACTION x dt x max hp
    expect(P(w, 0).barrier).toBeCloseTo(10 - burn, 9);
    expect(P(w, 0).hp).toBe(500);
    expect(P(w, 1).hp).toBeCloseTo(700 - 0.02 * (TICK_MS / 1000) * 700, 9); // the unshielded one loses hp
    expect(P(w, 0).status).toBe("alive");
    expect(RT(w, 0).killedBy).toBeNull();
  });
});

describe("the bounty moves half of each of the victim's buffs to the killer", () => {
  /** p0 has `victims` kills (3 puts a bounty on them) and these buffs; p4 is the killer. */
  function bountied(buffs: Partial<Record<BuffId, number>>, victims = [1, 2, 3]): World {
    const w = startRun(6);
    slay(w, 0, victims);
    setBuffs(w, 0, buffs);
    w.events = [];
    return w;
  }
  const noBuffs = (w: World, i: number): void => expect(buffsOf(P(w, i)).size).toBe(0);

  it("a killer who kills a bountied victim gets exactly 50% of each of their buffs, with a buff fx per buff", () => {
    const w = bountied({ iceGolem: 4, plagueRat: 2.5, emberImp: 1 });
    expect(P(w, 0).bounty).toBe(10);
    expect(BOUNTY_STACK_SHARE).toBe(0.5);
    kill(w, 0, attacker(w, 4));
    // Catalog order (emberImp, plagueRat, iceGolem), the stacks halved.
    expect([...buffsOf(P(w, 4))]).toEqual([["emberImp", 0.5], ["plagueRat", 1.25], ["iceGolem", 2]]);
    expect(fxOf(w.events, "buff")).toEqual([
      { kind: "buff", id: idOf(4), buff: "emberImp", stacks: 0.5, total: 0.5 },
      { kind: "buff", id: idOf(4), buff: "plagueRat", stacks: 1.25, total: 1.25 },
      { kind: "buff", id: idOf(4), buff: "iceGolem", stacks: 2, total: 2 },
    ]);
    // The bounty GV came with it.
    expect(RT(w, 4).gv).toEqual({ kills: GV_KILL, mobs: 0, bounty: 10 });
  });

  it("max hp follows the hp buff gained, and the killer's hp rises by the same delta", () => {
    const w = bountied({ iceGolem: 4 });
    P(w, 4).hp = 1000; // Holy, 1450 max, wounded
    kill(w, 0, attacker(w, 4));
    const max = 1450 * HP_ICE(2);
    expect(P(w, 4).maxHp).toBeCloseTo(max, 9);
    expect(P(w, 4).hp).toBeCloseTo(1000 + (max - 1450), 9);
  });

  it("the killer's mirrors are re-folded by the transfer, so the buffs it won are in its attack at once", () => {
    const w = bountied({ plagueRat: 6 });
    expect(P(w, 4).asMult).toBe(1000);
    kill(w, 0, attacker(w, 4));
    expect(P(w, 4).buffs.get("plagueRat")).toBe(3);
    expect(P(w, 4).asMult).toBe(encodeMult(1 + AS_Q));
  });

  it("adds to what the killer already holds", () => {
    const w = bountied({ plagueRat: 3 });
    grant(w, 4, "plagueRat", 1);
    w.events = [];
    kill(w, 0, attacker(w, 4));
    expect(P(w, 4).buffs.get("plagueRat")).toBe(2.5);
    expect(fxOf(w.events, "buff")).toEqual([{ kind: "buff", id: idOf(4), buff: "plagueRat", stacks: 1.5, total: 2.5 }]);
  });

  it("a buff the victim has none of sends no fx", () => {
    const w = bountied({ cinderHound: 2 });
    kill(w, 0, attacker(w, 4));
    expect(fxOf(w.events, "buff").map((fx) => fx.buff)).toEqual(["cinderHound"]);
  });

  it("a victim without a bounty transfers nothing, and a kill no longer gives a barrier or a burst", () => {
    const w = bountied({ iceGolem: 6, plagueRat: 6, emberImp: 6 }, [1, 2]); // 2 kills: feed 2, no bounty
    expect(P(w, 0).bounty).toBe(0);
    setBuffs(w, 4, { iceGolem: 5, plagueRat: 5 }); // the killer's own stacks (once 3 and 5 made a combo)
    const held = [...buffsOf(P(w, 4))];
    const maxHp = P(w, 4).maxHp;
    w.events = [];
    kill(w, 0, attacker(w, 4));
    expect([...buffsOf(P(w, 4))]).toEqual(held);
    expect(P(w, 4).maxHp).toBe(maxHp);
    expect(P(w, 4).barrier).toBe(0);
    expect(RT(w, 4).boost).toBeUndefined();
    expect(fxOf(w.events, "buff")).toEqual([]);
    expect(RT(w, 4).gv.bounty).toBe(0);
  });

  it("a victim killed by something that is not a player transfers nothing", () => {
    const w = bountied({ iceGolem: 6, plagueRat: 6 });
    kill(w, 0, "test");
    noBuffs(w, 4);
    expect(fxOf(w.events, "buff")).toEqual([]);
  });

  it("a bountied victim who leaves right after a hit passes their buffs on too (a credited leave)", () => {
    const w = bountied({ plagueRat: 4 });
    applyDamage(w, P(w, 0), RT(w, 0), 1, attacker(w, 4));
    removePlayer(w, idOf(0));
    expect(P(w, 4).buffs.get("plagueRat")).toBe(2);
    expect(RT(w, 4).gv.bounty).toBe(10);
  });

  it("a bountied victim who leaves without having been hit pays nobody", () => {
    const w = bountied({ plagueRat: 4 });
    removePlayer(w, idOf(0));
    noBuffs(w, 4);
  });

  it("transferBuffs called directly moves half of each buff and ignores a missing player", () => {
    const w = bountied({ iceGolem: 2, plagueRat: 4, emberImp: 6 });
    transferBuffs(w, RT(w, 4), RT(w, 0));
    expect([...buffsOf(P(w, 4))]).toEqual([["emberImp", 3], ["plagueRat", 2], ["iceGolem", 1]]);
    expect([...buffsOf(P(w, 0))]).toEqual([["emberImp", 6], ["plagueRat", 4], ["iceGolem", 2]]); // a copy of half, not a move: the victim is dead anyway
    const gone = RT(w, 0);
    removePlayer(w, idOf(0));
    transferBuffs(w, RT(w, 4), gone); // the victim is gone from the state: nothing to read
    expect([...buffsOf(P(w, 4))]).toEqual([["emberImp", 3], ["plagueRat", 2], ["iceGolem", 1]]);
  });

  it("a killer who went down in the same tick still collects the GV but is past receiving buffs", () => {
    const w = bountied({ iceGolem: 4 });
    // p4 is downed (hp 0 and status dead) but unresolved, as in the middle of a tick; then its blow kills p0.
    P(w, 4).status = "dead";
    P(w, 4).hp = 0;
    kill(w, 0, attacker(w, 4));
    noBuffs(w, 4);
    expect(RT(w, 4).gv.bounty).toBe(10);
  });
});

describe("the hooks chain onto whatever was installed before", () => {
  it("runs a previous bountyClaimed and playerKilled first, and the buffs are already moved when the previous playerKilled runs", () => {
    const seed = 99;
    const w = createWorld({ seed, config: makeConfig(6), random: mulberry32(seed) });
    for (let i = 0; i < 6; i++) addPlayer(w, idOf(i), NAMES[i]!);
    step(w, TICK_MS);
    const log: string[] = [];
    w.hooks.bountyClaimed = (_w, killer, victim, bounty) => { log.push(`claimed ${killer.id}<-${victim.id} ${bounty}`); };
    w.hooks.playerKilled = (world, killer) => {
      const k = world.state.players.get(killer.id)!;
      log.push(`killed ${killer.id} plagueRat=${k.buffs.get("plagueRat")} asMult=${k.asMult}`);
    };
    installBuffs(w);
    expect(w.systems).toContain(expireBoosts);
    expect(w.moveModifiers).toContain(moveSpeedMult);
    slay(w, 0, [1, 2, 3]);
    setBuffs(w, 0, { plagueRat: 6 });
    log.length = 0;
    kill(w, 0, attacker(w, 4));
    // The previous claimed hook runs, then the transfer (half of 6), then the previous killed hook, which sees the stacks and
    // the re-folded mirror already.
    expect(log).toEqual([`claimed ${idOf(4)}<-${idOf(0)} 10`, `killed ${idOf(4)} plagueRat=3 asMult=${encodeMult(1 + AS_Q)}`]);
  });
});

describe("attack speed through the real formulas", () => {
  const paced = (faction: "plague" | "frost") => pacedFaction(FACTIONS[faction]);

  it("with no buffs the interval and damage per hit are the paced faction's", () => {
    const w = startRun(4);
    P(w, 2).weapon0 = "sword"; // Plague
    const t = timingsOf(P(w, 2), "sword")!;
    expect(t.interval).toBe(attackInterval(paced("plague"), "sword", 1));
    expect(packetFor(cOf(w, 2), "sword").raw).toBe(damagePerHit(paced("plague"), "sword", 1));
  });

  it("Frost on the axe is far above its floor: the buff shrinks the interval and damage per hit stays", () => {
    const w = startRun(4);
    const p = P(w, 3);
    p.weapon0 = "axe";
    const before = timingsOf(p, "axe")!;
    const rawBefore = packetFor(cOf(w, 3), "axe").raw;
    expect(before.interval).toBeGreaterThan(1.5); // 1 / (0.45 x 1.4)
    grant(w, 3, "plagueRat", 6);
    const m = decodeMult(p.asMult);
    expect(m).toBe(sim(AS(6)));
    expect(m).toBeGreaterThan(1.06);
    const after = timingsOf(p, "axe")!;
    expect(after.interval).toBeCloseTo(before.interval / m, 9);
    expect(after.interval).toBeGreaterThan(WEAPONS.axe.floor);
    expect(after).toEqual(weaponTimings("axe", attackInterval(paced("frost"), "axe", m)));
    // rate x hit x dps x asMult x interval: the multiplier cancels while no floor binds.
    expect(packetFor(cOf(w, 3), "axe").raw).toBeCloseTo(rawBefore, 9);
    expect(packetFor(cOf(w, 3), "axe").raw).toBeCloseTo(damagePerHit(paced("frost"), "axe", m), 9);
  });

  it("Plague on the sword sits just above the 0.25 s floor: the first stacks are damage per hit, not speed", () => {
    const w = startRun(4);
    const p = P(w, 2);
    p.weapon0 = "sword";
    const before = timingsOf(p, "sword")!;
    const rawBefore = packetFor(cOf(w, 2), "sword").raw;
    expect(before.interval).toBeGreaterThan(WEAPONS.sword.floor);
    expect(before.interval).toBeLessThan(0.2515);
    grant(w, 2, "plagueRat", 6);
    const m = decodeMult(p.asMult);
    expect(m).toBeGreaterThan(1.06);
    const after = timingsOf(p, "sword")!;
    expect(after.interval).toBe(WEAPONS.sword.floor); // held at the floor
    expect(after.interval).toBeLessThan(before.interval); // by a hair
    const raw = packetFor(cOf(w, 2), "sword").raw;
    expect(raw).toBeCloseTo(damagePerHit(paced("plague"), "sword", m), 9);
    expect(raw).toBeGreaterThan(rawBefore * (1 + 0.9 * (m - 1))); // nearly the full bonus turned into damage
    expect(raw / after.interval).toBeGreaterThan((rawBefore / before.interval) * (1 + 0.9 * (m - 1))); // so dps rises with the stacks
    // More stacks, more damage per hit, the interval stays on the floor.
    grant(w, 2, "plagueRat", 6);
    expect(timingsOf(p, "sword")!.interval).toBe(WEAPONS.sword.floor);
    expect(packetFor(cOf(w, 2), "sword").raw).toBeGreaterThan(raw);
  });

  it("the bow's interval and draw shrink with the buff: the draw is the 0.6 s cap until 92% of the interval is shorter", () => {
    const w = startRun(4);
    const fire = P(w, 0);
    fire.weapon0 = "bow";
    const before = timingsOf(fire, "bow")!;
    expect(before.interval).toBeCloseTo(1 / (0.6 * 1.95), 9); // Fire's rate 0.6, the bow's boost 0.95
    expect(before.windup).toBe(BOW_WINDUP); // 0.92 x 0.855 s is past the 0.6 s cap: the draw is the cap
    grant(w, 0, "plagueRat", 3);
    const m = decodeMult(fire.asMult);
    expect(m).toBe(sim(1 + AS_Q));
    const after = timingsOf(fire, "bow")!;
    expect(after.interval).toBeCloseTo(before.interval / m, 9);
    expect(after.windup).toBe(BOW_WINDUP); // 0.92 x 0.822 s is still past it
    // Plague's bow starts 0.277 s: the draw is 92% of the interval, so it shrinks with it. A few stacks leave it above the
    // 0.25 s floor, where the interval and the draw both follow the multiplier; the buff's best (x2.1 the quote) takes it
    // to the floor, where the interval holds and the rest of the speed is damage per hit (as the sword's test above).
    const plague = P(w, 2);
    plague.weapon0 = "bow";
    const plagueBefore = timingsOf(plague, "bow")!;
    expect(plagueBefore.interval).toBeGreaterThan(WEAPONS.bow.floor);
    expect(plagueBefore.windup).toBeCloseTo(BOW_WINDUP_SHARE * plagueBefore.interval, 9);
    expect(plagueBefore.interval / sim(AS(3))).toBeGreaterThan(WEAPONS.bow.floor); // 3 stacks: no floor binds
    expect(plagueBefore.interval / sim(AS(8))).toBeLessThan(WEAPONS.bow.floor); // 8 stacks: the floor binds
    for (const stacks of [3, 8]) {
      const v = startRun(4);
      grant(v, 2, "plagueRat", stacks);
      const pv = P(v, 2);
      pv.weapon0 = "bow";
      const t = timingsOf(pv, "bow")!;
      const mv = decodeMult(pv.asMult);
      expect(t.interval, `${stacks} stacks`).toBeCloseTo(Math.max(WEAPONS.bow.floor, plagueBefore.interval / mv), 9);
      expect(t.interval, `${stacks} stacks`).toBeGreaterThanOrEqual(WEAPONS.bow.floor);
      expect(t.windup, `${stacks} stacks`).toBeCloseTo(BOW_WINDUP_SHARE * t.interval, 9);
      expect(t.windup, `${stacks} stacks`).toBeLessThan(plagueBefore.windup);
    }
  });

  it("a mob keeps the unbuffed numbers", () => {
    const w = startRun(2);
    const id = addMob(w, { kind: "mob", name: "m", faction: "plague", at: { x: 100, y: 100 }, weapon: "sword" });
    const m = w.state.mobs.get(id)!;
    expect(timingsOf(m, "sword")!.interval).toBeGreaterThan(0.25);
    expect(attackSpeedMult(m)).toBe(1);
  });
});

/** What step.ts multiplies into a fighter's walking speed: the weapon's factor times every world.moveModifiers entry. */
const effectiveMove = (w: World, c: Combatant): number => w.moveModifiers.reduce((m, mod) => m * mod(w, c), moveMultiplierOf(w, c));

describe("the move factor (moveMultiplierOf and world.moveModifiers)", () => {
  /** p0 holds a lock on p1 (the row of Cinder Hound holds while it does) and `stacks` of the buff. */
  function chasing(stacks: number): World {
    const w = startRun(2);
    RT(w, 0).weapon.lock = "p1";
    if (stacks > 0) grant(w, 0, "cinderHound", stacks);
    return w;
  }

  it("move-speed buffs are a registered moveModifier of a game world, not a part of moveMultiplierOf", () => {
    const w = chasing(3);
    expect(w.moveModifiers).toContain(moveSpeedMult);
    expect(moveMultiplierOf(w, cOf(w, 0))).toBe(1);
    expect(effectiveMove(w, cOf(w, 0))).toBe(sim(1 + MS_Q));
  });

  it("a buffed player really walks farther per tick (the step loop applies the modifier)", () => {
    // An open floor, so the chase is a straight line, with the target far enough to be walked towards for several ticks.
    const W = 40;
    const H = 20;
    const tiles = new Uint8Array(W * H).fill(TILE_FLOOR);
    for (let tx = 0; tx < W; tx++) { tiles[tx] = TILE_WALL; tiles[(H - 1) * W + tx] = TILE_WALL; }
    for (let ty = 0; ty < H; ty++) { tiles[ty * W] = TILE_WALL; tiles[ty * W + W - 1] = TILE_WALL; }
    const spawns = Array.from({ length: 8 }, (_, i) => ({ x: TILE * (3 + 3 * i) + TILE / 2, y: TILE * 10 + TILE / 2 }));
    const map: GameMap = { ...mapFromTiles(W, H, tiles), spawns };
    // Distance walked in the 4th tick of a chase of a target 14 tiles away: the lock is taken on tick 1 and the mirror
    // follows it by the end of that tick (the condition is read once a tick), so by tick 3 the walk is at its pace.
    const run = (stacks: number): number => {
      const world = createGameWorld({ seed: 7, config: makeConfig(2), random: mulberry32(8), map });
      addPlayer(world, "p0", "alice");
      addPlayer(world, "p1", "bob");
      step(world, TICK_MS);
      if (stacks > 0) grantBuff(world, P(world, 0), RT(world, 0), "cinderHound", stacks);
      const a = P(world, 0);
      const b = P(world, 1);
      a.x = TILE * 3 + TILE / 2; a.y = TILE * 10 + TILE / 2;
      b.x = a.x + 14 * TILE; b.y = a.y;
      for (const [i, pos] of [a, b].entries()) RT(world, i).history = [{ t: world.state.serverTime, x: pos.x, y: pos.y }];
      expect(enqueueClientMessage(RT(world, 0).inputs, "target", { id: "p1" })).toBe(true);
      tick(world);
      tick(world);
      tick(world);
      expect(RT(world, 0).weapon.lock).toBe("p1");
      const x0 = a.x;
      tick(world);
      return a.x - x0;
    };
    const plain = run(0);
    expect(plain).toBeCloseTo(PLAYER_SPEED * (TICK_MS / 1000), 6);
    expect(run(3) / plain).toBeCloseTo(sim(1 + MS_Q), 6);
  });

  it("is 1 with nothing on", () => {
    const w = startRun(2);
    expect(effectiveMove(w, cOf(w, 0))).toBe(1);
  });

  it("includes the move-speed buff while the player holds a lock, and not without one", () => {
    const w = chasing(3);
    expect(effectiveMove(w, cOf(w, 0))).toBe(sim(MS(3)));
    const idle = startRun(2);
    grant(idle, 0, "cinderHound", 3);
    expect(effectiveMove(idle, cOf(idle, 0))).toBe(1);
  });

  it("is 0 while rooted whatever the buffs say", () => {
    const w = chasing(8);
    expect(effectiveMove(w, cOf(w, 0))).toBeGreaterThan(1);
    RT(w, 0).weapon.rootUntil = w.state.serverTime + 100;
    expect(effectiveMove(w, cOf(w, 0))).toBe(0);
    RT(w, 0).weapon.rootUntil = w.state.serverTime; // over at the instant
    expect(effectiveMove(w, cOf(w, 0))).toBeGreaterThan(1);
  });

  it("is 0 while an attack winds up, whatever the buffs say", () => {
    const w = chasing(3);
    expect(effectiveMove(w, cOf(w, 0))).toBe(sim(MS(3)));
    RT(w, 0).weapon.action = {
      kind: "cast", weapon: "wand", startedAt: w.state.serverTime, landsAt: w.state.serverTime + 100, a: 0,
      packet: { raw: 1, phys: 0, magic: 1, true: 0 }, origin: { x: 0, y: 0 },
    };
    expect(effectiveMove(w, cOf(w, 0))).toBe(0);
  });
});

// What the cards leave on a player's body (sim/buffs.ts and the hunks it feeds in arena.ts, combatant.ts, weapons.ts; the module keeps
// its name from the per-kill buffs it once held): the stat multipliers a card's rows reach the sim through (the quantized mirrors),
// max hp, the barrier, what a kill does NOT give any more and the real attack/move formulas. The catalog is tested in
// packages/shared/test/cards.test.ts, one rig per card row in buffRows.test.ts and the fold in mods.test.ts; granting a card is
// chests.test.ts. The per-kill buffs (grantBuff, the bounty's stack transfer, a mob kill's grant) are gone with the balance pass
// (BALANCE_CONTRACT 3.6): what is tested here is that a kill gives GV and a weapon and no stat.
import { describe, expect, it } from "vitest";
import {
  attackInterval, BOW_WINDUP, BOW_WINDUP_SHARE, damagePerHit, decodeMult, elitesOf, encodeMult, FACTIONS, GV_KILL, mapFromTiles,
  mobRewardMultiplier, mobWeapon, mulberry32, pacedFaction, PLAYER_SPEED, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, weaponTimings, WEAPONS,
  type FactionId, type FxEvent, type GameMap, type MobTypeId,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { applyDamage, applyHits, suddenDeath, type Attacker } from "../src/sim/arena";
import {
  absorbShield, attackSpeedMult, baseMaxHp, expireBoosts, grantBarrier, install as installBuffs, moveSpeedMult, syncMaxHp,
} from "../src/sim/buffs";
import { grantCard } from "../src/sim/chests";
import { combatant, timingsOf, type Combatant } from "../src/sim/combatant";
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

// The default faction of the n-th joiner: p0 Fire (835 hp), p1 Sentenced (800), p2 Plague (1375), p3 Frost (1200), p4 Holy (1400), then
// round again.
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

/** Gives player `i` `count` copies of a card through the chest's own grant (the rows are re-folded and max hp comes along). */
const grant = (world: World, i: number, id: string, count = 1): void => {
  for (let k = 0; k < count; k++) grantCard(world, cOf(world, i) as Extract<Combatant, { kind: "player" }>, id);
};

/** Sets the build straight on the state, the way a test wants it: the rows are re-folded and max hp comes along. */
function setCards(world: World, i: number, cards: Record<string, number>): void {
  const p = P(world, i);
  p.build.clear();
  for (const [id, n] of Object.entries(cards)) p.build.set(id, n);
  recomputeMods(world, cOf(world, i));
  syncMaxHp(p);
}

/** `i` makes kills of the given players, which puts a bounty on them from the 3rd. */
function slay(world: World, i: number, victims: number[]): void {
  for (const v of victims) kill(world, v, attacker(world, i));
}

/** The wire value of a folded multiplier: what the sim reads back (decoded) is what a client decodes (D22). */
const sim = (x: number): number => decodeMult(encodeMult(x));
const HASTE = [0, quoted("haste1"), quoted("haste2"), quoted("haste3")]; // attack speed per tier
const FLEET = [0, quoted("fleet1"), quoted("fleet2"), quoted("fleet3")]; // move speed per tier, off while shooting
const VIT = [0, quoted("vitality1"), quoted("vitality2"), quoted("vitality3")]; // max hp per tier
const HEARTY = quoted("hearty");

describe("the multipliers", () => {
  it("attackSpeedMult and moveSpeedMult are 1 for a player without cards", () => {
    const w = startRun(2);
    expect(attackSpeedMult(P(w, 0))).toBe(1);
    expect(moveSpeedMult(w, cOf(w, 0))).toBe(1);
  });

  it("attackSpeedMult and moveSpeedMult are 1 for a mob state of any kind, and a mob holds no cards", () => {
    const w = startRun(2);
    for (const kind of ["dummy", "mob", "elite"] as const) {
      const id = addMob(w, { kind, name: kind, faction: kind === "dummy" ? undefined : "fire", at: { x: P(w, 0).x, y: P(w, 0).y } });
      const m = w.state.mobs.get(id)!;
      expect(attackSpeedMult(m), kind).toBe(1);
      expect(moveSpeedMult(w, combatant(w, id)!), kind).toBe(1);
      expect("build" in m, kind).toBe(false);
    }
  });

  it("attackSpeedMult is the Haste cards' rows added up, and no other base card moves it", () => {
    const w = startRun(2);
    for (const other of ["vitality3", "fleet3", "armor3", "mr3", "ad3", "ap3", "leech3"]) grant(w, 0, other, 2);
    expect(attackSpeedMult(P(w, 0))).toBe(1);
    for (const [cards, want] of [
      [{ haste1: 1 }, 1 + HASTE[1]!], [{ haste2: 1 }, 1 + HASTE[2]!], [{ haste3: 1 }, 1 + HASTE[3]!],
      [{ haste1: 2 }, 1 + 2 * HASTE[1]!], [{ haste2: 1, haste1: 1 }, 1 + HASTE[2]! + HASTE[1]!],
    ] as const) {
      const v = startRun(2);
      setCards(v, 0, cards);
      expect(attackSpeedMult(P(v, 0)), JSON.stringify(cards)).toBe(sim(want));
    }
    // The rows are capped at x1.5 (AS_MULT_CAP): three Haste III cards are +75% asked, +50% given.
    const v = startRun(2);
    grant(v, 0, "haste3", 3);
    expect(attackSpeedMult(P(v, 0))).toBe(1.5);
  });

  it("moveSpeedMult is the Fleet cards' rows (off while the player shoots), and no other base card moves it", () => {
    const w = startRun(2);
    for (const other of ["haste3", "vitality3", "armor3", "ad3"]) grant(w, 0, other, 2);
    expect(moveSpeedMult(w, cOf(w, 0))).toBe(1);
    grant(w, 0, "fleet2");
    expect(moveSpeedMult(w, cOf(w, 0))).toBe(sim(1 + FLEET[2]!));
    // Fleet's rule (Swift Boots'): it is off from a shot's start until its pause after the shot. The condition is read once a tick
    // (the step loop's updateMods), so a shot just taken shows by the end of its tick.
    RT(w, 0).weapon.lastShotAt = w.state.serverTime;
    tick(w);
    expect(moveSpeedMult(w, cOf(w, 0))).toBe(1);
  });
});

describe("syncMaxHp", () => {
  it("max hp is the faction's hp times the maxHp rows, and a full bar stays full", () => {
    const w = startRun(5);
    for (let i = 0; i < 5; i++) {
      const base = [835, 800, 1375, 1200, 1400][i]!;
      const p = P(w, i);
      expect(baseMaxHp(p), `p${i}`).toBe(base);
      setCards(w, i, { vitality2: 1 });
      expect(p.maxHp, `p${i}`).toBeCloseTo(base * (1 + VIT[2]!), 9);
      expect(p.hp, `p${i}`).toBeCloseTo(p.maxHp, 9);
    }
    expect(Math.round((P(w, 0).maxHp / 835 - 1) * 100)).toBe(Math.round(VIT[2]! * 100)); // the card's percent
  });

  it("maxHp rows of different cards add: Vitality III and Hearty are the sum of their percents", () => {
    const w = startRun(2);
    setCards(w, 0, { vitality3: 1, hearty: 1 });
    expect(P(w, 0).maxHp).toBeCloseTo(835 * (1 + VIT[3]! + HEARTY), 9);
    expect(P(w, 0).hp).toBeCloseTo(P(w, 0).maxHp, 9);
  });

  it("hp rises by the same delta, so the missing hp is kept", () => {
    const w = startRun(2);
    const p = P(w, 0);
    p.hp = 200; // 635 missing out of 835
    setCards(w, 0, { vitality3: 1 });
    expect(p.maxHp).toBeCloseTo(835 * (1 + VIT[3]!), 9);
    expect(p.maxHp - p.hp).toBeCloseTo(635, 9);
    expect(p.hp).toBeCloseTo(200 + (p.maxHp - 835), 9);
  });

  it("a further card adds only the new delta", () => {
    const w = startRun(2);
    const p = P(w, 1);
    setCards(w, 1, { vitality2: 1 });
    p.hp = 400;
    const maxBefore = p.maxHp;
    setCards(w, 1, { vitality2: 1, vitality3: 1 });
    expect(p.hp).toBeCloseTo(400 + (p.maxHp - maxBefore), 9);
  });

  it("a dead player is not healed, though their max hp still follows", () => {
    const w = startRun(3);
    kill(w, 0, attacker(w, 1));
    expect(P(w, 0).hp).toBe(0);
    expect(P(w, 0).status).toBe("dead");
    setCards(w, 0, { vitality3: 1 });
    expect(P(w, 0).hp).toBe(0);
    expect(P(w, 0).maxHp).toBeCloseTo(835 * (1 + VIT[3]!), 9);
  });

  it("is idempotent", () => {
    const w = startRun(2);
    const p = P(w, 0);
    p.hp = 250;
    setCards(w, 0, { vitality3: 1, vitality1: 1 });
    const after = { max: p.maxHp, hp: p.hp };
    for (let i = 0; i < 3; i++) syncMaxHp(p);
    expect({ max: p.maxHp, hp: p.hp }).toEqual(after);
  });

  it("derives from the faction rather than compounding on the current max hp, and clamps hp when the max falls", () => {
    const w = startRun(2);
    const p = P(w, 0);
    setCards(w, 0, { vitality3: 1 });
    expect(p.hp).toBeGreaterThan(835);
    p.build.delete("vitality3");
    recomputeMods(w, cOf(w, 0));
    syncMaxHp(p);
    expect(p.maxHp).toBe(835);
    expect(p.hp).toBe(835);
  });

  it("does nothing for no cards", () => {
    const w = startRun(2);
    const p = P(w, 0);
    p.hp = 123;
    syncMaxHp(p);
    expect([p.maxHp, p.hp]).toEqual([835, 123]);
  });

  it("a card with no maxHp row (Haste, Fleet, Armor) leaves max hp and hp as they were", () => {
    const w = startRun(2);
    P(w, 0).hp = 300;
    grant(w, 0, "haste3", 2);
    grant(w, 0, "fleet3");
    grant(w, 0, "armor3");
    expect([P(w, 0).maxHp, P(w, 0).hp]).toEqual([835, 300]);
  });
});

describe("a kill gives no stat", () => {
  /** p`killer` kills a mob of `region` of this `type` (an elite when `elite`): the hit is recorded and the mob killed at once. */
  function killMobBy(w: World, region: FactionId, elite: boolean, type?: MobTypeId, killer = 0): void {
    const id = placeMob(w, { region, elite, ...(type ? { type } : {}), at: { x: P(w, killer).x + 40, y: P(w, killer).y } });
    const mob = combatant(w, id) as MobCombatant;
    const entry = recordHit(w, {
      victim: id, by: { id: idOf(killer), name: NAMES[killer]! }, packet: { raw: 1, phys: 0, magic: 1, true: 0 }, weapon: "sword", stagger: false,
    });
    w.combat.ledger = [];
    killMob(w, mob, [entry], [mob.s.hp]);
  }

  it("a mob kill pays GV and counts toward the feed, and leaves the build, max hp and every mirror as they were", () => {
    const w = startRun(2);
    P(w, 0).weapon0 = mobWeapon("fire"); // so the mob's weapon is not dropped: this is about the stat
    w.events = [];
    killMobBy(w, "fire", false);
    killMobBy(w, "fire", true, elitesOf("fire")[0]!.id);
    expect(P(w, 0).build.size).toBe(0);
    expect([P(w, 0).maxHp, P(w, 0).hp]).toEqual([835, 835]);
    expect([P(w, 0).asMult, P(w, 0).speedMult, P(w, 0).windupMult, P(w, 0).armorBonus, P(w, 0).shieldBonus, P(w, 0).adBonus, P(w, 0).apBonus])
      .toEqual([1000, 1000, 1000, 0, 0, 0, 0]);
    expect(RT(w, 0).mobKills).toBe(2);
    expect(RT(w, 0).gv.mobs).toBeGreaterThan(0);
    // The retired buff fx (wire kind 10) is never emitted.
    expect(w.events.filter((e) => e.type === "fx").map((e) => (e as { fx: { kind: string } }).fx.kind)).not.toContain("buff");
  });

  it("the reward curve still scales the mob's GV with the killer's feed", () => {
    const hungry = startRun(2);
    killMobBy(hungry, "fire", false);
    const fed = startRun(2);
    P(fed, 0).kills = 12;
    killMobBy(fed, "fire", false);
    expect(mobRewardMultiplier(12, 0)).toBeLessThan(0.31);
    expect(RT(fed, 0).gv.mobs).toBeLessThanOrEqual(RT(hungry, 0).gv.mobs);
  });

  it("draws nothing from world.random: the loot stream is where an untouched world's is", () => {
    const killed = startRun(2);
    const untouched = startRun(2);
    P(killed, 0).weapon0 = mobWeapon("fire"); // so the mob's weapon is not dropped
    killMobBy(killed, "fire", false);
    killMobBy(killed, "fire", true, elitesOf("fire")[0]!.id);
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
    expect(P(w, 1).hp).toBe(800);
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
    expect(P(w, 1).hp).toBe(730);
    expect(P(w, 1).barrier).toBe(0);
  });

  it("applyDamage: a hit equal to the barrier costs no hp and leaves no barrier", () => {
    const w = startRun(3);
    P(w, 1).barrier = 80;
    expect(applyDamage(w, P(w, 1), RT(w, 1), 80, attacker(w, 0))).toBe(0);
    expect(P(w, 1).hp).toBe(800);
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
    applyDamage(w, P(w, 1), RT(w, 1), 100 + 800 + 1, attacker(w, 0));
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
    expect(P(w, 2).hp).toBe(1355);
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

  it("the system sets the barrier to 0 in the tick that reaches shieldUntil, and not before", () => {
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
    const burn = 0.02 * (TICK_MS / 1000) * 835; // SUDDEN_DEATH_START_FRACTION x dt x max hp
    expect(P(w, 0).barrier).toBeCloseTo(10 - burn, 9);
    expect(P(w, 0).hp).toBe(835);
    expect(P(w, 1).hp).toBeCloseTo(800 - 0.02 * (TICK_MS / 1000) * 800, 9); // the unshielded one loses hp
    expect(P(w, 0).status).toBe("alive");
    expect(RT(w, 0).killedBy).toBeNull();
  });
});

describe("a player kill moves no stat", () => {
  /** p0 has `victims` kills (3 puts a bounty on them) and these cards; p4 is the killer. */
  function bountied(cards: Record<string, number>, victims = [1, 2, 3]): World {
    const w = startRun(6);
    slay(w, 0, victims);
    setCards(w, 0, cards);
    w.events = [];
    return w;
  }

  it("a killer who kills a bountied victim is paid the kill and the bounty in GV, and takes none of their cards", () => {
    const w = bountied({ vitality3: 2, haste2: 1, hereComesTheBoom: 1 });
    expect(P(w, 0).bounty).toBe(10);
    kill(w, 0, attacker(w, 4));
    expect(P(w, 4).build.size).toBe(0);
    expect(P(w, 4).maxHp).toBe(1400);
    expect(P(w, 4).asMult).toBe(1000);
    expect(RT(w, 4).gv).toEqual({ kills: GV_KILL, mobs: 0, bounty: 10, quest: 0 });
  });

  it("a victim without a bounty pays no bounty and gives nothing else either, and a kill gives no barrier or burst", () => {
    const w = bountied({ vitality3: 2, haste3: 2 }, [1, 2]); // 2 kills: feed 2, no bounty
    expect(P(w, 0).bounty).toBe(0);
    setCards(w, 4, { vitality2: 1, haste2: 1 });
    const held = [...P(w, 4).build.entries()];
    const maxHp = P(w, 4).maxHp;
    kill(w, 0, attacker(w, 4));
    expect([...P(w, 4).build.entries()]).toEqual(held);
    expect(P(w, 4).maxHp).toBe(maxHp);
    expect(P(w, 4).barrier).toBe(0);
    expect(RT(w, 4).boost).toBeUndefined();
    expect(RT(w, 4).gv.bounty).toBe(0);
  });

  it("a bountied victim who leaves right after a hit still pays the credited rival the bounty (a credited leave), and no cards", () => {
    const w = bountied({ haste3: 2 });
    applyDamage(w, P(w, 0), RT(w, 0), 1, attacker(w, 4));
    removePlayer(w, idOf(0));
    expect(P(w, 4).build.size).toBe(0);
    expect(RT(w, 4).gv.bounty).toBe(10);
  });

  it("a bountied victim who leaves without having been hit pays nobody", () => {
    const w = bountied({ haste3: 2 });
    removePlayer(w, idOf(0));
    expect(P(w, 4).build.size).toBe(0);
    expect(RT(w, 4).gv.bounty).toBe(0);
  });

  it("a killer who went down in the same tick still collects the GV", () => {
    const w = bountied({ vitality3: 1 });
    // p4 is downed (hp 0 and status dead) but unresolved, as in the middle of a tick; then its blow kills p0.
    P(w, 4).status = "dead";
    P(w, 4).hp = 0;
    kill(w, 0, attacker(w, 4));
    expect(P(w, 4).build.size).toBe(0);
    expect(RT(w, 4).gv.bounty).toBe(10);
  });
});

describe("the hooks chain onto whatever was installed before", () => {
  it("installing the module keeps a previous bountyClaimed and playerKilled, and registers its system and move modifier", () => {
    const seed = 99;
    const w = createWorld({ seed, config: makeConfig(6), random: mulberry32(seed) });
    for (let i = 0; i < 6; i++) addPlayer(w, idOf(i), NAMES[i]!);
    step(w, TICK_MS);
    const log: string[] = [];
    w.hooks.bountyClaimed = (_w, killer, victim, bounty) => { log.push(`claimed ${killer.id}<-${victim.id} ${bounty}`); };
    w.hooks.playerKilled = (_w, killer, victim) => { log.push(`killed ${killer.id}<-${victim.id}`); };
    installBuffs(w);
    expect(w.systems).toContain(expireBoosts);
    expect(w.moveModifiers).toContain(moveSpeedMult);
    slay(w, 0, [1, 2, 3]);
    log.length = 0;
    kill(w, 0, attacker(w, 4));
    expect(log).toEqual([`claimed ${idOf(4)}<-${idOf(0)} 10`, `killed ${idOf(4)}<-${idOf(0)}`]);
  });
});

describe("attack speed through the real formulas", () => {
  const paced = (faction: "plague" | "frost") => pacedFaction(FACTIONS[faction]);

  it("with no cards the interval and damage per hit are the paced faction's", () => {
    const w = startRun(4);
    P(w, 2).weapon0 = "sword"; // Plague
    const t = timingsOf(P(w, 2), "sword")!;
    expect(t.interval).toBe(attackInterval(paced("plague"), "sword", 1));
    expect(packetFor(cOf(w, 2), "sword").raw).toBe(damagePerHit(paced("plague"), "sword", 1));
  });

  it("Frost on the axe is far above its floor: the cards shrink the interval and damage per hit stays", () => {
    const w = startRun(4);
    const p = P(w, 3);
    p.weapon0 = "axe";
    const before = timingsOf(p, "axe")!;
    const rawBefore = packetFor(cOf(w, 3), "axe").raw;
    expect(before.interval).toBeGreaterThan(1.5); // 1 / (0.45 x 1.4)
    grant(w, 3, "haste3", 2);
    const m = decodeMult(p.asMult);
    expect(m).toBe(sim(1 + 2 * HASTE[3]!));
    expect(m).toBeGreaterThan(1.06);
    const after = timingsOf(p, "axe")!;
    expect(after.interval).toBeCloseTo(before.interval / m, 9);
    expect(after.interval).toBeGreaterThan(WEAPONS.axe.floor);
    expect(after).toEqual(weaponTimings("axe", attackInterval(paced("frost"), "axe", m)));
    // rate x hit x dps x asMult x interval: the multiplier cancels while no floor binds.
    expect(packetFor(cOf(w, 3), "axe").raw).toBeCloseTo(rawBefore, 9);
    expect(packetFor(cOf(w, 3), "axe").raw).toBeCloseTo(damagePerHit(paced("frost"), "axe", m), 9);
  });

  it("Plague on the sword sits just above the 0.25 s floor: the first cards are damage per hit, not speed", () => {
    const w = startRun(4);
    const p = P(w, 2);
    p.weapon0 = "sword";
    const before = timingsOf(p, "sword")!;
    const rawBefore = packetFor(cOf(w, 2), "sword").raw;
    expect(before.interval).toBeGreaterThan(WEAPONS.sword.floor);
    expect(before.interval).toBeLessThan(0.2515);
    grant(w, 2, "haste3", 2);
    const m = decodeMult(p.asMult);
    expect(m).toBeGreaterThan(1.06);
    const after = timingsOf(p, "sword")!;
    expect(after.interval).toBe(WEAPONS.sword.floor); // held at the floor
    expect(after.interval).toBeLessThan(before.interval); // by a hair
    const raw = packetFor(cOf(w, 2), "sword").raw;
    expect(raw).toBeCloseTo(damagePerHit(paced("plague"), "sword", m), 9);
    expect(raw).toBeGreaterThan(rawBefore * (1 + 0.9 * (m - 1))); // nearly the full bonus turned into damage
    expect(raw / after.interval).toBeGreaterThan((rawBefore / before.interval) * (1 + 0.9 * (m - 1))); // so dps rises with the cards
    // More cards, more damage per hit up to the attack-speed cap, the interval stays on the floor.
    const lessRaw = raw;
    setCards(w, 2, { haste1: 1 });
    expect(packetFor(cOf(w, 2), "sword").raw).toBeLessThan(lessRaw);
    expect(timingsOf(p, "sword")!.interval).toBeGreaterThanOrEqual(WEAPONS.sword.floor);
  });

  it("the bow's interval and share-based draw shrink together with attack-speed cards (G9)", () => {
    const w = startRun(4);
    const fire = P(w, 0);
    fire.weapon0 = "bow";
    const before = timingsOf(fire, "bow")!;
    expect(before.interval).toBeCloseTo(1 / (0.6 * 1.95), 9); // Fire's rate 0.6, the bow's boost 0.95
    expect(before.windup).toBeCloseTo(Math.min(BOW_WINDUP, BOW_WINDUP_SHARE * before.interval), 9);
    grant(w, 0, "haste3");
    const m = decodeMult(fire.asMult);
    expect(m).toBe(sim(1 + HASTE[3]!));
    const after = timingsOf(fire, "bow")!;
    expect(after.interval).toBeCloseTo(before.interval / m, 9);
    expect(after.windup).toBeCloseTo(Math.min(BOW_WINDUP, BOW_WINDUP_SHARE * after.interval), 9);
    // Plague's bow starts 0.277 s: the draw is 30% of the interval at base speed. A small card leaves the interval above the
    // 0.25 s floor, where it follows the multiplier; Haste III takes it to the floor, where the interval holds and the rest of
    // the speed is damage per hit (as the sword's test above). The draw follows its interval share with attack speed.
    const plague = P(w, 2);
    plague.weapon0 = "bow";
    const plagueBefore = timingsOf(plague, "bow")!;
    expect(plagueBefore.interval).toBeGreaterThan(WEAPONS.bow.floor);
    expect(plagueBefore.windup).toBeCloseTo(BOW_WINDUP_SHARE * plagueBefore.interval, 9);
    expect(plagueBefore.interval / sim(1 + HASTE[1]!)).toBeGreaterThan(WEAPONS.bow.floor); // Haste I: no floor binds
    expect(plagueBefore.interval / sim(1 + HASTE[3]!)).toBeLessThan(WEAPONS.bow.floor); // Haste III: the floor binds
    for (const id of ["haste1", "haste3"]) {
      const v = startRun(4);
      grant(v, 2, id);
      const pv = P(v, 2);
      pv.weapon0 = "bow";
      const t = timingsOf(pv, "bow")!;
      const mv = decodeMult(pv.asMult);
      expect(t.interval, id).toBeCloseTo(Math.max(WEAPONS.bow.floor, plagueBefore.interval / mv), 9);
      expect(t.interval, id).toBeGreaterThanOrEqual(WEAPONS.bow.floor);
      expect(t.windup, id).toBeCloseTo(Math.min(BOW_WINDUP, BOW_WINDUP_SHARE * t.interval), 9);
      expect(t.windup, id).toBeLessThan(plagueBefore.windup);
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
  it("Fleet is a registered moveModifier of a game world, not a part of moveMultiplierOf", () => {
    const w = startRun(2);
    grant(w, 0, "fleet2");
    expect(w.moveModifiers).toContain(moveSpeedMult);
    expect(moveMultiplierOf(w, cOf(w, 0))).toBe(1);
    expect(effectiveMove(w, cOf(w, 0))).toBe(sim(1 + FLEET[2]!));
  });

  it("a player with a Fleet card really walks farther per tick (the step loop applies the modifier)", () => {
    // An open floor, so the chase is a straight line, with the target far enough to be walked towards for several ticks.
    const W = 40;
    const H = 20;
    const tiles = new Uint8Array(W * H).fill(TILE_FLOOR);
    for (let tx = 0; tx < W; tx++) { tiles[tx] = TILE_WALL; tiles[(H - 1) * W + tx] = TILE_WALL; }
    for (let ty = 0; ty < H; ty++) { tiles[ty * W] = TILE_WALL; tiles[ty * W + W - 1] = TILE_WALL; }
    const spawns = Array.from({ length: 8 }, (_, i) => ({ x: TILE * (3 + 3 * i) + TILE / 2, y: TILE * 10 + TILE / 2 }));
    const map: GameMap = { ...mapFromTiles(W, H, tiles), spawns };
    // Distance walked in the 4th tick of a chase of a target 14 tiles away.
    const run = (fleet: boolean): number => {
      const world = createGameWorld({ config: makeConfig(2), random: mulberry32(8), map });
      addPlayer(world, "p0", "alice");
      addPlayer(world, "p1", "bob");
      step(world, TICK_MS);
      if (fleet) grant(world, 0, "fleet2");
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
    const plain = run(false);
    expect(plain).toBeCloseTo(PLAYER_SPEED * (TICK_MS / 1000), 6);
    expect(run(true) / plain).toBeCloseTo(sim(1 + FLEET[2]!), 6);
  });

  it("is 1 with nothing on", () => {
    const w = startRun(2);
    expect(effectiveMove(w, cOf(w, 0))).toBe(1);
  });

  it("includes the Fleet bonus while the player is not shooting, and not for a shooter (a bow or wand shot pauses it)", () => {
    const w = startRun(2);
    grant(w, 0, "fleet3");
    expect(effectiveMove(w, cOf(w, 0))).toBe(sim(1 + FLEET[3]!));
    RT(w, 0).weapon.lastShotAt = w.state.serverTime;
    tick(w);
    expect(effectiveMove(w, cOf(w, 0))).toBe(1);
  });

  it("is 0 while rooted whatever the cards say", () => {
    const w = startRun(2);
    grant(w, 0, "fleet3", 3);
    expect(effectiveMove(w, cOf(w, 0))).toBeGreaterThan(1);
    RT(w, 0).weapon.rootUntil = w.state.serverTime + 100;
    expect(effectiveMove(w, cOf(w, 0))).toBe(0);
    RT(w, 0).weapon.rootUntil = w.state.serverTime; // over at the instant
    expect(effectiveMove(w, cOf(w, 0))).toBeGreaterThan(1);
  });

  it("is 0 while an attack winds up, whatever the cards say", () => {
    const w = startRun(2);
    grant(w, 0, "fleet2");
    expect(effectiveMove(w, cOf(w, 0))).toBe(sim(1 + FLEET[2]!));
    RT(w, 0).weapon.action = {
      kind: "cast", weapon: "wand", startedAt: w.state.serverTime, landsAt: w.state.serverTime + 100, a: 0,
      packet: { raw: 1, phys: 0, magic: 1, true: 0 }, origin: { x: 0, y: 0 },
    };
    expect(effectiveMove(w, cOf(w, 0))).toBe(0);
  });
});

// Buffs on the server (sim/buffs.ts and the hunks it feeds in arena.ts, combatant.ts, weapons.ts): the multipliers, max hp,
// granting stacks, the kill combos, the kill shield, the bounty transfer and the real attack/move formulas. The shared
// maths (S-curve, combo table) is tested in packages/shared/test/buffs.test.ts; this is the part that touches the sim.
import { describe, expect, it } from "vitest";
import {
  attackInterval, BOUNTY_STACK_SHARE, BUFF_STATS, buffMultiplier, damagePerHit, FACTIONS, GV_KILL, mulberry32, pacedFaction,
  TICK_MS, WAND_CAST_MOVE, weaponTimings, WEAPONS, type BuffStat, type FxEvent,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { applyDamage, applyHits, suddenDeath, type Attacker } from "../src/sim/arena";
import {
  absorbShield, attackSpeedMult, baseMaxHp, expireBoosts, grantStacks, install as installBuffs, moveSpeedMult, onKill,
  stacksOf, syncMaxHp, transferStacks,
} from "../src/sim/buffs";
import { combatant, timingsOf, type Combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { applyLedger } from "../src/sim/ledger";
import { addMob } from "../src/sim/mobs";
import { addPlayer, removePlayer, step } from "../src/sim/step";
import { moveMultiplierOf, packetFor } from "../src/sim/weapons";
import { createWorld, type SimConfig, type SimEvent, type World } from "../src/sim/world";

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

/** Damage that is certainly lethal to a player (their kill shield included). */
function kill(world: World, victim: number, source: Attacker | string = "test"): number {
  const p = P(world, victim);
  return applyDamage(world, p, RT(world, victim), p.hp + p.barrier + 1000, source);
}

const STAT_FIELD = { hp: "stacksHp", attackSpeed: "stacksAs", moveSpeed: "stacksMs" } as const;

/** Sets stacks straight on the state (no fx, no combo), the way a test wants them, and brings max hp along. */
function setStacks(world: World, i: number, stacks: Partial<Record<BuffStat, number>>): void {
  const p = P(world, i);
  for (const stat of BUFF_STATS) if (stacks[stat] !== undefined) p[STAT_FIELD[stat]] = stacks[stat]!;
  syncMaxHp(p);
}

/** `i` makes `n` kills (of the players at the end of the list), which puts a bounty on them from the 3rd. */
function slay(world: World, i: number, victims: number[]): void {
  for (const v of victims) kill(world, v, attacker(world, i));
}

describe("the multipliers", () => {
  it("attackSpeedMult is 1 for a player without stacks", () => {
    const w = startRun(2);
    expect(attackSpeedMult(P(w, 0))).toBe(1);
    expect(moveSpeedMult(w, cOf(w, 0))).toBe(1);
  });

  it("attackSpeedMult and moveSpeedMult are 1 for a mob state of any kind", () => {
    const w = startRun(2);
    for (const kind of ["dummy", "mob", "elite"] as const) {
      const id = addMob(w, { kind, name: kind, faction: kind === "dummy" ? undefined : "fire", at: { x: P(w, 0).x, y: P(w, 0).y } });
      const m = w.state.mobs.get(id)!;
      expect(attackSpeedMult(m), kind).toBe(1);
      expect(moveSpeedMult(w, combatant(w, id)!), kind).toBe(1);
      expect(stacksOf(m), kind).toEqual({ hp: 0, attackSpeed: 0, moveSpeed: 0 });
    }
  });

  it("stacksOf reads the three stacks of a player", () => {
    const w = startRun(2);
    P(w, 0).stacksHp = 1;
    P(w, 0).stacksAs = 2.5;
    P(w, 0).stacksMs = 4;
    expect(stacksOf(P(w, 0))).toEqual({ hp: 1, attackSpeed: 2.5, moveSpeed: 4 });
  });

  it("attackSpeedMult is the S-curve of the attack-speed stacks only", () => {
    const w = startRun(2);
    setStacks(w, 0, { hp: 8, moveSpeed: 8 });
    expect(attackSpeedMult(P(w, 0))).toBe(1);
    for (const n of [0.5, 1, 2, 3, 4, 5, 8]) {
      P(w, 0).stacksAs = n;
      expect(attackSpeedMult(P(w, 0)), `${n} stacks`).toBe(buffMultiplier("attackSpeed", n));
    }
    // The design table (GAME_DESIGN 12.2): +23% at 3 stacks, +42% at 5.
    P(w, 0).stacksAs = 3;
    expect(Math.round((attackSpeedMult(P(w, 0)) - 1) * 100)).toBe(23);
    P(w, 0).stacksAs = 5;
    expect(Math.round((attackSpeedMult(P(w, 0)) - 1) * 100)).toBe(42);
  });

  it("moveSpeedMult is the S-curve of the move-speed stacks only (+14% at 3) while no burst runs", () => {
    const w = startRun(2);
    setStacks(w, 0, { hp: 8, attackSpeed: 8 });
    expect(moveSpeedMult(w, cOf(w, 0))).toBe(1);
    P(w, 0).stacksMs = 3;
    expect(moveSpeedMult(w, cOf(w, 0))).toBe(buffMultiplier("moveSpeed", 3));
    expect(Math.round((moveSpeedMult(w, cOf(w, 0)) - 1) * 100)).toBe(14);
  });
});

describe("syncMaxHp", () => {
  it("max hp is the faction's hp times the hp multiplier, and a full bar stays full", () => {
    const w = startRun(5);
    for (let i = 0; i < 5; i++) {
      const base = [500, 700, 1000, 1750, 1450][i]!;
      const p = P(w, i);
      expect(baseMaxHp(p), `p${i}`).toBe(base);
      p.stacksHp = 3;
      syncMaxHp(p);
      expect(p.maxHp, `p${i}`).toBeCloseTo(base * buffMultiplier("hp", 3), 9);
      expect(p.hp, `p${i}`).toBeCloseTo(p.maxHp, 9);
    }
    expect(Math.round((P(w, 0).maxHp / 500 - 1) * 100)).toBe(32); // +32% at 3 stacks
  });

  it("hp rises by the same delta, so the missing hp is kept", () => {
    const w = startRun(2);
    const p = P(w, 0);
    p.hp = 200; // 300 missing out of 500
    p.stacksHp = 4;
    syncMaxHp(p);
    expect(p.maxHp).toBeCloseTo(500 * buffMultiplier("hp", 4), 9);
    expect(p.maxHp - p.hp).toBeCloseTo(300, 9);
    expect(p.hp).toBeCloseTo(200 + (p.maxHp - 500), 9);
  });

  it("a further stack adds only the new delta", () => {
    const w = startRun(2);
    const p = P(w, 1);
    p.stacksHp = 2;
    syncMaxHp(p);
    p.hp = 400;
    const maxBefore = p.maxHp;
    p.stacksHp = 3;
    syncMaxHp(p);
    expect(p.hp).toBeCloseTo(400 + (p.maxHp - maxBefore), 9);
  });

  it("a dead player is not healed, though their max hp still follows", () => {
    const w = startRun(3);
    kill(w, 0, attacker(w, 1));
    expect(P(w, 0).hp).toBe(0);
    expect(P(w, 0).status).toBe("dead");
    P(w, 0).stacksHp = 5;
    syncMaxHp(P(w, 0));
    expect(P(w, 0).hp).toBe(0);
    expect(P(w, 0).maxHp).toBeCloseTo(500 * buffMultiplier("hp", 5), 9);
  });

  it("is idempotent", () => {
    const w = startRun(2);
    const p = P(w, 0);
    p.hp = 250;
    p.stacksHp = 3.7;
    syncMaxHp(p);
    const after = { max: p.maxHp, hp: p.hp };
    for (let i = 0; i < 3; i++) syncMaxHp(p);
    expect({ max: p.maxHp, hp: p.hp }).toEqual(after);
  });

  it("derives from the faction rather than compounding on the current max hp, and clamps hp when the max falls", () => {
    const w = startRun(2);
    const p = P(w, 0);
    p.stacksHp = 3;
    syncMaxHp(p);
    expect(p.hp).toBeGreaterThan(500);
    p.stacksHp = 0;
    syncMaxHp(p);
    expect(p.maxHp).toBe(500);
    expect(p.hp).toBe(500);
  });

  it("does nothing for no stacks", () => {
    const w = startRun(2);
    const p = P(w, 0);
    p.hp = 123;
    syncMaxHp(p);
    expect([p.maxHp, p.hp]).toEqual([500, 123]);
  });
});

describe("grantStacks", () => {
  it.each(BUFF_STATS.map((s) => [s]))("adds %s stacks, with a buff fx carrying the amount and the new total", (stat) => {
    const w = startRun(2);
    w.events = [];
    grantStacks(w, P(w, 0), RT(w, 0), stat, 1.5);
    grantStacks(w, P(w, 0), RT(w, 0), stat, 0.25);
    expect(P(w, 0)[STAT_FIELD[stat]]).toBeCloseTo(1.75, 9);
    expect(fxOf(w.events, "buff")).toEqual([
      { kind: "buff", id: idOf(0), stat, stacks: 1.5, total: 1.5 },
      { kind: "buff", id: idOf(0), stat, stacks: 0.25, total: 1.75 },
    ]);
    expect(fxOf(w.events, "combo")).toEqual([]);
    // The other two stats are untouched.
    for (const other of BUFF_STATS.filter((s) => s !== stat)) expect(P(w, 0)[STAT_FIELD[other]], other).toBe(0);
  });

  it("hp stacks change max hp and bring the hp with them; the other stats leave both alone", () => {
    const w = startRun(2);
    grantStacks(w, P(w, 0), RT(w, 0), "attackSpeed", 4);
    grantStacks(w, P(w, 0), RT(w, 0), "moveSpeed", 4);
    expect([P(w, 0).maxHp, P(w, 0).hp]).toEqual([500, 500]);
    P(w, 0).hp = 300;
    grantStacks(w, P(w, 0), RT(w, 0), "hp", 3);
    const max = 500 * buffMultiplier("hp", 3);
    expect(P(w, 0).maxHp).toBeCloseTo(max, 9);
    expect(P(w, 0).hp).toBeCloseTo(300 + (max - 500), 9);
  });

  it.each([
    ["hp", "shield", "bulwark"], ["attackSpeed", "dash", "cascade"], ["moveSpeed", "bloodrush", "frenzy"],
  ] as const)("%s: a combo fx with proc false is sent once on crossing 3 stacks (%s) and again on crossing 5 (%s)", (stat, at3, at5) => {
    const w = startRun(2);
    const combos: Array<[number, string]> = [];
    for (const amount of [1, 1, 1, 1, 1, 1]) { // totals 1..6
      w.events = [];
      grantStacks(w, P(w, 0), RT(w, 0), stat, amount);
      for (const fx of fxOf(w.events, "combo")) {
        expect(fx.proc).toBe(false);
        expect(fx.id).toBe(idOf(0));
        combos.push([P(w, 0)[STAT_FIELD[stat]], fx.combo]);
      }
    }
    expect(combos).toEqual([[3, at3], [5, at5]]);
  });

  it("counts fractions that add up to 3: 1.5 + 1.5 crosses on the second grant, 2.9 + 0.1 on the second", () => {
    const w = startRun(3);
    w.events = [];
    grantStacks(w, P(w, 0), RT(w, 0), "attackSpeed", 1.5);
    expect(fxOf(w.events, "combo")).toEqual([]);
    grantStacks(w, P(w, 0), RT(w, 0), "attackSpeed", 1.5);
    expect(fxOf(w.events, "combo")).toEqual([{ kind: "combo", id: idOf(0), combo: "dash", proc: false }]);
    w.events = [];
    grantStacks(w, P(w, 1), RT(w, 1), "moveSpeed", 2.9);
    grantStacks(w, P(w, 1), RT(w, 1), "moveSpeed", 0.1);
    expect(fxOf(w.events, "combo")).toEqual([{ kind: "combo", id: idOf(1), combo: "bloodrush", proc: false }]);
  });

  it("a single grant that jumps past both thresholds announces only the combo it ends on", () => {
    const w = startRun(2);
    w.events = [];
    grantStacks(w, P(w, 0), RT(w, 0), "attackSpeed", 5.5);
    expect(fxOf(w.events, "combo")).toEqual([{ kind: "combo", id: idOf(0), combo: "cascade", proc: false }]);
  });

  it("sends no combo fx while staying inside a tier", () => {
    const w = startRun(2);
    setStacks(w, 0, { attackSpeed: 3 });
    w.events = [];
    grantStacks(w, P(w, 0), RT(w, 0), "attackSpeed", 1.9);
    grantStacks(w, P(w, 0), RT(w, 0), "attackSpeed", 0.05); // 4.95: still tier 1
    expect(fxOf(w.events, "buff")).toHaveLength(2);
    expect(fxOf(w.events, "combo")).toEqual([]);
  });

  it("is ignored for a player whose result is out", () => {
    const w = startRun(3);
    RT(w, 0).resolved = true;
    w.events = [];
    grantStacks(w, P(w, 0), RT(w, 0), "hp", 4);
    expect(stacksOf(P(w, 0))).toEqual({ hp: 0, attackSpeed: 0, moveSpeed: 0 });
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
    grantStacks(w, P(w, 0), RT(w, 0), "attackSpeed", 4);
    grantStacks(w, p2, rt2, "attackSpeed", 4);
    grantStacks(w, P(w, 3), RT(w, 3), "moveSpeed", 4);
    expect([P(w, 0).stacksAs, p2.stacksAs, P(w, 3).stacksMs]).toEqual([0, 0, 0]);
    expect(w.events).toEqual([]);
  });

  it.each([0, -1, -0.5, NaN])("is ignored for an amount of %s", (amount) => {
    const w = startRun(2);
    P(w, 0).stacksHp = 2;
    w.events = [];
    grantStacks(w, P(w, 0), RT(w, 0), "hp", amount);
    expect(P(w, 0).stacksHp).toBe(2);
    expect(w.events).toEqual([]);
  });
});

describe("onKill", () => {
  const killNow = (w: World, i: number): void => onKill(w, P(w, i), RT(w, i));

  it("does nothing below 3 stacks: no boost is even created", () => {
    const w = startRun(2);
    setStacks(w, 0, { hp: 2.99, attackSpeed: 2.5, moveSpeed: 0 });
    P(w, 0).readyAt = w.state.serverTime + 5000;
    const readyAt = P(w, 0).readyAt;
    w.events = [];
    killNow(w, 0);
    expect(RT(w, 0).boost).toBeUndefined();
    expect(P(w, 0).barrier).toBe(0);
    expect(P(w, 0).readyAt).toBe(readyAt);
    expect(w.events).toEqual([]);
  });

  it("attack speed 3 (Dash): a 2.5x burst for 400 ms, recorded on the runtime, a combo fx with proc true", () => {
    const w = startRun(2);
    const now = w.state.serverTime;
    setStacks(w, 0, { attackSpeed: 3 });
    P(w, 0).readyAt = now + 5000;
    w.events = [];
    killNow(w, 0);
    expect(RT(w, 0).boost).toEqual({ bursts: [{ mult: 2.5, until: now + 400 }], shieldUntil: 0 });
    expect(fxOf(w.events, "combo")).toEqual([{ kind: "combo", id: idOf(0), combo: "dash", proc: true }]);
    expect(P(w, 0).barrier).toBe(0);
    expect(P(w, 0).readyAt).toBe(now + 5000); // tier 1 does not reset the cooldown
  });

  it("the Dash burst is what moveSpeedMult returns while it runs, and 1 once it is over", () => {
    const w = startRun(2);
    const now = w.state.serverTime;
    setStacks(w, 0, { attackSpeed: 3 });
    killNow(w, 0);
    const c = cOf(w, 0);
    expect(moveSpeedMult(w, c)).toBe(2.5);
    w.state.serverTime = now + 399;
    expect(moveSpeedMult(w, c)).toBe(2.5);
    // Over at `until`, even before expireBoosts has swept it away.
    w.state.serverTime = now + 400;
    expect(moveSpeedMult(w, c)).toBe(1);
    expect(RT(w, 0).boost!.bursts).toHaveLength(1);
    expireBoosts(w);
    expect(RT(w, 0).boost!.bursts).toEqual([]);
    expect(moveSpeedMult(w, c)).toBe(1);
  });

  it("the expireBoosts system sweeps the burst in the tick that reaches `until`", () => {
    const w = startRun(2);
    const until = w.state.serverTime + 400;
    setStacks(w, 0, { attackSpeed: 3 });
    killNow(w, 0);
    runTo(w, until - TICK_MS);
    expect(RT(w, 0).boost!.bursts).toHaveLength(1);
    tick(w);
    expect(w.state.serverTime).toBe(until);
    expect(RT(w, 0).boost!.bursts).toEqual([]);
  });

  it("attack speed 5 (Cascade): the dash and a cooldown reset (readyAt <= now)", () => {
    const w = startRun(2);
    const now = w.state.serverTime;
    setStacks(w, 0, { attackSpeed: 5 });
    P(w, 0).readyAt = now + 5000;
    w.events = [];
    killNow(w, 0);
    expect(P(w, 0).readyAt).toBeLessThanOrEqual(now);
    expect(RT(w, 0).boost!.bursts).toEqual([{ mult: 2.5, until: now + 400 }]);
    // Tier 2 replaces tier 1: one combo fx, "cascade".
    expect(fxOf(w.events, "combo")).toEqual([{ kind: "combo", id: idOf(0), combo: "cascade", proc: true }]);
  });

  it("the cooldown reset never pushes a cooldown that has already ended forward", () => {
    const w = startRun(2);
    setStacks(w, 0, { attackSpeed: 5 });
    P(w, 0).readyAt = 10;
    killNow(w, 0);
    expect(P(w, 0).readyAt).toBe(10);
  });

  it("hp 3 (shield): 15% of max hp for 5 s", () => {
    const w = startRun(2);
    const now = w.state.serverTime;
    setStacks(w, 0, { hp: 3 });
    w.events = [];
    killNow(w, 0);
    expect(P(w, 0).barrier).toBeCloseTo(0.15 * P(w, 0).maxHp, 6);
    expect(RT(w, 0).boost).toEqual({ bursts: [], shieldUntil: now + 5000 });
    expect(fxOf(w.events, "combo")).toEqual([{ kind: "combo", id: idOf(0), combo: "shield", proc: true }]);
  });

  it("hp 5 (Bulwark): 30% of max hp for 8 s, not the sum of both tiers", () => {
    const w = startRun(2);
    const now = w.state.serverTime;
    setStacks(w, 0, { hp: 5 });
    w.events = [];
    killNow(w, 0);
    expect(P(w, 0).barrier).toBeCloseTo(0.3 * P(w, 0).maxHp, 6);
    expect(RT(w, 0).boost!.shieldUntil).toBe(now + 8000);
    expect(fxOf(w.events, "combo")).toEqual([{ kind: "combo", id: idOf(0), combo: "bulwark", proc: true }]);
  });

  it("the shield is a share of the max hp the hp stacks gave", () => {
    const w = startRun(4);
    setStacks(w, 3, { hp: 3 }); // Frost
    killNow(w, 3);
    expect(P(w, 3).barrier).toBeCloseTo(0.15 * 1750 * buffMultiplier("hp", 3), 6);
  });

  it("a second kill refreshes the shield to full and extends its time, it does not stack", () => {
    const w = startRun(2);
    setStacks(w, 0, { hp: 3 });
    killNow(w, 0);
    const full = P(w, 0).barrier;
    P(w, 0).barrier = full / 3; // mostly absorbed
    w.state.serverTime += 2000;
    killNow(w, 0);
    expect(P(w, 0).barrier).toBeCloseTo(full, 6);
    expect(RT(w, 0).boost!.shieldUntil).toBe(w.state.serverTime + 5000);
    w.state.serverTime += 1000;
    killNow(w, 0); // still full: not doubled
    expect(P(w, 0).barrier).toBeCloseTo(full, 6);
  });

  it("move speed 3 (Bloodrush): 1.5x for 3 s on top of the stacks' own bonus", () => {
    const w = startRun(2);
    const now = w.state.serverTime;
    setStacks(w, 0, { moveSpeed: 3 });
    w.events = [];
    killNow(w, 0);
    expect(RT(w, 0).boost!.bursts).toEqual([{ mult: 1.5, until: now + 3000 }]);
    expect(moveSpeedMult(w, cOf(w, 0))).toBeCloseTo(buffMultiplier("moveSpeed", 3) * 1.5, 9);
    expect(fxOf(w.events, "combo")).toEqual([{ kind: "combo", id: idOf(0), combo: "bloodrush", proc: true }]);
    w.state.serverTime = now + 3000;
    expect(moveSpeedMult(w, cOf(w, 0))).toBe(buffMultiplier("moveSpeed", 3));
  });

  it("move speed 5 (Frenzy run): 1.8x for 5 s, replacing the 1.5x", () => {
    const w = startRun(2);
    const now = w.state.serverTime;
    setStacks(w, 0, { moveSpeed: 5 });
    w.events = [];
    killNow(w, 0);
    expect(RT(w, 0).boost!.bursts).toEqual([{ mult: 1.8, until: now + 5000 }]);
    expect(moveSpeedMult(w, cOf(w, 0))).toBeCloseTo(buffMultiplier("moveSpeed", 5) * 1.8, 9);
    expect(fxOf(w.events, "combo")).toEqual([{ kind: "combo", id: idOf(0), combo: "frenzy", proc: true }]);
  });

  it("two stats at once set off both: the strongest running burst applies, not their product", () => {
    const w = startRun(2);
    const now = w.state.serverTime;
    setStacks(w, 0, { hp: 3, attackSpeed: 3, moveSpeed: 5 });
    w.events = [];
    killNow(w, 0);
    expect(P(w, 0).barrier).toBeCloseTo(0.15 * P(w, 0).maxHp, 6);
    expect(RT(w, 0).boost!.bursts).toEqual([{ mult: 2.5, until: now + 400 }, { mult: 1.8, until: now + 5000 }]);
    expect(fxOf(w.events, "combo").map((fx) => [fx.combo, fx.proc]).sort()).toEqual([
      ["dash", true], ["frenzy", true], ["shield", true],
    ]);
    const stackMult = buffMultiplier("moveSpeed", 5);
    expect(moveSpeedMult(w, cOf(w, 0))).toBeCloseTo(stackMult * 2.5, 9); // not 2.5 x 1.8
    w.state.serverTime = now + 400;
    expect(moveSpeedMult(w, cOf(w, 0))).toBeCloseTo(stackMult * 1.8, 9);
    w.state.serverTime = now + 5000;
    expect(moveSpeedMult(w, cOf(w, 0))).toBeCloseTo(stackMult, 9);
  });

  it("expireBoosts keeps a burst that is still running and drops the others", () => {
    const w = startRun(2);
    const now = w.state.serverTime;
    setStacks(w, 0, { attackSpeed: 3, moveSpeed: 3 });
    killNow(w, 0); // 2.5x until now+400 and 1.5x until now+3000
    w.state.serverTime = now + 1000;
    expireBoosts(w);
    expect(RT(w, 0).boost!.bursts).toEqual([{ mult: 1.5, until: now + 3000 }]);
  });

  it("is ignored for a player who is out or whose result is out", () => {
    const w = startRun(3);
    setStacks(w, 0, { hp: 5, attackSpeed: 5, moveSpeed: 5 });
    setStacks(w, 1, { hp: 5, attackSpeed: 5, moveSpeed: 5 });
    RT(w, 0).resolved = true;
    P(w, 1).status = "dead";
    w.events = [];
    killNow(w, 0);
    killNow(w, 1);
    for (const i of [0, 1]) {
      expect(RT(w, i).boost, `p${i}`).toBeUndefined();
      expect(P(w, i).barrier, `p${i}`).toBe(0);
    }
    expect(w.events).toEqual([]);
  });
});

describe("the kill shield", () => {
  it("absorbShield: no shield passes the whole amount, a small hit only shrinks the shield, a big one takes the rest off", () => {
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

  it("absorbShield: a hit that empties the shield exactly leaves none, and slivers under 0.001 are dropped", () => {
    const w = startRun(2);
    const p = P(w, 0);
    p.barrier = 25;
    expect(absorbShield(p, 25)).toBe(0);
    expect(p.barrier).toBe(0);
    p.barrier = 25.0005;
    expect(absorbShield(p, 25)).toBe(0);
    expect(p.barrier).toBe(0);
  });

  it("applyDamage: a hit smaller than the shield only shrinks it: no hp lost, no kill, no stagger-worthy damage returned", () => {
    const w = startRun(3);
    P(w, 1).barrier = 100;
    w.events = [];
    expect(applyDamage(w, P(w, 1), RT(w, 1), 40, attacker(w, 0))).toBe(0);
    expect(P(w, 1).hp).toBe(700);
    expect(P(w, 1).barrier).toBe(60);
    expect(P(w, 1).status).toBe("alive");
    expect(w.events).toEqual([]);
    // The blow was still dealt by p0: it counts for the win bonus and for leave credit (the shield is a buffer on hp, unlike
    // teleport immunity, which ignores the blow before it gets that far).
    expect(RT(w, 0).damaged.has(idOf(1))).toBe(true);
    expect(RT(w, 1).lastHit).toEqual({ by: idOf(0), at: w.state.serverTime });
  });

  it("applyDamage: a hit larger than the shield takes the rest off hp, and returns that part", () => {
    const w = startRun(3);
    P(w, 1).barrier = 30;
    expect(applyDamage(w, P(w, 1), RT(w, 1), 100, attacker(w, 0))).toBe(70);
    expect(P(w, 1).hp).toBe(630);
    expect(P(w, 1).barrier).toBe(0);
  });

  it("applyDamage: a hit equal to the shield costs no hp and leaves no shield", () => {
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
    // The next blow gets through what the shield has left and kills; the hp removed is what there was.
    expect(applyDamage(w, P(w, 1), RT(w, 1), 100, attacker(w, 0))).toBe(10);
    expect(P(w, 1).status).toBe("dead");
    expect(P(w, 1).barrier).toBe(0);
    expect(P(w, 0).kills).toBe(1);
  });

  it("applyDamage: a blow bigger than shield plus hp kills, and the killer is paid as usual", () => {
    const w = startRun(3);
    P(w, 1).barrier = 100;
    w.events = [];
    applyDamage(w, P(w, 1), RT(w, 1), 100 + 700 + 1, attacker(w, 0));
    expect(P(w, 1).status).toBe("dead");
    expect(P(w, 0).kills).toBe(1);
    expect(RT(w, 0).gv.kills).toBe(GV_KILL);
    expect(fxOf(w.events, "death")).toHaveLength(1);
  });

  it("applyHits: simultaneous hits are summed first, then the shield takes its share of the sum; both attackers count as damagers", () => {
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

  it("the buffs system sets the shield to 0 in the tick that reaches shieldUntil, and not before", () => {
    const w = startRun(3);
    const until = w.state.serverTime + 5000;
    setStacks(w, 0, { hp: 3 });
    onKill(w, P(w, 0), RT(w, 0));
    expect(RT(w, 0).boost!.shieldUntil).toBe(until);
    runTo(w, until - TICK_MS);
    expect(P(w, 0).barrier).toBeGreaterThan(0);
    tick(w);
    expect(w.state.serverTime).toBe(until);
    expect(P(w, 0).barrier).toBe(0);
    expect(RT(w, 0).boost!.shieldUntil).toBe(0);
    expect(P(w, 0).hp).toBeCloseTo(P(w, 0).maxHp, 9); // and nothing came off the hp
  });

  it("sudden death goes through the ledger like every other hit, so a shielded player is burnt through the shield first", () => {
    // What the code does, worth knowing: the shield is not exempt from sudden death, nor immune to it. A 5-8 s shield only delays it.
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

describe("the bounty moves half the victim's stacks to the killer", () => {
  /** p0 has `kills` kills (3+ puts a bounty on them) and these stacks; p4 is the killer. */
  function bountied(stacks: Partial<Record<BuffStat, number>>, victims = [1, 2, 3]): World {
    const w = startRun(6);
    slay(w, 0, victims);
    setStacks(w, 0, stacks);
    w.events = [];
    return w;
  }

  it("a killer who kills a bountied victim gets exactly 50% of each of their stacks, with a buff fx per stat", () => {
    const w = bountied({ hp: 4, attackSpeed: 2.5, moveSpeed: 1 });
    expect(P(w, 0).bounty).toBe(10);
    expect(BOUNTY_STACK_SHARE).toBe(0.5);
    kill(w, 0, attacker(w, 4));
    expect(stacksOf(P(w, 4))).toEqual({ hp: 2, attackSpeed: 1.25, moveSpeed: 0.5 });
    expect(fxOf(w.events, "buff")).toEqual([
      { kind: "buff", id: idOf(4), stat: "hp", stacks: 2, total: 2 },
      { kind: "buff", id: idOf(4), stat: "attackSpeed", stacks: 1.25, total: 1.25 },
      { kind: "buff", id: idOf(4), stat: "moveSpeed", stacks: 0.5, total: 0.5 },
    ]);
    // The bounty GV came with it.
    expect(RT(w, 4).gv).toEqual({ kills: GV_KILL, mobs: 0, bounty: 10 });
  });

  it("max hp follows the hp stacks gained, and the killer's hp rises by the same delta", () => {
    const w = bountied({ hp: 4 });
    P(w, 4).hp = 1000; // Holy, 1450 max, wounded
    kill(w, 0, attacker(w, 4));
    const max = 1450 * buffMultiplier("hp", 2);
    expect(P(w, 4).maxHp).toBeCloseTo(max, 9);
    expect(P(w, 4).hp).toBeCloseTo(1000 + (max - 1450), 9);
  });

  it("adds to what the killer already holds", () => {
    const w = bountied({ attackSpeed: 3 });
    setStacks(w, 4, { attackSpeed: 1 });
    kill(w, 0, attacker(w, 4));
    expect(P(w, 4).stacksAs).toBe(2.5);
    expect(fxOf(w.events, "buff")).toEqual([{ kind: "buff", id: idOf(4), stat: "attackSpeed", stacks: 1.5, total: 2.5 }]);
  });

  it("a stat the victim has none of sends no fx", () => {
    const w = bountied({ moveSpeed: 2 });
    kill(w, 0, attacker(w, 4));
    expect(fxOf(w.events, "buff").map((fx) => fx.stat)).toEqual(["moveSpeed"]);
  });

  it("a victim without a bounty transfers nothing", () => {
    const w = bountied({ hp: 6, attackSpeed: 6, moveSpeed: 6 }, [1, 2]); // 2 kills: feed 2, no bounty
    expect(P(w, 0).bounty).toBe(0);
    kill(w, 0, attacker(w, 4));
    expect(stacksOf(P(w, 4))).toEqual({ hp: 0, attackSpeed: 0, moveSpeed: 0 });
    expect(P(w, 4).maxHp).toBe(1450);
    expect(fxOf(w.events, "buff")).toEqual([]);
    expect(RT(w, 4).gv.bounty).toBe(0);
  });

  it("a victim killed by something that is not a player transfers nothing", () => {
    const w = bountied({ hp: 6, attackSpeed: 6 });
    kill(w, 0, "test");
    expect(stacksOf(P(w, 4))).toEqual({ hp: 0, attackSpeed: 0, moveSpeed: 0 });
    expect(fxOf(w.events, "buff")).toEqual([]);
  });

  it("a bountied victim who leaves right after a hit passes their stacks on too (a credited leave)", () => {
    const w = bountied({ attackSpeed: 4 });
    applyDamage(w, P(w, 0), RT(w, 0), 1, attacker(w, 4));
    removePlayer(w, idOf(0));
    expect(P(w, 4).stacksAs).toBe(2);
    expect(RT(w, 4).gv.bounty).toBe(10);
  });

  it("a bountied victim who leaves without having been hit pays nobody", () => {
    const w = bountied({ attackSpeed: 4 });
    removePlayer(w, idOf(0));
    expect(P(w, 4).stacksAs).toBe(0);
  });

  it("transferStacks called directly moves half of each stat and ignores a missing player", () => {
    const w = bountied({ hp: 2, attackSpeed: 4, moveSpeed: 6 });
    transferStacks(w, RT(w, 4), RT(w, 0));
    expect(stacksOf(P(w, 4))).toEqual({ hp: 1, attackSpeed: 2, moveSpeed: 3 });
    expect(stacksOf(P(w, 0))).toEqual({ hp: 2, attackSpeed: 4, moveSpeed: 6 }); // a copy of half, not a move: the victim is dead anyway
    const gone = RT(w, 0);
    removePlayer(w, idOf(0));
    transferStacks(w, RT(w, 4), gone); // the victim is gone from the state: nothing to read
    expect(stacksOf(P(w, 4))).toEqual({ hp: 1, attackSpeed: 2, moveSpeed: 3 });
  });

  it("the stacks won count toward the combo the same kill sets off: playerKilled fires onKill AFTER the transfer", () => {
    const w = bountied({ attackSpeed: 6 }); // half is 3: exactly Dash
    expect(P(w, 4).stacksAs).toBe(0);
    const now = w.state.serverTime;
    kill(w, 0, attacker(w, 4));
    expect(P(w, 4).stacksAs).toBe(3);
    // Crossing 3 is announced (proc false) and then the very same kill sets the dash off (proc true).
    const combos = fxOf(w.events, "combo");
    expect(combos).toEqual([
      { kind: "combo", id: idOf(4), combo: "dash", proc: false },
      { kind: "combo", id: idOf(4), combo: "dash", proc: true },
    ]);
    const kinds = w.events.map((e) => (e.type === "fx" ? e.fx.kind : e.type));
    expect(kinds.indexOf("buff")).toBeLessThan(kinds.indexOf("combo"));
    expect(RT(w, 4).boost!.bursts).toEqual([{ mult: 2.5, until: now + 400 }]);
  });

  it("5 stacks won by the bounty reset the cooldown on that kill (Cascade)", () => {
    const w = bountied({ attackSpeed: 10 });
    const now = w.state.serverTime;
    P(w, 4).readyAt = now + 9000;
    kill(w, 0, attacker(w, 4));
    expect(P(w, 4).stacksAs).toBe(5);
    expect(P(w, 4).readyAt).toBeLessThanOrEqual(now);
    expect(RT(w, 4).boost!.bursts).toEqual([{ mult: 2.5, until: now + 400 }]);
  });

  it("hp stacks won by the bounty give the kill shield on that kill, on the max hp they raised", () => {
    const w = bountied({ hp: 6 });
    kill(w, 0, attacker(w, 4));
    expect(P(w, 4).stacksHp).toBe(3);
    expect(P(w, 4).barrier).toBeCloseTo(0.15 * 1450 * buffMultiplier("hp", 3), 6);
  });

  it("every player kill sets off the killer's combos, with a bounty or without", () => {
    const w = startRun(6);
    setStacks(w, 4, { attackSpeed: 3, hp: 3 });
    const now = w.state.serverTime;
    kill(w, 1, attacker(w, 4)); // victim has no bounty, nothing to transfer
    expect(RT(w, 4).boost!.bursts).toEqual([{ mult: 2.5, until: now + 400 }]);
    expect(P(w, 4).barrier).toBeCloseTo(0.15 * P(w, 4).maxHp, 6);
    expect(fxOf(w.events, "buff")).toEqual([]);
  });

  it("a kill by something that is not a player sets off nothing", () => {
    const w = startRun(6);
    setStacks(w, 4, { attackSpeed: 3 });
    kill(w, 1, "test");
    expect(RT(w, 4).boost).toBeUndefined();
  });

  it("a killer who went down in the same tick still collects the GV but is past receiving stacks", () => {
    const w = bountied({ hp: 4 });
    // p4 is downed (hp 0 and status dead) but unresolved, as in the middle of a tick; then its blow kills p0.
    P(w, 4).status = "dead";
    P(w, 4).hp = 0;
    kill(w, 0, attacker(w, 4));
    expect(P(w, 4).stacksHp).toBe(0);
    expect(RT(w, 4).gv.bounty).toBe(10);
  });
});

describe("the hooks chain onto whatever was installed before", () => {
  it("runs a previous bountyClaimed and playerKilled first, and the stacks are already moved when the previous playerKilled runs", () => {
    const seed = 99;
    const w = createWorld({ seed, config: makeConfig(6), random: mulberry32(seed) });
    for (let i = 0; i < 6; i++) addPlayer(w, idOf(i), NAMES[i]!);
    step(w, TICK_MS);
    const log: string[] = [];
    w.hooks.bountyClaimed = (_w, killer, victim, bounty) => { log.push(`claimed ${killer.id}<-${victim.id} ${bounty}`); };
    w.hooks.playerKilled = (world, killer) => {
      log.push(`killed ${killer.id} as=${world.state.players.get(killer.id)!.stacksAs} bursts=${killer.boost?.bursts.length ?? 0}`);
    };
    installBuffs(w);
    expect(w.systems).toContain(expireBoosts);
    slay(w, 0, [1, 2, 3]);
    setStacks(w, 0, { attackSpeed: 6 });
    log.length = 0;
    kill(w, 0, attacker(w, 4));
    // The previous claimed hook runs, then the transfer, then the previous killed hook (stacks arrived, combo not yet fired), then onKill.
    expect(log).toEqual([`claimed ${idOf(4)}<-${idOf(0)} 10`, `killed ${idOf(4)} as=3 bursts=0`]);
    expect(RT(w, 4).boost!.bursts).toHaveLength(1);
  });
});

describe("attack speed through the real formulas", () => {
  const paced = (faction: "plague" | "frost") => pacedFaction(FACTIONS[faction]);

  it("with no stacks the interval and damage per hit are the paced faction's", () => {
    const w = startRun(4);
    P(w, 2).weapon0 = "sword"; // Plague
    const t = timingsOf(P(w, 2), "sword")!;
    expect(t.interval).toBe(attackInterval(paced("plague"), "sword", 1));
    expect(packetFor(cOf(w, 2), "sword").raw).toBe(damagePerHit(paced("plague"), "sword", 1));
  });

  it("Frost on the axe is far above its floor: stacks shrink the interval and damage per hit stays", () => {
    const w = startRun(4);
    const p = P(w, 3);
    p.weapon0 = "axe";
    const before = timingsOf(p, "axe")!;
    const rawBefore = packetFor(cOf(w, 3), "axe").raw;
    expect(before.interval).toBeGreaterThan(1.5); // 1 / (0.45 x 1.4)
    p.stacksAs = 3;
    const m = buffMultiplier("attackSpeed", 3);
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
    p.stacksAs = 3;
    const m = buffMultiplier("attackSpeed", 3);
    const after = timingsOf(p, "sword")!;
    expect(after.interval).toBe(WEAPONS.sword.floor); // held at the floor
    expect(after.interval).toBeLessThan(before.interval); // by a hair
    const raw = packetFor(cOf(w, 2), "sword").raw;
    expect(raw).toBeCloseTo(damagePerHit(paced("plague"), "sword", m), 9);
    expect(raw).toBeGreaterThan(rawBefore * 1.2); // nearly the full +23% turned into damage
    expect(raw / after.interval).toBeGreaterThan((rawBefore / before.interval) * 1.2); // so dps rises with the stacks
    // More stacks, more damage per hit, the interval stays on the floor.
    p.stacksAs = 5;
    expect(timingsOf(p, "sword")!.interval).toBe(WEAPONS.sword.floor);
    expect(packetFor(cOf(w, 2), "sword").raw).toBeGreaterThan(raw);
  });

  it("the bow's interval and full draw shrink with the stacks, down to the 0.25 s floor", () => {
    const w = startRun(4);
    const fire = P(w, 0);
    fire.weapon0 = "bow";
    const before = timingsOf(fire, "bow")!;
    expect(before.interval).toBeCloseTo(1 / (0.6 * 1.95), 9); // Fire's rate 0.6, the bow's boost 0.95
    expect(before.fullDraw).toBeCloseTo(0.7 * before.interval, 9); // under the 0.6 s cap
    fire.stacksAs = 3;
    const m = buffMultiplier("attackSpeed", 3);
    const after = timingsOf(fire, "bow")!;
    expect(after.interval).toBeCloseTo(before.interval / m, 9);
    expect(after.fullDraw).toBeCloseTo(before.fullDraw / m, 9);
    expect(after.fullDraw).toBeLessThan(before.fullDraw - 0.1);
    expect(after.cooldown).toBeCloseTo(after.interval - after.fullDraw, 9);
    // Plague's bow starts 0.277 s: three stacks take it to the floor (and the draw to 70% of it), and more change nothing.
    const plague = P(w, 2);
    plague.weapon0 = "bow";
    const plagueBefore = timingsOf(plague, "bow")!;
    expect(plagueBefore.interval).toBeGreaterThan(WEAPONS.bow.floor);
    for (const stacks of [3, 7]) {
      plague.stacksAs = stacks;
      expect(timingsOf(plague, "bow")!.interval).toBe(WEAPONS.bow.floor);
      expect(timingsOf(plague, "bow")!.fullDraw).toBeCloseTo(0.7 * WEAPONS.bow.floor, 9);
    }
    expect(timingsOf(plague, "bow")!.fullDraw).toBeLessThan(plagueBefore.fullDraw);
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
  it("move-speed buffs are a registered moveModifier of a game world, not a part of moveMultiplierOf", () => {
    const w = startRun(2);
    expect(w.moveModifiers).toContain(moveSpeedMult);
    setStacks(w, 0, { moveSpeed: 3 });
    expect(moveMultiplierOf(w, cOf(w, 0))).toBe(1);
    expect(effectiveMove(w, cOf(w, 0))).toBeCloseTo(buffMultiplier("moveSpeed", 3), 9);
  });

  it("a buffed player really walks farther per tick (the step loop applies the modifier)", () => {
    const run = (stacks: number): number => {
      const w = startRun(2);
      setStacks(w, 0, { moveSpeed: stacks });
      const p = P(w, 0);
      const x0 = p.x;
      const y0 = p.y;
      RT(w, 0).path = [{ x: x0 + 600, y: y0 }];
      tick(w);
      return Math.hypot(p.x - x0, p.y - y0);
    };
    expect(run(3) / run(0)).toBeCloseTo(buffMultiplier("moveSpeed", 3), 3);
  });

  it("is 1 with nothing on", () => {
    const w = startRun(2);
    expect(effectiveMove(w, cOf(w, 0))).toBe(1);
  });

  it("includes the move-speed stacks and a running burst", () => {
    const w = startRun(2);
    setStacks(w, 0, { moveSpeed: 3 });
    expect(effectiveMove(w, cOf(w, 0))).toBeCloseTo(buffMultiplier("moveSpeed", 3), 9);
    RT(w, 0).boost = { bursts: [{ mult: 2.5, until: w.state.serverTime + 400 }], shieldUntil: 0 };
    expect(effectiveMove(w, cOf(w, 0))).toBeCloseTo(buffMultiplier("moveSpeed", 3) * 2.5, 9);
  });

  it("is 0 while rooted whatever the buffs say", () => {
    const w = startRun(2);
    setStacks(w, 0, { moveSpeed: 8 });
    RT(w, 0).boost = { bursts: [{ mult: 2.5, until: w.state.serverTime + 400 }], shieldUntil: 0 };
    RT(w, 0).weapon.rootUntil = w.state.serverTime + 100;
    expect(effectiveMove(w, cOf(w, 0))).toBe(0);
    RT(w, 0).weapon.rootUntil = w.state.serverTime; // over at the instant
    expect(effectiveMove(w, cOf(w, 0))).toBeGreaterThan(1);
  });

  it("a slow multiplies the buffs: a wand's cast slow of 0.35 times the stacks' bonus", () => {
    const w = startRun(2);
    setStacks(w, 0, { moveSpeed: 3 });
    RT(w, 0).weapon.castSlowUntil = w.state.serverTime + 100;
    expect(effectiveMove(w, cOf(w, 0))).toBeCloseTo(WAND_CAST_MOVE * buffMultiplier("moveSpeed", 3), 9);
  });
});

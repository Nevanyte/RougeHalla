// effects.ts (the closed Effect union and its helpers) and mods.ts (the stat mirrors' fold and wire codec), roguelike R0.
// The type-level checks run under `npm run typecheck` (tsconfig includes test/): a @ts-expect-error that stops erroring
// fails it.
import { describe, expect, it } from "vitest";
import {
  assertNever, cardRows, decodeFlat, decodeMirrors, decodeMult, EFFECT_KINDS, EFFECT_KINDS_COMPLETE,
  EFFECT_STATS, encodeFlat, encodeMirrors, encodeMult, FLAT_STATS, FLAT_WIRE_PER_POINT, foldStatRows, IDENTITY_MIRRORS,
  isFlatStat, MIRROR_FIELDS, MOD_MULT_MIN, mirrorsFromSums, MULT_WIRE_PER_UNIT, requirementsMet, visitEffect,
  WIRE_IDENTITY_MIRRORS, zeroSums,
  type Effect, type EffectKind, type EffectVisitor, type OnHitStatus, type StatKey, type StatusKind, type TriggerAction,
} from "../src/index";
import { PlayerState } from "../src/schema";

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

/** One row of every kind. */
const ROWS: Effect[] = [
  { k: "stat", stat: "attackSpeed", v: 0.1 },
  { k: "flat", stat: "armor", v: 10 },
  { k: "vs", test: "slowed", arg: 0, v: 0.1 },
  { k: "scale", src: "ownMissingHp", per: 0.01, step: 0.1 },
  { k: "while", cond: "hpBelow", arg: 0.3, stat: "attackSpeed", v: 0.25 },
  { k: "onHit", status: "slowAttack", per: 0.03, cap: 0.15, ms: 2000 },
  { k: "trigger", on: "hpBelow", arg: 0.3, once: true, do: { do: "heal", share: 0.1, ignoreLockout: true } },
  { k: "convert", from: "ad", to: "armor", per: 0.25 },
  { k: "mult", key: "hit", v: 2.5 },
  { k: "flag", flag: "noCrit" },
];

describe("the Effect union", () => {
  it("EFFECT_KINDS lists every kind once, and the compile-time check agrees", () => {
    expect(EFFECT_KINDS_COMPLETE).toBe(true);
    expect(new Set(EFFECT_KINDS).size).toBe(EFFECT_KINDS.length);
    expect(ROWS.map((r) => r.k)).toEqual([...EFFECT_KINDS]);
    const kindsExact: Equals<(typeof EFFECT_KINDS)[number], EffectKind> = true;
    expect(kindsExact).toBe(true);
  });

  it("visitEffect dispatches every kind to its own handler, and a visitor must handle them all", () => {
    const visitor: EffectVisitor<string> = {
      stat: (e) => `stat:${e.stat}`, flat: (e) => `flat:${e.stat}`, vs: (e) => `vs:${e.test}`, scale: (e) => `scale:${e.src}`,
      while: (e) => `while:${e.cond}`, onHit: (e) => `onHit:${e.status}`, trigger: (e) => `trigger:${e.on}`,
      convert: (e) => `convert:${e.from}>${e.to}`, mult: (e) => `mult:${e.key}`, flag: (e) => `flag:${e.flag}`,
    };
    expect(ROWS.map((r) => visitEffect(r, visitor))).toEqual([
      "stat:attackSpeed", "flat:armor", "vs:slowed", "scale:ownMissingHp", "while:hpBelow", "onHit:slowAttack", "trigger:hpBelow",
      "convert:ad>armor", "mult:hit", "flag:noCrit",
    ]);
    // @ts-expect-error a visitor without the trigger case does not compile
    const partial: EffectVisitor<number> = {
      stat: () => 0, flat: () => 0, vs: () => 0, scale: () => 0, while: () => 0, onHit: () => 0, convert: () => 0, mult: () => 0, flag: () => 0,
    };
    // @ts-expect-error nor one without the balance pass's convert, mult or flag
    const partial2: EffectVisitor<number> = { stat: () => 0, flat: () => 0, vs: () => 0, scale: () => 0, while: () => 0, onHit: () => 0, trigger: () => 0 };
    expect(partial2).toBeDefined();
    expect(partial).toBeDefined();
  });

  it("an exhaustive switch needs every case before assertNever compiles; at runtime assertNever throws", () => {
    const describeKind = (e: Effect): number => {
      switch (e.k) {
        case "stat": case "flat": case "vs": case "scale": case "while": case "onHit": case "trigger": case "convert": case "mult": case "flag": return 1;
        default: return assertNever(e, "effect kind");
      }
    };
    expect(ROWS.map(describeKind)).toEqual(ROWS.map(() => 1));
    const missing = (e: Effect): number => {
      switch (e.k) {
        case "stat": case "flat": case "vs": case "scale": case "while": case "onHit": case "convert": case "mult": case "flag": return 1;
        // @ts-expect-error the trigger case is missing, so `e` is not `never` here
        default: return assertNever(e);
      }
    };
    expect(() => missing(ROWS[6]!)).toThrow(/unhandled/);
  });

  it("StatusKind mirrors Wishes' union exactly, and onHit applies only the four on-hit statuses", () => {
    const wishes: Equals<StatusKind,
      "stun" | "root" | "silence" | "slowMove" | "slowAttack" | "antiHeal" | "dot" | "invulnerable" | "untargetable" | "hidden"
      | "zoned" | "deathFloor" | "haste" | "shred"> = true;
    const onHit: Equals<OnHitStatus, "slowMove" | "slowAttack" | "antiHeal" | "dot"> = true;
    expect([wishes, onHit]).toEqual([true, true]);
    // @ts-expect-error chill stays Frost's signature, not a status
    const chill: StatusKind = "chill";
    // @ts-expect-error a stun is not an on-hit status
    const stun: OnHitStatus = "stun";
    expect([chill, stun]).toHaveLength(2);
  });

  it("a trigger's action uses Wishes' do: verbs", () => {
    const actions: TriggerAction[] = [
      { do: "status", to: "target", status: "slowAttack", ms: 1000, value: 0.1 },
      { do: "cleanse", to: "self", classes: ["soft"] },
      { do: "heal", share: 0.2, ignoreLockout: true },
      { do: "barrier", share: 0.2, ms: 4000 },
      { do: "cooldown", ms: 2000 },
      { do: "boost", as: 0.4, move: 0.4, ms: 2000 },
      { do: "return", share: 0.15, melee: true },
      { do: "fortify", per: 0.25, cap: 250 },
      { do: "splash", radius: 200 },
    ];
    expect(actions.map((a) => a.do)).toEqual(["status", "cleanse", "heal", "barrier", "cooldown", "boost", "return", "fortify", "splash"]);
  });

  it("the stat keys: fractions for EffectStat, points for FlatStat", () => {
    expect(EFFECT_STATS).toHaveLength(16);
    expect(EFFECT_STATS).toEqual(expect.arrayContaining(["slowResist", "lifestealMult", "lifestealDot", "critChance", "healBarrier"]));
    expect(FLAT_STATS).toEqual(["armor", "shield", "ad", "ap"]);
    const all: StatKey[] = [...EFFECT_STATS, ...FLAT_STATS];
    expect(all.filter(isFlatStat)).toEqual(["armor", "shield", "ad", "ap"]);
    expect(Object.keys(zeroSums()).sort()).toEqual([...all].sort());
    // lifestealMult is a product: its identity is 1 (the rest are 0).
    expect(Object.entries(zeroSums()).filter(([, v]) => v !== 0)).toEqual([["lifestealMult", 1]]);
  });

  it("requires: a row is on only while every listed id is owned", () => {
    const row: Effect = { k: "stat", stat: "damage", v: 0.1, requires: ["glassFang", "bloodPact"] };
    expect(requirementsMet({ k: "stat", stat: "damage", v: 0.1 })).toBe(true);
    expect(requirementsMet({ k: "stat", stat: "damage", v: 0.1, requires: [] })).toBe(true);
    expect(requirementsMet(row)).toBe(false);
    expect(requirementsMet(row, (id) => id === "glassFang")).toBe(false);
    expect(requirementsMet(row, () => true)).toBe(true);
  });
});

describe("foldStatRows", () => {
  it("adds within a key, keeps keys apart, and skips the per-hit and event rows", () => {
    const sums = foldStatRows([
      { k: "stat", stat: "attackSpeed", v: 0.1 },
      { k: "stat", stat: "attackSpeed", v: 0.1 },
      { k: "stat", stat: "moveSpeed", v: -0.1 },
      { k: "flat", stat: "armor", v: 10 },
      { k: "flat", stat: "armor", v: 5 },
      ...ROWS.slice(2), // vs, scale, onHit, trigger; the `while` row's condition does not hold
    ]);
    expect(sums).toEqual({ ...zeroSums(), attackSpeed: 0.2, moveSpeed: -0.1, armor: 15 });
    // +10% and +10% is +20%, not +21%.
    expect(mirrorsFromSums(sums).asMult).toBeCloseTo(1.2, 12);
  });

  it("folds a `while` row only while its condition holds, and a `requires` row only while owned", () => {
    const rows: Effect[] = [
      { k: "while", cond: "hpBelow", arg: 0.3, stat: "attackSpeed", v: 0.25 },
      { k: "while", cond: "chasingLock", arg: 0, stat: "armor", v: 4 },
      { k: "stat", stat: "windup", v: -0.08, requires: ["quickdraw"] },
    ];
    expect(foldStatRows(rows)).toEqual(zeroSums());
    const holds = (e: Extract<Effect, { k: "while" }>) => e.cond === "hpBelow";
    expect(foldStatRows(rows, { holds })).toEqual({ ...zeroSums(), attackSpeed: 0.25 });
    expect(foldStatRows(rows, { holds: () => true, owns: () => true })).toEqual({ ...zeroSums(), attackSpeed: 0.25, armor: 4, windup: -0.08 });
  });

  // The numbers are read from the card catalog, so a retune is a data edit; what is pinned here is the fold and the wire.
  const quotedV = (id: string, i = 0): number => (cardRows(id)[i] as { v: number }).v;

  it("Haste and Fleet cards' rows fold to 1 + their number, to the thousandth on the wire; Fleet only while not shooting", () => {
    const haste = quotedV("haste2"); // attack speed
    const fleet = quotedV("fleet2"); // move speed, off while shooting
    expect(haste).toBe(0.16);
    expect(fleet).toBe(0.1);
    for (const n of [0, 1, 2, 5]) {
      const rows = Array.from({ length: n }, () => [...cardRows("haste2"), ...cardRows("fleet2")]).flat();
      const idle = encodeMirrors(mirrorsFromSums(foldStatRows(rows)));
      const walking = encodeMirrors(mirrorsFromSums(foldStatRows(rows, { holds: (e) => e.cond === "notShooting" })));
      expect(Math.abs(decodeMult(idle.asMult) - (1 + haste * n)), `${n} attack speed`).toBeLessThanOrEqual(0.5 / MULT_WIRE_PER_UNIT + 1e-12);
      expect(decodeMult(idle.speedMult), `${n} speed while shooting`).toBe(1);
      expect(Math.abs(decodeMult(walking.speedMult) - (1 + fleet * n)), `${n} speed walking`).toBeLessThanOrEqual(0.5 / MULT_WIRE_PER_UNIT + 1e-12);
    }
  });

  it("flat card rows fold to points: Armor and Magic Resist, in tenths on the wire; Attack Damage and Ability Power too", () => {
    const armor = quotedV("armor2");
    const mr = quotedV("mr3");
    expect([armor, mr]).toEqual([26, 41]);
    const sums = foldStatRows([...cardRows("armor2"), ...cardRows("mr3"), ...cardRows("ad1"), ...cardRows("ap2")]);
    expect(sums).toMatchObject({ armor, shield: mr, ad: 12, ap: 21 });
    const wire = encodeMirrors(mirrorsFromSums(sums));
    expect([wire.armorBonus, wire.shieldBonus, wire.adBonus, wire.apBonus]).toEqual([260, 410, 120, 210]);
    // Two cards of one key add: a second Armor II doubles it.
    expect(foldStatRows([...cardRows("armor2"), ...cardRows("armor2")]).armor).toBe(2 * armor);
  });
});

describe("the mirror codec", () => {
  it("the identity: defaults on PlayerState, an empty fold, and decoding them", () => {
    expect(MIRROR_FIELDS).toEqual(["asMult", "windupMult", "speedMult", "armorBonus", "shieldBonus", "adBonus", "apBonus"]);
    expect(IDENTITY_MIRRORS).toEqual({ asMult: 1, windupMult: 1, speedMult: 1, armorBonus: 0, shieldBonus: 0, adBonus: 0, apBonus: 0 });
    // The multipliers are float64 thousandths on the state: a default PlayerState holds 1000, which decodes to 1.
    expect(WIRE_IDENTITY_MIRRORS).toEqual({ asMult: 1000, windupMult: 1000, speedMult: 1000, armorBonus: 0, shieldBonus: 0, adBonus: 0, apBonus: 0 });
    const p = new PlayerState();
    expect(MIRROR_FIELDS.map((f) => p[f])).toEqual(MIRROR_FIELDS.map((f) => WIRE_IDENTITY_MIRRORS[f]));
    expect(decodeMirrors(p)).toEqual(IDENTITY_MIRRORS);
    expect(encodeMirrors(mirrorsFromSums(zeroSums()))).toEqual(WIRE_IDENTITY_MIRRORS);
  });

  it("multipliers: whole thousandths, clamped only at the low end, non-finite as 1", () => {
    expect(MULT_WIRE_PER_UNIT).toBe(1000);
    for (const x of [1, 0.8, 1.235, 1.04656]) {
      const wire = encodeMult(x);
      expect(Number.isInteger(wire), `${x}`).toBe(true);
      expect(wire, `${x}`).toBe(Math.round(x * 1000));
      expect(decodeMult(wire), `${x}`).toBe(wire / 1000);
    }
    // Not a multiple of 0.001: the wire rounds it, and what decodes is the rounded value (the one the sim uses).
    expect(decodeMult(encodeMult(1.2345678901234567))).toBe(1.235);
    expect(encodeMult(0)).toBe(MOD_MULT_MIN * 1000);
    expect(encodeMult(-3)).toBe(MOD_MULT_MIN * 1000);
    expect(encodeMult(1e9)).toBe(1e12);
    expect(encodeMult(Number.NaN)).toBe(1000);
    expect(encodeMult(Number.POSITIVE_INFINITY)).toBe(1000);
    // A server build without the mirror fields leaves them undefined on the client: no modifier, never NaN.
    expect(decodeMult(undefined as unknown as number)).toBe(1);
    expect(decodeMult(Number.NaN)).toBe(1);
  });

  it("flat bonuses: whole tenths of a point (half up), float64 on the wire, and decode is idempotent", () => {
    expect(FLAT_WIRE_PER_POINT).toBe(10);
    const cases: Array<[number, number]> = [[0, 0], [10, 100], [0.04, 0], [0.05, 1], [7.86, 79], [-7.86, -79], [-0.06, -1], [12.34, 123]];
    for (const [x, wire] of cases) expect(encodeFlat(x), `${x}`).toBe(wire);
    expect(decodeFlat(79)).toBe(7.9);
    expect(decodeFlat(3)).toBe(0.3);
    expect(encodeFlat(1e6)).toBe(1e7);
    expect(encodeFlat(-1e6)).toBe(-1e7);
    expect(encodeFlat(Number.NaN)).toBe(0);
    for (let wire = -2000; wire <= 2000; wire += 7) expect(encodeFlat(decodeFlat(wire))).toBe(wire);
  });

  it("decodeMirrors decodes every field of the wire form", () => {
    const wire = encodeMirrors({ asMult: 0.75, windupMult: 1.12, speedMult: 1.3, armorBonus: 12.3, shieldBonus: -4, adBonus: 33, apBonus: 7.86 });
    expect(wire).toEqual({ asMult: 750, windupMult: 1120, speedMult: 1300, armorBonus: 123, shieldBonus: -40, adBonus: 330, apBonus: 79 });
    expect(decodeMirrors(wire)).toEqual({ asMult: 0.75, windupMult: 1.12, speedMult: 1.3, armorBonus: 12.3, shieldBonus: -4, adBonus: 33, apBonus: 7.9 });
  });
});

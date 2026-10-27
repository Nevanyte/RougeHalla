// effects.ts (the closed Effect union and its helpers) and mods.ts (the stat mirrors' fold and wire codec), roguelike R0.
// The type-level checks run under `npm run typecheck` (tsconfig includes test/): a @ts-expect-error that stops erroring
// fails it.
import { describe, expect, it } from "vitest";
import {
  assertNever, buffDef, buffRows, buffScale, decodeFlat, decodeMirrors, decodeMult, EFFECT_KINDS, EFFECT_KINDS_COMPLETE,
  EFFECT_STATS, encodeFlat, encodeMirrors, encodeMult, FLAT_STATS, FLAT_WIRE_PER_POINT, foldStatRows, IDENTITY_MIRRORS,
  isFlatStat, MIRROR_FIELDS, MOD_MULT_MAX, MOD_MULT_MIN, mirrorsFromSums, MULT_WIRE_PER_UNIT, requirementsMet, visitEffect,
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
    };
    expect(ROWS.map((r) => visitEffect(r, visitor))).toEqual([
      "stat:attackSpeed", "flat:armor", "vs:slowed", "scale:ownMissingHp", "while:hpBelow", "onHit:slowAttack", "trigger:hpBelow",
    ]);
    // @ts-expect-error a visitor without the trigger case does not compile
    const partial: EffectVisitor<number> = { stat: () => 0, flat: () => 0, vs: () => 0, scale: () => 0, while: () => 0, onHit: () => 0 };
    expect(partial).toBeDefined();
  });

  it("an exhaustive switch needs every case before assertNever compiles; at runtime assertNever throws", () => {
    const describeKind = (e: Effect): number => {
      switch (e.k) {
        case "stat": case "flat": case "vs": case "scale": case "while": case "onHit": case "trigger": return 1;
        default: return assertNever(e, "effect kind");
      }
    };
    expect(ROWS.map(describeKind)).toEqual(ROWS.map(() => 1));
    const missing = (e: Effect): number => {
      switch (e.k) {
        case "stat": case "flat": case "vs": case "scale": case "while": case "onHit": return 1;
        // @ts-expect-error the trigger case is missing, so `e` is not `never` here
        default: return assertNever(e);
      }
    };
    expect(() => missing(ROWS[6]!)).toThrow(/unhandled/);
  });

  it("StatusKind mirrors Wishes' union exactly, and onHit applies only the four on-hit statuses", () => {
    const wishes: Equals<StatusKind,
      "stun" | "root" | "silence" | "slowMove" | "slowAttack" | "antiHeal" | "dot" | "invulnerable" | "untargetable" | "hidden"
      | "zoned" | "deathFloor" | "haste"> = true;
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
    ];
    expect(actions.map((a) => a.do)).toEqual(["status", "cleanse", "heal", "barrier", "cooldown"]);
  });

  it("the stat keys: fractions for EffectStat, points for FlatStat", () => {
    expect(EFFECT_STATS).toHaveLength(10);
    expect(FLAT_STATS).toEqual(["armor", "shield"]);
    const all: StatKey[] = [...EFFECT_STATS, ...FLAT_STATS];
    expect(all.filter(isFlatStat)).toEqual(["armor", "shield"]);
    expect(Object.keys(zeroSums()).sort()).toEqual([...all].sort());
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

  // The quoted numbers are read from the catalog, so a retune is a data edit; what is pinned here is the fold and the wire.
  const quotedV = (id: string, i = 0): number => (buffDef(id)!.effects[i] as { v: number }).v;

  it("a buff's rows at n stacks fold to 1 + quoted x S(n) / S(3), to the thousandth on the wire", () => {
    const rat = quotedV("plagueRat"); // attack speed
    const hound = quotedV("cinderHound"); // move speed, but only while chasing a lock
    expect(rat).toBe(0.08);
    expect(hound).toBe(0.1);
    for (const n of [0, 0.3, 1.1, 2.5, 3, 5, 8.25]) {
      const rows = buffRows({ plagueRat: n, cinderHound: n });
      const idle = encodeMirrors(mirrorsFromSums(foldStatRows(rows)));
      const chasing = encodeMirrors(mirrorsFromSums(foldStatRows(rows, { holds: (e) => e.cond === "chasingLock" })));
      const k = buffScale(n);
      expect(Math.abs(decodeMult(idle.asMult) - (1 + rat * k)), `${n} attack speed`).toBeLessThanOrEqual(0.5 / MULT_WIRE_PER_UNIT + 1e-12);
      expect(Math.abs(decodeMult(chasing.asMult) - (1 + rat * k)), `${n} attack speed while chasing`).toBeLessThanOrEqual(0.5 / MULT_WIRE_PER_UNIT + 1e-12);
      expect(decodeMult(idle.speedMult), `${n} speed without a lock`).toBe(1);
      expect(Math.abs(decodeMult(chasing.speedMult) - (1 + hound * k)), `${n} speed chasing`).toBeLessThanOrEqual(0.5 / MULT_WIRE_PER_UNIT + 1e-12);
    }
  });

  it("a buff's flat rows fold to points: Rime Stalker's armor and Magma Brute's magic resist, in tenths on the wire", () => {
    const armor = quotedV("rimeStalker");
    const brute = quotedV("magmaBrute", 1); // magic resist
    const bruteHp = quotedV("magmaBrute", 0);
    const shard = quotedV("seraphShard");
    expect([armor, brute, bruteHp, shard]).toEqual([20, 20, 0.06, 16]);
    const sums = foldStatRows(buffRows({ rimeStalker: 3, magmaBrute: 3 }));
    expect(sums).toMatchObject({ armor, shield: brute, maxHp: bruteHp });
    const wire = encodeMirrors(mirrorsFromSums(sums));
    expect([wire.armorBonus, wire.shieldBonus]).toEqual([Math.round(armor * FLAT_WIRE_PER_POINT), Math.round(brute * FLAT_WIRE_PER_POINT)]);
    // Two sources of one key add: Seraph Shard's magic resist joins Magma Brute's.
    expect(foldStatRows(buffRows({ magmaBrute: 3, seraphShard: 3 })).shield).toBe(brute + shard);
  });
});

describe("the mirror codec", () => {
  it("the identity: defaults on PlayerState, an empty fold, and decoding them", () => {
    expect(MIRROR_FIELDS).toEqual(["asMult", "windupMult", "speedMult", "armorBonus", "shieldBonus"]);
    expect(IDENTITY_MIRRORS).toEqual({ asMult: 1, windupMult: 1, speedMult: 1, armorBonus: 0, shieldBonus: 0 });
    // The multipliers are uint16 thousandths on the state: a default PlayerState holds 1000, which decodes to 1.
    expect(WIRE_IDENTITY_MIRRORS).toEqual({ asMult: 1000, windupMult: 1000, speedMult: 1000, armorBonus: 0, shieldBonus: 0 });
    const p = new PlayerState();
    expect(MIRROR_FIELDS.map((f) => p[f])).toEqual(MIRROR_FIELDS.map((f) => WIRE_IDENTITY_MIRRORS[f]));
    expect(decodeMirrors(p)).toEqual(IDENTITY_MIRRORS);
    expect(encodeMirrors(mirrorsFromSums(zeroSums()))).toEqual(WIRE_IDENTITY_MIRRORS);
  });

  it("multipliers: whole thousandths, clamped to [MOD_MULT_MIN, MOD_MULT_MAX] on the wire, non-finite as 1", () => {
    expect(MULT_WIRE_PER_UNIT).toBe(1000);
    for (const x of [1, 0.8, 1.235, 1 + 0.04 * buffScale(3.3)]) {
      const wire = encodeMult(x);
      expect(Number.isInteger(wire), `${x}`).toBe(true);
      expect(wire, `${x}`).toBe(Math.round(x * 1000));
      expect(decodeMult(wire), `${x}`).toBe(wire / 1000);
    }
    // Not a multiple of 0.001: the wire rounds it, and what decodes is the rounded value (the one the sim uses).
    expect(decodeMult(encodeMult(1.2345678901234567))).toBe(1.235);
    expect(encodeMult(0)).toBe(MOD_MULT_MIN * 1000);
    expect(encodeMult(-3)).toBe(MOD_MULT_MIN * 1000);
    expect(encodeMult(1e9)).toBe(MOD_MULT_MAX * 1000);
    expect(encodeMult(Number.NaN)).toBe(1000);
    expect(encodeMult(Number.POSITIVE_INFINITY)).toBe(1000);
    // A server build without the mirror fields leaves them undefined on the client: no modifier, never NaN.
    expect(decodeMult(undefined as unknown as number)).toBe(1);
    expect(decodeMult(Number.NaN)).toBe(1);
  });

  it("flat bonuses: whole tenths of a point (half up), int16 on the wire, and decode is idempotent", () => {
    expect(FLAT_WIRE_PER_POINT).toBe(10);
    const cases: Array<[number, number]> = [[0, 0], [10, 100], [0.04, 0], [0.05, 1], [7.86, 79], [-7.86, -79], [-0.06, -1], [12.34, 123]];
    for (const [x, wire] of cases) expect(encodeFlat(x), `${x}`).toBe(wire);
    expect(decodeFlat(79)).toBe(7.9);
    expect(decodeFlat(3)).toBe(0.3);
    expect(encodeFlat(1e6)).toBe(32767);
    expect(encodeFlat(-1e6)).toBe(-32768);
    expect(encodeFlat(Number.NaN)).toBe(0);
    for (let wire = -2000; wire <= 2000; wire += 7) expect(encodeFlat(decodeFlat(wire))).toBe(wire);
  });

  it("decodeMirrors decodes every field of the wire form", () => {
    const wire = encodeMirrors({ asMult: 0.75, windupMult: 1.12, speedMult: 1.3, armorBonus: 12.3, shieldBonus: -4 });
    expect(wire).toEqual({ asMult: 750, windupMult: 1120, speedMult: 1300, armorBonus: 123, shieldBonus: -40 });
    expect(decodeMirrors(wire)).toEqual({ asMult: 0.75, windupMult: 1.12, speedMult: 1.3, armorBonus: 12.3, shieldBonus: -4 });
  });
});

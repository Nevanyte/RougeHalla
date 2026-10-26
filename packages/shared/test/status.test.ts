import { describe, expect, it } from "vitest";
import {
  EFFECT_ANTI_HEAL, EFFECT_ATTACK_SLOWED, EFFECT_CASTING, EFFECT_DOT, EFFECT_HASTE, EFFECT_HIDDEN, EFFECT_LAST_STAND, EFFECT_ROOTED,
  EFFECT_SILENCED, EFFECT_SLOWED, EFFECT_STUNNED, EFFECT_UNTARGETABLE, EFFECT_ZONED, HIDDEN_REVEAL_MS, isStatusKind, STATUS_KINDS,
  STATUS_RULES, type StatusKind,
} from "../src/index";

const ALL_BITS = [
  EFFECT_STUNNED, EFFECT_ROOTED, EFFECT_SILENCED, EFFECT_SLOWED, EFFECT_ATTACK_SLOWED, EFFECT_ANTI_HEAL, EFFECT_DOT,
  EFFECT_UNTARGETABLE, EFFECT_HIDDEN, EFFECT_ZONED, EFFECT_LAST_STAND, EFFECT_HASTE, EFFECT_CASTING,
];

describe("status kinds", () => {
  it("lists thirteen kinds in the wire order, each once", () => {
    expect([...STATUS_KINDS]).toEqual([
      "stun", "root", "silence", "slowMove", "slowAttack", "antiHeal", "dot",
      "invulnerable", "untargetable", "hidden", "zoned", "deathFloor", "haste",
    ]);
    expect(new Set(STATUS_KINDS).size).toBe(STATUS_KINDS.length);
  });

  it("has a rule for every kind and no rule for anything else", () => {
    expect(Object.keys(STATUS_RULES).sort()).toEqual([...STATUS_KINDS].sort());
  });

  it("isStatusKind accepts exactly the kinds", () => {
    for (const k of STATUS_KINDS) expect(isStatusKind(k), k).toBe(true);
    for (const v of ["", "Stun", "chill", "barrier", "toString", "__proto__", 0, 1, null, undefined, {}, []]) expect(isStatusKind(v), String(v)).toBe(false);
  });
});

describe("effect bits", () => {
  it("are distinct powers of two that fit PlayerState.effects (uint16)", () => {
    for (const b of ALL_BITS) {
      expect(b).toBeGreaterThan(0);
      expect(b & (b - 1), `${b} is a power of two`).toBe(0);
      expect(b).toBeLessThanOrEqual(0xffff);
    }
    expect(new Set(ALL_BITS).size).toBe(ALL_BITS.length);
  });

  it("have the wire values the client and the server share", () => {
    expect(ALL_BITS).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096]);
  });

  it("leave 8192, 16384 and 32768 spare", () => {
    const used = ALL_BITS.reduce((a, b) => a | b, 0);
    for (const spare of [8192, 16384, 32768]) expect(used & spare).toBe(0);
  });

  it("are each the bit of exactly one rule, except casting (no status) and invulnerable (immuneUntil)", () => {
    const ruleBits = STATUS_KINDS.map((k) => STATUS_RULES[k].bit).filter((b) => b !== 0);
    expect(new Set(ruleBits).size).toBe(ruleBits.length);
    expect(ruleBits.sort((a, b) => a - b)).toEqual(ALL_BITS.filter((b) => b !== EFFECT_CASTING));
    expect(STATUS_RULES.invulnerable.bit).toBe(0);
  });
});

describe("STATUS_RULES", () => {
  const rule = (k: StatusKind) => STATUS_RULES[k];

  it("gives every kind a positive maxMs, a combine and a cleanse class", () => {
    for (const k of STATUS_KINDS) {
      expect(rule(k).maxMs, k).toBeGreaterThan(0);
      expect(["any", "sum", "max", "product"], k).toContain(rule(k).combine);
      expect(["soft", "hard", "never"], k).toContain(rule(k).cleanse);
    }
  });

  it("cleanses crowd control hard, slows and damage over time soft, and the rest never", () => {
    for (const k of ["stun", "root", "silence"] as const) expect(rule(k).cleanse, k).toBe("hard");
    for (const k of ["slowMove", "slowAttack", "antiHeal", "dot"] as const) expect(rule(k).cleanse, k).toBe("soft");
    for (const k of ["invulnerable", "untargetable", "hidden", "zoned", "deathFloor", "haste"] as const) expect(rule(k).cleanse, k).toBe("never");
  });

  it("marks invulnerable, hidden and deathFloor players-only, and nothing else", () => {
    const playersOnly = STATUS_KINDS.filter((k) => rule(k).playersOnly === true);
    expect(playersOnly.sort()).toEqual(["deathFloor", "hidden", "invulnerable"]);
    for (const k of STATUS_KINDS) expect(rule(k).playersOnly === undefined || rule(k).playersOnly === true, k).toBe(true);
  });

  it("caps the stacking kinds (sum and max) where the design says", () => {
    expect(rule("slowMove")).toMatchObject({ combine: "sum", cap: 0.6 });
    expect(rule("slowAttack")).toMatchObject({ combine: "sum", cap: 0.5 });
    expect(rule("antiHeal")).toMatchObject({ combine: "sum", cap: 0.6 });
    expect(rule("haste")).toMatchObject({ combine: "max", cap: 0.5 });
    expect(rule("dot")).toMatchObject({ combine: "sum" });
    expect(rule("dot").cap).toBeUndefined();
    expect(rule("zoned").combine).toBe("product");
    for (const k of ["stun", "root", "silence", "invulnerable", "untargetable", "hidden", "deathFloor"] as const) {
      expect(rule(k).combine, k).toBe("any");
      expect(rule(k).cap, k).toBeUndefined();
    }
  });

  it("caps a slow below total immobility, and every cap is a share in (0, 1)", () => {
    for (const k of STATUS_KINDS) {
      const cap = rule(k).cap;
      if (cap !== undefined) {
        expect(cap, k).toBeGreaterThan(0);
        expect(cap, k).toBeLessThan(1);
      }
    }
    expect(rule("slowMove").cap).toBeLessThan(1);
  });

  it("bounds a crowd-control instance at three seconds, and every instance at ten", () => {
    for (const k of ["stun", "root", "silence"] as const) expect(rule(k).maxMs, k).toBe(3000);
    for (const k of STATUS_KINDS) expect(rule(k).maxMs, k).toBeLessThanOrEqual(10_000);
  });

  it("ties each rule to its bit", () => {
    expect(rule("stun").bit).toBe(EFFECT_STUNNED);
    expect(rule("root").bit).toBe(EFFECT_ROOTED);
    expect(rule("silence").bit).toBe(EFFECT_SILENCED);
    expect(rule("slowMove").bit).toBe(EFFECT_SLOWED);
    expect(rule("slowAttack").bit).toBe(EFFECT_ATTACK_SLOWED);
    expect(rule("antiHeal").bit).toBe(EFFECT_ANTI_HEAL);
    expect(rule("dot").bit).toBe(EFFECT_DOT);
    expect(rule("untargetable").bit).toBe(EFFECT_UNTARGETABLE);
    expect(rule("hidden").bit).toBe(EFFECT_HIDDEN);
    expect(rule("zoned").bit).toBe(EFFECT_ZONED);
    expect(rule("deathFloor").bit).toBe(EFFECT_LAST_STAND);
    expect(rule("haste").bit).toBe(EFFECT_HASTE);
  });

  it("keeps the reveal window at half a second", () => {
    expect(HIDDEN_REVEAL_MS).toBe(500);
  });
});

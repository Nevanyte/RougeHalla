// The quantized stat mirrors (shared/mods.ts) and lifesteal's caps. (Moved here from the per-kill buff tests, which went with the buffs.)
import { describe, expect, it } from "vitest";
import {
  AS_MULT_CAP, capAsMult, decodeMult, encodeMult, IDENTITY_MIRRORS, LIFESTEAL_MAX, lifestealShare, LS_CAP, MOD_MULT_MAX,
  MOD_MULT_MIN, MULT_WIRE_PER_UNIT, scaleWindup, WAND_WINDUP, weaponTimings, WIRE_IDENTITY_MIRRORS,
} from "../src/index";

describe("lifesteal's caps", () => {
  it("rows add up to LS_CAP at most, Holy's own comes on top, and the total never passes LIFESTEAL_MAX", () => {
    expect(LS_CAP).toBe(0.25);
    expect(lifestealShare(0, 0)).toBe(0);
    expect(lifestealShare(0, 0.02)).toBe(0.02);
    expect(lifestealShare(0, 0.9)).toBe(LS_CAP);
    expect(lifestealShare(0.3, 0.9)).toBe(0.3 + LS_CAP);
    expect(lifestealShare(0.95, 0.2)).toBe(LIFESTEAL_MAX);
    expect(lifestealShare(0.4, 0)).toBe(0.4); // Holy alone is unchanged
    expect(lifestealShare(0, -0.5)).toBe(0);
  });
});

describe("the quantized mirrors (shared/mods.ts)", () => {
  it("carry thousandths: decode is exactly wire / 1000, encode rounds half up", () => {
    expect(MULT_WIRE_PER_UNIT).toBe(1000);
    expect(encodeMult(1)).toBe(1000);
    expect(encodeMult(1.04)).toBe(1040);
    expect(encodeMult(1.0625)).toBe(1063); // 1062.5 rounds up
    expect(encodeMult(0.9374)).toBe(937);
    expect(decodeMult(1040)).toBe(1040 / 1000);
    expect(decodeMult(Number.NaN)).toBe(1);
    expect(decodeMult(undefined as unknown as number)).toBe(1);
  });

  it("clamps to MOD_MULT_MIN..MOD_MULT_MAX (a uint16 holds it) and reads a bad value as the identity", () => {
    expect(encodeMult(0)).toBe(MOD_MULT_MIN * 1000);
    expect(encodeMult(-3)).toBe(50);
    expect(encodeMult(1e9)).toBe(MOD_MULT_MAX * 1000);
    expect(encodeMult(MOD_MULT_MAX * 1000)).toBeLessThan(65536);
    expect(encodeMult(Number.NaN)).toBe(1000);
    expect(encodeMult(Number.POSITIVE_INFINITY)).toBe(1000);
  });

  it("is idempotent: what the sim decodes and encodes again is the same wire value, for every value on the wire", () => {
    for (let w = 50; w <= 20000; w++) expect(encodeMult(decodeMult(w))).toBe(w);
  });

  it("cap attack speed at AS_MULT_CAP (League's approach: one cap on the total), slows untouched, and the cap travels exactly", () => {
    expect(AS_MULT_CAP).toBe(1.5); // owner ruling, raised from 1.25 (testing/TUNING_ROGUE.md)
    expect(capAsMult(1.51)).toBe(AS_MULT_CAP);
    expect(capAsMult(20)).toBe(AS_MULT_CAP);
    expect(capAsMult(AS_MULT_CAP)).toBe(AS_MULT_CAP);
    for (const x of [1.49, 1.3, 1.25, 1.2, 1.08, 1, 0.8, 0.05]) expect(capAsMult(x)).toBe(x);
    expect(decodeMult(encodeMult(AS_MULT_CAP))).toBe(AS_MULT_CAP);
    expect(encodeMult(capAsMult(1.7))).toBe(1500);
  });

  it("the wire identity is 1000, 1000, 1000, 0, 0", () => {
    expect(WIRE_IDENTITY_MIRRORS).toEqual({ asMult: 1000, windupMult: 1000, speedMult: 1000, armorBonus: 0, shieldBonus: 0, adBonus: 0, apBonus: 0 });
    expect(IDENTITY_MIRRORS).toEqual({ asMult: 1, windupMult: 1, speedMult: 1, armorBonus: 0, shieldBonus: 0, adBonus: 0, apBonus: 0 });
  });

  it("scaleWindup stretches the windup (never past the interval) and the axe's root with it", () => {
    const axe = weaponTimings("axe", 1);
    expect(scaleWindup(axe, 1)).toBe(axe);
    const slow = scaleWindup(axe, 1.2);
    expect(slow.windup).toBeCloseTo(axe.windup * 1.2, 12);
    expect(slow.root).toBeCloseTo(axe.root * 1.2, 12);
    expect(slow.interval).toBe(axe.interval);
    const sword = weaponTimings("sword", 1);
    expect(scaleWindup(sword, 50).windup).toBe(1);
    expect(scaleWindup(sword, 0.5).windup).toBeCloseTo(sword.windup / 2, 12);
    expect(scaleWindup(sword, 0.5).root).toBe(0);
    // A short axe windup keeps its root no shorter than the windup.
    const a = scaleWindup(weaponTimings("axe", 1), 3);
    expect(a.root).toBeGreaterThanOrEqual(a.windup);
  });

  it("scaleWindup never shortens a ranged windup (owner ruling \"Melee windups only\"): the same timings back, whatever the mult below 1", () => {
    const bow = weaponTimings("bow", 1.14); // cap-bound: 0.6 s
    const wand = weaponTimings("wand", 1.01); // cap-bound: 0.4 s
    const plague = weaponTimings("bow", 0.2772); // share-bound: 0.255 s
    const fastWand = weaponTimings("wand", 0.45); // 0.36 s
    for (const t of [bow, wand, plague, fastWand]) {
      for (const m of [0.999, 0.92, 0.88, 0.6, 0.5, 0.4, 0.05]) expect(scaleWindup(t, m), `${t.windup} x${m}`).toBe(t);
    }
    // A mult of 1 or more lengthens every weapon, never past the interval (no source lengthens windups today).
    expect(scaleWindup(bow, 1.2).windup).toBeCloseTo(0.72, 12);
    expect(scaleWindup(wand, 1.5).windup).toBeCloseTo(0.6, 12);
    expect(scaleWindup(plague, 1.05).windup).toBeCloseTo(plague.windup * 1.05, 12);
    expect(scaleWindup(plague, 2).windup).toBe(plague.interval);
    expect(scaleWindup(weaponTimings("bow", 0.55), 1.5).windup).toBe(0.55);
    expect(scaleWindup(bow, 1.2)).toMatchObject({ interval: bow.interval, root: 0, ranged: true });
  });

  it("scaleWindup shortens the melee windups (the sword's, the bash's, the axe's and its root) by the mult, down to nothing", () => {
    const sword = weaponTimings("sword", 1);
    expect(scaleWindup(sword, 0.88).windup).toBeCloseTo(0.088, 12);
    expect(scaleWindup(sword, 0.5).windup).toBeCloseTo(0.05, 12);
    expect(scaleWindup(sword, 0.4).windup).toBeCloseTo(0.04, 12);
    const bash = weaponTimings("shield", 1);
    expect(scaleWindup(bash, 0.5).windup).toBeCloseTo(0.05, 12);
    const axe = weaponTimings("axe", 1.19); // 0.25 s windup, 0.5 s root
    const quick = scaleWindup(axe, 0.88);
    expect(quick.windup).toBeCloseTo(0.22, 12);
    expect(quick.root).toBeCloseTo(0.44, 12);
    const half = scaleWindup(axe, 0.5);
    expect(half.windup).toBeCloseTo(0.125, 12);
    expect(half.root).toBeCloseTo(0.25, 12);
    expect(half.interval).toBe(axe.interval);
    // The root never ends before the windup does.
    for (const m of [0.05, 0.4, 0.6, 0.8]) expect(scaleWindup(axe, m).root).toBeGreaterThanOrEqual(scaleWindup(axe, m).windup);
  });
});

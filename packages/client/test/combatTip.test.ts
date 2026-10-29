import { describe, expect, it } from "vitest";
import { ABILITIES, TRIAL_EXIT_STUN_MS, TRIAL_MOVE_MULT, WEAPONS, WISH_COOLDOWN_SECONDS } from "@raid/shared";
import { abilityTip, weaponTip, wishCooldownMultiplier } from "../src/ui/combatTip";

describe("ability hover details", () => {
  it("shows actual area, duration, damage modifiers and exit stun", () => {
    const tip = abilityTip(ABILITIES.trial);
    expect(tip).toContain("5 s");
    expect(tip).toContain("80% damage");
    expect(tip).toContain("120% from you");
    expect(tip).toContain(`${TRIAL_MOVE_MULT * 100}% speed`);
    expect(tip).toContain(`${TRIAL_EXIT_STUN_MS / 1000} s`);
    expect(tip).not.toContain("undefined");
  });

  it("shows Blaze's burn rate and linger separately", () => {
    const tip = abilityTip(ABILITIES.blaze);
    expect(tip).toContain("Reach: 64–300 u");
    expect(tip).toContain("30 true damage/s for 2.5 s");
    expect(tip).toContain("Burn lingers 2 s");
    expect(tip).not.toContain("undefined");
  });

  it("explains the effective Wish cooldown, including cards and training", () => {
    const mult = wishCooldownMultiplier({ arcaneOverload: 1 }, "fire");
    expect(mult).toBe(2);
    expect(abilityTip(ABILITIES.blaze, 1, undefined, { wishCooldownMult: mult })).toContain(`Cooldown: ${WISH_COOLDOWN_SECONDS * 2 / 60} min`);
    expect(abilityTip(ABILITIES.blaze, 1, undefined, { wishCooldownMult: mult, training: true })).toContain("Cooldown: 5 s");
  });
});

describe("player projectile hover details", () => {
  it("describes straight arrow skillshots and the wand's finite lock-on range from the live catalog", () => {
    const bow = weaponTip("bow", "fire"), wand = weaponTip("wand", "fire");
    for (const [id, text] of [["bow", bow], ["wand", wand]] as const) {
      const shape = WEAPONS[id].shape;
      if (shape.kind !== "projectile") throw new Error("expected a projectile weapon");
      expect(text).toContain(`${shape.range} attack range`);
      expect(text).toContain(`${shape.speed} speed`);
      expect(text).not.toMatch(/5 s|5s/);
    }
    expect(bow).toContain("directional skillshot, flies straight");
    expect(bow).not.toMatch(/lock|home/i);
    expect(wand).toContain("wand lock-on follows targets within the ball's travel range");
  });
});

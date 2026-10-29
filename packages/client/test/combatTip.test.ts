import { describe, expect, it } from "vitest";
import { ABILITIES, TRIAL_EXIT_STUN_MS, TRIAL_MOVE_MULT, WISH_COOLDOWN_SECONDS } from "@raid/shared";
import { abilityTip, wishCooldownMultiplier } from "../src/ui/combatTip";

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

import { describe, expect, it } from "vitest";
import { MOB_TYPES, MOB_STAT_CAP, MOB_STAT_REWARDS, mobStatCount, mobStatReward, mobStatRows, mobStatText } from "../src";
import { PlayerState } from "../src/schema";

describe("normal mob kill progression", () => {
  it("rewards exactly one stat for each normal type and no stat for elites", () => {
    expect(MOB_STAT_REWARDS).toHaveLength(MOB_TYPES.filter((m) => !m.elite).length);
    for (const mob of MOB_TYPES) {
      const reward = mobStatReward(mob.id);
      expect(Boolean(reward), mob.id).toBe(!mob.elite && ["emberImp", "cinderHound", "magmaBrute", "bailiff", "chainWarden", "inquisitor", "plagueRat", "bloatfly", "rotMonk", "frostWisp", "iceGolem", "rimeStalker", "acolyte", "seraphShard", "penitent", "flameCaller", "pardoner", "miasmaWitch", "frostbowSentry", "zealot"].includes(mob.id));
      if (reward) expect(["flat", "stat"]).toContain(reward.effect.k);
    }
  });
  it("sanitizes per-type stacks, caps at ten, and folds same stats additively", () => {
    expect(mobStatCount({ emberImp: 999 }, "emberImp")).toBe(MOB_STAT_CAP);
    expect(mobStatCount({ emberImp: -2 }, "emberImp")).toBe(0);
    expect(mobStatCount({ emberImp: 2.8 }, "emberImp")).toBe(2);
    expect(mobStatCount({}, "wyrmling")).toBe(0);
    expect(mobStatRows({ emberImp: 10, inquisitor: 10 })).toEqual([{ k: "stat", stat: "damage", v: 0.2 }]);
    expect(mobStatText("emberImp", 10)).toBe("+10% damage");
    expect(mobStatText("wyrmling")).toBe("");
  });
  it("adds mobStats at the end of PlayerState's wire schema", () => {
    const player = new PlayerState();
    expect(player.mobStats).toBeDefined();
  });
});

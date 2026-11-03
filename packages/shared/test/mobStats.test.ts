import { describe, expect, it } from "vitest";
import { MOB_KILL_STACKS, MOB_TYPES, MOB_STAT_CAP, MOB_STAT_REWARDS, mobStatCount, mobStatReward, mobStatRows, mobStatText } from "../src";
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
  it("sanitizes uncapped safe-integer counts and folds same stats additively", () => {
    expect(MOB_STAT_CAP).toBe(10); // benchmark reference only, not a progression ceiling
    expect(mobStatCount({ emberImp: 999 }, "emberImp")).toBe(999);
    expect(mobStatCount({ emberImp: -2 }, "emberImp")).toBe(0);
    expect(mobStatCount({ emberImp: 2.8 }, "emberImp")).toBe(2);
    expect(mobStatCount({ emberImp: Number.POSITIVE_INFINITY }, "emberImp")).toBe(0);
    expect(mobStatCount({ emberImp: Number.MAX_SAFE_INTEGER + 1 }, "emberImp")).toBe(0);
    expect(mobStatCount({}, "wyrmling")).toBe(0);
    expect(mobStatRows({ emberImp: 1000, inquisitor: 1000 })).toEqual([{ k: "stat", stat: "damage", v: 20 }]);
    expect(mobStatText("emberImp", 1000)).toBe("+1,000% damage");
    expect(mobStatText("wyrmling")).toBe("");
  });
  it("grants MOB_KILL_STACKS (3, the owner's \"3x mob rewards\") stacks a kill and states the per-kill amount, never tripling the per-stack value", () => {
    expect(MOB_KILL_STACKS).toBe(3);
    // The per-stack effect is what quests pay in (shared/quests.ts), so it stays one stack's worth...
    expect(mobStatReward("emberImp")!.effect).toEqual({ k: "stat", stat: "damage", v: 0.01 });
    expect(mobStatReward("pardoner")!.effect).toEqual({ k: "flat", stat: "ad", v: 1 });
    expect(mobStatText("emberImp")).toBe("+1% damage");
    // ...and the player-facing "per kill" text reads three stacks.
    expect(mobStatReward("emberImp")!.text).toBe("+3% damage per kill");
    expect(mobStatReward("cinderHound")!.text).toBe("+1.5% move speed per kill");
    expect(mobStatReward("rotMonk")!.text).toBe("+0.75% lifesteal per kill");
    expect(mobStatReward("bailiff")!.text).toBe("+3 Defense per kill");
    expect(mobStatReward("pardoner")!.text).toBe("+3 Offense per kill");
    for (const r of MOB_STAT_REWARDS) {
      const perKill = r.effect.k === "stat" ? r.effect.v * MOB_KILL_STACKS * 100 : r.effect.v * MOB_KILL_STACKS;
      expect(Number(r.text.match(/^\+([\d.]+)/)![1]), r.id).toBeCloseTo(perKill, 9);
      // mobStatText still reads a count of stacks: three of them are one kill.
      expect(mobStatText(r.id, MOB_KILL_STACKS), r.id).toBe(r.text.replace(/ per kill$/, ""));
    }
  });
  it("adds mobStats at the end of PlayerState's wire schema", () => {
    const player = new PlayerState();
    expect(player.mobStats).toBeDefined();
  });
});

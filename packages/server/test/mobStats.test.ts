import { describe, expect, it } from "vitest";
import { MOB_STAT_CAP, MOB_STAT_REWARDS, decodeMirrors, FACTIONS, mobStatCount, mobStatRows, mobStatReward, mulberry32, TICK_MS } from "@raid/shared";
import { createGameWorld } from "../src/sim/gameplay";
import { combatant } from "../src/sim/combatant";
import { addPlayer, step } from "../src/sim/step";
import { grantMobStat } from "../src/sim/mobStats";
import { lifestealRowsOf, outgoingMult } from "../src/sim/mods";

function fixture() {
  const world = createGameWorld({ seed: 122, random: mulberry32(122), config: { minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 60, mobs: false, pvpRules: false } });
  addPlayer(world, "p", "Player");
  step(world, TICK_MS);
  return { world, player: combatant(world, "p") as Extract<ReturnType<typeof combatant>, { kind: "player" }> };
}

describe("fixed mob stat progression", () => {
  it("applies each grant at a fixed per-stack value and clamps at ten", () => {
    const { world, player } = fixture();
    const reward = mobStatReward("emberImp")!;
    expect(grantMobStat(world, player, "emberImp")).toBe(1);
    const first = mobStatRows(player.s.mobStats)[0]!;
    expect(grantMobStat(world, player, "emberImp", 9)).toBe(9);
    const tenth = mobStatRows(player.s.mobStats)[0]!;
    expect(tenth.k).toBe(first.k);
    expect((tenth as { v: number }).v).toBeCloseTo((first as { v: number }).v * 10);
    expect(grantMobStat(world, player, "emberImp", 99)).toBe(0);
    expect(mobStatCount(player.s.mobStats, "emberImp")).toBe(MOB_STAT_CAP);
    expect(reward).toBeDefined();
  });

  it("rejects fractional, negative, non-finite, elite, and unknown grants", () => {
    const { world, player } = fixture();
    expect(grantMobStat(world, player, "emberImp", 0.9)).toBe(0);
    expect(grantMobStat(world, player, "emberImp", -1)).toBe(0);
    expect(grantMobStat(world, player, "emberImp", Number.NaN)).toBe(0);
    expect(grantMobStat(world, player, "emberImp", Number.POSITIVE_INFINITY)).toBe(0);
    expect(grantMobStat(world, player, "wyrmling")).toBe(0);
    expect(grantMobStat(world, player, "not-a-mob")).toBe(0);
    player.s.status = "dead";
    expect(grantMobStat(world, player, "emberImp")).toBe(0);
    expect(player.s.mobStats.size).toBe(0);
  });
});


it("keeps a completely maxed normal-mob build additive and within the intended totals", () => {
  const { world, player } = fixture();
  for (const reward of MOB_STAT_REWARDS) grantMobStat(world, player, reward.id, 10);
  const mirrors = decodeMirrors(player.s);
  expect(mirrors.asMult).toBeCloseTo(1.2);
  expect(mirrors.speedMult).toBeCloseTo(1.1);
  expect(mirrors.armorBonus).toBe(30);
  expect(mirrors.shieldBonus).toBe(30);
  expect(mirrors.adBonus).toBe(10);
  expect(mirrors.apBonus).toBe(20);
  expect(player.s.maxHp).toBeCloseTo(FACTIONS[player.s.faction as keyof typeof FACTIONS].hp * 1.3);
  expect(lifestealRowsOf(player.s)).toBeCloseTo(0.05);
  expect(outgoingMult(player.s, 1)).toBeCloseTo(1.2);
  expect(player.s.build.size).toBe(0);
});

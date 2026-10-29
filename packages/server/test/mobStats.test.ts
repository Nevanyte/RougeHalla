import { describe, expect, it } from "vitest";
import { MOB_STAT_REWARDS, decodeMirrors, FACTIONS, mobStatCount, mobStatRows, mobStatReward, mulberry32, TICK_MS } from "@raid/shared";
import { createGameWorld } from "../src/sim/gameplay";
import { combatant } from "../src/sim/combatant";
import { addPlayer, step } from "../src/sim/step";
import { grantMobStat } from "../src/sim/mobStats";
import { farmLifestealRowsOf, lifestealRowsOf, outgoingMult } from "../src/sim/mods";

function fixture() {
  const world = createGameWorld({ seed: 122, random: mulberry32(122), config: { minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 60, mobs: false, pvpRules: false } });
  addPlayer(world, "p", "Player");
  step(world, TICK_MS);
  return { world, player: combatant(world, "p") as Extract<ReturnType<typeof combatant>, { kind: "player" }> };
}

describe("fixed mob stat progression", () => {
  it("applies fixed per-stack grants without a per-type ceiling", () => {
    const { world, player } = fixture();
    const reward = mobStatReward("emberImp")!;
    expect(grantMobStat(world, player, "emberImp")).toBe(1);
    const first = mobStatRows(player.s.mobStats)[0]!;
    expect(grantMobStat(world, player, "emberImp", 9)).toBe(9);
    const tenth = mobStatRows(player.s.mobStats)[0]!;
    expect(tenth.k).toBe(first.k);
    expect((tenth as { v: number }).v).toBeCloseTo((first as { v: number }).v * 10);
    expect(grantMobStat(world, player, "emberImp", 999)).toBe(999);
    expect(mobStatCount(player.s.mobStats, "emberImp")).toBe(1009);
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


it("keeps all normal-mob farm stats effective well beyond the former ten-stack ceiling", () => {
  const { world, player } = fixture();
  for (const reward of MOB_STAT_REWARDS) grantMobStat(world, player, reward.id, 1000);
  const mirrors = decodeMirrors(player.s);
  expect(mirrors.asMult).toBeCloseTo(21);
  expect(mirrors.speedMult).toBeCloseTo(11);
  expect(mirrors.armorBonus).toBe(3000);
  expect(mirrors.shieldBonus).toBe(3000);
  expect(mirrors.adBonus).toBe(1000);
  expect(mirrors.apBonus).toBe(2000);
  expect(player.s.maxHp).toBeCloseTo(FACTIONS[player.s.faction as keyof typeof FACTIONS].hp * 31);
  expect(lifestealRowsOf(player.s)).toBe(0); // ordinary card rows remain separately capped
  expect(farmLifestealRowsOf(player.s)).toBeCloseTo(5);
  expect(outgoingMult(player.s, 1)).toBeCloseTo(21);
  expect(player.s.build.size).toBe(0);
});

// The Plague fix (balance contract 6.1, acceptance A13): a mob's `execute` is scaled by k squared because it reads the player's
// hp fraction, whose pool is full-scale. The sim reaches it through factionOf (combatant.ts), and bench/mobExecute.ts measures
// it: seconds until a motionless player at 25% hp dies to one normal mob of each zone.
import { describe, expect, it } from "vitest";
import { DUEL_PACE, ELITE_K, FACTION_IDS, FACTIONS, MOB_K, mulberry32 } from "@raid/shared";
import { A13_MIN_RATIO, executeTable, runMobExecute } from "../bench/mobExecute";
import { combatant, factionOf } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { placeMob } from "../src/sim/mobLife";

function mobSpec(elite: boolean) {
  const world = createGameWorld({
    seed: 3, config: { minPlayers: 1, lobbySeconds: 1, fillSeconds: 0, patienceSeconds: 1e6, patienceMinSeconds: 1e6, suddenDeathSeconds: 1e6, mobs: false },
    random: mulberry32(1),
  }, { signatures: true });
  const id = placeMob(world, { region: "plague", elite, at: { x: 400, y: 400 } });
  return factionOf(combatant(world, id)!.s)!;
}

describe("a Plague mob's execute in the sim", () => {
  it("is the player sheet's times k squared (and the arena pace), normal and elite; its disease is times k", () => {
    const base = FACTIONS.plague.params;
    const normal = mobSpec(false), elite = mobSpec(true);
    expect(normal.params.execute).toBeCloseTo(base.execute! * MOB_K * MOB_K * DUEL_PACE, 9);
    expect(elite.params.execute).toBeCloseTo(base.execute! * ELITE_K * ELITE_K * DUEL_PACE, 9);
    expect(normal.params.plague).toBeCloseTo(base.plague! * MOB_K * DUEL_PACE, 9);
    expect(elite.params.plague).toBeCloseTo(base.plague! * ELITE_K * DUEL_PACE, 9);
  });
});

describe("bench/mobExecute (A13)", () => {
  const table = executeTable({ hpFrac: 0.25, mobs: 1, elite: false, capS: 120 });

  it("the Plague zone takes at least half the other zones' median to kill a player at 25% hp, pooled over the five player factions", () => {
    expect(table.pooled).toBeGreaterThanOrEqual(A13_MIN_RATIO);
    for (const pf of FACTION_IDS) {
      expect(table.secs.plague[pf], pf).toBeGreaterThan(0);
      expect(table.byPlayer[pf], pf).toBeGreaterThan(0);
    }
  });

  it("is deterministic, and a mob that cannot be killed leaves the number the mob's own output", () => {
    const spec = { zone: "plague", player: "frost", hpFrac: 0.25, mobs: 1, elite: false, capS: 120 } as const;
    const a = runMobExecute(spec);
    expect(runMobExecute(spec)).toEqual(a);
    expect(a.ttk).not.toBeNull();
    expect(a.maxHp).toBe(FACTIONS.frost.hp);
  });

  it("a full-hp player lives longer than the same player at 25% (the execute needs a hurt player), Plague zone included", () => {
    const full = runMobExecute({ zone: "plague", player: "fire", hpFrac: 1, mobs: 1, elite: false, capS: 120 });
    const hurt = runMobExecute({ zone: "plague", player: "fire", hpFrac: 0.25, mobs: 1, elite: false, capS: 120 });
    expect(hurt.ttk).not.toBeNull();
    expect((full.ttk ?? 120)).toBeGreaterThan(hurt.ttk!);
  });
});

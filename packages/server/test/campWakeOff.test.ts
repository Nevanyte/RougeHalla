// D24's switch (CAMP_WIDE_AGGRO) off: a mob wakes on its own damage only, and that includes its death. The flag is a module
// constant, so this file mocks it; the same checks with it on are in chests.test.ts ("camp-wide aggro (D24)").
import { describe, expect, it, vi } from "vitest";
import { mulberry32, TICK_MS } from "@raid/shared";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { applyLedger, recordHit } from "../src/sim/ledger";
import type { MobCombatant } from "../src/sim/mobLife";
import { addPlayer, step } from "../src/sim/step";
import type { World } from "../src/sim/world";

vi.mock("@raid/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@raid/shared")>()),
  CAMP_WIDE_AGGRO: false,
}));

function run(): World {
  const w = createGameWorld({
    seed: 11,
    config: { minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600, mobs: true },
    random: mulberry32(12),
    rewardSalt: 99,
  }, { signatures: false });
  addPlayer(w, "p0", "name0", { faction: "frost" });
  step(w, TICK_MS);
  return w;
}

const campMobs = (w: World, camp: number): MobCombatant[] =>
  [...w.state.mobs].filter(([, m]) => m.camp === camp + 1).map(([id]) => combatant(w, id) as MobCombatant);

const strike = (w: World, m: MobCombatant, raw: number): void => {
  recordHit(w, { victim: m.id, by: { id: "p0", name: "p0" }, packet: { raw, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false });
  applyLedger(w);
};

describe("with CAMP_WIDE_AGGRO off", () => {
  it("a hit wakes only the mob hit, and a lethal hit wakes nobody", () => {
    const w = run();
    const [a, b, c] = campMobs(w, 0);
    expect(campMobs(w, 0).length).toBeGreaterThan(2);
    strike(w, a!, 1);
    expect(a!.rt.brain!.mode).toBe("fight");
    for (const m of [b!, c!]) expect(m.rt.brain!.mode, m.id).toBe("idle");
    strike(w, b!, 1e6);
    expect(b!.s.status).toBe("dead");
    expect(c!.rt.brain!.mode).toBe("idle");
  });
});

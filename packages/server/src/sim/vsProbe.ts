// The answers to the `vs` tests that need the world (sim/mods.ts VsProbe): a victim slowed (a slowMove status, or Frost's chill),
// an elite mob, a player with more card power than the attacker, a player at all. sim/mods.ts is a leaf and cannot read a status runtime or the
// mobs, so the ledger's probe (sim/ledger.ts vsProbe) spreads these into the one it hands outgoingMult:
//   return { higherFeed, thirdParty, ...vsExtras(world, by, victim) };
// Lazy like the rest: nothing is read unless a row asks.
import { cardPower } from "@raid/shared";
import { combatant } from "./combatant";
import type { VsProbe } from "./mods";
import { isSlowed } from "./status";
import type { World } from "./world";

export function vsExtras(world: World, by: string, victim: string): Required<Pick<VsProbe, "slowed" | "elite" | "higherPower" | "player">> {
  return {
    slowed: () => {
      const c = combatant(world, victim);
      return c !== null && isSlowed(world, c);
    },
    elite: () => world.mobs.get(victim)?.brain?.elite === true,
    player: () => world.state.players.has(victim),
    higherPower: () => {
      const v = world.state.players.get(victim);
      const a = world.state.players.get(by);
      return v !== undefined && a !== undefined && cardPower(v.build) > cardPower(a.build);
    },
  };
}

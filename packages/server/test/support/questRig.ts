// Same-tick quest races are decided by tieRank, which hashes the secret orderSalt with the tick and the id. A test that
// wants a particular winner picks a salt under which it wins at the tick the quest system will read (see rig).
import { tieRank, type World } from "../../src/sim/world";

/** step() raises the tick before the quest system reads the ranks, so the rank that decides a race is the NEXT tick's. */
export function rankNextTick(world: World, id: string): number {
  const tick = world.state.tick;
  world.state.tick = tick + 1;
  try { return tieRank(world, id); } finally { world.state.tick = tick; }
}

/** Picks a secret salt under which `low` outranks `high` (the lower tieRank wins) at the next tick. */
export function rig(world: World, low: string, high: string): void {
  for (let salt = 1; salt < 4000; salt++) {
    world.orderSalt = salt;
    if (rankNextTick(world, low) < rankNextTick(world, high)) return;
  }
  throw new Error("no salt found");
}

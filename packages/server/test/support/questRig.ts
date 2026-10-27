// Same-tick quest races are decided by tieRank, which hashes the secret orderSalt with the tick and the id. A test that
// wants a particular winner picks a salt under which it wins at the tick the quest system will read (see rig).
import { TICK_MS } from "@raid/shared";
import { enqueueClientMessage } from "../../src/sim/inputs";
import type { QuestRuntime } from "../../src/sim/quests";
import { step } from "../../src/sim/step";
import { tieRank, type World } from "../../src/sim/world";

/**
 * What a player's `questAccept` at the giver records, set directly, for the tests that are about something else (progress, the
 * turn-in, the carrier): `ids` default to every player in the world now, fill bots included, so a test of a bot's exclusion
 * still reaches the rule it names and not the missing accept. A test about acceptance itself sends the real message instead.
 */
export function accept(world: World, qt: Pick<QuestRuntime, "s">, ...ids: string[]): void {
  for (const id of ids.length > 0 ? ids : [...world.state.players.keys()]) qt.s.accepted.set(id, true);
}

/** The real flow: stands the player at the giver, sends `questAccept` and runs one tick. True when the offer then lists them. */
export function acceptAtGiver(world: World, qt: Pick<QuestRuntime, "id" | "s">, id = "p0"): boolean {
  const p = world.state.players.get(id)!;
  p.x = qt.s.x;
  p.y = qt.s.y;
  enqueueClientMessage(world.players.get(id)!.inputs, "questAccept", { quest: qt.id });
  step(world, TICK_MS);
  return qt.s.accepted.get(id) === true;
}

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

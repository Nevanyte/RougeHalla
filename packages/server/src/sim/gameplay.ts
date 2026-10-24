// Assembles a fully-featured world: base lifecycle (step.ts + arena.ts, which also run the combat phases) + every
// gameplay module. Modules expose `install(world)` and register into world.actions / world.systems / world.hooks.
import { install as installFactions } from "./factions";
import { install as installLoot } from "./loot";
import { install as installMobs } from "./mobs";
import { install as installProjectiles } from "./projectiles";
import { install as installWeapons } from "./weapons";
import { createWorld, type World } from "./world";

type CreateOpts = Parameters<typeof createWorld>[0];

const MODULES: Array<(world: World) => void> = [
  installLoot,
  installWeapons,
  installProjectiles,
  installFactions,
  installMobs,
];

/**
 * `signatures: false` leaves faction signatures out (sim/factions.ts): tests that check a weapon's own damage, timing or
 * fx use it, since the signatures add damage between fighters in contact.
 */
export function createGameWorld(opts: CreateOpts, modules: { signatures?: boolean } = {}): World {
  const world = createWorld(opts);
  for (const install of MODULES) {
    if (install === installFactions && modules.signatures === false) continue;
    install(world);
  }
  return world;
}

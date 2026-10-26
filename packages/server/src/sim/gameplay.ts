// Assembles a fully-featured world: base lifecycle (step.ts + arena.ts, which also run the combat phases) + every
// gameplay module. Modules expose `install(world)` and register into world.actions / world.systems / world.hooks.
import { install as installAbilities } from "./abilities";
import { install as installBuffs } from "./buffs";
import { install as installFactions } from "./factions";
import { install as installFeed } from "./feed";
import { install as installLoot } from "./loot";
import { install as installMobAI } from "./mobAI";
import { install as installMobLife } from "./mobLife";
import { install as installMobs } from "./mobs";
import { install as installMods } from "./mods";
import { install as installProjectiles } from "./projectiles";
import { install as installTargeting } from "./targeting";
import { install as installWeapons } from "./weapons";
import { createWorld, type World } from "./world";

type CreateOpts = Parameters<typeof createWorld>[0];

const MODULES: Array<(world: World) => void> = [
  installLoot,
  installWeapons,
  installTargeting,
  installProjectiles,
  installFactions,
  installMobs,
  installBuffs,
  installFeed,
  installMobLife,
  installMobAI,
  installAbilities,
  // Last: its system folds the stat mirrors once every other system of the tick has run.
  installMods,
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

// Assembles a fully-featured world: base lifecycle (step.ts + arena.ts, which also run the combat phases) + every
// gameplay module. Modules expose `install(world)` and register into world.actions / world.systems / world.hooks.
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
  installMobs,
];

export function createGameWorld(opts: CreateOpts): World {
  const world = createWorld(opts);
  for (const install of MODULES) install(world);
  return world;
}

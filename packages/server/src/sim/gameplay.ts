// Assembles a fully-featured world: base lifecycle (step.ts) + every gameplay module.
// Modules expose `install(world)` and register into world.actions / world.systems / world.hooks.
import { createWorld, type World } from "./world";

type CreateOpts = Parameters<typeof createWorld>[0];

const MODULES: Array<(world: World) => void> = [];

export function createGameWorld(opts: CreateOpts): World {
  const world = createWorld(opts);
  for (const install of MODULES) install(world);
  return world;
}

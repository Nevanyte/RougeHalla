// Assembles a fully-featured world: base lifecycle (step.ts + arena.ts, which also run the combat phases) + every
// gameplay module. Modules expose `install(world)` and register into world.actions / world.systems / world.hooks.
import { install as installAbilities } from "./abilities";
import { install as installBuffs } from "./buffs";
import { install as installCampHeal } from "./campHeal";
import { install as installCardHooks } from "./cardHooks";
import { install as installCamps } from "./camps";
import { install as installChests } from "./chests";
import { install as installFactions } from "./factions";
import { install as installFeed } from "./feed";
import { install as installLoot } from "./loot";
import { install as installMobAI } from "./mobAI";
import { install as installMobLife } from "./mobLife";
import { install as installMobs } from "./mobs";
import { install as installMods } from "./mods";
import { install as installProjectiles } from "./projectiles";
import { install as installQuests } from "./quests";
import { install as installTargeting } from "./targeting";
import { install as installTerrain } from "./terrainEffects";
import { install as installWeapons } from "./weapons";
import { install as installVision } from "./vision";
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
  // Before mobLife: the rosters are published (from rewardRandom) at build, so the lobby and planning can read them.
  installCamps,
  // The camps' shared chests (R5): the `choose` action, expiry, and the drop on the campCleared hook.
  installChests,
  installMobLife,
  installMobAI,
  // Terrain hazards: after the signatures (burn joins the ledger behind their entries) and the faction layer's afterDamage
  // (light heals once this tick's combat clock is stamped), before the stat mirrors.
  installTerrain,
  installAbilities,
  installQuests,
  installVision,
  // After chests (and quests): the campCleared hook chain reads the camp's contributors first, this link heals them and forgets them.
  installCampHeal,
  // The phase-B cards' hooks (hitLanded, blocked, overkilled, a system after the damage, a mod source): after the modules whose
  // hooks they chain onto (abilities' statuses, the faction layer's heal), before the mirrors are folded.
  installCardHooks,
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

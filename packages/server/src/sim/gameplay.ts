// Assembles a fully-featured world: base lifecycle (step.ts + arena.ts, which also run the combat phases) + every
// gameplay module. Modules expose `install(world)` and register into world.actions / world.systems / world.hooks.
import { install as installAbilities } from "./abilities";
import { install as installBuffs } from "./buffs";
import { install as installBruiserPassives } from "./bruiserPassives";
import { install as installCampHeal } from "./campHeal";
import { install as installCardHooks } from "./cardHooks";
import { install as installCamps } from "./camps";
import { install as installChests } from "./chests";
import { install as installConsumables } from "./consumables";
import { install as installTraders } from "./traders";
import { install as installSpells } from "./spells";
import { install as installFactions } from "./factions";
import { install as installFeed } from "./feed";
import { install as installFireRoam } from "./fireRoam";
import { install as installKillAugments } from "./killAugments";
import { install as installLoot } from "./loot";
import { install as installMobAI } from "./mobAI";
import { install as installMobLife } from "./mobLife";
import { install as installMobs } from "./mobs";
import { install as installMods } from "./mods";
import { install as installProjectiles } from "./projectiles";
import { install as installPlagueCorpses } from "./plagueCorpses";
import { install as installPlagueZombies } from "./plagueZombies";
import { install as installRegen } from "./regen";
import { install as installQuests } from "./quests";
import { install as installSentencedHunt } from "./sentencedHunt";
import { install as installTargeting } from "./targeting";
import { install as installTerrain } from "./terrainEffects";
import { install as installWeapons } from "./weapons";
import { install as installVision } from "./vision";
import { install as installWalkHint } from "./walkHint";
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
  // Elite augment chests: the `choose` action, expiry, and the drop on the elite mobKilled hook.
  installChests,
  // Kill augments: the playerKilled trophy (private reward container; its pick is chests.ts `choose`).
  installKillAugments,
  installMobLife,
  installMobAI,
  // Terrain hazards: after the signatures (burn joins the ledger behind their entries) and the faction layer's afterDamage
  // (light heals once this tick's combat clock is stamped), before the stat mirrors.
  installTerrain,
  // Passive regen: after the faction layer and terrain, so this tick's hits have stamped the combat clock.
  installRegen,
  installAbilities,
  installQuests,
  installVision,
  // After chests (and quests): the campCleared hook chain reads the camp's contributors first, this link drops a potion, credits the clear and forgets contributors.
  installCampHeal,
  installConsumables,
  installTraders,
  // After loot and quests: its raidStarted link lays the spell finds clear of every container already placed, and its dropBody link
  // drops the held spell after the body.
  installSpells,
  // The phase-B cards' hooks (hitLanded, blocked, overkilled, a system after the damage, a mod source): after the modules whose
  // hooks they chain onto (abilities' statuses, the faction layer's heal), before the mirrors are folded.
  installCardHooks,
  installPlagueCorpses,
  installFireRoam,
  installBruiserPassives,
  installSentencedHunt,
  // Last: its system folds the stat mirrors once every other system of the tick has run.
  installMods,
  // Companions read the final owner max-health fold when following and growing.
  installPlagueZombies,
  // Presentation only (the walk hint mirrors, docs/PLAYER_PREDICTION.md Stage 2): after every system that changes the game, so it
  // reads the paths and roots the next tick starts from. It changes nothing the sim reads.
  installWalkHint,
];

/**
 * `signatures: false` leaves faction signatures out (sim/factions.ts): tests that check a weapon's own damage, timing or
 * fx use it, since the signatures add damage between fighters in contact. `walkHints: false` leaves the walk hint out (the
 * no-outcome-change tests and the bandwidth comparison).
 */
export function createGameWorld(opts: CreateOpts, modules: { signatures?: boolean; walkHints?: boolean } = {}): World {
  const world = createWorld(opts);
  for (const install of MODULES) {
    if (install === installWalkHint && modules.walkHints === false) continue;
    // `signatures: false` is the weapon-only test world. Keep faction passives, including Fire's roaming charge,
    // out together so those tests retain a faction-neutral movement baseline.
    if ((install === installFactions || install === installFireRoam || install === installBruiserPassives
      || install === installPlagueCorpses || install === installPlagueZombies || install === installSentencedHunt) && modules.signatures === false) continue;
    install(world);
  }
  return world;
}

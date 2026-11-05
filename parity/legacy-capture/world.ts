import { createGameWorld } from "../../packages/server/src/sim/gameplay";
import { createWorld } from "../../packages/server/src/sim/world";
import { mulberry32, type GameMap } from "@raid/shared";
import type { Scenario } from "./scenarios/types";
import { install as installAbilities } from "../../packages/server/src/sim/abilities";
import { install as installBuffs } from "../../packages/server/src/sim/buffs";
import { install as installBruiserPassives } from "../../packages/server/src/sim/bruiserPassives";
import { install as installCampHeal } from "../../packages/server/src/sim/campHeal";
import { install as installCardHooks } from "../../packages/server/src/sim/cardHooks";
import { install as installCamps } from "../../packages/server/src/sim/camps";
import { install as installChests } from "../../packages/server/src/sim/chests";
import { install as installConsumables } from "../../packages/server/src/sim/consumables";
import { install as installTraders } from "../../packages/server/src/sim/traders";
import { install as installFactions } from "../../packages/server/src/sim/factions";
import { install as installFeed } from "../../packages/server/src/sim/feed";
import { install as installFireRoam } from "../../packages/server/src/sim/fireRoam";
import { install as installKillAugments } from "../../packages/server/src/sim/killAugments";
import { install as installLoot } from "../../packages/server/src/sim/loot";
import { install as installMobAI } from "../../packages/server/src/sim/mobAI";
import { install as installMobLife } from "../../packages/server/src/sim/mobLife";
import { install as installMobs } from "../../packages/server/src/sim/mobs";
import { install as installMods } from "../../packages/server/src/sim/mods";
import { install as installProjectiles } from "../../packages/server/src/sim/projectiles";
import { install as installPlagueCorpses } from "../../packages/server/src/sim/plagueCorpses";
import { install as installPlagueZombies } from "../../packages/server/src/sim/plagueZombies";
import { install as installRegen } from "../../packages/server/src/sim/regen";
import { install as installQuests } from "../../packages/server/src/sim/quests";
import { install as installSentencedHunt } from "../../packages/server/src/sim/sentencedHunt";
import { install as installTargeting } from "../../packages/server/src/sim/targeting";
import { install as installTerrain } from "../../packages/server/src/sim/terrainEffects";
import { install as installWeapons } from "../../packages/server/src/sim/weapons";
import { install as installVision } from "../../packages/server/src/sim/vision";
import { install as installWalkHint } from "../../packages/server/src/sim/walkHint";

export const MODULES = {
  loot: installLoot,
  weapons: installWeapons,
  targeting: installTargeting,
  projectiles: installProjectiles,
  factions: installFactions,
  mobs: installMobs,
  buffs: installBuffs,
  feed: installFeed,
  camps: installCamps,
  chests: installChests,
  killAugments: installKillAugments,
  mobLife: installMobLife,
  mobAI: installMobAI,
  terrainEffects: installTerrain,
  regen: installRegen,
  abilities: installAbilities,
  quests: installQuests,
  vision: installVision,
  campHeal: installCampHeal,
  consumables: installConsumables,
  traders: installTraders,
  cardHooks: installCardHooks,
  plagueCorpses: installPlagueCorpses,
  fireRoam: installFireRoam,
  bruiserPassives: installBruiserPassives,
  sentencedHunt: installSentencedHunt,
  mods: installMods,
  plagueZombies: installPlagueZombies,
  walkHint: installWalkHint,
};
export const DEFAULT_MODULES = Object.keys(MODULES).filter(name => !["factions", "fireRoam", "bruiserPassives", "plagueCorpses", "plagueZombies", "sentencedHunt", "walkHint"].includes(name));

/** Default fixtures still run the real production assembler. Custom module lists use the same exported installers,
 * in explicitly declared order, so signature tests can opt into each passive rather than an opaque boolean. */
export function createScenarioWorld(sc: Scenario, map: GameMap) {
  let itemUid = 0;
  const opts = {
    newItemUid: () => String(++itemUid),
    seed: map.seed, map,
    config: { minPlayers: sc.players.length, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600, ...sc.config },
    random: mulberry32(sc.randomSeed),
    rewardSalt: sc.secrets?.rewardSalt ?? [1, 2, 3, 4] as [number, number, number, number],
    questSalt: sc.secrets?.questSalt ?? [5, 6, 7, 8] as [number, number, number, number],
  };
  if (!sc.modules) return createGameWorld(opts, { signatures: false, walkHints: false });
  const world = createWorld(opts);
  for (const name of sc.modules) {
    const install = MODULES[name as keyof typeof MODULES];
    if (!install) throw new Error(`${sc.name}: unknown module ${name}`);
    install(world);
  }
  return world;
}

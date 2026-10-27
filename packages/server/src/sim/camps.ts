// Camp rosters and the public camp state (ROGUELIKE_PLAN D5, D16; 3.3). At world build, before anyone joins, each map camp
// gets its mono-type roster, rolled ONLY from world.rewardRandom (never world.random, so loot rolls and the wedge sim's
// draws are what they were, and never from the public seed, so a client cannot read a camp's type off the map). The result
// is published as `RaidState.camps`, one CampState per `map.camps` entry at the same index; geometry stays seed-derived.
// Mobs themselves still appear at `raidStarted` (mobLife.spawnRegionalMobs reads the roster), and the planning screen reads
// `state.camps` during the lobby. This module owns only the roster and `alive`: a camp's `state` and `reward` belong to the
// camp runtime (R5) and stay 0 and "" here.
import { rollCampTypes } from "@raid/shared";
import { CampState } from "@raid/shared/schema";
import type { World } from "./world";

/**
 * Rolls every camp's roster and replaces `state.camps` with it: one CampState per `map.camps` entry, `type` the camp's
 * normal mob type, `alive` its spot count (one mob per spot), `reward` "" and `state` 0. Draws only from `world.rewardRandom`
 * (zones in first-seen order, see rollCampTypes). A map without camps (a hand-built test map) publishes none.
 */
export function rollRosters(world: World): void {
  const camps = world.map.camps;
  const types = rollCampTypes(camps.map((c) => c.zone), world.rewardRandom);
  world.state.camps.clear();
  camps.forEach((camp, i) => {
    const s = new CampState();
    s.type = types[i]!;
    s.reward = "";
    s.alive = camp.spots.length;
    s.state = 0;
    world.state.camps.push(s);
  });
}

/**
 * Makes sure a roster is published for the map's camps: rolls one when `state.camps` does not match `map.camps` in length
 * (it is empty, or a test swapped the map after the build) and does nothing otherwise, so it never draws twice. Worlds
 * built without gameplay.ts (createWorld plus mobLife.install, as many tests do) get their roster here, when mobs spawn.
 * Training worlds never get one: their callers (spawnRegionalMobs) return before asking.
 */
export function ensureRosters(world: World): void {
  if (world.state.camps.length === world.map.camps.length) return;
  rollRosters(world);
}

/**
 * A mob of camp `campRef` (MobState.camp: the camp's index + 1, 0 = none) died: one fewer alive, never below 0. A reference to
 * no published camp is ignored (a mob placed by a test without one).
 */
export function campMobDied(world: World, campRef: number): void {
  if (!(campRef >= 1)) return;
  const s = world.state.camps[campRef - 1];
  if (s && s.alive > 0) s.alive--;
}

/**
 * Installed at world build, before any join, so the rosters are readable from the lobby on. Only for a world with regional
 * mobs (`config.mobs`) and never for training, which has no camps: everything else keeps an empty `state.camps`.
 */
export function install(world: World): void {
  if (world.config.mobs && !world.config.training) ensureRosters(world);
}

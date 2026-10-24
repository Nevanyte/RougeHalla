// A regional mob's life (GAME_DESIGN 11): it is placed at its camp when the run starts, takes damage through the ledger
// (hurtMob), dies once (killMob: GV, a buff, its weapon), lies there MOB_CORPSE_MS and is removed. The AI that moves it
// and decides its attacks is mobAI.ts. A training dummy (kind "dummy") is not handled here: see mobs.ts.
//
// Contract (the spine; the track fills the bodies in):
//   - Spawning, once per run in `raidStarted` and only when SimConfig.mobs is set: for every region's camp (map.regions[].
//     mobCamps), one mob per camp spot, in map order. The elite camp's FIRST spot is the region's one elite (kind "elite"),
//     the rest of that camp and every other camp are kind "mob". A mob's state: faction = the region id, weapon0 = the
//     camp's weapon, name from mobName, hp/maxHp = mobFaction(region, elite).hp (hp is not paced), status "alive", facing
//     toward the camp centre. Its runtime gets a MobBrain (mode "idle", home = the spot) and a staggered `phase`. Ids come
//     from addMob (mobs.ts), so they are unique and the order is deterministic for a map.
//   - hurtMob(world, c, amounts, entries) is the ledger's way down for a regional mob (ledger.ts calls it instead of
//     damageMob when kind != "dummy"). `amounts[i]` is the mitigated damage of `entries[i]`. It removes the hp (never
//     below 0), stamps lastHitAt, tells the AI who hit it (aggro) and, when the hp is gone, kills it. Returns the hp removed.
//   - killMob: status "dead", brain.diedAt = now, input queue and path cleared, a `death` fx (by = the killer's id). The
//     killer is the player with the largest hit in `entries` (ties go to the earlier entry) who is still in the run and
//     has not resolved; with none, the mob just dies (no rewards). The killer gets, in this order:
//       1. the reward multiplier m = mobRewardFor(world, p, rt), read BEFORE the kill is counted;
//       2. creditMobKill (arena.ts): mob GV (x m, GV_MOB / GV_ELITE, capped) and the feed;
//       3. one buff drop: rollBuffStat(region, world.random) x mobBuffStacks(elite) x m stacks, through grantStacks;
//       4. the mob's weapon dropped as a loose weapon at its feet (loot.ts dropWeapon), unless the killer already holds
//          that weapon type in either slot;
//       5. onKill (buffs.ts): the kill combos.
//   - System `reapMobs`: a corpse older than MOB_CORPSE_MS leaves the state and world.mobs; an idle or returning mob below
//     full hp heals back to full in MOB_REGEN_SECONDS (a fighting mob does not heal).
//   - On `teleported` every regional mob drops its fight (mobAI.resetMob), because everyone alive just left the map.
import { MOB_REPATH_MS, mobFaction, mobName, mobWeapon, type FactionId, type Vec2 } from "@raid/shared";
import type { Combatant } from "./combatant";
import { newBrain } from "./mobAI";
import { addMob } from "./mobs";
import type { LedgerEntry, World } from "./world";

export type MobCombatant = Extract<Combatant, { kind: "mob" }>;

/**
 * Adds one regional mob of `region` resting at `at`: state (kind, name, faction, weapon, hp from mobFaction) and runtime
 * (a fresh MobBrain). The camp spawner and the tests both go through this. Returns its id.
 */
export function placeMob(world: World, o: { region: FactionId; elite: boolean; at: Vec2; facing?: number }): string {
  const id = addMob(world, {
    kind: o.elite ? "elite" : "mob", name: mobName(o.region, o.elite), at: o.at, facing: o.facing, hp: mobFaction(o.region, o.elite).hp,
    faction: o.region, weapon: mobWeapon(o.region),
  });
  world.mobs.get(id)!.brain = newBrain(o.region, o.elite, o.at, o.facing ?? 0, (world.idCounter * 137) % MOB_REPATH_MS);
  return id;
}

/** Places every camp's mobs. A no-op for a map without camps (a hand-built test map). */
export function spawnRegionalMobs(_world: World): void {}

/** The ledger's way down for a regional mob; returns the hp removed. */
export function hurtMob(_world: World, _c: MobCombatant, _amounts: readonly number[], _entries: readonly LedgerEntry[]): number {
  return 0;
}

export function install(_world: World): void {}

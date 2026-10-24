// The regional mob catalog (GAME_DESIGN 11): what a mob of each region is. Pure and shared, so the sim, the client
// (names, health bars) and the tests agree. A mob fights as its region's faction scaled down (scaledFaction), with the
// region's weapon, through the same combat code as a player; the sim paces it (DUEL_PACE) like any faction.
import { ELITE_K, ELITE_BUFF_STACKS, MOB_BUFF_STACKS, MOB_K } from "./constants";
import { FACTIONS, scaledFaction, type FactionId, type FactionSpec } from "./factions";
import { REGION_WEAPONS } from "./map";
import type { WeaponId } from "./weapons";

/** What state.mobs[id].kind says. "dummy" is Phase 9's training dummy; the other two are regional mobs. */
export type MobKind = "dummy" | "mob" | "elite";

export function isRegionalKind(kind: string): kind is "mob" | "elite" {
  return kind === "mob" || kind === "elite";
}

/**
 * The faction a regional mob fights as (before DUEL_PACE): its region's faction scaled by MOB_K, an elite's by ELITE_K.
 * `k` overrides the scale (balance sweeps); the game never passes it.
 */
export function mobFaction(region: FactionId, elite: boolean, k: number = elite ? ELITE_K : MOB_K): FactionSpec {
  return scaledFaction(FACTIONS[region], k);
}

/** The weapon every mob of the region carries. */
export function mobWeapon(region: FactionId): WeaponId {
  return REGION_WEAPONS[region];
}

/** Buff stacks the mob drops before the reward curve. */
export function mobBuffStacks(elite: boolean): number {
  return elite ? ELITE_BUFF_STACKS : MOB_BUFF_STACKS;
}

const NAMES: Readonly<Record<FactionId, readonly [string, string]>> = {
  fire: ["Cinderling", "Ember Warlord"],
  sentenced: ["Convict", "Warden"],
  plague: ["Plaguerat", "Rat King"],
  frost: ["Rimeguard", "Ice Colossus"],
  holy: ["Blood Imp", "Demon Herald"],
};

export function mobName(region: FactionId, elite: boolean): string {
  return NAMES[region][elite ? 1 : 0];
}

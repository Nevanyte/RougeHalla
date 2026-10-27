// The regional mob catalog (GAME_DESIGN 11): what a mob of each region is. Pure and shared, so the sim, the client
// (names, health bars) and the tests agree. A mob fights as its region's faction scaled down (scaledFaction), with the
// region's weapon, through the same combat code as a player; the sim paces it (DUEL_PACE) like any faction.
import { ELITE_K, ELITE_BUFF_STACKS, MOB_BUFF_STACKS, MOB_K, MOB_LEASH_CAP, MOB_LEASH_RADIUS } from "./constants";
import { FACTIONS, scaledFaction, type FactionId, type FactionSpec } from "./factions";
import { REGION_WEAPONS, worldToTile, type GameMap } from "./map";
import type { Vec2 } from "./messages";
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

// --- The roster (ROGUELIKE_PLAN 3.4): 20 mob types ---------------------------------------------------------------------
// Every type of a zone fights as its zone's faction with the zone's weapon (REGION_WEAPONS), scaled by MOB_K / ELITE_K
// like any regional mob: types of one zone differ only by skin and by the buff they drop (shared/buffs.ts). Camps are
// mono-type (shared/rosters.ts, server sim/camps.ts); a mob's name comes from here, `mobName` above is the fallback for
// a mob placed without a type.

export type MobTypeId =
  | "emberImp" | "cinderHound" | "magmaBrute" | "wyrmling"
  | "bailiff" | "chainWarden" | "inquisitor" | "executioner"
  | "plagueRat" | "bloatfly" | "rotMonk" | "ratOgre"
  | "frostWisp" | "iceGolem" | "rimeStalker" | "glacialWarden"
  | "acolyte" | "seraphShard" | "penitent" | "bloodSaint";

export interface MobTypeDef {
  id: MobTypeId;
  zone: FactionId;
  /** Exactly one elite TYPE per zone, the last of its four rows (the zone has two elite camps, each with one of this type). */
  elite: boolean;
  /** Display name. */
  name: string;
}

/** Zone order (REGION_FACTIONS), then the three normal types, then the elite. */
export const MOB_TYPES: readonly MobTypeDef[] = [
  { id: "emberImp", zone: "fire", elite: false, name: "Ember Imp" },
  { id: "cinderHound", zone: "fire", elite: false, name: "Cinder Hound" },
  { id: "magmaBrute", zone: "fire", elite: false, name: "Magma Brute" },
  { id: "wyrmling", zone: "fire", elite: true, name: "Wyrmling" },
  { id: "bailiff", zone: "sentenced", elite: false, name: "Bailiff" },
  { id: "chainWarden", zone: "sentenced", elite: false, name: "Chain Warden" },
  { id: "inquisitor", zone: "sentenced", elite: false, name: "Inquisitor" },
  { id: "executioner", zone: "sentenced", elite: true, name: "Executioner" },
  { id: "plagueRat", zone: "plague", elite: false, name: "Plague Rat" },
  { id: "bloatfly", zone: "plague", elite: false, name: "Bloatfly" },
  { id: "rotMonk", zone: "plague", elite: false, name: "Rot Monk" },
  { id: "ratOgre", zone: "plague", elite: true, name: "Rat Ogre" },
  { id: "frostWisp", zone: "frost", elite: false, name: "Frost Wisp" },
  { id: "iceGolem", zone: "frost", elite: false, name: "Ice Golem" },
  { id: "rimeStalker", zone: "frost", elite: false, name: "Rime Stalker" },
  { id: "glacialWarden", zone: "frost", elite: true, name: "Glacial Warden" },
  { id: "acolyte", zone: "holy", elite: false, name: "Acolyte" },
  { id: "seraphShard", zone: "holy", elite: false, name: "Seraph Shard" },
  { id: "penitent", zone: "holy", elite: false, name: "Penitent" },
  { id: "bloodSaint", zone: "holy", elite: true, name: "Blood Saint" },
];

const MOB_TYPE_BY_ID: ReadonlyMap<string, MobTypeDef> = new Map(MOB_TYPES.map((t) => [t.id, t]));

/** The zone's four types: the three normals, then the elite. */
export function mobTypesOf(zone: FactionId): MobTypeDef[] {
  return MOB_TYPES.filter((t) => t.zone === zone);
}

/** The zone's three normal types. */
export function normalTypesOf(zone: FactionId): MobTypeDef[] {
  return MOB_TYPES.filter((t) => t.zone === zone && !t.elite);
}

/** The zone's elite type. */
export function eliteTypeOf(zone: FactionId): MobTypeDef {
  return MOB_TYPES.find((t) => t.zone === zone && t.elite)!;
}

/** Undefined for an id that is not in the table. */
export function mobTypeById(id: string): MobTypeDef | undefined {
  return MOB_TYPE_BY_ID.get(id);
}

/** The camp (MobState.camp: its index in `map.camps` + 1, 0 = none) whose territory covers world point `p`, else 0. */
export function territoryAt(map: GameMap, p: Vec2): number {
  const tx = worldToTile(p.x);
  const ty = worldToTile(p.y);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return 0;
  return map.territoryGrid[ty * map.w + tx]!;
}

/**
 * The reach of a territory leash (ROGUELIKE_PLAN D15) of a mob of camp `campRef` (MobState.camp: index in `map.camps` + 1)
 * resting at `home`: min(camp.radius, MOB_LEASH_CAP) in world units, or 0 when it has none. Territory leashes need a camp
 * that exists, has territory (`area`) and holds the mob's own spot; anything else (no camp, a hand-built map whose
 * `territoryGrid` is all zero, a mob a test put outside its camp) keeps the circle of MOB_LEASH_RADIUS.
 */
export function territoryLeash(map: GameMap, campRef: number, home: Vec2): number {
  if (!(campRef >= 1)) return 0;
  const camp = map.camps[campRef - 1];
  if (camp === undefined || !(camp.area > 0) || territoryAt(map, home) !== campRef) return 0;
  return Math.min(camp.radius, MOB_LEASH_CAP);
}

/**
 * Is `p` inside the leash of a mob of camp `campRef` resting at `home`? With a territory leash: on a cell of the camp's
 * territory and within territoryLeash of `home`. Without one: within MOB_LEASH_RADIUS of `home`. `margin` shrinks it: every
 * point `margin` away along an axis must be inside too (a ranged mob's retreat stays this far from the edge).
 */
export function leashOk(map: GameMap, campRef: number, home: Vec2, p: Vec2, margin = 0): boolean {
  const reach = territoryLeash(map, campRef, home);
  if (reach === 0) return Math.hypot(p.x - home.x, p.y - home.y) <= MOB_LEASH_RADIUS - margin;
  if (Math.hypot(p.x - home.x, p.y - home.y) > reach - margin || territoryAt(map, p) !== campRef) return false;
  if (margin <= 0) return true;
  return territoryAt(map, { x: p.x + margin, y: p.y }) === campRef && territoryAt(map, { x: p.x - margin, y: p.y }) === campRef
    && territoryAt(map, { x: p.x, y: p.y + margin }) === campRef && territoryAt(map, { x: p.x, y: p.y - margin }) === campRef;
}

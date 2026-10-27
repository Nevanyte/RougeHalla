// The regional mob catalog (GAME_DESIGN 11): what a mob of each region is. Pure and shared, so the sim, the client
// (names, role marks, health bars) and the tests agree. A mob fights as its region's faction scaled down (scaledFaction), then by its
// type's role (hp, damage, speed), with its type's weapon (the region's default for a mob without a type), through the same combat
// code as a player; the sim paces it (DUEL_PACE) like any faction.
import { ELITE_K, MOB_K, MOB_LEASH_CAP, MOB_LEASH_RADIUS } from "./constants";
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
 *
 * A signature's `execute` is scaled by k once more (k squared overall, balance contract 6.1): its bonus damage per unit
 * of the target's missing hp reads the PLAYER's hp fraction, and a player's pool is full-scale, so scaling it by k alone
 * (as every point-damage number is, because the mob's own hp and hit shrank with it) left it 4-5x too strong: a Plague
 * mob killed a 25%-hp player in 0.9-3.6 s, where any other zone took 5-120 s (bench/mobExecute.ts, acceptance A13).
 * At k = 1 (a player-sized faction, the parity tests) nothing changes.
 */
export function mobFaction(region: FactionId, elite: boolean, k: number = elite ? ELITE_K : MOB_K): FactionSpec {
  const scaled = scaledFaction(FACTIONS[region], k);
  const execute = scaled.params.execute;
  return execute === undefined ? scaled : { ...scaled, params: { ...scaled.params, execute: execute * k } };
}

/** The weapon a mob of the region carries when it has no type of its own (REGION_WEAPONS): the default every type's weapon falls back to. */
export function mobWeapon(region: FactionId): WeaponId {
  return REGION_WEAPONS[region];
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

// --- The roster (balance contract 6.3): 30 mob types --------------------------------------------------------------------
// Six types per zone: four normals and two elites. A type fights as its zone's faction scaled by MOB_K / ELITE_K like any
// regional mob, then by its ROLE (grunt, swarm, brute, skirmisher, caster: hp, damage and move-speed multipliers), and carries
// its own weapon (casters shoot, so mobAI plays them as ranged fighters through the weapon's policy, and the weapon is what
// a kill drops or arms). A kill pays GV and that weapon, never a stat. Camps are mono-type (shared/rosters.ts, server
// sim/camps.ts); a mob's name comes from here, `mobName` above is the fallback for a mob placed without a type.

export type MobTypeId =
  | "emberImp" | "cinderHound" | "magmaBrute" | "flameCaller" | "wyrmling" | "ashDrake"
  | "bailiff" | "chainWarden" | "inquisitor" | "pardoner" | "executioner" | "gaoler"
  | "plagueRat" | "bloatfly" | "rotMonk" | "miasmaWitch" | "ratOgre" | "poxBehemoth"
  | "frostWisp" | "iceGolem" | "rimeStalker" | "frostbowSentry" | "glacialWarden" | "avalancheTroll"
  | "acolyte" | "seraphShard" | "penitent" | "zealot" | "bloodSaint" | "archon";

/** What a type does in a fight. The multipliers are on top of the zone faction x k (see mobTypeFaction). */
export type MobRole = "grunt" | "swarm" | "brute" | "skirmisher" | "caster";

/** Behaviour tags for the bots' and the planning screen's reading of a role (data only: the sim reads the multipliers). */
export type MobTag = "fast" | "fragile" | "tanky" | "chases" | "ranged";

export interface MobRoleDef {
  id: MobRole;
  /** Shown on the camp info and the mob's label. */
  label: string;
  hpMult: number;
  dmgMult: number;
  moveMult: number;
  tags: readonly MobTag[];
  /** One line for the planning screen's tooltip. */
  blurb: string;
}

/**
 * The role table (balance contract 6.3; provisional numbers, tuned against bench/campDuel.ts --types). The hp and damage
 * multipliers scale the whole faction sheet of the mob (hp; hit and every point-damage signature number), so a swarm
 * mob is both fragile and weak-hitting, a brute tanky and slow-hitting; moveMult is a world.moveModifiers entry of the sim
 * (sim/mobLife.ts). Roles change nothing else: the AI inputs are the weapon policy's, so a caster is ranged because its
 * weapon is, and a skirmisher chases because it is faster than the player's walk.
 */
export const MOB_ROLE_DEFS: Readonly<Record<MobRole, MobRoleDef>> = {
  grunt: { id: "grunt", label: "Grunt", hpMult: 1, dmgMult: 1, moveMult: 1, tags: [], blurb: "Plain fighter." },
  swarm: { id: "swarm", label: "Swarm", hpMult: 0.7, dmgMult: 0.9, moveMult: 1.1, tags: ["fast", "fragile"], blurb: "Fast and fragile." },
  brute: { id: "brute", label: "Brute", hpMult: 1.4, dmgMult: 0.8, moveMult: 0.9, tags: ["tanky"], blurb: "Slow and tough." },
  skirmisher: { id: "skirmisher", label: "Skirmisher", hpMult: 0.85, dmgMult: 1.1, moveMult: 1.15, tags: ["chases"], blurb: "Runs you down." },
  caster: { id: "caster", label: "Caster", hpMult: 0.75, dmgMult: 1.2, moveMult: 1, tags: ["ranged"], blurb: "Shoots from range." },
};

export const MOB_ROLES: readonly MobRole[] = ["grunt", "swarm", "brute", "skirmisher", "caster"];

export interface MobTypeDef {
  id: MobTypeId;
  zone: FactionId;
  /** Two elite types per zone, the last two of its six rows. */
  elite: boolean;
  /** Display name. */
  name: string;
  role: MobRole;
  /** The weapon every mob of the type carries (what a kill drops, and how the mob fights). */
  weapon: WeaponId;
  /** The role's multipliers, copied here so a consumer needs only the type. */
  hpMult: number;
  dmgMult: number;
  moveMult: number;
  tags: readonly MobTag[];
}

function row(id: MobTypeId, zone: FactionId, elite: boolean, name: string, role: MobRole, weapon: WeaponId): MobTypeDef {
  const r = MOB_ROLE_DEFS[role];
  return { id, zone, elite, name, role, weapon, hpMult: r.hpMult, dmgMult: r.dmgMult, moveMult: r.moveMult, tags: r.tags };
}

/** Zone order (REGION_FACTIONS), then the zone's four normal types, then its two elites. */
export const MOB_TYPES: readonly MobTypeDef[] = [
  row("emberImp", "fire", false, "Ember Imp", "swarm", "axe"),
  row("cinderHound", "fire", false, "Cinder Hound", "skirmisher", "axe"),
  row("magmaBrute", "fire", false, "Magma Brute", "brute", "axe"),
  row("flameCaller", "fire", false, "Flame Caller", "caster", "wand"),
  row("wyrmling", "fire", true, "Wyrmling", "grunt", "axe"),
  row("ashDrake", "fire", true, "Ash Drake", "caster", "wand"),
  row("bailiff", "sentenced", false, "Bailiff", "grunt", "sword"),
  row("chainWarden", "sentenced", false, "Chain Warden", "brute", "sword"),
  row("inquisitor", "sentenced", false, "Inquisitor", "skirmisher", "sword"),
  row("pardoner", "sentenced", false, "Pardoner", "caster", "bow"),
  row("executioner", "sentenced", true, "Executioner", "grunt", "sword"),
  row("gaoler", "sentenced", true, "Gaoler", "brute", "shield"),
  row("plagueRat", "plague", false, "Plague Rat", "swarm", "bow"),
  row("bloatfly", "plague", false, "Bloatfly", "skirmisher", "bow"),
  row("rotMonk", "plague", false, "Rot Monk", "grunt", "bow"),
  row("miasmaWitch", "plague", false, "Miasma Witch", "caster", "wand"),
  row("ratOgre", "plague", true, "Rat Ogre", "brute", "bow"),
  row("poxBehemoth", "plague", true, "Pox Behemoth", "brute", "axe"),
  row("frostWisp", "frost", false, "Frost Wisp", "swarm", "shield"),
  row("iceGolem", "frost", false, "Ice Golem", "brute", "shield"),
  row("rimeStalker", "frost", false, "Rime Stalker", "skirmisher", "shield"),
  row("frostbowSentry", "frost", false, "Frostbow Sentry", "caster", "bow"),
  row("glacialWarden", "frost", true, "Glacial Warden", "grunt", "shield"),
  row("avalancheTroll", "frost", true, "Avalanche Troll", "brute", "axe"),
  row("acolyte", "holy", false, "Acolyte", "grunt", "wand"),
  row("seraphShard", "holy", false, "Seraph Shard", "swarm", "wand"),
  row("penitent", "holy", false, "Penitent", "skirmisher", "wand"),
  row("zealot", "holy", false, "Zealot", "brute", "sword"),
  row("bloodSaint", "holy", true, "Blood Saint", "grunt", "wand"),
  row("archon", "holy", true, "Archon", "skirmisher", "sword"),
];

const MOB_TYPE_BY_ID: ReadonlyMap<string, MobTypeDef> = new Map(MOB_TYPES.map((t) => [t.id, t]));

/** The zone's six types: the four normals, then the two elites. */
export function mobTypesOf(zone: FactionId): MobTypeDef[] {
  return MOB_TYPES.filter((t) => t.zone === zone);
}

/** The zone's four normal types, in catalog order. */
export function normalTypesOf(zone: FactionId): MobTypeDef[] {
  return MOB_TYPES.filter((t) => t.zone === zone && !t.elite);
}

/** The zone's two elite types, in catalog order: the k-th elite camp of a zone holds the k-th (shared/rosters.ts). */
export function elitesOf(zone: FactionId): MobTypeDef[] {
  return MOB_TYPES.filter((t) => t.zone === zone && t.elite);
}

/** Undefined for an id that is not in the table. */
export function mobTypeById(id: string): MobTypeDef | undefined {
  return MOB_TYPE_BY_ID.get(id);
}

/** The type `id` names when it belongs to `region` (a mob placed with a type of another zone is just a mob of its region), else undefined. */
export function mobTypeIn(region: FactionId, id: string | undefined): MobTypeDef | undefined {
  const t = id === undefined ? undefined : MOB_TYPE_BY_ID.get(id);
  return t !== undefined && t.zone === region ? t : undefined;
}

/**
 * The faction a regional mob of `type` fights as (before DUEL_PACE): the zone's mobFaction (hp and damage x k) with the type's
 * role on top: hp x hpMult, and the hit and every point-damage number x dmgMult. A type that is missing or of another zone
 * gives the plain mobFaction (a grunt's numbers). `k` overrides the scale as in mobFaction.
 */
export function mobTypeFaction(region: FactionId, elite: boolean, type?: string, k: number = elite ? ELITE_K : MOB_K): FactionSpec {
  const base = mobFaction(region, elite, k);
  const t = mobTypeIn(region, type);
  if (t === undefined || (t.hpMult === 1 && t.dmgMult === 1)) return base;
  return { ...scaledFaction(base, t.dmgMult), hp: base.hp * t.hpMult };
}

/** The weapon a mob of `type` carries: the type's own, or the region's default for a mob without one. */
export function mobTypeWeapon(region: FactionId, type?: string): WeaponId {
  return mobTypeIn(region, type)?.weapon ?? mobWeapon(region);
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

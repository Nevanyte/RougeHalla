// What the planning screen says of a camp's mobs. This is the only client module that reads the mob roster for the planning screen,
// and it reads it defensively: a type id the catalog does not know (newer server content) is shown as its raw id, never an error.
// A camp tooltip explains the weapon drop, each normal mob's fixed stat reward and the elite augment chest.
import { MOB_ROLE_DEFS, WEAPONS, mobStatReward, mobTypeById, type MobTypeDef } from "@raid/shared";

/** One mob type as the planning screen reads it. */
export interface MobTypeInfo {
  id: string;
  /** The display name ("Ember Imp"), or the raw id for one this build does not know. */
  name: string;
  /** The role's label ("Swarm"), "" for a type this build does not know. */
  role: string;
  /** What the role means in a fight ("Fast and fragile."), "" for an unknown type. */
  blurb: string;
  /** The weapon every mob of the type carries and drops ("Axe"), "" for an unknown type. */
  weapon: string;
}

export interface CampTypeInfo extends MobTypeInfo {
  /** The camp's elite type, when it has one (an elite camp). */
  elite?: MobTypeInfo;
}

function typeInfo(id: string, def: MobTypeDef | undefined = mobTypeById(id)): MobTypeInfo {
  if (!def) return { id, name: id, role: "", blurb: "", weapon: "" };
  const role = MOB_ROLE_DEFS[def.role];
  return { id, name: def.name, role: role.label, blurb: role.blurb, weapon: WEAPONS[def.weapon].name };
}

/** The camp's mob type (RaidState.camps[i].type) and its elite (.elite, "" for none): null while the room does not say (empty or not synced yet). */
export function campTypeInfo(type: string | undefined, elite?: string): CampTypeInfo | null {
  if (!type) return null;
  return elite ? { ...typeInfo(type), elite: typeInfo(elite) } : typeInfo(type);
}

/**
 * The planning screen's sentence for a camp's mobs: "Ember Imp (Swarm: fast and fragile), drops an Axe" and, for an elite camp,
 * "Elite: Ash Drake (Caster: shoots from range), drops a Wand". A type this build does not know is just its id.
 */
export function campMobsText(info: CampTypeInfo): string {
  const one = (t: MobTypeInfo): string => {
    if (!t.role) return t.name;
    const blurb = t.blurb.replace(/\.$/, "").toLowerCase();
    return `${t.name} (${t.role}: ${blurb}), drops ${/^[aeiou]/i.test(t.weapon) ? "an" : "a"} ${t.weapon}`;
  };
  const normalReward = mobStatReward(info.id);
  const line = normalReward ? `Each normal kill grants ${normalReward.text}.` : "This elite gives no fixed per-kill stat.";
  const isEliteCamp = mobTypeById(info.id)?.elite === true;
  return info.elite
    ? `${one(info)}. ${line} Elite: ${one(info.elite)}. Elite death drops an augment chest; it grants no fixed mob stat.`
    : isEliteCamp
      ? `${one(info)}. Elite death drops an augment chest; it grants no fixed mob stat.`
      : `${one(info)}. ${line} No chest on a normal camp clear.`;
}

/** `RaidState.camps[i].type` for each of `count` camps, "" where the state has no camps (a server before them) or no type yet. */
export function readCampTypes(state: unknown, count: number): string[] {
  const camps = (state as { camps?: ArrayLike<{ type?: unknown }> | undefined } | null | undefined)?.camps;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = camps?.[i]?.type;
    out.push(typeof t === "string" ? t : "");
  }
  return out;
}

/** `RaidState.camps[i].elite` for each of `count` camps: "" for a camp without an elite, where the state has no camps (a server before them) or none yet. */
export function readCampElites(state: unknown, count: number): string[] {
  const camps = (state as { camps?: ArrayLike<{ elite?: unknown }> | undefined } | null | undefined)?.camps;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const e = camps?.[i]?.elite;
    out.push(typeof e === "string" ? e : "");
  }
  return out;
}

/** `RaidState.camps[i].state` for each of `count` camps (0 idle, 1 engaged, 2 cleared), 0 where the state has none. */
export function readCampStates(state: unknown, count: number): number[] {
  const camps = (state as { camps?: ArrayLike<{ state?: unknown }> | undefined } | null | undefined)?.camps;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const s = camps?.[i]?.state;
    out.push(s === 1 || s === 2 ? s : 0);
  }
  return out;
}

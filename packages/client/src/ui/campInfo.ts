// What the planning screen says of a camp's mobs and of the buffs that answer the factions in the room. This is the only
// client module that reads the mob roster and the buff catalog for the planning screen, and it reads them defensively: a type id the
// catalog does not know (newer server content) is shown as its raw id, never an error.
import {
  FACTIONS, buffText, buffsCountering, isFactionId, mobTypeById, type FactionId,
} from "@raid/shared";

export interface CampTypeInfo {
  /** The mob type's display name ("Ember Imp"), or the raw id for one this build does not know. */
  name: string;
  /** The buff its kills give, in words ("+5% damage"); "" when the catalog has none. */
  buff: string;
}

/** The camp's mob type (RaidState.camps[i].type): null while the room does not say (empty or not synced yet). */
export function campTypeInfo(type: string | undefined): CampTypeInfo | null {
  if (!type) return null;
  const def = mobTypeById(type);
  return { name: def?.name ?? type, buff: def ? buffText(type) : "" };
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

export interface CounterHint {
  faction: FactionId;
  buffs: { id: string; name: string; zone: FactionId }[];
}

/** For each faction present, up to `perFaction` buffs whose `counters` name it (the buff catalog is the source). Empty when none do. */
export function counterBuffs(present: readonly string[], perFaction = 3): CounterHint[] {
  const out: CounterHint[] = [];
  const seen = new Set<FactionId>();
  for (const f of present) {
    if (!isFactionId(f) || seen.has(f)) continue;
    seen.add(f);
    const buffs = buffsCountering(f).slice(0, perFaction).map((b) => ({ id: b.id, name: b.name, zone: b.zone }));
    if (buffs.length > 0) out.push({ faction: f, buffs });
  }
  return out;
}

/** One line per faction: "Against Demon Blood: Executioner (Sentenced), Rot Monk (Plague)". */
export function counterHintLines(hints: readonly CounterHint[]): string[] {
  return hints.map((h) => `Against ${FACTIONS[h.faction].displayName}: ${h.buffs.map((b) => `${b.name} (${FACTIONS[b.zone].displayName})`).join(", ")}`);
}

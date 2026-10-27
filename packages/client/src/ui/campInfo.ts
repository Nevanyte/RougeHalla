// What the planning screen says of a camp's mobs. This is the only client module that reads the mob roster for the planning screen,
// and it reads it defensively: a type id the catalog does not know (newer server content) is shown as its raw id, never an error.
import { mobTypeById } from "@raid/shared";

export interface CampTypeInfo {
  /** The mob type's display name ("Ember Imp"), or the raw id for one this build does not know. */
  name: string;
}

/** The camp's mob type (RaidState.camps[i].type): null while the room does not say (empty or not synced yet). */
export function campTypeInfo(type: string | undefined): CampTypeInfo | null {
  if (!type) return null;
  const def = mobTypeById(type);
  return { name: def?.name ?? type };
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

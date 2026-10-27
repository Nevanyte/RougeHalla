// How a mob's ROLE (shared mobs.ts MOB_ROLE_DEFS) shows on its disc: a small glyph or a heavier rim, so a camp can be read at a
// glance before a blow is struck (balance contract 6.3). Pure: MobView draws what this says. The zone colour, the name and the
// elite's star and gold ring stay as they were.
import { mobTypeById, type MobRole } from "@raid/shared";

/** What is drawn on the disc: three small dots, a chevron pointing the way it faces, or an inner ring. */
export type RoleGlyph = "dots" | "chevron" | "ring" | "none";

export interface RoleMark {
  role: MobRole;
  glyph: RoleGlyph;
  /** A heavier outline than the plain mob's, in px (0 = the usual one). */
  rim: number;
}

/** Brute: a thick rim. Wider than the elite's gold outline (3), so an elite brute reads as both. */
export const BRUTE_RIM = 5;

const MARKS: Readonly<Record<MobRole, RoleMark>> = {
  grunt: { role: "grunt", glyph: "none", rim: 0 },
  swarm: { role: "swarm", glyph: "dots", rim: 0 },
  brute: { role: "brute", glyph: "none", rim: BRUTE_RIM },
  skirmisher: { role: "skirmisher", glyph: "chevron", rim: 0 },
  caster: { role: "caster", glyph: "ring", rim: 0 },
};

/** The mark for a MobState.type: a grunt's (nothing) for "" and for an id this build does not know. */
export function roleMarkOf(type: string): RoleMark {
  const def = mobTypeById(type);
  return MARKS[def?.role ?? "grunt"];
}

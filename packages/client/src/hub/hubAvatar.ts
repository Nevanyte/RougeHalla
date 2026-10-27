// The hub avatar as a synced-state lookalike. PlayerView draws from a PlayerState; the hub has no room, so this builds a
// plain object with the fields PlayerView (and FighterArt, TrailView, SignatureArt through it) reads, from the loaded
// profile and the faction pick. Pure: the scene casts it to PlayerState at the one call site.
import { packLook, type FactionId, type ProfileDTO } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";

/** The PlayerState fields a drawn player depends on, and nothing else. */
export type HubAvatar = Pick<
  PlayerState,
  | "name" | "look" | "x" | "y" | "facing" | "hp" | "maxHp" | "status" | "faction" | "weapon0" | "weapon1" | "slot"
  | "drawStartedAt" | "readyAt" | "kills" | "gv" | "bounty" | "immuneUntil" | "sig" | "brand"
>;

/**
 * `profile`: the loaded one, or null (no cosmetics, no name). `faction`: the pick, or null for the neutral grey body with
 * nothing in hand. `now`: the clock the scene renders at, standing in for server time. `facing`: ground angle.
 */
export function hubAvatarState(profile: ProfileDTO | null, faction: FactionId | null, now: number, facing = 0): HubAvatar {
  return {
    name: profile?.name ?? "",
    // packLook drops anything not in the catalog, not in its slot or not owned, so a stale profile can't dress the avatar.
    look: profile ? packLook(profile.cosmetics.equipped, profile.cosmetics.owned) : 0,
    x: 0,
    y: 0,
    facing,
    // PlayerView always draws an hp bar; one of one keeps it full and green rather than empty.
    hp: 1,
    maxHp: 1,
    status: "alive",
    faction: faction ?? "",
    // A run starts with both slots empty: the avatar stands on fists (an empty hand is drawn as two fists once it has a faction).
    weapon0: "",
    weapon1: "",
    slot: 0,
    drawStartedAt: 0,
    readyAt: now,
    kills: 0,
    gv: 0,
    bounty: 0,
    immuneUntil: 0,
    sig: 0,
    brand: 0,
  };
}

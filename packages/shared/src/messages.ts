// Wire contracts. Client→server messages are inputs only; the server decides outcomes.

export interface Vec2 { x: number; y: number }

export type RaidPhase = "lobby" | "active" | "ended";
export type PlayerStatus = "lobby" | "alive" | "dead" | "extracted" | "mia";
export type ContainerKind = "crate" | "ground" | "body";

/** Client → server. Keys are the Colyseus message types. */
export interface ClientMessages {
  /** Walk to a world point (server pathfinds). */
  move: Vec2;
  stop: Record<string, never>;
  /**
   * Attack toward a world point with the best carried weapon. `t` is the server time the
   * client was rendering when it clicked; the server rewinds targets to it (clamped).
   */
  attack: Vec2 & { t?: number };
  take: { containerId: string; uid: string };
  drop: { uid: string };
  use: { uid: string };
  /** Begin extracting; must be inside an extract zone and stay put. */
  extract: Record<string, never>;
}
export type ClientMessageType = keyof ClientMessages;
export const CLIENT_MESSAGE_TYPES: readonly ClientMessageType[] =
  ["move", "stop", "attack", "take", "drop", "use", "extract"];

/** Visual-only events. The server stamps `t` (server time) so clients can play them in render time. */
export type FxEvent =
  | { kind: "shot"; by: string; x1: number; y1: number; x2: number; y2: number; hit: string | null; melee: boolean }
  | { kind: "death"; id: string; x: number; y: number; by: string | null }
  | { kind: "heal"; id: string; amount: number }
  | { kind: "extracted"; id: string };

export type RaidOutcome = "extracted" | "died" | "mia";

export interface ItemDTO { uid: string; def: string }

export interface RaidResult {
  outcome: RaidOutcome;
  profile: string;
  durationSec: number;
  kills: number;
  /** Display name of the killer, or "zone"/null. */
  killedBy: string | null;
  broughtIn: ItemDTO[];
  /** Items now in the stash because of this raid (empty unless extracted). */
  extracted: ItemDTO[];
  /** Items that were carried and are gone. */
  lost: ItemDTO[];
}

export type TimedFx = FxEvent & { t: number };

/** Server → client. */
export interface ServerMessages {
  fx: TimedFx;
  toast: { text: string };
  result: RaidResult;
}

/** Options for `client.joinOrCreate(ROOM_NAME, options)`. */
export interface JoinOptions {
  profile: string;
  /** Proof of ownership issued by GET /api/profile/:name when the profile was first claimed. */
  token: string;
  /** Stash item uids to bring into the raid (≤ INVENTORY_SLOTS). They leave the stash at join. */
  loadout: string[];
}

export interface ProfileStats { raids: number; extracts: number; deaths: number; kills: number }
export interface ProfileDTO { name: string; stash: ItemDTO[]; stats: ProfileStats }

/**
 * GET /api/profile/:name with header `x-profile-token` (omit it to claim a new name).
 * 200 → this body; 403 → the name belongs to someone else; 400 → invalid name.
 */
export interface ProfileResponse { profile: ProfileDTO; token: string; created: boolean }
export const PROFILE_TOKEN_HEADER = "x-profile-token";

export const PROFILE_RE = /^[A-Za-z0-9_-]{2,16}$/;

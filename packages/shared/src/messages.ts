// Wire contracts. Client→server messages are inputs only; the server decides outcomes.

export interface Vec2 { x: number; y: number }

export type RaidPhase = "lobby" | "active" | "ended";
/**
 * A lone survivor wins and stays "alive" (state.winner names them). A winner decided between players who went down in
 * the same last tick, and everyone in a draw, are "dead".
 */
export type PlayerStatus = "lobby" | "alive" | "dead" | "mia";
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
}
export type ClientMessageType = keyof ClientMessages;
export const CLIENT_MESSAGE_TYPES: readonly ClientMessageType[] = ["move", "stop", "attack", "take", "drop", "use"];

/** Visual-only events. The server stamps `t` (server time) so clients can play them in render time. */
export type FxEvent =
  | { kind: "shot"; by: string; x1: number; y1: number; x2: number; y2: number; hit: string | null; melee: boolean }
  /** `by` is the killer's session id, or null (sudden death). A player who leaves (MIA) gets no death fx. */
  | { kind: "death"; id: string; x: number; y: number; by: string | null }
  | { kind: "heal"; id: string; amount: number }
  /** Everyone alive was moved into the coliseum this tick and the gates locked. */
  | { kind: "teleport" }
  /** A player's bounty rose (first above 0, then on every increase): "<name> is on a rampage — bounty N GV". */
  | { kind: "bounty"; id: string; name: string; bounty: number }
  /** The run is over. `id`/`name` are the winner's; both null with `draw` for a draw, and without it when nobody won (a solo run, or everyone left). */
  | { kind: "victory"; id: string | null; name: string | null; draw: boolean };

/** How one player's run ended. `won` and `draw` only happen in a contested run (two or more starters). */
export type RunOutcome = "won" | "draw" | "died" | "mia";

/** Why GV was credited during a run (a `gv` event). The win bonus is not one: it is decided when the run resolves. */
export type GvReason = "kill" | "mob" | "elite" | "bounty";

/** GV a run paid out. `bounty` is from killing bountied players. `total` is what was banked: kills + mobs + bounty + win. */
export interface GvBreakdown { kills: number; mobs: number; bounty: number; win: number; total: number }

export interface ItemDTO { uid: string; def: string }

/** Sent once per player when their run resolves; by then its GV is banked. */
export interface RunResult {
  outcome: RunOutcome;
  profile: string;
  durationSec: number;
  kills: number;
  /** Display name of the killer, SUDDEN_DEATH_KILLER, or null (left the run, won, or drew). */
  killedBy: string | null;
  /** 1 for the winner (players in a draw share 1). Players going down in the same tick share a place. */
  place: number;
  /** How many players started the run. */
  players: number;
  gv: GvBreakdown;
}

export const SUDDEN_DEATH_KILLER = "sudden death";

export type TimedFx = FxEvent & { t: number };

/** Server → client. */
export interface ServerMessages {
  fx: TimedFx;
  toast: { text: string };
  result: RunResult;
}

/** Options for `client.joinOrCreate(ROOM_NAME, options)`. Run gear is handed out by the server: nothing is brought in. */
export interface JoinOptions {
  profile: string;
  /** Proof of ownership issued by GET /api/profile/:name when the profile was first claimed. */
  token: string;
}

/** `deaths` counts died and mia; `runs` counts every resolved run, including the ones won or drawn. */
export interface ProfileStats { runs: number; wins: number; draws: number; deaths: number; kills: number }

/** Placeholder until the shop exists: cosmetic ids owned, and the id equipped per slot. */
export interface CosmeticsDTO { owned: string[]; equipped: Record<string, string> }

export interface ProfileDTO {
  name: string;
  /** Spendable GV. */
  gv: number;
  /** Every GV ever banked; spending never lowers it. */
  gvLifetime: number;
  /** GV banked per UTC month (`monthKey`), for the monthly leaderboard. Months with nothing banked are absent. */
  gvByMonth: Record<string, number>;
  stats: ProfileStats;
  cosmetics: CosmeticsDTO;
}

/**
 * GET /api/profile/:name with header `x-profile-token` (omit it to claim a new name).
 * 200 → this body; 403 → the name belongs to someone else; 400 → invalid name.
 */
export interface ProfileResponse { profile: ProfileDTO; token: string; created: boolean }
export const PROFILE_TOKEN_HEADER = "x-profile-token";

export const PROFILE_RE = /^[A-Za-z0-9_-]{2,16}$/;

/** GET /api/leaderboard?month=YYYY-MM&limit=N (both optional: the current month, LEADERBOARD_DEFAULT_LIMIT). */
export interface LeaderboardEntry { name: string; gv: number }
export interface LeaderboardResponse { month: string; entries: LeaderboardEntry[] }
export const LEADERBOARD_DEFAULT_LIMIT = 20;
export const LEADERBOARD_MAX_LIMIT = 100;

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "YYYY-MM" of a timestamp, in UTC so every server and client agree on where a month ends. */
export function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

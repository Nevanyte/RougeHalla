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
  /**
   * True only for a winner whose win bonus was withheld: the run started with fewer than WIN_BONUS_MIN_PLAYERS, or
   * they damaged fewer than WIN_BONUS_MIN_OPPONENTS different players.
   */
  winBonusWithheld: boolean;
  /** Achievement ids this run unlocked, set by the Room when it banks the run. Absent when nothing unlocked. */
  achievements?: string[];
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

/** Cosmetic ids owned (see cosmetics.ts), and the id equipped per CosmeticSlot. */
export interface CosmeticsDTO { owned: string[]; equipped: Record<string, string> }

/** Counters beyond ProfileStats that achievements read. The server keeps them; they only ever grow. */
export interface ProfileProgress {
  /**
   * Wins that passed the anti alt-farming gate (RunResult.winBonusWithheld false: WIN_BONUS_MIN_PLAYERS starters and
   * WIN_BONUS_MIN_OPPONENTS opponents damaged). Win achievements and the per-faction / per-weapon counters count only
   * these, so a walkover against a throwaway callsign earns nothing; `ProfileStats.wins` still counts every win.
   */
  qualifiedWins: number;
  /** Runs in which the player claimed at least one bounty. */
  bountyRuns: number;
  /** Most kills in a single run. */
  bestRunKills: number;
  /** Qualified wins by the faction played, keyed by FactionId. */
  winsByFaction: Record<string, number>;
  /** Qualified wins by the weapon in hand when the run ended, keyed by weapon id. */
  winsByWeapon: Record<string, number>;
}

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
  /** Achievement id → server time (ms) it was unlocked. Ids the client doesn't know are ignored. */
  achievements: Record<string, number>;
  progress: ProfileProgress;
}

/**
 * GET /api/profile/:name with header `x-profile-token` (omit it to claim a new name).
 * 200 → this body; 403 → the name belongs to someone else; 400 → invalid name.
 */
export interface ProfileResponse { profile: ProfileDTO; token: string; created: boolean }
export const PROFILE_TOKEN_HEADER = "x-profile-token";

export const PROFILE_RE = /^[A-Za-z0-9_-]{2,16}$/;

/** The shop and wardrobe. Both need the profile's token header; both answer 200 with the updated profile. */
export const SHOP_PURCHASE_PATH = (name: string): string => `/api/profile/${encodeURIComponent(name)}/purchase`;
export const SHOP_EQUIP_PATH = (name: string): string => `/api/profile/${encodeURIComponent(name)}/equip`;

/** POST …/purchase. Spends the cosmetic's price from the GV balance. */
export interface PurchaseRequest { id: string }
/** POST …/equip. Puts the owned cosmetic `id` on in `slot`, or takes the slot off with `id: null`. */
export interface EquipRequest { slot: string; id: string | null }
export interface ShopResponse { profile: ProfileDTO }

/**
 * Why the shop refused, as `code` in the JSON error body (the HTTP status is in brackets).
 * forbidden (403): unknown profile or bad token. bad_request (400): malformed body. unknown_cosmetic (404),
 * unknown_slot (400), not_for_sale (409), already_owned (409), insufficient_gv (402, with `need` and `have`),
 * not_owned (409), slot_mismatch (400).
 */
export type ShopErrorCode =
  | "forbidden" | "bad_request" | "unknown_cosmetic" | "unknown_slot" | "not_for_sale"
  | "already_owned" | "insufficient_gv" | "not_owned" | "slot_mismatch";
export interface ShopError { error: string; code: ShopErrorCode; need?: number; have?: number }

/**
 * GET /api/leaderboard?month=YYYY-MM&limit=N&name=callsign (all optional: the current month, LEADERBOARD_DEFAULT_LIMIT,
 * no `you`). `title` is the cosmetic id of the equipped title, left out when there is none.
 */
export interface LeaderboardEntry { name: string; gv: number; title?: string }
export interface LeaderboardResponse {
  month: string;
  entries: LeaderboardEntry[];
  /** Months with any GV banked, newest first (at most LEADERBOARD_MAX_MONTHS). */
  months: string[];
  /**
   * The `name` asked about: 1-based position in `month`'s ranking, whatever the limit. Sent only when the request carries
   * that profile's own token header; absent without `name`, without a matching token, or without GV that month.
   */
  you?: { rank: number; gv: number };
}
export const LEADERBOARD_MAX_MONTHS = 24;
export const LEADERBOARD_DEFAULT_LIMIT = 20;
export const LEADERBOARD_MAX_LIMIT = 100;

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "YYYY-MM" of a timestamp, in UTC so every server and client agree on where a month ends. */
export function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Wire contracts. Client→server messages are inputs only; the server decides outcomes.
import type { BuffStat, ComboId } from "./buffs";
import type { ProjectileKind, WeaponId } from "./weapons";

export interface Vec2 { x: number; y: number }

export type RaidPhase = "lobby" | "active" | "ended";
/**
 * A lone survivor wins and stays "alive" (state.winner names them). A winner decided between players who went down in
 * the same last tick, and everyone in a draw, are "dead".
 */
export type PlayerStatus = "lobby" | "alive" | "dead" | "mia";
/**
 * A chest holds one weapon and stays (opened) once emptied; a ground weapon vanishes when taken; a body holds what a
 * fallen player carried.
 */
export type ContainerKind = "chest" | "ground" | "body";

/**
 * Client -> server. Keys are the Colyseus message types. Angles are radians on the ground plane, measured from where
 * the client draws its own player (its render-time position) to the cursor. `t` is the server time the client was
 * rendering when the input was made; melee rewinds to it (clamped to MAX_REWIND_MS).
 */
export interface ClientMessages {
  /** Walk to a world point (server pathfinds). */
  move: Vec2;
  stop: Record<string, never>;
  /** Where the cursor is: the shield faces it, held attacks aim at it. Streamed at no more than 20 Hz while it changes. */
  aim: { a: number };
  /**
   * Trigger pressed: attack with the weapon in hand toward `a` (bow: start drawing). Held, it keeps attacking whenever
   * the cooldown allows, until `release`. A press shortly before the cooldown ends still attacks when it does.
   */
  attack: { a: number; t?: number };
  /** Trigger released: the bow looses (once at least its minimum draw is reached); other weapons stop repeating. */
  release: { a: number; t?: number };
  /** Switch weapon slot: to `slot` (0 or 1), or to the other one when omitted. */
  swap: { slot?: number };
  /** Take a weapon from a chest, the ground or a body in reach (F). With both slots full, the one in hand is dropped. */
  pickup: { containerId: string };
}
export type ClientMessageType = keyof ClientMessages;
export const CLIENT_MESSAGE_TYPES: readonly ClientMessageType[] = ["move", "stop", "aim", "attack", "release", "swap", "pickup"];

/** Why a projectile stopped (a `projEnd` fx). */
export type ProjectileEnd =
  | "hit" | "wall" | "range"
  /** An arrow off a shield's front: a new arrow, owned by the holder, flies on from the same point. */
  | "reflected"
  /** An arrow a wand ball came too close to. */
  | "deleted"
  /** A ball an axe swing met. */
  | "destroyed"
  /** Removed by the arena (the coliseum teleport). */
  | "cleared";

/** Visual-only events. The server stamps `t` (server time) so clients can play them in render time. */
export type FxEvent =
  /**
   * A melee swing or wand cast began: it lands (or the ball leaves) `ms` later unless a stagger or a swap cancels it.
   * `a` is its direction. Bow draws are synced state instead (drawStartedAt).
   */
  | { kind: "windup"; by: string; weapon: WeaponId; a: number; ms: number }
  /** A melee swing landed now from (x, y), the attacker where its client drew it, toward `a`. */
  | { kind: "swing"; by: string; weapon: WeaponId; x: number; y: number; a: number }
  /** `id` took `amount` (after armor and shield). `by` is the attacker's id, or null for the arena. */
  | { kind: "hit"; id: string; by: string | null; amount: number; weapon: WeaponId | null }
  /** `id`'s shield negated a hit by `by`'s weapon (a sword hit also ripostes: a `hit` on `by` follows). */
  | { kind: "block"; id: string; by: string; weapon: WeaponId }
  /** `id` was staggered: its windup or cast was cancelled, or its bow draw restarted. */
  | { kind: "stagger"; id: string }
  /**
   * A projectile stopped at (x, y). It also says where and when it was loosed, so a client that never saw it in the
   * state (loosed and stopped within one patch) can still draw its flight.
   */
  | {
    kind: "projEnd"; id: string; proj: ProjectileKind; x0: number; y0: number; t0: number; x: number; y: number;
    reason: ProjectileEnd;
  }
  /** `by` is the killer's id, or null (sudden death). A player who leaves (MIA) gets no death fx. */
  | { kind: "death"; id: string; x: number; y: number; by: string | null }
  | { kind: "heal"; id: string; amount: number }
  /** Everyone alive was moved into the coliseum this tick and the gates locked. */
  | { kind: "teleport" }
  /** A player's bounty rose: "<name> is on a rampage — bounty N GV". At most one per player per BOUNTY_ANNOUNCE_MS; a rise held back goes out when the window ends. */
  | { kind: "bounty"; id: string; name: string; bounty: number }
  /** `id` gained buff stacks (a mob drop or a bounty): `stacks` of `stat`, and the new total. */
  | { kind: "buff"; id: string; stat: BuffStat; stacks: number; total: number }
  /** `id` reached a combo tier (`proc` false) or a kill set it off (`proc` true). */
  | { kind: "combo"; id: string; combo: ComboId; proc: boolean }
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
}

export const SUDDEN_DEATH_KILLER = "sudden death";

/** One fx event as it reaches the renderer: the event plus the server time it happened (`fxs` messages are decoded to these). */
export type TimedFx = FxEvent & { t: number };

/** One fx on the wire: `[kindCode, ...fields]`, numbers and strings only (see fxCodec.ts for the layout of each kind). */
export type FxTuple = Array<number | string | null>;
/**
 * Every fx one simulation step produced, in order, sharing the step's server time `t`. Built with `packFx` and read with
 * `unpackFx` (fxCodec.ts). Sent once per step that has any, just before the patch of that tick.
 */
export interface FxBatch { t: number; l: FxTuple[] }

/** Server → client. */
export interface ServerMessages {
  fxs: FxBatch;
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

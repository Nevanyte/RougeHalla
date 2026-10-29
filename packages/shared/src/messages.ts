// Wire contracts. Client→server messages are inputs only; the server decides outcomes.
import type { AbilityId, AbilitySlot, CastEndReason } from "./abilities";
import type { FactionId } from "./factions";
import type { SignatureKind } from "./signatures";
import type { StatusKind } from "./status";
import type { ProjectileKind, WeaponId } from "./weapons";

export interface Vec2 { x: number; y: number }

/**
 * "planning" (roguelike R3) sits between the lobby and the run when the server's planSeconds is above 0: the room is locked,
 * each player is dealt two spawns in a private `plan` message and picks one; nobody moves, fights or is hurt. It ends at
 * `RaidState.planEndsAt`, or as soon as every connected player is ready (`PlayerState.planReady`), and then the run starts.
 */
export type RaidPhase = "lobby" | "planning" | "active" | "ended";
/**
 * A lone survivor wins and stays "alive" (state.winner names them). A winner decided between players who went down in
 * the same last tick, and everyone in a draw, are "dead".
 */
export type PlayerStatus = "lobby" | "alive" | "dead" | "mia";
/**
 * A chest holds one weapon and stays (opened) once emptied; a ground weapon vanishes when taken; a body holds what a
 * fallen player carried. A "reward" (roguelike R5) is a cleared camp's shared skill chest: no items, its options in the
 * container's `options`/`takenBy`/`pickers`, taken with `choose` (never `pickup`), gone at `expiresAt`. A "quest"
 * container holds a quest token or parcel (shared/quests.ts): picking it up never changes the weapon slots.
 */
export type ContainerKind = "chest" | "ground" | "body" | "reward" | "quest";

/**
 * Client -> server. Keys are the Colyseus message types. Angles are radians on the ground plane, measured from where
 * the client draws its own player (its render-time position) to the cursor. `t` is the server time the client was
 * rendering when the input was made; melee rewinds to it (clamped to MAX_REWIND_MS).
 *
 * Orders replace each other: `move`, `stop`, `target` and `attack` each drop whatever order came before (a move or a stop
 * drops the lock and the held trigger; a `target` lets go of the trigger; an `attack` drops the lock). Within one tick
 * they apply in the order they arrived. The game client sends `move`, `stop`, `target`, `aim`, `swap`, `pickup` and `cast`;
 * `attack` and `release` are the low-level trigger that mobs, the duel harness and older bots still use.
 */
export interface ClientMessages {
  /**
   * Walk to a world point (server pathfinds). Drops the attack target, as a right-click does in LoL, and cancels an attack
   * the lock was winding up. `seq` (an integer 0..255, the client's own count) comes back in `PlayerState.moveSeq` on the
   * tick the order is applied; nothing else reads it.
   */
  move: Vec2 & { seq?: number };
  /** Attack-move toward a point: attack the nearest visible enemy entering weapon range, then resume this route. */
  attackMove: Vec2 & { seq?: number };
  /** Stand still: drops the path, the attack target and the held trigger, and cancels an attack the lock was winding up. `seq` as for `move`. */
  stop: { seq?: number };
  /**
   * Lock an enemy (a player or a mob, by its state key) and auto-attack it: the server walks into the weapon's range,
   * attacks whenever the cooldown allows, faces it (the shield too) and aims every attack at it, until another order, the
   * target going down or evading, leaving TARGET_RANGE, or staying out of line of sight for TARGET_LOS_GRACE_MS once it
   * has been seen. Ignored unless the target is a standing enemy within TARGET_RANGE; one behind a wall is locked and
   * walked to (nothing is attacked without a clear line). Locking a different fighter cancels an attack the old lock was
   * winding up (clicking the one already locked changes nothing).
   */
  target: { id: string };
  /** Where the cursor is: the shield faces it while nothing is locked. Streamed at no more than 20 Hz while it changes. */
  aim: { a: number };
  /**
   * Trigger pressed: attack with the weapon in hand toward `a`. Held, it keeps attacking whenever the cooldown allows,
   * until `release`. A press shortly before the cooldown ends still attacks when it does.
   */
  attack: { a: number; t?: number };
  /** Trigger released: the attacks stop repeating (one already winding up still lands). */
  release: { a: number; t?: number };
  /** Switch weapon slot: to `slot` (0 or 1), or to the other one when omitted. The lock stays. */
  swap: { slot?: number };
  /** Take a weapon from a chest, the ground or a body in reach (F). With both slots full, the one in hand is dropped. */
  pickup: { containerId: string };
  /**
   * The planning screen (phase "planning" only; dropped in any other phase). `spawn` and `boon` are indexes into the two
   * options of the player's own private `plan` message (0 or 1, nothing else); at least one field must be there. The
   * first player to pick a spawn holds it, and everyone else who was dealt it is told it is taken. Picking the other option
   * lets go of the first. `ready: true` latches (false changes nothing) and freezes the picks; the run starts early once
   * every connected player is ready.
   */
  plan: { spawn?: 0 | 1; boon?: 0 | 1; ready?: boolean };
  /**
   * Cast the ability in `slot` ("wish" = the faction's Wish, key D; "q"/"e" arrive with skills). (x, y): the cursor's ground
   * point (clamped like `move`; the point or direction, ignored by self casts). `id`: a unit target. `t`: render time (clamped;
   * unused until skills rewind). `seq`: as for `move`, echoed in moveSeq (sent with a blink). Refused silently, at no cost,
   * unless ready, standing, not stunned/silenced (or rooted, for some), not already casting, and the target is valid.
   */
  cast: { slot: AbilitySlot; x: number; y: number; id?: string; t?: number; seq?: number };
  /**
   * A cleared camp's shared chest (roguelike R5; a container of kind "reward"): take option `pick` (an index into its
   * `options`), or skip it with -1. One pick per player per chest, a skip included; first come first served (within a tick,
   * the server's shuffled order decides). Refused, with a toast and no pick used, when the picker is not standing, is
   * farther than CHEST_RANGE from the chest (the SERVER's position) or has no line of sight to it, has already picked here,
   * the chest is gone or expired, the option is taken, or it is a skill the picker holds at its top rank. `replace` is
   * reserved for R6's skill slots: parsed, accepted, and ignored until then.
   */
  choose: { chest: string; pick: number; replace?: 0 | 1 };
  /**
   * Accept a public quest offer at its giver (F next to the giver opens the dialog; shared/quests.ts). Only an accepted offer
   * counts for the player: kills, tokens, the parcel and the turn-in all read it. An action like `pickup`: refused, with a toast
   * and no change, when the run is not active, the player is not standing or is stunned or casting, the offer is not public and
   * open, the player's SERVER position is farther than QUEST_ACCEPT_RANGE from the giver or has no line of sight to it, or it
   * is already accepted. Dropped silently for a fill bot. Not accepted in a training room (it has no quests).
   */
  questAccept: { quest: string };
  /**
   * The training room's practice console (shared/training.ts, server sim/training.ts). Dropped (and not counted as presence)
   * unless the room is a training room, so an arena client can never use it. Nothing it does is recorded or paid.
   */
  train: TrainMessage;
}

/**
 * Practice commands: `stat` sets a normal type's progress to a non-negative safe-integer count (default 1); `card` sets an
 * interactive augment to owned or removed, with unique cards held once. `camp` spawns practice mobs; those kills pay
 * no progression. `chest` offers chosen live interactive augments or rolls up to three when options are absent.
 * `clear` removes cards, mob stat stacks, practice mobs and reward chests. All commands are training-only.
 */
export type TrainMessage =
  | { cmd: "card"; id: string; count?: number }
  | { cmd: "stat"; id: string; count?: number }
  | { cmd: "camp"; id: string }
  | { cmd: "chest"; options?: string[] }
  | { cmd: "clear" };

export type ClientMessageType = keyof ClientMessages;
export const CLIENT_MESSAGE_TYPES: readonly ClientMessageType[] = [
  "move", "stop", "target", "aim", "attack", "release", "swap", "pickup", "plan", "cast", "choose", "train", "questAccept", "attackMove",
];

/** Why a projectile stopped (a `projEnd` fx). */
export type ProjectileEnd =
  | "hit" | "wall" | "range"
  /** An arrow off a shield's front: a new arrow, owned by the holder, flies on from the same point. */
  | "reflected"
  /** An arrow already reflected MAX_ARROW_REFLECTIONS times, stopped by another shield's front (no damage). */
  | "blocked"
  /** An arrow a wand ball came too close to. */
  | "deleted"
  /** A ball an axe swing met. */
  | "destroyed"
  /** Removed by the arena (the coliseum teleport). */
  | "cleared";

/** Visual-only events. The server stamps `t` (server time) so clients can play them in render time. */
export type FxEvent =
  /**
   * A melee swing or wand cast began: it lands (or the ball leaves) `ms` later unless a stagger, a swap or a `cancel` ends it.
   * `a` is its direction (an attack on a locked target is aimed again when it lands). Bow draws are synced state instead
   * (drawStartedAt).
   */
  | { kind: "windup"; by: string; weapon: WeaponId; a: number; ms: number }
  /** A melee swing landed now from (x, y), the attacker where its client drew it, toward `a`. */
  | { kind: "swing"; by: string; weapon: WeaponId; x: number; y: number; a: number }
  /**
   * `id` took `amount` (after armor and shield). `by` is the attacker's id, or null for the arena. `sig`: signature
   * damage, either Fire's backlash on one swing of `id`, or DOT_FX_MS worth of damage over time (burn, disease, mark).
   * `ability`: the ability that dealt it (weapon null); a dot ability's hits come in chunks like a signature's. A hit with no
   * weapon, signature or ability is a bleed (a card's damage over time), also in chunks. `crit`: a critical strike (1.5x).
   */
  | { kind: "hit"; id: string; by: string | null; amount: number; weapon: WeaponId | null; sig?: SignatureKind; ability?: AbilityId; crit?: true }
  /**
   * `id`'s shield negated a hit by `by`'s weapon (a sword hit also ripostes: a `hit` on `by` follows). `passive`: the
   * blocked hit was not an attack of `by`'s own (an arrow `by` reflected).
   */
  | { kind: "block"; id: string; by: string; weapon: WeaponId; passive?: boolean }
  /** `id` was staggered: its windup or cast was cancelled (a bow draw is not interrupted). */
  | { kind: "stagger"; id: string }
  /** `id`'s own order (a move, a stop, or locking someone else) cancelled the attack its lock was winding up: no swing, ball or arrow, and its cooldown is refunded. Drop its telegraph. */
  | { kind: "cancel"; id: string }
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
  /** `id` healed `amount` (Holy's lifesteal: one per tick in which its hits landed). */
  | { kind: "heal"; id: string; amount: number }
  /** Everyone alive was moved into the coliseum this tick and the gates locked. */
  | { kind: "teleport" }
  /** A player's bounty rose: "<name> is on a rampage — bounty N GV". At most one per player per BOUNTY_ANNOUNCE_MS; a rise held back goes out when the window ends. */
  | { kind: "bounty"; id: string; name: string; bounty: number }
  // "buff" (wire code 10) is retired with the per-kill buffs (balance pass 3.6) and "combo" (code 11) with the kill combos (R4a):
  // never emitted, their codes never reused.
  /** The run is over. `id`/`name` are the winner's; both null with `draw` for a draw, and without it when nobody won (a solo run, or everyone left). */
  | { kind: "victory"; id: string | null; name: string | null; draw: boolean }
  /**
   * `by` began casting `ability`. Its telegraph and root last `ms` and it lands at the batch's `t + ms`; a client draws it
   * against the server clock. (x, y): the target, the point, or the caster.
   */
  | { kind: "cast"; by: string; ability: AbilityId; ms: number; target: string | null; x: number; y: number }
  /** The cast took effect. (x, y): the target or the caster, or a blink's origin with (x2, y2) its landing. */
  | { kind: "castLand"; by: string; ability: AbilityId; target: string | null; x: number; y: number; x2?: number; y2?: number }
  /** A begun cast ended unlanded: it fizzled at its landing, a status interrupted it, or the arena cancelled it. */
  | { kind: "castEnd"; by: string; ability: AbilityId; reason: CastEndReason }
  /** A status instance was newly applied to `id` (not on a refresh or an expiry), lasting `ms` from the batch's `t`; `by` is its source. */
  | { kind: "status"; id: string; status: StatusKind; ms: number; by: string | null }
  /** Camp `camp` (its index in map.camps and RaidState.camps) was cleared this tick: its shared chest drops at once. */
  | { kind: "campCleared"; camp: number }
  /** `by` made their pick at the reward container `chest`: option index `option` (into its `options`), or -1 for a skip. */
  | { kind: "chestTaken"; chest: string; by: string; option: number }
  /**
   * Clearing camp `camp` healed `id` by `amount` hp (balance contract 7: everyone who damaged it and stood at the clear).
   * `camp` is its index in map.camps; a training room's practice camp has none on the map, so the client draws the
   * number on the player and no ring (the index is then past map.camps).
   */
  | { kind: "campHeal"; id: string; camp: number; amount: number };

/** How one player's run ended. `won` and `draw` only happen in a contested run (two or more starters). */
export type RunOutcome = "won" | "draw" | "died" | "mia";

/** Why GV was credited during a run (a `gv` event). The win bonus is not one: it is decided when the run resolves. */
/** "skip": a chest skip that healed nothing (D12); it counts with the mob GV, under GV_MOB_CAP. Quest GV has its own cap. */
export type GvReason = "kill" | "mob" | "elite" | "bounty" | "skip" | "quest";

/**
 * GV a run paid out. `bounty` is from killing bountied players; `mobs` includes chest skips' GV (both under GV_MOB_CAP).
 * `quest` is capped separately at QUEST_GV_CAP. `total` is kills + mobs + bounty + quest + win.
 */
export interface GvBreakdown { kills: number; mobs: number; bounty: number; quest: number; win: number; total: number }

export interface ItemDTO { uid: string; def: string }

/** Why the results screen shows no win bonus: "starters" = fewer than WIN_BONUS_MIN_PLAYERS human starters, "opponents" = damaged fewer than WIN_BONUS_MIN_OPPONENTS different human players. */
export type WinBonusWhy = "starters" | "opponents";

/** Sent once per player when their run resolves; by then its GV is banked. */
export interface RunResult {
  outcome: RunOutcome;
  profile: string;
  durationSec: number;
  kills: number;
  /** Display name of the killer, SUDDEN_DEATH_KILLER, or null (left the run, won, or drew). */
  killedBy: string | null;
  /** True when that killer was a server-filled bot (the results screen marks it). Absent otherwise. */
  killedByBot?: true;
  /** 1 for the winner (players in a draw share 1). Players going down in the same tick share a place. */
  place: number;
  /** How many players started the run. */
  players: number;
  gv: GvBreakdown;
  /**
   * True only for a winner whose win bonus was withheld: the run started with fewer than WIN_BONUS_MIN_PLAYERS human
   * starters, or they damaged fewer than WIN_BONUS_MIN_OPPONENTS different human players (fill bots count for neither).
   */
  winBonusWithheld: boolean;
  /**
   * Why the bonus was withheld, for the results screen; present only with `winBonusWithheld`. The bonus counts humans only
   * (bots fill a lobby), so a player cannot tell from the state which rule held it back: "starters" is fewer than
   * WIN_BONUS_MIN_PLAYERS human starters, "opponents" is damage on fewer than WIN_BONUS_MIN_OPPONENTS other humans.
   */
  winBonusWhy?: WinBonusWhy;
  /** Achievement ids this run unlocked, set by the Room when it banks the run. Absent when nothing unlocked. */
  achievements?: string[];
}

export const SUDDEN_DEATH_KILLER = "sudden death";

/** One fx event as it reaches the renderer: the event plus the server time it happened (`fxs` messages are decoded to these). */
export type TimedFx = FxEvent & { t: number };

/** One fx on the wire: `[kindCode, ...fields]`, numbers and strings only (see fxCodec.ts for the layout of each kind). */
export type FxTuple = Array<number | string | null>;
/**
 * Every fx one simulation step produced, in order, sharing the step's server time `t`, and the projectiles it loosed. Built
 * with `packFx` and read with `unpackFx` and `unpackLaunches` (fxCodec.ts). Sent once per step that has either, just before
 * the patch of that tick. Players and mobs are named by their index in `RaidState.roster` where they can be.
 */
export interface FxBatch {
  t: number;
  l: FxTuple[];
  /**
   * The arrows and balls that left during this step and are still flying at its end, one tuple each (see fxCodec.ts;
   * `unpackLaunches` reads them). Projectiles are not in the synced state at all: this is how a connected client learns of
   * them, and a client that joins or reconnects mid-flight is sent the ones then flying as a batch of its own
   * (`FxChannel.inFlight`, `l` empty).
   */
  p?: FxTuple[];
  /** Target-lock metadata keyed by projectile id; absent on older batches and for directional shots. */
  h?: Array<[projectileId: string, targetId: string]>;
}

/**
 * A projectile as the client flies it: position(T) = (x, y) + (vx, vy) * (T - t) / 1000, for at most `range` units, until a
 * `projEnd` fx says where and why it stopped. `id` is the one that `projEnd` names. `t` is when it left (x, y).
 */
export interface ProjectileLaunch {
  id: string;
  kind: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  range: number;
  /** Present only for a unit-targeted auto-attack; the client may home while it can safely sample this fighter. */
  targetId?: string;
}

/**
 * One player's planning deal (roguelike R3), sent to that player only: when planning starts, again whenever anything in it
 * changes (an option of theirs taken or freed by someone else, their own pick), and on a reconnect during planning. Nothing
 * of it is in the synced state. The latest message replaces the earlier ones.
 */
export interface PlanMessage {
  /** Server time planning ends (the same as RaidState.planEndsAt; it can end sooner when everyone is ready). */
  endsAt: number;
  /**
   * The two spawns dealt, as indexes into `generateMap(seed).spawnPool`: both at about the same walking distance from the
   * coliseum centre (planning.ts `spawnWalks`) and in different zones where the pool allows. -1 only on a map with no spawn pool.
   */
  spawns: [number, number];
  /** That option is held by another player's pick (never set for the player's own pick). */
  taken: [boolean, boolean];
  /** The player's own spawn pick (an index into `spawns`), or -1 for none yet. */
  pick: -1 | 0 | 1;
  /** The start boons dealt (BoonId); empty until roguelike R7. */
  boons: string[];
  /** The player's own boon pick, or -1. */
  boon: -1 | 0 | 1;
}

/**
 * A hidden quest revealed to its finder only, QUEST_REVEAL_HEAD_START_MS before it appears in RaidState.quests.
 * Until this message the finder receives no quest id, def or position either; the public state carries only a count.
 */
export interface QuestRevealMessage {
  id: string;
  /** QuestDef id in shared/quests.ts. */
  def: string;
  x: number;
  y: number;
  /** Server time the offer lapses. */
  expiresAt: number;
}

/** Private reconnect snapshot of the recipient's live vision trail. Ward vision is derived from public camp state. */
export interface VisionSnapshotMessage {
  seed: number;
  w: number;
  h: number;
  at: number;
  /** Only unexpired trail cells: row-major tile index and its absolute server-time expiry. */
  cells: Array<[index: number, expiresAt: number]>;
}

/** Server → client. */
export interface ServerMessages {
  fxs: FxBatch;
  toast: { text: string };
  result: RunResult;
  /** Private: only the player it is dealt to receives it (see PlanMessage). */
  plan: PlanMessage;
  /** Private: only the finder receives the head-start reveal. */
  questReveal: QuestRevealMessage;
  /** Private reconnect snapshot of the recipient's trail. */
  vision: VisionSnapshotMessage;
}

/**
 * "arena" is the contested run (matchmade with `joinOrCreate`); "training" is a private room of one with practice dummies and
 * a rack of every weapon, created with `create`: no results, no GV, no stats (see sim/training.ts).
 */
export type RoomMode = "arena" | "training";

/** Options for `client.joinOrCreate(ROOM_NAME, options)`. Run gear is handed out by the server: nothing is brought in. */
export interface JoinOptions {
  profile: string;
  /** Proof of ownership issued by GET /api/profile/:name when the profile was first claimed. */
  token: string;
  /** The faction picked in the hub for this run; anything else (or nothing) gets the server default. */
  faction?: FactionId;
  /** Only `"training"` means anything: it asks `client.create` for a training room. Absent or anything else is an arena join. */
  mode?: RoomMode;
  /** The host's playtest passcode (PLAYTEST_PASSCODE), when the server has one set; ignored otherwise. */
  passcode?: string;
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
/** The playtest passcode on REST calls (claiming a new callsign needs it when the server has one set). */
export const PASSCODE_HEADER = "x-playtest-passcode";

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

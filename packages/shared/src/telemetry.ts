// Telemetry contract (docs/TELEMETRY.md). The versioned records one finished run produces, the constants both
// sides share, the dashboard API's response shapes and the pure helpers (Wilson intervals, duel outcome, packing).
// Types and pure code only: no Node or Worker APIs, no RNG. The server's recorder (sim/telemetry.ts) only counts
// on existing hooks and never changes an outcome; the record is assembled once, at run end, off the tick.
import type { AbilityId } from "./abilities";
import type { ChestBoostStat } from "./chestBoosts";
import type { FactionId } from "./factions";
import type { RegionId } from "./map";
import type { RunOutcome, WinBonusWhy } from "./messages";
import type { SignatureKind } from "./signatures";
import type { WeaponId } from "./weapons";

/** Bump on any breaking change to a record shape. Additive optional fields keep the version. */
export const TELEMETRY_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------------------------------------------
// Collection constants (the recorder's rules; docs/TELEMETRY.md sections 3 and 4).

/** Position, weapon-seconds, zone-seconds and farming are sampled once per run second. */
export const TELEMETRY_SAMPLE_MS = 1000;
/** Power snapshots at these run minutes (a player down by then has no snapshot for it). */
export const TELEMETRY_SNAPSHOT_MINUTES: readonly number[] = [1, 3, 5, 10];
/** A duel segment ends after this long with no contact between the pair. */
export const DUEL_GAP_MS = 8000;
/** A sampled second counts as farming when the player dealt or took mob damage within this window. */
export const FARM_CONTACT_MS = 3000;
/** A human with no accepted input for this long is counted as AFK until the next accepted input. */
export const AFK_IDLE_MS = 30_000;
/** A player is flagged `afk` when AFK time reaches this share of their time alive (or AFK_FLAG_MIN_MS). */
export const AFK_FLAG_SHARE = 0.25;
export const AFK_FLAG_MIN_MS = 60_000;

/** Per-run caps: memory stays bounded whatever a run does; what a cap drops is counted in `truncated`. */
export const TELEMETRY_MAX_DUELS = 256;
export const TELEMETRY_MAX_OFFERS = 256;
export const TELEMETRY_MAX_CAMP_CLEARS = 256;
/** 30 minutes of 1 Hz tiles; later seconds are not sampled. */
export const TELEMETRY_MAX_SAMPLES = 1800;
/** Augment ids kept per duel side (the build's titled cards; base cards are summarised by cardPower). */
export const TELEMETRY_MAX_DUEL_CARDS = 16;
/** One serialized RunRecord (uncompressed JSON). A record over this is sent without `tiles`, then dropped. */
export const TELEMETRY_RECORD_MAX_BYTES = 512 * 1024;
/** A tile byte pair meaning "not standing this second" (not yet started, down, gone). The map is 160 tiles wide, so a tile fits a byte below this. */
export const TILE_ABSENT = 255;
/**
 * The map's side in tiles as the dashboard knows it (this module imports no values, so a Worker bundle stays small): the Worker sizes its
 * heatmap grid from it and the dashboard script's per-run view reads the same number. test/telemetry.test.ts keeps it equal to MAP_TILES_W.
 */
export const TELEMETRY_MAP_TILES = 160;
/** The dashboard's cross-run heatmap aggregates tiles into square cells this many tiles wide (40 x 40 on 160 x 160). */
export const TELEMETRY_HEAT_CELL_TILES = 4;

// Transport (packages/server/src/telemetry/*, deployment/cloudflare ingest).
export const TELEMETRY_INGEST_PATH = "/_internal/telemetry";
export const TELEMETRY_SCHEMA_HEADER = "x-telemetry-schema";
export const TELEMETRY_BATCH_HEADER = "x-telemetry-batch";
export const TELEMETRY_INGEST_MAX_RECORDS = 16;
export const TELEMETRY_INGEST_MAX_COMPRESSED_BYTES = 1024 * 1024;
export const TELEMETRY_INGEST_MAX_DECOMPRESSED_BYTES = 8 * 1024 * 1024;
export const TELEMETRY_QUEUE_MAX_RECORDS = 64;
export const TELEMETRY_QUEUE_MAX_BYTES = 8 * 1024 * 1024;
/** Waits before the 2nd..5th attempt of a batch; after the last it is dropped. */
export const TELEMETRY_RETRY_DELAYS_MS: readonly number[] = [2000, 8000, 30_000, 120_000];
export const TELEMETRY_REQUEST_TIMEOUT_MS = 10_000;
/** Records are coalesced this long before a POST (a run end rarely comes alone with bots). */
export const TELEMETRY_FLUSH_DELAY_MS = 2000;
/** The Room holds a finished run this long for the winner's client perf sample, then sends it. */
export const TELEMETRY_FINALIZE_GRACE_MS = 3000;
/** Minimum length of the ingest token, the dashboard token and the callsign salt. */
export const TELEMETRY_SECRET_MIN_CHARS = 32;

/** The room message a client sends once per run with its perf sample. Never a sim input (not in CLIENT_MESSAGE_TYPES). */
export const TELEMETRY_PERF_MESSAGE = "perf";

// ---------------------------------------------------------------------------------------------------------------
// Enumerations.

/** Who dealt a hit, from the ledger entry (docs/TELEMETRY.md 3.4, in this precedence). */
export const DAMAGE_SOURCES = [
  "weapon", // a weapon hit (fists included), crits included
  "signature", // burn, backlash, disease, mark (and their AP-on-DoT part)
  "wish", // ability damage, its DoT chunks included
  "zombie", // a Plague zombie's hit, credited to its owner
  "card", // a card's damage over time (bleed, Festering Arcana)
  "splash", // derived: wand splash, Overkill's splash
  "returned", // passive: riposte, Spiked Shell, reflected arrow
  "mob", // a regional mob (taken only)
  "terrain", // ember (taken only)
  "suddenDeath", // the coliseum burn (taken only)
] as const;
export type DamageSource = (typeof DAMAGE_SOURCES)[number];
export type DamageBySource = Partial<Record<DamageSource, number>>;

export const HEAL_SOURCES = [
  "lifesteal",
  "regen",
  "potion", // small and large potions (the camp clear grants a large one)
  "trigger", // Blood Saint, Second Wind
  "lastStand",
  "light", // the Sanctum's light terrain
  "chestSkip",
  "corpse", // Plague corpse
  "other",
] as const;
export type HealSource = (typeof HEAL_SOURCES)[number];
export type HealBySource = Partial<Record<HealSource, number>>;

export const GV_SOURCES = ["kills", "mobs", "bounty", "quest", "win", "skip"] as const;
export type GvSource = (typeof GV_SOURCES)[number];

export type DeathKind = "player" | "zombie" | "mob" | "terrain" | "suddenDeath" | "quit" | "unknown";
export type OfferKind = "augment" | "stat" | "trophy";
export type RecordSource = "live" | "dev" | "tournament" | "bench" | "test";
export type RunEnd = "winner" | "draw" | "void" | "abandoned";
/** `alive` only in a void or abandoned record: the player never resolved. */
export type PlayerOutcome = RunOutcome | "alive";
export type BotTierId = "easy" | "normal" | "hard";
export type BotPersonaId = "farmer" | "hunter" | "opportunist" | "cautious";

export const DUEL_OUTCOMES = [
  "kill", // one side went down, the killing blow credited to the other side
  "trade", // both went down in the same tick
  "thirdParty", // one side went down to a third player, a third player's zombie or a mob
  "hazard", // one side went down to terrain or sudden death
  "disengage", // DUEL_GAP_MS with no contact
  "quit", // one side left or went MIA
  "teleport", // the coliseum teleport cut it
  "runEnd", // the run ended (or was voided) with the segment open
] as const;
export type DuelOutcome = (typeof DUEL_OUTCOMES)[number];

/** Bits of DuelRecord.third: who else hurt either side during the segment. */
export const THIRD_PLAYER = 1; // another player, or another player's zombie
export const THIRD_MOB = 2;
export const THIRD_ARENA = 4; // terrain or sudden death (does not break `clean`)

/** 0 = side a struck first, 1 = side b, 2 = both in the same tick with equal damage. */
export type FirstStriker = 0 | 1 | 2;

// ---------------------------------------------------------------------------------------------------------------
// Records. All times are integer ms relative to the run start (raidStartedAt = 0) unless named `...Epoch`.
// Damage and heal numbers are rounded to 0.1. Absent optional maps mean zero everywhere.

export interface BuildInfo {
  /** SERVER_BUILD_ID (server/src/buildId.ts): always present. */
  server: string;
  /** Git commit, from GAME_SOURCE_COMMIT or build-info.json; the Worker fills it on ingest when null. */
  commit: string | null;
}

export interface TelemetryStats {
  maxHp: number;
  ad: number;
  ap: number;
  armor: number;
  shield: number;
  asMult: number;
  speedMult: number;
}

export interface BuildSnapshot extends TelemetryStats {
  /** PlayerState.build: card id -> copies. */
  cards: Record<string, number>;
  cardPower: number;
  /** Stat-chest picks per stat (PlayerExtraState.chestBoosts). */
  boosts: Partial<Record<ChestBoostStat, number>>;
  boostsTotal: number;
  /** Kill Trophy stats (PlayerExtraState.killStats). */
  trophies: Record<string, number>;
  /** PlayerState.mobStats: stat id -> stacks. */
  mobStats: Record<string, number>;
  mobStatsTotal: number;
}

export interface PowerSnapshot extends TelemetryStats {
  minute: number;
  cardPower: number;
  mobStatsTotal: number;
  boostsTotal: number;
}

export interface DeathCause {
  kind: DeathKind;
  at: number;
  /** player / zombie: the credited killer's slot. */
  bySlot?: number;
  weapon?: WeaponId;
  sig?: SignatureKind;
  ability?: AbilityId;
  /** mob: its type, elite flag and camp index (-1 none). */
  mobType?: string;
  elite?: boolean;
  camp?: number;
  /** Where it happened. */
  zone: RegionId;
  coliseum: boolean;
}

export interface WishStats {
  /** Accepted casts (castLand + every castEnd). */
  casts: number;
  landed: number;
  fizzled: number;
  interrupted: number;
  cancelled: number;
  /** Distinct enemy hits or statuses caused by the caster's Wish. */
  hits: number;
  damage: number;
}

/** What a browser measured over one run (client sends it once, at its result). Every field optional and clamped. */
export interface ClientPerfSample {
  v: 1;
  fpsP50?: number;
  frameMsP95?: number;
  frameMsP99?: number;
  /** Frames over 50 ms. */
  longFrames?: number;
  rttP50?: number;
  rttP95?: number;
  rttSamples?: number;
  interpDelayMs?: number;
  hiddenSec?: number;
  dpr?: number;
  canvasW?: number;
  canvasH?: number;
  ua?: "chrome" | "safari" | "firefox" | "other";
}

export interface NetStats {
  drops: number;
  reconnects: number;
}

export interface PlayerRecord {
  slot: number;
  /** HMAC-SHA256(TELEMETRY_SALT, "callsign:" + lowercased callsign), first 16 hex chars. Null for bots or without a salt. */
  pid: string | null;
  bot: boolean;
  tier?: BotTierId;
  persona?: BotPersonaId;
  faction: FactionId;
  spawn: { zone: RegionId; tx: number; ty: number; picked: boolean };
  place: number;
  outcome: PlayerOutcome;
  /** Time standing in the run, from the start to the down, leave or end. */
  aliveMs: number;
  death: DeathCause | null;
  kills: number;
  botKills: number;
  /** Ms with each weapon in hand (an empty hand is fists). */
  weaponMs: Partial<Record<WeaponId, number>>;
  /** The weapon held longest. */
  mainWeapon: WeaponId;
  /** Ms in each zone (the coliseum included). */
  zoneMs: Partial<Record<RegionId, number>>;
  final: BuildSnapshot;
  snapshots: PowerSnapshot[];
  mobKills: Record<string, number>;
  eliteKills: number;
  campsCleared: number;
  farmMs: number;
  dealt: { players: DamageBySource; mobs: DamageBySource };
  taken: DamageBySource;
  /** Damage past the victim's hp on killing blows on players (included in `dealt`). */
  overkill: number;
  healed: HealBySource;
  wish: WishStats;
  potions: { small: number; large: number; granted: number };
  quests: { accepted: string[]; completed: string[] };
  gv: Partial<Record<GvSource, number>>;
  winBonusWithheld?: boolean;
  winBonusWhy?: WinBonusWhy;
  net: NetStats;
  client?: ClientPerfSample;
  afkMs: number;
  afk: boolean;
  quit: boolean;
  /** 1 Hz (tx, ty) byte pairs, base64 (packTiles); TILE_ABSENT pairs when not standing. Omitted for an oversized record. */
  tiles?: string;
}

export interface DuelSide {
  slot: number;
  bot: boolean;
  faction: FactionId;
  /** In hand at the segment start, and every weapon that dealt this side's damage in it. */
  weapon: WeaponId;
  weaponsUsed: WeaponId[];
  /** Augment ids held at the start (base cards are in cardPower). At most TELEMETRY_MAX_DUEL_CARDS. */
  augments: string[];
  cardPower: number;
  mobStatsTotal: number;
  boostsTotal: number;
  /** hp fraction at the start of the tick the segment opened (hpFracAtTickStart) and at its end. */
  hp: number;
  hpEnd: number;
  /** Damage this side dealt to the other, by source. */
  dmg: DamageBySource;
  /** Wish casts this side began during the segment. */
  wishes: number;
  terrain: string;
}

export interface DuelRecord {
  i: number;
  start: number;
  /** The last contact (or the death tick). */
  end: number;
  /** [lower slot, higher slot]. */
  sides: [DuelSide, DuelSide];
  first: FirstStriker;
  outcome: DuelOutcome;
  /** 0 or 1 = the side that won (kill, or the survivor of thirdParty/hazard); -1 none. */
  winner: -1 | 0 | 1;
  /** THIRD_* bits. */
  third: number;
  /** No other player, zombie of another player or mob hurt either side during the segment. */
  clean: boolean;
  zone: RegionId;
  coliseum: boolean;
  /** The winner had the lower power index (comebackOf); null without a winner or with equal power. */
  comeback: boolean | null;
}

export interface OfferRecord {
  i: number;
  kind: OfferKind;
  at: number;
  /** Camp index (an elite camp), -1 for a crate's stat chest, a camp-less elite or a Trophy. */
  camp: number;
  elite: boolean;
  options: string[];
  /** Slots the offer was made to: the eligible contributors at the drop (the Trophy's owner). */
  eligible: number[];
  /** option = index into options, -1 = skip. A slot absent here never chose (expiry, ignored). */
  picks: { slot: number; option: number; at: number }[];
}

export interface CampClearRecord {
  camp: number;
  cycle: number;
  zone: RegionId;
  type: string;
  /** Elite type, "" for a camp with no elite spot. */
  elite: string;
  engagedAt: number;
  clearedAt: number;
  killerSlot: number;
  contributors: number[];
  /** Players this camp's mobs killed during the cycle. */
  playerDeaths: number;
}

export interface RunRecord {
  v: typeof TELEMETRY_SCHEMA_VERSION;
  kind: "run";
  /** UUID v4 from node:crypto in the Room (never a sim stream). The idempotency key. */
  runId: string;
  source: RecordSource;
  build: BuildInfo;
  startedAtEpoch: number;
  endedAtEpoch: number;
  durationMs: number;
  end: RunEnd;
  seed: number;
  attempt: number;
  mapHash: number;
  config: { planSeconds: number; quests: boolean; mobs: boolean; coliseumSchedule: boolean; botsFillTo: number };
  humans: number;
  bots: number;
  players: PlayerRecord[];
  winnerSlot: number;
  winBonusPaid: boolean;
  coliseum: { teleports: number[]; suddenDeath: number[] };
  firstBlood: { at: number; victim: number; killer: number } | null;
  /** Players who left during planning (MIA before the start); they have no PlayerRecord. */
  planningMia?: number;
  duels: DuelRecord[];
  offers: OfferRecord[];
  camps: CampClearRecord[];
  /** What a cap dropped; absent = nothing. */
  truncated?: { duels?: number; offers?: number; camps?: number; samples?: number; tiles?: boolean };
}

// ---------------------------------------------------------------------------------------------------------------
// Ingest response (Worker -> container).

export interface IngestResponse {
  accepted: string[];
  duplicate: string[];
  rejected: { runId: string | null; reason: string }[];
}

// ---------------------------------------------------------------------------------------------------------------
// Dashboard API (GET /api/stats/*, docs/TELEMETRY.md section 8). Every rate carries its sample.

export type StatsPool = "humans" | "bots" | "all";

export interface StatsQuery {
  build?: string;
  /** yyyy-mm-dd, inclusive, UTC. */
  from?: string;
  to?: string;
  pool: StatsPool;
  faction?: FactionId;
  weapon?: WeaponId;
  source?: RecordSource;
}

export interface RateCell {
  n: number;
  k: number;
  rate: number;
  lo: number;
  hi: number;
}

export interface StatsEnvelope<T> {
  query: StatsQuery;
  generatedAt: number;
  rows: T[];
  notes?: string[];
}

export interface StatsMeta {
  schemaVersion: number;
  builds: { build: string; commit: string | null; firstDay: string; lastDay: string; runs: number }[];
  firstDay: string | null;
  lastDay: string | null;
  runs: number;
  seeds: { seed: number; attempt: number; runs: number }[];
}

export interface OverviewRow {
  runs: number;
  players: number;
  humans: number;
  bots: number;
  duels: number;
  medianDurationS: number;
  medianFirstBloodS: number | null;
  voided: number;
}

export interface FactionRow {
  faction: FactionId;
  win: RateCell;
  avgPlace: number;
  /** Player kills per player, bot victims included (PlayerRecord.kills + botKills). */
  avgKills: number;
  avgMobKills: number;
  avgAliveS: number;
}

export interface WeaponRow {
  weapon: WeaponId;
  /** Run win rate of players whose mainWeapon it was. */
  win: RateCell;
  /** Share of all sampled seconds held. */
  heldShare: number;
}

/** One cell of a faction x faction or weapon x weapon matrix, from row's point of view. */
export interface MatrixCell {
  row: string;
  col: string;
  win: RateCell;
  medianDurationS: number;
}

export interface DuelSummaryRow {
  n: number;
  outcomes: Partial<Record<DuelOutcome, number>>;
  clean: RateCell;
  disengage: RateCell;
  thirdParty: RateCell;
  comeback: RateCell;
  firstStrikerWins: RateCell;
  medianDurationS: number;
}

export interface OfferRow {
  kind: OfferKind;
  option: string;
  offered: number;
  pick: RateCell;
  /** Run win rate of those who picked it, and of those offered it who did not. */
  winPicked: RateCell;
  winNotPicked: RateCell;
  /** Clean kill duels won by a side holding it at the start (augments only). */
  duelWin?: RateCell;
}

export interface FarmingRow {
  faction: FactionId;
  players: number;
  avgMobKills: number;
  avgEliteKills: number;
  avgFarmS: number;
  /** Mean card power at each TELEMETRY_SNAPSHOT_MINUTES entry (null with no sample). */
  powerAt: (number | null)[];
  mobStatsAt: (number | null)[];
}

export interface CampRow {
  type: string;
  elite: string;
  faction: FactionId | null;
  weapon: WeaponId | null;
  clears: number;
  medianClearS: number;
  playerDeaths: number;
}

export interface DeathRow {
  kind: DeathKind;
  faction: FactionId;
  /** mob type, killer faction or "" */
  detail: string;
  n: number;
  share: number;
}

export interface FirstBloodBin {
  fromS: number;
  toS: number;
  n: number;
}

export interface HeatmapResponse {
  query: StatsQuery & { seed?: number; attempt?: number };
  w: number;
  h: number;
  /** [tx, ty, seconds] for every non-zero cell. */
  cells: [number, number, number][];
  runs: number;
  generatedAt: number;
}

export interface PerfRow {
  samples: number;
  fpsP50: number | null;
  frameMsP95: number | null;
  rttP50: number | null;
  rttP95: number | null;
  reconnectsPerRun: number;
  afk: RateCell;
  quit: RateCell;
}

export interface RunListRow {
  runId: string;
  build: string;
  endedAtEpoch: number;
  durationS: number;
  humans: number;
  bots: number;
  end: RunEnd;
  winnerFaction: FactionId | null;
  source: RecordSource;
}

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers.

/** Wilson score interval at 95% (z 1.96). n 0 gives rate 0 and the whole [0, 1]. */
export function wilson95(k: number, n: number): RateCell {
  if (!(n > 0)) return { n: 0, k: 0, rate: 0, lo: 0, hi: 1 };
  const z = 1.959963984540054;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { n, k, rate: p, lo: k <= 0 ? 0 : Math.max(0, centre - half), hi: k >= n ? 1 : Math.min(1, centre + half) };
}

/** What closed a segment, as the recorder saw it at the end of a tick. */
export interface DuelEndFacts {
  /** Each side went down this tick (a died outcome, not a leave). */
  downA: boolean;
  downB: boolean;
  /** Who the down was credited to: "pair" = the other side (or its zombie), "third" = another player or its zombie, "mob", "arena". */
  creditA?: "pair" | "third" | "mob" | "arena";
  creditB?: "pair" | "third" | "mob" | "arena";
  quit: boolean;
  teleport: boolean;
  runEnd: boolean;
  gapExpired: boolean;
}

/** The outcome and winner of a closing segment. A down outranks a quit, a quit the teleport, the teleport the run end. */
export function classifyDuelEnd(f: DuelEndFacts): { outcome: DuelOutcome; winner: -1 | 0 | 1 } | null {
  if (f.downA && f.downB) return { outcome: "trade", winner: -1 };
  if (f.downA || f.downB) {
    const credit = f.downA ? f.creditA : f.creditB;
    const winner: 0 | 1 = f.downA ? 1 : 0;
    if (credit === "pair") return { outcome: "kill", winner };
    if (credit === "arena") return { outcome: "hazard", winner };
    return { outcome: "thirdParty", winner };
  }
  if (f.quit) return { outcome: "quit", winner: -1 };
  if (f.teleport) return { outcome: "teleport", winner: -1 };
  if (f.runEnd) return { outcome: "runEnd", winner: -1 };
  if (f.gapExpired) return { outcome: "disengage", winner: -1 };
  return null;
}

/** The power index the comeback rule compares: card power first, then mob stat stacks plus stat-chest picks. */
export function powerIndex(cardPower: number, mobStatsTotal: number, boostsTotal: number): [number, number] {
  return [cardPower, mobStatsTotal + boostsTotal];
}

/** True when the winner had the lower power index, false when the higher, null with no winner or equal power. */
export function comebackOf(sides: readonly [DuelSide, DuelSide], winner: -1 | 0 | 1): boolean | null {
  if (winner < 0) return null;
  const w = winner === 0 ? sides[0] : sides[1];
  const l = winner === 0 ? sides[1] : sides[0];
  const [wp, ws] = powerIndex(w.cardPower, w.mobStatsTotal, w.boostsTotal);
  const [lp, ls] = powerIndex(l.cardPower, l.mobStatsTotal, l.boostsTotal);
  if (wp !== lp) return wp < lp;
  if (ws !== ls) return ws < ls;
  return null;
}

/** "yyyy-mm-dd" of an epoch ms, UTC. */
export function telemetryDay(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,80}$/;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isRunId(s: unknown): s is string {
  return typeof s === "string" && RUN_ID.test(s);
}

/** The raw record's R2 key: telemetry/v1/build=<id>/date=<yyyy-mm-dd>/<runId>.json.gz (date from endedAtEpoch). */
export function telemetryObjectKey(build: string, endedAtEpoch: number, runId: string): string {
  const b = SAFE_SEGMENT.test(build) ? build : "unknown";
  return `telemetry/v${TELEMETRY_SCHEMA_VERSION}/build=${b}/date=${telemetryDay(endedAtEpoch)}/${runId}.json.gz`;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard base64 of a byte array (the 1 Hz tile pairs). Pure, so the server, the Worker and tests share it. */
export function packTiles(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return out;
}

/** The inverse of packTiles; null for a malformed string. */
export function unpackTiles(s: string): Uint8Array | null {
  if (s.length % 4 !== 0) return null;
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    let n = 0;
    for (let j = 0; j < 4; j++) {
      const ch = s[i + j];
      const v = ch === "=" ? 0 : B64.indexOf(ch);
      if (v < 0) return null;
      n = (n << 6) | v;
    }
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** The p-th quantile (0..1) of a histogram whose bucket i covers [i * width, (i + 1) * width); the last bucket is overflow. */
export function histogramQuantile(buckets: ArrayLike<number>, width: number, p: number): number | null {
  let total = 0;
  for (let i = 0; i < buckets.length; i++) total += buckets[i];
  if (total <= 0) return null;
  const want = p * total;
  let seen = 0;
  for (let i = 0; i < buckets.length; i++) {
    seen += buckets[i];
    if (seen >= want) return (i + 0.5) * width;
  }
  return buckets.length * width;
}

const PERF_LIMITS: Record<Exclude<keyof ClientPerfSample, "v" | "ua">, [number, number]> = {
  fpsP50: [0, 1000],
  frameMsP95: [0, 10_000],
  frameMsP99: [0, 10_000],
  longFrames: [0, 1e7],
  rttP50: [0, 60_000],
  rttP95: [0, 60_000],
  rttSamples: [0, 1e6],
  interpDelayMs: [0, 10_000],
  hiddenSec: [0, 86_400],
  dpr: [0, 8],
  canvasW: [0, 16_384],
  canvasH: [0, 16_384],
};

/** The server's one gate for a client perf message: finite numbers clamped to sane bounds, unknown keys dropped. */
export function sanitizeClientPerf(x: unknown): ClientPerfSample | null {
  if (typeof x !== "object" || x === null || (x as { v?: unknown }).v !== 1) return null;
  const src = x as Record<string, unknown>;
  const out: ClientPerfSample = { v: 1 };
  for (const key of Object.keys(PERF_LIMITS) as (keyof typeof PERF_LIMITS)[]) {
    const v = src[key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const [lo, hi] = PERF_LIMITS[key];
    out[key] = Math.round(Math.min(hi, Math.max(lo, v)) * 10) / 10;
  }
  const ua = src.ua;
  if (ua === "chrome" || ua === "safari" || ua === "firefox" || ua === "other") out.ua = ua;
  return out;
}

const FACTION_SET: ReadonlySet<string> = new Set(["fire", "sentenced", "plague", "frost", "holy"]);
const WEAPON_SET: ReadonlySet<string> = new Set(["sword", "bow", "wand", "shield", "axe", "fists"]);

/**
 * The ingest's structural check (Worker and server tests). It returns the first problem as text, or null when the
 * record is usable. It checks identity, sizes and the fields the SQL rows read; it does not re-derive anything.
 */
export function validateRunRecord(x: unknown): string | null {
  if (typeof x !== "object" || x === null) return "not an object";
  const r = x as Partial<RunRecord>;
  if (r.v !== TELEMETRY_SCHEMA_VERSION) return "schema version";
  if (r.kind !== "run") return "kind";
  if (!isRunId(r.runId)) return "runId";
  if (!r.build || typeof r.build.server !== "string" || !SAFE_SEGMENT.test(r.build.server)) return "build";
  for (const k of ["startedAtEpoch", "endedAtEpoch", "durationMs", "seed", "attempt", "mapHash", "winnerSlot"] as const) {
    if (typeof r[k] !== "number" || !Number.isFinite(r[k])) return k;
  }
  if (!Array.isArray(r.players) || r.players.length === 0 || r.players.length > 8) return "players";
  const slots = new Set<number>();
  for (const p of r.players) {
    if (!p || typeof p.slot !== "number" || slots.has(p.slot)) return "player slot";
    slots.add(p.slot);
    if (!FACTION_SET.has(p.faction)) return "player faction";
    if (!WEAPON_SET.has(p.mainWeapon)) return "player weapon";
    if (typeof p.bot !== "boolean") return "player bot";
    if (p.pid !== null && (typeof p.pid !== "string" || !/^[0-9a-f]{16}$/.test(p.pid))) return "player pid";
  }
  if (!Array.isArray(r.duels) || r.duels.length > TELEMETRY_MAX_DUELS) return "duels";
  for (const d of r.duels) {
    if (!d || !Array.isArray(d.sides) || d.sides.length !== 2) return "duel sides";
    if (!slots.has(d.sides[0].slot) || !slots.has(d.sides[1].slot) || d.sides[0].slot >= d.sides[1].slot) return "duel slots";
    if (!(DUEL_OUTCOMES as readonly string[]).includes(d.outcome)) return "duel outcome";
  }
  if (!Array.isArray(r.offers) || r.offers.length > TELEMETRY_MAX_OFFERS) return "offers";
  if (!Array.isArray(r.camps) || r.camps.length > TELEMETRY_MAX_CAMP_CLEARS) return "camps";
  return null;
}

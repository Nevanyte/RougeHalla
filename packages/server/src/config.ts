import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIRST_PATIENCE_SECONDS, LOBBY_FILL_SECONDS, LOBBY_SECONDS, MAX_PLAYERS, MIN_PLAYERS_TO_START, PATIENCE_MIN_SECONDS,
  PATIENCE_SECONDS, PLAN_SECONDS, SERVER_PORT, SUDDEN_DEATH_SECONDS, TRAINING_IDLE_SECONDS, WISH_LOCK_SECONDS,
} from "@raid/shared";
import {
  BOT_FILL_DEFAULTS, PERSONA_IDS, TIER_IDS, type BotFillConfig,
} from "./bots/brain/types";
import { MAP_POOL_TARGET } from "./mapPool";
import type { SimConfig } from "./sim/world";

export interface ServerConfig extends SimConfig {
  port: number;
  /** The profile file (STASH_FILE: the name predates profiles v2, and keeping it lets a v1 file migrate in place). */
  stashFile: string;
  /** Simulated minimum round trip in ms for netcode testing (COLYSEUS_LATENCY, 0 = off). See net/netSim.ts. */
  latencyMs: number;
  /** Mean of the simulated per-message jitter in ms (NET_JITTER_MS), the share of messages stalled by a lost segment (NET_LOSS_PCT, percent) and the seed of both (NET_SEED). */
  netJitterMs?: number;
  netLossPct?: number;
  netSeed?: number;
  /**
   * Install the network simulator even when hosting (ALLOW_NETSIM_WHEN_HOSTING=1). Off: a hosting server (sameOriginOnly) refuses to,
   * with one warning, because it would add the delay and loss to every friend on the link.
   */
  allowNetSimWhenHosting: boolean;
  /** A training room whose player sends nothing for this long is closed (TRAINING_IDLE_SECONDS). */
  trainingIdleSeconds: number;
  /** The built client to serve from the same port as the API and the websocket (CLIENT_DIR). Unset: the server serves no pages (dev: Vite does). */
  clientDir: string | undefined;
  /**
   * Hosting for a public link: /api and matchmaking answer no page from another origin (no `Access-Control-Allow-Origin: *`),
   * except the `corsOrigins`. On when NODE_ENV=production or a client is served; off in dev, where Vite on :5173 calls :2567.
   */
  sameOriginOnly: boolean;
  /** Extra origins allowed in sameOriginOnly mode (CORS_ORIGINS, comma separated, e.g. a client hosted elsewhere). */
  corsOrigins: string[];
  /** The playtest passcode (PLAYTEST_PASSCODE). Unset: none is asked for. Set: needed to claim a callsign and to join a room. */
  passcode: string | undefined;
  /** Wrong passcodes a minute per client address, and over the whole server, before it refuses with 429 (PASSCODE_FAILS_PER_MINUTE, PASSCODE_FAILS_PER_MINUTE_ALL; 0 = no limit). Counted on the profile route and on matchmaking. */
  passcodeFailsPerMinute: number;
  passcodeFailsPerMinuteAll: number;
  /** Rooms alive at once, per mode; a room beyond it is refused with "server is full" (MAX_ARENA_ROOMS, MAX_TRAINING_ROOMS; 0 = no limit). */
  maxArenaRooms: number;
  maxTrainingRooms: number;
  /** New profiles an hour, in all and per client address (MAX_NEW_PROFILES_PER_HOUR, MAX_NEW_PROFILES_PER_IP_PER_HOUR; 0 = no limit). */
  maxNewProfilesPerHour: number;
  maxNewProfilesPerIpPerHour: number;
  /** One player's in-match order budget: a token bucket of `orderBurst` refilled `orderPerSecond` a second (ORDER_BURST, ORDER_PER_SECOND; 0 = no limit). */
  orderBurst: number;
  orderPerSecond: number;
  /** One profile's shop and wardrobe request budget, the same kind of bucket (SHOP_BURST, SHOP_PER_SECOND; 0 = no limit). */
  shopBurst: number;
  shopPerSecond: number;
  /**
   * Certified maps the pool keeps ready (MAP_POOL; mapPool.ts MAP_POOL_TARGET when unset). 0 runs no map worker: every
   * room certifies its map on the main thread. Optional so a hand-written config keeps the default.
   */
  mapPoolSize?: number;
  /** Fill bots for arena lobbies (BOTS_* env, docs/BOTS.md 7.3); `fillTo` 0 turns them off. */
  bots: BotFillConfig;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STASH_FILE = path.resolve(here, "../data/stash.json");

/**
 * Guards for a public link: best guesses, all overridable by env (0 turns one off). The room, new-profile and shop ones are
 * on by default only when hosting (NODE_ENV=production, or a client served: ServerConfig.sameOriginOnly), so that dev
 * (64 bots, a test that claims a hundred callsigns) keeps working unchanged; the order budget is on everywhere, since the
 * bots and the e2e run exercise it.
 * Rooms: 8 testers fill one or two lobbies, so 4 arena rooms leave room for runs lingering on their results, and every
 * tester may practise at once. New profiles: 8 friends, some with a second callsign, each from their own address.
 */
const DEFAULT_MAX_ARENA_ROOMS = 4;
const DEFAULT_MAX_TRAINING_ROOMS = 8;
const DEFAULT_MAX_NEW_PROFILES_PER_HOUR = 30;
const DEFAULT_MAX_NEW_PROFILES_PER_IP_PER_HOUR = 10;
/**
 * Wrong passcodes a minute. A friend mistypes a word a few times; a guesser sends thousands. 6 a minute per address leaves
 * a dictionary of 100,000 words about 11 days from one address, and 40 a minute over all addresses (a guesser with many
 * addresses, or a lockout of everyone while it lasts) about 42 hours. On whenever a passcode is set: with none, no guess is wrong.
 */
const DEFAULT_PASSCODE_FAILS_PER_MINUTE = 6;
const DEFAULT_PASSCODE_FAILS_PER_MINUTE_ALL = 40;
/**
 * In-match orders (everything but `aim`) per player. Measured: the browser sends a `move` every 100 ms while the right
 * button is held (49 in 5.1 s, 9.6 a second, gaps 99 to 125 ms), and one message per click or key press on top of that;
 * the headless bots peak at 6 orders in any second and 17 in any 5 s (mean 1 a second). 15 a second leaves a held button
 * room for 5 clicks a second, and a burst of 30 is two seconds of a held button arriving at once after a network stall.
 * A script sending `stop` and `target` every tick (40 a second) is cut to 15.
 */
const DEFAULT_ORDER_BURST = 30;
const DEFAULT_ORDER_PER_SECOND = 15;
/** Shop and wardrobe requests per profile: a person clicking fast does 2 a second. */
const DEFAULT_SHOP_BURST = 6;
const DEFAULT_SHOP_PER_SECOND = 3;

function num(v: string | undefined, fallback: number): number {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** A non-negative number: a bad value falls back, a negative one is 0. */
function nonNegative(v: string | undefined, fallback: number): number {
  return Math.max(0, num(v, fallback));
}

/**
 * "name:weight,name:weight" over `ids`. Weights are relative (not normalised). A name with no weight counts 1; a name
 * that is unknown, or a weight that is not a number, is ignored; a negative weight is 0; a name given twice keeps its
 * last weight; a listed set with nothing above 0 (or an unset/empty value) is the default mix.
 */
export function parseMix<K extends string>(
  raw: string | undefined, ids: readonly K[], fallback: Readonly<Record<K, number>>,
): Record<K, number> {
  const given = new Map<K, number>();
  for (const part of (raw ?? "").split(",")) {
    const [name, weight, ...extra] = part.split(":").map((x) => x.trim());
    const id = ids.find((k) => k === name?.toLowerCase());
    if (id === undefined || extra.length > 0) continue;
    const w = weight === undefined ? 1 : weight === "" ? NaN : Number(weight);
    if (Number.isFinite(w)) given.set(id, Math.max(0, w));
  }
  const mix = {} as Record<K, number>;
  let total = 0;
  for (const id of ids) {
    mix[id] = given.get(id) ?? 0;
    total += mix[id];
  }
  return total > 0 ? mix : { ...fallback };
}

function parseBots(env: NodeJS.ProcessEnv): BotFillConfig {
  const d = BOT_FILL_DEFAULTS;
  const statsFile = env.BOT_STATS_FILE?.trim();
  return {
    fillTo: Math.min(MAX_PLAYERS, Math.round(nonNegative(env.BOTS_FILL_TO, d.fillTo))),
    arrivalSeconds: nonNegative(env.BOTS_ARRIVAL_SECONDS, d.arrivalSeconds),
    tierMix: parseMix(env.BOTS_TIER_MIX, TIER_IDS, d.tierMix),
    personaMix: parseMix(env.BOTS_PERSONA_MIX, PERSONA_IDS, d.personaMix),
    latencyMs: nonNegative(env.BOTS_LATENCY_MS, d.latencyMs),
    jitterMs: nonNegative(env.BOTS_JITTER_MS, d.jitterMs),
    // Unset: next to the profile file. "off": no learning (the empty path). Anything else is the file.
    statsFile: !statsFile ? d.statsFile : statsFile.toLowerCase() === "off" ? "" : statsFile,
    seed: env.BOTS_SEED === undefined || env.BOTS_SEED.trim() === "" || !Number.isFinite(Number(env.BOTS_SEED))
      ? d.seed : Math.trunc(Number(env.BOTS_SEED)) >>> 0,
  };
}

/** A non-negative number: a negative or non-numeric value falls back (0 is meaningful: "no limit"). */
function limit(v: string | undefined, fallback: number): number {
  const n = num(v, fallback);
  return n >= 0 ? n : fallback;
}

/** Origins as a browser sends them: scheme and host in lower case, no trailing slash. */
function originList(v: string | undefined): string[] {
  return (v ?? "").split(",").map((o) => o.trim().replace(/\/+$/, "").toLowerCase()).filter((o) => o !== "");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const patienceSeconds = num(env.PATIENCE_SECONDS, PATIENCE_SECONDS);
  const hosting = env.NODE_ENV === "production" || !!env.CLIENT_DIR;
  /** A hosting-only guard's default: the value when hosting, unlimited (0) in dev. */
  const whenHosting = (value: number): number => (hosting ? value : 0);
  return {
    port: num(env.RAID_PORT, SERVER_PORT),
    stashFile: env.STASH_FILE || DEFAULT_STASH_FILE,
    latencyMs: num(env.COLYSEUS_LATENCY, 0),
    netJitterMs: num(env.NET_JITTER_MS, 0),
    netLossPct: num(env.NET_LOSS_PCT, 0),
    ...(env.NET_SEED ? { netSeed: num(env.NET_SEED, 0) } : {}),
    allowNetSimWhenHosting: env.ALLOW_NETSIM_WHEN_HOSTING === "1" || env.ALLOW_NETSIM_WHEN_HOSTING === "true",
    trainingIdleSeconds: num(env.TRAINING_IDLE_SECONDS, TRAINING_IDLE_SECONDS),
    clientDir: env.CLIENT_DIR ? path.resolve(env.CLIENT_DIR) : undefined,
    sameOriginOnly: hosting,
    corsOrigins: originList(env.CORS_ORIGINS),
    passcode: env.PLAYTEST_PASSCODE || undefined,
    passcodeFailsPerMinute: Math.floor(limit(env.PASSCODE_FAILS_PER_MINUTE, DEFAULT_PASSCODE_FAILS_PER_MINUTE)),
    passcodeFailsPerMinuteAll: Math.floor(limit(env.PASSCODE_FAILS_PER_MINUTE_ALL, DEFAULT_PASSCODE_FAILS_PER_MINUTE_ALL)),
    maxArenaRooms: Math.floor(limit(env.MAX_ARENA_ROOMS, whenHosting(DEFAULT_MAX_ARENA_ROOMS))),
    maxTrainingRooms: Math.floor(limit(env.MAX_TRAINING_ROOMS, whenHosting(DEFAULT_MAX_TRAINING_ROOMS))),
    maxNewProfilesPerHour: Math.floor(limit(env.MAX_NEW_PROFILES_PER_HOUR, whenHosting(DEFAULT_MAX_NEW_PROFILES_PER_HOUR))),
    maxNewProfilesPerIpPerHour: Math.floor(limit(env.MAX_NEW_PROFILES_PER_IP_PER_HOUR, whenHosting(DEFAULT_MAX_NEW_PROFILES_PER_IP_PER_HOUR))),
    orderBurst: limit(env.ORDER_BURST, DEFAULT_ORDER_BURST),
    orderPerSecond: limit(env.ORDER_PER_SECOND, DEFAULT_ORDER_PER_SECOND),
    shopBurst: limit(env.SHOP_BURST, whenHosting(DEFAULT_SHOP_BURST)),
    shopPerSecond: limit(env.SHOP_PER_SECOND, whenHosting(DEFAULT_SHOP_PER_SECOND)),
    mapPoolSize: Math.max(0, Math.floor(num(env.MAP_POOL, MAP_POOL_TARGET))),
    minPlayers: num(env.MIN_PLAYERS, MIN_PLAYERS_TO_START),
    lobbySeconds: num(env.LOBBY_SECONDS, LOBBY_SECONDS),
    fillSeconds: num(env.FILL_SECONDS, LOBBY_FILL_SECONDS),
    patienceSeconds,
    // Unset, the short end keeps the default proportion, so PATIENCE_SECONDS=20 alone scales from 20 s down to 8 s.
    // Clamped so the timer never grows as players fall.
    patienceMinSeconds: Math.max(0, Math.min(patienceSeconds,
      num(env.PATIENCE_MIN_SECONDS, patienceSeconds * (PATIENCE_MIN_SECONDS / PATIENCE_SECONDS)))),
    suddenDeathSeconds: num(env.SUDDEN_DEATH_SECONDS, SUDDEN_DEATH_SECONDS),
    wishLockSeconds: num(env.WISH_LOCK_SECONDS, WISH_LOCK_SECONDS),
    dummies: env.DUMMIES === "1" || env.DUMMIES === "true",
    // On by default: a mob rests at every camp spot when a run starts (the headless bots fight them too). MOBS=0 or MOBS=false turns them off.
    mobs: env.MOBS !== "0" && env.MOBS !== "false",
    bots: parseBots(env),
    // The live server plans (roguelike R3); PLAN_SECONDS=0 starts runs straight from the lobby. Training rooms never plan.
    planSeconds: Math.max(0, num(env.PLAN_SECONDS, PLAN_SECONDS)),
    // Decision 10: the first timer is flat. FIRST_PATIENCE_SECONDS=0 scales it with the players like every later one.
    // A dev who sets only PATIENCE_SECONDS (to shorten a run) gets that as the flat first timer too, not 300 s.
    firstPatienceSeconds: Math.max(
      0, num(env.FIRST_PATIENCE_SECONDS, env.PATIENCE_SECONDS !== undefined ? patienceSeconds : FIRST_PATIENCE_SECONDS),
    ),
  };
}

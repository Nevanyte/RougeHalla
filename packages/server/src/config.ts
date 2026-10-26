import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOBBY_FILL_SECONDS, LOBBY_SECONDS, MAX_PLAYERS, MIN_PLAYERS_TO_START, PATIENCE_MIN_SECONDS, PATIENCE_SECONDS, SERVER_PORT,
  SUDDEN_DEATH_SECONDS, TRAINING_IDLE_SECONDS,
} from "@raid/shared";
import {
  BOT_FILL_DEFAULTS, PERSONA_IDS, TIER_IDS, type BotFillConfig,
} from "./bots/brain/types";
import type { SimConfig } from "./sim/world";

export interface ServerConfig extends SimConfig {
  port: number;
  /** The profile file (STASH_FILE: the name predates profiles v2, and keeping it lets a v1 file migrate in place). */
  stashFile: string;
  /** Artificial one-way latency for netcode testing (0 = off). */
  latencyMs: number;
  /** A training room whose player sends nothing for this long is closed (TRAINING_IDLE_SECONDS). */
  trainingIdleSeconds: number;
  /** Fill bots for arena lobbies (BOTS_* env, docs/BOTS.md 7.3); `fillTo` 0 turns them off. */
  bots: BotFillConfig;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STASH_FILE = path.resolve(here, "../data/stash.json");

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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const patienceSeconds = num(env.PATIENCE_SECONDS, PATIENCE_SECONDS);
  return {
    port: num(env.RAID_PORT, SERVER_PORT),
    stashFile: env.STASH_FILE || DEFAULT_STASH_FILE,
    latencyMs: num(env.COLYSEUS_LATENCY, 0),
    trainingIdleSeconds: num(env.TRAINING_IDLE_SECONDS, TRAINING_IDLE_SECONDS),
    minPlayers: num(env.MIN_PLAYERS, MIN_PLAYERS_TO_START),
    lobbySeconds: num(env.LOBBY_SECONDS, LOBBY_SECONDS),
    fillSeconds: num(env.FILL_SECONDS, LOBBY_FILL_SECONDS),
    patienceSeconds,
    // Unset, the short end keeps the default proportion, so PATIENCE_SECONDS=20 alone scales from 20 s down to 8 s.
    // Clamped so the timer never grows as players fall.
    patienceMinSeconds: Math.max(0, Math.min(patienceSeconds,
      num(env.PATIENCE_MIN_SECONDS, patienceSeconds * (PATIENCE_MIN_SECONDS / PATIENCE_SECONDS)))),
    suddenDeathSeconds: num(env.SUDDEN_DEATH_SECONDS, SUDDEN_DEATH_SECONDS),
    dummies: env.DUMMIES === "1" || env.DUMMIES === "true",
    // On by default: a mob rests at every camp spot when a run starts (the headless bots fight them too). MOBS=0 or MOBS=false turns them off.
    mobs: env.MOBS !== "0" && env.MOBS !== "false",
    bots: parseBots(env),
  };
}

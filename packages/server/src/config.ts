import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOBBY_FILL_SECONDS, LOBBY_SECONDS, MIN_PLAYERS_TO_START, PATIENCE_MIN_SECONDS, PATIENCE_SECONDS, SERVER_PORT,
  SUDDEN_DEATH_SECONDS, TRAINING_IDLE_SECONDS, WISH_LOCK_SECONDS,
} from "@raid/shared";
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
  /** A training room whose player sends nothing for this long is closed (TRAINING_IDLE_SECONDS). */
  trainingIdleSeconds: number;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STASH_FILE = path.resolve(here, "../data/stash.json");

function num(v: string | undefined, fallback: number): number {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const patienceSeconds = num(env.PATIENCE_SECONDS, PATIENCE_SECONDS);
  return {
    port: num(env.RAID_PORT, SERVER_PORT),
    stashFile: env.STASH_FILE || DEFAULT_STASH_FILE,
    latencyMs: num(env.COLYSEUS_LATENCY, 0),
    netJitterMs: num(env.NET_JITTER_MS, 0),
    netLossPct: num(env.NET_LOSS_PCT, 0),
    ...(env.NET_SEED ? { netSeed: num(env.NET_SEED, 0) } : {}),
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
    wishLockSeconds: num(env.WISH_LOCK_SECONDS, WISH_LOCK_SECONDS),
    dummies: env.DUMMIES === "1" || env.DUMMIES === "true",
    // On by default: a mob rests at every camp spot when a run starts (the headless bots fight them too). MOBS=0 or MOBS=false turns them off.
    mobs: env.MOBS !== "0" && env.MOBS !== "false",
  };
}

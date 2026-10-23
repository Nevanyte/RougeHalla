import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOBBY_FILL_SECONDS, LOBBY_SECONDS, MIN_PLAYERS_TO_START, PATIENCE_MIN_SECONDS, PATIENCE_SECONDS, SERVER_PORT,
  SUDDEN_DEATH_SECONDS,
} from "@raid/shared";
import type { SimConfig } from "./sim/world";

export interface ServerConfig extends SimConfig {
  port: number;
  /** The profile file (STASH_FILE: the name predates profiles v2, and keeping it lets a v1 file migrate in place). */
  stashFile: string;
  /** Artificial one-way latency for netcode testing (0 = off). */
  latencyMs: number;
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
  };
}

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXTRACT_SECONDS, LOBBY_FILL_SECONDS, LOBBY_SECONDS, MIN_PLAYERS_TO_START, RAID_SECONDS, SERVER_PORT,
} from "@raid/shared";
import type { SimConfig } from "./sim/world";

export interface ServerConfig extends SimConfig {
  port: number;
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
  return {
    port: num(env.RAID_PORT, SERVER_PORT),
    stashFile: env.STASH_FILE || DEFAULT_STASH_FILE,
    latencyMs: num(env.COLYSEUS_LATENCY, 0),
    minPlayers: num(env.MIN_PLAYERS, MIN_PLAYERS_TO_START),
    lobbySeconds: num(env.LOBBY_SECONDS, LOBBY_SECONDS),
    fillSeconds: num(env.FILL_SECONDS, LOBBY_FILL_SECONDS),
    raidSeconds: num(env.RAID_SECONDS, RAID_SECONDS),
    extractSeconds: num(env.EXTRACT_SECONDS, EXTRACT_SECONDS),
  };
}

import {
  LOBBY_PRESENCE_PATH, LOBBY_SNAPSHOT_PATH, PASSCODE_HEADER, PROFILE_TOKEN_HEADER,
  type LobbyGame, type LobbyGamePlayer, type LobbyPerson, type LobbySnapshot,
} from "@raid/shared";
import { apiBase } from "./connection";
import { readPasscode } from "./passcode";

export type { LobbyGame, LobbyGamePlayer, LobbyPerson, LobbySnapshot };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isPerson = (value: unknown): value is LobbyPerson => isObject(value) && typeof value.name === "string";
const isPlayer = (value: unknown): value is LobbyGamePlayer => isObject(value)
  && typeof value.name === "string" && (value.kind === "human" || value.kind === "bot") && typeof value.alive === "boolean";
function isSnapshot(value: unknown): value is LobbySnapshot {
  if (!isObject(value) || !(value.activeGame === null || isObject(value.activeGame)) || !Array.isArray(value.waiting)) return false;
  const game = value.activeGame;
  return Number.isFinite(value.serverNow) && Number.isFinite(value.onlineCount) && value.waiting.every(isPerson)
    && Number.isFinite(value.arenaRoomCount) && (value.arenaLimit === null || Number.isFinite(value.arenaLimit))
    && typeof value.arenaAvailable === "boolean"
    && (game === null || ((game.phase === "lobby" || game.phase === "planning" || game.phase === "active" || game.phase === "finished")
      && (game.startedAt === null || Number.isFinite(game.startedAt)) && Array.isArray(game.players) && game.players.every(isPlayer)));
}

// Memory-only: duplicated tabs can clone sessionStorage, but each page needs a distinct lease id.
const THIS_TAB = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(5000);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

async function snapshotRequest(path: string, init?: RequestInit): Promise<LobbySnapshot | null> {
  try {
    const response = await fetch(`${apiBase()}${path}`, { ...init, cache: "no-store", signal: requestSignal(init?.signal ?? undefined) });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return isSnapshot(body) ? body : null;
  } catch {
    return null;
  }
}

export function fetchLobbySnapshot(signal?: AbortSignal): Promise<LobbySnapshot | null> {
  return snapshotRequest(LOBBY_SNAPSHOT_PATH, { signal });
}

function presenceHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [PROFILE_TOKEN_HEADER]: token,
  };
  const passcode = readPasscode();
  if (passcode) headers[PASSCODE_HEADER] = passcode;
  return headers;
}

export function heartbeatLobbyPresence(name: string, token: string, signal?: AbortSignal): Promise<LobbySnapshot | null> {
  return snapshotRequest(LOBBY_PRESENCE_PATH, {
    method: "POST", headers: presenceHeaders(token), body: JSON.stringify({ name, tabId: THIS_TAB }), signal,
  });
}

export async function releaseLobbyPresence(name: string, token: string): Promise<void> {
  await snapshotRequest(LOBBY_PRESENCE_PATH, {
    method: "DELETE", headers: presenceHeaders(token), body: JSON.stringify({ name, tabId: THIS_TAB }),
  });
}

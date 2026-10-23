import { Client, type Room } from "@colyseus/sdk";
import { ROOM_NAME, SERVER_PORT, type ClientMessages, type JoinOptions } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";

export type RaidRoom = Room<any, RaidState>;

/** VITE_SERVER_URL when set and non-empty; the WebSocket endpoint and the REST base both derive from it. */
function configuredServerUrl(): string | undefined {
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  return fromEnv || undefined;
}

export function serverEndpoint(): string {
  return configuredServerUrl() ?? `${location.protocol}//${location.hostname}:${SERVER_PORT}`;
}

/**
 * Prefix for REST paths, without a trailing slash. When VITE_SERVER_URL is set, the http(s) origin of that URL
 * (ws → http, wss → https), which makes /api cross-origin (the server answers with CORS). Otherwise "", so /api
 * stays same-origin and goes through Vite's dev proxy.
 */
export function apiBase(): string {
  const configured = configuredServerUrl();
  if (!configured) return "";
  try {
    const url = new URL(configured, location.href);
    const protocol = url.protocol === "wss:" ? "https:" : url.protocol === "ws:" ? "http:" : url.protocol;
    // Keep the path: a server mounted under a prefix (reverse proxy) serves /api below it too.
    const prefix = url.pathname.replace(/\/+$/, "");
    return protocol === "http:" || protocol === "https:" ? `${protocol}//${url.host}${prefix}` : "";
  } catch {
    return "";
  }
}

let client: Client | null = null;

/** Server keeps a dropped seat for RECONNECT_SECONDS (10s); give up a little before that. */
function tuneReconnection(room: RaidRoom): void {
  room.reconnection.maxRetries = 6; // ≈0.2+0.6+1.4+2+2+2 s with the 2 s cap
  room.reconnection.maxDelay = 2000;
  // Inputs typed while disconnected are stale by the time we're back; drop them.
  room.reconnection.maxEnqueuedMessages = 0;
}

/** The text the server (or the socket layer) gave for a failed join, for the menu to show. */
export function joinErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg || "unknown error";
}

/** The server refused the join because this callsign already has a seat in a run (typically a duplicated tab). */
export function isCallsignBusy(err: unknown): boolean {
  return /already in a (raid|run)/i.test(joinErrorMessage(err));
}

/**
 * Abandons a room for good, whatever state its socket is in: no handler fires again, no reconnect is attempted and
 * the socket is closed. room.leave() alone is not enough: it only sends LEAVE_ROOM, which does nothing on a closed
 * socket and throws InvalidStateError on a connecting one (mid-reconnect), and it leaves the SDK's retry timers running.
 */
export function detachRoom(room: RaidRoom): void {
  room.removeAllListeners();
  room.reconnection.enabled = false;
  // A retry timer scheduled before this call ignores `enabled` (only the next drop checks it). If its reconnect
  // succeeds, the room would be back in the run with no one listening: close that socket again at once.
  room.onReconnect(() => { void room.leave(false).catch(() => {}); });
  // consented=false closes the socket instead of sending; it only settles once the close event arrives, if ever.
  room.leave(false).catch(() => {});
}

export async function joinRaid(options: JoinOptions): Promise<RaidRoom> {
  client ??= new Client(serverEndpoint());
  // A seat reserved in the instant a run starts is refused ("raid already started");
  // the next joinOrCreate lands in a fresh lobby.
  for (let attempt = 0; ; attempt++) {
    try {
      const room = await client.joinOrCreate<RaidState>(ROOM_NAME, options);
      tuneReconnection(room);
      return room;
    } catch (err) {
      if (attempt >= 2 || !/(raid|run) already started/i.test(joinErrorMessage(err))) throw err;
    }
  }
}

/** Typed input sender: the only way the client talks to the sim. */
export function sendInput<K extends keyof ClientMessages>(room: RaidRoom, type: K, payload: ClientMessages[K]): void {
  room.send(type, payload);
}

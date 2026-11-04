import { Client, type Room } from "@colyseus/sdk";
import { CLIENT_OUT_OF_DATE_CODE, CLIENT_OUT_OF_DATE_MESSAGE, ROOM_NAME, SERVER_PORT, TRAINING_ROOM_NAME, type ClientMessages, type JoinOptions } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { readPasscode } from "./passcode";
import { MessageMeter } from "./uplinkPace";
import { tuneReconnection } from "./roomLink";

// The socket-level helpers (reconnection settings, the forced drop, the liveness link) live in roomLink.ts, which reads no build
// environment, so the server's benches run them as the page does.
export { forceDrop, linkOf, tuneReconnection } from "./roomLink";

export type RaidRoom = Room<any, RaidState>;

/** VITE_SERVER_URL when set and non-empty; the WebSocket endpoint and the REST base both derive from it. */
function configuredServerUrl(): string | undefined {
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  return fromEnv || undefined;
}

/**
 * Where the game server is. VITE_SERVER_URL wins. Otherwise a production build is served by the server itself (`npm run
 * playtest`, the Dockerfile), so the page's own origin is the server, and the SDK derives the websocket from it (an https
 * page gets wss). A dev build runs on Vite's port and talks to the server on its own port (Vite proxies only /api).
 */
export function serverEndpoint(): string {
  const configured = configuredServerUrl();
  if (configured) return configured;
  return import.meta.env.DEV ? `${location.protocol}//${location.hostname}:${SERVER_PORT}` : location.origin;
}

/** The wire build this page was built with (vite.config.ts bakes it into a production build; a dev build and the tests have none). */
export function pageWireBuild(): string | undefined {
  const build = import.meta.env.VITE_WIRE_BUILD as string | undefined;
  return build || undefined;
}

/** The join options with what the page adds: the playtest passcode, when it has one (a link with ?code=, or one remembered from before), and its wire build. */
function withPageFacts<T extends JoinOptions | Omit<JoinOptions, "mode">>(options: T): T {
  const passcode = readPasscode();
  const build = pageWireBuild();
  return { ...options, ...(passcode ? { passcode } : {}), ...(build ? { build } : {}) };
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

/** The text the server (or the socket layer) gave for a failed join, for the menu to show. */
export function joinErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg || "unknown error";
}

/** The server refused the join because this page is older than the server's contract: the player must reload (CLIENT_OUT_OF_DATE_*). */
export function isClientOutOfDate(err: unknown): boolean {
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  return code === CLIENT_OUT_OF_DATE_CODE || joinErrorMessage(err).includes(CLIENT_OUT_OF_DATE_MESSAGE);
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

/**
 * Leaves a room for good and tells the server so (a consented leave): it frees the seat and the profile at once, even
 * once the run is planning or on, where a dropped socket would hold them for the reconnect grace. Falls back to
 * detachRoom when the socket cannot carry the message (mid-reconnect).
 */
export function leaveRoom(room: RaidRoom): void {
  room.removeAllListeners();
  room.reconnection.enabled = false;
  // A send on a socket that is not open throws inside leave()'s promise: it surfaces as a rejection.
  room.leave(true).catch(() => detachRoom(room));
}

export async function joinRaid(options: JoinOptions): Promise<RaidRoom> {
  client ??= new Client(serverEndpoint());
  // A seat reserved in the instant a run starts is refused ("raid already started");
  // the next joinOrCreate lands in a fresh lobby.
  for (let attempt = 0; ; attempt++) {
    try {
      const room = await client.joinOrCreate<RaidState>(ROOM_NAME, withPageFacts(options));
      tuneReconnection(room);
      return room;
    } catch (err) {
      if (attempt >= 2 || !/(raid|run) already started/i.test(joinErrorMessage(err))) throw err;
    }
  }
}

/**
 * A training room: always created fresh (never matched with other players), private, one seat. Nothing in it is recorded:
 * no results, no GV, no stats. `faction` is the hub pick, if any.
 */
export async function joinTraining(options: Omit<JoinOptions, "mode">): Promise<RaidRoom> {
  client ??= new Client(serverEndpoint());
  // The server's "training" handler forces the mode; nothing the client sends decides it.
  const room = await client.create<RaidState>(TRAINING_ROOM_NAME, withPageFacts(options));
  tuneReconnection(room);
  return room;
}

/**
 * Asks for the seat a lost connection left behind (the room's `reconnectionToken`, "roomId:token"). A new Room comes back, which
 * the caller wires up like a fresh join. Rejects while the server has not (yet) put the seat in its reconnect wait, or after it ended.
 */
export async function reconnectRaid(token: string): Promise<RaidRoom> {
  client ??= new Client(serverEndpoint());
  const room = await client.reconnect<RaidState>(token);
  tuneReconnection(room);
  return room;
}

/** WebSocket.readyState OPEN. */
const WS_OPEN = 1;

/**
 * The bytes the room's socket still holds for the network (WebSocket.bufferedAmount): above 0 for a while means the uplink is
 * stalled and what is sent now arrives later, in a burst. The SDK keeps the socket on its transport (`connection.transport.ws`,
 * WebSocketTransport; another transport has none) and a reconnect builds a new one, so it is looked up on every call. Undefined
 * when there is no open socket to read.
 */
export function socketBufferedBytes(room: RaidRoom): number | undefined {
  const ws = (room.connection?.transport as unknown as { ws?: { readyState?: number; bufferedAmount?: number } } | undefined)?.ws;
  if (!ws || ws.readyState !== WS_OPEN) return undefined;
  const n = ws.bufferedAmount;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

const outbound = new MessageMeter();

/** Messages sent in the last second (the streams back off near the server's cap: net/uplinkPace.ts). */
export function outboundPerSecond(now: number): number {
  return outbound.perSecond(now);
}

/** Typed input sender: the only way the client talks to the sim. */
export function sendInput<K extends keyof ClientMessages>(room: RaidRoom, type: K, payload: ClientMessages[K]): void {
  outbound.note(performance.now());
  room.send(type, payload);
}

import { Client, type Room } from "@colyseus/sdk";
import { ROOM_NAME, SERVER_PORT, type ClientMessages, type JoinOptions } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";

export type RaidRoom = Room<any, RaidState>;

export function serverEndpoint(): string {
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  return fromEnv ?? `${location.protocol}//${location.hostname}:${SERVER_PORT}`;
}

let client: Client | null = null;

/** Server keeps a dropped seat for RECONNECT_SECONDS (10s); give up a little before that. */
function tuneReconnection(room: RaidRoom): void {
  room.reconnection.maxRetries = 6; // ≈0.2+0.6+1.4+2+2+2 s with the 2 s cap
  room.reconnection.maxDelay = 2000;
  // Inputs typed while disconnected are stale by the time we're back; drop them.
  room.reconnection.maxEnqueuedMessages = 0;
}

export async function joinRaid(options: JoinOptions): Promise<RaidRoom> {
  client ??= new Client(serverEndpoint());
  // A seat reserved in the instant a raid starts is refused ("raid already started");
  // the next joinOrCreate lands in a fresh lobby.
  for (let attempt = 0; ; attempt++) {
    try {
      const room = await client.joinOrCreate<RaidState>(ROOM_NAME, options);
      tuneReconnection(room);
      return room;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= 2 || !msg.includes("raid already started")) throw err;
    }
  }
}

/** Typed input sender: the only way the client talks to the sim. */
export function sendInput<K extends keyof ClientMessages>(room: RaidRoom, type: K, payload: ClientMessages[K]): void {
  room.send(type, payload);
}

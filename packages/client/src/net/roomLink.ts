// The room's socket as the liveness code sees it: the SDK's reconnection settings, the forced drop of a socket that carries nothing,
// and the link net/linkWatch.ts watches. No build environment is read here (connection.ts has the endpoints), so
// packages/server/bench/dropHarness.ts runs exactly this code against a real server.
import type { Room } from "@colyseus/sdk";
import type { RaidState } from "@raid/shared/schema";
import type { LinkRoom } from "./linkWatch";

type RaidRoom = Room<any, RaidState>;

/**
 * Server keeps a dropped seat for RECONNECT_SECONDS (20 s); give up a little before that. A server that has not noticed the drop yet
 * refuses the token and the SDK stops at once: main.ts then keeps asking with the stored token (net/rejoin.ts).
 */
export function tuneReconnection(room: RaidRoom): void {
  room.reconnection.maxRetries = 10; // ≈0.2+0.6+1.4+2x7 s ≈ 16 s with the 2 s cap
  room.reconnection.maxDelay = 2000;
  // Inputs typed while disconnected are stale by the time we're back; drop them.
  room.reconnection.maxEnqueuedMessages = 0;
}

/** The close code the SDK reads as "a drop, reconnect" (CloseCode.MAY_TRY_RECONNECT). */
const CLOSE_MAY_TRY_RECONNECT = 4010;

/**
 * Treats the room's socket as dead: the SDK's own close path runs at once (onDrop, then its reconnect attempts), without waiting
 * for a half-open socket's close handshake, which a browser may never finish. The old socket's late events are cut off first, so they
 * cannot drop the new one.
 */
export function forceDrop(room: RaidRoom): void {
  const conn = room.connection as unknown as { transport?: { ws?: { onclose: unknown; onmessage: unknown; onerror: unknown; close(code?: number, reason?: string): void } }; events?: { onclose?: (e: { code: number; reason: string }) => void } } | undefined;
  const ws = conn?.transport?.ws;
  const onclose = conn?.events?.onclose;
  if (!ws || !onclose) return;
  ws.onclose = null;
  ws.onmessage = null;
  ws.onerror = null;
  try { ws.close(CLOSE_MAY_TRY_RECONNECT, "no data"); } catch { /* already closed */ }
  onclose({ code: CLOSE_MAY_TRY_RECONNECT, reason: "no data from the server" });
}

/** What net/linkWatch.ts needs of this room. */
export function linkOf(room: RaidRoom): LinkRoom {
  return {
    isOpen: () => room.connection?.isOpen === true,
    isReconnecting: () => room.reconnection?.isReconnecting === true,
    send: (n) => room.send("beat", { n }),
    drop: () => forceDrop(room),
    onInbound: (cb) => {
      room.onStateChange(cb);
      return () => room.onStateChange.remove(cb);
    },
  };
}

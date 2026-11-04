// The client's half of liveness: a `beat` to the server every HEARTBEAT_MS (the server drops a client that is silent for
// LIVENESS_TIMEOUT_MS, since a proxy can answer protocol pings for a browser that is gone), and a watch on what comes back: no patch
// for CLIENT_STALL_MS on a socket that claims to be open means it is half-open, so the client drops it itself and lets the SDK reconnect.
import { CLIENT_STALL_MS, HEARTBEAT_MS } from "@raid/shared";

/**
 * How often a room in hand makes one plain HTTP request through the hosting front (`LinkRoom.keepAlive`). Cloudflare stops an
 * idle game container after the coordinator's inactivity timeout (10 min), and only requests the coordinator handles are known to
 * count as activity: an open WebSocket may not. Well inside the timeout, and cheap (one small GET a player every few minutes).
 */
export const KEEPALIVE_MS = 3 * 60_000;

/** True when nothing has arrived for the stall limit. */
export function linkStalled(now: number, lastInboundAt: number, stallMs = CLIENT_STALL_MS): boolean {
  return now - lastInboundAt > stallMs;
}

/** What the watch needs of a room; connection.ts builds it for the real one. */
export interface LinkRoom {
  /** The socket is open for sending. */
  isOpen(): boolean;
  /** The SDK is already retrying. */
  isReconnecting(): boolean;
  send(n: number): void;
  /** Close the socket as dead and let the reconnect begin. */
  drop(): void;
  /** Called on every patch; returns how to stop listening. */
  onInbound(cb: () => void): () => void;
  /** One plain request through the hosting front, every KEEPALIVE_MS while the watch runs (absent: none). Must not throw. */
  keepAlive?(): void;
}

export class LinkWatch {
  private timer: ReturnType<typeof setInterval> | null = null;
  private unbind: (() => void) | null = null;
  private lastInbound: number;
  private n = 0;
  private lastBeat = -Infinity;
  private lastKeepAlive = 0;
  /** When the interval last ran: a much longer gap means this page's thread was blocked or its timers throttled. */
  private lastTick = 0;
  /** Off while the room is still loading (the map, the scene): beats only, since a drop there has no handler to recover it. */
  private judgeStalls = true;

  constructor(private readonly link: LinkRoom, private readonly now: () => number = () => performance.now()) {
    this.lastInbound = now();
  }

  /** `stalls: false` beats without judging the socket (see armStalls). */
  start(opts: { stalls?: boolean } = {}): void {
    this.judgeStalls = opts.stalls ?? true;
    if (this.timer) return;
    this.lastInbound = this.now();
    this.lastTick = this.lastInbound;
    this.lastKeepAlive = this.lastInbound;
    // A hidden tab's timers can be throttled to once a minute, but its socket events are not: a patch also carries the beat.
    this.unbind = this.link.onInbound(() => {
      this.lastInbound = this.now();
      if (this.lastInbound - this.lastBeat >= HEARTBEAT_MS) this.beat(this.lastInbound);
    });
    this.timer = setInterval(() => this.tick(), HEARTBEAT_MS);
  }

  /** From now on a socket that carries nothing for the stall limit is dropped (the scene is up and handles a drop). */
  armStalls(): void {
    if (this.judgeStalls) return;
    this.judgeStalls = true;
    this.lastInbound = this.now();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unbind?.();
    this.unbind = null;
  }

  private tick(): void {
    const now = this.now();
    const gap = now - this.lastTick;
    this.lastTick = now;
    // Before the reconnect check: a seat waiting for its reconnect is a container that must stay up too.
    if (this.link.keepAlive && now - this.lastKeepAlive >= KEEPALIVE_MS) {
      this.lastKeepAlive = now;
      try { this.link.keepAlive(); } catch { /* a missed one is harmless */ }
    }
    // The SDK is at it already (or the socket is between attempts): nothing to send, and the silence is not new evidence.
    if (this.link.isReconnecting() || !this.link.isOpen()) { this.lastInbound = now; return; }
    if (now - this.lastBeat >= HEARTBEAT_MS / 2) this.beat(now);
    // After a long task (a bake, a GC, a slow device) or a throttled background timer, this callback can run before the socket
    // events that queued up meanwhile: the silence is the page's own, not the link's. Judge again once they have had their turn.
    if (gap > 2 * HEARTBEAT_MS) { this.lastInbound = now; return; }
    if (this.judgeStalls && linkStalled(now, this.lastInbound)) {
      this.lastInbound = now;
      this.link.drop();
    }
  }

  private beat(now: number): void {
    this.lastBeat = now;
    try { this.link.send(this.n++ & 0xffff); } catch { /* a socket that cannot send is the stall's to find */ }
  }
}

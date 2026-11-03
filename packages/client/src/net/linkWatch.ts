// The client's half of liveness: a `beat` to the server every HEARTBEAT_MS (the server drops a client that is silent for
// LIVENESS_TIMEOUT_MS, since a proxy can answer protocol pings for a browser that is gone), and a watch on what comes back: no patch
// for CLIENT_STALL_MS on a socket that claims to be open means it is half-open, so the client drops it itself and lets the SDK reconnect.
import { CLIENT_STALL_MS, HEARTBEAT_MS } from "@raid/shared";

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
}

export class LinkWatch {
  private timer: ReturnType<typeof setInterval> | null = null;
  private unbind: (() => void) | null = null;
  private lastInbound: number;
  private n = 0;
  private lastBeat = -Infinity;

  constructor(private readonly link: LinkRoom, private readonly now: () => number = () => performance.now()) {
    this.lastInbound = now();
  }

  start(): void {
    if (this.timer) return;
    this.lastInbound = this.now();
    // A hidden tab's timers can be throttled to once a minute, but its socket events are not: a patch also carries the beat.
    this.unbind = this.link.onInbound(() => {
      this.lastInbound = this.now();
      if (this.lastInbound - this.lastBeat >= HEARTBEAT_MS) this.beat(this.lastInbound);
    });
    this.timer = setInterval(() => this.tick(), HEARTBEAT_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unbind?.();
    this.unbind = null;
  }

  private tick(): void {
    const now = this.now();
    // The SDK is at it already (or the socket is between attempts): nothing to send, and the silence is not new evidence.
    if (this.link.isReconnecting() || !this.link.isOpen()) { this.lastInbound = now; return; }
    if (now - this.lastBeat >= HEARTBEAT_MS / 2) this.beat(now);
    if (linkStalled(now, this.lastInbound)) {
      this.lastInbound = now;
      this.link.drop();
    }
  }

  private beat(now: number): void {
    this.lastBeat = now;
    try { this.link.send(this.n++ & 0xffff); } catch { /* a socket that cannot send is the stall's to find */ }
  }
}

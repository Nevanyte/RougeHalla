// A TCP-faithful network simulator for netcode testing: what a websocket through a tunnel and the open internet does to
// messages. Not part of the sim (it patches Colyseus's transport and room, and never runs in tests unless a test installs it).
//
// One FIFO per connection and per direction. A message is delivered at max(the previous delivery, now + rtt/2 + jitter): a
// message never overtakes an earlier one, because a TCP stream delivers in order. The jitter is right-skewed (exponential:
// most messages are close to the base delay, a few are much later). Loss does not drop anything over a websocket, it stalls:
// a lost segment is retransmitted after a retransmission timeout, and since the stream is ordered everything behind it waits
// for it (head-of-line blocking), then arrives in one burst. So with probability `lossPct` a message is delayed by an extra
// RTO (doubling for each further loss of its retransmission), and the FIFO delays whatever follows.
//
// `rttMs` is the minimum round trip (the propagation); the jitter is queueing on top of it, so the mean RTT a ping measures is
// rttMs + 2 x jitterMs, and head-of-line blocking adds to that.
import { Room } from "@colyseus/core";
import { WebSocketClient } from "@colyseus/ws-transport";
import { mulberry32, type Rng } from "@raid/shared";

export interface NetSimParams {
  /** Minimum round-trip time in ms (COLYSEUS_LATENCY); half of it each way. */
  rttMs: number;
  /** Mean of the exponential extra delay per message, per direction (NET_JITTER_MS). */
  jitterMs: number;
  /** Chance per message (percent) that it needs a retransmission (NET_LOSS_PCT). */
  lossPct: number;
  /** Seeds the jitter and loss draws (NET_SEED), for repeatable runs. */
  seed?: number;
}

export function netSimEnabled(p: NetSimParams): boolean {
  return p.rttMs > 0 || p.jitterMs > 0 || p.lossPct > 0;
}

/** The smallest retransmission timeout (Linux: 200 ms). */
export const MIN_RTO_MS = 200;
/** A message whose retransmission is lost again waits this many more doubled timeouts at most (keeps a 100% setting finite). */
const MAX_RETRIES = 4;

/** Delivery times of one direction of one connection. */
export class LinkModel {
  private last = 0;

  constructor(private readonly p: NetSimParams, private readonly rng: Rng) {}

  /** The retransmission timeout this link would use. */
  get rto(): number {
    return Math.max(MIN_RTO_MS, this.p.rttMs + 4 * this.p.jitterMs);
  }

  /** When a message handed over at `now` arrives. Never earlier than the previous one: the stream is ordered. */
  deliveryAt(now: number): number {
    let at = now + this.p.rttMs / 2;
    if (this.p.jitterMs > 0) at += -this.p.jitterMs * Math.log(1 - this.rng());
    if (this.p.lossPct > 0) {
      let rto = this.rto;
      for (let i = 0; i < MAX_RETRIES && this.rng() * 100 < this.p.lossPct; i++) {
        at += rto;
        rto *= 2;
      }
    }
    if (at < this.last) at = this.last;
    this.last = at;
    return at;
  }
}

export interface Clock {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => performance.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
};

/** A FIFO that hands each item to `deliver` at the time its link says, in order. */
export class DelayLine {
  private queue: Array<{ at: number; run: () => void }> = [];
  private timer: unknown = null;
  private disposed = false;

  constructor(private readonly link: LinkModel, private readonly clock: Clock = realClock) {}

  get pending(): number { return this.queue.length; }

  push(run: () => void): void {
    if (this.disposed) return;
    this.queue.push({ at: this.link.deliveryAt(this.clock.now()), run });
    if (this.timer === null) this.arm();
  }

  /** Drops everything still in flight (the connection is gone). */
  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    if (this.timer !== null) this.clock.clearTimer(this.timer);
    this.timer = null;
  }

  private arm(): void {
    const head = this.queue[0];
    if (!head) return;
    this.timer = this.clock.setTimer(() => this.drain(), Math.max(0, head.at - this.clock.now()));
  }

  private drain(): void {
    this.timer = null;
    const now = this.clock.now();
    // Everything due goes out in this pass, in order: after a stalled message the ones behind it arrive together.
    while (this.queue.length > 0 && this.queue[0]!.at <= now) {
      const item = this.queue.shift()!;
      try { item.run(); } catch (err) { console.error("[netsim] delivery failed:", err); }
      if (this.disposed) return;
    }
    if (this.queue.length > 0) this.arm();
  }
}

interface Link { down: DelayLine; up: DelayLine }

type RawFn = (this: WebSocketClient, data: ArrayLike<number>, options?: unknown, cb?: (err?: Error) => void) => void;
type LeaveFn = (this: WebSocketClient, code?: number, data?: string) => void;
type OnMessageFn = (this: unknown, client: { ref: object }, buffer: Uint8Array) => void;

/**
 * Puts the model between every client and every room: the server's sends (`WebSocketClient.raw`, and `leave`, which is a
 * close frame behind the data) and the messages it receives (`Room._onMessage`). Colyseus's own COLYSEUS_LATENCY handling is a
 * fixed delay patched in at the same two places: it must be off (index.ts removes the variable), or the two would stack.
 * Returns the function that takes it out again (messages already in flight still arrive).
 */
export function installNetSim(params: NetSimParams, clock: Clock = realClock): () => void {
  // Two installs would wrap each other's patches (the second would take the first's wrapper for the original).
  uninstallCurrent?.();
  const rng = mulberry32(params.seed ?? Date.now() >>> 0);
  const links = new WeakMap<object, Link>();
  let active = true;

  const linkOf = (ref: object): Link => {
    let l = links.get(ref);
    if (!l) {
      l = { down: new DelayLine(new LinkModel(params, rng), clock), up: new DelayLine(new LinkModel(params, rng), clock) };
      links.set(ref, l);
      (ref as { once?: (ev: string, fn: () => void) => void }).once?.("close", () => {
        // What is queued towards a closed socket is moot; what the client sent before it closed has still arrived.
        l!.down.dispose();
      });
    }
    return l;
  };

  const proto = WebSocketClient.prototype as unknown as { raw: RawFn; leave: LeaveFn };
  const roomProto = Room.prototype as unknown as { _onMessage: OnMessageFn };
  const originalRaw = proto.raw;
  const originalLeave = proto.leave;
  const originalOnMessage = roomProto._onMessage;

  proto.raw = function (data, options, cb) {
    if (!active) return originalRaw.call(this, data, options, cb);
    const ref = this.ref as object;
    // Copied: the encoder may reuse the buffer before the delivery runs.
    const copy = Uint8Array.from(data);
    linkOf(ref).down.push(() => { if (this.ref === ref) originalRaw.call(this, copy, options, cb); });
  };
  proto.leave = function (code, data) {
    if (!active) return originalLeave.call(this, code, data);
    const ref = this.ref as object;
    // A close frame queues behind the data already sent, like on a real stream.
    linkOf(ref).down.push(() => { if (this.ref === ref) originalLeave.call(this, code, data); });
  };
  roomProto._onMessage = function (client, buffer) {
    // Rooms bound this function when their client joined: once it is uninstalled it must pass straight through.
    if (!active) return originalOnMessage.call(this, client, buffer);
    const copy = Buffer.from(buffer);
    linkOf(client.ref).up.push(() => originalOnMessage.call(this, client, copy));
  };

  const uninstall = () => {
    active = false;
    proto.raw = originalRaw;
    proto.leave = originalLeave;
    roomProto._onMessage = originalOnMessage;
    if (uninstallCurrent === uninstall) uninstallCurrent = null;
  };
  uninstallCurrent = uninstall;
  return uninstall;
}

let uninstallCurrent: (() => void) | null = null;

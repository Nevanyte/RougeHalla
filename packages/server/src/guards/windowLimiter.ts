// "At most N in any trailing hour" counters, on the caller's clock (see tokenBucket.ts). Used for new profiles and wrong passcodes.

/** At most `max` events in any trailing `windowMs`. `max` of 0 means no limit. */
export class SlidingWindowLimiter {
  private stamps: number[] = [];

  constructor(readonly max: number, readonly windowMs: number) {}

  /** Whether an event may happen now. */
  allows(now: number): boolean {
    this.prune(now);
    return this.max <= 0 || this.stamps.length < this.max;
  }

  record(now: number): void {
    this.prune(now);
    this.stamps.push(now);
  }

  /** How long until an event would be allowed again (0 when one is allowed now). */
  retryAfterMs(now: number): number {
    this.prune(now);
    if (this.max <= 0 || this.stamps.length < this.max) return 0;
    return Math.max(0, this.stamps[this.stamps.length - this.max]! + this.windowMs - now);
  }

  /** No event inside the window: a map of limiters may forget this one. */
  isEmpty(now: number): boolean {
    this.prune(now);
    return this.stamps.length === 0;
  }

  private prune(now: number): void {
    const from = now - this.windowMs;
    let i = 0;
    while (i < this.stamps.length && this.stamps[i]! <= from) i++;
    if (i > 0) this.stamps = this.stamps.slice(i);
  }
}

/**
 * "At most N in a window", over the whole server and for each client address. Only an event that really happened is
 * recorded (a refused attempt costs nothing), so the maps hold at most what the global cap lets through in a window.
 */
export class AddressWindowLimiter {
  private readonly all: SlidingWindowLimiter;
  private readonly perIp = new Map<string, SlidingWindowLimiter>();

  constructor(maxPerWindow: number, private readonly maxPerIp: number, private readonly windowMs: number) {
    this.all = new SlidingWindowLimiter(maxPerWindow, windowMs);
  }

  /** 0 when `ip` may go ahead now, else how many ms it must wait. */
  retryAfterMs(ip: string, now: number): number {
    return Math.max(this.all.retryAfterMs(now), this.perIp.get(ip)?.retryAfterMs(now) ?? 0);
  }

  record(ip: string, now: number): void {
    this.all.record(now);
    let own = this.perIp.get(ip);
    if (!own) this.perIp.set(ip, (own = new SlidingWindowLimiter(this.maxPerIp, this.windowMs)));
    own.record(now);
    for (const [key, limiter] of this.perIp) if (limiter.isEmpty(now)) this.perIp.delete(key);
  }

  /** Addresses with something recorded in the window, for the tests. */
  get size(): number {
    return this.perIp.size;
  }
}

/** New profiles: a cap over the whole server and one per client address. */
export class NewProfileLimiter extends AddressWindowLimiter {}

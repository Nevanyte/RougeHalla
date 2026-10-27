// Rate limits for a server on a public link. Pure: no timers, no I/O, and the clock is the caller's (`now` in ms), so the
// tests drive them with made-up times and the sim stays out of it (these sit at the network adapter, never in `sim/`).

/**
 * Holds up to `capacity` tokens and gains `perSecond` of them every second. `take` spends one (or `cost`) if there is
 * that much: a burst of up to `capacity` goes through at once, and after that the steady rate is `perSecond`.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(readonly capacity: number, readonly perSecond: number, now: number) {
    this.tokens = capacity;
    this.last = now;
  }

  /** Spends `cost` tokens and returns true, or returns false and spends nothing. */
  take(now: number, cost = 1): boolean {
    this.refill(now);
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }

  /** Nothing spent that has not come back: the bucket is the same as a new one, so a map of them may forget it. */
  isFull(now: number): boolean {
    this.refill(now);
    return this.tokens >= this.capacity;
  }

  private refill(now: number): void {
    const dt = now - this.last;
    // A clock that stepped back mints nothing; it just restarts from there.
    if (dt > 0) this.tokens = Math.min(this.capacity, this.tokens + (dt * this.perSecond) / 1000);
    this.last = now;
  }
}

/** One bucket per key (a profile name). Buckets that have refilled are dropped when the map grows, so it cannot grow without bound. */
export class KeyedTokenBuckets {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
    private readonly sweepAbove = 512,
  ) {}

  take(key: string, now: number): boolean {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.sweepAbove) this.sweep(now);
      bucket = new TokenBucket(this.capacity, this.perSecond, now);
      this.buckets.set(key, bucket);
    }
    return bucket.take(now);
  }

  get size(): number {
    return this.buckets.size;
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) if (bucket.isFull(now)) this.buckets.delete(key);
  }
}

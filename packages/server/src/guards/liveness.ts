/**
 * Who has gone silent (the `beat` message, shared/constants.ts HEARTBEAT_MS). The last time each seated client said anything at
 * all; a client whose last word is older than the timeout is dead as far as the game can tell, whatever the proxy in front of it
 * still answers to a protocol ping.
 */
export class LivenessTracker {
  private readonly lastSeen = new Map<string, number>();

  /** Any message from the client, or its (re)join. */
  touch(sessionId: string, now: number): void {
    this.lastSeen.set(sessionId, now);
  }

  forget(sessionId: string): void {
    this.lastSeen.delete(sessionId);
  }

  /** The sessions among `connected` that have not been heard from for more than `timeoutMs`; one never touched is not silent (it is still joining). */
  silent(connected: Iterable<string>, now: number, timeoutMs: number): string[] {
    const out: string[] = [];
    for (const id of connected) {
      const seen = this.lastSeen.get(id);
      if (seen !== undefined && now - seen > timeoutMs) out.push(id);
    }
    return out;
  }
}

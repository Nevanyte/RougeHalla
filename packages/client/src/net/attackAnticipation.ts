/**
 * Tracks one client-only attack anticipation while the server is deciding the order. It deliberately carries no hit,
 * projectile, cooldown, or damage state: only the local figure's pose may use it.
 */
export const ATTACK_ANTICIPATION_MS = 220;
/** Start partway into the cosmetic pose so the next rendered frame acknowledges the press at once. */
export const ATTACK_ANTICIPATION_INITIAL_PROGRESS = 0.35;

export class AttackAnticipation {
  private until = 0;
  private confirmedUntil = 0;

  get pending(): boolean { return this.until > 0; }

  /** Begin one pressed attack. Repeated input while the same press is awaiting an answer cannot restart its cue. */
  begin(now: number, responseWindowMs: number, startCue: () => void): boolean {
    if (this.pending || now < this.confirmedUntil) return false;
    this.until = now + Math.max(0, responseWindowMs);
    this.confirmedUntil = 0;
    startCue();
    return true;
  }

  /** The authoritative windup, swing, or launch arrived; it will take over the pose when its FX is rendered. */
  confirm(now: number): boolean {
    const wasPending = this.pending;
    this.until = 0;
    // FX can arrive before the render clock reaches its timestamp. Suppress a second local windup during that handoff.
    this.confirmedUntil = now + 300;
    return wasPending;
  }

  /** Expire a refused or lost attack after the expected response window. */
  expire(now: number): boolean {
    if (this.pending && now >= this.until) {
      this.until = 0;
      return true;
    }
    if (this.confirmedUntil > 0 && now >= this.confirmedUntil) this.confirmedUntil = 0;
    return false;
  }

  /** Release, movement, weapon change, cast, death, or scene teardown ends the local-only anticipation. */
  cancel(): boolean {
    const hadState = this.pending || this.confirmedUntil > 0;
    this.until = 0;
    this.confirmedUntil = 0;
    return hadState;
  }

  /** A release stops future repeats, but an already confirmed windup still lands. */
  cancelIfUnconfirmed(): boolean {
    if (!this.pending) return false;
    this.until = 0;
    return true;
  }
}

/** Enough time for the command to reach a 20 Hz server and its response to reach/render locally, bounded on poor links. */
export function attackResponseWindowMs(orderDelayMs: number): number {
  const estimate = 2 * Math.max(0, Number.isFinite(orderDelayMs) ? orderDelayMs : 0) + 150;
  return Math.min(1500, Math.max(250, estimate));
}

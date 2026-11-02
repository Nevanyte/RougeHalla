import type { TimedFx } from "@raid/shared";

export type ConfirmedHit = Extract<TimedFx, { kind: "hit" }>;

const MAX_PENDING = 128;
const STALE_MS = 2000;

interface PendingHit {
  fx: ConfirmedHit;
  receivedAt: number;
}

/**
 * Holds already-authoritative local hit FX until the matching state patch is visible. This only sequences presentation;
 * it never changes health or damage.
 */
export class ConfirmedDamage {
  private pending: PendingHit[] = [];

  enqueue(fx: ConfirmedHit, receivedAt: number): void {
    if (!fx || fx.kind !== "hit" || !Number.isFinite(fx.t) || !Number.isFinite(receivedAt)) return;
    if (this.pending.length >= MAX_PENDING) this.pending.shift();
    this.pending.push({ fx: { ...fx }, receivedAt });
  }

  drain(patchT: number, now: number, present: (fx: ConfirmedHit) => void): void {
    if (this.pending.length === 0 || !Number.isFinite(patchT) || !Number.isFinite(now) || typeof present !== "function") return;

    const keep: PendingHit[] = [];
    const due: ConfirmedHit[] = [];
    for (const item of this.pending) {
      if (now - item.receivedAt > STALE_MS || patchT - item.fx.t > STALE_MS) continue;
      // A timed-out event that is still ahead of the state clock is dropped above, never released early.
      if (patchT < item.fx.t) keep.push(item);
      else due.push(item.fx);
    }
    this.pending = keep;
    for (const fx of due) present(fx);
  }

  reset(): void {
    this.pending = [];
  }
}

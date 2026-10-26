// Picking and showing the attack target. Pure: the scene feeds it where fighters are drawn and where the cursor is.
import { TARGET_SNAP_RADIUS } from "@raid/shared";

export interface TargetPoint { x: number; y: number }
export interface TargetCandidate extends TargetPoint { id: string }

/**
 * The candidate drawn nearest the cursor's ground point, within `radius` (a click that misses by less still locks), or
 * null. A tie goes to the lower id so the pick never depends on iteration order. The server re-checks everything
 * (standing, hostile, range, line of sight), so this only decides what the player meant.
 */
export function pickTarget(cursor: TargetPoint, candidates: Iterable<TargetCandidate>, radius = TARGET_SNAP_RADIUS): string | null {
  let best: string | null = null;
  let bestSq = radius * radius;
  for (const c of candidates) {
    const dx = c.x - cursor.x;
    const dy = c.y - cursor.y;
    const sq = dx * dx + dy * dy;
    if (sq < bestSq || (sq === bestSq && best !== null && c.id < best)) {
      best = c.id;
      bestSq = sq;
    }
  }
  return best;
}

/** How long a lock the player just ordered (or dropped) is shown before the server's own `attackTarget` takes over. */
export const OPTIMISTIC_LOCK_MS = 500;

/**
 * Which fighter to draw as locked. A `target`, `move` or `stop` shows its effect at once (the patch with the new
 * `attackTarget` is a round trip away); once OPTIMISTIC_LOCK_MS has passed the synced value rules, so an order the server
 * refused falls back to whatever it really holds.
 */
export class LockDisplay {
  private id = "";
  private until = 0;

  /** An order was just sent: `id` is the fighter being locked, "" for a move or stop. */
  note(id: string, now: number): void {
    this.id = id;
    this.until = now + OPTIMISTIC_LOCK_MS;
  }

  /** The id to draw as locked at `now`, given the synced `attackTarget` ("" = none). */
  shown(synced: string, now: number): string {
    return now < this.until ? this.id : synced;
  }

  reset(): void {
    this.id = "";
    this.until = 0;
  }
}

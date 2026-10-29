// Picking and showing the attack target. Pure: the scene feeds it where fighters are drawn and where the cursor is.
import { EFFECT_HIDDEN, EFFECT_UNTARGETABLE, TARGET_SNAP_RADIUS } from "@raid/shared";

export interface TargetPoint { x: number; y: number }
export interface TargetCandidate extends TargetPoint { id: string }

/** Companions remain in the arena with their owner; a player's own companion is always friendly. */
export function targetableMob(mob: { kind: string; ownerId?: string }, localId: string, gatesLocked: boolean): boolean {
  return mob.kind !== "quest" && mob.ownerId !== localId && (!gatesLocked || mob.kind === "zombie");
}

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

/**
 * Whether a fighter with these `effects` bits can be clicked, locked or targeted by an ability: not a hidden one (Swarm) and not
 * an untargetable one. The server refuses both anyway; this keeps them out of the cursor's pick, and out of any list of players
 * a map or radar might later show.
 */
export function targetable(effects: number): boolean {
  return (effects & (EFFECT_HIDDEN | EFFECT_UNTARGETABLE)) === 0;
}

/**
 * Why a unit-targeted cast on the picked fighter cannot work, as the line for the slot's deny text, or null when it should go
 * through: out of range (`range` + `slack`, the server's own allowance, on drawn positions), no line of sight (`sight`, when the
 * ability needs it), or the target is still under teleport immunity (`immuneUntil` against the client's estimate of server time,
 * which lags the server's, so a target about to turn vulnerable is called immune: the safe side). The server decides anyway.
 */
export function unitCastDenial(o: {
  from: TargetPoint; to: TargetPoint; range: number; slack: number; los: boolean; sight: (a: TargetPoint, b: TargetPoint) => boolean;
  immuneUntil: number; serverNow: number;
}): string | null {
  if (Math.hypot(o.to.x - o.from.x, o.to.y - o.from.y) > o.range + o.slack) return "Out of range";
  if (o.los && !o.sight(o.from, o.to)) return "No line of sight";
  if (o.serverNow < o.immuneUntil) return "Immune";
  return null;
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

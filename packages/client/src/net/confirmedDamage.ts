import { WEAPONS, type TimedFx } from "@raid/shared";

export type ConfirmedHit = Extract<TimedFx, { kind: "hit" }>;
export type ConfirmedBlock = Extract<TimedFx, { kind: "block" }>;
/** What a ConfirmedDamage queue may hold: a hit, or (the local player's own blows only) a block. */
export type ConfirmedFx = ConfirmedHit | ConfirmedBlock;

const MAX_PENDING = 128;
const STALE_MS = 2000;

interface PendingFx<F extends ConfirmedFx> {
  fx: F;
  receivedAt: number;
}

/**
 * Holds already-authoritative hit (or own-blow block) FX until the matching state patch is visible. This only sequences
 * presentation; it never changes health or damage.
 */
export class ConfirmedDamage<F extends ConfirmedFx = ConfirmedHit> {
  private pending: PendingFx<F>[] = [];

  enqueue(fx: F, receivedAt: number): void {
    if (!fx || (fx.kind !== "hit" && fx.kind !== "block") || !Number.isFinite(fx.t) || !Number.isFinite(receivedAt)) return;
    if (this.pending.length >= MAX_PENDING) this.pending.shift();
    this.pending.push({ fx: { ...fx }, receivedAt });
  }

  drain(patchT: number, now: number, present: (fx: F) => void): void {
    if (this.pending.length === 0 || !Number.isFinite(patchT) || !Number.isFinite(now) || typeof present !== "function") return;

    const keep: PendingFx<F>[] = [];
    const due: F[] = [];
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

/**
 * The local player's own swing landing on another fighter: a hit, or a block by that fighter's shield. Its swing already played
 * on the input clock (localAutos), so the server's confirmation is shown with the state patch that carries it, not a render delay
 * later. Never a projectile's hit or block (its arrow or ball flies in render time and the impact must meet it), damage over
 * time, a signature, an ability, a card's bleed (FxView.hit's `dot`: no weapon, signature or ability), a passive hit or block
 * (damage the local player returned: a riposte, a reflected arrow, Spiked Shell, Final Verdict, Overkill's spill-over; it names the weapon in hand, so
 * only the flag tells it from a blow, and it answers a remote attack still ahead in render time), or anything that lands on the
 * local player.
 */
export function isOwnArcBlow(fx: TimedFx, localId: string): fx is ConfirmedFx {
  if (fx.kind === "hit") {
    if (fx.by !== localId || fx.id === localId || fx.weapon === null || fx.sig !== undefined || fx.ability !== undefined) return false;
    return fx.passive !== true && WEAPONS[fx.weapon]?.shape.kind === "arc";
  }
  if (fx.kind === "block") {
    return fx.by === localId && fx.id !== localId && fx.passive !== true && WEAPONS[fx.weapon]?.shape.kind === "arc";
  }
  return false;
}

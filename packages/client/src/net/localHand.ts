// The local fighter's hand, predicted: which weapon slot the player sees in hand between pressing a swap key and the patch that
// shows it. Presentation and input routing only (nothing it holds is ever sent as an outcome): a click made inside that round
// trip is routed by the weapon the player believes is in hand, and the weapon bar, the held weapon and the range guide follow
// the key at once. The server stays the only authority: every swap is still sent, the server applies the shared `swapAllowed`
// rule (plus the stun and cast refusals), and the first patch that settles the question replaces the guess.
//
// A prediction is made only when the client expects the server to take the swap (RaidScene.swapHand checks), and it ends:
//   confirmed  a patch shows the predicted slot (the common case: the prediction was right)
//   refused    a patch stamped after the swap should have been applied (applyAt + SWAP_SETTLE_SLACK_MS) still shows another slot,
//              and a patch since the press showed the stun or casting bit: what refuses a swap and could land unseen while it was
//              in flight. The display snaps back at that patch, not at the long expiry. Without that evidence a swap that is merely
//              late (a jitter spike, a retransmit) is waited for: timing alone never refuses it.
//   expired    no patch settled it within ORDER_EXPIRE_MS (patches stalled, or a refusal the bits do not show)
// Pure: no Phaser, no clocks of its own (the caller passes performance time and the estimated server time).
import { EFFECT_CASTING, EFFECT_STUNNED, FISTS, isWeaponId, swapReadyAt, TICK_MS, type WeaponId } from "@raid/shared";
import { DELAY_MAX_MS, ORDER_EXPIRE_MS } from "./localMotion";

/**
 * How long after the swap should have been applied a patch may still show the old slot before the swap counts as refused (and
 * then only with a stun or cast showing since the press). The order delay is a running average, so the real application time
 * jitters around `applyAt`; a late swap judged refused would flicker, so this is generous (a refusal is an exception and
 * snapping back one patch later costs nothing).
 */
export const SWAP_SETTLE_SLACK_MS = 100;

export type HandVerdict = "none" | "pending" | "confirmed" | "refused" | "expired";

/** The fields of the local fighter's hands the helpers read (PlayerState has them). */
export interface HandFields {
  weapon0: string;
  weapon1: string;
}

interface PendingSwap {
  /** The slot the player asked for. */
  slot: number;
  /** The slot the newest patch showed when the key was pressed. */
  from: number;
  /** Keys pressed since the last patch settled it: more than one and a patch showing the target may be an intermediate step. */
  presses: number;
  /** Performance time of the (latest) press: the hard expiry counts from it. */
  sentAt: number;
  /** Server time of the newest patch when the key was pressed: only a later patch can refuse. */
  patchT: number;
  /** The server time of the patch that first shows the swap: the client clock at the press plus the order delay and a tick. */
  applyAt: number;
  settleAt: number;
  /** A patch since the press showed the fighter stunned or casting, so the server may have refused the swap. */
  blocked: boolean;
}

export class LocalHand {
  private pending: PendingSwap | null = null;
  /** How the predictions ended since the last reset (dev tooling and the probes read it). */
  readonly counts = { confirmed: 0, refused: 0, expired: 0 };

  /** A swap is predicted and no patch has settled it. */
  get predicting(): boolean {
    return this.pending !== null;
  }

  /** The server time the predicted swap is applied at (0 when none): the patch stamped from then on shows it. */
  get applyAt(): number {
    return this.pending?.applyAt ?? 0;
  }

  /** The slot to treat as in hand: the predicted one while a swap is pending, else the server's. */
  slotOf(serverSlot: number): number {
    return this.pending ? this.pending.slot : serverSlot;
  }

  /**
   * The player pressed a key that the client expects the server to take. `c` is the client clock (the estimated server time now),
   * `delay` the order delay estimate (`LocalMotion.delay`) and `delayKnown` whether an ack has measured it, `serverSlot` and
   * `patchT` the newest patch. A press while one is pending replaces it: a double tap ends on the second slot asked for, and the
   * first patch, which shows the first swap and not the second, is not mistaken for the answer.
   */
  predict(slot: number, serverSlot: number, patchT: number, now: number, c: number, delay: number, delayKnown = true): void {
    const applyAt = c + Math.max(delay, 0) + TICK_MS;
    // An unmeasured delay is LocalMotion's one-tick guess (a new scene, a reconnect): settle as late as any delay it would measure.
    const settleAt = (delayKnown ? applyAt : c + DELAY_MAX_MS + TICK_MS) + SWAP_SETTLE_SLACK_MS;
    const p = this.pending;
    this.pending = {
      slot, from: p ? p.from : serverSlot, presses: p ? p.presses + 1 : 1, sentAt: now, patchT, applyAt, settleAt,
      blocked: p?.blocked ?? false,
    };
  }

  /**
   * A patch (stamped `patchT`, showing `serverSlot`; `blocked` = its stun or casting bit) arrived, or a frame passed with the
   * newest one. Settles the prediction when the patch can: it shows the slot asked for, it is old enough that the swap would have
   * been applied and a stun or cast since the press explains why it still shows another (refused), or too long has passed (`now`
   * is performance time). Idempotent for one patch.
   */
  observe(serverSlot: number, patchT: number, now: number, blocked = false): HandVerdict {
    const p = this.pending;
    if (!p) return "none";
    // After one press the target differs from where the hand was, so a patch showing it is the swap taking effect. After
    // several, the first swap's patch shows an intermediate slot that may equal the last target: wait for the settle time.
    if (p.presses === 1 && serverSlot === p.slot) return this.end("confirmed");
    if (patchT > p.patchT) {
      if (blocked) p.blocked = true;
      if (patchT >= p.settleAt && serverSlot === p.slot) return this.end("confirmed");
      if (patchT >= p.settleAt && p.blocked) return this.end("refused");
    }
    if (now >= p.sentAt + ORDER_EXPIRE_MS) return this.end("expired");
    return "pending";
  }

  clear(): void {
    this.pending = null;
  }

  reset(): void {
    this.pending = null;
    this.counts.confirmed = 0;
    this.counts.refused = 0;
    this.counts.expired = 0;
  }

  private end(verdict: "confirmed" | "refused" | "expired"): HandVerdict {
    this.pending = null;
    this.counts[verdict]++;
    return verdict;
  }
}

/** The synced bits under which the server refuses a swap (`actionBlocked`: stunned, or casting a cast with a cast time). */
export function swapBlocked(effects: number): boolean {
  return (effects & (EFFECT_STUNNED | EFFECT_CASTING)) !== 0;
}

/** What `slot` fights with, as the server's `slotWeapon` reads it: the weapon in it, fists for an empty slot or an unknown id. */
export function weaponInSlot(hand: HandFields, slot: number): WeaponId {
  const id = slot === 1 ? hand.weapon1 : hand.weapon0;
  return isWeaponId(id) ? id : FISTS;
}

/** The ready time the server will hold once it applies a swap at `applyAt` (shared cooldown still running, plus the swap time). */
export function predictedReadyAt(readyAt: number, applyAt: number): number {
  return swapReadyAt(readyAt, applyAt);
}

// The potion key (E) on the local side. Presentation only: the press is checked against the server's own rule and words
// (shared `potionRefusal`, POTION_REFUSALS) so a press the server would refuse says why at once and is not sent, and a press it
// will take shows at once in the HUD's counters (the stock down, one more healing) until the patch shows it. `useConsumable`
// carries no order number, so a press is matched by the patch's stock falling (oldest first), a refusal toast, or
// ORDER_EXPIRE_MS, whichever comes first; the synced state stays the truth.
import { CONSUMABLES, POTION_HEAL_MS, POTION_REFUSALS, potionRefusal } from "@raid/shared";
import { ORDER_EXPIRE_MS } from "./localMotion";

/** The synced fields of the local player the potion rule reads. */
export interface PotionFighter {
  hp: number;
  maxHp: number;
  potionLarge: number;
  potionSmall: number;
  potionsHealing: number;
  healingUntil: number;
}

/** What the weapon bar draws while a press is unanswered: the stock and the healing as they will be. */
export interface PotionView { large: number; small: number; healing: number; healingUntil: number }

export type PotionPress = { deny: string } | { color: number; large: boolean };

interface Pending { large: boolean; expires: number; healingUntil: number }

export class PotionCue {
  private readonly pending: Pending[] = [];
  /** The stock the last patch showed (-1: none seen yet). */
  private lastTotal = -1;
  private readonly scratch: PotionView = { large: 0, small: 0, healing: 0, healingUntil: 0 };

  /**
   * E was pressed at `now` (client clock), the server's time being `serverNow`. `blocked`: the server will find the fighter stunned
   * or casting. Answers the refusal text, or the colour of the potion that will be drunk (the large one first, as the server picks).
   */
  press(me: PotionFighter, blocked: boolean, now: number, serverNow: number): PotionPress {
    this.prune(now);
    const left = this.left(me);
    const deny = potionRefusal({
      actionBlocked: blocked, healing: (me.potionsHealing ?? 0) + this.pending.length, hp: me.hp, maxHp: me.maxHp,
      large: left.large, small: left.small,
    });
    if (deny) return { deny };
    const large = left.large > 0;
    this.pending.push({ large, expires: now + ORDER_EXPIRE_MS, healingUntil: serverNow + POTION_HEAL_MS });
    return { color: CONSUMABLES[large ? "potionLarge" : "potionSmall"].color, large };
  }

  /** A patch arrived: the presses its stock shows drunk are answered, oldest first. */
  reconcile(me: PotionFighter, now: number): void {
    const total = (me.potionLarge ?? 0) + (me.potionSmall ?? 0);
    if (this.lastTotal >= 0 && total < this.lastTotal) this.pending.splice(0, Math.min(this.lastTotal - total, this.pending.length));
    this.lastTotal = total;
    this.prune(now);
  }

  /** A server toast: one of the potion refusals answers the oldest press. */
  noteToast(text: string): void {
    if (this.pending.length > 0 && POTION_REFUSALS.includes(text)) this.pending.shift();
  }

  reset(): void {
    this.pending.length = 0;
    this.lastTotal = -1;
  }

  /** How many presses wait for their answer. */
  get waiting(): number {
    return this.pending.length;
  }

  /** The counters as they will be once the presses in flight land, or undefined when none is (the synced state is then the picture). */
  view(me: PotionFighter, now: number): PotionView | undefined {
    this.prune(now);
    if (this.pending.length === 0) return undefined;
    const left = this.left(me);
    const v = this.scratch;
    v.large = left.large;
    v.small = left.small;
    v.healing = (me.potionsHealing ?? 0) + this.pending.length;
    v.healingUntil = me.healingUntil ?? 0;
    for (const p of this.pending) if (p.healingUntil > v.healingUntil) v.healingUntil = p.healingUntil;
    return v;
  }

  /** The stock with the presses in flight taken off it. */
  private left(me: PotionFighter): { large: number; small: number } {
    let large = me.potionLarge ?? 0;
    let small = me.potionSmall ?? 0;
    for (const p of this.pending) {
      if (p.large) large--;
      else small--;
    }
    return { large: Math.max(0, large), small: Math.max(0, small) };
  }

  private prune(now: number): void {
    while (this.pending.length > 0 && now >= this.pending[0]!.expires) this.pending.shift();
  }
}

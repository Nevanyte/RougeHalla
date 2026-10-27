// Quest lifecycle toasts, folded before they reach the 3-slot toast stack (ui/toast.ts drops the OLDEST when a fourth comes, and
// a turn-in already brings the "+N GV (quest)" line and the card news): the server announces a completion once, to everyone,
// and batches the offers that close in one tick into one line, and this is the client's own guard on both, so a second line
// for the same event (an older server's private "Quest complete" next to the public announcement, or several expiry lines in
// one burst) never evicts the GV toast. Pure apart from the timer, which a test injects.

export const QUEST_TOAST_WINDOW_MS = 150;
/** A completion line is a duplicate of the one just shown for the same offer within this long. */
export const QUEST_TOAST_DUPLICATE_MS = 2000;

const EXPIRED_ONE = /^Quest expired(?:: (.+))?$/;
const EXPIRED_MANY = /^(\d+) quests expired$/;
const COMPLETE_PRIVATE = /^Quest complete: (.+)$/;
const COMPLETE_PUBLIC = /^(.+) completed quest: (.+)$/;

export interface QuestToastTimers {
  set(cb: () => void, ms: number): unknown;
  clear(handle: unknown): void;
  now(): number;
}

const REAL_TIMERS: QuestToastTimers = {
  set: (cb, ms) => setTimeout(cb, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

/** The one line for `count` offers that expired together; `name` is the offer's name when exactly one was named. */
export function expiredToastText(count: number, name: string | null): string {
  if (count <= 1) return name ? `Quest expired: ${name}` : "Quest expired";
  return `${count} quests expired`;
}

export class QuestToasts {
  private expired = 0;
  private expiredName: string | null = null;
  private timer: unknown = null;
  /** Offers whose completion line was shown for the local player, by offer name, and when. */
  private readonly completed = new Map<string, number>();

  constructor(
    private readonly show: (text: string) => void,
    /** The local player's callsign (the public completion line names the completer). */
    private readonly localName: () => string = () => "",
    private readonly timers: QuestToastTimers = REAL_TIMERS,
  ) {}

  /** Every server toast goes through here: quest lines are folded, everything else is shown at once. */
  push(text: string): void {
    const many = EXPIRED_MANY.exec(text);
    const one = many ? null : EXPIRED_ONE.exec(text);
    if (many || one) {
      const n = many ? Number(many[1]) : 1;
      this.expiredName = this.expired === 0 && one ? (one[1] ?? null) : null;
      this.expired += n;
      this.timer ??= this.timers.set(() => this.flush(), QUEST_TOAST_WINDOW_MS);
      return;
    }
    const own = COMPLETE_PRIVATE.exec(text);
    const pub = own ? null : COMPLETE_PUBLIC.exec(text);
    const name = own ? own[1]! : pub && pub[1] === this.localName() && this.localName() !== "" ? pub[2]! : null;
    if (name !== null) {
      const now = this.timers.now();
      const last = this.completed.get(name);
      if (last !== undefined && now - last < QUEST_TOAST_DUPLICATE_MS) return;
      this.completed.set(name, now);
      for (const [key, at] of this.completed) if (now - at >= QUEST_TOAST_DUPLICATE_MS) this.completed.delete(key);
    }
    this.show(text);
  }

  /** Shows the folded expiry line now (the window ended). */
  flush(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    const count = this.expired;
    const name = this.expiredName;
    this.expired = 0;
    this.expiredName = null;
    if (count > 0) this.show(expiredToastText(count, name));
  }

  /** Drops a pending line and what it remembers: the room is gone. */
  reset(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    this.expired = 0;
    this.expiredName = null;
    this.completed.clear();
  }
}

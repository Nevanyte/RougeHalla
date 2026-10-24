// Training room overlay, bottom-left: a "Leave training" button and a short list of controls that fades away. DOM only.
// The scene feeds it the clock (update) and the Esc key (leave); where "leave" goes is the caller's (the hub hand-off).
import "./trainingBar.css";
import { el, uiRoot } from "./dom";

/** What a first-time player needs in the practice room; kept to a few lines. */
export const TRAINING_HINTS: readonly string[] = [
  "Right-click moves, left-click attacks.",
  "Walk to the weapon rack and press F to take a weapon.",
  "Q or 1 / 2 swaps weapons.",
  "Hit the dummies. The shield dummy blocks and reflects.",
];

/** The tips stay this long, then fade out over HINT_FADE_MS (the same value as the transition in trainingBar.css). */
export const HINT_HOLD_MS = 20_000;
export const HINT_FADE_MS = 1_500;

export type HintPhase = "show" | "fade" | "gone";

/** Where the tips are `elapsedMs` after the bar appeared. Dismissing them skips the fade. */
export function hintPhase(elapsedMs: number, dismissed: boolean): HintPhase {
  if (dismissed || elapsedMs >= HINT_HOLD_MS + HINT_FADE_MS) return "gone";
  return elapsedMs >= HINT_HOLD_MS ? "fade" : "show";
}

/** Passes "leave" on at most once, however often it is asked (a double click, a click and Esc); a missing handler never fires. */
export class LeaveLatch {
  private fired = false;

  constructor(private readonly onLeave: (() => void) | undefined) {}

  /** Whether trigger() would still do something. */
  get armed(): boolean {
    return !this.fired && this.onLeave !== undefined;
  }

  /** True the one time the handler was called. Latched before the call, so a handler that throws is not called again. */
  trigger(): boolean {
    if (!this.armed) return false;
    this.fired = true;
    this.onLeave!();
    return true;
  }
}

export class TrainingBar {
  private readonly root = el("div", "training-bar");
  private readonly tips = el("div", "training-tips");
  private readonly leaveButton = el("button", "btn training-leave");
  private readonly leaveLabel = el("span", undefined, "Leave training");
  private readonly leaveKey = el("span", "training-key", "Esc");
  private readonly latch: LeaveLatch;
  /** The clock reading of the first update(); the tips' timer runs from there, so it needs no timer of its own. */
  private startedAt: number | null = null;
  private elapsedMs = 0;
  private dismissed = false;
  private phase: HintPhase = "show";

  /** `onLeave` is only given for a training room; without it the button is not shown and Esc does nothing. */
  constructor(onLeave?: () => void) {
    this.latch = new LeaveLatch(onLeave);

    const list = el("ul");
    for (const hint of TRAINING_HINTS) list.append(el("li", undefined, hint));
    const close = el("button", "training-tips-close", "×");
    close.type = "button";
    close.title = "Hide tips";
    close.setAttribute("aria-label", "Hide tips");
    close.addEventListener("click", () => { this.dismissed = true; this.applyPhase(); });
    this.tips.append(list, close);

    this.leaveButton.type = "button";
    this.leaveButton.append(this.leaveLabel, this.leaveKey);
    this.leaveButton.addEventListener("click", () => this.leave());
    this.leaveButton.hidden = !this.latch.armed;

    this.root.append(this.tips, this.leaveButton);
    uiRoot().append(this.root);
  }

  /** The button's action and Esc's. */
  leave(): void {
    if (!this.latch.armed) return;
    this.leaveButton.disabled = true;
    this.leaveLabel.textContent = "Leaving…";
    this.leaveKey.hidden = true;
    this.latch.trigger();
  }

  /** Once per frame, with the same clock every time (the scene passes performance.now()). */
  update(now: number): void {
    this.startedAt ??= now;
    this.elapsedMs = now - this.startedAt;
    this.applyPhase();
  }

  destroy(): void {
    this.root.remove();
  }

  private applyPhase(): void {
    const phase = hintPhase(this.elapsedMs, this.dismissed);
    if (phase === this.phase) return;
    this.phase = phase;
    this.tips.classList.toggle("fading", phase === "fade");
    this.tips.hidden = phase === "gone";
  }
}

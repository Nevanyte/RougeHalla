// Short server messages ("Too far away", "Nothing to take") stacked bottom-center above the weapon bar, and the local
// player's buff and combo news (a tone only changes how a toast is drawn).
import { el, uiRoot } from "./dom";

/** "buff": a stack drop, "combo": a combo unlocked. Plain toasts have none. */
export type ToastTone = "buff" | "combo";

const MAX_VISIBLE = 3;
/** How long a toast stays fully visible before it starts to fade. */
const HOLD_MS = 1800;
/** Must match the opacity transition on .toast in style.css. */
const FADE_MS = 250;

interface Entry {
  text: string;
  node: HTMLElement;
  fadeTimer: ReturnType<typeof setTimeout>;
  removeTimer: ReturnType<typeof setTimeout> | null;
}

export class Toasts {
  private readonly root = el("div", "toasts");
  /** Oldest first, matching the DOM order. */
  private live: Entry[] = [];

  constructor() {
    uiRoot().append(this.root);
  }

  show(text: string, tone?: ToastTone): void {
    // Mashing a key that fails repeats the same message; extend the existing toast instead of stacking copies.
    const same = this.live.find((e) => e.text === text && e.removeTimer === null);
    if (same) {
      clearTimeout(same.fadeTimer);
      same.fadeTimer = setTimeout(() => this.fade(same), HOLD_MS);
      return;
    }

    while (this.live.length >= MAX_VISIBLE) this.dismiss(this.live[0]!);
    const node = el("div", tone ? `toast ${tone}` : "toast", text);
    const entry: Entry = { text, node, fadeTimer: setTimeout(() => this.fade(entry), HOLD_MS), removeTimer: null };
    this.live.push(entry);
    this.root.append(node);
  }

  clear(): void {
    for (const e of [...this.live]) this.dismiss(e);
  }

  destroy(): void {
    this.clear();
    this.root.remove();
  }

  private fade(entry: Entry): void {
    entry.node.classList.add("fading");
    entry.removeTimer = setTimeout(() => this.dismiss(entry), FADE_MS);
  }

  private dismiss(entry: Entry): void {
    clearTimeout(entry.fadeTimer);
    if (entry.removeTimer) clearTimeout(entry.removeTimer);
    entry.node.remove();
    this.live = this.live.filter((e) => e !== entry);
  }
}

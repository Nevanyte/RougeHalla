// Short server messages ("Too far away", "Nothing to take") stacked bottom-center above the weapon bar, the local
// player's own news, and the client's own error and confirmation lines (a tone only changes how a toast is
// drawn and how long it stays).
import { el, uiRoot } from "./dom";

/** "buff": the local player's own gains (amber; the name predates the cards), "error": something failed (red), "ok": it worked (green). Plain toasts have none. */
export type ToastTone = "buff" | "error" | "ok";

const MAX_VISIBLE = 3;
/** How long a toast stays fully visible before it starts to fade. */
export const HOLD_MS = 1800;
/** An error is read, not glanced at: at least this long, and longer for a long sentence (see holdFor). */
export const ERROR_HOLD_MS = 4000;
const ERROR_HOLD_MAX_MS = 8000;
/** About reading speed for the characters past a short line. */
const ERROR_MS_PER_CHAR = 45;
/** A confirmation ("Reconnected") is short news. */
export const OK_HOLD_MS = 2200;
/** Must match the opacity transition on .toast in style.css. */
export const FADE_MS = 250;

/** How long a toast of this tone and length stays fully visible. */
export function holdFor(text: string, tone?: ToastTone): number {
  if (tone === "error") return Math.min(ERROR_HOLD_MAX_MS, Math.max(ERROR_HOLD_MS, text.length * ERROR_MS_PER_CHAR));
  if (tone === "ok") return OK_HOLD_MS;
  return HOLD_MS;
}

interface Entry {
  text: string;
  tone: ToastTone | undefined;
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
    const same = this.live.find((e) => e.text === text && e.tone === tone && e.removeTimer === null);
    if (same) {
      clearTimeout(same.fadeTimer);
      same.fadeTimer = setTimeout(() => this.fade(same), holdFor(text, tone));
      return;
    }

    while (this.live.length >= MAX_VISIBLE) this.dismiss(this.live[0]!);
    const node = el("div", tone ? `toast ${tone}` : "toast", text);
    const entry: Entry = { text, tone, node, fadeTimer: setTimeout(() => this.fade(entry), holdFor(text, tone)), removeTimer: null };
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

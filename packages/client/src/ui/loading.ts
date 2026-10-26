// The loading screen. index.html ships a static #boot element so there is something on screen before the bundle has
// arrived; this class takes it over (and builds the same markup if it is missing) and reuses it whenever the page waits:
// at start-up and while a room is being joined. It can never stay up: every show() arms a timeout.
import { el } from "./dom";
import "./loading.css";

/** Must match the opacity transition on #boot in loading.css. */
export const FADE_MS = 220;
/** The longest any wait keeps the screen up unless the caller says otherwise. */
export const DEFAULT_TIMEOUT_MS = 12_000;

export interface LoadingOptions {
  /** After this long the screen hides itself and calls `onTimeout`. */
  timeoutMs?: number;
  onTimeout?: () => void;
}

export class LoadingScreen {
  private readonly root: HTMLElement;
  private readonly text: HTMLElement;
  private shown: boolean;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const existing = document.getElementById("boot");
    const existingText = existing ? document.getElementById("boot-text") : null;
    if (existing && existingText) {
      this.root = existing;
      this.text = existingText;
    } else {
      this.text = el("div", "boot-text");
      this.text.id = "boot-text";
      this.root = existing ?? buildScreen(this.text);
      if (existing) existing.append(this.text);
    }
    // index.html's fallback timer reads this: the bundle is running, so the screen is ours to time out.
    this.root.setAttribute("data-ready", "");
    this.shown = !this.root.hidden;
    if (this.shown) this.arm(DEFAULT_TIMEOUT_MS);
  }

  get visible(): boolean {
    return this.shown;
  }

  /** Shows the screen with `text` (or updates it if it is up) and restarts the timeout. */
  show(text: string, options: LoadingOptions = {}): void {
    this.clearFade();
    this.text.textContent = text;
    this.root.hidden = false;
    this.root.classList.remove("is-hiding");
    this.shown = true;
    this.arm(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options.onTimeout);
  }

  setText(text: string): void {
    this.text.textContent = text;
  }

  /** Fades the screen out, then takes it out of the layout. Does nothing when it is not up. */
  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.clearTimeout();
    this.root.classList.add("is-hiding");
    this.fadeTimer = setTimeout(() => {
      this.fadeTimer = null;
      this.root.hidden = true;
    }, FADE_MS);
  }

  private arm(ms: number, onTimeout?: () => void): void {
    this.clearTimeout();
    this.timeoutTimer = setTimeout(() => {
      this.timeoutTimer = null;
      this.hide();
      onTimeout?.();
    }, ms);
  }

  private clearTimeout(): void {
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    this.timeoutTimer = null;
  }

  private clearFade(): void {
    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    this.fadeTimer = null;
  }
}

/** The same markup as the static one in index.html, for a page that does not have it. */
function buildScreen(text: HTMLElement): HTMLElement {
  const root = el("div");
  root.id = "boot";
  const inner = el("div", "boot-inner");
  inner.append(el("div", "boot-title", "RAID"), el("div", "boot-spinner"), text);
  root.append(inner);
  document.body.append(root);
  return root;
}

/** About a minute of frames: a scene that has not drawn by then never will, and the caller's timeout has long fired. */
const WHEN_READY_MAX_FRAMES = 3600;

/**
 * Resolves on the first animation frame after `ready()` is true, checking once per frame. For waiting on "the scene has
 * drawn" without hooking into the engine; it gives up polling after WHEN_READY_MAX_FRAMES (and then never resolves), so callers also hold a timeout.
 */
export function whenReady(
  ready: () => boolean,
  raf: (cb: () => void) => unknown = (cb) => requestAnimationFrame(cb),
  maxFrames = WHEN_READY_MAX_FRAMES,
): Promise<void> {
  return new Promise((resolve) => {
    let frames = 0;
    const check = (): void => {
      if (!ready()) { if (++frames < maxFrames) raf(check); return; }
      // One more frame: the scene was just created, its first render comes after this check.
      raf(() => resolve());
    };
    raf(check);
  });
}

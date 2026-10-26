// Connection state as a small pill at the top centre (toasts live in ui/toast.ts): a spinner while the SDK retries a
// dropped socket, then a short green confirmation when it is back.
import { el, uiRoot } from "./dom";

export const RECONNECTING_TEXT = "Connection lost — reconnecting…";
export const RECONNECTED_TEXT = "Reconnected";
/** How long "Reconnected" stays before the pill goes. */
export const RECONNECTED_MS = 1800;

export type BannerState = "hidden" | "reconnecting" | "reconnected" | "notice";

export class Banner {
  private readonly root = el("div", "banner");
  private readonly icon = el("span", "banner-icon");
  private readonly label = el("span", "banner-text");
  private timer: ReturnType<typeof setTimeout> | null = null;
  state: BannerState = "hidden";

  constructor() {
    this.root.setAttribute("role", "status");
    this.root.append(this.icon, this.label);
  }

  /** The socket dropped and the SDK is retrying. Stays until hide() or reconnected(). */
  reconnecting(text = RECONNECTING_TEXT): void {
    this.present("reconnecting", text, 0);
  }

  /** The socket is back: a brief green pill, then gone. */
  reconnected(text = RECONNECTED_TEXT, ms = RECONNECTED_MS): void {
    this.present("reconnected", text, ms);
  }

  /** Any other short notice; `ms` > 0 removes it after that long. */
  show(text: string, ms = 0): void {
    this.present("notice", text, ms);
  }

  hide(): void {
    this.clearTimer();
    this.state = "hidden";
    this.root.remove();
  }

  private present(state: Exclude<BannerState, "hidden">, text: string, ms: number): void {
    this.clearTimer();
    this.state = state;
    this.root.className = `banner ${state}`;
    this.icon.className = state === "reconnecting" ? "banner-icon spinner" : "banner-icon";
    this.icon.textContent = state === "reconnected" ? "✓" : "";
    this.icon.hidden = state === "notice";
    this.label.textContent = text;
    // Appended only when it is not already up, so a change of state does not replay the entrance animation.
    if (!this.root.isConnected) uiRoot().append(this.root);
    if (ms > 0) this.timer = setTimeout(() => this.hide(), ms);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

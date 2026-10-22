// Small top-center notice for connection state (toasts live in ui/toast.ts).
import { el, uiRoot } from "./dom";

export class Banner {
  private readonly root = el("div", "banner");
  private timer: ReturnType<typeof setTimeout> | null = null;

  show(text: string, ms = 0): void {
    this.root.textContent = text;
    uiRoot().append(this.root);
    if (this.timer) clearTimeout(this.timer);
    this.timer = ms > 0 ? setTimeout(() => this.hide(), ms) : null;
  }

  hide(): void {
    this.root.remove();
  }
}

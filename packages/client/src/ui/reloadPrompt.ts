// What a stale page is shown when the server refuses its join (CLIENT_OUT_OF_DATE_*): it was loaded before a deploy that changed
// the contract, so it would drop what the server now sends. The card stays until the player reloads; the menu's error line and a
// toast say the same in a sentence, this is the way out.
import { el, uiRoot } from "./dom";
import "./reloadPrompt.css";

export const RELOAD_TITLE = "The game was updated";
export const RELOAD_TEXT = "This page was opened before the update, so it can't play with the server any more. Reload to get the new version.";
export const RELOAD_BUTTON = "Reload";

export class ReloadPrompt {
  private readonly root = el("div", "reload-prompt");
  private readonly button = el("button", "btn primary", RELOAD_BUTTON);

  /** `reload` is what the button does (the page's own reload; a test passes a stub). */
  constructor(reload: () => void = () => location.reload()) {
    const card = el("div", "reload-card");
    card.setAttribute("role", "alertdialog");
    card.setAttribute("aria-label", RELOAD_TITLE);
    this.button.type = "button";
    this.button.addEventListener("click", reload);
    card.append(el("div", "reload-title", RELOAD_TITLE), el("div", "reload-text", RELOAD_TEXT), this.button);
    this.root.append(card);
  }

  get shown(): boolean {
    return this.root.isConnected;
  }

  /** Puts the card up (once) and gives the button the keyboard. */
  show(): void {
    if (this.shown) return;
    uiRoot().append(this.root);
    this.button.focus?.();
  }
}

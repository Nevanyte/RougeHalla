// Main menu: profile (callsign) and Start Raid. The stash/loadout UI is added in phase 5.
import { PROFILE_RE } from "@raid/shared";
import { el, uiRoot } from "./dom";

const PROFILE_KEY = "raid.profile";

export function initialProfile(): string {
  const fromUrl = new URLSearchParams(location.search).get("profile");
  if (fromUrl && PROFILE_RE.test(fromUrl)) return fromUrl;
  const saved = sessionStorage.getItem(PROFILE_KEY);
  if (saved && PROFILE_RE.test(saved)) return saved;
  return `op-${Math.random().toString(36).slice(2, 6)}`;
}

export interface MenuHandlers {
  onStart(profile: string): void;
}

export class Menu {
  private readonly root = el("div", "panel menu");
  private readonly input = el("input", "menu-profile");
  private readonly button = el("button", "btn primary", "Start Raid");
  private readonly status = el("div", "menu-status");

  constructor(private readonly handlers: MenuHandlers) {
    this.input.value = initialProfile();
    this.input.maxLength = 16;
    this.input.placeholder = "callsign";
    const row = el("label", "menu-row", "Callsign ");
    row.append(this.input);
    this.root.append(el("h1", undefined, "RAID"), row, this.button, this.status);
    this.button.addEventListener("click", () => this.start());
    this.input.addEventListener("keydown", (e) => { if (e.key === "Enter") this.start(); });
  }

  show(message = ""): void {
    this.setBusy(false);
    this.status.textContent = message;
    uiRoot().append(this.root);
  }

  hide(): void {
    this.root.remove();
  }

  setBusy(busy: boolean, message = ""): void {
    this.button.disabled = busy;
    this.input.disabled = busy;
    if (message) this.status.textContent = message;
  }

  get profile(): string {
    return this.input.value.trim();
  }

  private start(): void {
    const profile = this.profile;
    if (!PROFILE_RE.test(profile)) {
      this.status.textContent = "Callsign: 2–16 letters, digits, _ or -";
      return;
    }
    sessionStorage.setItem(PROFILE_KEY, profile);
    this.handlers.onStart(profile);
  }
}

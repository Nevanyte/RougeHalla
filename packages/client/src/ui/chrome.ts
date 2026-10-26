// The page chrome that lives for the whole session, in the hub, a run and practice alike: a top-right cluster with the
// FPS / ping readout and the fullscreen, settings and help buttons, plus the keys that go with them (Alt+Enter, H, and Esc to
// close a panel). It owns the settings card and the help card, and keeps `html[data-reduced-motion]` in step with the setting.
import type Phaser from "phaser";
import { documentFullscreen, type FullscreenApi } from "../fullscreen";
import type { RaidRoom } from "../net/connection";
import { settings as appSettings, type SettingsStore } from "../settings";
import "./chrome.css";
import { el, uiRoot } from "./dom";
import { HelpOverlay, type HelpScope } from "./helpOverlay";
import { PerfMeter } from "./perfMeter";
import { SettingsPanel, applyReducedMotion, osPrefersReducedMotion, reducedMotionActive } from "./settingsPanel";

/** What chromeKeyAction reads of a KeyboardEvent. */
export interface KeyInfo {
  code: string;
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
}

export type ChromeKeyAction = "fullscreen" | "help" | "close";

/**
 * Which chrome action a key press asks for, if any. Alt+Enter works anywhere, since it is no text. H (no modifiers) and
 * Esc are ignored while the player types; Esc counts only when a panel is open, so it stays the scene's otherwise.
 * Physical keys (`code`), like the scenes' own shortcuts.
 */
export function chromeKeyAction(e: KeyInfo, state: { panelOpen: boolean; typing: boolean }): ChromeKeyAction | null {
  if (e.repeat) return null;
  const ctrlOrMeta = e.ctrlKey || e.metaKey;
  if (e.altKey) return !ctrlOrMeta && (e.code === "Enter" || e.code === "NumpadEnter") ? "fullscreen" : null;
  if (ctrlOrMeta || state.typing) return null;
  if (e.code === "Escape") return state.panelOpen ? "close" : null;
  if (e.code === "KeyH" && !e.shiftKey) return "help";
  return null;
}

const NON_TEXT_INPUTS = new Set(["button", "checkbox", "radio", "range", "color", "file", "image", "reset", "submit"]);

/** A text field the player may be typing in (a range slider or a checkbox is not). Duck-typed, so it needs no DOM globals. */
export function isTypingTarget(node: unknown): boolean {
  if (typeof node !== "object" || node === null) return false;
  const n = node as { tagName?: unknown; isContentEditable?: unknown; type?: unknown };
  if (n.isContentEditable === true) return true;
  const tag = typeof n.tagName === "string" ? n.tagName.toUpperCase() : "";
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  return tag === "INPUT" && !NON_TEXT_INPUTS.has(typeof n.type === "string" ? n.type.toLowerCase() : "text");
}

export interface ChromeOptions {
  /** Not read yet; the chrome is handed the game so it can reach the canvas if it ever needs to. */
  game: Phaser.Game;
  /** The current room, null in the hub. Its ping feeds the readout. */
  room: () => RaidRoom | null;
  /** The settings to follow; the app-wide store unless a test passes its own. */
  settings?: SettingsStore;
  fullscreen?: FullscreenApi;
}

const svg = (body: string): string =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

const ICON_ENTER_FULLSCREEN = svg('<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/>');
const ICON_EXIT_FULLSCREEN = svg('<path d="M2 6h4V2M10 2v4h4M14 10h-4v4M6 14v-4H2"/>');
const ICON_SETTINGS = svg('<path d="M2 4h12M2 8h12M2 12h12"/><circle cx="10" cy="4" r="1.7" fill="currentColor"/><circle cx="5" cy="8" r="1.7" fill="currentColor"/><circle cx="11" cy="12" r="1.7" fill="currentColor"/>');
const ICON_HELP = svg('<circle cx="8" cy="8" r="6.2"/><path d="M6.2 6.3a1.9 1.9 0 1 1 2.7 1.7c-.6.3-.9.7-.9 1.4"/><circle cx="8" cy="11.5" r=".6" fill="currentColor"/>');

interface Focusable {
  focus(options?: { preventScroll?: boolean }): void;
}

export class Chrome {
  private readonly room: () => RaidRoom | null;
  private readonly store: SettingsStore;
  private readonly fullscreen: FullscreenApi;
  private readonly root = el("div", "chrome");
  private readonly perf: PerfMeter;
  private readonly settingsPanel: SettingsPanel;
  private readonly help: HelpOverlay;
  private readonly fullscreenButton = el("button", "chrome-btn");
  private readonly settingsButton = el("button", "chrome-btn");
  private readonly helpButton = el("button", "chrome-btn");
  private readonly unsubscribers: Array<() => void> = [];
  /** What had focus when a panel opened, so closing it hands the focus back. */
  private returnFocus: Focusable | null = null;
  private fullscreenIcon: boolean | null = null;

  constructor(options: ChromeOptions) {
    this.room = options.room;
    this.store = options.settings ?? appSettings;
    this.fullscreen = options.fullscreen ?? documentFullscreen();

    this.perf = new PerfMeter({ room: options.room, settings: this.store });
    this.settingsPanel = new SettingsPanel({ store: this.store, fullscreen: this.fullscreen, onClose: () => this.closePanels() });
    this.help = new HelpOverlay({ onClose: () => this.closePanels() });

    const buttons = el("div", "chrome-buttons");
    this.setupButton(this.fullscreenButton, "Fullscreen", "Fullscreen (Alt+Enter)", () => void this.fullscreen.toggle());
    this.fullscreenButton.setAttribute("aria-pressed", "false");
    this.setupButton(this.settingsButton, "Settings", "Settings", () => this.toggleSettings());
    this.setupButton(this.helpButton, "Help", "Controls (H)", () => this.toggleHelp());
    this.settingsButton.innerHTML = ICON_SETTINGS;
    this.helpButton.innerHTML = ICON_HELP;
    buttons.append(this.fullscreenButton, this.settingsButton, this.helpButton);
    this.root.append(this.perf.element, buttons);
    uiRoot().append(this.root, this.settingsPanel.element, this.help.element);

    this.syncFullscreen();
    this.syncPanelButtons();
    this.syncReducedMotion();
    this.unsubscribers.push(this.fullscreen.onChange(() => this.syncFullscreen()));
    this.unsubscribers.push(this.store.subscribe((_s, changed) => { if (changed.includes("reducedMotion")) this.syncReducedMotion(); }));
    this.watchSystemMotion();
    // Capturing, so Esc can be consumed before the scene's own (bubbling) handler sees it.
    window.addEventListener("keydown", this.onKeyDown, true);
  }

  /** A panel is open. The hub treats it as a modal and stops walking. */
  get modalOpen(): boolean {
    return this.settingsPanel.isOpen || this.help.isOpen;
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown, true);
    for (const off of this.unsubscribers.splice(0)) off();
    this.perf.destroy();
    this.settingsPanel.destroy();
    this.help.element.remove();
    this.root.remove();
  }

  private setupButton(button: HTMLButtonElement, label: string, title: string, onClick: () => void): void {
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", onClick);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const typing = isTypingTarget(e.target) || isTypingTarget(document.activeElement);
    const action = chromeKeyAction(e, { panelOpen: this.modalOpen, typing });
    if (!action) return;
    e.preventDefault();
    if (action === "fullscreen") void this.fullscreen.toggle();
    else if (action === "help") this.toggleHelp();
    else {
      // The key is spent: the scene behind must not also read it (Esc leaves practice).
      e.stopImmediatePropagation();
      this.closePanels();
    }
  };

  private toggleSettings(): void {
    if (this.settingsPanel.isOpen) {
      this.closePanels();
      return;
    }
    this.openPanel(() => { this.help.close(); this.settingsPanel.open(); });
  }

  private toggleHelp(): void {
    if (this.help.isOpen) {
      this.closePanels();
      return;
    }
    const where: HelpScope = this.room() ? "run" : "hub";
    this.openPanel(() => { this.settingsPanel.close(); this.help.open(where); });
  }

  private openPanel(open: () => void): void {
    if (!this.modalOpen) this.returnFocus = document.activeElement as Focusable | null;
    open();
    this.syncPanelButtons();
  }

  private closePanels(): void {
    if (!this.modalOpen) return;
    const active = document.activeElement;
    const focusWasInside = active === null || active === document.body
      || this.settingsPanel.contains(active) || this.help.contains(active);
    this.settingsPanel.close();
    this.help.close();
    this.syncPanelButtons();
    const back = this.returnFocus;
    this.returnFocus = null;
    if (focusWasInside && back && typeof back.focus === "function") back.focus({ preventScroll: true });
  }

  private syncPanelButtons(): void {
    this.settingsButton.setAttribute("aria-expanded", String(this.settingsPanel.isOpen));
    this.helpButton.setAttribute("aria-expanded", String(this.help.isOpen));
  }

  private syncFullscreen(): void {
    const supported = this.fullscreen.supported();
    const active = supported && this.fullscreen.active();
    // Not supported (an iPhone): no button to fail with; the settings card says why.
    if (this.fullscreenButton.hidden === supported) this.fullscreenButton.hidden = !supported;
    this.fullscreenButton.setAttribute("aria-pressed", String(active));
    if (this.fullscreenIcon !== active) {
      this.fullscreenIcon = active;
      this.fullscreenButton.innerHTML = active ? ICON_EXIT_FULLSCREEN : ICON_ENTER_FULLSCREEN;
    }
    this.settingsPanel.refresh();
  }

  private syncReducedMotion(): void {
    applyReducedMotion(document.documentElement, reducedMotionActive(this.store.get(), osPrefersReducedMotion()));
  }

  /** The system setting can change while the page is open. */
  private watchSystemMotion(): void {
    try {
      if (typeof window.matchMedia !== "function") return;
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      const onChange = (): void => { this.syncReducedMotion(); this.settingsPanel.refresh(); };
      query.addEventListener("change", onChange);
      this.unsubscribers.push(() => query.removeEventListener("change", onChange));
    } catch {
      /* an old browser without addEventListener on a MediaQueryList: the setting is read at startup only */
    }
  }
}

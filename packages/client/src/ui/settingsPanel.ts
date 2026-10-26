// The settings card under the gear button. Not a modal: the run keeps going behind it. Every control writes through the
// settings store, which saves to this browser and tells the rest of the client, so changes apply while the card is open.
// The switches are buttons (role="switch") rather than checkboxes on purpose: the scenes ignore game keys while an <input>
// has focus, and a checkbox left focused after a click would silently eat S, Q, F and 1/2.
import { documentFullscreen, type FullscreenApi } from "../fullscreen";
import type { Settings, SettingsStore } from "../settings";
import { el } from "./dom";

export function juiceToPercent(juice: number): number {
  return Math.round(Math.min(1, Math.max(0, juice)) * 100);
}

export function percentToJuice(percent: number): number {
  return Math.min(100, Math.max(0, Math.round(Number.isFinite(percent) ? percent : 0))) / 100;
}

export function formatJuice(juice: number): string {
  return `${juiceToPercent(juice)}%`;
}

/** The OS-level "reduce motion" preference. False where it can't be read. */
export function osPrefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Reduced motion is on when the player asked for it here or the system does. */
export function reducedMotionActive(s: Pick<Settings, "reducedMotion">, osPrefers: boolean): boolean {
  return s.reducedMotion || osPrefers;
}

/** The attribute the stylesheets key off (`html[data-reduced-motion]`). */
export const REDUCED_MOTION_ATTR = "data-reduced-motion";

export function applyReducedMotion(root: Pick<Element, "setAttribute" | "removeAttribute">, active: boolean): void {
  if (active) root.setAttribute(REDUCED_MOTION_ATTR, "");
  else root.removeAttribute(REDUCED_MOTION_ATTR);
}

type SwitchKey = "hiDpi" | "reducedMotion" | "showFps" | "showPing";

interface SwitchSpec {
  key: SwitchKey;
  label: string;
  note: string;
}

const HI_DPI: SwitchSpec = { key: "hiDpi", label: "Sharp rendering", note: "Draw at your screen's full pixel density. Turn it off if the game runs slowly." };
const REDUCED_MOTION: SwitchSpec = { key: "reducedMotion", label: "Reduced motion", note: "Fewer animations and no screen shake. Your system's setting counts too." };
const SHOW_FPS: SwitchSpec = { key: "showFps", label: "Show FPS", note: "" };
const SHOW_PING: SwitchSpec = { key: "showPing", label: "Show ping", note: "" };

export interface SettingsPanelOptions {
  store: Pick<SettingsStore, "get" | "update" | "reset" | "subscribe">;
  fullscreen?: FullscreenApi;
  osReducedMotion?: () => boolean;
  /** Called when the card asks to close itself (its × button). Defaults to closing it. */
  onClose?: () => void;
}

export class SettingsPanel {
  readonly element = el("div", "settings-panel");
  private readonly store: SettingsPanelOptions["store"];
  private readonly fullscreen: FullscreenApi;
  private readonly osReducedMotion: () => boolean;
  private readonly onClose: (() => void) | undefined;
  private readonly switches = new Map<SwitchKey, HTMLButtonElement>();
  private readonly fsButton = el("button", "sp-switch");
  private readonly fsNote = el("div", "sp-note");
  private readonly slider = el("input", "sp-range");
  private readonly sliderValue = el("span", "sp-value");
  private readonly motionNote = el("div", "sp-note");
  private readonly status = el("div", "sp-status");
  private readonly unsubscribe: () => void;

  constructor(options: SettingsPanelOptions) {
    this.store = options.store;
    this.fullscreen = options.fullscreen ?? documentFullscreen();
    this.osReducedMotion = options.osReducedMotion ?? osPrefersReducedMotion;
    this.onClose = options.onClose;

    const card = this.element;
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Settings");
    card.tabIndex = -1;

    const head = el("div", "sp-head");
    const close = el("button", "sp-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close settings");
    close.addEventListener("click", () => this.requestClose());
    head.append(el("h2", "sp-title", "Settings"), close);
    card.append(head);

    card.append(
      section("Display", this.fullscreenRow(), this.switchRow(HI_DPI)),
      section("Effects", this.sliderRow(), this.switchRow(REDUCED_MOTION)),
      section("Readout", this.switchRow(SHOW_FPS), this.switchRow(SHOW_PING)),
    );

    const foot = el("div", "sp-foot");
    const reset = el("button", "btn small sp-reset", "Reset to defaults");
    reset.type = "button";
    reset.addEventListener("click", () => { this.status.textContent = ""; this.store.reset(); });
    foot.append(el("div", "sp-saved", "Saved in this browser."), reset);
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    card.append(this.status, foot);

    card.hidden = true;
    this.unsubscribe = this.store.subscribe(() => this.refresh());
    this.refresh();
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  open(): void {
    this.status.textContent = "";
    this.refresh();
    this.element.hidden = false;
    this.element.focus();
  }

  close(): void {
    this.element.hidden = true;
  }

  contains(node: Node | null): boolean {
    return node !== null && this.element.contains(node);
  }

  /** Re-reads the store and the fullscreen state into the controls (run on every change and when the card opens). */
  refresh(): void {
    const s = this.store.get();
    for (const [key, button] of this.switches) button.setAttribute("aria-checked", String(s[key]));

    const percent = juiceToPercent(s.juice);
    if (this.slider.value !== String(percent)) this.slider.value = String(percent);
    this.sliderValue.textContent = formatJuice(s.juice);
    this.slider.setAttribute("aria-valuetext", `${percent} percent`);

    const supported = this.fullscreen.supported();
    this.fsButton.hidden = !supported;
    this.fsButton.setAttribute("aria-checked", String(supported && this.fullscreen.active()));
    this.fsNote.textContent = supported ? "Alt+Enter does the same." : "Not available in this browser.";

    this.motionNote.textContent = this.osReducedMotion()
      ? "Your system already asks for reduced motion, so it is on either way."
      : "Hit flashes, shakes and animations. 0% turns them off.";
  }

  destroy(): void {
    this.unsubscribe();
    this.element.remove();
  }

  private requestClose(): void {
    if (this.onClose) this.onClose();
    else this.close();
  }

  private fullscreenRow(): HTMLElement {
    const row = el("div", "sp-row");
    const label = el("label", "sp-label", "Fullscreen");
    label.htmlFor = "sp-fullscreen";
    this.fsButton.id = "sp-fullscreen";
    this.fsButton.type = "button";
    this.fsButton.setAttribute("role", "switch");
    this.fsButton.append(el("span", "sp-knob"));
    this.fsButton.addEventListener("click", () => {
      this.status.textContent = "";
      void this.fullscreen.toggle().then((ok) => {
        if (!ok) this.status.textContent = "The browser did not allow fullscreen.";
        this.refresh();
      });
    });
    row.append(label, this.fsButton, this.fsNote);
    return row;
  }

  private sliderRow(): HTMLElement {
    const row = el("div", "sp-row sp-row-slider");
    const label = el("label", "sp-label", "Effects intensity");
    label.htmlFor = "sp-juice";
    const slider = this.slider;
    slider.id = "sp-juice";
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.step = "5";
    slider.addEventListener("input", () => { this.store.update({ juice: percentToJuice(Number(slider.value)) }); });
    // A dragged slider keeps focus, and a focused <input> makes the scenes ignore the game keys: let go of it when the mouse does.
    slider.addEventListener("pointerup", () => slider.blur());
    row.append(label, this.sliderValue, slider, this.motionNote);
    return row;
  }

  private switchRow(spec: SwitchSpec): HTMLElement {
    const row = el("div", "sp-row");
    const id = `sp-${spec.key}`;
    const label = el("label", "sp-label", spec.label);
    label.htmlFor = id;
    const button = el("button", "sp-switch");
    button.id = id;
    button.type = "button";
    button.setAttribute("role", "switch");
    button.append(el("span", "sp-knob"));
    button.addEventListener("click", () => { this.store.update({ [spec.key]: !this.store.get()[spec.key] }); });
    this.switches.set(spec.key, button);
    row.append(label, button);
    if (spec.note) row.append(el("div", "sp-note", spec.note));
    return row;
  }
}

function section(title: string, ...rows: HTMLElement[]): HTMLElement {
  const group = el("div", "sp-section");
  group.append(el("div", "sp-section-title", title), ...rows);
  return group;
}

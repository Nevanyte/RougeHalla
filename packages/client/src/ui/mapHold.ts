// Hold Tab during a run to see the whole map and your route; let go and it is gone. The key is taken from the browser (no focus
// walk) only while the hold is allowed and nothing else wants Tab: not while typing, not inside an open panel (the settings or
// help card, and the camp chest panel once C has given it the keyboard, keep their focus navigation), not with a modifier
// held. A lost window or a hidden tab lets go too, so the map can never stay up.
import { isTypingTarget } from "./chrome";

/** What the hold reads of a KeyboardEvent. */
export interface HoldKey {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  target: unknown;
  preventDefault(): void;
}

const PANEL_CLASSES = ["settings-panel", "help-scrim", "chest-panel"];

/**
 * True when `node` is, or sits inside, the settings card, the help card or the camp chest panel (duck-typed, so it needs no
 * DOM globals). The chest panel's buttons take focus only after C (ui/chestPanel.ts), so a Tab from the canvas is still the map's.
 */
export function insidePanel(node: unknown): boolean {
  for (let n = node as { classList?: { contains(c: string): boolean }; parentElement?: unknown } | null | undefined; n; n = n.parentElement as typeof n) {
    if (n.classList && PANEL_CLASSES.some((c) => n!.classList!.contains(c))) return true;
  }
  return false;
}

/**
 * Whether Tab may be taken for the map: a run is on, it is not practice, and the results panel is not up. A player who died
 * while others still fight sees the results ("Back to hub") with the phase still active, and must be able to Tab to it.
 */
export function mapHoldAllowed(state: { phase: string; training?: boolean }, resultsVisible: boolean): boolean {
  return state.phase === "active" && state.training !== true && !resultsVisible;
}

export class MapHold {
  private down = false;

  /**
   * `allowed`: a run is on and this is not practice. `onChange` hears every change of the hold. `focused` is what has the
   * keyboard (document.activeElement); a test passes its own.
   */
  constructor(
    private readonly allowed: () => boolean,
    private readonly onChange: (held: boolean) => void = () => {},
    private readonly focused: () => unknown = () => (typeof document === "undefined" ? null : document.activeElement),
  ) {}

  get held(): boolean {
    return this.down;
  }

  /** Tab went down. Returns whether the hold took it (and so whether the browser's own Tab was cancelled). */
  keyDown(e: HoldKey): boolean {
    if (e.code !== "Tab" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
    if (!this.allowed()) return false;
    const active = this.focused();
    if (isTypingTarget(e.target) || isTypingTarget(active) || insidePanel(e.target) || insidePanel(active)) return false;
    e.preventDefault();
    if (!e.repeat) this.set(true);
    return true;
  }

  keyUp(e: { code: string }): void {
    if (e.code === "Tab") this.set(false);
  }

  /** The window lost focus, the tab was hidden, the run is over: let go. (An arrow: it is also the window's blur listener.) */
  readonly release = (): void => {
    this.set(false);
  };

  private set(held: boolean): void {
    if (held === this.down) return;
    this.down = held;
    this.onChange(held);
  }

  /** Listens on the window for as long as the scene lives. Returns the function that stops it. */
  bind(): () => void {
    const down = (e: KeyboardEvent): void => { this.keyDown(e); };
    const up = (e: KeyboardEvent): void => { this.keyUp(e); };
    const hidden = (): void => { if (document.visibilityState === "hidden") this.release(); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", this.release);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", this.release);
      document.removeEventListener("visibilitychange", hidden);
      this.release();
    };
  }
}

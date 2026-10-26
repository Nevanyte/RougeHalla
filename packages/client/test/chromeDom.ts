// A fake DOM for the chrome tests: elements with attributes, listeners that bubble, focus, and a window whose keydown listeners
// run capture-first and honour stopPropagation (so "Esc is consumed before the scene sees it" can be checked). It covers
// what ui/chrome.ts, settingsPanel.ts, helpOverlay.ts, perfMeter.ts and weaponBar.ts use, and no more. test/fakes.ts has the
// simpler FakeEl the older HUD tests share.
import { vi } from "vitest";

export interface FakeEvent {
  type: string;
  target: FEl | null;
  defaultPrevented: boolean;
  propagationStopped: boolean;
  [key: string]: unknown;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
}

type Listener = (e: any) => void;

function makeEvent(type: string, target: FEl | null, init: Record<string, unknown> = {}): FakeEvent {
  const e: FakeEvent = {
    type,
    target,
    defaultPrevented: false,
    propagationStopped: false,
    ...init,
    preventDefault() { e.defaultPrevented = true; },
    stopPropagation() { e.propagationStopped = true; },
    stopImmediatePropagation() { e.propagationStopped = true; },
  };
  return e;
}

export class FEl {
  id = "";
  className = "";
  hidden = false;
  title = "";
  type = "";
  value = "";
  min = "";
  max = "";
  step = "";
  htmlFor = "";
  tabIndex = 0;
  innerHTML = "";
  disabled = false;
  isContentEditable = false;
  children: FEl[] = [];
  parent: FEl | null = null;
  removed = false;
  /** How many times textContent was assigned, to check that an unchanged value is not written again. */
  textWrites = 0;
  readonly style: Record<string, any> = { props: {} as Record<string, string>, setProperty(k: string, v: string) { this.props[k] = v; } };
  readonly attrs = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly classList = {
    add: (...names: string[]): void => { for (const n of names) this.classes.add(n); },
    remove: (...names: string[]): void => { for (const n of names) this.classes.delete(n); },
    toggle: (name: string, force?: boolean): boolean => {
      const on = force ?? !this.classes.has(name);
      if (on) this.classes.add(name); else this.classes.delete(name);
      return on;
    },
    contains: (name: string): boolean => this.classes.has(name),
  };
  private text = "";
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly tagName: string, private readonly doc: FakeDocument | null = null) {}

  get textContent(): string {
    return this.text;
  }

  set textContent(v: string) {
    this.textWrites++;
    this.text = v;
  }

  /** Text of this element and everything below it. */
  get allText(): string {
    return this.text + this.children.map((c) => c.allText).join("");
  }

  setAttribute(name: string, value: string): void { this.attrs.set(name, String(value)); }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  removeAttribute(name: string): void { this.attrs.delete(name); }
  hasAttribute(name: string): boolean { return this.attrs.has(name); }

  append(...nodes: Array<FEl | string>): void {
    for (const n of nodes) {
      if (typeof n === "string") { this.text += n; continue; }
      n.parent?.children.splice(n.parent.children.indexOf(n), 1);
      n.parent = this;
      n.removed = false;
      this.children.push(n);
    }
  }

  remove(): void {
    this.removed = true;
    this.parent?.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }

  contains(node: FEl | null): boolean {
    for (let n = node; n; n = n.parent) if (n === this) return true;
    return false;
  }

  focus(): void { if (this.doc) this.doc.activeElement = this; }
  blur(): void { if (this.doc && this.doc.activeElement === this) this.doc.activeElement = this.doc.body; }

  addEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type);
    if (list) this.listeners.set(type, list.filter((f) => f !== fn));
  }

  /** Fires `type` at this element and lets it bubble up through the parents. Returns the event. */
  dispatch(type: string, init: Record<string, unknown> = {}): FakeEvent {
    const e = makeEvent(type, this, init);
    for (let n: FEl | null = this; n && !e.propagationStopped; n = n.parent) {
      for (const fn of n.listeners.get(type) ?? []) fn(e);
    }
    return e;
  }

  /** A click, as a user's would be. */
  click(): FakeEvent { return this.dispatch("click"); }

  /** All descendants (depth first) satisfying `test`. */
  find(test: (el: FEl) => boolean): FEl[] {
    const out: FEl[] = [];
    for (const c of this.children) {
      if (test(c)) out.push(c);
      out.push(...c.find(test));
    }
    return out;
  }

  /** Has the class, whether it came in through `className` or the classList. */
  hasClass(name: string): boolean { return this.classes.has(name) || this.className.split(/\s+/).includes(name); }

  byClass(name: string): FEl[] { return this.find((e) => e.hasClass(name)); }
}

export class FakeDocument {
  body = new FEl("BODY", this);
  documentElement = new FEl("HTML", this);
  activeElement: FEl | null = this.body;
  ui = new FEl("DIV", this);

  createElement(tag: string): FEl { return new FEl(tag.toUpperCase(), this); }
  getElementById(): FEl { return this.ui; }
  addEventListener(): void {}
  removeEventListener(): void {}
}

interface Registered {
  fn: Listener;
  capture: boolean;
}

export interface KeyInit {
  code?: string;
  key?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  target?: FEl | null;
}

export class FakeWindow {
  devicePixelRatio = 1;
  /** What `(prefers-reduced-motion: reduce)` answers; change it, then call `changeMotion()`. */
  osReducedMotion = false;
  private readonly keydown: Registered[] = [];
  private readonly mediaListeners = new Set<Listener>();

  constructor(private readonly doc: FakeDocument) {}

  get keydownListeners(): number { return this.keydown.length; }

  addEventListener(type: string, fn: Listener, capture: boolean | { capture?: boolean } = false): void {
    if (type !== "keydown") return;
    this.keydown.push({ fn, capture: typeof capture === "boolean" ? capture : Boolean(capture.capture) });
  }

  removeEventListener(type: string, fn: Listener, capture: boolean | { capture?: boolean } = false): void {
    if (type !== "keydown") return;
    const c = typeof capture === "boolean" ? capture : Boolean(capture.capture);
    const at = this.keydown.findIndex((r) => r.fn === fn && r.capture === c);
    if (at >= 0) this.keydown.splice(at, 1);
  }

  matchMedia = (): { matches: boolean; addEventListener(t: string, fn: Listener): void; removeEventListener(t: string, fn: Listener): void } => {
    const win = this;
    return {
      get matches() { return win.osReducedMotion; },
      addEventListener: (_t, fn) => { this.mediaListeners.add(fn); },
      removeEventListener: (_t, fn) => { this.mediaListeners.delete(fn); },
    };
  };

  changeMotion(): void { for (const fn of [...this.mediaListeners]) fn({}); }

  private nextFrame = 1;
  private readonly frames = new Map<number, (t: number) => void>();
  requestAnimationFrame = (cb: (t: number) => void): number => { const id = this.nextFrame++; this.frames.set(id, cb); return id; };
  cancelAnimationFrame = (id: number): void => { this.frames.delete(id); };
  get pendingFrames(): number { return this.frames.size; }

  /**
   * A key press at `target` (default: the page body). Window capture listeners run first, then the bubbling ones, unless one
   * stopped the event. Returns the event.
   */
  press(init: KeyInit = {}): FakeEvent {
    const { target = this.doc.activeElement ?? this.doc.body, ...keys } = init;
    const e = makeEvent("keydown", target, {
      code: "", key: "", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, ...keys,
    });
    for (const phase of [true, false]) {
      for (const r of [...this.keydown]) {
        if (r.capture !== phase) continue;
        if (e.propagationStopped && !phase) continue;
        r.fn(e);
      }
      if (e.propagationStopped) break;
    }
    return e;
  }
}

/** A real-typed element the code under test made, seen as the fake it is. */
export const fake = (node: unknown): FEl => node as FEl;

/** Installs fake `document` and `window` globals. Undo with vi.unstubAllGlobals(). */
export function installChromeDom(): { doc: FakeDocument; win: FakeWindow; ui: FEl } {
  const doc = new FakeDocument();
  const win = new FakeWindow(doc);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  return { doc, win, ui: doc.ui };
}

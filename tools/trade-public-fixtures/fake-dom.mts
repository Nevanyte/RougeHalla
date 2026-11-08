// Declared minimal DOM for the source-only public witnesses (trade). It is modelled on the client tests'
// test/chromeDom.ts: elements with attributes, a classList, a style map, focus and bubbling listeners; a document with an
// #ui root; and a window whose keydown listeners run capture-first and honour stopPropagation. No browser, renderer,
// layout, CSS engine or real user input exists. The real client modules (TraderPanel) are imported and called
// unchanged; only the DOM they draw into is declared here. A disabled button does not dispatch a click, as in the real DOM.

export interface FakeEvent {
  type: string;
  target: FEl | null;
  detail: number;
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
    detail: 0,
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
  tabIndex = 0;
  disabled = false;
  isContentEditable = false;
  children: FEl[] = [];
  parent: FEl | null = null;
  removed = false;
  /** How many times textContent was assigned (so an unchanged value can be shown not to be rewritten). */
  textWrites = 0;
  readonly style = {
    props: {} as Record<string, string>,
    setProperty(k: string, v: string) { this.props[k] = v; },
  };
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
    contains: (name: string): boolean => this.hasClass(name),
  };
  /** Ordered text and element nodes, so allText follows DOM insertion order (keycaps between words). */
  private parts: Array<FEl | string> = [];
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly tagName: string, private readonly doc: FakeDocument | null = null) {}

  get parentElement(): FEl | null { return this.parent; }
  get textContent(): string { return this.allText; }
  set textContent(v: string) {
    this.textWrites++;
    for (const c of this.children) c.parent = null;
    this.children = [];
    this.parts = [String(v)];
  }
  get allText(): string { return this.parts.map((p) => (typeof p === "string" ? p : p.allText)).join(""); }
  setAttribute(name: string, value: string): void { this.attrs.set(name, String(value)); }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  removeAttribute(name: string): void { this.attrs.delete(name); }
  hasAttribute(name: string): boolean { return this.attrs.has(name); }

  append(...nodes: Array<FEl | string>): void {
    for (const n of nodes) {
      if (typeof n === "string") { this.parts.push(n); continue; }
      if (n.parent) {
        n.parent.children.splice(n.parent.children.indexOf(n), 1);
        const at = n.parent.parts.indexOf(n);
        if (at >= 0) n.parent.parts.splice(at, 1);
      }
      n.parent = this;
      n.removed = false;
      this.children.push(n);
      this.parts.push(n);
    }
  }

  replaceChildren(...nodes: Array<FEl | string>): void {
    for (const c of this.children) c.parent = null;
    this.children = [];
    this.parts = [];
    this.append(...nodes);
  }

  remove(): void {
    this.removed = true;
    if (this.parent) {
      this.parent.children.splice(this.parent.children.indexOf(this), 1);
      const at = this.parent.parts.indexOf(this);
      if (at >= 0) this.parent.parts.splice(at, 1);
    }
    this.parent = null;
  }

  contains(node: FEl | null): boolean {
    for (let n = node; n; n = n.parent) if (n === this) return true;
    return false;
  }

  focus(_opts?: { preventScroll?: boolean }): void { if (this.doc) this.doc.activeElement = this; }
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

  /** Fires an event at this element and lets it bubble through the parents. */
  dispatch(type: string, init: Record<string, unknown> = {}): FakeEvent {
    const e = makeEvent(type, this, init);
    for (let n: FEl | null = this; n && !e.propagationStopped; n = n.parent) {
      for (const fn of n.listeners.get(type) ?? []) { fn(e); if (e.propagationStopped) break; }
    }
    return e;
  }

  /** A user's click; a disabled control does not dispatch one (the real DOM's behaviour). */
  click(init: Record<string, unknown> = {}): FakeEvent {
    if (this.disabled) return makeEvent("click", this, { ...init, suppressedDisabled: true });
    return this.dispatch("click", init);
  }

  find(test: (el: FEl) => boolean): FEl[] {
    const out: FEl[] = [];
    for (const c of this.children) {
      if (test(c)) out.push(c);
      out.push(...c.find(test));
    }
    return out;
  }

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

interface Registered { fn: Listener; capture: boolean }

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

  matchMedia = (): { matches: boolean; addEventListener(t: string, fn: Listener): void; removeEventListener(t: string, fn: Listener): void } => ({
    matches: false,
    addEventListener: (_t: string, fn: Listener) => { this.mediaListeners.add(fn); },
    removeEventListener: (_t: string, fn: Listener) => { this.mediaListeners.delete(fn); },
  });

  requestAnimationFrame = (): number => 1;
  cancelAnimationFrame = (): void => {};

  /** A key press at `target` (default: the active element); capture listeners run first, then bubbling ones. */
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

/** Installs the declared `document` and `window` globals; call once before importing the client modules. */
export function installFakeDom(): { doc: FakeDocument; win: FakeWindow; ui: FEl } {
  const doc = new FakeDocument();
  const win = new FakeWindow(doc);
  (globalThis as any).document = doc;
  (globalThis as any).window = win;
  return { doc, win, ui: doc.ui };
}

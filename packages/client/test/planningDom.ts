// A fake DOM for the map screens (ui/planning.ts): a real tree with text, attributes, class lists, focus and events that bubble
// from the element up through its parents, the document and the window (stopPropagation honoured), canvases with a recording 2D
// context, and a rect each element can be given. test/chromeDom.ts and test/fakes.ts stop short of what the planning view uses
// (replaceChildren, prepend, getContext on any element, focus events, document-level and window-level listeners together).
// Install it with installPlanningDom() and undo with vi.unstubAllGlobals().
import { vi } from "vitest";
import { fakeObject, type FakeObject } from "./fakes";

type Listener = (e: any) => void;

export interface PEvent {
  type: string;
  target: PEl | null;
  defaultPrevented: boolean;
  propagationStopped: boolean;
  [key: string]: any;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
}

function makeEvent(type: string, target: PEl | null, init: Record<string, unknown> = {}): PEvent {
  const e: PEvent = {
    type, target, defaultPrevented: false, propagationStopped: false, ...init,
    preventDefault() { e.defaultPrevented = true; },
    stopPropagation() { e.propagationStopped = true; },
    stopImmediatePropagation() { e.propagationStopped = true; },
  };
  return e;
}

class Targets {
  readonly listeners = new Map<string, Listener[]>();
  addEventListener(type: string, fn: Listener): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  removeEventListener(type: string, fn: Listener): void { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn)); }
  count(type?: string): number {
    if (type) return this.listeners.get(type)?.length ?? 0;
    let n = 0;
    for (const l of this.listeners.values()) n += l.length;
    return n;
  }
  protected fire(e: PEvent): void { for (const fn of [...(this.listeners.get(e.type) ?? [])]) fn(e); }
}

export class PEl extends Targets {
  id = "";
  hidden = false;
  title = "";
  type = "";
  disabled = false;
  tabIndex = -1;
  width = 0;
  height = 0;
  htmlFor = "";
  value = "";
  isContentEditable = false;
  parent: PEl | null = null;
  children: PEl[] = [];
  removed = false;
  /** What getBoundingClientRect() answers: a test places an element by setting it. */
  rect = { left: 0, top: 0, width: 0, height: 0 };
  readonly attrs = new Map<string, string>();
  readonly style = { props: {} as Record<string, string>, setProperty(k: string, v: string) { this.props[k] = v; } };
  private classes = new Set<string>();
  private text = "";
  private ctx: FakeObject | null = null;

  constructor(readonly tagName: string, readonly doc: PDocument | null = null) { super(); }

  /** What a real DOM node calls its parent element (ui/mapHold.ts walks it). */
  get parentElement(): PEl | null { return this.parent; }

  get className(): string { return [...this.classes].join(" "); }
  set className(v: string) { this.classes = new Set(v.split(/\s+/).filter(Boolean)); }
  readonly classList = {
    add: (...n: string[]): void => { for (const c of n) this.classes.add(c); },
    remove: (...n: string[]): void => { for (const c of n) this.classes.delete(c); },
    contains: (n: string): boolean => this.classes.has(n),
    toggle: (n: string, force?: boolean): boolean => {
      const on = force ?? !this.classes.has(n);
      if (on) this.classes.add(n); else this.classes.delete(n);
      return on;
    },
  };

  get textContent(): string { return this.text + this.children.map((c) => c.textContent).join(""); }
  set textContent(v: string) { for (const c of this.children) c.parent = null; this.children = []; this.text = v; }

  setAttribute(k: string, v: string): void { this.attrs.set(k, String(v)); }
  getAttribute(k: string): string | null { return this.attrs.get(k) ?? null; }
  removeAttribute(k: string): void { this.attrs.delete(k); }

  append(...nodes: Array<PEl | string>): void {
    for (const n of nodes) {
      if (typeof n === "string") { const t = new PEl("#text", this.doc); t.text = n; this.append(t); continue; }
      n.remove();
      n.parent = this;
      n.removed = false;
      this.children.push(n);
    }
  }
  prepend(...nodes: PEl[]): void {
    for (const n of [...nodes].reverse()) { n.remove(); n.parent = this; n.removed = false; this.children.unshift(n); }
  }
  replaceChildren(...nodes: PEl[]): void {
    for (const c of this.children) { c.parent = null; c.removed = true; }
    this.children = [];
    this.text = "";
    this.append(...nodes);
  }
  remove(): void {
    this.removed = true;
    if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  }
  contains(node: PEl | null): boolean {
    for (let n = node; n; n = n.parent) if (n === this) return true;
    return false;
  }

  focus(): void {
    const doc = this.doc;
    if (!doc || doc.activeElement === this) return;
    const before = doc.activeElement;
    doc.activeElement = this;
    before?.fire(makeEvent("blur", before));
    this.fire(makeEvent("focus", this));
  }
  blur(): void {
    const doc = this.doc;
    if (!doc || doc.activeElement !== this) return;
    doc.activeElement = doc.body;
    this.fire(makeEvent("blur", this));
  }

  /** A short form for a failed assertion's diff (pretty-format calls it), instead of the whole tree with its cycles. */
  toJSON(): string {
    return `<${this.tagName.toLowerCase()} class="${this.className}"${this.attrs.has("aria-label") ? ` label="${this.attrs.get("aria-label")}"` : ""}>${this.text}`;
  }

  getContext(): FakeObject { return (this.ctx ??= fakeObject("ctx")); }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number; right: number; bottom: number } {
    const r = this.rect;
    return { ...r, right: r.left + r.width, bottom: r.top + r.height };
  }

  /** Fires an event at this element; it bubbles through the parents, the document and the window unless stopped. */
  dispatch(type: string, init: Record<string, unknown> = {}): PEvent {
    const e = makeEvent(type, this, init);
    for (let n: PEl | null = this; n && !e.propagationStopped; n = n.parent) n.fire(e);
    if (!e.propagationStopped) this.doc?.fire(e);
    if (!e.propagationStopped) this.doc?.win?.fire(e);
    return e;
  }
  click(init: Record<string, unknown> = {}): PEvent { return this.dispatch("click", init); }

  /** A key at this element: keydown, then (for Enter and Space on a button) the click a browser would make. */
  key(code: string, init: Record<string, unknown> = {}): PEvent {
    const e = this.dispatch("keydown", { code, key: code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, ...init });
    if (!e.defaultPrevented && this.tagName === "BUTTON" && (code === "Enter" || code === "Space") && !this.disabled) this.click();
    return e;
  }

  find(test: (e: PEl) => boolean): PEl[] {
    const out: PEl[] = [];
    for (const c of this.children) { if (test(c)) out.push(c); out.push(...c.find(test)); }
    return out;
  }
  byClass(name: string): PEl[] { return this.find((e) => e.classList.contains(name)); }
  one(name: string): PEl {
    const found = this.byClass(name);
    if (found.length !== 1) throw new Error(`expected one .${name}, found ${found.length}`);
    return found[0]!;
  }
  /** Every piece of text under this element, in order. */
  get allText(): string { return this.textContent; }
}

export class PDocument extends Targets {
  readonly body = new PEl("BODY", this);
  readonly ui = new PEl("DIV", this);
  documentElement = new PEl("HTML", this);
  activeElement: PEl | null = this.body;
  visibilityState = "visible";
  win: PWindow | null = null;
  constructor() { super(); this.ui.id = "ui"; this.body.append(this.ui); }
  createElement(tag: string): PEl { return new PEl(tag.toUpperCase(), this); }
  getElementById(): PEl { return this.ui; }
  fire(e: PEvent): void { super.fire(e); }
}

export class PWindow extends Targets {
  devicePixelRatio = 1;
  innerWidth = 1280;
  innerHeight = 800;
  fire(e: PEvent): void { super.fire(e); }
}

export interface PlanningDom {
  doc: PDocument;
  win: PWindow;
  ui: PEl;
  /** A key press at the focused element (or the body): bubbles to the window, like a browser's. */
  press(code: string, init?: Record<string, unknown>): PEvent;
  release(code: string): PEvent;
}

export function installPlanningDom(): PlanningDom {
  const doc = new PDocument();
  const win = new PWindow();
  doc.win = win;
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  const at = (): PEl => doc.activeElement ?? doc.body;
  return {
    doc, win, ui: doc.ui,
    press: (code, init = {}) => at().key(code, init),
    release: (code) => at().dispatch("keyup", { code, key: code }),
  };
}

export const asEl = (node: unknown): PEl => node as PEl;

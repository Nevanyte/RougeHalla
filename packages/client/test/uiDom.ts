// A small DOM for the overlay pieces (toasts, banner, loading screen, results): a real tree with parents, class lists,
// attributes and click handlers, which test/fakes.ts's FakeEl (a flat recorder) does not have. Install it with
// installUiDom() and undo with vi.unstubAllGlobals().
import { vi } from "vitest";

type Handler = (event: { type: string }) => void;

export class UiEl {
  id = "";
  hidden = false;
  textContent = "";
  readonly children: Array<UiEl | string> = [];
  parent: UiEl | null = null;
  readonly attrs = new Map<string, string>();
  private classes = new Set<string>();
  private readonly handlers = new Map<string, Handler[]>();

  constructor(readonly tag: string, private readonly doc: UiDoc) {}

  get className(): string {
    return [...this.classes].join(" ");
  }
  set className(value: string) {
    this.classes = new Set(value.split(/\s+/).filter(Boolean));
  }

  readonly classList = {
    add: (...names: string[]): void => { for (const n of names) this.classes.add(n); },
    remove: (...names: string[]): void => { for (const n of names) this.classes.delete(n); },
    contains: (name: string): boolean => this.classes.has(name),
    toggle: (name: string, force?: boolean): boolean => {
      const on = force ?? !this.classes.has(name);
      if (on) this.classes.add(name); else this.classes.delete(name);
      return on;
    },
  };

  get isConnected(): boolean {
    let node: UiEl | null = this;
    while (node?.parent) node = node.parent;
    return node === this.doc.body;
  }

  append(...nodes: Array<UiEl | string>): void {
    for (const n of nodes) {
      if (typeof n !== "string") { n.remove(); n.parent = this; }
      this.children.push(n);
    }
  }

  replaceChildren(...nodes: Array<UiEl | string>): void {
    for (const c of this.children) if (typeof c !== "string") c.parent = null;
    this.children.length = 0;
    this.append(...nodes);
  }

  remove(): void {
    const p = this.parent;
    if (!p) return;
    p.children.splice(p.children.indexOf(this), 1);
    this.parent = null;
  }

  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }

  addEventListener(type: string, fn: Handler): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  click(): void {
    for (const fn of this.handlers.get("click") ?? []) fn({ type: "click" });
  }

  /** This element and everything under it, depth first. */
  *walk(): Generator<UiEl> {
    yield this;
    for (const c of this.children) if (typeof c !== "string") yield* c.walk();
  }
  /** The first descendant (or itself) with the class. */
  byClass(name: string): UiEl | undefined {
    for (const n of this.walk()) if (n.classList.contains(name)) return n;
    return undefined;
  }
  allByClass(name: string): UiEl[] {
    return [...this.walk()].filter((n) => n.classList.contains(name));
  }
  /** All the text under this element, in order. */
  get text(): string {
    return this.textContent + this.children.map((c) => (typeof c === "string" ? c : c.text)).join("");
  }
}

export class UiDoc {
  readonly body = new UiEl("body", this);
  createElement = (tag: string): UiEl => new UiEl(tag, this);
  getElementById = (id: string): UiEl | null => {
    for (const n of this.body.walk()) if (n.id === id) return n;
    return null;
  };
}

/** Stubs `document` with a tree that has a #ui root under its body. */
export function installUiDom(): { doc: UiDoc; body: UiEl; ui: UiEl } {
  const doc = new UiDoc();
  const ui = doc.createElement("div");
  ui.id = "ui";
  doc.body.append(ui);
  vi.stubGlobal("document", doc);
  return { doc, body: doc.body, ui };
}

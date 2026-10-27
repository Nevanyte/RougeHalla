// Stand-ins for Phaser and the DOM, just enough to run the views without a browser. Every method call on a fake game
// object is recorded and answers the object itself (Phaser's chaining); a `setFoo(v)` also leaves `v` in `state.foo`.
import { vi } from "vitest";

export type Call = readonly [name: string, args: readonly unknown[]];

export interface FakeObject {
  /** The factory that made it: "graphics", "text", "container"... */
  kind: string;
  /** The factory's arguments. */
  args: readonly unknown[];
  /** Calls (and `prop=` assignments) since the last `clear()`. */
  calls: Call[];
  /** The last argument of each `setXxx` call, by the lower-cased name (`setAlpha(0.5)` -> `state.alpha`). */
  state: Record<string, unknown>;
  /** How many times clear() was called. */
  clears: number;
  [method: string]: any;
}

export function fakeObject(kind: string, args: readonly unknown[] = []): FakeObject {
  const target = { kind, args, calls: [] as Call[], state: {} as Record<string, unknown>, clears: 0 };
  // An image starts on the texture it was made with; `texture.key` follows setTexture like Phaser's.
  if (kind === "image") target.state.texture = args[2];
  const proxy: FakeObject = new Proxy(target, {
    get(t, prop) {
      if (prop === "texture") return { key: t.state.texture };
      if (prop in t) return (t as Record<string | symbol, unknown>)[prop];
      if (typeof prop === "symbol" || prop === "then") return undefined;
      return (...a: unknown[]) => {
        if (prop === "clear") { t.calls.length = 0; t.clears++; } else t.calls.push([prop, a]);
        if (/^set[A-Z]/.test(prop) && a.length > 0) t.state[prop[3]!.toLowerCase() + prop.slice(4)] = a.length === 1 ? a[0] : a;
        return proxy;
      };
    },
    set(t, prop, value) {
      if (typeof prop === "string") t.calls.push([`${prop}=`, [value]]);
      (t as Record<string | symbol, unknown>)[prop] = value;
      return true;
    },
  }) as FakeObject;
  return proxy;
}

/** A texture a view baked (see render/bake.ts): the draw calls that made it and its size in texels. */
export interface FakeBake {
  calls: Call[];
  size: readonly [number, number];
}

/**
 * A Phaser scene whose `add.*` factories make fake objects, kept in `made` in creation order. Its texture manager remembers what was
 * baked into it (`baked`, by key, drawn through `make.graphics` and `generateTexture`), so a test can read what a texture shows.
 */
export function fakeScene() {
  const made: FakeObject[] = [];
  const baked = new Map<string, FakeBake>();
  const add = new Proxy({}, {
    get: (_t, kind: string) => (...args: unknown[]) => {
      const o = fakeObject(kind, args);
      made.push(o);
      return o;
    },
  });
  const textures = { exists: (key: string) => baked.has(key), remove: (key: string) => baked.delete(key) };
  const make = {
    graphics: () => {
      const g = fakeObject("graphics");
      // Phaser's Graphics keeps what it draws as a flat array of numbers (see render/mapBake.ts).
      g.commandBuffer = [];
      g.calls.length = 0; // that assignment is set-up, not drawing
      return new Proxy(g, {
        get(t, prop) {
          if (prop === "generateTexture") {
            return (key: string, w: number, h: number) => { baked.set(key, { calls: [...t.calls], size: [w, h] }); return t; };
          }
          return t[prop as string];
        },
      });
    },
  };
  const scene = { add, make, textures, cameras: { main: fakeObject("camera") } } as never;
  /** The names of the draw calls that made the texture an image shows now. */
  const bakedCalls = (image: FakeObject): string[] => (baked.get(String(image.state.texture))?.calls ?? []).map(([n]) => n);
  return { scene, made, baked, bakedCalls, ofKind: (kind: string) => made.filter((o) => o.kind === kind) };
}

/** A Phaser object the views made from this fake scene, seen as the fake it is (its recorded calls and state). */
export const fk = (o: unknown): FakeObject => o as FakeObject;

/** The names of the calls in `o.calls`, in order. */
export const names = (o: FakeObject): string[] => o.calls.map(([n]) => n);

/** The arguments of the calls to `name` in `o.calls`. */
export const argsOf = (o: { calls: readonly Call[] }, name: string): unknown[][] => o.calls.filter(([n]) => n === name).map(([, a]) => [...a]);

// ---------------------------------------------------------------------------------------------------------------- DOM

/** A DOM event as far as the views read it; preventDefault / stopPropagation are recorded for the test to inspect. */
export interface FakeEvent {
  type: string;
  defaultPrevented: boolean;
  propagationStopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  [field: string]: any;
}

export function fakeEvent(type: string, init: Record<string, unknown> = {}): FakeEvent {
  const e: FakeEvent = {
    type, defaultPrevented: false, propagationStopped: false,
    preventDefault() { e.defaultPrevented = true; },
    stopPropagation() { e.propagationStopped = true; },
    ...init,
  };
  return e;
}

/** addEventListener / dispatchEvent; an event goes on to `bubbleTo` (the fake window) unless a listener stopped it. */
export class FakeTarget {
  readonly listeners = new Map<string, Set<(e: any) => void>>();
  bubbleTo: FakeTarget | null = null;

  addEventListener(type: string, fn: (e: any) => void): void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn);
  }
  removeEventListener(type: string, fn: (e: any) => void): void { this.listeners.get(type)?.delete(fn); }
  /** How many listeners are attached, for one event type or all. */
  listenerCount(type?: string): number {
    if (type !== undefined) return this.listeners.get(type)?.size ?? 0;
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
  dispatchEvent(e: FakeEvent): boolean {
    for (const fn of [...(this.listeners.get(e.type) ?? [])]) fn(e);
    if (!e.propagationStopped) this.bubbleTo?.dispatchEvent(e);
    return !e.defaultPrevented;
  }
}

/** Where new FakeEls send events they don't stop; installFakeDom points it at the fake window. */
let bubbleRoot: FakeTarget | null = null;

export class FakeEl extends FakeTarget {
  /** What getBoundingClientRect() answers: tests place the element by setting it. */
  rect = { left: 0, top: 0, width: 0, height: 0 };
  readonly captured = new Set<number>();
  className = "";
  hidden = false;
  textContent = "";
  width = 0;
  height = 0;
  children: Array<FakeEl | string> = [];
  readonly style = { width: "", color: "", props: {} as Record<string, string>, setProperty(k: string, v: string) { this.props[k] = v; } };
  readonly classes = new Set<string>();
  readonly classList = {
    toggle: (name: string, force?: boolean): boolean => {
      const on = force ?? !this.classes.has(name);
      if (on) this.classes.add(name); else this.classes.delete(name);
      return on;
    },
    add: (name: string): void => { this.classes.add(name); },
    contains: (name: string): boolean => this.classes.has(name),
  };
  removed = false;
  private ctx: FakeObject | null = null;

  constructor(readonly tag: string) {
    super();
    this.bubbleTo = bubbleRoot;
  }

  append(...nodes: Array<FakeEl | string>): void { this.children.push(...nodes); }
  remove(): void { this.removed = true; }
  getContext(): FakeObject { return (this.ctx ??= fakeObject("ctx")); }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number; right: number; bottom: number } {
    const r = this.rect;
    return { ...r, right: r.left + r.width, bottom: r.top + r.height };
  }
  setPointerCapture(id: number): void { this.captured.add(id); }
  releasePointerCapture(id: number): void { this.captured.delete(id); }
  hasPointerCapture(id: number): boolean { return this.captured.has(id); }
}

/** document and window, as far as ui/dom.ts and the HUD parts read them. Undo with vi.unstubAllGlobals(). */
export function installFakeDom(): { ui: FakeEl; win: FakeTarget; doc: FakeTarget & { visibilityState: string; createElement(tag: string): FakeEl } } {
  const win = Object.assign(new FakeTarget(), { devicePixelRatio: 1 });
  bubbleRoot = win;
  const ui = new FakeEl("div");
  const doc = Object.assign(new FakeTarget(), {
    visibilityState: "visible",
    createElement: (tag: string) => new FakeEl(tag),
    getElementById: () => ui,
  });
  doc.bubbleTo = win;
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  return { ui, win, doc };
}

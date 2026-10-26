import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, updateSettings } from "../src/settings";
import { ViewportManager, measureLayout, type ViewportGame, type ViewportScene, type ViewportText } from "../src/view/viewportManager";
import { currentView, onViewChange } from "../src/view/viewState";

type Listener = (...args: any[]) => void;

class FakeTarget {
  readonly listeners = new Map<string, Set<Listener>>();
  addEventListener(type: string, fn: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }
  fire(type: string): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn({ type });
  }
  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

/** Phaser's EventEmitter, as far as the manager uses it. */
class FakeEmitter {
  private readonly on_ = new Map<string, Listener[]>();
  on(event: string, fn: Listener): this {
    (this.on_.get(event) ?? this.on_.set(event, []).get(event)!).push(fn);
    return this;
  }
  once(event: string, fn: Listener): this {
    const wrapper: Listener = (...a) => { this.off(event, wrapper); fn(...a); };
    return this.on(event, wrapper);
  }
  off(event: string, fn: Listener): void {
    const list = this.on_.get(event);
    if (list) this.on_.set(event, list.filter((f) => f !== fn));
  }
  emit(event: string, ...args: unknown[]): void {
    for (const fn of [...(this.on_.get(event) ?? [])]) fn(...args);
  }
  count(event: string): number {
    return this.on_.get(event)?.length ?? 0;
  }
}

class FakeQuery extends FakeTarget {
  constructor(readonly media: string) { super(); }
}

class FakeText extends FakeEmitter implements ViewportText {
  type = "Text";
  style = { resolution: 1 };
  resolutionCalls: number[] = [];
  setResolution(value: number): this {
    this.style.resolution = value;
    this.resolutionCalls.push(value);
    return this;
  }
  destroy(): void { this.emit("destroy"); }
}

function fakeScene(): ViewportScene & { sys: { events: FakeEmitter }; cameras: { main: { zoom: number } | undefined } } {
  return { sys: { events: new FakeEmitter() }, cameras: { main: { zoom: 1 } } };
}

function fakeGame(scenes: ViewportScene[], booted = true) {
  const events = new FakeEmitter();
  const resized: Array<[number, number]> = [];
  const game = {
    isBooted: booted,
    events,
    scene: { scenes },
    scale: {
      width: 1440,
      height: 900,
      refreshes: 0,
      resize(w: number, h: number) { this.width = w; this.height = h; resized.push([w, h]); },
      refresh() { this.refreshes++; },
    },
  };
  return { game: game as unknown as ViewportGame & typeof game, events, resized };
}

let win: FakeTarget & { innerWidth: number; innerHeight: number; devicePixelRatio: number; visualViewport: FakeTarget; queries: FakeQuery[]; matchMedia(q: string): FakeQuery };
let doc: FakeTarget & { documentElement: { style: { props: Record<string, string>; setProperty(k: string, v: string): void }; attrs: Set<string>; setAttribute(k: string, v: string): void; removeAttribute(k: string): void } };
let frames: Array<() => void>;
let stageEl: { style: { left: string; top: string; width: string; height: string } };

function resizeWindow(w: number, h: number, dpr = win.devicePixelRatio): void {
  win.innerWidth = w;
  win.innerHeight = h;
  win.devicePixelRatio = dpr;
}

/** Runs the animation frames asked for so far (and none asked for while running them). */
function runFrame(): void {
  const now = frames;
  frames = [];
  for (const f of now) f();
}

beforeEach(() => {
  frames = [];
  win = Object.assign(new FakeTarget(), {
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 1,
    visualViewport: new FakeTarget(),
    queries: [] as FakeQuery[],
    matchMedia(q: string) { const query = new FakeQuery(q); this.queries.push(query); return query; },
  });
  const style = { props: {} as Record<string, string>, setProperty(k: string, v: string) { this.props[k] = v; } };
  doc = Object.assign(new FakeTarget(), {
    documentElement: { style, attrs: new Set<string>(), setAttribute(k: string) { this.attrs.add(k); }, removeAttribute(k: string) { this.attrs.delete(k); } },
  });
  stageEl = { style: { left: "", top: "", width: "", height: "" } };
  let id = 0;
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => { frames.push(fn); return ++id; });
  vi.stubGlobal("cancelAnimationFrame", (_id: number) => { frames = []; });
  updateSettings({ ...DEFAULT_SETTINGS });
});

const made: ViewportManager[] = [];

afterEach(() => {
  // A test that failed before its own destroy() must not leave a manager listening to the shared settings store.
  for (const m of made.splice(0)) m.destroy();
  vi.unstubAllGlobals();
});

const make = (scenes: ViewportScene[] = [], booted = true) => {
  const g = fakeGame(scenes, booted);
  const manager = new ViewportManager(g.game, stageEl as unknown as HTMLElement);
  made.push(manager);
  return { ...g, manager };
};

describe("first apply", () => {
  it("sizes the stage, the CSS variables and the flags from the window", () => {
    resizeWindow(1366, 768, 1);
    const { manager } = make();
    expect(stageEl.style).toEqual({ left: "0px", top: "0px", width: "1366px", height: "768px" });
    const vars = doc.documentElement.style.props;
    expect(Number(vars["--ui-scale"])).toBeCloseTo(0.96, 3);
    expect(vars["--ui-w"]).toMatch(/^\d+(\.\d+)?px$/);
    expect(parseFloat(vars["--ui-w"]!) * Number(vars["--ui-scale"])).toBeCloseTo(1366, 0);
    expect(manager.current.stage).toEqual({ x: 0, y: 0, w: 1366, h: 768 });
    // 768 / 0.96 = 800 is not below the "short" line, and 1366 / 0.96 is not narrow
    expect(doc.documentElement.attrs.size).toBe(0);
    manager.destroy();
  });

  it("centres a clamped stage and leaves the bars to the body", () => {
    resizeWindow(3440, 1440);
    const { manager } = make();
    expect(stageEl.style).toEqual({ left: "40px", top: "0px", width: "3360px", height: "1440px" });
    expect(currentView().clamped).toBe(true);
    manager.destroy();
  });

  it("sets the short and narrow flags from the laid-out overlay", () => {
    resizeWindow(400, 600);
    const { manager } = make();
    expect(doc.documentElement.attrs.has("data-ui-short")).toBe(true);
    expect(doc.documentElement.attrs.has("data-ui-narrow")).toBe(true);
    manager.destroy();
  });

  it("gives Phaser the device size once, and publishes the layout", () => {
    resizeWindow(1440, 900, 2);
    const seen: number[] = [];
    const off = onViewChange((l) => seen.push(l.deviceW));
    const { manager, resized } = make();
    expect(resized).toEqual([[2880, 1800]]);
    expect(currentView().deviceW).toBe(2880);
    expect(seen).toEqual([2880]);
    off();
    manager.destroy();
  });

  it("skips Phaser until the game has booted, then applies", () => {
    resizeWindow(1000, 700);
    const { manager, resized, events, game } = make([], false);
    expect(resized).toEqual([]);
    expect(stageEl.style.width).toBe("1000px");
    game.isBooted = true;
    events.emit("boot");
    expect(resized).toEqual([[1000, 700]]);
    manager.destroy();
  });

  it("measureLayout reads the window and the hiDpi setting", () => {
    resizeWindow(1440, 900, 2);
    expect(measureLayout().dpr).toBe(2);
    updateSettings({ hiDpi: false });
    expect(measureLayout().dpr).toBe(1);
  });
});

describe("window changes", () => {
  it("coalesces any number of events into one apply in one frame", () => {
    const { manager, resized } = make();
    resized.length = 0;
    const seen: number[] = [];
    const off = onViewChange((l) => seen.push(l.stage.w));
    resizeWindow(1920, 1080);
    win.fire("resize");
    win.visualViewport.fire("resize");
    doc.fire("fullscreenchange");
    win.fire("orientationchange");
    win.fire("resize");
    expect(frames.length).toBe(1);
    expect(resized).toEqual([]);
    runFrame();
    expect(resized).toEqual([[1920, 1080]]);
    expect(seen).toEqual([1920]);
    expect(stageEl.style.width).toBe("1920px");
    off();
    manager.destroy();
  });

  it("does not republish or touch Phaser when the layout is unchanged", () => {
    const { manager, game, resized } = make();
    resized.length = 0;
    game.scale.refreshes = 0;
    const seen: unknown[] = [];
    const off = onViewChange((l) => seen.push(l));
    win.fire("resize");
    runFrame();
    expect(seen).toEqual([]);
    expect(resized).toEqual([]);
    expect(game.scale.refreshes).toBe(0);
    off();
    manager.destroy();
  });

  it("applies from Phaser's prestep, ahead of the frame, and the pending animation frame then does nothing", () => {
    const { manager, events, resized } = make();
    resized.length = 0;
    resizeWindow(1600, 900);
    win.fire("resize");
    events.emit("prestep");
    expect(resized).toEqual([[1600, 900]]);
    runFrame();
    expect(resized).toEqual([[1600, 900]]);
    manager.destroy();
  });

  it("only re-reads the canvas bounds when the stage moves but the backing size stays", () => {
    resizeWindow(3440, 1440);
    const { manager, game, resized } = make();
    resized.length = 0;
    game.scale.refreshes = 0;
    resizeWindow(3500, 1440);
    win.fire("resize");
    runFrame();
    expect(stageEl.style.left).toBe("70px");
    expect(resized).toEqual([]);
    expect(game.scale.refreshes).toBe(1);
    manager.destroy();
  });

  it("follows a device pixel ratio change (browser zoom, another monitor) and re-arms its query", () => {
    const { manager, resized } = make();
    expect(win.queries).toHaveLength(1);
    expect(win.queries[0]!.media).toBe("(resolution: 1dppx)");
    resized.length = 0;
    resizeWindow(1440, 900, 2);
    win.queries[0]!.fire("change");
    expect(win.queries).toHaveLength(2);
    expect(win.queries[0]!.count("change")).toBe(0);
    expect(win.queries[1]!.media).toBe("(resolution: 2dppx)");
    runFrame();
    expect(resized).toEqual([[2880, 1800]]);
    manager.destroy();
  });
});

describe("hiDpi setting", () => {
  it("re-applies when it changes on a 2x screen", () => {
    resizeWindow(1440, 900, 2);
    const { manager, resized } = make();
    resized.length = 0;
    updateSettings({ hiDpi: false });
    expect(frames.length).toBe(1);
    runFrame();
    expect(resized).toEqual([[1440, 900]]);
    expect(currentView().dpr).toBe(1);
    updateSettings({ hiDpi: true });
    runFrame();
    expect(resized.at(-1)).toEqual([2880, 1800]);
    manager.destroy();
  });

  it("ignores the other settings", () => {
    const { manager } = make();
    updateSettings({ juice: 0.5, showFps: false });
    expect(frames.length).toBe(0);
    manager.destroy();
  });

  it("is a no-op on a 1x screen (nothing to render differently)", () => {
    const { manager, resized } = make();
    resized.length = 0;
    updateSettings({ hiDpi: false });
    runFrame();
    expect(resized).toEqual([]);
    manager.destroy();
  });
});

describe("cameras", () => {
  it("zooms every scene's camera to the layout, at once and again on a change", () => {
    resizeWindow(1920, 1080);
    const a = fakeScene();
    const b = fakeScene();
    const { manager } = make([a, b]);
    expect(a.cameras.main!.zoom).toBeCloseTo(1.2, 9);
    expect(b.cameras.main!.zoom).toBeCloseTo(1.2, 9);
    resizeWindow(1440, 900, 2);
    win.fire("resize");
    runFrame();
    expect(a.cameras.main!.zoom).toBeCloseTo(2, 9);
    manager.destroy();
  });

  it("fixes a camera a scene restart replaced, both on prestep and when the scene says it is ready", () => {
    resizeWindow(1920, 1080);
    const scene = fakeScene();
    const { manager, events } = make([scene]);
    scene.cameras.main = { zoom: 1 };
    scene.sys.events.emit("ready");
    expect(scene.cameras.main.zoom).toBeCloseTo(1.2, 9);
    scene.cameras.main = { zoom: 1 };
    events.emit("prestep");
    expect(scene.cameras.main.zoom).toBeCloseTo(1.2, 9);
    manager.destroy();
  });

  it("copes with a scene that has no camera right now (shut down)", () => {
    const scene = fakeScene();
    scene.cameras.main = undefined;
    const { manager, events } = make([scene]);
    expect(() => events.emit("prestep")).not.toThrow();
    manager.destroy();
  });

  it("binds a scene once, however many frames pass", () => {
    const scene = fakeScene();
    const { manager, events } = make([scene]);
    events.emit("prestep");
    events.emit("prestep");
    expect(scene.sys.events.count("ready")).toBe(1);
    expect(scene.sys.events.count("addedtoscene")).toBe(1);
    manager.destroy();
  });
});

describe("text resolution", () => {
  it("gives new Text the resolution for the zoom, and ignores other objects", () => {
    resizeWindow(1920, 1080);
    const scene = fakeScene();
    const { manager } = make([scene]);
    const text = new FakeText();
    scene.sys.events.emit("addedtoscene", text);
    expect(text.style.resolution).toBe(2);
    const other = new FakeText();
    other.type = "Graphics";
    scene.sys.events.emit("addedtoscene", other);
    expect(other.resolutionCalls).toEqual([]);
    manager.destroy();
  });

  it("re-renders existing Text, pooled and hidden ones included, only when the target resolution changed", () => {
    resizeWindow(1440, 900);
    const scene = fakeScene();
    const { manager } = make([scene]);
    const texts = [new FakeText(), new FakeText()];
    for (const t of texts) scene.sys.events.emit("addedtoscene", t);
    expect(texts[0]!.resolutionCalls).toEqual([]); // zoom 1 -> resolution 1: nothing to do

    resizeWindow(1440, 900, 2);
    win.fire("resize");
    runFrame();
    expect(texts.map((t) => t.style.resolution)).toEqual([2, 2]);

    // a resize that keeps the zoom between 1 and 2 keeps resolution 2: no more calls
    resizeWindow(1400, 880, 2);
    win.fire("resize");
    runFrame();
    expect(texts[0]!.resolutionCalls).toEqual([2]);
    manager.destroy();
  });

  it("adopts Text a scene built before the manager existed, nested ones included", () => {
    resizeWindow(1920, 1080);
    const scene = fakeScene() as ReturnType<typeof fakeScene> & { children: { list: unknown[] } };
    const top = new FakeText();
    const nested = new FakeText();
    scene.children = { list: [top, { type: "Graphics" }, { type: "Container", list: [nested, { type: "Container", list: [] }] }] };
    const { manager } = make([scene]);
    expect(top.style.resolution).toBe(2);
    expect(nested.style.resolution).toBe(2);
    manager.destroy();
  });

  it("forgets a destroyed Text", () => {
    resizeWindow(1440, 900);
    const scene = fakeScene();
    const { manager } = make([scene]);
    const text = new FakeText();
    scene.sys.events.emit("addedtoscene", text);
    text.destroy();
    resizeWindow(1440, 900, 2);
    win.fire("resize");
    runFrame();
    expect(text.resolutionCalls).toEqual([]);
    manager.destroy();
  });

  it("caps the resolution", () => {
    resizeWindow(3840, 2160, 2); // zoom 2.4 * 2 = 4.8 -> 3
    const scene = fakeScene();
    const { manager } = make([scene]);
    const text = new FakeText();
    scene.sys.events.emit("addedtoscene", text);
    expect(text.style.resolution).toBe(3);
    manager.destroy();
  });
});

describe("destroy", () => {
  it("removes every listener and stops reacting", () => {
    const scene = fakeScene();
    const { manager, resized, events } = make([scene]);
    resized.length = 0;
    expect(win.count("resize")).toBe(1);
    expect(win.visualViewport.count("resize")).toBe(1);
    expect(doc.count("fullscreenchange")).toBe(1);
    expect(events.count("prestep")).toBe(1);
    manager.destroy();
    expect(win.count("resize")).toBe(0);
    expect(win.count("orientationchange")).toBe(0);
    expect(win.visualViewport.count("resize")).toBe(0);
    expect(doc.count("fullscreenchange")).toBe(0);
    expect(doc.count("webkitfullscreenchange")).toBe(0);
    expect(win.queries[0]!.count("change")).toBe(0);
    resizeWindow(1920, 1080);
    win.fire("resize");
    updateSettings({ hiDpi: false });
    events.emit("prestep");
    runFrame();
    expect(resized).toEqual([]);
  });

  it("cancels a pending frame", () => {
    const { manager, resized } = make();
    resized.length = 0;
    resizeWindow(1920, 1080);
    win.fire("resize");
    manager.destroy();
    runFrame();
    expect(resized).toEqual([]);
  });

  it("may be called twice", () => {
    const { manager } = make();
    manager.destroy();
    expect(() => manager.destroy()).not.toThrow();
  });
});

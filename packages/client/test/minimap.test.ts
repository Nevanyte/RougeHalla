// Minimap: which mobs become dots, how they look, when the map repaints, how it sizes itself from the view and re-sizes on a
// view change, what the camera's view rectangle looks like, and the pointer controls (right-click moves, left-hold peeks).
// The DOM and the canvas are fake (test/fakes.ts): the canvas context records its calls and its fillStyle/strokeStyle
// assignments, and events are dispatched by hand.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FACTIONS, WORLD_H, WORLD_W, Y_SCALE, mapFromTiles, TILE_FLOOR, type FactionId } from "@raid/shared";
import { MOVE_REPEAT_MS, Minimap, type MinimapMob } from "../src/ui/minimap";
import { minimapBacking, minimapSize, viewRectOnMinimap } from "../src/ui/minimapMath";
import { cssColor } from "../src/ui/dom";
import { setView } from "../src/view/viewState";
import { computeLayout } from "../src/view/viewport";
import { argsOf, fakeEvent, FakeEl, installFakeDom, type FakeObject } from "./fakes";

const SPAN = Math.max(WORLD_W, WORLD_H);

/** A window at 1280 x 800 and dpr 1: the overlay is 1:1, the minimap 208 px, its backing store 208 px. */
const BASE = { cssW: 1280, cssH: 800, dpr: 1, hiDpi: true };
const baseLayout = () => computeLayout(BASE);

function setup(handlers: ConstructorParameters<typeof Minimap>[0] = {}) {
  const { ui, win, doc } = installFakeDom();
  // The canvas the minimap shows is the first element it makes, its offscreen layer the second.
  const made: FakeEl[] = [];
  const create = doc.createElement;
  doc.createElement = (tag: string) => { const e = create(tag); made.push(e); return e; };
  const map = new Minimap(handlers);
  map.setMap(mapFromTiles(8, 8, new Uint8Array(64).fill(TILE_FLOOR)));
  const canvas = ui.children[0] as FakeEl;
  const layer = made[1]!;
  const ctx = canvas.getContext() as FakeObject;
  let now = 0;
  /** One update 200 ms after the last (past the repaint throttle). */
  const paint = (camera?: { x: number; y: number }): void => { now += 200; map.update(now, undefined, true, camera); };
  const arcs = () => argsOf(ctx, "arc");
  const paints = () => argsOf(ctx, "drawImage").length;
  /** Backing pixels per world unit, as the canvas stands now. */
  const k = () => canvas.width / SPAN;
  return { map, ui, win, doc, canvas, layer, ctx, paint, arcs, paints, k, now: () => now };
}

const mob = (over: Partial<MinimapMob> = {}): MinimapMob => ({ x: 400, y: 300, kind: "mob", status: "alive", faction: "fire", ...over });

beforeEach(() => { setView(baseLayout()); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Minimap.setMobs", () => {
  it("draws a dot per living regional mob and skips dummies, the dead and unknown kinds", () => {
    const { map, paint, arcs, k } = setup();
    map.setMobs([
      mob({ x: 100, y: 200 }), mob({ kind: "elite", x: 300, y: 400 }),
      mob({ kind: "dummy" }), mob({ status: "dead" }), mob({ kind: "elite", status: "dead" }), mob({ kind: "crate" }),
    ]);
    paint();
    expect(arcs().map(([x, y]) => [x, y])).toEqual([[Math.round(100 * k()), Math.round(200 * k())], [Math.round(300 * k()), Math.round(400 * k())]]);
  });

  it("colours a dot by its faction and gives an elite a bigger one with a gold rim", () => {
    const { map, ctx, paint, arcs } = setup();
    map.setMobs([mob({ faction: "frost" }), mob({ kind: "elite", faction: "holy" })]);
    paint();
    const [small, big] = arcs();
    expect(big![2]).toBeGreaterThan(small![2] as number);
    const fills = ctx.calls.filter(([n]) => n === "fillStyle=").map(([, a]) => a[0]);
    expect(fills).toEqual([cssColor(FACTIONS.frost.color as number), cssColor(FACTIONS.holy.color as number)]);
    // Only the elite is outlined (in gold), and a mob of an unknown faction still gets a (neutral) dot.
    const strokes = ctx.calls.filter(([n]) => n === "strokeStyle=").map(([, a]) => a[0]);
    expect(strokes).toEqual(["#ffd54f"]);
    map.setMobs([mob({ faction: "from-newer-content" as FactionId })]);
    paint();
    expect(arcs()).toHaveLength(3);
  });

  it("caps the dots at 128", () => {
    const { map, paint, arcs } = setup();
    map.setMobs(Array.from({ length: 200 }, (_, i) => mob({ x: i * 10, y: i * 5 })));
    paint();
    expect(arcs()).toHaveLength(128);
    // The cap counts dots, not mobs offered: skipped ones do not use it up.
    map.setMobs([...Array.from({ length: 100 }, () => mob({ status: "dead" })), ...Array.from({ length: 128 }, () => mob())]);
    paint();
    expect(arcs().length).toBe(128 + 128);
  });

  it("repaints only when a dot appears, moves a pixel or goes, and not within the throttle", () => {
    const { map, paint, paints, ctx, now, k } = setup();
    expect(paints()).toBe(0);
    map.setMobs([mob()]);
    paint();
    expect(paints()).toBe(1);
    map.setMobs([mob()]);
    paint();
    expect(paints()).toBe(1); // the same dots: nothing to redraw
    map.setMobs([mob({ x: 400 + 1 / k() })]); // a pixel to the right
    paint();
    expect(paints()).toBe(2);
    map.setMobs([mob({ x: 400 + 1 / k(), status: "dead" })]); // it died: the dot goes
    paint();
    expect(paints()).toBe(3);
    expect(argsOf(ctx, "arc")).toHaveLength(2);
    map.setMobs([mob({ x: 5 })]);
    map.update(now() + 50, undefined, true); // 50 ms after the last update: held back
    expect(paints()).toBe(3);
  });

  it("paints nothing before a map is set", () => {
    const { ui } = installFakeDom();
    const m = new Minimap();
    m.setMobs([mob()]);
    m.update(1000, undefined, true);
    expect(((ui.children[0] as FakeEl).getContext() as FakeObject).calls).toEqual([]);
  });
});

describe("Minimap sizing", () => {
  it("sizes the element from the overlay and the backing store from the overlay's scale and the dpr", () => {
    const layout = computeLayout({ cssW: 1920, cssH: 1080, dpr: 2, hiDpi: true });
    setView(layout);
    const { canvas } = setup();
    const size = minimapSize(layout.uiW, layout.uiH);
    expect(canvas.style.props["--mm-size"]).toBe(`${size}px`);
    expect(canvas.width).toBe(minimapBacking(size, layout.uiScale, 2));
    expect(canvas.height).toBe(canvas.width);
    expect(canvas.width).toBeGreaterThan(size);
  });

  it("is a direct child of the overlay and carries the minimap class", () => {
    const { ui, canvas } = setup();
    expect(ui.children).toEqual([canvas]);
    expect(canvas.className).toBe("minimap");
  });

  it("re-sizes both canvases on a view change and repaints the static layer in the new scale", () => {
    const { canvas, layer, paint, paints } = setup();
    paint();
    const before = paints();
    const layout = computeLayout({ cssW: 2560, cssH: 1440, dpr: 2, hiDpi: true });
    setView(layout);
    const size = minimapSize(layout.uiW, layout.uiH);
    const backing = minimapBacking(size, layout.uiScale, layout.dpr);
    expect(canvas.width).toBe(backing);
    expect(layer.width).toBe(backing);
    expect(canvas.style.props["--mm-size"]).toBe(`${size}px`);
    // The static layer was drawn again at the new size, and the next update paints at once (no throttle, no change needed).
    expect(argsOf(layer.getContext() as FakeObject, "fillRect").some(([x, y, w, h]) => x === 0 && y === 0 && w === backing && h === backing)).toBe(true);
    paint();
    expect(paints()).toBe(before + 1);
  });

  it("redraws the mob dots in the new scale", () => {
    const { map, paint, arcs, k } = setup();
    map.setMobs([mob({ x: 1000, y: 600 })]);
    paint();
    expect(arcs()[0]!.slice(0, 2)).toEqual([Math.round(1000 * k()), Math.round(600 * k())]);
    setView(computeLayout({ cssW: 2560, cssH: 1440, dpr: 2, hiDpi: true }));
    // No setMobs in between: the minimap kept the mobs it was given.
    paint();
    expect(arcs()[1]!.slice(0, 2)).toEqual([Math.round(1000 * k()), Math.round(600 * k())]);
  });

  it("scales its dots with its size", () => {
    const { map, paint, arcs } = setup();
    map.setMobs([mob()]);
    paint();
    const radius = arcs()[0]![2] as number;
    setView(computeLayout({ cssW: 2560, cssH: 1440, dpr: 2, hiDpi: true }));
    paint();
    expect(arcs()[1]![2]).toBeGreaterThan(radius);
  });

  it("survives a view change before it has a map or mobs", () => {
    const { ui } = installFakeDom();
    const m = new Minimap();
    expect(() => setView(computeLayout({ cssW: 1000, cssH: 700, dpr: 1, hiDpi: true }))).not.toThrow();
    expect((ui.children[0] as FakeEl).width).toBeGreaterThan(0);
    m.destroy();
  });

  it("stops following the view once destroyed", () => {
    const { map, canvas } = setup();
    const w = canvas.width;
    map.destroy();
    setView(computeLayout({ cssW: 2560, cssH: 1440, dpr: 2, hiDpi: true }));
    expect(canvas.width).toBe(w);
  });
});

describe("Minimap view rectangle", () => {
  const centre = { x: WORLD_W / 2, y: (WORLD_H / 2) * Y_SCALE };

  it("draws a thin white rectangle where the camera looks", () => {
    const { paint, ctx, canvas } = setup();
    const layout = baseLayout();
    paint(centre);
    const r = viewRectOnMinimap(centre, layout.worldW, layout.worldH);
    const [x, y, w, h] = argsOf(ctx, "strokeRect")[0] as number[];
    expect(x).toBeCloseTo(r.x * canvas.width, 6);
    expect(y).toBeCloseTo(r.y * canvas.width, 6);
    expect(w).toBeCloseTo(r.w * canvas.width, 6);
    expect(h).toBeCloseTo(r.h * canvas.width, 6);
    expect(ctx.calls.filter(([n]) => n === "strokeStyle=").map(([, a]) => a[0])).toEqual(["rgba(255, 255, 255, 0.85)"]);
  });

  it("is absent without a camera and clipped to the map near its edge", () => {
    const { paint, ctx, canvas } = setup();
    paint();
    expect(argsOf(ctx, "strokeRect")).toHaveLength(0);
    paint({ x: 0, y: 0 });
    const [x, y] = argsOf(ctx, "strokeRect")[0] as number[];
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(2);
    expect(canvas.width).toBeGreaterThan(0);
  });

  it("repaints when the camera moves a pixel and not when it holds still", () => {
    const { paint, paints, k } = setup();
    paint(centre);
    paint(centre);
    expect(paints()).toBe(1);
    paint({ x: centre.x + 1.5 / k(), y: centre.y });
    expect(paints()).toBe(2);
  });

  it("follows the visible world: a view change that only changes the window redraws it at the new size", () => {
    const { paint, ctx } = setup();
    paint(centre);
    const wide = computeLayout({ cssW: 1920, cssH: 800, dpr: 1, hiDpi: true });
    setView(wide);
    paint(centre);
    const [first, second] = argsOf(ctx, "strokeRect") as number[][];
    expect(second![2]).toBeGreaterThan(first![2]!);
  });
});

describe("Minimap pointer controls", () => {
  const RECT = { left: 100, top: 50, width: 200, height: 200 };
  const onMove = vi.fn();
  const onPeek = vi.fn();
  const onPeekEnd = vi.fn();

  /** A minimap placed at RECT on a fake screen. */
  function place(handlers = { onMove, onPeek, onPeekEnd }) {
    const s = setup(handlers);
    s.canvas.rect = { ...RECT };
    onMove.mockClear();
    onPeek.mockClear();
    onPeekEnd.mockClear();
    return s;
  }

  /** The nth call's world point (default: the last) is the point at this fraction of the minimap. */
  const expectAt = (fn: ReturnType<typeof vi.fn>, fx: number, fy: number, nth = -1): void => {
    const call = nth < 0 ? fn.mock.calls.at(nth) : fn.mock.calls[nth];
    expect(call![0]).toBeCloseTo(fx * SPAN, 6);
    expect(call![1]).toBeCloseTo(fy * SPAN, 6);
  };
  /** The pointer at a fraction of the minimap. */
  const at = (fx: number, fy: number) => ({ clientX: RECT.left + fx * RECT.width, clientY: RECT.top + fy * RECT.height });
  const down = (button: number, fx: number, fy: number, t = 0, extra = {}) =>
    fakeEvent("pointerdown", { pointerId: 1, button, buttons: 1 << (button === 2 ? 1 : 0), timeStamp: t, ...at(fx, fy), ...extra });
  const move = (buttons: number, fx: number, fy: number, t: number) =>
    fakeEvent("pointermove", { pointerId: 1, button: -1, buttons, timeStamp: t, ...at(fx, fy) });
  const up = (button: number, fx: number, fy: number, t: number, buttons = 0) =>
    fakeEvent("pointerup", { pointerId: 1, button, buttons, timeStamp: t, ...at(fx, fy) });

  it("sends the move order for a right-click at the world point under the cursor", () => {
    const { canvas } = place();
    canvas.dispatchEvent(down(2, 0.25, 0.5));
    expect(onMove).toHaveBeenCalledTimes(1);
    expectAt(onMove, 0.25, 0.5);
    expect(onPeek).not.toHaveBeenCalled();
  });

  it("maps the same click fraction to the same world point after the element moves and re-sizes", () => {
    const { canvas } = place();
    canvas.dispatchEvent(down(2, 0.4, 0.6));
    expectAt(onMove, 0.4, 0.6);
    canvas.dispatchEvent(up(2, 0.4, 0.6, 10));

    // A bigger window: the view changes and the element is placed elsewhere and larger.
    setView(computeLayout({ cssW: 2560, cssH: 1440, dpr: 2, hiDpi: true }));
    canvas.rect = { left: 2000, top: 900, width: 360, height: 360 };
    onMove.mockClear();
    canvas.dispatchEvent(fakeEvent("pointerdown", {
      pointerId: 1, button: 2, buttons: 2, timeStamp: 1000, clientX: 2000 + 0.4 * 360, clientY: 900 + 0.6 * 360,
    }));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0]![0]).toBeCloseTo(0.4 * SPAN, 6);
    expect(onMove.mock.calls[0]![1]).toBeCloseTo(0.6 * SPAN, 6);
  });

  it("clamps a right-click into the world", () => {
    const { canvas } = place();
    canvas.dispatchEvent(fakeEvent("pointerdown", { pointerId: 1, button: 2, buttons: 2, timeStamp: 0, clientX: 9999, clientY: -9999 }));
    expect(onMove).toHaveBeenCalledWith(WORLD_W, 0);
  });

  it("prevents the context menu and keeps the press out of the world underneath", () => {
    const { canvas, win } = place();
    const seen: string[] = [];
    for (const type of ["pointerdown", "mousedown", "touchstart", "contextmenu"]) win.addEventListener(type, () => seen.push(type));
    const ctxMenu = fakeEvent("contextmenu");
    expect(canvas.dispatchEvent(ctxMenu)).toBe(false);
    expect(ctxMenu.defaultPrevented).toBe(true);
    for (const e of [down(2, 0.5, 0.5), fakeEvent("mousedown", { button: 2 }), fakeEvent("touchstart")]) {
      canvas.dispatchEvent(e);
      expect(e.propagationStopped).toBe(true);
    }
    expect(seen).toEqual([]);
  });

  it("lets the release reach the window, so a press that began on the canvas and ended here is not left stuck down", () => {
    const { canvas, win } = place();
    const seen: string[] = [];
    for (const type of ["pointerup", "mouseup"]) win.addEventListener(type, () => seen.push(type));
    const pu = up(0, 0.5, 0.5, 0);
    const mu = fakeEvent("mouseup", { button: 0 });
    canvas.dispatchEvent(pu);
    canvas.dispatchEvent(mu);
    expect(pu.propagationStopped).toBe(false);
    expect(mu.propagationStopped).toBe(false);
    expect(seen).toEqual(["pointerup", "mouseup"]);
  });

  it("captures the pointer on a press", () => {
    const { canvas } = place();
    canvas.dispatchEvent(down(0, 0.5, 0.5));
    expect(canvas.hasPointerCapture(1)).toBe(true);
  });

  it("peeks while the left button is held, scrubbing as the pointer moves, and ends once on release", () => {
    const { canvas, win } = place();
    canvas.dispatchEvent(down(0, 0.25, 0.25));
    expect(onPeek).toHaveBeenCalledTimes(1);
    expectAt(onPeek, 0.25, 0.25);
    expect(canvas.classes.has("peeking")).toBe(true);
    win.dispatchEvent(move(1, 0.5, 0.75, 20));
    expect(onPeek).toHaveBeenCalledTimes(2);
    expectAt(onPeek, 0.5, 0.75);
    // The same world point again is not a new peek.
    win.dispatchEvent(move(1, 0.5, 0.75, 30));
    expect(onPeek).toHaveBeenCalledTimes(2);
    // The drag may leave the element (the pointer is captured): it clamps to the world.
    win.dispatchEvent(fakeEvent("pointermove", { pointerId: 1, buttons: 1, timeStamp: 40, clientX: 9999, clientY: 150 }));
    expect(onPeek).toHaveBeenLastCalledWith(WORLD_W, 0.5 * SPAN);
    expect(onPeekEnd).not.toHaveBeenCalled();
    win.dispatchEvent(up(0, 0.5, 0.5, 50));
    expect(onPeekEnd).toHaveBeenCalledTimes(1);
    expect(canvas.classes.has("peeking")).toBe(false);
    // Nothing after the release: moves, a second release, the lost capture, a blur.
    win.dispatchEvent(move(1, 0.1, 0.1, 60));
    win.dispatchEvent(up(0, 0.1, 0.1, 70));
    canvas.dispatchEvent(fakeEvent("lostpointercapture", { pointerId: 1 }));
    win.dispatchEvent(fakeEvent("blur"));
    expect(onPeekEnd).toHaveBeenCalledTimes(1);
    expect(onPeek).toHaveBeenCalledTimes(3);
  });

  const ways: Array<[string, (s: ReturnType<typeof place>) => void]> = [
    ["a pointerup on the window", ({ win }) => win.dispatchEvent(up(0, 0.9, 0.9, 5))],
    ["a pointercancel", ({ win }) => win.dispatchEvent(fakeEvent("pointercancel", { pointerId: 1 }))],
    ["the window losing focus", ({ win }) => win.dispatchEvent(fakeEvent("blur"))],
    ["the tab being hidden", ({ doc }) => { doc.visibilityState = "hidden"; doc.dispatchEvent(fakeEvent("visibilitychange")); }],
    ["the capture being lost", ({ canvas }) => canvas.dispatchEvent(fakeEvent("lostpointercapture", { pointerId: 1 }))],
  ];
  it.each(ways)("ends the peek, exactly once, on %s", (_name, release) => {
    const s = place();
    s.canvas.dispatchEvent(down(0, 0.5, 0.5));
    release(s);
    release(s);
    expect(onPeekEnd).toHaveBeenCalledTimes(1);
  });

  it("does not end the peek when the tab becomes visible again", () => {
    const { canvas, doc } = place();
    canvas.dispatchEvent(down(0, 0.5, 0.5));
    doc.visibilityState = "visible";
    doc.dispatchEvent(fakeEvent("visibilitychange"));
    expect(onPeekEnd).not.toHaveBeenCalled();
  });

  it("ignores the window's pointer events when the press did not begin on the minimap", () => {
    const { win } = place();
    win.dispatchEvent(move(1, 0.5, 0.5, 0));
    win.dispatchEvent(move(2, 0.5, 0.5, 10));
    win.dispatchEvent(up(0, 0.5, 0.5, 20));
    expect(onMove).not.toHaveBeenCalled();
    expect(onPeek).not.toHaveBeenCalled();
    expect(onPeekEnd).not.toHaveBeenCalled();
  });

  /** Moves the fake timers (and Date) to event time `t`, so a timer armed from an event fires when the event clock says. */
  const clockTo = (() => {
    let clock = 0;
    return Object.assign((t: number) => { vi.advanceTimersByTime(t - clock); clock = t; }, { reset: () => { clock = 0; vi.setSystemTime(0); } });
  })();

  it("repeats a held right-click's order at most every 100 ms, and only when the point moved", () => {
    vi.useFakeTimers();
    clockTo.reset();
    const { canvas, win } = place();
    canvas.dispatchEvent(down(2, 0.1, 0.1, 0));
    expect(onMove).toHaveBeenCalledTimes(1);
    // Moves inside the first 100 ms wait for their slot.
    clockTo(30);
    win.dispatchEvent(move(2, 0.2, 0.2, 30));
    clockTo(60);
    win.dispatchEvent(move(2, 0.3, 0.3, 60));
    clockTo(99);
    expect(onMove).toHaveBeenCalledTimes(1);
    // The slot opens at 100 ms and carries the newest point, not the one in between.
    clockTo(100);
    expect(onMove).toHaveBeenCalledTimes(2);
    expectAt(onMove, 0.3, 0.3);
    // The same point as the last order: nothing. A new point a slot after the last order: sent at once.
    clockTo(250);
    win.dispatchEvent(move(2, 0.3, 0.3, 250));
    expect(onMove).toHaveBeenCalledTimes(2);
    clockTo(260);
    win.dispatchEvent(move(2, 0.6, 0.6, 260));
    expect(onMove).toHaveBeenCalledTimes(3);
    expectAt(onMove, 0.6, 0.6);
    expect(canvas.classes.has("steering")).toBe(true);
  });

  it("never sends two orders closer than 100 ms apart during a drag", () => {
    vi.useFakeTimers();
    clockTo.reset();
    const { canvas, win } = place();
    const sentAt: number[] = [];
    onMove.mockImplementation(() => { sentAt.push(Date.now()); });
    canvas.dispatchEvent(down(2, 0.05, 0.05, 0));
    for (let i = 1; i <= 60; i++) {
      clockTo(i * 16);
      win.dispatchEvent(move(2, 0.05 + i * 0.01, 0.5, i * 16));
    }
    clockTo(60 * 16 + 500);
    expect(sentAt.length).toBeGreaterThan(5);
    for (let i = 1; i < sentAt.length; i++) expect(sentAt[i]! - sentAt[i - 1]!).toBeGreaterThanOrEqual(MOVE_REPEAT_MS);
    // The drag ended at x = 0.65: the last order is that point, even though the cursor stopped inside a slot.
    expectAt(onMove, 0.65, 0.5);
    onMove.mockReset();
  });

  it("ends a drag's order stream on release but still delivers the point it stopped at", () => {
    vi.useFakeTimers();
    clockTo.reset();
    const { canvas, win } = place();
    canvas.dispatchEvent(down(2, 0.1, 0.1, 0));
    clockTo(40);
    win.dispatchEvent(move(2, 0.8, 0.8, 40)); // held back
    clockTo(50);
    win.dispatchEvent(up(2, 0.8, 0.8, 50));
    expect(canvas.classes.has("steering")).toBe(false);
    expect(onMove).toHaveBeenCalledTimes(1);
    clockTo(100);
    expect(onMove).toHaveBeenCalledTimes(2);
    expectAt(onMove, 0.8, 0.8);
    clockTo(400);
    win.dispatchEvent(move(0, 0.2, 0.2, 400));
    expect(onMove).toHaveBeenCalledTimes(2);
  });

  it("drops a point still waiting when the window loses focus", () => {
    vi.useFakeTimers();
    clockTo.reset();
    const { canvas, win } = place();
    canvas.dispatchEvent(down(2, 0.1, 0.1, 0));
    clockTo(40);
    win.dispatchEvent(move(2, 0.8, 0.8, 40));
    win.dispatchEvent(fakeEvent("blur"));
    clockTo(1000);
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it("sends a fresh right press at once, even at the same point and inside the repeat window", () => {
    const { canvas, win } = place();
    canvas.dispatchEvent(down(2, 0.5, 0.5, 0));
    win.dispatchEvent(up(2, 0.5, 0.5, 10));
    canvas.dispatchEvent(down(2, 0.5, 0.5, 20));
    expect(onMove).toHaveBeenCalledTimes(2);
  });

  it("handles both buttons held: the second arrives as a pointermove and each ends on its own", () => {
    const { canvas, win } = place();
    canvas.dispatchEvent(down(0, 0.2, 0.2, 0));
    expect(onPeek).toHaveBeenCalledTimes(1);
    // Right pressed while left is held: the browser reports it as a move with both bits set.
    win.dispatchEvent(move(3, 0.2, 0.2, 10));
    expect(onMove).toHaveBeenCalledTimes(1);
    expectAt(onMove, 0.2, 0.2);
    // Right released: steering ends, the peek goes on.
    win.dispatchEvent(move(1, 0.4, 0.4, 20));
    expect(onPeekEnd).not.toHaveBeenCalled();
    expect(canvas.classes.has("steering")).toBe(false);
    expectAt(onPeek, 0.4, 0.4);
    win.dispatchEvent(up(0, 0.4, 0.4, 30));
    expect(onPeekEnd).toHaveBeenCalledTimes(1);
  });

  it("reads a context click on a Mac (button 0, only the right bit held) as a right-click", () => {
    const { canvas } = place();
    canvas.dispatchEvent(fakeEvent("pointerdown", { pointerId: 1, button: 0, buttons: 2, timeStamp: 0, ...at(0.5, 0.5) }));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onPeek).not.toHaveBeenCalled();
  });

  it("ignores the middle button", () => {
    const { canvas } = place();
    canvas.dispatchEvent(fakeEvent("pointerdown", { pointerId: 1, button: 1, buttons: 4, timeStamp: 0, ...at(0.5, 0.5) }));
    expect(onMove).not.toHaveBeenCalled();
    expect(onPeek).not.toHaveBeenCalled();
  });

  it("works with no handlers at all", () => {
    const { canvas, win } = setup();
    canvas.rect = { ...RECT };
    expect(() => {
      canvas.dispatchEvent(down(0, 0.5, 0.5));
      canvas.dispatchEvent(down(2, 0.5, 0.5));
      win.dispatchEvent(up(0, 0.5, 0.5, 5));
    }).not.toThrow();
  });

  it("repaints faster while a button is held, so the view rectangle keeps up with the cursor", () => {
    const { map, canvas, paint, paints, now } = place();
    paint();
    map.setMobs([mob({ x: 10 })]);
    map.update(now() + 40, undefined, true);
    expect(paints()).toBe(1); // idle: held to ~10 Hz
    canvas.dispatchEvent(down(0, 0.5, 0.5));
    map.update(now() + 40, undefined, true);
    expect(paints()).toBe(2);
  });

  it("removes every listener on destroy and ends a peek in progress", () => {
    vi.useFakeTimers();
    clockTo.reset();
    const { map, canvas, win, doc } = place();
    canvas.dispatchEvent(down(0, 0.5, 0.5, 0));
    clockTo(20);
    win.dispatchEvent(move(3, 0.6, 0.6, 20)); // right pressed while left is held: sent at once
    clockTo(40);
    win.dispatchEvent(move(3, 0.9, 0.9, 40)); // an order is now waiting for its slot
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(canvas.listenerCount()).toBeGreaterThan(0);
    expect(win.listenerCount()).toBeGreaterThan(0);
    map.destroy();
    expect(onPeekEnd).toHaveBeenCalledTimes(1);
    expect(canvas.listenerCount()).toBe(0);
    expect(win.listenerCount()).toBe(0);
    expect(doc.listenerCount()).toBe(0);
    expect(canvas.removed).toBe(true);
    expect(canvas.hasPointerCapture(1)).toBe(false);
    clockTo(1000);
    expect(onMove).toHaveBeenCalledTimes(1);
    // Events after the teardown do nothing.
    win.dispatchEvent(up(0, 0.5, 0.5, 1050));
    expect(onPeekEnd).toHaveBeenCalledTimes(1);
  });

  it("has nothing to end when destroyed idle", () => {
    const { map } = place();
    map.destroy();
    expect(onPeekEnd).not.toHaveBeenCalled();
  });
});

// The rectangle hit-test behind the tooltips of the HUD parts that never take the pointer (ui/rectTips.ts): which item is under the
// pointer, when the rectangles are read again, and that it only listens (passively) and lets go of everything on destroy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RectTips, isWorldTarget } from "../src/ui/rectTips";
import { FakeEl, fakeEvent, installFakeDom } from "./fakes";

beforeEach(() => { installFakeDom(); });
afterEach(() => { vi.unstubAllGlobals(); });

const CANVAS = { tagName: "CANVAS" };
const PANEL = { tagName: "DIV", closest: (sel: string) => (sel === "#ui" ? {} : null) };

function rig(active = true) {
  const dom = installFakeDom();
  const container = new FakeEl("div");
  const a = new FakeEl("div");
  const b = new FakeEl("div");
  container.rect = { left: 0, top: 100, width: 200, height: 20 };
  a.rect = { left: 0, top: 100, width: 90, height: 20 };
  b.rect = { left: 100, top: 100, width: 90, height: 20 };
  const seen: number[] = [];
  const state = { active };
  const tips = new RectTips({
    container: () => container as unknown as HTMLElement,
    items: () => [a, b] as unknown as HTMLElement[],
    active: () => state.active,
    onChange: (i) => seen.push(i),
  });
  const move = (x: number, y: number, target: unknown = CANVAS): void => { dom.win.dispatchEvent(fakeEvent("pointermove", { clientX: x, clientY: y, target })); };
  return { dom, container, a, b, seen, state, tips, move };
}

describe("RectTips", () => {
  it("tells the owner which item the pointer is over, and -1 off them (only on a change)", () => {
    const { move, seen, tips } = rig();
    move(10, 110);
    move(20, 110);
    move(150, 110);
    move(150, 300);
    move(150, 301);
    expect(seen).toEqual([0, 1, -1]);
    expect(tips.index).toBe(-1);
  });

  it("reads the rectangles again when the container moved or grew, or after invalidate/reset", () => {
    const { move, seen, container, a, b, tips } = rig();
    move(10, 110);
    expect(seen).toEqual([0]);
    // The container drops 40 px and the items with it; the old place is empty and the new one answers.
    container.rect = { left: 0, top: 140, width: 200, height: 20 };
    a.rect = { left: 0, top: 140, width: 90, height: 20 };
    b.rect = { left: 100, top: 140, width: 90, height: 20 };
    move(10, 110);
    expect(seen).toEqual([0, -1]);
    move(150, 150);
    expect(seen).toEqual([0, -1, 1]);
    // An item moves inside an unchanged container: nothing re-reads until told, so its new place is not found yet...
    b.rect = { left: 100, top: 400, width: 90, height: 20 };
    move(150, 410);
    expect(seen.at(-1)).toBe(-1);
    // ...and is once the owner invalidates.
    tips.invalidate();
    move(150, 410);
    expect(seen.at(-1)).toBe(1);
    tips.reset();
    expect(tips.index).toBe(-1);
  });

  it("shows nothing while inactive or over a panel of the interface, and hides on Escape, blur and a pointer leaving the window", () => {
    const { dom, move, seen, state } = rig();
    state.active = false;
    move(10, 110);
    expect(seen).toEqual([]);
    state.active = true;
    move(10, 110);
    move(10, 110, PANEL);
    expect(seen).toEqual([0, -1]);
    move(10, 110);
    dom.win.dispatchEvent(fakeEvent("keydown", { code: "Escape", key: "Escape" }));
    move(10, 110);
    dom.win.dispatchEvent(fakeEvent("blur"));
    move(10, 110);
    dom.win.dispatchEvent(fakeEvent("pointerout", { relatedTarget: null }));
    expect(seen).toEqual([0, -1, 0, -1, 0, -1, 0, -1]);
    move(10, 110);
    dom.win.dispatchEvent(fakeEvent("pointerout", { relatedTarget: {} }));
    expect(seen.at(-1)).toBe(0);
  });

  it("listens passively, never stops or cancels an event, and lets go of every listener on destroy", () => {
    const dom = installFakeDom();
    const added: Array<{ type: string; options: unknown }> = [];
    const original = dom.win.addEventListener.bind(dom.win);
    dom.win.addEventListener = ((type: string, fn: (e: unknown) => void, options?: unknown) => {
      added.push({ type, options });
      original(type, fn);
    }) as typeof dom.win.addEventListener;
    const tips = new RectTips({ container: () => new FakeEl("div") as never, items: () => [], active: () => true, onChange: () => {} });
    expect(added.find((x) => x.type === "pointermove")?.options).toEqual({ passive: true });
    expect(added.find((x) => x.type === "pointerout")?.options).toEqual({ passive: true });
    for (const type of ["pointermove", "pointerout"]) {
      const e = fakeEvent(type, { clientX: 1, clientY: 1, target: CANVAS, relatedTarget: null });
      dom.win.dispatchEvent(e);
      expect(e.defaultPrevented, type).toBe(false);
      expect(e.propagationStopped, type).toBe(false);
    }
    expect(dom.win.listenerCount()).toBe(5);
    tips.destroy();
    expect(dom.win.listenerCount()).toBe(0);
  });

  it("calls the canvas a world target and anything inside #ui an interface one", () => {
    expect(isWorldTarget(CANVAS as never)).toBe(true);
    expect(isWorldTarget(PANEL as never)).toBe(false);
    expect(isWorldTarget(null)).toBe(false);
  });
});

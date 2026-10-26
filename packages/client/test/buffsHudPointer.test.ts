// The build strip never takes the pointer (ui/buffsHud.ts, buffsHud.css): it sits over the world at the top left, up to about
// 420 px tall, so a right-click move or a left-click lock under it must reach the canvas, and the aim must keep streaming while the
// cursor is over it. Its tooltip is found by hit-testing the pointer against the chips' rectangles on a passive window listener.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUFFS, type BuffId } from "@raid/shared";
import type { PlayerState, RaidState } from "@raid/shared/schema";
import { BuffsHud, TIP_ON } from "../src/ui/buffsHud";
import { FakeEl, fakeEvent, installFakeDom } from "./fakes";

const css = readFileSync(new URL("../src/ui/buffsHud.css", import.meta.url), "utf8");

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1]!;
}

const me = (buffs: Partial<Record<BuffId, number>>): PlayerState =>
  ({ status: "alive", kills: 0, mobKills: 0, buffs }) as unknown as PlayerState;
const run = (): RaidState =>
  ({ phase: "active", mobs: new Map([["m", { kind: "mob" }]]), players: new Map() }) as unknown as RaidState;

const canvas = { tagName: "CANVAS" };
/** An element of the interface: a panel inside #ui. */
const panel = { tagName: "DIV", closest: (sel: string) => (sel === "#ui" ? {} : null) };

function setup(buffs: Partial<Record<BuffId, number>> = { emberImp: 1.1, bailiff: 1.1, acolyte: 1.1 }) {
  const dom = installFakeDom();
  const hud = new BuffsHud({ reducedMotion: () => false });
  const [strip] = (hud.root as unknown as FakeEl).children as FakeEl[];
  const chips = (strip!.children as FakeEl[]);
  hud.update(run(), me(buffs));
  const shown = BUFFS.map((b, i) => ({ id: b.id, i })).filter(({ i }) => !chips[i]!.hidden);
  // Stack the shown chips down the left edge: 256 wide, 30 tall, 3 apart, from (12, 100).
  shown.forEach(({ i }, k) => { chips[i]!.rect = { left: 12, top: 100 + k * 33, width: 256, height: 30 }; });
  strip!.rect = { left: 12, top: 100, width: 256, height: shown.length * 33 };
  const move = (x: number, y: number, target: unknown = canvas): void => {
    dom.win.dispatchEvent(fakeEvent("pointermove", { clientX: x, clientY: y, target }));
  };
  /** The chip whose tooltip is up, as a catalog id (or null). */
  const tipOn = (): BuffId | null => {
    const at = chips.findIndex((c) => c.classes.has(TIP_ON));
    return at < 0 ? null : BUFFS[at]!.id;
  };
  /** The centre of the k-th shown chip. */
  const centre = (k: number): [number, number] => [12 + 128, 100 + k * 33 + 15];
  return { dom, hud, strip: strip!, chips, shown, move, tipOn, centre };
}

beforeEach(() => { vi.useRealTimers(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("the strip does not take the pointer", () => {
  it("is click-through in the stylesheet: the plate, the strip and every chip are pointer-events none, and nothing turns it back on", () => {
    for (const selector of [".hud-buffs", ".buff-strip", ".buff-chip"]) expect(rule(selector)).toMatch(/pointer-events:\s*none/);
    expect(css).not.toMatch(/pointer-events:\s*auto/);
    // The tooltip is not a :hover (it would never fire): the class the script sets shows it.
    expect(css).not.toMatch(/\.buff-[\w-]*:hover/);
    expect(rule(".buff-chip.tip-on .buff-tip")).toMatch(/display:\s*block/);
    expect(rule(".buff-tip")).toMatch(/pointer-events:\s*none/);
  });

  it("puts no pointer, mouse or click handler on the plate, the strip or a chip", () => {
    const { hud, strip, chips } = setup();
    const nodes = [hud.root as unknown as FakeEl, strip, ...chips];
    for (const type of ["pointerdown", "pointerup", "pointermove", "pointerenter", "pointerleave", "pointerover", "pointerout",
      "mousedown", "mouseup", "mousemove", "mouseenter", "mouseleave", "mouseover", "click", "contextmenu", "wheel", "touchstart"]) {
      for (const node of nodes) expect(node.listenerCount(type), `${type} on ${node.className}`).toBe(0);
    }
  });

  it("listens for the pointer on the window, passively, and never stops or cancels what it hears", () => {
    const dom = installFakeDom();
    const added: Array<{ type: string; options: unknown }> = [];
    const original = dom.win.addEventListener.bind(dom.win);
    dom.win.addEventListener = ((type: string, fn: (e: unknown) => void, options?: unknown) => {
      added.push({ type, options });
      original(type, fn);
    }) as typeof dom.win.addEventListener;
    const hud = new BuffsHud({ reducedMotion: () => false });
    expect(added.find((a) => a.type === "pointermove")?.options).toEqual({ passive: true });
    hud.update(run(), me({ emberImp: 1.1 }));
    for (const type of ["pointermove", "pointerdown", "pointerup", "pointerout"]) {
      const e = fakeEvent(type, { clientX: 20, clientY: 20, target: canvas, relatedTarget: null });
      dom.win.dispatchEvent(e);
      expect(e.defaultPrevented, type).toBe(false);
      expect(e.propagationStopped, type).toBe(false);
    }
  });

  it("a press over a chip is nobody's but the canvas': a pointerdown at a chip's centre changes nothing in the strip", () => {
    const { dom, hud, move, centre, tipOn } = setup();
    move(...centre(0));
    const before = tipOn();
    const [x, y] = centre(0);
    const down = fakeEvent("pointerdown", { clientX: x, clientY: y, button: 2, target: canvas });
    dom.win.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    expect(down.propagationStopped).toBe(false);
    expect(tipOn()).toBe(before);
    expect((hud.root as unknown as FakeEl).hidden).toBe(false);
  });
});

describe("the tooltip follows the pointer by hit-testing the chips", () => {
  it("shows the chip under the pointer, moves with it, and hides when the pointer is off the chips", () => {
    const { move, tipOn, centre, shown } = setup();
    expect(tipOn()).toBeNull();
    move(...centre(0));
    expect(tipOn()).toBe(shown[0]!.id);
    move(...centre(2));
    expect(tipOn()).toBe(shown[2]!.id);
    move(...centre(1));
    expect(tipOn()).toBe(shown[1]!.id);
    move(400, centre(1)[1]); // right of the strip
    expect(tipOn()).toBeNull();
    move(...centre(0));
    expect(tipOn()).toBe(shown[0]!.id);
    move(140, 5); // above it
    expect(tipOn()).toBeNull();
  });

  it("only one tooltip at a time, and the gap between two chips shows none", () => {
    const { move, chips } = setup();
    move(140, 100 + 15);
    move(140, 100 + 30 + 1); // the 3 px gap
    expect(chips.filter((c) => c.classes.has(TIP_ON))).toHaveLength(0);
    move(140, 100 + 33 + 5);
    expect(chips.filter((c) => c.classes.has(TIP_ON))).toHaveLength(1);
  });

  it("hides on blur, on Escape, and when the pointer leaves the page, and shows again on the next move", () => {
    const { dom, move, tipOn, centre } = setup();
    for (const hide of [
      () => dom.win.dispatchEvent(fakeEvent("blur")),
      () => dom.win.dispatchEvent(fakeEvent("keydown", { code: "Escape", key: "Escape" })),
      () => dom.win.dispatchEvent(fakeEvent("pointerout", { relatedTarget: null })),
    ]) {
      move(...centre(1));
      expect(tipOn()).not.toBeNull();
      hide();
      expect(tipOn()).toBeNull();
    }
    move(...centre(1));
    expect(tipOn()).not.toBeNull();
  });

  it("keeps the tooltip when the pointer only moves from one element to another (pointerout with a related target) and for other keys", () => {
    const { dom, move, tipOn, centre } = setup();
    move(...centre(0));
    dom.win.dispatchEvent(fakeEvent("pointerout", { relatedTarget: canvas }));
    dom.win.dispatchEvent(fakeEvent("keydown", { code: "KeyS", key: "s" }));
    expect(tipOn()).not.toBeNull();
  });

  it("shows nothing while the pointer is over a panel of the interface (a card laid over the HUD), and clears one that was up", () => {
    const { move, tipOn, centre } = setup();
    move(...centre(0), panel);
    expect(tipOn()).toBeNull();
    move(...centre(0));
    expect(tipOn()).not.toBeNull();
    move(...centre(0), panel);
    expect(tipOn()).toBeNull();
  });

  it("hides with the strip (the player died, the buffs went) and with the chip (its buff fell to nothing)", () => {
    const { hud, move, tipOn, centre, shown } = setup();
    move(...centre(0));
    expect(tipOn()).toBe(shown[0]!.id);
    hud.update(run(), { ...me({ emberImp: 1.1, bailiff: 1.1, acolyte: 1.1 }), status: "dead" } as unknown as PlayerState);
    expect(tipOn()).toBeNull();
    move(...centre(0));
    expect(tipOn()).toBeNull(); // the strip is hidden: no tooltip appears

    hud.update(run(), me({ emberImp: 1.1, bailiff: 1.1, acolyte: 1.1 }));
    move(...centre(0));
    expect(tipOn()).toBe(shown[0]!.id);
    hud.update(run(), me({ bailiff: 1.1, acolyte: 1.1 })); // the chip under the pointer is gone
    expect(tipOn()).toBeNull();
  });

  it("reads the rectangles once per layout: not on every move, again after the strip repaints, resizes, or moves", () => {
    const { dom, hud, chips, strip, shown, move, centre } = setup();
    let count = 0;
    const reads = (): number => count;
    for (const c of chips) {
      const get = c.getBoundingClientRect.bind(c);
      c.getBoundingClientRect = () => { count++; return get(); };
    }
    move(...centre(0));
    const first = reads();
    expect(first).toBe(shown.length); // the shown chips, read once
    for (let k = 0; k < 20; k++) move(...centre(k % shown.length));
    expect(reads()).toBe(first);
    // A repaint (a chip gained stacks) reads them again.
    hud.update(run(), me({ emberImp: 2.5, bailiff: 1.1, acolyte: 1.1 }));
    move(...centre(0));
    expect(reads()).toBe(first * 2);
    // A resize does too.
    dom.win.dispatchEvent(fakeEvent("resize"));
    move(...centre(0));
    expect(reads()).toBe(first * 3);
    // And a strip that moved without either (the status line above it wrapped).
    strip.rect = { ...strip.rect, top: strip.rect.top + 18 };
    move(...centre(0));
    expect(reads()).toBe(first * 4);
  });

  it("follows a chip that moved: the new rectangle decides, not the old", () => {
    const { move, tipOn, strip, chips, shown } = setup();
    move(140, 100 + 15);
    expect(tipOn()).toBe(shown[0]!.id);
    strip.rect = { ...strip.rect, top: 200 };
    shown.forEach(({ i }, k) => { chips[i]!.rect = { left: 12, top: 200 + k * 33, width: 256, height: 30 }; });
    move(140, 100 + 15);
    expect(tipOn()).toBeNull();
    move(140, 200 + 15);
    expect(tipOn()).toBe(shown[0]!.id);
  });

  it("has no tab stop or key of its own: a chip is no focusable element", () => {
    const { chips, strip } = setup();
    for (const node of [strip, ...chips]) {
      expect((node as unknown as { tabIndex?: number }).tabIndex).toBeUndefined();
      expect(node.listenerCount("keydown")).toBe(0);
      expect(node.listenerCount("focus")).toBe(0);
    }
  });

  it("takes its window listeners off on destroy", () => {
    const { dom, hud, move, tipOn, centre } = setup();
    hud.destroy();
    for (const type of ["pointermove", "pointerout", "blur", "keydown", "resize"]) expect(dom.win.listenerCount(type), type).toBe(0);
    move(...centre(0));
    expect(tipOn()).toBeNull();
  });
});

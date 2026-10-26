// The H help card (ui/helpOverlay.ts): the controls table, kept honest against the scenes' own key handlers, and the card's
// open / close behaviour on the fake DOM.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HELP_SECTIONS, HelpOverlay, helpSectionOrder, isMouseLabel } from "../src/ui/helpOverlay";
import { fake, installChromeDom } from "./chromeDom";

afterEach(() => { vi.unstubAllGlobals(); });

const bindings = HELP_SECTIONS.flatMap((s) => s.bindings.map((b) => ({ ...b, section: s.id })));
const find = (section: string, key: string, action?: RegExp) =>
  bindings.find((b) => b.section === section && b.keys.includes(key) && (!action || action.test(b.action)));

describe("the controls table", () => {
  it("has a run, a hub and an anywhere section, each with a title and bindings", () => {
    expect(HELP_SECTIONS.map((s) => s.id)).toEqual(["run", "hub", "anywhere"]);
    for (const s of HELP_SECTIONS) {
      expect(s.title.length).toBeGreaterThan(3);
      expect(s.bindings.length).toBeGreaterThan(0);
    }
  });

  it("gives every binding at least one key label and a short action, with no empty strings", () => {
    for (const b of bindings) {
      expect(b.keys.length).toBeGreaterThan(0);
      for (const k of b.keys) expect(k.trim()).not.toBe("");
      expect(b.action.trim()).not.toBe("");
      expect(b.action.length).toBeLessThanOrEqual(60);
      if (b.join !== undefined) expect(["+", "/", ""]).toContain(b.join);
    }
  });

  it("lists the run controls the owner named", () => {
    expect(find("run", "Right-click", /^Move/)).toBeDefined();
    expect(find("run", "Left-click", /lock the nearest enemy and attack/i)).toBeDefined();
    expect(find("run", "S", /stop/i)).toBeDefined();
    const slots = find("run", "1");
    expect(slots?.keys).toEqual(["1", "2"]);
    expect(slots?.action).toMatch(/weapon slot/i);
    expect(find("run", "Q", /swap/i)).toBeDefined();
    expect(find("run", "F", /pick up/i)).toBeDefined();
    expect(find("run", "Right-click", /minimap/i)?.action).toMatch(/move/i);
    expect(find("run", "Hold left-click", /minimap/i)?.action).toMatch(/peek/i);
    expect(find("run", "Esc", /leave practice/i)).toBeDefined();
  });

  it("lists the hub controls: walking and the station key", () => {
    expect(find("hub", "WASD")?.keys).toEqual(["WASD", "Arrow keys"]);
    expect(find("hub", "E", /station/i)).toBeDefined();
    expect(find("hub", "Right-click")).toBeDefined();
  });

  it("lists Alt+Enter as a chord, H, and Esc as general controls", () => {
    const alt = find("anywhere", "Alt");
    expect(alt?.keys).toEqual(["Alt", "Enter"]);
    expect(alt?.join).toBe("+");
    expect(alt?.action).toMatch(/fullscreen/i);
    expect(find("anywhere", "H", /help/i)).toBeDefined();
    expect(find("anywhere", "Esc")).toBeDefined();
  });

  it("is backed by the real handlers: every key it names is read by a scene or by the chrome", () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    const raid = read("../src/scenes/RaidScene.ts");
    const hub = read("../src/scenes/HubScene.ts");
    const chrome = read("../src/ui/chrome.ts");
    for (const code of ['"KeyS"', '"KeyQ"', '"KeyF"', '"Escape"', "(?:Digit|Numpad)([12])"]) expect(raid).toContain(code);
    expect(raid).toMatch(/pointer\.button === 2/);
    expect(raid).toMatch(/pointer\.button === 0/);
    for (const code of ['"KeyE"', "KeyW:", "KeyA:", "KeyS:", "KeyD:", "ArrowUp:", "ArrowDown:", "ArrowLeft:", "ArrowRight:"]) expect(hub).toContain(code);
    expect(hub).toMatch(/pointer\.button === 2/);
    for (const code of ['"KeyH"', '"Enter"', '"Escape"']) expect(chrome).toContain(code);
  });

  it("orders the sections with the current place first and the general controls last", () => {
    expect(helpSectionOrder("run")).toEqual(["run", "hub", "anywhere"]);
    expect(helpSectionOrder("hub")).toEqual(["hub", "run", "anywhere"]);
    expect(helpSectionOrder("anywhere")).toEqual(["run", "hub", "anywhere"]);
  });

  it("draws labels with 'click' in them as mouse buttons", () => {
    expect(isMouseLabel("Right-click")).toBe(true);
    expect(isMouseLabel("Hold left-click")).toBe(true);
    expect(isMouseLabel("Q")).toBe(false);
    expect(isMouseLabel("Enter")).toBe(false);
  });
});

describe("HelpOverlay", () => {
  function setup(onClose?: () => void) {
    const { doc } = installChromeDom();
    const help = new HelpOverlay(onClose ? { onClose } : {});
    const root = fake(help.element);
    doc.ui.append(root);
    return { help, doc, root };
  }

  it("is built closed", () => {
    const { help, root } = setup();
    expect(help.isOpen).toBe(false);
    expect(root.hidden).toBe(true);
  });

  it("draws every key of every binding as a keycap, and every action as text", () => {
    const { help, root } = setup();
    const caps = root.find((e) => e.tagName === "KBD");
    expect(caps).toHaveLength(HELP_SECTIONS.flatMap((s) => s.bindings).reduce((n, b) => n + b.keys.length, 0));
    for (const cap of caps) expect(cap.className).toMatch(/^keycap/);
    const text = root.allText;
    for (const b of bindings) expect(text).toContain(b.action);
    const mouseCaps = caps.filter((c) => c.className.includes("mouse")).map((c) => c.textContent);
    expect(mouseCaps).toContain("Right-click");
    expect(mouseCaps).not.toContain("Q");
  });

  it("joins a chord with + and alternatives with /", () => {
    const { help, root } = setup();
    const joins = root.byClass("help-join").map((e) => e.textContent);
    expect(joins).toContain("+");
    expect(joins).toContain("/");
  });

  it("opens, and puts the current place's controls first", () => {
    const { help, root } = setup();
    const order = (id: string) => Number(root.byClass("help-section").find((s) => s.byClass("help-section-title")[0]!.textContent === HELP_SECTIONS.find((h) => h.id === id)!.title)!.style.order);
    help.open("hub");
    expect(help.isOpen).toBe(true);
    expect([order("hub"), order("run"), order("anywhere")]).toEqual([0, 1, 2]);
    help.open("run");
    expect([order("run"), order("hub"), order("anywhere")]).toEqual([0, 1, 2]);
  });

  it("is a labelled dialog that takes focus when it opens", () => {
    const { help, doc, root } = setup();
    help.open();
    const card = root.byClass("help-card")[0]!;
    expect(card.getAttribute("role")).toBe("dialog");
    expect(card.getAttribute("aria-modal")).toBe("true");
    const title = root.byClass("help-title")[0]!;
    expect(card.getAttribute("aria-labelledby")).toBe(title.id);
    expect(doc.activeElement).toBe(card);
  });

  it("closes from its close button, which is labelled for a screen reader", () => {
    const { help, root } = setup();
    help.open();
    const close = root.byClass("help-close")[0]!;
    expect(close.getAttribute("aria-label")).toBe("Close help");
    close.click();
    expect(help.isOpen).toBe(false);
  });

  it("closes on a click outside the card, not on a click inside it", () => {
    const { help, root } = setup();
    help.open();
    root.byClass("help-card")[0]!.click();
    root.byClass("help-title")[0]!.click();
    expect(help.isOpen).toBe(true);
    root.click();
    expect(help.isOpen).toBe(false);
  });

  it("asks its owner to close when given onClose, instead of closing itself", () => {
    const onClose = vi.fn();
    const { help, root } = setup(onClose);
    help.open();
    root.click();
    root.byClass("help-close")[0]!.click();
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(help.isOpen).toBe(true);
  });

  it("knows whether a node is inside it", () => {
    const { help, doc, root } = setup();
    expect(help.contains(root.byClass("help-close")[0]! as never)).toBe(true);
    expect(help.contains(doc.body as never)).toBe(false);
    expect(help.contains(null)).toBe(false);
  });
});

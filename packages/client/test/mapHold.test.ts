// Hold Tab for the map (ui/mapHold.ts): it takes Tab only when a run is on and nothing else wants it, lets go on key-up, on a
// lost window and on a hidden tab, and leaves the settings and help cards their focus navigation.
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapHold, insidePanel, mapHoldAllowed, type HoldKey } from "../src/ui/mapHold";
import { installPlanningDom, asEl } from "./planningDom";

afterEach(() => { vi.unstubAllGlobals(); });

function key(over: Partial<HoldKey> = {}): HoldKey & { prevented: boolean } {
  const k = {
    code: "Tab", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, target: null as unknown, prevented: false,
    preventDefault() { k.prevented = true; },
    ...over,
  };
  return k;
}

function hold(over: { allowed?: boolean; focused?: unknown } = {}) {
  const state = { allowed: over.allowed ?? true, focused: over.focused ?? null as unknown };
  const changes: boolean[] = [];
  const h = new MapHold(() => state.allowed, (held) => changes.push(held), () => state.focused);
  return { h, state, changes };
}

describe("mapHoldAllowed", () => {
  it("is a run that is on, not practice, with no results panel up (a death shows it while the phase is still active)", () => {
    expect(mapHoldAllowed({ phase: "active" }, false)).toBe(true);
    expect(mapHoldAllowed({ phase: "active", training: false }, false)).toBe(true);
    expect(mapHoldAllowed({ phase: "active", training: true }, false)).toBe(false);
    expect(mapHoldAllowed({ phase: "active" }, true)).toBe(false);
    for (const phase of ["lobby", "planning", "ended"]) expect(mapHoldAllowed({ phase }, false)).toBe(false);
  });

  it("lets Tab reach the results panel's button: a hold built on it takes nothing while the panel is up", () => {
    let results = true;
    const h = new MapHold(() => mapHoldAllowed({ phase: "active" }, results), () => {}, () => null);
    const e = key();
    expect(h.keyDown(e)).toBe(false);
    expect(e.prevented).toBe(false);
    results = false;
    expect(h.keyDown(key())).toBe(true);
  });
});

describe("MapHold.keyDown", () => {
  it("takes Tab in a run: holds, tells the scene once, and cancels the browser's own Tab", () => {
    const { h, changes } = hold();
    const e = key();
    expect(h.keyDown(e)).toBe(true);
    expect(e.prevented).toBe(true);
    expect(h.held).toBe(true);
    // The key repeats while held: still cancelled (no focus walk), but the hold does not change again.
    const again = key({ repeat: true });
    expect(h.keyDown(again)).toBe(true);
    expect(again.prevented).toBe(true);
    expect(changes).toEqual([true]);
  });

  it("lets Tab through when no run is on (the lobby, planning, practice, a finished run)", () => {
    const { h, state, changes } = hold({ allowed: false });
    const e = key();
    expect(h.keyDown(e)).toBe(false);
    expect(e.prevented).toBe(false);
    expect(h.held).toBe(false);
    state.allowed = true;
    expect(h.keyDown(key())).toBe(true);
    expect(changes).toEqual([true]);
  });

  it("ignores every other key, and Tab with a modifier (Shift+Tab, Ctrl+Tab, Alt+Tab, Cmd+Tab)", () => {
    const { h } = hold();
    for (const over of [{ code: "KeyM" }, { code: "Escape" }, { shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      const e = key(over);
      expect(h.keyDown(e)).toBe(false);
      expect(e.prevented).toBe(false);
    }
    expect(h.held).toBe(false);
  });

  it("leaves Tab to a text field and to an open panel, which keep their focus navigation", () => {
    installPlanningDom();
    const field = asEl(document.createElement("input"));
    const card = asEl(document.createElement("div"));
    card.classList.add("settings-panel");
    const inner = asEl(document.createElement("button"));
    card.append(inner);
    const scrim = asEl(document.createElement("div"));
    scrim.classList.add("help-scrim");
    const helpButton = asEl(document.createElement("button"));
    scrim.append(helpButton);
    const { h, state } = hold();
    for (const node of [field, inner, helpButton]) {
      for (const via of ["target", "focus"] as const) {
        state.focused = via === "focus" ? node : null;
        const e = key({ target: via === "target" ? node : null });
        expect(h.keyDown(e)).toBe(false);
        expect(e.prevented).toBe(false);
      }
    }
    expect(h.held).toBe(false);
    // A plain button outside any panel is not in the way.
    state.focused = asEl(document.createElement("button"));
    expect(h.keyDown(key({ target: state.focused }))).toBe(true);
  });
});

describe("MapHold: letting go", () => {
  it("lets go on Tab's key-up, once, and on nothing else", () => {
    const { h, changes } = hold();
    h.keyDown(key());
    h.keyUp({ code: "KeyM" });
    expect(h.held).toBe(true);
    h.keyUp({ code: "Tab" });
    h.keyUp({ code: "Tab" });
    expect(h.held).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it("lets go when told to (the window lost focus, the run ended)", () => {
    const { h, changes } = hold();
    h.keyDown(key());
    h.release();
    h.release();
    expect(h.held).toBe(false);
    expect(changes).toEqual([true, false]);
  });
});

describe("MapHold.bind: the window", () => {
  it("listens for Tab on the window, lets go on a blur and when the tab is hidden, and stops listening when unbound", () => {
    const dom = installPlanningDom();
    const { h } = hold({ focused: dom.doc.body });
    const unbind = h.bind();
    expect(dom.win.count("keydown")).toBe(1);
    expect(dom.win.count("keyup")).toBe(1);
    const down = dom.doc.body.dispatch("keydown", { code: "Tab", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false });
    expect(down.defaultPrevented).toBe(true);
    expect(h.held).toBe(true);
    dom.doc.body.dispatch("keyup", { code: "Tab" });
    expect(h.held).toBe(false);
    dom.doc.body.dispatch("keydown", { code: "Tab", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false });
    dom.doc.body.dispatch("blur");
    // `blur` on the body is not the window's: the fake dispatches it up the tree, so it reached the window listener too.
    expect(h.held).toBe(false);
    dom.doc.body.dispatch("keydown", { code: "Tab", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false });
    dom.doc.visibilityState = "hidden";
    dom.doc.body.dispatch("visibilitychange");
    expect(h.held).toBe(false);
    dom.doc.body.dispatch("keydown", { code: "Tab", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false });
    expect(h.held).toBe(true);
    unbind();
    expect(h.held).toBe(false);
    expect(dom.win.count("keydown")).toBe(0);
    expect(dom.win.count("keyup")).toBe(0);
    expect(dom.win.count("blur")).toBe(0);
    expect(dom.doc.count("visibilitychange")).toBe(0);
  });
});

describe("insidePanel", () => {
  it("finds the settings card and the help card from anything inside them", () => {
    installPlanningDom();
    const card = asEl(document.createElement("div"));
    card.classList.add("settings-panel");
    const row = asEl(document.createElement("div"));
    const button = asEl(document.createElement("button"));
    row.append(button);
    card.append(row);
    expect(insidePanel(button)).toBe(true);
    expect(insidePanel(card)).toBe(true);
    expect(insidePanel(asEl(document.createElement("button")))).toBe(false);
    expect(insidePanel(null)).toBe(false);
    expect(insidePanel(undefined)).toBe(false);
    expect(insidePanel({ classList: { contains: (c: string) => c === "help-scrim" } })).toBe(true);
    const child = { classList: { contains: () => false }, parentElement: { classList: { contains: (c: string) => c === "settings-panel" }, parentElement: null } };
    expect(insidePanel(child)).toBe(true);
    expect(insidePanel({ classList: { contains: () => false }, parentElement: null })).toBe(false);
  });

  it("finds the camp chest panel too, from its cards and its Skip button", () => {
    installPlanningDom();
    const panel = asEl(document.createElement("div"));
    panel.classList.add("chest-panel");
    const box = asEl(document.createElement("div"));
    const card = asEl(document.createElement("button"));
    card.classList.add("cp-card");
    box.append(card);
    panel.append(box);
    expect(insidePanel(card)).toBe(true);
    expect(insidePanel(panel)).toBe(true);
    const { h, state } = hold();
    state.focused = card;
    const e = key({ target: card });
    expect(h.keyDown(e)).toBe(false);
    expect(e.prevented).toBe(false);
    expect(h.held).toBe(false);
  });
});

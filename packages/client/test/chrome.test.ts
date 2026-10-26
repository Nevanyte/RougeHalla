// The page chrome (ui/chrome.ts): the key rules, and the cluster, panels and keys on the fake DOM. The key point of the DOM
// tests is that Esc is consumed only when a panel is open (so RaidScene's Esc-leaves-training still works otherwise) and that
// no chrome key fires while the player types.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FullscreenApi } from "../src/fullscreen";
import { SettingsStore } from "../src/settings";
import { Chrome, chromeKeyAction, isTypingTarget, type KeyInfo } from "../src/ui/chrome";
import { HELP_SECTIONS } from "../src/ui/helpOverlay";
import { FEl, installChromeDom, type KeyInit } from "./chromeDom";

afterEach(() => { vi.unstubAllGlobals(); });

const key = (over: Partial<KeyInfo> = {}): KeyInfo => ({
  code: "", key: "", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, ...over,
});
const free = { panelOpen: false, typing: false };

describe("chromeKeyAction", () => {
  it("Alt+Enter is fullscreen, on either Enter key", () => {
    expect(chromeKeyAction(key({ code: "Enter", altKey: true }), free)).toBe("fullscreen");
    expect(chromeKeyAction(key({ code: "NumpadEnter", altKey: true }), free)).toBe("fullscreen");
  });

  it("Alt+Enter works while typing (no text results from it), but not with Ctrl or Meta, nor held down", () => {
    expect(chromeKeyAction(key({ code: "Enter", altKey: true }), { panelOpen: false, typing: true })).toBe("fullscreen");
    expect(chromeKeyAction(key({ code: "Enter", altKey: true, ctrlKey: true }), free)).toBeNull();
    expect(chromeKeyAction(key({ code: "Enter", altKey: true, metaKey: true }), free)).toBeNull();
    expect(chromeKeyAction(key({ code: "Enter", altKey: true, repeat: true }), free)).toBeNull();
    expect(chromeKeyAction(key({ code: "Enter" }), free)).toBeNull();
  });

  it("an Alt chord with any other key is not ours", () => {
    expect(chromeKeyAction(key({ code: "KeyH", altKey: true }), free)).toBeNull();
    expect(chromeKeyAction(key({ code: "Escape", altKey: true }), { panelOpen: true, typing: false })).toBeNull();
  });

  it("H opens help, but not with a modifier, not held, and not while typing", () => {
    expect(chromeKeyAction(key({ code: "KeyH" }), free)).toBe("help");
    for (const mod of ["ctrlKey", "metaKey", "shiftKey"] as const) expect(chromeKeyAction(key({ code: "KeyH", [mod]: true }), free)).toBeNull();
    expect(chromeKeyAction(key({ code: "KeyH", repeat: true }), free)).toBeNull();
    expect(chromeKeyAction(key({ code: "KeyH" }), { panelOpen: false, typing: true })).toBeNull();
  });

  it("H also closes the help when it is open", () => {
    expect(chromeKeyAction(key({ code: "KeyH" }), { panelOpen: true, typing: false })).toBe("help");
  });

  it("Esc closes a panel, and is left to the scene when none is open or the player types", () => {
    expect(chromeKeyAction(key({ code: "Escape" }), { panelOpen: true, typing: false })).toBe("close");
    expect(chromeKeyAction(key({ code: "Escape" }), { panelOpen: false, typing: false })).toBeNull();
    expect(chromeKeyAction(key({ code: "Escape" }), { panelOpen: true, typing: true })).toBeNull();
    expect(chromeKeyAction(key({ code: "Escape", ctrlKey: true }), { panelOpen: true, typing: false })).toBeNull();
  });

  it("ignores the game keys", () => {
    for (const code of ["KeyS", "KeyQ", "KeyF", "Digit1", "Digit2", "KeyE", "KeyW", "Space"]) expect(chromeKeyAction(key({ code }), free)).toBeNull();
  });
});

describe("isTypingTarget", () => {
  const node = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra });

  it("is true for text fields, text areas, selects and editable content", () => {
    expect(isTypingTarget(node("INPUT", { type: "text" }))).toBe(true);
    expect(isTypingTarget(node("INPUT", { type: "search" }))).toBe(true);
    expect(isTypingTarget(node("INPUT"))).toBe(true);
    expect(isTypingTarget(node("input", { type: "TEXT" }))).toBe(true);
    expect(isTypingTarget(node("TEXTAREA"))).toBe(true);
    expect(isTypingTarget(node("SELECT"))).toBe(true);
    expect(isTypingTarget(node("DIV", { isContentEditable: true }))).toBe(true);
  });

  it("is false for sliders, checkboxes, buttons and ordinary elements, so the panel's own controls don't block Esc", () => {
    for (const type of ["range", "checkbox", "radio", "button", "submit", "color"]) expect(isTypingTarget(node("INPUT", { type }))).toBe(false);
    expect(isTypingTarget(node("BUTTON"))).toBe(false);
    expect(isTypingTarget(node("BODY"))).toBe(false);
  });

  it("is false for no target at all", () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
    expect(isTypingTarget("input")).toBe(false);
  });
});

function fakeFullscreen(supported = true) {
  const state = { supported, active: false };
  const listeners = new Set<() => void>();
  const api: FullscreenApi & { state: typeof state; toggles: number; changed(): void } = {
    state,
    toggles: 0,
    supported: () => state.supported,
    active: () => state.active,
    toggle: async () => { api.toggles++; state.active = !state.active; return true; },
    onChange: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    changed() { for (const cb of [...listeners]) cb(); },
  };
  return api;
}

function setup(over: { supported?: boolean; os?: boolean; room?: object | null } = {}) {
  const { doc, win, ui } = installChromeDom();
  win.osReducedMotion = over.os ?? false;
  const data = new Map<string, string>();
  const store = new SettingsStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } });
  const fullscreen = fakeFullscreen(over.supported ?? true);
  let room: object | null = over.room ?? null;
  const chrome = new Chrome({ game: {} as never, room: () => room as never, settings: store, fullscreen });
  /** What a scene would see: a bubbling window listener, e.g. RaidScene.handleKey. */
  const sceneKeys: Array<{ code: string; defaultPrevented: boolean }> = [];
  win.addEventListener("keydown", (e: { code: string; defaultPrevented: boolean }) => sceneKeys.push({ code: e.code, defaultPrevented: e.defaultPrevented }));
  const q = (cls: string): FEl => ui.byClass(cls)[0]!;
  const buttons = ui.byClass("chrome-btn");
  const [fsButton, settingsButton, helpButton] = buttons as [FEl, FEl, FEl];
  const press = (init: KeyInit) => win.press(init);
  const textField = new FEl("INPUT");
  textField.type = "text";
  return {
    chrome, doc, win, ui, store, fullscreen, q, fsButton, settingsButton, helpButton, press, sceneKeys, textField, buttons,
    setRoom: (r: object | null) => { room = r; },
    settingsPanel: q("settings-panel"),
    helpScrim: q("help-scrim"),
  };
}

describe("Chrome: the cluster", () => {
  it("puts the readout and three labelled buttons in the overlay, with the keys in the tooltips", () => {
    const { ui, q, buttons, fsButton, settingsButton, helpButton } = setup();
    expect(q("chrome").parent).toBe(ui);
    expect(q("perf")).toBeDefined();
    expect(buttons).toHaveLength(3);
    for (const b of buttons) {
      expect(b.tagName).toBe("BUTTON");
      expect(b.type).toBe("button");
      expect(b.getAttribute("aria-label")).toBeTruthy();
      expect(b.title).toBeTruthy();
      expect(b.innerHTML).toContain("<svg");
    }
    expect(fsButton.getAttribute("aria-label")).toBe("Fullscreen");
    expect(fsButton.title).toBe("Fullscreen (Alt+Enter)");
    expect(settingsButton.getAttribute("aria-label")).toBe("Settings");
    expect(helpButton.title).toBe("Controls (H)");
  });

  it("builds the panels closed", () => {
    const { chrome, settingsPanel, helpScrim } = setup();
    expect(chrome.modalOpen).toBe(false);
    expect(settingsPanel.hidden).toBe(true);
    expect(helpScrim.hidden).toBe(true);
  });

  it("the buttons open and close their panels, and report it", () => {
    const { chrome, settingsButton, helpButton, settingsPanel, helpScrim } = setup();
    settingsButton.click();
    expect(chrome.modalOpen).toBe(true);
    expect(settingsPanel.hidden).toBe(false);
    expect(settingsButton.getAttribute("aria-expanded")).toBe("true");
    settingsButton.click();
    expect(settingsPanel.hidden).toBe(true);
    expect(chrome.modalOpen).toBe(false);
    expect(settingsButton.getAttribute("aria-expanded")).toBe("false");
    helpButton.click();
    expect(helpScrim.hidden).toBe(false);
    expect(helpButton.getAttribute("aria-expanded")).toBe("true");
    helpButton.click();
    expect(helpScrim.hidden).toBe(true);
  });

  it("opening one panel closes the other", () => {
    const { settingsButton, helpButton, settingsPanel, helpScrim } = setup();
    settingsButton.click();
    helpButton.click();
    expect(settingsPanel.hidden).toBe(true);
    expect(helpScrim.hidden).toBe(false);
    expect(settingsButton.getAttribute("aria-expanded")).toBe("false");
    settingsButton.click();
    expect(helpScrim.hidden).toBe(true);
    expect(settingsPanel.hidden).toBe(false);
  });

  it("the fullscreen button toggles fullscreen and shows the state", () => {
    const { fsButton, fullscreen } = setup();
    expect(fsButton.hidden).toBe(false);
    expect(fsButton.getAttribute("aria-pressed")).toBe("false");
    const enterIcon = fsButton.innerHTML;
    fsButton.click();
    expect(fullscreen.toggles).toBe(1);
    fullscreen.state.active = true;
    fullscreen.changed();
    expect(fsButton.getAttribute("aria-pressed")).toBe("true");
    expect(fsButton.innerHTML).not.toBe(enterIcon);
    // Esc or the browser leaving it is reflected too.
    fullscreen.state.active = false;
    fullscreen.changed();
    expect(fsButton.getAttribute("aria-pressed")).toBe("false");
    expect(fsButton.innerHTML).toBe(enterIcon);
  });

  it("hides the fullscreen button where it is unsupported (an iPhone), and the settings card says so", () => {
    const { fsButton, settingsButton, settingsPanel } = setup({ supported: false });
    expect(fsButton.hidden).toBe(true);
    settingsButton.click();
    expect(settingsPanel.allText).toContain("Not available in this browser.");
  });

  it("help lists the current place's controls first: the run's in a room, the hub's without one", () => {
    const hub = setup();
    hub.helpButton.click();
    const order = (s: ReturnType<typeof setup>, id: string) =>
      Number(s.helpScrim.byClass("help-section").find((n) => n.byClass("help-section-title")[0]!.textContent === HELP_SECTIONS.find((h) => h.id === id)!.title)!.style.order);
    expect(order(hub, "hub")).toBe(0);
    const run = setup({ room: {} });
    run.helpButton.click();
    expect(order(run, "run")).toBe(0);
  });
});

describe("Chrome: keys", () => {
  it("Alt+Enter toggles fullscreen and cancels the browser's own handling", () => {
    const { press, fullscreen } = setup();
    const e = press({ code: "Enter", key: "Enter", altKey: true });
    expect(fullscreen.toggles).toBe(1);
    expect(e.defaultPrevented).toBe(true);
    press({ code: "Enter", key: "Enter", altKey: true });
    expect(fullscreen.toggles).toBe(2);
  });

  it("Enter alone, a held Alt+Enter and Ctrl+Alt+Enter do nothing", () => {
    const { press, fullscreen } = setup();
    press({ code: "Enter", key: "Enter" });
    press({ code: "Enter", key: "Enter", altKey: true, repeat: true });
    press({ code: "Enter", key: "Enter", altKey: true, ctrlKey: true });
    expect(fullscreen.toggles).toBe(0);
  });

  it("H opens the help, H again closes it", () => {
    const { press, chrome, helpScrim } = setup();
    press({ code: "KeyH", key: "h" });
    expect(helpScrim.hidden).toBe(false);
    expect(chrome.modalOpen).toBe(true);
    press({ code: "KeyH", key: "h" });
    expect(helpScrim.hidden).toBe(true);
    expect(chrome.modalOpen).toBe(false);
  });

  it("H with a modifier does nothing", () => {
    const { press, chrome } = setup();
    for (const mod of ["ctrlKey", "metaKey", "altKey", "shiftKey"] as const) press({ code: "KeyH", key: "h", [mod]: true });
    expect(chrome.modalOpen).toBe(false);
  });

  it("ignores H and Esc while the player types in a text field", () => {
    const { press, chrome, textField, settingsButton, helpScrim } = setup();
    press({ code: "KeyH", key: "h", target: textField });
    expect(chrome.modalOpen).toBe(false);
    settingsButton.click();
    const e = press({ code: "Escape", key: "Escape", target: textField });
    expect(chrome.modalOpen).toBe(true);
    expect(e.defaultPrevented).toBe(false);
    expect(helpScrim.hidden).toBe(true);
  });

  it("ignores H while a text field has focus even if the key's target is elsewhere", () => {
    const { press, chrome, doc, textField } = setup();
    doc.activeElement = textField;
    press({ code: "KeyH", key: "h", target: doc.body });
    expect(chrome.modalOpen).toBe(false);
  });

  it("Esc closes the open panel and is consumed: the scene's own Esc handler never sees it", () => {
    const { press, chrome, sceneKeys, helpScrim } = setup();
    press({ code: "KeyH", key: "h" });
    sceneKeys.length = 0;
    const e = press({ code: "Escape", key: "Escape" });
    expect(helpScrim.hidden).toBe(true);
    expect(chrome.modalOpen).toBe(false);
    expect(e.defaultPrevented).toBe(true);
    expect(e.propagationStopped).toBe(true);
    expect(sceneKeys).toEqual([]);
  });

  it("Esc closes the settings card too, even with the slider focused", () => {
    const { press, chrome, settingsButton, settingsPanel, sceneKeys } = setup();
    settingsButton.click();
    const slider = settingsPanel.find((e) => e.tagName === "INPUT")[0]!;
    slider.focus();
    sceneKeys.length = 0;
    press({ code: "Escape", key: "Escape", target: slider });
    expect(chrome.modalOpen).toBe(false);
    expect(sceneKeys).toEqual([]);
  });

  it("Esc with nothing open is left alone, so the scene can still leave practice", () => {
    const { press, sceneKeys } = setup();
    const e = press({ code: "Escape", key: "Escape" });
    expect(e.defaultPrevented).toBe(false);
    expect(e.propagationStopped).toBe(false);
    expect(sceneKeys).toEqual([{ code: "Escape", defaultPrevented: false }]);
  });

  it("the game keys pass through untouched, open panel or not", () => {
    const { press, sceneKeys, settingsButton } = setup();
    settingsButton.click();
    for (const code of ["KeyS", "KeyQ", "KeyF", "Digit1", "Digit2"]) {
      const e = press({ code, key: code });
      expect(e.defaultPrevented).toBe(false);
    }
    expect(sceneKeys.map((k) => k.code)).toEqual(["KeyS", "KeyQ", "KeyF", "Digit1", "Digit2"]);
  });

  it("keeps focus where it was: Esc hands it back to the button that opened the card", () => {
    const { press, settingsButton, doc } = setup();
    settingsButton.focus();
    settingsButton.click();
    expect(doc.activeElement).not.toBe(settingsButton);
    press({ code: "Escape", key: "Escape" });
    expect(doc.activeElement).toBe(settingsButton);
  });

  it("does not steal focus back if the player moved it to a text field meanwhile", () => {
    const { press, settingsButton, doc, textField } = setup();
    settingsButton.focus();
    settingsButton.click();
    doc.activeElement = textField;
    // Typing: Esc is not ours, so the panel stays; closing by its own button leaves the field focused.
    press({ code: "Escape", key: "Escape", target: textField });
    settingsButton.click();
    expect(doc.activeElement).toBe(textField);
  });
});

describe("Chrome: reduced motion and settings", () => {
  const attr = (doc: { documentElement: FEl }) => doc.documentElement.hasAttribute("data-reduced-motion");

  it("sets html[data-reduced-motion] with the setting, and clears it", () => {
    const { doc, store } = setup();
    expect(attr(doc)).toBe(false);
    store.update({ reducedMotion: true });
    expect(attr(doc)).toBe(true);
    store.update({ reducedMotion: false });
    expect(attr(doc)).toBe(false);
  });

  it("honours the system preference at start and when it changes", () => {
    const on = setup({ os: true });
    expect(attr(on.doc)).toBe(true);
    const { doc, win, store } = setup();
    expect(attr(doc)).toBe(false);
    win.osReducedMotion = true;
    win.changeMotion();
    expect(attr(doc)).toBe(true);
    win.osReducedMotion = false;
    win.changeMotion();
    expect(attr(doc)).toBe(false);
    // The setting still wins when the system is calm.
    store.update({ reducedMotion: true });
    expect(attr(doc)).toBe(true);
  });

  it("an unrelated setting does not touch it", () => {
    const { doc, store } = setup({ os: true });
    store.update({ showFps: false });
    expect(attr(doc)).toBe(true);
  });

  it("the readout follows Show FPS and Show ping", () => {
    const { store, q } = setup();
    const perf = q("perf");
    expect(perf.hidden).toBe(false);
    store.update({ showFps: false, showPing: false });
    expect(perf.hidden).toBe(true);
    store.update({ showPing: true });
    expect(perf.hidden).toBe(false);
  });
});

describe("Chrome: lifetime", () => {
  it("destroy removes its keys and its elements", () => {
    const { chrome, win, q } = setup();
    expect(win.keydownListeners).toBeGreaterThan(0);
    const before = win.keydownListeners;
    const root = q("chrome");
    expect(win.pendingFrames).toBe(1);
    chrome.destroy();
    expect(win.keydownListeners).toBe(before - 1);
    expect(root.removed).toBe(true);
    expect(win.pendingFrames).toBe(0);
  });
});

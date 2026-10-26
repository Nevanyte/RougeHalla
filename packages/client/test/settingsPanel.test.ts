// The settings card (ui/settingsPanel.ts) on the fake DOM: every control reads and writes the settings store, labels are tied
// to controls, fullscreen reflects the real state and says so when it is missing.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FullscreenApi } from "../src/fullscreen";
import { DEFAULT_SETTINGS, SettingsStore, type Settings } from "../src/settings";
import {
  REDUCED_MOTION_ATTR, SettingsPanel, applyReducedMotion, formatJuice, juiceToPercent, percentToJuice, reducedMotionActive,
} from "../src/ui/settingsPanel";
import { FEl, fake, installChromeDom } from "./chromeDom";

afterEach(() => { vi.unstubAllGlobals(); });

function fakeFullscreen(over: { supported?: boolean; active?: boolean; ok?: boolean } = {}) {
  const state = { supported: over.supported ?? true, active: over.active ?? false, ok: over.ok ?? true };
  const listeners = new Set<() => void>();
  const api: FullscreenApi & { state: typeof state; toggles: number; changed(): void } = {
    state,
    toggles: 0,
    supported: () => state.supported,
    active: () => state.active,
    toggle: async () => { api.toggles++; if (state.ok) state.active = !state.active; return state.ok; },
    onChange: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    changed() { for (const cb of [...listeners]) cb(); },
  };
  return api;
}

function setup(over: { fullscreen?: ReturnType<typeof fakeFullscreen>; os?: boolean; onClose?: () => void; initial?: Partial<Settings> } = {}) {
  const { doc } = installChromeDom();
  const data = new Map<string, string>();
  const store = new SettingsStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } });
  if (over.initial) store.update(over.initial);
  const fullscreen = over.fullscreen ?? fakeFullscreen();
  const panel = new SettingsPanel({ store, fullscreen, osReducedMotion: () => over.os ?? false, ...(over.onClose ? { onClose: over.onClose } : {}) });
  const root = fake(panel.element);
  doc.ui.append(root);
  const sw = (key: string): FEl => root.find((e) => e.id === `sp-${key}`)[0]!;
  const slider = root.find((e) => e.tagName === "INPUT")[0]!;
  const reset = root.byClass("sp-reset")[0]!;
  const status = root.byClass("sp-status")[0]!;
  return { panel, store, fullscreen, doc, root, sw, slider, reset, status, data };
}

describe("helpers", () => {
  it("converts juice to whole percents and back, clamped", () => {
    expect(juiceToPercent(1)).toBe(100);
    expect(juiceToPercent(0.755)).toBe(76);
    expect(juiceToPercent(-1)).toBe(0);
    expect(juiceToPercent(9)).toBe(100);
    expect(percentToJuice(75)).toBe(0.75);
    expect(percentToJuice(0)).toBe(0);
    expect(percentToJuice(100)).toBe(1);
    expect(percentToJuice(140)).toBe(1);
    expect(percentToJuice(-5)).toBe(0);
    expect(percentToJuice(33.4)).toBe(0.33);
    expect(percentToJuice(Number.NaN)).toBe(0);
    expect(formatJuice(0.5)).toBe("50%");
  });

  it("reduced motion is on when the setting or the system asks for it", () => {
    expect(reducedMotionActive({ reducedMotion: false }, false)).toBe(false);
    expect(reducedMotionActive({ reducedMotion: true }, false)).toBe(true);
    expect(reducedMotionActive({ reducedMotion: false }, true)).toBe(true);
  });

  it("sets and clears data-reduced-motion", () => {
    const root = new FEl("HTML");
    applyReducedMotion(root as never, true);
    expect(root.hasAttribute(REDUCED_MOTION_ATTR)).toBe(true);
    expect(REDUCED_MOTION_ATTR).toBe("data-reduced-motion");
    applyReducedMotion(root as never, false);
    expect(root.hasAttribute(REDUCED_MOTION_ATTR)).toBe(false);
    applyReducedMotion(root as never, false);
    expect(root.hasAttribute(REDUCED_MOTION_ATTR)).toBe(false);
  });
});

describe("SettingsPanel structure", () => {
  it("is a closed, labelled dialog that opens and closes", () => {
    const { panel, root, doc } = setup();
    expect(panel.isOpen).toBe(false);
    expect(root.getAttribute("role")).toBe("dialog");
    expect(root.getAttribute("aria-label")).toBe("Settings");
    panel.open();
    expect(panel.isOpen).toBe(true);
    expect(doc.activeElement).toBe(root);
    panel.close();
    expect(panel.isOpen).toBe(false);
  });

  it("ties a label to every control, with text", () => {
    const { root } = setup();
    const controls = root.find((e) => e.id.startsWith("sp-"));
    expect(controls.map((c) => c.id).sort()).toEqual(
      ["sp-fullscreen", "sp-hiDpi", "sp-juice", "sp-reducedMotion", "sp-showFps", "sp-showPing"].sort(),
    );
    for (const control of controls) {
      const labels = root.find((e) => e.tagName === "LABEL" && e.htmlFor === control.id);
      expect(labels).toHaveLength(1);
      expect(labels[0]!.textContent.length).toBeGreaterThan(3);
    }
  });

  it("makes the switches buttons with role=switch, and leaves the slider as the only <input>", () => {
    const { root, sw } = setup();
    for (const key of ["fullscreen", "hiDpi", "reducedMotion", "showFps", "showPing"]) {
      expect(sw(key).tagName).toBe("BUTTON");
      expect(sw(key).type).toBe("button");
      expect(sw(key).getAttribute("role")).toBe("switch");
    }
    const inputs = root.find((e) => e.tagName === "INPUT");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.type).toBe("range");
    expect([inputs[0]!.min, inputs[0]!.max]).toEqual(["0", "100"]);
  });

  it("covers every setting the owner listed and says it is saved in this browser", () => {
    const { root } = setup();
    const text = root.allText;
    for (const word of ["Fullscreen", "Effects intensity", "Reduced motion", "Show FPS", "Show ping", "Sharp rendering", "Reset to defaults", "Saved in this browser."]) {
      expect(text).toContain(word);
    }
  });

  it("has a close button with an accessible name", () => {
    const onClose = vi.fn();
    const { root } = setup({ onClose });
    const close = root.byClass("sp-close")[0]!;
    expect(close.getAttribute("aria-label")).toBe("Close settings");
    close.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes itself from its close button when nothing else is handling it", () => {
    const { panel, root } = setup();
    panel.open();
    root.byClass("sp-close")[0]!.click();
    expect(panel.isOpen).toBe(false);
  });
});

describe("SettingsPanel controls", () => {
  it("shows the current settings", () => {
    const { sw, slider, root } = setup({ initial: { juice: 0.4, showPing: false, hiDpi: false, reducedMotion: true } });
    expect(sw("showFps").getAttribute("aria-checked")).toBe("true");
    expect(sw("showPing").getAttribute("aria-checked")).toBe("false");
    expect(sw("hiDpi").getAttribute("aria-checked")).toBe("false");
    expect(sw("reducedMotion").getAttribute("aria-checked")).toBe("true");
    expect(slider.value).toBe("40");
    expect(root.byClass("sp-value")[0]!.textContent).toBe("40%");
    expect(slider.getAttribute("aria-valuetext")).toBe("40 percent");
  });

  it("a switch click flips the setting at once and saves it", () => {
    const { sw, store, data } = setup();
    for (const key of ["showFps", "showPing", "hiDpi", "reducedMotion"] as const) {
      const before = store.get()[key];
      sw(key).click();
      expect(store.get()[key]).toBe(!before);
      expect(sw(key).getAttribute("aria-checked")).toBe(String(!before));
      sw(key).click();
      expect(store.get()[key]).toBe(before);
    }
    expect(data.size).toBe(1);
  });

  it("clicking a label reaches its control: the label names the switch it belongs to", () => {
    const { root, sw } = setup();
    const label = root.find((e) => e.tagName === "LABEL" && e.htmlFor === "sp-showFps")[0]!;
    expect(label.htmlFor).toBe(sw("showFps").id);
  });

  it("the slider changes the effects intensity live, in whole percents", () => {
    const { slider, store, root } = setup();
    slider.value = "35";
    slider.dispatch("input");
    expect(store.get().juice).toBe(0.35);
    expect(root.byClass("sp-value")[0]!.textContent).toBe("35%");
    slider.value = "0";
    slider.dispatch("input");
    expect(store.get().juice).toBe(0);
    slider.value = "100";
    slider.dispatch("input");
    expect(store.get().juice).toBe(1);
  });

  it("lets go of the slider when the pointer does, so the game keys work again", () => {
    const { slider, doc } = setup();
    slider.focus();
    expect(doc.activeElement).toBe(slider);
    slider.dispatch("pointerup");
    expect(doc.activeElement).not.toBe(slider);
  });

  it("follows changes made elsewhere", () => {
    const { store, sw, slider } = setup();
    store.update({ showFps: false, juice: 0.1 });
    expect(sw("showFps").getAttribute("aria-checked")).toBe("false");
    expect(slider.value).toBe("10");
  });

  it("Reset to defaults restores everything, and the controls show it", () => {
    const { store, reset, sw, slider } = setup({ initial: { juice: 0.2, hiDpi: false, showFps: false, reducedMotion: true } });
    reset.click();
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(sw("hiDpi").getAttribute("aria-checked")).toBe("true");
    expect(sw("reducedMotion").getAttribute("aria-checked")).toBe("false");
    expect(slider.value).toBe("100");
  });

  it("mentions the system's reduced-motion setting when it is on", () => {
    const off = setup({ os: false });
    expect(off.root.allText).not.toContain("Your system already asks");
    const on = setup({ os: true });
    expect(on.root.allText).toContain("Your system already asks for reduced motion");
  });
});

describe("SettingsPanel fullscreen", () => {
  it("reflects the real state", () => {
    const fullscreen = fakeFullscreen({ active: false });
    const { sw, panel } = setup({ fullscreen });
    expect(sw("fullscreen").hidden).toBe(false);
    expect(sw("fullscreen").getAttribute("aria-checked")).toBe("false");
    fullscreen.state.active = true;
    fullscreen.changed();
    panel.refresh();
    expect(sw("fullscreen").getAttribute("aria-checked")).toBe("true");
  });

  it("a click toggles it and shows the new state", async () => {
    const fullscreen = fakeFullscreen();
    const { sw, status } = setup({ fullscreen });
    sw("fullscreen").click();
    expect(fullscreen.toggles).toBe(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(sw("fullscreen").getAttribute("aria-checked")).toBe("true");
    expect(status.textContent).toBe("");
  });

  it("says so when the browser refuses", async () => {
    const fullscreen = fakeFullscreen({ ok: false });
    const { sw, status } = setup({ fullscreen });
    sw("fullscreen").click();
    await Promise.resolve();
    await Promise.resolve();
    expect(status.textContent).toMatch(/did not allow fullscreen/i);
    expect(sw("fullscreen").getAttribute("aria-checked")).toBe("false");
  });

  it("without support, hides the switch and says it is not available", () => {
    const { sw, root } = setup({ fullscreen: fakeFullscreen({ supported: false }) });
    expect(sw("fullscreen").hidden).toBe(true);
    expect(root.allText).toContain("Not available in this browser.");
  });

  it("with support, points at Alt+Enter", () => {
    const { root } = setup();
    expect(root.allText).toContain("Alt+Enter");
  });
});

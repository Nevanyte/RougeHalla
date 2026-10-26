// Per-browser settings (src/settings.ts): defaults, the round trip through a storage, every kind of bad data, storage that
// throws or is missing, and what subscribers are told. The storage is a fake; nothing touches localStorage.
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS, SETTINGS_KEY, SettingsStore, TEXT_SCALES, loadSettings, sanitizeSettings, saveSettings, type SettingsStorage,
} from "../src/settings";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: SettingsStorage & { data: Map<string, string>; writes: number } = {
    data,
    writes: 0,
    getItem: (k) => data.get(k) ?? null,
    setItem(k, v) { data.set(k, v); storage.writes++; },
  };
  return storage;
}

const throwing: SettingsStorage = {
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("quota"); },
};

describe("loading", () => {
  it("gives the defaults when nothing is saved", () => {
    expect(loadSettings(memoryStorage())).toEqual(DEFAULT_SETTINGS);
    expect(new SettingsStore(memoryStorage()).get()).toEqual(DEFAULT_SETTINGS);
  });

  it("the defaults are what the owner asked for: effects fully on, the readout shown, sharp rendering on, the route shown, normal text", () => {
    expect(DEFAULT_SETTINGS).toEqual({ juice: 1, reducedMotion: false, showFps: true, showPing: true, hiDpi: true, showRoute: true, textScale: 1 });
  });

  it("returns a copy, so changing a loaded value never edits the defaults", () => {
    const loaded = loadSettings(memoryStorage());
    loaded.juice = 0;
    expect(DEFAULT_SETTINGS.juice).toBe(1);
  });

  it("survives corrupt JSON of any shape", () => {
    for (const text of ["{not json", "", "null", "42", '"text"', "[1,2,3]", "true", "{"]) {
      expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: text }))).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("falls back per key when a value has the wrong type", () => {
    const text = JSON.stringify({ juice: "high", reducedMotion: "yes", showFps: 1, showPing: null, hiDpi: {} });
    expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: text }))).toEqual(DEFAULT_SETTINGS);
    const mixed = JSON.stringify({ juice: 0.25, showFps: "no", hiDpi: false });
    expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: mixed }))).toEqual({ ...DEFAULT_SETTINGS, juice: 0.25, hiDpi: false });
  });

  it("clamps juice into 0..1 and ignores one that is not a finite number", () => {
    expect(sanitizeSettings({ juice: 7 }).juice).toBe(1);
    expect(sanitizeSettings({ juice: -3 }).juice).toBe(0);
    expect(sanitizeSettings({ juice: 0.5 }).juice).toBe(0.5);
    expect(sanitizeSettings({ juice: Number.NaN }).juice).toBe(DEFAULT_SETTINGS.juice);
    expect(sanitizeSettings({ juice: Infinity }).juice).toBe(DEFAULT_SETTINGS.juice);
    // JSON turns NaN into null, which is not a number either.
    expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: '{"juice":null}' })).juice).toBe(DEFAULT_SETTINGS.juice);
  });

  it("drops unknown keys", () => {
    const out = sanitizeSettings({ juice: 0.5, hax: true, __proto__: { polluted: 1 }, constructor: 5 });
    expect(Object.keys(out).sort()).toEqual(["hiDpi", "juice", "reducedMotion", "showFps", "showPing", "showRoute", "textScale"]);
    expect(out.juice).toBe(0.5);
  });

  it("keeps the map settings: the route switch, and the text size snapped to the nearest size offered", () => {
    expect(sanitizeSettings({ showRoute: false }).showRoute).toBe(false);
    expect(sanitizeSettings({ showRoute: "no" }).showRoute).toBe(true);
    expect(TEXT_SCALES).toEqual([1, 1.25, 1.5]);
    expect(sanitizeSettings({ textScale: 1.25 }).textScale).toBe(1.25);
    expect(sanitizeSettings({ textScale: 1.4 }).textScale).toBe(1.5);
    expect(sanitizeSettings({ textScale: 9 }).textScale).toBe(1.5);
    expect(sanitizeSettings({ textScale: -3 }).textScale).toBe(1);
    expect(sanitizeSettings({ textScale: "big" }).textScale).toBe(1);
    expect(sanitizeSettings({ textScale: Number.NaN }).textScale).toBe(1);
    // An older file with neither key loads with the defaults for them.
    const old = loadSettings(memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ juice: 0.5, showFps: false }) }));
    expect(old).toEqual({ ...DEFAULT_SETTINGS, juice: 0.5, showFps: false });
  });

  it("treats a storage that throws or is missing as empty", () => {
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(new SettingsStore(null).get()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("saving", () => {
  it("round-trips through the storage, under one key", () => {
    const storage = memoryStorage();
    const store = new SettingsStore(storage);
    store.update({ juice: 0.4, showPing: false, reducedMotion: true });
    expect([...storage.data.keys()]).toEqual([SETTINGS_KEY]);
    expect(new SettingsStore(storage).get()).toEqual({ ...DEFAULT_SETTINGS, juice: 0.4, showPing: false, reducedMotion: true });
  });

  it("saveSettings reports whether the write went through", () => {
    expect(saveSettings({ ...DEFAULT_SETTINGS }, memoryStorage())).toBe(true);
    expect(saveSettings({ ...DEFAULT_SETTINGS }, throwing)).toBe(false);
    expect(saveSettings({ ...DEFAULT_SETTINGS }, null)).toBe(false);
  });

  it("keeps working in memory when the storage throws or is missing", () => {
    for (const storage of [throwing, null]) {
      const store = new SettingsStore(storage);
      expect(() => store.update({ showFps: false })).not.toThrow();
      expect(store.get().showFps).toBe(false);
      expect(() => store.reset()).not.toThrow();
      expect(store.get()).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("writes nothing when an update changes nothing", () => {
    const storage = memoryStorage();
    const store = new SettingsStore(storage);
    expect(store.update({ juice: 1, showFps: true })).toEqual([]);
    expect(storage.writes).toBe(0);
    store.update({ juice: 0.9 });
    expect(storage.writes).toBe(1);
  });
});

describe("update", () => {
  it("returns the keys that changed", () => {
    const store = new SettingsStore(memoryStorage());
    expect(store.update({ juice: 0.5, hiDpi: false, showFps: true })).toEqual(["juice", "hiDpi"]);
  });

  it("sanitizes the patch: a bad value is ignored, a high juice is clamped", () => {
    const store = new SettingsStore(memoryStorage());
    store.update({ juice: 3 });
    expect(store.get().juice).toBe(1);
    store.update({ juice: 0.3 });
    store.update({ juice: "loud" as unknown as number, showFps: "x" as unknown as boolean, extra: 1 } as never);
    expect(store.get().juice).toBe(0.3);
    expect(store.get().showFps).toBe(true);
    expect("extra" in store.get()).toBe(false);
  });

  it("hands out a value that a later update does not mutate", () => {
    const store = new SettingsStore(memoryStorage());
    const before = store.get();
    store.update({ juice: 0.2 });
    expect(before.juice).toBe(1);
    expect(store.get().juice).toBe(0.2);
  });
});

describe("subscribe", () => {
  it("tells the subscriber which keys changed, after the change", () => {
    const store = new SettingsStore(memoryStorage());
    const seen: Array<{ juice: number; changed: string[] }> = [];
    store.subscribe((s, changed) => seen.push({ juice: s.juice, changed: [...changed] }));
    store.update({ juice: 0.6 });
    store.update({ showFps: false, showPing: false });
    expect(seen).toEqual([
      { juice: 0.6, changed: ["juice"] },
      { juice: 0.6, changed: ["showFps", "showPing"] },
    ]);
  });

  it("is not called now, nor for a no-op update, nor after unsubscribing", () => {
    const store = new SettingsStore(memoryStorage());
    const cb = vi.fn();
    const off = store.subscribe(cb);
    expect(cb).not.toHaveBeenCalled();
    store.update({ juice: 1 });
    expect(cb).not.toHaveBeenCalled();
    store.update({ juice: 0.5 });
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    store.update({ juice: 0.1 });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("a subscriber that unsubscribes itself does not skip the others", () => {
    const store = new SettingsStore(memoryStorage());
    const second = vi.fn();
    const off = store.subscribe(() => off());
    store.subscribe(second);
    store.update({ juice: 0.5 });
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("reset", () => {
  it("restores the defaults, saves them, and reports only the keys that moved", () => {
    const storage = memoryStorage();
    const store = new SettingsStore(storage);
    store.update({ juice: 0.2, hiDpi: false });
    const cb = vi.fn();
    store.subscribe(cb);
    store.reset();
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]![1]).toEqual(["juice", "hiDpi"]);
    expect(new SettingsStore(storage).get()).toEqual(DEFAULT_SETTINGS);
    // Resetting defaults again is a no-op.
    store.reset();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

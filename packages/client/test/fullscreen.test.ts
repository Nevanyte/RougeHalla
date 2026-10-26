// Fullscreen helpers (src/fullscreen.ts) against a fake document: the standard API, the WebKit-prefixed fallbacks, an iPhone
// with neither, and a request the browser refuses.
import { describe, expect, it, vi } from "vitest";
import { FULLSCREEN_EVENTS, fullscreenSupported, isFullscreen, onFullscreenChange, toggleFullscreen, type FullscreenDoc } from "../src/fullscreen";

type Mutable = {
  -readonly [K in keyof FullscreenDoc]: FullscreenDoc[K];
};

function standardDoc(over: Partial<Mutable> = {}) {
  const doc: Mutable & { listeners: Map<string, Set<() => void>> } = {
    listeners: new Map(),
    documentElement: {
      requestFullscreen: vi.fn(async () => { doc.fullscreenElement = doc.documentElement; }),
    },
    fullscreenEnabled: true,
    fullscreenElement: null,
    exitFullscreen: vi.fn(async () => { doc.fullscreenElement = null; }),
    addEventListener(type, cb) { (doc.listeners.get(type) ?? doc.listeners.set(type, new Set()).get(type)!).add(cb); },
    removeEventListener(type, cb) { doc.listeners.get(type)?.delete(cb); },
    ...over,
  };
  return doc;
}

describe("fullscreenSupported", () => {
  it("is true with the standard API", () => {
    expect(fullscreenSupported(standardDoc())).toBe(true);
  });

  it("is true with only the WebKit prefix (iPad, older Safari)", () => {
    const doc = standardDoc({ documentElement: { webkitRequestFullscreen: vi.fn() }, fullscreenEnabled: undefined, webkitFullscreenEnabled: true });
    expect(fullscreenSupported(doc)).toBe(true);
  });

  it("is false with neither (an iPhone)", () => {
    expect(fullscreenSupported(standardDoc({ documentElement: {}, fullscreenEnabled: undefined }))).toBe(false);
  });

  it("is false where the page may not go fullscreen (a sandboxed frame)", () => {
    expect(fullscreenSupported(standardDoc({ fullscreenEnabled: false }))).toBe(false);
    expect(fullscreenSupported(standardDoc({ fullscreenEnabled: undefined, webkitFullscreenEnabled: false }))).toBe(false);
  });
});

describe("isFullscreen", () => {
  it("reads the standard element, then the prefixed one", () => {
    expect(isFullscreen(standardDoc())).toBe(false);
    expect(isFullscreen(standardDoc({ fullscreenElement: {} }))).toBe(true);
    expect(isFullscreen(standardDoc({ fullscreenElement: undefined, webkitFullscreenElement: {} }))).toBe(true);
    expect(isFullscreen(standardDoc({ fullscreenElement: null, webkitFullscreenElement: null }))).toBe(false);
  });
});

describe("toggleFullscreen", () => {
  it("requests fullscreen on the page with the browser chrome hidden, then leaves it", async () => {
    const doc = standardDoc();
    expect(await toggleFullscreen(doc)).toBe(true);
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledWith({ navigationUI: "hide" });
    expect(isFullscreen(doc)).toBe(true);
    expect(await toggleFullscreen(doc)).toBe(true);
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(isFullscreen(doc)).toBe(false);
  });

  it("issues the request before it first awaits, so it still counts as part of the click or key press", () => {
    const doc = standardDoc();
    void toggleFullscreen(doc);
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it("falls back to the prefixed request and exit", async () => {
    const enter = vi.fn();
    const leave = vi.fn();
    const doc = standardDoc({
      documentElement: { webkitRequestFullscreen: enter },
      fullscreenEnabled: undefined,
      webkitFullscreenEnabled: true,
      exitFullscreen: undefined,
      webkitExitFullscreen: leave,
    });
    expect(await toggleFullscreen(doc)).toBe(true);
    expect(enter).toHaveBeenCalledTimes(1);
    doc.webkitFullscreenElement = {};
    expect(await toggleFullscreen(doc)).toBe(true);
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("reports false, without throwing, when unsupported", async () => {
    expect(await toggleFullscreen(standardDoc({ documentElement: {}, fullscreenEnabled: undefined }))).toBe(false);
  });

  it("reports false when the browser rejects the request", async () => {
    const doc = standardDoc({ documentElement: { requestFullscreen: vi.fn(async () => { throw new TypeError("not allowed"); }) } });
    expect(await toggleFullscreen(doc)).toBe(false);
  });

  it("reports false when the request throws at once, and when leaving fails", async () => {
    const throws = standardDoc({ documentElement: { requestFullscreen: vi.fn(() => { throw new Error("denied"); }) } });
    expect(await toggleFullscreen(throws)).toBe(false);
    const stuck = standardDoc({ fullscreenElement: {}, exitFullscreen: vi.fn(async () => { throw new Error("x"); }) });
    expect(await toggleFullscreen(stuck)).toBe(false);
  });

  it("reports false when fullscreen is on but there is no way out", async () => {
    expect(await toggleFullscreen(standardDoc({ fullscreenElement: {}, exitFullscreen: undefined }))).toBe(false);
  });
});

describe("onFullscreenChange", () => {
  it("listens for the standard and the prefixed event, and the unsubscribe removes both", () => {
    const doc = standardDoc();
    const cb = vi.fn();
    const off = onFullscreenChange(cb, doc);
    expect([...doc.listeners.keys()].sort()).toEqual([...FULLSCREEN_EVENTS].sort());
    for (const type of FULLSCREEN_EVENTS) doc.listeners.get(type)!.forEach((fn) => fn());
    expect(cb).toHaveBeenCalledTimes(FULLSCREEN_EVENTS.length);
    off();
    for (const type of FULLSCREEN_EVENTS) expect(doc.listeners.get(type)!.size).toBe(0);
  });
});

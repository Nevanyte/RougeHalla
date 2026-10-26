import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TIMEOUT_MS, FADE_MS, LoadingScreen, whenReady } from "../src/ui/loading";
import { installUiDom, type UiDoc, type UiEl } from "./uiDom";

let doc: UiDoc;
let body: UiEl;

/** index.html's static screen: #boot with its text line. */
function staticBoot(): { boot: UiEl; text: UiEl } {
  const boot = doc.createElement("div");
  boot.id = "boot";
  const text = doc.createElement("div");
  text.id = "boot-text";
  text.textContent = "Loading…";
  boot.append(text);
  body.append(boot);
  return { boot, text };
}

beforeEach(() => {
  vi.useFakeTimers();
  ({ doc, body } = installUiDom());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("LoadingScreen with the static #boot", () => {
  it("takes over the element that is already on the page and counts as shown", () => {
    const { boot } = staticBoot();
    const loading = new LoadingScreen();
    expect(loading.visible).toBe(true);
    expect(boot.hidden).toBe(false);
    expect(body.children.filter((c) => typeof c !== "string" && c.id === "boot")).toHaveLength(1);
  });

  it("show() sets the text and keeps it up", () => {
    const { boot, text } = staticBoot();
    const loading = new LoadingScreen();
    loading.show("Joining run…");
    expect(text.textContent).toBe("Joining run…");
    expect(boot.hidden).toBe(false);
    expect(boot.classList.contains("is-hiding")).toBe(false);
  });

  it("hide() fades first, then takes the element out of the layout", () => {
    const { boot } = staticBoot();
    const loading = new LoadingScreen();
    loading.hide();
    expect(loading.visible).toBe(false);
    expect(boot.classList.contains("is-hiding")).toBe(true);
    expect(boot.hidden).toBe(false);
    vi.advanceTimersByTime(FADE_MS - 1);
    expect(boot.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(boot.hidden).toBe(true);
  });

  it("show() brings it back, also in the middle of a fade-out", () => {
    const { boot } = staticBoot();
    const loading = new LoadingScreen();
    loading.hide();
    vi.advanceTimersByTime(FADE_MS / 2);
    loading.show("Entering training…");
    expect(boot.classList.contains("is-hiding")).toBe(false);
    vi.advanceTimersByTime(FADE_MS * 2);
    expect(boot.hidden).toBe(false);
    expect(loading.visible).toBe(true);

    loading.hide();
    vi.advanceTimersByTime(FADE_MS);
    expect(boot.hidden).toBe(true);
    loading.show("Joining run…");
    expect(boot.hidden).toBe(false);
    expect(boot.classList.contains("is-hiding")).toBe(false);
  });

  it("is idempotent: hide() twice and show() twice change nothing more", () => {
    const { boot } = staticBoot();
    const loading = new LoadingScreen();
    loading.hide();
    loading.hide();
    expect(vi.getTimerCount()).toBe(1); // the one fade
    vi.advanceTimersByTime(FADE_MS);
    loading.hide();
    expect(vi.getTimerCount()).toBe(0);
    expect(boot.hidden).toBe(true);

    loading.show("a");
    loading.show("b");
    expect(vi.getTimerCount()).toBe(1); // one timeout, restarted
    expect(loading.visible).toBe(true);
  });

  it("hide() when it was never shown does nothing", () => {
    const { boot } = staticBoot();
    boot.hidden = true;
    const loading = new LoadingScreen();
    expect(loading.visible).toBe(false);
    loading.hide();
    expect(vi.getTimerCount()).toBe(0);
    expect(boot.classList.contains("is-hiding")).toBe(false);
  });

  it("setText() changes the line without touching the state", () => {
    const { text } = staticBoot();
    const loading = new LoadingScreen();
    loading.setText("Almost there…");
    expect(text.textContent).toBe("Almost there…");
    expect(loading.visible).toBe(true);
  });
});

describe("LoadingScreen timeout", () => {
  it("hides itself and calls onTimeout once the time is up", () => {
    const { boot } = staticBoot();
    const loading = new LoadingScreen();
    const onTimeout = vi.fn();
    loading.show("Joining run…", { timeoutMs: 5000, onTimeout });
    vi.advanceTimersByTime(4999);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(loading.visible).toBe(true);
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(loading.visible).toBe(false);
    vi.advanceTimersByTime(FADE_MS);
    expect(boot.hidden).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("hide() cancels it: the timeout never fires after a normal hide", () => {
    staticBoot();
    const loading = new LoadingScreen();
    const onTimeout = vi.fn();
    loading.show("Joining run…", { timeoutMs: 5000, onTimeout });
    vi.advanceTimersByTime(1000);
    loading.hide();
    vi.advanceTimersByTime(60_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("a second show() restarts the clock and replaces the callback", () => {
    staticBoot();
    const loading = new LoadingScreen();
    const first = vi.fn();
    const second = vi.fn();
    loading.show("a", { timeoutMs: 5000, onTimeout: first });
    vi.advanceTimersByTime(4000);
    loading.show("b", { timeoutMs: 5000, onTimeout: second });
    vi.advanceTimersByTime(4000);
    expect(second).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("never stays up: a screen nobody hides goes after the default time", () => {
    staticBoot();
    const loading = new LoadingScreen();
    vi.advanceTimersByTime(DEFAULT_TIMEOUT_MS);
    expect(loading.visible).toBe(false);
    loading.show("again");
    vi.advanceTimersByTime(DEFAULT_TIMEOUT_MS);
    expect(loading.visible).toBe(false);
  });
});

describe("LoadingScreen without a static #boot", () => {
  it("builds the same markup in the page", () => {
    const loading = new LoadingScreen();
    const boot = doc.getElementById("boot")!;
    expect(boot).not.toBeNull();
    expect(boot.byClass("boot-title")!.textContent).toBe("RAID");
    expect(boot.byClass("boot-spinner")).toBeDefined();
    loading.show("Joining run…");
    expect(doc.getElementById("boot-text")!.textContent).toBe("Joining run…");
  });
});

describe("whenReady", () => {
  it("stops polling after maxFrames when ready() never turns true", () => {
    const frames: Array<() => void> = [];
    const raf = (cb: () => void): number => frames.push(cb);
    const ready = vi.fn(() => false);
    void whenReady(ready, raf, 5);
    for (let i = 0; i < 20; i++) frames.splice(0).forEach((f) => f());
    expect(ready).toHaveBeenCalledTimes(5);
    expect(frames).toHaveLength(0);
  });

  it("resolves on the frame after ready() turns true, polling once per frame", async () => {
    const frames: Array<() => void> = [];
    const raf = (cb: () => void): number => frames.push(cb);
    const ready = vi.fn(() => false);
    let done = false;
    void whenReady(ready, raf).then(() => { done = true; });

    const step = (): void => { frames.splice(0).forEach((f) => f()); };
    step();
    step();
    expect(ready).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(done).toBe(false);

    ready.mockReturnValue(true);
    step(); // sees it ready, waits one more frame
    await Promise.resolve();
    expect(done).toBe(false);
    step();
    await Promise.resolve();
    expect(done).toBe(true);
    expect(frames).toHaveLength(0);
  });
});

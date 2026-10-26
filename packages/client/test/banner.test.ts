import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Banner, RECONNECTED_MS, RECONNECTED_TEXT, RECONNECTING_TEXT } from "../src/ui/banner";
import { installUiDom, type UiEl } from "./uiDom";

let ui: UiEl;
let banner: Banner;
const pill = (): UiEl | undefined => ui.children.find((c): c is UiEl => typeof c !== "string" && c.classList.contains("banner"));

beforeEach(() => {
  vi.useFakeTimers();
  ({ ui } = installUiDom());
  banner = new Banner();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Banner", () => {
  it("is not in the page until something is shown", () => {
    expect(pill()).toBeUndefined();
    expect(banner.state).toBe("hidden");
  });

  it("reconnecting() shows an amber pill with a spinner and the sentence, and stays", () => {
    banner.reconnecting();
    const p = pill()!;
    expect(p.classList.contains("reconnecting")).toBe(true);
    expect(p.byClass("banner-text")!.textContent).toBe(RECONNECTING_TEXT);
    expect(RECONNECTING_TEXT).toBe("Connection lost — reconnecting…");
    expect(p.byClass("banner-icon")!.classList.contains("spinner")).toBe(true);
    expect(p.getAttribute("role")).toBe("status");
    vi.advanceTimersByTime(60_000);
    expect(pill()).toBe(p);
    expect(banner.state).toBe("reconnecting");
  });

  it("reconnected() turns the same pill green with a check, then goes after RECONNECTED_MS", () => {
    banner.reconnecting();
    const p = pill()!;
    banner.reconnected();
    expect(pill()).toBe(p);
    expect(p.classList.contains("reconnected")).toBe(true);
    expect(p.classList.contains("reconnecting")).toBe(false);
    expect(p.byClass("banner-text")!.textContent).toBe(RECONNECTED_TEXT);
    const icon = p.byClass("banner-icon")!;
    expect(icon.classList.contains("spinner")).toBe(false);
    expect(icon.textContent).toBe("✓");
    vi.advanceTimersByTime(RECONNECTED_MS - 1);
    expect(pill()).toBe(p);
    vi.advanceTimersByTime(1);
    expect(pill()).toBeUndefined();
    expect(banner.state).toBe("hidden");
  });

  it("drops again during the green flash: the pill is amber again and the flash timer cannot hide it", () => {
    banner.reconnected();
    vi.advanceTimersByTime(RECONNECTED_MS - 100);
    banner.reconnecting();
    vi.advanceTimersByTime(1000);
    expect(pill()!.classList.contains("reconnecting")).toBe(true);
    expect(banner.state).toBe("reconnecting");
  });

  it("hide() removes the pill and cancels the flash timer", () => {
    banner.reconnected();
    banner.hide();
    expect(pill()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    banner.hide();
    expect(banner.state).toBe("hidden");
  });

  it("show(text, ms) is a plain notice with no icon that goes after ms", () => {
    banner.show("Heads up", 500);
    const p = pill()!;
    expect(p.classList.contains("notice")).toBe(true);
    expect(p.byClass("banner-icon")!.hidden).toBe(true);
    expect(p.byClass("banner-text")!.textContent).toBe("Heads up");
    vi.advanceTimersByTime(500);
    expect(pill()).toBeUndefined();
  });

  it("showing again while up keeps one pill", () => {
    banner.reconnecting();
    banner.reconnecting();
    banner.show("x");
    expect(ui.children.filter((c) => typeof c !== "string" && c.classList.contains("banner"))).toHaveLength(1);
  });
});

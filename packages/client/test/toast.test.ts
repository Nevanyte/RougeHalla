import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_HOLD_MS, FADE_MS, HOLD_MS, OK_HOLD_MS, Toasts, holdFor } from "../src/ui/toast";
import { installUiDom, type UiEl } from "./uiDom";

let ui: UiEl;
let toasts: Toasts;
/** The toast nodes currently in the page, oldest first. */
const shown = (): UiEl[] => (ui.children[0] as UiEl).children.filter((c): c is UiEl => typeof c !== "string");

beforeEach(() => {
  vi.useFakeTimers();
  ({ ui } = installUiDom());
  toasts = new Toasts();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("toast tones", () => {
  it("draws a plain toast with no tone class", () => {
    toasts.show("Too far away");
    expect(shown().map((n) => n.className)).toEqual(["toast"]);
  });

  it("adds the tone as a class: buff, error and ok", () => {
    for (const tone of ["buff", "error", "ok"] as const) toasts.show(`news ${tone}`, tone);
    expect(shown().map((n) => n.className)).toEqual(["toast buff", "toast error", "toast ok"]);
  });

  it("an error toast outlasts a plain one, and an ok toast sits between", () => {
    expect(holdFor("short", "error")).toBe(ERROR_HOLD_MS);
    expect(ERROR_HOLD_MS).toBeGreaterThan(HOLD_MS);
    expect(holdFor("short")).toBe(HOLD_MS);
    expect(holdFor("short", "ok")).toBe(OK_HOLD_MS);
    expect(holdFor("short", "buff")).toBe(HOLD_MS);
  });

  it("a long error sentence stays longer, up to a cap", () => {
    const long = "x".repeat(120);
    expect(holdFor(long, "error")).toBeGreaterThan(ERROR_HOLD_MS);
    expect(holdFor("x".repeat(2000), "error")).toBeLessThanOrEqual(8000);
  });

  it("an error toast starts to fade after its own hold, not the plain one", () => {
    toasts.show("Can't reach the game server.", "error");
    vi.advanceTimersByTime(HOLD_MS + 100);
    expect(shown()[0]!.classList.contains("fading")).toBe(false);
    vi.advanceTimersByTime(ERROR_HOLD_MS - HOLD_MS);
    expect(shown()[0]!.classList.contains("fading")).toBe(true);
    vi.advanceTimersByTime(FADE_MS);
    expect(shown()).toHaveLength(0);
  });

  it("a plain toast fades after HOLD_MS and is gone FADE_MS later", () => {
    toasts.show("Nothing to take");
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(shown()[0]!.classList.contains("fading")).toBe(false);
    vi.advanceTimersByTime(1);
    expect(shown()[0]!.classList.contains("fading")).toBe(true);
    vi.advanceTimersByTime(FADE_MS);
    expect(shown()).toHaveLength(0);
  });
});

describe("toast de-duplication", () => {
  it("the same text and tone extends the toast instead of stacking a copy", () => {
    toasts.show("Too far away");
    vi.advanceTimersByTime(HOLD_MS - 100);
    toasts.show("Too far away");
    expect(shown()).toHaveLength(1);
    // The first timer was replaced: it would have faded 100 ms from now.
    vi.advanceTimersByTime(200);
    expect(shown()[0]!.classList.contains("fading")).toBe(false);
    vi.advanceTimersByTime(HOLD_MS);
    expect(shown()[0]!.classList.contains("fading")).toBe(true);
  });

  it("a repeated error keeps the error hold", () => {
    toasts.show("Joining failed", "error");
    vi.advanceTimersByTime(3000);
    toasts.show("Joining failed", "error");
    vi.advanceTimersByTime(ERROR_HOLD_MS - 1);
    expect(shown()[0]!.classList.contains("fading")).toBe(false);
    vi.advanceTimersByTime(1);
    expect(shown()[0]!.classList.contains("fading")).toBe(true);
  });

  it("the same text in another tone is its own toast", () => {
    toasts.show("Reconnected");
    toasts.show("Reconnected", "ok");
    expect(shown().map((n) => n.className)).toEqual(["toast", "toast ok"]);
  });

  it("a toast that is already fading is replaced by a fresh one", () => {
    toasts.show("Too far away");
    vi.advanceTimersByTime(HOLD_MS);
    toasts.show("Too far away");
    expect(shown().filter((n) => !n.classList.contains("fading"))).toHaveLength(1);
  });
});

describe("toast stack", () => {
  it("shows three at a time and drops the oldest", () => {
    for (const t of ["a", "b", "c", "d"]) toasts.show(t);
    expect(shown().map((n) => n.textContent)).toEqual(["b", "c", "d"]);
  });

  it("clear() removes them all and their timers", () => {
    toasts.show("a");
    toasts.show("b", "error");
    toasts.clear();
    expect(shown()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("destroy() takes the stack out of the page", () => {
    toasts.show("a");
    toasts.destroy();
    expect(ui.children).toHaveLength(0);
  });
});

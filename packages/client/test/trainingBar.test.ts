import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HINT_FADE_MS, HINT_HOLD_MS, LeaveLatch, TRAINING_HINTS, hintPhase,
  TrainingBar,
} from "../src/ui/trainingBar";
import { installUiDom, type UiEl } from "./uiDom";

type Handler = (event: object) => void;
function fire(node: UiEl, type: string, event: object = {}): void {
  const handlers = (node as unknown as { handlers: Map<string, Handler[]> }).handlers.get(type) ?? [];
  for (const handler of handlers) handler({ type, ...event });
}

let ui: UiEl;
beforeEach(() => { ({ ui } = installUiDom()); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("leave training", () => {
  it("calls the hub hand-off exactly once however often it is activated", () => {
    const leave = vi.fn();
    const latch = new LeaveLatch(leave);
    expect(latch.armed).toBe(true);
    expect(latch.trigger()).toBe(true);
    // A double click, then Esc.
    expect(latch.trigger()).toBe(false);
    expect(latch.trigger()).toBe(false);
    expect(leave).toHaveBeenCalledTimes(1);
    expect(latch.armed).toBe(false);
  });

  it("latches before calling, so a handler that throws is not retried", () => {
    const leave = vi.fn(() => { throw new Error("hub failed"); });
    const latch = new LeaveLatch(leave);
    expect(() => latch.trigger()).toThrow("hub failed");
    expect(latch.trigger()).toBe(false);
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("without a handler (not a training room) there is nothing to fire", () => {
    const latch = new LeaveLatch(undefined);
    expect(latch.armed).toBe(false);
    expect(latch.trigger()).toBe(false);
  });
});

describe("training tips", () => {
  it("name the rack, the swap keys and the shield dummy, in a few short lines", () => {
    const text = TRAINING_HINTS.join("\n");
    expect(TRAINING_HINTS.length).toBeLessThanOrEqual(5);
    expect(text).toMatch(/rack/i);
    expect(text).toMatch(/\bF\b/);
    expect(text).toMatch(/\bQ\b/);
    expect(text).toMatch(/1 \/ 2/);
    expect(text).toMatch(/shield dummy blocks and reflects/i);
    expect(text).toMatch(/\bE casts your faction's Wish\b/);
    expect(text).toMatch(/5 s cooldown/);
    for (const line of TRAINING_HINTS) expect(line.length).toBeLessThanOrEqual(70);
  });

  it("stay for HINT_HOLD_MS, fade for HINT_FADE_MS, then are gone", () => {
    expect(hintPhase(0, false)).toBe("show");
    expect(hintPhase(HINT_HOLD_MS - 1, false)).toBe("show");
    expect(hintPhase(HINT_HOLD_MS, false)).toBe("fade");
    expect(hintPhase(HINT_HOLD_MS + HINT_FADE_MS - 1, false)).toBe("fade");
    expect(hintPhase(HINT_HOLD_MS + HINT_FADE_MS, false)).toBe("gone");
    expect(HINT_HOLD_MS).toBeLessThanOrEqual(25_000);
  });

  it("dismissing them hides them at once, whatever the clock says", () => {
    expect(hintPhase(0, true)).toBe("gone");
    expect(hintPhase(HINT_HOLD_MS, true)).toBe("gone");
  });

  it("reopens automatically hidden tips with a fresh timer and an accessible toggle", () => {
    const bar = new TrainingBar();
    const root = ui.children[0] as UiEl;
    const tips = root.byClass("training-tips")!;
    const toggle = root.byClass("training-tips-toggle")!;
    bar.update(1_000);
    bar.update(1_000 + HINT_HOLD_MS + HINT_FADE_MS);
    expect(tips.hidden).toBe(true);
    expect(toggle.text).toBe("Show controls");
    expect(toggle.getAttribute("aria-controls")).toBe(tips.id);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fire(toggle, "click");
    expect(tips.hidden).toBe(false);
    expect(toggle.text).toBe("Hide controls");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    bar.update(1_000 + HINT_HOLD_MS + HINT_FADE_MS + HINT_HOLD_MS - 1);
    expect(tips.hidden).toBe(false);
    bar.update(1_000 + HINT_HOLD_MS + HINT_FADE_MS + HINT_HOLD_MS);
    expect(toggle.text).toBe("Hide controls");
    expect(tips.classList.contains("fading")).toBe(true);

    fire(toggle, "click");
    expect(tips.hidden).toBe(true);
    expect(toggle.text).toBe("Show controls");
    bar.destroy();
  });

  it("lets players dismiss and reopen tips before the initial timer expires", () => {
    const bar = new TrainingBar();
    const root = ui.children[0] as UiEl;
    const tips = root.byClass("training-tips")!;
    const toggle = root.byClass("training-tips-toggle")!;
    bar.update(10_000);
    fire(toggle, "click");
    expect(tips.hidden).toBe(true);
    fire(toggle, "click");
    expect(tips.hidden).toBe(false);
    bar.update(10_000 + HINT_HOLD_MS - 1);
    expect(tips.hidden).toBe(false);
    bar.update(10_000 + HINT_HOLD_MS);
    expect(tips.classList.contains("fading")).toBe(true);
    bar.destroy();
  });

  it("closes the practice console when Show controls is used", () => {
    const bar = new TrainingBar(undefined, { send: () => {} });
    const root = ui.children[0] as UiEl;
    const tips = root.byClass("training-tips")!;
    const tipsToggle = root.byClass("training-tips-toggle")!;
    const consoleToggle = root.byClass("train-toggle")!;
    const panel = root.byClass("train-panel")!;

    fire(consoleToggle, "click");
    expect(panel.hidden).toBe(false);
    expect(tips.hidden).toBe(true);
    expect(tipsToggle.text).toBe("Show controls");

    fire(tipsToggle, "click");
    expect(panel.hidden).toBe(true);
    expect(consoleToggle.getAttribute("aria-expanded")).toBe("false");
    expect(tips.hidden).toBe(false);
    expect(tipsToggle.getAttribute("aria-expanded")).toBe("true");
    bar.destroy();
  });
});

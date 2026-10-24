import { describe, expect, it, vi } from "vitest";
import {
  HINT_FADE_MS, HINT_HOLD_MS, LeaveLatch, TRAINING_HINTS, hintPhase,
} from "../src/ui/trainingBar";

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
});

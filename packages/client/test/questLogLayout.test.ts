import { describe, expect, it } from "vitest";
import {
  QUEST_LOG_BOTTOM_RESERVE, QUEST_LOG_GAP, QUEST_LOG_GUTTER, QUEST_LOG_MAX_WIDTH, QUEST_LOG_MIN_HEIGHT, placeQuestLog, type PlateBox,
} from "../src/ui/questLogLayout";
import { computeLayout } from "../src/view/viewport";

// The sizes the overlay is laid out at for real windows (view/viewport.ts: --ui-w x --ui-h), not the windows themselves.
const WINDOWS: Array<[number, number]> = [[800, 600], [1024, 768], [1280, 720], [1366, 768], [1600, 900], [1920, 1080], [2560, 1080], [400, 800]];
const uiOf = (w: number, h: number) => {
  const view = computeLayout({ cssW: w, cssH: h, dpr: 1, hiDpi: true });
  return { w: view.uiW, h: view.uiH };
};
/** Fresh run (status, vitals), a few cards, a crowded cards row (about 420 px of chips). */
const PLATES: PlateBox[] = [
  { left: 12, top: 10, right: 290, bottom: 84 },
  { left: 12, top: 10, right: 290, bottom: 240 },
  { left: 12, top: 10, right: 290, bottom: 450 },
];

describe("placeQuestLog", () => {
  it("never covers the HUD plate and keeps clear of the weapon bar at every window size", () => {
    for (const [w, h] of WINDOWS) {
      const ui = uiOf(w, h);
      for (const plate of PLATES) {
        const box = placeQuestLog(ui, plate);
        const label = `${w}x${h} (ui ${Math.round(ui.w)}x${Math.round(ui.h)}) plate to ${plate.bottom}`;
        expect(box.top, label).toBeGreaterThanOrEqual(plate.bottom + QUEST_LOG_GAP);
        expect(box.left, label).toBe(plate.left);
        expect(box.left + box.width, label).toBeLessThanOrEqual(ui.w - QUEST_LOG_GUTTER);
        expect(box.width, label).toBeLessThanOrEqual(QUEST_LOG_MAX_WIDTH);
        expect(box.maxHeight, label).toBeGreaterThanOrEqual(QUEST_LOG_MIN_HEIGHT);
        // Whenever the plate leaves room at all, the log ends above the weapon bar's reserve.
        if (ui.h - plate.bottom - QUEST_LOG_GAP - QUEST_LOG_BOTTOM_RESERVE >= QUEST_LOG_MIN_HEIGHT) {
          expect(box.top + box.maxHeight, label).toBeLessThanOrEqual(ui.h - QUEST_LOG_BOTTOM_RESERVE);
        }
      }
    }
  });

  it("gives a fresh run's log most of the left column at 800x600", () => {
    const ui = uiOf(800, 600);
    const box = placeQuestLog(ui, PLATES[0]!);
    expect(ui).toEqual({ w: 1000, h: 750 });
    expect(box).toEqual({ left: 12, top: 92, width: 340, maxHeight: 750 - 92 - QUEST_LOG_BOTTOM_RESERVE });
  });

  it("follows the plate down as the cards row grows, and stays out of the top-centre lines on a wide screen", () => {
    const ui = uiOf(1920, 1080);
    const short = placeQuestLog(ui, PLATES[0]!);
    const tall = placeQuestLog(ui, PLATES[2]!);
    expect(tall.top - short.top).toBe(PLATES[2]!.bottom - PLATES[0]!.bottom);
    expect(tall.maxHeight).toBeLessThan(short.maxHeight);
    // The sudden-death and teleport-shield lines are centred at the top; the log's right edge stays well left of them.
    expect(short.left + short.width).toBeLessThan(ui.w / 2 - 150);
    const narrow = placeQuestLog(uiOf(800, 600), PLATES[0]!);
    expect(narrow.left + narrow.width).toBeLessThan(1000 / 2 - 100);
  });

  it("falls back to the plate's usual bottom when it cannot be measured, and survives non-finite sizes", () => {
    const unmeasured = placeQuestLog({ w: 1000, h: 750 }, null);
    expect(unmeasured.top).toBe(92);
    const broken = placeQuestLog({ w: Number.NaN, h: Number.NaN }, { left: Number.NaN, top: 0, right: 0, bottom: Number.NaN });
    for (const n of Object.values(broken)) expect(Number.isFinite(n)).toBe(true);
  });
});

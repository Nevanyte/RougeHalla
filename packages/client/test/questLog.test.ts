import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuestLog, type QuestLogFrame } from "../src/ui/questLog";
import type { QuestStateLike } from "../src/ui/questModel";
import { asEl, installPlanningDom } from "./planningDom";

const state: QuestStateLike = {
  id: "q1", def: "cull-fire", x: 10, y: 20, status: "open", doneBy: "", expiresAt: 65_000,
  carrier: "", progress: new Map([["me", 2]]),
};
const quests = { forEach(cb: (q: QuestStateLike, id: string) => void) { cb(state, state.id); } };
const frame = (over: Partial<QuestLogFrame> = {}): QuestLogFrame => ({
  phase: "active", training: false, quests, hidden: 0, localId: "me", serverNow: 0, ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe("QuestLog", () => {
  it("toggles with J and lists the objective, progress, time, reward, status and hidden count", () => {
    const dom = installPlanningDom();
    const log = new QuestLog();
    const current = frame({ hidden: 5, serverNow: 5_000 });
    log.update(current);
    expect(log.visible).toBe(false);
    dom.press("KeyJ");
    log.update(current);
    expect(log.visible).toBe(true);
    expect(dom.ui.byClass("quest-log-objective")[0]?.textContent).toBe("Kill 3 mobs in Fire");
    expect(dom.ui.byClass("quest-log-progress")[0]?.textContent).toContain("Your progress 2 / 3");
    expect(dom.ui.byClass("quest-log-time")[0]?.textContent).toBe("1:00");
    expect(dom.ui.byClass("quest-log-reward")[0]?.textContent).toContain("Ember Imp");
    expect(dom.ui.byClass("quest-log-status")[0]?.textContent).toBe("Open");
    expect(dom.ui.byClass("quest-log-rumoured")[0]?.textContent).toContain("+5 rumoured");
    dom.press("KeyJ");
    expect(log.visible).toBe(false);
    log.destroy();
  });

  it("allows native wheel scrolling for ten rows without leaking pointer input to the game", () => {
    const dom = installPlanningDom();
    const log = new QuestLog();
    const rows = Array.from({ length: 10 }, (_, i) => ({ ...state, id: `q${i}` }));
    const many = { forEach(cb: (q: QuestStateLike, id: string) => void) { for (const q of rows) cb(q, q.id); } };
    log.update(frame({ quests: many }));
    log.toggle();
    log.update(frame({ quests: many }));
    expect(dom.ui.byClass("quest-log-row")).toHaveLength(10);
    let leaked = 0;
    for (const type of ["wheel", "pointerdown", "mousedown", "touchstart"]) dom.win.addEventListener(type, () => { leaked++; });
    for (const type of ["wheel", "pointerdown", "mousedown", "touchstart"]) {
      const event = asEl(log.element).dispatch(type, { deltaY: 120, button: 2 });
      expect(event.propagationStopped).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(leaked).toBe(0);
    const css = readFileSync(new URL("../src/ui/questLog.css", import.meta.url), "utf8");
    expect(css).toContain("overflow: auto");
    expect(css).toContain("pointer-events: auto");
    expect(css).toContain("overscroll-behavior: contain");
    log.destroy();
  });

  it("ignores J while typing and outside planning and the active run", () => {
    const dom = installPlanningDom();
    const log = new QuestLog();
    log.update(frame({ phase: "lobby" }));
    dom.press("KeyJ");
    expect(log.visible).toBe(false);
    log.update(frame());
    const input = dom.doc.createElement("input");
    input.dispatch("keydown", { code: "KeyJ", key: "KeyJ", repeat: false, ctrlKey: false, metaKey: false, altKey: false });
    expect(log.visible).toBe(false);
    log.destroy();
  });

  it("opens with J during planning above the planning overlay", () => {
    const dom = installPlanningDom();
    const log = new QuestLog();
    log.update(frame({ phase: "planning" }));
    dom.press("KeyJ");
    log.update(frame({ phase: "planning" }));
    expect(log.visible).toBe(true);
    expect(log.element.hidden).toBe(false);
    expect(dom.ui.byClass("quest-log-objective")).toHaveLength(1);
    const css = readFileSync(new URL("../src/ui/questLog.css", import.meta.url), "utf8");
    expect(css).toContain("z-index: 11");
    log.destroy();
  });

  it("opens in training with a practice empty state", () => {
    const dom = installPlanningDom();
    const log = new QuestLog();
    log.update(frame({ training: true, hidden: 5 }));
    dom.press("KeyJ");
    log.update(frame({ training: true, hidden: 5 }));
    expect(log.visible).toBe(true);
    expect(dom.ui.byClass("quest-log-empty")[0]?.textContent).toBe("No quests in practice");
    expect(dom.ui.byClass("quest-log-row")).toHaveLength(0);
    expect(dom.ui.byClass("quest-log-rumoured")[0]?.hidden).toBe(true);
    log.destroy();
  });

  it("follows the live HUD bottom instead of covering a taller buff plate", () => {
    const dom = installPlanningDom();
    const log = new QuestLog();
    log.update(frame({ hudBottom: 220 }));
    log.toggle();
    log.update(frame({ hudBottom: 220 }));
    expect(asEl(log.element).style.props["--quest-log-top"]).toBe("228px");
    log.update(frame({ hudBottom: 360 }));
    expect(asEl(log.element).style.props["--quest-log-top"]).toBe("368px");
    log.destroy();
  });
});

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TILE, questDefById } from "@raid/shared";
import { QuestLog, questLogAvailable, type QuestLogFrame } from "../src/ui/questLog";
import { QUEST_LOG_BOTTOM_RESERVE, QUEST_LOG_GAP } from "../src/ui/questLogLayout";
import type { QuestStateLike } from "../src/ui/questModel";
import { computeLayout } from "../src/view/viewport";
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

describe("QuestLog acceptance", () => {
  it("marks an open row Accepted, or Not accepted with the giver to talk to, and says what to do in planning", () => {
    const dom = installPlanningDom();
    const log = new QuestLog();
    const rows = (accepted: Map<string, boolean> | undefined) => {
      const q = { ...state, accepted };
      return { forEach(cb: (q: QuestStateLike, id: string) => void) { cb(q, q.id); } };
    };
    log.update(frame({ quests: rows(new Map([["me", true]])) }));
    log.toggle();
    log.update(frame({ quests: rows(new Map([["me", true]])) }));
    expect(dom.ui.byClass("quest-log-accept")[0]?.textContent).toBe("Accepted");
    expect(dom.ui.byClass("quest-log-accept")[0]?.className).toContain(" yes");
    log.update(frame({ quests: rows(new Map()) }));
    expect(dom.ui.byClass("quest-log-accept")[0]?.textContent).toBe(`Not accepted: talk to ${questDefById("cull-fire")!.giver}`);
    expect(dom.ui.byClass("quest-log-accept")[0]?.className).toContain(" no");
    // The row's own status word is untouched.
    expect(dom.ui.byClass("quest-log-status")[0]?.textContent).toBe("Open");
    log.update(frame({ phase: "planning", quests: rows(undefined) }));
    expect(dom.ui.byClass("quest-log-accept")[0]?.textContent).toBe("Accept at the giver in the run");
    // A finished row has no acceptance line.
    const done = { forEach(cb: (q: QuestStateLike, id: string) => void) { cb({ ...state, status: "done", doneBy: "Bravo" }, state.id); } };
    log.update(frame({ quests: done }));
    expect(dom.ui.byClass("quest-log-accept")).toHaveLength(0);
    log.destroy();
  });
});

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
    expect(dom.ui.byClass("quest-log-reward")[0]?.textContent).toContain("2 × Attack Damage II (+21 attack damage each) and 10 GV");
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
    const menu = asEl(log.element).dispatch("contextmenu", { button: 2 });
    expect(menu.propagationStopped, "a right-click on the log never reaches the game").toBe(true);
    expect(menu.defaultPrevented, "nor opens the browser menu").toBe(true);
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

  it("sits under the live HUD plate at 800x600 and the common 16:9 sizes, however tall the cards row grows", () => {
    const dom = installPlanningDom();
    const log = new QuestLog();
    for (const [w, h] of [[800, 600], [1280, 720], [1366, 768], [1920, 1080]] as const) {
      const view = computeLayout({ cssW: w, cssH: h, dpr: 1, hiDpi: true });
      const ui = { w: view.uiW, h: view.uiH };
      for (const bottom of [84, 220, 360]) {
        const plate = { left: 12, top: 10, right: 290, bottom };
        log.update(frame({ ui, plate: () => plate }));
        if (!log.visible) log.toggle();
        log.update(frame({ ui, plate: () => plate }));
        const props = asEl(log.element).style.props;
        const top = Number.parseFloat(props["--quest-log-top"]!);
        const maxH = Number.parseFloat(props["--quest-log-max-h"]!);
        expect(top, `${w}x${h} plate ${bottom}`).toBeGreaterThanOrEqual(bottom + QUEST_LOG_GAP);
        expect(top + maxH, `${w}x${h} plate ${bottom}`).toBeLessThanOrEqual(ui.h - QUEST_LOG_BOTTOM_RESERVE);
        expect(Number.parseFloat(props["--quest-log-left"]!) + Number.parseFloat(props["--quest-log-width"]!)).toBeLessThanOrEqual(ui.w - 12);
      }
    }
    void dom;
    log.destroy();
  });

  it("asks for the plate only while it is up and writes its box only when it moved", () => {
    installPlanningDom();
    const log = new QuestLog();
    let reads = 0;
    const ui = { w: 1000, h: 750 };
    const plate = (bottom: number) => () => { reads++; return { left: 12, top: 10, right: 290, bottom }; };
    log.update(frame({ ui, plate: plate(100) }));
    expect(reads).toBe(0);
    log.toggle();
    const writes: string[] = [];
    const style = asEl(log.element).style;
    const set = style.setProperty.bind(style);
    style.setProperty = (k: string, v: string) => { writes.push(k); set(k, v); };
    log.update(frame({ ui, plate: plate(100) }));
    log.update(frame({ ui, plate: plate(100) }));
    expect(reads).toBe(2);
    expect(writes.filter((k) => k === "--quest-log-top")).toHaveLength(1);
    log.update(frame({ ui, plate: plate(260) }));
    expect(asEl(log.element).style.props["--quest-log-top"]).toBe("268px");
    expect(writes.filter((k) => k === "--quest-log-top")).toHaveLength(2);
    log.destroy();
  });

  it("opens only in planning and the run, and the game's other keys pass through untouched", () => {
    const dom = installPlanningDom();
    const log = new QuestLog();
    const available = ["lobby", "planning", "active", "ended"].filter(questLogAvailable);
    expect(available).toEqual(["planning", "active"]);
    for (const phase of ["planning", "active"]) {
      log.update(frame({ phase }));
      expect(dom.press("KeyJ").defaultPrevented).toBe(true);
      log.update(frame({ phase }));
      expect(log.visible, phase).toBe(true);
      dom.press("KeyJ");
      log.update(frame({ phase }));
      expect(log.visible, phase).toBe(false);
    }
    dom.doc.body.focus();
    // Planning's own keys, the chest panel's (C, the digits, Esc) and Tab are none of the log's business.
    log.update(frame({ phase: "planning" }));
    for (const code of ["Digit1", "Digit2", "Digit0", "ArrowLeft", "ArrowDown", "Enter", "Delete", "KeyC", "Escape", "Tab", "KeyF"]) {
      const event = dom.press(code);
      expect(event.defaultPrevented, code).toBe(false);
      expect(event.propagationStopped, code).toBe(false);
    }
    expect(log.visible).toBe(false);
    log.destroy();
  });

  it("leaves J to an open dialog (the help or settings card)", () => {
    const dom = installPlanningDom();
    const log = new QuestLog();
    log.update(frame());
    const dialog = dom.doc.createElement("div");
    dialog.setAttribute("role", "dialog");
    const button = dom.doc.createElement("button");
    dialog.append(button);
    dom.ui.append(dialog);
    (dialog as unknown as { closest: (s: string) => unknown }).closest = (selector: string) => (selector === '[role="dialog"]' ? dialog : null);
    (button as unknown as { closest: (s: string) => unknown }).closest = (selector: string) => (selector === '[role="dialog"]' ? dialog : null);
    button.focus();
    expect(dom.press("KeyJ").defaultPrevented).toBe(false);
    log.update(frame());
    expect(log.visible).toBe(false);
    log.destroy();
  });

  it("lists open offers first, then done, then expired, with no timer and a full count on a closed row", () => {
    const dom = installPlanningDom();
    const log = new QuestLog();
    const rows: QuestStateLike[] = [
      { ...state, id: "x", def: "banner-fire", status: "expired" },
      { ...state, id: "d", def: "banner-holy", status: "done", doneBy: "Me", carrier: "" },
      { ...state, id: "o", def: "cull-fire" },
      { ...state, id: "d2", def: "bloom-plague", status: "done", doneBy: "Bravo" },
    ];
    const many = { forEach(cb: (q: QuestStateLike, id: string) => void) { for (const q of rows) cb(q, q.id); } };
    const f = frame({ quests: many, localName: "Me", serverNow: 5_000 });
    log.update(f);
    log.toggle();
    log.update(f);
    const nameOf = (id: string): string => questDefById(id)!.name;
    const doneNames = [nameOf("banner-holy"), nameOf("bloom-plague")].sort((a, b) => a.localeCompare(b));
    expect(dom.ui.byClass("quest-log-name").map((n) => n.textContent)).toEqual([nameOf("cull-fire"), ...doneNames, nameOf("banner-fire")]);
    const articles = dom.ui.byClass("quest-log-row");
    expect(articles.map((a) => a.classList.contains("closed"))).toEqual([false, true, true, true]);
    expect(dom.ui.byClass("quest-log-time")).toHaveLength(1);
    const mine = articles.find((a) => a.textContent.includes("Done by Me"))!;
    expect(mine.textContent).toContain("Your progress 1 / 1");
    log.destroy();
  });
});

describe("quest tracking controls", () => {
  it("tracks the giver before acceptance, preserves focus through timer updates, and clears closed tracking", () => {
    const dom = installPlanningDom();
    const log = new QuestLog();
    const q = { ...state, accepted: new Map<string, boolean>() };
    const publicQuests = { forEach(cb: (quest: QuestStateLike, id: string) => void) { cb(q, q.id); } };
    const f = frame({ quests: publicQuests, alive: true, local: { x: 600, y: 600 } });
    log.update(f);
    asEl(log.launcher).click();
    log.update(f);
    const track = dom.ui.byClass("quest-log-track")[0]!;
    track.focus();
    track.click();
    expect(log.trackedId).toBe("q1");
    expect(log.tracker.hidden).toBe(false);
    expect(dom.ui.byClass("quest-tracker-text")[0]?.textContent).toContain("Talk to Ashmother Vela to accept");
    const article = dom.ui.byClass("quest-log-row")[0];
    log.update({ ...f, serverNow: 1000 });
    expect(dom.ui.byClass("quest-log-row")[0]).toBe(article);
    expect(dom.doc.activeElement).toBe(track);
    track.click();
    expect(log.trackedId).toBeNull();
    log.update({ ...f, serverNow: 2000 });
    expect(log.trackedId).toBeNull();
    q.accepted.set("me", true);
    log.update(f);
    expect(log.trackedId).toBe("q1");
    const escape = dom.press("Escape");
    expect(escape.defaultPrevented).toBe(true);
    expect(log.visible).toBe(false);
    expect(dom.doc.activeElement).toBe(asEl(log.launcher));
    q.status = "expired";
    log.update(f);
    expect(log.trackedId).toBeNull();
    expect(log.tracker.hidden).toBe(true);
    log.destroy();
  });

  it("only offers the existing accept dialog beside a published giver during the active run", () => {
    const dom = installPlanningDom();
    const onTalk = vi.fn();
    const log = new QuestLog({ onTalk });
    const q = { ...state, accepted: new Map<string, boolean>() };
    const publicQuests = { forEach(cb: (quest: QuestStateLike, id: string) => void) { cb(q, q.id); } };
    const f = frame({ quests: publicQuests, alive: true, local: { x: q.x, y: q.y } });
    log.update(f);
    log.toggle();
    log.update(f);
    const talk = dom.ui.byClass("quest-log-talk")[0]!;
    expect(talk.hidden).toBe(false);
    talk.click();
    expect(onTalk).toHaveBeenCalledWith(q.id);
    expect(log.visible).toBe(false);
    log.toggle();
    for (const update of [
      { ...f, local: { x: 1000, y: 1000 } },
      { ...f, phase: "planning" },
      { ...f, alive: false },
    ]) {
      log.update(update);
      expect(talk.hidden).toBe(true);
    }
    // A reveal has no public acceptance map yet: tracking information is allowed, accepting it is not.
    const preview = { ...q, accepted: undefined };
    log.update({ ...f, quests: { forEach: (cb) => cb(preview, preview.id) } });
    expect(talk.hidden).toBe(true);
    log.destroy();
  });
});


describe("tracked waypoint distance", () => {
  it("uses the destination label and routed length rather than distance through a wall", () => {
    const dom = installPlanningDom();
    const log = new QuestLog();
    const q = { ...state, accepted: new Map([["me", true]]) };
    log.update(frame({ quests: { forEach: (cb) => cb(q, q.id) }, alive: true, local: { x: 0, y: 0 } }));
    log.setDestination({ role: "objective", kind: "kill", x: TILE, y: TILE, tracked: true,
      waypoint: { label: "Defeat a Fire mob", step: 3, total: 3 },
      route: [{ x: 0, y: 0 }, { x: 3 * TILE, y: 0 }, { x: 3 * TILE, y: TILE }, { x: TILE, y: TILE }],
    });
    expect(dom.ui.byClass("quest-tracker-text")[0]?.textContent).toContain("Defeat a Fire mob");
    expect(dom.ui.byClass("quest-tracker-text")[0]?.textContent).toContain("6 tiles along route");
    log.destroy();
  });
});

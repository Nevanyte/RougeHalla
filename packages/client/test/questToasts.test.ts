import { afterEach, describe, expect, it, vi } from "vitest";
import { Toasts } from "../src/ui/toast";
import { installPlanningDom } from "./planningDom";
import { QUEST_TOAST_DUPLICATE_MS, QUEST_TOAST_WINDOW_MS, QuestToasts, expiredToastText, type QuestToastTimers } from "../src/ui/questToasts";

/** A clock and a timer wheel the test drives by hand. */
function harness(localName = "Me") {
  let now = 1_000;
  let nextHandle = 1;
  const pending = new Map<number, { at: number; cb: () => void }>();
  const timers: QuestToastTimers = {
    set: (cb, ms) => { const h = nextHandle++; pending.set(h, { at: now + ms, cb }); return h; },
    clear: (h) => { pending.delete(h as number); },
    now: () => now,
  };
  const shown: string[] = [];
  const toasts = new QuestToasts((text) => shown.push(text), () => localName, timers);
  const advance = (ms: number): void => {
    now += ms;
    for (const [h, t] of [...pending]) if (t.at <= now) { pending.delete(h); t.cb(); }
  };
  return { toasts, shown, advance, pending: () => pending.size };
}

afterEach(() => vi.unstubAllGlobals());

describe("quest toasts", () => {
  it("shows the completer ONE completion line, whichever order the private and the public line arrive in", () => {
    const a = harness();
    a.toasts.push("Quest complete: Cinder Cull");
    a.toasts.push("Me completed quest: Cinder Cull");
    expect(a.shown).toEqual(["Quest complete: Cinder Cull"]);
    const b = harness();
    b.toasts.push("Me completed quest: Cinder Cull");
    b.toasts.push("Quest complete: Cinder Cull");
    expect(b.shown).toEqual(["Me completed quest: Cinder Cull"]);
  });

  it("still shows a rival's completion, and the same offer's line again once the duplicate window is over", () => {
    const h = harness();
    h.toasts.push("Bravo completed quest: Cinder Cull");
    h.toasts.push("Me completed quest: Ashcaps");
    h.advance(QUEST_TOAST_DUPLICATE_MS + 1);
    h.toasts.push("Me completed quest: Ashcaps");
    expect(h.shown).toEqual(["Bravo completed quest: Cinder Cull", "Me completed quest: Ashcaps", "Me completed quest: Ashcaps"]);
  });

  it("folds quests that expire together into one line, however the server split them", () => {
    const h = harness();
    h.toasts.push("Quest expired: Cinder Cull");
    h.toasts.push("Quest expired: Thaw the Watch");
    h.toasts.push("Quest expired: Break the Chains");
    expect(h.shown).toEqual([]);
    h.advance(QUEST_TOAST_WINDOW_MS);
    expect(h.shown).toEqual(["3 quests expired"]);
    h.toasts.push("2 quests expired");
    h.toasts.push("Quest expired");
    h.advance(QUEST_TOAST_WINDOW_MS);
    expect(h.shown).toEqual(["3 quests expired", "3 quests expired"]);
  });

  it("keeps a lone expiry's wording, and lets every other toast through at once", () => {
    const h = harness();
    h.toasts.push("Quest expired: Ashcaps");
    h.toasts.push("+10 GV (quest)");
    expect(h.shown).toEqual(["+10 GV (quest)"]);
    h.advance(QUEST_TOAST_WINDOW_MS);
    expect(h.shown).toEqual(["+10 GV (quest)", "Quest expired: Ashcaps"]);
    h.toasts.push("Quest expired");
    h.advance(QUEST_TOAST_WINDOW_MS);
    expect(h.shown.at(-1)).toBe("Quest expired");
    expect(expiredToastText(1, null)).toBe("Quest expired");
    expect(expiredToastText(2, "x")).toBe("2 quests expired");
  });

  it("does not leave a timer behind after the room goes", () => {
    const h = harness();
    h.toasts.push("Quest expired: Ashcaps");
    expect(h.pending()).toBe(1);
    h.toasts.reset();
    expect(h.pending()).toBe(0);
    h.advance(QUEST_TOAST_WINDOW_MS * 2);
    expect(h.shown).toEqual([]);
  });

  it("keeps the GV line on the 3-slot stack: the completer's quest news is one line, not two", () => {
    const dom = installPlanningDom();
    const stack = new Toasts();
    const quest = new QuestToasts((text) => stack.show(text), () => "Me");
    for (const text of ["Quest complete: Cinder Cull", "Me completed quest: Cinder Cull", "+10 GV (quest)", "Emberling +1"]) quest.push(text);
    expect(dom.ui.byClass("toast").map((t) => t.textContent)).toEqual(["Quest complete: Cinder Cull", "+10 GV (quest)", "Emberling +1"]);
    stack.destroy();
  });
});

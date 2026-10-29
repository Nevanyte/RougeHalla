import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FACTION_IDS } from "@raid/shared";
import { ChampionsPanel } from "../src/ui/hub/championsPanel";
import { asEl, installPlanningDom, type PlanningDom } from "./planningDom";

let dom: PlanningDom;
let panel: ChampionsPanel;
beforeEach(() => { dom = installPlanningDom(); });
afterEach(() => { panel?.onHide(); vi.unstubAllGlobals(); });
const expanded = () => asEl(panel.root).byClass("champion-advanced").every(node => !node.hidden);
const collapsed = () => asEl(panel.root).byClass("champion-advanced").every(node => node.hidden);
function key(type: "keydown" | "keyup", code: string, extra = {}) {
  return dom.doc.body.dispatch(type, { key: "Shift", code, ...extra });
}

describe("champion ability reference", () => {
  it("starts with short explanations and scaling, keeping formulas behind Shift", () => {
    panel = new ChampionsPanel();
    dom.ui.append(asEl(panel.root));
    panel.onShow();
    const root = asEl(panel.root);
    expect(root.byClass("champion-option")).toHaveLength(FACTION_IDS.length);
    expect(root.byClass("champion-ability")).toHaveLength(2);
    expect(root.one("champion-name").textContent).toBe("Fire");
    expect(root.byClass("champion-scaling")[0]!.textContent).toContain("AP");
    expect(collapsed()).toBe(true);
    expect(root.one("champion-details-toggle").attrs.get("aria-expanded")).toBe("false");
    expect(root.byClass("champion-weapon-row")).toHaveLength(6);
  });

  it("expands while either Shift is held, without consuming browser or navigation input", () => {
    panel = new ChampionsPanel(); panel.onShow();
    expect(key("keydown", "ShiftLeft").defaultPrevented).toBe(false);
    expect(expanded()).toBe(true);
    key("keydown", "ShiftRight");
    key("keyup", "ShiftLeft");
    expect(expanded()).toBe(true);
    key("keyup", "ShiftRight");
    expect(collapsed()).toBe(true);
    key("keydown", "ShiftLeft", { ctrlKey: true });
    expect(collapsed()).toBe(true);
  });

  it("supports a click-to-pin alternative and clears transient held-key state on focus loss", () => {
    panel = new ChampionsPanel(); panel.onShow();
    key("keydown", "ShiftLeft");
    asEl(panel.root).one("champion-details-toggle").click();
    key("keyup", "ShiftLeft");
    expect(expanded()).toBe(true);
    dom.doc.body.dispatch("blur");
    expect(expanded()).toBe(true); // The user's explicit pin survives focus changes.
    asEl(panel.root).one("champion-details-toggle").click();
    expect(collapsed()).toBe(true);
    key("keydown", "ShiftLeft");
    dom.doc.body.dispatch("blur");
    expect(collapsed()).toBe(true);
    key("keydown", "ShiftLeft");
    dom.doc.visibilityState = "hidden";
    dom.doc.body.dispatch("visibilitychange");
    expect(collapsed()).toBe(true);
  });

  it("handles opening while Shift is already held, and removes its listeners when closed", () => {
    panel = new ChampionsPanel();
    const winBefore = dom.win.count(); const docBefore = dom.doc.count();
    panel.onShow({ shiftKey: true });
    expect(expanded()).toBe(true);
    panel.onShow();
    expect(dom.win.count()).toBe(winBefore + 3);
    expect(dom.doc.count()).toBe(docBefore + 1);
    key("keyup", "ShiftLeft"); expect(collapsed()).toBe(true);
    panel.onShow({ shiftKey: true });
    key("keydown", "ShiftRight");
    key("keyup", "ShiftRight", { shiftKey: true });
    expect(expanded()).toBe(true);
    key("keyup", "ShiftLeft", { shiftKey: false });
    expect(collapsed()).toBe(true);
    asEl(panel.root).one("champion-details-toggle").click();
    panel.onHide();
    expect(dom.win.count()).toBe(winBefore);
    expect(dom.doc.count()).toBe(docBefore);
    panel.onShow(); expect(collapsed()).toBe(true);
  });

  it("browses all five kits with keyboard support without changing the next-run pick", () => {
    const pick = vi.fn(); panel = new ChampionsPanel({ onPick: pick });
    panel.setPick({ faction: "fire" }); panel.onShow();
    const root = asEl(panel.root);
    const options = root.byClass("champion-option");
    options[0]!.focus(); options[0]!.key("ArrowDown");
    expect(dom.doc.activeElement).toBe(options[1]);
    expect(root.one("champion-name").textContent).toBe("Sentenced");
    expect(pick).not.toHaveBeenCalled();
    root.one("champion-select").click();
    expect(pick).toHaveBeenCalledExactlyOnceWith("sentenced");
    panel.setPick({ faction: "sentenced" });
    expect(root.one("champion-select").disabled).toBe(true);
    for (const [index, id] of FACTION_IDS.entries()) {
      options[index]!.click();
      expect(root.byClass("champion-ability")).toHaveLength(2);
      expect(options[index]!.attrs.get("aria-selected")).toBe("true");
      expect(options.filter(option => option.tabIndex === 0)).toHaveLength(1);
      expect(root.one("champion-content").attrs.get("aria-labelledby")).toContain(id);
    }
  });
});

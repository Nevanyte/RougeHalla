import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_WEAPON_IDS, FACTION_IDS, WEAPONS } from "@raid/shared";
import { WeaponsPanel } from "../src/ui/hub/weaponsPanel";
import { ChampionsPanel } from "../src/ui/hub/championsPanel";
import { asEl, installPlanningDom, type PlanningDom } from "./planningDom";

let dom: PlanningDom;
beforeEach(() => { dom = installPlanningDom(); });
afterEach(() => vi.unstubAllGlobals());

describe("weapon guide", () => {
  it("browses every weapon's scaling and intended matchups with a roving keyboard tab stop", () => {
    const panel = new WeaponsPanel();
    const root = asEl(panel.root); dom.ui.append(root);
    const options = root.byClass("weapon-guide-option");
    expect(options).toHaveLength(6);
    for (const [index, id] of ALL_WEAPON_IDS.entries()) {
      options[index]!.click();
      expect(root.one("weapon-guide-name").textContent).toBe(WEAPONS[id].name);
      expect(root.one("weapon-guide-content").attrs.get("aria-labelledby")).toBe(options[index]!.id);
      expect(options.filter(node => node.tabIndex === 0)).toHaveLength(1);
      expect(root.textContent).toContain("not measured win-rate promises");
      if (id === "fists") expect(root.textContent).toContain("Outside the five-weapon");
      else {
        expect(root.one("weapon-guide-favored").textContent.split(", ")).toHaveLength(2);
        expect(root.one("weapon-guide-unfavored").textContent.split(", ")).toHaveLength(2);
      }
    }
    options[5]!.focus(); options[5]!.key("ArrowRight");
    expect(dom.doc.activeElement).toBe(options[0]);
    options[0]!.key("End"); expect(dom.doc.activeElement).toBe(options[5]);
    options[5]!.key("Home"); expect(dom.doc.activeElement).toBe(options[0]);
  });

  it("changes the worked example's champion without changing the chosen weapon", () => {
    const root = asEl(new WeaponsPanel().root); dom.ui.append(root);
    expect(root.one("weapon-guide-after").textContent).toContain("physical");
    expect(root.one("weapon-guide-after").textContent).toContain("magic");
    const picker = root.one("weapon-guide-champion");
    expect(picker.children).toHaveLength(FACTION_IDS.length);
    picker.value = "holy"; picker.dispatch("change");
    expect(root.one("weapon-guide-example").textContent).toContain("Demon Blood + Sword");
    expect(root.one("weapon-guide-after").textContent).not.toContain("magic");
    root.byClass("weapon-guide-option")[3]!.click();
    expect(root.one("weapon-guide-champion").value).toBe("holy");
    expect(root.one("weapon-guide-after").textContent).toContain("combined bonus armor/MR");
  });

  it("offers two distinct, explained pairings for each champion without picking one", () => {
    const pick = vi.fn(); const panel = new ChampionsPanel({ onPick: pick });
    const root = asEl(panel.root); dom.ui.append(root);
    for (const button of root.byClass("champion-option")) {
      button.click();
      expect(root.byClass("champion-build-example")).toHaveLength(2);
      expect(root.byClass("champion-build-stats")).toHaveLength(2);
      expect(root.byClass("champion-build-caution").every(node => node.textContent.length > 25)).toBe(true);
    }
    expect(pick).not.toHaveBeenCalled();
  });
});

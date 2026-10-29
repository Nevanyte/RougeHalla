import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileDTO } from "@raid/shared";
import { HubPanels } from "../src/ui/hub/hubPanels";
import { Menu } from "../src/ui/menu";
import { asEl, installPlanningDom, PEl, type PlanningDom } from "./planningDom";

// Counter-wheel SVG drawing is independently tested. Keep these tests focused on public-guide access and modal lifecycle.
vi.mock("../src/ui/hub/counterWheel", async () => {
  const { el } = await import("../src/ui/dom");
  return { CounterWheel: class { title = "Counters"; root = el("div"); setPick() {} render() {} } };
});
let dom: PlanningDom;
beforeEach(() => {
  dom = installPlanningDom();
  vi.stubGlobal("HTMLElement", PEl);
  vi.stubGlobal("location", { search: "" });
});
afterEach(() => vi.unstubAllGlobals());

describe("champion guide in the hub", () => {
  it("preserves account tabs after a profile is loaded and protects them again when it is cleared", () => {
    const hub = new HubPanels({ onProfile: vi.fn() });
    const profile: ProfileDTO = {
      name: "Astrid", gv: 100, gvLifetime: 200, gvByMonth: {}, stats: { runs: 0, wins: 0, draws: 0, deaths: 0, kills: 0 },
      cosmetics: { owned: [], equipped: {} }, achievements: {},
      progress: { qualifiedWins: 0, bountyRuns: 0, bestRunKills: 0, winsByFaction: {}, winsByWeapon: {} },
    };
    hub.setProfile(profile); hub.open("shop");
    expect(hub.isOpen).toBe(true);
    expect(dom.ui.byClass("hub-tab-btn").every(tab => !tab.disabled)).toBe(true);
    expect(dom.ui.one("hub-head-name").textContent).toBe("Astrid");
    hub.setProfile(null);
    expect(hub.isOpen).toBe(false);
    hub.open("shop"); expect(hub.isOpen).toBe(false);
    hub.open("champions"); expect(hub.isOpen).toBe(true);
    expect(dom.ui.byClass("hub-tab-btn").slice(2).every(tab => tab.disabled)).toBe(true);
    hub.close();
  });
  it("opens without a profile, keeps account-only tabs disabled, and clears held Shift on close", () => {
    const hub = new HubPanels({ onProfile: vi.fn(), onFactionPick: vi.fn() });
    hub.open("shop"); expect(hub.isOpen).toBe(false);
    hub.open("champions", { shiftKey: true });
    expect(hub.isOpen).toBe(true);
    expect(dom.ui.one("champions-panel").attrs.get("data-detail")).toBe("true");
    const tabs = dom.ui.byClass("hub-tab-btn");
    expect(tabs[0]!.textContent).toBe("Champions");
    expect(tabs[1]!.textContent).toBe("Weapon guide");
    expect(tabs[1]!.disabled).toBe(false);
    expect(tabs.slice(2).every(tab => tab.disabled)).toBe(true);
    tabs[0]!.key("ArrowRight");
    expect(tabs[1]!.attrs.get("aria-selected")).toBe("true");
    expect(dom.ui.one("champions-panel").attrs.get("data-detail")).toBe("false");
    expect(dom.ui.one("weapon-guide-name").textContent).toBe("Sword");
    hub.close(); expect(hub.isOpen).toBe(false);
    expect(dom.win.count()).toBe(0);
    hub.open("champions");
    expect(dom.ui.one("champions-panel").attrs.get("data-detail")).toBe("false");
    hub.close();
  });

  it("links from champion pairings into the public weapon guide without loading a profile", () => {
    const hub = new HubPanels({ onProfile: vi.fn() });
    hub.open("champions");
    dom.ui.one("champion-open-weapons").click();
    expect(dom.ui.byClass("hub-tab-btn")[1]!.attrs.get("aria-selected")).toBe("true");
    expect(dom.ui.one("weapon-guide-name").textContent).toBe("Sword");
    hub.close();
  });

  it("offers the guide before loading a callsign and applies an explicit champion choice to the real picker", () => {
    const menu = new Menu({ onStart: vi.fn(), onTraining: vi.fn() });
    menu.show();
    expect(menu.profile).toBeNull();
    dom.ui.one("menu-champion-guide").click();
    expect(menu.modalOpen).toBe(true);
    const root = dom.ui.one("champions-panel");
    root.byClass("champion-option")[2]!.click();
    root.one("champion-select").focus();
    root.one("champion-select").click();
    expect(menu.faction).toBe("plague");
    expect(root.one("champion-select").disabled).toBe(true);
    expect(dom.doc.activeElement).toBe(root.byClass("champion-option")[2]);
    menu.hide();
    expect(menu.modalOpen).toBe(false);
    expect(asEl(dom.ui).byClass("hub-backdrop")).toHaveLength(0);
  });
});

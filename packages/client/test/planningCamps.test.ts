// A camp's state on the map screens (ui/planning.ts, the lobby preview and the hold-Tab map): a cleared camp's marker is dimmed
// and crossed out (the `cleared` class, which planning.css draws), one somebody fought at wears a small muted ring (`disturbed`:
// the state is sticky history, so it says "Someone has fought here", never that a fight is on), both say so in the marker's own
// words, and a cleared camp has no matchup chip left. With no states the markers are what they were.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elitesOf, generateMap, isEliteCamp, mobStatReward, normalTypesOf, type GameMap } from "@raid/shared";
import { SettingsStore } from "../src/settings";
import { PlanningView, campTitle, type PlanningFrame } from "../src/ui/planning";
import { readCampStates } from "../src/ui/campInfo";
import { RouteState } from "../src/ui/route";
import { setView } from "../src/view/viewState";
import { computeLayout } from "../src/view/viewport";
import { asEl, installPlanningDom, type PEl } from "./planningDom";

const css = readFileSync(new URL("../src/ui/planning.css", import.meta.url), "utf8");

afterEach(() => { vi.unstubAllGlobals(); });
beforeEach(() => { setView(computeLayout({ cssW: 1280, cssH: 800, dpr: 1, hiDpi: true })); });

const MAP: GameMap = generateMap(7);

const frame = (over: Partial<PlanningFrame> = {}): PlanningFrame => ({
  mode: "map", serverNow: 0, endsAt: 0, meReady: false,
  players: [{ faction: "plague", ready: false, me: true }],
  campTypes: [], local: null, ...over,
});

function setup() {
  installPlanningDom();
  const store = new SettingsStore({ getItem: () => null, setItem: () => {} });
  const view = new PlanningView({ map: MAP, route: new RouteState(null, null), send: () => {}, settings: store });
  const camps = (): PEl[] => asEl(view.element).byClass("pl-camp");
  const states = (): string[] => camps().map((c) => (c.classList.contains("cleared") ? "cleared" : c.classList.contains("disturbed") ? "engaged" : "idle"));
  return { view, camps, states };
}

describe("camp states on the map screens", () => {
  it("shows each camp's public normal-mob stat reward and an elite chest badge only on the held full map", () => {
    const { view, camps } = setup();
    const normalTypes = MAP.camps.map((camp) => normalTypesOf(camp.zone)[0]!.id);
    const eliteTypes = MAP.camps.map((camp) => isEliteCamp(camp) ? elitesOf(camp.zone)[0]!.id : "");
    view.update(frame({ mode: "map", campTypes: normalTypes, campElites: eliteTypes }));
    camps().forEach((camp, i) => {
      const rewards = camp.byClass("pl-camp-reward");
      const stat = rewards.find((badge) => !badge.classList.contains("pl-camp-chest"));
      const chest = rewards.find((badge) => badge.classList.contains("pl-camp-chest"));
      const reward = mobStatReward(normalTypes[i]!);
      expect(stat, `camp ${i} normal reward`).toBeDefined();
      expect(stat!.byClass("combat-icon")).toHaveLength(1);
      expect(stat!.textContent).toContain(reward!.text.match(/^\+([^ ]+)/)?.[0]);
      expect(stat!.title).toContain(reward!.name);
      expect(Boolean(chest)).toBe(isEliteCamp(MAP.camps[i]!));
      if (chest) {
        expect(chest.textContent).toContain("Aug");
        expect(chest.title).toMatch(/augment chest.*no fixed stat/i);
      }
    });
    view.update(frame({ mode: "preview", campTypes: normalTypes, campElites: eliteTypes }));
    expect(camps().every((camp) => camp.one("pl-camp-rewards").hidden)).toBe(true);
    view.destroy();
  });

  it("marks a cleared camp and a disturbed one, and leaves the rest alone", () => {
    const { view, states } = setup();
    const n = MAP.camps.length;
    const campStates = Array.from({ length: n }, (_, i) => (i === 0 ? 2 : i === 1 ? 1 : 0));
    view.update(frame({ campStates }));
    const got = states();
    expect(got[0]).toBe("cleared");
    expect(got[1]).toBe("engaged");
    expect(got.slice(2).every((s) => s === "idle")).toBe(true);
  });

  it("follows the room: a camp cleared later is marked then, and nothing is rewritten for the same states", () => {
    const { view, camps, states } = setup();
    const n = MAP.camps.length;
    view.update(frame({ campStates: new Array(n).fill(0) }));
    expect(states().every((s) => s === "idle")).toBe(true);
    const next = new Array(n).fill(0);
    next[2] = 2;
    view.update(frame({ campStates: next }));
    expect(states()[2]).toBe("cleared");
    const label = camps()[2]!.getAttribute("aria-label");
    camps()[2]!.setAttribute("aria-label", "poked");
    view.update(frame({ campStates: [...next] }));
    expect(camps()[2]!.getAttribute("aria-label")).toBe("poked");
    expect(label).toContain("Cleared");
  });

  it("says it in the marker's own words, and drops the matchup for a camp that is gone", () => {
    const { view, camps } = setup();
    const n = MAP.camps.length;
    const campStates = new Array(n).fill(0);
    campStates[0] = 2;
    campStates[1] = 1;
    view.update(frame({ campStates }));
    const cleared = camps()[0]!.getAttribute("aria-label")!;
    expect(cleared).toContain(campTitle(MAP.camps[0]!));
    expect(cleared).toMatch(/\. Cleared$/); // not "its chest is gone": the chest is up for 15 s after the clear
    expect(cleared).not.toContain("chest");
    expect(cleared).not.toContain("For ");
    expect(camps()[0]!.byClass("pl-chip")[0]!.hidden).toBe(true);
    const engaged = camps()[1]!.getAttribute("aria-label")!;
    expect(engaged).toContain("Someone has fought here");
    expect(engaged, "the state is sticky history, never a live fight").not.toMatch(/is on|under way|in progress|fighting/i);
    expect(engaged).toContain("Elite camp: dangerous");
    expect(camps()[1]!.byClass("pl-chip")[0]!.hidden).toBe(false);
  });

  it("is the same markers without states (a server before the chests): none cleared, none engaged", () => {
    const { view, camps, states } = setup();
    view.update(frame());
    expect(states().every((s) => s === "idle")).toBe(true);
    for (const c of camps()) expect(c.getAttribute("aria-label")).not.toMatch(/Cleared|fought here/);
  });

  it("draws both in the stylesheet: dimmed and crossed for cleared, a small muted ring (not a flame) for a disturbed camp", () => {
    expect(css).toMatch(/\.pl-camp\.cleared\s*\{[^}]*opacity:\s*0\.\d+/);
    expect(css).toMatch(/\.pl-camp\.cleared::after\s*\{[^}]*linear-gradient/);
    const ring = /\.pl-camp\.disturbed::before\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(ring).toMatch(/border-radius:\s*50%/);
    expect(ring).toMatch(/opacity:\s*0\.\d+/);
    expect(ring).not.toMatch(/clip-path|#ff7043/);
    expect(css).not.toContain(".pl-camp.engaged");
    // The cross is a shape, not a colour: it is drawn in a light line over a dark one.
    expect(css).toMatch(/#eceff1/);
  });
});

describe("readCampStates", () => {
  it("reads each camp's state, 0 where the room has none or a value it does not know", () => {
    expect(readCampStates({}, 3)).toEqual([0, 0, 0]);
    expect(readCampStates(undefined, 2)).toEqual([0, 0]);
    expect(readCampStates(null, 1)).toEqual([0]);
    expect(readCampStates({ camps: [{ state: 2 }, { state: 1 }, { state: 0 }, { state: 7 }, { state: "2" }, {}] }, 7)).toEqual([2, 1, 0, 0, 0, 0, 0]);
    expect(readCampStates({ camps: { 0: { state: 2 }, length: 1 } }, 2)).toEqual([2, 0]);
    expect(readCampStates({}, 0)).toEqual([]);
  });
});

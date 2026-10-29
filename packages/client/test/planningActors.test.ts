import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateMap, type GameMap } from "@raid/shared";
import { SettingsStore } from "../src/settings";
import { PlanningView, type PlanningFrame } from "../src/ui/planning";
import { RouteState } from "../src/ui/route";
import { setView } from "../src/view/viewState";
import { computeLayout } from "../src/view/viewport";
import { asEl, installPlanningDom } from "./planningDom";

const css = readFileSync(new URL("../src/ui/planning.css", import.meta.url), "utf8");
const MAP: GameMap = generateMap(7);
const frame = (over: Partial<PlanningFrame> = {}): PlanningFrame => ({
  mode: "map", serverNow: 1000, endsAt: 0, meReady: false, players: [], campTypes: [], local: null,
  visionEnabled: true, canSee: () => true, ...over,
});

beforeEach(() => setView(computeLayout({ cssW: 1280, cssH: 800, dpr: 1, hiDpi: true })));
afterEach(() => vi.unstubAllGlobals());

describe("held map actor markers", () => {
  it("labels the local fighter and renders only remote coordinates accepted by personal vision", () => {
    installPlanningDom();
    const view = new PlanningView({ map: MAP, route: new RouteState(null, null), send: () => {}, settings: new SettingsStore({ getItem: () => null, setItem: () => {} }) });
    view.update(frame({
      local: { x: 1200, y: 900, alive: true },
      enemies: [{ id: "seen", x: 1500, y: 1000 }, { id: "hidden", x: 2200, y: 1000 }],
      canSee: ({ x }) => x < 2000,
    }));
    const root = asEl(view.element);
    const actors = root.byClass("pl-actor");
    expect(actors).toHaveLength(2);
    expect(root.byClass("pl-actor-you")[0]?.textContent).toBe("YOU");
    expect(root.byClass("pl-actor-enemy")[0]?.textContent).toBe("ENEMY");
    expect(root.one("pl-actors").getAttribute("aria-hidden")).toBe("true");

    view.update(frame({ local: { x: 1300, y: 950, alive: false }, enemies: [{ id: "seen", x: 1700, y: 1100 }], canSee: () => false }));
    expect(root.byClass("pl-actor")).toHaveLength(1);
    expect(root.byClass("pl-actor-you")[0]?.classList.contains("down")).toBe(true);
    view.update(frame({ mode: "preview", local: { x: 1300, y: 950, alive: true }, enemies: [{ id: "seen", x: 1700, y: 1100 }] }));
    expect(root.byClass("pl-actor")).toHaveLength(0);
    view.destroy();
  });

  it("keeps actor labels click-through above the camp and quest controls", () => {
    expect(css).toMatch(/\.pl-actors\s*\{[^}]*pointer-events:\s*none/s);
    expect(css).toMatch(/\.pl-actor\s*\{[^}]*pointer-events:\s*none/s);
    expect(css).toMatch(/\.pl-actor-you \.pl-actor-shape[^}]*background:\s*#38d9ff/s);
    expect(css).toMatch(/\.pl-actor-enemy \.pl-actor-shape[^}]*background:\s*#f04452/s);
  });
});

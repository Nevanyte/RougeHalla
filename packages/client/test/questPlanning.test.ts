import { afterEach, describe, expect, it, vi } from "vitest";
import { TILE_FLOOR, mapFromTiles } from "@raid/shared";
import { PlanningQuests } from "../src/ui/questPlanning";
import type { QuestStateLike } from "../src/ui/questModel";
import { asEl, installPlanningDom } from "./planningDom";

const state: QuestStateLike = {
  id: "q1", def: "banner-fire", x: 100, y: 200, status: "open", doneBy: "", expiresAt: 65_000,
  carrier: "", progress: new Map(),
};
const quests = { forEach(cb: (q: QuestStateLike, id: string) => void) { cb(state, state.id); } };

afterEach(() => vi.unstubAllGlobals());

describe("PlanningQuests", () => {
  it("shows known quest cards, their giver, timer and reward, a hidden count and a map mark", () => {
    const dom = installPlanningDom();
    const view = new PlanningQuests();
    dom.ui.append(asEl(view.element), asEl(view.markers));
    view.setMap(mapFromTiles(8, 8, new Uint8Array(64).fill(TILE_FLOOR)));
    view.update({ mode: "planning", serverNow: 5_000, localId: "me", quests, hiddenQuests: 5 });
    expect(view.element.hidden).toBe(false);
    expect(dom.ui.byClass("pl-quest-name")[0]?.textContent).toBe("The Ember Banner");
    expect(dom.ui.byClass("pl-quest-kind")[0]?.textContent).toBe("fetch");
    expect(dom.ui.byClass("pl-quest-giver")[0]?.textContent).toBe("Herald Kest");
    expect(dom.ui.byClass("pl-quest-time")[0]?.textContent).toBe("3:20");
    view.update({ mode: "planning", serverNow: 30_000, localId: "me", quests, hiddenQuests: 5 });
    expect(dom.ui.byClass("pl-quest-time")[0]?.textContent).toBe("3:20");
    expect(dom.ui.byClass("pl-quest-reward")[0]?.textContent).toContain("Cinder Hound");
    expect(dom.ui.byClass("pl-quest-hidden")[0]?.textContent).toContain("+5 rumoured");
    expect(dom.ui.byClass("pl-questmark")).toHaveLength(1);
  });

  it("stays hidden outside planning", () => {
    installPlanningDom();
    const view = new PlanningQuests();
    view.update({ mode: "preview", serverNow: 0, localId: "me", quests, hiddenQuests: 5 });
    expect(view.element.hidden).toBe(true);
    expect(view.markers.hidden).toBe(true);
  });
});

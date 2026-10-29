import { afterEach, describe, expect, it, vi } from "vitest";
import { QUEST_ITEM_PREFIX, TILE_FLOOR, mapFromTiles, questDefById } from "@raid/shared";
import { PlanningQuests } from "../src/ui/questPlanning";
import { questObjectiveMarkers, type QuestCollection, type QuestContainerCollection, type QuestContainerLike, type QuestStateLike } from "../src/ui/questModel";
import { asEl, installPlanningDom } from "./planningDom";

afterEach(() => vi.unstubAllGlobals());

const quest = (id: string, def: string, over: Partial<QuestStateLike> = {}): QuestStateLike => ({
  id, def, x: 100, y: 200, known: true, status: "open", doneBy: "", expiresAt: 90_000, carrier: "",
  progress: new Map(), accepted: new Map([["me", true]]), ...over,
});
const questSet = (...rows: QuestStateLike[]): QuestCollection => ({ forEach: (cb) => rows.forEach((row) => cb(row, row.id)) });
const item = (id: string, questId: string, x: number, y: number): QuestContainerLike => ({
  id, kind: "quest", x, y, label: questId, items: { length: 1, at: () => ({ def: QUEST_ITEM_PREFIX + questId }) },
});
const boxes = (...rows: QuestContainerLike[]): QuestContainerCollection => ({ forEach: (cb) => rows.forEach((row) => cb(row, row.id)) });

describe("accepted quest objective locations", () => {
  it("returns every remaining collect token only to its accepted player, and then only the turn-in", () => {
    const state = quest("collect1", "ashcap-fire", { progress: new Map([["me", 1]]) });
    const items = boxes(item("token1", state.id, 400, 500), item("token2", state.id, 700, 800), item("other", "unaccepted", 900, 1000));
    const markers = questObjectiveMarkers(questSet(state), items, "me", 1_000);
    expect(markers).toHaveLength(2);
    expect(markers.map((m) => [m.itemId, m.x, m.y, m.action, m.marker, m.step, m.total])).toEqual([
      ["token1", 400, 500, "pickup", "token", 2, 3], ["token2", 700, 800, "pickup", "token", 2, 3],
    ]);
    expect(questObjectiveMarkers(questSet(state), items, "stranger", 1_000)).toEqual([]);
    const ready = quest("collect1", "ashcap-fire", { x: 1234, y: 4321, progress: new Map([["me", 3]]) });
    expect(questObjectiveMarkers(questSet(ready), items, "me", 1_000)).toEqual([{
      questId: "collect1", itemId: "", name: questDefById("ashcap-fire")!.name, kind: "collect",
      action: "return", marker: "giver", x: 1234, y: 4321, step: 1, total: 1,
    }]);
  });

  it("locates a far fetch parcel after acceptance, then switches to return and suppresses stale or carried-away items", () => {
    const state = quest("fetch1", "long-haul");
    const parcel = item("parcel1", state.id, 5000, 7000);
    expect(questObjectiveMarkers(questSet(state), boxes(parcel), "me", 1_000)[0]).toMatchObject({
      questId: state.id, itemId: "parcel1", action: "pickup", marker: "parcel", x: 5000, y: 7000,
    });
    expect(questObjectiveMarkers(questSet(quest(state.id, state.def, { accepted: new Map() })), boxes(parcel), "me", 1_000)).toEqual([]);
    expect(questObjectiveMarkers(questSet(quest(state.id, state.def, { known: false })), boxes(parcel), "me", 1_000)).toEqual([]);
    expect(questObjectiveMarkers(questSet(quest(state.id, state.def, { status: "done" })), boxes(parcel), "me", 1_000)).toEqual([]);
    expect(questObjectiveMarkers(questSet(quest(state.id, state.def, { expiresAt: 999 })), boxes(parcel), "me", 1_000)).toEqual([]);
    expect(questObjectiveMarkers(questSet(quest(state.id, state.def, { carrier: "enemy" })), boxes(parcel), "me", 1_000)).toEqual([]);
    expect(questObjectiveMarkers(questSet(quest(state.id, state.def, { carrier: "me", x: 2345, y: 3456 })), boxes(), "me", 1_000)[0]).toMatchObject({
      action: "return", marker: "giver", x: 2345, y: 3456,
    });
  });

  it("shows FETCH/RETURN route stops on the held map and removes them outside map mode", () => {
    const dom = installPlanningDom();
    const map = mapFromTiles(8, 8, new Uint8Array(64).fill(TILE_FLOOR));
    const selected: Array<{ x: number; y: number }> = [];
    const view = new PlanningQuests((at) => selected.push(at));
    dom.ui.append(asEl(view.element), asEl(view.markers));
    view.setMap(map);
    const q = quest("fetch1", "long-haul");
    const objectives = questObjectiveMarkers(questSet(q), boxes(item("parcel1", q.id, 500, 600)), "me", 1_000);
    view.update({ mode: "map", serverNow: 1_000, localId: "me", quests: questSet(q), objectives });
    const marker = dom.ui.byClass("objective-item")[0]!;
    expect(marker.textContent).toBe("FETCH");
    expect(marker.getAttribute("aria-label")).toMatch(/fetch the parcel/i);
    marker.click();
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({ x: 500, y: 600, action: "pickup", marker: "parcel" });
    const returning = quest("fetch1", "long-haul", { carrier: "me", x: 700, y: 800 });
    view.update({ mode: "map", serverNow: 1_000, localId: "me", quests: questSet(returning), objectives: questObjectiveMarkers(questSet(returning), boxes(), "me", 1_000) });
    const returnMarker = dom.ui.byClass("objective-item")[0]!;
    expect(returnMarker.textContent).toBe("RETURN");
    returnMarker.click();
    expect(selected.at(-1)).toMatchObject({ x: 700, y: 800, action: "return" });
    view.update({ mode: "hidden", serverNow: 1_000, localId: "me", quests: questSet(q), objectives });
    expect(dom.ui.byClass("objective-item")).toHaveLength(0);
  });
});

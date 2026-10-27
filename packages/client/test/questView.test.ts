import { describe, expect, it } from "vitest";
import { EFFECT_HIDDEN } from "@raid/shared";
import { QuestView, type QuestViewFrame } from "../src/render/QuestView";
import type { QuestContainerLike, QuestStateLike } from "../src/ui/questModel";
import { fakeScene } from "./fakes";

function frame(over: Partial<QuestViewFrame> = {}): QuestViewFrame {
  const quest: QuestStateLike = {
    id: "q1", def: "banner-fire", x: 100, y: 200, status: "open", doneBy: "", expiresAt: 1000,
    carrier: "remote", progress: new Map(),
  };
  return {
    quests: { forEach(cb: (q: QuestStateLike, id: string) => void) { cb(quest, quest.id); } },
    containers: { forEach: () => {} },
    players: { get: () => ({ x: 700, y: 800, status: "alive", effects: EFFECT_HIDDEN }) },
    positions: new Map([["remote", { x: 700, y: 800 }]]), localId: "me", ...over,
  } as QuestViewFrame;
}

describe("QuestView", () => {
  it("draws the giver with an offer and keeps the parcel marker over a Swarm-hidden carrier", () => {
    const { scene, ofKind } = fakeScene();
    const view = new QuestView(scene);
    view.update(frame());
    const roots = ofKind("container");
    expect(roots).toHaveLength(2);
    const giverChildren = roots[0]!.args[2] as Array<{ state: Record<string, unknown> }>;
    expect(giverChildren[2]!.state.visible).toBe(true);
    expect(roots[1]!.state.position).toEqual([700, 640]);
    view.destroy();
  });

  it("shows the turn-in hint only for a finished local objective at the giver", () => {
    const { scene, ofKind } = fakeScene();
    const view = new QuestView(scene);
    view.update(frame({ localId: "remote", me: { x: 105, y: 200, status: "alive" } }));
    const roots = ofKind("container");
    const giverChildren = roots[0]!.args[2] as Array<{ state: Record<string, unknown> }>;
    expect(giverChildren[3]!.state.visible).toBe(true);
    view.update(frame({ localId: "remote", me: { x: 500, y: 200, status: "alive" } }));
    expect(giverChildren[3]!.state.visible).toBe(false);
    view.destroy();
  });

  it("takes a giver, its item and its carrier marker off the world the moment the offer closes", () => {
    const live: QuestStateLike = {
      id: "q1", def: "banner-fire", x: 100, y: 200, status: "open", doneBy: "", expiresAt: 1000, carrier: "remote", progress: new Map(),
    };
    const item: QuestContainerLike = { id: "item", kind: "quest", x: 300, y: 300, label: "Parcel", items: [{ def: "quest:q1" }] };
    const quests = (q: QuestStateLike) => ({ forEach(cb: (q: QuestStateLike, id: string) => void) { cb(q, q.id); } });
    const containers = { forEach(cb: (c: QuestContainerLike, id: string) => void) { cb(item, item.id); } };
    const at = { positions: new Map([["remote", { x: 700, y: 800 }]]), players: { get: () => undefined } };
    for (const status of ["done", "expired"]) {
      const { scene, ofKind } = fakeScene();
      const view = new QuestView(scene);
      view.update(frame({ quests: quests(live), containers, ...at }));
      const roots = ofKind("container");
      expect(roots, status).toHaveLength(3);
      expect(roots.some((r) => r.calls.some(([n]) => n === "destroy")), status).toBe(false);
      view.update(frame({ quests: quests({ ...live, status, doneBy: "Bravo" }), containers, ...at }));
      expect(roots.every((r) => r.calls.some(([n]) => n === "destroy")), status).toBe(true);
      view.destroy();
    }
  });

  it("does not draw closed givers, carriers or leftover quest items", () => {
    const { scene, ofKind } = fakeScene();
    const view = new QuestView(scene);
    const closed: QuestStateLike = {
      id: "q1", def: "banner-fire", x: 100, y: 200, status: "expired", doneBy: "", expiresAt: 1000,
      carrier: "remote", progress: new Map(),
    };
    view.update(frame({
      quests: { forEach(cb: (q: QuestStateLike, id: string) => void) { cb(closed, closed.id); } },
      containers: { forEach(cb: (c: QuestContainerLike, id: string) => void) { cb({ id: "item", kind: "quest", x: 100, y: 200, label: "Parcel", items: [{ def: "quest:q1" }] }, "item"); } },
    }));
    expect(ofKind("container")).toHaveLength(0);
    view.destroy();
  });
});

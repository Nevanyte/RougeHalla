import { describe, expect, it } from "vitest";
import { EFFECT_HIDDEN } from "@raid/shared";
import { QuestView, type QuestViewFrame } from "../src/render/QuestView";
import type { QuestStateLike } from "../src/ui/questModel";
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
});

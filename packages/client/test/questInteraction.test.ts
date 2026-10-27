import { describe, expect, it } from "vitest";
import { TILE_FLOOR, mapFromTiles } from "@raid/shared";
import type { ContainerState } from "@raid/shared/schema";
import { nearestContainer, type QuestPickupContext } from "../src/render/interact";
import type { QuestStateLike } from "../src/ui/questModel";

const map = mapFromTiles(8, 8, new Uint8Array(64).fill(TILE_FLOOR));
const box = (id: string, kind: string, def: string, x = 32): ContainerState => ({
  id, kind, x, y: 32, label: kind, items: [{ uid: id, def }],
} as unknown as ContainerState);
const boxes = (rows: ContainerState[]) => ({
  forEach(cb: (c: ContainerState, id: string) => void) { for (const c of rows) cb(c, c.id); },
});
const quest = (over: Partial<QuestStateLike> = {}): QuestStateLike => ({
  id: "q1", def: "banner-fire", x: 0, y: 0, status: "open", doneBy: "", expiresAt: 1000,
  carrier: "", progress: new Map(), ...over,
});
const context = (...rows: QuestStateLike[]): QuestPickupContext => ({
  quests: { forEach(cb: (q: QuestStateLike, id: string) => void) { for (const q of rows) cb(q, q.id); } },
  localId: "me",
});

describe("quest item interaction", () => {
  const item = box("q", "quest", "quest:q1");
  const weapon = box("w", "ground", "sword", 48);

  it("offers an eligible quest item to the normal F pickup path", () => {
    expect(nearestContainer(boxes([item]), map, { x: 32, y: 32 }, context(quest()))).toBe(item);
  });

  it("skips a token when local progress is complete so the nearby weapon remains pickup-able", () => {
    const full = quest({ def: "bloom-plague", progress: new Map([["me", 3]]) });
    expect(nearestContainer(boxes([item, weapon]), map, { x: 32, y: 32 }, context(full))).toBe(weapon);
  });

  it("skips a parcel while carrying one or when its quest is closed", () => {
    const other = quest({ id: "q2", def: "banner-holy", carrier: "me" });
    expect(nearestContainer(boxes([item, weapon]), map, { x: 32, y: 32 }, context(quest(), other))).toBe(weapon);
    expect(nearestContainer(boxes([item, weapon]), map, { x: 32, y: 32 }, context(quest({ status: "expired" })))).toBe(weapon);
  });

  it("falls to the weapon next to a quest item for every case the server refuses (sim/quests.ts onQuestPickup)", () => {
    const at = { x: 32, y: 32 };
    const refused: Array<[string, QuestPickupContext]> = [
      ["tokens already at the count", context(quest({ def: "bloom-plague", progress: new Map([["me", 3]]) }))],
      ["a parcel already in hand", context(quest({ id: "q2", def: "banner-holy", carrier: "me" }))],
      ["a closed offer (done)", context(quest({ status: "done", doneBy: "Bravo" }))],
      ["a closed offer (expired)", context(quest({ status: "expired" }))],
      ["an offer the client does not know", context()],
      ["a parcel somebody else carries", context(quest({ def: "banner-holy", carrier: "remote" }))],
    ];
    for (const [label, ctx] of refused) {
      expect(nearestContainer(boxes([item, weapon]), map, at, ctx), label).toBe(weapon);
    }
  });

  it("still takes the nearer of an eligible quest item and a weapon, the farther one next", () => {
    const at = { x: 32, y: 32 };
    const ctx = context(quest({ def: "bloom-plague", progress: new Map([["me", 2]]) }));
    expect(nearestContainer(boxes([item, weapon]), map, at, ctx)).toBe(item);
    expect(nearestContainer(boxes([item, box("w2", "ground", "bow", 36)]), map, { x: 40, y: 32 }, ctx)?.id).toBe("w2");
  });

  it("offers no quest item at all to a caller that knows no quests, and keeps the weapon", () => {
    expect(nearestContainer(boxes([item]), map, { x: 32, y: 32 })).toBeNull();
    expect(nearestContainer(boxes([item, weapon]), map, { x: 32, y: 32 })).toBe(weapon);
  });

  it("does not offer an empty quest container", () => {
    const empty = box("q", "quest", "quest:q1");
    (empty as unknown as { items: unknown[] }).items = [];
    expect(nearestContainer(boxes([empty]), map, { x: 32, y: 32 })).toBeNull();
  });
});

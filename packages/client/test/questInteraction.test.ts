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

  it("does not offer an empty quest container", () => {
    const empty = box("q", "quest", "quest:q1");
    (empty as unknown as { items: unknown[] }).items = [];
    expect(nearestContainer(boxes([empty]), map, { x: 32, y: 32 })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { QUEST_ACCEPT_RANGE, TILE_FLOOR, TILE_WALL, mapFromTiles } from "@raid/shared";
import type { ContainerState } from "@raid/shared/schema";
import { nearestContainer, nearestGiver, pickInteraction, type QuestPickupContext } from "../src/render/interact";
import type { QuestStateLike } from "../src/ui/questModel";

const map = mapFromTiles(8, 8, new Uint8Array(64).fill(TILE_FLOOR));
const box = (id: string, kind: string, def: string, x = 32): ContainerState => ({
  id, kind, x, y: 32, label: kind, items: [{ uid: id, def }],
} as unknown as ContainerState);
const boxes = (rows: ContainerState[]) => ({
  forEach(cb: (c: ContainerState, id: string) => void) { for (const c of rows) cb(c, c.id); },
});
// Accepted by the local player unless a test says otherwise: nothing of an offer is taken before it is accepted at the giver.
const quest = (over: Partial<QuestStateLike> = {}): QuestStateLike => ({
  id: "q1", def: "banner-fire", x: 0, y: 0, status: "open", doneBy: "", expiresAt: 1000,
  carrier: "", progress: new Map(), accepted: new Map([["me", true]]), ...over,
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
      ["an offer not accepted yet", context(quest({ accepted: new Map() }))],
      ["an offer only somebody else accepted", context(quest({ accepted: new Map([["remote", true]]) }))],
      ["an offer with no accepted set (a private preview)", context(quest({ accepted: undefined }))],
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

describe("F: a weapon or quest item against a quest giver", () => {
  const giverAt = (x: number, over: Partial<QuestStateLike> = {}): QuestStateLike => quest({ def: "cull-fire", x, y: 32, accepted: new Map(), ...over });
  const quests = (...rows: QuestStateLike[]) => ({ forEach(cb: (q: QuestStateLike, id: string) => void) { for (const q of rows) cb(q, q.id); } });
  const from = { x: 32, y: 32 };

  it("talks to a giver in reach when nothing else is", () => {
    const it = pickInteraction(boxes([]), quests(giverAt(64)), map, from);
    expect(it).toMatchObject({ kind: "talk", def: { giver: "Ashmother Vela" } });
    expect(pickInteraction(boxes([]), quests(), map, from)).toBeNull();
  });

  it("takes a weapon when it is nearer than the giver, and talks when the giver is nearer", () => {
    const weapon = box("w", "ground", "sword", 40);
    expect(pickInteraction(boxes([weapon]), quests(giverAt(64)), map, from)).toMatchObject({ kind: "pickup", container: weapon });
    expect(pickInteraction(boxes([box("w", "ground", "sword", 60)]), quests(giverAt(36)), map, from)).toMatchObject({ kind: "talk" });
  });

  it("keeps the pickup on a tie, so a weapon at a giver's feet is still taken", () => {
    const weapon = box("w", "ground", "sword", 48);
    expect(pickInteraction(boxes([weapon]), quests(giverAt(48)), map, from)).toMatchObject({ kind: "pickup", container: weapon });
  });

  it("prefers the nearer of an eligible quest item and a giver the same way", () => {
    const token = box("q", "quest", "quest:q1", 40);
    const ctx = context(quest({ def: "bloom-plague" }));
    expect(pickInteraction(boxes([token]), quests(giverAt(60, { id: "g" })), map, from, ctx)).toMatchObject({ kind: "pickup", container: token });
    expect(pickInteraction(boxes([token]), quests(giverAt(34, { id: "g" })), map, from, ctx)).toMatchObject({ kind: "talk" });
  });

  it("offers no giver that is out of reach, behind a wall, or closed", () => {
    expect(pickInteraction(boxes([]), quests(giverAt(32 + QUEST_ACCEPT_RANGE + 1)), map, from)).toBeNull();
    expect(pickInteraction(boxes([]), quests(giverAt(32 + QUEST_ACCEPT_RANGE)), map, from)).toMatchObject({ kind: "talk" });
    for (const status of ["done", "expired"]) expect(pickInteraction(boxes([]), quests(giverAt(40, { status })), map, from), status).toBeNull();
    const tiles = new Uint8Array(64).fill(TILE_FLOOR);
    for (let y = 0; y < 8; y++) tiles[y * 8 + 1] = TILE_WALL;
    const walled = mapFromTiles(8, 8, tiles);
    // The giver at tile (2, 1), the player at tile (0, 1) 56 u away: a wall column between them, and the same spot in the open.
    expect(nearestGiver(quests(giverAt(72)), walled, { x: 16, y: 32 })).toBeNull();
    expect(nearestGiver(quests(giverAt(72)), map, { x: 16, y: 32 })).not.toBeNull();
  });

  it("still talks to a giver whose offer is already accepted (the dialog shows the progress)", () => {
    expect(pickInteraction(boxes([]), quests(giverAt(40, { accepted: new Map([["me", true]]) })), map, from)).toMatchObject({ kind: "talk" });
  });

  it("takes the nearest of several givers", () => {
    const a = giverAt(70, { id: "a" });
    const b = giverAt(50, { id: "b", def: "cull-plague" });
    const it = pickInteraction(boxes([]), quests(a, b), map, from);
    expect(it).toMatchObject({ kind: "talk", quest: { id: "b" } });
  });
});

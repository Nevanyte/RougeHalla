import { describe, expect, it } from "vitest";
import { TILE_FLOOR, mapFromTiles } from "@raid/shared";
import type { ContainerState } from "@raid/shared/schema";
import { nearestContainer } from "../src/render/interact";

const map = mapFromTiles(8, 8, new Uint8Array(64).fill(TILE_FLOOR));
const box = (id: string, kind: string, def: string): ContainerState => ({
  id, kind, x: 32, y: 32, label: kind, items: [{ uid: id, def }],
} as unknown as ContainerState);

describe("quest item interaction", () => {
  it("offers a quest item to the normal F pickup path", () => {
    const quest = box("q", "quest", "quest:q1");
    const result = nearestContainer({ forEach: (cb: (c: ContainerState, id: string) => void) => { cb(box("w", "ground", "sword"), "w"); cb(quest, "q"); } }, map, { x: 32, y: 32 });
    expect(result).not.toBeNull();
    expect(nearestContainer({ forEach: (cb: (c: ContainerState, id: string) => void) => cb(quest, "q") }, map, { x: 32, y: 32 })).toBe(quest);
  });

  it("does not offer an empty quest container", () => {
    const empty = box("q", "quest", "quest:q1");
    (empty as unknown as { items: unknown[] }).items = [];
    expect(nearestContainer({ forEach: (cb: (c: ContainerState, id: string) => void) => cb(empty, "q") }, map, { x: 32, y: 32 })).toBeNull();
  });
});

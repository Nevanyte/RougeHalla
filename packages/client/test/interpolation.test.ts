// The interpolator's cuts (net/interpolation.ts): a teleport cuts everyone, a changed displaceSeq (a blink, a pull) cuts that
// one entity: held where it was until render time reaches the patch that moved it, then there, never drawn sliding across.
import { describe, expect, it } from "vitest";
import type { RaidState } from "@raid/shared/schema";
import { EntityInterpolator } from "../src/net/interpolation";

interface Ent { x: number; y: number; displaceSeq?: number }

function patch(t: number, players: Record<string, Ent>, mobs: Record<string, Ent> = {}): RaidState {
  return { serverTime: t, players: new Map(Object.entries(players)), mobs: new Map(Object.entries(mobs)) } as unknown as RaidState;
}

const at = (i: EntityInterpolator, id: string, t: number): { x: number; y: number } | null => {
  const out = { x: NaN, y: NaN };
  return i.sample(id, t, out) ? out : null;
};

describe("a changed displaceSeq", () => {
  it("cuts that entity and no other: it is held, then snaps, while a neighbour that merely walked is interpolated", () => {
    const i = new EntityInterpolator();
    i.onPatch(patch(1000, { a: { x: 0, y: 0, displaceSeq: 0 }, b: { x: 0, y: 0, displaceSeq: 0 } }), 0);
    // 100 u is short of a teleport (TELEPORT_DISTANCE 200), so only the counter tells it from a walk.
    i.onPatch(patch(1050, { a: { x: 100, y: 0, displaceSeq: 1 }, b: { x: 8, y: 0, displaceSeq: 0 } }), 50);
    expect(at(i, "a", 1025)).toEqual({ x: 0, y: 0 });
    expect(at(i, "b", 1025)).toEqual({ x: 4, y: 0 });
    expect(at(i, "a", 1049)).toEqual({ x: 0, y: 0 });
    expect(at(i, "a", 1050)).toEqual({ x: 100, y: 0 });
  });

  it("is the same for mobs", () => {
    const i = new EntityInterpolator();
    i.onPatch(patch(1000, {}, { m: { x: 0, y: 0, displaceSeq: 3 } }), 0);
    i.onPatch(patch(1050, {}, { m: { x: 60, y: 0, displaceSeq: 4 } }), 50);
    expect(at(i, "m", 1025)).toEqual({ x: 0, y: 0 });
    expect(at(i, "m", 1050)).toEqual({ x: 60, y: 0 });
  });

  it("an unchanged counter is a walk: interpolated", () => {
    const i = new EntityInterpolator();
    i.onPatch(patch(1000, { a: { x: 0, y: 0, displaceSeq: 5 } }), 0);
    i.onPatch(patch(1050, { a: { x: 8, y: 0, displaceSeq: 5 } }), 50);
    expect(at(i, "a", 1025)).toEqual({ x: 4, y: 0 });
  });

  it("wrapping from 255 to 0 is a change like any other", () => {
    const i = new EntityInterpolator();
    i.onPatch(patch(1000, { a: { x: 0, y: 0, displaceSeq: 255 } }), 0);
    i.onPatch(patch(1050, { a: { x: 30, y: 0, displaceSeq: 0 } }), 50);
    expect(at(i, "a", 1025)).toEqual({ x: 0, y: 0 });
    expect(at(i, "a", 1050)).toEqual({ x: 30, y: 0 });
  });

  it("a counter that is missing (an older state) never cuts", () => {
    const i = new EntityInterpolator();
    i.onPatch(patch(1000, { a: { x: 0, y: 0 } }), 0);
    i.onPatch(patch(1050, { a: { x: 8, y: 0 } }), 50);
    expect(at(i, "a", 1025)).toEqual({ x: 4, y: 0 });
  });

  it("an entity's first patch is no cut whatever its counter says, and one that leaves forgets it", () => {
    const i = new EntityInterpolator();
    i.onPatch(patch(1000, { a: { x: 0, y: 0, displaceSeq: 9 } }), 0);
    i.onPatch(patch(1050, { a: { x: 8, y: 0, displaceSeq: 9 } }), 50);
    expect(at(i, "a", 1025)).toEqual({ x: 4, y: 0 });
    i.onPatch(patch(1100, {}), 100);
    expect(at(i, "a", 1100)).toBeNull();
    // It comes back (a rejoin, a respawned mob id) with another counter: a first sighting again, not a displacement.
    i.onPatch(patch(1150, { a: { x: 0, y: 0, displaceSeq: 2 } }), 150);
    i.onPatch(patch(1200, { a: { x: 8, y: 0, displaceSeq: 2 } }), 200);
    expect(at(i, "a", 1175)).toEqual({ x: 4, y: 0 });
  });

  it("the teleport's cut still cuts everyone, and a displacement in the same patch changes nothing more", () => {
    const i = new EntityInterpolator();
    i.onPatch(patch(1000, { a: { x: 0, y: 0, displaceSeq: 0 }, b: { x: 0, y: 0, displaceSeq: 0 } }), 0);
    i.markCut(1050);
    i.onPatch(patch(1050, { a: { x: 8, y: 0, displaceSeq: 1 }, b: { x: 8, y: 0, displaceSeq: 0 } }), 50);
    for (const id of ["a", "b"]) {
      expect(at(i, id, 1025), id).toEqual({ x: 0, y: 0 });
      expect(at(i, id, 1050), id).toEqual({ x: 8, y: 0 });
    }
  });
});

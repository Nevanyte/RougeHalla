import { describe, expect, it } from "vitest";
import type { TimedFx } from "@raid/shared";
import { FxView, type FxHost } from "../src/render/FxView";

function setup() {
  const localHits: number[] = [];
  const host: FxHost = {
    localId: "me",
    view: () => undefined,
    position: () => undefined,
    name: () => undefined,
    projectileEnded: () => {},
    localHit: (fx) => localHits.push(fx.amount),
  };
  // Nothing here draws: a hit with no known position ends before it makes any Graphics or Text.
  const fx = new FxView({} as never, host);
  return { fx, localHits };
}

const hit = (id: string, amount: number, t: number): TimedFx => ({ kind: "hit", id, by: "foe", amount, weapon: "sword", t });

describe("FxView local hits", () => {
  it("reports a hit on the local player when render time reaches it, not when it arrives", () => {
    const { fx, localHits } = setup();
    fx.enqueue(hit("me", 80, 1000));
    fx.update(900, 0, true);
    expect(localHits).toEqual([]);
    fx.update(1000, 16, true);
    expect(localHits).toEqual([80]);
    fx.update(1100, 32, true);
    expect(localHits).toEqual([80]);
  });

  it("ignores hits on anyone else", () => {
    const { fx, localHits } = setup();
    fx.enqueue(hit("foe", 80, 1000));
    fx.update(1100, 0, true);
    expect(localHits).toEqual([]);
  });

  it("plays at once while the clock is unsynced", () => {
    const { fx, localHits } = setup();
    fx.enqueue(hit("me", 30, 5000));
    fx.update(0, 0, false);
    expect(localHits).toEqual([30]);
  });
});

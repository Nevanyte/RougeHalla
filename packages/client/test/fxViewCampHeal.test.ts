// The camp-clear heal's picture (FxView, balance contract 7): each healed player gets the rising "+N" a heal draws, and the camp
// gets one green ring on its centre per clear. Both play at render time like every fx; a practice camp (no centre on the map)
// and a fighter the scene does not draw get what they can.
import { describe, expect, it } from "vitest";
import type { TimedFx } from "@raid/shared";
import { FxView, type FxHost } from "../src/render/FxView";
import { projX, projY } from "../src/render/projection";
import { argsOf, fakeScene } from "./fakes";

const CENTRES: Record<number, { x: number; y: number }> = { 3: { x: 640, y: 480 } };

function rig(over: Partial<FxHost> = {}) {
  const { scene, made, ofKind } = fakeScene();
  const host: FxHost = {
    localId: "me", view: () => undefined, position: () => ({ x: 100, y: 100 }), name: () => undefined, projectileEnded: () => {},
    campCentre: (camp) => CENTRES[camp], ...over,
  };
  const fx = new FxView(scene, host);
  const play = (events: TimedFx[], t = 1000, now = 0): void => {
    for (const e of events) fx.enqueue({ ...e, t } as TimedFx);
    fx.update(t, now, true);
  };
  return { fx, made, ofKind, play };
}

const campHeal = (id: string, camp: number, amount: number): TimedFx => ({ kind: "campHeal", id, camp, amount, t: 0 });

describe("campHeal", () => {
  it("draws the rising +N over the healed player and one ring on the camp's centre, when render time reaches it", () => {
    const { fx, ofKind } = rig();
    fx.enqueue({ ...campHeal("me", 3, 118.46), t: 1000 });
    fx.update(900, 0, true);
    expect(ofKind("text")).toHaveLength(0);
    expect(ofKind("graphics")).toHaveLength(0);
    fx.update(1000, 16, true);
    expect(ofKind("text").map((t) => t.state.text)).toEqual(["+118"]);
    const rings = ofKind("graphics");
    expect(rings).toHaveLength(1);
    expect(argsOf(rings[0]!, "lineStyle")[0]![1]).toBe(0x81f78b);
    expect(argsOf(rings[0]!, "setPosition").at(-1)).toEqual([projX(640), projY(480)]);
  });

  it("rings a clear once however many players it healed, and a second clear again", () => {
    const { play, ofKind } = rig();
    play([campHeal("me", 3, 50), campHeal("foe", 3, 20), campHeal("ally", 3, 9)]);
    expect(ofKind("text").map((t) => t.state.text)).toEqual(["+50", "+20", "+9"]);
    expect(ofKind("graphics")).toHaveLength(1);
    play([campHeal("me", 3, 40)], 2500, 1500); // a later clear of the same camp id (not a thing in a run, but the dedupe is a window)
    expect(ofKind("graphics")).toHaveLength(2);
  });

  it("a practice camp has no centre on the map: the number, no ring", () => {
    const { play, ofKind } = rig();
    play([campHeal("me", 104, 60)]);
    expect(ofKind("text").map((t) => t.state.text)).toEqual(["+60"]);
    expect(ofKind("graphics")).toHaveLength(0);
  });

  it("a host with no way to place a camp, or one that says nothing finite, draws only the number", () => {
    const bare = rig({ campCentre: undefined });
    bare.play([campHeal("me", 3, 30)]);
    expect(bare.ofKind("graphics")).toHaveLength(0);
    expect(bare.ofKind("text")).toHaveLength(1);
    const odd = rig({ campCentre: () => ({ x: Number.NaN, y: 0 }) });
    odd.play([campHeal("me", 3, 30)]);
    expect(odd.ofKind("graphics")).toHaveLength(0);
  });

  it("a fighter the scene does not draw (hidden) gets no number, but the camp still rings; a heal under 1 draws no number", () => {
    const hidden = rig({ position: () => undefined });
    hidden.play([campHeal("foe", 3, 30)]);
    expect(hidden.ofKind("text")).toHaveLength(0);
    expect(hidden.ofKind("graphics")).toHaveLength(1);
    const tiny = rig();
    tiny.play([campHeal("me", 3, 0.4)]);
    expect(tiny.ofKind("text")).toHaveLength(0);
  });

  it("the ring fades out and its Graphics goes back to the pool", () => {
    const { fx, ofKind } = rig();
    fx.enqueue({ ...campHeal("me", 3, 50), t: 1000 });
    fx.update(1000, 0, true);
    const ring = ofKind("graphics")[0]!;
    fx.update(1100, 450, true);
    expect(ring.state.visible).toBe(true);
    expect(Number(ring.state.alpha)).toBeLessThan(0.95);
    fx.update(1200, 2000, true);
    expect(ring.state.visible).toBe(false);
  });
});

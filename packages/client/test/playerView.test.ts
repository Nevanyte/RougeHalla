// PlayerView's kill barrier (Phase 11): a pale-blue segment on the hp bar and a bubble round the body, both drawn from the
// public state. The scene is fake (test/fakes.ts); the parts are found by their place in the container the view builds.
import { describe, expect, it } from "vitest";
import { MAX_BARRIER_SHARE } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { PlayerView } from "../src/render/PlayerView";
import { BARRIER_COLOR } from "../src/ui/buffTheme";
import { argsOf, fakeScene, type FakeObject } from "./fakes";

/** Matches `scene.add.container(0, 0, [...])` in PlayerView's constructor. */
const CHILD = { barrierRing: 6, hpBar: 12 } as const;
const MAX_HP = 1000;

function player(over: Partial<Record<keyof PlayerState, unknown>> = {}): PlayerState {
  return {
    name: "Ann", look: 0, x: 0, y: 0, facing: 0, hp: MAX_HP, maxHp: MAX_HP, barrier: 0, status: "alive", faction: "fire", weapon0: "sword",
    weapon1: "", slot: 0, drawStartedAt: 0, readyAt: 0, sig: 0, brand: 0, bounty: 0, immuneUntil: 0, stacksAs: 0, ...over,
  } as unknown as PlayerState;
}

function setup() {
  const { scene, ofKind } = fakeScene();
  const view = new PlayerView(scene, false);
  const root = ofKind("container")[0]!;
  const kids = root.args[2] as FakeObject[];
  const ring = kids[CHILD.barrierRing]!;
  const bar = kids[CHILD.hpBar]!;
  return { view, root, ring, bar, frame: (p: PlayerState, drawAsAlive = false) => view.update(0, 0, p, 1000, 1000, drawAsAlive) };
}

/** The line width and alpha of the bubble's outline: both grow with the barrier. */
const outline = (ring: FakeObject) => argsOf(ring, "lineStyle")[0]!;

describe("PlayerView kill barrier", () => {
  it("draws nothing without a barrier", () => {
    const { ring, frame } = setup();
    frame(player());
    expect(ring.calls).toEqual([]);
    expect(ring.clears).toBe(0);
  });

  it("draws a bubble that grows with the barrier, up to the biggest combo shield, and clears it when the barrier is gone", () => {
    const { ring, frame } = setup();
    const full = MAX_HP * MAX_BARRIER_SHARE;
    frame(player({ barrier: full / 8 }));
    expect(argsOf(ring, "fillCircle")).toHaveLength(1);
    expect(argsOf(ring, "strokeCircle")).toHaveLength(1);
    expect(outline(ring)[1]).toBe(BARRIER_COLOR);
    const small = outline(ring)[0] as number;
    frame(player({ barrier: full }));
    const big = outline(ring)[0] as number;
    expect(big).toBeGreaterThan(small);
    frame(player({ barrier: full * 5 }));
    expect(outline(ring)[0]).toBe(big); // the bubble is capped at the biggest shield any combo gives
    frame(player());
    expect(ring.calls).toEqual([]);
  });

  it("repaints only when the bubble moves a whole step", () => {
    const { ring, frame } = setup();
    const full = MAX_HP * MAX_BARRIER_SHARE;
    frame(player({ barrier: full * 0.5 }));
    const clears = ring.clears;
    frame(player({ barrier: full * 0.51 })); // the same eighth
    expect(ring.clears).toBe(clears);
    frame(player({ barrier: full * 0.7 }));
    expect(ring.clears).toBe(clears + 1);
  });

  it("adds the barrier to the hp bar after the hp, in its own colour", () => {
    const { bar, frame } = setup();
    frame(player({ hp: 500, barrier: 150 }));
    const fills = argsOf(bar, "fillStyle").map((a) => a[0]);
    expect(fills).toContain(BARRIER_COLOR);
    const rects = argsOf(bar, "fillRect");
    expect(rects).toHaveLength(3); // backing, hp, barrier
    expect(rects[2]![0]).toBeGreaterThan(rects[1]![0] as number);
  });

  it("is hidden with the rest of the view for a player who is down", () => {
    const { root, frame } = setup();
    frame(player({ status: "dead", barrier: 100 }));
    expect(root.state.visible).toBe(false);
    frame(player({ status: "dead", barrier: 100 }), true); // a death still ahead of render time
    expect(root.state.visible).toBe(true);
  });
});

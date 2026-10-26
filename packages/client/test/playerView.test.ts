// PlayerView's barrier (Phase 11, R4a): a pale-blue segment on the hp bar and a bubble round the body, both drawn from the
// public state, against BARRIER_FULL_SHARE of max hp. The bow's draw follows the attack-speed and windup mirrors. The scene is fake (test/fakes.ts); the parts are found by their place in the container the view builds.
import { describe, expect, it } from "vitest";
import { BARRIER_FULL_SHARE, WIRE_IDENTITY_MIRRORS, encodeMult } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { PlayerView } from "../src/render/PlayerView";
import { screenAngle } from "../src/render/projection";
import { BARRIER_COLOR } from "../src/ui/buffTheme";
import { argsOf, fakeScene, type FakeObject } from "./fakes";

/** Matches `scene.add.container(0, 0, [...])` in PlayerView's constructor. */
const CHILD = { barrierRing: 6, hpBar: 12 } as const;
const MAX_HP = 1000;

function player(over: Partial<Record<keyof PlayerState, unknown>> = {}): PlayerState {
  return {
    name: "Ann", look: 0, x: 0, y: 0, facing: 0, hp: MAX_HP, maxHp: MAX_HP, barrier: 0, status: "alive", faction: "fire", weapon0: "sword",
    weapon1: "", slot: 0, drawStartedAt: 0, readyAt: 0, sig: 0, brand: 0, bounty: 0, immuneUntil: 0, ...WIRE_IDENTITY_MIRRORS, ...over,
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

describe("PlayerView barrier", () => {
  it("draws nothing without a barrier", () => {
    const { ring, frame } = setup();
    frame(player());
    expect(ring.calls).toEqual([]);
    expect(ring.clears).toBe(0);
  });

  it("draws a bubble that grows with the barrier, up to BARRIER_FULL_SHARE of max hp, and clears it when the barrier is gone", () => {
    const { ring, frame } = setup();
    const full = MAX_HP * BARRIER_FULL_SHARE;
    frame(player({ barrier: full / 8 }));
    expect(argsOf(ring, "fillCircle")).toHaveLength(1);
    expect(argsOf(ring, "strokeCircle")).toHaveLength(1);
    expect(outline(ring)[1]).toBe(BARRIER_COLOR);
    const small = outline(ring)[0] as number;
    frame(player({ barrier: full }));
    const big = outline(ring)[0] as number;
    expect(big).toBeGreaterThan(small);
    frame(player({ barrier: full * 5 }));
    expect(outline(ring)[0]).toBe(big); // the bubble is capped at a full barrier
    frame(player());
    expect(ring.calls).toEqual([]);
  });

  it("repaints only when the bubble moves a whole step", () => {
    const { ring, frame } = setup();
    const full = MAX_HP * BARRIER_FULL_SHARE;
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

describe("PlayerView predicted facing", () => {
  /** Matches the container's children: the nose after the body and its core, the weapon in hand after it. */
  const NOSE = 8;
  const HELD = 9;

  it("turns the nose to the facing it is given, and back to the synced one when it gets none", () => {
    const { root, view } = setup();
    const nose = (root.args[2] as FakeObject[])[NOSE]!;
    const bare = (facing: number) => player({ weapon0: "", facing });
    view.update(0, 0, bare(0.5), 1000, 1000);
    expect(nose.state.rotation).toBeCloseTo(screenAngle(0.5), 9);
    view.update(0, 0, bare(0.5), 1000, 1000, false, false, -2);
    expect(nose.state.rotation).toBeCloseTo(screenAngle(-2), 9);
    view.update(0, 0, bare(0.5), 1000, 1000, false, false, null);
    expect(nose.state.rotation).toBeCloseTo(screenAngle(0.5), 9);
  });

  it("turns the weapon in hand with it and leaves the synced state alone", () => {
    const { root, view } = setup();
    const held = (root.args[2] as FakeObject[])[HELD]!;
    const p = player({ weapon0: "sword", facing: 1 });
    view.update(0, 0, p, 1000, 1000);
    const synced = held.state.rotation as number;
    view.update(0, 0, p, 1000, 1000, false, false, -1.2);
    expect(held.state.rotation).not.toBeCloseTo(synced, 3);
    expect(Math.abs((held.state.rotation as number) - screenAngle(-1.2))).toBeLessThan(0.5); // the juice pose adds a little of its own
    expect(p.facing).toBe(1);
    expect(p.weapon0).toBe("sword");
    view.update(0, 0, p, 1000, 1000);
    expect(held.state.rotation).toBeCloseTo(synced, 9);
  });
});

describe("PlayerView bow draw", () => {
  const HELD = 9;
  // 0.45 s into a Sentenced bow's draw: 86% of the unbuffed 0.524 s, a full draw (the glow) at attack-speed mirror x1.25 (0.419 s)
  // or windup mirror x0.85 (0.446 s). The mirrors are the wire form (thousandths), as the state carries them.
  const glows = (over: Partial<Record<keyof PlayerState, unknown>>, facing: number | null): boolean => {
    const { root, view } = setup();
    const held = (root.args[2] as FakeObject[])[HELD]!;
    view.update(0, 0, player({ faction: "sentenced", weapon0: "bow", drawStartedAt: 1000, ...over }), 1450, 1450, false, false, facing);
    return held.calls.some(([name]) => name === "strokeCircle");
  };

  it("draws to the attack-speed and windup mirrors, with the synced facing and with a predicted one", () => {
    for (const facing of [null, -0.4]) {
      expect(glows({}, facing), `identity, facing ${facing}`).toBe(false);
      expect(glows({ asMult: 1000 }, facing), `explicit identity, facing ${facing}`).toBe(false);
      expect(glows({ asMult: encodeMult(1.25) }, facing), `attack speed x1.25, facing ${facing}`).toBe(true);
      expect(glows({ windupMult: encodeMult(0.85) }, facing), `windup x0.85, facing ${facing}`).toBe(true);
      expect(glows({ windupMult: encodeMult(1.2) }, facing), `windup x1.2, facing ${facing}`).toBe(false);
    }
  });

  it("reads nothing but the mirrors: the buffs map does not shorten the pull", () => {
    // A held buff reaches the draw only through the mirror the server folds it into (an unfolded buff changes nothing here).
    expect(glows({ buffs: new Map([["plagueRat", 6]]) }, null)).toBe(false);
  });

  it("an older server with no mirror fields leaves them undefined: the unbuffed draw", () => {
    expect(glows({ asMult: undefined, windupMult: undefined }, null)).toBe(false);
  });
});

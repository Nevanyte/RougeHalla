// FighterArt's juice (render/FighterArt.ts): the weapon's pose turn, the wand's cast charge and the bow's tension glow.
// The weapon in hand is an Image of a baked drawing, so what it draws is read from the bake its texture names.
import { describe, expect, it } from "vitest";
import { FACTIONS, mirrorTimings } from "@raid/shared";
import { FighterArt, type FighterFields } from "../src/render/FighterArt";
import { argsOf, fakeScene } from "./fakes";

const SENTENCED_DRAW_SECONDS = mirrorTimings(FACTIONS.sentenced, "bow", 1, 1).windup;
const SENTENCED_DRAW_MS = Math.ceil(SENTENCED_DRAW_SECONDS * 1000);
const HALF_DRAW_MS = Math.round(SENTENCED_DRAW_SECONDS * 500);
const TENSION_DRAW_MS = Math.ceil(SENTENCED_DRAW_MS * 0.75);

const fighter = (over: Partial<FighterFields> = {}): FighterFields => ({
  facing: 0, faction: "sentenced", weapon0: "wand", weapon1: "", slot: 0, drawStartedAt: 0, ...over,
});

function setup() {
  const { scene, ofKind, baked } = fakeScene();
  const art = new FighterArt(scene);
  const [ground, held] = ofKind("image");
  /** The draw calls of the bake the weapon shows now. */
  const drawn = () => ({ calls: baked.get(String(held!.state.texture))?.calls ?? [] });
  /** How many times the weapon swapped to another bake. */
  const swaps = () => held!.calls.filter(([n]) => n === "setTexture").length;
  return { art, ground: ground!, held: held!, drawn, swaps };
}

describe("the weapon's pose turn", () => {
  it("is added to the facing", () => {
    const { art, held } = setup();
    art.update(fighter({ facing: 0 }), 1000, 1000);
    expect(held.state.rotation).toBe(0);
    art.poseRot = -0.75;
    art.update(fighter({ facing: 0 }), 1016, 1016);
    expect(held.state.rotation).toBeCloseTo(-0.75, 9);
  });
});

describe("the wand's charge", () => {
  it("swells the orb and adds a bright core as it grows, swapping the bake in steps", () => {
    const { art, drawn, swaps } = setup();
    art.update(fighter(), 1000, 1000);
    const plain = argsOf(drawn(), "fillCircle").length;
    const before = swaps();
    art.setCharge(0.5);
    art.update(fighter(), 1016, 1016);
    expect(swaps()).toBe(before + 1);
    const half = argsOf(drawn(), "fillCircle");
    expect(half.length).toBe(plain + 2);
    // The outer glow (the one with the biggest radius) grows with the charge.
    const big = (calls: unknown[][]) => Math.max(...calls.map((c) => c[2] as number));
    art.setCharge(1);
    art.update(fighter(), 1032, 1032);
    expect(big(argsOf(drawn(), "fillCircle"))).toBeGreaterThan(big(half));
    // Still the same step: the same bake stays.
    const n = swaps();
    art.setCharge(1.0001);
    art.update(fighter(), 1048, 1048);
    expect(swaps()).toBe(n);
  });

  it("goes with the cast: back to the plain orb at 0", () => {
    const { art, drawn } = setup();
    art.setCharge(1);
    art.update(fighter(), 1000, 1000);
    art.setCharge(0);
    art.update(fighter(), 1016, 1016);
    expect(argsOf(drawn(), "fillCircle")).toHaveLength(3);
  });

  it("means nothing to other weapons", () => {
    const { art, swaps } = setup();
    art.update(fighter({ weapon0: "sword" }), 1000, 1000);
    const before = swaps();
    art.setCharge(1);
    art.update(fighter({ weapon0: "sword" }), 1016, 1016);
    expect(swaps()).toBe(before);
  });

  it("clamps what it is given", () => {
    const { art, held } = setup();
    art.setCharge(7);
    art.update(fighter(), 1000, 1000);
    const a = held.state.texture;
    art.setCharge(1);
    art.update(fighter(), 1016, 1016);
    expect(held.state.texture).toBe(a);
  });
});

describe("the bow's tension", () => {
  const bow = (drawStartedAt: number) => fighter({ weapon0: "bow", drawStartedAt });
  // Sentenced's draw duration comes from the same shared mirrorTimings helper as the server.

  it("tells the figure how far the string is back", () => {
    const { art } = setup();
    art.update(bow(0), 1000, 1000);
    expect(art.pull).toBe(-1);
    art.update(bow(1000), 1000 + HALF_DRAW_MS, 1000 + HALF_DRAW_MS);
    expect(art.pull).toBeCloseTo(0.5, 2);
    art.update(bow(1000), 1600, 1600);
    expect(art.pull).toBe(1);
  });

  it("warms the arrowhead on the way to a full draw with a glow and no ring (the ring is the ready cue)", () => {
    const { art, drawn } = setup();
    art.update(bow(1000), 1000 + HALF_DRAW_MS, 1000 + HALF_DRAW_MS); // 50%: below the tension threshold
    const early = argsOf(drawn(), "fillCircle").length;
    expect(argsOf(drawn(), "strokeCircle")).toEqual([]);
    art.update(bow(1000), 1000 + TENSION_DRAW_MS, 1000 + TENSION_DRAW_MS); // 75%: tension glow, no ready ring
    expect(argsOf(drawn(), "fillCircle").length).toBe(early + 1);
    expect(argsOf(drawn(), "strokeCircle")).toEqual([]);
    art.update(bow(1000), 1000 + SENTENCED_DRAW_MS, 1000 + SENTENCED_DRAW_MS); // first millisecond at or past the shared full-draw duration
    expect(argsOf(drawn(), "strokeCircle")).toHaveLength(1);
  });

  it("shows the ready ring only at a full draw, not from rounding 99% up to the last step", () => {
    const { art, drawn } = setup();
    art.update(bow(1000), 1000 + SENTENCED_DRAW_MS - 1, 1000 + SENTENCED_DRAW_MS - 1); // one millisecond before the server's full draw
    expect(art.pull).toBeGreaterThan(0.99);
    expect(art.pull).toBeLessThan(1);
    expect(argsOf(drawn(), "strokeCircle")).toEqual([]);
    art.update(bow(1000), 1000 + SENTENCED_DRAW_MS, 1000 + SENTENCED_DRAW_MS);
    expect(art.pull).toBe(1);
    expect(argsOf(drawn(), "strokeCircle")).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import { FighterArt, heldWeapon, type FighterFields } from "../src/render/FighterArt";

/** A stand-in for Phaser's Graphics that records the draw calls made since its last clear(). */
function fakeGraphics() {
  const calls: string[] = [];
  const g: Record<string, unknown> = new Proxy({ calls }, {
    get(target, prop: string) {
      if (prop === "calls") return target.calls;
      return (..._args: unknown[]) => {
        if (prop === "clear") calls.length = 0;
        else calls.push(prop);
        return g;
      };
    },
  });
  return g as { calls: string[] } & Record<string, unknown>;
}

function setup() {
  const graphics = [fakeGraphics(), fakeGraphics()];
  let i = 0;
  const scene = { add: { graphics: () => graphics[i++] } };
  const art = new FighterArt(scene as any);
  /** The bow shows a nocked arrow (a lineBetween from the nock to the arrowhead) only while a draw is on screen. */
  const drawing = () => graphics[1]!.calls.includes("lineBetween");
  return { art, drawing };
}

const bowman = (drawStartedAt: number): FighterFields => ({
  facing: 0, faction: "sentenced", weapon0: "bow", weapon1: "", slot: 0, drawStartedAt,
});

describe("heldWeapon", () => {
  it("reads the slot in hand and ignores unknown ids", () => {
    expect(heldWeapon({ weapon0: "bow", weapon1: "axe", slot: 1 })).toBe("axe");
    expect(heldWeapon({ weapon0: "bow", weapon1: "", slot: 1 })).toBeNull();
    expect(heldWeapon({ weapon0: "spear", weapon1: "", slot: 0 })).toBeNull();
  });
});

describe("bow draw display", () => {
  it("shows the draw once render time reaches its start, not before", () => {
    const { art, drawing } = setup();
    art.update(bowman(1000), 900, 1050);
    expect(drawing()).toBe(false);
    art.update(bowman(1000), 1010, 1050);
    expect(drawing()).toBe(true);
  });

  it("keeps showing it when a chill pushes the start a few ms past render time", () => {
    const { art, drawing } = setup();
    art.update(bowman(1000), 1100, 1200);
    expect(drawing()).toBe(true);
    // The start moves 30 ms later at each patch; render time is only 10 ms past the old one.
    art.update(bowman(1090), 1100, 1250);
    expect(drawing()).toBe(true);
    art.update(bowman(1120), 1105, 1300);
    expect(drawing()).toBe(true);
  });

  it("treats a start far ahead (a stagger restart) as a new draw that waits for render time", () => {
    const { art, drawing } = setup();
    art.update(bowman(1000), 1100, 1200);
    expect(drawing()).toBe(true);
    art.update(bowman(1500), 1300, 1600);
    expect(drawing()).toBe(false);
    art.update(bowman(1500), 1520, 1600);
    expect(drawing()).toBe(true);
  });

  it("keeps the pull until render time reaches the moment the draw stopped, then drops it", () => {
    const { art, drawing } = setup();
    art.update(bowman(1000), 1100, 1200);
    art.update(bowman(0), 1150, 1250); // loosed at patch 1250
    expect(drawing()).toBe(true);
    art.update(bowman(0), 1260, 1300);
    expect(drawing()).toBe(false);
  });
});

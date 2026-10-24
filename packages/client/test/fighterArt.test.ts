import { describe, expect, it } from "vitest";
import { DrawTrack, FighterArt, heldWeapon, type FighterFields } from "../src/render/FighterArt";

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

describe("bow draw start under a chill", () => {
  // A chill pushes the start 30 ms later at every 50 ms tick; the patch at 1000 + 50k carries start 1000 + 30k.
  const patchT = (k: number) => 1000 + 50 * k;
  const startAt = (k: number) => 1000 + 30 * k;

  it("uses the start the server had at render time, not the newest one", () => {
    const t = new DrawTrack();
    for (let k = 0; k <= 30; k++) {
      // Render time trails the newest patch by 100 ms; three frames before the next patch arrives.
      for (const dt of [0, 16, 33]) {
        const renderT = patchT(k) - 100 + dt;
        const drawing = t.track(startAt(k), renderT, patchT(k));
        const j = Math.min(k, Math.max(0, Math.floor((renderT - 1000) / 50)));
        expect(t.start).toBe(startAt(j));
        expect(drawing).toBe(renderT >= startAt(j));
        // The old behaviour (the newest start) would understate the pull by 30 ms per tick of delay.
        if (k >= 3) expect(t.start).toBeLessThan(startAt(k));
      }
    }
  });

  it("an unchilled draw keeps its one start", () => {
    const t = new DrawTrack();
    for (let k = 0; k < 10; k++) {
      t.track(1000, patchT(k) - 100, patchT(k));
      expect(t.start).toBe(1000);
    }
  });

  it("a restart far ahead drops the old starts and waits for render time", () => {
    const t = new DrawTrack();
    for (let k = 0; k < 6; k++) t.track(startAt(k), patchT(k) - 100, patchT(k));
    expect(t.track(2000, 1400, 1500)).toBe(false);
    expect(t.start).toBe(2000);
    expect(t.track(2000, 2010, 2100)).toBe(true);
  });

  it("keeps the pull until render time reaches the end, then clears", () => {
    const t = new DrawTrack();
    t.track(1000, 1100, 1200);
    expect(t.track(0, 1150, 1250)).toBe(true);
    expect(t.track(0, 1260, 1300)).toBe(false);
    expect(t.start).toBe(0);
  });
});

// What the status bits look like (render/StatusArt.ts): one layer per bit, drawn in order, redrawn only while a bit is set, and
// held still (not blank) under reduced motion. The Graphics is fake (test/fakes.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EFFECT_ANTI_HEAL, EFFECT_ATTACK_SLOWED, EFFECT_CASTING, EFFECT_DOT, EFFECT_HASTE, EFFECT_HIDDEN, EFFECT_LAST_STAND, EFFECT_ROOTED,
  EFFECT_SILENCED, EFFECT_SLOWED, EFFECT_STUNNED, EFFECT_UNTARGETABLE, EFFECT_ZONED,
} from "@raid/shared";
import { resetReducedMotionCache } from "../src/render/juice";
import { StatusArt, statusLayers, type StatusLayerId } from "../src/render/StatusArt";
import { fakeScene } from "./fakes";

afterEach(() => {
  vi.unstubAllGlobals();
  resetReducedMotionCache();
});

const BITS: ReadonlyArray<readonly [number, StatusLayerId]> = [
  [EFFECT_STUNNED, "stun"], [EFFECT_ROOTED, "root"], [EFFECT_SILENCED, "silence"], [EFFECT_SLOWED, "slow"],
  [EFFECT_ATTACK_SLOWED, "attackSlow"], [EFFECT_ANTI_HEAL, "antiHeal"], [EFFECT_DOT, "dot"], [EFFECT_UNTARGETABLE, "untargetable"],
  [EFFECT_ZONED, "zoned"], [EFFECT_LAST_STAND, "lastStand"], [EFFECT_HASTE, "haste"], [EFFECT_CASTING, "casting"],
];

describe("statusLayers", () => {
  it("is empty for no effects", () => {
    expect(statusLayers(0)).toEqual([]);
  });

  it("gives exactly one layer for each bit, and names the bit", () => {
    for (const [bit, id] of BITS) {
      const layers = statusLayers(bit);
      expect(layers).toHaveLength(1);
      expect(layers[0]!.id).toBe(id);
      expect(layers[0]!.bit).toBe(bit);
    }
  });

  it("has a layer for every bit but hidden and the spare ones", () => {
    expect(statusLayers(EFFECT_HIDDEN)).toEqual([]);
    expect(statusLayers(8192 | 16384 | 32768)).toEqual([]);
    const all = BITS.reduce((m, [bit]) => m | bit, 0) | EFFECT_HIDDEN;
    expect(statusLayers(all).map((l) => l.id).sort()).toEqual(BITS.map(([, id]) => id).sort());
  });

  it("orders the layers floor first, then the body, then the head", () => {
    const all = BITS.reduce((m, [bit]) => m | bit, 0);
    const planes = statusLayers(all).map((l) => l.plane);
    const rank = { ground: 0, body: 1, head: 2 } as const;
    expect(planes.map((p) => rank[p])).toEqual([...planes.map((p) => rank[p])].sort());
    expect(statusLayers(EFFECT_STUNNED | EFFECT_ROOTED).map((l) => l.id)).toEqual(["root", "stun"]);
  });

  it("ignores a fractional or negative-looking word the way the bits are read", () => {
    expect(statusLayers(EFFECT_STUNNED + 0.7).map((l) => l.id)).toEqual(["stun"]);
    expect(statusLayers(Number.NaN)).toEqual([]);
  });
});

describe("StatusArt", () => {
  function setup() {
    const { scene, ofKind } = fakeScene();
    const art = new StatusArt(scene);
    return { art, g: ofKind("graphics")[0]! };
  }

  it("makes one Graphics and draws nothing without effects", () => {
    const { art, g } = setup();
    art.update(0, 1000);
    expect(g.calls).toEqual([]);
    expect(g.clears).toBe(0);
  });

  it("draws something for every bit, and nothing once the bits are gone", () => {
    for (const [bit, id] of BITS) {
      const { art, g } = setup();
      art.update(bit, 1000);
      expect(g.calls.length, id).toBeGreaterThan(0);
      art.update(0, 1100);
      expect(g.calls, id).toEqual([]);
    }
  });

  it("clears on each redraw so frames do not pile up", () => {
    const { art, g } = setup();
    art.update(EFFECT_STUNNED, 1000);
    art.update(EFFECT_STUNNED, 1016);
    expect(g.clears).toBe(2);
  });

  it("reset() clears once and is a no-op while already clear", () => {
    const { art, g } = setup();
    art.reset();
    expect(g.clears).toBe(0);
    art.update(EFFECT_DOT, 1000);
    art.reset();
    art.reset();
    expect(g.clears).toBe(2); // the redraw's clear, then reset's
    expect(g.calls).toEqual([]);
  });

  it("animates the stars with the clock", () => {
    const { art, g } = setup();
    art.update(EFFECT_STUNNED, 1000);
    const a = JSON.stringify(g.calls);
    art.update(EFFECT_STUNNED, 1100);
    expect(JSON.stringify(g.calls)).not.toBe(a);
  });

  it("holds the moving layers still under reduced motion, but still draws them", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    resetReducedMotionCache();
    // Every layer that moves (the pulsing ones are brightness only, and stay under reduced motion).
    const moving = EFFECT_STUNNED | EFFECT_SLOWED | EFFECT_HASTE | EFFECT_DOT | EFFECT_UNTARGETABLE | EFFECT_ATTACK_SLOWED | EFFECT_ZONED;
    const { art, g } = setup();
    art.update(moving, 1000);
    const first = JSON.stringify(g.calls);
    expect(g.calls.length).toBeGreaterThan(0);
    art.update(moving, 2345);
    expect(JSON.stringify(g.calls)).toBe(first);
  });

  it("gives two fighters their own phase, so a crowd does not circle in step", () => {
    const { scene, ofKind } = fakeScene();
    const a = new StatusArt(scene);
    const b = new StatusArt(scene);
    a.update(EFFECT_STUNNED, 1000);
    b.update(EFFECT_STUNNED, 1000);
    const [ga, gb] = ofKind("graphics");
    expect(JSON.stringify(ga!.calls)).not.toBe(JSON.stringify(gb!.calls));
  });
});

// Every fighter on screen updates its StatusArt every frame (8 players, up to 60 mobs): the common frame (nothing set) and the
// busy one must not build arrays, or a crowd makes thousands of them a second.
describe("StatusArt per-frame allocation", () => {
  const ALL = BITS.reduce((m, [bit]) => m | bit, 0);

  function spied<T>(run: () => T): { out: T; arrays: number } {
    let arrays = 0;
    const real = { filter: Array.prototype.filter, map: Array.prototype.map, slice: Array.prototype.slice };
    for (const k of ["filter", "map", "slice"] as const) {
      const orig = real[k] as (...a: unknown[]) => unknown;
      Array.prototype[k] = function (this: unknown[], ...args: unknown[]) { arrays++; return orig.apply(this, args); } as never;
    }
    try {
      return { out: run(), arrays };
    } finally {
      Array.prototype.filter = real.filter;
      Array.prototype.map = real.map;
      Array.prototype.slice = real.slice;
    }
  }

  it("builds no array on a frame with no status, or with only bits that have no layer", () => {
    const { scene } = fakeScene();
    const art = new StatusArt(scene);
    expect(spied(() => { for (let i = 0; i < 20; i++) { art.update(0, 1000 + i); art.update(EFFECT_HIDDEN, 1000 + i); } }).arrays).toBe(0);
  });

  it("builds no array on a frame that draws every layer", () => {
    const { scene } = fakeScene();
    const art = new StatusArt(scene);
    art.update(ALL, 1000);
    expect(spied(() => { for (let i = 0; i < 20; i++) art.update(ALL, 1016 + i * 16); }).arrays).toBe(0);
  });

  it("draws the same pictures as before for the layers it draws", () => {
    // The pure list and the drawn calls agree: a bit draws something exactly when statusLayers names a layer for it.
    for (const bit of [...BITS.map(([b]) => b), EFFECT_HIDDEN]) {
      const { scene, ofKind } = fakeScene();
      const art = new StatusArt(scene);
      art.update(bit, 1000);
      expect(ofKind("graphics")[0]!.calls.length > 0, `bit ${bit}`).toBe(statusLayers(bit).length > 0);
    }
  });
});

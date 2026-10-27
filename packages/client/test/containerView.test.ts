// A cleared camp's shared chest in the world (render/ContainerView.ts): drawn as a gold chest, never as a weapon crate; its
// ring drains over CHEST_SECONDS and turns red for the last seconds; its seconds show only up close; a drop cue plays once and
// not as motion under reduced motion; it fades out before the server removes it. And it is never what F would take.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHEST_RANGE, CHEST_SECONDS, TILE_FLOOR, Y_SCALE, mapFromTiles } from "@raid/shared";
import type { ContainerState } from "@raid/shared/schema";
import {
  ContainerView, DROP_CUE_MS, FADE_OUT_S, RING_STEPS, TIMER_RING_RADIUS, TIMER_TEXT_REACH, rewardAlpha, ringStep,
} from "../src/render/ContainerView";
import { containerWeapon, nearestContainer } from "../src/render/interact";
import { DEPTH_HIGHLIGHT } from "../src/render/MapView";
import { settings } from "../src/settings";
import { argsOf, fakeScene, names, type FakeObject } from "./fakes";

const reward = (over: Record<string, unknown> = {}): ContainerState =>
  ({
    id: "r1", kind: "reward", x: 300, y: 400, label: "", items: [], camp: 1, expiresAt: 15_000,
    options: ["whetstone"], takenBy: [""], pickers: [], ...over,
  }) as unknown as ContainerState;

function setup(c: ContainerState = reward()) {
  const s = fakeScene();
  const view = new ContainerView(s.scene);
  view.update(c);
  const [shape] = s.ofKind("graphics");
  const root = s.ofKind("container")[0]!;
  /** The ground marks, once setTimer has made them. */
  const ground = (): FakeObject => s.ofKind("graphics")[2]!;
  const text = (): FakeObject => s.ofKind("text")[1]!;
  return { ...s, view, shape: shape!, root, ground, text, c };
}

beforeEach(() => { settings.update({ reducedMotion: false, juice: 1 }); });
afterEach(() => { settings.update({ reducedMotion: false, juice: 1 }); });

describe("the helpers", () => {
  it("fades the chest over its last half second and not before", () => {
    expect(rewardAlpha(15)).toBe(1);
    expect(rewardAlpha(FADE_OUT_S)).toBe(1);
    expect(rewardAlpha(FADE_OUT_S / 2)).toBeCloseTo(0.5);
    expect(rewardAlpha(0)).toBe(0);
    expect(rewardAlpha(-3)).toBe(0);
  });

  it("drains the ring in quarter-second steps from full to empty", () => {
    expect(RING_STEPS).toBe(CHEST_SECONDS * 4);
    expect(ringStep(CHEST_SECONDS)).toBe(RING_STEPS);
    expect(ringStep(CHEST_SECONDS + 5)).toBe(RING_STEPS);
    expect(ringStep(CHEST_SECONDS / 2)).toBe(RING_STEPS / 2);
    expect(ringStep(0.01)).toBe(1);
    expect(ringStep(0)).toBe(0);
    expect(ringStep(-1)).toBe(0);
  });
});

describe("a reward chest in the world", () => {
  it("is placed and sorted like a chest, and drawn gold: a glow, a gold edge and a gold band, not the crate's colours", () => {
    const { root, shape } = setup();
    expect(root.state.position).toEqual([300, 400 * Y_SCALE]);
    expect(root.state.depth).toBe(400);
    const fills = argsOf(shape, "fillStyle").map(([c]) => c);
    expect(fills).toContain(0xffd54f);
    expect(argsOf(shape, "lineStyle").some(([, c]) => c === 0xffd54f)).toBe(true);
    // A weapon crate is the 0x7b5233 box with a 0xffd54f latch only: this one has the glow ellipse first.
    expect(argsOf(shape, "fillEllipse").length).toBe(2);
  });

  it("is not a weapon the player could take: F never offers it, empty or not", () => {
    expect(containerWeapon(reward())).toBeNull();
    // Even a reward container that somehow carried an item is not taken with F.
    expect(containerWeapon(reward({ items: [{ uid: "u", def: "sword" }] }))).toBeNull();
    const map = mapFromTiles(30, 30, new Uint8Array(900).fill(TILE_FLOOR));
    const containers = new Map([["r1", reward({ x: 100, y: 100 })]]);
    expect(nearestContainer(containers as never, map, { x: 100, y: 100 })).toBeNull();
    // A weapon crate beside it is still found.
    containers.set("c1", { ...reward({ id: "c1", x: 110, y: 100, kind: "chest" }), items: [{ uid: "u", def: "sword" }] } as never);
    expect(nearestContainer(containers as never, map, { x: 100, y: 100 })?.id).toBe("c1");
  });

  it("draws nothing on the ground until it is timed, then one ring layer on the ground layer, flattened like the world", () => {
    const { view, ofKind, ground, c } = setup();
    expect(ofKind("graphics")).toHaveLength(2);
    view.setTimer(c, 15, true, 0);
    expect(ofKind("graphics")).toHaveLength(3);
    expect(ground().state.depth).toBe(DEPTH_HIGHLIGHT);
    expect(ground().state.scale).toEqual([1, Y_SCALE]);
    expect(ground().state.position).toEqual([300, 400 * Y_SCALE]);
  });

  it("draws the pick range faintly and the timer ring full at the start, draining clockwise from the top", () => {
    const { view, ground, c } = setup();
    view.setTimer(c, CHEST_SECONDS, true, 10_000);
    const ring = ground();
    expect(argsOf(ring, "strokeCircle").some(([, , r]) => r === CHEST_RANGE)).toBe(true);
    const arcs = argsOf(ring, "arc");
    expect(arcs).toHaveLength(1);
    expect(arcs[0]).toEqual([0, 0, TIMER_RING_RADIUS, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2, false]);
    // Past the drop cue, half the time left: half the ring.
    view.setTimer(c, CHEST_SECONDS / 2, true, 20_000);
    expect(argsOf(ring, "arc")[0]![4]).toBeCloseTo(-Math.PI / 2 + Math.PI);
    view.setTimer(c, CHEST_SECONDS / 4, true, 20_100);
    expect(argsOf(ring, "arc")[0]![4]).toBeCloseTo(-Math.PI / 2 + Math.PI / 2);
    // Empty: no arc at all.
    view.setTimer(c, 0, true, 20_200);
    expect(argsOf(ring, "arc")).toHaveLength(0);
  });

  it("redraws the ring only when it moved a step, not every frame", () => {
    const { view, ground, c } = setup();
    // The drop cue (the first DROP_CUE_MS) redraws every frame; after it the ring moves one step a quarter second.
    view.setTimer(c, 12, true, 0);
    view.setTimer(c, 12, true, 10_000);
    const ring = ground();
    const clears = ring.clears;
    for (let i = 0; i < 10; i++) view.setTimer(c, 12 - i * 0.01, true, 10_000 + 100 * (i + 1));
    expect(ring.clears).toBe(clears);
    view.setTimer(c, 11.5, true, 12_000);
    expect(ring.clears).toBe(clears + 1);
  });

  it("turns red for the last five seconds", () => {
    const { view, ground, c } = setup();
    view.setTimer(c, 6, true, 0);
    view.setTimer(c, 6, true, 10_000);
    const bright = (): unknown[] => argsOf(ground(), "lineStyle").filter(([w]) => w === 3).map(([, color]) => color);
    expect(bright()).toEqual([0xffd54f]);
    view.setTimer(c, 5, true, 10_100);
    expect(bright()).toEqual([0xff8a80]);
  });

  it("shows the seconds left only up close, and never at zero", () => {
    const { view, text, c } = setup();
    view.setTimer(c, 9.2, true, 10_000);
    expect(text().state.text).toBe("10s");
    expect(text().state.visible).toBe(true);
    view.setTimer(c, 9.2, false, 10_100);
    expect(text().state.visible).toBe(false);
    view.setTimer(c, 0.4, true, 10_200);
    expect(text().state.text).toBe("1s");
    view.setTimer(c, 0, true, 10_300);
    expect(text().state.visible).toBe(false);
    // "Up close" is a couple of pick ranges: the scene's choice, named here.
    expect(TIMER_TEXT_REACH).toBeGreaterThan(1);
  });

  it("fades out over its last half second, chest and ring together", () => {
    const { view, root, ground, c } = setup();
    view.setTimer(c, 5, true, 10_000);
    expect(root.state.alpha).toBe(1);
    view.setTimer(c, FADE_OUT_S / 2, true, 10_100);
    expect(root.state.alpha).toBeCloseTo(0.5);
    expect(ground().state.alpha).toBeCloseTo(0.5);
    view.setTimer(c, 0, true, 10_200);
    expect(root.state.alpha).toBe(0);
  });

  it("plays a drop cue once: an expanding ring and a settling scale, gone after DROP_CUE_MS", () => {
    const { view, root, ground, c } = setup();
    view.setTimer(c, 15, true, 5_000);
    const cueRadius = (): number[] => argsOf(ground(), "strokeCircle").map(([, , r]) => r as number).filter((r) => r !== CHEST_RANGE && r !== TIMER_RING_RADIUS);
    expect(cueRadius()).toHaveLength(1);
    expect(root.state.scale as number).toBeGreaterThan(1);
    view.setTimer(c, 15, true, 5_000 + DROP_CUE_MS / 2);
    const mid = cueRadius()[0]!;
    view.setTimer(c, 14.8, true, 5_000 + DROP_CUE_MS - 20);
    expect(cueRadius()[0]!).toBeGreaterThan(mid);
    view.setTimer(c, 14.5, true, 5_000 + DROP_CUE_MS + 1);
    expect(cueRadius()).toHaveLength(0);
    expect(root.state.scale).toBe(1);
    // It does not come back.
    view.setTimer(c, 14.0, true, 60_000);
    expect(cueRadius()).toHaveLength(0);
  });

  it("under reduced motion the cue is a still flash: no growing ring, no scale", () => {
    settings.update({ reducedMotion: true });
    const { view, root, ground, c } = setup();
    view.setTimer(c, 15, true, 5_000);
    const rings = (): number[] => argsOf(ground(), "strokeCircle").map(([, , r]) => r as number).filter((r) => r !== CHEST_RANGE && r !== TIMER_RING_RADIUS);
    const first = rings();
    expect(first).toHaveLength(1);
    view.setTimer(c, 15, true, 5_000 + DROP_CUE_MS / 2);
    expect(rings()).toEqual(first);
    expect(root.state.scale).toBe(1);
  });

  it("with the effects turned off there is no cue at all", () => {
    settings.update({ juice: 0 });
    const { view, root, ground, c } = setup();
    view.setTimer(c, 15, true, 5_000);
    expect(argsOf(ground(), "strokeCircle").map(([, , r]) => r).filter((r) => r !== CHEST_RANGE && r !== TIMER_RING_RADIUS)).toEqual([]);
    expect(root.state.scale).toBe(1);
  });

  it("follows a move and a hide, and takes the ring away with it", () => {
    const { view, ground, root, c } = setup();
    view.setTimer(c, 10, true, 10_000);
    view.update(reward({ x: 320, y: 440 }));
    expect(ground().state.position).toEqual([320, 440 * Y_SCALE]);
    view.setHidden(true);
    expect(ground().state.visible).toBe(false);
    expect(root.state.visible).toBe(false);
    view.setHidden(false);
    expect(ground().state.visible).toBe(true);
    const ring = ground();
    view.destroy();
    expect(names(ring)).toContain("destroy");
  });

  it("does nothing for a container that is not a reward chest", () => {
    const s = fakeScene();
    const view = new ContainerView(s.scene);
    const crate = { ...reward({ kind: "chest" }), items: [{ uid: "u", def: "axe" }] } as unknown as ContainerState;
    view.update(crate);
    view.setTimer(crate, 10, true, 0);
    expect(s.ofKind("graphics")).toHaveLength(2);
    expect(s.ofKind("text")).toHaveLength(1);
  });
});
